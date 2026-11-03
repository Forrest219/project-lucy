/**
 * L25-16 — 控制面授权判定（Spec §3.2.2，Normative）。
 *
 * 三条硬规则：
 *
 * 1. **逐条 grant 判定**：一个工具可出现在多条 grant 中，判定逐条匹配，任一条满足即放行。
 *    用户可持多个角色，多角色的 ops grant 取并集。
 * 2. **逐对象完整匹配（R03 / N02）**：对任一目标对象，必须存在**一条 grant 自身同时满足**
 *    ① 工具在 `g.tools` 内；② `g.asset_kinds` 覆盖该工具的适用域集合；
 *    ③ 工具为 `connection_scoped` 时 `g.connections` 存在且覆盖该对象所在的连接。
 *    - 禁止跨 grant 拼接（不得用 A grant 的域配 B grant 的连接）。
 *    - 禁止要求单条 grant 覆盖整批（grant A 只授连接 A、grant B 只授连接 B 时，
 *      两个对象各自被其自身完整匹配的 grant 授权，合并调用必须放行）。
 * 3. **连接域缺省即拒绝**（fail-closed），不回落为「全部允许」。
 *
 * 仅走 `user.allow` 旧式直配的用户（`hasLegacyDirectAllow`）**不获得任何 ops 授权**。
 */

import { isOpsAssetKind, type OpsAssetKind, type OpsToolSpec } from "./control-plane.js";

export interface OpsGrant {
  tools: string[];
  asset_kinds: OpsAssetKind[];
  /** 连接域约束；`undefined` / 空数组 = 不允许任何连接域目标（fail-closed）。 */
  connections?: string[];
  /** 实例级范围（首期只有 `read_only`）；不得用于写类工具。 */
  instance_scope?: string;
}

export type OpsGrantRejectReason =
  | "ops_grant_tools_wildcard_forbidden"
  | "ops_grant_tools_invalid"
  | "ops_grant_asset_kinds_invalid"
  | "ops_grant_connections_invalid"
  | "ops_grant_instance_scope_invalid";

export type OpsGrantNormalization =
  | { ok: true; value: OpsGrant }
  | { ok: false; reason: OpsGrantRejectReason };

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return undefined;
    const trimmed = item.trim();
    if (!trimmed) return undefined;
    out.push(trimmed);
  }
  return out;
}

/**
 * 规范化一条 `allow.ops[]` grant。`ops.tools` **不允许 `*`**（与 `allow.tools` 的 `*` 禁令一致）。
 */
export function normalizeOpsGrant(raw: unknown): OpsGrantNormalization {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, reason: "ops_grant_tools_invalid" };
  }
  const source = raw as Record<string, unknown>;

  const tools = stringList(source.tools);
  if (!tools) return { ok: false, reason: "ops_grant_tools_invalid" };
  if (tools.includes("*")) return { ok: false, reason: "ops_grant_tools_wildcard_forbidden" };

  const kinds = stringList(source.asset_kinds);
  if (!kinds) return { ok: false, reason: "ops_grant_asset_kinds_invalid" };
  for (const kind of kinds) {
    if (!isOpsAssetKind(kind)) return { ok: false, reason: "ops_grant_asset_kinds_invalid" };
  }

  let connections: string[] | undefined;
  if (source.connections !== undefined && source.connections !== null) {
    connections = stringList(source.connections);
    if (!connections) return { ok: false, reason: "ops_grant_connections_invalid" };
  } else {
    // VOPS-04 也用 `scope.connections` 表述；两种写法都接受，但缺省一律 fail-closed。
    const scope = source.scope;
    if (scope && typeof scope === "object" && !Array.isArray(scope)) {
      const scoped = (scope as Record<string, unknown>).connections;
      if (scoped !== undefined && scoped !== null) {
        connections = stringList(scoped);
        if (!connections) return { ok: false, reason: "ops_grant_connections_invalid" };
      }
    }
  }

  let instanceScope: string | undefined;
  if (source.instance_scope !== undefined && source.instance_scope !== null) {
    if (typeof source.instance_scope !== "string" || !source.instance_scope.trim()) {
      return { ok: false, reason: "ops_grant_instance_scope_invalid" };
    }
    instanceScope = source.instance_scope.trim();
  }

  return {
    ok: true,
    value: {
      tools,
      asset_kinds: kinds as OpsAssetKind[],
      ...(connections ? { connections } : {}),
      ...(instanceScope ? { instance_scope: instanceScope } : {})
    }
  };
}

/** access.yaml 的最小结构视图——避免 import `proxy/identity.ts` 的非导出类型。 */
export interface OpsAccessRoleLike {
  allow?: { ops?: unknown } | undefined;
}

export interface OpsAccessConfigLike {
  roles?: Record<string, OpsAccessRoleLike | undefined>;
  users?: Array<{ id: string; role?: string | null; roles?: unknown; enabled?: boolean }>;
}

/**
 * 收集一个角色集合上的全部 ops grant（多角色并集）。
 *
 * ⚠️ 只读 `role.allow.ops`；旧式 `user.allow` 直配不产生任何 ops 授权。
 */
export function collectOpsGrants(
  config: OpsAccessConfigLike | undefined,
  roleIds: readonly string[]
): OpsGrant[] {
  const grants: OpsGrant[] = [];
  if (!config?.roles) return grants;
  for (const roleId of roleIds) {
    const raw = config.roles[roleId]?.allow?.ops;
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      const normalized = normalizeOpsGrant(item);
      if (!normalized.ok) continue;
      grants.push(normalized.value);
    }
  }
  return grants;
}

/** 某个用户（或角色集合）显式授予的控制面工具名集合。 */
export function opsToolsFromGrants(grants: readonly OpsGrant[]): Set<string> {
  const tools = new Set<string>();
  for (const grant of grants) {
    for (const tool of grant.tools) tools.add(tool);
  }
  return tools;
}

export type OpsGrantMismatchReason =
  | "tool_not_listed"
  | "kind_not_covered"
  | "connection_scope_absent"
  | "connection_out_of_scope"
  | "read_only_scope";

export interface OpsGrantMatch {
  /** 是否存在一条 grant 自身完整覆盖该对象。 */
  matched: boolean;
  /** 不匹配原因（便于排障；matched 时为空）。 */
  reasons: OpsGrantMismatchReason[];
}

/**
 * 逐对象完整匹配（Spec §3.2.2 规则 4）。
 *
 * @param connectionId 该对象所在的连接；非连接域工具可传空串。
 */
export function matchOpsGrantForTarget(
  grants: readonly OpsGrant[],
  tool: OpsToolSpec,
  connectionId: string
): OpsGrantMatch {
  const reasons: OpsGrantMismatchReason[] = [];
  for (const grant of grants) {
    if (!grant.tools.includes(tool.name)) {
      reasons.push("tool_not_listed");
      continue;
    }
    // Spec §3.2.2 规则 5：只读 grant 不得用于任何写类工具。
    if (grant.instance_scope === "read_only" && tool.write) {
      reasons.push("read_only_scope");
      continue;
    }
    const kindsCovered = tool.managedAssetKinds.every((kind) => grant.asset_kinds.includes(kind));
    if (!kindsCovered) {
      reasons.push("kind_not_covered");
      continue;
    }
    if (tool.connectionScoped) {
      if (!grant.connections || grant.connections.length === 0) {
        reasons.push("connection_scope_absent");
        continue;
      }
      if (!grant.connections.includes(connectionId)) {
        reasons.push("connection_out_of_scope");
        continue;
      }
    }
    return { matched: true, reasons: [] };
  }
  return { matched: false, reasons };
}

/**
 * 一次调用对一组对象的授权裁决（逐对象保存结果，Spec §6.1 步骤 7）。
 */
export interface OpsAuthorizationDecision {
  ok: boolean;
  /** 未获授权的对象 → 不匹配原因。 */
  denied: Array<{ targetId: string; reasons: OpsGrantMismatchReason[] }>;
}

export function authorizeOpsTargets(
  grants: readonly OpsGrant[],
  tool: OpsToolSpec,
  targets: ReadonlyArray<{ id: string; connectionId: string }>
): OpsAuthorizationDecision {
  const denied: OpsAuthorizationDecision["denied"] = [];
  for (const target of targets) {
    const match = matchOpsGrantForTarget(grants, tool, target.connectionId);
    if (!match.matched) denied.push({ targetId: target.id, reasons: match.reasons });
  }
  return { ok: denied.length === 0, denied };
}
