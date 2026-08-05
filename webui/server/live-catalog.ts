import { readConnections } from "./project";
import { KtxCliError, runSql, type SqlResult } from "./ktx";
import type { ConnectionInfo, LiveSchemaSummary, LiveSchemasResponse } from "./model";

export const LIVE_CATALOG_TTL_MS = 10 * 60 * 1000;

const MYSQL_SYSTEM_SCHEMAS = new Set([
  "information_schema",
  "mysql",
  "performance_schema",
  "sys"
]);

const MYSQL_LIVE_SQL = `
SELECT table_schema AS schema_name, COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
GROUP BY table_schema
ORDER BY table_schema
`.trim().replace(/\s+/g, " ");

const POSTGRES_LIVE_SQL = `
SELECT n.nspname AS schema_name, COUNT(c.oid) AS table_count
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg_toast%'
  AND n.nspname NOT LIKE 'pg_temp_%'
GROUP BY n.nspname
ORDER BY n.nspname
`.trim().replace(/\s+/g, " ");

type CacheEntry = {
  expiresAt: number;
  payload: LiveSchemasResponse;
};

const cache = new Map<string, CacheEntry>();

export type ListLiveSchemasDeps = {
  readConnectionsImpl?: typeof readConnections;
  runSqlImpl?: typeof runSql;
  now?: () => number;
  ttlMs?: number;
};

function cacheKey(projectRoot: string, connId: string): string {
  return `${projectRoot}::${connId}`;
}

export function clearLiveCatalogCache(): void {
  cache.clear();
}

function resolveWireProtocol(conn: ConnectionInfo): "mysql" | "postgres" | "unknown" {
  if (conn.wireProtocol === "mysql" || conn.wireProtocol === "postgres") {
    return conn.wireProtocol;
  }
  const engine = (conn.engine ?? "").toLowerCase();
  if (engine === "starrocks" || engine === "doris" || engine.includes("mysql")) return "mysql";
  if (engine.includes("postgres")) return "postgres";
  const driver = (conn.driver ?? "").toLowerCase();
  if (driver.includes("postgres")) return "postgres";
  if (driver.includes("mysql")) return "mysql";
  return "unknown";
}

function sqlForProtocol(protocol: "mysql" | "postgres"): string {
  return protocol === "postgres" ? POSTGRES_LIVE_SQL : MYSQL_LIVE_SQL;
}

function parseRows(json: unknown): LiveSchemaSummary[] {
  if (!json || typeof json !== "object") return [];
  const rows = (json as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  const out: LiveSchemaSummary[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const schema = String(row[0] ?? "").trim();
    const tableCount = Number(row[1]);
    if (!schema || !Number.isFinite(tableCount)) continue;
    out.push({ schema, tableCount: Math.max(0, Math.floor(tableCount)) });
  }
  return out;
}

function filterSystemSchemas(
  schemas: LiveSchemaSummary[],
  protocol: "mysql" | "postgres"
): LiveSchemaSummary[] {
  if (protocol === "postgres") {
    return schemas.filter(
      (s) =>
        s.schema !== "pg_catalog" &&
        s.schema !== "information_schema" &&
        !s.schema.startsWith("pg_toast") &&
        !s.schema.startsWith("pg_temp_")
    );
  }
  return schemas.filter((s) => !MYSQL_SYSTEM_SCHEMAS.has(s.schema.toLowerCase()));
}

function errorPayload(
  connectionId: string,
  reason: string,
  wireProtocol: LiveSchemasResponse["wireProtocol"],
  fetchedAt: string
): LiveSchemasResponse {
  return {
    status: "error",
    connectionId,
    schemas: [],
    fetchedAt,
    cached: false,
    reason,
    wireProtocol
  };
}

export class LiveCatalogConnectionNotFoundError extends Error {
  code = "CONNECTION_NOT_FOUND";
  statusCode = 404;

  constructor(connId: string) {
    super(`Connection '${connId}' not found in ktx.yaml`);
    this.name = "LiveCatalogConnectionNotFoundError";
  }
}

export async function listLiveSchemas(
  projectRoot: string,
  connId: string,
  options: { refresh?: boolean } = {},
  deps: ListLiveSchemasDeps = {}
): Promise<LiveSchemasResponse> {
  const readConnectionsImpl = deps.readConnectionsImpl ?? readConnections;
  const runSqlImpl = deps.runSqlImpl ?? runSql;
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? LIVE_CATALOG_TTL_MS;
  const key = cacheKey(projectRoot, connId);
  const fetchedAt = new Date(now()).toISOString();

  if (!options.refresh) {
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now()) {
      return { ...hit.payload, cached: true };
    }
  }

  const connections = await readConnectionsImpl(projectRoot);
  const conn = connections.find((c) => c.id === connId);
  if (!conn) {
    throw new LiveCatalogConnectionNotFoundError(connId);
  }

  const wireProtocol = resolveWireProtocol(conn);
  if (wireProtocol === "unknown") {
    return errorPayload(
      connId,
      "当前连接的 wire protocol 无法识别，无法查询库内目录。",
      "unknown",
      fetchedAt
    );
  }

  let sqlResult: SqlResult;
  try {
    sqlResult = await runSqlImpl(projectRoot, connId, sqlForProtocol(wireProtocol), {
      maxRows: 2000,
      timeoutMs: 30_000
    });
  } catch (err) {
    if (err instanceof KtxCliError) {
      return errorPayload(connId, err.message, wireProtocol, fetchedAt);
    }
    throw err;
  }

  if (!sqlResult.ok) {
    const reason =
      (sqlResult.stderr || sqlResult.stdout).trim() ||
      `ktx sql failed (exit ${sqlResult.exitCode})`;
    return errorPayload(connId, reason, wireProtocol, fetchedAt);
  }

  if (sqlResult.json == null || typeof sqlResult.json !== "object") {
    return errorPayload(
      connId,
      "ktx sql 返回无法解析为 JSON，库内目录不可用。",
      wireProtocol,
      fetchedAt
    );
  }

  const schemas = filterSystemSchemas(parseRows(sqlResult.json), wireProtocol);
  const payload: LiveSchemasResponse = {
    status: "ok",
    connectionId: connId,
    schemas,
    fetchedAt,
    cached: false,
    latencyMs: sqlResult.latencyMs,
    wireProtocol
  };
  cache.set(key, { expiresAt: now() + ttlMs, payload: { ...payload, cached: false } });
  return payload;
}
