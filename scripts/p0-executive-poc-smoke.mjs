#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const project = process.env.LUCY_EXEC_COMPOSE_PROJECT ?? "lucy-p0-executive-poc";
const webPort = process.env.LUCY_EXEC_WEBUI_HOST_PORT ?? "55178";
const proxyPort = process.env.LUCY_EXEC_PROXY_HOST_PORT ?? "57883";
const demoToken = process.env.LUCY_EXEC_AGENT_TOKEN ?? "exec-demo-full-token";
const expectedKtxVersion = process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.16.0";
const composeFile = "docker-compose.executive-poc.yml";
const baselinePath = "examples/executive-poc/mysql/_baseline.json";
let tempDockerConfig;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-executive-poc-smoke] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`${label} failed with exit code ${code}`);
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });
}

function composeArgs(args) {
  return ["compose", "-f", composeFile, "-p", project, ...args];
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return await res.json();
}

async function waitForJson(url, timeoutMs = 180_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return data ? JSON.parse(data) : null;
}

async function loadBaseline() {
  return JSON.parse(await readFile(baselinePath, "utf8"));
}

function assertClose(label, actual, expected, tolerance = 0.01) {
  const delta = Math.abs(Number(actual) - Number(expected));
  if (!Number.isFinite(delta) || delta > tolerance) {
    throw new Error(`${label} expected ${expected}, got ${actual}`);
  }
}

async function verifyCounts(baseline) {
  const sql = [
    "SELECT 'order_lines', COUNT(*) FROM fct_order_line_daily",
    "UNION ALL SELECT 'mv_rollup', COUNT(*) FROM mv_order_quarterly_rollup",
    "UNION ALL SELECT 'inventory', COUNT(*) FROM fct_inventory_health_daily"
  ].join(" ");
  const result = await run("docker", composeArgs([
    "exec", "-T", "demo-exec-db",
    "mysql", "-u", "lucy", "-plucy_exec_demo", "-N", "-B", "dataforai", "-e", sql
  ]), { capture: true });
  const counts = Object.fromEntries(result.stdout.trim().split("\n").map((line) => {
    const [key, value] = line.split("\t");
    return [key, Number(value)];
  }));
  if (counts.order_lines !== baseline.counts.order_line_rows) {
    throw new Error(`order_lines expected ${baseline.counts.order_line_rows}, got ${counts.order_lines}`);
  }
  console.log(`[p0-executive-poc-smoke] counts ok: order_lines=${counts.order_lines}, mv=${counts.mv_rollup}`);
}

async function rpc(sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${demoToken}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(`http://127.0.0.1:${proxyPort}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await res.text();
  return { res, body: parseRpcBody(text), text };
}

async function verifyProxyPath(baseline) {
  const init = await rpc("", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lucy-p0-executive-poc-smoke", version: "0.1.0" }
  });
  if (!init.res.ok || init.body?.error) {
    throw new Error(`proxy initialize failed: ${JSON.stringify(init.body?.error ?? init.body)}`);
  }
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("missing mcp-session-id");
  await rpc(sessionId, "notifications/initialized", {});

  const read = await rpc(sessionId, "tools/call", {
    name: "sl_read_source",
    arguments: { connectionId: "demo-exec-mysql", sourceName: "fct_daily_cash_balance" }
  });
  const readText = JSON.stringify(read.body?.result ?? {});
  if (!readText.includes("cash_balance_month_end")) {
    throw new Error("sl_read_source missing cash_balance_month_end measure");
  }

  const call = await rpc(sessionId, "tools/call", {
    name: "sl_query",
    arguments: {
      connectionId: "demo-exec-mysql",
      measures: ["fct_daily_cash_balance.cash_balance_month_end"],
      filters: ["fct_daily_cash_balance.entity_id = 1", "fct_daily_cash_balance.period_month = '2026-06'"],
      segments: ["fct_daily_cash_balance.month_end_only"],
      limit: 5,
      include: ["sql"]
    }
  });
  const rows = call.body?.result?.structuredContent?.rows;
  if (!rows?.length) throw new Error("sl_query returned no rows for month-end cash");
  const val = Number(rows[0].cash_balance_month_end ?? rows[0][1]);
  assertClose("month-end cash entity 1", val, baseline.cfo1.month_end_cash_by_entity["1"]["2026-06"], 1);
  console.log("[p0-executive-poc-smoke] proxy sl_query month-end cash matches baseline");
}

async function main() {
  const baseline = await loadBaseline();
  const env = {
    LUCY_EXEC_WEBUI_HOST_PORT: webPort,
    LUCY_EXEC_PROXY_HOST_PORT: proxyPort,
    LUCY_PUBLIC_MCP_URL: process.env.LUCY_PUBLIC_MCP_URL ?? `http://127.0.0.1:${proxyPort}/mcp`
  };
  if (!process.env.DOCKER_CONFIG) {
    tempDockerConfig = await mkdtemp(path.join(tmpdir(), "lucy-exec-docker-config-"));
    await run("docker", ["pull", "mysql:8.4"], { env: { DOCKER_CONFIG: tempDockerConfig } });
  }
  await run("docker", composeArgs(["up", "-d", "--build"]), { env });
  try {
    const health = await waitForJson(`http://127.0.0.1:${webPort}/api/health`);
    if (health?.ok !== true) throw new Error("/api/health not ok");
    if (health?.data?.bundledKtxVersion !== expectedKtxVersion) {
      throw new Error(`bundledKtxVersion expected ${expectedKtxVersion}, got ${health?.data?.bundledKtxVersion}`);
    }
    await verifyCounts(baseline);
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "connection", "test", "demo-exec-mysql"]));
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "admin", "reindex", "--force", "--output", "json"]), { capture: true });
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "sl", "validate", "fct_daily_cash_balance", "--connection-id", "demo-exec-mysql"]));
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "sl", "validate", "mv_order_quarterly_rollup", "--connection-id", "demo-exec-mysql"]));
    const mvQuery = await run("docker", composeArgs([
      "exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy",
      "sl", "--connection-id", "demo-exec-mysql", "query",
      "--measure", "mv_order_quarterly_rollup.total_sales",
      "--filter", "mv_order_quarterly_rollup.year_quarter = '2026Q2'",
      "--filter", "mv_order_quarterly_rollup.region = 'East_China'",
      "--filter", "mv_order_quarterly_rollup.category = 'Electronics'",
      "--execute", "--format", "json"
    ]), { capture: true });
    const mvParsed = JSON.parse(mvQuery.stdout);
    const mvSales = Number(mvParsed.rows?.[0]?.total_sales ?? mvParsed.rows?.[0]?.[0]);
    assertClose("mv total_sales", mvSales, baseline.cio7.mv_sales, 0.01);
    console.log("[p0-executive-poc-smoke] mv sales matches baseline");
    await verifyProxyPath(baseline);
    console.log("\n[p0-executive-poc-smoke] PASS");
  } finally {
    await run("docker", composeArgs(["down", "-v"]), { capture: true, env }).catch((e) => console.error(e.message));
  }
}

main().catch((error) => {
  console.error(`\n[p0-executive-poc-smoke] FAIL: ${error.message}`);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}).finally(async () => {
  if (tempDockerConfig) await rm(tempDockerConfig, { recursive: true, force: true }).catch(() => undefined);
});
