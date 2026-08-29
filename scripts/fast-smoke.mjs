#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const skipUi = args.has("--skip-ui");

function valueAfter(flag) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const outArg = valueAfter("--out") ?? "inbox/fast-smoke-evidence.json";
const startedAt = Date.now();

if (help) {
  console.log(`Usage:
  node scripts/fast-smoke.mjs
  node scripts/fast-smoke.mjs --out inbox/fast-smoke-evidence.json
  node scripts/fast-smoke.mjs --skip-ui

Fast Smoke (Tier 0 / L1 Gate) execution for Project Lucy.
Checks static governance, metadata, L1 UI contracts, and in-memory MCP handshake.`);
  process.exit(0);
}

const evidence = {
  contract: "lucy-fast-smoke-v2",
  version: "2.0.0",
  generatedBy: "scripts/fast-smoke.mjs",
  checkedAt: new Date().toISOString(),
  durationMs: 0,
  status: "passed",
  phases: {},
  blockers: []
};

function runCommand(cmd, cmdArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = `${cmd} ${cmdArgs.join(" ")}`;
    console.log(`\n[fast-smoke] > ${label}`);
    const child = spawn(cmd, cmdArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (d) => { stdout += d.toString(); });
    if (child.stderr) child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const err = new Error(`${label} failed with exit code ${code}`);
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

async function waitFor(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, options.fetchOptions ?? {});
      if (res.ok) return await res.json();
      lastError = new Error(`${url} returned HTTP ${res.status}`);
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw lastError ?? new Error(`Timed out waiting for ${url}`);
}

async function main() {
  console.log("================================================================================");
  console.log("              Lucy Fast Smoke (Tier 0 / L1) Gate Runner                         ");
  console.log("================================================================================");

  // Phase 1: Static Governance & Security Baseline
  try {
    console.log("\n--- Phase 1: Static Governance & Security Baseline ---");
    await runCommand("npm", ["run", "lint:spec"]);
    await runCommand("npm", ["run", "lint:terminology"]);
    await runCommand("npm", ["run", "lint:ia-boundary"]);
    await runCommand("npm", ["run", "security:baseline"]);
    await runCommand("npm", ["run", "smoke:p0:delivery-isolation"]);
    evidence.phases.static_governance = { status: "passed" };
  } catch (err) {
    evidence.phases.static_governance = { status: "failed", error: err.message };
    evidence.blockers.push({ phase: "static_governance", error: err.message });
    throw err;
  }

  // Phase 2: Metadata & Config Checks
  try {
    console.log("\n--- Phase 2: Metadata, Skills & License Baseline ---");
    await runCommand("node", ["scripts/p1-skills-smoke.mjs"]);
    await runCommand("node", ["scripts/headless-config-smoke.mjs"]);
    await runCommand("node", ["scripts/verify-license-baseline.mjs"]);
    evidence.phases.metadata_contracts = { status: "passed" };
  } catch (err) {
    evidence.phases.metadata_contracts = { status: "failed", error: err.message };
    evidence.blockers.push({ phase: "metadata_contracts", error: err.message });
    throw err;
  }

  // Phase 3: WebUI L1 E2E Smoke (Playwright Headless)
  if (!skipUi) {
    try {
      console.log("\n--- Phase 3: WebUI L1 E2E Smoke (Playwright) ---");
      await runCommand("npm", ["--prefix", "webui", "run", "e2e:smoke"]);
      evidence.phases.webui_contracts = { status: "passed" };
    } catch (err) {
      evidence.phases.webui_contracts = { status: "failed", error: err.message };
      evidence.blockers.push({ phase: "webui_contracts", error: err.message });
      throw err;
    }
  } else {
    console.log("\n--- Phase 3: WebUI L1 E2E Smoke (Skipped by --skip-ui) ---");
    evidence.phases.webui_contracts = { status: "skipped" };
  }

  // Phase 4: Light In-Process Handshake & MCP Probe
  try {
    console.log("\n--- Phase 4: In-Process Service Handshake & MCP Probe ---");
    const testWebPort = "55174";
    const testProxyPort = "57879";
    const env = {
      LUCY_WEBUI_PORT: testWebPort,
      LUCY_PROXY_PORT: testProxyPort,
      LUCY_PROXY_UPSTREAM_PORT: "1",
      KTX_INTERNAL_TOKEN: "fast-smoke-token"
    };

    const serverProc = spawn("npm", ["run", "start"], {
      cwd: "webui",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"]
    });

    try {
      const health = await waitFor(`http://127.0.0.1:${testWebPort}/api/health`, { timeoutMs: 15_000 });
      if (health?.ok !== true) throw new Error("/api/health did not return ok: true");

      const mcpInitRes = await fetch(`http://127.0.0.1:${testProxyPort}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "fast-smoke-init",
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "fast-smoke-client", version: "1.0.0" }
          }
        })
      });
      if (mcpInitRes.status !== 200 && mcpInitRes.status !== 401) {
        // 401 is allowed if auth token required, but endpoint must exist
        throw new Error(`MCP initialize returned unexpected status ${mcpInitRes.status}`);
      }

      evidence.phases.process_handshake = {
        status: "passed",
        healthEnvelope: health.ok,
        mcpStatus: mcpInitRes.status
      };
    } finally {
      serverProc.kill("SIGTERM");
      await once(serverProc, "close").catch(() => undefined);
    }
  } catch (err) {
    evidence.phases.process_handshake = { status: "failed", error: err.message };
    evidence.blockers.push({ phase: "process_handshake", error: err.message });
    throw err;
  }
}

try {
  await main();
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  console.error(`\n[fast-smoke] FAIL: ${error.message}`);
} finally {
  evidence.durationMs = Date.now() - startedAt;
  const outPath = path.resolve(process.cwd(), outArg);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\n[fast-smoke] ${evidence.status.toUpperCase()}: evidence written to ${outPath} (${evidence.durationMs}ms)`);
  process.exit(evidence.status === "passed" ? 0 : 1);
}
