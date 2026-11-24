/** A terminal failure of one table, never a connection or WebUI authentication failure. */
export type SchemaTableRejection = {
  scope: "table";
  table: string;
  reason: "permission" | "missing" | "ambiguous" | "timeout" | "too_large" | "too_wide";
};

const REASONS = new Set(["permission", "missing", "ambiguous", "timeout", "too_large", "too_wide"]);

/** Return a fresh, allowlisted wire value; driver diagnostics must not pass through. */
export function readSchemaTableRejection(value: unknown): SchemaTableRejection | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (item.scope !== "table" || typeof item.table !== "string" || !item.table ||
      typeof item.reason !== "string" || !REASONS.has(item.reason)) return undefined;
  return { scope: "table", table: item.table, reason: item.reason as SchemaTableRejection["reason"] };
}
