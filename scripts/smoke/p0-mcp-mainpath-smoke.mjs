#!/usr/bin/env node
/**
 * p0-mcp-mainpath-smoke.mjs — Pure MCP end-to-end main-path & latency regression gate.
 *
 * Covers the four recurring MCP failure classes recorded in docs/lessons/:
 *   - M1: Handshake tail latency & catalog latency budgets (2026-11-23-roster-busy-and-mcp-latency.md)
 *   - M2: Zero-binding `lucy_begin_question` + no-begin control path (2026-11-19-begin-zero-binding-test-gap.md)
 *   - M3: Source ambiguity gate pure-MCP escape, rejecting `usableTargets=[]` deadlocks (2026-11-16-source-ambiguity-gate-deadlock.md)
 *   - M4: First-class error classification (budget_exhausted != acl_deny) & unauthorized tool negative check (2026-11-22-question-budget-exhausted-recurring.md)
 *   - M5: Session teardown (DELETE /mcp) & transparent upstream session recovery
 *
 * Reusable both inside `p0-demo-docker-smoke.mjs` (daily CI `demo-db-smoke`) and
 * standalone against any local Docker demo via `npm run smoke:p0:mcp-mainpath`.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  classifyAttemptReason,
  isBudgetDenyClass
} from "../e2e/lib/mcp-compatibility-client.mjs";

export const EXIT_CODES = { pass: 0, fail: 1, usage: 2, blocked: 42 };
export const SESSION_REQUIRED_TEXT = "MCP initialize request is required before session traffic.";

const DEFAULT_PROXY_URL = process.env.LUCY_MCP_MAINPATH_PROXY_URL ?? "http://127.0.0.1:57881/mcp";
const DEFAULT_TOKEN_ENV = "LUCY_DEMO_AGENT_TOKEN";
const DEFAULT_BASELINE_PATH = "examples/docker-demo/mysql/_baseline.json";

const USAGE = `Usage:
  npm run smoke:p0:mcp-mainpath -- [options]

Options:
  --proxy-url <url>               Lucy MCP Proxy URL. Default: ${DEFAULT_PROXY_URL}
  --token-env <name>              Env var containing Bearer token. Default: ${DEFAULT_TOKEN_ENV}
  --connection-id <id>            Connection ID. Default: demo-mysql
  --source-name <name>            Semantic source. Default: superstore_orders
  --baseline <path>               Optional baseline JSON for sales_by_region assertion.
  --concurrent-handshakes <n>     Parallel initialize probes. Default: 10
  --max-warmup-ms <n>             Max warmup initialize latency (ms). Default: 2000
  --max-handshake-p50-ms <n>      Max concurrent handshake P50 (ms). Default: 500
  --max-handshake-p95-ms <n>      Max concurrent handshake P95 (ms). Default: 1500
  --max-catalog-ms <n>            Max lucy_catalog latency (ms). Default: 1500
  --timeout-ms <n>                Per-request timeout (ms). Default: 15000
  --out <path>                    Optional redacted JSON evidence output path.
  --help                          Show this help.
`;

function parseRpcBody(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("event:")) return JSON.parse(trimmed);
  const payloads = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()));
  return payloads.findLast(
    (payload) => payload && typeof payload === "object" && ("result" in payload || "error" in payload)
  ) ?? null;
}

function tryParseJson(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

export function redactToken(value, token, max = 500) {
  const raw = typeof value === "string" ? value : JSON.stringify(value ?? "");
  const cleaned = token ? raw.split(token).join("[REDACTED]") : raw;
  return cleaned.length > max ? `${cleaned.slice(0, max)}…` : cleaned;
}

export function percentile(values, p) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function extractToolPayload(body) {
  const result = body?.result;
  if (!result || typeof result !== "object") return null;
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  if (result.data && typeof result.data === "object") {
    return result.data;
  }
  const firstText = (result.content ?? []).find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  return firstText !== undefined ? tryParseJson(firstText) : null;
}

function extractErrorReason(response) {
  const resultData = response?.body?.result?.data;
  if (resultData && typeof resultData === "object") {
    const dataReason = resultData.reason ?? resultData.code ?? resultData.error?.code;
    if (typeof dataReason === "string" && dataReason.trim()) return dataReason.trim();
  }
  const payload = extractToolPayload(response?.body);
  if (payload && typeof payload === "object") {
    const reason = payload.reason ?? payload.code ?? payload.error?.code;
    if (typeof reason === "string" && reason.trim()) return reason.trim();
  }
  const rpcErr = response?.body?.error;
  if (rpcErr && typeof rpcErr === "object") {
    if (typeof rpcErr.data?.reason === "string") return rpcErr.data.reason;
    if (typeof rpcErr.message === "string" && rpcErr.message.includes("denied")) return "acl_denied";
  }
  const text = String(response?.text ?? "");
  if (text.includes("question_budget_exhausted")) return "question_budget_exhausted";
  if (text.includes("question_budget_concurrency_exceeded")) return "question_budget_concurrency_exceeded";
  if (text.includes("question_budget_unavailable")) return "question_budget_unavailable";
  if (text.includes("source_ambiguity_gate")) return "source_ambiguity_gate";
  if (text.includes("caliber_binding_unresolved")) return "caliber_binding_unresolved";
  if (text.includes(SESSION_REQUIRED_TEXT)) return "session_required";
  const plainAclMatch = text.match(/\b(tool_absolute_deny|tool_forbidden|tool_unclassified|explicit_table_required)\b/i);
  if (plainAclMatch) return plainAclMatch[1].toLowerCase();
  if (/access denied/i.test(text)) return "access_denied";
  return null;
}

/**
 * First-class error classification for MCP responses.
 * Never collapses `question_budget_exhausted` into `acl_deny`.
 */
export function classifyMcpError(response) {
  const text = String(response?.text ?? "");
  if (text.includes(SESSION_REQUIRED_TEXT)) {
    return { errorClass: "session_error", reason: "session_required" };
  }
  const reason = extractErrorReason(response);
  const budgetClass = classifyAttemptReason(reason);
  if (isBudgetDenyClass(budgetClass) || budgetClass === "budget_escape_rejected") {
    return { errorClass: budgetClass, reason };
  }
  if (reason === "source_ambiguity_gate") {
    return { errorClass: "ambiguity_gate", reason };
  }
  if (reason === "caliber_binding_unresolved") {
    return { errorClass: "caliber_unresolved", reason };
  }
  if (
    response?.status === 401
    || response?.status === 403
    || (reason && /acl|denied|forbidden|not_allowed|tool_not_allowed|tool_absolute_deny|tool_forbidden|tool_unclassified|unauthorized|access_denied/i.test(reason))
    || (response?.body?.error && /not allowed|forbidden|denied|unauthorized/i.test(String(response.body.error.message ?? "")))
    || /access denied|tool_absolute_deny|tool_forbidden|tool_unclassified/i.test(text)
  ) {
    return { errorClass: "acl_deny", reason: reason ?? `http_${response?.status ?? 0}` };
  }
  return { errorClass: "tool_error", reason: reason ?? `http_${response?.status ?? 0}` };
}

function isRpcFailed(response) {
  if (!response) return true;
  if (response.status < 200 || response.status >= 300) return true;
  if (response.body?.error) return true;
  if (response.body?.result?.isError === true) return true;
  const payload = extractToolPayload(response.body);
  if (payload && typeof payload === "object") {
    if (
      payload.reason === "question_budget_exhausted"
      || payload.reason === "source_ambiguity_gate"
      || payload.reason === "caliber_binding_unresolved"
      || payload.ok === false
    ) {
      return true;
    }
  }
  return false;
}

function rowsByRegion(headers, rows) {
  const map = new Map();
  const regionIndex = Array.isArray(headers) ? headers.indexOf("region") : -1;
  const salesIndex = Array.isArray(headers) ? headers.indexOf("total_sales") : -1;
  for (const row of rows ?? []) {
    if (Array.isArray(row)) {
      const region = row[regionIndex >= 0 ? regionIndex : 0];
      const sales = row[salesIndex >= 0 ? salesIndex : 1];
      map.set(String(region), Number(sales));
    } else if (row && typeof row === "object") {
      const region = row.region ?? row["superstore_orders.region"];
      const sales = row.total_sales ?? row["superstore_orders.total_sales"];
      map.set(String(region), Number(sales));
    }
  }
  return map;
}

function assertQueryData(label, response, baseline) {
  const payload = extractToolPayload(response?.body);
  const rows = payload?.rows ?? payload?.data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${label} returned empty or missing rows`);
  }
  if (baseline?.sales_by_region) {
    const actual = rowsByRegion(payload?.headers, rows);
    const expected = baseline.sales_by_region;
    const expectedKeys = Object.keys(expected).sort();
    const actualKeys = [...actual.keys()].sort();
    if (expectedKeys.join(",") !== actualKeys.join(",")) {
      throw new Error(`${label} expected regions ${expectedKeys.join(",")}, got ${actualKeys.join(",")}`);
    }
    for (const [region, expectedSales] of Object.entries(expected)) {
      const delta = Math.abs(Number(actual.get(region)) - Number(expectedSales));
      if (!Number.isFinite(delta) || delta > 0.01) {
        throw new Error(`${label} region ${region} expected ${expectedSales}, got ${actual.get(region)}`);
      }
    }
  }
  return rows.length;
}

export async function runMcpMainpathSmoke(options) {
  const {
    proxyUrl = DEFAULT_PROXY_URL,
    token,
    connectionId = "demo-mysql",
    sourceName = "superstore_orders",
    baseline = null,
    concurrentHandshakes = 10,
    timeoutMs = 15_000,
    out = null,
    fetchImpl = globalThis.fetch,
    now = () => Date.now()
  } = options ?? {};

  const budgets = {
    maxWarmupMs: options?.budgets?.maxWarmupMs ?? 2_000,
    maxHandshakeP50Ms: options?.budgets?.maxHandshakeP50Ms ?? 500,
    maxHandshakeP95Ms: options?.budgets?.maxHandshakeP95Ms ?? 1_500,
    maxCatalogMs: options?.budgets?.maxCatalogMs ?? 1_500
  };

  if (!token) throw new Error("Missing MCP Bearer token");
  if (typeof fetchImpl !== "function") throw new Error("Missing fetchImpl");

  let rpcSeq = 1;
  const errorBreakdown = {
    acl_deny: 0,
    budget_exhausted: 0,
    budget_concurrency_exceeded: 0,
    budget_unavailable: 0,
    budget_escape_rejected: 0,
    ambiguity_gate: 0,
    caliber_unresolved: 0,
    session_error: 0,
    tool_error: 0
  };
  const checks = [];
  const latencies = {
    warmupMs: null,
    concurrentHandshake: null,
    catalogMs: null,
    queryMs: null
  };

  const recordError = (response) => {
    const classified = classifyMcpError(response);
    if (classified.errorClass in errorBreakdown) {
      errorBreakdown[classified.errorClass] += 1;
    } else {
      errorBreakdown.tool_error += 1;
    }
    return classified;
  };

  async function callRpc(sessionId, method, params, extraHeaders = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = now();
    try {
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
        ...(sessionId ? { "mcp-session-id": sessionId } : {}),
        ...extraHeaders
      };
      const res = await fetchImpl(proxyUrl, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: `mcp-mainpath-${rpcSeq++}`, method, params })
      });
      const text = await res.text();
      const durationMs = Math.max(0, now() - started);
      let body = null;
      try {
        body = parseRpcBody(text);
      } catch {
        body = null;
      }
      const nextSessionId = res.headers?.get?.("mcp-session-id") ?? undefined;
      return { status: res.status, body, text, sessionId: nextSessionId, durationMs };
    } finally {
      clearTimeout(timer);
    }
  }

  async function deleteSession(sessionId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(proxyUrl, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${token}`,
          ...(sessionId ? { "mcp-session-id": sessionId } : {})
        },
        signal: controller.signal
      });
      await res.text();
      return res.status;
    } finally {
      clearTimeout(timer);
    }
  }

  async function openSession(clientName) {
    const init = await callRpc("", "initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: clientName, version: "1.0.0" }
    });
    if (isRpcFailed(init)) {
      const err = recordError(init);
      throw new Error(`initialize (${clientName}) failed [${err.errorClass}/${err.reason}]: ${redactToken(init.text, token)}`);
    }
    if (!init.sessionId) {
      throw new Error(`initialize (${clientName}) did not return mcp-session-id`);
    }
    await callRpc(init.sessionId, "notifications/initialized", {});
    return init;
  }

  const queryArgsFor = (targetSource = sourceName) => ({
    connectionId,
    measures: [`${targetSource}.total_sales`],
    dimensions: [{ field: `${targetSource}.region` }],
    ...(targetSource === "superstore_orders" ? { segments: [`${targetSource}.active_rows`] } : {}),
    limit: 5,
    include: ["sql"]
  });

  const evidence = {
    contract: "lucy-p0-mcp-mainpath-smoke",
    generatedAt: new Date().toISOString(),
    verdict: "running",
    target: { proxyUrl, connectionId, sourceName, budgets },
    latencies,
    errorBreakdown,
    checks
  };

  try {
    // ── M1: Warmup + concurrent handshake & catalog latency budgets ─────────
    const warmup = await openSession("lucy-mainpath-warmup");
    latencies.warmupMs = warmup.durationMs;
    if (warmup.durationMs > budgets.maxWarmupMs) {
      throw new Error(`M1 warmup initialize took ${warmup.durationMs}ms (budget ${budgets.maxWarmupMs}ms)`);
    }

    const parallel = await Promise.all(
      Array.from({ length: concurrentHandshakes }, (_, idx) => openSession(`lucy-mainpath-c${idx}`))
    );
    const handshakeMs = parallel.map((item) => item.durationMs);
    const p50Ms = percentile(handshakeMs, 50);
    const p95Ms = percentile(handshakeMs, 95);
    const maxMs = Math.max(...handshakeMs);
    latencies.concurrentHandshake = { count: concurrentHandshakes, p50Ms, p95Ms, maxMs };
    if (p50Ms > budgets.maxHandshakeP50Ms) {
      throw new Error(`M1 concurrent handshake P50=${p50Ms}ms exceeded budget ${budgets.maxHandshakeP50Ms}ms`);
    }
    if (p95Ms > budgets.maxHandshakeP95Ms) {
      throw new Error(`M1 concurrent handshake P95=${p95Ms}ms exceeded budget ${budgets.maxHandshakeP95Ms}ms`);
    }

    const catalog = await callRpc(warmup.sessionId, "tools/call", { name: "lucy_catalog", arguments: {} });
    latencies.catalogMs = catalog.durationMs;
    if (isRpcFailed(catalog)) {
      const err = recordError(catalog);
      throw new Error(`M1 lucy_catalog failed [${err.errorClass}/${err.reason}]`);
    }
    if (!catalog.text.includes(sourceName)) {
      throw new Error(`M1 lucy_catalog response did not expose ${sourceName}`);
    }
    if (catalog.durationMs > budgets.maxCatalogMs) {
      throw new Error(`M1 lucy_catalog took ${catalog.durationMs}ms (budget ${budgets.maxCatalogMs}ms)`);
    }
    checks.push({
      id: "M1_handshake_and_catalog_latency",
      status: "pass",
      warmupMs: warmup.durationMs,
      p50Ms,
      p95Ms,
      maxMs,
      catalogMs: catalog.durationMs
    });

    // Discover visible tools once
    const listRes = await callRpc(warmup.sessionId, "tools/list", {});
    if (isRpcFailed(listRes)) {
      const err = recordError(listRes);
      throw new Error(`tools/list failed [${err.errorClass}/${err.reason}]`);
    }
    const visibleTools = (listRes.body?.result?.tools ?? []).map((t) => t?.name).filter(Boolean);
    const beginVisible = visibleTools.includes("lucy_begin_question");

    // ── M2: Zero-binding begin + no-begin control path ──────────────────────
    const m2SessionA = await openSession("lucy-mainpath-m2-begin");
    let turnIdA;
    if (beginVisible) {
      const beginRes = await callRpc(m2SessionA.sessionId, "tools/call", {
        name: "lucy_begin_question",
        arguments: { intentSummary: `查询 ${sourceName} 各区域销售额` }
      });
      if (isRpcFailed(beginRes)) {
        const err = recordError(beginRes);
        throw new Error(`M2 lucy_begin_question failed [${err.errorClass}/${err.reason}]: ${redactToken(beginRes.text, token)}`);
      }
      const beginPayload = extractToolPayload(beginRes.body);
      turnIdA = beginRes.body?.result?._meta?.lucy?.turnId ?? beginPayload?.turnId ?? beginPayload?.turn_id;
    }
    const queryA = await callRpc(
      m2SessionA.sessionId,
      "tools/call",
      { name: "lucy_query", arguments: queryArgsFor(sourceName) },
      turnIdA ? { "x-lucy-turn-id": String(turnIdA) } : {}
    );
    latencies.queryMs = queryA.durationMs;
    if (isRpcFailed(queryA)) {
      const err = recordError(queryA);
      throw new Error(`M2 path-A lucy_query failed [${err.errorClass}/${err.reason}]`);
    }
    const rowsA = assertQueryData("M2 path-A lucy_query", queryA, baseline);

    // Path B: fresh session without calling begin
    const m2SessionB = await openSession("lucy-mainpath-m2-nobegin");
    const queryB = await callRpc(m2SessionB.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: queryArgsFor(sourceName)
    });
    if (isRpcFailed(queryB)) {
      const err = recordError(queryB);
      throw new Error(`M2 path-B (no-begin) lucy_query failed [${err.errorClass}/${err.reason}]`);
    }
    const rowsB = assertQueryData("M2 path-B lucy_query", queryB, baseline);
    checks.push({
      id: "M2_zero_binding_begin_and_nobegin",
      status: "pass",
      beginVisible,
      beginExercised: beginVisible,
      rowsWithBegin: rowsA,
      rowsWithoutBegin: rowsB
    });

    // ── M3: Source ambiguity gate & pure-MCP escape ─────────────────────────
    const m3Session = await openSession("lucy-mainpath-m3-ambiguity");
    let turnIdM3;
    if (beginVisible) {
      const beginAmbiguous = await callRpc(m3Session.sessionId, "tools/call", {
        name: "lucy_begin_question",
        arguments: { intentSummary: "统计超市业务订单、退货与区域负责人汇总" }
      });
      if (isRpcFailed(beginAmbiguous)) {
        const err = recordError(beginAmbiguous);
        throw new Error(`M3 ambiguous begin failed [${err.errorClass}/${err.reason}]`);
      }
      const p = extractToolPayload(beginAmbiguous.body);
      turnIdM3 = beginAmbiguous.body?.result?._meta?.lucy?.turnId ?? p?.turnId ?? p?.turn_id;
    }
    const m3First = await callRpc(
      m3Session.sessionId,
      "tools/call",
      { name: "lucy_query", arguments: queryArgsFor(sourceName) },
      turnIdM3 ? { "x-lucy-turn-id": String(turnIdM3) } : {}
    );
    let m3Outcome = "direct_allow";
    if (isRpcFailed(m3First)) {
      const err = recordError(m3First);
      if (err.errorClass !== "ambiguity_gate") {
        throw new Error(`M3 unexpected error [${err.errorClass}/${err.reason}]`);
      }
      const payload = extractToolPayload(m3First.body);
      const usableTargets = payload?.repair?.usableTargets;
      if (!Array.isArray(usableTargets) || usableTargets.length === 0) {
        throw new Error("M3 source_ambiguity_gate deadlock: repair.usableTargets is empty in pure MCP");
      }
      const retryTarget = typeof usableTargets[0] === "string"
        ? usableTargets[0]
        : usableTargets[0]?.sourceName ?? sourceName;
      const m3Retry = await callRpc(
        m3Session.sessionId,
        "tools/call",
        { name: "lucy_query", arguments: queryArgsFor(retryTarget) },
        turnIdM3 ? { "x-lucy-turn-id": String(turnIdM3) } : {}
      );
      if (isRpcFailed(m3Retry)) {
        const retryErr = recordError(m3Retry);
        throw new Error(`M3 pure-MCP retry with ${retryTarget} still failed [${retryErr.errorClass}/${retryErr.reason}]`);
      }
      assertQueryData("M3 pure-MCP escape retry", m3Retry, retryTarget === sourceName ? baseline : null);
      m3Outcome = "escaped_via_usable_target";
    } else {
      assertQueryData("M3 direct allow", m3First, baseline);
    }
    checks.push({
      id: "M3_ambiguity_gate_pure_mcp_escape",
      status: "pass",
      outcome: m3Outcome,
      escapeExercised: m3Outcome === "escaped_via_usable_target"
    });

    // ── M4: First-class error classification & ACL negative check ───────────
    const unauthorizedTool = await callRpc(warmup.sessionId, "tools/call", {
      name: "sql_execution",
      arguments: { sql: "SELECT 1" }
    });
    if (!isRpcFailed(unauthorizedTool)) {
      throw new Error("M4 unauthorized tool sql_execution unexpectedly succeeded");
    }
    const unauthClass = recordError(unauthorizedTool);
    if (isBudgetDenyClass(unauthClass.errorClass)) {
      throw new Error(`M4 unauthorized sql_execution was masked by budget error (${unauthClass.errorClass}), not ACL`);
    }
    if (unauthClass.errorClass !== "acl_deny") {
      throw new Error(`M4 unauthorized sql_execution expected acl_deny, got ${unauthClass.errorClass} (${unauthClass.reason})`);
    }
    if (errorBreakdown.budget_exhausted > 0 || errorBreakdown.budget_unavailable > 0) {
      throw new Error(`M4 legal main-path hit budget error: ${JSON.stringify(errorBreakdown)}`);
    }
    checks.push({
      id: "M4_error_classification_and_acl_negative",
      status: "pass",
      unauthorizedClass: unauthClass.errorClass
    });

    // ── M5: Session teardown & transparent recovery ─────────────────────────
    const deleteStatus = await deleteSession(warmup.sessionId);
    if (deleteStatus < 200 || deleteStatus >= 300) {
      throw new Error(`M5 DELETE /mcp expected 2xx, got HTTP ${deleteStatus}`);
    }
    const recovered = await callRpc(warmup.sessionId, "tools/call", {
      name: "lucy_query",
      arguments: queryArgsFor(sourceName)
    });
    if (isRpcFailed(recovered)) {
      const err = recordError(recovered);
      throw new Error(`M5 post-DELETE recovery failed [${err.errorClass}/${err.reason}]`);
    }
    const recoveredRows = assertQueryData("M5 post-DELETE recovery", recovered, baseline);
    checks.push({ id: "M5_session_delete_recovery", status: "pass", deleteStatus, recoveredRows });

    evidence.verdict = "pass";
    evidence.completedAt = new Date().toISOString();
    if (out) {
      const absolute = path.resolve(out);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    return evidence;
  } catch (error) {
    evidence.verdict = "fail";
    evidence.completedAt = new Date().toISOString();
    evidence.failure = { message: redactToken(error instanceof Error ? error.message : String(error), token) };
    if (out) {
      const absolute = path.resolve(out);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
    throw new Error(evidence.failure.message);
  }
}

export function parseArgs(argv = process.argv) {
  const args = {
    proxyUrl: DEFAULT_PROXY_URL,
    tokenEnv: DEFAULT_TOKEN_ENV,
    connectionId: "demo-mysql",
    sourceName: "superstore_orders",
    baselinePath: null,
    concurrentHandshakes: 10,
    budgets: {
      maxWarmupMs: 2_000,
      maxHandshakeP50Ms: 500,
      maxHandshakeP95Ms: 1_500,
      maxCatalogMs: 1_500
    },
    timeoutMs: 15_000,
    out: null,
    help: false
  };
  const num = (v, opt) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`${opt} must be a positive number`);
    return n;
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    switch (a) {
      case "--proxy-url": args.proxyUrl = argv[++i]; break;
      case "--token-env": args.tokenEnv = argv[++i]; break;
      case "--connection-id": args.connectionId = argv[++i]; break;
      case "--source-name": args.sourceName = argv[++i]; break;
      case "--baseline": args.baselinePath = argv[++i]; break;
      case "--concurrent-handshakes": args.concurrentHandshakes = num(argv[++i], a); break;
      case "--max-warmup-ms": args.budgets.maxWarmupMs = num(argv[++i], a); break;
      case "--max-handshake-p50-ms": args.budgets.maxHandshakeP50Ms = num(argv[++i], a); break;
      case "--max-handshake-p95-ms": args.budgets.maxHandshakeP95Ms = num(argv[++i], a); break;
      case "--max-catalog-ms": args.budgets.maxCatalogMs = num(argv[++i], a); break;
      case "--timeout-ms": args.timeoutMs = num(argv[++i], a); break;
      case "--out": args.out = argv[++i]; break;
      case "--help": case "-h": args.help = true; break;
      default: throw new Error(`Unknown option: ${a}`);
    }
  }
  return args;
}

async function main() {
  let args;
  try {
    args = parseArgs();
  } catch (error) {
    console.error(`[p0-mcp-mainpath] ${error.message}`);
    console.error(USAGE);
    process.exitCode = EXIT_CODES.usage;
    return;
  }
  if (args.help) {
    console.log(USAGE);
    return;
  }
  const token = process.env[args.tokenEnv];
  if (!token) {
    console.error(`[p0-mcp-mainpath] missing token env: ${args.tokenEnv}`);
    process.exitCode = EXIT_CODES.blocked;
    return;
  }
  let baseline = null;
  if (args.baselinePath) {
    baseline = JSON.parse(await readFile(path.resolve(args.baselinePath), "utf8"));
  } else if (args.connectionId === "demo-mysql" && args.sourceName === "superstore_orders") {
    try {
      baseline = JSON.parse(await readFile(path.resolve(DEFAULT_BASELINE_PATH), "utf8"));
    } catch {
      baseline = null;
    }
  }
  try {
    const evidence = await runMcpMainpathSmoke({ ...args, token, baseline });
    console.log(
      `[p0-mcp-mainpath] PASS checks=${evidence.checks.length}`
      + ` handshakeP50=${evidence.latencies.concurrentHandshake.p50Ms}ms`
      + ` catalog=${evidence.latencies.catalogMs}ms`
      + ` query=${evidence.latencies.queryMs}ms`
    );
  } catch (error) {
    console.error(`[p0-mcp-mainpath] FAIL: ${error.message}`);
    process.exitCode = EXIT_CODES.fail;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
