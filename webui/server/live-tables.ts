/**
 * Spec 190 §6 — Schema-level live table list (库内表清单).
 *
 * Read-only. The production provider runs one table-granularity aggregate query
 * against the physical database (path B of Spec 190 §6.2), so the returned row
 * count equals the table count and never collides with the 10 000 column-row
 * ceiling of the column-level query.
 *
 * Failure classification is conservative by construction: a database that does
 * not distinguish "schema missing" from "schema not visible" is always reported
 * as `SCHEMA_NOT_VISIBLE`, so the UI never claims a table was deleted.
 */
import { catalogTablesSql, splitCatalogDatabase } from "./catalog-database";
import { readConnections } from "./project";
import { KtxCliError, runSql, type SqlResult } from "./ktx";
import { assertSchemaIdent, columnScanTimedOut } from "./schema-structure";
import { resolveWireProtocol, type CatalogProtocol } from "./live-catalog";
import type { ProbePurpose } from "./background-probes";
import type { ConnectionInfo } from "./model";

/** Closed vocabulary — Spec 190 §7.1. Every failure maps to exactly one member. */
export const LIVE_TABLE_FAILURE_REASONS = [
  "PROTOCOL_UNSUPPORTED",
  "TABLE_LIST_UNSUPPORTED",
  "CONNECTION_FAILED",
  "AUTH_FAILED",
  "SCHEMA_NOT_FOUND",
  "SCHEMA_NOT_VISIBLE",
  "TABLE_LIST_TOO_LARGE",
  "QUERY_FAILED",
  "PROBE_QUEUE_FULL",
  "PROBE_QUEUE_TIMEOUT",
  "GENERATION_INVALIDATED",
  "PROVIDER_UNAVAILABLE",
  "SNAPSHOT_WRITE_FAILED"
] as const;

export type LiveTableFailureReason = (typeof LIVE_TABLE_FAILURE_REASONS)[number];

export type LiveTableWireProtocol = "mysql" | "postgres" | "unknown";

export type LiveTableEntry = {
  /** Physical table name, without the Schema prefix. */
  table: string;
  tableType: "BASE TABLE" | "VIEW";
  columnCount: number;
  tableComment?: string;
};

export type LiveTablesResponse = {
  status: "ok" | "error";
  connectionId: string;
  schema: string;
  tables: LiveTableEntry[];
  fetchedAt: string;
  cached: boolean;
  latencyMs?: number;
  reason?: LiveTableFailureReason;
  wireProtocol: LiveTableWireProtocol;
};

/**
 * Row ceiling for one table-list answer. A full page means the answer may be
 * truncated, so it fails instead of returning a partial list (Spec 190 §8.1).
 */
export const TABLE_LIST_MAX_ROWS = 10_000;

/** Manual reads are cached for 10 minutes (Spec 190 §6.4). */
export const LIVE_TABLES_MANUAL_TTL_MS = 10 * 60 * 1000;

/** Automatic reads are cached for one polling interval (Spec 190 §6.4). */
export const LIVE_TABLES_AUTOMATIC_TTL_MS = 60 * 60 * 1000;

const MYSQL_TABLE_LIST_SQL = `
SELECT t.table_name, t.table_type, COALESCE(t.table_comment, ''), COUNT(c.column_name) AS column_count
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = '__SCHEMA__' AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name, t.table_type, t.table_comment
ORDER BY t.table_name
`.trim().replace(/\s+/g, " ");

/** Names only. Used after the column join above hits the 30s deadline on a wide schema. */
const MYSQL_TABLE_NAME_SQL = `
SELECT table_name, table_type, COALESCE(table_comment, '')
FROM information_schema.tables
WHERE table_schema = '__SCHEMA__' AND table_type = 'BASE TABLE'
ORDER BY table_name
`.trim().replace(/\s+/g, " ");

const MYSQL_COLUMN_COUNT_BATCH = 8;

const POSTGRES_TABLE_LIST_SQL = `
SELECT c.relname, 'BASE TABLE', COALESCE(obj_description(c.oid, 'pg_class'), ''), COUNT(a.attname) AS column_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attribute a
  ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
WHERE n.nspname = '__SCHEMA__' AND c.relkind IN ('r', 'p')
GROUP BY c.relname, c.oid
ORDER BY c.relname
`.trim().replace(/\s+/g, " ");

/** Spec 190 §6.1 — the table-level list covers the mysql / postgres families only. */
export function supportsTableList(protocol: CatalogProtocol | "unknown"): boolean {
  return protocol === "mysql" || protocol === "postgres";
}

function tableListSql(protocol: "mysql" | "postgres", schema: string): string {
  const template = protocol === "postgres" ? POSTGRES_TABLE_LIST_SQL : MYSQL_TABLE_LIST_SQL;
  // `schema` already passed `assertSchemaIdent` (identifier whitelist), so the
  // literal below can never carry a quote, comment or statement separator.
  return template.replace("__SCHEMA__", schema);
}

// ─── failure classification (Spec 190 §7.1) ───────────────────────────────────

const AUTH_PATTERNS = [
  /authentication failed/i,
  /password authentication failed/i,
  /access denied for user .*\(using password/i,
  /invalid credentials/i,
  /invalid password/i,
  /login failed/i,
  /unauthorized/i,
  /authentication required/i
];

const CONNECTION_PATTERNS = [
  /can'?t connect/i,
  /connection refused/i,
  /connection reset/i,
  /connection timed out/i,
  /connect timed out/i,
  /timed out/i,
  /unknown host/i,
  /no such host/i,
  /could not connect/i,
  /server has gone away/i,
  /broken pipe/i,
  /lost connection/i,
  /unexpected eof/i,
  /\beof\b/i,
  /network is unreachable/i
];

const PROVIDER_PATTERNS = [
  /ktx cli was not found/i,
  /unknown command/i,
  /command not found/i,
  /enoent/i
];

/** Explicit "the object does not exist" wording only — never inferred. */
const NOT_FOUND_PATTERNS = [
  /unknown database/i,
  /unknown schema/i,
  /database .* does not exist/i,
  /schema .* does not exist/i,
  /does not exist/i,
  /doesn't exist/i
];

const NOT_VISIBLE_PATTERNS = [
  /permission denied/i,
  /access denied/i,
  /not authorized/i,
  /must be owner of/i,
  /insufficient privilege/i,
  /privilege/i,
  /has been revoked/i
];

/**
 * MySQL 1045 (`Access denied for user ... (using password: ...)`) is a
 * credential failure, while 1044 (`Access denied for user ... to database
 * 'x'`) is a privilege problem on one schema. The two must not be conflated:
 * 1044 means the schema may well exist.
 */
const PRIVILEGE_ON_DATABASE = /access denied for user .* to database/i;

/**
 * Map a failed `ktx sql` invocation onto the closed reason vocabulary.
 *
 * Conservative rules (Spec 190 §7.1):
 *  - authentication wording ⇒ `AUTH_FAILED`;
 *  - connectivity wording ⇒ `CONNECTION_FAILED`;
 *  - explicit "does not exist" ⇒ `SCHEMA_NOT_FOUND`;
 *  - any other permission wording ⇒ `SCHEMA_NOT_VISIBLE`;
 *  - everything else ⇒ `QUERY_FAILED`.
 */
export function classifyLiveTableFailure(input: {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}): LiveTableFailureReason {
  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`;
  if (PROVIDER_PATTERNS.some((pattern) => pattern.test(text))) return "PROVIDER_UNAVAILABLE";
  // A privilege error on one database is a visibility problem, not a
  // credential problem — it is checked before the authentication patterns.
  if (PRIVILEGE_ON_DATABASE.test(text)) return "SCHEMA_NOT_VISIBLE";
  if (AUTH_PATTERNS.some((pattern) => pattern.test(text))) return "AUTH_FAILED";
  if (CONNECTION_PATTERNS.some((pattern) => pattern.test(text))) return "CONNECTION_FAILED";
  if (NOT_FOUND_PATTERNS.some((pattern) => pattern.test(text))) return "SCHEMA_NOT_FOUND";
  if (NOT_VISIBLE_PATTERNS.some((pattern) => pattern.test(text))) return "SCHEMA_NOT_VISIBLE";
  return "QUERY_FAILED";
}

// ─── provider (Spec 190 §6.2) ────────────────────────────────────────────────

export type LiveTableProvider = {
  /** Returns the Schema's table list. Business failures come back as `reason`, never as a throw. */
  listTables(input: {
    projectRoot: string;
    connectionId: string;
    schema: string;
    generation: number;
  }): Promise<{
    status: "ok" | "error";
    tables: LiveTableEntry[];
    fetchedAt: string;
    reason?: LiveTableFailureReason;
    latencyMs?: number;
    wireProtocol: LiveTableWireProtocol;
  }>;
};

export type SqlLiveTableProviderDeps = {
  readConnectionsImpl?: typeof readConnections;
  runSqlImpl?: typeof runSql;
  now?: () => number;
};

/**
 * The raw row count of one answer — the number of rows the database actually
 * returned, before any row is dropped as malformed.
 *
 * The ceiling check has to use this number and not the parsed one: a full page
 * whose answer was cut off by `--max-rows` must fail even when some of its
 * rows are malformed (Spec 190 SC-5, "不返回部分表"). Counting the parsed rows
 * would let a truncated page through as long as one row was dropped.
 */
function rawRowCount(json: unknown): number {
  if (!json || typeof json !== "object") return 0;
  const rows = (json as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows.length : 0;
}

function parseShowTableNames(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const names: string[] = [];
  for (const row of rows) {
    const table = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
    if (table) names.push(table);
  }
  return names;
}

function parseTableRows(json: unknown): LiveTableEntry[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const out: LiveTableEntry[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const table = String(row[0] ?? "").trim();
    if (!table) continue;
    const rawType = String(row[1] ?? "").trim().toUpperCase();
    const tableType: LiveTableEntry["tableType"] = rawType === "VIEW" ? "VIEW" : "BASE TABLE";
    const columnCount = Number(row[3]);
    if (!Number.isFinite(columnCount)) continue;
    const comment = String(row[2] ?? "").trim();
    out.push({
      table,
      tableType,
      columnCount: Math.max(0, Math.floor(columnCount)),
      ...(comment ? { tableComment: comment } : {})
    });
  }
  return out;
}

function mysqlStringLiteral(value: string): string | null {
  if (!value || value.length > 256 || /[\0\r\n]/.test(value)) return null;
  return `'${value.replace(/'/g, "''")}'`;
}

function parseMysqlNameRows(json: unknown): LiveTableEntry[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const out: LiveTableEntry[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const table = String(row[0] ?? "").trim();
    if (!table) continue;
    const rawType = String(row[1] ?? "").trim().toUpperCase();
    const comment = String(row[2] ?? "").trim();
    out.push({
      table,
      tableType: rawType === "VIEW" ? "VIEW" : "BASE TABLE",
      columnCount: 0,
      ...(comment ? { tableComment: comment } : {})
    });
  }
  return out;
}

function mysqlColumnCountSql(schema: string, tables: string[]): string | null {
  const schemaLiteral = mysqlStringLiteral(schema);
  const tableLiterals = tables.map((table) => mysqlStringLiteral(table));
  if (!schemaLiteral || tableLiterals.some((literal) => literal === null)) return null;
  return `SELECT table_name, COUNT(*) FROM information_schema.columns WHERE table_schema = ${schemaLiteral} AND table_name IN (${tableLiterals.join(", ")}) GROUP BY table_name`;
}

/**
 * The one-shot table/column join cannot finish on a wide schema. Names come
 * from information_schema.tables alone; column counts are read in small
 * batches and split again if a batch still hits the deadline. A batch that
 * cannot be counted does not drop the table.
 */
async function listMysqlTablesAfterWideScanTimeout(input: {
  runSqlImpl: typeof runSql;
  projectRoot: string;
  connectionId: string;
  schema: string;
  fetchedAt: string;
}): Promise<{
  status: "ok" | "error";
  tables: LiveTableEntry[];
  fetchedAt: string;
  reason?: LiveTableFailureReason;
  latencyMs?: number;
  wireProtocol: LiveTableWireProtocol;
}> {
  const { runSqlImpl, projectRoot, connectionId, schema, fetchedAt } = input;
  const listed = await runSqlImpl(
    projectRoot,
    connectionId,
    MYSQL_TABLE_NAME_SQL.replace("__SCHEMA__", schema),
    { maxRows: TABLE_LIST_MAX_ROWS, timeoutMs: 30_000 }
  );
  if (!listed.ok || listed.json == null || typeof listed.json !== "object") {
    return {
      status: "error",
      tables: [],
      fetchedAt,
      reason: classifyLiveTableFailure({
        exitCode: listed.exitCode,
        stdout: listed.stdout,
        stderr: listed.stderr
      }),
      latencyMs: listed.latencyMs,
      wireProtocol: "mysql"
    };
  }
  if (rawRowCount(listed.json) >= TABLE_LIST_MAX_ROWS) {
    return {
      status: "error",
      tables: [],
      fetchedAt,
      reason: "TABLE_LIST_TOO_LARGE",
      latencyMs: listed.latencyMs,
      wireProtocol: "mysql"
    };
  }
  const tables = parseMysqlNameRows(listed.json);
  const counts = new Map<string, number>();

  async function readCounts(batch: string[]): Promise<void> {
    if (batch.length === 0) return;
    const sql = mysqlColumnCountSql(schema, batch);
    if (!sql) return;
    const result = await runSqlImpl(projectRoot, connectionId, sql, {
      maxRows: TABLE_LIST_MAX_ROWS,
      timeoutMs: 30_000
    });
    if (columnScanTimedOut(result) && batch.length > 1) {
      const mid = Math.ceil(batch.length / 2);
      await readCounts(batch.slice(0, mid));
      await readCounts(batch.slice(mid));
      return;
    }
    if (!result.ok || result.json == null || typeof result.json !== "object") return;
    const rows = (result.json as { rows?: unknown }).rows;
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const name = String(row[0] ?? "").trim();
      const count = Number(row[1]);
      if (name && Number.isFinite(count)) counts.set(name, Math.max(0, Math.floor(count)));
    }
  }

  for (let index = 0; index < tables.length; index += MYSQL_COLUMN_COUNT_BATCH) {
    await readCounts(tables.slice(index, index + MYSQL_COLUMN_COUNT_BATCH).map((entry) => entry.table));
  }

  return {
    status: "ok",
    tables: tables.map((entry) => ({
      ...entry,
      columnCount: counts.get(entry.table) ?? 0
    })),
    fetchedAt,
    latencyMs: listed.latencyMs,
    wireProtocol: "mysql"
  };
}

/**
 * Production provider — path B of Spec 190 §6.2: one read-only aggregate query
 * per Schema, executed through the KTX credential channel. No AI, no enrichment.
 */
export function createSqlLiveTableProvider(
  deps: SqlLiveTableProviderDeps = {}
): LiveTableProvider {
  const readConnectionsImpl = deps.readConnectionsImpl ?? readConnections;
  const runSqlImpl = deps.runSqlImpl ?? runSql;
  const now = deps.now ?? Date.now;

  return {
    async listTables({ projectRoot, connectionId, schema }) {
      const fetchedAt = new Date(now()).toISOString();
      const connections = await readConnectionsImpl(projectRoot);
      const conn = connections.find((item) => item.id === connectionId);
      if (!conn) {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "CONNECTION_FAILED",
          wireProtocol: "unknown"
        };
      }
      const wireProtocol = resolveWireProtocol(conn);
      if (wireProtocol === "unknown") {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "PROTOCOL_UNSUPPORTED",
          wireProtocol: "unknown"
        };
      }
      if (!supportsTableList(wireProtocol)) {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "TABLE_LIST_UNSUPPORTED",
          wireProtocol: "unknown"
        };
      }
      const protocol = wireProtocol as "mysql" | "postgres";
      const catalog = protocol === "mysql" ? splitCatalogDatabase(conn.database) : null;
      // SelectDB / Doris external catalogs resolve unqualified information_schema
      // to a missing default-cluster database, and KTX 0.16.0 rejects SHOW.
      // List those tables from catalog.information_schema. Column counts stay 0
      // here: one name query must not turn into a per-table column scan.
      let listSql: string;
      try {
        listSql = catalog
          ? catalogTablesSql(catalog.catalog, schema)
          : tableListSql(protocol, schema);
      } catch {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "QUERY_FAILED",
          wireProtocol: protocol
        };
      }
      let result: SqlResult;
      try {
        result = await runSqlImpl(
          projectRoot,
          connectionId,
          listSql,
          { maxRows: TABLE_LIST_MAX_ROWS, timeoutMs: 30_000 }
        );
      } catch (err) {
        if (err instanceof KtxCliError) {
          return {
            status: "error",
            tables: [],
            fetchedAt,
            reason: classifyLiveTableFailure({
              exitCode: 1,
              stdout: "",
              stderr: err.message
            }),
            wireProtocol: protocol
          };
        }
        throw err;
      }
      if (!catalog && protocol === "mysql" && columnScanTimedOut(result)) {
        return listMysqlTablesAfterWideScanTimeout({
          runSqlImpl,
          projectRoot,
          connectionId,
          schema,
          fetchedAt
        });
      }
      if (!result.ok) {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: classifyLiveTableFailure({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr
          }),
          latencyMs: result.latencyMs,
          wireProtocol: protocol
        };
      }
      if (result.json == null || typeof result.json !== "object") {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "QUERY_FAILED",
          latencyMs: result.latencyMs,
          wireProtocol: protocol
        };
      }
      const tables = catalog
        ? parseShowTableNames(result.json).map((table) => ({
            table,
            tableType: "BASE TABLE" as const,
            columnCount: 0
          }))
        : parseTableRows(result.json);
      // A full page may be truncated — fail loudly instead of returning a partial
      // list. The ceiling is measured on the raw row count, so a truncated page
      // is caught even when some of its rows are malformed.
      if (rawRowCount(result.json) >= TABLE_LIST_MAX_ROWS) {
        return {
          status: "error",
          tables: [],
          fetchedAt,
          reason: "TABLE_LIST_TOO_LARGE",
          latencyMs: result.latencyMs,
          wireProtocol: protocol
        };
      }
      return {
        status: "ok",
        tables,
        fetchedAt,
        latencyMs: result.latencyMs,
        wireProtocol: protocol
      };
    }
  };
}

// ─── cache (Spec 190 §6.4) ───────────────────────────────────────────────────

type CacheEntry = {
  expiresAt: number;
  payload: LiveTablesResponse;
  generation: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(
  projectRoot: string,
  connectionId: string,
  schema: string,
  generation: number,
  purpose: ProbePurpose
): string {
  return `${projectRoot}\u0000${connectionId}\u0000${schema}\u0000${generation}\u0000${purpose}`;
}

export function clearLiveTablesCache(): void {
  cache.clear();
}

/** Completed-result lookup without starting a probe. Manual and automatic never share an entry. */
export function peekLiveTablesCache(
  projectRoot: string,
  connectionId: string,
  schema: string,
  generation: number,
  purpose: ProbePurpose,
  now: () => number = Date.now
): LiveTablesResponse | null {
  const hit = cache.get(cacheKey(projectRoot, connectionId, schema, generation, purpose));
  if (!hit || hit.expiresAt <= now() || hit.generation !== generation) return null;
  return { ...hit.payload, cached: true };
}

export function liveTablesTtlMs(purpose: ProbePurpose, intervalMs?: number): number {
  if (purpose === "automatic") {
    return intervalMs && intervalMs > 0 ? intervalMs : LIVE_TABLES_AUTOMATIC_TTL_MS;
  }
  return LIVE_TABLES_MANUAL_TTL_MS;
}

// ─── read entry point (Spec 190 §8.1) ────────────────────────────────────────

export class LiveTablesConnectionNotFoundError extends Error {
  code = "CONNECTION_NOT_FOUND";
  statusCode = 404;

  constructor(connectionId: string) {
    super(`Connection '${connectionId}' not found in ktx.yaml`);
    this.name = "LiveTablesConnectionNotFoundError";
  }
}

export type ReadLiveTablesDeps = {
  readConnectionsImpl?: typeof readConnections;
  provider?: LiveTableProvider;
  now?: () => number;
  currentGeneration?: () => number;
};

function errorPayload(
  connectionId: string,
  schema: string,
  reason: LiveTableFailureReason,
  fetchedAt: string,
  wireProtocol: LiveTableWireProtocol = "unknown"
): LiveTablesResponse {
  return {
    status: "error",
    connectionId,
    schema,
    tables: [],
    fetchedAt,
    cached: false,
    reason,
    wireProtocol
  };
}

/**
 * Read one Schema's live table list.
 *
 * `purpose` decides the cache entry: manual reads and background polling keep
 * separate entries so a 5-minute poll never rides on a 10-minute manual cache
 * (Spec 190 §6.4).
 */
export async function readLiveTables(
  projectRoot: string,
  connectionId: string,
  schema: string,
  options: { refresh?: boolean; purpose?: ProbePurpose; intervalMs?: number } = {},
  deps: ReadLiveTablesDeps = {}
): Promise<LiveTablesResponse> {
  const purpose: ProbePurpose = options.purpose ?? "manual";
  const now = deps.now ?? Date.now;
  const readConnectionsImpl = deps.readConnectionsImpl ?? readConnections;
  // The identifier whitelist runs before anything touches the database.
  const safeSchema = assertSchemaIdent(schema);
  const fetchedAt = new Date(now()).toISOString();

  const connections = await readConnectionsImpl(projectRoot);
  const conn = connections.find((item) => item.id === connectionId);
  if (!conn) {
    throw new LiveTablesConnectionNotFoundError(connectionId);
  }

  const wireProtocol = resolveWireProtocol(conn);
  if (wireProtocol === "unknown") {
    return errorPayload(connectionId, safeSchema, "PROTOCOL_UNSUPPORTED", fetchedAt);
  }
  if (!supportsTableList(wireProtocol)) {
    return errorPayload(connectionId, safeSchema, "TABLE_LIST_UNSUPPORTED", fetchedAt);
  }

  const generation = deps.currentGeneration ? deps.currentGeneration() : 0;
  if (!options.refresh) {
    const hit = peekLiveTablesCache(
      projectRoot,
      connectionId,
      safeSchema,
      generation,
      purpose,
      now
    );
    if (hit) return hit;
  }

  const provider = deps.provider ?? createSqlLiveTableProvider({ readConnectionsImpl });
  const result = await provider.listTables({
    projectRoot,
    connectionId,
    schema: safeSchema,
    generation
  });

  if (result.status === "error") {
    return {
      status: "error",
      connectionId,
      schema: safeSchema,
      tables: [],
      fetchedAt: result.fetchedAt ?? fetchedAt,
      cached: false,
      reason: result.reason ?? "QUERY_FAILED",
      ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
      wireProtocol: result.wireProtocol
    };
  }

  const payload: LiveTablesResponse = {
    status: "ok",
    connectionId,
    schema: safeSchema,
    tables: result.tables,
    fetchedAt: result.fetchedAt,
    cached: false,
    ...(result.latencyMs !== undefined ? { latencyMs: result.latencyMs } : {}),
    wireProtocol: result.wireProtocol
  };
  // A result produced under an older connection config never enters the cache.
  if (!deps.currentGeneration || deps.currentGeneration() === generation) {
    cache.set(
      cacheKey(projectRoot, connectionId, safeSchema, generation, purpose),
      {
        expiresAt: now() + liveTablesTtlMs(purpose, options.intervalMs),
        payload,
        generation
      }
    );
  }
  return payload;
}
