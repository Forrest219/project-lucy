import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { readR1AuditObservability } from "./proxy/audit.js";
import { getEvalDb } from "./eval/db.js";

type HermesAccuracy = {
  status: "missing" | "passed" | "failed" | "unparseable";
  reportPath?: string;
  agent?: string;
  target?: string;
  dataset?: string;
  caseDataset?: string;
  generatedBy?: string;
  accuracy?: number;
  coreMetricAccuracy?: number;
  securityPassRate?: number;
  tracedQuestions?: number;
  uniqueTraces?: number;
  totalQuestions?: number;
  minQuestions?: number;
  evidencedQuestions?: Record<string, number>;
  lucyControlledQuestions?: number;
  lucyMetadataQuestions?: number;
  lucyRejectionQuestions?: number;
  invalidBenchmarkCases?: unknown[];
  duplicateBenchmarkCaseIds?: string[];
  duplicateResultCaseIds?: string[];
  threshold: number;
  gates?: Record<string, boolean>;
  accuracyGatePassed?: boolean;
  coreMetricGatePassed?: boolean;
  securityGatePassed?: boolean;
  traceCoverageGatePassed?: boolean;
  traceUniquenessGatePassed?: boolean;
  noDuplicateBenchmarkCasesGatePassed?: boolean;
  noDuplicateCasesGatePassed?: boolean;
  evidenceCompletenessGatePassed?: boolean;
  lucyControlledEvidenceGatePassed?: boolean;
  questionCountGatePassed?: boolean;
  agentIdentityGatePassed?: boolean;
  targetIdentityGatePassed?: boolean;
  datasetIdentityGatePassed?: boolean;
  caseDatasetIdentityGatePassed?: boolean;
  perCaseIdentityGatePassed?: boolean;
  generatedByGatePassed?: boolean;
  noInvalidBenchmarkCasesGatePassed?: boolean;
  requiredGatesPassed?: boolean;
  gateErrors?: string[];
};

type EvalObservability = {
  latestRun?: {
    id: number;
    domain: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    totalCases: number;
    passCount: number;
    failCount: number;
    passRate: number;
  };
  recent: {
    runs: number;
    totalCases: number;
    passCount: number;
    failCount: number;
    passRate: number;
  };
};

const R1_EVAL_PASS_RATE_THRESHOLD = 0.95;

function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function r1EvalGatePassed(evalStatus: EvalObservability): boolean {
  const latest = evalStatus.latestRun;
  return Boolean(latest
    && latest.domain.startsWith("r1_")
    && latest.status === "succeeded"
    && latest.totalCases > 0
    && latest.passRate >= R1_EVAL_PASS_RATE_THRESHOLD);
}

function evidencePath(envName: string): string | undefined {
  const value = process.env[envName];
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function normalizeAccuracy(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 1 ? value / 100 : value;
}

function findAccuracy(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["accuracy", "qaAccuracy", "qa_accuracy", "overallAccuracy", "overall_accuracy", "accuracyPercent", "accuracy_percent"]) {
    const accuracy = normalizeAccuracy(record[key]);
    if (accuracy !== undefined) return accuracy;
  }
  for (const key of ["overall", "summary", "metrics", "result", "results"]) {
    const accuracy = findAccuracy(record[key]);
    if (accuracy !== undefined) return accuracy;
  }
  return undefined;
}

function valueAt(value: unknown, pathSegments: string[]): unknown {
  let current = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanGates(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const gates: Record<string, boolean> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "boolean") gates[key] = item;
  }
  return gates;
}

function hermesFromStructuredReport(value: unknown, reportPath: string, threshold: number): HermesAccuracy {
  const agent = valueAt(value, ["agent"]);
  const target = valueAt(value, ["target"]);
  const dataset = valueAt(value, ["dataset"]);
  const caseDataset = valueAt(value, ["inputs", "caseDataset"]);
  const generatedBy = valueAt(value, ["generatedBy"]);
  const accuracy = findAccuracy(value);
  const coreMetricAccuracy = normalizeAccuracy(valueAt(value, ["summary", "coreMetricAccuracy"]) ?? valueAt(value, ["summary", "core_metric_accuracy"]));
  const securityPassRate = normalizeAccuracy(valueAt(value, ["summary", "securityPassRate"]) ?? valueAt(value, ["summary", "security_pass_rate"]));
  const tracedQuestions = finiteNumber(valueAt(value, ["summary", "tracedQuestions"]) ?? valueAt(value, ["summary", "traced_questions"]));
  const uniqueTraces = finiteNumber(valueAt(value, ["summary", "uniqueTraces"]) ?? valueAt(value, ["summary", "unique_traces"]));
  const totalQuestions = finiteNumber(valueAt(value, ["summary", "totalQuestions"]) ?? valueAt(value, ["summary", "total_questions"]));
  const minQuestions = finiteNumber(valueAt(value, ["summary", "minQuestions"]) ?? valueAt(value, ["summary", "min_questions"]));
  const evidencedQuestions = valueAt(value, ["summary", "evidencedQuestions"]);
  const lucyControlledQuestions = finiteNumber(valueAt(value, ["summary", "lucyControlledQuestions"]));
  const lucyMetadataQuestions = finiteNumber(valueAt(value, ["summary", "lucyMetadataQuestions"]));
  const lucyRejectionQuestions = finiteNumber(valueAt(value, ["summary", "lucyRejectionQuestions"]));
  const invalidBenchmarkCasesValue = valueAt(value, ["invalidBenchmarkCases"]);
  const invalidBenchmarkCases = Array.isArray(invalidBenchmarkCasesValue) ? invalidBenchmarkCasesValue : undefined;
  const duplicateResultCaseIdsValue = valueAt(value, ["duplicateResultCaseIds"]);
  const duplicateResultCaseIds = Array.isArray(duplicateResultCaseIdsValue)
    ? duplicateResultCaseIdsValue.filter((item): item is string => typeof item === "string")
    : undefined;
  const duplicateBenchmarkCaseIdsValue = valueAt(value, ["duplicateBenchmarkCaseIds"]);
  const duplicateBenchmarkCaseIds = Array.isArray(duplicateBenchmarkCaseIdsValue)
    ? duplicateBenchmarkCaseIdsValue.filter((item): item is string => typeof item === "string")
    : undefined;
  const gates = booleanGates(valueAt(value, ["gates"]));
  const requiredGateNames = ["agentIdentity", "targetIdentity", "datasetIdentity", "caseDatasetIdentity", "perCaseIdentity", "questionCount", "accuracy", "coreMetricAccuracy", "securityPassRate", "traceCoverage", "traceUniqueness", "evidenceCompleteness", "lucyControlledEvidence", "noInvalidBenchmarkCases", "noInvalidResults", "noUnknownCases", "noDuplicateBenchmarkCases", "noDuplicateCases", "noMissingCases"];

  const agentIdentityGatePassed = agent === "hermes";
  const targetIdentityGatePassed = target === "lucy-mcp-proxy";
  const datasetIdentityGatePassed = dataset === "r1_doris_benchmark";
  const caseDatasetIdentityGatePassed = gates?.caseDatasetIdentity === true
    && caseDataset === dataset
    && caseDataset === "r1_doris_benchmark";
  const perCaseIdentityGatePassed = gates?.perCaseIdentity === true;
  const generatedByGatePassed = generatedBy === "scripts/lucy-r1-hermes-report.mjs";
  const questionCountGatePassed = minQuestions !== undefined && minQuestions >= 30 && totalQuestions !== undefined && totalQuestions >= minQuestions;
  const accuracyGatePassed = accuracy !== undefined && accuracy >= threshold;
  const coreMetricGatePassed = coreMetricAccuracy === 1;
  const securityGatePassed = securityPassRate === 1;
  const traceCoverageGatePassed = totalQuestions !== undefined && totalQuestions > 0 && tracedQuestions === totalQuestions;
  const traceUniquenessGatePassed = totalQuestions !== undefined && totalQuestions > 0 && uniqueTraces === totalQuestions && gates?.traceUniqueness === true;
  const noInvalidBenchmarkCasesGatePassed = gates?.noInvalidBenchmarkCases === true
    && Array.isArray(invalidBenchmarkCases)
    && invalidBenchmarkCases.length === 0;
  const noDuplicateBenchmarkCasesGatePassed = gates?.noDuplicateBenchmarkCases === true
    && Array.isArray(duplicateBenchmarkCaseIds)
    && duplicateBenchmarkCaseIds.length === 0;
  const noDuplicateCasesGatePassed = gates?.noDuplicateCases === true
    && Array.isArray(duplicateResultCaseIds)
    && duplicateResultCaseIds.length === 0;
  const evidenceCompletenessGatePassed = totalQuestions !== undefined
    && totalQuestions > 0
    && evidencedQuestions !== undefined
    && typeof evidencedQuestions === "object"
    && !Array.isArray(evidencedQuestions)
    && ["question", "hermesAnswer", "expectedAnswer", "source", "query", "judgement"].every((key) => (evidencedQuestions as Record<string, unknown>)[key] === totalQuestions);
  const lucyControlledEvidenceGatePassed = totalQuestions !== undefined
    && totalQuestions > 0
    && lucyControlledQuestions === totalQuestions
    && gates?.lucyControlledEvidence === true;
  const requiredGatesPassed = Boolean(gates) && requiredGateNames.every((key) => gates?.[key] === true);
  const gateErrors: string[] = [];
  if (!agentIdentityGatePassed) gateErrors.push('agent must be "hermes"');
  if (!targetIdentityGatePassed) gateErrors.push('target must be "lucy-mcp-proxy"');
  if (!datasetIdentityGatePassed) gateErrors.push('dataset must be "r1_doris_benchmark"');
  if (!caseDatasetIdentityGatePassed) gateErrors.push('inputs.caseDataset must be "r1_doris_benchmark" and gates.caseDatasetIdentity must be true');
  if (!perCaseIdentityGatePassed) gateErrors.push("gates.perCaseIdentity must be true");
  if (!generatedByGatePassed) gateErrors.push('generatedBy must be "scripts/lucy-r1-hermes-report.mjs"');
  if (!questionCountGatePassed) gateErrors.push("summary.totalQuestions must be >= summary.minQuestions and summary.minQuestions must be >= 30");
  if (!accuracyGatePassed) gateErrors.push("summary.accuracy must be >= threshold");
  if (!coreMetricGatePassed) gateErrors.push("summary.coreMetricAccuracy must be 1.0");
  if (!securityGatePassed) gateErrors.push("summary.securityPassRate must be 1.0");
  if (!traceCoverageGatePassed) gateErrors.push("summary.tracedQuestions must equal summary.totalQuestions");
  if (!traceUniquenessGatePassed) gateErrors.push("summary.uniqueTraces must equal summary.totalQuestions and gates.traceUniqueness must be true");
  if (!noInvalidBenchmarkCasesGatePassed) gateErrors.push("gates.noInvalidBenchmarkCases must be true and invalidBenchmarkCases must be empty");
  if (!noDuplicateBenchmarkCasesGatePassed) gateErrors.push("gates.noDuplicateBenchmarkCases must be true and duplicateBenchmarkCaseIds must be empty");
  if (!noDuplicateCasesGatePassed) gateErrors.push("gates.noDuplicateCases must be true and duplicateResultCaseIds must be empty");
  if (!evidenceCompletenessGatePassed) gateErrors.push("summary.evidencedQuestions must prove question, answer, expected answer, source, query, and judgement for every case");
  if (!lucyControlledEvidenceGatePassed) gateErrors.push("summary.lucyControlledQuestions must equal summary.totalQuestions and gates.lucyControlledEvidence must be true");
  if (!requiredGatesPassed) gateErrors.push("all required gates must be true");

  return {
    status: gateErrors.length === 0 ? "passed" : "failed",
    reportPath,
    agent: typeof agent === "string" ? agent : undefined,
    target: typeof target === "string" ? target : undefined,
    dataset: typeof dataset === "string" ? dataset : undefined,
    caseDataset: typeof caseDataset === "string" ? caseDataset : undefined,
    generatedBy: typeof generatedBy === "string" ? generatedBy : undefined,
    threshold,
    accuracy,
    coreMetricAccuracy,
    securityPassRate,
    tracedQuestions,
    uniqueTraces,
    totalQuestions,
    minQuestions,
    lucyControlledQuestions,
    lucyMetadataQuestions,
    lucyRejectionQuestions,
    evidencedQuestions: evidencedQuestions && typeof evidencedQuestions === "object" && !Array.isArray(evidencedQuestions)
      ? evidencedQuestions as Record<string, number>
      : undefined,
    invalidBenchmarkCases,
    duplicateBenchmarkCaseIds,
    duplicateResultCaseIds,
    gates,
    accuracyGatePassed,
    coreMetricGatePassed,
    securityGatePassed,
    traceCoverageGatePassed,
    traceUniquenessGatePassed,
    noDuplicateBenchmarkCasesGatePassed,
    noDuplicateCasesGatePassed,
    evidenceCompletenessGatePassed,
    lucyControlledEvidenceGatePassed,
    questionCountGatePassed,
    agentIdentityGatePassed,
    targetIdentityGatePassed,
    datasetIdentityGatePassed,
    caseDatasetIdentityGatePassed,
    perCaseIdentityGatePassed,
    generatedByGatePassed,
    noInvalidBenchmarkCasesGatePassed,
    requiredGatesPassed,
    gateErrors
  };
}

async function readHermesAccuracy(): Promise<HermesAccuracy> {
  const threshold = Number(process.env.LUCY_R1_HERMES_ACCURACY_THRESHOLD ?? 0.95);
  const reportPath = evidencePath("LUCY_R1_HERMES_ACCURACY_REPORT");
  if (!reportPath) return { status: "missing", threshold };
  let text: string;
  try {
    text = await readFile(reportPath, "utf8");
  } catch {
    return { status: "missing", reportPath, threshold };
  }
  try {
    return hermesFromStructuredReport(JSON.parse(text), reportPath, threshold);
  } catch {
    const match = text.match(/(?:accuracy|准确率)[^\d]*(\d+(?:\.\d+)?%?|0\.\d+)/i);
    if (!match?.[1]) return { status: "unparseable", reportPath, threshold };
    const raw = match[1].endsWith("%") ? Number(match[1].slice(0, -1)) / 100 : Number(match[1]);
    const accuracy = normalizeAccuracy(raw);
    if (accuracy === undefined) return { status: "unparseable", reportPath, threshold };
    return {
      status: "failed",
      reportPath,
      threshold,
      accuracy,
      accuracyGatePassed: accuracy >= threshold,
      gateErrors: ["structured Hermes R1 gates are required"]
    };
  }
}

async function readEvalObservability(hours: number): Promise<EvalObservability> {
  const db = await getEvalDb();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const latest = db.prepare(`
    SELECT id, domain, status, started_at, finished_at, total_cases, pass_count, fail_count
    FROM eval_run
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get() as {
    id: number;
    domain: string;
    status: string;
    started_at: string;
    finished_at: string | null;
    total_cases: number;
    pass_count: number;
    fail_count: number;
  } | undefined;
  const recent = db.prepare(`
    SELECT COUNT(*) AS runs,
           COALESCE(SUM(total_cases), 0) AS total_cases,
           COALESCE(SUM(pass_count), 0) AS pass_count,
           COALESCE(SUM(fail_count), 0) AS fail_count
    FROM eval_run
    WHERE started_at >= ? AND status = 'succeeded'
  `).get(since) as { runs: number; total_cases: number; pass_count: number; fail_count: number };
  return {
    latestRun: latest ? {
      id: latest.id,
      domain: latest.domain,
      status: latest.status,
      startedAt: latest.started_at,
      finishedAt: latest.finished_at ?? undefined,
      totalCases: latest.total_cases,
      passCount: latest.pass_count,
      failCount: latest.fail_count,
      passRate: rate(latest.pass_count, latest.total_cases)
    } : undefined,
    recent: {
      runs: recent.runs,
      totalCases: recent.total_cases,
      passCount: recent.pass_count,
      failCount: recent.fail_count,
      passRate: rate(recent.pass_count, recent.total_cases)
    }
  };
}

export function registerR1ObservabilityRoutes(app: FastifyInstance) {
  app.get<{
    Querystring: { hours?: string; slowMs?: string };
  }>("/api/r1/observability", async (request) => {
    const hours = Math.min(Math.max(parseInt(request.query.hours ?? "24", 10) || 24, 1), 24 * 90);
    const slowMs = Math.max(parseInt(request.query.slowMs ?? String(process.env.LUCY_R1_SLOW_QUERY_MS ?? 30_000), 10) || 30_000, 1);
    const [audit, evalStatus, hermesQa] = await Promise.all([
      readR1AuditObservability({ hours, slowMs }),
      readEvalObservability(hours),
      readHermesAccuracy()
    ]);

    return {
      ok: true,
      data: {
        generatedAt: new Date().toISOString(),
        audit,
        eval: evalStatus,
        hermesQa,
        releaseSignals: {
          trafficObservable: audit.traffic.businessCalls > 0,
          deniedReasonsObservable: audit.denials.length > 0,
          sourceErrorsObservable: audit.sourceErrors.length > 0,
          evalObservable: r1EvalGatePassed(evalStatus),
          hermesQuestionCountGatePassed: hermesQa.questionCountGatePassed === true,
          hermesAccuracyGatePassed: hermesQa.accuracyGatePassed === true,
          hermesCoreMetricGatePassed: hermesQa.coreMetricGatePassed === true,
          hermesSecurityGatePassed: hermesQa.securityGatePassed === true,
          hermesTraceCoverageGatePassed: hermesQa.traceCoverageGatePassed === true,
          hermesTraceUniquenessGatePassed: hermesQa.traceUniquenessGatePassed === true,
          hermesNoDuplicateBenchmarkCasesGatePassed: hermesQa.noDuplicateBenchmarkCasesGatePassed === true,
          hermesNoDuplicateCasesGatePassed: hermesQa.noDuplicateCasesGatePassed === true,
          hermesEvidenceCompletenessGatePassed: hermesQa.evidenceCompletenessGatePassed === true,
          hermesLucyControlledEvidenceGatePassed: hermesQa.lucyControlledEvidenceGatePassed === true,
          hermesPerCaseIdentityGatePassed: hermesQa.perCaseIdentityGatePassed === true,
          hermesNoInvalidBenchmarkCasesGatePassed: hermesQa.noInvalidBenchmarkCasesGatePassed === true,
          hermesReportGatePassed: hermesQa.status === "passed"
        }
      }
    };
  });
}
