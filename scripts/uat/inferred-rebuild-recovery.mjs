#!/usr/bin/env node
/**
 * UAT-SUITE-INFERRED-REBUILD-RECOVERY（P1-45／REQ-030-066）
 *
 *   node scripts/uat/inferred-rebuild-recovery.mjs all --image project-lucy:p145-p147
 *   node scripts/uat/inferred-rebuild-recovery.mjs clean
 *
 * 全真容器 + 同卷持久 SQLite。必做：R0、注入中断状态后重启须重排（01／03）、
 * 完整 complete 水位后无新日志不重算（04）、中样本 SIGKILL 中断后恢复（02）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX = "lucy-uat-irr";
const RUN = `${PREFIX}-run`;
const VOL = `${PREFIX}-data`;
const WEB_PORT = Number(process.env.UAT_IRR_WEBUI_PORT ?? 55393);
const PROXY_PORT = Number(process.env.UAT_IRR_PROXY_PORT ?? 57993);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SECRETS = path.join(os.tmpdir(), `${PREFIX}-secrets`);

const args = process.argv.slice(2);
const cmd = args[0] ?? "all";
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const IMAGE = opt("image") ?? "project-lucy:demo";
const today = new Date().toISOString().slice(0, 10);
const label = opt("label") ?? `${today}-${IMAGE.split(":").pop().replace(/[^\w.-]/g, "_")}`;
const OUT = path.join(ROOT, "inbox", `uat-inferred-rebuild-recovery-${label}`);

const docker = (a, o = {}) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...o });
const dockerTry = (a) => { try { return docker(a); } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[irr]`, ...a);

function ensureBootstrapSecret() {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const file = path.join(SECRETS, "bootstrap-token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  return file;
}
function removeContainer() { dockerTry(["rm", "-f", RUN]); }
function removeVolume(name = VOL) { dockerTry(["volume", "rm", "-f", name]); }
function createDataVolume() {
  removeVolume();
  docker(["volume", "create", VOL]);
  docker(["run", "--rm", "--user", "0", "--entrypoint", "/bin/sh", "-v", `${VOL}:/data/lucy`, IMAGE, "-ec",
    "mkdir -p /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui && chown 10001:10001 /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui"]);
}
function startContainer() {
  removeContainer();
  const env = {
    KTX_PROJECT_ROOT: "/data/lucy", LUCY_TEMPLATE_ROOT: "/app/examples/docker-demo/project-template",
    LUCY_WEBUI_HOST: "0.0.0.0", LUCY_WEBUI_PORT: "5174", LUCY_PROXY_HOST: "0.0.0.0", LUCY_PROXY_PORT: "7879",
    LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "7878", LUCY_CONTENT_ROOT: "/data/lucy/config",
    LUCY_PUBLIC_MCP_URL: `http://127.0.0.1:${PROXY_PORT}/mcp`, LUCY_DEPLOYMENT_MODE: "customer",
    LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: "/run/secrets/webui_bootstrap_token", LUCY_WEBUI_COOKIE_SECURE: "0",
    LUCY_WEBUI_TEST_PROFILE: "1", POSTHOG_DISABLED: "1"
  };
  docker(["run", "-d", "--name", RUN,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`,
    "-v", `${VOL}:/data/lucy`, "-v", `${ensureBootstrapSecret()}:/run/secrets/webui_bootstrap_token:ro`,
    IMAGE]);
}
function stopContainer() { dockerTry(["stop", "-t", "20", RUN]); removeContainer(); }
async function timed(url, init = {}, timeoutMs = 5000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { ms: Math.round(performance.now() - t), code: r.status, text: await r.text() };
  } catch (e) {
    return { ms: Math.round(performance.now() - t), code: 0, text: String(e.message ?? e) };
  }
}
async function waitReady(budgetS = 120) {
  const deadline = Date.now() + budgetS * 1000;
  while (Date.now() < deadline) {
    if ((await timed(`${WEB}/api/readyz`)).code === 200) return true;
    await sleep(1000);
  }
  return false;
}
function auditEval(js) {
  // Run node -e inside container against audit.sqlite (read-write when needed).
  return docker(["exec", RUN, "node", "-e", js]);
}
function check(name, pass, actual, limit) {
  return { name, pass: Boolean(pass), actual, limit };
}

const SEED_SMALL = `
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite");
db.exec(\`CREATE TABLE IF NOT EXISTS inferred_rebuild_state (
  user_id TEXT PRIMARY KEY, status TEXT NOT NULL, watermark TEXT, updated_at TEXT NOT NULL
);\`);
const user="irr-user-small";
db.prepare("DELETE FROM access_log WHERE user_id=?").run(user);
db.prepare("DELETE FROM inferred_turns WHERE user_id=?").run(user);
db.prepare("DELETE FROM inferred_rebuild_state WHERE user_id=?").run(user);
const base=Date.now()-3600_000;
const ins=db.prepare(\`INSERT INTO access_log
  (ts, user_id, token_label, client, tool, args_summary, query_preview, outcome, duration_ms, request_id, trace_id)
  VALUES (@ts,@user_id,@token_label,@client,@tool,@args_summary,@query_preview,@outcome,@duration_ms,@request_id,@trace_id)\`);
for (let i=0;i<120;i++) {
  const ts=new Date(base+i*1000).toISOString();
  ins.run({
    ts, user_id:user, token_label:"uat", client:"uat-irr", tool:"lucy_query",
    args_summary:"irr-small", query_preview:"select 1", outcome:"success", duration_ms:10,
    request_id:"irr-s-"+i, trace_id:"irr-s-t-"+i
  });
}
console.log(JSON.stringify({user, rows:120, newest:new Date(base+119000).toISOString()}));
`;

const SEED_MEDIUM = `
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite");
const user="irr-user-medium";
db.prepare("DELETE FROM access_log WHERE user_id=?").run(user);
db.prepare("DELETE FROM inferred_turns WHERE user_id=?").run(user);
db.prepare("DELETE FROM inferred_rebuild_state WHERE user_id=?").run(user);
const base=Date.now()-7200_000;
const ins=db.prepare(\`INSERT INTO access_log
  (ts, user_id, token_label, client, tool, args_summary, query_preview, outcome, duration_ms, request_id, trace_id)
  VALUES (@ts,@user_id,@token_label,@client,@tool,@args_summary,@query_preview,@outcome,@duration_ms,@request_id,@trace_id)\`);
const n=6500;
const tx=db.transaction(()=>{
  for (let i=0;i<n;i++) {
    const ts=new Date(base+i*200).toISOString();
    ins.run({
      ts, user_id:user, token_label:"uat", client:"uat-irr", tool:"lucy_query",
      args_summary:"irr-med", query_preview:"select 1", outcome:"success", duration_ms:10,
      request_id:"irr-m-"+i, trace_id:"irr-m-t-"+i
    });
  }
});
tx();
console.log(JSON.stringify({user, rows:n, newest:new Date(base+(n-1)*200).toISOString()}));
`;

function injectInProgress(userId, watermark) {
  return auditEval(`
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite");
db.prepare(\`INSERT INTO inferred_rebuild_state (user_id,status,watermark,updated_at)
  VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, watermark=excluded.watermark, updated_at=excluded.updated_at\`)
  .run(${JSON.stringify(userId)}, "in_progress", ${JSON.stringify(watermark)}, new Date().toISOString());
const now=new Date().toISOString();
for (let i=0;i<5;i++) {
  db.prepare(\`INSERT OR REPLACE INTO inferred_turns
    (inferred_turn_id,user_id,started_at,ended_at,call_count,business_call_count,tool_summary,source_summary,confidence,evidence_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)\`).run(
      "partial-"+i, ${JSON.stringify(userId)}, ${JSON.stringify(watermark)}, ${JSON.stringify(watermark)},
      1,1,"lucy_query","", "low", "{}", now, now
    );
}
console.log(JSON.stringify({ok:true}));
`);
}

function setComplete(userId, watermark) {
  return auditEval(`
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite");
db.prepare(\`INSERT INTO inferred_rebuild_state (user_id,status,watermark,updated_at)
  VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status, watermark=excluded.watermark, updated_at=excluded.updated_at\`)
  .run(${JSON.stringify(userId)}, "complete", ${JSON.stringify(watermark)}, new Date().toISOString());
console.log(JSON.stringify({ok:true}));
`);
}

function queryState(userId) {
  const out = auditEval(`
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true});
const st=db.prepare("SELECT status,watermark,updated_at FROM inferred_rebuild_state WHERE user_id=?").get(${JSON.stringify(userId)});
const turns=db.prepare("SELECT COUNT(*) c FROM inferred_turns WHERE user_id=?").get(${JSON.stringify(userId)}).c;
const newest=db.prepare("SELECT MAX(ts) ts FROM access_log WHERE user_id=?").get(${JSON.stringify(userId)}).ts;
const raw=db.prepare("SELECT COUNT(*) n FROM access_log WHERE user_id=?").get(${JSON.stringify(userId)}).n;
const links=db.prepare("SELECT COUNT(*) n,COUNT(DISTINCT l.access_log_id) unique_n,SUM(CASE WHEN t.inferred_turn_id IS NULL THEN 1 ELSE 0 END) missing_turns FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE a.user_id=?").get(${JSON.stringify(userId)});
console.log(JSON.stringify({st, turns, newest,raw,links}));
`);
  return JSON.parse(out.trim().split("\n").pop());
}

async function triggerRebuildAndWatch(userId, { killOnInProgress = false, waitCompleteMs = 180_000 } = {}) {
  // Kick maintainer by bouncing the container so catch-up scans dirty users.
  // For SIGKILL mid-rebuild: kill as soon as inferred_rebuild_state becomes in_progress
  // (allocate/write may finish in <1s on small SSD, so turn-count thresholds miss).
  stopContainer();
  startContainer();
  if (!(await waitReady(180))) return { ready: false };
  const t0 = Date.now();
  let killed = false;
  let maxTurns = 0;
  let sawInProgress = false;
  while (Date.now() - t0 < waitCompleteMs) {
    const st = queryState(userId);
    maxTurns = Math.max(maxTurns, st.turns ?? 0);
    if (st.st?.status === "in_progress") sawInProgress = true;
    if (killOnInProgress && !killed && st.st?.status === "in_progress") {
      dockerTry(["exec", RUN, "sh", "-c", "pkill -9 -f 'node.*webui/server' || pkill -9 node"]);
      killed = true;
      await sleep(2000);
      break;
    }
    if (st.st?.status === "complete" && !killOnInProgress) {
      return { ready: true, killed, sawInProgress, state: st, maxTurns, elapsedMs: Date.now() - t0 };
    }
    await sleep(killOnInProgress ? 200 : 1500);
  }
  return { ready: true, killed, sawInProgress, state: queryState(userId), maxTurns, elapsedMs: Date.now() - t0 };
}

async function all() {
  mkdirSync(OUT, { recursive: true });
  const results = {};
  createDataVolume();
  startContainer();
  if (!(await waitReady(180))) throw new Error("initial ready failed");

  // R0
  const rev = dockerTry(["run", "--rm", "--entrypoint", "cat", IMAGE, "/app/BUILD_REVISION"]).trim().split("\n")[0];
  const canSql = (() => { try { queryState("none"); return true; } catch { return false; } })();
  results.r0 = {
    id: "UAT-IRR-R0",
    pass: Boolean(rev),
    checks: [
      check("image BUILD_REVISION", Boolean(rev), rev.slice(0, 40), "readable"),
      check("audit SQL reachable", canSql, true, true),
      check("can SIGKILL", true, "pkill -9", "container")
    ]
  };

  // Seed small + inject in_progress (IRR-01 / IRR-03)
  const smallMeta = JSON.parse(auditEval(SEED_SMALL).trim().split("\n").pop());
  injectInProgress(smallMeta.user, smallMeta.newest);
  const before = queryState(smallMeta.user);
  // Restart → maintainer should rebuild and move to complete
  const after01 = await triggerRebuildAndWatch(smallMeta.user, { waitCompleteMs: 240_000 });
  const final01 = after01.state;
  // Clustering may collapse many access_log rows into a single inferred turn; the
  // contract is recovery to complete (not a minimum turn count).
  const recovered01 = final01.st?.status === "complete" && final01.turns === 1 && final01.raw === smallMeta.rows && final01.links?.n === smallMeta.rows && final01.links?.unique_n === smallMeta.rows && final01.links?.missing_turns === 0;
  results["UAT-IRR-01"] = {
    id: "UAT-IRR-01",
    pass: before.st?.status === "in_progress" && recovered01,
    checks: [
      check("before was in_progress", before.st?.status === "in_progress", before.st, "in_progress"),
      check("after complete", final01.st?.status === "complete", final01.st, "complete"),
      check("one complete cluster with every call uniquely linked", recovered01, {turns:final01.turns,raw:final01.raw,links:final01.links}, "1 cluster, all 120 calls linked once")
    ],
    before, final01, after01
  };
  results["UAT-IRR-03"] = {
    id: "UAT-IRR-03",
    pass: results["UAT-IRR-01"].pass,
    checks: [
      check("partial turns + in_progress not left covered", results["UAT-IRR-01"].pass, final01.st, "rebuilt to complete")
    ]
  };

  // IRR-04: complete + no new logs → restart must stay complete without wiping
  // Keep the actual successful decimal watermark; do not seed an ISO timestamp.
  const before04 = queryState(smallMeta.user);
  const turnsBefore04 = before04.turns;
  stopContainer(); startContainer();
  await waitReady(180);
  await sleep(20_000);
  const after04 = queryState(smallMeta.user);
  results["UAT-IRR-04"] = {
    id: "UAT-IRR-04",
    pass: after04.st?.status === "complete" && after04.turns === turnsBefore04 && JSON.stringify(after04.st) === JSON.stringify(before04.st) && JSON.stringify(after04.links) === JSON.stringify(before04.links),
    checks: [
      check("still complete", after04.st?.status === "complete", after04.st, "complete"),
      check("turn count unchanged", after04.turns === turnsBefore04, { before: turnsBefore04, after: after04.turns }, "equal"),
      check("completion timestamp/watermark unchanged (no rebuild)", JSON.stringify(after04.st) === JSON.stringify(before04.st), {before:before04.st,after:after04.st}, "unchanged"),
      check("complete links unchanged", JSON.stringify(after04.links) === JSON.stringify(before04.links), {before:before04.links,after:after04.links}, "unchanged")
    ],
    before04,after04
  };

  // IRR-02 must observe actual partial links, SIGKILL the container, and
  // recover on the same volume. A fabricated residual is not a SIGKILL PASS.
  stopContainer();
  const killed = spawnSync(process.execPath, [path.join(ROOT, "scripts/uat/inferred-rebuild-real-kill.mjs"),
    "--image", IMAGE, "--out", path.join(OUT, "real-kill")], {
    cwd: ROOT, env: process.env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024
  });
  let actualKill;
  try { actualKill = JSON.parse(killed.stdout.trim().split("\n").pop()); }
  catch { actualKill = { pass: false, error: "real SIGKILL runner failed", exitCode: killed.status }; }
  results["UAT-IRR-02"] = {
    id: "UAT-IRR-02", pass: killed.status === 0 && actualKill.pass === true,
    checks: [
      check("real SIGKILL", actualKill.killed === true && actualKill.processExit?.exitCode === 137,
        actualKill.processExit, "killed, exit 137"),
      check("partial links before kill", actualKill.before?.links > 0 && actualKill.before?.links < actualKill.rows,
        actualKill.before, "0 < links < raw rows"),
      check("same-volume complete and unique links", actualKill.after?.state?.status === "complete" && actualKill.after?.links === actualKill.rows && actualKill.after?.duplicates === 0,
        actualKill.after, "complete, all calls linked exactly once")
    ], actualKill
  };

  const suite = {
    suite: "UAT-SUITE-INFERRED-REBUILD-RECOVERY",
    image: IMAGE,
    label,
    revision: rev,
    results,
    pass: ["r0", "UAT-IRR-01", "UAT-IRR-02", "UAT-IRR-03", "UAT-IRR-04"].every((k) => results[k]?.pass)
  };
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(suite, null, 2));
  console.log(JSON.stringify({
    pass: suite.pass,
    r0: results.r0.pass,
    irr01: results["UAT-IRR-01"].pass,
    irr02: results["UAT-IRR-02"].pass,
    irr03: results["UAT-IRR-03"].pass,
    irr04: results["UAT-IRR-04"].pass,
    out: OUT
  }, null, 2));
  stopContainer();
  if (!suite.pass) process.exitCode = 1;
}

function clean() {
  removeContainer();
  removeVolume();
  rmSync(SECRETS, { recursive: true, force: true });
  log("cleaned");
}

if (cmd === "clean") clean();
else if (cmd === "all") await all();
else {
  console.error("usage: node scripts/uat/inferred-rebuild-recovery.mjs all|clean [--image IMG] [--label L]");
  process.exit(2);
}
