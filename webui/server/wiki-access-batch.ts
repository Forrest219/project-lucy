import { createHash, randomUUID } from "node:crypto";
import { parseObjectAcl, type ObjectAcl } from "./proxy/context-acl.js";
import {
  classifyAccessDirection,
  loadWikiAccessConfigSnapshot,
  resolveWikiAccessEffects,
  type AccessDirection,
  type WikiAccessConfigSnapshot
} from "./wiki-access-effects.js";
import {
  applyRawAllowedRoles,
  canonicalDeclaration,
  computeWikiAccessDigest,
  mutateWikiAccessUnlocked,
  normalizeRequestedRoles,
  readAclDeclaration,
  readWikiBytes,
  WikiAccessError
} from "./wiki-access-operation.js";
import { createWikiVersionSnapshot } from "./wiki.js";
import { getSecurityStore } from "./security/instance.js";
import type { SecurityStore } from "./security/store.js";
import { systemActor, type TrustedActor } from "./security/request-actor.js";
import { withWikiWriteQueue } from "./wiki-write-queue.js";
import { wikiContentHash } from "./wiki-hash.js";
import { normalizeWikiKey } from "./wiki-key.js";
import { ForbiddenPathError } from "./fs-safe.js";
import {
  createWikiBatchJournal,
  findWikiBatchByIdempotencyKey,
  readWikiBatchJournal,
  setWikiBatchStatus,
  updateWikiBatchItem
} from "./wiki-access-batch-journal.js";

/**
 * Spec 193 §7 — the recoverable bulk authorization run.
 *
 * The batch is NOT a cross-file transaction:
 *
 * - the pre-entry baseline check rejects the WHOLE batch before any write
 *   and before any journal row exists,
 * - a per-document conflict is a per-document result and the remaining
 *   documents still run,
 * - a systemic failure (audit, journal, security store) stops the remaining
 *   documents and marks them `not_run`,
 * - the documents that were applied stay applied.
 *
 * The selection is a set of explicit Wiki KEYS. It is never a directory rule
 * and it never affects documents that are added later.
 */

export const WIKI_BATCH_MAX_DOCUMENTS = 100;

export type WikiBatchAccessAction =
  | { mode: "add"; role_ids: string[] }
  | { mode: "replace"; allowed_roles: string[] };

export interface WikiBatchIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface WikiBatchPlanItem {
  key: string;
  title?: string;
  file_version: string;
  current_acl: ObjectAcl;
  next_acl: ObjectAcl;
  direction: AccessDirection;
  noop: boolean;
  issues: WikiBatchIssue[];
}

export interface WikiBatchPlanSummary {
  total: number;
  widening: number;
  narrowing: number;
  unchanged: number;
  corrupt: number;
  missing_channel: number;
  affected_agent_count: number;
  blocking: number;
}

export interface WikiBatchPlan {
  operation_id: string;
  plan_digest: string;
  action: WikiBatchAccessAction;
  role_channel_version: string;
  items: WikiBatchPlanItem[];
  summary: WikiBatchPlanSummary;
  blocking: boolean;
}

export type WikiBatchItemStatus =
  | "pending"
  | "applied"
  | "noop"
  | "conflict"
  | "failed"
  | "not_run"
  | "needs_review";

export interface WikiBatchResultItem {
  key: string;
  status: WikiBatchItemStatus;
  file_version?: string;
  current_acl?: ObjectAcl;
  next_acl?: ObjectAcl;
  direction?: AccessDirection;
  error_code?: string;
  error_message?: string;
}

export interface WikiBatchResult {
  operation_id: string;
  plan_digest: string;
  action: WikiBatchAccessAction;
  role_channel_version: string;
  status: "pending" | "completed" | "failed";
  items: WikiBatchResultItem[];
  summary: WikiBatchPlanSummary;
  created_at: string;
  updated_at: string;
}

interface NormalizedSelection {
  items: Array<{ key: string; expected_version: string }>;
}

/**
 * The canonical spelling of a requested Wiki key.
 *
 * A key that cannot be normalized is kept verbatim: the plan then reports it
 * as a per-item problem (`wiki_batch_document_missing`) instead of throwing
 * an unhandled path error out of the batch.
 */
function canonicalizeBatchKey(rawKey: string): string {
  if (!rawKey) return "";
  try {
    return normalizeWikiKey(rawKey);
  } catch {
    return rawKey;
  }
}

/**
 * Read one batch document.
 *
 * A missing document and an illegal key are both "this item cannot be
 * processed"; neither may abort the whole batch.
 */
async function readBatchDocument(projectRoot: string, key: string): Promise<string | null> {
  try {
    return await readWikiBytes(projectRoot, key);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof ForbiddenPathError) return null;
    throw error;
  }
}

/**
 * Normalize the requested selection.
 *
 * Identical duplicates are merged; the same key with two different versions
 * is a stale preview, not a silent choice.
 *
 * Spec 193 §7.3 — the server canonicalizes the key BEFORE deduplicating, so
 * two spellings of the same document (`global/a.md` and `global/b/../a.md`)
 * are ONE item. A key that is not a legal Wiki path is kept verbatim so the
 * plan reports it as a per-item problem instead of failing the whole batch.
 */
export function normalizeBatchSelection(
  raw: Array<{ key: string; expected_version?: string }> | undefined
): NormalizedSelection {
  const byKey = new Map<string, string>();
  for (const entry of raw ?? []) {
    const key = canonicalizeBatchKey(String(entry?.key ?? "").trim());
    if (!key) continue;
    const version = String(entry?.expected_version ?? "").trim();
    const existing = byKey.get(key);
    if (existing !== undefined && existing !== version) {
      throw new WikiAccessError(
        "wiki_batch_preview_stale",
        `同一文档携带了不同的版本：${key}`,
        409
      );
    }
    byKey.set(key, version);
  }
  const items = Array.from(byKey.entries())
    .map(([key, expected_version]) => ({ key, expected_version }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (items.length === 0) {
    throw new WikiAccessError("wiki_batch_empty", "请至少选择一篇文档。", 400);
  }
  if (items.length > WIKI_BATCH_MAX_DOCUMENTS) {
    throw new WikiAccessError(
      "wiki_batch_limit_exceeded",
      `一次最多处理 ${WIKI_BATCH_MAX_DOCUMENTS} 篇文档，请缩小范围。`,
      400
    );
  }
  return { items };
}

/** Normalize the action and refuse the combinations the spec forbids. */
export function normalizeBatchAction(raw: unknown): WikiBatchAccessAction {
  const action = raw as Partial<WikiBatchAccessAction> | null | undefined;
  if (!action || typeof action !== "object") {
    throw new WikiAccessError("wiki_batch_empty", "缺少批量授权动作。", 400);
  }
  if (action.mode === "add") {
    const roleIds = Array.isArray(action.role_ids)
      ? action.role_ids.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    if (roleIds.length === 0) {
      throw new WikiAccessError("wiki_batch_empty", "添加角色至少需要一个角色。", 400);
    }
    if (roleIds.includes("*")) {
      throw new WikiAccessError(
        "CONTEXT_ACL_INVALID",
        "添加角色不接受所有角色可见，请改用替换可访问角色。",
        400
      );
    }
    return { mode: "add", role_ids: [...new Set(roleIds)].sort() };
  }
  if (action.mode === "replace") {
    const normalized = normalizeRequestedRoles(action.allowed_roles);
    return { mode: "replace", allowed_roles: normalized };
  }
  throw new WikiAccessError("wiki_batch_empty", "不支持的批量授权动作。", 400);
}

function aclOfDeclaration(declaration: { declared: boolean; value: unknown }): ObjectAcl {
  return parseObjectAcl(declaration.value, declaration.declared);
}

/** The ACL an action produces for one document. */
export function applyBatchAction(
  action: WikiBatchAccessAction,
  currentAcl: ObjectAcl
): { nextAcl: ObjectAcl; issues: WikiBatchIssue[] } {
  if (action.mode === "replace") {
    const nextAcl = parseObjectAcl(action.allowed_roles, true);
    return { nextAcl, issues: [] };
  }
  if (currentAcl.state === "corrupt") {
    return {
      nextAcl: currentAcl,
      issues: [
        {
          code: "wiki_batch_acl_corrupt",
          message: "当前授权声明已损坏，请先修复或改用替换可访问角色。",
          blocking: true
        }
      ]
    };
  }
  if (currentAcl.state === "all") {
    // `all` already covers every formal Role: adding roles changes nothing.
    return { nextAcl: currentAcl, issues: [] };
  }
  const existing = currentAcl.state === "roles" ? currentAcl.roles : [];
  const merged = Array.from(new Set([...existing, ...action.role_ids])).sort();
  return { nextAcl: parseObjectAcl(merged, true), issues: [] };
}

/** The digest that binds a bulk plan to its baselines and targets. */
export function computeWikiBatchPlanDigest(input: {
  operationId: string;
  action: WikiBatchAccessAction;
  roleChannelVersion: string;
  items: Array<{ key: string; fileVersion: string; nextAcl: ObjectAcl; direction: AccessDirection; noop: boolean }>;
}): string {
  const payload = JSON.stringify({
    operationId: input.operationId,
    action: input.action,
    roleChannelVersion: input.roleChannelVersion,
    items: input.items
      .map((item) => ({
        key: item.key,
        fileVersion: item.fileVersion,
        nextAcl:
          item.nextAcl.state === "roles"
            ? { state: item.nextAcl.state, roles: [...item.nextAcl.roles].sort() }
            : { state: item.nextAcl.state },
        direction: item.direction,
        noop: item.noop
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
  });
  return `wbd-${computeDigestHex(payload)}`;
}

function computeDigestHex(payload: string): string {
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

/**
 * Build the bulk plan.
 *
 * The Role / Agent configuration is read exactly once.
 */
export async function previewWikiAccessBatch(
  projectRoot: string,
  request: {
    items?: Array<{ key: string; expected_version?: string }>;
    action?: unknown;
    operation_id?: string;
  }
): Promise<WikiBatchPlan> {
  const selection = normalizeBatchSelection(request.items);
  const action = normalizeBatchAction(request.action);
  const operationId = String(request.operation_id ?? "").trim() || `wbo-${randomUUID()}`;
  const snapshot = await loadWikiAccessConfigSnapshot(projectRoot);

  const items: WikiBatchPlanItem[] = [];
  for (const entry of selection.items) {
    const currentText = await readBatchDocument(projectRoot, entry.key);
    if (currentText === null) {
      items.push({
        key: entry.key,
        file_version: entry.expected_version,
        current_acl: { state: "missing" },
        next_acl: { state: "missing" },
        direction: "neutral",
        noop: true,
        issues: [
          {
            code: "wiki_batch_document_missing",
            message: "文档不存在，请刷新后重新选择。",
            blocking: true
          }
        ]
      });
      continue;
    }
    const fileVersion = wikiContentHash(currentText);
    if (entry.expected_version && entry.expected_version !== fileVersion) {
      items.push({
        key: entry.key,
        file_version: fileVersion,
        current_acl: { state: "missing" },
        next_acl: { state: "missing" },
        direction: "neutral",
        noop: true,
        issues: [
          {
            code: "wiki_batch_version_stale",
            message: "文档已被其他修改更新，请刷新后重新预检。",
            blocking: true
          }
        ]
      });
      continue;
    }
    const currentAcl = aclOfDeclaration(readAclDeclaration(currentText));
    const { nextAcl, issues } = applyBatchAction(action, currentAcl);
    const direction = classifyAccessDirection(currentAcl, nextAcl);
    const noop = canonicalKeyOf(currentAcl) === canonicalKeyOf(nextAcl);
    items.push({
      key: entry.key,
      file_version: fileVersion,
      current_acl: currentAcl,
      next_acl: nextAcl,
      direction,
      noop,
      issues
    });
  }

  const summary = summarizeBatch(items, snapshot);
  const plan_digest = computeWikiBatchPlanDigest({
    operationId,
    action,
    roleChannelVersion: snapshot.role_channel_version,
    items: items.map((item) => ({
      key: item.key,
      fileVersion: item.file_version,
      nextAcl: item.next_acl,
      direction: item.direction,
      noop: item.noop
    }))
  });

  return {
    operation_id: operationId,
    plan_digest,
    action,
    role_channel_version: snapshot.role_channel_version,
    items,
    summary,
    blocking: items.some((item) => item.issues.some((issue) => issue.blocking))
  };
}

function canonicalKeyOf(acl: ObjectAcl): string {
  if (acl.state === "roles") return `roles:${[...acl.roles].sort().join(",")}`;
  if (acl.state === "corrupt") return `corrupt:${acl.detail}`;
  return acl.state;
}

/**
 * The bulk summary.
 *
 * `missing_channel` counts the documents whose TARGET state declares at least
 * one Role without the Wiki channel; `affected_agent_count` counts the
 * enabled Agents that are actually bound to one of the declared Roles.
 */
function summarizeBatch(
  items: WikiBatchPlanItem[],
  snapshot: WikiAccessConfigSnapshot
): WikiBatchPlanSummary {
  let widening = 0;
  let narrowing = 0;
  let unchanged = 0;
  let corrupt = 0;
  let missingChannel = 0;
  let blocking = 0;
  const affectedAgents = new Set<string>();

  for (const item of items) {
    if (item.direction === "widen") widening += 1;
    else if (item.direction === "narrow") narrowing += 1;
    else unchanged += 1;
    if (item.current_acl.state === "corrupt") corrupt += 1;
    if (item.issues.some((issue) => issue.blocking)) blocking += 1;

    const effects = resolveWikiAccessEffects(item.next_acl, snapshot);
    if (effects.declared_without_read > 0 || effects.declared_without_discover > 0) {
      missingChannel += 1;
    }
    for (const effect of effects.role_effects) {
      for (const agentId of effect.assigned_agent_ids) affectedAgents.add(agentId);
    }
  }

  return {
    total: items.length,
    widening,
    narrowing,
    unchanged,
    corrupt,
    missing_channel: missingChannel,
    affected_agent_count: affectedAgents.size,
    blocking
  };
}

/* -------------------------------------------------------------------------- */
/* The commit                                                                  */
/* -------------------------------------------------------------------------- */

function isSystemicFailure(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return (
    code === "config_audit_unavailable" ||
    code === "SECURITY_STORE_UNAVAILABLE" ||
    code === "config_audit_rolled_back" ||
    code === "config_audit_rollback_failed" ||
    code === "config_audit_intent_unavailable"
  );
}

function isItemFailure(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null)?.code ?? "");
  return code === "wiki_write_conflict" || code === "wiki_expected_version_required";
}

async function loadStore(): Promise<SecurityStore> {
  const store = await getSecurityStore();
  if (!store.ok) {
    throw new WikiAccessError(
      "SECURITY_STORE_UNAVAILABLE",
      "安全状态存储不可用，未写入任何内容。",
      503
    );
  }
  return store.value;
}

/** The journal stores the action AND the plan summary so the result is complete. */
type JournalEnvelope = {
  action: WikiBatchAccessAction;
  summary?: WikiBatchPlanSummary;
};

function parseJournalEnvelope(raw: string): JournalEnvelope {
  try {
    const parsed = JSON.parse(raw) as Partial<JournalEnvelope> & Partial<WikiBatchAccessAction>;
    if (parsed && typeof parsed === "object" && "action" in parsed && parsed.action) {
      return { action: parsed.action as WikiBatchAccessAction, summary: parsed.summary };
    }
    if (parsed && typeof parsed === "object" && "mode" in parsed && parsed.mode) {
      return { action: parsed as WikiBatchAccessAction };
    }
  } catch {
    // fall through
  }
  return { action: { mode: "replace", allowed_roles: [] } };
}

function journalToResult(
  journal: NonNullable<ReturnType<typeof readWikiBatchJournal>>,
  envelope: JournalEnvelope
): WikiBatchResult {
  const items: WikiBatchResultItem[] = journal.items.map((item) => ({
    key: item.wikiKey,
    status: item.status,
    error_code: item.errorCode ?? undefined,
    error_message: item.errorMessage ?? undefined
  }));
  const summary: WikiBatchPlanSummary = envelope.summary ?? {
    total: items.length,
    widening: 0,
    narrowing: 0,
    unchanged: 0,
    corrupt: 0,
    missing_channel: 0,
    affected_agent_count: 0,
    blocking: 0
  };
  return {
    operation_id: journal.record.operationId,
    plan_digest: journal.record.planDigest,
    action: envelope.action,
    role_channel_version: journal.record.roleChannelVersion,
    status: journal.record.status,
    items,
    summary,
    created_at: new Date(journal.record.createdAt).toISOString(),
    updated_at: new Date(journal.record.updatedAt).toISOString()
  };
}

/**
 * Commit a bulk authorization plan.
 *
 * The order is fixed by the spec:
 *
 * 1. the idempotency record is consulted FIRST — the same key with the same
 *    digest returns the existing state and never writes twice,
 * 2. every baseline and the Role graph are re-read; a stale baseline rejects
 *    the WHOLE batch before any write and before any journal row exists,
 * 3. the durable journal and the idempotency binding are created atomically,
 * 4. the documents are processed in a deterministic key order.
 */
export async function commitWikiAccessBatch(
  projectRoot: string,
  request: {
    operation_id?: string;
    plan_digest?: string;
    idempotency_key?: string;
    items?: Array<{ key: string; expected_version?: string }>;
    action?: unknown;
    confirmed_empty?: boolean;
    confirmed_all?: boolean;
  },
  actor?: TrustedActor
): Promise<WikiBatchResult> {
  const operationId = String(request.operation_id ?? "").trim();
  const planDigest = String(request.plan_digest ?? "").trim();
  const idempotencyKey = String(request.idempotency_key ?? "").trim();
  if (!operationId) {
    throw new WikiAccessError("wiki_batch_preview_stale", "缺少批量操作 ID。", 409);
  }
  if (!planDigest) {
    throw new WikiAccessError("wiki_batch_preview_stale", "缺少批量预检摘要。", 409);
  }
  if (!idempotencyKey) {
    throw new WikiAccessError("wiki_batch_preview_stale", "缺少幂等键。", 409);
  }

  return withWikiWriteQueue(async () => {
    const store = await loadStore();

    // 1. The idempotency record comes first.
    const existing = findWikiBatchByIdempotencyKey(store, idempotencyKey);
    if (existing) {
      if (existing.planDigest !== planDigest) {
        throw new WikiAccessError(
          "wiki_batch_idempotency_conflict",
          "该幂等键已绑定另一份批量计划。",
          409
        );
      }
      const journal = readWikiBatchJournal(store, existing.operationId);
      if (journal) {
        return journalToResult(journal, parseJournalEnvelope(journal.record.actionJson));
      }
    }

    const selection = normalizeBatchSelection(request.items);
    const action = normalizeBatchAction(request.action);

    // 2. Re-read every baseline and the Role graph. A stale baseline rejects
    //    the WHOLE batch — zero writes, zero journal.
    const plan = await previewWikiAccessBatch(projectRoot, {
      items: selection.items,
      action,
      operation_id: operationId
    });
    if (plan.plan_digest !== planDigest) {
      throw new WikiAccessError(
        "wiki_batch_preview_stale",
        "批量预检已过期，请重新预检后提交。",
        409
      );
    }
    if (plan.blocking) {
      const blocking = plan.items
        .flatMap((item) => item.issues.filter((issue) => issue.blocking))
        .map((issue) => issue.message);
      throw new WikiAccessError(
        "wiki_batch_blocked",
        blocking[0] ?? "批量授权存在阻断问题，请修正后重试。",
        400
      );
    }

    // The empty / all confirmations are checked once for the whole batch.
    const needsEmpty = plan.items.some((item) => item.next_acl.state === "empty");
    const needsAll = plan.items.some((item) => item.next_acl.state === "all");
    if (needsEmpty && request.confirmed_empty !== true) {
      throw new WikiAccessError(
        "wiki_batch_blocked",
        "批量授权包含无人可见的文档，请确认后提交。",
        400
      );
    }
    if (needsAll && request.confirmed_all !== true) {
      throw new WikiAccessError(
        "wiki_batch_blocked",
        "批量授权包含所有角色可见的文档，请完成独立确认。",
        400
      );
    }

    // 3. The durable journal AND the idempotency binding, atomically.
    const journal = createWikiBatchJournal(store, {
      operationId,
      planDigest,
      idempotencyKey,
      actionJson: JSON.stringify({ action, summary: plan.summary } satisfies JournalEnvelope),
      roleChannelVersion: plan.role_channel_version,
      items: plan.items.map((item) => ({
        wikiKey: item.key,
        expectedVersion: item.file_version,
        aclSummary: canonicalKeyOf(item.next_acl),
        direction: item.direction
      }))
    });
    if (!journal) {
      throw new WikiAccessError(
        "SECURITY_STORE_UNAVAILABLE",
        "批量授权日志写入失败，未修改任何文档。",
        503
      );
    }

    // 4. The deterministic per-document loop.
    const resolvedActor = actor ?? systemActor();
    let systemicFailure = false;
    for (const item of plan.items) {
      if (systemicFailure) {
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "not_run",
          errorCode: "wiki_batch_stopped",
          errorMessage: "前序文档发生系统性失败，后续文档未执行。"
        });
        continue;
      }

      const currentText = await readBatchDocument(projectRoot, item.key);
      if (currentText === null) {
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "conflict",
          errorCode: "wiki_batch_document_missing",
          errorMessage: "文档不存在。"
        });
        continue;
      }
      const currentVersion = wikiContentHash(currentText);
      if (currentVersion !== item.file_version) {
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "conflict",
          errorCode: "wiki_write_conflict",
          errorMessage: "文档已被其他修改更新。"
        });
        continue;
      }

      const currentAcl = aclOfDeclaration(readAclDeclaration(currentText));
      const { nextAcl } = applyBatchAction(action, currentAcl);
      if (canonicalKeyOf(nextAcl) !== canonicalKeyOf(item.next_acl)) {
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "failed",
          errorCode: "wiki_batch_target_mismatch",
          errorMessage: "目标授权与预检结果不一致。"
        });
        continue;
      }
      if (canonicalKeyOf(nextAcl) === canonicalKeyOf(currentAcl)) {
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "noop",
          aclSummary: canonicalKeyOf(nextAcl),
          direction: item.direction
        });
        continue;
      }

      let needsReview = false;
      try {
        const mutation = await mutateWikiAccessUnlocked({
          projectRoot,
          key: item.key,
          expectedVersion: currentVersion,
          existence: "must_exist",
          buildTarget: (text) => ({
            targetMarkdown: applyRawAllowedRoles(text, canonicalDeclaration(nextAcl)),
            nextAcl
          }),
          actor: resolvedActor,
          versionOperation: "access_update",
          changeType: "wiki_access_update",
          sharedOperationId: operationId,
          noOpWhen: (current, next) => canonicalKeyOf(current) === canonicalKeyOf(next),
          writeVersionSnapshot: async (markdown) => {
            await createWikiVersionSnapshot(projectRoot, item.key, markdown, {
              operation: "access_update"
            });
          },
          onNeedsReview: () => {
            needsReview = true;
          }
        });
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: mutation.status === "noop" ? "noop" : "applied",
          aclSummary: canonicalKeyOf(nextAcl),
          direction: item.direction
        });
      } catch (error) {
        if (needsReview) {
          updateWikiBatchItem(store, {
            operationId,
            wikiKey: item.key,
            status: "needs_review",
            aclSummary: canonicalKeyOf(nextAcl),
            direction: item.direction,
            errorCode: "wiki_access_change_pending",
            errorMessage: "扩权未提交，该文档保持拒绝并等待运维核对。"
          });
          continue;
        }
        if (isItemFailure(error)) {
          updateWikiBatchItem(store, {
            operationId,
            wikiKey: item.key,
            status: "conflict",
            errorCode: String((error as { code?: unknown }).code ?? "wiki_write_conflict"),
            errorMessage: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
        if (isSystemicFailure(error)) {
          systemicFailure = true;
          updateWikiBatchItem(store, {
            operationId,
            wikiKey: item.key,
            status: "failed",
            errorCode: String((error as { code?: unknown }).code ?? "config_audit_unavailable"),
            errorMessage: error instanceof Error ? error.message : String(error)
          });
          continue;
        }
        updateWikiBatchItem(store, {
          operationId,
          wikiKey: item.key,
          status: "failed",
          errorCode: String((error as { code?: unknown }).code ?? "wiki_batch_failed"),
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      }
    }

    setWikiBatchStatus(store, operationId, systemicFailure ? "failed" : "completed");
    const finalJournal = readWikiBatchJournal(store, operationId);
    if (!finalJournal) {
      throw new WikiAccessError(
        "SECURITY_STORE_UNAVAILABLE",
        "批量授权结果无法读取。",
        503
      );
    }
    return journalToResult(finalJournal, { action, summary: plan.summary });
  });
}

/** Read a durable bulk authorization result by its operation id. */
export async function getWikiAccessBatchResult(
  operationId: string
): Promise<WikiBatchResult | null> {
  const store = await loadStore();
  const journal = readWikiBatchJournal(store, operationId);
  if (!journal) return null;
  return journalToResult(journal, parseJournalEnvelope(journal.record.actionJson));
}
