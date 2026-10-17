import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { REPO_ROOT, EXIT_CODES } from "../lib/common.mjs";
import { loadCatalog } from "../lib/catalog.mjs";
import { scanText } from "../lib/leak-scan.mjs";
import { executionOrder, loadHandlers, missingCapabilities, runSecurity, statusFromAssertions } from "../run-security.mjs";
import { explicitDeny } from "../security/context.mjs";

const { cases } = loadCatalog();
const securityCases = cases.filter((c) => c.runner === "security");

describe("security runner semantics (Spec §6.4, §8.2)", () => {
  it("registers handlers only for catalog security cases, without duplicates", async () => {
    const handlers = await loadHandlers();
    const ids = new Set(securityCases.map((c) => c.id));
    for (const id of Object.keys(handlers)) assert.ok(ids.has(id), `handler ${id} has no security catalog case`);
    assert.ok(Object.keys(handlers).length >= 60, "the implemented set must stay substantial");
  });

  it("a declared assertion that the handler never evaluated fails the case (no vacuous pass)", () => {
    const testCase = { assert: ["deny", "no_leak"] };
    const verdict = statusFromAssertions(testCase, { assertions: [{ token: "deny", passed: true }] });
    assert.equal(verdict.status, "failed");
    assert.match(verdict.detail, /never evaluated: no_leak/);
  });

  it("any failed assertion fails the case; only full evaluation passes", () => {
    const testCase = { assert: ["deny"] };
    assert.equal(statusFromAssertions(testCase, { assertions: [{ token: "deny", passed: false, detail: "HTTP 200" }] }).status, "failed");
    assert.equal(statusFromAssertions(testCase, { assertions: [{ token: "deny", passed: true }, { token: "no_leak", passed: false }] }).status, "failed");
    assert.equal(statusFromAssertions(testCase, { assertions: [{ token: "deny", passed: true }] }).status, "passed");
  });

  it("a server error is never an explicit deny (GATE-01: 500 is not a correct deny)", () => {
    assert.equal(explicitDeny({ status: 500, json: { error: { code: -32003 } } }), false);
    assert.equal(explicitDeny({ status: 503, json: null }), false);
    assert.equal(explicitDeny({ status: 200, json: { error: { code: -32603 } } }), false);
    assert.equal(explicitDeny({ status: 401, json: null }), true);
    assert.equal(explicitDeny({ status: 403, json: null }), true);
    assert.equal(explicitDeny({ status: 200, json: { error: { code: -32003 } } }), true);
  });

  it("blocks (never passes) a case whose capabilities are missing", () => {
    const needsUpstream = securityCases.find((c) => c.requires.includes("ktx-upstream"));
    assert.deepEqual(missingCapabilities(needsUpstream, { "lucy-http": true, "ktx-upstream": false }), ["ktx-upstream"]);
    assert.deepEqual(missingCapabilities({ requires: ["lucy-http"] }, { "lucy-http": true }), []);
  });

  it("runs throttling cases last so one case cannot starve the others", () => {
    const ordered = executionOrder(securityCases).map((c) => c.id);
    assert.equal(ordered.at(-1), "SEC-05-V03");
    assert.ok(ordered.indexOf("SEC-04-V01") < ordered.indexOf("SEC-05-V02"));
  });

  it("dry-run executes nothing and can never produce a publishable status", async () => {
    const run = { runId: "dry-test-0001", executionMode: "local", caseCatalogDigest: "sha256:x", profileDigest: null, paths: { runDir: "/nonexistent" }, instance: {}, db: {} };
    const evidence = await runSecurity({ run, cases, handlers: {}, dryRun: true });
    assert.equal(evidence.status, "dry_run");
    assert.equal(EXIT_CODES[evidence.status], 3);
    assert.ok(evidence.cases.length === securityCases.length && evidence.cases.every((c) => c.status === "dry_run"));
    assert.equal(evidence.summary.passed, 0);
  });

  it("scans for exact credentials and canaries without echoing them", () => {
    const hits = scanText("leak: lucy_e2e_0123456789abcdef0123456789abcdef0123456789abcdef and CANARY-X-1", {
      secrets: ["super-secret-value"],
      forbiddenCanaries: ["CANARY-X-1"]
    });
    assert.ok(hits.some((h) => h.kind === "forbidden-canary"));
    assert.ok(hits.some((h) => h.kind === "lucy-token"));
    assert.ok(!JSON.stringify(hits).includes("CANARY-X-1") && !JSON.stringify(hits).includes("0123456789abcdef0123"));
    assert.deepEqual(scanText("clean text", { secrets: ["super-secret-value"] }), []);
  });

  it("the product exposes no fault-injection route or switch (hooks live only in the test control plane)", () => {
    const serverDir = path.join(REPO_ROOT, "webui", "server");
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(full);
        } else if (/\.(ts|mjs|js)$/.test(entry.name)) files.push(full);
      }
    };
    walk(serverDir);
    const offenders = files.filter((file) => /fault[-_ ]?inject|__fault|\/api\/[a-z/-]*fault|LUCY_FAULT|LUCY_INJECT|chaos/i.test(readFileSync(file, "utf8")));
    assert.deepEqual(offenders.map((f) => path.relative(REPO_ROOT, f)), []);
    const chart = readFileSync(path.join(REPO_ROOT, "deploy/k8s/helm/lucy/templates/_helpers.tpl"), "utf8");
    assert.ok(!/fault[-_]?inject|failpoint|LUCY_FAULT|LUCY_INJECT|chaos/i.test(chart), "the customer Chart must not carry fault switches");
  });
});
