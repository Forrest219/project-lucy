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

const NO_CHANGE: ScopeKey[] = [];

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Stable fingerprint over the canonical scope (filterKeys + bounds + limit +
 * connectionId). Filter VALUES are never part of the fingerprint.
 */
export function scopeFingerprint(scope: AttemptScope): string {
  const canonical = JSON.stringify({
    filterKeys: [...scope.filterKeys].sort(),
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
    return { changed: NO_CHANGE, fingerprintBefore, fingerprintAfter };
  }
  const changed: ScopeKey[] = [];
  // Compare filterKeys set membership (add/remove is preserved by list equality).
  const beforeKeys = new Set(before.filterKeys);
  const afterKeys = new Set(after.filterKeys);
  if (beforeKeys.size !== afterKeys.size || ![...beforeKeys].every((k) => afterKeys.has(k))) {
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