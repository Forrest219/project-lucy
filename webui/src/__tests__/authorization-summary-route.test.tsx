/**
 * Lucy v0.25 P1-2 — 授权摘要独立路由的挂载契约（P3-11）。
 *
 * 之前 `pages/admin/AuthorizationSummary.tsx` 的文件注释宣称路由
 * `/admin/authorization-summary?kind=agent&id=<userId>` 存在，但 `app/App.tsx`
 * 从来没有挂它 —— 注释与实现不一致，而 P1-2 §4.2 的「链接各自摘要」也没有落点。
 *
 * 这个测试锁住两件事：
 *   1. 路由**已挂载**（URL 可达）；
 *   2. 路由**不进侧栏导航**（它是深链落点，不是导航入口 —— 导航由 P1-1 单独裁决）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const appSource = readFileSync(path.join(SRC_ROOT, "app/App.tsx"), "utf8");
const navigationSource = readFileSync(path.join(SRC_ROOT, "app/navigation.ts"), "utf8");
const pageSource = readFileSync(path.join(SRC_ROOT, "pages/admin/AuthorizationSummary.tsx"), "utf8");

describe("授权摘要独立路由（P3-11）", () => {
  it("App.tsx 注册了 /admin/authorization-summary", () => {
    expect(appSource).toContain('path="/admin/authorization-summary"');
    expect(appSource).toContain("pages/admin/AuthorizationSummary");
  });

  it("授权摘要不进侧栏导航", () => {
    expect(navigationSource).not.toContain("authorization-summary");
  });

  it("页面注释声明的路由与实际挂载的一致", () => {
    expect(pageSource).toContain("/admin/authorization-summary");
  });

  it("取数只有一处实现：页面复用 Section，不再自带 useQuery", () => {
    expect(pageSource).toContain("AuthorizationSummarySection");
    expect(pageSource).not.toMatch(/from\s+"@tanstack\/react-query"/);
    expect(pageSource).not.toMatch(/\bapiGet\b\s*[<(]/);
  });
});
