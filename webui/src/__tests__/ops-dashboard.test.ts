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
    expect(items.map((item) => item.title)).toEqual([
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
      pendingCatalogItems: 4,
      pendingPublishFiles: 2,
      evalRunsLast30d: 0,
      aclDenied7d: 1
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
    const acl = items.find((item) => item.id === "acl-deny");
    expect(acl?.severity).toBe("critical");
    expect(acl?.actionUrl).toBe("/admin/audit?tab=calls&outcome=denied&hours=168");
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
  });

  it("omits the eval-gap item when evalRunsLast30d is null (still loading or errored)", () => {
    // M39 review follow-up (P2-B): when the eval probe hasn't returned
    // data yet, passing `null` must suppress the item entirely so the
    // dashboard never fabricates a misleading "近 30 天无评测数据"
    // against unknown data. Collapsing `null` to `0` (the previous
    // behaviour) used to surface that item during both initial load and
    // errored states.
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 8, total: 8 },
      pendingCatalogItems: 0,
      pendingPublishFiles: 0,
      evalRunsLast30d: null,
      aclDenied7d: 0
    });
    const evalGap = items.find((item) => item.id === "eval-gap");
    expect(evalGap).toBeUndefined();
  });

  it("folds real supporting counts into title or description", () => {
    const items = buildActionRequiredItems({
      semanticCoverage: { done: 4, total: 16 },
      pendingCatalogItems: 5,
      pendingPublishFiles: 3,
      evalRunsLast30d: 0,
      aclDenied7d: 2
    });
    const expected: Record<string, { text: string }> = {
      "semantic-gap": {
        text: "当前语义覆盖 4/16，仍有 12 张表缺少可用语义"
      },
      "catalog-pending": { text: "Catalog 同步发现 5 个对象同步不完整（部分字段或元数据缺失）" },
      "publish-pending": { text: "当前有 3 个语义变更尚未发布" },
      "eval-gap": { text: "尚未检测到近 30 天评测运行记录" },
      "acl-deny": { text: "访问日志记录到 2 次 ACL 拒绝" }
    };
    for (const item of items) {
      const want = expected[item.id];
      expect(want, `unexpected action item id: ${item.id}`).toBeDefined();
      expect(`${item.title} ${item.description}`).toContain(want.text);
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
    expect(acl?.title).toContain("拒绝");
    expect(acl?.title).not.toContain("deny");
    expect(acl?.title).not.toMatch(/Deny/);
    expect(acl?.description).toContain("拒绝");
    expect(acl?.description).not.toContain("deny");
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
