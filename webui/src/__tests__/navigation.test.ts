// M59 Help Sidebar Entry Map — shared nav config invariants.
// Imports `topLevelEntry` / `navGroups` / `NavItem` from the production module
// so the 5+1 IA cannot drift without breaking these tests. Handbook §1.5 and
// `help-center.test.tsx` consume the same module.

import { describe, expect, it } from "vitest";
import { navGroups, topLevelEntry, type NavItem } from "../app/navigation";

describe("navigation (shared sidebar config)", () => {
  it("topLevelEntry matches Handbook §1.5 row 1", () => {
    expect(topLevelEntry.label).toBe("系统概览");
    expect(topLevelEntry.to).toBe("/overview");
    expect(topLevelEntry.active("/overview")).toBe(true);
    expect(topLevelEntry.active("/catalog")).toBe(false);
    expect(topLevelEntry.active("/connections")).toBe(false);
  });

  it("navGroups has exactly 5 first-level groups in canonical order", () => {
    expect(navGroups.length).toBe(5);
    const titles = navGroups.map((g) => g.title);
    expect(titles).toEqual(["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"]);
  });

  it("navGroups contains 13 second-level items in total", () => {
    const totalItems = navGroups.reduce((sum, g) => sum + g.items.length, 0);
    expect(totalItems).toBe(13);
  });

  it("flat sidebar entries match Handbook §1.5 rows 2–14 (13 entries)", () => {
    // 顶部 1 + 5 组共 13 项二级菜单 = 14 个侧栏可见入口
    const flat: Array<Pick<NavItem, "label" | "to"> & { group: string }> = [
      { group: topLevelEntry.label, label: topLevelEntry.label, to: topLevelEntry.to },
      ...navGroups.flatMap((g) =>
        g.items.map((item) => ({ group: g.title, label: item.label, to: item.to }))
      )
    ];
    expect(flat.length).toBe(14);

    // 顺序与 Handbook §1.5 表格自上而下严格一致（顶部 1 + 5 组 13 项）
    expect(flat).toEqual([
      { group: "系统概览", label: "系统概览", to: "/overview" },
      { group: "数据接入", label: "连接概览", to: "/connections" },
      { group: "数据接入", label: "启用表范围", to: "/connections/enabled-tables" },
      { group: "语义建模", label: "语义资产", to: "/catalog" },
      { group: "语义建模", label: "业务 Wiki", to: "/wiki" },
      { group: "语义发布", label: "发布工作台", to: "/publish/workbench" },
      { group: "语义发布", label: "发布记录", to: "/publish/history" },
      { group: "质量评测", label: "评测用例", to: "/eval/cases" },
      { group: "质量评测", label: "运行历史", to: "/eval/runs" },
      { group: "质量评测", label: "趋势监控", to: "/eval/monitor" },
      { group: "访问治理", label: "Agent 实例", to: "/admin/agents" },
      { group: "访问治理", label: "角色权限", to: "/admin/roles" },
      { group: "访问治理", label: "访问日志", to: "/admin/audit" },
      { group: "访问治理", label: "配置审计", to: "/admin/config-audit" }
    ]);
  });

  it("every path is unique across topLevelEntry + navGroups items", () => {
    const paths = [topLevelEntry.to, ...navGroups.flatMap((g) => g.items.map((i) => i.to))];
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("no navGroups item uses an obsolete 06-navigation-ia.md path", () => {
    const forbiddenPaths = ["/onboarding", "/connections/whitelist"];
    const allPaths = [topLevelEntry.to, ...navGroups.flatMap((g) => g.items.map((i) => i.to))];
    for (const path of forbiddenPaths) {
      expect(allPaths).not.toContain(path);
    }
  });
});