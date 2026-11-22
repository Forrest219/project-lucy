#!/usr/bin/env node
/**
 * P1-53 Task 5 — thin CLI for Compose / K8s acceptance / upgrade hooks.
 *
 *   node scripts/e2e/mcp-compatibility-hook.mjs plan  [--lane compose|customer|instance|acceptance]
 *   node scripts/e2e/mcp-compatibility-hook.mjs run   [--lane ...] [--rollback-occurred] [--skip-mcp]
 *   node scripts/e2e/mcp-compatibility-hook.mjs release-gate --run-dir <path> [--ci-subset] [--require candidate|instance|both]
 *
 * Does not perform production rollback. Exit: 0 pass/ready, 1 fail, 2 blocked, 3 skipped.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { EXIT_CODES, REPO_ROOT, fail } from "./lib/common.mjs";
import {
  MCP_COMPAT_WIRING_ENV_CONTRACT,
  applyMcpCompatibilityReleaseGate,
  requireRollbackVerifyPlan,
  resolveMcpCompatHookPlan
} from "./lib/mcp-compatibility-wiring.mjs";

function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift();
  const opts = {
    lane: process.env.LUCY_MCP_COMPAT_LANE ?? "compose",
    rollbackOccurred: false,
    skipMcp: false,
    runDir: null,
    ciSubset: false,
    require: "candidate",
    help: false
  };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--help" || a === "-h") opts.help = true;
    else if (a === "--lane") opts.lane = args[++i];
    else if (a === "--rollback-occurred") opts.rollbackOccurred = true;
    else if (a === "--skip-mcp") opts.skipMcp = true;
    else if (a === "--run-dir") opts.runDir = args[++i];
    else if (a === "--ci-subset") opts.ciSubset = true;
    else if (a === "--require") opts.require = args[++i];
    else {
      const err = new Error(`unknown argument ${a}`);
      err.code = "USAGE";
      throw err;
    }
  }
  return { command, opts };
}

const USAGE = `Usage:
  node scripts/e2e/mcp-compatibility-hook.mjs plan|run|release-gate|contract [options]

Commands:
  plan          Print hook decision JSON (skip|block|run); exit per status
  run           Execute plan (spawn run-mcp-compatibility.mjs when READY)
  release-gate  Apply evaluateMcpCompatibilityReleaseGate over runDir evidence
  contract      Print env contract JSON

Options:
  --lane <compose|customer|instance|acceptance>
  --rollback-occurred   Require ROLLBACK_VERIFY path (never auto-rollbacks)
  --skip-mcp            Acceptance skipped MCP handshake → no publishable evidence
  --run-dir <path>      For release-gate
  --ci-subset           Force CI subset (never releaseReady)
  --require <candidate|instance|both>

Env: see LUCY_MCP_COMPAT* / contract command. Default off → SKIPPED.
`;

export async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n${USAGE}`);
    process.exit(EXIT_CODES.blocked);
  }
  const { command, opts } = parsed;
  if (opts.help || !command) {
    process.stdout.write(USAGE);
    process.exit(command ? 0 : EXIT_CODES.blocked);
  }

  if (command === "contract") {
    process.stdout.write(`${JSON.stringify(MCP_COMPAT_WIRING_ENV_CONTRACT, null, 2)}\n`);
    process.exit(0);
  }

  if (command === "plan") {
    const plan = opts.rollbackOccurred
      ? requireRollbackVerifyPlan({
          env: process.env,
          rollbackOccurred: true,
          lane: opts.lane
        })
      : resolveMcpCompatHookPlan({
          env: process.env,
          lane: opts.lane,
          rollbackOccurred: false,
          skipMcp: opts.skipMcp
        });
    process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
    process.exit(plan.exitCode);
  }

  if (command === "run") {
    const plan = opts.rollbackOccurred
      ? requireRollbackVerifyPlan({
          env: process.env,
          rollbackOccurred: true,
          lane: opts.lane
        })
      : resolveMcpCompatHookPlan({
          env: process.env,
          lane: opts.lane,
          rollbackOccurred: false,
          skipMcp: opts.skipMcp
        });
    process.stdout.write(`${JSON.stringify({
      action: plan.action,
      status: plan.status,
      entrypoint: plan.entrypoint ?? null,
      reasons: plan.reasons,
      publishable: plan.publishable ?? false
    }, null, 2)}\n`);
    if (plan.action === "skip") process.exit(EXIT_CODES.skipped);
    if (plan.action === "block") process.exit(EXIT_CODES.blocked);
    const runner = plan.runnerPath ?? path.join(REPO_ROOT, "scripts/e2e/run-mcp-compatibility.mjs");
    const result = spawnSync(process.execPath, [runner, ...plan.argv], {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status == null ? EXIT_CODES.failed : result.status);
  }

  if (command === "release-gate") {
    if (!opts.runDir) {
      fail("release-gate requires --run-dir", EXIT_CODES.blocked);
    }
    const gated = applyMcpCompatibilityReleaseGate({
      runDir: path.resolve(opts.runDir),
      ciSubset: opts.ciSubset,
      require: opts.require
    });
    process.stdout.write(`${JSON.stringify({
      status: gated.status,
      releaseReady: gated.releaseReady,
      exitCode: gated.exitCode,
      mcpCompatibility: gated.mcpCompatibility,
      problemCount: gated.problems?.length ?? 0
    }, null, 2)}\n`);
    process.exit(gated.releaseReady ? EXIT_CODES.passed : gated.exitCode ?? EXIT_CODES.blocked);
  }

  process.stderr.write(`unknown command ${command}\n${USAGE}`);
  process.exit(EXIT_CODES.blocked);
}

const isDirect =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirect) {
  main().catch((error) => fail(error?.stack ?? String(error), EXIT_CODES.failed));
}
