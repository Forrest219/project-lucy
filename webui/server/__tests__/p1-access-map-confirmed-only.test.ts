/**
 * Spec lucy-20261105-access-map-confirmed-only — S1 SC-06–SC-12.
 */
import Database from "better-sqlite3";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import {
  buildAccessMap,
  createAdminAccessMapProvider,
  parseAccessMapQuery,
  type AccessMapAccessSide,
  type AccessMapGrantSide,
  type AccessMapProvider
} from "../admin/access-map.js";
import { registerAccessMapRoutes } from "../admin/routes/access-map.js";

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
          {
            connectionId: "mysql_main",
            schema: "finance",
            sourceName: "orders",
            physicalTable: "finance.orders"
          },
          {
            connectionId: "mysql_main",
            schema: "finance",
            sourceName: "returns",
            physicalTable: "finance.returns"
          }
        ]
      }
    ],
    orphanGrants: 0,
    enabledConnections: ["mysql_main"]
  };
}

function emptyAccess(): AccessMapAccessSide {
  return {
    state: "ok",
    rows: [],
    deniedCalls: 0,
    tokenCallCounts: new Map(),
    tokenLastUsed: new Map(),
    loadSnapshot: () => null
  };
}

describe("confirmed-only · parse／HTTP（SC-06–SC-10）", () => {
  it("SC-06 — 无 trust 键 → confirmed", () => {
    const parsed = parseAccessMapQuery(new URLSearchParams("window=24h"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.query.trust).toBe("confirmed");
  });

  it("SC-07 — trust=confirmed 与前后空白 → ok", () => {
    expect(parseAccessMapQuery(new URLSearchParams("trust=confirmed")).ok).toBe(true);
    const padded = parseAccessMapQuery(new URLSearchParams("trust=%20confirmed%20"));
    expect(padded.ok).toBe(true);
    if (!padded.ok) return;
    expect(padded.query.trust).toBe("confirmed");
  });

  it("SC-08／SC-09 — include_candidate／空串／空白／大小写／别名 → 400", () => {
    const vectors = [
      "trust=include_candidate",
      "trust=",
      "trust=%20",
      "trust=Confirmed",
      "trust=INCLUDE_CANDIDATE",
      "trust=confirmed_only"
    ];
    for (const search of vectors) {
      const parsed = parseAccessMapQuery(new URLSearchParams(search));
      expect(parsed.ok, search).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.error.param).toBe("trust");
      expect(parsed.error.message).toContain("关联口径只接受已确认关联");
    }
  });

  it("SC-10 — 重复键：混非法 → 400；双 confirmed → ok", () => {
    expect(
      parseAccessMapQuery(new URLSearchParams("trust=confirmed&trust=include_candidate")).ok
    ).toBe(false);
    expect(
      parseAccessMapQuery(new URLSearchParams("trust=include_candidate&trust=confirmed")).ok
    ).toBe(false);
    expect(parseAccessMapQuery(new URLSearchParams("trust=confirmed&trust=confirmed")).ok).toBe(
      true
    );
  });

  it("SC-08 HTTP — include_candidate → 400；不调用 provider", async () => {
    const loadGrantSide = vi.fn(async () => grantSide());
    const loadAccessSide = vi.fn(async () => emptyAccess());
    const app = Fastify();
    registerAccessMapRoutes(app, { loadGrantSide, loadAccessSide });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/access-map?trust=include_candidate"
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().data.param).toBe("trust");
    expect(res.json().error.message).toContain("关联口径只接受已确认关联");
    expect(loadGrantSide).not.toHaveBeenCalled();
    expect(loadAccessSide).not.toHaveBeenCalled();
    await app.close();
  });

  it("SC-09 HTTP — trust= 空串 → 400", async () => {
    const app = Fastify();
    registerAccessMapRoutes(app, {
      loadGrantSide: async () => grantSide(),
      loadAccessSide: async () => emptyAccess()
    });
    const res = await app.inject({ method: "GET", url: "/api/admin/access-map?trust=" });
    expect(res.statusCode).toBe(400);
    expect(res.json().data.param).toBe("trust");
    await app.close();
  });

  it("SC-06／SC-07 HTTP — 无 trust 与 %20confirmed%20 → 200", async () => {
    const app = Fastify();
    registerAccessMapRoutes(app, {
      loadGrantSide: async () => grantSide(),
      loadAccessSide: async () => emptyAccess()
    });
    const absent = await app.inject({ method: "GET", url: "/api/admin/access-map?window=24h" });
    expect(absent.statusCode).toBe(200);
    expect(absent.json().data.meta.access.trust).toBe("confirmed");
    const padded = await app.inject({
      method: "GET",
      url: "/api/admin/access-map?trust=%20confirmed%20&window=24h"
    });
    expect(padded.statusCode).toBe(200);
    expect(padded.json().data.meta.access.trust).toBe("confirmed");
    await app.close();
  });
});

describe("confirmed-only · B／E／D／detail（SC-11／SC-12）", () => {
  it("SC-11 — 候选不进 E／D／detail；已确认两侧进入", async () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        matched_role_id TEXT,
        role_ids TEXT,
        token_label TEXT,
        tool TEXT NOT NULL DEFAULT 'lucy_query',
        lucy_turn_id TEXT,
        eval_mark INTEGER,
        args_summary TEXT,
        outcome TEXT NOT NULL,
        permission_snapshot_hash TEXT,
        capability_digest TEXT,
        association_status TEXT
      );
      CREATE TABLE access_log_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        access_log_id INTEGER NOT NULL,
        connection_id TEXT,
        schema_name TEXT,
        source_name TEXT
      );
      CREATE TABLE conversation_turns (
        turn_id TEXT PRIMARY KEY,
        question_source TEXT,
        question_summary TEXT
      );
      CREATE TABLE inferred_turns (
        inferred_turn_id TEXT PRIMARY KEY,
        question_summary TEXT
      );
      CREATE TABLE inferred_turn_access_logs (
        inferred_turn_id TEXT NOT NULL,
        access_log_id INTEGER NOT NULL,
        PRIMARY KEY(inferred_turn_id, access_log_id)
      );
    `);
    const ts = "2026-10-19T00:15:00.000Z";
    const insertLog = db.prepare(
      `INSERT INTO access_log (ts, user_id, matched_role_id, role_ids, token_label, tool, outcome,
        permission_snapshot_hash, capability_digest, association_status, lucy_turn_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertSource = db.prepare(
      `INSERT INTO access_log_sources (access_log_id, connection_id, schema_name, source_name)
       VALUES (?, ?, ?, ?)`
    );
    db.prepare(
      `INSERT INTO conversation_turns (turn_id, question_source, question_summary)
       VALUES ('t1', 'user', 'q'), ('t2', 'user', 'q'), ('t3', 'user', 'q'), ('t4', 'user', 'q')`
    ).run();

    insertLog.run(ts, "agent_a", "role_reader", null, "tok", "lucy_query", "allow", null, null, "confirmed", "t1");
    insertSource.run(1, "mysql_main", "finance", "orders");
    insertLog.run(ts, "agent_a", "role_reader", null, "tok", "lucy_query", "deny", null, null, "confirmed", "t2");
    insertSource.run(2, "mysql_main", "finance", "returns");
    insertLog.run(ts, "agent_a", "role_reader", null, "tok", "lucy_query", "allow", null, null, "candidate", "t3");
    insertSource.run(3, "mysql_main", "finance", "orders");
    insertLog.run(ts, "agent_a", "role_reader", null, "tok", "lucy_query", "deny", null, null, "candidate", "t4");
    insertSource.run(4, "mysql_main", "finance", "returns");

    const real = createAdminAccessMapProvider({
      openAuditDb: async () => db,
      ensureInquiryRebuild: async () => undefined
    });
    const hybrid: AccessMapProvider = {
      loadGrantSide: async () => grantSide(),
      loadAccessSide: (input) => real.loadAccessSide(input)
    };

    const response = await buildAccessMap(hybrid, {
      agent: null,
      role: null,
      token: null,
      table: null,
      connection: null,
      window: "720h",
      layer: "flat",
      trust: "confirmed",
      inquiryKind: "all",
      accessGrade: "all",
      view: "table",
      focus: null,
      detailLimit: 200,
      detailOffset: 0
    });

    expect(response.meta.access.trust).toBe("confirmed");
    expect(response.meta.echo?.enteringAllowCallCount).toBe(1);
    expect(response.meta.access.deniedCalls).toBe(1);
    expect(response.detail).toBeTruthy();
    expect((response.detail?.rows.length ?? 0) > 0).toBe(true);

    const allowSum = response.detail!.rows.reduce((n, r) => n + r.allowCalls, 0);
    const denySum = response.detail!.rows.reduce((n, r) => n + r.denyCalls, 0);
    expect(allowSum).toBe(1);
    expect(denySum).toBe(1);
    expect(allowSum + denySum).toBe(2);

    expect(response.nodes.length).toBeGreaterThan(0);
    db.close();
  });
});
