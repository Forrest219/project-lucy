/**
 * WO-202610-14 T4 / SC-23 — 广告日表消歧.
 *
 * An ambiguous column or measure returns an ACL-scoped list of qualified
 * `source.field` names and never generates a join. Independent of the
 * publish gate (T5): this test does not call it, and it uses demo fixtures —
 * no MJ advertising-table YAML is committed.
 */
import { describe, expect, it } from "vitest";
import {
  ambiguousFieldCandidates,
  ambiguousFieldHint,
  qualifiedName,
  resolveSourceAlias,
  type AmbiguityCandidateInput
} from "../proxy/source-ambiguity.js";

/** Demo fixtures only: the repo ships no customer advertising-table YAML. */
const AD_SOURCES: AmbiguityCandidateInput[] = [
  {
    connectionId: "demo-mysql",
    schema: "ads",
    sourceName: "ad_cost_daily",
    columns: [{ name: "date" }, { name: "spend" }, { name: "campaign_id" }],
    measures: [{ name: "total_spend" }, { name: "campaign_total" }]
  },
  {
    connectionId: "demo-mysql",
    schema: "ads",
    sourceName: "ad_revenue_daily",
    columns: [{ name: "date" }, { name: "revenue" }, { name: "campaign_id" }],
    // `campaign_total` deliberately appears in both sources.
    measures: [{ name: "total_revenue" }, { name: "campaign_total" }]
  }
];

describe("ambiguous source hint (SC-23)", () => {
  it("returns ACL-scoped qualified names for an ambiguous column", () => {
    const hint = ambiguousFieldHint({ kind: "column", field: "campaign_id", sources: AD_SOURCES });
    expect(hint).not.toBeNull();
    expect(hint?.candidates.map((candidate) => candidate.name)).toEqual([
      "ad_cost_daily.campaign_id",
      "ad_revenue_daily.campaign_id"
    ]);
    expect(hint?.repair).toContain("ad_cost_daily.campaign_id");
    expect(hint?.repair).toContain("ad_revenue_daily.campaign_id");
  });

  it("never generates a join", async () => {
    const hint = ambiguousFieldHint({ kind: "measure", field: "campaign_total", sources: AD_SOURCES });
    expect(hint).not.toBeNull();
    expect(hint?.candidates.map((candidate) => candidate.name)).toEqual([
      "ad_cost_daily.campaign_total",
      "ad_revenue_daily.campaign_total"
    ]);
    expect(hint?.autoJoinGenerated).toBe(false);
    // The hint carries names only: no join clause, no rewritten query.
    const serialized = JSON.stringify(hint);
    expect(serialized).not.toMatch(/\bjoin\b/i);
    for (const candidate of hint?.candidates ?? []) {
      // Each candidate is a bare qualified name — nothing relational.
      expect(candidate.name.split(".")).toHaveLength(2);
      expect(Object.keys(candidate).sort()).toEqual(["connectionId", "field", "name", "schema", "sourceName"]);
    }
  });

  it("returns nothing when the name is unambiguous", () => {
    expect(ambiguousFieldHint({ kind: "column", field: "spend", sources: AD_SOURCES })).toBeNull();
    expect(ambiguousFieldHint({ kind: "column", field: "unknown_column", sources: AD_SOURCES })).toBeNull();
    expect(ambiguousFieldHint({ kind: "column", field: "", sources: AD_SOURCES })).toBeNull();
  });

  it("never lists a source outside the caller's readable set", () => {
    // Only one source is readable for this role.
    const readable: AmbiguityCandidateInput[] = [AD_SOURCES[0]!];
    // Not ambiguous across one readable source → no hint, and no leak.
    expect(ambiguousFieldHint({ kind: "column", field: "campaign_id", sources: readable })).toBeNull();

    const candidates = ambiguousFieldCandidates(readable, "campaign_id");
    expect(candidates.map((candidate) => candidate.name)).toEqual(["ad_cost_daily.campaign_id"]);
    expect(JSON.stringify(candidates)).not.toContain("ad_revenue_daily");
  });

  it("builds a qualified name from connection, schema and source", () => {
    expect(qualifiedName({ connectionId: "demo-mysql", schema: "ads", sourceName: "ad_cost_daily", field: "spend" }))
      .toEqual({
        name: "ad_cost_daily.spend",
        connectionId: "demo-mysql",
        schema: "ads",
        sourceName: "ad_cost_daily",
        field: "spend"
      });
  });

  it("de-duplicates a source listed twice", () => {
    const duplicated = [AD_SOURCES[0]!, AD_SOURCES[0]!, AD_SOURCES[1]!];
    const candidates = ambiguousFieldCandidates(duplicated, "campaign_id");
    expect(candidates.length).toBe(2);
  });
});

describe("physical name alias resolution", () => {
  const ALIASES = [
    { physicalTable: "ads.ai_ad_cost_daily", sourceName: "ad_cost_daily", connectionId: "demo-mysql", schema: "ads" }
  ];

  it("resolves a published alias to its semantic source", () => {
    const resolution = resolveSourceAlias(
      "ads.ai_ad_cost_daily",
      ALIASES,
      new Set(["ad_cost_daily", "ad_revenue_daily"])
    );
    expect(resolution.status).toBe("resolved");
    if (resolution.status !== "resolved") return;
    expect(resolution.sourceName).toBe("ad_cost_daily");
    expect(resolution.connectionId).toBe("demo-mysql");
  });

  it("keeps source not found with a repair hint when no alias is published", () => {
    const resolution = resolveSourceAlias("ads.never_published_table", ALIASES, new Set(["ad_cost_daily"]));
    expect(resolution.status).toBe("not_found");
    if (resolution.status !== "not_found") return;
    expect(resolution.repair).toContain("never_published_table");
    expect(resolution.repair).toContain("别名");
  });

  it("does not resolve an alias whose target the role cannot read", () => {
    const resolution = resolveSourceAlias(
      "ads.ai_ad_cost_daily",
      ALIASES,
      new Set(["ad_revenue_daily"])
    );
    expect(resolution.status).toBe("not_found");
    if (resolution.status !== "not_found") return;
    expect(resolution.repair).toContain("无权读取");
    expect(JSON.stringify(resolution)).not.toContain("ad_cost_daily\"");
  });

  it("does not depend on the publish gate being open", async () => {
    // SC-23 holds with the gate closed: this path never calls the gate.
    const gate = await import("../publish-gate.js");
    const verdict = gate.evaluatePublishGate(
      [{ checkId: "columns.0.type", message: "bad type" }],
      null,
      new Date()
    );
    expect(verdict.allowed).toBe(false);

    // Disambiguation still works with the gate rejecting the publish.
    const hint = ambiguousFieldHint({ kind: "column", field: "campaign_id", sources: AD_SOURCES });
    expect(hint?.autoJoinGenerated).toBe(false);
  });
});