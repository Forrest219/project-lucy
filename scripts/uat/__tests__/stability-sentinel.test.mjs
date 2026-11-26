#!/usr/bin/env node
/**
 * stability-sentinel.mjs 单测：全内存 mock fetch，按 webui/server/index.ts 真实
 * `/api/health` 响应结构（uptimeS、eventLoop.{p99Ms,maxMs}、displayBusy.{busy,graceServes}、
 * selfHeal）验证参数解析、字段提取、observe/gate 双模式、4 类硬红线与 B4/B5 回归。
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyTick,
  DEFAULT_GATE_THRESHOLDS,
  evaluateGate,
  extractHealthSnapshot,
  parseArgs,
  runSentinel,
} from "../stability-sentinel.mjs";

function makeSample(overrides = {}) {
  const base = {
    ts: "2026-11-26T03:00:00.000Z",
    tick: 0,
    livez: { status: 200, ms: 12, error: null },
    readyz: { status: 200, ms: 18, ok: true, reason: null, dataStatus: "ok", error: null },
    health: {
      status: 200,
      ms: 25,
      error: null,
      snapshot: {
        status: "ok",
        gitSha: "f5f2eb95c600",
        uptimeS: 120,
        eventLoop: { p99Ms: 22, maxMs: 85 },
        selfHeal: { enabled: true, phase: "normal", stuckDomain: null, failingForMs: 0, restartSuppressed: false, lastProbe: null, lastEvent: null },
        displayBusy: { busy: 0, graceServes: 0, byReason: {}, recentCount: 0 },
        mcpCapacity: null,
      },
    },
    mcp: { status: 401, ms: 15, error: null },
    login: { status: 200, ms: 40, ok: true, error: null },
  };
  return {
    ...base,
    ...overrides,
    livez: { ...base.livez, ...(overrides.livez || {}) },
    readyz: { ...base.readyz, ...(overrides.readyz || {}) },
    health: {
      ...base.health,
      ...(overrides.health || {}),
      snapshot: overrides.health?.snapshot === null
        ? null
        : {
            ...base.health.snapshot,
            ...(overrides.health?.snapshot || {}),
            eventLoop: { ...base.health.snapshot.eventLoop, ...(overrides.health?.snapshot?.eventLoop || {}) },
            selfHeal: overrides.health?.snapshot?.selfHeal === null
              ? null
              : { ...base.health.snapshot.selfHeal, ...(overrides.health?.snapshot?.selfHeal || {}) },
          },
    },
  };
}

test("parseArgs：observe/gate 默认间隔与非法参数拒绝", () => {
  const obs = parseArgs(["--mode", "observe"], {});
  assert.equal(obs.mode, "observe");
  assert.equal(obs.intervalMs, 30_000);

  const gate = parseArgs(["--mode=gate", "--samples=5", "--p99-threshold-ms=200"], {});
  assert.equal(gate.mode, "gate");
  assert.equal(gate.intervalMs, 15_000);
  assert.equal(gate.samples, 5);
  assert.equal(gate.p99ThresholdMs, 200);

  assert.ok(parseArgs(["--mode=bad"], {}).error);
  assert.ok(parseArgs(["--samples=0"], {}).error);
  assert.ok(parseArgs(["--unknown"], {}).error);
});

test("extractHealthSnapshot：按 index.ts 真实 /api/health 契约提取 uptimeS/eventLoop/displayBusy/selfHeal", () => {
  const snap = extractHealthSnapshot({
    ok: true,
    data: {
      status: "ok",
      gitSha: "f5f2eb95c600",
      uptimeS: 420,
      eventLoop: { p99Ms: 1054.3, maxMs: 1634.7, windowSeconds: 60 },
      selfHeal: { enabled: true, phase: "stuck", stuckDomain: "mcp", failingForMs: 65000, restartSuppressed: false },
      displayBusy: { busy: 4, graceServes: 2, byReason: { metadata_overdue: 4 }, recent: [{ uptimeS: 180 }] },
      ktxRuntime: { ready: true, status: "ready" },
    },
  });
  assert.equal(snap.gitSha, "f5f2eb95c600");
  assert.equal(snap.uptimeS, 420);
  assert.equal(snap.eventLoop.p99Ms, 1054.3);
  assert.equal(snap.eventLoop.maxMs, 1634.7);
  assert.equal(snap.selfHeal.phase, "stuck");
  assert.equal(snap.selfHeal.stuckDomain, "mcp");
  assert.equal(snap.displayBusy.busy, 4);
  assert.equal(snap.displayBusy.graceServes, 2);
});

test("evaluateGate：全绿样本 PASS；0 样本 FAIL", () => {
  const pass = evaluateGate([
    makeSample({ tick: 0, health: { snapshot: { uptimeS: 100 } } }),
    makeSample({ tick: 1, health: { snapshot: { uptimeS: 115 } } }),
  ]);
  assert.equal(pass.verdict, "PASS");
  assert.equal(pass.violations.length, 0);

  const empty = evaluateGate([]);
  assert.equal(empty.verdict, "FAIL");
});

test("evaluateGate（B4）：KTX reload 窗口 health.status=degraded 且 readyz=200 不误报 FAIL", () => {
  const r = evaluateGate([
    makeSample({ tick: 0, readyz: { status: 200, ok: true, dataStatus: "degraded" }, health: { snapshot: { status: "degraded", uptimeS: 100 } } }),
    makeSample({ tick: 1, readyz: { status: 200, ok: true, dataStatus: "ok" }, health: { snapshot: { status: "ok", uptimeS: 115 } } }),
  ]);
  assert.equal(r.verdict, "PASS");
  assert.equal(r.metrics.degradedTicks, 1);
});

test("evaluateGate：503/502、登录失败、uptimeS 隐性重启、自愈触发、连续 p99 与单次 max 均判 FAIL", () => {
  // 1) 503 入口失败
  const r503 = evaluateGate([makeSample({ readyz: { status: 503, ok: false, reason: "stuck" } })]);
  assert.equal(r503.verdict, "FAIL");
  assert.ok(r503.violations.some((v) => v.rule === "http_availability"));

  // 2) 登录失败
  const rLogin = evaluateGate([makeSample({ login: { status: 503, ms: 45, ok: false, error: "http_503" } })]);
  assert.equal(rLogin.verdict, "FAIL");
  assert.ok(rLogin.violations.some((v) => v.rule === "login_availability"));

  // 3) B1: uptimeS 回退（隐性重启）
  const rRestart = evaluateGate([
    makeSample({ tick: 0, health: { snapshot: { uptimeS: 500 } } }),
    makeSample({ tick: 1, health: { snapshot: { uptimeS: 12 } } }),
  ]);
  assert.equal(rRestart.verdict, "FAIL");
  assert.ok(rRestart.violations.some((v) => v.rule === "unexpected_restart"));

  // 4) P1-81 自愈触发
  const rHeal = evaluateGate([
    makeSample({ health: { snapshot: { selfHeal: { phase: "stuck", stuckDomain: "mcp" } } } }),
  ]);
  assert.equal(rHeal.verdict, "FAIL");
  assert.ok(rHeal.violations.some((v) => v.rule === "self_heal_triggered"));

  // 5) 连续 3 轮 eventLoop p99 > 250ms（2 轮不触发，3 轮触发）
  const twoP99 = evaluateGate([
    makeSample({ tick: 0, health: { snapshot: { eventLoop: { p99Ms: 300, maxMs: 400 } } } }),
    makeSample({ tick: 1, health: { snapshot: { eventLoop: { p99Ms: 310, maxMs: 420 } } } }),
    makeSample({ tick: 2, health: { snapshot: { eventLoop: { p99Ms: 25, maxMs: 80 } } } }),
  ]);
  assert.equal(twoP99.verdict, "PASS");

  const threeP99 = evaluateGate([
    makeSample({ tick: 0, health: { snapshot: { eventLoop: { p99Ms: 300, maxMs: 400 } } } }),
    makeSample({ tick: 1, health: { snapshot: { eventLoop: { p99Ms: 310, maxMs: 420 } } } }),
    makeSample({ tick: 2, health: { snapshot: { eventLoop: { p99Ms: 280, maxMs: 450 } } } }),
  ]);
  assert.equal(threeP99.verdict, "FAIL");
  assert.ok(threeP99.violations.some((v) => v.rule === "event_loop_p99"));

  // 6) 单次 eventLoop max > 1000ms
  const maxSpike = evaluateGate([
    makeSample({ health: { snapshot: { eventLoop: { p99Ms: 90, maxMs: 1250 } } } }),
  ]);
  assert.equal(maxSpike.verdict, "FAIL");
  assert.ok(maxSpike.violations.some((v) => v.rule === "event_loop_max"));
});

test("classifyTick：observe 模式准确标注 crit/warn 与 flags", () => {
  const state = { lastUptimeS: 300 };
  const s = makeSample({
    health: { snapshot: { uptimeS: 10, selfHeal: { phase: "unhealthy", restartSuppressed: true } } },
  });
  const c = classifyTick(s, state, DEFAULT_GATE_THRESHOLDS);
  assert.equal(c.level, "crit");
  assert.ok(c.flags.includes("restart_uptime_reset"));
  assert.ok(c.flags.includes("self_heal_suppressed"));
});

test("runSentinel（B5）：睡眠期间收到停止信号立刻唤醒退出，不等待整轮 intervalMs", async () => {
  const mockFetchOk = async (url) => {
    const body = url.endsWith("/api/health")
      ? { ok: true, data: { status: "ok", gitSha: "f5f2eb95c600", uptimeS: 100, eventLoop: { p99Ms: 21, maxMs: 80 }, selfHeal: { enabled: true, phase: "normal", restartSuppressed: false }, displayBusy: { busy: 0, graceServes: 0, recent: [] } } }
      : { ok: true, data: { status: "ok" } };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  const ac = new AbortController();
  const opts = parseArgs(["--mode=gate", "--interval-ms=60000", "--samples=10", "--quiet"], {});
  const started = performance.now();
  setTimeout(() => ac.abort(), 30);
  const res = await runSentinel(opts, { fetch: mockFetchOk, registerSignals: false, stopSignal: ac.signal }, { log: () => {}, error: () => {} });
  const elapsed = performance.now() - started;
  assert.equal(res.exitCode, 0);
  assert.equal(res.summary.sampleCount, 1);
  assert.ok(elapsed < 1000, `期望可中断睡眠在 <1s 内退出，实际 ${elapsed}ms`);
});

test("runSentinel：gate 模式全绿返回 exit 0，故障返回 exit 1；observe 模式故障仍返回 exit 0", async () => {
  const mockFetchOk = async (url) => {
    const body = url.endsWith("/api/health")
      ? { ok: true, data: { status: "ok", gitSha: "f5f2eb95c600", uptimeS: 100, eventLoop: { p99Ms: 21, maxMs: 80 }, selfHeal: { enabled: true, phase: "normal", restartSuppressed: false }, displayBusy: { busy: 0, graceServes: 0, recent: [] } } }
      : { ok: true, data: { status: "ok" } };
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  const mockFetch503 = async () => ({ status: 503, text: async () => "503 Service Temporarily Unavailable" });

  const io = { log: () => {}, error: () => {} };
  const okOpts = parseArgs(["--mode=gate", "--samples=2", "--interval-ms=1", "--quiet"], {});
  const okRes = await runSentinel(okOpts, { fetch: mockFetchOk, sleep: async () => {}, registerSignals: false }, io);
  assert.equal(okRes.exitCode, 0);
  assert.equal(okRes.summary.verdict, "PASS");

  const failRes = await runSentinel(okOpts, { fetch: mockFetch503, sleep: async () => {}, registerSignals: false }, io);
  assert.equal(failRes.exitCode, 1);
  assert.equal(failRes.summary.verdict, "FAIL");

  const obsOpts = parseArgs(["--mode=observe", "--samples=1", "--interval-ms=1", "--quiet"], {});
  const obsRes = await runSentinel(obsOpts, { fetch: mockFetch503, sleep: async () => {}, registerSignals: false }, io);
  assert.equal(obsRes.exitCode, 0);
  assert.equal(obsRes.summary.verdict, "FAIL");
});
