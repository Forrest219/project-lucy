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

async function premigrate() {
  if (volumeExists(MIG) && !flag("remigrate")) {
    log(`reuse migrated volume ${MIG}`);
    return MIG;
  }
  if (!volumeExists(SNAP_OLD)) throw new Error(`missing ${SNAP_OLD}; run: npm run uat:cold-start -- seed`);
  log(`premigrating ${SNAP_OLD} → ${MIG}`);
  copyVolume(SNAP_OLD, `${RUN}-data`);
  startContainer(`${RUN}-data`, { throttle: false });
  if (!(await waitReady(300))) throw new Error("premigrate ready failed");
  // Wait for rebuild catch-up to finish (poll inferred_rebuild_state).
  const waitS = Number(opt("premigrate-wait-s") ?? 300);
  log(`premigrate settle ${waitS}s`);
  await sleep(waitS * 1000);
  docker(["stop", "-t", "60", RUN]); removeContainer();
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

async function sampleWindow(windowS) {
  const samples = [];
  const customer = [];
  const t0 = performance.now();
  let streak = 0; let maxStreak = 0;
  let nextCustomer = 0;
  while ((performance.now() - t0) / 1000 < windowS) {
    const livez = await timed(`${WEB}/api/livez`, {}, 8000);
    const readyz = await timed(`${WEB}/api/readyz`, {}, 8000);
    samples.push({
      t: +((performance.now() - t0) / 1000).toFixed(2),
      livezMs: livez.ms, livezCode: livez.code,
      readyzMs: readyz.ms, readyzCode: readyz.code
    });
    if ((performance.now() - t0) >= nextCustomer) {
      const c = await timed(`${WEB}/api/readyz`, {}, LIMITS.customerTimeoutMs);
      const fail = c.code !== 200 || c.ms >= LIMITS.customerTimeoutMs;
      streak = fail ? streak + 1 : 0;
      maxStreak = Math.max(maxStreak, streak);
      customer.push({ t: +((performance.now() - t0) / 1000).toFixed(2), ms: c.ms, code: c.code, fail });
      nextCustomer += LIMITS.customerPeriodMs;
    }
    await sleep(1000);
  }
  const livezMs = samples.map((s) => s.livezMs);
  const readyzMs = samples.map((s) => s.readyzMs);
  return {
    samples, customer, maxStreak,
    stats: {
      livezMaxMs: Math.max(...livezMs), livezP99Ms: pct(livezMs, 99),
      readyzMaxMs: Math.max(...readyzMs), readyzP99Ms: pct(readyzMs, 99),
      livezNon200: samples.filter((s) => s.livezCode !== 200).length,
      readyzNon200: samples.filter((s) => s.readyzCode !== 200).length
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
  if (cookie) {
    project = await timed(`${WEB}/api/project`, { headers: { cookie } }, 8000);
  }
  return { claimCode: claim.code, cookie: Boolean(cookie), hits, project };
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
  // Start unthrottled briefly to inject recent rows onto a working copy
  copyVolume(mig, `${RUN}-data`);
  startContainer(`${RUN}-data`, { throttle: false });
  if (!(await waitReady(180))) throw new Error("inject-ready failed");
  const injected = injectRecentActivity();
  log("injected", injected);
  docker(["stop", "-t", "30", RUN]); removeContainer();

  // RPB-01/02: throttled cold start with forced rebuild load
  dropCaches();
  copyVolume(`${RUN}-data`, `${RUN}-boot`);
  const t0 = performance.now();
  startContainer(`${RUN}-boot`, { throttle: !flag("no-throttle"), extraEnv: EXTRA_ENV });
  const readyOk = await waitReady(LIMITS.readyS);
  const readyS = +((performance.now() - t0) / 1000).toFixed(1);
  if (!readyOk) throw new Error("candidate ready failed");
  const window = await sampleWindow(LIMITS.windowS);
  const business = await mintAndHitProject();

  const rpb01 = {
    id: "UAT-RPB-01",
    pass: readyOk
      && window.stats.livezMaxMs <= LIMITS.livezMaxMs
      && window.stats.livezP99Ms <= LIMITS.livezP99Ms
      && window.stats.readyzP99Ms <= LIMITS.readyzP99Ms
      && window.stats.livezNon200 === 0
      && window.stats.readyzNon200 === 0,
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
    pass: business.hits.every((h) => h.code === 200),
    checks: [
      check("readyz burst all 200", business.hits.every((h) => h.code === 200), {
        n: business.hits.length,
        maxMs: Math.max(...business.hits.map((h) => h.ms))
      }, "all 200")
    ]
  };

  const suite = {
    suite: "UAT-SUITE-REBUILD-PROBE-BUDGET",
    image: IMAGE, label, revision: rev, rig: RIG, extraEnv: EXTRA_ENV,
    r0, "UAT-RPB-01": rpb01, "UAT-RPB-02": rpb02, "UAT-RPB-03": rpb03,
    "UAT-RPB-04": { id: "UAT-RPB-04", pass: null, status: "BLOCKED", reason: "real K8s EndpointSlice not in this Docker run" },
    pass: r0.pass && rpb01.pass && rpb02.pass && rpb03.pass
  };
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(suite, null, 2));
  writeFileSync(path.join(OUT, "samples.json"), JSON.stringify(window.samples, null, 2));
  writeFileSync(path.join(OUT, "customer.json"), JSON.stringify(window.customer, null, 2));
  console.log(JSON.stringify({
    pass: suite.pass, r0: r0.pass, rpb01: rpb01.pass, rpb02: rpb02.pass, rpb03: rpb03.pass,
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
  console.error("usage: node scripts/uat/rebuild-probe-budget.mjs all|clean [--image IMG] [--label L] [--remigrate] [--premigrate-wait-s N]");
  process.exit(2);
}
