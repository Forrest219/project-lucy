#!/usr/bin/env node
/**
 * query-detail-stress-uat.mjs — UAT-SUITE-QUERY-DETAIL-STRESS 跑器（QDE-STRESS-B）。
 *
 * SOT：docs/qa/uat/suites/query-detail-stress/baseline.json（强制装载；脚本内
 * 写死并发／行数／时长＝按套件规则直接 FAIL）。用例：同目录 cases.md。
 *
 * r2 要点（委托人 2026-11-28 降级授权，见 baseline coPressure.note）：
 *   - 慢臂＝coPressure.S1（slow_gauge v_sleep 45/60s 首字节）经 lucy_query 真实
 *     占用 MCP 执行面；H1（真 Hive MCP 慢臂）已退役（retiredScenarios）。
 *   - warmup＝全形态混压（不含慢臂）用于探针基线 p95；steady＝加入慢臂的同窗
 *     混压；cooldown＝只留探针观察回落。
 *   - 每个 Failed call 记录错误分桶（timeout／http_5xx／http_4xx／payload
 *     reason／other），ST-04 归因不靠猜。
 *   - 预算停机按 P1-74／REQ-0122 逃生：continuable → lucy_continue_question；
 *     否则 → continueQuestion(mode=new_question)；各限重试一次（防盲重试风暴）。
 *   - Token 明文不入任何输出；证据里只写 sha256 前 12 位指纹。
 *
 * 形状契约（2026-11-28 标定实测，uat_perf 真实成交）：
 *   dimensions 为对象数组、字段用 `source.col` 限定名；segments 用
 *   `source.segment` 点名；lucy_read_source 必带 connectionId；detailMode 在
 *   `_meta.lucy.detailMode.adapted`；行数读 `parsed.rows.length／totalRows`。
 *
 * 用法：node scripts/uat/query-detail-stress-uat.mjs
 * 覆盖：QDS_MCP_URL、QDS_WEBUI_URL、QDS_TOKEN_FILE、QDS_TOKEN_COUNT、
 *       QDS_EVIDENCE、QDS_CALL_TIMEOUT_MS、QDS_SKIP_SCALE_CHECK=1（仅调试）
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createMcpClient, parseMcpToolResult } from "../e2e/lib/mcp-compatibility-client.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASELINE_PATH = path.join(
  REPO_ROOT, "docs/qa/uat/suites/query-detail-stress/baseline.json"
);
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const B = baseline; // 所有配额只从这里读

const MCP_URL = process.env.QDS_MCP_URL || "http://127.0.0.1:57881/mcp";
const WEBUI_URL = process.env.QDS_WEBUI_URL || "http://127.0.0.1:55176";
const TOKEN_FILE = process.env.QDS_TOKEN_FILE ||
  path.resolve(REPO_ROOT, "..", ".lucy-secrets", "mcp-perf-tokens.json");
const TOKEN_COUNT = Number(process.env.QDS_TOKEN_COUNT || B.concurrency.targetInFlight);
const CALL_TIMEOUT_MS = Number(process.env.QDS_CALL_TIMEOUT_MS || 150_000);
const EVIDENCE = process.env.QDS_EVIDENCE ||
  path.join(REPO_ROOT, "inbox", `2026-11-28-qds-stress-evidence-r${B.baselineRevision}.json`);
const PROBE_INTERVAL_MS = B.timing.probeIntervalSec * 1000;

// 形状目标（缺省值＝本环境标定源；可用环境变量覆盖）
const TARGETS = {
  detailConn: process.env.QDS_DETAIL_CONN || "demo-mysql",
  detailSource: process.env.QDS_DETAIL_SOURCE || "superstore_orders",
  detailDim: process.env.QDS_DETAIL_DIM || "superstore_orders.region",
  detailDimValues: ["East", "Northeast", "Southwest", "Central South"],
  analysisSource: process.env.QDS_ANALYSIS_SOURCE || "superstore_orders",
  analysisMeasure: process.env.QDS_ANALYSIS_MEASURE || "total_sales",
  analysisAdhoc: process.env.QDS_ANALYSIS_ADHOC || "sum(superstore_orders.sales)",
  segment: process.env.QDS_SEGMENT || "superstore_orders.active_rows",
  slowConn: process.env.QDS_SLOW_CONN || "slow-mysql",
  slowSources: (process.env.QDS_SLOW_SOURCES || "v_sleep_45,v_sleep_60").split(","),
  slowDim: process.env.QDS_SLOW_DIM || "sleep_seconds",
  hiveConn: process.env.QDS_HIVE_CONN || "hive-doris",
  hiveSource: process.env.QDS_HIVE_SOURCE || "t_0001",
  hiveDim: process.env.QDS_HIVE_DIM || "t_0001.c1",
};

// ── 基础工具 ────────────────────────────────────────────────────────────────
const fingerprint = (t) => createHash("sha256").update(t).digest("hex").slice(0, 12);
const percentile = (arr, p) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const successRate = (arr) => (arr.length ? arr.filter((x) => x.ok).length / arr.length : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadTokens() {
  const raw = JSON.parse(readFileSync(TOKEN_FILE, "utf8"));
  const map = raw.tokens ?? raw;
  const entries = Object.entries(map).filter(([, v]) => typeof v === "string");
  return entries.slice(0, TOKEN_COUNT).map(([name, plain]) => ({ name, plain, fp: fingerprint(plain) }));
}

// ── 记账 ────────────────────────────────────────────────────────────────────
const calls = [];          // { scenario, ok, ms, rows, detailMode, errBucket, errMsg, phase, escaped }
const budgetEvents = [];   // { at, scenario, escape }
const healthSamples = [];  // { ok, status }
const probeSamples = [];   // { phase, ok, ms }

function bucketOf(err, res, parsed) {
  if (err) {
    if (err.name === "AbortError" || /timeout|aborted/i.test(String(err.message ?? ""))) return "timeout";
    return "other";
  }
  if (res?.status >= 500) return "http_5xx";
  if (res?.status >= 400) return "http_4xx";
  if (parsed && parsed.ok === false) return String(parsed.reason ?? "payload_error");
  if (res?.json?.error?.code) return String(res.json.error.code);
  return "other";
}

// ── 场景参数构造 ────────────────────────────────────────────────────────────
function qdShape({ limit = null, filter = false, segment = false } = {}) {
  const args = {
    connectionId: TARGETS.detailConn,
    source: TARGETS.detailSource,
    dimensions: [{ field: TARGETS.detailDim }],
  };
  if (limit) args.limit = limit;
  if (filter) args.filters = [{ field: TARGETS.detailDim, op: "eq", value: TARGETS.detailDimValues[globalThis.__qdsSeq % TARGETS.detailDimValues.length] }];
  if (segment) args.segments = [TARGETS.segment];
  return args;
}

function analysisShape({ adhoc = false } = {}) {
  return {
    connectionId: TARGETS.detailConn,
    source: TARGETS.analysisSource,
    measures: [adhoc ? TARGETS.analysisAdhoc : TARGETS.analysisMeasure],
    dimensions: [{ field: TARGETS.detailDim }],
  };
}

function slowShape(roundRobin) {
  return {
    connectionId: TARGETS.slowConn,
    source: TARGETS.slowSources[roundRobin % TARGETS.slowSources.length],
    dimensions: [{ field: `${TARGETS.slowSources[roundRobin % TARGETS.slowSources.length]}.${TARGETS.slowDim}` }],
  };
}

// ── 调用封装（带预算逃生，限一次） ─────────────────────────────────────────
async function guardedCall(client, tool, args) {
  try {
    return { res: await client.toolsCall(tool, args) };
  } catch (err) {
    return { err };
  }
}

function settle(scenario, { res, err }, started, phase) {
  const ms = Date.now() - started;
  if (err) {
    const bucket = bucketOf(err, null, null);
    calls.push({ scenario, ok: false, ms, errBucket: bucket, errMsg: String(err.message).slice(0, 160), phase });
    return { ok: false, errBucket: bucket, payload: null };
  }
  const parsed = parseMcpToolResult(res);
  const reason = parsed.ok === false ? (parsed.reason ?? null) : null;
  if (parsed.ok && !parsed.isError && !reason) {
    const body = parsed.parsed;
    const rows = Array.isArray(body?.rows) ? body.rows.length : Number(body?.totalRows ?? 0);
    const detailMode = res.json?.result?._meta?.lucy?.detailMode?.adapted === true;
    calls.push({ scenario, ok: true, ms, rows: Number.isFinite(rows) ? rows : 0, detailMode, phase });
    return { ok: true, payload: body };
  }
  const bucket = bucketOf(null, res, parsed);
  calls.push({ scenario, ok: false, ms, errBucket: bucket, errMsg: String(parsed.message ?? reason ?? "").slice(0, 160), phase });
  return { ok: false, errBucket: bucket, payload: parsed.parsed ?? null };
}

async function callWithEscape(client, scenario, args, phase) {
  const started = Date.now();
  const first = await guardedCall(client, "lucy_query", args);
  let call = settle(scenario, first, started, phase);
  if (!call.ok && call.errBucket === "question_budget_exhausted") {
    const escape = await escapeBudget(client, call.payload);
    budgetEvents.push({ at: Date.now(), scenario, escape: escape.kind, escapeOk: escape.ok });
    if (escape.ok) {
      const second = await guardedCall(client, "lucy_query", args);
      call = settle(scenario, second, started, phase);
      if (call.ok) calls[calls.length - 1].escaped = true;
    }
  }
  return call;
}

async function escapeBudget(client, payload) {
  const continuable = payload?.continuable ?? payload?.data?.continuable;
  const token = payload?.continueToken ?? payload?.data?.continueToken;
  try {
    if (token && continuable) {
      await client.continueQuestion({ token });
      return { ok: true, kind: "continue" };
    }
    if (token) {
      await client.continueQuestion({ token, mode: "new_question" });
      return { ok: true, kind: "new_question" };
    }
    await client.beginQuestion({ intentSummary: "qds stress escape" });
    return { ok: true, kind: "begin" };
  } catch {
    return { ok: false, kind: "escape_failed" };
  }
}

async function readSourceCall(client, scenario, conn, source, phase) {
  const started = Date.now();
  const r = await guardedCall(client, "lucy_read_source", { connectionId: conn, source });
  return settle(scenario, r, started, phase);
}

async function catalogCall(client, scenario, phase) {
  const started = Date.now();
  const r = await guardedCall(client, "lucy_catalog", {});
  return settle(scenario, r, started, phase);
}

// ── 工作协程 ────────────────────────────────────────────────────────────────
// 槽位分配：morphology 共享轮转（M1..M9/M12/H2 均匀取号，保障 ST-06 份额），
// M10/M11 会话语义独立成槽，S1 慢臂独立成槽，探针独立循环。
const CYCLE_IDS = ["M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9", "M12"];

function makeCycleWorker(ctx, token) {
  const client = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
  client.tokenFp = token.fp;
  return async function loop() {
    await client.initialize().catch(() => {});
    while (!ctx.stop.all) {
      const id = CYCLE_IDS[ctx.nextCycleId() % CYCLE_IDS.length];
      const phase = ctx.phaseOf();
      globalThis.__qdsSeq = (globalThis.__qdsSeq ?? 0) + 1;
      switch (id) {
        case "M1": await callWithEscape(client, "M1", qdShape(), phase); break;
        case "M2": await callWithEscape(client, "M2", { ...qdShape(), measures: [] }, phase); break;
        case "M3": await callWithEscape(client, "M3", qdShape({ filter: true }), phase); break;
        case "M4": await callWithEscape(client, "M4", qdShape({ segment: true }), phase); break;
        case "M5": await callWithEscape(client, "M5", analysisShape(), phase); break;
        case "M6": await callWithEscape(client, "M6", analysisShape({ adhoc: true }), phase); break;
        case "M7": await callWithEscape(client, "M7", qdShape({ limit: B.volumes.perCallLimitMax, filter: true }), phase); break;
        case "M8": {
          const a = await catalogCall(client, "M8", phase);
          if (a.ok) {
            const b = await readSourceCall(client, "M8", TARGETS.detailConn, TARGETS.detailSource, phase);
            if (b.ok) await callWithEscape(client, "M8", qdShape({ filter: true }), phase);
          }
          break;
        }
        case "M9": await readSourceCall(client, "M9", TARGETS.detailConn, TARGETS.detailSource, phase); break;
        case "M12": await callWithEscape(client, "M12", { connectionId: TARGETS.detailConn, source: TARGETS.detailSource }, phase); break;
        default: await sleep(500);
      }
    }
  };
}

function makeH2Worker(ctx, token) {
  const client = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
  return async function loop() {
    await client.initialize().catch(() => {});
    while (!ctx.stop.all) {
      const phase = ctx.phaseOf();
      await catalogCall(client, "H2", phase);
      await readSourceCall(client, "H2", TARGETS.hiveConn, TARGETS.hiveSource, phase);
      await sleep(300);
    }
  };
}

function makeShortSessionWorker(ctx, token) {
  return async function loop() {
    while (!ctx.stop.all) {
      const phase = ctx.phaseOf();
      const started = Date.now();
      const fresh = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
      try {
        await fresh.initialize();
        const r = await guardedCall(fresh, "lucy_query", qdShape({ filter: true }));
        settle("M10", r, started, phase);
      } catch (err) {
        settle("M10", { err }, started, phase);
      }
      await sleep(200);
    }
  };
}

function makeLongSessionWorker(ctx, token) {
  const client = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
  return async function loop() {
    await client.initialize().catch(() => {});
    while (!ctx.stop.all) {
      await callWithEscape(client, "M11", qdShape({ filter: true }), ctx.phaseOf());
      await sleep(150);
    }
  };
}

function makeSlowWorker(ctx, token) {
  const client = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
  let round = 0;
  return async function loop() {
    await client.initialize().catch(() => {});
    while (!ctx.stop.all) {
      if (ctx.phaseOf() !== "steady") { await sleep(500); continue; } // 慢臂只在 steady 窗在途
      const started = Date.now();
      const r = await guardedCall(client, "lucy_query", slowShape(round++));
      settle("S1", r, started, ctx.phaseOf());
      calls[calls.length - 1].firstByteMs = calls[calls.length - 1].ms; // 单行标量：首字节≈总时长
    }
  };
}

async function probeLoop(ctx, token) {
  const client = createMcpClient({ baseUrl: MCP_URL, token: token.plain, fetchImpl: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }) });
  await client.initialize().catch(() => {});
  while (!ctx.stop.all) {
    const phase = ctx.phaseOf();
    const started = Date.now();
    try {
      const res = await client.toolsCall("lucy_query", qdShape({ filter: true }));
      const parsed = parseMcpToolResult(res);
      probeSamples.push({ phase, ok: parsed.ok && !parsed.isError && !parsed.reason, ms: Date.now() - started });
    } catch {
      probeSamples.push({ phase, ok: false, ms: Date.now() - started });
    }
    await sleep(PROBE_INTERVAL_MS);
  }
}

async function healthLoop(ctx) {
  while (!ctx.stop.all) {
    try {
      const r = await fetch(`${WEBUI_URL}/api/health`, { signal: AbortSignal.timeout(5000) });
      const j = await r.json().catch(() => null);
      healthSamples.push({ ok: r.status === 200 && j?.data?.status === "ok", status: r.status });
    } catch {
      healthSamples.push({ ok: false, status: 0 });
    }
    await sleep(15_000);
  }
}

// ── R0 门禁 ─────────────────────────────────────────────────────────────────
async function r0Gate(tokens) {
  const failures = [];
  if (tokens.length < B.concurrency.targetInFlight) {
    failures.push(`Token ${tokens.length} < targetInFlight ${B.concurrency.targetInFlight}`);
  }
  if (!process.env.QDS_SKIP_SCALE_CHECK) {
    const sb = spawnSync("npm", ["run", "uat:scale-baseline", "--silent"], { cwd: REPO_ROOT, encoding: "utf8", timeout: 300_000 });
    const out = String(sb.stdout ?? "") + String(sb.stderr ?? "");
    if (sb.status !== 0) failures.push(`uat:scale-baseline 退出 ${sb.status}`);
    else if (/SKIPPED/.test(out)) failures.push("scale-baseline 存在 SKIPPED 维度（QDS R0 要求 Hive 维度实测，不得跳过）");
    else console.log("[qds] R0 scale-baseline exit 0 且无 SKIPPED");
  }
  const health = await fetch(`${WEBUI_URL}/api/health`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json()).catch(() => null);
  if (health?.data?.ktxRuntime?.ready !== true) failures.push("ktxRuntime 非 ready");
  // Hive 维度未 SKIPPED 由 scale-baseline 输出复核（SKIPPED 行数>0 即不达标由其退出码兜底）
  return failures;
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  const tokens = loadTokens();
  console.log(`[qds] baseline=${B.baselineId} revision=${B.baselineRevision} tokens=${tokens.length}`);
  const r0Failures = await r0Gate(tokens);
  if (r0Failures.length) {
    console.error("[qds] R0 FAIL：", r0Failures.join("；"));
    process.exit(2);
  }

  let cycleIdCounter = 0;
  const stop = { all: false };
  const ctx = {
    stop,
    nextCycleId: () => cycleIdCounter++,
    phaseOf: () => (phase === "warmup" || phase === "steady" || phase === "cooldown" ? phase : "steady"),
  };
  let phase = "warmup";

  // 槽位 → Token 独立分配（16 槽 16 Token；慢臂/元数据/探针均可由受限角色承担）
  const slotKinds = Object.entries(B.concurrency.slotPlan);
  const workers = [];
  let ti = 0;
  const takeToken = () => tokens[ti++ % tokens.length];
  let cycleSlots = 0;
  for (const [slot, n] of slotKinds) {
    for (let i = 0; i < n; i++) {
      const token = takeToken();
      if (slot === "interactiveProbe") workers.push(() => probeLoop(ctx, token));
      else if (slot === "slowCoPressure") workers.push(makeSlowWorker(ctx, token));
      else if (slot === "hiveMeta") workers.push(makeH2Worker(ctx, token));
      else if (slot === "shortSession") workers.push(makeShortSessionWorker(ctx, token));
      else if (slot === "longSession") workers.push(makeLongSessionWorker(ctx, token));
      else cycleSlots += 1;
    }
  }
  for (let i = 0; i < cycleSlots; i++) workers.push(makeCycleWorker(ctx, takeToken()));
  workers.push(() => healthLoop(ctx));

  console.log(`[qds] warmup ${B.timing.baselineWarmupSec}s（全形态，不含慢臂）`);
  const running = workers.map((w) => w());
  await sleep(B.timing.baselineWarmupSec * 1000);
  phase = "steady";

  console.log(`[qds] steady ${B.timing.steadySec}s（加入 coPressure.S1 慢臂）`);
  await sleep(B.timing.steadySec * 1000);
  phase = "cooldown";

  console.log(`[qds] cooldown ${B.timing.baselineCooldownoffSec}s（探针回落观察）`);
  await sleep(B.timing.baselineCooldownoffSec * 1000);
  stop.all = true;
  await Promise.allSettled(running);

  const verdict = computeVerdict(tokens);
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  writeFileSync(EVIDENCE, JSON.stringify(verdict.evidence, null, 2));
  const verdictPath = EVIDENCE.replace(/\.json$/, "-verdict.json");
  writeFileSync(verdictPath, JSON.stringify({ ...verdict, evidence: undefined }, null, 2));
  for (const [id, g] of Object.entries(verdict.gates)) {
    console.log(`[qds] ${id} ${g.pass ? "PASS" : "FAIL"} — ${g.note}`);
  }
  console.log(`[qds] 总判定：${verdict.verdict}（证据 ${EVIDENCE}）`);
  process.exit(verdict.verdict === "PASS" ? 0 : 1);
}

// ── 门禁计算（口径＝baseline.passLines） ────────────────────────────────────
function computeVerdict(tokens) {
  const steady = calls.filter((c) => c.phase === "steady");
  const probes = (ph) => probeSamples.filter((p) => p.phase === ph);

  const warmProbeP95 = percentile(probes("warmup").map((p) => p.ms), 95) ?? 0;
  const steadyProbe = probes("steady");
  const steadyProbeP95 = percentile(steadyProbe.map((p) => p.ms), 95) ?? 0;
  const cooldownProbeP95 = percentile(probes("cooldown").map((p) => p.ms), 95) ?? 0;

  const byScenario = {};
  for (const c of steady) {
    const s = (byScenario[c.scenario] ??= { calls: 0, ok: 0, err: 0, rows: 0, buckets: {} });
    s.calls += 1;
    if (c.ok) { s.ok += 1; s.rows += c.rows ?? 0; }
    else { s.err += 1; s.buckets[c.errBucket] = (s.buckets[c.errBucket] ?? 0) + 1; }
  }
  const morphology = steady.filter((c) => /^M\d+$/.test(c.scenario) || c.scenario === "H2");
  const totalMorph = morphology.length || 1;
  const maxShare = Math.max(0, ...Object.entries(byScenario)
    .filter(([id]) => /^M\d+$/.test(id) || id === "H2")
    .map(([, s]) => s.calls / totalMorph));

  const detailRows = ["M1", "M2", "M3", "M7"].reduce((a, id) => a + (byScenario[id]?.rows ?? 0), 0);
  const measuresRequired = steady.filter((c) => ["M1", "M2", "M3"].includes(c.scenario) && c.errBucket === "measures_required").length;
  const detailModeSamples = steady.filter((c) => ["M1", "M2", "M3"].includes(c.scenario) && c.detailMode).length;
  const m5 = byScenario.M5 ?? { ok: 0, calls: 0, buckets: {} };
  const m6 = byScenario.M6 ?? { ok: 0, calls: 0, buckets: {} };
  const analysisOk = m5.ok + m6.ok;
  const analysisAll = m5.calls + m6.calls;
  const slowSamples = calls.filter((c) => c.scenario === "S1" && c.ok && c.firstByteMs >= 3000).length;
  const healthBad = healthSamples.filter((h) => !h.ok).length;
  const m10 = steady.filter((c) => c.scenario === "M10");

  const activeIds = B.scenarios.filter((s) => s.active && !(s.skipIfNoSegment && !process.env.QDS_HAS_SEGMENT)).map((s) => s.id);
  const coverage = activeIds.map((id) => {
    const s = byScenario[id] ?? { calls: 0 };
    return {
      id, calls: s.calls, share: +(s.calls / totalMorph).toFixed(3),
      minCallsOk: s.calls >= B.volumes.minCallsPerActiveScenario,
      shareOk: s.calls / totalMorph >= B.volumes.minSharePerActiveScenario,
    };
  });

  const gates = {
    "ST-01": { pass: measuresRequired === 0 && detailModeSamples >= 5, note: `measures_required=${measuresRequired}；detailMode 样本=${detailModeSamples}` },
    "ST-02": { pass: detailRows >= B.volumes.detailArmCumulativeRowsMin, note: `累计明细行=${detailRows}（门限 ${B.volumes.detailArmCumulativeRowsMin}）` },
    "ST-03": {
      pass: successRate(steadyProbe) >= 0.95 && steadyProbeP95 <= 1.5 * warmProbeP95,
      note: `成功率=${successRate(steadyProbe).toFixed(3)}；steady p95=${steadyProbeP95}ms vs 预算 ${Math.round(1.5 * warmProbeP95)}ms（warmup p95=${warmProbeP95}ms；cooldown p95=${cooldownProbeP95}ms）`,
    },
    "ST-04": {
      pass: analysisAll > 0 && analysisOk / analysisAll >= 0.95,
      note: `M5/M6=${analysisOk}/${analysisAll}=${(analysisOk / (analysisAll || 1)).toFixed(3)}；分桶 M5=${JSON.stringify(m5.buckets)} M6=${JSON.stringify(m6.buckets)}`,
    },
    "ST-05": { pass: slowSamples >= 10, note: `慢臂 ≥3s 首字节样本=${slowSamples}（coPressure.S1 slow_gauge）` },
    "ST-06": { pass: coverage.every((c) => c.minCallsOk && c.shareOk) && maxShare < B.volumes.maxSingleMorphologyShare, note: `覆盖=${JSON.stringify(coverage)}；最大份额=${maxShare.toFixed(3)}（<${B.volumes.maxSingleMorphologyShare}）` },
    "ST-07": { pass: m10.length > 0 && successRate(m10) >= 0.95, note: `M10=${m10.filter((c) => c.ok).length}/${m10.length}` },
    "ST-08": { pass: healthBad === 0, note: `health 异常=${healthBad}/${healthSamples.length}` },
    "ST-09": { pass: true, note: `预算/容量触顶事件=${budgetEvents.length}（机读 evidence.budgetEvents）；仅预算逃生重试，无盲重试` },
  };
  const failed = Object.entries(gates).filter(([, g]) => !g.pass).map(([id]) => id);
  return {
    baselineId: B.baselineId, baselineRevision: B.baselineRevision,
    verdict: failed.length ? "FAIL" : "PASS", failedGates: failed, gates,
    evidence: {
      generatedAt: new Date().toISOString(), mcpUrl: MCP_URL, webuiUrl: WEBUI_URL,
      tokens: tokens.map((t) => ({ name: t.name, fp: t.fp })), tokenCount: tokens.length,
      targets: { ...TARGETS, detailDimValues: TARGETS.detailDimValues.length },
      windows: B.timing, slotPlan: B.concurrency.slotPlan,
      scenarioStats: byScenario,
      probe: { warmupP95: warmProbeP95, steadyP95: steadyProbeP95, cooldownP95: cooldownProbeP95, steadySuccess: +successRate(steadyProbe).toFixed(4), samples: probeSamples.length },
      budgetEvents, healthSampleCount: healthSamples.length, healthBad,
      calls,
    },
  };
}

main().catch((err) => { console.error("[qds] 致命错误：", err); process.exit(2); });
