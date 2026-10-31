import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { navGroups } from "../app/navigation";
import {
  datetimeViolation,
  errorTextViolations,
  forbiddenPrimaryLabels,
  h1Violation
} from "../../tests/release-ux/invariants";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("release UX structure invariants", () => {
  it("fails a page that shows Failed to fetch or a stack frame", () => {
    expect(errorTextViolations("加载失败 Failed to fetch")).toContain("Failed to fetch");
    expect(errorTextViolations("at renderPage (src/app/App.tsx:10:5)")).toContain("stack frame");
    expect(errorTextViolations("没有可显示的记录")).toEqual([]);
  });

  it("fails forbidden primary labels and allows supplementary phrasing", () => {
    expect(forbiddenPrimaryLabels(["Role", "数据能力预览", "constraints", "Token 凭证"])).toEqual([
      "Role",
      "数据能力预览",
      "constraints",
      "Token 凭证"
    ]);
    expect(forbiddenPrimaryLabels(["Data Capability Preview"])).toEqual(["Data Capability Preview"]);
    expect(forbiddenPrimaryLabels(["角色权限 Role", "数据能力", "个人行限制 constraints"])).toEqual([]);
    expect(forbiddenPrimaryLabels(["source·conn"])).toEqual(["source·conn"]);
  });

  it("fails an empty end datetime only when a preset is selected and start is filled", () => {
    expect(datetimeViolation({ presetSelected: true, start: "2026-10-30T00:00", end: "" })).toMatch(/end is empty/);
    expect(datetimeViolation({ presetSelected: true, start: "2026-10-30T00:00", end: "2026-10-30T01:00" })).toBeNull();
    expect(datetimeViolation({ presetSelected: false, start: "2026-10-30T00:00", end: "" })).toBeNull();
    expect(datetimeViolation(null)).toBeNull();
  });

  it("requires one h1, matching the sidebar label except on help", () => {
    expect(h1Violation(["连接概览"], "连接概览")).toBeNull();
    expect(h1Violation(["连接"], "连接概览")).toMatch(/does not match/);
    expect(h1Violation(["系统手册"], null)).toBeNull();
    expect(h1Violation([], null)).toMatch(/one h1/);
  });
});

describe("release UX suite boundary", () => {
  it("keeps the structure suite out of the default Playwright config", () => {
    const contract = readFileSync(path.join(repoRoot, "webui/playwright.config.ts"), "utf8");
    const release = readFileSync(path.join(repoRoot, "webui/playwright.release-ux.config.ts"), "utf8");
    expect(contract).toContain('testDir: "./tests/e2e/specs"');
    expect(contract).not.toContain("tests/release-ux");
    expect(release).toContain('testDir: "./tests/release-ux"');
    expect(release).toContain("width: 1920, height: 1080");
    expect(release.match(/name: "chromium"/g)).toHaveLength(1);
    expect(release).not.toContain("chromium-narrow");
    expect(release).not.toContain("webkit");
  });

  it("registers e2e:release-ux without changing the contract or smoke commands", () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, "webui/package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["e2e:release-ux"]).toContain("playwright.release-ux.config.ts");
    expect(pkg.scripts["e2e:contract:release"]).toBe("playwright test");
    expect(pkg.scripts["e2e:smoke"]).toContain("@pr-smoke");
    const gates = readFileSync(path.join(repoRoot, "docs/governance/test-layers-and-release-gates.md"), "utf8");
    expect(gates).toContain("e2e:release-ux");
    expect(gates).toContain("不是 PR 阻塞项");
    expect(gates).toContain("不签发客户发布");
  });
});

describe("release UX checklist coverage", () => {
  const runbook = readFileSync(path.join(repoRoot, "docs/runbooks/webui-release-ux-checklist.md"), "utf8");
  const uxReadme = readFileSync(path.join(repoRoot, "docs/releases/ux/README.md"), "utf8");

  it("lists every sidebar route and the four representative editors", () => {
    for (const item of navGroups.flatMap((group) => group.items)) {
      expect(runbook, item.to).toContain(`\`${item.to}\``);
    }
    expect(runbook).toContain("`/help`");
    expect(runbook).toContain("`/catalog/:conn/:schema/:table`");
    expect(runbook).toContain("一篇文档");
    expect(runbook).toContain("`/admin/agents/:userId`");
    expect(runbook).toContain("`/admin/roles/:roleId`");
  });

  it("keeps UX-R01–UX-R12 distinct from the customer journey ids", () => {
    for (let n = 1; n <= 12; n += 1) {
      expect(runbook).toContain(`UX-R${String(n).padStart(2, "0")}`);
    }
    expect(runbook).toContain("UX-01 到 UX-07");
    expect(uxReadme).toContain("result: passed");
    expect(uxReadme).toContain("reasonClass: none");
    expect(uxReadme).toContain("workspaceDirty: false");
    expect(uxReadme).toContain("structure: green");
    expect(uxReadme).toContain("instance-not-ready");
    expect(uxReadme).toContain("structure-blocked");
    expect(uxReadme).toContain("walk-blocked");
  });

  it("points the design-system governance doc at the release spec", () => {
    const governance = readFileSync(
      path.join(repoRoot, "webui/docs/design-system/99-governance.md"),
      "utf8"
    );
    expect(governance).toContain("lucy-20261030-webui-release-ux-review-spec.md");
    expect(governance).toContain("不新增视觉模式");
    expect(governance).toContain("Design System Compliance");
  });

  it("does not require a second row when the representative editor notes the change", () => {
    const missing = uncoveredChangedEditors([
      { id: "catalog-table", coveredByRepresentative: true },
      { id: "role-detail", coveredByRepresentative: false }
    ]);
    expect(missing).toEqual(["role-detail"]);
    expect(uncoveredChangedEditors([{ id: "catalog-table", coveredByRepresentative: true }])).toEqual([]);
  });
});

function uncoveredChangedEditors(editors: Array<{ id: string; coveredByRepresentative: boolean }>): string[] {
  return editors.filter((editor) => !editor.coveredByRepresentative).map((editor) => editor.id);
}
