import { describe, expect, it } from "vitest";
import { createSharedPriorityScheduler } from "../runtime/shared-priority-scheduler";

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => { open = resolve; });
  return { promise, open };
}

describe("createSharedPriorityScheduler (P1-81)", () => {
  it("never lets endless high-priority work starve a waiting normal job", async () => {
    const scheduler = createSharedPriorityScheduler({ concurrency: 1, maxConsecutiveHigh: 2 });
    const order: string[] = [];
    const blocker = gate();
    const first = scheduler.run(async () => { await blocker.promise; order.push("h0"); }, "high");
    const queued: Array<Promise<void>> = [];
    for (let i = 1; i <= 6; i += 1) queued.push(scheduler.run(async () => { order.push(`h${i}`); }, "high"));
    queued.push(scheduler.run(async () => { order.push("n1"); }, "normal"));
    queued.push(scheduler.run(async () => { order.push("n2"); }, "normal"));
    blocker.open();
    await Promise.all([first, ...queued]);
    expect(order.indexOf("n1")).toBeLessThanOrEqual(3);
    expect(order.indexOf("n2")).toBeLessThanOrEqual(6);
    expect(order.slice(0, 1)).toEqual(["h0"]);
    expect(scheduler.stats().normalShareDispatches).toBeGreaterThan(0);
  });

  it("keeps high priority first when no normal work waits and honours the concurrency bound", async () => {
    const scheduler = createSharedPriorityScheduler({ concurrency: 2, maxConsecutiveHigh: 2 });
    let running = 0;
    let maxRunning = 0;
    const jobs = Array.from({ length: 10 }, () => scheduler.run(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      running -= 1;
    }, "high"));
    await Promise.all(jobs);
    expect(maxRunning).toBe(2);
    expect(scheduler.stats()).toMatchObject({ active: 0, queuedHigh: 0, queuedNormal: 0, peak: 2 });
  });

  it("releases the slot when a job throws synchronously or rejects", async () => {
    const scheduler = createSharedPriorityScheduler({ concurrency: 1, maxConsecutiveHigh: 2 });
    await expect(scheduler.run((() => { throw new Error("sync"); }) as () => Promise<void>, "high")).rejects.toThrow("sync");
    await expect(scheduler.run(async () => { throw new Error("async"); }, "normal")).rejects.toThrow("async");
    expect(await scheduler.run(async () => "ok", "high")).toBe("ok");
    expect(scheduler.stats().active).toBe(0);
  });
});
