/**
 * T03b audit-trust 集成测试：
 * - AssociationRevision 行写入 + 拒绝规则
 * - listAssociationRevisions 过滤 + 排序
 * - effectiveAssociationFor 双视图
 * - revisionContentHash 确定性
 * - actor_kind 强制为 {person, automation, system}（防止 body.actor 冒充，EA-11）
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  appendAssociationRevision,
  effectiveAssociationFor,
  listAssociationRevisions,
  revisionContentHash
} from "../../proxy/association-revision";

function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      ts_date TEXT,
      token_hash_prefix TEXT,
      lucy_turn_id TEXT,
      association_status TEXT,
      turn_attribution_mode TEXT
    );
    CREATE TABLE association_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      original_turn_id TEXT NOT NULL,
      effective_turn_id TEXT,
      original_association_status TEXT,
      effective_association_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      reference_doc TEXT,
      attribution_rule_version TEXT NOT NULL,
      actor_kind TEXT NOT NULL,
      actor_id TEXT,
      instance_id TEXT,
      instance_start_generation INTEGER,
      ts TEXT NOT NULL,
      classification_version TEXT NOT NULL,
      expected_revision TEXT,
      UNIQUE(original_turn_id, attribution_rule_version)
    );
  `);
  return db;
}

function seedAccessLog(db: Database.Database, opts: { turnId: string; status: string | null }): number {
  const info = db
    .prepare(
      `INSERT INTO access_log (ts, user_id, tool, ts_date, token_hash_prefix, lucy_turn_id, association_status, turn_attribution_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      "2026-10-19T12:00:00Z",
      "u",
      "t",
      "2026-10-19",
      "h",
      opts.turnId,
      opts.status,
      "explicit"
    );
  return Number(info.lastInsertRowid);
}

describe("T03b appendAssociationRevision", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db?.close());

  it("inserts and returns a serialized row", () => {
    const row = appendAssociationRevision(db, {
      originalTurnId: "turn-1",
      effectiveTurnId: "turn-1",
      originalAssociationStatus: "session_bound",
      effectiveAssociationStatus: "confirmed",
      reason: "explicit turn validated",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: "admin-1",
      instanceId: null,
      instanceStartGeneration: null
    });
    expect(row.id).toBeGreaterThan(0);
    expect(row.originalTurnId).toBe("turn-1");
    expect(row.effectiveAssociationStatus).toBe("confirmed");
    expect(row.actorKind).toBe("person");
    const stored = db.prepare(`SELECT * FROM association_revisions WHERE id = ?`).get(row.id) as { ts: string };
    expect(typeof stored.ts).toBe("string");
  });

  it("rejects duplicate (original_turn_id, attribution_rule_version) — UNIQUE constraint", () => {
    appendAssociationRevision(db, {
      originalTurnId: "turn-2",
      effectiveAssociationStatus: "confirmed",
      reason: "audit",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: "a",
      instanceId: null,
      instanceStartGeneration: null
    });
    expect(() =>
      appendAssociationRevision(db, {
        originalTurnId: "turn-2",
        effectiveAssociationStatus: "conflict",
        reason: "audit",
        attributionRuleVersion: "v1",
        classificationVersion: "audit-trust-2026-10-19-r1.v1",
        actorKind: "person",
        actorId: "a",
        instanceId: null,
        instanceStartGeneration: null
      })
    ).toThrow(/UNIQUE/);
  });

  it("rejects unknown actor_kind (preventing body.actor impersonation, EA-11)", () => {
    expect(() =>
      appendAssociationRevision(db, {
        originalTurnId: "turn-3",
        effectiveAssociationStatus: "confirmed",
        reason: "audit",
        attributionRuleVersion: "v1",
        classificationVersion: "audit-trust-2026-10-19-r1.v1",
        actorKind: "anonymous_attacker",
        actorId: "x",
        instanceId: null,
        instanceStartGeneration: null
      })
    ).toThrow(/actorKind/);
  });

  it("rejects empty required fields", () => {
    expect(() =>
      appendAssociationRevision(db, {
        originalTurnId: "",
        effectiveAssociationStatus: "confirmed",
        reason: "audit",
        attributionRuleVersion: "v1",
        classificationVersion: "audit-trust-2026-10-19-r1.v1",
        actorKind: "person",
        actorId: null,
        instanceId: null,
        instanceStartGeneration: null
      })
    ).toThrow(/originalTurnId/);
    expect(() =>
      appendAssociationRevision(db, {
        originalTurnId: "turn-x",
        effectiveAssociationStatus: "",
        reason: "audit",
        attributionRuleVersion: "v1",
        classificationVersion: "audit-trust-2026-10-19-r1.v1",
        actorKind: "person",
        actorId: null,
        instanceId: null,
        instanceStartGeneration: null
      })
    ).toThrow(/effectiveAssociationStatus/);
  });

  it("allows person / automation / system actor_kinds", () => {
    for (const kind of ["person", "automation", "system"]) {
      const row = appendAssociationRevision(db, {
        originalTurnId: `turn-${kind}`,
        effectiveAssociationStatus: "confirmed",
        reason: "audit",
        attributionRuleVersion: "v1",
        classificationVersion: "audit-trust-2026-10-19-r1.v1",
        actorKind: kind,
        actorId: kind === "person" ? "admin" : null,
        instanceId: null,
        instanceStartGeneration: null
      });
      expect(row.actorKind).toBe(kind);
    }
  });
});

describe("T03b listAssociationRevisions", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db?.close());

  it("returns rows sorted by ts DESC then id DESC", async () => {
    appendAssociationRevision(db, {
      originalTurnId: "turn-1",
      effectiveAssociationStatus: "confirmed",
      reason: "r1",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: "a",
      instanceId: null,
      instanceStartGeneration: null
    });
    // Force a small gap so ts differs.
    await new Promise((resolve) => setTimeout(resolve, 5));
    appendAssociationRevision(db, {
      originalTurnId: "turn-1",
      effectiveAssociationStatus: "conflict",
      reason: "r2",
      attributionRuleVersion: "v2",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: "a",
      instanceId: null,
      instanceStartGeneration: null
    });
    const rows = listAssociationRevisions(db, { originalTurnId: "turn-1" });
    expect(rows).toHaveLength(2);
    expect(rows[0].attributionRuleVersion).toBe("v2");
    expect(rows[1].attributionRuleVersion).toBe("v1");
  });

  it("filters by originalTurnId", () => {
    appendAssociationRevision(db, {
      originalTurnId: "turn-A",
      effectiveAssociationStatus: "confirmed",
      reason: "a",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: null,
      instanceId: null,
      instanceStartGeneration: null
    });
    appendAssociationRevision(db, {
      originalTurnId: "turn-B",
      effectiveAssociationStatus: "conflict",
      reason: "b",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: null,
      instanceId: null,
      instanceStartGeneration: null
    });
    const rowsA = listAssociationRevisions(db, { originalTurnId: "turn-A" });
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].originalTurnId).toBe("turn-A");
  });
});

describe("T03b effectiveAssociationFor", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
  });

  afterEach(() => db?.close());

  it("returns the original view when no revisions exist", () => {
    const id = seedAccessLog(db, { turnId: "turn-X", status: "session_bound" });
    const view = effectiveAssociationFor(db, id);
    expect(view?.originalAssociationStatus).toBe("session_bound");
    expect(view?.effectiveAssociationStatus).toBe("session_bound");
    expect(view?.revisionCount).toBe(0);
  });

  it("applies the latest revision to compute the effective view", () => {
    const id = seedAccessLog(db, { turnId: "turn-Y", status: "session_bound" });
    appendAssociationRevision(db, {
      originalTurnId: "turn-Y",
      effectiveTurnId: "turn-Y",
      originalAssociationStatus: "session_bound",
      effectiveAssociationStatus: "confirmed",
      reason: "explicit turn validated",
      attributionRuleVersion: "v1",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      actorKind: "person",
      actorId: "admin",
      instanceId: null,
      instanceStartGeneration: null
    });
    const view = effectiveAssociationFor(db, id);
    expect(view?.originalAssociationStatus).toBe("session_bound");
    expect(view?.effectiveAssociationStatus).toBe("confirmed");
    expect(view?.effectiveReason).toBe("explicit turn validated");
    expect(view?.effectiveRuleVersion).toBe("v1");
    expect(view?.revisionCount).toBe(1);
  });

  it("returns null for an unknown access_log id", () => {
    const view = effectiveAssociationFor(db, 99999);
    expect(view).toBeNull();
  });

  it("returns originalAssociationStatus from stored row when turn_id is null", () => {
    const info = db
      .prepare(
        `INSERT INTO access_log (ts, user_id, tool, ts_date, token_hash_prefix, lucy_turn_id, association_status)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run("2026-10-19T12:00:00Z", "u", "t", "2026-10-19", "h", null, "unassigned");
    const id = Number(info.lastInsertRowid);
    const view = effectiveAssociationFor(db, id);
    expect(view?.originalTurnId).toBeNull();
    expect(view?.originalAssociationStatus).toBe("unassigned");
  });
});

describe("T03b revisionContentHash (EA-13 determinism)", () => {
  it("is deterministic for the same payload", () => {
    const row = {
      id: 1,
      originalTurnId: "turn-1",
      effectiveTurnId: null,
      originalAssociationStatus: null,
      effectiveAssociationStatus: "confirmed",
      reason: "audit",
      referenceDoc: null,
      attributionRuleVersion: "v1",
      actorKind: "person",
      actorId: null,
      instanceId: null,
      instanceStartGeneration: null,
      ts: "2026-10-19T12:00:00Z",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      expectedRevision: null
    };
    const h1 = revisionContentHash(row);
    const h2 = revisionContentHash({ ...row });
    expect(h1).toBe(h2);
  });

  it("differs when the effective status changes", () => {
    const base = {
      id: 1,
      originalTurnId: "turn-1",
      effectiveTurnId: null,
      originalAssociationStatus: null,
      effectiveAssociationStatus: "confirmed",
      reason: "audit",
      referenceDoc: null,
      attributionRuleVersion: "v1",
      actorKind: "person",
      actorId: null,
      instanceId: null,
      instanceStartGeneration: null,
      ts: "2026-10-19T12:00:00Z",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      expectedRevision: null
    };
    const before = revisionContentHash(base);
    const after = revisionContentHash({ ...base, effectiveAssociationStatus: "conflict" });
    expect(before).not.toBe(after);
  });

  it("is invariant under ts / actor_id / id changes (input-side determinism)", () => {
    const a = {
      id: 1,
      originalTurnId: "turn-1",
      effectiveTurnId: null,
      originalAssociationStatus: null,
      effectiveAssociationStatus: "confirmed",
      reason: "audit",
      referenceDoc: null,
      attributionRuleVersion: "v1",
      actorKind: "person",
      actorId: "admin-A",
      instanceId: null,
      instanceStartGeneration: null,
      ts: "2026-10-19T12:00:00Z",
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      expectedRevision: null
    };
    const b = { ...a, id: 999, actorId: "admin-B", ts: "2026-10-19T13:00:00Z" };
    expect(revisionContentHash(a)).toBe(revisionContentHash(b));
  });
});