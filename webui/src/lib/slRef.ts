/**
 * Helpers for the canonical `conn/schema/table` sl_ref used to link
 * Wiki pages to semantic-layer objects.
 *
 * The persisted value is always the three-part form, e.g.
 * `mysql-aliyun/dataforai/superstore_orders`. UI labels may render a
 * shorter `schema.table` form, but the URL parameter, frontmatter
 * payload and dry-run request body must keep the full ref to stay
 * unambiguous across connections.
 */

/**
 * Normalize a user-supplied sl_ref string. Trims whitespace, removes
 * duplicate slashes and leading/trailing slashes. Returns null when
 * the result is empty.
 */
export function normalizeSlRef(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parts = trimmed.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return parts.join("/");
}

/**
 * Extract the table (third) segment from a canonical sl_ref. Falls
 * back to the last segment when the ref has fewer than three parts
 * so that legacy values still produce a useful draft key.
 */
export function tableNameFromSlRef(ref: string): string {
  const parts = ref.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) {
    return "new-note";
  }
  return parts[parts.length - 1] ?? "new-note";
}

/**
 * Build a deterministic draft key for a given sl_ref. Uses
 * `global/<table>.md` when available, falling back to
 * `global/<table>-wiki.md` if the first form would collide with an
 * existing page key that does not reference this sl_ref.
 */
export function draftKeyForSlRef(ref: string, existingKeys: string[]): string {
  const table = tableNameFromSlRef(ref);
  const taken = new Set(existingKeys);
  const base = `global/${table}.md`;
  if (!taken.has(base)) {
    return base;
  }
  const wikiBase = `global/${table}-wiki.md`;
  if (!taken.has(wikiBase)) {
    return wikiBase;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `global/${table}-wiki-${n}.md`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return `global/${table}-wiki-${Date.now()}.md`;
}

/**
 * Find the first page whose `slRefs` contains the canonical ref.
 * Comparison is exact, case-sensitive and on the normalized value.
 */
export function findWikiBySlRef<T extends { slRefs: string[] }>(
  pages: T[],
  ref: string
): T | undefined {
  return pages.find((page) => page.slRefs?.includes(ref));
}

/**
 * Build a next-available `global/new-note.md` style key. Skips any
 * number that would collide with an existing key.
 */
export function nextNewNoteKey(existingKeys: string[], directory = "global"): string {
  const taken = new Set(existingKeys);
  const normalizedDirectory = directory.split("/").map((part) => part.trim()).filter(Boolean).join("/") || "global";
  const base = `${normalizedDirectory}/new-note.md`;
  if (!taken.has(base)) {
    return base;
  }
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${normalizedDirectory}/new-note-${n}.md`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  // Last-resort: append a timestamp suffix.
  return `${normalizedDirectory}/new-note-${Date.now()}.md`;
}

/**
 * Split a canonical sl_ref into its three segments. Returns null when
 * the value does not have exactly three non-empty parts.
 */
export function splitSlRef(
  ref: string
): { conn: string; schema: string; table: string } | null {
  const parts = ref.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length !== 3) {
    return null;
  }
  return { conn: parts[0], schema: parts[1], table: parts[2] };
}
