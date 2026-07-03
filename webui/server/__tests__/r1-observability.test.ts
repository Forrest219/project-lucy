import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let previousRoot: string | undefined;
let previousAuditDb: string | undefined;
let previousEvalDb: string | undefined;
let previousHermesReport: string | undefined;

beforeEach(async () => {
  vi.resetModules();
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-r1-observability-"));
  await mkdir(path.join(projectRoot, ".ktx-ui", "eval"), { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  previousEvalDb = process.env.LUCY_EVAL_DB;
  previousHermesReport = process.env.LUCY_R1_HERMES_ACCURACY_REPORT;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_AUDIT_DB = path.join(projectRoot, "audit.sqlite");
  process.env.LUCY_EVAL_DB = path.join(projectRoot, ".ktx-ui", "eval", "runs.sqlite");
});

afterEach(async () => {
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  if (previousEvalDb === undefined) delete process.env.LUCY_EVAL_DB;
  else process.env.LUCY_EVAL_DB = previousEvalDb;
  if (previousHermesReport === undefined) delete process.env.LUCY_R1_HERMES_ACCURACY_REPORT;
  else process.env.LUCY_R1_HERMES_ACCURACY_REPORT = previousHermesReport;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("GET /api/r1/observability", () => {
  it("summarizes audit, eval, source, latency, and Hermes accuracy signals", async () => {
    const hermesReport = path.join(projectRoot, "hermes-accuracy.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "r1_doris_benchmark",
      generatedBy: "scripts/lucy-r1-hermes-report.mjs",
      inputs: {
        cases: "evals/r1_doris_benchmark/eval/r1_doris_benchmark-eval-cases.yaml",
        results: "inbox/hermes-r1-results.json",
        caseDataset: "r1_doris_benchmark"
      },
      summary: {
        accuracy: 0.96,
        coreMetricAccuracy: 1,
        securityPassRate: 1,
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 30,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        },
        lucyControlledQuestions: 30,
        lucyMetadataQuestions: 29,
        lucyRejectionQuestions: 1
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
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { writeLog, writeAccessLogSources } = await import("../proxy/audit");
    const { getEvalDb, resetEvalDb } = await import("../eval/db");
    resetEvalDb();

    await writeLog({
      ts: "2026-07-02T00:00:00.000Z",
      userId: "workhorse",
      tokenLabel: "hermes",
      tokenHashPrefix: "sha256:abcd",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-1"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "hermes",
      tokenHashPrefix: "sha256:abcd",
      tool: "lucy_query",
      tables: ["mart.ceo_metric_snapshot"],
      outcome: "ok",
      durationMs: 120,
      queryOperation: "select",
      queryPreview: "select * from mart.ceo_metric_snapshot limit ?",
      responseRowCount: 2,
      responseColumnCount: 3,
      requestId: "query-ok",
      roleIds: ["ceo_readonly"],
      decisionReason: "allowed"
    });
    const deniedLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "hermes",
      tokenHashPrefix: "sha256:abcd",
      tool: "lucy_query",
      tables: ["mart.secret_snapshot"],
      outcome: "denied",
      durationMs: 50_000,
      queryOperation: "select",
      queryPreview: "select * from mart.secret_snapshot limit ?",
      requestId: "query-denied",
      roleIds: ["ceo_readonly"],
      decisionReason: "table_denied"
    });
    await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "hermes",
      tokenHashPrefix: "sha256:abcd",
      tool: "lucy_query",
      tables: ["mart.ceo_metric_snapshot"],
      outcome: "denied",
      errorDetail: "query_concurrency_exceeded:active=1;max=1",
      durationMs: 10,
      queryOperation: "select",
      queryPreview: "select * from mart.ceo_metric_snapshot limit ?",
      requestId: "query-concurrency-denied",
      roleIds: ["ceo_readonly"],
      decisionReason: "query_concurrency_exceeded"
    });
    await writeAccessLogSources(deniedLogId, new Date().toISOString(), "workhorse", "lucy_query", [{
      connectionId: "doris-r1",
      schemaName: "mart",
      sourceName: "secret_snapshot",
      physicalTable: "mart.secret_snapshot",
      extractionMethod: "test",
      confidence: "high"
    }]);

    const db = await getEvalDb();
    db.prepare(`
      INSERT INTO eval_run (domain, started_at, finished_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases, pass_count, fail_count)
      VALUES ('r1_doris_smoke', ?, ?, 'succeeded', 'test', 'manual', 'http://localhost:7879/mcp', '{}', 20, 19, 1)
    `).run(new Date().toISOString(), new Date().toISOString());

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.ok).toBe(true);
      expect(res.body.data.audit.traffic).toMatchObject({
        businessCalls: 3,
        okCalls: 1,
        deniedCalls: 2,
        deniedRate: 2 / 3
      });
      expect(res.body.data.audit.denials).toContainEqual({ reason: "table_denied", count: 1 });
      expect(res.body.data.audit.denials).toContainEqual({ reason: "query_concurrency_exceeded", count: 1 });
      expect(res.body.data.audit.latency.slowCalls).toBe(1);
      expect(res.body.data.audit.latency.slowQueries[0]).toMatchObject({ requestId: "query-denied", durationMs: 50_000 });
      expect(res.body.data.audit.sourceErrors[0]).toMatchObject({
        source: "doris-r1.mart.secret_snapshot",
        outcome: "denied",
        count: 1
      });
      expect(res.body.data.audit.usage.roles).toContainEqual({ roleId: "ceo_readonly", calls: 3, denied: 2 });
      expect(res.body.data.eval.latestRun).toMatchObject({
        domain: "r1_doris_smoke",
        totalCases: 20,
        passCount: 19,
        failCount: 1,
        passRate: 0.95
      });
      expect(res.body.data.hermesQa).toMatchObject({
        status: "passed",
        agent: "hermes",
        target: "lucy-mcp-proxy",
        dataset: "r1_doris_benchmark",
        caseDataset: "r1_doris_benchmark",
        accuracy: 0.96,
        coreMetricAccuracy: 1,
        securityPassRate: 1,
        tracedQuestions: 30,
        uniqueTraces: 30,
        totalQuestions: 30,
        minQuestions: 30,
        questionCountGatePassed: true,
        perCaseIdentityGatePassed: true,
        noInvalidBenchmarkCasesGatePassed: true,
        noDuplicateBenchmarkCasesGatePassed: true,
        noDuplicateCasesGatePassed: true,
        evidenceCompletenessGatePassed: true,
        lucyControlledEvidenceGatePassed: true,
        threshold: 0.95
      });
      expect(res.body.data.releaseSignals).toMatchObject({
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
        hermesNoInvalidBenchmarkCasesGatePassed: true,
        hermesNoDuplicateBenchmarkCasesGatePassed: true,
        hermesNoDuplicateCasesGatePassed: true,
        hermesEvidenceCompletenessGatePassed: true,
        hermesLucyControlledEvidenceGatePassed: true,
        hermesPerCaseIdentityGatePassed: true,
        hermesReportGatePassed: true
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal on accuracy-only reports", async () => {
    const hermesReport = path.join(projectRoot, "hermes-accuracy-only.json");
    await writeFile(hermesReport, JSON.stringify({ summary: { accuracy: 0.99 } }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracy: 0.99,
        accuracyGatePassed: true,
        questionCountGatePassed: false,
        coreMetricGatePassed: false,
        securityGatePassed: false,
        traceCoverageGatePassed: false,
        traceUniquenessGatePassed: false,
        evidenceCompletenessGatePassed: false,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("summary.coreMetricAccuracy must be 1.0");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesAccuracyGatePassed: true,
        hermesQuestionCountGatePassed: false,
        hermesCoreMetricGatePassed: false,
        hermesSecurityGatePassed: false,
        hermesTraceCoverageGatePassed: false,
        hermesTraceUniquenessGatePassed: false,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal when Lucy controlled evidence is missing", async () => {
    const hermesReport = path.join(projectRoot, "hermes-missing-lucy-evidence.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "r1_doris_benchmark",
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
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 30,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        },
        lucyControlledQuestions: 29,
        lucyMetadataQuestions: 28,
        lucyRejectionQuestions: 1
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
        lucyControlledEvidence: false,
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracyGatePassed: true,
        questionCountGatePassed: true,
        traceCoverageGatePassed: true,
        traceUniquenessGatePassed: true,
        evidenceCompletenessGatePassed: true,
        lucyControlledEvidenceGatePassed: false,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("summary.lucyControlledQuestions must equal summary.totalQuestions and gates.lucyControlledEvidence must be true");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesAccuracyGatePassed: true,
        hermesTraceCoverageGatePassed: true,
        hermesTraceUniquenessGatePassed: true,
        hermesEvidenceCompletenessGatePassed: true,
        hermesLucyControlledEvidenceGatePassed: false,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal on low-sample R1 reports", async () => {
    const hermesReport = path.join(projectRoot, "hermes-low-sample.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "r1_doris_benchmark",
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
        totalQuestions: 3,
        minQuestions: 30,
        tracedQuestions: 3,
        uniqueTraces: 3,
        evidencedQuestions: {
          question: 3,
          hermesAnswer: 3,
          expectedAnswer: 3,
          source: 3,
          query: 3,
          judgement: 3
        }
      },
      gates: {
        agentIdentity: true,
        targetIdentity: true,
        datasetIdentity: true,
        caseDatasetIdentity: true,
        perCaseIdentity: true,
        questionCount: false,
        accuracy: true,
        coreMetricAccuracy: true,
        securityPassRate: true,
        traceCoverage: true,
        traceUniqueness: true,
        evidenceCompleteness: true,
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        dataset: "r1_doris_benchmark",
        caseDataset: "r1_doris_benchmark",
        accuracyGatePassed: true,
        questionCountGatePassed: false,
        coreMetricGatePassed: true,
        securityGatePassed: true,
        traceCoverageGatePassed: true,
        traceUniquenessGatePassed: true,
        evidenceCompletenessGatePassed: true,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("summary.totalQuestions must be >= summary.minQuestions and summary.minQuestions must be >= 30");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesQuestionCountGatePassed: false,
        hermesAccuracyGatePassed: true,
        hermesCoreMetricGatePassed: true,
        hermesSecurityGatePassed: true,
        hermesTraceCoverageGatePassed: true,
        hermesTraceUniquenessGatePassed: true,
        hermesEvidenceCompletenessGatePassed: true,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal when traces are reused", async () => {
    const hermesReport = path.join(projectRoot, "hermes-reused-traces.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "r1_doris_benchmark",
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
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 29,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        }
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
        traceUniqueness: false,
        evidenceCompleteness: true,
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracyGatePassed: true,
        questionCountGatePassed: true,
        traceCoverageGatePassed: true,
        traceUniquenessGatePassed: false,
        evidenceCompletenessGatePassed: true,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("summary.uniqueTraces must equal summary.totalQuestions and gates.traceUniqueness must be true");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesTraceCoverageGatePassed: true,
        hermesTraceUniquenessGatePassed: false,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal when benchmark case results are duplicated", async () => {
    const hermesReport = path.join(projectRoot, "hermes-duplicate-cases.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "r1_doris_benchmark",
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
        totalQuestions: 31,
        minQuestions: 30,
        tracedQuestions: 31,
        uniqueTraces: 31,
        evidencedQuestions: {
          question: 31,
          hermesAnswer: 31,
          expectedAnswer: 31,
          source: 31,
          query: 31,
          judgement: 31
        }
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
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: false,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: ["metric-001"]
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracyGatePassed: true,
        questionCountGatePassed: true,
        traceUniquenessGatePassed: true,
        noDuplicateBenchmarkCasesGatePassed: true,
        noDuplicateCasesGatePassed: false,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("gates.noDuplicateCases must be true and duplicateResultCaseIds must be empty");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesNoDuplicateCasesGatePassed: false,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal when benchmark case ids are duplicated", async () => {
    const hermesReport = path.join(projectRoot, "hermes-duplicate-benchmark-cases.json");
    await writeFile(hermesReport, JSON.stringify({
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
        accuracy: 1,
        coreMetricAccuracy: 1,
        securityPassRate: 1,
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 30,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        }
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
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: false,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: ["metric-001"],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracyGatePassed: true,
        questionCountGatePassed: true,
        traceUniquenessGatePassed: true,
        noDuplicateBenchmarkCasesGatePassed: false,
        noDuplicateCasesGatePassed: true,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("gates.noDuplicateBenchmarkCases must be true and duplicateBenchmarkCaseIds must be empty");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesNoDuplicateBenchmarkCasesGatePassed: false,
        hermesNoDuplicateCasesGatePassed: true,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal when benchmark cases are invalid", async () => {
    const hermesReport = path.join(projectRoot, "hermes-invalid-benchmark-cases.json");
    await writeFile(hermesReport, JSON.stringify({
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
        accuracy: 1,
        coreMetricAccuracy: 1,
        securityPassRate: 1,
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 30,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        }
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
        noInvalidBenchmarkCases: false,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [{ index: 30, reason: "missing_id" }],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        accuracyGatePassed: true,
        questionCountGatePassed: true,
        traceUniquenessGatePassed: true,
        noInvalidBenchmarkCasesGatePassed: false,
        noDuplicateBenchmarkCasesGatePassed: true,
        noDuplicateCasesGatePassed: true,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain("gates.noInvalidBenchmarkCases must be true and invalidBenchmarkCases must be empty");
      expect(res.body.data.releaseSignals).toMatchObject({
        hermesNoInvalidBenchmarkCasesGatePassed: false,
        hermesNoDuplicateBenchmarkCasesGatePassed: true,
        hermesReportGatePassed: false
      });
    } finally {
      await app.close();
    }
  });

  it("does not treat protocol-only MCP traffic as observable business traffic", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "workhorse",
      tokenLabel: "hermes",
      tokenHashPrefix: "sha256:abcd",
      tool: "tools/list",
      outcome: "ok",
      durationMs: 3,
      requestId: "protocol-only"
    });

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.audit.traffic).toMatchObject({
        totalRequests: 1,
        businessCalls: 0
      });
      expect(res.body.data.releaseSignals.trafficObservable).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("does not pass the eval release signal when the latest R1 eval misses the pass-rate gate", async () => {
    const { getEvalDb, resetEvalDb } = await import("../eval/db");
    resetEvalDb();
    const db = await getEvalDb();
    db.prepare(`
      INSERT INTO eval_run (domain, started_at, finished_at, status, triggered_by, trigger, ktx_mcp_url, case_selection, total_cases, pass_count, fail_count)
      VALUES ('r1_doris_smoke', ?, ?, 'succeeded', 'test', 'manual', 'http://localhost:7879/mcp', '{}', 20, 18, 2)
    `).run(new Date().toISOString(), new Date().toISOString());

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.eval.latestRun).toMatchObject({
        domain: "r1_doris_smoke",
        status: "succeeded",
        totalCases: 20,
        passCount: 18,
        failCount: 2,
        passRate: 0.9
      });
      expect(res.body.data.releaseSignals.evalObservable).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("does not pass the Hermes release signal on non-R1 benchmark reports", async () => {
    const hermesReport = path.join(projectRoot, "hermes-wrong-dataset.json");
    await writeFile(hermesReport, JSON.stringify({
      agent: "hermes",
      target: "lucy-mcp-proxy",
      dataset: "smoke_dataset",
      generatedBy: "scripts/lucy-r1-hermes-report.mjs",
      inputs: {
        cases: "evals/smoke/eval/smoke-eval-cases.yaml",
        results: "inbox/hermes-r1-results.json",
        caseDataset: "smoke_dataset"
      },
      summary: {
        accuracy: 1,
        coreMetricAccuracy: 1,
        securityPassRate: 1,
        totalQuestions: 30,
        minQuestions: 30,
        tracedQuestions: 30,
        uniqueTraces: 30,
        evidencedQuestions: {
          question: 30,
          hermesAnswer: 30,
          expectedAnswer: 30,
          source: 30,
          query: 30,
          judgement: 30
        }
      },
      gates: {
        agentIdentity: true,
        targetIdentity: true,
        datasetIdentity: false,
        caseDatasetIdentity: false,
        perCaseIdentity: true,
        questionCount: true,
        accuracy: true,
        coreMetricAccuracy: true,
        securityPassRate: true,
        traceCoverage: true,
        traceUniqueness: true,
        evidenceCompleteness: true,
        noInvalidBenchmarkCases: true,
        noInvalidResults: true,
        noUnknownCases: true,
        noDuplicateBenchmarkCases: true,
        noDuplicateCases: true,
        noMissingCases: true
      },
      invalidBenchmarkCases: [],
      duplicateBenchmarkCaseIds: [],
      duplicateResultCaseIds: []
    }), "utf8");
    process.env.LUCY_R1_HERMES_ACCURACY_REPORT = hermesReport;

    const { buildServer } = await import("../index");
    const app = buildServer();
    await app.ready();
    try {
      const res = await request(app.server)
        .get("/api/r1/observability?hours=24&slowMs=30000")
        .expect(200);

      expect(res.body.data.hermesQa).toMatchObject({
        status: "failed",
        dataset: "smoke_dataset",
        caseDataset: "smoke_dataset",
        datasetIdentityGatePassed: false,
        caseDatasetIdentityGatePassed: false,
        questionCountGatePassed: true,
        accuracyGatePassed: true,
        coreMetricGatePassed: true,
        securityGatePassed: true,
        traceCoverageGatePassed: true,
        traceUniquenessGatePassed: true,
        evidenceCompletenessGatePassed: true,
        requiredGatesPassed: false
      });
      expect(res.body.data.hermesQa.gateErrors).toContain('dataset must be "r1_doris_benchmark"');
      expect(res.body.data.hermesQa.gateErrors).toContain('inputs.caseDataset must be "r1_doris_benchmark" and gates.caseDatasetIdentity must be true');
      expect(res.body.data.releaseSignals.hermesReportGatePassed).toBe(false);
    } finally {
      await app.close();
    }
  });
});
