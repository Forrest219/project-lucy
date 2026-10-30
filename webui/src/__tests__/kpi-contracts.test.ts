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
      // Agent 名册 Spec SC-12 —— 「近 N 使用过的凭据」条目保留，但名册不再展示
      // 该卡和该列，因此这一条允许 pages 为空；其它条目仍至少有一页。
      if (c.id !== "used-credential-count") {
        expect(c.pages.length, `${c.id} must have at least one page`).toBeGreaterThan(0);
      }
      expect(typeof c.windowed, `${c.id}.windowed must be boolean`).toBe("boolean");
    }
  });

  it("SC-12 名册不再登记「近 N 使用过的凭据」，其它条目仍指向本页", () => {
    const used = getContract("used-credential-count");
    expect(used).toBeDefined();
    // 条目保留，帮助文案继续区分全量访问凭据与近 N 业务活跃 Token。
    expect(used!.help).toContain("全量访问");
    expect(used!.help).toContain("近 N 业务活跃 Token");
    expect(used!.pages).not.toContain("/admin/agents");
    expect(used!.pages).toEqual([]);

    // calls-7d 与活跃 Agent 仍登记在 /admin/agents。
    for (const id of ["calls-7d", "active-agent-count"]) {
      const contract = getContract(id);
      expect(contract, `${id} should be in registry`).toBeDefined();
      expect(contract!.pages).toContain("/admin/agents");
    }

    // 其它条目仍至少有一页。
    for (const c of KPI_REGISTRY) {
      if (c.id === "used-credential-count") continue;
      expect(c.pages.length, `${c.id} must have at least one page`).toBeGreaterThan(0);
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
    const windowed = ["active-agent-count", "active-token-count", "used-credential-count", "calls-7d", "active-table-count", "p95-latency"];
    for (const id of windowed) {
      const c = getContract(id);
      expect(c, `${id} should be in registry`).toBeDefined();
      expect(c!.windowed, `${id} should be windowed`).toBe(true);
    }
  });

  it("no longer registers the stale `calls` contract (superseded by calls-7d)", () => {
    // Spec 189 / WO T1: /admin/usage removed the 调用量 card, so the registry
    // entry that claimed /admin/governance/overview became a false contract.
    expect(getContract("calls")).toBeUndefined();
    expect(getContract("calls-7d")).toBeDefined();
  });

  it("usage KPI help texts state the default usage scope (Spec 189)", () => {
    // Guards the registry against regressing to "访问日志出现过" copy, which
    // would be a lie once protocol events leave the default usage KPI.
    for (const id of ["active-agent-count", "active-token-count", "calls-7d"]) {
      const c = getContract(id);
      expect(c, `${id} should be in registry`).toBeDefined();
      expect(c!.help, `${id} help must name the default usage scope`).toContain("默认用量业务调用");
      expect(c!.help, `${id} help must not claim raw access-log presence`).not.toContain("访问日志出现过");
    }
  });

  it("business-active token and used-credential contracts stay distinct (Spec 189)", () => {
    const business = getContract("active-token-count");
    const credentials = getContract("used-credential-count");
    expect(business).toBeDefined();
    expect(credentials).toBeDefined();
    expect(business!.help).toContain("D4");
    expect(credentials!.help).toContain("D4");
    expect(business!.help).toContain("默认用量业务调用");
    expect(credentials!.help).toContain("全量访问");
    // The two metrics may legitimately differ; they must never share copy.
    expect(business!.label).not.toBe(credentials!.label);
  });

  it("calls-7d uses the qualified business-call label (no unqualified 调用量)", () => {
    const c = getContract("calls-7d");
    expect(c).toBeDefined();
    expect(c!.label).toBe("近 7 天业务调用量");
  });

  it("real-question contracts stay distinct from business call volume", () => {
    const real = getContract("real-questions");
    const calls = getContract("calls-7d");
    const active = getContract("active-agent-count");
    const questionActive = getContract("question-active-agents");
    expect(real).toBeDefined();
    expect(real!.label).toBe("近 N 真实问询");
    expect(real!.label).not.toBe(calls!.label);
    expect(real!.help).not.toContain("业务调用量");
    expect(questionActive!.label).not.toBe(active!.label);
    expect(getContract("unreported-query-sessions")!.label).toBe("近 N 未上报查数会话");
    expect(getContract("connect-only-sessions")!.label).toBe("近 N 仅连接会话");
    expect(getContract("browse-without-ask-sessions")!.label).toBe("近 N 浏览未问会话");
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
