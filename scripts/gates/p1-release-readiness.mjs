#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const listOnly = args.has("--list");
const dryRun = args.has("--dry-run");
const fullMode = args.has("--full");
const includeP0 = args.has("--include-p0") || fullMode;
const allowBlocked = args.has("--allow-blocked");
const outArg = valueAfter("--out") ?? "inbox/p1-release-readiness-evidence.json";

const P0_GATES = [
  ["lint-spec", ["run", "lint:spec"]],
  ["security-baseline", ["run", "security:baseline"]],
  ["delivery-isolation", ["run", "smoke:p0:delivery-isolation"]],
  ["docker-smoke", ["run", "smoke:p0:docker"]],
  // These run database/demo smoke scripts, not the real-user E2E; the names say so (Spec 20261018 §8.3).
  ["demo-db-smoke", ["run", "smoke:p0:demo"]],
  ["postgres-demo-db-smoke", ["run", "smoke:p0:postgres-demo"]],
  ["executive-poc-db-smoke", ["run", "smoke:p0:executive-poc"]]
];

const P1_GATES = [
  ["context", ["run", "smoke:p1:context"]],
  ["skills", ["run", "smoke:p1:skills"]],
  ["endpoint", ["run", "smoke:p1:endpoint"]],
  ["governance", ["run", "smoke:p1:governance"]],
  ["publish-regression", ["run", "smoke:p1:publish-regression"]],
  ["observability", ["run", "smoke:p1:observability"]],
  ["agent-e2e", ["run", "e2e:agent"], { kind: "e2e", runtime: "configured real agent commands" }],
  ["business-eval-full", ["run", "smoke:p1:business-eval-full"]],
  ["starrocks-certification", ["run", "smoke:p1:starrocks-certification"]]
];

const USAGE = `Usage:
  npm run smoke:full
  npm run smoke:p1:release-readiness
  npm run smoke:p1:release-readiness -- --full
  npm run smoke:p1:release-readiness -- --include-p0
  npm run smoke:p1:release-readiness -- --allow-blocked
  npm run smoke:p1:release-readiness -- --dry-run
  npm run smoke:p1:release-readiness -- --list

Aggregates P1上线达标 and Full Smoke gates and writes evidence JSON.

Exit codes (Spec §8.2): 0 passed, 1 failed, 2 blocked, 3 dry_run / collect-only (--dry-run, --allow-blocked
with blocked gates). --list exits 0 and prints the gate list as JSON without writing evidence.
Gate status comes from each child's exit code only (0 passed, 2 or legacy 42 blocked, 3 skipped, else failed);
stdout wording is never used. This aggregate never sets releaseReady: that verdict belongs to the T13 verifier.
`;

function valueAfter(flag) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function redact(text) {
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer [REDACTED]")
    .replace(/(token|password|secret|api[_-]?key)=([^\s]+)/gi, "$1=[REDACTED]");
}

// Exit-code contract only (Spec §8.2). 42 is the legacy "blocked" code still used by p1-business-eval-full.
function classifyExitCode(code) {
  if (code === 0) return "passed";
  if (code === 2 || code === 42) return "blocked";
  if (code === 3) return "skipped";
  return "failed";
}

function runGate(id, npmArgs, metadata = {}) {
  return new Promise((resolve) => {
    const label = `npm ${npmArgs.join(" ")}`;
    console.log(`\n[p1-release-readiness] ${id}: ${label}`);
    if (dryRun) {
      resolve({ id, command: label, ...metadata, status: "dry_run", exitCode: null, stdout: "", stderr: "" });
      return;
    }
    const child = spawn("npm", npmArgs, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      resolve({ id, command: label, ...metadata, status: "failed", exitCode: -1, stdout: "", stderr: message });
    });
    child.on("close", (code) => {
      const exitCode = code ?? -1;
      resolve({
        id,
        command: label,
        ...metadata,
        status: classifyExitCode(exitCode),
        exitCode,
        stdout: redact(stdout),
        stderr: redact(stderr)
      });
    });
  });
}

async function main() {
  if (help) {
    console.log(USAGE);
    process.exit(0);
  }
  const gates = includeP0 ? [...P0_GATES, ...P1_GATES] : P1_GATES;
  if (listOnly) {
    console.log(JSON.stringify({
      contract: "lucy-p1-release-readiness-v2",
      mode: "list",
      includeP0,
      gates: gates.map(([id, npmArgs, metadata]) => ({ id, command: `npm ${npmArgs.join(" ")}`, ...metadata }))
    }, null, 2));
    process.exit(0);
  }

  const results = [];
  for (const [id, npmArgs, metadata] of gates) {
    results.push(await runGate(id, npmArgs, metadata));
  }

  const passed = results.filter((item) => item.status === "passed").length;
  const blocked = results.filter((item) => item.status === "blocked").length;
  const failed = results.filter((item) => item.status === "failed").length;
  const dryRuns = results.filter((item) => item.status === "dry_run").length;
  const skipped = results.filter((item) => item.status === "skipped").length;

  // Spec §8.2: failed > blocked > dry_run/collect/skipped > passed. --allow-blocked only downgrades blocked
  // to collect-only (exit 3); it can never produce a publishable 0.
  let overall = "passed";
  if (failed > 0) overall = "failed";
  else if (blocked > 0) overall = allowBlocked ? "collect" : "blocked";
  else if (dryRuns > 0) overall = "dry_run";
  else if (skipped > 0) overall = "collect";
  const exitCode = { passed: 0, failed: 1, blocked: 2, dry_run: 3, collect: 3 }[overall];

  const evidence = {
    contract: "lucy-p1-release-readiness-v2",
    version: "2.0.0",
    checkedAt: new Date().toISOString(),
    status: overall,
    exitCode,
    releaseReady: false,
    // The customer release verdict belongs to scripts/e2e/verify-evidence.mjs; this aggregate only records gates.
    verdictOwner: "scripts/e2e/verify-evidence.mjs",
    dryRun,
    allowBlocked,
    includeP0,
    fullMode,
    summary: { total: results.length, passed, blocked, failed, dryRun: dryRuns, skipped },
    gates: results.map(({ id, command, status, exitCode, stdout, stderr, ...meta }) => ({
      id,
      command,
      status,
      exitCode,
      ...meta,
      outputSnippet: (stdout + "\n" + stderr).trim().slice(-600)
    }))
  };

  const outPath = path.resolve(process.cwd(), outArg);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(`\n[p1-release-readiness] status=${overall} (${passed}/${results.length} passed, ${blocked} blocked, ${failed} failed, ${dryRuns} dry-run)`);
  console.log(`[p1-release-readiness] wrote ${outPath}`);

  process.exit(exitCode);
}

await main();
