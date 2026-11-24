import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as catalogReload from "../catalog-reload.js";
import * as mcpRuntimeState from "../mcp-runtime-state.js";
import * as project from "../project.js";
import * as runtimeReload from "../admin/mcp-runtime-reload.js";
import {
  readMcpRuntimeStatus,
  type DiagnosticStepObserver,
  type ExecutionProbeResult
} from "../admin/mcp-runtime.js";
import {
  collectDiagnosticIo,
  type DiagnosticCollectorResult,
  type DiagnosticStepEvent
} from "../runtime/diagnostic-collector.js";
import { createDiagnosticStepObserver } from "../runtime/diagnostic-collector-worker.js";
import {
  OpsStepJournal,
  type OpsStepName,
  type OpsStepWriteInput
} from "../runtime/ops-step-journal.js";

const OP_ID = "ops_0123456789abcdef0123456789abcdef";
const RESULT: DiagnosticCollectorResult = {
  ktxRuntime: { ready: true, status: "ready" },
  execution: {
    status: "ok",
    lastCheckedAt: "2026-11-20T00:00:00.000Z",
    activation: "current",
    reload: { state: "idle" },
    verification: { state: "verified" }
  }
};

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeChild extends EventEmitter {
  readonly sent: unknown[] = [];
  private closed = false;

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    this.sent.push(message);
    callback?.(null);
    return true;
  }

  kill(): boolean {
    if (!this.closed) {
      this.closed = true;
      queueMicrotask(() => this.emit("close", null, "SIGKILL"));
    }
    return true;
  }

  emitStep(step: OpsStepName, phase: "enter" | "leave" | "fail", opId = OP_ID): void {
    const event: DiagnosticStepEvent = {
      type: "diagnostic-ops-step",
      op: "diagnostic_collect",
      opId,
      step,
      phase,
      ...(phase === "fail" ? { reasonCode: "unreadable" as const } : {})
    };
    this.emit("message", event);
  }

  succeed(): void {
    this.emit("message", { ok: true, data: RESULT });
    this.closed = true;
    this.emit("disconnect");
    this.emit("close", 0, null);
  }
}

function recordingJournal() {
  const writes: OpsStepWriteInput[] = [];
  const journal = {
    writeStep(input: OpsStepWriteInput) {
      writes.push({ ...input });
    }
  } as OpsStepJournal;
  return { journal, writes };
}

function startFakeCollector(
  journal: OpsStepJournal,
  signal = new AbortController().signal
) {
  const child = new FakeChild();
  const promise = collectDiagnosticIo(signal, {
    observations: [],
    ktxRuntime: { ready: true, status: "ready" }
  }, {
    fork: (() => child) as unknown as typeof fork,
    journal,
    createOpId: () => OP_ID
  });
  void promise.catch(() => undefined);
  return { child, promise };
}

function stepEvent(step: OpsStepName, phase: "enter" | "leave" | "fail"): DiagnosticStepEvent {
  return {
    type: "diagnostic-ops-step",
    op: "diagnostic_collect",
    opId: OP_ID,
    step,
    phase,
    ...(phase === "fail" ? { reasonCode: "unreadable" as const } : {})
  };
}

const temporaryRoots: string[] = [];
const realJournals: OpsStepJournal[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const journal of realJournals.splice(0)) await journal.closeForTests();
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("diagnostic collector parent protocol", () => {
  it("generates and propagates one op_id, then pairs each branch independently", async () => {
    const { journal, writes } = recordingJournal();
    const { child, promise } = startFakeCollector(journal);
    expect(child.sent[0]).toMatchObject({ opId: OP_ID });

    child.emitStep("read_project", "enter");
    child.emitStep("read_ktx_yaml", "enter");
    child.emitStep("read_project", "leave");
    child.emitStep("read_ktx_yaml", "leave");
    child.succeed();
    await expect(promise).resolves.toEqual(RESULT);

    expect(writes.map(({ opId, step, phase }) => ({ opId, step, phase }))).toEqual([
      { opId: OP_ID, step: "read_project", phase: "enter" },
      { opId: OP_ID, step: "read_ktx_yaml", phase: "enter" },
      { opId: OP_ID, step: "read_project", phase: "leave" },
      { opId: OP_ID, step: "read_ktx_yaml", phase: "leave" }
    ]);
  });

  it("acks enter after a real stdout failure without waiting for the file append", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lucy-diagnostic-ops-ack-"));
    temporaryRoots.push(root);
    const append = deferred();
    const journal = new OpsStepJournal({
      contentRoot: root,
      stdoutWriter: () => { throw new Error("stdout failed"); },
      appendFile: () => append.promise
    });
    realJournals.push(journal);
    const { child, promise } = startFakeCollector(journal);

    child.emitStep("read_project", "enter");
    await flush();
    expect(child.sent).toContainEqual({
      type: "diagnostic-ops-step-ack",
      opId: OP_ID,
      step: "read_project",
      phase: "enter"
    });
    expect(journal.read().stdoutDroppedCount).toBe(1);

    child.emitStep("read_project", "leave");
    append.resolve();
    child.succeed();
    await expect(promise).resolves.toEqual(RESULT);
  });

  it.each(["disconnect", "abort", "close"] as const)(
    "%s terminalizes only entered unresolved branches once and ignores late terminals",
    async (mode) => {
      const { journal, writes } = recordingJournal();
      const controller = new AbortController();
      const { child, promise } = startFakeCollector(journal, controller.signal);
      child.emitStep("read_project", "enter");
      child.emitStep("read_ktx_yaml", "enter");
      child.emitStep("read_project", "leave");

      if (mode === "disconnect") child.emit("disconnect");
      else if (mode === "abort") controller.abort();
      else child.emit("close", 1, null);
      await expect(promise).rejects.toThrow();

      child.emitStep("read_project", "fail");
      child.emitStep("read_ktx_yaml", "leave");
      child.emitStep("read_ktx_yaml", "fail");
      expect(writes.filter((write) => write.phase === "enter")).toHaveLength(2);
      expect(writes.filter((write) => write.phase === "leave")).toEqual([
        expect.objectContaining({ step: "read_project" })
      ]);
      expect(writes.filter((write) => write.phase === "fail")).toEqual([
        expect.objectContaining({ step: "read_ktx_yaml", reasonCode: "aborted" })
      ]);
      expect(writes.some((write) => write.step === "read_catalog_reloads")).toBe(false);
    }
  );
});

describe("diagnostic worker enter acknowledgement", () => {
  it("does not start the body until the matching op_id+step ack arrives", async () => {
    const channel = new EventEmitter() as EventEmitter & {
      send(message: unknown, callback?: (error: Error | null) => void): boolean;
    };
    const sent: unknown[] = [];
    channel.send = (message, callback) => {
      sent.push(message);
      callback?.(null);
      return true;
    };
    const observer = createDiagnosticStepObserver(OP_ID, channel);
    let bodyStarted = false;
    const running = observer.runStep("read_project", async () => {
      bodyStarted = true;
      return "project";
    });
    await flush();
    expect(sent).toEqual([stepEvent("read_project", "enter")]);
    expect(bodyStarted).toBe(false);

    channel.emit("message", {
      type: "diagnostic-ops-step-ack", opId: "ops_wrong", step: "read_project", phase: "enter"
    });
    await flush();
    expect(bodyStarted).toBe(false);
    channel.emit("message", {
      type: "diagnostic-ops-step-ack", opId: OP_ID, step: "read_project", phase: "enter"
    });
    await expect(running).resolves.toBe("project");
    expect(bodyStarted).toBe(true);
    expect(sent).toEqual([stepEvent("read_project", "enter"), stepEvent("read_project", "leave")]);
  });

  it("keeps two acknowledged bodies parallel", async () => {
    const channel = new EventEmitter() as EventEmitter & {
      send(message: unknown, callback?: (error: Error | null) => void): boolean;
    };
    channel.send = (_message, callback) => {
      callback?.(null);
      return true;
    };
    const observer = createDiagnosticStepObserver(OP_ID, channel);
    const first = deferred();
    const second = deferred();
    const started: string[] = [];
    const firstRun = observer.runStep("read_project", async () => {
      started.push("read_project");
      await first.promise;
    });
    const secondRun = observer.runStep("read_ktx_yaml", async () => {
      started.push("read_ktx_yaml");
      await second.promise;
    });
    await flush();
    expect(started).toEqual([]);
    for (const step of ["read_project", "read_ktx_yaml"] as const) {
      channel.emit("message", {
        type: "diagnostic-ops-step-ack", opId: OP_ID, step, phase: "enter"
      });
    }
    await flush();
    expect(started).toEqual(["read_project", "read_ktx_yaml"]);
    first.resolve();
    second.resolve();
    await Promise.all([firstRun, secondRun]);
  });
});

describe("readMcpRuntimeStatus diagnostic steps", () => {
  it("starts independent reads in parallel and waits for the whole group before reload state", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "lucy-diagnostic-ops-group-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n");
    const projectRead = deferred<Awaited<ReturnType<typeof project.readProject>>>();
    const digestRead = deferred<string>();
    const catalogRead = deferred<Awaited<ReturnType<typeof catalogReload.readCatalogReloads>>>();
    const probeRead = deferred<ExecutionProbeResult>();
    const readReloadState = vi.spyOn(runtimeReload, "readReloadState").mockResolvedValue({
      activation: "current",
      reload: { state: "idle" },
      verification: { state: "verified", digest: "batch-digest", checkedAt: "2026-11-20T00:00:00.000Z" }
    });
    vi.spyOn(project, "resolveProjectRoot").mockResolvedValue(root);
    vi.spyOn(project, "readProject").mockReturnValue(projectRead.promise);
    vi.spyOn(mcpRuntimeState, "readKtxYamlDigest").mockReturnValue(digestRead.promise);
    vi.spyOn(catalogReload, "readCatalogReloads").mockReturnValue(catalogRead.promise);

    const entered: OpsStepName[] = [];
    const observer: DiagnosticStepObserver = {
      async runStep<T>(step: OpsStepName, body: () => Promise<T>): Promise<T> {
        entered.push(step);
        return body();
      }
    };
    const running = readMcpRuntimeStatus(() => probeRead.promise, observer);
    await flush();
    expect(entered).toEqual([
      "read_project",
      "read_ktx_yaml",
      "read_catalog_reloads",
      "probe_execution"
    ]);

    digestRead.resolve("batch-digest");
    await flush();
    expect(readReloadState).not.toHaveBeenCalled();
    projectRead.resolve({
      root,
      connections: [],
      ktxAvailable: true,
      mcpEndpoint: {
        url: null,
        status: "fallback",
        source: "fallback",
        configured: false,
        diagnostics: []
      }
    });
    catalogRead.resolve({ runs: [], last: null, lastByConnection: {} });
    probeRead.resolve({ status: "reachable", checkedAt: "2026-11-20T00:00:00.000Z" });
    await flush();
    expect(readReloadState).toHaveBeenCalledWith(root, "batch-digest");
    await expect(running).resolves.toMatchObject({ config: { ktxYamlDigest: "batch-digest" } });
    expect(entered).toContain("read_reload_state");
  });
});
