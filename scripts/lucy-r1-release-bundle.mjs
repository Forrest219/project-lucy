#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { parse as parseYaml } from "yaml";

const { values } = parseArgs({
  options: {
    out: { type: "string", short: "o", default: "inbox/lucy-r1-release-bundle" },
    "observability-url": { type: "string" },
    "observability-file": { type: "string" },
    "eval-artifact": { type: "string", multiple: true },
    target: { type: "string", default: "doris" },
    "skip-observability": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  },
  allowPositionals: false
});

const USAGE = `Usage:
  LUCY_R1_MCP_CONTRACT_EVIDENCE=inbox/lucy-r1-mcp-contract-evidence.json \\
  LUCY_R1_DORIS_EVIDENCE=inbox/doris-r1-evidence.json \\
  LUCY_R1_HERMES_ACCURACY_REPORT=inbox/hermes-r1-accuracy.json \\
  npm run r1:release-bundle -- \\
    --observability-url http://127.0.0.1:5174/api/r1/observability?hours=24\\&slowMs=30000 \\
    --eval-artifact inbox/hermes-r1-eval-artifacts \\
    --out inbox/lucy-r1-release-bundle

The script runs strict readiness, copies the three required evidence files,
captures or copies the observability snapshot, copies at least one eval artifact,
writes SHA-256 checksums, and emits release-manifest.json.

--skip-observability is for local dry runs only. It always produces a not-ready
manifest and a non-zero exit code.`;

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const TARGET = String(values.target ?? "doris").trim().toLowerCase();
const TARGET_PROFILES = {
  doris: {
    id: "doris",
    label: "Doris",
    engine: "doris",
    evidenceEnv: "LUCY_R1_DORIS_EVIDENCE",
    dataset: "r1_doris_benchmark"
  },
  starrocks: {
    id: "starrocks",
    label: "StarRocks",
    engine: "starrocks",
    evidenceEnv: "LUCY_R1_STARROCKS_EVIDENCE",
    dataset: "r1_doris_benchmark"
  }
};
const TARGET_PROFILE = TARGET_PROFILES[TARGET];
if (!TARGET_PROFILE) {
  console.error(`[lucy-r1-release-bundle] FAIL: --target must be doris or starrocks, got ${TARGET}`);
  process.exit(1);
}

// Static readiness anchors for the default Doris R1 path:
// "release local config is not ready for Doris R1"
// "Hermes cases must reference Doris evidence sourceName"
// "observability sourceErrors must reference Doris evidence connectionId or sourceName"
// "observability slowQueries must reference Doris source or source_timeout"

const REQUIRED_EVIDENCE = [
  ["mcpContract", "LUCY_R1_MCP_CONTRACT_EVIDENCE"],
  [TARGET_PROFILE.id, TARGET_PROFILE.evidenceEnv],
  ["hermes", "LUCY_R1_HERMES_ACCURACY_REPORT"]
];
const R1_EVAL_PASS_RATE_THRESHOLD = 0.95;
const RELEASE_MAX_EVIDENCE_WINDOW_HOURS = Math.max(
  Number(process.env.LUCY_R1_RELEASE_MAX_EVIDENCE_WINDOW_HOURS ?? 24),
  1
);
const RELEASE_CLOCK_SKEW_MS = 5 * 60 * 1000;
const EVAL_ARTIFACT_IDENTITY_MARKERS = [
  ["r1Dataset", TARGET_PROFILE.dataset],
  ["hermesAgent", "hermes"],
  ["lucyMcpProxyTarget", "lucy-mcp-proxy"]
];
const EVAL_ARTIFACT_SCAN_MAX_BYTES = 2 * 1024 * 1024;
const EVAL_ARTIFACT_COVERAGE_SAMPLE_LIMIT = 10;
const R1_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
];

function absolute(file) {
  return path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
}

function evidencePath(envName) {
  const value = process.env[envName];
  if (!value || !value.trim()) throw new Error(`${envName} is required`);
  const file = absolute(value.trim());
  if (!existsSync(file)) throw new Error(`${envName} points to a missing file: ${file}`);
  return file;
}

function configRoot() {
  const value = process.env.LUCY_R1_RELEASE_CONFIG_ROOT;
  return value && value.trim() ? absolute(value.trim()) : process.cwd();
}

async function sha256(file) {
  const info = await stat(file);
  if (info.isDirectory()) return sha256Directory(file);
  if (!info.isFile()) throw new Error(`cannot hash non-file artifact: ${file}`);
  const hash = createHash("sha256");
  hash.update(await readFile(file));
  return hash.digest("hex");
}

async function sha256Directory(dir) {
  const hash = createHash("sha256");
  async function visit(current, relative) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absoluteEntry = path.join(current, entry.name);
      const relativeEntry = path.join(relative, entry.name).split(path.sep).join("/");
      if (entry.isDirectory()) {
        hash.update(`dir\0${relativeEntry}\0`);
        await visit(absoluteEntry, relativeEntry);
      } else if (entry.isFile()) {
        hash.update(`file\0${relativeEntry}\0`);
        hash.update(await sha256(absoluteEntry));
        hash.update("\0");
      } else {
        throw new Error(`cannot hash unsupported artifact entry: ${absoluteEntry}`);
      }
    }
  }
  await visit(dir, "");
  return hash.digest("hex");
}

function runReadinessStrict(env) {
  const result = spawnSync(process.execPath, ["scripts/lucy-r1-readiness.mjs", "--strict", "--target", TARGET_PROFILE.id], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf8"
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function readYamlFile(file, label) {
  try {
    return parseYaml(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} is not valid YAML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAt(value, pathSegments) {
  let current = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function requireObject(value, pathExpression, errors) {
  if (!isObject(value)) {
    errors.push(`${pathExpression} must be an object`);
    return {};
  }
  return value;
}

function requireArray(value, pathExpression, errors, { nonEmpty = false } = {}) {
  if (!Array.isArray(value)) {
    errors.push(`${pathExpression} must be an array`);
    return [];
  }
  if (nonEmpty && value.length === 0) errors.push(`${pathExpression} must be non-empty`);
  return value;
}

function requireFiniteNumber(value, pathExpression, errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors.push(`${pathExpression} must be a finite number`);
    return undefined;
  }
  return value;
}

function requireNonEmptyString(value, pathExpression, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${pathExpression} must be a non-empty string`);
    return undefined;
  }
  return value;
}

function validateAuditSnapshot(audit, errors) {
  const traffic = requireObject(audit.traffic, "data.audit.traffic", errors);
  for (const field of ["totalRequests", "businessCalls", "okCalls", "errorCalls", "deniedCalls", "successRate", "errorRate", "deniedRate"]) {
    requireFiniteNumber(traffic[field], `data.audit.traffic.${field}`, errors);
  }
  const latency = requireObject(audit.latency, "data.audit.latency", errors);
  for (const field of ["p50Ms", "p95Ms", "slowCalls"]) {
    requireFiniteNumber(latency[field], `data.audit.latency.${field}`, errors);
  }
  requireArray(latency.slowQueries, "data.audit.latency.slowQueries", errors);
  const denials = requireArray(audit.denials, "data.audit.denials", errors, { nonEmpty: true });
  denials.forEach((denial, index) => {
    const item = requireObject(denial, `data.audit.denials[${index}]`, errors);
    requireNonEmptyString(item.reason, `data.audit.denials[${index}].reason`, errors);
    requireFiniteNumber(item.count, `data.audit.denials[${index}].count`, errors);
  });
  if (!denials.some((denial) => denial?.reason === "query_concurrency_exceeded")) {
    errors.push("data.audit.denials must include query_concurrency_exceeded");
  }
  const sourceErrors = requireArray(audit.sourceErrors, "data.audit.sourceErrors", errors, { nonEmpty: true });
  sourceErrors.forEach((sourceError, index) => {
    const item = requireObject(sourceError, `data.audit.sourceErrors[${index}]`, errors);
    requireNonEmptyString(item.source, `data.audit.sourceErrors[${index}].source`, errors);
    requireNonEmptyString(item.outcome, `data.audit.sourceErrors[${index}].outcome`, errors);
    requireFiniteNumber(item.count, `data.audit.sourceErrors[${index}].count`, errors);
  });
  const usage = requireObject(audit.usage, "data.audit.usage", errors);
  for (const field of ["tools", "roles", "tokens"]) {
    requireArray(usage[field], `data.audit.usage.${field}`, errors);
  }
}

function validateEvalSnapshot(evalStatus, errors) {
  const latestRun = requireObject(evalStatus.latestRun, "data.eval.latestRun", errors);
  const latestDomain = requireNonEmptyString(latestRun.domain, "data.eval.latestRun.domain", errors);
  const latestStatus = requireNonEmptyString(latestRun.status, "data.eval.latestRun.status", errors);
  for (const field of ["totalCases", "passCount", "failCount", "passRate"]) {
    requireFiniteNumber(latestRun[field], `data.eval.latestRun.${field}`, errors);
  }
  if (typeof latestDomain === "string" && !latestDomain.startsWith("r1_")) {
    errors.push('data.eval.latestRun.domain must start with "r1_"');
  }
  if (latestStatus !== "succeeded") errors.push('data.eval.latestRun.status must be "succeeded"');
  if (typeof latestRun.totalCases === "number" && latestRun.totalCases <= 0) {
    errors.push("data.eval.latestRun.totalCases must be > 0");
  }
  if (typeof latestRun.passRate === "number" && latestRun.passRate < R1_EVAL_PASS_RATE_THRESHOLD) {
    errors.push("data.eval.latestRun.passRate must be >= 0.95");
  }
  const recent = requireObject(evalStatus.recent, "data.eval.recent", errors);
  for (const field of ["runs", "totalCases", "passCount", "failCount", "passRate"]) {
    requireFiniteNumber(recent[field], `data.eval.recent.${field}`, errors);
  }
  if (typeof recent.runs === "number" && recent.runs <= 0) errors.push("data.eval.recent.runs must be > 0");
  if (typeof recent.totalCases === "number" && recent.totalCases <= 0) errors.push("data.eval.recent.totalCases must be > 0");
  if (typeof recent.passRate === "number" && recent.passRate < R1_EVAL_PASS_RATE_THRESHOLD) {
    errors.push("data.eval.recent.passRate must be >= 0.95");
  }
}

function validateHermesQaSnapshot(hermesQa, errors) {
  requireNonEmptyString(hermesQa.status, "data.hermesQa.status", errors);
  if (hermesQa.status !== "passed") errors.push('data.hermesQa.status must be "passed"');
  const agent = requireNonEmptyString(hermesQa.agent, "data.hermesQa.agent", errors);
  if (agent !== "hermes") errors.push('data.hermesQa.agent must be "hermes"');
  const target = requireNonEmptyString(hermesQa.target, "data.hermesQa.target", errors);
  if (target !== "lucy-mcp-proxy") errors.push('data.hermesQa.target must be "lucy-mcp-proxy"');
  const generatedBy = requireNonEmptyString(hermesQa.generatedBy, "data.hermesQa.generatedBy", errors);
  if (generatedBy !== "scripts/lucy-r1-hermes-report.mjs") errors.push('data.hermesQa.generatedBy must be "scripts/lucy-r1-hermes-report.mjs"');
  const dataset = requireNonEmptyString(hermesQa.dataset, "data.hermesQa.dataset", errors);
  if (dataset !== "r1_doris_benchmark") errors.push('data.hermesQa.dataset must be "r1_doris_benchmark"');
  const caseDataset = requireNonEmptyString(hermesQa.caseDataset, "data.hermesQa.caseDataset", errors);
  if (caseDataset !== "r1_doris_benchmark") errors.push('data.hermesQa.caseDataset must be "r1_doris_benchmark"');
  if (hermesQa.agentIdentityGatePassed !== true) errors.push("data.hermesQa.agentIdentityGatePassed must be true");
  if (hermesQa.targetIdentityGatePassed !== true) errors.push("data.hermesQa.targetIdentityGatePassed must be true");
  if (hermesQa.datasetIdentityGatePassed !== true) errors.push("data.hermesQa.datasetIdentityGatePassed must be true");
  if (hermesQa.caseDatasetIdentityGatePassed !== true) errors.push("data.hermesQa.caseDatasetIdentityGatePassed must be true");
  if (hermesQa.perCaseIdentityGatePassed !== true) errors.push("data.hermesQa.perCaseIdentityGatePassed must be true");
  if (hermesQa.noInvalidBenchmarkCasesGatePassed !== true) errors.push("data.hermesQa.noInvalidBenchmarkCasesGatePassed must be true");
  if (hermesQa.traceUniquenessGatePassed !== true) errors.push("data.hermesQa.traceUniquenessGatePassed must be true");
  if (hermesQa.noDuplicateBenchmarkCasesGatePassed !== true) errors.push("data.hermesQa.noDuplicateBenchmarkCasesGatePassed must be true");
  if (hermesQa.noDuplicateCasesGatePassed !== true) errors.push("data.hermesQa.noDuplicateCasesGatePassed must be true");
  if (hermesQa.lucyControlledEvidenceGatePassed !== true) errors.push("data.hermesQa.lucyControlledEvidenceGatePassed must be true");
  if (hermesQa.generatedByGatePassed !== true) errors.push("data.hermesQa.generatedByGatePassed must be true");
  for (const field of ["accuracy", "coreMetricAccuracy", "securityPassRate", "tracedQuestions", "uniqueTraces", "totalQuestions", "minQuestions", "lucyControlledQuestions", "lucyMetadataQuestions", "lucyRejectionQuestions", "threshold"]) {
    requireFiniteNumber(hermesQa[field], `data.hermesQa.${field}`, errors);
  }
  if (typeof hermesQa.totalQuestions === "number" && hermesQa.lucyControlledQuestions !== hermesQa.totalQuestions) {
    errors.push("data.hermesQa.lucyControlledQuestions must equal data.hermesQa.totalQuestions");
  }
  if (typeof hermesQa.lucyMetadataQuestions === "number" && hermesQa.lucyMetadataQuestions <= 0) {
    errors.push("data.hermesQa.lucyMetadataQuestions must be > 0");
  }
  if (typeof hermesQa.lucyRejectionQuestions === "number" && hermesQa.lucyRejectionQuestions < 0) {
    errors.push("data.hermesQa.lucyRejectionQuestions must be >= 0");
  }
  if (typeof hermesQa.minQuestions === "number" && hermesQa.minQuestions < 30) {
    errors.push("data.hermesQa.minQuestions must be >= 30");
  }
  if (typeof hermesQa.totalQuestions === "number" && typeof hermesQa.minQuestions === "number" && hermesQa.totalQuestions < hermesQa.minQuestions) {
    errors.push("data.hermesQa.totalQuestions must be >= data.hermesQa.minQuestions");
  }
  const evidencedQuestions = requireObject(hermesQa.evidencedQuestions, "data.hermesQa.evidencedQuestions", errors);
  for (const field of ["question", "hermesAnswer", "expectedAnswer", "source", "query", "judgement"]) {
    requireFiniteNumber(evidencedQuestions[field], `data.hermesQa.evidencedQuestions.${field}`, errors);
  }
}

async function validateObservabilitySnapshot(file) {
  const errors = [];
  const value = await readJsonFile(file, "observability snapshot");
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push("snapshot root must be an object");
  }
  if (value?.ok !== true) errors.push("ok must be true");
  const data = value?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    errors.push("data must be an object");
  } else {
    if (typeof data.generatedAt !== "string" || !data.generatedAt.trim()) errors.push("data.generatedAt must be a non-empty string");
    for (const key of ["audit", "eval", "hermesQa", "releaseSignals"]) {
      if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) errors.push(`data.${key} must be an object`);
    }
    const signals = data.releaseSignals ?? {};
    for (const key of [
      "trafficObservable",
      "deniedReasonsObservable",
      "sourceErrorsObservable",
      "evalObservable",
      "hermesQuestionCountGatePassed",
      "hermesAccuracyGatePassed",
      "hermesCoreMetricGatePassed",
      "hermesSecurityGatePassed",
      "hermesTraceCoverageGatePassed",
      "hermesTraceUniquenessGatePassed",
      "hermesNoDuplicateBenchmarkCasesGatePassed",
      "hermesNoDuplicateCasesGatePassed",
      "hermesEvidenceCompletenessGatePassed",
      "hermesLucyControlledEvidenceGatePassed",
      "hermesPerCaseIdentityGatePassed",
      "hermesNoInvalidBenchmarkCasesGatePassed",
      "hermesReportGatePassed"
    ]) {
      if (typeof signals[key] !== "boolean") errors.push(`data.releaseSignals.${key} must be boolean`);
    }
    if (signals.trafficObservable !== true) errors.push("data.releaseSignals.trafficObservable must be true");
    if (signals.deniedReasonsObservable !== true) errors.push("data.releaseSignals.deniedReasonsObservable must be true");
    if (signals.sourceErrorsObservable !== true) errors.push("data.releaseSignals.sourceErrorsObservable must be true");
    if (signals.evalObservable !== true) errors.push("data.releaseSignals.evalObservable must be true");
    if (signals.trafficObservable === true && isObject(data.audit?.traffic) && typeof data.audit.traffic.businessCalls === "number" && data.audit.traffic.businessCalls <= 0) {
      errors.push("data.releaseSignals.trafficObservable requires data.audit.traffic.businessCalls > 0");
    }
    if (signals.hermesQuestionCountGatePassed !== true) errors.push("data.releaseSignals.hermesQuestionCountGatePassed must be true");
    if (signals.hermesAccuracyGatePassed !== true) errors.push("data.releaseSignals.hermesAccuracyGatePassed must be true");
    if (signals.hermesCoreMetricGatePassed !== true) errors.push("data.releaseSignals.hermesCoreMetricGatePassed must be true");
    if (signals.hermesSecurityGatePassed !== true) errors.push("data.releaseSignals.hermesSecurityGatePassed must be true");
    if (signals.hermesTraceCoverageGatePassed !== true) errors.push("data.releaseSignals.hermesTraceCoverageGatePassed must be true");
    if (signals.hermesTraceUniquenessGatePassed !== true) errors.push("data.releaseSignals.hermesTraceUniquenessGatePassed must be true");
    if (signals.hermesNoDuplicateBenchmarkCasesGatePassed !== true) errors.push("data.releaseSignals.hermesNoDuplicateBenchmarkCasesGatePassed must be true");
    if (signals.hermesNoDuplicateCasesGatePassed !== true) errors.push("data.releaseSignals.hermesNoDuplicateCasesGatePassed must be true");
    if (signals.hermesEvidenceCompletenessGatePassed !== true) errors.push("data.releaseSignals.hermesEvidenceCompletenessGatePassed must be true");
    if (signals.hermesLucyControlledEvidenceGatePassed !== true) errors.push("data.releaseSignals.hermesLucyControlledEvidenceGatePassed must be true");
    if (signals.hermesPerCaseIdentityGatePassed !== true) errors.push("data.releaseSignals.hermesPerCaseIdentityGatePassed must be true");
    if (signals.hermesNoInvalidBenchmarkCasesGatePassed !== true) errors.push("data.releaseSignals.hermesNoInvalidBenchmarkCasesGatePassed must be true");
    if (signals.hermesReportGatePassed !== true) errors.push("data.releaseSignals.hermesReportGatePassed must be true");
    if (isObject(data.audit)) validateAuditSnapshot(data.audit, errors);
    if (isObject(data.eval)) validateEvalSnapshot(data.eval, errors);
    if (isObject(data.hermesQa)) validateHermesQaSnapshot(data.hermesQa, errors);
  }
  if (errors.length > 0) throw new Error(`observability snapshot failed R1 validation: ${errors.join("; ")}`);
  return {
    ok: true,
    generatedAt: data.generatedAt,
    releaseSignals: data.releaseSignals
  };
}

function sameFiniteNumber(left, right) {
  return typeof left === "number"
    && typeof right === "number"
    && Number.isFinite(left)
    && Number.isFinite(right)
    && Math.abs(left - right) < 1e-9;
}

function validateEqualString(left, right, label, errors) {
  if (typeof left !== "string" || !left.trim() || typeof right !== "string" || !right.trim()) {
    errors.push(`${label} must be present in both evidence files`);
    return;
  }
  if (left !== right) errors.push(`${label} mismatch: ${left} != ${right}`);
}

function validateEqualNumber(left, right, label, errors) {
  if (!sameFiniteNumber(left, right)) errors.push(`${label} mismatch: ${left} != ${right}`);
}

async function validateLocalReleaseConfig(evidence) {
  const root = configRoot();
  const errors = [];
  const targetEvidence = await readJsonFile(evidence[TARGET_PROFILE.id].file, `${TARGET_PROFILE.label} evidence`);
  const expectedConnectionId = targetEvidence.connectionId;
  const expectedSourceName = targetEvidence.sourceName;
  const ktxPath = path.join(root, "ktx.yaml");
  const accessPath = path.join(root, "webui", "config", "access.yaml");
  if (!existsSync(ktxPath)) errors.push(`ktx.yaml is missing under release config root: ${root}`);
  if (!existsSync(accessPath)) errors.push(`webui/config/access.yaml is missing under release config root: ${root}`);
  const ktx = existsSync(ktxPath) ? await readYamlFile(ktxPath, "ktx.yaml") : undefined;
  const access = existsSync(accessPath) ? await readYamlFile(accessPath, "webui/config/access.yaml") : undefined;

  const connection = ktx?.connections?.[expectedConnectionId];
  if (!connection) {
    errors.push(`ktx.yaml must define connections.${expectedConnectionId}`);
  } else {
    if (connection.engine !== TARGET_PROFILE.engine) errors.push(`connections.${expectedConnectionId}.engine must be "${TARGET_PROFILE.engine}"`);
    const wireProtocol = connection.wire_protocol ?? connection.wireProtocol;
    if (wireProtocol !== "mysql") errors.push(`connections.${expectedConnectionId}.wire_protocol must be "mysql"`);
    if (connection.readonly !== true) errors.push(`connections.${expectedConnectionId}.readonly must be true`);
    const r1Target = connection.r1_target ?? connection.r1Target;
    if (r1Target !== true) errors.push(`connections.${expectedConnectionId}.r1_target must be true`);
    const enabledTables = Array.isArray(connection.enabled_tables) ? connection.enabled_tables : [];
    if (enabledTables.length === 0) errors.push(`connections.${expectedConnectionId}.enabled_tables must be non-empty`);
    if (typeof expectedSourceName === "string" && expectedSourceName.trim()) {
      const sourceReferenced = enabledTables.some((item) => String(item).split(".").pop() === expectedSourceName);
      if (!sourceReferenced) errors.push(`connections.${expectedConnectionId}.enabled_tables must include source ${expectedSourceName}`);
    }
  }

  const role = access?.roles?.lucy_r1_exact_readonly;
  if (!role) {
    errors.push("webui/config/access.yaml must define roles.lucy_r1_exact_readonly");
  } else {
    const connections = Array.isArray(role.allow?.connections) ? role.allow.connections : [];
    if (connections.length !== 1 || connections[0] !== expectedConnectionId) {
      errors.push(`lucy_r1_exact_readonly.allow.connections must be exactly ["${expectedConnectionId}"]`);
    }
    const tools = Array.isArray(role.allow?.tools) ? role.allow.tools : [];
    if (tools.length !== R1_TOOLS.length || !R1_TOOLS.every((tool) => tools.includes(tool))) {
      errors.push("lucy_r1_exact_readonly.allow.tools must be exactly the 6 Lucy R1 tools");
    }
    const selectors = Array.isArray(role.allow?.tableSelectors) ? role.allow.tableSelectors : [];
    if (selectors.length === 0) {
      errors.push("lucy_r1_exact_readonly.allow.tableSelectors must be non-empty");
    }
    const wrongSelectors = selectors.filter((item) => item?.connection !== expectedConnectionId);
    if (wrongSelectors.length > 0) {
      errors.push(`lucy_r1_exact_readonly.allow.tableSelectors must only reference ${expectedConnectionId}`);
    }
    if (typeof expectedSourceName === "string" && expectedSourceName.trim()) {
      const selectorReferencesSource = selectors.some((item) => (
        Array.isArray(item?.names) && item.names.includes(expectedSourceName)
      ));
      if (!selectorReferencesSource) {
        errors.push(`lucy_r1_exact_readonly.allow.tableSelectors must include source ${expectedSourceName}`);
      }
    }
  }

  if (errors.length > 0) throw new Error(`release local config is not ready for ${TARGET_PROFILE.label} R1: ${errors.join("; ")}`);
  return {
    ok: true,
    root,
    connectionId: expectedConnectionId,
    sourceName: expectedSourceName,
    exactRole: "lucy_r1_exact_readonly"
  };
}

function finiteCount(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function textContainsAny(value, needles) {
  const text = JSON.stringify(value ?? {}).toLowerCase();
  return needles
    .filter((needle) => typeof needle === "string" && needle.trim())
    .some((needle) => text.includes(needle.trim().toLowerCase()));
}

function hermesCasesReferenceSource(cases, sourceName) {
  if (!Array.isArray(cases) || typeof sourceName !== "string" || !sourceName.trim()) {
    return { ok: false, matchingCaseIds: [] };
  }
  const matchingCaseIds = cases
    .filter((item) => textContainsAny({
      source: item?.source,
      query: item?.query,
      semanticQuery: item?.semanticQuery,
      sql: item?.sql
    }, [sourceName]))
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.trim());
  return {
    ok: matchingCaseIds.length > 0,
    matchingCaseIds
  };
}

function timestampMs(value, label, errors) {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${label} must be a non-empty timestamp`);
    return undefined;
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    errors.push(`${label} must be a valid ISO timestamp`);
    return undefined;
  }
  return ms;
}

function validateEvidenceTiming(mcp, targetEvidence, hermes, snapshot, errors) {
  const timestamps = [
    ["MCP checkedAt", timestampMs(mcp.checkedAt, "MCP checkedAt", errors)],
    [`${TARGET_PROFILE.label} checkedAt`, timestampMs(targetEvidence.checkedAt, `${TARGET_PROFILE.label} checkedAt`, errors)],
    ["Hermes checkedAt", timestampMs(hermes.checkedAt, "Hermes checkedAt", errors)],
    ["observability generatedAt", timestampMs(snapshot?.data?.generatedAt, "observability generatedAt", errors)]
  ].filter(([, ms]) => typeof ms === "number");
  if (timestamps.length !== 4) return undefined;

  const values = timestamps.map(([, ms]) => ms);
  const oldest = Math.min(...values);
  const newest = Math.max(...values);
  const maxWindowMs = RELEASE_MAX_EVIDENCE_WINDOW_HOURS * 60 * 60 * 1000;
  const now = Date.now();
  if (newest - oldest > maxWindowMs) {
    errors.push(`release evidence timestamps must fit within ${RELEASE_MAX_EVIDENCE_WINDOW_HOURS}h`);
  }
  if (oldest < now - maxWindowMs) {
    errors.push(`release evidence timestamps must be no older than ${RELEASE_MAX_EVIDENCE_WINDOW_HOURS}h`);
  }
  if (newest > now + RELEASE_CLOCK_SKEW_MS) {
    errors.push("release evidence timestamps must not be in the future");
  }
  return {
    oldest: new Date(oldest).toISOString(),
    newest: new Date(newest).toISOString(),
    maxWindowHours: RELEASE_MAX_EVIDENCE_WINDOW_HOURS
  };
}

async function validateEvidenceConsistency(evidence, observability) {
  const errors = [];
  const mcp = await readJsonFile(evidence.mcpContract.file, "MCP contract evidence");
  const targetEvidence = await readJsonFile(evidence[TARGET_PROFILE.id].file, `${TARGET_PROFILE.label} evidence`);
  const hermes = await readJsonFile(evidence.hermes.file, "Hermes evidence");
  const snapshot = await readJsonFile(observability.file, "observability snapshot");

  validateEqualString(mcp.connectionId, targetEvidence.connectionId, `MCP/${TARGET_PROFILE.label} connectionId`, errors);
  validateEqualString(mcp.sourceName, targetEvidence.sourceName, `MCP/${TARGET_PROFILE.label} sourceName`, errors);
  const targetNeedles = [targetEvidence.connectionId, targetEvidence.sourceName];
  const sourceErrors = Array.isArray(snapshot?.data?.audit?.sourceErrors) ? snapshot.data.audit.sourceErrors : [];
  if (!sourceErrors.some((item) => textContainsAny(item, targetNeedles))) {
    errors.push(`observability sourceErrors must reference ${TARGET_PROFILE.label} evidence connectionId or sourceName`);
  }
  const slowQueries = Array.isArray(snapshot?.data?.audit?.latency?.slowQueries) ? snapshot.data.audit.latency.slowQueries : [];
  if (!slowQueries.some((item) => textContainsAny(item, [...targetNeedles, "source_timeout"]))) {
    errors.push(`observability slowQueries must reference ${TARGET_PROFILE.label} source or source_timeout`);
  }
  const usageTools = Array.isArray(snapshot?.data?.audit?.usage?.tools) ? snapshot.data.audit.usage.tools : [];
  if (!usageTools.some((item) => item?.tool === "lucy_query")) {
    errors.push("observability usage.tools must include lucy_query");
  }
  const mcpConcurrencyDenialCount = valueAt(mcp, ["checkDetails", "concurrencyGuardrail", "denialCount"]);
  const denials = Array.isArray(snapshot?.data?.audit?.denials) ? snapshot.data.audit.denials : [];
  const observedConcurrencyDenialCount = denials
    .filter((item) => item?.reason === "query_concurrency_exceeded")
    .reduce((sum, item) => sum + finiteCount(item?.count), 0);
  if (
    typeof mcpConcurrencyDenialCount === "number"
    && Number.isFinite(mcpConcurrencyDenialCount)
    && observedConcurrencyDenialCount < mcpConcurrencyDenialCount
  ) {
    errors.push("observability query_concurrency_exceeded denial count must be >= MCP concurrency denialCount");
  }
  const lucyQueryUsageDeniedCount = usageTools
    .filter((item) => item?.tool === "lucy_query")
    .reduce((sum, item) => sum + finiteCount(item?.denied), 0);
  if (
    typeof mcpConcurrencyDenialCount === "number"
    && Number.isFinite(mcpConcurrencyDenialCount)
    && lucyQueryUsageDeniedCount < mcpConcurrencyDenialCount
  ) {
    errors.push("observability usage.tools lucy_query denied count must be >= MCP concurrency denialCount");
  }

  const hermesSourceCoverage = hermesCasesReferenceSource(hermes.cases, targetEvidence.sourceName);
  if (!hermesSourceCoverage.ok) {
    errors.push(`Hermes cases must reference ${TARGET_PROFILE.label} evidence sourceName`);
  }

  const hermesSummary = isObject(hermes.summary) ? hermes.summary : {};
  const hermesQa = isObject(snapshot?.data?.hermesQa) ? snapshot.data.hermesQa : {};
  validateEqualString(hermes.agent, hermesQa.agent, "Hermes agent", errors);
  validateEqualString(hermes.target, hermesQa.target, "Hermes target", errors);
  validateEqualString(hermes.generatedBy, hermesQa.generatedBy, "Hermes generatedBy", errors);
  validateEqualString(hermes.dataset, hermesQa.dataset, "Hermes dataset", errors);
  validateEqualString(valueAt(hermes, ["inputs", "caseDataset"]), hermesQa.caseDataset, "Hermes caseDataset", errors);
  if (valueAt(hermes, ["gates", "perCaseIdentity"]) !== hermesQa.perCaseIdentityGatePassed) {
    errors.push("Hermes perCaseIdentity gate mismatch");
  }
  if (valueAt(hermes, ["gates", "traceUniqueness"]) !== hermesQa.traceUniquenessGatePassed) {
    errors.push("Hermes traceUniqueness gate mismatch");
  }
  if (valueAt(hermes, ["gates", "lucyControlledEvidence"]) !== hermesQa.lucyControlledEvidenceGatePassed) {
    errors.push("Hermes lucyControlledEvidence gate mismatch");
  }
  if (valueAt(hermes, ["gates", "noInvalidBenchmarkCases"]) !== hermesQa.noInvalidBenchmarkCasesGatePassed) {
    errors.push("Hermes noInvalidBenchmarkCases gate mismatch");
  }
  if (valueAt(hermes, ["gates", "noDuplicateBenchmarkCases"]) !== hermesQa.noDuplicateBenchmarkCasesGatePassed) {
    errors.push("Hermes noDuplicateBenchmarkCases gate mismatch");
  }
  if (valueAt(hermes, ["gates", "noDuplicateCases"]) !== hermesQa.noDuplicateCasesGatePassed) {
    errors.push("Hermes noDuplicateCases gate mismatch");
  }
  for (const field of ["accuracy", "coreMetricAccuracy", "securityPassRate", "totalQuestions", "minQuestions", "tracedQuestions", "uniqueTraces", "lucyControlledQuestions", "lucyMetadataQuestions", "lucyRejectionQuestions"]) {
    validateEqualNumber(hermesSummary[field], hermesQa[field], `Hermes ${field}`, errors);
  }
  for (const field of ["question", "hermesAnswer", "expectedAnswer", "source", "query", "judgement"]) {
    validateEqualNumber(
      valueAt(hermesSummary, ["evidencedQuestions", field]),
      valueAt(hermesQa, ["evidencedQuestions", field]),
      `Hermes evidencedQuestions.${field}`,
      errors
    );
  }
  const timing = validateEvidenceTiming(mcp, targetEvidence, hermes, snapshot, errors);

  if (errors.length > 0) throw new Error(`release evidence consistency failed: ${errors.join("; ")}`);
  return {
    ok: true,
    target: TARGET_PROFILE.id,
    connectionId: mcp.connectionId,
    sourceName: mcp.sourceName,
    hermesTotalQuestions: hermesSummary.totalQuestions,
    hermesAccuracy: hermesSummary.accuracy,
    concurrencyDenials: {
      mcpDenialCount: mcpConcurrencyDenialCount,
      observedDenialCount: observedConcurrencyDenialCount,
      usageToolDeniedCount: lucyQueryUsageDeniedCount
    },
    hermesCases: Array.isArray(hermes.cases) ? hermes.cases.map((item) => ({
      id: item?.id,
      trace: item?.trace
    })) : [],
    hermesSourceCoverage,
    timing
  };
}

async function copyEvidence(outDir) {
  const copied = {};
  for (const [key, envName] of REQUIRED_EVIDENCE) {
    const source = evidencePath(envName);
    const target = path.join(outDir, `${key}-evidence.json`);
    await cp(source, target);
    copied[key] = {
      env: envName,
      source,
      file: target,
      sha256: await sha256(target)
    };
  }
  return copied;
}

async function captureObservability(outDir) {
  const target = path.join(outDir, "observability-snapshot.json");
  if (values["skip-observability"]) {
    return { status: "skipped", reason: "skip-observability" };
  }
  const sourceFile = typeof values["observability-file"] === "string" && values["observability-file"].trim()
    ? absolute(values["observability-file"].trim())
    : undefined;
  if (sourceFile) {
    if (!existsSync(sourceFile)) throw new Error(`observability file not found: ${sourceFile}`);
    await cp(sourceFile, target);
    return { status: "copied", source: sourceFile, file: target, sha256: await sha256(target), validation: await validateObservabilitySnapshot(target) };
  }
  const url = typeof values["observability-url"] === "string" && values["observability-url"].trim()
    ? values["observability-url"].trim()
    : process.env.LUCY_R1_OBSERVABILITY_URL;
  if (!url) throw new Error("--observability-url, --observability-file, LUCY_R1_OBSERVABILITY_URL, or --skip-observability is required");
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) throw new Error(`observability snapshot failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  await writeFile(target, text.endsWith("\n") ? text : `${text}\n`, "utf8");
  return { status: "fetched", url, file: target, sha256: await sha256(target), validation: await validateObservabilitySnapshot(target) };
}

async function copyEvalArtifacts(outDir) {
  const artifacts = [];
  const items = Array.isArray(values["eval-artifact"]) ? values["eval-artifact"] : [];
  const dir = path.join(outDir, "eval-artifacts");
  await mkdir(dir, { recursive: true });
  for (const item of items) {
    const source = absolute(item);
    if (!existsSync(source)) throw new Error(`eval artifact not found: ${source}`);
    const target = path.join(dir, path.basename(source));
    await cp(source, target, { recursive: true });
    const textSample = await readArtifactTextSample(target);
    artifacts.push({
      source,
      file: target,
      sha256: await sha256(target),
      identity: inspectEvalArtifactIdentityText(textSample),
      textSample
    });
  }
  return artifacts;
}

async function readArtifactTextSample(file) {
  const info = await stat(file);
  if (info.isDirectory()) {
    let text = "";
    const entries = await readdir(file, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (text.length >= EVAL_ARTIFACT_SCAN_MAX_BYTES) break;
      const child = path.join(file, entry.name);
      if (entry.isDirectory() || entry.isFile()) {
        text += `\n${entry.name}\n`;
        text += await readArtifactTextSample(child);
      }
    }
    return text.slice(0, EVAL_ARTIFACT_SCAN_MAX_BYTES);
  }
  if (!info.isFile()) return "";
  const buffer = await readFile(file);
  return buffer.toString("utf8", 0, Math.min(buffer.length, EVAL_ARTIFACT_SCAN_MAX_BYTES));
}

async function inspectEvalArtifactIdentity(file) {
  return inspectEvalArtifactIdentityText(await readArtifactTextSample(file));
}

function inspectEvalArtifactIdentityText(sample) {
  const text = String(sample ?? "").toLowerCase();
  const markers = Object.fromEntries(
    EVAL_ARTIFACT_IDENTITY_MARKERS.map(([key, marker]) => [key, text.includes(marker)])
  );
  return {
    markers,
    passed: EVAL_ARTIFACT_IDENTITY_MARKERS.every(([key]) => markers[key] === true)
  };
}

function evaluateArtifactCoverage(artifact, requiredCaseIds, requiredTraceIds) {
  const text = (artifact?.textSample ?? "").toLowerCase();
  const missingCaseIds = requiredCaseIds.filter((id) => !text.includes(id.toLowerCase()));
  const missingTraceIds = requiredTraceIds.filter((id) => !text.includes(id.toLowerCase()));
  return {
    totalCaseIds: requiredCaseIds.length,
    totalTraceIds: requiredTraceIds.length,
    missingCaseIds: missingCaseIds.slice(0, EVAL_ARTIFACT_COVERAGE_SAMPLE_LIMIT),
    missingTraceIds: missingTraceIds.slice(0, EVAL_ARTIFACT_COVERAGE_SAMPLE_LIMIT),
    omittedMissingCaseIds: Math.max(0, missingCaseIds.length - EVAL_ARTIFACT_COVERAGE_SAMPLE_LIMIT),
    omittedMissingTraceIds: Math.max(0, missingTraceIds.length - EVAL_ARTIFACT_COVERAGE_SAMPLE_LIMIT),
    passed: missingCaseIds.length === 0 && missingTraceIds.length === 0
  };
}

function validateEvalArtifacts(artifacts, hermesCases = []) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error("at least one --eval-artifact is required for an R1 release bundle");
  }
  if (!artifacts.some((artifact) => artifact?.identity?.passed === true)) {
    throw new Error(`at least one --eval-artifact must contain R1 Hermes/Lucy identity markers: ${TARGET_PROFILE.dataset}, hermes, lucy-mcp-proxy`);
  }
  const requiredCaseIds = hermesCases
    .map((item) => item?.id)
    .filter((id) => typeof id === "string" && id.trim());
  const requiredTraceIds = hermesCases
    .map((item) => item?.trace)
    .filter((id) => typeof id === "string" && id.trim());
  if (requiredCaseIds.length === 0 || requiredTraceIds.length === 0) {
    throw new Error("Hermes evidence must expose case ids and trace ids for eval artifact coverage checks");
  }
  const coveredArtifacts = artifacts.map((artifact) => ({
    ...artifact,
    coverage: evaluateArtifactCoverage(artifact, requiredCaseIds, requiredTraceIds)
  }));
  if (!coveredArtifacts.some((artifact) => artifact.identity?.passed === true && artifact.coverage?.passed === true)) {
    throw new Error("at least one --eval-artifact must cover every Hermes case id and trace id from the R1 report");
  }
  return coveredArtifacts.map(({ textSample, ...artifact }) => artifact);
}

async function main() {
  const outDir = absolute(String(values.out ?? "inbox/lucy-r1-release-bundle"));
  await mkdir(outDir, { recursive: true });

  const env = Object.fromEntries(REQUIRED_EVIDENCE.map(([, envName]) => [envName, evidencePath(envName)]));
  const readiness = runReadinessStrict(env);
  const readinessPath = path.join(outDir, "readiness-strict.json");
  await writeFile(readinessPath, readiness.stdout || readiness.stderr, "utf8");
  if (readiness.status !== 0) {
    const manifest = {
      ok: false,
      generatedAt: new Date().toISOString(),
      target: TARGET_PROFILE.id,
      reason: "strict_readiness_failed",
      readiness: {
        status: readiness.status,
        file: readinessPath
      }
    };
    await writeJson(path.join(outDir, "release-manifest.json"), manifest);
    console.log(JSON.stringify(manifest, null, 2));
    process.exit(1);
  }

  const evidence = await copyEvidence(outDir);
  const observability = await captureObservability(outDir);
  if (observability.status === "skipped") {
    const manifest = {
      ok: false,
      generatedAt: new Date().toISOString(),
      generatedBy: "scripts/lucy-r1-release-bundle.mjs",
      target: TARGET_PROFILE.id,
      reason: "observability_skipped",
      readiness: {
        status: readiness.status,
        file: readinessPath,
        sha256: await sha256(readinessPath)
      },
      evidence,
      observability,
      releaseDecision: "not_ready"
    };
    await writeJson(path.join(outDir, "release-manifest.json"), manifest);
    console.log(JSON.stringify(manifest, null, 2));
    process.exit(1);
  }
  const consistency = await validateEvidenceConsistency(evidence, observability);
  const localConfig = await validateLocalReleaseConfig(evidence);
  const evalArtifacts = await copyEvalArtifacts(outDir);
  const validatedEvalArtifacts = validateEvalArtifacts(evalArtifacts, consistency.hermesCases);
  const manifest = {
    ok: true,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/lucy-r1-release-bundle.mjs",
    target: TARGET_PROFILE.id,
    readiness: {
      status: readiness.status,
      file: readinessPath,
      sha256: await sha256(readinessPath)
    },
    evidence,
    observability,
    consistency,
    localConfig,
    evalArtifacts: validatedEvalArtifacts,
    releaseDecision: "ready_for_human_approval"
  };
  await writeJson(path.join(outDir, "release-manifest.json"), manifest);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch(async (error) => {
  const outDir = absolute(String(values.out ?? "inbox/lucy-r1-release-bundle"));
  await mkdir(outDir, { recursive: true }).catch(() => undefined);
  const manifest = {
    ok: false,
    generatedAt: new Date().toISOString(),
    target: TARGET_PROFILE.id,
    reason: error instanceof Error ? error.message : String(error)
  };
  await writeJson(path.join(outDir, "release-manifest.json"), manifest).catch(() => undefined);
  console.error(`[lucy-r1-release-bundle] FAIL: ${manifest.reason}`);
  process.exit(1);
});
