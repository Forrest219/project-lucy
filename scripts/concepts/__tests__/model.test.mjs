import test from "node:test";
import assert from "node:assert/strict";
import {
  exactField,
  boundedField,
  identifierTokenMatch,
  matchField,
  assertAuthorityInvariant,
  assertValidConceptId,
  deriveConflicts,
  currentlyMatches,
  CONCEPT_ID_RE,
} from "../model.mjs";

test("SC-match: exact / bounded / identifier", () => {
  assert.equal(exactField("revenue", "Revenue"), true);
  assert.equal(exactField("revenue", "total_revenue"), false);
  assert.equal(identifierTokenMatch("revenue", "total_revenue_amt"), true);
  assert.equal(boundedField("收入", "本期·收入·合计"), true);
  assert.equal(boundedField("收入", "收入（折扣后）"), true);
  // 纯 CJK 连接不构成 bounded（Spec §4.4）
  assert.equal(boundedField("收入", "销售收入额"), false);
  assert.equal(boundedField("资产", "资产管理人员"), false);
});

test("SC-match: measure_key high; description medium; wiki body ignored", () => {
  assert.equal(matchField("total_sales", "total_sales", "measure_key")?.confidence, "high");
  assert.equal(matchField("销售", "销售（折扣后实收）", "measure_description")?.confidence, "medium");
  assert.equal(matchField("收入", "正文里提到收入", "wiki_body"), null);
  assert.equal(matchField("收入", "收入", "wiki_title")?.confidence, "high");
  // wiki_title 要求 exact／identifier，不接受纯 CJK 连接子串
  assert.equal(matchField("收入", "收入口径说明", "wiki_title"), null);
});

test("SC-id fence: valid and invalid concept ids", () => {
  assert.equal(CONCEPT_ID_RE.test("revenue"), true);
  assert.throws(() => assertValidConceptId("../etc"), /invalid/);
  assert.throws(() => assertValidConceptId("Revenue"), /invalid/);
  assert.throws(() => assertValidConceptId("a/b"), /invalid/);
});

test("SC-authority: null canonical requires zero canonical roles", () => {
  assert.throws(
    () =>
      assertAuthorityInvariant({
        id: "revenue",
        canonical: null,
        bindings: [{ bindingId: "measure:x/y/z", role: "canonical" }],
      }),
    /authority invariant/,
  );
  assert.doesNotThrow(() =>
    assertAuthorityInvariant({
      id: "revenue",
      canonical: "measure:x/y/z",
      bindings: [{ bindingId: "measure:x/y/z", role: "canonical" }],
    }),
  );
});

test("SC-conflicts: needs_authority when ≥2 live high candidates and no canonical", () => {
  const concept = {
    id: "revenue",
    canonical: null,
    bindings: [
      { bindingId: "a", role: "candidate", confidence: "high" },
      { bindingId: "b", role: "candidate", confidence: "high" },
      { bindingId: "c", role: "candidate", confidence: "medium" },
    ],
  };
  const { conflicts, conflicts_status } = deriveConflicts(concept, {
    assetStatus: () => "present",
    rematch: () => true,
  });
  assert.equal(conflicts_status, "ok");
  assert.equal(conflicts[0]?.code, "needs_authority");
  assert.deepEqual(conflicts[0].bindingIds.sort(), ["a", "b"]);
});

test("SC-conflicts: degraded when asset status unknown", () => {
  const concept = {
    id: "revenue",
    canonical: null,
    bindings: [
      { bindingId: "a", role: "candidate", confidence: "high" },
      { bindingId: "b", role: "candidate", confidence: "high" },
    ],
  };
  const { conflicts, conflicts_status } = deriveConflicts(concept, {
    assetStatus: () => "unknown",
    rematch: () => true,
  });
  assert.equal(conflicts_status, "degraded");
  assert.equal(conflicts.length, 0);
});

test("SC-currentlyMatches: rematch respects confidence", () => {
  const binding = {
    bindingId: "measure:demo/orders/total_sales",
    kind: "measure",
    role: "candidate",
    confidence: "high",
    ref: { connectionId: "demo", sourceName: "orders", measureKey: "total_sales" },
  };
  const ok = currentlyMatches(binding, ["total_sales", "sales"], () => [
    { value: "total_sales", kind: "measure_key" },
  ]);
  assert.equal(ok, true);
  const miss = currentlyMatches(binding, ["profit"], () => [
    { value: "total_sales", kind: "measure_key" },
  ]);
  assert.equal(miss, false);
  const unknown = currentlyMatches(binding, ["total_sales"], () => {
    throw new Error("io");
  });
  assert.equal(unknown, "unknown");
});
