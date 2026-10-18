// Disposable PostgreSQL test fixture for the B3 contract.
//
// The integration tests for applySyntheticDbSeed need a real PostgreSQL server.
// This helper:
//
//   1. Reserves a free ephemeral TCP port on 127.0.0.1;
//   2. Allocates a temporary directory holding the per-run owner / reader password
//      files (mode 0600) — these are bind-mounted read-only into the container;
//   3. Starts a `postgres:16-alpine` container with:
//        - a unique random name (`lucy-e2e-db-contract-<random>`),
//        - the labels `lucy.e2e.contract=true` and `lucy.e2e.run=<runSpecificLabel>`,
//        - the reserved port,
//        - the password files mounted read-only,
//        - the password set via POSTGRES_PASSWORD_FILE (not on the command line),
//      so the producer can connect with the per-run owner / reader password;
//   4. Waits for the database to accept queries (one POSTGRES_READY probe);
//   5. Returns a handle the test can pass to applySyntheticDbSeed;
//   6. On `cleanup()`, stops AND removes ONLY the container it started — never
//      any other container, never any pre-existing lucy-e2e-* container.
//
// The handle returns `null` for `containerId` when the host has no Docker, so a
// CI runner without Docker skips the test (and reports so) rather than failing
// with a missing-toolbox error.

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";

const IMAGE = "postgres:16-alpine";
const NAME_PREFIX = "lucy-e2e-db-contract";
const OWNER_NAME = "postgres"; // PG superuser
const READER_NAME = "lucy_e2e_reader_default";

export async function startDisposablePostgres({ dockerBin = "docker", runId = `run-${randomBytes(4).toString("hex")}`, label = "default", baseDir = null } = {}) {
  const dir = baseDir ?? mkTmpDir();
  const ownerPasswordFile = path.join(dir, "owner.password");
  const readerPasswordFile = path.join(dir, "reader.password");
  const ownerPassword = randomBytes(12).toString("hex");
  const readerPassword = randomBytes(12).toString("hex");
  writeFileSync(ownerPasswordFile, ownerPassword, { mode: 0o600 });
  writeFileSync(readerPasswordFile, readerPassword, { mode: 0o600 });

  const containerName = `${NAME_PREFIX}-${randomBytes(4).toString("hex")}`;
  const hostPort = await reserveFreePort();

  const reason = await dockerAvailable(dockerBin);
  if (!reason.ok) return { ok: false, reason: reason.reason, dir, ownerPasswordFile, readerPasswordFile };

  const args = [
    "run", "--rm", "-d",
    "--name", containerName,
    "--label", "lucy.e2e.contract=true",
    "--label", `lucy.e2e.run=${label}`,
    "-p", `127.0.0.1:${hostPort}:5432`,
    "-e", `POSTGRES_USER=${OWNER_NAME}`,
    // The owner password is delivered to the container through a file, not the
    // command line (postgres:16-alpine reads POSTGRES_PASSWORD_FILE).
    "-e", "POSTGRES_PASSWORD_FILE=/run/secrets/owner.password",
    "-v", `${ownerPasswordFile}:/run/secrets/owner.password:ro`,
    "-v", `${readerPasswordFile}:/run/secrets/reader.password:ro`,
    IMAGE
  ];
  const started = await runCommand(dockerBin, args, { capture: true });
  if (started.status !== 0) {
    return { ok: false, reason: `docker run failed (status=${started.status}): ${started.stderr || started.stdout}`, dir, ownerPasswordFile, readerPasswordFile };
  }
  const containerId = started.stdout.trim();

  const ready = await waitForReady(dockerBin, containerName, hostPort, ownerPassword);
  if (!ready.ok) {
    await safeRm(dockerBin, containerId).catch(() => {});
    return { ok: false, reason: ready.reason, dir, ownerPasswordFile, readerPasswordFile, containerId, containerName };
  }

  const handle = {
    ok: true,
    containerId,
    containerName,
    host: "127.0.0.1",
    port: hostPort,
    ownerRole: OWNER_NAME,
    ownerPassword,
    ownerPasswordFile,
    readerRole: READER_NAME,
    readerPassword,
    readerPasswordFile,
    runId,
    dir,
    cleanup: async () => {
      // Stop + remove ONLY this container, then the temporary directory.
      try { await runCommand(dockerBin, ["rm", "-f", containerId], { capture: true }); }
      catch { /* best-effort */ }
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  };
  return handle;
}

function mkTmpDir() {
  const base = process.env.TMPDIR ?? "/tmp";
  const dir = path.join(base, `lucy-pg-fix-${process.pid}-${Date.now()}-${randomBytes(3).toString("hex")}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function dockerAvailable(bin) {
  try {
    const res = await runCommand(bin, ["version", "--format", "{{.Server.Version}}"], { capture: true });
    if (res.status !== 0) return { ok: false, reason: `docker version returned status=${res.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `docker not available: ${error?.message ?? String(error)}` };
  }
}

async function waitForReady(bin, containerName, port, ownerPassword, timeoutMs = 60_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    // Probe via the OWNER password file mounted into the container; we connect
    // with psql so we never put the password on the command line.
    const probe = await runCommand(bin, [
      "exec", "-i", containerName,
      "psql", "-U", OWNER_NAME, "-d", "postgres", "-tAc", "SELECT 1"
    ], {
      capture: true,
      env: { PGPASSWORD_FILE: "/run/secrets/owner.password", PGPASSWORD: ownerPassword }
    }).catch((error) => ({ status: -1, stdout: "", stderr: error?.message ?? String(error) }));
    if (probe.status === 0 && /^\s*1\s*$/.test(probe.stdout)) return { ok: true };
    lastError = `${probe.status} ${probe.stderr || probe.stdout}`;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { ok: false, reason: `postgres:16-alpine did not accept queries within ${timeoutMs}ms (last error: ${lastError ?? "unknown"})` };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        env: options.env ? { ...process.env, ...options.env } : process.env,
        stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ status: code ?? -1, stdout, stderr }));
  });
}

async function safeRm(bin, containerId) {
  try { await runCommand(bin, ["rm", "-f", containerId], { capture: true }); } catch { /* best-effort */ }
}