/**
 * Spec 149 §8 / WO T1 — 运维问数连接的审计库视图。
 *
 * 覆盖：SC-02、SC-03、SC-04、SC-06、SC-12、SC-13、SC-22。
 *
 * 夹具时间戳写死为 UTC；视图是 SQLite 对象，插入在视图之后发生也照样可见。
 */

import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let auditDbPath: string | undefined;
let previousAuditDb: string | undefined;

const T = (day: string, time: string) => `2026-10-${day}T${time}:00.000Z`;

type Row = { event_id: number };

async function openAudit() {
  vi.resetModules();
  const audit = await import("../proxy/audit");
  return audit;
}

async function seedRows(db: Database.Database): Promise<void> {
  const insert = db.prepare(
    `INSERT INTO access_log
       (ts, user_id, token_label, tool, tables, args_summary, outcome, error_detail,
        duration_ms, request_id, decision_reason, generated_sql, eval_mark)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertSource = db.prepare(
    `INSERT INTO access_log_sources
       (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
        physical_table, extraction_method, confidence, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );

  // E1 — 被拒绝的订单表调用（SC-02）。
  const e1 = insert.run(
    T("20", "08:00"), "agent_a", "desktop", "lucy_query", '["superstore_orders"]',
    '{"connection":"demo-mysql"}', "denied", "no grant", 120, "req-e1",
    "row_policy_denied", "SELECT * FROM superstore_orders", null
  ).lastInsertRowid as number;
  insertSource.run(e1, T("20", "08:00"), "agent_a", "lucy_query", "demo-mysql", "dataforai",
    "superstore_orders", "dataforai.superstore_orders", "explicit", "high", T("20", "08:00"));

  // E2 — 另一个 Agent 在退货表上的错误调用（SC-03）。
  const e2 = insert.run(
    T("21", "09:00"), "agent_b", "laptop", "lucy_query", '["superstore_returns"]',
    '{"connection":"demo-mysql"}', "error", "timeout", 900, "req-e2",
    "upstream_error", "SELECT * FROM superstore_returns", null
  ).lastInsertRowid as number;
  insertSource.run(e2, T("21", "09:00"), "agent_b", "lucy_query", "demo-mysql", "dataforai",
    "superstore_returns", "dataforai.superstore_returns", "explicit", "high", T("21", "09:00"));

  // E3 — 自身追问且混合了其它表来源（SC-04：两张视图都不许留下残余行）。
  const e3 = insert.run(
    T("22", "10:00"), "agent_c", "desktop", "lucy_query", '["ops_calls"]',
    '{"connection":"lucy-ops"}', "ok", null, 50, "req-e3", null,
    "SELECT * FROM ops_calls", null
  ).lastInsertRowid as number;
  insertSource.run(e3, T("22", "10:00"), "agent_c", "lucy_query", "lucy-ops", "main",
    "ops_calls", "ops_calls", "explicit", "high", T("22", "10:00"));
  insertSource.run(e3, T("22", "10:00"), "agent_c", "lucy_query", "demo-mysql", "dataforai",
    "superstore_orders", "dataforai.superstore_orders", "explicit", "high", T("22", "10:00"));

  // E4 — 协议调用（SC-12）。
  const e4 = insert.run(
    T("22", "10:05"), "agent_c", null, "tools/list", null, null, "ok", null, 10,
    "req-e4", null, null, null
  ).lastInsertRowid as number;
  insertSource.run(e4, T("22", "10:05"), "agent_c", "tools/list", null, null, null,
    "ops_calls", "explicit", "low", T("22", "10:05"));

  // E5 — 无 eval_mark 的正常订单调用（SC-13：必须留在视图里）。
  const e5 = insert.run(
    T("23", "11:00"), "agent_d", "desktop", "lucy_query", '["superstore_orders"]',
    '{"connection":"demo-mysql"}', "ok", null, 200, "req-e5", null,
    "SELECT * FROM superstore_orders", null
  ).lastInsertRowid as number;
  insertSource.run(e5, T("23", "11:00"), "agent_d", "lucy_query", "demo-mysql", "dataforai",
    "superstore_orders", "dataforai.superstore_orders", "explicit", "high", T("23", "11:00"));

  // E6 — 其它连接上的同名物理表，connection_id 非空（SC-22：必须保留）。
  const e6 = insert.run(
    T("24", "12:00"), "agent_e", "opslabel", "lucy_query", '["ops_calls"]',
    '{"connection":"other-sqlite"}', "ok", null, 30, "req-e6", null,
    "SELECT * FROM ops_calls", null
  ).lastInsertRowid as number;
  insertSource.run(e6, T("24", "12:00"), "agent_e", "lucy_query", "other-sqlite", "main",
    "ops_calls", "ops_calls", "explicit", "high", T("24", "12:00"));

  // E7 — 带 eval_mark 且参数含探针名的调用（SC-12：排除）。
  const e7 = insert.run(
    T("25", "13:00"), "agent_f", "probe", "lucy_query", '["superstore_orders"]',
    '{"connection":"demo-mysql"}', "ok", null, 10, "req-e7", null, "SELECT 1", 1
  ).lastInsertRowid as number;
  insertSource.run(e7, T("25", "13:00"), "agent_f", "lucy_query", "demo-mysql", "dataforai",
    "superstore_orders", "dataforai.superstore_orders", "explicit", "high", T("25", "13:00"));
}

beforeEach(async () => {
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  auditDbPath = path.join(
    await mkdtemp(path.join(os.tmpdir(), "lucy-ops-evidence-views-")),
    "audit.sqlite"
  );
  process.env.LUCY_AUDIT_DB = auditDbPath;
});

afterEach(async () => {
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  const audit = await import("../proxy/audit");
  audit.closeAuditDb();
  if (auditDbPath) {
    await rm(path.dirname(auditDbPath), { recursive: true, force: true });
    auditDbPath = undefined;
  }
});

describe("Spec 149 §8 — 运维问数连接的审计库视图", () => {
  it("SC-06: 两张视图的 SELECT 列表不含禁止列，且基表仍在", async () => {
    const audit = await openAudit();
    await audit.recreateOpsEvidenceViews();

    const db = new Database(auditDbPath!, { readonly: true });
    try {
      for (const view of ["ops_calls", "ops_call_tables"]) {
        const columns = (db.prepare(`PRAGMA table_info(${view})`).all() as Array<{ name: string }>)
          .map((column) => column.name.toLowerCase());
        expect(columns.length).toBeGreaterThan(0);
        for (const forbidden of audit.OPS_EVIDENCE_FORBIDDEN_SELECT_COLUMNS) {
          expect(columns).not.toContain(forbidden.toLowerCase());
        }
      }
      for (const baseTable of ["access_log", "access_log_sources"]) {
        const row = db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
          .get(baseTable);
        expect(row).toBeDefined();
      }
    } finally {
      db.close();
    }
  });

  it("SC-02 / SC-03: 拒绝行与错误行按表可取回 Agent 与生成 SQL", async () => {
    const audit = await openAudit();
    await audit.recreateOpsEvidenceViews();
    const db = new Database(auditDbPath!);
    try {
      await seedRows(db);
      const denied = db
        .prepare(
          `SELECT agent_id, outcome, generated_sql FROM ops_call_tables
            WHERE physical_table = 'dataforai.superstore_orders' AND outcome = 'denied'`
        )
        .all();
      expect(denied).toEqual([
        { agent_id: "agent_a", outcome: "denied", generated_sql: "SELECT * FROM superstore_orders" }
      ]);

      const errored = db
        .prepare(
          `SELECT agent_id, outcome FROM ops_call_tables
            WHERE physical_table = 'dataforai.superstore_returns' AND outcome = 'error'`
        )
        .all();
      expect(errored).toEqual([{ agent_id: "agent_b", outcome: "error" }]);
    } finally {
      db.close();
    }
  });

  it("SC-04: 自身追问的混合来源事件在两张视图里一起消失", async () => {
    const audit = await openAudit();
    await audit.recreateOpsEvidenceViews();
    const db = new Database(auditDbPath!);
    try {
      await seedRows(db);
      const callIds = (db.prepare("SELECT event_id FROM ops_calls").all() as Row[]).map((row) => row.event_id);
      const tableIds = (db.prepare("SELECT event_id FROM ops_call_tables").all() as Row[])
        .map((row) => row.event_id);
      expect(callIds).not.toContain(3);
      expect(tableIds).not.toContain(3);
      // 两张视图覆盖同一个事件集合。
      expect([...callIds].sort((a, b) => a - b)).toEqual([...tableIds].sort((a, b) => a - b));
    } finally {
      db.close();
    }
  });

  it("SC-12 / SC-13: 协议调用与评测探针排除，未标记的订单行保留", async () => {
    const audit = await openAudit();
    await audit.recreateOpsEvidenceViews();
    const db = new Database(auditDbPath!);
    try {
      await seedRows(db);
      const callIds = (db.prepare("SELECT event_id FROM ops_calls").all() as Row[]).map((row) => row.event_id);
      expect(callIds).not.toContain(4); // 协议调用
      expect(callIds).not.toContain(7); // 评测探针
      expect(callIds).toContain(5); // 未标记的订单行
    } finally {
      db.close();
    }
  });

  it("SC-22: 其它连接上的同名物理表保留；空 connection_id 且命中物理名时排除", async () => {
    const audit = await openAudit();
    await audit.recreateOpsEvidenceViews();
    const db = new Database(auditDbPath!);
    try {
      await seedRows(db);
      const rows = db
        .prepare("SELECT event_id, connection_id FROM ops_call_tables ORDER BY event_id")
        .all() as Array<{ event_id: number; connection_id: string | null }>;
      const e6 = rows.find((row) => row.event_id === 6);
      expect(e6).toBeDefined();
      expect(e6?.connection_id).toBe("other-sqlite");

      // 归属缺失 + 物理名命中 → 按自身追问排除。
      const orphan = db
        .prepare(
          `INSERT INTO access_log
             (ts, user_id, tool, outcome, duration_ms, request_id, generated_sql)
           VALUES (?,?,?,?,?,?,?)`
        )
        .run(T("26", "14:00"), "agent_g", "lucy_query", "ok", 11, "req-e8", "SELECT 1")
        .lastInsertRowid as number;
      db.prepare(
        `INSERT INTO access_log_sources
           (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name,
            physical_table, extraction_method, confidence, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).run(orphan, T("26", "14:00"), "agent_g", "lucy_query", null, null, null,
        "ops_calls", "explicit", "low", T("26", "14:00"));

      const after = (db.prepare("SELECT event_id FROM ops_calls").all() as Row[]).map((row) => row.event_id);
      expect(after).not.toContain(orphan);
    } finally {
      db.close();
    }
  });
});
