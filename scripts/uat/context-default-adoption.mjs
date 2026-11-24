/**
 * P1-77 默认使用业务上下文：宿主质量、PERF／MIX 测程判定器（阶段 1，纯函数＋假回执校准）。
 * 合同：docs/specs/lucy-20261123-default-business-context-adoption-spec.md SC-01–SC-08
 * 用例：docs/qa/uat/suites/context-content/cases.md「默认使用业务上下文」（R0／01–06／PERF／MIX）
 *
 * 判定器只读回执，不接触 Docker／网络／凭据。阶段 2 的 live 驱动把宿主轨迹、MCP 请求响应、
 * 服务端审计、反代区间写成下面的回执，再交给 judgeAdoption。
 *
 * 回执 `cda-receipts/1`（时间单位均为同一单调时钟毫秒）：
 *   journeys[]  每题一个新进程＋新 MCP session：
 *     id, host, caseId(UAT-CTX-DEFAULT-xx 或 xx), prompt, answer{text}, timing{submitMs,firstCorrectQueryMs,finalAnswerMs}
 *     expected?  覆盖／补充 CASE_SPECS：{deps,optionalDeps,sql,answerIncludes,rules,fingerprints,noContext,deadlineMs,mcpOnly}
 *     calls[]    MCP 回执：id, logicalId?, attempt?, tool, kind?, dependency?, queryKey?, sentMs, clientDoneMs, httpStatus,
 *                rpcError, timedOut, controlledFault|expectedFailure, auditRef, proxyArriveMs/proxyEndMs,
 *                result{bodyKind:"body"|"snippet"|"summary", bodyBytes, bodyFingerprint, sqlValue}
 *   perf.interleaved[] 01／05 交错 A/B 区块：{host,caseId,block,a:[{firstCorrectMs,finalMs,correct}],b:[{...,contextCalls}]}
 *   perf.natural[]     02／03／04：{host,caseId,explicit:[{finalMs,correct}],natural:[{finalMs,correct,firstAttempt}]}
 *   mix.windows[]      {window,hasWrites,sides:{A:side,B:side}}；side={base,extra{journeys},writeEvidence,revocation}
 * 判定优先级：已证实的产品失败（FAIL）优先于缺证（BLOCKED）；PASS 须无任何发现。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  buildFakeRun as buildBaseFakeRun,
  combineVerdict,
  judgeRun as judgeBaseRun,
  nearestRank,
  sameValue
} from "./interactive-read-resilience.mjs";

export const SCHEMA = "cda-receipts/1";
export const HOSTS = Object.freeze(["claude-code", "cursor-agent"]);
export const REQUIRED_CASES = Object.freeze(["01", "02", "02E", "03", "03E", "04", "04E", "05", "06"]);
export const PERF = Object.freeze({ minPairs: 20, minBlocks: 2, callDeadlineMs: 10_000 });
export const MIX_LOAD = Object.freeze({ wiki: 4, skill: 4, combo: 4 });

export const DEPS = Object.freeze({
  wiki: "wiki:effective-order",
  skillBacklog: "skill:backlog-morning-check",
  skillBrief: "skill:fulfilment-morning-brief"
});

/** 用例期望（独立 SQL 值 7／2／3、比值 1.5 见 fixtures）。journey.expected 可覆盖。 */
const BASE_SPECS = {
  "01": { noContext: true, sql: { all: 7 }, answerIncludes: ["7"] },
  "02": {
    deps: [DEPS.wiki], sql: { effective: 2 }, answerIncludes: ["2"],
    rules: [{ id: "caliber-disclosed", includes: ["已签收", "配送"] }]
  },
  "03": {
    deps: [DEPS.skillBacklog], sql: { pending: 3 }, answerIncludes: ["3"],
    rules: [{ id: "threshold-and-escalation", includes: ["3", "履约专员", "复核"] }]
  },
  "04": {
    deps: [DEPS.skillBrief, DEPS.wiki], sql: { pending: 3, effective: 2 }, answerIncludes: ["1.5"],
    rules: [{ id: "priority-review", includes: ["优先复核"] }]
  },
  "05": {
    noContext: true, sql: { effective: 2 }, answerIncludes: ["2"],
    rules: [{ id: "governed-caliber-disclosed", includes: ["口径"] }]
  }
};
export const CASE_SPECS = Object.freeze({
  ...BASE_SPECS,
  "02E": BASE_SPECS["02"], "03E": BASE_SPECS["03"], "04E": BASE_SPECS["04"]
});

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const caseKey = (id) => String(id ?? "").replace(/^UAT-CTX-DEFAULT-/, "");
const isExplicit = (key) => key.endsWith("E");
const add = (code, severity, detail = {}) => ({ code, severity, ...detail });

// ---------- 工具归类 ----------

const SEARCH_KINDS = new Set(["wiki_search", "skill_search"]);
const READ_KINDS = new Set(["wiki_read", "skill_read"]);
const WRITE_RE = /(^|_|\/)(write|create|update|delete|publish|put|save|remove)(_|\/|$)/i;

/** MCP 入口归类：lucy_skill_read／resources/read／prompts/get 等价合并为 skill_read。 */
export function classifyTool(tool) {
  switch (tool) {
    case "wiki_search": return "wiki_search";
    case "wiki_read": return "wiki_read";
    case "lucy_skill_search": return "skill_search";
    case "lucy_skill_read": case "resources/read": case "prompts/get": return "skill_read";
    case "lucy_query": return "query";
    default: return WRITE_RE.test(String(tool)) ? "write" : "other";
  }
}
const kindOf = (c) => c.kind ?? classifyTool(c.tool);
const isContextCall = (c) => SEARCH_KINDS.has(kindOf(c)) || READ_KINDS.has(kindOf(c));
export const callOk = (c) => c.httpStatus === 200 && !c.rpcError && !c.timedOut && !c.aborted;
const callMs = (c) => (finite(c.clientDoneMs) && finite(c.sentMs) ? c.clientDoneMs - c.sentMs : null);

/** 数值按词界匹配，避免「17」命中「7」；文本值直接子串。 */
export function containsValue(text, value) {
  const s = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(s)) return String(text ?? "").includes(s);
  return new RegExp(`(?<![\\d.])${s.replace(".", "\\.")}(?![\\d])`).test(String(text ?? ""));
}

// ---------- 单题判定 ----------

function specFor(j) {
  const key = caseKey(j.caseId);
  return { ...(CASE_SPECS[key] ?? {}), ...(j.expected ?? {}) };
}

function judgeCallEvidence(calls, tag) {
  const out = [];
  const seen = new Set();
  for (const c of calls) {
    if (!c.id) { out.push(add("missing_evidence", "blocked", { ...tag, field: "call.id" })); continue; }
    if (seen.has(c.id)) out.push(add("duplicate_correlation_id", "blocked", { ...tag, callId: c.id }));
    seen.add(c.id);
    if (!c.tool) out.push(add("missing_evidence", "blocked", { ...tag, callId: c.id, field: "tool" }));
    if (!finite(c.sentMs)) out.push(add("missing_evidence", "blocked", { ...tag, callId: c.id, field: "sentMs" }));
    if (!c.timedOut && !c.aborted && !finite(c.clientDoneMs)) out.push(add("missing_evidence", "blocked", { ...tag, callId: c.id, field: "clientDoneMs" }));
    const needsAudit = kindOf(c) === "query" || READ_KINDS.has(kindOf(c));
    if (needsAudit && callOk(c) && !c.auditRef) out.push(add("missing_evidence", "blocked", { ...tag, callId: c.id, field: "auditRef" }));
  }
  return out;
}

/** 首尝失败（含超时后重试成功）、迟到响应；受控故障与预期拒绝不记产品失败。 */
function judgeCallAttempts(calls, tag, deadlineMs) {
  const out = [];
  const chains = new Map();
  for (const c of calls) {
    const key = c.logicalId ?? c.id;
    chains.set(key, [...(chains.get(key) ?? []), c]);
    const ms = callMs(c);
    if (!c.timedOut && ms != null && ms > deadlineMs) out.push(add("late_call", "fail", { ...tag, callId: c.id, durationMs: ms, limitMs: deadlineMs }));
  }
  for (const chain of chains.values()) {
    chain.sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
    const first = chain[0];
    if (first.controlledFault || first.expectedFailure || callOk(first)) continue;
    const retried = chain.slice(1).some(callOk);
    const code = first.timedOut
      ? (retried ? "first_timeout_then_retry_success" : "first_attempt_timeout")
      : (retried ? "first_error_then_retry_success" : "first_attempt_failed");
    out.push(add(code, "fail", { ...tag, callId: first.id, tool: first.tool, retriedToSuccess: retried }));
  }
  return out;
}

function isBodyRead(c) {
  const kind = c.result?.bodyKind ?? (c.result?.bodyFingerprint ? "body" : null);
  return READ_KINDS.has(kindOf(c)) && callOk(c) && kind === "body" && (c.result?.bodyBytes ?? 1) > 0;
}

function judgeContextUse(calls, spec, tag) {
  const out = [];
  const required = spec.deps ?? [];
  const allowed = new Set([...required, ...(spec.optionalDeps ?? [])]);
  const ctx = calls.filter(isContextCall);
  if (spec.noContext && ctx.length) {
    out.push(add("unexpected_context_call", "fail", { ...tag, calls: ctx.map((c) => c.tool) }));
  }
  for (const c of ctx) {
    if (!spec.noContext && !allowed.has(c.dependency)) {
      out.push(add(c.dependency ? "unexpected_context_call" : "missing_evidence", c.dependency ? "fail" : "blocked", { ...tag, callId: c.id, dependency: c.dependency ?? null, field: c.dependency ? undefined : "dependency" }));
    }
  }
  for (const dep of allowed) {
    const searches = ctx.filter((c) => c.dependency === dep && SEARCH_KINDS.has(kindOf(c)));
    const reads = ctx.filter((c) => c.dependency === dep && READ_KINDS.has(kindOf(c)));
    if (searches.length > 1 || reads.length > 1) {
      out.push(add("duplicate_tool_call", "fail", { ...tag, dependency: dep, lookups: searches.length, bodyReads: reads.length }));
    }
  }
  for (const dep of required) {
    const reads = ctx.filter((c) => c.dependency === dep && READ_KINDS.has(kindOf(c)));
    const good = reads.filter(isBodyRead);
    if (!good.length) {
      const snippet = reads.some((c) => ["snippet", "summary"].includes(c.result?.bodyKind))
        || (!reads.length && ctx.some((c) => c.dependency === dep && SEARCH_KINDS.has(kindOf(c))));
      out.push(add(snippet ? "search_snippet_only_as_body_read" : "missing_body_read_receipt", "fail", { ...tag, dependency: dep, readAttempts: reads.length }));
      continue;
    }
    const want = spec.fingerprints?.[dep];
    if (want) {
      const got = good[0].result?.bodyFingerprint;
      if (!got) out.push(add("missing_evidence", "blocked", { ...tag, dependency: dep, field: "bodyFingerprint" }));
      else if (got !== want) out.push(add("body_fingerprint_mismatch", "fail", { ...tag, dependency: dep }));
    }
  }
  return out;
}

function judgeQueries(calls, spec, tag) {
  const out = [];
  const queries = calls.filter((c) => kindOf(c) === "query");
  const perKey = new Map();
  for (const q of queries) if (q.queryKey) perKey.set(q.queryKey, [...(perKey.get(q.queryKey) ?? []), q]);
  for (const [key, list] of perKey) {
    if (list.length > 1) out.push(add("duplicate_tool_call", "fail", { ...tag, queryKey: key, count: list.length }));
  }
  for (const [key, expected] of Object.entries(spec.sql ?? {})) {
    const list = perKey.get(key) ?? [];
    const ok = list.filter(callOk);
    if (!ok.length) { out.push(add("missing_query_receipt", "fail", { ...tag, queryKey: key, attempts: list.length })); continue; }
    const observed = ok[0].result?.sqlValue;
    if (observed == null) out.push(add("missing_evidence", "blocked", { ...tag, queryKey: key, field: "result.sqlValue" }));
    else if (!sameValue(expected, observed)) out.push(add("wrong_sql_value", "fail", { ...tag, queryKey: key, expected, observed }));
  }
  return out;
}

function judgeAnswer(answer, spec, calls, tag) {
  const out = [];
  const text = answer?.text;
  if (typeof text !== "string" || !text.trim()) return [add("missing_evidence", "blocked", { ...tag, field: "answer.text" })];
  for (const v of spec.answerIncludes ?? []) {
    if (!containsValue(text, v)) out.push(add("wrong_answer_value", "fail", { ...tag, missing: v }));
  }
  for (const rule of spec.rules ?? []) {
    const missing = (rule.includes ?? []).filter((s) => !containsValue(text, s));
    const present = (rule.excludes ?? []).filter((s) => String(text).includes(s));
    if (missing.length || present.length) out.push(add("rule_breach", "fail", { ...tag, rule: rule.id, missing, forbidden: present }));
  }
  const writes = calls.filter((c) => kindOf(c) === "write");
  if (writes.length) out.push(add("rule_breach", "fail", { ...tag, rule: "zero-write-calls", calls: writes.map((c) => c.tool) }));
  return out;
}

const FIRST_FAILURE = [
  ["unexpected_context_call", "unexpected_context_call"],
  ["search_snippet_only_as_body_read", "body_read_missing"],
  ["missing_body_read_receipt", "lookup_not_initiated_or_body_read_missing"],
  ["body_fingerprint_mismatch", "body_read_wrong"],
  ["first_attempt_timeout", "call_failed"], ["first_timeout_then_retry_success", "call_failed"],
  ["first_error_then_retry_success", "call_failed"], ["first_attempt_failed", "call_failed"],
  ["wrong_sql_value", "query_wrong"], ["missing_query_receipt", "query_missing"],
  ["wrong_answer_value", "answer_not_adopted"], ["rule_breach", "answer_not_adopted"]
];

/** 单题判定：返回 { findings, firstFailure }。 */
export function judgeJourney(j, plan = {}) {
  const tag = { journeyId: j.id, host: j.host, caseId: caseKey(j.caseId) };
  const spec = specFor(j);
  const calls = Array.isArray(j.calls) ? j.calls : [];
  const findings = [];
  if (!j.id || !j.host || !j.caseId) findings.push(add("missing_evidence", "blocked", { ...tag, field: "id|host|caseId" }));
  if (!CASE_SPECS[caseKey(j.caseId)] && !j.expected) findings.push(add("missing_evidence", "blocked", { ...tag, field: "expected" }));
  if (!Array.isArray(j.calls)) findings.push(add("missing_evidence", "blocked", { ...tag, field: "calls" }));
  if (!j.mcpOnly && !spec.mcpOnly && !j.prompt) findings.push(add("missing_evidence", "blocked", { ...tag, field: "prompt" }));
  findings.push(...judgeCallEvidence(calls, tag));
  findings.push(...judgeCallAttempts(calls, tag, plan.callDeadlineMs ?? PERF.callDeadlineMs));
  findings.push(...judgeContextUse(calls, spec, tag));
  findings.push(...judgeQueries(calls, spec, tag));
  if (!j.mcpOnly && !spec.mcpOnly) {
    findings.push(...judgeAnswer(j.answer, spec, calls, tag));
    if (spec.deadlineMs != null) {
      const wall = finite(j.timing?.finalAnswerMs) && finite(j.timing?.submitMs) ? j.timing.finalAnswerMs - j.timing.submitMs : null;
      if (wall == null) findings.push(add("missing_evidence", "blocked", { ...tag, field: "timing" }));
      else if (wall > spec.deadlineMs) findings.push(add("perf_deadline_exceeded", "fail", { ...tag, wallMs: wall, limitMs: spec.deadlineMs }));
    }
  }
  const firstFailure = FIRST_FAILURE.find(([code]) => findings.some((f) => f.code === code && f.severity === "fail"))?.[1] ?? null;
  return { findings, firstFailure };
}

/** 宿主质量：双宿主 × 必做用例齐全，逐题判定，并记录「需提示才可用」复现。 */
export function judgeHostQuality(journeys = [], plan = {}) {
  const hosts = plan.hosts ?? HOSTS;
  const required = plan.requiredCases ?? REQUIRED_CASES;
  const findings = [];
  const results = [];
  for (const j of journeys) {
    const r = judgeJourney(j, plan);
    findings.push(...r.findings);
    results.push({ host: j.host, caseId: caseKey(j.caseId), id: j.id, failed: r.findings.some((f) => f.severity === "fail"), firstFailure: r.firstFailure });
  }
  for (const host of hosts) {
    for (const key of required) {
      if (!results.some((r) => r.host === host && r.caseId === key)) {
        findings.push(add("missing_evidence", "blocked", { host, caseId: key, field: "journey" }));
      }
    }
  }
  const hintDependence = results
    .filter((r) => r.failed && !isExplicit(r.caseId))
    .filter((r) => results.some((x) => x.host === r.host && x.caseId === `${r.caseId}E` && !x.failed))
    .map((r) => ({ host: r.host, caseId: r.caseId, firstFailure: r.firstFailure }));
  return { findings, stats: { journeys: results.length, results, hintDependence } };
}

// ---------- PERF ----------

const PCTS = [["p50", 0.5], ["p95", 0.95]];
const METRICS = [["firstCorrectMs", "first_correct_query"], ["finalMs", "final_answer"]];

/** 01／05：每宿主×用例至少 2 区块、每区块≥20 对；任一指标 P50／P95 在 ≥2 区块高于 A 即失败，仅 1 区块变慢须追加第三区块。 */
export function judgePerfInterleaved(groups = [], opts = {}) {
  const minPairs = opts.minPairs ?? PERF.minPairs;
  const minBlocks = opts.minBlocks ?? PERF.minBlocks;
  const out = [];
  const byKey = new Map();
  for (const g of groups) {
    const k = `${g.host}|${caseKey(g.caseId)}`;
    byKey.set(k, [...(byKey.get(k) ?? []), g]);
  }
  for (const [k, blocks] of byKey) {
    const [host, key] = k.split("|");
    const tag = { host, caseId: key };
    let comparable = true;
    for (const b of blocks) {
      if (!Array.isArray(b.a) || !Array.isArray(b.b) || b.a.length !== b.b.length || b.a.length < minPairs) {
        out.push(add("perf_insufficient_samples", "blocked", { ...tag, block: b.block, a: b.a?.length ?? 0, b: b.b?.length ?? 0, required: minPairs }));
        comparable = false;
      }
      for (const s of b.b ?? []) {
        if (s.contextCalls > 0) { out.push(add("unexpected_context_call", "fail", { ...tag, block: b.block, side: "B" })); break; }
      }
      for (const side of ["a", "b"]) {
        const bad = (b[side] ?? []).some((s) => s.correct === false || !finite(s.firstCorrectMs) || !finite(s.finalMs));
        if (bad) {
          out.push(add(side === "b" ? "perf_incorrect_sample" : "perf_baseline_incomplete", side === "b" ? "fail" : "blocked", { ...tag, block: b.block }));
          comparable = false;
        }
      }
    }
    if (blocks.length < minBlocks) {
      out.push(add("perf_insufficient_samples", "blocked", { ...tag, blocks: blocks.length, requiredBlocks: minBlocks }));
      continue;
    }
    if (!comparable) continue;
    for (const [field, name] of METRICS) {
      for (const [pname, p] of PCTS) {
        const worse = blocks.filter((b) => nearestRank(b.b.map((s) => s[field]), p) > nearestRank(b.a.map((s) => s[field]), p));
        const detail = { ...tag, metric: name, percentile: pname, worseBlocks: worse.map((b) => b.block) };
        if (worse.length >= 2) out.push(add("perf_over_budget", "fail", detail));
        else if (worse.length === 1 && blocks.length < 3) out.push(add("perf_third_block_required", "blocked", detail));
      }
    }
  }
  return out;
}

/** 02／03／04：B 自然题对 A 显式基线——同分母、逐题正确、P95≤A、首尝不超 A 最大值。 */
export function judgePerfNatural(groups = [], opts = {}) {
  const minN = opts.minPairs ?? PERF.minPairs;
  const out = [];
  for (const g of groups) {
    const tag = { host: g.host, caseId: caseKey(g.caseId) };
    const a = g.explicit ?? [];
    const b = g.natural ?? [];
    if (a.length < minN || a.length !== b.length) {
      out.push(add("perf_insufficient_samples", "blocked", { ...tag, a: a.length, b: b.length, required: minN }));
      continue;
    }
    if (a.some((s) => s.correct !== true || !finite(s.finalMs))) {
      out.push(add("perf_baseline_incomplete", "blocked", tag));
      continue;
    }
    if (b.some((s) => s.firstAttempt !== true)) {
      out.push(add("perf_not_first_attempt", "blocked", tag));
      continue;
    }
    if (b.some((s) => s.correct !== true || !finite(s.finalMs))) {
      out.push(add("perf_incorrect_sample", "fail", tag));
      continue;
    }
    const aMs = a.map((s) => s.finalMs);
    const bMs = b.map((s) => s.finalMs);
    const aP95 = nearestRank(aMs, 0.95);
    const aMax = nearestRank(aMs, 1);
    if (nearestRank(bMs, 0.95) > aP95) out.push(add("perf_over_budget", "fail", { ...tag, metric: "final_answer", percentile: "p95", observedMs: nearestRank(bMs, 0.95), limitMs: aP95 }));
    const over = bMs.filter((v) => v > aMax).length;
    if (over) out.push(add("perf_max_exceeded", "fail", { ...tag, limitMs: aMax, overCount: over }));
  }
  return out;
}

// ---------- MIX ----------

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** 原 50 路查询批次的在途峰值平台：按不同 Agent 计数，返回达到峰值的时间段。 */
export function peakPlateaus(intervals) {
  const events = intervals.flatMap((i) => [[i.start, 0, i.agentId], [i.end, 1, i.agentId]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const sizes = [];
  const live = new Map();
  for (const [t, kind, agent] of events) {
    const next = (live.get(agent) ?? 0) + (kind === 0 ? 1 : -1);
    if (next > 0) live.set(agent, next); else live.delete(agent);
    sizes.push([t, live.size]);
  }
  const peak = Math.max(0, ...sizes.map(([, s]) => s));
  const segments = [];
  for (let i = 0; i < sizes.length - 1; i += 1) {
    if (sizes[i][1] === peak && sizes[i + 1][0] > sizes[i][0]) segments.push({ start: sizes[i][0], end: sizes[i + 1][0] });
  }
  return { peak, segments };
}

function judgeMixSide(win, name, side, baseStep) {
  const tag = { window: win.window, side: name };
  const out = [];
  if (!side || !side.base || !side.extra) return [add("missing_evidence", "blocked", { ...tag, field: "side.base|extra" })];
  const base = judgeBaseRun(side.base);
  for (const f of base.findings) out.push({ ...f, ...tag, scope: "base" });

  const journeys = side.extra.journeys ?? [];
  const counts = Object.fromEntries(Object.keys(MIX_LOAD).map((k) => [k, journeys.filter((j) => j.kind === k).length]));
  const load = win.load ?? MIX_LOAD;
  if (Object.keys(load).some((k) => counts[k] !== load[k]) || journeys.length !== Object.values(load).reduce((s, n) => s + n, 0)) {
    out.push(add("mix_load_composition", "blocked", { ...tag, counts, required: load }));
  }
  for (const j of journeys) {
    if (j.authPrecheck !== true) out.push(add("missing_evidence", "blocked", { ...tag, journeyId: j.id, field: "authPrecheck" }));
    const r = judgeJourney({ ...j, mcpOnly: true, host: j.host ?? "mcp-deterministic", caseId: j.caseId ?? `MIX-${j.kind}` });
    for (const f of r.findings) out.push({ ...f, ...tag, scope: "extra" });
  }

  const baseQ = (side.base.receipts ?? []).filter((r) => r.step === baseStep && finite(r.proxyArriveMs) && finite(r.proxyEndMs));
  const { segments } = peakPlateaus(baseQ.map((r) => ({ agentId: r.agentId, start: r.proxyArriveMs, end: r.proxyEndMs })));
  const ctxCalls = journeys.flatMap((j) => j.calls ?? []).filter(isContextCall);
  if (!segments.length || !ctxCalls.length) {
    out.push(add("missing_mix_overlap_evidence", "blocked", { ...tag, field: segments.length ? "extra context calls" : "base peak plateau" }));
  } else {
    for (const c of ctxCalls) {
      if (!finite(c.proxyArriveMs) || !finite(c.proxyEndMs)) {
        out.push(add("missing_mix_overlap_evidence", "blocked", { ...tag, callId: c.id, field: "proxyArriveMs|proxyEndMs" }));
      } else if (!segments.some((s) => overlaps({ start: c.proxyArriveMs, end: c.proxyEndMs }, s))) {
        out.push(add("missing_mix_overlap_evidence", "blocked", { ...tag, callId: c.id, note: "context call outside base peak in-flight" }));
      }
    }
  }
  if (win.hasWrites) {
    const ev = side.writeEvidence;
    const hit = ev?.roster?.length && ev?.writes?.length && ev.writes.some((w) => ev.roster.some((r) => overlaps(w, r)));
    if (!hit) out.push(add("missing_mix_overlap_evidence", "blocked", { ...tag, field: "writeEvidence.roster×writes" }));
  }
  const rev = side.revocation;
  if (!rev) out.push(add("missing_evidence", "blocked", { ...tag, field: "revocation" }));
  else if (rev.leaked === true || rev.oldSessionDenied !== true || rev.newSessionDenied !== true) {
    out.push(add("revocation_leak", "fail", { ...tag, oldSessionDenied: rev.oldSessionDenied, newSessionDenied: rev.newSessionDenied, leaked: rev.leaked === true }));
  }
  return out;
}

export function judgeMix(mix, plan = {}) {
  const windows = mix?.windows ?? [];
  const findings = [];
  const required = plan.mixWindows ?? 3;
  if (windows.length < required) findings.push(add("missing_evidence", "blocked", { field: "mix.windows", recorded: windows.length, required }));
  for (const w of windows) {
    for (const name of ["A", "B"]) findings.push(...judgeMixSide(w, name, w.sides?.[name], plan.baseStep ?? "lucy_query"));
  }
  return findings;
}

// ---------- 总入口 ----------

const SECRET_VALUE = /\bBearer\s+(?!\[redacted\])\S+/i;

/** { journeys, perf, mix, plan } → { verdict, findings, codes, stats }。无回执一律 BLOCKED。 */
export function judgeAdoption(run) {
  const plan = run?.plan ?? {};
  const scope = plan.scope ?? ["host", "perf", "mix"];
  const findings = [];
  const stats = {};
  if (!run || (!run.journeys && !run.perf && !run.mix)) findings.push(add("missing_evidence", "blocked", { field: "receipts" }));
  if (scope.includes("host")) {
    const host = judgeHostQuality(run?.journeys ?? [], plan);
    findings.push(...host.findings);
    stats.host = host.stats;
  }
  if (scope.includes("perf")) {
    findings.push(...judgePerfInterleaved(run?.perf?.interleaved ?? [], plan), ...judgePerfNatural(run?.perf?.natural ?? [], plan));
    if (!run?.perf) findings.push(add("missing_evidence", "blocked", { field: "perf" }));
  }
  if (scope.includes("mix")) findings.push(...judgeMix(run?.mix, plan));
  if (SECRET_VALUE.test(JSON.stringify(run ?? {}))) findings.push(add("credential_leak", "fail"));
  return {
    schema: SCHEMA,
    verdict: combineVerdict(findings),
    findings,
    codes: [...new Set(findings.map((f) => f.code))].sort(),
    stats
  };
}

// ---------- 确定性假回执（R0 校准／单测） ----------

const FP = { [DEPS.wiki]: "fp-wiki-eff", [DEPS.skillBacklog]: "fp-skill-backlog", [DEPS.skillBrief]: "fp-skill-brief" };
const ANSWERS = {
  "01": "北辰区该周共有 7 笔订单。",
  "02": "有效订单口径为已签收且配送，共 2 笔。",
  "03": "待处理订单 3 笔，达到 3 笔阈值，转履约专员复核。",
  "04": "待处理 3 笔，有效 2 笔，比值 1.5，列入优先复核。",
  "05": "按已治理口径，有效订单为 2 笔。",
  "06": "待处理订单 3 笔；业务 Wiki 读取失败（超时），有效订单口径未能核对，不作猜测。"
};
const QUERY_VALUE = { all: 7, effective: 2, pending: 3 };

function fakeCall(id, tool, extra = {}) {
  return { id, logicalId: id, attempt: 1, tool, sentMs: 1000, clientDoneMs: 1300, httpStatus: 200, ...extra };
}

function depCalls(prefix, dep, t) {
  const wiki = dep.startsWith("wiki:");
  return [
    fakeCall(`${prefix}-s-${dep}`, wiki ? "wiki_search" : "lucy_skill_search", { dependency: dep, sentMs: t, clientDoneMs: t + 200, result: { bodyKind: "snippet" } }),
    fakeCall(`${prefix}-r-${dep}`, wiki ? "wiki_read" : "lucy_skill_read", {
      dependency: dep, sentMs: t + 300, clientDoneMs: t + 600, auditRef: `audit-${prefix}-r-${dep}`,
      result: { bodyKind: "body", bodyBytes: 812, bodyFingerprint: FP[dep] }
    })
  ];
}

export function fakeJourney(host, key, n = 0) {
  const spec = key === "06" ? FAKE_06_SPEC : CASE_SPECS[key];
  const prefix = `${host}-${key}-${n}`;
  const calls = [];
  let t = 1000;
  for (const dep of spec.deps ?? []) { calls.push(...depCalls(prefix, dep, t)); t += 700; }
  for (const [qk, value] of Object.entries(spec.sql ?? {})) {
    calls.push(fakeCall(`${prefix}-q-${qk}`, "lucy_query", { queryKey: qk, sentMs: t, clientDoneMs: t + 400, auditRef: `audit-${prefix}-q-${qk}`, result: { sqlValue: QUERY_VALUE[qk] ?? value } }));
    t += 500;
  }
  if (key === "06") {
    calls.push(fakeCall(`${prefix}-s-w`, "wiki_search", { dependency: DEPS.wiki, sentMs: 1000, clientDoneMs: 1200, result: { bodyKind: "snippet" } }));
    calls.push(fakeCall(`${prefix}-r-w`, "wiki_read", { dependency: DEPS.wiki, sentMs: 1300, clientDoneMs: 11_300, httpStatus: null, timedOut: true, controlledFault: true }));
  }
  const base = key.replace(/E$/, "");
  return {
    id: prefix, host, caseId: `UAT-CTX-DEFAULT-${key}`, prompt: `prompt-${key}`,
    expected: { fingerprints: FP, ...(key === "06" ? FAKE_06_SPEC : {}) },
    answer: { text: ANSWERS[base] },
    timing: { submitMs: 0, firstCorrectQueryMs: t, finalAnswerMs: t + 2000 },
    calls
  };
}

const FAKE_06_SPEC = {
  optionalDeps: [DEPS.wiki], sql: { pending: 3 }, answerIncludes: ["3"], deadlineMs: 120_000,
  rules: [{ id: "no-guess", includes: ["读取失败"], excludes: ["猜测为", "估计为"] }]
};

const fakeSamples = (n, shift = 0) => Array.from({ length: n }, (_, k) => ({
  firstCorrectMs: 4000 + k * 10 + shift, finalMs: 9000 + k * 20 + shift, correct: true, contextCalls: 0
}));

function fakeMixSide() {
  const base = buildBaseFakeRun();
  const kinds = [["wiki", [DEPS.wiki], { effective: 2 }], ["skill", [DEPS.skillBacklog], { pending: 3 }], ["combo", [DEPS.skillBrief, DEPS.wiki], { pending: 3, effective: 2 }]];
  const journeys = [];
  for (const [kind, deps, sql] of kinds) {
    for (let i = 0; i < 4; i += 1) {
      const id = `mix-${kind}-${i}`;
      const calls = [];
      for (const dep of deps) {
        for (const c of depCalls(id, dep, 3100)) {
          const at = 3100 + calls.length * 20;
          calls.push({ ...c, proxyArriveMs: at, proxyEndMs: at + 60 });
        }
      }
      for (const [qk, v] of Object.entries(sql)) {
        calls.push(fakeCall(`${id}-q-${qk}`, "lucy_query", { queryKey: qk, sentMs: 3150, clientDoneMs: 3250, auditRef: `audit-${id}-${qk}`, result: { sqlValue: v } }));
      }
      journeys.push({ id, kind, authPrecheck: true, expected: { deps, sql, fingerprints: FP, mcpOnly: true }, calls });
    }
  }
  return {
    base: { schema: base.schema, plan: base.plan, receipts: base.receipts },
    extra: { journeys },
    writeEvidence: { roster: [{ start: 3000, end: 3500 }], writes: [{ start: 3100, end: 3200 }] },
    revocation: { oldSessionDenied: true, newSessionDenied: true, leaked: false }
  };
}

export function buildFakeRun() {
  const journeys = HOSTS.flatMap((host) => REQUIRED_CASES.map((key) => fakeJourney(host, key)));
  const interleaved = HOSTS.flatMap((host) => ["01", "05"].flatMap((caseId) =>
    ["b1", "b2"].map((block) => ({ host, caseId, block, a: fakeSamples(20), b: fakeSamples(20) }))));
  const natural = HOSTS.flatMap((host) => ["02", "03", "04"].map((caseId) => ({
    host, caseId, explicit: fakeSamples(20, 3000), natural: fakeSamples(20, 2000).map((s) => ({ ...s, firstAttempt: true }))
  })));
  const mixSide = () => JSON.parse(JSON.stringify(fakeMixSide()));
  const windows = ["W1", "W2", "W3"].map((window, i) => ({ window, hasWrites: i === 1, sides: { A: mixSide(), B: mixSide() } }));
  return { schema: SCHEMA, runId: "fake", plan: {}, journeys, perf: { interleaved, natural }, mix: { windows } };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const jr = (run, id) => run.journeys.find((j) => j.id === id);
const callOf = (run, jid, cid) => jr(run, jid).calls.find((c) => c.id === cid);
const J02 = "claude-code-02-0";

/** 已知坏样本：每项给出必须出现的 code 与期望总判定。 */
export const CALIBRATION_CASES = [
  {
    name: "search snippet only as body read", code: "search_snippet_only_as_body_read", verdict: "FAIL",
    mutate: (run) => { jr(run, J02).calls = jr(run, J02).calls.filter((c) => c.tool !== "wiki_read"); return run; }
  },
  {
    name: "read returned snippet", code: "search_snippet_only_as_body_read", verdict: "FAIL",
    mutate: (run) => { callOf(run, J02, `${J02}-r-${DEPS.wiki}`).result = { bodyKind: "snippet", bodyBytes: 80 }; return run; }
  },
  {
    name: "missing body-read receipt", code: "missing_body_read_receipt", verdict: "FAIL",
    mutate: (run) => { jr(run, J02).calls = jr(run, J02).calls.filter((c) => c.dependency !== DEPS.wiki); return run; }
  },
  {
    name: "duplicate body read", code: "duplicate_tool_call", verdict: "FAIL",
    mutate: (run) => { const j = jr(run, J02); j.calls.push({ ...callOf(run, J02, `${J02}-r-${DEPS.wiki}`), id: "dup-read", logicalId: "dup-read" }); return run; }
  },
  {
    name: "wrong sql value", code: "wrong_sql_value", verdict: "FAIL",
    mutate: (run) => { callOf(run, J02, `${J02}-q-effective`).result.sqlValue = 3; return run; }
  },
  { name: "wrong answer value", code: "wrong_answer_value", verdict: "FAIL", mutate: (run) => { jr(run, J02).answer.text = "有效订单口径为已签收且配送，共 3 笔。"; return run; } },
  { name: "rule breach (caliber not disclosed)", code: "rule_breach", verdict: "FAIL", mutate: (run) => { jr(run, "cursor-agent-03-0").answer.text = "待处理订单 3 笔。"; return run; } },
  {
    name: "write call breach", code: "rule_breach", verdict: "FAIL",
    mutate: (run) => { jr(run, "claude-code-06-0").calls.push(fakeCall("w1", "wiki_update", { sentMs: 5000, clientDoneMs: 5100 })); return run; }
  },
  {
    name: "first timeout then retry success", code: "first_timeout_then_retry_success", verdict: "FAIL",
    mutate: (run) => {
      const j = jr(run, J02);
      const c = callOf(run, J02, `${J02}-r-${DEPS.wiki}`);
      const retry = { ...c, id: "retry-read", attempt: 2 };
      Object.assign(c, { httpStatus: null, timedOut: true, result: undefined, auditRef: undefined });
      j.calls.push(retry);
      return run;
    }
  },
  {
    name: "natural question hits context lookup (01)", code: "unexpected_context_call", verdict: "FAIL",
    mutate: (run) => { jr(run, "claude-code-01-0").calls.push(...depCalls("x", DEPS.wiki, 500)); return run; }
  },
  { name: "body fingerprint mismatch", code: "body_fingerprint_mismatch", verdict: "FAIL", mutate: (run) => { callOf(run, J02, `${J02}-r-${DEPS.wiki}`).result.bodyFingerprint = "other"; return run; } },
  { name: "06 over deadline", code: "perf_deadline_exceeded", verdict: "FAIL", mutate: (run) => { jr(run, "claude-code-06-0").timing.finalAnswerMs = 200_000; return run; } },
  { name: "dual-host case missing", code: "missing_evidence", verdict: "BLOCKED", mutate: (run) => { run.journeys = run.journeys.filter((j) => j.id !== "cursor-agent-04E-0"); return run; } },
  {
    name: "PERF 01 over budget in both blocks", code: "perf_over_budget", verdict: "FAIL",
    mutate: (run) => { for (const b of run.perf.interleaved.filter((x) => x.host === "claude-code" && x.caseId === "01")) b.b = fakeSamples(20, 500); return run; }
  },
  {
    name: "PERF 01 slower in one block only", code: "perf_third_block_required", verdict: "BLOCKED",
    mutate: (run) => { run.perf.interleaved.find((x) => x.host === "claude-code" && x.caseId === "01" && x.block === "b1").b = fakeSamples(20, 500); return run; }
  },
  { name: "PERF 01 too few pairs", code: "perf_insufficient_samples", verdict: "BLOCKED", mutate: (run) => { const b = run.perf.interleaved[0]; b.a = b.a.slice(0, 10); b.b = b.b.slice(0, 10); return run; } },
  { name: "PERF 03 natural p95 over explicit", code: "perf_over_budget", verdict: "FAIL", mutate: (run) => { run.perf.natural.find((x) => x.caseId === "03").natural = fakeSamples(20, 4000).map((s) => ({ ...s, firstAttempt: true })); return run; } },
  {
    name: "PERF 04 one natural run above A max", code: "perf_max_exceeded", verdict: "FAIL",
    mutate: (run) => { run.perf.natural.find((x) => x.caseId === "04").natural[19].finalMs = 99_999; return run; }
  },
  { name: "PERF 02 natural wrong answer", code: "perf_incorrect_sample", verdict: "FAIL", mutate: (run) => { run.perf.natural.find((x) => x.caseId === "02").natural[3].correct = false; return run; } },
  {
    name: "MIX context call outside base peak", code: "missing_mix_overlap_evidence", verdict: "BLOCKED",
    mutate: (run) => { for (const c of run.mix.windows[0].sides.B.extra.journeys[0].calls) { c.proxyArriveMs = 9000; c.proxyEndMs = 9100; } return run; }
  },
  { name: "MIX proxy interval missing", code: "missing_mix_overlap_evidence", verdict: "BLOCKED", mutate: (run) => { delete run.mix.windows[0].sides.A.extra.journeys[1].calls[0].proxyArriveMs; return run; } },
  { name: "MIX write window lacks roster×write overlap", code: "missing_mix_overlap_evidence", verdict: "BLOCKED", mutate: (run) => { run.mix.windows[1].sides.B.writeEvidence.writes = [{ start: 9000, end: 9100 }]; return run; } },
  { name: "MIX extra journey wrong first attempt", code: "wrong_sql_value", verdict: "FAIL", mutate: (run) => { run.mix.windows[2].sides.B.extra.journeys[8].calls.find((c) => c.tool === "lucy_query").result.sqlValue = 99; return run; } },
  { name: "MIX base gate regression (A3)", code: "wrong_sql_value", verdict: "FAIL", mutate: (run) => { run.mix.windows[0].sides.B.base.receipts.find((r) => r.id === "S2-9").observed.sqlValue = 999; return run; } },
  { name: "MIX revocation leak", code: "revocation_leak", verdict: "FAIL", mutate: (run) => { run.mix.windows[0].sides.B.revocation.leaked = true; return run; } },
  { name: "MIX load composition 11 not 12", code: "mix_load_composition", verdict: "BLOCKED", mutate: (run) => { run.mix.windows[0].sides.A.extra.journeys.pop(); return run; } },
  { name: "bearer token in receipt", code: "credential_leak", verdict: "FAIL", mutate: (run) => { jr(run, J02).note = "Bearer abcdef123456"; return run; } }
];

export function calibrateJudges(judge = judgeAdoption) {
  const good = judge(buildFakeRun());
  const cases = [{ name: "baseline good run", expectVerdict: "PASS", gotVerdict: good.verdict, ok: good.verdict === "PASS", codes: good.codes }];
  for (const c of CALIBRATION_CASES) {
    const res = judge(c.mutate(clone(buildFakeRun())));
    cases.push({ name: c.name, expectVerdict: c.verdict, gotVerdict: res.verdict, expectCode: c.code, ok: res.verdict === c.verdict && res.codes.includes(c.code), codes: res.codes });
  }
  return { ok: cases.every((c) => c.ok), cases };
}

// ---------- CLI ----------

function main(argv) {
  const [cmd, file] = argv;
  if (cmd === "calibrate") {
    const res = calibrateJudges();
    console.log(JSON.stringify(res, null, 2));
    return res.ok ? 0 : 1;
  }
  if (cmd === "judge" && file) {
    const res = judgeAdoption(JSON.parse(readFileSync(file, "utf8")));
    console.log(JSON.stringify(res, null, 2));
    return { PASS: 0, FAIL: 1, BLOCKED: 2 }[res.verdict];
  }
  console.error("usage: context-default-adoption.mjs calibrate | judge <receipts.json>");
  return 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
