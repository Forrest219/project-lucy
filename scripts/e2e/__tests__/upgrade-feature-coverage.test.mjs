import assert from "node:assert/strict";
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { prepareEnvironment } from "../prepare-environment.mjs";
import { seedUpgradeFixture } from "../lib/upgrade-fixture.mjs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { parse } from "yaml";
import { projectUpgradeResults } from "../run-upgrade-features.mjs";
import { forbiddenBrowserCalls } from "../lib/real-browser-source-guard.mjs";
import { REPO_ROOT } from "../lib/common.mjs";

test("all 14 upgrade claims have executable cases, branch cases and valid references", () => {
  const doc = parse(readFileSync(path.join(REPO_ROOT, "scripts/e2e/contracts/upgrade-features.yaml"), "utf8"));
  assert.equal(doc.features.length, 14);
  assert.equal(doc.releaseEligible, false);
  const source = readFileSync(path.join(REPO_ROOT, doc.spec), "utf8");
  for (const feature of doc.features) {
    assert.ok(source.includes(`feature(info, "${feature.id}"`), `${feature.id} needs an executable test annotation`);
    for (const file of feature.branch) assert.ok(existsSync(path.join(REPO_ROOT, file)), `missing branch case ${file}`);
  }
  assert.deepEqual(forbiddenBrowserCalls(source), []);
});

test("missing, skipped, failed and blocked cases cannot paint an upgrade feature green", () => {
  const entry = (status, annotations = []) => ({ annotations: [{ type: "upgrade-feature", description: "UPG-01" }, ...annotations], results: [{ status }] });
  const report = (...tests) => ({ suites: [{ specs: tests.map((test) => ({ title: "actual test", tests: [test] })) }] });
  const project = (...tests) => projectUpgradeResults(report(...tests), ["UPG-01", "UPG-02"]);
  assert.equal(project().entries[0].status, "blocked");
  assert.equal(project(entry("skipped")).entries[0].status, "blocked");
  assert.equal(project(entry("failed")).entries[0].status, "failed");
  assert.equal(project(entry("passed", [{ type: "blocked", description: "no AWS" }])).entries[0].status, "blocked");
  assert.equal(project(entry("passed"), entry("failed")).entries[0].status, "failed");
  assert.equal(project(entry("passed")).entries[0].status, "passed");
  assert.equal(project(entry("passed")).entries[1].status, "blocked");
  assert.equal(project(entry("passed")).releaseEligible, false);
});

test("prepared security fixture is valid YAML after replacing only generated token placeholders", () => {
  const source = readFileSync(path.join(REPO_ROOT, "examples/security-e2e/project-template/webui/config/access.yaml.template"), "utf8");
  const doc = parse(source.replace(/\{\{[A-Z0-9_]+\}\}/g, "fixture"));
  assert.ok(doc.roles.finance_east_constrained);
  assert.ok(doc.users.length > 0);
});

test("upgrade fixture writes its actual ACL, canonical content, drift and known database values", async () => {
  const { run } = await prepareEnvironment({ runId: `upgrade-fixture-contract-${randomUUID()}`, mode: "local" });
  try {
    seedUpgradeFixture(run);
    const acl = parse(readFileSync(path.join(run.paths.project, "webui/config/access.yaml"), "utf8"));
    assert.deepEqual(Object.keys(acl.roles).sort(), ["finance_reader", "lucy_admin", "sales_reader"]);
    assert.deepEqual(acl.roles.finance_reader.allow.tableSelectors[0].names, ["orders", "hidden_orders"]);
    const config = parse(readFileSync(path.join(run.paths.project, "ktx.yaml"), "utf8"));
    assert.deepEqual(config.connections["upgrade-db"].enabled_tables, ["main.orders", "main.extra_orders"]);
    assert.equal(run.instance.env.LUCY_CONTENT_ROOT, path.join(run.paths.project, "config"));
    assert.equal(existsSync(path.join(run.paths.project, "config/semantic-layer/upgrade-db/retired.yaml")), false);
    assert.equal(existsSync(path.join(run.paths.project, "semantic-layer/upgrade-db/retired.yaml")), true);
    const db = new DatabaseSync(run.upgrade.sqlitePath, { readOnly: true });
    try { assert.equal(db.prepare("SELECT SUM(amount) AS total FROM orders").get().total, 600); } finally { db.close(); }
    assert.match(readFileSync(path.join(run.paths.project, "config/skills/domains/upgrade/upgrade-draft.skill.md"), "utf8"), /status: draft/);
  } finally { rmSync(run.paths.runDir, { recursive: true, force: true }); }
});
