// Shared upstream-observation helpers for the security leg.
//
// The independent observer answers exactly one question per case: "how many upstream
// data-plane executions did this request cause, and how many of them were NOT
// authorized?". The answer has THREE states, never two:
//
//   - measured   — the observer produced two comparable snapshots; the delta is a real
//                  integer;
//   - unknown    — the channel could not measure (no provider, not started, bad
//                  cursor, mismatched windows). A missing measurement is NEVER a
//                  zero and NEVER a pass;
//   - not asked  — the case never opened an observation window.
//
// ONE token, TWO branch semantics — the token is `upstream_exec_zero` in both, because
// the spec's claim is about UNAUTHORIZED upstream executions ("拒绝题必须…未授权上游
// 执行为 0"):
//
//   - a DENIED request must cause zero upstream executions at all. Every execution it
//     caused would have been unauthorized ⇒ unauthorized = measured delta.
//
//   - an ALLOWED request (a positive control: an entitled query that must succeed)
//     DID execute upstream — that execution is authorized. The claim "zero
//     unauthorized executions" then means "no execution beyond the authorized one" ⇒
//     unauthorized = max(0, delta − authorizedRequests × authorizedBaseline). The
//     baseline is MEASURED by the runner's positive control (one authorized query →
//     N upstream executions); it is never guessed.
//
// The allow branch additionally asserts `upstream_exec_positive` (the query really did
// execute upstream). Without it, a channel that is not on the request path would make
// the allow branch's "unauthorized = 0" pass VACUOUSLY — the exact failure this
// harness must never produce.
//
// Both helpers write into `checks.extra`:
//   - `upstreamExecutions`      the UNAUTHORIZED execution count (an INTEGER, as the
//                                release evidence schema requires), accumulated across
//                                the case's windows. Absent when the channel could not
//                                measure;
//   - `upstreamObservation`      the raw measurement (delta, baseline, attribution,
//                                per-window detail) for the evidence and the verdict.

/**
 * The observation window for one case.
 *
 * The window's upper bound is deliberately generous: it is an upper bound on the
 * record filter, not a deadline. A narrow bound (the previous `now + 5s`) silently
 * DROPPED the upstream execution of a slow request — which would have turned a deny
 * case's "zero upstream executions" into a vacuous PASS and an allow case's control
 * into a false FAIL. The delta is unaffected: both snapshots use the same window and
 * the observer only counts records that have already completed.
 */
export const OBSERVATION_WINDOW_LOOKBACK_MS = 60_000;
export const OBSERVATION_WINDOW_HORIZON_MS = 10 * 60_000;

/** The window a case observes through. */
export function observationWindow(now = new Date()) {
  return {
    since: new Date(now.getTime() - OBSERVATION_WINDOW_LOOKBACK_MS).toISOString(),
    until: new Date(now.getTime() + OBSERVATION_WINDOW_HORIZON_MS).toISOString()
  };
}

/**
 * Open an observation window. The caller MUST `await window.finish()` after the
 * target request; the helper refuses to guess.
 */
export async function observeWindow(ctx, { label, since, until, agentId, tokenFingerprint }) {
  const before = await ctx.observeUpstream({ since, until, agentId, tokenFingerprint });
  return {
    label,
    before,
    after: null,
    /** Call AFTER the target request. Resolves with the measured delta (or null). */
    async finish() {
      this.after = await ctx.observeUpstream({ since, until, agentId, tokenFingerprint });
      return typeof ctx.upstreamDelta === "function" ? ctx.upstreamDelta(this.before, this.after) : null;
    }
  };
}

/**
 * The measured number of upstream executions between the two snapshots, or null when
 * the channel could not measure. NEVER returns a fabricated zero.
 */
export function measuredDelta(ctx, window) {
  if (!window || !window.before || window.after === null || window.after === undefined) return null;
  const before = window.before.upstreamExecutionCount;
  const after = window.after.upstreamExecutionCount;
  if (before === "unknown" || after === "unknown") return null;
  if (typeof before !== "number" || typeof after !== "number") return null;
  const delta = typeof ctx.upstreamDelta === "function" ? ctx.upstreamDelta(window.before, window.after) : null;
  return typeof delta === "number" ? delta : null;
}

/**
 * How many upstream data-plane executions one authorized request causes. MEASURED by
 * the runner's positive control; the fallback of 1 is only reachable when the
 * channel could not be proven, and in that case the case is blocked anyway.
 */
export function authorizedBaseline(ctx) {
  const value = ctx?.authorizedUpstreamBaseline;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 1;
}

/** Records the measurement into `checks.extra` (accumulating across windows). */
function recordObservation(checks, label, window, { delta, unauthorized, baseline, authorizedRequests }) {
  const extra = checks.extra = checks.extra ?? {};
  const previous = typeof extra.upstreamExecutions === "number" ? extra.upstreamExecutions : 0;
  if (delta === null) {
    // The measurement is missing: the count is NOT zero. Leave the integer field
    // undefined so the release evidence never carries a fabricated 0.
    delete extra.upstreamExecutions;
  } else {
    extra.upstreamExecutions = previous + unauthorized;
  }
  const windows = Array.isArray(extra.upstreamObservationWindows) ? extra.upstreamObservationWindows : [];
  windows.push({
    label,
    measuredDelta: delta,
    unauthorized,
    authorizedBaseline: baseline,
    authorizedRequests,
    source: window?.before?.source ?? "no-observer",
    attribution: window?.before?.attribution ?? "unknown",
    cursor: { before: window?.before?.cursor ?? null, after: window?.after?.cursor ?? null }
  });
  extra.upstreamObservationWindows = windows;
  extra.upstreamObservation = {
    measured: windows.every((w) => w.measuredDelta !== null),
    upstreamExecutionCount: typeof extra.upstreamExecutions === "number" ? extra.upstreamExecutions : "unknown",
    windows
  };
}

/**
 * DENIED request: it must not have reached the upstream.
 *
 * A measurement gap is not a pass: the token is recorded as failed AND the case
 * reports `upstreamObservation.measured = false`, so the runner can tell "the channel
 * could not measure" apart from "the product let it through".
 *
 * @param {object} options
 * @param {number} [options.authorizedRequests] how many AUTHORIZED upstream requests
 *        the window contains (0 for a refused request).
 */
export function expectUpstreamZero(ctx, checks, label, window, { authorizedRequests = 0 } = {}) {
  const delta = measuredDelta(ctx, window);
  const baseline = authorizedBaseline(ctx);
  const expected = authorizedRequests * baseline;
  const unauthorized = delta === null ? null : Math.max(0, delta - expected);
  recordObservation(checks, label, window, { delta, unauthorized, baseline, authorizedRequests });
  if (delta === null) {
    checks.expect("upstream_exec_zero", false, `${label}: independent observer returned 'unknown' (no provider / bad data); missing observation is BLOCKED, not passed`);
    return { measured: false, delta: null, unauthorized: null };
  }
  checks.expect(
    "upstream_exec_zero",
    unauthorized === 0,
    `${label}: measured upstream executions=${delta}, authorized baseline=${expected} (${authorizedRequests} authorized request(s) × ${baseline}); unauthorized=${unauthorized} (must be 0); source=${window.before.source} attribution=${window.before.attribution ?? "n/a"} cursor=${window.before.cursor}->${window.after.cursor}`
  );
  return { measured: true, delta, unauthorized };
}

/**
 * An ALLOWED request that is NOT expected to reach the upstream.
 *
 * Some entitled surfaces are answered by Lucy itself — `lucy_catalog` /
 * `connection_list` read the local semantic layer and never touch the KTX upstream.
 * For those, "the request must have executed upstream" is false by construction, and
 * asserting it would fail a case whose product behaviour is correct. The claim that
 * still holds is the unauthorized one: an entitled metadata read must not cause an
 * upstream execution beyond its own.
 */
export function expectNoUnauthorizedUpstream(ctx, checks, label, window, { authorizedRequests = 1 } = {}) {
  const delta = measuredDelta(ctx, window);
  const baseline = authorizedBaseline(ctx);
  const expected = authorizedRequests * baseline;
  const unauthorized = delta === null ? null : Math.max(0, delta - expected);
  recordObservation(checks, label, window, { delta, unauthorized, baseline, authorizedRequests });
  if (delta === null) {
    checks.expect("upstream_exec_zero", false, `${label}: independent observer returned 'unknown' (no provider / bad data); missing observation is BLOCKED, not passed`);
    return { measured: false, delta: null, unauthorized: null };
  }
  checks.expect(
    "upstream_exec_zero",
    unauthorized === 0,
    `${label}: measured upstream executions=${delta}, authorized baseline=${expected} (${authorizedRequests} authorized request(s) × ${baseline}); unauthorized=${unauthorized} (must be 0); source=${window.before.source} attribution=${window.before.attribution ?? "n/a"} cursor=${window.before.cursor}->${window.after.cursor}`
  );
  return { measured: true, delta, unauthorized };
}

/**
 * ALLOWED request (a positive control): the query MUST have executed upstream, and it
 * must not have caused any execution beyond its own.
 *
 * A measurement gap is not a failure of the product either: no token is evaluated and
 * the case reports `upstreamObservation.measured = false`, so the runner reports the
 * case as BLOCKED (a missing precondition) rather than FAILED.
 */
export function expectAuthorizedUpstream(ctx, checks, label, window, { authorizedRequests = 1 } = {}) {
  const delta = measuredDelta(ctx, window);
  const baseline = authorizedBaseline(ctx);
  const expected = authorizedRequests * baseline;
  const unauthorized = delta === null ? null : Math.max(0, delta - expected);
  recordObservation(checks, label, window, { delta, unauthorized, baseline, authorizedRequests });
  if (delta === null) {
    // A measurement gap is not a pass: the DECLARED token is still evaluated (the
    // contract requires every declared assertion to be evaluated) and it fails. The
    // case also reports `upstreamObservation.measured = false`, so the runner can tell
    // "the channel could not measure" apart from "the product let it through".
    checks.expect("upstream_exec_zero", false, `${label}: independent observer returned 'unknown' (no provider / bad data); missing observation is BLOCKED, not passed`);
    return { measured: false, delta: null, unauthorized: null };
  }
  checks.expect(
    "upstream_exec_positive",
    delta >= authorizedRequests,
    `${label}: measured upstream executions=${delta} (an allowed query must execute upstream; expected at least ${expected}); source=${window.before.source} attribution=${window.before.attribution ?? "n/a"} cursor=${window.before.cursor}->${window.after.cursor}`
  );
  checks.expect(
    "upstream_exec_zero",
    unauthorized === 0,
    `${label}: measured upstream executions=${delta}, authorized baseline=${expected} (${authorizedRequests} authorized request(s) × ${baseline}); unauthorized=${unauthorized} (must be 0); source=${window.before.source} attribution=${window.before.attribution ?? "n/a"} cursor=${window.before.cursor}->${window.after.cursor}`
  );
  return { measured: true, delta, unauthorized };
}
