/**
 * Bounded `IN (?,…)` lists. SQLite caps bound variables per statement
 * (better-sqlite3 default 32,766), so a scope that grows with audit volume must
 * be queried in fixed-size chunks and merged — never expanded into one statement.
 * P1-32 / F-6 (REQ-030-053).
 */
export const SQLITE_IN_CHUNK_SIZE = 500;

/** Run `query` once per chunk of `values` and concatenate the rows. Empty input → no query. */
export function queryInChunks<T, R>(
  values: readonly T[],
  query: (chunk: readonly T[], placeholders: string) => R[],
  chunkSize: number = SQLITE_IN_CHUNK_SIZE
): R[] {
  const merged: R[] = [];
  for (let start = 0; start < values.length; start += chunkSize) {
    const chunk = values.slice(start, start + chunkSize);
    for (const row of query(chunk, chunk.map(() => "?").join(","))) merged.push(row);
  }
  return merged;
}
