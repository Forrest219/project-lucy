#!/usr/bin/env node
/**
 * P1-37 UAT 夹具：MCP 握手／拒绝延迟探针（只读，针对本机 demo Docker）。
 *
 * 用法：
 *   LUCY_MCP_TOKEN=<bearer> node scripts/uat/mcp-ux-resilience-probe.mjs handshake [--n 200] [--concurrency 20]
 *   LUCY_MCP_TOKEN=<bearer> node scripts/uat/mcp-ux-resilience-probe.mjs deny [--n 100]
 *   LUCY_MCP_TOKEN=<bearer> node scripts/uat/mcp-ux-resilience-probe.mjs stale-session
 *
 * 环境：LUCY_MCP_URL（默认 http://127.0.0.1:57881/mcp）。令牌只读环境变量，不打印、不落盘。
 * 输出：一行 JSON（便于写进跑次文件）。
 *   handshake    — N 次顺序 initialize＋20 并发 initialize 的 P50/P95/P99/max 与 >30 s 次数（M1，SC-01）。
 *   deny         — 未知工具名与缺 measures 的拒绝请求延迟（M2，SC-11 的无大目录部分）。
 *   stale-session — 用一个伪造的失效会话号发 ping／tools/list，确认代理恢复而非把 404 透给客户端（SC-07 的最小形态；
 *                   真实重启 KTX 的形态见 docs/reviews 取证报告）。
 */
const URL_BASE = process.env.LUCY_MCP_URL ?? "http://127.0.0.1:57881/mcp";
const TOKEN = process.env.LUCY_MCP_TOKEN;
if (!TOKEN) { console.error("LUCY_MCP_TOKEN is required"); process.exit(2); }

const args = process.argv.slice(2);
const mode = args[0];
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};

const headers = (session) => ({
  "content-type": "application/json",
  accept: "application/json, text/event-stream",
  authorization: `Bearer ${TOKEN}`,
  ...(session ? { "mcp-session-id": session } : {})
});

async function rpc(body, session) {
  const started = performance.now();
  const res = await fetch(URL_BASE, { method: "POST", headers: headers(session), body: JSON.stringify(body) });
  const text = await res.text();
  return { status: res.status, ms: performance.now() - started, text, session: res.headers.get("mcp-session-id") };
}

/** 响应确是「被拒」：JSON-RPC error，或 tool result 带 isError。401/过期令牌等错误页不算。 */
function isRejection(r) {
  if (r.status !== 200) return false;
  try {
    const json = JSON.parse(r.text.replace(/^event: message\ndata: /, "").trim());
    return Boolean(json.error) || json.result?.isError === true;
  } catch { return false; }
}

const initBody = (id) => ({
  jsonrpc: "2.0", id, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "uat-probe", version: "0" } }
});

function pct(sorted, p) {
  if (sorted.length === 0) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] * 10) / 10;
}
function summarize(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    n: samples.length, p50: pct(sorted, 50), p95: pct(sorted, 95), p99: pct(sorted, 99),
    max: pct(sorted, 100), over30s: samples.filter((ms) => ms > 30_000).length
  };
}

async function handshake() {
  const n = flag("n", 200);
  const concurrency = flag("concurrency", 20);
  const failures = [];
  const sequential = [];
  for (let i = 0; i < n; i += 1) {
    const r = await rpc(initBody(`seq-${i}`));
    if (r.status !== 200) failures.push(r.status);
    sequential.push(r.ms);
  }
  const concurrent = await Promise.all(Array.from({ length: concurrency }, async (_, i) => {
    const r = await rpc(initBody(`conc-${i}`));
    if (r.status !== 200) failures.push(r.status);
    return r.ms;
  }));
  console.log(JSON.stringify({ probe: "handshake", sequential: summarize(sequential), concurrent: summarize(concurrent), nonOkStatuses: failures }));
}

async function deny() {
  const n = flag("n", 100);
  const init = await rpc(initBody("deny-init"));
  const session = init.session;
  await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, session);
  const shapes = {
    unknownTool: (i) => ({ jsonrpc: "2.0", id: `u-${i}`, method: "tools/call", params: { name: "lucy_frobnicate", arguments: {} } }),
    missingMeasures: (i) => ({ jsonrpc: "2.0", id: `m-${i}`, method: "tools/call", params: { name: "lucy_query", arguments: { connectionId: "demo-mysql", dimensions: [{ field: "superstore_orders.region" }] } } })
  };
  const out = {};
  let notRejected = 0;
  for (const [name, build] of Object.entries(shapes)) {
    const samples = [];
    for (let i = 0; i < n; i += 1) {
      const r = await rpc(build(i), session);
      if (!isRejection(r)) notRejected += 1;
      samples.push(r.ms);
    }
    out[name] = summarize(samples);
  }
  // 不是「被拒」的响应（令牌失效、代理 401 等）会让延迟样本失真：不得当作拒绝延迟，退出非 0。
  if (notRejected > 0) process.exitCode = 1;
  console.log(JSON.stringify({ probe: "deny", notRejected, ...out }));
}

async function staleSession() {
  const fake = "00000000-0000-4000-8000-000000000000";
  const ping = await rpc({ jsonrpc: "2.0", id: "stale-ping", method: "ping" }, fake);
  const list = await rpc({ jsonrpc: "2.0", id: "stale-list", method: "tools/list" }, fake);
  const leaked = /unknown mcp session/i.test(ping.text) || /unknown mcp session/i.test(list.text);
  if (leaked) process.exitCode = 1; // 上游 404 `Unknown MCP session` 透给了客户端＝恢复失败
  console.log(JSON.stringify({
    probe: "stale-session",
    ping: { status: ping.status, ms: Math.round(ping.ms), unknownSessionLeaked: /unknown mcp session/i.test(ping.text) },
    toolsList: { status: list.status, ms: Math.round(list.ms), unknownSessionLeaked: /unknown mcp session/i.test(list.text) }
  }));
}

const modes = { handshake, deny, "stale-session": staleSession };
if (!modes[mode]) { console.error(`usage: ${Object.keys(modes).join(" | ")}`); process.exit(2); }
await modes[mode]();
