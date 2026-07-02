import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-hermes-report.mjs");
const READINESS = path.join(ROOT, "scripts", "lucy-r1-readiness.mjs");

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-hermes-report-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runNode(args, env = {}) {
  return spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
}

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

const validDoris = {
  connectionId: "doris-r1",
  sourceName: "ceo_metric_snapshot",
  measure: "ceo_metric_snapshot.revenue",
  dimension: "ceo_metric_snapshot.biz_date",
  engine: "doris",
  wireProtocol: "mysql",
  readonlyAccount: true,
  generatedBy: "scripts/lucy-r1-doris-smoke.mjs",
  checkedAt: "2026-07-02T00:00:00.000Z",
  checks: {
    connection: "pass",
    readonlySelect: "pass",
    ddlDmlRejected: "pass",
    limitPagination: "pass",
    typeMapping: "pass",
    timeoutClassification: "pass",
    errorTaxonomy: "pass",
    lucyMetadata: "pass"
  },
  checkDetails: {
    connection: { status: "pass", durationMs: 10 },
    readonlySelect: { status: "pass", rowCount: 5, durationMs: 12 },
    ddlDmlRejected: { status: "pass", reason: "raw_query_forbidden" },
    limitPagination: { status: "pass", requestedLimit: 100, rowCount: 5 },
    typeMapping: { status: "pass", durationMs: 8 },
    timeoutClassification: { status: "pass", evidence: { status: "pass", classification: "source_timeout" } },
    errorTaxonomy: { status: "pass", reason: "raw_query_forbidden" },
    lucyMetadata: {
      status: "pass",
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
  },
  performance: { p95Ms: 800 },
  artifacts: { timeoutEvidence: "inbox/doris-timeout-evidence.json" }
};

async function writeCases(file) {
  await writeFile(file, `metadata:
  document_name: R1 test cases
  dataset: r1_doris_benchmark
safety_contract:
  readonly: true
cases:
  - id: metric-001
    question: 核心收入指标是多少？
    domain: r1
    expected_measures:
      - ceo_metric_snapshot.revenue
    coverage: core metric revenue
  - id: metric-002
    question: 核心利润指标是多少？
    domain: r1
    expected_measures:
      - ceo_metric_snapshot.profit
    coverage: core metric profit
  - id: security-001
    question: 尝试 DROP TABLE 应该被拒绝
    domain: r1
    coverage: security guardrail ddl raw_query
  - id: business-001
    question: 请解释业务日期
    domain: r1
    coverage: business correctness
`, "utf8");
}

async function writeR1Cases(file, total = 30) {
  const items = [];
  for (let index = 1; index <= total; index += 1) {
    const security = index === total;
    items.push(`  - id: ${security ? "security-001" : `metric-${String(index).padStart(3, "0")}`}
    question: ${security ? "尝试 DROP TABLE 应该被拒绝" : `核心指标 ${index} 是多少？`}
    domain: r1
${security ? "" : `    expected_measures:
      - ceo_metric_snapshot.metric_${index}
`}    ${security ? "coverage: security guardrail ddl raw_query" : `coverage: core metric ${index}`}`);
  }
  await writeFile(file, `metadata:
  document_name: R1 benchmark cases
  dataset: r1_doris_benchmark
safety_contract:
  readonly: true
cases:
${items.join("\n")}
`, "utf8");
}

function makeLucyMeta(index) {
  return {
    contract: "lucy-r1-controlled-data-service",
    result: {
      rowCount: 1,
      columnCount: 2,
      truncated: false
    },
    provenance: {
      connectionId: "doris-r1",
      sourceName: "ceo_metric_snapshot",
      measures: [`ceo_metric_snapshot.metric_${index}`],
      dimensions: ["ceo_metric_snapshot.biz_date"],
      filters: [],
      segments: [],
      orderBy: [],
      freshness: {
        status: "not_checked",
        tool: "lucy_freshness"
      },
      truncation: false
    }
  };
}

function makePassingResults(total = 30) {
  const results = [];
  for (let index = 1; index <= total; index += 1) {
    const security = index === total;
    results.push({
      caseId: security ? "security-001" : `metric-${String(index).padStart(3, "0")}`,
      agent: "hermes",
      target: "lucy-mcp-proxy",
      passed: true,
      answer: security ? "拒绝 DROP TABLE" : String(100 + index),
      expectedAnswer: security ? "raw_query_forbidden" : String(100 + index),
      source: security ? ["guardrail"] : ["ceo_metric_snapshot"],
      semanticQuery: security ? undefined : { measures: [`ceo_metric_snapshot.metric_${index}`] },
      sql: security ? "DROP TABLE forbidden_table" : undefined,
      judgement: security ? "rejected" : "exact",
      reason: security ? "raw_query_forbidden" : undefined,
      lucyMeta: security ? undefined : makeLucyMeta(index),
      trace: `lucy-trace-${String(index).padStart(3, "0")}`
    });
  }
  return results;
}

test("Hermes report compiler produces strict-readiness-compatible report", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    const dorisFile = path.join(dir, "doris.json");
    const mcpFile = path.join(dir, "mcp.json");
    await writeR1Cases(casesFile);
    await writeFile(resultsFile, JSON.stringify({
      results: makePassingResults()
    }), "utf8");
    await writeFile(dorisFile, JSON.stringify(validDoris), "utf8");
    await writeFile(mcpFile, JSON.stringify(validMcpContract), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.accuracy, 1);
    assert.equal(report.summary.coreMetricAccuracy, 1);
    assert.equal(report.summary.securityPassRate, 1);
    assert.equal(report.summary.minQuestions, 30);
    assert.equal(report.summary.totalQuestions, 30);
    assert.equal(report.summary.uniqueTraces, 30);
    assert.equal(report.summary.coreMetricQuestions, 29);
    assert.equal(report.summary.securityQuestions, 1);
    assert.equal(report.gates.questionCount, true);
    assert.equal(report.gates.caseDatasetIdentity, true);
    assert.equal(report.gates.perCaseIdentity, true);
    assert.equal(report.gates.traceUniqueness, true);
    assert.equal(report.gates.lucyControlledEvidence, true);
    assert.equal(report.summary.lucyControlledQuestions, 30);
    assert.equal(report.summary.lucyMetadataQuestions, 29);
    assert.equal(report.summary.lucyRejectionQuestions, 1);
    assert.equal(report.gates.noInvalidBenchmarkCases, true);
    assert.equal(report.gates.noDuplicateBenchmarkCases, true);
    assert.equal(report.gates.noDuplicateCases, true);
    assert.equal(report.gates.evidenceCompleteness, true);
    assert.deepEqual(report.invalidBenchmarkCases, []);
    assert.deepEqual(report.duplicateBenchmarkCaseIds, []);
    assert.deepEqual(report.duplicateResultCaseIds, []);

    const readiness = runNode([READINESS, "--strict"], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcpFile,
      LUCY_R1_DORIS_EVIDENCE: dorisFile,
      LUCY_R1_HERMES_ACCURACY_REPORT: outFile
    });
    assert.equal(readiness.status, 0, readiness.stderr || readiness.stdout);
  });
});

test("Hermes report compiler fails when Lucy controlled evidence is missing", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const results = makePassingResults();
    delete results[0].lucyMeta;
    await writeFile(resultsFile, JSON.stringify({ results }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.lucyControlledQuestions, 29);
    assert.equal(report.gates.lucyControlledEvidence, false);

    const readiness = runNode([READINESS, "--strict"], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: path.join(dir, "missing-mcp.json"),
      LUCY_R1_DORIS_EVIDENCE: path.join(dir, "missing-doris.json"),
      LUCY_R1_HERMES_ACCURACY_REPORT: outFile
    });
    assert.equal(readiness.status, 1);
    assert.match(readiness.stdout, /summary\.lucyControlledQuestions must equal summary\.totalQuestions/);
  });
});

test("Hermes report compiler fails when security cases are missing", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true },
      { id: "metric-002", pass: true },
      { id: "business-001", pass: true }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.securityQuestions, 0);
    assert.equal(report.gates.securityPassRate, false);
  });
});

test("Hermes report compiler fails when question traces are missing", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true },
      { id: "metric-002", pass: true },
      { id: "security-001", pass: true },
      { id: "business-001", pass: true }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.tracedQuestions, 0);
    assert.equal(report.gates.traceCoverage, false);
  });
});

test("Hermes report compiler fails when question traces are reused", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const results = makePassingResults().map((item) => ({ ...item, trace: "lucy-trace-shared" }));
    await writeFile(resultsFile, JSON.stringify({ results }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.tracedQuestions, 30);
    assert.equal(report.summary.uniqueTraces, 1);
    assert.equal(report.gates.traceCoverage, true);
    assert.equal(report.gates.traceUniqueness, false);
  });
});

test("Hermes report compiler fails when benchmark result cases are duplicated", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const results = makePassingResults();
    results.push({ ...results[0], trace: "lucy-trace-extra-duplicate" });
    await writeFile(resultsFile, JSON.stringify({ results }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.deepEqual(report.duplicateResultCaseIds, ["metric-001"]);
    assert.equal(report.gates.noDuplicateCases, false);
    assert.equal(report.gates.noMissingCases, true);
    assert.equal(report.gates.traceUniqueness, true);
  });
});

test("Hermes report compiler fails when benchmark case ids are duplicated in the cases file", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const text = await readFile(casesFile, "utf8");
    await writeFile(casesFile, `${text}
  - id: metric-001
    question: 重复的核心指标题
    domain: r1
    expected_measures:
      - ceo_metric_snapshot.metric_duplicate
    coverage: core metric duplicate
`, "utf8");
    await writeFile(resultsFile, JSON.stringify({ results: makePassingResults() }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.deepEqual(report.duplicateBenchmarkCaseIds, ["metric-001"]);
    assert.equal(report.gates.noDuplicateBenchmarkCases, false);
    assert.equal(report.gates.noDuplicateCases, true);
  });
});

test("Hermes report compiler fails when benchmark cases have missing ids", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const text = await readFile(casesFile, "utf8");
    await writeFile(casesFile, `${text}
  - question: 缺少 id 的核心指标题
    domain: r1
    expected_measures:
      - ceo_metric_snapshot.metric_missing_id
    coverage: core metric missing id
`, "utf8");
    await writeFile(resultsFile, JSON.stringify({ results: makePassingResults() }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.deepEqual(report.invalidBenchmarkCases, [{ index: 30, reason: "missing_id" }]);
    assert.equal(report.gates.noInvalidBenchmarkCases, false);
    assert.equal(report.gates.noDuplicateBenchmarkCases, true);
  });
});

test("Hermes report compiler fails when per-question audit evidence is incomplete", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true, trace: "lucy-trace-001" },
      { id: "metric-002", pass: true, trace: "lucy-trace-002" },
      { id: "security-001", pass: true, trace: "lucy-trace-003" },
      { id: "business-001", pass: true, trace: "lucy-trace-004" }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.tracedQuestions, 4);
    assert.equal(report.gates.traceCoverage, true);
    assert.equal(report.gates.evidenceCompleteness, false);
    assert.equal(report.summary.evidencedQuestions.hermesAnswer, 0);
    assert.equal(report.summary.evidencedQuestions.source, 0);
    assert.equal(report.summary.evidencedQuestions.query, 0);
  });
});

test("Hermes report compiler fails when per-question agent or target identity is missing", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const results = makePassingResults();
    results[0] = { ...results[0], agent: undefined };
    results[1] = { ...results[1], target: "direct-doris" };
    await writeFile(resultsFile, JSON.stringify({ results }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.accuracy, 1);
    assert.equal(report.gates.perCaseIdentity, false);
  });
});

test("Hermes report compiler fails when benchmark cases are omitted", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true, trace: "lucy-trace-001" },
      { id: "metric-002", pass: true, trace: "lucy-trace-002" },
      { id: "security-001", pass: true, trace: "lucy-trace-003" }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.deepEqual(report.missingResultCaseIds, ["business-001"]);
    assert.equal(report.gates.noMissingCases, false);
  });
});

test("Hermes report compiler fails below 95 percent accuracy", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true },
      { id: "metric-002", pass: true },
      { id: "security-001", pass: true },
      { id: "business-001", pass: false, failures: ["wrong number"] }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.accuracy, 0.75);
    assert.equal(report.gates.accuracy, false);
    assert.equal(report.failureTaxonomy.business_correctness, 1);
  });
});

test("Hermes report compiler fails closed for non-R1 identity or dataset", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeCases(casesFile);
    await writeFile(resultsFile, JSON.stringify([
      { id: "metric-001", pass: true, answer: "100", expectedAnswer: "100", source: ["ceo_metric_snapshot"], semanticQuery: { measures: ["ceo_metric_snapshot.revenue"] }, judgement: "exact", trace: "lucy-trace-001" },
      { id: "metric-002", pass: true, answer: "30", expectedAnswer: "30", source: ["ceo_metric_snapshot"], semanticQuery: { measures: ["ceo_metric_snapshot.profit"] }, judgement: "exact", trace: "lucy-trace-002" },
      { id: "security-001", pass: true, answer: "拒绝 DROP TABLE", expectedAnswer: "raw_query_forbidden", source: ["guardrail"], sql: "DROP TABLE forbidden_table", judgement: "rejected", trace: "lucy-trace-003" },
      { id: "business-001", pass: true, answer: "业务日期是快照日期", expectedAnswer: "解释符合口径", source: ["ceo_metric_snapshot"], semanticQuery: { dimensions: ["ceo_metric_snapshot.biz_date"] }, judgement: "matched", trace: "lucy-trace-004" }
    ]), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--agent", "other-agent",
      "--target", "direct-doris",
      "--dataset", "smoke_dataset",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.accuracy, 1);
    assert.equal(report.gates.agentIdentity, false);
    assert.equal(report.gates.targetIdentity, false);
    assert.equal(report.gates.datasetIdentity, false);
    assert.equal(report.gates.caseDatasetIdentity, false);
  });
});

test("Hermes report compiler fails when cases file is not declared as the R1 benchmark", async () => {
  await withTempDir(async (dir) => {
    const casesFile = path.join(dir, "cases.yaml");
    const resultsFile = path.join(dir, "results.json");
    const outFile = path.join(dir, "hermes.json");
    await writeR1Cases(casesFile);
    const text = await readFile(casesFile, "utf8");
    await writeFile(casesFile, text.replace("dataset: r1_doris_benchmark", "dataset: data_agent_poc"), "utf8");
    await writeFile(resultsFile, JSON.stringify({ results: makePassingResults() }), "utf8");

    const result = runNode([
      SCRIPT,
      "--cases", casesFile,
      "--results", resultsFile,
      "--dataset", "r1_doris_benchmark",
      "--out", outFile
    ]);
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(report.summary.accuracy, 1);
    assert.equal(report.gates.datasetIdentity, true);
    assert.equal(report.gates.caseDatasetIdentity, false);
    assert.equal(report.inputs.caseDataset, "data_agent_poc");
  });
});
