/**
 * Spec 99 §8 — Admin Capability Preview must show real rowGrant
 * (FinalRows TRUE, or scoped policy digest). Never hardcode TRUE.
 */

export type RowGrantPreview =
  | true
  | "all"
  | { kind: "all" }
  | { kind: "scoped"; digest: string };

/** Display label for Data Capability Preview lines. */
export function formatRowGrantPreviewLabel(rowGrant: unknown): string {
  if (rowGrant === true || rowGrant === "all") return "TRUE";
  if (rowGrant && typeof rowGrant === "object" && !Array.isArray(rowGrant)) {
    const grant = rowGrant as { kind?: unknown; digest?: unknown };
    if (grant.kind === "all") return "TRUE";
    if (grant.kind === "scoped" && typeof grant.digest === "string" && grant.digest.length > 0) {
      return `scoped:${grant.digest}`;
    }
  }
  return "unknown";
}
