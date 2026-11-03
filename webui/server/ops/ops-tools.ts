/**
 * L25-16 — 控制面工具层（Spec §3.5 / §6.1，S2 第 1 项）。
 *
 * 职责：
 * 1. **工具描述**——供 MCP `tools/list` 注入（只暴露已登记的控制面工具）。
 * 2. **入参校验**——`targets` / `dry_run` / `idempotency_key` / `plan_id` / `confirm_digest`。
 * 3. **统一信封**——`{ ok, data | error }`（与既有 WebUI API 一致）。
 *
 * 调用流程（Spec §6.1）：
 * ```
 * 分类 → 全局禁用 → 身份 → 角色解析 → ops 授权 → 目标解析 → 逐对象完整匹配
 *      → 委托（owner-only）→ 写类前置 → preview / commit
 * ```
 *
 * ⚠️ 本模块**不**持有 ktx 写锁，也不做任何文件写——写路径全部在
 * `ops-batch.ts` 的组级执行里（锁内完成）。
 */

import { getOpsToolSpec, type OpsToolSpec } from "./control-plane.js";
import { runOpsCommit, runOpsPreview, type OpsToolAdapter } from "./ops-batch.js";
import { authorizeOpsTargets, collectOpsGrants, opsToolsFromGrants, type OpsGrant } from "./ops-grants.js";
import { enforceOwnerOnly } from "./ops-delegation.js";
import { opsDeny, opsOk, type OpsEnvelope } from "./ops-envelope.js";
import { OpsConnectionTablesAdapter } from "./ops-ktx-batch.js";
import { OpsSourceImportAdapter } from "./ops-source-batch.js";

export const OPS_TOOL_CONNECTION_TABLES = "lucy_ops_connection_tables";
export const OPS_TOOL_SOURCE_IMPORT = "lucy_ops_source_import";

/** 控制面工具的稳定拒绝码（Spec §3.5 / §6.1）。 */
export const OPS_TOOL_CODES = {
  notControlPlane: "tool_not_control_plane",
  agentDisabled: "ops_agent_disabled",
  idempotencyKeyRequired: "ops_idempotency_key_required",
  planIdRequired: "ops_plan_id_required",
  confirmDigestRequired: "ops_confirm_digest_required"
} as const;

const ADAPTERS = new Map<string, OpsToolAdapter>([
  [OPS_TOOL_CONNECTION_TABLES, new OpsConnectionTablesAdapter()],
  [OPS_TOOL_SOURCE_IMPORT, new OpsSourceImportAdapter()]
]);

export function opsAdapterFor(toolName: string): OpsToolAdapter | undefined {
  return ADAPTERS.get(toolName);
}

/** MCP `tools/list` 用的工具描述（只含已登记的控制面工具）。 */
export function opsToolDescriptors(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return [
    {
      name: OPS_TOOL_CONNECTION_TABLES,
      description:
        "批量维护连接的启用表范围 / 移除 Schema（控制面工具）。只改 ktx.yaml，不删除语义文件。" +
        "整批全成或全拒：任一连接校验失败或检测到外部修改，整批不写。" +
        "入参：{ targets: [{ connectionId, enabledTables? , removeSchema? }], dry_run?, idempotency_key?, plan_id?, confirm_digest? }",
      inputSchema: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                connectionId: { type: "string" },
                enabledTables: { type: "array", items: { type: "string" } },
                removeSchema: { type: "string" }
              },
              required: ["connectionId"],
              additionalProperties: false
            }
          },
          dry_run: { type: "boolean" },
          idempotency_key: { type: "string" },
          plan_id: { type: "string" },
          confirm_digest: { type: "string" }
        },
        required: ["targets"],
        additionalProperties: false
      }
    },
    {
      name: OPS_TOOL_SOURCE_IMPORT,
      description:
        "批量导入源表语义 / 版本回滚（控制面工具）。写集相交的目标构成一个原子组，" +
        "组内全成或全败，组间可部分成功并重放。版本回滚经导入写服务落盘。" +
        "入参：{ targets: [{ connectionId, schema, table, yaml?, action?, versionId? }], dry_run?, idempotency_key?, plan_id?, confirm_digest? }",
      inputSchema: {
        type: "object",
        properties: {
          targets: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              properties: {
                connectionId: { type: "string" },
                schema: { type: "string" },
                table: { type: "string" },
                yaml: { type: "string" },
                action: { type: "string", enum: ["import", "restore"] },
                versionId: { type: "string" },
                sourceFileName: { type: "string" }
              },
              required: ["connectionId", "schema", "table"],
              additionalProperties: false
            }
          },
          dry_run: { type: "boolean" },
          idempotency_key: { type: "string" },
          plan_id: { type: "string" },
          confirm_digest: { type: "string" }
        },
        required: ["targets"],
        additionalProperties: false
      }
    }
  ];
}

// ─── 身份与授权上下文 ─────────────────────────────────────────────────────────

export interface OpsActorContext {
  actor: string;
  delegatedFrom: string | null;
  grants: OpsGrant[];
}

/** access.yaml 的最小视图——避免 import `proxy/identity.ts` 的内部类型。 */
interface OpsAccessUserLike {
  id: string;
  enabled?: boolean;
  role?: string | null;
  roles?: unknown;
  delegated_from?: string | null;
}

/**
 * 解析调用者的控制面上下文：actor / 委托人 / ops grant。
 *
 * ⚠️ 角色解析失败（`role` 与 `roles` 同时声明）直接拒绝，**不猜默认**。
 */
export async function resolveOpsActorContext(userId: string): Promise<
  { ok: true; context: OpsActorContext } | { ok: false; code: string; message?: string }
> {
  const { getAccessConfig } = await import("../proxy/identity.js");
  const { resolveRoleIds } = await import("../proxy/acl.js");
  const config = await getAccessConfig();
  const user = (config.users ?? []).find((item: OpsAccessUserLike) => item.id === userId);
  if (!user) return { ok: false, code: OPS_TOOL_CODES.agentDisabled };
  if (user.enabled === false) return { ok: false, code: OPS_TOOL_CODES.agentDisabled };

  const roleIds = resolveRoleIds(user as { role?: string | null; roles?: unknown });
  if (!roleIds.ok) {
    return { ok: false, code: roleIds.reason, message: "角色解析失败" };
  }
  const grants = collectOpsGrants(
    config as unknown as Parameters<typeof collectOpsGrants>[0],
    roleIds.roleIds
  );
  return {
    ok: true,
    context: {
      actor: userId,
      delegatedFrom: typeof user.delegated_from === "string" ? user.delegated_from : null,
      grants
    }
  };
}

// ─── 调用入口 ─────────────────────────────────────────────────────────────────

export interface OpsToolInvocation {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  projectRoot: string;
}

/**
 * 控制面工具的统一调用入口（Spec §6.1）。
 *
 * 任何失败都返回 `{ ok: false, error: { code } }`——**不抛异常**给协议层。
 */
export async function invokeOpsTool(invocation: OpsToolInvocation): Promise<OpsEnvelope> {
  const spec = getOpsToolSpec(invocation.toolName);
  if (!spec) {
    return opsDeny(OPS_TOOL_CODES.notControlPlane, undefined, `未登记的控制面工具：${invocation.toolName}`);
  }
  const adapter = opsAdapterFor(invocation.toolName);
  if (!adapter) {
    return opsDeny(OPS_TOOL_CODES.notControlPlane, undefined, `未登记的控制面工具：${invocation.toolName}`);
  }

  // 身份 → 角色 → ops grant
  const actorContext = await resolveOpsActorContext(invocation.userId);
  if (!actorContext.ok) {
    return opsDeny(actorContext.code, undefined, actorContext.message);
  }
  const { actor, delegatedFrom, grants } = actorContext.context;

  // 工具级授权：工具必须在某条 grant 的 `tools` 内。
  if (!opsToolsFromGrants(grants).has(invocation.toolName)) {
    return opsDeny(`ops_not_granted:${invocation.toolName}`);
  }

  // 目标解析
  let targets: unknown[];
  try {
    targets = adapter.parseTargets(invocation.args);
  } catch (err) {
    const code = (err as { code?: string }).code;
    return opsDeny(
      typeof code === "string" ? code : "ops_target_unresolvable",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }

  // 逐对象完整匹配（Spec §3.2.2 规则 4 / §6.1 步骤 7）
  const requested = targets.map((target) => ({
    id: adapter.targetId(target),
    connectionId: adapter.connectionId(target)
  }));
  const authorization = authorizeOpsTargets(grants, spec, requested);
  if (!authorization.ok) {
    const first = authorization.denied[0];
    return opsDeny(
      "ops_grant_unmatched",
      { target_id: first?.targetId, reasons: first?.reasons },
      "目标未被授权"
    );
  }

  // 委托（owner-only）
  const ownerGate = await enforceOwnerOnly(spec.ownerOnly, delegatedFrom);
  if (!ownerGate.ok) {
    return opsDeny(ownerGate.reason, undefined, "owner-only 操作需要有效的委托人");
  }

  // 写类前置（Spec §6.1 步骤 9）
  const args = invocation.args;
  const dryRun = args.dry_run === true;
  if (!dryRun) {
    if (typeof args.idempotency_key !== "string" || !args.idempotency_key.trim()) {
      return opsDeny(OPS_TOOL_CODES.idempotencyKeyRequired);
    }
    if (typeof args.plan_id !== "string" || !args.plan_id.trim()) {
      return opsDeny(OPS_TOOL_CODES.planIdRequired);
    }
    if (typeof args.confirm_digest !== "string" || !args.confirm_digest.trim()) {
      return opsDeny(OPS_TOOL_CODES.confirmDigestRequired);
    }
  }

  try {
    if (dryRun) {
      return await runOpsPreview({
        adapter,
        projectRoot: invocation.projectRoot,
        actor,
        delegatedFrom,
        request: args
      });
    }
    return await runOpsCommit({
      adapter,
      projectRoot: invocation.projectRoot,
      actor,
      delegatedFrom,
      idempotencyKey: (args.idempotency_key as string).trim(),
      planId: (args.plan_id as string).trim(),
      confirmDigest: (args.confirm_digest as string).trim(),
      requestTargetIds: requested.map((target) => target.id),
      grants,
      tool: spec
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    return opsDeny(
      typeof code === "string" ? code : "ops_tool_failed",
      undefined,
      err instanceof Error ? err.message : String(err)
    );
  }
}

export { opsOk, opsDeny, type OpsEnvelope };
