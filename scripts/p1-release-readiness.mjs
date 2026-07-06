#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const args = new Set(process.argv.slice(2));
const help = args.has("--help") || args.has("-h");
const listOnly = args.has("--list");
const dryRun = args.has("--dry-run");
const includeP0 = args.has("--include-p0");
const allowBlocked = args.has("--allow-blocked");
const outArg = valueAfter("--out") ?? "inbox/p1-release-readiness-evidence.json";

const P0_GATES = [
  ["lint-spec", ["run", "lint:spec"]],
  ["security-baseline", ["run", "security:baseline"]],
  ["docker-smoke", ["run", "smoke:p0:docker"]],
  ["demo-e2e", ["run", "smoke:p0:demo"]],
  ["postgres-demo-e2e", ["run", "smoke:p0:postgres-demo"]]
];

const P1_GATES = [
  ["context", ["run", "smoke:p1:context"]],
  ["skills", ["run", "smoke:p1:skills"]],
  ["endpoint", ["run", "smoke:p1:endpoint"]],
  ["observability", ["run", "smoke:p1:observability"]],
  ["agent-e2e", ["run", "e2e:agent"], { kind: "e2e", runtime: "configured real agent commands" }],
  ["business-eval-full", ["run", "smoke:p1:business-eval-full"]],
  ["starrocks-certification", ["run", "smoke:p1:starrocks-certification"]]
];

const USAGE = `Usage:
  npm run smoke:p1:release-readiness
  npm run smoke:p1:release-readiness -- --include-p0
  npm run smoke:p1:release-readiness -- --allow-blocked
  npm run smoke:p1:release-readiness -- --dry-run
  npm run smoke:p1:release-readiness -- --list

Aggregates P1上线达标 gates and writes evidence JSON.
The agent-e2e gate is intentionally wired to npm run e2e:agent. Smoke/unit tests are not
accepted as a substitute for real agent runtime validation.
Exit behavior:
  - failed gates always fail the run.
  - blocked gates fail unless --allow-blocked is supplied.
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

function classifyOutput(code, stdout, stderr) {
  const combined = `${stdout}\n${stderr}`;
  if (code === 0) return "passed";
  if (/\bblocked\b|precheck|missing|required env|not configured|unavailable/i.test(combined)) return "blocked";
  return "failed";
}

function runGate(id, npmArgs, metadata = {}) {
  return new Promise((resolve) => {
    const label = `npm ${npmArgs.join(" ")}`;
    console.log(`\n[p1-release-readiness] ${id}: ${label}`);
    if (dryRun) {
      resolve({ id, command: label, ...metadata, status: "dry-run", exitCode: 0, stdout: "", stderr: "" });
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
        status: classifyOutput(exitCode, stdout, stderr),
        exitCode,
        stdout: redact(stdout).slice(-4000),
        stderr: redact(stderr).slice(-4000)
      });
    });
  });
}

async function writeEvidence(evidence) {
  const outPath = path.resolve(process.cwd(), outArg);
  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`[p1-release-readiness] wrote ${path.relative(process.cwd(), outPath)}`);
}

if (help) {
  console.log(USAGE);
  process.exit(0);
}

const gates = [...(includeP0 ? P0_GATES : []), ...P1_GATES];

if (listOnly) {
  console.log(JSON.stringify({
    includeP0,
    allowBlocked,
    count: gates.length,
    gates: gates.map(([id, npmArgs, metadata = {}]) => ({ id, command: `npm ${npmArgs.join(" ")}`, ...metadata }))
  }, null, 2));
  process.exit(0);
}

const startedAt = new Date().toISOString();
const results = [];
for (const [id, npmArgs, metadata = {}] of gates) {
  results.push(await runGate(id, npmArgs, metadata));
}

const summary = {
  total: results.length,
  passed: results.filter((item) => item.status === "passed").length,
  blocked: results.filter((item) => item.status === "blocked").length,
  failed: results.filter((item) => item.status === "failed").length,
  dryRun: results.filter((item) => item.status === "dry-run").length
};

const evidence = {
  generatedAt: new Date().toISOString(),
  startedAt,
  generatedBy: "scripts/p1-release-readiness.mjs",
  includeP0,
  allowBlocked,
  summary,
  results
};

await writeEvidence(evidence);

if (summary.failed > 0 || (summary.blocked > 0 && !allowBlocked)) {
  console.error(`[p1-release-readiness] FAIL ${JSON.stringify(summary)}`);
  process.exit(1);
}

console.log(`[p1-release-readiness] PASS ${JSON.stringify(summary)}`);
