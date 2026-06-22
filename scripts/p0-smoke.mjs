#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const runDocker = args.has("--docker");
const expectedKtxVersion = process.env.LUCY_EXPECTED_KTX_VERSION ?? "0.13.0";
let tempDockerConfig;
let defaultDockerConfig;

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[p0-smoke] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
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
  await run("npm", ["run", "lint:spec"]);
  await run("npm", ["run", "build"], { cwd: "webui" });
  await run("npm", ["test"], { cwd: "webui" });
  await run("bash", ["-n", "scripts/docker-entrypoint.sh", "scripts/docker-healthcheck.sh"]);
  await run("docker", ["compose", "config"], { capture: true });

  const env = {
    LUCY_WEBUI_PORT: "55174",
    LUCY_PROXY_PORT: "57879",
    LUCY_PROXY_UPSTREAM_PORT: "1",
    KTX_INTERNAL_TOKEN: "p0-smoke-local-token"
  };
  console.log("\n[p0-smoke] starting local WebUI smoke server");
  const child = spawn("npm", ["run", "start"], {
    cwd: "webui",
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  try {
    const health = await waitFor("http://127.0.0.1:55174/api/health");
    if (health?.ok !== true) throw new Error("/api/health envelope was not ok");
    const html = await fetch("http://127.0.0.1:55174/");
    if (!html.ok) throw new Error(`/ returned HTTP ${html.status}`);
    const body = await html.text();
    if (!body.includes("<div id=\"root\"></div>")) throw new Error("SPA root element missing");
  } finally {
    child.kill("SIGTERM");
    await once(child, "close").catch(() => undefined);
  }
}

async function dockerSmoke() {
  defaultDockerConfig = process.env.DOCKER_CONFIG;
  const dockerWebPort = process.env.LUCY_DOCKER_SMOKE_WEB_PORT ?? "55175";
  const dockerProxyPort = process.env.LUCY_DOCKER_SMOKE_PROXY_PORT ?? "57880";
  const composeEnv = {
    LUCY_WEBUI_HOST_PORT: dockerWebPort,
    LUCY_PROXY_HOST_PORT: dockerProxyPort
  };
  let buildEnv = {};
  if (!defaultDockerConfig) {
    tempDockerConfig = await mkdtemp(path.join(tmpdir(), "lucy-docker-config-"));
    console.log(`[p0-smoke] using temporary DOCKER_CONFIG=${tempDockerConfig}`);
    buildEnv = { DOCKER_CONFIG: tempDockerConfig };
  }
  await run("docker", ["info"], { capture: true });
  await run("docker", ["build", "--build-arg", `KTX_VERSION=${expectedKtxVersion}`, "-t", "project-lucy:p0-smoke", "."], { env: buildEnv });
  await run("docker", ["compose", "-p", "lucy-p0-smoke", "up", "-d", "--build"], { env: composeEnv });
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
    const version = await run("docker", ["compose", "-p", "lucy-p0-smoke", "exec", "-T", "lucy", "ktx", "--version"], { capture: true, env: composeEnv });
    if (!version.stdout.includes(`@kaelio/ktx ${expectedKtxVersion}`)) {
      throw new Error(`docker ktx --version expected @kaelio/ktx ${expectedKtxVersion}, got ${version.stdout.trim()}`);
    }
    await run("docker", ["compose", "-p", "lucy-p0-smoke", "ps"], { env: composeEnv });
  } finally {
    await run("docker", ["compose", "-p", "lucy-p0-smoke", "down", "-v"], { capture: true, env: composeEnv }).catch((error) => {
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
  process.exit(1);
} finally {
  if (tempDockerConfig) {
    await rm(tempDockerConfig, { recursive: true, force: true }).catch(() => undefined);
  }
}
