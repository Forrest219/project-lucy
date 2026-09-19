// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  availableTokenCount,
  buildActionRequiredItems,
  buildServiceHealth,
  EVAL_MONITOR_EMPTY_ACTIONS,
  isTokenAvailable,
  NO_ACTION_REQUIRED_MESSAGE,
  pendingSemanticCount,
  severityOrder
} from "../lib/opsDashboard";
import type { Agent, TokenSummary } from "../lib/types";

describe("opsDashboard view model", () => {
  it("prioritizes semantic gaps, pending changes, and eval gaps", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingPublishFiles: 3,
      evalRunsLast30d: 0
    });
    expect(items.map((item) => item.title)).toEqual([
      "12 张表待补语义",
      "存在 3 个待发布文件",
      "近 30 天无评测数据"
    ]);
    expect(items.find((item) => item.id === "semantic-gap")?.severity).toBe("warning");
    expect(items.find((item) => item.id === "catalog-pending")).toBeUndefined();
  });

  it("returns an empty queue when every input is healthy", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
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
      availableTokenCount: 4
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
      availableTokenCount: 0
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

  it("keeps action items fact-based with required impact/evidence and Registry URLs", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 2, total: 16 },
      pendingPublishFiles: 2,
      evalRunsLast30d: 0
    });
    for (const item of items) {
      expect(item.title).toBeTruthy();
      expect(item.description).toBeTruthy();
      expect(item.actionText).toBeTruthy();
      expect(item.actionUrl).toBeTruthy();
      expect(item.impact).toBeTruthy();
      expect(item.evidence).toBeTruthy();
      expect("owner" in item).toBe(false);
      expect("updatedAtLabel" in item).toBe(false);
      expect(item.actionUrl.includes("status=partial")).toBe(false);
      expect(item.actionUrl === "/?status=partial").toBe(false);
    }
    const semantic = items.find((item) => item.id === "semantic-gap");
    expect(semantic?.actionUrl).toBe("/catalog?completion=incomplete");
    expect(items.find((item) => item.id === "acl-deny")).toBeUndefined();
    expect(items.find((item) => item.id === "catalog-pending")).toBeUndefined();
  });

  it("never surfaces acl-deny or catalog-pending in the action-required queue", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
    });
    expect(items.find((item) => item.id === "acl-deny")).toBeUndefined();
    expect(items.find((item) => item.id === "catalog-pending")).toBeUndefined();
    expect(items.some((item) => item.title.includes("ACL"))).toBe(false);
  });

  it("labels every semantic gap as warning, including large gaps (Spec 142)", () => {
    const large = buildActionRequiredItems({
      semanticCoverage: { done: 2, total: 16 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
    });
    expect(large.find((item) => item.id === "semantic-gap")?.severity).toBe("warning");

    const small = buildActionRequiredItems({
      semanticCoverage: { done: 12, total: 16 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
    });
    expect(small.find((item) => item.id === "semantic-gap")?.severity).toBe("warning");

    const none = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
    });
    expect(none.find((item) => item.id === "semantic-gap")).toBeUndefined();
  });

  it("does not escalate a large gap to critical at the old 2/3 boundary", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 5, total: 16 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 5
    });
    expect(items.find((item) => item.id === "semantic-gap")?.severity).toBe("warning");
  });

  it("downgrades the eval-gap severity from warning to info", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingPublishFiles: 0,
      evalRunsLast30d: 0
    });
    const evalGap = items.find((item) => item.id === "eval-gap");
    expect(evalGap).toBeDefined();
    expect(evalGap?.severity).toBe("info");
  });

  it("omits the eval-gap item when evalRunsLast30d is null (still loading or errored)", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingPublishFiles: 0,
      evalRunsLast30d: null
    });
    const evalGap = items.find((item) => item.id === "eval-gap");
    expect(evalGap).toBeUndefined();
  });

  it("folds real supporting counts into title or description", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingPublishFiles: 3,
      evalRunsLast30d: 0
    });
    const expected: Record<string, { text: string }> = {
      "semantic-gap": {
        text: "当前语义覆盖 4/16，仍有 12 张表缺少可用语义"
      },
      "publish-pending": { text: "当前有 3 个语义变更尚未发布" },
      "eval-gap": { text: "尚未检测到近 30 天评测运行记录" }
    };
    for (const item of items) {
      const want = expected[item.id];
      expect(want, `unexpected action item id: ${item.id}`).toBeDefined();
      expect(`${item.title} ${item.description}`).toContain(want.text);
    }
  });

  it("clamps negative pendingPublishFiles to zero", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 16, total: 16 },
      pendingPublishFiles: -3,
      evalRunsLast30d: 5
    });
    const publish = items.find((item) => item.id === "publish-pending");
    expect(publish).toBeUndefined();
  });

  it("counts only usable tokens on enabled agents", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const future = "2027-01-01T00:00:00Z";
    const past = "2026-06-24T00:00:00Z";
    const agents: Agent[] = [
      {
        id: "agent-enabled",
        name: "enabled-agent",
        enabled: true,
        role: "analyst",
        tokens: [
          { hash: "h1", label: "fresh", created: now.toISOString(), expires_at: future },
          { hash: "h2", label: "expired", created: now.toISOString(), expires_at: past, revoked: true },
          { hash: "h3", label: "past", created: now.toISOString(), expires_at: past }
        ]
      },
      {
        id: "agent-disabled",
        name: "disabled-agent",
        enabled: false,
        role: "analyst",
        tokens: [
          { hash: "h4", label: "future", created: now.toISOString(), expires_at: future }
        ]
      }
    ];
    expect(availableTokenCount(agents, now)).toBe(1);
  });

  it("treats unparseable expires_at as not available", () => {
    const now = new Date("2026-08-01T00:00:00Z");
    const bad: TokenSummary = {
      hash: "h6",
      label: "bad-string",
      created: "2026-01-01T00:00:00Z",
      expires_at: "not-a-date"
    };
    const forever: TokenSummary = {
      hash: "h5",
      label: "no-expires",
      created: "2026-01-01T00:00:00Z",
      expires_at: null
    };
    expect(isTokenAvailable(forever, now)).toBe(true);
    expect(isTokenAvailable(bad, now)).toBe(false);
  });
});
