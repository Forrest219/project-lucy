import { isDeepStrictEqual } from "node:util";

export type CanonicalLucyQueryArgsResult =
  | { ok: true; args: unknown }
  | { ok: false; reason: string };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeMeasureItem(item: unknown): unknown {
  if (hasNonEmptyString(item)) return item;
  if (!isPlainRecord(item)) return item;
  if (hasNonEmptyString(item.expr)) return item;
  if (hasNonEmptyString(item.$text)) return item.$text.trim();
  if (hasNonEmptyString(item.name)) return item.name.trim();
  return item;
}

function serializedJsonCandidate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const first = value.trimStart()[0];
  return first === "[" || first === "{";
}

/**
 * Canonicalize client-side compatibility aliases before audit, ACL, validation,
 * and upstream rewriting. Structural validation remains in mcp-proxy so all
 * Lucy tools retain the same stable invalid_arguments contract.
 */
export function canonicalizeLucyQueryArgs(
  args: unknown,
  toolName = "lucy_query"
): CanonicalLucyQueryArgsResult {
  if (!isPlainRecord(args)) return { ok: true, args };

  const out: Record<string, unknown> = { ...args };
  if (Array.isArray(out.measures)) {
    out.measures = out.measures.map(normalizeMeasureItem);
  }

  if (serializedJsonCandidate(out.filters)) {
    try {
      out.filters = JSON.parse(out.filters);
    } catch {
      return {
        ok: false,
        reason: `invalid_arguments:${toolName}:filters_serialized_json_invalid`
      };
    }
  }

  const hasSnakeOrder = out.order_by !== undefined;
  const hasCamelOrder = out.orderBy !== undefined;
  if (hasSnakeOrder && hasCamelOrder && !isDeepStrictEqual(out.order_by, out.orderBy)) {
    return {
      ok: false,
      reason: `invalid_arguments:${toolName}:order_by_conflict`
    };
  }
  if (!hasSnakeOrder && hasCamelOrder) {
    out.order_by = out.orderBy;
  }
  delete out.orderBy;

  return { ok: true, args: out };
}
