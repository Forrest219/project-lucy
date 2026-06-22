#!/usr/bin/env node
import { spawn } from "node:child_process";

const DEFAULT_BASELINE = "0.13.0";

function parseArgs(argv) {
  const options = {
    baseline: process.env.LUCY_BASELINE_KTX_VERSION ?? DEFAULT_BASELINE,
    candidate: process.env.LUCY_CANDIDATE_KTX_VERSION ?? process.env.KTX_VERSION ?? DEFAULT_BASELINE,
    skipDocker: false,
    skipDemo: false,
    skipBusinessEval: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--baseline") options.baseline = argv[++i];
    else if (arg === "--candidate") options.candidate = argv[++i];
    else if (arg === "--skip-docker") options.skipDocker = true;
    else if (arg === "--skip-demo") options.skipDemo = true;
    else if (arg === "--skip-business-eval") options.skipBusinessEval = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/ktx-upgrade-compat.mjs [options]

Options:
  --baseline <version>          Current supported KTX version. Default: ${DEFAULT_BASELINE}
  --candidate <version>         Candidate bundled KTX npm version. Default: env KTX_VERSION or ${DEFAULT_BASELINE}
  --skip-docker                 Skip Docker image smoke.
  --skip-demo                   Skip demo DB E2E smoke.
  --skip-business-eval          Skip business eval catalog smoke.

The script does not edit source files. It injects KTX_VERSION and
LUCY_EXPECTED_KTX_VERSION into existing smoke gates.
`);
}

function safeId(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 48);
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const label = [command, ...commandArgs].join(" ");
    console.log(`\n[ktx-upgrade-compat] $ ${label}`);
    const child = spawn(command, commandArgs, {
      cwd: options.cwd ?? process.cwd(),
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const candidateEnv = {
    KTX_VERSION: options.candidate,
    LUCY_EXPECTED_KTX_VERSION: options.candidate,
    LUCY_DEMO_COMPOSE_PROJECT: `lucy-ktx-compat-${safeId(options.candidate)}`
  };

  console.log(`[ktx-upgrade-compat] baseline KTX: ${options.baseline}`);
  console.log(`[ktx-upgrade-compat] candidate KTX: ${options.candidate}`);
  if (options.baseline === options.candidate) {
    console.log("[ktx-upgrade-compat] candidate equals baseline; running compatibility baseline check");
  }

  if (!options.skipDocker) {
    await run("npm", ["run", "smoke:p0:docker"], { env: candidateEnv });
  }
  if (!options.skipDemo) {
    await run("npm", ["run", "smoke:p0:demo"], { env: candidateEnv });
  }
  if (!options.skipBusinessEval) {
    await run("npm", ["run", "smoke:p0:business-eval"], { env: candidateEnv });
  }

  console.log("\n[ktx-upgrade-compat] PASS");
}

main().catch((error) => {
  console.error(`\n[ktx-upgrade-compat] FAIL: ${error.message}`);
  process.exit(1);
});
