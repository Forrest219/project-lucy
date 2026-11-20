/** Shared synchronous read-only SQL; independent of routes, auth and publishers. */
import type { getAuditDb } from "./audit.js";
import type { YamlUser } from "./access-config.js";
import { build7dWindow } from "./metric-window.js";
import { isTokenExpired } from "../proxy/token-expiry.js";
import { presentStoredClient } from "../proxy/request-client-meta.js";
import { protocolConditionSql, defaultUsageConditionSql, evalProbeConditionSql } from "../proxy/usage-classification.js";
const PROTOCOL_CONDITION = protocolConditionSql().sql;
const DEFAULT_USAGE_CONDITION = defaultUsageConditionSql().sql;
const EVAL_PROBE_CONDITION = evalProbeConditionSql().sql;
export interface AgentStatsSummary {
  /** Spec 128 HR-1: null when state=unavailable; UI must not coerce to 0. */
  callsLast7d: number | null;
  /** Non-protocol calls in the window; drives business activity. */
  businessCallsLast7d: number | null;
  /** initialize / notifications/initialized / tools/list rows in the window. */
  protocolCallsLast7d: number | null;
  /**
   * Spec 189 §5.2 — Default Usage Calls in the window: business calls minus
   * the default-view-excluded eval probes. This is the metric the new UI
   * reads for business activity and business call volume.
   */
  usageCallsLast7d: number | null;
  /**
   * Spec 189 §5.2 — eval probes excluded from the default usage view. Kept
   * for reconciliation: `businessCallsLast7d = usageCallsLast7d + evalProbeCallsLast7d`.
   */
  evalProbeCallsLast7d: number | null;
  /** Spec 128 HR-1: null when state=unavailable. */
  deniedLast7d: number | null;
  lastSeen?: string;
  /** All-time latest default-usage business call. */
  lastBusinessSeen?: string;
  /** Number of distinct `token_hash_prefix` values that appear in
   * `access_log` for this user inside the last 7 days. Excludes rows
   * where `token_hash_prefix` is null (uncorrelated protocol traffic).
   * Spec 128 HR-1: null when state=unavailable. */
  activeTokensLast7d: number | null;
  /** Semantically explicit alias for activeTokensLast7d. */
  usedCredentialsLast7d: number | null;
  /** Number of token rows still present in `access.yaml` (configured
   * regardless of expiry). */
  configuredTokens: number;
  /** Current configured tokens that can authenticate now. */
  availableTokens: number;
  credentialMetricsState: "ok" | "partial" | "unavailable";
  credentialMetricsReason?: "token_prefix_collision" | "audit_unavailable";
  topTables: Array<{ table: string; calls: number }>;
  /** Spec 128 §3.1 — ok when queries succeeded, unavailable on DB failure. */
  metricsState: "ok" | "unavailable";
  /** ISO 8601 — window start used for these stats. */
  windowStart: string;
  /** ISO 8601 — window end (= asOf). */
  windowEnd: string;
}


/** Spec 128 Task 7: global DISTINCT token count, not sum of per-agent counts. */
type MetricWindow = ReturnType<typeof build7dWindow>;

export function canonicalTokenPrefix(hash: string | undefined): string | null {
  return hash ? hash.slice(0, 19) : null;
}

export function hasTokenPrefixCollision(users: YamlUser[]): boolean {
  const seen = new Set<string>();
  for (const user of users) {
    for (const token of user.tokens) {
      const prefix = canonicalTokenPrefix(token.hash);
      if (!prefix) continue;
      if (seen.has(prefix)) return true;
      seen.add(prefix);
    }
  }
  return false;
}

export function hasUserTokenPrefixCollision(user: YamlUser): boolean {
  return hasTokenPrefixCollision([{ ...user, tokens: user.tokens }]);
}

export function availableTokenCount(user: YamlUser, nowMs = Date.now()): number {
  if (user.enabled === false) return 0;
  return user.tokens.filter((token) => !isTokenExpired(token.expires_at, nowMs)).length;
}

export function queryGlobalActiveTokenCount(db: Awaited<ReturnType<typeof getAuditDb>>, win: MetricWindow, snapshot?: AgentAuditReadSnapshot): number | null {
  try {
    const ceiling = snapshot ? snapshotIdCeilingSql(snapshot) : { clause: "", bind: [] };
    const row = db.prepare(`
      SELECT COUNT(DISTINCT token_hash_prefix) AS active_tokens
      FROM access_log
      WHERE token_hash_prefix IS NOT NULL
        AND ts >= ? AND ts < ?${ceiling.clause}
    `).get(win.startIso, win.endIso, ...ceiling.bind) as { active_tokens: number } | undefined;
    return row?.active_tokens ?? 0;
  } catch {
    return null;
  }
}


/** P1-58 — frozen id ceiling for one stats / last-used read batch (not MAX(ts)). */
export type AgentAuditReadSnapshot = {
  ceilingId: number;
};

export function captureAgentAuditReadSnapshot(db: Awaited<ReturnType<typeof getAuditDb>>): AgentAuditReadSnapshot {
  const row = db.prepare(`SELECT COALESCE(MAX(id), 0) AS id FROM access_log`).get() as { id: number };
  return { ceilingId: row.id };
}

export function snapshotIdCeilingSql(snapshot: AgentAuditReadSnapshot): { clause: string; bind: number[] } {
  if (snapshot.ceilingId <= 0) return { clause: "", bind: [] };
  return { clause: " AND id <= ?", bind: [snapshot.ceilingId] };
}

export function unavailableStats(user: YamlUser, win: MetricWindow): AgentStatsSummary {
  return {
    callsLast7d: null,
    businessCallsLast7d: null,
    protocolCallsLast7d: null,
    // Spec 189 §5.2 / SC-14 — every audit-derived window field stays null when
    // the audit store is unavailable. The UI must render "—", never 0.
    usageCallsLast7d: null,
    evalProbeCallsLast7d: null,
    deniedLast7d: null,
    activeTokensLast7d: null,
    usedCredentialsLast7d: null,
    configuredTokens: user.tokens.length,
    availableTokens: availableTokenCount(user, Date.parse(win.endIso)),
    credentialMetricsState: "unavailable",
    credentialMetricsReason: "audit_unavailable",
    topTables: [],
    metricsState: "unavailable",
    windowStart: win.startIso,
    windowEnd: win.endIso
  };
}

export function queryAgentStatsFromDb(
  db: Awaited<ReturnType<typeof getAuditDb>>,
  users: YamlUser[],
  win: MetricWindow = build7dWindow(),
  sharedSnapshot?: AgentAuditReadSnapshot
): Map<string, AgentStatsSummary> {
  const result = new Map<string, AgentStatsSummary>();
  if (users.length === 0) return result;
  // Spec 128 HR-5: one request-wide window and bulk aggregation; no per-agent N+1.
  // P1-58 — window counts use WHERE push-down; lastSeen / lastBusinessSeen are a
  // separate all-history query at the same id ceiling.
  try {
    const snapshot = db.transaction(() => sharedSnapshot ?? captureAgentAuditReadSnapshot(db))();
    const ceiling = snapshotIdCeilingSql(snapshot);
    const placeholders = users.map(() => "?").join(", ");
    const userIds = users.map((user) => user.id);
    const windowWhere = `user_id IN (${placeholders}) AND ts >= ? AND ts < ?${ceiling.clause}`;
    const windowBinds = [...userIds, win.startIso, win.endIso, ...ceiling.bind];
    const rows = db
      .prepare(
        `WITH window_rows AS MATERIALIZED (
           SELECT user_id, token_hash_prefix, tables, outcome,
             CASE WHEN ${PROTOCOL_CONDITION} THEN 1 ELSE 0 END AS is_protocol,
             CASE WHEN ${EVAL_PROBE_CONDITION} THEN 1 ELSE 0 END AS is_probe
           FROM access_log WHERE ${windowWhere}
         ), table_groups AS MATERIALIZED (
           SELECT user_id, tables, COUNT(*) AS cnt FROM window_rows
           WHERE is_protocol = 0 AND tables IS NOT NULL GROUP BY user_id, tables
         ), metrics AS (
           SELECT user_id, COUNT(*) AS calls7,
             SUM(1-is_protocol) AS business_calls7,
             SUM(is_protocol) AS protocol_calls7,
             SUM(CASE WHEN is_protocol=0 AND is_probe=0 THEN 1 ELSE 0 END) AS usage_calls7,
             SUM(CASE WHEN is_protocol=0 AND is_probe=1 THEN 1 ELSE 0 END) AS eval_probe_calls7,
             SUM(CASE WHEN is_protocol=0 AND is_probe=0 AND outcome='denied' THEN 1 ELSE 0 END) AS denied7,
             COUNT(DISTINCT token_hash_prefix) AS active_tokens
           FROM window_rows GROUP BY user_id
         )
         SELECT metrics.*, COALESCE((
           SELECT json_group_array(json_object('tables', tables, 'cnt', cnt))
           FROM table_groups WHERE table_groups.user_id=metrics.user_id
         ), '[]') AS top_groups FROM metrics`
      )
      .all(...windowBinds) as Array<{
        user_id: string;
        calls7: number | null;
        business_calls7: number | null;
        protocol_calls7: number | null;
        usage_calls7: number | null;
        eval_probe_calls7: number | null;
        denied7: number | null;
        active_tokens: number | null;
        top_groups: string;
      }>;
    const rowsByUser = new Map(rows.map((row) => [row.user_id, row]));

    // Existing (user_id, ts) index: seek newest row, rather than aggregate
    // every historical row just to obtain two timestamps.
    const historyBinds = [...userIds, ...ceiling.bind, ...ceiling.bind];
    const latestRows = db.prepare(`
      WITH subjects(user_id) AS (VALUES ${userIds.map(() => "(?)").join(",")})
      SELECT subjects.user_id,
        (SELECT ts FROM access_log WHERE user_id = subjects.user_id${ceiling.clause}
         ORDER BY ts DESC, id DESC LIMIT 1) AS last_seen,
        (SELECT ts FROM access_log WHERE user_id = subjects.user_id${ceiling.clause}
         AND ${DEFAULT_USAGE_CONDITION} ORDER BY ts DESC, id DESC LIMIT 1) AS last_business_seen
      FROM subjects`).all(...historyBinds) as Array<{
        user_id: string; last_seen: string | null; last_business_seen: string | null;
      }>;
    const latestByUser = new Map(latestRows.map((row) => [row.user_id, row]));

    const topRows = rows.flatMap((row) => {
      const groups = JSON.parse(row.top_groups ?? "[]") as Array<{ tables: string; cnt: number }>;
      return groups.map((group) => ({ user_id: row.user_id, ...group }));
    });

    const tableCountsByUser = new Map<string, Map<string, number>>();
    for (const r of topRows) {
      try {
        const parsed = JSON.parse(r.tables) as string[];
        const tableCounts = tableCountsByUser.get(r.user_id) ?? new Map<string, number>();
        for (const t of parsed) {
          tableCounts.set(t, (tableCounts.get(t) ?? 0) + r.cnt);
        }
        tableCountsByUser.set(r.user_id, tableCounts);
      } catch {
        // skip
      }
    }

    for (const user of users) {
      const row = rowsByUser.get(user.id);
      const latest = latestByUser.get(user.id);
      const tokenPrefixCollision = hasUserTokenPrefixCollision(user);
      const topTables = [...(tableCountsByUser.get(user.id)?.entries() ?? [])]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([table, calls]) => ({ table, calls }));
      result.set(user.id, {
        callsLast7d: row?.calls7 ?? 0,
        businessCallsLast7d: row?.business_calls7 ?? 0,
        protocolCallsLast7d: row?.protocol_calls7 ?? 0,
        // Spec 189 §5.2 — the Default Usage layer. `business = usage + evalProbe`.
        usageCallsLast7d: row?.usage_calls7 ?? 0,
        evalProbeCallsLast7d: row?.eval_probe_calls7 ?? 0,
        deniedLast7d: row?.denied7 ?? 0,
        lastSeen: latest?.last_seen ?? undefined,
        lastBusinessSeen: latest?.last_business_seen ?? undefined,
        activeTokensLast7d: row?.active_tokens ?? 0,
        usedCredentialsLast7d: tokenPrefixCollision ? null : row?.active_tokens ?? 0,
        configuredTokens: user.tokens.length,
        availableTokens: availableTokenCount(user, Date.parse(win.endIso)),
        credentialMetricsState: tokenPrefixCollision ? "partial" : "ok",
        credentialMetricsReason: tokenPrefixCollision ? "token_prefix_collision" : undefined,
        topTables,
        metricsState: "ok",
        windowStart: win.startIso,
        windowEnd: win.endIso
      });
    }
  } catch {
    for (const user of users) result.set(user.id, unavailableStats(user, win));
  }
  return result;
}


export type TokenUsageSnapshot = {
  lastUsed: string;
  lastTool: string;
  lastOutcome: string;
  lastIp?: string | null;
  lastUserAgent?: string | null;
  lastClient?: string | null;
  lastClientVersion?: string | null;
  lastDeviceNameSeen?: string | null;
  distinctIps7d?: number;
};


export function queryLastUsedMapFromDb(
  db: Awaited<ReturnType<typeof getAuditDb>>,
  userIds: string[],
  sharedSnapshot?: AgentAuditReadSnapshot,
  configuredUsers?: YamlUser[],
  asOfMs = Date.now()
): Map<string, Map<string, TokenUsageSnapshot>> {
  // Returns: userId -> (token hash prefix -> last usage snapshot)
  const result = new Map<string, Map<string, TokenUsageSnapshot>>();
  if (userIds.length === 0) return result;
  try {
    const snapshot = db.transaction(() => sharedSnapshot ?? captureAgentAuditReadSnapshot(db))();
    const ceiling = snapshotIdCeilingSql(snapshot);
    const placeholders = userIds.map(() => "?").join(", ");
    const prefixWhere = `user_id IN (${placeholders}) AND token_hash_prefix IS NOT NULL${ceiling.clause}`;
    const prefixBinds = [...userIds, ...ceiling.bind];
    const configured = configuredUsers?.flatMap((user) => [...new Set(user.tokens.map((token) => canonicalTokenPrefix(token.hash)).filter(Boolean))]
      .map((prefix) => [user.id, prefix]));
    if (configured && configured.length === 0) return result;
    const latestSql = configured ? `
      WITH configured(user_id, token_hash_prefix) AS (VALUES ${configured.map(() => "(?,?)").join(",")})
      SELECT a.* FROM configured c JOIN access_log a ON a.id = (
        SELECT id FROM access_log WHERE user_id=c.user_id AND token_hash_prefix=c.token_hash_prefix${ceiling.clause}
        ORDER BY ts DESC, id DESC LIMIT 1
      )` : undefined;
    const rows = db
      .prepare(
        latestSql ?? `SELECT user_id, token_hash_prefix, ts, tool, outcome, client_ip, user_agent, client, client_version, device_name
         FROM (
           SELECT
             user_id,
             token_hash_prefix,
             ts,
             tool,
             outcome,
             client_ip,
             user_agent,
             client,
             client_version,
             device_name,
             ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC) AS rn
           FROM access_log
           WHERE ${prefixWhere}
         )
         WHERE rn = 1`
      )
      .all(...(configured ? [...configured.flat(), ...ceiling.bind] : prefixBinds)) as Array<{
      user_id: string;
      token_hash_prefix: string;
      ts: string;
      tool: string;
      outcome: string;
      client_ip: string | null;
      user_agent: string | null;
      client: string | null;
      client_version: string | null;
      device_name: string | null;
    }>;

    for (const row of rows) {
      if (!result.has(row.user_id)) result.set(row.user_id, new Map());
      const byToken = result.get(row.user_id);
      if (!byToken || byToken.has(row.token_hash_prefix)) continue;
      const shown = presentStoredClient(row);
      byToken.set(row.token_hash_prefix, {
        lastUsed: row.ts,
        lastTool: row.tool,
        lastOutcome: row.outcome,
        lastIp: row.client_ip,
        lastUserAgent: row.user_agent,
        lastClient: shown.client ?? row.client,
        lastClientVersion: shown.clientVersion ?? row.client_version,
        lastDeviceNameSeen: row.device_name
      });
    }

    const since7d = new Date(asOfMs - 7 * 24 * 60 * 60 * 1000).toISOString();
    const ipWhere = `${prefixWhere} AND client_ip IS NOT NULL AND ts >= ?`;
    const ipRows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, COUNT(DISTINCT client_ip) AS distinct_ips
         FROM access_log
         WHERE ${ipWhere}
         GROUP BY user_id, token_hash_prefix`
      )
      .all(...prefixBinds, since7d) as Array<{
      user_id: string;
      token_hash_prefix: string;
      distinct_ips: number;
    }>;
    for (const row of ipRows) {
      const byToken = result.get(row.user_id);
      const snap = byToken?.get(row.token_hash_prefix);
      if (snap) snap.distinctIps7d = row.distinct_ips;
    }
  } catch {
    return result;
  }
  return result;
}
