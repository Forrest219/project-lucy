import { getAuditDb } from "./audit.js";
import { lastForeignKeyCheckMs, openProxyAuditDb } from "../proxy/audit.js";

export type AuditWarmupResult = { totalMs: number; foreignKeyCheckMs: number };

/**
 * P1-39: 在 app.listen 之前依次打开审计库的两个连接（管理端 `getAuditDb`、代理端 `getDb`）。
 * 建表迁移与 `PRAGMA foreign_key_check` 因此不会在 onReady 钩子或首个请求里同步执行。
 * 失败直接抛出：审计库打不开时服务本来就不能提供审计写入，不假装就绪。
 */
export async function warmAuditDatabases(options: { since?: number } = {}): Promise<AuditWarmupResult> {
  // `since`：监听前第一批审计相关步骤的起点；打开与迁移常在更早的恢复步骤里就已发生。
  const startedAt = options.since ?? performance.now();
  await getAuditDb();
  await openProxyAuditDb();
  const totalMs = Math.round(performance.now() - startedAt);
  const foreignKeyCheckMs = Math.round(lastForeignKeyCheckMs());
  console.info(`[lucy-audit] schema ready in ${totalMs}ms (foreign_key_check ${foreignKeyCheckMs}ms)`);
  return { totalMs, foreignKeyCheckMs };
}
