#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function optionValue(name, fallback) {
  const argv = process.argv.slice(2);
  const flag = `--${name}`;
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] ?? fallback : fallback;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

const project = path.resolve(optionValue("project", process.cwd()));
const summaryPath = path.resolve(project, optionValue("summary", "inbox/starrocks-r1-certification-summary.json"));
const dryRun = hasFlag("dry-run");

function relEnvPath(value) {
  if (!value) return undefined;
  return path.isAbsolute(value) ? value : path.join(project, value);
}

function run(command, commandArgs, timeoutMs = 900_000) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: project, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({ code: 124, stdout, stderr: `${stderr}\ntimeout after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function buildCommands() {
  const connection = process.env.LUCY_R1_STARROCKS_CONNECTION;
  const source = process.env.LUCY_R1_STARROCKS_SOURCE;
  const measure = process.env.LUCY_R1_STARROCKS_MEASURE;
  const dimension = process.env.LUCY_R1_STARROCKS_DIMENSION;
  const proxyUrl = process.env.LUCY_R1_PROXY_URL;
  const forbidTool = process.env.LUCY_R1_STARROCKS_FORBID_TOOL;
  const forbidSource = process.env.LUCY_R1_STARROCKS_FORBID_SOURCE;
  const forbidMeasure = process.env.LUCY_R1_STARROCKS_FORBID_MEASURE;
  return [
    {
      id: "starrocks_smoke",
      command: [
        "npm", "run", "r1:starrocks-smoke", "--",
        "--connection", connection,
        "--source", source,
        "--measure", measure,
        "--dimension", dimension,
        "--readonly-account-confirmed"
      ].filter(Boolean).join(" ")
    },
    {
      id: "mcp_contract",
      command: [
        "npm", "run", "r1:mcp-contract", "--",
        "--proxy-url", proxyUrl,
        "--connection", connection,
        "--source", source,
        "--forbid-tool", forbidTool,
        "--forbid-source", forbidSource,
        "--forbid-measure", forbidMeasure
      ].filter(Boolean).join(" ")
    },
    {
      id: "readiness_strict",
      command: "npm run r1:readiness:strict -- --target starrocks"
    }
  ];
}

function precheck(commands) {
  const missing = [];
  if (!existsSync(path.join(project, "ktx.yaml"))) missing.push({ id: "ktx_config.missing", file: "ktx.yaml" });
  for (const env of [
    "LUCY_R1_PROXY_TOKEN",
    "LUCY_R1_STARROCKS_CONNECTION",
    "LUCY_R1_STARROCKS_SOURCE",
    "LUCY_R1_STARROCKS_MEASURE",
    "LUCY_R1_STARROCKS_DIMENSION",
    "LUCY_R1_STARROCKS_FORBID_MEASURE"
  ]) {
    if (!process.env[env]) missing.push({ id: `env.${env}.missing`, env });
  }
  for (const env of ["LUCY_R1_TIMEOUT_EVIDENCE", "LUCY_R1_HERMES_ACCURACY_REPORT"]) {
    const file = relEnvPath(process.env[env]);
    if (!file || !existsSync(file)) missing.push({ id: `evidence.${env}.missing`, env });
  }
  if (process.env.LUCY_R1_STARROCKS_READONLY_ACCOUNT_CONFIRMED !== "true") {
    missing.push({ id: "readonly_account.unconfirmed", env: "LUCY_R1_STARROCKS_READONLY_ACCOUNT_CONFIRMED" });
  }
  return { status: missing.length ? "blocked" : "pass", missing, commands };
}

async function writeSummary(summary) {
  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
}

async function main() {
  const commands = buildCommands();
  const check = precheck(commands);
  const summary = {
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/p1-starrocks-certification.mjs",
    ok: false,
    status: check.status === "pass" ? "ready" : "blocked",
    certification: check.status === "pass" ? "not_run" : "not_certified",
    noFakeVerification: true,
    precheck: check,
    commands,
    steps: commands.map((command) => ({
      id: command.id,
      status: check.status === "pass" && !dryRun ? "pending" : "skipped",
      reason: check.status === "pass" ? "dry_run" : "precheck_blocked"
    }))
  };

  if (check.status !== "pass" || dryRun) {
    summary.ok = check.status === "pass";
    await writeSummary(summary);
    console.log(`[p1-starrocks-certification] ${summary.status}: wrote ${summaryPath}`);
    process.exit(check.status === "pass" ? 0 : 2);
  }

  for (const step of summary.steps) {
    const command = commands.find((item) => item.id === step.id);
    const [cmd, ...commandArgs] = command.command.split(/\s+/);
    const result = await run(cmd, commandArgs);
    step.status = result.code === 0 ? "pass" : "fail";
    step.exitCode = result.code;
    step.stdoutTail = result.stdout.slice(-1000);
    step.stderrTail = result.stderr.slice(-1000);
  }
  summary.status = summary.steps.every((step) => step.status === "pass") ? "pass" : "fail";
  summary.ok = summary.status === "pass";
  summary.certification = summary.ok ? "certified" : "not_certified";
  await writeSummary(summary);
  process.exit(summary.ok ? 0 : 1);
}

await main();
