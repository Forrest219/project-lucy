import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { parse } from "yaml";
import { getAuditDb } from "./audit.js";
import { resolveProjectRoot } from "../project.js";

type RoleConfig = {
  description?: string;
  allow?: {
    connections?: unknown;
    tableSelectors?: unknown;
    tools?: unknown;
    tables?: unknown;
  };
};

type UserConfig = {
  id?: string;
  name?: string;
  enabled?: boolean;
  role?: string;
  tokens?: Array<{ hash?: string; label?: string; expires_at?: string }>;
  allow?: RoleConfig["allow"];
};

type AccessConfig = {
  roles?: Record<string, RoleConfig>;
  users?: UserConfig[];
  defaults?: {
    sensitive_table_prefixes?: string[];
  };
};

type CountRow = { count: number };
type AuditRow = {
  ts: string;
  user_id: string;
  token_hash_prefix: string | null;
  tool: string;
  outcome: string;
  duration_ms: number;
  decision_reason: string | null;
  role_ids: string | null;
};

type PopularTableRow = {
  table: string;
  calls: number;
  lastSeen: string | null;
};

type AgentWindowStats = {
  user_id: string;
  calls: number;
  denied: number;
  errors: number;
  avg_latency_ms: number;
  last_seen: string | null;
};

type AgentActiveTokenRow = {
  user_id: string;
  active_tokens: number;
};

type TokenLastUsedRow = {
  token_hash_prefix: string;
  last_used: string;
};

const DEFAULT_HOURS = 168;
const MAX_HOURS = 720;
const ACTIVE_WINDOW_HOURS = 168;
/**
 * Bound for legacy roles/denials paths that still materialize audit rows.
 * Usage KPIs, popularTables, agents usage fields, and overview cards must NOT
 * aggregate through this limiter — they use SQL aggregates instead.
 * Consumers of roles/denials should treat results as potentially truncated.
 */
const COMPAT_AUDIT_ROW_LIMIT = 5000;
const DEFAULT_SENSITIVE_PREFIXES = ["dataforai.kx_", "finance", "salary"];
const POPULAR_TABLES_LIMIT = 10;
const TOKEN_SUMMARY_LIMIT = 20;

function boundedHours(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : typeof value === "number" ? value : DEFAULT_HOURS;
  if (!Number.isFinite(parsed)) return DEFAULT_HOURS;
  return Math.min(Math.max(Math.floor(parsed), 1), MAX_HOURS);
}

function sinceIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function pct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function safeJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

async function readAccessConfig(): Promise<AccessConfig> {
  const projectRoot = await resolveProjectRoot();
  try {
    const text = await readFile(path.join(projectRoot, "webui", "config", "access.yaml"), "utf8");
    return (parse(text) ?? {}) as AccessConfig;
  } catch {
    return {};
  }
}

/**
 * Legacy row fetch for roles (+ optional denials fallback) only.
 * WARNING: silently truncates at COMPAT_AUDIT_ROW_LIMIT. Do not use for usage KPIs.
 */
async function recentAuditRows(hours: number): Promise<AuditRow[]> {
  try {
    const db = await getAuditDb();
    return db.prepare(`
      SELECT ts, user_id, token_hash_prefix, tool, outcome, duration_ms, decision_reason, role_ids
      FROM access_log
      WHERE ts >= ?
      ORDER BY ts DESC
      LIMIT ?
    `).all(sinceIso(hours), COMPAT_AUDIT_ROW_LIMIT) as AuditRow[];
  } catch {
    return [];
  }
}

async function configChangeCount(hours: number): Promise<number> {
  try {
    const db = await getAuditDb();
    const row = db.prepare("SELECT COUNT(*) AS count FROM config_change_log WHERE ts >= ?")
      .get(sinceIso(hours)) as CountRow | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryCallStats(hours: number): Promise<{ calls: number; avgLatencyMs: number; denied: number; errors: number }> {
  try {
    const db = await getAuditDb();
    const row = db.prepare(`
      SELECT
        COUNT(*) AS calls,
        ROUND(AVG(duration_ms), 1) AS avg_latency_ms,
        SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors
      FROM access_log
      WHERE ts >= ?
    `).get(sinceIso(hours)) as {
      calls: number;
      avg_latency_ms: number | null;
      denied: number | null;
      errors: number | null;
    } | undefined;

    return {
      calls: row?.calls ?? 0,
      avgLatencyMs: row?.avg_latency_ms ?? 0,
      denied: row?.denied ?? 0,
      errors: row?.errors ?? 0
    };
  } catch {
    return { calls: 0, avgLatencyMs: 0, denied: 0, errors: 0 };
  }
}

/** True p95 over all window rows (matches prior JS ceil(n*0.95)-1 index). */
async function queryP95LatencyMs(hours: number): Promise<number> {
  try {
    const db = await getAuditDb();
    const since = sinceIso(hours);
    const countRow = db.prepare(`
      SELECT COUNT(*) AS count FROM access_log WHERE ts >= ?
    `).get(since) as CountRow | undefined;
    const count = countRow?.count ?? 0;
    if (count <= 0) return 0;
    const offset = Math.min(count - 1, Math.ceil(count * 0.95) - 1);
    const row = db.prepare(`
      SELECT duration_ms
      FROM access_log
      WHERE ts >= ?
      ORDER BY duration_ms ASC
      LIMIT 1 OFFSET ?
    `).get(since, offset) as { duration_ms: number } | undefined;
    return row?.duration_ms ?? 0;
  } catch {
    return 0;
  }
}

async function queryActiveAgentCount(): Promise<number> {
  try {
    const db = await getAuditDb();
    const row = db.prepare(`
      SELECT COUNT(DISTINCT user_id) AS count
      FROM access_log
      WHERE ts >= ?
        AND user_id IS NOT NULL
        AND user_id != ''
    `).get(sinceIso(ACTIVE_WINDOW_HOURS)) as CountRow | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryActiveTokenCount(): Promise<number> {
  try {
    const db = await getAuditDb();
    const row = db.prepare(`
      SELECT COUNT(DISTINCT token_hash_prefix) AS count
      FROM access_log
      WHERE ts >= ?
        AND token_hash_prefix IS NOT NULL
    `).get(sinceIso(ACTIVE_WINDOW_HOURS)) as CountRow | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryHighDenialAgentCount(hours: number): Promise<number> {
  try {
    const db = await getAuditDb();
    const row = db.prepare(`
      SELECT COUNT(*) AS count
      FROM (
        SELECT user_id
        FROM access_log
        WHERE ts >= ?
          AND user_id IS NOT NULL
          AND user_id != ''
        GROUP BY user_id
        HAVING COUNT(*) >= 3
          AND (100.0 * SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) / COUNT(*)) >= 50
      )
    `).get(sinceIso(hours)) as CountRow | undefined;
    return row?.count ?? 0;
  } catch {
    return 0;
  }
}

async function queryPopularTablesFromSources(): Promise<PopularTableRow[]> {
  try {
    const db = await getAuditDb();
    return db.prepare(`
      SELECT
        physical_table AS "table",
        COUNT(*) AS calls,
        MAX(ts) AS lastSeen
      FROM access_log_sources
      WHERE ts >= ?
        AND physical_table IS NOT NULL
        AND physical_table != ''
      GROUP BY physical_table
      ORDER BY calls DESC, lastSeen DESC
      LIMIT ?
    `).all(sinceIso(ACTIVE_WINDOW_HOURS), POPULAR_TABLES_LIMIT) as PopularTableRow[];
  } catch {
    return [];
  }
}

async function queryPopularTablesFromAccessLogTables(): Promise<PopularTableRow[]> {
  try {
    const db = await getAuditDb();
    return db.prepare(`
      SELECT
        j.value AS "table",
        COUNT(*) AS calls,
        MAX(a.ts) AS lastSeen
      FROM access_log a, json_each(a.tables) j
      WHERE a.ts >= ?
        AND a.tables IS NOT NULL
        AND a.tables != ''
        AND a.tables != '[]'
        AND typeof(j.value) = 'text'
        AND j.value != ''
      GROUP BY j.value
      ORDER BY calls DESC, lastSeen DESC
      LIMIT ?
    `).all(sinceIso(ACTIVE_WINDOW_HOURS), POPULAR_TABLES_LIMIT) as PopularTableRow[];
  } catch {
    return [];
  }
}

async function queryPopularTables(): Promise<PopularTableRow[]> {
  const fromSources = await queryPopularTablesFromSources();
  if (fromSources.length > 0) return fromSources;
  return queryPopularTablesFromAccessLogTables();
}

async function queryAgentWindowStats(hours: number): Promise<Map<string, AgentWindowStats>> {
  const result = new Map<string, AgentWindowStats>();
  try {
    const db = await getAuditDb();
    const rows = db.prepare(`
      SELECT
        user_id,
        COUNT(*) AS calls,
        SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
        SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
        ROUND(AVG(duration_ms), 1) AS avg_latency_ms,
        MAX(ts) AS last_seen
      FROM access_log
      WHERE ts >= ?
        AND user_id IS NOT NULL
        AND user_id != ''
      GROUP BY user_id
    `).all(sinceIso(hours)) as AgentWindowStats[];
    for (const row of rows) {
      result.set(row.user_id, row);
    }
  } catch {
    // empty map
  }
  return result;
}

/** Per-agent p95 over ALL calls in the window (not denied-only). */
async function queryAgentP95LatencyMs(hours: number): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const db = await getAuditDb();
    const since = sinceIso(hours);
    const users = db.prepare(`
      SELECT DISTINCT user_id
      FROM access_log
      WHERE ts >= ?
        AND user_id IS NOT NULL
        AND user_id != ''
    `).all(since) as Array<{ user_id: string }>;

    const countStmt = db.prepare(`
      SELECT COUNT(*) AS count
      FROM access_log
      WHERE ts >= ? AND user_id = ?
    `);
    const p95Stmt = db.prepare(`
      SELECT duration_ms
      FROM access_log
      WHERE ts >= ? AND user_id = ?
      ORDER BY duration_ms ASC
      LIMIT 1 OFFSET ?
    `);

    for (const { user_id } of users) {
      const count = (countStmt.get(since, user_id) as CountRow | undefined)?.count ?? 0;
      if (count <= 0) {
        result.set(user_id, 0);
        continue;
      }
      const offset = Math.min(count - 1, Math.ceil(count * 0.95) - 1);
      const row = p95Stmt.get(since, user_id, offset) as { duration_ms: number } | undefined;
      result.set(user_id, row?.duration_ms ?? 0);
    }
  } catch {
    // empty map
  }
  return result;
}

async function queryAgentTopDeniedReasons(hours: number): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const db = await getAuditDb();
    const rows = db.prepare(`
      SELECT user_id, reason, cnt
      FROM (
        SELECT
          user_id,
          COALESCE(decision_reason, 'denied_access') AS reason,
          COUNT(*) AS cnt,
          ROW_NUMBER() OVER (
            PARTITION BY user_id
            ORDER BY COUNT(*) DESC, COALESCE(decision_reason, 'denied_access') ASC
          ) AS rn
        FROM access_log
        WHERE ts >= ?
          AND outcome = 'denied'
          AND user_id IS NOT NULL
          AND user_id != ''
        GROUP BY user_id, COALESCE(decision_reason, 'denied_access')
      )
      WHERE rn = 1
    `).all(sinceIso(hours)) as Array<{ user_id: string; reason: string; cnt: number }>;
    for (const row of rows) {
      result.set(row.user_id, row.reason);
    }
  } catch {
    // empty map
  }
  return result;
}

async function queryAgentActiveTokenCounts(): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  try {
    const db = await getAuditDb();
    const rows = db.prepare(`
      SELECT
        user_id,
        COUNT(DISTINCT token_hash_prefix) AS active_tokens
      FROM access_log
      WHERE ts >= ?
        AND user_id IS NOT NULL
        AND user_id != ''
        AND token_hash_prefix IS NOT NULL
      GROUP BY user_id
    `).all(sinceIso(ACTIVE_WINDOW_HOURS)) as AgentActiveTokenRow[];
    for (const row of rows) {
      result.set(row.user_id, row.active_tokens);
    }
  } catch {
    // empty map
  }
  return result;
}

async function queryTokenLastUsedMap(): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  try {
    const db = await getAuditDb();
    const rows = db.prepare(`
      SELECT token_hash_prefix, MAX(ts) AS last_used
      FROM access_log
      WHERE token_hash_prefix IS NOT NULL
      GROUP BY token_hash_prefix
    `).all() as TokenLastUsedRow[];
    for (const row of rows) {
      result.set(row.token_hash_prefix, row.last_used);
    }
  } catch {
    // empty map
  }
  return result;
}

async function queryActiveTokenPrefixesLast7d(): Promise<Set<string>> {
  const result = new Set<string>();
  try {
    const db = await getAuditDb();
    const rows = db.prepare(`
      SELECT DISTINCT token_hash_prefix
      FROM access_log
      WHERE ts >= ?
        AND token_hash_prefix IS NOT NULL
    `).all(sinceIso(ACTIVE_WINDOW_HOURS)) as Array<{ token_hash_prefix: string }>;
    for (const row of rows) result.add(row.token_hash_prefix);
  } catch {
    // empty set
  }
  return result;
}

/**
 * Canonical display prefix (production writer: hash.slice(0, 19) including `sha256:`).
 * Also returns bare-hex variants so historical/manual rows without scheme still match.
 */
function tokenPrefixCandidates(hash: string | undefined): string[] {
  if (!hash) return [];
  const candidates = new Set<string>();
  candidates.add(hash.slice(0, 19));
  const bare = hash.replace(/^sha256:/i, "");
  if (bare) {
    candidates.add(bare.slice(0, 12));
    candidates.add(`sha256:${bare}`.slice(0, 19));
  }
  return [...candidates];
}

function canonicalTokenPrefix(hash: string | undefined): string | null {
  if (!hash) return null;
  return hash.slice(0, 19);
}

function lookupLastUsed(lastUsedByPrefix: Map<string, string>, hash: string | undefined): string | null {
  let best: string | null = null;
  for (const candidate of tokenPrefixCandidates(hash)) {
    const value = lastUsedByPrefix.get(candidate);
    if (value && (!best || value > best)) best = value;
  }
  return best;
}

function isActivePrefix(activePrefixes: Set<string>, hash: string | undefined): boolean {
  return tokenPrefixCandidates(hash).some((candidate) => activePrefixes.has(candidate));
}

function configuredTokenCount(config: AccessConfig): number {
  return (config.users ?? []).reduce((sum, user) => sum + (user.tokens?.length ?? 0), 0);
}

function tableSelectorCount(role: RoleConfig): number {
  const selectors = role.allow?.tableSelectors;
  if (Array.isArray(selectors)) {
    return selectors.reduce((count, selector) => {
      if (!selector || typeof selector !== "object") return count;
      const names = (selector as { names?: unknown }).names;
      const prefix = (selector as { prefix?: unknown }).prefix;
      if (Array.isArray(names)) return count + names.length;
      if (typeof prefix === "string" && prefix.trim()) return count + 1;
      return count;
    }, 0);
  }
  const legacyTables = role.allow?.tables;
  return Array.isArray(legacyTables) ? legacyTables.length : 0;
}

function selectorRefs(role: RoleConfig): string[] {
  const selectors = role.allow?.tableSelectors;
  if (Array.isArray(selectors)) {
    return selectors.flatMap((selector) => {
      if (!selector || typeof selector !== "object") return [];
      const item = selector as { connection?: unknown; schema?: unknown; names?: unknown; prefix?: unknown };
      const connection = typeof item.connection === "string" ? item.connection : "";
      const schema = typeof item.schema === "string" ? item.schema : "";
      const prefix = `${connection}.${schema}`.replace(/^\./, "").replace(/\.$/, "");
      if (Array.isArray(item.names)) {
        return item.names
          .filter((name): name is string => typeof name === "string")
          .map((name) => [prefix, name].filter(Boolean).join("."));
      }
      if (typeof item.prefix === "string") return [[prefix, `${item.prefix}*`].filter(Boolean).join(".")];
      return [];
    });
  }
  const legacyTables = role.allow?.tables;
  return Array.isArray(legacyTables) ? legacyTables.filter((entry): entry is string => typeof entry === "string") : [];
}

function hasWildcard(role: RoleConfig): boolean {
  const tools = role.allow?.tools;
  const tables = role.allow?.tables;
  if (Array.isArray(tools) && tools.includes("*")) return true;
  if (Array.isArray(tables) && tables.includes("*")) return true;
  return selectorRefs(role).some((ref) => ref.includes("*"));
}

function hasSensitiveScope(role: RoleConfig, sensitivePrefixes: string[]): boolean {
  const refs = selectorRefs(role).map((ref) => ref.toLowerCase());
  return refs.some((ref) => sensitivePrefixes.some((prefix) => ref.includes(prefix.toLowerCase())));
}

function governanceRoles(config: AccessConfig, rows: AuditRow[]) {
  const roles = config.roles ?? {};
  const users = config.users ?? [];
  const roleUsage = new Map<string, number>();
  for (const user of users) {
    if (user.role) roleUsage.set(user.role, (roleUsage.get(user.role) ?? 0) + 1);
  }
  // Audit-derived usage may be truncated when `rows` came from recentAuditRows.
  for (const row of rows) {
    for (const roleId of safeJsonArray(row.role_ids)) {
      roleUsage.set(roleId, (roleUsage.get(roleId) ?? 0) + 1);
    }
  }
  const sensitivePrefixes = config.defaults?.sensitive_table_prefixes ?? DEFAULT_SENSITIVE_PREFIXES;
  return Object.entries(roles).map(([id, role]) => {
    const sourceCount = tableSelectorCount(role);
    const toolCount = Array.isArray(role.allow?.tools) ? role.allow.tools.length : 0;
    const broken = sourceCount === 0 || toolCount === 0;
    const wildcard = hasWildcard(role);
    const sensitive = hasSensitiveScope(role, sensitivePrefixes);
    return {
      id,
      description: role.description ?? "",
      sourceCount,
      toolCount,
      usageCount: roleUsage.get(id) ?? 0,
      status: broken ? "broken" : wildcard ? "over_broad" : sensitive ? "sensitive" : "ok",
      flags: [
        broken ? "missing_scope" : null,
        wildcard ? "wildcard_scope" : null,
        sensitive ? "sensitive_scope" : null
      ].filter(Boolean)
    };
  });
}

export function registerGovernanceObservabilityRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/overview", async (request) => {
    const hours = boundedHours(request.query.hours ?? String(DEFAULT_HOURS));
    const [config, callStats, p95LatencyMs, activeAgentCount, activeTokenCount, popularTables, changes, highDenialAgentCount] =
      await Promise.all([
        readAccessConfig(),
        queryCallStats(hours),
        queryP95LatencyMs(hours),
        queryActiveAgentCount(),
        queryActiveTokenCount(),
        queryPopularTables(),
        configChangeCount(hours),
        queryHighDenialAgentCount(hours)
      ]);

    const agents = config.users ?? [];
    const agentCount = agents.length;
    const configuredTokens = configuredTokenCount(config);
    // Status flags are config-derived; skip truncated audit rows for overview cards.
    const roles = governanceRoles(config, []);

    const usageOverview = {
      agentCount,
      activeAgentCount,
      agentActiveRate: pct(activeAgentCount, agentCount),
      configuredTokenCount: configuredTokens,
      activeTokenCount,
      tokenActiveRate: pct(activeTokenCount, configuredTokens),
      calls: callStats.calls,
      avgLatencyMs: callStats.avgLatencyMs
    };

    return {
      ok: true,
      data: {
        windowHours: hours,
        localAdminNotice: "local-admin mode; reviewer_identity is token-hash based until SSO/OIDC is enabled",
        usageOverview,
        popularTables,
        // Compatibility payload for older clients / GOV-02 tests. UI must not drive from cards.
        cards: {
          calls: callStats.calls,
          denied: callStats.denied,
          errors: callStats.errors,
          deniedRate: pct(callStats.denied, callStats.calls),
          errorRate: pct(callStats.errors, callStats.calls),
          p95LatencyMs,
          configuredAgentCount: agentCount,
          activeTokenCount,
          staleTokenCount: Math.max(0, configuredTokens - activeTokenCount),
          highDenialAgentCount,
          brokenRoleCount: roles.filter((role) => role.status === "broken").length,
          overBroadRoleCount: roles.filter((role) => role.status === "over_broad").length,
          configChangeCount: changes,
          avgLatencyMs: callStats.avgLatencyMs,
          agentCount,
          activeAgentCount,
          agentActiveRate: usageOverview.agentActiveRate,
          configuredTokenCount: configuredTokens,
          tokenActiveRate: usageOverview.tokenActiveRate
        }
      }
    };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/agents", async (request) => {
    const hours = boundedHours(request.query.hours ?? String(DEFAULT_HOURS));
    const [config, windowStats, activeTokenCounts, p95ByUser, topDeniedByUser] = await Promise.all([
      readAccessConfig(),
      queryAgentWindowStats(hours),
      queryAgentActiveTokenCounts(),
      queryAgentP95LatencyMs(hours),
      queryAgentTopDeniedReasons(hours)
    ]);

    const agents = (config.users ?? []).map((user) => {
      const userId = user.id ?? "";
      const stats = windowStats.get(userId);
      const calls = stats?.calls ?? 0;
      const denied = stats?.denied ?? 0;
      const errors = stats?.errors ?? 0;
      return {
        id: userId,
        name: user.name ?? userId,
        enabled: user.enabled !== false,
        roleId: user.role ?? null,
        calls,
        denied,
        errors,
        deniedRate: pct(denied, calls),
        avgLatencyMs: stats?.avg_latency_ms ?? 0,
        p95LatencyMs: p95ByUser.get(userId) ?? 0,
        lastSeen: stats?.last_seen ?? null,
        activeTokenCount: activeTokenCounts.get(userId) ?? 0,
        configuredTokenCount: user.tokens?.length ?? 0,
        topDeniedReason: topDeniedByUser.get(userId) ?? null,
        auditHref: `/admin/audit?user=${encodeURIComponent(userId)}`,
        agentHref: `/admin/agents/${encodeURIComponent(userId)}`
      };
    }).sort((a, b) => {
      if (b.calls !== a.calls) return b.calls - a.calls;
      const aSeen = a.lastSeen ?? "";
      const bSeen = b.lastSeen ?? "";
      return bSeen.localeCompare(aSeen);
    });

    return { ok: true, data: { windowHours: hours, agents } };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/roles", async (request) => {
    const hours = boundedHours(request.query.hours ?? String(DEFAULT_HOURS));
    const [config, rows] = await Promise.all([readAccessConfig(), recentAuditRows(hours)]);
    return {
      ok: true,
      data: {
        windowHours: hours,
        // usageCount from audit role_ids may be truncated at COMPAT_AUDIT_ROW_LIMIT.
        compatTruncation: { auditRowsLimit: COMPAT_AUDIT_ROW_LIMIT },
        roles: governanceRoles(config, rows)
      }
    };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/tokens", async (request) => {
    const hours = boundedHours(request.query.hours ?? String(DEFAULT_HOURS));
    const [config, lastUsedByPrefix, activePrefixes] = await Promise.all([
      readAccessConfig(),
      queryTokenLastUsedMap(),
      queryActiveTokenPrefixesLast7d()
    ]);

    const tokens = (config.users ?? []).flatMap((user) => (user.tokens ?? []).map((token) => {
      const prefix = canonicalTokenPrefix(token.hash);
      const lastUsed = lookupLastUsed(lastUsedByPrefix, token.hash);
      const activeInLast7d = isActivePrefix(activePrefixes, token.hash);
      return {
        agentId: user.id ?? "",
        label: token.label ?? "unnamed-token",
        tokenHashPrefix: prefix,
        lastUsed,
        activeInLast7d,
        configured: true,
        stale: !activeInLast7d,
        auditHref: `/admin/audit?user=${encodeURIComponent(user.id ?? "")}`
      };
    }))
      .sort((a, b) => {
        const aUsed = a.lastUsed ?? "";
        const bUsed = b.lastUsed ?? "";
        return bUsed.localeCompare(aUsed);
      })
      .slice(0, TOKEN_SUMMARY_LIMIT);

    return { ok: true, data: { windowHours: hours, tokens } };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/denials", async (request) => {
    const hours = boundedHours(request.query.hours ?? String(DEFAULT_HOURS));
    try {
      const db = await getAuditDb();
      const since = sinceIso(hours);
      const reasonCounts = db.prepare(`
        SELECT COALESCE(decision_reason, 'denied_access') AS reason, COUNT(*) AS count
        FROM access_log
        WHERE ts >= ? AND outcome = 'denied'
        GROUP BY COALESCE(decision_reason, 'denied_access')
        ORDER BY count DESC
      `).all(since) as Array<{ reason: string; count: number }>;
      const topTools = db.prepare(`
        SELECT tool, COUNT(*) AS count
        FROM access_log
        WHERE ts >= ? AND outcome = 'denied'
        GROUP BY tool
        ORDER BY count DESC
      `).all(since) as Array<{ tool: string; count: number }>;
      const topSources = db.prepare(`
        SELECT physical_table AS source, COUNT(*) AS count
        FROM access_log_sources
        WHERE ts >= ?
          AND physical_table IS NOT NULL
          AND physical_table != ''
        GROUP BY physical_table
        ORDER BY count DESC
        LIMIT 20
      `).all(since) as Array<{ source: string; count: number }>;
      const trend = db.prepare(`
        SELECT substr(ts, 1, 10) AS date, COUNT(*) AS denied
        FROM access_log
        WHERE ts >= ? AND outcome = 'denied'
        GROUP BY substr(ts, 1, 10)
        ORDER BY date ASC
      `).all(since) as Array<{ date: string; denied: number }>;
      return { ok: true, data: { windowHours: hours, reasonCounts, topTools, topSources, trend } };
    } catch {
      return { ok: true, data: { windowHours: hours, reasonCounts: [], topTools: [], topSources: [], trend: [] } };
    }
  });
}
