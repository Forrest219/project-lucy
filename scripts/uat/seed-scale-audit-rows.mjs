#!/usr/bin/env node
/**
 * seed-scale-audit-rows.mjs — UAT 规模基线造数 ③：审计调用行灌库。
 *
 * SOT：docs/qa/uat/scale-baseline.md。写入 audit.sqlite 的 access_log（+
 * 少量 access_log_sources），ops_calls／ops_call_tables 为视图即时可见。
 * 行量：30 天窗 20 万（近7天50%／7–14天25%／14–30天25%）＋全历史 100 万
 * （窗内 20 万＋31–365 天 80 万），另加 RACS fixtures §3 边界用例行。
 * 分布：80% 集中在 20% Agent；最热单 Agent ≥ 窗内 20%（≥4 万行）；
 * 含无历史 Agent、仅 90 天前活跃 Agent、同毫秒不同 id、窗边界前后各一条。
 *
 * 幂等：所有造数行 request_id 以 'uat-scale-' 前缀，重跑先按前缀删除（含 sources）。
 * 机制：不停机——先 sqlite .backup() 在线一致性备份，再 WAL 并发灌库；
 * ops_calls／ops_call_tables 为视图即时可见，无需重启。
 *
 * 用法：node scripts/uat/seed-scale-audit-rows.mjs
 * 覆盖：UAT_LUCY_CONTAINER（compose-lucy-1）、UAT_WINDOW_ROWS（200000）、
 *       UAT_HISTORY_ROWS（800000）、LUCY_DEMO_WEBUI_HOST_PORT（55176）
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LUCY = process.env.UAT_LUCY_CONTAINER || "compose-lucy-1";
const AUDIT_DB = "/data/lucy/.ktx-ui/audit.sqlite";
const WINDOW_ROWS = Number(process.env.UAT_WINDOW_ROWS || 200_000);
const HISTORY_ROWS = Number(process.env.UAT_HISTORY_ROWS || 800_000);
// 窗内多灌 500 行余量：任何晚于灌库时刻的校验（now-30d 切边）都会掉几十行，
// 余量保证视图口径计数仍 ≥ 基线 20 万
const WINDOW_HEADROOM = Number(process.env.UAT_WINDOW_HEADROOM || 500);
const HEALTH_URL = `http://127.0.0.1:${process.env.LUCY_DEMO_WEBUI_HOST_PORT || 55176}/api/health`;
const SEED = 20261123;
const MS_DAY = 86_400_000;

function docker(...args) {
  return execFileSync("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
}

// 在容器内执行的灌库脚本：确定性 PRNG + 分事务批量插入
const INSERTER_JS = String.raw`
const D = require("/app/node_modules/better-sqlite3");
const SEED = ${SEED};
const WINDOW_ROWS = ${WINDOW_ROWS};
const HISTORY_ROWS = ${HISTORY_ROWS};
const WINDOW_HEADROOM = ${WINDOW_HEADROOM};
const MS_DAY = 86400000;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const iso = (d) => new Date(d).toISOString();

// ---- Agent 人口（与 access.yaml 对齐：uat_agent_001..498 + demo 两个） ----
const AGENTS = [];
for (let i = 1; i <= 498; i++) AGENTS.push("uat_agent_" + String(i).padStart(3, "0"));
AGENTS.push("demo_agent", "demo_ops");
const NO_HISTORY_AGENT = "uat_agent_498";      // 无历史用户
const NINETY_DAY_AGENT = "uat_agent_497";      // 仅 90 天前活跃
const HOTTEST = "uat_agent_001";               // 最热单 Agent ≥ 窗内 20%
const HOT_COUNT = 100;                          // 20% 热 Agent（不含 hottest）
const hot = AGENTS.filter(a => a !== HOTTEST && a !== NO_HISTORY_AGENT && a !== NINETY_DAY_AGENT)
  .sort(() => rand() - 0.5).slice(0, HOT_COUNT);
const warm = AGENTS.filter(a => !hot.includes(a) && a !== HOTTEST &&
  a !== NO_HISTORY_AGENT && a !== NINETY_DAY_AGENT);

const TOOLS = ["lucy_query", "lucy_query", "lucy_query", "lucy_read_source",
  "wiki_search", "wiki_read", "lucy_catalog", "dictionary_search"];
const SOURCES = [
  ["demo-mysql", "dataforai", "superstore_orders"],
  ["demo-mysql", "dataforai", "superstore_orders"],
  ["demo-mysql", "dataforai", "superstore_returns"],
  ["demo-mysql", "dataforai", "superstore_people"],
];

const now = Date.now();
const DAY_START = (daysBack) => now - daysBack * MS_DAY;

let seq = 0;
const nextReq = (tag) => "uat-scale-" + tag + "-" + String(++seq).padStart(9, "0");

const db = new D(process.env.AUDIT_DB, { fileMustExist: true });

// 幂等清理
const del = db.prepare("DELETE FROM access_log_sources WHERE access_log_id IN (SELECT id FROM access_log WHERE request_id LIKE 'uat-scale-%')");
const del2 = db.prepare("DELETE FROM access_log WHERE request_id LIKE 'uat-scale-%'");
db.transaction(() => { del.run(); del2.run(); })();
console.log("[inserter] 旧造数行已清理");

const insLog = db.prepare(
  "INSERT INTO access_log (ts, user_id, token_label, tool, outcome, duration_ms, request_id, response_row_count, role_ids, eval_mark) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)");
const insSrc = db.prepare(
  "INSERT INTO access_log_sources (access_log_id, ts, user_id, tool, connection_id, schema_name, source_name, physical_table, extraction_method, confidence, created_at) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'parser', 'high', ?)");

function makeRow(ts, agent, tag, withSource) {
  const tool = pick(TOOLS);
  const outcome = rand() < 0.95 ? "ok" : "denied";
  const req = nextReq(tag);
  const info = insLog.run(
    iso(ts), agent, "tk" + int(1, 3), tool, outcome,
    int(15, 900), req, outcome === "ok" ? int(0, 500) : 0,
    JSON.stringify(["uat_role_" + String(int(1, 197)).padStart(3, "0")]));
  if (withSource && tool === "lucy_query") {
    const s = pick(SOURCES);
    insSrc.run(info.lastInsertRowid, iso(ts), agent, tool, s[0], s[1], s[2],
      s[1] + "." + s[2], iso(ts));
  }
}

// ---- 30 天窗：20 万＋500 余量 ----------------------------------------------
// 近7天 50%、7–14 天 25%、14–30 天 25%；hottest 占窗内 20%
const windowTotal = WINDOW_ROWS + WINDOW_HEADROOM;
const windowSpec = [
  { rows: Math.floor(windowTotal * 0.5), fromDays: 0, toDays: 7 },
  { rows: Math.floor(windowTotal * 0.25), fromDays: 7, toDays: 14 },
  { rows: windowTotal - Math.floor(windowTotal * 0.5) - Math.floor(windowTotal * 0.25), fromDays: 14, toDays: 30 },
];
let hottestRemaining = Math.ceil(windowTotal * 0.2);
function windowAgent() {
  if (hottestRemaining > 0) { hottestRemaining--; return HOTTEST; }
  const r = rand();
  if (r < 0.8) return hot[Math.floor(rand() * hot.length)];
  return warm[Math.floor(rand() * warm.length)];
}

let inserted = 0;
for (const spec of windowSpec) {
  const chunk = 25_000;
  for (let done = 0; done < spec.rows; done += chunk) {
    const n = Math.min(chunk, spec.rows - done);
    db.transaction(() => {
      for (let i = 0; i < n; i++) {
        const ts = DAY_START(spec.fromDays) - Math.floor(rand() * (spec.toDays - spec.fromDays) * MS_DAY);
        makeRow(ts, windowAgent(), "w", true);
      }
    })();
    inserted += n;
    console.log("[inserter] 窗内行累计 " + inserted);
  }
}

// ---- 全历史：80 万（31–365 天） --------------------------------------------
const histChunk = 50_000;
for (let done = 0; done < HISTORY_ROWS; done += histChunk) {
  const n = Math.min(histChunk, HISTORY_ROWS - done);
  db.transaction(() => {
    for (let i = 0; i < n; i++) {
      const ts = DAY_START(31) - Math.floor(rand() * 335 * MS_DAY);
      const agent = rand() < 0.8 ? hot[Math.floor(rand() * hot.length)]
        : warm[Math.floor(rand() * warm.length)];
      makeRow(ts, agent, "h", false);
    }
  })();
  inserted += n;
  console.log("[inserter] 全历史累计 " + inserted);
}

// ---- 边界用例行（RACS fixtures §3） ----------------------------------------
const cutoffTs = DAY_START(30);
db.transaction(() => {
  const cutoff = cutoffTs;
  makeRow(cutoff - 1, "uat_agent_002", "boundary", false);   // 窗边界前一条
  makeRow(cutoff, "uat_agent_003", "boundary", false);       // 边界恰一条（窗内）
  makeRow(cutoff + 1, "uat_agent_004", "boundary", false);   // 窗边界后一条
  const sameMs = DAY_START(2);
  makeRow(sameMs, "uat_agent_005", "samems", false);         // 同毫秒不同 id
  makeRow(sameMs, "uat_agent_005", "samems", false);
  makeRow(DAY_START(90), NINETY_DAY_AGENT, "n90", false);    // 仅 90 天前活跃
  makeRow(DAY_START(90) - int(0, 5) * MS_DAY, NINETY_DAY_AGENT, "n90", false);
  // NO_HISTORY_AGENT 不造行（无历史用户）
})();
console.log("[inserter] 边界用例行已写入");

const total = db.prepare("SELECT COUNT(*) c FROM access_log WHERE request_id LIKE 'uat-scale-%'").get().c;
const win = db.prepare("SELECT COUNT(*) c FROM access_log WHERE request_id LIKE 'uat-scale-%' AND ts >= ?").get(iso(new Date(cutoffTs)));
const hotCount = db.prepare("SELECT COUNT(*) c FROM access_log WHERE user_id = ? AND ts >= ?").get(HOTTEST, iso(new Date(cutoffTs)));
console.log(JSON.stringify({ total, window30: win.c, hottest30: hotCount.c }));
db.close();
`;

function ensureRunning() {
  let running = false;
  try {
    running = docker("inspect", "-f", "{{.State.Running}}", LUCY).toString().trim() === "true";
  } catch {
    running = false;
  }
  if (running) return;
  docker("start", LUCY);
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    try {
      const out = execFileSync("curl", ["-sf", HEALTH_URL], { stdio: ["pipe", "pipe", "pipe"] }).toString();
      if (out.includes("gitSha")) return;
    } catch {
      // retry
    }
    execFileSync("sleep", ["3"]);
  }
  throw new Error("健康检查超时：" + HEALTH_URL);
}

// 在容器内执行的一致性备份（VACUUM INTO，不依赖停机、不受 readonly 连接限制）
const BACKUP_JS = String.raw`
const D = require("/app/node_modules/better-sqlite3");
const db = new D(process.env.AUDIT_DB, { fileMustExist: true });
const target = process.argv[2];
db.exec("VACUUM INTO '" + target + "'");
db.close();
console.log("backed-up " + target);
`;

function main() {
  console.log(`[seed-audit] 目标：窗内 ${WINDOW_ROWS}／全历史 ${HISTORY_ROWS}＋边界行`);
  const tmp = mkdtempSync(path.join(tmpdir(), "uat-seed-audit-"));
  ensureRunning();

  // 1) 一致性备份（容器运行态，不停止服务）
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const backupJs = path.join(tmp, "backup.js");
  writeFileSync(backupJs, BACKUP_JS);
  docker("cp", backupJs, `${LUCY}:/tmp/uat-audit-backup.js`);
  execFileSync("docker", ["exec", "-e", `AUDIT_DB=${AUDIT_DB}`, LUCY, "node",
    "/tmp/uat-audit-backup.js", `${AUDIT_DB}.bak-${stamp}`], { stdio: ["pipe", "pipe", "pipe"] });
  console.log(`[seed-audit] 已备份 ${AUDIT_DB}.bak-${stamp}`);

  // 2) 灌库（WAL 并发读写；视图即时可见，无需重启）
  const inserter = path.join(tmp, "inserter.js");
  writeFileSync(inserter, INSERTER_JS);
  docker("cp", inserter, `${LUCY}:/tmp/uat-audit-inserter.js`);
  console.log("[seed-audit] 开始灌库（约 1–3 分钟）…");
  const out = execFileSync("docker", ["exec", "-e", `AUDIT_DB=${AUDIT_DB}`, LUCY,
    "node", "/tmp/uat-audit-inserter.js"], { stdio: ["pipe", "pipe", "pipe"] }).toString();
  console.log(out.trim().split("\n").slice(-8).join("\n"));

  // 3) 复核（经 ops_calls 视图口径）
  const verifyJs = [
    'const D=require("/app/node_modules/better-sqlite3");',
    "const db=new D(process.env.AUDIT_DB,{readonly:true,fileMustExist:true});",
    'const total=db.prepare("SELECT COUNT(*) c FROM ops_calls WHERE request_id LIKE \'uat-scale-%\'").get().c;',
    // 30 天切边直接用 now-30d；窗内 500 行余量吸收切边漂移
    "const cutoff=new Date(Date.now()-30*86400000).toISOString();",
    'const win=db.prepare("SELECT COUNT(*) c FROM ops_calls WHERE request_id LIKE \'uat-scale-%\' AND ts>=?").get(cutoff).c;',
    'const agents=db.prepare("SELECT COUNT(DISTINCT agent_id) c FROM ops_calls WHERE ts>=?").get(cutoff).c;',
    'const hot=db.prepare("SELECT COUNT(*) c FROM ops_calls WHERE agent_id=\'uat_agent_001\' AND ts>=?").get(cutoff).c;',
    "console.log(JSON.stringify({total,window30:win,activeAgents30d:agents,hottest30:hot}));",
    "db.close();",
  ].join("");
  const r = JSON.parse(execFileSync("docker", ["exec", "-e", `AUDIT_DB=${AUDIT_DB}`, LUCY,
    "node", "-e", verifyJs], { stdio: ["pipe", "pipe", "pipe"] }).toString());
  console.log(`[seed-audit] 复核（视图口径）：窗内 ${r.window30}／全历史 ${r.total}／30天活跃 Agent ${r.activeAgents30d}／最热 Agent ${r.hottest30}`);
  const ok = r.window30 >= WINDOW_ROWS && r.total >= WINDOW_ROWS + HISTORY_ROWS && r.activeAgents30d >= 100;
  console.log(ok ? "[seed-audit] 完成，基线达标" : "[seed-audit] 复核未达标");
  process.exit(ok ? 0 : 1);
}

main();
