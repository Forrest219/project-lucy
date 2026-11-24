/**
 * P1-36 / P1-37 — 封存导出的文件列守卫（CR-07）。
 *
 * - `calls-v2.csv`：已收口的列与顺序必须与 P1-36 之前（28cad205）逐字节一致；P1-36 允许的唯一变化是
 *   **只在末尾追加** `ip_source`／`trusted_source`／`rejection_fingerprint`（D8 与 P1-37 U2）。
 *   golden `audit-export-v2-calls-prefix.json` 由追加前的实现产出：表头与每行去掉追加列后必须完全相同。
 * - `spans.csv`：P1-36 新增文件，没有「追加前」实现；golden `audit-export-v2-spans.json` 冻结
 *   首个收口版本的表头与行文本。改动它＝改封存文件格式，须先在 Spec 变更表记委托人批准。
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { expectMatchesGolden } from "./golden";
import { seedLegacyCallRows } from "./fixtures";

const APPENDED_TAIL = ["ip_source", "trusted_source", "rejection_fingerprint"] as const;

let dir: string;
let dbPath: string;
let prev: string | undefined;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-export-cols-"));
  dbPath = path.join(dir, "audit.sqlite");
  prev = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = dbPath;
});
afterEach(async () => {
  const audit = await import("../../proxy/audit");
  audit.closeAuditDb();
  if (prev === undefined) delete process.env.LUCY_AUDIT_DB; else process.env.LUCY_AUDIT_DB = prev;
  await rm(dir, { recursive: true, force: true });
});

/** 与生成 golden 时完全相同的步骤：建库（经一次写入）→ 清空 → 固定夹具行。 */
async function seedDb(): Promise<{ db: Database.Database; ids: number[] }> {
  const audit = await import("../../proxy/audit");
  await audit.writeLog({ ts: new Date(0).toISOString(), userId: "boot", tool: "ping", outcome: "ok", durationMs: 1, requestId: "boot" } as never);
  audit.closeAuditDb();
  const db = new Database(dbPath);
  db.exec("DELETE FROM access_log; DELETE FROM sqlite_sequence WHERE name='access_log';");
  return { db, ids: seedLegacyCallRows(db) };
}

describe("calls-v2.csv keeps its closed columns byte for byte (audit-export-v2-calls-prefix)", () => {
  it("only the three P1-36/P1-37 columns are appended, at the end, in this order", async () => {
    const { EXPORT_V2_HEADERS } = await import("../../admin/audit-export-v2");
    expect(new Set(EXPORT_V2_HEADERS).size).toBe(EXPORT_V2_HEADERS.length);
    expect(EXPORT_V2_HEADERS.slice(-APPENDED_TAIL.length)).toEqual([...APPENDED_TAIL]);
  });

  it("header and rows, with the appended cells removed, equal the pre-P1-36 golden", async () => {
    const { performExportV2, EXPORT_V2_HEADERS } = await import("../../admin/audit-export-v2");
    const { db, ids } = await seedDb();
    const result = await performExportV2({
      mode: "diagnostic", confirmDiagnostic: true, fixedFilter: {}, fixedZone: "UTC",
      auditStoreAvailable: true, securityStoreAvailable: true,
      classificationVersion: "audit-trust-2026-10-19-r1.v1", digestVersion: "audit-trust-2026-10-19-r1.v1",
      ledgerUpperSeq: Math.max(...ids), snapshotDb: db
    });
    const headerTail = `,${APPENDED_TAIL.join(",")}\n`;
    const headerEnd = result.csv.indexOf("\n") + 1;
    expect(result.csv.slice(headerEnd - headerTail.length, headerEnd)).toBe(headerTail);
    const body = result.csv.slice(headerEnd);
    // 旧行没有追加列的取值：每条记录末尾恰好多出 3 个空单元格（",,,"）。
    const rowEnds = body.match(/,,,\n/g) ?? [];
    expect(rowEnds.length).toBe(result.rowCount);
    expectMatchesGolden("audit-export-v2-calls-prefix", {
      headers: EXPORT_V2_HEADERS.slice(0, -APPENDED_TAIL.length),
      csv: result.csv.slice(0, headerEnd - headerTail.length) + "\n" + body.replace(/,,,\n/g, "\n")
    });
    db.close();
  });
});

describe("spans.csv format is frozen (audit-export-v2-spans)", () => {
  it("header and rendered rows for fixed spans equal the golden", async () => {
    const { SPANS_CSV_HEADERS, renderSpansCsv } = await import("../../admin/audit-trace-export");
    const { db, ids } = await seedDb();
    const ins = db.prepare(`INSERT INTO access_trace_span
      (span_id, trace_id, access_log_id, parent_span_id, seq, stage, started_at_ms, duration_ms, status, reason_code, reason_param, error_category, attrs_json, derivation_version)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'v2p5-2')`);
    const base = Date.UTC(2026, 10, 10, 8, 0, 0);
    for (const [n, id] of ids.slice(0, 2).entries()) {
      const trace = `t_fixed_${n}`;
      ins.run(`${trace}_root`, trace, id, null, 1, "admission", base + n * 1000, 12 + n, "ok", null, null, null, null);
      ins.run(`${trace}_acl`, trace, id, `${trace}_root`, 2, "acl", base + n * 1000 + 1, 3, "ok", null, null, null, JSON.stringify({ note: "a,b", q: 'say "hi"' }));
    }
    const out = await renderSpansCsv(db, ids, "UTC");
    expectMatchesGolden("audit-export-v2-spans", { headers: [...SPANS_CSV_HEADERS], csv: out.csv, rowCount: out.rowCount, unsequenced: out.unsequenced });
    db.close();
  });
});
