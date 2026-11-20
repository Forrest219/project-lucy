import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  HEAVY_BACKGROUND_RETRY_MS,
  HEAVY_MAX_RUNNING_PER_CLASS,
  HEAVY_MAX_RUNNING_TOTAL,
  HEAVY_MAX_WAITING,
  HEAVY_MAX_WAITING_PER_IDENTITY_CLASS,
  HEAVY_SCHEDULE_TOLERANCE_MS,
  HEAVY_WAIT_DEADLINE_MS,
  heavyWorkMetrics,
  heavyWorkTicketCounts,
  resetHeavyWorkCapacityForTests,
  submitHeavyWork,
  WorkloadCapacityBusyError,
  type HeavyWorkClass
} from "../runtime/heavy-work-capacity";

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
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Independent oracle — never read scheduler self-reported running alone. */
function executionCounter() {
  let active = 0;
  let peak = 0;
  let starts = 0;
  let settles = 0;
  return {
    wrap<T>(run: () => Promise<T>): () => Promise<T> {
      return async () => {
        starts += 1;
        active += 1;
        peak = Math.max(peak, active);
        try {
          return await run();
        } finally {
          active -= 1;
          settles += 1;
        }
      };
    },
    get active() {
      return active;
    },
    get peak() {
      return peak;
    },
    get starts() {
      return starts;
    },
    get settles() {
      return settles;
    }
  };
}

describe("P1-62 heavy-work capacity", () => {
  beforeEach(() => {
    resetHeavyWorkCapacityForTests();
  });

  afterEach(() => {
    resetHeavyWorkCapacityForTests();
  });

  it("bounds total running ≤2 and per-class ≤1 with independent execution counters", async () => {
    const counter = executionCounter();
    const gates = Array.from({ length: 6 }, () => deferred<string>());
    const classes: HeavyWorkClass[] = [
      "audit_rebuild",
      "audit_export",
      "schema_discovery",
      "audit_rebuild",
      "audit_export",
      "schema_discovery"
    ];
    const jobs = classes.map((cls, index) =>
      submitHeavyWork({
        class: cls,
        identity: `id-${index}`,
        run: counter.wrap(async () => {
          await gates[index]!.promise;
          return cls;
        })
      })
    );
    await tick();
    expect(counter.active).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_TOTAL);
    expect(counter.peak).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_TOTAL);
    const tickets = heavyWorkTicketCounts();
    expect(tickets.runningTotal).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_TOTAL);
    for (const cls of ["audit_rebuild", "audit_export", "schema_discovery"] as const) {
      expect(tickets.byClass[cls].running).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_PER_CLASS);
    }
    for (const gate of gates) gate.resolve("ok");
    await Promise.all(jobs);
    expect(counter.peak).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_TOTAL);
    expect(counter.starts).toBe(6);
    expect(counter.settles).toBe(6);
    expect(heavyWorkTicketCounts().runningTotal).toBe(0);
  });

  it("rejects when global waiting exceeds 16", async () => {
    const blocker = deferred();
    // Occupy both running slots.
    const running = [
      submitHeavyWork({
        class: "audit_rebuild",
        identity: "r0",
        run: async () => blocker.promise
      }),
      submitHeavyWork({
        class: "audit_export",
        identity: "r1",
        run: async () => blocker.promise
      })
    ];
    await tick();
    const queued = Array.from({ length: HEAVY_MAX_WAITING }, (_, index) =>
      submitHeavyWork({
        class: "schema_discovery",
        identity: `q-${index}`,
        run: async () => "q"
      })
    );
    await tick();
    await expect(
      submitHeavyWork({
        class: "schema_discovery",
        identity: "overflow",
        run: async () => "x"
      })
    ).rejects.toMatchObject({
      code: "WORKLOAD_CAPACITY_BUSY",
      statusCode: 429,
      retryAfterSeconds: 1,
      message: "任务较多，请稍后重试。"
    });
    expect(heavyWorkMetrics().schema_discovery.queueFull).toBeGreaterThanOrEqual(1);
    blocker.resolve();
    await Promise.all([...running, ...queued]);
  });

  it("rejects when same-identity same-class waiting exceeds 4", async () => {
    const blocker = deferred();
    const hold = submitHeavyWork({
      class: "audit_export",
      identity: "other",
      run: async () => blocker.promise
    });
    const hold2 = submitHeavyWork({
      class: "audit_rebuild",
      identity: "other2",
      run: async () => blocker.promise
    });
    await tick();
    const same = Array.from({ length: HEAVY_MAX_WAITING_PER_IDENTITY_CLASS }, (_, index) =>
      submitHeavyWork({
        class: "schema_discovery",
        identity: "same-user",
        run: async () => `s${index}`
      })
    );
    await tick();
    await expect(
      submitHeavyWork({
        class: "schema_discovery",
        identity: "same-user",
        run: async () => "overflow"
      })
    ).rejects.toBeInstanceOf(WorkloadCapacityBusyError);
    blocker.resolve();
    await Promise.all([hold, hold2, ...same]);
  });

  it("honours a short original deadline below 5s", async () => {
    const blocker = deferred();
    // Fill running so the next task waits.
    const running = [
      submitHeavyWork({ class: "audit_rebuild", identity: "hold-a", run: async () => blocker.promise }),
      submitHeavyWork({ class: "audit_export", identity: "hold-b", run: async () => blocker.promise })
    ];
    await tick();
    const started = Date.now();
    const waiting = submitHeavyWork({
      class: "schema_discovery",
      identity: "short",
      deadlineMs: 80,
      run: async () => "should-not-run"
    });
    await expect(waiting).rejects.toBeInstanceOf(WorkloadCapacityBusyError);
    expect(Date.now() - started).toBeLessThan(HEAVY_WAIT_DEADLINE_MS);
    blocker.resolve();
    await Promise.all(running);
  });

  it("round-robins classes and keeps same-class FIFO (fairness)", async () => {
    const blocker = deferred();
    const order: string[] = [];
    const hold = [
      submitHeavyWork({
        class: "audit_rebuild",
        identity: "hold1",
        run: async () => {
          order.push("hold-rebuild");
          await blocker.promise;
        }
      }),
      submitHeavyWork({
        class: "audit_export",
        identity: "hold2",
        run: async () => {
          order.push("hold-export");
          await blocker.promise;
        }
      })
    ];
    await tick();
    const queued = [
      submitHeavyWork({
        class: "audit_rebuild",
        identity: "q1",
        run: async () => {
          order.push("rebuild-old");
        }
      }),
      submitHeavyWork({
        class: "audit_rebuild",
        identity: "q2",
        run: async () => {
          order.push("rebuild-new");
        }
      }),
      submitHeavyWork({
        class: "schema_discovery",
        identity: "q3",
        run: async () => {
          order.push("discovery");
        }
      }),
      submitHeavyWork({
        class: "audit_export",
        identity: "q4",
        run: async () => {
          order.push("export");
        }
      })
    ];
    await tick();
    blocker.resolve();
    await Promise.all([...hold, ...queued]);
    // After holds release, RR should not starve discovery/export behind a rebuild flood.
    const afterHold = order.filter((item) => !item.startsWith("hold-"));
    expect(afterHold.indexOf("discovery")).toBeGreaterThanOrEqual(0);
    expect(afterHold.indexOf("export")).toBeGreaterThanOrEqual(0);
    expect(afterHold.indexOf("rebuild-old")).toBeLessThan(afterHold.indexOf("rebuild-new"));
    // Oldest other class must not sit forever behind continuous same-class work.
    expect(afterHold.indexOf("discovery")).toBeLessThan(afterHold.lastIndexOf("rebuild-new") + 1);
  });

  it("does not deadlock when dual local queues would wait on each other (atomic reserve)", async () => {
    const counter = executionCounter();
    const localA = { locked: false };
    const localB = { locked: false };
    const acquireLocal = async (slot: { locked: boolean }) => {
      const start = Date.now();
      while (slot.locked) {
        if (Date.now() - start > 200) throw new Error("local lock timeout");
        await tick();
      }
      slot.locked = true;
    };
    const releaseLocal = (slot: { locked: boolean }) => {
      slot.locked = false;
    };

    // Adapters acquire heavy permit first, then local — never hold local while waiting heavy.
    const job = async (cls: HeavyWorkClass, slot: { locked: boolean }, label: string) =>
      submitHeavyWork({
        class: cls,
        identity: label,
        run: counter.wrap(async () => {
          await acquireLocal(slot);
          try {
            await wait(5);
            return label;
          } finally {
            releaseLocal(slot);
          }
        })
      });

    const results = await Promise.all([
      job("audit_rebuild", localA, "a1"),
      job("audit_export", localB, "b1"),
      job("audit_rebuild", localA, "a2"),
      job("audit_export", localB, "b2")
    ]);
    expect(results).toEqual(["a1", "b1", "a2", "b2"]);
    expect(counter.peak).toBeLessThanOrEqual(HEAVY_MAX_RUNNING_TOTAL);
  });

  it("keeps permit on cancel until late retire / resources closed", async () => {
    const started = deferred();
    const closed = deferred();
    let activeExec = 0;
    const late = submitHeavyWork({
      class: "audit_export",
      identity: "late",
      run: () => {
        activeExec += 1;
        started.resolve();
        return {
          result: (async () => {
            await wait(20);
            return "ok";
          })(),
          actuallySettledAndResourcesClosed: async () => {
            await closed.promise;
            activeExec -= 1;
          }
        };
      }
    });
    await started.promise;
    expect(heavyWorkTicketCounts().runningTotal).toBe(1);
    // Peer class may run; same class must wait until resources close.
    const peer = submitHeavyWork({
      class: "audit_rebuild",
      identity: "peer",
      run: async () => "peer"
    });
    const sameBlockedGate = deferred();
    let sameStarted = false;
    const same = submitHeavyWork({
      class: "audit_export",
      identity: "same",
      run: async () => {
        sameStarted = true;
        await sameBlockedGate.promise;
        return "same";
      }
    });
    await tick();
    expect(sameStarted).toBe(false);
    await peer;
    closed.resolve();
    sameBlockedGate.resolve();
    await expect(late).resolves.toBe("ok");
    await same;
    expect(activeExec).toBe(0);
    expect(heavyWorkTicketCounts().runningTotal).toBe(0);
  });

  it("txn-safe domain finality does not release before process/resources exit", async () => {
    const domainFinal = deferred();
    const processExit = deferred();
    let released = false;
    const job = submitHeavyWork({
      class: "schema_discovery",
      identity: "txn",
      run: () => {
        return {
          result: (async () => {
            await domainFinal.promise;
            return "txn-safe-point";
          })(),
          actuallySettledAndResourcesClosed: () => processExit.promise
        };
      }
    });
    await tick();
    expect(heavyWorkTicketCounts().byClass.schema_discovery.running).toBe(1);
    domainFinal.resolve();
    // Caller may observe domain finality while permit is still held.
    await expect(job).resolves.toBe("txn-safe-point");
    expect(heavyWorkTicketCounts().byClass.schema_discovery.running).toBe(1);
    const blocked = submitHeavyWork({
      class: "schema_discovery",
      identity: "next",
      run: async () => {
        released = true;
        return "next";
      }
    });
    await tick();
    expect(released).toBe(false);
    processExit.resolve();
    await blocked;
    expect(released).toBe(true);
    expect(heavyWorkTicketCounts().runningTotal).toBe(0);
  });

  it("post-start throw with accepted work still waits for settle before release", async () => {
    const closed = deferred();
    let peerRan = false;
    const failing = submitHeavyWork({
      class: "audit_rebuild",
      identity: "boom",
      run: (ctx) => {
        ctx.registerSettle(() => closed.promise);
        throw new Error("accepted-but-throw");
      }
    });
    const failingCaught = failing.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error })
    );
    await tick();
    expect(heavyWorkTicketCounts().byClass.audit_rebuild.running).toBe(1);
    const peer = submitHeavyWork({
      class: "audit_rebuild",
      identity: "peer",
      run: async () => {
        peerRan = true;
        return "peer";
      }
    });
    await tick();
    expect(peerRan).toBe(false);
    closed.resolve();
    const outcome = await failingCaught;
    expect(outcome.ok).toBe(false);
    expect((outcome as { ok: false; error: Error }).error.message).toBe("accepted-but-throw");
    await peer;
    expect(peerRan).toBe(true);
  });

  it("double-release is a no-op and tickets are conserved", async () => {
    const counter = executionCounter();
    await submitHeavyWork({
      class: "audit_export",
      identity: "once",
      run: counter.wrap(async () => "ok")
    });
    expect(heavyWorkTicketCounts()).toEqual({
      runningTotal: 0,
      waitingTotal: 0,
      byClass: {
        audit_rebuild: { running: 0, waiting: 0 },
        audit_export: { running: 0, waiting: 0 },
        schema_discovery: { running: 0, waiting: 0 }
      }
    });
    expect(counter.starts).toBe(counter.settles);
  });

  it("waiting cancel settles immediately without starting work", async () => {
    const blocker = deferred();
    const hold = [
      submitHeavyWork({ class: "audit_rebuild", identity: "h1", run: async () => blocker.promise }),
      submitHeavyWork({ class: "audit_export", identity: "h2", run: async () => blocker.promise })
    ];
    await tick();
    const ac = new AbortController();
    let started = false;
    const waiting = submitHeavyWork({
      class: "schema_discovery",
      identity: "w",
      signal: ac.signal,
      run: async () => {
        started = true;
        return "nope";
      }
    });
    await tick();
    ac.abort();
    await expect(waiting).rejects.toMatchObject({ code: "HEAVY_WORK_ABORTED" });
    expect(started).toBe(false);
    blocker.resolve();
    await Promise.all(hold);
  });

  it("revalidate failure before start does not run work and releases ticket", async () => {
    await expect(
      submitHeavyWork({
        class: "audit_export",
        identity: "revoked",
        revalidate: () => {
          throw Object.assign(new Error("revoked"), { code: "ACTOR_UNRESOLVED", statusCode: 401 });
        },
        run: async () => "should-not"
      })
    ).rejects.toMatchObject({ code: "ACTOR_UNRESOLVED" });
    expect(heavyWorkTicketCounts().runningTotal).toBe(0);
  });

  it("singleton pump key allows only one background rebuild ticket", async () => {
    const blocker = deferred();
    const first = submitHeavyWork({
      class: "audit_rebuild",
      identity: "__background_pump__",
      singletonKey: "audit_rebuild_background_pump",
      run: async () => blocker.promise
    });
    await tick();
    await expect(
      submitHeavyWork({
        class: "audit_rebuild",
        identity: "__background_pump__",
        singletonKey: "audit_rebuild_background_pump",
        run: async () => "second"
      })
    ).rejects.toBeInstanceOf(WorkloadCapacityBusyError);
    blocker.resolve();
    await first;
  });

  it("nested work under one permit does not re-acquire (inherits permit)", async () => {
    const counter = executionCounter();
    await submitHeavyWork({
      class: "schema_discovery",
      identity: "batch",
      run: counter.wrap(async () => {
        // Internal shrink/retry — must not call submitHeavyWork again.
        for (let i = 0; i < 3; i += 1) {
          await tick();
        }
        return "done";
      })
    });
    expect(counter.starts).toBe(1);
    expect(heavyWorkTicketCounts().runningTotal).toBe(0);
  });

  it("default wait deadline is 5s with 100ms schedule tolerance", () => {
    expect(HEAVY_WAIT_DEADLINE_MS).toBe(5_000);
    expect(HEAVY_SCHEDULE_TOLERANCE_MS).toBe(100);
    expect(HEAVY_BACKGROUND_RETRY_MS).toBeGreaterThanOrEqual(5_000);
  });
});
