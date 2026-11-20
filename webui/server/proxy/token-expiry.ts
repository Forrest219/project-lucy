/** Pure expiry predicate shared by authentication and display workers. */
export function isTokenExpired(expiresAt: string | number | Date | null | undefined, nowMs = Date.now()): boolean {
  if (expiresAt == null || expiresAt === "") return false;
  if (expiresAt instanceof Date) {
    const ts = expiresAt.getTime();
    return Number.isNaN(ts) || ts <= nowMs;
  }
  if (typeof expiresAt === "number") {
    return !Number.isFinite(expiresAt) || expiresAt <= nowMs;
  }
  const trimmed = expiresAt.trim();
  if (!trimmed || /^(never|none|null|permanent)$/i.test(trimmed)) return false;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T23:59:59.999Z` : trimmed;
  const ts = Date.parse(normalized);
  if (Number.isNaN(ts)) return true;
  return ts <= nowMs;
}
