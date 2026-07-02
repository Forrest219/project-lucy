#!/usr/bin/env node
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "yaml";

const ROOT = process.cwd();
const STRICT = process.argv.includes("--strict");

const R1_TOOLS = [
  "lucy_catalog",
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness",
  "lucy_begin_question"
];

const TABLE_TOUCHING_R1_TOOLS = [
  "lucy_read_source",
  "lucy_query",
  "lucy_explain_query",
  "lucy_freshness"
];
const R1_EXACT_ROLE_ID = "lucy_r1_exact_readonly";

const results = [];

function rel(file) {
  return path.join(ROOT, file);
}

function read(file) {
  return readFileSync(rel(file), "utf8");
}

function add(status, id, message, detail) {
  results.push({ status, id, message, detail });
}

function requireFile(file, id) {
  if (!existsSync(rel(file))) {
    add("fail", id, `${file} is missing`);
    return false;
  }
  add("pass", id, `${file} exists`);
  return true;
}

function includesAll(haystack, needles) {
  return needles.every((needle) => haystack.includes(needle));
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && expected.every((item) => actual.includes(item));
}

function checkDoc() {
  if (!requireFile("docs/lucy-r1-controlled-data-service-plan.md", "doc.exists")) return;
  const doc = read("docs/lucy-r1-controlled-data-service-plan.md");
  for (const phrase of [
    "Doris Vertical Slice",
    "Hermes Agent",
    "MCP Tool Contract",
    "Query Guardrail",
    "并发限制",
    "每道题必须有唯一 Lucy trace",
    "R1 发布门槛"
  ]) {
    add(doc.includes(phrase) ? "pass" : "fail", `doc.${phrase}`, `R1 plan mentions ${phrase}`);
  }

  if (!requireFile("docs/lucy-r1-release-runbook.md", "runbook.exists")) return;
  const runbook = read("docs/lucy-r1-release-runbook.md");
  for (const phrase of [
    "Doris Vertical Slice Evidence",
    "Hermes 95% QA Evidence",
    "npm run r1:local-gates",
    "npm run r1:readiness:strict",
    "exact tool surface",
    "proxyUrl",
    "connectionId",
    "sourceName",
    "checkDetails.toolSurface.expectedTools",
    "missingTools",
    "extraTools",
    "checkDetails.toolSchemas.schemaMissing",
    "checkDetails.toolSchemas.invalidSchemas",
    "checkDetails.toolSchemas.expectedRequired",
    "--forbid-measure",
    "checkDetails.limitCapped.effectiveLimit",
    "checkDetails.concurrencyGuardrail.maxConcurrentQueries",
    "summary.tracedQuestions == summary.totalQuestions",
    "summary.uniqueTraces == summary.totalQuestions",
    "checkDetails.runtimeArgumentValidation.reason",
    "checkDetails.runtimeArgumentValidation.probes",
    "invalid_arguments:*",
    "query_concurrency_exceeded",
    "gates.lucyControlledEvidence == true",
    "checkDetails.lucyMetadata.hasProvenance == true",
    "freshness.status",
    "truncation",
    "gates.evidenceCompleteness == true",
    "gates.noDuplicateCases == true",
    "summary.passedQuestions",
    "summary.failedQuestions",
    "summary.minQuestions >= 30",
    "gates.questionCount == true",
    "dataset == \"r1_doris_benchmark\"",
    "gates.caseDatasetIdentity == true",
    "LUCY_R1_BENCHMARK_CASES",
    "data.releaseSignals.hermesQuestionCountGatePassed == true",
    "data.releaseSignals.hermesAccuracyGatePassed == true",
    "data.releaseSignals.hermesTraceUniquenessGatePassed == true",
    "data.releaseSignals.hermesNoInvalidBenchmarkCasesGatePassed == true",
    "data.releaseSignals.hermesNoDuplicateBenchmarkCasesGatePassed == true",
    "data.releaseSignals.hermesNoDuplicateCasesGatePassed == true",
    "data.releaseSignals.hermesEvidenceCompletenessGatePassed == true",
    "data.releaseSignals.hermesLucyControlledEvidenceGatePassed == true",
    "data.releaseSignals.hermesReportGatePassed == true",
    "coverage.passed == true",
    "/api/r1/observability",
    "回滚清单",
    "summary.accuracy >= 0.95"
  ]) {
    add(runbook.includes(phrase) ? "pass" : "fail", `runbook.${phrase}`, `R1 runbook mentions ${phrase}`);
  }
}

function checkAccessYaml() {
  if (!requireFile("webui/config/access.yaml", "access.exists")) return;
  const config = parse(read("webui/config/access.yaml"));
  const knownTools = config?.defaults?.known_tools ?? [];
  const tableTouchingTools = config?.defaults?.table_touching_tools ?? [];
  add(includesAll(knownTools, R1_TOOLS) ? "pass" : "fail", "access.known_tools", "access.yaml defaults.known_tools includes Lucy R1 tools");
  add(includesAll(tableTouchingTools, TABLE_TOUCHING_R1_TOOLS) ? "pass" : "fail", "access.table_touching_tools", "access.yaml table_touching_tools includes table-scoped Lucy R1 tools");
  const exactRole = config?.roles?.[R1_EXACT_ROLE_ID];
  add(exactRole ? "pass" : "fail", "access.r1_exact_role_exists", `access.yaml includes ${R1_EXACT_ROLE_ID}`);
  add(sameStringSet(exactRole?.allow?.tools, R1_TOOLS) ? "pass" : "fail", "access.r1_exact_role_tools", `${R1_EXACT_ROLE_ID} exposes exactly the 6 Lucy R1 tools`, {
    expected: R1_TOOLS,
    actual: exactRole?.allow?.tools
  });
  add(Array.isArray(exactRole?.allow?.tableSelectors) && exactRole.allow.tableSelectors.length > 0 ? "pass" : "fail", "access.r1_exact_role_sources", `${R1_EXACT_ROLE_ID} has at least one source/table selector`);

  const roles = config?.roles ?? {};
  const tableRoles = Object.entries(roles).filter(([, role]) => Array.isArray(role?.allow?.tableSelectors) && role.allow.tableSelectors.length > 0);
  const missing = tableRoles
    .filter(([, role]) => !includesAll(role?.allow?.tools ?? [], TABLE_TOUCHING_R1_TOOLS))
    .map(([roleId]) => roleId);
  add(missing.length === 0 ? "pass" : "fail", "access.roles", "table-scoped roles include Lucy R1 controlled query tools", missing.length ? { missing } : undefined);
}

function checkProxyContract() {
  if (!requireFile("webui/server/proxy/mcp-proxy.ts", "proxy.exists")) return;
  const proxy = read("webui/server/proxy/mcp-proxy.ts");
  for (const tool of R1_TOOLS) {
    add(proxy.includes(`name: "${tool}"`) ? "pass" : "fail", `proxy.tool.${tool}`, `proxy declares ${tool}`);
  }
  add(proxy.includes("contract: \"lucy-r1-controlled-data-service\"") ? "pass" : "fail", "proxy.result_meta", "lucy_query/lucy_read_source responses include Lucy R1 result metadata");
  add(proxy.includes("rewriteToolCall(parsedRpc, \"sl_query\"") ? "pass" : "fail", "proxy.lucy_query_rewrite", "lucy_query rewrites to sl_query upstream");
  add(proxy.includes("rewriteToolCall(parsedRpc, \"sl_read_source\"") ? "pass" : "fail", "proxy.lucy_read_source_rewrite", "lucy_read_source rewrites to sl_read_source upstream");
  add(proxy.includes("source_timeout") ? "pass" : "fail", "proxy.source_timeout", "proxy classifies upstream semantic call timeouts as source_timeout");
  add(proxy.includes("acquireLucyQuerySlot") && proxy.includes("query_concurrency_exceeded") ? "pass" : "fail", "proxy.query_concurrency_guardrail", "proxy limits concurrent lucy_query calls per token");
  add(proxy.includes("validateLucyToolArgs") && proxy.includes("invalid_arguments:") ? "pass" : "fail", "proxy.lucy_runtime_argument_validation", "proxy validates Lucy R1 tool arguments before forwarding");
  add(proxy.includes("call `lucy_query` or `lucy_read_source`") && !proxy.includes("call `sl_query` or `sl_read_source`") ? "pass" : "fail", "proxy.role_aware_instructions_lucy_tools", "role-aware instructions direct agents to Lucy tools, not upstream semantic tools");

  if (requireFile("webui/config/data-qa-instructions.md", "fallback_instructions.exists")) {
    const fallback = read("webui/config/data-qa-instructions.md");
    add(fallback.includes("`lucy_query` / `lucy_read_source`") && !fallback.includes("`sl_query` / `sl_read_source`") ? "pass" : "fail", "fallback_instructions.lucy_tools", "fallback instructions direct agents to Lucy tools, not upstream semantic tools");
  }

  if (requireFile("webui/docs/09-lucy-r1-mcp-tool-contract.md", "mcp_contract_doc.exists")) {
    const doc = read("webui/docs/09-lucy-r1-mcp-tool-contract.md");
    for (const phrase of [
      "lucy-r1-controlled-data-service",
      "raw_query_forbidden",
      "invalid_arguments:*",
      "table_forbidden:<table>",
      "query_concurrency_exceeded",
      "lucy_begin_question",
      "Contract Eval",
      "toolSchemas",
      "expectedRequired",
      "runtimeArgumentValidation",
      "runtimeArgumentValidation.probes",
      "checkDetails",
      "_meta.lucy"
    ]) {
      add(doc.includes(phrase) ? "pass" : "fail", `mcp_contract_doc.${phrase}`, `MCP contract doc mentions ${phrase}`);
    }
  }
}

function checkAclContract() {
  if (!requireFile("webui/server/proxy/acl.ts", "acl.exists")) return;
  const acl = read("webui/server/proxy/acl.ts");
  for (const tool of TABLE_TOUCHING_R1_TOOLS) {
    add(acl.includes(`"${tool}"`) ? "pass" : "fail", `acl.tool.${tool}`, `ACL knows table-scoped tool ${tool}`);
  }
  add(acl.includes("raw_query_forbidden") && acl.includes("lucy_query") ? "pass" : "fail", "acl.raw_query_guardrail", "ACL applies raw query guardrail to lucy_query");
}

function checkAdminContract() {
  for (const file of [
    "webui/server/admin/role-templates.ts",
    "webui/server/admin/mcp-tools.ts"
  ]) {
    if (!requireFile(file, `${file}.exists`)) continue;
    const text = read(file);
    add(includesAll(text, R1_TOOLS) ? "pass" : "fail", `${file}.tools`, `${file} includes Lucy R1 tool surface`);
  }
  const roleTemplates = read("webui/server/admin/role-templates.ts");
  add(roleTemplates.includes(R1_EXACT_ROLE_ID) ? "pass" : "fail", "role_templates.r1_exact_role", `role templates include ${R1_EXACT_ROLE_ID}`);
  add(roleTemplates.includes("LUCY_R1_EXACT_TOOLS") ? "pass" : "fail", "role_templates.r1_exact_tools_constant", "role templates expose a reusable exact Lucy R1 tool list");
}

function checkTargetSourceModel() {
  for (const file of [
    "webui/server/model.ts",
    "webui/src/lib/types.ts"
  ]) {
    if (!requireFile(file, `${file}.exists`)) continue;
    const text = read(file);
    for (const field of ["engine", "wireProtocol", "r1Target", "readOnlyExpected"]) {
      add(text.includes(field) ? "pass" : "fail", `${file}.${field}`, `${file} exposes ${field} for target-source profiles`);
    }
  }

  if (requireFile("webui/server/project.ts", "project.exists")) {
    const project = read("webui/server/project.ts");
    add(project.includes("engine === \"doris\"") ? "pass" : "fail", "project.doris_engine", "readProject derives Doris as an R1 target engine");
    add(project.includes("return \"mysql\"") && project.includes("engine === \"doris\"") ? "pass" : "fail", "project.doris_wire", "readProject maps Doris to MySQL wire protocol");
  }

  if (requireFile("ktx.yaml.example", "ktx_example.exists")) {
    const example = read("ktx.yaml.example");
    for (const phrase of ["doris-r1", "engine: doris", "wire_protocol: mysql", "readonly: true", "r1_target: true"]) {
      add(example.includes(phrase) ? "pass" : "fail", `ktx_example.${phrase}`, `ktx.yaml.example includes ${phrase}`);
    }
  }
}

function checkEvidenceGenerators() {
  if (requireFile("scripts/lucy-r1-doris-smoke.mjs", "doris_smoke.exists")) {
    const script = read("scripts/lucy-r1-doris-smoke.mjs");
    for (const phrase of [
      "readonly-account-confirmed",
      "timeout-evidence",
      "sourceTimeoutEvidencePass",
      "lucy-r1-controlled-data-service",
      "raw_query_forbidden"
    ]) {
      add(script.includes(phrase) ? "pass" : "fail", `doris_smoke.${phrase}`, `Doris smoke generator handles ${phrase}`);
    }
  }
  if (requireFile("scripts/lucy-r1-doris-smoke.test.mjs", "doris_smoke_test.exists")) {
    const test = read("scripts/lucy-r1-doris-smoke.test.mjs");
    add(test.includes("timeout evidence is not source_timeout") && test.includes("query_timeout") ? "pass" : "fail", "doris_smoke_test.source_timeout_gate", "Doris smoke test rejects timeout evidence not classified as source_timeout");
  }
  if (requireFile("scripts/lucy-r1-hermes-report.mjs", "hermes_report.exists")) {
    const script = read("scripts/lucy-r1-hermes-report.mjs");
    for (const phrase of [
      "coreMetricQuestions",
      "securityQuestions",
      "minQuestions",
      "questionCount",
      "traceCoverage",
      "traceUniqueness",
      "uniqueTraces",
      "evidenceCompleteness",
      "lucyControlledEvidence",
      "lucyControlledQuestions",
      "lucyMetadataQuestions",
      "lucyRejectionQuestions",
      "noInvalidBenchmarkCases",
      "invalidBenchmarkCases",
      "noMissingCases",
      "noDuplicateBenchmarkCases",
      "duplicateBenchmarkCaseIds",
      "noDuplicateCases",
      "duplicateResultCaseIds",
      "r1_doris_benchmark",
      "caseDatasetIdentity",
      "perCaseIdentity",
      "lucy-mcp-proxy"
    ]) {
      add(script.includes(phrase) ? "pass" : "fail", `hermes_report.${phrase}`, `Hermes report generator handles ${phrase}`);
    }
  }
  requireFile("scripts/lucy-r1-hermes-report.test.mjs", "hermes_report_test.exists");
  if (requireFile("scripts/lucy-r1-local-gates.mjs", "local_gates.exists")) {
    const script = read("scripts/lucy-r1-local-gates.mjs");
    for (const phrase of [
      "r1-readiness",
      "spec-lint",
      "security-baseline",
      "r1-mcp-contract-test",
      "r1-doris-smoke-test",
      "r1-hermes-report-test",
      "r1-readiness-test",
      "r1-release-bundle-test",
      "r1-status-test",
      "webui-test",
      "webui-build",
      "--dry-run",
      "--list"
    ]) {
      add(script.includes(phrase) ? "pass" : "fail", `local_gates.${phrase}`, `R1 local gates runner includes ${phrase}`);
    }
  }
  if (requireFile("scripts/lucy-r1-local-gates.test.mjs", "local_gates_test.exists")) {
    const test = read("scripts/lucy-r1-local-gates.test.mjs");
    add(test.includes("R1 local gates list matches the runbook local release gate surface") && test.includes("npm run r1:readiness") ? "pass" : "fail", "local_gates_test.runbook_surface", "R1 local gates test covers runbook local release gate surface");
  }
  if (requireFile("webui/server/__tests__/mcp-proxy-smoke.test.ts", "mcp_proxy_smoke_test.exists")) {
    const test = read("webui/server/__tests__/mcp-proxy-smoke.test.ts");
    add(test.includes("query_concurrency_exceeded") ? "pass" : "fail", "mcp_proxy_smoke.query_concurrency_guardrail", "MCP proxy smoke tests lucy_query concurrency guardrail");
    add(test.includes("columnCount") && test.includes("response_column_count") && test.includes("response_truncated")
      ? "pass" : "fail", "mcp_proxy_smoke.result_size_audit", "MCP proxy smoke tests Lucy result column metadata and audit row/column/truncation fields");
    add(test.includes("provenance")
      && test.includes("filters: [{ field: \"superstore_orders.sales\", op: \">\", value: 100 }]")
      && test.includes("segments: [\"superstore_orders.active_rows\"]")
      && test.includes("orderBy: [{ field: \"superstore_orders.sales\", direction: \"desc\" }]")
      && test.includes("freshness: { status: \"not_checked\", tool: \"lucy_freshness\" }")
      ? "pass" : "fail", "mcp_proxy_smoke.provenance_metadata", "MCP proxy smoke tests Lucy provenance metadata for filters, segments, ordering, and freshness status");
    add(test.includes("invalid_arguments:lucy_query:query_shape_required")
      && test.includes("invalid_arguments:lucy_explain_query:query_shape_required")
      && test.includes("invalid_arguments:lucy_read_source:source_required")
      && test.includes("invalid_arguments:lucy_freshness:source_required")
      && test.includes("upstreamSeen).toHaveLength(0)")
      ? "pass" : "fail", "mcp_proxy_smoke.runtime_argument_validation", "MCP proxy smoke tests fail-closed Lucy R1 argument validation before forwarding or local execution");
    add(test.includes("classifies upstream semantic query timeouts as source_timeout audit events")
      && test.includes("body.error?.data?.reason).toBe(\"source_timeout\")")
      && test.includes("audit.decision_reason).toBe(\"source_timeout\")")
      && test.includes("waitForAuditSources")
      ? "pass" : "fail", "mcp_proxy_smoke.source_timeout_audit", "MCP proxy smoke tests lucy_query upstream timeouts as source_timeout with source attribution");
  }
  if (requireFile("webui/server/__tests__/mcp-proxy-instructions.test.ts", "mcp_proxy_instructions_test.exists")) {
    const test = read("webui/server/__tests__/mcp-proxy-instructions.test.ts");
    add(test.includes("falls back to pass-through (200 + original body) when upstream body is malformed JSON, NOT -32003")
      && test.includes("expect(res.status).toBe(200)")
      && test.includes("expect(text).toBe(malformedBody)")
      && test.includes("decision_reason).toBe(\"instructions_injection_failed\")")
      && test.includes("expect(audit.outcome).toBe(\"ok\")")
      ? "pass" : "fail", "mcp_proxy_instructions.initialize_fail_open", "MCP proxy instructions tests keep initialize handshakes alive when instructions injection fails");
  }
  if (requireFile("scripts/lucy-r1-mcp-contract-smoke.mjs", "mcp_contract_smoke.exists")) {
    const script = read("scripts/lucy-r1-mcp-contract-smoke.mjs");
    for (const phrase of [
      "lucy-r1-controlled-data-service",
      "toolSurface",
      "upstreamSemanticToolsHidden",
      "negativeSamples",
      "forbiddenTableRejected",
      "forbiddenToolRejected",
      "rawSqlRejected",
      "runtimeArgumentValidation",
      "limitCapped",
      "concurrencyGuardrail",
      "query_concurrency_exceeded",
      "readSourceMetadata",
      "lucyMetadata"
    ]) {
      add(script.includes(phrase) ? "pass" : "fail", `mcp_contract_smoke.${phrase}`, `MCP contract smoke handles ${phrase}`);
    }
  }
  requireFile("scripts/lucy-r1-mcp-contract-smoke.test.mjs", "mcp_contract_smoke_test.exists");
  if (requireFile("scripts/lucy-r1-readiness.test.mjs", "readiness_test.exists")) {
    const test = read("scripts/lucy-r1-readiness.test.mjs");
    add(test.includes("missing R1 tools even when marked pass")
      && test.includes("checkDetails.toolSurface.expectedTools must exactly match Lucy R1 tools")
      && test.includes("checkDetails.toolSurface.missingTools must be an empty array")
      ? "pass" : "fail", "readiness_test.mcp_exact_tool_surface_gate", "Readiness test rejects MCP contract evidence with missing R1 tools even if marked pass");
    add(test.includes("without runtime target identifiers")
      && test.includes("proxyUrl must be a non-empty string")
      && test.includes("connectionId must be a non-empty string")
      && test.includes("sourceName must be a non-empty string")
      ? "pass" : "fail", "readiness_test.mcp_runtime_target_identifiers_gate", "Readiness test rejects MCP contract evidence without runtime target identifiers");
    add(test.includes("inconsistent pass and fail counts")
      && test.includes("summary.passedQuestions + summary.failedQuestions must equal summary.totalQuestions")
      && test.includes("summary.accuracy must equal summary.passedQuestions / summary.totalQuestions")
      ? "pass" : "fail", "readiness_test.hermes_summary_count_consistency_gate", "Readiness test rejects Hermes reports with inconsistent pass/fail summary counts");
  }
  if (requireFile("scripts/lucy-r1-release-bundle.mjs", "release_bundle.exists")) {
    const script = read("scripts/lucy-r1-release-bundle.mjs");
    for (const phrase of [
      "readiness-strict.json",
      "release-manifest.json",
      "observability-snapshot.json",
      "validateObservabilitySnapshot",
      "validateAuditSnapshot",
      "validateEvalSnapshot",
      "validateHermesQaSnapshot",
      "validateEvidenceConsistency",
      "validateLocalReleaseConfig",
      "LUCY_R1_RELEASE_CONFIG_ROOT",
      "release local config is not ready for Doris R1",
      "data.eval.latestRun.passRate must be >= 0.95",
      "data.hermesQa.agent must be \"hermes\"",
      "data.hermesQa.target must be \"lucy-mcp-proxy\"",
      "data.hermesQa.generatedBy must be \"scripts/lucy-r1-hermes-report.mjs\"",
      "data.hermesQa.agentIdentityGatePassed must be true",
      "data.hermesQa.targetIdentityGatePassed must be true",
      "data.hermesQa.generatedByGatePassed must be true",
      "data.hermesQa.caseDataset must be \"r1_doris_benchmark\"",
      "data.hermesQa.caseDatasetIdentityGatePassed must be true",
      "data.hermesQa.perCaseIdentityGatePassed must be true",
      "data.hermesQa.traceUniquenessGatePassed must be true",
      "data.hermesQa.noInvalidBenchmarkCasesGatePassed must be true",
      "data.hermesQa.noDuplicateBenchmarkCasesGatePassed must be true",
      "data.hermesQa.noDuplicateCasesGatePassed must be true",
      "data.hermesQa.lucyControlledEvidenceGatePassed must be true",
      "RELEASE_MAX_EVIDENCE_WINDOW_HOURS",
      "release evidence timestamps must be no older than",
      "LUCY_R1_MCP_CONTRACT_EVIDENCE",
      "trafficObservable requires data.audit.traffic.businessCalls > 0",
      "release evidence consistency failed",
      "Hermes traceUniqueness gate mismatch",
      "Hermes cases must reference Doris evidence sourceName",
      "observability sourceErrors must reference Doris evidence connectionId or sourceName",
      "observability usage.tools must include lucy_query",
      "data.audit.denials must include query_concurrency_exceeded",
      "observability query_concurrency_exceeded denial count must be >= MCP concurrency denialCount",
      "observability usage.tools lucy_query denied count must be >= MCP concurrency denialCount",
      "at least one --eval-artifact is required",
      "R1 Hermes/Lucy identity markers",
      "cover every Hermes case id and trace id",
      "EVAL_ARTIFACT_IDENTITY_MARKERS",
      "evaluateArtifactCoverage",
      "hermesQuestionCountGatePassed",
      "hermesReportGatePassed",
      "hermesEvidenceCompletenessGatePassed",
      "hermesLucyControlledEvidenceGatePassed",
      "hermesPerCaseIdentityGatePassed",
      "hermesTraceUniquenessGatePassed",
      "hermesNoDuplicateBenchmarkCasesGatePassed",
      "hermesNoDuplicateCasesGatePassed",
      "Hermes lucyControlledEvidence gate mismatch",
      "observability_skipped"
    ]) {
      add(script.includes(phrase) ? "pass" : "fail", `release_bundle.${phrase}`, `Release bundle handles ${phrase}`);
    }
  }
  if (requireFile("scripts/lucy-r1-release-bundle.test.mjs", "release_bundle_test.exists")) {
    const test = read("scripts/lucy-r1-release-bundle.test.mjs");
    add(test.includes("R1 eval pass rate is below the release gate") && test.includes("passRate: 0.9") ? "pass" : "fail", "release_bundle_test.eval_pass_rate_gate", "Release bundle test rejects observability snapshots below the R1 eval pass-rate gate");
    add(test.includes("requires at least one eval artifact") && test.includes("at least one --eval-artifact is required") ? "pass" : "fail", "release_bundle_test.eval_artifact_required_gate", "Release bundle test requires at least one archived eval artifact");
    add(test.includes("rejects eval artifacts without R1 Hermes and Lucy identity markers") && (test.includes("R1 Hermes/Lucy identity markers") || test.includes("R1 Hermes\\/Lucy identity markers")) ? "pass" : "fail", "release_bundle_test.eval_artifact_identity_gate", "Release bundle test rejects eval artifacts without R1 Hermes/Lucy identity markers");
    add(test.includes("rejects eval artifacts without Hermes case and trace coverage") && test.includes("cover every Hermes case id and trace id") ? "pass" : "fail", "release_bundle_test.eval_artifact_case_trace_coverage_gate", "Release bundle test rejects eval artifacts that do not cover Hermes case ids and trace ids");
    add(test.includes("observability source diagnostics are not tied to Doris evidence") && test.includes("observability sourceErrors must reference Doris evidence connectionId or sourceName") ? "pass" : "fail", "release_bundle_test.doris_observability_consistency_gate", "Release bundle test rejects observability diagnostics not tied to Doris evidence");
    add(test.includes("observability lacks concurrency denial evidence")
      && (test.includes("data.audit.denials must include query_concurrency_exceeded")
        || test.includes("data\\.audit\\.denials must include query_concurrency_exceeded"))
      ? "pass" : "fail", "release_bundle_test.concurrency_denial_observability_gate", "Release bundle test rejects observability snapshots without concurrency denial evidence");
    add(test.includes("observability concurrency denials undercount MCP evidence")
      && test.includes("observability query_concurrency_exceeded denial count must be >= MCP concurrency denialCount")
      ? "pass" : "fail", "release_bundle_test.concurrency_denial_count_consistency_gate", "Release bundle test rejects observability concurrency denial counts below MCP evidence");
    add(test.includes("observability lucy_query usage undercounts MCP concurrency denials")
      && (test.includes("observability usage.tools lucy_query denied count must be >= MCP concurrency denialCount")
        || test.includes("observability usage\\.tools lucy_query denied count must be >= MCP concurrency denialCount"))
      ? "pass" : "fail", "release_bundle_test.concurrency_usage_count_consistency_gate", "Release bundle test rejects lucy_query usage denied counts below MCP evidence");
    add(test.includes("Hermes cases do not reference the Doris evidence source") && test.includes("Hermes cases must reference Doris evidence sourceName") ? "pass" : "fail", "release_bundle_test.hermes_doris_source_consistency_gate", "Release bundle test rejects Hermes reports not tied to the Doris evidence source");
    add(test.includes("observability Hermes agent is not Hermes") && test.includes("data.hermesQa.agent must be \"hermes\"") ? "pass" : "fail", "release_bundle_test.hermes_agent_identity_gate", "Release bundle test rejects observability snapshots not generated by Hermes");
    add(test.includes("observability Hermes target is not Lucy MCP Proxy") && test.includes("data.hermesQa.target must be \"lucy-mcp-proxy\"") ? "pass" : "fail", "release_bundle_test.hermes_target_identity_gate", "Release bundle test rejects observability snapshots not targeting Lucy MCP Proxy");
    add(test.includes("observability Hermes generatedBy is not the R1 report generator") && (test.includes("data.hermesQa.generatedBy must be \"scripts/lucy-r1-hermes-report.mjs\"") || test.includes("data.hermesQa.generatedBy must be \"scripts\\/lucy-r1-hermes-report.mjs\"")) ? "pass" : "fail", "release_bundle_test.hermes_generated_by_gate", "Release bundle test rejects observability snapshots not produced by the R1 Hermes report generator");
    add(test.includes("observability Hermes case dataset is not R1") && test.includes("data.hermesQa.caseDataset must be \"r1_doris_benchmark\"") ? "pass" : "fail", "release_bundle_test.hermes_case_dataset_gate", "Release bundle test rejects observability snapshots from non-R1 case datasets");
    add(test.includes("observability Hermes per-case identity gate fails") && test.includes("data.hermesQa.perCaseIdentityGatePassed must be true") ? "pass" : "fail", "release_bundle_test.hermes_per_case_identity_gate", "Release bundle test rejects observability snapshots without per-case Hermes/Lucy identity");
    add(test.includes("observability Hermes trace uniqueness gate fails") && test.includes("data.hermesQa.traceUniquenessGatePassed must be true") ? "pass" : "fail", "release_bundle_test.hermes_trace_uniqueness_gate", "Release bundle test rejects observability snapshots without unique Hermes traces");
    add(test.includes("observability Hermes invalid benchmark case gate fails") && test.includes("data.hermesQa.noInvalidBenchmarkCasesGatePassed must be true") ? "pass" : "fail", "release_bundle_test.hermes_no_invalid_benchmark_cases_gate", "Release bundle test rejects observability snapshots with invalid Hermes benchmark cases");
    add(test.includes("observability Hermes duplicate benchmark case gate fails") && test.includes("data.hermesQa.noDuplicateBenchmarkCasesGatePassed must be true") ? "pass" : "fail", "release_bundle_test.hermes_no_duplicate_benchmark_cases_gate", "Release bundle test rejects observability snapshots with duplicate Hermes benchmark case ids");
    add(test.includes("observability Hermes duplicate case gate fails") && test.includes("data.hermesQa.noDuplicateCasesGatePassed must be true") ? "pass" : "fail", "release_bundle_test.hermes_no_duplicate_cases_gate", "Release bundle test rejects observability snapshots with duplicate Hermes case results");
    add(test.includes("observability lacks Lucy controlled Hermes evidence") && test.includes("hermesLucyControlledEvidenceGatePassed") ? "pass" : "fail", "release_bundle_test.hermes_lucy_controlled_evidence_gate", "Release bundle test rejects observability snapshots without Lucy controlled Hermes evidence");
    add(test.includes("evidence timestamps are stale") && test.includes("release evidence timestamps must be no older than 24h") ? "pass" : "fail", "release_bundle_test.evidence_timestamp_gate", "Release bundle test rejects stale R1 evidence timestamps");
  }
  if (requireFile("package.json", "package_json.exists")) {
    const pkg = JSON.parse(read("package.json"));
    const scripts = pkg?.scripts ?? {};
    add(scripts["r1:doris-smoke"] === "node scripts/lucy-r1-doris-smoke.mjs" ? "pass" : "fail", "package.r1_doris_smoke", "package.json exposes r1:doris-smoke");
    add(scripts["r1:doris-smoke:test"] === "node --test scripts/lucy-r1-doris-smoke.test.mjs" ? "pass" : "fail", "package.r1_doris_smoke_test", "package.json exposes r1:doris-smoke:test");
    add(scripts["r1:hermes-report"] === "node scripts/lucy-r1-hermes-report.mjs" ? "pass" : "fail", "package.r1_hermes_report", "package.json exposes r1:hermes-report");
    add(scripts["r1:hermes-report:test"] === "node --test scripts/lucy-r1-hermes-report.test.mjs" ? "pass" : "fail", "package.r1_hermes_report_test", "package.json exposes r1:hermes-report:test");
    add(scripts["r1:local-gates"] === "node scripts/lucy-r1-local-gates.mjs" ? "pass" : "fail", "package.r1_local_gates", "package.json exposes r1:local-gates");
    add(scripts["r1:local-gates:test"] === "node --test scripts/lucy-r1-local-gates.test.mjs" ? "pass" : "fail", "package.r1_local_gates_test", "package.json exposes r1:local-gates:test");
    add(scripts["r1:mcp-contract"] === "node scripts/lucy-r1-mcp-contract-smoke.mjs" ? "pass" : "fail", "package.r1_mcp_contract", "package.json exposes r1:mcp-contract");
    add(scripts["r1:mcp-contract:test"] === "node --test scripts/lucy-r1-mcp-contract-smoke.test.mjs" ? "pass" : "fail", "package.r1_mcp_contract_test", "package.json exposes r1:mcp-contract:test");
    add(scripts["r1:release-bundle"] === "node scripts/lucy-r1-release-bundle.mjs" ? "pass" : "fail", "package.r1_release_bundle", "package.json exposes r1:release-bundle");
    add(scripts["r1:release-bundle:test"] === "node --test scripts/lucy-r1-release-bundle.test.mjs" ? "pass" : "fail", "package.r1_release_bundle_test", "package.json exposes r1:release-bundle:test");
    add(scripts["r1:status"] === "node scripts/lucy-r1-status.mjs" ? "pass" : "fail", "package.r1_status", "package.json exposes r1:status");
    add(scripts["r1:status:test"] === "node --test scripts/lucy-r1-status.test.mjs" ? "pass" : "fail", "package.r1_status_test", "package.json exposes r1:status:test");
  }
}

function checkObservabilityContract() {
  if (requireFile("webui/server/observability.ts", "observability.exists")) {
    const observability = read("webui/server/observability.ts");
    for (const phrase of [
      "/api/r1/observability",
      "readR1AuditObservability",
      "businessCalls > 0",
      "R1_EVAL_PASS_RATE_THRESHOLD",
      "hermesQuestionCountGatePassed",
      "hermesAccuracyGatePassed",
      "hermesCoreMetricGatePassed",
      "hermesSecurityGatePassed",
      "hermesTraceCoverageGatePassed",
      "hermesTraceUniquenessGatePassed",
      "hermesNoInvalidBenchmarkCasesGatePassed",
      "hermesNoDuplicateBenchmarkCasesGatePassed",
      "hermesNoDuplicateCasesGatePassed",
      "hermesEvidenceCompletenessGatePassed",
      "hermesLucyControlledEvidenceGatePassed",
      "caseDatasetIdentityGatePassed",
      "perCaseIdentityGatePassed",
      "hermesPerCaseIdentityGatePassed",
      "hermesReportGatePassed",
      "latestRun",
      "releaseSignals"
    ]) {
      add(observability.includes(phrase) ? "pass" : "fail", `observability.${phrase}`, `R1 observability route includes ${phrase}`);
    }
  }
  if (requireFile("webui/server/proxy/audit.ts", "audit.exists")) {
    const audit = read("webui/server/proxy/audit.ts");
    for (const phrase of ["deniedRate", "p95Ms", "sourceErrors", "slowQueries", "tokens", "response_column_count", "response_truncated"]) {
      add(audit.includes(phrase) ? "pass" : "fail", `audit_observability.${phrase}`, `audit observability exposes ${phrase}`);
    }
  }
  if (requireFile("webui/server/__tests__/r1-observability.test.ts", "r1_observability_test.exists")) {
    const test = read("webui/server/__tests__/r1-observability.test.ts");
    add(test.includes("query_concurrency_exceeded") ? "pass" : "fail", "r1_observability_test.query_concurrency_denial", "R1 observability test proves concurrency guardrail denials are visible");
    add(test.includes("protocol-only MCP traffic") && test.includes("trafficObservable).toBe(false)") ? "pass" : "fail", "r1_observability_test.protocol_only_not_business_traffic", "R1 observability test keeps protocol-only traffic out of business traffic release signal");
    add(test.includes("latest R1 eval misses the pass-rate gate") && test.includes("evalObservable).toBe(false)") ? "pass" : "fail", "r1_observability_test.eval_pass_rate_gate", "R1 observability test keeps low-pass-rate evals out of the release signal");
    add(test.includes("caseDatasetIdentityGatePassed") && test.includes("inputs.caseDataset must be") ? "pass" : "fail", "r1_observability_test.case_dataset_gate", "R1 observability test keeps non-R1 Hermes case datasets out of the release signal");
    add(test.includes("noInvalidBenchmarkCasesGatePassed") && test.includes("gates.noInvalidBenchmarkCases must be true") ? "pass" : "fail", "r1_observability_test.no_invalid_benchmark_cases_gate", "R1 observability test keeps invalid Hermes benchmark cases out of the release signal");
    add(test.includes("noDuplicateBenchmarkCasesGatePassed") && test.includes("gates.noDuplicateBenchmarkCases must be true") ? "pass" : "fail", "r1_observability_test.no_duplicate_benchmark_cases_gate", "R1 observability test keeps duplicate Hermes benchmark case ids out of the release signal");
    add(test.includes("noDuplicateCasesGatePassed") && test.includes("gates.noDuplicateCases must be true") ? "pass" : "fail", "r1_observability_test.no_duplicate_cases_gate", "R1 observability test keeps duplicate Hermes case results out of the release signal");
    add(test.includes("Lucy controlled evidence is missing") && test.includes("hermesLucyControlledEvidenceGatePassed: false") ? "pass" : "fail", "r1_observability_test.lucy_controlled_evidence_gate", "R1 observability test keeps Hermes reports without Lucy controlled evidence out of the release signal");
  }
  if (requireFile("webui/server/admin/audit.ts", "admin_audit.exists")) {
    const adminAudit = read("webui/server/admin/audit.ts");
    const routeChecks = [
      ["/api/admin/audit/export", "audit export API exists"],
      ["/api/admin/audit/turns", "question-level turn list API exists"],
      ["/api/admin/audit/turns/:turnId", "question-level trace detail API exists"],
      ["/api/admin/audit/:id/sources", "per-log source detail API exists"],
      ["redactSensitive", "audit export/detail redacts sensitive values"]
    ];
    for (const [phrase, message] of routeChecks) {
      add(adminAudit.includes(phrase) ? "pass" : "fail", `admin_audit.${phrase}`, message);
    }
  }
  if (requireFile("webui/docs/03-api-spec.md", "api_spec.exists")) {
    const apiSpec = read("webui/docs/03-api-spec.md");
    add(apiSpec.includes("GET    /api/r1/observability")
      && apiSpec.includes("Hermes QA accuracy")
      && apiSpec.includes('"agent": "hermes"')
      && apiSpec.includes('"target": "lucy-mcp-proxy"')
      && apiSpec.includes('"generatedBy": "scripts/lucy-r1-hermes-report.mjs"')
      && apiSpec.includes('"caseDataset": "r1_doris_benchmark"')
      ? "pass" : "fail", "api_spec.r1_observability", "API spec documents R1 observability endpoint and Hermes QA signal");
    for (const phrase of [
      "GET /api/admin/audit/export",
      "GET /api/admin/audit/turns",
      "GET /api/admin/audit/turns/:turnId",
      "GET /api/admin/audit/:id/sources"
    ]) {
      add(apiSpec.includes(phrase) ? "pass" : "fail", `api_spec.${phrase}`, `API spec documents ${phrase}`);
    }
  }
}

function evidenceFileFromEnv(envName) {
  const value = process.env[envName];
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : rel(value);
}

function normalizeAccuracy(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value > 1 ? value / 100 : value;
}

function findAccuracy(value) {
  if (!value || typeof value !== "object") return undefined;
  for (const key of ["accuracy", "qaAccuracy", "qa_accuracy", "overallAccuracy", "overall_accuracy", "accuracyPercent", "accuracy_percent"]) {
    const accuracy = normalizeAccuracy(value[key]);
    if (accuracy !== undefined) return accuracy;
  }
  for (const key of ["overall", "summary", "metrics", "result", "results"]) {
    const accuracy = findAccuracy(value[key]);
    if (accuracy !== undefined) return accuracy;
  }
  return undefined;
}

function parseHermesAccuracy(text) {
  try {
    return findAccuracy(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function parseJsonEvidence(filePath) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return { ok: false, errors: [`invalid_json:${error instanceof Error ? error.message : String(error)}`] };
  }
}

function valueAt(value, pathParts) {
  let current = value;
  for (const part of pathParts) {
    if (!current || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

function checkPass(value, pathExpression, errors) {
  const actual = valueAt(value, pathExpression.split("."));
  if (actual !== "pass") errors.push(`${pathExpression} must be "pass"`);
}

function requireNonEmptyArray(value, pathExpression, errors) {
  const actual = valueAt(value, pathExpression.split("."));
  if (!Array.isArray(actual) || actual.length === 0) errors.push(`${pathExpression} must be a non-empty array`);
}

function requireEmptyArray(value, pathExpression, errors) {
  const actual = valueAt(value, pathExpression.split("."));
  if (!Array.isArray(actual) || actual.length !== 0) errors.push(`${pathExpression} must be an empty array`);
}

function requireFiniteNumber(value, pathExpression, errors) {
  const actual = valueAt(value, pathExpression.split("."));
  if (typeof actual !== "number" || !Number.isFinite(actual)) errors.push(`${pathExpression} must be a finite number`);
  return actual;
}

function requireNonEmptyString(value, pathExpression, errors) {
  const actual = valueAt(value, pathExpression.split("."));
  if (typeof actual !== "string" || !actual.trim()) errors.push(`${pathExpression} must be a non-empty string`);
  return actual;
}

function requireIsoTimestamp(value, pathExpression, errors) {
  const actual = requireNonEmptyString(value, pathExpression, errors);
  if (typeof actual === "string" && Number.isNaN(Date.parse(actual))) {
    errors.push(`${pathExpression} must be a valid ISO timestamp`);
  }
  return actual;
}

function validateDorisEvidence(filePath) {
  const parsed = parseJsonEvidence(filePath);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const value = parsed.value;
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["evidence root must be an object"] };
  }
  if (typeof value.connectionId !== "string" || !value.connectionId.trim()) errors.push("connectionId is required");
  if (typeof value.sourceName !== "string" || !value.sourceName.trim()) errors.push("sourceName is required");
  if (typeof value.measure !== "string" || !value.measure.trim()) errors.push("measure is required");
  requireIsoTimestamp(value, "checkedAt", errors);
  if (value.engine !== "doris") errors.push('engine must be "doris"');
  if (value.wireProtocol !== "mysql") errors.push('wireProtocol must be "mysql"');
  if (value.readonlyAccount !== true) errors.push("readonlyAccount must be true");
  if (value.generatedBy !== "scripts/lucy-r1-doris-smoke.mjs") errors.push('generatedBy must be "scripts/lucy-r1-doris-smoke.mjs"');
  for (const check of [
    "checks.connection",
    "checks.readonlySelect",
    "checks.ddlDmlRejected",
    "checks.limitPagination",
    "checks.typeMapping",
    "checks.timeoutClassification",
    "checks.errorTaxonomy",
    "checks.lucyMetadata"
  ]) {
    checkPass(value, check, errors);
  }
  for (const check of [
    "connection",
    "readonlySelect",
    "ddlDmlRejected",
    "limitPagination",
    "typeMapping",
    "timeoutClassification",
    "errorTaxonomy",
    "lucyMetadata"
  ]) {
    checkPass(value, `checkDetails.${check}.status`, errors);
  }
  const rowCount = requireFiniteNumber(value, "checkDetails.readonlySelect.rowCount", errors);
  const requestedLimit = requireFiniteNumber(value, "checkDetails.limitPagination.requestedLimit", errors);
  const limitedRowCount = requireFiniteNumber(value, "checkDetails.limitPagination.rowCount", errors);
  if (typeof rowCount === "number" && rowCount < 0) errors.push("checkDetails.readonlySelect.rowCount must be non-negative");
  if (typeof limitedRowCount === "number" && limitedRowCount < 0) errors.push("checkDetails.limitPagination.rowCount must be non-negative");
  if (typeof requestedLimit === "number" && typeof limitedRowCount === "number" && limitedRowCount > requestedLimit) {
    errors.push("checkDetails.limitPagination.rowCount must be <= requestedLimit");
  }
  const ddlReason = valueAt(value, ["checkDetails", "ddlDmlRejected", "reason"]);
  if (typeof ddlReason !== "string" || !/(raw_query_forbidden|ddl_dml_forbidden|read_only_violation|table_forbidden:)/.test(ddlReason)) {
    errors.push("checkDetails.ddlDmlRejected.reason must be a read-only guardrail reason");
  }
  const timeoutClassification = valueAt(value, ["checkDetails", "timeoutClassification", "classification"])
    ?? valueAt(value, ["checkDetails", "timeoutClassification", "evidence", "classification"])
    ?? valueAt(value, ["checkDetails", "timeoutClassification", "reason"])
    ?? valueAt(value, ["checkDetails", "timeoutClassification", "evidence", "reason"]);
  if (timeoutClassification !== "source_timeout") {
    errors.push('checkDetails.timeoutClassification must classify Doris timeouts as "source_timeout"');
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasLucyMeta"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasLucyMeta must be true");
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "contract"]) !== "lucy-r1-controlled-data-service") {
    errors.push('checkDetails.lucyMetadata.contract must be "lucy-r1-controlled-data-service"');
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasLucyR1Contract"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasLucyR1Contract must be true");
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasResultSummary"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasResultSummary must be true");
  }
  for (const field of [
    "hasProvenance",
    "hasConnectionId",
    "hasSourceName",
    "hasMeasures",
    "hasDimensions",
    "hasFilters",
    "hasSegments",
    "hasOrderBy",
    "hasFreshnessStatus",
    "hasFreshnessTool",
    "hasTruncation"
  ]) {
    if (valueAt(value, ["checkDetails", "lucyMetadata", field]) !== true) {
      errors.push(`checkDetails.lucyMetadata.${field} must be true`);
    }
  }
  requireNonEmptyString(value, "artifacts.timeoutEvidence", errors);
  const p95 = valueAt(value, ["performance", "p95Ms"]);
  if (p95 !== undefined && (typeof p95 !== "number" || !Number.isFinite(p95) || p95 < 0)) {
    errors.push("performance.p95Ms must be a non-negative number when present");
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      connectionId: value.connectionId,
      sourceName: value.sourceName,
      measure: value.measure,
      engine: value.engine,
      wireProtocol: value.wireProtocol,
      readonlyAccount: value.readonlyAccount,
      p95Ms: p95
    }
  };
}

function validateHermesEvidence(filePath) {
  const text = readFileSync(filePath, "utf8");
  const parsed = parseJsonEvidence(filePath);
  if (!parsed.ok) {
    const accuracy = parseHermesAccuracy(text);
    return {
      ok: false,
      errors: parsed.errors,
      summary: { accuracy }
    };
  }
  const value = parsed.value;
  const errors = [];
  const accuracy = findAccuracy(value);
  const coreMetricAccuracy = normalizeAccuracy(valueAt(value, ["summary", "coreMetricAccuracy"]) ?? valueAt(value, ["summary", "core_metric_accuracy"]));
  const securityPassRate = normalizeAccuracy(valueAt(value, ["summary", "securityPassRate"]) ?? valueAt(value, ["summary", "security_pass_rate"]));
  const totalQuestions = valueAt(value, ["summary", "totalQuestions"]) ?? valueAt(value, ["summary", "total_questions"]);
  const passedQuestions = valueAt(value, ["summary", "passedQuestions"]) ?? valueAt(value, ["summary", "passed_questions"]);
  const failedQuestions = valueAt(value, ["summary", "failedQuestions"]) ?? valueAt(value, ["summary", "failed_questions"]);
  const tracedQuestions = valueAt(value, ["summary", "tracedQuestions"]) ?? valueAt(value, ["summary", "traced_questions"]);
  const uniqueTraces = valueAt(value, ["summary", "uniqueTraces"]) ?? valueAt(value, ["summary", "unique_traces"]);
  const minQuestions = valueAt(value, ["summary", "minQuestions"]) ?? valueAt(value, ["summary", "min_questions"]);
  const coreMetricQuestions = valueAt(value, ["summary", "coreMetricQuestions"]) ?? valueAt(value, ["summary", "core_metric_questions"]);
  const securityQuestions = valueAt(value, ["summary", "securityQuestions"]) ?? valueAt(value, ["summary", "security_questions"]);
  const evidencedQuestions = valueAt(value, ["summary", "evidencedQuestions"]);
  const lucyControlledQuestions = valueAt(value, ["summary", "lucyControlledQuestions"]);
  const lucyMetadataQuestions = valueAt(value, ["summary", "lucyMetadataQuestions"]);
  const lucyRejectionQuestions = valueAt(value, ["summary", "lucyRejectionQuestions"]);
  if (value.agent !== "hermes") errors.push('agent must be "hermes"');
  if (value.target !== "lucy-mcp-proxy") errors.push('target must be "lucy-mcp-proxy"');
  if (value.dataset !== "r1_doris_benchmark") errors.push('dataset must be "r1_doris_benchmark"');
  if (value.generatedBy !== "scripts/lucy-r1-hermes-report.mjs") errors.push('generatedBy must be "scripts/lucy-r1-hermes-report.mjs"');
  requireIsoTimestamp(value, "checkedAt", errors);
  if (accuracy === undefined || accuracy < 0.95) errors.push("summary.accuracy must be >= 0.95");
  if (coreMetricAccuracy !== 1) errors.push("summary.coreMetricAccuracy must be 1.0");
  if (securityPassRate !== 1) errors.push("summary.securityPassRate must be 1.0");
  if (typeof totalQuestions !== "number" || !Number.isFinite(totalQuestions) || totalQuestions <= 0) {
    errors.push("summary.totalQuestions must be a positive number");
  }
  if (typeof passedQuestions !== "number" || !Number.isFinite(passedQuestions) || passedQuestions < 0) {
    errors.push("summary.passedQuestions must be a non-negative number");
  }
  if (typeof failedQuestions !== "number" || !Number.isFinite(failedQuestions) || failedQuestions < 0) {
    errors.push("summary.failedQuestions must be a non-negative number");
  }
  if (
    typeof totalQuestions === "number"
    && Number.isFinite(totalQuestions)
    && typeof passedQuestions === "number"
    && Number.isFinite(passedQuestions)
    && typeof failedQuestions === "number"
    && Number.isFinite(failedQuestions)
    && passedQuestions + failedQuestions !== totalQuestions
  ) {
    errors.push("summary.passedQuestions + summary.failedQuestions must equal summary.totalQuestions");
  }
  if (
    typeof totalQuestions === "number"
    && Number.isFinite(totalQuestions)
    && totalQuestions > 0
    && typeof passedQuestions === "number"
    && Number.isFinite(passedQuestions)
    && accuracy !== undefined
    && Math.abs((passedQuestions / totalQuestions) - accuracy) > 1e-9
  ) {
    errors.push("summary.accuracy must equal summary.passedQuestions / summary.totalQuestions");
  }
  if (typeof minQuestions !== "number" || !Number.isFinite(minQuestions) || minQuestions < 30) {
    errors.push("summary.minQuestions must be >= 30");
  }
  if (typeof totalQuestions === "number" && Number.isFinite(totalQuestions) && typeof minQuestions === "number" && Number.isFinite(minQuestions) && totalQuestions < minQuestions) {
    errors.push("summary.totalQuestions must be >= summary.minQuestions");
  }
  if (typeof coreMetricQuestions !== "number" || !Number.isFinite(coreMetricQuestions) || coreMetricQuestions <= 0) {
    errors.push("summary.coreMetricQuestions must be a positive number");
  }
  if (typeof securityQuestions !== "number" || !Number.isFinite(securityQuestions) || securityQuestions <= 0) {
    errors.push("summary.securityQuestions must be a positive number");
  }
  if (typeof tracedQuestions !== "number" || !Number.isFinite(tracedQuestions) || tracedQuestions !== totalQuestions) {
    errors.push("summary.tracedQuestions must equal summary.totalQuestions");
  }
  if (typeof uniqueTraces !== "number" || !Number.isFinite(uniqueTraces) || uniqueTraces !== totalQuestions) {
    errors.push("summary.uniqueTraces must equal summary.totalQuestions");
  }
  for (const gate of ["agentIdentity", "targetIdentity", "datasetIdentity", "caseDatasetIdentity", "perCaseIdentity", "questionCount", "accuracy", "coreMetricAccuracy", "securityPassRate", "traceCoverage", "traceUniqueness", "evidenceCompleteness", "lucyControlledEvidence", "noInvalidBenchmarkCases", "noInvalidResults", "noUnknownCases", "noDuplicateBenchmarkCases", "noDuplicateCases", "noMissingCases"]) {
    if (valueAt(value, ["gates", gate]) !== true) errors.push(`gates.${gate} must be true`);
  }
  const invalidBenchmarkCases = value.invalidBenchmarkCases;
  if (!Array.isArray(invalidBenchmarkCases)) {
    errors.push("invalidBenchmarkCases must be an array");
  } else if (invalidBenchmarkCases.length > 0) {
    errors.push(`invalidBenchmarkCases must be empty: ${invalidBenchmarkCases.map((item) => item?.index ?? "<unknown>").join(",")}`);
  }
  const duplicateBenchmarkCaseIds = value.duplicateBenchmarkCaseIds;
  if (!Array.isArray(duplicateBenchmarkCaseIds)) {
    errors.push("duplicateBenchmarkCaseIds must be an array");
  } else if (duplicateBenchmarkCaseIds.length > 0) {
    errors.push(`duplicateBenchmarkCaseIds must be empty: ${duplicateBenchmarkCaseIds.join(",")}`);
  }
  const duplicateResultCaseIds = value.duplicateResultCaseIds;
  if (!Array.isArray(duplicateResultCaseIds)) {
    errors.push("duplicateResultCaseIds must be an array");
  } else if (duplicateResultCaseIds.length > 0) {
    errors.push(`duplicateResultCaseIds must be empty: ${duplicateResultCaseIds.join(",")}`);
  }
  requireNonEmptyString(value, "inputs.cases", errors);
  requireNonEmptyString(value, "inputs.results", errors);
  const caseDataset = requireNonEmptyString(value, "inputs.caseDataset", errors);
  if (caseDataset !== "r1_doris_benchmark") errors.push('inputs.caseDataset must be "r1_doris_benchmark"');
  if (!evidencedQuestions || typeof evidencedQuestions !== "object" || Array.isArray(evidencedQuestions)) {
    errors.push("summary.evidencedQuestions must be an object");
  } else if (typeof totalQuestions === "number" && Number.isFinite(totalQuestions)) {
    for (const field of ["question", "hermesAnswer", "expectedAnswer", "source", "query", "judgement"]) {
      if (evidencedQuestions[field] !== totalQuestions) {
        errors.push(`summary.evidencedQuestions.${field} must equal summary.totalQuestions`);
      }
    }
  }
  if (typeof lucyControlledQuestions !== "number" || !Number.isFinite(lucyControlledQuestions) || lucyControlledQuestions !== totalQuestions) {
    errors.push("summary.lucyControlledQuestions must equal summary.totalQuestions");
  }
  if (typeof lucyMetadataQuestions !== "number" || !Number.isFinite(lucyMetadataQuestions) || lucyMetadataQuestions <= 0) {
    errors.push("summary.lucyMetadataQuestions must be a positive number");
  }
  if (typeof lucyRejectionQuestions !== "number" || !Number.isFinite(lucyRejectionQuestions) || lucyRejectionQuestions < 0) {
    errors.push("summary.lucyRejectionQuestions must be a non-negative number");
  }
  if (!Array.isArray(value.cases) || value.cases.length !== totalQuestions) {
    errors.push("cases must be an array matching summary.totalQuestions");
  } else {
    const missingTrace = value.cases.filter((item) => !item || typeof item.trace !== "string" || !item.trace.trim()).map((item) => item?.id ?? "<unknown>");
    if (missingTrace.length > 0) errors.push(`cases must include trace for every question: ${missingTrace.join(",")}`);
    const traceCounts = new Map();
    const caseIdCounts = new Map();
    for (const item of value.cases) {
      const trace = typeof item?.trace === "string" ? item.trace.trim() : "";
      if (trace) traceCounts.set(trace, (traceCounts.get(trace) ?? 0) + 1);
      const id = typeof item?.id === "string" ? item.id.trim() : "";
      if (id) caseIdCounts.set(id, (caseIdCounts.get(id) ?? 0) + 1);
    }
    const duplicateTraces = [...traceCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([trace]) => trace);
    if (duplicateTraces.length > 0) errors.push(`cases must include unique trace for every question: ${duplicateTraces.join(",")}`);
    const duplicateCaseIds = [...caseIdCounts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id);
    if (duplicateCaseIds.length > 0) errors.push(`cases must include each benchmark case once: ${duplicateCaseIds.join(",")}`);
    const wrongCaseAgent = value.cases
      .filter((item) => item?.agent !== "hermes")
      .map((item) => item?.id ?? "<unknown>");
    if (wrongCaseAgent.length > 0) errors.push(`cases must include agent=hermes for every question: ${wrongCaseAgent.join(",")}`);
    const wrongCaseTarget = value.cases
      .filter((item) => item?.target !== "lucy-mcp-proxy")
      .map((item) => item?.id ?? "<unknown>");
    if (wrongCaseTarget.length > 0) errors.push(`cases must include target=lucy-mcp-proxy for every question: ${wrongCaseTarget.join(",")}`);
    const missingLucyEvidence = value.cases
      .filter((item) => item?.lucyControlledEvidence !== true)
      .map((item) => item?.id ?? "<unknown>");
    if (missingLucyEvidence.length > 0) errors.push(`cases must include Lucy controlled evidence for every question: ${missingLucyEvidence.join(",")}`);
    for (const field of ["question", "hermesAnswer", "expectedAnswer", "source", "query", "judgement"]) {
      const missing = value.cases
        .filter((item) => {
          const itemValue = item?.[field];
          if (typeof itemValue === "string") return !itemValue.trim();
          if (Array.isArray(itemValue)) return itemValue.length === 0;
          if (itemValue && typeof itemValue === "object") return Object.keys(itemValue).length === 0;
          return itemValue === undefined || itemValue === null;
        })
        .map((item) => item?.id ?? "<unknown>");
      if (missing.length > 0) errors.push(`cases must include ${field} for every question: ${missing.join(",")}`);
    }
    const missingLucyMetaShape = value.cases
      .filter((item) => item?.security !== true)
      .filter((item) => {
        const summary = item?.lucyMetaSummary;
        return !(summary?.hasLucyMeta
          && summary?.hasLucyR1Contract
          && summary?.hasResultSummary
          && summary?.hasProvenance
          && summary?.hasConnectionId
          && summary?.hasSourceName
          && summary?.hasMeasures
          && summary?.hasDimensions
          && summary?.hasFilters
          && summary?.hasSegments
          && summary?.hasOrderBy
          && summary?.hasFreshnessStatus
          && summary?.hasFreshnessTool
          && summary?.hasTruncation);
      })
      .map((item) => item?.id ?? "<unknown>");
    if (missingLucyMetaShape.length > 0) {
      errors.push(`non-security cases must include Lucy R1 metadata/provenance summary: ${missingLucyMetaShape.join(",")}`);
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      accuracy,
      coreMetricAccuracy,
      securityPassRate,
      totalQuestions,
      passedQuestions,
      failedQuestions,
      tracedQuestions,
      uniqueTraces,
      minQuestions,
      coreMetricQuestions,
      securityQuestions
    }
  };
}

function validateMcpContractEvidence(filePath) {
  const parsed = parseJsonEvidence(filePath);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  const value = parsed.value;
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, errors: ["evidence root must be an object"] };
  }
  if (value.contract !== "lucy-r1-controlled-data-service") errors.push('contract must be "lucy-r1-controlled-data-service"');
  if (value.target !== "lucy-mcp-proxy") errors.push('target must be "lucy-mcp-proxy"');
  if (value.generatedBy !== "scripts/lucy-r1-mcp-contract-smoke.mjs") errors.push('generatedBy must be "scripts/lucy-r1-mcp-contract-smoke.mjs"');
  requireNonEmptyString(value, "proxyUrl", errors);
  requireNonEmptyString(value, "connectionId", errors);
  requireNonEmptyString(value, "sourceName", errors);
  requireIsoTimestamp(value, "checkedAt", errors);
  for (const check of [
    "checks.initialize",
    "checks.toolSurface",
    "checks.upstreamSemanticToolsHidden",
    "checks.toolSchemas",
    "checks.negativeSamples",
    "checks.deniedToolsHidden",
    "checks.forbiddenToolRejected",
    "checks.catalog",
    "checks.forbiddenTableRejected",
    "checks.explainQuery",
    "checks.concurrencyGuardrail",
    "checks.freshness",
    "checks.beginQuestion",
    "checks.rawSqlRejected",
    "checks.runtimeArgumentValidation",
    "checks.limitCapped",
    "checks.readSourceMetadata",
    "checks.lucyMetadata"
  ]) {
    checkPass(value, check, errors);
  }
  const expectedTools = valueAt(value, ["checkDetails", "toolSurface", "expectedTools"]);
  if (!sameStringSet(expectedTools, R1_TOOLS)) {
    errors.push("checkDetails.toolSurface.expectedTools must exactly match Lucy R1 tools");
  }
  requireEmptyArray(value, "checkDetails.toolSurface.missingTools", errors);
  requireEmptyArray(value, "checkDetails.toolSurface.extraTools", errors);
  requireNonEmptyArray(value, "checkDetails.negativeSamples.forbiddenTools", errors);
  requireNonEmptyArray(value, "checkDetails.negativeSamples.forbiddenSources", errors);
  requireNonEmptyArray(value, "checkDetails.negativeSamples.forbiddenMeasures", errors);
  requireEmptyArray(value, "checkDetails.toolSchemas.schemaMissing", errors);
  requireEmptyArray(value, "checkDetails.toolSchemas.invalidSchemas", errors);
  const expectedSchemaRequirements = valueAt(value, ["checkDetails", "toolSchemas", "expectedRequired"]);
  if (!expectedSchemaRequirements || typeof expectedSchemaRequirements !== "object" || Array.isArray(expectedSchemaRequirements)) {
    errors.push("checkDetails.toolSchemas.expectedRequired must be an object");
  } else {
    for (const tool of R1_TOOLS) {
      if (!Array.isArray(expectedSchemaRequirements[tool])) {
        errors.push(`checkDetails.toolSchemas.expectedRequired.${tool} must be an array`);
      }
    }
  }
  requireEmptyArray(value, "checkDetails.upstreamSemanticToolsHidden.exposedUpstreamSemanticTools", errors);
  requireEmptyArray(value, "checkDetails.deniedToolsHidden.exposedForbiddenTools", errors);
  requireEmptyArray(value, "checkDetails.catalog.leakedSources", errors);
  const forbiddenToolReason = valueAt(value, ["checkDetails", "forbiddenToolRejected", "reason"]);
  if (typeof forbiddenToolReason !== "string" || !/^(tool_forbidden|tool_forbidden_global)$/.test(forbiddenToolReason)) {
    errors.push("checkDetails.forbiddenToolRejected.reason must be tool_forbidden or tool_forbidden_global");
  }

  const forbiddenReason = valueAt(value, ["checkDetails", "forbiddenTableRejected", "reason"]);
  if (typeof forbiddenReason !== "string" || !/(table_forbidden:|unknown_or_forbidden_connection:|tool_forbidden)/.test(forbiddenReason)) {
    errors.push("checkDetails.forbiddenTableRejected.reason must be a policy denial reason");
  }
  const rawSqlReason = valueAt(value, ["checkDetails", "rawSqlRejected", "reason"]);
  if (typeof rawSqlReason !== "string" || !/^(raw_query_forbidden|ddl_dml_forbidden|read_only_violation|table_forbidden:)/.test(rawSqlReason)) {
    errors.push("checkDetails.rawSqlRejected.reason must be a raw SQL or read-only guardrail reason");
  }
  const runtimeArgumentValidationReason = valueAt(value, ["checkDetails", "runtimeArgumentValidation", "reason"]);
  if (typeof runtimeArgumentValidationReason !== "string" || !/^invalid_arguments:/.test(runtimeArgumentValidationReason)) {
    errors.push("checkDetails.runtimeArgumentValidation.reason must be an invalid_arguments reason");
  }
  const runtimeArgumentValidationProbes = valueAt(value, ["checkDetails", "runtimeArgumentValidation", "probes"]);
  const expectedArgumentProbePatterns = {
    lucy_query: /^invalid_arguments:lucy_query:/,
    lucy_explain_query: /^invalid_arguments:lucy_explain_query:/,
    lucy_read_source: /^invalid_arguments:lucy_read_source:/,
    lucy_freshness: /^invalid_arguments:lucy_freshness:/
  };
  if (!Array.isArray(runtimeArgumentValidationProbes)) {
    errors.push("checkDetails.runtimeArgumentValidation.probes must be an array");
  } else {
    for (const [tool, pattern] of Object.entries(expectedArgumentProbePatterns)) {
      const probe = runtimeArgumentValidationProbes.find((item) => item?.tool === tool);
      if (!probe) {
        errors.push(`checkDetails.runtimeArgumentValidation.probes must include ${tool}`);
      } else {
        if (probe.passed !== true) errors.push(`checkDetails.runtimeArgumentValidation.probes.${tool}.passed must be true`);
        if (typeof probe.reason !== "string" || !pattern.test(probe.reason)) {
          errors.push(`checkDetails.runtimeArgumentValidation.probes.${tool}.reason must match ${pattern}`);
        }
      }
    }
  }
  const effectiveLimit = requireFiniteNumber(value, "checkDetails.limitCapped.effectiveLimit", errors);
  const maxLimit = requireFiniteNumber(value, "checkDetails.limitCapped.maxLimit", errors);
  if (typeof effectiveLimit === "number" && typeof maxLimit === "number" && effectiveLimit > maxLimit) {
    errors.push("checkDetails.limitCapped.effectiveLimit must be <= maxLimit");
  }
  const maxConcurrentQueries = requireFiniteNumber(value, "checkDetails.concurrencyGuardrail.maxConcurrentQueries", errors);
  if (typeof maxConcurrentQueries === "number" && maxConcurrentQueries < 1) {
    errors.push("checkDetails.concurrencyGuardrail.maxConcurrentQueries must be >= 1");
  }
  const concurrencyAttempted = valueAt(value, ["checkDetails", "concurrencyGuardrail", "attempted"]);
  if (concurrencyAttempted !== true) {
    errors.push("checkDetails.concurrencyGuardrail.attempted must be true");
  }
  const concurrencyProbeCount = requireFiniteNumber(value, "checkDetails.concurrencyGuardrail.probeCount", errors);
  if (typeof concurrencyProbeCount === "number" && typeof maxConcurrentQueries === "number" && concurrencyProbeCount <= maxConcurrentQueries) {
    errors.push("checkDetails.concurrencyGuardrail.probeCount must be > maxConcurrentQueries");
  }
  const concurrencyDenialCount = requireFiniteNumber(value, "checkDetails.concurrencyGuardrail.denialCount", errors);
  if (typeof concurrencyDenialCount === "number" && concurrencyDenialCount < 1) {
    errors.push("checkDetails.concurrencyGuardrail.denialCount must be >= 1");
  }
  const concurrencyDeniedReasons = valueAt(value, ["checkDetails", "concurrencyGuardrail", "deniedReasons"]);
  if (!Array.isArray(concurrencyDeniedReasons) || !concurrencyDeniedReasons.includes("query_concurrency_exceeded")) {
    errors.push("checkDetails.concurrencyGuardrail.deniedReasons must include query_concurrency_exceeded");
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasLucyMeta"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasLucyMeta must be true");
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "contract"]) !== "lucy-r1-controlled-data-service") {
    errors.push('checkDetails.lucyMetadata.contract must be "lucy-r1-controlled-data-service"');
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasLucyR1Contract"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasLucyR1Contract must be true");
  }
  if (valueAt(value, ["checkDetails", "lucyMetadata", "hasResultSummary"]) !== true) {
    errors.push("checkDetails.lucyMetadata.hasResultSummary must be true");
  }
  for (const field of [
    "hasProvenance",
    "hasConnectionId",
    "hasSourceName",
    "hasMeasures",
    "hasDimensions",
    "hasFilters",
    "hasSegments",
    "hasOrderBy",
    "hasFreshnessStatus",
    "hasFreshnessTool",
    "hasTruncation"
  ]) {
    if (valueAt(value, ["checkDetails", "lucyMetadata", field]) !== true) {
      errors.push(`checkDetails.lucyMetadata.${field} must be true`);
    }
  }
  if (valueAt(value, ["checkDetails", "readSourceMetadata", "hasLucyMeta"]) !== true) {
    errors.push("checkDetails.readSourceMetadata.hasLucyMeta must be true");
  }
  if (valueAt(value, ["checkDetails", "readSourceMetadata", "contract"]) !== "lucy-r1-controlled-data-service") {
    errors.push('checkDetails.readSourceMetadata.contract must be "lucy-r1-controlled-data-service"');
  }
  if (valueAt(value, ["checkDetails", "readSourceMetadata", "hasLucyR1Contract"]) !== true) {
    errors.push("checkDetails.readSourceMetadata.hasLucyR1Contract must be true");
  }
  return {
    ok: errors.length === 0,
    errors,
    summary: {
      contract: value.contract,
      target: value.target,
      proxyUrl: value.proxyUrl,
      connectionId: value.connectionId,
      sourceName: value.sourceName
    }
  };
}

function checkExternalEvidence() {
  const mcpContractEvidence = evidenceFileFromEnv("LUCY_R1_MCP_CONTRACT_EVIDENCE");
  if (mcpContractEvidence && existsSync(mcpContractEvidence)) {
    const validation = validateMcpContractEvidence(mcpContractEvidence);
    add(validation.ok ? "pass" : "fail", "external.mcp_contract", "Lucy R1 MCP contract evidence is structurally valid", {
      file: mcpContractEvidence,
      mtime: statSync(mcpContractEvidence).mtime.toISOString(),
      ...validation
    });
  } else {
    add(STRICT ? "fail" : "manual", "external.mcp_contract", "Lucy R1 MCP contract smoke requires runtime evidence", {
      env: "LUCY_R1_MCP_CONTRACT_EVIDENCE",
      expected: "Path to Lucy R1 MCP contract smoke evidence JSON"
    });
  }

  const dorisEvidence = evidenceFileFromEnv("LUCY_R1_DORIS_EVIDENCE");
  if (dorisEvidence && existsSync(dorisEvidence)) {
    const validation = validateDorisEvidence(dorisEvidence);
    add(validation.ok ? "pass" : "fail", "external.doris", "Doris vertical slice evidence is structurally valid", {
      file: dorisEvidence,
      mtime: statSync(dorisEvidence).mtime.toISOString(),
      ...validation
    });
  } else {
    add(STRICT ? "fail" : "manual", "external.doris", "Doris vertical slice requires external evidence", {
      env: "LUCY_R1_DORIS_EVIDENCE",
      expected: "Path to Doris vertical slice evidence JSON"
    });
  }

  const hermesEvidence = evidenceFileFromEnv("LUCY_R1_HERMES_ACCURACY_REPORT");
  if (hermesEvidence && existsSync(hermesEvidence)) {
    const validation = validateHermesEvidence(hermesEvidence);
    add(validation.ok ? "pass" : "fail", "external.hermes", "Hermes QA accuracy evidence is structurally valid", {
      file: hermesEvidence,
      mtime: statSync(hermesEvidence).mtime.toISOString(),
      ...validation
    });
  } else {
    add(STRICT ? "fail" : "manual", "external.hermes", "Hermes >=95% QA accuracy report requires external evidence", {
      env: "LUCY_R1_HERMES_ACCURACY_REPORT",
      expected: "Path to Hermes QA Accuracy Report JSON"
    });
  }
}

checkDoc();
checkAccessYaml();
checkProxyContract();
checkAclContract();
checkAdminContract();
checkTargetSourceModel();
checkEvidenceGenerators();
checkObservabilityContract();
checkExternalEvidence();

const counts = results.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] ?? 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  ok: !results.some((item) => item.status === "fail"),
  strict: STRICT,
  counts,
  results
}, null, 2));

if (results.some((item) => item.status === "fail")) {
  process.exit(1);
}
