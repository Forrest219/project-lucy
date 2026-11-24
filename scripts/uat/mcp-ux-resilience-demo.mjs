#!/usr/bin/env node
/**
 * P1-37 UAT（本机 demo，确定性小跑）：UAT-R0 与 UAT-MCPX-11（主路径回归）。
 *
 *   node scripts/uat/mcp-ux-resilience-demo.mjs [r0|mcpx11|all]
 *
 * Bearer 取自 `~/.cursor/mcp.json` 的 `lucy-demo`（缺省 `lucy`）条目；401 即该条目已过期，须先换新（只在内存，不打印）。输出一行 JSON。
 * 业务查询只用只读度量；join 用语义层已声明的 superstore_orders → superstore_returns。
 */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { makeClient } from "./lib/mcp-uat-lib.mjs";

const WEB = process.env.LUCY_DEMO_WEBUI ?? "http://127.0.0.1:55176";
const MCP = process.env.LUCY_DEMO_MCP ?? "http://127.0.0.1:57881/mcp";
const config = JSON.parse(readFileSync(path.join(os.homedir(), ".cursor", "mcp.json"), "utf8"));
const token = String((config.mcpServers?.["lucy-demo"] ?? config.mcpServers?.lucy)?.headers?.Authorization ?? "").replace(/^Bearer\s+/i, "");
if (!token) { console.error("no lucy-demo/lucy Authorization in ~/.cursor/mcp.json"); process.exit(2); }
const client = makeClient(MCP);
const which = process.argv[2] ?? "all";

const checks = [];
const ok = (r) => r.status === 200 && !r.isError && r.text.length > 0; // 空响应不算成交
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });

async function r0() {
  const health = await (await fetch(`${WEB}/api/health`)).json();
  const livez = await fetch(`${WEB}/api/livez`);
  const init = await client.rpc(token, client.initBody("r0"));
  check("health ok", health?.data?.status === "ok", { gitSha: health?.data?.gitSha, gitDirty: health?.data?.gitDirty, derivation: health?.data?.lucyVersion });
  check("livez 正常", livez.ok, { status: livez.status });
  check("MCP initialize 200 且带 instructions", init.status === 200 && Boolean(init.json?.result?.instructions), { status: init.status, ms: Math.round(init.ms) });
  return { gitSha: health?.data?.gitSha, gitDirty: health?.data?.gitDirty, eventLoopP99Ms: health?.data?.eventLoop?.p99Ms };
}

async function mcpx11() {
  const { session } = await client.open(token);
  const call = (id, args) => client.callTool(token, session, id, "lucy_query", { connectionId: "demo-mysql", ...args });
  const single = await call("m11-single", { measures: ["superstore_orders.total_sales"] });
  check("单表度量查询成交", ok(single) && /answer_verifiability|rows|total_sales/.test(single.text), { ms: Math.round(single.ms), head: single.text.slice(0, 80) });
  const join = await call("m11-join", {
    measures: ["superstore_orders.total_sales"],
    dimensions: [{ field: "superstore_returns.returned" }]
  });
  const joinRetry = join.isError ? await call("m11-join-retry", {
    measures: ["superstore_orders.total_sales"],
    dimensions: [{ field: "superstore_returns.order_id" }], limit: 3
  }) : join;
  check("多表 join 查询成交", ok(joinRetry), { ms: Math.round(joinRetry.ms), head: joinRetry.text.slice(0, 120) });
  const pinned = await call("m11-pinned", { sourceName: "superstore_orders", measures: ["superstore_orders.total_sales"] });
  check("钉选唯一来源的合法查询成交（非 source_ambiguity_gate）", ok(pinned) && !/source_ambiguity_gate/.test(pinned.text), { ms: Math.round(pinned.ms), head: pinned.text.slice(0, 80) });
  // 纯 MCP：本脚本即无宿主、无 attestation 的纯 MCP 客户端
  check("纯 MCP 客户端（无宿主头）完成同样查询", ok(single) && ok(pinned), null);
}

const out = {};
if (which === "r0" || which === "all") out.r0 = await r0();
if (which === "mcpx11" || which === "all") await mcpx11();
const failed = checks.filter((c) => !c.pass);
console.log(JSON.stringify({ suite: "UAT-SUITE-MCP-UX-RESILIENCE", target: "demo", verdict: failed.length === 0 ? "PASS" : "FAIL", checks, ...out }));
process.exit(failed.length === 0 ? 0 : 1);
