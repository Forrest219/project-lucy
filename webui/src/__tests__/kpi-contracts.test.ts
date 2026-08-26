import { describe, expect, it } from "vitest";
import {
  KPI_REGISTRY,
  LIST_KPI_CONTRACTS,
  getContract,
  type MetricContract
} from "../lib/kpiContracts";

describe("KPI_REGISTRY", () => {
  it("has no duplicate ids", () => {
    const ids = KPI_REGISTRY.map((c) => c.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("every entry has required fields", () => {
    for (const c of KPI_REGISTRY) {
      expect(c.id, `${c.id} must have id`).toBeTruthy();
      expect(c.kind, `${c.id} must have kind`).toMatch(/^(list_kpi|ops|summary)$/);
      expect(c.label, `${c.id} must have label`).toBeTruthy();
      expect(c.help, `${c.id} must have help`).toBeTruthy();
      expect(c.pages, `${c.id} must have pages array`).toBeInstanceOf(Array);
      expect(c.pages.length, `${c.id} must have at least one page`).toBeGreaterThan(0);
      expect(typeof c.windowed, `${c.id}.windowed must be boolean`).toBe("boolean");
    }
  });

  it("active-token-count references D4 in help text", () => {
    const c = getContract("active-token-count");
    expect(c).toBeDefined();
    expect(c!.help).toContain("D4");
  });

  it("pass-rate help references D2 denominator rule (SKIP included)", () => {
    const c = getContract("pass-rate");
    expect(c).toBeDefined();
    expect(c!.help.toLowerCase()).toContain("skip");
  });

  it("config-class KPIs (agent-count, configured-token-count) are not windowed", () => {
    const nonWindowed = ["agent-count", "configured-token-count", "configured-table-count", "total-cases"];
    for (const id of nonWindowed) {
      const c = getContract(id);
      expect(c, `${id} should be in registry`).toBeDefined();
      expect(c!.windowed, `${id} should not be windowed (config-class per D1)`).toBe(false);
    }
  });

  it("audit-based KPIs are windowed", () => {
    const windowed = ["active-agent-count", "active-token-count", "calls-7d", "calls", "active-table-count", "p95-latency"];
    for (const id of windowed) {
      const c = getContract(id);
      expect(c, `${id} should be in registry`).toBeDefined();
      expect(c!.windowed, `${id} should be windowed`).toBe(true);
    }
  });

  it("LIST_KPI_CONTRACTS contains only list_kpi entries", () => {
    for (const c of LIST_KPI_CONTRACTS) {
      expect(c.kind).toBe("list_kpi");
    }
  });

  it("summary contracts exist and are kind=summary", () => {
    const summaryContracts = KPI_REGISTRY.filter((c) => c.kind === "summary");
    expect(summaryContracts.length).toBeGreaterThan(0);
    for (const c of summaryContracts) {
      expect(c.kind).toBe("summary");
    }
  });

  it("getContract returns undefined for unknown id", () => {
    expect(getContract("nonexistent-metric-id-xyz")).toBeUndefined();
  });

  it("all list_kpi have helpId-compatible ids (no spaces, lowercase-kebab)", () => {
    for (const c of LIST_KPI_CONTRACTS) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("MetricContract shape type-check", () => {
  it("KPI_REGISTRY satisfies MetricContract[] shape", () => {
    // Type-level check: if this compiles, shape is correct
    const _check: MetricContract[] = KPI_REGISTRY;
    expect(_check).toBeDefined();
  });
});
