/**
 * Spec 174 §5 — bounded scheduler for KTX connectivity / live-schemas probes.
 *
 * One process-wide queue: at most 2 probe commands run at once, at most 64
 * distinct queued keys, 60 s queue deadline. Identical (generation, connection,
 * kind) keys share one execution; each subscriber has its own AbortSignal and
 * cancelling one never fails the others. Manual probes jump ahead of automatic
 * ones, but after 3 consecutive manual starts the oldest automatic task runs.
 * A permit is only released when the underlying command settles (the KTX
 * child process has exited), so a timed-out HTTP response never lets a third
 * process start. Stale-generation results never reach the new configuration.
 * Normal data Q&A never goes through this queue.
 */
export const PROBE_QUEUE_FULL = "PROBE_QUEUE_FULL";
export const PROBE_CONCURRENCY = 2;
export const PROBE_MAX_QUEUED = 64;
export const PROBE_QUEUE_TIMEOUT_MS = 60_000;
const MAX_CONSECUTIVE_MANUAL = 3;

export type ProbeKind = "test" | "live-schemas";
export type ProbePurpose = "automatic" | "manual";

export class ProbeQueueFullError extends Error {
  code = PROBE_QUEUE_FULL;
  statusCode = 503;
  retryAfterSeconds = 1;

  constructor() {
    super("连通探测请求较多，请稍后重试。");
    this.name = "ProbeQueueFullError";
  }
}

export class ProbeAbortedError extends Error {
  code = "PROBE_ABORTED";
  statusCode = 499;

  constructor() {
    super("probe request aborted");
    this.name = "ProbeAbortedError";
  }
}

export type ProbeTiming = { queueMs: number; executionMs: number; totalMs: number; shared: boolean };

type Subscriber<T> = {
  resolve: (value: { value: T; timing: ProbeTiming }) => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  submittedAt: number;
  joinedRunning: boolean;
};

type Task<T> = {
  key: string;
  generation: number;
  purpose: ProbePurpose;
  run: () => Promise<T>;
  subscribers: Set<Subscriber<T>>;
  state: "queued" | "running";
  enqueuedAt: number;
  startedAt?: number;
  timer?: NodeJS.Timeout;
};

export type ProbeSubmit<T> = {
  key: string;
  generation: number;
  purpose: ProbePurpose;
  run: () => Promise<T>;
  signal?: AbortSignal;
};

export type ProbeSchedulerOptions = {
  concurrency?: number;
  maxQueued?: number;
  queueTimeoutMs?: number;
  now?: () => number;
  currentGeneration?: () => number;
};

export class ProbeScheduler {
  private readonly concurrency: number;
  private readonly maxQueued: number;
  private readonly queueTimeoutMs: number;
  private readonly now: () => number;
  private readonly currentGeneration: () => number;
  private readonly queued: Task<unknown>[] = [];
  private readonly running = new Map<string, Task<unknown>>();
  private consecutiveManual = 0;
  private closed = false;
  peakRunning = 0;
  peakQueued = 0;

  constructor(options: ProbeSchedulerOptions = {}) {
    this.concurrency = options.concurrency ?? PROBE_CONCURRENCY;
    this.maxQueued = options.maxQueued ?? PROBE_MAX_QUEUED;
    this.queueTimeoutMs = options.queueTimeoutMs ?? PROBE_QUEUE_TIMEOUT_MS;
    this.now = options.now ?? (() => performance.now());
    this.currentGeneration = options.currentGeneration ?? (() => 0);
  }

  submit<T>(request: ProbeSubmit<T>): Promise<{ value: T; timing: ProbeTiming }> {
    if (this.closed) return Promise.reject(new ProbeQueueFullError());
    if (request.signal?.aborted) return Promise.reject(new ProbeAbortedError());
    const existing = (this.running.get(request.key) ?? this.queued.find((task) => task.key === request.key)) as Task<T> | undefined;
    return new Promise((resolve, reject) => {
      const subscriber: Subscriber<T> = { resolve, reject, signal: request.signal, submittedAt: this.now(), joinedRunning: false };
      let task = existing;
      if (task) {
        subscriber.joinedRunning = task.state === "running";
        if (request.purpose === "manual" && task.purpose === "automatic" && task.state === "queued") {
          task.purpose = "manual";
        }
      } else {
        if (this.queued.length >= this.maxQueued) {
          reject(new ProbeQueueFullError());
          return;
        }
        task = {
          key: request.key,
          generation: request.generation,
          purpose: request.purpose,
          run: request.run,
          subscribers: new Set(),
          state: "queued",
          enqueuedAt: this.now()
        };
        const queuedTask = task;
        queuedTask.timer = setTimeout(() => this.expire(queuedTask as Task<unknown>), this.queueTimeoutMs);
        queuedTask.timer.unref?.();
        this.queued.push(queuedTask as Task<unknown>);
        this.peakQueued = Math.max(this.peakQueued, this.queued.length);
      }
      task.subscribers.add(subscriber);
      if (request.signal) {
        const owner = task as unknown as Task<unknown>;
        subscriber.onAbort = () => this.unsubscribe(owner, subscriber as Subscriber<unknown>);
        request.signal.addEventListener("abort", subscriber.onAbort, { once: true });
      }
      this.pump();
    });
  }

  /** Configuration changed: cancel unstarted older tasks (settled as retryable). */
  invalidateGeneration(): void {
    const generation = this.currentGeneration();
    for (const task of [...this.queued]) {
      if (task.generation !== generation) this.dropQueued(task, new ProbeQueueFullError());
    }
  }

  stats() {
    return { running: this.running.size, queued: this.queued.length, peakRunning: this.peakRunning, peakQueued: this.peakQueued };
  }

  close(): void {
    this.closed = true;
    for (const task of [...this.queued]) this.dropQueued(task, new ProbeQueueFullError());
  }

  private pickNext(): Task<unknown> | undefined {
    const manualIndex = this.queued.findIndex((task) => task.purpose === "manual");
    const automaticIndex = this.queued.findIndex((task) => task.purpose === "automatic");
    let index = manualIndex >= 0 ? manualIndex : automaticIndex;
    if (manualIndex >= 0 && automaticIndex >= 0 && this.consecutiveManual >= MAX_CONSECUTIVE_MANUAL) index = automaticIndex;
    if (index < 0) return undefined;
    const [task] = this.queued.splice(index, 1);
    this.consecutiveManual = task!.purpose === "manual" ? this.consecutiveManual + 1 : 0;
    return task;
  }

  private pump(): void {
    while (this.running.size < this.concurrency) {
      const task = this.pickNext();
      if (!task) return;
      if (task.timer) clearTimeout(task.timer);
      if (task.subscribers.size === 0) continue;
      this.start(task);
    }
  }

  private start(task: Task<unknown>): void {
    task.state = "running";
    task.startedAt = this.now();
    this.running.set(task.key, task);
    this.peakRunning = Math.max(this.peakRunning, this.running.size);
    let outcome: { ok: true; value: unknown } | { ok: false; error: unknown };
    void Promise.resolve()
      .then(() => task.run())
      .then(
        (value) => {
          outcome = { ok: true, value };
        },
        (error) => {
          outcome = { ok: false, error };
        }
      )
      .finally(() => {
        // The command has settled (child exited): only now release the permit.
        this.running.delete(task.key);
        const finishedAt = this.now();
        const stale = task.generation !== this.currentGeneration();
        for (const subscriber of task.subscribers) this.settle(task, subscriber, outcome, finishedAt, stale);
        task.subscribers.clear();
        this.pump();
      });
  }

  private settle(
    task: Task<unknown>,
    subscriber: Subscriber<unknown>,
    outcome: { ok: true; value: unknown } | { ok: false; error: unknown },
    finishedAt: number,
    stale: boolean
  ): void {
    if (subscriber.onAbort) subscriber.signal?.removeEventListener("abort", subscriber.onAbort);
    if (stale) {
      subscriber.reject(new ProbeQueueFullError());
      return;
    }
    if (!outcome.ok) {
      subscriber.reject(outcome.error);
      return;
    }
    const startedAt = task.startedAt ?? finishedAt;
    subscriber.resolve({
      value: outcome.value,
      timing: {
        queueMs: Math.max(0, startedAt - subscriber.submittedAt),
        executionMs: finishedAt - startedAt,
        totalMs: finishedAt - subscriber.submittedAt,
        shared: subscriber.joinedRunning || task.subscribers.size > 1
      }
    });
  }

  private unsubscribe(task: Task<unknown>, subscriber: Subscriber<unknown>): void {
    if (!task.subscribers.delete(subscriber)) return;
    subscriber.reject(new ProbeAbortedError());
    // Unstarted work nobody waits for is dropped; running work keeps going for other subscribers.
    if (task.state === "queued" && task.subscribers.size === 0) this.dropQueued(task, null);
  }

  private expire(task: Task<unknown>): void {
    if (task.state === "queued") this.dropQueued(task, new ProbeQueueFullError());
  }

  private dropQueued(task: Task<unknown>, error: unknown): void {
    const index = this.queued.indexOf(task);
    if (index >= 0) this.queued.splice(index, 1);
    if (task.timer) clearTimeout(task.timer);
    if (error) {
      for (const subscriber of task.subscribers) {
        if (subscriber.onAbort) subscriber.signal?.removeEventListener("abort", subscriber.onAbort);
        subscriber.reject(error);
      }
    }
    task.subscribers.clear();
  }
}

export function parseProbePurpose(value: unknown): ProbePurpose | null {
  if (value === undefined || value === null || value === "") return "manual";
  return value === "automatic" || value === "manual" ? value : null;
}
