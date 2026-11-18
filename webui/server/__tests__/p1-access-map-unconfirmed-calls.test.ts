/**
 * Spec lucy-20261117-access-map-sankey-restoration — Track A3（SC-A5）。
 * `meta.access.unconfirmedCalls`：窗口内带表来源、但关联未确认的去重调用数（只读披露）。
 */
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  type AccessMapGrantSide,
  type AccessMapProvider
} from "../admin/access-map.js";

function grantSide(): AccessMapGrantSide {
  return {
    state: "ok",
    problem: null,
    failures: [],
    identity: {
      configVersion: "cfg-1",
      policyVersion: "pol-1",
      sourceMapVersion: "smap-1",
      capabilityDigest: "cap-1"
    },
    agents: [
      {
        id: "agent_a",
        name: "A",
        enabled: true,
        roleIds: ["role_reader"],
        tokens: [{ label: "tok", status: "active", callCount: 0 }]
      }
    ],
    contributions: [
      {
        agentId: "agent_a",
        roleId: "role_reader",
        sources: [
          { connectionId: "mysql_main", schema: "finance", sourceName: "orders", physicalTable: "finance.orders" }
        ]
      }
    ],
    orphanGrants: 0,
    enabledConnections: ["mysql_main"]
  };
}

function openDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, user_id TEXT NOT NULL,
      matched_role_id TEXT, role_ids TEXT, token_label TEXT,
      tool TEXT NOT NULL DEFAULT 'lucy_query', lucy_turn_id TEXT, eval_mark INTEGER,
      args_summary TEXT, outcome TEXT NOT NULL, permission_snapshot_hash TEXT,
      capability_digest TEXT, association_status TEXT
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT, access_log_id INTEGER NOT NULL,
      connection_id TEXT, schema_name TEXT, source_name TEXT
    );
    CREATE TABLE conversation_turns (turn_id TEXT PRIMARY KEY, question_source TEXT, question_summary TEXT);
    CREATE TABLE inferred_turns (inferred_turn_id TEXT PRIMARY KEY, question_summary TEXT);
    CREATE TABLE inferred_turn_access_logs (
      inferred_turn_id TEXT NOT NULL, access_log_id INTEGER NOT NULL,
      PRIMARY KEY(inferred_turn_id, access_log_id)
    );
  `);
  db.prepare(
    `INSERT INTO conversation_turns (turn_id, question_source, question_summary)
     VALUES ('t1','user','q'),('t2','user','q'),('t3','user','q'),('t4','user','q'),('t5','user','q')`
  ).run();
  return db;
}

function seed(db: Database.Database, rows: Array<[string, string, string]>): void {
  const ts = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const insertLog = db.prepare(
    `INSERT INTO access_log (ts, user_id, matched_role_id, tool, outcome, association_status, lucy_turn_id)
     VALUES (?, 'agent_a', 'role_reader', 'lucy_query', ?, ?, ?)`
  );
  const insertSource = db.prepare(
    `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
     VALUES (?, 'mysql_main', 'finance', 'orders')`
  );
  rows.forEach(([outcome, association, turn], index) => {
    insertLog.run(ts, outcome, association === "NULL" ? null : association, turn);
    insertSource.run(index + 1);
  });
}

async function run(db: Database.Database, inquiryKind: "all" | "management" = "all") {
  const real = createAdminAccessMapProvider({
    openAuditDb: async () => db,
    ensureInquiryRebuild: async () => undefined
  });
  const hybrid: AccessMapProvider = {
    loadGrantSide: async () => grantSide(),
    loadAccessSide: (input) => real.loadAccessSide(input)
  };
  return buildAccessMap(hybrid, {
    agent: null,
    role: null,
    token: null,
    table: null,
    connection: null,
    window: "720h",
    layer: "flat",
    trust: "confirmed",
    inquiryKind,
    accessGrade: "all",
    view: "map",
    focus: null,
    detailLimit: 50,
    detailOffset: 0
  });
}

describe("access-map · unconfirmedCalls（SC-A5）", () => {
  it("candidate 与 NULL 关联的调用都计入；已确认不计；信任口径仍为 confirmed", async () => {
    const db = openDb();
    seed(db, [
      ["allow", "confirmed", "t1"],
      ["allow", "candidate", "t2"],
      ["deny", "candidate", "t3"],
      ["allow", "NULL", "t4"]
    ]);
    const response = await run(db);
    expect(response.meta.access.trust).toBe("confirmed");
    expect(response.meta.access.rawCalls).toBe(1);
    expect(response.meta.access.unconfirmedCalls).toBe(3);
    db.close();
  });

  it("全为未确认关联时访问面为空，但 unconfirmedCalls 如实披露", async () => {
    const db = openDb();
    seed(db, [
      ["allow", "candidate", "t1"],
      ["allow", "candidate", "t2"],
      ["allow", "NULL", "t3"]
    ]);
    const response = await run(db);
    expect(response.meta.echo?.enteringAllowCallCount).toBe(0);
    expect(response.meta.counts.accessPaths).toBe(0);
    expect(response.meta.access.unconfirmedCalls).toBe(3);
    db.close();
  });

  it("没有任何未确认调用时为 0", async () => {
    const db = openDb();
    seed(db, [["allow", "confirmed", "t1"]]);
    const response = await run(db);
    expect(response.meta.access.unconfirmedCalls).toBe(0);
    db.close();
  });

  it("同一调用对应多个来源表时只计 1 次", async () => {
    const db = openDb();
    seed(db, [["allow", "candidate", "t1"]]);
    db.prepare(
      `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
       VALUES (1, 'mysql_main', 'finance', 'returns')`
    ).run();
    const response = await run(db);
    expect(response.meta.access.unconfirmedCalls).toBe(1);
    db.close();
  });

  it("沿用问询种类筛选：无问询关联的未确认调用在默认「管理相关」下不计", async () => {
    const db = openDb();
    seed(db, [["allow", "candidate", "no-such-turn"]]);
    const response = await run(db, "management");
    expect(response.meta.access.unconfirmedCalls).toBe(0);
    db.close();
  });
});
