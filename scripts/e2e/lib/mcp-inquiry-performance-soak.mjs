/**
 * P1-78 Task 8 — SOAK（持续压力）与 LONG_FOLLOW（长追问）编排。
 *
 * Spec: docs/specs/lucy-20261123-mcp-inquiry-performance-baseline-spec.md
 *   （D18／D19／D20／D21⑦／D23、§4.1、§4.2、§4.1.1、§5.3、§5.4）
 * Plan: docs/plans/lucy-20261123-mcp-inquiry-performance-baseline-plan.md Task 8
 * 到达模型唯一来源：docs/qa/uat/scale-baseline.md §1.1 MCP-PERF profile（只读引用，不复制数值）。
 * 长链题目唯一来源：P1-79 长追问题组（scripts/e2e/contracts/mcp-inquiry-long-followups.yaml，
 *   由 scripts/e2e/lib/mcp-inquiry-question-pack.mjs 校验），缺失或 digest 不符即 BLOCKED（D19）。
 *
 * 本模块只做编排与证据整形：
 *   - 不写文件、不发网络请求、不改产品代码；
 *   - 判定全部委托给 scripts/e2e/lib/mcp-inquiry-performance.mjs（judgeWindowsByClass／
 *     checkSampleReachability／judgeLongFollowChains／mapOwnerBudgetClass）；
 *   - 时钟、身份会话工厂、单轮执行器全部依赖注入，真实执行路径写好但本任务不运行。
 *
 * 编排入口（供 runner 接线，--trigger soak|long_follow 不在本任务范围）：
 *   runSoakScenario(options)      → SOAK 跑次编排（到达模型 → 预检 → 派发 → 窗口统计 → 判定）
 *   runLongFollowScenario(options)→ LONG_FOLLOW 跑次编排（题组校验 → 链实例计划 → 执行 → 判定）
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";

import {
  ABSOLUTE_BUDGETS,
  checkSampleReachability,
  judgeLongFollowChains,
  judgeWindowsByClass,
  mapOwnerBudgetClass,
  median,
  nearestRank,
} from "./mcp-inquiry-performance.mjs";
import {
  DEFAULT_PACK_PATH,
  MIN_CHAIN_TURNS,
  MIN_CHAINS,
  MIN_FOLLOWUP_TURNS,
  loadQuestionPack,
  validateQuestionPack,
} from "./mcp-inquiry-question-pack.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const E2E_ROOT = path.resolve(HERE, "..");
export const REPO_ROOT = path.resolve(E2E_ROOT, "../..");

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

export const SOAK_SCENARIO_ID = "SOAK";
export const LONG_FOLLOW_SCENARIO_ID = "LONG_FOLLOW";

/** §5.4：SOAK 有效窗口 ≥1800 秒，建议 12 个 150 秒窗口。 */
export const SOAK_MIN_EFFECTIVE_SECONDS = 1800;
export const SOAK_DEFAULT_WINDOW_COUNT = 12;
export const SOAK_DEFAULT_WINDOW_SECONDS = 150;

/** §4.1／scale-baseline §1.1：50 个独立 Agent 身份与真实宿主会话。 */
export const SOAK_REQUIRED_IDENTITY_COUNT = 50;

/** §5.4：长链实例占场景实例 ≥10%（按 ceil(0.1×N) 取整）。 */
export const LONG_FOLLOW_CHAIN_RATIO = 0.1;
export const LONG_FOLLOW_MIN_TOTAL_TURNS = MIN_CHAIN_TURNS;
export const LONG_FOLLOW_MIN_FOLLOWUP_TURNS = MIN_FOLLOWUP_TURNS;

/** D23⑤：窗末在途轮次排空上限 120 秒。 */
export const SOAK_DRAIN_MS = 120_000;

/**
 * 到达模型一致性判定容差：观测到达分布与配置截断正态的 KS 距离上限。
 * 均匀到达（负控）与配置模型之间的 KS 距离约 0.23，明显越线。
 */
export const ARRIVAL_MODEL_KS_TOLERANCE = 0.2;

export const SCALE_BASELINE_RELATIVE_PATH = "docs/qa/uat/scale-baseline.md";
export const PERFORMANCE_CONTRACT_RELATIVE_PATH = "scripts/e2e/contracts/mcp-inquiry-performance.yaml";

const ARRIVAL_ROW_MARKER = "持续压力到达模型";
const SCALE_SECTION_HEADING = /^#{2,4}\s*1\.1\b/m;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function requirePositiveNumber(value, field) {
  const n = finiteOrNull(value);
  if (n == null || n <= 0) throw new Error(`arrival model: ${field} must be a positive number, got ${JSON.stringify(value ?? null)}`);
  return n;
}

function requireNonNegativeNumber(value, field) {
  const n = finiteOrNull(value);
  if (n == null || n < 0) throw new Error(`arrival model: ${field} must be a non-negative number, got ${JSON.stringify(value ?? null)}`);
  return n;
}

function requireInteger(value, field) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`arrival model: ${field} must be an integer, got ${JSON.stringify(value ?? null)}`);
  return n;
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26 based erf approximation). */
function normalCdf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return 0.5 * (1 + sign * y);
}

function normalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/** Deterministic PRNG (mulberry32) — same seed ⇒ same sequence. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box–Muller standard normal draw from a uniform generator. */
function gaussianFrom(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * CDF of the *clipped* normal used by the arrival model: the density of
 * N(mu, sigma) with the tails folded onto [clipMin, clipMax].
 */
function clippedNormalCdf(x, { muSeconds, sigmaSeconds, clipMinSeconds, clipMaxSeconds }) {
  if (x < clipMinSeconds) return 0;
  if (x >= clipMaxSeconds) return 1;
  const alpha = (clipMinSeconds - muSeconds) / sigmaSeconds;
  const z = (x - muSeconds) / sigmaSeconds;
  if (x === clipMinSeconds) return normalCdf(alpha);
  return normalCdf(z);
}

function uniformCdf(x, { clipMinSeconds, clipMaxSeconds }) {
  if (x < clipMinSeconds) return 0;
  if (x >= clipMaxSeconds) return 1;
  return (x - clipMinSeconds) / (clipMaxSeconds - clipMinSeconds);
}

/** Kolmogorov–Smirnov distance between an empirical sample and a CDF. */
function ksDistance(sortedSamples, cdf) {
  const n = sortedSamples.length;
  let d = 0;
  for (let i = 0; i < n; i += 1) {
    const f = cdf(sortedSamples[i]);
    d = Math.max(d, (i + 1) / n - f, f - i / n);
  }
  return d;
}

/** Analytic mean/sd of the clipped normal (tail mass folded onto the bounds). */
function clippedNormalMoments({ muSeconds, sigmaSeconds, clipMinSeconds, clipMaxSeconds }) {
  const alpha = (clipMinSeconds - muSeconds) / sigmaSeconds;
  const beta = (clipMaxSeconds - muSeconds) / sigmaSeconds;
  const cdfA = normalCdf(alpha);
  const cdfB = normalCdf(beta);
  const pdfA = normalPdf(alpha);
  const pdfB = normalPdf(beta);
  const mass = cdfB - cdfA;
  const mean =
    clipMinSeconds * cdfA +
    clipMaxSeconds * (1 - cdfB) +
    muSeconds * mass +
    sigmaSeconds * (pdfA - pdfB);
  const secondMoment =
    clipMinSeconds * clipMinSeconds * cdfA +
    clipMaxSeconds * clipMaxSeconds * (1 - cdfB) +
    (muSeconds * muSeconds + sigmaSeconds * sigmaSeconds) * mass +
    2 * muSeconds * sigmaSeconds * (pdfA - pdfB) +
    sigmaSeconds * sigmaSeconds * (beta * pdfB - alpha * pdfA);
  const variance = Math.max(0, secondMoment - mean * mean);
  return { meanSeconds: mean, sdSeconds: Math.sqrt(variance) };
}

// ---------------------------------------------------------------------------
// arrival model parameters (scale-baseline §1.1 is the only source)
// ---------------------------------------------------------------------------

/**
 * Parse the arrival-model row of scale-baseline §1.1 (MCP-PERF profile).
 *
 * Read-only: the row is the single source of truth for μ, σ, truncation
 * bounds, effective-window shape, class share and the think-time seed
 * (Spec D23⑥ / D17). Nothing is defaulted — a parse failure raises.
 *
 * @param {string} [source] markdown text or a file path (default: scale-baseline §1.1)
 * @returns {{
 *   muSeconds: number, sigmaSeconds: number, clipMinSeconds: number, clipMaxSeconds: number,
 *   seed: number, classShare: Record<string, number>, windowCount: number, windowSeconds: number,
 *   effectiveSeconds: number, source: string
 * }}
 */
export function parseArrivalModelFromScaleBaseline(source = SCALE_BASELINE_RELATIVE_PATH) {
  let text;
  let origin;
  if (typeof source === "string" && source.includes("\n")) {
    text = source;
    origin = "<inline markdown>";
  } else {
    const file = path.isAbsolute(source) ? source : path.resolve(REPO_ROOT, source);
    origin = file;
    if (!existsSync(file)) {
      throw new Error(`arrival model: scale baseline not found: ${file}`);
    }
    text = readFileSync(file, "utf8");
  }

  const heading = SCALE_SECTION_HEADING.exec(text);
  if (!heading) {
    throw new Error(`arrival model: cannot find the "### 1.1" section in ${origin}`);
  }
  const afterHeading = text.slice(heading.index);
  const nextHeading = /\n#{2,4}\s/.exec(afterHeading.slice(1));
  const section = nextHeading ? afterHeading.slice(0, nextHeading.index + 1) : afterHeading;

  const rowLine = section
    .split("\n")
    .find((line) => line.trim().startsWith("|") && line.includes(ARRIVAL_ROW_MARKER));
  if (!rowLine) {
    throw new Error(
      `arrival model: cannot find the "${ARRIVAL_ROW_MARKER}" row in scale-baseline §1.1 (${origin})`
    );
  }
  const cells = rowLine.split("|").map((cell) => cell.trim());
  const cell = cells[2] ?? "";
  const flat = cell.replace(/\*\*/g, "");

  const mu = /μ\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*秒/.exec(flat);
  if (!mu) throw new Error(`arrival model: cannot parse μ from scale-baseline §1.1 row: ${cell}`);
  const sigma = /σ\s*=\s*([0-9]+(?:\.[0-9]+)?)\s*秒/.exec(flat);
  if (!sigma) throw new Error(`arrival model: cannot parse σ from scale-baseline §1.1 row: ${cell}`);
  const clip = /截断\s*\[\s*([0-9]+(?:\.[0-9]+)?)\s*秒\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*秒\s*\]/.exec(flat);
  if (!clip) throw new Error(`arrival model: cannot parse the truncation bounds from scale-baseline §1.1 row: ${cell}`);
  const window = /有效窗口\s*([0-9]+)\s*×\s*([0-9]+)\s*秒/.exec(flat);
  if (!window) throw new Error(`arrival model: cannot parse the effective window from scale-baseline §1.1 row: ${cell}`);
  const share = /题档占比\s*simple\s*([0-9]+(?:\.[0-9]+)?)%\s*／\s*complex\s*([0-9]+(?:\.[0-9]+)?)%/.exec(flat);
  if (!share) throw new Error(`arrival model: cannot parse the class share from scale-baseline §1.1 row: ${cell}`);
  const seed = /随机种子固定整数\s*([0-9]+)/.exec(flat);
  if (!seed) throw new Error(`arrival model: cannot parse the think-time seed from scale-baseline §1.1 row: ${cell}`);

  const muSeconds = Number(mu[1]);
  const sigmaSeconds = Number(sigma[1]);
  const clipMinSeconds = Number(clip[1]);
  const clipMaxSeconds = Number(clip[2]);
  const windowCount = Number(window[1]);
  const windowSeconds = Number(window[2]);
  const classShare = { simple: Number(share[1]) / 100, complex: Number(share[2]) / 100 };
  const shareSum = classShare.simple + classShare.complex;
  if (Math.abs(shareSum - 1) > 1e-9) {
    throw new Error(`arrival model: class share must sum to 1, got ${shareSum} from scale-baseline §1.1 row: ${cell}`);
  }
  if (clipMinSeconds >= clipMaxSeconds) {
    throw new Error(`arrival model: truncation bounds invalid (${clipMinSeconds} ≥ ${clipMaxSeconds}) in scale-baseline §1.1 row`);
  }

  return {
    muSeconds,
    sigmaSeconds,
    clipMinSeconds,
    clipMaxSeconds,
    seed: Number(seed[1]),
    classShare,
    windowCount,
    windowSeconds,
    effectiveSeconds: windowCount * windowSeconds,
    source: origin
  };
}

/**
 * Validate + normalize arrival parameters. Throws on anything invalid — the
 * arrival model is never guessed (Spec D23⑥).
 */
export function normalizeArrivalParams(params = {}) {
  const muSeconds = requirePositiveNumber(params.muSeconds, "muSeconds");
  const sigmaSeconds = requireNonNegativeNumber(params.sigmaSeconds, "sigmaSeconds");
  const clipMinSeconds = requirePositiveNumber(params.clipMinSeconds, "clipMinSeconds");
  const clipMaxSeconds = requirePositiveNumber(params.clipMaxSeconds, "clipMaxSeconds");
  if (clipMinSeconds >= clipMaxSeconds) {
    throw new Error(`arrival model: clipMinSeconds (${clipMinSeconds}) must be < clipMaxSeconds (${clipMaxSeconds})`);
  }
  const seed = requireInteger(params.seed, "seed");
  const share = params.classShare ?? {};
  if (typeof share !== "object" || Array.isArray(share)) {
    throw new Error("arrival model: classShare must be an object of class → share");
  }
  const classShare = {};
  let sum = 0;
  for (const [cls, value] of Object.entries(share)) {
    const s = finiteOrNull(value);
    if (s == null || s <= 0 || s > 1) {
      throw new Error(`arrival model: classShare.${cls} must be in (0,1], got ${JSON.stringify(value ?? null)}`);
    }
    classShare[cls] = s;
    sum += s;
  }
  if (Object.keys(classShare).length === 0) throw new Error("arrival model: classShare is empty");
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`arrival model: classShare must sum to 1, got ${sum}`);
  }
  return {
    muSeconds,
    sigmaSeconds,
    clipMinSeconds,
    clipMaxSeconds,
    seed,
    classShare,
    windowCount: Number(params.windowCount ?? 0) || null,
    windowSeconds: Number(params.windowSeconds ?? 0) || null,
    effectiveSeconds:
      finiteOrNull(params.effectiveSeconds) ??
      (params.windowCount && params.windowSeconds ? Number(params.windowCount) * Number(params.windowSeconds) : null),
    source: params.source ?? null
  };
}

/**
 * Seeded truncated-normal think-time generator (clipping at the configured
 * bounds, the model used by the reachability expectation μ).
 */
export function createArrivalModel(params = {}) {
  const normalized = normalizeArrivalParams(params);
  const random = mulberry32(normalized.seed);
  let drawn = 0;
  let clippedLow = 0;
  let clippedHigh = 0;
  return {
    params: normalized,
    nextThinkTimeSeconds() {
      const value = normalized.muSeconds + normalized.sigmaSeconds * gaussianFrom(random);
      drawn += 1;
      if (value < normalized.clipMinSeconds) {
        clippedLow += 1;
        return normalized.clipMinSeconds;
      }
      if (value > normalized.clipMaxSeconds) {
        clippedHigh += 1;
        return normalized.clipMaxSeconds;
      }
      return value;
    },
    stats() {
      return { drawn, clippedLow, clippedHigh };
    }
  };
}

/**
 * Build the SOAK arrival plan: one independent think-time stream per identity,
 * class assignment stratified per window so the configured class share holds
 * inside every window (and globally), never a uniform fixed-interval arrival.
 *
 * @param {{ arrival: object, identities: Array<{identityId: string, roleClass?: string}>,
 *           windows?: { count: number, seconds: number }, startAtMs?: number }} input
 */
export function generateArrivalPlan({ arrival, identities = [], windows = null, startAtMs = 0 } = {}) {
  const params = normalizeArrivalParams(arrival);
  const windowCount = Number(windows?.count ?? params.windowCount ?? SOAK_DEFAULT_WINDOW_COUNT);
  const windowSeconds = Number(windows?.seconds ?? params.windowSeconds ?? SOAK_DEFAULT_WINDOW_SECONDS);
  if (!Number.isInteger(windowCount) || windowCount <= 0) {
    throw new Error(`arrival plan: window count must be a positive integer, got ${JSON.stringify(windowCount ?? null)}`);
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error(`arrival plan: window seconds must be positive, got ${JSON.stringify(windowSeconds ?? null)}`);
  }
  const effectiveSeconds = windowCount * windowSeconds;
  const model = createArrivalModel(params);

  const raw = [];
  for (const identity of identities) {
    const identityId = identity?.identityId;
    if (typeof identityId !== "string" || identityId.length === 0) {
      throw new Error("arrival plan: every identity needs a non-empty identityId");
    }
    let offsetSeconds = 0;
    for (;;) {
      const thinkSeconds = model.nextThinkTimeSeconds();
      offsetSeconds += thinkSeconds;
      if (offsetSeconds >= effectiveSeconds) break;
      raw.push({
        identityId,
        roleClass: identity.roleClass ?? null,
        thinkTimeMs: thinkSeconds * 1000,
        offeredOffsetMs: offsetSeconds * 1000
      });
    }
  }

  // Stratified class assignment inside each window (largest-remainder style),
  // so a window never loses a class because of sampling noise.
  const windowMs = windowSeconds * 1000;
  const classes = Object.keys(params.classShare);
  const byWindow = new Map();
  for (const entry of raw) {
    const index = Math.floor(entry.offeredOffsetMs / windowMs);
    if (!byWindow.has(index)) byWindow.set(index, []);
    byWindow.get(index).push(entry);
  }
  for (const [, entries] of byWindow) {
    const accumulator = Object.fromEntries(classes.map((cls) => [cls, 0]));
    for (const entry of entries) {
      let best = classes[0];
      for (const cls of classes) {
        accumulator[cls] += params.classShare[cls];
        if (accumulator[cls] > accumulator[best]) best = cls;
      }
      accumulator[best] -= 1;
      entry.budgetClass = best;
    }
  }

  raw.sort((a, b) => a.offeredOffsetMs - b.offeredOffsetMs || a.identityId.localeCompare(b.identityId));
  const arrivals = raw.map((entry, index) => ({
    arrivalId: `soak-arrival-${String(index + 1).padStart(5, "0")}`,
    identityId: entry.identityId,
    roleClass: entry.roleClass,
    budgetClass: entry.budgetClass,
    thinkTimeMs: entry.thinkTimeMs,
    offeredOffsetMs: entry.offeredOffsetMs,
    offeredAtMs: startAtMs + entry.offeredOffsetMs,
    windowIndex: Math.floor(entry.offeredOffsetMs / windowMs)
  }));

  return {
    arrivals,
    arrivalModel: {
      ...params,
      windowCount,
      windowSeconds,
      effectiveSeconds
    },
    modelStats: model.stats(),
    windows: { count: windowCount, seconds: windowSeconds },
    effectiveSeconds,
    startAtMs
  };
}

/**
 * Observed arrival distribution for the evidence record (Spec §5.4: the run
 * records the parameters *and* the actual distribution).
 */
export function summarizeArrivalDistribution(plan) {
  const arrivals = plan?.arrivals ?? [];
  const byIdentity = new Map();
  for (const arrival of arrivals) {
    if (!byIdentity.has(arrival.identityId)) byIdentity.set(arrival.identityId, []);
    byIdentity.get(arrival.identityId).push(arrival);
  }
  const thinkTimesMs = [];
  for (const [, entries] of byIdentity) {
    entries.sort((a, b) => a.offeredAtMs - b.offeredAtMs);
    let previous = plan.startAtMs ?? 0;
    for (const entry of entries) {
      thinkTimesMs.push(entry.offeredAtMs - previous);
      previous = entry.offeredAtMs;
    }
  }
  const sorted = [...thinkTimesMs].sort((a, b) => a - b);
  const mean = sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : null;
  const variance = sorted.length
    ? sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, sorted.length - 1)
    : null;
  const perClass = {};
  for (const arrival of arrivals) {
    const cls = arrival.budgetClass ?? "(unassigned)";
    perClass[cls] = (perClass[cls] ?? 0) + 1;
  }
  return {
    sampleCount: sorted.length,
    meanMs: mean,
    sdMs: variance == null ? null : Math.sqrt(variance),
    minMs: sorted.length ? sorted[0] : null,
    maxMs: sorted.length ? sorted[sorted.length - 1] : null,
    p50Ms: sorted.length ? nearestRank(sorted, 50) : null,
    p90Ms: sorted.length ? nearestRank(sorted, 90) : null,
    p95Ms: sorted.length ? nearestRank(sorted, 95) : null,
    perClassCount: perClass,
    perClassShare: Object.fromEntries(
      Object.entries(perClass).map(([cls, count]) => [cls, arrivals.length ? count / arrivals.length : 0])
    ),
    clippedLowCount: plan?.modelStats?.clippedLow ?? 0,
    clippedHighCount: plan?.modelStats?.clippedHigh ?? 0,
    thinkTimesMs
  };
}

/**
 * Judge the observed arrival distribution against the configured truncated
 * normal. Uniform arrivals (the negative control) are detected explicitly and
 * never silently accepted.
 */
export function judgeArrivalModel({ arrival, thinkTimesMs = [] } = {}) {
  const params = normalizeArrivalParams(arrival);
  const samples = (thinkTimesMs ?? []).map((v) => Number(v) / 1000).filter((v) => Number.isFinite(v));
  const reasons = [];
  if (samples.length === 0) {
    return { verdict: "FAIL", reasons: ["arrival model: no observed think times"], ksTruncated: null, ksUniform: null, observed: null };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const ksTruncated = ksDistance(sorted, (x) => clippedNormalCdf(x, params));
  const ksUniform = ksDistance(sorted, (x) => uniformCdf(x, params));
  const moments = clippedNormalMoments(params);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const variance = sorted.reduce((sum, v) => sum + (v - mean) ** 2, 0) / Math.max(1, sorted.length - 1);
  const sd = Math.sqrt(variance);
  const standardError = params.sigmaSeconds / Math.sqrt(sorted.length);
  const meanTolerance = Math.max(3 * standardError, 0.05 * params.muSeconds);

  if (ksUniform < ksTruncated) {
    reasons.push(
      `arrival model: observed arrivals match a uniform schedule (KS uniform ${ksUniform.toFixed(3)} < ` +
        `KS truncated-normal ${ksTruncated.toFixed(3)}); the configured truncated normal ` +
        `μ=${params.muSeconds}s σ=${params.sigmaSeconds}s was not used`
    );
  }
  if (params.sigmaSeconds > 0 && sd < 0.25 * params.sigmaSeconds) {
    reasons.push(
      `arrival model: observed think times are near-constant (sd ${sd.toFixed(2)}s vs the configured ` +
        `σ=${params.sigmaSeconds}s); a fixed-interval uniform dispatch is not a normal arrival model (D23⑥)`
    );
  }
  if (ksTruncated > ARRIVAL_MODEL_KS_TOLERANCE) {
    reasons.push(
      `arrival model: observed distribution deviates from the configured truncated normal (KS ${ksTruncated.toFixed(3)} > ${ARRIVAL_MODEL_KS_TOLERANCE})`
    );
  }
  if (Math.abs(mean - moments.meanSeconds) > meanTolerance) {
    reasons.push(
      `arrival model: observed mean ${mean.toFixed(2)}s differs from the model mean ${moments.meanSeconds.toFixed(2)}s (tolerance ${meanTolerance.toFixed(2)}s)`
    );
  }

  return {
    verdict: reasons.length ? "FAIL" : "PASS",
    reasons,
    ksTruncated,
    ksUniform,
    tolerance: ARRIVAL_MODEL_KS_TOLERANCE,
    observed: { sampleCount: sorted.length, meanSeconds: mean, sdSeconds: sd },
    model: { ...moments, meanToleranceSeconds: meanTolerance }
  };
}

// ---------------------------------------------------------------------------
// window statistics and role fairness
// ---------------------------------------------------------------------------

/**
 * Group turns into D23 window records (windowIndex×budgetClass) for
 * judgeWindowsByClass. A turn belongs to the window it was *offered* in;
 * turns still in flight at the window end drain into that same window.
 */
export function buildWindowRecords({ turns = [], windows = null, startAtMs = 0, drainMs = SOAK_DRAIN_MS } = {}) {
  const windowCount = Number(windows?.count ?? SOAK_DEFAULT_WINDOW_COUNT);
  const windowSeconds = Number(windows?.seconds ?? SOAK_DEFAULT_WINDOW_SECONDS);
  const windowMs = windowSeconds * 1000;
  const records = [];
  for (let index = 0; index < windowCount; index += 1) {
    const startMs = startAtMs + index * windowMs;
    const endMs = startMs + windowMs;
    const windowTurns = turns.filter((turn) => turn.windowIndex === index);
    const perClassStats = {};
    for (const cls of new Set(windowTurns.map((turn) => turn.budgetClass))) {
      const classTurns = windowTurns.filter((turn) => turn.budgetClass === cls);
      const latencies = classTurns
        .map((turn) => finiteOrNull(turn.wallClockMs))
        .filter((value) => value != null);
      perClassStats[cls] = {
        n: classTurns.length,
        medianMs: latencies.length ? median(latencies) : null,
        p95Ms: latencies.length >= 20 ? nearestRank(latencies, 95) : "not_estimable",
        maxMs: latencies.length ? Math.max(...latencies) : null,
        errors: classTurns.filter((turn) => turn.outcome != null && turn.outcome !== "correct").length,
        timeouts: classTurns.filter((turn) => turn.timedOut === true).length,
        dispatchedCount: classTurns.filter((turn) => turn.dispatched !== false).length,
        undispatchedCount: classTurns.filter((turn) => turn.dispatched === false).length
      };
    }
    records.push({
      windowIndex: index,
      startMs,
      endMs,
      windowSeconds,
      offeredCount: windowTurns.length,
      dispatchedCount: windowTurns.filter((turn) => turn.dispatched !== false).length,
      undispatchedCount: windowTurns.filter((turn) => turn.dispatched === false).length,
      drainMs,
      turns: windowTurns,
      perClassStats
    });
  }
  return records;
}

/**
 * Role fairness over the whole effective window (Spec §5.3): per-role-group
 * P50/P95/max, no role starvation, no unexpected denial, no cross-role leak,
 * and the slowest role group must stay within 2× + 2s of the fastest one.
 */
export function judgeRoleFairness(turns = []) {
  const completed = turns.filter((turn) => turn.dispatched !== false);
  const groups = new Map();
  for (const turn of completed) {
    const role = turn.roleClass ?? "(unknown)";
    if (!groups.has(role)) groups.set(role, { role, count: 0, latencies: [], identities: new Set() });
    const group = groups.get(role);
    group.count += 1;
    group.identities.add(turn.identityId);
    const latency = finiteOrNull(turn.wallClockMs);
    if (latency != null) group.latencies.push(latency);
  }
  const summaries = [...groups.values()].map((group) => {
    const sorted = [...group.latencies].sort((a, b) => a - b);
    return {
      role: group.role,
      count: group.count,
      identityCount: group.identities.size,
      p50Ms: sorted.length ? nearestRank(sorted, 50) : null,
      p95Ms: sorted.length ? nearestRank(sorted, 95) : null,
      maxMs: sorted.length ? sorted[sorted.length - 1] : null
    };
  });
  const reasons = [];
  const denials = completed.filter((turn) => turn.outcome === "unexpected_deny" || turn.outcome === "denied");
  if (denials.length) reasons.push(`role fairness: ${denials.length} unexpected denial(s) inside the effective window`);
  const leaks = completed.filter((turn) => turn.leaked === true || turn.outcome === "cross_role_leak");
  if (leaks.length) reasons.push(`role fairness: ${leaks.length} cross-role leak(s) inside the effective window`);

  const identityCounts = new Map();
  for (const turn of completed) {
    identityCounts.set(turn.identityId, (identityCounts.get(turn.identityId) ?? 0) + 1);
  }
  const starvedIdentities = [...identityCounts.entries()].filter(([, count]) => count === 0).map(([id]) => id);
  if (starvedIdentities.length) {
    reasons.push(`role fairness: ${starvedIdentities.length} identity/identities completed no turn (role starvation)`);
  }

  const withP95 = summaries.filter((summary) => typeof summary.p95Ms === "number");
  if (withP95.length >= 2) {
    const fastest = Math.min(...withP95.map((summary) => summary.p95Ms));
    const slowest = Math.max(...withP95.map((summary) => summary.p95Ms));
    if (slowest > fastest * 2 + 2000) {
      reasons.push(
        `role fairness: slowest role p95 ${slowest}ms exceeds fastest role p95 ${fastest}ms × 2 + 2000ms (§5.3)`
      );
    }
  }
  return { fair: reasons.length === 0, reasons, groups: summaries };
}

// ---------------------------------------------------------------------------
// SOAK orchestration
// ---------------------------------------------------------------------------

function defaultClock() {
  return { now: () => Date.now() };
}

function blocked(reason, problems, extra = {}) {
  return {
    scenarioId: SOAK_SCENARIO_ID,
    verdict: "BLOCKED",
    blockedReason: reason,
    reasons: problems,
    turns: [],
    windowRecords: [],
    offeredCount: 0,
    dispatchedCount: 0,
    undispatchedCount: 0,
    unfinishedCount: 0,
    ...extra
  };
}

/**
 * SOAK orchestration (Spec D18／D23, §5.4).
 *
 * Order of business:
 *   1. dependency guards (D19/D21⑦) → BLOCKED, never a degraded plan;
 *   2. sample reachability (D23③) → BLOCKED sample_unreachable, never fewer
 *      windows or identities;
 *   3. identity count (§5.4) → FAIL when the profile's 50 identities are not
 *      the ones in the window;
 *   4. effective-window coverage (§5.4) → FAIL when the window is shortened;
 *   5. arrival-model check → FAIL when the arrivals are not the configured
 *      truncated normal (uniform arrival negative control);
 *   6. dispatch every planned arrival exactly once — a slow system delays the
 *      dispatch (dispatchLagMs) but never merges or drops an arrival; an
 *      arrival that cannot be dispatched inside the lag budget is counted as
 *      undispatched and fails;
 *   7. window statistics → judgeWindowsByClass (D23);
 *   8. role fairness over the whole effective window (§5.3);
 *   9. long-follow chains executed inside the same run — the chain evidence is
 *      produced here and judged by the LONG_FOLLOW scenario (D20 reuse), so a
 *      chain defect is reported as `chainVerdict`/`chainReasons` next to the
 *      SOAK verdict instead of being folded into it.
 *
 * @param {object} options
 * @returns {Promise<object>} the run record (evidence shape)
 */
export async function runSoakScenario(options = {}) {
  const {
    runId = null,
    arrival = null,
    arrivalPlan = null,
    identities = [],
    windows = { count: SOAK_DEFAULT_WINDOW_COUNT, seconds: SOAK_DEFAULT_WINDOW_SECONDS },
    minEffectiveSeconds = SOAK_MIN_EFFECTIVE_SECONDS,
    requiredIdentityCount = SOAK_REQUIRED_IDENTITY_COUNT,
    drainMs = SOAK_DRAIN_MS,
    maxDispatchLagMs = 0,
    hostSupportsMultiTurn = true,
    hostConcurrencyQuota = null,
    sessionFactory = null,
    turnExecutor = null,
    clock = defaultClock(),
    phases = { preparationSeconds: 0, warmupSeconds: 0, cleanupSeconds: 0 },
    chainOptions = null,
    budgets = null,
    lane = "agent"
  } = options;

  const windowCount = Number(windows?.count ?? SOAK_DEFAULT_WINDOW_COUNT);
  const windowSeconds = Number(windows?.seconds ?? SOAK_DEFAULT_WINDOW_SECONDS);
  const effectiveWindowSeconds = windowCount * windowSeconds;
  const identityCount = identities.length;

  // 1. dependency guards (D19 / D21⑦) ---------------------------------------
  if (hostSupportsMultiTurn === false) {
    return blocked("host_multi_turn_unsupported", [
      "host does not support multi-turn chains; SOAK/LONG_FOLLOW stay BLOCKED (D19), no self-made questions and no direct-script downgrade"
    ], { runId, effectiveWindowSeconds, identityCount });
  }
  if (hostConcurrencyQuota != null && Number(hostConcurrencyQuota) < identityCount) {
    return blocked("provider_unavailable", [
      `host concurrency quota ${hostConcurrencyQuota} < ${identityCount} identities; SOAK is BLOCKED (D21⑦), the identity count is never reduced`
    ], { runId, effectiveWindowSeconds, identityCount });
  }
  if (!arrival && !arrivalPlan) {
    return blocked("arrival_model_missing", [
      "arrival model parameters are missing; they must be read from scale-baseline §1.1 (D23⑥)"
    ], { runId, effectiveWindowSeconds, identityCount });
  }
  if (identityCount === 0) {
    return blocked("identities_missing", ["no independent agent identities were provided for the SOAK window"], {
      runId,
      effectiveWindowSeconds,
      identityCount
    });
  }

  // 2. sample reachability (D23③) ------------------------------------------
  //    Checked before anything else that would let the run start: an
  //    unreachable plan is BLOCKED, and the window count / identity count are
  //    never reduced to make it reachable.
  const reachability = checkSampleReachability({
    arrival,
    identities,
    windows: { count: windowCount, seconds: windowSeconds },
    longChainIdentities: chainOptions?.chainIdentityCount ?? chainOptions?.executeCount ?? 0
  });
  if (!reachability.ok) {
    return blocked("sample_unreachable", reachability.problems, {
      runId,
      effectiveWindowSeconds,
      identityCount,
      reachability
    });
  }

  // 3. identity count (§5.4 / scale-baseline §1.1) -------------------------
  if (identityCount !== requiredIdentityCount) {
    return {
      scenarioId: SOAK_SCENARIO_ID,
      runId,
      verdict: "FAIL",
      blockedReason: null,
      reasons: [
        `identity count ${identityCount} != required ${requiredIdentityCount} (§5.4 / scale-baseline §1.1)`
      ],
      effectiveWindowSeconds,
      minEffectiveSeconds,
      windows: { count: windowCount, seconds: windowSeconds },
      identityCount,
      phases,
      turns: [],
      windowRecords: [],
      offeredCount: 0,
      dispatchedCount: 0,
      undispatchedCount: 0,
      unfinishedCount: 0
    };
  }

  // 4. effective window coverage (§5.4) ------------------------------------
  if (effectiveWindowSeconds < minEffectiveSeconds) {
    return {
      scenarioId: SOAK_SCENARIO_ID,
      runId,
      verdict: "FAIL",
      blockedReason: null,
      reasons: [
        `effective window ${effectiveWindowSeconds}s < ${minEffectiveSeconds}s (§5.4); preparation/warmup/cleanup time never counts as effective window`
      ],
      effectiveWindowSeconds,
      minEffectiveSeconds,
      windows: { count: windowCount, seconds: windowSeconds },
      identityCount,
      phases,
      turns: [],
      windowRecords: [],
      offeredCount: 0,
      dispatchedCount: 0,
      undispatchedCount: 0,
      unfinishedCount: 0
    };
  }

  // 5. arrival plan + arrival-model check ---------------------------------
  let plan = arrivalPlan;
  if (!plan) {
    plan = generateArrivalPlan({ arrival, identities, windows: { count: windowCount, seconds: windowSeconds } });
  }
  const distribution = summarizeArrivalDistribution(plan);
  const effectiveArrival = arrival ?? plan?.arrivalModel ?? null;
  if (!effectiveArrival) {
    return blocked("arrival_model_missing", [
      "arrival model parameters are missing; they must be read from scale-baseline §1.1 (D23⑥)"
    ], { runId, effectiveWindowSeconds, identityCount });
  }
  let arrivalCheck;
  try {
    arrivalCheck = judgeArrivalModel({ arrival: effectiveArrival, thinkTimesMs: distribution.thinkTimesMs });
  } catch (error) {
    return blocked("arrival_model_invalid", [
      `arrival model parameters are invalid: ${error instanceof Error ? error.message : String(error)}`
    ], { runId, effectiveWindowSeconds, identityCount });
  }
  if (arrivalCheck.verdict === "FAIL") {
    return {
      scenarioId: SOAK_SCENARIO_ID,
      runId,
      verdict: "FAIL",
      blockedReason: null,
      reasons: arrivalCheck.reasons,
      effectiveWindowSeconds,
      identityCount,
      windows: { count: windowCount, seconds: windowSeconds },
      phases,
      arrivalModel: plan.arrivalModel,
      arrivalDistribution: distribution,
      arrivalModelCheck: arrivalCheck,
      turns: [],
      windowRecords: [],
      offeredCount: plan.arrivals.length,
      dispatchedCount: 0,
      undispatchedCount: plan.arrivals.length,
      unfinishedCount: 0
    };
  }

  // 6. dispatch ------------------------------------------------------------
  const sessions = new Map();
  const identityNextFreeAt = new Map();
  const turns = [];
  let dispatchedCount = 0;
  let undispatchedCount = 0;
  let unfinishedCount = 0;
  const startAtMs = plan.startAtMs ?? 0;

  for (const arrivalEntry of plan.arrivals) {
    const offeredAtMs = arrivalEntry.offeredAtMs;
    const nextFreeAt = identityNextFreeAt.get(arrivalEntry.identityId);
    const dispatchedAtMs = nextFreeAt == null ? offeredAtMs : Math.max(offeredAtMs, nextFreeAt);
    const dispatchLagMs = dispatchedAtMs - offeredAtMs;
    const base = {
      scenarioId: SOAK_SCENARIO_ID,
      attemptId: `soak-${runId ?? "run"}-${arrivalEntry.arrivalId}`,
      identityId: arrivalEntry.identityId,
      roleClass: arrivalEntry.roleClass,
      budgetClass: arrivalEntry.budgetClass,
      windowIndex: arrivalEntry.windowIndex,
      offeredAtMs,
      dispatchedAtMs: null,
      endedAtMs: null,
      dispatchLagMs,
      wallClockMs: null,
      outcome: null,
      timedOut: false,
      dispatched: false
    };
    if (dispatchLagMs > maxDispatchLagMs) {
      undispatchedCount += 1;
      turns.push({ ...base, outcome: "not_dispatched" });
      continue;
    }
    if (!sessionFactory || typeof turnExecutor !== "function") {
      return blocked("execution_engine_missing", [
        "SOAK execution requires an injected session factory and turn executor; the real execution path is not run by this module"
      ], { runId, effectiveWindowSeconds, identityCount });
    }
    if (!sessions.has(arrivalEntry.identityId)) {
      sessions.set(arrivalEntry.identityId, await sessionFactory(arrivalEntry.identityId));
    }
    const session = sessions.get(arrivalEntry.identityId);
    let result;
    try {
      result = await turnExecutor({
        scenarioId: SOAK_SCENARIO_ID,
        runId,
        attemptId: base.attemptId,
        identityId: arrivalEntry.identityId,
        roleClass: arrivalEntry.roleClass,
        budgetClass: arrivalEntry.budgetClass,
        windowIndex: arrivalEntry.windowIndex,
        offeredAtMs,
        dispatchedAtMs,
        session,
        clock
      });
    } catch (error) {
      result = { outcome: "crash", error: error instanceof Error ? error.message : String(error) };
    }
    const reported = finiteOrNull(result?.wallClockMs ?? result?.turnWallClockMs);
    const wallClockMs = reported ?? Math.max(0, clock.now() - dispatchedAtMs);
    const endedAtMs = dispatchedAtMs + wallClockMs;
    identityNextFreeAt.set(arrivalEntry.identityId, endedAtMs);
    dispatchedCount += 1;
    const outcome = result?.outcome ?? null;
    if (outcome == null || outcome === "pending") unfinishedCount += 1;
    turns.push({
      ...base,
      dispatched: true,
      dispatchedAtMs,
      endedAtMs,
      wallClockMs,
      outcome: outcome ?? "pending",
      timedOut: result?.timedOut === true,
      processId: result?.processId ?? session?.processId ?? null,
      hostSessionId: result?.hostSessionId ?? session?.hostSessionId ?? null
    });
  }

  // 7. window statistics + D23 judgment ------------------------------------
  const windowRecords = buildWindowRecords({
    turns,
    windows: { count: windowCount, seconds: windowSeconds },
    startAtMs,
    drainMs
  });
  const windowJudgement = judgeWindowsByClass(windowRecords, {
    lane,
    budgets: budgets ?? {
      simple: ABSOLUTE_BUDGETS.agent.simple.warmP95Ms,
      complex: ABSOLUTE_BUDGETS.agent.complex.warmP95Ms
    },
    drainMs
  });

  // 8. role fairness --------------------------------------------------------
  const fairness = judgeRoleFairness(turns);

  const reasons = [];
  if (windowJudgement.verdict === "FAIL") reasons.push(...windowJudgement.reasons);
  if (windowJudgement.verdict === "BLOCKED") reasons.push(...windowJudgement.reasons);
  if (!fairness.fair) reasons.push(...fairness.reasons);
  if (undispatchedCount > 0) {
    reasons.push(
      `${undispatchedCount} planned arrival(s) were never dispatched; planned arrivals are never silently merged or dropped (D23§4.2)`
    );
  }
  if (unfinishedCount > 0) {
    reasons.push(`${unfinishedCount} dispatched turn(s) never reached a terminal outcome`);
  }
  const identitiesWithoutTurn = identities
    .map((identity) => identity?.identityId)
    .filter((identityId) => !turns.some((turn) => turn.identityId === identityId && turn.dispatched !== false));
  if (identitiesWithoutTurn.length) {
    reasons.push(
      `${identitiesWithoutTurn.length} identity/identities completed no turn inside the effective window (every identity must complete at least one round)`
    );
  }

  // 9. long-follow chains executed inside the same run (D20) ---------------
  // The chain evidence is produced here and judged by the LONG_FOLLOW
  // scenario (D20 reuse); a chain defect must not silently turn a SOAK
  // window verdict into something it is not, so the chain judgement is
  // reported next to the SOAK verdict instead of being merged into it.
  let chainResult = null;
  if (chainOptions) {
    const chainInstances =
      chainOptions.instances ??
      (chainOptions.identities ? planChainInstances({ pack: chainOptions.pack, identities: chainOptions.identities, runId }).instances : []);
    chainResult = await executeChainInstances({
      ...chainOptions,
      instances: chainInstances,
      runId,
      clock
    });
  }
  const chainReasons = [
    ...(chainResult?.reasons ?? []),
    ...(chainResult?.judgement && chainResult.judgement.verdict !== "PASS" ? chainResult.judgement.reasons : [])
  ];

  const verdict = reasons.length ? "FAIL" : "PASS";
  return {
    scenarioId: SOAK_SCENARIO_ID,
    runId,
    verdict,
    blockedReason: null,
    reasons,
    effectiveWindowSeconds,
    minEffectiveSeconds,
    windows: { count: windowCount, seconds: windowSeconds },
    phases: {
      preparationSeconds: phases?.preparationSeconds ?? 0,
      warmupSeconds: phases?.warmupSeconds ?? 0,
      cleanupSeconds: phases?.cleanupSeconds ?? 0
    },
    identityCount,
    identityIds: identities.map((identity) => identity?.identityId),
    arrivalModel: plan.arrivalModel,
    arrivalDistribution: distribution,
    arrivalModelCheck: arrivalCheck,
    reachability,
    offeredCount: plan.arrivals.length,
    dispatchedCount,
    undispatchedCount,
    unfinishedCount,
    turns,
    windowRecords,
    windowJudgement,
    fairness,
    chains: chainResult?.chains ?? [],
    chainJudgement: chainResult?.judgement ?? null,
    chainVerdict: chainResult?.judgement?.verdict ?? null,
    chainReasons,
    plannedChainCount: chainResult?.plannedChainCount ?? null,
    requiredChains: chainResult?.requiredChains ?? null,
    validChains: chainResult?.judgement?.validChains ?? null
  };
}

// ---------------------------------------------------------------------------
// LONG_FOLLOW chains (D20 / §5.4)
// ---------------------------------------------------------------------------

/** Chain instance identity: template × identity × runId (Spec D20). */
export function chainInstanceKey(templateId, identityId, runId) {
  return `${templateId}×${identityId}×${runId}`;
}

/**
 * De-duplication register for chain instances. The same (template, identity,
 * runId) may only be executed once; different identities running the same
 * template are legal.
 */
export function createChainInstanceRegistry() {
  const seen = new Map();
  return {
    register(templateId, identityId, runId) {
      const key = chainInstanceKey(templateId, identityId, runId);
      if (seen.has(key)) {
        return { accepted: false, key, reason: "chain_instance_duplicate" };
      }
      seen.set(key, { templateId, identityId, runId });
      return { accepted: true, key, reason: null };
    },
    has(templateId, identityId, runId) {
      return seen.has(chainInstanceKey(templateId, identityId, runId));
    },
    get size() {
      return seen.size;
    },
    keys() {
      return [...seen.keys()];
    }
  };
}

/**
 * Load + validate the P1-79 long-followup question pack (read-only).
 * Missing pack / invalid pack → BLOCKED (D19); never a self-made question.
 */
export function loadLongFollowPack(packPath = DEFAULT_PACK_PATH) {
  const file = path.isAbsolute(packPath) ? packPath : path.resolve(REPO_ROOT, packPath);
  if (!existsSync(file)) {
    return {
      ok: false,
      blockedReason: "missing_question_pack",
      problems: [`long-follow question pack not found: ${file} (D19)`],
      pack: null,
      digest: null
    };
  }
  let pack;
  try {
    pack = loadQuestionPack(file);
  } catch (error) {
    return {
      ok: false,
      blockedReason: "invalid_question_pack",
      problems: [`long-follow question pack cannot be read: ${error instanceof Error ? error.message : String(error)}`],
      pack: null,
      digest: null
    };
  }
  const validation = validateQuestionPack(pack);
  if (!validation.ok) {
    return {
      ok: false,
      blockedReason: "invalid_question_pack",
      problems: validation.problems,
      pack: null,
      digest: validation.digest ?? null
    };
  }
  return { ok: true, blockedReason: null, problems: [], pack, digest: validation.digest };
}

/**
 * Bind a chain template to every identity (one planned chain instance per
 * identity slot). Templates declare the role class they bind to; identities
 * without a matching template cannot carry a chain and are reported.
 */
export function planChainInstances({ pack, identities = [], runId = null } = {}) {
  const cases = Array.isArray(pack?.cases) ? pack.cases : [];
  const instances = [];
  const unplanned = [];
  for (const identity of identities) {
    const identityId = identity?.identityId;
    if (typeof identityId !== "string" || identityId.length === 0) {
      unplanned.push({ identityId: identityId ?? null, reason: "identity_without_id" });
      continue;
    }
    const roleClass = identity?.roleClass ?? null;
    const template = cases.find((chain) => chain?.identity === roleClass);
    if (!template) {
      unplanned.push({ identityId, reason: "no_template_for_role_class", roleClass });
      continue;
    }
    instances.push({
      chainId: chainInstanceKey(template.id, identityId, runId),
      templateId: template.id,
      identityId,
      roleClass,
      runId
    });
  }
  return {
    instances,
    unplanned,
    plannedChainCount: identities.length,
    templates: cases.map((chain) => ({ id: chain.id, identity: chain.identity, budgetClass: chain.budgetClass }))
  };
}

/**
 * Execute the planned chain instances. Every chain runs inside one host
 * process and one host session, turns are executed in `turnIndex` order, and a
 * chain instance may only be executed once (the registry rejects the second
 * attempt before it runs).
 */
export async function executeChainInstances({
  pack = null,
  instances = [],
  plannedChainCount = null,
  executeCount = null,
  runId = null,
  sessionFactory = null,
  turnExecutor = null,
  clock = defaultClock(),
  registry = createChainInstanceRegistry(),
  expectedPackDigest = null,
  minTotalTurns = LONG_FOLLOW_MIN_TOTAL_TURNS,
  minRatio = LONG_FOLLOW_CHAIN_RATIO,
  hostSupportsMultiTurn = true
} = {}) {
  const reasons = [];
  const cases = Array.isArray(pack?.cases) ? pack.cases : [];
  const N = plannedChainCount ?? instances.length;
  const requiredChains = Math.ceil(minRatio * N);
  const limit = executeCount == null ? requiredChains : executeCount;
  const chains = [];
  let executed = 0;
  let rejected = 0;

  if (hostSupportsMultiTurn === false) {
    return {
      chains: [],
      registry,
      executed: 0,
      rejected: 0,
      reasons: ["host does not support multi-turn chains; LONG_FOLLOW stays BLOCKED (D19)"],
      plannedChainCount: N,
      requiredChains,
      judgement: null,
      blockedReason: "host_multi_turn_unsupported"
    };
  }

  for (const instance of instances.slice(0, limit)) {
    const registration = registry.register(instance.templateId, instance.identityId, runId);
    if (!registration.accepted) {
      rejected += 1;
      reasons.push(
        `chain instance ${registration.key} was executed twice in the same run; a chain instance may only run once (D20)`
      );
      continue;
    }
    const template = cases.find((chain) => chain?.id === instance.templateId);
    if (!template) {
      reasons.push(`chain template ${instance.templateId} is not part of the loaded question pack`);
      continue;
    }
    const mapped = mapOwnerBudgetClass(template.budgetClass);
    if (!mapped.ok) {
      reasons.push(`${instance.chainId}: ${mapped.problems.join("; ")}`);
      continue;
    }
    if (!sessionFactory || typeof turnExecutor !== "function") {
      reasons.push(`${instance.chainId}: chain execution requires an injected session factory and turn executor`);
      continue;
    }
    const session = await sessionFactory(instance.identityId);
    if (session?.supportsMultiTurn === false) {
      reasons.push(`${instance.chainId}: host session does not support multi-turn follow-ups (D19)`);
      continue;
    }
    const turns = [];
    for (const turn of template.turns ?? []) {
      let result;
      try {
        result = await turnExecutor({
          scenarioId: LONG_FOLLOW_SCENARIO_ID,
          runId,
          chainId: instance.chainId,
          templateId: instance.templateId,
          identityId: instance.identityId,
          roleClass: instance.roleClass,
          turnIndex: turn.turnIndex,
          dependsOnTurn: turn.dependsOnTurn ?? null,
          question: turn.text,
          oracle: turn.oracle,
          budgetClass: mapped.budgetClass,
          session,
          clock
        });
      } catch (error) {
        result = { outcome: "crash", error: error instanceof Error ? error.message : String(error) };
      }
      if (result?.skipped === true) {
        // the turn never happened — the chain loses a round and becomes invalid
        continue;
      }
      const reported = finiteOrNull(result?.wallClockMs ?? result?.turnWallClockMs);
      const wallClockMs = reported ?? 0;
      turns.push({
        turnIndex: Number.isInteger(result?.turnIndex) ? result.turnIndex : turn.turnIndex,
        processId: result?.processId ?? session?.processId ?? null,
        hostSessionId: result?.hostSessionId ?? session?.hostSessionId ?? null,
        outcome: result?.outcome ?? "correct",
        wallClockMs,
        budgetClass: mapped.budgetClass,
        cacheState: "warm",
        timedOut: result?.timedOut === true,
        questionRef: turn?.oracle?.ref ?? null
      });
    }
    chains.push({
      chainId: instance.chainId,
      templateId: instance.templateId,
      identityId: instance.identityId,
      roleClass: instance.roleClass,
      runId,
      packDigest: expectedPackDigest ?? pack?.packDigest ?? null,
      processId: session?.processId ?? null,
      hostSessionId: session?.hostSessionId ?? null,
      turns
    });
    executed += 1;
  }

  const judgement = judgeLongFollowChains(chains, {
    plannedChainCount: N,
    expectedPackDigest: expectedPackDigest ?? undefined,
    minTotalTurns,
    minRatio
  });

  return {
    chains,
    registry,
    executed,
    rejected,
    reasons,
    plannedChainCount: N,
    requiredChains,
    judgement,
    blockedReason: null
  };
}

/**
 * D20 reuse guard: chain evidence produced inside the SOAK run may only be
 * reused by LONG_FOLLOW when the run id, the pack digest and the candidate
 * fingerprint are identical.
 */
export function assertChainEvidenceReusable(chains = [], { runId = null, packDigest = null, fingerprint = null, sourceFingerprint = null } = {}) {
  const problems = [];
  if (!chains.length) problems.push("no chain evidence to reuse");
  if (runId != null) {
    for (const chain of chains) {
      if (chain.runId !== runId) problems.push(`chain ${chain.chainId} belongs to runId ${chain.runId}, not ${runId}`);
    }
  }
  if (packDigest != null) {
    for (const chain of chains) {
      if (chain.packDigest !== packDigest) {
        problems.push(`chain ${chain.chainId} packDigest ${chain.packDigest ?? "missing"} != ${packDigest}`);
      }
    }
  }
  if (fingerprint && sourceFingerprint) {
    const keys = Object.keys(fingerprint);
    for (const key of keys) {
      if (fingerprint[key] !== sourceFingerprint[key]) {
        problems.push(`fingerprint ${key} differs (${sourceFingerprint[key]} != ${fingerprint[key]}); the chain evidence is a separate run`);
      }
    }
  }
  return { ok: problems.length === 0, problems };
}

/**
 * LONG_FOLLOW orchestration (Spec D18／D20, §5.4).
 *
 * Either reuses the chain evidence produced by the SOAK run of the same
 * `runId` (no second round of ≥20-turn follow-ups) or executes its own
 * chains under a separate `runId`. Missing pack / digest mismatch /
 * unsupported host → BLOCKED (D19).
 */
export async function runLongFollowScenario(options = {}) {
  const {
    runId = null,
    packPath = null,
    pack = null,
    expectedPackDigest = null,
    identities = [],
    executeCount = null,
    sessionFactory = null,
    turnExecutor = null,
    clock = defaultClock(),
    reuseChains = null,
    reuseFingerprint = null,
    fingerprint = null,
    registry = null,
    hostSupportsMultiTurn = true,
    minRatio = LONG_FOLLOW_CHAIN_RATIO,
    minTotalTurns = LONG_FOLLOW_MIN_TOTAL_TURNS
  } = options;

  if (hostSupportsMultiTurn === false) {
    return blocked("host_multi_turn_unsupported", [
      "host does not support multi-turn chains; LONG_FOLLOW stays BLOCKED (D19)"
    ], { scenarioId: LONG_FOLLOW_SCENARIO_ID, runId });
  }

  // D20: reuse the SOAK run's chain evidence instead of a second long chain round.
  if (reuseChains) {
    const chains = reuseChains.chains ?? [];
    const reuseCheck = assertChainEvidenceReusable(chains, {
      runId,
      packDigest: expectedPackDigest,
      fingerprint,
      sourceFingerprint: reuseFingerprint
    });
    if (!reuseCheck.ok) {
      return blocked("chain_evidence_not_reusable", reuseCheck.problems, {
        scenarioId: LONG_FOLLOW_SCENARIO_ID,
        runId,
        chains
      });
    }
    const judgement = judgeLongFollowChains(chains, {
      plannedChainCount: reuseChains.plannedChainCount ?? chains.length,
      expectedPackDigest: expectedPackDigest ?? undefined,
      minTotalTurns,
      minRatio
    });
    return {
      scenarioId: LONG_FOLLOW_SCENARIO_ID,
      runId,
      verdict: judgement.verdict,
      blockedReason: null,
      reasons: judgement.reasons,
      reused: true,
      chains,
      chainJudgement: judgement,
      plannedChainCount: judgement.plannedChainCount,
      requiredChains: judgement.requiredChains,
      validChains: judgement.validChains
    };
  }

  // Independent run: the pack must exist, validate and match the expected digest.
  let loaded;
  if (pack) {
    const validation = validateQuestionPack(pack);
    loaded = validation.ok
      ? { ok: true, blockedReason: null, problems: [], pack, digest: validation.digest }
      : { ok: false, blockedReason: "invalid_question_pack", problems: validation.problems, pack: null, digest: null };
  } else {
    loaded = loadLongFollowPack(packPath ?? DEFAULT_PACK_PATH);
  }
  if (!loaded.ok) {
    return blocked(loaded.blockedReason, loaded.problems, {
      scenarioId: LONG_FOLLOW_SCENARIO_ID,
      runId,
      chains: []
    });
  }
  if (expectedPackDigest != null && loaded.digest !== expectedPackDigest) {
    return blocked("pack_digest_mismatch", [
      `long-follow question pack digest ${loaded.digest} != expected ${expectedPackDigest} (D19)`
    ], { scenarioId: LONG_FOLLOW_SCENARIO_ID, runId, chains: [] });
  }
  if (loaded.pack.cases.length < MIN_CHAINS) {
    return blocked("insufficient_chain_templates", [
      `long-follow question pack holds ${loaded.pack.cases.length} chain templates, need >= ${MIN_CHAINS} (D19)`
    ], { scenarioId: LONG_FOLLOW_SCENARIO_ID, runId, chains: [] });
  }

  const plan = planChainInstances({ pack: loaded.pack, identities, runId });
  if (!plan.instances.length) {
    return blocked("no_chain_instance_plannable", [
      `no chain template binds the role classes of the provided identities (${plan.unplanned
        .map((entry) => `${entry.identityId}:${entry.reason}`)
        .join(", ")}) (D19)`
    ], { scenarioId: LONG_FOLLOW_SCENARIO_ID, runId, chains: [] });
  }

  const result = await executeChainInstances({
    pack: loaded.pack,
    instances: plan.instances,
    plannedChainCount: plan.plannedChainCount,
    executeCount,
    runId,
    sessionFactory,
    turnExecutor,
    clock,
    registry: registry ?? createChainInstanceRegistry(),
    expectedPackDigest: loaded.digest,
    minTotalTurns,
    minRatio,
    hostSupportsMultiTurn
  });

  const reasons = [...result.reasons];
  if (result.judgement && result.judgement.verdict !== "PASS") reasons.push(...result.judgement.reasons);

  return {
    scenarioId: LONG_FOLLOW_SCENARIO_ID,
    runId,
    verdict: reasons.length ? (result.judgement?.verdict === "BLOCKED" ? "BLOCKED" : "FAIL") : "PASS",
    blockedReason: result.judgement?.verdict === "BLOCKED" ? "invalid_chain_evidence" : null,
    reasons,
    reused: false,
    packDigest: loaded.digest,
    chains: result.chains,
    chainJudgement: result.judgement,
    plannedChainCount: result.plannedChainCount,
    requiredChains: result.requiredChains,
    validChains: result.judgement?.validChains ?? 0,
    unplannedChainInstances: plan.unplanned
  };
}

// ---------------------------------------------------------------------------
// performance contract (read-only)
// ---------------------------------------------------------------------------

/** Read the performance contract yaml (read-only reference, never rewritten). */
export function loadPerformanceContract(contractPath = PERFORMANCE_CONTRACT_RELATIVE_PATH) {
  const file = path.isAbsolute(contractPath) ? contractPath : path.resolve(REPO_ROOT, contractPath);
  if (!existsSync(file)) throw new Error(`performance contract not found: ${file}`);
  return parseYaml(readFileSync(file, "utf8"));
}

/** Extract the SOAK / LONG_FOLLOW scenario definitions from the contract. */
export function readSoakScenarioContract(contract = null) {
  const doc = contract ?? loadPerformanceContract();
  const scenarios = Array.isArray(doc?.scenarios) ? doc.scenarios : [];
  const soak = scenarios.find((scenario) => scenario?.scenarioId === SOAK_SCENARIO_ID) ?? null;
  const longFollow = scenarios.find((scenario) => scenario?.scenarioId === LONG_FOLLOW_SCENARIO_ID) ?? null;
  return {
    soak,
    longFollow,
    longFollowUpPackRef: doc?.longFollowUpPackRef ?? null,
    scaleBaselineRef: doc?.scaleBaselineRef ?? null
  };
}
