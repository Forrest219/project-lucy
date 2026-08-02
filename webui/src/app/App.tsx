import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Catalog } from "../pages/Catalog";
import { JoinEditor } from "../pages/JoinEditor";
import { Onboarding } from "../pages/Onboarding";
import { PublishWorkbench } from "../pages/publish/PublishWorkbench";
import { PublishHistory } from "../pages/publish/PublishHistory";
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
import { ObjectDetailDrawer } from "../components/ObjectDetailDrawer";
import { topLevelEntry, navGroups } from "./navigation";

const queryClient = new QueryClient();

/**
 * M39 review follow-up: keep `/onboarding` as a compatibility alias for
 * `/overview`, but forward the incoming `search` and `hash` so legacy
 * bookmarks such as `/onboarding?object=table&conn=...&schema=...&table=...`
 * still open the ObjectDetailDrawer on the canonical route. The naked
 * `<Navigate to="/overview" replace />` element drops `search` by default,
 * which silently breaks any pre-M36 share / QA link.
 */
function OnboardingRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "/overview", search: location.search, hash: location.hash }}
      replace
    />
  );
}

function SourceRouteRedirect() {
  const location = useLocation();
  const { conn = "", schema = "", table = "" } = useParams();
  return (
    <Navigate
      to={{
        pathname: `/catalog/${encodeURIComponent(conn)}/${encodeURIComponent(schema)}/${encodeURIComponent(table)}`,
        search: location.search,
        hash: location.hash
      }}
      replace
    />
  );
}

function TableWhitelistRedirect() {
  const location = useLocation();
  return (
    <Navigate
      to={{ pathname: "/connections/enabled-tables", search: location.search, hash: location.hash }}
      replace
    />
  );
}

function navLinkClass(isActive: boolean) {
  return `pl-nav-link${isActive ? " pl-nav-link--active" : ""}`;
}

export function AppFrame() {
  const location = useLocation();
  const isHelpRoute = location.pathname === "/help";
  const appShellClass = [
    "pl-app-shell",
    isHelpRoute ? "pl-app-shell--help" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={appShellClass}>
      <aside className="pl-sidebar">
        <div className="pl-brand-block">
          <strong>Lucy WebUI</strong>
          {/* v1.9.x 收口：移除英文 Subtitle（与中文 tagline 重复），仅保留一行干净中文。 */}
          <span
            className="pl-brand-tagline notranslate"
            translate="no"
            title="Data Agent 运维控制台"
          >
            Data Agent 运维控制台
          </span>
        </div>

        <nav className="pl-nav" aria-label="主导航">
          <section className="pl-nav-section pl-nav-section--top" key="top">
            <div className="grid gap-1">
              <Link
                aria-current={topLevelEntry.active(location.pathname) ? "page" : undefined}
                className={navLinkClass(topLevelEntry.active(location.pathname))}
                to={topLevelEntry.to}
              >
                {topLevelEntry.label}
              </Link>
            </div>
          </section>
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
        </div>
      </aside>

      <main className="pl-workspace">
        <div className="pl-workspace-body">
          <Routes>
            <Route path="/overview" element={<Onboarding />} />
            <Route path="/onboarding" element={<OnboardingRedirect />} />
            <Route path="/connections" element={<ConnectionOverview />} />
            <Route path="/connections/enabled-tables" element={<TableWhitelist />} />
            <Route path="/connections/whitelist" element={<TableWhitelistRedirect />} />
            <Route path="/connections/test" element={<ConnectionTest />} />
            <Route path="/" element={<Navigate to="/catalog" replace />} />
            <Route path="/catalog" element={<Catalog />} />
            <Route path="/catalog/:conn/:schema/:table" element={<TableEditor />} />
            <Route path="/sources/:conn/:schema/:table" element={<SourceRouteRedirect />} />
            <Route path="/joins/:conn/:schema/:table" element={<JoinEditor />} />
            <Route path="/publish/workbench" element={<PublishWorkbench />} />
            <Route path="/publish/history" element={<PublishHistory />} />
            <Route path="/review" element={<Navigate to="/publish/workbench" replace />} />
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
        {/* M36: ObjectDetailDrawer is mounted once at the AppFrame level so any
            page can open it by updating URL query parameters (e.g.
            `?object=table&conn=...&schema=...&table=...`). */}
        <ObjectDetailDrawer />
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
