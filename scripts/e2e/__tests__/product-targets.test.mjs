import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { loadCatalog } from "../lib/catalog.mjs";
import { REPO_ROOT } from "../lib/common.mjs";
import { loadCoverage } from "../lib/v025-coverage.mjs";
import {
  FROZEN_SPECS,
  PRODUCT_TARGETS,
  REAL_CONFIG,
  agentIdsForExecutor,
  assertEvidenceStamp,
  filesFor,
  lifecycleSelectionFromChecklist,
  managementPlaywrightArgs,
  productExitCode,
  selectProductTarget,
  selectedIdsFor,
  untargetedPlaywrightArgs
} from "../lib/product-targets.mjs";

const ROOT = REPO_ROOT;
const REAL_DIR = "webui/tests/real-e2e";

function readRepo(rel) {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function expandConst(text, name) {
  const literal = text.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (literal) return [...literal[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const generated = text.match(new RegExp(`const ${name} = Array\\.from\\(\\{ length: (\\d+) \\}, \\(_, i\\) => \`([^\`]*)\\$\\{`));
  if (!generated) throw new Error(`cannot expand ${name}`);
  const prefix = generated[2];
  return Array.from({ length: Number(generated[1]) }, (_, index) => `${prefix}${String(index + 1).padStart(2, "0")}`);
}

function coversV025Ids(rel) {
  const text = readRepo(rel);
  const ids = [];
  for (const call of text.matchAll(/coversV025\(testInfo,\s*([^)]*)\)/g)) {
    for (const quoted of call[1].matchAll(/"([^"]+)"/g)) ids.push(quoted[1]);
    for (const spread of call[1].matchAll(/\.\.\.(\w+)/g)) ids.push(...expandConst(text, spread[1]));
  }
  return [...new Set(ids)].sort();
}

describe("SC-01 product target selector", () => {
  it("rejects an unknown target, an empty target, and two targets", () => {
    assert.throws(() => selectProductTarget(["--target", "NOPE"]), /unknown target/);
    assert.throws(() => selectProductTarget(["--target", ""]), /unknown target|empty target/);
    assert.throws(() => selectProductTarget(["--target"]), /empty target|unknown target/);
    assert.throws(() => selectProductTarget(["--target", "mainline", "--target", "CONN"]), /exactly one target/);
  });

  it("accepts each legal target once", () => {
    for (const target of PRODUCT_TARGETS) {
      const selected = selectProductTarget(["--target", target, "--list"]);
      assert.equal(selected.target, target);
      assert.equal(selected.execute, false);
    }
  });
});

describe("SC-02 and SC-03 file boundaries", () => {
  it("gives mainline only the continuous journey spec", () => {
    assert.deepEqual(filesFor("mainline"), [`${REAL_DIR}/journey-v025.spec.ts`]);
  });

  it("keeps the six branches disjoint from each other, the journey, and the frozen suite", () => {
    const branches = ["CONN", "SEM", "ACCESS", "OBSERVE", "AGENT", "LIFECYCLE"];
    const seen = new Map();
    for (const target of branches) {
      for (const file of filesFor(target)) {
        assert.equal(seen.has(file), false, `${file} is in both ${seen.get(file)} and ${target}`);
        seen.set(file, target);
        assert.equal(file.endsWith("journey-v025.spec.ts"), false);
        assert.equal(FROZEN_SPECS.includes(file), false);
      }
    }
    for (const frozen of FROZEN_SPECS) assert.equal(filesFor("mainline").includes(frozen), false);
  });
});

describe("SC-04 --list", () => {
  it("prints targets, paths, and evidence layers without starting Lucy or Playwright", () => {
    const selected = selectProductTarget(["--list"]);
    assert.equal(selected.execute, false);
    assert.equal(selected.listings.length, 7);
    const result = spawnSync(process.execPath, ["scripts/e2e/select-product-target.mjs", "--target", "mainline", "--list"], {
      cwd: ROOT,
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /target=mainline/);
    assert.match(result.stdout, /evidenceLayer=mixed/);
    assert.match(result.stdout, /journey-v025\.spec\.ts/);
    assert.match(result.stdout, /playwright\.real\.config\.ts/);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Lucy process|playwright test/);
  });
});

describe("SC-05 management argv", () => {
  it("passes the §2.1 files to playwright.real.config.ts and leaves AGENT and LIFECYCLE off that config", () => {
    for (const target of ["mainline", "CONN", "SEM", "ACCESS", "OBSERVE"]) {
      const argv = managementPlaywrightArgs(target);
      assert.equal(argv.configPath, REAL_CONFIG);
      assert.equal(argv.config, "playwright.real.config.ts");
      assert.deepEqual(argv.files, filesFor(target).map((file) => file.replace(/^webui\//, "")));
    }
    assert.throws(() => managementPlaywrightArgs("AGENT"), /playwright\.real\.config\.ts/);
    assert.throws(() => managementPlaywrightArgs("LIFECYCLE"), /playwright\.real\.config\.ts/);
  });

  it("keeps an untargeted management run on the whole real-e2e directory", () => {
    const args = untargetedPlaywrightArgs({ project: "chromium" });
    assert.deepEqual(args, ["test", "-c", "playwright.real.config.ts", "--project", "chromium", "--workers", "1", "--retries", "0"]);
    const source = readRepo("scripts/e2e/run-management.mjs");
    assert.match(source, /untargetedPlaywrightArgs/);
    assert.match(source, /writeManagementEvidence/);
    assert.match(source, /EXIT_CODES\[evidence\.status\]/);
  });
});

describe("SC-06 selected exit", () => {
  it("follows J25-01 failed or blocked and ignores unselected failures", () => {
    const failed = productExitCode({
      selectedIds: ["J25-01"],
      resultsById: { "J25-01": { status: "failed" }, "UX-01-V01": { status: "passed" } }
    });
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.passedCount, 0);

    const blocked = productExitCode({
      selectedIds: ["J25-01"],
      resultsById: { "J25-01": { status: "blocked" }, "CON25-01": { status: "failed" } }
    });
    assert.equal(blocked.exitCode, 2);
    assert.equal(blocked.passedCount, 0);

    const clean = productExitCode({
      selectedIds: ["J25-01"],
      resultsById: { "J25-01": { status: "passed" }, "CON25-01": { status: "failed" } }
    });
    assert.equal(clean.exitCode, 0);
    assert.equal(clean.passedCount, 1);
    assert.deepEqual(selectedIdsFor("mainline"), ["J25-01"]);
  });

  it("rejects an empty selection instead of calling it passed", () => {
    assert.throws(() => productExitCode({ selectedIds: [], resultsById: {} }), /empty selection/);
  });

  it("writes selection fields from the selector", () => {
    const selected = selectProductTarget(["--target", "CONN", "--list"]);
    assert.equal(selected.evidenceLayer, "mixed");
    assert.deepEqual(selected.files, filesFor("CONN"));
    assert.deepEqual(selected.selectedIds, selectedIdsFor("CONN"));
  });
});

describe("SC-11 evidence stamps", () => {
  it("rejects a protocol file stamped browser, a mixed target stamped protocol, and a page-journey claim", () => {
    assert.throws(() => assertEvidenceStamp({
      target: "ACCESS",
      file: `${REAL_DIR}/row-policy-v025.spec.ts`,
      stamped: "browser"
    }), /protocol/);
    assert.throws(() => assertEvidenceStamp({ target: "ACCESS", stamped: "protocol" }), /mixed/);
    assert.throws(() => assertEvidenceStamp({
      target: "ACCESS",
      file: `${REAL_DIR}/row-policy-v025.spec.ts`,
      stamped: "protocol",
      recordText: "页面旅程完成"
    }), /页面旅程完成/);
  });
});

describe("SC-12 agent intersection", () => {
  it("schedules the full owner-and-runner intersection and drops the named exclusions", () => {
    const coverage = loadCoverage();
    const { cases } = loadCatalog();
    const scheduled = agentIdsForExecutor(coverage, cases);
    const owners = new Set(
      [...coverage.existing, ...coverage.newScenarios]
        .filter((row) => row.ownerBranch === "AGENT")
        .map((row) => row.executionId)
    );
    const runners = new Set(cases.filter((entry) => entry.runner === "agent").map((entry) => entry.id));
    const expected = [...owners].filter((id) => runners.has(id)).sort();
    assert.deepEqual(scheduled, expected);
    assert.equal(scheduled.includes("SEC-16-V04"), false);
    assert.equal(scheduled.includes("SEC-14-V12"), false);
    assert.equal(scheduled.includes("Q-J25-CAC-28D"), false);
    assert.equal(scheduled.includes("Q-J25-CAC-7D"), false);
    assert.ok(scheduled.length > 0);
    assert.deepEqual(selectedIdsFor("AGENT"), scheduled);
  });
});

describe("SC-13 lifecycle child checklist", () => {
  it("reads lucy-upgrade-checklist/v1 and does not count the other upgrade contract", () => {
    const child = lifecycleSelectionFromChecklist({
      contract: "lucy-upgrade-checklist/v1",
      entries: [
        { id: "UPG-01", status: "failed" },
        { id: "UPG-02", status: "passed" }
      ]
    }, {
      childRunId: "upgrade-child",
      resultFile: "inbox/e2e/upgrade-child/upgrade-checklist.json"
    });
    assert.equal(child.command.endsWith("scripts/e2e/run-upgrade-features.mjs"), true);
    assert.equal(child.command.includes("run-upgrade.mjs"), false);
    assert.equal(child.contract, "lucy-upgrade-checklist/v1");
    assert.equal(child.childRunId, "upgrade-child");
    assert.deepEqual(child.selectedIds, ["UPG-01", "UPG-02"]);
    const decision = productExitCode({
      selectedIds: child.selectedIds,
      resultsById: {
        "UPG-01": { status: "failed" },
        "UPG-02": { status: "passed" },
        "UPG25-01": { status: "passed" }
      }
    });
    assert.equal(decision.exitCode, 1);
    assert.equal(decision.passedCount, 1);
    assert.throws(() => lifecycleSelectionFromChecklist({
      contract: "lucy-upgrade-e2e-p1/v1",
      entries: [{ id: "UPG-01", status: "passed" }]
    }, { childRunId: "other", resultFile: "upgrade-checklist.json" }), /lucy-upgrade-checklist\/v1/);
  });
});

describe("branch selected ids match coversV025", () => {
  it("compares the explicit arrays with the spec annotations", () => {
    const files = {
      CONN: [`${REAL_DIR}/connection-matrix-v025.spec.ts`],
      SEM: [`${REAL_DIR}/semantic-batch-v025.spec.ts`],
      ACCESS: [
        `${REAL_DIR}/row-policy-v025.spec.ts`,
        `${REAL_DIR}/row-policy-templates-v025.spec.ts`,
        `${REAL_DIR}/authorization-summary-v025.spec.ts`
      ],
      OBSERVE: [
        `${REAL_DIR}/audit-reconciliation-v025.spec.ts`,
        `${REAL_DIR}/access-map-v025.spec.ts`
      ]
    };
    for (const [target, list] of Object.entries(files)) {
      const annotated = list.flatMap((file) => coversV025Ids(file));
      assert.deepEqual([...selectedIdsFor(target)].sort(), [...new Set(annotated)].sort());
    }
  });
});
