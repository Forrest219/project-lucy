import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  parseArgs,
  runSessionUat
} from "./mcp-session-regression.mjs";

const SESSION_ERROR = "MCP initialize request is required before session traffic.";

async function startStub({ rejectMissingSession = false } = {}) {
  const calls = [];
  const sockets = new Set();
  let initializeCount = 0;
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk.toString();
    const body = raw ? JSON.parse(raw) : undefined;
    const toolName = body?.params?.name;
    calls.push({
      method: req.method,
      rpcMethod: body?.method,
      toolName,
      sessionId: req.headers["mcp-session-id"],
      authorized: req.headers.authorization === "Bearer uat-token"
    });

    if (!req.headers.authorization) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
      return;
    }
    if (req.method === "DELETE") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (body?.method === "initialize") {
      initializeCount += 1;
      res.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": `stub-session-${initializeCount}`
      });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-03-26", capabilities: {} }
      }));
      return;
    }
    if (body?.method === "notifications/initialized") {
      res.writeHead(202, { "content-type": "application/json" });
      res.end("");
      return;
    }
    if (rejectMissingSession && !req.headers["mcp-session-id"] && toolName !== "lucy_catalog") {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end(SESSION_ERROR);
      return;
    }
    if (body?.method === "tools/call" && toolName === "lucy_catalog") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [{
            type: "text",
            text: JSON.stringify({ sources: [{ connectionId: "demo-mysql", sourceName: "superstore_orders" }] })
          }]
        }
      }));
      return;
    }
    if (body?.method === "tools/call" && toolName === "lucy_read_source") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "superstore_orders order_count active_rows" }] }
      }));
      return;
    }
    if (body?.method === "tools/call" && toolName === "lucy_query") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: {
            headers: ["order_count", "total_sales"],
            rows: [[1000, 1459476.0953]]
          }
        }
      }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    calls,
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => {
      server.closeIdleConnections?.();
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    })
  };
}

test("parseArgs supports the UAT contract and rejects missing values", () => {
  const parsed = parseArgs([
    "node",
    "mcp-session-regression.mjs",
    "--proxy-url", "http://127.0.0.1:7879/mcp",
    "--token-env", "CUSTOM_TOKEN",
    "--connection-id", "doris",
    "--source-name", "orders",
    "--out", "inbox/result.json",
    "--no-container"
  ]);
  assert.equal(parsed.proxyUrl, "http://127.0.0.1:7879/mcp");
  assert.equal(parsed.tokenEnv, "CUSTOM_TOKEN");
  assert.equal(parsed.connectionId, "doris");
  assert.equal(parsed.sourceName, "orders");
  assert.equal(parsed.container, undefined);
  assert.throws(() => parseArgs(["node", "script", "--proxy-url"]), /requires a value/);
});

test("black-box UAT omits the first session, validates values, and redacts evidence", async () => {
  const stub = await startStub();
  const temp = await mkdtemp(path.join(os.tmpdir(), "lucy-session-uat-"));
  const out = path.join(temp, "evidence.json");
  try {
    const evidence = await runSessionUat({
      proxyUrl: stub.url,
      tokenEnv: "LUCY_UAT_TEST_TOKEN",
      token: "uat-token",
      connectionId: "demo-mysql",
      sourceName: "superstore_orders",
      out,
      container: undefined,
      timeoutMs: 5_000
    });
    assert.equal(evidence.status, "pass");
    const missingHeaderCalls = stub.calls.filter((call) =>
      ["lucy_catalog", "lucy_read_source", "lucy_query"].includes(call.toolName)
      && !call.sessionId
    );
    assert(missingHeaderCalls.some((call) => call.toolName === "lucy_catalog"));
    assert(missingHeaderCalls.some((call) => call.toolName === "lucy_read_source"));
    assert(missingHeaderCalls.some((call) => call.toolName === "lucy_query"));
    const compliantCalls = stub.calls.filter((call) =>
      ["lucy_read_source", "lucy_query"].includes(call.toolName)
      && call.sessionId === "stub-session-2"
    );
    assert.equal(compliantCalls.length, 2);

    const serialized = await readFile(out, "utf8");
    assert.equal(serialized.includes("uat-token"), false);
    assert.equal(serialized.includes("stub-session-1"), false);
    assert.equal(serialized.includes("stub-session-2"), false);
  } finally {
    await stub.close();
    await rm(temp, { recursive: true, force: true });
  }
});

test("black-box UAT fails on the historical plain-text Session rejection", async () => {
  const stub = await startStub({ rejectMissingSession: true });
  const temp = await mkdtemp(path.join(os.tmpdir(), "lucy-session-uat-negative-"));
  try {
    await assert.rejects(
      runSessionUat({
        proxyUrl: stub.url,
        tokenEnv: "LUCY_UAT_TEST_TOKEN",
        token: "uat-token",
        connectionId: "demo-mysql",
        sourceName: "superstore_orders",
        out: path.join(temp, "evidence.json"),
        container: undefined,
        timeoutMs: 5_000
      }),
      /lucy_read_source.*MCP initialize request is required before session traffic/i
    );
  } finally {
    await stub.close();
    await rm(temp, { recursive: true, force: true });
  }
});
