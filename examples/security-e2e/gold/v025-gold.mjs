#!/usr/bin/env node
// v0.25 mainline gold (J25-01) — the high-frequency question and its natural
// follow-up, computed INDEPENDENTLY from the synthetic fixture.
//
// This module is the gold side of W1-6. It follows the shape of
// compute-gold.mjs (GOLD_CONTRACT / generateDataset / computeGold -> .questions)
// so the runner and the evidence collectors can treat it like every other gold
// artifact, but the aggregation below is written from the fixture semantics
// rather than imported from compute-gold.mjs: the mainline's typed answer must
// be computable without the Agent, and a second, independent implementation is
// what makes that checkable.
//
//   node examples/security-e2e/gold/v025-gold.mjs --seed <hex>
//
// prints the computed questions. Nothing here ever reaches an Agent prompt, the
// model-visible context, the Wiki, the Skill, the semantic assets, the MCP
// config or a tool input (Spec §4.1-4 防泄露).
//
// The fixture itself is NOT re-implemented: it comes from compute-gold.mjs so
// the gold and the seeded rows are guaranteed to describe the same data.

import { generateDataset as generateFixtureDataset } from "./compute-gold.mjs";

export const GOLD_CONTRACT = "lucy-v025-mainline-gold-v1";
export const DATASET_AS_OF = "2026-09-28";

/**
 * One typed gold question.
 * @typedef {Object} V025Question
 * @property {string} question
 * @property {{type: string, cents: number, toleranceCents: number, currency: string}} expected
 * @property {Record<string, unknown>} queryKey
 * @property {string} definition
 * @property {string[]} definitionPatterns
 * @property {Record<string, unknown>} nullZeroSemantics
 * @property {Record<string, unknown>} wrongAnswers
 * @property {string[]} allowedCanaries
 * @property {string[]} forbiddenCanaries
 */

/**
 * The computed v0.25 mainline gold.
 * @typedef {Object} V025Gold
 * @property {string} contract
 * @property {string|null} seed
 * @property {string} asOf
 * @property {Record<string, number>} rowCounts
 * @property {Record<string, string|null>} window
 * @property {Record<string, V025Question>} questions
 */

/** The mainline's two questions, in the order they are asked. The second one
 *  is a natural anaphoric follow-up in the SAME client session. */
export const MAINLINE_QUESTIONS = Object.freeze(["Q-J25-CAC-28D", "Q-J25-CAC-7D"]);
/** @type {"Q-J25-CAC-28D"} */
export const MAINLINE_FIRST_QUESTION = "Q-J25-CAC-28D";
/** @type {"Q-J25-CAC-7D"} */
export const MAINLINE_FOLLOW_UP = "Q-J25-CAC-7D";

/**
 * The explicit NULL / 0 semantics of the governed metric. They are part of the
 * typed gold because "the answer is a number" is not enough: a runner that
 * treats NULL as 0, or that reports 0 for an undefined ratio, must fail.
 */
export const NULL_ZERO_SEMANTICS = Object.freeze({
  null: Object.freeze({
    rule: "new_customers IS NULL 的行不计入分子，也不计入分母（其 spend_cents 同样不计入）",
    rationale: "NULL 表示“未知”，不是 0；把它当 0 会同时污染分子与分母",
    wrongAnswers: Object.freeze(["把 NULL 当作 0 计入分母", "把 NULL 行的 spend 计入分子"])
  }),
  zero: Object.freeze({
    rule: "new_customers = 0 的行计入分子，其分母贡献为 0；若整体分母为 0，答案是“无法计算”，不是 0",
    rationale: "0 是一个确定的计数；除零得到的是未定义，不是 0 元",
    wrongAnswers: Object.freeze(["把 0 天的比率报成 0 元", "把 NULL 天的比率报成 0 元"])
  })
});

/** The fixture. Same generator as compute-gold.mjs so the gold and the seeded
 *  rows always describe the same data. */
/**
 * @param {string} seed
 * @returns {ReturnType<typeof generateFixtureDataset>}
 */
export function generateDataset(seed) {
  return generateFixtureDataset(seed);
}

function sumBigint(rows, pick) {
  return rows.reduce((acc, row) => acc + BigInt(pick(row)), 0n);
}

/** Half-up integer division for non-negative operands; null for a zero
 *  denominator (undefined, never 0). */
function divRoundHalfUp(numerator, denominator) {
  if (denominator === 0n) return null;
  return (2n * numerator + denominator) / (2n * denominator);
}

/** The governed scope: rows whose new_customers is KNOWN. NULL rows drop out
 *  of BOTH the numerator and the denominator. */
function knownRows(rows) {
  return rows.filter((row) => row.newCustomers !== null && row.newCustomers !== undefined);
}

function daysOf(rows) {
  return [...new Set(rows.map((row) => row.day))].sort();
}

/**
 * The typed gold of the mainline. Two questions, one metric, two windows.
 * `expected.type` follows the frozen catalog's answer vocabulary:
 *   money_cents — exact cents (toleranceCents 0)
 */
/**
 * @param {ReturnType<typeof generateDataset>} dataset
 * @returns {V025Gold}
 */
export function computeGold(dataset) {
  const marketing = dataset?.marketing ?? [];
  const allDays = daysOf(marketing);
  const lastSevenDays = allDays.slice(-7);
  const sevenDayStart = lastSevenDays[0] ?? null;

  const known28 = knownRows(marketing);
  const spend28 = sumBigint(known28, (r) => r.spendCents);
  const customers28 = sumBigint(known28, (r) => r.newCustomers);
  const cac28 = divRoundHalfUp(spend28, customers28);

  const known7 = knownRows(marketing.filter((r) => r.day >= sevenDayStart));
  const spend7 = sumBigint(known7, (r) => r.spendCents);
  const customers7 = sumBigint(known7, (r) => r.newCustomers);
  const cac7 = divRoundHalfUp(spend7, customers7);

  // Decoys: the answers a runner produces when it gets the semantics wrong.
  const spendIncludingNullRows = sumBigint(marketing, (r) => r.spendCents);
  const dailyRatios = known28.filter((r) => r.newCustomers > 0).map((r) => r.spendCents / r.newCustomers);
  const avgOfDailyRatiosCents = dailyRatios.length === 0
    ? null
    : Math.round(dailyRatios.reduce((a, b) => a + b, 0) / dailyRatios.length);

  const nullRows = marketing.filter((r) => r.newCustomers === null);
  const zeroRows = marketing.filter((r) => r.newCustomers === 0);

  const questions = {
    [MAINLINE_FIRST_QUESTION]: {
      question: "最近 28 天的获客成本是多少？默认口径是什么？",
      expected: { type: "money_cents", cents: Number(cac28), toleranceCents: 0, currency: "CNY" },
      queryKey: { days: 28, table: "marketing_daily", region: null },
      definition: "SUM(spend_cents)/SUM(new_customers)，不取日比率均值；new_customers 为 NULL 的行不计入分子分母",
      definitionPatterns: ["SUM|合计|总投放|总额|累计", "除以|÷|/|比"],
      nullZeroSemantics: NULL_ZERO_SEMANTICS,
      wrongAnswers: {
        // Averaging the daily ratios instead of SUM(spend)/SUM(new_customers).
        avgOfDailyRatiosCents,
        // Counting the NULL row's spend in the numerator (NULL is not 0).
        spendIncludingNullRowsCents: Number(divRoundHalfUp(spendIncludingNullRows, customers28)),
        // Note: counting a NULL row as a ZERO-customer day is NOT a separate
        // decoy — SQL SUM ignores NULL, so it changes neither sum. The only
        // way to get this wrong in the numerator is spendIncludingNullRowsCents.
        nullRows: nullRows.length
      },
      allowedCanaries: [dataset?.canaries?.financeWiki, dataset?.canaries?.publishedSkill].filter(Boolean),
      forbiddenCanaries: [dataset?.canaries?.salesWiki, dataset?.canaries?.restrictedWiki, dataset?.canaries?.draftSkill].filter(Boolean)
    },
    [MAINLINE_FOLLOW_UP]: {
      question: "那最近 7 天呢？",
      expected: { type: "money_cents", cents: Number(cac7), toleranceCents: 0, currency: "CNY" },
      queryKey: { days: 7, table: "marketing_daily", region: null, asOf: sevenDayStart },
      definition: "沿用上一轮的口径与范围，只把时间窗换成最近 7 天（同一会话的自然追问）",
      definitionPatterns: ["7 天|7天|seven|7-day|七日"],
      nullZeroSemantics: NULL_ZERO_SEMANTICS,
      wrongAnswers: {
        wrongWindowCents: Number(cac28),
        avgOfDailyRatiosCents
      },
      allowedCanaries: [dataset?.canaries?.financeWiki, dataset?.canaries?.multiTurnAnchor].filter(Boolean),
      forbiddenCanaries: [dataset?.canaries?.salesWiki, dataset?.canaries?.draftSkill].filter(Boolean)
    }
  };

  return {
    contract: GOLD_CONTRACT,
    seed: dataset?.seed ?? null,
    asOf: dataset?.asOf ?? DATASET_AS_OF,
    rowCounts: {
      marketing: marketing.length,
      knownRows: known28.length,
      nullRows: nullRows.length,
      zeroRows: zeroRows.length,
      days: allDays.length
    },
    window: { firstDay: allDays[0] ?? null, lastDay: allDays[allDays.length - 1] ?? null, sevenDayStart },
    questions
  };
}

/** The mainline question texts, for the runner that has to execute exactly
 *  them (防静默换题 compares the executed prompt with gold.question). */
/**
 * @param {ReturnType<typeof generateDataset>} dataset
 * @returns {Array<{key: string, question: string, expected: V025Question["expected"]}>}
 */
export function mainlineQuestions(dataset) {
  const gold = computeGold(dataset);
  return MAINLINE_QUESTIONS.map((key) => ({
    key,
    question: gold.questions[key].question,
    expected: gold.questions[key].expected
  }));
}

if (process.argv[1] && process.argv[1].endsWith("v025-gold.mjs")) {
  const seedArg = process.argv.indexOf("--seed");
  const seed = seedArg >= 0 ? process.argv[seedArg + 1] : "0123456789abcdef0123";
  const gold = computeGold(generateDataset(seed));
  process.stdout.write(`${JSON.stringify(gold, null, 2)}\n`);
}
