import { Component, Suspense, useCallback, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
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
  Key,
  KeyRound,
  ScrollText,
  Settings,
  Sparkles,
  Terminal,
  Users,
  Image,
  BadgeCheck,
  Radio,
  type LucideIcon
} from "lucide-react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { LoginPage } from "../pages/Login";
import { AuthProvider, useAuth, useAuthOptional } from "../lib/auth";
import { useUiPageViewBeacon } from "./ui-usage-beacon";
import { BrandMark } from "../components/BrandMark";
import { useBranding } from "../lib/useBranding";
import { isPublicUiPath } from "../lib/publicAccess";
import { HelpButton } from "../components/HelpButton";
import { CommandPalette } from "../components/CommandPalette";
import { PolicyDegradeBanner } from "../components/PolicyDegradeBanner";
import { formatLucyVersionLabel } from "../lib/lucyVersion";
import { setDisplayWriteSettledHandler } from "../lib/apiClient";
import { catalogReloadsQueryOptions, DISPLAY_SCOPE_QUERY_KEYS, mcpRuntimeStatusQueryOptions, projectQueryOptions, sourcesQueryOptions } from "../lib/displayQueryOptions";
import { isChunkLoadError, lazyRoute, type LazyRoute } from "../lib/routeChunkRecovery";
import { findGroupIdForPathname, navGroups, type NavIconKey } from "./navigation";

// Spec 174 §6 — business pages and large drawers load lazily; AuthProvider, the
// shell and the login page stay in the entry bundle.
const CatalogRoute = lazyRoute(() => import("../pages/Catalog"), "Catalog");
const JoinEditorRoute = lazyRoute(() => import("../pages/JoinEditor"), "JoinEditor");
const OnboardingRoute = lazyRoute(() => import("../pages/Onboarding"), "Onboarding");
const PublishWorkbenchRoute = lazyRoute(() => import("../pages/publish/PublishWorkbench"), "PublishWorkbench");
const PublishHistoryRoute = lazyRoute(() => import("../pages/publish/PublishHistory"), "PublishHistory");
const TableEditorRoute = lazyRoute(() => import("../pages/TableEditor"), "TableEditor");
const WikiEditorRoute = lazyRoute(() => import("../pages/WikiEditor"), "WikiEditor");
const SkillListRoute = lazyRoute(() => import("../pages/skills/SkillList"), "SkillList");
const AgentListRoute = lazyRoute(() => import("../pages/admin/AgentList"), "AgentList");
const AgentDetailRoute = lazyRoute(() => import("../pages/admin/AgentDetail"), "AgentDetail");
const TokensRoute = lazyRoute(() => import("../pages/admin/Tokens"), "Tokens");
const NewTokenRoute = lazyRoute(() => import("../pages/admin/NewToken"), "NewToken");
const GovernanceOverviewRoute = lazyRoute(() => import("../pages/admin/GovernanceOverview"), "GovernanceOverview");
const AuditRoute = lazyRoute(() => import("../pages/admin/Audit"), "Audit");
const McpPlaygroundRoute = lazyRoute(() => import("../pages/admin/McpPlayground"), "McpPlayground");
const ConfigAuditRoute = lazyRoute(() => import("../pages/admin/ConfigAudit"), "ConfigAudit");
const AuditSourcesRoute = lazyRoute(() => import("../pages/admin/AuditSources"), "AuditSources");
const RoleListRoute = lazyRoute(() => import("../pages/admin/RoleList"), "RoleList");
const RoleDetailRoute = lazyRoute(() => import("../pages/admin/RoleDetail"), "RoleDetail");
const AdminAccountsRoute = lazyRoute(() => import("../pages/admin/AdminAccounts"), "AdminAccounts");
const BrandingSettingsRoute = lazyRoute(() => import("../pages/admin/BrandingSettings"), "BrandingSettings");
const LicenseSettingsRoute = lazyRoute(() => import("../pages/admin/LicenseSettings"), "LicenseSettings");
const CaseListRoute = lazyRoute(() => import("../pages/eval/CaseList"), "CaseList");
const CaseEditorRoute = lazyRoute(() => import("../pages/eval/CaseEditor"), "CaseEditor");
const RunListRoute = lazyRoute(() => import("../pages/eval/RunList"), "RunList");
const RunDetailRoute = lazyRoute(() => import("../pages/eval/RunDetail"), "RunDetail");
const MonitorRoute = lazyRoute(() => import("../pages/eval/Monitor"), "Monitor");
const SecurityCandidatesRoute = lazyRoute(() => import("../pages/eval/SecurityCandidates"), "SecurityCandidates");
const FieldQuestionsRoute = lazyRoute(() => import("../pages/eval/FieldQuestions"), "FieldQuestions");
const ConnectionOverviewRoute = lazyRoute(() => import("../pages/connections/ConnectionOverview"), "ConnectionOverview");
const TableWhitelistRoute = lazyRoute(() => import("../pages/connections/TableWhitelist"), "TableWhitelist");
const ConnectionTestRoute = lazyRoute(() => import("../pages/connections/ConnectionTest"), "ConnectionTest");
const HelpCenterRoute = lazyRoute(() => import("../pages/HelpCenter"), "HelpCenter");
const CallMonitorRoute = lazyRoute(() => import("../pages/ops/CallMonitor"), "CallMonitor");
const ObjectDetailDrawerRoute = lazyRoute(() => import("../components/ObjectDetailDrawer"), "ObjectDetailDrawer");

const {
  Catalog,
  JoinEditor,
  Onboarding,
  PublishWorkbench,
  PublishHistory,
  TableEditor,
  WikiEditor,
  SkillList,
  AgentList,
  AgentDetail,
  Tokens,
  NewToken,
  GovernanceOverview,
  Audit,
  McpPlayground,
  ConfigAudit,
  AuditSources,
  RoleList,
  RoleDetail,
  AdminAccounts,
  BrandingSettings,
  LicenseSettings,
  CaseList,
  CaseEditor,
  RunList,
  RunDetail,
  Monitor,
  SecurityCandidates,
  FieldQuestions,
  ConnectionOverview,
  TableWhitelist,
  ConnectionTest,
  HelpCenter,
  CallMonitor,
  ObjectDetailDrawer
} = {
  Catalog: CatalogRoute.Component,
  JoinEditor: JoinEditorRoute.Component,
  Onboarding: OnboardingRoute.Component,
  PublishWorkbench: PublishWorkbenchRoute.Component,
  PublishHistory: PublishHistoryRoute.Component,
  TableEditor: TableEditorRoute.Component,
  WikiEditor: WikiEditorRoute.Component,
  SkillList: SkillListRoute.Component,
  AgentList: AgentListRoute.Component,
  AgentDetail: AgentDetailRoute.Component,
  Tokens: TokensRoute.Component,
  NewToken: NewTokenRoute.Component,
  GovernanceOverview: GovernanceOverviewRoute.Component,
  Audit: AuditRoute.Component,
  McpPlayground: McpPlaygroundRoute.Component,
  ConfigAudit: ConfigAuditRoute.Component,
  AuditSources: AuditSourcesRoute.Component,
  RoleList: RoleListRoute.Component,
  RoleDetail: RoleDetailRoute.Component,
  AdminAccounts: AdminAccountsRoute.Component,
  BrandingSettings: BrandingSettingsRoute.Component,
  LicenseSettings: LicenseSettingsRoute.Component,
  CaseList: CaseListRoute.Component,
  CaseEditor: CaseEditorRoute.Component,
  RunList: RunListRoute.Component,
  RunDetail: RunDetailRoute.Component,
  Monitor: MonitorRoute.Component,
  SecurityCandidates: SecurityCandidatesRoute.Component,
  FieldQuestions: FieldQuestionsRoute.Component,
  ConnectionOverview: ConnectionOverviewRoute.Component,
  TableWhitelist: TableWhitelistRoute.Component,
  ConnectionTest: ConnectionTestRoute.Component,
  HelpCenter: HelpCenterRoute.Component,
  CallMonitor: CallMonitorRoute.Component,
  ObjectDetailDrawer: ObjectDetailDrawerRoute.Component
};

/** Route path → chunk + display queries that may start in parallel with the chunk. */
const ROUTE_PRELOADS: Array<{ match: (path: string) => boolean; route: LazyRoute; queries?: Array<"project" | "sources" | "mcpRuntime" | "catalogReloads"> }> = [
  { match: (p) => p === "/overview" || p === "/onboarding", route: OnboardingRoute, queries: ["project", "sources"] },
  { match: (p) => p === "/connections", route: ConnectionOverviewRoute, queries: ["project", "sources", "mcpRuntime", "catalogReloads"] },
  { match: (p) => p === "/connections/enabled-tables" || p === "/connections/whitelist", route: TableWhitelistRoute },
  { match: (p) => p === "/connections/test", route: ConnectionTestRoute },
  { match: (p) => p === "/catalog" || p === "/", route: CatalogRoute, queries: ["sources"] },
  { match: (p) => p.startsWith("/catalog/") || p.startsWith("/sources/"), route: TableEditorRoute },
  { match: (p) => p === "/admin/agents", route: AgentListRoute },
  { match: (p) => p.startsWith("/admin/agents/") && p.endsWith("/tokens/new"), route: NewTokenRoute },
  { match: (p) => p.startsWith("/admin/agents/"), route: AgentDetailRoute },
  { match: (p) => p === "/admin/usage", route: GovernanceOverviewRoute },
  { match: (p) => p === "/admin/roles", route: RoleListRoute },
  { match: (p) => p.startsWith("/admin/roles/"), route: RoleDetailRoute },
  { match: (p) => p === "/admin/tokens", route: TokensRoute },
  { match: (p) => p === "/admin/audit", route: AuditRoute },
  { match: (p) => p === "/help", route: HelpCenterRoute },
  { match: (p) => p === "/ops/calls", route: CallMonitorRoute },
  { match: (p) => p === "/wiki", route: WikiEditorRoute },
  { match: (p) => p === "/skills", route: SkillListRoute }
];

function preloadRouteChunk(pathname: string): void {
  void ROUTE_PRELOADS.find((entry) => entry.match(pathname))?.route.preload();
}

function prefetchRouteQueries(client: QueryClient, pathname: string): void {
  for (const query of ROUTE_PRELOADS.find((entry) => entry.match(pathname))?.queries ?? []) {
    if (query === "project") void client.prefetchQuery(projectQueryOptions());
    else if (query === "sources") void client.prefetchQuery(sourcesQueryOptions());
    else if (query === "mcpRuntime") void client.prefetchQuery(mcpRuntimeStatusQueryOptions());
    else void client.prefetchQuery(catalogReloadsQueryOptions());
  }
}

if (typeof window !== "undefined") preloadRouteChunk(window.location.pathname);

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
  callMonitor: Radio,
  connections: Cable,
  whitelist: TableProperties,
  catalog: Boxes,
  wiki: BookOpen,
  skills: Sparkles,
  publish: Rocket,
  history: History,
  evalCases: ClipboardList,
  evalRuns: Activity,
  monitor: ChartNoAxesCombined,
  fieldQuestions: CircleHelp,
  securityEval: ShieldAlert,
  governanceOverview: Gauge,
  agents: Bot,
  tokens: Key,
  roles: KeyRound,
  audit: ScrollText,
  mcpPlayground: Terminal,
  configAudit: ShieldCheck,
  admins: Users,
  branding: Image,
  license: BadgeCheck
};

const GROUP_ICONS: Record<string, LucideIcon> = {
  "runtime-status": LayoutDashboard,
  connections: Database,
  "semantic-modeling": Share2,
  publish: Rocket,
  evaluation: ChartNoAxesCombined,
  governance: ShieldCheck,
  "system-settings": Settings
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

/** Static content-area placeholder while a route chunk loads (no animation, stable size). */
function RouteChunkFallback() {
  return <div className="pl-async-region pl-async-region--pending" aria-busy="true" style={{ minHeight: 320 }} />;
}

type RouteBoundaryState = { error: unknown };

/**
 * Spec 174 §6 — a failed route chunk keeps the shell; after the one automatic
 * reload has been used, show a local retry instead of reloading in a loop.
 */
class RouteChunkBoundary extends Component<{ resetKey: string; children: ReactNode }, RouteBoundaryState> {
  state: RouteBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): RouteBoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    if (!isChunkLoadError(error)) console.error(error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pl-async-region pl-async-region--error" role="alert" data-testid="route-chunk-error">
        <p className="pl-error">页面资源加载失败，可能是版本已更新。</p>
        <button
          type="button"
          className="pl-btn pl-btn--secondary pl-btn--xs"
          data-testid="route-chunk-retry"
          onClick={() => window.location.reload()}
        >
          重试
        </button>
      </div>
    );
  }
}

export function AppFrame() {
  const location = useLocation();
  const auth = useAuthOptional();
  useUiPageViewBeacon(location.pathname, auth?.status ?? null);
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
  const hasObjectDetail = new URLSearchParams(location.search).has("object");

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
                        onMouseEnter={() => preloadRouteChunk(item.to)}
                        onFocus={() => preloadRouteChunk(item.to)}
                      >
                        <ItemIcon aria-hidden="true" className="size-4" />
                        <span className="notranslate" translate="no">{item.label}</span>
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
              {formatLucyVersionLabel()}
            </span>
          </div>
        </div>
        </aside>

        <main className="pl-workspace">
          <PolicyDegradeBanner />
          <div className="pl-workspace-body">
            <RouteChunkBoundary resetKey={location.pathname}>
            <Suspense fallback={<RouteChunkFallback />}>
            <Routes>
            <Route path="/overview" element={<Onboarding />} />
            <Route path="/ops/calls" element={<CallMonitor />} />
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
            <Route path="/skills" element={<SkillList />} />
            <Route path="/admin/usage" element={<GovernanceOverview />} />
            <Route path="/admin/governance" element={<Navigate to="/admin/usage" replace />} />
            <Route path="/admin/agents" element={<AgentList />} />
            <Route path="/admin/agents/:userId" element={<AgentDetail />} />
            <Route path="/admin/agents/:userId/tokens/new" element={<NewToken />} />
            <Route path="/admin/tokens" element={<Tokens />} />
            <Route path="/admin/tokens/new" element={<NewToken />} />
            <Route path="/admin/roles" element={<RoleList />} />
            <Route path="/admin/roles/new" element={<RoleDetail mode="create" />} />
            <Route path="/admin/roles/:roleId" element={<RoleDetail />} />
            <Route path="/admin/audit" element={<Audit />} />
            <Route path="/admin/audit-sources" element={<AuditSources />} />
            <Route path="/admin/mcp-playground" element={<McpPlayground />} />
            <Route path="/admin/config-audit" element={<ConfigAudit />} />
            <Route path="/admin/branding" element={<BrandingSettings />} />
            <Route path="/admin/license" element={<LicenseSettings />} />
            <Route path="/admin/admins" element={<AdminAccounts />} />
            <Route path="/eval/cases" element={<CaseList />} />
            <Route path="/eval/cases/:domain" element={<CaseList />} />
            <Route path="/eval/cases/:domain/new" element={<CaseEditor />} />
            <Route path="/eval/cases/:domain/:caseId" element={<CaseEditor />} />
            <Route path="/eval/runs" element={<RunList />} />
            <Route path="/eval/runs/:runId" element={<RunDetail />} />
            <Route path="/eval/monitor" element={<Monitor />} />
            <Route path="/eval/field-questions" element={<FieldQuestions />} />
            <Route path="/eval/security-candidates" element={<SecurityCandidates />} />
            <Route path="/help" element={<HelpCenter />} />
            </Routes>
            </Suspense>
            </RouteChunkBoundary>
          </div>
          {/* M36: ObjectDetailDrawer is mounted once at the AppFrame level so any
            page can open it by updating URL query parameters (e.g.
            `?object=table&conn=...&schema=...&table=...`). */}
          {hasObjectDetail ? (
            <Suspense fallback={null}>
              <ObjectDetailDrawer />
            </Suspense>
          ) : null}
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
  const client = useQueryClient();
  const authorized = !loading && (status?.mode === "open" || Boolean(status?.me));
  // Spec 174 §6 — start the entry route's display queries alongside its chunk.
  useEffect(() => {
    if (authorized) prefetchRouteQueries(client, location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only for the entry route
  }, [authorized]);
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

/**
 * Spec 174 §4.2 — after every display-affecting write settles (success or
 * failure) re-check the server read model instead of trusting the response.
 */
function DisplayWriteSync() {
  const client = useQueryClient();
  useEffect(() => {
    setDisplayWriteSettledHandler((scopes) => {
      for (const scope of scopes) void client.invalidateQueries({ queryKey: DISPLAY_SCOPE_QUERY_KEYS[scope] });
    });
    return () => setDisplayWriteSettledHandler(null);
  }, [client]);
  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <DisplayWriteSync />
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
