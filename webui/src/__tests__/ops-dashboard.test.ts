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
      "近 7 天存在 ACL deny",
      "12 张表待补语义",
      "10 个 Catalog 对象待处理",
      "存在 3 个待发布文件",
      "近 30 天无评测数据"
    ]);
    expect(items[0]?.severity).toBe("critical");
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
      "触发首次 Run",
      "导入评测用例",
      "配置阈值"
    ]);
  });

  it("sorts severity so critical comes before warning before info", () => {
    expect(severityOrder.critical).toBeLessThan(severityOrder.warning);
    expect(severityOrder.warning).toBeLessThan(severityOrder.ready);
    expect(severityOrder.ready).toBeLessThan(severityOrder.info);
  });
});
