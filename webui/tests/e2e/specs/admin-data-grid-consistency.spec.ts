// webui/tests/e2e/specs/admin-data-grid-consistency.spec.ts
// 关联计划：docs/plans/2026-08-26-admin-data-grid-frame-consistency.md
// 标签：@pr-impacted
//
// 验证 /admin/agents、/admin/config-audit、/admin/audit 共享 pl-data-grid-frame，
// 并检查配置审计几何与访问日志有界滚动区落在首屏可达范围。

import { expect, test, type Page } from "@playwright/test";

test("@pr-impacted admin data grids share one frame contract", async ({ page }) => {
  await page.goto("/admin/agents");
  const agentsFrame = page.getByTestId("agent-list-section");
  await expect(agentsFrame).toBeVisible();
  await expect(agentsFrame).toHaveClass(/pl-data-grid-frame/);

  await page.goto("/admin/config-audit");
  const configFrame = page.getByTestId("config-audit-grid-frame");
  const configScroll = page.getByTestId("config-audit-grid-scroll");
  await expect(configFrame).toBeVisible();
  await expect(configFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(configScroll).toHaveAttribute("role", "region");

  await page.goto("/admin/audit?range=7d");
  const auditFrame = page.getByTestId("audit-turns-grid-frame");
  const auditScroll = page.getByTestId("audit-turns-grid-scroll");
  await expect(auditFrame).toBeVisible();
  await expect(auditFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(auditScroll).toHaveClass(/pl-audit-grid-scroll/);

  await page.goto("/admin/audit?range=7d&view=calls");
  const callsFrame = page.getByTestId("audit-calls-grid-frame");
  const callsScroll = page.getByTestId("audit-calls-grid-scroll");
  await expect(callsFrame).toBeVisible();
  await expect(callsFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(callsScroll).toHaveClass(/pl-audit-grid-scroll/);
});

test("@pr-impacted grid geometry is usable at the project desktop viewport", async ({ page }) => {
  await page.goto("/admin/config-audit");
  const configGeometry = await page.getByTestId("config-audit-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(configGeometry.scrollWidth).toBeLessThanOrEqual(configGeometry.clientWidth + 1);

  await page.goto("/admin/audit?range=7d");
  const auditGeometry = await page.getByTestId("audit-turns-grid-scroll").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return {
      bottom: rect.bottom,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      viewportHeight: window.innerHeight
    };
  });
  expect(auditGeometry.bottom).toBeLessThanOrEqual(auditGeometry.viewportHeight);
  expect(auditGeometry.clientHeight).toBeLessThanOrEqual(auditGeometry.scrollHeight);
});

test("@pr-impacted grid geometry keeps audit page width within the viewport", async ({ page }) => {
  // 宽表 fixture：稳定的超宽问询记录与调用流水，确保两个滚动层在 fixture 数据下
  // scrollWidth > clientWidth，用于验证横向溢出只发生在局部滚动层而非页面根节点。
  const wideTurnEntries = Array.from({ length: 8 }, (_, index) => ({
    id: `turn_wide_fixture_${String(index).padStart(4, "0")}_9f2c1ab7d4e84f0a`,
    source: "reported",
    userId: "agent-e2e-wide-fixture",
    startedAt: "2026-09-26T01:00:00.000Z",
    endedAt: "2026-09-26T01:00:08.500Z",
    businessCallCount: 6,
    questionPreview:
      "统计 ai_intl_user_active_30d_uv_daily_extremely_long_table_name_token 的近 30 天活跃趋势",
    confidence: "high",
    tools: ["query_data"],
    sources: [
      {
        connectionId: "mysql-aliyun",
        schema: "chatbi",
        physicalTable: "ai_intl_user_active_30d_uv_daily_extremely_long_table_name_token"
      },
      {
        connectionId: "mysql-aliyun",
        schema: "chatbi",
        physicalTable: "ai_intl_order_gmv_daily_summary_extremely_long_table_name_token"
      },
      {
        connectionId: "mysql-aliyun",
        schema: "chatbi",
        physicalTable: "ai_intl_refund_rate_daily_summary_extremely_long_table_name_token"
      }
    ],
    turnSpanMs: 8500,
    totalCallDurationMs: 7900,
    maxCallDurationMs: 3200,
    slowCallCount: index % 3,
    outcomeSummary: { ok: 5, denied: 1, error: 0 }
  }));

  await page.route(/\/api\/admin\/audit\/turns(\?|\/|$)/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          total: wideTurnEntries.length,
          entries: wideTurnEntries,
          referenceLatency: {
            windowHours: 168,
            p95Ms: 4200,
            totalCallsInWindow: 120,
            slowCallsInFilter: 3
          },
          summary: { reportedCount: wideTurnEntries.length, inferredCount: 0, reportedShare: 1 }
        }
      })
    });
  });

  const wideCallEntries = Array.from({ length: 8 }, (_, index) => ({
    id: 9_000_000 + index,
    ts: "2026-09-26T01:00:05.000Z",
    userId: "agent-e2e-wide-fixture",
    lucySessionId: "sess_e2e_wide_fixture_0123456789abcdef",
    lucyTurnId: `turn_wide_fixture_${String(index).padStart(4, "0")}_9f2c1ab7d4e84f0a_extended_turn_token`,
    lucyPlatform: "lucy-web",
    client: "kimi-cli",
    clientVersion: "0.9.9",
    clientIp: "203.0.113.99",
    userAgent: "Mozilla/5.0 (E2E Wide Fixture Agent) AppleWebKit/537.36 Chrome/126.0.0.0",
    deviceName: "e2e-wide-fixture-workstation-01",
    tool: "query_data_with_extremely_long_tool_name_for_fixture",
    tables: [
      "chatbi.ai_intl_user_active_30d_uv_daily_extremely_long_table_name_token",
      "chatbi.ai_intl_order_gmv_daily_summary_extremely_long_table_name_token"
    ],
    outcome: "ok",
    durationMs: 1234,
    responseBytes: 4096,
    responseRowCount: 120,
    responseColumnCount: 12,
    requestId: `req-e2e-wide-${index}`,
    traceId: `trace-e2e-wide-${index}`
  }));

  await page.route(/\/api\/admin\/audit(\?|$)/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          total: wideCallEntries.length,
          entries: wideCallEntries,
          summary: {
            protocolCalls: 0,
            businessCalls: wideCallEntries.length,
            deniedCalls: 0,
            dataBearingCalls: wideCallEntries.length
          }
        }
      })
    });
  });

  await page.goto("/admin/audit?range=7d");
  const turnsScroll = page.getByTestId("audit-turns-grid-scroll");
  await expect(page.getByTestId(`audit-turn-row-${wideTurnEntries[0].id}`)).toBeVisible();
  const turnsPageGeometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(turnsPageGeometry.scrollWidth).toBeLessThanOrEqual(turnsPageGeometry.clientWidth + 1);
  const turnsGeometry = await turnsScroll.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(turnsGeometry.scrollWidth).toBeGreaterThan(turnsGeometry.clientWidth);

  await page.goto("/admin/audit?range=7d&view=calls");
  const callsScroll = page.getByTestId("audit-calls-grid-scroll");
  await expect(page.getByTestId(`audit-event-id-${wideCallEntries[0].id}`)).toBeVisible();
  const callsPageGeometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(callsPageGeometry.scrollWidth).toBeLessThanOrEqual(callsPageGeometry.clientWidth + 1);
  const callsGeometry = await callsScroll.evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(callsGeometry.scrollWidth).toBeGreaterThan(callsGeometry.clientWidth);
});

test("@pr-impacted config audit wraps long target links inside their column", async ({ page }) => {
  const entryId = "long-semantic-target";
  await page.route("**/api/admin/config-audit**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          total: 1,
          entries: [
            {
              id: entryId,
              ts: "2026-08-26T07:38:52.000Z",
              actor: "local-admin",
              actorType: "ui_admin",
              source: "semantic_layer_import_api",
              filePath:
                "semantic-layer/mysql-aliyun/ai_intl_user_active_30d_uv_daily.yaml",
              assetKind: "semantic",
              changeType: "semantic_table_import",
              targetId: "mysql-aliyun:chatbi:ai_intl_user_active_30d_uv_daily",
              writeStatus: "committed"
            }
          ]
        }
      })
    });
  });

  await page.goto("/admin/config-audit");
  const targetLink = page.getByTestId(`config-audit-target-link-${entryId}`);
  await expect(targetLink).toBeVisible();

  const geometry = await targetLink.evaluate((node) => {
    const cell = node.closest("td");
    if (!cell) throw new Error("Target link is not inside a table cell");
    const cellRect = cell.getBoundingClientRect();
    const linkFragments = Array.from(node.getClientRects());
    const style = getComputedStyle(node);
    return {
      cellRight: cellRect.right,
      maxLinkRight: Math.max(...linkFragments.map((rect) => rect.right)),
      display: style.display,
      whiteSpace: style.whiteSpace
    };
  });
  expect(geometry.display).toBe("inline");
  expect(geometry.whiteSpace).toBe("normal");
  expect(geometry.maxLinkRight).toBeLessThanOrEqual(geometry.cellRight + 1);

  const scrollGeometry = await page.getByTestId("config-audit-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(scrollGeometry.scrollWidth).toBeLessThanOrEqual(scrollGeometry.clientWidth + 1);

  await targetLink.focus();
  await expect(targetLink).toBeFocused();
  await targetLink.click();
  await expect(page).toHaveURL(
    /\/catalog\/mysql-aliyun\/chatbi\/ai_intl_user_active_30d_uv_daily$/
  );
});

// ─── Task 10 fixtures：稳定的宽表 / 监控 / 凭据数据，避免依赖本地项目真实数据 ───

async function stubCrossPageGridApis(page: Page) {
  await page.route("**/api/eval/domains", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          domains: [
            {
              domain: "kx_financial",
              filePath: "evals/kx_financial/eval/kx_financial-eval-cases.yaml",
              caseCount: 5
            }
          ]
        }
      })
    });
  });

  await page.route(/\/api\/eval\/cases\//, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          cases: Array.from({ length: 5 }, (_, index) => ({
            id: `kx_financial_case_with_extremely_long_identifier_for_grid_overflow_${String(index).padStart(3, "0")}`,
            case_type: "single_turn",
            question: `第 ${index + 1} 个用于验证宽表横向滚动约束的评测问题`,
            expected_measures: [
              "operating_revenue_extremely_long_measure_name_token",
              "net_profit_margin_extremely_long_measure_name_token"
            ],
            linked_quiz_questions: []
          }))
        }
      })
    });
  });

  await page.route(/\/api\/eval\/runs(\?|$)/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { total: 0, runs: [] } })
    });
  });

  await page.route(/\/api\/eval\/monitor\/trend/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          thresholds: { yellow: 0.9, red: 0.8 },
          points: [{ date: "2026-09-25", passRate: 0.85, totalRuns: 2 }]
        }
      })
    });
  });

  await page.route(/\/api\/eval\/monitor\/top-failures/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          items: [{ caseId: "case_sales_extremely_long_identifier", failCount: 2, lastFailAt: "2026-09-25T00:00:00.000Z" }]
        }
      })
    });
  });

  await page.route(/\/api\/eval\/monitor\/drift-distribution/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, data: { items: [{ drift: "sql_changed", count: 1 }] } })
    });
  });

  await page.route(/\/api\/eval\/monitor\/config/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          config: {
            domains: {
              kx_financial: { passRateYellow: 0.9, passRateRed: 0.8, consecutiveFailThreshold: 3 }
            }
          }
        }
      })
    });
  });

  await page.route(/\/api\/admin\/tokens(\?|$)/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        data: {
          tokens: Array.from({ length: 5 }, (_, index) => ({
            hashPrefix: `sha256:${"abcdef0123456789".repeat(4)}${index}`,
            label: `e2e-wide-grid-token-label-with-long-name-${String(index).padStart(2, "0")}`,
            created: "2026-08-20",
            expires_at: "2026-12-31",
            device_name: `e2e-wide-grid-workstation-device-name-${index}`,
            agent: {
              id: `agent_with_extremely_long_identifier_${index}`,
              name: `宽表回归 Agent ${index}`,
              enabled: true,
              roles: ["bi_analyst_extremely_long_role_name", "data_viewer_extremely_long_role_name"]
            },
            last_used: "2026-08-28T10:00:00.000Z",
            last_tool: "sl_query",
            last_outcome: "allow",
            last_ip: "192.168.1.100",
            last_client: "cursor",
            last_client_version: "0.45.0",
            last_device_name_seen: `e2e-wide-grid-workstation-device-name-${index}`,
            distinct_ips_7d: 1,
            status: "available"
          })),
          stats: {
            totalTokens: 5,
            availableTokens: 5,
            activeLast7dTokens: 5,
            expiringSoonTokens: 0,
            expiredTokens: 0
          }
        }
      })
    });
  });
}

test("@pr-impacted eval and admin pages share the data grid frame contract", async ({ page }) => {
  await stubCrossPageGridApis(page);

  await page.goto("/eval/cases");
  const casesFrame = page.getByTestId("eval-cases-grid-frame");
  await expect(casesFrame).toBeVisible();
  await expect(casesFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(page.getByTestId("eval-cases-grid-scroll")).toHaveClass(/pl-data-grid-scroll/);
  await expect(page.getByTestId("eval-cases-table")).toHaveClass(/pl-data-grid/);

  await page.goto("/eval/monitor");
  const failuresFrame = page.getByTestId("monitor-top-failures-grid-frame");
  await expect(failuresFrame).toBeVisible();
  await expect(failuresFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(page.getByTestId("monitor-top-failures-grid-scroll")).toHaveClass(/pl-data-grid-scroll/);
  await expect(page.getByTestId("monitor-top-failures-table")).toHaveClass(/pl-data-grid/);
  const thresholdsFrame = page.getByTestId("monitor-thresholds-grid-frame");
  await expect(thresholdsFrame).toBeVisible();
  await expect(thresholdsFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(page.getByTestId("monitor-thresholds-grid-scroll")).toHaveClass(/pl-data-grid-scroll/);
  await expect(page.getByTestId("monitor-thresholds-table")).toHaveClass(/pl-data-grid/);

  await page.goto("/admin/tokens");
  const tokensFrame = page.getByTestId("tokens-grid-frame");
  await expect(tokensFrame).toBeVisible();
  await expect(tokensFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(page.getByTestId("tokens-grid-scroll")).toHaveClass(/pl-data-grid-scroll/);
  await expect(page.getByTestId("tokens-table")).toHaveClass(/pl-data-grid/);

  await page.goto("/admin/admins");
  const adminsFrame = page.getByTestId("admin-accounts-grid-frame");
  await expect(adminsFrame).toBeVisible();
  await expect(adminsFrame).toHaveClass(/pl-data-grid-frame/);
  await expect(page.getByTestId("admin-accounts-grid-scroll")).toHaveClass(/pl-data-grid-scroll/);
  await expect(page.getByTestId("admin-accounts-table")).toHaveClass(/pl-data-grid/);
});

test("@pr-impacted eval and admin grid geometry keeps page width within the viewport", async ({ page }) => {
  await stubCrossPageGridApis(page);

  const assertNoPageOverflow = async () => {
    const geometry = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
  };

  const assertStandardBodyTypography = async (tableTestId: string) => {
    const typography = await page
      .getByTestId(tableTestId)
      .locator("tbody td")
      .first()
      .evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight
        };
      });
    expect(typography).toEqual({
      fontSize: "12px",
      fontWeight: "500",
      lineHeight: "16px"
    });
  };

  await page.goto("/eval/cases");
  await expect(page.getByTestId("eval-cases-table")).toBeVisible();
  await assertNoPageOverflow();
  const casesGeometry = await page.getByTestId("eval-cases-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(casesGeometry.scrollWidth).toBeGreaterThan(casesGeometry.clientWidth);
  await assertStandardBodyTypography("eval-cases-table");

  await page.goto("/admin/tokens");
  await expect(page.getByTestId("tokens-table")).toBeVisible();
  await assertNoPageOverflow();
  const tokensGeometry = await page.getByTestId("tokens-grid-scroll").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth
  }));
  expect(tokensGeometry.scrollWidth).toBeGreaterThan(tokensGeometry.clientWidth);
  await assertStandardBodyTypography("tokens-table");

  await page.goto("/eval/monitor");
  await expect(page.getByTestId("monitor-top-failures-table")).toBeVisible();
  await expect(page.getByTestId("monitor-thresholds-table")).toBeVisible();
  await assertNoPageOverflow();
  await assertStandardBodyTypography("monitor-top-failures-table");
  await assertStandardBodyTypography("monitor-thresholds-table");

  await page.goto("/admin/admins");
  await expect(page.getByTestId("admin-accounts-table")).toBeVisible();
  await assertNoPageOverflow();
});
