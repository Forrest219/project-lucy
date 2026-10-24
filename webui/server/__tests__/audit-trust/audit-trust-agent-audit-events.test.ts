/**
 * T06a audit-trust 集成测试：受控客户端 observation 接收端
 * - 凭证解析 (resolveAdapterFromToken)
 * - schema 校验 (validateAgentAuditBody)
 * - 幂等表 + 持久化 (appendClientObservations): 接受 / 幂等回放 / id_conflict
 * - 父事件跨主体不可枚举 -> parent_not_visible
 * - heartbeat 双时间戳保留
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  appendClientObservations,
  ensureAgentAuditSchema,
  resolveAdapterFromToken,
  validateAgentAuditBody,
  type AgentAuditEventInput
} from "../../admin/agent-audit-events";

const CLASSIFICATION_VERSION = "audit-trust-2026-10-19-r1.v1";

function makeSecDb(): Database.Database {
  const db = new Database(":memory:");
  // Mimic the security_events schema (subset) for ledgerAppender.
  db.exec(`
    CREATE TABLE security_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      operation_id TEXT NOT NULL,
      phase TEXT NOT NULL,
      actor TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      audit_event_kind TEXT,
      object_hash TEXT NOT NULL DEFAULT "",
      verdict TEXT NOT NULL DEFAULT "",
      result_summary TEXT NOT NULL DEFAULT "",
      created_at INTEGER NOT NULL
    );
  `);
  ensureAgentAuditSchema(db);
  return db;
}

const baseAdapter = {
  adapter_id: "adapter-1",
  instance_id: "lucy-instance-1",
  visibleParentIds: new Set<string>()
};

function fakeLedgerAppender(db: Database.Database) {
  let counter = 0;
  return (input: {
    eventId: string;
    operationId: string;
    phase: string;
    actor: string;
    actorType: string;
    auditEventKind: string;
    objectHash: string;
    resultSummary: string;
    eventType: string;
    observedAt: string;
    serverReceivedAt: number;
    subKind: string;
  }) => {
    counter += 1;
    db.prepare(
      `INSERT INTO security_events (event_id, operation_id, phase, actor, actor_type, audit_event_kind, object_hash, result_summary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.eventId,
      input.operationId,
      input.phase,
      input.actor,
      input.actorType,
      input.auditEventKind,
      input.objectHash,
      input.resultSummary,
      input.serverReceivedAt
    );
    return { seq: counter, eventId: input.eventId };
  };
}

const sampleEvents: AgentAuditEventInput[] = [
  {
    client_event_id: "client-evt-1",
    observed_at: "2026-10-19T12:00:00Z",
    event_type: "result_received",
    payload: { result_summary: "ok" }
  },
  {
    client_event_id: "client-evt-2",
    observed_at: "2026-10-19T12:00:05Z",
    event_type: "heartbeat",
    payload: { adapter_id: "adapter-1" }
  }
];

describe("T06a resolveAdapterFromToken", () => {
  const originalToken = process.env.LUCY_AGENT_AUDIT_TOKEN;
  const originalAdapterId = process.env.LUCY_AGENT_AUDIT_ADAPTER_ID;
  const originalInstanceId = process.env.LUCY_AGENT_AUDIT_INSTANCE_ID;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.LUCY_AGENT_AUDIT_TOKEN;
    else process.env.LUCY_AGENT_AUDIT_TOKEN = originalToken;
    if (originalAdapterId === undefined) delete process.env.LUCY_AGENT_AUDIT_ADAPTER_ID;
    else process.env.LUCY_AGENT_AUDIT_ADAPTER_ID = originalAdapterId;
    if (originalInstanceId === undefined) delete process.env.LUCY_AGENT_AUDIT_INSTANCE_ID;
    else process.env.LUCY_AGENT_AUDIT_INSTANCE_ID = originalInstanceId;
  });

  it("returns null when no token provided", () => {
    delete process.env.LUCY_AGENT_AUDIT_TOKEN;
    expect(resolveAdapterFromToken(undefined)).toBeNull();
    expect(resolveAdapterFromToken("")).toBeNull();
  });

  it("returns null when env token is unset", () => {
    delete process.env.LUCY_AGENT_AUDIT_TOKEN;
    expect(resolveAdapterFromToken("some-token")).toBeNull();
  });

  it("returns null when token mismatches", () => {
    process.env.LUCY_AGENT_AUDIT_TOKEN = "expected";
    expect(resolveAdapterFromToken("wrong")).toBeNull();
  });

  it("returns adapter when token matches env", () => {
    process.env.LUCY_AGENT_AUDIT_TOKEN = "expected";
    process.env.LUCY_AGENT_AUDIT_ADAPTER_ID = "ad-hoc";
    process.env.LUCY_AGENT_AUDIT_INSTANCE_ID = "instance-7";
    const a = resolveAdapterFromToken("expected");
    expect(a?.adapter_id).toBe("ad-hoc");
    expect(a?.instance_id).toBe("instance-7");
  });
});

describe("T06a validateAgentAuditBody", () => {
  it("accepts a valid body", () => {
    const errors = validateAgentAuditBody({ events: sampleEvents });
    expect(errors).toEqual([]);
  });

  it("rejects non-array events", () => {
    expect(validateAgentAuditBody({ events: "not-an-array" })).toContain("events must be an array");
  });

  it("rejects empty events array", () => {
    const errors = validateAgentAuditBody({ events: [] });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects events.length > 100", () => {
    const events = Array.from({ length: 101 }, (_, i) => ({
      client_event_id: `e-${i}`,
      observed_at: "2026-10-19T12:00:00Z",
      event_type: "heartbeat",
      payload: {}
    }));
    const errors = validateAgentAuditBody({ events });
    expect(errors.some((e) => e.includes("must be <= 100"))).toBe(true);
  });

  it("rejects invalid event_type", () => {
    const errors = validateAgentAuditBody({
      events: [{ client_event_id: "x", observed_at: "2026-10-19T12:00:00Z", event_type: "made_up", payload: {} }]
    });
    expect(errors.some((e) => e.includes("event_type"))).toBe(true);
  });

  it("rejects invalid observed_at", () => {
    const errors = validateAgentAuditBody({
      events: [{ client_event_id: "x", observed_at: "not-a-date", event_type: "heartbeat", payload: {} }]
    });
    expect(errors.some((e) => e.includes("observed_at"))).toBe(true);
  });

  it("rejects missing payload", () => {
    const errors = validateAgentAuditBody({
      events: [{ client_event_id: "x", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat" }]
    });
    expect(errors.some((e) => e.includes("payload"))).toBe(true);
  });

  it("rejects empty client_event_id", () => {
    const errors = validateAgentAuditBody({
      events: [{ client_event_id: "", observed_at: "2026-10-19T12:00:00Z", event_type: "heartbeat", payload: {} }]
    });
    expect(errors.some((e) => e.includes("client_event_id"))).toBe(true);
  });
});

describe("T06a appendClientObservations", () => {
  let db: Database.Database;
  let appender: ReturnType<typeof fakeLedgerAppender>;

  beforeEach(() => {
    db = makeSecDb();
    appender = fakeLedgerAppender(db);
  });

  afterEach(() => db?.close());

  it("persists accepted events to security_events + idempotency table", () => {
    const results = appendClientObservations(db, baseAdapter, sampleEvents, CLASSIFICATION_VERSION, appender);
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("accepted");
    expect(results[1].status).toBe("accepted");

    const idem = db
      .prepare(`SELECT client_event_id, ack_status FROM agent_audit_idempotency ORDER BY client_event_id`)
      .all() as Array<{ client_event_id: string; ack_status: string }>;
    expect(idem.map((r) => r.client_event_id)).toEqual(["client-evt-1", "client-evt-2"]);
    // B23 / E-7：`ack_status` 不再硬编码 "accepted" —— 记**真实送达状态**。
    // 这两条观测不是 `result_received`（无有效回执），因此送达观察为 unknown，
    // 绝不记 acknowledged，也绝不记 unacknowledged（U1）。
    expect(idem.every((r) => r.ack_status === "unknown")).toBe(true);

    const ledger = db
      .prepare(
        `SELECT event_id, audit_event_kind, result_summary, created_at FROM security_events`
      )
      .all() as Array<{ event_id: string; audit_event_kind: string; result_summary: string; created_at: number }>;
    expect(ledger).toHaveLength(2);
    expect(ledger.every((r) => r.audit_event_kind === "audit_management")).toBe(true);
    // 双时间戳: created_at 是服务端接收时间 (ms epoch)
    expect(ledger.every((r) => r.created_at > 0)).toBe(true);
  });

  it("returns idempotent_replay for the same client_event_id + same content", () => {
    appendClientObservations(db, baseAdapter, sampleEvents, CLASSIFICATION_VERSION, appender);
    const second = appendClientObservations(db, baseAdapter, sampleEvents, CLASSIFICATION_VERSION, appender);
    expect(second[0].status).toBe("idempotent_replay");
    expect(second[1].status).toBe("idempotent_replay");
    // Idempotency: still 2 rows in security_events (no duplicate).
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM security_events`).get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it("returns id_conflict when same client_event_id has different content", () => {
    appendClientObservations(db, baseAdapter, sampleEvents, CLASSIFICATION_VERSION, appender);
    const modified: AgentAuditEventInput[] = sampleEvents.map((e, i) =>
      i === 0
        ? { ...e, payload: { result_summary: "DIFFERENT" } }
        : e
    );
    const second = appendClientObservations(db, baseAdapter, modified, CLASSIFICATION_VERSION, appender);
    expect(second[0].status).toBe("id_conflict");
    expect(second[0]).toHaveProperty("existing");
    expect(second[1].status).toBe("idempotent_replay"); // unchanged event still idempotent
  });

  it("refuses parent_event_id outside adapter's visible parents", () => {
    const events: AgentAuditEventInput[] = [
      {
        client_event_id: "client-evt-3",
        observed_at: "2026-10-19T12:00:00Z",
        event_type: "result_received",
        parent_event_id: "evt-other-subject-99",
        payload: {}
      }
    ];
    const results = appendClientObservations(db, baseAdapter, events, CLASSIFICATION_VERSION, appender);
    expect(results[0].status).toBe("parent_not_visible");
    // No persistence on refusal
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM agent_audit_idempotency`).get() as { n: number }).n
    ).toBe(0);
  });

  it("accepts parent_event_id within adapter's visible set", () => {
    const adapter = {
      adapter_id: "adapter-1",
      instance_id: "lucy-instance-1",
      visibleParentIds: new Set(["evt-permitted-1"])
    };
    const events: AgentAuditEventInput[] = [
      {
        client_event_id: "client-evt-4",
        observed_at: "2026-10-19T12:00:00Z",
        event_type: "result_received",
        parent_event_id: "evt-permitted-1",
        payload: {}
      }
    ];
    const results = appendClientObservations(db, adapter, events, CLASSIFICATION_VERSION, appender);
    expect(results[0].status).toBe("accepted");
  });

  it("preserves heartbeat observed_at vs server_received_at", () => {
    const events: AgentAuditEventInput[] = [
      {
        client_event_id: "client-evt-hb",
        observed_at: "2026-10-18T22:00:00Z", // client-local time (offline lag)
        event_type: "heartbeat",
        payload: { adapter_id: "adapter-1" }
      }
    ];
    const before = Date.now();
    const results = appendClientObservations(db, baseAdapter, events, CLASSIFICATION_VERSION, appender);
    const after = Date.now();
    expect(results[0].status).toBe("accepted");
    const row = db
      .prepare(`SELECT event_type, observed_at, server_received_at FROM agent_audit_idempotency WHERE client_event_id = ?`)
      .get("client-evt-hb") as { event_type: string; observed_at: string; server_received_at: number };
    expect(row.event_type).toBe("heartbeat");
    expect(row.observed_at).toBe("2026-10-18T22:00:00Z"); // client time preserved
    expect(row.server_received_at).toBeGreaterThanOrEqual(before);
    expect(row.server_received_at).toBeLessThanOrEqual(after);
  });
});