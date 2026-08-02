// Single source of truth for the WebUI sidebar IA. Help Center §1.5 (Handbook) and
// `webui/src/__tests__/navigation.test.ts` both import from this module so the
// 5+1 structure cannot drift without breaking the test.
//
// Extracted in M59 to satisfy Help Sidebar Entry Map spec v0.2 §4.1.
// Do not import React here; this module must remain a pure data + type module.

export type NavItem = {
  label: string;
  to: string;
  active: (pathname: string) => boolean;
};

export const topLevelEntry: NavItem = {
  label: "系统概览",
  to: "/overview",
  active: (path) => path === "/overview"
};

export const navGroups: Array<{ title: string; items: NavItem[] }> = [
  {
    title: "数据接入",
    items: [
      { label: "连接概览", to: "/connections", active: (path) => path === "/connections" },
      {
        label: "启用表范围",
        to: "/connections/enabled-tables",
        active: (path) => path === "/connections/enabled-tables" || path === "/connections/whitelist"
      }
      // v1.9.0: 连通测试（兼容）从主导航移除；连接卡内测试 Drawer（M25）成为唯一入口。
      // /connections/test 路由继续保留为兼容跳转页（见下方 <Route>），保留外链与历史书签。
    ]
  },
  {
    title: "语义建模",
    items: [
      {
        label: "语义资产",
        to: "/catalog",
        active: (path) =>
          path === "/" ||
          path === "/catalog" ||
          path.startsWith("/catalog/") ||
          path.startsWith("/sources/") ||
          path.startsWith("/joins/")
      },
      {
        label: "业务 Wiki",
        to: "/wiki",
        active: (path) => path === "/wiki"
      }
    ]
  },
  {
    title: "语义发布",
    items: [
      { label: "发布工作台", to: "/publish/workbench", active: (path) => path.startsWith("/publish/workbench") },
      { label: "发布记录", to: "/publish/history", active: (path) => path.startsWith("/publish/history") }
    ]
  },
  {
    title: "质量评测",
    items: [
      { label: "评测用例", to: "/eval/cases", active: (path) => path.startsWith("/eval/cases") },
      { label: "运行历史", to: "/eval/runs", active: (path) => path.startsWith("/eval/runs") },
      { label: "趋势监控", to: "/eval/monitor", active: (path) => path === "/eval/monitor" }
    ]
  },
  {
    title: "访问治理",
    items: [
      { label: "Agent 实例", to: "/admin/agents", active: (path) => path.startsWith("/admin/agents") },
      { label: "角色权限", to: "/admin/roles", active: (path) => path.startsWith("/admin/roles") },
      { label: "访问日志", to: "/admin/audit", active: (path) => path === "/admin/audit" || path.startsWith("/admin/audit/") },
      { label: "配置审计", to: "/admin/config-audit", active: (path) => path === "/admin/config-audit" }
    ]
  }
];
