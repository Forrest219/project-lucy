import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runScan, summarizeConcept } from "../scan.mjs";
import {
  readConcept,
  setCanonical,
  listConceptIds,
  rejectBinding,
  defaultWhitelistPath,
} from "../store.mjs";
import { resolveContentRoot, resolveProjectRoot } from "../content-root.mjs";

function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-concept-proj-"));
  fs.writeFileSync(path.join(root, "ktx.yaml"), "paths:\n  content_root: config\n");
  const content = path.join(root, "config");
  const sl = path.join(content, "semantic-layer", "demo-mysql");
  fs.mkdirSync(sl, { recursive: true });
  fs.writeFileSync(
    path.join(sl, "superstore_orders.yaml"),
    `name: superstore_orders
measures:
  - name: total_sales
    expr: sum(sales)
    description: 销售总额
  - name: total_profit
    expr: sum(profit)
    description: 利润总额
`,
  );
  const wiki = path.join(content, "wiki");
  fs.mkdirSync(wiki, { recursive: true });
  fs.writeFileSync(path.join(wiki, "revenue.md"), "# 收入\n\n正文提到利润但不作匹配依据。\n");
  return { root, content };
}

test("SC-content-root: flag / env / ktx / default", () => {
  const { root, content } = makeFixture();
  const viaFlag = resolveContentRoot({ projectFlag: root, contentRootFlag: content });
  assert.equal(viaFlag.contentRoot, content);

  const viaKtx = resolveContentRoot({ projectFlag: root, env: {} });
  assert.equal(viaKtx.contentRoot, content);

  const viaEnv = resolveContentRoot({
    projectFlag: root,
    env: { LUCY_CONTENT_ROOT: content },
  });
  assert.equal(viaEnv.contentRoot, content);

  assert.equal(resolveProjectRoot({ projectFlag: root }), root);
});

test("SC-scan: discovers measure + wiki; needs_authority; set-canonical clears", () => {
  const { content } = makeFixture();
  const result = runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  assert.ok(result.stats.concepts >= 1);

  const dir = path.join(content, "concepts");
  const revenue = readConcept(dir, "revenue");
  assert.ok(revenue);
  const measureHit = revenue.bindings.find(
    (b) => b.kind === "measure" && b.ref.measureKey === "total_sales",
  );
  assert.ok(measureHit, "expected total_sales binding via alias");
  assert.ok(measureHit.evidence.length >= 1);

  const wikiHit = revenue.bindings.find((b) => b.kind === "wiki");
  assert.ok(wikiHit, "expected wiki title match for 收入");

  fs.writeFileSync(
    path.join(content, "semantic-layer", "demo-mysql", "finance.yaml"),
    `name: finance
measures:
  - name: revenue
    expr: sum(amt)
    description: revenue
`,
  );
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const revenue2 = readConcept(dir, "revenue");
  const highCandidates = revenue2.bindings.filter(
    (b) => b.role === "candidate" && b.confidence === "high",
  );
  assert.ok(highCandidates.length >= 2, `expected ≥2 high candidates, got ${highCandidates.length}`);
  const s2 = summarizeConcept(revenue2, content);
  assert.ok(s2.conflicts.some((c) => c.code === "needs_authority"));

  const chosen = highCandidates[0].bindingId;
  setCanonical(dir, "revenue", chosen, "收入权威：finance.revenue");
  const afterCanon = readConcept(dir, "revenue");
  assert.equal(afterCanon.summary, "收入权威：finance.revenue");
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const afterRescan = readConcept(dir, "revenue");
  assert.equal(afterRescan.canonical, chosen);
  assert.equal(afterRescan.summary, "收入权威：finance.revenue");
  assert.equal(afterRescan.bindings.find((b) => b.bindingId === chosen).role, "canonical");
  const after = summarizeConcept(afterRescan, content);
  assert.ok(!after.conflicts.some((c) => c.code === "needs_authority"));
});

test("SC-scan: rejected stays rejected across rescan", () => {
  const { content } = makeFixture();
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const dir = path.join(content, "concepts");
  let revenue = readConcept(dir, "revenue");
  const target = revenue.bindings.find((b) => b.kind === "measure");
  assert.ok(target);
  rejectBinding(dir, "revenue", target.bindingId);
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  revenue = readConcept(dir, "revenue");
  assert.equal(revenue.bindings.find((b) => b.bindingId === target.bindingId).role, "rejected");
});

test("SC-list ids from disk", () => {
  const { content } = makeFixture();
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const ids = listConceptIds(path.join(content, "concepts"));
  assert.ok(ids.includes("revenue"));
  assert.ok(ids.includes("total_assets"));
});
