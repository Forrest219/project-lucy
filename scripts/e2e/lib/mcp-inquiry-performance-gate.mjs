/**
 * mcp-inquiry-performance-gate.mjs — P1-78 Task 6：出包／升级聚合器的性能闸。
 *
 * 合同（Spec §6.3／§7／D22／SC-10）：
 * - 正常放行仅接受本条**完整正式 PASS**（绑定候选 digest、verifier 复算一致）；
 * - `SEED_ONLY`／`FAIL`／`BLOCKED`／`NOT RUN` 一律 `releaseReady=false`；
 * - 唯一例外：D22 有效豁免 → `releaseReady="waived"`（≠ PASS，只放行其绑定候选，
 *   不写基线、不晋级 LATEST.json）；过期、越范围、候选不符或伪造的豁免＝FAIL；
 * - CI subset 永不产生 releaseReady。
 *
 * 输入文件（由 release workflow 的性能 job 产出、随 artifact 下载）：
 *   <runDir>/results/mcp-inquiry-performance.json
 * 字段合同：PERFORMANCE_RELEASE_INPUT_CONTRACT。聚合器只读本文件与 evidence
 * 目录并独立复算，绝不解析 runner stdout。
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { parse as parseYaml } from "yaml";

import { EXIT_CODES } from "./common.mjs";
import {
  ATTEMPTS_FILE,
  EVIDENCE_DIR,
  recomputeFromAttempts
} from "./mcp-inquiry-performance-evidence.mjs";

export const PERFORMANCE_RELEASE_INPUT_CONTRACT = "lucy-mcp-inquiry-performance-release-input-v1";
export const PERFORMANCE_RELEASE_INPUT_FILE = "mcp-inquiry-performance.json";

const WAIVER_VERDICTS_DEFAULT = new Set(["BLOCKED", "SEED_ONLY", "NOT RUN"]);
const PERFORMANCE_STATUSES = Object.freeze(["PASS", "SEED_ONLY", "FAIL", "BLOCKED", "NOT RUN"]);

function sha256Hex(buffer) {
  return "sha256:" + createHash("sha256").update(buffer).digest("hex");
}

/** 读取并校验 release input 文件；缺失或合同不符返回 { ok:false, problems }。 */
export function readPerformanceReleaseInput(runDir, readFile = (f) => readFileSync(f)) {
  const file = path.join(runDir, "results", PERFORMANCE_RELEASE_INPUT_FILE);
  if (!existsSync(file)) {
    return { ok: false, problems: [{ severity: "blocked", code: "missing_performance_input", message: `missing ${file}` }], input: null };
  }
  let input;
  try {
    input = JSON.parse(readFile(file, "utf8"));
  } catch (err) {
    return { ok: false, problems: [{ severity: "blocked", code: "invalid_performance_input", message: `not valid JSON: ${err.message}` }], input: null };
  }
  if (input?.contract !== PERFORMANCE_RELEASE_INPUT_CONTRACT) {
    return {
      ok: false,
      problems: [{ severity: "blocked", code: "contract_mismatch", message: `contract must be ${PERFORMANCE_RELEASE_INPUT_CONTRACT}, got ${JSON.stringify(input?.contract)}` }],
      input: null
    };
  }
  for (const f of ["runId", "status", "candidateDigest", "evidenceDir"]) {
    if (input[f] == null || String(input[f]).trim() === "") {
      return { ok: false, problems: [{ severity: "blocked", code: "missing_field", message: `missing ${f}` }], input: null };
    }
  }
  if (!PERFORMANCE_STATUSES.includes(input.status)) {
    return { ok: false, problems: [{ severity: "blocked", code: "invalid_status", message: `status ${JSON.stringify(input.status)} not in ${PERFORMANCE_STATUSES.join("/")}` }], input: null };
  }
  return { ok: true, problems: [], input };
}

/** verifier 复算：attempts 正文 digest 与 release input 一致，且重算判定与申报 status 对齐。
 * attempts 支持两种载体：明文 `attempts.ndjson` 或 gzip `attempts.ndjson.gz`
 * （release artifact 打包形态；digest 按解压后的正文复算）。 */
export function verifyPerformanceEvidence({ runDir, input, readFile = (f) => readFileSync(f) }) {
  const problems = [];
  const evidenceDir = path.isAbsolute(input.evidenceDir)
    ? input.evidenceDir
    : path.resolve(runDir, input.evidenceDir);
  const plainFile = path.join(evidenceDir, ATTEMPTS_FILE);
  const gzFile = `${plainFile}.gz`;
  let body = null;
  let sourceFile = null;
  if (existsSync(plainFile)) {
    body = readFile(plainFile);
    sourceFile = plainFile;
  } else if (existsSync(gzFile)) {
    body = zlib.gunzipSync(readFile(gzFile));
    sourceFile = gzFile;
  } else {
    return { ok: false, problems: [{ severity: "blocked", code: "missing_attempts", message: `missing ${plainFile}` }], recomputed: null };
  }
  const actualDigest = sha256Hex(body);
  if (input.attemptsDigest && input.attemptsDigest !== actualDigest) {
    problems.push({
      severity: "failed",
      code: "attempts_digest_mismatch",
      message: `attempts digest mismatch (from ${path.basename(sourceFile)}): declared ${input.attemptsDigest} vs actual ${actualDigest}`
    });
  }
  const attempts = [];
  for (const line of body.toString("utf8").split("\n")) {
    if (line.trim()) attempts.push(JSON.parse(line));
  }
  const recomputed = recomputeFromAttempts(attempts, { tier: input.tier ?? "formal" });
  return { ok: problems.length === 0, problems, recomputed, attemptsDigest: actualDigest, evidenceDir };
}

/** 解析 D22 豁免文件（frontmatter：candidateDigest／verdict／scopes／expiresAt／approvedBy／failScenarios）。 */
export function parseWaiverFile(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.trimStart());
  if (!m) return { ok: false, problems: ["no frontmatter"] };
  let meta;
  try {
    meta = parseYaml(m[1]);
  } catch (err) {
    return { ok: false, problems: [`frontmatter not valid YAML: ${err.message}`] };
  }
  if (!meta || typeof meta !== "object") return { ok: false, problems: ["frontmatter is empty"] };
  const problems = [];
  for (const f of ["candidateDigest", "verdict", "expiresAt", "approvedBy"]) {
    if (meta[f] == null || String(meta[f]).trim() === "") problems.push(`missing ${f}`);
  }
  return { ok: problems.length === 0, problems, meta };
}

/**
 * D22 豁免校验：候选匹配、未过期、verdict 范围（FAIL 须逐场景 failScenarios 清单）。
 * 任一不成立即无效——无豁免时失败关闭不变（D22⑤）。
 */
export function evaluateWaiver({ waiver, candidateDigest, status, now = Date.now(), failScenarios = null }) {
  if (!waiver?.ok || !waiver.meta) {
    return { valid: false, reason: waiver?.problems?.join("; ") ?? "waiver unparsable" };
  }
  const meta = waiver.meta;
  if (String(meta.candidateDigest) !== String(candidateDigest)) {
    return { valid: false, reason: `waiver candidateDigest ${meta.candidateDigest} does not match the gated candidate ${candidateDigest}` };
  }
  const expires = Date.parse(meta.expiresAt);
  if (!Number.isFinite(expires)) return { valid: false, reason: `waiver expiresAt ${JSON.stringify(meta.expiresAt)} is not a date` };
  if (now >= expires) return { valid: false, reason: `waiver expired at ${meta.expiresAt}` };
  if (!WAIVER_VERDICTS_DEFAULT.has(String(meta.verdict))) {
    // FAIL 不默认可豁免（D22②）：须逐场景清单，且覆盖被 gate 的场景。
    const listed = Array.isArray(meta.failScenarios) ? meta.failScenarios.map(String) : [];
    if (String(meta.verdict) === "FAIL") {
      if (listed.length === 0) return { valid: false, reason: "FAIL waiver requires per-scenario failScenarios (D22②)" };
      if (Array.isArray(failScenarios) && failScenarios.some((s) => !listed.includes(s))) {
        return { valid: false, reason: `FAIL waiver scopes do not cover: ${failScenarios.filter((s) => !listed.includes(s)).join(", ")}` };
      }
    } else {
      return { valid: false, reason: `waiver verdict ${meta.verdict} is not waivable` };
    }
  } else if (String(meta.verdict) !== String(status)) {
    return { valid: false, reason: `waiver verdict ${meta.verdict} does not match gated status ${status}` };
  }
  return { valid: true, reason: null, meta };
}

/** 读取 waivers/ 目录并找出对 (candidateDigest, status) 有效的一条豁免。 */
export function findValidWaiver({ waiversDir, candidateDigest, status, failScenarios = null, now = Date.now(), readFile = (f) => readFileSync(f, "utf8") }) {
  if (!waiversDir || !existsSync(waiversDir)) return { found: false, valid: false, reason: "no waivers directory" };
  let files = [];
  try {
    files = readdirSync(waiversDir).filter((f) => f.endsWith(".md")).sort();
  } catch {
    return { found: false, valid: false, reason: "waivers directory unreadable" };
  }
  const attemptsList = [];
  for (const f of files) {
    const file = path.join(waiversDir, f);
    const parsed = parseWaiverFile(readFile(file));
    const evalResult = evaluateWaiver({ waiver: parsed, candidateDigest, status, now, failScenarios });
    attemptsList.push({ file: f, ok: parsed.ok, valid: evalResult.valid, reason: evalResult.reason ?? parsed.problems?.join("; ") ?? null });
    if (evalResult.valid) return { found: true, valid: true, file: f, meta: evalResult.meta, attempts: attemptsList };
  }
  return {
    found: attemptsList.length > 0,
    valid: false,
    reason: attemptsList.length
      ? `no valid waiver for candidate ${candidateDigest} status ${status}: ${attemptsList.map((a) => `${a.file}(${a.reason ?? "invalid"})`).join("; ")}`
      : "waivers directory is empty",
    attempts: attemptsList
  };
}

/**
 * 性能闸聚合判定（伪代码 §6.3 validWaiver 分支的纯函数实现）。
 * `results.performance` = readPerformanceReleaseInput 的产物。
 */
export function evaluateMcpInquiryPerformanceGate({
  results = {},
  candidateDigest = null,
  ciSubset = false,
  now = Date.now(),
  waiversDir = null,
  readFile = (f) => readFileSync(f)
} = {}) {
  const problems = [...(results.performance?.problems ?? [])];
  const input = results.performance?.input ?? null;

  if (!input) {
    return {
      status: "BLOCKED",
      releaseReady: false,
      problems,
      performance: { status: "BLOCKED", releaseReady: false, reason: "no performance release input" }
    };
  }

  // 候选绑定：不可比候选＝FAIL（D9 可比指纹）。
  if (candidateDigest && String(input.candidateDigest) !== String(candidateDigest)) {
    problems.push({
      severity: "failed",
      code: "candidate_digest_mismatch",
      message: `performance evidence bound to ${input.candidateDigest}, gated candidate is ${candidateDigest}`
    });
  }

  // verifier 复算（SC-16 对齐）：正文 digest 与重算判定。
  const verified = input.evidenceDir
    ? verifyPerformanceEvidence({ runDir: results.runDir ?? ".", input, readFile })
    : { ok: false, problems: [{ severity: "blocked", code: "missing_evidence_dir", message: "release input missing evidenceDir" }], recomputed: null };
  problems.push(...verified.problems);
  if (verified.ok && verified.recomputed && input.status === "PASS") {
    const recomputeFail = verified.recomputed.problems?.length ?? 0;
    if (recomputeFail > 0) {
      problems.push({
        severity: "failed",
        code: "recompute_mismatch",
        message: `independent recompute reported ${recomputeFail} problem(s); declared PASS is not verifiable`
      });
    }
  }

  const failScenarios = verified.recomputed
    ? Object.values(verified.recomputed.scenarios ?? {}).filter((s) => s.verdict === "FAIL").map((s) => s.scenarioId)
    : null;

  // status 以 runner 申报的 input.status 为基线（聚合器不重跑判定，只独立复算
  // 证据一致性）；复算自身的 blocked/failed 问题向上升级，且永不降级为 PASS。
  let status = input.status;
  if (problems.some((p) => p.severity === "blocked") && status !== "FAIL") status = "BLOCKED";
  if (problems.some((p) => p.severity === "failed")) status = "FAIL";
  if (status === "PASS" && problems.some((p) => p.severity !== "note")) status = "FAIL";

  if (ciSubset) {
    problems.push({ severity: "blocked", code: "ci_subset_no_release", message: "CI subset must not set releaseReady=true from subset alone" });
    if (status === "PASS" || status === "SEED_ONLY") status = "BLOCKED";
  }

  let releaseReady = false;
  if (status === "PASS" && !ciSubset) {
    releaseReady = true;
  } else if (status !== "PASS") {
    // D22：只产出 waived（≠ PASS）。豁免按**被 gate 的候选**校验绑定——候选
    // 不符即无效（换候选即不放行），而不是 release input 自报的候选。
    const waiverCandidate = candidateDigest ?? input.candidateDigest;
    const waiver = waiversDir
      ? findValidWaiver({ waiversDir, candidateDigest: waiverCandidate, status: input.status, failScenarios, now })
      : { found: false, valid: false, reason: "waiversDir not provided" };
    if (waiver.valid) {
      releaseReady = "waived";
      problems.push({
        severity: "note",
        code: "d22_waiver_applied",
        message: `D22 waiver ${waiver.file} applied for candidate ${input.candidateDigest} status ${input.status} (not a PASS; no baseline write)`
      });
    } else {
      problems.push({
        severity: "note",
        code: "d22_no_valid_waiver",
        message: waiver.reason
      });
    }
  }

  return {
    status,
    releaseReady,
    problems,
    performance: {
      status: input.status,
      runId: input.runId,
      candidateDigest: input.candidateDigest,
      releaseReady
    }
  };
}

/**
 * 把性能闸叠加到 readiness verdict（与 applyMcpCompatibilityReleaseGate 同构）。
 */
export function applyMcpInquiryPerformanceReleaseGate({
  runDir,
  verdict = null,
  ciSubset = false,
  candidateDigest = null,
  now = Date.now(),
  waiversDir = null,
  evaluateGate = evaluateMcpInquiryPerformanceGate
} = {}) {
  if (!runDir || typeof runDir !== "string") {
    throw new Error("applyMcpInquiryPerformanceReleaseGate requires runDir");
  }
  const loaded = readPerformanceReleaseInput(runDir);
  const gate = evaluateGate({
    results: { performance: loaded, runDir },
    candidateDigest,
    ciSubset,
    now,
    waiversDir
  });

  const problems = [...(verdict?.problems ?? []), ...gate.problems];
  const priorReady = verdict?.releaseReady;
  let releaseReady = false;
  if (priorReady === true && gate.releaseReady === true) releaseReady = true;
  else if (gate.releaseReady === "waived" && (priorReady === true || priorReady === "waived")) releaseReady = "waived";

  let status = verdict?.status ?? (gate.status === "PASS" ? "passed" : gate.status === "FAIL" ? "failed" : "blocked");
  if (releaseReady === "waived") {
    // waived 不是 PASS：报告置顶标注（D22③）用专用状态词，放行其绑定候选。
    status = "passed_with_waiver";
  } else if (gate.status !== "PASS" && (status === "passed" || status === "PASS")) {
    status = gate.status === "FAIL" ? "failed" : "blocked";
  }

  const exitCode =
    status === "passed" || status === "passed_with_waiver"
      ? EXIT_CODES.passed
      : status === "blocked"
        ? EXIT_CODES.blocked
        : EXIT_CODES.failed;

  return {
    ...verdict,
    status,
    exitCode,
    releaseReady,
    problems,
    mcpInquiryPerformance: {
      status: gate.status,
      releaseReady: gate.releaseReady,
      runId: gate.performance?.runId ?? null,
      problems: gate.problems
    }
  };
}
