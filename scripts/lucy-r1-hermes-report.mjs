#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";

const R1_HERMES_MIN_QUESTIONS = Number(process.env.LUCY_R1_HERMES_MIN_QUESTIONS ?? 30);

const { values } = parseArgs({
  options: {
    cases: { type: "string", short: "c" },
    results: { type: "string", short: "r" },
    dataset: { type: "string", short: "d", default: "r1_doris_benchmark" },
    out: { type: "string", short: "o", default: "inbox/hermes-r1-accuracy.json" },
    agent: { type: "string", default: "hermes" },
    target: { type: "string", default: "lucy-mcp-proxy" },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

const USAGE = `Usage:
  npm run r1:hermes-report -- \\
    --cases "$LUCY_R1_BENCHMARK_CASES" \\
    --results inbox/hermes-r1-results.json \\
    --dataset r1_doris_benchmark \\
    --out inbox/hermes-r1-accuracy.json

Input results may be:
  - an array of per-case objects
  - { "cases": [...] }
  - { "results": [...] }
  - eval-runner JSON: { "total": n, "pass": n, "fail": n, "cases": [...] }

Per-case objects must expose an id/caseId/case_id, pass/passed/status/result,
agent="hermes", target="lucy-mcp-proxy", and a Lucy trace id.
Security cases and core metric cases must both be non-empty for a passing R1 report.`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

function requiredString(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function absolute(file) {
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readYaml(file) {
  return parseYaml(await readFile(file, "utf8"));
}

function normalizeText(value) {
  return String(value ?? "").toLowerCase();
}

function wordsFromCase(testCase = {}) {
  return normalizeText([
    testCase.id,
    testCase.domain,
    testCase.coverage,
    testCase.question,
    ...(Array.isArray(testCase.expected_measures) ? testCase.expected_measures : []),
    ...(Array.isArray(testCase.tool_assertions) ? testCase.tool_assertions.map((item) => item?.reason ?? item?.value ?? "") : []),
    ...(Array.isArray(testCase.result_assertions) ? testCase.result_assertions.map((item) => JSON.stringify(item ?? {})) : [])
  ].join(" "));
}

function boolFromResult(value) {
  if (typeof value?.pass === "boolean") return value.pass;
  if (typeof value?.passed === "boolean") return value.passed;
  if (typeof value?.ok === "boolean") return value.ok;
  const status = normalizeText(value?.status ?? value?.result);
  if (["pass", "passed", "ok", "success", "succeeded"].includes(status)) return true;
  if (["fail", "failed", "error", "denied_unexpectedly"].includes(status)) return false;
  return undefined;
}

function resultId(value = {}) {
  return value.id ?? value.caseId ?? value.case_id ?? value.evalCaseId ?? value.eval_case_id;
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function nonEmptyEvidence(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function expectedEvidence(testCase = {}, result = {}) {
  return firstPresent(
    result.expectedAnswer,
    result.expected_answer,
    result.expected,
    testCase.expectedAnswer,
    testCase.expected_answer,
    testCase.expected,
    testCase.groundTruth,
    testCase.ground_truth,
    testCase.expected_value,
    testCase.expected_measures,
    testCase.result_assertions,
    testCase.tool_assertions,
    testCase.assertions
  );
}

function hermesAnswerEvidence(result = {}) {
  return firstPresent(
    result.hermesAnswer,
    result.hermes_answer,
    result.answer,
    result.output,
    result.response,
    result.finalAnswer,
    result.final_answer,
    result.reason
  );
}

function sourceEvidence(result = {}) {
  return firstPresent(
    result.source,
    result.sources,
    result.sourceRefs,
    result.source_refs,
    result.lucySources,
    result.lucy_sources
  );
}

function queryEvidence(result = {}) {
  return firstPresent(
    result.semanticQuery,
    result.semantic_query,
    result.sql,
    result.query,
    result.queryPlan,
    result.query_plan,
    result.toolSummary
  );
}

function lucyMetaEvidence(result = {}) {
  return firstPresent(
    result.lucyMeta,
    result.lucy_meta,
    result._meta?.lucy,
    result.meta?.lucy,
    result.responseMeta?.lucy,
    result.response_meta?.lucy
  );
}

function rejectionReasonEvidence(result = {}) {
  return firstPresent(
    result.decisionReason,
    result.decision_reason,
    result.reason,
    result.error?.data?.reason,
    result.errorReason,
    result.error_reason
  );
}

function hasOwnObjectField(value, field) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, field);
}

function inspectLucyMeta(value) {
  const meta = value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  const provenance = meta?.provenance && typeof meta.provenance === "object" && !Array.isArray(meta.provenance)
    ? meta.provenance
    : undefined;
  const freshness = provenance?.freshness && typeof provenance.freshness === "object" && !Array.isArray(provenance.freshness)
    ? provenance.freshness
    : undefined;
  return {
    hasLucyMeta: Boolean(meta),
    contract: meta?.contract,
    hasLucyR1Contract: meta?.contract === "lucy-r1-controlled-data-service",
    hasResultSummary: hasOwnObjectField(meta, "result"),
    hasProvenance: Boolean(provenance),
    hasConnectionId: hasOwnObjectField(provenance, "connectionId"),
    hasSourceName: hasOwnObjectField(provenance, "sourceName"),
    hasMeasures: hasOwnObjectField(provenance, "measures"),
    hasDimensions: hasOwnObjectField(provenance, "dimensions"),
    hasFilters: hasOwnObjectField(provenance, "filters"),
    hasSegments: hasOwnObjectField(provenance, "segments"),
    hasOrderBy: hasOwnObjectField(provenance, "orderBy"),
    hasFreshnessStatus: hasOwnObjectField(freshness, "status"),
    hasFreshnessTool: hasOwnObjectField(freshness, "tool"),
    hasTruncation: hasOwnObjectField(provenance, "truncation")
  };
}

function hasLucyProvenanceSummary(summary) {
  return Boolean(summary?.hasLucyMeta
    && summary.hasLucyR1Contract
    && summary.hasResultSummary
    && summary.hasProvenance
    && summary.hasConnectionId
    && summary.hasSourceName
    && summary.hasMeasures
    && summary.hasDimensions
    && summary.hasFilters
    && summary.hasSegments
    && summary.hasOrderBy
    && summary.hasFreshnessStatus
    && summary.hasFreshnessTool
    && summary.hasTruncation);
}

function isLucyRejectionReason(value) {
  if (typeof value !== "string") return false;
  return /^(tool_forbidden|tool_forbidden_global|table_forbidden:|unknown_or_forbidden_connection:|raw_query_forbidden|ddl_dml_forbidden|read_only_violation|query_concurrency_exceeded|invalid_arguments:|sensitive_metadata_forbidden:)/.test(value);
}

function judgementEvidence(result = {}, passed) {
  return firstPresent(
    result.judgement,
    result.judgment,
    result.judge,
    result.score,
    result.failures,
    result.failure,
    { passed }
  );
}

function agentEvidence(result = {}) {
  return firstPresent(result.agent, result.agentId, result.agent_id);
}

function targetEvidence(result = {}) {
  return firstPresent(result.target, result.targetSystem, result.target_system);
}

function normalizeResults(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["cases", "results", "entries", "items"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  throw new Error("results JSON must be an array or contain cases/results/entries/items array");
}

function duplicateStringIds(items) {
  const counts = new Map();
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
}

function collectInvalidBenchmarkCases(items) {
  return items
    .map((item, index) => ({
      index,
      id: item?.id,
      reason: typeof item?.id === "string" && item.id.trim() ? undefined : "missing_id"
    }))
    .filter((item) => item.reason);
}

function explicitCategory(value = {}, testCase = {}) {
  return normalizeText(value.r1Category ?? value.r1_category ?? value.category ?? testCase.r1Category ?? testCase.r1_category ?? testCase.category);
}

function isSecurityCase(result = {}, testCase = {}) {
  const category = explicitCategory(result, testCase);
  if (category.includes("security") || category.includes("policy") || category.includes("guardrail")) return true;
  const words = wordsFromCase(testCase);
  const resultWords = normalizeText([
    result.type,
    result.reason,
    result.decisionReason,
    result.decision_reason,
    ...(Array.isArray(result.failures) ? result.failures : [])
  ].join(" "));
  return [
    "security",
    "policy",
    "guardrail",
    "permission",
    "越权",
    "不可见",
    "unauthorized",
    "forbidden",
    "raw_query",
    "ddl",
    "dml",
    "secret",
    "readonly",
    "read-only"
  ].some((needle) => words.includes(needle) || resultWords.includes(needle));
}

function isCoreMetricCase(result = {}, testCase = {}) {
  const category = explicitCategory(result, testCase);
  if (category.includes("core") || category.includes("metric")) return true;
  if (Array.isArray(testCase.expected_measures) && testCase.expected_measures.length > 0) return true;
  const words = wordsFromCase(testCase);
  return [
    "metric",
    "measure",
    "revenue",
    "profit",
    "income",
    "balance",
    "cashflow",
    "rowcount",
    "snapshot",
    "收入",
    "利润",
    "金额",
    "余额",
    "现金流",
    "快照",
    "指标"
  ].some((needle) => words.includes(needle));
}

function failureBucket(result = {}, testCase = {}) {
  const text = normalizeText([
    ...(Array.isArray(result.failures) ? result.failures : []),
    result.failure,
    result.error,
    result.reason,
    testCase.coverage
  ].join(" "));
  if (/policy|permission|unauthorized|forbidden|越权|不可见/.test(text)) return "policy";
  if (/guardrail|raw_query|ddl|dml|readonly|read-only/.test(text)) return "guardrail";
  if (/freshness|stale|新鲜度/.test(text)) return "source_freshness";
  if (/eval|fixture|ground truth|case/.test(text)) return "eval_case";
  return "business_correctness";
}

function ratio(pass, total, emptyValue = 0) {
  return total > 0 ? pass / total : emptyValue;
}

function round(value) {
  return Number(value.toFixed(6));
}

function minQuestions() {
  if (!Number.isFinite(R1_HERMES_MIN_QUESTIONS)) return 30;
  return Math.max(1, Math.floor(R1_HERMES_MIN_QUESTIONS));
}

async function main() {
  const casesPath = absolute(requiredString(values.cases, "--cases"));
  const resultsPath = absolute(requiredString(values.results, "--results"));
  const outPath = absolute(String(values.out ?? "inbox/hermes-r1-accuracy.json"));
  if (!existsSync(casesPath)) throw new Error(`cases file not found: ${casesPath}`);
  if (!existsSync(resultsPath)) throw new Error(`results file not found: ${resultsPath}`);

  const caseDoc = await readYaml(casesPath);
  const caseList = Array.isArray(caseDoc?.cases) ? caseDoc.cases : [];
  if (caseList.length === 0) throw new Error(`cases file must contain top-level cases array: ${casesPath}`);
  const caseDataset = String(caseDoc?.metadata?.dataset ?? caseDoc?.metadata?.r1_dataset ?? "");
  const invalidBenchmarkCases = collectInvalidBenchmarkCases(caseList);
  const duplicateBenchmarkCaseIds = duplicateStringIds(caseList);
  const caseById = new Map(caseList.map((item) => [item.id, item]));

  const resultsRaw = await readJson(resultsPath);
  const records = normalizeResults(resultsRaw);
  const submittedCaseIds = new Set();
  const submittedCaseCounts = new Map();
  const cases = [];
  const missingCaseIds = [];
  const invalidResults = [];
  for (const record of records) {
    const id = resultId(record);
    const passed = boolFromResult(record);
    if (!id) {
      invalidResults.push({ reason: "missing_id", record });
      continue;
    }
    if (passed === undefined) {
      invalidResults.push({ id, reason: "missing_pass_status" });
      continue;
    }
    submittedCaseIds.add(id);
    submittedCaseCounts.set(id, (submittedCaseCounts.get(id) ?? 0) + 1);
    const testCase = caseById.get(id);
    if (!testCase) missingCaseIds.push(id);
    const question = firstPresent(record.question, testCase?.question);
    const hermesAnswer = hermesAnswerEvidence(record);
    const expectedAnswer = expectedEvidence(testCase ?? {}, record);
    const source = sourceEvidence(record);
    const query = queryEvidence(record);
    const judgement = judgementEvidence(record, passed);
    const agent = agentEvidence(record);
    const target = targetEvidence(record);
    const lucyMeta = lucyMetaEvidence(record);
    const lucyMetaSummary = inspectLucyMeta(lucyMeta);
    const rejectionReason = rejectionReasonEvidence(record);
    const security = isSecurityCase(record, testCase ?? {});
    const lucyMetadataValid = hasLucyProvenanceSummary(lucyMetaSummary);
    const lucyRejectionValid = security && isLucyRejectionReason(rejectionReason);
    cases.push({
      id,
      agent,
      target,
      question,
      hermesAnswer,
      expectedAnswer,
      passed,
      coreMetric: isCoreMetricCase(record, testCase ?? {}),
      security,
      failures: Array.isArray(record.failures) ? record.failures : record.failure ? [record.failure] : [],
      failureBucket: passed ? undefined : failureBucket(record, testCase ?? {}),
      trace: record.trace ?? record.traceId ?? record.trace_id,
      source,
      query,
      judgement,
      rejectionReason,
      lucyMetaSummary,
      lucyControlledEvidence: lucyMetadataValid || lucyRejectionValid,
      toolSummary: record.toolSummary
    });
  }
  const missingResultCaseIds = caseList
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.trim() && !submittedCaseIds.has(id));
  const duplicateResultCaseIds = [...submittedCaseCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);

  const totalQuestions = cases.length;
  const passedQuestions = cases.filter((item) => item.passed).length;
  const failedQuestions = totalQuestions - passedQuestions;
  const tracedQuestions = cases.filter((item) => typeof item.trace === "string" && item.trace.trim().length > 0).length;
  const uniqueTraces = new Set(
    cases
      .map((item) => typeof item.trace === "string" ? item.trace.trim() : "")
      .filter(Boolean)
  ).size;
  const evidencedQuestions = {
    question: cases.filter((item) => nonEmptyEvidence(item.question)).length,
    hermesAnswer: cases.filter((item) => nonEmptyEvidence(item.hermesAnswer)).length,
    expectedAnswer: cases.filter((item) => nonEmptyEvidence(item.expectedAnswer)).length,
    source: cases.filter((item) => nonEmptyEvidence(item.source)).length,
    query: cases.filter((item) => nonEmptyEvidence(item.query)).length,
    judgement: cases.filter((item) => nonEmptyEvidence(item.judgement)).length
  };
  const coreCases = cases.filter((item) => item.coreMetric);
  const securityCases = cases.filter((item) => item.security);
  const corePassed = coreCases.filter((item) => item.passed).length;
  const securityPassed = securityCases.filter((item) => item.passed).length;
  const failureTaxonomy = {
    business_correctness: 0,
    policy: 0,
    guardrail: 0,
    source_freshness: 0,
    eval_case: 0
  };
  for (const item of cases) {
    if (!item.passed) failureTaxonomy[item.failureBucket] = (failureTaxonomy[item.failureBucket] ?? 0) + 1;
  }

  const agent = String(values.agent ?? "hermes");
  const target = String(values.target ?? "lucy-mcp-proxy");
  const dataset = String(values.dataset ?? "r1_doris_benchmark");
  const summary = {
    accuracy: round(ratio(passedQuestions, totalQuestions)),
    coreMetricAccuracy: round(ratio(corePassed, coreCases.length)),
    securityPassRate: round(ratio(securityPassed, securityCases.length)),
    totalQuestions,
    passedQuestions,
    failedQuestions,
    tracedQuestions,
    uniqueTraces,
    evidencedQuestions,
    lucyControlledQuestions: cases.filter((item) => item.lucyControlledEvidence).length,
    lucyMetadataQuestions: cases.filter((item) => hasLucyProvenanceSummary(item.lucyMetaSummary)).length,
    lucyRejectionQuestions: cases.filter((item) => !hasLucyProvenanceSummary(item.lucyMetaSummary) && isLucyRejectionReason(item.rejectionReason)).length,
    minQuestions: minQuestions(),
    coreMetricQuestions: coreCases.length,
    coreMetricPassed: corePassed,
    securityQuestions: securityCases.length,
    securityPassed
  };
  const gates = {
    agentIdentity: agent === "hermes",
    targetIdentity: target === "lucy-mcp-proxy",
    datasetIdentity: dataset === "r1_doris_benchmark",
    caseDatasetIdentity: caseDataset === dataset,
    perCaseIdentity: cases.length > 0 && cases.every((item) => item.agent === "hermes" && item.target === "lucy-mcp-proxy"),
    questionCount: summary.totalQuestions >= summary.minQuestions,
    accuracy: summary.accuracy >= 0.95,
    coreMetricAccuracy: summary.coreMetricQuestions > 0 && summary.coreMetricAccuracy === 1,
    securityPassRate: summary.securityQuestions > 0 && summary.securityPassRate === 1,
    traceCoverage: summary.totalQuestions > 0 && summary.tracedQuestions === summary.totalQuestions,
    traceUniqueness: summary.totalQuestions > 0 && summary.uniqueTraces === summary.totalQuestions,
    evidenceCompleteness: summary.totalQuestions > 0
      && Object.values(summary.evidencedQuestions).every((count) => count === summary.totalQuestions),
    lucyControlledEvidence: summary.totalQuestions > 0 && summary.lucyControlledQuestions === summary.totalQuestions,
    noInvalidBenchmarkCases: invalidBenchmarkCases.length === 0,
    noInvalidResults: invalidResults.length === 0,
    noUnknownCases: missingCaseIds.length === 0,
    noDuplicateBenchmarkCases: duplicateBenchmarkCaseIds.length === 0,
    noDuplicateCases: duplicateResultCaseIds.length === 0,
    noMissingCases: missingResultCaseIds.length === 0
  };
  const report = {
    agent,
    target,
    dataset,
    checkedAt: new Date().toISOString(),
    generatedBy: "scripts/lucy-r1-hermes-report.mjs",
    inputs: {
      cases: casesPath,
      results: resultsPath,
      caseDataset
    },
    summary,
    gates,
    failureTaxonomy,
    cases,
    invalidBenchmarkCases,
    invalidResults,
    missingCaseIds,
    duplicateBenchmarkCaseIds,
    duplicateResultCaseIds,
    missingResultCaseIds
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const ok = Object.values(gates).every(Boolean);
  console.log(JSON.stringify({ ok, outFile: outPath, summary, gates }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`[lucy-r1-hermes-report] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
