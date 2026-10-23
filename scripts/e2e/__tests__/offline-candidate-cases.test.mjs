// Contract tests for the offline/candidate UX-06 handler module
// (scripts/e2e/security/offline-candidate-cases.mjs). These tests prove:
//   - the handlers are registered for every catalog-required security-runner
//     UX-06 deny variant (V04..V07);
//   - the catalog references those ids and tags them with `runner: security`;
//   - the handler modules do NOT use invented domain / suite_id / case_id
//     values — they read from the real /api/eval/suites/:domain/download
//     endpoint and the real /api/eval/domains discoverability surface;
//   - the handler modules assert EXACT error codes (EVAL_RESULT_SCHEMA_INVALID,
//     RESULT_REQUIRED_FIELD, etc.) rather than generic 4xx / http_4xx;
//   - the handler modules never substitute a `lucy_query` call for
//     `runOfflineBatch` (UX-06-V07 uses POST /api/eval/runs).
//
// Synthetic contracts; not a live E2E. The actual execution contract is the
// `run-security.mjs` integration that boots Lucy against the fixture.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { loadHandlers } from "../run-security.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { handlers } from "../security/offline-candidate-cases.mjs";

const { cases } = loadCatalog();
const byId = new Map(cases.map((c) => [c.id, c]));

const REQUIRED_SECURITY_RUNNERS = [
  "UX-06-V04",
  "UX-06-V05",
  "UX-06-V06",
  "UX-06-V07"
];

const REQUIRED_IDS = new Set(REQUIRED_SECURITY_RUNNERS);

describe("offline / candidate UX-06 deny handlers (D6 contract)", () => {
  it("exports handlers for every required security-runner variant", () => {
    for (const id of REQUIRED_SECURITY_RUNNERS) {
      assert.equal(typeof handlers[id], "function", `handler ${id} must be exported`);
    }
    assert.equal(Object.keys(handlers).length, REQUIRED_SECURITY_RUNNERS.length, "handler map must contain exactly the required ids");
  });

  it("registering through loadHandlers keeps the UX-06 deny set discoverable", async () => {
    const merged = await loadHandlers();
    for (const id of REQUIRED_SECURITY_RUNNERS) {
      assert.equal(typeof merged[id], "function", `loadHandlers must pick up ${id}`);
    }
  });

  it("every required id is in the frozen catalog and tagged runner: security", () => {
    for (const id of REQUIRED_IDS) {
      const c = byId.get(id);
      assert.ok(c, `${id} must exist in scripts/e2e/contracts/case-catalog.yaml`);
      assert.equal(c.runner, "security", `${id} must be tagged runner: security`);
    }
  });

  it("handler source code never fabricates a domain / suite_id / case_id (uses real /api/eval/domains)", () => {
    const source = readFileSync(path.join("scripts/e2e/security/offline-candidate-cases.mjs"), "utf8");
    // No invented domain names (sales_v1, kx_superstore, etc.)
    assert.equal(
      /suite_id\s*[:=]\s*["']sales_v1["']/i.test(source),
      false,
      "handler must NOT hardcode suite_id='sales_v1'; it must come from the real /api/eval/suites/:domain/download"
    );
    // No invented case ids
    assert.equal(
      /case_id\s*[:=]\s*["']spend-by-platform["']/i.test(source),
      false,
      "handler must NOT hardcode case_id='spend-by-platform'; it must come from the real suite"
    );
    // No hardcoded fake hashes
    assert.equal(
      /"0"\s*\.\s*repeat\(63\)\s*\+\s*"1"/.test(source),
      false,
      "handler must NOT hardcode a fake mismatched hash; it must compute a real one and the suite's own hash"
    );
    // Uses the real /api/eval/domains discoverability surface
    assert.match(source, /\/api\/eval\/domains/, "handler must use the real /api/eval/domains discoverability surface");
    // Uses the real /api/eval/suites/:domain/download endpoint
    assert.match(source, /\/api\/eval\/suites\/:domain\/download|\/api\/eval\/suites\//, "handler must use the real /api/eval/suites/:domain/download endpoint");
  });

  it("handler source code asserts EXACT error codes, not generic 4xx (no http_4xx pass-through)", () => {
    const source = readFileSync(path.join("scripts/e2e/security/offline-candidate-cases.mjs"), "utf8");
    // Exact error code for hash mismatch
    assert.match(source, /EVAL_RESULT_SCHEMA_INVALID|RESULT_REQUIRED_FIELD|RESULT_HASH_MISMATCH/, "handler must assert exact error code from suite-import.ts");
    // Exact runner.kind / runner.model error path
    assert.match(source, /runner\.kind|runner\.model/, "handler must assert exact error path runner.kind / runner.model");
    // No generic "http_4xx" always-pass branch
    assert.equal(
      /reason\.source\s*===\s*["']http_4xx["']/.test(source),
      false,
      "handler must NOT accept 'http_4xx' as a deny pass-through"
    );
    // No bodyText.length >= 0 tautology
    assert.equal(
      /bodyText\(importRes\)\.length\s*>=\s*0/.test(source),
      false,
      "handler must NOT carry bodyText.length >= 0 tautology"
    );
    // No baseline.status >= 0 always-pass (matches as actual code, not comment)
    const codeOnly = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.equal(
      /baseline\.status\s*>=\s*0/.test(codeOnly),
      false,
      "handler must NOT carry baseline.status >= 0 always-pass (in code, not comments)"
    );
  });

  it("UX-06-V07 invokes POST /api/eval/runs (real run-spawn path), NOT lucy_query as a substitute", () => {
    const source = readFileSync(path.join("scripts/e2e/security/offline-candidate-cases.mjs"), "utf8");
    // The V07 handler must use POST /api/eval/runs
    const v07Body = source.split(/async function ux06v07\b/)[1]?.split(/^async function|^export const/s)[0] ?? "";
    // Strip comments before checking for code-level patterns
    const v07Code = v07Body.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.match(v07Body, /\/api\/eval\/runs/, "V07 must call POST /api/eval/runs");
    // The V07 handler must NOT use lucyQuery as the role-precondition substitute
    assert.equal(/lucyQuery/i.test(v07Code), false, "V07 must NOT use lucyQuery as a role-precondition substitute");
    // The V07 handler must NOT pass role_id via body (the precondition is from the Token, not body)
    assert.equal(/role_id\s*:\s*["']["']/.test(v07Code), false, "V07 must NOT pass role_id via body — the precondition is from the Bearer Token");
  });

  it("all required handlers are exported and loadable without throwing", () => {
    // Structural: the module-level object has exactly the 4 ids, each a function.
    for (const id of REQUIRED_SECURITY_RUNNERS) {
      assert.equal(typeof handlers[id], "function", `${id} must be a function`);
    }
  });
});
