#!/usr/bin/env node
/**
 * UAT-PDS audit-row seeder: real read-only MCP calls through the Lucy MCP Proxy.
 * Each tools/call = one real audit row. Interval >=500ms (write-storm discipline R-2).
 * Token from file (0600). Usage:
 *   node scripts/uat/seed-audit-rows.mjs --token-file /tmp/uat-pds-mcp-token.txt --calls 300 --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MCP = process.env.LUCY_MCP || "http://127.0.0.1:57881/mcp";
const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const TOKEN_FILE = opt("token-file", "/tmp/uat-pds-mcp-token.txt");
const CALLS = Number(opt("calls", 300));
const OUT = resolve(opt("out", resolve(dirname(fileURLToPath(import.meta.url)), "../../inbox/uat-pds-audit-rows")));

const token = readFileSync(TOKEN_FILE, "utf8").trim();
const TOOLS = ["lucy_catalog", "connection_list", "wiki_search"];
const toolArgs = {
  lucy_catalog: { connection: "demo-mysql" },
  connection_list: {},
  wiki_search: { query: "superstore" }
};

let sessionId = null;
let rpcId = 0;

async function mrpc(method, params) {
  rpcId += 1;
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream"
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MCP, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: rpcId, method, params }) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`MCP ${method} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  const sid = res.headers.get("mcp-session-id") || res.headers.get("Mcp-Session-Id");
  if (sid) sessionId = sid;
  const raw = await res.text();
  const line = raw.split("\n").find((l) => l.startsWith("data:"));
  const payload = line ? line.slice(5).trim() : raw.trim();
  return payload ? JSON.parse(payload) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  mkdirSync(OUT, { recursive: true });
  const report = { at: new Date().toISOString(), mcp: MCP, planCalls: CALLS, calls: [], failures: [] };
  const init = await mrpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "uat-pds", version: "1" } });
  if (!init?.result) throw new Error(`initialize failed: ${JSON.stringify(init).slice(0, 200)}`);
  await mrpc("notifications/initialized", {}).catch(() => {});
  const tStart = performance.now();
  for (let i = 1; i <= CALLS; i++) {
    const tool = TOOLS[i % TOOLS.length];
    try {
      const r = await mrpc("tools/call", { name: tool, arguments: toolArgs[tool] });
      const ok = !r?.error;
      report.calls.push({ i, tool, ok, isError: Boolean(r?.result?.isError) });
      if (!ok) report.failures.push({ i, tool, err: JSON.stringify(r?.error)?.slice(0, 120) });
    } catch (e) {
      report.calls.push({ i, tool, ok: false });
      report.failures.push({ i, tool, err: String(e).slice(0, 160) });
    }
    if (i % 50 === 0) console.log(`calls ${i}/${CALLS} (${Math.round(performance.now() - tStart)}ms)`);
    await sleep(500);
  }
  report.elapsedMs = Math.round(performance.now() - tStart);
  const okCount = report.calls.filter((c) => c.ok).length;
  report.summary = { ok: okCount, failed: report.calls.length - okCount, actualRps: Math.round((okCount / (report.elapsedMs / 1000)) * 100) / 100 };
  writeFileSync(resolve(OUT, `seed-audit-${Date.now()}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out: OUT, ...report.summary, failures: report.failures.slice(0, 5) }, null, 2));
  process.exit(report.failures.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(String(e?.stack || e));
  process.exit(2);
});
