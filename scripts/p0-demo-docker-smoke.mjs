#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const project = process.env.LUCY_DEMO_COMPOSE_PROJECT ?? "lucy-p0-demo";
const webPort = process.env.LUCY_DEMO_WEBUI_HOST_PORT ?? "55176";
const proxyPort = process.env.LUCY_DEMO_PROXY_HOST_PORT ?? "57881";
const demoToken = process.env.LUCY_DEMO_AGENT_TOKEN ?? "lucy-demo-agent-token";
const expectedKtxVersion = process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.16.0";
const composeFile = "docker-compose.demo.yml";
const baselinePath = "examples/docker-demo/mysql/_baseline.json";
let tempDockerConfig;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-demo-smoke] $ ${label}`);
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

async function waitForJson(url, timeoutMs = 120_000) {
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

function rowsByRegion(headers, rows) {
  const map = new Map();
  const regionIndex = Array.isArray(headers) ? headers.indexOf("region") : -1;
  const salesIndex = Array.isArray(headers) ? headers.indexOf("total_sales") : -1;
  for (const row of rows ?? []) {
    if (Array.isArray(row)) {
      const region = row[regionIndex >= 0 ? regionIndex : 0];
      const sales = row[salesIndex >= 0 ? salesIndex : 1];
      map.set(String(region), Number(sales));
      continue;
    }
    if (row && typeof row === "object") {
      const region = row.region ?? row["superstore_orders.region"];
      const sales = row.total_sales ?? row["superstore_orders.total_sales"];
      map.set(String(region), Number(sales));
    }
  }
  return map;
}

function assertRegionSales(label, headers, rows, baseline) {
  const expected = baseline.sales_by_region ?? {};
  const actual = rowsByRegion(headers, rows);
  const expectedRegions = Object.keys(expected).sort();
  const actualRegions = [...actual.keys()].sort();
  if (expectedRegions.join(",") !== actualRegions.join(",")) {
    throw new Error(`${label} expected regions ${expectedRegions.join(", ")}, got ${actualRegions.join(", ")}`);
  }
  for (const [region, sales] of Object.entries(expected)) {
    assertClose(`${label} ${region}`, actual.get(region), sales);
  }
}

async function verifyDemoCounts(baseline) {
  const sql = [
    "SELECT 'orders', COUNT(*) FROM superstore_orders",
    "UNION ALL SELECT 'people', COUNT(*) FROM superstore_people",
    "UNION ALL SELECT 'returns', COUNT(*) FROM superstore_returns"
  ].join(" ");
  const result = await run("docker", composeArgs([
    "exec", "-T", "demo-db",
    "mysql", "-u", "lucy", "-plucy_demo", "-N", "-B", "dataforai", "-e", sql
  ]), { capture: true });
  const counts = Object.fromEntries(result.stdout.trim().split("\n").map((line) => {
    const [key, value] = line.split("\t");
    return [key, Number(value)];
  }));
  if (counts.orders !== baseline.counts.orders) throw new Error(`orders expected ${baseline.counts.orders}, got ${counts.orders}`);
  if (counts.people !== baseline.counts.people) throw new Error(`people expected ${baseline.counts.people}, got ${counts.people}`);
  if (counts.returns !== baseline.counts.returns) throw new Error(`returns expected ${baseline.counts.returns}, got ${counts.returns}`);
  console.log(`[p0-demo-smoke] demo counts match baseline: orders=${counts.orders}, people=${counts.people}, returns=${counts.returns}`);
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

async function verifyAdvertisedMcpEndpoint() {
  const expectedUrl = `http://127.0.0.1:${proxyPort}/mcp`;
  const project = await fetchJson(`http://127.0.0.1:${webPort}/api/project`);
  const endpoint = project?.data?.mcpEndpoint;
  if (!endpoint) throw new Error("GET /api/project missing mcpEndpoint");
  if (endpoint.status !== "configured") {
    throw new Error(`mcpEndpoint.status expected configured, got ${endpoint.status}`);
  }
  if (endpoint.url !== expectedUrl) {
    throw new Error(`mcpEndpoint.url expected ${expectedUrl}, got ${endpoint.url}`);
  }
  console.log(`[p0-demo-smoke] advertised MCP endpoint matches host publish: ${endpoint.url}`);
}

async function verifyProxyAgentPath(baseline) {
  const init = await rpc("", "initialize", {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "lucy-p0-demo-smoke", version: "0.1.0" }
  });
  if (!init.res.ok || init.body?.error) {
    throw new Error(`proxy initialize failed: HTTP ${init.res.status} ${JSON.stringify(init.body?.error ?? init.body)}`);
  }
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("proxy initialize did not return mcp-session-id");
  await rpc(sessionId, "notifications/initialized", {});

  const list = await rpc(sessionId, "tools/list", {});
  if (!list.res.ok || list.body?.error) {
    throw new Error(`proxy tools/list failed: HTTP ${list.res.status} ${JSON.stringify(list.body?.error ?? list.body)}`);
  }
  const names = (list.body?.result?.tools ?? []).map((tool) => tool.name).sort();
  const required = ["kx_catalog", "sl_query", "sl_read_source", "wiki_search"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`proxy tools/list missing: ${missing.join(", ")}`);
  if (names.includes("sql_execution")) throw new Error("proxy tools/list exposed denied sql_execution tool");
  console.log(`[p0-demo-smoke] proxy tools: ${names.join(", ")}`);

  const read = await rpc(sessionId, "tools/call", {
    name: "sl_read_source",
    arguments: {
      connectionId: "demo-mysql",
      sourceName: "superstore_orders"
    }
  });
  if (!read.res.ok || read.body?.error) {
    throw new Error(`proxy sl_read_source failed: HTTP ${read.res.status} ${JSON.stringify(read.body?.error ?? read.body)}`);
  }
  const readText = JSON.stringify(read.body?.result ?? {});
  if (!readText.includes("total_sales") || !readText.includes("active_rows")) {
    throw new Error("proxy sl_read_source did not include expected demo semantic layer content");
  }
  console.log("[p0-demo-smoke] proxy sl_read_source returned demo semantic layer content");

  const call = await rpc(sessionId, "tools/call", {
    name: "sl_query",
    arguments: {
      connectionId: "demo-mysql",
      measures: ["superstore_orders.total_sales"],
      dimensions: [{ field: "superstore_orders.region" }],
      segments: ["superstore_orders.active_rows"],
      limit: 5,
      include: ["sql"]
    }
  });
  if (!call.res.ok || call.body?.error) {
    throw new Error(`proxy sl_query failed: HTTP ${call.res.status} ${JSON.stringify(call.body?.error ?? call.body)}`);
  }
  const structured = call.body?.result?.structuredContent;
  if (!structured || !Array.isArray(structured.rows)) {
    throw new Error("proxy sl_query did not return expected demo rows");
  }
  assertRegionSales("proxy sl_query", structured.headers, structured.rows, baseline);
  console.log(`[p0-demo-smoke] proxy sl_query returned ${structured.rows.length} baseline-matched rows`);
}

async function main() {
  const baseline = await loadBaseline();
  const env = {
    LUCY_DEMO_WEBUI_HOST_PORT: webPort,
    LUCY_DEMO_PROXY_HOST_PORT: proxyPort,
    // Keep Advertise aligned with Publish when smoke remaps host ports.
    LUCY_PUBLIC_MCP_URL: process.env.LUCY_PUBLIC_MCP_URL ?? `http://127.0.0.1:${proxyPort}/mcp`
  };
  if (!process.env.DOCKER_CONFIG) {
    tempDockerConfig = await mkdtemp(path.join(tmpdir(), "lucy-demo-docker-config-"));
    console.log(`[p0-demo-smoke] using temporary DOCKER_CONFIG=${tempDockerConfig} for Docker Hub pulls`);
    await run("docker", ["pull", "mysql:8.4"], { env: { DOCKER_CONFIG: tempDockerConfig } });
  }
  await run("docker", composeArgs(["up", "-d", "--build"]), { env });
  try {
    const health = await waitForJson(`http://127.0.0.1:${webPort}/api/health`);
    if (health?.ok !== true) throw new Error("demo /api/health envelope was not ok");
    if (health?.data?.bundledKtxVersion !== expectedKtxVersion) {
      throw new Error(`demo bundledKtxVersion expected ${expectedKtxVersion}, got ${health?.data?.bundledKtxVersion}`);
    }
    await verifyDemoCounts(baseline);
    await verifyAdvertisedMcpEndpoint();
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "connection", "test", "demo-mysql"]));
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "admin", "reindex", "--force", "--output", "json"]), { capture: true });
    await run("docker", composeArgs(["exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy", "sl", "validate", "superstore_orders", "--connection-id", "demo-mysql"]));
    const query = await run("docker", composeArgs([
      "exec", "-T", "lucy", "ktx", "--project-dir", "/data/lucy",
      "sl", "--connection-id", "demo-mysql", "query",
      "--measure", "superstore_orders.total_sales",
      "--dimension", "superstore_orders.region",
      "--segment", "superstore_orders.active_rows",
      "--limit", "5",
      "--execute",
      "--max-rows", "5",
      "--format", "json"
    ]), { capture: true });
    const parsedQuery = JSON.parse(query.stdout);
    assertRegionSales("cli sl query", parsedQuery.headers, parsedQuery.rows, baseline);
    console.log("[p0-demo-smoke] cli sl query region totals match baseline");
    await verifyProxyAgentPath(baseline);
    await run("docker", composeArgs(["ps"]));
    console.log("\n[p0-demo-smoke] PASS");
  } finally {
    await run("docker", composeArgs(["down", "-v"]), { capture: true, env }).catch((error) => {
      console.error(error.message);
    });
  }
}

main().catch((error) => {
  console.error(`\n[p0-demo-smoke] FAIL: ${error.message}`);
  if (error.stderr) console.error(error.stderr);
  process.exit(1);
}).finally(async () => {
  if (tempDockerConfig) {
    await rm(tempDockerConfig, { recursive: true, force: true }).catch(() => undefined);
  }
});
