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

const DEFAULT_HOURS = 24;
const MAX_HOURS = 720;
const DEFAULT_SENSITIVE_PREFIXES = ["dataforai.kx_", "finance", "salary"];

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

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
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

async function recentAuditRows(hours: number): Promise<AuditRow[]> {
  try {
    const db = await getAuditDb();
    return db.prepare(`
      SELECT ts, user_id, token_hash_prefix, tool, outcome, duration_ms, decision_reason, role_ids
      FROM access_log
      WHERE ts >= ?
      ORDER BY ts DESC
      LIMIT 5000
    `).all(sinceIso(hours)) as AuditRow[];
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

async function accessLogSourceRows(hours: number): Promise<Array<{ user_id: string; tool: string; physical_table: string; ts: string }>> {
  try {
    const db = await getAuditDb();
    return db.prepare(`
      SELECT user_id, tool, physical_table, ts
      FROM access_log_sources
      WHERE ts >= ?
      ORDER BY ts DESC
      LIMIT 5000
    `).all(sinceIso(hours)) as Array<{ user_id: string; tool: string; physical_table: string; ts: string }>;
  } catch {
    return [];
  }
}

function tokenPrefix(hash: string | undefined): string | null {
  if (!hash) return null;
  return hash.replace(/^sha256:/, "").slice(0, 12);
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

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}

export function registerGovernanceObservabilityRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/overview", async (request) => {
    const hours = boundedHours(request.query.hours);
    const [config, rows, changes] = await Promise.all([
      readAccessConfig(),
      recentAuditRows(hours),
      configChangeCount(hours)
    ]);
    const denied = rows.filter((row) => row.outcome === "denied").length;
    const errors = rows.filter((row) => row.outcome === "error").length;
    const roles = governanceRoles(config, rows);
    const agents = config.users ?? [];
    const activeTokenCount = new Set(rows.map((row) => row.token_hash_prefix).filter(Boolean)).size;
    const highDenialAgentCount = [...groupBy(rows, (row) => row.user_id).values()]
      .filter((agentRows) => agentRows.length >= 3 && pct(agentRows.filter((row) => row.outcome === "denied").length, agentRows.length) >= 50)
      .length;

    return {
      ok: true,
      data: {
        windowHours: hours,
        localAdminNotice: "local-admin mode; reviewer_identity is token-hash based until SSO/OIDC is enabled",
        cards: {
          calls: rows.length,
          denied,
          errors,
          deniedRate: pct(denied, rows.length),
          errorRate: pct(errors, rows.length),
          p95LatencyMs: p95(rows.map((row) => row.duration_ms ?? 0)),
          configuredAgentCount: agents.length,
          activeTokenCount,
          staleTokenCount: Math.max(0, agents.reduce((sum, user) => sum + (user.tokens?.length ?? 0), 0) - activeTokenCount),
          highDenialAgentCount,
          brokenRoleCount: roles.filter((role) => role.status === "broken").length,
          overBroadRoleCount: roles.filter((role) => role.status === "over_broad").length,
          configChangeCount: changes
        }
      }
    };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/agents", async (request) => {
    const hours = boundedHours(request.query.hours ?? "168");
    const [config, rows] = await Promise.all([readAccessConfig(), recentAuditRows(hours)]);
    const byUser = groupBy(rows, (row) => row.user_id);
    const agents = (config.users ?? []).map((user) => {
      const agentRows = byUser.get(user.id ?? "") ?? [];
      const deniedRows = agentRows.filter((row) => row.outcome === "denied");
      const reasons = groupBy(deniedRows, (row) => row.decision_reason ?? "denied_access");
      const topDeniedReason = [...reasons.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0] ?? null;
      return {
        id: user.id ?? "",
        name: user.name ?? user.id ?? "",
        enabled: user.enabled !== false,
        roleId: user.role ?? null,
        calls: agentRows.length,
        denied: deniedRows.length,
        errors: agentRows.filter((row) => row.outcome === "error").length,
        deniedRate: pct(deniedRows.length, agentRows.length),
        p95LatencyMs: p95(agentRows.map((row) => row.duration_ms ?? 0)),
        lastSeen: agentRows.map((row) => row.ts).sort().at(-1) ?? null,
        activeTokenCount: new Set(agentRows.map((row) => row.token_hash_prefix).filter(Boolean)).size,
        configuredTokenCount: user.tokens?.length ?? 0,
        topDeniedReason,
        auditHref: `/admin/audit?user=${encodeURIComponent(user.id ?? "")}`,
        agentHref: `/admin/agents/${encodeURIComponent(user.id ?? "")}`
      };
    });
    return { ok: true, data: { windowHours: hours, agents } };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/roles", async (request) => {
    const hours = boundedHours(request.query.hours ?? "168");
    const [config, rows] = await Promise.all([readAccessConfig(), recentAuditRows(hours)]);
    return { ok: true, data: { windowHours: hours, roles: governanceRoles(config, rows) } };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/tokens", async (request) => {
    const hours = boundedHours(request.query.hours ?? "168");
    const [config, rows] = await Promise.all([readAccessConfig(), recentAuditRows(hours)]);
    const lastUsedByPrefix = new Map<string, string>();
    for (const row of rows) {
      if (!row.token_hash_prefix) continue;
      if (!lastUsedByPrefix.has(row.token_hash_prefix) || row.ts > lastUsedByPrefix.get(row.token_hash_prefix)!) {
        lastUsedByPrefix.set(row.token_hash_prefix, row.ts);
      }
    }
    const tokens = (config.users ?? []).flatMap((user) => (user.tokens ?? []).map((token) => {
      const prefix = tokenPrefix(token.hash);
      return {
        agentId: user.id ?? "",
        label: token.label ?? "unnamed-token",
        tokenHashPrefix: prefix,
        lastUsed: prefix ? lastUsedByPrefix.get(prefix) ?? null : null,
        stale: !prefix || !lastUsedByPrefix.has(prefix),
        auditHref: `/admin/audit?user=${encodeURIComponent(user.id ?? "")}`
      };
    }));
    return { ok: true, data: { windowHours: hours, tokens } };
  });

  app.get<{ Querystring: { hours?: string } }>("/api/admin/governance/denials", async (request) => {
    const hours = boundedHours(request.query.hours ?? "168");
    const [rows, sourceRows] = await Promise.all([recentAuditRows(hours), accessLogSourceRows(hours)]);
    const deniedRows = rows.filter((row) => row.outcome === "denied");
    const reasonCounts = [...groupBy(deniedRows, (row) => row.decision_reason ?? "denied_access").entries()]
      .map(([reason, items]) => ({ reason, count: items.length }))
      .sort((a, b) => b.count - a.count);
    const topTools = [...groupBy(deniedRows, (row) => row.tool).entries()]
      .map(([tool, items]) => ({ tool, count: items.length }))
      .sort((a, b) => b.count - a.count);
    const topSources = [...groupBy(sourceRows, (row) => row.physical_table).entries()]
      .map(([source, items]) => ({ source, count: items.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    const trend = [...groupBy(deniedRows, (row) => row.ts.slice(0, 10)).entries()]
      .map(([date, items]) => ({ date, denied: items.length }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { ok: true, data: { windowHours: hours, reasonCounts, topTools, topSources, trend } };
  });
}
