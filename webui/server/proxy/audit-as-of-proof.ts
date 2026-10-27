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
 *   且行的**事实列**在写入后未被改写。事实列的不可变性由代码层不变量保证
 *   （生产代码不存在对事实列的 UPDATE；由漂移守卫测试 `audit-as-of-drift.test.ts`
 *   机械校验），本模块在事实列缺失改写证据时给出 `fact_columns_immutable` 结论。
 * - **revisions**：归属修订（`association_revisions`）与归属就地改写
 *   （`access_log_attribution_mutations`）都有账本序号，且都**不晚于 S**；
 *   归属改写日志的基线（`access_log_asof_meta.attribution_journal_baseline_seq`）
 *   必须存在且 `S >= baseline` —— 否则无法排除「基线之前存在未登记的就地改写」。
 * - **relations**：来源行（`access_log_sources`）都有账本序号且 `ledger_seq <= S`；
 *   晚于 S 的来源行必须**从视图与导出中排除**，不得混入。
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
      for (const mutation of mutations) {
        if (mutation.ledger_seq === null) {
          missingSets.revisions.push(`undated_attribution_mutation:${mutation.id}`);
        } else if (mutation.ledger_seq > seqUpperBound) {
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
      for (const source of sources) {
        if (source.ledger_seq === null) {
          missingSets.relations.push(`unpositioned_source:${source.id}`);
        } else if (source.ledger_seq > seqUpperBound) {
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
      reason: baseFactsOk
        ? "fact_columns_immutable_and_rows_positioned"
        : "row_position_undeterminable",
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

export function buildDiagnosticIncomplete(proof: AsOfSProof): DiagnosticIncomplete {
  return {
    status: "diagnostic_incomplete",
    reason: "as_of_s_unprovable",
    proof
  };
}
