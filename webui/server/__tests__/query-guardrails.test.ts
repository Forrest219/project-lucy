/**
 * WO-202610-15 T1 / T2 — measures, disambiguation, and aliases on the call path.
 *
 * Fixtures stand in for a published semantic layer. The proxy source assertion
 * checks that the guard runs before lucy_query is rewritten for forwarding.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  applyLucyCallGuard,
  loadAmbiguityCatalogFromDir,
  queryGuardrailsEnabled,
  type AmbiguityCatalog
} from "../proxy/query-guardrails.js";
import type { AmbiguityCandidateInput } from "../proxy/source-ambiguity.js";

const AD_SOURCES: AmbiguityCandidateInput[] = [
  {
    connectionId: "demo-mysql",
    schema: "ads",
    sourceName: "ad_cost_daily",
    columns: [{ name: "date" }, { name: "campaign_id" }],
    measures: [{ name: "total_spend" }]
  },
  {
    connectionId: "demo-mysql",
    schema: "ads",
    sourceName: "ad_revenue_daily",
    columns: [{ name: "date" }, { name: "campaign_id" }],
    measures: [{ name: "total_revenue" }]
  },
  {
    connectionId: "demo-mysql",
    schema: "ads",
    sourceName: "ad_secret_daily",
    columns: [{ name: "campaign_id" }],
    measures: []
  }
];

const CATALOG: AmbiguityCatalog = {
  sources: AD_SOURCES,
  aliases: [
    { physicalTable: "ads.ai_ad_cost_daily", sourceName: "ad_cost_daily", connectionId: "demo-mysql", schema: "ads" }
  ],
  aggregatedMeasures: [{ source: "ad_cost_daily", name: "total_spend" }]
};

const READABLE = new Set(["ad_cost_daily", "ad_revenue_daily"]);

describe("lucy_query measure guard (SC-15)", () => {
  it("stops count(*) when no source is named", () => {
    const guard = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { measures: ["count(*)"] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(guard.action).toBe("stop");
    if (guard.action !== "stop") return;
    expect(guard.reason).toBe("count_without_source");
    expect(guard.failureDimension).toBe("用法与语义");
    expect(guard.repair).toContain("row_count");
  });

  it("allows count(*) once a source is named", () => {
    const guard = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { sourceName: "ad_cost_daily", measures: ["count(*)"] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(guard.action).toBe("allow");
  });

  it("stops a literal sum(sum()) and a sum over an already aggregated measure", () => {
    const literal = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { sourceName: "ad_cost_daily", measures: ["sum(sum(amount))"] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(literal.action).toBe("stop");
    if (literal.action === "stop") {
      expect(literal.reason).toBe("aggregate_of_aggregate");
      expect(literal.repair).not.toContain("sum(sum");
    }

    const named = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { sourceName: "ad_cost_daily", measures: ["sum(total_spend)"] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(named.action).toBe("stop");
    if (named.action === "stop") expect(named.reason).toBe("aggregate_of_aggregate");
  });

  it("stops completeness when no denominator is declared", () => {
    const guard = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { sourceName: "ad_cost_daily", measures: ["completeness"] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(guard.action).toBe("stop");
    if (guard.action !== "stop") return;
    expect(guard.reason).toBe("completeness_denominator_required");
  });
});

describe("lucy_query disambiguation and lucy_read_source aliases (SC-23)", () => {
  it("returns ACL-scoped qualified names and does not generate a join", () => {
    const guard = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { dimensions: [{ field: "campaign_id" }] },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(guard.action).toBe("stop");
    if (guard.action !== "stop") return;
    expect(guard.reason).toBe("ambiguous_field");
    expect(guard.repair).toContain("ad_cost_daily.campaign_id");
    expect(guard.repair).toContain("ad_revenue_daily.campaign_id");
    expect(guard.repair).not.toContain("ad_secret_daily");
    expect(guard.repair).not.toMatch(/\bjoin\b/i);
  });

  it("skips disambiguation when permissions are unknown and still runs the measure guard", () => {
    const ambiguous = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { dimensions: [{ field: "campaign_id" }] },
      readableSourceNames: null,
      catalog: CATALOG
    });
    expect(ambiguous.action).toBe("allow");

    const measure = applyLucyCallGuard({
      toolName: "lucy_query",
      args: { measures: ["count(*)"] },
      readableSourceNames: null,
      catalog: CATALOG
    });
    expect(measure.action).toBe("stop");
  });

  it("allows a readable source name and rewrites a published physical alias", () => {
    const direct = applyLucyCallGuard({
      toolName: "lucy_read_source",
      args: { sourceName: "ad_cost_daily" },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(direct).toEqual({ action: "allow", args: { sourceName: "ad_cost_daily" } });

    const aliased = applyLucyCallGuard({
      toolName: "lucy_read_source",
      args: { sourceName: "ads.ai_ad_cost_daily" },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(aliased.action).toBe("allow");
    if (aliased.action !== "allow") return;
    expect(aliased.args.sourceName).toBe("ad_cost_daily");
    expect(aliased.args.connectionId).toBe("demo-mysql");
  });

  it("returns source not found with a repair hint when no alias is published", () => {
    const guard = applyLucyCallGuard({
      toolName: "lucy_read_source",
      args: { sourceName: "ads.never_published_table" },
      readableSourceNames: READABLE,
      catalog: CATALOG
    });
    expect(guard.action).toBe("stop");
    if (guard.action !== "stop") return;
    expect(guard.reason).toBe("source_not_found");
    expect(guard.repair).toContain("never_published_table");
  });
});

describe("published catalog loader", () => {
  it("reads aggregated measures and physical aliases from the demo semantic layer", async () => {
    const semanticLayer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../semantic-layer");
    const catalog = await loadAmbiguityCatalogFromDir(semanticLayer);
    expect(catalog.aggregatedMeasures).toEqual(
      expect.arrayContaining([{ source: "superstore_orders", name: "total_sales" }])
    );
    expect(catalog.aliases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          physicalTable: "dataforai.superstore_orders",
          sourceName: "superstore_orders"
        })
      ])
    );
  });
});

describe("proxy call order", () => {
  it("runs the guard before lucy_query is rewritten for forwarding", async () => {
    const source = await readFile(new URL("../proxy/mcp-proxy.ts", import.meta.url), "utf8");
    const guardAt = source.indexOf("applyLucyCallGuard({");
    const forwardAt = source.indexOf("lucyQueryUpstreamArgs(toolArgs)");
    const budgetAt = source.indexOf("questionBudget.consume(");
    expect(guardAt).toBeGreaterThan(0);
    expect(forwardAt).toBeGreaterThan(guardAt);
    expect(budgetAt).toBeGreaterThan(guardAt);
    expect(source).toContain("questionBudget.ensureTurn");
    expect(source).toContain("queryGuardrailsEnabled()");
    const previous = process.env.LUCY_QUERY_GUARDRAILS;
    process.env.LUCY_QUERY_GUARDRAILS = "off";
    expect(queryGuardrailsEnabled()).toBe(false);
    delete process.env.LUCY_QUERY_GUARDRAILS;
    expect(queryGuardrailsEnabled()).toBe(true);
    if (previous !== undefined) process.env.LUCY_QUERY_GUARDRAILS = previous;
  });
});
