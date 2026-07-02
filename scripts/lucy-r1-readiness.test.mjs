import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-readiness.mjs");

async function withEvidenceFiles(files, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-readiness-"));
  try {
    const paths = {};
    for (const [name, value] of Object.entries(files)) {
      const filePath = path.join(dir, name);
      await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
      paths[name] = filePath;
    }
    await fn(paths);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function runReadiness(env) {
  return spawnSync(process.execPath, [SCRIPT, "--strict"], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function runReadinessNonStrict(env = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
}

function parseOutput(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

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
  performance: {
    p50Ms: 120,
    p95Ms: 800
  },
  artifacts: {
    timeoutEvidence: "inbox/doris-timeout-evidence.json"
  }
};

function makeHermesCases(total = 30) {
  const cases = [];
  for (let index = 1; index <= total; index += 1) {
    const id = index === total ? "security-001" : `metric-${String(index).padStart(3, "0")}`;
    const security = index === total;
    cases.push({
      id,
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
    deniedToolsHidden: {
      exposedForbiddenTools: []
    },
    forbiddenToolRejected: {
      reason: "tool_forbidden"
    },
    upstreamSemanticToolsHidden: {
      forbiddenUpstreamSemanticTools: ["sl_query", "sl_read_source"],
      exposedUpstreamSemanticTools: []
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
        {
          tool: "lucy_query",
          reason: "invalid_arguments:lucy_query:query_shape_required",
          passed: true
        },
        {
          tool: "lucy_explain_query",
          reason: "invalid_arguments:lucy_explain_query:query_shape_required",
          passed: true
        },
        {
          tool: "lucy_read_source",
          reason: "invalid_arguments:lucy_read_source:source_required",
          passed: true
        },
        {
          tool: "lucy_freshness",
          reason: "invalid_arguments:lucy_freshness:source_required",
          passed: true
        }
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

test("non-strict readiness includes initialize instructions fail-open coverage", () => {
  const result = runReadinessNonStrict();
  const output = parseOutput(result);
  assert.equal(result.status, 0);
  const check = output.results.find((item) => item.id === "mcp_proxy_instructions.initialize_fail_open");
  assert.equal(check?.status, "pass");
});

test("strict readiness accepts structurally valid MCP contract, Doris, and Hermes evidence", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 0);
    assert.equal(output.ok, true);
    assert.equal(output.results.find((item) => item.id === "external.mcp_contract")?.status, "pass");
    assert.equal(output.results.find((item) => item.id === "external.doris")?.status, "pass");
    assert.equal(output.results.find((item) => item.id === "external.hermes")?.status, "pass");
  });
});

test("strict readiness rejects Hermes reports below R1 quality gates", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      summary: {
        ...validHermes.summary,
        accuracy: 0.94,
        coreMetricAccuracy: 0.99,
        securityPassRate: 1.0
      }
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("summary.accuracy must be >= 0.95"));
    assert(hermes.detail.errors.includes("summary.coreMetricAccuracy must be 1.0"));
  });
});

test("strict readiness rejects incomplete Doris evidence", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": {
      ...validDoris,
      readonlyAccount: false,
      checks: { ...validDoris.checks, ddlDmlRejected: "fail" }
    },
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const doris = output.results.find((item) => item.id === "external.doris");
    assert.equal(doris?.status, "fail");
    assert(doris.detail.errors.includes("readonlyAccount must be true"));
    assert(doris.detail.errors.includes('checks.ddlDmlRejected must be "pass"'));
  });
});

test("strict readiness rejects Doris evidence with non-R1 Lucy metadata contract", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": {
      ...validDoris,
      checkDetails: {
        ...validDoris.checkDetails,
        lucyMetadata: {
          ...validDoris.checkDetails.lucyMetadata,
          contract: "legacy-semantic-layer",
          hasLucyR1Contract: false
        }
      }
    },
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const doris = output.results.find((item) => item.id === "external.doris");
    assert.equal(doris?.status, "fail");
    assert(doris.detail.errors.includes('checkDetails.lucyMetadata.contract must be "lucy-r1-controlled-data-service"'));
    assert(doris.detail.errors.includes("checkDetails.lucyMetadata.hasLucyR1Contract must be true"));
  });
});

test("strict readiness rejects Doris evidence without Lucy provenance metadata", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": {
      ...validDoris,
      checkDetails: {
        ...validDoris.checkDetails,
        lucyMetadata: {
          ...validDoris.checkDetails.lucyMetadata,
          hasProvenance: false,
          hasFreshnessStatus: false,
          hasTruncation: false
        }
      }
    },
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const doris = output.results.find((item) => item.id === "external.doris");
    assert.equal(doris?.status, "fail");
    assert(doris.detail.errors.includes("checkDetails.lucyMetadata.hasProvenance must be true"));
    assert(doris.detail.errors.includes("checkDetails.lucyMetadata.hasFreshnessStatus must be true"));
    assert(doris.detail.errors.includes("checkDetails.lucyMetadata.hasTruncation must be true"));
  });
});

test("strict readiness rejects Doris timeout evidence without source_timeout classification", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": {
      ...validDoris,
      checkDetails: {
        ...validDoris.checkDetails,
        timeoutClassification: {
          status: "pass",
          evidence: { status: "pass", classification: "query_timeout" }
        }
      }
    },
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const doris = output.results.find((item) => item.id === "external.doris");
    assert.equal(doris?.status, "fail");
    assert(doris.detail.errors.includes('checkDetails.timeoutClassification must classify Doris timeouts as "source_timeout"'));
  });
});

test("strict readiness rejects MCP contract evidence that lacks negative sample details", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        negativeSamples: {
          forbiddenTools: ["sql_execution"],
          forbiddenSources: ["hidden_source"],
          forbiddenMeasures: []
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.negativeSamples.forbiddenMeasures must be a non-empty array"));
  });
});

test("strict readiness rejects MCP contract evidence exposing upstream semantic tools", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checks: {
        ...validMcpContract.checks,
        upstreamSemanticToolsHidden: "fail"
      },
      checkDetails: {
        ...validMcpContract.checkDetails,
        upstreamSemanticToolsHidden: {
          forbiddenUpstreamSemanticTools: ["sl_query", "sl_read_source"],
          exposedUpstreamSemanticTools: ["sl_query"]
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checks.upstreamSemanticToolsHidden must be "pass"'));
    assert(contract.detail.errors.includes("checkDetails.upstreamSemanticToolsHidden.exposedUpstreamSemanticTools must be an empty array"));
  });
});

test("strict readiness rejects MCP contract evidence without forbidden tool rejection", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checks: {
        ...validMcpContract.checks,
        forbiddenToolRejected: "fail"
      },
      checkDetails: {
        ...validMcpContract.checkDetails,
        forbiddenToolRejected: {
          reason: "not_found"
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checks.forbiddenToolRejected must be "pass"'));
    assert(contract.detail.errors.includes("checkDetails.forbiddenToolRejected.reason must be tool_forbidden or tool_forbidden_global"));
  });
});

test("strict readiness rejects MCP contract evidence with invalid R1 tool schemas", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checks: {
        ...validMcpContract.checks,
        toolSchemas: "fail"
      },
      checkDetails: {
        ...validMcpContract.checkDetails,
        toolSchemas: {
          ...validMcpContract.checkDetails.toolSchemas,
          invalidSchemas: [
            { tool: "lucy_read_source", field: "connectionId", reason: "required_field_missing" }
          ]
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checks.toolSchemas must be "pass"'));
    assert(contract.detail.errors.includes("checkDetails.toolSchemas.invalidSchemas must be an empty array"));
  });
});

test("strict readiness rejects MCP contract evidence without concurrency guardrail metadata", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checks: {
        ...validMcpContract.checks,
        concurrencyGuardrail: "fail"
      },
      checkDetails: {
        ...validMcpContract.checkDetails,
        concurrencyGuardrail: {}
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checks.concurrencyGuardrail must be "pass"'));
    assert(contract.detail.errors.includes("checkDetails.concurrencyGuardrail.maxConcurrentQueries must be a finite number"));
  });
});

test("strict readiness rejects MCP contract evidence without concurrency denial proof", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        concurrencyGuardrail: {
          maxConcurrentQueries: 4,
          attempted: true,
          probeCount: 5,
          denialCount: 0,
          deniedReasons: []
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.concurrencyGuardrail.denialCount must be >= 1"));
    assert(contract.detail.errors.includes("checkDetails.concurrencyGuardrail.deniedReasons must include query_concurrency_exceeded"));
  });
});

test("strict readiness rejects MCP contract evidence without raw SQL guardrail reason", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        rawSqlRejected: {
          reason: "generic_error"
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.rawSqlRejected.reason must be a raw SQL or read-only guardrail reason"));
  });
});

test("strict readiness rejects MCP contract evidence without runtime argument validation reason", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        runtimeArgumentValidation: {
          reason: "generic_error"
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.runtimeArgumentValidation.reason must be an invalid_arguments reason"));
  });
});

test("strict readiness rejects MCP contract evidence without every runtime argument validation probe", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        runtimeArgumentValidation: {
          ...validMcpContract.checkDetails.runtimeArgumentValidation,
          probes: validMcpContract.checkDetails.runtimeArgumentValidation.probes
            .filter((probe) => probe.tool !== "lucy_freshness")
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.runtimeArgumentValidation.probes must include lucy_freshness"));
  });
});

test("strict readiness rejects MCP contract evidence with non-R1 Lucy metadata contract", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        readSourceMetadata: {
          ...validMcpContract.checkDetails.readSourceMetadata,
          contract: "legacy-semantic-layer",
          hasLucyR1Contract: false
        },
        lucyMetadata: {
          ...validMcpContract.checkDetails.lucyMetadata,
          contract: "legacy-semantic-layer",
          hasLucyR1Contract: false
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checkDetails.lucyMetadata.contract must be "lucy-r1-controlled-data-service"'));
    assert(contract.detail.errors.includes('checkDetails.readSourceMetadata.contract must be "lucy-r1-controlled-data-service"'));
  });
});

test("strict readiness rejects MCP contract evidence without Lucy provenance metadata", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        lucyMetadata: {
          ...validMcpContract.checkDetails.lucyMetadata,
          hasProvenance: false,
          hasFreshnessStatus: false
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.lucyMetadata.hasProvenance must be true"));
    assert(contract.detail.errors.includes("checkDetails.lucyMetadata.hasFreshnessStatus must be true"));
  });
});

test("strict readiness rejects MCP contract evidence without runtime target identifiers", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      proxyUrl: "",
      connectionId: "",
      sourceName: ""
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("proxyUrl must be a non-empty string"));
    assert(contract.detail.errors.includes("connectionId must be a non-empty string"));
    assert(contract.detail.errors.includes("sourceName must be a non-empty string"));
  });
});

test("strict readiness rejects MCP contract evidence with non-R1 tools", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checks: {
        ...validMcpContract.checks,
        toolSurface: "fail"
      },
      checkDetails: {
        ...validMcpContract.checkDetails,
        toolSurface: {
          ...validMcpContract.checkDetails.toolSurface,
          extraTools: ["wiki_search"]
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes('checks.toolSurface must be "pass"'));
    assert(contract.detail.errors.includes("checkDetails.toolSurface.extraTools must be an empty array"));
  });
});

test("strict readiness rejects MCP contract evidence with missing R1 tools even when marked pass", async () => {
  await withEvidenceFiles({
    "mcp.json": {
      ...validMcpContract,
      checkDetails: {
        ...validMcpContract.checkDetails,
        toolSurface: {
          expectedTools: validMcpContract.checkDetails.toolSurface.expectedTools.filter((tool) => tool !== "lucy_freshness"),
          missingTools: ["lucy_freshness"],
          extraTools: []
        }
      }
    },
    "doris.json": validDoris,
    "hermes.json": validHermes
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const contract = output.results.find((item) => item.id === "external.mcp_contract");
    assert.equal(contract?.status, "fail");
    assert(contract.detail.errors.includes("checkDetails.toolSurface.expectedTools must exactly match Lucy R1 tools"));
    assert(contract.detail.errors.includes("checkDetails.toolSurface.missingTools must be an empty array"));
  });
});

test("strict readiness rejects Hermes reports from a non-R1 dataset", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      dataset: "adhoc_smoke"
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes('dataset must be "r1_doris_benchmark"'));
  });
});

test("strict readiness rejects Hermes reports with inconsistent pass and fail counts", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      summary: {
        ...validHermes.summary,
        accuracy: 1,
        passedQuestions: validHermesCases.length - 1,
        failedQuestions: 0
      }
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("summary.passedQuestions + summary.failedQuestions must equal summary.totalQuestions"));
    assert(hermes.detail.errors.includes("summary.accuracy must equal summary.passedQuestions / summary.totalQuestions"));
  });
});

test("strict readiness rejects Hermes reports without per-question Hermes and Lucy target identity", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      gates: {
        ...validHermes.gates,
        perCaseIdentity: false
      },
      cases: validHermesCases.map((item, index) => ({
        ...item,
        agent: index === 0 ? "ad-hoc-agent" : item.agent,
        target: index === 1 ? "direct-doris" : item.target
      }))
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("gates.perCaseIdentity must be true"));
    assert(hermes.detail.errors.some((item) => item.includes("cases must include agent=hermes for every question")));
    assert(hermes.detail.errors.some((item) => item.includes("cases must include target=lucy-mcp-proxy for every question")));
  });
});

test("strict readiness rejects Hermes reports without Lucy controlled evidence", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      summary: {
        ...validHermes.summary,
        lucyControlledQuestions: validHermesCases.length - 1,
        lucyMetadataQuestions: validHermesCases.length - 2,
        lucyRejectionQuestions: 1
      },
      gates: {
        ...validHermes.gates,
        lucyControlledEvidence: false
      },
      cases: validHermesCases.map((item, index) => index === 0
        ? { ...item, lucyControlledEvidence: false, lucyMetaSummary: { hasLucyMeta: false } }
        : item)
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("gates.lucyControlledEvidence must be true"));
    assert(hermes.detail.errors.includes("summary.lucyControlledQuestions must equal summary.totalQuestions"));
    assert(hermes.detail.errors.some((item) => item.includes("cases must include Lucy controlled evidence for every question")));
    assert(hermes.detail.errors.some((item) => item.includes("non-security cases must include Lucy R1 metadata/provenance summary")));
  });
});

test("strict readiness rejects Hermes reports with duplicate benchmark case results", async () => {
  const duplicatedCases = [
    ...validHermesCases,
    { ...validHermesCases[0], trace: "lucy-trace-extra-duplicate" }
  ];
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      summary: {
        ...validHermes.summary,
        totalQuestions: duplicatedCases.length,
        passedQuestions: duplicatedCases.length,
        tracedQuestions: duplicatedCases.length,
        uniqueTraces: duplicatedCases.length,
        evidencedQuestions: {
          question: duplicatedCases.length,
          hermesAnswer: duplicatedCases.length,
          expectedAnswer: duplicatedCases.length,
          source: duplicatedCases.length,
          query: duplicatedCases.length,
          judgement: duplicatedCases.length
        },
        coreMetricQuestions: duplicatedCases.length - 1,
        securityQuestions: 1
      },
      gates: {
        ...validHermes.gates,
        noDuplicateCases: false
      },
      duplicateResultCaseIds: ["metric-001"],
      cases: duplicatedCases
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("gates.noDuplicateCases must be true"));
    assert(hermes.detail.errors.includes("duplicateResultCaseIds must be empty: metric-001"));
    assert(hermes.detail.errors.includes("cases must include each benchmark case once: metric-001"));
  });
});

test("strict readiness rejects Hermes reports with duplicate benchmark case ids", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      gates: {
        ...validHermes.gates,
        noDuplicateBenchmarkCases: false
      },
      duplicateBenchmarkCaseIds: ["metric-001"]
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("gates.noDuplicateBenchmarkCases must be true"));
    assert(hermes.detail.errors.includes("duplicateBenchmarkCaseIds must be empty: metric-001"));
  });
});

test("strict readiness rejects Hermes reports with invalid benchmark cases", async () => {
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      gates: {
        ...validHermes.gates,
        noInvalidBenchmarkCases: false
      },
      invalidBenchmarkCases: [{ index: 30, reason: "missing_id" }]
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("gates.noInvalidBenchmarkCases must be true"));
    assert(hermes.detail.errors.includes("invalidBenchmarkCases must be empty: 30"));
  });
});

test("strict readiness rejects Hermes reports below the R1 minimum question count", async () => {
  const lowSampleCases = makeHermesCases(3);
  await withEvidenceFiles({
    "mcp.json": validMcpContract,
    "doris.json": validDoris,
    "hermes.json": {
      ...validHermes,
      summary: {
        ...validHermes.summary,
        totalQuestions: lowSampleCases.length,
        passedQuestions: lowSampleCases.length,
        tracedQuestions: lowSampleCases.length,
        evidencedQuestions: {
          question: lowSampleCases.length,
          hermesAnswer: lowSampleCases.length,
          expectedAnswer: lowSampleCases.length,
          source: lowSampleCases.length,
          query: lowSampleCases.length,
          judgement: lowSampleCases.length
        },
        coreMetricQuestions: lowSampleCases.length - 1,
        securityQuestions: 1
      },
      gates: {
        ...validHermes.gates,
        questionCount: false
      },
      cases: lowSampleCases
    }
  }, async (files) => {
    const result = runReadiness({
      LUCY_R1_MCP_CONTRACT_EVIDENCE: files["mcp.json"],
      LUCY_R1_DORIS_EVIDENCE: files["doris.json"],
      LUCY_R1_HERMES_ACCURACY_REPORT: files["hermes.json"]
    });
    const output = parseOutput(result);
    assert.equal(result.status, 1);
    const hermes = output.results.find((item) => item.id === "external.hermes");
    assert.equal(hermes?.status, "fail");
    assert(hermes.detail.errors.includes("summary.totalQuestions must be >= summary.minQuestions"));
    assert(hermes.detail.errors.includes("gates.questionCount must be true"));
  });
});
