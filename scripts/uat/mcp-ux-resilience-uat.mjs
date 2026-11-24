#!/usr/bin/env node
/**
 * P1-37 UAT 用例运行器（宽目录＋多身份沙箱，全真：真实 MCP 客户端调用、真实管理 API、真实重启 KTX）。
 *
 *   node scripts/uat/uat-wide-sandbox.mjs up            # 先造沙箱
 *   node scripts/uat/mcp-ux-resilience-uat.mjs <case> [--out file]
 *
 * 用例：mcpx01 mcpx02 mcpx04 mcpx05 mcpx06 mcpx07 mcpx08 mcpx12（以及 all）
 * 每个用例输出一行 JSON：{ case, verdict, checks:[{name,pass,detail}], gaps:[...] }。
 * verdict：PASS／FAIL／PASS WITH GAP（有显式缺口且其余通过）。令牌只在内存里用，不打印。
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  adminSession, auditQuery, healthPolicyVersion, killKtx, loadSandbox, makeClient, mapLimit, sleep, summarize
} from "./lib/mcp-uat-lib.mjs";
import { computeMetrics } from "./lib/mcp-ux-metrics.mjs";

const args = process.argv.slice(2);
const which = args[0];
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;

const { state, tokens } = loadSandbox();
const client = makeClient(state.proxy);
const byRole = (role) => state.agents.filter((a) => a.role === role).map((a) => a.id);
const FULL = byRole("uat_wide_full");           // uat_a01, a04, ...
const NOQUERY = byRole("uat_wide_noquery");     // uat_a02, a05, ...
const HALF = byRole("uat_wide_half");           // uat_a03, a06, ...
const A = FULL[0];
const B = FULL[1];
const N = NOQUERY[0];
const RUN = Date.now().toString(36);
const HINT = "Do not retry it unchanged";

function makeReport(name) {
  const checks = [];
  const gaps = [];
  return {
    check(label, pass, detail) { checks.push({ name: label, pass: Boolean(pass), detail }); return Boolean(pass); },
    gap(text) { gaps.push(text); },
    done(extra = {}) {
      const failed = checks.filter((c) => !c.pass);
      const verdict = failed.length > 0 ? "FAIL" : gaps.length > 0 ? "PASS WITH GAP" : "PASS";
      return { case: name, verdict, checks, gaps, ...extra };
    }
  };
}

const gateDenyArgs = (tag) => ({ connectionId: state.connection, measures: [{ expr: "COUNT(t_0001.id)", name: "n" }], filters: [`ghost_${RUN}_${tag}.x = 1`] });
const legalArgs = { connectionId: state.connection, measures: [{ expr: "COUNT(t_0001.id)", name: "n" }] };
const sinceId = () => auditQuery(state.container, "SELECT COALESCE(MAX(id),0) AS id FROM access_log")[0].id;

// ───────────────────────── MCPX-01 ─────────────────────────
async function mcpx01() {
  const r = makeReport("UAT-MCPX-01");
  const ids = Object.keys(tokens);
  const marker = sinceId();
  const sequential = [];
  for (let i = 0; i < 200; i += 1) sequential.push((await client.rpc(tokens[ids[i % ids.length]], client.initBody(`m1-seq-${i}`))).ms);
  const burst = await mapLimit(Array.from({ length: 20 }), 20, async (_, i) => (await client.rpc(tokens[ids[i % ids.length]], client.initBody(`m1-burst-${i}`))).ms);
  const seqS = summarize(sequential);
  const burstS = summarize(burst);
  r.check("顺序 200：P50 ≤ 200 ms 且 P99 ≤ 2 s 且 0 次 > 30 s", seqS.p50 <= 200 && seqS.p99 <= 2000 && seqS.over30s === 0, seqS);
  r.check("20 并发：P50 ≤ 200 ms 且 P99 ≤ 2 s 且 0 次 > 30 s", burstS.p50 <= 200 && burstS.p99 <= 2000 && burstS.over30s === 0, burstS);
  const rows = auditQuery(state.container, "SELECT duration_ms FROM access_log WHERE tool='initialize' AND id > ?", [marker]).map((x) => x.duration_ms);
  r.check("流水里 initialize 行数 = 发送数 220", rows.length === 220, { rows: rows.length });
  return r.done({ sequential: seqS, burst20: burstS, auditSide: summarize(rows) });
}

// ───────────────────────── MCPX-02 ─────────────────────────
async function mcpx02() {
  const r = makeReport("UAT-MCPX-02");
  const admin = await adminSession(state);
  const target = FULL[2]; // 用于无害变更
  const ids = Object.keys(tokens);
  const pv0 = await healthPolicyVersion(state);
  const windows = [];
  for (let k = 0; k < 3; k += 1) {
    const handshakes = mapLimit(Array.from({ length: 20 }), 20, async (_, i) => (await client.rpc(tokens[ids[i % ids.length]], client.initBody(`m2-${k}-${i}`))).ms);
    await sleep(30);
    const patch = await admin.api("PATCH", `/api/admin/agents/${target}`, { dryRun: false, patch: { note: `uat-mcpx02-${RUN}-${k}` } });
    const ms = await handshakes;
    windows.push({ patchStatus: patch.status, ...summarize(ms) });
  }
  r.check("3 次变更均成功", windows.every((w) => w.patchStatus === 200), windows.map((w) => w.patchStatus));
  r.check("每个变更窗口并发 20 握手 P99 ≤ 5 s 且 0 次 > 30 s", windows.every((w) => w.p99 <= 5000 && w.over30s === 0), windows);
  const pv1 = await healthPolicyVersion(state);
  r.check("policy_version 确实变化", pv0 !== pv1, { changed: pv0 !== pv1 });

  // 权限负向①：不同权限身份的 instructions 不串
  const textOf = async (id) => (await client.rpc(tokens[id], client.initBody("m2-text"))).json?.result?.instructions ?? "";
  const [tA, tHalf, tNoQ] = [await textOf(A), await textOf(HALF[0]), await textOf(N)];
  const lowName = "t_0001";
  const highName = "t_0300"; // half 角色只含前一半
  r.check("A（全量角色）含低位与高位 Source", tA.includes(lowName) && tA.includes(highName), { aLen: tA.length });
  r.check("half 身份含低位、不含高位 Source", tHalf.includes(lowName) && !tHalf.includes(highName), { halfLen: tHalf.length });
  r.check("Visible Scope 不同的身份，instructions 不相同（A vs half）", tA !== tHalf, { a: tA.length, half: tHalf.length });
  // instructions 只含 Visible Scope（工具清单由 tools/list 返回）：Visible Scope 相同的 A 与 noquery 文本相同属预期，工具差异看 tools/list。
  const toolsOf = async (id) => (await client.toolNames(tokens[id], (await client.open(tokens[id])).session)).sort();
  const [toolsA, toolsNoQ] = [await toolsOf(A), await toolsOf(N)];
  r.check("同 Visible Scope、不同工具权限：instructions 相同，tools/list 不同且各自合规（A 含 lucy_query、noquery 不含）",
    tA === tNoQ && toolsA.includes("lucy_query") && !toolsNoQ.includes("lucy_query"), { a: toolsA.length, noquery: toolsNoQ.length });

  // 权限负向②(b)：A 真实收窄后新握手不含被收回 Source
  const narrow = await admin.api("PATCH", `/api/admin/agents/${A}`, { dryRun: false, patch: { roles: ["uat_wide_half"] } });
  r.check("收窄变更成功", narrow.status === 200, { status: narrow.status });
  const after = await mapLimit(Array.from({ length: 20 }), 20, async () => (await client.rpc(tokens[A], client.initBody("m2-narrow"))).json?.result?.instructions ?? "");
  r.check("收窄后 20 次新握手均不含被收回 Source", after.every((t) => !t.includes(highName) && t.includes(lowName)), { leaks: after.filter((t) => t.includes(highName)).length });
  const lateList = await client.open(tokens[A]);
  const tools = await client.toolNames(tokens[A], lateList.session);
  r.check("收窄后 tools/list 仍可用（主路径不退化）", tools.length > 0, { tools: tools.length });
  const restore = await admin.api("PATCH", `/api/admin/agents/${A}`, { dryRun: false, patch: { roles: ["uat_wide_full"] } });
  const restored = await textOf(A);
  r.check("还原后 A 重新看到高位 Source", restore.status === 200 && restored.includes(highName), { status: restore.status });
  await admin.api("PATCH", `/api/admin/agents/${target}`, { dryRun: false, patch: { note: "" } });

  r.gap("(a) 撤权保密构建中跨 commit、(c) 旧构建不写入新代、5b skills 失效三类、6 命中读取计数：仅适用于「instructions 缓存」方案；U1 取证后采用的是「描述索引按文件指纹缓存」（命中时不读内容；任何文件变化下一次调用即生效；无跨身份共享、无陈旧窗口），本方案不存在这些状态，故不适用（非未做）。对应保证由 vitest source-descriptions-index-cache 覆盖");
  r.gap("同角色集合、B 另有 Agent overlay／capability 差异：本沙箱以不同角色（full／half／noquery）造差异；未另造 overlay 变体——instructions 逐身份现算，无按角色合并的缓存键，串号路径不存在");
  return r.done({ policyVersionBefore: pv0?.slice(0, 12), policyVersionAfter: pv1?.slice(0, 12), windows });
}

// ───────────────────────── MCPX-04 ─────────────────────────
function listedNames(text) {
  const m = text.match(/use one of: ([^.]*)\./);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : null;
}
async function mcpx04() {
  const r = makeReport("UAT-MCPX-04");
  const marker = sinceId();
  const identities = { A, N };
  const lists = {};
  for (const [label, id] of Object.entries(identities)) {
    const { session } = await client.open(tokens[id]);
    const real = (await client.toolNames(tokens[id], session)).sort();
    const probes = [];
    for (const name of ["lucy_bind_source", "lucy_confirm_source"]) {
      for (const [shape, a] of [["no_args", {}], ["legal_args", { connectionId: state.connection, sourceName: "t_0001" }]]) {
        const res = await client.callTool(tokens[id], session, `m4-${label}-${name}-${shape}`, name, a);
        probes.push({ name, shape, text: res.text, names: listedNames(res.text) });
      }
    }
    lists[label] = { real, probes };
    r.check(`${label}：4 次调用均为 tool_unclassified 且无 invalid_arguments`, probes.every((p) => p.text.includes(`tool_unclassified:${p.name}`) && !/invalid_arguments/i.test(p.text)), probes.map((p) => p.text.slice(0, 60)));
    const sets = probes.map((p) => (p.names ?? []).slice().sort());
    r.check(`${label}：拒绝清单 = 该身份真实 tools/list`, sets.every((s) => JSON.stringify(s) === JSON.stringify(real)), { listed: sets[0]?.length, real: real.length });
    r.check(`${label}：含「请勿猜测工具名」`, probes.every((p) => /Do not guess tool names/.test(p.text)), null);
    const control = await client.callTool(tokens[id], session, `m4-${label}-ctl`, "lucy_catalog", {});
    r.check(`${label}：对照 lucy_catalog 成功`, !control.isError, { ms: Math.round(control.ms) });
  }
  r.check("A、N 清单不同（双身份差分）", JSON.stringify(lists.A.real) !== JSON.stringify(lists.N.real), { a: lists.A.real.length, n: lists.N.real.length });
  const negatives = ["sl_query", "sl_read_source", "sql_execution", "sql_dialect_notes", "memory_ingest", "memory_ingest_status",
    "lucy_ops_connection_tables", "lucy_ops_source_import", "lucy_ops_concept_set_canonical", "lucy_ops_concept_reject"]; // 代码基线 ABSOLUTE_DENY_TOOLS＋未授权控制面（沙箱角色无 allow.ops）
  const absolute = lists.A.probes.flatMap((p) => p.names ?? []);
  r.check("清单不含已知 absolute-deny／控制面负样本", negatives.every((n) => !absolute.includes(n)), { negatives });
  const rows = auditQuery(state.container, "SELECT decision_reason, error_category FROM access_log WHERE id > ? AND tool IN ('lucy_bind_source','lucy_confirm_source')", [marker]);
  r.check("流水 decision_reason 均为 tool_unclassified:*", rows.length === 8 && rows.every((x) => String(x.decision_reason).startsWith("tool_unclassified:")), { rows: rows.length });
  return r.done();
}

// ───────────────────────── MCPX-05 ─────────────────────────
async function mcpx05() {
  const r = makeReport("UAT-MCPX-05");
  const marker = sinceId();
  const { session } = await client.open(tokens[A]);
  const t = tokens[A];
  const illegal = {
    missing_measures_only_connection: { connectionId: state.connection },
    empty_measures_no_other_elements: { connectionId: state.connection, measures: [] }
  };
  for (const [label, a] of Object.entries(illegal)) {
    const res = await client.callTool(t, session, `m5-${label}`, "lucy_query", a);
    r.check(`非法形状 ${label}：代理侧 client_schema_failure 式拒绝、含示例、不含 sl_query`,
      res.isError && /measures/.test(res.text) && !/sl_query/.test(res.text) && /(example|示例|e\.g\.|\{)/i.test(res.text), res.text.slice(0, 160));
  }
  const rows = auditQuery(state.container, "SELECT error_category, decision_reason FROM access_log WHERE id > ? AND tool='lucy_query' ORDER BY id", [marker]);
  r.check("流水 error_category = client_schema_failure（非 upstream_failed）", rows.length === 2 && rows.every((x) => x.error_category === "client_schema_failure"), rows);
  const legal = {
    measures_plus_dimensions: { ...legalArgs, dimensions: [{ field: "t_0001.status" }] },
    measures_plus_filters: { ...legalArgs, filters: ["t_0001.status = 'open'"] },
    measures_plus_order_limit: { ...legalArgs, dimensions: [{ field: "t_0001.status" }], order_by: [{ field: "t_0001.status", direction: "asc" }], limit: 5 }
  };
  for (const [label, a] of Object.entries(legal)) {
    const res = await client.callTool(t, session, `m5-legal-${label}`, "lucy_query", a);
    r.check(`合法形状 ${label}：成交（未被新校验拦截）`, !res.isError && /answer_verifiability|rows|data/.test(res.text), res.text.slice(0, 120));
  }
  r.gap("合法形状「仅 segments＋measures」「sourceName＋query／SQL 形式」未测：沙箱 Source 未定义 segment；SQL 形式不属 lucy_query 合同形状（以 Plan 步骤 0 清单为准）");
  return r.done();
}

// ───────────────────────── MCPX-06 ─────────────────────────
async function ensureLruAgents(admin, count) {
  const ids = [];
  const tokenMap = {};
  const expires = new Date(Date.now() + 7 * 86_400_000).toISOString();
  for (let i = 1; i <= count; i += 1) {
    const id = `uat_lru_${String(i).padStart(2, "0")}`;
    ids.push(id);
    const created = await admin.api("POST", "/api/admin/agents", { dryRun: false, agent: { id, name: `UAT LRU ${i}`, roles: ["uat_wide_full"] } });
    if (created.status >= 300 && created.json?.error?.code !== "AGENT_EXISTS" && created.json?.error?.code !== "DUPLICATE_AGENT") {
      // 已存在则读不到明文令牌；直接重新签发
    }
    const issued = await admin.api("POST", `/api/admin/agents/${id}/tokens`, { label: `lru${RUN}`, expires_at: expires, dryRun: false });
    const plaintext = issued.json?.data?.token ?? issued.json?.data?.plaintext;
    if (typeof plaintext !== "string") throw new Error(`no token for ${id}: ${issued.status}`);
    tokenMap[id] = plaintext;
  }
  return { ids, tokenMap };
}

async function unknownProbe(token, session, name) {
  const res = await client.callTool(token, session, `lru-${name}`, name, {});
  return { hinted: res.text.includes(HINT), text: res.text };
}

async function mcpx06() {
  const r = makeReport("UAT-MCPX-06");
  const admin = await adminSession(state);
  const marker = sinceId();
  const tA = tokens[A];
  const { session: sA } = await client.open(tA);
  const deny = (token, session, tag, args) => client.callTool(token, session, `m6-${tag}`, "lucy_query", args ?? gateDenyArgs(tag));

  // 1–2 重复提示
  const first = await deny(tA, sA, "base");
  r.check("第 1 次被拒（硬门闩）：无『请勿原样重试』", first.isError && !first.text.includes(HINT), first.text.slice(0, 100));
  const second = await deny(tA, sA, "base");
  r.check("第 2 次原样重提：含『请勿原样重试』", second.text.includes(HINT), second.text.slice(-160));

  // 7 指纹边界：换键序／别名／过滤形态相同，改一个值不同
  const reordered = { filters: [`ghost_${RUN}_base.x = 1`], measures: [{ name: "n", expr: "COUNT(t_0001.id)" }], connectionId: state.connection };
  const reorderedRes = await deny(tA, sA, "base-reordered", reordered);
  r.check("⑤ 换键序＋换内部键序：指纹相同、仍提示", reorderedRes.text.includes(HINT), reorderedRes.text.slice(-120));
  const valueChanged = await deny(tA, sA, "base-valuechanged", { ...gateDenyArgs("base"), filters: [`ghost_${RUN}_base.x = 2`] });
  r.check("⑤ 仅改一个过滤值：指纹不同、不提示", valueChanged.isError && !valueChanged.text.includes(HINT), valueChanged.text.slice(-120));
  // Spec 口径：`filters` 以「序列化 JSON 串」传入时先还原再取指纹；{field,op,value} 对象与 `x = 1` 表达式串是两种写法，不在归一范围
  const serializedFilter = await deny(tA, sA, "base-serialized", { ...gateDenyArgs("base"), filters: JSON.stringify(gateDenyArgs("base").filters) });
  r.check("⑤ filters 以序列化 JSON 串传入：还原后指纹相同、仍提示", serializedFilter.text.includes(HINT), serializedFilter.text.slice(-120));

  // 4 跨身份
  const tB = tokens[B];
  const bRes = await client.callTool(tB, undefined, "m6-b-default", "lucy_query", gateDenyArgs("base"));
  r.check("② 身份 B 默认会话提交同样请求：不暗示『相同请求刚被拒绝』", bRes.isError && !bRes.text.includes(HINT), bRes.text.slice(-120));

  // 3 策略变化
  const pv = await healthPolicyVersion(state);
  await admin.api("PATCH", `/api/admin/agents/${FULL[2]}`, { dryRun: false, patch: { note: `uat-mcpx06-${RUN}` } });
  const pv2 = await healthPolicyVersion(state);
  const afterPolicy = await deny(tA, sA, "base");
  r.check("① 策略变化后原样重提：不再提示", pv !== pv2 && afterPolicy.isError && !afterPolicy.text.includes(HINT), { policyChanged: pv !== pv2, tail: afterPolicy.text.slice(-100) });
  const againAfterPolicy = await deny(tA, sA, "base");
  r.check("① 新策略下再次原样重提：重新开始提示", againAfterPolicy.text.includes(HINT), againAfterPolicy.text.slice(-100));
  await admin.api("PATCH", `/api/admin/agents/${FULL[2]}`, { dryRun: false, patch: { note: "" } });

  // 对照：钉选后合法成交
  const pinned = await client.callTool(tA, sA, "m6-pinned", "lucy_query", legalArgs);
  r.check("对照：钉选唯一来源后合法查询成交", !pinned.isError && /answer_verifiability/.test(pinned.text), pinned.text.slice(0, 100));

  // 6 LRU（用未知工具名造廉价、互不相同的被拒请求；LRU 在追踪器层，与拒绝类型无关）
  const { ids, tokenMap } = await ensureLruAgents(admin, 17);
  const sessions = {};
  for (const id of ids) sessions[id] = (await client.open(tokenMap[id])).session;
  const probe = (id, name) => unknownProbe(tokenMap[id], sessions[id], name);

  // 6a 单身份 65 个键
  const id1 = ids[0];
  const names1 = Array.from({ length: 65 }, (_, k) => `uat_lru_${RUN}_a_${k}`);
  for (const n of names1) await probe(id1, n);
  const idB = ids[1];
  const bFirst = `uat_lru_${RUN}_b_0`;
  await probe(idB, bFirst);
  const lastKey = await probe(id1, names1[64]);
  r.check("④ 单身份 65 个键后：第 65 个仍命中", lastKey.hinted, null);
  const firstKey = await probe(id1, names1[0]);
  r.check("④ 单身份 65 个键后：第 1 个已被淘汰（不提示）", !firstKey.hinted, null);
  for (let k = 0; k < 64; k += 1) await probe(id1, `uat_lru_${RUN}_a2_${k}`); // 身份 A 再造一批，继续淘汰 A 自己的键
  const bStill = await probe(idB, bFirst);
  r.check("④ 身份 A 的淘汰不影响身份 B 的键", bStill.hinted, null);

  // 6b 全局：等 TTL 清空，再让 16 个身份各填 64 个键，第 17 个身份触发全局淘汰
  await sleep(61_000);
  const stamp = `${RUN}g`;
  const sendMany = (id, count, tag) => mapLimit(Array.from({ length: count }, (_, k) => k), 1, async (k) => probe(id, `uat_lru_${stamp}_${tag}_${k}`));
  const startedAt = Date.now();
  for (let i = 0; i < 16; i += 1) await sendMany(ids[i], 64, `i${i}`);
  await sendMany(ids[16], 1, "i16");
  const elapsed = Date.now() - startedAt;
  const oldest = await probe(ids[0], `uat_lru_${stamp}_i0_0`);
  const recentSameId = await probe(ids[15], `uat_lru_${stamp}_i15_63`);
  const lastOfNew = await probe(ids[16], `uat_lru_${stamp}_i16_0`);
  r.check(`④ 全局（16×64+1=1025 键，耗时 ${Math.round(elapsed / 1000)} s < 60 s，排除 TTL 干扰）`, elapsed < 60_000, { elapsedMs: elapsed });
  r.check("④ 全局：最久未用的键（身份 1 第 1 个）被淘汰", !oldest.hinted, null);
  r.check("④ 全局：最近的键仍命中", recentSameId.hinted && lastOfNew.hinted, null);

  // 5 TTL（行为）
  await sleep(61_000);
  const afterTtl = await probe(ids[15], `uat_lru_${stamp}_i15_63`);
  r.check("③ 间隔 > 60 s 后重提：无提示", !afterTtl.hinted, null);
  r.gap("⑤ 补充观察：filters 的 {field,op,value} 对象与 `x = 1` 表达式串被视为不同请求（不归一）；Spec 只要求『序列化 JSON 串还原』，故按此口径判定，非缺陷但应在文档里写明");
  r.gap("③ 内存项消失的『只读状态计数入口』未提供（Spec 要求读该入口确认）：TTL／LRU 内部状态由 vitest RepeatRejectionTracker 单元测试覆盖，这里只证行为");

  // 7b 指纹不可反推 + 密钥不入库
  const fpRows = auditQuery(state.container, "SELECT rejection_fingerprint AS fp, args_summary FROM access_log WHERE id > ? AND rejection_fingerprint IS NOT NULL ORDER BY id LIMIT 6", [marker]);
  const { createHash } = await import("node:crypto");
  const canonicalCandidates = [
    JSON.stringify(gateDenyArgs("base")),
    JSON.stringify(Object.fromEntries(Object.entries(gateDenyArgs("base")).sort(([a], [b]) => a.localeCompare(b)))),
    JSON.stringify({ args: gateDenyArgs("base") })
  ];
  const publicHashes = canonicalCandidates.map((c) => createHash("sha256").update(c).digest("hex"));
  const noLeak = fpRows.every((row) => {
    const seg = String(row.fp).replace(/^rf\d+:/, "");
    return seg.length === 16 && publicHashes.every((h) => !h.startsWith(seg));
  });
  r.check("7b 审计列哈希段不等于任何无密钥 SHA-256 前缀（3 种常见序列化）", fpRows.length > 0 && noLeak, { sampled: fpRows.length });
  const keyLeak = scanKeyMaterial();
  r.check("7b 审计库文件中找不到 HMAC 密钥材料", keyLeak.keyPresent && keyLeak.scanOk && !keyLeak.foundInAudit, keyLeak);
  r.gap("7b 导出包中找不到密钥材料：导出包扫描在 UAT-MCPX-12／TRC 导出用例里与导出同批执行；此处仅查审计库");

  // 8 M3
  const metrics = computeMetrics(auditQuery(state.container, "SELECT * FROM access_log WHERE id > ? AND user_id = ? ORDER BY id", [marker, A]));
  r.check("8 M3 可由 rejection_fingerprint 算出（分母 > 0）", metrics.M3.rejected > 0 && metrics.M3.repeated > 0, metrics.M3);
  return r.done({ lruElapsedMs: elapsed, M3: metrics.M3 });
}

function scanKeyMaterial() {
  const keyFile = "/data/lucy/.ktx-ui/rejection-fingerprint.key";
  const sh = (script) => spawnSync("docker", ["exec", state.container, "sh", "-c", script], { encoding: "utf8" });
  const present = sh(`test -s ${keyFile}`).status === 0;
  if (!present) return { keyPresent: false, scanOk: false, foundInAudit: false };
  // grep -f 读取密钥文件作为模式，密钥不进命令行也不打印；-a 按文本扫描二进制库文件。
  // 退出码：0＝发现、1＝干净、≥2（路径不存在／权限错等）＝扫描没有跑成，不得当作「干净」。
  const status = sh(`grep -a -q -F -f ${keyFile} /data/lucy/.ktx-ui/audit.sqlite*`).status;
  return { keyPresent: true, scanOk: status === 0 || status === 1, foundInAudit: status === 0 };
}

// ───────────────────────── MCPX-07 ─────────────────────────
async function mcpx07() {
  const r = makeReport("UAT-MCPX-07");
  const marker = sinceId();
  const { session } = await client.open(tokens[A]);
  const samples = [];
  for (let i = 0; i < 100; i += 1) {
    const res = await client.callTool(tokens[A], session, `m7-${i}`, "lucy_query", gateDenyArgs(`d${i}`));
    if (!res.isError) throw new Error("gate denial expected");
    samples.push(res.ms);
  }
  const s = summarize(samples);
  r.check(`100 次门闩拒绝（${state.sources} 个可见 Source）：P95 ≤ 500 ms 且 P99 ≤ 2 s`, s.p95 <= 500 && s.p99 <= 2000, s);
  const pinned = await client.callTool(tokens[A], session, "m7-pinned", "lucy_query", legalArgs);
  r.check("同一部署下钉选唯一来源的合法查询成交，非 source_ambiguity_gate", !pinned.isError && !/source_ambiguity_gate/.test(pinned.text), { ms: Math.round(pinned.ms), head: pinned.text.slice(0, 80) });
  const audited = auditQuery(state.container, "SELECT duration_ms FROM access_log WHERE id > ? AND tool='lucy_query' AND outcome='denied'", [marker]).map((x) => x.duration_ms);
  r.check("流水侧（M2 口径）与客户端侧一致：100 行", audited.length === 100, { rows: audited.length, ...summarize(audited) });
  return r.done({ clientSide: s, auditSide: summarize(audited), pinnedMs: Math.round(pinned.ms) });
}

// ───────────────────────── MCPX-08 ─────────────────────────
async function waitKtxReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      // 就绪探测必须用另一个身份：用 A 会顺手刷新 A 的上游会话，被测的旧会话就不再失效了
      const probe = await client.rpc(tokens[FULL[5]], client.initBody("m8-ready"));
      if (probe.status === 200 && probe.session && !probe.json?.error) return i;
    } catch { /* 还在重启 */ }
    await sleep(1000);
  }
  throw new Error("KTX did not become ready");
}
async function mcpx08() {
  const r = makeReport("UAT-MCPX-08");
  const calls = {
    lucy_query: ["lucy_query", legalArgs],
    wiki_search: ["wiki_search", { query: "指标" }],
    lucy_read_source: ["lucy_read_source", { connectionId: state.connection, sourceName: "t_0001" }],
    ping: ["ping", null]
  };
  const rows = [];
  for (const [label, [name, a]] of Object.entries(calls)) {
    const { session } = await client.open(tokens[A]);
    const before = name === "ping"
      ? await client.rpc(tokens[A], { jsonrpc: "2.0", id: `m8-${label}-pre`, method: "ping" }, session)
      : await client.callTool(tokens[A], session, `m8-${label}-pre`, name, a);
    const marker = sinceId();
    const pid = killKtx(state.container);
    await waitKtxReady();
    const requestId = `m8-${label}-post-${RUN}`;
    const res = name === "ping"
      ? await client.rpc(tokens[A], { jsonrpc: "2.0", id: requestId, method: "ping" }, session)
      : await client.callTool(tokens[A], session, requestId, name, a);
    const ok = name === "ping" ? res.status === 200 && !res.json?.error : !res.isError && res.status === 200;
    const logRows = auditQuery(state.container, "SELECT id, trace_id, tool, decision_reason, outcome FROM access_log WHERE id > ? AND user_id = ? ORDER BY id", [marker, A])
      .filter((x) => x.tool === name || (name === "ping" && x.tool === "ping"));
    const spansOf = (traceId) => auditQuery(state.container, "SELECT stage, status, reason_code FROM access_trace_span WHERE trace_id = ?", [traceId]);
    const withSpans = logRows.map((row) => ({ row, spans: spansOf(row.trace_id) }));
    const hit = withSpans.find((x) => x.spans.some((sp) => sp.stage === "session_recover" && sp.status === "ok"));
    const recovered = hit?.row;
    const spans = hit?.spans ?? [];
    const upstream = spans.filter((sp) => sp.stage === "upstream_call" || sp.stage === "upstream_handshake").length;
    rows.push({ label, killedPid: pid, preOk: !before.isError, ok, recovered: Boolean(recovered), upstreamSpans: upstream, spanStages: spans.map((sp) => sp.stage) });
    r.check(`${label}：原会话上 KTX 重启后无感拿到结果（原会话前置可用）`, !before.isError && ok, { ms: Math.round(res.ms), text: (res.text ?? "").slice(0, 80) });
    r.check(`${label}：审计有 session_recover（span 状态 ok，reason upstream_session_recovered）`, Boolean(recovered), withSpans.map((x) => x.spans.map((sp) => `${sp.stage}:${sp.status}`)));
    r.check(`${label}：本请求上游相关 span ≤ 4（原请求＋握手＋重试）`, upstream > 0 && upstream <= 4, { upstream, stages: spans.map((sp) => sp.stage) });
  }
  r.gap("会话失效形态只覆盖『真实重启 KTX 后旧会话号的实际响应』这一种（O6 取证确认的形态）；未造 400 initialize-required 与其他形态的独立夹具");
  r.gap("上游调用数以 P1-36 阶段 span（upstream_call／upstream_handshake）计，非 KTX 子进程请求日志计数");
  return r.done({ rows });
}

// ───────────────────────── MCPX-12 ─────────────────────────
async function mcpx12() {
  const r = makeReport("UAT-MCPX-12");
  const id = FULL[4];
  const t = tokens[id];
  const marker = sinceId();
  const sent = { initialize: 0, unknownTool: 0, invalidShape: 0, gateDenied: 0, expectedRepeats: 0, legal: 0 };
  for (let i = 0; i < 5; i += 1) { await client.rpc(t, client.initBody(`m12-init-${i}`)); sent.initialize += 1; }
  const { session } = await client.open(t); sent.initialize += 1;
  for (let i = 0; i < 3; i += 1) { await client.callTool(t, session, `m12-unk-${i}`, "lucy_bind_source", {}); sent.unknownTool += 1; }
  for (let i = 0; i < 4; i += 1) { await client.callTool(t, session, `m12-bad-${i}`, "lucy_query", { connectionId: state.connection }); sent.invalidShape += 1; }
  // M3：P、P 原样、P 换键序（均重复）、Q 仅改值（不重复）、Q 原样（重复）
  const P = gateDenyArgs("m12p");
  const Q = { ...P, filters: [`ghost_${RUN}_m12p.x = 2`] };
  const reordered = { filters: P.filters, measures: P.measures, connectionId: P.connectionId };
  for (const [args2, repeat] of [[P, false], [P, true], [reordered, true], [Q, false], [Q, true]]) {
    await client.callTool(t, session, `m12-gate-${sent.gateDenied}`, "lucy_query", args2);
    sent.gateDenied += 1;
    if (repeat) sent.expectedRepeats += 1;
  }
  for (let i = 0; i < 3; i += 1) { await client.callTool(t, session, `m12-ok-${i}`, "lucy_query", legalArgs); sent.legal += 1; }
  const rows = auditQuery(state.container, "SELECT * FROM access_log WHERE id > ? AND user_id = ? ORDER BY id", [marker, id]);
  const m = computeMetrics(rows);
  r.check("M1：initialize 条数 = 发送数", m.M1.n === sent.initialize, { got: m.M1.n, sent: sent.initialize });
  r.check("M4：未知工具条数 = 发送数", m.M4.count === sent.unknownTool, { got: m.M4.count, sent: sent.unknownTool });
  r.check("M6：入参错误条数 = 发送数（均为 client_schema_failure）", m.M6.clientSchemaFailure === sent.invalidShape, m.M6);
  const expectedRejected = sent.unknownTool + sent.invalidShape + sent.gateDenied; // 三类被拒都带指纹
  r.check("M3 分母：带指纹的被拒总数 = 未知工具＋非法形状＋门闩拒绝", m.M3.rejected === expectedRejected, { got: m.M3.rejected, expectedRejected });
  const expectedRepeats = sent.expectedRepeats + (sent.unknownTool - 1) + (sent.invalidShape - 1); // 同一入参的后续提交也算重复
  r.check("M3 分子：重复数 = 已知重复数（键序变化计入、仅改值不计入）", m.M3.repeated === expectedRepeats, { got: m.M3.repeated, expectedRepeats });
  r.check("M2：被拒请求延迟分位可算且 P95 ≤ 500 ms", m.M2.n >= expectedRejected && m.M2.p95 <= 500, m.M2);
  r.check("M5：本批无会话类失败（计数为 0）", m.M5.sessionLost === 0, m.M5);
  return r.done({ sent, metrics: m });
}

const cases = { mcpx01, mcpx02, mcpx04, mcpx05, mcpx06, mcpx07, mcpx08, mcpx12 };
const selected = which === "all" ? Object.keys(cases) : [which];
if (!selected.every((c) => cases[c])) { console.error(`usage: ${Object.keys(cases).join(" | ")} | all`); process.exit(2); }
const results = [];
for (const name of selected) {
  try { results.push(await cases[name]()); }
  catch (error) { results.push({ case: name, verdict: "ERROR", error: String(error?.stack ?? error).slice(0, 600) }); }
}
const text = JSON.stringify(results.length === 1 ? results[0] : results);
if (outFile) writeFileSync(outFile, `${text}\n`);
console.log(text);
process.exit(results.every((x) => x.verdict === "PASS" || x.verdict === "PASS WITH GAP") ? 0 : 1);
