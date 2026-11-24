/**
 * P1-75 隔离测程脚手架（阶段 1）：确定性回执采集 + 纯函数判定器。
 * 合同：docs/specs/lucy-20261123-interactive-read-resilience-spec.md SC-01–07
 * 用例：docs/qa/uat/suites/interactive-read-resilience/（R0／01–07）
 *
 * 判定器只读回执，不接触 Docker／网络／凭据。阶段 2 的 live 驱动负责把浏览器／反代／MCP／
 * 写屏障／探针的观测写成下面的回执，再交给 judgeRun。
 *
 * 回执 `irr-receipts/1`（单位均为同一单调时钟的毫秒）：
 *   id            本次请求唯一关联键（重用 RPC id 或重试时仍一对一）
 *   logicalId     同一逻辑请求的各次尝试共享（缺省＝id）；attempt 从 1 起
 *   step          initialize | notifications/initialized | tools/list | lucy_catalog | lucy_query
 *                 | roster_summary | livez | readyz | ...
 *   agentId/role/connection  发起方；syncPoint 为同步点编号（S1／S2…），非同步点请求为 null
 *   plannedMs/sentMs/clientDoneMs   计划、发出、客户端收到并解析完整响应
 *   proxyArriveMs/proxyEndMs        反代收到请求／响应结束或断开（在途判定唯一依据）
 *   httpStatus, rpcError, timedOut, aborted, controlledFault（具名注入故障，首尝失败不记产品失败）
 *   expected      { allow: boolean, sqlValue?: scalar }  独立 SQL 核对值与预期权限
 *   observed      { allowed?: boolean, leaked?: boolean, sqlValue?: scalar }
 *   auditRef      Lucy 审计行关联键（lucy_query／lucy_catalog 必填）
 * 判定优先级：已证实的产品错误（FAIL）优先于缺证（BLOCKED）；PASS 须无任何发现。
 */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const SCHEMA = "irr-receipts/1";

/** 客户端硬截止（Spec 判定与报告）：initialize／query 10 s，通知／tools/list／catalog 5 s。 */
export const DEFAULT_DEADLINES_MS = Object.freeze({
  initialize: 10_000,
  "notifications/initialized": 5_000,
  "tools/list": 5_000,
  lucy_catalog: 5_000,
  lucy_query: 10_000
});
export const DEFAULT_PLAN = Object.freeze({
  agents: 50,
  minInFlight: 50,
  maxSyncSpreadMs: 50,
  requireAuditSteps: ["lucy_query", "lucy_catalog"]
});

const NOTIFICATION_STEPS = new Set(["notifications/initialized"]);
const SECRET_KEY = /^(token|authorization|cookie|set-cookie|mcp-session-id|session-id|sessionid|password|secret)$/i;
const SECRET_VALUE = /\bBearer\s+\S+/i;

/** 最近秩分位：sorted[ceil(p × N) - 1]，p ∈ (0,1]。 */
export function nearestRank(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

export function summarize(samples) {
  return {
    n: samples.length,
    p50: nearestRank(samples, 0.5),
    p95: nearestRank(samples, 0.95),
    p99: nearestRank(samples, 0.99),
    max: nearestRank(samples, 1)
  };
}

const finite = (v) => typeof v === "number" && Number.isFinite(v);
const attemptOf = (r) => (finite(r.attempt) ? r.attempt : 1);
const durationMs = (r) => (finite(r.clientDoneMs) && finite(r.sentMs) ? r.clientDoneMs - r.sentMs : null);

export function isSuccessStatus(r) {
  return NOTIFICATION_STEPS.has(r.step) ? [200, 202, 204].includes(r.httpStatus) : r.httpStatus === 200;
}

/** 预期权限判定所用的实际结果：优先 observed.allowed，缺省按 HTTP／RPC 结果推导。 */
export function deriveAllowed(r) {
  if (typeof r.observed?.allowed === "boolean") return r.observed.allowed;
  if (!finite(r.httpStatus)) return null;
  return isSuccessStatus(r) && !r.rpcError;
}

const finding = (code, severity, r, detail = {}) => ({
  code,
  severity,
  ...(r ? { id: r.id, step: r.step, agentId: r.agentId } : {}),
  ...detail
});

// ---------- 凭据 ----------

export function redactReceipt(value) {
  if (Array.isArray(value)) return value.map(redactReceipt);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redactReceipt(v)])
    );
  }
  return typeof value === "string" ? value.replace(SECRET_VALUE, "Bearer [redacted]") : value;
}

function findSecrets(value, path = "$", out = []) {
  if (Array.isArray(value)) value.forEach((v, i) => findSecrets(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k) && v !== "[redacted]" && v != null) out.push(`${path}.${k}`);
      else findSecrets(v, `${path}.${k}`, out);
    }
  } else if (typeof value === "string" && SECRET_VALUE.test(value)) out.push(path);
  return out;
}

// ---------- 判定器（均为纯函数，返回 findings 数组） ----------

/** 迟到 200、超时：200 但超过步骤截止＝迟到；timedOut 独立判失败。 */
export function judgeDeadlines(receipts, deadlines = DEFAULT_DEADLINES_MS) {
  const out = [];
  for (const r of receipts) {
    const limit = deadlines[r.step];
    if (r.timedOut) {
      out.push(finding("timeout", "fail", r, { limitMs: limit ?? null }));
      continue;
    }
    const ms = durationMs(r);
    if (limit != null && ms != null && ms > limit) {
      out.push(finding(r.httpStatus === 200 ? "late_200" : "late_response", "fail", r, { durationMs: ms, limitMs: limit }));
    }
  }
  return out;
}

/** 首尝必须成功：任何首个 503（含后续重试成功）记失败，重试成功不抵销。 */
export function judgeFirstAttempts(receipts) {
  const chains = new Map();
  for (const r of receipts) {
    const key = r.logicalId ?? r.id;
    chains.set(key, [...(chains.get(key) ?? []), r]);
  }
  const out = [];
  for (const chain of chains.values()) {
    chain.sort((a, b) => attemptOf(a) - attemptOf(b));
    const first = chain[0];
    if (first.controlledFault || first.expected?.allow === false || first.timedOut || !finite(first.httpStatus)) continue;
    if (isSuccessStatus(first)) continue;
    const retried = chain.slice(1).some((r) => isSuccessStatus(r) && !r.timedOut);
    const code = first.httpStatus === 503 && retried ? "initial_503_retry_success" : first.httpStatus === 503 ? "first_attempt_503" : "first_attempt_failed";
    out.push(finding(code, "fail", first, { httpStatus: first.httpStatus, retriedToSuccess: retried, attempts: chain.length }));
  }
  return out;
}

/** 非预期权限结果：预期放行却被拒、预期拒绝却放行或泄露。 */
export function judgePermissions(receipts) {
  const out = [];
  for (const r of receipts) {
    if (typeof r.expected?.allow !== "boolean" || r.timedOut) continue;
    const allowed = deriveAllowed(r);
    if (allowed == null) {
      out.push(finding("missing_evidence", "blocked", r, { field: "observed.allowed|httpStatus" }));
    } else if (allowed !== r.expected.allow || (r.expected.allow === false && r.observed?.leaked === true)) {
      out.push(finding("unexpected_permission_result", "fail", r, {
        expectedAllow: r.expected.allow, observedAllowed: allowed, leaked: r.observed?.leaked === true
      }));
    }
  }
  return out;
}

export function sameValue(expected, observed, tolerance = 0) {
  const e = typeof expected === "string" && expected.trim() !== "" ? Number(expected) : expected;
  const o = typeof observed === "string" && observed.trim() !== "" ? Number(observed) : observed;
  if (finite(e) && finite(o)) return Math.abs(e - o) <= tolerance;
  return String(expected).trim() === String(observed).trim();
}

/** 错误 SQL 值：与独立核对值不一致；成功响应却无值＝无法核对（缺证）。 */
export function judgeSqlValues(receipts, tolerance = 0) {
  const out = [];
  for (const r of receipts) {
    if (r.expected?.allow === false || r.expected?.sqlValue === undefined || r.timedOut) continue;
    const observed = r.observed?.sqlValue;
    if (observed === undefined || observed === null) {
      out.push(isSuccessStatus(r)
        ? finding("missing_evidence", "blocked", r, { field: "observed.sqlValue" })
        : finding("missing_sql_value", "fail", r, { httpStatus: r.httpStatus ?? null }));
    } else if (!sameValue(r.expected.sqlValue, observed, tolerance)) {
      out.push(finding("wrong_sql_value", "fail", r, { expected: r.expected.sqlValue, observed }));
    }
  }
  return out;
}

/** 不同 Agent 首尝在途峰值：按反代 [到达, 结束] 区间扫描，同刻先开始后结束。 */
export function peakInFlight(intervals) {
  const events = intervals.flatMap((i) => [[i.start, 0, i.agentId], [i.end, 1, i.agentId]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const live = new Map();
  let peak = 0;
  for (const [, kind, agent] of events) {
    const next = (live.get(agent) ?? 0) + (kind === 0 ? 1 : -1);
    if (next > 0) live.set(agent, next); else live.delete(agent);
    peak = Math.max(peak, live.size);
  }
  return peak;
}

/** 每个同步点：到齐 plan.agents 个首尝、发出跨度、反代在途峰值 ≥ minInFlight。 */
export function judgeSyncPoints(receipts, plan = DEFAULT_PLAN) {
  const out = [];
  const stats = {};
  const declared = plan.syncPoints ?? [...new Set(receipts.filter((r) => r.syncPoint).map((r) => r.syncPoint))];
  for (const sp of declared) {
    const firsts = receipts.filter((r) => r.syncPoint === sp && attemptOf(r) === 1);
    const agents = new Set(firsts.map((r) => r.agentId));
    const group = { syncPoint: sp };
    if (agents.size < plan.agents || firsts.length < plan.agents) {
      out.push({ ...finding("missing_evidence", "blocked", null, { field: "receipts" }), ...group, planned: plan.agents, recorded: firsts.length });
    }
    const timed = firsts.filter((r) => finite(r.proxyArriveMs) && finite(r.proxyEndMs));
    if (timed.length < firsts.length) {
      out.push({ ...finding("missing_evidence", "blocked", null, { field: "proxyArriveMs|proxyEndMs" }), ...group, missing: firsts.length - timed.length });
    }
    const sent = firsts.map((r) => r.sentMs).filter(finite);
    const spread = sent.length ? Math.max(...sent) - Math.min(...sent) : null;
    const peak = peakInFlight(timed.map((r) => ({ agentId: r.agentId, start: r.proxyArriveMs, end: r.proxyEndMs })));
    stats[sp] = { firstAttempts: firsts.length, distinctAgents: agents.size, sendSpreadMs: spread, peakInFlight: peak };
    if (spread != null && spread > plan.maxSyncSpreadMs) {
      out.push({ ...finding("sync_spread_exceeded", "blocked", null, { spreadMs: spread, limitMs: plan.maxSyncSpreadMs }), ...group });
    }
    if (timed.length === firsts.length && firsts.length > 0 && peak < plan.minInFlight) {
      out.push({ ...finding("in_flight_below_target", "blocked", null, { peak, required: plan.minInFlight }), ...group });
    }
  }
  return { findings: out, stats };
}

/** 证据完整性：关联键唯一、字段齐全、审计关联、凭据脱敏。 */
export function judgeEvidence(receipts, plan = DEFAULT_PLAN) {
  const out = [];
  const seen = new Set();
  const auditSteps = new Set(plan.requireAuditSteps ?? DEFAULT_PLAN.requireAuditSteps);
  for (const r of receipts) {
    if (!r.id) { out.push(finding("missing_evidence", "blocked", r, { field: "id" })); continue; }
    if (seen.has(r.id)) out.push(finding("duplicate_correlation_id", "blocked", r));
    seen.add(r.id);
    for (const field of ["step", "agentId", "sentMs"]) {
      if (r[field] == null) out.push(finding("missing_evidence", "blocked", r, { field }));
    }
    if (!finite(r.clientDoneMs) && !r.timedOut && !r.aborted) out.push(finding("missing_evidence", "blocked", r, { field: "clientDoneMs", note: "still in flight or unrecorded" }));
    if (!finite(r.httpStatus) && !r.timedOut && !r.aborted) out.push(finding("missing_evidence", "blocked", r, { field: "httpStatus" }));
    if (auditSteps.has(r.step) && !r.auditRef) out.push(finding("missing_evidence", "blocked", r, { field: "auditRef" }));
    if (!r.timedOut && !r.aborted && r.expected == null && auditSteps.has(r.step)) out.push(finding("missing_evidence", "blocked", r, { field: "expected" }));
  }
  const secrets = findSecrets(receipts);
  if (secrets.length) out.push({ code: "credential_leak", severity: "fail", paths: secrets.slice(0, 10) });
  return out;
}

/** 可选延迟预算：plan.budgets = [{ name, steps:[...], p50?, p95?, p99?, maxMs? }]，只统计成功响应样本，失败另由其他判定器保留。 */
export function judgeBudgets(receipts, budgets = []) {
  const out = [];
  const stats = {};
  for (const b of budgets) {
    const samples = receipts.filter((r) => b.steps.includes(r.step) && !r.timedOut).map(durationMs).filter((v) => v != null);
    const s = summarize(samples);
    stats[b.name] = s;
    for (const [key, field] of [["p50", "p50"], ["p95", "p95"], ["p99", "p99"], ["maxMs", "max"]]) {
      if (b[key] != null && s[field] != null && s[field] > b[key]) {
        out.push({ code: "latency_budget_exceeded", severity: "fail", budget: b.name, metric: field, observedMs: s[field], limitMs: b[key] });
      }
    }
    if (!samples.length) out.push({ code: "missing_evidence", severity: "blocked", budget: b.name, field: "samples" });
  }
  return { findings: out, stats };
}

export function combineVerdict(findings) {
  if (findings.some((f) => f.severity === "fail")) return "FAIL";
  if (findings.some((f) => f.severity === "blocked")) return "BLOCKED";
  return "PASS";
}

/** 总入口：{ receipts, plan? } → { verdict, findings, stats }。无回执一律 BLOCKED。 */
export function judgeRun(run) {
  const receipts = run?.receipts ?? [];
  const plan = { ...DEFAULT_PLAN, ...(run?.plan ?? {}) };
  const deadlines = { ...DEFAULT_DEADLINES_MS, ...(plan.deadlinesMs ?? {}) };
  const sync = judgeSyncPoints(receipts, plan);
  const budgets = judgeBudgets(receipts, plan.budgets ?? []);
  const findings = [
    ...(receipts.length ? [] : [{ code: "missing_evidence", severity: "blocked", field: "receipts" }]),
    ...judgeEvidence(receipts, plan),
    ...judgeDeadlines(receipts, deadlines),
    ...judgeFirstAttempts(receipts),
    ...judgePermissions(receipts),
    ...judgeSqlValues(receipts, plan.sqlTolerance ?? 0),
    ...sync.findings,
    ...budgets.findings
  ];
  const byStep = {};
  for (const step of new Set(receipts.map((r) => r.step))) {
    byStep[step] = summarize(receipts.filter((r) => r.step === step && !r.timedOut).map(durationMs).filter((v) => v != null));
  }
  return {
    schema: SCHEMA,
    verdict: combineVerdict(findings),
    findings,
    codes: [...new Set(findings.map((f) => f.code))].sort(),
    stats: { receipts: receipts.length, byStep, syncPoints: sync.stats, budgets: budgets.stats }
  };
}

// ---------- 确定性采集 ----------

/**
 * 回执记录器。now 可注入（测试用假时钟）。begin→sent()→finish()；
 * 超时按截止记入（clientDoneMs = sentMs + 步骤截止）。
 */
export function createRecorder({ now = () => performance.now(), runId = "run", window = null, deadlines = DEFAULT_DEADLINES_MS } = {}) {
  const receipts = [];
  let seq = 0;
  return {
    receipts,
    begin(meta) {
      const receipt = { attempt: 1, syncPoint: null, ...meta, id: meta.id ?? `${runId}-${++seq}` };
      const handle = {
        receipt,
        sent() {
          receipt.sentMs = now();
          return receipt;
        },
        finish(result = {}) {
          if (!finite(receipt.sentMs)) receipt.sentMs = now();
          Object.assign(receipt, result);
          receipt.clientDoneMs = result.timedOut && deadlines[receipt.step] != null ? receipt.sentMs + deadlines[receipt.step] : now();
          receipts.push(receipt);
          return receipt;
        }
      };
      return handle;
    },
    toRun(plan = {}) {
      return { schema: SCHEMA, runId, window, plan, receipts: redactReceipt(receipts) };
    }
  };
}

/**
 * 同步点：先为全部 Agent 建回执（plannedMs 相同），再在同一同步段内逐个标记发出并调用 send。
 * send(agent, receipt) → { httpStatus, rpcError?, observed?, auditRef?, proxyArriveMs?, proxyEndMs?, ... }。
 * send 抛错记为 aborted，不吞掉：错误文本进回执。
 */
export async function fireSyncPoint({ recorder, syncPoint, step, agents, send, now = () => performance.now() }) {
  const plannedMs = now();
  const handles = agents.map((a) => recorder.begin({
    step, syncPoint, plannedMs, agentId: a.agentId, role: a.role, connection: a.connection, expected: a.expected
  }));
  return Promise.all(handles.map((h, i) => {
    h.sent();
    return Promise.resolve()
      .then(() => send(agents[i], h.receipt))
      .then((res) => h.finish(res), (err) => h.finish({ aborted: true, error: String(err?.message ?? err).slice(0, 200) }));
  }));
}

// ---------- R0 校准：判定器必须能判已知坏样本为失败 ----------

/** 确定性假回执：50 Agent × 两个同步点（握手／查询）＋一条预期拒绝的对照。 */
export function buildFakeRun({ agents = 50 } = {}) {
  const receipts = [];
  for (let i = 0; i < agents; i += 1) {
    const agentId = `agent-${i}`;
    const role = i < 2 ? "lucy_admin" : i % 2 ? "restricted_a" : "restricted_b";
    const s1 = 1000 + i;
    receipts.push({
      id: `S1-${i}`, logicalId: `S1-${i}`, attempt: 1, step: "initialize", syncPoint: "S1", agentId, role,
      plannedMs: 990, sentMs: s1, proxyArriveMs: s1 + 5, proxyEndMs: s1 + 300, clientDoneMs: s1 + 320, httpStatus: 200
    });
    const s2 = 3000 + i;
    const value = 1000 + (i % 3);
    receipts.push({
      id: `S2-${i}`, logicalId: `S2-${i}`, attempt: 1, step: "lucy_query", syncPoint: "S2", agentId, role, connection: `conn-${i % 3}`,
      plannedMs: 2990, sentMs: s2, proxyArriveMs: s2 + 5, proxyEndMs: s2 + 400, clientDoneMs: s2 + 420, httpStatus: 200,
      auditRef: `audit-${i}`, expected: { allow: true, sqlValue: value }, observed: { allowed: true, sqlValue: value }
    });
  }
  receipts.push({
    id: "deny-0", logicalId: "deny-0", attempt: 1, step: "lucy_query", syncPoint: null, agentId: "agent-1", role: "restricted_a",
    sentMs: 6000, clientDoneMs: 6100, httpStatus: 403, auditRef: "audit-deny-0",
    expected: { allow: false }, observed: { allowed: false, leaked: false }
  });
  return { schema: SCHEMA, runId: "fake", plan: { agents, syncPoints: ["S1", "S2"] }, receipts };
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const patch = (run, id, fn) => { const r = run.receipts.find((x) => x.id === id); fn(r); return run; };

/** 已知坏样本：每项给出必须出现的 code 与期望总判定。 */
export const CALIBRATION_CASES = [
  { name: "late 200", code: "late_200", verdict: "FAIL", mutate: (run) => patch(run, "S1-3", (r) => { r.clientDoneMs = r.sentMs + 10_500; }) },
  { name: "known timeout", code: "timeout", verdict: "FAIL", mutate: (run) => patch(run, "S2-4", (r) => { r.timedOut = true; r.httpStatus = null; r.clientDoneMs = r.sentMs + 10_000; }) },
  {
    name: "initial 503 then retry success", code: "initial_503_retry_success", verdict: "FAIL",
    mutate: (run) => {
      patch(run, "S2-5", (r) => { r.httpStatus = 503; r.observed = {}; });
      run.receipts.push({
        id: "S2-5-r2", logicalId: "S2-5", attempt: 2, step: "lucy_query", syncPoint: null, agentId: "agent-5", role: "restricted_b",
        sentMs: 3600, clientDoneMs: 3800, httpStatus: 200, auditRef: "audit-5-r2",
        expected: { allow: true, sqlValue: 1002 }, observed: { allowed: true, sqlValue: 1002 }
      });
      return run;
    }
  },
  { name: "denied target allowed and leaked", code: "unexpected_permission_result", verdict: "FAIL", mutate: (run) => patch(run, "deny-0", (r) => { r.httpStatus = 200; r.observed = { allowed: true, leaked: true }; }) },
  { name: "allowed query rejected", code: "unexpected_permission_result", verdict: "FAIL", mutate: (run) => patch(run, "S2-7", (r) => { r.httpStatus = 403; r.observed = { allowed: false }; }) },
  { name: "wrong sql value", code: "wrong_sql_value", verdict: "FAIL", mutate: (run) => patch(run, "S2-9", (r) => { r.observed.sqlValue = 999; }) },
  {
    name: "never reaches 50 in flight", code: "in_flight_below_target", verdict: "BLOCKED",
    mutate: (run) => { for (const r of run.receipts.filter((x) => x.syncPoint === "S2")) r.proxyEndMs = r.proxyArriveMs + 10; return run; }
  },
  { name: "sync spread above 50 ms", code: "sync_spread_exceeded", verdict: "BLOCKED", mutate: (run) => patch(run, "S1-10", (r) => { r.sentMs += 200; r.proxyArriveMs += 200; r.proxyEndMs += 200; r.clientDoneMs += 200; }) },
  { name: "missing proxy receipt", code: "missing_evidence", verdict: "BLOCKED", mutate: (run) => patch(run, "S1-11", (r) => { delete r.proxyEndMs; }) },
  { name: "missing audit link", code: "missing_evidence", verdict: "BLOCKED", mutate: (run) => patch(run, "S2-12", (r) => { delete r.auditRef; }) },
  { name: "dropped receipt", code: "missing_evidence", verdict: "BLOCKED", mutate: (run) => { run.receipts = run.receipts.filter((r) => r.id !== "S2-13"); return run; } },
  { name: "unfinished request", code: "missing_evidence", verdict: "BLOCKED", mutate: (run) => patch(run, "S1-14", (r) => { delete r.clientDoneMs; }) },
  { name: "bearer token in receipt", code: "credential_leak", verdict: "FAIL", mutate: (run) => patch(run, "S1-15", (r) => { r.note = "Bearer abcdef123456"; }) }
];

/** 先确认好样本 PASS，再逐个坏样本判定；任一不符即校准失败（R0 要求测程能判失败）。 */
export function calibrateJudges(judge = judgeRun) {
  const good = judge(buildFakeRun());
  const cases = [{ name: "baseline good run", expectVerdict: "PASS", gotVerdict: good.verdict, ok: good.verdict === "PASS", codes: good.codes }];
  for (const c of CALIBRATION_CASES) {
    const res = judge(c.mutate(clone(buildFakeRun())) ?? {});
    cases.push({
      name: c.name, expectVerdict: c.verdict, gotVerdict: res.verdict, expectCode: c.code,
      ok: res.verdict === c.verdict && res.codes.includes(c.code), codes: res.codes
    });
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
    const res = judgeRun(JSON.parse(readFileSync(file, "utf8")));
    console.log(JSON.stringify(res, null, 2));
    return { PASS: 0, FAIL: 1, BLOCKED: 2 }[res.verdict];
  }
  console.error("usage: interactive-read-resilience.mjs calibrate | judge <receipts.json>");
  return 64;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
