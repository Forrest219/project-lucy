import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as coordinator from "../publish-coordinator.js";
import * as journal from "../semantic-recovery-journal.js";
import * as proxy from "../proxy/mcp-proxy.js";
import { beginInstanceShutdown, markProcessServing, resetProcessDrainForTests } from "../runtime/process-drain.js";
import { questionBudget, QUESTION_BUDGET_MAX_WALL_MS } from "../proxy/question-experience.js";

const TARGET = "semantic-layer/shop/_schema/public.yaml";
const HINTS = ["shop", "orders"];
const NEW = "tables:\n  orders:\n    description: updated\n";
type Stage = { filesSaved(): void; failed(): void };
type Context = ReturnType<typeof proxy.__semanticReadWaitTest.createContext>;
// Canonical tests use only the final production seams. The legacy behavioral
// adapter is archived in inbox/baseline-only-read-wait-red.test.ts.
const readApi = proxy.__semanticReadWaitTest;
const register = coordinator.registerPublishWriteStage;

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

let root: string;
let previousContentRoot: string | undefined;
let events: Record<string, unknown>[];
const contexts: Context[] = [];
beforeEach(async () => {
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  process.env.LUCY_CONTENT_ROOT = ".";
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-read-write-settle-"));
  await mkdir(path.dirname(path.join(root, TARGET)), { recursive: true });
  await writeFile(path.join(root, TARGET), "tables:\n  orders: {}\n");
  resetProcessDrainForTests(); markProcessServing();
  questionBudget.resetForTests(); questionBudget.setMonoClock(() => performance.now());
  events = [];
  vi.spyOn(console, "info").mockImplementation((prefix, value) => {
    if (prefix === "[lucy-semantic-write]") events.push(JSON.parse(value));
  });
});
afterEach(async () => {
  for (const context of contexts.splice(0)) context.close();
  vi.restoreAllMocks(); resetProcessDrainForTests();
  journal.resetSemanticRecoveryAdmissionForTests();
  questionBudget.resetForTests(); questionBudget.setMonoClock(() => performance.now());
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  await rm(root, { recursive: true, force: true });
});

function context() {
  const req = new EventEmitter() as IncomingMessage;
  Object.assign(req, { aborted: false, socket: new EventEmitter() });
  const res = new EventEmitter() as ServerResponse;
  const ctx = readApi.createContext(req, res, "ingress-test");
  contexts.push(ctx);
  return { req, res, ctx };
}
async function read(ctx: Context) {
  return readApi.awaitRecovery(root, HINTS, ctx, "rpc-1");
}
async function normalWriter(options: { afterSaved?: () => Promise<void>; terminal?: Promise<void> } = {}) {
  const ready = deferred<journal.RecoveryJournal>();
  const write = deferred();
  const savedStage = deferred();
  const done = coordinator.withPublishCoordinator("manifest_upload", async () => {
    let stage: Stage | undefined;
    const saved = await journal.createRecoveryJournal(root, {
      releaseId: "release-live", operationId: "release-live", actor: "admin", instanceId: "synthetic",
      targets: [{ targetPath: TARGET, identity: { connectionId: "shop", schema: "public", table: "public" }, newContent: NEW }],
      ...{ onBeforePersist: (value: journal.RecoveryJournal) => {
        stage = register(coordinator.currentProcessPublishHolder()!, { projectRoot: root, journal: value });
      } }
    });
    ready.resolve(saved);
    await write.promise;
    await writeFile(path.join(root, TARGET), NEW);
    await journal.markRecoveryJournalFilesSaved(root, saved.journalId);
    await options.afterSaved?.();
    stage?.filesSaved();
    savedStage.resolve();
    await options.terminal;
  }, { projectRoot: root });
  return { journal: await ready.promise, write, done, saved: savedStage.promise };
}

describe("P1-70 actual normal write admission", () => {
  it("waits on a real live WAL instead of immediately reporting semantic recovery failure", async () => {
    const writer = await normalWriter();
    const { ctx } = context();
    let settled = false;
    const result = read(ctx).then((value) => { settled = true; return value; });
    try {
      for (let turn = 0; turn < 1000 && !settled && !events.some((e) => e.event === "read_wait_begin"); turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(settled, "old real guard immediately returned semantic_recovery_required during normal actual write").toBe(false);
      expect((await journal.readRecoveryJournal(root, writer.journal.journalId))?.phase).toBe("write_in_progress");
    } finally { writer.write.resolve(); await writer.done; }
    expect(await result).toBeNull();
    expect(await readFile(path.join(root, TARGET), "utf8")).toBe(NEW);
  });

  it("keeps an orphan WAL fail closed even when its timestamps and local PID are fresh", async () => {
    await journal.createRecoveryJournal(root, {
      releaseId: "orphan", operationId: "orphan", actor: "admin", instanceId: "synthetic",
      targets: [{ targetPath: TARGET, newContent: NEW }]
    });
    expect((await read(context().ctx))?.code).toBe("semantic_recovery_required");
    expect(events.some((e) => e.event === "read_wait_begin")).toBe(false);
  });

  it("does not turn client cancellation into completion or cancellation of the writer", async () => {
    const writer = await normalWriter();
    const { ctx, res } = context();
    const result = read(ctx);
    for (let turn = 0; turn < 1000 && !events.some((e) => e.event === "read_wait_begin"); turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    res.emit("close");
    expect((await result)?.code).toBe("semantic_recovery_required");
    expect((await journal.readRecoveryJournal(root, writer.journal.journalId))?.phase).toBe("write_in_progress");
    expect(events.some((e) => e.event === "files_saved" || e.event === "failed")).toBe(false);
    writer.write.resolve(); await writer.done;
    expect(await journal.semanticRecoveryReadBlock(root, HINTS)).toBeNull();
  });

  it("binds the exact real holder before the WAL is visible and rejects altered target/release/root", async () => {
    await coordinator.withPublishCoordinator("manifest_upload", async () => {
      let stage!: Stage;
      const value = await journal.createRecoveryJournal(root, {
        releaseId: "pre-persist", operationId: "pre-persist", actor: "admin", instanceId: "synthetic",
        targets: [{ targetPath: TARGET, newContent: NEW }],
        onBeforePersist: (constructed) => {
          stage = register(coordinator.currentProcessPublishHolder()!, { projectRoot: root, journal: constructed });
          expect(existsSync(path.join(root, ".ktx-ui/semantic-recovery-journals", constructed.journalId + ".json"))).toBe(false);
          expect(coordinator.matchedActivePublishWriteStages(root, [constructed])).toHaveLength(1);
        }
      });
      expect(coordinator.matchedActivePublishWriteStages(root, [{ ...value, releaseId: "other" }])).toBeNull();
      expect(coordinator.matchedActivePublishWriteStages(root + "-other", [value])).toBeNull();
      expect(coordinator.matchedActivePublishWriteStages(root, [{ ...value, entries: [{ ...value.entries[0]!, expectedNewDigest: "wrong" }] }])).toBeNull();
      stage.failed();
      expect(coordinator.matchedActivePublishWriteStages(root, [value])).toBeNull();
    }, { projectRoot: root });
  });

  it("does not persist a WAL when the synchronous binding fails", async () => {
    await expect(journal.createRecoveryJournal(root, {
      releaseId: "bad-binding", operationId: "bad-binding", actor: "admin", instanceId: "synthetic",
      targets: [{ targetPath: TARGET, newContent: NEW }],
      onBeforePersist() { throw new Error("binding failed before persistence"); }
    })).rejects.toThrow("binding failed");
    expect(await journal.listOpenRecoveryJournals(root)).toEqual([]);
    expect(await readFile(path.join(root, TARGET), "utf8")).not.toBe(NEW);
  });

  it("uses the original ingress cutoff and leaves the real writer active after reader expiry", async () => {
    const writer = await normalWriter();
    let mono = 1000;
    questionBudget.setMonoClock(() => mono);
    const { ctx } = context();
    expect(ctx.waitDeadlineMonoMs).toBe(21000);
    mono = 21001; // Original request preflight consumed the entire eligibility.
    try {
      expect((await read(ctx))?.code).toBe("semantic_recovery_required");
      expect(events.find((e) => e.event === "read_wait_end")?.endOutcome).toBe("timeout");
      expect((await journal.readRecoveryJournal(root, writer.journal.journalId))?.phase).toBe("write_in_progress");
      expect(events.some((e) => e.event === "files_saved" || e.event === "failed")).toBe(false);
    } finally { writer.write.resolve(); await writer.done; }
    expect(await read(context().ctx)).toBeNull();
  });

  it("keeps normal request-body close distinct from a client disconnect or original socket timeout", () => {
    const { req, res, ctx } = context();
    req.emit("close");
    expect(ctx.signal.aborted).toBe(false);
    req.socket.emit("timeout");
    expect(ctx.signal.aborted).toBe(true);
    ctx.close();
    expect(req.listenerCount("aborted")).toBe(0);
    expect(res.listenerCount("close")).toBe(0);
    expect(req.socket.listenerCount("timeout")).toBe(0);
  });

  it("TERM ends the reader wait without settling or reopening the actual writer", async () => {
    const writer = await normalWriter();
    const { ctx } = context();
    await beginInstanceShutdown({ drainBudgetMs: 0 });
    try {
      expect((await read(ctx))?.code).toBe("semantic_recovery_required");
      expect(events.find((e) => e.event === "read_wait_end")?.endOutcome).toBe("term");
      expect((await journal.readRecoveryJournal(root, writer.journal.journalId))?.phase).toBe("write_in_progress");
    } finally { writer.write.resolve(); await writer.done; }
  });

  it("tightens the one original ticket deadline without consuming a second ticket or inventing settled wall time", async () => {
    const wallNow = Date.now();
    const decision = await questionBudget.consumePersisted("same-turn", wallNow);
    if (decision.action !== "allow" || !decision.ticket) throw new Error("original budget ticket missing");
    const ticket = decision.ticket;
    const state = questionBudget.snapshotScope(ticket.scopeKey)!;
    const originalCalls = state.calls, originalAttempts = state.attempts;
    const { ctx } = context();
    const cutoff = ctx.waitDeadlineMonoMs;
    readApi.tightenBudget(ctx, ticket, state, "settled", state.startedAt + QUESTION_BUDGET_MAX_WALL_MS + 1);
    expect(ctx.waitDeadlineMonoMs).toBe(cutoff);
    const mono = questionBudget.monoNow();
    readApi.tightenBudget(ctx, ticket, state, "elapsed", state.startedAt + QUESTION_BUDGET_MAX_WALL_MS - 7, mono);
    expect(ctx.waitDeadlineMonoMs).toBe(mono + 7);
    readApi.tightenBudget(ctx, ticket, state, "settled", wallNow);
    expect(ctx.waitDeadlineMonoMs).toBe(mono + 7);
    expect(state.calls).toBe(originalCalls); expect(state.attempts).toBe(originalAttempts);
    state.calls = 60; // The original last admitted call remains valid, not consumed twice.
    expect(ctx.budgetCurrent?.()).toBe(true);
    const shorter = context().ctx;
    readApi.tightenBudget(shorter, { ...ticket, startMonoMs: mono - 119_995 }, state, "settled", wallNow, mono);
    expect(shorter.waitDeadlineMonoMs).toBeCloseTo(mono + 5, 6);
    state.windowId = (state.windowId ?? 0) + 1;
    expect(shorter.budgetCurrent?.()).toBe(false);
  });

  it("wakes at actual files-saved while the publish owner is still pending, avoiding reload self-wait", async () => {
    const terminal = deferred();
    const writer = await normalWriter({ terminal: terminal.promise });
    const result = read(context().ctx);
    let ownerFinished = false;
    void writer.done.then(() => { ownerFinished = true; });
    try {
      for (let turn = 0; turn < 1000 && !events.some((e) => e.event === "read_wait_begin"); turn++) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      expect(events.some((e) => e.event === "read_wait_begin")).toBe(true);
      writer.write.resolve(); await writer.saved;
      expect(await result).toBeNull();
      expect(ownerFinished).toBe(false);
    } finally { terminal.resolve(); await writer.done; }
  });

  it("rechecks all WAL after the original stage and never follows a later write", async () => {
    const writer = await normalWriter({ afterSaved: async () => {
      await journal.createRecoveryJournal(root, {
        releaseId: "later-unknown", operationId: "later-unknown", actor: "admin", instanceId: "synthetic",
        targets: [{ targetPath: TARGET, identity: { connectionId: "shop", schema: "public", table: "public" }, newContent: NEW }]
      });
    } });
    const result = read(context().ctx);
    for (let turn = 0; turn < 1000 && !events.some((e) => e.event === "read_wait_begin"); turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    writer.write.resolve(); await writer.done;
    expect((await result)?.code).toBe("semantic_recovery_required");
    expect(events.filter((e) => e.event === "read_wait_begin")).toHaveLength(1);
    expect(events.find((e) => e.event === "read_wait_end")?.endOutcome).toBe("blocked");
  });

  it("does not misclassify a real WAL read snapshot as orphan when the owner finishes before matching", async () => {
    const writer = await normalWriter();
    const beforeCompletion = await journal.semanticRecoveryReadState(root, HINTS);
    expect(beforeCompletion.block?.code).toBe("semantic_recovery_required");
    writer.write.resolve(); await writer.done;
    // Deterministic scheduling: the first filesystem snapshot was read before
    // completion, but its caller resumes after the real writer has retired.
    vi.spyOn(journal, "semanticRecoveryReadState").mockResolvedValueOnce(beforeCompletion);
    expect(await read(context().ctx)).toBeNull();
    expect(events.some((e) => e.event === "read_wait_begin")).toBe(false);
  });

  it("exposes the original fixed ingress deadline even when wait begins later and its effective budget is tighter", async () => {
    const writer = await normalWriter();
    let mono = 1000;
    questionBudget.setMonoClock(() => mono);
    const { ctx } = context();
    ctx.waitDeadlineMonoMs = 19000; // An existing tighter budget, not a new 20s stage.
    mono = 1500;
    const result = read(ctx);
    for (let turn = 0; turn < 1000 && !events.some((e) => e.event === "read_wait_begin"); turn++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    try {
      const begin = events.find((e) => e.event === "read_wait_begin")!;
      expect(begin).toMatchObject({ ingressMonoMs: 1000, fixedInitialWaitDeadlineMonoMs: 21000,
        waitDeadlineMonoMs: 19000, monoMs: 1500 });
      expect(begin.fixedInitialWaitDeadlineMonoMs).not.toBe(Number(begin.monoMs) + 20000);
    } finally { writer.write.resolve(); await writer.done; }
    expect(await result).toBeNull();
    const end = events.find((e) => e.event === "read_wait_end")!;
    expect(end).toMatchObject({ ingressMonoMs: 1000, fixedInitialWaitDeadlineMonoMs: 21000,
      waitDeadlineMonoMs: 19000, endOutcome: "owner_settled" });
  });

  it("does not reopen a stale blocked snapshot after its fixed ingress eligibility expired", async () => {
    const writer = await normalWriter();
    let mono = 1000;
    questionBudget.setMonoClock(() => mono);
    const { ctx } = context();
    const blocked = await journal.semanticRecoveryReadState(root, HINTS);
    writer.write.resolve(); await writer.done;
    mono = ctx.waitDeadlineMonoMs + 1;
    vi.spyOn(journal, "semanticRecoveryReadState").mockResolvedValueOnce(blocked);
    expect((await read(ctx))?.code).toBe("semantic_recovery_required");
  });
});
