// @vitest-environment jsdom
//
// 逐处镜像契约（Spec §6.1 SC-01–SC-13 的条件 2 / 3；SC-23 的消费点 trim）。
//
// Audit's 7 处在 `admin-audit-url-mirror.test.tsx`——那边有可控延迟的 router
// 替身，所以连 POP（条件 4）与回声协议（SC-22）一起覆盖。本文件补齐其余
// 4 个页面的 6 处：
//
//   | 页面 | 输入框 | URL 参数 |
//   |---|---|---|
//   | 配置审计 | 目标 ID | `targetId` |
//   | 配置审计 | 文件路径 | `filePath` |
//   | 配置审计 | 来源 | `source` |
//   | Token | 搜索 Token | `search` |
//   | 目录 | 搜索表名或字段名 | `q` |
//   | 发布历史 | 操作人 | `actor` |
//
// 断言口径（Spec §5.2 / §5.4）：
//   - 受控输入框的值 = 用户输入的**原文**（尾空格保留在输入框与 URL 里）；
//   - URL 对应 param **立即**等于原文（D4 已否决防抖）；
//   - 规范化（trim）只发生在下游消费点，不发生在写回处。
//
// jsdom 没有真实 IME，本文件**不**用来证明组合不被打断——那是 SC-17 的真浏览器
// 探针（`webui/scripts/ime-composition-probe.mjs`）的职责。条件 1（`value`
// 不取自 URL 派生变量）对全部 13 处由静态门禁 `npm run lint:url-driven-input`
// 逐文件打假。

import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Catalog } from "../pages/Catalog";
import { ConfigAudit } from "../pages/admin/ConfigAudit";
import { Tokens } from "../pages/admin/Tokens";
import { PublishHistory } from "../pages/publish/PublishHistory";
import type { SourceSummary } from "../lib/types";

/**
 * 把当前 URL 暴露成可断言的 DOM 节点。MemoryRouter 下 `setSearchParams` 会
 * 驱动它重渲染，因此可以直接断言 URL 里的参数值。
 */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="probe-location">{location.search}</output>;
}

function currentSearch(): URLSearchParams {
  return new URLSearchParams(screen.getByTestId("probe-location").textContent ?? "");
}

async function expectParam(param: string, expected: string | null) {
  await waitFor(() => {
    expect(currentSearch().get(param)).toBe(expected);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── 配置审计（3 处）──────────────────────────────────────────────────────────

function stubConfigAudit() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              total: 0,
              actorMode: "single_local_admin",
              actorNotice: "",
              entries: []
            }
          }),
          { status: 200 }
        )
    )
  );
}

function renderConfigAudit(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ConfigAudit />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const CONFIG_AUDIT_CASES = [
  { id: "targetId", label: "目标 ID", param: "targetId" },
  { id: "filePath", label: "文件路径", param: "filePath" },
  { id: "source", label: "来源", param: "source" }
] as const;

describe("配置审计：逐处镜像（SC-08 / SC-09 / SC-10）", () => {
  for (const testCase of CONFIG_AUDIT_CASES) {
    it(`${testCase.id}：深链初值显示该值；键入后 URL 立即等于原文并保留尾空格`, async () => {
      stubConfigAudit();
      renderConfigAudit(`/admin/config-audit?${testCase.param}=seed`);

      const input = (await screen.findByLabelText(testCase.label)) as HTMLInputElement;

      // 条件 3：深链打开时输入框显示 URL 里的值。
      expect(input).toHaveValue("seed");

      // 条件 2：输入框保留原文（含尾空格）。
      fireEvent.change(input, { target: { value: "abc " } });
      expect(input).toHaveValue("abc ");

      // 条件 2：URL 对应 param 立即等于原文。
      await expectParam(testCase.param, "abc ");
    });
  }
});

// ─── Token（1 处）────────────────────────────────────────────────────────────

function stubTokens() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/agents")) {
        return new Response(
          JSON.stringify({ ok: true, data: { agents: [], version: 1, summary: {} } })
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            tokens: [],
            stats: {
              totalTokens: 0,
              availableTokens: 0,
              activeLast7dTokens: 0,
              expiringSoonTokens: 0,
              expiredTokens: 0
            }
          }
        }),
        { status: 200 }
      );
    })
  );
}

function renderTokens(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/tokens" element={<Tokens />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Token：逐处镜像（SC-11）", () => {
  it("深链初值显示该值；键入后 URL 立即等于原文并保留尾空格", async () => {
    stubTokens();
    renderTokens("/admin/tokens?search=seed");

    const input = (await screen.findByLabelText("搜索 Token")) as HTMLInputElement;
    expect(input).toHaveValue("seed");

    fireEvent.change(input, { target: { value: "abc " } });
    expect(input).toHaveValue("abc ");
    await expectParam("search", "abc ");
  });

  it("SC-23：文本 `all` 是普通文本，不走下拉框的「清空」哨兵", async () => {
    stubTokens();
    renderTokens("/admin/tokens");

    const input = (await screen.findByLabelText("搜索 Token")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "all" } });

    // 输入框留着 `all`，URL 里 `search=all` 也在——参数没有因为值等于 "all" 被删掉。
    expect(input).toHaveValue("all");
    await expectParam("search", "all");
  });

  it("SC-23：下拉框的 `all` 清空哨兵不变——选「全部状态」把 status 参数删掉", async () => {
    stubTokens();
    renderTokens("/admin/tokens?status=expired");

    const select = (await screen.findByLabelText("按状态筛选")) as HTMLSelectElement;
    expect(select).toHaveValue("expired");

    fireEvent.change(select, { target: { value: "all" } });

    // 下拉框仍走 `updateParam` 的哨兵：`all` = 清空 ⇒ URL 里没有 status。
    await expectParam("status", null);
  });
});

// ─── 目录（1 处）─────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<SourceSummary> = {}): SourceSummary {
  const table = overrides.table ?? "abc_orders";
  const schema = overrides.schema ?? "dataforai";
  return {
    conn: "mysql-aliyun",
    schema,
    table,
    filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
    columnCount: 8,
    columnNames: ["order_id", "order_date"],
    hasTableDesc: true,
    hasGrain: true,
    measureCount: 9,
    joinCount: 1,
    wikiRefCount: 0,
    completion: "done",
    mtime: "2026-06-15T08:00:00.000Z",
    enabled: true,
    authorizedAgentCount: 3,
    semanticUpdatedAt: "2026-07-01T10:30:00.000Z",
    semanticUpdatedAtSource: "overlay",
    ...overrides,
    qualifiedName: overrides.qualifiedName ?? `${overrides.schema ?? schema}.${overrides.table ?? table}`
  };
}

function stubCatalog(tables: SourceSummary[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/sources")) {
        return new Response(JSON.stringify({ ok: true, data: { tables } }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      return new Response(JSON.stringify({ ok: true, data: { recorded: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    })
  );
}

function renderCatalog(tables: SourceSummary[], initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Catalog />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("目录：逐处镜像（SC-12）", () => {
  it("深链初值显示该值；键入后 URL 立即等于原文并保留尾空格", async () => {
    stubCatalog([makeSummary()]);
    renderCatalog([makeSummary()], "/catalog?q=seed");

    const input = (await screen.findByPlaceholderText("搜索表名或字段名...")) as HTMLInputElement;
    expect(input).toHaveValue("seed");

    fireEvent.change(input, { target: { value: "abc " } });
    expect(input).toHaveValue("abc ");
    await expectParam("q", "abc ");
  });

  it("SC-23：消费点按 trim 后的值过滤（原始尾空格只留在输入框与 URL 里）", async () => {
    stubCatalog([makeSummary()]);
    renderCatalog([makeSummary()], "/catalog");

    const input = (await screen.findByPlaceholderText("搜索表名或字段名...")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc " } });

    // URL 里是原文 "abc "。
    await expectParam("q", "abc ");
    // 过滤消费点 trim 成 "abc" 才匹配得上 `abc_orders`——若拿原文去过滤，
    // "abc " 匹配不到任何表名，这里就会看到空态。
    expect(await screen.findByTestId("catalog-row-abc_orders")).toBeInTheDocument();
  });
});

// ─── 发布历史（1 处）─────────────────────────────────────────────────────────

function stubPublishHistory() {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, data: { records: [], total: 0 } }), {
          status: 200
        })
    )
  );
}

function renderPublishHistory(initialEntry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <PublishHistory />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("发布历史：逐处镜像（SC-13）", () => {
  it("深链初值显示该值；键入后 URL 立即等于原文并保留尾空格", async () => {
    stubPublishHistory();
    renderPublishHistory("/publish/history?actor=seed");

    const input = (await screen.findByLabelText("操作人")) as HTMLInputElement;
    expect(input).toHaveValue("seed");

    fireEvent.change(input, { target: { value: "abc " } });
    expect(input).toHaveValue("abc ");
    await expectParam("actor", "abc ");
  });
});
