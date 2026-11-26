import { describe, expect, it, beforeEach } from "vitest";
import {
  classifyPublicEntrySurface,
  notePublicEntryHeavyWork,
  publicEntryHeavyWorkCounters,
  resetPublicEntryHeavyWorkCountersForTests,
  runAsPublicEntry
} from "../public-entry-surface.js";
import { isPublicApi } from "../auth/guard.js";

describe("classifyPublicEntrySurface（P1-84 §1.2 三类边界）", () => {
  it("A 静态只读：首页、首屏资产、branding", () => {
    expect(classifyPublicEntrySurface("GET", "/")).toBe("A_static");
    expect(classifyPublicEntrySurface("GET", "/assets/index-abc12345.js")).toBe("A_static");
    expect(classifyPublicEntrySurface("GET", "/assets/index-COoS8r-D.css")).toBe("A_static");
    expect(classifyPublicEntrySurface("GET", "/api/branding")).toBe("A_static");
    expect(classifyPublicEntrySurface("GET", "/api/branding/logo?v=1")).toBe("A_static");
  });

  it("B Session 感知读：auth/status", () => {
    expect(classifyPublicEntrySurface("GET", "/api/auth/status")).toBe("B_session");
  });

  it("C 认证写入：login／bootstrap／oidc start", () => {
    expect(classifyPublicEntrySurface("POST", "/api/auth/login")).toBe("C_auth_write");
    expect(classifyPublicEntrySurface("POST", "/api/auth/bootstrap")).toBe("C_auth_write");
    expect(classifyPublicEntrySurface("POST", "/api/auth/oidc/start")).toBe("C_auth_write");
  });

  it("非目标受保护 API 与其他路径为 other", () => {
    expect(classifyPublicEntrySurface("GET", "/api/sources")).toBe("other");
    expect(classifyPublicEntrySurface("GET", "/api/admin/audit")).toBe("other");
    expect(classifyPublicEntrySurface("POST", "/api/sources")).toBe("other");
    expect(classifyPublicEntrySurface("PUT", "/api/branding")).toBe("other");
    expect(classifyPublicEntrySurface("DELETE", "/api/branding/logo")).toBe("other");
    expect(classifyPublicEntrySurface("GET", "/api/auth/login")).toBe("other");
    expect(classifyPublicEntrySurface("POST", "/api/auth/status")).toBe("other");
    expect(classifyPublicEntrySurface("GET", "/api/help/index")).toBe("other");
    expect(classifyPublicEntrySurface("GET", "/api/livez")).toBe("other");
  });

  it("分类集合 ⊆ isPublicApi（不扩大白名单；A/B/C 公开路径必须已是公开 API）", () => {
    const publicEntries: Array<[string, string]> = [
      ["GET", "/"],
      ["GET", "/assets/index-abc12345.js"],
      ["GET", "/api/branding"],
      ["GET", "/api/branding/logo"],
      ["GET", "/api/auth/status"],
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/bootstrap"],
      ["POST", "/api/auth/oidc/start"]
    ];
    for (const [method, url] of publicEntries) {
      // `/` 与 `/assets/*` 非 /api/ 路径，isPublicApi 对其恒为 true。
      expect(isPublicApi(method, url), `${method} ${url}`).toBe(true);
    }
  });
});

describe("SC-07 公开快路径重工作计数", () => {
  beforeEach(() => resetPublicEntryHeavyWorkCountersForTests());

  it("公开入口上下文内触发才计数；上下文外不计数", () => {
    runAsPublicEntry(() => {
      notePublicEntryHeavyWork("mcpUpstreamAttempts");
      notePublicEntryHeavyWork("displayFullBuilds");
      notePublicEntryHeavyWork("heavyAuditScans");
    });
    expect(publicEntryHeavyWorkCounters()).toEqual({
      mcpUpstreamAttempts: 1,
      displayFullBuilds: 1,
      heavyAuditScans: 1
    });

    notePublicEntryHeavyWork("mcpUpstreamAttempts");
    notePublicEntryHeavyWork("displayFullBuilds");
    notePublicEntryHeavyWork("heavyAuditScans");
    expect(publicEntryHeavyWorkCounters()).toEqual({
      mcpUpstreamAttempts: 1,
      displayFullBuilds: 1,
      heavyAuditScans: 1
    });
  });

  it("异步边界保持上下文（await 后仍在公开入口请求内）", async () => {
    await runAsPublicEntry(async () => {
      await Promise.resolve();
      notePublicEntryHeavyWork("displayFullBuilds");
    });
    expect(publicEntryHeavyWorkCounters().displayFullBuilds).toBe(1);
  });
});
