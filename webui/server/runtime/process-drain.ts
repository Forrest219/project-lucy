/**
 * P1-63 — whole-instance process drain lifecycle.
 *
 * Parent entrypoint owns instance shutdown. Lucy Web + MCP share one memory
 * admit barrier; in-flight is real business-op settle (not HTTP close / idle SSE).
 *
 * Contract: docs/specs/lucy-20261119-process-drain-lifecycle-spec.md
 * Spec 191 §4.2.3 / §4.4: drain Lucy first, then supervisor/KTX cleanup.
 */

import { watch, type FSWatcher } from "node:fs";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { getHeavyWorkCapacity, heavyWorkTicketCounts } from "./heavy-work-capacity.js";

export type ProcessLifecyclePhase = "BOOTING" | "SERVING" | "DRAINING" | "STOPPING" | "STOPPED";

export const SERVICE_DRAINING = "SERVICE_DRAINING";
export const SERVICE_DRAINING_MESSAGE = "服务正在停止接收新请求，请在服务恢复后重试。";

/** Drain wait includes cancel notify + remaining-state record (no extra unbounded wait). */
export const DRAIN_BUDGET_MS = 20_000;
export const SUPERVISOR_CLEANUP_BUDGET_S = 10;
export const ORPHAN_CLEANUP_BUDGET_S = 5;
export const WRAP_UP_BUDGET_S = 5;
export const TOTAL_EXIT_BUDGET_S = 40;
export const EXTERNAL_STOP_GRACE_S = 45;

export const DRAIN_REQUEST_FILENAME = "lucy-process-drain.request";
export const DRAIN_ACK_FILENAME = "lucy-process-drain.ack";

export class ServiceDrainingError extends Error {
  readonly code = SERVICE_DRAINING;
  readonly statusCode = 503;

  constructor(message = SERVICE_DRAINING_MESSAGE) {
    super(message);
    this.name = "ServiceDrainingError";
  }
}

export type AdmitTicket = {
  readonly id: number;
  /**
   * After underlying work is accepted and before the first await / exception
   * exit, register the real settle handle. Post-start throw with accepted work
   * must keep the registration until this settles.
   */
  registerSettle: (settle: () => Promise<void>) => void;
  /** Retire only when the real operation settles (or immediately if none). */
  retireWhenSettled: () => Promise<void>;
};

export type AdmitResult =
  | { ok: true; ticket: AdmitTicket }
  | { ok: false; error: ServiceDrainingError };

type InFlightOp = {
  id: number;
  settle?: () => Promise<void>;
  retired: boolean;
  retirePromise?: Promise<void>;
};

export type ProcessDrainIpcPaths = {
  runtimeDir: string;
  requestPath?: string;
  ackPath?: string;
};

export type BeginShutdownOptions = {
  /** Override drain budget (tests). */
  drainBudgetMs?: number;
  /** Called after DRAINING is set (ack + stop scheduling). */
  onDraining?: () => void | Promise<void>;
  /** Request safe cancellation of remaining work at deadline (within drain budget). */
  onDrainDeadline?: () => void | Promise<void>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}

class ProcessDrainCoordinator {
  private phase: ProcessLifecyclePhase = "BOOTING";
  private nextId = 1;
  private readonly inFlight = new Map<number, InFlightOp>();
  private shutdownPromise: Promise<void> | null = null;
  private ipc: ProcessDrainIpcPaths | null = null;
  private requestWatcher: FSWatcher | null = null;
  private signalHandlersInstalled = false;
  private readonly boundSignalHandler: () => void;
  private now: () => number = () => Date.now();
  private sleep: (ms: number) => Promise<void> = defaultSleep;
  private drainWaiters: Array<() => void> = [];

  constructor() {
    this.boundSignalHandler = () => {
      void this.beginInstanceShutdown({ reason: "signal" }).then(() => {
        // Parent entrypoint owns the container exit code; Lucy exits after drain
        // so supervisor/KTX cleanup can proceed while this process is gone.
        if (process.env.VITEST === "true" || process.env.LUCY_PROCESS_DRAIN_NO_EXIT === "1") {
          return;
        }
        process.exit(0);
      });
    };
  }

  getPhase(): ProcessLifecyclePhase {
    return this.phase;
  }

  /** Ready for traffic probes: SERVING only. */
  isServing(): boolean {
    return this.phase === "SERVING";
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  /**
   * BOOTING → SERVING. Late diagnostic / listen callbacks must not revive
   * SERVING after DRAINING/STOPPING/STOPPED.
   */
  markServing(): void {
    if (this.phase === "BOOTING") {
      this.phase = "SERVING";
    }
  }

  /**
   * Atomic admit: SERVING check + in-flight register are one synchronous step.
   * BOOTING follows original startup gates (no process-drain reject / no count).
   */
  tryAdmitBusinessWork(): AdmitResult {
    if (this.phase === "BOOTING") {
      return {
        ok: true,
        ticket: {
          id: -1,
          registerSettle: () => undefined,
          retireWhenSettled: async () => undefined
        }
      };
    }
    if (this.phase !== "SERVING") {
      return { ok: false, error: new ServiceDrainingError() };
    }
    const id = this.nextId++;
    const op: InFlightOp = { id, retired: false };
    this.inFlight.set(id, op);
    const ticket: AdmitTicket = {
      id,
      registerSettle: (settle) => {
        if (op.retired) return;
        op.settle = settle;
      },
      retireWhenSettled: () => this.retireOp(op)
    };
    return { ok: true, ticket };
  }

  /**
   * Parent-owned whole-instance shutdown. Duplicate TERM/INT/EXIT join the same promise.
   */
  beginInstanceShutdown(options: BeginShutdownOptions & { reason?: string } = {}): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.shutdownPromise = this.runShutdown(options);
    return this.shutdownPromise;
  }

  isShuttingDown(): boolean {
    return this.shutdownPromise !== null;
  }

  configureIpc(paths: ProcessDrainIpcPaths): void {
    this.ipc = {
      runtimeDir: paths.runtimeDir,
      requestPath: paths.requestPath ?? path.join(paths.runtimeDir, DRAIN_REQUEST_FILENAME),
      ackPath: paths.ackPath ?? path.join(paths.runtimeDir, DRAIN_ACK_FILENAME)
    };
  }

  /** Watch parent drain request file (no credentials). */
  startWatchingParentDrainRequest(): void {
    if (!this.ipc?.requestPath || this.requestWatcher) return;
    const requestPath = this.ipc.requestPath;
    const runtimeDir = this.ipc.runtimeDir;
    try {
      this.requestWatcher = watch(runtimeDir, { persistent: false }, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name !== path.basename(requestPath) && name !== DRAIN_REQUEST_FILENAME) return;
        void this.onDrainRequestObserved();
      });
      this.requestWatcher.unref?.();
    } catch {
      /* directory may not exist yet; poll on signal path still works */
    }
    void this.onDrainRequestObserved();
  }

  installSignalHandlers(): void {
    if (this.signalHandlersInstalled) return;
    this.signalHandlersInstalled = true;
    process.on("SIGTERM", this.boundSignalHandler);
    process.on("SIGINT", this.boundSignalHandler);
  }

  removeSignalHandlersForTests(): void {
    if (!this.signalHandlersInstalled) return;
    process.off("SIGTERM", this.boundSignalHandler);
    process.off("SIGINT", this.boundSignalHandler);
    this.signalHandlersInstalled = false;
  }

  /** Test/support: wait until in-flight hits zero or timeout. */
  async waitForInFlightIdle(timeoutMs: number): Promise<{ drained: boolean; remaining: number }> {
    const deadline = this.now() + timeoutMs;
    while (this.inFlight.size > 0 && this.now() < deadline) {
      await Promise.race([
        new Promise<void>((resolve) => {
          this.drainWaiters.push(resolve);
        }),
        this.sleep(Math.min(20, Math.max(0, deadline - this.now())))
      ]);
    }
    return { drained: this.inFlight.size === 0, remaining: this.inFlight.size };
  }

  resetForTests(): void {
    this.removeSignalHandlersForTests();
    if (this.requestWatcher) {
      try {
        this.requestWatcher.close();
      } catch {
        /* ignore */
      }
      this.requestWatcher = null;
    }
    this.phase = "BOOTING";
    this.nextId = 1;
    this.inFlight.clear();
    this.shutdownPromise = null;
    this.ipc = null;
    this.drainWaiters = [];
    this.now = () => Date.now();
    this.sleep = defaultSleep;
  }

  private async onDrainRequestObserved(): Promise<void> {
    if (!this.ipc?.requestPath) return;
    try {
      await readFile(this.ipc.requestPath);
    } catch {
      return;
    }
    await this.beginInstanceShutdown({ reason: "parent-request" });
    if (process.env.VITEST === "true" || process.env.LUCY_PROCESS_DRAIN_NO_EXIT === "1") {
      return;
    }
    process.exit(0);
  }

  private async retireOp(op: InFlightOp): Promise<void> {
    if (op.retired) return op.retirePromise ?? Promise.resolve();
    op.retired = true;
    op.retirePromise = (async () => {
      if (op.settle) {
        try {
          await op.settle();
        } catch {
          /* settle errors do not re-open admission */
        }
      }
      this.inFlight.delete(op.id);
      const waiters = this.drainWaiters.splice(0, this.drainWaiters.length);
      for (const w of waiters) w();
    })();
    return op.retirePromise;
  }

  private async runShutdown(options: BeginShutdownOptions): Promise<void> {
    if (options.now) this.now = options.now;
    if (options.sleep) this.sleep = options.sleep;

    // Atomic transition to DRAINING (never back to SERVING).
    if (this.phase === "BOOTING" || this.phase === "SERVING") {
      this.phase = "DRAINING";
    } else if (this.phase === "STOPPED" || this.phase === "STOPPING") {
      return;
    }

    await this.writeDrainAck();
    // Stop new heavy scheduling; waiting not-started items settle without executing.
    // Dirty/recovery facts remain with their owners (e.g. inferred-turn dirty set).
    try {
      getHeavyWorkCapacity().stopSchedulingForProcessDrain();
    } catch {
      /* ignore */
    }

    if (options.onDraining) {
      try {
        await options.onDraining();
      } catch {
        /* ack already written; continue drain */
      }
    }

    const budget = options.drainBudgetMs ?? DRAIN_BUDGET_MS;
    const deadline = this.now() + budget;
    const hasRemaining = () => this.inFlight.size > 0 || heavyWorkTicketCounts().runningTotal > 0;
    while (hasRemaining() && this.now() < deadline) {
      const remaining = Math.max(0, deadline - this.now());
      await Promise.race([
        new Promise<void>((resolve) => {
          this.drainWaiters.push(resolve);
        }),
        this.sleep(Math.min(50, remaining))
      ]);
    }

    if (hasRemaining()) {
      try {
        getHeavyWorkCapacity().requestCancelRunningForProcessDrain();
      } catch {
        /* ignore */
      }
      if (options.onDrainDeadline) {
        try {
          await options.onDrainDeadline();
        } catch {
          /* cancel notify is best-effort within budget */
        }
      }
      // Remaining ops keep their domain outcomes; we do not fake success.
      // Late retire after STOPPING is ignored for phase (still deletes map entry).
    }

    this.phase = "STOPPING";
    // Parent stops supervisor/KTX after ack+drain; Lucy then wraps up.
    this.phase = "STOPPED";
  }

  private async writeDrainAck(): Promise<void> {
    if (!this.ipc?.ackPath || !this.ipc.runtimeDir) return;
    try {
      await mkdir(this.ipc.runtimeDir, { recursive: true });
      // Ack content: phase + pid only — never credentials.
      const body = `phase=DRAINING\npid=${process.pid}\n`;
      await writeFile(this.ipc.ackPath, body, { encoding: "utf8", mode: 0o600 });
    } catch {
      /* parent may time out waiting for ack; Lucy still drains */
    }
  }
}

let singleton = new ProcessDrainCoordinator();

export function getProcessDrain(): ProcessDrainCoordinator {
  return singleton;
}

export function getProcessLifecyclePhase(): ProcessLifecyclePhase {
  return singleton.getPhase();
}

export function markProcessServing(): void {
  singleton.markServing();
}

export function tryAdmitBusinessWork(): AdmitResult {
  return singleton.tryAdmitBusinessWork();
}

export function beginInstanceShutdown(options?: BeginShutdownOptions): Promise<void> {
  return singleton.beginInstanceShutdown(options);
}

export function configureProcessDrainIpc(paths: ProcessDrainIpcPaths): void {
  singleton.configureIpc(paths);
}

export function startWatchingParentDrainRequest(): void {
  singleton.startWatchingParentDrainRequest();
}

export function installProcessDrainSignalHandlers(): void {
  singleton.installSignalHandlers();
}

export function processDrainInFlightCount(): number {
  return singleton.inFlightCount();
}

export function isProcessServing(): boolean {
  return singleton.isServing();
}

export function isProcessShuttingDown(): boolean {
  return singleton.isShuttingDown();
}

/** Test-only: replace/reset the process singleton. */
export function resetProcessDrainForTests(): void {
  singleton.resetForTests();
  singleton = new ProcessDrainCoordinator();
}

export function drainIpcPathsForProject(projectRoot: string): ProcessDrainIpcPaths {
  const runtimeDir = path.join(projectRoot, ".ktx-ui");
  return {
    runtimeDir,
    requestPath: path.join(runtimeDir, DRAIN_REQUEST_FILENAME),
    ackPath: path.join(runtimeDir, DRAIN_ACK_FILENAME)
  };
}

/** Clear ack/request files (tests / boot hygiene). */
export async function clearDrainIpcFiles(paths: ProcessDrainIpcPaths): Promise<void> {
  for (const p of [paths.requestPath, paths.ackPath]) {
    if (!p) continue;
    try {
      await unlink(p);
    } catch {
      /* ignore */
    }
  }
}
