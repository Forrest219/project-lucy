// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildActionRequiredItems,
  buildServiceHealth,
  EVAL_MONITOR_EMPTY_ACTIONS,
  NO_ACTION_REQUIRED_MESSAGE,
  pendingSemanticCount,
  severityOrder
} from "../lib/opsDashboard";

describe("opsDashboard view model", () => {
  it("prioritizes semantic gaps, pending changes, eval gaps, and access risk", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingCatalogItems: 10,
      pendingPublishFiles: 3,
      evalRunsLast30d: 0,
      aclDenied7d: 2
    });
    expect(items.map((item) => item.label)).toEqual([
      "12 张表待补语义",
      "近 7 天存在 ACL 拒绝",
      "10 个 Catalog 对象待处理",
      "存在 3 个待发布文件",
      "近 30 天无评测数据"
    ]);
    expect(items[0]?.severity).toBe("critical");
    // 12/16 = 0.75 done, 0.25 gap ratio > 2/3 → the semantic-gap is now
    // classified as `critical` per M39 severity policy.
    expect(items.find((item) => item.id === "semantic-gap")?.severity).toBe("critical");
  });

  it("returns an empty queue when every input is healthy", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    expect(items).toEqual([]);
  });

  it("treats missing semantic coverage as not a blocker", () => {
    expect(pendingSemanticCount({ done: 0, total: 0 })).toBe(0);
  });

  it("builds a 4-up service health strip with stable order", () => {
    const items = buildServiceHealth({
      ktxAvailable: true,
      mcpReady: true,
      semanticCoverage: { done: 5, total: 10 },
      agentsEnabled: 2,
      agentsTotal: 3,
      enabledTokenCount: 4
    });
    expect(items.map((item) => item.key)).toEqual([
      "lucyMcp",
      "ktxRuntime",
      "semanticLayer",
      "agentAccess"
    ]);
    expect(items.find((item) => item.key === "semanticLayer")?.status).toBe("warning");
    expect(items.find((item) => item.key === "agentAccess")?.status).toBe("ready");
  });

  it("flags a missing KTX runtime as danger and missing agents as danger", () => {
    const items = buildServiceHealth({
      ktxAvailable: false,
      mcpReady: false,
      semanticCoverage: { done: 0, total: 0 },
      agentsEnabled: 0,
      agentsTotal: 0,
      enabledTokenCount: 0
    });
    expect(items.find((item) => item.key === "ktxRuntime")?.status).toBe("danger");
    expect(items.find((item) => item.key === "agentAccess")?.status).toBe("danger");
  });

  it("exposes the empty-state CTA list and no-action message as constants", () => {
    expect(NO_ACTION_REQUIRED_MESSAGE).toBe("暂无高优先级待处理事项");
    expect(EVAL_MONITOR_EMPTY_ACTIONS).toEqual([
      "触发首次运行",
      "导入评测用例",
      "配置阈值"
    ]);
  });

  it("sorts severity so critical comes before warning before info", () => {
    expect(severityOrder.critical).toBeLessThan(severityOrder.warning);
    expect(severityOrder.warning).toBeLessThan(severityOrder.ready);
    expect(severityOrder.ready).toBeLessThan(severityOrder.info);
  });

  it("maps every severity to a user-facing Chinese label", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 2, total: 16 },
      pendingCatalogItems: 4,
      pendingPublishFiles: 2,
      evalRunsLast30d: 0,
      aclDenied7d: 1
    });
    const allowedLabels = new Set(["高风险", "待处理", "提醒", "就绪"]);
    for (const item of items) {
      expect(allowedLabels.has(item.severityLabel)).toBe(true);
      // severityLabel must never be the raw English severity word.
      expect(item.severityLabel).not.toBe("Critical");
      expect(item.severityLabel).not.toBe("Warning");
      expect(item.severityLabel).not.toBe("Ready");
      expect(item.severityLabel).not.toBe("Info");
    }
    // ACL deny keeps the critical → 高风险 mapping.
    const acl = items.find((item) => item.id === "acl-deny");
    expect(acl?.severity).toBe("critical");
    expect(acl?.severityLabel).toBe("高风险");
  });

  it("labels a large semantic gap as critical and a small gap as warning", () => {
    const large = buildActionRequiredItems({
      semanticCoverage: { done: 2, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const gapLarge = large.find((item) => item.id === "semantic-gap");
    expect(gapLarge).toBeDefined();
    expect(gapLarge?.severity).toBe("critical");
    expect(gapLarge?.severityLabel).toBe("高风险");

    const small = buildActionRequiredItems({
      semanticCoverage: { done: 12, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const gapSmall = small.find((item) => item.id === "semantic-gap");
    expect(gapSmall).toBeDefined();
    expect(gapSmall?.severity).toBe("warning");
    expect(gapSmall?.severityLabel).toBe("待处理");

    const none = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    expect(none.find((item) => item.id === "semantic-gap")).toBeUndefined();
  });

  // M39 polish (MAJOR-2): boundary tests for the 2/3 threshold. The
  // helper treats `done * 3 < total` as critical and everything else
  // (where `done * 3 >= total` but `done < total`) as warning. These
  // three cases pin the exact behaviour at the boundary.
  it("boundary: done=5 total=15 -> warning (5*3=15 not < 15)", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 5, total: 15 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const gap = items.find((item) => item.id === "semantic-gap");
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe("warning");
    expect(gap?.severityLabel).toBe("待处理");
  });

  it("boundary: done=5 total=16 -> critical (5*3=15 < 16)", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 5, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const gap = items.find((item) => item.id === "semantic-gap");
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe("critical");
    expect(gap?.severityLabel).toBe("高风险");
  });

  it("boundary: done=4 total=13 -> critical (4*3=12 < 13)", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 13 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const gap = items.find((item) => item.id === "semantic-gap");
    expect(gap).toBeDefined();
    expect(gap?.severity).toBe("critical");
    expect(gap?.severityLabel).toBe("高风险");
  });

  it("downgrades the eval-gap severity from warning to info", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 0,
      aclDenied7d: 0
    });
    const evalGap = items.find((item) => item.id === "eval-gap");
    expect(evalGap).toBeDefined();
    expect(evalGap?.severity).toBe("info");
    expect(evalGap?.severityLabel).toBe("提醒");
  });

  it("attaches deterministic impact / owner / evidence / updatedAtLabel metadata to every action item", () => {
    const dashboardUpdatedAt = new Date("2026-08-01T10:12:00.000Z");
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingCatalogItems: 5,
      pendingPublishFiles: 3,
      evalRunsLast30d: 0,
      aclDenied7d: 2,
      dashboardUpdatedAt
    });
    const expected: Record<string, { impact: string; owner: string; evidence: string }> = {
      "semantic-gap": {
        impact: "问答召回率",
        owner: "数据治理组",
        evidence: "语义覆盖 4/16"
      },
      "catalog-pending": {
        impact: "资产同步",
        owner: "架构组",
        evidence: "Catalog 待处理 5 项"
      },
      "publish-pending": {
        impact: "发布一致性",
        owner: "语义发布负责人",
        evidence: "diff files: 3"
      },
      "eval-gap": {
        impact: "质量基线",
        owner: "QA 团队",
        evidence: "近 30 天无评测数据"
      },
      "acl-deny": {
        impact: "访问安全",
        owner: "访问治理组",
        evidence: "ACL 拒绝: 2"
      }
    };
    for (const item of items) {
      const want = expected[item.id];
      expect(want, `unexpected action item id: ${item.id}`).toBeDefined();
      expect(item.impact).toBe(want.impact);
      expect(item.owner).toBe(want.owner);
      expect(item.evidence).toBe(want.evidence);
      // updatedAtLabel is generated from dashboardUpdatedAt (formatted as
      // "今天 HH:mm"). The exact time depends on the test runner timezone;
      // we only assert that the label is a non-empty string when an updated
      // time is provided.
      expect(item.updatedAtLabel).toBeTruthy();
    }
  });

  it("renders '更新时间未知' when dashboardUpdatedAt is omitted", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 0,
      aclDenied7d: 0
    });
    for (const item of items) {
      expect(item.updatedAtLabel).toBe("更新时间未知");
    }
  });

  it("uses 'ACL 拒绝' user-facing copy with no English 'deny' substring", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 4
    });
    const acl = items.find((item) => item.id === "acl-deny");
    expect(acl).toBeDefined();
    expect(acl?.label).toContain("拒绝");
    expect(acl?.label).not.toContain("deny");
    expect(acl?.label).not.toMatch(/Deny/);
    expect(acl?.evidence).toContain("拒绝");
    expect(acl?.evidence).not.toContain("deny");
  });

  // M39 polish (MINOR-1): negative-input guards. A buggy upstream ETL
  // payload (e.g. an unsigned int that overflowed into a negative value)
  // used to leak a phantom "−5 张表待补语义" item into the queue. The
  // helper now clamps every count to >= 0 so downstream rendering can
  // trust the numbers.
  it("clamps negative pendingCatalogItems to zero", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingCatalogItems: -5,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const catalog = items.find((item) => item.id === "catalog-pending");
    expect(catalog).toBeUndefined();
  });

  it("clamps negative pendingPublishFiles to zero", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: -3,
      evalRunsLast30d: 5,
      aclDenied7d: 0
    });
    const publish = items.find((item) => item.id === "publish-pending");
    expect(publish).toBeUndefined();
  });

  it("clamps negative aclDenied7d to zero (no phantom critical item)", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: 5,
      aclDenied7d: -2
    });
    const acl = items.find((item) => item.id === "acl-deny");
    expect(acl).toBeUndefined();
  });
});
