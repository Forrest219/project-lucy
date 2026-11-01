// @vitest-environment jsdom
/**
 * Lucy v0.25 P1-2（L25-01）— 授权摘要**功能合同收口**补齐的前端验收用例。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4.1、§6、§7、§8
 *     ASV-08、ASV-10、ASV-13、ASV-14 的验收条款原文
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B6、B7、B8）
 *
 * 这个文件只补**矩阵里有、但仓里没有任何断言**的那几小句；既有断言一行未改。
 *
 *   ASV-10 「只触发既有 ACL 预览，不自动执行查询」——此前只断言了 URL 形状，
 *         没有任何「页面自己不发请求」的断言
 *   ASV-13 响应／页面不含秘密——此前只查了 textContent，属性里的泄漏查不到
 *   ASV-14 完整标识翻译防御——此前只断言了 Schema 一个值
 *   ASV-14 键盘与文本降级——此前没有任何断言
 *
 * 本文件位于 `webui/src/` 下：仓里有一条守卫会**逐文件扫描** `webui/src/` 的全部
 * 源文件，正文里不要出现被禁的界面词（本文件用「技能库／skill library」以外的
 * 说法一律不需要——这里根本不提那个词）。
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
  vi.restoreAllMocks();
});

const DB_PASSWORD = "DB-PASSWORD-MARKER";
const TOKEN_PLAINTEXT = "TOKEN-PLAINTEXT-MARKER";

/**
 * 一个覆盖到「有行约束、有多个工具、有角色来源、目录分母不可证明」的摘要。
 * 字段与 `server/admin/authorization-summary.ts` 的派生结果同形。
 */
function buildSummary(overrides: Partial<AuthorizationSummary> = {}): AuthorizationSummary {
  const base: AuthorizationSummary = {
    summaryContext: {
      subject: { kind: "agent", id: "a01" },
      basis: "committed",
      configVersion: "cfg0123456789abcd",
      policyVersion: "pol0123456789abcd",
      sourceMapVersion: "src0123456789abcd",
      capabilityDigest: "cap0123456789abcd",
      snapshotHash: "a".repeat(64),
      state: "ok",
      problem: null,
      failures: [],
      candidateDigest: null,
      candidateOnly: false
    },
    headline: {
      connectionCount: 1,
      tableCount: 1,
      enabledTableCount: null,
      enabledTableDenominatorUnavailableReason: "enabled_catalog_unavailable",
      scopedTableCount: 1,
      scopedTableCountBasis: "final_rows",
      grantPathCount: 2,
      state: "ok"
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
                roleIds: ["r01", "r02"],
                capabilities: [
                  { tool: "lucy_query", rowGrant: { kind: "scoped", digest: "d1", predicates: [], orArms: [[{ field: "region", op: "eq", value: "East" }]] } },
                  { tool: "lucy_read_source", rowGrant: { kind: "scoped", digest: "d1", predicates: [], orArms: [[{ field: "region", op: "eq", value: "East" }]] } }
                ],
                rowSummary: {
                  kind: "scoped",
                  basis: "final_rows",
                  displayShape: "OR-of-AND",
                  agentFinalRowsAvailable: true,
                  agentPersonalLimitsApplied: true,
                  templateRefs: [],
                  constraintSummary: "最终行约束＝有效行授予 AND Agent 个人行限制（已生效）",
                  orArms: ["region=East"],
                  digest: "d1"
                },
                playgroundUrl:
                  "/admin/mcp-playground?agentId=a01&mode=dry-run&tool=lucy_query&args=%7B%22connectionId%22%3A%22warehouse%22%2C%22sourceName%22%3A%22fin_ledger%22%7D"
              }
            ]
          }
        ]
      }
    ],
    tools: {
      query: ["lucy_query"],
      semanticRead: ["lucy_read_source"],
      wikiRead: [],
      write: [],
      meta: ["lucy_catalog"]
    },
    unclassifiedTools: [],
    actions: {
      playgroundUrl:
        "/admin/mcp-playground?agentId=a01&mode=dry-run&tool=lucy_query&args=%7B%7D",
      accessMapUrl: "/admin/access-map?agent=a01",
      rowPolicyViewUrl: null,
      referencingAgentIds: []
    },
    roleContributions: [
      { roleId: "r01", ok: true, tableCount: 1 },
      { roleId: "r02", ok: true, tableCount: 1 }
    ],
    legacyAllow: false,
    diagnostics: []
  };
  return { ...base, ...overrides };
}

type FetchCall = { url: string; method: string; body: string | null };

function renderPage(summary: AuthorizationSummary, entry = "/admin/authorization-summary?kind=agent&id=a01") {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: (init?.method ?? "GET").toUpperCase(),
      body: typeof init?.body === "string" ? init.body : null
    });
    return new Response(JSON.stringify({ ok: true, data: { summary, candidateDigest: null } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AuthorizationSummaryPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { calls, fetchMock };
}

/** 完整标识必须同时带 `translate="no"` 与 `notranslate`（术语标准 §2.6）。 */
function expectTranslateDefense(element: Element): void {
  expect(element).toHaveAttribute("translate", "no");
  expect(element.className).toContain("notranslate");
}

describe("L25-01 §8 — ASV-10 调试台深链：只触发既有 ACL 预览，不自动执行查询", () => {
  it("ASV-10 — 打开摘要只发一次只读请求，不会发任何调试台请求", async () => {
    const { calls } = renderPage(buildSummary());
    await screen.findByTestId("authorization-summary-panel");

    // 只有一次取数，而且是摘要自己的 GET。
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].url).toContain("/api/admin/authorization-summary/agent/a01");

    // 页面自己**不**发任何调试台请求：既不预跑 ACL 预览，也不发起受控试调。
    for (const call of calls) {
      expect(call.url).not.toContain("mcp-playground");
      expect(call.method).not.toBe("POST");
    }
  });

  it("ASV-10 — 调试台入口是普通链接，不是一个会发请求的按钮", async () => {
    const { calls } = renderPage(buildSummary());
    const link = await screen.findByTestId("authorization-playground-link");

    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href");
    expect(link).not.toHaveAttribute("role", "button");
    // 链接指向既有 ACL 裁决预览（dry-run），不是受控试调。
    const href = link.getAttribute("href") ?? "";
    expect(href).toContain("mode=dry-run");
    expect(href).not.toContain("live-smoke");

    // 点击这个链接本身不发请求（它是导航，不是动作）。
    expect(calls).toHaveLength(1);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });
});

describe("L25-01 §8 — ASV-13 只读与秘密保护", () => {
  it("ASV-13 — 页面（含属性）不含 Token 明文、数据库密码或超授权内容", async () => {
    const summary = buildSummary();
    // 把秘密塞进摘要的各个角落：正文、动作、技术详情都会渲染它们。
    (summary as unknown as Record<string, unknown>).tokenPlaintext = TOKEN_PLAINTEXT;
    (summary.actions as unknown as Record<string, unknown>).dbPassword = DB_PASSWORD;
    (summary.resources[0].schemas[0].tables[0] as unknown as Record<string, unknown>).overGranted =
      "fin_secret";

    renderPage(summary);
    await screen.findByTestId("authorization-summary-panel");

    const html = document.body.innerHTML;
    expect(html).not.toContain(TOKEN_PLAINTEXT);
    expect(html).not.toContain(DB_PASSWORD);
    expect(html).not.toContain("fin_secret");
  });
});

describe("L25-01 §8 — ASV-14 完整标识翻译防御", () => {
  it("ASV-14 — 连接、Schema、表、物理表、角色、工具与行分支都受翻译防御", async () => {
    renderPage(buildSummary());
    const card = await screen.findByTestId("authorization-resource-card");

    // 完整标识（数据库对象标识）逐个断言。
    expectTranslateDefense(within(card).getByText("warehouse"));
    expectTranslateDefense(within(card).getByText("fin"));
    expectTranslateDefense(within(card).getByText("fin_ledger"));
    expectTranslateDefense(within(card).getByText("fin.fin_ledger"));
    expectTranslateDefense(within(card).getByText("r01"));
    expectTranslateDefense(within(card).getByText("r02"));
    expectTranslateDefense(within(card).getByText("lucy_query"));
    expectTranslateDefense(within(card).getByText("lucy_read_source"));

    // 行边界里的完整表达式同样受防御。
    const boundary = screen.getByTestId("authorization-row-boundary");
    expectTranslateDefense(within(boundary).getByText("region=East"));

    // 工具分组里的工具名同样受防御。
    const groups = screen.getByTestId("authorization-tool-groups");
    expectTranslateDefense(within(groups).getByText("lucy_query"));

    // 技术详情是完整标识的转储，整块受防御。
    const technical = screen.getByTestId("authorization-technical-body");
    expectTranslateDefense(technical);
  });
});

describe("L25-01 §8 — ASV-14 键盘与文本降级", () => {
  it("ASV-14 — 技术详情是原生可键盘操作的折叠控件", async () => {
    renderPage(buildSummary());
    const details = await screen.findByTestId("authorization-technical-details");
    // `<details>` + `<summary>` 是原生披露控件：默认可聚焦、可用键盘展开。
    expect(details.tagName).toBe("DETAILS");
    expect(details).not.toHaveAttribute("open");

    const summaryEl = details.querySelector("summary");
    expect(summaryEl).not.toBeNull();
    expect(summaryEl?.tagName).toBe("SUMMARY");
    // `<summary>` 原生可聚焦（不是 tabindex="-1" 的禁用元素）。
    expect(summaryEl?.getAttribute("tabindex")).not.toBe("-1");
    expect(summaryEl?.textContent).toContain("技术详情");
  });

  it("ASV-14 — 资源表格有表题与列头作用域，不只靠颜色或位置表意", async () => {
    renderPage(buildSummary());
    const card = await screen.findByTestId("authorization-resource-card");

    const table = card.querySelector("table");
    expect(table).not.toBeNull();
    // 表题：读屏用户能知道这张表是什么。
    const caption = table?.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption?.textContent?.trim()).not.toBe("");

    // 每一列都有作用域声明。
    const headers = [...(table?.querySelectorAll("th") ?? [])];
    expect(headers.length).toBeGreaterThan(0);
    for (const header of headers) {
      expect(header).toHaveAttribute("scope", "col");
    }
  });

  it("ASV-14 — 分母不可证明时用文本说明，不用 0 也不用百分比", async () => {
    renderPage(buildSummary());
    await screen.findByTestId("authorization-summary-panel");
    expect(screen.getByTestId("authorization-headline-text")).toHaveTextContent("启用表总数暂不可用");
    expect(screen.getByTestId("authorization-denominator-unknown")).toHaveTextContent("分母未知");
    // 不是 0，也不是百分比。
    expect(screen.getByTestId("authorization-headline-text")).not.toHaveTextContent("0 张表");
    expect(screen.getByTestId("authorization-headline-text")).not.toHaveTextContent("%");
  });

  it("ASV-14 — 配置非法时给出明确降级文案，并说清「不代表没有权限」", async () => {
    const unavailable = buildSummary();
    unavailable.summaryContext.state = "unavailable";
    unavailable.summaryContext.problem = "access_invalid";
    unavailable.headline.state = "unavailable";
    renderPage(unavailable);
    const notice = await screen.findByTestId("authorization-headline-unavailable");
    expect(notice).toHaveTextContent("授权配置无法解析");
    expect(notice).toHaveTextContent("不代表该主体没有权限");
    // 不渲染资源卡，也不出现「0 张表」。
    expect(screen.queryByTestId("authorization-resource-card")).not.toBeInTheDocument();
    expect(screen.queryByText(/0 张表/)).not.toBeInTheDocument();
  });

  it("ASV-14 — 行边界口径不同时，页面用文本说明是哪一种口径", async () => {
    const roleView = buildSummary();
    roleView.summaryContext.subject = { kind: "role", id: "r01" };
    roleView.resources[0].schemas[0].tables[0].rowSummary = {
      ...roleView.resources[0].schemas[0].tables[0].rowSummary,
      basis: "effective_row_grant",
      agentFinalRowsAvailable: false,
      agentPersonalLimitsApplied: false,
      constraintSummary: "仅本 Role 的行授予（不含 Agent 个人行限制）"
    };
    roleView.headline.scopedTableCountBasis = "effective_row_grant";
    renderPage(roleView, "/admin/authorization-summary?kind=role&id=r01");
    const basis = await screen.findByTestId("authorization-row-boundary-basis");
    expect(basis).toHaveTextContent("不含任何");
    expect(basis).toHaveTextContent("个人行限制");
  });
});

describe("L25-01 §8 — ASV-14 既有页面行为无回归", () => {
  it("ASV-14 — 摘要区块是只读投影：面板里没有任何写控件", async () => {
    const { calls } = renderPage(buildSummary());
    await screen.findByTestId("authorization-summary-panel");

    // 面板里没有任何写入口（没有按钮发起保存／提交）。
    const panel = screen.getByTestId("authorization-summary-panel");
    const buttons = [...panel.querySelectorAll("button")];
    expect(buttons).toHaveLength(0);
    // 唯一的交互是链接与原生折叠控件。
    expect(panel.querySelectorAll("a").length).toBeGreaterThan(0);
    expect(calls.every((call) => call.method === "GET")).toBe(true);
  });

  it("ASV-14 — 读取失败时只报失败，不渲染一个空授权（既有行为不回归）", async () => {
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
