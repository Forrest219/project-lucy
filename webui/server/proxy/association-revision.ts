/**
 * audit-trust-2026-10-19-r1 / T03b — AssociationRevision row + DB layer.
 *
 * Contract:
 *   `inbox/audit-trust/audit-trust-2026-10-19-r1/T00-r2/implementation-contract.md`
 *   §2.1 / §3.1 / §2.6.
 *
 * Append-only. The actor for each row comes from a `TrustedActor` resolved by
 * the server (never from request body / User-Agent). This is what guarantees
 * EA-11: "body.actor 和 UA 不能冒充".
 *
 * Read path: a single access_log row's effective association is computed by
 * replaying the latest `association_revisions` row whose `original_turn_id`
 * matches, combined with `access_log.association_status` (the original).
 */

import Database from "better-sqlite3";
import { createHash } from "node:crypto";

export type AssociationRevisionRow = {
  id: number;
  originalTurnId: string;
  effectiveTurnId: string | null;
  originalAssociationStatus: string | null;
  effectiveAssociationStatus: string;
  reason: string;
  referenceDoc: string | null;
  attributionRuleVersion: string;
  actorKind: string;
  actorId: string | null;
  instanceId: string | null;
  instanceStartGeneration: number | null;
  ts: string;
  classificationVersion: string;
  expectedRevision: string | null;
};

export type NewAssociationRevisionInput = {
  originalTurnId: string;
  effectiveTurnId?: string | null;
  originalAssociationStatus?: string | null;
  effectiveAssociationStatus: string;
  reason: string;
  referenceDoc?: string | null;
  attributionRuleVersion: string;
  actorKind: string;
  actorId: string | null;
  instanceId: string | null;
  instanceStartGeneration: number | null;
  classificationVersion: string;
  expectedRevision?: string | null;
};

function rowFromRaw(row: Record<string, unknown>): AssociationRevisionRow {
  return {
    id: Number(row.id),
    originalTurnId: String(row.original_turn_id),
    effectiveTurnId: (row.effective_turn_id as string | null) ?? null,
    originalAssociationStatus: (row.original_association_status as string | null) ?? null,
    effectiveAssociationStatus: String(row.effective_association_status),
    reason: String(row.reason),
    referenceDoc: (row.reference_doc as string | null) ?? null,
    attributionRuleVersion: String(row.attribution_rule_version),
    actorKind: String(row.actor_kind),
    actorId: (row.actor_id as string | null) ?? null,
    instanceId: (row.instance_id as string | null) ?? null,
    instanceStartGeneration: (row.instance_start_generation as number | null) ?? null,
    ts: String(row.ts),
    classificationVersion: String(row.classification_version),
    expectedRevision: (row.expected_revision as string | null) ?? null
  };
}

/**
 * Append a new revision. Throws on duplicate (original_turn_id,
 * attribution_rule_version) — operator must bump the rule version to retry.
 */
export function appendAssociationRevision(
  db: Database.Database,
  input: NewAssociationRevisionInput
): AssociationRevisionRow {
  if (!input.originalTurnId) throw new Error("originalTurnId required");
  if (!input.effectiveAssociationStatus) throw new Error("effectiveAssociationStatus required");
  if (!input.reason) throw new Error("reason required");
  if (!input.attributionRuleVersion) throw new Error("attributionRuleVersion required");
  if (!input.classificationVersion) throw new Error("classificationVersion required");
  if (!input.actorKind) throw new Error("actorKind required");
  // Allowed actor_kinds: 'person', 'automation', 'system' (mirrors config audit).
  // Anything else is rejected so admin endpoints can't be tricked into recording
  // arbitrary "actor" labels via body. T03b EA-11 closure.
  const allowedKinds = new Set(["person", "automation", "system"]);
  if (!allowedKinds.has(input.actorKind)) {
    throw new Error(`actorKind must be one of ${[...allowedKinds].join(", ")}; got ${input.actorKind}`);
  }

  const ts = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO association_revisions
         (original_turn_id, effective_turn_id, original_association_status, effective_association_status,
          reason, reference_doc, attribution_rule_version, actor_kind, actor_id, instance_id,
          instance_start_generation, ts, classification_version, expected_revision)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.originalTurnId,
      input.effectiveTurnId ?? null,
      input.originalAssociationStatus ?? null,
      input.effectiveAssociationStatus,
      input.reason,
      input.referenceDoc ?? null,
      input.attributionRuleVersion,
      input.actorKind,
      input.actorId,
      input.instanceId,
      input.instanceStartGeneration,
      ts,
      input.classificationVersion,
      input.expectedRevision ?? null
    );
  const row = db
    .prepare(`SELECT * FROM association_revisions WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  return rowFromRaw(row);
}

export function listAssociationRevisions(
  db: Database.Database,
  options: { originalTurnId?: string; limit?: number } = {}
): AssociationRevisionRow[] {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (options.originalTurnId) {
    where.push("original_turn_id = ?");
    params.push(options.originalTurnId);
  }
  const sql = `SELECT * FROM association_revisions
               ${where.length ? "WHERE " + where.join(" AND ") : ""}
               ORDER BY ts DESC, id DESC
               LIMIT ?`;
  params.push(options.limit ?? 200);
  const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowFromRaw);
}

/**
 * Compute the effective association for an access_log row by replaying the
 * revisions whose `original_turn_id` matches the row's `lucy_turn_id`. If no
 * revisions exist, the row's stored `association_status` is the effective view.
 */
export type EffectiveAssociationView = {
  accessLogId: number;
  originalTurnId: string | null;
  originalAssociationStatus: string | null;
  effectiveTurnId: string | null;
  effectiveAssociationStatus: string | null;
  effectiveReason: string | null;
  effectiveRuleVersion: string | null;
  revisionCount: number;
};

export function effectiveAssociationFor(
  db: Database.Database,
  accessLogId: number
): EffectiveAssociationView | null {
  const row = db
    .prepare(
      `SELECT id, lucy_turn_id, association_status FROM access_log WHERE id = ?`
    )
    .get(accessLogId) as
    | { id: number; lucy_turn_id: string | null; association_status: string | null }
    | undefined;
  if (!row) return null;
  if (!row.lucy_turn_id) {
    return {
      accessLogId,
      originalTurnId: null,
      originalAssociationStatus: row.association_status,
      effectiveTurnId: null,
      effectiveAssociationStatus: row.association_status,
      effectiveReason: null,
      effectiveRuleVersion: null,
      revisionCount: 0
    };
  }
  const revs = listAssociationRevisions(db, { originalTurnId: row.lucy_turn_id, limit: 50 });
  // Revisions are returned newest-first; the latest revision is the effective view.
  // We pick the highest id (most recent).
  const latest = revs.length > 0 ? revs[0] : null;
  if (!latest) {
    return {
      accessLogId,
      originalTurnId: row.lucy_turn_id,
      originalAssociationStatus: row.association_status,
      effectiveTurnId: row.lucy_turn_id,
      effectiveAssociationStatus: row.association_status,
      effectiveReason: null,
      effectiveRuleVersion: null,
      revisionCount: 0
    };
  }
  return {
    accessLogId,
    originalTurnId: row.lucy_turn_id,
    originalAssociationStatus: latest.originalAssociationStatus ?? row.association_status,
    effectiveTurnId: latest.effectiveTurnId ?? row.lucy_turn_id,
    effectiveAssociationStatus: latest.effectiveAssociationStatus,
    effectiveReason: latest.reason,
    effectiveRuleVersion: latest.attributionRuleVersion,
    revisionCount: revs.length
  };
}

/**
 * Deterministic hash for an association_revisions row's payload. Used in
 * T03d / EA-13 to verify that identical inputs produce identical hashes and
 * that a payload change (different reason / status) yields a different hash.
 */
export function revisionContentHash(row: AssociationRevisionRow): string {
  const canonical = JSON.stringify({
    originalTurnId: row.originalTurnId,
    effectiveTurnId: row.effectiveTurnId,
    originalAssociationStatus: row.originalAssociationStatus,
    effectiveAssociationStatus: row.effectiveAssociationStatus,
    reason: row.reason,
    referenceDoc: row.referenceDoc,
    attributionRuleVersion: row.attributionRuleVersion,
    classificationVersion: row.classificationVersion
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}