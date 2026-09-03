/**
 * Lucy product version (customer-facing).
 * Injected at Vite build time from repo-root VERSION / LUCY_VERSION env.
 * Independent of bundled KTX (`LUCY_BUNDLED_KTX_VERSION`).
 */
const FALLBACK = "0.17.0";
const PRODUCT_VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function normalizeLucyProductVersion(version: string): string | undefined {
  const normalized = version.trim().replace(/^v/i, "");
  return PRODUCT_VERSION_RE.test(normalized) ? normalized : undefined;
}

const injectedVersion =
  (typeof import.meta !== "undefined" &&
    typeof import.meta.env?.VITE_LUCY_VERSION === "string" &&
    import.meta.env.VITE_LUCY_VERSION.trim()) || FALLBACK;

export const LUCY_VERSION: string = normalizeLucyProductVersion(injectedVersion) ?? FALLBACK;

/** Sidebar / UI label, e.g. `v0.17.0`. */
export function formatLucyVersionLabel(version: string = LUCY_VERSION): string {
  const normalized = normalizeLucyProductVersion(version);
  return normalized ? `v${normalized}` : "vunknown";
}
