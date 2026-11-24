#!/usr/bin/env node
/**
 * UAT-RACS scale/stress runner — seed / load / burst / verify / cleanup against live demo Docker.
 *
 * 规模档（默认）：roles=300、agents=110、tokensPerAgent=10 → ≥1000 tokens。
 * 全部走真实 WebUI API（真实 SQLite / access.yaml / 发布窗口），不 mock、不直改文件。
 *
 * 用法：
 *   node scripts/uat/roles-agent-scale-stress.mjs seed [--roles 300] [--agents 110] [--tokens-per-agent 10]
 *   node scripts/uat/roles-agent-scale-stress.mjs load [--rps 10] [--duration-sec 60] [--sessions 5]
 *   node scripts/uat/roles-agent-scale-stress.mjs burst [--concurrency 50]
 *   node scripts/uat/roles-agent-scale-stress.mjs verify
 *   node scripts/uat/roles-agent-scale-stress.mjs cleanup
 *   node scripts/uat/roles-agent-scale-stress.mjs all
 *
 * 环境：LUCY_DEMO_WEBUI（默认 http://127.0.0.1:55176）、
 * LUCY_DEMO_ADMIN_ID + LUCY_DEMO_ADMIN_PASSWORD，或 LUCY_DEMO_LOGIN_FILE（仓库外；
 * 支持 "姓名：/密码：" 或裸行 id/pw）、LUCY_SMOKE_OUT。
 * 不打印 secret。429/5xx 有限指数退避重试（最多 5 次）；写操作不重放已确认提交之外的请求。
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.LUCY_DEMO_WEBUI || "http://127.0.0.1:55176";
const LOGIN_FILE =
  process.env.LUCY_DEMO_LOGIN_FILE ||
  "/Users/zhangxingchen/Projects/config_for_agents/lucy-docker-demo-webui.txt";
const OUT_DIR =
  process.env.LUCY_SMOKE_OUT ||
  join(dirname(fileURLToPath(import.meta.url)), "../../inbox/uat-racs-stress-2026-11-20");
// Deleted role ids are retired and cannot be reused — each seed needs a fresh prefix.
const PREFIX =
  process.env.LUCY_RACS_PREFIX ||
  `uat_racs_${new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14)}`;

const args = process.argv.slice(2);
const cmd = args[0] || "all";
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : dflt;
};

const ROLE_COUNT = Number(opt("roles", 300));
const AGENT_COUNT = Number(opt("agents", 110));
const TPA = Number(opt("tokens-per-agent", 10));
const RPS = Number(opt("rps", 10));
const DURATION_SEC = Number(opt("duration-sec", 60));
const SESSIONS = Number(opt("sessions", 5));
const BURST_N = Number(opt("concurrency", 50));

mkdirSync(OUT_DIR, { recursive: true });

function resolveCred() {
  const envId = process.env.LUCY_DEMO_ADMIN_ID?.trim();
  const envPw = process.env.LUCY_DEMO_ADMIN_PASSWORD;
  if (envId && envPw) return { adminId: envId, password: envPw };
  if (!existsSync(LOGIN_FILE)) {
    throw new Error("no LUCY_DEMO_ADMIN_ID/PASSWORD and login file missing");
  }
  return parseLogin(readFileSync(LOGIN_FILE, "utf8"));
}

function parseLogin(raw) {
  const text = raw.replace(/^\uFEFF/, "");
  const namedId = text.match(/(?:姓名|adminId|账号|账号id)[：:]\s*(\S+)/i)?.[1];
  const namedPw = text.match(/(?:密码|password)[：:]\s*(\S+)/i)?.[1];
  if (namedId && namedPw) return { adminId: namedId, password: namedPw };
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^https?:\/\//i.test(l) && !/^(url|mcp|created|note|地址|webui)\b/i.test(l));
  if (lines.length >= 2) return { adminId: lines[0], password: lines[1] };
  throw new Error("login file unparseable");
}

function cookieJar(res) {
  const raw = res.headers.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).join("; ");
}

async function api(path, { method = "GET", cookie, body, timeoutMs = 30000 } = {}) {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${WEB}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
  } finally {
    clearTimeout(timer);
  }
  const ms = Math.round((performance.now() - t0) * 100) / 100;
  const ct = res.headers.get("content-type") || "";
  let json = null;
  if (ct.includes("application/json")) json = await res.json().catch(() => null);
  else await res.text().catch(() => "");
  return { path, method, status: res.status, ms, serverTiming: res.headers.get("server-timing"), json };
}

async function apiRetry(path, opts = {}, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    last = await api(path, opts);
    if (last.status !== 429 && last.status < 500) return last;
    await new Promise((r) => setTimeout(r, Math.min(2000, 300 * 2 ** i)));
  }
  return last;
}

async function login() {
  const cred = resolveCred();
  const res = await fetch(`${WEB}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: cred.adminId, password: cred.password })
  });
  const cookie = cookieJar(res);
  if (res.status !== 200 || !cookie) throw new Error(`login failed status=${res.status}`);
  return cookie;
}

const ROLE_TABLES = ["superstore_orders", "superstore_returns", "superstore_people"];
const ROLE_TOOLS = ["lucy_catalog", "lucy_query", "lucy_read_source", "connection_list"];

function roleBody(i) {
  const id = `${PREFIX}_r${String(i).padStart(3, "0")}`;
  return {
    roleId: id,
    dryRun: false,
    role: {
      description: `UAT RACS stress role ${id}`,
      permission_model_version: 2,
      allow: {
        connections: ["demo-mysql"],
        tableSelectors: [
          {
            connection: "demo-mysql",
            schema: "dataforai",
            names: [ROLE_TABLES[i % ROLE_TABLES.length]],
            row_access: "all"
          }
        ],
        tools: ROLE_TOOLS.slice(0, 2 + (i % 3))
      }
    }
  };
}

function agentBody(i) {
  const id = `${PREFIX}_a${String(i).padStart(3, "0")}`;
  return {
    dryRun: false,
    agent: {
      id,
      name: `UAT RACS A${String(i).padStart(3, "0")}`,
      roles: [`${PREFIX}_r${String((i % ROLE_COUNT) + 1).padStart(3, "0")}`],
      note: "UAT scale stress fixture; safe to delete."
    }
  };
}

function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

function summarize(records) {
  const byKey = {};
  for (const r of records) {
    const key = r.key;
    (byKey[key] ??= []).push(r);
  }
  const out = {};
  for (const [key, list] of Object.entries(byKey)) {
    const ms = list.map((r) => r.ms).sort((a, b) => a - b);
    const statuses = {};
    for (const r of list) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
    out[key] = {
      n: list.length,
      statuses,
      okRate: Math.round((list.filter((r) => r.status === 200).length / list.length) * 1000) / 10,
      p50: pct(ms, 0.5),
      p95: pct(ms, 0.95),
      p99: pct(ms, 0.99),
      max: ms[ms.length - 1],
      min: ms[0]
    };
  }
  return out;
}

function writeJson(name, data) {
  const p = join(OUT_DIR, name);
  writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

async function cmdSeed() {
  const cookie = await login();
  const report = {
    at: new Date().toISOString(),
    web: WEB,
    prefix: PREFIX,
    plan: { roles: ROLE_COUNT, agents: AGENT_COUNT, tokensPerAgent: TPA },
    roleCreates: [],
    agentCreates: [],
    tokenIssues: [],
    failures: []
  };
  console.log(`seed prefix=${PREFIX}`);
  const tStart = performance.now();

  // roles
  for (let i = 1; i <= ROLE_COUNT; i++) {
    const r = await apiRetry("/api/admin/roles", { method: "POST", cookie, body: roleBody(i) });
    report.roleCreates.push({ i, ms: r.ms, status: r.status, code: r.json?.error?.code ?? null });
    if (r.status !== 200) report.failures.push({ step: "role", i, status: r.status, code: r.json?.error?.code });
    if (i % 50 === 0) console.log(`roles ${i}/${ROLE_COUNT} (${Math.round(performance.now() - tStart)}ms elapsed)`);
  }

  // agents
  for (let i = 1; i <= AGENT_COUNT; i++) {
    const r = await apiRetry("/api/admin/agents", { method: "POST", cookie, body: agentBody(i) });
    report.agentCreates.push({ i, ms: r.ms, status: r.status, code: r.json?.error?.code ?? null });
    if (r.status !== 200) report.failures.push({ step: "agent", i, status: r.status, code: r.json?.error?.code });
    if (i % 20 === 0) console.log(`agents ${i}/${AGENT_COUNT}`);
  }

  // tokens
  const totalTokens = AGENT_COUNT * TPA;
  let issued = 0;
  for (let a = 1; a <= AGENT_COUNT; a++) {
    const userId = `${PREFIX}_a${String(a).padStart(3, "0")}`;
    for (let t = 1; t <= TPA; t++) {
      const r = await apiRetry(
        `/api/admin/agents/${encodeURIComponent(userId)}/tokens`,
        { method: "POST", cookie, body: { label: `stress-${String(t).padStart(2, "0")}`, expires_in: "30d", device_name: "uat-racs-stress" } }
      );
      issued++;
      report.tokenIssues.push({ a, t, ms: r.ms, status: r.status, code: r.json?.error?.code ?? null });
      if (r.status !== 200) report.failures.push({ step: "token", a, t, status: r.status, code: r.json?.error?.code });
    }
    if (a % 10 === 0) console.log(`tokens agent ${a}/${AGENT_COUNT} (issued ${issued}/${totalTokens})`);
  }

  report.elapsedMs = Math.round(performance.now() - tStart);
  report.summary = {
    roles: summarize(report.roleCreates.map((r) => ({ key: "POST /api/admin/roles", ...r }))),
    agents: summarize(report.agentCreates.map((r) => ({ key: "POST /api/admin/agents", ...r }))),
    tokens: summarize(report.tokenIssues.map((r) => ({ key: "POST /api/admin/agents/:id/tokens", ...r })))
  };
  const p = writeJson(`seed-${Date.now()}.json`, report);
  console.log(JSON.stringify({ out: p, failures: report.failures.length, elapsedMs: report.elapsedMs, summary: report.summary }, null, 2));
  return report.failures.length === 0 ? 0 : 1;
}

async function cmdVerify() {
  const cookie = await login();
  // 写入风暴期读取可能 503 DISPLAY_SNAPSHOT_BUSY；退避重试至 30 秒
  const roles = await apiRetry("/api/admin/roles", { cookie, timeoutMs: 30000 }, 10);
  const agents = await apiRetry("/api/admin/agents?view=roster", { cookie, timeoutMs: 30000 }, 10);
  const roleList = roles.json?.data?.roles ?? roles.json?.roles ?? [];
  const agentList = agents.json?.data?.agents ?? agents.json?.agents ?? [];
  if (!Array.isArray(roleList) || !Array.isArray(agentList)) {
    console.error("unreadable envelope:", JSON.stringify(roles.json ?? roles.status).slice(0, 200), JSON.stringify(agents.json ?? agents.status).slice(0, 200));
    return 2;
  }
  const fixtureRoles = roleList.filter((r) => String(r.id ?? r.roleId ?? "").startsWith(`${PREFIX}_`));
  const fixtureAgents = agentList.filter((a) => String(a.id ?? a.userId ?? "").startsWith(`${PREFIX}_`));
  const result = {
    at: new Date().toISOString(),
    prefix: PREFIX,
    totalRoles: roleList.length,
    totalAgents: agentList.length,
    fixtureRoles: fixtureRoles.length,
    fixtureAgents: fixtureAgents.length,
    baselineRoles: roleList.length - fixtureRoles.length,
    baselineAgents: agentList.length - fixtureAgents.length
  };
  console.log(JSON.stringify(result, null, 2));
  const p = writeJson(`verify-${Date.now()}.json`, result);
  console.log(p);
  return 0;
}

async function cmdLoad() {
  const cookies = [];
  for (let s = 0; s < SESSIONS; s++) {
    cookies.push(await login());
    console.log(`session ${s + 1}/${SESSIONS} logged in`);
  }
  const records = [];
  const planTotal = RPS * DURATION_SEC;
  let planned = 0;
  let dropped = 0;
  const t0 = performance.now();
  const interval = 1000 / RPS;

  const routes = (i) => {
    // 角色 50%；Agent 相关 50%（full 25 / roster 12.5 / statistics 12.5）
    // range 必须与 bucket 解耦：旧写法 i%8===7 时 i%4 恒为 3，statistics 只会打到 30d。
    const bucket = i % 8;
    const range = ["7d", "7d", "14d", "30d"][Math.floor(i / 8) % 4];
    if (bucket < 4) return { key: "GET /api/admin/roles", path: "/api/admin/roles" };
    if (bucket < 6) return { key: `GET /api/admin/agents?range=${range}`, path: `/api/admin/agents?range=${range}` };
    if (bucket < 7) return { key: "GET /api/admin/agents?view=roster", path: "/api/admin/agents?view=roster" };
    return { key: `GET /api/admin/agents/statistics?range=${range}`, path: `/api/admin/agents/statistics?range=${range}` };
  };

  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (planned >= planTotal) {
        clearInterval(timer);
        resolve();
        return;
      }
      const idx = planned++;
      const route = routes(idx);
      const cookie = cookies[idx % cookies.length];
      const start = performance.now();
      api(route.path, { cookie, timeoutMs: 15000 })
        .then((r) => records.push({ seq: idx, key: route.key, status: r.status, ms: Math.round((performance.now() - start) * 100) / 100, serverTiming: r.serverTiming }))
        .catch((e) => records.push({ seq: idx, key: route.key, status: 0, ms: Math.round((performance.now() - start) * 100) / 100, error: String(e?.name || e) }))
        .finally(() => {
          if (records.length + dropped >= planTotal) {
            clearInterval(timer);
            resolve();
          }
        });
    }, interval);
    // 安全兜底：到时长结束即收口（超时样本保留真实截止时长，不删样本）
    setTimeout(() => {
      clearInterval(timer);
      resolve();
    }, DURATION_SEC * 1000 + 20000);
  });

  const elapsed = Math.round(performance.now() - t0);
  const sent = planned;
  const completed = records.length;
  const summary = summarize(records);
  const report = {
    at: new Date().toISOString(),
    web: WEB,
    load: { rps: RPS, durationSec: DURATION_SEC, sessions: SESSIONS, planTotal },
    actual: { planned: sent, completed, dropped, actualRps: Math.round((completed / (elapsed / 1000)) * 100) / 100, elapsedMs: elapsed },
    summary,
    records
  };
  const p = writeJson(`load-rps${RPS}-${Date.now()}.json`, report);
  console.log(JSON.stringify({ out: p, actual: report.actual, summary }, null, 2));
  return 0;
}

async function cmdBurst() {
  const cookie = await login();
  const t0 = performance.now();
  const results = await Promise.all(
    Array.from({ length: BURST_N }, () => api("/api/admin/roles", { cookie }))
  );
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  const report = {
    at: new Date().toISOString(),
    concurrency: BURST_N,
    statuses,
    p50: pct(ms, 0.5),
    p95: pct(ms, 0.95),
    p99: pct(ms, 0.99),
    max: ms[ms.length - 1],
    totalMs: Math.round(performance.now() - t0),
    serverTimingSamples: results.slice(0, 3).map((r) => r.serverTiming)
  };
  const p = writeJson(`burst-${BURST_N}x-${Date.now()}.json`, report);
  console.log(JSON.stringify({ out: p, ...report }, null, 2));
  return 0;
}

async function cmdCleanup() {
  const cookie = await login();
  const report = { at: new Date().toISOString(), prefix: PREFIX, agentDeletes: [], roleDeletes: [], failures: [] };
  const tStart = performance.now();

  const agents = await api("/api/admin/agents?view=roster", { cookie });
  // Match any uat_racs* leftover unless PREFIX is an exact run id; default cleans current PREFIX only.
  const matchPrefix = process.env.LUCY_RACS_CLEAN_ALL === "1" ? "uat_racs" : PREFIX;
  const agentList = (agents.json?.data?.agents ?? agents.json?.agents ?? [])
    .map((a) => a.id ?? a.userId)
    .filter((id) => String(id).startsWith(`${matchPrefix}`));
  const roles = await api("/api/admin/roles", { cookie });
  const roleList = (roles.json?.data?.roles ?? roles.json?.roles ?? [])
    .map((r) => r.id ?? r.roleId)
    .filter((id) => String(id).startsWith(`${matchPrefix}`));
  console.log(`cleanup matchPrefix=${matchPrefix} agents=${agentList.length} roles=${roleList.length}`);

  for (const id of agentList) {
    // 与创建一致：DELETE 默认 dryRun=true，必须显式 dryRun:false 才真删
    const r = await apiRetry(`/api/admin/agents/${encodeURIComponent(id)}`, { method: "DELETE", cookie, body: { dryRun: false } });
    report.agentDeletes.push({ id, ms: r.ms, status: r.status });
    if (r.status !== 200 && r.status !== 404) report.failures.push({ step: "agent-delete", id, status: r.status, code: r.json?.error?.code });
  }
  console.log(`deleted ${report.agentDeletes.length} agents`);

  for (const id of roleList) {
    // 与创建一致：DELETE 默认 dryRun=true，必须显式 dryRun:false 才真删
    const r = await apiRetry(`/api/admin/roles/${encodeURIComponent(id)}`, { method: "DELETE", cookie, body: { dryRun: false } });
    report.roleDeletes.push({ id, ms: r.ms, status: r.status });
    if (r.status !== 200 && r.status !== 404) report.failures.push({ step: "role-delete", id, status: r.status, code: r.json?.error?.code });
  }
  console.log(`deleted ${report.roleDeletes.length} roles`);

  // 还原验证
  const roles2 = await api("/api/admin/roles", { cookie });
  const agents2 = await api("/api/admin/agents?view=roster", { cookie });
  const leftoverRoles = (roles2.json?.data?.roles ?? roles2.json?.roles ?? []).filter((r) =>
    String(r.id ?? r.roleId).startsWith(`${matchPrefix}`)
  );
  const leftoverAgents = (agents2.json?.data?.agents ?? agents2.json?.agents ?? []).filter((a) =>
    String(a.id ?? a.userId).startsWith(`${matchPrefix}`)
  );
  report.verify = {
    totalRoles: (roles2.json?.data?.roles ?? roles2.json?.roles ?? []).length,
    totalAgents: (agents2.json?.data?.agents ?? agents2.json?.agents ?? []).length,
    leftoverFixtureRoles: leftoverRoles.length,
    leftoverFixtureAgents: leftoverAgents.length
  };
  report.elapsedMs = Math.round(performance.now() - tStart);
  const p = writeJson(`cleanup-${Date.now()}.json`, report);
  console.log(JSON.stringify({ out: p, failures: report.failures.length, verify: report.verify }, null, 2));
  return report.failures.length === 0 ? 0 : 1;
}

const commands = { seed: cmdSeed, load: cmdLoad, burst: cmdBurst, verify: cmdVerify, cleanup: cmdCleanup };
try {
  let code = 0;
  if (cmd === "all") {
    for (const c of [cmdSeed, cmdLoad, cmdBurst, cmdCleanup]) code = (await c()) || code;
  } else {
    code = await commands[cmd]();
  }
  process.exit(code ?? 0);
} catch (err) {
  console.error(String(err?.stack || err));
  process.exit(2);
}
