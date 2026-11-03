// @vitest-environment jsdom
/**
 * Lucy v0.25 P1-2 — 授权摘要 UI 测试（W2 / B7、B8）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4.1、§4.2、§6、§7、
 *     §8（ASV-10／ASV-12／ASV-13／ASV-14）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5
 *
 * 断言针对**行为**：降级时不说数字、候选摘要有标记、角色来源不重复计数、
 * Role 不冒充 Agent 的最终行约束、秘密不泄露。
 */
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthorizationSummaryPage } from "../pages/admin/AuthorizationSummary";
import type { AuthorizationSummary } from "../components/admin/AuthorizationTypes";

afterEach(() => {
  vi.unstubAllGlobals();
});

function allRowGrant() {
  return { kind: "all" as const };
}

function scopedRowGrant() {
  return {
    kind: "scoped" as const,
    digest: "digest-scoped",
    predicates: [],
    orArms: [[{ field: "region", op: "eq", value: "East" }]]
  };
}

type SummaryOverrides = {
  state?: "ok" | "partial" | "unavailable";
  problem?: string | null;
  failures?: Array<{ subjectId: string; reason: string }>;
  basis?: "committed" | "draft";
  candidateOnly?: boolean;
  enabledTableCount?: number | null;
  scopedTableCount?: number | null;
  scopedTableCountBasis?: "final_rows" | "effective_row_grant" | "unknown";
  tableCount?: number;
  connectionCount?: number;
  grantPathCount?: number;
  legacyAllow?: boolean;
  tools?: AuthorizationSummary["tools"];
  roleIds?: string[];
  subjectKind?: "agent" | "role";
  rowBasis?: "final_rows" | "effective_row_grant";
  agentFinalRowsAvailable?: boolean;
  playgroundUrl?: string | null;
  diagnostics?: Array<{ code: string; detail: string }>;
  actions?: Partial<AuthorizationSummary["actions"]>;
};

function buildSummary(overrides: SummaryOverrides = {}): AuthorizationSummary {
  const subjectKind = overrides.subjectKind ?? "agent";
  const rowBasis = overrides.rowBasis ?? (subjectKind === "agent" ? "final_rows" : "effective_row_grant");
  const agentFinalRowsAvailable =
    overrides.agentFinalRowsAvailable ?? (subjectKind === "agent" && rowBasis === "final_rows");
  const tableCount = overrides.tableCount ?? 1;
  const scoped = overrides.scopedTableCount ?? null;
  const capabilities =
    subjectKind === "agent"
      ? [
          {
            tool: "lucy_query",
            rowGrant: scoped === 1 ? scopedRowGrant() : allRowGrant(),
            finalRows: agentFinalRowsAvailable
              ? scoped === 1
                ? scopedRowGrant()
                : allRowGrant()
              : undefined
          }
        ]
      : [
          {
            tool: "lucy_query",
            rowGrant: scoped === 1 ? scopedRowGrant() : allRowGrant()
          }
        ];
  return {
    summaryContext: {
      subject: { kind: subjectKind, id: subjectKind === "agent" ? "a01" : "r01" },
      basis: overrides.basis ?? "committed",
      configVersion: "cfg0123456789abcd",
      policyVersion: "pol0123456789abcd",
      sourceMapVersion: "src0123456789abcd",
      capabilityDigest: "cap0123456789abcd",
      snapshotHash: "a".repeat(64),
      state: overrides.state ?? "ok",
      problem: overrides.problem ?? null,
      failures: overrides.failures ?? [],
      candidateDigest: overrides.candidateOnly ? "cand0123456789ab" : null,
      candidateOnly: overrides.candidateOnly ?? false
    },
    headline: {
      connectionCount: overrides.connectionCount ?? 1,
      tableCount,
      enabledTableCount:
        overrides.enabledTableCount === undefined ? 3 : overrides.enabledTableCount,
      enabledTableDenominatorUnavailableReason:
        overrides.enabledTableCount === null ? "enabled_catalog_unavailable" : null,
      scopedTableCount: scoped,
      scopedTableCountBasis:
        overrides.scopedTableCountBasis ??
        (scoped === null ? "unknown" : rowBasis),
      grantPathCount: overrides.grantPathCount ?? 1,
      state: overrides.state ?? "ok"
    },
    resources: [
      {
        connectionId: "warehouse",
        schemas: [
          {
            schema: "fin",
            tables: [
              {
                sourceKey: "warehouse|fin|fin_ledger|fin.fin_ledger",
                connectionId: "warehouse",
                schema: "fin",
                sourceName: "fin_ledger",
                physicalTable: "fin.fin_ledger",
                roleIds: overrides.roleIds ?? ["r01"],
                capabilities,
                rowSummary: {
                  kind: scoped === 1 ? "scoped" : "all",
                  basis: rowBasis,
                  displayShape: "OR-of-AND",
                  agentFinalRowsAvailable,
                  agentPersonalLimitsApplied: agentFinalRowsAvailable && scoped === 1,
                  templateRefs: [],
                  constraintSummary:
                    rowBasis === "final_rows"
                      ? "最终行约束＝有效行授予 AND Agent 个人行限制（已生效）"
                      : "仅本 Role 的行授予（不含 Agent 个人行限制）",
                  orArms: scoped === 1 ? ["region=East"] : [],
                  digest: scoped === 1 ? "digest-scoped" : null
                },
                playgroundUrl:
                  overrides.playgroundUrl === undefined
                    ? subjectKind === "agent"
                      ? "/admin/mcp-playground?agentId=a01&mode=dry-run&tool=lucy_query&args=%7B%22connectionId%22%3A%22warehouse%22%2C%22sourceName%22%3A%22fin_ledger%22%7D"
                      : null
                    : overrides.playgroundUrl
              }
            ]
          }
        ]
      }
    ],
    tools: overrides.tools ?? {
      query: ["lucy_query"],
      semanticRead: [],
      wikiRead: [],
      write: [],
      meta: ["lucy_catalog"]
    },
    unclassifiedTools: [],
    actions: {
      playgroundUrl:
        subjectKind === "agent"
          ? "/admin/mcp-playground?agentId=a01&mode=dry-run&tool=lucy_query&args=%7B%7D"
          : null,
      accessMapUrl: null,
      rowPolicyViewUrl: null,
      referencingAgentIds: subjectKind === "role" ? ["a01", "a02"] : [],
      ...(overrides.actions ?? {})
    },
    roleContributions: [
      { roleId: "r01", ok: true, tableCount: 1 },
      { roleId: "r02", ok: true, tableCount: 1 }
    ],
    legacyAllow: overrides.legacyAllow ?? false,
    diagnostics: overrides.diagnostics ?? []
  };
}

function renderPage(summary: AuthorizationSummary, entry = "/admin/authorization-summary?kind=agent&id=a01") {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, data: { summary, candidateDigest: null } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    )
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthorizationSummaryPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("AuthorizationSummary page", () => {
  it("shows one headline with the readable connections, the deduped table count and the provable denominator", async () => {
    renderPage(buildSummary({ tableCount: 2, enabledTableCount: 13, grantPathCount: 3 }));
    const headline = await screen.findByTestId("authorization-headline-text");
    expect(headline).toHaveTextContent("可读 1 个连接、13 张表中的 2 张");
    expect(headline).toHaveTextContent("授权路径 3 条");
    // 表数不得随工具数或角色数放大。
    expect(headline).not.toHaveTextContent("6 张");
  });

  it("does not fill the enabled-table denominator with 0 when it cannot be proven", async () => {
    renderPage(buildSummary({ enabledTableCount: null, tableCount: 6 }));
    const headline = await screen.findByTestId("authorization-headline-text");
    expect(headline).toHaveTextContent("启用表总数暂不可用");
    expect(headline).not.toHaveTextContent("0 张表");
    expect(screen.getByTestId("authorization-denominator-unknown")).toBeInTheDocument();
  });

  it("renders no resource card and no zero counts when the summary is unavailable", async () => {
    renderPage(
      buildSummary({ state: "unavailable", problem: "access_unreadable", tableCount: 0 })
    );
    await screen.findByTestId("authorization-headline-unavailable");
    expect(screen.queryByTestId("authorization-resource-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("authorization-headline-text")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 张表/)).not.toBeInTheDocument();
  });

  it("shows the resolved set plus the failed Role list when the summary is partial", async () => {
    renderPage(
      buildSummary({
        state: "partial",
        failures: [{ subjectId: "r02", reason: "role_resolution_failed:r02" }],
        tableCount: 1
      })
    );
    const notice = await screen.findByTestId("authorization-partial-notice");
    expect(notice).toHaveTextContent("不等于完整授权");
    expect(notice).toHaveTextContent("r02");
    // 已解析的集合仍然展示。
    expect(screen.getByTestId("authorization-resource-card")).toBeInTheDocument();
  });

  it("marks a candidate summary as not in effect yet", async () => {
    renderPage(buildSummary({ basis: "draft", candidateOnly: true }));
    expect(await screen.findByTestId("authorization-candidate-notice")).toHaveTextContent(
      "候选预览，尚未生效"
    );
  });

  it("lists one row per table and shows every contributing Role", async () => {
    renderPage(buildSummary({ roleIds: ["r01", "r02"], tableCount: 1, grantPathCount: 2 }));
    const rows = await screen.findAllByTestId("authorization-resource-row");
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(within(row).getByText("fin_ledger")).toBeInTheDocument();
    expect(within(row).getByText("r01")).toBeInTheDocument();
    expect(within(row).getByText("r02")).toBeInTheDocument();
  });

  it("offers the MCP 调试台 deep link with the prefilled table and no live-call trigger", async () => {
    renderPage(buildSummary());
    const link = await screen.findByTestId("authorization-playground-link");
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("/admin/mcp-playground?");
    expect(href).toContain("agentId=a01");
    expect(href).toContain("mode=dry-run");
    expect(href).toContain("tool=lucy_query");
    expect(href).toContain("args=");
    expect(href).not.toContain("live-smoke");
  });

  it("keeps the Role view from impersonating an Agent's final row constraints", async () => {
    renderPage(
      buildSummary({
        subjectKind: "role",
        rowBasis: "effective_row_grant",
        agentFinalRowsAvailable: false,
        scopedTableCount: 1,
        scopedTableCountBasis: "effective_row_grant"
      }),
      "/admin/authorization-summary?kind=role&id=r01"
    );
    const basis = await screen.findByTestId("authorization-row-boundary-basis");
    expect(basis).toHaveTextContent("不含任何");
    expect(basis).toHaveTextContent("个人行限制");
    // Role 不是可认证 Agent → 没有调试台预填链接。
    expect(screen.queryByTestId("authorization-playground-link")).not.toBeInTheDocument();
  });

  it("shows the write group as empty instead of implying database writes are open", async () => {
    renderPage(buildSummary());
    const group = await screen.findByTestId("authorization-tool-group-write");
    expect(group).toHaveTextContent("现行权限模型没有可授予的写入工具");
    expect(group).toHaveTextContent("不代表数据库 DML／DDL 已开放");
  });

  it("never shows an AbsoluteDeny tool as a granted capability", async () => {
    renderPage(
      buildSummary({
        tools: {
          query: ["lucy_query"],
          semanticRead: [],
          wikiRead: [],
          write: [],
          meta: ["lucy_catalog"]
        }
      })
    );
    const groups = await screen.findByTestId("authorization-tool-groups");
    expect(groups).not.toHaveTextContent("sql_execution");
    expect(groups).not.toHaveTextContent("memory_ingest");
    expect(groups).not.toHaveTextContent("sl_query");
  });

  it("marks a legacy allow subject as 旧 ACL without inventing a Role source", async () => {
    renderPage(buildSummary({ legacyAllow: true, roleIds: [] }));
    await screen.findByTestId("authorization-resource-row");
    expect(screen.getByText("旧 ACL（无角色来源）")).toBeInTheDocument();
    expect(screen.getByTestId("authorization-legacy-notice")).toHaveTextContent("旧 ACL");
  });

  it("keeps the technical details collapsed by default", async () => {
    renderPage(buildSummary());
    const details = await screen.findByTestId("authorization-technical-details");
    expect(details).not.toHaveAttribute("open");
    const body = screen.getByTestId("authorization-technical-body");
    expect(body).toHaveTextContent("capabilityDigest");
  });

  it("leaks no token plaintext into the page", async () => {
    const summary = buildSummary();
    const secret = "super-secret-token-value";
    (summary as unknown as Record<string, unknown>).secret = secret;
    renderPage(summary);
    await screen.findByTestId("authorization-summary-panel");
    expect(document.body.textContent ?? "").not.toContain(secret);
  });

  it("reports a read failure instead of rendering an empty authorization", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: false, error: { message: "boom" } }), {
          status: 500,
          headers: { "content-type": "application/json" }
        })
      )
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/authorization-summary?kind=agent&id=a01"]}>
          <AuthorizationSummaryPage />
        </MemoryRouter>
      </QueryClientProvider>
    );
    await waitFor(() => {
      expect(screen.getByTestId("authorization-summary-error")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("authorization-summary-panel")).not.toBeInTheDocument();
  });
});

/**
 * P0-1：服务端算好的 `actions` 必须被前端**渲染**出来。
 *
 * 之前这三���深链只存在于类型声明里，没有任何组件消费它们 —— 摘要就只剩一段
 * 文字，读者拿不到下一步入口（P1-2 §4.1／§4.2、SC-06）。
 */
describe("授权摘要的关联页面深链（P0-1）", () => {
  it("渲染访问关系图深链，label 用术语标准主术语「访问关系图」", async () => {
    renderPage(
      buildSummary({ actions: { accessMapUrl: "/admin/access-map?agent=a01" } })
    );
    const link = await screen.findByTestId("authorization-access-map-link");
    expect(link).toHaveAttribute("href", "/admin/access-map?agent=a01");
    expect(link).toHaveTextContent("访问关系图");
  });

  it("渲染行权限视图深链，URL 用 connectionId／schema／sourceName 三个参数名", async () => {
    renderPage(
      buildSummary({
        actions: {
          rowPolicyViewUrl:
            "/admin/row-policies?connectionId=warehouse&schema=fin&sourceName=fin_ledger"
        }
      })
    );
    const link = await screen.findByTestId("authorization-row-policy-link");
    const href = link.getAttribute("href") ?? "";
    expect(link).toHaveTextContent("行权限视图");
    expect(href).toContain("connectionId=warehouse");
    expect(href).toContain("schema=fin");
    expect(href).toContain("sourceName=fin_ledger");
  });

  it("渲染 MCP 调试台深链", async () => {
    renderPage(
      buildSummary({
        actions: {
          playgroundUrl: "/admin/mcp-playground?agentId=a01&mode=dry-run&tool=lucy_query&args=%7B%7D"
        }
      })
    );
    const link = await screen.findByTestId("authorization-playground-deep-link");
    expect(link.getAttribute("href") ?? "").toContain("/admin/mcp-playground?");
    expect(link).toHaveTextContent("MCP 调试台");
  });

  it("「受影响 Agent」逐个链接到各自的授权摘要", async () => {
    renderPage(
      buildSummary({
        subjectKind: "role",
        actions: { referencingAgentIds: ["a01", "a02"] }
      }),
      "/admin/authorization-summary?kind=role&id=r01"
    );
    const first = await screen.findByTestId("authorization-referencing-agent-a01");
    const second = screen.getByTestId("authorization-referencing-agent-a02");
    expect(first).toHaveAttribute("href", "/admin/authorization-summary?kind=agent&id=a01");
    expect(second).toHaveAttribute("href", "/admin/authorization-summary?kind=agent&id=a02");
    // 承载标识的链接文本必须受翻译防御。
    expect(first).toHaveAttribute("translate", "no");
    expect(first.className).toContain("notranslate");
  });

  it("没有任何可给链接时不渲染空的「关联页面」区", async () => {
    renderPage(
      buildSummary({ subjectKind: "role", actions: { referencingAgentIds: [] } })
    );
    await screen.findByTestId("authorization-summary-panel");
    expect(screen.queryByTestId("authorization-related-links")).not.toBeInTheDocument();
  });
});

/** P2-6：Schema 的**值**也是数据库对象标识，必须与「Schema」一词同样受翻译防御。 */
describe("授权资源卡片的标识翻译防御（P2-6）", () => {
  it("Schema 值带 translate=\"no\" + notranslate", async () => {
    renderPage(buildSummary());
    await screen.findByTestId("authorization-resource-card");
    const schemaValue = screen.getByText("fin");
    expect(schemaValue).toHaveAttribute("translate", "no");
    expect(schemaValue.className).toContain("notranslate");
  });
});

/**
 * P3-11：授权摘要有独立路由 `/admin/authorization-summary?kind=<kind>&id=<id>`，
 * 「受影响 Agent」的链接指向它。
 */
describe("授权摘要独立路由（P3-11）", () => {
  it("按 URL 的 kind 与 id 读取对应主体的摘要", async () => {
    renderPage(buildSummary({ subjectKind: "role" }), "/admin/authorization-summary?kind=role&id=r01");
    const headline = await screen.findByTestId("authorization-headline-text");
    expect(headline).toHaveTextContent("Role");
  });

  it("缺少 id 时说明缺参数，而不是一直转圈", async () => {
    renderPage(buildSummary(), "/admin/authorization-summary?kind=agent");
    expect(await screen.findByTestId("authorization-summary-missing-id")).toHaveTextContent("缺少查询参数");
    expect(screen.queryByTestId("authorization-summary-loading")).not.toBeInTheDocument();
  });
});
