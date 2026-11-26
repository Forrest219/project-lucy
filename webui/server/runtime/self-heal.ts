/**
 * P1-81 — production wiring for the stuck-state watchdog.
 *
 * The decision logic lives in `stuck-watchdog.ts` (pure, clock-injected). This file only connects
 * it to the real display read path, the MCP data path, the drain lifecycle and the evidence file.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { displayReadServable, startDisplayReconciler } from "../display-snapshot.js";
import { peekExecutionProbe } from "../admin/mcp-runtime.js";
import { currentMcpReloadWindow } from "./mcp-process-work.js";
import { beginInstanceShutdown, getProcessLifecyclePhase } from "./process-drain.js";
import { isWebuiReady } from "./readiness.js";
import { upstreamRespondedWithin } from "./upstream-liveness.js";
import {
  StuckWatchdog,
  stuckWatchdogConfigFromEnv,
  type ProbeOutcome,
  type SelfHealEvent,
  type StuckSnapshot,
  type StuckWatchdogConfig
} from "./stuck-watchdog.js";

export const SELF_HEAL_EVENTS_FILENAME = "self-heal-events.jsonl";
/** Non-zero so `restart: on-failure` (Docker) and kubelet both replace the instance. EX_TEMPFAIL. */
export const SELF_HEAL_EXIT_CODE = 75;
/** Threadpool queue latency above this means business file work is backlogged. */
const IO_STALL_MS = 5_000;
/** The KTX upstream probe is refreshed every few seconds; older than this counts as failing. */
const UPSTREAM_PROBE_MAX_AGE_MS = 30_000;
/** A completed KTX tool-call answer inside this window outranks a timed-out probe. */
const UPSTREAM_ALIVE_WINDOW_MS = 30_000;

let watchdog: StuckWatchdog | null = null;
let inPlaceRunning = false;
let ktxReloadRunning = false;

export function selfHealEventsPath(projectRoot: string): string {
  return path.join(projectRoot, ".ktx-ui", SELF_HEAL_EVENTS_FILENAME);
}

export function appendSelfHealEvent(file: string, event: SelfHealEvent): void {
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(event)}\n`, { mode: 0o600 });
  } catch {
    /* evidence is best effort */
  }
  console.warn(`[lucy-self-heal] ${JSON.stringify({ type: event.type, phase: event.phase, durationMs: event.durationMs, detail: event.detail })}`);
}

/** Restarts the watchdog itself requested in the window; read from the persisted evidence so it survives restarts. */
export function countSelfHealRestarts(file: string, sinceMs: number): number {
  try {
    if (!existsSync(file)) return 0;
    let count = 0;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (!line.includes("\"restart_requested\"")) continue;
      const event = JSON.parse(line) as SelfHealEvent;
      if (event.type === "restart_requested" && Date.parse(event.ts) >= sinceMs) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

async function probeDisplay(): Promise<ProbeOutcome> {
  const started = performance.now();
  const servable = displayReadServable();
  return {
    ok: servable.ok,
    ms: Math.round(performance.now() - started),
    ...(servable.reason ? { detail: servable.reason } : {}),
    ...(servable.degraded ? { degraded: servable.degraded } : {})
  };
}

function upstreamOutcome(): ProbeOutcome {
  // Saturated-but-working KTX times out the 1.5 s probe; recent tool-call answers prove it is alive.
  if (upstreamRespondedWithin(UPSTREAM_ALIVE_WINDOW_MS)) return { ok: true, ms: 0, detail: "upstream_responding" };
  const last = peekExecutionProbe();
  if (!last) return { ok: false, ms: 0, detail: "upstream_probe_missing", kind: "upstream" };
  if (Date.now() - Date.parse(last.checkedAt) > UPSTREAM_PROBE_MAX_AGE_MS) return { ok: false, ms: 0, detail: "upstream_probe_stale", kind: "upstream" };
  return last.status === "reachable" ? { ok: true, ms: 0 } : { ok: false, ms: 0, detail: `upstream_${last.status}`, kind: "upstream" };
}

/** MCP data path = file work can be scheduled promptly AND the KTX upstream answers. */
function makeProbeMcp(projectRoot: string): () => Promise<ProbeOutcome> {
  return async () => {
    const started = performance.now();
    await stat(projectRoot); // goes through the libuv pool: measures queue backlog, not disk speed
    const ioMs = Math.round(performance.now() - started);
    const upstream = upstreamOutcome();
    if (!upstream.ok) return { ...upstream, ms: ioMs };
    // A local I/O backlog alone is never a STUCK signal on its own (see stuck-watchdog.ts).
    if (ioMs > IO_STALL_MS) return { ok: false, ms: ioMs, detail: "io_backlog", kind: "io" };
    return { ...upstream, ms: ioMs };
  };
}

function isExempt(): boolean {
  if (!isWebuiReady()) return true;
  if (getProcessLifecyclePhase() !== "SERVING") return true;
  // The KTX reload this watchdog started itself must not reset the streak, otherwise a KTX that
  // never comes back would loop stuck → reload → exempt → stuck and never reach the restart.
  return currentMcpReloadWindow() !== null && !ktxReloadRunning;
}

async function recoverKtxInPlace(projectRoot: string): Promise<void> {
  if (ktxReloadRunning) return;
  ktxReloadRunning = true;
  void import("../ktx-mcp-reload.js")
    .then(({ reloadKtxMcpAfterConfigWrite }) => reloadKtxMcpAfterConfigWrite(projectRoot))
    .then((result) => console.warn(`[lucy-self-heal] in-place KTX restart: ${result.status}${result.detail ? ` (${result.detail.slice(0, 160)})` : ""}`))
    .catch((error) => console.warn("[lucy-self-heal] in-place KTX restart failed:", error instanceof Error ? error.message : error))
    .finally(() => { ktxReloadRunning = false; });
}

export function startSelfHeal(projectRoot: string, config: StuckWatchdogConfig = stuckWatchdogConfigFromEnv()): StuckWatchdog | null {
  if (watchdog) return watchdog;
  if (!config.enabled) return null;
  const eventsFile = selfHealEventsPath(projectRoot);
  watchdog = new StuckWatchdog(config, {
    now: () => Date.now(),
    probeDisplay,
    probeMcp: makeProbeMcp(projectRoot),
    isExempt,
    inPlaceRecover: async (targets) => {
      // Non-blocking: the baseline pass (or a KTX restart) can itself take a minute or more, and the
      // watchdog must keep observing (and escalate to B) while it runs.
      if (targets.mcp) await recoverKtxInPlace(projectRoot);
      if (!targets.display || inPlaceRunning) return;
      inPlaceRunning = true;
      void startDisplayReconciler()
        .catch((error) => console.warn("[lucy-self-heal] in-place reconciler restart failed:", error instanceof Error ? error.message : error))
        .finally(() => { inPlaceRunning = false; });
    },
    requestRestart: () => {
      // P1-63 ordered drain (OQ-4): drain in-flight work within the existing budget, then exit non-zero
      // so the supervisor replaces this process.
      if (process.env.VITEST === "true" || process.env.LUCY_PROCESS_DRAIN_NO_EXIT === "1") return;
      void beginInstanceShutdown()
        .catch(() => undefined)
        .finally(() => process.exit(SELF_HEAL_EXIT_CODE));
    },
    record: (event) => appendSelfHealEvent(eventsFile, event),
    recentRestartCount: (sinceMs) => countSelfHealRestarts(eventsFile, sinceMs)
  });
  watchdog.start();
  return watchdog;
}

export function stopSelfHeal(): void {
  watchdog?.stop();
  watchdog = null;
}

export function selfHealSnapshot(): StuckSnapshot | null {
  return watchdog?.snapshot() ?? null;
}

/** True once the instance has declared itself unrecoverable; probes must turn red. */
export function isSelfHealUnhealthy(): boolean {
  return watchdog?.getPhase() === "unhealthy";
}

/** STUCK (in-place recovery running) or unhealthy: `readyz` must not report a ready instance. */
export function isSelfHealNotReady(): boolean {
  const phase = watchdog?.getPhase();
  return phase === "stuck" || phase === "unhealthy";
}
