/**
 * P1-81 — stuck-state ("假活") watchdog.
 *
 * Observed in f5e4b14d: after the pressure stopped, the same process kept returning 503 for display
 * reads and timing out business queries for 134+ s while `/api/readyz` and `/api/livez` stayed 200.
 * Only a manual restart recovered it.
 *
 * Contract (Spec SC-01–SC-06):
 * - STUCK = the KTX upstream is down (the MCP probe reports `kind: "upstream"`) on every tick for the
 *   whole window W — display reads may be perfectly healthy while every query dies — OR both business
 *   probes fail on every tick for W (a thread-pool backlog alone is only ever STUCK together with
 *   a failing display read). One passing tick resets the streak (no false kills).
 * - Startup, drain and planned reload (except the one this watchdog started) are exempt.
 * - A: in place first (restart the KTX child and/or the display reconciler, whichever is failing).
 *   B: after T_A without recovery the instance reports unhealthy and asks the process to drain and
 *   exit; the supervisor (`restart: on-failure` / kubelet) replaces it.
 * - A restart circuit breaker stops a flapping instance from restarting forever.
 * - Every transition leaves an evidence event.
 */
export type StuckPhase = "normal" | "stuck" | "unhealthy";

/** `upstream` = the KTX daemon itself is not answering; `io` = only the local file-I/O pool is backlogged. */
export type ProbeOutcome = { ok: boolean; ms: number; detail?: string; kind?: "upstream" | "io" };

export type RecoverTargets = { display: boolean; mcp: boolean };

export type SelfHealEvent = {
  ts: string;
  type:
    | "stuck_detected"
    | "in_place_attempt"
    | "recovered"
    | "unhealthy"
    | "restart_requested"
    | "restart_suppressed"
    | "display_only_in_place";
  phase: StuckPhase;
  durationMs?: number;
  display?: ProbeOutcome;
  mcp?: ProbeOutcome;
  detail?: string;
};

export type StuckWatchdogConfig = {
  enabled: boolean;
  intervalMs: number;
  /** W: continuous failure (upstream down, or both probes) before STUCK. */
  windowMs: number;
  /** T_A: in-place recovery budget measured from STUCK. */
  inPlaceMs: number;
  /** Re-attempt cadence for in-place recovery while STUCK. */
  inPlaceRetryMs: number;
  probeTimeoutMs: number;
  /** Restart circuit breaker: at most this many self-heal restarts per breakerWindowMs. */
  maxRestarts: number;
  breakerWindowMs: number;
};

export type StuckWatchdogDeps = {
  now: () => number;
  /** Authenticated-equivalent display read: would the real display path serve right now? */
  probeDisplay: () => Promise<ProbeOutcome>;
  /** MCP data path: file-I/O pool latency plus the KTX upstream. */
  probeMcp: () => Promise<ProbeOutcome>;
  /** True during startup, drain, planned reload. */
  isExempt: () => boolean;
  /** In-place recovery of whichever business path is failing (KTX child and/or display reconciler). */
  inPlaceRecover: (targets: RecoverTargets) => Promise<void>;
  requestRestart: (reason: string) => void;
  record: (event: SelfHealEvent) => void;
  /** Self-heal restarts recorded inside the breaker window (from the persisted evidence). */
  recentRestartCount: (sinceMs: number) => number;
};

export const DEFAULT_STUCK_WATCHDOG_CONFIG: StuckWatchdogConfig = {
  enabled: true,
  intervalMs: 10_000,
  windowMs: 60_000,
  inPlaceMs: 120_000,
  inPlaceRetryMs: 30_000,
  probeTimeoutMs: 8_000,
  maxRestarts: 3,
  breakerWindowMs: 30 * 60_000
};

function positive(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function stuckWatchdogConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StuckWatchdogConfig {
  const d = DEFAULT_STUCK_WATCHDOG_CONFIG;
  const flag = (env.LUCY_SELF_HEAL ?? "").trim().toLowerCase();
  return {
    enabled: !["0", "off", "false", "no"].includes(flag),
    intervalMs: positive(env.LUCY_SELF_HEAL_INTERVAL_MS, d.intervalMs),
    windowMs: positive(env.LUCY_SELF_HEAL_WINDOW_MS, d.windowMs),
    inPlaceMs: positive(env.LUCY_SELF_HEAL_IN_PLACE_MS, d.inPlaceMs),
    inPlaceRetryMs: positive(env.LUCY_SELF_HEAL_IN_PLACE_RETRY_MS, d.inPlaceRetryMs),
    probeTimeoutMs: positive(env.LUCY_SELF_HEAL_PROBE_TIMEOUT_MS, d.probeTimeoutMs),
    maxRestarts: positive(env.LUCY_SELF_HEAL_MAX_RESTARTS, d.maxRestarts),
    breakerWindowMs: positive(env.LUCY_SELF_HEAL_BREAKER_WINDOW_MS, d.breakerWindowMs)
  };
}

export type StuckSnapshot = {
  enabled: boolean;
  phase: StuckPhase;
  since: string | null;
  failingForMs: number;
  lastProbe: { display: ProbeOutcome | null; mcp: ProbeOutcome | null; at: string | null };
  lastEvent: SelfHealEvent | null;
  restartSuppressed: boolean;
  /** Which path made the instance STUCK: `mcp` = KTX upstream only, `both` = display read failed too. */
  stuckDomain: "mcp" | "both" | null;
};

/** Bound a probe so a hung dependency cannot hang the watchdog itself. */
export async function runProbeWithTimeout(probe: () => Promise<ProbeOutcome>, timeoutMs: number): Promise<ProbeOutcome> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<ProbeOutcome>((resolve) => {
        timer = setTimeout(() => resolve({ ok: false, ms: Math.round(performance.now() - started), detail: `probe_timeout_${timeoutMs}ms` }), timeoutMs);
        timer.unref?.();
      })
    ]);
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - started), detail: error instanceof Error ? error.message.slice(0, 120) : "probe_error" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class StuckWatchdog {
  private phase: StuckPhase = "normal";
  private phaseSince: number | null = null;
  private failingSince: number | null = null;
  private displayOnlySince: number | null = null;
  private lastInPlaceAt: number | null = null;
  private lastDisplayOnlyAt: number | null = null;
  private restartRequested = false;
  private stuckDomain: "mcp" | "both" | null = null;
  private suppressed = false;
  private lastDisplay: ProbeOutcome | null = null;
  private lastMcp: ProbeOutcome | null = null;
  private lastProbeAt: number | null = null;
  private lastEvent: SelfHealEvent | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(private readonly config: StuckWatchdogConfig, private readonly deps: StuckWatchdogDeps) {}

  getPhase(): StuckPhase {
    return this.phase;
  }

  snapshot(): StuckSnapshot {
    const now = this.deps.now();
    return {
      enabled: this.config.enabled,
      phase: this.phase,
      since: this.phaseSince === null ? null : new Date(this.phaseSince).toISOString(),
      failingForMs: this.failingSince === null ? 0 : Math.max(0, now - this.failingSince),
      lastProbe: {
        display: this.lastDisplay,
        mcp: this.lastMcp,
        at: this.lastProbeAt === null ? null : new Date(this.lastProbeAt).toISOString()
      },
      lastEvent: this.lastEvent,
      restartSuppressed: this.suppressed,
      stuckDomain: this.phase === "normal" ? null : this.stuckDomain
    };
  }

  start(): void {
    if (!this.config.enabled || this.timer || this.stopped) return;
    const loop = async () => {
      try {
        await this.tick();
      } catch {
        /* a failing watchdog must never take the process down */
      }
      if (!this.stopped) {
        this.timer = setTimeout(() => void loop(), this.config.intervalMs);
        this.timer.unref?.();
      }
    };
    this.timer = setTimeout(() => void loop(), this.config.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emit(type: SelfHealEvent["type"], extra: Partial<SelfHealEvent> = {}): void {
    const event: SelfHealEvent = {
      ts: new Date(this.deps.now()).toISOString(),
      type,
      phase: this.phase,
      display: this.lastDisplay ?? undefined,
      mcp: this.lastMcp ?? undefined,
      ...extra
    };
    this.lastEvent = event;
    try {
      this.deps.record(event);
    } catch {
      /* evidence is best effort; never block recovery */
    }
  }

  private resetStreaks(): void {
    this.failingSince = null;
    this.displayOnlySince = null;
  }

  /** One observation. Exposed for deterministic tests. */
  async tick(): Promise<void> {
    if (!this.config.enabled) return;
    const now = this.deps.now();
    if (this.deps.isExempt()) {
      this.resetStreaks();
      if (this.phase !== "normal" && !this.restartRequested) this.setPhase("normal", now);
      return;
    }
    const [display, mcp] = await Promise.all([
      runProbeWithTimeout(this.deps.probeDisplay, this.config.probeTimeoutMs),
      runProbeWithTimeout(this.deps.probeMcp, this.config.probeTimeoutMs)
    ]);
    this.lastDisplay = display;
    this.lastMcp = mcp;
    this.lastProbeAt = this.deps.now();
    const at = this.deps.now();

    const bothDown = !display.ok && !mcp.ok;
    const upstreamDown = !mcp.ok && mcp.kind === "upstream";
    if (!bothDown && !upstreamDown) {
      // No STUCK signal this tick (a passing probe, or only a local I/O backlog): never a false kill.
      this.failingSince = null;
      if (this.phase !== "normal") {
        const durationMs = this.phaseSince === null ? 0 : at - this.phaseSince;
        const wasUnhealthy = this.phase === "unhealthy";
        this.setPhase("normal", at);
        this.suppressed = false;
        this.emit("recovered", { durationMs, detail: wasUnhealthy ? "after_unhealthy" : "in_place" });
      }
      await this.handleDisplayOnly(display, at);
      return;
    }

    this.displayOnlySince = null;
    this.failingSince ??= at;
    const failingFor = at - this.failingSince;
    const targets: RecoverTargets = { display: !display.ok, mcp: !mcp.ok };
    if (this.phase === "normal" && failingFor >= this.config.windowMs) {
      this.stuckDomain = display.ok ? "mcp" : "both";
      this.setPhase("stuck", at);
      this.emit("stuck_detected", { durationMs: failingFor, detail: `domain:${this.stuckDomain}` });
      await this.attemptInPlace(at, targets);
      return;
    }
    if (this.phase === "stuck") {
      if (at - (this.phaseSince ?? at) >= this.config.inPlaceMs) {
        this.setPhase("unhealthy", at);
        this.emit("unhealthy", { durationMs: failingFor });
        this.requestRestartOnce(at);
        return;
      }
      if (this.lastInPlaceAt === null || at - this.lastInPlaceAt >= this.config.inPlaceRetryMs) await this.attemptInPlace(at, targets);
      return;
    }
    if (this.phase === "unhealthy") this.requestRestartOnce(at);
  }

  private setPhase(phase: StuckPhase, at: number): void {
    this.phase = phase;
    this.phaseSince = phase === "normal" ? null : at;
    if (phase === "normal") {
      this.restartRequested = false;
      this.lastInPlaceAt = null;
    }
  }

  private async attemptInPlace(at: number, targets: RecoverTargets): Promise<void> {
    this.lastInPlaceAt = at;
    this.emit("in_place_attempt", { detail: `targets:${targets.mcp ? "mcp" : ""}${targets.mcp && targets.display ? "+" : ""}${targets.display ? "display" : ""}` });
    try {
      await this.deps.inPlaceRecover(targets);
    } catch (error) {
      this.emit("in_place_attempt", { detail: `failed:${error instanceof Error ? error.message.slice(0, 120) : "error"}` });
    }
  }

  /** Display alone failing for W: restart the reconciler only. The process is NOT a restart candidate. */
  private async handleDisplayOnly(display: ProbeOutcome, at: number): Promise<void> {
    if (display.ok) {
      this.displayOnlySince = null;
      return;
    }
    this.displayOnlySince ??= at;
    if (at - this.displayOnlySince < this.config.windowMs) return;
    if (this.lastDisplayOnlyAt !== null && at - this.lastDisplayOnlyAt < this.config.inPlaceRetryMs) return;
    this.lastDisplayOnlyAt = at;
    this.emit("display_only_in_place", { durationMs: at - this.displayOnlySince });
    try {
      await this.deps.inPlaceRecover({ display: true, mcp: false });
    } catch {
      /* recorded by the probe on the next tick */
    }
  }

  private requestRestartOnce(at: number): void {
    if (this.restartRequested) return;
    const recent = this.deps.recentRestartCount(at - this.config.breakerWindowMs);
    if (recent >= this.config.maxRestarts) {
      if (!this.suppressed) this.emit("restart_suppressed", { detail: `breaker:${recent}/${this.config.maxRestarts}` });
      this.suppressed = true;
      return;
    }
    this.restartRequested = true;
    this.emit("restart_requested", { durationMs: this.phaseSince === null ? 0 : at - this.phaseSince, detail: "stuck_no_recovery" });
    this.deps.requestRestart("stuck_no_recovery");
  }
}
