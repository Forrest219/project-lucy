// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigAudit } from "../pages/admin/ConfigAudit";

function renderConfigAudit(initialPath = "/admin/config-audit") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialPath]}>
        <ConfigAudit />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConfigAudit Spec 96 polish", () => {
  it("renders 配置审计 without actorNotice and with pl-data-grid Chinese headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            total: 22,
            actorMode: "single_local_admin",
            actorNotice: "当前为单管理员模式，actor=local-admin 仅表示本机管理入口，不具备多人问责语义。",
            entries: Array.from({ length: 20 }, (_, index) => ({
              id: index + 1,
              ts: "2026-08-05T07:00:00.000Z",
              actor: "local-admin",
              actorType: "ui_admin",
              source: "admin_agents_api",
              filePath: "webui/config/access.yaml",
              assetKind: "governance",
              changeType: "agent_patch",
              targetId: `agent-${index + 1}`,
              writeStatus: "committed"
            }))
          }
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    renderConfigAudit();

    expect(await screen.findByRole("heading", { name: "配置审计" })).toBeInTheDocument();
    expect(screen.queryByText(/不具备多人问责语义/)).not.toBeInTheDocument();
    expect(screen.getByText("查看治理配置与语义资产的写入历史。")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "面包屑" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("page-header-badges")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "导出 CSV" })).toHaveClass("pl-btn--secondary");
    expect(screen.queryByRole("link", { name: "访问日志" })).not.toBeInTheDocument();

    const table = await screen.findByTestId("config-audit-table");
    expect(table).toHaveClass("pl-data-grid");
    expect(table).toHaveClass("pl-audit-table");
    expect(within(table).getByRole("columnheader", { name: "操作者" })).toBeInTheDocument();
    expect(within(table).queryByRole("columnheader", { name: "Actor" })).not.toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "变更类型" })).toBeInTheDocument();
    expect(within(table).getByRole("columnheader", { name: "文件路径" })).toBeInTheDocument();
    const timeCell = within(table).getAllByRole("cell")[0];
    expect(timeCell).toHaveClass("pl-audit-table-muted");
    expect(screen.getAllByText("本机管理员").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Agent 信息变更").length).toBeGreaterThan(0);
    expect(screen.getByTestId("config-audit-page-range")).toHaveTextContent("1–20 / 共 22 条");
    expect(screen.getByTestId("config-audit-page-index")).toHaveTextContent("1 / 2");

    const firstCallUrl = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(firstCallUrl).toContain("limit=20");
  });

  it("filters change types by asset kind and carries time filters into export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            data: { total: 0, entries: [] }
          })
        )
      )
    );

    renderConfigAudit();
    await screen.findByRole("heading", { name: "配置审计" });

    const changeType = screen.getByTestId("config-audit-change-type");
    expect(within(changeType).getByRole("option", { name: "Agent 信息变更" })).toBeInTheDocument();
    expect(within(changeType).getByRole("option", { name: "表语义保存" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("资产域"), { target: { value: "semantic" } });
    expect(within(screen.getByTestId("config-audit-change-type")).queryByRole("option", { name: "Agent 信息变更" })).not.toBeInTheDocument();
    expect(within(screen.getByTestId("config-audit-change-type")).getByRole("option", { name: "表语义保存" })).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("config-audit-window"), { target: { value: "7d" } });
    const exportLink = screen.getByRole("link", { name: "导出 CSV" });
    expect(exportLink.getAttribute("href")).toContain("since=");
    expect(exportLink.getAttribute("href")).toContain("assetKind=semantic");
  });
});

describe("ConfigAudit Spec 97 header & export parity", () => {
  it("keeps only 导出 CSV in PageHeader actions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, data: { total: 0, entries: [] } }))
      )
    );

    renderConfigAudit();
    await screen.findByRole("heading", { name: "配置审计" });

    expect(screen.getByRole("link", { name: "导出 CSV" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "访问日志" })).not.toBeInTheDocument();
  });
});
