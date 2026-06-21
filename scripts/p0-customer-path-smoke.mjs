#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const connectionId = process.env.LUCY_P0_CONNECTION_ID ?? "mysql-aliyun";
const sourceName = process.env.LUCY_P0_SOURCE_NAME ?? "superstore_orders";
const measure = process.env.LUCY_P0_MEASURE ?? `${sourceName}.total_sales`;
const dimension = process.env.LUCY_P0_DIMENSION ?? `${sourceName}.region`;
const segment = process.env.LUCY_P0_SEGMENT ?? `${sourceName}.active_rows`;
const token = randomBytes(24).toString("hex");
let mcpChild;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-customer-smoke] $ ${label}`);
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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function parseRpcBody(text) {
  if (!text.startsWith("event:")) return JSON.parse(text);
  const data = text.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
  return data ? JSON.parse(data) : null;
}

async function rpc(port, sessionId, method, params) {
  const headers = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${token}`
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: method, method, params })
  });
  const text = await res.text();
  return { res, body: parseRpcBody(text), text };
}

async function waitForMcp(port) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < 30_000) {
    try {
      const init = await rpc(port, "", "initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "lucy-p0-customer-smoke", version: "0.1.0" }
      });
      if (init.res.ok && !init.body?.error) return init;
      lastError = new Error(init.text);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError ?? new Error("Timed out waiting for KTX MCP");
}

async function startMcp() {
  const port = await getFreePort();
  console.log(`\n[p0-customer-smoke] starting temporary KTX MCP on 127.0.0.1:${port}`);
  mcpChild = spawn("ktx", [
    "--project-dir",
    process.cwd(),
    "mcp",
    "start",
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--token",
    token,
    "--foreground"
  ], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  mcpChild.stdout.on("data", (chunk) => process.stderr.write(chunk));
  mcpChild.stderr.on("data", (chunk) => process.stderr.write(chunk));

  const init = await waitForMcp(port);
  const sessionId = init.res.headers.get("mcp-session-id");
  if (!sessionId) throw new Error("KTX MCP initialize did not return mcp-session-id");
  await rpc(port, sessionId, "notifications/initialized", {});
  return { port, sessionId };
}

async function stopMcp() {
  if (!mcpChild) return;
  mcpChild.kill("SIGTERM");
  await once(mcpChild, "close").catch(() => undefined);
  mcpChild = undefined;
}

async function verifyMcpTools(port, sessionId) {
  const list = await rpc(port, sessionId, "tools/list", {});
  if (!list.res.ok || list.body?.error) {
    throw new Error(`tools/list failed: HTTP ${list.res.status} ${JSON.stringify(list.body?.error ?? list.body)}`);
  }
  const names = (list.body?.result?.tools ?? []).map((tool) => tool.name).sort();
  const required = ["connection_list", "sl_query", "sl_read_source", "wiki_search"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`Required MCP tool missing: ${missing.join(", ")}`);
  console.log(`[p0-customer-smoke] MCP tools: ${names.join(", ")}`);
  if (!names.includes("sl_validate")) {
    console.log("[p0-customer-smoke] note: sl_validate is not exposed as an MCP tool in this KTX runtime; CLI validate was checked separately.");
  }
}

async function verifyAgentQuery(port, sessionId) {
  const call = await rpc(port, sessionId, "tools/call", {
    name: "sl_query",
    arguments: {
      connectionId,
      measures: [measure],
      dimensions: [{ field: dimension }],
      segments: [segment],
      limit: 3,
      include: ["sql"]
    }
  });
  if (!call.res.ok || call.body?.error) {
    throw new Error(`sl_query tools/call failed: HTTP ${call.res.status} ${JSON.stringify(call.body?.error ?? call.body)}`);
  }
  const structured = call.body?.result?.structuredContent;
  if (!structured || !Array.isArray(structured.rows) || structured.rows.length === 0) {
    throw new Error("sl_query did not return result rows");
  }
  if (!Array.isArray(structured.headers) || !structured.headers.includes("region")) {
    throw new Error("sl_query response did not include expected dimension header");
  }
  console.log(`[p0-customer-smoke] agent-style MCP sl_query returned ${structured.rows.length} rows`);
}

try {
  await run("ktx", ["connection", "test", connectionId]);
  await run("ktx", ["sl", "validate", sourceName, "--connection-id", connectionId]);
  await run("ktx", [
    "sl",
    "--connection-id",
    connectionId,
    "query",
    "--measure",
    measure,
    "--dimension",
    dimension,
    "--segment",
    segment,
    "--limit",
    "3",
    "--execute",
    "--max-rows",
    "3"
  ]);
  const { port, sessionId } = await startMcp();
  await verifyMcpTools(port, sessionId);
  await verifyAgentQuery(port, sessionId);
  console.log("\n[p0-customer-smoke] PASS");
} catch (error) {
  console.error(`\n[p0-customer-smoke] FAIL: ${error.message}`);
  if (error.stderr) console.error(error.stderr);
  process.exitCode = 1;
} finally {
  await stopMcp();
}
