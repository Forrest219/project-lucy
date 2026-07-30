import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { Catalog } from "../pages/Catalog";
import { JoinEditor } from "../pages/JoinEditor";
import { Onboarding } from "../pages/Onboarding";
import { Review } from "../pages/Review";
import { TableEditor } from "../pages/TableEditor";
import { WikiEditor } from "../pages/WikiEditor";
import { AgentList } from "../pages/admin/AgentList";
import { AgentDetail } from "../pages/admin/AgentDetail";
import { NewToken } from "../pages/admin/NewToken";
import { Audit } from "../pages/admin/Audit";
import { ConfigAudit } from "../pages/admin/ConfigAudit";
import { AuditSources } from "../pages/admin/AuditSources";
import { RoleList } from "../pages/admin/RoleList";
import { RoleDetail } from "../pages/admin/RoleDetail";
import { CaseList } from "../pages/eval/CaseList";
import { CaseEditor } from "../pages/eval/CaseEditor";
import { RunList } from "../pages/eval/RunList";
import { RunDetail } from "../pages/eval/RunDetail";
import { Monitor } from "../pages/eval/Monitor";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import { ConnectionTest } from "../pages/connections/ConnectionTest";
import { HelpCenter } from "../pages/HelpCenter";
import { HelpButton } from "../components/HelpButton";

const queryClient = new QueryClient();

type NavItem = { label: string; to: string; active: (pathname: string) => boolean };

const navGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "运行状态",
    items: [{ label: "系统概览", to: "/onboarding", active: (path) => path === "/onboarding" }]
  },
  {
    title: "数据库接入",
    items: [
      { label: "连接概览", to: "/connections", active: (path) => path === "/connections" },
      { label: "表白名单", to: "/connections/whitelist", active: (path) => path === "/connections/whitelist" },
      { label: "连通测试", to: "/connections/test", active: (path) => path === "/connections/test" }
    ]
  },
  {
    title: "语义层维护",
    items: [
      {
        label: "表目录",
        to: "/",
        active: (path) => path === "/" || path.startsWith("/sources/") || path.startsWith("/joins/")
      }
    ]
  },
  {
    title: "业务文档",
    items: [{ label: "Wiki 文档", to: "/wiki", active: (path) => path === "/wiki" }]
  },
  {
    title: "审阅与校验",
    items: [{ label: "变更审阅", to: "/review", active: (path) => path === "/review" }]
  },
  {
    title: "质量评测",
    items: [
      { label: "Case 管理", to: "/eval/cases", active: (path) => path.startsWith("/eval/cases") },
      { label: "运行历史", to: "/eval/runs", active: (path) => path.startsWith("/eval/runs") },
      { label: "趋势监控", to: "/eval/monitor", active: (path) => path === "/eval/monitor" }
    ]
  },
  {
    title: "访问治理",
    items: [
      { label: "Agent 实例", to: "/admin/agents", active: (path) => path.startsWith("/admin/agents") },
      { label: "角色配置", to: "/admin/roles", active: (path) => path.startsWith("/admin/roles") },
      { label: "访问日志", to: "/admin/audit", active: (path) => path === "/admin/audit" },
      { label: "数据源热力", to: "/admin/audit-sources", active: (path) => path === "/admin/audit-sources" },
      { label: "配置变更", to: "/admin/config-audit", active: (path) => path === "/admin/config-audit" }
    ]
  }
];

function navLinkClass(isActive: boolean) {
  return `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`;
}

export function AppFrame() {
  const location = useLocation();

  return (
    <div className="pl-app-shell">
      <aside className="pl-sidebar">
        <div className="pl-brand-block">
          <strong>Lucy WebUI</strong>
          <span>语义维护工作台</span>
        </div>

        <nav className="pl-nav" aria-label="主导航">
          {navGroups.map((group) => (
            <section className="pl-nav-section" key={group.title}>
              <h2 className="pl-nav-section-title">{group.title}</h2>
              <div className="grid gap-1">
                {group.items.map((item) => {
                  const active = item.active(location.pathname);
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={navLinkClass(active)}
                      key={item.to}
                      to={item.to}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>
        <div className="pl-sidebar-footer" data-testid="sidebar-footer">
          <div className="pl-sidebar-utility" data-testid="sidebar-utility">
            <HelpButton className="pl-sidebar-help-link">
              <span aria-hidden="true">?</span>
              <span>系统手册</span>
            </HelpButton>
          </div>
          <div className="pl-sidebar-version">Lucy v1.8 · © 2026</div>
        </div>
      </aside>

      <main className="pl-workspace">
        <div className="pl-workspace-body">
          <Routes>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/connections" element={<ConnectionOverview />} />
            <Route path="/connections/whitelist" element={<TableWhitelist />} />
            <Route path="/connections/test" element={<ConnectionTest />} />
            <Route path="/" element={<Catalog />} />
            <Route path="/sources/:conn/:schema/:table" element={<TableEditor />} />
            <Route path="/joins/:conn/:schema/:table" element={<JoinEditor />} />
            <Route path="/review" element={<Review />} />
            <Route path="/wiki" element={<WikiEditor />} />
            <Route path="/admin/agents" element={<AgentList />} />
            <Route path="/admin/agents/:userId" element={<AgentDetail />} />
            <Route path="/admin/agents/:userId/tokens/new" element={<NewToken />} />
            <Route path="/admin/roles" element={<RoleList />} />
            <Route path="/admin/roles/new" element={<RoleDetail mode="create" />} />
            <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
            <Route path="/admin/audit" element={<Audit />} />
            <Route path="/admin/audit-sources" element={<AuditSources />} />
            <Route path="/admin/config-audit" element={<ConfigAudit />} />
            <Route path="/eval/cases" element={<CaseList />} />
            <Route path="/eval/cases/:domain" element={<CaseList />} />
            <Route path="/eval/cases/:domain/new" element={<CaseEditor />} />
            <Route path="/eval/cases/:domain/:caseId" element={<CaseEditor />} />
            <Route path="/eval/runs" element={<RunList />} />
            <Route path="/eval/runs/:runId" element={<RunDetail />} />
            <Route path="/eval/monitor" element={<Monitor />} />
            <Route path="/help" element={<HelpCenter />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppFrame />
        <Toaster richColors position="top-right" />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
