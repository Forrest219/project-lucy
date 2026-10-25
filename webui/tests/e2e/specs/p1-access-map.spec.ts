// webui/tests/e2e/specs/p1-access-map.spec.ts
// Lucy v0.25 P1-3 — 访问关系图（浏览器验收）
//
// 权威 Spec：webui/docs/187-access-relation-sankey-spec.md
//   §3.2（详情页下钻深链）、§5.5（降级矩阵）、§6.2／§6.3（响应结构与 URL 参数）、
//   §7.5（无障碍等价视图）、§10（SC-06／SC-07／SC-09／SC-13）。
//
// 标签：@p1-acceptance
//
// 浏览器层只验证**用户看得见的行为**：深链与预置过滤、键盘可达、
// 快照覆盖率披露、降级时不得用 0 冒充真实计数。
// 服务端语义（守恒自检、四口径计数、快照判定分档）由 vitest 覆盖，本文件不重复。
//
// 全部 API 用 `page.route("**/api/**")` mock，形状与
//   webui/server/admin/access-map.ts
//   webui/src/components/admin/AccessMapTypes.tsx
// 的真实返回逐字一致。

import { expect, test, type Page } from "@playwright/test";

const AGENT_ID = "demo_agent";
const ROLE_ID = "analyst";

type AccessMapMetaOverrides = Record<string, unknown>;

/** 访问关系图响应（`AccessMapResponse`）。单个用例只改自己关心的那块。 */
function buildAccessMapResponse(metaOverrides: AccessMapMetaOverrides = {}) {
  const nodes = [
    {
      id: `agent:${AGENT_ID}`,
      kind: "agent",
      label: AGENT_ID,
      depth: 0,
      meta: { grantUsers: 1, grantPaths: 2, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: `role:${ROLE_ID}`,
      kind: "role",
      label: ROLE_ID,
      depth: 1,
      parentId: `agent:${AGENT_ID}`,
      meta: { grantUsers: 1, grantPaths: 2, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: "conn:mysql-aliyun",
      kind: "connection",
      label: "mysql-aliyun",
      depth: 2,
      parentId: `role:${ROLE_ID}`,
      meta: { grantUsers: 1, grantPaths: 2, accessUsers: 1, accessPaths: 1 }
    },
    {
      id: "table:mysql-aliyun::finance::orders",
      kind: "table",
      label: "orders",
      depth: 3,
      parentId: "conn:mysql-aliyun",
      meta: { grantUsers: 1, grantPaths: 2, accessUsers: 1, accessPaths: 1 }
    }
  ];

  const edges = [
    {
      id: `e|agent:${AGENT_ID}|role:${ROLE_ID}`,
      source: `agent:${AGENT_ID}`,
      target: `role:${ROLE_ID}`,
      grantPaths: 2,
      grantUsers: 1,
      accessPaths: 1,
      accessUsers: 1,
      accessCalls: 3,
      state: "normal",
      confirmedUnauthorized: false,
      reviewEvaluations: [],
      snapshotCoverage: { reviewPaths: 0, matched: 0, missingOrInvalid: 0, ratio: 0 }
    },
    {
      id: `e|role:${ROLE_ID}|conn:mysql-aliyun`,
      source: `role:${ROLE_ID}`,
      target: "conn:mysql-aliyun",
      grantPaths: 2,
      grantUsers: 1,
      accessPaths: 0,
      accessUsers: 0,
      accessCalls: 0,
      state: "needs_review",
      confirmedUnauthorized: false,
      reviewEvaluations: [
        {
          pathKey: `${AGENT_ID}/${ROLE_ID}/mysql-aliyun/finance/orders`,
          agentId: AGENT_ID,
          roleId: ROLE_ID,
          connectionId: "mysql-aliyun",
          schema: "finance",
          sourceName: "orders",
          calls: 4,
          result: "unknown",
          reason: "snapshot_missing",
          evidence: [
            {
              callId: "call-1",
              result: "unknown",
              reason: "snapshot_missing"
            }
          ]
        }
      ],
      snapshotCoverage: { reviewPaths: 1, matched: 0, missingOrInvalid: 1, ratio: 0 }
    }
  ];

  const meta = {
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
      rawCalls: 12
    },
    counts: {
      agents: 1,
      roles: 1,
      connections: 1,
      schemas: 1,
      tables: 1,
      tokens: 0,
      edges: 2,
      grantPaths: 2,
      grantUsers: 1,
      accessPaths: 1,
      accessUsers: 1
    },
    signals: { dormantEdges: 0, needsReviewEdges: 1, confirmedUnauthorizedEdges: 0 },
    snapshotCoverage: { reviewPaths: 10, matched: 4, missingOrInvalid: 6, ratio: 0.4 },
    orphanGrants: 0,
    folded: { nodes: 0, edges: 0 },
    countingNotes: [],
    ...metaOverrides
  };

  return {
    ok: true,
    data: {
      meta,
      nodes,
      edges,
      render: { nodes, edges, folded: { nodes: 0, edges: 0 } }
    }
  };
}

/** 授权摘要（Agent 视图）：带访问关系图深链。 */
function agentSummary(overrides: Record<string, unknown> = {}) {
  return {
    summaryContext: {
      subject: { kind: "agent", id: AGENT_ID },
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
      candidateOnly: false
    },
    headline: {
      connectionCount: 1,
      tableCount: 1,
      enabledTableCount: 1,
      enabledTableDenominatorUnavailableReason: null,
      scopedTableCount: 0,
      scopedTableCountBasis: "final_rows",
      grantPathCount: 1,
      state: "ok"
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
                roleIds: [ROLE_ID],
                capabilities: [
                  { tool: "lucy_query", rowGrant: { kind: "all" } }
                ],
                rowSummary: {
                  kind: "all",
                  basis: "final_rows",
                  displayShape: "OR-of-AND",
                  agentFinalRowsAvailable: true,
                  agentPersonalLimitsApplied: false,
                  templateRefs: [],
                  constraintSummary: "全部行",
                  orArms: [],
                  digest: null
                },
                playgroundUrl: null
              }
            ]
          }
        ]
      }
    ],
    tools: { query: ["lucy_query"], semanticRead: [], wikiRead: [], write: [], meta: [] },
    unclassifiedTools: [],
    actions: {
      playgroundUrl: null,
      accessMapUrl: `/admin/access-map?agent=${AGENT_ID}`,
      rowPolicyViewUrl: null,
      referencingAgentIds: [],
      ...(overrides.actions as Record<string, unknown> | undefined)
    },
    roleContributions: [{ roleId: ROLE_ID, ok: true, tableCount: 1 }],
    legacyAllow: false,
    diagnostics: [],
    ...overrides
  };
}

function agentDetail() {
  return {
    agent: {
      id: AGENT_ID,
      name: "Demo Agent",
      note: "浏览器验收 Agent",
      enabled: true,
      roles: [ROLE_ID],
      role: ROLE_ID,
      tokens: [],
      effectivePermissions: {
        roleIds: [ROLE_ID],
        snapshotHash: "snapshot-1",
        sourceMapVersion: "smap-0001",
        tools: ["lucy_query"],
        connections: ["mysql-aliyun"],
        sources: [
          {
            connectionId: "mysql-aliyun",
            schema: "finance",
            sourceName: "orders",
            table: "finance.orders"
          }
        ],
        legacyAllow: false,
        capabilities: []
      }
    },
    version: "cfg-0001"
  };
}

function roleDetail() {
  return {
    id: ROLE_ID,
    version: "role-version-1",
    description: "浏览器验收 Role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: ["mysql-aliyun"],
    sourceNames: ["orders"],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: 1,
    users: [{ id: AGENT_ID, name: "Demo Agent", enabled: true, tokenCount: 1 }],
    role: {
      description: "浏览器验收 Role",
      allow: {
        connections: ["mysql-aliyun"],
        tools: ["lucy_query"],
        tableSelectors: [
          { connection: "mysql-aliyun", schema: "finance", names: ["orders"] }
        ]
      }
    },
    effectivePermissions: {
      roleIds: [ROLE_ID],
      snapshotHash: "snapshot-1",
      sourceMapVersion: "smap-0001",
      tools: ["lucy_query"],
      connections: ["mysql-aliyun"],
      sources: [
        {
          connectionId: "mysql-aliyun",
          schema: "finance",
          sourceName: "orders",
          table: "finance.orders"
        }
      ],
      legacyAllow: false,
      capabilities: []
    },
    skillAccess: {
      discoverEnabled: true,
      readEnabled: false,
      declared: [],
      discoverable: [],
      readable: [],
      declaredWithoutChannel: []
    }
  };
}

/**
 * 安装访问关系图相关的 API mock。
 *
 * `metaOverrides` 可变：同一个用例里改写后重新请求即生效。
 */
async function installAccessMapApi(
  page: Page,
  options: { metaOverrides?: AccessMapMetaOverrides } = {}
) {
  const fixture = { metaOverrides: options.metaOverrides ?? {} };
  const requests: string[] = [];

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname + url.search);

    if (url.pathname === "/api/admin/access-map") {
      await route.fulfill({ json: buildAccessMapResponse(fixture.metaOverrides) });
      return;
    }
    if (url.pathname === `/api/admin/authorization-summary/agent/${AGENT_ID}`) {
      await route.fulfill({
        json: { ok: true, data: { summary: agentSummary(), candidateDigest: null } }
      });
      return;
    }
    if (url.pathname === `/api/admin/authorization-summary/role/${ROLE_ID}`) {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            summary: agentSummary({
              summaryContext: {
                subject: { kind: "role", id: ROLE_ID },
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
                candidateOnly: false
              },
              actions: {
                playgroundUrl: null,
                accessMapUrl: null,
                rowPolicyViewUrl: null,
                referencingAgentIds: [AGENT_ID]
              }
            }),
            candidateDigest: null
          }
        }
      });
      return;
    }
    if (url.pathname === `/api/admin/agents/${AGENT_ID}`) {
      await route.fulfill({ json: { ok: true, data: agentDetail() } });
      return;
    }
    if (url.pathname === "/api/admin/roles") {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            roles: [
              {
                id: ROLE_ID,
                description: "浏览器验收 Role",
                source: "yaml",
                tools: ["lucy_query"],
                connections: ["mysql-aliyun"],
                sourceNames: ["orders"],
                sourceCount: 1,
                invalid: false,
                warnings: []
              }
            ]
          }
        }
      });
      return;
    }
    if (url.pathname === `/api/admin/roles/${ROLE_ID}`) {
      await route.fulfill({ json: { ok: true, data: roleDetail() } });
      return;
    }
    if (url.pathname === "/api/connections") {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            connections: [
              { id: "mysql-aliyun", schemas: ["finance"], enabledTables: ["finance.orders"] }
            ]
          }
        }
      });
      return;
    }
    if (url.pathname === "/api/connections/mysql-aliyun/tables") {
      await route.fulfill({ json: { ok: true, data: { tables: ["finance.orders"] } } });
      return;
    }
    if (url.pathname === "/api/admin/mcp-tools") {
      await route.fulfill({
        json: { ok: true, data: { tools: [{ name: "lucy_query", globalDenied: false }] } }
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { ok: false, error: { code: "NOT_FOUND", message: url.pathname } }
    });
  });

  return { requests, fixture };
}

// ─── SC-06 ───────────────────────────────────────────────────────────────────

test.describe("P1-3 访问关系图：详情页深链（SC-06）", () => {
  test("@p1-acceptance SC-06 — 从 Agent 详情页进入访问关系图，URL 带 agent 过滤且过滤被预置", async ({ page }) => {
    const { requests } = await installAccessMapApi(page);

    await page.goto(`/admin/agents/${AGENT_ID}?tab=permissions`);
    await expect(page.getByTestId("authorization-summary-panel")).toBeVisible();

    const link = page.getByTestId("authorization-access-map-link");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", `/admin/access-map?agent=${AGENT_ID}`);

    await link.click();

    // 独立页的 URL 带过滤参数
    await expect(page).toHaveURL(new RegExp(`/admin/access-map\\?agent=${AGENT_ID}`));
    // 过滤参数被真正带到服务端请求里（预置过滤）
    await expect
      .poll(() => requests.filter((entry) => entry.startsWith("/api/admin/access-map")).length)
      .toBeGreaterThan(0);
    const mapRequest = requests.find((entry) => entry.startsWith("/api/admin/access-map"));
    expect(mapRequest).toContain(`agent=${AGENT_ID}`);

    // 过滤后的图确实渲染出该 Agent
    await expect(page.getByTestId("access-map-canvas")).toBeVisible();
    await expect(page.getByTestId(`access-map-node-button-agent:${AGENT_ID}`)).toBeVisible();
  });

  test("@p1-acceptance SC-06 — 从 Role 详情页经受影响 Agent 进入访问关系图并预置 agent 过滤", async ({ page }) => {
    const { requests } = await installAccessMapApi(page);

    await page.goto(`/admin/roles/${ROLE_ID}`);
    await expect(page.getByTestId("authorization-summary-panel")).toBeVisible();

    // Role 摘要给出「受影响 Agent」，逐个链到各自的 Agent 摘要
    const referencing = page.getByTestId(`authorization-referencing-agent-${AGENT_ID}`);
    await expect(referencing).toBeVisible();
    await expect(referencing).toHaveAttribute(
      "href",
      `/admin/authorization-summary?kind=agent&id=${AGENT_ID}`
    );

    await referencing.click();
    await expect(page).toHaveURL(
      new RegExp(`/admin/authorization-summary\\?kind=agent&id=${AGENT_ID}`)
    );

    // Agent 摘要再给出访问关系图深链，并预置过滤
    const link = page.getByTestId("authorization-access-map-link");
    await expect(link).toHaveAttribute("href", `/admin/access-map?agent=${AGENT_ID}`);
    await link.click();

    await expect(page).toHaveURL(new RegExp(`/admin/access-map\\?agent=${AGENT_ID}`));
    await expect
      .poll(() => requests.filter((entry) => entry.startsWith("/api/admin/access-map")).length)
      .toBeGreaterThan(0);
    const mapRequest = requests.find((entry) => entry.startsWith("/api/admin/access-map"));
    expect(mapRequest).toContain(`agent=${AGENT_ID}`);
  });
});

// ─── SC-09 ───────────────────────────────────────────────────────────────────

test.describe("P1-3 访问关系图：键盘可达（SC-09）", () => {
  test("@p1-acceptance SC-09 — 边的明细面板有键盘可达入口，非 mouse-only", async ({ page }) => {
    await installAccessMapApi(page);

    await page.goto("/admin/access-map");
    await expect(page.getByTestId("access-map-canvas")).toBeVisible();

    const edgeId = `e|role:${ROLE_ID}|conn:mysql-aliyun`;
    const badges = page.getByTestId("access-map-edge-badges");
    await expect(badges).toBeVisible();

    const badgeButton = page.getByTestId(`access-map-edge-badge-button-${edgeId}`);
    await expect(badgeButton).toBeVisible();
    await expect(badgeButton).toHaveText(/需复核/);

    // 明细面板初始不展开
    await expect(page.getByTestId("access-map-edge-detail")).toHaveCount(0);

    // 键盘可达：按钮能获得焦点（不是只能靠鼠标点 SVG path）
    await badgeButton.focus();
    await expect(badgeButton).toBeFocused();

    // 键盘激活（Enter）即可打开同一个明细面板
    await page.keyboard.press("Enter");
    const detail = page.getByTestId("access-map-edge-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(`${ROLE_ID} → conn:mysql-aliyun`);
    await expect(page.getByTestId(`access-map-edge-detail-path-${AGENT_ID}/${ROLE_ID}/mysql-aliyun/finance/orders`)).toBeVisible();
  });
});

// ─── SC-13 ───────────────────────────────────────────────────────────────────

test.describe("P1-3 访问关系图：快照覆盖率披露（SC-13）", () => {
  test("@p1-acceptance SC-13 — 覆盖率不是 100% 时如实显示，不得显示成全覆盖", async ({ page }) => {
    await installAccessMapApi(page, {
      metaOverrides: {
        snapshotCoverage: { reviewPaths: 10, matched: 4, missingOrInvalid: 6, ratio: 0.4 }
      }
    });

    await page.goto("/admin/access-map");
    const coverage = page.getByTestId("access-map-snapshot-coverage");
    await expect(coverage).toBeVisible();
    await expect(coverage).toContainText("需复核记录 10 条");
    await expect(coverage).toContainText("可关联快照 4 条");
    await expect(coverage).toContainText("缺失或无效 6 条");
    await expect(coverage).toContainText("覆盖率 40%");
    await expect(coverage).not.toContainText("覆盖率 100%");
    // 低覆盖率不得被解释为低越权率
    await expect(coverage).toContainText("快照覆盖率低不代表越权率低");
  });
});

// ─── SC-07 ───────────────────────────────────────────────────────────────────

test.describe("P1-3 访问关系图：访问面降级（SC-07）", () => {
  test("@p1-acceptance SC-07 — 访问面不可用时显示「暂不可用」，不得用 0 冒充真实计数", async ({ page }) => {
    await installAccessMapApi(page, {
      metaOverrides: {
        access: {
          state: "unavailable",
          trust: "confirmed",
          deniedCalls: 0,
          rawCalls: 0,
          reason: "access_log_unavailable"
        }
      }
    });

    await page.goto("/admin/access-map");

    const calls = page.getByTestId("access-map-signal-calls");
    await expect(calls).toBeVisible();
    await expect(calls).toContainText("原始调用数暂不可用");
    await expect(calls).toContainText("被拒绝的访问尝试暂不可用");
    await expect(calls).not.toContainText("原始调用数 0 次");
    await expect(calls).not.toContainText("被拒绝的访问尝试 0 次");

    // 降级本身必须显式披露原因
    const unavailable = page.getByTestId("access-map-access-unavailable");
    await expect(unavailable).toBeVisible();
    await expect(unavailable).toContainText("审计数据不可用");
    await expect(unavailable).toContainText("access_log_unavailable");
  });
});
