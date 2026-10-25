import type {
  AuditCoveragePort,
  PrimaryStatusPort,
  ReconciliationFacts,
  ReconciliationUnit
} from "./reconciliation.js";
import type {
  AuditCoverage,
  ReconciliationContext
} from "./reconciliation-context.js";
import {
  AUDIT_COVERAGE_CHECKS,
  COVERAGE_CHECK_TITLES,
  evaluateAuditCoverage,
  readPrimaryStatus,
  type CoverageInput,
  type MetricUnit
} from "../proxy/audit-reconcile.js";
import type { PrimaryStatus } from "../proxy/audit-derivation.js";

/**
 * Lucy v0.25 / P0-4 E1 — the production adapters for the reconciliation view.
 *
 * The reconciliation view must NOT own a second set of classification rules.
 * L25-09 S01 owns the primary-status derivation and L25-09 S05 owns the
 * coverage checks; this module only wires those two authoritative sources into
 * the view's dependency-injection ports.
 *
 * The primary status is read from the `primary_status` column that L25-09 B8 /
 * B27 write on every audit row, so the view and the audit list report exactly
 * the same bucket for the same call. A row whose column is NULL is reported as
 * `unknown` with a null reason — never guessed.
 */

/** The `access_log` shape the adapters read. */
type AuditRow = {
  primary_status?: string | null;
  outcome?: string | null;
  authorization_view?: string | null;
  execution_view?: string | null;
  delivery_status?: string | null;
};

function readRow(unit: ReconciliationUnit): AuditRow {
  // The unit carries the L25-09-derived columns of the underlying audit row.
  // When they are absent (a row written before the schema V3 migration) every
  // fact stays `unknown` with a reason.
  return {
    primary_status: unit.primaryStatusColumn ?? null,
    outcome: unit.legacyOutcome ?? null,
    authorization_view: unit.authorizationViewColumn ?? null,
    execution_view: unit.executionViewColumn ?? null,
    delivery_status: unit.deliveryStatusColumn ?? null
  };
}

function toAuthorization(value: string | null | undefined): ReconciliationFacts["authorization"] {
  if (value === "allowed" || value === "denied") return value;
  if (value === "not_evaluated") return "not_evaluated";
  return "unknown";
}

function toExecution(value: string | null | undefined): ReconciliationFacts["execution"] {
  if (
    value === "succeeded" ||
    value === "failed" ||
    value === "not_executed" ||
    value === "interrupted"
  ) {
    return value;
  }
  return "unknown";
}

function toDelivery(value: string | null | undefined): ReconciliationFacts["delivery"] {
  if (
    value === "prepared" ||
    value === "sent" ||
    value === "acknowledged" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

/**
 * The primary-status port backed by L25-09's own derivation result.
 */
export const productionPrimaryStatusPort: PrimaryStatusPort = {
  connected: true,
  derive(unit: ReconciliationUnit, _context: ReconciliationContext): ReconciliationFacts {
    const row = readRow(unit);
    const primaryStatus: PrimaryStatus = readPrimaryStatus(row);
    const statusKnown = primaryStatus !== "unknown";
    const authorization = toAuthorization(row.authorization_view);
    const execution = toExecution(row.execution_view);
    const delivery = toDelivery(row.delivery_status);
    return {
      primaryStatus,
      // A conflict is a fact of the row, not of this view. The reconciliation
      // view never decides a conflict on its own.
      conflict: unit.associationStatus === "conflict",
      authorization,
      execution,
      delivery,
      evidenceRefs: unit.unitId ? [`access_log:${unit.unitId}`] : [],
      nullReasons: {
        primaryStatus: statusKnown ? undefined : "not_collected",
        authorization: authorization === "unknown" ? "not_collected" : undefined,
        execution: execution === "unknown" ? "not_collected" : undefined,
        delivery: delivery === "unknown" ? "not_collected" : undefined
      }
    };
  }
};

/**
 * The coverage port backed by L25-09 S05's `evaluateAuditCoverage`.
 *
 * The six checks are independent. A check without an independent expected set
 * is reported as `unknown` with a reason — the view never uses the same-side
 * projection to prove that no ingress event was missed.
 */
export function createProductionAuditCoveragePort(
  resolve: (
    context: ReconciliationContext,
    scope: { units: readonly ReconciliationUnit[] }
  ) => Partial<Record<(typeof AUDIT_COVERAGE_CHECKS)[number], CoverageInput>> = (
    context
  ) => ({
    // D-26: projection catch-up has direct, independent evidence from the
    // canonical-ledger-vs-projection gate captured in this context. The other
    // five checks remain unknown until their own independent sources exist.
    projection_catchup: {
      id: "projection_catchup",
      status: context.completeness.dataScope.ok ? "pass" : "fail",
      numerator: context.completeness.dataScope.ok ? 1 : 0,
      denominator: 1,
      unit: context.s05MetricUnit,
      evidenceSource: "canonical_ledger_and_projection_status",
      diffIds: context.completeness.dataScope.ok ? [] : ["projection_catchup"],
      reason: context.completeness.dataScope.reason,
      exclusions: []
    }
  })): AuditCoveragePort {
  return {
    connected: true,
    summarizeCoverage(
      context: ReconciliationContext,
      scope: { units: readonly ReconciliationUnit[] }
    ): AuditCoverage {
      const supplied = resolve(context, scope);
      const checks: CoverageInput[] = AUDIT_COVERAGE_CHECKS.map((id) => {
        const found = supplied[id];
        if (found) return { ...found, id };
        return {
          id,
          status: "unknown",
          numerator: 0,
          denominator: 0,
          unit: "protocol_request" as MetricUnit,
          evidenceSource: "none",
          diffIds: [],
          reason: "coverage_source_not_available",
          exclusions: []
        };
      });
      const report = evaluateAuditCoverage({
        seqUpperBound: context.watermarkSeq,
        checks
      });
      return {
        version: "v2p5-1",
        seqUpperBound: report.seqUpperBound,
        checks: report.checks.map((check) => ({
          id: check.id,
          title: check.title ?? COVERAGE_CHECK_TITLES[check.id],
          status: check.status,
          numerator: check.numerator,
          denominator: check.denominator,
          unit: check.unit,
          evidenceSource: check.evidenceSource,
          seqUpperBound: check.seqUpperBound,
          diffIds: check.diffIds ?? [],
          reason: check.reason ?? null,
          exclusions: check.exclusions ?? []
        })),
        allConclusive: report.allConclusive,
        combined: report.combined
      };
    }
  };
}
