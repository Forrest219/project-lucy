// Independent upstream / KTX / DB execution observer (Spec §6.2, §8.1; A4/C1 binding).
//
// The audit API exposes `audit/observability` with a `traffic` block:
//   { totalRequests, businessCalls, okCalls, errorCalls, deniedCalls, … }
// These are verdict counts — "ok" / "denied" / "error" — NOT raw upstream execution counts.
// A4's `upstream_unmeasured` assertion must NOT be derived from those labels (treating them
// as a measurement is a fabricated zero under a new name). C1 needs to prove an
// unauthorized execution did NOT happen on a real KTX/DB call.
//
// This module is the contract an independent observer must satisfy:
//   - it observes the REGISTERED TARGET (not a mock, not a shim, not a synthesized answer);
//   - it returns per-window counts bound to the run / instance / agent / time window;
//   - the SOURCE must be a real upstream execution log: a KTX execution-log snapshot, a
//     `pg_stat_statements` row count, or a registered sidecar trace. HTTP `tools/list` from
//     the observer's own client is NOT a measurement: it counts the observer's own traffic,
//     not the tested Agent's traffic. The `pass-through:synthetic` source is RESERVED for
//     unit tests and is REJECTED in production (a synthetic source is a fabricated zero
//     under a new name);
//   - missing observation is reported as `unknown` — never as 0;
//   - the count is bound to a query/result/source/filter hash so the verifier can confirm
//     the observation came from THIS query against THIS target, not from any other source.
//     The result hash is computed from the ACTUAL record set the source returned (not from
//     the parsed count alone): a measurement of `count: 0` is meaningless without the
//     record-set hash that proves the source actually executed the query;
//   - the observer is ASYNC: C1's async clients await the snapshot before/after the
//     tested request. A sync observer that "refuses async" is hiding a missing source;
//   - privileged access (the bearer token, the kubectl exec) is held by the observer; the
//     client / agent code can never reach the observer's control plane.
//   - The producer must actually run a real KTX/DB query (when configured) and record the
//     response — not merely accept a JSON claim.
//
// Production: the runner constructs an `observe` function through `createPassThroughObserver`
// that runs `kubectl exec` (or an injected exec runner) against the registered POD to query
// the real KTX execution log / `pg_stat_statements` / registered sidecar. The observer does
// NOT count `tools/list` calls it issued itself — it counts calls the registered target
// actually executed in the window. If the product has no such log/sidecar the observation
// is refused and the case is BLOCKED (`upstreamExecutionCount === "unknown"`).
//
// Tests: a synthetic observer implements the same shape with disposable data so the
// runner binding (`bindEvidence({upstreamExecutionCount})`) can be tested without a live
// target. The synthetic observer MUST NOT be used as a fallback in production; the
// `synthetic: true` flag the test injects is checked by the observer and the source
// "pass-through:synthetic" is refused if `synthetic: false`.

import { createHash } from "node:crypto";

const OBSERVABILITY_WINDOW_HOURS_DEFAULT = 1;
const OBSERVABILITY_HOURS_MAX = 24 * 30;

// Production allowlist — the only sources that may produce a measured execution count.
// `pass-through:synthetic` is NOT in this list; the test allowlist below extends it
// with the explicit `synthetic: true` flag. `loopback-observer` is the real transparent
// forwarding proxy implemented by `local-loopback-observer.mjs` (B3 production caller).
const PRODUCTION_SOURCES = new Set([
  "ktx-exec-log",
  "pg_stat_statements",
  "sidecar-trace",
  "loopback-observer"
]);

// Test-only allowlist extension. A source listed here is REJECTED unless the observer
// was constructed with `synthetic: true`. This is enforced inside `observeExecutions`,
// not in the test, so a misuse in production wiring surfaces as `unknown` at runtime.
const TEST_ONLY_SOURCES = new Set([
  "pass-through:synthetic"
]);

function isSourceAllowed(source, { synthetic = false } = {}) {
  if (PRODUCTION_SOURCES.has(source)) return true;
  if (synthetic && TEST_ONLY_SOURCES.has(source)) return true;
  return false;
}

/**
 * @typedef {Object} ExecutionObservation
 * @property {"unknown" | number} upstreamExecutionCount   raw count of upstream tool executions in the window; 0 is a measured zero, `unknown` means the observer could not perform the measurement.
 * @property {{since: string, until: string}} window      the time window this observation covers.
 * @property {string} source                              the source identifier; `tools/list` is NEVER an accepted source.
 * @property {Object} [hashes]                            canonical hashes the verifier may use to bind the observation.
 * @property {string} [hashes.queryHash]
 * @property {string} [hashes.resultSetHash]              sha256 of the ACTUAL record set the source returned (rows joined by `\n` and sorted by their canonical representation); proves the source actually executed the query.
 * @property {string} [hashes.sourceHash]
 * @property {string} [hashes.filterHash]
 * @property {boolean} [hashes.synthetic]                 true when the source is a test-only synthetic; the verifier can reject synthetic observations as not-applicable to release gating.
 * @property {string[]} [problems]                        structured problems; the observation is refused when non-empty.
 * @property {string} [recordSetDigest]                   alias for resultSetHash; deprecated, kept for backward compatibility.
 */

function hashHex(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

/**
 * Hash a record set (array of objects) into a stable digest. Rows are sorted by their
 * canonical JSON representation so the digest is independent of the order the source
 * returned them. The empty record set is a valid input; the digest is sha256 of the
 * canonical "[]" representation.
 */
function hashRecordSet(rows) {
  if (!Array.isArray(rows)) return null;
  const canonical = rows.map((r) => JSON.stringify(r, Object.keys(r).sort())).sort().join("\n");
  return hashHex(canonical);
}

/**
 * Observer contract: bind a measured execution count to the run / agent / time window.
 * The observer function may be ASYNC; this entry point awaits the result so the C1
 * consumer's `await observeExecutions(...)` always yields a settled observation. A
 * sync observer is also accepted (we still `await` the result, which is a no-op).
 *
 * @param {Object}   args
 * @param {string}   args.runId
 * @param {string}   [args.instanceId]
 * @param {string}   args.agentId
 * @param {string}   args.tokenFingerprint
 * @param {string}   args.since                 ISO-8601
 * @param {string}   args.until                 ISO-8601
 * @param {Function} [args.observe]             injected observation provider; production: real KTX/DB pass-through
 * @param {boolean}  [args.synthetic]           true when the source is a test-only synthetic; production wiring MUST set this false.
 *
 * @returns {Promise<ExecutionObservation>}
 */
export async function observeExecutions({ runId, instanceId, agentId, tokenFingerprint, since, until, observe, synthetic = false }) {
  const problems = [];
  if (!runId) problems.push("runId is required");
  if (!agentId) problems.push("agentId is required");
  if (!tokenFingerprint) problems.push("tokenFingerprint is required");
  if (!since || !until) problems.push("since/until are required (ISO-8601)");
  const start = since ? Date.parse(since) : NaN;
  const end = until ? Date.parse(until) : NaN;
  if (Number.isNaN(start) || Number.isNaN(end)) problems.push("since/until must be valid ISO-8601 timestamps");
  if (!Number.isNaN(start) && !Number.isNaN(end) && end < start) problems.push("until is before since");

  const window = { since, until };

  // No observation provider means the measurement is unknown, NOT 0.
  if (typeof observe !== "function") {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source: "no-observer",
      problems: [...problems, "no independent observation provider was configured (the runner did not wire a real KTX/DB pass-through observer; missing provider is 'unknown', not 0)"]
    };
  }

  // The observer itself does the privileged work. We do NOT trust any count that came in
  // as a non-integer, negative, NaN, or fractional number: a bad observation is refused.
  // The observer may be async (production pass-through observers are async because the
  // exec channel is async); this entry point awaits the result. A Promise rejection is a
  // refused observation — never a fallback to 0.
  let raw;
  try {
    raw = await observe({ runId, instanceId, agentId, tokenFingerprint, since, until });
  } catch (error) {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source: "observer-threw",
      problems: [...problems, `observer threw: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
  if (raw && typeof raw === "object" && typeof raw.then === "function") {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source: "observer-async-not-resolved",
      problems: [...problems, "observer returned a still-pending Promise; the contract requires a fully-resolved snapshot before this point"]
    };
  }
  const count = raw?.count;
  const source = raw?.source ?? "observer";
  if (!isSourceAllowed(source, { synthetic })) {
    problems.push(`source "${source}" is not in the production allowlist (${JSON.stringify([...PRODUCTION_SOURCES])}); tools/list and synthetic sources are not accepted as an execution-count source`);
  }
  // Compute the resultSetHash from the actual record set. A measurement without a
  // record-set hash is meaningless: a synthetic "count: 0" is indistinguishable from
  // a real "the source returned no rows", and we refuse the measurement to make that
  // visible. An empty record set is a legitimate result (e.g. `pg_stat_statements`
  // returns no rows for a window with no queries), so the contract is: the source
  // MUST return a `recordSet` (possibly empty) so we can hash it. A missing
  // `recordSet` is a refusal.
  const recordSet = raw?.recordSet;
  const resultSetHash = hashRecordSet(recordSet);
  if (!synthetic && !Array.isArray(recordSet)) {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source,
      hashes: { resultSetHash, synthetic },
      problems: [...problems, "observer did not return a recordSet (even an empty array is acceptable); the verifier requires a recordSetHash bound to the actual rows the source returned, not a bare count"]
    };
  }
  if (count === "unknown" || count === undefined || count === null) {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source,
      hashes: raw?.hashes ? { ...raw.hashes, resultSetHash: raw.hashes.resultSetHash ?? resultSetHash, synthetic: raw.hashes.synthetic ?? synthetic } : { resultSetHash, synthetic },
      problems: [...problems, ...(Array.isArray(raw?.problems) ? raw.problems : [])]
    };
  }
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source,
      hashes: raw?.hashes ? { ...raw.hashes, resultSetHash: raw.hashes.resultSetHash ?? resultSetHash, synthetic: raw.hashes.synthetic ?? synthetic } : { resultSetHash, synthetic },
      problems: [...problems, `observer returned a non-integer / negative count: ${JSON.stringify(count)}`]
    };
  }
  if (!isSourceAllowed(source, { synthetic })) {
    return {
      upstreamExecutionCount: "unknown",
      window,
      source,
      hashes: raw?.hashes ? { ...raw.hashes, resultSetHash: raw.hashes.resultSetHash ?? resultSetHash, synthetic: raw.hashes.synthetic ?? synthetic } : { resultSetHash, synthetic },
      problems
    };
  }
  return {
    upstreamExecutionCount: count,
    window,
    source,
    hashes: raw?.hashes ? { ...raw.hashes, resultSetHash: raw.hashes.resultSetHash ?? resultSetHash, synthetic: raw.hashes.synthetic ?? synthetic } : { resultSetHash, synthetic },
    problems: [...problems, ...(Array.isArray(raw?.problems) ? raw.problems : [])]
  };
}

/**
 * Pass-through observer that runs an injected exec runner against the registered target.
 * The exec runner is a privileged channel (typically `kubectl exec ... -- sqlite3 ...`,
 * or `pg_stat_statements` over a registered sidecar). The observer does NOT count
 * `tools/list` calls it issues itself — it counts what the real source returns.
 *
 * The runner signature is `({ args }) => Promise<{ ok, stdout, stderr, rows, error? }>`.
 * `rows` is the source's actual record set (parsed by the runner from the source's own
 * output format). The observer hashes the rows into a `resultSetHash` that the verifier
 * can use to confirm the source actually executed the query.
 *
 * The runner MUST be a real exec channel (no JS-level mock in production). Tests inject
 * a stub.
 */
export function createPassThroughObserver({ source, runCommand, identity, runId, instanceId, synthetic = false }) {
  if (!isSourceAllowed(source, { synthetic })) {
    throw new Error(`createPassThroughObserver: source must be in ${JSON.stringify({ production: [...PRODUCTION_SOURCES], test: [...TEST_ONLY_SOURCES] })}, got "${source}" (synthetic=${synthetic})`);
  }
  if (typeof runCommand !== "function") throw new Error("createPassThroughObserver: runCommand (privileged exec channel) is required");
  if (!identity) throw new Error("createPassThroughObserver: identity is required (used as the filter)");
  if (!runId) throw new Error("createPassThroughObserver: runId is required");

  return async function observe({ agentId, tokenFingerprint, since, until }) {
    const problems = [];
    const start = Date.parse(since);
    const end = Date.parse(until);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      return { count: "unknown", source, recordSet: [], problems: ["pass-through observer received an invalid time window"] };
    }
    // The command is the upstream source's own query; the runner executes it against the
    // registered target via the privileged exec channel. The command shape is the
    // SOURCE's contract (e.g. `sqlite3 security.sqlite "SELECT COUNT(*) ..."` or
    // `psql -c "SELECT count(*) FROM pg_stat_statements WHERE ..."`), not a Lucy API call.
    const cmd = {
      since,
      until,
      runId,
      instanceId: instanceId ?? null,
      agentId,
      tokenFingerprint,
      identity
    };
    let res;
    try {
      res = await runCommand({ args: cmd });
    } catch (error) {
      return { count: "unknown", source, recordSet: [], problems: [...problems, `pass-through exec threw: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (!res?.ok) {
      return { count: "unknown", source, recordSet: [], problems: [...problems, `pass-through exec failed: ${res?.error ?? "unknown"}`] };
    }
    const text = String(res.stdout ?? "").trim();
    // The exec channel MUST return rows (the source's record set) AND a stdout text.
    // An empty stdout AND no rows is a contract violation: we cannot tell whether the
    // source returned zero rows or whether the runner silently swallowed the result.
    const rows = Array.isArray(res.rows) ? res.rows : null;
    if (rows === null) {
      return { count: "unknown", source, recordSet: [], problems: [...problems, "pass-through exec returned no rows[] field; the runner must report the source's actual record set so the verifier can hash it"] };
    }
    if (rows.length === 0 && text === "") {
      return { count: "unknown", source, recordSet: [], problems: [...problems, "pass-through exec returned zero rows and zero stdout; refusing to fabricate a count of 0 from an empty payload"] };
    }
    // Count is derived from the rows (NOT from `Number(text)`) when the source has a
    // record-set output (e.g. `pg_stat_statements`); the source may also return a
    // scalar count, in which case `text` carries the integer. The runner decides the
    // shape; we accept either.
    let count;
    if (typeof res.count === "number" && Number.isInteger(res.count) && res.count >= 0) {
      count = res.count;
    } else if (text === "") {
      count = rows.length;
    } else {
      const parsed = Number(text);
      if (Number.isInteger(parsed) && parsed >= 0) count = parsed;
      else return { count: "unknown", source, recordSet: rows, problems: [...problems, `pass-through exec returned a non-integer count: ${JSON.stringify(text.slice(0, 80))}`] };
    }
    const queryHash = hashHex(JSON.stringify(cmd));
    const resultSetHashLocal = hashRecordSet(rows);
    const sourceHash = hashHex(`${source}|${runId}|${instanceId ?? ""}|${agentId ?? ""}|${identity}`);
    const filterHash = hashHex(`${identity}|${agentId}|${tokenFingerprint}|${since}|${until}`);
    return {
      count,
      source,
      recordSet: rows,
      hashes: { queryHash, resultSetHash: resultSetHashLocal, sourceHash, filterHash, synthetic },
      problems: []
    };
  };
}

/**
 * The verifier-friendly shape of `ExecutionObservation`. The runner exposes this so the
 * downstream verifier can see `upstreamExecutionCount` as `"unknown"` (refused) vs a
 * non-negative integer (measured), and the `hashes.synthetic` flag to reject synthetic
 * sources for release gating.
 */
export function toRunnerShape(observation) {
  return {
    upstreamExecutionCount: observation.upstreamExecutionCount,
    window: observation.window,
    source: observation.source,
    hashes: observation.hashes,
    problems: observation.problems
  };
}

export const _internals = { PRODUCTION_SOURCES, TEST_ONLY_SOURCES, hashHex, hashRecordSet };
