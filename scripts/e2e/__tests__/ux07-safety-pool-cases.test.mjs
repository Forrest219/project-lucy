// Contract tests for the UX-07 safety-pool / field-question handler module
// (scripts/e2e/security/ux07-safety-pool-cases.mjs).
//
// UX-07 is OWNED BY THE MANAGEMENT RUNNER (catalog tag: `runner: management`),
// not the security runner. This module is a structural stand-in: it exposes
// the same handler shape so the management runner can adopt it without source
// changes. These tests prove:
//   - the module exports handlers for all 5 UX-07 catalog ids (V01..V04, S01);
//   - the catalog lists those ids (under UX-07) so the management runner can
//     later pick them up;
//   - V01 finds candidate rows by EXACT request-id match (no
//     operator-precedence bug matching "tool=wiki_read AND reason matches
//     a substring");
//   - V03 uses the real `actorIdHash = sha256(actorId).slice(0, 32)` schema
//     and never persists the raw actorId;
//   - S01 monitor / field never carries pass_count (Spec 161 §8.4).
//
// Synthetic contracts; not a live E2E.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadCatalog } from "../lib/catalog.mjs";
import { handlers } from "../security/ux07-safety-pool-cases.mjs";

const { cases } = loadCatalog();
const byId = new Map(cases.map((c) => [c.id, c]));

const REQUIRED_HANDLER_IDS = [
  "UX-07-V01",
  "UX-07-V02",
  "UX-07-V03",
  "UX-07-V04",
  "UX-07-S01"
];

describe("UX-07 safety-pool / field-question handlers (D6 contract)", () => {
  it("exports handlers for every required UX-07 catalog id", () => {
    for (const id of REQUIRED_HANDLER_IDS) {
      assert.equal(typeof handlers[id], "function", `handler ${id} must be exported`);
    }
    assert.equal(Object.keys(handlers).length, REQUIRED_HANDLER_IDS.length, "handler map must contain exactly the required ids");
  });

  it("every required id exists in the frozen catalog under scenario UX-07", () => {
    for (const id of REQUIRED_HANDLER_IDS) {
      const c = byId.get(id);
      assert.ok(c, `${id} must exist in scripts/e2e/contracts/case-catalog.yaml`);
      assert.equal(c.scenario, "UX-07", `${id} must be under scenario UX-07`);
    }
  });

  it("UX-07 catalog ids are NOT tagged runner: security (management runner owns them)", () => {
    for (const id of REQUIRED_HANDLER_IDS) {
      const c = byId.get(id);
      assert.notEqual(c.runner, "security", `${id} must NOT be tagged runner: security (management runner owns it)`);
    }
  });

  it("the run-security runner does NOT register UX-07 (GATE-01 ownership boundary)", async () => {
    const { loadHandlers } = await import("../run-security.mjs");
    const merged = await loadHandlers();
    for (const id of REQUIRED_HANDLER_IDS) {
      assert.equal(merged[id], undefined, `run-security.mjs must NOT pick up ${id} (owned by management runner)`);
    }
  });

  it("UX-07-V01 finds candidate rows by EXACT request-id match (no operator-precedence bug)", () => {
    const source = readFileSync(path.join("scripts/e2e/security/ux07-safety-pool-cases.mjs"), "utf8");
    const v01Body = source.split(/async function ux07v01\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    // The handler must use source_trace_id / request_id / access_log_request_id matching
    assert.match(v01Body, /source_trace_id|request_id|access_log_request_id/, "V01 must match by exact request id");
    // Must NOT use the previous "tool == wiki_read AND reason matches a substring" pattern
    assert.equal(
      /tool\s*===\s*["']wiki_read["']\s*&&|decision_reason.*\.match\(.forbidden|context_role_required.\)/i.test(v01Body) && /findCandidateByRequestId/.test(v01Body) === false,
      false,
      "V01 must NOT fall back to tool+reason substring matching"
    );
    // Must use findCandidateByRequestId
    assert.match(v01Body, /findCandidateByRequestId/, "V01 must use findCandidateByRequestId helper");
  });

  it("UX-07-V03 reviewer schema uses actorIdHash = sha256(actorId).slice(0, 32) — never raw actorId", () => {
    const source = readFileSync(path.join("scripts/e2e/security/ux07-safety-pool-cases.mjs"), "utf8");
    const v03Body = source.split(/async function ux07v03\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    // Uses actorIdHash helper
    assert.match(v03Body, /actorIdHash/, "V03 must use the actorIdHash helper");
    // Uses sha256 of the actorId
    assert.match(v03Body, /sha256.*actorId|createHash.*sha256/i, "V03 must compute sha256 of actorId");
    // Asserts that the raw actorId is NOT in the persisted blob
    assert.match(v03Body, /MUST NOT carry the raw actorId|actorId.*undefined.*reviewerId|MUST NOT carry the raw/, "V03 must assert raw actorId is not persisted");
  });

  it("UX-07-S01 monitor / field never carries pass_count (Spec 161 §8.4)", () => {
    const source = readFileSync(path.join("scripts/e2e/security/ux07-safety-pool-cases.mjs"), "utf8");
    const s01Body = source.split(/async function ux07s01\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    assert.match(s01Body, /pass_count|passCount/, "S01 must explicitly check for the forbidden pass_count column");
    assert.match(s01Body, /NEVER carry a pass_count column/, "S01 must have a deny assertion against pass_count");
  });

  it("UX-07-V02 uses the real /api/eval/field-questions/extract endpoint and trace-bound shape", () => {
    const source = readFileSync(path.join("scripts/e2e/security/ux07-safety-pool-cases.mjs"), "utf8");
    const helpers = readFileSync(path.join("scripts/e2e/security/d6-eval-helpers.mjs"), "utf8");
    // V02 calls d6.evalFieldQuestionsExtract(pack); the helper file must use
    // the real /api/eval/field-questions/extract endpoint
    const helpersFlat = helpers.replace(/\s+/g, "");
    assert.match(helpersFlat, /field-questions\/extract/, "V02 helper must use the real /api/eval/field-questions/extract endpoint");
    // V02 must carry sourceMapVersion + measures + dimensions + filterFields + roleIds shape
    const v02Body = source.split(/async function ux07v02\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    assert.match(v02Body, /sourceMapVersion/, "V02 must carry sourceMapVersion (the real schema key)");
    assert.match(v02Body, /measures/, "V02 must carry measures (the real schema key)");
    assert.match(v02Body, /dimensions/, "V02 must carry dimensions (the real schema key)");
    assert.match(v02Body, /filterFields/, "V02 must carry filterFields (the real schema key)");
    assert.match(v02Body, /roleIds/, "V02 must carry roleIds (the real schema key)");
  });

  it("UX-07-V04 asserts redaction_status is final (redacted/cleared), not just 'not pending'", () => {
    const source = readFileSync(path.join("scripts/e2e/security/ux07-safety-pool-cases.mjs"), "utf8");
    const v04Body = source.split(/async function ux07v04\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    assert.match(v04Body, /redacted|cleared/, "V04 must assert redaction_status is in the documented final set");
  });
});
