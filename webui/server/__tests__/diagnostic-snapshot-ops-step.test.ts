import { describe, expect, it } from "vitest";
import {
  DiagnosticSnapshotService,
  type DiagnosticSnapshotUatTrigger
} from "../runtime/diagnostic-snapshot.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

describe("DiagnosticSnapshotService UAT hooks", () => {
  it("passes the UAT trigger to the collector and refuses a second concurrent collect", async () => {
    const gate = deferred<Record<string, unknown>>();
    const triggers: Array<DiagnosticSnapshotUatTrigger | undefined> = [];
    const service = new DiagnosticSnapshotService({
      collect: async (_signal, trigger) => {
        triggers.push(trigger);
        return gate.promise;
      }
    });
    const trigger: DiagnosticSnapshotUatTrigger = {
      opId: "ops_0123456789abcdef0123456789abcdef",
      steps: ["read_project"],
      holdMs: 10
    };
    expect(service.tickForceForUat(trigger)).toBe(true);
    expect(service.tickForceForUat(trigger)).toBe(false);
    expect(service.isCollecting()).toBe(true);
    gate.resolve({ status: "ok" });
    await service.waitUntilIdle();
    expect(triggers).toEqual([trigger]);
    expect(service.isCollecting()).toBe(false);
    await service.close();
  });

  it("pauses and resumes only the periodic timer without aborting the current collect", async () => {
    const gate = deferred<Record<string, unknown>>();
    let aborted = false;
    const service = new DiagnosticSnapshotService({
      collect: async (signal) => {
        signal.addEventListener("abort", () => { aborted = true; });
        return gate.promise;
      }
    });
    service.start();
    expect(service.isBackgroundEnabled()).toBe(true);
    service.tickForce();
    expect(service.isCollecting()).toBe(true);
    service.setBackgroundEnabledForUat(false);
    expect(service.isBackgroundEnabled()).toBe(false);
    expect(aborted).toBe(false);
    gate.resolve({ status: "ok" });
    await service.waitUntilIdle();
    service.setBackgroundEnabledForUat(true);
    expect(service.isBackgroundEnabled()).toBe(true);
    await service.close();
  });
});
