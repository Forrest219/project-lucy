/**
 * Spec 99 §8 — Admin Capability Preview must show real rowGrant
 * (FinalRows TRUE, or scoped policy digest). Never hardcode TRUE.
 */

export type RowGrantPreview =
  | true
  | "all"
  | { kind: "all" }
  | { kind: "scoped"; digest: string; predicates?: unknown; orArms?: unknown };

function formatPredicateShort(pred: unknown): string | null {
  if (!pred || typeof pred !== "object" || Array.isArray(pred)) return null;
  const record = pred as { field?: unknown; op?: unknown; value?: unknown; values?: unknown };
  if (typeof record.field !== "string" || record.field.trim().length === 0) return null;
  const field = record.field.trim();
  if (record.op === "eq") {
    return `${field}=${String(record.value ?? "")}`;
  }
  if (record.op === "in" && Array.isArray(record.values)) {
    return `${field} in [${record.values.map((item) => String(item)).join(",")}]`;
  }
  return field;
}

/** Display label for Data Capability Preview lines. */
export function formatRowGrantPreviewLabel(rowGrant: unknown): string {
  if (rowGrant === true || rowGrant === "all") return "TRUE";
  if (rowGrant && typeof rowGrant === "object" && !Array.isArray(rowGrant)) {
    const grant = rowGrant as { kind?: unknown; digest?: unknown; predicates?: unknown };
    if (grant.kind === "all") return "TRUE";
    if (grant.kind === "scoped" && typeof grant.digest === "string" && grant.digest.length > 0) {
      let label = `scoped:${grant.digest}`;
      if (Array.isArray(grant.predicates) && grant.predicates.length > 0) {
        const parts = grant.predicates
          .map((item) => formatPredicateShort(item))
          .filter((item): item is string => Boolean(item))
          .slice(0, 3);
        if (parts.length > 0) {
          label += ` · ${parts.join(" AND ")}`;
          if (grant.predicates.length > 3) label += " …";
        }
      }
      return label;
    }
  }
  return "unknown";
}
