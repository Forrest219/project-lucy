// @vitest-environment node
//
// Smoke test for the translation-defense scanner. We don't try to re-run the
// whole `lint-terminology` CLI here — that's covered by `pretest` in CI and
// by the `lint:terminology` script. We just guard a few corner cases so a
// future refactor of the JSX scanner (findOpeningTagEnd / findMatchingClose)
// can't silently regress.
//
// The test does not write to the filesystem; it shells out to the script
// against a tiny inline fixture. This is fast and self-contained.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../lib/queryKeys";
import type {
  WikiBatchAccessAction,
  WikiUploadAccessSelection
} from "../lib/types";

function runLint(targetDir: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      "node",
      [path.resolve("scripts/lint-terminology.mjs")],
      {
        cwd: path.resolve("."),
        env: { ...process.env, LINT_TARGET_DIR: targetDir },
        stdio: ["ignore", "pipe", "pipe"]
      }
    ).toString();
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer; stderr?: Buffer };
    return {
      code: e.status ?? 1,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? ""
    };
  }
}

function makeFixture(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "lint-term-"));
  mkdirSync(path.join(dir, "src"), { recursive: true });
  // Fully defended element passes the lint.
  writeFileSync(
    path.join(dir, "src/Defended.tsx"),
    `<p className="pl-notice notranslate" translate="no">Schema Manifest</p>;`
  );
  // Undefended element fails the lint.
  writeFileSync(
    path.join(dir, "src/Undefended.tsx"),
    `<p className="pl-notice">Schema Manifest</p>;`
  );
  return dir;
}

describe("lint-terminology.mjs translation-defense scanner", () => {
  it("flags a JSX element that renders a high-risk term without defense", () => {
    const dir = makeFixture();
    try {
      const result = runLint(path.join(dir, "src"));
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/Undefended\.tsx/);
      expect(result.stderr).toMatch(/translate="no"/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("passes when every high-risk term node has translate=\"no\" and notranslate", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lint-term-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "src/Clean.tsx"),
      [
        `<p className="pl-notice notranslate" translate="no">Schema Manifest</p>;`,
        `<code className="notranslate" translate="no">.yaml</code>;`,
        `<span>未触发任何术语</span>;`
      ].join("\n")
    );
    try {
      const result = runLint(path.join(dir, "src"));
      expect(result.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects one-sided translation defense", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lint-term-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "src/Partial.tsx"),
      [
        `<p className="pl-notice" translate="no">Schema Manifest</p>;`,
        `<code className="notranslate">.yaml</code>;`
      ].join("\n")
    );
    try {
      const result = runLint(path.join(dir, "src"));
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/both translate="no" and notranslate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("audits user-facing title, aria-label, and placeholder attributes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lint-term-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "src/Attributes.tsx"),
      [
        `<button title="重新读取 ktx.yaml">刷新</button>;`,
        `<input placeholder="按 schema 筛选" />;`,
        `<section aria-label="Schema Manifest">x</section>;`
      ].join("\n")
    );
    try {
      const result = runLint(path.join(dir, "src"));
      expect(result.code).toBe(1);
      expect(result.stderr).toMatch(/Attributes\.tsx/);
      expect(result.stderr).toMatch(/ktx.yaml/);
      expect(result.stderr).toMatch(/schema/);
      expect(result.stderr).toMatch(/Schema/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores wrapper containers with no direct text (children only)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "lint-term-"));
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "src/Container.tsx"),
      `<div className="pl-drawer-panel">\n  <p>hi</p>\n</div>;`
    );
    try {
      const result = runLint(path.join(dir, "src"));
      expect(result.code).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Spec 193 §18.1 / Plan M66 Task 1 — the five UI terms registered by the
 * business Wiki access management feature must exist in the terminology
 * standard before the implementation lands, and the shared frontend contracts
 * must be available to every consumer.
 */
describe("Spec 193 registered terminology and shared contracts", () => {
  const standard = readFileSync(
    path.resolve("docs/00-product-terminology-standard.md"),
    "utf8"
  );

  it("registers the five Spec 193 terms with their forbidden wording", () => {
    const expected: Array<[string, string]> = [
      ["Manage Access", "管理访问权限"],
      ["Manage Access in Bulk", "批量管理权限"],
      ["Add Roles", "添加角色"],
      ["Replace Accessible Roles", "替换可访问角色"],
      ["Wiki Channel Missing", "缺少 Wiki 访问通道"]
    ];
    for (const [canonical, primary] of expected) {
      expect(standard).toContain(canonical);
      expect(standard).toContain(primary);
    }
    // The forbidden wording of every registered term must be present in the
    // standard so a future rename cannot silently reintroduce it.
    expect(standard).toContain("权限编辑、开放文档");
    expect(standard).toContain("目录授权、继承授权");
    expect(standard).toContain("合并权限");
    expect(standard).toContain("覆盖目录权限");
    expect(standard).toContain("Agent 无权限");
  });

  it("exposes the upload access selection contract", () => {
    const selections: WikiUploadAccessSelection[] = [
      { mode: "preserve_current" },
      { mode: "use_uploaded" },
      { mode: "set", allowed_roles: ["finance"] }
    ];
    expect(selections.map((item) => item.mode)).toEqual([
      "preserve_current",
      "use_uploaded",
      "set"
    ]);
  });

  it("exposes the bulk access action contract", () => {
    const actions: WikiBatchAccessAction[] = [
      { mode: "add", role_ids: ["finance"] },
      { mode: "replace", allowed_roles: [] }
    ];
    expect(actions.map((item) => item.mode)).toEqual(["add", "replace"]);
  });

  it("provides query keys for the single access summary and the batch result", () => {
    expect(queryKeys.wikiAccess("global/a.md")).toEqual(["wiki", "access", "global/a.md"]);
    expect(queryKeys.wikiBatchAccess("op-1")).toEqual(["wiki", "access", "batch", "op-1"]);
    // The aggregate list keeps its own key; the access-aware list is not a
    // second query that could disagree with it.
    expect(queryKeys.wiki).toEqual(["wiki"]);
  });
});
