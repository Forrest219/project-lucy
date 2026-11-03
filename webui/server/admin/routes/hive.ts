/**
 * Lucy v0.25 P1-4 — Hive 连接管理接口（编译侧配置面）。
 *
 * Authority: docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md §3.2
 * Plan:      docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §7.2（H1、H2）
 *
 * Endpoints (mounted by the host session in `webui/server/index.ts`):
 *
 *   GET    /api/admin/hive/connections       统一连接视图（KTX + Hive）
 *   POST   /api/admin/hive/connections       新建或整体替换一个 Hive 连接
 *   DELETE /api/admin/hive/connections/:id   删除一个 Hive 连接
 *
 * 本模块只管理**连接配置**。连通测试、元数据采集、JDBC 执行都不在这里 ——
 * 那些属于 H25-01b / H25-03，本轮未实施，数据库支持状态保持 `planned`。
 *
 * 三条硬约束：
 *
 * 1. **凭据只写引用。** 请求体里的明文秘密在进入配置模型之前就被拒绝，
 *    不会落盘、不会进审计 diff、不会进备份包。
 * 2. **连接 ID 全局唯一。** 读视图在 KTX 与 Hive 的 ID 冲突时返回 409，
 *    不返回一份"谁覆盖了谁"的视图。
 * 3. **写入走既有单实例串行化。** 创建、编辑、删除都经过
 *    `mutateHiveConnections`（`withKtxYamlWriteLock` + generation 失效），
 *    不新开写入口。读基线、合并、写都在同一把锁内完成，
 *    并发 upsert 不会互相丢更新。
 */
import type { FastifyInstance } from "fastify";
import { stringify } from "yaml";
import {
  mergeUnifiedConnections,
  mutateHiveConnections,
  parseHiveConnectionsYaml,
  readHiveConnections,
  serializeHiveConnections,
  type HiveConnection,
  type HiveMutationFailureCode
} from "../../hive/config.js";
import { readConnections, resolveProjectRoot } from "../../project.js";
import { trustedActorFromRequest } from "../../security/request-actor.js";
import {
  beginConfigAuditIntent,
  completeConfigAuditTerminal,
  type AuditIntent
} from "../config-audit-write.js";

function errorBody(code: string, message: string, detail?: unknown) {
  return { ok: false as const, error: { code, message, ...(detail === undefined ? {} : { detail }) } };
}

/**
 * Map a mutation failure onto the HTTP contract.
 *
 * The codes are the ones the config layer reports; the response body keeps the
 * upper-case spelling the admin API already used.
 */
const MUTATION_FAILURE_STATUS: Record<HiveMutationFailureCode, number> = {
  hive_config_unreadable: 500,
  hive_connection_id_conflict: 409,
  hive_connection_not_found: 404
};

/**
 * Parse one connection from an untrusted request body.
 *
 * The body uses the same field names as the configuration file. It is
 * round-tripped through the FILE parser, which is the single validation
 * authority for the connection shape — so an inline secret, an unknown field
 * or an out-of-range port is rejected exactly as it would be on disk, and the
 * request can never introduce a shape the file parser would not accept.
 */
function parseConnectionInput(raw: unknown): { ok: true; connection: HiveConnection } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "connection must be an object" };
  }
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) {
    return { ok: false, reason: "id is required" };
  }
  const { id: _ignored, ...rest } = record;
  const yamlText = stringify({ version: 1, connections: { [id]: rest } });
  const parsed = parseHiveConnectionsYaml(yamlText);
  if (!parsed.ok) {
    return { ok: false, reason: parsed.detail };
  }
  const connection = parsed.value.connections[0];
  if (!connection) {
    return { ok: false, reason: "connection is invalid" };
  }
  return { ok: true, connection };
}

/**
 * Register the Hive connection Admin routes.
 *
 * Wiring (owned by the host session, `webui/server/index.ts`):
 *
 *   import { registerHiveConnectionRoutes } from "./admin/routes/hive.js";
 *   registerHiveConnectionRoutes(app);
 */
export function registerHiveConnectionRoutes(app: FastifyInstance): void {
  // GET /api/admin/hive/connections — the unified connection view.
  app.get("/api/admin/hive/connections", async (_request, reply) => {
    const projectRoot = await resolveProjectRoot();
    const hive = await readHiveConnections(projectRoot);
    if (!hive.ok) {
      return reply
        .status(500)
        .send(errorBody("HIVE_CONFIG_UNREADABLE", "The Hive connection configuration could not be read", hive.detail));
    }
    const ktx = await readConnections(projectRoot);
    const merged = mergeUnifiedConnections(ktx, hive.value.connections);
    if (!merged.ok) {
      // Fail closed: a conflicting connection id must not be resolved by
      // hiding one side.
      return reply.status(409).send(
        errorBody("HIVE_CONNECTION_ID_CONFLICT", merged.detail, {
          connectionId: merged.conflictingId,
          origins: merged.origins
        })
      );
    }
    return {
      ok: true,
      data: {
        hive: hive.value.connections,
        unified: merged.connections
      }
    };
  });

  // POST /api/admin/hive/connections — create or replace one connection.
  app.post<{ Body: { connection?: unknown } }>(
    "/api/admin/hive/connections",
    async (request, reply) => {
      const parsed = parseConnectionInput(request.body?.connection);
      if (!parsed.ok) {
        return reply.status(400).send(errorBody("BAD_REQUEST", parsed.reason));
      }
      const connection = parsed.connection;

      const projectRoot = await resolveProjectRoot();
      const actor = trustedActorFromRequest(request);

      try {
        // The baseline read, the merge and the write happen inside ONE
        // critical section: a concurrent upsert can no longer merge against a
        // stale baseline and drop the other writer's connection.
        const outcome = await mutateHiveConnections<{ connection: HiveConnection }>(
          projectRoot,
          async (current) => {
            // A connection id may not collide with a KTX connection id.
            const ktx = await readConnections(projectRoot);
            if (ktx.some((entry) => entry.id === connection.id)) {
              return {
                ok: false,
                code: "hive_connection_id_conflict",
                message: `Connection id '${connection.id}' already exists in the KTX configuration`
              };
            }

            const next = [
              ...current.filter((entry) => entry.id !== connection.id),
              connection
            ].sort((a, b) => a.id.localeCompare(b.id));

            return { ok: true, value: { connection }, connections: next };
          },
          ({ current, next }) => {
            const auditIntent: AuditIntent = {
              enabled: true,
              changeType: "hive_connection_upsert",
              assetKind: "governance",
              operation: "upsert",
              targetId: connection.id,
              actor: actor.actorId,
              actorType: actor.actorType,
              actorIp: actor.actorIp ?? undefined,
              source: "admin_api",
              oldSummary: current.find((entry) => entry.id === connection.id),
              newSummary: connection
            };
            return {
              beginIntent: async () =>
                (
                  await beginConfigAuditIntent(projectRoot, "webui/config/hive-connections.yaml", auditIntent, {
                    newText: serializeHiveConnections(next)
                  })
                ).intentId,
              completeIntent: async (intentId) => {
                await completeConfigAuditTerminal(intentId, { writeStatus: "committed" });
              },
              failIntent: async (intentId, reason) => {
                await completeConfigAuditTerminal(intentId, {
                  writeStatus: "failed",
                  errorReason: reason
                });
              }
            };
          }
        );

        if (!outcome.ok) {
          return reply
            .status(MUTATION_FAILURE_STATUS[outcome.code])
            .send(
              errorBody(
                outcome.code.toUpperCase(),
                outcome.message,
                outcome.detail
              )
            );
        }
        return { ok: true, data: { connection: outcome.value.connection, auditId: outcome.auditId } };
      } catch (error) {
        return reply.status(500).send(
          errorBody(
            "HIVE_CONFIG_WRITE_FAILED",
            "The Hive connection configuration could not be written",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
  );

  // DELETE /api/admin/hive/connections/:id — delete one connection.
  app.delete<{ Params: { id: string } }>(
    "/api/admin/hive/connections/:id",
    async (request, reply) => {
      const id = request.params?.id ?? "";
      if (!id) {
        return reply.status(400).send(errorBody("BAD_REQUEST", "id is required"));
      }
      const projectRoot = await resolveProjectRoot();
      const actor = trustedActorFromRequest(request);

      try {
        const outcome = await mutateHiveConnections<{ connectionId: string }>(
          projectRoot,
          async (current) => {
            const target = current.find((entry) => entry.id === id);
            if (!target) {
              return {
                ok: false,
                code: "hive_connection_not_found",
                message: `Connection '${id}' does not exist`
              };
            }
            const next = current.filter((entry) => entry.id !== id);
            return { ok: true, value: { connectionId: id }, connections: next };
          },
          ({ current }) => {
            const auditIntent: AuditIntent = {
              enabled: true,
              changeType: "hive_connection_delete",
              assetKind: "governance",
              operation: "delete",
              targetId: id,
              actor: actor.actorId,
              actorType: actor.actorType,
              actorIp: actor.actorIp ?? undefined,
              source: "admin_api",
              oldSummary: current.find((entry) => entry.id === id),
              newSummary: null
            };
            return {
              beginIntent: async () =>
                (
                  await beginConfigAuditIntent(projectRoot, "webui/config/hive-connections.yaml", auditIntent, {
                    newText: serializeHiveConnections(current.filter((entry) => entry.id !== id))
                  })
                ).intentId,
              completeIntent: async (intentId) => {
                await completeConfigAuditTerminal(intentId, { writeStatus: "committed" });
              },
              failIntent: async (intentId, reason) => {
                await completeConfigAuditTerminal(intentId, {
                  writeStatus: "failed",
                  errorReason: reason
                });
              }
            };
          }
        );

        if (!outcome.ok) {
          return reply
            .status(MUTATION_FAILURE_STATUS[outcome.code])
            .send(
              errorBody(
                outcome.code.toUpperCase(),
                outcome.message,
                outcome.detail
              )
            );
        }
        return { ok: true, data: { connectionId: outcome.value.connectionId, auditId: outcome.auditId } };
      } catch (error) {
        return reply.status(500).send(
          errorBody(
            "HIVE_CONFIG_WRITE_FAILED",
            "The Hive connection configuration could not be written",
            error instanceof Error ? error.message : String(error)
          )
        );
      }
    }
  );
}
