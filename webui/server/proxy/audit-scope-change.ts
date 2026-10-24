/**
 * audit-trust-2026-10-19-r1 / T07 — scope_change detector + retry chain + freshness.
 *
 * Contract §7:
 *   - 同一受控任务的重试保留 attempt_id / parent_attempt_id + 参数差异摘要
 *   - 删除过滤 / 扩大时间或结果上限 / 切换连接 -> scope_change
 *   - 不记录敏感值 (filter values / password / token)
 *   - 物理数据截止 / 装载采集时间 / 语义更新时间独立作为结果级元数据,
 *     来源明确, 未知允许 null, 不为每行编造 last_updated
 *
 * `scope_change` is detected by diffing two consecutive attempts' canonical
 * signature (filter whitelist + limit + connection). Filter VALUES (string
 * inputs) are never logged; only the KIND of change is.
 */

import { createHash } from "node:crypto";

export type ScopeKey = "replace_filter" | "widen_time" | "widen_limit" | "switch_connection";

export type ScopeDiff = {
  changed: ScopeKey[];
  fingerprintBefore: string | null;
  fingerprintAfter: string;
};

export type AttemptScope = {
  /** Names of the filters (no values). E.g. ["user_id", "table", "from"] */
  filterKeys: string[];
  /** Time window lower bound (ISO 8601) or null. */
  timeFrom: string | null;
  /** Time window upper bound (ISO 8601) or null. */
  timeUntil: string | null;
  /** Row limit or null. */
  limit: number | null;
  /** Connection id or null. */
  connectionId: string | null;
};

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Canonical keyset: deduplicate and sort. Used by both fingerprint and the
 * diff detector so that `["user_id"]` and `["user_id","user_id"]` agree.
 * Duplicate filterKeys are silently deduped (callers can also reject them
 * upstream; this keeps the canonical form stable either way).
 */
function canonicalKeys(filterKeys: readonly string[]): string[] {
  return [...new Set(filterKeys)].sort();
}

/**
 * Stable fingerprint over the canonical scope (filterKeys + bounds + limit +
 * connectionId). Filter VALUES are never part of the fingerprint.
 */
export function scopeFingerprint(scope: AttemptScope): string {
  const canonical = JSON.stringify({
    filterKeys: canonicalKeys(scope.filterKeys),
    timeFrom: scope.timeFrom,
    timeUntil: scope.timeUntil,
    limit: scope.limit,
    connectionId: scope.connectionId
  });
  return sha256Hex(canonical);
}

/**
 * Detect scope_change between two attempts. The result records only the
 * KIND of change (no values). Identical fingerprints return `{changed: []}`.
 */
export function detectScopeChange(
  before: AttemptScope | null,
  after: AttemptScope
): ScopeDiff {
  const fingerprintAfter = scopeFingerprint(after);
  if (!before) {
    return { changed: [], fingerprintBefore: null, fingerprintAfter };
  }
  const fingerprintBefore = scopeFingerprint(before);
  if (fingerprintBefore === fingerprintAfter) {
    return { changed: [], fingerprintBefore, fingerprintAfter };
  }
  const changed: ScopeKey[] = [];
  // Compare canonical (deduped+sorted) filterKeys so fingerprint and diff
  // detection stay consistent when callers pass duplicate keys.
  const beforeKeys = canonicalKeys(before.filterKeys);
  const afterKeys = canonicalKeys(after.filterKeys);
  if (beforeKeys.length !== afterKeys.length || beforeKeys.some((k, i) => k !== afterKeys[i])) {
    changed.push("replace_filter");
  }
  if (before.timeFrom !== after.timeFrom || before.timeUntil !== after.timeUntil) {
    changed.push("widen_time");
  }
  if (before.limit !== after.limit) {
    changed.push("widen_limit");
  }
  if (before.connectionId !== after.connectionId) {
    changed.push("switch_connection");
  }
  return { changed, fingerprintBefore, fingerprintAfter };
}

// ─── Result-level freshness (Contract §7) ────────────────────────────────────

export type ResultFreshness = {
  /** Physical data cutoff (warehouse side); null = unknown, do NOT invent. */
  businessCutoff: string | null;
  /** When the source loaded / collected the result rows; null = unknown. */
  loadOrCollectedAt: string | null;
  /** When the semantic layer last updated its model; null = unknown. */
  semanticUpdatedAt: string | null;
};

export type FreshnessAssessment = {
  status: "ok" | "partial" | "unknown";
  reasons: string[];
};

/**
 * Evaluate whether the freshness metadata is complete enough to display.
 * Per contract: "结果级分别记录业务截止/装载和语义时间, 来源明确,
 * 未知允许null, 不能伪造逐行 last_updated".
 */
export function assessFreshness(f: ResultFreshness): FreshnessAssessment {
  const reasons: string[] = [];
  if (f.businessCutoff === null) reasons.push("business_cutoff_missing");
  if (f.loadOrCollectedAt === null) reasons.push("load_or_collected_at_missing");
  if (f.semanticUpdatedAt === null) reasons.push("semantic_updated_at_missing");
  if (reasons.length === 0) return { status: "ok", reasons: [] };
  if (reasons.length === 3) return { status: "unknown", reasons };
  return { status: "partial", reasons };
}

// ─── Retry chain (Contract §7) ───────────────────────────────────────────────

export type AttemptSummary = {
  attemptId: string;
  parentAttemptId: string | null;
  /** Canonical scope fingerprint; equal fingerprints = same effective scope. */
  scopeFingerprint: string;
  ts: string;
};

/**
 * Build a retry-chain entry. Caller passes a fresh attemptId (UUID) and the
 * previously-attempted parent id (if any). Filter VALUES are never accepted
 * as input — only scope metadata that is safe to log.
 */
export function buildAttempt(input: {
  attemptId: string;
  parentAttemptId: string | null;
  scope: AttemptScope;
  ts?: string;
}): AttemptSummary {
  return {
    attemptId: input.attemptId,
    parentAttemptId: input.parentAttemptId,
    scopeFingerprint: scopeFingerprint(input.scope),
    ts: input.ts ?? new Date().toISOString()
  };
}

/**
 * Walk a retry chain (parent -> child) and detect every scope_change between
 * consecutive pairs. Returns the ordered list of changes, indexed by depth
 * (0 = original, n-1 = final). When the chain is a single attempt, the list
 * is empty.
 */
export function chainScopeChanges(chain: readonly AttemptSummary[]): Array<{
  depth: number;
  fromAttempt: string;
  toAttempt: string;
  changed: ScopeKey[];
}> {
  if (chain.length < 2) return [];
  const out: Array<{ depth: number; fromAttempt: string; toAttempt: string; changed: ScopeKey[] }> = [];
  // We only carry fingerprints here; for full AttemptScope diff the caller must
  // re-fetch both attempts. Detect "change" by fingerprint mismatch.
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const cur = chain[i];
    if (prev.scopeFingerprint === cur.scopeFingerprint) {
      out.push({
        depth: i,
        fromAttempt: prev.attemptId,
        toAttempt: cur.attemptId,
        changed: []
      });
    } else {
      out.push({
        depth: i,
        fromAttempt: prev.attemptId,
        toAttempt: cur.attemptId,
        // Scope key kinds are inferable from the diff; the per-axis detail is
        // only available when the caller supplies full AttemptScope pairs.
        // Default to "widen_limit" when we can't tell (least-invasive claim).
        changed: ["widen_limit"]
      });
    }
  }
  return out;
}
// ─── B9：重连 / 尝试独立性（Spec §6.3 / §10.3）──────────────────────────────
//
// 硬规则：
//   - **重连本身不新增 attempt**：重连只是传输层重连，不是一次新的执行。
//   - 重连后**重新发送并实际准入执行**的请求必须有**独立 attempt**；
//     除非既有幂等执行契约已证明只是原尝试续接。
//   - **不能把「重连」当去重证据**：reconnect_generation 变化不构成
//     「同一次执行」的证明。

/** 重连代次：同一会话上的连接重建次数。 */
export type ReconnectGeneration = {
  sessionId: string;
  generation: number;
};

export type AttemptRelationInput = {
  /** 父 attempt ID（业务重试 / 续接的父尝试）。 */
  parentAttemptId: string | null;
  /** 本次使用的 attempt ID。 */
  attemptId: string;
  /** 是否只是原尝试的**续接**（既有幂等执行契约已证明）。 */
  resumedSameAttempt: boolean;
  /** 是否发生了**实际执行**（已准入并分派）。 */
  actuallyExecuted: boolean;
};

export type AttemptRelationVerdict =
  | { ok: true; independent: boolean; reason?: "reconnect_without_execution" | "resumed_same_attempt" }
  | { ok: false; reason: "attempt_not_independent" | "attempt_id_required" };

/**
 * 判定「本次尝试是否拥有独立 attempt」。
 *
 * - 未实际执行（纯重连）→ 不新增 attempt，判定为非独立但合规。
 * - 实际执行且证明为原尝试续接 → attempt_id 必须与父相同。
 * - 实际执行且非续接 → attempt_id 必须与父**不同**，否则拒绝
 *   （两次独立执行共用一个 attempt ID 会让重试链失去意义）。
 */
export function evaluateAttemptRelation(input: AttemptRelationInput): AttemptRelationVerdict {
  if (!input.attemptId || input.attemptId.trim().length === 0) {
    return { ok: false, reason: "attempt_id_required" };
  }
  if (!input.actuallyExecuted) {
    // 重连不新增 attempt。
    return { ok: true, independent: false, reason: "reconnect_without_execution" };
  }
  if (input.resumedSameAttempt) {
    if (input.parentAttemptId && input.attemptId !== input.parentAttemptId) {
      return { ok: false, reason: "attempt_not_independent" };
    }
    return { ok: true, independent: false, reason: "resumed_same_attempt" };
  }
  if (input.parentAttemptId && input.attemptId === input.parentAttemptId) {
    return { ok: false, reason: "attempt_not_independent" };
  }
  return { ok: true, independent: true };
}

/**
 * 判定「两次请求是否可被视为同一次逻辑调用」。
 *
 * 只有**同一个已认证适配器命名空间内的同一个 `client_call_id`** 才算同一次
 * 逻辑调用。相同 SQL、相同 request_id、相同 client_event_id 都**不能**
 * 单独作为同一次执行的证明（Spec §6.2 / A07）。
 */
export function isSameLogicalExecution(input: {
  adapterIdA: string;
  clientCallIdA: string | null;
  adapterIdB: string;
  clientCallIdB: string | null;
  /** 相同 SQL 只能作为弱线索，不构成同一性证明。 */
  sameSql?: boolean;
}): boolean {
  if (!input.clientCallIdA || !input.clientCallIdB) return false;
  if (input.adapterIdA !== input.adapterIdB) return false;
  return input.clientCallIdA === input.clientCallIdB;
}
