import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { recoverPendingOperations, recoverProjectionCursor } from "../security/recovery";
import { openSecurityStore, type SecurityStore } from "../security/store";
import type { PrepareOperationInput, SecurityResult } from "../security/types";

let root: string;
const opened: SecurityStore[] = [];

function open(): SecurityStore {
  const result = openSecurityStore(root);
  if (!result.ok) throw new Error(result.message);
  opened.push(result.value);
  return result.value;
}

function unwrap<T>(result: SecurityResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}/${result.reason}: ${result.message}`);
  return result.value;
}

const prepare = (id: string, direction: PrepareOperationInput["direction"]): PrepareOperationInput => ({
  operationId: id,
  kind: "role_update",
  direction,
  actor: "alice",
  actorType: "admin"
});

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-security-recovery-"));
});

afterEach(async () => {
  while (opened.length) opened.pop()?.close();
  await rm(root, { recursive: true, force: true });
});

describe("pending operations", () => {
  it("keeps prepared-but-uncommitted operations pending after a crash, never as success", () => {
    const first = open();
    unwrap(first.prepareOperation(prepare("op1", "widen")));
    first.close(); // crash before commit

    const second = open();
    expect(unwrap(second.getOperation("op1"))).toMatchObject({ state: "pending", resolvedAt: null });
    expect(unwrap(second.listOperations("committed"))).toEqual([]);
  });

  it("enforces the state machine: terminal states cannot change", () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "neutral")));
    unwrap(store.commitOperation("op1"));
    expect(store.abortOperation("op1", "late")).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(store.commitOperation("op1")).toMatchObject({ ok: false, reason: "invalid_transition" });
    expect(store.prepareOperation(prepare("op1", "neutral"))).toMatchObject({ ok: false, reason: "operation_exists" });
  });

  it("records prepare/commit as durable ordered events", () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "narrow")));
    unwrap(store.commitOperation("op1"));
    expect(unwrap(store.listEventsByOperation("op1")).map((e) => e.phase)).toEqual(["prepare", "commit"]);
  });
});

describe("recoverPendingOperations", () => {
  it("aborts when the file write never happened (prepare then crash)", async () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "widen")));

    const report = unwrap(await recoverPendingOperations(store, () => "not_applied"));
    expect(report).toMatchObject({ aborted: ["op1"], committed: [], holdWidening: false });
    expect(unwrap(store.getOperation("op1"))?.state).toBe("aborted");
  });

  it("rolls forward a narrowing write that landed before commit", async () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "narrow")));

    const report = unwrap(await recoverPendingOperations(store, () => "applied"));
    expect(report.committed).toEqual(["op1"]);
    expect(unwrap(store.getOperation("op1"))?.state).toBe("committed");
  });

  it("never auto-ratifies a widening write that landed before commit", async () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "widen")));

    const report = unwrap(await recoverPendingOperations(store, () => "applied"));
    expect(report).toMatchObject({ needsReview: ["op1"], committed: [], holdWidening: true });
    expect(unwrap(store.getOperation("op1"))?.state).toBe("needs_review");
    expect(unwrap(store.listOperations("committed"))).toEqual([]);

    // still held on the next recovery pass
    const again = unwrap(await recoverPendingOperations(store, () => "applied"));
    expect(again).toMatchObject({ needsReview: ["op1"], holdWidening: true });
  });

  it("leaves operations pending when evidence is unknown or the inspector throws", async () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("a", "widen")));
    unwrap(store.prepareOperation(prepare("b", "narrow")));

    const report = unwrap(
      await recoverPendingOperations(store, (op) => {
        if (op.operationId === "b") throw new Error("disk unreadable");
        return "unknown";
      })
    );
    expect(report.unresolved.sort()).toEqual(["a", "b"]);
    expect(report.holdWidening).toBe(true);
    expect(unwrap(store.listOperations("pending")).map((o) => o.operationId)).toEqual(["a", "b"]);
    expect(unwrap(store.listOperations("committed"))).toEqual([]);
  });

  it("is idempotent once operations are resolved", async () => {
    const store = open();
    unwrap(store.prepareOperation(prepare("op1", "narrow")));
    await recoverPendingOperations(store, () => "applied");
    const again = unwrap(await recoverPendingOperations(store, () => "applied"));
    expect(again).toEqual({ committed: [], aborted: [], needsReview: [], unresolved: [], holdWidening: false });
  });

  it("surfaces store failure instead of an empty report", async () => {
    const store = open();
    store.close();
    const result = await recoverPendingOperations(store, () => "applied");
    expect(result).toMatchObject({ ok: false, code: "SECURITY_STORE_UNAVAILABLE" });
  });
});

describe("recoverProjectionCursor", () => {
  const event = (id: string) => ({
    eventId: id,
    operationId: "op",
    phase: "decision" as const,
    actor: "a",
    actorType: "admin"
  });

  it("advances to what the projector proved after a crash before cursor commit", async () => {
    const store = open();
    for (const id of ["e1", "e2", "e3"]) unwrap(store.appendEvent(event(id)));

    const result = unwrap(await recoverProjectionCursor(store, "audit", () => 2));
    expect(result).toEqual({ cursor: 2, latestSeq: 3, lag: 1, complete: false });
  });

  it("never rewinds, never passes durable events, and reports incomplete on probe failure", async () => {
    const store = open();
    unwrap(store.appendEvent(event("e1")));
    unwrap(store.appendEvent(event("e2")));
    unwrap(store.advanceProjectionCursor("audit", 2));

    expect(unwrap(await recoverProjectionCursor(store, "audit", () => 1)).cursor).toBe(2);
    expect(unwrap(await recoverProjectionCursor(store, "audit", () => 99)).cursor).toBe(2);

    unwrap(store.appendEvent(event("e3")));
    const failed = unwrap(
      await recoverProjectionCursor(store, "audit", () => {
        throw new Error("audit db down");
      })
    );
    expect(failed).toMatchObject({ cursor: 2, lag: 1, complete: false });
  });
});
