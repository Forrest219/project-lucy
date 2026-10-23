/**
 * Spec 162 §8 / WO-14 T5 / SC-24 — 语义发布门禁豁免.
 *
 * A failing TS/Python contract check blocks the publish. An exemption is
 * therefore never "turn the gate off": it is a single, time-boxed waiver that
 * names who asked for it, why, and when it expires. Once it expires the same
 * publish fails again.
 *
 * The exemption never disables every check — `ALL_CHECKS` is explicitly not a
 * waivable target, so an emergency release cannot disable the whole contract.
 * Physical-name mapping and join whitelists are never generated here either.
 */

export type PublishGateCheckId = string;

export const ALL_CHECKS = "__all__";

/** Checks that no exemption may ever waive. */
export const NON_WAIVABLE_CHECKS: ReadonlySet<PublishGateCheckId> = new Set([
  ALL_CHECKS,
  "contract_presence"
]);

export type PublishGateViolation = {
  /** Stable check id, e.g. `columns.0.type`. */
  checkId: PublishGateCheckId;
  filePath?: string;
  connectionId?: string;
  message: string;
};

export type PublishExemption = {
  /** Operator who granted the waiver. */
  operator: string;
  /** Why the waiver exists. */
  reason: string;
  /** ISO timestamp after which the waiver no longer applies. */
  expiresAt: string;
  /** Check ids this waiver covers. */
  checkIds: PublishGateCheckId[];
  /** Connection/scope the waiver is limited to. */
  connectionId?: string;
};

export type PublishExemptionAudit = PublishExemption & {
  grantedAt: string;
};

export type ExemptionDecision =
  | { waived: true; exemption: PublishExemptionAudit; remaining: PublishGateViolation[] }
  | { waived: false; remaining: PublishGateViolation[]; rejectedReason?: string };

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate an exemption request. Every field is mandatory and the expiry must
 * be a real future instant — an exemption with no end is not a waiver, it is a
 * disabled gate, and that is exactly what this rejects.
 */
export function validatePublishExemption(
  input: Partial<PublishExemption>,
  now: Date
): { ok: true; exemption: PublishExemption } | { ok: false; reason: string } {
  const operator = input.operator?.trim() ?? "";
  if (!operator) return { ok: false, reason: "exemption_operator_required" };

  const reason = input.reason?.trim() ?? "";
  if (!reason) return { ok: false, reason: "exemption_reason_required" };

  const expiresAt = input.expiresAt?.trim() ?? "";
  if (!expiresAt) return { ok: false, reason: "exemption_expiry_required" };
  if (!ISO_TIMESTAMP.test(expiresAt)) return { ok: false, reason: "exemption_expiry_not_iso" };
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return { ok: false, reason: "exemption_expiry_not_iso" };
  if (expiry <= now.getTime()) return { ok: false, reason: "exemption_already_expired" };

  const checkIds = (input.checkIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  if (checkIds.length === 0) return { ok: false, reason: "exemption_check_ids_required" };
  // An exemption cannot turn the whole gate off.
  if (checkIds.includes(ALL_CHECKS)) return { ok: false, reason: "exemption_all_checks_forbidden" };

  return {
    ok: true,
    exemption: {
      operator,
      reason,
      expiresAt: new Date(expiry).toISOString(),
      checkIds,
      connectionId: input.connectionId?.trim() || undefined
    }
  };
}

function covers(exemption: PublishExemption, violation: PublishGateViolation): boolean {
  // An exemption can never widen into "waive everything".
  if (exemption.checkIds.includes(ALL_CHECKS)) return false;
  if (!exemption.checkIds.includes(violation.checkId)) return false;
  // A connection-scoped waiver only covers that connection's violations.
  if (exemption.connectionId) return violation.connectionId === exemption.connectionId;
  return true;
}

/**
 * SC-24 — apply an exemption to a violation list.
 *
 * Returns which violations are waived and which still block the publish.
 * A non-waivable check is never covered, and an expired exemption waives
 * nothing: the same publish fails again once the expiry passes.
 */
export function applyPublishExemption(
  violations: readonly PublishGateViolation[],
  exemption: PublishExemption | null | undefined,
  now: Date
): ExemptionDecision {
  if (!exemption) {
    return { waived: false, remaining: [...violations] };
  }
  const expiry = Date.parse(exemption.expiresAt);
  if (Number.isNaN(expiry) || expiry <= now.getTime()) {
    // Expired: the waiver is inert and every violation blocks again.
    return { waived: false, remaining: [...violations], rejectedReason: "exemption_expired" };
  }
  const remaining: PublishGateViolation[] = [];
  const waived: PublishExemptionAudit = {
    ...exemption,
    grantedAt: new Date(now.getTime()).toISOString()
  };
  let matched = false;
  for (const violation of violations) {
    const waivable = !NON_WAIVABLE_CHECKS.has(violation.checkId) && covers(exemption, violation);
    if (waivable) {
      matched = true;
      continue;
    }
    remaining.push(violation);
  }
  if (!matched) {
    return { waived: false, remaining: [...violations], rejectedReason: "exemption_does_not_apply" };
  }
  return { waived: true, exemption: waived, remaining };
}

/**
 * SC-24 / the contract check itself: a semantic source whose `columns[].type`
 * is not a KTX SourceColumn type blocks the publish.
 *
 * The contract is `string | number | time | boolean` (see `webui/src/lib/types.ts`
 * and the semantic-author lint). SQL spellings such as `float` or `timestamp`
 * are rejected here because KTX rejects them too.
 *
 * This is the `columns.0.type` case named by the acceptance criteria.
 */
const ALLOWED_COLUMN_TYPES = new Set(["string", "number", "time", "boolean"]);

export function checkColumnTypeContract(
  columns: unknown,
  filePath: string
): PublishGateViolation[] {
  if (!Array.isArray(columns)) return [];
  const violations: PublishGateViolation[] = [];
  columns.forEach((column, index) => {
    const record = column && typeof column === "object" && !Array.isArray(column)
      ? column as Record<string, unknown>
      : null;
    const declared = record?.type;
    if (typeof declared !== "string" || !declared.trim()) return;
    if (ALLOWED_COLUMN_TYPES.has(declared.trim().toLowerCase())) return;
    violations.push({
      // The check id addresses the exact column, e.g. `columns.0.type`.
      checkId: `columns.${index}.type`,
      filePath,
      message: `columns.${index}.type 的值 ${declared} 不符合 TS/Python SourceColumn 契约`
    });
  });
  return violations;
}

/**
 * Fold SC-24 column-type violations into the validation result the workbench
 * already renders (`validation.ok` and `issues[].message`). No new route.
 */
export function applyColumnTypeContractToValidation<T extends {
  ok: boolean;
  exitCode: number;
  issues?: Array<{ message: string }>;
}>(
  validation: T,
  contracts: ReadonlyArray<{ columns: unknown; filePath: string }>
): T {
  const extra = contracts.flatMap((contract) =>
    checkColumnTypeContract(contract.columns, contract.filePath).map((violation) => ({
      message: violation.message
    }))
  );
  if (extra.length === 0) return validation;
  return {
    ...validation,
    ok: false,
    exitCode: validation.exitCode === 0 ? 1 : validation.exitCode,
    issues: [...(validation.issues ?? []), ...extra]
  };
}

/**
 * SC-24 — the gate verdict. `allowed` is false as soon as one non-waived
 * violation remains, and an exemption alone never produces `allowed: true`
 * from an empty violation list.
 */
export function evaluatePublishGate(
  violations: readonly PublishGateViolation[],
  exemption: PublishExemption | null | undefined,
  now: Date
): {
  allowed: boolean;
  waived: PublishExemptionAudit | null;
  blocking: PublishGateViolation[];
  rejectedReason?: string;
} {
  const decision = applyPublishExemption(violations, exemption, now);
  return {
    allowed: decision.remaining.length === 0,
    waived: decision.waived ? decision.exemption : null,
    blocking: decision.remaining,
    rejectedReason: decision.waived === false ? decision.rejectedReason : undefined
  };
}