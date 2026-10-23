#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const runDocker = args.has("--docker");
const expectedKtxVersion = process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.16.0";
let tempDockerConfig;
let defaultDockerConfig;

// Process groups spawned with `detached: true` survive a Ctrl-C aimed at the
// foreground group, so we track them and kill them on signal.
const detachedGroups = new Set();

function trackGroup(child) {
  if (child.pid) detachedGroups.add(child.pid);
  child.once("close", () => {
    if (child.pid) detachedGroups.delete(child.pid);
  });
}

function killTrackedGroups() {
  for (const pid of detachedGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* group already gone */
    }
  }
  detachedGroups.clear();
}

process.on("SIGINT", () => {
  killTrackedGroups();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killTrackedGroups();
  process.exit(143);
});

// Terminate a child AND the process group it leads. `npm run ...` spawns a
// grandchild chain (npm -> sh -> tsx -> node): a signal sent to npm alone is
// not forwarded, the grandchild keeps the inherited stdout pipe open, and
// Node therefore never emits 'close'. Killing the group is the only reliable
// teardown, and it must be bounded so the gate fails with a diagnosis.
async function terminateGroup(child, graceMs = 5_000) {
  try {
    child.kill("SIGTERM");
  } catch {
    /* already gone */
  }
  await Promise.race([
    once(child, "close").catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, graceMs))
  ]);
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    try {
      process.kill(-child.pid, signal);
    } catch {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
}

function run(command, commandArgs, options = {}) {
  const timeoutMs = options.timeoutMs ?? 0;
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-smoke] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      // A bounded command must be killable as a whole; see terminateGroup().
      detached: timeoutMs > 0
    });
    if (timeoutMs > 0) trackGroup(child);
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;
    let settled = false;
    const finish = (apply) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      apply();
    };
    const timeoutError = () => {
      const error = new Error(`${label} exceeded its ${timeoutMs} ms limit and was terminated`);
      error.stdout = stdout;
      error.stderr = stderr;
      error.timedOut = true;
      return error;
    };
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => {
      // While a timeout teardown is in flight the timer callback owns the
      // settlement. Settling here would reject the promise early, and the
      // top-level handler reacts by calling process.exit() - which would tear
      // the script down before terminateGroup() had a chance to kill the
      // process group, leaving the grandchildren behind.
      if (timedOut) return;
      finish(() => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const error = new Error(`${label} failed with exit code ${code}`);
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
      });
    });
    if (timeoutMs > 0) {
      timer = setTimeout(async () => {
        timedOut = true;
        await terminateGroup(child);
        finish(() => reject(timeoutError()));
      }, timeoutMs);
    }
  });
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return await res.json();
}

async function fetchMcpStatus(url) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "p0-smoke", method: "tools/list" })
  });
  if (res.status === 404) throw new Error(`${url} returned HTTP 404`);
  return res.status;
}

async function waitFor(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      return await fetchJson(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function localSmoke() {
  await run("npm", ["run", "lint:spec"], { timeoutMs: 10 * 60_000 });
  await run("npm", ["run", "smoke:p0:delivery-isolation"], { timeoutMs: 10 * 60_000 });
  await run("npm", ["run", "build"], { cwd: "webui", timeoutMs: 15 * 60_000 });
  await run("npm", ["test"], { cwd: "webui", timeoutMs: 25 * 60_000 });
  await run("bash", ["-n", "scripts/runtime/docker-entrypoint.sh", "scripts/runtime/docker-healthcheck.sh"], { timeoutMs: 2 * 60_000 });
  await run("npm", ["run", "smoke:p0:docker-entrypoint:test"], { timeoutMs: 10 * 60_000 });
  await run("npm", ["run", "smoke:p0:docker-healthcheck:test"], { timeoutMs: 10 * 60_000 });
  await run("npm", ["run", "smoke:p0:access-template:test"], { timeoutMs: 10 * 60_000 });
  await run("docker", ["compose", "config"], { capture: true, timeoutMs: 5 * 60_000 });

  const env = {
    LUCY_WEBUI_PORT: "55174",
    LUCY_PROXY_PORT: "57879",
    LUCY_PROXY_UPSTREAM_PORT: "1",
    KTX_INTERNAL_TOKEN: "p0-smoke-local-token"
  };
  console.log("\n[p0-smoke] starting local WebUI smoke server");
  // `npm run start` runs the WebUI server as a GRANDCHILD chain
  // (npm -> sh -> tsx -> node). Two consequences, both observed on CI:
  //   1. SIGTERM to npm alone is not forwarded, so the server keeps running.
  //   2. The server inherits this process's stdout/stderr pipes, and Node
  //      emits 'close' only after those streams are closed - so awaiting
  //      'close' waited forever and the gate hung until the job timeout.
  // Give the child its own process group, hand it the parent's stdio directly
  // (no pipe to keep open), and always terminate the whole group.
  const child = spawn("npm", ["run", "start"], {
    cwd: "webui",
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true
  });
  trackGroup(child);
  try {
    const health = await waitFor("http://127.0.0.1:55174/api/health");
    if (health?.ok !== true) throw new Error("/api/health envelope was not ok");
    const html = await fetch("http://127.0.0.1:55174/");
    if (!html.ok) throw new Error(`/ returned HTTP ${html.status}`);
    const body = await html.text();
    if (!body.includes("<div id=\"root\"></div>")) throw new Error("SPA root element missing");
  } finally {
    await terminateGroup(child);
  }
}

async function dockerSmoke() {
  defaultDockerConfig = process.env.DOCKER_CONFIG;
  const dockerWebPort = process.env.LUCY_DOCKER_SMOKE_WEB_PORT ?? "55175";
  const dockerProxyPort = process.env.LUCY_DOCKER_SMOKE_PROXY_PORT ?? "57880";
  const hostArch = process.arch === "arm64" ? "arm64" : "amd64";
  const targetPlatform = process.env.TARGETPLATFORM ?? `linux/${hostArch}`;
  const targetArch = process.env.TARGETARCH ?? hostArch;
  const composeEnv = {
    LUCY_WEBUI_HOST_PORT: dockerWebPort,
    LUCY_PROXY_HOST_PORT: dockerProxyPort,
    LUCY_ALLOW_PLACEHOLDER_KTX: "1",
    TARGETPLATFORM: targetPlatform,
    TARGETARCH: targetArch,
    KTX_VERSION: expectedKtxVersion,
    LUCY_EXPECTED_KTX_VERSION: expectedKtxVersion
  };
  let buildEnv = {
    TARGETPLATFORM: targetPlatform,
    TARGETARCH: targetArch
  };
  if (!defaultDockerConfig) {
    tempDockerConfig = await mkdtemp(path.join(tmpdir(), "lucy-docker-config-"));
    console.log(`[p0-smoke] using temporary DOCKER_CONFIG=${tempDockerConfig}`);
    buildEnv = { ...buildEnv, DOCKER_CONFIG: tempDockerConfig };
  }
  await run("docker", ["info"], { capture: true, timeoutMs: 5 * 60_000 });
  await run("docker", [
    "build",
    "--build-arg", `KTX_VERSION=${expectedKtxVersion}`,
    "--build-arg", `TARGETPLATFORM=${targetPlatform}`,
    "--build-arg", `TARGETARCH=${targetArch}`,
    "-t", "project-lucy:p0-smoke",
    "."
  ], { env: buildEnv, timeoutMs: 20 * 60_000 });
  await run("docker", ["compose", "-p", "lucy-p0-smoke", "up", "-d", "--build"], { env: composeEnv, timeoutMs: 18 * 60_000 });
  await run("npm", [
    "run",
    "smoke:p0:delivery-isolation",
    "--",
    "--check-images",
    "--image",
    "project-lucy:p0-smoke",
    "--image",
    "project-lucy:local"
  ], { timeoutMs: 10 * 60_000 });
  try {
    const health = await waitFor(`http://127.0.0.1:${dockerWebPort}/api/health`, { timeoutMs: 120_000 });
    if (health?.ok !== true) throw new Error("docker /api/health envelope was not ok");
    if (health?.data?.bundledKtxVersion !== expectedKtxVersion) {
      throw new Error(`docker /api/health bundledKtxVersion expected ${expectedKtxVersion}, got ${health?.data?.bundledKtxVersion}`);
    }
    const proxyStatus = await fetchMcpStatus(`http://127.0.0.1:${dockerProxyPort}/mcp`);
    if (![200, 400, 401, 403].includes(proxyStatus)) {
      throw new Error(`docker MCP proxy returned unexpected HTTP ${proxyStatus}`);
    }
    const version = await run("docker", ["compose", "-p", "lucy-p0-smoke", "exec", "-T", "lucy", "ktx", "--version"], { capture: true, env: composeEnv, timeoutMs: 5 * 60_000 });
    if (!version.stdout.includes(`@kaelio/ktx ${expectedKtxVersion}`)) {
      throw new Error(`docker ktx --version expected @kaelio/ktx ${expectedKtxVersion}, got ${version.stdout.trim()}`);
    }
    await run("bash", ["scripts/release/assert-image-elf-arch.sh", "project-lucy:local", targetArch], { env: composeEnv, timeoutMs: 5 * 60_000 });
    await run("docker", ["compose", "-p", "lucy-p0-smoke", "ps"], { env: composeEnv, timeoutMs: 5 * 60_000 });
  } finally {
    await run("docker", ["compose", "-p", "lucy-p0-smoke", "down", "-v"], { capture: true, env: composeEnv, timeoutMs: 10 * 60_000 }).catch((error) => {
      console.error(error.message);
    });
  }
}

try {
  await localSmoke();
  if (runDocker) await dockerSmoke();
  console.log("\n[p0-smoke] PASS");
} catch (error) {
  console.error(`\n[p0-smoke] FAIL: ${error.message}`);
  if (error.stderr) console.error(error.stderr);
  // Leave nothing behind: a failing gate must not leak the process groups it
  // started, even if the failure happened outside a bounded teardown.
  killTrackedGroups();
  process.exit(1);
} finally {
  if (tempDockerConfig) {
    await rm(tempDockerConfig, { recursive: true, force: true }).catch(() => undefined);
  }
}
