/**
 * P1-62 — cross-module heavy-work capacity coordinator.
 *
 * Bounds total/per-class running and waiting tickets across audit_rebuild,
 * audit_export, and schema_discovery. ProbeScheduler / live-table queues stay
 * independent and must not acquire this permit.
 *
 * Contract: docs/specs/lucy-20261119-heavy-work-capacity-control-spec.md
 */

export const WORKLOAD_CAPACITY_BUSY = "WORKLOAD_CAPACITY_BUSY";

export const HEAVY_MAX_RUNNING_TOTAL = 2;
export const HEAVY_MAX_RUNNING_PER_CLASS = 1;
export const HEAVY_MAX_WAITING = 16;
export const HEAVY_MAX_WAITING_PER_IDENTITY_CLASS = 4;
export const HEAVY_WAIT_DEADLINE_MS = 5_000;
export const HEAVY_SCHEDULE_TOLERANCE_MS = 100;
export const HEAVY_BACKGROUND_RETRY_MS = 5_000;

export type HeavyWorkClass = "audit_rebuild" | "audit_export" | "schema_discovery";

const CLASS_ORDER: readonly HeavyWorkClass[] = ["audit_rebuild", "audit_export", "schema_discovery"];

export class WorkloadCapacityBusyError extends Error {
  code = WORKLOAD_CAPACITY_BUSY;
  statusCode = 429;
  retryAfterSeconds = 1;

  constructor(message = "任务较多，请稍后重试。") {
    super(message);
    this.name = "WorkloadCapacityBusyError";
  }
}

export type HeavyWorkRunContext = {
  readonly signal: AbortSignal;
  /**
   * After the underlying operation has been accepted/started and before the
   * first await / exception exit, adapters must register the real settle
   * handle (subprocess / DB / output closed). Transaction-safe domain finality
   * alone is not settle.
   */
  registerSettle: (settle: () => Promise<void>) => void;
};

export type HeavyWorkStartedOperation<T> = {
  result: Promise<T>;
  actuallySettledAndResourcesClosed: () => Promise<void>;
};

export type HeavyWorkSubmitOptions<T> = {
  class: HeavyWorkClass;
  identity: string;
  /** At most one waiting+running ticket with this key (background rebuild pump). */
  singletonKey?: string;
  /** Remaining original module e2e budget (ms). Wait is capped to min(5s, this). */
  deadlineMs?: number;
  signal?: AbortSignal;
  revalidate?: () => void | Promise<void>;
  run: (ctx: HeavyWorkRunContext) => Promise<T> | HeavyWorkStartedOperation<T>;
};

export type HeavyClassMetrics = {
  running: number;
  waiting: number;
  oldestWaitMs: number;
  queueFull: number;
  queueTimeout: number;
  cancelPending: number;
  executionMs: number;
  queueMs: number;
};

type TaskState =
  | "waiting"
  | "running"
  | "cancel_pending"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled"
  | "rejected";

type Task = {
  id: number;
  class: HeavyWorkClass;
  identity: string;
  singletonKey?: string;
  enqueuedAt: number;
  waitDeadlineAt: number;
  state: TaskState;
  signal?: AbortSignal;
  abortHandler?: () => void;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  run: HeavyWorkSubmitOptions<unknown>["run"];
  revalidate?: () => void | Promise<void>;
  cancelRequested: boolean;
  startedAt?: number;
  timer?: NodeJS.Timeout;
  released: boolean;
  abortController: AbortController;
};

function isStartedOperation<T>(value: unknown): value is HeavyWorkStartedOperation<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "result" in value &&
    "actuallySettledAndResourcesClosed" in value &&
    typeof (value as HeavyWorkStartedOperation<T>).actuallySettledAndResourcesClosed === "function"
  );
}

function emptyMetrics(): HeavyClassMetrics {
  return {
    running: 0,
    waiting: 0,
    oldestWaitMs: 0,
    queueFull: 0,
    queueTimeout: 0,
    cancelPending: 0,
    executionMs: 0,
    queueMs: 0
  };
}

class HeavyWorkCapacityCoordinator {
  private nextId = 1;
  private readonly waiting: Task[] = [];
  private readonly running = new Map<number, Task>();
  private rrIndex = 0;
  private readonly now: () => number;
  private readonly metricsByClass: Record<HeavyWorkClass, HeavyClassMetrics> = {
    audit_rebuild: emptyMetrics(),
    audit_export: emptyMetrics(),
    schema_discovery: emptyMetrics()
  };
  private closed = false;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => performance.now());
  }

  submit<T>(options: HeavyWorkSubmitOptions<T>): Promise<T> {
    if (this.closed) return Promise.reject(new WorkloadCapacityBusyError());
    if (options.signal?.aborted) {
      return Promise.reject(Object.assign(new Error("heavy work aborted"), { code: "HEAVY_WORK_ABORTED", statusCode: 499 }));
    }

    const waitBudget = Math.min(
      HEAVY_WAIT_DEADLINE_MS,
      options.deadlineMs === undefined ? HEAVY_WAIT_DEADLINE_MS : Math.max(0, options.deadlineMs)
    );
    if (waitBudget <= 0) {
      this.metricsByClass[options.class].queueTimeout += 1;
      return Promise.reject(new WorkloadCapacityBusyError());
    }

    if (options.singletonKey) {
      const exists = [...this.waiting, ...this.running.values()].some(
        (task) => task.singletonKey === options.singletonKey && (task.state === "waiting" || task.state === "running" || task.state === "cancel_pending")
      );
      if (exists) {
        this.metricsByClass[options.class].queueFull += 1;
        return Promise.reject(new WorkloadCapacityBusyError());
      }
    }

    const identityWaiting = this.waiting.filter(
      (task) => task.class === options.class && task.identity === options.identity
    ).length;
    if (identityWaiting >= HEAVY_MAX_WAITING_PER_IDENTITY_CLASS) {
      this.metricsByClass[options.class].queueFull += 1;
      return Promise.reject(new WorkloadCapacityBusyError());
    }
    if (this.waiting.length >= HEAVY_MAX_WAITING) {
      this.metricsByClass[options.class].queueFull += 1;
      return Promise.reject(new WorkloadCapacityBusyError());
    }

    return new Promise<T>((resolve, reject) => {
      const enqueuedAt = this.now();
      const task: Task = {
        id: this.nextId++,
        class: options.class,
        identity: options.identity,
        singletonKey: options.singletonKey,
        enqueuedAt,
        waitDeadlineAt: enqueuedAt + waitBudget,
        state: "waiting",
        signal: options.signal,
        resolve: resolve as (value: unknown) => void,
        reject,
        run: options.run as HeavyWorkSubmitOptions<unknown>["run"],
        revalidate: options.revalidate,
        cancelRequested: false,
        released: false,
        abortController: new AbortController()
      };

      if (options.signal) {
        task.abortHandler = () => this.cancel(task.id);
        if (options.signal.aborted) {
          this.rejectWaiting(task, Object.assign(new Error("heavy work aborted"), { code: "HEAVY_WORK_ABORTED", statusCode: 499 }));
          return;
        }
        options.signal.addEventListener("abort", task.abortHandler, { once: true });
      }

      const remaining = task.waitDeadlineAt - this.now();
      task.timer = setTimeout(() => this.expireWaiting(task), Math.max(0, remaining + HEAVY_SCHEDULE_TOLERANCE_MS));
      task.timer.unref?.();

      this.waiting.push(task);
      this.refreshGauges();
      this.pump();
    });
  }

  cancel(taskId: number): void {
    const waitingIndex = this.waiting.findIndex((task) => task.id === taskId);
    if (waitingIndex >= 0) {
      const [task] = this.waiting.splice(waitingIndex, 1);
      this.rejectWaiting(task!, Object.assign(new Error("heavy work aborted"), { code: "HEAVY_WORK_ABORTED", statusCode: 499 }));
      this.refreshGauges();
      return;
    }
    const running = this.running.get(taskId);
    if (!running) return;
    if (running.state === "running" || running.state === "cancel_pending") {
      running.cancelRequested = true;
      running.state = "cancel_pending";
      try {
        running.abortController.abort();
      } catch {
        /* ignore */
      }
      this.refreshGauges();
    }
  }

  metrics(): Readonly<Record<HeavyWorkClass, HeavyClassMetrics>> {
    this.refreshGauges();
    return {
      audit_rebuild: { ...this.metricsByClass.audit_rebuild },
      audit_export: { ...this.metricsByClass.audit_export },
      schema_discovery: { ...this.metricsByClass.schema_discovery }
    };
  }

  /** Test/support: counts of tickets currently held (running + cancel_pending). */
  ticketCounts(): { runningTotal: number; waitingTotal: number; byClass: Record<HeavyWorkClass, { running: number; waiting: number }> } {
    const byClass = {
      audit_rebuild: { running: 0, waiting: 0 },
      audit_export: { running: 0, waiting: 0 },
      schema_discovery: { running: 0, waiting: 0 }
    };
    for (const task of this.running.values()) byClass[task.class].running += 1;
    for (const task of this.waiting) byClass[task.class].waiting += 1;
    return {
      runningTotal: this.running.size,
      waitingTotal: this.waiting.length,
      byClass
    };
  }

  resetForTests(): void {
    for (const task of [...this.waiting]) {
      if (task.timer) clearTimeout(task.timer);
      this.detachAbort(task);
    }
    this.waiting.length = 0;
    this.running.clear();
    this.rrIndex = 0;
    this.closed = false;
    for (const cls of CLASS_ORDER) this.metricsByClass[cls] = emptyMetrics();
  }

  close(): void {
    this.closed = true;
    for (const task of [...this.waiting]) {
      this.rejectWaiting(task, new WorkloadCapacityBusyError());
    }
    this.waiting.length = 0;
  }

  /**
   * P1-63 — stop scheduling and settle waiting without starting (dirty/recovery
   * facts stay with their owners). Does not wait for running tickets.
   */
  stopSchedulingForProcessDrain(): void {
    this.close();
  }

  /** P1-63 — request cancel of running tickets at drain deadline (within budget). */
  requestCancelRunningForProcessDrain(): void {
    for (const id of [...this.running.keys()]) {
      this.cancel(id);
    }
  }

  private classRunning(cls: HeavyWorkClass): number {
    // Any entry still in `running` holds a permit until settle+release removes it,
    // including SUCCEEDED/FAILED after domain finality but before resources close.
    let n = 0;
    for (const task of this.running.values()) {
      if (task.class === cls) n += 1;
    }
    return n;
  }

  private totalRunning(): number {
    return this.running.size;
  }

  private tryReserve(cls: HeavyWorkClass): boolean {
    return this.totalRunning() < HEAVY_MAX_RUNNING_TOTAL && this.classRunning(cls) < HEAVY_MAX_RUNNING_PER_CLASS;
  }

  private pickNext(): Task | undefined {
    for (let step = 0; step < CLASS_ORDER.length; step += 1) {
      const cls = CLASS_ORDER[(this.rrIndex + step) % CLASS_ORDER.length]!;
      if (!this.tryReserve(cls)) continue;
      const index = this.waiting.findIndex((task) => task.class === cls);
      if (index < 0) continue;
      const now = this.now();
      const task = this.waiting[index]!;
      // Expire with schedule tolerance: still waiting past deadline+tolerance.
      if (now > task.waitDeadlineAt + HEAVY_SCHEDULE_TOLERANCE_MS) {
        this.waiting.splice(index, 1);
        this.metricsByClass[task.class].queueTimeout += 1;
        this.rejectWaiting(task, new WorkloadCapacityBusyError());
        // Continue searching; do not advance RR for an expired slot.
        step -= 1;
        continue;
      }
      this.waiting.splice(index, 1);
      this.rrIndex = (this.rrIndex + step + 1) % CLASS_ORDER.length;
      return task;
    }
    return undefined;
  }

  private pump(): void {
    while (true) {
      const task = this.pickNext();
      if (!task) return;
      this.start(task);
    }
  }

  private start(task: Task): void {
    task.state = "running";
    task.startedAt = this.now();
    if (task.timer) {
      clearTimeout(task.timer);
      task.timer = undefined;
    }
    this.running.set(task.id, task);
    this.refreshGauges();
    void this.execute(task);
  }

  private async execute(task: Task): Promise<void> {
    let accepted = false;
    let registeredSettle: (() => Promise<void>) | undefined;
    let settle: (() => Promise<void>) | undefined;
    let resultPromise: Promise<unknown> | undefined;
    let startError: unknown;
    const queueMs = Math.max(0, (task.startedAt ?? this.now()) - task.enqueuedAt);
    this.metricsByClass[task.class].queueMs = queueMs;

    const ctx: HeavyWorkRunContext = {
      signal: task.abortController.signal,
      registerSettle: (fn) => {
        registeredSettle = fn;
      }
    };

    try {
      if (task.revalidate) await task.revalidate();
      if (task.cancelRequested || task.signal?.aborted || task.abortController.signal.aborted) {
        task.state = task.cancelRequested ? "cancelled" : "rejected";
        task.reject(Object.assign(new Error("heavy work aborted"), { code: "HEAVY_WORK_ABORTED", statusCode: 499 }));
        return;
      }
      if (this.now() > task.waitDeadlineAt + HEAVY_SCHEDULE_TOLERANCE_MS) {
        this.metricsByClass[task.class].queueTimeout += 1;
        task.state = "expired";
        task.reject(new WorkloadCapacityBusyError());
        return;
      }

      let started: Promise<unknown> | HeavyWorkStartedOperation<unknown> | undefined;
      try {
        started = task.run(ctx);
      } catch (error) {
        if (registeredSettle) {
          accepted = true;
          settle = registeredSettle;
          startError = error;
        } else {
          task.state = "rejected";
          task.reject(error);
          return;
        }
      }

      if (!startError && started !== undefined) {
        if (isStartedOperation(started)) {
          accepted = true;
          resultPromise = started.result;
          // Domain result and resource close are independent (txn-safe ≠ settle).
          settle = async () => {
            await started.actuallySettledAndResourcesClosed();
            if (registeredSettle) await registeredSettle();
          };
        } else {
          accepted = true;
          resultPromise = Promise.resolve(started);
          // Plain Promise: awaiting the result is the resource close; optional
          // registerSettle runs after. Do not re-await result in settle.
          settle = registeredSettle;
        }

        try {
          const value = await resultPromise;
          if (task.state === "cancel_pending") {
            task.state = "cancelled";
          } else {
            task.state = "succeeded";
          }
          task.resolve(value);
        } catch (error) {
          if (task.state === "cancel_pending") task.state = "cancelled";
          else task.state = "failed";
          task.reject(error);
        }
      } else if (startError) {
        task.state = "failed";
        task.reject(startError);
      }
    } catch (error) {
      if (task.state === "cancel_pending") task.state = "cancelled";
      else task.state = accepted ? "failed" : "rejected";
      task.reject(error);
    } finally {
      const executionMs = Math.max(0, this.now() - (task.startedAt ?? this.now()));
      this.metricsByClass[task.class].executionMs = executionMs;
      if (accepted) {
        const closer = settle ?? registeredSettle;
        // No closer ⇒ result await already closed resources; release synchronously
        // so the caller does not observe a leaked ticket after await submit().
        if (closer) {
          try {
            await closer();
          } catch {
            /* settle errors do not leak the permit */
          }
        }
      }
      this.release(task);
      this.pump();
    }
  }

  private expireWaiting(task: Task): void {
    const index = this.waiting.findIndex((item) => item.id === task.id);
    if (index < 0) return;
    this.waiting.splice(index, 1);
    this.metricsByClass[task.class].queueTimeout += 1;
    this.rejectWaiting(task, new WorkloadCapacityBusyError());
    this.refreshGauges();
    this.pump();
  }

  private rejectWaiting(task: Task, error: unknown): void {
    if (task.timer) clearTimeout(task.timer);
    this.detachAbort(task);
    task.state = error instanceof WorkloadCapacityBusyError ? "expired" : "cancelled";
    task.reject(error);
  }

  private release(task: Task): void {
    if (task.released) return;
    task.released = true;
    if (task.timer) clearTimeout(task.timer);
    this.detachAbort(task);
    this.running.delete(task.id);
    this.refreshGauges();
  }

  private detachAbort(task: Task): void {
    if (task.signal && task.abortHandler) {
      task.signal.removeEventListener("abort", task.abortHandler);
      task.abortHandler = undefined;
    }
  }

  private refreshGauges(): void {
    for (const cls of CLASS_ORDER) {
      const m = this.metricsByClass[cls];
      m.running = this.classRunning(cls);
      const waitingTasks = this.waiting.filter((task) => task.class === cls);
      m.waiting = waitingTasks.length;
      m.cancelPending = [...this.running.values()].filter(
        (task) => task.class === cls && task.state === "cancel_pending"
      ).length;
      if (waitingTasks.length === 0) m.oldestWaitMs = 0;
      else {
        const oldest = Math.min(...waitingTasks.map((task) => task.enqueuedAt));
        m.oldestWaitMs = Math.max(0, this.now() - oldest);
      }
    }
  }
}

let singleton = new HeavyWorkCapacityCoordinator();

export function getHeavyWorkCapacity(): HeavyWorkCapacityCoordinator {
  return singleton;
}

/** Test-only: replace the process singleton (or reset it). */
export function resetHeavyWorkCapacityForTests(options: { now?: () => number } = {}): void {
  singleton.resetForTests();
  if (options.now) singleton = new HeavyWorkCapacityCoordinator(options);
  else singleton = new HeavyWorkCapacityCoordinator();
}

export function submitHeavyWork<T>(options: HeavyWorkSubmitOptions<T>): Promise<T> {
  return singleton.submit(options);
}

export function heavyWorkMetrics(): Readonly<Record<HeavyWorkClass, HeavyClassMetrics>> {
  return singleton.metrics();
}

export function heavyWorkTicketCounts() {
  return singleton.ticketCounts();
}

/**
 * Convenience wrapper for route adapters whose result promise is also settle
 * (in-process work with no separate subprocess handle).
 */
export async function withHeavyWorkPermit<T>(
  options: Omit<HeavyWorkSubmitOptions<T>, "run"> & { run: () => Promise<T> }
): Promise<T> {
  return submitHeavyWork({
    ...options,
    run: (ctx) => {
      const result = options.run();
      const settle = () =>
        result.then(
          () => undefined,
          () => undefined
        );
      ctx.registerSettle(settle);
      return { result, actuallySettledAndResourcesClosed: settle };
    }
  });
}
