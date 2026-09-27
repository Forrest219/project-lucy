import { apiPost } from "./apiClient";

export type CatalogNavigationEventType =
  | "visit_start"
  | "tree_select"
  | "tree_toggle"
  | "search_commit"
  | "scope_change"
  | "completion_change"
  | "row_open"
  | "enabled_scope_exit";

export type CatalogNavigationContextLevel = "root" | "connection" | "schema";

export const CATALOG_SEARCH_COMMIT_MS = 500;

export function createCatalogVisitId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function recordCatalogNavigationEvent(input: {
  visitId: string;
  eventType: CatalogNavigationEventType;
  contextLevel?: CatalogNavigationContextLevel;
}): void {
  void apiPost("/api/admin/ui-usage/catalog-navigation-event", input).catch(() => {
    // P0 observation is best-effort and must never interrupt navigation.
  });
}
