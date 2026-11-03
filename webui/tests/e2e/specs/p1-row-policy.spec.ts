// webui/tests/e2e/specs/p1-row-policy.spec.ts
// Lucy v0.25 P1-1 — 行策略模板与行权限视图（浏览器验收）
//
// 权威 Spec：docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md
//   §3.2（模板读取模型）、§3.3（R3 按表读取模型）、§6.1（模板管理与角色引用）、
//   §6.2（独立行权限视图）、§8（RTP-06／RTP-08／RTV-01／RTV-02／RTV-03／RTV-04／RTV-05／RTV-07）。
// 呈现修订：docs/specs/lucy-20261030-row-policy-view-presentation-spec.md（仅受限表／脱离筛选）。
//
// 标签：@p1-acceptance
//
// 浏览器层只验证**用户看得见的行为**：文案、禁用状态、深链、错误披露、翻译防御。
// 服务端语义（谓词展开、计数口径、编译守恒）由 vitest 覆盖，本文件不重复。
//
// 全部 API 用 `page.route("**/api/**")` mock，形状与
//   webui/server/admin/routes/row-policy.ts
//   webui/server/admin/row-policy-views.ts
//   webui/server/admin/row-policy-templates.ts
// 的真实返回逐字一致。

import { expect, test, type Page } from "@playwright/test";
import {
  DEMO_AGENT_ALL,
  DEMO_AGENT_EAST,
  DEMO_AGENT_SOUTHWEST,
  DEMO_CONNECTION,
  DEMO_REGION_EAST,
  DEMO_REGION_SOUTHWEST,
  DEMO_ROLE_ALL,
  DEMO_ROLE_EAST,
  DEMO_ROLE_SOUTHWEST,
  DEMO_SCHEMA,
  DEMO_SCHEMA_ALT,
  DEMO_TEMPLATE_EAST,
  DEMO_TABLES,
  demoDeepLink,
  demoIdentity,
  demoPhysicalTable,
  demoTableTestId
} from "../fixtures/helpers/demo-baseline";

// ─── 共享 fixture ────────────────────────────────────────────────────────────

/** 四个快照身份字段（P1-1 §3.3）。 */
const SNAPSHOT = {
  identity: {
    configVersion: "cfg-0001",
    policyVersion: "pol-0001",
    sourceMapVersion: "smap-0001",
    capabilityDigest: "cap-0001"
  },
  state: "ok",
  problem: null,
  failures: [] as Array<{ subjectId: string; reason: string }>
};

type TemplateView = {
  name: string;
  description?: string;
  predicates: Array<{ field: string; op: "eq" | "in"; value?: string; values?: string[] }>;
  digest: string;
  references: Array<{ roleId: string; connectionId?: string; schema?: string; sourceNames?: string[] }>;
  usabilityByTable: Array<{
    connectionId: string;
    schema: string;
    sourceName: string;
    usability: { status: string; fields?: string[]; reason?: string };
  }>;
};

type TableListEntry = {
  connectionId: string;
  schema: string;
  sourceName: string;
  physicalTable: string;
  roleCount: number;
  agentCount: number;
  effectiveRowGrant: { kind: "all" | "scoped"; digest?: string; orArms?: unknown[][] } | null;
  grantStatus?: "all" | "scoped" | "no_applicable_grant" | "compile_failed";
  grantStatusReason?: string;
  restricted: boolean;
};

/** 可变的 mock 数据源：用例随时改写，下一次请求即生效。 */
type RowPolicyFixture = {
  templates: TemplateView[];
  viewsList: Record<string, unknown>;
  viewsTable: Record<string, unknown>;
};

function emptyFixture(): RowPolicyFixture {
  return { templates: [], viewsList: {}, viewsTable: {} };
}

/** 模板写入（预演 / 正式保存）的返回形状，见 routes/row-policy.ts `TemplateWriteResponse`。 */
function templateWriteResponse(dryRun: boolean) {
  return {
    ok: true,
    data: {
      dryRun,
      written: !dryRun,
      operationId: "op-0001",
      candidateDigest: "cand-0001",
      version: "cfg-0001",
      impact: {
        tables: [
          {
            connectionId: DEMO_CONNECTION,
            schema: DEMO_SCHEMA,
            sourceName: DEMO_TABLES.orders,
            beforeDigest: "before-1",
            afterDigest: "after-1",
            changed: true
          }
        ],
        agents: [{ agentId: "demo_agent", roleIds: ["analyst"] }],
        policyDigestBefore: "policy-before",
        policyDigestAfter: "policy-after",
        affectedRoleIds: ["analyst"]
      },
      issues: [],
      blockingReferences: [],
      proposedYaml: "row_policy_templates: {}\n",
      policyVersion: "pol-0002",
      runtimeAck: true
    }
  };
}

/** Role 详情（Role 编辑器的行级策略面需要它推导表清单）。 */
function roleDetail() {
  return {
    id: "analyst",
    version: "role-version-1",
    description: "浏览器验收 Role",
    source: "yaml",
    tools: ["lucy_query"],
    connections: [DEMO_CONNECTION],
    sourceNames: [DEMO_TABLES.orders],
    sourceCount: 1,
    invalid: false,
    warnings: [],
    usageCount: 0,
    users: [],
    role: {
      description: "浏览器验收 Role",
      allow: {
        connections: [DEMO_CONNECTION],
        tools: ["lucy_query"],
        tableSelectors: [
          {
            connection: DEMO_CONNECTION,
            schema: DEMO_SCHEMA,
            names: [DEMO_TABLES.orders]
          }
        ]
      }
    },
    effectivePermissions: {
      roleIds: ["analyst"],
      snapshotHash: "snapshot-1",
      sourceMapVersion: "source-map-1",
      tools: ["lucy_query"],
      connections: [DEMO_CONNECTION],
      sources: [
        {
          connectionId: DEMO_CONNECTION,
          schema: DEMO_SCHEMA,
          sourceName: DEMO_TABLES.orders,
          table: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders)
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
 * 安装行策略相关的全部 API mock。
 *
 * 返回抓到的请求记录，供用例断言「深链参数」与「预演请求体」。
 */
async function installRowPolicyApi(page: Page, fixture: RowPolicyFixture = emptyFixture()) {
  const requests: Array<{ method: string; url: string; body: unknown }> = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const body = request.postDataJSON?.() as Record<string, unknown> | undefined;
    requests.push({ method, url: url.pathname + url.search, body: body ?? null });

    if (url.pathname === "/api/admin/row-policy/templates" && method === "GET") {
      await route.fulfill({
        json: {
          ok: true,
          data: { snapshot: SNAPSHOT, state: "ok", templates: fixture.templates, issues: [] }
        }
      });
      return;
    }
    if (url.pathname === "/api/admin/row-policy/templates" && method === "POST") {
      await route.fulfill({ json: templateWriteResponse(body?.dryRun === false ? false : true) });
      return;
    }
    if (url.pathname.startsWith("/api/admin/row-policy/templates/") && method === "PATCH") {
      await route.fulfill({ json: templateWriteResponse(body?.dryRun === false ? false : true) });
      return;
    }
    if (url.pathname === "/api/admin/row-policy/views/tables") {
      // 选项请求不带筛选；清单请求在 `restricted=true` 时只回受限表
      // （与 server/admin/row-policy-views.ts `restrictedOnly` 一致）。
      const merged = {
        snapshot: SNAPSHOT,
        state: "ok",
        status: "ok",
        tables: [] as TableListEntry[],
        failures: [] as Array<{ subjectId: string; reason: string }>,
        ...fixture.viewsList
      };
      const tables = Array.isArray(merged.tables) ? (merged.tables as TableListEntry[]) : [];
      const restrictedOnly = url.searchParams.get("restricted") === "true";
      await route.fulfill({
        json: {
          ok: true,
          data: {
            ...merged,
            tables: restrictedOnly ? tables.filter((table) => table.restricted) : tables
          }
        }
      });
      return;
    }
    if (url.pathname === "/api/admin/row-policy/views/table") {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            snapshot: SNAPSHOT,
            table: {
              connectionId: DEMO_CONNECTION,
              schema: DEMO_SCHEMA,
              sourceName: DEMO_TABLES.orders,
              physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders)
            },
            state: "ok",
            status: "ok",
            roles: [] as unknown[],
            effectiveRowGrant: null,
            agents: [] as unknown[],
            catalog: { status: "loaded", catalogLoaded: true },
            failures: [] as Array<{ subjectId: string; reason: string }>,
            ...fixture.viewsTable
          }
        }
      });
      return;
    }

    // ── Role 编辑器所需的只读端点 ──
    if (url.pathname === "/api/admin/roles/analyst" && method === "GET") {
      await route.fulfill({ json: { ok: true, data: roleDetail() } });
      return;
    }
    if (url.pathname === "/api/connections") {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            connections: [
              {
                id: DEMO_CONNECTION,
                schemas: [DEMO_SCHEMA],
                enabledTables: [demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders)]
              }
            ]
          }
        }
      });
      return;
    }
    if (url.pathname === `/api/connections/${DEMO_CONNECTION}/tables`) {
      await route.fulfill({
        json: { ok: true, data: { tables: [demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders)] } }
      });
      return;
    }
    if (url.pathname === "/api/admin/mcp-tools") {
      await route.fulfill({
        json: { ok: true, data: { tools: [{ name: "lucy_query", globalDenied: false }] } }
      });
      return;
    }
    if (url.pathname === "/api/admin/roles/preview-row-policy") {
      await route.fulfill({
        json: {
          ok: true,
          candidateDigest: "cand-preview-1",
          basePolicyVersion: "pol-0001",
          tables: [
            {
              requested: {
                connection: DEMO_CONNECTION,
                schema: DEMO_SCHEMA,
                name: "superstore_orders"
              },
              catalog: { status: "loaded", catalogLoaded: true },
              preview: {
                effectiveRowGrant: { kind: "all" },
                roleIds: ["analyst"],
                finalRowsByAgent: [],
                displayShape: "OR-of-AND"
              }
            }
          ]
        }
      });
      return;
    }
    if (url.pathname.startsWith("/api/sources/")) {
      await route.fulfill({
        json: {
          ok: true,
          data: {
            model: {
              conn: DEMO_CONNECTION,
              schema: DEMO_SCHEMA,
              table: DEMO_TABLES.orders,
              filePath: "semantic-layer/superstore_orders.yaml",
              descriptions: {},
              columns: [{ name: "region", type: "string", descriptions: {} }],
              measures: []
            },
            rawYaml: "",
            completion: "done"
          }
        }
      });
      return;
    }

    await route.fulfill({
      status: 404,
      json: { ok: false, error: { code: "NOT_FOUND", message: url.pathname } }
    });
  });

  return { requests };
}

// ─── RTP-06 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行策略模板：草稿变更作废旧预演（RTP-06）", () => {
  test("@p1-acceptance RTP-06 — 改了模板名/说明/谓词后正式保存禁用且影响面板清空，重新预演后才可保存", async ({ page }) => {
    const { requests } = await installRowPolicyApi(page);

    await page.goto("/admin/row-policy-templates");
    await expect(page.getByTestId("row-policy-templates-page")).toBeVisible();

    const nameInput = page.locator("#row-policy-template-name");
    const descriptionInput = page.locator("#row-policy-template-description");
    const fieldInput = page.getByLabel("谓词 1 字段");
    const valueInput = page.getByLabel("谓词 1 取值");
    const dryRunButton = page.getByTestId("row-policy-template-dry-run");
    const saveButton = page.getByTestId("row-policy-template-save");

    await nameInput.fill("by_region");
    await descriptionInput.fill("按大区限定行");
    await fieldInput.fill("region");
    await valueInput.fill(DEMO_REGION_EAST);

    // ── 第一次预演：影响面出现，正式保存解锁 ──
    await dryRunButton.click();
    await expect(page.getByTestId("row-policy-template-impact")).toBeVisible();
    await expect(page.getByTestId("row-policy-template-audit-state")).toHaveText("预演完成，待保存");
    await expect(saveButton).toBeEnabled();

    // ── 改谓词取值：旧预演作废 ──
    await valueInput.fill(DEMO_REGION_SOUTHWEST);
    await expect(page.getByTestId("row-policy-template-impact-empty")).toBeVisible();
    await expect(page.getByTestId("row-policy-template-impact")).toHaveCount(0);
    await expect(saveButton).toBeDisabled();

    // 重新预演后才能保存
    await dryRunButton.click();
    await expect(page.getByTestId("row-policy-template-impact")).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // ── 改模板名：旧预演再次作废 ──
    await nameInput.fill("by_region_v2");
    await expect(page.getByTestId("row-policy-template-impact-empty")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // 改模板名后同样要重新预演才能保存
    await dryRunButton.click();
    await expect(page.getByTestId("row-policy-template-impact")).toBeVisible();
    await expect(saveButton).toBeEnabled();

    // ── 改说明：旧预演同样作废 ──
    await descriptionInput.fill("按大区限定行（改）");
    await expect(page.getByTestId("row-policy-template-impact-empty")).toBeVisible();
    await expect(saveButton).toBeDisabled();

    // 三次草稿变更一共触发三次预演请求，且预演请求体带的是**当前**草稿
    const dryRuns = requests.filter(
      (entry) => entry.url === "/api/admin/row-policy/templates" && entry.method === "POST"
    );
    expect(dryRuns.length).toBe(3);
    expect(dryRuns[0]?.body).toMatchObject({
      name: "by_region",
      description: "按大区限定行",
      predicates: [{ field: "region", op: "eq", value: DEMO_REGION_EAST }]
    });
    expect(dryRuns[2]?.body).toMatchObject({
      name: "by_region_v2",
      description: "按大区限定行",
      predicates: [{ field: "region", op: "eq", value: DEMO_REGION_SOUTHWEST }]
    });
    // 草稿变更期间不得发出正式保存
    expect(
      requests.some((entry) => (entry.body as { dryRun?: unknown } | null)?.dryRun === false)
    ).toBe(false);
  });
});

// ─── RTP-08 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行策略模板：不可绑定项可见且禁用（RTP-08）", () => {
  test("@p1-acceptance RTP-08 — 不可绑定的模板在选择器里可见但禁用，原因在选择时即披露", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.templates = [
      {
        name: "by_region",
        description: "按大区限定行",
        predicates: [{ field: "region", op: "eq", value: DEMO_REGION_EAST }],
        digest: "digest-by-region",
        references: [],
        usabilityByTable: [
          {
            connectionId: DEMO_CONNECTION,
            schema: DEMO_SCHEMA,
            sourceName: "superstore_orders",
            usability: { status: "bindable" }
          }
        ]
      },
      {
        name: "by_missing_field",
        description: "字段不存在",
        predicates: [{ field: "not_a_column", op: "eq", value: "X" }],
        digest: "digest-by-missing",
        references: [],
        usabilityByTable: [
          {
            connectionId: DEMO_CONNECTION,
            schema: DEMO_SCHEMA,
            sourceName: "superstore_orders",
            usability: { status: "field_missing", fields: ["not_a_column"] }
          }
        ]
      }
    ];
    const { requests } = await installRowPolicyApi(page, fixture);

    await page.goto("/admin/roles/analyst?tab=rowPolicy");
    await expect(page.getByTestId("role-row-policy-panel")).toBeVisible();
    await expect(page.getByTestId("row-policy-template-picker")).toBeVisible();

    // 可绑定的模板：可选项
    const bindable = page.getByTestId("row-policy-template-option-by_region");
    await expect(bindable).toHaveCount(1);
    await expect(bindable).not.toBeDisabled();

    // 不可绑定的模板：**可见但禁用**，且原因写在选项里（选择时即披露，不等保存）
    const unbindable = page.getByTestId("row-policy-template-option-by_missing_field");
    await expect(unbindable).toHaveCount(1);
    await expect(unbindable).toBeDisabled();
    await expect(unbindable).toHaveText(/by_missing_field/);
    await expect(unbindable).toHaveText(/不可绑定/);
    await expect(unbindable).toHaveText(/字段不存在/);
    await expect(unbindable).toHaveText(/not_a_column/);

    // 原因在**选择时**已披露：页面不得为此发出任何模板写入请求
    const writes = requests.filter((entry) =>
      /^\/api\/admin\/row-policy\/templates/.test(entry.url) && entry.method !== "GET"
    );
    expect(writes).toHaveLength(0);
  });
});

// ─── RTV-03 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行权限视图：四态可分（RTV-03）", () => {
  test("@p1-acceptance RTV-03 — 无授权/不可满足/编译失败/空筛选四种状态各有独立文案，不共用一个空态", async ({ page }) => {
    const fixture = emptyFixture();
    await installRowPolicyApi(page, fixture);

    const cases: Array<{ status: string; label: string }> = [
      { status: "no_applicable_grant", label: "无授权" },
      { status: "final_rows_unsatisfiable", label: "不可满足" },
      { status: "compile_failed", label: "编译失败" },
      { status: "no_match", label: "空筛选" }
    ];

    const seen: string[] = [];
    for (const item of cases) {
      fixture.viewsList = { status: item.status, tables: [] };
      fixture.viewsTable = { status: item.status };
      await page.goto(demoDeepLink(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders));

      const badge = page
        .getByTestId("row-policy-view-detail")
        .getByTestId(`row-policy-status-${item.status}`);
      await expect(badge).toBeVisible();
      await expect(badge).toHaveText(item.label);
      seen.push((await badge.textContent()) ?? "");
    }

    // 四种文案互不相同
    expect(new Set(seen).size).toBe(4);
  });

  test("@p1-acceptance RTV-03 — 快照不可用时说「快照不可用」，不得说成「没有符合筛选条件的表」", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = { state: "unavailable", status: "unavailable", tables: [] };
    await installRowPolicyApi(page, fixture);

    await page.goto("/admin/row-policies");

    const empty = page.getByTestId("row-policy-view-list-empty");
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("快照当前不可用");
    await expect(empty).not.toContainText("没有符合筛选条件的表");
    await expect(page.getByTestId("row-policy-status-unavailable")).toHaveText("快照不可用");
  });
});

// ─── RTV-04 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行权限视图：深链与完整表身份（RTV-04）", () => {
  test("@p1-acceptance RTV-04 — 深链按 connectionId/schema/sourceName 定位单表，同名不同 Schema 不合并", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = {
      tables: [
        {
          connectionId: DEMO_CONNECTION,
          schema: DEMO_SCHEMA,
          sourceName: DEMO_TABLES.orders,
          physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders),
          roleCount: 1,
          agentCount: 1,
          effectiveRowGrant: { kind: "scoped", digest: "digest-1", orArms: [] },
          restricted: true
        },
        {
          connectionId: DEMO_CONNECTION,
          schema: DEMO_SCHEMA_ALT,
          sourceName: DEMO_TABLES.orders,
          physicalTable: demoPhysicalTable(DEMO_SCHEMA_ALT, DEMO_TABLES.orders),
          roleCount: 1,
          agentCount: 0,
          effectiveRowGrant: { kind: "all" },
          restricted: false
        }
      ]
    };
    fixture.viewsTable = {
      roles: [
        {
          roleId: "analyst",
          rowAccess: "scoped",
          templateRefs: [],
          inlinePredicates: [{ field: "region", op: "eq", value: DEMO_REGION_EAST }],
          rowGrant: { kind: "scoped", digest: "digest-1", orArms: [] }
        }
      ],
      effectiveRowGrant: { kind: "scoped", digest: "digest-1", orArms: [] },
      agents: [
        {
          agentId: "demo_agent",
          enabled: true,
          constraints: [],
          finalRows: { kind: "scoped", digest: "digest-1", orArms: [] }
        }
      ]
    };
    const { requests } = await installRowPolicyApi(page, fixture);

    // ── 一、完整表身份：同名不同 Schema 的两张表是两个条目，不合并 ──
    await page.goto("/admin/row-policies");
    await expect(page.getByTestId("row-policy-view-table-list")).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders))
    ).toBeVisible();
    await expect(page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA_ALT, DEMO_TABLES.orders))).toBeVisible();
    await expect(page.getByTestId("row-policy-view-table-list").locator("tbody tr")).toHaveCount(2);

    // ── 二、深链参数：三个表身份参数缺一不可，且逐字正确 ──
    await page.goto(demoDeepLink(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders));
    await expect
      .poll(() => requests.filter((entry) => entry.url.startsWith("/api/admin/row-policy/views/table?")).length)
      .toBeGreaterThan(0);
    const detailRequest = requests.find((entry) =>
      entry.url.startsWith("/api/admin/row-policy/views/table?")
    );
    expect(detailRequest?.url).toContain(`connectionId=${DEMO_CONNECTION}`);
    expect(detailRequest?.url).toContain(`schema=${DEMO_SCHEMA}`);
    expect(detailRequest?.url).toContain(`sourceName=${DEMO_TABLES.orders}`);

    // 单表详情渲染的是 dataforai 下的那张表，不是同名合并后的东西
    const detail = page.getByTestId("row-policy-view-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(demoIdentity(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders));
    await expect(detail).not.toContainText(demoIdentity(DEMO_CONNECTION, DEMO_SCHEMA_ALT, DEMO_TABLES.orders));
  });
});

// ─── RTV-01／RTV-02：受限表反查闭环（对齐人工 UAT 设计）────────────────
//
// 人工用例锚点：demo-mysql / dataforai / superstore_orders，region = East（demo 真实取值）。
// 浏览器层用同一表身份与字面量验证「仅受限表 → 详情 → 模板／DNF／Agent 最终行约束」；
// 表身份来自 fixtures/helpers/demo-baseline.ts，与真实 demo 实例同一套命名。

const DEMO_OR_ARMS = [
  [{ field: "region", op: "eq", value: DEMO_REGION_EAST }],
  [{ field: "region", op: "eq", value: DEMO_REGION_SOUTHWEST }]
];

const DEMO_SCOPED_GRANT = {
  kind: "scoped" as const,
  digest: "east-southwest-union",
  orArms: DEMO_OR_ARMS
};

function demoScopedTables(): TableListEntry[] {
  return [
    {
      connectionId: DEMO_CONNECTION,
      schema: DEMO_SCHEMA,
      sourceName: DEMO_TABLES.orders,
      physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders),
      roleCount: 2,
      agentCount: 2,
      effectiveRowGrant: DEMO_SCOPED_GRANT,
      grantStatus: "scoped",
      restricted: true
    },
    {
      connectionId: DEMO_CONNECTION,
      schema: DEMO_SCHEMA,
      sourceName: DEMO_TABLES.people,
      physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.people),
      roleCount: 1,
      agentCount: 1,
      effectiveRowGrant: { kind: "all" },
      grantStatus: "all",
      restricted: false
    }
  ];
}

function demoScopedDetail() {
  return {
    table: {
      connectionId: DEMO_CONNECTION,
      schema: DEMO_SCHEMA,
      sourceName: DEMO_TABLES.orders,
      physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders)
    },
    roles: [
      {
        roleId: DEMO_ROLE_EAST,
        rowAccess: "scoped",
        templateRefs: [DEMO_TEMPLATE_EAST],
        inlinePredicates: [],
        rowGrant: {
          kind: "scoped",
          digest: "east-only",
          orArms: [[{ field: "region", op: "eq", value: DEMO_REGION_EAST }]]
        }
      },
      {
        roleId: DEMO_ROLE_SOUTHWEST,
        rowAccess: "scoped",
        templateRefs: [],
        inlinePredicates: [{ field: "region", op: "eq", value: DEMO_REGION_SOUTHWEST }],
        rowGrant: {
          kind: "scoped",
          digest: "southwest-only",
          orArms: [[{ field: "region", op: "eq", value: DEMO_REGION_SOUTHWEST }]]
        }
      }
    ],
    effectiveRowGrant: DEMO_SCOPED_GRANT,
    agents: [
      {
        agentId: DEMO_AGENT_EAST,
        enabled: true,
        constraints: [],
        finalRows: {
          kind: "scoped",
          digest: "east-only",
          orArms: [[{ field: "region", op: "eq", value: DEMO_REGION_EAST }]]
        }
      },
      {
        agentId: DEMO_AGENT_SOUTHWEST,
        enabled: true,
        constraints: [],
        finalRows: {
          kind: "scoped",
          digest: "southwest-only",
          orArms: [[{ field: "region", op: "eq", value: DEMO_REGION_SOUTHWEST }]]
        }
      }
    ]
  };
}

test.describe("P1-1 行权限视图：受限表反查（RTV-01／RTV-02）", () => {
  test("@p1-acceptance RTV-01 — 仅受限表筛出受限表，详情展示模板与 Agent 最终行约束", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = { tables: demoScopedTables() };
    fixture.viewsTable = demoScopedDetail();
    const { requests } = await installRowPolicyApi(page, fixture);

    await page.goto("/admin/row-policies");
    await expect(page.getByTestId("row-policy-view-table-list")).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders))
    ).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.people))
    ).toBeVisible();
    await expect(page.getByTestId("row-policy-view-table-list").locator("tbody tr")).toHaveCount(2);

    // 「仅受限表」：URL 写 restricted=true，清单请求带同名参数，全部行表消失
    await page.getByRole("button", { name: "仅受限表" }).click();
    await expect
      .poll(() =>
        requests.some(
          (entry) =>
            entry.url.startsWith("/api/admin/row-policy/views/tables?") &&
            entry.url.includes("restricted=true")
        )
      )
      .toBe(true);
    await expect(page).toHaveURL(/restricted=true/);
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders))
    ).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.people))
    ).toHaveCount(0);
    await expect(page.getByTestId("row-policy-view-table-list").locator("tbody tr")).toHaveCount(1);
    await expect(
      page
        .getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders))
        .getByTestId("row-policy-view-table-grant")
    ).toHaveText(/受限行授予/);

    // 点开受限表：角色分支含模板引用，Agent 最终行约束可见
    await page.getByRole("button", { name: demoIdentity(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders) }).click();
    const detail = page.getByTestId("row-policy-view-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(demoIdentity(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders));
    await expect(page.getByTestId(`row-policy-view-role-${DEMO_ROLE_EAST}`)).toBeVisible();
    await expect(page.getByTestId("row-policy-view-role-templates")).toHaveText(
      `引用模板：${DEMO_TEMPLATE_EAST}`
    );
    await expect(page.getByTestId("row-policy-dnf-agents-section")).toContainText(DEMO_AGENT_EAST);
    await expect(page.getByTestId("row-policy-dnf-agents-section")).toContainText(DEMO_AGENT_SOUTHWEST);
    await expect(page.getByTestId("row-policy-dnf-union-all")).toHaveCount(0);
  });

  test("@p1-acceptance RTV-02 — East∨Southwest 两受限 Role 保留两条 OR 臂，不显示全部行", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = { tables: demoScopedTables() };
    fixture.viewsTable = demoScopedDetail();
    await installRowPolicyApi(page, fixture);

    await page.goto(
      demoDeepLink(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders)
    );

    const detail = page.getByTestId("row-policy-view-detail");
    await expect(detail).toBeVisible();
    await expect(page.getByTestId("row-policy-dnf-union")).toBeVisible();
    await expect(page.getByTestId("row-policy-dnf-union-arm-0")).toContainText(DEMO_REGION_EAST);
    await expect(page.getByTestId("row-policy-dnf-union-arm-1")).toContainText(DEMO_REGION_SOUTHWEST);
    await expect(page.getByTestId("row-policy-dnf-union-all")).toHaveCount(0);

    const accessLabels = page.getByTestId("row-policy-view-role-access");
    await expect(accessLabels).toHaveCount(2);
    await expect(accessLabels.nth(0)).toHaveText("受限行授予");
    await expect(accessLabels.nth(1)).toHaveText("受限行授予");
    await expect(detail).not.toContainText("行权限：全部行");

    // Southwest 角色是内联条件；East 角色走模板
    await expect(page.getByTestId(`row-policy-view-role-${DEMO_ROLE_SOUTHWEST}`)).toContainText(
      `region 等于 ${DEMO_REGION_SOUTHWEST}`
    );
    await expect(page.getByTestId("row-policy-view-role-templates")).toHaveText(
      `引用模板：${DEMO_TEMPLATE_EAST}`
    );
  });

  test("@p1-acceptance RTV-04 — 选中全部行表后再切仅受限表，详情保留并提示脱离筛选", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = { tables: demoScopedTables() };
    fixture.viewsTable = {
      table: {
        connectionId: DEMO_CONNECTION,
        schema: DEMO_SCHEMA,
        sourceName: DEMO_TABLES.people,
        physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.people)
      },
      roles: [
        {
          roleId: DEMO_ROLE_ALL,
          rowAccess: "all",
          templateRefs: [],
          inlinePredicates: [],
          rowGrant: { kind: "all" }
        }
      ],
      effectiveRowGrant: { kind: "all" },
      agents: [
        {
          agentId: DEMO_AGENT_ALL,
          enabled: true,
          constraints: [],
          finalRows: { kind: "all" }
        }
      ]
    };
    await installRowPolicyApi(page, fixture);

    await page.goto(
      demoDeepLink(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.people)
    );
    await expect(page.getByTestId("row-policy-view-detail")).toContainText(
      demoIdentity(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.people)
    );

    await page.getByRole("button", { name: "仅受限表" }).click();
    await expect(page).toHaveURL(/restricted=true/);
    // 当前表三参数保留；清单不再含该表 → 「当前表不在筛选结果中」
    await expect(page).toHaveURL(new RegExp(`connectionId=${DEMO_CONNECTION}`));
    await expect(page).toHaveURL(new RegExp(`schema=${DEMO_SCHEMA}`));
    await expect(page).toHaveURL(new RegExp(`sourceName=${DEMO_TABLES.people}`));
    await expect(page.getByTestId("row-policy-view-outside-filter")).toHaveText(
      "当前表不在筛选结果中。"
    );
    await expect(page.getByTestId("row-policy-view-detail")).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.orders))
    ).toBeVisible();
    await expect(
      page.getByTestId(demoTableTestId(DEMO_CONNECTION, DEMO_SCHEMA, DEMO_TABLES.people))
    ).toHaveCount(0);
  });
});

// ─── RTV-05 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行权限视图：失败集合披露（RTV-05）", () => {
  test("@p1-acceptance RTV-05 — partial 态明示失败的角色与原因码", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = {
      state: "partial",
      status: "ok",
      failures: [
        { subjectId: "role_broken", reason: "row_policy_field_missing:region" },
        { subjectId: "role_legacy", reason: "role_resolution_failed" }
      ],
      tables: [
        {
          connectionId: DEMO_CONNECTION,
          schema: DEMO_SCHEMA,
          sourceName: DEMO_TABLES.orders,
          physicalTable: demoPhysicalTable(DEMO_SCHEMA, DEMO_TABLES.orders),
          roleCount: 1,
          agentCount: 0,
          effectiveRowGrant: { kind: "all" },
          restricted: false
        }
      ]
    };
    await installRowPolicyApi(page, fixture);

    await page.goto("/admin/row-policies");

    // 呈现修订：诊断默认折叠；摘要中文，机器态 partial 不进 summary 主文案
    const diagnostics = page.getByTestId("row-policy-view-diagnostics");
    await expect(diagnostics).toBeVisible();
    await expect(diagnostics.locator("summary")).toContainText("快照部分可用");
    await expect(diagnostics.locator("summary")).not.toContainText("partial");
    await diagnostics.locator("summary").click();

    // 展开后：状态徽章 + 失败集合逐条列出
    await expect(page.getByTestId("row-policy-view-list-state-badge")).toHaveText("快照部分可用");
    await expect(page.getByTestId("row-policy-view-list-state-badge")).toHaveAttribute(
      "data-snapshot-state",
      "partial"
    );
    const failures = page.getByTestId("row-policy-view-list-failures");
    await expect(failures).toBeVisible();
    await expect(failures).toContainText("role_broken");
    await expect(failures).toContainText("row_policy_field_missing:region");
    await expect(failures).toContainText("role_legacy");
    await expect(failures).toContainText("role_resolution_failed");
  });

  test("@p1-acceptance RTV-05 — 全部失败时显示快照不可用，而不是「0 张表」", async ({ page }) => {
    const fixture = emptyFixture();
    fixture.viewsList = {
      state: "unavailable",
      status: "unavailable",
      tables: [],
      failures: [{ subjectId: "role_broken", reason: "role_resolution_failed" }]
    };
    await installRowPolicyApi(page, fixture);

    await page.goto("/admin/row-policies");

    await expect(page.getByTestId("row-policy-status-unavailable")).toBeVisible();
    const empty = page.getByTestId("row-policy-view-list-empty");
    await expect(empty).toContainText("快照当前不可用");
    await expect(empty).not.toContainText("0 张表");
    await expect(empty).not.toContainText("没有符合筛选条件的表");
  });
});

// ─── RTV-07 ──────────────────────────────────────────────────────────────────

test.describe("P1-1 行权限视图：只读与可达性（RTV-07）", () => {
  test("@p1-acceptance RTV-07 — 页面无写控件，标识输入框受翻译防御且键盘可达", async ({ page }) => {
    await installRowPolicyApi(page, {});
    await page.goto("/admin/row-policies");

    // 只读：页面上没有写入类控件
    await expect(page.getByRole("button", { name: /保存|新建|删除|应用|提交|修改/ })).toHaveCount(0);

    // 五个标识输入框都带 translate="no" + notranslate
    for (const label of ["连接筛选", "Schema 筛选", "表筛选", "角色筛选", "Agent 筛选"]) {
      const input = page.getByLabel(label);
      await expect(input).toHaveAttribute("translate", "no");
      await expect(input).toHaveClass(/notranslate/);
    }

    // 键盘可达：Tab 从「连接筛选」走到「Schema 筛选」再到「表筛选」
    await page.getByLabel("连接筛选").focus();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Schema 筛选")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("表筛选")).toBeFocused();
  });
});
