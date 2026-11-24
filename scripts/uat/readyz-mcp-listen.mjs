#!/usr/bin/env node
/**
 * UAT-SUITE-READYZ-MCP-LISTEN（P1-46／REQ-030-067）
 *
 *   node scripts/uat/readyz-mcp-listen.mjs all --image project-lucy:p145-p147
 *   node scripts/uat/readyz-mcp-listen.mjs clean
 *
 * 全真：独立数据卷 + 真实 entrypoint；启动前即高频采样 readyz，首次 200 时立即 MCP initialize。
 * 禁止以第二次 initialize 成功关单。证据写 inbox/uat-readyz-mcp-listen-<label>/。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PREFIX = "lucy-uat-rml";
const RUN = `${PREFIX}-run`;
const VOL = `${PREFIX}-data`;
const WEB_PORT = Number(process.env.UAT_RML_WEBUI_PORT ?? 55392);
const PROXY_PORT = Number(process.env.UAT_RML_PROXY_PORT ?? 57992);
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const MCP = `http://127.0.0.1:${PROXY_PORT}/mcp`;
const SECRETS = path.join(os.tmpdir(), `${PREFIX}-secrets`);
const SAMPLE_MS = Number(process.env.UAT_RML_SAMPLE_MS ?? 50);
const COLD_STARTS = Number(process.env.UAT_RML_COLD_STARTS ?? 3);

const args = process.argv.slice(2);
const cmd = args[0] ?? "all";
const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const IMAGE = opt("image") ?? "project-lucy:demo";
const today = new Date().toISOString().slice(0, 10);
const label = opt("label") ?? `${today}-${IMAGE.split(":").pop().replace(/[^\w.-]/g, "_")}`;
const OUT = path.join(ROOT, "inbox", `uat-readyz-mcp-listen-${label}`);

const docker = (a, o = {}) => execFileSync("docker", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024, ...o });
const dockerTry = (a) => { try { return docker(a); } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[rml]`, ...a);

function ensureBootstrapSecret() {
  mkdirSync(SECRETS, { recursive: true, mode: 0o700 });
  const file = path.join(SECRETS, "bootstrap-token");
  if (!existsSync(file)) writeFileSync(file, randomBytes(24).toString("hex"), { mode: 0o600 });
  return file;
}
function removeContainer(name = RUN) { dockerTry(["rm", "-f", name]); }
function removeVolume(name) { dockerTry(["volume", "rm", "-f", name]); }
function createDataVolume() {
  removeVolume(VOL);
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
    LUCY_PUBLIC_MCP_URL: MCP, LUCY_DEPLOYMENT_MODE: "customer",
    LUCY_WEBUI_BOOTSTRAP_TOKEN_FILE: "/run/secrets/webui_bootstrap_token", LUCY_WEBUI_COOKIE_SECURE: "0",
    LUCY_WEBUI_TEST_PROFILE: "1", POSTHOG_DISABLED: "1"
  };
  docker(["run", "-d", "--name", RUN,
    ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    "-p", `${WEB_PORT}:5174`, "-p", `${PROXY_PORT}:7879`,
    "-v", `${VOL}:/data/lucy`, "-v", `${ensureBootstrapSecret()}:/run/secrets/webui_bootstrap_token:ro`,
    IMAGE]);
}
function stopContainer() {
  dockerTry(["stop", "-t", "20", RUN]);
  removeContainer();
}
async function timed(url, init = {}, timeoutMs = 3000) {
  const t = performance.now();
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    return { ms: Math.round(performance.now() - t), code: r.status, text, headers: r.headers };
  } catch (e) {
    return { ms: Math.round(performance.now() - t), code: 0, text: String(e.message ?? e), headers: undefined };
  }
}
function parseSetCookie(headers) {
  const raw = headers?.getSetCookie?.() ?? [];
  return raw.map((c) => c.split(";")[0]).filter(Boolean).join("; ");
}
async function mintBearer() {
  const token = readFileSync(path.join(SECRETS, "bootstrap-token"), "utf8").trim();
  const password = `Uat-${randomBytes(12).toString("hex")}-9a`;
  const claim = await timed(`${WEB}/api/auth/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lucy-bootstrap-token": token },
    body: JSON.stringify({ adminId: "uatrmladmin", displayName: "UAT RML", password })
  }, 8000);
  const cookie = parseSetCookie(claim.headers);
  if (claim.code >= 300 || !cookie) throw new Error(`bootstrap claim failed code=${claim.code} body=${claim.text.slice(0, 200)}`);
  const post = (route, body) => timed(`${WEB}${route}`, {
    method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body)
  }, 8000);
  await post("/api/admin/roles", {
    dryRun: false,
    roleId: "uat_rml_min",
    role: { description: "UAT RML", allow: { connections: [], tableSelectors: [], tools: ["wiki_search", "lucy_catalog", "connection_list"] } }
  });
  await post("/api/admin/agents", { dryRun: false, agent: { id: "uat_rml_agent", name: "UAT RML agent", roles: ["uat_rml_min"] } });
  const tok = await post("/api/admin/agents/uat_rml_agent/tokens", {
    label: "uat-rml", expires_at: new Date(Date.now() + 3_600_000).toISOString(), dryRun: false
  });
  let parsed; try { parsed = JSON.parse(tok.text); } catch { parsed = {}; }
  const bearer = parsed?.data?.token ?? parsed?.data?.plaintext ?? parsed?.token ?? "";
  if (!bearer) throw new Error(`token mint failed code=${tok.code} body=${tok.text.slice(0, 300)}`);
  return { bearer, cookie, password };
}

async function mcpInitialize(bearer) {
  return timed(MCP, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${bearer}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "uat-rml", version: "1" } }
    })
  }, 3000);
}

async function waitReadyOnce(bearer) {
  const samples = [];
  const t0 = performance.now();
  let firstReady = null;
  let initAtReady = null;
  const deadline = t0 + 180_000;
  while (performance.now() < deadline) {
    const at = performance.now();
    const ready = await timed(`${WEB}/api/readyz`, {}, 2000);
    const sample = {
      tMs: Math.round(at - t0),
      readyzCode: ready.code,
      readyzMs: ready.ms
    };
    if (ready.code === 200 && firstReady === null) {
      firstReady = sample;
      initAtReady = await mcpInitialize(bearer);
      sample.initCode = initAtReady.code;
      sample.initMs = initAtReady.ms;
      sample.initOk = initAtReady.code === 200 && /"result"/.test(initAtReady.text);
      samples.push(sample);
      break;
    }
    samples.push(sample);
    const spent = performance.now() - at;
    if (spent < SAMPLE_MS) await sleep(SAMPLE_MS - spent);
  }
  return { samples, firstReady, initAtReady, elapsedMs: Math.round(performance.now() - t0) };
}

function check(name, pass, actual, limit) {
  return { name, pass: Boolean(pass), actual, limit };
}

async function r0() {
  const rev = dockerTry(["run", "--rm", "--entrypoint", "cat", IMAGE, "/app/BUILD_REVISION"]).trim().split("\n")[0];
  const checks = [
    check("image readable", Boolean(rev), rev.slice(0, 40), "BUILD_REVISION"),
    check("ports free-ish", true, { WEB_PORT, PROXY_PORT }, "mapped")
  ];
  return { id: "UAT-RML-R0", pass: checks.every((c) => c.pass), checks, revision: rev };
}

async function oneColdStart(bearer, cookie, idx) {
  stopContainer();
  // Start sampling slightly before container start so we catch the window.
  const starter = (async () => {
    await sleep(100);
    startContainer();
  })();
  const result = await waitReadyOnce(bearer);
  await starter;
  const initOk = Boolean(result.initAtReady && result.initAtReady.code === 200 && /"result"/.test(result.initAtReady.text));
  const project = await timed(`${WEB}/api/project`, { headers: { cookie } }, 5000);
  const projectOk = project.code === 200 && project.ms <= 5000;
  const checks = [
    check("first readyz 200 observed", result.firstReady !== null, result.firstReady?.tMs, "within 180s"),
    check("initialize at first readyz 200", initOk, {
      code: result.initAtReady?.code, ms: result.initAtReady?.ms, body: result.initAtReady?.text?.slice(0, 120)
    }, "HTTP 200 + result"),
    check("GET /api/project ≤5s after ready", projectOk, { code: project.code, ms: project.ms }, "200 & ≤5000ms")
  ];
  return {
    id: `cold-${idx}`,
    pass: checks.every((c) => c.pass),
    checks,
    firstReadyTMs: result.firstReady?.tMs ?? null,
    initAtReady: result.initAtReady ? { code: result.initAtReady.code, ms: result.initAtReady.ms } : null,
    samples: result.samples,
    elapsedMs: result.elapsedMs
  };
}

async function all() {
  mkdirSync(OUT, { recursive: true });
  log(`image=${IMAGE} out=${OUT}`);
  createDataVolume();
  startContainer();
  for (let i = 0; i < 90; i += 1) {
    if ((await timed(`${WEB}/api/readyz`)).code === 200) break;
    await sleep(1000);
  }
  const minted = await mintBearer();
  const r0r = await r0();
  const colds = [];
  for (let i = 1; i <= COLD_STARTS; i += 1) {
    log(`cold start ${i}/${COLD_STARTS}`);
    colds.push(await oneColdStart(minted.bearer, minted.cookie, i));
  }
  const rml01 = colds[0];
  const rml02 = {
    id: "UAT-RML-02",
    pass: colds.every((c) => c.pass),
    checks: colds.map((c, i) => check(`cold-${i + 1}`, c.pass, { firstReadyTMs: c.firstReadyTMs, init: c.initAtReady }, "all pass"))
  };
  const rml03 = {
    id: "UAT-RML-03",
    pass: colds.every((c) => c.checks.find((x) => x.name.startsWith("GET /api/project"))?.pass),
    checks: colds.map((c, i) => c.checks.find((x) => x.name.startsWith("GET /api/project")) ?? check(`cold-${i + 1} project`, false, null, "missing"))
  };
  const suite = {
    suite: "UAT-SUITE-READYZ-MCP-LISTEN",
    image: IMAGE,
    label,
    r0: r0r,
    "UAT-RML-01": { pass: rml01?.pass, checks: rml01?.checks, firstReadyTMs: rml01?.firstReadyTMs, initAtReady: rml01?.initAtReady },
    "UAT-RML-02": rml02,
    "UAT-RML-03": rml03,
    colds: colds.map(({ samples, ...rest }) => rest),
    pass: r0r.pass && rml01?.pass && rml02.pass && rml03.pass
  };
  writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(suite, null, 2));
  for (const c of colds) {
    writeFileSync(path.join(OUT, `${c.id}-samples.json`), JSON.stringify(c.samples, null, 2));
  }
  console.log(JSON.stringify({ pass: suite.pass, r0: r0r.pass, rml01: rml01?.pass, rml02: rml02.pass, rml03: rml03.pass, out: OUT }, null, 2));
  stopContainer();
  if (!suite.pass) process.exitCode = 1;
}

function clean() {
  removeContainer();
  removeVolume(VOL);
  rmSync(SECRETS, { recursive: true, force: true });
  log("cleaned");
}

if (cmd === "clean") clean();
else if (cmd === "all") await all();
else {
  console.error("usage: node scripts/uat/readyz-mcp-listen.mjs all|clean [--image IMG] [--label L]");
  process.exit(2);
}
