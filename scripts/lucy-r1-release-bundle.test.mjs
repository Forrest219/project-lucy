import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-release-bundle.mjs");
const CURRENT_TIME = new Date().toISOString();
const STALE_TIME = "2026-01-01T00:00:00.000Z";

const validMcpContract = {
  contract: "lucy-r1-controlled-data-service",
  target: "lucy-mcp-proxy",
  generatedBy: "scripts/lucy-r1-mcp-contract-smoke.mjs",
  checkedAt: CURRENT_TIME,
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
  checkedAt: CURRENT_TIME,
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

function makeHermesCases(total = 30) {
  const cases = [];
  for (let index = 1; index <= total; index += 1) {
    const security = index === total;
    cases.push({
      id: security ? "security-001" : `metric-${String(index).padStart(3, "0")}`,
      agent: "hermes",
      target: "lucy-mcp-proxy",
      question: security ? "DROP TABLE 是否被拒绝？" : `核心指标 ${index} 是多少？`,
      hermesAnswer: security ? "raw_query_forbidden" : String(100 + index),
      expectedAnswer: security ? "raw_query_forbidden" : String(100 + index),
      source: security ? ["guardrail"] : ["ceo_metric_snapshot"],
      query: security ? "DROP TABLE forbidden_table" : { measures: [`ceo_metric_snapshot.metric_${index}`] },
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
      trace: `lucy-trace-${String(index).padStart(3, "0")}`
    });
  }
  return cases;
}

const validHermesCases = makeHermesCases();

const validHermes = {
  agent: "hermes",
  target: "lucy-mcp-proxy",
  dataset: "r1_doris_benchmark",
  checkedAt: CURRENT_TIME,
  generatedBy: "scripts/lucy-r1-hermes-report.mjs",
  inputs: {
    cases: "evals/r1_doris_benchmark/eval/r1_doris_benchmark-eval-cases.yaml",
    results: "inbox/hermes-r1-results.json",
    caseDataset: "r1_doris_benchmark"
  },
  summary: {
    accuracy: 1,
    coreMetricAccuracy: 1,
    securityPassRate: 1,
    totalQuestions: validHermesCases.length,
    passedQuestions: validHermesCases.length,
    failedQuestions: 0,
    tracedQuestions: validHermesCases.length,
    uniqueTraces: validHermesCases.length,
    evidencedQuestions: {
      question: validHermesCases.length,
      hermesAnswer: validHermesCases.length,
      expectedAnswer: validHermesCases.length,
      source: validHermesCases.length,
      query: validHermesCases.length,
      judgement: validHermesCases.length
    },
    lucyControlledQuestions: validHermesCases.length,
    lucyMetadataQuestions: validHermesCases.length - 1,
    lucyRejectionQuestions: 1,
    minQuestions: 30,
    coreMetricQuestions: validHermesCases.length - 1,
    securityQuestions: 1
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

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-release-bundle-"));
  try {
    await writeReadyReleaseConfig(dir);
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runBundle(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, LUCY_R1_RELEASE_CONFIG_ROOT: path.dirname(args[args.indexOf("--out") + 1]), ...env }
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeReadyReleaseConfig(dir) {
  await mkdir(path.join(dir, "webui", "config"), { recursive: true });
  await writeFile(path.join(dir, "ktx.yaml"), `
connections:
  doris-r1:
    driver: mysql
    engine: doris
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - mart.ceo_metric_snapshot
`, "utf8");
  await writeFile(path.join(dir, "webui", "config", "access.yaml"), `
roles:
  lucy_r1_exact_readonly:
    allow:
      connections:
        - doris-r1
      tableSelectors:
        - connection: doris-r1
          schema: mart
          names:
            - ceo_metric_snapshot
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
`, "utf8");
}

async function writePocReleaseConfig(dir) {
  await mkdir(path.join(dir, "webui", "config"), { recursive: true });
  await writeFile(path.join(dir, "ktx.yaml"), `
connections:
  poc-mysql-aliyun:
    driver: mysql
    enabled_tables:
      - data_agent_poc.poc_ceo_metric_snapshot
`, "utf8");
  await writeFile(path.join(dir, "webui", "config", "access.yaml"), `
roles:
  lucy_r1_exact_readonly:
    allow:
      connections:
        - poc-mysql-aliyun
      tableSelectors:
        - connection: poc-mysql-aliyun
          schema: data_agent_poc
          names:
            - poc_ceo_metric_snapshot
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
`, "utf8");
}

async function writeEvalArtifact(dir, cases = validHermesCases) {
  await mkdir(path.join(dir, "traces"), { recursive: true });
  await writeJson(path.join(dir, "summary.json"), {
    accuracy: 1,
    dataset: "r1_doris_benchmark",
    agent: "hermes",
    target: "lucy-mcp-proxy",
    cases: cases.map((item) => ({ id: item.id, trace: item.trace }))
  });
  await writeFile(
    path.join(dir, "traces", "cases.jsonl"),
    cases.map((item) => JSON.stringify({
      ok: true,
      agent: "hermes",
      target: "lucy-mcp-proxy",
      caseId: item.id,
      trace: item.trace
    })).join("\n") + "\n",
    "utf8"
  );
}

const validObservability = {
  ok: true,
  data: {
    generatedAt: CURRENT_TIME,
    audit: {
      traffic: {
        totalRequests: 10,
        businessCalls: 9,
        okCalls: 7,
        errorCalls: 1,
        deniedCalls: 1,
        successRate: 7 / 9,
        errorRate: 1 / 9,
        deniedRate: 1 / 9
      },
      latency: {
        p50Ms: 120,
        p95Ms: 2000,
        slowCalls: 1,
        slowQueries: [{ requestId: "query-slow", durationMs: 50000, decisionReason: "source_timeout" }]
      },
      denials: [{ reason: "query_concurrency_exceeded", count: 1 }],
      sourceErrors: [{ source: "doris-r1.mart.ceo_metric_snapshot", outcome: "error", count: 1 }],
      usage: {
        tools: [{ tool: "lucy_query", calls: 9, denied: 1, errors: 1 }],
        roles: [{ roleId: "lucy_r1_exact_readonly", calls: 9, denied: 1 }],
        tokens: [{ tokenLabel: "hermes", calls: 9, denied: 1 }]
      }
    },
    eval: {
      latestRun: {
        domain: "r1_doris_smoke",
        status: "succeeded",
        totalCases: 20,
        passCount: 19,
        failCount: 1,
        passRate: 0.95
      },
      recent: {
        runs: 1,
        totalCases: 20,
        passCount: 19,
        failCount: 1,
        passRate: 0.95
      }
    },
    hermesQa: {
      status: "passed",
      agent: "hermes",
      target: "lucy-mcp-proxy",
      generatedBy: "scripts/lucy-r1-hermes-report.mjs",
      dataset: "r1_doris_benchmark",
      caseDataset: "r1_doris_benchmark",
      accuracy: 1,
      coreMetricAccuracy: 1,
      securityPassRate: 1,
      agentIdentityGatePassed: true,
      targetIdentityGatePassed: true,
      datasetIdentityGatePassed: true,
      caseDatasetIdentityGatePassed: true,
      perCaseIdentityGatePassed: true,
      noInvalidBenchmarkCasesGatePassed: true,
      traceUniquenessGatePassed: true,
      noDuplicateCasesGatePassed: true,
      noDuplicateBenchmarkCasesGatePassed: true,
      lucyControlledEvidenceGatePassed: true,
      generatedByGatePassed: true,
      tracedQuestions: validHermesCases.length,
      uniqueTraces: validHermesCases.length,
      totalQuestions: validHermesCases.length,
      lucyControlledQuestions: validHermesCases.length,
      lucyMetadataQuestions: validHermesCases.length - 1,
      lucyRejectionQuestions: 1,
      minQuestions: 30,
      evidencedQuestions: {
        question: validHermesCases.length,
        hermesAnswer: validHermesCases.length,
        expectedAnswer: validHermesCases.length,
        source: validHermesCases.length,
        query: validHermesCases.length,
        judgement: validHermesCases.length
      },
      threshold: 0.95
    },
    releaseSignals: {
      trafficObservable: true,
      deniedReasonsObservable: true,
      sourceErrorsObservable: true,
      evalObservable: true,
      hermesQuestionCountGatePassed: true,
      hermesAccuracyGatePassed: true,
      hermesCoreMetricGatePassed: true,
      hermesSecurityGatePassed: true,
      hermesTraceCoverageGatePassed: true,
      hermesTraceUniquenessGatePassed: true,
      hermesNoDuplicateCasesGatePassed: true,
      hermesNoDuplicateBenchmarkCasesGatePassed: true,
      hermesEvidenceCompletenessGatePassed: true,
      hermesLucyControlledEvidenceGatePassed: true,
      hermesPerCaseIdentityGatePassed: true,
      hermesNoInvalidBenchmarkCasesGatePassed: true,
      hermesReportGatePassed: true
    }
  }
};

test("release bundle copies validated evidence and writes a manifest", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "eval-artifact");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);
    await writeEvalArtifact(evalDir);

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, true);
    assert.equal(manifest.releaseDecision, "ready_for_human_approval");
    assert.equal(manifest.evidence.mcpContract.sha256.length, 64);
    assert.equal(manifest.evidence.doris.sha256.length, 64);
    assert.equal(manifest.evidence.hermes.sha256.length, 64);
    assert.equal(manifest.observability.status, "copied");
    assert.equal(manifest.observability.validation.ok, true);
    assert.equal(manifest.consistency.ok, true);
    assert.equal(manifest.consistency.connectionId, "doris-r1");
    assert.equal(manifest.consistency.sourceName, "ceo_metric_snapshot");
    assert.equal(manifest.consistency.hermesTotalQuestions, validHermesCases.length);
    assert.equal(manifest.consistency.hermesAccuracy, 1);
    assert.deepEqual(manifest.consistency.concurrencyDenials, {
      mcpDenialCount: 1,
      observedDenialCount: 1,
      usageToolDeniedCount: 1
    });
    assert.equal(manifest.consistency.hermesSourceCoverage.ok, true);
    assert.deepEqual(manifest.consistency.hermesSourceCoverage.matchingCaseIds.slice(0, 2), ["metric-001", "metric-002"]);
    assert.equal(manifest.consistency.timing.maxWindowHours, 24);
    assert.deepEqual(manifest.localConfig, {
      ok: true,
      root: dir,
      connectionId: "doris-r1",
      sourceName: "ceo_metric_snapshot",
      exactRole: "lucy_r1_exact_readonly"
    });
    assert.equal(manifest.evalArtifacts.length, 1);
    assert.equal(manifest.evalArtifacts[0].identity.passed, true);
    assert.equal(manifest.evalArtifacts[0].coverage.passed, true);
    assert.equal(manifest.evalArtifacts[0].coverage.totalCaseIds, validHermesCases.length);
    assert.equal(manifest.evalArtifacts[0].coverage.totalTraceIds, validHermesCases.length);
    assert.equal(manifest.readiness.status, 0);
  });
});

test("release bundle fails closed when local release config is still pointed at POC instead of Doris", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "eval-artifact");
    const out = path.join(dir, "bundle");
    const pocConfigRoot = path.join(dir, "poc-config");
    await writePocReleaseConfig(pocConfigRoot);
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);
    await writeEvalArtifact(evalDir);

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes,
      LUCY_R1_RELEASE_CONFIG_ROOT: pocConfigRoot
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release local config is not ready for Doris R1/);
    assert.match(manifest.reason, /ktx.yaml must define connections\.doris-r1/);
    assert.match(manifest.reason, /lucy_r1_exact_readonly\.allow\.connections must be exactly \["doris-r1"\]/);
    assert.match(manifest.reason, /lucy_r1_exact_readonly\.allow\.tableSelectors must only reference doris-r1/);
  });
});

test("release bundle fails closed when Hermes cases do not reference the Doris evidence source", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "eval-artifact");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, {
      ...validHermes,
      cases: validHermesCases.map((item) => ({
        ...item,
        source: item.security ? ["guardrail"] : ["another_r1_source"],
        query: item.security ? item.query : { measures: ["another_r1_source.metric"] }
      }))
    });
    await writeJson(observability, validObservability);
    await writeEvalArtifact(evalDir);

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /Hermes cases must reference Doris evidence sourceName/);
  });
});

test("release bundle requires at least one eval artifact for a ready release", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /at least one --eval-artifact is required/);
  });
});

test("release bundle rejects eval artifacts without R1 Hermes and Lucy identity markers", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "unrelated-eval-artifact");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);
    await mkdir(evalDir, { recursive: true });
    await writeJson(path.join(evalDir, "summary.json"), { accuracy: 1, dataset: "legacy_eval" });

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /R1 Hermes\/Lucy identity markers/);
  });
});

test("release bundle rejects eval artifacts without Hermes case and trace coverage", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "incomplete-eval-artifact");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);
    await mkdir(evalDir, { recursive: true });
    await writeJson(path.join(evalDir, "summary.json"), {
      accuracy: 1,
      dataset: "r1_doris_benchmark",
      agent: "hermes",
      target: "lucy-mcp-proxy",
      cases: [{ id: validHermesCases[0].id, trace: validHermesCases[0].trace }]
    });

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /cover every Hermes case id and trace id/);
  });
});

test("release bundle fails closed when evidence files are individually valid but inconsistent", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, {
      ...validMcpContract,
      sourceName: "ceo_metric_snapshot"
    });
    await writeJson(doris, {
      ...validDoris,
      sourceName: "another_r1_source"
    });
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /MCP\/Doris sourceName mismatch/);
  });
});

test("release bundle fails closed when observability source diagnostics are not tied to Doris evidence", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        audit: {
          ...validObservability.data.audit,
          sourceErrors: [{ source: "mysql-legacy.mart.other_source", outcome: "error", count: 1 }],
          latency: {
            ...validObservability.data.audit.latency,
            slowQueries: [{ requestId: "query-slow", durationMs: 50000, decisionReason: "legacy_timeout" }]
          }
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /observability sourceErrors must reference Doris evidence connectionId or sourceName/);
    assert.match(manifest.reason, /observability slowQueries must reference Doris source or source_timeout/);
  });
});

test("release bundle fails closed when observability Hermes case dataset is not R1", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          caseDataset: "data_agent_poc",
          caseDatasetIdentityGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.caseDataset must be "r1_doris_benchmark"/);
    assert.match(manifest.reason, /data.hermesQa.caseDatasetIdentityGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes agent is not Hermes", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          agent: "ad-hoc-agent",
          agentIdentityGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.agent must be "hermes"/);
    assert.match(manifest.reason, /data.hermesQa.agentIdentityGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes target is not Lucy MCP Proxy", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          target: "direct-doris",
          targetIdentityGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.target must be "lucy-mcp-proxy"/);
    assert.match(manifest.reason, /data.hermesQa.targetIdentityGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes generatedBy is not the R1 report generator", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          generatedBy: "scripts/manual-hermes-summary.mjs",
          generatedByGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.generatedBy must be "scripts\/lucy-r1-hermes-report.mjs"/);
    assert.match(manifest.reason, /data.hermesQa.generatedByGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes per-case identity gate fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          perCaseIdentityGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesPerCaseIdentityGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.perCaseIdentityGatePassed must be true/);
    assert.match(manifest.reason, /data.releaseSignals.hermesPerCaseIdentityGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes trace uniqueness gate fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          uniqueTraces: validHermesCases.length - 1,
          traceUniquenessGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesTraceUniquenessGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.traceUniquenessGatePassed must be true/);
    assert.match(manifest.reason, /data.releaseSignals.hermesTraceUniquenessGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes duplicate case gate fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          noDuplicateCasesGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesNoDuplicateCasesGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.noDuplicateCasesGatePassed must be true/);
    assert.match(manifest.reason, /data.releaseSignals.hermesNoDuplicateCasesGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes duplicate benchmark case gate fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          noDuplicateBenchmarkCasesGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesNoDuplicateBenchmarkCasesGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.noDuplicateBenchmarkCasesGatePassed must be true/);
    assert.match(manifest.reason, /data.releaseSignals.hermesNoDuplicateBenchmarkCasesGatePassed must be true/);
  });
});

test("release bundle fails closed when observability Hermes invalid benchmark case gate fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          noInvalidBenchmarkCasesGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesNoInvalidBenchmarkCasesGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /data.hermesQa.noInvalidBenchmarkCasesGatePassed must be true/);
    assert.match(manifest.reason, /data.releaseSignals.hermesNoInvalidBenchmarkCasesGatePassed must be true/);
  });
});

test("release bundle fails closed when evidence timestamps are stale", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, { ...validMcpContract, checkedAt: STALE_TIME });
    await writeJson(doris, { ...validDoris, checkedAt: STALE_TIME });
    await writeJson(hermes, { ...validHermes, checkedAt: STALE_TIME });
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        generatedAt: CURRENT_TIME
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /release evidence timestamps must be no older than 24h/);
  });
});

test("release bundle fails closed when strict readiness fails", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, { ...validMcpContract, checks: { ...validMcpContract.checks, limitCapped: "fail" } });
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.equal(manifest.reason, "strict_readiness_failed");
  });
});

test("release bundle fails closed when observability snapshot is not R1-valid", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesReportGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /hermesReportGatePassed/);
  });
});

test("release bundle fails closed when observability lacks Lucy controlled Hermes evidence", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        hermesQa: {
          ...validObservability.data.hermesQa,
          lucyControlledQuestions: validHermesCases.length - 1,
          lucyControlledEvidenceGatePassed: false
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          hermesLucyControlledEvidenceGatePassed: false
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability snapshot failed R1 validation/);
    assert.match(manifest.reason, /lucyControlledEvidenceGatePassed/);
    assert.match(manifest.reason, /hermesLucyControlledEvidenceGatePassed/);
  });
});

test("release bundle fails closed when observability lacks audit diagnostic evidence", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        audit: {
          ...validObservability.data.audit,
          denials: []
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /data\.audit\.denials must be non-empty/);
  });
});

test("release bundle fails closed when observability lacks concurrency denial evidence", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        audit: {
          ...validObservability.data.audit,
          denials: [{ reason: "table_forbidden:hidden_source", count: 1 }]
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /data\.audit\.denials must include query_concurrency_exceeded/);
  });
});

test("release bundle fails closed when observability concurrency denials undercount MCP evidence", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        concurrencyGuardrail: {
          ...validMcpContract.checkDetails.concurrencyGuardrail,
          denialCount: 2
        }
      }
    });
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /observability query_concurrency_exceeded denial count must be >= MCP concurrency denialCount/);
  });
});

test("release bundle fails closed when observability lucy_query usage undercounts MCP concurrency denials", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        audit: {
          ...validObservability.data.audit,
          usage: {
            ...validObservability.data.audit.usage,
            tools: [{ tool: "lucy_query", calls: 9, denied: 0, errors: 1 }]
          }
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /release evidence consistency failed/);
    assert.match(manifest.reason, /observability usage\.tools lucy_query denied count must be >= MCP concurrency denialCount/);
  });
});

test("release bundle fails closed when R1 eval pass rate is below the release gate", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        eval: {
          latestRun: {
            ...validObservability.data.eval.latestRun,
            totalCases: 20,
            passCount: 18,
            failCount: 2,
            passRate: 0.9
          },
          recent: {
            ...validObservability.data.eval.recent,
            totalCases: 20,
            passCount: 18,
            failCount: 2,
            passRate: 0.9
          }
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          evalObservable: true
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /data\.eval\.latestRun\.passRate must be >= 0\.95/);
    assert.match(manifest.reason, /data\.eval\.recent\.passRate must be >= 0\.95/);
  });
});

test("release bundle fails closed when observability traffic signal is protocol-only", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, {
      ...validObservability,
      data: {
        ...validObservability.data,
        audit: {
          ...validObservability.data.audit,
          traffic: {
            ...validObservability.data.audit.traffic,
            totalRequests: 3,
            businessCalls: 0,
            okCalls: 0,
            errorCalls: 0,
            deniedCalls: 0,
            successRate: 0,
            errorRate: 0,
            deniedRate: 0
          }
        },
        releaseSignals: {
          ...validObservability.data.releaseSignals,
          trafficObservable: true
        }
      }
    });

    const result = runBundle([
      "--observability-file", observability,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /trafficObservable requires data\.audit\.traffic\.businessCalls > 0/);
  });
});


test("release bundle requires an observability snapshot; skip mode is not release-ready", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);

    const result = runBundle(["--out", out], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 1);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.ok, false);
    assert.match(manifest.reason, /observability/i);

    const skipped = runBundle(["--skip-observability", "--out", `${out}-skip`], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(skipped.status, 1);
    const skippedManifest = JSON.parse(await readFile(path.join(`${out}-skip`, "release-manifest.json"), "utf8"));
    assert.equal(skippedManifest.ok, false);
    assert.equal(skippedManifest.releaseDecision, "not_ready");
    assert.equal(skippedManifest.reason, "observability_skipped");
    assert.equal(skippedManifest.observability.status, "skipped");
  });
});

test("release bundle records deterministic checksums for directory eval artifacts", async () => {
  await withTempDir(async (dir) => {
    const mcp = path.join(dir, "mcp.json");
    const doris = path.join(dir, "doris.json");
    const hermes = path.join(dir, "hermes.json");
    const observability = path.join(dir, "observability.json");
    const evalDir = path.join(dir, "hermes-eval-artifacts");
    const out = path.join(dir, "bundle");
    await writeJson(mcp, validMcpContract);
    await writeJson(doris, validDoris);
    await writeJson(hermes, validHermes);
    await writeJson(observability, validObservability);
    await writeEvalArtifact(evalDir);

    const result = runBundle([
      "--observability-file", observability,
      "--eval-artifact", evalDir,
      "--out", out
    ], {
      LUCY_R1_MCP_CONTRACT_EVIDENCE: mcp,
      LUCY_R1_DORIS_EVIDENCE: doris,
      LUCY_R1_HERMES_ACCURACY_REPORT: hermes
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifest = JSON.parse(await readFile(path.join(out, "release-manifest.json"), "utf8"));
    assert.equal(manifest.evalArtifacts.length, 1);
    assert.equal(manifest.evalArtifacts[0].sha256.length, 64);
    assert.equal(manifest.evalArtifacts[0].identity.passed, true);
    assert.equal(manifest.evalArtifacts[0].identity.markers.r1Dataset, true);
    assert.equal(manifest.evalArtifacts[0].identity.markers.hermesAgent, true);
    assert.equal(manifest.evalArtifacts[0].identity.markers.lucyMcpProxyTarget, true);
    assert.equal(manifest.evalArtifacts[0].coverage.passed, true);
  });
});
