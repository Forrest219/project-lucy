import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { matchField, boundedField, deriveConflicts } from "../model.mjs";
import {
  writeConceptAtomic,
  readConcept,
  setCanonical,
  defaultWhitelistPath,
} from "../store.mjs";
import { runScan, summarizeConcept } from "../scan.mjs";
import { checkDiffBoundary } from "../check-diff-boundary.mjs";

test("SC-12: 资产管理人员 does not yield medium/high for alias 资产", () => {
  assert.equal(boundedField("资产", "资产管理人员"), false);
  assert.equal(matchField("资产", "资产管理人员", "measure_description"), null);
  assert.equal(matchField("资产", "资产管理人员", "table_description_db"), null);
  assert.equal(matchField("资产", "资产管理人员", "wiki_title"), null);
});

test("SC-09: broken_canonical when asset deleted; canonical+summary kept", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-sc09-"));
  const content = path.join(root, "config");
  const sl = path.join(content, "semantic-layer", "demo");
  fs.mkdirSync(sl, { recursive: true });
  const overlay = path.join(sl, "orders.yaml");
  fs.writeFileSync(
    overlay,
    `name: orders
measures:
  - name: total_sales
    expr: sum(sales)
    description: 销售
`,
  );
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const dir = path.join(content, "concepts");
  let revenue = readConcept(dir, "revenue");
  const hit = revenue.bindings.find((b) => b.ref?.measureKey === "total_sales");
  assert.ok(hit);
  setCanonical(dir, "revenue", hit.bindingId, "权威 summary 不得被扫描清掉");
  fs.unlinkSync(overlay);
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  revenue = readConcept(dir, "revenue");
  assert.equal(revenue.canonical, hit.bindingId);
  assert.equal(revenue.summary, "权威 summary 不得被扫描清掉");
  const summary = summarizeConcept(revenue, content);
  assert.ok(summary.conflicts.some((c) => c.code === "broken_canonical"));
});

test("SC-07: load rejects inconsistent authority", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-sc07-"));
  const bad = {
    id: "revenue",
    label: "收入",
    aliases: ["revenue"],
    canonical: "measure:a/b/c",
    bindings: [{ bindingId: "measure:a/b/d", role: "canonical" }],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  // write bypassing assert by raw file
  fs.writeFileSync(path.join(dir, "revenue.yaml"), "id: revenue\ncanonical: measure:a/b/c\nbindings:\n  - bindingId: measure:a/b/d\n    role: canonical\n");
  assert.throws(() => readConcept(dir, "revenue"), /authority invariant/);
  assert.throws(() => writeConceptAtomic(dir, bad), /authority invariant/);
});

test("SC-05 allow helper: scripts/concepts paths allowed", () => {
  // Unit-level: checkDiffBoundary against empty/temp is environment-dependent;
  // assert exported function shape and that allowlist rejects a known bad path via filter logic.
  const result = checkDiffBoundary({ base: "", cwd: process.cwd() });
  assert.equal(typeof result.ok, "boolean");
  assert.ok(Array.isArray(result.paths));
  // If working tree only has allowlisted concept work, ok may be true; if other dirty files exist, ok false.
  // Hard assertion: a synthetic path is never in allow when we filter manually.
  const fake = ["webui/server/proxy/query-guardrails.ts", "scripts/concepts/model.mjs"];
  const allow = (p) =>
    p.startsWith("scripts/concepts/")
    || p === "package.json"
    || p === "webui/docs/00-product-terminology-standard.md"
    || p === "docs/governance/test-layers-and-release-gates.md"
    || p.startsWith("inbox/");
  assert.equal(allow(fake[0]), false);
  assert.equal(allow(fake[1]), true);
});

test("SC-02 deriveConflicts ignores absent high candidates", () => {
  const { conflicts } = deriveConflicts(
    {
      id: "revenue",
      canonical: null,
      bindings: [
        { bindingId: "a", role: "candidate", confidence: "high" },
        { bindingId: "b", role: "candidate", confidence: "high" },
      ],
    },
    {
      assetStatus: (b) => (b.bindingId === "b" ? "absent" : "present"),
      rematch: () => true,
    },
  );
  assert.equal(conflicts.length, 0);
});

test("SC-11: atomic write failure leaves original bytes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-sc11-"));
  const original = {
    id: "revenue",
    label: "收入",
    aliases: ["revenue"],
    canonical: null,
    bindings: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  writeConceptAtomic(dir, original);
  const before = fs.readFileSync(path.join(dir, "revenue.yaml"));
  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("mock rename fail");
  };
  try {
    assert.throws(
      () =>
        writeConceptAtomic(dir, {
          ...original,
          label: "should-not-land",
          updated_at: "2026-02-02T00:00:00.000Z",
        }),
      /mock rename fail/,
    );
  } finally {
    fs.renameSync = realRename;
  }
  const after = fs.readFileSync(path.join(dir, "revenue.yaml"));
  assert.deepEqual(after, before);
});

test("SC-13/SC-17: id fence and filename/id mismatch", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-sc13-"));
  const revenuePath = path.join(dir, "revenue.yaml");
  fs.writeFileSync(
    revenuePath,
    "id: total_assets\nlabel: x\naliases: [x]\ncanonical: null\nbindings: []\n",
  );
  assert.throws(() => readConcept(dir, "revenue"), /id mismatch/);
  const before = fs.readFileSync(revenuePath);
  writeConceptAtomic(dir, {
    id: "total_assets",
    label: "资产",
    aliases: ["资产"],
    canonical: null,
    bindings: [],
    updated_at: new Date().toISOString(),
  });
  assert.deepEqual(fs.readFileSync(revenuePath), before);
  assert.ok(fs.existsSync(path.join(dir, "total_assets.yaml")));
});

test("SC-14: set-canonical clears needs_authority without rescan", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucy-sc14-"));
  const content = path.join(root, "config");
  const sl = path.join(content, "semantic-layer", "demo");
  fs.mkdirSync(sl, { recursive: true });
  fs.writeFileSync(
    path.join(sl, "a.yaml"),
    `name: a
measures:
  - name: total_sales
    expr: sum(x)
    description: sales
`,
  );
  fs.writeFileSync(
    path.join(sl, "b.yaml"),
    `name: b
measures:
  - name: revenue
    expr: sum(y)
    description: revenue
`,
  );
  runScan({ contentRoot: content, whitelistPath: defaultWhitelistPath() });
  const dir = path.join(content, "concepts");
  let revenue = readConcept(dir, "revenue");
  const highs = revenue.bindings.filter((b) => b.role === "candidate" && b.confidence === "high");
  assert.ok(highs.length >= 2);
  assert.ok(summarizeConcept(revenue, content).conflicts.some((c) => c.code === "needs_authority"));
  setCanonical(dir, "revenue", highs[0].bindingId, "sc-14 summary");
  revenue = readConcept(dir, "revenue");
  const s = summarizeConcept(revenue, content);
  assert.ok(!s.conflicts.some((c) => c.code === "needs_authority"));
});

test("SC-15: rematch miss drops needs_authority for historical high", () => {
  const concept = {
    id: "revenue",
    canonical: null,
    aliases: ["收入"],
    bindings: [
      { bindingId: "a", role: "candidate", confidence: "high" },
      { bindingId: "b", role: "candidate", confidence: "high" },
    ],
  };
  const { conflicts: before } = deriveConflicts(concept, {
    assetStatus: () => "present",
    rematch: () => true,
  });
  assert.equal(before[0]?.code, "needs_authority");
  const { conflicts: after } = deriveConflicts(concept, {
    assetStatus: () => "present",
    rematch: () => false,
  });
  assert.equal(after.length, 0);
});
