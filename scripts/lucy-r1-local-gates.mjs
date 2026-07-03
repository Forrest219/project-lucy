#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const listOnly = args.has("--list");
const dryRun = args.has("--dry-run");
const help = args.has("--help") || args.has("-h");

const GATES = [
  {
    id: "r1-readiness",
    description: "Lucy R1 static readiness and non-strict external-evidence placeholder check",
    command: "npm",
    args: ["run", "r1:readiness"]
  },
  {
    id: "spec-lint",
    description: "Spec, route, eval schema, and access-policy lint",
    command: "npm",
    args: ["run", "lint:spec"]
  },
  {
    id: "security-baseline",
    description: "Access config, proxy security hooks, and secret-exclusion baseline",
    command: "npm",
    args: ["run", "security:baseline"]
  },
  {
    id: "r1-mcp-contract-test",
    description: "Lucy R1 MCP contract smoke generator tests",
    command: "npm",
    args: ["run", "r1:mcp-contract:test"]
  },
  {
    id: "r1-doris-smoke-test",
    description: "Doris evidence generator tests",
    command: "npm",
    args: ["run", "r1:doris-smoke:test"]
  },
  {
    id: "r1-hermes-report-test",
    description: "Hermes accuracy report compiler tests",
    command: "npm",
    args: ["run", "r1:hermes-report:test"]
  },
  {
    id: "r1-readiness-test",
    description: "Strict readiness evidence validator tests",
    command: "npm",
    args: ["run", "r1:readiness:test"]
  },
  {
    id: "r1-release-bundle-test",
    description: "Release bundle validator tests",
    command: "npm",
    args: ["run", "r1:release-bundle:test"]
  },
  {
    id: "r1-status-test",
    description: "R1 readiness status summarizer tests",
    command: "npm",
    args: ["run", "r1:status:test"]
  },
  {
    id: "webui-test",
    description: "WebUI server/client test suite",
    command: "npm",
    args: ["test"],
    cwd: "webui"
  },
  {
    id: "webui-build",
    description: "WebUI production build",
    command: "npm",
    args: ["run", "build"],
    cwd: "webui"
  }
];

const USAGE = `Usage:
  npm run r1:local-gates
  npm run r1:local-gates -- --dry-run
  npm run r1:local-gates -- --list

Runs the local, non-external Lucy R1 release gates from docs/lucy-r1-release-runbook.md.
It does not replace strict runtime evidence for MCP, Doris, or Hermes benchmark reports.`;

function label(gate) {
  const prefix = gate.cwd ? `(cd ${gate.cwd} && ` : "";
  const suffix = gate.cwd ? ")" : "";
  return `${prefix}${[gate.command, ...gate.args].join(" ")}${suffix}`;
}

function runGate(gate) {
  return new Promise((resolve, reject) => {
    console.log(`\n[r1-local-gates] ${gate.id}: ${gate.description}`);
    console.log(`[r1-local-gates] $ ${label(gate)}`);
    const child = spawn(gate.command, gate.args, {
      cwd: gate.cwd ?? process.cwd(),
      env: process.env,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${gate.id} failed with exit code ${code}`));
    });
  });
}

if (help) {
  console.log(USAGE);
  process.exit(0);
}

if (listOnly) {
  console.log(JSON.stringify({
    count: GATES.length,
    gates: GATES.map((gate) => ({
      id: gate.id,
      description: gate.description,
      cwd: gate.cwd,
      command: label(gate)
    }))
  }, null, 2));
  process.exit(0);
}

try {
  for (const gate of GATES) {
    if (dryRun) {
      console.log(`[r1-local-gates] DRY-RUN ${gate.id}: ${label(gate)}`);
    } else {
      await runGate(gate);
    }
  }
  console.log(`\n[r1-local-gates] PASS ${dryRun ? "(dry run) " : ""}${GATES.length} local gate(s)`);
} catch (error) {
  console.error(`\n[r1-local-gates] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
