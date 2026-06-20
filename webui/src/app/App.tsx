import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { Catalog } from "../pages/Catalog";
import { JoinEditor } from "../pages/JoinEditor";
import { Review } from "../pages/Review";
import { TableEditor } from "../pages/TableEditor";
import { WikiEditor } from "../pages/WikiEditor";
import { AgentList } from "../pages/admin/AgentList";
import { AgentDetail } from "../pages/admin/AgentDetail";
import { NewToken } from "../pages/admin/NewToken";
import { Audit } from "../pages/admin/Audit";
import { CaseList } from "../pages/eval/CaseList";
import { CaseEditor } from "../pages/eval/CaseEditor";
import { RunList } from "../pages/eval/RunList";
import { RunDetail } from "../pages/eval/RunDetail";
import { Monitor } from "../pages/eval/Monitor";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import { ConnectionTest } from "../pages/connections/ConnectionTest";

const queryClient = new QueryClient();

function breadcrumbItems(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length === 0) {
    return ["语义层维护", "表目录"];
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
    if (parts[1] === "audit") {
      return ["访问治理", "访问日志"];
    }
    return ["访问治理"];
  }
  return ["KTX WebUI"];
}

function AppFrame() {
  const location = useLocation();
  const breadcrumbs = breadcrumbItems(location.pathname);

  return (
    <div className="pl-shell grid grid-cols-[248px_minmax(0,1fr)] min-h-screen">
      <aside className="pl-nav">
        <div className="pl-brand-block">
          <strong>KTX WebUI</strong>
          <span>语义维护工作台</span>
        </div>

        <nav className="grid gap-4" aria-label="主导航">
          <section>
            <h2 className="pl-nav-section-title">数据库接入</h2>
            <NavLink to="/connections" end className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>连接概览</NavLink>
            <NavLink to="/connections/whitelist" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>表白名单</NavLink>
            <NavLink to="/connections/test" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>连通测试</NavLink>
          </section>
          <section>
            <h2 className="pl-nav-section-title">语义层维护</h2>
            <NavLink to="/" end className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>表目录</NavLink>
          </section>
          <section>
            <h2 className="pl-nav-section-title">业务文档</h2>
            <NavLink to="/wiki" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>Wiki 文档</NavLink>
          </section>
          <section>
            <h2 className="pl-nav-section-title">审阅与校验</h2>
            <NavLink to="/review" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>变更审阅</NavLink>
          </section>
          <section>
            <h2 className="pl-nav-section-title">质量评测</h2>
            <NavLink to="/eval/cases" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>Case 管理</NavLink>
            <NavLink to="/eval/runs" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>运行历史</NavLink>
            <NavLink to="/eval/monitor" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>趋势监控</NavLink>
          </section>
          <section>
            <h2 className="pl-nav-section-title">访问治理</h2>
            <NavLink to="/admin/agents" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>Agent 实例</NavLink>
            <NavLink to="/admin/audit" className={({ isActive }) => `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`}>访问日志</NavLink>
          </section>
        </nav>
      </aside>

      <main className="p-6">
        <nav className="flex items-center gap-2 text-sm text-fg-muted mb-4" aria-label="当前位置">
          {breadcrumbs.map((item, index) => (
            <span key={`${index}-${item}`} className="flex items-center gap-2">
              {index > 0 ? <span>/</span> : null}
              <span>{item}</span>
            </span>
          ))}
        </nav>
        <Routes>
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
          <Route path="/admin/audit" element={<Audit />} />
          <Route path="/eval/cases" element={<CaseList />} />
          <Route path="/eval/cases/:domain" element={<CaseList />} />
          <Route path="/eval/cases/:domain/new" element={<CaseEditor />} />
          <Route path="/eval/cases/:domain/:caseId" element={<CaseEditor />} />
          <Route path="/eval/runs" element={<RunList />} />
          <Route path="/eval/runs/:runId" element={<RunDetail />} />
          <Route path="/eval/monitor" element={<Monitor />} />
        </Routes>
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