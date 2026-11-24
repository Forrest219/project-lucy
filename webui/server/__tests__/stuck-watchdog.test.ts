import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STUCK_WATCHDOG_CONFIG,
  StuckWatchdog,
  runProbeWithTimeout,
  stuckWatchdogConfigFromEnv,
  type ProbeOutcome,
  type SelfHealEvent
} from "../runtime/stuck-watchdog";

const ok: ProbeOutcome = { ok: true, ms: 3 };
const bad: ProbeOutcome = { ok: false, ms: 8000, detail: "overdue" };
const upstreamDown: ProbeOutcome = { ok: false, ms: 0, detail: "upstream_unavailable", kind: "upstream" };
const ioBacklog: ProbeOutcome = { ok: false, ms: 9000, detail: "io_backlog", kind: "io" };

function harness(overrides: Partial<typeof DEFAULT_STUCK_WATCHDOG_CONFIG> = {}, recent = 0) {
  let now = 1_000_000;
  const state = { display: bad, mcp: bad, exempt: false };
  const events: SelfHealEvent[] = [];
  const inPlace = vi.fn(async () => undefined);
  const restart = vi.fn();
  const dog = new StuckWatchdog(
    { ...DEFAULT_STUCK_WATCHDOG_CONFIG, ...overrides },
    {
      now: () => now,
      probeDisplay: async () => state.display,
      probeMcp: async () => state.mcp,
      isExempt: () => state.exempt,
      inPlaceRecover: inPlace,
      requestRestart: restart,
      record: (event) => events.push(event),
      recentRestartCount: () => recent
    }
  );
  const advance = async (ms: number, step = 10_000) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      now += step;
      await dog.tick();
    }
  };
  return { dog, state, events, inPlace, restart, advance, clock: () => now };
}

describe("StuckWatchdog (P1-81)", () => {
  it("SC-01/03: both probes failing for W → STUCK; in place first, restart only after T_A", async () => {
    const h = harness();
    await h.advance(50_000);
    expect(h.dog.getPhase()).toBe("normal");
    await h.advance(20_000);
    expect(h.dog.getPhase()).toBe("stuck");
    expect(h.inPlace).toHaveBeenCalled();
    expect(h.restart).not.toHaveBeenCalled();
    await h.advance(110_000);
    expect(h.dog.getPhase()).toBe("stuck");
    expect(h.restart).not.toHaveBeenCalled();
    await h.advance(20_000);
    expect(h.dog.getPhase()).toBe("unhealthy");
    expect(h.restart).toHaveBeenCalledTimes(1);
    await h.advance(60_000);
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.events.map((e) => e.type)).toEqual(expect.arrayContaining(["stuck_detected", "in_place_attempt", "unhealthy", "restart_requested"]));
  });

  it("SC-02: recovers in place without a restart and records the duration", async () => {
    const h = harness();
    await h.advance(70_000);
    expect(h.dog.getPhase()).toBe("stuck");
    h.state.display = ok;
    h.state.mcp = ok;
    await h.advance(10_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
    const recovered = h.events.find((e) => e.type === "recovered");
    expect(recovered?.detail).toBe("in_place");
    expect(recovered?.durationMs).toBeGreaterThan(0);
  });

  it("SC-04: one passing business probe never allows STUCK (no false kill)", async () => {
    const h = harness();
    h.state.mcp = ok; // display fails, MCP still serves
    await h.advance(600_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("single path: KTX upstream down alone (display healthy) → STUCK, in-place KTX restart, readiness off, then restart after T_A", async () => {
    const h = harness();
    h.state.display = ok;
    h.state.mcp = upstreamDown;
    await h.advance(50_000);
    expect(h.dog.getPhase()).toBe("normal");
    await h.advance(20_000);
    expect(h.dog.getPhase()).toBe("stuck");
    expect(h.dog.snapshot().stuckDomain).toBe("mcp");
    expect(h.inPlace).toHaveBeenCalledWith({ display: false, mcp: true });
    expect(h.restart).not.toHaveBeenCalled();
    await h.advance(130_000);
    expect(h.dog.getPhase()).toBe("unhealthy");
    expect(h.restart).toHaveBeenCalledTimes(1);
    expect(h.events.find((e) => e.type === "stuck_detected")?.detail).toBe("domain:mcp");
  });

  it("single path: KTX comes back in place → recovered without a restart", async () => {
    const h = harness();
    h.state.display = ok;
    h.state.mcp = upstreamDown;
    await h.advance(80_000);
    expect(h.dog.getPhase()).toBe("stuck");
    h.state.mcp = ok;
    await h.advance(10_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
    expect(h.events.find((e) => e.type === "recovered")?.detail).toBe("in_place");
  });

  it("single path: a local I/O backlog alone (display healthy) is never STUCK", async () => {
    const h = harness();
    h.state.display = ok;
    h.state.mcp = ioBacklog;
    await h.advance(600_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("single path: a flapping KTX that answers every third tick never accumulates a streak", async () => {
    const h = harness();
    h.state.display = ok;
    for (let i = 0; i < 40; i += 1) {
      h.state.mcp = i % 3 === 2 ? ok : upstreamDown;
      await h.advance(10_000);
    }
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("SC-04: alternating pass/fail never accumulates a streak", async () => {
    const h = harness();
    for (let i = 0; i < 30; i += 1) {
      const pass = i % 3 === 2;
      h.state.display = pass ? ok : bad;
      h.state.mcp = pass ? ok : bad;
      await h.advance(10_000);
    }
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("SC-04: startup, drain and planned reload are exempt", async () => {
    const h = harness();
    h.state.exempt = true;
    await h.advance(600_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.inPlace).not.toHaveBeenCalled();
    expect(h.restart).not.toHaveBeenCalled();
  });

  it("display-only failure restarts the reconciler in place, never the process", async () => {
    const h = harness();
    h.state.mcp = ok;
    await h.advance(200_000);
    expect(h.inPlace).toHaveBeenCalled();
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.restart).not.toHaveBeenCalled();
    expect(h.events.some((e) => e.type === "display_only_in_place")).toBe(true);
  });

  it("restart circuit breaker: suppresses further self-restarts and stays unhealthy", async () => {
    const h = harness({}, 3);
    await h.advance(260_000);
    expect(h.dog.getPhase()).toBe("unhealthy");
    expect(h.restart).not.toHaveBeenCalled();
    expect(h.dog.snapshot().restartSuppressed).toBe(true);
    expect(h.events.filter((e) => e.type === "restart_suppressed")).toHaveLength(1);
  });

  it("recovers after unhealthy if the business path comes back before the process exits", async () => {
    const h = harness({}, 3);
    await h.advance(260_000);
    h.state.display = ok;
    await h.advance(10_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.dog.snapshot().restartSuppressed).toBe(false);
  });

  it("disabled watchdog never acts", async () => {
    const h = harness({ enabled: false });
    await h.advance(600_000);
    expect(h.dog.getPhase()).toBe("normal");
    expect(h.inPlace).not.toHaveBeenCalled();
  });

  it("snapshot exposes the stuck state for health probes without secrets", async () => {
    const h = harness();
    await h.advance(70_000);
    const snap = h.dog.snapshot();
    expect(snap.phase).toBe("stuck");
    expect(snap.since).toMatch(/^\d{4}-/);
    expect(snap.lastProbe.display?.ok).toBe(false);
    expect(JSON.stringify(snap)).not.toMatch(/token|password|secret/i);
  });
});

describe("runProbeWithTimeout / config", () => {
  it("turns a hung probe into a failed outcome", async () => {
    const result = await runProbeWithTimeout(() => new Promise<ProbeOutcome>(() => undefined), 20);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("probe_timeout");
  });

  it("turns a throwing probe into a failed outcome", async () => {
    const result = await runProbeWithTimeout(async () => { throw new Error("boom"); }, 1000);
    expect(result).toMatchObject({ ok: false, detail: "boom" });
  });

  it("reads env overrides and the off switch", () => {
    expect(stuckWatchdogConfigFromEnv({ LUCY_SELF_HEAL: "off" } as NodeJS.ProcessEnv).enabled).toBe(false);
    const cfg = stuckWatchdogConfigFromEnv({ LUCY_SELF_HEAL_WINDOW_MS: "5000", LUCY_SELF_HEAL_IN_PLACE_MS: "9000" } as NodeJS.ProcessEnv);
    expect(cfg).toMatchObject({ enabled: true, windowMs: 5000, inPlaceMs: 9000 });
    expect(stuckWatchdogConfigFromEnv({ LUCY_SELF_HEAL_WINDOW_MS: "abc" } as NodeJS.ProcessEnv).windowMs).toBe(60_000);
  });
});
