#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { prepareEnvironment } from "./prepare-environment.mjs";
import { seedUpgradeFixture } from "./lib/upgrade-fixture.mjs";
import { LucyProcess, waitForPort } from "./lib/instance.mjs";
import { REPO_ROOT } from "./lib/common.mjs";

export function projectUpgradeResults(report, expected) {
  const tests = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) tests.push({ title: spec.title, test });
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  const entries = expected.map((id) => {
    const matching = tests.filter(({ test }) => [...test.annotations ?? [], ...(test.results ?? []).flatMap((r) => r.annotations ?? [])].some((a) => a.type === "upgrade-feature" && a.description === id));
    if (matching.length === 0) return { id, status: "blocked", reason: "missing_executable_case" };
    const annotations = matching.flatMap(({ test }) => [...test.annotations ?? [], ...(test.results ?? []).flatMap((r) => r.annotations ?? [])]);
    const failed = matching.some(({ test }) => ["failed", "timedOut", "interrupted"].includes(test.results?.at(-1)?.status));
    const skipped = matching.some(({ test }) => test.results?.at(-1)?.status !== "passed");
    const reasons = annotations.filter((a) => a.type === "blocked").map((a) => a.description);
    return { id, status: failed ? "failed" : skipped || reasons.length ? "blocked" : "passed", reasons, tests: matching.map(({ title }) => title) };
  });
  return { contract: "lucy-upgrade-checklist/v1", releaseEligible: false, entries, summary: Object.fromEntries(["passed", "failed", "blocked"].map((status) => [status, entries.filter((e) => e.status === status).length])) };
}

export function scanUpgradeArtifacts(run) {
  const admins = JSON.parse(readFileSync(path.join(run.secretsDir, "admins.json"), "utf8"));
  const tokens = JSON.parse(readFileSync(path.join(run.secretsDir, "tokens.json"), "utf8"));
  const secrets = [...Object.values(admins).map((a) => a.password), ...Object.values(tokens)];
  const bootstrap = path.join(run.secretsDir, "bootstrap-token");
  if (existsSync(bootstrap)) secrets.push(readFileSync(bootstrap, "utf8").trim());
  const values = secrets.filter((s) => typeof s === "string" && s.length >= 8);
  const hits = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) walk(file);
      else if (item.isFile()) {
        const content = readFileSync(file);
        if (values.some((s) => content.includes(s))) hits.push(path.relative(run.paths.runDir, file));
      }
    }
  };
  walk(run.paths.logs);
  walk(path.join(run.paths.runDir, "results"));
  return { status: hits.length ? "failed" : "passed", hits };
}
function sourceIdentity() {
  const git = (args) => {
    const out = spawnSync("git", args, { cwd: REPO_ROOT });
    if (out.status !== 0) throw new Error("Cannot record candidate source identity");
    return out.stdout;
  };
  const files = ["scripts/e2e/run-upgrade-features.mjs", "scripts/e2e/lib/upgrade-fixture.mjs", "scripts/e2e/contracts/upgrade-features.yaml", "webui/tests/upgrade-e2e/upgrade-features.spec.ts", "webui/playwright.upgrade.config.ts", "webui/server/proxy/mcp-proxy.ts", "webui/server/proxy/audit.ts"];
  return { gitHead: git(["rev-parse", "HEAD"]).toString().trim(), workingTreePatchSha256: createHash("sha256").update(git(["diff", "HEAD", "--binary"])).digest("hex"), files: Object.fromEntries(files.map((file) => [file, createHash("sha256").update(readFileSync(path.join(REPO_ROOT, file))).digest("hex")])) };
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once("error", reject).listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function execute(command, args, { env = process.env, cwd = REPO_ROOT, log } = {}) {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const output = log ? createWriteStream(log) : null;
  child.stdout.on("data", (data) => output?.write(data));
  child.stderr.on("data", (data) => output?.write(data));
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  if (output) await new Promise((resolve) => output.end(resolve));
  return code;
}
async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const candidateAtStart = sourceIdentity();
  const runId = arg("--run-id") ?? `upgrade-${Date.now()}`;
  const prepared = await prepareEnvironment({ runId, mode: "local", webuiPort: await freePort(), proxyPort: await freePort() });
  const run = seedUpgradeFixture(prepared.run);
  mkdirSync(path.join(run.paths.runDir, "results"), { recursive: true });
  const ktxBin = arg("--ktx-bin") ?? "ktx";
  const upstreamPort = await freePort();
  const env = { ...process.env, ...run.instance.env, LUCY_PROXY_UPSTREAM_PORT: String(upstreamPort), LUCY_REAL_E2E_RUN: path.join(run.paths.runDir, "run.json") };
  if (path.isAbsolute(ktxBin)) env.PATH = `${path.dirname(ktxBin)}:${env.PATH}`;
  let ktx = null;
  let lucy = null;
  try {
    const versionLog = path.join(run.paths.logs, "ktx-version.log");
    if (await execute(ktxBin, ["--version"], { env, log: versionLog }) !== 0) throw new Error("KTX version probe failed");
    const version = readFileSync(versionLog, "utf8").trim();
    if (!/^@kaelio\/ktx 0\.16\.0$/.test(version)) throw new Error("upgrade validation requires bundled KTX 0.16.0; pass --ktx-bin to a matching installation");
    if (await execute(ktxBin, ["--project-dir", run.paths.project, "admin", "reindex"], { env, log: path.join(run.paths.logs, "reindex.log") }) !== 0) throw new Error("real KTX reindex failed");
    const ktxLog = createWriteStream(path.join(run.paths.logs, "ktx.log"));
    ktx = spawn(ktxBin, ["--project-dir", run.paths.project, "mcp", "start", "--foreground", "--port", String(upstreamPort)], { env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    ktx.stdout.pipe(ktxLog); ktx.stderr.pipe(ktxLog);
    await waitForPort("127.0.0.1", upstreamPort, 30_000);
    lucy = new LucyProcess(run, { extraEnv: { LUCY_PROXY_UPSTREAM_PORT: String(upstreamPort) } });
    await lucy.start();
    const bin = path.join(REPO_ROOT, "webui/node_modules/.bin/playwright");
    const code = await execute(bin, ["test", "-c", "playwright.upgrade.config.ts"], { cwd: path.join(REPO_ROOT, "webui"), env, log: path.join(run.paths.logs, "upgrade-playwright.log") });
    const reportFile = path.join(run.paths.runDir, "results/upgrade-playwright.json");
    const result = projectUpgradeResults(JSON.parse(readFileSync(reportFile, "utf8")), [...Array.from({ length: 14 }, (_, i) => `UPG-${String(i + 1).padStart(2, "0")}`), "UPG-14-live"]);
    result.runId = run.runId;
    result.ktxVersion = version;
    result.candidate = candidateAtStart;
    result.sourceChangedDuringRun = JSON.stringify(candidateAtStart) !== JSON.stringify(sourceIdentity());
    if (path.isAbsolute(ktxBin)) {
      result.ktxBinary = { path: realpathSync(ktxBin), sha256: createHash("sha256").update(readFileSync(realpathSync(ktxBin))).digest("hex") };
    }
    result.secretScan = scanUpgradeArtifacts(run);
    result.reportSha256 = createHash("sha256").update(readFileSync(reportFile)).digest("hex");
    writeFileSync(path.join(run.paths.runDir, "upgrade-checklist.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ runDir: run.paths.runDir, ...result.summary, releaseEligible: false }));
    process.exitCode = result.summary.failed || result.sourceChangedDuringRun || result.secretScan.status !== "passed" || code !== 0 ? 1 : result.summary.blocked ? 2 : 0;
  } finally {
    await lucy?.stop();
    if (ktx?.pid) { try { process.kill(-ktx.pid, "SIGTERM"); } catch {} }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
