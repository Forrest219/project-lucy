// Starts the KTX upstream MCP server for ONE run's project.
//
// Why this exists: Lucy's MCP proxy forwards every data-plane call to a KTX
// upstream (`LUCY_PROXY_UPSTREAM_HOST` / `LUCY_PROXY_UPSTREAM_PORT`, default
// 127.0.0.1:7878). A run that declares the `ktx-upstream` capability but has no
// upstream listening produces a data plane that answers every query with an
// empty result — which reads like a product defect and is not one.
//
// So the management leg starts its OWN upstream against the run's own project
// (`ktx --project-dir <project> mcp start --foreground --port <port>`), the same
// way the upgrade leg already does, and only reports the capability as present
// when the port really answers.
//
// The upstream inherits the run's instance env (KTX_PROJECT_ROOT /
// LUCY_CONTENT_ROOT / LUCY_DB_*), so it reads the run's own semantic layer and
// connects to the run's own disposable database. Nothing is shared between runs.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { portOpen } from "./instance.mjs";

/** Reserves a free ephemeral TCP port on the loopback interface. */
export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts the upstream and waits until it actually accepts connections.
 *
 * @param {object} run the prepared run (run.json)
 * @param {{ktxBin?: string, timeoutMs?: number, env?: Record<string, string>}} [options]
 * @returns {Promise<{ok: true, host: string, port: number, stop: () => Promise<void>} | {ok: false, reason: string}>}
 */
export async function startKtxUpstream(run, { ktxBin = "ktx", timeoutMs = 30_000, env = {} } = {}) {
  const host = process.env.LUCY_PROXY_UPSTREAM_HOST ?? "127.0.0.1";
  let port = 0;
  try {
    port = await freePort();
  } catch (error) {
    return { ok: false, reason: `no free port for the KTX upstream: ${error instanceof Error ? error.message : String(error)}` };
  }

  const childEnv = { ...process.env, ...run.instance.env, ...env };
  const logPath = path.join(run.paths.logs, "ktx-upstream.log");
  const log = createWriteStream(logPath, { flags: "a" });
  let child;
  try {
    child = spawn(ktxBin, ["--project-dir", run.paths.project, "mcp", "start", "--foreground", "--port", String(port)], {
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
      detached: true
    });
  } catch (error) {
    log.end();
    return { ok: false, reason: `the KTX upstream binary "${ktxBin}" could not be started: ${error instanceof Error ? error.message : String(error)}` };
  }
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });

  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const deadline = Date.now() + timeoutMs;
  let up = false;
  while (Date.now() < deadline) {
    if (await portOpen(host, port, 500)) {
      up = true;
      break;
    }
    const raced = await Promise.race([exited, new Promise((resolve) => setTimeout(() => resolve(null), 300))]);
    if (raced) break; // the upstream already died
  }
  if (!up) {
    await stopKtxUpstream(child);
    log.end();
    return { ok: false, reason: `the KTX upstream did not answer on ${host}:${port} within ${timeoutMs}ms (see ${logPath})` };
  }

  const stop = async () => {
    await stopKtxUpstream(child);
    log.end();
  };
  return { ok: true, host, port, stop, logPath };
}

/** Terminates the upstream's own process group so no orphan keeps the port. */
async function stopKtxUpstream(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already gone
    }
  }
  await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(undefined))),
    new Promise((resolve) => setTimeout(() => resolve(undefined), 5_000))
  ]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    // the group is gone
  }
}
