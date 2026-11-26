#!/usr/bin/env node
/**
 * write-mcp-inquiry-performance-release-input.mjs — P1-78 Task 6。
 *
 * 从最近一次（--run-id 指定或 evidence 目录中最新的）release 档跑次证据中
 * 产出性能发布输入文件：
 *   <out-dir>/results/mcp-inquiry-performance.json   合同 PERFORMANCE_RELEASE_INPUT_CONTRACT
 *   <out-dir>/perf-evidence/<runId>/attempts.ndjson.gz  原始尝试（gzip）
 *
 * 聚合器（scripts/e2e/lib/mcp-inquiry-performance-gate.mjs）从 runDir 相对路径
 * 复算 attempts digest 并校验候选绑定；本脚本不解读判定，只如实登记 runner
 * 退出码与状态。
 *
 * 用法：
 *   node scripts/uat/write-mcp-inquiry-performance-release-input.mjs \
 *     --candidate-digest sha256:... [--run-id <id>] [--trigger release] \
 *     [--out-dir inbox/mcp-inquiry-performance-release] [--status <S>] [--exit <n>]
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EVIDENCE_ROOT = path.join(REPO_ROOT, "docs/qa/uat/suites/mcp-inquiry-performance/evidence");
const CONTRACT = "lucy-mcp-inquiry-performance-release-input-v1";

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--candidate-digest") out.candidateDigest = argv[++i];
    else if (a === "--run-id") out.runId = argv[++i];
    else if (a === "--trigger") out.trigger = argv[++i] ?? "release";
    else if (a === "--out-dir") out.outDir = argv[++i];
    else if (a == "--status") out.status = argv[++i];
    else if (a == "--exit") out.exit = Number(argv[++i]);
    else if (a === "--help") out.help = true;
  }
  return out;
}

function latestRunId() {
  const entries = readdirSync(EVIDENCE_ROOT)
    .filter((d) => d.startsWith("mip-") && existsSync(path.join(EVIDENCE_ROOT, d, "attempts.ndjson")))
    .sort();
  if (entries.length === 0) throw new Error("no performance evidence runs found");
  return entries[entries.length - 1];
}

const args = parseArgv(process.argv.slice(2));
if (args.help || !args.candidateDigest) {
  console.log("用法：--candidate-digest <sha256:...> [--run-id <id>] [--trigger release] [--out-dir <dir>] [--status S] [--exit n]");
  process.exit(args.help ? 0 : 2);
}
const runId = args.runId ?? latestRunId();
const runDir = path.join(EVIDENCE_ROOT, runId);
const attemptsPath = path.join(runDir, "attempts.ndjson");
if (!existsSync(attemptsPath)) throw new Error(`missing ${attemptsPath}`);

const body = readFileSync(attemptsPath);
const attemptsDigest = "sha256:" + createHash("sha256").update(body).digest("hex");

// attempts 的第一条携带 runner 的候选与环境指纹。
const first = JSON.parse(body.toString("utf8").split("\n")[0]);

const input = {
  contract: CONTRACT,
  runId,
  trigger: args.trigger ?? "release",
  tier: "formal",
  status: args.status ?? "NOT RUN",
  exitCode: Number.isFinite(args.exit) ? args.exit : null,
  candidateDigest: args.candidateDigest,
  candidateFingerprint: first.candidateFingerprint ?? null,
  environmentFingerprint: first.environmentFingerprint ?? null,
  questionSetDigest: first.questionSetDigest ?? null,
  configDigest: first.configDigest ?? null,
  budgetDigest: first.budgetDigest ?? null,
  attemptsDigest,
  attemptCount: body.toString("utf8").split("\n").filter((l) => l.trim()).length,
  evidenceDir: path.join("perf-evidence", runId),
  generatedAt: new Date().toISOString()
};

const outDir = path.resolve(REPO_ROOT, args.outDir ?? "inbox/mcp-inquiry-performance-release");
mkdirSync(path.join(outDir, "results"), { recursive: true });
mkdirSync(path.join(outDir, "perf-evidence", runId), { recursive: true });

// 原始尝试入包（gzip；聚合器侧解压复算）。优先复用既有 .gz（同正文）。
const gzTarget = path.join(outDir, "perf-evidence", runId, "attempts.ndjson.gz");
const existingGz = path.join(runDir, "attempts.ndjson.gz");
if (existsSync(existingGz)) {
  execFileSync("cp", [existingGz, gzTarget]);
} else {
  execFileSync("bash", ["-c", `gzip -c '${attemptsPath}' > '${gzTarget}'`]);
}
const gzBody = readFileSync(gzTarget);
input.attemptsGzDigest = "sha256:" + createHash("sha256").update(gzBody).digest("hex");

writeFileSync(path.join(outDir, "results", "mcp-inquiry-performance.json"), `${JSON.stringify(input, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ written: "results/mcp-inquiry-performance.json", runId, status: input.status, attemptsDigest: input.attemptsDigest.slice(0, 19), candidateDigest: input.candidateDigest })}\n`);
