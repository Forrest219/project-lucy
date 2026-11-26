#!/usr/bin/env node
/**
 * stability-sentinel.mjs — Lucy 常规伴随稳定性哨兵（UAT 门禁 & 线上外部拨测合一）。
 *
 * 定位：
 * - `--mode=observe`（线上观测）：持续采样 `/api/livez`、`/api/readyz`、`/api/health`
 *   （含 `uptimeS`、`selfHeal`、`eventLoop`、`displayBusy`、`mcpCapacity`）、可选 MCP 端口与登录探活，
 *   逐轮输出结构化 JSONL 与单行摘要，替代仅抓取少量字段的旧拨测脚本。
 * - `--mode=gate`（UAT 伴随门禁）：在 scale / soak / 读韧性等压测期间作为后台哨兵运行，
 *   收到 SIGINT/SIGTERM（立刻唤醒睡眠）或达到 `--duration-ms`/`--samples` 后汇总判定：
 *   0 = PASS；1 = 触发任一硬红线 FAIL；2 = 参数错误。
 *
 * 凭据安全：管理登录口令仅通过环境变量（LUCY_SENTINEL_ADMIN_PASSWORD）或 0600 文件
 * （--password-file）注入，只在内存使用，禁止打印或写入日志/摘要文件。
 *
 * 测试：scripts/uat/__tests__/stability-sentinel.test.mjs
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_GATE_THRESHOLDS = {
  p99ThresholdMs: 250,
  p99Consecutive: 3,
  maxEventLoopMs: 1000,
};

export function parseArgs(argv, env = process.env) {
  const opts = {
    mode: "observe",
    baseUrl: (env.LUCY_WEBUI_URL || `http://127.0.0.1:${env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}`).replace(/\/+$/, ""),
    mcpUrl: (env.LUCY_MCP_URL || "").trim(),
    intervalMs: null,
    timeoutMs: 8000,
    durationMs: null,
    samples: null,
    loginEvery: 4,
    adminId: (env.LUCY_SENTINEL_ADMIN_ID || "").trim(),
    password: env.LUCY_SENTINEL_ADMIN_PASSWORD || "",
    passwordFile: (env.LUCY_SENTINEL_PASSWORD_FILE || "").trim(),
    p99ThresholdMs: DEFAULT_GATE_THRESHOLDS.p99ThresholdMs,
    p99Consecutive: DEFAULT_GATE_THRESHOLDS.p99Consecutive,
    maxEventLoopMs: DEFAULT_GATE_THRESHOLDS.maxEventLoopMs,
    outPath: "",
    logPath: "",
    quiet: false,
  };

  const nextVal = (i, flag) => {
    if (i + 1 >= argv.length) throw new Error(`参数 ${flag} 缺少取值`);
    return argv[i + 1];
  };
  const posInt = (raw, flag) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
      throw new Error(`参数 ${flag} 须为正整数：${raw}`);
    }
    return n;
  };

  try {
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      const [flag, inlineVal] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
      const take = () => (inlineVal !== null ? inlineVal : nextVal(i++, flag));

      if (flag === "--mode") opts.mode = take();
      else if (flag === "--base-url") opts.baseUrl = take().replace(/\/+$/, "");
      else if (flag === "--mcp-url") opts.mcpUrl = take().trim();
      else if (flag === "--interval-ms") opts.intervalMs = posInt(take(), flag);
      else if (flag === "--timeout-ms") opts.timeoutMs = posInt(take(), flag);
      else if (flag === "--duration-ms") opts.durationMs = posInt(take(), flag);
      else if (flag === "--samples") opts.samples = posInt(take(), flag);
      else if (flag === "--login-every") opts.loginEvery = posInt(take(), flag);
      else if (flag === "--admin-id") opts.adminId = take().trim();
      else if (flag === "--password-file") opts.passwordFile = take().trim();
      else if (flag === "--p99-threshold-ms") opts.p99ThresholdMs = posInt(take(), flag);
      else if (flag === "--p99-consecutive") opts.p99Consecutive = posInt(take(), flag);
      else if (flag === "--max-event-loop-ms") opts.maxEventLoopMs = posInt(take(), flag);
      else if (flag === "--out") opts.outPath = take().trim();
      else if (flag === "--log") opts.logPath = take().trim();
      else if (flag === "--quiet") opts.quiet = true;
      else return { error: `未知参数：${arg}` };
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  if (opts.mode !== "observe" && opts.mode !== "gate") {
    return { error: `未知 mode：${opts.mode}（可选：observe、gate）` };
  }
  if (opts.intervalMs === null) {
    opts.intervalMs = opts.mode === "gate" ? 15_000 : 30_000;
  }
  if (!opts.password && opts.passwordFile) {
    try {
      opts.password = readFileSync(opts.passwordFile, "utf8").trim();
    } catch (err) {
      return { error: `读取口令文件失败：${err instanceof Error ? err.message : String(err)}` };
    }
  }
  return opts;
}

function asNumber(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** 从 `/api/health` 响应提取结构化诊断字段，与 webui/server/index.ts 契约严格对齐。 */
export function extractHealthSnapshot(payload) {
  const data = payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
    ? payload.data
    : {};

  const el = data.eventLoop && typeof data.eventLoop === "object" ? data.eventLoop : {};
  const p99Ms = asNumber(el.p99Ms ?? el.p99);
  const maxMs = asNumber(el.maxMs ?? el.max);

  const sh = data.selfHeal && typeof data.selfHeal === "object" ? data.selfHeal : null;
  const selfHeal = sh
    ? {
        enabled: sh.enabled !== false,
        phase: typeof sh.phase === "string" ? sh.phase : "unknown",
        stuckDomain: sh.stuckDomain ?? null,
        failingForMs: asNumber(sh.failingForMs) ?? 0,
        restartSuppressed: sh.restartSuppressed === true,
        lastProbe: sh.lastProbe ?? null,
        lastEvent: sh.lastEvent ?? null,
      }
    : null;

  const db = data.displayBusy && typeof data.displayBusy === "object" ? data.displayBusy : null;
  // B1: 优先读 /api/health 顶层 data.uptimeS；仅兼容旧镜像时回退 displayBusy.recent[].uptimeS。
  let uptimeS = asNumber(data.uptimeS ?? data.uptimeSeconds);
  if (uptimeS === null && Array.isArray(db?.recent) && db.recent.length > 0) {
    const uptimes = db.recent.map((r) => asNumber(r?.uptimeS)).filter((n) => n !== null);
    if (uptimes.length > 0) uptimeS = Math.max(...uptimes);
  }

  return {
    status: typeof data.status === "string" ? data.status : null,
    gitSha: typeof data.gitSha === "string" ? data.gitSha : null,
    uptimeS,
    eventLoop: { p99Ms, maxMs },
    selfHeal,
    // N1: 对齐 display-snapshot.ts displayBusySummary() 真实字段名（busy / graceServes）。
    displayBusy: db
      ? {
          busy: asNumber(db.busy) ?? 0,
          graceServes: asNumber(db.graceServes) ?? 0,
          byReason: db.byReason ?? null,
          recentCount: Array.isArray(db.recent) ? db.recent.length : 0,
        }
      : null,
    mcpCapacity: data.mcpCapacity && typeof data.mcpCapacity === "object" ? data.mcpCapacity : null,
  };
}

async function probeHttp(fetchFn, url, init, timeoutMs) {
  const started = performance.now();
  try {
    const res = await fetchFn(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      status: res.status,
      ms: Math.round(performance.now() - started),
      json,
      error: null,
    };
  } catch (err) {
    return {
      status: 0,
      ms: Math.round(performance.now() - started),
      json: null,
      error: err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160),
    };
  }
}

/** 执行单轮外部拨测采集。 */
export async function runProbeTick(opts, tickIndex, deps = {}) {
  const fetchFn = deps.fetch ?? globalThis.fetch;
  const nowIso = (deps.now ? new Date(deps.now()) : new Date()).toISOString();

  const tasks = [
    probeHttp(fetchFn, `${opts.baseUrl}/api/livez`, { method: "GET" }, opts.timeoutMs),
    probeHttp(fetchFn, `${opts.baseUrl}/api/readyz`, { method: "GET" }, opts.timeoutMs),
    probeHttp(fetchFn, `${opts.baseUrl}/api/health`, { method: "GET" }, opts.timeoutMs),
  ];
  if (opts.mcpUrl) {
    tasks.push(
      probeHttp(
        fetchFn,
        opts.mcpUrl,
        {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "sentinel-probe", method: "initialize", params: {} }),
        },
        opts.timeoutMs,
      ),
    );
  }

  const [livez, readyz, health, mcp] = await Promise.all(tasks);

  let login = null;
  const shouldLogin = Boolean(opts.adminId && opts.password) && (tickIndex % opts.loginEvery === 0);
  if (shouldLogin) {
    const res = await probeHttp(
      fetchFn,
      `${opts.baseUrl}/api/auth/login`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminId: opts.adminId, password: opts.password }),
      },
      opts.timeoutMs,
    );
    login = {
      status: res.status,
      ms: res.ms,
      ok: res.status === 200 && res.json?.ok === true,
      error: res.error ?? (res.status !== 200 ? (res.json?.error?.code || `http_${res.status}`) : null),
    };
  }

  const healthSnap = health.status === 200 ? extractHealthSnapshot(health.json) : null;
  const readyzReason = typeof readyz.json?.reason === "string" ? readyz.json.reason : null;
  const readyzStatus = typeof readyz.json?.data?.status === "string" ? readyz.json.data.status : null;

  return {
    ts: nowIso,
    tick: tickIndex,
    livez: { status: livez.status, ms: livez.ms, error: livez.error },
    readyz: { status: readyz.status, ms: readyz.ms, ok: readyz.status === 200 && readyz.json?.ok === true, reason: readyzReason, dataStatus: readyzStatus, error: readyz.error },
    health: { status: health.status, ms: health.ms, snapshot: healthSnap, error: health.error },
    mcp: opts.mcpUrl ? { status: mcp.status, ms: mcp.ms, error: mcp.error } : null,
    login,
  };
}

/** 单轮观测告警分级（供 observe 模式实时输出）。 */
export function classifyTick(sample, state, thresholds = DEFAULT_GATE_THRESHOLDS) {
  const flags = [];
  let level = "ok";
  const escalate = (next) => {
    if (next === "crit") level = "crit";
    else if (next === "warn" && level === "ok") level = "warn";
  };

  for (const [name, p] of [["livez", sample.livez], ["readyz", sample.readyz], ["health", sample.health]]) {
    if (p.status === 0) {
      flags.push(`${name}_down`);
      escalate("crit");
    } else if (p.status >= 500) {
      flags.push(`${name}_http_${p.status}`);
      escalate("crit");
    } else if (p.status !== 200) {
      flags.push(`${name}_http_${p.status}`);
      escalate("warn");
    }
  }
  if (sample.readyz.reason) flags.push(`readyz_reason_${sample.readyz.reason}`);

  if (sample.mcp) {
    if (sample.mcp.status === 0 || sample.mcp.status >= 500) {
      flags.push(sample.mcp.status === 0 ? "mcp_down" : `mcp_http_${sample.mcp.status}`);
      escalate("crit");
    }
  }

  if (sample.login && !sample.login.ok) {
    flags.push(`login_failed_${sample.login.status || "err"}`);
    escalate("crit");
  }

  const snap = sample.health.snapshot;
  if (snap) {
    if (snap.status === "degraded" || snap.status === "unavailable" || sample.readyz.dataStatus === "degraded" || sample.readyz.dataStatus === "unavailable") {
      flags.push(`status_${snap.status || sample.readyz.dataStatus}`);
      escalate("warn");
    }
    if (snap.selfHeal) {
      if (snap.selfHeal.restartSuppressed) {
        flags.push("self_heal_suppressed");
        escalate("crit");
      }
      if (snap.selfHeal.phase === "unhealthy") {
        flags.push("self_heal_unhealthy");
        escalate("crit");
      } else if (snap.selfHeal.phase !== "normal" && snap.selfHeal.phase !== "unknown") {
        flags.push(`self_heal_${snap.selfHeal.phase}`);
        escalate("warn");
      }
    }
    if (snap.eventLoop.p99Ms !== null && snap.eventLoop.p99Ms > thresholds.p99ThresholdMs) {
      flags.push("event_loop_p99");
      escalate(snap.eventLoop.p99Ms > thresholds.p99ThresholdMs * 2 ? "crit" : "warn");
    }
    if (snap.eventLoop.maxMs !== null && snap.eventLoop.maxMs > thresholds.maxEventLoopMs) {
      flags.push("event_loop_max");
      escalate("crit");
    }
    if (snap.uptimeS !== null) {
      if (state.lastUptimeS !== null && snap.uptimeS < state.lastUptimeS - 1) {
        flags.push("restart_uptime_reset");
        escalate("crit");
      }
      state.lastUptimeS = snap.uptimeS;
    }
  }

  return { level, flags };
}

/** UAT 门禁汇总判定（4 类硬红线；B4：单纯 health.status=degraded 仅作观测统计不单独卡 gate）。 */
export function evaluateGate(samples, thresholds = DEFAULT_GATE_THRESHOLDS) {
  const violations = [];
  let consecutiveP99 = 0;
  let maxConsecutiveP99 = 0;
  let maxObservedP99 = null;
  let maxObservedLoop = null;
  let lastUptimeS = null;

  let httpErrors = 0;
  let loginFailures = 0;
  let restartSignals = 0;
  let selfHealTriggers = 0;
  let degradedTicks = 0;

  for (const s of samples) {
    const httpBad =
      s.livez.status !== 200 ||
      s.readyz.status !== 200 ||
      s.health.status !== 200 ||
      (s.mcp !== null && (s.mcp.status === 0 || s.mcp.status >= 500));
    if (httpBad) {
      httpErrors += 1;
      violations.push({
        rule: "http_availability",
        ts: s.ts,
        detail: `livez=${s.livez.status} readyz=${s.readyz.status}(${s.readyz.reason || "-"}) health=${s.health.status}${s.mcp ? ` mcp=${s.mcp.status}` : ""}`,
      });
    }

    if (s.login && !s.login.ok) {
      loginFailures += 1;
      violations.push({
        rule: "login_availability",
        ts: s.ts,
        detail: `status=${s.login.status} error=${s.login.error || "unknown"}`,
      });
    }

    const snap = s.health.snapshot;
    if (!snap) continue;

    if (snap.status === "degraded" || snap.status === "unavailable" || s.readyz.dataStatus === "degraded" || s.readyz.dataStatus === "unavailable") {
      // B4：KTX reload 窗口可能短暂使 health.status=degraded 而 readyz=200，仅统计不卡 gate。
      degradedTicks += 1;
    }

    if (snap.selfHeal) {
      const triggered =
        (snap.selfHeal.phase !== "normal" && snap.selfHeal.phase !== "unknown") ||
        snap.selfHeal.restartSuppressed;
      if (triggered) {
        selfHealTriggers += 1;
        violations.push({
          rule: "self_heal_triggered",
          ts: s.ts,
          detail: `phase=${snap.selfHeal.phase} domain=${snap.selfHeal.stuckDomain || "-"} suppressed=${snap.selfHeal.restartSuppressed}`,
        });
      }
    }

    if (snap.uptimeS !== null) {
      if (lastUptimeS !== null && snap.uptimeS < lastUptimeS - 1) {
        restartSignals += 1;
        violations.push({
          rule: "unexpected_restart",
          ts: s.ts,
          detail: `uptimeS 回退：${lastUptimeS}s -> ${snap.uptimeS}s`,
        });
      }
      lastUptimeS = snap.uptimeS;
    }

    const p99 = snap.eventLoop.p99Ms;
    const maxLoop = snap.eventLoop.maxMs;
    if (p99 !== null) {
      if (maxObservedP99 === null || p99 > maxObservedP99) maxObservedP99 = p99;
      if (p99 > thresholds.p99ThresholdMs) {
        consecutiveP99 += 1;
        if (consecutiveP99 > maxConsecutiveP99) maxConsecutiveP99 = consecutiveP99;
        if (consecutiveP99 === thresholds.p99Consecutive) {
          violations.push({
            rule: "event_loop_p99",
            ts: s.ts,
            detail: `连续 ${consecutiveP99} 轮 p99 > ${thresholds.p99ThresholdMs}ms（当前 ${p99}ms）`,
          });
        }
      } else {
        consecutiveP99 = 0;
      }
    }
    if (maxLoop !== null) {
      if (maxObservedLoop === null || maxLoop > maxObservedLoop) maxObservedLoop = maxLoop;
      if (maxLoop > thresholds.maxEventLoopMs) {
        violations.push({
          rule: "event_loop_max",
          ts: s.ts,
          detail: `单次 max=${maxLoop}ms > ${thresholds.maxEventLoopMs}ms`,
        });
      }
    }
  }

  const passed = samples.length > 0 && violations.length === 0;
  return {
    verdict: passed ? "PASS" : "FAIL",
    sampleCount: samples.length,
    thresholds,
    metrics: {
      httpErrors,
      loginFailures,
      restartSignals,
      selfHealTriggers,
      degradedTicks,
      maxObservedP99Ms: maxObservedP99,
      maxObservedEventLoopMs: maxObservedLoop,
      maxConsecutiveP99Breach: maxConsecutiveP99,
    },
    violations,
  };
}

export function formatTickLine(sample, verdict) {
  const snap = sample.health.snapshot;
  const p99 = snap?.eventLoop?.p99Ms ?? "-";
  const maxMs = snap?.eventLoop?.maxMs ?? "-";
  const sh = snap?.selfHeal ? `${snap.selfHeal.phase}${snap.selfHeal.restartSuppressed ? ":suppressed" : ""}` : "-";
  const up = snap?.uptimeS ?? "-";
  const loginPart = sample.login ? ` login=${sample.login.status}/${sample.login.ms}ms` : "";
  const mcpPart = sample.mcp ? ` mcp=${sample.mcp.status}/${sample.mcp.ms}ms` : "";
  const flagsPart = verdict.flags.length ? verdict.flags.join(",") : "-";
  return `${sample.ts} [${verdict.level.toUpperCase()}] livez=${sample.livez.status}/${sample.livez.ms}ms readyz=${sample.readyz.status}/${sample.readyz.ms}ms health=${sample.health.status}/${sample.health.ms}ms${mcpPart}${loginPart} selfHeal=${sh} p99=${p99} max=${maxMs} up=${up} flags=${flagsPart}`;
}

export async function runSentinel(opts, deps = {}, io = { log: console.log, error: console.error }) {
  const now = deps.now ?? (() => Date.now());
  const thresholds = {
    p99ThresholdMs: opts.p99ThresholdMs,
    p99Consecutive: opts.p99Consecutive,
    maxEventLoopMs: opts.maxEventLoopMs,
  };

  // B5: 可中断睡眠——收到 SIGINT/SIGTERM 或外部 stopSignal 时立刻唤醒并落盘摘要，不等待整轮 intervalMs。
  let stopRequested = false;
  let resolveStop = null;
  const stopPromise = new Promise((resolve) => { resolveStop = resolve; });
  const onStop = () => {
    stopRequested = true;
    resolveStop?.();
  };
  const registerSignals = deps.registerSignals !== false;
  if (registerSignals) {
    process.once("SIGINT", onStop);
    process.once("SIGTERM", onStop);
  }
  if (deps.stopSignal) {
    if (deps.stopSignal.aborted) onStop();
    else deps.stopSignal.addEventListener("abort", onStop, { once: true });
  }

  const interruptibleSleep = (ms) => {
    if (stopRequested) return Promise.resolve();
    if (deps.sleep) return Promise.race([deps.sleep(ms), stopPromise]);
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      stopPromise.then(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  };

  const startedAt = now();
  const samples = [];
  const state = { lastUptimeS: null };
  let tick = 0;

  try {
    while (!stopRequested) {
      const sample = await runProbeTick(opts, tick, deps);
      const tickVerdict = classifyTick(sample, state, thresholds);
      samples.push(sample);
      if (!opts.quiet) io.log(formatTickLine(sample, tickVerdict));
      if (opts.logPath) {
        mkdirSync(path.dirname(opts.logPath), { recursive: true });
        appendFileSync(opts.logPath, `${JSON.stringify({ ...sample, level: tickVerdict.level, flags: tickVerdict.flags })}\n`);
      }

      tick += 1;
      if (opts.samples !== null && tick >= opts.samples) break;
      if (opts.durationMs !== null && now() - startedAt >= opts.durationMs) break;
      if (stopRequested) break;
      await interruptibleSleep(opts.intervalMs);
    }
  } finally {
    if (registerSignals) {
      process.off("SIGINT", onStop);
      process.off("SIGTERM", onStop);
    }
  }

  const summary = {
    mode: opts.mode,
    baseUrl: opts.baseUrl,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(now()).toISOString(),
    ...evaluateGate(samples, thresholds),
  };

  if (opts.outPath) {
    mkdirSync(path.dirname(opts.outPath), { recursive: true });
    writeFileSync(opts.outPath, `${JSON.stringify(summary, null, 2)}\n`);
  }

  if (opts.mode === "gate") {
    io.log(`[stability-sentinel] verdict=${summary.verdict} samples=${summary.sampleCount} violations=${summary.violations.length}`);
    return { exitCode: summary.verdict === "PASS" ? 0 : 1, summary };
  }
  return { exitCode: 0, summary };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2), process.env);
  if (opts.error) {
    console.error(`[stability-sentinel] ${opts.error}`);
    process.exit(2);
  }
  runSentinel(opts)
    .then(({ exitCode }) => process.exit(exitCode))
    .catch((err) => {
      console.error(`[stability-sentinel] 执行异常：${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    });
}
