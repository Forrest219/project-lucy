// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppFrame } from "../app/App";
import { PageHeader } from "../components/PageHeader";
import { assertNoForbiddenTerms } from "./forbidden-terms";

function StubPage({ name }: { name: string }) {
  return <div data-testid="route-page">{name}</div>;
}

// M39 review follow-up (P1): when `/onboarding` redirects to `/overview`, the
// canonical route must keep the incoming `search` and `hash` so legacy
// bookmarks like `/onboarding?object=table&conn=...` continue to open the
// ObjectDetailDrawer after the redirect. The mock captures the post-redirect
// location via a side-channel so individual tests can assert against it.
let lastOnboardingLocation: { pathname: string; search: string; hash: string } | null = null;
let lastTableEditorLocation: { pathname: string; search: string; hash: string } | null = null;

vi.mock("../pages/Catalog", () => ({ Catalog: () => <StubPage name="Catalog" /> }));
vi.mock("../pages/JoinEditor", () => ({ JoinEditor: () => <StubPage name="JoinEditor" /> }));
vi.mock("../pages/Onboarding", async () => {
  const { useLocation } = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    Onboarding: () => {
      const loc = useLocation();
      lastOnboardingLocation = { pathname: loc.pathname, search: loc.search, hash: loc.hash };
      return <div data-testid="route-page">Onboarding</div>;
    }
  };
});
vi.mock("../pages/publish/PublishWorkbench", () => ({ PublishWorkbench: () => <StubPage name="PublishWorkbench" /> }));
vi.mock("../pages/publish/PublishHistory", () => ({ PublishHistory: () => <StubPage name="PublishHistory" /> }));
vi.mock("../pages/TableEditor", async () => {
  const { useLocation } = await vi.importActual<typeof import("react-router-dom")>(
    "react-router-dom"
  );
  return {
    TableEditor: () => {
      const loc = useLocation();
      lastTableEditorLocation = { pathname: loc.pathname, search: loc.search, hash: loc.hash };
      return <div data-testid="route-page">TableEditor</div>;
    }
  };
});
vi.mock("../pages/WikiEditor", () => ({ WikiEditor: () => <StubPage name="WikiEditor" /> }));
vi.mock("../pages/admin/AgentList", () => ({ AgentList: () => <StubPage name="AgentList" /> }));
vi.mock("../pages/admin/AgentDetail", () => ({ AgentDetail: () => <StubPage name="AgentDetail" /> }));
vi.mock("../pages/admin/NewToken", () => ({ NewToken: () => <StubPage name="NewToken" /> }));
vi.mock("../pages/admin/Audit", () => ({ Audit: () => <StubPage name="Audit" /> }));
vi.mock("../pages/admin/AuditSources", () => ({ AuditSources: () => <StubPage name="AuditSources" /> }));
vi.mock("../pages/admin/ConfigAudit", () => ({ ConfigAudit: () => <StubPage name="ConfigAudit" /> }));
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
  lastOnboardingLocation = null;
  lastTableEditorLocation = null;
});

describe("AppFrame shell", () => {
  it.each([
    ["/overview", "Onboarding", "系统概览"],
    ["/connections", "ConnectionOverview", "连接概览"],
    ["/connections/enabled-tables", "TableWhitelist", "启用表范围"],
    ["/", "Catalog", "表目录"],
    ["/catalog", "Catalog", "表目录"],
    ["/publish/workbench", "PublishWorkbench", "发布工作台"],
    ["/publish/history", "PublishHistory", "发布记录"],
    ["/eval/cases", "CaseList", "评测用例"],
    ["/eval/runs", "RunList", "运行历史"],
    ["/eval/monitor", "Monitor", "趋势监控"],
    ["/admin/agents", "AgentList", "Agent 实例"],
    ["/admin/audit", "Audit", "访问日志"],
    ["/admin/audit?tab=heatmap", "Audit", "访问日志"],
    ["/admin/roles", "RoleList", "角色权限"],
    ["/admin/config-audit", "ConfigAudit", "配置审计"]
  ])("renders route %s and marks active navigation", (path, pageName, activeLink) => {
    renderAt(path);
    expect(screen.getByTestId("route-page")).toHaveTextContent(pageName);
    expect(screen.getByRole("link", { name: activeLink })).toHaveAttribute("aria-current", "page");
  });

  it("keeps /connections/whitelist as a compatibility alias for enabled table scope", () => {
    renderAt("/connections/whitelist?schema=dataforai");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableWhitelist");
    expect(screen.getByRole("link", { name: "启用表范围" })).toHaveAttribute("aria-current", "page");
  });

  it("uses a dedicated Wiki shell without the global navigation", () => {
    renderAt("/wiki");

    expect(screen.getByTestId("route-page")).toHaveTextContent("WikiEditor");
    expect(document.querySelector(".pl-app-shell")).toHaveClass("pl-app-shell--wiki");
    expect(document.querySelector(".pl-sidebar")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "表目录" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "业务 Wiki" })).not.toBeInTheDocument();
  });

  it("keeps /connections/test as a compat alias route with no sidebar entry", () => {
    // v1.9.0: 连通测试（兼容）已从主导航移除，但 /connections/test 仍需可访问，
    // 承接外链/历史书签。连接卡内测试 Drawer（M25）是当前正式入口。
    renderAt("/connections/test");
    expect(screen.getByTestId("route-page")).toHaveTextContent("ConnectionTest");
    expect(screen.queryByRole("link", { name: /连通测试/ })).not.toBeInTheDocument();
  });

  it("treats /overview as the canonical system overview route and keeps /onboarding as a redirect", () => {
    renderAt("/overview");
    expect(screen.getByTestId("route-page")).toHaveTextContent("Onboarding");
    const overviewLink = screen.getByRole("link", { name: "系统概览" });
    expect(overviewLink).toHaveAttribute("href", "/overview");
    expect(overviewLink).toHaveAttribute("aria-current", "page");
  });

  it("redirects /onboarding to /overview and renders the system overview page", () => {
    renderAt("/onboarding");
    // MemoryRouter issues a history.replace("/overview") so the final render
    // must show the Onboarding stub. The sidebar link "系统概览" remains
    // active because the canonical predicate is now keyed on /overview.
    expect(screen.getByTestId("route-page")).toHaveTextContent("Onboarding");
    const overviewLink = screen.getByRole("link", { name: "系统概览" });
    expect(overviewLink).toHaveAttribute("href", "/overview");
    expect(overviewLink).toHaveAttribute("aria-current", "page");
  });

  it("preserves search and hash when redirecting /onboarding to /overview", () => {
    // Legacy bookmark from M36 / pre-M39 — must still resolve to /overview
    // with the same query so ObjectDetailDrawer can open the right object.
    renderAt("/onboarding?object=table&conn=mysql-aliyun&schema=dataforai&table=orders#section-1");
    expect(screen.getByTestId("route-page")).toHaveTextContent("Onboarding");
    // The post-redirect location must be /overview with the original
    // `search` and `hash` intact. A naive `<Navigate to="/overview" />`
    // would silently drop both.
    expect(lastOnboardingLocation?.pathname).toBe("/overview");
    expect(lastOnboardingLocation?.search).toContain("object=table");
    expect(lastOnboardingLocation?.search).toContain("conn=mysql-aliyun");
    expect(lastOnboardingLocation?.hash).toBe("#section-1");
  });

  it("redirects / to the canonical /catalog route and marks 表目录 active", () => {
    renderAt("/");
    expect(screen.getByTestId("route-page")).toHaveTextContent("Catalog");
    const catalogLink = screen.getByRole("link", { name: "表目录" });
    expect(catalogLink).toHaveAttribute("href", "/catalog");
    expect(catalogLink).toHaveAttribute("aria-current", "page");
  });

  it("redirects legacy /sources table URLs to the canonical /catalog table route", () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders?tab=diff#preview");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");
    expect(lastTableEditorLocation).toEqual({
      pathname: "/catalog/mysql-aliyun/dataforai/superstore_orders",
      search: "?tab=diff",
      hash: "#preview"
    });
    expect(screen.getByRole("link", { name: "表目录" })).toHaveAttribute("aria-current", "page");
  });

  it("exposes each 5+1 navigation group heading exactly once", () => {
    renderAt("/overview");
    const groupTitles = ["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"];
    for (const title of groupTitles) {
      expect(screen.getAllByRole("heading", { name: title })).toHaveLength(1);
    }
  });

  it("does not render any nav section inside the sidebar footer", () => {
    renderAt("/overview");
    const sidebarFooter = screen.getByTestId("sidebar-footer");
    expect(sidebarFooter.querySelectorAll(".pl-nav-section")).toHaveLength(0);
    // The footer must still carry the help link — guards against an accidental
    // re-introduction of the full nav into the footer.
    expect(within(sidebarFooter).getByRole("link", { name: "打开系统手册" })).toHaveAttribute("href", "/help");
  });

  it("labels the system overview entry as the runtime control plane", () => {
    renderAt("/overview");
    expect(screen.getByText("Lucy WebUI")).toBeInTheDocument();
    expect(screen.queryByText("KTX WebUI")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运行状态" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "系统概览" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("部署向导")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "上线检查" })).not.toBeInTheDocument();
  });

  it("renders only the Chinese brand tagline (no English duplicate) in the brand block", () => {
    // v1.9.x 收口：英文 Subtitle 'Data Agent Ops Control Plane' 已移除，避免与
    // 中文 tagline 重复；240px 侧栏宽度下保证不截断、不折行。
    renderAt("/overview");
    expect(
      screen.getByText("Data Agent 运维控制台"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Data Agent Ops Control Plane"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("语义维护工作台"),
    ).not.toBeInTheDocument();
  });

  it("renders the M34 5+1 lifecycle sidebar shape with renamed second-level items", () => {
    renderAt("/");

    const groups = ["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"];
    for (const group of groups) {
      expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
    }

    const overviewLink = screen.getByRole("link", { name: "系统概览" });
    expect(overviewLink).toBeInTheDocument();
    expect(overviewLink.closest(".pl-nav-section")?.querySelector(".pl-nav-section-title")).toBeNull();

    for (const title of ["运行状态", "语义层维护", "业务文档", "数据库接入"]) {
      expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
    }

    for (const label of ["启用表范围", "业务 Wiki", "评测用例", "角色权限", "配置审计"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }

    // M35: 数据热力已下沉为 /admin/audit?tab=heatmap 内的 Tab，不再作为侧边栏二级项。
    expect(screen.queryByRole("link", { name: "数据热力" })).not.toBeInTheDocument();

    // v1.9.0: 连通测试（兼容）从主导航移除，连接卡内测试 Drawer（M25）成为唯一入口。
    expect(screen.queryByRole("link", { name: /连通测试/ })).not.toBeInTheDocument();

    for (const label of ["表白名单", "Wiki 文档", "Case 管理", "角色配置", "数据源热力"]) {
      expect(screen.queryByRole("link", { name: new RegExp(`^${label}$`) })).not.toBeInTheDocument();
    }
  });

  it("exposes the semantic-publish module with only workbench + history in the sidebar", () => {
    renderAt("/publish/workbench");
    expect(screen.getByText("语义发布")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "发布工作台" })).toHaveAttribute("href", "/publish/workbench");
    expect(screen.getByRole("link", { name: "发布记录" })).toHaveAttribute("href", "/publish/history");
    expect(screen.queryByText("审阅与校验")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "变更审阅" })).not.toBeInTheDocument();
    // No second-level item such as `待发布变更`, `索引生效`, or `资产包` is allowed.
    expect(screen.queryByRole("link", { name: "待发布变更" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "索引生效" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "资产包" })).not.toBeInTheDocument();
  });

  it("redirects the legacy /review route to the publish workbench", () => {
    renderAt("/review");
    expect(screen.getByTestId("route-page")).toHaveTextContent("PublishWorkbench");
    expect(screen.getByRole("link", { name: "发布工作台" })).toHaveAttribute("aria-current", "page");
  });

  it("renders a global help button", () => {
    renderAt("/");
    expect(document.querySelector(".pl-topbar")).not.toBeInTheDocument();

    const sidebarFooter = screen.getByTestId("sidebar-footer");
    const sidebarHelp = within(sidebarFooter).getByRole("link", { name: "打开系统手册" });
    expect(sidebarHelp).toHaveAttribute("href", "/help");
    expect(sidebarHelp).toHaveTextContent("系统手册");
    expect(within(sidebarFooter).getAllByRole("link")).toHaveLength(1);
    expect(within(sidebarFooter).queryByRole("link", { name: "配置变更" })).not.toBeInTheDocument();
    expect(within(sidebarFooter).queryByRole("navigation")).not.toBeInTheDocument();
    expect(sidebarFooter.querySelector(".pl-nav-section")).not.toBeInTheDocument();
  });

  it("renders the help route", () => {
    renderAt("/help");
    expect(screen.getByTestId("route-page")).toHaveTextContent("HelpCenter");
    expect(document.querySelector(".pl-app-shell")).toHaveClass("pl-app-shell--help");
  });

  it("marks source and join pages as table catalog navigation", () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "表目录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");

    cleanup();
    renderAt("/catalog/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "表目录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");
  });

  it("exposes density shell classes and active nav styling hook", () => {
    renderAt("/connections");
    expect(document.querySelector(".pl-app-shell")).toBeInTheDocument();
    expect(document.querySelector(".pl-app-shell")).not.toHaveClass("pl-app-shell--help");
    expect(document.querySelector(".pl-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toHaveClass("pl-nav");
    expect(screen.getByRole("link", { name: "连接概览" })).toHaveClass("pl-nav-link", "pl-nav-link--active");
  });

  it("renders PageHeader with the global H1 styling hook", () => {
    render(
      <MemoryRouter>
        <PageHeader title="连接概览" breadcrumbs={["数据接入"]} />
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

  it("removes the compat 连通测试 sidebar entry while keeping no machine-translation artifacts", () => {
    // v1.9.0: 连通测试（兼容）已从主导航移除；/connections/test 路由继续保留为兼容页。
    renderAt("/connections");
    expect(screen.queryByRole("link", { name: "连通测试（兼容）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "替代测试" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "添加架构" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "上传报价包" })).not.toBeInTheDocument();
    assertNoForbiddenTerms(document.body);
  });
});
