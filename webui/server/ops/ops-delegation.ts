/**
 * L25-16 — 委托语义（Spec §3.2.2 规则 6–8，R04）。
 *
 * `users[].delegated_from` 指向 `admins.yaml` 中的管理员 id。委托只用于**提升到 owner-only
 * 操作**与审计归因，**不得扩大** `allow.ops` 中已声明的域与连接范围（规则 7）。
 */

import { findAdmin, loadAdminsConfig, type WebuiAdminRecord } from "../auth/admins-store.js";

export type OpsDelegationResolution =
  | { ok: true; principal: WebuiAdminRecord }
  | { ok: false; reason: "ops_owner_delegation_required" };

/**
 * 解析委托人并校验其为**启用中的 owner**。
 *
 * 缺委托、委托人不存在、委托人不是 owner、委托人未启用——一律返回同一个稳定原因码
 * `ops_owner_delegation_required`（不泄露委托人是否存在）。
 */
export async function resolveDelegatingPrincipal(
  delegatedFrom: string | undefined | null
): Promise<OpsDelegationResolution> {
  if (typeof delegatedFrom !== "string" || !delegatedFrom.trim()) {
    return { ok: false, reason: "ops_owner_delegation_required" };
  }
  let principal: WebuiAdminRecord | undefined;
  try {
    const config = await loadAdminsConfig();
    principal = findAdmin(config, delegatedFrom.trim());
  } catch {
    // admins.yaml 不可读时 fail-closed：委托无法证明 ⇒ owner-only 操作拒绝。
    return { ok: false, reason: "ops_owner_delegation_required" };
  }
  if (!principal) return { ok: false, reason: "ops_owner_delegation_required" };
  if (principal.role !== "owner") return { ok: false, reason: "ops_owner_delegation_required" };
  if (principal.enabled === false) return { ok: false, reason: "ops_owner_delegation_required" };
  return { ok: true, principal };
}

export type OpsOwnerOnlyGate =
  | { ok: true; required: false }
  | { ok: true; required: true; principal: WebuiAdminRecord }
  | { ok: false; required: true; reason: "ops_owner_delegation_required" };

/**
 * owner-only 门禁的通用判定。工具非 owner-only 时直接放行（委托不放大域与连接范围）。
 */
export async function enforceOwnerOnly(
  ownerOnly: boolean,
  delegatedFrom: string | undefined | null
): Promise<OpsOwnerOnlyGate> {
  if (!ownerOnly) return { ok: true, required: false };
  const resolved = await resolveDelegatingPrincipal(delegatedFrom);
  if (!resolved.ok) return { ok: false, required: true, reason: resolved.reason };
  return { ok: true, required: true, principal: resolved.principal };
}
