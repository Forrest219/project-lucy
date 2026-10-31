/**
 * Hive MCP bridge (execution-wave M4).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md §5 / HQ-D10–D11
 *
 * After the shared Lucy ACL admission, Hive connections divert here instead of
 * KTX `sl_query`. Non-Hive connectionIds return `not_hive` so the proxy keeps
 * the existing upstream path unchanged.
 */

import { readHiveConnections, type HiveConnection } from "./config.js";
import { runHiveExecution, type HiveExecutionResult, type HiveExecutionTool } from "./execution.js";
import {
  createSyntheticHiveJdbcWorker,
  unconfiguredHiveJdbcWorker,
  type HiveJdbcWorker,
  type SyntheticHiveTable
} from "./jdbc-worker.js";
import {
  buildHivePartitionProfile,
  type HivePartitionProfile
} from "./partition-profile.js";

export type HiveConnectionLookup =
  | { kind: "hive"; connection: HiveConnection }
  | { kind: "not_hive" }
  | { kind: "config_error"; reason: string; detail: string };

export async function lookupHiveConnection(
  projectRoot: string,
  connectionId: string
): Promise<HiveConnectionLookup> {
  const id = connectionId.trim();
  if (!id) return { kind: "not_hive" };
  const snapshot = await readHiveConnections(projectRoot);
  if (!snapshot.ok) {
    return { kind: "config_error", reason: snapshot.reason, detail: snapshot.detail };
  }
  const connection = snapshot.value.connections.find((item) => item.id === id);
  if (!connection) return { kind: "not_hive" };
  return { kind: "hive", connection };
}

export type HiveDiscoverySource = {
  connectionId: string;
  sourceName: string;
  physicalTable: string;
  partitionStatus: HivePartitionProfile["status"];
  partitionKeys: HivePartitionProfile["keys"];
};

/**
 * Build discovery payloads for authorized Hive sources (catalog / read_source meta).
 * Callers filter by ACL before returning to the Agent.
 */
export function hiveDiscoveryFromProfiles(
  connectionId: string,
  sources: Array<{ sourceName: string; physicalTable: string; partitionKeysRaw: unknown }>
): HiveDiscoverySource[] {
  const out: HiveDiscoverySource[] = [];
  for (const source of sources) {
    const built = buildHivePartitionProfile(source.partitionKeysRaw);
    const profile = built.ok ? built.profile : { status: "unknown" as const, keys: [] };
    out.push({
      connectionId,
      sourceName: source.sourceName,
      physicalTable: source.physicalTable,
      partitionStatus: profile.status,
      partitionKeys: profile.keys
    });
  }
  return out;
}

export type HiveMcpBridgeRequest = {
  tool: HiveExecutionTool;
  connectionId: string;
  /** Precompiled / fixture SQL. Production wiring supplies compile-bridge output. */
  compiledSql: string;
  profilesByPhysicalTable: Map<string, HivePartitionProfile>;
  jdbcWorker?: HiveJdbcWorker;
  deadlineMs?: number;
  maxRows?: number;
  correlationId?: string;
};

export type HiveMcpBridgeResponse =
  | {
      handled: true;
      result: HiveExecutionResult;
      /** Stable payload for MCP content[].text */
      payload: Record<string, unknown>;
    }
  | { handled: false; reason: "missing_compiled_sql" };

/**
 * Handle a Hive-routed MCP tool call after Lucy ACL admission.
 *
 * Explain never invokes JDBC. Gate failures return stable reason codes with
 * `jdbcInvokeCount: 0`.
 */
export async function handleHiveMcpTool(request: HiveMcpBridgeRequest): Promise<HiveMcpBridgeResponse> {
  const sql = request.compiledSql.trim();
  if (!sql) return { handled: false, reason: "missing_compiled_sql" };

  const worker = request.jdbcWorker ?? unconfiguredHiveJdbcWorker();
  const result = await runHiveExecution({
    tool: request.tool,
    connectionId: request.connectionId,
    compiledSql: sql,
    profilesByPhysicalTable: request.profilesByPhysicalTable,
    jdbcWorker: worker,
    deadlineMs: request.deadlineMs ?? 30_000,
    maxRows: request.maxRows ?? 1000,
    correlationId: request.correlationId
  });

  if (!result.ok) {
    return {
      handled: true,
      result,
      payload: {
        ok: false,
        reason: result.failure.reason,
        detail: result.failure.detail ?? null,
        stage: result.failure.stage,
        jdbcInvokeCount: result.failure.jdbcInvokeCount,
        upstreamMayHaveExecuted: result.failure.upstreamMayHaveExecuted,
        dialect: "hive"
      }
    };
  }

  if (result.value.explainOnly) {
    return {
      handled: true,
      result,
      payload: {
        ok: true,
        explain: true,
        gate: "passed",
        jdbcInvokeCount: 0,
        dialect: "hive",
        compiledSql: sql
      }
    };
  }

  return {
    handled: true,
    result,
    payload: {
      ok: true,
      columns: result.value.columns,
      rows: result.value.rows,
      truncated: result.value.truncated,
      canceled: result.value.canceled,
      terminalState: result.value.terminalState,
      jdbcInvokeCount: result.value.jdbcInvokeCount,
      dialect: "hive"
    }
  };
}

/** Module-test helper: synthetic HS2 with two partition tables + one unpartitioned. */
export function createModuleHiveFixture(): {
  profiles: Map<string, HivePartitionProfile>;
  worker: HiveJdbcWorker;
  tables: Map<string, SyntheticHiveTable>;
} {
  const profiles = new Map<string, HivePartitionProfile>();
  profiles.set("sales.orders_part", {
    status: "partitioned",
    keys: [
      { name: "dt", position: 0, type: "string" },
      { name: "region", position: 1, type: "string" }
    ]
  });
  profiles.set("sales.dim_region", {
    status: "unpartitioned",
    keys: []
  });

  const tables = new Map<string, SyntheticHiveTable>();
  tables.set("sales.orders_part", {
    columns: [
      { name: "dt", type: "string" },
      { name: "region", type: "string" },
      { name: "amount", type: "decimal" },
      { name: "order_id", type: "bigint" }
    ],
    rows: [
      { dt: "2024-01-01", region: "east", amount: "100.50", order_id: "9000000000000000001" },
      { dt: "2024-01-01", region: "west", amount: "200.25", order_id: "9000000000000000002" },
      { dt: "2024-01-02", region: "east", amount: "50.00", order_id: "9000000000000000003" },
      { dt: "2024-01-02", region: "west", amount: "75.75", order_id: "9000000000000000004" }
    ]
  });
  tables.set("sales.dim_region", {
    columns: [
      { name: "region", type: "string" },
      { name: "name", type: "string" }
    ],
    rows: [
      { region: "east", name: "East" },
      { region: "west", name: "West" }
    ]
  });

  return {
    profiles,
    tables,
    worker: createSyntheticHiveJdbcWorker(tables)
  };
}

/**
 * Resolve whether a tools/call should divert to the Hive bridge.
 * Used by mcp-proxy as the single hook point after ACL.
 */
export async function resolveHiveMcpRoute(
  projectRoot: string,
  connectionId: string | null | undefined
): Promise<
  | { route: "ktx" }
  | { route: "hive"; connection: HiveConnection }
  | { route: "error"; reason: string; detail: string }
> {
  if (!connectionId || !connectionId.trim()) return { route: "ktx" };
  const lookup = await lookupHiveConnection(projectRoot, connectionId);
  if (lookup.kind === "not_hive") return { route: "ktx" };
  if (lookup.kind === "config_error") {
    return { route: "error", reason: lookup.reason, detail: lookup.detail };
  }
  return { route: "hive", connection: lookup.connection };
}
