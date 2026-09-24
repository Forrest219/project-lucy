/**
 * Spec 148 — WebUI page and menu visit recording.
 * Stores page keys only. Never persist raw pathnames, query strings, or business object names.
 */
import type { FastifyInstance } from "fastify";
import { actorIdFromRequest } from "../auth/guard.js";
import { getAuditDb } from "./audit.js";
import { buildMetricWindow } from "./metric-window.js";

export const UI_PAGE_VIEW_UNKNOWN = "unknown";

const WINDOW_24H = 24;
const WINDOW_7D = 168;

export type UiUsageRankRow = {
  id: string;
  label: string;
  visits: number;
};

export type UiPageDefinition = {
  pageKey: string;
  label: string;
  menuId: string | null;
  groupId: string | null;
};

type MenuDefinition = { id: string; label: string };
type GroupDefinition = { id: string; label: string };

export const UI_USAGE_GROUPS: GroupDefinition[] = [
  { id: "runtime-status", label: "运行状态" },
  { id: "connections", label: "数据接入" },
  { id: "semantic-modeling", label: "业务上下文" },
  { id: "publish", label: "语义发布" },
  { id: "evaluation", label: "质量评测" },
  { id: "governance", label: "访问治理" },
  { id: "system-settings", label: "系统设置" }
];

export const UI_USAGE_MENUS: MenuDefinition[] = [
  { id: "overview", label: "系统概览" },
  { id: "ops-calls", label: "调用监控" },
  { id: "connections-overview", label: "连接概览" },
  { id: "connections-enabled-tables", label: "启用表范围" },
  { id: "semantic-catalog", label: "语义资产" },
  { id: "semantic-wiki", label: "业务 Wiki" },
  { id: "semantic-skills", label: "业务 Skill" },
  { id: "publish-workbench", label: "发布工作台" },
  { id: "publish-history", label: "发布记录" },
  { id: "eval-cases", label: "评测用例" },
  { id: "eval-runs", label: "运行历史" },
  { id: "eval-monitor", label: "趋势监控" },
  { id: "eval-security-candidates", label: "安全评测候选" },
  { id: "admin-governance", label: "使用概况" },
  { id: "admin-agents", label: "Agent" },
  { id: "admin-tokens", label: "Token 凭据" },
  { id: "admin-roles", label: "角色权限" },
  { id: "admin-audit", label: "访问日志" },
  { id: "admin-mcp-playground", label: "MCP 调试台" },
  { id: "admin-config-audit", label: "配置审计" },
  { id: "admin-license", label: "部署许可" },
  { id: "admin-branding", label: "品牌外观" },
  { id: "admin-accounts", label: "登录账户" }
];

const PAGE = {
  overview: { pageKey: "overview", label: "系统概览", menuId: "overview", groupId: "runtime-status" },
  callMonitor: { pageKey: "ops-calls", label: "调用监控", menuId: "ops-calls", groupId: "runtime-status" },
  connections: { pageKey: "connections", label: "连接概览", menuId: "connections-overview", groupId: "connections" },
  enabledTables: { pageKey: "enabled-tables", label: "启用表范围", menuId: "connections-enabled-tables", groupId: "connections" },
  connectionTest: { pageKey: "connection-test", label: "连通测试", menuId: "connections-overview", groupId: "connections" },
  catalog: { pageKey: "catalog", label: "语义资产", menuId: "semantic-catalog", groupId: "semantic-modeling" },
  tableEditor: { pageKey: "table-editor", label: "表语义编辑", menuId: "semantic-catalog", groupId: "semantic-modeling" },
  joins: { pageKey: "joins", label: "关联关系", menuId: "semantic-catalog", groupId: "semantic-modeling" },
  wiki: { pageKey: "wiki", label: "业务 Wiki", menuId: "semantic-wiki", groupId: "semantic-modeling" },
  skills: { pageKey: "skills", label: "业务 Skill", menuId: "semantic-skills", groupId: "semantic-modeling" },
  publishWorkbench: { pageKey: "publish-workbench", label: "发布工作台", menuId: "publish-workbench", groupId: "publish" },
  publishHistory: { pageKey: "publish-history", label: "发布记录", menuId: "publish-history", groupId: "publish" },
  evalCases: { pageKey: "eval-cases", label: "评测用例", menuId: "eval-cases", groupId: "evaluation" },
  evalCaseEditor: { pageKey: "eval-case-editor", label: "评测用例编辑", menuId: "eval-cases", groupId: "evaluation" },
  evalRuns: { pageKey: "eval-runs", label: "运行历史", menuId: "eval-runs", groupId: "evaluation" },
  evalRunDetail: { pageKey: "eval-run-detail", label: "运行详情", menuId: "eval-runs", groupId: "evaluation" },
  evalMonitor: { pageKey: "eval-monitor", label: "趋势监控", menuId: "eval-monitor", groupId: "evaluation" },
  evalSecurity: { pageKey: "eval-security-candidates", label: "安全评测候选", menuId: "eval-security-candidates", groupId: "evaluation" },
  usage: { pageKey: "admin-usage", label: "使用概况", menuId: "admin-governance", groupId: "governance" },
  agents: { pageKey: "admin-agents", label: "Agent", menuId: "admin-agents", groupId: "governance" },
  agentDetail: { pageKey: "agent-detail", label: "Agent 详情", menuId: "admin-agents", groupId: "governance" },
  issueTokenAgent: { pageKey: "issue-token", label: "签发 Token", menuId: "admin-agents", groupId: "governance" },
  issueToken: { pageKey: "issue-token", label: "签发 Token", menuId: "admin-tokens", groupId: "governance" },
  tokens: { pageKey: "admin-tokens", label: "Token 凭据", menuId: "admin-tokens", groupId: "governance" },
  roles: { pageKey: "admin-roles", label: "角色权限", menuId: "admin-roles", groupId: "governance" },
  roleCreate: { pageKey: "role-create", label: "新建角色", menuId: "admin-roles", groupId: "governance" },
  roleDetail: { pageKey: "role-detail", label: "角色详情", menuId: "admin-roles", groupId: "governance" },
  audit: { pageKey: "admin-audit", label: "访问日志", menuId: "admin-audit", groupId: "governance" },
  playground: { pageKey: "mcp-playground", label: "MCP 调试台", menuId: "admin-mcp-playground", groupId: "governance" },
  configAudit: { pageKey: "config-audit", label: "配置审计", menuId: "admin-config-audit", groupId: "governance" },
  license: { pageKey: "admin-license", label: "部署许可", menuId: "admin-license", groupId: "system-settings" },
  branding: { pageKey: "admin-branding", label: "品牌外观", menuId: "admin-branding", groupId: "system-settings" },
  admins: { pageKey: "admin-accounts", label: "登录账户", menuId: "admin-accounts", groupId: "system-settings" },
  help: { pageKey: "help", label: "帮助中心", menuId: null, groupId: null }
} as const satisfies Record<string, UiPageDefinition>;

/** Unique pages for the ranking. Route variants that share a page key appear once. */
export const UI_USAGE_PAGES: UiPageDefinition[] = [
  PAGE.overview,
  PAGE.callMonitor,
  PAGE.connections,
  PAGE.enabledTables,
  PAGE.connectionTest,
  PAGE.catalog,
  PAGE.tableEditor,
  PAGE.joins,
  PAGE.wiki,
  PAGE.skills,
  PAGE.publishWorkbench,
  PAGE.publishHistory,
  PAGE.evalCases,
  PAGE.evalCaseEditor,
  PAGE.evalRuns,
  PAGE.evalRunDetail,
  PAGE.evalMonitor,
  PAGE.evalSecurity,
  PAGE.usage,
  PAGE.agents,
  PAGE.agentDetail,
  PAGE.issueToken,
  PAGE.tokens,
  PAGE.roles,
  PAGE.roleCreate,
  PAGE.roleDetail,
  PAGE.audit,
  PAGE.playground,
  PAGE.configAudit,
  PAGE.license,
  PAGE.branding,
  PAGE.admins,
  PAGE.help
];

const EXACT_PAGES = new Map<string, UiPageDefinition>([
  ["/overview", PAGE.overview],
  ["/ops/calls", PAGE.callMonitor],
  ["/connections", PAGE.connections],
  ["/connections/enabled-tables", PAGE.enabledTables],
  ["/connections/test", PAGE.connectionTest],
  ["/catalog", PAGE.catalog],
  ["/wiki", PAGE.wiki],
  ["/skills", PAGE.skills],
  ["/publish/workbench", PAGE.publishWorkbench],
  ["/publish/history", PAGE.publishHistory],
  ["/eval/cases", PAGE.evalCases],
  ["/eval/runs", PAGE.evalRuns],
  ["/eval/monitor", PAGE.evalMonitor],
  ["/eval/security-candidates", PAGE.evalSecurity],
  ["/admin/usage", PAGE.usage],
  ["/admin/agents", PAGE.agents],
  ["/admin/tokens", PAGE.tokens],
  ["/admin/tokens/new", PAGE.issueToken],
  ["/admin/roles", PAGE.roles],
  ["/admin/roles/new", PAGE.roleCreate],
  ["/admin/audit", PAGE.audit],
  ["/admin/mcp-playground", PAGE.playground],
  ["/admin/config-audit", PAGE.configAudit],
  ["/admin/license", PAGE.license],
  ["/admin/branding", PAGE.branding],
  ["/admin/admins", PAGE.admins],
  ["/help", PAGE.help]
]);

const REDIRECT_EXACT = new Set([
  "/",
  "/onboarding",
  "/admin/governance",
  "/review",
  "/connections/whitelist",
  "/admin/audit-sources"
]);

const DYNAMIC_PAGES: Array<{ pattern: RegExp; page: UiPageDefinition }> = [
  { pattern: /^\/catalog\/[^/]+\/[^/]+\/[^/]+$/, page: PAGE.tableEditor },
  { pattern: /^\/joins\/[^/]+\/[^/]+\/[^/]+$/, page: PAGE.joins },
  { pattern: /^\/admin\/agents\/[^/]+\/tokens\/new$/, page: PAGE.issueTokenAgent },
  { pattern: /^\/admin\/agents\/[^/]+$/, page: PAGE.agentDetail },
  { pattern: /^\/admin\/roles\/[^/]+$/, page: PAGE.roleDetail },
  { pattern: /^\/eval\/cases\/[^/]+\/new$/, page: PAGE.evalCaseEditor },
  { pattern: /^\/eval\/cases\/[^/]+\/[^/]+$/, page: PAGE.evalCaseEditor },
  { pattern: /^\/eval\/cases\/[^/]+$/, page: PAGE.evalCases },
  { pattern: /^\/eval\/runs\/[^/]+$/, page: PAGE.evalRunDetail }
];

const SOURCES_REDIRECT = /^\/sources\/[^/]+\/[^/]+\/[^/]+$/;

export type PageViewClassification =
  | { kind: "redirect" }
  | { kind: "page"; page: UiPageDefinition }
  | { kind: "unknown" };

export function normalizeUsagePathname(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  if (trimmed.length > 512) return null;
  if (/[?#\\\s]/.test(trimmed)) return null;
  if (trimmed.includes("..")) return null;
  const stripped = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
  return stripped || null;
}

export function classifyUsagePathname(pathname: string): PageViewClassification {
  if (REDIRECT_EXACT.has(pathname) || SOURCES_REDIRECT.test(pathname)) {
    return { kind: "redirect" };
  }
  const exact = EXACT_PAGES.get(pathname);
  if (exact) return { kind: "page", page: exact };
  for (const entry of DYNAMIC_PAGES) {
    if (entry.pattern.test(pathname)) return { kind: "page", page: entry.page };
  }
  return { kind: "unknown" };
}

export function parseUsageHours(value: unknown): 24 | 168 {
  if (value === 24 || value === "24") return WINDOW_24H;
  if (value === 168 || value === "168") return WINDOW_7D;
  return WINDOW_7D;
}

async function ensureUiPageViews(db: Awaited<ReturnType<typeof getAuditDb>>): Promise<void> {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ui_page_views (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ts        TEXT    NOT NULL,
      admin_id  TEXT    NOT NULL,
      page_key  TEXT    NOT NULL,
      menu_id   TEXT,
      group_id  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ui_page_views_ts ON ui_page_views(ts);
  `);
}

export async function recordUiPageView(input: {
  pathname: string;
  adminId: string;
  now?: Date;
}): Promise<{ recorded: boolean }> {
  const classification = classifyUsagePathname(input.pathname);
  if (classification.kind === "redirect") return { recorded: false };
  const page = classification.kind === "page"
    ? classification.page
    : { pageKey: UI_PAGE_VIEW_UNKNOWN, menuId: null, groupId: null };
  const db = await getAuditDb();
  await ensureUiPageViews(db);
  db.prepare(`
    INSERT INTO ui_page_views (ts, admin_id, page_key, menu_id, group_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    (input.now ?? new Date()).toISOString(),
    input.adminId,
    page.pageKey,
    page.menuId,
    page.groupId
  );
  return { recorded: true };
}

function rankByVisits(
  definitions: Array<{ id: string; label: string }>,
  counts: Map<string, number>
): UiUsageRankRow[] {
  return definitions
    .map((item) => ({ id: item.id, label: item.label, visits: counts.get(item.id) ?? 0 }))
    .sort((a, b) => {
      if (b.visits !== a.visits) return b.visits - a.visits;
      return a.label.localeCompare(b.label, "zh");
    });
}

export async function queryUiUsageOverview(hours: 24 | 168, now = new Date()) {
  const window = buildMetricWindow(hours, now);
  const db = await getAuditDb();
  await ensureUiPageViews(db);
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS page_views,
      COUNT(DISTINCT admin_id) AS visitor_count,
      COUNT(DISTINCT menu_id) AS active_menu_count,
      SUM(CASE WHEN page_key = ? THEN 1 ELSE 0 END) AS unmapped_views
    FROM ui_page_views
    WHERE ts >= ? AND ts < ?
  `).get(UI_PAGE_VIEW_UNKNOWN, window.startIso, window.endIso) as {
    page_views: number;
    visitor_count: number;
    active_menu_count: number;
    unmapped_views: number | null;
  };

  const countRows = (column: "menu_id" | "group_id" | "page_key") => {
    const rows = db.prepare(`
      SELECT ${column} AS id, COUNT(*) AS visits
      FROM ui_page_views
      WHERE ts >= ? AND ts < ? AND ${column} IS NOT NULL AND page_key != ?
      GROUP BY ${column}
    `).all(window.startIso, window.endIso, UI_PAGE_VIEW_UNKNOWN) as Array<{ id: string; visits: number }>;
    return new Map(rows.map((row) => [row.id, row.visits]));
  };

  return {
    windowHours: hours,
    pageViews: totals.page_views ?? 0,
    visitorCount: totals.visitor_count ?? 0,
    activeMenuCount: totals.active_menu_count ?? 0,
    unmappedViews: totals.unmapped_views ?? 0,
    groups: rankByVisits(UI_USAGE_GROUPS, countRows("group_id")),
    menus: rankByVisits(UI_USAGE_MENUS, countRows("menu_id")),
    pages: rankByVisits(
      UI_USAGE_PAGES.map((page) => ({ id: page.pageKey, label: page.label })),
      countRows("page_key")
    )
  };
}

export function registerUiUsageRoutes(app: FastifyInstance): void {
  app.post<{ Body: { pathname?: unknown } }>("/api/admin/ui-usage/page-view", async (request, reply) => {
    const pathname = normalizeUsagePathname(request.body?.pathname);
    if (!pathname) {
      return reply.status(400).send({
        ok: false,
        error: { code: "UI_USAGE_PATH_INVALID", message: "无法记录这次页面打开" }
      });
    }
    const result = await recordUiPageView({
      pathname,
      adminId: actorIdFromRequest(request)
    });
    return { ok: true, data: result };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/ui-usage/overview", async (request) => {
    const hours = parseUsageHours(request.query.hours);
    const data = await queryUiUsageOverview(hours);
    return { ok: true, data };
  });
}
