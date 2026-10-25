import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT } from "../lib/common.mjs";
import { collectManagementResults } from "../collect-management-results.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { forbiddenBrowserCalls } from "../lib/real-browser-source-guard.mjs";

const REAL_DIR = path.join(REPO_ROOT, "webui", "tests", "real-e2e");
const CONFIG = readFileSync(path.join(REPO_ROOT, "webui", "playwright.real.config.ts"), "utf8");
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const specFiles = walk(REAL_DIR).filter((f) => f.endsWith(".ts"));

describe("real-user browser E2E guarantees (Spec §6.4, Plan T11)", () => {
  it("the config is desktop 1440x900, one worker, no retries, and no secret-bearing artifacts", () => {
    assert.match(CONFIG, /workers:\s*1\b/);
    assert.match(CONFIG, /retries:\s*0\b/);
    assert.match(CONFIG, /width:\s*1440,\s*height:\s*900/);
    assert.match(CONFIG, /trace:\s*"off"/);
    assert.match(CONFIG, /screenshot:\s*"off"/);
    assert.match(CONFIG, /video:\s*"off"/);
    assert.ok(!/webServer/.test(CONFIG.replace(/\/\/.*$/gm, "")), "real E2E attaches to a verified instance; it never spawns its own webServer");
    assert.deepEqual([...CONFIG.matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]), ["chromium"], "only the desktop chromium project");
  });

  it("no spec or helper mocks an API or fakes KTX", () => {
    for (const file of [...specFiles, path.join(REPO_ROOT, "webui", "playwright.real.config.ts")]) {
      const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
      assert.deepEqual(forbiddenBrowserCalls(readFileSync(file, "utf8"), file), [], `${path.relative(REPO_ROOT, file)} mocks the network`);
      assert.ok(!/fixtures\/bin|KTX_SHIM|ktx-shim/i.test(text.replace(/tests\/e2e\/fixtures\/bin/g, "")) || /global-setup/.test(file), `${path.relative(REPO_ROOT, file)} references the KTX shim`);
    }
    const setup = readFileSync(path.join(REAL_DIR, "helpers", "global-setup.ts"), "utf8");
    assert.match(setup, /tests\/e2e\/fixtures\/bin/, "global setup must actively refuse the contract-fixture KTX shim on PATH");
    assert.match(setup, /bootstrap.*required|required.*bootstrap/s, "global setup must require auth bootstrap/required mode");
  });

  it("specs never enable trace/screenshot capture and never print secrets", () => {
    for (const file of specFiles) {
      const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
      assert.ok(!/screenshot\s*\(|\.screenshot\b|tracing\.start|toHaveScreenshot/.test(text), `${path.relative(REPO_ROOT, file)} captures screenshots/traces`);
      assert.ok(!/console\.(log|info|debug)\([^)]*(token|password|secret|cookie)/i.test(text), `${path.relative(REPO_ROOT, file)} logs a secret-like value`);
      assert.ok(!/writeFileSync\([^)]*(token|password|cookie|storageState)/i.test(text), `${path.relative(REPO_ROOT, file)} writes a secret to disk`);
      assert.ok(!/storageState\(\{\s*path/.test(text), `${path.relative(REPO_ROOT, file)} persists browser state to disk`);
    }
  });

  it("every spec links itself to catalog management/security cases through covers()", () => {
    const ids = new Set(loadCatalog().cases.map((c) => c.id));
    for (const file of specFiles.filter((f) => f.endsWith(".spec.ts"))) {
      const text = readFileSync(file, "utf8");
      const covered = [...text.matchAll(/covers\(testInfo,\s*([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
      assert.ok(covered.length > 0, `${path.relative(REPO_ROOT, file)} covers no case`);
      for (const id of covered) assert.ok(ids.has(id), `${path.relative(REPO_ROOT, file)} covers unknown case ${id}`);
    }
  });
});

describe("management evidence collection never turns missing work into a pass", () => {
  const { cases } = loadCatalog();
  const run = { runId: "t-run-0001", db: { applied: false } };
  const test = (caseId, { status = "expected", resultStatus = "passed", annotations = [] } = {}) => ({
    suites: [{ specs: [{ title: `spec ${caseId}`, tests: [{ status, annotations: [{ type: "case", description: caseId }, ...annotations], results: [{ status: resultStatus, annotations: [] }] }] }] }]
  });
  const a = (token, passed = true) => ({ type: "assert", description: JSON.stringify({ token, passed }) });
  const find = (results, id) => results.find((r) => r.id === id);
  const caps = new Set(["lucy-http", "browser"]);

  it("a case with no covering spec is BLOCKED, naming the missing capability when there is one", () => {
    const results = collectManagementResults({ run, report: { suites: [] }, cases, capabilities: caps });
    assert.equal(find(results, "UX-01-V01").status, "blocked");
    assert.match(find(results, "UX-01-V01").detail, /missing capability: .*postgres/);
    assert.equal(find(results, "SEC-06-V01").status, "blocked");
    assert.ok(results.every((r) => r.status === "blocked"));
  });

  it("a covering spec that passed but skipped a declared assertion token fails the case", () => {
    const results = collectManagementResults({ run, report: test("SEC-01-V06", { annotations: [a("deny")] }), cases, capabilities: caps });
    assert.equal(find(results, "SEC-01-V06").status, "failed");
    assert.match(find(results, "SEC-01-V06").detail, /never evaluated: no_side_effect/);
  });

  it("passes only when every declared token was evaluated true; a false token fails", () => {
    const ok = collectManagementResults({ run, report: test("SEC-01-V06", { annotations: [a("deny"), a("no_side_effect")] }), cases, capabilities: caps });
    assert.equal(find(ok, "SEC-01-V06").status, "passed");
    const bad = collectManagementResults({ run, report: test("SEC-01-V06", { annotations: [a("deny"), a("no_side_effect", false)] }), cases, capabilities: caps });
    assert.equal(find(bad, "SEC-01-V06").status, "failed");
  });

  it("a spec that marked itself blocked is blocked, an unannotated skip is skipped, a failure is failed", () => {
    const blocked = test("SEC-01-V06", { status: "skipped", resultStatus: "skipped", annotations: [{ type: "blocked", description: "missing capability: browser" }] });
    assert.equal(find(collectManagementResults({ run, report: blocked, cases, capabilities: caps }), "SEC-01-V06").status, "blocked");
    const skipped = test("SEC-01-V06", { status: "skipped", resultStatus: "skipped" });
    assert.equal(find(collectManagementResults({ run, report: skipped, cases, capabilities: caps }), "SEC-01-V06").status, "skipped");
    const failed = test("SEC-01-V06", { status: "unexpected", resultStatus: "failed", annotations: [a("deny"), a("no_side_effect")] });
    assert.equal(find(collectManagementResults({ run, report: failed, cases, capabilities: caps }), "SEC-01-V06").status, "failed");
  });
});

describe("a binding-contract runner blocks the case instead of failing it", () => {
  const { cases } = loadCatalog();
  const run = { runId: "t-run-0001", db: { applied: false } };
  const caps = new Set(["lucy-http", "browser"]);
  const a = (token, passed = true) => ({ type: "assert", description: JSON.stringify({ token, passed }) });
  const contractOnly = (tokensById) => ({ type: "contract-only", description: JSON.stringify(tokensById) });
  const find = (results, id) => results.find((r) => r.id === id);
  const test = (caseId, { annotations = [] } = {}) => ({
    suites: [{ specs: [{ title: `spec ${caseId}`, tests: [{ status: "expected", annotations: [{ type: "case", description: caseId }, ...annotations], results: [{ status: "passed", annotations: [] }] }] }] }]
  });

  it("a declared token the contract-only runner declared it will not evaluate blocks the case", () => {
    // UX-06-V02 declares [allow_control, real_query, typed_gold]; the offline
    // binding-contract runner asserts a command constant and never the live evidence.
    const report = test("UX-06-V02", { annotations: [contractOnly({ "UX-06-V02": ["allow_control", "real_query", "typed_gold"] })] });
    const entry = find(collectManagementResults({ run, report, cases, capabilities: caps }), "UX-06-V02");
    assert.equal(entry.status, "blocked");
    assert.match(entry.detail, /binding contract/);
    assert.deepEqual(entry.blockedBy, ["live_evidence_not_evaluated"]);
  });

  it("the fail-closed rule is unchanged for a runner that stayed silent about the missing token", () => {
    // Same case, same missing tokens, but the runner never declared itself
    // contract-only: the case must still FAIL (no vacuous pass).
    const report = test("UX-06-V02", { annotations: [] });
    const entry = find(collectManagementResults({ run, report, cases, capabilities: caps }), "UX-06-V02");
    assert.equal(entry.status, "failed");
    assert.match(entry.detail, /never evaluated/);
  });

  it("a declared token that another covering spec DID evaluate still decides the case", () => {
    // UX-07-V03 declares [consistency, no_leak] and the authorization-summary spec
    // evaluates both: the contract-only binding spec must not turn a real pass into
    // a block.
    const report = test("UX-07-V03", { annotations: [a("consistency"), a("no_leak")] });
    const entry = find(collectManagementResults({ run, report, cases, capabilities: caps }), "UX-07-V03");
    assert.equal(entry.status, "passed");
  });

  it("a contract-only declaration for a DIFFERENT case never rescues this case", () => {
    const report = test("UX-06-V03", { annotations: [contractOnly({ "UX-06-V02": ["allow_control", "real_query", "typed_gold"] })] });
    const entry = find(collectManagementResults({ run, report, cases, capabilities: caps }), "UX-06-V03");
    assert.equal(entry.status, "failed");
  });
});
