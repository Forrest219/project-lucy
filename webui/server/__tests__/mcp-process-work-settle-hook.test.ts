import { EventEmitter } from "node:events";
import type { ClientRequest, ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { admitMcpProcessWork, onMcpWorkSettled, resetMcpReloadWorkForTests, trackMcpUpstreamWork } from "../runtime/mcp-process-work";
import { markProcessServing, resetProcessDrainForTests } from "../runtime/process-drain";

beforeEach(() => {
  resetProcessDrainForTests();
  resetMcpReloadWorkForTests();
  markProcessServing();
});
afterEach(() => {
  resetProcessDrainForTests();
  resetMcpReloadWorkForTests();
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe("onMcpWorkSettled (P1-82 SC-05)", () => {
  it("does not fire on downstream close while upstream work is still running; fires after upstream close", async () => {
    const res = new EventEmitter() as unknown as ServerResponse;
    const admitted = admitMcpProcessWork(res);
    if (!admitted.ok) throw new Error("not admitted");
    const upstream = new EventEmitter();
    let fired = 0;
    const finished = admitted.run(async () => {
      expect(onMcpWorkSettled(() => { fired += 1; })).toBe(true);
      trackMcpUpstreamWork(upstream as unknown as ClientRequest);
      res.emit("close"); // client went away
    });
    await tick();
    expect(fired).toBe(0);
    upstream.emit("close"); // the database work really ended
    await finished;
    expect(fired).toBe(1);
  });

  it("fires once on a handler that throws, and a throwing hook cannot wedge the RPC", async () => {
    const res = new EventEmitter() as unknown as ServerResponse;
    const admitted = admitMcpProcessWork(res);
    if (!admitted.ok) throw new Error("not admitted");
    let fired = 0;
    const finished = admitted.run(async () => {
      onMcpWorkSettled(() => { throw new Error("hook boom"); });
      onMcpWorkSettled(() => { fired += 1; });
      queueMicrotask(() => res.emit("finish"));
      throw new Error("handler failed");
    }).catch((error: Error) => error.message);
    expect(await finished).toBe("handler failed");
    expect(fired).toBe(1);
  });

  it("tells the hook whether an upstream request was ever started", async () => {
    const seen: boolean[] = [];
    for (const startUpstream of [false, true]) {
      const res = new EventEmitter() as unknown as ServerResponse;
      const admitted = admitMcpProcessWork(res);
      if (!admitted.ok) throw new Error("not admitted");
      const upstream = new EventEmitter();
      const finished = admitted.run(async () => {
        onMcpWorkSettled((info) => { seen.push(info.upstreamStarted); });
        if (startUpstream) trackMcpUpstreamWork(upstream as unknown as ClientRequest);
        queueMicrotask(() => { upstream.emit("close"); res.emit("finish"); });
      });
      await finished;
    }
    expect(seen).toEqual([false, true]);
  });

  it("returns false outside an accepted RPC so callers keep their own release path", () => {
    expect(onMcpWorkSettled(() => undefined)).toBe(false);
  });
});
