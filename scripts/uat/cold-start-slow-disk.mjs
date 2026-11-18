#!/usr/bin/env node
/**
 * P1-39／REQ-030-060 测试台：慢盘＋冷页缓存＋客户规模审计库的**冷启动演练**。
 *
 *   node scripts/uat/cold-start-slow-disk.mjs r0                      # 环境门禁：限速生效、能清页缓存、镜像身份
 *   node scripts/uat/cold-start-slow-disk.mjs seed [--reseed]         # 用 0.25.0 镜像造 20 万行／~880MB 旧 schema 审计库快照
 *   node scripts/uat/cold-start-slow-disk.mjs cold01                  # 对照：0.25.0 在同一台限速机上必须能起来
 *   node scripts/uat/cold-start-slow-disk.mjs cold02 --new-image IMG  # 候选镜像：旧库首次升级冷启动
 *   node scripts/uat/cold-start-slow-disk.mjs cold03 --new-image IMG  # 候选镜像：已迁移库再次冷启动（Pod 重启）
 *   node scripts/uat/cold-start-slow-disk.mjs cold04 --new-image IMG  # 候选镜像：稳态下页缓存被冲掉（--warm-start 仅供改前基线）
 *   node scripts/uat/cold-start-slow-disk.mjs cold05 --new-image IMG  # 候选镜像：冷启动后合法用户主路径（管理员认领＋MCP）
 *   node scripts/uat/cold-start-slow-disk.mjs all --new-image IMG
 *   node scripts/uat/cold-start-slow-disk.mjs pagecost --new-image IMG # 诊断（非门禁）：重建单页（400 行）在限速冷盘/热缓存/不限速冷盘下的同步读取耗时
 *   node scripts/uat/cold-start-slow-disk.mjs clean                   # 删本脚本创建的容器与数据卷
 *
 * 全真：真实镜像、真实 entrypoint、真实 HTTP；限速用 Docker blkio（与 2026-11-17 复盘一致）。不 mock，不 `docker restart`。
 * 所有资源名以 `lucy-uat-cold` 开头；`clean` 只认该前缀。证据写 `inbox/uat-cold-start-<label>/`，不含任何密钥。
 * 阈值与 Spec `lucy-20261117-cold-start-audit-scan-spec.md` §6 同源；改阈值先改 Spec。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX = "lucy-uat-cold";
const RUN = `${PREFIX}-run`;
const SNAP_OLD = `${PREFIX}-snap-old`;
const OLD_IMAGE = process.env.UAT_COLD_OLD_IMAGE ?? "project-lucy:old-9c78b0e3";
const WEB_PORT = Number(process.env.UAT_COLD_WEBUI_PORT ?? 55391);
const PROXY_PORT = Number(process.env.UAT_COLD_PROXY_PORT ?? 57991);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const MCP = `http://127.0.0.1:${PROXY_PORT}/mcp`;
const ROWS = Number(process.env.UAT_COLD_ROWS ?? 200000);
const USERS = Number(process.env.UAT_COLD_USERS ?? 67);
const RIG = {
  readMBps: Number(process.env.UAT_COLD_READ_MBPS ?? 30),
  writeMBps: Number(process.env.UAT_COLD_WRITE_MBPS ?? 30),
  readIops: Number(process.env.UAT_COLD_READ_IOPS ?? 300),
  writeIops: Number(process.env.UAT_COLD_WRITE_IOPS ?? 100),
  cpus: Number(process.env.UAT_COLD_CPUS ?? 2)
};
// 门槛（Spec §6）。
const LIMITS = {
  firstUpgradeReadyS: 150, // Chart 0.2.8 liveness 预算 ≈ 60+3×30s；0.2.9 startupProbe ≈ 300s
  restartReadyS: 60,
  windowS: 120, // 默认值；`--window-s` 可加长，用于首次升级后台补算较长的构建
  livezMaxMs: 1000,
  livezP99Ms: 400,
  // 首次升级补算窗口（UAT-COLD-02）单独放宽：委托人 2026-11-18 批准，依据见 Spec OQ-2。
  firstUpgradeLivezMaxMs: 2000,
  firstUpgradeLivezP99Ms: 1000,
  readyzP99Ms: 1500,
  coldCacheWindowS: 60,
  mainPathStepMs: 5000,
  oldReadyS: 120
};
const SECRETS = path.join(os.tmpdir(), `${PREFIX}-secrets`);

const docker = (args, options = {}) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...options });
const dockerTry = (args) => { try { return docker(args); } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...a) => console.error(`[cold-start]`, ...a);

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const NEW_IMAGE = opt("new-image");
const WINDOW_S = Number(opt("window-s") ?? LIMITS.windowS);
const PREMIGRATE_WAIT_S = Number(opt("premigrate-wait-s") ?? 30);
const today = new Date().toISOString().slice(0, 10);
const label = opt("label") ?? `${today}-${(NEW_IMAGE ?? "baseline").split(":").pop().replace(/[^\w.-]/g, "_")}`;
const OUT = path.join(ROOT, "inbox", `uat-cold-start-${label}`);

// ---------- 限速环境 ----------
function throttleFlags() {
  const dev = process.env.UAT_COLD_DEVICE ?? detectDevice();
  return [
    "--cpus", String(RIG.cpus),
    "--device-read-bps", `${dev}:${RIG.readMBps}mb`, "--device-write-bps", `${dev}:${RIG.writeMBps}mb`,
    "--device-read-iops", `${dev}:${RIG.readIops}`, "--device-write-iops", `${dev}:${RIG.writeIops}`
  ];
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
function dropCaches() {
  docker(["run", "--rm", "--privileged", "--pid=host", "alpine:latest", "nsenter", "-t", "1", "-m", "sh", "-c", "sync; echo 3 > /proc/sys/vm/drop_caches"]);
}

// ---------- 卷与容器 ----------
const volumeExists = (name) => dockerTry(["volume", "inspect", name]).includes('"Name"');
const removeContainer = (name) => dockerTry(["rm", "-f", name]);
const removeVolume = (name) => dockerTry(["volume", "rm", "-f", name]);
function createDataVolume(name, image) {
  docker(["volume", "create", name]);
  docker(["run", "--rm", "--user", "0", "--entrypoint", "/bin/sh", "-v", `${name}:/data/lucy`, image, "-ec",
    "mkdir -p /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui && chown 10001:10001 /data/lucy /data/lucy/config /data/lucy/.ktx /data/lucy/.ktx-ui"]);
}
function copyVolume(from, to) {
  removeVolume(to);
  docker(["volume", "create", to]);
  docker(["run", "--rm", "-v", `${from}:/from:ro`, "-v", `${to}:/to`, "alpine:latest", "sh", "-c", "cp -a /from/. /to/"]);
}
function ensureBootstrapSecret() {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const file = path.join(SECRETS, "bootstrap-token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  return file;
}
function startContainer(image, volume, { throttle }) {
  removeContainer(RUN);
  const env = {
    KTX_PROJECT_ROOT: "/data/lucy", LUCY_TEMPLATE_ROOT: "/app/examples/docker-demo/project-template",
    LUCY_WEBUI_HOST: "0.0.0.0", LUCY_WEBUI_PORT: "5174", LUCY_PROXY_HOST: "0.0.0.0", LUCY_PROXY_PORT: "7879",
    LUCY_PROXY_UPSTREAM_HOST: "127.0.0.1", LUCY_PROXY_UPSTREAM_PORT: "7878", LUCY_CONTENT_ROOT: "/data/lucy/config",
    LUCY_PUBLIC_MCP_URL: MCP, LUCY_DEPLOYMENT_MODE: "customer",
    LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: "/run/secrets/webui_bootstrap_token", LUCY_WEBUI_COOKIE_SECURE: "0",
    LUCY_WEBUI_TEST_PROFILE: "1", POSTHOG_DISABLED: "1"
  };
  docker(["run", "-d", "--name", RUN, ...(throttle ? throttleFlags() : []),
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`,
    "-v", `${volume}:/data/lucy`, "-v", `${ensureBootstrapSecret()}:/run/secrets/webui_bootstrap_token:ro`,
    // 诊断用：UAT_EXTRA_DOCKER_ARGS 以空格分隔追加 docker run 参数（例如 -e NODE_OPTIONS=--cpu-prof）。不影响正式跑次。
    ...(process.env.UAT_EXTRA_DOCKER_ARGS ? process.env.UAT_EXTRA_DOCKER_ARGS.split(" ").filter(Boolean) : []), image]);
}
function containerState() {
  try {
    const s = JSON.parse(docker(["inspect", RUN]))[0].State;
    return { running: s.Running, exitCode: s.ExitCode, restarts: JSON.parse(docker(["inspect", RUN]))[0].RestartCount, oomKilled: s.OOMKilled };
  } catch { return { running: false, exitCode: null, restarts: null, oomKilled: false }; }
}
// `docker logs` 把容器 stderr 写到自己的 stderr；必须两路都收，否则崩溃原因（FST_ERR_HOOK_TIMEOUT 等）会丢。
const containerLogs = () => {
  const r = spawnSync("docker", ["logs", RUN], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};
function imageIdentity(image) {
  const rev = dockerTry(["run", "--rm", "--entrypoint", "cat", image, "/app/BUILD_REVISION"]).trim().split("\n")[0];
  const ver = dockerTry(["run", "--rm", "--entrypoint", "cat", image, "/app/VERSION"]).trim().split("\n")[0];
  return { image, revision: rev.slice(0, 80), version: ver.slice(0, 40) };
}

// ---------- 采样与统计 ----------
async function timed(url, init = {}, timeoutMs = 8000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    return { ms: Math.round(performance.now() - t), code: r.status, text, headers: r.headers };
  } catch (e) { return { ms: Math.round(performance.now() - t), code: 0, text: String(e.message ?? e), headers: undefined }; }
}
const pct = (xs, p) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; };
function startSampler(mode, t0) {
  const samples = []; let stopped = false; let n = 0;
  const loop = (async () => {
    while (!stopped) {
      const s = { t: +((performance.now() - t0) / 1000).toFixed(1) };
      if (mode === "new") { const l = await timed(`${WEB}/api/livez`); const r = await timed(`${WEB}/api/readyz`); s.livezMs = l.ms; s.livezCode = l.code; s.readyzMs = r.ms; s.readyzCode = r.code; }
      if (mode === "old" || n % 5 === 0) { const h = await timed(`${WEB}/api/health`); s.healthMs = h.ms; s.healthCode = h.code; }
      samples.push(s); n += 1; await sleep(1000);
    }
  })();
  return { samples, async stop() { stopped = true; await loop; return samples; } };
}
const isReady = (mode, s) => (mode === "new" ? s.readyzCode === 200 : s.healthCode === 200);
const windowStats = (mode, samples, from, to) => {
  const w = samples.filter((s) => s.t >= from && s.t <= to);
  const pick = (k) => w.map((s) => s[k]).filter((v) => v !== undefined);
  return {
    samples: w.length,
    livezMaxMs: pick("livezMs").length ? Math.max(...pick("livezMs")) : null, livezP99Ms: pct(pick("livezMs"), 99),
    livezNon200: w.filter((s) => s.livezCode !== undefined && s.livezCode !== 200).length,
    readyzMaxMs: pick("readyzMs").length ? Math.max(...pick("readyzMs")) : null, readyzP99Ms: pct(pick("readyzMs"), 99),
    // 记录不判分：占空比让出（SC-17）是否仍在，看 readyz 的中位与 p95，而不只看 p99
    readyzP50Ms: pct(pick("readyzMs"), 50), readyzP95Ms: pct(pick("readyzMs"), 95),
    readyzNon200: w.filter((s) => s.readyzCode !== undefined && s.readyzCode !== 200).length,
    healthMaxMs: pick("healthMs").length ? Math.max(...pick("healthMs")) : null,
    healthNon200: w.filter((s) => s.healthCode !== undefined && s.healthCode !== 200).length
  };
};
const check = (name, pass, actual, limit) => ({ name, pass: Boolean(pass), actual, limit });

// ---------- 一次冷启动场景 ----------
async function scenario({ id, image, mode, volume, throttle = true, cold = true, readyBudgetS, windowS, midAction, afterReady }) {
  log(`${id}: restore ${volume} → run volume, image=${image}, throttle=${throttle}, coldCache=${cold}`);
  removeContainer(RUN); copyVolume(volume, `${RUN}-data`);
  if (cold) dropCaches();
  const t0 = performance.now();
  startContainer(image, `${RUN}-data`, { throttle: throttle && !flag("no-throttle") });
  const sampler = startSampler(mode, t0);
  let readyT = null; let exited = null;
  const deadline = t0 + 360_000;
  while (performance.now() < deadline) {
    await sleep(1000);
    const st = containerState();
    if (!st.running) { exited = st; break; }
    const ready = sampler.samples.find((s) => isReady(mode, s));
    if (ready) { readyT = ready.t; break; }
  }
  let afterReadyResult;
  if (readyT !== null) {
    const endT = readyT + windowS;
    if (midAction) { await sleep(midAction.atS * 1000); midAction.run(+((performance.now() - t0) / 1000).toFixed(1)); }
    if (afterReady) afterReadyResult = await afterReady();
    while ((performance.now() - t0) / 1000 < endT && containerState().running) await sleep(1000);
  }
  const samples = await sampler.stop();
  const finalState = containerState();
  const logs = containerLogs();
  if (process.env.UAT_KEEP_CONTAINER !== "1") removeContainer(RUN); // 诊断时保留停止的容器以便 docker cp 取证
  return { id, image, readyT, exited, finalState, samples, logs, afterReadyResult, windowStart: readyT, windowEnd: readyT === null ? null : readyT + windowS };
}
function logFindings(logs) {
  const lines = logs.split("\n");
  return {
    hookTimeout: lines.some((l) => /FST_ERR_HOOK_TIMEOUT|AVV_ERR_READY_TIMEOUT/.test(l)),
    auditSchemaReady: lines.find((l) => /\[audit\].*schema ready/i.test(l))?.slice(0, 200) ?? null,
    tail: lines.slice(-12).map((l) => l.slice(0, 240))
  };
}
function persist(caseId, result) {
  mkdirSync(OUT, { recursive: true });
  const { samples, logs, ...rest } = result;
  writeFileSync(path.join(OUT, `${caseId}.json`), JSON.stringify({ ...rest, logFindings: logFindings(logs ?? "") }, null, 2));
  const cols = ["t", "livezMs", "livezCode", "readyzMs", "readyzCode", "healthMs", "healthCode"];
  writeFileSync(path.join(OUT, `${caseId}-samples.csv`), [cols.join(","), ...(samples ?? []).map((s) => cols.map((c) => s[c] ?? "").join(","))].join("\n"));
  writeFileSync(path.join(OUT, `${caseId}-container.log`), (logs ?? "").slice(-200_000));
}
function report(caseId, title, checks, extra = {}) {
  const pass = checks.every((c) => c.pass);
  const result = { id: caseId, title, pass, checks, ...extra };
  persist(caseId, { ...result, samples: extra.samples, logs: extra.logs });
  console.log(`\n${pass ? "PASS" : "FAIL"}  ${caseId}  ${title}`);
  for (const c of checks) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}: actual=${JSON.stringify(c.actual)} limit=${c.limit}`);
  return pass;
}

// ---------- 用例 ----------
async function seed() {
  if (volumeExists(SNAP_OLD) && !flag("reseed")) { log("snapshot exists; use --reseed to rebuild"); return; }
  log(`seeding snapshot with ${OLD_IMAGE} (${ROWS} rows, ${USERS} users) — takes a few minutes`);
  removeContainer(`${PREFIX}-seed`); removeVolume(SNAP_OLD);
  createDataVolume(SNAP_OLD, OLD_IMAGE);
  const env = ["-e", "KTX_PROJECT_ROOT=/data/lucy", "-e", "LUCY_TEMPLATE_ROOT=/app/examples/docker-demo/project-template", "-e", "LUCY_WEBUI_HOST=0.0.0.0", "-e", "LUCY_WEBUI_PORT=5174",
    "-e", "LUCY_PROXY_HOST=0.0.0.0", "-e", "LUCY_PROXY_PORT=7879", "-e", "LUCY_PROXY_UPSTREAM_HOST=127.0.0.1", "-e", "LUCY_PROXY_UPSTREAM_PORT=7878", "-e", "LUCY_CONTENT_ROOT=/data/lucy/config",
    "-e", "LUCY_DEPLOYMENT_MODE=customer", "-e", "LUCY_WEBUI_COOKIE_SECURE=0", "-e", "LUCY_WEBUI_TEST_PROFILE=1", "-e", "POSTHOG_DISABLED=1"];
  docker(["run", "-d", "--name", `${PREFIX}-seed`, ...env, "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`, "-v", `${SNAP_OLD}:/data/lucy`, OLD_IMAGE]);
  for (let i = 0; i < 90; i += 1) { if ((await timed(`${WEB}/api/health`)).code === 200) break; await sleep(2000); }
  for (let i = 0; i < 30; i += 1) {
    await timed(MCP, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) });
    const t = dockerTry(["exec", `${PREFIX}-seed`, "node", "-e", `const D=require("/app/webui/node_modules/better-sqlite3");try{new D("/data/lucy/.ktx-ui/audit.sqlite",{readonly:true}).prepare("select count(*) c from access_log").get();console.log("ready")}catch(e){console.log("no")}`]);
    if (t.includes("ready")) break; await sleep(2000);
  }
  docker(["stop", "-t", "30", `${PREFIX}-seed`]); removeContainer(`${PREFIX}-seed`);
  const out = docker(["run", "--rm", "--entrypoint", "node", "-e", `ROWS=${ROWS}`, "-e", `USERS=${USERS}`, "-v", `${SNAP_OLD}:/data/lucy`,
    "-v", `${path.join(ROOT, "scripts/uat/cold-start-slow-disk-seed.cjs")}:/seed.cjs:ro`, OLD_IMAGE, "/seed.cjs"]);
  log(out.trim());
}
function snapshotFacts() {
  return docker(["run", "--rm", "-v", `${SNAP_OLD}:/d:ro`, "alpine:latest", "sh", "-c", "ls -l /d/.ktx-ui/ | grep audit; du -sm /d/.ktx-ui/audit.sqlite | cut -f1"]).trim();
}
async function r0() {
  const checks = [];
  const dev = detectDevice();
  checks.push(check("block device detected", /^\/dev\//.test(dev), dev, "/dev/*"));
  const probeVol = `${PREFIX}-r0-probe`; docker(["volume", "create", probeVol]);
  const dd = dockerTry(["run", "--rm", ...throttleFlags(), "-v", `${probeVol}:/data`, "alpine:latest", "sh", "-c", "dd if=/dev/zero of=/data/p bs=1M count=60 oflag=direct 2>&1 | tail -1; rm -f /data/p"]);
  const secs = Number((dd.match(/([\d.]+)\s*seconds/) ?? [])[1] ?? NaN);
  const mbps = 60 / secs;
  checks.push(check("throttle effective: 60MB direct write", mbps <= RIG.writeMBps * 1.5, `${mbps.toFixed(1)} MB/s`, `≤ ${(RIG.writeMBps * 1.5).toFixed(0)} MB/s`));
  removeVolume(probeVol);
  let dropOk = true; try { dropCaches(); } catch { dropOk = false; }
  checks.push(check("page cache can be dropped", dropOk, dropOk, true));
  const ids = [OLD_IMAGE, ...(NEW_IMAGE ? [NEW_IMAGE] : [])].map(imageIdentity);
  checks.push(check("images resolvable", ids.every((i) => i.revision || i.version), ids, "revision/version readable"));
  const snap = volumeExists(SNAP_OLD) ? snapshotFacts() : null;
  checks.push(check("seed snapshot present", Boolean(snap), snap, "run `seed`"));
  return report("UAT-COLD-R0", "环境门禁", checks, { rig: RIG, identities: ids });
}
function readyCheck(res, budgetS) {
  return [
    check("process stayed up (no exit)", res.exited === null && res.finalState.running, res.exited ?? res.finalState, "running"),
    check("no FST_ERR_HOOK_TIMEOUT / AVV_ERR_READY_TIMEOUT", !logFindings(res.logs).hookTimeout, logFindings(res.logs).hookTimeout, false),
    check("restart count == 0", res.finalState.restarts === 0, res.finalState.restarts, 0),
    check(`ready within ${budgetS}s`, res.readyT !== null && res.readyT <= budgetS, res.readyT, `≤ ${budgetS}s`)
  ];
}
function steadyChecks(stats, { livezMaxMs = LIMITS.livezMaxMs, livezP99Ms = LIMITS.livezP99Ms } = {}) {
  return [
    check("livez max", stats.livezMaxMs !== null && stats.livezMaxMs <= livezMaxMs, stats.livezMaxMs, `≤ ${livezMaxMs}ms`),
    check("livez p99", stats.livezP99Ms !== null && stats.livezP99Ms <= livezP99Ms, stats.livezP99Ms, `≤ ${livezP99Ms}ms`),
    check("readyz p99", stats.readyzP99Ms !== null && stats.readyzP99Ms <= LIMITS.readyzP99Ms, stats.readyzP99Ms, `≤ ${LIMITS.readyzP99Ms}ms`),
    check("livez/readyz all 200 after ready", stats.livezNon200 === 0 && stats.readyzNon200 === 0, { livez: stats.livezNon200, readyz: stats.readyzNon200 }, 0)
  ];
}
async function cold01() {
  const res = await scenario({ id: "UAT-COLD-01", image: OLD_IMAGE, mode: "old", volume: SNAP_OLD, readyBudgetS: LIMITS.oldReadyS, windowS: 60 });
  const stats = res.readyT === null ? null : windowStats("old", res.samples, res.windowStart, res.windowEnd);
  return report("UAT-COLD-01", "对照：0.25.0 在同一限速冷启动台上能起来", [...readyCheck(res, LIMITS.oldReadyS), check("health all 200 in 60s window", stats && stats.healthNon200 === 0, stats?.healthNon200, 0)], { ...res, stats });
}
async function migratedVolume() {
  const tag = `${PREFIX}-snap-mig-${(NEW_IMAGE ?? "x").split(":").pop().replace(/[^\w.-]/g, "_").toLowerCase()}`;
  if (volumeExists(tag) && !flag("remigrate")) return tag;
  log(`pre-migrating snapshot with ${NEW_IMAGE} (unthrottled, warm)`);
  copyVolume(SNAP_OLD, `${RUN}-data`); removeContainer(RUN);
  startContainer(NEW_IMAGE, `${RUN}-data`, { throttle: false });
  for (let i = 0; i < 180; i += 1) { if ((await timed(`${WEB}/api/readyz`)).code === 200) break; await sleep(2000); }
  await sleep(PREMIGRATE_WAIT_S * 1000); // 候选构建若有一次性后台补算，须用 --premigrate-wait-s 等它跑完，否则 03/04 会被未完成的补算污染
  docker(["stop", "-t", "60", RUN]); removeContainer(RUN);
  copyVolume(`${RUN}-data`, tag);
  return tag;
}
async function cold02() {
  const res = await scenario({ id: "UAT-COLD-02", image: NEW_IMAGE, mode: "new", volume: SNAP_OLD, readyBudgetS: LIMITS.firstUpgradeReadyS, windowS: WINDOW_S });
  const stats = res.readyT === null ? null : windowStats("new", res.samples, res.windowStart, res.windowEnd);
  return report("UAT-COLD-02", "旧库首次升级：慢盘冷缓存冷启动", [...readyCheck(res, LIMITS.firstUpgradeReadyS), ...(stats ? steadyChecks(stats, { livezMaxMs: LIMITS.firstUpgradeLivezMaxMs, livezP99Ms: LIMITS.firstUpgradeLivezP99Ms }) : [check("steady-state window measured", false, null, "needs ready")])], { ...res, stats });
}
async function cold03() {
  const vol = await migratedVolume();
  const res = await scenario({ id: "UAT-COLD-03", image: NEW_IMAGE, mode: "new", volume: vol, readyBudgetS: LIMITS.restartReadyS, windowS: WINDOW_S });
  const stats = res.readyT === null ? null : windowStats("new", res.samples, res.windowStart, res.windowEnd);
  return report("UAT-COLD-03", "已迁移库再次冷启动（Pod 重启）", [...readyCheck(res, LIMITS.restartReadyS), ...(stats ? steadyChecks(stats) : [check("steady-state window measured", false, null, "needs ready")])], { ...res, stats });
}
async function cold04() {
  const vol = await migratedVolume();
  let droppedAtT = null;
  // --warm-start：启动时不清页缓存，只在就绪后清。仅用于改前基线里「启动本身就崩」时单独检验轮询假说；正式门禁不加该参数。
  const res = await scenario({ id: "UAT-COLD-04", image: NEW_IMAGE, mode: "new", volume: vol, cold: !flag("warm-start"), readyBudgetS: LIMITS.restartReadyS, windowS: 20 + LIMITS.coldCacheWindowS,
    midAction: { atS: 20, run: (nowT) => { droppedAtT = nowT; dropCaches(); } } });
  const stats = res.readyT === null || droppedAtT === null ? null : windowStats("new", res.samples, droppedAtT, droppedAtT + LIMITS.coldCacheWindowS);
  return report("UAT-COLD-04", "稳态下页缓存被冲掉（后台轮询冷读）", [...readyCheck(res, LIMITS.restartReadyS), ...(stats ? steadyChecks(stats) : [check("cold-cache window measured", false, null, "needs ready")])], { ...res, stats, droppedAtT });
}
async function mainPath() {
  const out = []; const step = async (name, fn) => { const r = await fn(); out.push(check(name, r.ok && r.ms <= LIMITS.mainPathStepMs, { ms: r.ms, detail: r.detail }, `ok & ≤ ${LIMITS.mainPathStepMs}ms`)); return r; };
  const password = `Uat-${randomBytes(12).toString("hex")}-9a`;
  const token = readFileSync(path.join(SECRETS, "bootstrap-token"), "utf8");
  const json = (o) => ({ "content-type": "application/json", ...o });
  let cookie = "";
  await step("admin bootstrap claim", async () => {
    const r = await timed(`${WEB}/api/auth/bootstrap`, { method: "POST", headers: json({ "x-lucy-bootstrap-token": token }), body: JSON.stringify({ adminId: "uatcoldadmin", displayName: "UAT Cold", password }) });
    cookie = (r.headers?.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
    return { ok: r.code < 300 && Boolean(cookie), ms: r.ms, detail: r.code };
  });
  await step("admin session reads /api/project", async () => { const r = await timed(`${WEB}/api/project`, { headers: { cookie } }); return { ok: r.code === 200, ms: r.ms, detail: r.code }; });
  const post = (route, body) => timed(`${WEB}${route}`, { method: "POST", headers: json({ cookie }), body: JSON.stringify(body) });
  let bearer = "";
  await step("create role, agent and token", async () => {
    const t = performance.now();
    const role = await post("/api/admin/roles", { dryRun: false, roleId: "uat_cold_min", role: { description: "UAT cold-start minimal", allow: { connections: [], tableSelectors: [], tools: ["wiki_search", "lucy_catalog", "connection_list"] } } });
    const agent = await post("/api/admin/agents", { dryRun: false, agent: { id: "uat_cold_agent", name: "UAT cold agent", roles: ["uat_cold_min"] } });
    const tok = await post("/api/admin/agents/uat_cold_agent/tokens", { label: "uat", expires_at: new Date(Date.now() + 3_600_000).toISOString(), dryRun: false });
    let parsed; try { parsed = JSON.parse(tok.text); } catch { parsed = {}; }
    bearer = parsed?.data?.token ?? parsed?.data?.plaintext ?? parsed?.token ?? "";
    return { ok: typeof bearer === "string" && bearer.length > 0, ms: Math.round(performance.now() - t), detail: { role: role.code, agent: agent.code, token: tok.code } };
  });
  const rpc = (id, method, params, sid) => timed(MCP, { method: "POST", headers: json({ authorization: `Bearer ${bearer}`, accept: "application/json, text/event-stream", ...(sid ? { "mcp-session-id": sid } : {}) }), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  let sid;
  await step("MCP initialize with Bearer", async () => {
    const r = await rpc(1, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "uat-cold", version: "1" } });
    sid = r.headers?.get("mcp-session-id") ?? undefined;
    return { ok: r.code === 200 && /"result"/.test(r.text), ms: r.ms, detail: r.code };
  });
  await step("MCP tools/list returns tools", async () => {
    const r = await rpc(2, "tools/list", {}, sid);
    return { ok: r.code === 200 && /"tools"/.test(r.text), ms: r.ms, detail: r.code };
  });
  return out;
}
async function cold05() {
  // 首次升级路径（旧库、慢盘、冷缓存）上，等 ready 后立刻走真实管理员认领与 MCP 握手。
  const res = await scenario({ id: "UAT-COLD-05", image: NEW_IMAGE, mode: "new", volume: SNAP_OLD, readyBudgetS: LIMITS.firstUpgradeReadyS, windowS: 10, afterReady: mainPath });
  const steps = res.afterReadyResult ?? [check("main path executed", false, null, "needs ready")];
  return report("UAT-COLD-05", "冷启动后合法用户主路径可用（管理员认领＋MCP 握手）", [...readyCheck(res, LIMITS.firstUpgradeReadyS), ...steps], res);
}
async function pagecost() {
  const vol = await migratedVolume();
  copyVolume(vol, `${RUN}-data`);
  const img = NEW_IMAGE;
  const run = (throttle, extraEnv = []) => {
    const out = docker(["run", "--rm", ...(throttle ? throttleFlags() : []), ...extraEnv, "--entrypoint", "node", "-v", `${RUN}-data:/data/lucy`,
      "-v", `${path.join(ROOT, "scripts/uat/cold-start-slow-disk-pagecost.cjs")}:/q.cjs:ro`, img, "/q.cjs"]).trim().split("\n").pop();
    return JSON.parse(out);
  };
  const results = {};
  dropCaches(); results.throttledCold = run(true);
  results.throttledWarm = run(true);
  dropCaches(); results.unthrottledCold = run(false);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, "pagecost.json"), JSON.stringify({ image: img, rig: RIG, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  console.log("诊断输出，不判 PASS/FAIL。门禁看 cold02–cold05。");
}
function clean() {
  for (const name of [RUN, `${PREFIX}-seed`, `${PREFIX}-probe`]) removeContainer(name);
  const vols = dockerTry(["volume", "ls", "-q", "--filter", `name=${PREFIX}`]).split("\n").filter((v) => v.startsWith(PREFIX));
  for (const v of vols) { removeVolume(v); log(`removed volume ${v}`); }
  rmSync(SECRETS, { recursive: true, force: true });
}

// ---------- 入口 ----------
const needsNew = ["cold02", "cold03", "cold04", "cold05", "all", "pagecost"];
if (needsNew.includes(cmd) && !NEW_IMAGE) { console.error("--new-image IMG is required"); process.exit(2); }
const table = { r0, seed, cold01, cold02, cold03, cold04, cold05, pagecost, clean };
if (cmd === "all") {
  const results = [];
  for (const c of [r0, cold01, cold02, cold03, cold04, cold05]) results.push(await c());
  console.log(`\nOVERALL: ${results.every(Boolean) ? "PASS" : "FAIL"}  evidence: ${OUT}`);
  process.exit(results.every(Boolean) ? 0 : 1);
} else if (table[cmd]) {
  const r = await table[cmd]();
  process.exit(r === false ? 1 : 0);
} else {
  console.error("usage: cold-start-slow-disk.mjs <r0|seed|cold01|cold02|cold03|cold04|cold05|pagecost|all|clean> [--new-image IMG] [--label L] [--reseed] [--remigrate] [--no-throttle] [--warm-start] [--window-s N] [--premigrate-wait-s N]");
  process.exit(2);
}
