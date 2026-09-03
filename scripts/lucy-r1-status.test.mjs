import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "lucy-r1-status.mjs");

async function withFixtureReadiness(readiness, fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-status-"));
  try {
    const file = path.join(dir, "readiness.json");
    await writeFile(file, `${JSON.stringify(readiness, null, 2)}\n`, "utf8");
    await fn(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("R1 status summarizes missing external evidence without marking release ready", async () => {
  await withFixtureReadiness({
    ok: false,
    strict: true,
    counts: { pass: 335, fail: 3 },
    results: [
      { status: "fail", id: "external.mcp_contract", message: "Lucy R1 MCP contract smoke requires runtime evidence" },
      { status: "fail", id: "external.doris", message: "Doris vertical slice requires external evidence" },
      { status: "fail", id: "external.hermes", message: "Hermes >=95% QA accuracy report requires external evidence" }
    ]
  }, async (file) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-missing-config-"));
    try {
      const result = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file, "--json"], {
        cwd: dir,
        env: {
          ...process.env,
          LUCY_R1_MCP_CONTRACT_EVIDENCE: "",
          LUCY_R1_DORIS_EVIDENCE: "",
          LUCY_R1_HERMES_ACCURACY_REPORT: ""
        },
        encoding: "utf8"
      });

      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.releaseReady, false);
      assert.equal(summary.readiness.counts.pass, 335);
      assert.equal(summary.readiness.counts.fail, 3);
      assert.deepEqual(summary.externalEvidence.map((item) => item.status), ["fail", "fail", "fail"]);
      assert.deepEqual(summary.externalEvidence.map((item) => item.envSet), [false, false, false]);
      assert.equal(summary.dorisTarget.present, false);
      assert.equal(summary.exactRole.present, false);
      assert.equal(summary.exactRole.pointsToDoris, false);
      assert.equal(summary.configReady, false);
      assert.ok(summary.nextCommands.some((command) => command.includes("r1:release-bundle")));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("R1 status does not mark strict evidence as release ready when local Doris config is not active", async () => {
  await withFixtureReadiness({
    ok: true,
    strict: true,
    counts: { pass: 338 },
    results: [
      { status: "pass", id: "external.mcp_contract", message: "MCP evidence valid" },
      { status: "pass", id: "external.doris", message: "Doris evidence valid" },
      { status: "pass", id: "external.hermes", message: "Hermes evidence valid" }
    ]
  }, async (file) => {
    const result = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file], {
      cwd: ROOT,
      encoding: "utf8"
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Lucy R1 status: not release-ready/);
    assert.match(result.stdout, /Strict readiness: pass \(338 pass, 0 fail, 0 manual\)/);
    assert.match(result.stdout, /Config ready: false/);
    assert.match(result.stdout, /External evidence:/);
  });
});

test("R1 status marks release ready only when strict evidence and current Doris config are ready", async () => {
  await withFixtureReadiness({
    ok: true,
    strict: true,
    counts: { pass: 338 },
    results: [
      { status: "pass", id: "external.mcp_contract", message: "MCP evidence valid" },
      { status: "pass", id: "external.doris", message: "Doris evidence valid" },
      { status: "pass", id: "external.hermes", message: "Hermes evidence valid" }
    ]
  }, async (file) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-ready-config-"));
    try {
      await mkdir(path.join(dir, "webui", "config"), { recursive: true });
      await writeFile(path.join(dir, "ktx.yaml"), `
connections:
  doris-r1:
    driver: mysql
    engine: doris
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - mart.ceo_metric_snapshot
`, "utf8");
      await writeFile(path.join(dir, "webui", "config", "access.yaml"), `
roles:
  lucy_r1_exact_readonly:
    allow:
      connections:
        - doris-r1
      tableSelectors:
        - connection: doris-r1
          schema: mart
          names:
            - ceo_metric_snapshot
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
`, "utf8");
      const result = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file, "--json"], {
        cwd: dir,
        encoding: "utf8"
      });

      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.ok, true);
      assert.equal(summary.configReady, true);
      assert.equal(summary.releaseReady, true);
      assert.equal(summary.dorisTarget.ready, true);
      assert.equal(summary.exactRole.exactTools, true);
      assert.equal(summary.exactRole.pointsToDoris, true);
      assert.equal(summary.exactRole.tableSelectorsPointToDoris, true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("R1 status can evaluate an explicit StarRocks target without changing the default Doris profile", async () => {
  await withFixtureReadiness({
    ok: true,
    strict: true,
    target: "starrocks",
    counts: { pass: 338 },
    results: [
      { status: "pass", id: "external.mcp_contract", message: "MCP evidence valid" },
      { status: "pass", id: "external.starrocks", message: "StarRocks evidence valid" },
      { status: "pass", id: "external.hermes", message: "Hermes evidence valid" }
    ]
  }, async (file) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-ready-starrocks-config-"));
    try {
      await mkdir(path.join(dir, "webui", "config"), { recursive: true });
      await writeFile(path.join(dir, "ktx.yaml"), `
connections:
  starrocks-r1:
    driver: mysql
    engine: starrocks
    wire_protocol: mysql
    readonly: true
    r1_target: true
    enabled_tables:
      - mart.ceo_metric_snapshot
`, "utf8");
      await writeFile(path.join(dir, "webui", "config", "access.yaml"), `
roles:
  lucy_r1_exact_readonly:
    allow:
      connections:
        - starrocks-r1
      tableSelectors:
        - connection: starrocks-r1
          schema: mart
          names:
            - ceo_metric_snapshot
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
        - lucy_explain_query
        - lucy_freshness
        - lucy_begin_question
`, "utf8");
      const result = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file, "--target", "starrocks", "--json"], {
        cwd: dir,
        encoding: "utf8"
      });

      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.equal(summary.target, "starrocks");
      assert.equal(summary.configReady, true);
      assert.equal(summary.releaseReady, true);
      assert.equal(summary.selectedTarget.ready, true);
      assert.equal(summary.selectedTarget.checks.engine, true);
      assert.equal(summary.exactRole.pointsToTarget, true);
      assert.equal(summary.exactRole.tableSelectorsPointToTarget, true);
      assert.equal(summary.externalEvidence[1].id, "external.starrocks");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("R1 status reports data roles missing lucy_begin_question without failing readiness", async () => {
  await withFixtureReadiness({
    ok: false,
    strict: true,
    counts: { pass: 1, fail: 1 },
    results: []
  }, async (file) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-r1-question-tool-config-"));
    try {
      await mkdir(path.join(dir, "webui", "config"), { recursive: true });
      await writeFile(path.join(dir, "webui", "config", "access.yaml"), `
roles:
  analyst:
    allow:
      tools:
        - lucy_query
  governed:
    allow:
      tools:
        - lucy_read_source
        - lucy_begin_question
  wiki_only:
    allow:
      tools:
        - wiki_read
`, "utf8");
      const result = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file, "--json"], {
        cwd: dir,
        encoding: "utf8"
      });

      assert.equal(result.status, 0, result.stderr);
      const summary = JSON.parse(result.stdout);
      assert.deepEqual(summary.questionReporting, {
        configPresent: true,
        dataRoleCount: 2,
        missingRoleIds: ["analyst"],
        complete: false
      });
      assert.equal(summary.releaseReady, false);

      const human = spawnSync(process.execPath, [SCRIPT, "--readiness-file", file], {
        cwd: dir,
        encoding: "utf8"
      });
      assert.equal(human.status, 0, human.stderr);
      assert.match(human.stdout, /Warning: Lucy data roles missing lucy_begin_question: analyst/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
