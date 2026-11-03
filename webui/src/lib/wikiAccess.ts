/**
 * Spec 193 client helpers — Business Wiki authorization wording and the
 * access / batch request helpers.
 *
 * Three facts must never be merged into one sentence (Spec 193 §4.2):
 *   - the declared authorization (`allowed_roles`),
 *   - the channel effect per declared Role (search / read),
 *   - the affected Agent count (enabled Agents actually bound to the Role).
 *
 * Everything here is client-side and deterministic so the read view, the
 * list, the upload preflight, the access drawer and the bulk drawer all
 * speak the same registered terminology.
 */
import { apiGet, apiPost, apiPut } from "./apiClient";
import type {
  WikiAccessDirection,
  WikiAccessListEntry,
  WikiAccessPreview,
  WikiAccessPreviewRequest,
  WikiAccessRoleEffect,
  WikiAccessSaveRequest,
  WikiAccessSaveResult,
  WikiAccessSummary,
  WikiAclState,
  WikiBatchAccessCommitRequest,
  WikiBatchAccessPlan,
  WikiBatchAccessPreviewRequest,
  WikiBatchAccessResult,
  WikiUploadAccessSelection
} from "./types";

/** Registered UI wording for one authorization state. */
export const WIKI_ACL_NONE_LABEL = "无人可见";
export const WIKI_ACL_ALL_LABEL = "所有角色可见";
export const WIKI_ACL_ANOMALY_LABEL = "授权异常";

/** Registered UI wording for the authorization change direction. */
export const WIKI_DIRECTION_LABELS: Record<WikiAccessDirection, string> = {
  widen: "扩权",
  narrow: "收窄",
  neutral: "不变"
};

/**
 * The role ids a state declares. A corrupt declaration has no usable role
 * list — it is never adopted, only explicitly re-set.
 */
export function wikiAclRoleIds(acl: WikiAclState | null | undefined): string[] {
  if (!acl) return [];
  if (acl.state === "roles") return [...acl.roles];
  if (acl.state === "all") return ["*"];
  return [];
}

/**
 * The declared roles as one readable string (`finance、test-fc`).
 * Empty / missing declarations read as 无人可见.
 */
export function wikiAclRoleListText(roles: readonly string[]): string {
  const named = roles.filter((role) => role !== "*");
  if (named.length === 0) {
    return roles.includes("*") ? WIKI_ACL_ALL_LABEL : WIKI_ACL_NONE_LABEL;
  }
  return named.join("、");
}

/** The registered label of one authorization state. */
export function wikiAclStateLabel(acl: WikiAclState | null | undefined): string {
  if (!acl) return WIKI_ACL_NONE_LABEL;
  switch (acl.state) {
    case "missing":
    case "empty":
      return WIKI_ACL_NONE_LABEL;
    case "all":
      return WIKI_ACL_ALL_LABEL;
    case "corrupt":
      return WIKI_ACL_ANOMALY_LABEL;
    case "roles":
      return acl.roles.length === 0 ? WIKI_ACL_NONE_LABEL : `${acl.roles.length} 个角色`;
  }
}

/**
 * The readable declaration of one authorization state: the Role names when
 * roles are declared, otherwise the registered state label.
 */
export function wikiAclDisplayText(acl: WikiAclState | null | undefined): string {
  if (!acl) return "未加载";
  switch (acl.state) {
    case "missing":
    case "empty":
      return WIKI_ACL_NONE_LABEL;
    case "all":
      return WIKI_ACL_ALL_LABEL;
    case "corrupt":
      return WIKI_ACL_ANOMALY_LABEL;
    case "roles":
      return acl.roles.length === 0 ? WIKI_ACL_NONE_LABEL : acl.roles.join("、");
  }
}

/** The registered label of one authorization change direction. */
export function wikiDirectionLabel(direction: WikiAccessDirection): string {
  return WIKI_DIRECTION_LABELS[direction];
}

/**
 * The primary status of a list row. Exactly one of:
 * 无人可见 / N 个角色 / 所有角色可见 / 授权异常.
 */
export function wikiAccessPrimaryStatus(entry: WikiAccessListEntry): string {
  if (entry.acl.state === "roles") {
    const count = entry.declared_role_count ?? entry.acl.roles.length;
    return `${count} 个角色`;
  }
  return wikiAclStateLabel(entry.acl);
}

/** The optional secondary status of a list row: `N 个角色缺少读取通道`. */
/**
 * Spec 193 §6.1 — the list filters. A filter is a VIEW concern only: it
 * never changes the authorization and never changes the selection scope.
 */
export type WikiAccessFilter =
  | "all"
  | "none"
  | "roles"
  | "all_roles"
  | "anomaly"
  | "missing_read";

export const WIKI_ACCESS_FILTER_LABELS: Record<WikiAccessFilter, string> = {
  all: "全部",
  none: "无人可见",
  roles: "指定角色",
  all_roles: "所有角色可见",
  anomaly: "授权异常",
  missing_read: "缺少读取通道"
};

export const WIKI_ACCESS_FILTERS: readonly WikiAccessFilter[] = [
  "all",
  "none",
  "roles",
  "all_roles",
  "anomaly",
  "missing_read"
];

/** `true` when the row matches the active view filter. */
export function matchesWikiAccessFilter(
  entry: WikiAccessListEntry,
  filter: WikiAccessFilter
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "none":
      return entry.acl.state === "missing" || entry.acl.state === "empty";
    case "roles":
      return entry.acl.state === "roles";
    case "all_roles":
      return entry.acl.state === "all";
    case "anomaly":
      return entry.acl.state === "corrupt";
    case "missing_read":
      return entry.declared_without_read > 0;
  }
}

/**
 * The optional secondary status of a list row: `N 个角色缺少读取通道`.
 */
export function wikiAccessSecondaryStatus(entry: WikiAccessListEntry): string | null {
  if (entry.declared_without_read > 0) {
    return `${entry.declared_without_read} 个角色缺少读取通道`;
  }
  return null;
}

/**
 * The fixed channel-effect wording of one declared Role (Spec 193 §4.2).
 * Exactly one of the five registered sentences.
 */
export function wikiRoleEffectLabel(effect: WikiAccessRoleEffect): string {
  if (!effect.known) return "未知角色，不匹配任何 Agent";
  if (effect.discover_enabled && effect.read_enabled) return "可搜索、可读取";
  if (effect.discover_enabled) return "可搜索摘要、无法读取正文";
  if (effect.read_enabled) return "可按已知路径读取、无法搜索发现";
  return "已授权，缺少 Wiki 访问通道";
}

/**
 * The affected Agent count of a Role set. Distinct agents are counted
 * once even when they bind several declared Roles.
 */
export function wikiAffectedAgentCount(effects: readonly WikiAccessRoleEffect[]): number {
  const ids = new Set<string>();
  let counted = 0;
  let hasIds = false;
  for (const effect of effects) {
    if (effect.assigned_agent_ids.length > 0) {
      hasIds = true;
      for (const id of effect.assigned_agent_ids) ids.add(id);
    } else {
      counted += effect.assigned_agent_count;
    }
  }
  return hasIds ? ids.size : counted;
}

/**
 * Canonical comparison of two declarations. `missing` and `empty` are the
 * same runtime fact (nobody can see the document); a corrupt declaration
 * only equals another corrupt declaration because its bytes differ.
 */
export function wikiAclEquals(
  left: WikiAclState | null | undefined,
  right: WikiAclState | null | undefined
): boolean {
  if (!left || !right) return false;
  if (left.state === "all" || right.state === "all") return left.state === right.state;
  if (left.state === "corrupt" || right.state === "corrupt") {
    return left.state === "corrupt" && right.state === "corrupt";
  }
  const leftRoles = left.state === "roles" ? [...left.roles].sort() : [];
  const rightRoles = right.state === "roles" ? [...right.roles].sort() : [];
  return leftRoles.length === rightRoles.length && leftRoles.every((role, index) => role === rightRoles[index]);
}

/** The declared Role count of a state (`null` for all / corrupt). */
export function wikiDeclaredRoleCount(acl: WikiAclState | null | undefined): number | null {
  if (!acl) return 0;
  if (acl.state === "roles") return acl.roles.length;
  if (acl.state === "all" || acl.state === "corrupt") return null;
  return 0;
}

/** `true` when the declaration grants every formal Role. */
export function wikiAclIsAll(acl: WikiAclState | null | undefined): boolean {
  return acl?.state === "all";
}

/** `true` when the declaration grants nobody. */
export function wikiAclIsEmpty(acl: WikiAclState | null | undefined): boolean {
  if (!acl) return true;
  return acl.state === "missing" || acl.state === "empty" || (acl.state === "roles" && acl.roles.length === 0);
}

/** `true` when the stored declaration is corrupt and cannot be adopted. */
export function wikiAclIsCorrupt(acl: WikiAclState | null | undefined): boolean {
  return acl?.state === "corrupt";
}

/**
 * Build the upload authorization selection from a role list.
 * `["*"]` means 所有角色可见; an empty list means 无人可见.
 */
export function wikiSelectionFromRoleIds(roleIds: readonly string[]): {
  mode: "use_uploaded" | "set";
  allowed_roles: string[];
} {
  if (roleIds.includes("*")) {
    return { mode: "set", allowed_roles: ["*"] };
  }
  return { mode: "set", allowed_roles: [...roleIds] };
}

/** Stable error codes the Wiki access routes may answer with. */
export const WIKI_ACCESS_ERROR_CODES = [
  "wiki_upload_access_required",
  "wiki_upload_preview_stale",
  "wiki_expected_version_required",
  "wiki_access_preview_stale",
  "wiki_batch_preview_stale",
  "wiki_batch_empty",
  "wiki_batch_limit_exceeded",
  "wiki_batch_idempotency_conflict",
  "wiki_access_change_pending",
  "CONTEXT_ACL_INVALID",
  "wiki_write_conflict",
  "config_audit_unavailable",
  "SECURITY_STORE_UNAVAILABLE"
] as const;

export type WikiAccessErrorCode = (typeof WIKI_ACCESS_ERROR_CODES)[number];

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return "";
}

/** `true` when the failure means "the persisted state moved on". */
export function isWikiAccessConflict(error: unknown): boolean {
  const code = errorCodeOf(error);
  return (
    code === "wiki_write_conflict" ||
    code === "wiki_access_preview_stale" ||
    code === "wiki_upload_preview_stale" ||
    code === "wiki_batch_preview_stale" ||
    code === "wiki_expected_version_required" ||
    code === "wiki_access_change_pending"
  );
}

/** Stable, user-facing copy for one Wiki access error code. */
export function wikiAccessErrorText(error: unknown): string {
  const code = errorCodeOf(error);
  switch (code) {
    case "wiki_upload_access_required":
      return "缺少明确的访问权限选择，授权未写入（wiki_upload_access_required）";
    case "wiki_upload_preview_stale":
      return "上传预检已过期，授权与正文未写入（wiki_upload_preview_stale）";
    case "wiki_expected_version_required":
      return "缺少文档版本，请刷新后重新预检（wiki_expected_version_required）";
    case "wiki_access_preview_stale":
      return "权限预检已过期，请重新预检后确认（wiki_access_preview_stale）";
    case "wiki_batch_preview_stale":
      return "批量预检已过期，本批未写入任何文档（wiki_batch_preview_stale）";
    case "wiki_batch_empty":
      return "没有选择任何文档（wiki_batch_empty）";
    case "wiki_batch_limit_exceeded":
      return "单次最多批量管理 100 篇文档（wiki_batch_limit_exceeded）";
    case "wiki_batch_idempotency_conflict":
      return "同一批次标识已绑定另一份预检结果（wiki_batch_idempotency_conflict）";
    case "wiki_access_change_pending":
      return "该文档存在待核对的授权变更，当前拒绝继续写入（wiki_access_change_pending）";
    case "CONTEXT_ACL_INVALID":
      return "可访问角色声明无效，请重新选择（CONTEXT_ACL_INVALID）";
    case "wiki_write_conflict":
      return "该文档已被其他人更新，请重新加载后再保存（wiki_write_conflict）";
    case "config_audit_unavailable":
      return "配置审计不可用，本次授权未写入（config_audit_unavailable）";
    case "SECURITY_STORE_UNAVAILABLE":
      return "安全状态存储不可用，该文档继续拒绝访问（SECURITY_STORE_UNAVAILABLE）";
    default:
      break;
  }
  const message = error instanceof Error ? error.message : "";
  return message || "未知错误";
}

/* ─── Upload commit helpers ────────────────────────────────────────────────── */

/**
 * Spec 193 §4.3 — the runtime set of one declaration.
 * `missing | empty | corrupt` grant nobody; `roles` grant the declared ids;
 * `all` grants every formal Role.
 */
function wikiAclRuntimeSet(acl: WikiAclState | null | undefined): Set<string> | "all" {
  if (!acl) return new Set();
  if (acl.state === "all") return "all";
  if (acl.state === "roles") return new Set(acl.roles);
  return new Set();
}

/**
 * `true` when the first declaration grants strictly more than the second.
 *
 * Used as a conservative safety net: if the server preview reports a WIDER
 * authorization than the administrator selected, the commit is refused.
 * A narrower server result is safe and stays authoritative.
 */
export function wikiAclWidens(
  serverAcl: WikiAclState | null | undefined,
  clientAcl: WikiAclState | null | undefined
): boolean {
  const server = wikiAclRuntimeSet(serverAcl);
  const client = wikiAclRuntimeSet(clientAcl);
  if (server === "all") {
    return client !== "all";
  }
  if (client === "all") {
    return false;
  }
  for (const role of server) {
    if (!client.has(role)) {
      return true;
    }
  }
  return false;
}

/**
 * The authorization that will be written for one upload selection.
 * `preserve_current` keeps the persisted declaration verbatim (including a
 * corrupt one); `use_uploaded` adopts the uploaded declaration; `set`
 * replaces it with the normalized explicit value.
 */
export function wikiUploadFinalAcl(
  selection: WikiUploadAccessSelection | null,
  currentAcl: WikiAclState | null,
  uploadedAcl: WikiAclState | null
): WikiAclState | null {
  if (!selection) return null;
  if (selection.mode === "preserve_current") return currentAcl;
  if (selection.mode === "use_uploaded") return uploadedAcl;
  const roles = selection.allowed_roles;
  if (roles.includes("*")) return { state: "all" };
  if (roles.length === 0) return { state: "empty" };
  return { state: "roles", roles: [...roles] };
}

/** `true` when the upload changes the persisted authorization. */
export function wikiUploadAuthorizationChanged(
  selection: WikiUploadAccessSelection | null,
  currentAcl: WikiAclState | null,
  uploadedAcl: WikiAclState | null
): boolean {
  if (!selection) return false;
  if (selection.mode === "preserve_current") return false;
  const final = wikiUploadFinalAcl(selection, currentAcl, uploadedAcl);
  if (!final) return true;
  return !wikiAclEquals(final, currentAcl);
}

/** The registered submit label of the upload preflight. */
export function wikiUploadCommitLabel(
  mode: "create" | "replace",
  finalAcl: WikiAclState | null,
  authorizationChanged: boolean
): string {
  if (!finalAcl) {
    // No selection yet: the neutral label, the guard explains the blocker.
    return mode === "create" ? "上传并授权" : "覆盖并保留授权";
  }
  const isAll = finalAcl.state === "all";
  const isEmpty = wikiAclIsEmpty(finalAcl);
  if (mode === "create") {
    if (isAll) return "上传并设为所有角色可见";
    if (isEmpty) return "上传并保持无人可见";
    return "上传并授权";
  }
  if (isAll) return "覆盖并设为所有角色可见";
  if (isEmpty) return "覆盖并保持无人可见";
  return authorizationChanged ? "覆盖并更新授权" : "覆盖并保留授权";
}

export type WikiUploadCommitGuard = {
  label: string;
  blocked: boolean;
  reason: string | null;
};

/**
 * The single submit gate of the upload preflight. Every condition blocks the
 * commit; the first reason is the one the administrator has to resolve.
 */
export function wikiUploadCommitGuard(params: {
  mode: "create" | "replace";
  selection: WikiUploadAccessSelection | null;
  currentAcl: WikiAclState | null;
  uploadedAcl: WikiAclState | null;
  previewReady: boolean;
  previewLoading: boolean;
  previewError: string | null;
  previewDigest: string | null;
  roleReady: boolean;
  emptyConfirmed: boolean;
  allConfirmed: boolean;
  corruptBlocked: boolean;
  /** The authorization the server preview reports for this selection. */
  serverFinalAcl?: WikiAclState | null;
}): WikiUploadCommitGuard {
  const final = wikiUploadFinalAcl(params.selection, params.currentAcl, params.uploadedAcl);
  const label = wikiUploadCommitLabel(
    params.mode,
    final,
    wikiUploadAuthorizationChanged(params.selection, params.currentAcl, params.uploadedAcl)
  );
  let reason: string | null = null;
  if (params.corruptBlocked) {
    reason = "文件内可访问角色声明已损坏，请忽略该声明并重新设置后再上传。";
  } else if (!params.selection) {
    reason = "尚未选择可访问角色。";
  } else if (params.previewLoading) {
    reason = "上传预检进行中，请稍候。";
  } else if (params.previewError) {
    reason = `上传预检失败：${params.previewError}`;
  } else if (!params.previewReady || !params.previewDigest) {
    reason = "上传预检尚未完成，暂不能提交。";
  } else if (!params.roleReady) {
    reason = "可授权角色仍在加载或读取失败，暂不能提交。";
  } else if (
    params.serverFinalAcl !== undefined &&
    wikiAclWidens(params.serverFinalAcl, final)
  ) {
    reason = "服务端预检的授权范围比所选更大，请重新预检后再提交。";
  } else if (wikiAclIsEmpty(final) && !params.emptyConfirmed) {
    reason = "请确认上传后 Agent 暂时无法访问，或改选可访问角色。";
  } else if (final?.state === "all" && !params.allConfirmed) {
    reason = "请确认所有角色可见后再提交。";
  }
  return { label, blocked: reason !== null, reason };
}

/* ─── Request helpers ──────────────────────────────────────────────────────── */


export function fetchWikiAccessSummary(key: string): Promise<WikiAccessSummary> {
  return apiGet<WikiAccessSummary>(`/api/wiki/${encodeURIComponent(key)}/access`);
}

export function previewWikiAccess(
  key: string,
  body: WikiAccessPreviewRequest
): Promise<WikiAccessPreview> {
  return apiPost<WikiAccessPreview>(`/api/wiki/${encodeURIComponent(key)}/access/preview`, body);
}

export function saveWikiAccess(
  key: string,
  body: WikiAccessSaveRequest
): Promise<WikiAccessSaveResult> {
  return apiPut<WikiAccessSaveResult>(`/api/wiki/${encodeURIComponent(key)}/access`, body);
}

export function previewWikiBatchAccess(
  body: WikiBatchAccessPreviewRequest
): Promise<WikiBatchAccessPlan> {
  return apiPost<WikiBatchAccessPlan>("/api/wiki/access/batch/preview", body);
}

export function commitWikiBatchAccess(
  body: WikiBatchAccessCommitRequest
): Promise<WikiBatchAccessResult> {
  return apiPost<WikiBatchAccessResult>("/api/wiki/access/batch/commit", body);
}

export function fetchWikiBatchAccessResult(operationId: string): Promise<WikiBatchAccessResult> {
  return apiGet<WikiBatchAccessResult>(
    `/api/wiki/access/batches/${encodeURIComponent(operationId)}`
  );
}

/** The bulk statuses a retry may contain (Spec 193 §7.4). */
export const WIKI_BATCH_RETRYABLE_STATUSES = ["conflict", "failed", "not_run"] as const;

/** `true` when the item may take part in a "仅重试未完成项" round. */
export function isWikiBatchRetryable(status: string): boolean {
  return (WIKI_BATCH_RETRYABLE_STATUSES as readonly string[]).includes(status);
}
