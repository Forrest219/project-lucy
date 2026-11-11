import { stringify } from "yaml";
import { catalogTablesSql, CATALOG_SCAN_TIMEOUT_MS, CATALOG_TABLE_NAME_LIMIT, describeCatalogTableSql, quoteMysqlIdent, splitCatalogDatabase } from "./catalog-database";
import { runCatalogShow } from "./catalog-show";
import { readConnections } from "./project";
import { runSql, type SqlResult } from "./ktx";
import type { ConnectionInfo } from "./model";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

const NUMBER_TYPES = new Set([
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "mediumint",
  "decimal",
  "numeric",
  "float",
  "double",
  "double precision",
  "real",
  "number"
]);

const TIME_TYPES = new Set([
  "date",
  "datetime",
  "timestamp",
  "time",
  "timestamptz",
  "timestamp without time zone",
  "timestamp with time zone"
]);

const STRING_TYPES = new Set([
  "char",
  "varchar",
  "character",
  "character varying",
  "text",
  "string",
  "enum",
  "boolean",
  "bool",
  "json",
  "jsonb",
  "uuid",
  "bit",
  "binary",
  "varbinary",
  "blob",
  "clob"
]);

export type SchemaStructureColumn = {
  table: string;
  column: string;
  rawType: string;
};

/** One physical column of a Schema, as the database reports it. */
export type SchemaColumnRow = {
  table: string;
  column: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  comment: string;
};

/**
 * Result of a column read. The three shapes let the caller map the outcome
 * onto its own vocabulary — Spec 190 needs `TABLE_LIST_TOO_LARGE` where Spec
 * 164 reports a plain read failure.
 */
export type SchemaColumnRejection = {
  table: string;
  reason: "empty" | "ambiguous";
};

export type SchemaColumnsRead =
  | {
      status: "ok";
      columns: SchemaColumnRow[];
      tables?: string[];
      /** Requested tables that must not be written with an empty or mixed column list. */
      rejections?: SchemaColumnRejection[];
    }
  | { status: "too_large" }
  | {
      status: "error";
      message: string;
      detail?: {
        connectionId?: string | null;
        schema?: string | null;
        table?: string | null;
        phase?: string | null;
      };
    };

export type SchemaStructurePreview = {
  schema: string;
  readable: boolean;
  yaml: string;
  tableCount: number;
  columnCount: number;
  /** True when this response lists table names and has not read their columns. */
  namesOnly: boolean;
  mapped: { number: number; string: number; time: number };
  downgraded: SchemaStructureColumn[];
};

/** `ktx sql --max-rows` accepts 1–10000. A full page is treated as truncated. */
const SCHEMA_STRUCTURE_MAX_ROWS = 10_000;
/** One checked table is read at a time, and one read stops at this many column rows. */
const COLUMN_READ_ROW_LIMIT = 2_000;

export class SchemaStructureError extends Error {
  code: "CONNECTION_NOT_FOUND" | "SCHEMA_UNSUPPORTED" | "INVALID_SCHEMA" | "READ_FAILED";
  statusCode: number;
  detail?: unknown;

  constructor(
    code: SchemaStructureError["code"],
    message: string,
    statusCode = 400,
    detail?: unknown
  ) {
    super(message);
    this.name = "SchemaStructureError";
    this.code = code;
    this.statusCode = statusCode;
    if (detail !== undefined) this.detail = detail;
  }
}

export function assertSchemaIdent(schema: string): string {
  const trimmed = schema.trim();
  if (!IDENT.test(trimmed)) {
    throw new SchemaStructureError("INVALID_SCHEMA", "Schema 名只能包含字母、数字和下划线，且不能以数字开头");
  }
  return trimmed;
}

export function mapColumnType(raw: string): { type: "number" | "string" | "time"; downgraded: boolean } {
  const normalized = raw.toLowerCase().replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
  if (NUMBER_TYPES.has(normalized)) return { type: "number", downgraded: false };
  if (TIME_TYPES.has(normalized)) return { type: "time", downgraded: false };
  if (STRING_TYPES.has(normalized)) return { type: "string", downgraded: false };
  return { type: "string", downgraded: true };
}

type ColumnInput = {
  table: string;
  column: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  comment: string;
};

export function buildMinimalSchemaManifest(
  schema: string,
  columns: ColumnInput[],
  ensureTables: string[] = []
): SchemaStructurePreview {
  const tables: Record<string, { table: string; columns: Array<Record<string, unknown>> }> = {};
  const mapped = { number: 0, string: 0, time: 0 };
  const downgraded: SchemaStructureColumn[] = [];
  for (const column of columns) {
    const mappedType = mapColumnType(column.dataType);
    mapped[mappedType.type] += 1;
    if (mappedType.downgraded) {
      downgraded.push({ table: column.table, column: column.column, rawType: column.dataType });
    }
    const entry = tables[column.table] ?? {
      table: `${schema}.${column.table}`,
      columns: []
    };
    const spec: Record<string, unknown> = {
      name: column.column,
      type: mappedType.type,
      nullable: column.nullable
    };
    if (column.primaryKey) spec.pk = true;
    if (column.comment.trim()) spec.descriptions = { db: column.comment.trim() };
    entry.columns.push(spec);
    tables[column.table] = entry;
  }
  // External catalogs may list tables while every column probe is rejected.
  // Keep those names in the manifest so "启用表范围" can still select them.
  for (const name of ensureTables) {
    if (!name || tables[name]) continue;
    tables[name] = { table: `${schema}.${name}`, columns: [] };
  }
  const yaml = stringify({ tables });
  return {
    schema,
    readable: true,
    yaml,
    tableCount: Object.keys(tables).length,
    columnCount: columns.length,
    namesOnly: false,
    mapped,
    downgraded
  };
}

function canRead(connection: ConnectionInfo): boolean {
  const protocol = (connection.wireProtocol ?? "").toLowerCase();
  if (protocol === "mysql" || protocol === "postgres") return true;
  const engine = (connection.engine ?? "").toLowerCase();
  if (engine === "starrocks" || engine === "doris" || engine.includes("postgres")) return true;
  const driver = (connection.driver ?? "").toLowerCase();
  return driver === "mysql" || driver === "postgres";
}

function protocolOf(connection: ConnectionInfo): "mysql" | "postgres" {
  const protocol = (connection.wireProtocol ?? "").toLowerCase();
  if (protocol === "postgres" || (connection.driver ?? "").toLowerCase() === "postgres") return "postgres";
  if ((connection.engine ?? "").toLowerCase().includes("postgres")) return "postgres";
  return "mysql";
}

function sqlFor(protocol: "mysql" | "postgres", schema: string): string {
  if (protocol === "postgres") {
    return `
SELECT c.relname, a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod),
  CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint pk
    WHERE pk.conrelid = c.oid AND pk.contype = 'p' AND a.attnum = ANY (pk.conkey)
  ) THEN 'PRI' ELSE '' END,
  COALESCE(col_description(a.attrelid, a.attnum), '')
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = '${schema}'
  AND c.relkind IN ('r', 'p')
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY c.relname, a.attnum
`.trim().replace(/\s+/g, " ");
  }
  return `
SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_key, c.column_comment
FROM information_schema.columns c
JOIN information_schema.tables t
  ON t.table_schema = c.table_schema AND t.table_name = c.table_name
WHERE c.table_schema = '${schema}' AND t.table_type = 'BASE TABLE'
ORDER BY c.table_name, c.ordinal_position
`.trim().replace(/\s+/g, " ");
}

/**
 * A schema-wide column scan that used up its deadline should be retried in
 * smaller pieces. Connection failures stay out of this bucket: "connect timed
 * out" is not a slow metadata scan.
 */
export function columnScanTimedOut(result: SqlResult, timeoutMs = CATALOG_SCAN_TIMEOUT_MS): boolean {
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/can't connect|cannot connect|connection refused|connection timed out|connect timed out|unknown host|no such host/i.test(text)) {
    return false;
  }
  if (/max_execution_time|maximum statement execution time|query execution was interrupted/i.test(text)) {
    return true;
  }
  return !result.ok && result.latencyMs >= Math.max(0, timeoutMs - 1_500);
}

/** Truncate noisy SQL / driver text for container logs (upgrade / field triage). */
function clipLogText(value: string | undefined | null, max = 500): string {
  const text = (value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

type SchemaStructureLogContext = {
  connectionId?: string;
  schema?: string;
  table?: string;
  phase?: string;
  sql?: string;
};

/**
 * Keep a short, readable sentence on the WebUI; put the rejected SQL and driver
 * text in container logs for upgrades when the customer build still fails.
 */
export function logSchemaStructureFailure(
  context: SchemaStructureLogContext,
  result?: Pick<SqlResult, "ok" | "exitCode" | "stderr" | "stdout" | "latencyMs">
): void {
  console.error("[schema-structure] read failed", {
    connectionId: context.connectionId ?? null,
    schema: context.schema ?? null,
    table: context.table ?? null,
    phase: context.phase ?? null,
    sql: clipLogText(context.sql, 300) || null,
    ok: result?.ok ?? null,
    exitCode: result?.exitCode ?? null,
    latencyMs: result?.latencyMs ?? null,
    stderr: clipLogText(result?.stderr, 500) || null,
    stdout: clipLogText(result?.stdout, 300) || null
  });
}

function describeSchemaStructurePhase(
  phase: string | undefined,
  schema?: string,
  table?: string
): string {
  const schemaLabel = schema ? `「${schema}」` : "";
  const tableLabel = table ? `「${table}」` : "";
  switch (phase) {
    case "catalog-list-tables":
    case "mysql-name-list":
      return `无法列出 Schema${schemaLabel}下的表`;
    case "catalog-columns":
      return `无法读取表${tableLabel}的字段`;
    case "schema-wide-columns":
      return `无法一次读取 Schema${schemaLabel}的字段`;
    case "table-columns":
      return `无法读取表${tableLabel}的字段`;
    case "mysql-wide-fallback-list-tables":
      return `无法列出 Schema${schemaLabel}下的表`;
    case "mysql-wide-fallback-columns":
      return `无法读取表${tableLabel}的字段`;
    default:
      return schemaLabel ? `读取 Schema${schemaLabel}时出错` : "读取时出错";
  }
}

/** User-visible READ_FAILED copy: phase only. SQL / driver text stay in logs. */
export function formatSchemaStructureUserMessage(context: SchemaStructureLogContext): string {
  const action = describeSchemaStructurePhase(context.phase, context.schema, context.table);
  return `读取表结构失败：${action}。`;
}

function safeStructureDetail(context: SchemaStructureLogContext): {
  connectionId: string | null;
  schema: string | null;
  table: string | null;
  phase: string | null;
} {
  return {
    connectionId: context.connectionId ?? null,
    schema: context.schema ?? null,
    table: context.table ?? null,
    phase: context.phase ?? null
  };
}

function structureRows(result: SqlResult, context: SchemaStructureLogContext = {}): unknown[] {
  const json = result.json;
  const rows =
    json && typeof json === "object" && Array.isArray((json as { rows?: unknown }).rows)
      ? (json as { rows: unknown[] }).rows
      : null;
  if (!result.ok || rows === null) {
    const meta = { ...context, sql: context.sql ?? result.command, phase: context.phase ?? "sql" };
    logSchemaStructureFailure(meta, result);
    throw new SchemaStructureError(
      "READ_FAILED",
      formatSchemaStructureUserMessage(meta),
      400,
      safeStructureDetail(meta)
    );
  }
  if (rows.length >= (
    context.phase === "table-columns"
      ? COLUMN_READ_ROW_LIMIT
      : context.phase === "catalog-list-tables"
        ? CATALOG_TABLE_NAME_LIMIT
        : SCHEMA_STRUCTURE_MAX_ROWS
  )) {
    const noun = context.phase === "catalog-list-tables" || context.phase === "mysql-name-list"
      ? "表数"
      : "字段数";
    throw new SchemaStructureError("READ_FAILED", `这个 Schema 的${noun}超过一次可读取的上限。`);
  }
  return rows;
}

async function readCatalogTableColumns(
  projectRoot: string,
  connectionId: string,
  catalog: string,
  schema: string,
  table: string,
  execute: typeof runSql
): Promise<{ columns: ColumnInput[]; failure: string }> {
  const described = await execute(projectRoot, connectionId, describeCatalogTableSql(catalog, schema, table), {
    maxRows: COLUMN_READ_ROW_LIMIT,
    timeoutMs: CATALOG_SCAN_TIMEOUT_MS
  });
  const raw = resultRows(described);
  if (raw && raw.length >= COLUMN_READ_ROW_LIMIT) {
    return { columns: [], failure: "读取表结构失败：这张表的字段数超过一次可读取的上限。" };
  }
  const columns = mapDescribeColumns(table, optionalRows(described));
  return { columns, failure: columns.length > 0 ? "" : readFailureMessage(described) };
}

function resultRows(result: SqlResult): unknown[] | null {
  const json = result.json;
  if (!result.ok || !json || typeof json !== "object" || !Array.isArray((json as { rows?: unknown }).rows)) {
    return null;
  }
  return (json as { rows: unknown[] }).rows;
}

function readFailureMessage(result: SqlResult): string {
  const driver = [result.stderr, result.stdout].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  const clipped = driver.length > 240 ? `${driver.slice(0, 240)}…` : driver;
  return clipped ? `读取表结构失败：${clipped}` : "读取表结构失败。";
}

function optionalRows(result: SqlResult): unknown[] | null {
  const rows = resultRows(result);
  if (!rows || rows.length === 0 || rows.length >= SCHEMA_STRUCTURE_MAX_ROWS) return null;
  return rows;
}

function mapDescribeColumn(table: string, row: unknown[]): ColumnInput | null {
  if (!Array.isArray(row) || row.length < 4) return null;
  const column = String(row[0] ?? "").trim();
  if (!column || column.length > 256 || /[\0\r\n]/.test(column)) return null;
  return {
    table,
    column,
    dataType: String(row[1] ?? ""),
    nullable: String(row[2] ?? "YES").toUpperCase() !== "NO",
    primaryKey: String(row[3] ?? "").toUpperCase() === "PRI",
    comment: ""
  };
}

function mapDescribeColumns(table: string, rows: unknown[] | null): ColumnInput[] {
  if (!rows) return [];
  const columns: ColumnInput[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const mapped = mapDescribeColumn(table, row);
    if (mapped) columns.push(mapped);
  }
  return columns;
}

function parseColumns(rows: unknown[]): ColumnInput[] {
  const columns: ColumnInput[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 6) continue;
    const table = String(row[0] ?? "").trim();
    const column = String(row[1] ?? "").trim();
    if (!table || !column) continue;
    columns.push({
      table,
      column,
      dataType: String(row[2] ?? ""),
      nullable: String(row[3] ?? "").toUpperCase() !== "NO",
      primaryKey: String(row[4] ?? "").toUpperCase() === "PRI",
      comment: String(row[5] ?? "")
    });
  }
  return columns;
}

function sqlStringLiteral(value: string): string {
  if (!value || value.length > 256 || /[\0\r\n]/.test(value)) {
    throw new SchemaStructureError("READ_FAILED", "读取表结构失败。");
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function mysqlTableNamesSql(schema: string): string {
  return `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlStringLiteral(schema)} AND table_type = 'BASE TABLE' ORDER BY table_name`;
}

function mysqlMatchingTablesSql(schema: string, table: string): string {
  return `SELECT table_name FROM information_schema.tables WHERE table_schema = ${sqlStringLiteral(schema)} AND table_type = 'BASE TABLE' AND LOWER(table_name) = ${sqlStringLiteral(table.toLowerCase())}`;
}

function mysqlOneTableColumnsSql(schema: string, physicalTable: string): string {
  return `SELECT column_name, data_type, is_nullable, column_key, column_comment FROM information_schema.columns WHERE table_schema = ${sqlStringLiteral(schema)} AND table_name = ${sqlStringLiteral(physicalTable)} ORDER BY ordinal_position`;
}

function namesFromRows(rows: unknown[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    const name = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
    if (!name) continue;
    names.push(name);
  }
  return names;
}

function columnsForOneTable(table: string, rows: unknown[]): ColumnInput[] {
  const columns: ColumnInput[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const column = String(row[0] ?? "").trim();
    if (!column) continue;
    columns.push({
      table,
      column,
      dataType: String(row[1] ?? ""),
      nullable: String(row[2] ?? "").toUpperCase() !== "NO",
      primaryKey: String(row[3] ?? "").toUpperCase() === "PRI",
      comment: String(row[4] ?? "")
    });
  }
  return columns;
}

function distinctPhysicalNames(rows: unknown[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Resolve one requested MySQL table to a single physical table, then read its columns.
 * `LOWER(table_name)` only chooses that table. Two physical tables that differ only by
 * case, or a table with no columns, are rejected instead of written into a Manifest.
 */
async function readMysqlTableColumns(
  projectRoot: string,
  connectionId: string,
  schema: string,
  table: string,
  execute: typeof runSql
): Promise<{ status: "ok" | "too_large"; columns: ColumnInput[]; rejection?: SchemaColumnRejection }> {
  const matchSql = mysqlMatchingTablesSql(schema, table);
  const matched = await execute(projectRoot, connectionId, matchSql, {
    maxRows: 10,
    timeoutMs: CATALOG_SCAN_TIMEOUT_MS
  });
  const physical = distinctPhysicalNames(structureRows(matched, {
    connectionId,
    schema,
    table,
    phase: "table-name-match",
    sql: matchSql
  }));
  if (physical.length > 1) {
    return { status: "ok", columns: [], rejection: { table, reason: "ambiguous" } };
  }
  if (physical.length === 0) {
    return { status: "ok", columns: [], rejection: { table, reason: "empty" } };
  }
  const columnSql = mysqlOneTableColumnsSql(schema, physical[0]);
  const result = await execute(projectRoot, connectionId, columnSql, {
    maxRows: COLUMN_READ_ROW_LIMIT,
    timeoutMs: CATALOG_SCAN_TIMEOUT_MS
  });
  const rows = structureRows(result, {
    connectionId,
    schema,
    table,
    phase: "table-columns",
    sql: columnSql
  });
  const columns = columnsForOneTable(table, rows);
  if (columns.length === 0) {
    return { status: "ok", columns: [], rejection: { table, reason: "empty" } };
  }
  return { status: "ok", columns };
}

/**
 * Read table names, or the columns of the requested tables.
 *
 * A call without `tables` lists names and does not read columns. A call with
 * `tables` reads those tables one at a time. One column read stops at 2000 rows.
 */
export async function readSchemaColumns(
  projectRoot: string,
  connectionId: string,
  schema: string,
  deps: {
    readConnectionsImpl?: typeof readConnections;
    runSqlImpl?: typeof runSql;
    runCatalogShowImpl?: typeof runCatalogShow;
    tables?: string[];
  } = {}
): Promise<SchemaColumnsRead> {
  const safeSchema = assertSchemaIdent(schema);
  const read = deps.readConnectionsImpl ?? readConnections;
  const connections = await read(projectRoot);
  const connection = connections.find((item) => item.id === connectionId);
  if (!connection) {
    throw new SchemaStructureError("CONNECTION_NOT_FOUND", `未找到连接 ${connectionId}`, 404);
  }
  if (!canRead(connection)) {
    throw new SchemaStructureError("SCHEMA_UNSUPPORTED", "当前数据库类型请上传 Schema Manifest");
  }
  const execute = deps.runSqlImpl ?? runSql;
  const catalog = protocolOf(connection) === "mysql" ? splitCatalogDatabase(connection.database) : null;
  const requested = deps.tables?.map((table) => table.trim()).filter(Boolean);
  try {
    if (catalog) {
      if (!requested) {
        const tableSql = catalogTablesSql(catalog.catalog, safeSchema);
        const tablesResult = await (deps.runCatalogShowImpl ?? runCatalogShow)(
          projectRoot,
          connectionId,
          tableSql,
          { maxRows: CATALOG_TABLE_NAME_LIMIT, timeoutMs: CATALOG_SCAN_TIMEOUT_MS }
        );
        const tableNames = namesFromRows(structureRows(tablesResult, {
          connectionId,
          schema: safeSchema,
          phase: "catalog-list-tables",
          sql: tableSql
        })).filter((name) => {
          try {
            quoteMysqlIdent(name);
            return true;
          } catch {
            return false;
          }
        });
        if (tableNames.length >= CATALOG_TABLE_NAME_LIMIT) return { status: "too_large" };
        return { status: "ok", columns: [], tables: tableNames };
      }
      const columns: ColumnInput[] = [];
      let failure = "";
      for (const table of requested) {
        const read = await readCatalogTableColumns(
          projectRoot,
          connectionId,
          catalog.catalog,
          safeSchema,
          table,
          execute
        );
        if (read.columns.length === 0 && read.failure) failure = read.failure;
        columns.push(...read.columns);
      }
      if (requested.length > 0 && columns.length === 0) {
        return { status: "error", message: failure || "读取表结构失败。" };
      }
      return { status: "ok", columns };
    }
    const protocol = protocolOf(connection);
    if (protocol === "mysql" && !requested) {
      const listSql = mysqlTableNamesSql(safeSchema);
      const listed = await execute(projectRoot, connectionId, listSql, {
        maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
        timeoutMs: CATALOG_SCAN_TIMEOUT_MS
      });
      const tableNames = namesFromRows(structureRows(listed, {
        connectionId,
        schema: safeSchema,
        phase: "catalog-list-tables",
        sql: listSql
      }));
      if (tableNames.length >= SCHEMA_STRUCTURE_MAX_ROWS) return { status: "too_large" };
      return { status: "ok", columns: [], tables: tableNames };
    }
    if (protocol === "mysql" && requested) {
      const columns: ColumnInput[] = [];
      const rejections: SchemaColumnRejection[] = [];
      for (const table of requested) {
        const read = await readMysqlTableColumns(
          projectRoot,
          connectionId,
          safeSchema,
          table,
          execute
        );
        if (read.status === "too_large") return { status: "too_large" };
        if (read.rejection) rejections.push(read.rejection);
        columns.push(...read.columns);
      }
      const rejected = new Set(rejections.map((item) => item.table));
      return {
        status: "ok",
        columns,
        tables: requested.filter((table) => !rejected.has(table)),
        ...(rejections.length > 0 ? { rejections } : {})
      };
    }
    const listSql = sqlFor(protocol, safeSchema);
    const result = await execute(projectRoot, connectionId, listSql, {
      maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
      timeoutMs: CATALOG_SCAN_TIMEOUT_MS
    });
    const rows = structureRows(result, {
      connectionId,
      schema: safeSchema,
      phase: "schema-wide-columns",
      sql: listSql
    });
    if (rows.length >= SCHEMA_STRUCTURE_MAX_ROWS) {
      return { status: "too_large" };
    }
    const columns = parseColumns(rows);
    if (requested) {
      const wanted = new Set(requested.map((table) => table.toLowerCase()));
      return {
        status: "ok",
        columns: columns.filter((column) => wanted.has(column.table.toLowerCase()))
      };
    }
    return { status: "ok", columns };
  } catch (error) {
    if (error instanceof SchemaStructureError) {
      if (error.message.includes("超过一次可读取的上限")) {
        return { status: "too_large" };
      }
      const detail =
        error.detail && typeof error.detail === "object"
          ? (error.detail as {
              connectionId?: string | null;
              schema?: string | null;
              table?: string | null;
              phase?: string | null;
            })
          : undefined;
      return { status: "error", message: error.message, ...(detail ? { detail } : {}) };
    }
    console.error("[schema-structure] unexpected read failure", {
      connectionId,
      schema: safeSchema,
      detail: error instanceof Error ? error.message : String(error)
    });
    return { status: "error", message: "读取表结构失败。" };
  }
}

export async function previewSchemaStructure(
  projectRoot: string,
  connectionId: string,
  schema: string,
  deps: {
    readConnectionsImpl?: typeof readConnections;
    runSqlImpl?: typeof runSql;
    runCatalogShowImpl?: typeof runCatalogShow;
    tables?: string[];
  } = {}
): Promise<SchemaStructurePreview> {
  const safeSchema = assertSchemaIdent(schema);
  const read = await readSchemaColumns(projectRoot, connectionId, schema, deps);
  if (read.status === "too_large") {
    throw new SchemaStructureError("READ_FAILED", "这次读取超过一次可读取的上限。");
  }
  if (read.status === "error") {
    throw new SchemaStructureError("READ_FAILED", read.message, 400, read.detail);
  }
  const requested = deps.tables?.map((table) => table.trim()).filter(Boolean) ?? [];
  if (requested.length > 0 && (read.rejections?.length ?? 0) > 0) {
    const rejection = read.rejections?.[0];
    throw new SchemaStructureError(
      "READ_FAILED",
      rejection?.reason === "ambiguous"
        ? `表名「${rejection.table}」对应多张表，无法读取字段。`
        : `表「${rejection?.table ?? requested[0]}」没有读到字段。`
    );
  }
  const preview = buildMinimalSchemaManifest(safeSchema, read.columns, read.tables ?? []);
  const namesOnly = requested.length === 0 && read.columns.length === 0 && (read.tables?.length ?? 0) > 0;
  return { ...preview, namesOnly };
}
