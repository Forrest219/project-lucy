// P1-5 executor self-proof: the five-state machine, the ordering guarantees and the refusal
// paths. These tests prove the EXECUTOR, not the customer upgrade: every UPG acceptance entry
// stays blocked until a real baseline/candidate image identity is delivered.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { test } from "node:test";
import { parse as parseYaml } from "yaml";
import {
  ARTIFACT_NAMES,
  BLOCK_CATEGORY,
  EXISTING_FEATURE_CONTRACT,
  EXISTING_FEATURE_CONTRACT_FILE,
  FORBIDDEN_ARTIFACT_NAMES,
  REASON,
  RVC_STAGES,
  STATUS,
  UPG_STAGES,
  aggregateStatus,
  assertArtifactPolicy,
  compareReplay,
  evaluateBackup,
  evaluateCapabilities,
  evaluateIdentity,
  evaluateIsolation,
  evaluateSecuritySource,
  evaluateStructureBaseline,
  evaluateVolumeStart,
  loadContract,
  loadExistingFeatureContract,
  namespacePartition,
  projectEntries,
  redactText,
  redactValue,
  runUpgradeScenario,
  scanArtifactSecrets,
  summarize,
  writeScenarioArtifacts,
} from "../run-upgrade.mjs";
import { REPO_ROOT } from "../lib/common.mjs";

const scratch = () => path.join(REPO_ROOT, "inbox", "upgrade-e2e-selftest", randomUUID());

function completePlan(overrides = {}) {
  const identity = (image) => ({
    image,
    imageDigest: "sha256:digest",
    imageSha256: "sha256:package",
    sourceSha: "a".repeat(40),
    buildInputSha256: "b".repeat(64),
    deploymentConfigVersion: "compose-v1",
    ktxVersion: "0.16.0",
    imageDigestVerified: true,
  });
  return {
    runId: "selftest",
    deployment: {
      form: "docker",
      isolated: true,
      disposable: true,
      ownedByThisRun: true,
      ingressReachableFromCustomerNetwork: false,
    },
    identity: { baseline: identity("registry/lucy:old"), candidate: identity("registry/lucy:candidate") },
    backup: { method: "quiesced", containsSecurityStore: true, sha256Verified: true, fileManifestVerified: true, restorePoint: "2026-10-25T00:00:00Z" },
    securitySource: { identified: true, verified: true, fresh: true, sourceId: "controlled-source-1" },
    capabilities: { wholeVolumeBackup: true, consistentBackup: true, sessionSecretRotation: true },
    ...overrides,
  };
}

function fakeAdapter(overrides = {}) {
  const base = {
    form: "docker",
    async installBaseline() { return { instanceId: "inst-1" }; },
    async seedAssets() { return { assets: 3 }; },
    async captureBaseline() { return { inventory: ["orders"] }; },
    async preflightCandidate() { return { ok: true }; },
    async backupVolume() { return { method: "quiesced", fileCount: 12 }; },
    async restoreIndependent() { return { manifestMatched: true, instanceId: "inst-2" }; },
    async upgradeInPlace() { return { imageIdentityChanged: true, image: "registry/lucy:candidate" }; },
    async assertContinuity() {
      return { "UPG-04": { status: "passed" }, "UPG-05": { status: "passed" }, "UPG-06": { status: "passed" }, "UPG-07": { status: "passed" } };
    },
    async assertAdmin() {
      return { "UPG-08": { status: "passed" }, "UPG-09": { status: "passed" }, "UPG-10": { status: "passed" } };
    },
    async assertRecovery() {
      const ids = ["UPG-11", "UPG-12", "UPG-13", "UPG-14", "UPG-15"];
      return Object.fromEntries(ids.map((id) => [id, { status: "passed" }]));
    },
    async observeAvailability() { return { status: "passed", evidence: { unavailableWindowMs: 42000 } }; },
  };
  return { ...base, ...overrides };
}

/* ------------------------------------------------------------ contract shape */

test("the P1 contract is independent, non-gating and carries both partitioned namespaces", () => {
  const doc = loadContract();
  assert.equal(doc.kind, "upgrade-e2e-p1-scenarios");
  assert.equal(doc.contract, "lucy-upgrade-e2e-p1/v1");
  assert.equal(doc.releaseEligible, false);
  assert.equal(doc.gate, "none");
  assert.equal(doc.upgradeScenarios.length, 16);
  assert.equal(doc.candidateVerificationScenarios.length, 13);

  const upg = doc.upgradeScenarios.map((item) => item.id);
  const rvc = doc.candidateVerificationScenarios.map((item) => item.id);
  assert.deepEqual(upg, Array.from({ length: 16 }, (_, i) => `UPG-${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(rvc, Array.from({ length: 13 }, (_, i) => `RVC-${String(i + 1).padStart(2, "0")}`));
  assert.equal(new Set([...upg, ...rvc]).size, 29);

  // Every acceptance entry has a legal five-state status and none is claimed as passed.
  for (const item of [...doc.upgradeScenarios, ...doc.candidateVerificationScenarios]) {
    assert.ok(Object.values(STATUS).includes(item.status), `${item.id} has an illegal status ${item.status}`);
    assert.notEqual(item.status, STATUS.PASSED, `${item.id} must not be recorded as PASSED before delivery`);
    assert.ok(item.reason && item.category, `${item.id} needs a structured reason`);
  }
});

test("the contract stages match the executor stage maps", () => {
  const doc = loadContract();
  for (const item of doc.upgradeScenarios) assert.equal(item.stage, UPG_STAGES[item.id], `${item.id} stage drift`);
  for (const item of doc.candidateVerificationScenarios) assert.equal(item.stage, RVC_STAGES[item.id], `${item.id} stage drift`);
});

test("the P0 feature namespace is untouched and the two UPG namespaces stay separated", () => {
  const existing = loadExistingFeatureContract();
  assert.equal(existing.kind, "upgrade-feature-coverage");
  assert.equal(existing.features.length, 14);
  assert.equal(existing.releaseEligible, false);

  const doc = loadContract();
  const p0Titles = new Set(existing.features.map((feature) => feature.title));
  const p1Titles = doc.upgradeScenarios.map((item) => item.title);
  // Same numbers, different meaning: no P1 scenario may reuse a P0 feature title.
  for (const title of p1Titles) assert.equal(p0Titles.has(title), false, `title collision: ${title}`);

  const p1 = doc.namespaces.find((ns) => ns.contract === "lucy-upgrade-e2e-p1/v1");
  const p0 = doc.namespaces.find((ns) => ns.contract === EXISTING_FEATURE_CONTRACT);
  assert.equal(p1.producedByThisContract, true);
  assert.equal(p0.producedByThisContract, false);
  assert.equal(p0.source, EXISTING_FEATURE_CONTRACT_FILE);
  assert.match(p0.note, /同号不同义/);
});

test("the result document partitions the namespaces and marks who produced what", () => {
  const partition = namespacePartition();
  assert.equal(partition.length, 3);
  const upgP1 = partition.find((ns) => ns.contract === "lucy-upgrade-e2e-p1/v1");
  const upgP0 = partition.find((ns) => ns.contract === EXISTING_FEATURE_CONTRACT);
  assert.equal(upgP1.producedByThisRun, true);
  assert.equal(upgP0.producedByThisRun, false);
  assert.notEqual(upgP1.source, upgP0.source);
});

/* ------------------------------------------------------------ E1 five states */

test("only PASSED counts as passing; BLOCKED, UNIMPLEMENTED and SKIPPED never do", () => {
  assert.equal(aggregateStatus([STATUS.PASSED, STATUS.BLOCKED]), STATUS.BLOCKED);
  assert.equal(aggregateStatus([STATUS.PASSED, STATUS.UNIMPLEMENTED]), STATUS.UNIMPLEMENTED);
  assert.equal(aggregateStatus([STATUS.PASSED, STATUS.SKIPPED]), STATUS.SKIPPED);
  assert.equal(aggregateStatus([STATUS.BLOCKED, STATUS.FAILED]), STATUS.FAILED);
  assert.equal(aggregateStatus([STATUS.PASSED]), STATUS.PASSED);

  const summary = summarize([
    { status: STATUS.PASSED },
    { status: STATUS.BLOCKED },
    { status: STATUS.FAILED },
    { status: STATUS.UNIMPLEMENTED },
    { status: STATUS.SKIPPED },
  ]);
  assert.equal(summary.passed, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.failed, 1);
  assert.equal(summary.unimplemented, 1);
  assert.equal(summary.skipped, 1);
  assert.equal(summary.total, 5);
  assert.equal(summary.passing, 1);
});

test("a scenario with a complete identity and a working adapter can reach PASSED", async () => {
  const result = await runUpgradeScenario(completePlan(), { adapter: fakeAdapter() });
  assert.equal(result.status, STATUS.PASSED);
  assert.equal(result.summary.passed, 16);
  assert.equal(result.summary.total, 16);
  assert.equal(result.releaseEligible, false);
  assert.deepEqual(result.trace, ["identity", "baseline", "backup", "upgrade", "continuity", "admin", "recovery", "availability"]);
});

/* ------------------------------------------------------------ E2 identity first */

test("an incomplete identity stops the run BEFORE any environment mutation", async () => {
  const mutations = [];
  const adapter = fakeAdapter({
    async installBaseline() { mutations.push("installBaseline"); return { instanceId: "inst-1" }; },
    async backupVolume() { mutations.push("backupVolume"); return {}; },
    async upgradeInPlace() { mutations.push("upgradeInPlace"); return {}; },
  });
  const plan = completePlan();
  plan.identity.candidate = { image: "registry/lucy:candidate" };

  const result = await runUpgradeScenario(plan, { adapter });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stoppedAt, "identity");
  assert.equal(result.stopReason, REASON.IDENTITY_INCOMPLETE);
  assert.equal(result.stopReason, "IDENTITY_INCOMPLETE");
  assert.deepEqual(mutations, [], "no environment may be touched before the identity precheck passes");
  assert.equal(result.trace.length, 1, "only the identity phase may run");
  for (const entry of result.entries) {
    assert.equal(entry.status, STATUS.BLOCKED);
    assert.equal(entry.blockedBy, "identity");
  }
});

test("an unverified image digest is BLOCKED, not PASSED", async () => {
  const plan = completePlan();
  plan.identity.candidate.imageDigestVerified = false;
  const result = await runUpgradeScenario(plan, { adapter: fakeAdapter() });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.IDENTITY_NOT_VERIFIED);
});

test("the identity evaluator names every missing field on both ends", () => {
  const verdict = evaluateIdentity({ baseline: { image: "x" }, candidate: {} });
  assert.equal(verdict.status, STATUS.BLOCKED);
  assert.equal(verdict.reason, REASON.IDENTITY_INCOMPLETE);
  assert.equal(verdict.category, BLOCK_CATEGORY.DELIVERY);
  assert.ok(verdict.missing.includes("baseline.imageDigest"));
  assert.ok(verdict.missing.includes("candidate.sourceSha"));
});

/* ------------------------------------------------------------ E3 isolation */

test("a target that is not owned by this run is BLOCKED before any mutation", async () => {
  const plan = completePlan();
  plan.deployment.ownedByThisRun = false;
  const result = await runUpgradeScenario(plan, { adapter: fakeAdapter() });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.TARGET_NOT_OWNED_BY_THIS_RUN);
  assert.equal(result.trace.length, 1);
});

test("isolation evaluation rejects a customer-reachable ingress", () => {
  const verdict = evaluateIsolation({ isolated: true, disposable: true, ownedByThisRun: true, ingressReachableFromCustomerNetwork: true });
  assert.equal(verdict.status, STATUS.BLOCKED);
  assert.equal(verdict.reason, REASON.CUSTOMER_NETWORK_REACHABLE);
  const ok = evaluateIsolation({ isolated: true, disposable: true, ownedByThisRun: true, ingressReachableFromCustomerNetwork: false });
  assert.equal(ok.status, STATUS.PASSED);
});

/* ------------------------------------------------------------ E4 backup / volume */

test("a hot backup is refused, and a hot backup of a security store has its own reason code", () => {
  const hot = evaluateBackup({ method: "hot", containsSecurityStore: false });
  assert.equal(hot.status, STATUS.BLOCKED);
  assert.equal(hot.reason, REASON.BACKUP_METHOD_NOT_CONSISTENT);

  const hotWithStore = evaluateBackup({ method: "hot", containsSecurityStore: true });
  assert.equal(hotWithStore.status, STATUS.BLOCKED);
  assert.equal(hotWithStore.reason, REASON.SECURITY_STORE_REQUIRES_QUIESCED_BACKUP);

  const unknown = evaluateBackup({ method: "unknown" });
  assert.equal(unknown.reason, REASON.BACKUP_METHOD_UNKNOWN);

  const quiesced = evaluateBackup({ method: "quiesced", containsSecurityStore: true, sha256Verified: true, fileManifestVerified: true });
  assert.equal(quiesced.status, STATUS.PASSED);
});

test("a backup without a verified digest or manifest is BLOCKED", () => {
  assert.equal(evaluateBackup({ method: "quiesced", sha256Verified: false, fileManifestVerified: true }).reason, REASON.BACKUP_SHA256_UNVERIFIED);
  assert.equal(evaluateBackup({ method: "quiesced", sha256Verified: true, fileManifestVerified: false }).reason, REASON.BACKUP_MANIFEST_UNVERIFIED);
});

test("a non-empty volume is FAILED and a seed-only start is FAILED, not a warning", () => {
  assert.equal(evaluateVolumeStart({ fileCount: 0 }).status, STATUS.PASSED);
  const nonEmpty = evaluateVolumeStart({ fileCount: 12 });
  assert.equal(nonEmpty.status, STATUS.FAILED);
  assert.equal(nonEmpty.reason, REASON.VOLUME_NOT_EMPTY);
  const seeded = evaluateVolumeStart({ fileCount: 0, seedOnly: true });
  assert.equal(seeded.status, STATUS.FAILED);
  assert.equal(seeded.reason, REASON.SEED_ONLY_ENABLED);
});

/* ------------------------------------------------------------ E5 security state */

test("an unknown security state source makes the security assertions SKIPPED, never PASSED", async () => {
  const plan = completePlan({ securitySource: null });
  const result = await runUpgradeScenario(plan, { adapter: fakeAdapter() });
  const upg05 = result.entries.find((entry) => entry.id === "UPG-05");
  assert.equal(upg05.status, STATUS.SKIPPED);
  assert.equal(upg05.reason, REASON.SECURITY_STATE_SOURCE_UNKNOWN);
  assert.notEqual(upg05.status, STATUS.PASSED);
  const upg13 = result.entries.find((entry) => entry.id === "UPG-13");
  assert.equal(upg13.status, STATUS.SKIPPED);
  assert.equal(result.summary.passed, 14, "the security assertions must not be counted as passing");
  assert.equal(result.status, STATUS.SKIPPED, "a skipped precondition is not a passing run");
});

test("security source verdicts distinguish unknown, unverified and stale", () => {
  assert.equal(evaluateSecuritySource(null).reason, REASON.SECURITY_STATE_SOURCE_UNKNOWN);
  assert.equal(evaluateSecuritySource({ identified: true, verified: false, fresh: true }).reason, REASON.SECURITY_STATE_NOT_VERIFIED);
  assert.equal(evaluateSecuritySource({ identified: true, verified: true, fresh: false }).reason, REASON.SECURITY_STATE_STALE);
  const ok = evaluateSecuritySource({ identified: true, verified: true, fresh: true, sourceId: "s1" });
  assert.equal(ok.enabled, true);
  assert.equal(ok.status, STATUS.PASSED);
});

/* ------------------------------------------------------------ E6 structure baseline */

test("a mixed structure state is FAILED and is never downgraded", () => {
  const verdict = evaluateStructureBaseline({
    expectedPaths: [{ path: "webui/config/access.yaml", kind: "file" }],
    structuralChangePaths: [{ path: ".ktx-ui/audit.sqlite", kind: "file" }],
    actual: {
      "webui/config/access.yaml": { kind: "file" },
      "semantic-layer/new.yaml": { kind: "file" },
    },
  });
  assert.equal(verdict.status, STATUS.FAILED);
  assert.equal(verdict.reason, REASON.STRUCTURAL_CHANGE_NOT_APPLIED);
  assert.ok(verdict.detail.mismatches.length >= 1);
});

test("a residual old-version path is FAILED, not a warning", () => {
  const verdict = evaluateStructureBaseline({
    expectedPaths: [{ path: "webui/config/old.yaml", expected: "absent" }],
    structuralChangePaths: [],
    actual: { "webui/config/old.yaml": { kind: "file" } },
  });
  assert.equal(verdict.status, STATUS.FAILED);
  assert.equal(verdict.reason, REASON.STRUCTURE_RESIDUAL_PRESENT);
});

/* ------------------------------------------------------------ E7 replay */

test("a replay with the same conclusions and a fresh identity passes", () => {
  const entries = [{ id: "RVC-01", status: STATUS.PASSED }, { id: "RVC-02", status: STATUS.PASSED }];
  const verdict = compareReplay(
    { entries, identity: { volumeId: "vol-a" } },
    { entries, identity: { volumeId: "vol-b" } },
  );
  assert.equal(verdict.status, STATUS.PASSED);
});

test("a replay that reuses an identity or leaves half-written config is FAILED", () => {
  const entries = [{ id: "RVC-01", status: STATUS.PASSED }];
  const duplicate = compareReplay(
    { entries, identity: { volumeId: "vol-a" } },
    { entries, identity: { volumeId: "vol-a" } },
  );
  assert.equal(duplicate.status, STATUS.FAILED);
  assert.equal(duplicate.reason, REASON.DUPLICATE_IDENTITY);

  const halfWritten = compareReplay(
    { entries, identity: { volumeId: "vol-a" } },
    { entries, identity: { volumeId: "vol-b" }, halfWrittenConfig: ["webui/config/access.yaml"] },
  );
  assert.equal(halfWritten.status, STATUS.FAILED);
  assert.equal(halfWritten.reason, REASON.HALF_WRITTEN_CONFIG);

  const mismatch = compareReplay(
    { entries, identity: { volumeId: "vol-a" } },
    { entries: [{ id: "RVC-01", status: STATUS.FAILED }], identity: { volumeId: "vol-b" } },
  );
  assert.equal(mismatch.status, STATUS.FAILED);
  assert.equal(mismatch.reason, REASON.REPLAY_CONCLUSION_MISMATCH);
});

/* ------------------------------------------------------------ E8 artifacts */

test("artifacts are written, forbidden release artifacts are refused, and secrets are redacted", () => {
  const dir = scratch();
  try {
    const written = writeScenarioArtifacts(dir, {
      "run.json": { runId: "r1", token: "super-secret-token-value" },
      "assertions.json": { entries: [] },
      "report.md": "# report\nsuper-secret-token-value\n",
    }, { secrets: ["super-secret-token-value"] });
    assert.deepEqual(written.written.sort(), ["assertions.json", "report.md", "run.json"]);
    assert.ok(!readFileSync(path.join(dir, "run.json"), "utf8").includes("super-secret-token-value"));
    assert.ok(!readFileSync(path.join(dir, "report.md"), "utf8").includes("super-secret-token-value"));
    assert.equal(assertArtifactPolicy(dir).status, STATUS.PASSED);

    // A planted release artifact must be detected.
    writeFileSync(path.join(dir, "release-readiness.json"), "{}\n");
    const policy = assertArtifactPolicy(dir);
    assert.equal(policy.status, STATUS.FAILED);
    assert.ok(policy.hits.includes("release-readiness.json"));

    assert.throws(() => writeScenarioArtifacts(dir, { "ops.json": {} }), /forbidden artifact/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the artifact policy knows the forbidden names and the secret scanner finds leaks", () => {
  assert.ok(FORBIDDEN_ARTIFACT_NAMES.includes("release-readiness.json"));
  assert.ok(FORBIDDEN_ARTIFACT_NAMES.includes("ops.json"));
  assert.ok(ARTIFACT_NAMES.includes("assertions.json"));
  assert.ok(ARTIFACT_NAMES.includes("report.md"));
  assert.equal(redactText("value=abcdefgh", ["abcdefgh"]), "value=***REDACTED***");
  assert.equal(redactValue({ password: "hunter2" }, []).password, "***REDACTED***");
  const dir = scratch();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "leak.json"), JSON.stringify({ note: "abcdefghijkl" }));
    const scan = scanArtifactSecrets(dir, ["abcdefghijkl"]);
    assert.equal(scan.status, STATUS.FAILED);
    assert.ok(scan.hits.includes("leak.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------ E9 refusal paths */

test("every refusal path has a stable reason code", () => {
  const expected = {
    IDENTITY_INCOMPLETE: "IDENTITY_INCOMPLETE",
    IDENTITY_NOT_VERIFIED: "IDENTITY_NOT_VERIFIED",
    DEPLOYMENT_NOT_ISOLATED: "DEPLOYMENT_NOT_ISOLATED",
    TARGET_NOT_DISPOSABLE: "TARGET_NOT_DISPOSABLE",
    TARGET_NOT_OWNED_BY_THIS_RUN: "TARGET_NOT_OWNED_BY_THIS_RUN",
    CUSTOMER_NETWORK_REACHABLE: "CUSTOMER_NETWORK_REACHABLE",
    BACKUP_METHOD_UNKNOWN: "BACKUP_METHOD_UNKNOWN",
    BACKUP_METHOD_NOT_CONSISTENT: "BACKUP_METHOD_NOT_CONSISTENT",
    SECURITY_STORE_REQUIRES_QUIESCED_BACKUP: "SECURITY_STORE_REQUIRES_QUIESCED_BACKUP",
    VOLUME_NOT_EMPTY: "VOLUME_NOT_EMPTY",
    SEED_ONLY_ENABLED: "SEED_ONLY_ENABLED",
    SECURITY_STATE_SOURCE_UNKNOWN: "SECURITY_STATE_SOURCE_UNKNOWN",
    STRUCTURE_PATH_MISSING: "STRUCTURE_PATH_MISSING",
    STRUCTURE_RESIDUAL_PRESENT: "STRUCTURE_RESIDUAL_PRESENT",
    STRUCTURAL_CHANGE_NOT_APPLIED: "STRUCTURAL_CHANGE_NOT_APPLIED",
    STRUCTURE_FINGERPRINT_MISMATCH: "STRUCTURE_FINGERPRINT_MISMATCH",
    STRUCTURE_UNKNOWN_PATH: "STRUCTURE_UNKNOWN_PATH",
    REPLAY_CONCLUSION_MISMATCH: "REPLAY_CONCLUSION_MISMATCH",
    DUPLICATE_IDENTITY: "DUPLICATE_IDENTITY",
    HALF_WRITTEN_CONFIG: "HALF_WRITTEN_CONFIG",
    MISSING_ADAPTER: "MISSING_ADAPTER",
    MISSING_IMPLEMENTATION: "MISSING_IMPLEMENTATION",
    MISSING_CAPABILITY: "MISSING_CAPABILITY",
  };
  for (const [key, value] of Object.entries(expected)) assert.equal(REASON[key], value);
});

test("a missing adapter is UNIMPLEMENTED and a missing capability is UNIMPLEMENTED, both with their own code", async () => {
  const noAdapter = await runUpgradeScenario(completePlan(), { adapter: null });
  assert.equal(noAdapter.status, STATUS.UNIMPLEMENTED);
  assert.equal(noAdapter.stopReason, REASON.MISSING_ADAPTER);
  assert.equal(noAdapter.stopCategory, BLOCK_CATEGORY.IMPLEMENTATION);

  const plan = completePlan();
  plan.capabilities = { wholeVolumeBackup: true };
  const noCapability = await runUpgradeScenario(plan, { adapter: fakeAdapter() });
  assert.equal(noCapability.status, STATUS.UNIMPLEMENTED);
  assert.equal(noCapability.stopReason, REASON.MISSING_CAPABILITY);
  assert.equal(noCapability.stopCategory, BLOCK_CATEGORY.CAPABILITY);

  const verdict = evaluateCapabilities({ wholeVolumeBackup: true }, ["wholeVolumeBackup", "consistentBackup"]);
  assert.equal(verdict.status, STATUS.UNIMPLEMENTED);
  assert.deepEqual(verdict.missing, ["consistentBackup"]);
});

test("an adapter stage that is not implemented is UNIMPLEMENTED, not PASSED", async () => {
  const adapter = fakeAdapter();
  delete adapter.assertRecovery;
  const result = await runUpgradeScenario(completePlan(), { adapter });
  assert.equal(result.status, STATUS.UNIMPLEMENTED);
  assert.equal(result.stopReason, REASON.MISSING_IMPLEMENTATION);
  const upg14 = result.entries.find((entry) => entry.id === "UPG-14");
  assert.equal(upg14.status, STATUS.UNIMPLEMENTED);
});

test("entries that were never reached keep the blocking status and name the blocking phase", () => {
  const entries = projectEntries(UPG_STAGES, [], {
    stoppedAt: "identity",
    stopStatus: STATUS.BLOCKED,
    stopReason: REASON.IDENTITY_INCOMPLETE,
    stopCategory: BLOCK_CATEGORY.DELIVERY,
  });
  assert.equal(entries.length, 16);
  for (const entry of entries) {
    assert.equal(entry.status, STATUS.BLOCKED);
    assert.equal(entry.blockedBy, "identity");
    assert.equal(entry.reason, REASON.IDENTITY_INCOMPLETE);
  }
});

test("the executor never writes a release artifact and never claims release eligibility", async () => {
  const result = await runUpgradeScenario(completePlan(), { adapter: fakeAdapter() });
  assert.equal(result.releaseEligible, false);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("release-readiness"), false);
  assert.equal(serialized.includes("ops.json"), false);
});

test("the CLI writes the P1-5 artifact set and reports the delivery block", async () => {
  const { main } = await import("../run-upgrade.mjs");
  const dir = scratch();
  try {
    const code = await main(["--run-id", "upgrade-p1-selftest-cli", "--out", dir]);
    assert.equal(code, 2, "a blocked delivery must exit with the blocked code");
    for (const name of ARTIFACT_NAMES) {
      assert.ok(existsSync(path.join(dir, name)), `${name} must be written`);
    }
    assert.equal(existsSync(path.join(dir, "release-readiness.json")), false);
    assert.equal(existsSync(path.join(dir, "ops.json")), false);
    const assertions = JSON.parse(readFileSync(path.join(dir, "assertions.json"), "utf8"));
    assert.equal(assertions.contract, "lucy-upgrade-e2e-p1/v1");
    assert.equal(assertions.entries.length, 16);
    for (const entry of assertions.entries) {
      assert.notEqual(entry.status, STATUS.PASSED, `${entry.id} must not be recorded as passed`);
      assert.equal(entry.reason, REASON.IDENTITY_INCOMPLETE);
      assert.equal(entry.category, BLOCK_CATEGORY.DELIVERY);
    }
    const report = readFileSync(path.join(dir, "report.md"), "utf8");
    assert.match(report, /lucy-upgrade-e2e-p1\/v1/);
    assert.match(report, /lucy-upgrade-checklist\/v1/);
    assert.match(report, /never merged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
