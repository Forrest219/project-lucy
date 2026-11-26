#!/usr/bin/env node
/**
 * P1-84 公共首页与静态公开接口隔离 — UAT runner（UAT-SUITE-PUBLIC-ENTRY-STATIC）。
 * 合同：docs/specs/lucy-20261124-public-entry-static-isolation-spec.md v1.0（SC-01–08）
 * 用例：docs/qa/uat/suites/public-entry-static/cases.md · 夹具：同目录 fixtures.md
 *
 * 子命令（各进程独立运行，原始 JSONL 账本写入 --out）：
 *   probe          独立探测（≥1Hz；客户端计时；GET /、branding、logo、auth/status、livez＋/api/health 事件循环快照）
 *   login-probe    合法登录 ≥10 次（每次独立 Session）＋一次受保护只读（UAT-PES-04）
 *   mcp-arm        真实 MCP 在途保持（任一时刻 ≥1 条在途查询；真实 KTX 工具）
 *   display-arm    生产重工作臂：PUT /api/branding 触发写屏障→冷展示构建＋并发 GET /api/sources＋scale 审计读
 *   injector-arm   仅基线臂机制鉴别：POST /api/admin/ops-step-uat/sync-section（容器须 LUCY_OPS_STEP_UAT=1）
 *   judge          只读账本判定（P50/P95/P99/max、超时、0-byte、事件循环上限）
 *
 * 浏览器冷开（primaryReady）在 public-entry-static-browser.mjs（真实前台 Chromium）。
 * 凭据只从 --cookie-file／--token-file 或 PES_ADMIN_COOKIE／PES_MCP_TOKEN 环境变量读入，
 * 不打印、不写入任何落盘文件。
 */
import { mkdirSync, writeFileSync, readFileSync, openSync, writeSync, closeSync } from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ledgerLine, summarizeSamples, judgeEventLoop } from "./public-entry-static-lib.mjs";

const DEFAULT_WEBUI = process.env.PES_WEBUI_URL ?? "http://127.0.0.1:55176";
const DEFAULT_MCP = process.env.PES_MCP_URL ?? "http://127.0.0.1:57881/mcp";
const LEDGER_SCHEMA = "pes-ledger/1";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else { args[key] = next; i++; }
    } else args._.push(a);
  }
  return args;
}

function openLedger(outDir, name) {
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, name);
  writeFileSync(file, "");
  let fd = openSync(file, "r+");
  return {
    file,
    write(entry) {
      writeSync(fd, ledgerLine(entry) + "\n");
    },
    close() {
      closeSync(fd);
    }
  };
}

function readSecret(argValue, envName) {
  const file = argValue ?? process.env[envName];
  if (!file) throw new Error(`缺少凭据：传 --cookie-file/--token-file 或设置 ${envName}`);
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) throw new Error(`凭据文件为空：${file}`);
  // 文件可能是裸 token／cookie，也可能是 {"token": "..."} 形 JSON。
  if (raw.startsWith("{")) {
    const parsed = JSON.parse(raw);
    return parsed.token ?? parsed.Authorization?.replace(/^Bearer /, "") ?? raw;
  }
  return raw.replace(/^Bearer /, "").replace(/^cookie: /i, "").split("\n")[0].trim();
}

/** 客户端计时请求：发送 → 响应头（ttfbMs）→ 完整响应（totalMs）。超时／0-byte 如实记录。 */
async function timedFetch(url, { method = "GET", headers = {}, body, timeoutMs = 15_000, expectedStatus = 200 } = {}) {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method, headers, body, signal: controller.signal });
    const ttfbMs = Math.round(performance.now() - started);
    const buffer = await response.arrayBuffer();
    return {
      status: response.status,
      bytes: buffer.byteLength,
      ttfbMs,
      totalMs: Math.round(performance.now() - started),
      headers: Object.fromEntries([...response.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])),
      text: () => new TextDecoder().decode(buffer),
      expectedStatus
    };
  } catch (error) {
    const totalMs = Math.round(performance.now() - started);
    const aborted = controller.signal.aborted;
    return {
      status: null, bytes: null, ttfbMs: null, totalMs, headers: {},
      error: aborted ? `timeout after ${timeoutMs}ms` : String(error?.message ?? error),
      expectedStatus
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- probe ----

/** GET / 的首屏资产从当次 HTML 再核（OQ-3：hash 随构建变化）。 */
function firstScreenAssets(html) {
  const out = [];
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)) out.push(match[1]);
  return [...new Set(out)];
}

async function cmdProbe(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const windowSec = Number(args.window ?? args["window-sec"] ?? 180);
  const hz = Number(args.hz ?? 1);
  const label = args.label ?? "probe";
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, `probes-${label}.jsonl`);
  const periodMs = Math.max(50, Math.round(1000 / hz));
  const deadline = Date.now() + windowSec * 1000;
  let assetPaths = null;
  let tick = 0;
  console.log(`[probe] ${label} → ${base} window=${windowSec}s hz=${hz} ledger=${ledger.file}`);
  while (Date.now() < deadline) {
    const started = Date.now();
    tick += 1;
    // 同一 tick 并行发探测；客户端计时互不影响。
    const jobs = [
      timedFetch(`${base}/`, { timeoutMs: 20_000 }).then((r) => {
        ledger.write({ kind: "entry", path: "/", method: "GET", label, tick, ...r });
        if (r.status === 200 && r.bytes > 0 && assetPaths === null) {
          assetPaths = firstScreenAssets(r.text());
          console.log(`[probe] 首屏资产（当次 HTML）：${assetPaths.join(", ")}`);
        }
      }),
      timedFetch(`${base}/api/branding`, { timeoutMs: 10_000 }).then((r) => ledger.write({ kind: "entry", path: "/api/branding", method: "GET", label, tick, ...r })),
      timedFetch(`${base}/api/auth/status`, { timeoutMs: 10_000 }).then((r) => ledger.write({ kind: "entry", path: "/api/auth/status", method: "GET", label, tick, ...r })),
      timedFetch(`${base}/api/livez`, { timeoutMs: 10_000 }).then((r) => ledger.write({ kind: "probe", path: "/api/livez", method: "GET", label, tick, ...r })),
      timedFetch(`${base}/api/health`, { timeoutMs: 10_000 }).then((r) => {
        ledger.write({ kind: "probe", path: "/api/health", method: "GET", label, tick, ...r });
        try {
          const eventLoop = JSON.parse(r.text())?.data?.eventLoop;
          if (eventLoop) ledger.write({ kind: "eventloop", label, tick, p99Ms: eventLoop.p99Ms, maxMs: eventLoop.maxMs });
        } catch { /* health 非 JSON 时由 status/bytes 字段如实呈现 */ }
      })
    ];
    if (assetPaths) {
      for (const asset of assetPaths) {
        jobs.push(timedFetch(`${base}${asset}`, { timeoutMs: 15_000 }).then((r) => ledger.write({ kind: "asset", path: asset, method: "GET", label, tick, ...r })));
      }
    }
    await Promise.allSettled(jobs);
    const elapsed = Date.now() - started;
    if (elapsed < periodMs) await sleep(periodMs - elapsed);
  }
  ledger.close();
  console.log(`[probe] 完成：${ledger.file}`);
}

// ------------------------------------------------------------ login-probe ----

async function cmdLoginProbe(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const count = Number(args.count ?? 10);
  const adminId = args.admin ?? process.env.PES_ADMIN_ID ?? "xingchen";
  const password = readSecret(args["password-file"], "PES_ADMIN_PASSWORD");
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "logins.jsonl");
  console.log(`[login-probe] ${base} count=${count}`);
  for (let i = 1; i <= count; i++) {
    const body = JSON.stringify({ adminId, password });
    const login = await timedFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      timeoutMs: 15_000
    });
    const setCookie = login.headers["set-cookie"] ?? "";
    const issued = login.status === 200 && setCookie.includes("lucy_admin_session=");
    ledger.write({ kind: "login", path: "/api/auth/login", method: "POST", tick: i, issued, ...login });
    if (!issued) continue;
    // 每次独立 Session 读一条受保护只读（正确内容核对：me.id 须等于 adminId）。
    const cookie = setCookie.split(";")[0];
    const status = await timedFetch(`${base}/api/auth/status`, { headers: { Cookie: cookie }, timeoutMs: 10_000 });
    let meOk = false;
    try { meOk = JSON.parse(status.text())?.data?.me?.id === adminId; } catch { /* 解析失败即不通过 */ }
    ledger.write({ kind: "protected-read", path: "/api/auth/status", method: "GET", tick: i, meOk, ...status });
  }
  ledger.close();
  console.log(`[login-probe] 完成：${ledger.file}`);
}

// ---------------------------------------------------------------- mcp-arm ----

/** MCP 在途保持：多会话轮转 tools/call（lucy_catalog 只读），任一时刻 ≥1 条在途。 */
async function cmdMcpArm(args) {
  const base = args.mcp ?? DEFAULT_MCP;
  const token = readSecret(args["token-file"], "PES_MCP_TOKEN");
  const windowSec = Number(args.window ?? args["window-sec"] ?? 180);
  const concurrency = Number(args.concurrency ?? 3);
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "mcp-arm.jsonl");
  console.log(`[mcp-arm] ${base} window=${windowSec}s concurrency=${concurrency}`);
  const deadline = Date.now() + windowSec * 1000;
  let callId = 0;

  async function newSession() {
    const init = await timedFetch(base, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "p184-mcp-arm", version: "1.0" } } }),
      timeoutMs: 15_000
    });
    return init.headers["mcp-session-id"] ?? null;
  }

  async function worker(workerIndex) {
    let sessionId = await newSession();
    ledger.write({ kind: "mcp-init", worker: workerIndex, ok: sessionId != null });
    while (Date.now() < deadline) {
      callId += 1;
      const id = callId;
      const started = Date.now();
      const result = await timedFetch(base, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) },
        body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name: "lucy_catalog", arguments: {} } }),
        timeoutMs: 30_000
      });
      let rpcOk = false;
      try { rpcOk = result.status === 200 && JSON.parse(result.text())?.result !== undefined; } catch { /* 0-byte/解析失败如实记录 */ }
      ledger.write({
        kind: "mcp-call", worker: workerIndex, rpcId: id, rpcOk,
        path: "/mcp tools/call lucy_catalog", method: "POST",
        status: result.status, bytes: result.bytes, ttfbMs: result.ttfbMs,
        totalMs: result.totalMs, error: result.error, expectedStatus: 200,
        msSinceWindowStart: started - (deadline - windowSec * 1000)
      });
      if (result.status === 404 || result.status === 400) sessionId = await newSession();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i + 1).catch((e) => ledger.write({ kind: "mcp-worker-error", worker: i + 1, error: String(e) }))));
  ledger.close();
  console.log(`[mcp-arm] 完成：${ledger.file}`);
}

// ------------------------------------------------------------ display-arm ----

/** 生产重工作臂：写屏障 bump → 冷展示构建（H1）＋并发读＋scale 审计读（H2 回归）。 */
async function cmdDisplayArm(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const cookie = readSecret(args["cookie-file"], "PES_ADMIN_COOKIE");
  const windowSec = Number(args.window ?? args["window-sec"] ?? 180);
  const readConcurrency = Number(args["read-concurrency"] ?? 4);
  const auditEvery = Number(args["audit-every"] ?? 10);
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "display-arm.jsonl");
  console.log(`[display-arm] ${base} window=${windowSec}s reads=${readConcurrency}`);
  const deadline = Date.now() + windowSec * 1000;
  let writes = 0;
  let reads = 0;
  let stop = false;

  // 写者：PUT /api/branding（同值写；审计＋写屏障照常生效）→ 展示快照全部失效。
  async function writer() {
    while (!stop && Date.now() < deadline) {
      const current = await timedFetch(`${base}/api/branding`, { headers: { Cookie: cookie }, timeoutMs: 15_000 });
      let body = JSON.stringify({ productTitle: "Lucy WebUI", tagline: "可信 Agent 数据层" });
      try {
        const view = JSON.parse(current.text())?.data;
        if (view) body = JSON.stringify({ productTitle: view.productTitle, tagline: view.tagline });
      } catch { /* 读失败则用默认文案 */ }
      const put = await timedFetch(`${base}/api/branding`, {
        method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body, timeoutMs: 15_000
      });
      writes += 1;
      ledger.write({ kind: "display-write", path: "/api/branding", method: "PUT", tick: writes, status: put.status, bytes: put.bytes, totalMs: put.totalMs, error: put.error, expectedStatus: 200 });
      await sleep(2000);
    }
  }

  // 读者：并发展示构建／读（宽目录下 /api/sources 冷构建为 H1 生产重工作）。
  async function reader(readerIndex) {
    while (!stop && Date.now() < deadline) {
      reads += 1;
      const r = await timedFetch(`${base}/api/sources`, { headers: { Cookie: cookie }, timeoutMs: 30_000 });
      ledger.write({ kind: "display-read", path: "/api/sources", method: "GET", tick: reads, worker: readerIndex, status: r.status, bytes: r.bytes, totalMs: r.totalMs, error: r.error, expectedStatus: 200 });
      // H2 回归：周期性 scale 档审计导出（已切片路径，不改写；列表读的全表扫描
      // 为不可切片热点，差集登记另案，不进事件循环臂窗口）。
      if (reads % auditEvery === 0) {
        const audit = await timedFetch(`${base}/api/admin/audit/export?limit=2000`, { headers: { Cookie: cookie }, timeoutMs: 30_000 });
        ledger.write({ kind: "audit-read", path: "/api/admin/audit/export", method: "GET", tick: reads, worker: readerIndex, status: audit.status, bytes: audit.bytes, totalMs: audit.totalMs, error: audit.error });
      }
    }
  }

  await Promise.all([writer(), ...Array.from({ length: readConcurrency }, (_, i) => reader(i + 1).catch((e) => ledger.write({ kind: "display-arm-error", worker: i + 1, error: String(e) })))]);
  stop = true;
  ledger.close();
  console.log(`[display-arm] 完成：writes=${writes} reads=${reads} → ${ledger.file}`);
}

// ----------------------------------------------------------- injector-arm ----

/** 仅基线臂机制鉴别：sync-section（Atomics.wait）整段阻塞事件循环。用后必须关闭该开关。 */
async function cmdInjectorArm(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const cookie = readSecret(args["cookie-file"], "PES_ADMIN_COOKIE");
  const holdMs = Number(args["hold-ms"] ?? 2500);
  const windowSec = Number(args.window ?? args["window-sec"] ?? 60);
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "injector-arm.jsonl");
  console.log(`[injector-arm] ${base} holdMs=${holdMs} window=${windowSec}s（仅基线臂；用后须关闭 LUCY_OPS_STEP_UAT）`);
  const deadline = Date.now() + windowSec * 1000;
  let n = 0;
  while (Date.now() < deadline) {
    n += 1;
    const r = await timedFetch(`${base}/api/admin/ops-step-uat/sync-section`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ holdMs }),
      timeoutMs: holdMs + 10_000
    });
    ledger.write({ kind: "injector", path: "/api/admin/ops-step-uat/sync-section", method: "POST", tick: n, holdMs, status: r.status, totalMs: r.totalMs, error: r.error });
    await sleep(300);
  }
  ledger.close();
  console.log(`[injector-arm] 完成：${n} 次 → ${ledger.file}`);
}

// -------------------------------------------------------------- negatives ----

/** UAT-PES-04b 快路径安全负例（真实请求留证；脱敏：不写密码／cookie 值）。 */
async function cmdNegatives(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const adminId = args.admin ?? process.env.PES_ADMIN_ID ?? "xingchen";
  const password = readSecret(args["password-file"], "PES_ADMIN_PASSWORD");
  const cookie = readSecret(args["cookie-file"], "PES_ADMIN_COOKIE");
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "negatives.jsonl");
  const results = [];
  const record = (name, ok, detail) => {
    results.push({ name, ok });
    ledger.write({ kind: "negative", name, ok, ...detail });
    console.log(`[negatives] ${ok ? "PASS" : "FAIL"} ${name}${detail?.note ? ` — ${detail.note}` : ""}`);
  };

  // 1. 错误密码 → 401 且无 Set-Cookie。
  {
    const r = await timedFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId, password: `${password.slice(0, 2)}wrong-password-tail` }),
      timeoutMs: 15_000
    });
    const setCookie = r.headers["set-cookie"] ?? "";
    record("wrong-password-401-no-cookie", r.status === 401 && !setCookie.includes("lucy_admin_session="), { status: r.status, totalMs: r.totalMs, setCookie: setCookie ? "(present)" : "(none)" });
  }

  // 2. 跨站请求按既有 CSRF 语义拒绝（带恶意 Origin 的 POST login）。
  {
    const r = await timedFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
      body: JSON.stringify({ adminId, password }),
      timeoutMs: 15_000
    });
    record("cross-site-csrf-denied", r.status === 403, { status: r.status, totalMs: r.totalMs });
  }

  // 3. 超限 429（连续错误密码触发既有限流）。
  {
    let saw429 = false;
    for (let i = 0; i < 12 && !saw429; i++) {
      const r = await timedFetch(`${base}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId, password: `wrong-${i}-password` }),
        timeoutMs: 15_000
      });
      if (r.status === 429) saw429 = true;
    }
    record("rate-limit-429", saw429, { note: saw429 ? "(在 12 次错误密码内触发 429)" : "(12 次内未见 429)" });
  }

  // 4. auth/status 带 Cache-Control: no-store。
  {
    const r = await timedFetch(`${base}/api/auth/status`, { timeoutMs: 10_000 });
    record("auth-status-no-store", r.status === 200 && (r.headers["cache-control"] ?? "").includes("no-store"), { status: r.status, cacheControl: r.headers["cache-control"] });
  }

  // 5. 非目标受保护 API 未带 Session 仍被拒。
  {
    const sources = await timedFetch(`${base}/api/sources`, { timeoutMs: 10_000 });
    const admin = await timedFetch(`${base}/api/admin/audit`, { timeoutMs: 10_000 });
    record("protected-api-still-denied", sources.status === 401 && admin.status === 401, { status: `${sources.status}/${admin.status}` });
  }

  // 6. 吊销 Session：logout 后旧 cookie 的 auth/status me 为空。
  {
    const login = await timedFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId, password }),
      timeoutMs: 15_000
    });
    const freshCookie = (login.headers["set-cookie"] ?? "").split(";")[0];
    if (!freshCookie.includes("lucy_admin_session=")) {
      record("revoked-session-me-empty", false, { note: "login 未签发，无法验证吊销" });
    } else {
      await timedFetch(`${base}/api/auth/logout`, { method: "POST", headers: { Cookie: freshCookie }, timeoutMs: 15_000 });
      const after = await timedFetch(`${base}/api/auth/status`, { headers: { Cookie: freshCookie }, timeoutMs: 10_000 });
      let meEmpty = false;
      try { meEmpty = JSON.parse(after.text())?.data?.me === null; } catch { /* 解析失败即不通过 */ }
      record("revoked-session-me-empty", after.status === 200 && meEmpty, { status: after.status });
    }
  }

  // 7. SC-07 计数器读取（供 UAT-PES-07 判定；混压窗结束后由 judge 复核）。
  {
    const health = await timedFetch(`${base}/api/health`, { timeoutMs: 10_000 });
    let counters = null;
    try { counters = JSON.parse(health.text())?.data?.publicEntryHeavyWork ?? null; } catch { /* keep null */ }
    const zero = counters && counters.mcpUpstreamAttempts === 0 && counters.displayFullBuilds === 0 && counters.heavyAuditScans === 0;
    record("sc07-counters-zero", Boolean(zero), { counters });
  }

  ledger.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`[negatives] ${results.length - failed.length}/${results.length} PASS → ${ledger.file}`);
  if (failed.length > 0) process.exitCode = 1;
}

// ------------------------------------------------------------- dual-status ----

/** UAT-PES-03：双 Session 交错探测 auth/status，确认无串身份。 */
async function cmdDualStatus(args) {
  const base = args.url ?? DEFAULT_WEBUI;
  const adminId = args.admin ?? process.env.PES_ADMIN_ID ?? "xingchen";
  const password = readSecret(args["password-file"], "PES_ADMIN_PASSWORD");
  const secondId = args["second-admin"] ?? process.env.PES_ADMIN2_ID;
  const secondPassword = args["second-password-file"] ? readSecret(args["second-password-file"], "PES_ADMIN2_PASSWORD") : null;
  const count = Number(args.count ?? 30);
  const outDir = args.out ?? "inbox/p184-uat/evidence";
  const ledger = openLedger(outDir, "dual-status.jsonl");

  async function loginAs(id, pwd) {
    const r = await timedFetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ adminId: id, password: pwd }),
      timeoutMs: 15_000
    });
    return (r.headers["set-cookie"] ?? "").split(";")[0];
  }

  const cookieA = await loginAs(adminId, password);
  let cookieB = null;
  let idB = null;
  if (secondId && secondPassword) {
    cookieB = await loginAs(secondId, secondPassword);
    idB = secondId;
  }
  let mismatches = 0;
  let samples = 0;
  for (let i = 1; i <= count; i++) {
    const cookie = i % 2 === 1 ? cookieA : (cookieB ?? cookieA);
    const expectedId = i % 2 === 1 ? adminId : (idB ?? adminId);
    const r = await timedFetch(`${base}/api/auth/status`, { headers: { Cookie: cookie }, timeoutMs: 10_000 });
    let meId = null;
    try { meId = JSON.parse(r.text())?.data?.me?.id ?? null; } catch { /* 保持 null */ }
    samples += 1;
    const ok = r.status === 200 && meId === expectedId;
    if (!ok) mismatches += 1;
    ledger.write({ kind: "dual-status", tick: i, expectedId, meId, ok, status: r.status, totalMs: r.totalMs, error: r.error });
  }
  ledger.close();
  console.log(`[dual-status] samples=${samples} mismatches=${mismatches} → ${ledger.file}`);
  if (mismatches > 0 || !cookieA.includes("lucy_admin_session=")) process.exitCode = 1;
}

// ---------------------------------------------------------------- judge ----

async function cmdJudge(args) {
  const dir = args.dir ?? args.out ?? "inbox/p184-uat/evidence";
  const files = args.files ? String(args.files).split(",") : ["probes.jsonl", "logins.jsonl", "mcp-arm.jsonl", "display-arm.jsonl"];
  const samples = [];
  for (const name of files) {
    const file = path.join(dir, name);
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line) continue;
        const row = JSON.parse(line);
        if (row.kind === "eventloop" || row.error != null || row.status != null) samples.push(row);
      }
    } catch { /* 缺文件按 0 样本处理 */ }
  }
  const perPath = summarizeSamples(samples.filter((s) => s.kind !== "eventloop"));
  const eventLoop = judgeEventLoop(samples.filter((s) => s.kind === "eventloop"));
  const ok = perPath.every((p) => p.ok !== false) && eventLoop.ok;
  const verdict = { ok, perPath, eventLoop };
  const outFile = path.join(dir, "verdict.json");
  writeFileSync(outFile, JSON.stringify(verdict, null, 2) + "\n");
  console.log(JSON.stringify(verdict, null, 2));
  console.log(`[judge] ${ok ? "PASS" : "FAIL"} → ${outFile}`);
  if (!ok) process.exitCode = 1;
}

// ----------------------------------------------------------------- main ----

const COMMANDS = {
  probe: cmdProbe,
  "login-probe": cmdLoginProbe,
  "mcp-arm": cmdMcpArm,
  "display-arm": cmdDisplayArm,
  "injector-arm": cmdInjectorArm,
  negatives: cmdNegatives,
  "dual-status": cmdDualStatus,
  judge: cmdJudge
};

const args = parseArgs(process.argv.slice(2));
const command = args._[0];
const handler = COMMANDS[command];
if (!handler) {
  console.error(`用法：node scripts/uat/public-entry-static.mjs <${Object.keys(COMMANDS).join("|")}> [选项]`);
  process.exit(2);
}
try {
  await handler(args);
} catch (error) {
  console.error(`[public-entry-static] ${command} 失败：`, error);
  process.exit(1);
}
