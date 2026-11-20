import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import * as work from "../runtime/mcp-process-work.js";
import { markProcessServing, resetProcessDrainForTests, beginInstanceShutdown, getProcessLifecyclePhase } from "../runtime/process-drain.js";

afterEach(() => { work.resetMcpReloadWorkForTests(); resetProcessDrainForTests(); });

describe("P1-69 reversible reload admission uses actual MCP work", () => {
  it("rejects 100 new RPCs while preserving the one already admitted", async () => {
    markProcessServing();
    const response = new EventEmitter() as ServerResponse;
    const admitted = work.admitMcpProcessWork(response);
    if (!admitted.ok) throw admitted.error;
    let finish!: () => void;
    const handler = new Promise<void>((resolve) => { finish = resolve; });
    const running = admitted.run(async () => handler);
    const lease = work.acquireMcpReloadWindow("reload-1", Date.now() + 1_000);
    expect(work.mcpRpcInFlightCount()).toBe(1);
    for (let n = 0; n < 100; n++) {
      const denied = work.admitMcpProcessWork(new EventEmitter() as ServerResponse);
      expect(denied.ok).toBe(false);
      if (!denied.ok) {
        expect(denied.error.code).toBe("EXECUTION_RUNTIME_RELOADING");
        if ("rejectedAt" in denied.error) {
          expect(denied.error.requestId).toBe("reload-1");
          expect(denied.error.rejectedAt).toBeGreaterThanOrEqual(Date.parse(work.currentMcpReloadWindow()!.acquiredAt));
          expect(denied.error.rejectedAt).toBeLessThanOrEqual(denied.error.deadlineAt!);
        }
      }
    }
    expect(await lease.waitForIdle(10)).toBe(false);
    finish(); response.emit("finish"); await running;
    expect(await lease.waitForIdle(50)).toBe(true);
    lease.release();
    expect(work.currentMcpReloadWindow()).toBeNull();
  });

  it("holds admission until actual upstream close even after client disconnect", async () => {
    markProcessServing();
    const response = new EventEmitter() as ServerResponse;
    const upstream = new EventEmitter() as Parameters<typeof work.trackMcpUpstreamWork>[0];
    const admitted = work.admitMcpProcessWork(response);
    if (!admitted.ok) throw admitted.error;
    const running = admitted.run(async () => { work.trackMcpUpstreamWork(upstream); });
    response.emit("close");
    const lease = work.acquireMcpReloadWindow("reload-close", Date.now() + 1_000);
    expect(await lease.waitForIdle(10)).toBe(false);
    upstream.emit("close"); await running;
    expect(await lease.waitForIdle(50)).toBe(true);
    lease.release();
  });

  it("does not mutate the irreversible TERM phase when releasing a reload lease", async () => {
    markProcessServing();
    const lease = work.acquireMcpReloadWindow("reload-term", Date.now() + 1_000);
    await beginInstanceShutdown({ drainBudgetMs: 1 });
    lease.release();
    expect(getProcessLifecyclePhase()).not.toBe("SERVING");
    expect(() => work.acquireMcpReloadWindow("late-reload", Date.now() + 1_000)).toThrow(/停止|drain/i);
  });
});
