/**
 * audit-trust-2026-10-19-r1 / T04c — v2 export endpoint logic.
 *
 * Contract §2.7 / §6.1. mode ∈ {complete, diagnostic}; diagnostic requires
 * `confirm_diagnostic=true`. fixed ledger upper seq S is captured before
 * backup; S+ events are not admitted.
 *
 * Complete mode fail-closed on:
 *   - projection_lag > 0 beyond deadline → 409
 *   - security/audit store unavailable → 503
 *   - backup failure → 500
 *   - combined_complete = false → 500
 *
 * Diagnostic mode tolerates all of the above and reports `diagnostic_incomplete`
 * reasons in the response.
 *
 * ─── Lucy v0.25 / L25-09 (B13 / B19 / B20 / B21) ──────────────────────────
 *
 * - B19 / E-2：`S`（ledgerUpperSeq）**不得**取投影自身的 `MAX(id) FROM access_log`。
 *   唯一正确来源是 canonical ledger 的已提交上界（`security/store.ts` 的
 *   `maxEventSeq()`），由调用方通过 `options.ledgerUpperSeq` 传入。
 *   未传入时本模块**拒绝**执行正式导出（fail-closed），不猜、不用投影序号顶替。
 * - B21 / E-5：追平时限默认 **T3 = 60s**（U6 冻结值），自**捕获 S 那一刻**起算；
 *   等待重试**不重置**计时（单调截止时间）。
 * - B20 / E-4：文件完整性校验是**独立校验器**——重算每个文件内容的 sha256，
 *   并校验跨文件关联键；不再只验 `sha256.length === 64`。
 * - B13：manifest 增补 `exported_by` / `export_reason` / `export_approval_ref`
 *   （U7 本期只做来源声明，**不引入签名**）、跨文件关系声明与排除项声明。
 */

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AUDIT_WINDOWS } from "../proxy/ingress-registry.js";
import { DERIVATION_VERSION } from "../proxy/audit-derivation.js";
import { proveExactAsOfS, type AsOfSProof } from "../proxy/audit-as-of-proof.js";

export type ExportMode = "complete" | "diagnostic";

export type ExportV2Result = {
  ok: boolean;
  mode: ExportMode;
  upperSeq: number;
  rowCount: number;
  combinedComplete: boolean;
  scopeComplete: boolean;
  fileHashOk: boolean;
  relationCheckOk: boolean;
  diagnosticIncomplete: string[];
  /**
   * 精确 as-of S 的证明结果（F-02）。
   *
   * `ok=false` 时 `scopeComplete=false` → 正式完整导出失败关闭；诊断包据此
   * 显式披露实际证据界与缺失集合。
   */
  asOfProof: AsOfSProof;
  csv: string;
  /** Frozen primary selection reused by every pack attachment. */
  selectedAccessLogIds: number[];
  manifest: ExportV2Manifest;
};

/** B13 — 来源声明三字段（U7：本期只做来源声明，不引入签名）。 */
export type ExportProvenance = {
  exportedBy: string | null;
  exportReason: string | null;
  exportApprovalRef: string | null;
  /** 三字段中任一缺失时的原因（U2 六值枚举之一）。 */
  nullReason: "not_applicable" | "not_collected" | "unknown" | "not_supported";
};

/** B13 — 跨文件关系声明（Spec §9.3(c)）。 */
export type CrossFileRelations = {
  /** access_log ↔ access_log_sources 的关联键。 */
  accessLogToSources: string;
  /** access_log ↔ permission_snapshots 的关联键。 */
  accessLogToPermissionSnapshots: string;
  /** 调用行 ↔ 问询 CSV 的关联键。 */
  callsToQuestions: string;
  /** 例外集（显式声明「调用上的问询 ID 都能在问询 CSV 找到」之外的例外）。 */
  exceptions: string[];
};

/** B13 — 排除项声明（排除什么、为什么）。 */
export type ExportExclusions = {
  excluded: boolean;
  reason: string | null;
  items: string[];
};

export type ExportV2Manifest = {
  schemaVersion: "audit-export-manifest/v2";
  classificationVersion: string;
  digestVersion: string;
  ledgerUpperSeq: number;
  projectionComplete: boolean;
  scopeComplete: boolean;
  dataScope: { ok: boolean; reason?: string };
  associationQuality: { confirmed: number; candidate: number; unassigned: number; conflict: number; legacyUnverified: number };
  clientCoverage: { observed: boolean; gapWindows: Array<{ from: string; to: string }>; unknownReason?: string };
  integrityVerification: { fileHashOk: boolean; relationCheckOk: boolean };
  combinedComplete: boolean;
  lagMs: number;
  policyScopeExpanded: unknown[];
  untrustedSelfReport: number;
  legalEmptyWindow: boolean;
  // ─── B13 增补 ────────────────────────────────────────────────────────────
  /** 来源声明三字段（谁导出、依据什么授权）。 */
  provenance: ExportProvenance;
  /** 跨文件关系声明。 */
  crossFileRelations: CrossFileRelations;
  /** 排除项声明。 */
  exclusions: ExportExclusions;
  /** 规则版本链。 */
  derivationVersion: string;
  /** 证据版本链：前版 exportId（补包时）。 */
  prevExportId: string | null;
  /** 本次导出的 exportId。 */
  exportId: string | null;
  /** 排序键与分页规则版本。 */
  sortKey: string;
  paginationRuleVersion: string;
  /** 导出协议包含规则（纳入集合 = 导出集合）。 */
  protocolInclusionRule: string;
  /** 本次导出实际发生的时间。 */
  exportedAt: string;
  /** 完整固定筛选；与实际 SQL 使用同一来源。 */
  filter: { from: string | null; until: string | null; userId: string | null };
  /** 时间范围与截止时点。 */
  timeRange: { from: string | null; until: string | null };
  cutoffAt: string | null;
  /** 每文件行数 + sha256（文件清单）。 */
  files: Array<{ name: string; sha256: string; rowCount: number }>;
  /** 追平时限（秒）；T3 自捕获 S 起算，等待重试不重置。 */
  catchUpDeadlineSeconds: number;
};

export type ExportV2Options = {
  mode: ExportMode;
  confirmDiagnostic?: boolean;
  fixedFilter: { from?: string; until?: string; userId?: string };
  fixedZone: string;
  projectionLag?: number;
  auditStoreAvailable: boolean;
  securityStoreAvailable: boolean;
  backupOk?: boolean;
  /** Allow callers (e.g. tests) to bypass the real backup API and use a fresh DB snapshot. */
  snapshotDb?: Database.Database;
  /** Source db; default to snapshotDb. */
  sourceDb?: Database.Database;
  classificationVersion: string;
  digestVersion: string;
  /**
   * Bounded deadline for projection catch-up in milliseconds.
   *
   * B21 / E-5 / U6：默认 **T3 = 60s**（不是历史实现的 5s）。计时自**捕获 S
   * 那一刻**起算，等待重试**不重置**（见 `options.catchUpStartedAt`）。
   */
  catchUpDeadlineMs?: number;
  /**
   * B21：单调计时的起点（捕获 S 的时刻，epoch ms）。
   * 传入时以此为基准计算剩余时间；等待重试不得刷新该值。
   */
  catchUpStartedAt?: number;
  /** 当前单调时刻（epoch ms）；测试可注入。 */
  now?: () => number;
  /**
   * B19 / E-2：canonical ledger 的**已提交上界 S**。
   *
   * 唯一正确来源是 `security/store.ts` 的 `maxEventSeq()`；**禁止**取投影自身
   * 的序号。未提供时正式导出一律失败（fail-closed），不猜、不用投影序号顶替。
   */
  ledgerUpperSeq?: number;
  /** B13：来源声明三字段。 */
  provenance?: {
    exportedBy?: string | null;
    exportReason?: string | null;
    exportApprovalRef?: string | null;
  };
  /** B13：前版 exportId（补包 / 重导出时关联旧版）。 */
  prevExportId?: string | null;
  /** B13：本次 exportId。 */
  exportId?: string | null;
  /** B13：排除项声明。 */
  exclusions?: ExportExclusions;
  /** B13：对账评估时点。 */
  cutoffAt?: string | null;
};

/** B21 / U6 — 追平时限默认值（T3 = 60s）。 */
export const DEFAULT_CATCH_UP_DEADLINE_MS = AUDIT_WINDOWS.t3ExportCatchupSeconds * 1000;

function sha256Hex(buffer: Buffer | string): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const HEADERS_V2 = [
  "id",
  "ts",
  "user_id",
  "tool",
  "outcome",
  "decision_reason",
  "duration_ms",
  "response_row_count",
  "event_type",
  "transport_sub_type",
  "transport_status",
  "authorization_status",
  "execution_status",
  "usability_status",
  "association_status",
  "original_turn_id",
  "effective_turn_id",
  "attempt_id",
  "parent_attempt_id",
  "instance_id",
  "classification_version",
  // ─── Lucy v0.25 / L25-09 additive 列（历史行保持原值 / NULL）──────────────
  "legacy_outcome",
  "primary_status",
  "derivation_version",
  "delivery_status",
  "null_reason",
  "digest_kind",
  "preview_version",
  "ingress_event_id",
  "endpoint_id",
  "ledger_seq",
  "client_call_id",
  "client_event_id",
  "upstream_operation_id",
  "rpc_request_id",
  "retry_of",
  "error_category",
  "reported_role",
  "observed_role_ids",
  "observed_protocol",
  "inferred_client",
  "inference_method",
  "inference_confidence",
  "inference_rule_version"
] as const;

/**
 * v2p5-1 导出列在旧库上可能不存在（历史库无这些 additive 列）。
 * 逐列探测存在性，缺失列输出空串而不是让整份导出失败。
 */
function selectExportColumns(db: Database.Database): { present: Set<string>; headers: string[] } {
  const cols = db.prepare("PRAGMA table_info(access_log)").all() as Array<{ name: string }>;
  const present = new Set(cols.map((c) => c.name));
  const headers = HEADERS_V2.filter((h) => present.has(h));
  return { present, headers };
}

function rowClassification(row: Record<string, unknown>): string[] {
  return HEADERS_V2.map((h) => csvEscape(row[h]));
}
function buildClassification(row: Record<string, unknown>): string[] {
  return rowClassification(row);
}

function idList(ids: readonly number[]): { sql: string; params: [string] } {
  // Keep the frozen selection in one JSON parameter. Expanding one placeholder
  // per call fails once an export exceeds SQLite's bound-variable limit.
  return { sql: "SELECT value FROM json_each(?)", params: [JSON.stringify(ids)] };
}

function tableColumns(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function buildAssociationQuality(
  db: Database.Database,
  selectedIds: readonly number[]
): ExportV2Manifest["associationQuality"] {
  const out = { confirmed: 0, candidate: 0, unassigned: 0, conflict: 0, legacyUnverified: 0 };
  if (selectedIds.length === 0) return out;
  const ids = idList(selectedIds);
  const rows = db
    .prepare(
      `SELECT COALESCE(association_status, 'unassigned') AS s, COUNT(*) AS n
         FROM access_log
        WHERE id IN (${ids.sql})
        GROUP BY COALESCE(association_status, 'unassigned')`
    )
    .all(...ids.params) as Array<{ s: string; n: number }>;
  for (const r of rows) {
    if (r.s === "confirmed") out.confirmed = r.n;
    else if (r.s === "candidate") out.candidate = r.n;
    else if (r.s === "conflict") out.conflict = r.n;
    else if (r.s === "legacy_unverified") out.legacyUnverified = r.n;
    else out.unassigned += r.n;
  }
  return out;
}

function buildRelationCheck(
  db: Database.Database,
  selectedIds: readonly number[]
): { ok: boolean; counts: Record<string, number> } {
  const accessLog = selectedIds.length;
  const ids = idList(selectedIds);
  const accessLogSources = accessLog === 0
    ? 0
    : (db.prepare(`SELECT COUNT(*) AS n FROM access_log_sources WHERE access_log_id IN (${ids.sql})`).get(...ids.params) as { n: number }).n;
  const accessColumns = tableColumns(db, "access_log");
  const snapshotColumns = tableColumns(db, "permission_snapshots");
  const hasSnapshotReferences = accessColumns.has("permission_snapshot_hash") && snapshotColumns.has("hash");
  const permissionSnapshots = accessLog === 0 || !hasSnapshotReferences
    ? 0
    : (db.prepare(
        `SELECT COUNT(*) AS n FROM permission_snapshots
          WHERE hash IN (
            SELECT DISTINCT permission_snapshot_hash FROM access_log
             WHERE id IN (${ids.sql}) AND permission_snapshot_hash IS NOT NULL
          )`
      ).get(...ids.params) as { n: number }).n;
  const associationRevisions = (db.prepare("SELECT COUNT(*) AS n FROM association_revisions").get() as { n: number }).n;
  const maintenance = (db.prepare("SELECT COUNT(*) AS n FROM audit_maintenance_log").get() as { n: number }).n;
  const counts = {
    access_log: accessLog,
    access_log_sources: accessLogSources,
    permission_snapshots: permissionSnapshots,
    association_revisions: associationRevisions,
    audit_maintenance_log: maintenance
  };
  // Without the reference columns there is no scoped snapshot set to verify or
  // export. Do not fall back to every snapshot in the database.
  let referencesOk = accessLog === 0 || hasSnapshotReferences;
  if (accessLog > 0 && hasSnapshotReferences) {
    const dangling = (db.prepare(
      `SELECT COUNT(*) AS n
         FROM access_log AS a
         LEFT JOIN permission_snapshots AS p ON p.hash = a.permission_snapshot_hash
        WHERE a.id IN (${ids.sql})
          AND a.permission_snapshot_hash IS NOT NULL
          AND p.hash IS NULL`
    ).get(...ids.params) as { n: number }).n;
    referencesOk = dangling === 0;
  }
  if (accessLog > 0) {
    const danglingSources = (db.prepare(
      `SELECT COUNT(*) AS n
         FROM access_log_sources AS s
         LEFT JOIN access_log AS a ON a.id = s.access_log_id
        WHERE s.access_log_id IN (${ids.sql}) AND a.id IS NULL`
    ).get(...ids.params) as { n: number }).n;
    referencesOk = referencesOk && danglingSources === 0;
  }
  const ok = (accessLog === 0 || (accessLogSources > 0 && permissionSnapshots > 0)) && referencesOk;
  return { ok, counts };
}

/**
 * B20 — 独立文件校验器：重算每个文件内容的 sha256，并校验跨文件关联键。
 *
 * 这是与「生成清单」**相互独立**的路径：清单声明的哈希与文件实际内容
 * 分开计算，因此删除 / 替换 / 改内容都能被检出。
 *
 * 注意：这是**本地清单验证**，不等于「防篡改签名」或「独立来源证明」
 * （术语标准 §3 禁止此类宣称）。
 */
export type FileVerificationResult = {
  ok: boolean;
  /** 每个文件的核对结果。 */
  files: Array<{
    name: string;
    /** 清单声明的哈希。 */
    declared: string;
    /** 重算得到的哈希。 */
    actual: string;
    match: boolean;
    missing: boolean;
  }>;
  /** 跨文件关联键核对。 */
  relationOk: boolean;
  /** 关联问题（逐条）。 */
  relationErrors: string[];
};

/**
 * 重算文件内容的 sha256 并与清单比对。
 *
 * @param files    清单声明（name + sha256）。
 * @param contents 实际文件内容（name → Buffer）。缺失的文件按 missing 处理。
 */
export function verifyExportFiles(
  files: ReadonlyArray<{ name: string; sha256: string }>,
  contents: ReadonlyMap<string, Buffer>
): FileVerificationResult {
  const results: FileVerificationResult["files"] = files.map((file) => {
    const content = contents.get(file.name);
    if (!content) {
      return { name: file.name, declared: file.sha256, actual: "", match: false, missing: true };
    }
    const actual = sha256Hex(content);
    return { name: file.name, declared: file.sha256, actual, match: actual === file.sha256, missing: false };
  });
  return {
    ok: results.every((r) => r.match && !r.missing),
    files: results,
    relationOk: true,
    relationErrors: []
  };
}

/**
 * B20 — 跨文件关联键校验。
 *
 * 校验「调用行上的问询 ID 都能在问询 CSV 找到」（Spec 140/172 §2.7），
 * 以及 access_log ↔ access_log_sources / permission_snapshots 的引用有效性。
 * 不满足时**显式声明例外集**，不静默丢弃。
 */
export function verifyCrossFileRelations(input: {
  /** 调用行的问询 ID 集合。 */
  callTurnIds: ReadonlyArray<string | null>;
  /** 问询 CSV 里的问询 ID 集合。 */
  questionIds: ReadonlySet<string>;
  /** 已声明的例外集（豁免）。 */
  declaredExceptions?: ReadonlySet<string>;
}): { ok: boolean; errors: string[]; exceptions: string[] } {
  const errors: string[] = [];
  const exceptions: string[] = [];
  const declared = input.declaredExceptions ?? new Set<string>();

  for (const turnId of input.callTurnIds) {
    if (!turnId) continue;
    if (input.questionIds.has(turnId)) continue;
    if (declared.has(turnId)) {
      exceptions.push(turnId);
      continue;
    }
    errors.push(`call_turn_id_not_in_question_file:${turnId}`);
  }

  return { ok: errors.length === 0, errors, exceptions };
}

export async function performExportV2(options: ExportV2Options): Promise<ExportV2Result> {
  const diagnosticIncomplete: string[] = [];
  const mode = options.mode;
  if (mode === "diagnostic" && options.confirmDiagnostic !== true) {
    throw new Error("diagnostic_requires_confirm");
  }

  const db = options.snapshotDb ?? options.sourceDb;
  if (!db) throw new Error("snapshot_required");

  const projectionLag = options.projectionLag ?? 0;
  if (projectionLag > 0) {
    if (mode === "complete") {
      throw new Error("projection_lag_exceeded");
    }
    diagnosticIncomplete.push("projection_lag");
  }

  if (!options.auditStoreAvailable) {
    if (mode === "complete") throw new Error("audit_store_unavailable");
    diagnosticIncomplete.push("audit_store_unavailable");
  }
  if (!options.securityStoreAvailable) {
    if (mode === "complete") throw new Error("security_store_unavailable");
    diagnosticIncomplete.push("security_store_unavailable");
  }

  const backupOk = options.backupOk ?? true;
  if (!backupOk) {
    if (mode === "complete") throw new Error("backup_failed");
    diagnosticIncomplete.push("backup_failed");
  }

  // ─── B19 / E-2：`S` 取 canonical ledger 的已提交上界 ──────────────────────
  //
  // 唯一正确来源是 `security/store.ts` 的 `maxEventSeq()`；**禁止**取投影自身
  // 的序号（`MAX(id) FROM access_log`）。未提供时正式导出一律失败 ——
  // 不用投影序号顶替，不猜。
  if (options.ledgerUpperSeq === undefined) {
    if (mode === "complete") throw new Error("ledger_upper_seq_required");
    diagnosticIncomplete.push("ledger_upper_seq_missing");
  }
  const upperSeq = options.ledgerUpperSeq ?? 0;

  // ─── B21 / E-5：T3 = 60s，自捕获 S 那一刻起算，等待重试不重置 ───────────
  const now = options.now ?? Date.now;
  const startedAt = options.catchUpStartedAt ?? now();
  const deadlineMs = options.catchUpDeadlineMs ?? DEFAULT_CATCH_UP_DEADLINE_MS;
  const elapsedMs = Math.max(0, now() - startedAt);
  const remainingMs = deadlineMs - elapsedMs;
  const catchUpExpired = remainingMs <= 0;

  // Build CSV with v2 columns over the snapshot.
  //
  // The upper bound is the CANONICAL LEDGER sequence (`ledger_seq`), never the
  // projection's own `access_log.id`: the two are different sequence spaces,
  // so comparing `id <= S` would include post-S calls and exclude pre-S ones.
  // The requested filter is applied here too — a narrowly requested export
  // must not contain other users' calls or other time ranges.
  const { present, headers } = selectExportColumns(db);
  const selectList = headers.map((h) => h).join(", ");
  // 筛选条件与账本上界**分开**构造：同一筛选还要用来查「命中范围但位置不可
  // 判定」的行（F-02）—— 它们被 `ledger_seq <= S` 排除在视图外，若不单独
  // 统计，范围完整就无从证明。
  const filterConditions: string[] = [];
  const filterParams: unknown[] = [];
  const filter = options.fixedFilter ?? {};
  if (filter.from) {
    filterConditions.push("ts >= ?");
    filterParams.push(filter.from);
  }
  if (filter.until) {
    filterConditions.push("ts <= ?");
    filterParams.push(filter.until);
  }
  if (filter.userId) {
    filterConditions.push("user_id = ?");
    filterParams.push(filter.userId);
  }
  const where: string[] = [...filterConditions];
  const params: unknown[] = [...filterParams];
  const hasLedgerSeq = present.has("ledger_seq");
  if (hasLedgerSeq) {
    where.push("ledger_seq <= ?");
    params.push(upperSeq);
  } else {
    // Without the ledger column the as-of bound cannot be enforced on rows.
    // The export is then NOT an as-of-S export; the completeness verdict below
    // refuses it rather than shipping an unbounded set under an as-of label.
    diagnosticIncomplete.push("ledger_seq_column_unavailable");
  }
  const rows = db
    .prepare(
      `SELECT ${selectList}
         FROM access_log
         ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY id ASC`
    )
    .all(...params) as Array<Record<string, unknown>>;
  // 命中同一筛选、但账本位置不可判定的行：它们落在请求范围内却无法定位到 S，
  // 范围完整不可证明（baseFacts 不成立）。
  const unplaceableRowIds: number[] = [];
  if (hasLedgerSeq) {
    const unplaceable = db
      .prepare(
        `SELECT id FROM access_log
           ${filterConditions.length > 0 ? `WHERE ${filterConditions.join(" AND ")} AND` : "WHERE"}
             ledger_seq IS NULL
          ORDER BY id ASC`
      )
      .all(...filterParams) as Array<{ id: number }>;
    for (const row of unplaceable) unplaceableRowIds.push(Number(row.id));
  }
  const csvLines = [headers.join(",")];
  for (const row of rows) {
    csvLines.push(headers.map((h) => csvEscape(row[h])).join(","));
  }
  const csv = csvLines.join("\n") + "\n";
  const csvHash = sha256Hex(csv);

  // Freeze the primary selection once; every attachment reuses these ids.
  const selectedAccessLogIds = rows.map((row) => Number(row.id));
  // Relation + integrity checks
  const relation = buildRelationCheck(db, selectedAccessLogIds);
  const projectionComplete = projectionLag === 0 && options.auditStoreAvailable && !catchUpExpired;
  const permissionSnapshotRows = relation.counts.permission_snapshots ?? 0;
  const sourceAssociationCheck = relation.ok ? "ok" : "missing";
  // Without the ledger column the as-of upper bound cannot be enforced on rows,
  // so the exported row set is not provably the as-of-S scope.
  //
  // This is folded into `scopeComplete` — NOT added as a fourth conjunct of
  // `combinedComplete`. Rationale: `combinedComplete` is a **frozen** contract
  // (audit-trust R1 acceptance matrix criterion #6 —
  // "combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk",
  // with a bidirectional drift-guard test). Folding the as-of-bound gate into
  // `scopeComplete` keeps that invariant **structurally guaranteed** for every
  // manifest, instead of merely incidentally true whenever the ledger column
  // happens to exist.
  //
  // Semantics: "scopeComplete" = the export covers the complete requested
  // scope as-of S. If the as-of bound cannot be applied to the rows, the
  // scope cannot be certified → scopeComplete is false → complete mode fails
  // closed (`integrity_or_relation_failed`).
  //
  // ─── F-02（2026-10-27 交叉审阅修订）────────────────────────────────────
  // 旧判据 `present.has("ledger_seq")`（**列存在**）**不等于内容可重建**。
  // 基础事实／归属修订／关联／聚合任一不可按 S 精确重建，即令
  // `scopeComplete=false`，正式完整导出失败关闭；诊断包显式披露实际证据界与
  // 缺失集合。
  const asOfProof = proveExactAsOfS({
    db,
    seqUpperBound: upperSeq,
    rows: rows.map((row) => ({
      id: Number(row.id),
      ledgerSeq:
        row.ledger_seq === null || row.ledger_seq === undefined ? null : Number(row.ledger_seq),
      turnId: (row.lucy_turn_id as string | null) ?? null
    })),
    unplaceableRowIds
  });
  if (!asOfProof.ok) {
    diagnosticIncomplete.push("as_of_s_unprovable");
    for (const [dimension, missing] of Object.entries(asOfProof.missingSets)) {
      for (const identifier of missing) {
        diagnosticIncomplete.push(`${dimension}:${identifier}`);
      }
    }
  }
  const scopeComplete =
    projectionComplete &&
    permissionSnapshotRows > 0 &&
    sourceAssociationCheck === "ok" &&
    asOfProof.ok;
  // B20 / E-4：不再是「哈希字符串长度为 64」的同义反复，而是**重算内容哈希**。
  const fileHashOk = verifyExportFiles(
    [{ name: "calls-v2.csv", sha256: csvHash }],
    new Map([["calls-v2.csv", Buffer.from(csv, "utf8")]])
  ).ok;
  const relationCheckOk = relation.ok;
  // 冻结契约（audit-trust R1 验收矩阵判据 #6）：严格三项 AND，不加第四项。
  const combinedComplete = scopeComplete && fileHashOk && relationCheckOk;
  const maintenanceRows = relation.counts.audit_maintenance_log ?? 0;
  const legalEmptyWindow = maintenanceRows === 0;

  // ─── B13：来源声明三字段（U7：本期只做来源声明，不引入签名）──────────────
  const provenanceInput = options.provenance ?? {};
  const exportedBy = provenanceInput.exportedBy ?? null;
  const exportReason = provenanceInput.exportReason ?? null;
  const exportApprovalRef = provenanceInput.exportApprovalRef ?? null;
  const provenance: ExportProvenance = {
    exportedBy,
    exportReason,
    exportApprovalRef,
    // 无值时按 U2 六值枚举记原因；**不虚构批准记录**，不新增导出审批流程。
    nullReason:
      exportedBy !== null && exportReason !== null && exportApprovalRef !== null
        ? "not_applicable"
        : exportApprovalRef === null
          ? "not_supported"
          : "not_collected"
  };

  const crossFileRelations: CrossFileRelations = {
    accessLogToSources: "access_log.id = access_log_sources.access_log_id",
    accessLogToPermissionSnapshots: "access_log.permission_snapshot_hash = permission_snapshots.hash",
    callsToQuestions: "access_log.lucy_turn_id = conversation_turns.turn_id",
    exceptions: []
  };

  const exclusions: ExportExclusions = options.exclusions ?? {
    excluded: false,
    reason: null,
    items: []
  };

  const exportedAt = new Date(now()).toISOString();
  const manifest: ExportV2Manifest = {
    schemaVersion: "audit-export-manifest/v2",
    classificationVersion: options.classificationVersion,
    digestVersion: options.digestVersion,
    ledgerUpperSeq: upperSeq,
    projectionComplete,
    scopeComplete,
    dataScope: {
      ok: projectionComplete,
      reason: projectionComplete ? undefined : catchUpExpired ? "catchup_deadline_exceeded" : "projection_lag"
    },
    associationQuality: buildAssociationQuality(db, selectedAccessLogIds),
    clientCoverage: { observed: false, gapWindows: [], unknownReason: "no_controlled_client" },
    integrityVerification: { fileHashOk, relationCheckOk },
    combinedComplete,
    lagMs: projectionLag,
    policyScopeExpanded: [],
    untrustedSelfReport: 0,
    legalEmptyWindow,
    // ─── B13 ──────────────────────────────────────────────────────────────
    provenance,
    crossFileRelations,
    exclusions,
    derivationVersion: DERIVATION_VERSION,
    prevExportId: options.prevExportId ?? null,
    exportId: options.exportId ?? randomUUID(),
    sortKey: "access_log.id ASC",
    paginationRuleVersion: "audit-export-pagination/v1",
    protocolInclusionRule: "declared_protocol_rules_v1",
    exportedAt,
    filter: {
      from: options.fixedFilter.from ?? null,
      until: options.fixedFilter.until ?? null,
      userId: options.fixedFilter.userId ?? null
    },
    timeRange: {
      from: options.fixedFilter.from ?? null,
      until: options.fixedFilter.until ?? null
    },
    cutoffAt: options.cutoffAt ?? exportedAt,
    files: [{ name: "calls-v2.csv", sha256: csvHash, rowCount: rows.length }],
    catchUpDeadlineSeconds: AUDIT_WINDOWS.t3ExportCatchupSeconds
  };

  if (mode === "complete" && !combinedComplete) {
    throw new Error("integrity_or_relation_failed");
  }
  // B21 / U6：T3 超时 → 正式导出失败，只可生成明确 partial 的诊断包。
  if (mode === "complete" && catchUpExpired) {
    throw new Error("catchup_deadline_exceeded");
  }

  return {
    ok: true,
    mode,
    upperSeq,
    rowCount: rows.length,
    combinedComplete,
    scopeComplete,
    fileHashOk,
    relationCheckOk,
    diagnosticIncomplete,
    asOfProof,
    csv,
    selectedAccessLogIds,
    manifest
  };
}

export { HEADERS_V2 as EXPORT_V2_HEADERS };

/**
 * Optional convenience helper to write the export CSV + manifest to a directory.
 */
export function writeExportArtifacts(
  outDir: string,
  result: ExportV2Result
): { csvPath: string; manifestPath: string } {
  mkdirSync(outDir, { recursive: true });
  const csvPath = join(outDir, "calls-v2.csv");
  const manifestPath = join(outDir, "manifest.json");
  writeFileSync(csvPath, result.csv);
  writeFileSync(manifestPath, JSON.stringify(result.manifest, null, 2));
  return { csvPath, manifestPath };
}

// ─── T04d: v2 export-pack (zip + manifest v2) ─────────────────────────────────
//
// Contract §4.2 / §6.1. zip contains:
//   - calls-v2.csv              (main export, v2 columns)
//   - access_log_sources.csv    (related rows for relation_check)
//   - permission_snapshots.csv  (related rows for scope_complete)
//   - linked_handshake_rows.jsonl (per contract §6.1, only included when
//     manifest.associationQuality handshake buckets are non-empty)
//   - manifest.json            (audit-export-manifest/v2 with file_hash list)
//
// file_hash_ok in manifest.integrityVerification requires ALL files match
// their declared sha256; relation_check_ok requires counts within ±0 of the
// declared counts.

export type ExportPackV2Result = {
  zip: Buffer;
  manifest: ExportV2Manifest;
  files: Array<{ name: string; sha256: string; rowCount: number }>;
};

function csvEscapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function renderAccessLogSourcesCsv(
  db: Database.Database,
  selectedIds: readonly number[],
  seqUpperBound?: number
): { csv: string; rowCount: number } {
  if (selectedIds.length === 0) return { csv: "", rowCount: 0 };
  const ids = idList(selectedIds);
  // F-02：来源行同样受账本上界约束 —— 晚于 S 写入的来源行是 >S 的关联事实，
  // 不得混入 as-of S 的证据包。列不存在时无法施加该边界（由证明判为不可证明）。
  const hasLedgerSeq = tableColumns(db, "access_log_sources").has("ledger_seq");
  const boundClause = hasLedgerSeq && seqUpperBound !== undefined ? " AND ledger_seq <= ?" : "";
  const boundParams = hasLedgerSeq && seqUpperBound !== undefined ? [seqUpperBound] : [];
  const rows = db
    .prepare(
      `SELECT id, access_log_id, ts, user_id, connection_id, schema_name, source_name,
              physical_table, extraction_method, confidence
         FROM access_log_sources
        WHERE access_log_id IN (${ids.sql})${boundClause}
        ORDER BY id ASC`
    )
    .all(...ids.params, ...boundParams) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { csv: "", rowCount: 0 };
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscapeCell(row[h])).join(","));
  }
  return { csv: lines.join("\n") + "\n", rowCount: rows.length };
}

function renderPermissionSnapshotsCsv(
  db: Database.Database,
  selectedIds: readonly number[]
): { csv: string; rowCount: number } {
  if (selectedIds.length === 0) return { csv: "", rowCount: 0 };
  const ids = idList(selectedIds);
  const hasReferences = tableColumns(db, "access_log").has("permission_snapshot_hash") &&
    tableColumns(db, "permission_snapshots").has("hash");
  if (!hasReferences) return { csv: "", rowCount: 0 };
  const rows = db.prepare(
    `SELECT hash, created_at, roles_json, resolved_json, capability_digest,
            tool_classification_version
       FROM permission_snapshots
      WHERE hash IN (
        SELECT DISTINCT permission_snapshot_hash FROM access_log
         WHERE id IN (${ids.sql}) AND permission_snapshot_hash IS NOT NULL
      )
      ORDER BY created_at ASC`
  ).all(...ids.params) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { csv: "", rowCount: 0 };
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscapeCell(row[h])).join(","));
  }
  return { csv: lines.join("\n") + "\n", rowCount: rows.length };
}

export async function buildExportPackV2(
  options: ExportV2Options
): Promise<ExportPackV2Result> {
  const exportResult = await performExportV2(options);
  const db = options.snapshotDb ?? options.sourceDb!;

  const sources = renderAccessLogSourcesCsv(
    db,
    exportResult.selectedAccessLogIds,
    exportResult.upperSeq
  );
  const snaps = renderPermissionSnapshotsCsv(db, exportResult.selectedAccessLogIds);

  const fileEntries: Array<{ name: string; data: Buffer }> = [];
  const fileMeta: Array<{ name: string; sha256: string; rowCount: number }> = [];

  const csvBuf = Buffer.from(exportResult.csv, "utf8");
  fileEntries.push({ name: "calls-v2.csv", data: csvBuf });
  fileMeta.push({ name: "calls-v2.csv", sha256: sha256Hex(csvBuf), rowCount: exportResult.rowCount });

  if (sources.csv) {
    const buf = Buffer.from(sources.csv, "utf8");
    fileEntries.push({ name: "access_log_sources.csv", data: buf });
    fileMeta.push({ name: "access_log_sources.csv", sha256: sha256Hex(buf), rowCount: sources.rowCount });
  }
  if (snaps.csv) {
    const buf = Buffer.from(snaps.csv, "utf8");
    fileEntries.push({ name: "permission_snapshots.csv", data: buf });
    fileMeta.push({ name: "permission_snapshots.csv", sha256: sha256Hex(buf), rowCount: snaps.rowCount });
  }

  // linked_handshake_rows.jsonl: include only when association_status includes
  // handshake-attributable turns. Heuristic: any access_log row has
  // association_status in {confirmed, legacy_unverified} OR is unassigned AND
  // event_type=protocol.
  const selected = idList(exportResult.selectedAccessLogIds);
  const handshakeRows = exportResult.selectedAccessLogIds.length === 0
    ? []
    : db.prepare(
        `SELECT id, ts, user_id, tool, lucy_turn_id, association_status
           FROM access_log
          WHERE id IN (${selected.sql})
            AND event_type = 'protocol'
            AND (association_status IN ('confirmed','legacy_unverified')
                 OR association_status IS NULL)
          ORDER BY id ASC`
      ).all(...selected.params) as Array<Record<string, unknown>>;
  if (handshakeRows.length > 0) {
    const jsonl = handshakeRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    const buf = Buffer.from(jsonl, "utf8");
    fileEntries.push({ name: "linked_handshake_rows.jsonl", data: buf });
    fileMeta.push({
      name: "linked_handshake_rows.jsonl",
      sha256: sha256Hex(buf),
      rowCount: handshakeRows.length
    });
  }

  // Manifest v2 with file hash list and integrity verification
  const manifest = {
    ...exportResult.manifest,
    files: fileMeta
  } as ExportV2Manifest & { files: typeof fileMeta };

  // B20 / E-4：独立文件校验器 —— **重算每个文件内容的 sha256**。
  //
  // 此前的实现只验 `sha256.length === 64`（同义反复），删除 / 替换 / 改内容
  // 都检不出来。这里把实际写入 zip 的 buffer 重新哈希，与清单声明比对。
  //
  // 这是**本地清单验证**，不等于「防篡改签名」或「独立来源证明」
  // （术语标准 §3 禁止此类宣称）。
  const actualContents = new Map<string, Buffer>(fileEntries.map((e) => [e.name, e.data]));
  const verification = verifyExportFiles(fileMeta, actualContents);
  (manifest.integrityVerification as { fileHashOk: boolean; relationCheckOk: boolean }).fileHashOk =
    verification.ok;
  manifest.combinedComplete = manifest.scopeComplete &&
    manifest.integrityVerification.fileHashOk &&
    manifest.integrityVerification.relationCheckOk;
  if (options.mode === "complete" && !manifest.combinedComplete) {
    throw new Error("integrity_or_relation_failed");
  }

  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fileEntries.push({ name: "manifest.json", data: manifestBuf });

  // Lazy require to prevent a circular dependency at module load.
  const { buildStoredZip } = await import("../proxy/zip-store.js");
  const zip = buildStoredZip(fileEntries);

  return {
    zip,
    manifest,
    files: fileMeta
  };
}