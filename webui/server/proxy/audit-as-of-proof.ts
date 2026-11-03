/**
 * Lucy v0.25 / L25-09 S06 §12.5 + §18.10 F-02 —— **精确 as-of S 证明**。
 *
 * 权威来源：
 *   - `docs/specs/lucy-20261020-v2p5-audit-increment-spec.md` §12.5（导出伪代码）
 *   - 同上 §18.10 F-02（2026-10-27 交叉审阅修订）
 *   - `docs/specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md` §3.1／§5
 *
 * ─── 硬规则（逐条来自 Spec，不得放宽）────────────────────────────────────
 *
 * 1. **列存在 ≠ 内容可重建**。`access_log.ledger_seq` 列存在、`seq <= S` 可执行，
 *    都**不**等于「基础事实／归属修订／关联／聚合可按 S 精确重建」。旧实现以
 *    `present.has("ledger_seq")` 充当 as-of 判据，本模块取代它。
 * 2. 四个维度**各自独立**判定；任一维度不可证明即整体 `ok=false`。
 * 3. 不可证明时**必须**给出 `actualBound`（实际证据界）与 `missingSets`
 *    （缺失集合），不得只说「不完整」。
 * 4. `ok=false` 的唯一合法后果：**正式完整导出**与**正式完整对账读取**失败关闭；
 *    只允许显式诊断性不完整结果（`diagnostic_incomplete` + 实际证据界 + 缺失集合）。
 * 5. 本模块**只证明，不改写**：不修改任何事实列，不回填历史行，不重解释历史数据。
 *
 * ─── 各维度的可证明依据（运行时证据）────────────────────────────────────
 *
 * - **baseFacts**：范围内每一行都有账本序号且 `ledger_seq <= S`（行在 S 时刻已存在），
 *   归属列的有效值不靠「列不可变」证明，而靠改写日志前像回放。
 * - **revisions**：归属修订与归属就地改写都有账本序号。改写日志记的是
 *   「改写发生时的已提交上界」，不是一条新的账本事件，因此 `ledger_seq == S`
 *   不能证明该改写在捕获 S 时已经可见。只有 `ledger_seq < S` 的改写留在 S
 *   视图里；`ledger_seq >= S` 的改写必须按前像回放后才能证明。基线必须存在
 *   且 `S >= baseline`。
 * - **relations**：来源行都有账本序号。`ledger_seq > S` 的来源行从视图与导出
 *   排除，排除本身不否定已经可证明的 S。未排除的晚到行仍然不可证明。
 * - **aggregates**：由上述三项派生的计数 / 汇总，只在三者都成立时成立。
 */

import type Database from "better-sqlite3";

/** 证明规则版本（与 `derivationVersion` 同批冻结，v2p5-1）。 */
export const AS_OF_PROOF_VERSION = "v2p5-1";

/** 四个维度（Spec §12.5 伪代码的四个实参）。 */
export const AS_OF_PROOF_DIMENSIONS = ["baseFacts", "revisions", "relations", "aggregates"] as const;

export type AsOfProofDimensionId = (typeof AS_OF_PROOF_DIMENSIONS)[number];

export type AsOfProofDimension = {
  id: AsOfProofDimensionId;
  ok: boolean;
  /** `ok=false` 时必填：稳定原因码。 */
  reason: string | null;
  /** 该维度缺失项数量。 */
  missingCount: number;
};

export type AsOfSProof = {
  proofVersion: string;
  /** 四个维度全部成立时为 true。 */
  ok: boolean;
  /** 本次求值的账本上界 S。 */
  seqUpperBound: number;
  /**
   * 实际证据界。
   *
   * - `from`：证据完备的**起始**账本序号（归属改写日志基线）。`S < from` 时
   *   证据不完整。
   * - `to`：本次求值使用的上界（即 `seqUpperBound`）。
   */
  actualBound: { from: number; to: number };
  dimensions: AsOfProofDimension[];
  /**
   * 缺失集合：`维度 → 缺失标识`。
   *
   * 标识为稳定字符串：行 ID、修订 ID、来源行 ID 或原因码。诊断模式据此
   * 显式披露「缺什么」，不得只说「不完整」。
   */
  missingSets: Record<string, string[]>;
  /** 缺失项总数。 */
  missingTotal: number;
};

/** 证明输入中的范围行（调用方已按筛选与 `ledger_seq <= S` 取出的行）。 */
export type AsOfScopeRow = {
  id: number;
  /** 行写入时的账本已提交上界；null 表示位置不可判定。 */
  ledgerSeq: number | null;
  /** 该行的问询标识（用于关联修订定位）。 */
  turnId?: string | null;
};

export type ProveExactAsOfSInput = {
  db: Database.Database;
  /** 账本上界 S。 */
  seqUpperBound: number;
  /** 范围内行（调用方已按筛选与 `ledger_seq <= S` 取出）。 */
  rows: readonly AsOfScopeRow[];
  /**
   * 命中**同一筛选**、但位置不可判定的行（`ledger_seq IS NULL`）。
   *
   * 这些行被调用方的 `ledger_seq <= S` 过滤排除在视图之外，但它们确实落在
   * 请求范围内 —— 视图因此**无法证明**自己覆盖了完整的请求范围。缺省视为
   * 空集只是调用方「没有检查」，不是「已证明没有」；调用方必须显式传入。
   */
  unplaceableRowIds?: readonly number[];
  /**
   * 调用方已经按前像回放、从 S 视图拿掉的归属改写 id。
   * 这些改写的 `ledger_seq >= S`，不得再把证明判失败。
   */
  replayedMutationIds?: readonly number[];
  /**
   * 调用方已经从视图和证据包排除的来源行 id（`ledger_seq > S`）。
   * 排除本身不把可证明的 S 改成失败。
   */
  excludedSourceIds?: readonly number[];
};

function tableExists(db: Database.Database, name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name);
    return row !== undefined;
  } catch {
    return false;
  }
}

function columnExists(db: Database.Database, table: string, column: string): boolean {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    return rows.some((row) => row.name === column);
  } catch {
    return false;
  }
}

function readMetaValue(db: Database.Database, key: string): string | null {
  try {
    const row = db
      .prepare(`SELECT value FROM access_log_asof_meta WHERE key = ?`)
      .get(key) as { value?: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * 读归属改写日志基线。
 *
 * 基线 = 归属改写日志**上线时**的账本已提交上界。`S < baseline` 时无法排除
 * 「基线之前存在未登记的就地改写」→ 归属维度不可证明。
 */
export function readAttributionJournalBaseline(db: Database.Database): number | null {
  const raw = readMetaValue(db, "attribution_journal_baseline_seq");
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * `proveExactAsOfS(snapshot, S, filter, baseFacts, revisions, relations, aggregates)`。
 *
 * 旧实现以「`ledger_seq` 列存在」充当 as-of 判据（F-02 认定不满足规范）。
 * 本函数以**运行时证据**逐维度判定，并给出缺失集合。
 */
export function proveExactAsOfS(input: ProveExactAsOfSInput): AsOfSProof {
  const { db, seqUpperBound, rows } = input;
  const missingSets: Record<string, string[]> = {
    baseFacts: [],
    revisions: [],
    relations: [],
    aggregates: []
  };

  // ─── baseFacts ─────────────────────────────────────────────────────────
  // 行必须在 S 时刻已存在，且位置可判定。
  for (const row of rows) {
    if (row.ledgerSeq === null) {
      missingSets.baseFacts.push(`unpositioned_row:${row.id}`);
    } else if (row.ledgerSeq > seqUpperBound) {
      missingSets.baseFacts.push(`row_after_bound:${row.id}`);
    }
  }
  // 命中同一筛选但位置不可判定的行：被视图排除在范围外 → 范围完整不可证明。
  for (const id of input.unplaceableRowIds ?? []) {
    missingSets.baseFacts.push(`unpositioned_row:${id}`);
  }
  // 事实列的不可变性是代码层不变量（生产无事实列 UPDATE；漂移守卫测试机械校验）。
  // 这里只把「事实列改写证据不存在」这一事实作为结论依据记录在维度原因里。
  const baseFactsOk = missingSets.baseFacts.length === 0;

  // ─── revisions ────────────────────────────────────────────────────────
  // 1) 归属就地改写日志必须存在（有基线才说明「哪些改写被登记了」）。
  // 2) 基线必须可判定，且 S >= 基线。
  // 3) 范围内行的归属改写都必须有账本序号且不晚于 S。
  // 4) 归属修订（association_revisions）必须都有账本序号且不晚于 S。
  let baseline: number | null = null;
  if (!tableExists(db, "access_log_attribution_mutations")) {
    missingSets.revisions.push("attribution_mutation_journal_absent");
  } else if (!tableExists(db, "access_log_asof_meta")) {
    missingSets.revisions.push("attribution_journal_baseline_absent");
  } else {
    baseline = readAttributionJournalBaseline(db);
    if (baseline === null) {
      missingSets.revisions.push("attribution_journal_baseline_unknown");
    } else if (seqUpperBound < baseline) {
      missingSets.revisions.push(`pre_baseline_bound:${baseline}`);
    }
  }

  if (tableExists(db, "access_log_attribution_mutations")) {
    const scopeIds = rows.map((row) => row.id);
    if (scopeIds.length > 0) {
      const placeholders = scopeIds.map(() => "?").join(",");
      const mutations = db
        .prepare(
          `SELECT id, access_log_id, ledger_seq
             FROM access_log_attribution_mutations
            WHERE access_log_id IN (${placeholders})`
        )
        .all(...scopeIds) as Array<{ id: number; access_log_id: number; ledger_seq: number | null }>;
      const replayed = new Set(input.replayedMutationIds ?? []);
      for (const mutation of mutations) {
        if (mutation.ledger_seq === null) {
          missingSets.revisions.push(`undated_attribution_mutation:${mutation.id}`);
        } else if (mutation.ledger_seq >= seqUpperBound && !replayed.has(mutation.id)) {
          // `== S` 与 `> S` 一样不能留在当前列里：改写序号是当时的已提交上界。
          missingSets.revisions.push(`attribution_mutation_after_bound:${mutation.id}`);
        }
      }
    }
  }

  if (tableExists(db, "association_revisions")) {
    const hasLedgerSeq = columnExists(db, "association_revisions", "ledger_seq");
    if (!hasLedgerSeq) {
      missingSets.revisions.push("association_revisions_ledger_seq_absent");
    } else {
      const scopeTurnIds = [...new Set(rows.map((row) => row.turnId).filter((id): id is string => !!id))];
      if (scopeTurnIds.length > 0) {
        const placeholders = scopeTurnIds.map(() => "?").join(",");
        const revisions = db
          .prepare(
            `SELECT id, ledger_seq
               FROM association_revisions
              WHERE original_turn_id IN (${placeholders})`
          )
          .all(...scopeTurnIds) as Array<{ id: number; ledger_seq: number | null }>;
        for (const revision of revisions) {
          if (revision.ledger_seq === null) {
            missingSets.revisions.push(`undated_association_revision:${revision.id}`);
          } else if (revision.ledger_seq > seqUpperBound) {
            missingSets.revisions.push(`association_revision_after_bound:${revision.id}`);
          }
        }
      }
    }
  }

  const revisionsOk = missingSets.revisions.length === 0;

  // ─── relations ────────────────────────────────────────────────────────
  // 来源行必须有账本序号且不晚于 S；晚于 S 的来源行必须被视图与导出排除。
  if (!tableExists(db, "access_log_sources")) {
    missingSets.relations.push("source_table_absent");
  } else if (!columnExists(db, "access_log_sources", "ledger_seq")) {
    missingSets.relations.push("source_ledger_seq_absent");
  } else {
    const scopeIds = rows.map((row) => row.id);
    if (scopeIds.length > 0) {
      const placeholders = scopeIds.map(() => "?").join(",");
      const sources = db
        .prepare(
          `SELECT id, ledger_seq
             FROM access_log_sources
            WHERE access_log_id IN (${placeholders})`
        )
        .all(...scopeIds) as Array<{ id: number; ledger_seq: number | null }>;
      const excludedSources = new Set(input.excludedSourceIds ?? []);
      for (const source of sources) {
        if (source.ledger_seq === null) {
          missingSets.relations.push(`unpositioned_source:${source.id}`);
        } else if (source.ledger_seq > seqUpperBound && !excludedSources.has(source.id)) {
          missingSets.relations.push(`source_after_bound:${source.id}`);
        }
      }
    }
  }

  const relationsOk = missingSets.relations.length === 0;

  // ─── aggregates ───────────────────────────────────────────────────────
  // 聚合由基础事实、归属修订与关联派生；三者任一不成立则聚合不成立。
  if (!baseFactsOk) missingSets.aggregates.push("derived_from_base_facts");
  if (!revisionsOk) missingSets.aggregates.push("derived_from_revisions");
  if (!relationsOk) missingSets.aggregates.push("derived_from_relations");
  const aggregatesOk = missingSets.aggregates.length === 0;

  const dimensions: AsOfProofDimension[] = [
    {
      id: "baseFacts",
      ok: baseFactsOk,
      reason: baseFactsOk ? "rows_positioned" : "row_position_undeterminable",
      missingCount: missingSets.baseFacts.length
    },
    {
      id: "revisions",
      ok: revisionsOk,
      reason: revisionsOk
        ? "attribution_revisions_positioned"
        : "attribution_revision_history_incomplete",
      missingCount: missingSets.revisions.length
    },
    {
      id: "relations",
      ok: relationsOk,
      reason: relationsOk ? "source_rows_positioned" : "source_rows_position_undeterminable",
      missingCount: missingSets.relations.length
    },
    {
      id: "aggregates",
      ok: aggregatesOk,
      reason: aggregatesOk ? "derived_from_proven_dimensions" : "upstream_dimension_not_proven",
      missingCount: missingSets.aggregates.length
    }
  ];

  const missingTotal = Object.values(missingSets).reduce((sum, list) => sum + list.length, 0);

  return {
    proofVersion: AS_OF_PROOF_VERSION,
    ok: baseFactsOk && revisionsOk && relationsOk && aggregatesOk,
    seqUpperBound,
    actualBound: {
      from: baseline ?? 0,
      to: seqUpperBound
    },
    dimensions,
    missingSets,
    missingTotal
  };
}

/**
 * 诊断性不完整结果的载荷（Spec §3.1／§5：正式完整模式失败时，
 * 只允许返回显式 `diagnostic_incomplete`、实际证据界与缺失集合）。
 */
export type DiagnosticIncomplete = {
  status: "diagnostic_incomplete";
  reason: "as_of_s_unprovable";
  proof: AsOfSProof;
};

type ReplayableRow = {
  id: number;
  lucy_turn_id?: string | null;
  effective_turn_id?: string | null;
  association_status?: string | null;
};

/**
 * 把 `ledger_seq >= S` 的归属改写从当前列上剥掉，恢复日志前像。
 *
 * 改写序号等于 S 时，不能判断改写发生在捕获 S 之前还是之后。S 视图使用前像，
 * 同一次 S 的再次读取才不会改口。缺前像列时该改写记为不可回放，证明不得通过。
 */
export function projectAttributionAsOfS<T extends ReplayableRow>(
  db: Database.Database,
  rows: readonly T[],
  seqUpperBound: number
): {
  rows: T[];
  replayedMutationIds: number[];
  unreplayableMutationIds: number[];
  excludedSourceIds: number[];
} {
  const projected = rows.map((row) => ({ ...row }));
  const replayedMutationIds: number[] = [];
  const unreplayableMutationIds: number[] = [];
  const byRow = new Map<number, T>();
  for (const row of projected) byRow.set(Number(row.id), row);

  if (tableExists(db, "access_log_attribution_mutations") && projected.length > 0) {
    const info = db.prepare(`PRAGMA table_info(access_log_attribution_mutations)`).all() as Array<{ name: string }>;
    const names = new Set(info.map((column) => column.name));
    const canReplay = names.has("before_turn_id") && names.has("before_association_status");
    const ids = projected.map((row) => Number(row.id));
    const placeholders = ids.map(() => "?").join(",");
    const selected = canReplay
      ? "id, access_log_id, ledger_seq, before_turn_id, before_association_status"
      : "id, access_log_id, ledger_seq";
    const mutations = db
      .prepare(
        `SELECT ${selected}
           FROM access_log_attribution_mutations
          WHERE access_log_id IN (${placeholders})
          ORDER BY id DESC`
      )
      .all(...ids) as Array<{
      id: number;
      access_log_id: number;
      ledger_seq: number | null;
      before_turn_id?: string | null;
      before_association_status?: string | null;
    }>;
    for (const mutation of mutations) {
      if (mutation.ledger_seq === null || mutation.ledger_seq < seqUpperBound) continue;
      if (!canReplay) {
        unreplayableMutationIds.push(mutation.id);
        continue;
      }
      const row = byRow.get(mutation.access_log_id);
      if (!row) continue;
      row.lucy_turn_id = mutation.before_turn_id ?? null;
      row.effective_turn_id = mutation.before_turn_id ?? null;
      row.association_status = mutation.before_association_status ?? null;
      replayedMutationIds.push(mutation.id);
    }
  }

  const excludedSourceIds: number[] = [];
  if (
    tableExists(db, "access_log_sources") &&
    columnExists(db, "access_log_sources", "ledger_seq") &&
    projected.length > 0
  ) {
    const ids = projected.map((row) => Number(row.id));
    const placeholders = ids.map(() => "?").join(",");
    const late = db
      .prepare(
        `SELECT id FROM access_log_sources
          WHERE access_log_id IN (${placeholders}) AND ledger_seq > ?`
      )
      .all(...ids, seqUpperBound) as Array<{ id: number }>;
    for (const source of late) excludedSourceIds.push(Number(source.id));
  }

  return { rows: projected, replayedMutationIds, unreplayableMutationIds, excludedSourceIds };
}

export function buildDiagnosticIncomplete(proof: AsOfSProof): DiagnosticIncomplete {
  return {
    status: "diagnostic_incomplete",
    reason: "as_of_s_unprovable",
    proof
  };
}
