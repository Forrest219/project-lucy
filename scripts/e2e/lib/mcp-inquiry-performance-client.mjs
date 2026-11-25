/**
 * P1-78 Task 3 — deterministic Public MCP performance client (MCP control lane).
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   (D2 dual lane, D3 full denominator, D4 timing split, D5 scenario isolation,
 *    D14 no invented zeros, D16 legal control, §4.2 milestones, §4.3 attempt fields)
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 3
 *
 * Rules honoured here:
 * - Network goes through an injectable `fetchImpl`; time comes from an injectable
 *   monotonic clock. No product code, no KTX, no new dependency.
 * - Reuses the P1-53 helpers (`createMcpClient`, `parseMcpToolResult`,
 *   `classifyAttemptReason`, `resolveTokenRef`, `tokenFingerprint`) read-only;
 *   P1-53 default behaviour is untouched.
 * - Notifications (`notifications/initialized`) have no response body: they get a
 *   protocol receipt of their own and **no** RTT is invented for them.
 * - `begin` is only called when `tools/list` actually exposes it; otherwise the
 *   stage is recorded as skipped with a reason — no fabricated call.
 * - The actual in-flight peak is recomputed from entry receipts (admission /
 *   settlement), never from a "sent" log.
 */

import { randomUUID } from "node:crypto";

import {
  MCP_ACCEPT,
  classifyAttemptReason,
  createMcpClient,
  parseMcpToolResult,
  resolveTokenRef,
  rpc,
  tokenFingerprint
} from "./mcp-compatibility-client.mjs";

export const PERFORMANCE_CLIENT_VERSION = "1.0.0";

/** Ordered journey stages (Spec D2 / Plan Task 3 step 2). */
export const JOURNEY_STAGES = Object.freeze([
  "initialize",
  "notifications_initialized",
  "tools_list",
  "catalog",
  "begin",
  "query",
  "continue"
]);

/** Denial codes the Public MCP surface is known to answer with. */
const DENIAL_CODES = Object.freeze([
  "tool_forbidden_global",
  "tool_forbidden",
  "source_or_connection_forbidden",
  "table_forbidden",
  "unknown_or_forbidden_connection",
  "raw_query_forbidden",
  "ddl_dml_forbidden",
  "read_only_violation",
  "query_concurrency_exceeded"
]);

// ---------------------------------------------------------------------------
// clock
// ---------------------------------------------------------------------------

/**
 * Monotonic clock wrapper. Never moves backwards; a caller that injects a raw
 * wall clock still gets a monotonic series for the attempt.
 * @param {{ now?: () => number }} [deps]
 */
export function createMonotonicClock({ now } = {}) {
  const raw = typeof now === "function" ? now : () => Number(process.hrtime.bigint() / 1000n) / 1000;
  let last = null;
  return {
    now() {
      const value = Number(raw());
      if (!Number.isFinite(value)) return last ?? 0;
      if (last != null && value < last) return last;
      last = value;
      return value;
    }
  };
}

// ---------------------------------------------------------------------------
// in-flight tracker (entry receipts)
// ---------------------------------------------------------------------------

/**
 * Tracks request admission/settlement at the transport entry point and
 * recomputes the **actual** in-flight peak from those receipts.
 *
 * A receipt whose settlement lands at or before its admission timestamp was
 * never observably in flight and is excluded from the overlap sweep — a
 * synchronous burst of instant responses must not masquerade as concurrency.
 *
 * @param {{ now?: () => number, laneId?: string|null }} [deps]
 */
export function createInFlightTracker({ now } = {}) {
  const clock = createMonotonicClock({ now });
  const receipts = [];
  let seq = 0;

  function admit(meta = {}) {
    seq += 1;
    const receipt = {
      receiptId: `rcpt-${seq}`,
      admittedAtMs: clock.now(),
      settledAtMs: null,
      outcome: null,
      ...meta
    };
    receipts.push(receipt);
    return receipt;
  }

  function settle(receipt, outcome = "response") {
    if (!receipt || receipt.settledAtMs != null) return receipt;
    receipt.settledAtMs = clock.now();
    receipt.outcome = outcome;
    return receipt;
  }

  /** Wrap a fetch so every request produces an admission/settlement receipt. */
  function wrapFetch(fetchImpl, { laneId = null } = {}) {
    return async function trackedFetch(url, init) {
      const receipt = admit({ laneId, url: String(url) });
      let response;
      try {
        response = await fetchImpl(url, init);
      } catch (error) {
        settle(receipt, "error");
        throw error;
      }
      // The request is no longer in flight once the response headers arrive —
      // that is the server-side window the concurrency claim is about.
      settle(receipt, "response");
      return response;
    };
  }

  /**
   * Recompute the peak in-flight shape from the receipts.
   * @returns {{ peakRequests: number, peakLanes: number, receipts: number, droppedInstant: number }}
   */
  function computeInFlight() {
    const usable = receipts.filter(
      (r) => r.settledAtMs != null && r.settledAtMs > r.admittedAtMs
    );
    const droppedInstant = receipts.length - usable.length;
    const events = [];
    for (const r of usable) {
      events.push({ t: r.admittedAtMs, type: "admit", laneId: r.laneId ?? null });
      events.push({ t: r.settledAtMs, type: "settle", laneId: r.laneId ?? null });
    }
    events.sort((a, b) => (a.t === b.t ? (a.type === "settle" ? -1 : 1) : a.t - b.t));
    let open = 0;
    let peakRequests = 0;
    let peakLanes = 0;
    const lanes = new Map();
    for (const ev of events) {
      if (ev.type === "settle") {
        open = Math.max(0, open - 1);
        const key = ev.laneId ?? "";
        const count = (lanes.get(key) ?? 0) - 1;
        if (count <= 0) lanes.delete(key);
        else lanes.set(key, count);
      } else {
        open += 1;
        const key = ev.laneId ?? "";
        lanes.set(key, (lanes.get(key) ?? 0) + 1);
      }
      peakRequests = Math.max(peakRequests, open);
      peakLanes = Math.max(peakLanes, lanes.size);
    }
    return { peakRequests, peakLanes, receipts: receipts.length, droppedInstant };
  }

  return { admit, settle, wrapFetch, receipts, computeInFlight, clock };
}

// ---------------------------------------------------------------------------
// server audit correlation
// ---------------------------------------------------------------------------

/**
 * Extract the server-side audit correlation carried by a response.
 * Missing values stay `null` — never 0 (Spec D14).
 * @param {{ status?: number, json?: object, headers?: object }} res
 */
export function extractServerAudit(res) {
  const headers = res?.headers ?? {};
  const meta = res?.json?.result?._meta?.lucy ?? res?.json?.result?._meta ?? {};
  const pickNumber = (...values) => {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return null;
  };
  const traceId =
    meta.traceId ??
    meta.trace_id ??
    headers["x-lucy-trace-id"] ??
    headers["x-trace-id"] ??
    null;
  const serverDurationMs = pickNumber(
    meta.serverDurationMs,
    meta.server_duration_ms,
    meta.durationMs,
    meta.duration_ms,
    headers["x-lucy-server-duration-ms"]
  );
  const turnId = meta.turnId ?? meta.turn_id ?? null;
  const available = traceId != null || serverDurationMs != null;
  return {
    traceId: traceId == null ? null : String(traceId),
    serverDurationMs,
    turnId: turnId == null ? null : String(turnId),
    available,
    reason: available ? null : "not_available"
  };
}

// ---------------------------------------------------------------------------
// performance client
// ---------------------------------------------------------------------------

/**
 * Deterministic Public MCP client used by the performance control lane.
 *
 * @param {{
 *   baseUrl: string,
 *   token: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   tracker?: ReturnType<typeof createInFlightTracker>,
 *   laneId?: string|null,
 * }} options
 */
export function createPerformanceMcpClient({
  baseUrl,
  token,
  fetchImpl,
  now,
  tracker = null,
  laneId = null
} = {}) {
  const baseUrlTrimmed = String(baseUrl ?? "").replace(/\/$/, "");
  if (!baseUrlTrimmed) throw new Error("createPerformanceMcpClient requires baseUrl");
  if (!token) throw new Error("createPerformanceMcpClient requires token");
  const baseFetch = fetchImpl ?? globalThis.fetch;
  if (typeof baseFetch !== "function") {
    throw new Error("createPerformanceMcpClient requires fetchImpl (injectable for tests)");
  }
  const clock = createMonotonicClock({ now });
  const trackedFetch = tracker ? tracker.wrapFetch(baseFetch, { laneId }) : baseFetch;
  // P1-53 client reused as-is (same headers, same session/turn handling, same parsing).
  const compat = createMcpClient({
    baseUrl: baseUrlTrimmed,
    token,
    fetchImpl: trackedFetch,
    now: clock.now
  });
  const calls = [];

  function pushCall(call) {
    calls.push(call);
    return call;
  }

  function callRecord({
    method,
    tool = null,
    notification = false,
    startedAtMs,
    endedAtMs,
    res = null,
    error = null,
    parsed = null
  }) {
    const audit = extractServerAudit(res);
    const outcome = notification
      ? res && res.status >= 200 && res.status < 300
        ? "notification_acknowledged"
        : "notification_unacknowledged"
      : error
        ? "error"
        : "response";
    return pushCall({
      rpcRequestId: res?.requestId ?? randomUUID(),
      method,
      tool,
      notification,
      startedAtMs,
      endedAtMs,
      // Notifications carry no response body: an RTT would be invented, so it stays null.
      mcpClientRttMs: notification ? null : Math.max(0, endedAtMs - startedAtMs),
      rttMeasured: !notification,
      httpStatus: res?.status ?? null,
      outcome,
      errorClass: error ? "transport_error" : null,
      errorMessage: error ? String(error?.message ?? error) : null,
      notificationReceipt: notification
        ? {
            httpStatus: res?.status ?? null,
            acknowledged: Boolean(res && res.status >= 200 && res.status < 300),
            bodyAbsent: true,
            protocol: "mcp-notification-202"
          }
        : null,
      traceId: audit.traceId,
      serverDurationMs: audit.serverDurationMs,
      auditAvailable: audit.available,
      auditReason: audit.reason,
      result: res?.json?.result ?? null,
      parsed,
      payload: parsed?.parsed ?? null
    });
  }

  async function callTool(name, args = {}) {
    const startedAtMs = clock.now();
    let res = null;
    let error = null;
    try {
      res = await compat.toolsCall(name, args);
    } catch (err) {
      error = err;
    }
    const endedAtMs = clock.now();
    return callRecord({
      method: "tools/call",
      tool: name,
      startedAtMs,
      endedAtMs,
      res,
      error,
      parsed: res?.parsed ?? null
    });
  }

  /**
   * Send a JSON-RPC notification. No response body is expected; only the
   * protocol receipt is recorded and no RTT is invented.
   */
  async function notify(method, params = {}) {
    const startedAtMs = clock.now();
    let res = null;
    let error = null;
    try {
      const response = await trackedFetch(baseUrlTrimmed, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          accept: MCP_ACCEPT,
          "content-type": "application/json",
          ...(compat.turnId ? { "x-lucy-turn-id": compat.turnId } : {}),
          ...(compat.sessionId ? { "mcp-session-id": compat.sessionId } : {})
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params })
      });
      // Drain the body so the transport receipt is complete; the body itself is
      // not a response envelope and is never treated as one.
      if (typeof response?.text === "function") await response.text();
      res = response;
    } catch (err) {
      error = err;
    }
    const endedAtMs = clock.now();
    return callRecord({
      method,
      notification: true,
      startedAtMs,
      endedAtMs,
      res,
      error
    });
  }

  return {
    clock,
    calls,
    get sessionId() {
      return compat.sessionId;
    },
    get turnId() {
      return compat.turnId;
    },
    get tokenFingerprint() {
      return tokenFingerprint(token);
    },
    async initialize() {
      const startedAtMs = clock.now();
      let res = null;
      let error = null;
      try {
        res = await compat.initialize();
      } catch (err) {
        error = err;
      }
      const endedAtMs = clock.now();
      return callRecord({ method: "initialize", startedAtMs, endedAtMs, res, error });
    },
    notifyInitialized() {
      return notify("notifications/initialized", {});
    },
    async toolsList() {
      const startedAtMs = clock.now();
      let res = null;
      let error = null;
      try {
        res = await compat.toolsList();
      } catch (err) {
        error = err;
      }
      const endedAtMs = clock.now();
      return callRecord({ method: "tools/list", startedAtMs, endedAtMs, res, error });
    },
    callTool,
    notify,
    async beginQuestion({ question, intentSummary } = {}) {
      const startedAtMs = clock.now();
      let res = null;
      let error = null;
      try {
        res = await compat.beginQuestion({ question, intentSummary });
      } catch (err) {
        error = err;
      }
      const endedAtMs = clock.now();
      return callRecord({
        method: "tools/call",
        tool: "lucy_begin_question",
        startedAtMs,
        endedAtMs,
        res,
        error,
        parsed: res?.parsed ?? null
      });
    },
    async query(args) {
      return callTool("lucy_query", args);
    },
    async continueQuestion({ token: continueToken, mode } = {}) {
      return callTool("lucy_continue_question", {
        ...(typeof continueToken === "string" ? { token: continueToken } : {}),
        ...(mode === "new_question" ? { mode: "new_question" } : {})
      });
    }
  };
}

/** Tool names advertised by a `tools/list` response. */
export function extractToolNames(call) {
  const tools = call?.payload?.tools ?? call?.result?.tools ?? null;
  if (!Array.isArray(tools)) return [];
  return tools.map((t) => (typeof t === "string" ? t : t?.name)).filter((n) => typeof n === "string");
}

// ---------------------------------------------------------------------------
// oracle guardrail
// ---------------------------------------------------------------------------

/**
 * Collect numeric measure values out of an MCP result payload.
 * Tolerant on shape: `measures` array/object, `rows`, `data`.
 * @param {any} payload
 */
export function measureValuesFromPayload(payload) {
  const values = {};
  const add = (name, value) => {
    if (typeof name !== "string" || !name) return;
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const key = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
    if (values[key] == null) values[key] = n;
    if (values[name] == null) values[name] = n;
  };
  const measures = payload?.measures;
  if (Array.isArray(measures)) {
    for (const m of measures) {
      if (m && typeof m === "object") add(m.name ?? m.field ?? m.measure, m.value ?? m.val);
    }
  } else if (measures && typeof measures === "object") {
    for (const [key, value] of Object.entries(measures)) add(key, value);
  }
  const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (row && typeof row === "object") {
      for (const [key, value] of Object.entries(row)) add(key, value);
    }
  }
  return values;
}

/**
 * Validity guardrail against the P1-54 oracle referenced by the scenario
 * contract. This is deliberately *not* a semantic evaluation: when the oracle
 * cannot be decided from the MCP payload the result is `not_verifiable`, never
 * a guessed pass (Spec D3 / Plan Task 3 step 5).
 *
 * @param {{ oracle?: object|null, payload?: any }} input
 */
export function checkOracleAgainstResult({ oracle, payload }) {
  if (!oracle || typeof oracle !== "object") {
    return { status: "not_verifiable", reason: "oracle_missing", ref: null, details: {} };
  }
  const ref = oracle.ref ?? null;
  const kind = oracle.kind ?? null;
  if (kind === "deny") {
    // The denial oracle is judged on the observed outcome, not on a payload.
    return { status: "not_verifiable", reason: "deny_oracle_judged_on_outcome", ref, details: {} };
  }
  if (kind !== "exact" || !oracle.expect || typeof oracle.expect !== "object") {
    return {
      status: "not_verifiable",
      reason: `oracle_kind_${kind ?? "unknown"}_needs_external_recomputation`,
      ref,
      details: { kind }
    };
  }
  const values = measureValuesFromPayload(payload);
  const checked = [];
  const mismatched = [];
  const missingKeys = [];
  for (const [key, expected] of Object.entries(oracle.expect)) {
    const actual = values[key];
    if (actual == null) {
      missingKeys.push(key);
      continue;
    }
    const expectedNumber = Number(expected);
    if (!Number.isFinite(expectedNumber)) continue;
    const tolerance = Math.max(1e-6, Math.abs(expectedNumber) * 1e-6);
    const ok = Math.abs(actual - expectedNumber) <= tolerance;
    checked.push({ key, expected: expectedNumber, actual, ok });
    if (!ok) mismatched.push({ key, expected: expectedNumber, actual });
  }
  if (checked.length === 0) {
    return {
      status: "not_verifiable",
      reason: "expected_measures_absent_from_mcp_payload",
      ref,
      details: { expectedKeys: Object.keys(oracle.expect), availableKeys: Object.keys(values) }
    };
  }
  if (missingKeys.length > 0) {
    // Part of the oracle is not observable in this payload: a partial check is
    // not a pass.
    return {
      status: "not_verifiable",
      reason: "expected_measures_absent_from_mcp_payload",
      ref,
      details: { missingKeys, checked, availableKeys: Object.keys(values) }
    };
  }
  if (mismatched.length > 0) {
    return { status: "mismatched", reason: "oracle_value_mismatch", ref, details: { mismatched, checked } };
  }
  return { status: "matched", reason: null, ref, details: { checked } };
}

// ---------------------------------------------------------------------------
// denial classification
// ---------------------------------------------------------------------------

/**
 * Classify an MCP error answer into an access denial or a product error.
 * @param {{ parsed?: any, call?: any }} input
 */
export function classifyDenial({ parsed, call } = {}) {
  const reason = parsed?.reason ?? null;
  const budgetFamily = classifyAttemptReason(reason);
  if (budgetFamily.startsWith("budget_")) {
    return { isDenial: true, reasonCode: reason, family: budgetFamily };
  }
  const haystack = [
    parsed?.message ?? "",
    typeof parsed?.parsed === "string" ? parsed.parsed : JSON.stringify(parsed?.parsed ?? {}),
    call?.payload?.reason ?? ""
  ]
    .filter(Boolean)
    .join(" ");
  for (const code of DENIAL_CODES) {
    if (haystack.includes(code)) {
      return {
        isDenial: true,
        reasonCode: code,
        family: code === "tool_forbidden" || code === "tool_forbidden_global"
          ? "tool_forbidden"
          : "source_or_connection_forbidden"
      };
    }
  }
  if (reason === "http_401" || reason === "http_403") {
    return { isDenial: true, reasonCode: reason, family: "http_forbidden" };
  }
  return { isDenial: false, reasonCode: reason, family: reason ?? "unknown_error" };
}

// ---------------------------------------------------------------------------
// journey
// ---------------------------------------------------------------------------

/**
 * Run one deterministic Public MCP journey and return the timing / outcome
 * record. Every step is attributed to a stage; missing steps are recorded as
 * skipped with a reason instead of being faked.
 *
 * @param {{
 *   client: ReturnType<typeof createPerformanceMcpClient>,
 *   scenario: object,
 *   control: object,
 *   oracle?: object|null,
 *   expectedOutcome?: "allow"|"deny",
 *   deadlineMs?: number|null,
 *   legalControl?: { control: object, oracle?: object|null, caseId?: string }|null,
 * }} input
 */
export async function runMcpPerformanceJourney({
  client,
  scenario,
  control,
  oracle = null,
  expectedOutcome = "allow",
  deadlineMs = null,
  signal = null,
  legalControl = null
} = {}) {
  const clock = client.clock;
  const journeyStartMs = clock.now();
  const stages = [];
  let timedOut = false;
  let cancelled = false;
  let timeoutMs = null;

  const haltReason = () => (cancelled ? "cancelled" : timedOut ? "deadline_exceeded" : null);

  const pushStage = (name, index, startedAtMs, endedAtMs, extra = {}) => {
    const record = {
      stage: name,
      index,
      startedAtMs,
      endedAtMs,
      durationMs: Math.max(0, endedAtMs - startedAtMs),
      ok: true,
      skipped: false,
      reason: null,
      errorClass: null,
      rpcRequestId: null,
      mcpClientRttMs: null,
      rttMeasured: false,
      httpStatus: null,
      ...extra
    };
    stages.push(record);
    return record;
  };

  const overDeadline = () => {
    if (deadlineMs == null) return false;
    return clock.now() - journeyStartMs > deadlineMs;
  };

  const runStage = async (name, fn, { skipReason = null } = {}) => {
    if (signal?.aborted) {
      cancelled = true;
      const t = clock.now();
      const record = pushStage(name, stages.length, t, t, {
        skipped: true,
        reason: "cancelled"
      });
      return { record, call: null, ok: false, reason: "cancelled" };
    }
    if (skipReason != null) {
      const t = clock.now();
      const record = pushStage(name, stages.length, t, t, { skipped: true, reason: skipReason });
      return { record, call: null, ok: true, reason: skipReason };
    }
    const startedAtMs = clock.now();
    let call = null;
    let error = null;
    try {
      call = await fn();
    } catch (err) {
      error = err;
    }
    const endedAtMs = clock.now();
    const record = pushStage(name, stages.length, startedAtMs, endedAtMs, {
      ok: !error && call?.outcome !== "error",
      errorClass: error || call?.outcome === "error" ? "transport_error" : null,
      reason: error ? String(error?.message ?? error) : call?.outcome === "error" ? call.errorMessage : null,
      rpcRequestId: call?.rpcRequestId ?? null,
      mcpClientRttMs: call?.mcpClientRttMs ?? null,
      rttMeasured: call?.rttMeasured === true,
      httpStatus: call?.httpStatus ?? null
    });
    if (error) return { record, call: null, ok: false, reason: record.reason };
    return { record, call, ok: true, reason: null };
  };

  // 1. initialize -------------------------------------------------------
  const init = await runStage("initialize", () => client.initialize());
  const initializeRttMs = init.call?.mcpClientRttMs ?? null;
  if (overDeadline()) timedOut = true;

  const skipStage = (name, reason) => {
    const t = clock.now();
    return pushStage(name, stages.length, t, t, { skipped: true, reason });
  };

  // 2. notifications/initialized ----------------------------------------
  if (!haltReason()) {
    await runStage("notifications_initialized", () => client.notifyInitialized());
    if (overDeadline()) timedOut = true;
  } else {
    skipStage("notifications_initialized", haltReason());
  }

  // 3. tools/list --------------------------------------------------------
  let toolsVisible = [];
  let toolsStageRecord = null;
  if (!haltReason()) {
    const toolsStage = await runStage("tools_list", () => client.toolsList());
    toolsStageRecord = toolsStage.record;
    toolsVisible = extractToolNames(toolsStage.call);
    if (overDeadline()) timedOut = true;
  } else {
    toolsStageRecord = skipStage("tools_list", haltReason());
  }

  // 4. catalog / discovery ----------------------------------------------
  const catalogVisible = toolsVisible.includes("lucy_catalog");
  if (!haltReason()) {
    await runStage("catalog", () => client.callTool("lucy_catalog", {}), {
      skipReason: catalogVisible ? null : "catalog_tool_not_visible"
    });
    if (overDeadline()) timedOut = true;
  } else {
    skipStage("catalog", haltReason());
  }

  // 5. begin (optional — only when the tool is actually exposed) ---------
  const beginVisible = toolsVisible.includes("lucy_begin_question");
  if (!haltReason()) {
    await runStage("begin", () =>
      client.beginQuestion({
        question: control?.begin?.question ?? control?.begin?.intentSummary ?? control?.begin,
        intentSummary:
          control?.begin?.intentSummary ??
          control?.begin?.question ??
          (typeof control?.begin === "string" ? control.begin : scenario?.scenarioId)
      }), { skipReason: beginVisible ? null : "begin_not_visible" });
    if (overDeadline()) timedOut = true;
  } else {
    skipStage("begin", haltReason());
  }

  // 6. query --------------------------------------------------------------
  const queryVisible = toolsVisible.includes("lucy_query");
  let queryCall = null;
  let queryStageRecord = null;
  let querySkippedReason = null;
  if (haltReason()) {
    querySkippedReason = haltReason();
  } else if (!queryVisible) {
    querySkippedReason = "query_tool_not_visible";
  }
  if (querySkippedReason != null) {
    queryStageRecord = skipStage("query", querySkippedReason);
  } else {
    const queryStage = await runStage("query", async () => {
      const steps = Array.isArray(control?.query?.steps) ? control.query.steps : null;
      if (!steps) return client.query(control?.query ?? {});
      let last = null;
      for (const step of steps) {
        last = await client.query(step);
      }
      return last;
    });
    queryCall = queryStage.call;
    queryStageRecord = queryStage.record;
    if (overDeadline()) timedOut = true;
  }

  // 7. continue (only when the protocol asks for it) ----------------------
  const budgetHint = queryCall?.parsed?.reason === "question_budget_exhausted" ? queryCall.parsed.parsed : null;
  const needsContinue =
    Boolean(budgetHint) &&
    (budgetHint?.continuable === true || typeof budgetHint?.continueToken === "string");
  let continueCall = null;
  if (haltReason()) {
    skipStage("continue", haltReason());
  } else if (!needsContinue) {
    skipStage("continue", "not_required");
  } else {
    const cont = await runStage("continue", () =>
      client.continueQuestion({
        token: budgetHint?.continueToken,
        mode: budgetHint?.continuable === true ? undefined : "new_question"
      }));
    continueCall = cont.call;
  }

  const journeyEndMs = clock.now();
  const mcpJourneyMs = Math.max(0, journeyEndMs - journeyStartMs);
  const observedStageMs = stages.reduce((sum, s) => sum + (s.skipped ? 0 : s.durationMs), 0);
  const unattributedMs = Math.max(0, mcpJourneyMs - observedStageMs);

  // ---- outcome / correctness -------------------------------------------
  let outcome = "missing_evidence";
  let correctness = "unknown";
  let errorClass = null;
  let errorMessage = null;
  let denial = null;
  let oracleResult = { status: "not_verifiable", reason: "no_result", ref: oracle?.ref ?? null, details: {} };
  let firstCorrectResultMs = null;
  let finalCorrectAnswerMs = null;
  let decisiveCall = queryCall;

  if (cancelled) {
    outcome = "error";
    errorClass = "cancelled";
    errorMessage = "attempt cancelled";
    correctness = "incorrect";
  } else if (timedOut) {
    outcome = "timeout";
    errorClass = "timeout";
    timeoutMs = mcpJourneyMs;
    correctness = "incorrect";
  } else if (querySkippedReason === "query_tool_not_visible") {
    // The denial is the absence of the tool itself (D7a shape).
    denial = { isDenial: true, reasonCode: "tool_forbidden", family: "tool_forbidden" };
    outcome = "denied";
    errorClass = "tool_forbidden";
    errorMessage = "lucy_query is not exposed to this identity";
    correctness = expectedOutcome === "deny" ? "correct" : "incorrect";
    oracleResult = { status: "matched", reason: null, ref: oracle?.ref ?? null, details: { via: "tool_absent" } };
  } else if (stages.some((s) => s.errorClass === "transport_error")) {
    // A transport failure is a product-side failure, never a silent pass.
    outcome = "crash";
    errorClass = "transport_error";
    errorMessage =
      stages.find((s) => s.errorClass === "transport_error")?.reason ?? null;
    correctness = "incorrect";
  } else if (queryCall && queryCall.outcome === "error") {
    outcome = "crash";
    errorClass = "transport_error";
    errorMessage = queryCall.errorMessage ?? null;
    correctness = "incorrect";
  } else if (queryCall && queryCall.parsed && queryCall.parsed.ok !== true) {
    denial = classifyDenial({ parsed: queryCall.parsed, call: queryCall });
    if (denial.isDenial) {
      outcome = "denied";
      errorClass = denial.family;
      errorMessage = denial.reasonCode;
      correctness = expectedOutcome === "deny" ? "correct" : "incorrect";
      oracleResult = { status: "matched", reason: null, ref: oracle?.ref ?? null, details: { via: "denied" } };
    } else {
      outcome = queryCall.parsed.envelopeEmpty ? "empty_envelope" : "crash";
      errorClass = queryCall.parsed.reason ?? "unknown_error";
      errorMessage = queryCall.parsed.message ?? null;
      correctness = "incorrect";
    }
  } else if (queryCall) {
    oracleResult = checkOracleAgainstResult({ oracle, payload: queryCall.payload });
    if (oracleResult.status === "mismatched") {
      outcome = "wrong_answer";
      errorClass = "oracle_mismatch";
      correctness = "incorrect";
    } else if (oracleResult.status === "matched") {
      outcome = "correct";
      correctness = "correct";
      firstCorrectResultMs = Math.max(0, clock.now() - journeyStartMs);
      finalCorrectAnswerMs = firstCorrectResultMs;
    } else {
      outcome = "correct";
      correctness = "unknown";
      errorClass = null;
    }
  } else if (init.call?.outcome === "error") {
    outcome = "crash";
    errorClass = "transport_error";
    correctness = "incorrect";
  }

  // The judged latency: the complete MCP journey for allowed paths, the
  // denial response for denial paths (Spec §5.1). The denial response is the
  // stage that produced the denial: the tools/list round trip when the tool is
  // simply not exposed, the query round trip when the query itself was denied.
  const denialStage = denial
    ? querySkippedReason === "query_tool_not_visible"
      ? toolsStageRecord
      : queryStageRecord
    : null;
  const denialResponseMs = denialStage && !denialStage.skipped ? denialStage.durationMs : null;
  const latencyMetric = expectedOutcome === "deny" ? "denial_response" : "mcp_journey";
  const journeyMs = expectedOutcome === "deny" ? (denialResponseMs ?? mcpJourneyMs) : mcpJourneyMs;

  const firstObservableStage = stages.find((s) => !s.skipped && s.mcpClientRttMs != null);

  // ---- legal control (D16, same window) -------------------------------
  let legal = null;
  if (legalControl) {
    const legalJourney = await runMcpPerformanceJourney({
      client: legalControl.client ?? client,
      scenario: legalControl.scenario ?? scenario,
      control: legalControl.control,
      oracle: legalControl.oracle ?? null,
      expectedOutcome: "allow",
      deadlineMs
    });
    legal = {
      caseId: legalControl.caseId ?? null,
      outcome: legalJourney.outcome,
      correctness: legalJourney.correctness,
      oracle: legalJourney.oracle,
      firstCorrectResultMs: legalJourney.firstCorrectResultMs,
      journeyMs: legalJourney.journeyMs,
      mcpJourneyMs: legalJourney.mcpJourneyMs,
      stages: legalJourney.stages,
      mcpCalls: legalJourney.mcpCalls
    };
    if (legal.outcome !== "correct") {
      correctness = "incorrect";
      errorClass = errorClass ?? "legal_control_failed";
    }
  }

  return {
    scenarioId: scenario?.scenarioId ?? null,
    caseId: scenario?.questionRef ?? null,
    identityId: control?.identityId ?? null,
    roleCategory: control?.role ?? null,
    roleClass: control?.role ?? control?.identityId ?? "unknown",
    expectedOutcome,
    outcome,
    correctness,
    errorClass,
    errorMessage,
    timeoutMs,
    questionStartedAt: journeyStartMs,
    firstObservableMs: firstObservableStage
      ? Math.max(0, firstObservableStage.endedAtMs - journeyStartMs)
      : "not_available",
    firstObservableKind: firstObservableStage ? "mcp_response" : null,
    firstTokenMs: "not_available",
    firstCorrectResultMs,
    finalCorrectAnswerMs,
    turnWallClockMs: mcpJourneyMs,
    journeyMs,
    mcpJourneyMs,
    latencyMetric,
    denialResponseMs,
    serverDurationMs: decisiveCall?.serverDurationMs ?? null,
    traceId: decisiveCall?.traceId ?? null,
    rpcRequestId: decisiveCall?.rpcRequestId ?? null,
    unattributedMs,
    initializeRttMs,
    toolsVisible,
    stages,
    mcpCalls: client.calls,
    oracle: oracleResult,
    legalControl: legal
  };
}

// ---------------------------------------------------------------------------
// attempt record (§4.3 / coordination contract)
// ---------------------------------------------------------------------------

/**
 * Field names every attempt record must carry (Spec §4.3 + the coordination
 * contract shared with the independent verifier).
 */
export const ATTEMPT_REQUIRED_FIELDS = Object.freeze([
  "runId",
  "scenarioId",
  "caseId",
  "attemptId",
  "planItemId",
  "lane",
  "roleClass",
  "cacheState",
  "concurrencyGroup",
  "clientModel",
  "environment",
  "budgetClass",
  "questionSetDigest",
  "configDigest",
  "fixtureDigest",
  "budgetDigest",
  "clientFingerprint",
  "modelFingerprint",
  "environmentFingerprint",
  "outcome",
  "correctness",
  "errorClass",
  "timeoutMs",
  "firstAttempt",
  "finalAttempt",
  "questionStartedAt",
  "firstObservableMs",
  "firstTokenMs",
  "firstCorrectResultMs",
  "finalCorrectAnswerMs",
  "serverDurationMs",
  "turnWallClockMs",
  "journeyMs",
  "unattributedMs",
  "mcpCalls",
  "stages"
]);

/**
 * Identity fields that may be absent — the absence reason is then mandatory
 * (`<field>MissingReason`).
 */
export const ATTEMPT_NULLABLE_IDENTITY_FIELDS = Object.freeze([
  "retryOf",
  "traceId",
  "rpcRequestId"
]);

/** Outcome vocabulary (kept in sync with the judge / evidence contract). */
export const ATTEMPT_OUTCOME_VALUES = Object.freeze([
  "correct",
  "wrong_answer",
  "unexpected_deny",
  "empty_envelope",
  "timeout",
  "crash",
  "denied",
  "allowed",
  "error",
  "missing_evidence"
]);

/** Correctness vocabulary. */
export const ATTEMPT_CORRECTNESS_VALUES = Object.freeze(["correct", "incorrect", "unknown"]);

export const ATTEMPT_SCHEMA_VERSION = 1;

/**
 * Build one attempt record for `attempts.ndjson`.
 *
 * @param {object} input
 */
export function buildAttemptRecord({
  runId,
  scenario,
  attemptId,
  planItemId = null,
  retryOf = null,
  firstAttempt = false,
  finalAttempt = false,
  journey,
  digests = {},
  clientFingerprint = null,
  modelFingerprint = null,
  environmentFingerprint = null,
  laneId = null,
  plannedLanes = null,
  receipts = [],
  concurrency = null,
  startedAtUtc = null,
  endedAtUtc = null,
  missingReasons = {}
} = {}) {
  const missing = { ...missingReasons };
  // Identity fields that may be absent must carry the reason inline
  // (`<field>MissingReason`) so a reader can tell "not observed" from "lost".
  const nullableIdentity = (value, field, reason) => {
    if (value == null || value === "") {
      missing[field] = reason;
      return { value: null, reason };
    }
    return { value, reason: null };
  };
  const trace = nullableIdentity(journey?.traceId, "traceId", "server audit trace id not exposed");
  const rpc = nullableIdentity(journey?.rpcRequestId, "rpcRequestId", "no decisive rpc call recorded");
  const retry = nullableIdentity(retryOf, "retryOf", "first attempt of the plan item");
  const record = {
    kind: "mcp-inquiry-performance-attempt",
    contract: "lucy-mcp-inquiry-performance-attempt-v1",
    schemaVersion: ATTEMPT_SCHEMA_VERSION,
    clientVersion: PERFORMANCE_CLIENT_VERSION,
    runId: runId ?? null,
    scenarioId: scenario?.scenarioId ?? null,
    caseId: scenario?.questionRef ?? null,
    attemptId: attemptId ?? null,
    planItemId: planItemId ?? attemptId ?? null,
    retryOf: retry.value,
    retryOfMissingReason: retry.reason,
    traceId: trace.value,
    traceIdMissingReason: trace.reason,
    rpcRequestId: rpc.value,
    rpcRequestIdMissingReason: rpc.reason,
    lane: "mcp",
    // input digest group (§4.3)
    questionSetDigest: digests.questionSetDigest ?? null,
    configDigest: digests.configDigest ?? null,
    budgetDigest: digests.budgetDigest ?? null,
    contractDigest: digests.contractDigest ?? null,
    fixtureDigest: digests.fixtureDigest ?? "not_available",
    candidateFingerprint: digests.candidateFingerprint ?? null,
    environmentFingerprint: environmentFingerprint ?? null,
    budgetClass: scenario?.budgetClass ?? null,
    ownerBudgetClass: scenario?.ownerBudgetClass ?? null,
    cacheState: scenario?.cacheState ?? null,
    concurrencyGroup: scenario?.concurrencyGroup ?? null,
    roleCategory: journey?.roleCategory ?? null,
    roleClass: journey?.roleClass ?? journey?.roleCategory ?? "unknown",
    clientFingerprint: clientFingerprint ?? null,
    modelFingerprint: modelFingerprint ?? null,
    clientModel: `${clientFingerprint ?? "unknown"}::${modelFingerprint ?? "unknown"}`,
    environment: environmentFingerprint ?? null,
    oracleRef: scenario?.oracleRef ?? null,
    // result (§4.3)
    outcome: journey?.outcome ?? "missing_evidence",
    correctness: journey?.correctness ?? "unknown",
    errorClass: journey?.errorClass ?? null,
    timeoutMs: journey?.timeoutMs ?? null,
    firstAttempt: Boolean(firstAttempt),
    finalAttempt: Boolean(finalAttempt),
    expectedOutcome: journey?.expectedOutcome ?? null,
    // timing (§4.2)
    questionStartedAt: journey?.questionStartedAt ?? null,
    firstObservableMs: journey?.firstObservableMs ?? "not_available",
    firstObservableKind: journey?.firstObservableKind ?? null,
    firstTokenMs: journey?.firstTokenMs ?? "not_available",
    firstCorrectResultMs: journey?.firstCorrectResultMs ?? "not_available",
    finalCorrectAnswerMs: journey?.finalCorrectAnswerMs ?? "not_available",
    // D14: an unobserved server duration is "not_available", never 0.
    serverDurationMs: journey?.serverDurationMs ?? "not_available",
    turnWallClockMs: journey?.turnWallClockMs ?? null,
    journeyMs: journey?.journeyMs ?? null,
    mcpJourneyMs: journey?.mcpJourneyMs ?? null,
    latencyMetric: journey?.latencyMetric ?? null,
    initializeRttMs: journey?.initializeRttMs ?? null,
    unattributedMs: journey?.unattributedMs ?? null,
    mcpCalls: journey?.mcpCalls ?? [],
    stages: journey?.stages ?? [],
    oracle: journey?.oracle ?? null,
    legalControl: journey?.legalControl ?? null,
    concurrency: concurrency ?? {
      laneId,
      plannedLanes,
      receipts
    },
    startedAtUtc: startedAtUtc ?? null,
    endedAtUtc: endedAtUtc ?? null,
    missingReasons: missing
  };
  record.missingReasons = missing;
  return record;
}

// ---------------------------------------------------------------------------
// role fairness (§5.3)
// ---------------------------------------------------------------------------

/**
 * Per-role-group latency summary plus the fairness verdict.
 * @param {object[]} attempts
 */
export function summarizeRoleFairness(attempts = []) {
  const byRole = new Map();
  for (const a of attempts) {
    const role = a?.roleCategory ?? "(unknown)";
    const lat = Number(a?.journeyMs);
    if (!Number.isFinite(lat)) continue;
    if (!byRole.has(role)) byRole.set(role, []);
    byRole.get(role).push(lat);
  }
  const groups = [...byRole.entries()].map(([role, values]) => {
    const sorted = [...values].sort((x, y) => x - y);
    const rank = (p) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))];
    return {
      role,
      count: sorted.length,
      p50Ms: rank(50),
      p95Ms: sorted.length >= 20 ? rank(95) : "not_estimable",
      maxMs: sorted[sorted.length - 1]
    };
  });
  const reasons = [];
  const p95s = groups.filter((g) => typeof g.p95Ms === "number").map((g) => g.p95Ms);
  if (p95s.length >= 2) {
    const fastest = Math.min(...p95s);
    const slowest = Math.max(...p95s);
    if (slowest > fastest * 2 + 2000) {
      reasons.push(
        `slowest role p95 ${slowest}ms exceeds fastest role p95 ${fastest}ms × 2 + 2000ms (§5.3)`
      );
    }
  }
  return { groups, fair: reasons.length === 0, reasons };
}

export { classifyAttemptReason, parseMcpToolResult, resolveTokenRef, rpc, tokenFingerprint };
