// Offline / candidate real-E2E (Spec 161 / 172 / 173) — Playwright spec.
//
// SCOPE: structural spec. The actual GUI / human execution path is owned by
//   - the management-runner builder (other D-stream), and
//   - the manual checklist (docs/qa/manual-gui-e2e-checklist.md).
// This spec:
//   - asserts the management runner + manual checklist bindings via
//     `covers()` — every UX-06/UX-07 catalog id is bound to AT LEAST ONE
//     real client side (management runner or manual WorkBuddy/Cursor);
//   - asserts `blockUnless(...)` so the spec stays BLOCKED when the
//     human / management capability is missing, instead of false-passing;
//   - NEVER makes a positive runtime claim about a real client (no fetch
//     in the test body); the spec is a contract, not a live E2E.
//
// The real GUI WorkBuddy / Cursor packs are bound via
// docs/qa/manual-gui-e2e-checklist.md (Spec 46 v1.1). The management runner
// (other builder) handles the live calls. This spec never claims a positive
// real-client trace — its only job is to bind, not to assert.

import { expect, test } from "@playwright/test";
import { covers, blockUnless, assertion, contractOnly } from "./helpers/blocked";
import {
  OFFLINE_CANDIDATE_RUNNER_MAPPING,
  PRODUCT_ENDPOINTS,
  REQUIRED_AUTOMATED_PRODUCTS,
  REQUIRED_MANUAL_PRODUCTS
} from "./helpers/offline-candidate";

/**
 * The assertion tokens the FROZEN catalog declares for the ids this spec covers
 * (scripts/e2e/contracts/case-catalog.yaml, scenarios UX-06 / UX-07).
 *
 * This spec is a BINDING CONTRACT: it proves which endpoint / command / client set
 * a case is bound to and never produces the live evidence (`real_query`,
 * `typed_gold`, `consistency`, `no_leak`). Without the declaration below the
 * collector sees "declared token never evaluated" and calls the case FAILED — which
 * blames a product that was never exercised. Declaring it makes the collector record
 * BLOCKED instead, which is what "not evaluated" actually means.
 */
const CATALOG_TOKENS: Record<string, string[]> = {
  "UX-06-V01": ["allow_control"],
  "UX-06-V02": ["allow_control", "real_query", "typed_gold"],
  "UX-06-V03": ["allow_control", "consistency"],
  "UX-06-V08": ["consistency"],
  "UX-07-V01": ["consistency", "no_leak"],
  "UX-07-V02": ["consistency", "no_leak"],
  "UX-07-V03": ["consistency", "no_leak"],
  "UX-07-V04": ["consistency", "no_leak"],
  "UX-07-S01": ["consistency", "no_leak"]
};

/** Declares, for the ids this test covers, that their live evidence is not produced here. */
function declareContractOnly(testInfo: Parameters<typeof covers>[0], ids: string[]): void {
  const tokensById: Record<string, string[]> = {};
  for (const id of ids) tokensById[id] = CATALOG_TOKENS[id] ?? [];
  contractOnly(testInfo, tokensById);
}

test.describe("offline / candidate UX-06 + UX-07 (real client binding contract)", () => {
  test("binds every UX-06 / UX-07 catalog id to exactly one runner", async ({}, testInfo) => {
    covers(
      testInfo,
      "UX-06-V01",
      "UX-06-V02",
      "UX-06-V03",
      "UX-06-V04",
      "UX-06-V05",
      "UX-06-V06",
      "UX-06-V07",
      "UX-06-V08",
      "UX-07-V01",
      "UX-07-V02",
      "UX-07-V03",
      "UX-07-V04",
      "UX-07-S01"
    );
    assertion(testInfo, "covers_all_ux06_ux07", Object.keys(OFFLINE_CANDIDATE_RUNNER_MAPPING).length === 13, "13 catalog ids total");
    declareContractOnly(testInfo, [
      "UX-06-V01", "UX-06-V02", "UX-06-V03", "UX-06-V04", "UX-06-V05",
      "UX-06-V06", "UX-06-V07", "UX-06-V08", "UX-07-V01", "UX-07-V02",
      "UX-07-V03", "UX-07-V04", "UX-07-S01"
    ]);
  });

  test("UX-06-V01 suite download endpoint shape", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V01");
    declareContractOnly(testInfo, ["UX-06-V01"]);
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.suiteDownload("sales") === "/api/eval/suites/sales/download", "suite download URL is real product URL");
  });

  test("UX-06-V02 offline batch runner command is the published one", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V02");
    declareContractOnly(testInfo, ["UX-06-V02"]);
    // OFFLINE_BATCH_RUNNER_COMMAND comes from the helper; we re-import it here
    // so a future drop of the constant trips the contract.
    const helper = await import("./helpers/offline-candidate");
    assertion(
      testInfo,
      "command_constant",
      helper.OFFLINE_BATCH_RUNNER_COMMAND === "node scripts/eval/lucy-eval-runner.mjs --suite <SUITE_PATH> --output <OUTPUT_JSON>",
      "offline batch runner command matches Spec 161 §11"
    );
  });

  test("UX-06-V03 / UX-06-V08 result import + case confirm-review endpoints", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V03", "UX-06-V08");
    declareContractOnly(testInfo, ["UX-06-V03", "UX-06-V08"]);
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.resultImport() === "/api/eval/results/import", "results import URL is real product URL");
    assertion(
      testInfo,
      "endpoint_constant",
      PRODUCT_ENDPOINTS.caseConfirmReview("sales", "spend-by-platform") === "/api/eval/cases/sales/spend-by-platform/confirm-review",
      "case confirm-review URL is real product URL"
    );
  });

  test("UX-07-V01..V04 + S01 endpoint shapes", async ({}, testInfo) => {
    covers(testInfo, "UX-07-V01", "UX-07-V02", "UX-07-V03", "UX-07-V04", "UX-07-S01");
    declareContractOnly(testInfo, ["UX-07-V01", "UX-07-V02", "UX-07-V03", "UX-07-V04", "UX-07-S01"]);
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.securityCandidatesList() === "/api/eval/security-candidates", "list URL");
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.securityCandidatesExtract() === "/api/eval/security-candidates/extract", "extract URL");
    assertion(
      testInfo,
      "endpoint_constant",
      PRODUCT_ENDPOINTS.securityCandidateReview("sec_eval_abc") === "/api/eval/security-candidates/sec_eval_abc/review",
      "review URL"
    );
    assertion(
      testInfo,
      "endpoint_constant",
      PRODUCT_ENDPOINTS.securityCandidatePromotePreview("sec_eval_abc") === "/api/eval/security-candidates/sec_eval_abc/promote/preview",
      "promote-preview URL"
    );
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.fieldQuestionsList() === "/api/eval/field-questions", "field-questions list URL");
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.fieldQuestionsExtract() === "/api/eval/field-questions/extract", "field-questions extract URL");
    assertion(
      testInfo,
      "endpoint_constant",
      PRODUCT_ENDPOINTS.fieldQuestionsPromote("fldq_abc") === "/api/eval/field-questions/fldq_abc/promote",
      "field-questions promote URL"
    );
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.monitorTrend() === "/api/eval/monitor/trend", "monitor trend URL");
    assertion(testInfo, "endpoint_constant", PRODUCT_ENDPOINTS.monitorField() === "/api/eval/monitor/field", "monitor field URL");
  });

  test("manual client set is the EXACT required set (no short-cuts)", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V01", "UX-07-V01");
    declareContractOnly(testInfo, ["UX-06-V01", "UX-07-V01"]);
    assertion(
      testInfo,
      "set_equality",
      JSON.stringify([...REQUIRED_MANUAL_PRODUCTS].sort()) === JSON.stringify(["cursor", "workbuddy"]),
      "required manual clients are exactly {cursor, workbuddy}"
    );
  });

  test("automated client set is the EXACT required set (no short-cuts)", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V01", "UX-07-V01");
    declareContractOnly(testInfo, ["UX-06-V01", "UX-07-V01"]);
    assertion(
      testInfo,
      "set_equality",
      JSON.stringify([...REQUIRED_AUTOMATED_PRODUCTS].sort()) === JSON.stringify(["claude-code", "openclaw"]),
      "required automated clients are exactly {claude-code, openclaw}"
    );
  });

  test("blockUnless: management + manual capability gates this spec as BLOCKED, never PASSED", async ({}, testInfo) => {
    covers(testInfo, "UX-06-V01", "UX-07-V01");
    declareContractOnly(testInfo, ["UX-06-V01", "UX-07-V01"]);
    // This spec never claims a live PASS. If both management-runner and
    // manual capabilities are absent the run is BLOCKED. We never downgrade
    // a BLOCKED to PASSED (Spec §8.2 GATE-01 inverse).
    blockUnless(testInfo, "real-management-runner", "real-manual-packs");
    // If we reach here, the capability is present; we still only assert the
    // binding contract — we never fabricate a real-client trace.
    expect(typeof PRODUCT_ENDPOINTS).toBe("object");
  });
});
