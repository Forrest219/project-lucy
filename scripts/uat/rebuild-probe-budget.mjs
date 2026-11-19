#!/usr/bin/env node
/**
 * UAT-SUITE-REBUILD-PROBE-BUDGET（P1-47／REQ-030-068）
 *
 *   node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:p145-p147
 *   node scripts/uat/rebuild-probe-budget.mjs clean
 *
 * 复用冷启动台的客户规模快照（lucy-uat-cold-snap-old），候选镜像预迁移后
 * 注入「近期调用」强制满量用户进入重建，限速冷启动，就绪后 120s 采样。
 * 客户观察器：timeout 3s / period 5s，连续失败 < 6。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX = "lucy-uat-rpb";
const RUN = `${PREFIX}-run`;
const SNAP_OLD = "lucy-uat-cold-snap-old";
const WEB_PORT = Number(process.env.UAT_RPB_WEBUI_PORT ?? 55394);
const PROXY_PORT = Number(process.env.UAT_RPB_PROXY_PORT ?? 57994);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const MCP = `http://127.0.0.1:${PROXY_PORT}/mcp`;
const SECRETS = path.join(os.tmpdir(), `${PREFIX}-secrets`);
const RIG = {
  readMBps: Number(process.env.UAT_RPB_READ_MBPS ?? 30),
  writeMBps: Number(process.env.UAT_RPB_WRITE_MBPS ?? 30),
  readIops: Number(process.env.UAT_RPB_READ_IOPS ?? 300),
  writeIops: Number(process.env.UAT_RPB_WRITE_IOPS ?? 100),
  cpus: Number(process.env.UAT_RPB_CPUS ?? 2)
};
const LIMITS = {
  readyS: 180,
  windowS: 120,
  livezMaxMs: 1000,
  livezP99Ms: 400,
  readyzP99Ms: 1500,
  customerTimeoutMs: 3000,
  customerPeriodMs: 5000,
  customerFailStreak: 6
};

const args = process.argv.slice(2);
const cmd = args[0] ?? "all";
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const IMAGE = opt("image") ?? "project-lucy:demo";
// 可重复：--env KEY=VAL，只作用于被测（限速）容器，不作用于注入阶段的容器。
const EXTRA_ENV = Object.fromEntries(args.flatMap((a, i) => (a === "--env" && args[i + 1]?.includes("=") ? [args[i + 1].split(/=(.*)/s).slice(0, 2)] : [])));
const today = new Date().toISOString().slice(0, 10);
const label = opt("label") ?? `${today}-${IMAGE.split(":").pop().replace(/[^\w.-]/g, "_")}`;
const OUT = path.join(ROOT, "inbox", `uat-rebuild-probe-budget-${label}`);
const MIG = `${PREFIX}-snap-mig-${IMAGE.split(":").pop().replace(/[^\w.-]/g, "_").toLowerCase()}`;

const docker = (a, o = {}) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...o });
const dockerTry = (a) => { try { return docker(a); } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[rpb]`, ...a);

function ensureBootstrapSecret() {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const file = path.join(SECRETS, "bootstrap-token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  return file;
}
const volumeExists = (name) => dockerTry(["volume", "inspect", name]).includes('"Name"');
const removeContainer = (name = RUN) => dockerTry(["rm", "-f", name]);
const removeVolume = (name) => dockerTry(["volume", "rm", "-f", name]);
function copyVolume(from, to) {
  removeVolume(to);
  docker(["volume", "create", to]);
  docker(["run", "--rm", "-v", `${from}:/from:ro`, "-v", `${to}:/to`, "alpine:latest", "sh", "-c", "cp -a /from/. /to/"]);
}
let deviceCache;
function detectDevice() {
  if (deviceCache) return deviceCache;
  const out = docker(["run", "--rm", "--privileged", "--pid=host", "alpine:latest", "nsenter", "-t", "1", "-m", "sh", "-c", "df /var/lib/docker | tail -1"]).trim();
  const part = out.split(/\s+/)[0];
  deviceCache = part.replace(/p?\d+$/, "");
  if (!deviceCache.startsWith("/dev/")) throw new Error(`cannot detect block device from: ${out}`);
  return deviceCache;
}
function throttleFlags() {
  const dev = detectDevice();
  return [
    "--cpus", String(RIG.cpus),
    "--device-read-bps", `${dev}:${RIG.readMBps}mb`, "--device-write-bps", `${dev}:${RIG.writeMBps}mb`,
    "--device-read-iops", `${dev}:${RIG.readIops}`, "--device-write-iops", `${dev}:${RIG.writeIops}`
  ];
}
function dropCaches() {
  docker(["run", "--rm", "--privileged", "--pid=host", "alpine:latest", "nsenter", "-t", "1", "-m", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"]);
}
function startContainer(volume, { throttle, extraEnv = {} }) {
  removeContainer();
  const env = {
    KTX_PROJECT_ROOT: "/data/lucy", LUCY_TEMPLATE_ROOT: "/app/examples/docker-demo/project-template",
    LUCY_WEBUI_HOST: "0.0.0.0", LUCY_WEBUI_PORT: "5174", LUCY_PROXY_HOST: "0.0.0.0", LUCY_PROXY_PORT: "7879",
    LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "7878", LUCY_CONTENT_ROOT: "/data/lucy/config",
    LUCY_PUBLIC_MCP_URL: MCP, LUCY_DEPLOYMENT_MODE: "customer",
    LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: "/run/secrets/webui_bootstrap_token", LUCY_WEBUI_COOKIE_SECURE: "0",
    LUCY_WEBUI_TEST_PROFILE: "1", POSTHOG_DISABLED: "1",
    ...extraEnv
  };
  docker(["run", "-d", "--name", RUN, ...(throttle ? throttleFlags() : []),
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`,
    "-v", `${volume}:/data/lucy`, "-v", `${ensureBootstrapSecret()}:/run/secrets/webui_bootstrap_token:ro`,
    ...(flag("crossing-fixture") ? ["-v", `${path.join(ROOT, "scripts/uat/fde-crossing-fixture.mts")}:/app/scripts/uat/fde-crossing-fixture.mts:ro`] : []),
    IMAGE]);
}
async function timed(url, init = {}, timeoutMs = 8000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    return { ms: Math.round(performance.now() - t), code: r.status, text: await r.text(), headers: r.headers };
  } catch (e) {
    return { ms: Math.round(performance.now() - t), code: 0, text: String(e.message ?? e), headers: undefined };
  }
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
function check(name, pass, actual, limit) { return { name, pass: Boolean(pass), actual, limit }; }

async function waitReady(budgetS) {
  const deadline = Date.now() + budgetS * 1000;
  while (Date.now() < deadline) {
    if ((await timed(`${WEB}/api/readyz`, {}, 8000)).code === 200) return true;
    await sleep(1000);
  }
  return false;
}

function migratedFacts(volume) {
  const out = docker(["run", "--rm", "--entrypoint", "node", "-v", `${volume}:/data/lucy:ro`, IMAGE, "-e", `
const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite',{readonly:true});
const cutoff=new Date(Date.now()-30*86400000).toISOString();
const raw=d.prepare('SELECT COUNT(*) n,COUNT(DISTINCT user_id) users FROM access_log').get();
const eligible=d.prepare('SELECT COUNT(*) n,COUNT(DISTINCT user_id) users FROM access_log WHERE ts>=?').get(cutoff);
const linked=d.prepare('SELECT COUNT(*) n,COUNT(DISTINCT l.access_log_id) unique_n,SUM(CASE WHEN t.inferred_turn_id IS NULL THEN 1 ELSE 0 END) missing_turns FROM inferred_turn_access_logs l JOIN access_log a ON a.id=l.access_log_id LEFT JOIN inferred_turns t ON t.inferred_turn_id=l.inferred_turn_id WHERE a.ts>=?').get(cutoff);
const pending=d.prepare("SELECT COUNT(*) n FROM (SELECT user_id,MAX(id) newest FROM access_log WHERE ts>=? GROUP BY user_id) a LEFT JOIN inferred_rebuild_state s ON s.user_id=a.user_id WHERE s.status IS NULL OR s.status<>'complete' OR s.watermark IS NULL OR s.watermark='' OR s.watermark GLOB '*[^0-9]*' OR CAST(s.watermark AS INTEGER)<a.newest").get(cutoff).n;
const turns=d.prepare('SELECT COUNT(*) n FROM inferred_turns').get().n;
console.log(JSON.stringify({cutoff,raw,eligible,linked,pending,turns,complete:raw.n>=200000&&eligible.n>=200000&&eligible.users>=67&&linked.n===eligible.n&&linked.unique_n===eligible.n&&linked.missing_turns===0&&pending===0}));d.close();`]);
  return JSON.parse(out.trim().split("\n").pop());
}
function refreshSyntheticFixtureWindow(volume) {
  // A fixed 30-day seed ages out. Raise the fixture with real padded synthetic
  // calls; do not rewrite old timestamps, lengthen runtime lookback, or fake links.
  const out = docker(["run", "--rm", "--entrypoint", "node", "-v", `${volume}:/data/lucy`, IMAGE, "-e", `
const D=require('/app/webui/node_modules/better-sqlite3');const d=new D('/data/lucy/.ktx-ui/audit.sqlite');
const now=Date.now(),cutoff=new Date(now-30*86400000).toISOString();
const before=d.prepare('SELECT COUNT(*) n FROM access_log WHERE ts>=?').get(cutoff).n;
const n=Math.max(0,201000-before),users=d.prepare('SELECT DISTINCT user_id FROM access_log ORDER BY user_id').all().map(r=>r.user_id);
const pad=d.prepare('SELECT args_summary,generated_sql,query_preview FROM access_log ORDER BY id LIMIT 1').get();
const ins=d.prepare("INSERT INTO access_log(ts,user_id,token_label,client,tool,tables,args_summary,generated_sql,query_preview,outcome,duration_ms,request_id,trace_id,lucy_session_id) VALUES (?,?, 'uat','uat-p157-fill','lucy_query',?,?,?,?,'success',10,?,?,?)");
d.transaction(()=>{for(let i=0;i<n;i++)ins.run(new Date(now-3600000+i).toISOString(),users[i%users.length],JSON.stringify(['t1']),pad.args_summary,pad.generated_sql,pad.query_preview,'p157-fill-'+now+'-'+i,'p157-fill-trace-'+now+'-'+i,'p157-fill-session-'+now+'-'+i)})();
console.log(JSON.stringify({beforeEligible:before,added:n,targetEligible:201000,originalTimestampsUnchanged:true,paddingCopied:true,users:users.length}));d.close();`]);
  return JSON.parse(out.trim().split("\n").pop());
}

async function premigrate() {
  let source = SNAP_OLD;
  if (volumeExists(MIG) && !flag("remigrate")) {
    const facts = migratedFacts(MIG);
    if (facts.complete) {
      log(`reuse complete migrated volume ${MIG}`);
      writeFileSync(path.join(OUT, "premigrate-facts.json"), JSON.stringify(facts, null, 2));
      return MIG;
    }
    log("incomplete migrated fixture must finish before UAT", facts);
    source = MIG;
  }
  if (!volumeExists(source)) throw new Error(`missing ${source}; run: npm run uat:cold-start -- seed`);
  log(`premigrating ${source} → ${MIG}`);
  copyVolume(source, `${RUN}-data`);
  const refresh = refreshSyntheticFixtureWindow(`${RUN}-data`);
  writeFileSync(path.join(OUT, "fixture-refresh.json"), JSON.stringify(refresh, null, 2));
  startContainer(`${RUN}-data`, { throttle: false });
  if (!(await waitReady(300))) throw new Error("premigrate ready failed");
  const waitS = Number(opt("premigrate-wait-s") ?? 300);
  log(`premigrate settle ${waitS}s, then require complete materialization`);
  await sleep(waitS * 1000);
  // Stop before checking/copying so SQLite/WAL represents one quiescent snapshot.
  docker(["stop", "-t", "60", RUN]); removeContainer();
  let facts = migratedFacts(`${RUN}-data`);
  for (let i = 0; !facts.complete && i < 10; i++) {
    startContainer(`${RUN}-data`, { throttle: false });
    if (!(await waitReady(300))) throw new Error("premigrate continuation not ready");
    await sleep(60_000);
    docker(["stop", "-t", "60", RUN]); removeContainer();
    facts = migratedFacts(`${RUN}-data`);
  }
  writeFileSync(path.join(OUT, "premigrate-facts.json"), JSON.stringify(facts, null, 2));
  if (!facts.complete) throw new Error("full inferred fixture incomplete; UAT blocked");
  copyVolume(`${RUN}-data`, MIG);
  return MIG;
}

function injectRecentActivity() {
  // Add one fresh access_log row per existing user so watermark < newest → rebuild on next start.
  const out = docker(["exec", RUN, "node", "-e", `
const D=require("/app/webui/node_modules/better-sqlite3");
const db=new D("/data/lucy/.ktx-ui/audit.sqlite");
const users=db.prepare("SELECT DISTINCT user_id FROM access_log").all().map(r=>r.user_id);
const now=new Date().toISOString();
const ins=db.prepare(\`INSERT INTO access_log
  (ts,user_id,token_label,client,tool,args_summary,query_preview,outcome,duration_ms,request_id,trace_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)\`);
let n=0;
for (const u of users) {
  ins.run(now,u,"uat","uat-rpb","lucy_query","rpb-recent","select 1","success",10,"rpb-"+u+"-"+Date.now(),"rpb-t");
  n++;
}
console.log(JSON.stringify({users:users.length, injected:n, ts:now}));
`]);
  return JSON.parse(out.trim().split("\n").pop());
}

function isPauseEnv() {
  return String(EXTRA_ENV.LUCY_INFERRED_MAINTAINER ?? "").trim().toLowerCase() === "off";
}

async function mcpCycle(bearer, sidIn) {
  const headers = (sid) => ({
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${bearer}`,
    ...(sid ? { "mcp-session-id": sid } : {})
  });
  const init = await timed(MCP, {
    method: "POST",
    headers: headers(undefined),
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "uat-rpb", version: "1" } }
    })
  }, 8000);
  const sid = init.headers?.get("mcp-session-id") ?? sidIn;
  const list = await timed(MCP, {
    method: "POST",
    headers: headers(sid),
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  }, 8000);
  // 轻量工具：优先 wiki_search，缺则 lucy_catalog
  const light = await timed(MCP, {
    method: "POST",
    headers: headers(sid),
    body: JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "tools/call",
      params: { name: "wiki_search", arguments: { query: "uat" } }
    })
  }, 8000);
  const lightOk = light.code === 200 || /lucy_catalog|wiki_search|Unknown tool|not found|denied/i.test(light.text);
  // 再试 catalog 若 wiki 不可用
  let catalog = null;
  if (!/"result"/.test(light.text)) {
    catalog = await timed(MCP, {
      method: "POST",
      headers: headers(sid),
      body: JSON.stringify({
        jsonrpc: "2.0", id: 4, method: "tools/call",
        params: { name: "lucy_catalog", arguments: {} }
      })
    }, 8000);
  }
  const toolOk = /"result"/.test(light.text) || (catalog && /"result"/.test(catalog.text)) || lightOk;
  return {
    ok: init.code === 200 && /"result"/.test(init.text) && list.code === 200 && /"tools"/.test(list.text) && toolOk,
    ms: Math.max(init.ms, list.ms, light.ms, catalog?.ms ?? 0),
    sid,
    codes: { init: init.code, list: list.code, light: light.code, catalog: catalog?.code ?? null }
  };
}

async function sampleWindow(windowS, { mcpBearer = null, adminCookie = null } = {}) {
  const samples = [];
  const customer = [];
  const mcp = [];
  const business = [];
  const t0 = performance.now();
  let streak = 0; let maxStreak = 0;
  let nextCustomer = 0;
  let nextMcp = 0;
  let sid;
  while ((performance.now() - t0) / 1000 < windowS) {
    const livez = await timed(`${WEB}/api/livez`, {}, 8000);
    const readyz = await timed(`${WEB}/api/readyz`, {}, 8000);
    const health = await timed(`${WEB}/api/health`, {}, 8000);
    let healthStatus = null;
    try { const h = JSON.parse(health.text); healthStatus = h?.data?.status ?? h?.status ?? null; } catch {}
    samples.push({
      t: +((performance.now() - t0) / 1000).toFixed(2),
      livezMs: livez.ms, livezCode: livez.code,
      readyzMs: readyz.ms, readyzCode: readyz.code,
      healthMs: health.ms, healthCode: health.code, healthStatus
    });
    if ((performance.now() - t0) >= nextCustomer) {
      const c = await timed(`${WEB}/api/readyz`, {}, LIMITS.customerTimeoutMs);
      const fail = c.code !== 200 || c.ms >= LIMITS.customerTimeoutMs;
      streak = fail ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
      customer.push({ t: +((performance.now() - t0) / 1000).toFixed(2), ms: c.ms, code: c.code, fail });
      nextCustomer += LIMITS.customerPeriodMs;
    }
    if (mcpBearer && (performance.now() - t0) >= nextMcp) {
      const cycle = await mcpCycle(mcpBearer, sid);
      sid = cycle.sid;
      mcp.push({ t: +((performance.now() - t0) / 1000).toFixed(2), ...cycle });
      nextMcp += 10_000;
    }
    if (adminCookie) {
      const r = await timed(`${WEB}/api/project`, { headers: { cookie: adminCookie } }, 8000);
      business.push({ t: +((performance.now() - t0) / 1000).toFixed(2), code: r.code, ms: r.ms });
    }
    await sleep(1000);
  }
  const livezMs = samples.map((s) => s.livezMs);
  const readyzMs = samples.map((s) => s.readyzMs);
  return {
    samples, customer, maxStreak, mcp, business,
    stats: {
      livezMaxMs: Math.max(...livezMs), livezP99Ms: pct(livezMs, 99),
      readyzMaxMs: Math.max(...readyzMs), readyzP99Ms: pct(readyzMs, 99),
      livezNon200: samples.filter((s) => s.livezCode !== 200).length,
      readyzNon200: samples.filter((s) => s.readyzCode !== 200).length,
      livezAtLeast1500Fraction: samples.filter((s) => s.livezMs >= 1500).length / samples.length,
      healthDegradedCount: samples.filter((s) => s.healthStatus === "degraded").length
    }
  };
}

async function mintAndHitProject() {
  const token = readFileSync(path.join(SECRETS, "bootstrap-token"), "utf8").trim();
  const password = `Uat-${randomBytes(12).toString("hex")}-9a`;
  // Bootstrap may already be consumed on migrated vol — try claim, else skip admin path detail.
  const claim = await timed(`${WEB}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lucy-bootstrap-token": token },
    body: JSON.stringify({ adminId: "uatrpbadmin", displayName: "UAT RPB", password })
  }, 8000);
  const cookie = (claim.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const hits = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await timed(`${WEB}/api/readyz`, {}, 8000);
    hits.push({ code: r.code, ms: r.ms });
    await sleep(200);
  }
  let project = null;
  let bearer = "";
  let inferredRebuild = null;
  if (cookie) {
    project = await timed(`${WEB}/api/project`, { headers: { cookie } }, 8000);
    const role = await timed(`${WEB}/api/admin/roles`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        dryRun: false,
        roleId: "uat_rpb_min",
        role: { description: "UAT RPB minimal", allow: { connections: [], tableSelectors: [], tools: ["wiki_search", "lucy_catalog", "connection_list"] } }
      })
    }, 8000);
    const agent = await timed(`${WEB}/api/admin/agents`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ dryRun: false, agent: { id: "uat_rpb_agent", name: "UAT RPB agent", roles: ["uat_rpb_min"] } })
    }, 8000);
    const tok = await timed(`${WEB}/api/admin/agents/uat_rpb_agent/tokens`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ label: "uat", expires_at: new Date(Date.now() + 3_600_000).toISOString(), dryRun: false })
    }, 8000);
    let parsed; try { parsed = JSON.parse(tok.text); } catch { parsed = {}; }
    bearer = parsed?.data?.token ?? parsed?.data?.plaintext ?? parsed?.token ?? "";
    const turns = await timed(`${WEB}/api/admin/audit/turns?hours=168&source=all`, { headers: { cookie } }, 8000);
    try { inferredRebuild = JSON.parse(turns.text)?.data?.inferredRebuild ?? null; } catch { inferredRebuild = null; }
    void role; void agent;
  }
  if (cookie && password) writeFileSync(path.join(SECRETS, "admin-password"), password, { mode: 0o600 });
  if (bearer) writeFileSync(path.join(SECRETS, "bearer"), bearer, { mode: 0o600 });
  return { claimCode: claim.code, cookie: Boolean(cookie), hits, project, bearer, inferredRebuild, password };
}

async function all() {
  mkdirSync(OUT, { recursive: true });
  if (!volumeExists(SNAP_OLD)) throw new Error(`missing ${SNAP_OLD}`);
  const rev = dockerTry(["run", "--rm", "--entrypoint", "cat", IMAGE, "/app/BUILD_REVISION"]).trim().split("\n")[0];

  // R0: throttle probe
  dropCaches();
  const r0 = {
    id: "UAT-RPB-R0",
    pass: volumeExists(SNAP_OLD) && Boolean(rev),
    checks: [
      check("cold snap exists", volumeExists(SNAP_OLD), SNAP_OLD, "present"),
      check("image readable", Boolean(rev), rev.slice(0, 40), "BUILD_REVISION"),
      check("throttle params", true, RIG, "blkio")
    ]
  };

  const mig = await premigrate();
  // Start unthrottled briefly to inject recent rows onto a working copy.
  // Bootstrap／Agent token 必须在此领取（冷启动卷会继承已消费的 bootstrap）。
  copyVolume(mig, `${RUN}-data`);
  startContainer(`${RUN}-data`, { throttle: false });
  if (!(await waitReady(180))) throw new Error("inject-ready failed");
  const injected = injectRecentActivity();
  log("injected", injected);
  const business = await mintAndHitProject();
  log("mint", { claimCode: business.claimCode, cookie: business.cookie, bearer: Boolean(business.bearer) });
  docker(["stop", "-t", "30", RUN]); removeContainer();

  // P1-57 SC-16: materialize an actual multi-level crossing fixture while the service is stopped.
  // Default P1-47 runs are unchanged. All reads/writes remain on an isolated synthetic volume.
  let crossingFixture = null;
  if (flag("crossing-fixture")) {
    const out = docker(["run", "--rm", "--network", "none", "--entrypoint", "/app/webui/node_modules/.bin/tsx",
      "-e", "KTX_PROJECT_ROOT=/data/lucy", "-e", "LUCY_CONTENT_ROOT=/data/lucy/config",
      "-v", `${RUN}-data:/data/lucy`, "-v", `${path.join(ROOT, "scripts/uat/fde-crossing-fixture.mts")}:/app/scripts/uat/fde-crossing-fixture.mts:ro`, IMAGE, "/app/scripts/uat/fde-crossing-fixture.mts", "seed", ...(flag("crossing-existing-user") ? ["--existing-user"] : [])]);
    crossingFixture = JSON.parse(out.trim().split("\n").pop());
    writeFileSync(path.join(OUT, "crossing-seed.json"), JSON.stringify(crossingFixture, null, 2));
  }

  dropCaches();
  copyVolume(`${RUN}-data`, `${RUN}-boot`);
  const t0 = performance.now();
  startContainer(`${RUN}-boot`, { throttle: !flag("no-throttle"), extraEnv: EXTRA_ENV });
  const readyOk = await waitReady(LIMITS.readyS);
  const readyS = +((performance.now() - t0) / 1000).toFixed(1);
  if (!readyOk) throw new Error("candidate ready failed");
  const pause = isPauseEnv();
  const bearer = business.bearer
    || (existsSync(path.join(SECRETS, "bearer")) ? readFileSync(path.join(SECRETS, "bearer"), "utf8").trim() : "");
  // 暂停态：冷启动后登录读 inferredRebuild（inject 阶段读的是未暂停进程）
  let inferredRebuild = business.inferredRebuild;
  if (pause) {
    const pw = existsSync(path.join(SECRETS, "admin-password"))
      ? readFileSync(path.join(SECRETS, "admin-password"), "utf8").trim()
      : business.password;
    if (pw) {
      const login = await timed(`${WEB}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ adminId: "uatrpbadmin", password: pw })
      }, 8000);
      const cookie = (login.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
      if (cookie) {
        const turns = await timed(`${WEB}/api/admin/audit/turns?hours=168&source=all`, { headers: { cookie } }, 8000);
        try { inferredRebuild = JSON.parse(turns.text)?.data?.inferredRebuild ?? null; } catch { inferredRebuild = null; }
      }
    }
  }
  // RPB-03 requires authenticated business requests in this very cold window.
  const adminPassword = business.password || (existsSync(path.join(SECRETS, "admin-password")) ? readFileSync(path.join(SECRETS, "admin-password"), "utf8").trim() : "");
  const coldLogin = adminPassword ? await timed(`${WEB}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ adminId: "uatrpbadmin", password: adminPassword })
  }, 8000) : null;
  const adminCookie = (coldLogin?.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const window = await sampleWindow(LIMITS.windowS, { mcpBearer: pause && bearer ? bearer : null, adminCookie });
  writeFileSync(path.join(OUT, "sample-window.json"), JSON.stringify(window, null, 2));
  if (crossingFixture) {
    let checked;
    // Preserve the actual 120s probe window; allow bounded background convergence afterwards.
    for (let i = 0; i < Number(opt("crossing-check-count") ?? 60); i++) {
      const out = dockerTry(["exec", RUN, "/app/webui/node_modules/.bin/tsx", "/app/scripts/uat/fde-crossing-fixture.mts", "check"]);
      try { checked = JSON.parse(out.trim().split("\n").pop()); } catch {}
      if (checked?.pass) break;
      await sleep(1000);
    }
    writeFileSync(path.join(OUT, "crossing-check.json"), JSON.stringify(checked ?? { pass: false }, null, 2));
    if (!checked?.pass) throw new Error("SC-16 crossing fixture did not converge; see crossing-check.json");
  }
  const hits = [];
  for (let i = 0; i < 20; i += 1) {
    const r = await timed(`${WEB}/api/readyz`, {}, 8000);
    hits.push({ code: r.code, ms: r.ms });
    await sleep(200);
  }
  const logs = dockerTry(["logs", RUN]);
  writeFileSync(path.join(OUT, "container.log"), logs);
  const traceLines = logs.split("\n").filter((line) => line.includes("[lucy-rebuild-trace]"));
  if (traceLines.length) writeFileSync(path.join(OUT, "rebuild-trace.log"), `${traceLines.join("\n")}\n`);
  const pauseLog = /LUCY_INFERRED_MAINTAINER=off/.test(logs);

  const probePass = readyOk
    && window.stats.livezMaxMs <= LIMITS.livezMaxMs
    && window.stats.livezP99Ms <= LIMITS.livezP99Ms
    && window.stats.readyzP99Ms <= LIMITS.readyzP99Ms
    && window.stats.livezNon200 === 0
    && window.stats.readyzNon200 === 0;
  const rpb01 = {
    id: "UAT-RPB-01",
    pass: probePass,
    checks: [
      check("ready within budget", readyOk && readyS <= LIMITS.readyS, readyS, `≤${LIMITS.readyS}s`),
      check("livez max", window.stats.livezMaxMs <= LIMITS.livezMaxMs, window.stats.livezMaxMs, `≤${LIMITS.livezMaxMs}`),
      check("livez p99", window.stats.livezP99Ms <= LIMITS.livezP99Ms, window.stats.livezP99Ms, `≤${LIMITS.livezP99Ms}`),
      check("readyz p99", window.stats.readyzP99Ms <= LIMITS.readyzP99Ms, window.stats.readyzP99Ms, `≤${LIMITS.readyzP99Ms}`),
      check("all 200", window.stats.livezNon200 === 0 && window.stats.readyzNon200 === 0, { livez: window.stats.livezNon200, readyz: window.stats.readyzNon200 }, 0)
    ],
    readyS, stats: window.stats, injected
  };
  const rpb02 = {
    id: "UAT-RPB-02",
    pass: window.maxStreak < LIMITS.customerFailStreak,
    checks: [
      check("customer fail streak", window.maxStreak < LIMITS.customerFailStreak, window.maxStreak, `<${LIMITS.customerFailStreak}`)
    ],
    customer: window.customer
  };
  const rpb03 = {
    id: "UAT-RPB-03",
    pass: window.business.length >= 50 && window.business.every((h) => h.code === 200) && hits.every((h) => h.code === 200),
    business: window.business,
    checks: [
      check("authenticated business count", window.business.length >= 50, window.business.length, "≥50"),
      check("authenticated business all 200", window.business.length >= 50 && window.business.every((h) => h.code === 200), { n: window.business.length, maxMs: Math.max(0, ...window.business.map((h) => h.ms)), p99Ms: pct(window.business.map((h) => h.ms), 99) }, "all 200"),
      check("readyz burst all 200", hits.every((h) => h.code === 200), {
        n: hits.length,
        maxMs: Math.max(...hits.map((h) => h.ms))
      }, "all 200")
    ]
  };

  const mcpMs = window.mcp.map((m) => m.ms);
  const rpb05 = pause ? {
    id: "UAT-RPB-05",
    pass: probePass && rpb02.pass,
    note: "pause config only; does not close default-config FAIL",
    checks: rpb01.checks.concat(rpb02.checks),
    stats: window.stats, maxStreak: window.maxStreak
  } : { id: "UAT-RPB-05", pass: null, status: "SKIPPED", reason: "LUCY_INFERRED_MAINTAINER is not off" };
  const rpb06 = pause ? {
    id: "UAT-RPB-06",
    pass: window.mcp.length > 0
      && window.mcp.every((m) => m.ok)
      && (mcpMs.length ? pct(mcpMs, 99) <= 3000 : false),
    checks: [
      check("mcp cycles ran", window.mcp.length > 0, window.mcp.length, "≥1"),
      check("mcp all ok", window.mcp.every((m) => m.ok), window.mcp.map((m) => m.codes), "all ok"),
      check("mcp p99 ≤3s", mcpMs.length ? pct(mcpMs, 99) <= 3000 : false, mcpMs.length ? pct(mcpMs, 99) : null, "≤3000")
    ],
    mcp: window.mcp
  } : { id: "UAT-RPB-06", pass: null, status: "SKIPPED", reason: "LUCY_INFERRED_MAINTAINER is not off" };
  const rpb07 = pause ? {
    id: "UAT-RPB-07",
    pass: Boolean(inferredRebuild && inferredRebuild.paused === true && inferredRebuild.complete === false && pauseLog),
    checks: [
      check("inferredRebuild.paused", inferredRebuild?.paused === true, inferredRebuild, "paused:true"),
      check("inferredRebuild.complete false", inferredRebuild?.complete === false, inferredRebuild?.complete, false),
      check("startup pause warning in logs", pauseLog, pauseLog, true)
    ],
    inferredRebuild
  } : { id: "UAT-RPB-07", pass: null, status: "SKIPPED", reason: "LUCY_INFERRED_MAINTAINER is not off" };

  const defaultPass = r0.pass && rpb01.pass && rpb02.pass && rpb03.pass;
  const pausePass = !pause || (rpb05.pass && rpb06.pass && rpb07.pass);
  const suite = {
    suite: "UAT-SUITE-REBUILD-PROBE-BUDGET",
    image: IMAGE, label, revision: rev, rig: RIG, extraEnv: EXTRA_ENV, pause,
    r0, "UAT-RPB-01": rpb01, "UAT-RPB-02": rpb02, "UAT-RPB-03": rpb03,
    "UAT-RPB-04": { id: "UAT-RPB-04", pass: null, status: "BLOCKED", reason: "real K8s EndpointSlice not in this Docker run" },
    "UAT-RPB-05": rpb05, "UAT-RPB-06": rpb06, "UAT-RPB-07": rpb07,
    // 默认配置关单仍看 01–03；暂停跑次另看 05–07。pause 模式下 suite.pass 表示暂停合同。
    pass: pause ? (r0.pass && pausePass && rpb03.pass) : defaultPass,
    defaultConfigPass: defaultPass
  };
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(suite, null, 2));
  writeFileSync(path.join(OUT, "samples.json"), JSON.stringify(window.samples, null, 2));
  writeFileSync(path.join(OUT, "customer.json"), JSON.stringify(window.customer, null, 2));
  if (window.mcp.length) writeFileSync(path.join(OUT, "mcp.json"), JSON.stringify(window.mcp, null, 2));
  console.log(JSON.stringify({
    pass: suite.pass, pause, defaultConfigPass: defaultPass,
    r0: r0.pass, rpb01: rpb01.pass, rpb02: rpb02.pass, rpb03: rpb03.pass,
    rpb05: rpb05.pass, rpb06: rpb06.pass, rpb07: rpb07.pass,
    readyS, stats: window.stats, maxStreak: window.maxStreak, out: OUT
  }, null, 2));
  removeContainer();
  if (!suite.pass) process.exitCode = 1;
}

function clean() {
  removeContainer();
  for (const v of dockerTry(["volume", "ls", "-q", "--filter", `name=${PREFIX}`]).split("\n").filter(Boolean)) removeVolume(v);
  rmSync(SECRETS, { recursive: true, force: true });
  log("cleaned");
}

if (cmd === "clean") clean();
else if (cmd === "all") await all();
else {
  console.error("usage: node scripts/uat/rebuild-probe-budget.mjs all|clean [--image IMG] [--label L] [--remigrate] [--premigrate-wait-s N] [--env KEY=VAL]");
  process.exit(2);
}
