// P1-6 candidate verification self-proof: the ordering guarantees of the verification channel,
// the refusal paths and the five-state reporting. These tests prove the EXECUTOR, not the
// candidate: without a real candidate image identity and a real backup every RVC acceptance
// entry stays blocked.

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  BLOCK_CATEGORY,
  REASON,
  RVC_STAGES,
  STATUS,
} from "../e2e/run-upgrade.mjs";
import { runCandidateVerification, CANDIDATE_PHASES } from "./verify-candidate.mjs";
import { REPO_ROOT } from "../e2e/lib/common.mjs";

const scratch = () => path.join(REPO_ROOT, "inbox", "upgrade-candidate-selftest", randomUUID());

function completePlan(overrides = {}) {
  const identity = (image) => ({
    image,
    imageDigest: "sha256:digest",
    imageSha256: "sha256:package",
    sourceSha: "a".repeat(40),
    buildInputSha256: "b".repeat(64),
    deploymentConfigVersion: "helm-v1",
    ktxVersion: "0.16.0",
    imageDigestVerified: true,
  });
  return {
    runId: "candidate-selftest",
    deployment: {
      form: "k8s",
      isolated: true,
      disposable: true,
      ownedByThisRun: true,
      ingressReachableFromCustomerNetwork: false,
      namespace: "lucy-verify-selftest",
    },
    identity: { baseline: identity("registry/lucy:old"), candidate: identity("registry/lucy:candidate") },
    backup: { method: "quiesced", containsSecurityStore: true, sha256Verified: true, fileManifestVerified: true, restorePoint: "2026-10-25T00:00:00Z" },
    securitySource: { identified: true, verified: true, fresh: true, sourceId: "controlled-source-1" },
    capabilities: { emptyVolumeStart: true, wholeVolumeRestore: true, securityStateInjection: true, sessionSecretRotation: true },
    structuralBaseline: {
      expectedPaths: [{ path: "webui/config/access.yaml", kind: "file" }],
      structuralChangePaths: [{ path: ".ktx-ui/audit.sqlite", kind: "file" }],
    },
    ...overrides,
  };
}

function fakeAdapter(overrides = {}) {
  const replayEntries = Object.fromEntries(
    ["RVC-01", "RVC-02", "RVC-03", "RVC-04", "RVC-05", "RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-10", "RVC-11"]
      .map((id) => [id, { status: STATUS.PASSED }]),
  );
  return {
    form: "k8s",
    async createEmptyVolume() { return { volumeId: "vol-1", fileCount: 0, seedOnly: false }; },
    async restoreWholeVolume() { return { manifestMatched: true, fileCount: 12 }; },
    async injectSecurityState() { return { applied: true }; },
    async rotateSessionSecret() { return { rotated: true }; },
    async startCandidate() { return { healthy: true, image: "registry/lucy:candidate" }; },
    async inspectStructure() {
      return { paths: { "webui/config/access.yaml": { kind: "file" }, ".ktx-ui/audit.sqlite": { kind: "file" } } };
    },
    async assertBusiness() {
      return {
        "RVC-06": { status: "passed" },
        "RVC-07": { status: "passed" },
        "RVC-08": { status: "passed" },
        "RVC-09": { status: "passed" },
        "RVC-10": { status: "passed" },
        "RVC-11": { status: "passed" },
      };
    },
    async replay() { return { entries: replayEntries, identity: { volumeId: "vol-2", instanceId: "inst-2" } }; },
    async teardown() { return { residual: [] }; },
    ...overrides,
  };
}

/* ------------------------------------------------------------ happy path */

test("a complete verification run produces all thirteen RVC entries as PASSED", async () => {
  const result = await runCandidateVerification(completePlan(), { adapter: fakeAdapter() });
  assert.equal(result.status, STATUS.PASSED);
  assert.equal(result.summary.passed, 13);
  assert.equal(result.summary.total, 13);
  assert.equal(result.releaseEligible, false);
  assert.equal(result.contract, "lucy-upgrade-candidate-verification/v1");
  assert.equal(result.namespace, "RVC");
});

/* ------------------------------------------------------------ E2 ordering */

test("the identity precheck runs before the empty volume is created", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    async createEmptyVolume() { calls.push("createEmptyVolume"); return { volumeId: "vol-1", fileCount: 0 }; },
  });
  const plan = completePlan();
  plan.identity.candidate = { image: "registry/lucy:candidate" };
  const result = await runCandidateVerification(plan, { adapter });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.IDENTITY_INCOMPLETE);
  assert.deepEqual(calls, [], "no volume may be created before the identity precheck passes");
  assert.deepEqual(result.trace, ["preflight"]);
});

test("the unique legal import order is empty volume, whole-volume overwrite, security state, candidate start", async () => {
  const calls = [];
  const wrap = (name, value) => async (...args) => { calls.push(name); return typeof value === "function" ? value(...args) : value; };
  const adapter = fakeAdapter({
    createEmptyVolume: wrap("createEmptyVolume", { volumeId: "vol-1", fileCount: 0, seedOnly: false }),
    restoreWholeVolume: wrap("restoreWholeVolume", { manifestMatched: true, fileCount: 12 }),
    injectSecurityState: wrap("injectSecurityState", { applied: true }),
    rotateSessionSecret: wrap("rotateSessionSecret", { rotated: true }),
    startCandidate: wrap("startCandidate", { healthy: true }),
    inspectStructure: wrap("inspectStructure", { paths: { "webui/config/access.yaml": { kind: "file" }, ".ktx-ui/audit.sqlite": { kind: "file" } } }),
    assertBusiness: wrap("assertBusiness", fakeAdapter().assertBusiness),
    replay: wrap("replay", fakeAdapter().replay),
    teardown: wrap("teardown", { residual: [] }),
  });
  const result = await runCandidateVerification(completePlan(), { adapter });
  assert.equal(result.status, STATUS.PASSED);
  assert.deepEqual(calls, [
    "createEmptyVolume",
    "restoreWholeVolume",
    "injectSecurityState",
    "rotateSessionSecret",
    "startCandidate",
    "inspectStructure",
    "assertBusiness",
    "replay",
    "teardown",
  ]);
  assert.deepEqual(result.trace, CANDIDATE_PHASES.map((phase) => phase.id));
});

/* ------------------------------------------------------------ E3 isolation */

test("a target that is not owned by this run is BLOCKED before anything is created", async () => {
  const calls = [];
  const adapter = fakeAdapter({ async createEmptyVolume() { calls.push("createEmptyVolume"); return { volumeId: "v", fileCount: 0 }; } });
  const plan = completePlan();
  plan.deployment.ownedByThisRun = false;
  const result = await runCandidateVerification(plan, { adapter });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.TARGET_NOT_OWNED_BY_THIS_RUN);
  assert.deepEqual(calls, []);
});

/* ------------------------------------------------------------ E4 refusal paths */

test("a hot backup of a security store is BLOCKED before any volume is created", async () => {
  const calls = [];
  const adapter = fakeAdapter({ async createEmptyVolume() { calls.push("createEmptyVolume"); return { volumeId: "v", fileCount: 0 }; } });
  const plan = completePlan();
  plan.backup = { method: "hot", containsSecurityStore: true };
  const result = await runCandidateVerification(plan, { adapter });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.SECURITY_STORE_REQUIRES_QUIESCED_BACKUP);
  assert.deepEqual(calls, []);
  const rvc01 = result.entries.find((entry) => entry.id === "RVC-01");
  assert.equal(rvc01.status, STATUS.BLOCKED);
});

test("a non-empty volume is FAILED and the restore never happens", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    async createEmptyVolume() { calls.push("createEmptyVolume"); return { volumeId: "vol-1", fileCount: 9 }; },
    async restoreWholeVolume() { calls.push("restoreWholeVolume"); return { manifestMatched: true }; },
  });
  const result = await runCandidateVerification(completePlan(), { adapter });
  assert.equal(result.status, STATUS.FAILED);
  assert.equal(result.stopReason, REASON.VOLUME_NOT_EMPTY);
  assert.deepEqual(calls, ["createEmptyVolume"], "the restore must not run on a non-empty volume");
  const rvc03 = result.entries.find((entry) => entry.id === "RVC-03");
  assert.equal(rvc03.status, STATUS.FAILED);
});

test("a seed-only start is FAILED", async () => {
  const adapter = fakeAdapter({ async createEmptyVolume() { return { volumeId: "vol-1", fileCount: 0, seedOnly: true }; } });
  const result = await runCandidateVerification(completePlan(), { adapter });
  assert.equal(result.status, STATUS.FAILED);
  assert.equal(result.stopReason, REASON.SEED_ONLY_ENABLED);
});

test("a restore whose manifest does not match is FAILED", async () => {
  const adapter = fakeAdapter({ async restoreWholeVolume() { return { manifestMatched: false }; } });
  const result = await runCandidateVerification(completePlan(), { adapter });
  assert.equal(result.status, STATUS.FAILED);
  assert.equal(result.stopReason, REASON.RESTORE_MANIFEST_MISMATCH);
});

/* ------------------------------------------------------------ E5 security state */

test("an unknown security state source makes RVC-10 SKIPPED, never PASSED", async () => {
  // The replay reaches the same conclusion: without a verified security state RVC-10 stays skipped.
  const replayEntries = Object.fromEntries(
    ["RVC-01", "RVC-02", "RVC-03", "RVC-04", "RVC-05", "RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-11"]
      .map((id) => [id, { status: STATUS.PASSED }])
      .concat([["RVC-10", { status: STATUS.SKIPPED }]]),
  );
  const result = await runCandidateVerification(completePlan({ securitySource: null }), {
    adapter: fakeAdapter({ async replay() { return { entries: replayEntries, identity: { volumeId: "vol-2" } }; } }),
  });
  const rvc10 = result.entries.find((entry) => entry.id === "RVC-10");
  assert.equal(rvc10.status, STATUS.SKIPPED);
  assert.equal(rvc10.reason, REASON.SECURITY_STATE_SOURCE_UNKNOWN);
  assert.notEqual(rvc10.status, STATUS.PASSED);
  assert.equal(result.summary.passed, 12, "the security assertion must not be counted as passing");
});

test("without a verified security state the candidate still starts, but the security verdict stays open", async () => {
  const replayEntries = Object.fromEntries(
    ["RVC-01", "RVC-02", "RVC-03", "RVC-04", "RVC-05", "RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-11"]
      .map((id) => [id, { status: STATUS.PASSED }])
      .concat([["RVC-10", { status: STATUS.SKIPPED }]]),
  );
  const result = await runCandidateVerification(completePlan({ securitySource: { identified: true, verified: false, fresh: true } }), {
    adapter: fakeAdapter({ async replay() { return { entries: replayEntries, identity: { volumeId: "vol-2" } }; } }),
  });
  assert.equal(result.status, STATUS.SKIPPED);
  assert.equal(result.stoppedAt, null, "a skipped precondition must not stop the migration checks");
  assert.match(result.trace.join(","), /teardown/);
});

/* ------------------------------------------------------------ E6 structure baseline */

test("a mixed structure state is FAILED and the run does not continue into the business assertions", async () => {
  const calls = [];
  const adapter = fakeAdapter({
    async inspectStructure() {
      calls.push("inspectStructure");
      return { paths: { "webui/config/access.yaml": { kind: "file" }, "semantic-layer/new-template.yaml": { kind: "file" } } };
    },
    async assertBusiness() { calls.push("assertBusiness"); return {}; },
  });
  const result = await runCandidateVerification(completePlan(), { adapter });
  assert.equal(result.status, STATUS.FAILED);
  assert.equal(result.stopReason, REASON.STRUCTURAL_CHANGE_NOT_APPLIED);
  assert.deepEqual(calls, ["inspectStructure"]);
  const rvc05 = result.entries.find((entry) => entry.id === "RVC-05");
  assert.equal(rvc05.status, STATUS.FAILED);
});

test("a candidate that declares no structure baseline cannot be asserted", async () => {
  const plan = completePlan();
  delete plan.structuralBaseline;
  const result = await runCandidateVerification(plan, { adapter: fakeAdapter() });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.STRUCTURE_BASELINE_UNDECLARED);
  assert.equal(result.stopCategory, BLOCK_CATEGORY.DELIVERY);
});

/* ------------------------------------------------------------ E7 replay */

test("a replay that reuses an identity or leaves half-written config is FAILED", async () => {
  const duplicate = await runCandidateVerification(completePlan(), {
    adapter: fakeAdapter({ async replay() { return { entries: Object.fromEntries(["RVC-01", "RVC-02", "RVC-03", "RVC-04", "RVC-05", "RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-10", "RVC-11"].map((id) => [id, { status: STATUS.PASSED }])), identity: { volumeId: "vol-1" } }; } }),
  });
  assert.equal(duplicate.status, STATUS.FAILED);
  assert.equal(duplicate.stopReason, REASON.DUPLICATE_IDENTITY);

  const halfWritten = await runCandidateVerification(completePlan(), {
    adapter: fakeAdapter({ async replay() { return { entries: Object.fromEntries(["RVC-01", "RVC-02", "RVC-03", "RVC-04", "RVC-05", "RVC-06", "RVC-07", "RVC-08", "RVC-09", "RVC-10", "RVC-11"].map((id) => [id, { status: STATUS.PASSED }])), identity: { volumeId: "vol-2" }, halfWrittenConfig: ["webui/config/access.yaml"] }; } }),
  });
  assert.equal(halfWritten.status, STATUS.FAILED);
  assert.equal(halfWritten.stopReason, REASON.HALF_WRITTEN_CONFIG);
});

/* ------------------------------------------------------------ E13 cleanup */

test("an incomplete cleanup is BLOCKED with the residual inventory", async () => {
  const result = await runCandidateVerification(completePlan(), {
    adapter: fakeAdapter({ async teardown() { return { residual: ["pvc/lucy-verify-selftest-0"] }; } }),
  });
  assert.equal(result.status, STATUS.BLOCKED);
  assert.equal(result.stopReason, REASON.CLEANUP_INCOMPLETE);
  const rvc13 = result.entries.find((entry) => entry.id === "RVC-13");
  assert.equal(rvc13.status, STATUS.BLOCKED);
  assert.deepEqual(rvc13.evidence.residual, ["pvc/lucy-verify-selftest-0"]);
});

/* ------------------------------------------------------------ reporting */

test("the result partitions the namespaces and never claims release eligibility", async () => {
  const result = await runCandidateVerification(completePlan(), { adapter: fakeAdapter() });
  assert.equal(result.releaseEligible, false);
  const upgP1 = result.namespaces.find((ns) => ns.contract === "lucy-upgrade-e2e-p1/v1");
  const upgP0 = result.namespaces.find((ns) => ns.contract === "lucy-upgrade-checklist/v1");
  assert.equal(upgP1.producedByThisRun, true);
  assert.equal(upgP0.producedByThisRun, false);
  assert.notEqual(upgP1.source, upgP0.source);
});

test("the RVC stage map covers every acceptance id", () => {
  assert.equal(Object.keys(RVC_STAGES).length, 13);
  assert.equal(RVC_STAGES["RVC-01"], "preflight");
  assert.equal(RVC_STAGES["RVC-12"], "replay");
  assert.equal(RVC_STAGES["RVC-13"], "teardown");
});

test("the CLI writes the P1-6 artifact set and refuses release artifacts", async () => {
  const { main } = await import("./verify-candidate.mjs");
  const dir = scratch();
  try {
    const code = await main(["--run-id", "candidate-selftest-cli", "--out", dir]);
    assert.equal(code, 2, "a blocked delivery must exit with the blocked code");
    for (const name of ["run.json", "backup.json", "restore.json", "assertions.json", "report.md"]) {
      assert.ok(existsSync(path.join(dir, name)), `${name} must be written`);
    }
    assert.equal(existsSync(path.join(dir, "release-readiness.json")), false);
    assert.equal(existsSync(path.join(dir, "ops.json")), false);
    const assertions = JSON.parse(readFileSync(path.join(dir, "assertions.json"), "utf8"));
    assert.equal(assertions.contract, "lucy-upgrade-candidate-verification/v1");
    assert.equal(assertions.entries.length, 13);
    for (const entry of assertions.entries) {
      assert.notEqual(entry.status, STATUS.PASSED, `${entry.id} must not be recorded as passed`);
      assert.ok(entry.reason, `${entry.id} needs a reason`);
    }
    const report = readFileSync(path.join(dir, "report.md"), "utf8");
    assert.match(report, /lucy-upgrade-e2e-p1\/v1/);
    assert.match(report, /lucy-upgrade-checklist\/v1/);
    assert.match(report, /同号不同义|never merged/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
