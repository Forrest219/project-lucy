#!/usr/bin/env node
/**
 * P1-37 M1–M6 取数脚本：对容器里的审计库（只读）按口径算指标，输出 JSON。
 *
 *   node scripts/uat/mcp-ux-metrics.mjs [--container lucy-uat-wide] [--since-id N] [--user ID] [--since-ts ISO]
 *
 * 口径写在 scripts/uat/lib/mcp-ux-metrics.mjs 头部（与 Spec §5 一致）。
 * 默认容器取沙箱，其次 compose-lucy-1。不改库、不导出明文凭据。
 */
import { auditQuery } from "./lib/mcp-uat-lib.mjs";
import { computeMetrics } from "./lib/mcp-ux-metrics.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };

const container = flag("container", process.env.UAT_WIDE_CONTAINER ?? "lucy-uat-wide");
const clauses = ["id > ?"];
const params = [Number(flag("since-id", 0))];
if (flag("user")) { clauses.push("user_id = ?"); params.push(flag("user")); }
if (flag("since-ts")) { clauses.push("ts >= ?"); params.push(flag("since-ts")); }
const rows = auditQuery(container, `SELECT id, ts, user_id, lucy_session_id, tool, outcome, duration_ms, decision_reason, error_category, rejection_fingerprint, derivation_version FROM access_log WHERE ${clauses.join(" AND ")} ORDER BY id`, params);
console.log(JSON.stringify({ container, rows: rows.length, filter: { sinceId: params[0], user: flag("user") ?? null, sinceTs: flag("since-ts") ?? null }, metrics: computeMetrics(rows) }));
