import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  PACK_ID,
  REGIONS,
  REGISTRY,
  idsForPhase,
  assertRegistryComplete,
  resolveFixtureRoot,
  resolveRowPolicyDbContract,
} from "../lib/row-policy-pack.mjs";
import { ROW25_EXECUTION_IDS } from "../lib/access-v025.mjs";
import { PrepareError, prepareEnvironment } from "../prepare-environment.mjs";
import { READONLY_GOLD_CONTRACT } from "../../../examples/row-policy-e2e/gold/compute-readonly-gold.mjs";

test("regions are live RDS Chinese values", () => {
  assert.equal(REGIONS.A, "华东");
  assert.equal(REGIONS.B, "西南");
});

test("every ROW25 id has exactly one registry owner", () => {
  assertRegistryComplete();
  for (const id of ROW25_EXECUTION_IDS) {
    const hits = REGISTRY.filter((r) => r.executionId === id);
    assert.equal(hits.length, 1, id);
  }
});

test("phase-off includes V18 and BY-09; phase-on includes V08", () => {
  const off = new Set(idsForPhase("off"));
  const on = new Set(idsForPhase("on"));
  assert.ok(off.has("ROW25-V18"));
  assert.ok(off.has("BY-09"));
  assert.equal(on.has("BY-09"), false);
  assert.ok(on.has("BY-01"));
  assert.ok(on.has("BY-10"));
  assert.ok(on.has("ROW25-V08"));
});

test("every registry ownerSymbol is bound and contains its execution id", () => {
  for (const entry of REGISTRY) {
    assert.notEqual(entry.ownerSymbol, "TODO", entry.executionId);
    assert.equal(typeof entry.ownerSymbol, "string", entry.executionId);
    assert.ok(entry.ownerSymbol.includes(entry.executionId), entry.executionId);
  }
  const by09 = REGISTRY.find((entry) => entry.executionId === "BY-09");
  assert.equal(by09.phase, "off");
  assert.equal(by09.catalogId, "SEC-11-BY09");
  assert.equal(by09.ownerFile, "scripts/e2e/security/row-policy-cases.mjs");
  assert.match(by09.ownerSymbol, /row_policy_upstream_unproven/);
});

test("registry does not use East or West region literals", () => {
  const serialized = JSON.stringify(REGISTRY);
  assert.ok(!serialized.includes('"East"'), "must not contain literal East");
  assert.ok(!serialized.includes('"West"'), "must not contain literal West");
  for (const entry of REGISTRY) {
    if (entry.expectation !== undefined) {
      assert.ok(!/\bEast\b/.test(entry.expectation), entry.executionId);
      assert.ok(!/\bWest\b/.test(entry.expectation), entry.executionId);
    }
  }
});

test("resolveFixtureRoot(row-policy) ends with row-policy-e2e", () => {
  const root = resolveFixtureRoot("row-policy");
  assert.ok(root.endsWith(`${path.sep}examples${path.sep}row-policy-e2e`), root);
  assert.equal(resolveFixtureRoot(PACK_ID), root);
});

test("resolveFixtureRoot defaults to security-e2e", () => {
  assert.ok(resolveFixtureRoot().endsWith(`${path.sep}examples${path.sep}security-e2e`));
  assert.ok(resolveFixtureRoot("security").endsWith(`${path.sep}examples${path.sep}security-e2e`));
});

test("resolveFixtureRoot rejects unknown pack names", () => {
  const expected = `e2e pack must be "security" or "${PACK_ID}", got "typo-pack"`;
  assert.throws(() => resolveFixtureRoot("typo-pack"), { message: expected });
});

test("prepareEnvironment rejects unknown pack with PrepareError", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "lucy-e2e-rp-pack-"));
  try {
    await assert.rejects(
      prepareEnvironment({
        runId: "local-rp-bad-pack",
        mode: "local",
        runRoot,
        pack: "not-a-real-pack",
      }),
      (error) =>
        error instanceof PrepareError &&
        error.message === `e2e pack must be "security" or "${PACK_ID}", got "not-a-real-pack"`
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("row-policy pack rejects apply-db as RDS read-only", () => {
  assert.throws(
    () => resolveRowPolicyDbContract({ applyDb: true }),
    { message: "row-policy pack is RDS read-only" }
  );
});

test("row-policy db defaults point at RDS and honor LUCY_ROW_POLICY_DB_HOST", () => {
  const defaults = resolveRowPolicyDbContract({});
  assert.equal(defaults.host, "rm-bp1q2ui29c6268t8wro.mysql.rds.aliyuncs.com");
  assert.equal(defaults.port, 3306);
  assert.equal(defaults.readerRole, "cw_rds_bot");
  const fromEnv = resolveRowPolicyDbContract({ env: { LUCY_ROW_POLICY_DB_HOST: "127.0.0.1" } });
  assert.equal(fromEnv.host, "127.0.0.1");
  const explicit = resolveRowPolicyDbContract({
    dbHost: "db.example.test",
    dbPort: 13306,
    dbReaderRole: "reader_override",
    env: { LUCY_ROW_POLICY_DB_HOST: "127.0.0.1" }
  });
  assert.equal(explicit.host, "db.example.test");
  assert.equal(explicit.port, 13306);
  assert.equal(explicit.readerRole, "reader_override");
});

test("prepareEnvironment throws PrepareError when pack=row-policy and applyDb", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "lucy-e2e-rp-apply-"));
  try {
    await assert.rejects(
      prepareEnvironment({
        runId: "local-rp-apply-reject",
        mode: "local",
        runRoot,
        pack: "row-policy",
        applyDb: true
      }),
      (error) => error instanceof PrepareError && error.message === "row-policy pack is RDS read-only"
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("prepareEnvironment pack=row-policy writes checker/gold.json with RDS readonly contract", async () => {
  const runRoot = mkdtempSync(path.join(os.tmpdir(), "lucy-e2e-rp-gold-"));
  try {
    // Harness / CI must not require private `.ktx/secrets` or a live RDS probe.
    // Inject a missing password source so prepare still writes structural gold.
    const { run } = await prepareEnvironment({
      runId: "local-rp-gold-write",
      mode: "local",
      runRoot,
      pack: "row-policy",
      rowPolicyPasswordSource: path.join(runRoot, "__missing__", "mysql-aliyun-password")
    });
    const goldPath = path.join(run.paths.checker, "gold.json");
    assert.ok(existsSync(goldPath), "gold.json must exist for SecurityContext");
    const gold = JSON.parse(readFileSync(goldPath, "utf8"));
    assert.equal(gold.contract, READONLY_GOLD_CONTRACT);
    assert.ok(gold.assertShape?.eastOnly?.includes(REGIONS.A));
    assert.deepEqual(gold.canaries, {});
    assert.equal(run.db.dataPlane, "rds-mysql-readonly");
    assert.equal(run.db.readonlyProven, false);
    assert.match(
      String(run.db.readonlyProvenReason ?? ""),
      /password source missing/
    );
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});
