import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SCRIPT = path.join(ROOT, "scripts", "p1-starrocks-certification.mjs");

async function withTempProject(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-starrocks-cert-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function cleanEnv(extra = {}) {
  const allowed = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "SystemRoot", "COMSPEC"]) {
    if (process.env[key]) allowed[key] = process.env[key];
  }
  return { ...allowed, ...extra };
}

function runCertification(projectDir, env = {}, args = []) {
  return spawnSync(process.execPath, [
    SCRIPT,
    "--project", projectDir,
    "--summary", "inbox/starrocks-r1-certification-summary.json",
    ...args
  ], {
    cwd: ROOT,
    env: cleanEnv(env),
    encoding: "utf8"
  });
}

async function readSummary(projectDir) {
  return JSON.parse(await readFile(path.join(projectDir, "inbox", "starrocks-r1-certification-summary.json"), "utf8"));
}

test("writes blocked evidence and skips execution when live StarRocks precheck inputs are missing", async () => {
  await withTempProject(async (projectDir) => {
    const result = runCertification(projectDir);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.equal(result.stderr, "");
    const summary = await readSummary(projectDir);
    assert.equal(summary.status, "blocked");
    assert.equal(summary.ok, false);
    assert.equal(summary.certification, "not_certified");
    assert.equal(summary.noFakeVerification, true);
    assert.equal(summary.precheck.status, "blocked");
    assert(summary.precheck.missing.some((item) => item.id === "ktx_config.missing"));
    assert(summary.precheck.missing.some((item) => item.env === "LUCY_R1_PROXY_TOKEN"));
    assert(summary.precheck.missing.some((item) => item.env === "LUCY_R1_STARROCKS_CONNECTION"));
    assert(summary.precheck.missing.some((item) => item.env === "LUCY_R1_STARROCKS_FORBID_MEASURE"));
    assert(summary.steps.every((step) => step.status === "skipped" && step.reason === "precheck_blocked"));
    assert(summary.commands.some((command) => command.command.includes("npm run r1:starrocks-smoke")));
    assert(summary.commands.some((command) => command.command.includes("npm run r1:mcp-contract")));
    assert(summary.commands.some((command) => command.command.includes("npm run r1:readiness:strict -- --target starrocks")));
  });
});

test("dry-run summarizes the wrapped StarRocks certification commands without leaking proxy token", async () => {
  await withTempProject(async (projectDir) => {
    await writeFile(path.join(projectDir, "ktx.yaml"), `connections:
  starrocks-r1:
    driver: mysql
    engine: starrocks
    wire_protocol: mysql
    readonly: true
    r1_target: true
    host: starrocks.example.invalid
    database: analytics
    username: lucy_readonly
    password: file:/tmp/starrocks-password
`, "utf8");
    await writeFile(path.join(projectDir, "timeout.json"), JSON.stringify({
      status: "pass",
      classification: "source_timeout"
    }), "utf8");
    await writeFile(path.join(projectDir, "hermes.json"), JSON.stringify({
      placeholder: "structural validation happens in r1:readiness:strict"
    }), "utf8");

    const result = runCertification(projectDir, {
      LUCY_R1_PROXY_URL: "http://127.0.0.1:7879/mcp",
      LUCY_R1_PROXY_TOKEN: "super-secret-token",
      LUCY_R1_STARROCKS_CONNECTION: "starrocks-r1",
      LUCY_R1_STARROCKS_SOURCE: "ceo_metric_snapshot",
      LUCY_R1_STARROCKS_MEASURE: "ceo_metric_snapshot.revenue",
      LUCY_R1_STARROCKS_DIMENSION: "ceo_metric_snapshot.biz_date",
      LUCY_R1_TIMEOUT_EVIDENCE: "timeout.json",
      LUCY_R1_STARROCKS_READONLY_ACCOUNT_CONFIRMED: "true",
      LUCY_R1_STARROCKS_FORBID_TOOL: "sql_execution",
      LUCY_R1_STARROCKS_FORBID_SOURCE: "forbidden_source",
      LUCY_R1_STARROCKS_FORBID_MEASURE: "forbidden_source.revenue",
      LUCY_R1_HERMES_ACCURACY_REPORT: "hermes.json"
    }, ["--dry-run"]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const summary = await readSummary(projectDir);
    assert.equal(summary.status, "ready");
    assert.equal(summary.certification, "not_run");
    assert.equal(summary.precheck.status, "pass");
    assert(summary.commands.find((command) => command.id === "starrocks_smoke").command.includes("--readonly-account-confirmed"));
    assert(summary.commands.find((command) => command.id === "mcp_contract").command.includes("--forbid-measure forbidden_source.revenue"));
    assert(summary.commands.find((command) => command.id === "readiness_strict").command.includes("--target starrocks"));
    assert(!JSON.stringify(summary).includes("super-secret-token"));
    assert(summary.steps.every((step) => step.status === "skipped" && step.reason === "dry_run"));
  });
});
