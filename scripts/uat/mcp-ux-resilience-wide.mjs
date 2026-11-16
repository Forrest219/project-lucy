#!/usr/bin/env node
/**
 * P1-37 UAT（宽目录＋多身份沙箱）：握手并发、拒绝耗时、主路径对照。
 * 先 `node scripts/uat/uat-wide-sandbox.mjs up`。令牌从沙箱本机密钥目录读取，不打印。
 *
 *   node scripts/uat/mcp-ux-resilience-wide.mjs handshake [--levels 20,50,100,200] [--sequential 100]
 *   node scripts/uat/mcp-ux-resilience-wide.mjs deny [--n 100]
 *   node scripts/uat/mcp-ux-resilience-wide.mjs stages            # 取沙箱审计库里 initialize 的阶段 span 汇总
 *
 * 输出一行 JSON，便于直接写进 runs/。对应 UAT-MCPX-01（握手）、UAT-MCPX-07（拒绝快速返回，宽目录）、UAT-MCPX-03（阶段归因）。
 */
import { auditQuery, loadSandbox, makeClient, mapLimit, summarize } from "./lib/mcp-uat-lib.mjs";

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const { state, tokens } = loadSandbox();
const client = makeClient(state.proxy);
const agentIds = Object.keys(tokens);
const fullAgent = state.agents.find((a) => a.role === "uat_wide_full").id;
const noQueryAgent = state.agents.find((a) => a.role === "uat_wide_noquery").id;

async function handshake() {
  const levels = String(flag("levels", "20,50,100,200")).split(",").map(Number);
  const sequentialN = Number(flag("sequential", 100));
  const sequential = [];
  for (let i = 0; i < sequentialN; i += 1) {
    sequential.push((await client.rpc(tokens[agentIds[i % agentIds.length]], client.initBody(`seq-${i}`))).ms);
  }
  const bursts = {};
  for (const level of levels) {
    const jobs = Array.from({ length: level }, (_, i) => agentIds[i % agentIds.length]);
    const started = performance.now();
    const ms = await mapLimit(jobs, level, async (id, i) => (await client.rpc(tokens[id], client.initBody(`burst-${level}-${i}`))).ms);
    bursts[level] = { wallMs: Math.round(performance.now() - started), ...summarize(ms) };
  }
  console.log(JSON.stringify({ probe: "wide-handshake", sources: state.sources, agents: agentIds.length, sequential: summarize(sequential), bursts }));
}

async function deny() {
  const n = Number(flag("n", 100));
  const shapes = {
    unknown_tool: { agent: fullAgent, name: "lucy_frobnicate", args: () => ({}) },
    missing_measures: { agent: fullAgent, name: "lucy_query", args: () => ({ connectionId: state.connection, dimensions: [{ field: "t_0001.status" }] }) },
    acl_tool_denied: { agent: noQueryAgent, name: "lucy_query", args: (i) => ({ connectionId: state.connection, measures: ["t_0001.row_count"], limit: i + 1 }) },
    gate_unresolved_ref: { agent: fullAgent, name: "lucy_query", args: (i) => ({ connectionId: state.connection, measures: ["t_0001.row_count"], filters: [`ghost_source_${i}.x = 1`] }) }
  };
  const out = {};
  for (const [label, shape] of Object.entries(shapes)) {
    const token = tokens[shape.agent];
    const { session } = await client.open(token);
    const samples = [];
    const reasons = new Map();
    for (let i = 0; i < n; i += 1) {
      const r = await client.callTool(token, session, `${label}-${i}`, shape.name, shape.args(i));
      samples.push(r.ms);
      const key = r.text.slice(0, 60);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    out[label] = { ...summarize(samples), sampleResponses: [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2) };
  }
  console.log(JSON.stringify({ probe: "wide-deny", sources: state.sources, ...out }));
}

function stages() {
  const rows = auditQuery(state.container,
    `SELECT s.stage AS stage, COUNT(*) AS n, ROUND(AVG(s.duration_ms),1) AS avg_ms, MAX(s.duration_ms) AS max_ms
       FROM access_trace_span s WHERE s.access_log_id IN (SELECT id FROM access_log WHERE tool = 'initialize')
      GROUP BY s.stage ORDER BY avg_ms DESC`);
  console.log(JSON.stringify({ probe: "initialize-stages", rows }));
}

const modes = { handshake, deny, stages };
if (!modes[mode]) { console.error(`usage: ${Object.keys(modes).join(" | ")}`); process.exit(2); }
await modes[mode]();
