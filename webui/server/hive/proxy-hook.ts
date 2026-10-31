/**
 * Single mcp-proxy hook surface for Hive diversion (execution-wave M4).
 *
 * Authority: docs/specs/lucy-20261030-hive-query-execution-spec.md HQ-D10 / HQ-12
 *
 * After Lucy ACL admission, the proxy asks `resolveHiveToolRoute`. Hive
 * connections never fall through to KTX `sl_query`. Execution context
 * (compiled SQL + partition profiles + worker) is injected by tests or by a
 * future production wiring; missing context fails closed.
 */

import type { HiveConnection } from "./config.js";
import { handleHiveMcpTool, resolveHiveMcpRoute, type HiveMcpBridgeResponse } from "./mcp-bridge.js";
import type { HiveExecutionTool } from "./execution.js";
import type { HiveJdbcWorker } from "./jdbc-worker.js";
import type { HivePartitionProfile } from "./partition-profile.js";

export type HiveProxyExecutionContext = {
  compiledSqlForCall: (input: {
    tool: HiveExecutionTool;
    connectionId: string;
    args: Record<string, unknown>;
  }) => Promise<
    | { ok: true; sql: string; profilesByPhysicalTable: Map<string, HivePartitionProfile> }
    | { ok: false; reason: string; detail: string }
  >;
  jdbcWorker: HiveJdbcWorker;
  deadlineMs?: number;
  maxRows?: number;
};

let registeredContext: HiveProxyExecutionContext | null = null;

/** Test / demo: register the execution context the proxy hook will use. */
export function registerHiveProxyExecutionContext(context: HiveProxyExecutionContext | null): void {
  registeredContext = context;
}

export function getHiveProxyExecutionContext(): HiveProxyExecutionContext | null {
  return registeredContext;
}

export type HiveProxyRouteDecision =
  | { action: "passthrough_ktx" }
  | {
      action: "serve_hive";
      connection: HiveConnection;
      response: HiveMcpBridgeResponse | { handled: true; result: null; payload: Record<string, unknown> };
    }
  | { action: "error"; reason: string; detail: string };

/**
 * Decide and optionally execute the Hive path for a tools/call.
 *
 * Returns `passthrough_ktx` when the connection is not Hive — caller must not
 * change behaviour. Any Hive connection returns `serve_hive` or `error` and
 * must not be forwarded upstream.
 */
export async function resolveAndMaybeServeHiveTool(input: {
  projectRoot: string;
  tool: HiveExecutionTool;
  connectionId: string | null | undefined;
  args: Record<string, unknown>;
  correlationId?: string;
}): Promise<HiveProxyRouteDecision> {
  const route = await resolveHiveMcpRoute(input.projectRoot, input.connectionId);
  if (route.route === "ktx") return { action: "passthrough_ktx" };
  if (route.route === "error") {
    return { action: "error", reason: route.reason, detail: route.detail };
  }

  const context = registeredContext;
  if (!context) {
    return {
      action: "serve_hive",
      connection: route.connection,
      response: {
        handled: true,
        result: null,
        payload: {
          ok: false,
          reason: "hive_execution_context_unavailable",
          detail:
            "Hive connection resolved but no execution context is registered (compiled SQL / partition profiles / JDBC worker)",
          jdbcInvokeCount: 0,
          dialect: "hive"
        }
      }
    };
  }

  const compiled = await context.compiledSqlForCall({
    tool: input.tool,
    connectionId: route.connection.id,
    args: input.args
  });
  if (!compiled.ok) {
    return {
      action: "serve_hive",
      connection: route.connection,
      response: {
        handled: true,
        result: null,
        payload: {
          ok: false,
          reason: compiled.reason,
          detail: compiled.detail,
          jdbcInvokeCount: 0,
          dialect: "hive"
        }
      }
    };
  }

  const response = await handleHiveMcpTool({
    tool: input.tool,
    connectionId: route.connection.id,
    compiledSql: compiled.sql,
    profilesByPhysicalTable: compiled.profilesByPhysicalTable,
    jdbcWorker: context.jdbcWorker,
    deadlineMs: context.deadlineMs,
    maxRows: context.maxRows,
    correlationId: input.correlationId
  });

  return { action: "serve_hive", connection: route.connection, response };
}

export function firstConnectionIdFromArgs(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  for (const key of ["connectionId", "connection_id", "connection"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
