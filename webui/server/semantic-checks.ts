/**
 * Lucy v0.25 — the ONE shared legality rule set for semantic assets.
 *
 * Authority: docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md
 * §6 (validation and result contract), §10 V11 / V18 / V21, and §11 D8 / D9.
 *
 * ── Why one module ──────────────────────────────────────────────────────────
 * Spec §6: "导入预检和发布前最终校验必须复用相同检查实现，单表、批量、
 * `validate-changed` 不得各自维护不同合法性规则". Before v0.25 the single
 * table path, the batch path and `validate-changed` each had their own idea
 * of "valid": `runValidateGate` only ran `ktx sl validate`, the import
 * pre-check added file-shape rules, and the column type contract was applied
 * in yet another place.
 *
 * This module is that single implementation. Every entry point (single table
 * save, import pre-check, publish final check, independent batch validation)
 * calls {@link runSemanticTableCheck} and gets the same verdict for the same
 * input.
 *
 * ── Three independent dimensions (Spec §6) ─────────────────────────────────
 *  1. LEGALITY — the verdict: `passed / failed / not_run / stale`, with a
 *     `severity` per reason. This is the only dimension that gates a submit.
 *  2. COMPLETENESS — descriptive facts (descriptions, grain, measures).
 *     Listed separately; it is NOT a legality proof and never blocks.
 *  3. EXECUTION EVIDENCE — `not_applicable / evidence_available /
 *     blocked_evidence / unknown`. This release does not require running
 *     queries against the real database, so the value is `not_applicable`
 *     and it NEVER becomes a submit verdict. Writing `not_run` here would
 *     create the contradiction the Spec explicitly forbids: a legal publish
 *     would always be blocked.
 *
 * ── The count identity (Spec §6, D9) ───────────────────────────────────────
 *   selected = passed + failed + not_run + stale
 * Dependencies are counted separately and never masquerade as selected
 * tables.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument } from "yaml";
import { validateSource, type ValidationResult } from "./ktx";
import { checkColumnTypeContract, type PublishGateViolation } from "./publish-gate";
import {
  resolveSemanticDependencyClosure,
  semanticIdentityKey,
  type SemanticModelIndex,
  type SemanticTableIdentity
} from "./semantic-identity";
import { resolveContentPaths } from "./paths";

export type SemanticVerdict = "passed" | "failed" | "not_run" | "stale";

export type SemanticSeverity = "blocking" | "warning" | "info";

/**
 * Real-database execution evidence. Independent of the legality verdict and
 * never part of the submit verdict (Spec §6).
 */
export type SemanticExecutionEvidence =
  | "not_applicable"
  | "evidence_available"
  | "blocked_evidence"
  | "unknown";

export interface SemanticCheckReason {
  /** Stable, machine-readable reason code. */
  code: string;
  /** Human readable explanation. Never contains credentials or host paths. */
  message: string;
  severity: SemanticSeverity;
}

export interface SemanticLayerResult {
  verdict: SemanticVerdict;
  reasons: SemanticCheckReason[];
}

export interface SemanticCompletenessFacts {
  hasDescription: boolean;
  hasGrain: boolean;
  columnCount: number;
  describedColumnCount: number;
  measureCount: number;
  segmentCount: number;
}

export interface SemanticExecutionEvidenceFact {
  status: SemanticExecutionEvidence;
  /** Why the evidence has this value. */
  note: string;
}

export interface SemanticTableCheckResult {
  identity: SemanticTableIdentity;
  /** The submit verdict for this table. */
  verdict: SemanticVerdict;
  /** The worst severity among the reasons. */
  severity: SemanticSeverity;
  reasons: SemanticCheckReason[];
  layers: {
    /** 范围与输入 — identity, manifest presence, target safety, limits. */
    scopeInput: SemanticLayerResult;
    /** 语义 — parse, merge, column type contract, dependency closure, ktx validate. */
    semantics: SemanticLayerResult;
    /** 完整度 — descriptive facts only; never a legality proof. */
    completeness: SemanticCompletenessFacts;
    /** 执行证据 — independent dimension. */
    executionEvidence: SemanticExecutionEvidenceFact;
  };
  durationMs: number;
}

const SEVERITY_ORDER: Record<SemanticSeverity, number> = {
  blocking: 3,
  warning: 2,
  info: 1
};

/** The worst severity in a reason list. */
export function worstSemanticSeverity(reasons: readonly SemanticCheckReason[]): SemanticSeverity {
  let worst: SemanticSeverity = "info";
  for (const reason of reasons) {
    if (SEVERITY_ORDER[reason.severity] > SEVERITY_ORDER[worst]) worst = reason.severity;
  }
  return worst;
}

function valueAsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseYamlRecord(text: string): Record<string, unknown> | null {
  try {
    const doc = parseDocument(text, { prettyErrors: true });
    if (doc.errors.length > 0) return null;
    return valueAsRecord(doc.toJSON());
  } catch {
    return null;
  }
}

function countDescribedColumns(columns: unknown): { total: number; described: number } {
  if (!Array.isArray(columns)) return { total: 0, described: 0 };
  let described = 0;
  for (const column of columns) {
    const record = valueAsRecord(column);
    const descriptions = valueAsRecord(record.descriptions);
    if (
      (typeof descriptions.human === "string" && descriptions.human.trim()) ||
      (typeof descriptions.ai === "string" && descriptions.ai.trim())
    ) {
      described += 1;
    }
  }
  return { total: columns.length, described };
}

/** Descriptive facts about the semantic definition. Never a legality proof. */
export function computeSemanticCompletenessFacts(input: {
  manifestColumns?: unknown;
  overlay?: Record<string, unknown> | null;
}): SemanticCompletenessFacts {
  const overlay = input.overlay ?? null;
  const manifestFacts = countDescribedColumns(input.manifestColumns);
  const overlayFacts = countDescribedColumns(overlay?.columns);
  const descriptions = valueAsRecord(overlay?.descriptions);
  const hasDescription =
    Boolean(
      (typeof descriptions.human === "string" && descriptions.human.trim()) ||
        (typeof descriptions.ai === "string" && descriptions.ai.trim())
    ) || manifestFacts.described > 0;
  const hasGrain = Array.isArray(overlay?.grain) && overlay.grain.length > 0;

  return {
    hasDescription,
    hasGrain,
    columnCount: Math.max(manifestFacts.total, overlayFacts.total),
    describedColumnCount: Math.max(manifestFacts.described, overlayFacts.described),
    measureCount: Array.isArray(overlay?.measures) ? overlay.measures.length : 0,
    segmentCount: Array.isArray(overlay?.segments) ? overlay.segments.length : 0
  };
}

export type ValidateSourceFn = (
  projectRoot: string,
  conn: string,
  schema: string,
  table: string
) => Promise<ValidationResult>;

export interface SemanticTableCheckOptions {
  projectRoot: string;
  index: SemanticModelIndex;
  identity: SemanticTableIdentity;
  /**
   * The root the KTX validate gate runs against. Batch validation uses the
   * live project root (read-only); an import pre-check uses a staging root.
   */
  validationRoot?: string;
  /**
   * The candidate overlay content. `null` means "this table has no overlay".
   * When omitted, the on-disk overlay is read.
   */
  candidateOverlay?: string | null;
  /** Injectable `ktx sl validate` implementation (tests / staging roots). */
  validateSourceImpl?: ValidateSourceFn;
  /** Cancellation signal. */
  signal?: AbortSignal;
  /** Injectable clock. */
  now?: () => number;
}

export interface SemanticCheckDependencies {
  /** Dependency closure failure, when the closure could not be computed. */
  dependencyError?: { code: string; message: string } | null;
  /** Resolved dependency identities (read-only). */
  dependencyIdentities?: SemanticTableIdentity[];
}

async function readOverlayContent(
  projectRoot: string,
  identity: SemanticTableIdentity
): Promise<string | null> {
  const contentPaths = await resolveContentPaths(projectRoot);
  const abs = path.join(
    contentPaths.semanticLayer,
    identity.connectionId,
    `${identity.table}.yaml`
  );
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function readManifestContent(
  projectRoot: string,
  identity: SemanticTableIdentity
): Promise<string | null> {
  const contentPaths = await resolveContentPaths(projectRoot);
  const abs = path.join(
    contentPaths.semanticLayer,
    identity.connectionId,
    "_schema",
    `${identity.schema}.yaml`
  );
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Run the shared legality check for one table.
 *
 * The result is a verdict per table plus the two independent fact dimensions.
 * The function never throws for a legality problem — a problem is a `failed`
 * verdict with a reason, so the caller can report every table at once.
 */
export async function runSemanticTableCheck(
  options: SemanticTableCheckOptions
): Promise<SemanticTableCheckResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const scopeReasons: SemanticCheckReason[] = [];
  const semanticReasons: SemanticCheckReason[] = [];
  const identity = options.identity;

  const entry = options.index.byKey.get(semanticIdentityKey(identity));
  if (!entry) {
    scopeReasons.push({
      code: "IDENTITY_NOT_FOUND",
      message: `模型中不存在 ${semanticIdentityKey(identity)}，无法校验。`,
      severity: "blocking"
    });
    return finalizeCheck(options, identity, scopeReasons, semanticReasons, {
      completeness: {
        hasDescription: false,
        hasGrain: false,
        columnCount: 0,
        describedColumnCount: 0,
        measureCount: 0,
        segmentCount: 0
      },
      dependencyIdentities: [],
      startedAt
    });
  }

  const manifestText = await readManifestContent(options.projectRoot, identity);
  if (manifestText === null) {
    scopeReasons.push({
      code: "MANIFEST_MISSING",
      message: `Schema Manifest 缺失：${entry.manifestRelPath}；缺失物理表或 Manifest 时不能通过上传 overlay 自动补齐结构。`,
      severity: "blocking"
    });
  }

  const overlayText =
    options.candidateOverlay !== undefined
      ? options.candidateOverlay
      : await readOverlayContent(options.projectRoot, identity);
  const overlay = overlayText === null ? null : parseYamlRecord(overlayText);
  if (overlayText !== null && overlay === null) {
    semanticReasons.push({
      code: "YAML_PARSE_FAILED",
      message: `语义覆盖层 ${entry.overlayRelPath} 不是合法 YAML。`,
      severity: "blocking"
    });
  }

  const manifestRecord = manifestText === null ? null : parseYamlRecord(manifestText);
  const manifestTable = manifestRecord
    ? valueAsRecord(valueAsRecord(manifestRecord.tables)[identity.table])
    : {};

  // Column type contract — the same rule the publish gate applies.
  const contracts: Array<{ filePath: string; columns: unknown }> = [];
  if (manifestText !== null) {
    contracts.push({ filePath: entry.manifestRelPath, columns: manifestTable.columns });
  }
  if (overlay) {
    contracts.push({ filePath: entry.overlayRelPath, columns: overlay.columns });
  }
  const violations: PublishGateViolation[] = contracts.flatMap((contract) =>
    checkColumnTypeContract(contract.columns, contract.filePath)
  );
  for (const violation of violations) {
    semanticReasons.push({
      code: "COLUMN_TYPE_CONTRACT",
      message: violation.message,
      severity: "blocking"
    });
  }

  // Dependency closure — missing or ambiguous references block.
  let dependencyIdentities: SemanticTableIdentity[] = [];
  try {
    const closure = await resolveSemanticDependencyClosure(
      options.projectRoot,
      options.index,
      [identity]
    );
    dependencyIdentities = closure.dependencyIdentities;
    if (closure.unselectedImpact.length > 0) {
      semanticReasons.push({
        code: "SHARED_WRITE_TARGET",
        message: `该表与 ${closure.unselectedImpact
          .map(semanticIdentityKey)
          .join("、")} 共用同一个 overlay 文件，写入会同时改变它们。`,
        severity: "blocking"
      });
    }
  } catch (error) {
    const code = (error as { code?: string }).code ?? "DEPENDENCY_UNRESOLVED";
    semanticReasons.push({
      code,
      message: error instanceof Error ? error.message : String(error),
      severity: "blocking"
    });
  }

  // The KTX validate gate — the shared legality rule.
  const validateImpl = options.validateSourceImpl ?? validateSource;
  const validationRoot = options.validationRoot ?? options.projectRoot;
  try {
    const result = await validateImpl(
      validationRoot,
      identity.connectionId,
      identity.schema,
      identity.table
    );
    if (!result.ok) {
      const detail = (result.issues ?? [])
        .map((issue) => issue.message)
        .filter(Boolean)
        .slice(0, 5)
        .join("；");
      semanticReasons.push({
        code: "KTX_VALIDATE_FAILED",
        message: detail
          ? `ktx sl validate 未通过：${detail}`
          : "ktx sl validate 未通过。",
        severity: "blocking"
      });
    }
  } catch (error) {
    semanticReasons.push({
      code: "KTX_VALIDATE_UNAVAILABLE",
      message: error instanceof Error ? error.message : String(error),
      severity: "blocking"
    });
  }

  const completeness = computeSemanticCompletenessFacts({
    manifestColumns: manifestTable.columns,
    overlay
  });

  return finalizeCheck(options, identity, scopeReasons, semanticReasons, {
    completeness,
    dependencyIdentities,
    startedAt
  });
}

function finalizeCheck(
  options: SemanticTableCheckOptions,
  identity: SemanticTableIdentity,
  scopeReasons: SemanticCheckReason[],
  semanticReasons: SemanticCheckReason[],
  extra: {
    completeness: SemanticCompletenessFacts;
    dependencyIdentities: SemanticTableIdentity[];
    startedAt: number;
  }
): SemanticTableCheckResult {
  const now = options.now ?? Date.now;
  const reasons = [...scopeReasons, ...semanticReasons];
  const blocking = reasons.some((reason) => reason.severity === "blocking");
  const verdict: SemanticVerdict = blocking ? "failed" : "passed";
  const scopeVerdict: SemanticVerdict = scopeReasons.some((r) => r.severity === "blocking")
    ? "failed"
    : "passed";
  const semanticVerdict: SemanticVerdict = semanticReasons.some((r) => r.severity === "blocking")
    ? "failed"
    : "passed";

  return {
    identity,
    verdict,
    severity: worstSemanticSeverity(reasons),
    reasons,
    layers: {
      scopeInput: { verdict: scopeVerdict, reasons: scopeReasons },
      semantics: { verdict: semanticVerdict, reasons: semanticReasons },
      completeness: extra.completeness,
      executionEvidence: {
        status: "not_applicable",
        note: "本期不要求实库执行证据；合法性通过不代表查询或业务口径已验证。"
      }
    },
    durationMs: Math.max(0, now() - extra.startedAt)
  };
}

// ─── Aggregation (Spec §6, D9) ─────────────────────────────────────────────

export interface SemanticVerdictSummary {
  selected: number;
  passed: number;
  failed: number;
  notRun: number;
  stale: number;
  /** Dependencies are counted separately and never as selected tables. */
  dependencies: number;
}

export class SemanticVerdictConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SemanticVerdictConsistencyError";
  }
}

/**
 * Summarize per-table verdicts.
 *
 * The identity `selected = passed + failed + not_run + stale` is enforced
 * here, not left to the caller.
 */
export function summarizeSemanticVerdicts(
  results: readonly SemanticTableCheckResult[]
): SemanticVerdictSummary {
  const summary: SemanticVerdictSummary = {
    selected: results.length,
    passed: 0,
    failed: 0,
    notRun: 0,
    stale: 0,
    dependencies: 0
  };
  for (const result of results) {
    switch (result.verdict) {
      case "passed":
        summary.passed += 1;
        break;
      case "failed":
        summary.failed += 1;
        break;
      case "not_run":
        summary.notRun += 1;
        break;
      case "stale":
        summary.stale += 1;
        break;
      default:
        break;
    }
  }
  assertVerdictCountsConsistent(summary);
  return summary;
}

/** Enforce `selected = passed + failed + not_run + stale`. */
export function assertVerdictCountsConsistent(summary: SemanticVerdictSummary): void {
  const total = summary.passed + summary.failed + summary.notRun + summary.stale;
  if (total !== summary.selected) {
    throw new SemanticVerdictConsistencyError(
      `verdict 计数不守恒：selected=${summary.selected}，passed+failed+not_run+stale=${total}`
    );
  }
}

/**
 * May this batch be submitted?
 *
 * Spec §6: "任一阻断错误、`not_run` 或 `stale` 都禁止提交，告警可以继续但
 * 需在确认摘要可见."
 */
export function evaluateSemanticSubmitReadiness(summary: SemanticVerdictSummary): {
  allowed: boolean;
  blockingReasons: string[];
  warnings: string[];
} {
  const blockingReasons: string[] = [];
  const warnings: string[] = [];
  if (summary.failed > 0) blockingReasons.push(`${summary.failed} 张表校验失败`);
  if (summary.notRun > 0) {
    blockingReasons.push(`${summary.notRun} 张表必需检查未执行（not_run），提交前必须补齐`);
  }
  if (summary.stale > 0) {
    blockingReasons.push(`${summary.stale} 张表的校验结果已过期（stale），请重新校验`);
  }
  return { allowed: blockingReasons.length === 0, blockingReasons, warnings };
}

/** Turn a verdict into the "not executed" result of a cancelled / timed-out run. */
export function buildNotRunResult(
  identity: SemanticTableIdentity,
  reason: { code: string; message: string }
): SemanticTableCheckResult {
  return {
    identity,
    verdict: "not_run",
    severity: "blocking",
    reasons: [{ code: reason.code, message: reason.message, severity: "blocking" }],
    layers: {
      scopeInput: { verdict: "not_run", reasons: [] },
      semantics: { verdict: "not_run", reasons: [] },
      completeness: {
        hasDescription: false,
        hasGrain: false,
        columnCount: 0,
        describedColumnCount: 0,
        measureCount: 0,
        segmentCount: 0
      },
      executionEvidence: {
        status: "not_applicable",
        note: "本期不要求实库执行证据。"
      }
    },
    durationMs: 0
  };
}

/** Turn a verdict into the "failed" result of a timed-out check. */
export function buildFailedResult(
  identity: SemanticTableIdentity,
  reason: { code: string; message: string }
): SemanticTableCheckResult {
  return {
    identity,
    verdict: "failed",
    severity: "blocking",
    reasons: [{ code: reason.code, message: reason.message, severity: "blocking" }],
    layers: {
      scopeInput: { verdict: "passed", reasons: [] },
      semantics: {
        verdict: "failed",
        reasons: [{ code: reason.code, message: reason.message, severity: "blocking" }]
      },
      completeness: {
        hasDescription: false,
        hasGrain: false,
        columnCount: 0,
        describedColumnCount: 0,
        measureCount: 0,
        segmentCount: 0
      },
      executionEvidence: {
        status: "not_applicable",
        note: "本期不要求实库执行证据。"
      }
    },
    durationMs: 0
  };
}

/** Turn a verdict into the "stale" result of a drifted baseline. */
export function buildStaleResult(
  result: SemanticTableCheckResult,
  reason: { code: string; message: string }
): SemanticTableCheckResult {
  return {
    ...result,
    verdict: "stale",
    reasons: [
      ...result.reasons,
      { code: reason.code, message: reason.message, severity: "blocking" }
    ]
  };
}
