#!/usr/bin/env node
/**
 * P1-36 UAT（沙箱，全真）：UAT-TRC-01/02/03/04/05/06/10。
 *
 *   node scripts/uat/uat-wide-sandbox.mjs up
 *   node scripts/uat/trace-span-ledger-uat.mjs <trc01|trc02|trc03|trc04|trc05|trc06|trc10|all> [--out file]
 *
 * 未覆盖（运行器不假装）：TRC-07（真实内网 IP／sl_query 错误脱敏）、TRC-08（ip_source 四场景需要受信代理拓扑）、
 * TRC-09（热路径开销需要 P1-36 前后两个构建做 A/B）；TRC-11 见 `webui/scripts/span-ledger-scale.mts`。
 * 用例之间共享 `lucy-uat/<run>` 的流量与 `.trc-state` 内存状态（all 模式一次跑完）。
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { adminSession, auditQuery, loadSandbox, makeClient, sleep } from "./lib/mcp-uat-lib.mjs";

const args = process.argv.slice(2);
const which = args[0];
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const { state, tokens } = loadSandbox();
const RUN = Date.now().toString(36);
const UA = `lucy-uat/${RUN}`;
const client = makeClient(state.proxy, { "user-agent": UA });
const FULL = state.agents.filter((a) => a.role === "uat_wide_full").map((a) => a.id);
const NOQUERY = state.agents.filter((a) => a.role === "uat_wide_noquery").map((a) => a.id);
const A = FULL[0];
const N = NOQUERY[0];
const legalArgs = { connectionId: state.connection, measures: [{ expr: "COUNT(t_0001.id)", name: "n" }] };
const q = (sql, params = []) => auditQuery(state.container, sql, params);

function makeReport(name) {
  const checks = [];
  const gaps = [];
  return {
    check(label, pass, detail) { checks.push({ name: label, pass: Boolean(pass), detail }); return Boolean(pass); },
    gap(text) { gaps.push(text); },
    done(extra = {}) {
      const failed = checks.filter((c) => !c.pass);
      return { case: name, verdict: failed.length ? "FAIL" : gaps.length ? "PASS WITH GAP" : "PASS", checks, gaps, ...extra };
    }
  };
}

// ── 共享：混合流量与发送清单（TRC-01 生成，其余用例复用）────────────────
const shared = { sent: [], noId: {}, marker: 0, sessionOfA: null, traces: [] };
async function sendMixed() {
  if (shared.marker) return;
  shared.marker = q("SELECT COALESCE(MAX(id),0) AS id FROM access_log")[0].id;
  let n = 0;
  const idOf = () => `${RUN}-${(n += 1)}`;
  const tA = tokens[A];
  const tN = tokens[N];
  const sendId = (tool, id) => shared.sent.push({ tool, id });
  const noId = (tool) => { shared.noId[tool] = (shared.noId[tool] ?? 0) + 1; };

  let id = idOf(); const initA = await client.rpc(tA, { ...client.initBody(id) }); sendId("initialize", id);
  shared.sessionOfA = initA.session;
  await client.rpc(tA, { jsonrpc: "2.0", method: "notifications/initialized" }, initA.session); noId("notifications/initialized");
  id = idOf(); const initN = await client.rpc(tN, client.initBody(id)); sendId("initialize", id);
  await client.rpc(tN, { jsonrpc: "2.0", method: "notifications/initialized" }, initN.session); noId("notifications/initialized");

  const call = async (token, session, tool, args2) => { const i = idOf(); await client.rpc(token, { jsonrpc: "2.0", id: i, method: "tools/call", params: { name: tool, arguments: args2 } }, session); sendId(tool, i); };
  id = idOf(); await client.rpc(tA, { jsonrpc: "2.0", id, method: "tools/list" }, initA.session); sendId("tools/list", id);
  id = idOf(); await client.rpc(tA, { jsonrpc: "2.0", id, method: "ping" }, initA.session); sendId("ping", id);
  await call(tA, initA.session, "wiki_search", { query: "指标" });
  await call(tA, initA.session, "wiki_read", { path: "global/none.md" });
  await call(tA, initA.session, "lucy_query", legalArgs);
  await call(tA, initA.session, "lucy_query", { ...legalArgs, filters: ["t_0001.status = 'open'"] });
  await call(tN, initN.session, "lucy_query", legalArgs);                                                    // ACL 拒绝
  await call(tA, initA.session, "lucy_query", { ...legalArgs, filters: [`ghost_${RUN}.x = 1`] });             // 门闩拒绝
  await call(tA, initA.session, "lucy_bind_source", {});                                                     // 不存在的工具名
  await call(tA, initA.session, "lucy_query", { connectionId: state.connection });                           // 缺参
  await call(tA, initA.session, "lucy_read_source", { connectionId: state.connection, sourceName: "t_0001" });
  await call(tA, initA.session, "lucy_catalog", {});
  await call(tA, initA.session, "lucy_query", { connectionId: state.connection, measures: [{ expr: "COUNT(t_0001.no_such_col)", name: "n" }] }); // 上游错误
  await sleep(2500); // 审计写入异步排空
}
const rowsOfRun = () => q("SELECT * FROM access_log WHERE id > ? AND user_agent = ? ORDER BY id", [shared.marker, UA]);

// ── TRC-01 ─────────────────────────
async function trc01() {
  const r = makeReport("UAT-TRC-01");
  await sendMixed();
  const rows = rowsOfRun();
  r.check("零行落库即 FAIL（本次范围内行数 > 0）", rows.length > 0, { rows: rows.length });
  const expectedIds = new Set(shared.sent.map((s) => s.id));
  const gotIds = new Set(rows.map((x) => x.rpc_request_id).filter(Boolean));
  const missing = [...expectedIds].filter((i) => !gotIds.has(i));
  const extraIds = [...gotIds].filter((i) => !expectedIds.has(i));
  r.check("带 id 请求：missing 为空", missing.length === 0, { missing });
  r.check("带 id 请求：extra 为空", extraIds.length === 0, { extraIds });
  const countBy = (tool) => rows.filter((x) => x.tool === tool).length;
  const wantTool = {};
  for (const s of shared.sent) wantTool[s.tool] = (wantTool[s.tool] ?? 0) + 1;
  for (const [tool, n] of Object.entries(shared.noId)) wantTool[tool] = (wantTool[tool] ?? 0) + n;
  const mismatches = Object.entries(wantTool).filter(([tool, n]) => countBy(tool) !== n).map(([tool, n]) => ({ tool, want: n, got: countBy(tool) }));
  r.check("逐类落库数 = 发送数（含无 id 的通知）", mismatches.length === 0, { mismatches, wantTool });
  const extraTools = [...new Set(rows.map((x) => x.tool))].filter((t) => !(t in wantTool));
  r.check("无清单外的 tool 类别（extra 为空）", extraTools.length === 0, { extraTools });
  r.check("全部行 trace_id 非空", rows.every((x) => x.trace_id), { nulls: rows.filter((x) => !x.trace_id).length });
  const dups = rows.length - new Set(rows.map((x) => x.trace_id)).size;
  r.check("trace_id 唯一", dups === 0, { dups });
  shared.traces = rows.map((x) => x.trace_id);
  return r.done({ rows: rows.length });
}

// ── TRC-02 ─────────────────────────
const inList = (n) => Array.from({ length: n }, () => "?").join(",");
async function trc02() {
  const r = makeReport("UAT-TRC-02");
  await trc01Ensure();
  const T = shared.traces;
  const spans = q(`SELECT s.*, a.trace_id AS row_trace FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE s.trace_id IN (${inList(T.length)})`, T);
  const byTrace = new Map();
  for (const sp of spans) byTrace.set(sp.trace_id, [...(byTrace.get(sp.trace_id) ?? []), sp]);
  const bad = { root: [], parent: [], seq: [], parentSeq: [], over32: [], dropped: [], mismatch: [], noSpan: [] };
  for (const t of T) {
    const list = byTrace.get(t) ?? [];
    if (list.length === 0) { bad.noSpan.push(t); continue; }
    if (list.filter((s) => s.parent_span_id === null).length !== 1) bad.root.push(t);
    const ids = new Map(list.map((s) => [s.span_id, s]));
    if (list.some((s) => s.parent_span_id !== null && !ids.has(s.parent_span_id))) bad.parent.push(t);
    const seqs = list.map((s) => s.seq).sort((a, b) => a - b);
    if (!seqs.every((v, i) => v === i + 1)) bad.seq.push(t);
    if (list.some((s) => s.parent_span_id !== null && ids.get(s.parent_span_id) && ids.get(s.parent_span_id).seq >= s.seq)) bad.parentSeq.push(t);
    if (list.length > 32) bad.over32.push(t);
    if (list.some((s) => { try { return Number(JSON.parse(s.attrs_json ?? "{}").dropped ?? 0) !== 0; } catch { return true; } })) bad.dropped.push(t);
    if (list.some((s) => s.row_trace !== s.trace_id)) bad.mismatch.push(t);
  }
  for (const [k, label] of [["noSpan", "每个纳入行至少 1 个 span"], ["root", "每个 trace 恰一个根 span"], ["parent", "全部节点父 span 存在于同 trace"], ["seq", "seq 从 1 连续无空洞"], ["parentSeq", "parent.seq < child.seq"], ["over32", "span 数 ≤ 32"], ["dropped", "attrs.dropped 恒为 0"], ["mismatch", "span.trace_id 与所指流水行一致"]]) {
    r.check(label, bad[k].length === 0, { violations: bad[k].slice(0, 10) });
  }
  const orphan = q("SELECT COUNT(*) AS n FROM access_trace_span s LEFT JOIN access_log a ON a.id = s.access_log_id WHERE a.id IS NULL")[0].n;
  r.check("无孤儿 span（全库）", orphan === 0, { orphan });
  const unreachable = q(`WITH RECURSIVE walk(trace_id, span_id) AS (
      SELECT trace_id, span_id FROM access_trace_span WHERE parent_span_id IS NULL AND trace_id IN (${inList(T.length)})
      UNION ALL SELECT s.trace_id, s.span_id FROM access_trace_span s JOIN walk w ON s.parent_span_id = w.span_id AND s.trace_id = w.trace_id)
    SELECT (SELECT COUNT(*) FROM access_trace_span WHERE trace_id IN (${inList(T.length)})) - (SELECT COUNT(*) FROM walk) AS gap`, [...T, ...T])[0].gap;
  r.check("递归可达：每个 span 沿 parent 可达根（无环）", unreachable === 0, { unreachable });
  const admin = await adminSession(state);
  const status = await admin.api("GET", "/api/admin/audit/status");
  r.check("服务单例连接 foreign_keys = ON", status.json?.sqlite?.foreign_keys === 1 || status.json?.sqlite?.foreign_keys === true || status.json?.sqlite?.foreign_keys === "on", status.json?.sqlite);
  const ddl = q("SELECT sql FROM sqlite_master WHERE name = 'access_trace_span'")[0]?.sql ?? "";
  r.check("表结构含 CHECK 约束（status／reason_code／attrs_json）", /CHECK/i.test(ddl) && /reason_code/.test(ddl) && /attrs_json/.test(ddl), { hasCheck: /CHECK/i.test(ddl) });
  const copyInserts = copyDbInsertChecks();
  r.check("测试副本库：未登记 reason_code 被 CHECK 拒", copyInserts.badReason === "rejected", copyInserts);
  r.check("测试副本库：1024 个中文字符的 attrs_json 被 CHECK 拒", copyInserts.bigAttrs === "rejected", copyInserts);
  const usedReasons = q(`SELECT DISTINCT reason_code AS rc FROM access_trace_span WHERE trace_id IN (${inList(T.length)}) AND reason_code IS NOT NULL`, T).map((x) => x.rc);
  r.check("本次 reason_code 均已登记且无 unclassified", !usedReasons.includes("unclassified"), { usedReasons });
  // 固定场景表
  const reasonOf = (tool, pred) => {
    const rows = rowsOfRun().filter((x) => x.tool === tool && pred(x));
    const row = rows[0];
    if (!row) return null;
    return q("SELECT stage, status, reason_code FROM access_trace_span WHERE trace_id = ? AND status != 'ok'", [row.trace_id]);
  };
  const aclSpans = reasonOf("lucy_query", (x) => x.user_id === N);
  r.check("越权（ACL 拒绝）→ acl_denied", aclSpans?.some((s) => s.reason_code === "acl_denied"), aclSpans);
  const gateSpans = reasonOf("lucy_query", (x) => x.decision_reason === "source_ambiguity_gate");
  r.check("源歧义门闩 → gate_denied", gateSpans?.some((s) => s.reason_code === "gate_denied"), gateSpans);
  const argSpans = reasonOf("lucy_query", (x) => String(x.decision_reason ?? "").startsWith("invalid_arguments"));
  r.check("缺参 → arg_invalid", argSpans?.some((s) => s.reason_code === "arg_invalid"), argSpans);
  const upstreamSpans = reasonOf("lucy_query", (x) => x.outcome === "error" && !String(x.decision_reason ?? "").startsWith("invalid_arguments"));
  r.check("上游错误 → upstream_error", upstreamSpans?.some((s) => s.reason_code === "upstream_error"), upstreamSpans);
  // 预算耗尽：同一会话连续有效数据工具调用（上限 60 次）直至预算停止
  const { session } = await client.open(tokens[FULL[3]]);
  let budgetStop = false;
  for (let i = 0; i < 80 && !budgetStop; i += 1) {
    const sourceName = `t_${String(i + 1).padStart(4, "0")}`; // 预算只计真正执行的数据工具调用
    const res = await client.callTool(tokens[FULL[3]], session, `${RUN}-b${i}`, "lucy_read_source", { connectionId: state.connection, sourceName });
    budgetStop = /question_budget_exhausted/.test(res.text);
  }
  await sleep(1500);
  const budgetRows = q("SELECT s.reason_code AS rc FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE a.user_id = ? AND a.user_agent = ? AND s.reason_code = 'budget_stopped'", [FULL[3], UA]);
  r.check("预算耗尽 → budget_stopped", budgetStop && budgetRows.length > 0, { budgetStop, rows: budgetRows.length });
  // tools/call 最小集合
  for (const tool of ["lucy_query", "lucy_read_source", "lucy_catalog"]) {
    const row = rowsOfRun().find((x) => x.tool === tool && x.outcome !== "denied" && x.outcome !== "error")
      ?? rowsOfRun().find((x) => x.tool === tool && x.user_id === A);
    const stages = q("SELECT stage, status FROM access_trace_span WHERE trace_id = ?", [row.trace_id]);
    const has = (s, st) => stages.some((x) => x.stage === s && (!st || x.status === st));
    r.check(`${tool} 最小集合：acl(ok)＋执行方式＋response_serialize`, has("acl", "ok") && (has("upstream_call") || has("local_handler")) && has("response_serialize"), stages.map((x) => `${x.stage}:${x.status}`));
  }
  r.gap("TIMEOUT 场景（reason_code=timeout）：沙箱无法造出真实上游超时（需要卡死 KTX），未测；映射由 vitest 契约表覆盖");
  r.gap("truncated（31＋1、dropped 计算）按用例设计由 vitest 契约覆盖，不在本用例");
  return r.done({ traces: T.length, spans: spans.length });
}

function copyDbInsertChecks() {
  const script = [
    'const D=require("/app/webui/node_modules/better-sqlite3");const fs=require("fs");',
    'fs.copyFileSync("/data/lucy/.ktx-ui/audit.sqlite","/tmp/uat-copy.sqlite");',
    'const db=new D("/tmp/uat-copy.sqlite");db.pragma("foreign_keys = ON");',
    'const row=db.prepare("SELECT s.*, a.id AS aid FROM access_trace_span s JOIN access_log a ON a.id=s.access_log_id LIMIT 1").get();',
    'const ins=(over)=>{const v={...row,...over};db.prepare("INSERT INTO access_trace_span (span_id,trace_id,access_log_id,parent_span_id,seq,stage,started_at_ms,duration_ms,status,reason_code,reason_param,error_category,attrs_json,derivation_version) VALUES (@span_id,@trace_id,@access_log_id,@parent_span_id,@seq,@stage,@started_at_ms,@duration_ms,@status,@reason_code,@reason_param,@error_category,@attrs_json,@derivation_version)").run(v);};',
    'const out={};',
    'try{ins({span_id:"x1",seq:999,reason_code:"not_registered_reason"});out.badReason="accepted";}catch(e){out.badReason=/CHECK/.test(String(e.message))?"rejected":"other:"+e.message;}',
    'try{ins({span_id:"x2",seq:998,attrs_json:JSON.stringify({k:"中".repeat(1024)})});out.bigAttrs="accepted";}catch(e){out.bigAttrs=/CHECK/.test(String(e.message))?"rejected":"other:"+e.message;}',
    'db.close();fs.unlinkSync("/tmp/uat-copy.sqlite");console.log(JSON.stringify(out));'
  ].join("");
  const res = spawnSync("docker", ["exec", state.container, "node", "-e", script], { encoding: "utf8" });
  try { return JSON.parse(res.stdout.trim()); } catch { return { error: res.stderr.slice(0, 300) }; }
}

// ── TRC-03 ─────────────────────────
async function trc03() {
  const r = makeReport("UAT-TRC-03");
  const admin = await adminSession(state);
  const run = `${RUN}-f`;
  const tA = tokens[A];
  const { session } = await client.open(tA);
  const before = await client.callTool(tA, session, `${run}-before`, "lucy_query", legalArgs);
  const failuresBefore = (await admin.api("GET", "/api/admin/audit/status")).json?.writeHealth ?? {};
  const sql = (s) => spawnSync("docker", ["exec", state.container, "node", "-e",
    `const D=require("/app/webui/node_modules/better-sqlite3");const db=new D("/data/lucy/.ktx-ui/audit.sqlite");db.exec(${JSON.stringify(s)});db.close();`], { encoding: "utf8" });
  const triggerSql = "CREATE TRIGGER IF NOT EXISTS uat_fail_span BEFORE INSERT ON access_trace_span BEGIN SELECT RAISE(ABORT, 'uat-injected'); END;";
  const injected = sql(triggerSql);
  r.check("故障注入（span 插入触发器）已安装", injected.status === 0, injected.stderr.slice(0, 200));
  const marker = q("SELECT COALESCE(MAX(id),0) AS id FROM access_log")[0].id;
  const during = await client.callTool(tA, session, `${run}-during`, "lucy_query", legalArgs);
  await sleep(2000);
  const rowsDuring = q("SELECT id FROM access_log WHERE id > ? AND rpc_request_id = ?", [marker, `${run}-during`]);
  const orphanSpans = q("SELECT COUNT(*) AS n FROM access_trace_span s LEFT JOIN access_log a ON a.id = s.access_log_id WHERE a.id IS NULL")[0].n;
  const failuresAfter = (await admin.api("GET", "/api/admin/audit/status")).json?.writeHealth ?? {};
  sql("DROP TRIGGER IF EXISTS uat_fail_span;");
  const triggerLeft = q("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'uat_fail_span'")[0].n;
  r.check("注入期间：行与 span 都不落库（无该请求的流水行）", rowsDuring.length === 0, { rows: rowsDuring.length });
  r.check("无孤儿 span", orphanSpans === 0, { orphanSpans });
  r.check("客户端结果与注入前一致（均成交，无新增失败形态）", !before.isError && !during.isError, { before: before.text.slice(0, 40), during: during.text.slice(0, 40) });
  const failBefore = Number(failuresBefore.failedWrites ?? failuresBefore.writeFailures ?? failuresBefore.failures ?? 0);
  const failAfter = Number(failuresAfter.failedWrites ?? failuresAfter.writeFailures ?? failuresAfter.failures ?? 0);
  r.check("审计写入失败计数增加", failAfter > failBefore, { writeHealthBefore: failuresBefore, writeHealthAfter: failuresAfter });
  r.check("清除注入后触发器不残留", triggerLeft === 0, { triggerLeft });
  const marker2 = q("SELECT COALESCE(MAX(id),0) AS id FROM access_log")[0].id;
  const after = await client.callTool(tA, session, `${run}-after`, "lucy_query", legalArgs);
  await sleep(2000);
  const rowsAfter = q("SELECT id, trace_id FROM access_log WHERE id > ? AND rpc_request_id = ?", [marker2, `${run}-after`]);
  r.check("清除注入后恢复：请求成交且行与 span 落库", !after.isError && rowsAfter.length === 1 && q("SELECT COUNT(*) AS n FROM access_trace_span WHERE trace_id = ?", [rowsAfter[0]?.trace_id ?? ""])[0].n > 0, { rows: rowsAfter.length });
  return r.done();
}

// ── TRC-04 ─────────────────────────
function c9Violations(traces, shiftMs = 0) {
  const rows = q(`SELECT s.trace_id, s.span_id, s.parent_span_id, s.stage, s.started_at_ms, s.duration_ms, a.ts AS ts, a.duration_ms AS row_ms
      FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE s.trace_id IN (${inList(traces.length)})`, traces);
  const by = new Map();
  for (const x of rows) by.set(x.trace_id, [...(by.get(x.trace_id) ?? []), { ...x, started_at_ms: x.started_at_ms + shiftMs }]);
  const out = { c9a: [], c9b: [], c9c: [], c9d: [] };
  const TOL = 1;
  for (const [trace, list] of by) {
    const root = list.find((s) => s.parent_span_id === null);
    if (!root) continue;
    const rootEnd = root.started_at_ms + root.duration_ms;
    if (list.some((s) => s !== root && (s.started_at_ms < root.started_at_ms - TOL || s.started_at_ms + s.duration_ms > rootEnd + TOL))) out.c9a.push(trace);
    if (Math.abs(root.duration_ms - root.row_ms) > TOL) out.c9b.push(trace);
    const tsMs = Date.parse(root.ts);
    if (Math.abs(rootEnd - tsMs) > TOL || Math.abs(root.started_at_ms - (tsMs - root.row_ms)) > TOL) out.c9c.push(trace);
    const parallel = new Set(["catalog_resolve", "skills_load"]);
    const siblings = new Map();
    for (const s of list) if (!parallel.has(s.stage)) siblings.set(s.parent_span_id, [...(siblings.get(s.parent_span_id) ?? []), s]);
    for (const group of siblings.values()) {
      group.sort((a, b) => a.started_at_ms - b.started_at_ms);
      if (group.some((s, i) => i > 0 && s.started_at_ms < group[i - 1].started_at_ms + group[i - 1].duration_ms - TOL)) { out.c9d.push(trace); break; }
    }
  }
  return out;
}
async function trc04() {
  const r = makeReport("UAT-TRC-04");
  await trc01Ensure();
  const v = c9Violations(shared.traces);
  for (const [k, label] of [["c9a", "C9a 子 span 落在根区间内"], ["c9b", "C9b 根 span 时长 = 流水 duration_ms（±1 ms）"], ["c9c", "C9c 墙钟锚定（±1 ms）"], ["c9d", "C9d 串行阶段同父不重叠（±1 ms）"]]) {
    r.check(`${label}（容差固定 1 ms）`, v[k].length === 0, { violations: v[k].slice(0, 10) });
  }
  const shifted = c9Violations(shared.traces, 365 * 86_400_000);
  r.check("反例：全部 span 的 started_at_ms 平移一年后 C9c 必须 FAIL（C9 不恒真）", shifted.c9c.length > 0, { violationsAfterShift: shifted.c9c.length });
  r.gap("慢序列化／发送背压请求（大结果集 lucy_read_source）未造：沙箱表仅 3 行；C9b 对根含 response_serialize 由 vitest 契约覆盖");
  r.gap("反例平移在内存读数上做（非复制库）：与改副本库逐行等价，且不触碰运行库");
  return r.done({ traces: shared.traces.length });
}

// ── TRC-06 ─────────────────────────
async function trc06() {
  const r = makeReport("UAT-TRC-06");
  await trc01Ensure();
  const rows = rowsOfRun();
  const allTraces = rows.map((x) => x.trace_id);
  const stagesOf = new Map(q(`SELECT trace_id, group_concat(stage || ':' || status || ':' || COALESCE(reason_code,''), '|') AS s FROM access_trace_span WHERE trace_id IN (${inList(allTraces.length)}) GROUP BY trace_id`, allTraces).map((x) => [x.trace_id, x.s.split("|")]));
  const has = (row, stage) => (stagesOf.get(row.trace_id) ?? []).some((s) => s.startsWith(`${stage}:`));
  const protoSet = new Set(["initialize", "notifications/initialized", "tools/list", "ping", "wiki_search", "wiki_read"]);
  const missing = [];
  for (const row of rows) {
    const tool = row.tool;
    const list = stagesOf.get(row.trace_id) ?? [];
    const deniedSpan = list.some((s) => s.includes(":denied:"));
    if (deniedSpan) continue; // §6.2 被拒行：只须有被拒阶段 denied span（下面单独断言被拒行必有）
    if (row.outcome === "denied" || row.outcome === "budget_stop") { missing.push({ tool, need: "denied span", outcome: row.outcome }); continue; }
    if (tool === "initialize" && !has(row, "upstream_handshake")) missing.push({ tool, need: "upstream_handshake" });
    else if (tool === "tools/list" && !has(row, "upstream_call")) missing.push({ tool, need: "upstream_call" });
    else if ((tool === "notifications/initialized" || tool === "ping" || tool === "wiki_search" || tool === "wiki_read") && !(has(row, "local_handler") || has(row, "upstream_call"))) missing.push({ tool, need: "local_handler|upstream_call" });
    else if (!protoSet.has(tool) && row.outcome !== "error" && !(has(row, "acl") && (has(row, "upstream_call") || has(row, "local_handler")) && has(row, "response_serialize"))) missing.push({ tool, need: "acl+exec+response_serialize" });
  }
  r.check("各请求类必有 span 集合齐全（无条件；被拒／预算终止行以 denied span 为必有集合）", missing.length === 0, { missing: missing.slice(0, 10) });
  // §6.2：协议／wiki 类主状态必不为 unknown；其他 tools/call 的主状态证据路径保持 v2p5-1（入参校验失败行按 S01 仍落 unknown，Spec 明示不改）。
  const protoWiki = new Set(["initialize", "notifications/initialized", "tools/list", "ping", "wiki_search", "wiki_read"]);
  const unknownProto = rows.filter((x) => protoWiki.has(x.tool) && (x.primary_status === "unknown" || x.primary_status === null));
  r.check("协议／wiki 行主状态非 unknown", unknownProto.length === 0, { unknown: unknownProto.map((x) => x.tool) });
  const schemaRows = rows.filter((x) => x.error_category === "client_schema_failure");
  r.check("入参校验失败行：error_category=client_schema_failure 且主状态按 v2p5-1 不变（unknown）——与 Spec §6.2 一致", schemaRows.length > 0 && schemaRows.every((x) => x.primary_status === "unknown"), { rows: schemaRows.length });
  r.gap("SC-06 文字『其他 tools/call 行主状态不为 unknown』与 §6.2『主状态证据路径保持 v2p5-1 不变』冲突：客户基线 104 行 lucy_query unknown 正是入参校验失败行，实现按 §6.2 保持 unknown；需委托人裁定 SC-06 口径（见证据报告 O-新）");
  const policyDenied = rows.filter((x) => x.outcome === "denied" && !["wiki_not_found"].includes(x.decision_reason));
  r.check("被拒＝primary_status=denied 且 error_category=policy_denied（两列分别断言；排除 §4 表第 8 类 VALIDATION_REASONS）",
    policyDenied.length > 0 && policyDenied.every((x) => x.primary_status === "denied" && x.error_category === "policy_denied"),
    policyDenied.map((x) => [x.decision_reason, x.primary_status, x.error_category]));
  const validationDenied = rows.filter((x) => x.decision_reason === "wiki_not_found");
  r.check("wiki_not_found（VALIDATION_REASONS）：denied＋validation_failed，与 §4 表第 8 类一致", validationDenied.length > 0 && validationDenied.every((x) => x.primary_status === "denied" && x.error_category === "validation_failed"), validationDenied.map((x) => [x.primary_status, x.error_category]));
  const initRows = rows.filter((x) => x.tool === "initialize");
  r.check("场景①上游可达的 initialize：primary_status=succeeded", initRows.length > 0 && initRows.every((x) => x.primary_status === "succeeded"), initRows.map((x) => x.primary_status));
  const dv = q("SELECT derivation_version AS v, COUNT(*) AS n FROM access_log WHERE id > ? GROUP BY 1", [shared.marker]);
  r.check("新行 derivation_version = v2p5-2", dv.length === 1 && dv[0].v === "v2p5-2", dv);
  r.gap("场景②（wiki_search 上游失败＋本地回退成功）：需要使 KTX 在 wiki_search 当下不可用且回退命中，沙箱里 KTX 重启窗口过短不可控，NOT RUN；由 vitest 覆盖");
  r.gap("旧行（升级前 v2p5-1）不回写：沙箱为全新库无旧行；demo 库旧行对比需升级前快照，本轮未取，NOT RUN");
  return r.done();
}

// ── TRC-05（含 TRC-10 的导出对照）─────────────────────────
function parseCsv(text) {
  const rows = []; let row = []; let cell = ""; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const exportModes = [];
async function exportPack(admin, dir, label) {
  let res;
  let mode = "complete";
  for (let attempt = 0; attempt < 6; attempt += 1) {
    res = await admin.raw(`/api/admin/audit/export-pack-v2?mode=${mode}${mode === "diagnostic" ? "&confirmDiagnostic=true" : ""}&exportedBy=uat&exportReason=trc-uat-${label}`);
    if (res.status === 200) break;
    if (/projection_lag_exceeded|PROJECTION_NOT_CAUGHT_UP/.test(res.text)) { await sleep(2500); continue; }
    // 正式完整导出对整库「as-of S 证明」失败关闭（既有 F-02／attribution_journal_baseline 空表，见 2026-10-28 UAT 复核）：
    // 降级为诊断导出读 spans.csv，并在报告里单列。
    if (mode === "complete" && /integrity_or_relation_failed/.test(res.text)) { mode = "diagnostic"; continue; }
    break;
  }
  exportModes.push(mode);
  if (res.status !== 200) throw new Error(`export failed ${res.status} ${res.text.slice(0, 200)}`);
  const zip = path.join(dir, `${label}.zip`);
  writeFileSync(zip, res.buffer);
  const out = path.join(dir, label);
  mkdirSync(out, { recursive: true });
  const unzip = spawnSync("unzip", ["-o", "-q", zip, "-d", out], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
  const manifest = JSON.parse(readFileSync(path.join(out, "manifest.json"), "utf8"));
  const spans = parseCsv(readFileSync(path.join(out, "spans.csv"), "utf8").replace(/^\uFEFF/, ""));
  return { dir: out, manifest, header: spans[0], spans: spans.slice(1).filter((x) => x.length > 1), upper: Number(manifest.spans?.ledgerUpperSeq ?? manifest.ledgerUpperSeq), mode };
}
const canonical = (pack) => pack.spans.map((r) => r.join("\u0001")).sort();

async function waitPendingZero(admin) {
  for (let i = 0; i < 60; i += 1) {
    const status = await admin.api("GET", "/api/admin/audit/status");
    const pending = Number(status.json?.writeHealth?.pendingWrites ?? 0);
    const lag = Number(status.json?.writeHealth?.projection?.lag ?? 0);
    if (pending === 0 && lag === 0) return true; // 投影追平后导出才不会 409 projection_lag_exceeded
    await sleep(500);
  }
  return false;
}
async function trc05() {
  const r = makeReport("UAT-TRC-05");
  await trc01Ensure();
  const admin = await adminSession(state);
  const dir = mkdtempSync(path.join(os.tmpdir(), "trc05-"));
  try {
    r.check("导出前审计写入 pending = 0", await waitPendingZero(admin), null);
    const p1 = await exportPack(admin, dir, "e1");
    const spansEntry = (p1.manifest.files ?? []).find((f) => /spans\.csv$/.test(f.name ?? f.path ?? ""));
    r.check("manifest 登记 spans.csv", Boolean(spansEntry), { files: (p1.manifest.files ?? []).map((f) => f.name ?? f.path) });
    const sha = createHash("sha256").update(readFileSync(path.join(p1.dir, "spans.csv"))).digest("hex");
    r.check("spans.csv 行数与 manifest.rowCount 一致", spansEntry && Number(spansEntry.rowCount) === p1.spans.length, { rows: p1.spans.length, manifest: spansEntry?.rowCount });
    r.check("spans.csv sha256 与 manifest 一致", spansEntry && spansEntry.sha256 === sha, { sha: sha.slice(0, 12) });
    const dbCount = q("SELECT COUNT(*) AS n FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE a.ledger_seq IS NOT NULL AND a.ledger_seq <= ?", [p1.upper])[0].n;
    r.check("与库对账：JOIN 所属行 ledger_seq ≤ S1 的 span 行数一致", dbCount === p1.spans.length, { db: dbCount, csv: p1.spans.length, S1: p1.upper });
    const unsequenced = q("SELECT COUNT(*) AS n FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id WHERE a.ledger_seq IS NULL")[0].n;
    const reported = p1.manifest.spans?.unsequenced ?? p1.manifest.spanCoverage?.unsequenced ?? null;
    r.check("unsequenced 单列上报且与库一致", reported === null ? false : Number(reported) === unsequenced, { reported, db: unsequenced });
    shared.exportE1 = p1;

    r.check("第二次导出前账本静止且 pending = 0", await waitPendingZero(admin), null);
    const p2 = await exportPack(admin, dir, "e2");
    if (p2.upper !== p1.upper) {
      r.gap(`第二次导出 S2(${p2.upper}) ≠ S1(${p1.upper})：本次规范化比较作废（按用例规则），已重导`);
    }
    const p2b = p2.upper === p1.upper ? p2 : await exportPack(admin, dir, "e2b");
    const same = p2b.upper === p1.upper && JSON.stringify(canonical(p1)) === JSON.stringify(canonical(p2b));
    r.check("同 S 两次导出：spans.csv 规范化内容逐行一致", same, { S1: p1.upper, S2: p2b.upper, rows1: p1.spans.length, rows2: p2b.spans.length });

    for (let i = 0; i < 5; i += 1) await client.callTool(tokens[A], (await client.open(tokens[A])).session, `${RUN}-t5-${i}`, "lucy_query", legalArgs);
    r.check("新流量后 pending = 0", await waitPendingZero(admin), null);
    const p3 = await exportPack(admin, dir, "e3");
    const seqIdx = p1.header.indexOf("ledger_seq");
    const prefix = (pack) => pack.spans.filter((x) => Number(x[seqIdx]) <= p1.upper).map((x) => x.join("\u0001")).sort();
    r.check("前缀比较：S3 包中 ledger_seq ≤ S1 的行与第一次逐行一致", p3.upper > p1.upper && JSON.stringify(prefix(p3)) === JSON.stringify(prefix(p1)), { S1: p1.upper, S3: p3.upper, prefix1: prefix(p1).length, prefix3: prefix(p3).length });
    shared.exportE3 = p3;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (exportModes.includes("diagnostic")) r.gap("正式完整导出（mode=complete）在沙箱 409 integrity_or_relation_failed（demo 的 `access_log_asof_meta` 同样为空）：`access_log_asof_meta` 为空（`attribution_journal_baseline_seq` 未登记），as-of S 证明失败关闭——属 2026-10-28 复核已登记的 F-02 未收口缺陷，与 P1-36 无关；本用例改用诊断导出（mode=diagnostic）读 spans.csv，行数／sha256／截止序号／前缀／重导合同的核对不受影响，但『正式完整包含 spans.csv』未能直接验证");
  r.gap("『既有文件逐字不变（与改前导出对比）』需要 P1-36 前的构建导出作基线，本轮无基线 → NOT RUN；既有文件的等价守卫由 vitest audit-scale-equivalence 覆盖");
  r.gap("导出包不含 HMAC 密钥材料：以本包内文本扫描补做（见 MCPX-06 7b 对审计库的扫描）");
  return r.done();
}

// ── TRC-10 ─────────────────────────
async function trc10() {
  const r = makeReport("UAT-TRC-10");
  await trc01Ensure();
  const rows = rowsOfRun();
  const pick = {
    合法查询: rows.find((x) => x.tool === "lucy_query" && x.user_id === A && x.outcome !== "denied" && x.outcome !== "error"),
    协议请求: rows.find((x) => x.tool === "tools/list"),
    本地处理: rows.find((x) => x.tool === "wiki_search" || x.tool === "wiki_read"),
    门闩拒绝: rows.find((x) => x.decision_reason === "source_ambiguity_gate"),
    上游失败: rows.find((x) => x.tool === "lucy_query" && x.outcome === "error" && !String(x.decision_reason ?? "").startsWith("invalid_arguments"))
  };
  const detail = {};
  for (const [label, row] of Object.entries(pick)) {
    const spans = row ? q("SELECT span_id, stage, status, reason_code FROM access_trace_span WHERE trace_id = ? ORDER BY seq", [row.trace_id]) : [];
    detail[label] = spans.map((s) => `${s.stage}:${s.status}${s.reason_code ? `(${s.reason_code})` : ""}`);
    r.check(`${label}：trace_id 还原出阶段序列与结果`, Boolean(row) && spans.length >= 2 && Boolean(row.outcome), { outcome: row?.outcome, stages: detail[label] });
  }
  const pack = shared.exportE3 ?? shared.exportE1;
  if (pack) {
    const idx = pack.header.indexOf("trace_id");
    const spanIdx = pack.header.indexOf("span_id");
    for (const [label, row] of Object.entries(pick)) {
      if (!row) continue;
      const dbSpans = q("SELECT span_id FROM access_trace_span WHERE trace_id = ?", [row.trace_id]).map((x) => x.span_id).sort();
      const csvSpans = pack.spans.filter((x) => x[idx] === row.trace_id).map((x) => x[spanIdx]).sort();
      r.check(`${label}：导出 spans.csv 中同一 trace 的 span 与库一致`, JSON.stringify(dbSpans) === JSON.stringify(csvSpans), { db: dbSpans.length, csv: csvSpans.length });
    }
  } else r.gap("导出对照需先跑 TRC-05（all 模式一次跑完）");
  const sessionRow = rows.find((x) => x.lucy_session_id && x.tool === "lucy_query" && x.user_id === A);
  if (sessionRow) {
    const total = q("SELECT COUNT(*) AS n FROM access_log WHERE lucy_session_id = ?", [sessionRow.lucy_session_id])[0].n;
    const traces = q("SELECT COUNT(DISTINCT trace_id) AS n FROM access_log WHERE lucy_session_id = ?", [sessionRow.lucy_session_id])[0].n;
    r.check("按会话列出全部 trace：trace 数 = 流水行数", total === traces && total > 0, { rows: total, traces });
  }
  return r.done({ stageSequences: detail });
}

let ensured = false;
async function trc01Ensure() { if (!ensured) { await sendMixed(); shared.traces = rowsOfRun().map((x) => x.trace_id); ensured = true; } }

const cases = { trc01, trc02, trc03, trc04, trc05, trc06, trc10 };
const selected = which === "all" ? Object.keys(cases) : [which];
if (!selected.every((c) => cases[c])) { console.error(`usage: ${Object.keys(cases).join(" | ")} | all`); process.exit(2); }
const results = [];
for (const name of selected) {
  try { results.push(await cases[name]()); } catch (error) { results.push({ case: name, verdict: "ERROR", error: String(error?.stack ?? error).slice(0, 700) }); }
}
const text = JSON.stringify(results.length === 1 ? results[0] : results);
if (outFile) writeFileSync(outFile, `${text}\n`);
console.log(text);
process.exit(results.every((x) => x.verdict === "PASS" || x.verdict === "PASS WITH GAP") ? 0 : 1);
