/**
 * P1-84 — 公共入口面分类与运行时证据（Spec §1.2／SC-07）。
 *
 * 分类只做标记，不替代任何既有钩子：`requireWebuiAuthHook` 的撤权、DRAINING、
 * `no-store` 与 CSRF 语义全部保持原顺序（Spec 交互合同豁免：不扩大 `isPublicApi`）。
 *
 * A 静态只读：`GET /`、首屏静态资产、`GET /api/branding`、`GET /api/branding/logo`。
 * B Session 感知读：`GET /api/auth/status`（禁止跨身份共享缓存）。
 * C 认证写入：`POST /api/auth/login` 等 auth 公开写入口（保留限流／scrypt／CSRF／审计）。
 *
 * SC-07：公开快路径对 MCP 上游发起、展示全量构建、重审计扫描三类重工作的触发次数
 * 必须为 0（无白名单例外）。计数经 AsyncLocalStorage 绑定到当前公开入口请求；
 * 三类重工作的调用点只在该上下文内才计数，后台／管理路径不计。
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type PublicEntrySurface = "A_static" | "B_session" | "C_auth_write" | "other";

export function classifyPublicEntrySurface(method: string, url: string): PublicEntrySurface {
  const pathOnly = url.split("?")[0] ?? url;
  const m = method.toUpperCase();
  if (m === "GET") {
    if (pathOnly === "/" || pathOnly.startsWith("/assets/")) return "A_static";
    if (pathOnly === "/api/branding" || pathOnly === "/api/branding/logo") return "A_static";
    if (pathOnly === "/api/auth/status") return "B_session";
  }
  if (m === "POST") {
    if (pathOnly === "/api/auth/login") return "C_auth_write";
    if (pathOnly === "/api/auth/bootstrap" || pathOnly === "/api/auth/oidc/start") return "C_auth_write";
  }
  return "other";
}

export type PublicEntryHeavyWorkCounters = {
  mcpUpstreamAttempts: number;
  displayFullBuilds: number;
  heavyAuditScans: number;
};

const counters: PublicEntryHeavyWorkCounters = {
  mcpUpstreamAttempts: 0,
  displayFullBuilds: 0,
  heavyAuditScans: 0
};

const publicEntryContext = new AsyncLocalStorage<boolean>();

/** 在公开入口请求的 A／B／C 处理期间标记上下文（SC-07 计数只在此上下文内累计）。 */
export function runAsPublicEntry<T>(fn: () => T): T {
  return publicEntryContext.run(true, fn);
}

export type PublicEntryHeavyWorkKind = keyof PublicEntryHeavyWorkCounters;

/** 重工作调用点探针：仅当调用栈处于公开入口请求上下文时计数。 */
export function notePublicEntryHeavyWork(kind: PublicEntryHeavyWorkKind): void {
  if (publicEntryContext.getStore() === true) counters[kind] += 1;
}

export function publicEntryHeavyWorkCounters(): PublicEntryHeavyWorkCounters {
  return { ...counters };
}

export function resetPublicEntryHeavyWorkCountersForTests(): void {
  counters.mcpUpstreamAttempts = 0;
  counters.displayFullBuilds = 0;
  counters.heavyAuditScans = 0;
}
