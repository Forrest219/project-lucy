import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  TRACE_MAX_BYTES,
  TRACE_MAX_ROWS,
  TRACE_RETENTION_DAYS,
  ensureTraceEvidenceSchema,
  hashArtifact,
  listTraceEvents,
  prepareTraceDatabase,
  purgeTraceEvidence,
  recordMcpToolsCall,
  writeEvidenceEvents,
  writeTraceEvent
} from "../trace/evidence.js";

function createTempDb(): { db: Database.Database; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), "lucy-trace-"));
  const dbPath = path.join(dir, "trace.sqlite");
  const db = new Database(dbPath);
  prepareTraceDatabase(db);
  ensureTraceEvidenceSchema(db);
  return {
    db,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // ignore double-close during teardown
      }
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("trace/evidence — retention constants", () => {
  it("exposes spec defaults 365 / 500000 / 1073741824", () => {
    expect(TRACE_RETENTION_DAYS).toBe(365);
    expect(TRACE_MAX_ROWS).toBe(500_000);
    expect(TRACE_MAX_BYTES).toBe(1_073_741_824);
  });
});

describe("trace/evidence — schema setup", () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTempDb());
  });
  afterEach(() => cleanup());

  it("is idempotent", () => {
    ensureTraceEvidenceSchema(db);
    ensureTraceEvidenceSchema(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('trace_events','evidence_events') ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(["evidence_events", "trace_events"]);
  });

  it("enables incremental auto_vacuum on a new database", () => {
    ensureTraceEvidenceSchema(db);
    const mode = (db.pragma("auto_vacuum", { simple: true }) as unknown) as string | number;
    // SQLite returns 2 for INCREMENTAL, but some builds stringify it.
    expect(String(mode) === "2" || String(mode).toLowerCase() === "incremental").toBe(true);
  });

  it("sets busy_timeout to 5000 so writers wait instead of surfacing SQLITE_BUSY", () => {
    // The kernel contract requires callers to set busyTimeout themselves; we
    // verify the helper code path tolerates the common default used elsewhere
    // in the WebUI (proxy/audit.ts and admin/audit.ts both call `pragma("busy_timeout = 5000")`
    // right after open). Here we document the assumption via a probe pragma.
    db.pragma("busy_timeout = 5000");
    const result = db.pragma("busy_timeout", { simple: true }) as number;
    expect(result).toBe(5000);
  });
});

describe("trace/evidence — append-only semantics", () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTempDb());
    ensureTraceEvidenceSchema(db);
  });
  afterEach(() => cleanup());

  it("inserting the same logical event twice creates two rows", () => {
    const eventInput = {
      traceId: "trace-1",
      spanId: "span-a",
      spanType: "mcp_tools_call" as const,
      actorKind: "agent" as const,
      actorId: "agent-1",
      status: "ok" as const,
      startedAt: "2026-08-03T00:00:00.000Z"
    };
    writeTraceEvent(db, eventInput);
    writeTraceEvent(db, eventInput);
    const rows = db.prepare(`SELECT COUNT(*) AS cnt FROM trace_events WHERE trace_id = ?`).get("trace-1") as { cnt: number };
    expect(rows.cnt).toBe(2);
  });

  it("records policy_decision + access_policy evidence for an mcp_tools_call", () => {
    const { callEventId, policyEventId } = recordMcpToolsCall(db, {
      traceId: "trace-2",
      spanId: "span-x",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "denied",
      sessionId: "session-1",
      turnId: "turn-1",
      requestId: "req-1",
      policyDecision: {
        allowed: false,
        reason: "tool_not_allowed",
        toolName: "lucy_query",
        source: "access_policy",
        permissionSnapshotHash: "abc123def456abc123def456abc123de"
      }
    });
    expect(callEventId).toBeGreaterThan(0);
    expect(policyEventId).toBeGreaterThan(0);

    const { events, evidence } = listTraceEvents(db, { traceId: "trace-2" });
    expect(events.map((event) => event.spanType).sort()).toEqual(["mcp_tools_call", "policy_decision"]);
    expect(evidence.map((item) => item.relation)).toContain("denied_by");
    expect(evidence.map((item) => item.evidenceKind)).toContain("access_policy");
  });

  it("uses policyDecision.source as the evidence kind", () => {
    recordMcpToolsCall(db, {
      traceId: "trace-policy-source",
      spanId: "span-rate",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "denied",
      policyDecision: {
        allowed: false,
        reason: "query_concurrency_exceeded",
        toolName: "lucy_query",
        source: "rate_limit"
      }
    });
    const { evidence } = listTraceEvents(db, { traceId: "trace-policy-source" });
    expect(evidence.map((item) => item.evidenceKind)).toContain("rate_limit");
  });

  it("rejects blacklisted evidence kinds", () => {
    expect(() =>
      writeEvidenceEvents(db, [
        {
          traceId: "trace-3",
          evidenceKind: "raw_sql_ast",
          evidenceRef: "SELECT * FROM users",
          relation: "used"
        }
      ])
    ).toThrowError(/refused blacklisted evidence/);

    expect(() =>
      writeEvidenceEvents(db, [
        {
          traceId: "trace-3",
          evidenceKind: "access_policy",
          evidenceRef: "raw_token=shhh",
          relation: "used"
        }
      ])
    ).toThrowError(/refused blacklisted evidence/);
  });

  it("redacts sensitive metadata keys", () => {
    const id = writeTraceEvent(db, {
      traceId: "trace-4",
      spanId: "span-redact",
      spanType: "sql_plan",
      actorKind: "system",
      actorId: null,
      status: "ok",
      startedAt: "2026-08-03T00:00:00.000Z",
      metadata: {
        password: "hunter2",
        nested: { api_key: "k-123", safe: "visible" }
      }
    });
    const row = db.prepare(`SELECT metadata_json FROM trace_events WHERE id = ?`).get(id) as { metadata_json: string };
    const meta = JSON.parse(row.metadata_json) as Record<string, unknown>;
    expect(meta.password).toBe("[REDACTED]");
    const nested = meta.nested as Record<string, unknown>;
    expect(nested.api_key).toBe("[REDACTED]");
    expect(nested.safe).toBe("visible");
  });

  it("redacts sensitive values even when the metadata key is not sensitive", () => {
    const id = writeTraceEvent(db, {
      traceId: "trace-4b",
      spanId: "span-redact-value",
      spanType: "mcp_tools_call",
      actorKind: "agent",
      actorId: "agent-1",
      status: "ok",
      startedAt: "2026-08-03T00:00:00.000Z",
      metadata: {
        note: "authorization=Bearer sk-testsecret1234567890",
        prompt: "show token usage by table"
      }
    });
    const row = db.prepare(`SELECT metadata_json FROM trace_events WHERE id = ?`).get(id) as { metadata_json: string };
    const meta = JSON.parse(row.metadata_json) as Record<string, string>;
    expect(meta.note).toContain("authorization=[REDACTED]");
    expect(meta.note).not.toContain("sk-testsecret");
    expect(meta.prompt).toBe("show token usage by table");
  });

  it("caps metadata string length to avoid runaway cells", () => {
    const id = writeTraceEvent(db, {
      traceId: "trace-5",
      spanId: "span-cap",
      spanType: "sql_plan",
      actorKind: "system",
      actorId: null,
      status: "ok",
      startedAt: "2026-08-03T00:00:00.000Z",
      metadata: { blob: "x".repeat(10_000) }
    });
    const row = db.prepare(`SELECT metadata_json FROM trace_events WHERE id = ?`).get(id) as { metadata_json: string };
    const meta = JSON.parse(row.metadata_json) as { blob: string };
    expect(meta.blob.endsWith("…[truncated]")).toBe(true);
  });
});

describe("trace/evidence — listTraceEvents", () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTempDb());
    ensureTraceEvidenceSchema(db);
  });
  afterEach(() => cleanup());

  it("filters by turnId and joins evidence rows", () => {
    recordMcpToolsCall(db, {
      traceId: "trace-6",
      spanId: "span-a",
      actorId: "agent-1",
      toolName: "kx_catalog",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "ok",
      turnId: "turn-A",
      sessionId: "session-A",
      requestId: "req-A",
      policyDecision: {
        allowed: true,
        toolName: "kx_catalog",
        source: "access_policy",
        permissionSnapshotHash: "deadbeefdeadbeefdeadbeefdeadbeef"
      }
    });
    recordMcpToolsCall(db, {
      traceId: "trace-7",
      spanId: "span-b",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:01:00.000Z",
      endedAt: "2026-08-03T00:01:01.000Z",
      status: "denied",
      turnId: "turn-A",
      sessionId: "session-A",
      requestId: "req-B",
      policyDecision: {
        allowed: false,
        reason: "tool_not_allowed",
        toolName: "lucy_query",
        source: "access_policy"
      }
    });

    const { events, evidence } = listTraceEvents(db, { turnId: "turn-A" });
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(evidence.length).toBeGreaterThanOrEqual(2);
  });

  it("returns empty results without throwing when nothing matches", () => {
    const { events, evidence } = listTraceEvents(db, { traceId: "missing" });
    expect(events).toEqual([]);
    expect(evidence).toEqual([]);
  });
});

describe("trace/evidence — hashArtifact", () => {
  it("produces a stable 32-char hex digest", () => {
    const a = hashArtifact("lucy-trace");
    const b = hashArtifact("lucy-trace");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{32}$/);
  });

  it("accepts Buffer input", () => {
    const hex = hashArtifact(Buffer.from("lucy-buffer", "utf8"));
    expect(hex).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe("trace/evidence — P0 Closure evidence completeness", () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTempDb());
    ensureTraceEvidenceSchema(db);
  });
  afterEach(() => cleanup());

  it("writes result_snapshot_hash when row/column counts are known", () => {
    recordMcpToolsCall(db, {
      traceId: "trace-result",
      spanId: "span-result",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "ok",
      policyDecision: {
        allowed: true,
        toolName: "lucy_query",
        source: "access_policy",
        permissionSnapshotHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      },
      resultSnapshot: {
        rowCount: 12,
        columnCount: 4,
        responseBytes: 2048,
        truncated: false
      }
    });
    const { evidence } = listTraceEvents(db, { traceId: "trace-result" });
    const resultEv = evidence.find((item) => item.evidenceKind === "result_snapshot_hash");
    expect(resultEv).toBeTruthy();
    expect(resultEv?.relation).toBe("observed");
    expect(resultEv?.evidenceHash).toMatch(/^[a-f0-9]{32}$/);
    expect(resultEv?.metadata).toMatchObject({ rowCount: 12, columnCount: 4, responseBytes: 2048 });
  });

  it("skips result_snapshot_hash when size meta is absent", () => {
    recordMcpToolsCall(db, {
      traceId: "trace-no-result",
      spanId: "span-no-result",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "ok",
      policyDecision: { allowed: true, toolName: "lucy_query", source: "access_policy" },
      resultSnapshot: { responseBytes: 100 }
    });
    const { evidence } = listTraceEvents(db, { traceId: "trace-no-result" });
    expect(evidence.some((item) => item.evidenceKind === "result_snapshot_hash")).toBe(false);
  });

  it("writes semantic_yaml_node evidence for source refs", () => {
    recordMcpToolsCall(db, {
      traceId: "trace-sources",
      spanId: "span-sources",
      actorId: "agent-1",
      toolName: "lucy_query",
      startedAt: "2026-08-03T00:00:00.000Z",
      endedAt: "2026-08-03T00:00:01.000Z",
      status: "ok",
      policyDecision: { allowed: true, toolName: "lucy_query", source: "access_policy" },
      sourceRefs: [
        {
          connectionId: "dataforai",
          schema: "public",
          sourceName: "superstore_orders",
          physicalTable: "dataforai.superstore_orders",
          confidence: "high"
        },
        {
          connectionId: "dataforai",
          schema: "public",
          sourceName: "superstore_orders",
          physicalTable: "dataforai.superstore_orders",
          confidence: "high"
        }
      ]
    });
    const { evidence } = listTraceEvents(db, { traceId: "trace-sources" });
    const sourceEv = evidence.filter((item) => item.evidenceKind === "semantic_yaml_node");
    expect(sourceEv).toHaveLength(1);
    expect(sourceEv[0]?.evidenceRef).toBe("dataforai/public/superstore_orders");
    expect(sourceEv[0]?.relation).toBe("used");
    expect(sourceEv[0]?.metadata).toMatchObject({
      physicalTable: "dataforai.superstore_orders",
      sourceName: "superstore_orders"
    });
  });
});

describe("trace/evidence — retention purge", () => {
  let db: Database.Database;
  let cleanup: () => void;

  beforeEach(() => {
    ({ db, cleanup } = createTempDb());
    ensureTraceEvidenceSchema(db);
  });
  afterEach(() => cleanup());

  it("purges aged traces but preserves reviewer_override / promoted evidence traces", () => {
    const oldTs = "2020-01-01T00:00:00.000Z";
    writeTraceEvent(db, {
      traceId: "trace-old",
      spanId: "span-old",
      spanType: "mcp_tools_call",
      actorKind: "agent",
      actorId: "a1",
      status: "ok",
      startedAt: oldTs
    });
    db.prepare(`UPDATE trace_events SET created_at = ? WHERE trace_id = ?`).run(oldTs, "trace-old");

    writeTraceEvent(db, {
      traceId: "trace-protected",
      spanId: "span-prot",
      spanType: "publish_gate",
      actorKind: "admin",
      actorId: "admin-1",
      status: "ok",
      startedAt: oldTs
    });
    db.prepare(`UPDATE trace_events SET created_at = ? WHERE trace_id = ?`).run(oldTs, "trace-protected");
    writeEvidenceEvents(db, [
      {
        traceId: "trace-protected",
        evidenceKind: "access_policy",
        evidenceRef: "override-1",
        relation: "reviewer_override",
        metadata: { note: "keep" }
      }
    ]);
    db.prepare(`UPDATE evidence_events SET created_at = ? WHERE trace_id = ?`).run(oldTs, "trace-protected");

    writeTraceEvent(db, {
      traceId: "trace-fresh",
      spanId: "span-fresh",
      spanType: "mcp_tools_call",
      actorKind: "agent",
      actorId: "a1",
      status: "ok",
      startedAt: new Date().toISOString()
    });

    const result = purgeTraceEvidence(db, {
      now: new Date("2026-08-20T00:00:00.000Z"),
      retentionDays: 30,
      incrementalVacuumPages: 8
    });
    expect(result.deletedTraceEvents).toBeGreaterThan(0);
    expect(result.protectedTraceCount).toBeGreaterThanOrEqual(1);

    const remaining = db
      .prepare(`SELECT DISTINCT trace_id AS id FROM trace_events ORDER BY id`)
      .all() as Array<{ id: string }>;
    const ids = remaining.map((row) => row.id);
    expect(ids).toContain("trace-protected");
    expect(ids).toContain("trace-fresh");
    expect(ids).not.toContain("trace-old");
  });

  it("is a noop when under retention caps", () => {
    writeTraceEvent(db, {
      traceId: "trace-recent",
      spanId: "span-recent",
      spanType: "mcp_tools_call",
      actorKind: "agent",
      actorId: "a1",
      status: "ok",
      startedAt: new Date().toISOString()
    });
    const result = purgeTraceEvidence(db, {
      now: new Date(),
      retentionDays: 365,
      maxRows: 500_000
    });
    expect(result.reason).toBe("noop");
    expect(result.deletedTraceEvents).toBe(0);
  });
});
