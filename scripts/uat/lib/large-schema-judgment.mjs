/** Judge actual output, never request attempts or an all-deferred traversal. */
export function judgeReadTables(result, expectedTables, expectedColumnsMin) {
  if (result.failure) return { pass: false, reason: `request failed: ${result.failure}` };
  if (!Number.isSafeInteger(result.done) || result.done !== expectedTables) {
    return { pass: false, reason: `done=${result.done} != expected=${expectedTables}` };
  }
  if (!Number.isSafeInteger(result.columns) || result.columns < expectedColumnsMin) {
    return { pass: false, reason: `columns=${result.columns} < min=${expectedColumnsMin}` };
  }
  return { pass: true, reason: "ok" };
}
