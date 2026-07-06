#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_TRACE_BASE_URL = "http://127.0.0.1:5174/api/observability/logs?traceId={traceId}";

function run(command, args, env = process.env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env,
      stdio: "inherit"
    });
    child.on("error", (error) => {
      console.error(`[sow-trust-e2e-standard] failed to start ${command}: ${error.message}`);
      resolveRun(2);
    });
    child.on("close", (code) => resolveRun(code ?? 1));
  });
}

async function main() {
  const env = {
    ...process.env,
    LUCY_E2E_TRACE_BASE_URL: process.env.LUCY_E2E_TRACE_BASE_URL || DEFAULT_TRACE_BASE_URL
  };

  const e2eCode = await run(process.execPath, ["scripts/p1-agent-e2e-local-hermes.mjs", "--replace-existing"], env);
  if (e2eCode !== 0) process.exit(e2eCode);

  const packageCode = await run(process.execPath, ["scripts/package-sow-trust-evidence.mjs", "--strict"], env);
  process.exit(packageCode);
}

main();
