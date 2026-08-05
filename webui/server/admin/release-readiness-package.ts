/**
 * 202608-GOV-06 P2-B — Release Readiness Evidence Package
 * Spec: `webui/docs/69-admin-governance-observability-spec.md` §8
 * Plan: `docs/plans/wo-202608-06-governance-review-release-evidence.md` P2-B
 *
 * One bounded release readiness evidence package. No audience-specific
 * variants, no internal / customer split. Only current Agent / Role / Token /
 * ACL / Audit / Eval facts are used.
 *
 * Hard rules:
 *  - One package shape. The Markdown export renders the same shape.
 *  - The package MUST NOT include Token plaintext, raw result rows, raw SQL
 *    AST, full original question, DB credentials, customer row samples,
 *    access boundary evidence that Lucy does not currently support.
 *  - Empty / missing fact sources produce `unavailable` / `skipped` notes
 *    instead of invented data.
 *  - `knownLimitations` is hard-coded from the spec and may not claim
 *    capabilities that are not in the current Lucy release.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveProjectRoot } from "../project.js";
import { readAccessYaml } from "./access-config.js";
import { getAuditDb } from "./audit.js";
import {
  collectRiskReviewCandidates,
  summarizeRiskReview,
  type RiskReviewSummary
} from "./risk-review.js";
import { getEvalDb } from "../eval/db.js";

// ─── Public types ────────────────────────────────────────────────────────────

export interface AgentInventoryEntry {
  id: string;
  enabled: boolean;
  role: string | null;
  tokenCount: number;
  tokenHashPrefixes: string[];
  callsLastWindow: number;
  deniedLastWindow: number;
  lastSeen: string | null;
}

export interface RoleInventoryEntry {
  id: string;
  source: "yaml" | "template";
  description?: string;
  usageCount: number;
  sourceCount: number;
  broken: boolean;
  invalidReason?: string;
}

export interface TokenInventoryEntry {
  userId: string;
  label: string;
  hashPrefix: string;
  created: string;
  expiresAt: string | null;
  lastUsed: string | null;
  revoked: boolean;
}

export interface DenialReasonEntry {
  reason: string;
  count: number;
}

export interface DenialSummaryBlock {
  totalCalls: number;
  deniedCalls: number;
  denialRate: number;
  topReasons: DenialReasonEntry[];
  topAffectedTools: DenialReasonEntry[];
  unavailableReason?: string;
}

export interface ConfigChangeSummaryBlock {
  totalChanges: number;
  byChangeType: Record<string, number>;
  byFilePath: Record<string, number>;
  byAssetKind: Record<string, number>;
  lastChangeAt: string | null;
  unavailableReason?: string;
}

export interface SecurityEvalSummaryBlock {
  status: "available" | "unavailable";
  reason?: string;
  candidateCount?: number;
  promotedCount?: number;
  /** Per the §B hard rule: "if an optional source is unavailable, return an
   *  empty bounded section plus an unavailable / skipped note; do not invent
   *  evidence." */
  skipped?: boolean;
}

export interface RiskReviewSummaryBlock {
  generatedAt: string;
  reviewWindowHours: number;
  summary: RiskReviewSummary;
  factSources: {
    accessYaml: "available" | "unavailable";
    accessLog: "available" | "unavailable";
    revokedTokens: "available" | "unavailable";
  };
}

export interface ReleaseReadinessInventory {
  agents: AgentInventoryEntry[];
  roles: RoleInventoryEntry[];
  tokens: TokenInventoryEntry[];
  agentCount: number;
  enabledAgentCount: number;
  roleCount: number;
  yamlRoleCount: number;
  templateRoleCount: number;
  tokenCount: number;
  revokedTokenCount: number;
}

export interface ReleaseReadinessPackage {
  generatedAt: string;
  accessConfigHash: string;
  factSourcesUsed: string[];
  inventory: ReleaseReadinessInventory;
  denialSummary: DenialSummaryBlock;
  configChangeSummary: ConfigChangeSummaryBlock;
  securityEvalSummary: SecurityEvalSummaryBlock;
  riskReviewSummary: RiskReviewSummaryBlock;
  knownLimitations: string[];
  schemaVersion: "202608-gov-06.v1";
}

// ─── Hard-coded known limitations ────────────────────────────────────────────

const KNOWN_LIMITATIONS: readonly string[] = [
  "No SSO / OIDC; the audit log only carries the deployment-local actor 'local-admin'.",
  "No full Visual Debugger; only the Admin Audit Trace read model is available.",
  "No FDE Copilot mainline; the 202608 iteration focuses on governance and observability, not FDE automation.",
  "No remediation lifecycle for risk review candidates; candidates are evidence-only and never auto-applied.",
  "One release readiness package shape; the package contains only current Agent / Role / Token / ACL / Audit / Eval facts."
];

// ─── Inventory helpers ───────────────────────────────────────────────────────

interface TokenRecentUse {
  lastUsed: string | null;
  lastOutcome: string | null;
}

async function readTokenRecentUse(
  userIds: string[]
): Promise<Map<string, Map<string, TokenRecentUse>>> {
  const result = new Map<string, Map<string, TokenRecentUse>>();
  if (userIds.length === 0) return result;
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return result;
  }
  try {
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id, token_hash_prefix, ts, outcome
         FROM (
           SELECT
             user_id,
             token_hash_prefix,
             ts,
             outcome,
             ROW_NUMBER() OVER (PARTITION BY user_id, token_hash_prefix ORDER BY ts DESC, id DESC) AS rn
           FROM access_log
           WHERE user_id IN (${placeholders}) AND token_hash_prefix IS NOT NULL
         )
         WHERE rn = 1`
      )
      .all(...userIds) as Array<{ user_id: string; token_hash_prefix: string; ts: string; outcome: string }>;
    for (const row of rows) {
      if (!result.has(row.user_id)) result.set(row.user_id, new Map());
      const byToken = result.get(row.user_id);
      if (!byToken || byToken.has(row.token_hash_prefix)) continue;
      byToken.set(row.token_hash_prefix, { lastUsed: row.ts, lastOutcome: row.outcome });
    }
  } catch {
    return result;
  }
  return result;
}

async function readAgentStatsBulk(
  userIds: string[],
  windowHours: number,
  now: Date
): Promise<Map<string, { calls: number; denied: number; lastSeen: string | null }>> {
  const out = new Map<string, { calls: number; denied: number; lastSeen: string | null }>();
  if (userIds.length === 0) return out;
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return out;
  }
  const isoCutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
  try {
    const placeholders = userIds.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT user_id,
                COUNT(*) AS calls,
                SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
                MAX(ts) AS last_seen
         FROM access_log
         WHERE user_id IN (${placeholders}) AND ts >= ?
         GROUP BY user_id`
      )
      .all(...userIds, isoCutoff) as Array<{ user_id: string; calls: number; denied: number; last_seen: string | null }>;
    for (const row of rows) {
      out.set(row.user_id, {
        calls: row.calls ?? 0,
        denied: row.denied ?? 0,
        lastSeen: row.last_seen ?? null
      });
    }
  } catch {
    return out;
  }
  return out;
}

async function readRevokedTokens(): Promise<Set<string>> {
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return new Set();
  }
  try {
    const rows = db.prepare(`SELECT token_hash FROM revoked_tokens`).all() as Array<{ token_hash: string }>;
    return new Set(rows.map((row) => row.token_hash));
  } catch {
    return new Set();
  }
}

async function readRoleResolutionForInventory(roleId: string) {
  try {
    const resolved = await import("../proxy/acl.js").then((mod) =>
      mod.previewRolePermissionsForAdmin(roleId, { freshSourceMap: false })
    );
    return {
      ok: resolved.ok,
      reason: resolved.ok ? undefined : resolved.reason,
      sourceCount: resolved.ok ? resolved.permissions.sources.length : 0
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      sourceCount: 0
    };
  }
}

async function buildInventory(
  windowHours: number,
  now: Date
): Promise<ReleaseReadinessInventory> {
  const projectRoot = await resolveProjectRoot();
  const accessFile = await readAccessYaml(projectRoot);
  const config = accessFile.config;
  const userIds = config.users.map((user) => user.id);
  const [tokenUse, agentStats, revokedHashes] = await Promise.all([
    readTokenRecentUse(userIds),
    readAgentStatsBulk(userIds, windowHours, now),
    readRevokedTokens()
  ]);

  const roles: RoleInventoryEntry[] = [];
  for (const roleId of Object.keys(config.roles ?? {})) {
    const role = config.roles?.[roleId];
    if (!role?.allow) continue;
    const resolution = await readRoleResolutionForInventory(roleId);
    const usageCount = config.users.filter((user) => user.role === roleId).length;
    roles.push({
      id: roleId,
      source: "yaml",
      description: role.description,
      usageCount,
      sourceCount: resolution.sourceCount,
      broken: !resolution.ok,
      invalidReason: resolution.ok ? undefined : resolution.reason
    });
  }

  const templateEntries = await buildTemplateRoleInventory(config);
  roles.push(...templateEntries);

  const agents: AgentInventoryEntry[] = config.users.map((user) => {
    const stats = agentStats.get(user.id);
    const userTokenUse = tokenUse.get(user.id);
    const tokenHashPrefixes = user.tokens.map((t) => t.hash.slice(0, 19));
    const lastUsedTouched = tokenHashPrefixes
      .map((prefix) => userTokenUse?.get(prefix)?.lastUsed)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
    return {
      id: user.id,
      enabled: user.enabled !== false,
      role: user.role ?? null,
      tokenCount: user.tokens.length,
      tokenHashPrefixes,
      callsLastWindow: stats?.calls ?? 0,
      deniedLastWindow: stats?.denied ?? 0,
      lastSeen: stats?.lastSeen ?? null
    };
  });

  const tokens: TokenInventoryEntry[] = [];
  for (const user of config.users) {
    const userTokenUse = tokenUse.get(user.id);
    for (const token of user.tokens) {
      const hashPrefix = token.hash.slice(0, 19);
      const use = userTokenUse?.get(hashPrefix);
      // Match against revoked hashes by hash prefix to be consistent with how
      // access_log stores token_hash_prefix; full-hash comparison misses
      // any token whose stored full hash differs in length or trailing bytes.
      let revoked = false;
      for (const revokedHash of revokedHashes) {
        if (revokedHash.slice(0, 19) === hashPrefix) {
          revoked = true;
          break;
        }
      }
      tokens.push({
        userId: user.id,
        label: token.label,
        hashPrefix,
        created: token.created,
        expiresAt: token.expires_at ?? null,
        lastUsed: use?.lastUsed ?? null,
        revoked
      });
    }
  }

  const revokedTokenCount = tokens.filter((token) => token.revoked).length;
  const yamlRoleCount = roles.filter((role) => role.source === "yaml").length;
  const templateRoleCount = roles.filter((role) => role.source === "template").length;
  const enabledAgentCount = agents.filter((agent) => agent.enabled).length;

  return {
    agents,
    roles,
    tokens,
    agentCount: agents.length,
    enabledAgentCount,
    roleCount: roles.length,
    yamlRoleCount,
    templateRoleCount,
    tokenCount: tokens.length,
    revokedTokenCount
  };
}

async function buildTemplateRoleInventory(config: import("./access-config.js").YamlAccessConfig): Promise<RoleInventoryEntry[]> {
  const { ROLE_TEMPLATES, expandTemplate } = await import("./role-templates.js");
  void ROLE_TEMPLATES;
  const entries: RoleInventoryEntry[] = [];
  for (const roleId of Object.keys(ROLE_TEMPLATES)) {
    if (config.roles?.[roleId]?.allow) continue;
    const expanded = expandTemplate(roleId);
    if (!expanded) continue;
    const resolution = await readRoleResolutionForInventory(roleId);
    const usageCount = config.users.filter((user) => user.role === roleId).length;
    entries.push({
      id: roleId,
      source: "template",
      description: expanded.description,
      usageCount,
      sourceCount: resolution.sourceCount,
      broken: !resolution.ok,
      invalidReason: resolution.ok ? undefined : resolution.reason
    });
  }
  return entries;
}

// ─── Denial summary ──────────────────────────────────────────────────────────

interface DenialSummaryInput {
  windowHours: number;
  now: Date;
  unavailableReason?: string;
}

async function buildDenialSummary(
  input: DenialSummaryInput
): Promise<DenialSummaryBlock> {
  if (input.unavailableReason) {
    return {
      totalCalls: 0,
      deniedCalls: 0,
      denialRate: 0,
      topReasons: [],
      topAffectedTools: [],
      unavailableReason: input.unavailableReason
    };
  }
  let db;
  try {
    db = await getAuditDb();
  } catch (error) {
    return {
      totalCalls: 0,
      deniedCalls: 0,
      denialRate: 0,
      topReasons: [],
      topAffectedTools: [],
      unavailableReason: error instanceof Error ? error.message : "access_log unavailable"
    };
  }
  const isoCutoff = new Date(input.now.getTime() - input.windowHours * 3_600_000).toISOString();
  try {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS calls,
                SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied
         FROM access_log WHERE ts >= ?`
      )
      .get(isoCutoff) as { calls: number | null; denied: number | null };
    const totalCalls = totals?.calls ?? 0;
    const deniedCalls = totals?.denied ?? 0;
    const denialRate = totalCalls > 0 ? Number((deniedCalls / totalCalls).toFixed(4)) : 0;

    const reasons = db
      .prepare(
        `SELECT COALESCE(decision_reason, 'unspecified') AS reason, COUNT(*) AS cnt
         FROM access_log
         WHERE outcome = 'denied' AND ts >= ?
         GROUP BY reason ORDER BY cnt DESC LIMIT 8`
      )
      .all(isoCutoff) as Array<{ reason: string; cnt: number }>;

    const tools = db
      .prepare(
        `SELECT tool, COUNT(*) AS cnt
         FROM access_log
         WHERE outcome = 'denied' AND ts >= ?
         GROUP BY tool ORDER BY cnt DESC LIMIT 8`
      )
      .all(isoCutoff) as Array<{ tool: string; cnt: number }>;

    return {
      totalCalls,
      deniedCalls,
      denialRate,
      topReasons: reasons.map((row) => ({ reason: sanitizeTopReason(row.reason), count: row.cnt })),
      topAffectedTools: tools.map((row) => ({ reason: row.tool, count: row.cnt }))
    };
  } catch (error) {
    return {
      totalCalls: 0,
      deniedCalls: 0,
      denialRate: 0,
      topReasons: [],
      topAffectedTools: [],
      unavailableReason: error instanceof Error ? error.message : "access_log query failed"
    };
  }
}

function sanitizeTopReason(reason: string): string {
  // Reasons are short categorical codes; never include raw payloads here.
  if (typeof reason !== "string") return "unspecified";
  return reason.slice(0, 64);
}

// ─── Config change summary ───────────────────────────────────────────────────

interface ConfigChangeSummaryInput {
  sinceISO?: string;
  unavailableReason?: string;
}

async function buildConfigChangeSummary(
  input: ConfigChangeSummaryInput
): Promise<ConfigChangeSummaryBlock> {
  if (input.unavailableReason) {
    return {
      totalChanges: 0,
      byChangeType: {},
      byFilePath: {},
      byAssetKind: {},
      lastChangeAt: null,
      unavailableReason: input.unavailableReason
    };
  }
  let db;
  try {
    db = await getAuditDb();
  } catch (error) {
    return {
      totalChanges: 0,
      byChangeType: {},
      byFilePath: {},
      byAssetKind: {},
      lastChangeAt: null,
      unavailableReason: error instanceof Error ? error.message : "config_change_log unavailable"
    };
  }
  try {
    const where = input.sinceISO ? "WHERE ts >= ?" : "";
    const params = input.sinceISO ? [input.sinceISO] : [];
    const total = db
      .prepare(`SELECT COUNT(*) AS cnt FROM config_change_log ${where}`)
      .get(...params) as { cnt: number };
    const byType = db
      .prepare(
        `SELECT change_type, COUNT(*) AS cnt FROM config_change_log ${where}
         GROUP BY change_type ORDER BY cnt DESC LIMIT 16`
      )
      .all(...params) as Array<{ change_type: string; cnt: number }>;
    const byFile = db
      .prepare(
        `SELECT file_path, COUNT(*) AS cnt FROM config_change_log ${where}
         GROUP BY file_path ORDER BY cnt DESC LIMIT 16`
      )
      .all(...params) as Array<{ file_path: string; cnt: number }>;
    const byAsset = db
      .prepare(
        `SELECT asset_kind, COUNT(*) AS cnt FROM config_change_log ${where}
         GROUP BY asset_kind ORDER BY cnt DESC LIMIT 16`
      )
      .all(...params) as Array<{ asset_kind: string | null; cnt: number }>;
    const last = db
      .prepare(`SELECT MAX(ts) AS last_ts FROM config_change_log ${where}`)
      .get(...params) as { last_ts: string | null };

    const byChangeType: Record<string, number> = {};
    for (const row of byType) byChangeType[row.change_type] = row.cnt;
    const byFilePath: Record<string, number> = {};
    for (const row of byFile) byFilePath[row.file_path] = row.cnt;
    const byAssetKind: Record<string, number> = {};
    for (const row of byAsset) byAssetKind[row.asset_kind ?? "governance"] = row.cnt;

    return {
      totalChanges: total.cnt ?? 0,
      byChangeType,
      byFilePath,
      byAssetKind,
      lastChangeAt: last.last_ts ?? null
    };
  } catch (error) {
    return {
      totalChanges: 0,
      byChangeType: {},
      byFilePath: {},
      byAssetKind: {},
      lastChangeAt: null,
      unavailableReason: error instanceof Error ? error.message : "config_change_log query failed"
    };
  }
}

// ─── Security eval summary ───────────────────────────────────────────────────

async function buildSecurityEvalSummary(): Promise<SecurityEvalSummaryBlock> {
  // Optional source: if the security candidate pool exists, report bounded
  // counts from it; otherwise surface an explicit skipped note.
  let db;
  try {
    db = await Promise.race([
      getEvalDb(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("eval db unavailable")), 100))
    ]);
  } catch {
    return {
      status: "unavailable",
      reason: "security candidate pool not yet delivered by 202608-GOV-04; this section is skipped",
      skipped: true
    };
  }
  try {
    const candidateTable = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'security_eval_candidate'`)
      .get() as { name: string } | undefined;
    if (!candidateTable?.name) {
      return {
        status: "unavailable",
        reason: "security candidate pool not yet delivered by 202608-GOV-04; this section is skipped",
        skipped: true
      };
    }
    const candidateCountRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM security_eval_candidate`)
      .get() as { cnt: number | null } | undefined;
    const promotedCountRow = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM security_eval_candidate
         WHERE status IN ('promoted', 'promoted_to_eval', 'formal')`
      )
      .get() as { cnt: number | null } | undefined;
    return {
      status: "available",
      candidateCount: candidateCountRow?.cnt ?? 0,
      promotedCount: promotedCountRow?.cnt ?? 0
    };
  } catch {
    return {
      status: "unavailable",
      reason: "security candidate tables are not queryable; this section is skipped",
      skipped: true
    };
  }
}

// ─── Risk review summary ─────────────────────────────────────────────────────

async function buildRiskReviewSummary(
  reviewWindowHours: number,
  now: Date
): Promise<RiskReviewSummaryBlock> {
  const collection = await collectRiskReviewCandidates({ reviewWindowHours, now });
  return {
    generatedAt: collection.generatedAt,
    reviewWindowHours: collection.reviewWindowHours,
    summary: summarizeRiskReview(collection.candidates),
    factSources: collection.factSources
  };
}

// ─── Top-level package builder ───────────────────────────────────────────────

export interface BuildReleaseReadinessPackageOptions {
  reviewWindowHours?: number;
  now?: Date;
}

export const DEFAULT_REVIEW_WINDOW_HOURS = 168;

export async function buildReleaseReadinessPackage(
  options: BuildReleaseReadinessPackageOptions = {}
): Promise<ReleaseReadinessPackage> {
  const now = options.now ?? new Date();
  const reviewWindowHours = options.reviewWindowHours ?? DEFAULT_REVIEW_WINDOW_HOURS;

  const projectRoot = await resolveProjectRoot();
  const accessFile = await readAccessYaml(projectRoot);
  const [inventory, denialSummary, configChangeSummary, securityEvalSummary, riskReviewSummary] = await Promise.all([
    buildInventory(reviewWindowHours, now),
    buildDenialSummary({ windowHours: reviewWindowHours, now }),
    buildConfigChangeSummary({}),
    buildSecurityEvalSummary(),
    buildRiskReviewSummary(reviewWindowHours, now)
  ]);

  const factSourcesUsed: string[] = ["access_yaml", "audit_db_access_log", "audit_db_config_change_log"];
  if (securityEvalSummary.status === "available") factSourcesUsed.push("eval_db");
  if (riskReviewSummary.factSources.revokedTokens === "available") factSourcesUsed.push("audit_db_revoked_tokens");

  return {
    generatedAt: now.toISOString(),
    accessConfigHash: accessFile.version,
    factSourcesUsed,
    inventory,
    denialSummary,
    configChangeSummary,
    securityEvalSummary,
    riskReviewSummary,
    knownLimitations: [...KNOWN_LIMITATIONS],
    schemaVersion: "202608-gov-06.v1"
  };
}

// ─── Markdown rendering ──────────────────────────────────────────────────────

export function renderReleaseReadinessMarkdown(pkg: ReleaseReadinessPackage): string {
  const lines: string[] = [];
  lines.push("# 202608 Governance Release Readiness Evidence Package");
  lines.push("");
  lines.push(`- Schema version: \`${pkg.schemaVersion}\``);
  lines.push(`- schemaVersion: \`${pkg.schemaVersion}\``);
  lines.push(`- Generated at: \`${pkg.generatedAt}\``);
  lines.push(`- Access config hash: \`${pkg.accessConfigHash}\``);
  lines.push(`- Fact sources used: ${pkg.factSourcesUsed.map((source) => `\`${source}\``).join(", ")}`);
  lines.push("");
  lines.push("> This is the single release readiness evidence package. It uses one audience-neutral package shape and includes only current Agent / Role / Token / ACL / Audit / Eval facts. Token plaintext, raw result rows, raw SQL AST, full original question, DB credentials, and customer row samples are excluded.");
  lines.push("");

  lines.push("## 1. Inventory");
  lines.push("");
  lines.push(`- Agent total: ${pkg.inventory.agentCount} (enabled: ${pkg.inventory.enabledAgentCount})`);
  lines.push(`- Role total: ${pkg.inventory.roleCount} (yaml: ${pkg.inventory.yamlRoleCount}, template: ${pkg.inventory.templateRoleCount})`);
  lines.push(`- Token total: ${pkg.inventory.tokenCount} (revoked: ${pkg.inventory.revokedTokenCount})`);
  lines.push("");
  lines.push("### Agents");
  lines.push("");
  lines.push("| Agent ID | Enabled | Role | Tokens | Calls (window) | Denied (window) | Last seen |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const agent of pkg.inventory.agents) {
    lines.push(
      `| \`${agent.id}\` | ${agent.enabled ? "yes" : "no"} | ${agent.role ? `\`${agent.role}\`` : "—"} | ${agent.tokenCount} | ${agent.callsLastWindow} | ${agent.deniedLastWindow} | ${agent.lastSeen ?? "—"} |`
    );
  }
  lines.push("");
  lines.push("### Roles");
  lines.push("");
  lines.push("| Role ID | Source | Usage count | Source count | Broken |");
  lines.push("|---|---|---|---|---|");
  for (const role of pkg.inventory.roles) {
    lines.push(
      `| \`${role.id}\` | ${role.source} | ${role.usageCount} | ${role.sourceCount} | ${role.broken ? `yes (\`${role.invalidReason ?? "unknown"}\`)` : "no"} |`
    );
  }
  lines.push("");
  lines.push("### Tokens");
  lines.push("");
  lines.push("| Agent | Label | Hash prefix | Created | Last used | Revoked |");
  lines.push("|---|---|---|---|---|---|");
  for (const token of pkg.inventory.tokens) {
    lines.push(
      `| \`${token.userId}\` | \`${token.label}\` | \`${token.hashPrefix}\` | ${token.created} | ${token.lastUsed ?? "—"} | ${token.revoked ? "yes" : "no"} |`
    );
  }
  lines.push("");

  lines.push("## 2. Denial Summary");
  lines.push("");
  if (pkg.denialSummary.unavailableReason) {
    lines.push(`- unavailable: ${pkg.denialSummary.unavailableReason}`);
  } else {
    lines.push(`- Total calls (window): ${pkg.denialSummary.totalCalls}`);
    lines.push(`- Denied calls: ${pkg.denialSummary.deniedCalls} (rate ${(pkg.denialSummary.denialRate * 100).toFixed(2)}%)`);
    lines.push("");
    lines.push("### Top denial reasons");
    lines.push("");
    lines.push("| Reason | Count |");
    lines.push("|---|---|");
    for (const row of pkg.denialSummary.topReasons) {
      lines.push(`| \`${row.reason}\` | ${row.count} |`);
    }
    lines.push("");
    lines.push("### Top affected tools");
    lines.push("");
    lines.push("| Tool | Count |");
    lines.push("|---|---|");
    for (const row of pkg.denialSummary.topAffectedTools) {
      lines.push(`| \`${row.reason}\` | ${row.count} |`);
    }
  }
  lines.push("");

  lines.push("## 3. Config Change Summary");
  lines.push("");
  if (pkg.configChangeSummary.unavailableReason) {
    lines.push(`- unavailable: ${pkg.configChangeSummary.unavailableReason}`);
  } else {
    lines.push(`- Total changes: ${pkg.configChangeSummary.totalChanges}`);
    lines.push(`- Last change at: ${pkg.configChangeSummary.lastChangeAt ?? "—"}`);
    lines.push("");
    lines.push("### By change type");
    lines.push("");
    lines.push("| Change type | Count |");
    lines.push("|---|---|");
    for (const [key, value] of Object.entries(pkg.configChangeSummary.byChangeType)) {
      lines.push(`| \`${key}\` | ${value} |`);
    }
    lines.push("");
    lines.push("### By file path");
    lines.push("");
    lines.push("| File path | Count |");
    lines.push("|---|---|");
    for (const [key, value] of Object.entries(pkg.configChangeSummary.byFilePath)) {
      lines.push(`| \`${key}\` | ${value} |`);
    }
  }
  lines.push("");

  lines.push("## 4. Security Eval Summary");
  lines.push("");
  if (pkg.securityEvalSummary.status === "available") {
    lines.push(`- Candidate count: ${pkg.securityEvalSummary.candidateCount ?? 0}`);
    lines.push(`- Promoted count: ${pkg.securityEvalSummary.promotedCount ?? 0}`);
  } else {
    lines.push(`- unavailable: ${pkg.securityEvalSummary.reason ?? "unknown"}`);
  }
  lines.push("");

  lines.push("## 5. Risk Review Candidate Summary");
  lines.push("");
  lines.push(`- Generated at: \`${pkg.riskReviewSummary.generatedAt}\``);
  lines.push(`- Review window: ${pkg.riskReviewSummary.reviewWindowHours}h`);
  lines.push(`- Total candidates: ${pkg.riskReviewSummary.summary.totalCount}`);
  lines.push(`- By severity: P0=${pkg.riskReviewSummary.summary.bySeverity.P0}, P1=${pkg.riskReviewSummary.summary.bySeverity.P1}, P2=${pkg.riskReviewSummary.summary.bySeverity.P2}`);
  if (Object.keys(pkg.riskReviewSummary.summary.byKind).length > 0) {
    lines.push("- By kind:");
    for (const [kind, count] of Object.entries(pkg.riskReviewSummary.summary.byKind)) {
      lines.push(`  - \`${kind}\`: ${count}`);
    }
  }
  lines.push(`- Fact sources: accessYaml=${pkg.riskReviewSummary.factSources.accessYaml}, accessLog=${pkg.riskReviewSummary.factSources.accessLog}, revokedTokens=${pkg.riskReviewSummary.factSources.revokedTokens}`);
  lines.push("");
  if (pkg.riskReviewSummary.summary.candidateIds.length > 0) {
    lines.push("### Candidate IDs");
    lines.push("");
    for (const id of pkg.riskReviewSummary.summary.candidateIds) {
      lines.push(`- \`${id}\``);
    }
    lines.push("");
  }

  lines.push("## 6. Known Limitations");
  lines.push("");
  for (const limit of pkg.knownLimitations) {
    lines.push(`- ${limit}`);
  }
  lines.push("");

  lines.push("## 7. Package Integrity");
  lines.push("");
  lines.push(`- Package hash (sha256, head 16 chars): \`${hashPackage(pkg)}\``);
  lines.push(`- Generated by: \`local-admin\` (deployment-local identity only)`);
  lines.push("");
  return lines.join("\n");
}

function hashPackage(pkg: ReleaseReadinessPackage): string {
  // Re-emit only the deterministic fields, never include generatedAt.
  const deterministic = {
    schemaVersion: pkg.schemaVersion,
    accessConfigHash: pkg.accessConfigHash,
    inventory: pkg.inventory,
    denialSummary: pkg.denialSummary,
    configChangeSummary: pkg.configChangeSummary,
    securityEvalSummary: pkg.securityEvalSummary,
    riskReviewSummary: pkg.riskReviewSummary
  };
  return createHash("sha256").update(JSON.stringify(deterministic)).digest("hex").slice(0, 16);
}

// ─── Markdown export ─────────────────────────────────────────────────────────

export interface WriteReleaseReadinessMarkdownOptions {
  outputPath?: string;
  /** When true, the markdown includes the integrity hash. Defaults to true. */
  includeIntegrity?: boolean;
}

export const DEFAULT_RELEASE_READINESS_MD = "inbox/202608-governance-release-readiness.md";

export async function writeReleaseReadinessMarkdown(
  packageData: ReleaseReadinessPackage,
  options: WriteReleaseReadinessMarkdownOptions = {}
): Promise<{ path: string; sha256: string; bytes: number }> {
  const projectRoot = await resolveProjectRoot();
  const outputPath = options.outputPath ?? path.join(projectRoot, DEFAULT_RELEASE_READINESS_MD);
  const markdown = renderReleaseReadinessMarkdown(packageData);
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, markdown, "utf-8");
  const sha256 = createHash("sha256").update(markdown).digest("hex");
  return { path: outputPath, sha256, bytes: Buffer.byteLength(markdown, "utf-8") };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function registerReleaseReadinessRoutes(app: import("fastify").FastifyInstance): void {
  app.get("/api/admin/governance/release-readiness-package", async (request, reply) => {
    const q = (request.query ?? {}) as { reviewWindowHours?: string };
    const parsedWindow = Number.parseInt(q.reviewWindowHours ?? "", 10);
    const reviewWindowHours = Number.isFinite(parsedWindow) && parsedWindow > 0
      ? Math.min(parsedWindow, 24 * 30)
      : undefined;
    try {
      const pkg = await buildReleaseReadinessPackage(
        reviewWindowHours !== undefined ? { reviewWindowHours } : {}
      );
      return { ok: true, data: pkg };
    } catch (error) {
      reply.status(500);
      return {
        ok: false,
        error: {
          code: "RELEASE_READINESS_PACKAGE_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  });
}
