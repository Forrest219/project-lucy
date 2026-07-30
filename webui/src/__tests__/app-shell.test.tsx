// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../app/App";
import { PageHeader } from "../components/PageHeader";

function StubPage({ name }: { name: string }) {
  return <div data-testid="route-page">{name}</div>;
}

vi.mock("../pages/Catalog", () => ({ Catalog: () => <StubPage name="Catalog" /> }));
vi.mock("../pages/JoinEditor", () => ({ JoinEditor: () => <StubPage name="JoinEditor" /> }));
vi.mock("../pages/Onboarding", () => ({ Onboarding: () => <StubPage name="Onboarding" /> }));
vi.mock("../pages/Review", () => ({ Review: () => <StubPage name="Review" /> }));
vi.mock("../pages/TableEditor", () => ({ TableEditor: () => <StubPage name="TableEditor" /> }));
vi.mock("../pages/WikiEditor", () => ({ WikiEditor: () => <StubPage name="WikiEditor" /> }));
vi.mock("../pages/admin/AgentList", () => ({ AgentList: () => <StubPage name="AgentList" /> }));
vi.mock("../pages/admin/AgentDetail", () => ({ AgentDetail: () => <StubPage name="AgentDetail" /> }));
vi.mock("../pages/admin/NewToken", () => ({ NewToken: () => <StubPage name="NewToken" /> }));
vi.mock("../pages/admin/Audit", () => ({ Audit: () => <StubPage name="Audit" /> }));
vi.mock("../pages/admin/RoleList", () => ({ RoleList: () => <StubPage name="RoleList" /> }));
vi.mock("../pages/admin/RoleDetail", () => ({ RoleDetail: () => <StubPage name="RoleDetail" /> }));
vi.mock("../pages/eval/CaseList", () => ({ CaseList: () => <StubPage name="CaseList" /> }));
vi.mock("../pages/eval/CaseEditor", () => ({ CaseEditor: () => <StubPage name="CaseEditor" /> }));
vi.mock("../pages/eval/RunList", () => ({ RunList: () => <StubPage name="RunList" /> }));
vi.mock("../pages/eval/RunDetail", () => ({ RunDetail: () => <StubPage name="RunDetail" /> }));
vi.mock("../pages/eval/Monitor", () => ({ Monitor: () => <StubPage name="Monitor" /> }));
vi.mock("../pages/connections/ConnectionOverview", () => ({ ConnectionOverview: () => <StubPage name="ConnectionOverview" /> }));
vi.mock("../pages/connections/TableWhitelist", () => ({ TableWhitelist: () => <StubPage name="TableWhitelist" /> }));
vi.mock("../pages/connections/ConnectionTest", () => ({ ConnectionTest: () => <StubPage name="ConnectionTest" /> }));
vi.mock("../pages/HelpCenter", () => ({ HelpCenter: () => <StubPage name="HelpCenter" /> }));

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  });
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/project") {
      return new Response(
        JSON.stringify({
          ok: true,
          data: { root: "/tmp/project-lucy", connections: [{ name: "mysql-aliyun" }], ktxAvailable: true }
        })
      );
    }
    if (url === "/api/connections") {
      return new Response(JSON.stringify({ ok: true, data: { connections: [] } }));
    }
    if (url.startsWith("/api/sources/mysql-aliyun/dataforai/superstore_orders")) {
      return new Response(
        JSON.stringify({
          ok: true,
          data: {
            model: {
              conn: "mysql-aliyun",
              schema: "dataforai",
              table: "superstore_orders",
              filePath: "semantic-layer/mysql-aliyun/_schema/dataforai.yaml",
              descriptions: {},
              columns: []
            },
            rawYaml: "",
            completion: "done"
          }
        })
      );
    }
    return new Response(JSON.stringify({ ok: true, data: {} }));
  });
  vi.stubGlobal(
    "fetch",
    fetchMock
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <AppFrame />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchMock };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppFrame shell", () => {
  it.each([
    ["/onboarding", "Onboarding", "系统概览"],
    ["/connections", "ConnectionOverview", "连接概览"],
    ["/connections/whitelist", "TableWhitelist", "表白名单"],
    ["/connections/test", "ConnectionTest", "连通测试"],
    ["/", "Catalog", "表目录"],
    ["/wiki", "WikiEditor", "Wiki 文档"],
    ["/review", "Review", "变更审阅"],
    ["/eval/cases", "CaseList", "Case 管理"],
    ["/eval/runs", "RunList", "运行历史"],
    ["/eval/monitor", "Monitor", "趋势监控"],
    ["/admin/agents", "AgentList", "Agent 实例"],
    ["/admin/audit", "Audit", "访问日志"],
    ["/admin/roles", "RoleList", "角色配置"]
  ])("renders route %s and marks active navigation", (path, pageName, activeLink) => {
    renderAt(path);
    expect(screen.getByTestId("route-page")).toHaveTextContent(pageName);
    expect(screen.getByRole("link", { name: activeLink })).toHaveAttribute("aria-current", "page");
  });

  it("labels onboarding as the runtime system overview area", () => {
    renderAt("/onboarding");
    expect(screen.getByText("Lucy WebUI")).toBeInTheDocument();
    expect(screen.queryByText("KTX WebUI")).not.toBeInTheDocument();
    expect(screen.getByText("运行状态")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "系统概览" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("部署向导")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "上线检查" })).not.toBeInTheDocument();
  });

  it("renders a global help button", () => {
    renderAt("/");
    expect(document.querySelector(".pl-topbar")).not.toBeInTheDocument();

    const sidebarFooter = screen.getByTestId("sidebar-footer");
    const sidebarHelp = within(sidebarFooter).getByRole("link", { name: "打开系统手册" });
    expect(sidebarHelp).toHaveAttribute("href", "/help");
    expect(sidebarHelp).toHaveTextContent("系统手册");
    expect(sidebarFooter).toHaveTextContent("Lucy v1.8 · © 2026");
    expect(within(sidebarFooter).getAllByRole("link")).toHaveLength(1);
    expect(within(sidebarFooter).queryByRole("link", { name: "配置变更" })).not.toBeInTheDocument();
    expect(within(sidebarFooter).queryByRole("navigation")).not.toBeInTheDocument();
    expect(sidebarFooter.querySelector(".pl-nav-section")).not.toBeInTheDocument();
  });

  it("renders the help route", () => {
    renderAt("/help");
    expect(screen.getByTestId("route-page")).toHaveTextContent("HelpCenter");
  });

  it("marks source and join pages as table catalog navigation", () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "表目录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");
  });

  it("exposes density shell classes and active nav styling hook", () => {
    renderAt("/connections");
    expect(document.querySelector(".pl-app-shell")).toBeInTheDocument();
    expect(document.querySelector(".pl-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toHaveClass("pl-nav");
    expect(screen.getByRole("link", { name: "连接概览" })).toHaveClass("pl-nav-link", "pl-nav-link--active");
  });

  it("renders PageHeader with the global H1 styling hook", () => {
    render(
      <MemoryRouter>
        <PageHeader title="连接概览" breadcrumbs={["数据库接入"]} />
      </MemoryRouter>
    );
    expect(screen.getByRole("heading", { level: 1, name: "连接概览" })).toHaveClass("pl-page-header-title");
    expect(screen.getByTestId("page-header")).toHaveClass("pl-page-header");
    expect(screen.queryByRole("link", { name: "打开系统手册" })).not.toBeInTheDocument();
  });

  it("marks admin agent context pages as agent navigation", () => {
    renderAt("/admin/agents/zhangsan/tokens/new");
    expect(screen.getByRole("link", { name: "Agent 实例" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("NewToken");
  });
});
