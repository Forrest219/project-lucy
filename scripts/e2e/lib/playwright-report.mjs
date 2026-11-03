// Pure readers for a Playwright JSON report.
//
// Two collectors need the same three facts out of a report: which tests exist,
// which annotations a test carries, and what status the test has. They live
// here so the frozen management collector and the v0.25 evidence collector
// cannot drift apart on the semantics of "a test passed".
//
// No I/O, no clock, no network: every function takes the parsed report.

/**
 * Yields every test in the report together with the title of the spec that
 * owns it.
 * @param {any} suite
 * @returns {Generator<{title: string, test: any}>}
 */
export function* iterTests(suite) {
  for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) yield { title: spec.title, test };
  for (const child of suite.suites ?? []) yield* iterTests(child);
}

/**
 * Playwright reports a test's annotations both on the test and on each result;
 * count each fact once.
 * @param {any} test
 * @returns {Array<{type: string, description: string}>}
 */
export function annotationsOf(test) {
  const seen = new Set();
  return [...(test.annotations ?? []), ...(test.results ?? []).flatMap((r) => r.annotations ?? [])].filter((a) => {
    const key = `${a.type}\u0000${a.description}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The status of one test.
 *
 * - a `blocked` annotation wins: BLOCKED is never a pass and never a plain skip;
 * - a skipped test is `skipped`;
 * - an expected test whose last result passed is `passed`;
 * - everything else is `failed`.
 * @param {any} test
 * @returns {"passed"|"failed"|"blocked"|"skipped"}
 */
export function testStatus(test) {
  const annotations = annotationsOf(test);
  if (annotations.some((a) => a.type === "blocked")) return "blocked";
  const last = test.results?.at(-1)?.status;
  if (test.status === "skipped" || last === "skipped") return "skipped";
  if (test.status === "expected" && last === "passed") return "passed";
  return "failed";
}
