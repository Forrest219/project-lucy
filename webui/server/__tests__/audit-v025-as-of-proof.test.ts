/**
 * Lucy v0.25 / L25-09 §18.10 F-02 —— 精确 as-of S 证明与正式导出失败关闭。
 *
 * 覆盖：
 * - `proveExactAsOfS` 的四个维度判定与缺失集合披露；
 * - 正式完整导出在 as-of 不可证明时**失败关闭**（不再以「列存在」充当判据）；
 * - 诊断模式显式披露实际证据界与缺失集合；
 * - 冻结契约 `combinedComplete = scopeComplete AND fileHashOk AND relationCheckOk`
 *   仍严格是三项 AND（不加第四项）。
 */
import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  AS_OF_PROOF_DIMENSIONS,
  AS_OF_PROOF_VERSION,
  proveExactAsOfS
} from "../proxy/audit-as-of-proof";
import { performExportV2, type ExportMode } from "../admin/audit-export-v2";

function makeDb(options: {
  withJournal?: boolean;
  withBaseline?: boolean;
  withSourceLedgerSeq?: boolean;
  rowLedgerSeq?: number | null;
  sourceLedgerSeq?: number | null;
  mutationLedgerSeq?: number | null;
  baseline?: number;
} = {}): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ledger_seq INTEGER,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      outcome TEXT,
      decision_reason TEXT,
      duration_ms INTEGER,
      response_row_count INTEGER,
      event_type TEXT,
      transport_sub_type TEXT,
      transport_status TEXT,
      authorization_status TEXT,
      execution_status TEXT,
      usability_status TEXT,
      association_status TEXT,
      original_turn_id TEXT,
      effective_turn_id TEXT,
      attempt_id TEXT,
      parent_attempt_id TEXT,
      instance_id TEXT,
      classification_version TEXT,
      permission_snapshot_hash TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER,
      ledger_seq INTEGER
    );
    CREATE TABLE permission_snapshots (id INTEGER PRIMARY KEY, hash TEXT NOT NULL);
    CREATE TABLE association_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_turn_id TEXT,
      ledger_seq INTEGER
    );
    CREATE TABLE audit_maintenance_log (id INTEGER PRIMARY KEY);
  `);
  if (options.withSourceLedgerSeq !== false) {
    // 列已存在（生产由 ensureColumn 添加）
  }
  if (options.withJournal !== false) {
    db.exec(`
      CREATE TABLE access_log_attribution_mutations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        access_log_id INTEGER NOT NULL,
        ledger_seq INTEGER,
        kind TEXT NOT NULL
      );
    `);
  }
  if (options.withBaseline !== false) {
    db.exec(`
      CREATE TABLE access_log_asof_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO access_log_asof_meta (key, value)
        VALUES ('attribution_journal_baseline_seq', '${options.baseline ?? 1}');
    `);
  }
  db.prepare(
    `INSERT INTO access_log (ts, user_id, tool, outcome, decision_reason, duration_ms, response_row_count,
        event_type, transport_sub_type, transport_status, authorization_status, execution_status,
        usability_status, association_status, original_turn_id, effective_turn_id, classification_version,
        ledger_seq, permission_snapshot_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    "2026-10-19T12:00:00Z", "u1", "lucy_query", "ok", "allowed", 100, 5,
    "tool_call", "other", "succeeded", "allowed", "succeeded", "usable",
    "confirmed", "turn-1", "turn-1", "audit-trust-2026-10-19-r1.v1",
    options.rowLedgerSeq === undefined ? 1 : options.rowLedgerSeq, "hash-1"
  );
  db.prepare(
    `INSERT INTO access_log_sources (access_log_id, ledger_seq) VALUES (1, ?)`
  ).run(options.sourceLedgerSeq === undefined ? 1 : options.sourceLedgerSeq);
  db.prepare(`INSERT INTO permission_snapshots (hash) VALUES ('hash-1')`).run();
  if (options.mutationLedgerSeq !== undefined) {
    db.prepare(
      `INSERT INTO access_log_attribution_mutations (access_log_id, ledger_seq, kind) VALUES (1, ?, 'handshake_attachment')`
    ).run(options.mutationLedgerSeq);
  }
  return db;
}

const baseOptions = {
  mode: "complete" as ExportMode,
  fixedFilter: {},
  fixedZone: "UTC",
  auditStoreAvailable: true,
  securityStoreAvailable: true,
  classificationVersion: "audit-trust-2026-10-19-r1.v1",
  digestVersion: "audit-trust-2026-10-19-r1.v1",
  ledgerUpperSeq: 3
};

describe("F-02 proveExactAsOfS —— 四维度独立判定", () => {
  it("证据齐全时 ok=true，四维度全部成立", () => {
    const db = makeDb();
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.proofVersion).toBe(AS_OF_PROOF_VERSION);
    expect(proof.ok).toBe(true);
    expect(proof.dimensions.map((d) => d.id)).toEqual([...AS_OF_PROOF_DIMENSIONS]);
    expect(proof.dimensions.every((d) => d.ok)).toBe(true);
    expect(proof.missingTotal).toBe(0);
    expect(proof.actualBound.to).toBe(3);
  });

  it("行位置不可判定 → baseFacts 不成立并披露行 ID", () => {
    const db = makeDb({ rowLedgerSeq: null });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: null, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.baseFacts).toContain("unpositioned_row:1");
    expect(proof.dimensions.find((d) => d.id === "baseFacts")?.ok).toBe(false);
  });

  it("归属改写日志缺失 → revisions 不成立", () => {
    const db = makeDb({ withJournal: false });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.revisions).toContain("attribution_mutation_journal_absent");
  });

  it("基线缺失 → revisions 不成立（不得猜一个基线）", () => {
    const db = makeDb({ withBaseline: false });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.revisions).toContain("attribution_journal_baseline_absent");
  });

  it("S 早于基线 → revisions 不成立（无法排除基线前的未登记改写）", () => {
    const db = makeDb({ baseline: 10 });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.revisions).toContain("pre_baseline_bound:10");
  });

  it("归属改写发生在 S 之后 → revisions 不成立（当前视图含 >S 的归属事实）", () => {
    const db = makeDb({ mutationLedgerSeq: 9 });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.revisions.some((id) => id.startsWith("attribution_mutation_after_bound:"))).toBe(true);
  });

  it("来源行晚于 S → relations 不成立（>S 的关联事实不得混入）", () => {
    const db = makeDb({ sourceLedgerSeq: 9 });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: 1, turnId: "turn-1" }]
    });
    expect(proof.ok).toBe(false);
    expect(proof.missingSets.relations.some((id) => id.startsWith("source_after_bound:"))).toBe(true);
  });

  it("聚合维度随上游维度失败", () => {
    const db = makeDb({ rowLedgerSeq: null });
    const proof = proveExactAsOfS({
      db,
      seqUpperBound: 3,
      rows: [{ id: 1, ledgerSeq: null }]
    });
    expect(proof.dimensions.find((d) => d.id === "aggregates")?.ok).toBe(false);
    expect(proof.missingSets.aggregates).toContain("derived_from_base_facts");
  });
});

describe("F-02 正式导出失败关闭", () => {
  it("as-of 不可证明时 complete 模式抛错（不再以「列存在」充当判据）", async () => {
    const db = makeDb({ withJournal: false });
    await expect(performExportV2({ ...baseOptions, snapshotDb: db })).rejects.toThrow(
      "integrity_or_relation_failed"
    );
  });

  it("as-of 不可证明时 scopeComplete=false 且 combinedComplete=false", async () => {
    const db = makeDb({ withJournal: false });
    const result = await performExportV2({
      ...baseOptions,
      mode: "diagnostic",
      confirmDiagnostic: true,
      snapshotDb: db
    });
    expect(result.scopeComplete).toBe(false);
    expect(result.combinedComplete).toBe(false);
    expect(result.asOfProof.ok).toBe(false);
    expect(result.diagnosticIncomplete).toContain("as_of_s_unprovable");
    expect(
      result.diagnosticIncomplete.some((entry) => entry.startsWith("revisions:attribution_mutation_journal_absent"))
    ).toBe(true);
  });

  it("冻结契约：combinedComplete 严格是三项 AND，不加第四项", async () => {
    const db = makeDb();
    const result = await performExportV2({ ...baseOptions, snapshotDb: db });
    expect(result.manifest.combinedComplete).toBe(
      result.scopeComplete && result.fileHashOk && result.relationCheckOk
    );
  });

  it("命中筛选但位置不可判定的行不得被静默丢弃（范围完整不可证明）", async () => {
    const db = makeDb();
    // 同一筛选下另一行：账本位置不可判定（写入早于账本序号列的历史行）。
    db.prepare(
      `INSERT INTO access_log (ts, user_id, tool, outcome, duration_ms, ledger_seq, permission_snapshot_hash)
       VALUES ('2026-10-19T12:00:00Z', 'u1', 'lucy_query', 'ok', 10, NULL, 'hash-1')`
    ).run();
    const result = await performExportV2({
      ...baseOptions,
      mode: "diagnostic",
      confirmDiagnostic: true,
      snapshotDb: db
    });
    expect(result.asOfProof.ok).toBe(false);
    expect(result.scopeComplete).toBe(false);
    expect(
      result.diagnosticIncomplete.some((entry) => entry.startsWith("baseFacts:unpositioned_row:"))
    ).toBe(true);
    await expect(performExportV2({ ...baseOptions, snapshotDb: db })).rejects.toThrow(
      "integrity_or_relation_failed"
    );
  });
});

describe("F-02 漂移守卫 —— 事实列不可变（代码层不变量）", () => {
  /** 允许就地改写的列：都不是「事实列」（执行 / 送达 / 授权 / 归属之外的行内容）。 */
  const MUTABLE_COLUMNS = new Set([
    "args_summary",
    "lucy_turn_id",
    "turn_attribution_mode",
    "turn_attribution_confidence",
    "association_status"
  ]);

  function serverSourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        serverSourceFiles(full, acc);
      } else if (entry.endsWith(".ts")) {
        acc.push(full);
      }
    }
    return acc;
  }

  it("生产代码不得就地改写 access_log 的事实列", () => {
    const files = serverSourceFiles(join(process.cwd(), "server"));
    const offenders: string[] = [];
    const pattern = /UPDATE\s+access_log\s+SET\s+([^;"'`]+)/gi;
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) {
        const assignment = match[1];
        const column = assignment.split("=")[0].trim().toLowerCase();
        if (!MUTABLE_COLUMNS.has(column)) {
          offenders.push(`${file}: ${column}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
