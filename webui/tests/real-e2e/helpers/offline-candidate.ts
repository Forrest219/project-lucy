// Offline eval / security-candidate / field-question helpers (Spec 161 / 172 / 173).
//
// SCOPE: structural helpers. NO real HTTP, NO real Lucy boot. They
//   - document the ACTUAL product endpoint / payload shape for every UX-06/UX-07
//     variant the management runner is expected to verify;
//   - provide builders for the offline batch fixture (suite YAML + result JSON)
//     that mirror the authoritative schema in webui/server/eval/suite-schema.ts
//     and offline-batch.ts;
//   - declare the binding between a real product native client (claude-code,
//     openclaw) and the management runner's route set, so no fixture doubles
//     as a "real client" claim. Real GUI WorkBuddy / Cursor packs are out of
//     scope (human-required per spec R7).
//
// Real-human packs are written to results/manual/<product>.json by Spec 46
// v1.1 manual checklist docs/qa/manual-gui-e2e-checklist.md. Those packs bind
// the BEHAVIOUR but a synthetic harness never asserts they were fabricated.

import { createHash, randomUUID } from "node:crypto";

export type RunnerKind = "lucy_offline_batch";

/** Allowed runner kinds for v2 result files. Spec 161 v0.2 §7. */
export const VALID_RUNNER_KIND: RunnerKind = "lucy_offline_batch";

export const VALID_SCHEMA_VERSION = 2;
export const VALID_RESULT_VERSION = 2;

/** Hash the suite as the server would (sha256 over the canonical YAML bytes). */
export function suiteHash(yamlOrString: string): string {
  return "sha256:" + createHash("sha256").update(yamlOrString).digest("hex");
}

/** Build a v1-compatible offline result that the real server will reject (model set). */
export function buildResultWithModel(overrides: Record<string, unknown> = {}): unknown {
  return {
    lucy_eval_result_version: VALID_RESULT_VERSION,
    complete: true,
    role_id: "e2e_finance",
    as_of: "2026-10-11",
    suite_id: "sales_v1",
    suite_hash: suiteHash("sales_v1"),
    domain: "sales",
    runner: { kind: "lucy_offline_batch", version: "2", model: "claude-3-7-sonnet-20250219" },
    started_at: "2026-10-11T00:00:00.000Z",
    finished_at: "2026-10-11T00:01:00.000Z",
    results: [{ case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" }],
    ...overrides
  };
}

/** Build a v2 result that will be refused with `complete != true`. */
export function buildIncompleteResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    lucy_eval_result_version: VALID_RESULT_VERSION,
    complete: false,
    role_id: "e2e_finance",
    as_of: "2026-10-11",
    suite_id: "sales_v1",
    suite_hash: suiteHash("sales_v1"),
    domain: "sales",
    runner: { kind: VALID_RUNNER_KIND, version: "2", model: "" },
    started_at: "2026-10-11T00:00:00.000Z",
    finished_at: "2026-10-11T00:01:00.000Z",
    results: [{ case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" }],
    ...overrides
  };
}

/** Build a v2 result with a deliberately wrong runner kind (hermes). */
export function buildWrongRunnerResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    lucy_eval_result_version: VALID_RESULT_VERSION,
    complete: true,
    role_id: "e2e_finance",
    as_of: "2026-10-11",
    suite_id: "sales_v1",
    suite_hash: suiteHash("sales_v1"),
    domain: "sales",
    runner: { kind: "hermes", version: "2", model: "" },
    started_at: "2026-10-11T00:00:00.000Z",
    finished_at: "2026-10-11T00:01:00.000Z",
    results: [{ case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" }],
    ...overrides
  };
}

/** Build a v2 result with a mismatched suite hash. */
export function buildHashMismatchResult(overrides: Record<string, unknown> = {}): unknown {
  return {
    lucy_eval_result_version: VALID_RESULT_VERSION,
    complete: true,
    role_id: "e2e_finance",
    as_of: "2026-10-11",
    suite_id: "sales_v1",
    suite_hash: "sha256:" + "0".repeat(63) + "1",
    domain: "sales",
    runner: { kind: VALID_RUNNER_KIND, version: "2", model: "" },
    started_at: "2026-10-11T00:00:00.000Z",
    finished_at: "2026-10-11T00:01:00.000Z",
    results: [{ case_id: "spend-by-platform", status: "PASS", outcome: "answered_ok" }],
    ...overrides
  };
}

/** The exact offline batch runner command the server publishes
 *  (Spec 161 §11). Local copy of `downloadEvalSuiteYaml` — refreshed by the
 *  download endpoint on every GET. Header-safe ASCII. */
export const OFFLINE_BATCH_RUNNER_COMMAND = "node scripts/eval/lucy-eval-runner.mjs --suite <SUITE_PATH> --output <OUTPUT_JSON>";

/** Real product endpoints the management runner is wired to (Spec 161 / 172 / 173). */
export const PRODUCT_ENDPOINTS = {
  suiteDownload: (domain: string) => `/api/eval/suites/${encodeURIComponent(domain)}/download`,
  suiteImport: () => `/api/eval/suites/import`,
  resultImport: () => `/api/eval/results/import`,
  caseConfirmReview: (domain: string, caseId: string) =>
    `/api/eval/cases/${encodeURIComponent(domain)}/${encodeURIComponent(caseId)}/confirm-review`,
  securityCandidatesList: () => `/api/eval/security-candidates`,
  securityCandidatesExtract: () => `/api/eval/security-candidates/extract`,
  securityCandidateReview: (id: string) => `/api/eval/security-candidates/${encodeURIComponent(id)}/review`,
  securityCandidatePromotePreview: (id: string) => `/api/eval/security-candidates/${encodeURIComponent(id)}/promote/preview`,
  fieldQuestionsList: () => `/api/eval/field-questions`,
  fieldQuestionsExtract: () => `/api/eval/field-questions/extract`,
  fieldQuestionsPromote: (id: string) => `/api/eval/field-questions/${encodeURIComponent(id)}/promote`,
  monitorTrend: () => `/api/eval/monitor/trend`,
  monitorTopFailures: () => `/api/eval/monitor/top-failures`,
  monitorField: () => `/api/eval/monitor/field`,
  monitorConfig: () => `/api/eval/monitor/config`,
  monitorThreshold: () => `/api/eval/monitor/threshold`,
  runSummary: () => `/api/eval/runs/summary`,
  runsList: () => `/api/eval/runs`,
  runDetail: (runId: string) => `/api/eval/runs/${encodeURIComponent(runId)}`
} as const;

/** The native product clients that map to management runner + the bridge they
 *  use. Every real client points at the SAME MCP endpoint; this object just
 *  records the binding so a future case cannot accidentally swap adapters.
 *
 *  - claude-code: scripts/e2e/adapters/claude-code.mjs (automated, required)
 *  - openclaw:    scripts/e2e/adapters/openclaw.mjs    (automated, required)
 *  - workbuddy:   docs/qa/manual-gui-e2e-checklist.md  (manual, required)
 *  - cursor:      docs/qa/manual-gui-e2e-checklist.md  (manual, required)
 */
export const NATIVE_CLIENT_BINDINGS = {
  "claude-code": { runner: "agent", adapter: "scripts/e2e/adapters/claude-code.mjs", required: true },
  openclaw: { runner: "agent", adapter: "scripts/e2e/adapters/openclaw.mjs", required: true },
  workbuddy: { runner: "manual", adapter: null, required: true },
  cursor: { runner: "manual", adapter: null, required: true },
  codex: { runner: "agent", adapter: "scripts/e2e/adapters/codex.mjs", required: false },
  "cursor-cli": { runner: "agent", adapter: "scripts/e2e/adapters/cursor-cli.mjs", required: false }
} as const;

/** Required manual clients for the E2E binding table. The exact set equality
 *  is the static contract: nothing may be added or removed to turn a failed
 *  run green. (catalog32 / 255 required variant denominator unchanged.) */
export const REQUIRED_MANUAL_PRODUCTS = ["workbuddy", "cursor"] as const;

/** Required automated clients for the E2E binding table. Same exact-set rule. */
export const REQUIRED_AUTOMATED_PRODUCTS = ["claude-code", "openclaw"] as const;

/** UX-06 / UX-07 mapping: which runner is responsible for each case.
 *  Note: management runner is owned by another builder; this file only
 *  documents the mapping, not the implementation. */
export const OFFLINE_CANDIDATE_RUNNER_MAPPING = {
  "UX-06-V01": { runner: "management", requiredCapability: "lucy-http" },
  "UX-06-V02": { runner: "management", requiredCapability: "lucy-http,agent-client" },
  "UX-06-V03": { runner: "management", requiredCapability: "lucy-http" },
  "UX-06-V04": { runner: "security", requiredCapability: "lucy-http" },
  "UX-06-V05": { runner: "security", requiredCapability: "lucy-http" },
  "UX-06-V06": { runner: "security", requiredCapability: "lucy-http" },
  "UX-06-V07": { runner: "security", requiredCapability: "lucy-http" },
  "UX-06-V08": { runner: "management", requiredCapability: "lucy-http" },
  "UX-07-V01": { runner: "management", requiredCapability: "lucy-http" },
  "UX-07-V02": { runner: "management", requiredCapability: "lucy-http" },
  "UX-07-V03": { runner: "management", requiredCapability: "lucy-http" },
  "UX-07-V04": { runner: "management", requiredCapability: "lucy-http" },
  "UX-07-S01": { runner: "management", requiredCapability: "lucy-http" }
} as const;

/** Build a synthetic cross-domain denial pack that mirrors the real shape
 *  Spec 172/173 expect for security_eval_candidate rows. NEVER mark this as
 *  a "real client produced this evidence" artefact. */
export function buildSecurityCandidateRow(overrides: Record<string, unknown> = {}): unknown {
  const accessLogId = randomUUID();
  const eventHash = createHash("sha256").update(`cross-domain|wiki_read|${accessLogId}`).digest("hex");
  return {
    id: `sec_eval_${eventHash.slice(0, 20)}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    source_trace_id: null,
    source_access_log_id: Number(accessLogId.replace(/-/g, "").slice(0, 8)),
    normalized_event: { tool: "wiki_read", requested: { path: "finance/cac-definition.md" }, denied: true },
    event_hash: eventHash,
    decision_reason: "context_role_required",
    tool: "wiki_read",
    user_id: "e2e_sales",
    token_hash_prefix: "e2e_sales",
    role_ids_json: JSON.stringify(["sales_reader"]),
    table_refs_json: JSON.stringify(["finance/cac-definition.md"]),
    risk_tier: "P0",
    status: "candidate",
    redaction_status: "redacted",
    evidence_json: JSON.stringify({ source: "access_log", accessLogId, requestId: accessLogId, permissionSnapshotHash: "snap-stub", traceId: null }),
    ...overrides
  };
}

/** Build a synthetic field_question row from a lucy_query error cluster. Used
 *  by UX-07-V02 to exercise the business-pool path WITHOUT a real run. */
export function buildFieldQuestionRow(overrides: Record<string, unknown> = {}): unknown {
  const sourceMapVersion = "e2e-source-map-stub";
  const measures = ["spend_e2e_stub"];
  const filterFields = ["stat_date"];
  const dimensions = ["platform"];
  const shapeBody = { measures, dimensions, filterFields };
  const shapeHash = createHash("sha256").update(JSON.stringify(shapeBody)).digest("hex");
  return {
    id: shapeHash.slice(0, 16),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    domain: "sales",
    source_map_version: sourceMapVersion,
    shape_hash: shapeHash,
    failure_class: "measure_unbound",
    hit_count: 3,
    first_seen_on: "2026-10-10",
    last_seen_on: "2026-10-12",
    role_ids_json: JSON.stringify(["e2e_finance"]),
    summary: `查 spend_e2e_stub 时，measure_unbound`,
    status: "candidate",
    evidence_json: JSON.stringify({ measures }),
    ...overrides
  };
}
