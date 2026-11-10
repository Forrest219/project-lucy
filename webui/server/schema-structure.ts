import { stringify } from "yaml";
import { quoteMysqlIdent, showFullColumnsSql, showTablesFromCatalogSql, splitCatalogDatabase } from "./catalog-database";
import { readConnections } from "./project";
import { runSql, type SqlResult } from "./ktx";
import type { ConnectionInfo } from "./model";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CATALOG_STRUCTURE_MAX_TABLES = 200;

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
export type SchemaColumnsRead =
  | { status: "ok"; columns: SchemaColumnRow[] }
  | { status: "too_large" }
  | { status: "error"; message: string };

export type SchemaStructurePreview = {
  schema: string;
  readable: boolean;
  yaml: string;
  tableCount: number;
  columnCount: number;
  mapped: { number: number; string: number; time: number };
  downgraded: SchemaStructureColumn[];
};

/** `ktx sql --max-rows` accepts 1–10000. A full page is treated as truncated. */
const SCHEMA_STRUCTURE_MAX_ROWS = 10_000;

export class SchemaStructureError extends Error {
  code: "CONNECTION_NOT_FOUND" | "SCHEMA_UNSUPPORTED" | "INVALID_SCHEMA" | "READ_FAILED";
  statusCode: number;

  constructor(code: SchemaStructureError["code"], message: string, statusCode = 400) {
    super(message);
    this.name = "SchemaStructureError";
    this.code = code;
    this.statusCode = statusCode;
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

export function buildMinimalSchemaManifest(schema: string, columns: ColumnInput[]): SchemaStructurePreview {
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
  const yaml = stringify({ tables });
  return {
    schema,
    readable: true,
    yaml,
    tableCount: Object.keys(tables).length,
    columnCount: columns.length,
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
export function columnScanTimedOut(result: SqlResult, timeoutMs = 30_000): boolean {
  const text = `${result.stderr ?? ""}\n${result.stdout ?? ""}`;
  if (/can't connect|cannot connect|connection refused|connection timed out|connect timed out|unknown host|no such host/i.test(text)) {
    return false;
  }
  if (/max_execution_time|maximum statement execution time|query execution was interrupted/i.test(text)) {
    return true;
  }
  return !result.ok && result.latencyMs >= Math.max(0, timeoutMs - 1_500);
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

function mysqlTableColumnsSql(schema: string, table: string): string {
  return `SELECT column_name, data_type, is_nullable, column_key, column_comment FROM information_schema.columns WHERE table_schema = ${sqlStringLiteral(schema)} AND table_name = ${sqlStringLiteral(table)} ORDER BY ordinal_position`;
}

function tableNamesFromRows(rows: unknown[]): string[] {
  const names: string[] = [];
  for (const row of rows) {
    const name = Array.isArray(row) ? String(row[0] ?? "").trim() : "";
    if (name) names.push(name);
  }
  return names;
}

function columnsForTable(table: string, rows: unknown[]): ColumnInput[] {
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

/**
 * Wide schemas (advertising reports) cannot return every column in one 30s
 * information_schema scan. Read the table names, then one table at a time.
 * Each table still has its own 30s deadline. A single table that fills the
 * row cap is truncated and rejected; the schema total is not capped at that
 * page size.
 */
async function readMysqlColumnsByTable(
  projectRoot: string,
  connectionId: string,
  schema: string,
  execute: typeof runSql
): Promise<SchemaColumnsRead> {
  const listed = await execute(projectRoot, connectionId, mysqlTableNamesSql(schema), {
    maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
    timeoutMs: 30_000
  });
  const tableNames = tableNamesFromRows(structureRows(listed));
  const columns: ColumnInput[] = [];
  for (const table of tableNames) {
    const result = await execute(projectRoot, connectionId, mysqlTableColumnsSql(schema, table), {
      maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
      timeoutMs: 30_000
    });
    const rows = structureRows(result);
    if (rows.length >= SCHEMA_STRUCTURE_MAX_ROWS) return { status: "too_large" };
    columns.push(...columnsForTable(table, rows));
  }
  return { status: "ok", columns };
}

function structureRows(result: SqlResult): unknown[] {
  const json = result.json;
  const rows =
    json && typeof json === "object" && Array.isArray((json as { rows?: unknown }).rows)
      ? (json as { rows: unknown[] }).rows
      : null;
  if (!result.ok || rows === null) {
    throw new SchemaStructureError("READ_FAILED", "读取表结构失败。");
  }
  if (rows.length >= SCHEMA_STRUCTURE_MAX_ROWS) {
    throw new SchemaStructureError("READ_FAILED", "这个 Schema 的字段数超过一次可读取的上限。");
  }
  return rows;
}

function mapShowFullColumn(table: string, row: unknown[]): ColumnInput | null {
  if (!Array.isArray(row) || row.length < 4) return null;
  const column = String(row[0] ?? "").trim();
  if (!column || column.length > 256 || /[\0\r\n]/.test(column)) return null;
  const comment = row.length >= 9 ? String(row[8] ?? "") : "";
  return {
    table,
    column,
    dataType: String(row[1] ?? ""),
    nullable: String(row[3] ?? "YES").toUpperCase() !== "NO",
    primaryKey: String(row[4] ?? "").toUpperCase() === "PRI",
    comment
  };
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

/**
 * Read the column rows of one Schema.
 *
 * The query shape is the one Spec 164 established; Spec 190 §7.4 reuses it for
 * the on-demand column-level deep check. A full page means the answer may be
 * truncated, so it is reported as `too_large` instead of a partial list.
 */
export async function readSchemaColumns(
  projectRoot: string,
  connectionId: string,
  schema: string,
  deps: {
    readConnectionsImpl?: typeof readConnections;
    runSqlImpl?: typeof runSql;
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
  try {
    if (catalog) {
      const tablesResult = await execute(
        projectRoot,
        connectionId,
        showTablesFromCatalogSql(catalog.catalog, safeSchema),
        { maxRows: SCHEMA_STRUCTURE_MAX_ROWS, timeoutMs: 30000 }
      );
      const tableNames = structureRows(tablesResult)
        .map((row) => (Array.isArray(row) ? String(row[0] ?? "").trim() : ""))
        .filter((name) => {
          try {
            quoteMysqlIdent(name);
            return true;
          } catch {
            return false;
          }
        });
      if (tableNames.length > CATALOG_STRUCTURE_MAX_TABLES) {
        return { status: "too_large" };
      }
      const columns: ColumnInput[] = [];
      for (const table of tableNames) {
        const columnResult = await execute(projectRoot, connectionId, showFullColumnsSql(catalog.catalog, safeSchema, table), {
          maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
          timeoutMs: 30000
        });
        const columnRows = structureRows(columnResult);
        if (columnRows.length >= SCHEMA_STRUCTURE_MAX_ROWS) return { status: "too_large" };
        for (const row of columnRows) {
          if (!Array.isArray(row)) continue;
          const mapped = mapShowFullColumn(table, row);
          if (mapped) columns.push(mapped);
        }
      }
      return { status: "ok", columns };
    }
    const protocol = protocolOf(connection);
    const result = await execute(projectRoot, connectionId, sqlFor(protocol, safeSchema), {
      maxRows: SCHEMA_STRUCTURE_MAX_ROWS,
      timeoutMs: 30000
    });
    if (protocol === "mysql" && columnScanTimedOut(result)) {
      return await readMysqlColumnsByTable(projectRoot, connectionId, safeSchema, execute);
    }
    const rows = structureRows(result);
    if (rows.length >= SCHEMA_STRUCTURE_MAX_ROWS) {
      return { status: "too_large" };
    }
    return { status: "ok", columns: parseColumns(rows) };
  } catch (error) {
    if (error instanceof SchemaStructureError) {
      if (error.message.includes("超过一次可读取的上限")) {
        return { status: "too_large" };
      }
      return { status: "error", message: error.message };
    }
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
  } = {}
): Promise<SchemaStructurePreview> {
  const safeSchema = assertSchemaIdent(schema);
  const read = await readSchemaColumns(projectRoot, connectionId, schema, deps);
  if (read.status === "too_large") {
    throw new SchemaStructureError("READ_FAILED", "这个 Schema 的字段数超过一次可读取的上限。");
  }
  if (read.status === "error") {
    throw new SchemaStructureError("READ_FAILED", read.message);
  }
  return buildMinimalSchemaManifest(safeSchema, read.columns);
}
