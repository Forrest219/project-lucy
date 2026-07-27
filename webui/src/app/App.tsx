import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
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
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { ProjectInfo, SourceDetail } from "../lib/types";

const queryClient = new QueryClient();

export function breadcrumbItems(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return ["语义层维护", "表目录"];
  }
  if (parts[0] === "onboarding") {
    return ["部署向导", "上线检查"];
  }
  if (parts[0] === "sources") {
    return ["语义层维护", parts[2] ?? "表语义", parts[3] ?? "表语义"];
  }
  if (parts[0] === "joins") {
    return ["语义层维护", "关联关系", parts[3] ?? "当前表"];
  }
  if (parts[0] === "wiki") {
    return ["业务文档", "Wiki 文档"];
  }
  if (parts[0] === "review") {
    return ["审阅与校验", "变更审阅"];
  }
  if (parts[0] === "eval") {
    if (parts[1] === "cases" && parts[2] && parts[3]) {
      return ["质量评测", "Case 管理", parts[2], parts[3]];
    }
    if (parts[1] === "cases" && parts[2]) {
      return ["质量评测", "Case 管理", parts[2]];
    }
    if (parts[1] === "cases") {
      return ["质量评测", "Case 管理"];
    }
    if (parts[1] === "runs" && parts[2]) {
      return ["质量评测", "运行历史", `Run #${parts[2]}`];
    }
    if (parts[1] === "runs") {
      return ["质量评测", "运行历史"];
    }
    if (parts[1] === "monitor") {
      return ["质量评测", "趋势监控"];
    }
    return ["质量评测"];
  }
  if (parts[0] === "connections") {
    if (parts[1] === "whitelist") {
      return ["数据库接入", "表白名单"];
    }
    if (parts[1] === "test") {
      return ["数据库接入", "连通测试"];
    }
    return ["数据库接入", "连接概览"];
  }
  if (parts[0] === "admin") {
    if (parts[1] === "agents" && parts[2] && parts[3] === "tokens") {
      return ["访问治理", "Agent 实例", parts[2], "新建 Token"];
    }
    if (parts[1] === "agents" && parts[2]) {
      return ["访问治理", "Agent 实例", parts[2]];
    }
    if (parts[1] === "agents") {
      return ["访问治理", "Agent 实例"];
    }
    if (parts[1] === "roles" && parts[2] === "new") {
      return ["访问治理", "角色配置", "新建 Role"];
    }
    if (parts[1] === "roles" && parts[2]) {
      return ["访问治理", "角色配置", parts[2]];
    }
    if (parts[1] === "roles") {
      return ["访问治理", "角色配置"];
    }
    if (parts[1] === "audit") {
      return ["访问治理", "访问日志"];
    }
    if (parts[1] === "config-audit") {
      return ["访问治理", "配置变更日志"];
    }
    if (parts[1] === "audit-sources") {
      return ["访问治理", "数据源热力视图"];
    }
    return ["访问治理"];
  }
  return ["KTX WebUI"];
}

type NavItem = { label: string; to: string; active: (pathname: string) => boolean };

const navGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "部署向导",
    items: [{ label: "上线检查", to: "/onboarding", active: (path) => path === "/onboarding" }]
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

function routeSource(pathname: string): { conn: string; schema: string; table: string } | null {
  const match = pathname.match(/^\/sources\/([^/]+)\/([^/]+)\/([^/]+)/);
  if (!match) {
    return null;
  }
  return {
    conn: decodeURIComponent(match[1]),
    schema: decodeURIComponent(match[2]),
    table: decodeURIComponent(match[3])
  };
}

export function AppFrame() {
  const location = useLocation();
  const breadcrumbs = breadcrumbItems(location.pathname);
  const pageTitle = breadcrumbs[breadcrumbs.length - 1] ?? "KTX WebUI";
  const isConnectionRoute = location.pathname.startsWith("/connections");
  const currentSource = routeSource(location.pathname);
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project"),
    enabled: isConnectionRoute
  });
  const topbarSourceQuery = useQuery({
    queryKey: currentSource ? queryKeys.source(currentSource.conn, currentSource.schema, currentSource.table) : ["sources", "inactive"],
    queryFn: () =>
      apiGet<SourceDetail>(
        `/api/sources/${encodeURIComponent(currentSource?.conn ?? "")}/${encodeURIComponent(currentSource?.schema ?? "")}/${encodeURIComponent(currentSource?.table ?? "")}`
    ),
    enabled: Boolean(currentSource)
  });
  const topbarSourceData =
    currentSource &&
    topbarSourceQuery.data?.model.conn === currentSource.conn &&
    topbarSourceQuery.data.model.schema === currentSource.schema &&
    topbarSourceQuery.data.model.table === currentSource.table
      ? topbarSourceQuery.data
      : null;
  const topbarFacts = [
    isConnectionRoute && projectQuery.data?.root ? projectQuery.data.root : null,
    isConnectionRoute && projectQuery.data ? `${projectQuery.data.connections.length} 个连接` : null,
    isConnectionRoute && projectQuery.data ? `KTX ${projectQuery.data.ktxAvailable ? "可用" : "不可用"}` : null,
    currentSource ? currentSource.conn : null,
    currentSource ? currentSource.schema : null,
    topbarSourceData ? `完成度 ${topbarSourceData.completion}` : null
  ].filter(Boolean);

  return (
    <div className="pl-app-shell">
      <aside className="pl-sidebar">
        <div className="pl-brand-block">
          <strong>KTX WebUI</strong>
          <span>语义维护工作台</span>
        </div>

        <nav className="grid gap-4" aria-label="主导航">
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
      </aside>

      <main className="pl-workspace">
        <header className="pl-topbar">
          <div>
            <nav className="flex items-center gap-2 text-sm text-fg-muted" aria-label="当前位置">
              {breadcrumbs.map((item, index) => (
                <span key={`${index}-${item}`} className="flex items-center gap-2">
                  {index > 0 ? <span>/</span> : null}
                  <span>{item}</span>
                </span>
              ))}
            </nav>
            <div className="pl-topbar-title">{pageTitle}</div>
            {topbarFacts.length > 0 ? (
              <div className="pl-topbar-facts" aria-label="页面上下文">
                {topbarFacts.map((fact) => (
                  <span key={fact}>{fact}</span>
                ))}
              </div>
            ) : null}
          </div>
        </header>
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
