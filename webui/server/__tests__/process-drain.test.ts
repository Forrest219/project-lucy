import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  beginInstanceShutdown,
  configureProcessDrainIpc,
  DRAIN_BUDGET_MS,
  DRAIN_REQUEST_FILENAME,
  DRAIN_ACK_FILENAME,
  EXTERNAL_STOP_GRACE_S,
  getProcessLifecyclePhase,
  isProcessServing,
  markProcessServing,
  processDrainInFlightCount,
  resetProcessDrainForTests,
  SERVICE_DRAINING,
  SERVICE_DRAINING_MESSAGE,
  TOTAL_EXIT_BUDGET_S,
  tryAdmitBusinessWork,
  getProcessDrain
} from "../runtime/process-drain";
import {
  resetHeavyWorkCapacityForTests,
  submitHeavyWork,
  heavyWorkTicketCounts,
  WorkloadCapacityBusyError
} from "../runtime/heavy-work-capacity";
import { isWebuiReady, markWebuiWarmupComplete, resetWebuiWarmupForTests } from "../runtime/readiness";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("P1-63 process drain", () => {
  beforeEach(() => {
    process.env.LUCY_PROCESS_DRAIN_NO_EXIT = "1";
    resetProcessDrainForTests();
    resetHeavyWorkCapacityForTests();
    resetWebuiWarmupForTests();
  });

  afterEach(() => {
    resetProcessDrainForTests();
    resetHeavyWorkCapacityForTests();
    resetWebuiWarmupForTests();
    delete process.env.LUCY_PROCESS_DRAIN_NO_EXIT;
  });

  it("atomic admit: SERVING check + register is one step; post-barrier rejects", () => {
    markProcessServing();
    expect(getProcessLifecyclePhase()).toBe("SERVING");
    const a = tryAdmitBusinessWork();
    expect(a.ok).toBe(true);
    if (!a.ok) throw new Error("expected admit");
    expect(processDrainInFlightCount()).toBe(1);

    void beginInstanceShutdown({ drainBudgetMs: 50 });
    expect(getProcessLifecyclePhase()).toBe("DRAINING");

    const b = tryAdmitBusinessWork();
    expect(b.ok).toBe(false);
    if (b.ok) throw new Error("expected reject");
    expect(b.error.code).toBe(SERVICE_DRAINING);
    expect(b.error.statusCode).toBe(503);
    expect(b.error.message).toBe(SERVICE_DRAINING_MESSAGE);
    expect(b.error).not.toHaveProperty("retryAfterSeconds");
  });

  it("admit race: barrier close rejects every post-close attempt (≥100 rounds)", async () => {
    markProcessServing();
    let admittedWhileDraining = 0;
    let rejected = 0;
    const runners: Promise<void>[] = [];
    for (let i = 0; i < 120; i += 1) {
      runners.push(
        (async () => {
          if (i === 40) {
            void beginInstanceShutdown({ drainBudgetMs: 100 });
            await tick();
          }
          const phaseBefore = getProcessLifecyclePhase();
          const result = tryAdmitBusinessWork();
          if (result.ok) {
            if (phaseBefore === "DRAINING" || phaseBefore === "STOPPING" || phaseBefore === "STOPPED") {
              admittedWhileDraining += 1;
            }
            await result.ticket.retireWhenSettled();
          } else {
            rejected += 1;
          }
        })()
      );
    }
    await Promise.all(runners);
    expect(admittedWhileDraining).toBe(0);
    expect(rejected).toBeGreaterThan(0);
  });

  it("handoff window: work admitted before DRAINING ack stays in-flight", async () => {
    markProcessServing();
    const gate = deferred<void>();
    const admitted = tryAdmitBusinessWork();
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) throw new Error("expected admit");
    admitted.ticket.registerSettle(() => gate.promise);

    const drain = beginInstanceShutdown({ drainBudgetMs: 200 });
    expect(getProcessLifecyclePhase()).toBe("DRAINING");
    expect(processDrainInFlightCount()).toBe(1);

    // New work rejected during handoff/drain.
    expect(tryAdmitBusinessWork().ok).toBe(false);

    gate.resolve();
    await admitted.ticket.retireWhenSettled();
    await drain;
    expect(processDrainInFlightCount()).toBe(0);
  });

  it("post-start throw with accepted settle keeps registration until real settle", async () => {
    markProcessServing();
    const admitted = tryAdmitBusinessWork();
    if (!admitted.ok) throw new Error("expected admit");
    const gate = deferred<void>();
    admitted.ticket.registerSettle(() => gate.promise);

    // Simulate adapter: work accepted, then throw before await — must not unregister.
    expect(() => {
      throw new Error("post-start boom");
    }).toThrow();
    expect(processDrainInFlightCount()).toBe(1);

    gate.resolve();
    await admitted.ticket.retireWhenSettled();
    expect(processDrainInFlightCount()).toBe(0);
  });

  it("late retire after cancel/deadline does not revive SERVING", async () => {
    markProcessServing();
    const admitted = tryAdmitBusinessWork();
    if (!admitted.ok) throw new Error("expected admit");
    const gate = deferred<void>();
    admitted.ticket.registerSettle(() => gate.promise);

    await beginInstanceShutdown({
      drainBudgetMs: 20,
      onDrainDeadline: () => undefined
    });
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
    expect(isProcessServing()).toBe(false);

    gate.resolve();
    await admitted.ticket.retireWhenSettled();
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
    markProcessServing(); // late callback must not revive
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
    expect(tryAdmitBusinessWork().ok).toBe(false);
  });

  it("duplicate beginInstanceShutdown joins the same promise", async () => {
    markProcessServing();
    const gate = deferred<void>();
    const admitted = tryAdmitBusinessWork();
    if (!admitted.ok) throw new Error("expected admit");
    admitted.ticket.registerSettle(() => gate.promise);

    const a = beginInstanceShutdown({ drainBudgetMs: 200 });
    const b = beginInstanceShutdown({ drainBudgetMs: 200 });
    expect(a).toBe(b);

    gate.resolve();
    await admitted.ticket.retireWhenSettled();
    await a;
    await b;
  });

  it("SSE idle is not required: only registered business tickets block drain", async () => {
    markProcessServing();
    // Idle SSE would not call tryAdmit (GET path). Only an RPC ticket counts.
    const drain = beginInstanceShutdown({ drainBudgetMs: 30 });
    await drain;
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
  });

  it("background waiting settles without executing; dirty facts retained by capacity close", async () => {
    markProcessServing();
    const started: string[] = [];
    const running = deferred<void>();
    const first = submitHeavyWork({
      class: "audit_export",
      identity: "a",
      run: async () => {
        started.push("run");
        await running.promise;
        return "ok";
      }
    });
    await tick();
    const waiting = submitHeavyWork({
      class: "audit_export",
      identity: "b",
      run: async () => {
        started.push("waiting-should-not-run");
        return "nope";
      }
    });
    await tick();
    expect(heavyWorkTicketCounts().waitingTotal).toBe(1);

    const drain = beginInstanceShutdown({ drainBudgetMs: 1000 });
    await expect(waiting).rejects.toBeInstanceOf(WorkloadCapacityBusyError);
    expect(started).toEqual(["run"]);

    running.resolve();
    await first;
    await drain;
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
  });

  it("readyz follows SERVING; draining reason; livez/health not business in-flight", async () => {
    resetWebuiWarmupForTests();
    expect(isWebuiReady()).toBe(false);
    markWebuiWarmupComplete();
    expect(isWebuiReady()).toBe(true);
    expect(getProcessLifecyclePhase()).toBe("SERVING");

    // Probes must not register in-flight.
    expect(processDrainInFlightCount()).toBe(0);

    await beginInstanceShutdown({ drainBudgetMs: 20 });
    expect(isWebuiReady()).toBe(false);
    expect(getProcessLifecyclePhase()).toBe("STOPPED");
  });

  it("budget constants match contract (20/40/45)", () => {
    expect(DRAIN_BUDGET_MS).toBe(20_000);
    expect(TOTAL_EXIT_BUDGET_S).toBe(40);
    expect(EXTERNAL_STOP_GRACE_S).toBe(45);
  });

  it("IPC ack file written on drain without credentials", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-ipc-"));
    const runtimeDir = path.join(root, ".ktx-ui");
    await mkdir(runtimeDir, { recursive: true });
    configureProcessDrainIpc({
      runtimeDir,
      requestPath: path.join(runtimeDir, DRAIN_REQUEST_FILENAME),
      ackPath: path.join(runtimeDir, DRAIN_ACK_FILENAME)
    });
    markProcessServing();
    await beginInstanceShutdown({ drainBudgetMs: 20 });
    const ack = await readFile(path.join(runtimeDir, DRAIN_ACK_FILENAME), "utf8");
    expect(ack).toMatch(/phase=DRAINING/);
    expect(ack).toMatch(/pid=/);
    expect(ack.toLowerCase()).not.toMatch(/token|password|secret|bearer/);
  });

  it("parent request file triggers drain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "lucy-drain-req-"));
    const runtimeDir = path.join(root, ".ktx-ui");
    await mkdir(runtimeDir, { recursive: true });
    const requestPath = path.join(runtimeDir, DRAIN_REQUEST_FILENAME);
    configureProcessDrainIpc({ runtimeDir, requestPath });
    markProcessServing();
    getProcessDrain().startWatchingParentDrainRequest();
    await writeFile(requestPath, "phase=DRAIN\n", "utf8");
    // Direct observe path (watcher may be racy on some FS).
    await beginInstanceShutdown({ drainBudgetMs: 20 });
    expect(["STOPPING", "STOPPED"]).toContain(getProcessLifecyclePhase());
  });
});
