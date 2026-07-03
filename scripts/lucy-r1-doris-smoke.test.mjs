import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-doris-smoke.mjs");
const READINESS = path.join(ROOT, "scripts", "lucy-r1-readiness.mjs");

const validHermesCases = Array.from({ length: 30 }, (_, index) => {
  const n = index + 1;
  const security = n % 5 === 0;
  return {
    id: security ? `security-${String(n).padStart(3, "0")}` : `metric-${String(n).padStart(3, "0")}`,
    agent: "hermes",
    target: "lucy-mcp-proxy",
    question: security ? `第 ${n} 个越权问题是否被拒绝？` : `第 ${n} 个核心指标是多少？`,
    hermesAnswer: security ? "raw_query_forbidden" : "100",
    expectedAnswer: security ? "raw_query_forbidden" : "100",
    source: security ? ["guardrail"] : ["ceo_metric_snapshot"],
    query: security ? "DROP TABLE forbidden_table" : { measures: ["ceo_metric_snapshot.revenue"] },
    judgement: security ? "rejected" : "exact",
    passed: true,
    coreMetric: !security,
    security,
    rejectionReason: security ? "raw_query_forbidden" : undefined,
    lucyMetaSummary: security ? {
      hasLucyMeta: false
    } : {
      hasLucyMeta: true,
      contract: "lucy-r1-controlled-data-service",
      hasLucyR1Contract: true,
      hasResultSummary: true,
      hasProvenance: true,
      hasConnectionId: true,
      hasSourceName: true,
      hasMeasures: true,
      hasDimensions: true,
      hasFilters: true,
      hasSegments: true,
      hasOrderBy: true,
      hasFreshnessStatus: true,
      hasFreshnessTool: true,
      hasTruncation: true
    },
    lucyControlledEvidence: true,
    trace: `lucy-trace-${String(n).padStart(3, "0")}`
  };
});

const validHermes = {
  agent: "hermes",
  target: "lucy-mcp-proxy",
  dataset: "r1_doris_benchmark",
  checkedAt: "2026-07-02T00:00:00.000Z",
  generatedBy: "scripts/lucy-r1-hermes-report.mjs",
  inputs: {
    cases: "evals/r1_doris_benchmark/eval/r1_doris_benchmark-eval-cases.yaml",
    results: "inbox/hermes-r1-results.json",
    caseDataset: "r1_doris_benchmark"
  },
  summary: {
    accuracy: 1.0,
    coreMetricAccuracy: 1.0,
    securityPassRate: 1.0,
    totalQuestions: validHermesCases.length,
    passedQuestions: validHermesCases.length,
    failedQuestions: 0,
    tracedQuestions: validHermesCases.length,
    uniqueTraces: validHermesCases.length,
    minQuestions: 30,
    evidencedQuestions: {
      question: validHermesCases.length,
      hermesAnswer: validHermesCases.length,
      expectedAnswer: validHermesCases.length,
      source: validHermesCases.length,
      query: validHermesCases.length,
      judgement: validHermesCases.length
    },
    lucyControlledQuestions: validHermesCases.length,
    lucyMetadataQuestions: validHermesCases.filter((item) => !item.security).length,
    lucyRejectionQuestions: validHermesCases.filter((item) => item.security).length,
    coreMetricQuestions: validHermesCases.filter((item) => item.coreMetric).length,
    securityQuestions: validHermesCases.filter((item) => item.security).length
  },
  gates: {
    agentIdentity: true,
    targetIdentity: true,
    datasetIdentity: true,
    caseDatasetIdentity: true,
    perCaseIdentity: true,
    questionCount: true,
    accuracy: true,
    coreMetricAccuracy: true,
    securityPassRate: true,
    traceCoverage: true,
    traceUniqueness: true,
    evidenceCompleteness: true,
    lucyControlledEvidence: true,
    noInvalidBenchmarkCases: true,
    noInvalidResults: true,
    noUnknownCases: true,
    noDuplicateBenchmarkCases: true,
    noDuplicateCases: true,
    noMissingCases: true
  },
  invalidBenchmarkCases: [],
  duplicateBenchmarkCaseIds: [],
  duplicateResultCaseIds: [],
  cases: validHermesCases
};

const validMcpContract = {
  contract: "lucy-r1-controlled-data-service",
  target: "lucy-mcp-proxy",
  generatedBy: "scripts/lucy-r1-mcp-contract-smoke.mjs",
  checkedAt: "2026-07-02T00:00:00.000Z",
  proxyUrl: "http://127.0.0.1:7879/mcp",
  connectionId: "doris-r1",
  sourceName: "ceo_metric_snapshot",
  checks: {
    initialize: "pass",
    toolSurface: "pass",
    upstreamSemanticToolsHidden: "pass",
    toolSchemas: "pass",
    negativeSamples: "pass",
    deniedToolsHidden: "pass",
    forbiddenToolRejected: "pass",
    catalog: "pass",
    forbiddenTableRejected: "pass",
    explainQuery: "pass",
    concurrencyGuardrail: "pass",
    freshness: "pass",
    beginQuestion: "pass",
    rawSqlRejected: "pass",
    runtimeArgumentValidation: "pass",
    limitCapped: "pass",
    readSourceMetadata: "pass",
    lucyMetadata: "pass"
  },
  checkDetails: {
    toolSurface: {
      expectedTools: [
        "lucy_catalog",
        "lucy_read_source",
        "lucy_query",
        "lucy_explain_query",
        "lucy_freshness",
        "lucy_begin_question"
      ],
      missingTools: [],
      extraTools: []
    },
    toolSchemas: {
      schemaMissing: [],
      invalidSchemas: [],
      expectedRequired: {
        lucy_catalog: [],
        lucy_read_source: ["connectionId", "sourceName"],
        lucy_query: ["connectionId"],
        lucy_explain_query: ["connectionId"],
        lucy_freshness: ["connectionId", "sourceName"],
        lucy_begin_question: ["intentSummary"]
      }
    },
    negativeSamples: {
      forbiddenTools: ["sql_execution"],
      forbiddenSources: ["hidden_source"],
      forbiddenMeasures: ["hidden_source.revenue"]
    },
    upstreamSemanticToolsHidden: {
      forbiddenUpstreamSemanticTools: ["sl_query", "sl_read_source"],
      exposedUpstreamSemanticTools: []
    },
    deniedToolsHidden: {
      exposedForbiddenTools: []
    },
    forbiddenToolRejected: {
      reason: "tool_forbidden"
    },
    catalog: {
      leakedSources: []
    },
    forbiddenTableRejected: {
      reason: "table_forbidden:hidden_source"
    },
    rawSqlRejected: {
      reason: "raw_query_forbidden"
    },
    runtimeArgumentValidation: {
      reason: "invalid_arguments:lucy_query:query_shape_required",
      probes: [
        { tool: "lucy_query", reason: "invalid_arguments:lucy_query:query_shape_required", passed: true },
        { tool: "lucy_explain_query", reason: "invalid_arguments:lucy_explain_query:query_shape_required", passed: true },
        { tool: "lucy_read_source", reason: "invalid_arguments:lucy_read_source:source_required", passed: true },
        { tool: "lucy_freshness", reason: "invalid_arguments:lucy_freshness:source_required", passed: true }
      ]
    },
    limitCapped: {
      effectiveLimit: 1000,
      maxLimit: 1000
    },
    concurrencyGuardrail: {
      maxConcurrentQueries: 4,
      attempted: true,
      probeCount: 5,
      denialCount: 1,
      deniedReasons: ["query_concurrency_exceeded"]
    },
    readSourceMetadata: {
      hasLucyMeta: true,
      contract: "lucy-r1-controlled-data-service",
      hasLucyR1Contract: true
    },
    lucyMetadata: {
      hasLucyMeta: true,
      contract: "lucy-r1-controlled-data-service",
      hasLucyR1Contract: true,
      hasResultSummary: true,
      hasProvenance: true,
      hasConnectionId: true,
      hasSourceName: true,
      hasMeasures: true,
      hasDimensions: true,
      hasFilters: true,
      hasSegments: true,
      hasOrderBy: true,
      hasFreshnessStatus: true,
      hasFreshnessTool: true,
      hasTruncation: true
    }
  }
};

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-doris-smoke-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeFakeKtx(dir) {
  const binDir = path.join(dir, "bin");
  await mkdir(binDir, { recursive: true });
  const file = path.join(binDir, "ktx");
  await writeFile(file, `#!/usr/bin/env node
const args = process.argv.slice(2);
const clean = args[0] === "--project-dir" ? args.slice(2) : args;
if (clean[0] === "connection" && clean[1] === "test") {
  console.log("Connection OK");
  process.exit(0);
}
if (clean[0] === "sl" && clean[1] === "validate") {
  console.log("Valid semantic-layer source");
  process.exit(0);
}
if (clean[0] === "sl" && clean.includes("query")) {
  console.log(JSON.stringify({ rows: [{ biz_date: "2026-07-01", revenue: 42 }] }));
  process.exit(0);
}
console.error("unexpected ktx args: " + clean.join(" "));
process.exit(1);
`, "utf8");
  await chmod(file, 0o755);
  return binDir;
}

function parseRpcBody(text) {
  return JSON.parse(text);
}

function startProxyStub() {
  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    const body = parseRpcBody(text);
    res.setHeader("content-type", "application/json");
    if (body.method === "initialize") {
      res.setHeader("mcp-session-id", "r1-test-session");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {} } }));
      return;
    }
    if (body.method === "notifications/initialized") {
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "lucy_query" && body.params?.arguments?.query) {
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          isError: true,
          content: [{ type: "text", text: "Access denied: raw_query_forbidden" }]
        }
      }));
      return;
    }
    if (body.method === "tools/call" && body.params?.name === "lucy_query") {
      res.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          structuredContent: { rows: [{ biz_date: "2026-07-01", revenue: 42 }] },
          _meta: {
            lucy: {
              contract: "lucy-r1-controlled-data-service",
              result: {
                rowCount: 1,
                columnCount: null,
                truncated: false
              },
              provenance: {
                connectionId: body.params?.arguments?.connectionId ?? null,
                sourceName: "ceo_metric_snapshot",
                measures: body.params?.arguments?.measures ?? [],
                dimensions: body.params?.arguments?.dimensions ?? [],
                filters: body.params?.arguments?.filters ?? null,
                segments: body.params?.arguments?.segments ?? null,
                orderBy: body.params?.arguments?.orderBy ?? null,
                freshness: {
                  status: "not_checked",
                  tool: "lucy_freshness"
                },
                truncation: false
              }
            }
          }
        }
      }));
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

function runNode(args, options) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 10_000,
    ...options,
    env: { ...process.env, ...(options?.env ?? {}) }
  });
}

function runNodeAsync(args, options) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: { ...process.env, ...(options?.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 10_000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ status: code, signal, stdout, stderr });
    });
  });
}

test("Doris smoke generator writes strict-readiness-compatible evidence when all checks pass", async () => {
  await withTempDir(async (dir) => {
    const binDir = await writeFakeKtx(dir);
    const proxy = await startProxyStub();
    try {
      const timeoutFile = path.join(dir, "timeout.json");
      const outFile = path.join(dir, "doris.json");
      const hermesFile = path.join(dir, "hermes.json");
      const mcpFile = path.join(dir, "mcp.json");
      await writeFile(timeoutFile, JSON.stringify({ status: "pass", classification: "source_timeout" }), "utf8");
      await writeFile(hermesFile, JSON.stringify(validHermes), "utf8");
      await writeFile(mcpFile, JSON.stringify(validMcpContract), "utf8");

      const result = await runNodeAsync([
        SCRIPT,
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--timeout-evidence", timeoutFile,
        "--readonly-account-confirmed",
        "--out", outFile
      ], {
        env: { PATH: `${binDir}:${process.env.PATH}` }
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);

      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.engine, "doris");
      assert.equal(evidence.wireProtocol, "mysql");
      assert.equal(evidence.readonlyAccount, true);
      for (const [check, status] of Object.entries(evidence.checks)) {
        assert.equal(status, "pass", `${check} should pass`);
      }

      const readiness = runNode([READINESS, "--strict"], {
        env: {
          LUCY_R1_MCP_CONTRACT_EVIDENCE: mcpFile,
          LUCY_R1_DORIS_EVIDENCE: outFile,
          LUCY_R1_HERMES_ACCURACY_REPORT: hermesFile
        }
      });
      assert.equal(readiness.status, 0, readiness.stderr || readiness.stdout);
    } finally {
      await proxy.close();
    }
  });
});

test("OLAP smoke generator writes StarRocks evidence when all checks pass with stubbed runtime", async () => {
  await withTempDir(async (dir) => {
    const binDir = await writeFakeKtx(dir);
    const proxy = await startProxyStub();
    try {
      const timeoutFile = path.join(dir, "timeout.json");
      const outFile = path.join(dir, "starrocks.json");
      await writeFile(timeoutFile, JSON.stringify({ status: "pass", classification: "source_timeout" }), "utf8");

      const result = await runNodeAsync([
        SCRIPT,
        "--engine", "starrocks",
        "--connection", "starrocks-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--timeout-evidence", timeoutFile,
        "--readonly-account-confirmed",
        "--out", outFile
      ], {
        env: { PATH: `${binDir}:${process.env.PATH}` }
      });
      assert.equal(result.status, 0, result.stderr || result.stdout || result.signal);

      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.connectionId, "starrocks-r1");
      assert.equal(evidence.engine, "starrocks");
      assert.equal(evidence.wireProtocol, "mysql");
      assert.equal(evidence.generatedBy, "scripts/lucy-r1-doris-smoke.mjs --engine starrocks");
      for (const [check, status] of Object.entries(evidence.checks)) {
        assert.equal(status, "pass", `${check} should pass`);
      }
    } finally {
      await proxy.close();
    }
  });
});

test("Doris smoke generator fails closed when proxy evidence is missing", async () => {
  await withTempDir(async (dir) => {
    const binDir = await writeFakeKtx(dir);
    const timeoutFile = path.join(dir, "timeout.json");
    const outFile = path.join(dir, "doris.json");
    await writeFile(timeoutFile, JSON.stringify({ status: "pass", classification: "source_timeout" }), "utf8");

    const result = runNode([
      SCRIPT,
      "--connection", "doris-r1",
      "--source", "ceo_metric_snapshot",
      "--measure", "ceo_metric_snapshot.revenue",
      "--timeout-evidence", timeoutFile,
      "--readonly-account-confirmed",
      "--out", outFile
    ], {
      env: { PATH: `${binDir}:${process.env.PATH}` }
    });
    assert.equal(result.status, 1);
    const evidence = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(evidence.checks.ddlDmlRejected, "fail");
    assert.equal(evidence.checks.lucyMetadata, "fail");
    assert.equal(evidence.checks.errorTaxonomy, "fail");
  });
});

test("Doris smoke generator fails closed when timeout evidence is not source_timeout", async () => {
  await withTempDir(async (dir) => {
    const binDir = await writeFakeKtx(dir);
    const proxy = await startProxyStub();
    try {
      const timeoutFile = path.join(dir, "timeout.json");
      const outFile = path.join(dir, "doris.json");
      await writeFile(timeoutFile, JSON.stringify({ status: "pass", classification: "query_timeout" }), "utf8");

      const result = await runNodeAsync([
        SCRIPT,
        "--connection", "doris-r1",
        "--source", "ceo_metric_snapshot",
        "--measure", "ceo_metric_snapshot.revenue",
        "--dimension", "ceo_metric_snapshot.biz_date",
        "--proxy-url", proxy.url,
        "--token", "test-token",
        "--timeout-evidence", timeoutFile,
        "--readonly-account-confirmed",
        "--out", outFile
      ], {
        env: { PATH: `${binDir}:${process.env.PATH}` }
      });
      assert.equal(result.status, 1);
      const evidence = JSON.parse(await readFile(outFile, "utf8"));
      assert.equal(evidence.checks.timeoutClassification, "fail");
      assert.equal(evidence.checkDetails.timeoutClassification.evidence.classification, "query_timeout");
    } finally {
      await proxy.close();
    }
  });
});
