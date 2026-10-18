// B3 reviewer corrections: dynamic secret registry must persist BOTH the
// fingerprint AND the plaintext to a private 0600 file outside the archive.
//
// Previous implementation stored fingerprints only, so the A7 collector could not
// do an exact-substring scan for the leaked secret (a fingerprint is not the
// secret value). The leak-scanner in the same process ALSO missed freshly minted
// passwords when callers used `registerDynamicSecret` without separately tracking
// the plaintext. Both regressions are verified here.

import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { SecurityContext, secretRegistryFileFor, SECRET_REGISTRY_CONTRACT } from "../security/context.mjs";

function makeRun(tmp) {
  const projectDir = path.join(tmp, "project");
  const checkerDir = path.join(tmp, "checker");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(checkerDir, { recursive: true });
  writeFileSync(path.join(checkerDir, "gold.json"), JSON.stringify({ canaries: {}, questions: {} }));
  return {
    runId: "registry-test-0001",
    executionMode: "local",
    caseCatalogDigest: "sha256:test",
    profileDigest: null,
    instance: { baseUrl: "http://127.0.0.1:0", mcpUrl: "http://127.0.0.1:0/mcp", startedBy: "runner" },
    paths: { runDir: tmp, project: projectDir, checker: checkerDir },
    instanceId: "logical"
  };
}

function seedCheckerSecrets(tmp) {
  const secretsDir = path.join(tmp, "secrets");
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(secretsDir, "tokens.json"), JSON.stringify({ e2e_finance: "lucy_e2e_seedtoken0000000000000000000000" }));
  writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "owner", password: "owner-pw" }, operator: { adminId: "operator", password: "operator-pw" } }));
  writeFileSync(path.join(secretsDir, "bootstrap-token"), "bootstrap-tok");
  return secretsDir;
}

describe("B3 dynamic secret registry: BOTH fingerprint and plaintext are persisted to a 0600 file", () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), "lucy-reg-")); });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("registerDynamicSecret persists the plaintext (not only the fingerprint) to dynamic-secrets.json", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx = new SecurityContext({ run, capabilities: {} });
    const plaintext = "lucy_e2e_dynamic0000000000000000000000abc";
    const fp = ctx.registerDynamicSecret(plaintext, "agent:test-1");
    assert.ok(typeof fp === "string" && fp.length === 12);
    // The in-memory leak scanner sees the plaintext.
    assert.ok(ctx.allSecrets.includes(plaintext), "allSecrets contains the freshly minted plaintext");
    // The registry file exists and contains the plaintext.
    const registryFile = secretRegistryFileFor(run);
    assert.ok(existsSync(registryFile), `registry file exists at ${registryFile}`);
    const persisted = JSON.parse(readFileSync(registryFile, "utf8"));
    assert.equal(persisted.length, 1);
    assert.equal(persisted[0].fingerprint, fp);
    assert.equal(persisted[0].value, plaintext, "the plaintext is persisted (not fingerprint-only)");
    // The file is 0600.
    const st = statSync(registryFile);
    assert.ok((st.mode & 0o777) === 0o600, `registry file mode is 0600 (got ${(st.mode & 0o777).toString(8)})`);
    // The file lives under <runDir>/checker/registry/, which is OUTSIDE the archived
    // tree (archive-evidence.mjs archives only <runDir>/results).
    const archivedTreeRoot = path.join(run.paths.runDir, "results");
    const rel = path.relative(archivedTreeRoot, registryFile);
    assert.ok(rel.startsWith("..") || path.isAbsolute(rel), "registry file is NOT inside results/ (archive root)");
  });

  it("registerDynamicSecretWithPlaintext is now equivalent to registerDynamicSecret (plaintext always kept)", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx = new SecurityContext({ run, capabilities: {} });
    const plaintext = "lucy_e2e_other0000000000000000000000def";
    const fp = ctx.registerDynamicSecretWithPlaintext(plaintext, "agent:test-2");
    assert.ok(ctx.allSecrets.includes(plaintext));
    const persisted = JSON.parse(readFileSync(secretRegistryFileFor(run), "utf8"));
    const entry = persisted.find((e) => e.fingerprint === fp);
    assert.ok(entry, "the registry contains an entry with the expected fingerprint");
    assert.equal(entry.value, plaintext);
  });

  it("multiple secrets accumulate in the registry and the A7 collector can match each plaintext AFTER the process ends", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx = new SecurityContext({ run, capabilities: {} });
    const a = "lucy_e2e_secret000000000000000000000aaa";
    const b = "lucy_e2e_secret000000000000000000000bbb";
    ctx.registerDynamicSecret(a, "agent:a");
    ctx.registerDynamicSecret(b, "agent:b");
    // Simulate the A7 collector: process ends, a different code path reads the
    // registry file and scans for an exact substring match.
    const persisted = JSON.parse(readFileSync(secretRegistryFileFor(run), "utf8"));
    assert.equal(persisted.length, 2);
    for (const plaintext of [a, b]) {
      const match = persisted.some((entry) => entry.value === plaintext);
      assert.ok(match, `A7 collector can find plaintext "${plaintext}" via exact-substring match (not hash)`);
    }
    // The leak-scanner in-process also matches each plaintext.
    assert.ok(ctx.allSecrets.includes(a));
    assert.ok(ctx.allSecrets.includes(b));
  });

  it("loading an existing registry on startup rehydrates the in-memory plaintext map", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx1 = new SecurityContext({ run, capabilities: {} });
    ctx1.registerDynamicSecret("lucy_e2e_persist0000000000000000aaa", "agent:p");
    // A fresh SecurityContext for the SAME run picks up the persisted plaintext.
    const ctx2 = new SecurityContext({ run, capabilities: {} });
    assert.ok(ctx2.allSecrets.includes("lucy_e2e_persist0000000000000000aaa"), "in-memory plaintext map is rehydrated from the registry file");
  });

  it("the registry schema published for the A7 collector carries fingerprint + label + createdAt + value", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx = new SecurityContext({ run, capabilities: {} });
    ctx.registerDynamicSecret("lucy_e2e_schema0000000000000000xyz", "agent:schema");
    const persisted = JSON.parse(readFileSync(secretRegistryFileFor(run), "utf8"));
    assert.equal(SECRET_REGISTRY_CONTRACT, "lucy-secret-registry-v1");
    const entry = persisted[0];
    assert.ok(typeof entry.fingerprint === "string" && entry.fingerprint.length === 12);
    assert.ok(typeof entry.label === "string");
    assert.ok(typeof entry.createdAt === "string" && entry.createdAt.endsWith("Z"));
    assert.ok(typeof entry.value === "string");
  });
});

describe("B3 dynamic secret registry: a leaked dynamic secret is detected AFTER the process ends by the A7 collector", () => {
  let tmp;
  beforeEach(() => { tmp = mkdtempSync(path.join(tmpdir(), "lucy-leak-")); });
  afterEach(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("the A7 collector can scan a 'retained' file that contains the plaintext and report a hit", () => {
    const run = makeRun(tmp);
    run.secretsDir = seedCheckerSecrets(tmp);
    const ctx = new SecurityContext({ run, capabilities: {} });
    const plaintext = "lucy_e2e_leak0000000000000000000000ab";
    ctx.registerDynamicSecret(plaintext, "agent:leak-test");

    // Simulate a downstream artifact that captures the plaintext (this would be a
    // REAL leak; the test asserts the A7 collector can catch it from the registry).
    const leaked = { request: "GET /api/auth/status", captured: plaintext };
    const leakedPath = path.join(tmp, "leaked.json");
    writeFileSync(leakedPath, JSON.stringify(leaked, null, 2));

    // Simulate the A7 collector: it reads the registry file, then scans every
    // persisted artifact for an exact-substring match against the plaintext values.
    const persisted = JSON.parse(readFileSync(secretRegistryFileFor(run), "utf8"));
    const leakedText = readFileSync(leakedPath, "utf8");
    const hits = persisted.filter((entry) => leakedText.includes(entry.value));
    assert.equal(hits.length, 1, "A7 collector found the leaked plaintext via the registry (NOT via fingerprint-only)");
    assert.equal(hits[0].value, plaintext);
    // Fingerprint names alone would have missed it; the registry's `value` is what
    // makes the exact-substring check possible.
    assert.notEqual(hits[0].fingerprint, plaintext, "fingerprint != plaintext; a hash-only scan would miss this leak");
  });
});