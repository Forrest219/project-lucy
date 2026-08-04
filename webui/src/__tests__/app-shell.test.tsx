// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  window.localStorage.clear();
  lastOnboardingLocation = null;
  lastTableEditorLocation = null;
});

beforeEach(() => {
  // M60: each test starts from a clean collapsible-state localStorage so a
  // stray value from a previous test never leaks into the auto-expand logic.
  window.localStorage.clear();
});

describe("AppFrame shell", () => {
  it.each([
    ["/overview", "Onboarding", "系统概览"],
    ["/connections", "ConnectionOverview", "连接概览"],
    ["/connections/enabled-tables", "TableWhitelist", "启用表范围"],
    ["/", "Catalog", "语义资产"],
    ["/catalog", "Catalog", "语义资产"],
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

  it("keeps global navigation visible on the Wiki route", () => {
    renderAt("/wiki");

    expect(screen.getByTestId("route-page")).toHaveTextContent("WikiEditor");
    expect(document.querySelector(".pl-app-shell")).not.toHaveClass("pl-app-shell--wiki");
    expect(document.querySelector(".pl-sidebar")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "语义资产" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "业务 Wiki" })).toHaveAttribute("aria-current", "page");
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

  it("redirects / to the canonical /catalog route and marks 语义资产 active", () => {
    renderAt("/");
    expect(screen.getByTestId("route-page")).toHaveTextContent("Catalog");
    const catalogLink = screen.getByRole("link", { name: "语义资产" });
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
    expect(screen.getByRole("link", { name: "语义资产" })).toHaveAttribute("aria-current", "page");
  });

  it("exposes each 5+1 navigation group heading exactly once", () => {
    // M60 Sidebar Brand Navigation Polish: group titles are now collapsible
    // <button>s with `aria-expanded`, not <h2>s. There must still be one
    // titled button per group so the sidebar reads as 5 sections.
    renderAt("/overview");
    const groupTitles = ["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"];
    for (const title of groupTitles) {
      expect(screen.getAllByRole("button", { name: title })).toHaveLength(1);
    }
    // Guard against the heading flavor silently coming back.
    for (const title of groupTitles) {
      expect(screen.queryByRole("heading", { name: title })).not.toBeInTheDocument();
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
    // M61: brand block is now a Link to /overview with copy
    // `Lucy WebUI` + `Data Agent 运维控制台`. Bare `Lucy` (the M60 wordmark)
    // and the legacy `Lucy WebUI` Product-Placement rewrite must not
    // silently come back, and the KTX brand must stay banned.
    renderAt("/overview");
    expect(screen.getByText("Lucy WebUI")).toBeInTheDocument();
    expect(screen.getByText("Data Agent 运维控制台")).toBeInTheDocument();
    expect(screen.queryByText("KTX WebUI")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "运行状态" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "系统概览" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByText("部署向导")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "上线检查" })).not.toBeInTheDocument();
  });

  it("makes the brand block a clickable link back to /overview", () => {
    // M61 Brand Link: clicking the logo/title anywhere on the brand block
    // must navigate back to /overview. The accessible name is the explicit
    // `返回系统概览` so screen-reader users get a single, meaningful label
    // regardless of the logo mark glyph.
    renderAt("/connections");
    const brandLink = screen.getByRole("link", { name: "返回系统概览" });
    expect(brandLink).toHaveAttribute("href", "/overview");
    // The visible brand copy must live INSIDE this same link so a single
    // click on either the mark or the wordmark navigates.
    const brandBlock = screen.getByTestId("sidebar-brand");
    expect(brandBlock).toBe(brandLink);
    expect(within(brandLink).getByText("Lucy WebUI")).toBeInTheDocument();
    expect(within(brandLink).getByText("Data Agent 运维控制台")).toBeInTheDocument();
  });

  it("does not expose the decorative logo glyph in the brand link's accessible name", () => {
    // M61: aria-label is the single source of truth for the brand link so
    // screen readers don't read `L · Lucy WebUI Data Agent 运维控制台`.
    renderAt("/overview");
    const brandLink = screen.getByRole("link", { name: "返回系统概览" });
    expect(brandLink).not.toHaveAccessibleName(/^L\s/);
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

    // M60: group titles are buttons, not headings.
    const groups = ["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"];
    for (const group of groups) {
      expect(screen.getByRole("button", { name: group })).toBeInTheDocument();
    }

    const overviewLink = screen.getByRole("link", { name: "系统概览" });
    expect(overviewLink).toBeInTheDocument();
    // 系统概览 is a sibling link inside the top section, not wrapped by a
    // nav-section-title element (that class only exists for the group
    // button variant now).
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

  it("marks source and join pages as semantic asset navigation", () => {
    renderAt("/sources/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "语义资产" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("route-page")).toHaveTextContent("TableEditor");

    cleanup();
    renderAt("/catalog/mysql-aliyun/dataforai/superstore_orders");
    expect(screen.getByRole("link", { name: "语义资产" })).toHaveAttribute("aria-current", "page");
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

  describe("M60 sidebar brand + navigation polish", () => {
    it("renders the sidebar search / command entry with the ⌘ K shortcut hint", () => {
      renderAt("/overview");
      const trigger = screen.getByTestId("sidebar-search-trigger");
      expect(trigger).toHaveAttribute("aria-label", expect.stringContaining("命令面板"));
      expect(trigger).toHaveTextContent("搜索页面和导航入口");
      expect(trigger).toHaveTextContent("⌘ K");
    });

    it("auto-expands the sidebar group that owns the current route", () => {
      renderAt("/admin/agents");
      const group = screen.getByTestId("nav-group-governance");
      expect(group).toHaveAttribute("data-open", "true");
      expect(screen.getByRole("button", { name: "访问治理" })).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: "Agent 实例" })).toBeVisible();
    });

    it("hides a group's children when the user collapses it and restores them on toggle", () => {
      renderAt("/overview");
      const toggle = screen.getByTestId("nav-group-toggle-publish");
      const group = screen.getByTestId("nav-group-publish");

      // Starts open because no route belongs to the publish group.
      expect(group).toHaveAttribute("data-open", "true");
      expect(toggle).toHaveAttribute("aria-expanded", "true");

      fireEvent.click(toggle);
      expect(group).toHaveAttribute("data-open", "false");
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByTestId("nav-group-items-publish")).not.toBeVisible();

      fireEvent.click(toggle);
      expect(group).toHaveAttribute("data-open", "true");
      expect(toggle).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("link", { name: "发布工作台" })).toBeVisible();
    });

    it("persists collapsed group state across mounts in a versioned localStorage key", () => {
      renderAt("/overview");
      fireEvent.click(screen.getByTestId("nav-group-toggle-publish"));
      expect(window.localStorage.getItem("lucy.sidebar.collapsedGroups.v1")).toContain("publish");

      cleanup();

      // Re-mount on an unrelated route — the publish group must remain
      // collapsed because the user previously chose to hide it.
      renderAt("/connections");
      expect(screen.getByTestId("nav-group-publish")).toHaveAttribute("data-open", "false");
    });

    it("re-expands a collapsed group when the user navigates to a route inside it", () => {
      renderAt("/overview");
      fireEvent.click(screen.getByTestId("nav-group-toggle-evaluation"));
      expect(screen.getByTestId("nav-group-evaluation")).toHaveAttribute("data-open", "false");

      cleanup();
      renderAt("/eval/cases");
      const evaluationGroup = screen.getByTestId("nav-group-evaluation");
      expect(evaluationGroup).toHaveAttribute("data-open", "true");
      expect(screen.getByRole("link", { name: "评测用例" })).toBeVisible();
    });

    it("keeps the active nav-link styling hook even after the brand polish", () => {
      renderAt("/connections");
      const link = screen.getByRole("link", { name: "连接概览" });
      expect(link).toHaveClass("pl-nav-link", "pl-nav-link--active");
      expect(link).toHaveAttribute("aria-current", "page");
    });

    it("keeps second-level navigation on a dedicated inset rail", () => {
      renderAt("/connections");
      const groupItems = screen.getByTestId("nav-group-items-connections");
      const childLink = screen.getByRole("link", { name: "连接概览" });
      const topLink = screen.getByRole("link", { name: "系统概览" });

      expect(groupItems).toHaveClass("pl-nav-group-items");
      expect(childLink).toHaveClass("pl-nav-link", "pl-nav-link--child", "pl-nav-link--active");
      expect(topLink).toHaveClass("pl-nav-link");
      expect(topLink).not.toHaveClass("pl-nav-link--child");
    });

    it("does not break the 系统手册 footer entry after the sidebar rewrite", () => {
      renderAt("/overview");
      const footer = screen.getByTestId("sidebar-footer");
      const helpLink = within(footer).getByRole("link", { name: "打开系统手册" });
      expect(helpLink).toHaveAttribute("href", "/help");
      expect(helpLink).toHaveTextContent("系统手册");
    });
  });

  describe("M65 brand block right-edge alignment", () => {
    it("renders the brand title and tagline inside a single 152px flex column", () => {
      // M65 Brand Alignment: the brand text container is now `flex flex-col
      // items-end` (not `grid`) so `Lucy WebUI` and `Data Agent 运维控制台`
      // share the right edge inside the same 152px column. The tagline must
      // not silently truncate via `text-overflow: ellipsis` — its class
      // should not carry the legacy single-line clamp markers.
      renderAt("/overview");

      const brandLink = screen.getByRole("link", { name: "返回系统概览" });
      const brandText = brandLink.querySelector(".pl-brand-text");
      expect(brandText).not.toBeNull();
      expect(brandText).toHaveClass("pl-brand-text");
      // jsdom only knows className tokens; we assert against the literal
      // Tailwind tokens we expect, not the compiled CSS.
      expect(brandText?.className ?? "").toContain("flex");
      expect(brandText?.className ?? "").toContain("flex-col");
      expect(brandText?.className ?? "").toContain("items-end");

      const title = screen.getByTestId("brand-title");
      const tagline = screen.getByTestId("brand-tagline");
      expect(title).toHaveTextContent("Lucy WebUI");
      expect(tagline).toHaveTextContent("Data Agent 运维控制台");

      // The legacy ellipse clamps lived inline on `.pl-brand-block
      // .pl-brand-tagline`; the M65 CSS dropped them, so the helper class
      // list on the tagline span must NOT include `truncate`.
      expect(tagline.className).not.toContain("truncate");
    });
  });
});
