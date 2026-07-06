import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "p1-endpoint-smoke.mjs");

function startProxyStub({
  authToken = "test-token",
  omitMeta = false,
  omitForwardingTool = false,
  omitCatalogTool = false,
  catalogSources = [{ connectionId: "doris-r1", sourceName: "ceo_metric_snapshot", table: "ceo_metric_snapshot", schema: "default" }]
} = {}) {
  const sockets = new Set();
  const tools = [
    ...(omitCatalogTool ? [] : [{ name: "lucy_catalog", inputSchema: { type: "object", properties: {} } }]),
    ...(omitForwardingTool ? [] : [{ name: "lucy_read_source", inputSchema: { type: "object", properties: {}, required: ["connectionId", "sourceName"] } }])
  ];

  const server = http.createServer(async (req, res) => {
    const authorization = req.headers.authorization;
    if (authorization !== `Bearer ${authToken}`) {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }));
      return;
    }

    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    res.setHeader("content-type", "application/json");

    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "p1-test-session");
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { protocolVersion: "2025-03-26", capabilities: {}, instructions: "test instructions" }
      }));
      return;
    }
    if (body.method === "notifications/initialized") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      return;
    }
    if (body.method === "tools/list") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools } }));
      return;
    }
    if (body.method === "tools/call") {
      const name = body.params?.name;
      if (name === "lucy_catalog") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: JSON.stringify({ sources: catalogSources }) }] }
        }));
        return;
      }
      if (name === "lucy_read_source") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ sourceName: body.params?.arguments?.sourceName }) }],
            ...(omitMeta ? {} : {
              _meta: {
                lucy: {
                  contract: "lucy-r1-controlled-data-service",
                  tool: "lucy_read_source",
                  upstreamTool: "sl_read_source"
                }
              }
            })
          }
        }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "unknown tool" }] } }));
      return;
    }

    res.statusCode = 400;
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "not found" } }));
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/mcp`,
        close: () => new Promise((done) => {
          server.closeIdleConnections?.();
          for (const socket of sockets) socket.destroy();
          server.close(done);
        })
      });
    });
  });
}

function runNodeAsync(args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: process.env.TMPDIR,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "p1-endpoint-smoke-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("P1 endpoint smoke passes against a reachable authenticated proxy with explicit source", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub();
    try {
      const outFile = path.join(dir, "p1.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--out", outFile
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.status, "pass");
      assert.equal(evidence.checks.precheck, "pass");
      assert.equal(evidence.checks.reachable, "pass");
      assert.equal(evidence.checks.initialize, "pass");
      assert.equal(evidence.checks.toolsList, "pass");
      assert.equal(evidence.checks.keyToolForwarding, "pass");
      assert.equal(evidence.checkDetails.keyToolForwarding.upstreamTool, "sl_read_source");
      assert.equal(JSON.stringify(evidence).includes("test-token"), false);
    } finally {
      await proxy.close();
    }
  });
});

test("P1 endpoint smoke can discover forwarding target from lucy_catalog", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub();
    try {
      const outFile = path.join(dir, "p1.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--out", outFile
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.status, "pass");
      assert.equal(evidence.checkDetails.keyToolForwarding.target.source, "lucy_catalog");
      assert.equal(evidence.checkDetails.keyToolForwarding.target.connectionId, "doris-r1");
      assert.equal(evidence.checkDetails.keyToolForwarding.target.sourceName, "ceo_metric_snapshot");
    } finally {
      await proxy.close();
    }
  });
});

test("P1 endpoint smoke is blocked at precheck when token is missing", async () => {
  await withTempDir(async (dir) => {
    const outFile = path.join(dir, "p1.json");
    const result = await runNodeAsync([
      SCRIPT,
      "--proxy-url", "http://127.0.0.1:7879/mcp",
      "--out", outFile
    ]);
    assert.equal(result.status, 2);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.checks.precheck, "blocked");
    assert.deepEqual(evidence.checkDetails.precheck.missing, ["token"]);
    assert.equal(evidence.checks.reachable, "skip");
  });
});

test("P1 endpoint smoke is blocked at precheck when proxy is not running", async () => {
  await withTempDir(async (dir) => {
    const outFile = path.join(dir, "p1.json");
    const result = await runNodeAsync([
      SCRIPT,
      "--proxy-url", "http://127.0.0.1:1/mcp",
      "--token", "test-token",
      "--out", outFile,
      "--timeout-ms", "300"
    ]);
    assert.equal(result.status, 2);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.status, "blocked");
    assert.equal(evidence.checks.precheck, "pass");
    assert.equal(evidence.checks.reachable, "blocked");
    assert.equal(evidence.checkDetails.reachable.reason, "proxy_unreachable");
  });
});

test("P1 endpoint smoke fails when initialize auth rejects the token", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ authToken: "correct-token" });
    try {
      const outFile = path.join(dir, "p1.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "wrong-token",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.status, "fail");
      assert.equal(evidence.checks.reachable, "pass");
      assert.equal(evidence.checks.initialize, "fail");
      assert.equal(evidence.checkDetails.initialize.httpStatus, 401);
      assert.equal(JSON.stringify(evidence).includes("wrong-token"), false);
    } finally {
      await proxy.close();
    }
  });
});

test("P1 endpoint smoke fails when forwarding metadata is missing", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitMeta: true });
    try {
      const outFile = path.join(dir, "p1.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.status, "fail");
      assert.equal(evidence.checks.keyToolForwarding, "fail");
      assert.equal(evidence.checkDetails.keyToolForwarding.hasLucyMeta, false);
    } finally {
      await proxy.close();
    }
  });
});
