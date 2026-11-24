import { describe, expect, it } from "vitest";
import { createLatestCoalescer } from "../runtime/latest-coalescer";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("createLatestCoalescer (P1-82)", () => {
  it("collapses 20 concurrent callers into one running run plus one follow-up", async () => {
    const gates: Array<ReturnType<typeof deferred<number>>> = [];
    let runs = 0;
    const call = createLatestCoalescer((_key: string) => {
      runs += 1;
      const gate = deferred<number>();
      gates.push(gate);
      return gate.promise;
    });
    const first = call("a");
    await Promise.resolve();
    const followers = Array.from({ length: 19 }, () => call("a"));
    await Promise.resolve();
    expect(runs).toBe(1);
    gates[0]!.resolve(1);
    expect(await first).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(runs).toBe(2);
    gates[1]!.resolve(2);
    expect(await Promise.all(followers)).toEqual(Array(19).fill(2));
    expect(runs).toBe(2);
  });

  it("never returns a result from a run that started before the call (no stale window)", async () => {
    let disk = "v1";
    const gates: Array<ReturnType<typeof deferred<string>>> = [];
    const call = createLatestCoalescer((_key: string) => {
      const observedAtStart = disk;
      const gate = deferred<string>();
      gates.push(gate);
      return gate.promise.then(() => observedAtStart);
    });
    const early = call("a");
    await Promise.resolve();
    disk = "v2"; // a write completes after the first run started
    const late = call("a");
    gates[0]!.resolve("");
    expect(await early).toBe("v1");
    await Promise.resolve();
    await Promise.resolve();
    gates[1]!.resolve("");
    expect(await late).toBe("v2");
  });

  it("keeps keys independent and drops idle slots", async () => {
    let runs = 0;
    const call = createLatestCoalescer(async (key: string) => { runs += 1; return key; });
    expect(await Promise.all([call("a"), call("b")])).toEqual(["a", "b"]);
    expect(runs).toBe(2);
    expect(await call("a")).toBe("a");
    expect(runs).toBe(3);
  });

  it("propagates a failed run to its callers without poisoning the next run", async () => {
    let attempt = 0;
    const call = createLatestCoalescer(async (_key: string) => {
      attempt += 1;
      if (attempt === 1) throw new Error("boom");
      return "ok";
    });
    await expect(call("a")).rejects.toThrow("boom");
    expect(await call("a")).toBe("ok");
  });
});
