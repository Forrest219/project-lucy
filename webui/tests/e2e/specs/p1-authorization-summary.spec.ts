// webui/tests/e2e/specs/p1-authorization-summary.spec.ts
// Lucy v0.25 P1-2 — 授权摘要（浏览器验收）
//
// 权威 Spec：docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md
//   §2.1（快照与状态）、§2.2（计数口径）、§3（授权摘要读取模型）、§4（页面与 API 合同）、
//   §6（一致性与降级）、§8（ASV-04／ASV-10／ASV-11／ASV-14）。
//
// 标签：@p1-acceptance
//
// 浏览器层只验证**用户看得见的行为**：深链与 URL、不可用/null 的表达、
// 摘要与访问关系图的分列、受保护标识的翻译防御。
// 服务端语义（计数口径推导、摘要派生算法）由 vitest 覆盖，本文件不重复。
//
// 全部 API 用 `page.route("**/api/**")` mock，形状与
//   webui/server/admin/routes/authorization-summary.ts
//   webui/server/admin/authorization-summary.ts
//   webui/src/components/admin/AuthorizationTypes.tsx
// 的真实返回逐字一致。

import { expect, test, type Locator, type Page } from "@playwright/test";

type SummaryOverrides = {
  headline?: Record<string, unknown>;
  actions?: Record<string, unknown>;
  summaryContext?: Record<string, unknown>;
};

/**
 * 一份完整的授权摘要（Agent 视图）。
 *
 * 默认口径：1 个连接 / 1 张表 / 分母 3 / 1 张受限表 / 有三条深链 /
 * 2 个受影响 Agent。单个用例只改自己关心的一块。
 */
function buildSummary(overrides: SummaryOverrides = {}) {
  return {
    summaryContext: {
      subject: { kind: "agent", id: "demo_agent" },
      basis: "committed",
      configVersion: "cfg-0001",
      policyVersion: "pol-0001",
      sourceMapVersion: "smap-0001",
      capabilityDigest: "cap-0001",
      snapshotHash: "snapshot-1",
      state: "ok",
      problem: null,
      failures: [],
      candidateDigest: null,
      candidateOnly: false,
      ...(overrides.summaryContext ?? {})
    },
    headline: {
      connectionCount: 1,
      tableCount: 1,
      enabledTableCount: 3,
      enabledTableDenominatorUnavailableReason: null,
      scopedTableCount: 1,
      scopedTableCountBasis: "final_rows",
      grantPathCount: 1,
      state: "ok",
      ...(overrides.headline ?? {})
    },
    resources: [
      {
        connectionId: "mysql-aliyun",
        schemas: [
          {
            schema: "finance",
            tables: [
              {
                sourceKey: "mysql-aliyun::finance::orders",
                connectionId: "mysql-aliyun",
                schema: "finance",
                sourceName: "orders",
                physicalTable: "finance.orders",
                roleIds: ["analyst"],
                capabilities: [
                  {
                    tool: "lucy_query",
                    rowGrant: { kind: "scoped", digest: "digest-1", predicates: [], orArms: [] },
                    finalRows: { kind: "scoped", digest: "digest-1", predicates: [], orArms: [] }
                  }
                ],
                rowSummary: {
                  kind: "scoped",
                  basis: "final_rows",
                  displayShape: "OR-of-AND",
                  agentFinalRowsAvailable: true,
                  agentPersonalLimitsApplied: false,
                  templateRefs: [],
                  constraintSummary: "region_code 等于 CN-EAST",
                  orArms: ["region_code 等于 CN-EAST"],
                  digest: "digest-1"
                },
                playgroundUrl:
                  "/admin/mcp-playground?agentId=demo_agent&mode=dry-run&tool=lucy_query&args=%7B%22connectionId%22%3A%22mysql-aliyun%22%2C%22sourceName%22%3A%22orders%22%7D"
              }
            ]
          }
        ]
      }
    ],
    tools: {
      query: ["lucy_query"],
      semanticRead: [],
      wikiRead: [],
      write: [],
      meta: []
    },
    unclassifiedTools: [],
    actions: {
      playgroundUrl:
        "/admin/mcp-playground?agentId=demo_agent&mode=dry-run&tool=lucy_query&args=%7B%22connectionId%22%3A%22mysql-aliyun%22%2C%22sourceName%22%3A%22orders%22%7D",
      accessMapUrl: "/admin/access-map?agent=demo_agent",
      rowPolicyViewUrl: "/admin/row-policies?connectionId=mysql-aliyun&schema=finance&sourceName=orders",
      referencingAgentIds: ["demo_agent_2", "demo_agent_3"],
      ...(overrides.actions ?? {})
    },
    roleContributions: [{ roleId: "analyst", ok: true, tableCount: 1 }],
    legacyAllow: false,
    diagnostics: []
  };
}

/** 最小可用的访问关系图响应（供 ASV-11 的「分列」断言落到独立页）。 */
function accessMapResponse() {
  const nodes = [
    {
      id: "agent:demo_agent",
      kind: "agent",
      label: "demo_agent",
      depth: 0,
      meta: { grantUsers: 1, grantPaths: 1, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: "role:analyst",
      kind: "role",
      label: "analyst",
      depth: 1,
      parentId: "agent:demo_agent",
      meta: { grantUsers: 1, grantPaths: 1, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: "conn:mysql-aliyun",
      kind: "connection",
      label: "mysql-aliyun",
      depth: 2,
      parentId: "role:analyst",
      meta: { grantUsers: 1, grantPaths: 1, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: "table:mysql-aliyun::finance::orders",
      kind: "table",
      label: "orders",
      depth: 3,
      parentId: "conn:mysql-aliyun",
      meta: { grantUsers: 1, grantPaths: 1, accessUsers: 1, accessPaths: 1 }
    }
  ];
  const edges = [
    {
      id: "e|agent:demo_agent|role:analyst",
      source: "agent:demo_agent",
      target: "role:analyst",
      grantPaths: 1,
      grantUsers: 1,
      accessPaths: 1,
      accessUsers: 1,
      accessCalls: 3,
      state: "normal",
      confirmedUnauthorized: false,
      reviewEvaluations: [],
      snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 }
    }
  ];
  return {
    ok: true,
    data: {
      meta: {
        window: {
          startIso: "2026-10-18T00:00:00.000Z",
          endIso: "2026-10-25T00:00:00.000Z",
          asOf: "2026-10-25T00:00:00.000Z"
        },
        grant: {
          state: "ok",
          problem: null,
          accessConfigVersion: "cfg-0001",
          policyVersion: "pol-0001",
          sourceMapVersion: "smap-0001",
          capabilityDigest: "cap-0001",
          failures: []
        },
        access: {
          state: "ok",
          trust: "confirmed",
          deniedCalls: 0,
          rawCalls: 3
        },
        counts: {
          agents: 1,
          roles: 1,
          connections: 1,
          schemas: 1,
          tables: 1,
          tokens: 0,
          edges: 1,
          grantPaths: 1,
          grantUsers: 1,
          accessPaths: 1,
          accessUsers: 1
        },
        signals: { dormantEdges: 0, needsReviewEdges: 0, confirmedUnauthorizedEdges: 0 },
        snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 },
        orphanGrants: 0,
        folded: { nodes: 0, edges: 0 },
        countingNotes: []
      },
      nodes,
      edges,
      render: { nodes, edges, folded: { nodes: 0, edges: 0 } }
    }
  };
}

/** 安装授权摘要相关的 API mock。返回可变 fixture，用例可随时改写。 */
async function installAuthorizationApi(page: Page, overrides: SummaryOverrides = {}) {
  const fixture = { overrides };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.startsWith("/api/admin/authorization-summary/")) {
      await route.fulfill({
        json: { ok: true, data: { summary: buildSummary(fixture.overrides), candidateDigest: null } }
      });
      return;
    }
    if (url.pathname === "/api/admin/access-map") {
      await route.fulfill({ json: accessMapResponse() });
      return;
    }
    await route.fulfill({
      status: 404,
      json: { ok: false, error: { code: "NOT_FOUND", message: url.pathname } }
    });
  });
  return fixture;
}

/** 受保护的标识必须带 translate="no" + notranslate。 */
async function expectProtectedIdentifier(locator: Locator): Promise<void> {
  await expect(locator).toHaveAttribute("translate", "no");
  await expect(locator).toHaveClass(/notranslate/);
}

// ─── ASV-10 ──────────────────────────────────────────────────────────────────

test.describe("P1-2 授权摘要：深链（ASV-10）", () => {
  test("@p1-acceptance ASV-10 — 访问关系图／行权限视图／MCP 调试台三条深链都渲染且 URL 正确", async ({ page }) => {
    await installAuthorizationApi(page);
    await page.goto("/admin/authorization-summary?kind=agent&id=demo_agent");

    await expect(page.getByTestId("authorization-summary-panel")).toBeVisible();

    const accessMapLink = page.getByTestId("authorization-access-map-link");
    await expect(accessMapLink).toBeVisible();
    await expect(accessMapLink).toHaveAttribute("href", "/admin/access-map?agent=demo_agent");

    const rowPolicyLink = page.getByTestId("authorization-row-policy-link");
    await expect(rowPolicyLink).toBeVisible();
    await expect(rowPolicyLink).toHaveAttribute(
      "href",
      "/admin/row-policies?connectionId=mysql-aliyun&schema=finance&sourceName=orders"
    );

    const playgroundLink = page.getByTestId("authorization-playground-deep-link");
    await expect(playgroundLink).toBeVisible();
    const playgroundHref = await playgroundLink.getAttribute("href");
    expect(playgroundHref).toContain("/admin/mcp-playground?");
    expect(playgroundHref).toContain("agentId=demo_agent");
    expect(playgroundHref).toContain("mode=dry-run");
    expect(playgroundHref).toContain("tool=lucy_query");
    expect(playgroundHref).toContain("args=");
  });

  test("@p1-acceptance ASV-10 — 受影响 Agent 逐个链到各自的授权摘要路由", async ({ page }) => {
    await installAuthorizationApi(page);
    await page.goto("/admin/authorization-summary?kind=agent&id=demo_agent");

    const list = page.getByTestId("authorization-referencing-agents");
    await expect(list).toBeVisible();

    for (const agentId of ["demo_agent_2", "demo_agent_3"]) {
      const link = page.getByTestId(`authorization-referencing-agent-${agentId}`);
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute(
        "href",
        `/admin/authorization-summary?kind=agent&id=${agentId}`
      );
    }
  });
});

// ─── ASV-04 ──────────────────────────────────────────────────────────────────

test.describe("P1-2 授权摘要：分母不可得（ASV-04）", () => {
  test("@p1-acceptance ASV-04 — 启用表分母不可得时显示为不可用，不用 0 冒充", async ({ page }) => {
    await installAuthorizationApi(page, {
      headline: {
        enabledTableCount: null,
        enabledTableDenominatorUnavailableReason: "catalog_snapshot_unavailable"
      }
    });
    await page.goto("/admin/authorization-summary?kind=agent&id=demo_agent");

    const headline = page.getByTestId("authorization-headline-text");
    await expect(headline).toBeVisible();
    await expect(headline).toContainText("启用表总数暂不可用");
    // 不得用 0 冒充分母
    await expect(headline).not.toContainText("0 张表");
    await expect(headline).not.toContainText("张表中的");

    const unknown = page.getByTestId("authorization-denominator-unknown");
    await expect(unknown).toBeVisible();
    await expect(unknown).toContainText("catalog_snapshot_unavailable");
    await expect(unknown).toContainText("只展示可确定的分子");
  });
});

// ─── ASV-11 ──────────────────────────────────────────────────────────────────

test.describe("P1-2 授权摘要：与访问关系图分列（ASV-11）", () => {
  test("@p1-acceptance ASV-11 — 摘要页本身不是关系图，访问关系图是独立页面的独立图", async ({ page }) => {
    await installAuthorizationApi(page);
    await page.goto("/admin/authorization-summary?kind=agent&id=demo_agent");

    // 摘要页不渲染任何关系图画布
    await expect(page.getByTestId("authorization-summary-panel")).toBeVisible();
    await expect(page.getByTestId("access-map-canvas")).toHaveCount(0);
    await expect(page.getByTestId("access-map-svg")).toHaveCount(0);

    // 访问关系图在另一个路由上
    const accessMapLink = page.getByTestId("authorization-access-map-link");
    await expect(accessMapLink).toHaveAttribute("href", "/admin/access-map?agent=demo_agent");
    await accessMapLink.click();

    await expect(page).toHaveURL(/\/admin\/access-map\?agent=demo_agent/);
    await expect(page.getByTestId("access-map-canvas")).toBeVisible();
    await expect(page.getByTestId("access-map-svg")).toBeVisible();
    // 独立页上是关系图，不是摘要
    await expect(page.getByTestId("authorization-summary-panel")).toHaveCount(0);
  });
});

// ─── ASV-14 ──────────────────────────────────────────────────────────────────

test.describe("P1-2 授权摘要：术语与翻译防御（ASV-14）", () => {
  test("@p1-acceptance ASV-14 — 角色/Agent/连接/Schema/表/工具等受保护标识带 translate=\"no\" + notranslate", async ({ page }) => {
    await installAuthorizationApi(page);
    await page.goto("/admin/authorization-summary?kind=agent&id=demo_agent");

    const card = page.getByTestId("authorization-resource-card");
    await expect(card).toBeVisible();

    // 连接标识
    await expectProtectedIdentifier(card.getByText("mysql-aliyun", { exact: true }));
    // Schema 标识
    await expectProtectedIdentifier(card.getByText("finance", { exact: true }));
    // 表标识（逻辑名与物理表名）
    await expectProtectedIdentifier(card.getByText("orders", { exact: true }));
    await expectProtectedIdentifier(card.getByText("finance.orders", { exact: true }));
    // 角色标识
    await expectProtectedIdentifier(card.getByText("analyst", { exact: true }));
    // 工具标识
    await expectProtectedIdentifier(card.getByText("lucy_query", { exact: true }));

    // 受影响的 Agent 标识同样受保护
    const referencing = page.getByTestId("authorization-referencing-agent-demo_agent_2");
    await expectProtectedIdentifier(referencing);
  });
});
