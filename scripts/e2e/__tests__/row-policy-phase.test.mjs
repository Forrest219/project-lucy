import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  FORCED_PREDICATE_PROVEN_ENV,
  applyProvenAndRestart,
  collectPhaseStats,
  defaultNotRunRows,
  phaseCommands,
  phaseEvidenceDir,
  setForcedPredicateProven,
  summarizeBRun
} from "../lib/row-policy-phase.mjs";
import { RDS_MYSQL_READONLY_DATAPLANE } from "../lib/db-capability.mjs";
import { PACK_ID, idsForPhase } from "../lib/row-policy-pack.mjs";
import { collectExecutedRows, runRowPolicyB } from "../run-row-policy-b.mjs";

test("B pass requires both phases green and no blocking blocked", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 0 },
    phaseOn: { failed: 0, blockedBlocking: 0 },
    registryMissing: []
  });
  assert.equal(r.passed, true);
});

test("blockedBlocking prevents B pass", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 1 },
    phaseOn: { failed: 0, blockedBlocking: 0 },
    registryMissing: []
  });
  assert.equal(r.passed, false);
});

test("phase-on failed prevents B pass", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 0 },
    phaseOn: { failed: 1, blockedBlocking: 0 },
    registryMissing: []
  });
  assert.equal(r.passed, false);
});

test("registryMissing prevents B pass", () => {
  const r = summarizeBRun({
    phaseOff: { failed: 0, blockedBlocking: 0 },
    phaseOn: { failed: 0, blockedBlocking: 0 },
    registryMissing: ["ROW25-V18"]
  });
  assert.equal(r.passed, false);
  assert.deepEqual(r.registryMissing, ["ROW25-V18"]);
});

test("collectPhaseStats treats blocked and not_run as blocking", () => {
  const expected = ["A", "B", "C", "D"];
  const stats = collectPhaseStats(
    [
      { executionId: "A", status: "passed" },
      { executionId: "B", status: "failed" },
      { executionId: "C", status: "blocked" }
    ],
    expected
  );
  assert.equal(stats.failed, 1);
  assert.equal(stats.blockedBlocking, 1);
  assert.deepEqual(stats.registryMissing, ["D"]);
});

test("collectPhaseStats counts non-zero management or security exit as failed", () => {
  const allPassed = [{ executionId: "A", status: "passed" }];
  assert.equal(collectPhaseStats(allPassed, ["A"], { management: 1, security: 0 }).failed, 1);
  assert.equal(collectPhaseStats(allPassed, ["A"], { management: 0, security: 2 }).failed, 1);
  assert.equal(collectPhaseStats(allPassed, ["A"], { management: 0, security: 0 }).failed, 0);
});

test("setForcedPredicateProven writes only run instance env and requires restart", () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), "lucy-rp-phase-"));
  try {
    writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
      contract: "lucy-e2e-run-v1",
      instance: { env: { LUCY_DEPLOYMENT_MODE: "customer" } }
    }, null, 2)}\n`);
    const on = setForcedPredicateProven(runDir, true);
    assert.equal(on.restartRequired, true);
    assert.equal(on.envValue, "1");
    const enabled = JSON.parse(readFileSync(path.join(runDir, "run.json"), "utf8"));
    assert.equal(enabled.instance.env[FORCED_PREDICATE_PROVEN_ENV], "1");
    assert.equal(enabled.instance.env.LUCY_DEPLOYMENT_MODE, "customer");

    const off = setForcedPredicateProven(runDir, false);
    assert.equal(off.envValue, null);
    const disabled = JSON.parse(readFileSync(path.join(runDir, "run.json"), "utf8"));
    assert.equal(Object.hasOwn(disabled.instance.env, FORCED_PREDICATE_PROVEN_ENV), false);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("setForcedPredicateProven never writes outside the run directory", () => {
  const parent = mkdtempSync(path.join(os.tmpdir(), "lucy-rp-phase-parent-"));
  const runDir = path.join(parent, "run");
  const compose = path.join(parent, "docker-compose.yml");
  mkdirSync(runDir);
  writeFileSync(compose, "services: {}\n");
  writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
    contract: "lucy-e2e-run-v1",
    instance: { env: {} }
  }, null, 2)}\n`);
  try {
    const before = readFileSync(compose, "utf8");
    setForcedPredicateProven(runDir, true);
    assert.equal(readFileSync(compose, "utf8"), before);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test("phaseCommands document management and security follow-on for a phase", () => {
  const runJson = "/tmp/run.json";
  const off = phaseCommands(runJson, "off");
  assert.ok(off.management.includes("run-management.mjs"));
  assert.ok(off.management.includes(runJson));
  assert.ok(off.security.includes("run-security.mjs"));
  assert.ok(off.security.includes("SEC-11-BY09"));
  const on = phaseCommands(runJson, "on");
  assert.ok(on.security.includes("SEC-11-BY01"));
  assert.ok(!on.security.includes("SEC-11-BY09"));
});

test("phaseEvidenceDir is evidence/phase-<off|on> under the run", () => {
  assert.equal(phaseEvidenceDir("/tmp/run", "off"), path.join("/tmp/run", "evidence", "phase-off"));
  assert.equal(phaseEvidenceDir("/tmp/run", "on"), path.join("/tmp/run", "evidence", "phase-on"));
});

test("phase command greps include the phase's playwright ids", () => {
  const offIds = idsForPhase("off");
  const cmd = phaseCommands("/tmp/run.json", "off").management;
  assert.ok(offIds.includes("ROW25-V18"));
  assert.ok(cmd.includes("ROW25-V18"));
});

test("applyProvenAndRestart syncs extraEnv and restarts a live child", async () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), "lucy-rp-restart-"));
  try {
    writeFileSync(path.join(runDir, "run.json"), `${JSON.stringify({
      contract: "lucy-e2e-run-v1",
      instance: { env: {} }
    }, null, 2)}\n`);
    const restarts = [];
    const lucy = {
      run: { instance: { env: {} } },
      extraEnv: {},
      child: { pid: 1 },
      restart: async () => { restarts.push(true); }
    };
    await applyProvenAndRestart(runDir, true, lucy);
    assert.equal(lucy.extraEnv[FORCED_PREDICATE_PROVEN_ENV], "1");
    assert.equal(lucy.run.instance.env[FORCED_PREDICATE_PROVEN_ENV], "1");
    assert.equal(restarts.length, 1);
    await applyProvenAndRestart(runDir, false, lucy);
    assert.equal(Object.hasOwn(lucy.extraEnv, FORCED_PREDICATE_PROVEN_ENV), false);
    assert.equal(restarts.length, 2);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

function seedRunDir(runId = "local-rp-b-orch") {
  const runDir = mkdtempSync(path.join(os.tmpdir(), "lucy-rp-b-"));
  const runJsonPath = path.join(runDir, "run.json");
  writeFileSync(runJsonPath, `${JSON.stringify({
    contract: "lucy-e2e-run-v1",
    runId,
    pack: PACK_ID,
    db: { dataPlane: RDS_MYSQL_READONLY_DATAPLANE, readonlyProven: true },
    instance: { env: { LUCY_DEPLOYMENT_MODE: "customer" } },
    paths: { runDir }
  }, null, 2)}\n`);
  return { runDir, runJsonPath };
}

function fakePrepare(runJsonPath) {
  const prepare = async (opts) => {
    prepare.last = opts;
    return {
      run: JSON.parse(readFileSync(runJsonPath, "utf8")),
      runJsonPath
    };
  };
  return prepare;
}

test("runRowPolicyB skeleton prepares pack row-policy without apply-db and clears proven", async () => {
  const { runDir, runJsonPath } = seedRunDir();
  try {
    const prepare = fakePrepare(runJsonPath);
    const report = await runRowPolicyB({
      runId: "local-rp-b-orch",
      runRoot: path.dirname(runDir),
      execute: false,
      prepare
    });
    assert.equal(prepare.last.pack, "row-policy");
    assert.equal(prepare.last.applyDb, false);
    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.phaseOff.blockedBlocking > 0);
    assert.ok(existsSync(path.join(phaseEvidenceDir(runDir, "off"), "plan.json")));
    assert.ok(existsSync(path.join(phaseEvidenceDir(runDir, "on"), "plan.json")));
    assert.ok(existsSync(path.join(runDir, "evidence", "summary.json")));
    const cleared = JSON.parse(readFileSync(runJsonPath, "utf8"));
    assert.equal(Object.hasOwn(cleared.instance.env, FORCED_PREDICATE_PROVEN_ENV), false);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB execute rejects unproven RDS and does not mark phase evidence executed", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-unproven");
  try {
    const runJson = JSON.parse(readFileSync(runJsonPath, "utf8"));
    runJson.db.readonlyProven = false;
    writeFileSync(runJsonPath, `${JSON.stringify(runJson, null, 2)}\n`);

    await assert.rejects(
      () => runRowPolicyB({
        runJson: runJsonPath,
        execute: true,
        runPhase: async () => ({
          rows: defaultNotRunRows("off").map((row) => ({ ...row, status: "passed" })),
          spawned: { management: 0, security: 0 }
        })
      }),
      /assertRowPolicyBDataPlane:.*readonlyProven/
    );

    for (const phase of ["off", "on"]) {
      const resultsPath = path.join(phaseEvidenceDir(runDir, phase), "results.json");
      if (existsSync(resultsPath)) {
        const payload = JSON.parse(readFileSync(resultsPath, "utf8"));
        assert.notEqual(payload.executed, true, `${phase} results.json must not claim executed`);
      }
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB execute rejects row-policy run without dataPlane", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-no-dataplane");
  try {
    const runJson = JSON.parse(readFileSync(runJsonPath, "utf8"));
    delete runJson.db.dataPlane;
    writeFileSync(runJsonPath, `${JSON.stringify(runJson, null, 2)}\n`);

    await assert.rejects(
      () => runRowPolicyB({ runJson: runJsonPath, execute: true }),
      /assertRowPolicyBDataPlane/
    );

    for (const phase of ["off", "on"]) {
      const resultsPath = path.join(phaseEvidenceDir(runDir, phase), "results.json");
      if (existsSync(resultsPath)) {
        assert.notEqual(JSON.parse(readFileSync(resultsPath, "utf8")).executed, true);
      }
    }
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB execute path passes only when both phases return green rows", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-green");
  try {
    const report = await runRowPolicyB({
      runJson: runJsonPath,
      execute: true,
      runPhase: async ({ phase }) => ({
        rows: defaultNotRunRows(phase).map((row) => ({ ...row, status: "passed" })),
        spawned: { management: 0, security: 0 }
      })
    });
    assert.equal(report.summary.passed, true);
    const cleared = JSON.parse(readFileSync(runJsonPath, "utf8"));
    assert.equal(Object.hasOwn(cleared.instance.env, FORCED_PREDICATE_PROVEN_ENV), false);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB execute fails when runner exits non-zero even if rows are green", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-runner-exit");
  try {
    const report = await runRowPolicyB({
      runJson: runJsonPath,
      execute: true,
      runPhase: async ({ phase }) => ({
        rows: defaultNotRunRows(phase).map((row) => ({ ...row, status: "passed" })),
        spawned: { management: 1, security: 0 }
      })
    });
    assert.equal(report.summary.passed, false);
    assert.ok(report.summary.phaseOff.failed >= 1);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB execute path fails when a phase returns blocking blocked", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-blocked");
  try {
    const report = await runRowPolicyB({
      runJson: runJsonPath,
      execute: true,
      runPhase: async ({ phase }) => ({
        rows: defaultNotRunRows(phase).map((row, index) => ({
          ...row,
          status: phase === "off" && index === 0 ? "blocked" : "passed"
        })),
        spawned: { management: 0, security: 0 }
      })
    });
    assert.equal(report.summary.passed, false);
    assert.equal(report.summary.phaseOff.blockedBlocking, 1);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("runRowPolicyB clears proven=1 even when a phase runner throws", async () => {
  const { runDir, runJsonPath } = seedRunDir("local-rp-b-throw");
  try {
    await assert.rejects(
      () => runRowPolicyB({
        runJson: runJsonPath,
        execute: true,
        runPhase: async () => {
          throw new Error("phase exploded");
        }
      }),
      /phase exploded/
    );
    const cleared = JSON.parse(readFileSync(runJsonPath, "utf8"));
    assert.equal(Object.hasOwn(cleared.instance.env, FORCED_PREDICATE_PROVEN_ENV), false);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test("collectExecutedRows maps v025 and security snapshot files", () => {
  const evidenceDir = mkdtempSync(path.join(os.tmpdir(), "lucy-rp-ev-"));
  try {
    mkdirSync(path.join(evidenceDir, "v025"));
    writeFileSync(path.join(evidenceDir, "v025", "ROW25-V18.json"), `${JSON.stringify({ status: "passed" })}\n`);
    writeFileSync(path.join(evidenceDir, "security.json"), `${JSON.stringify({
      cases: [{ id: "SEC-11-BY09", status: "blocked" }]
    })}\n`);
    const rows = collectExecutedRows(evidenceDir, "off");
    const v18 = rows.find((row) => row.executionId === "ROW25-V18");
    const by09 = rows.find((row) => row.executionId === "BY-09");
    assert.equal(v18.status, "passed");
    assert.equal(by09.status, "blocked");
    assert.ok(rows.every((row) => row.status === "passed" || row.status === "blocked" || row.status === "not_run"));
  } finally {
    rmSync(evidenceDir, { recursive: true, force: true });
  }
});
