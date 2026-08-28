// Single source of truth for the WebUI sidebar IA. Help Center §1.5 (Handbook) and
// `webui/src/__tests__/navigation.test.ts` both import from this module so the
// 6+1 structure cannot drift without breaking the test.
//
// Extracted in M59 to satisfy Help Sidebar Entry Map spec v0.2 §4.1.
// M60 Sidebar Brand Navigation Polish: added stable `id` fields + `iconKey`
// so the AppFrame can render lucide-react icons without forcing this module
// to import React. Do not import React here; this module must remain a pure
// data + type module.
//
// M70 command palette result context: added optional `description` + `keywords`
// on every nav item so the command palette can render page-search-result
// context (breadcrumb / title / description / route hint) and rank matches by
// label vs keyword vs description vs group vs route.

export type NavItem = {
  /** Stable id used for collapsible group state, command palette keys and tests. */
  id: string;
  label: string;
  to: string;
  /** Lucide icon name. Resolved by AppFrame via a static icon registry. */
  iconKey: NavIconKey;
  active: (pathname: string) => boolean;
  /**
   * One-sentence, user-facing description of what the page does. Rendered
   * as the secondary line of a command palette result so users understand
   * what they'll see after clicking. Keep within ~48 CJK glyphs / 96 ASCII
   * chars so the result row stays a single line.
   */
  description?: string;
  /**
   * Short aliases that don't appear in `label` but a user might search for
   * (e.g. 指标, Role, Wiki). Never include empty strings.
   */
  keywords?: string[];
};

export type NavIconKey =
  | "overview"
  | "connections"
  | "whitelist"
  | "catalog"
  | "wiki"
  | "publish"
  | "history"
  | "evalCases"
  | "evalRuns"
  | "monitor"
  | "securityEval"
  | "governanceOverview"
  | "agents"
  | "tokens"
  | "roles"
  | "audit"
  | "mcpPlayground"
  | "configAudit"
  | "admins"
  | "branding"
  | "license";

export const topLevelEntry: NavItem = {
  id: "overview",
  label: "系统概览",
  to: "/overview",
  iconKey: "overview",
  active: (path) => path === "/overview",
  description: "查看 Lucy MCP、KTX Runtime、语义资产和 Agent 接入状态，集中处理异常与待办。",
  keywords: ["控制台", "Dashboard", "健康", "巡检"]
};

export const navGroups: Array<{
  /** Stable id used for collapsible group state and command palette keys. */
  id: string;
  title: string;
  items: NavItem[];
}> = [
  {
    id: "connections",
    title: "数据接入",
    items: [
      {
        id: "connections-overview",
        label: "连接概览",
        to: "/connections",
        iconKey: "connections",
        active: (path) => path === "/connections",
        description: "管理数据库连接、Schema 与 Schema Manifest，并查看连通性和本地目录同步状态。",
        keywords: ["Connection", "Schema", "Manifest"]
      },
      {
        id: "connections-enabled-tables",
        label: "启用表范围",
        to: "/connections/enabled-tables",
        iconKey: "whitelist",
        active: (path) => path === "/connections/enabled-tables" || path === "/connections/whitelist",
        description: "配置各连接进入语义层的表范围，并审阅保存前变更。",
        keywords: ["白名单", "Whitelist", "Schema", "Table"]
      }
      // v1.9.0: 连通测试（兼容）从主导航移除；连接卡内测试 Drawer（M25）成为唯一入口。
      // /connections/test 路由继续保留为兼容跳转页（见下方 <Route>），保留外链与历史书签。
    ]
  },
  {
    id: "semantic-modeling",
    title: "语义建模",
    items: [
      {
        id: "semantic-catalog",
        label: "语义资产",
        to: "/catalog",
        iconKey: "catalog",
        active: (path) =>
          path === "/" ||
          path === "/catalog" ||
          path.startsWith("/catalog/") ||
          path.startsWith("/sources/") ||
          path.startsWith("/joins/"),
        description: "管理表、字段、指标、分群与关联等结构化语义资产。",
        keywords: ["指标", "字段", "分群", "Catalog", "Metric"]
      },
      {
        id: "semantic-wiki",
        label: "业务 Wiki",
        to: "/wiki",
        iconKey: "wiki",
        active: (path) => path === "/wiki",
        description: "管理业务口径、指标说明与分析指引等业务文档。",
        keywords: ["文档", "Markdown", "Wiki"]
      }
    ]
  },
  {
    id: "publish",
    title: "语义发布",
    items: [
      {
        id: "publish-workbench",
        label: "发布工作台",
        to: "/publish/workbench",
        iconKey: "publish",
        active: (path) => path.startsWith("/publish/workbench"),
        description: "审阅并校验语义与 Wiki 变更，同步索引后使其对 Agent 生效。",
        keywords: ["Workbench", "校验", "导出"]
      },
      {
        id: "publish-history",
        label: "发布记录",
        to: "/publish/history",
        iconKey: "history",
        active: (path) => path.startsWith("/publish/history"),
        description: "查看历次语义发布的变更范围、执行结果与操作记录。",
        keywords: ["历史", "归档", "交付"]
      }
    ]
  },
  {
    id: "evaluation",
    title: "质量评测",
    items: [
      {
        id: "eval-cases",
        label: "评测用例",
        to: "/eval/cases",
        iconKey: "evalCases",
        active: (path) => path.startsWith("/eval/cases"),
        description: "管理数据问答与语义质量的评测用例及预期结果。",
        keywords: ["Case", "YAML"]
      },
      {
        id: "eval-runs",
        label: "运行历史",
        to: "/eval/runs",
        iconKey: "evalRuns",
        active: (path) => path.startsWith("/eval/runs"),
        description: "查看评测运行记录、通过率、结果明细与失败诊断。",
        keywords: ["Run", "失败", "诊断"]
      },
      {
        id: "eval-monitor",
        label: "趋势监控",
        to: "/eval/monitor",
        iconKey: "monitor",
        active: (path) => path === "/eval/monitor",
        description: "监控评测通过率、失败集中度与质量漂移趋势。",
        keywords: ["Monitor", "趋势", "基线"]
      },
      {
        id: "eval-security-candidates",
        label: "安全评测候选",
        to: "/eval/security-candidates",
        iconKey: "securityEval",
        active: (path) => path === "/eval/security-candidates",
        description: "从访问拒绝日志中提取权限与数据隔离场景，审定后转为安全评测用例。",
        keywords: ["Security Eval", "权限", "候选"]
      }
    ]
  },
  {
    id: "governance",
    title: "访问治理",
    items: [
      {
        id: "admin-governance",
        label: "使用概况",
        to: "/admin/usage",
        iconKey: "governanceOverview",
        active: (path) => path === "/admin/usage" || path === "/admin/governance",
        description: "查看 Agent、Token 和数据表的活跃度、调用量与响应耗时。",
        keywords: ["Governance", "Dashboard", "使用概况"]
      },
      {
        id: "admin-agents",
        label: "Agent",
        to: "/admin/agents",
        iconKey: "agents",
        active: (path) => path.startsWith("/admin/agents"),
        description: "管理 Agent 身份、角色、Token 及数据访问边界。",
        keywords: ["Agent", "Token", "访问"]
      },
      {
        id: "admin-tokens",
        label: "Token 凭据",
        to: "/admin/tokens",
        iconKey: "tokens",
        active: (path) => path === "/admin/tokens" || path.startsWith("/admin/tokens/"),
        description: "全局查看、签发与定向吊销 Agent 访问凭据。",
        keywords: ["Token", "凭据", "Secret", "Key", "API Key"]
      },
      {
        id: "admin-roles",
        label: "角色权限",
        to: "/admin/roles",
        iconKey: "roles",
        active: (path) => path.startsWith("/admin/roles"),
        description: "管理角色的数据库连接、数据表与 MCP 工具授权范围。",
        keywords: ["Role", "权限", "MCP 工具"]
      },
      {
        id: "admin-audit",
        label: "访问日志",
        to: "/admin/audit",
        iconKey: "audit",
        active: (path) => path === "/admin/audit" || path.startsWith("/admin/audit/"),
        description: "按问询和工具调用追溯 Agent 访问行为、权限裁决与执行耗时。",
        keywords: ["ACL", "审计", "日志"]
      },
      {
        id: "admin-mcp-playground",
        label: "MCP 调试台",
        to: "/admin/mcp-playground",
        iconKey: "mcpPlayground",
        active: (path) => path === "/admin/mcp-playground" || path.startsWith("/admin/mcp-playground"),
        description: "预览 Agent 的 MCP 工具权限裁决，并执行受控接入试调。",
        keywords: ["MCP", "Playground", "ACL", "调试"]
      },
      {
        id: "admin-config-audit",
        label: "配置审计",
        to: "/admin/config-audit",
        iconKey: "configAudit",
        active: (path) => path === "/admin/config-audit",
        description: "查看各类配置与内容资产的写入记录、变更内容和操作者。",
        keywords: ["配置变更", "影响", "治理"]
      }
    ]
  },
  {
    id: "system-settings",
    title: "系统设置",
    items: [
      {
        id: "admin-license",
        label: "部署许可",
        to: "/admin/license",
        iconKey: "license",
        active: (path) => path === "/admin/license" || path.startsWith("/admin/license/"),
        description: "输入激活码，管理本实例的 Agent 席位与部署许可有效期。",
        keywords: ["激活码", "License", "席位", "付费"]
      },
      {
        id: "admin-branding",
        label: "品牌外观",
        to: "/admin/branding",
        iconKey: "branding",
        active: (path) => path === "/admin/branding" || path.startsWith("/admin/branding/"),
        description: "配置客户 Logo、产品名称与品牌副标题。",
        keywords: ["Logo", "品牌", "外观"]
      },
      {
        id: "admin-accounts",
        label: "登录账户",
        to: "/admin/admins",
        iconKey: "admins",
        active: (path) => path === "/admin/admins" || path.startsWith("/admin/admins/"),
        description: "管理 WebUI 登录账户，并配置所有者或运维角色。",
        keywords: ["登录", "Owner", "运维", "管理员账户"]
      }
    ]
  }
];

/**
 * Find the canonical sidebar group id that owns a given pathname. Used by
 * `AppFrame` to auto-expand the group that contains the active route so
 * users never get stranded with an empty collapsed section. Returns
 * `undefined` when the pathname doesn't belong to any sidebar group (e.g.
 * `/help`, `/onboarding` redirect target, or unknown paths).
 */
export function findGroupIdForPathname(pathname: string): string | undefined {
  for (const group of navGroups) {
    for (const item of group.items) {
      if (item.active(pathname)) return group.id;
    }
  }
  return undefined;
}
