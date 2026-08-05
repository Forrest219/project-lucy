// M59 Help Sidebar Entry Map — shared nav config invariants.
// Imports `topLevelEntry` / `navGroups` / `NavItem` from the production module
// so the 5+1 IA cannot drift without breaking these tests. Handbook §1.5 and
// `help-center.test.tsx` consume the same module.
//
// M60 Sidebar Brand Navigation Polish: extended to cover stable `id` fields,
// per-item `iconKey` and the `findGroupIdForPathname` helper consumed by
// the collapsible sidebar + command palette.

import { describe, expect, it } from "vitest";
import {
  findGroupIdForPathname,
  navGroups,
  topLevelEntry,
  type NavIconKey,
  type NavItem
} from "../app/navigation";

describe("navigation (shared sidebar config)", () => {
  it("topLevelEntry matches Handbook §1.5 row 1", () => {
    expect(topLevelEntry.id).toBe("overview");
    expect(topLevelEntry.label).toBe("系统概览");
    expect(topLevelEntry.to).toBe("/overview");
    expect(topLevelEntry.iconKey).toBe("overview");
    expect(topLevelEntry.active("/overview")).toBe(true);
    expect(topLevelEntry.active("/catalog")).toBe(false);
    expect(topLevelEntry.active("/connections")).toBe(false);
  });

  it("navGroups has exactly 5 first-level groups in canonical order", () => {
    expect(navGroups.length).toBe(5);
    const titles = navGroups.map((g) => g.title);
    expect(titles).toEqual(["数据接入", "语义建模", "语义发布", "质量评测", "访问治理"]);
  });

  it("every group has a unique stable id", () => {
    const ids = navGroups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Spot-check the canonical ids; the AppFrame and command palette rely on these strings.
    expect(ids).toEqual(["connections", "semantic-modeling", "publish", "evaluation", "governance"]);
  });

  it("every nav item has a unique stable id across topLevelEntry + navGroups", () => {
    const ids = [topLevelEntry.id, ...navGroups.flatMap((g) => g.items.map((i) => i.id))];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every nav item declares an iconKey and the keys are unique per item", () => {
    const iconKeys: NavIconKey[] = [];
    const pushItem = (item: NavItem) => iconKeys.push(item.iconKey);
    pushItem(topLevelEntry);
    for (const group of navGroups) {
      for (const item of group.items) pushItem(item);
    }
    // No two items share the same icon (mapping icons 1:1 keeps the sidebar
    // scan-friendly; reused icons are visually fine but indicate drift in IA).
    expect(new Set(iconKeys).size).toBe(iconKeys.length);
  });

  it("navGroups contains 15 second-level items in total", () => {
    const totalItems = navGroups.reduce((sum, g) => sum + g.items.length, 0);
    expect(totalItems).toBe(15);
  });

  it("flat sidebar entries match Handbook §1.5 rows 2–16 (15 entries)", () => {
    // 顶部 1 + 5 组共 15 项二级菜单 = 16 个侧栏可见入口
    const flat: Array<Pick<NavItem, "id" | "label" | "to"> & { group: string }> = [
      { group: topLevelEntry.label, id: topLevelEntry.id, label: topLevelEntry.label, to: topLevelEntry.to },
      ...navGroups.flatMap((g) =>
        g.items.map((item) => ({ group: g.title, id: item.id, label: item.label, to: item.to }))
      )
    ];
    expect(flat.length).toBe(16);

    // 顺序与 Handbook §1.5 表格自上而下严格一致（顶部 1 + 5 组 15 项）
    expect(flat).toEqual([
      { group: "系统概览", id: "overview", label: "系统概览", to: "/overview" },
      { group: "数据接入", id: "connections-overview", label: "连接概览", to: "/connections" },
      { group: "数据接入", id: "connections-enabled-tables", label: "启用表范围", to: "/connections/enabled-tables" },
      { group: "语义建模", id: "semantic-catalog", label: "语义资产", to: "/catalog" },
      { group: "语义建模", id: "semantic-wiki", label: "业务 Wiki", to: "/wiki" },
      { group: "语义发布", id: "publish-workbench", label: "发布工作台", to: "/publish/workbench" },
      { group: "语义发布", id: "publish-history", label: "发布记录", to: "/publish/history" },
      { group: "质量评测", id: "eval-cases", label: "评测用例", to: "/eval/cases" },
      { group: "质量评测", id: "eval-runs", label: "运行历史", to: "/eval/runs" },
      { group: "质量评测", id: "eval-monitor", label: "趋势监控", to: "/eval/monitor" },
      { group: "质量评测", id: "eval-security-candidates", label: "安全候选", to: "/eval/security-candidates" },
      { group: "访问治理", id: "admin-governance", label: "使用概况", to: "/admin/governance" },
      { group: "访问治理", id: "admin-agents", label: "Agent 实例", to: "/admin/agents" },
      { group: "访问治理", id: "admin-roles", label: "角色权限", to: "/admin/roles" },
      { group: "访问治理", id: "admin-audit", label: "访问日志", to: "/admin/audit" },
      { group: "访问治理", id: "admin-config-audit", label: "配置审计", to: "/admin/config-audit" }
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

  // M70 command palette result context: every nav item must carry a non-empty
  // `description` so the command palette can render "page search result"
  // context (breadcrumb / title / description / route hint). Items without a
  // description would degrade back to the pre-M70 navigation-list look.
  it("every nav item has a non-empty description for command palette context", () => {
    const collectItem = (item: NavItem, _group: string) => {
      expect(typeof item.description).toBe("string");
      expect((item.description ?? "").trim().length).toBeGreaterThan(0);
    };
    collectItem(topLevelEntry, topLevelEntry.label);
    for (const group of navGroups) {
      for (const item of group.items) collectItem(item, group.title);
    }
  });

  // M70: keyword aliases help the user find a page by short terms that are
  // not part of the visible label (e.g. 指标, Role, Wiki). An empty string
  // in the keyword list would silently widen the search to everything.
  it("nav item keywords (when present) never contain an empty string", () => {
    const collectKeywords = (item: NavItem) => {
      if (item.keywords === undefined) return;
      expect(Array.isArray(item.keywords)).toBe(true);
      for (const kw of item.keywords) {
        expect(typeof kw).toBe("string");
        expect(kw.trim().length).toBeGreaterThan(0);
      }
    };
    collectKeywords(topLevelEntry);
    for (const group of navGroups) {
      for (const item of group.items) collectKeywords(item);
    }
  });

  // M70: descriptions live on a single line in the result row, so anything
  // longer than ~48 CJK glyphs / 96 ASCII chars creates layout shift. This
  // cap keeps every result row visually compact.
  it("nav item descriptions fit within the command palette single-line budget", () => {
    const DESCRIPTION_CHAR_BUDGET = 96;
    const collectLength = (item: NavItem, label: string) => {
      const value = item.description ?? "";
      // Count CJK glyphs as 2 units (display width) and ASCII as 1 unit so
      // we approximate the visual line length rather than the codepoint
      // length. The cap is permissive on purpose — only extreme cases fail.
      let width = 0;
      for (const ch of value) {
        width += /[\u3400-\u9fff\uf900-\ufaff]/.test(ch) ? 2 : 1;
      }
      expect(width, `description for "${label}" is too long`).toBeLessThanOrEqual(
        DESCRIPTION_CHAR_BUDGET
      );
    };
    collectLength(topLevelEntry, topLevelEntry.label);
    for (const group of navGroups) {
      for (const item of group.items) collectLength(item, item.label);
    }
  });

  describe("findGroupIdForPathname", () => {
    it("returns undefined for routes outside the sidebar IA", () => {
      expect(findGroupIdForPathname("/help")).toBeUndefined();
      expect(findGroupIdForPathname("/not-a-real-route")).toBeUndefined();
    });

    it("returns the owning group id for representative routes", () => {
      expect(findGroupIdForPathname("/connections")).toBe("connections");
      expect(findGroupIdForPathname("/connections/enabled-tables")).toBe("connections");
      // /connections/whitelist is a compat alias; should still resolve to the
      // canonical 数据接入 group so its members stay expanded on legacy URLs.
      expect(findGroupIdForPathname("/connections/whitelist")).toBe("connections");
      expect(findGroupIdForPathname("/catalog")).toBe("semantic-modeling");
      expect(findGroupIdForPathname("/catalog/foo/bar/baz")).toBe("semantic-modeling");
      expect(findGroupIdForPathname("/joins/foo/bar/baz")).toBe("semantic-modeling");
      expect(findGroupIdForPathname("/wiki")).toBe("semantic-modeling");
      expect(findGroupIdForPathname("/publish/workbench")).toBe("publish");
      expect(findGroupIdForPathname("/publish/history")).toBe("publish");
      expect(findGroupIdForPathname("/eval/cases")).toBe("evaluation");
      expect(findGroupIdForPathname("/eval/runs/abc")).toBe("evaluation");
      expect(findGroupIdForPathname("/eval/monitor")).toBe("evaluation");
      expect(findGroupIdForPathname("/admin/agents")).toBe("governance");
      expect(findGroupIdForPathname("/admin/roles")).toBe("governance");
      expect(findGroupIdForPathname("/admin/audit")).toBe("governance");
      expect(findGroupIdForPathname("/admin/config-audit")).toBe("governance");
    });
  });
});
