/**
 * 202608 P1 — Tiered Access Governance Gate
 * Spec: `webui/docs/64-tiered-publish-gate-spec.md`
 *
 * This module is the single source of truth for P0 / P1 / P2 risk tier
 * classification of Agent / Role / Token / `access.yaml` governance writes.
 *
 * Hard rules (mirrored from the spec):
 *  - Pure: classification MUST NOT require a database connection. Callers
 *    hand in `oldValue` / `newValue` and any pre-computed `oldSources` /
 *    `newSources` arrays. This keeps the gate testable in-memory and keeps
 *    the front-end from re-implementing the same rules.
 *  - Append-only evidence: every gate evaluation writes a `publish_gate`
 *    trace event (spec §8). Override evidence uses
 *    `evidence_events.relation = "reviewer_override"` and is recorded on
 *    the same `traceId`. We never overwrite historical events.
 *  - P0 means BLOCK or OVERRIDE_REQUIRED. Two approvers, future `expiresAt`,
 *    non-empty `reason` and `rollbackPlan`. Anything less is refused before
 *    the durable write path runs.
 *  - The frontend never recomputes these decisions — it only renders the
 *    `gate` block returned by `evaluateAccessGovernanceGate`.
 *
 * Hot store boundary: this module NEVER writes Token plaintext, raw SQL AST,
 * raw result rows, full question text, DB credentials, or customer samples.
 * Approvers are referenced by `actorKind` + `actorId` / `tokenHash` /
 * `identityProvider` only (see `GovernanceOverrideApprover`). If a caller
 * tries to smuggle a plaintext token through `approver.tokenHash`, we keep
 * it as-is (it's a hash, not the token itself) and reject any plaintext
 * "token" strings via `assertApproverIsRedacted()`.
 */
import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import {
  hashArtifact,
  writeTraceEvent,
  writeEvidenceEvents,
  type LucyActorKind,
  type EvidenceRelation
} from "./trace/evidence.js";

// ─── Public types ────────────────────────────────────────────────────────────

export type RiskTier = "P0" | "P1" | "P2";

export type AccessGovernanceTargetKind =
  | "agent"
  | "role"
  | "token"
  | "access_defaults"
  | "release";

export type AccessGovernanceDecisionKind = "allow" | "block" | "warn" | "override_required";

export interface AccessGovernanceApprover {
  actorKind: LucyActorKind | string;
  actorId?: string | null;
  /**
   * Optional token hash reference. MUST be a hash, never a plaintext token;
   * `assertApproverIsRedacted` enforces this on the override path so we
   * cannot leak a Token to the evidence chain by accident.
   */
  tokenHash?: string | null;
  identityProvider?: string | null;
}

export interface AccessGovernanceOverrideRequest {
  reason: string;
  approvers: AccessGovernanceApprover[];
  /** ISO-8601 timestamp; must be in the future. */
  expiresAt: string;
  rollbackPlan: string;
}

export interface GovernanceGateFinding {
  tier: RiskTier;
  code: string;
  message: string;
}

export interface AccessGovernanceGateDecision {
  traceId: string;
  targetKind: AccessGovernanceTargetKind;
  targetId?: string | null;
  decision: AccessGovernanceDecisionKind;
  tierSummary: Record<RiskTier, { count: number; reasons: string[] }>;
  findings: GovernanceGateFinding[];
  /** Set when `decision === "override_required"`. Describes what an
   *  approver must provide to unlock the durable write. */
  override?: AccessGovernanceOverrideRequirement;
  evidenceRefs: GovernanceEvidenceRef[];
}

export interface AccessGovernanceOverrideRequirement {
  reason: string;
  requiredApproverCount: number;
  /** Minimum list of fields the override payload must populate. */
  requiredFields: Array<"reason" | "approvers" | "expiresAt" | "rollbackPlan">;
}

export interface GovernanceEvidenceRef {
  kind: string;
  ref: string;
  relation: EvidenceRelation | string;
}

export interface GovernanceOverrideEvaluation {
  ok: boolean;
  /** When `ok === false`, describes the first failed rule. */
  reason?: string;
  /** Stable code for callers / tests. */
  code?:
    | "OVERRIDE_REASON_MISSING"
    | "OVERRIDE_APPROVERS_INSUFFICIENT"
    | "OVERRIDE_APPROVERS_NOT_DISTINCT"
    | "OVERRIDE_EXPIRES_AT_INVALID"
    | "OVERRIDE_EXPIRES_AT_EXPIRED"
    | "OVERRIDE_ROLLBACK_PLAN_MISSING"
    | "OVERRIDE_APPROVER_LEAKED_TOKEN";
}

export interface EvaluateAccessGovernanceGateInput {
  targetKind: AccessGovernanceTargetKind;
  targetId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  /** Optional pre-computed snapshot of resolved sources before / after the
   *  change. Source names are stable identifiers (schema.table). */
  oldSources?: string[];
  newSources?: string[];
  /** Optional pre-computed permission snapshot hash from the resolver. */
  oldSnapshotHash?: string | null;
  newSnapshotHash?: string | null;
  /** Optional tools list diff (added tool names only). */
  addedTools?: string[];
  /** Optional deny_tools list comparison. */
  oldDenyTools?: string[];
  newDenyTools?: string[];
  /** Optional table prefix list comparison. */
  oldSensitiveTablePrefixes?: string[];
  newSensitiveTablePrefixes?: string[];
  /** Sensitive table prefixes to classify `newSources` against. Mirrors the
   *  runtime ACL policy default (`dataforai.kx_*`). Callers can override
   *  via their own snapshot, but defaults keep the gate portable. */
  sensitiveSourcePrefixes?: string[];
  /** Core finance / security suite names (case-insensitive). When the
   *  candidate sources include any of these, gate escalates to P0. */
  coreSensitiveSources?: string[];
  /** High-traffic threshold (default 50 calls in 7d). */
  highTrafficCalls7d?: number;
  /** Approval count required to override a P0 finding. Defaults to 2. */
  requiredApproverCount?: number;
  /** Optional helper to override the deterministic traceId. The caller can
   *  pass `null` to opt out of writing a trace event later; classification
   *  itself never touches the database. */
  traceId?: string | null;
  actor?: AccessGovernanceApprover;
}

// ─── Defaults ────────────────────────────────────────────────────────────────

/** Sources that must always be treated as core-sensitive. Mirrors the
 *  Lucy KX finance / security suite used by `kx_readonly` template. */
export const DEFAULT_CORE_SENSITIVE_SOURCES: readonly string[] = [
  "dataforai.kx_dim_company",
  "dataforai.kx_dim_financial_item",
  "dataforai.kx_fact_financial_amount",
  "dataforai.kx_vw_balance_sheet_detail",
  "dataforai.kx_vw_cash_flow_statement_detail",
  "dataforai.kx_vw_income_statement_detail"
] as const;

/** Prefix flags for sensitive sources. Matches the runtime
 *  `acl.sensitiveTablePrefixes` default. */
export const DEFAULT_SENSITIVE_SOURCE_PREFIXES: readonly string[] = [
  "dataforai.kx_"
] as const;

/** Tools whose addition constitutes a raw-query or P0 path. */
export const RAW_QUERY_TOOLS: readonly string[] = [
  "sql_execution",
  "sql_dialect_notes",
  "memory_ingest",
  "memory_ingest_status"
] as const;

/** Minimum number of approvers required to override a P0 finding. */
export const P0_REQUIRED_APPROVERS = 2;

/** Threshold above which an Agent / Role change is considered "high-traffic"
 *  and escalates to P1. */
export const DEFAULT_HIGH_TRAFFIC_THRESHOLD = 50;

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Run deterministic, in-memory classification of a governance write.
 *
 * The classifier NEVER touches the database. Callers can pass already-resolved
 * snapshots and source lists; this keeps the test surface small and prevents
 * the front-end from re-implementing the same rules.
 */
export function evaluateAccessGovernanceGate(
  input: EvaluateAccessGovernanceGateInput
): AccessGovernanceGateDecision {
  const findings: GovernanceGateFinding[] = [];
  const traceId = input.traceId ?? `gate-${randomUUID()}`;
  const requiredApproverCount = input.requiredApproverCount ?? P0_REQUIRED_APPROVERS;

  const oldSources = normalizeList(input.oldSources);
  const newSources = normalizeList(input.newSources);
  const oldDenyTools = normalizeList(input.oldDenyTools);
  const newDenyTools = normalizeList(input.newDenyTools);
  const oldPrefixes = normalizeList(input.oldSensitiveTablePrefixes);
  const newPrefixes = normalizeList(input.newSensitiveTablePrefixes);
  const addedTools = normalizeList(input.addedTools);
  const sensitivePrefixes =
    normalizeList(input.sensitiveSourcePrefixes).length > 0
      ? normalizeList(input.sensitiveSourcePrefixes)
      : Array.from(DEFAULT_SENSITIVE_SOURCE_PREFIXES);
  const coreSensitiveSources =
    normalizeList(input.coreSensitiveSources).length > 0
      ? normalizeList(input.coreSensitiveSources)
      : Array.from(DEFAULT_CORE_SENSITIVE_SOURCES);
  const highTrafficThreshold = DEFAULT_HIGH_TRAFFIC_THRESHOLD;

  // 1) P0 rules — permission expansion, sensitive source exposure,
  //    global deny weakening, raw query path weakening, core suite.

  // 1a) Role selector widening into a sensitive source.
  const newSensitiveHits = newSources.filter((source) =>
    isSensitiveSource(source, sensitivePrefixes, coreSensitiveSources)
  );
  const oldSensitiveHits = oldSources.filter((source) =>
    isSensitiveSource(source, sensitivePrefixes, coreSensitiveSources)
  );
  const wideningIntoSensitive = newSensitiveHits.filter(
    (source) => !oldSensitiveHits.includes(source)
  );
  if (wideningIntoSensitive.length > 0) {
    findings.push({
      tier: "P0",
      code: "PERMISSION_EXPANSION_SENSITIVE_SOURCE",
      message: `Role/Agent selector widens into sensitive source(s): ${wideningIntoSensitive.join(", ")}`
    });
  }

  // 1b) Global deny_tools weakening (existing protected tools removed).
  const denyWeakened = oldDenyTools.filter((tool) => !newDenyTools.includes(tool));
  if (denyWeakened.length > 0) {
    findings.push({
      tier: "P0",
      code: "GLOBAL_DENY_WEAKENED",
      message: `defaults.deny_tools weakened: removed ${denyWeakened.join(", ")}`
    });
  }

  // 1c) Sensitive table prefix list weakening.
  const prefixWeakened = oldPrefixes.filter((prefix) => !newPrefixes.includes(prefix));
  if (prefixWeakened.length > 0) {
    findings.push({
      tier: "P0",
      code: "SENSITIVE_TABLE_PREFIXES_WEAKENED",
      message: `defaults.sensitive_table_prefixes weakened: removed ${prefixWeakened.join(", ")}`
    });
  }

  // 1d) Raw query / sensitive-metadata path added.
  const rawQueryAdded = addedTools.filter((tool) =>
    (RAW_QUERY_TOOLS as readonly string[]).includes(tool)
  );
  if (rawQueryAdded.length > 0) {
    findings.push({
      tier: "P0",
      code: "RAW_QUERY_PATH_ADDED",
      message: `Role/Agent allow.tools added raw-query path: ${rawQueryAdded.join(", ")}`
    });
  }

  // 1e) Re-enabling a disabled Agent that owns a wildcard allow.
  // (Caller passes `newValue` as the post-change Agent record; we check
  //  via light structural inspection so the classifier stays in-memory.)
  if (input.targetKind === "agent") {
    const before = asRecord(input.oldValue);
    const after = asRecord(input.newValue);
    const wasDisabled = before ? before.enabled === false : false;
    const isEnabled = after ? after.enabled !== false : false;
    const wildcardAllow = (record: Record<string, unknown> | undefined): boolean => {
      if (!record) return false;
      const allow = record.allow as { tables?: unknown; tools?: unknown } | undefined;
      if (!allow) return false;
      const tables = Array.isArray(allow.tables) ? (allow.tables as unknown[]) : [];
      const tools = Array.isArray(allow.tools) ? (allow.tools as unknown[]) : [];
      return tables.includes("*") || tools.includes("*");
    };
    if (wasDisabled && isEnabled && (wildcardAllow(before) || wildcardAllow(after))) {
      findings.push({
        tier: "P0",
        code: "WILDCARD_AGENT_RE_ENABLED",
        message: "Agent with wildcard allow is being re-enabled"
      });
    }
  }

  // 2) P1 rules — non-sensitive widening, high-traffic agent/role, etc.

  // 2a) Selector widening into a non-sensitive source.
  const wideningNonSensitive = newSources.filter(
    (source) => !newSensitiveHits.includes(source) && !oldSources.includes(source)
  );
  if (wideningNonSensitive.length > 0) {
    findings.push({
      tier: "P1",
      code: "PERMISSION_EXPANSION_NON_SENSITIVE",
      message: `Role/Agent selector widens into non-sensitive source(s): ${wideningNonSensitive.join(", ")}`
    });
  }

  // 2b) High-traffic Agent / Role changes require threshold pass.
  if (input.targetKind === "agent" || input.targetKind === "role") {
    if (input.highTrafficCalls7d !== undefined && input.highTrafficCalls7d >= highTrafficThreshold) {
      findings.push({
        tier: "P1",
        code: "HIGH_TRAFFIC_TARGET",
        message: `${input.targetKind} is high-traffic (${input.highTrafficCalls7d} calls/7d ≥ ${highTrafficThreshold}); threshold review required`
      });
    }
  }

  // 2c) Token creation for a high-traffic Agent.
  if (input.targetKind === "token" && input.highTrafficCalls7d !== undefined
      && input.highTrafficCalls7d >= highTrafficThreshold) {
    findings.push({
      tier: "P1",
      code: "TOKEN_FOR_HIGH_TRAFFIC_AGENT",
      message: `Token is being created for a high-traffic agent (${input.highTrafficCalls7d} calls/7d ≥ ${highTrafficThreshold})`
    });
  }

  // 2d) Role has high denial rate (caller supplies pre-computed rate).
  if (input.targetKind === "role" && typeof (input.newValue as { denialRate7d?: number } | undefined)?.denialRate7d === "number") {
    const denialRate = (input.newValue as { denialRate7d: number }).denialRate7d;
    if (denialRate >= 0.2) {
      findings.push({
        tier: "P1",
        code: "ROLE_HIGH_DENIAL_RATE",
        message: `Role has high denial rate (${(denialRate * 100).toFixed(0)}% in last 7d)`
      });
    }
  }

  // 3) P2 rules — cleanup / docs-only changes.
  if (input.targetKind === "token" && input.newValue === undefined) {
    findings.push({
      tier: "P2",
      code: "STALE_TOKEN_CLEANUP",
      message: "Stale or unused token being cleaned up"
    });
  }

  // Aggregate
  const tierSummary: Record<RiskTier, { count: number; reasons: string[] }> = {
    P0: { count: 0, reasons: [] },
    P1: { count: 0, reasons: [] },
    P2: { count: 0, reasons: [] }
  };
  for (const finding of findings) {
    tierSummary[finding.tier].count += 1;
    tierSummary[finding.tier].reasons.push(`${finding.code}: ${finding.message}`);
  }

  let decision: AccessGovernanceDecisionKind;
  let override: AccessGovernanceOverrideRequirement | undefined;
  if (tierSummary.P0.count > 0) {
    decision = "override_required";
    override = {
      reason: "P0 finding requires emergency override",
      requiredApproverCount,
      requiredFields: ["reason", "approvers", "expiresAt", "rollbackPlan"]
    };
  } else if (tierSummary.P1.count > 0) {
    decision = "warn";
  } else if (tierSummary.P2.count > 0) {
    decision = "warn";
  } else {
    decision = "allow";
  }

  // Suppress the override requirement warning for non-P0 decisions.
  if (decision !== "override_required") {
    override = undefined;
  }

  const evidenceRefs: GovernanceEvidenceRef[] = buildEvidenceRefs({
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    oldSnapshotHash: input.oldSnapshotHash ?? null,
    newSnapshotHash: input.newSnapshotHash ?? null,
    addedTools,
    wideningIntoSensitive,
    newSources,
    oldSources,
    decision
  });

  return {
    traceId,
    targetKind: input.targetKind,
    targetId: input.targetId ?? null,
    decision,
    tierSummary,
    findings,
    override,
    evidenceRefs
  };
}

// ─── Override evaluation ─────────────────────────────────────────────────────

/**
 * Validate a candidate `GovernanceOverrideRequest`. Pure — no DB I/O.
 *
 * The gate never auto-evaluates the override; the durable write path runs
 * the rule below right before flipping `dryRun: false`.
 */
export function evaluateGovernanceOverride(
  request: AccessGovernanceOverrideRequest | undefined,
  gate: AccessGovernanceGateDecision
): GovernanceOverrideEvaluation {
  if (gate.decision !== "override_required") {
    return request
      ? { ok: false, code: "OVERRIDE_REASON_MISSING", reason: "gate does not require an override" }
      : { ok: true };
  }
  if (!request) {
    return { ok: false, code: "OVERRIDE_REASON_MISSING", reason: "override payload is required for P0 writes" };
  }
  const requirement = gate.override ?? {
    reason: "P0 finding requires emergency override",
    requiredApproverCount: P0_REQUIRED_APPROVERS,
    requiredFields: ["reason", "approvers", "expiresAt", "rollbackPlan"] as Array<"reason" | "approvers" | "expiresAt" | "rollbackPlan">
  };

  if (!request.reason || !request.reason.trim()) {
    return { ok: false, code: "OVERRIDE_REASON_MISSING", reason: "override.reason is required" };
  }
  const reasonLeak = assertFreeTextIsRedacted(request.reason, "override.reason");
  if (reasonLeak) {
    return { ok: false, code: "OVERRIDE_APPROVER_LEAKED_TOKEN", reason: reasonLeak };
  }
  if (!request.rollbackPlan || !request.rollbackPlan.trim()) {
    return { ok: false, code: "OVERRIDE_ROLLBACK_PLAN_MISSING", reason: "override.rollbackPlan is required" };
  }
  const rollbackLeak = assertFreeTextIsRedacted(request.rollbackPlan, "override.rollbackPlan");
  if (rollbackLeak) {
    return { ok: false, code: "OVERRIDE_APPROVER_LEAKED_TOKEN", reason: rollbackLeak };
  }
  if (!request.expiresAt || isNaN(Date.parse(request.expiresAt))) {
    return { ok: false, code: "OVERRIDE_EXPIRES_AT_INVALID", reason: "override.expiresAt must be a valid ISO-8601 timestamp" };
  }
  if (Date.parse(request.expiresAt) <= Date.now()) {
    return { ok: false, code: "OVERRIDE_EXPIRES_AT_EXPIRED", reason: "override.expiresAt must be in the future" };
  }
  if (!Array.isArray(request.approvers) || request.approvers.length < requirement.requiredApproverCount) {
    return {
      ok: false,
      code: "OVERRIDE_APPROVERS_INSUFFICIENT",
      reason: `override requires at least ${requirement.requiredApproverCount} approvers; got ${request.approvers?.length ?? 0}`
    };
  }
  // Distinct approvers: actorKind + actorId / tokenHash / identityProvider.
  const distinct = new Set<string>();
  for (const approver of request.approvers) {
    const key = [
      approver.actorKind,
      approver.actorId ?? "",
      approver.tokenHash ?? "",
      approver.identityProvider ?? ""
    ].join("|");
    if (distinct.has(key)) {
      return {
        ok: false,
        code: "OVERRIDE_APPROVERS_NOT_DISTINCT",
        reason: "override approvers must be distinct identities"
      };
    }
    distinct.add(key);
    const redactionError = assertApproverIsRedacted(approver);
    if (redactionError) {
      return { ok: false, code: "OVERRIDE_APPROVER_LEAKED_TOKEN", reason: redactionError };
    }
  }
  return { ok: true };
}

// ─── Trace / Evidence integration ────────────────────────────────────────────

export interface RecordAccessGovernanceGateEventInput {
  database: Database.Database;
  decision: AccessGovernanceGateDecision;
  /** Optional reviewer override to record as `reviewer_override` evidence. */
  overrideEvaluation?: GovernanceOverrideEvaluation;
  overrideRequest?: AccessGovernanceOverrideRequest;
  /** Optional additional actor metadata to attach to the gate span. */
  actor?: AccessGovernanceApprover;
}

/**
 * Persist a gate decision as an append-only `publish_gate` trace event.
 * When the caller supplies a validated override, also writes a
 * `reviewer_override` evidence row. Returns the inserted event id.
 *
 * Failure to write is non-fatal (matches `trace-evidence` hot-path rule);
 * we re-throw so verification scripts can count failures.
 */
export function recordAccessGovernanceGateEvent(
  input: RecordAccessGovernanceGateEventInput
): { gateEventId: number; overrideEventId: number | null; evidenceIds: number[] } {
  const now = new Date().toISOString();
  const status = input.decision.decision === "allow"
    ? "ok"
    : input.decision.decision === "warn"
      ? "ok"
      : input.decision.decision === "override_required"
        ? "denied"
        : "denied";

  const artifactHashes = input.decision.evidenceRefs
    .map((ref) => ref.ref)
    .filter((ref): ref is string => typeof ref === "string")
    .slice(0, 32)
    .map((ref) => hashArtifact(ref));

  const gateEventId = writeTraceEvent(input.database, {
    traceId: input.decision.traceId,
    spanId: `gate-${randomUUID().slice(0, 8)}`,
    spanType: "publish_gate",
    actorKind: (input.actor?.actorKind as LucyActorKind) ?? "admin",
    actorId: input.actor?.actorId ?? null,
    status,
    startedAt: now,
    endedAt: now,
    metadata: {
      gateKind: "access_governance",
      targetKind: input.decision.targetKind,
      targetId: input.decision.targetId ?? null,
      decision: input.decision.decision,
      p0: input.decision.tierSummary.P0.count,
      p1: input.decision.tierSummary.P1.count,
      p2: input.decision.tierSummary.P2.count,
      findings: input.decision.findings.slice(0, 32).map((finding) => ({
        tier: finding.tier,
        code: finding.code,
        message: finding.message
      })),
      overrideApplied: Boolean(input.overrideEvaluation?.ok)
    },
    artifactHashes
  });

  const evidenceInputs = input.decision.evidenceRefs.map((ref) => ({
    traceEventId: gateEventId,
    traceId: input.decision.traceId,
    evidenceKind: ref.kind,
    evidenceRef: ref.ref,
    relation: ref.relation as EvidenceRelation
  }));
  let evidenceIds = evidenceInputs.length > 0 ? writeEvidenceEvents(input.database, evidenceInputs) : [];

  let overrideEventId: number | null = null;
  if (input.overrideEvaluation?.ok && input.overrideRequest) {
    overrideEventId = writeTraceEvent(input.database, {
      traceId: input.decision.traceId,
      spanId: `gate-override-${randomUUID().slice(0, 8)}`,
      parentSpanId: `gate-${gateEventId}`,
      spanType: "publish_gate",
      actorKind: "reviewer",
      actorId: input.overrideRequest.approvers[0]?.actorId ?? null,
      status: "ok",
      startedAt: now,
      endedAt: now,
      metadata: {
        gateKind: "access_governance_override",
        targetKind: input.decision.targetKind,
        targetId: input.decision.targetId ?? null,
        approverCount: input.overrideRequest.approvers.length,
        expiresAt: input.overrideRequest.expiresAt
      }
    });
    const reviewerJson: Record<string, unknown> = {
      approvers: input.overrideRequest.approvers.map((approver) => ({
        actorKind: approver.actorKind,
        actorId: approver.actorId ?? null,
        tokenHash: approver.tokenHash ?? null,
        identityProvider: approver.identityProvider ?? null
      }))
    };
    const overrideEvidenceIds = writeEvidenceEvents(input.database, [
      {
        traceEventId: overrideEventId,
        traceId: input.decision.traceId,
        evidenceKind: "reviewer_override",
        // The reason is reviewer-supplied free-form text. The override
        // evaluator already refused any plaintext credential patterns, but
        // we still hash it before persisting as `evidence_ref` because the
        // trace kernel does not sanitize `evidence_ref` (only metadata).
        evidenceRef: hashArtifact(input.overrideRequest.reason),
        relation: "reviewer_override",
        reviewer: reviewerJson,
        metadata: {
          expiresAt: input.overrideRequest.expiresAt,
          rollbackPlan: input.overrideRequest.rollbackPlan,
          approverCount: input.overrideRequest.approvers.length
        }
      }
    ]);
    evidenceIds = [...evidenceIds, ...overrideEvidenceIds];
  }

  return { gateEventId, overrideEventId, evidenceIds };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSensitiveSource(
  source: string,
  prefixes: string[],
  coreSensitiveSources: string[]
): boolean {
  if (coreSensitiveSources.includes(source)) return true;
  const normalized = source.toLowerCase();
  return prefixes.some((prefix) => normalized.startsWith(prefix.toLowerCase()));
}

function buildEvidenceRefs(input: {
  targetKind: AccessGovernanceTargetKind;
  targetId: string | null;
  oldSnapshotHash: string | null;
  newSnapshotHash: string | null;
  addedTools: string[];
  wideningIntoSensitive: string[];
  oldSources: string[];
  newSources: string[];
  decision: AccessGovernanceDecisionKind;
}): GovernanceEvidenceRef[] {
  const refs: GovernanceEvidenceRef[] = [];
  if (input.newSnapshotHash) {
    refs.push({
      kind: "permission_snapshot",
      ref: input.newSnapshotHash,
      relation: "used"
    });
  }
  if (input.oldSnapshotHash) {
    refs.push({
      kind: "permission_snapshot",
      ref: input.oldSnapshotHash,
      relation: "observed"
    });
  }
  for (const tool of input.addedTools) {
    refs.push({ kind: "access_policy", ref: tool, relation: "used" });
  }
  for (const source of input.wideningIntoSensitive) {
    refs.push({ kind: "sensitive_source", ref: source, relation: "denied_by" });
  }
  if (input.decision === "override_required" || input.decision === "block") {
    refs.push({
      kind: "access_yaml_node",
      ref: input.targetId ?? input.targetKind,
      relation: "denied_by"
    });
  }
  // Diff summary hash (so admin can grep evidence by this anchor).
  const diffHash = hashArtifact(JSON.stringify({
    oldSources: input.oldSources.slice(0, 64),
    newSources: input.newSources.slice(0, 64),
    addedTools: input.addedTools.slice(0, 64)
  }));
  refs.push({ kind: "role_diff_hash", ref: diffHash, relation: "observed" });
  return refs;
}

/**
 * Reject any approver payload that smells like a plaintext token / API key.
 * The hot store contract (`webui/docs/62-trace-evidence-kernel-spec.md`) forbids
 * Token plaintext and high-entropy credentials; we enforce the same rule
 * upstream so the override cannot smuggle it through.
 */
export function assertApproverIsRedacted(approver: AccessGovernanceApprover): string | undefined {
  if (typeof approver.tokenHash === "string") {
    // tokenHash is expected to look like "sha256:<64-hex>". Anything else
    // is suspicious.
    if (!/^sha256:[a-f0-9]{8,128}$/i.test(approver.tokenHash)) {
      return `approver.tokenHash must be a sha256 hash; got ${approver.tokenHash.slice(0, 12)}…`;
    }
  }
  if (typeof approver.actorId === "string" && looksLikePlaintextCredential(approver.actorId)) {
    return "approver.actorId looks like a plaintext token; redact before submitting";
  }
  if (typeof approver.identityProvider === "string" && looksLikePlaintextCredential(approver.identityProvider)) {
    return "approver.identityProvider looks like a plaintext token; redact before submitting";
  }
  return undefined;
}

export function assertFreeTextIsRedacted(value: string | undefined | null, label: string): string | undefined {
  if (!value) return undefined;
  if (looksLikePlaintextCredential(value)) {
    return `${label} looks like it contains a plaintext credential; redact before submitting`;
  }
  return undefined;
}

function looksLikePlaintextCredential(value: string): boolean {
  if (typeof value !== "string") return false;
  if (/eyJ[A-Za-z0-9._~+\/=-]{8,}\.[A-Za-z0-9._~+\/=-]{4,}\.[A-Za-z0-9._~+\/=-]{4,}/.test(value)) return true;
  if (/\b(?:sk|pk|ak|rk|pat|ghp|gho|glpat|xox[baprs]?|AKIA|ASIA)[A-Za-z0-9._~+\/=-]{16,}\b/.test(value)) return true;
  if (/\b(?:token|api[-_]?key|secret|password)\s*[:=]\s*[A-Za-z0-9._~+\/=-]{16,}/i.test(value)) return true;
  if (/Bearer\s+[A-Za-z0-9._~+\/=-]{16,}/.test(value)) return true;
  // 40+ chars containing mixed case + digits (typical token signature),
  // excluding our well-known actorId shape (lowercase slug up to 64 chars).
  if (
    value.length >= 40 &&
    /[a-z]/.test(value) &&
    /[A-Z]/.test(value) &&
    /[0-9]/.test(value) &&
    !/^[a-z0-9_-]{1,64}$/.test(value)
  ) {
    return true;
  }
  return false;
}