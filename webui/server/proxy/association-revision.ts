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
  /** B25：该修订在 canonical ledger 的提交序号（as-of S 视图用）。 */
  ledgerSeq?: number | null;
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
  /** B25：账本提交序号；缺省时由调用方注入的解析器补齐。 */
  ledgerSeq?: number | null;
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
    expectedRevision: (row.expected_revision as string | null) ?? null,
    ledgerSeq: row.ledger_seq === null || row.ledger_seq === undefined ? null : Number(row.ledger_seq)
  };
}


/**
 * 表是否已有 `ledger_seq` 列（additive 迁移前的历史库 / 精简测试 schema）。
 * 结果按 db 实例缓存，避免每次写入都查一次 `PRAGMA`。
 */
const ledgerSeqSupport = new WeakMap<Database.Database, boolean>();
function supportsLedgerSeq(db: Database.Database): boolean {
  const cached = ledgerSeqSupport.get(db);
  if (cached !== undefined) return cached;
  let supported = false;
  try {
    const rows = db.prepare(`PRAGMA table_info(association_revisions)`).all() as Array<{ name: string }>;
    supported = rows.some((row) => row.name === "ledger_seq");
  } catch {
    supported = false;
  }
  ledgerSeqSupport.set(db, supported);
  return supported;
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
  // B25：`ledger_seq` 是 additive 列。表上还没有该列时（历史库 / 精简测试
  // schema）退回到不含该列的 INSERT，不让可选列阻断修订写入。
  const withLedgerSeq = supportsLedgerSeq(db);
  const columns = withLedgerSeq
    ? "original_turn_id, effective_turn_id, original_association_status, effective_association_status, " +
      "reason, reference_doc, attribution_rule_version, actor_kind, actor_id, instance_id, " +
      "instance_start_generation, ts, classification_version, expected_revision, ledger_seq"
    : "original_turn_id, effective_turn_id, original_association_status, effective_association_status, " +
      "reason, reference_doc, attribution_rule_version, actor_kind, actor_id, instance_id, " +
      "instance_start_generation, ts, classification_version, expected_revision";
  const placeholders = withLedgerSeq ? 15 : 14;
  const info = db
    .prepare(
      `INSERT INTO association_revisions (${columns}) VALUES (${Array.from({ length: placeholders }, () => "?").join(", ")})`
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
      input.expectedRevision ?? null,
      ...(withLedgerSeq ? [input.ledgerSeq ?? null] : [])
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
// ─── B25：as-of S 视图（Spec §12.5 末段 / D6）──────────────────────────────
//
// 正式导出要求「所有关联、修订生效、聚合均 as-of S」。因此读路径必须能
// 回答：**在 S 时刻，这条调用的有效归属是什么？**
//
// 规则：
//   - 基础行：`access_log.ledger_seq <= S`。
//   - 修订事件：`association_revisions.ledger_seq <= S` 才折叠。
//   - `ledger_seq IS NULL` 的历史修订**不可判定位置** → 不折叠，并单独
//     披露（禁止「只按 seq 过滤就宣称修订视图一致」，Spec §12.5 末段）。
//   - 修订不得凭空创造行：目标行不在 as-of S 内时不折叠并报错。

export type AssociationAsOfSView = {
  accessLogId: number;
  seqUpperBound: number;
  originalTurnId: string | null;
  effectiveTurnId: string | null;
  effectiveAssociationStatus: string | null;
  effectiveReason: string | null;
  effectiveRuleVersion: string | null;
  /** 折叠进去的修订 ID。 */
  appliedRevisionIds: number[];
  /** `ledger_seq > S` 未折叠的修订 ID。 */
  deferredRevisionIds: number[];
  /** `ledger_seq IS NULL`、位置不可判定的历史修订 ID。 */
  undatedRevisionIds: number[];
  /** 目标行不在 as-of S 内等结构性问题。 */
  closureErrors: string[];
};

export type AssociationAsOfSnapshot = {
  rows: Array<{
    id: string;
    ledgerSeq: number;
    fields: {
      originalTurnId: string | null;
      effectiveTurnId: string | null;
      effectiveAssociationStatus: string | null;
    };
  }>;
  revisions: Array<{
    id: string;
    ledgerSeq: number | null;
    targetRowId: string;
    fields: Record<string, unknown>;
    reason: string;
  }>;
};

/** 取某调用行在 as-of S 时刻的有效归属（只折叠 `ledger_seq <= S` 的修订）。 */
export function effectiveAssociationForAsOf(
  db: Database.Database,
  accessLogId: number,
  seqUpperBound: number
): AssociationAsOfSView {
  const closureErrors: string[] = [];
  const row = db
    .prepare(`SELECT id, lucy_turn_id, association_status, ledger_seq FROM access_log WHERE id = ?`)
    .get(accessLogId) as
    | {
        id: number;
        lucy_turn_id: string | null;
        association_status: string | null;
        ledger_seq: number | null;
      }
    | undefined;
  if (!row) {
    return {
      accessLogId,
      seqUpperBound,
      originalTurnId: null,
      effectiveTurnId: null,
      effectiveAssociationStatus: null,
      effectiveReason: null,
      effectiveRuleVersion: null,
      appliedRevisionIds: [],
      deferredRevisionIds: [],
      undatedRevisionIds: [],
      closureErrors: ["access_log_row_not_found"]
    };
  }
  if (row.ledger_seq === null || row.ledger_seq > seqUpperBound) {
    // 行本身不在 as-of S 内。
    closureErrors.push("access_log_row_not_in_as_of_view");
    return {
      accessLogId,
      seqUpperBound,
      originalTurnId: row.lucy_turn_id,
      effectiveTurnId: null,
      effectiveAssociationStatus: null,
      effectiveReason: null,
      effectiveRuleVersion: null,
      appliedRevisionIds: [],
      deferredRevisionIds: [],
      undatedRevisionIds: [],
      closureErrors
    };
  }

  const appliedRevisionIds: number[] = [];
  const deferredRevisionIds: number[] = [];
  const undatedRevisionIds: number[] = [];
  let effectiveTurnId = row.lucy_turn_id;
  let effectiveAssociationStatus = row.association_status;
  let effectiveReason: string | null = null;
  let effectiveRuleVersion: string | null = null;

  if (row.lucy_turn_id) {
    const revisions = listAssociationRevisions(db, { originalTurnId: row.lucy_turn_id, limit: 200 })
      .slice()
      .sort((a, b) => a.id - b.id);
    for (const revision of revisions) {
      const revisionSeq = revision.ledgerSeq ?? null;
      if (revisionSeq === null) {
        undatedRevisionIds.push(revision.id);
        continue;
      }
      if (revisionSeq > seqUpperBound) {
        deferredRevisionIds.push(revision.id);
        continue;
      }
      appliedRevisionIds.push(revision.id);
      effectiveTurnId = revision.effectiveTurnId ?? row.lucy_turn_id;
      effectiveAssociationStatus = revision.effectiveAssociationStatus;
      effectiveReason = revision.reason;
      effectiveRuleVersion = revision.attributionRuleVersion;
    }
  }

  return {
    accessLogId,
    seqUpperBound,
    originalTurnId: row.lucy_turn_id,
    effectiveTurnId,
    effectiveAssociationStatus,
    effectiveReason,
    effectiveRuleVersion,
    appliedRevisionIds,
    deferredRevisionIds,
    undatedRevisionIds,
    closureErrors
  };
}

/**
 * 构造 as-of S 快照（供 `deriveAsOfSView` 折叠）。
 *
 * 只取有 `ledger_seq` 的行与修订；位置不可判定的历史修订在
 * `effectiveAssociationForAsOf` 中单独披露。
 */
export function buildAssociationAsOfSnapshot(
  db: Database.Database,
  seqUpperBound: number
): AssociationAsOfSnapshot {
  const rowStmt = db.prepare(
    `SELECT id, lucy_turn_id, association_status, ledger_seq FROM access_log
      WHERE ledger_seq IS NOT NULL AND ledger_seq <= ?
      ORDER BY id ASC`
  );
  const rows = (rowStmt.all(seqUpperBound) as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    ledgerSeq: Number(row.ledger_seq),
    fields: {
      originalTurnId: (row.lucy_turn_id as string | null) ?? null,
      effectiveTurnId: (row.lucy_turn_id as string | null) ?? null,
      effectiveAssociationStatus: (row.association_status as string | null) ?? null
    }
  }));

  const revisionStmt = db.prepare(
    `SELECT id, original_turn_id, effective_turn_id, effective_association_status, reason,
            attribution_rule_version, ledger_seq
       FROM association_revisions
      WHERE ledger_seq IS NOT NULL
      ORDER BY ledger_seq ASC, id ASC`
  );
  const revisions = (
    revisionStmt.all() as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    ledgerSeq: row.ledger_seq === null || row.ledger_seq === undefined ? null : Number(row.ledger_seq),
    targetRowId: String(row.original_turn_id),
    fields: {
      effectiveTurnId: (row.effective_turn_id as string | null) ?? null,
      effectiveAssociationStatus: (row.effective_association_status as string | null) ?? null,
      effectiveReason: (row.reason as string | null) ?? null,
      effectiveRuleVersion: (row.attribution_rule_version as string | null) ?? null
    },
    reason: String(row.reason)
  }));

  return { rows, revisions };
}
