import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recoverInterruptedOperations } from "../security/ledger";
import {
  AUDIT_PROJECTOR_NAME,
  createProjectionScheduler,
  projectionStatus,
  readTargetCursor,
  runProjection
} from "../security/projector";
import { recoverProjectionCursor } from "../security/recovery";
import { openSecurityStore, type SecurityStore } from "../security/store";
import type { SecurityEvent, SecurityResult } from "../security/types";

/**
 * T07-3 — Spec §5.2: the projector is idempotent, its cursor moves in the same
 * transaction as the rows it covers, and a lagging projection says complete=false.
 */

let root: string;
let store: SecurityStore;
let target: Database.Database;
let clock = 1_000;

function unwrap<T>(result: SecurityResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}/${result.reason}: ${result.message}`);
  return result.value;
}

type Phase = SecurityEvent["phase"];

function append(operationId: string, phase: Phase, extra: { verdict?: string; summary?: object } = {}): SecurityEvent {
  return unwrap(
    store.appendEvent({
      eventId: `${operationId}:${phase}`,
      operationId,
      phase,
      actor: "agent_a",
      actorType: "agent",
      networkInfo: "10.0.0.7",
      sessionFingerprint: "sha256:abc",
      verdict: extra.verdict,
      resultSummary: extra.summary ? JSON.stringify(extra.summary) : undefined
    })
  );
}

function fullOperation(id: string): void {
  append(id, "request_admitted", { summary: { method: "tools/call", tool: "lucy_query" } });
  append(id, "response_prepared", {
    verdict: "ok",
    summary: { method: "tools/call", tool: "lucy_query", status: 200, bytes: 42, sha256: "a".repeat(64) }
  });
  append(id, "response_delivered", { verdict: "delivered", summary: { method: "tools/call", tool: "lucy_query" } });
}

const rows = () =>
  target.prepare("SELECT * FROM security_operation_projection ORDER BY first_seq").all() as Array<Record<string, unknown>>;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-projection-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  store = unwrap(openSecurityStore(root, { now: () => ++clock }));
  target = new Database(path.join(root, "audit.sqlite"));
});

afterEach(async () => {
  target.close();
  store.close();
  await rm(root, { recursive: true, force: true });
});

describe("runProjection — idempotent merge", () => {
  it("folds each operation's events into one row and reports complete", () => {
    fullOperation("op-1");
    fullOperation("op-2");

    const run = runProjection(store, target);

    expect(run.projected).toBe(6);
    expect(run.status).toMatchObject({ complete: true, lag: 0, delayMs: 0, cursor: 6, latestSeq: 6 });
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toMatchObject({
      operation_id: "op-1",
      kind: "mcp_response",
      state: "delivered",
      actor: "agent_a",
      network_info: "10.0.0.7",
      method: "tools/call",
      tool: "lucy_query",
      response_status: 200,
      response_bytes: 42,
      response_sha256: "a".repeat(64),
      first_seq: 1,
      last_seq: 3
    });
  });

  it("is a no-op when run again, and produces identical rows after a full replay from zero", () => {
    fullOperation("op-1");
    fullOperation("op-2");
    runProjection(store, target);
    const before = JSON.stringify(rows());

    expect(runProjection(store, target).projected).toBe(0);

    // Rewind the cursor (e.g. restore / replay): rows and counts must not change.
    target.prepare("UPDATE security_projection_cursor SET last_seq = 0 WHERE projector = ?").run(AUDIT_PROJECTOR_NAME);
    const replay = runProjection(store, target);

    expect(replay.projected).toBe(6);
    expect(JSON.stringify(rows())).toBe(before);
    expect(target.prepare("SELECT COUNT(*) AS n FROM security_operation_projection").get()).toEqual({ n: 2 });
  });

  it("supports pause and resume across batches without duplicating operations", () => {
    fullOperation("op-1");
    fullOperation("op-2");
    fullOperation("op-3");

    // Pause: only one event per pass, abandoned halfway through an operation.
    const first = runProjection(store, target, { batchSize: 2 });
    expect(first.status.complete).toBe(true);
    expect(rows()).toHaveLength(3);

    fullOperation("op-4");
    expect(projectionStatus(store, target)).toMatchObject({ complete: false, lag: 3, reason: "projection_lag" });
    runProjection(store, target, { batchSize: 1 });
    expect(rows().map((row) => row.operation_id)).toEqual(["op-1", "op-2", "op-3", "op-4"]);
    expect(rows().every((row) => row.state === "delivered")).toBe(true);
  });

  it("projects interrupted operations as interrupted, never delivered", async () => {
    append("op-crash", "request_admitted", { summary: { method: "tools/call", tool: "lucy_query" } });
    append("op-prepared", "request_admitted");
    append("op-prepared", "response_prepared", { summary: { status: 200, bytes: 1, sha256: "b".repeat(64) } });
    unwrap(await recoverInterruptedOperations(store));

    runProjection(store, target);

    const byId = Object.fromEntries(rows().map((row) => [String(row.operation_id), row]));
    expect(byId["op-crash"]).toMatchObject({ state: "interrupted", detail: "before_prepare" });
    expect(byId["op-prepared"]).toMatchObject({ state: "interrupted", detail: "prepared_unconfirmed", response_bytes: 1 });
    expect(rows().some((row) => row.state === "delivered")).toBe(false);
  });

  it("projects config-operation events and keeps them distinct from MCP responses", () => {
    unwrap(store.prepareOperation({ operationId: "cfg-1", kind: "role_update", direction: "narrow", actor: "alice", actorType: "admin" }));
    unwrap(store.commitOperation("cfg-1"));

    runProjection(store, target);

    expect(rows()).toEqual([expect.objectContaining({ operation_id: "cfg-1", kind: "config_operation", state: "committed" })]);
  });
});

describe("runProjection — cursor and rows share one target transaction", () => {
  it("rolls back rows and cursor together when a batch fails, then catches up on retry", () => {
    fullOperation("op-1");
    fullOperation("op-poison");
    fullOperation("op-3");
    runProjection(store, target, { batchSize: 3 }); // seeds the target schema
    target.prepare("DELETE FROM security_operation_projection").run();
    target.prepare("UPDATE security_projection_cursor SET last_seq = 0 WHERE projector = ?").run(AUDIT_PROJECTOR_NAME);
    target.exec(`
      CREATE TRIGGER poison BEFORE INSERT ON security_operation_projection
      WHEN NEW.operation_id = 'op-poison'
      BEGIN SELECT RAISE(ABORT, 'injected projection failure'); END;
    `);

    const failed = runProjection(store, target, { batchSize: 100 });

    expect(failed.status).toMatchObject({ complete: false, reason: "projection_failed" });
    // The whole batch rolled back: no partial rows, cursor untouched.
    expect(rows()).toHaveLength(0);
    expect(readTargetCursor(target)).toBe(0);
    // Canonical events are intact.
    expect(unwrap(store.maxEventSeq())).toBe(9);

    target.exec("DROP TRIGGER poison");
    const retried = runProjection(store, target);
    expect(retried.status.complete).toBe(true);
    expect(rows().map((row) => row.operation_id)).toEqual(["op-1", "op-poison", "op-3"]);
  });

  it("reconciles the ledger's mirror cursor to what the target proves after a crash between projection and mirror", async () => {
    fullOperation("op-1");
    fullOperation("op-2");
    // Crash simulation: the target transaction (rows + cursor) committed, the ledger mirror never advanced.
    runProjection(store, target); // seeds the target schema
    target.prepare("DELETE FROM security_projection_cursor").run();
    store.close();
    store = unwrap(openSecurityStore(root, { now: () => ++clock }));
    const staleRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-audit-projection-stale-"));
    const stale = unwrap(openSecurityStore(staleRoot, { now: () => ++clock }));
    try {
      for (const event of unwrap(store.listEventsAfter(0))) {
        unwrap(stale.appendEvent({ ...event }));
      }
      target.prepare("INSERT INTO security_projection_cursor (projector, last_seq, updated_at) VALUES (?, 6, 'x')").run(
        AUDIT_PROJECTOR_NAME
      );
      expect(unwrap(stale.getProjectionCursor(AUDIT_PROJECTOR_NAME))).toBe(0);

      const recovered = unwrap(
        await recoverProjectionCursor(stale, AUDIT_PROJECTOR_NAME, () => readTargetCursor(target))
      );

      expect(recovered).toMatchObject({ cursor: 6, lag: 0, complete: true });
      expect(runProjection(stale, target).projected).toBe(0);
    } finally {
      stale.close();
      await rm(staleRoot, { recursive: true, force: true });
    }
  });
});

describe("projection status — lag is complete=false, never silently complete", () => {
  it("reports the lag and the age of the oldest unprojected event", () => {
    fullOperation("op-1");
    runProjection(store, target);
    clock = 5_000;
    fullOperation("op-late");
    clock = 9_000;

    const status = projectionStatus(store, target, () => 9_000);

    expect(status.complete).toBe(false);
    expect(status).toMatchObject({ lag: 3, reason: "projection_lag", cursor: 3, latestSeq: 6 });
    expect(status.delayMs).toBeGreaterThan(3_000);

    runProjection(store, target);
    expect(projectionStatus(store, target)).toMatchObject({ complete: true, delayMs: 0 });
  });

  it("reports security_store_unavailable instead of a stale complete when the ledger cannot be read", async () => {
    fullOperation("op-1");
    runProjection(store, target);
    store.close();

    expect(projectionStatus(store, target)).toMatchObject({ complete: false, reason: "security_store_unavailable" });
    expect(runProjection(store, target).status).toMatchObject({ complete: false, reason: "security_store_unavailable" });
  });

  it("keeps ledger (core) health separate from projection lag", async () => {
    vi.resetModules();
    const health = await import("../proxy/audit-write-health");
    health.resetAuditWriteHealthForTests();

    health.recordLedgerAppend(false);
    health.recordProjectionStatus({ complete: true, lag: 0, delayMs: 0 });
    expect(health.readAuditWriteHealth()).toMatchObject({
      ledger: { state: "unavailable", failedAppends: 1 },
      projection: { complete: true, lag: 0 }
    });

    health.recordLedgerAppend(true);
    health.recordProjectionStatus({ complete: false, lag: 12, delayMs: 4000, reason: "projection_lag" });
    // Projection lag does not make the canonical ledger look unhealthy, nor vice versa.
    expect(health.readAuditWriteHealth()).toMatchObject({
      ledger: { state: "ok" },
      projection: { complete: false, lag: 12, reason: "projection_lag" }
    });
  });
});

describe("createProjectionScheduler", () => {
  it("coalesces triggers into non-overlapping passes and reports each status", async () => {
    fullOperation("op-1");
    const statuses: boolean[] = [];
    const scheduler = createProjectionScheduler({
      getStore: async () => ({ ok: true, value: store }),
      getTarget: async () => target,
      onStatus: (status) => statuses.push(status.complete),
      debounceMs: 5
    });

    scheduler.trigger();
    scheduler.trigger();
    scheduler.trigger();
    await new Promise((resolve) => setTimeout(resolve, 60));
    scheduler.stop();

    expect(statuses).toEqual([true]);
    expect(rows()).toHaveLength(1);
  });

  it("reports an unavailable ledger as not complete", async () => {
    const statuses: Array<string | undefined> = [];
    const scheduler = createProjectionScheduler({
      getStore: async () => ({ ok: false, code: "SECURITY_STORE_UNAVAILABLE", reason: "busy", message: "locked" }),
      getTarget: async () => target,
      onStatus: (status) => statuses.push(status.reason)
    });

    await scheduler.runNow();

    expect(statuses).toEqual(["security_store_unavailable"]);
  });
});
