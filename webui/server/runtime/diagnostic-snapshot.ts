/**
 * P1-61 — background diagnostic snapshot for livez/readyz/health.
 *
 * Probe handlers only read the published in-memory record. Collection runs off
 * the request path: single in-flight, at most one start every 10s, 5s deadline.
 * A timed-out/failed attempt marks stale immediately without advancing
 * observedAt; the in-flight permit is held until the collector actually settles.
 */

export type DiagnosticsFreshness = "unknown" | "fresh" | "stale";

export type DiagnosticsMeta = {
  observedAt: string | null;
  ageMs: number | null;
  freshness: DiagnosticsFreshness;
};

/** Dependency payload published for /api/readyz and /api/health `data`. */
export type DiagnosticData = Record<string, unknown>;

export type DiagnosticSnapshotOptions = {
  /** Full diagnostic collect (may do file/SQLite/subprocess/network I/O). */
  collect: (signal: AbortSignal) => Promise<DiagnosticData>;
  /** Monotonic clock in ms (default: performance.now). */
  monotonicNow?: () => number;
  /** Wall clock (default: () => new Date()). */
  wallNow?: () => Date;
  /** Minimum gap between collector starts. */
  intervalMs?: number;
  /** Real outer deadline for one collect attempt. */
  deadlineMs?: number;
  /** Age after last successful collect that forces stale. */
  staleAfterMs?: number;
  /** Optional initial generation (default 0). */
  initialGeneration?: number;
};

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_DEADLINE_MS = 5_000;
const DEFAULT_STALE_AFTER_MS = 30_000;

type PublishedRecord = {
  readonly generation: number;
  readonly data: DiagnosticData;
  readonly observedAtWall: string;
  readonly observedAtMono: number;
};

export class DiagnosticSnapshotService {
  private readonly collectFn: (signal: AbortSignal) => Promise<DiagnosticData>;
  private readonly monotonicNow: () => number;
  private readonly wallNow: () => Date;
  private readonly intervalMs: number;
  private readonly deadlineMs: number;
  private readonly staleAfterMs: number;

  private generation: number;
  private published: PublishedRecord | null = null;
  /** True after a failed/timeout attempt since the last successful publish. */
  private failedSinceSuccess = false;
  private inFlight = false;
  private collectorPromise: Promise<void> | null = null;
  private lastStartMono = Number.NEGATIVE_INFINITY;
  private timer: NodeJS.Timeout | null = null;
  private closed = false;
  private closeWaiters: Array<() => void> = [];

  constructor(options: DiagnosticSnapshotOptions) {
    this.collectFn = options.collect;
    this.monotonicNow = options.monotonicNow ?? (() => performance.now());
    this.wallNow = options.wallNow ?? (() => new Date());
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.deadlineMs = options.deadlineMs ?? DEFAULT_DEADLINE_MS;
    this.staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    this.generation = options.initialGeneration ?? 0;
  }

  /** Current config/project generation used to discard late results. */
  currentGeneration(): number {
    return this.generation;
  }

  /**
   * Advance generation so in-flight results cannot publish into the new epoch.
   * Existing published data stays readable but is treated as stale until the
   * next successful collect for the new generation.
   */
  bumpGeneration(): number {
    this.generation += 1;
    this.failedSinceSuccess = true;
    return this.generation;
  }

  /** Whether a collector attempt is currently running (including past deadline). */
  isCollecting(): boolean {
    return this.inFlight;
  }

  /** Test helper: drop published data back to unknown without closing. */
  resetPublishedForTests(): void {
    this.published = null;
    this.failedSinceSuccess = false;
  }

  /**
   * Read the published memory record + freshness metadata.
   * Never starts or awaits collection.
   */
  readPublished(): { data: DiagnosticData | null; diagnostics: DiagnosticsMeta } {
    const diagnostics = this.freshnessMeta();
    if (!this.published) {
      return { data: null, diagnostics };
    }
    return { data: this.published.data, diagnostics };
  }

  /** Start periodic collection (idempotent). Fires one attempt immediately. */
  start(): void {
    if (this.closed || this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  /** Request one collect if idle and the interval gate allows it. */
  tick(): void {
    if (this.closed || this.inFlight) return;
    const now = this.monotonicNow();
    if (now - this.lastStartMono < this.intervalMs && this.lastStartMono !== Number.NEGATIVE_INFINITY) {
      return;
    }
    this.lastStartMono = now;
    this.collectorPromise = this.runCollector();
  }

  /** Force a collect ignoring the interval gate (tests / generation bump follow-up). Still single in-flight. */
  tickForce(): void {
    if (this.closed || this.inFlight) return;
    this.lastStartMono = this.monotonicNow();
    this.collectorPromise = this.runCollector();
  }

  /** Wait until the current collector (if any) has actually settled. */
  async waitUntilIdle(): Promise<void> {
    if (this.collectorPromise) await this.collectorPromise;
  }

  /**
   * Stop the interval and wait for the in-flight collector to settle.
   * Idempotent. Does not Promise.race-pretend the underlying work stopped.
   */
  async close(): Promise<void> {
    if (this.closed) {
      if (this.collectorPromise) await this.collectorPromise;
      return;
    }
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.collectorPromise) await this.collectorPromise;
    for (const resolve of this.closeWaiters) resolve();
    this.closeWaiters = [];
  }

  private freshnessMeta(): DiagnosticsMeta {
    if (!this.published) {
      return { observedAt: null, ageMs: null, freshness: "unknown" };
    }
    const ageMs = Math.max(0, Math.round(this.monotonicNow() - this.published.observedAtMono));
    const staleByAge = ageMs > this.staleAfterMs;
    const staleByFailure = this.failedSinceSuccess || this.published.generation !== this.generation;
    const freshness: DiagnosticsFreshness =
      staleByAge || staleByFailure ? "stale" : "fresh";
    return {
      observedAt: this.published.observedAtWall,
      ageMs,
      freshness
    };
  }

  private markAttemptFailure(): void {
    // Keep observedAt from the last successful publish; only flip freshness.
    this.failedSinceSuccess = true;
  }

  private async runCollector(): Promise<void> {
    this.inFlight = true;
    const generation = this.generation;
    const controller = new AbortController();
    let timedOut = false;
    const deadlineTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (generation === this.generation) this.markAttemptFailure();
    }, this.deadlineMs);

    try {
      const data = await this.collectFn(controller.signal);
      if (timedOut) {
        // Deadline already marked failure; do not publish a late success.
        return;
      }
      if (generation !== this.generation) {
        return;
      }
      if (controller.signal.aborted) {
        this.markAttemptFailure();
        return;
      }
      this.published = Object.freeze({
        generation,
        data: Object.freeze({ ...data }) as DiagnosticData,
        observedAtWall: this.wallNow().toISOString(),
        observedAtMono: this.monotonicNow()
      });
      this.failedSinceSuccess = false;
    } catch {
      if (generation === this.generation) this.markAttemptFailure();
    } finally {
      clearTimeout(deadlineTimer);
      // Permit released only after the real collect promise settled.
      this.inFlight = false;
      this.collectorPromise = null;
    }
  }
}

/** Process-wide service handle used by probe routes (set from buildServer). */
let activeService: DiagnosticSnapshotService | null = null;

export function bindDiagnosticSnapshotService(service: DiagnosticSnapshotService | null): void {
  activeService = service;
}

export function getDiagnosticSnapshotService(): DiagnosticSnapshotService | null {
  return activeService;
}

/**
 * Probe-route read: published snapshot only. Never triggers collection.
 * Returns null data when nothing has been successfully published yet.
 */
export function readPublishedDiagnosticMemory(): {
  data: DiagnosticData | null;
  diagnostics: DiagnosticsMeta;
} {
  if (!activeService) {
    return {
      data: null,
      diagnostics: { observedAt: null, ageMs: null, freshness: "unknown" }
    };
  }
  return activeService.readPublished();
}
