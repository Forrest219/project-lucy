import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import type { FastifyInstance } from "fastify";
import { previewDiff } from "../diff.js";
import { resolveProjectRoot } from "../project.js";
import { getAuditDb } from "../admin/audit.js";
import { auditedWriteFile } from "../admin/config-audit-write.js";
import { getEvalDb } from "./db.js";
import {
  hashArtifact,
  writeEvidenceEvents,
  writeTraceEvent,
  type EvidenceRelation
} from "../trace/evidence.js";

type RiskTier = "P0" | "P1";
type CandidateStatus = "candidate" | "accepted" | "rejected" | "promoted";

type AccessLogSecurityRow = {
  id: number;
  ts: string;
  user_id: string;
  token_hash_prefix: string | null;
  tool: string;
  tables: string | null;
  args_summary: string | null;
  outcome: string;
  error_detail: string | null;
  request_id: string;
  trace_id: string | null;
  role_ids: string | null;
  permission_snapshot_hash: string | null;
  decision_reason: string | null;
  query_preview: string | null;
};

export type SecurityEvalCandidateRow = {
  id: string;
  created_at: string;
  updated_at: string;
  source_trace_id: string | null;
  source_access_log_id: number | null;
  normalized_event: string;
  event_hash: string;
  decision_reason: string;
  tool: string | null;
  user_id: string | null;
  token_hash_prefix: string | null;
  role_ids_json: string;
  table_refs_json: string;
  risk_tier: RiskTier;
  status: CandidateStatus;
  redaction_status: string;
  evidence_json: string;
};

const SECURITY_REASON_RE =
  /(tool_forbidden_global|table_forbidden|unknown_or_forbidden_connection|raw_query_forbidden|sensitive_metadata_forbidden|permission|forbidden|denied)/i;
const HIGH_ENTROPY_SECRET_RE =
  /(?:bearer\s+|token\s*[:=]\s*|secret\s*[:=]\s*|api[_-]?key\s*[:=]\s*)([A-Za-z0-9+/=_-]{24,})/i;
const LONG_HEX_RE = /\b[a-f0-9]{48,}\b/i;
const LONG_BASE64ISH_RE = /\b[A-Za-z0-9+/=_-]{64,}\b/;
const CANDIDATE_DOMAIN = "security";
const CANDIDATE_REL_PATH = "evals/security/eval/security-eval-cases.yaml";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function redactText(value: string): string {
  return value
    .replace(HIGH_ENTROPY_SECRET_RE, (match) => match.replace(/[A-Za-z0-9+/=_-]{8,}/g, "[REDACTED]"))
    .replace(LONG_HEX_RE, "[REDACTED]")
    .replace(LONG_BASE64ISH_RE, "[REDACTED]");
}

function hasCredentialPayload(value: string): boolean {
  return HIGH_ENTROPY_SECRET_RE.test(value) || LONG_HEX_RE.test(value) || LONG_BASE64ISH_RE.test(value);
}

function candidateReason(row: AccessLogSecurityRow): string {
  return row.decision_reason || row.error_detail || "denied_access";
}

function isSecuritySource(row: AccessLogSecurityRow): boolean {
  if (row.outcome === "denied") return true;
  return SECURITY_REASON_RE.test(candidateReason(row));
}

function normalizeEvent(row: AccessLogSecurityRow): {
  normalizedEvent: string;
  tableRefs: string[];
  roleIds: string[];
  redactionStatus: "kept" | "rejected";
  rejectionReason?: string;
} {
  const roleIds = parseJsonArray(row.role_ids);
  const tableRefs = parseJsonArray(row.tables);
  const raw = [
    `tool=${row.tool}`,
    `reason=${candidateReason(row)}`,
    `tables=${tableRefs.slice(0, 8).join(",") || "none"}`,
    row.query_preview ? `query=${row.query_preview}` : "",
    row.args_summary ? `args=${row.args_summary}` : ""
  ].filter(Boolean).join(" | ");
  if (hasCredentialPayload(raw)) {
    return {
      normalizedEvent: redactText(raw),
      tableRefs,
      roleIds,
      redactionStatus: "rejected",
      rejectionReason: "high_entropy_credential_detected"
    };
  }
  return {
    normalizedEvent: redactText(raw).slice(0, 1000),
    tableRefs,
    roleIds,
    redactionStatus: "kept"
  };
}

function riskTier(row: AccessLogSecurityRow): RiskTier {
  return SECURITY_REASON_RE.test(candidateReason(row)) || row.outcome === "denied" ? "P0" : "P1";
}

function serializeCandidate(row: SecurityEvalCandidateRow) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceTraceId: row.source_trace_id,
    sourceAccessLogId: row.source_access_log_id,
    normalizedEvent: row.normalized_event,
    eventHash: row.event_hash,
    decisionReason: row.decision_reason,
    tool: row.tool,
    userId: row.user_id,
    tokenHashPrefix: row.token_hash_prefix,
    roleIds: parseJsonArray(row.role_ids_json),
    tableRefs: parseJsonArray(row.table_refs_json),
    riskTier: row.risk_tier,
    status: row.status,
    redactionStatus: row.redaction_status,
    evidence: JSON.parse(row.evidence_json) as unknown
  };
}

async function writeCandidateTrace(row: SecurityEvalCandidateRow, relation: EvidenceRelation): Promise<void> {
  try {
    const auditDb = await getAuditDb();
    const traceId = row.source_trace_id || `security-eval-${row.event_hash.slice(0, 12)}`;
    const now = new Date().toISOString();
    const eventId = writeTraceEvent(auditDb, {
      traceId,
      spanId: `security-eval-${randomUUID().slice(0, 8)}`,
      spanType: "eval_run",
      actorKind: "system",
      actorId: "security-eval-candidate-extractor",
      status: row.status === "rejected" ? "denied" : "ok",
      startedAt: now,
      endedAt: now,
      metadata: {
        gateKind: "security_eval_candidate_extraction",
        candidateId: row.id,
        riskTier: row.risk_tier,
        redactionStatus: row.redaction_status
      },
      artifactHashes: [row.event_hash]
    });
    writeEvidenceEvents(auditDb, [
      {
        traceEventId: eventId,
        traceId,
        evidenceKind: "access_log_row",
        evidenceRef: String(row.source_access_log_id ?? row.id),
        relation,
        metadata: { candidateId: row.id }
      },
      {
        traceEventId: eventId,
        traceId,
        evidenceKind: "role_diff_hash",
        evidenceRef: hashArtifact(row.event_hash),
        relation: "observed",
        metadata: { decisionReason: row.decision_reason }
      }
    ]);
  } catch (error) {
    console.error("[lucy-eval] failed to write security candidate trace", {
      candidateId: row.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function extractSecurityEvalCandidates(options: { limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const auditDb = await getAuditDb();
  const evalDb = await getEvalDb();
  const rows = auditDb.prepare(`
    SELECT id, ts, user_id, token_hash_prefix, tool, tables, args_summary, outcome,
           error_detail, request_id, trace_id, role_ids, permission_snapshot_hash,
           decision_reason, query_preview
    FROM access_log
    WHERE outcome = 'denied'
       OR decision_reason LIKE '%forbidden%'
       OR decision_reason LIKE '%permission%'
       OR decision_reason LIKE '%denied%'
       OR error_detail LIKE '%forbidden%'
       OR error_detail LIKE '%permission%'
    ORDER BY ts DESC
    LIMIT ?
  `).all(limit) as AccessLogSecurityRow[];

  const now = new Date().toISOString();
  let inserted = 0;
  let rejected = 0;
  let duplicate = 0;
  const candidates = [];

  for (const row of rows) {
    if (!isSecuritySource(row)) continue;
    const normalized = normalizeEvent(row);
    const eventHash = sha(JSON.stringify({
      accessLogId: row.id,
      reason: candidateReason(row),
      tool: row.tool,
      event: normalized.normalizedEvent
    }));
    const id = `sec_eval_${eventHash.slice(0, 20)}`;
    const status: CandidateStatus = normalized.redactionStatus === "rejected" ? "rejected" : "candidate";
    const candidate: SecurityEvalCandidateRow = {
      id,
      created_at: now,
      updated_at: now,
      source_trace_id: row.trace_id,
      source_access_log_id: row.id,
      normalized_event: normalized.normalizedEvent,
      event_hash: eventHash,
      decision_reason: normalized.rejectionReason ?? candidateReason(row),
      tool: row.tool,
      user_id: row.user_id,
      token_hash_prefix: row.token_hash_prefix,
      role_ids_json: JSON.stringify(normalized.roleIds),
      table_refs_json: JSON.stringify(normalized.tableRefs),
      risk_tier: riskTier(row),
      status,
      redaction_status: normalized.redactionStatus,
      evidence_json: JSON.stringify({
        source: "access_log",
        accessLogId: row.id,
        requestId: row.request_id,
        permissionSnapshotHash: row.permission_snapshot_hash,
        traceId: row.trace_id
      })
    };
    const result = evalDb.prepare(`
      INSERT OR IGNORE INTO security_eval_candidate
        (id, created_at, updated_at, source_trace_id, source_access_log_id,
         normalized_event, event_hash, decision_reason, tool, user_id,
         token_hash_prefix, role_ids_json, table_refs_json, risk_tier,
         status, redaction_status, evidence_json)
      VALUES
        (@id, @created_at, @updated_at, @source_trace_id, @source_access_log_id,
         @normalized_event, @event_hash, @decision_reason, @tool, @user_id,
         @token_hash_prefix, @role_ids_json, @table_refs_json, @risk_tier,
         @status, @redaction_status, @evidence_json)
    `).run(candidate);
    if (result.changes === 0) {
      duplicate += 1;
    } else {
      if (status === "rejected") rejected += 1;
      else inserted += 1;
      await writeCandidateTrace(candidate, status === "rejected" ? "denied_by" : "observed");
    }
    candidates.push(serializeCandidate(candidate));
  }
  return { scanned: rows.length, inserted, rejected, duplicate, candidates };
}

export async function listSecurityEvalCandidates() {
  const evalDb = await getEvalDb();
  const rows = evalDb.prepare(`
    SELECT * FROM security_eval_candidate
    ORDER BY updated_at DESC, id ASC
    LIMIT 200
  `).all() as SecurityEvalCandidateRow[];
  return rows.map(serializeCandidate);
}

async function loadCandidate(id: string): Promise<SecurityEvalCandidateRow | undefined> {
  const evalDb = await getEvalDb();
  return evalDb.prepare("SELECT * FROM security_eval_candidate WHERE id = ?").get(id) as SecurityEvalCandidateRow | undefined;
}

async function hasAcceptedReview(candidateId: string): Promise<boolean> {
  const evalDb = await getEvalDb();
  const row = evalDb.prepare(`
    SELECT 1 FROM security_eval_candidate_review
    WHERE candidate_id = ? AND decision = 'accept'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(candidateId);
  return row !== undefined;
}

function formalCaseFor(row: SecurityEvalCandidateRow) {
  return {
    id: `security_${row.event_hash.slice(0, 16)}`,
    case_type: "single_turn",
    domain: CANDIDATE_DOMAIN,
    question: row.normalized_event,
    expected_source: "manual_debug_only",
    coverage: "p0_security",
    notes: `Promoted from Security Candidate ${row.id}; expected denial reason: ${row.decision_reason}`,
    result_assertions: [
      {
        value_type: "text",
        compare_mode: "denied"
      }
    ]
  };
}

async function buildPromotionPreview(row: SecurityEvalCandidateRow) {
  const projectRoot = await resolveProjectRoot();
  const formalCase = formalCaseFor(row);
  let existing = "";
  try {
    existing = await readFile(path.join(projectRoot, CANDIDATE_REL_PATH), "utf8");
  } catch {
    existing = "metadata:\n  domain: security\ncases: []\n";
  }
  const doc = parseDocument(existing);
  const parsed = doc.toJSON() as { metadata?: unknown; cases?: unknown[] } | null;
  const next = {
    metadata: parsed?.metadata ?? { domain: CANDIDATE_DOMAIN },
    cases: [
      ...((Array.isArray(parsed?.cases) ? parsed?.cases : []) as unknown[]).filter((item) => {
        return !(item && typeof item === "object" && "id" in item && item.id === formalCase.id);
      }),
      formalCase
    ]
  };
  const proposedYaml = stringify(next, { lineWidth: 0 });
  return {
    candidateId: row.id,
    formalCase,
    relPath: CANDIDATE_REL_PATH,
    diff: previewDiff(existing, proposedYaml),
    proposedYaml
  };
}

export function registerSecurityCandidateRoutes(app: FastifyInstance): void {
  app.get("/api/eval/security-candidates", async () => {
    const candidates = await listSecurityEvalCandidates();
    return { ok: true, data: { candidates } };
  });

  app.post<{ Body?: { limit?: number } }>("/api/eval/security-candidates/extract", async (request) => {
    const result = await extractSecurityEvalCandidates({ limit: request.body?.limit });
    return { ok: true, data: result };
  });

  app.post<{
    Params: { id: string };
    Body: {
      reviewer?: { actorKind?: string; actorId?: string; identityProvider?: string };
      permissionBoundaryConfirmed?: boolean;
      expectedDenialConfirmed?: boolean;
      businessContextConfirmed?: boolean;
      decision?: "accept" | "reject";
      note?: string;
    };
  }>("/api/eval/security-candidates/:id/review", async (request, reply) => {
    const candidate = await loadCandidate(request.params.id);
    if (!candidate) {
      return reply.status(404).send({ ok: false, error: { code: "CANDIDATE_NOT_FOUND", message: "Security Candidate not found" } });
    }
    const body = request.body ?? {};
    const decision = body.decision ?? "accept";
    const reviewer = body.reviewer ?? {};
    const actorId = typeof reviewer.actorId === "string" ? reviewer.actorId.trim() : "";
    if (!actorId || reviewer.actorKind === "ai") {
      return reply.status(400).send({ ok: false, error: { code: "INVALID_REVIEWER", message: "Reviewer must be a non-AI actor" } });
    }
    if (decision === "accept" && (!body.permissionBoundaryConfirmed || !body.expectedDenialConfirmed || !body.businessContextConfirmed)) {
      return reply.status(409).send({ ok: false, error: { code: "REVIEW_EVIDENCE_INCOMPLETE", message: "Reviewer must confirm boundary, expected denial, and business context" } });
    }
    const evalDb = await getEvalDb();
    const now = new Date().toISOString();
    const reviewId = `sec_review_${sha(`${candidate.id}:${actorId}:${now}`).slice(0, 20)}`;
    evalDb.prepare(`
      INSERT INTO security_eval_candidate_review
        (id, candidate_id, reviewer_actor_json, permission_boundary_confirmed,
         expected_denial_confirmed, business_context_confirmed, decision, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      reviewId,
      candidate.id,
      JSON.stringify({
        actorKind: reviewer.actorKind ?? "admin",
        actorIdHash: sha(actorId).slice(0, 32),
        identityProvider: reviewer.identityProvider ?? "deployment-local"
      }),
      body.permissionBoundaryConfirmed ? 1 : 0,
      body.expectedDenialConfirmed ? 1 : 0,
      body.businessContextConfirmed ? 1 : 0,
      decision,
      typeof body.note === "string" ? redactText(body.note).slice(0, 500) : null,
      now
    );
    evalDb.prepare("UPDATE security_eval_candidate SET status = ?, updated_at = ? WHERE id = ?")
      .run(decision === "accept" ? "accepted" : "rejected", now, candidate.id);
    await writeCandidateTrace({ ...candidate, status: decision === "accept" ? "accepted" : "rejected", updated_at: now }, decision === "accept" ? "reviewer_override" : "denied_by");
    return { ok: true, data: { reviewed: true, reviewId, candidateId: candidate.id, status: decision === "accept" ? "accepted" : "rejected" } };
  });

  app.post<{ Params: { id: string } }>("/api/eval/security-candidates/:id/promote/preview", async (request, reply) => {
    const candidate = await loadCandidate(request.params.id);
    if (!candidate) {
      return reply.status(404).send({ ok: false, error: { code: "CANDIDATE_NOT_FOUND", message: "Security Candidate not found" } });
    }
    if (!(await hasAcceptedReview(candidate.id))) {
      return reply.status(409).send({ ok: false, error: { code: "REVIEW_REQUIRED", message: "Accepted reviewer evidence is required before promotion" } });
    }
    return { ok: true, data: await buildPromotionPreview(candidate) };
  });

  app.post<{ Params: { id: string } }>("/api/eval/security-candidates/:id/promote", async (request, reply) => {
    const candidate = await loadCandidate(request.params.id);
    if (!candidate) {
      return reply.status(404).send({ ok: false, error: { code: "CANDIDATE_NOT_FOUND", message: "Security Candidate not found" } });
    }
    if (!(await hasAcceptedReview(candidate.id))) {
      return reply.status(409).send({ ok: false, error: { code: "REVIEW_REQUIRED", message: "Accepted reviewer evidence is required before promotion" } });
    }
    const preview = await buildPromotionPreview(candidate);
    const projectRoot = await resolveProjectRoot();
    await auditedWriteFile(projectRoot, CANDIDATE_REL_PATH, preview.proposedYaml, {
      enabled: true,
      changeType: "eval_security_candidate_promote",
      assetKind: "eval",
      actorType: "ui_admin",
      source: "security_candidates_api",
      targetId: candidate.id,
      diff: preview.diff
    });
    const evalDb = await getEvalDb();
    evalDb.prepare("UPDATE security_eval_candidate SET status = ?, updated_at = ? WHERE id = ?")
      .run("promoted", new Date().toISOString(), candidate.id);
    await writeCandidateTrace({ ...candidate, status: "promoted" }, "promoted");
    return { ok: true, data: { ...preview, written: true } };
  });
}
