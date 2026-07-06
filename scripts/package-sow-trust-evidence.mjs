#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEFAULT_OUT = "inbox/ceo-one-report-sow-trust-evidence-package";
const REQUIRED_FRESH_FIELDS = [
  "traceId",
  "score",
  "failureClassification",
  "semanticQueries",
  "wikiContextEvidence",
  "lucyMeta",
  "finalAnswer"
];

const REQUIRED_SUMMARY_RATE_FIELDS = [
  "passedChecks",
  "totalChecks",
  "passRate",
  "scorePassCases",
  "scoreTotalCases",
  "scorePassRate",
  "agentCaseCount",
  "tracedCases",
  "traceCoverageRate",
  "uniqueTraces",
  "traceUniquenessRate",
  "artifactCompleteCases",
  "artifactTotalCases",
  "artifactCompleteness"
];

const REQUIRED_ACCESS_RATE_FIELDS = [
  "allowPass",
  "allowTotal",
  "allowPassRate",
  "denyPass",
  "denyTotal",
  "denyPassRate"
];

function argValue(argv, flag, fallback) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : fallback;
}

function abs(path) {
  return resolve(REPO_ROOT, path);
}

function readJson(path) {
  return JSON.parse(readFileSync(abs(path), "utf8"));
}

function copyIfExists(source, target) {
  if (!existsSync(abs(source))) return false;
  mkdirSync(dirname(abs(target)), { recursive: true });
  cpSync(abs(source), abs(target), { recursive: true });
  return true;
}

function artifactFiles(dir) {
  const full = abs(dir);
  if (!existsSync(full)) return [];
  return readdirSync(full)
    .filter((name) => name.endsWith(".json"))
    .map((name) => `${dir}/${name}`);
}

function fieldPresent(value, field) {
  if (!value || typeof value !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(value, field)) return false;
  const item = value[field];
  if (Array.isArray(item)) return item.length > 0;
  if (item && typeof item === "object") return Object.keys(item).length > 0;
  return item !== undefined && item !== null && item !== "";
}

function contractFieldPresent(value, field) {
  if (!value || typeof value !== "object") return false;
  if (!Object.prototype.hasOwnProperty.call(value, field)) return false;
  const item = value[field];
  if (Array.isArray(item)) return true;
  if (field === "score") return item && typeof item === "object" && Object.keys(item).length > 0;
  return item !== undefined && item !== null && item !== "";
}

function inspectArtifacts(paths) {
  return paths.map((path) => {
    const artifact = readJson(path);
    const missingFreshFields = REQUIRED_FRESH_FIELDS.filter((field) => !contractFieldPresent(artifact, field));
    return {
      path,
      profile: artifact.profile,
      caseId: artifact.caseId,
      traceId: artifact.traceId,
      scoreStatus: artifact.score?.status,
      finalAnswerPresent: fieldPresent(artifact, "finalAnswer") || fieldPresent(artifact, "finalText"),
      missingFreshFields
    };
  });
}

function evidenceSummary(evidencePath) {
  if (!existsSync(abs(evidencePath))) return null;
  const evidence = readJson(evidencePath);
  return {
    path: evidencePath,
    generatedAt: evidence.generatedAt,
    status: evidence.status,
    contract: evidence.contract,
    summary: evidence.summary,
    config: {
      proxyUrl: evidence.config?.proxyUrl,
      profiles: evidence.config?.profiles,
      suites: evidence.config?.suites,
      gateKind: evidence.config?.gateKind,
      agentRuntime: evidence.config?.agentRuntime,
      stub: evidence.config?.stub
    },
    exitCode: evidence.exitCode
  };
}

function missingOwnFields(value, fields) {
  return fields.filter((field) => !value || !Object.prototype.hasOwnProperty.call(value, field));
}

function validateE2eStandard(realEvidence) {
  const summary = realEvidence?.summary || {};
  const missingSummaryFields = missingOwnFields(summary, REQUIRED_SUMMARY_RATE_FIELDS);
  const missingAccessFields = missingOwnFields(summary.accessControl || {}, REQUIRED_ACCESS_RATE_FIELDS);
  const failures = [];
  if (missingSummaryFields.length > 0) failures.push(`missing summary fields: ${missingSummaryFields.join(", ")}`);
  if (missingAccessFields.length > 0) failures.push(`missing accessControl fields: ${missingAccessFields.join(", ")}`);
  if (summary.totalChecks !== undefined && summary.passedChecks !== undefined && summary.passRate !== null) {
    const expected = summary.totalChecks > 0 ? Number((summary.passedChecks / summary.totalChecks).toFixed(4)) : null;
    if (expected !== summary.passRate) failures.push("passRate does not match passedChecks / totalChecks");
  }
  if (summary.scoreTotalCases !== undefined && summary.scorePassCases !== undefined && summary.scorePassRate !== null) {
    const expected = summary.scoreTotalCases > 0 ? Number((summary.scorePassCases / summary.scoreTotalCases).toFixed(4)) : null;
    if (expected !== summary.scorePassRate) failures.push("scorePassRate does not match scorePassCases / scoreTotalCases");
  }
  if (summary.agentCaseCount !== undefined && summary.tracedCases !== undefined && summary.traceCoverageRate !== null) {
    const expected = summary.agentCaseCount > 0 ? Number((summary.tracedCases / summary.agentCaseCount).toFixed(4)) : null;
    if (expected !== summary.traceCoverageRate) failures.push("traceCoverageRate does not match tracedCases / agentCaseCount");
  }
  return {
    status: failures.length === 0 ? "pass" : "fail",
    requiredSummaryFields: REQUIRED_SUMMARY_RATE_FIELDS,
    requiredAccessFields: REQUIRED_ACCESS_RATE_FIELDS,
    missingSummaryFields,
    missingAccessFields,
    failures
  };
}

function percent(value) {
  return value == null || !Number.isFinite(Number(value)) ? "N/A" : `${Math.round(Number(value) * 100)}%`;
}

function rate(value, numerator, denominator, label = "") {
  const base = percent(value);
  if (numerator == null || denominator == null || !Number.isFinite(Number(numerator)) || !Number.isFinite(Number(denominator))) return base;
  return `${base} (${numerator}/${denominator}${label ? ` ${label}` : ""})`;
}

function duration(value) {
  return value == null || !Number.isFinite(Number(value)) ? "N/A" : `${Math.round(Number(value))} ms`;
}

function writePackageReadme(outDir, manifest) {
  const summary = manifest.realChainEvidence.summary?.summary || {};
  const access = summary.accessControl || {};
  const latency = summary.latency || {};
  const lines = [
    "# CEO 一眼报 SOW 可信 Eval/UAT 证据包",
    "",
    "| 项 | 内容 |",
    "|---|---|",
    `| 生成日期 | ${manifest.generatedAt.slice(0, 10)} |`,
    "| 目的 | 用真实 Agent + Lucy MCP Proxy + KTX MCP + eval artifact 证明 Lucy 具备可信 Eval/UAT 闭环基础 |",
    `| 证据包路径 | \`${manifest.packagePath}/\` |`,
    `| 结论状态 | \`${manifest.status}\` |`,
    "",
    "## 1. 可直接给用户看的证据",
    "",
    "| 文件 | 证明点 |",
    "|---|---|",
    "| `real-hermes-moz-report.html` | 人类可读 E2E 报告。证明真实 Hermes workhorse / moz profile 通过 Lucy MCP Proxy 访问 KTX 数据链路并完成 agent answer assertions。 |",
    "| `real-hermes-moz-evidence.json` | 机器可读 E2E evidence。关键字段：`status=pass`、`config.agentRuntime=hermes-local-real`、`config.stub=false`、`summary.fail=0`。 |",
    "| `real-hermes-moz-artifacts/*.json` | per-case artifacts。最终版应包含 `traceId`、`score`、`failureClassification`、`semanticQueries`、`wikiContextEvidence`、`lucyMeta`、`finalAnswer`；数组为空表示该 case 未产生该类证据，不等于缺字段。 |",
    "| `latest-refresh-blocked.json` | 若存在，说明最近一次刷新真实 evidence 的阻塞原因。 |",
    "| `manifest.json` | 机器可读证据包清单和字段校验结果。 |",
    "",
    "## 2. 当前自动判定",
    "",
    `- 真实链路 evidence：${manifest.realChainEvidence.status}`,
    `- artifact 最新字段校验：${manifest.freshArtifactValidation.status}`,
    `- E2E 标准字段校验：${manifest.e2eStandardValidation.status}`,
    `- 最新刷新尝试：${manifest.latestRefreshAttempt.status}`,
    `- Pass Rate：${rate(summary.passRate, summary.passedChecks ?? summary.pass, summary.totalChecks ?? ((summary.pass ?? 0) + (summary.fail ?? 0) + (summary.blocked ?? 0)), "checks")}`,
    `- Score Pass Rate：${rate(summary.scorePassRate, summary.scorePassCases, summary.scoreTotalCases, "cases")}`,
    `- Trace Coverage：${rate(summary.traceCoverageRate ?? (summary.traceCoverage === true ? 1 : 0), summary.tracedCases, summary.agentCaseCount, "cases")}`,
    `- Trace Uniqueness：${rate(summary.traceUniquenessRate ?? (summary.traceUniqueness === true ? 1 : 0), summary.uniqueTraces, summary.agentCaseCount, "cases")}`,
    `- Allow 放行率：${rate(access.allowPassRate, access.allowPass, access.allowTotal, "hits")}`,
    `- Deny 拦截率：${rate(access.denyPassRate, access.denyPass, access.denyTotal, "hits")}`,
    `- Agent P95 耗时：${duration(latency.p95Ms)}`,
    "",
    "## 3. 真实链路证明点",
    "",
    "- `stub=false`：不是 stub 跑法。",
    "- `agentRuntime=hermes-local-real`：真实 Hermes agent runtime。",
    "- `proxyUrl=http://127.0.0.1:7879/mcp`：入口是 Lucy MCP Proxy。",
    "- profile 覆盖 Hermes workhorse / moz。",
    "- direct MCP checks 与 agent final-answer assertions 进入 evidence。",
    "",
    "## 4. 固化后的 E2E 标准",
    "",
    "- `manifest.status` 必须为 `READY`。",
    "- 真实链路必须声明 `stub=false` 与 `agentRuntime=hermes-local-real`。",
    "- 每个 rate 指标必须同时给出分子、分母和值，例如 `scorePassCases / scoreTotalCases / scorePassRate`。",
    "- HTML Summary 必须以 `100% (x/y)` 形态展示关键指标，避免只有百分比没有样本量。",
    "- Per-case artifact 必须包含 trace、score、failureClassification、context/semantic/lucy meta 字段；数组可为空，但字段名不可缺失。",
    "",
    "## 5. 若状态不是 READY",
    "",
    "需要用户明确授权 Codex 控制本机 5174 / 7878 / 7879 服务端口后执行：",
    "",
    "```bash",
    "npm run e2e:agent:local-hermes",
    "npm run package:sow-trust-evidence",
    "```",
    "",
    "刷新成功后，`manifest.json.status` 应为 `READY`。"
  ];
  writeFileSync(abs(`${outDir}/README.md`), `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const outDir = argValue(process.argv, "--out", DEFAULT_OUT);
  const strict = process.argv.includes("--strict");
  mkdirSync(abs(outDir), { recursive: true });

  copyIfExists("inbox/p1-agent-e2e-hermes-moz-evidence.json", `${outDir}/real-hermes-moz-evidence.json`);
  copyIfExists("inbox/p1-agent-e2e-hermes-moz-report.html", `${outDir}/real-hermes-moz-report.html`);
  copyIfExists("inbox/p1-agent-e2e-artifacts", `${outDir}/real-hermes-moz-artifacts`);
  copyIfExists("inbox/p1-agent-e2e-local-hermes-run.json", `${outDir}/latest-refresh-blocked.json`);

  const realEvidence = evidenceSummary("inbox/p1-agent-e2e-hermes-moz-evidence.json");
  const blockedEvidence = evidenceSummary("inbox/p1-agent-e2e-local-hermes-run.json");
  const artifacts = inspectArtifacts(artifactFiles("inbox/p1-agent-e2e-artifacts"));
  const freshArtifactsReady = artifacts.length > 0 && artifacts.every((item) => item.missingFreshFields.length === 0);
  const standardValidation = validateE2eStandard(realEvidence);
  const realEvidenceReady = Boolean(
    realEvidence
    && realEvidence.status === "pass"
    && realEvidence.config?.stub === false
    && realEvidence.config?.agentRuntime === "hermes-local-real"
  );

  const manifest = {
    generatedAt: new Date().toISOString(),
    status: realEvidenceReady && freshArtifactsReady && standardValidation.status === "pass" ? "READY" : "PARTIAL_READY_NEEDS_REFRESH",
    objective: "Use a real Agent + real Lucy/KTX MCP + real eval artifact chain to prove the SOW trustworthy Eval/UAT loop.",
    packagePath: outDir,
    realChainEvidence: {
      status: realEvidenceReady ? "available" : "missing_or_not_passing",
      file: "real-hermes-moz-evidence.json",
      summary: realEvidence,
      proves: [
        "real Hermes agent runtime",
        "stub=false",
        "Lucy MCP Proxy endpoint",
        "KTX-backed direct MCP checks",
        "agent final-answer assertions",
        "per-case artifacts"
      ]
    },
    freshArtifactValidation: {
      status: freshArtifactsReady ? "pass" : "needs_refresh",
      requiredFields: REQUIRED_FRESH_FIELDS,
      artifacts
    },
    e2eStandardValidation: standardValidation,
    latestRefreshAttempt: {
      status: blockedEvidence?.status ?? "missing",
      file: existsSync(abs("inbox/p1-agent-e2e-local-hermes-run.json")) ? "latest-refresh-blocked.json" : null,
      summary: blockedEvidence
    },
    refreshCommands: [
      "npm run e2e:agent:local-hermes",
      "npm run package:sow-trust-evidence"
    ]
  };

  writeFileSync(abs(`${outDir}/manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  writePackageReadme(outDir, manifest);
  console.log(`[package-sow-trust-evidence] ${manifest.status}: wrote ${abs(outDir)}`);
  return strict && manifest.status !== "READY" ? 1 : 0;
}

process.exit(main());
