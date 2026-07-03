import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-mcp-contract-smoke.mjs");

function startProxyStub({
  omitMeta = false,
  omitProvenance = false,
  omitTool = undefined,
  omitRequiredForTool = undefined,
  omitConcurrencyGuardrail = false,
  exposeLegacySemanticTools = false,
  extraTools = [],
  rawSqlReason = "raw_query_forbidden",
  enforceRuntimeArgumentValidation = true,
  enforceConcurrencyLimit = true,
  queryDelayMs = 25,
  lucyContract = "lucy-r1-controlled-data-service"
} = {}) {
  const sockets = new Set();
  let activeQueries = 0;
  const maxConcurrentQueries = 4;
  function inputSchemaFor(name) {
    const requiredByTool = {
      lucy_catalog: [],
      lucy_read_source: ["connectionId", "sourceName"],
      lucy_query: ["connectionId"],
      lucy_explain_query: ["connectionId"],
      lucy_freshness: ["connectionId", "sourceName"],
      lucy_begin_question: ["intentSummary"]
    };
    const required = name === omitRequiredForTool ? [] : requiredByTool[name] ?? [];
    return {
      type: "object",
      properties: Object.fromEntries(required.map((field) => [field, { type: "string" }])),
      ...(required.length > 0 ? { required } : {})
    };
  }
  const tools = [
    "lucy_catalog",
    "lucy_read_source",
    "lucy_query",
    "lucy_explain_query",
    "lucy_freshness",
    "lucy_begin_question",
    ...(exposeLegacySemanticTools ? ["sl_query", "sl_read_source"] : []),
    ...extraTools
  ]
    .filter((name) => name !== omitTool)
    .map((name) => ({
      name,
      description: `${name} test tool`,
      inputSchema: inputSchemaFor(name)
    }));

  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = JSON.parse(text);
    res.setHeader("content-type", "application/json");
    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "contract-test-session");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }));
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
      const args = body.params?.arguments ?? {};
      const invalidArgumentsReason = (() => {
        if (!enforceRuntimeArgumentValidation) return undefined;
        if (name === "lucy_query" && !args.measures && !args.query) return "invalid_arguments:lucy_query:query_shape_required";
        if (name === "lucy_explain_query" && !args.measures && !args.query) return "invalid_arguments:lucy_explain_query:query_shape_required";
        if (name === "lucy_read_source" && !args.sourceName) return "invalid_arguments:lucy_read_source:source_required";
        if (name === "lucy_freshness" && !args.sourceName) return "invalid_arguments:lucy_freshness:source_required";
        return undefined;
      })();
      if (invalidArgumentsReason) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: `Invalid arguments: ${invalidArgumentsReason}` }] } }));
        return;
      }
      if (name === "lucy_catalog") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ sources: [{ sourceName: "ceo_metric_snapshot" }] }) }] } }));
        return;
      }
      if (name === "lucy_explain_query") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{
              type: "text",
              text: JSON.stringify({
                allowed: true,
                guardrails: {
                  rawSqlAllowed: false,
                  ...(omitConcurrencyGuardrail ? {} : { maxConcurrentQueries })
                }
              })
            }]
          }
        }));
        return;
      }
      if (name === "lucy_freshness") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ mode: "metadata_only" }) }] } }));
        return;
      }
      if (name === "lucy_begin_question") {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { turnId: "turn-1" }, content: [{ type: "text", text: "turnId=turn-1" }] } }));
        return;
      }
      if (name === "lucy_read_source") {
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ sourceName: "ceo_metric_snapshot", measures: ["revenue"] }) }],
            ...(omitMeta ? {} : {
              _meta: {
                lucy: {
                  contract: lucyContract,
                  tool: "lucy_read_source",
                  upstreamTool: "sl_read_source"
                }
              }
            })
          }
        }));
        return;
      }
      if (name === "lucy_query" && body.params?.arguments?.query) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: `Access denied: ${rawSqlReason}` }] } }));
        return;
      }
      if (name === "lucy_query" && body.params?.arguments?.measures?.includes("hidden_source.revenue")) {
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "Access denied: table_forbidden:hidden_source" }] } }));
        return;
      }
      if (name === "lucy_query") {
        if (enforceConcurrencyLimit && activeQueries >= maxConcurrentQueries) {
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "Access denied: query_concurrency_exceeded" }] } }));
          return;
        }
        activeQueries += 1;
        try {
          await new Promise((resolveDelay) => setTimeout(resolveDelay, queryDelayMs));
        } finally {
          activeQueries -= 1;
        }
        const requestedLimit = body.params?.arguments?.limit;
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            structuredContent: { rows: [{ revenue: 42 }] },
            ...(omitMeta ? {} : {
              _meta: {
                lucy: {
                  contract: lucyContract,
                  result: {
                    rowCount: 1,
                    columnCount: null,
                    truncated: false
                  },
                  guardrails: {
                    effectiveLimit: requestedLimit && requestedLimit > 1000 ? 1000 : requestedLimit ?? 5,
                    maxLimit: 1000
                  },
                  ...(omitProvenance ? {} : {
                    provenance: {
                      connectionId: body.params?.arguments?.connectionId ?? null,
                      sourceName: "ceo_metric_snapshot",
                      measures: body.params?.arguments?.measures ?? null,
                      dimensions: body.params?.arguments?.dimensions ?? null,
                      filters: body.params?.arguments?.filters ?? null,
                      segments: body.params?.arguments?.segments ?? null,
                      orderBy: body.params?.arguments?.orderBy ?? body.params?.arguments?.order_by ?? null,
                      freshness: { status: "not_checked", tool: "lucy_freshness" },
                      truncation: "reported from upstream response"
                    }
                  })
                }
              }
            })
          }
        }));
        return;
      }
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { isError: true, content: [{ type: "text", text: "Access denied: tool_forbidden" }] } }));
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

function runNodeAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
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
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-contract-smoke-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("MCP contract smoke passes against a contract-compatible proxy", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub();
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      for (const [check, status] of Object.entries(evidence.checks)) {
        assert.equal(status, "pass", `${check} should pass`);
      }
      assert.equal(evidence.checkDetails.concurrencyGuardrail.denialCount, 1);
      assert.deepEqual(evidence.checkDetails.concurrencyGuardrail.deniedReasons, ["query_concurrency_exceeded"]);
      assert.deepEqual(evidence.checkDetails.toolSchemas.schemaMissing, []);
      assert.deepEqual(evidence.checkDetails.toolSchemas.invalidSchemas, []);
      assert.deepEqual(evidence.checkDetails.toolSchemas.expectedRequired.lucy_read_source, ["connectionId", "sourceName"]);
      assert.equal(evidence.checkDetails.runtimeArgumentValidation.reason, "invalid_arguments:lucy_query:query_shape_required");
      assert.equal(evidence.checkDetails.lucyMetadata.hasProvenance, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasConnectionId, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasSourceName, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasMeasures, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasDimensions, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasFilters, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasSegments, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasOrderBy, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasFreshnessStatus, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasFreshnessTool, true);
      assert.equal(evidence.checkDetails.lucyMetadata.hasTruncation, true);
      assert.deepEqual(
        evidence.checkDetails.runtimeArgumentValidation.probes.map((probe) => [probe.tool, probe.reason, probe.passed]),
        [
          ["lucy_query", "invalid_arguments:lucy_query:query_shape_required", true],
          ["lucy_explain_query", "invalid_arguments:lucy_explain_query:query_shape_required", true],
          ["lucy_read_source", "invalid_arguments:lucy_read_source:source_required", true],
          ["lucy_freshness", "invalid_arguments:lucy_freshness:source_required", true]
        ]
      );
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when Lucy query metadata lacks provenance", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitProvenance: true });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.lucyMetadata, "fail");
      assert.equal(evidence.checkDetails.lucyMetadata.hasProvenance, false);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when an R1 tool schema omits required fields", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitRequiredForTool: "lucy_read_source" });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.toolSchemas, "fail");
      assert(evidence.checkDetails.toolSchemas.invalidSchemas.some((item) => (
        item.tool === "lucy_read_source" && item.field === "connectionId" && item.reason === "required_field_missing"
      )));
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when Lucy metadata is missing", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitMeta: true });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.lucyMetadata, "fail");
      assert.equal(evidence.checks.readSourceMetadata, "fail");
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when Lucy metadata has the wrong contract", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ lucyContract: "legacy-semantic-layer" });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.lucyMetadata, "fail");
      assert.equal(evidence.checks.readSourceMetadata, "fail");
      assert.equal(evidence.checkDetails.lucyMetadata.contract, "legacy-semantic-layer");
      assert.equal(evidence.checkDetails.readSourceMetadata.contract, "legacy-semantic-layer");
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when a required R1 tool is absent", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitTool: "lucy_freshness" });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.toolSurface, "fail");
      assert.deepEqual(evidence.checkDetails.toolSurface.missingTools, ["lucy_freshness"]);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when upstream semantic tools are exposed", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ exposeLegacySemanticTools: true });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.upstreamSemanticToolsHidden, "fail");
      assert.deepEqual(evidence.checkDetails.upstreamSemanticToolsHidden.exposedUpstreamSemanticTools, ["sl_query", "sl_read_source"]);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when non-R1 tools are exposed", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ extraTools: ["wiki_search"] });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.toolSurface, "fail");
      assert.deepEqual(evidence.checkDetails.toolSurface.extraTools, ["wiki_search"]);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when concurrency guardrail metadata is missing", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ omitConcurrencyGuardrail: true });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.concurrencyGuardrail, "fail");
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when concurrency guardrail does not reject excess queries", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ enforceConcurrencyLimit: false });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.concurrencyGuardrail, "fail");
      assert.equal(evidence.checkDetails.concurrencyGuardrail.denialCount, 0);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when raw SQL rejection reason is not a guardrail reason", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ rawSqlReason: "generic_error" });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.rawSqlRejected, "fail");
      assert.equal(evidence.checkDetails.rawSqlRejected.reason, undefined);
    } finally {
      await proxy.close();
    }
  });
});

test("MCP contract smoke fails closed when runtime argument validation is missing", async () => {
  await withTempDir(async (dir) => {
    const proxy = await startProxyStub({ enforceRuntimeArgumentValidation: false });
    try {
      const outFile = path.join(dir, "contract.json");
      const result = await runNodeAsync([
        SCRIPT,
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--forbid-tool", "sql_execution",
        "--forbid-source", "hidden_source",
        "--forbid-measure", "hidden_source.revenue",
        "--out", outFile
      ]);
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.runtimeArgumentValidation, "fail");
      assert.equal(evidence.checkDetails.runtimeArgumentValidation.reason, undefined);
      assert(evidence.checkDetails.runtimeArgumentValidation.probes.some((probe) => probe.passed === false));
    } finally {
      await proxy.close();
    }
  });
});
