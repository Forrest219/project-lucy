import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import {
  Boxes,
  Bot,
  Cable,
  ChartNoAxesCombined,
  ChevronRight,
  CircleHelp,
  Database,
  Gauge,
  History,
  LayoutDashboard,
  Rocket,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  TableProperties,
  ClipboardList,
  Activity,
  BookOpen,
  KeyRound,
  ScrollText,
  Terminal,
  Users,
  Image,
  type LucideIcon
} from "lucide-react";
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
import { GovernanceOverview } from "../pages/admin/GovernanceOverview";
import { Audit } from "../pages/admin/Audit";
import { McpPlayground } from "../pages/admin/McpPlayground";
import { ConfigAudit } from "../pages/admin/ConfigAudit";
import { AuditSources } from "../pages/admin/AuditSources";
import { RoleList } from "../pages/admin/RoleList";
import { RoleDetail } from "../pages/admin/RoleDetail";
import { AdminAccounts } from "../pages/admin/AdminAccounts";
import { BrandingSettings } from "../pages/admin/BrandingSettings";
import { LoginPage } from "../pages/Login";
import { AuthProvider, useAuth, useAuthOptional } from "../lib/auth";
import { BrandMark } from "../components/BrandMark";
import { useBranding } from "../lib/useBranding";
import { isPublicUiPath } from "../lib/publicAccess";
import { CaseList } from "../pages/eval/CaseList";
import { CaseEditor } from "../pages/eval/CaseEditor";
import { RunList } from "../pages/eval/RunList";
import { RunDetail } from "../pages/eval/RunDetail";
import { Monitor } from "../pages/eval/Monitor";
import { SecurityCandidates } from "../pages/eval/SecurityCandidates";
import { ConnectionOverview } from "../pages/connections/ConnectionOverview";
import { TableWhitelist } from "../pages/connections/TableWhitelist";
import { ConnectionTest } from "../pages/connections/ConnectionTest";
import { HelpCenter } from "../pages/HelpCenter";
import { HelpButton } from "../components/HelpButton";
import { ObjectDetailDrawer } from "../components/ObjectDetailDrawer";
import { CommandPalette } from "../components/CommandPalette";
import { PolicyDegradeBanner } from "../components/PolicyDegradeBanner";
import { findGroupIdForPathname, navGroups, topLevelEntry, type NavIconKey } from "./navigation";

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

function navLinkClass(isActive: boolean, level: "top" | "child" = "top") {
  return `pl-nav-link${level === "child" ? " pl-nav-link--child" : ""}${isActive ? " pl-nav-link--active" : ""}`;
}

// M60 Sidebar Brand Navigation Polish: visual icon registry. Kept in App.tsx
// so navigation.ts stays a pure data module and doesn't drag React / lucide
// into tests that only care about the IA shape.
const NAV_ICONS: Record<NavIconKey, LucideIcon> = {
  overview: LayoutDashboard,
  connections: Cable,
  whitelist: TableProperties,
  catalog: Boxes,
  wiki: BookOpen,
  publish: Rocket,
  history: History,
  evalCases: ClipboardList,
  evalRuns: Activity,
  monitor: ChartNoAxesCombined,
  securityEval: ShieldAlert,
  governanceOverview: Gauge,
  agents: Bot,
  roles: KeyRound,
  audit: ScrollText,
  mcpPlayground: Terminal,
  configAudit: ShieldCheck,
  admins: Users,
  branding: Image
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  connections: Database,
  "semantic-modeling": Share2,
  publish: Rocket,
  evaluation: ChartNoAxesCombined,
  governance: ShieldCheck
};

const COLLAPSED_GROUPS_STORAGE_KEY = "lucy.sidebar.collapsedGroups.v1";

function readCollapsedGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(COLLAPSED_GROUPS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((value): value is string => typeof value === "string"));
  } catch {
    return new Set();
  }
}

function writeCollapsedGroups(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      COLLAPSED_GROUPS_STORAGE_KEY,
      JSON.stringify(Array.from(ids))
    );
  } catch {
    // localStorage may be disabled (private mode / quota) — silently no-op
    // so the sidebar keeps working without persisting state.
  }
}

export function AppFrame() {
  const location = useLocation();
  const { data: branding } = useBranding();
  const isHelpRoute = location.pathname === "/help";
  const appShellClass = [
    "pl-app-shell",
    isHelpRoute ? "pl-app-shell--help" : ""
  ].filter(Boolean).join(" ");
  const productTitle = branding?.productTitle ?? "Lucy WebUI";
  const tagline = branding?.tagline ?? "Data Agent MCP";
  const logoUrl = branding?.logoUrl ?? null;

  // M60: collapsible group state. We seed the Set from localStorage so the
  // user's last manual choice survives a reload, but we always force the
  // active route's group to be open below via the derived `expanded` map.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => readCollapsedGroups());
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const activeGroupId = useMemo(
    () => findGroupIdForPathname(location.pathname),
    [location.pathname]
  );

  // Persist whenever the Set changes. We do not exclude `activeGroupId`
  // here — if the user explicitly collapses the active group, the storage
  // still records it; the next effect will re-expand the route's group
  // without mutating storage so a refresh respects the user's prior
  // intent on unrelated groups.
  useEffect(() => {
    writeCollapsedGroups(collapsedGroups);
  }, [collapsedGroups]);

  // Auto-expand the group that owns the current route. We mutate the Set
  // through `setCollapsedGroups` so the derivation stays a single source
  // of truth; an equality check prevents spurious re-renders.
  useEffect(() => {
    if (!activeGroupId) return;
    setCollapsedGroups((prev) => {
      if (!prev.has(activeGroupId)) return prev;
      const next = new Set(prev);
      next.delete(activeGroupId);
      return next;
    });
  }, [activeGroupId]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  // ⌘ K / Ctrl K opens the command palette. We listen on `window` so the
  // shortcut works from any focus location (no input/textarea check — the
  // palette has its own input where users expect ⌘ K to focus it).
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const OverviewIcon = NAV_ICONS[topLevelEntry.iconKey];

  return (
    <div className="pl-app-root">
      <div className={appShellClass}>
        <aside className="pl-sidebar">
        <Link
          to="/overview"
          className="pl-brand-block notranslate"
          translate="no"
          data-testid="sidebar-brand"
          aria-label="返回系统概览"
          title="返回系统概览"
        >
          <BrandMark productTitle={productTitle} logoUrl={logoUrl} />
          <div className="pl-brand-text">
            <strong className="pl-brand-title" data-testid="brand-title">
              {productTitle}
            </strong>
            {/* Brand caption shortened to `Data Agent MCP` so the natural
                width matches the 16px wordmark without splitting the title
                into spaced-apart tokens. Keep notranslate so browsers don't
                rewrite professional English in the tagline. */}
            <span
              className="pl-brand-tagline notranslate"
              translate="no"
              data-testid="brand-tagline"
            >
              {tagline}
            </span>
          </div>
        </Link>

        <div className="pl-sidebar-search">
          <button
            type="button"
            className="pl-sidebar-search-button notranslate"
            translate="no"
            data-testid="sidebar-search-trigger"
            aria-label="打开命令面板，搜索页面和导航入口"
            onClick={() => setCommandPaletteOpen(true)}
          >
            <Search aria-hidden="true" className="size-4" />
            <span translate="no" className="notranslate">
              搜索页面和导航入口
            </span>
            <span className="pl-sidebar-search-shortcut" aria-hidden="true">
              ⌘ K
            </span>
          </button>
        </div>

        <nav className="pl-nav" aria-label="主导航">
          <section className="pl-nav-section pl-nav-section--top" key="top">
            <div className="grid gap-0.5">
              <Link
                aria-current={topLevelEntry.active(location.pathname) ? "page" : undefined}
                className={navLinkClass(topLevelEntry.active(location.pathname))}
                to={topLevelEntry.to}
                data-testid={`nav-link-${topLevelEntry.id}`}
              >
                <OverviewIcon aria-hidden="true" className="size-4" />
                <span>{topLevelEntry.label}</span>
              </Link>
            </div>
          </section>
          {navGroups.map((group) => {
            const isOpen = !collapsedGroups.has(group.id);
            const GroupIcon = GROUP_ICONS[group.id];
            return (
              <section
                className="pl-nav-section"
                key={group.id}
                data-testid={`nav-group-${group.id}`}
                data-open={isOpen ? "true" : "false"}
              >
                <button
                  type="button"
                  className="pl-nav-section-title-button"
                  aria-expanded={isOpen}
                  aria-controls={`nav-group-${group.id}-items`}
                  onClick={() => toggleGroup(group.id)}
                  data-testid={`nav-group-toggle-${group.id}`}
                >
                  {GroupIcon ? (
                    <GroupIcon aria-hidden="true" className="size-4" />
                  ) : null}
                  <span>{group.title}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className="pl-nav-section-chevron size-4"
                    data-open={isOpen ? "true" : "false"}
                  />
                </button>
                <div
                  className="pl-nav-group-items"
                  hidden={!isOpen}
                  id={`nav-group-${group.id}-items`}
                  data-testid={`nav-group-items-${group.id}`}
                >
                  {group.items.map((item) => {
                    const active = item.active(location.pathname);
                    const ItemIcon = NAV_ICONS[item.iconKey];
                    return (
                      <Link
                        aria-current={active ? "page" : undefined}
                        className={navLinkClass(active, "child")}
                        key={item.id}
                        to={item.to}
                        data-testid={`nav-link-${item.id}`}
                      >
                        <ItemIcon aria-hidden="true" className="size-4" />
                        <span>{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>
        <div className="pl-sidebar-footer" data-testid="sidebar-footer">
          <SidebarAuthFooter />
          <div className="pl-sidebar-utility" data-testid="sidebar-utility">
            <HelpButton className="pl-sidebar-help-link">
              <CircleHelp aria-hidden="true" className="size-4" />
              <span>系统手册</span>
            </HelpButton>
            <span
              className="pl-sidebar-version notranslate"
              translate="no"
              data-testid="sidebar-version"
            >
              v0.16
            </span>
          </div>
        </div>
        </aside>

        <main className="pl-workspace">
          <PolicyDegradeBanner />
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
            <Route path="/admin/usage" element={<GovernanceOverview />} />
            <Route path="/admin/governance" element={<Navigate to="/admin/usage" replace />} />
            <Route path="/admin/agents" element={<AgentList />} />
            <Route path="/admin/agents/:userId" element={<AgentDetail />} />
            <Route path="/admin/agents/:userId/tokens/new" element={<NewToken />} />
            <Route path="/admin/roles" element={<RoleList />} />
            <Route path="/admin/roles/new" element={<RoleDetail mode="create" />} />
            <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
            <Route path="/admin/audit" element={<Audit />} />
            <Route path="/admin/audit-sources" element={<AuditSources />} />
            <Route path="/admin/mcp-playground" element={<McpPlayground />} />
            <Route path="/admin/config-audit" element={<ConfigAudit />} />
            <Route path="/admin/branding" element={<BrandingSettings />} />
            <Route path="/admin/admins" element={<AdminAccounts />} />
            <Route path="/eval/cases" element={<CaseList />} />
            <Route path="/eval/cases/:domain" element={<CaseList />} />
            <Route path="/eval/cases/:domain/new" element={<CaseEditor />} />
            <Route path="/eval/cases/:domain/:caseId" element={<CaseEditor />} />
            <Route path="/eval/runs" element={<RunList />} />
            <Route path="/eval/runs/:runId" element={<RunDetail />} />
            <Route path="/eval/monitor" element={<Monitor />} />
            <Route path="/eval/security-candidates" element={<SecurityCandidates />} />
            <Route path="/help" element={<HelpCenter />} />
            </Routes>
          </div>
          {/* M36: ObjectDetailDrawer is mounted once at the AppFrame level so any
            page can open it by updating URL query parameters (e.g.
            `?object=table&conn=...&schema=...&table=...`). */}
          <ObjectDetailDrawer />
        </main>

        <CommandPalette
          open={commandPaletteOpen}
          onClose={() => setCommandPaletteOpen(false)}
        />
      </div>
    </div>
  );
}

function SidebarAuthFooter() {
  const auth = useAuthOptional();
  if (!auth?.status || auth.status.mode === "open") return null;
  if (!auth.status.me) return null;
  return (
    <div className="px-3 pb-2 text-xs text-fg-muted grid gap-1" data-testid="sidebar-auth">
      <div>
        <span>当前管理员：</span>
        <span className="notranslate font-mono" translate="no">
          {auth.status.me.id}
        </span>
      </div>
      <button
        type="button"
        className="pl-btn pl-btn--ghost text-left"
        onClick={() => void auth.logout()}
      >
        退出登录
      </button>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { status, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-fg-muted">
        加载中…
      </div>
    );
  }
  // /help stays reachable without a session so login failures can still open
  // the handbook (break-glass / MCP 401). Pair with public GET /api/help/*.
  if (isPublicUiPath(location.pathname)) {
    return <>{children}</>;
  }
  if (status?.mode === "required" && !status.me) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (status?.mode === "bootstrap") {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AppFrame />
                </RequireAuth>
              }
            />
          </Routes>
          <Toaster richColors position="bottom-right" />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
