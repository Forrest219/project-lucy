import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  writeConceptAtomic,
  readConcept,
  setCanonical,
  rejectBinding,
  mergeBinding,
  safeConceptPath,
  seedFromWhitelist,
  loadWhitelistFile,
  defaultWhitelistPath,
} from "../store.mjs";

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lucy-concepts-"));
}

test("SC-atomic: write then read roundtrip", () => {
  const dir = tmpDir();
  const concept = {
    id: "revenue",
    label: "收入",
    aliases: ["收入", "revenue"],
    canonical: null,
    bindings: [],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  writeConceptAtomic(dir, concept);
  const got = readConcept(dir, "revenue");
  assert.equal(got.id, "revenue");
  assert.equal(got.canonical, null);
});

test("SC-id fence: path escape blocked", () => {
  const dir = tmpDir();
  assert.throws(() => safeConceptPath(dir, "../etc"), /invalid|escape/);
});

test("SC-seed: whitelist creates empty concepts", () => {
  const dir = tmpDir();
  const doc = loadWhitelistFile(defaultWhitelistPath());
  const created = seedFromWhitelist(dir, doc);
  assert.ok(created.includes("revenue"));
  assert.ok(readConcept(dir, "revenue"));
  // second seed is idempotent
  const again = seedFromWhitelist(dir, doc);
  assert.equal(again.length, 0);
});

test("SC-merge: preserve rejected; promote canonical exclusivity", () => {
  let concept = {
    id: "revenue",
    label: "收入",
    aliases: ["revenue"],
    canonical: null,
    bindings: [
      {
        bindingId: "measure:a/b/c",
        kind: "measure",
        role: "rejected",
        confidence: "high",
        ref: { connectionId: "a", sourceName: "b", measureKey: "c" },
        evidence: [{ type: "semantic", path: "x", alias: "revenue", field: "measure_key", snippet: "c" }],
      },
    ],
    updated_at: "2026-01-01T00:00:00.000Z",
  };
  const discovered = {
    bindingId: "measure:a/b/c",
    kind: "measure",
    role: "candidate",
    confidence: "high",
    ref: { connectionId: "a", sourceName: "b", measureKey: "c" },
    evidence: [{ type: "semantic", path: "x", alias: "revenue", field: "measure_key", snippet: "c" }],
  };
  const preserved = mergeBinding(concept, discovered);
  assert.equal(preserved.action, "preserve_rejected");
  assert.equal(preserved.changed, false);

  // add a fresh candidate then set canonical
  const dir = tmpDir();
  concept = {
    ...concept,
    bindings: [
      {
        bindingId: "measure:demo/orders/total_sales",
        kind: "measure",
        role: "candidate",
        confidence: "high",
        ref: { connectionId: "demo", sourceName: "orders", measureKey: "total_sales" },
        evidence: [{ type: "semantic", path: "p", alias: "revenue", field: "measure_key", snippet: "total_sales" }],
      },
      {
        bindingId: "measure:demo/orders/sales",
        kind: "measure",
        role: "candidate",
        confidence: "high",
        ref: { connectionId: "demo", sourceName: "orders", measureKey: "sales" },
        evidence: [{ type: "semantic", path: "p", alias: "revenue", field: "measure_key", snippet: "sales" }],
      },
    ],
  };
  writeConceptAtomic(dir, concept);
  const after = setCanonical(
    dir,
    "revenue",
    "measure:demo/orders/total_sales",
    "试点：sales 实收为收入权威",
  );
  assert.equal(after.canonical, "measure:demo/orders/total_sales");
  assert.equal(after.summary, "试点：sales 实收为收入权威");
  assert.equal(after.bindings.filter((b) => b.role === "canonical").length, 1);

  const rejected = rejectBinding(dir, "revenue", "measure:demo/orders/total_sales");
  assert.equal(rejected.canonical, null);
  assert.equal(rejected.bindings.find((b) => b.bindingId === "measure:demo/orders/total_sales").role, "rejected");
});

test("SC-merge: empty evidence cannot become candidate", () => {
  const concept = {
    id: "revenue",
    canonical: null,
    bindings: [],
    aliases: ["revenue"],
  };
  const result = mergeBinding(concept, {
    bindingId: "measure:a/b/c",
    kind: "measure",
    role: "candidate",
    confidence: "high",
    ref: {},
    evidence: [],
  });
  assert.equal(result.action, "skip_empty_evidence");
  assert.equal(result.changed, false);
});
