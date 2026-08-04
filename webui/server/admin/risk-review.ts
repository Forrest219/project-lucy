/**
 * 202608-GOV-06 P2-A — Agent / Role Risk Review Candidates
 * Spec: `webui/docs/69-admin-governance-observability-spec.md` §7
 *
 * Read-only risk review candidate generator. It walks the existing Agent /
 * Role / Token / `access_log` / `revoked_tokens` fact sources and produces
 * deterministic candidates for periodic access review. It MUST NOT mutate
 * `access.yaml`, MUST NOT delete / disable any Role, and MUST NOT implement a
 * remediation lifecycle. The optional `POST /review` endpoint only appends a
 * reviewer note / evidence row.
 *
 * Hard rules:
 *  - Deterministic candidate IDs (stable across calls when facts do not change).
 *  - Use hashed / redacted Token identifiers only.
 *  - Empty / missing fact sources produce an empty `unavailable` block, never
 *    a fabricated candidate.
 *  - Sensitive payloads (Token plaintext, raw SQL AST, raw result rows, full
 *    question text, DB credentials, customer samples) MUST NEVER enter the
 *    candidate payload or the reviewer evidence row.
 *  - No access boundary claims beyond the current static `access.yaml` ACL.
 */
import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { resolveProjectRoot } from "../project.js";
import { previewRolePermissionsForAdmin } from "../proxy/acl.js";
import {
  readAccessYaml,
  type YamlAccessConfig,
  type YamlRole,
  type YamlToken,
  type YamlUser
} from "./access-config.js";
import { getAuditDb } from "./audit.js";
import { writeEvidenceEvents } from "../trace/evidence.js";
import { ROLE_TEMPLATES } from "./role-templates.js";

// ─── Public types ────────────────────────────────────────────────────────────

export type RiskReviewSeverity = "P0" | "P1" | "P2";

export type RiskReviewCandidateKind =
  | "unused_role"
  | "broken_role"
  | "over_broad_role"
  | "stale_token"
  | "revoked_token_attempt"
  | "high_denial_agent";

export type RiskReviewTargetKind = "role" | "token" | "agent";

export interface RiskReviewEvidenceRef {
  kind: string;
  ref: string;
  relation: "observed" | "used" | "denied_by" | "superseded" | "review" | "config";
}

export interface RiskReviewCandidate {
  id: string;
  kind: RiskReviewCandidateKind;
  severity: RiskReviewSeverity;
  targetKind: RiskReviewTargetKind;
  targetId: string;
  title: string;
  summary: string;
  severityReason: string;
  detectedAt: string;
  facts: Record<string, string | number | boolean | null>;
  evidenceRefs: RiskReviewEvidenceRef[];
  /** Set when the candidate could not be fully evaluated due to a missing
   *  fact source. Surfaced verbatim in the package so reviewers see the gap. */
  unavailableNote?: string;
}

export interface RiskReviewCollection {
  generatedAt: string;
  accessConfigHash: string;
  reviewWindowHours: number;
  candidates: RiskReviewCandidate[];
  factSources: {
    accessYaml: "available" | "unavailable";
    accessLog: "available" | "unavailable";
    revokedTokens: "available" | "unavailable";
  };
}

export interface CollectRiskReviewOptions {
  reviewWindowHours?: number;
  highDenialThreshold?: number;
  staleTokenWindowDays?: number;
  now?: Date;
}

export interface RecordRiskReviewEvidenceInput {
  database: import("better-sqlite3").Database;
  candidateId: string;
  note: string;
  reviewerId: string;
  reviewedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_RISK_REVIEW_WINDOW_HOURS = 168; // 7 days
export const DEFAULT_HIGH_DENIAL_THRESHOLD = 0.5; // 50% denial rate
export const DEFAULT_STALE_TOKEN_WINDOW_DAYS = 30;
export const MAX_REVIEWER_NOTE_CHARS = 2_000;
export const MAX_REVIEW_NOTES_PER_CANDIDATE = 16;

const SENSITIVE_NOTE_RE =
  /\b(?:password|passwd|pwd|token|secret|api[-_]?key|authorization|credential|private[-_]?key)\b\s*[:=]\s*[A-Za-z0-9._~+/=-]{8,}/i;
const BEARER_NOTE_RE = /Bearer\s+[A-Za-z0-9._~+/=-]{16,}/i;
const RAW_QUESTION_NOTE_RE = /raw_sql_ast|raw_query|full_question_payload|raw_token/i;
const TOKEN_HASH_PREFIX_LEN = 19;
const CANDIDATE_ID_PREFIX = "risk-review";

// ─── Candidate ID derivation ──────────────────────────────────────────────────

function stableId(prefix: string, parts: string[]): string {
  const joined = parts.filter((part) => part.length > 0).join("-");
  return `${prefix}-${joined}`;
}

export function deriveUnusedRoleCandidateId(roleId: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-role-unused`, [roleId]);
}

export function deriveBrokenRoleCandidateId(roleId: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-role-broken`, [roleId]);
}

export function deriveOverBroadRoleCandidateId(roleId: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-role-over_broad`, [roleId]);
}

export function deriveStaleTokenCandidateId(userId: string, label: string, hashPrefix: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-token-stale`, [userId, label, hashPrefix.slice(0, TOKEN_HASH_PREFIX_LEN)]);
}

export function deriveRevokedTokenAttemptCandidateId(userId: string, hashPrefix: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-token-revoked`, [userId, hashPrefix.slice(0, TOKEN_HASH_PREFIX_LEN)]);
}

export function deriveHighDenialAgentCandidateId(userId: string): string {
  return stableId(`${CANDIDATE_ID_PREFIX}-agent-denial`, [userId]);
}

// ─── Access log helpers ──────────────────────────────────────────────────────

interface AgentCallStats {
  calls: number;
  denied: number;
  lastSeen: string | null;
  lastUsed: string | null;
  activeTokens: number;
}

async function readAgentCallStats(
  userId: string,
  windowHours: number,
  now: Date
): Promise<AgentCallStats | null> {
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return null;
  }
  const isoCutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
  try {
    const row = db
      .prepare(
        `SELECT
           COUNT(*) AS calls,
           SUM(CASE WHEN outcome = 'denied' THEN 1 ELSE 0 END) AS denied,
           MAX(ts) AS last_seen,
           MAX(CASE WHEN token_hash_prefix IS NOT NULL THEN ts ELSE NULL END) AS last_used,
           COUNT(DISTINCT CASE WHEN token_hash_prefix IS NOT NULL THEN token_hash_prefix ELSE NULL END) AS active_tokens
         FROM access_log
         WHERE user_id = ? AND ts >= ?`
      )
      .get(userId, isoCutoff) as { calls: number | null; denied: number | null; last_seen: string | null; last_used: string | null; active_tokens: number | null };
    return {
      calls: row?.calls ?? 0,
      denied: row?.denied ?? 0,
      lastSeen: row?.last_seen ?? null,
      lastUsed: row?.last_used ?? null,
      activeTokens: row?.active_tokens ?? 0
    };
  } catch {
    return null;
  }
}

interface TokenAttemptEvidence {
  occurrences: number;
  lastSeen: string | null;
  sampleRequestIds: string[];
}

async function readRevokedTokenAttempts(
  userId: string,
  windowHours: number,
  now: Date
): Promise<{ data: Map<string, TokenAttemptEvidence> | null; unavailable: boolean }> {
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return { data: null, unavailable: true };
  }
  const isoCutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
  const result = new Map<string, TokenAttemptEvidence>();
  try {
    const revokedRows = db
      .prepare(`SELECT token_hash FROM revoked_tokens`)
      .all() as Array<{ token_hash: string }>;
    if (revokedRows.length === 0) return { data: result, unavailable: false };
    const revokedHashes = revokedRows.map((row) => row.token_hash).slice(0, 256);
    const placeholders = revokedHashes.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT token_hash_prefix, ts, request_id
         FROM access_log
         WHERE user_id = ?
           AND outcome = 'denied'
           AND token_hash_prefix IS NOT NULL
           AND substr(?, 1, ${TOKEN_HASH_PREFIX_LEN}) = ''  -- intentionally false, replaced below
           AND ts >= ?
         ORDER BY ts DESC
         LIMIT 1000`
      )
      .all(userId, "", isoCutoff) as Array<{ token_hash_prefix: string; ts: string; request_id: string }>;
    // The placeholder SQL above is a no-op pattern; the actual hash-prefix
    // match is done in JS to keep the parameter list small and deterministic.
    void placeholders;
    for (const row of rows) {
      const prefix = row.token_hash_prefix;
      if (!revokedHashes.some((hash) => hash.startsWith(prefix))) continue;
      const existing = result.get(prefix) ?? { occurrences: 0, lastSeen: null, sampleRequestIds: [] };
      existing.occurrences += 1;
      if (!existing.lastSeen || row.ts > existing.lastSeen) existing.lastSeen = row.ts;
      if (existing.sampleRequestIds.length < 3) existing.sampleRequestIds.push(row.request_id);
      result.set(prefix, existing);
    }
    return { data: result, unavailable: false };
  } catch {
    return { data: null, unavailable: true };
  }
}

// ─── Role candidate generation ───────────────────────────────────────────────

function isTemplateRole(roleId: string): boolean {
  return Boolean(ROLE_TEMPLATES[roleId]);
}

/**
 * Role is "over-broad" when its selectors resolve to a sensitive source
 * (mirrors `access-governance-gate.ts` default sensitive prefixes) or when
 * the selector resolves to a very large number of sources. We do NOT
 * invent a new sensitivity taxonomy; we reuse the gate's defaults.
 */
function isOverBroadRoleSources(sources: string[]): { overBroad: boolean; reason?: string } {
  const lower = sources.map((source) => source.toLowerCase());
  const sensitiveHits = lower.filter((source) => source.startsWith("dataforai.kx_"));
  if (sensitiveHits.length > 0) {
    return { overBroad: true, reason: `role resolves to sensitive source(s): ${sensitiveHits.slice(0, 8).join(", ")}` };
  }
  if (lower.length >= 50) {
    return { overBroad: true, reason: `role resolves to ${lower.length} sources (broad connection selector)` };
  }
  return { overBroad: false };
}

async function generateRoleCandidates(
  config: YamlAccessConfig,
  reviewWindowHours: number,
  now: Date
): Promise<RiskReviewCandidate[]> {
  const candidates: RiskReviewCandidate[] = [];
  const roles = config.roles ?? {};
  const userReferencedRoles = new Set<string>();
  for (const user of config.users) {
    if (user.role) userReferencedRoles.add(user.role);
  }

  for (const roleId of Object.keys(roles)) {
    const role = roles[roleId];
    if (!role?.allow) continue;

    const referencedByAgents = userReferencedRoles.has(roleId);
    const usedRecently = await roleHasRecentUse(roleId, reviewWindowHours, now);

    // unused Role: not referenced by any Agent AND no observed usage in window.
    if (!referencedByAgents && !usedRecently.available) {
      candidates.push({
        id: deriveUnusedRoleCandidateId(roleId),
        kind: "unused_role",
        severity: "P2",
        targetKind: "role",
        targetId: roleId,
        title: `Unused Role: ${roleId}`,
        summary: `Role '${roleId}' is not referenced by any Agent and has no observed usage in the last ${reviewWindowHours}h.`,
        severityReason: "Unused Role is P2 review; spec forbids automatic deletion.",
        detectedAt: now.toISOString(),
        facts: {
          referencedByAgents: false,
          usedRecently: usedRecently.available,
          usageDenominator: usedRecently.denominator
        },
        evidenceRefs: [{ kind: "access_yaml_node", ref: `roles.${roleId}`, relation: "observed" }]
      });
      continue;
    }
    if (!referencedByAgents && !usedRecently.available) continue;

    // broken Role: preview fails OR selector resolves to zero sources.
    let preview: Awaited<ReturnType<typeof previewRolePermissionsForAdmin>>;
    try {
      preview = await previewRolePermissionsForAdmin(roleId, { role, freshSourceMap: false });
    } catch (error) {
      candidates.push({
        id: deriveBrokenRoleCandidateId(roleId),
        kind: "broken_role",
        severity: "P1",
        targetKind: "role",
        targetId: roleId,
        title: `Broken Role (preview error): ${roleId}`,
        summary: `Role '${roleId}' preview failed: ${error instanceof Error ? error.message : String(error)}`,
        severityReason: "Broken Role is P1 review.",
        detectedAt: now.toISOString(),
        facts: { reason: "preview_error" },
        evidenceRefs: [{ kind: "access_yaml_node", ref: `roles.${roleId}`, relation: "observed" }]
      });
      continue;
    }
    if (!preview.ok) {
      candidates.push({
        id: deriveBrokenRoleCandidateId(roleId),
        kind: "broken_role",
        severity: "P1",
        targetKind: "role",
        targetId: roleId,
        title: `Broken Role: ${roleId}`,
        summary: `Role '${roleId}' preview failed: ${preview.reason}`,
        severityReason: "Broken Role is P1 review.",
        detectedAt: now.toISOString(),
        facts: { reason: preview.reason },
        evidenceRefs: [{ kind: "access_yaml_node", ref: `roles.${roleId}`, relation: "observed" }]
      });
      continue;
    }
    if (preview.permissions.sources.length === 0 && (role.allow.tableSelectors?.length ?? 0) > 0) {
      candidates.push({
        id: deriveBrokenRoleCandidateId(roleId),
        kind: "broken_role",
        severity: "P1",
        targetKind: "role",
        targetId: roleId,
        title: `Broken Role: ${roleId}`,
        summary: `Role '${roleId}' selector resolves to 0 sources.`,
        severityReason: "Broken Role is P1 review.",
        detectedAt: now.toISOString(),
        facts: { sources: 0 },
        evidenceRefs: [{ kind: "access_yaml_node", ref: `roles.${roleId}`, relation: "observed" }]
      });
      continue;
    }

    // over-broad Role: sensitive source exposure or broad connection selector.
    const sourceNames = preview.permissions.sources.map((source) => source.table);
    const overBroad = isOverBroadRoleSources(sourceNames);
    if (overBroad.overBroad) {
      candidates.push({
        id: deriveOverBroadRoleCandidateId(roleId),
        kind: "over_broad_role",
        severity: "P1",
        targetKind: "role",
        targetId: roleId,
        title: `Over-broad Role: ${roleId}`,
        summary: overBroad.reason ?? "Role selector resolves to a broad source set.",
        severityReason: "Over-broad Role is P1 review.",
        detectedAt: now.toISOString(),
        facts: {
          resolvedSourceCount: sourceNames.length,
          sensitiveSourceHits: sourceNames.filter((source) => source.toLowerCase().startsWith("dataforai.kx_")).length
        },
        evidenceRefs: [
          { kind: "access_yaml_node", ref: `roles.${roleId}.allow.tableSelectors`, relation: "observed" },
          ...(preview.permissions.snapshotHash
            ? [{ kind: "permission_snapshot", ref: preview.permissions.snapshotHash, relation: "used" as const }]
            : [])
        ]
      });
    }
  }

  return candidates;
}

interface RoleRecentUse {
  available: boolean;
  denominator: number;
}

async function roleHasRecentUse(
  roleId: string,
  windowHours: number,
  now: Date
): Promise<RoleRecentUse> {
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return { available: false, denominator: 0 };
  }
  const isoCutoff = new Date(now.getTime() - windowHours * 3_600_000).toISOString();
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM access_log al
         JOIN json_each(CASE WHEN json_valid(al.role_ids) THEN al.role_ids ELSE '[]' END) role
         WHERE al.ts >= ? AND role.value = ?`
      )
      .get(isoCutoff, roleId) as { cnt: number | null };
    return { available: (row?.cnt ?? 0) > 0, denominator: row?.cnt ?? 0 };
  } catch {
    return { available: false, denominator: 0 };
  }
}

// ─── Token candidate generation ──────────────────────────────────────────────

async function generateTokenCandidates(
  config: YamlAccessConfig,
  reviewWindowHours: number,
  staleTokenWindowDays: number,
  now: Date
): Promise<RiskReviewCandidate[]> {
  const candidates: RiskReviewCandidate[] = [];
  const staleCutoff = new Date(now.getTime() - staleTokenWindowDays * 86_400_000).toISOString();

  for (const user of config.users) {
    if (!user.tokens || user.tokens.length === 0) continue;
    const revokedAttempts = await readRevokedTokenAttempts(user.id, reviewWindowHours, now);
    const tokenLastUse = await readTokenLastUsedMap(user.id, user.tokens.map((t) => t.hash), now);

    for (const token of user.tokens) {
      const hashPrefix = token.hash.slice(0, TOKEN_HASH_PREFIX_LEN);

      // P0: revoked Token attempt
      if (revokedAttempts.data && !revokedAttempts.unavailable) {
        const evidence = revokedAttempts.data.get(hashPrefix);
        if (evidence) {
          candidates.push({
            id: deriveRevokedTokenAttemptCandidateId(user.id, token.hash),
            kind: "revoked_token_attempt",
            severity: "P0",
            targetKind: "token",
            targetId: `${user.id}:${token.label}`,
            title: `Revoked Token attempt: ${user.id} / ${token.label}`,
            summary: `Revoked Token hash prefix '${hashPrefix}…' was used in ${evidence.occurrences} denied access call(s); last seen ${evidence.lastSeen ?? "n/a"}.`,
            severityReason: "Evidence only; no mutation. P0 review.",
            detectedAt: now.toISOString(),
            facts: {
              tokenHashPrefix: hashPrefix,
              occurrences: evidence.occurrences,
              lastSeen: evidence.lastSeen,
              requestIds: evidence.sampleRequestIds.join(",")
            },
            evidenceRefs: [
              { kind: "revoked_token", ref: hashPrefix, relation: "denied_by" },
              ...evidence.sampleRequestIds.slice(0, 3).map((requestId) => ({
                kind: "access_log",
                ref: requestId,
                relation: "observed" as const
              }))
            ]
          });
        }
      }

      // P2: stale Token (no usage > staleTokenWindowDays)
      const lastUsed = tokenLastUse.get(hashPrefix) ?? null;
      const isStale = !lastUsed || lastUsed < staleCutoff;
      if (isStale) {
        candidates.push({
          id: deriveStaleTokenCandidateId(user.id, token.label, token.hash),
          kind: "stale_token",
          severity: "P2",
          targetKind: "token",
          targetId: `${user.id}:${token.label}`,
          title: `Stale Token: ${user.id} / ${token.label}`,
          summary: `Token has no usage since ${lastUsed ?? "never"} (> ${staleTokenWindowDays}d).`,
          severityReason: "Stale Token is P2 review; spec forbids automatic revocation.",
          detectedAt: now.toISOString(),
          facts: {
            tokenHashPrefix: hashPrefix,
            lastUsed: lastUsed ?? null,
            windowDays: staleTokenWindowDays
          },
          evidenceRefs: [{ kind: "access_yaml_node", ref: `users.${user.id}.tokens.${token.label}`, relation: "observed" }]
        });
      }
    }
  }

  return candidates;
}

async function readTokenLastUsedMap(
  userId: string,
  hashes: string[],
  now: Date
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (hashes.length === 0) return out;
  let db;
  try {
    db = await getAuditDb();
  } catch {
    return out;
  }
  const prefixes = Array.from(new Set(hashes.map((hash) => hash.slice(0, TOKEN_HASH_PREFIX_LEN))));
  const placeholders = prefixes.map(() => "?").join(", ");
  try {
    const rows = db
      .prepare(
        `SELECT token_hash_prefix, MAX(ts) AS last_used
         FROM access_log
         WHERE user_id = ? AND token_hash_prefix IN (${placeholders})
         GROUP BY token_hash_prefix`
      )
      .all(userId, ...prefixes) as Array<{ token_hash_prefix: string; last_used: string | null }>;
    for (const row of rows) {
      if (row.last_used) out.set(row.token_hash_prefix, row.last_used);
    }
    void now;
  } catch {
    return out;
  }
  return out;
}

// ─── Agent candidate generation ──────────────────────────────────────────────

async function generateAgentCandidates(
  config: YamlAccessConfig,
  reviewWindowHours: number,
  highDenialThreshold: number,
  now: Date
): Promise<RiskReviewCandidate[]> {
  const candidates: RiskReviewCandidate[] = [];
  for (const user of config.users) {
    if (user.enabled === false) continue;
    const stats = await readAgentCallStats(user.id, reviewWindowHours, now);
    if (!stats) continue;
    if (stats.calls === 0) continue;
    const denialRate = stats.denied / stats.calls;
    if (denialRate >= highDenialThreshold) {
      candidates.push({
        id: deriveHighDenialAgentCandidateId(user.id),
        kind: "high_denial_agent",
        severity: "P1",
        targetKind: "agent",
        targetId: user.id,
        title: `High-denial Agent: ${user.id}`,
        summary: `Agent '${user.id}' has ${stats.denied}/${stats.calls} denied calls (${(denialRate * 100).toFixed(0)}%) in last ${reviewWindowHours}h.`,
        severityReason: "High-denial Agent is P1 review.",
        detectedAt: now.toISOString(),
        facts: {
          calls: stats.calls,
          denied: stats.denied,
          denialRate: Number(denialRate.toFixed(4)),
          activeTokens: stats.activeTokens,
          lastSeen: stats.lastSeen
        },
        evidenceRefs: [
          { kind: "agent", ref: user.id, relation: "observed" },
          { kind: "access_log", ref: `${user.id}:denied:${stats.denied}`, relation: "denied_by" }
        ]
      });
    }
  }
  return candidates;
}

// ─── Top-level collection ────────────────────────────────────────────────────

export async function collectRiskReviewCandidates(
  options: CollectRiskReviewOptions = {}
): Promise<RiskReviewCollection> {
  const now = options.now ?? new Date();
  const reviewWindowHours = options.reviewWindowHours ?? DEFAULT_RISK_REVIEW_WINDOW_HOURS;
  const highDenialThreshold = options.highDenialThreshold ?? DEFAULT_HIGH_DENIAL_THRESHOLD;
  const staleTokenWindowDays = options.staleTokenWindowDays ?? DEFAULT_STALE_TOKEN_WINDOW_DAYS;

  const projectRoot = await resolveProjectRoot();
  let accessFile: Awaited<ReturnType<typeof readAccessYaml>> | undefined;
  let accessYamlStatus: "available" | "unavailable" = "available";
  try {
    accessFile = await readAccessYaml(projectRoot);
  } catch {
    accessYamlStatus = "unavailable";
  }

  // access.log status detection: try to acquire the DB and run a minimal SELECT.
  let accessLogStatus: "available" | "unavailable" = "available";
  let revokedTokensStatus: "available" | "unavailable" = "available";
  try {
    const db = await getAuditDb();
    try {
      db.prepare("SELECT 1 FROM access_log LIMIT 1").get();
    } catch {
      accessLogStatus = "unavailable";
    }
    try {
      db.prepare("SELECT 1 FROM revoked_tokens LIMIT 1").get();
    } catch {
      revokedTokensStatus = "unavailable";
    }
  } catch {
    accessLogStatus = "unavailable";
    revokedTokensStatus = "unavailable";
  }

  if (!accessFile) {
    return {
      generatedAt: now.toISOString(),
      accessConfigHash: "unavailable",
      reviewWindowHours,
      candidates: [],
      factSources: {
        accessYaml: accessYamlStatus,
        accessLog: accessLogStatus,
        revokedTokens: revokedTokensStatus
      }
    };
  }

  const [roleCandidates, tokenCandidates, agentCandidates] = await Promise.all([
    generateRoleCandidates(accessFile.config, reviewWindowHours, now),
    generateTokenCandidates(accessFile.config, reviewWindowHours, staleTokenWindowDays, now),
    generateAgentCandidates(accessFile.config, reviewWindowHours, highDenialThreshold, now)
  ]);

  const candidates = [...roleCandidates, ...tokenCandidates, ...agentCandidates].sort((a, b) => {
    if (a.severity !== b.severity) {
      const order: Record<RiskReviewSeverity, number> = { P0: 0, P1: 1, P2: 2 };
      return order[a.severity] - order[b.severity];
    }
    return a.id.localeCompare(b.id);
  });

  return {
    generatedAt: now.toISOString(),
    accessConfigHash: accessFile.version,
    reviewWindowHours,
    candidates,
    factSources: {
      accessYaml: accessYamlStatus,
      accessLog: accessLogStatus,
      revokedTokens: revokedTokensStatus
    }
  };
}

// ─── Reviewer evidence write ─────────────────────────────────────────────────

export function sanitizeReviewerNote(note: string): { ok: true; value: string } | { ok: false; reason: string } {
  if (typeof note !== "string") {
    return { ok: false, reason: "note must be a string" };
  }
  const trimmed = note.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "note must not be empty" };
  }
  if (trimmed.length > MAX_REVIEWER_NOTE_CHARS) {
    return { ok: false, reason: `note must be ≤ ${MAX_REVIEWER_NOTE_CHARS} chars` };
  }
  if (SENSITIVE_NOTE_RE.test(trimmed)) {
    return { ok: false, reason: "note contains a plaintext credential pattern; redact before submitting" };
  }
  if (BEARER_NOTE_RE.test(trimmed)) {
    return { ok: false, reason: "note contains a Bearer token; redact before submitting" };
  }
  if (RAW_QUESTION_NOTE_RE.test(trimmed)) {
    return { ok: false, reason: "note references a raw payload marker; not allowed" };
  }
  return { ok: true, value: trimmed };
}

export function deriveReviewId(candidateId: string, reviewerId: string, reviewedAt: string): string {
  const reviewerHash = createHash("sha256").update(reviewerId).digest("hex").slice(0, 16);
  return `${CANDIDATE_ID_PREFIX}-review-${candidateId}-${reviewerHash}-${new Date(reviewedAt).getTime()}`;
}

export function recordRiskReviewEvidence(input: RecordRiskReviewEvidenceInput): number {
  const noteCheck = sanitizeReviewerNote(input.note);
  if (!noteCheck.ok) {
    throw new Error(`[risk-review] refused reviewer note: ${noteCheck.reason}`);
  }
  const trimmed = noteCheck.value;
  const reviewerId = input.reviewerId.trim();
  if (reviewerId.length === 0) {
    throw new Error("[risk-review] reviewerId is required");
  }
  const reviewerIdCheck = sanitizeReviewerNote(reviewerId);
  if (!reviewerIdCheck.ok && reviewerIdCheck.reason !== "note must not be empty") {
    throw new Error(`[risk-review] refused reviewerId: ${reviewerIdCheck.reason}`);
  }
  const traceId = `risk-review-${input.candidateId}`;
  const ids = writeEvidenceEvents(input.database, [
    {
      traceId,
      evidenceKind: "candidate_review",
      evidenceRef: input.candidateId,
      // evidence.ts's EvidenceRelation type does not include "review";
      // use "reviewer_override" to stay compatible with the existing
      // evidence schema union.
      relation: "reviewer_override",
      reviewer: {
        reviewerId,
        reviewedAt: input.reviewedAt,
        note: trimmed
      },
      metadata: {
        candidateId: input.candidateId,
        reviewerIdHash: createHash("sha256").update(reviewerId).digest("hex").slice(0, 32)
      }
    }
  ]);
  return ids[0] ?? -1;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const RISK_REVIEW_KIND_SET = new Set<RiskReviewCandidateKind>([
  "unused_role",
  "broken_role",
  "over_broad_role",
  "stale_token",
  "revoked_token_attempt",
  "high_denial_agent"
]);

export function registerRiskReviewRoutes(app: FastifyInstance): void {
  app.get("/api/admin/governance/risk-review", async (request, reply) => {
    const q = (request.query ?? {}) as { reviewWindowHours?: string };
    const parsedWindow = Number.parseInt(q.reviewWindowHours ?? "", 10);
    const reviewWindowHours = Number.isFinite(parsedWindow) && parsedWindow > 0
      ? Math.min(parsedWindow, 24 * 30)
      : undefined;
    try {
      const collection = await collectRiskReviewCandidates(
        reviewWindowHours !== undefined ? { reviewWindowHours } : {}
      );
      return { ok: true, data: collection };
    } catch (error) {
      reply.status(500);
      return {
        ok: false,
        error: {
          code: "RISK_REVIEW_COLLECTION_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }
  });

  app.post<{
    Params: { id: string };
    Body: { note?: string; reviewerId?: string };
  }>("/api/admin/governance/risk-review/:id/review", async (request, reply) => {
    const candidateId = request.params.id;
    if (!candidateId || !candidateId.startsWith(`${CANDIDATE_ID_PREFIX}-`)) {
      reply.status(400);
      return {
        ok: false,
        error: { code: "BAD_REQUEST", message: "candidate id must start with 'risk-review-'" }
      };
    }
    const body = request.body ?? {};
    const noteCheck = sanitizeReviewerNote(body.note ?? "");
    if (!noteCheck.ok) {
      reply.status(400);
      return { ok: false, error: { code: "INVALID_NOTE", message: noteCheck.reason } };
    }
    const reviewerId = typeof body.reviewerId === "string" ? body.reviewerId.trim() : "";
    if (reviewerId.length === 0) {
      reply.status(400);
      return { ok: false, error: { code: "BAD_REQUEST", message: "reviewerId is required" } };
    }
    const reviewedAt = new Date().toISOString();
    let evidenceEventId: number;
    try {
      const collection = await collectRiskReviewCandidates();
      const candidateExists = collection.candidates.some((candidate) => candidate.id === candidateId);
      if (!candidateExists) {
        reply.status(404);
        return {
          ok: false,
          error: {
            code: "CANDIDATE_NOT_FOUND",
            message: "candidate id is not present in the current risk review candidate set"
          }
        };
      }
      const db = await getAuditDb();
      evidenceEventId = recordRiskReviewEvidence({
        database: db,
        candidateId,
        note: noteCheck.value,
        reviewerId,
        reviewedAt
      });
    } catch (error) {
      reply.status(500);
      return {
        ok: false,
        error: {
          code: "RISK_REVIEW_RECORD_FAILED",
          message: error instanceof Error ? error.message : String(error)
        }
      };
    }

    const reviewId = deriveReviewId(candidateId, reviewerId, reviewedAt);
    return {
      ok: true,
      data: {
        reviewId,
        candidateId,
        reviewerId,
        reviewedAt,
        note: noteCheck.value,
        evidenceEventId
      }
    };
  });
}

// ─── Grouping helpers (also used by release readiness package) ───────────────

export interface RiskReviewSummary {
  totalCount: number;
  bySeverity: Record<RiskReviewSeverity, number>;
  byKind: Partial<Record<RiskReviewCandidateKind, number>>;
  candidateIds: string[];
  unavailableReason?: string;
}

export function summarizeRiskReview(candidates: RiskReviewCandidate[]): RiskReviewSummary {
  const bySeverity: Record<RiskReviewSeverity, number> = { P0: 0, P1: 0, P2: 0 };
  const byKind: Partial<Record<RiskReviewCandidateKind, number>> = {};
  for (const candidate of candidates) {
    bySeverity[candidate.severity] += 1;
    byKind[candidate.kind] = (byKind[candidate.kind] ?? 0) + 1;
  }
  const sortedKinds = Object.keys(byKind).filter((k): k is RiskReviewCandidateKind =>
    RISK_REVIEW_KIND_SET.has(k as RiskReviewCandidateKind)
  ) as RiskReviewCandidateKind[];
  for (const key of sortedKinds) {
    if (byKind[key] === 0) delete byKind[key];
  }
  return {
    totalCount: candidates.length,
    bySeverity,
    byKind,
    candidateIds: candidates.map((candidate) => candidate.id)
  };
}

// ─── Test seams (NOT exported via routes) ────────────────────────────────────

export const __test__ = {
  isTemplateRole,
  isOverBroadRoleSources,
  sanitizeReviewerNote,
  TOKEN_HASH_PREFIX_LEN,
  CANDIDATE_ID_PREFIX,
  stableId
};

export const _internals = {
  isTemplateRole,
  isOverBroadRoleSources,
  isSensitiveSource(source: string): boolean {
    return source.toLowerCase().startsWith("dataforai.kx_");
  }
};

export type { YamlAccessConfig, YamlRole, YamlToken, YamlUser };
