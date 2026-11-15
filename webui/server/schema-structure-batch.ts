import type { runCatalogShow } from "./catalog-show";
import type { SqlResult } from "./ktx";
import type { MetadataChannel } from "./metadata-channel";
import type { SchemaColumnRow } from "./schema-structure";

/** Most tables one `schema-structure` call reads. */
export const MAX_TABLES_PER_CALL = 50;
/** One table's column rows; a full page is treated as truncated and the table is reported as too wide. */
export const COLUMN_READ_ROW_LIMIT = 10_000;
/** After this, a call starts no new table; the rest comes back as `deferred`. */
export const CALL_BUDGET_MS = 10_000;
/** Per-statement timeout inside a batch call. */
export const PER_TABLE_TIMEOUT_MS = 8_000;

export type BatchRejectionReason = "missing" | "ambiguous" | "unreadable" | "permission" | "timeout" | "too_wide";
export type BatchRejection = { table: string; reason: BatchRejectionReason };
export type BatchRead = { columns: SchemaColumnRow[]; rejections: BatchRejection[]; deferred: string[] };

type Run = MetadataChannel["run"];
export type BatchOptions = {
  rowLimit: number;
  timeoutMs: number;
  budgetMs?: number;
  now: () => number;
};

const CONNECTION_OR_TIMEOUT =
  /timed out|can't connect|cannot connect|connection refused|connection lost|econnrefused|enotfound|etimedout|econnreset|protocol_connection_lost/i;

/** Driver text to a closed reason; the text itself never leaves the server. */
export function failureReason(message: string): BatchRejectionReason {
  if (/timed out|max_execution_time|maximum statement execution time|query execution was interrupted/i.test(message)) {
    return "timeout";
  }
  if (/access denied|command denied|permission denied|\bprivilege\b/i.test(message)) return "permission";
  if (/unknown table|doesn't exist|does not exist|table not found/i.test(message)) return "missing";
  return "unreadable";
}

export function isBrokenChannelError(error: unknown): boolean {
  return CONNECTION_OR_TIMEOUT.test(error instanceof Error ? error.message : String(error));
}

function literal(value: string): string | null {
  if (!value || value.length > 256 || /[\\\0\r\n]/.test(value)) return null;
  return `'${value.replace(/'/g, "''")}'`;
}

function literalList(values: string[]): string {
  return values
    .map((value) => {
      const quoted = literal(value);
      if (quoted === null) throw new Error("unsafe table name reached the SQL builder");
      return quoted;
    })
    .join(",");
}

function tablesSql(schema: string, names: string[]): string {
  return (
    `SELECT table_name FROM information_schema.tables WHERE table_schema = ${literal(schema)} ` +
    `AND table_type = 'BASE TABLE' AND LOWER(table_name) IN (${literalList(names.map((name) => name.toLowerCase()))})`
  );
}

function columnsSql(schema: string, physical: string[]): string {
  return (
    "SELECT table_name, column_name, data_type, is_nullable, column_key, column_comment " +
    `FROM information_schema.columns WHERE table_schema = ${literal(schema)} AND table_name IN (${literalList(physical)}) ` +
    "ORDER BY table_name, ordinal_position"
  );
}

type Resolved = { requested: string; physical: string };
type Outcome = { columns: SchemaColumnRow[] } | { reason: BatchRejectionReason } | "deferred";

/**
 * Plain MySQL: one statement resolves the physical names (case and ambiguity rules as before), then
 * one `information_schema.columns` statement reads a chunk of them. A truncated chunk is halved; a
 * single table that still fills the limit is `too_wide`. Results are returned in request order.
 */
export async function readMysqlTablesBatch(
  run: Run,
  schema: string,
  requested: string[],
  options: BatchOptions
): Promise<BatchRead> {
  const start = options.now();
  const outcomes = new Map<string, Outcome>();
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const table of requested) {
    if (outcomes.has(table) || seen.has(table)) continue;
    if (literal(table) === null || literal(schema) === null) outcomes.set(table, { reason: "unreadable" });
    else {
      seen.add(table);
      valid.push(table);
    }
  }

  const resolved = await resolvePhysicalNames(run, schema, valid, options, outcomes);
  let chunksFinished = 0;
  const overBudget = () => options.budgetMs !== undefined && options.now() - start >= options.budgetMs;

  const readChunk = async (chunk: Resolved[]): Promise<void> => {
    if (chunksFinished > 0 && overBudget()) {
      for (const item of chunk) outcomes.set(item.requested, "deferred");
      return;
    }
    const split = async () => {
      const middle = Math.ceil(chunk.length / 2);
      await readChunk(chunk.slice(0, middle));
      await readChunk(chunk.slice(middle));
    };
    let answer;
    try {
      answer = await run(columnsSql(schema, chunk.map((item) => item.physical)), {
        maxRows: options.rowLimit,
        timeoutMs: options.timeoutMs
      });
    } catch (error) {
      if (chunk.length > 1 && !isBrokenChannelError(error)) return split();
      chunksFinished += 1;
      const reason = failureReason(error instanceof Error ? error.message : String(error));
      for (const item of chunk) outcomes.set(item.requested, { reason });
      return;
    }
    if (answer.truncated) {
      if (chunk.length > 1) return split();
      chunksFinished += 1;
      outcomes.set(chunk[0].requested, { reason: "too_wide" });
      return;
    }
    chunksFinished += 1;
    const byTable = new Map<string, SchemaColumnRow[]>();
    for (const row of answer.rows) {
      if (!Array.isArray(row) || row.length < 6) continue;
      const physical = String(row[0] ?? "").trim();
      const column = String(row[1] ?? "").trim();
      if (!physical || !column) continue;
      const list = byTable.get(physical) ?? [];
      list.push({
        table: physical,
        column,
        dataType: String(row[2] ?? ""),
        nullable: String(row[3] ?? "").toUpperCase() !== "NO",
        primaryKey: String(row[4] ?? "").toUpperCase() === "PRI",
        comment: String(row[5] ?? "")
      });
      byTable.set(physical, list);
    }
    for (const item of chunk) {
      const rows = byTable.get(item.physical);
      outcomes.set(
        item.requested,
        rows && rows.length > 0
          ? { columns: rows.map((column) => ({ ...column, table: item.requested })) }
          : { reason: "unreadable" }
      );
    }
  };

  if (resolved.length > 0) await readChunk(resolved);
  return assemble(requested, outcomes);
}

async function resolvePhysicalNames(
  run: Run,
  schema: string,
  names: string[],
  options: BatchOptions,
  outcomes: Map<string, Outcome>
): Promise<Resolved[]> {
  if (names.length === 0) return [];
  let rows: unknown[][];
  try {
    const answer = await run(tablesSql(schema, names), { maxRows: options.rowLimit, timeoutMs: options.timeoutMs });
    if (answer.truncated) throw new Error("table match truncated");
    rows = answer.rows;
  } catch (error) {
    const reason = failureReason(error instanceof Error ? error.message : String(error));
    for (const name of names) outcomes.set(name, { reason });
    return [];
  }
  const physicalByLower = new Map<string, Set<string>>();
  for (const row of rows) {
    const name = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
    if (!name) continue;
    const key = name.toLowerCase();
    physicalByLower.set(key, (physicalByLower.get(key) ?? new Set()).add(name));
  }
  const resolved: Resolved[] = [];
  for (const name of names) {
    const physical = [...(physicalByLower.get(name.toLowerCase()) ?? [])];
    if (physical.length > 1) outcomes.set(name, { reason: "ambiguous" });
    else if (physical.length === 0) outcomes.set(name, { reason: "missing" });
    else resolved.push({ requested: name, physical: physical[0] });
  }
  return resolved;
}

function assemble(requested: string[], outcomes: Map<string, Outcome>): BatchRead {
  const result: BatchRead = { columns: [], rejections: [], deferred: [] };
  const seen = new Set<string>();
  for (const table of requested) {
    if (seen.has(table)) continue;
    seen.add(table);
    const outcome = outcomes.get(table);
    if (outcome === "deferred") result.deferred.push(table);
    else if (outcome && "columns" in outcome) result.columns.push(...outcome.columns);
    else result.rejections.push({ table, reason: outcome?.reason ?? "unreadable" });
  }
  return result;
}

/**
 * Holds one channel for a whole call. A timeout or lost connection discards it, so the next statement
 * opens a fresh one instead of reusing a connection in an unknown state.
 */
export function createChannelHolder(open: () => Promise<MetadataChannel>) {
  let channel: MetadataChannel | null = null;
  const holder = {
    /** Opens the first channel now so an unavailable one is known before any table is read. */
    async ensure(): Promise<void> {
      channel ??= await open();
    },
    run: (async (sql, options) => {
      channel ??= await open();
      try {
        return await channel.run(sql, options);
      } catch (error) {
        if (isBrokenChannelError(error)) {
          channel.close();
          channel = null;
        }
        throw error;
      }
    }) as Run,
    close(): void {
      channel?.close();
      channel = null;
    }
  };
  return holder;
}

/** Lets the per-table probe code of P1-20 run on a held channel instead of one connection per probe. */
export function channelAsShow(run: Run): typeof runCatalogShow {
  return async (_root, _connectionId, sql, options = {}) => {
    const base = { command: "mysql SHOW", args: [] as string[], stdout: "" };
    const started = Date.now();
    try {
      const answer = await run(sql, { maxRows: options.maxRows ?? COLUMN_READ_ROW_LIMIT, timeoutMs: options.timeoutMs ?? PER_TABLE_TIMEOUT_MS });
      return { ...base, ok: true, exitCode: 0, stderr: "", latencyMs: Date.now() - started, json: { headers: [], rows: answer.rows } } as SqlResult;
    } catch (error) {
      return {
        ...base,
        ok: false,
        exitCode: 1,
        stderr: error instanceof Error ? error.message : "读取表结构失败。",
        latencyMs: Date.now() - started,
        json: null
      } as SqlResult;
    }
  };
}

export type ParsedTables = { ok: true; tables: string[] | undefined } | { ok: false; message: string };

/** The `tables` of a `schema-structure` request: absent (names only), or 1..50 distinct non-empty names. */
export function parseRequestedTables(value: unknown): ParsedTables {
  if (value === undefined) return { ok: true, tables: undefined };
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || !item.trim())) {
    return { ok: false, message: `tables 必须是 1 到 ${MAX_TABLES_PER_CALL} 张表名的清单。` };
  }
  const tables = [...new Set((value as string[]).map((item) => item.trim()))];
  if (tables.length > MAX_TABLES_PER_CALL) {
    return { ok: false, message: `一次最多读取 ${MAX_TABLES_PER_CALL} 张表的字段。` };
  }
  return { ok: true, tables };
}
