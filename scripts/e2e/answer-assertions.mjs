// Typed gold checking for Agent answers (Spec §7 UX-02, §8.1). Never a word/number-existence check on its own:
//   - the stated value must equal the typed gold (money in integer cents, integers exact, no fuzzy tolerance
//     beyond what the question states),
//   - known wrong answers and decoys (the averaged ratio, the other database's count …) must not be asserted,
//   - the required definition must be stated,
//   - forbidden canaries / credentials must not appear,
//   - and a real, successful query bound to this run must exist (an answer without a query never passes).
// Pure functions: no I/O, so every rule is unit-tested.

const NUMBER_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*)(亿|万|元|分|CNY|RMB|¥)?/g;
const CURRENCY_PREFIX_RE = /(?:¥|￥|CNY\s*|RMB\s*)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;

function toNumber(raw) {
  return Number(raw.replaceAll(",", ""));
}

/** All numeric facts in the text, each with the currency unit it was stated in (if any). */
export function extractNumbers(text) {
  const found = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    found.push({ value: toNumber(match[1]), unit: match[3] ?? null, index: match.index, raw: match[0].trim() });
  }
  // A currency sign in front (¥98.76, CNY 98.76) makes the number an amount in yuan.
  for (const match of text.matchAll(CURRENCY_PREFIX_RE)) {
    const numberIndex = match.index + match[0].length - match[1].length;
    const fact = found.find((f) => f.index === numberIndex && f.value === toNumber(match[1]));
    if (fact) {
      fact.unit = fact.unit ?? "元";
      fact.raw = match[0].trim();
    } else {
      found.push({ value: toNumber(match[1]), unit: "元", index: match.index, raw: match[0].trim() });
    }
  }
  return found;
}

/** Cents implied by a stated amount. Unit 亿/万 scale yuan; 分 is already cents; bare numbers are yuan. */
function centsOf(fact) {
  const scale = { 亿: 1e8, 万: 1e4 }[fact.unit] ?? 1;
  if (fact.unit === "分") return Math.round(fact.value);
  return Math.round(fact.value * scale * 100);
}

/** Numbers that already appear in the question are not the answer; remove them as candidates. */
function candidateFacts(answer, question) {
  const asked = new Set(extractNumbers(question).map((f) => f.value));
  return extractNumbers(answer).filter((fact) => !asked.has(fact.value) || fact.unit);
}

const NO_DATA_RE = /无数据|没有.{0,6}数据|未找到|不存在|没有记录|没有.{0,4}(?:行|结果)|为空|无结果|no data|no rows|no matching|not found/i;
const UNDEFINED_RE = /无法计算|不能计算|无法得出|分母为\s*(?:0|零)|除以\s*(?:0|零)|零分母|无意义|未定义|undefined|division by zero|cannot be computed/i;
const DENIED_RE = /无权|没有权限|无法访问|不可用|context_not_available|拒绝|not\s+(?:available|permitted|authorized)|permission|denied/i;

function check(token, passed, detail) {
  return { token, passed: Boolean(passed), detail: String(detail).slice(0, 300) };
}

/** Value match for one typed gold expectation. Returns { passed, detail }. */
export function matchTypedGold(expected, answer, goldQuestion) {
  const facts = candidateFacts(answer, goldQuestion.question ?? "");
  switch (expected.type) {
    case "money_cents": {
      const tolerance = expected.toleranceCents ?? 0;
      const stated = facts.filter((f) => f.unit || /\.\d{1,2}\b/.test(f.raw)).map(centsOf);
      const hit = stated.some((c) => Math.abs(c - expected.cents) <= tolerance);
      return { passed: hit, detail: hit ? `states ${expected.cents} cents` : `stated amounts in cents [${stated.join(", ") || "none"}] do not include ${expected.cents}` };
    }
    case "int": {
      const stated = facts.filter((f) => Number.isInteger(f.value)).map((f) => f.value);
      const hit = stated.includes(expected.value);
      return { passed: hit, detail: hit ? `states ${expected.value}` : `stated integers [${stated.join(", ") || "none"}] do not include ${expected.value}` };
    }
    case "empty":
      return { passed: NO_DATA_RE.test(answer), detail: NO_DATA_RE.test(answer) ? "reports that there is no data" : "does not clearly report an empty result" };
    case "undefined":
      return { passed: UNDEFINED_RE.test(answer), detail: UNDEFINED_RE.test(answer) ? "explains the value cannot be computed" : "does not explain that the value cannot be computed" };
    default:
      return { passed: false, detail: `unknown gold type ${expected.type}` };
  }
}

/** Fabrication guard for empty / undefined answers: they must not state a cost figure. */
function fabricatesNumber(expected, answer, goldQuestion) {
  if (expected.type !== "empty" && expected.type !== "undefined") return false;
  return candidateFacts(answer, goldQuestion.question ?? "").some((f) => f.unit === "元" || f.unit === "¥" || /\.\d{2}\b/.test(f.raw));
}

function assertedDecoys(goldQuestion, answer, expected) {
  const facts = candidateFacts(answer, goldQuestion.question ?? "");
  const hits = [];
  for (const [label, cents] of Object.entries(goldQuestion.wrongAnswers ?? {})) {
    if (cents !== expected.cents && facts.some((f) => (f.unit || /\.\d{1,2}\b/.test(f.raw)) && centsOf(f) === cents)) hits.push(label);
  }
  for (const decoy of goldQuestion.decoys ?? []) {
    if (decoy.value !== expected.value && facts.some((f) => Number.isInteger(f.value) && f.value === decoy.value)) hits.push(decoy.label);
  }
  return hits;
}

/**
 * Evaluates one Agent answer. `evidence` comes from collect-server-evidence.mjs (never from the runner):
 *   { queries: [{outcome, id}], traceIds: [..], queryEventIds: [..], upstreamUnauthorized: number }
 * Returns assertion records in the catalog vocabulary.
 */
export function evaluateAnswer({ goldQuestion, answer, evidence, secrets = [], extraForbidden = [], expectation = "answer" }) {
  const assertions = [];
  const text = String(answer ?? "");
  const expected = goldQuestion?.expected;

  let valueMatched = false;
  if (expectation === "answer" && expected) {
    const value = matchTypedGold(expected, text, goldQuestion);
    const fabricated = fabricatesNumber(expected, text, goldQuestion);
    const decoys = assertedDecoys(goldQuestion, text, expected);
    const missingDefinition = (goldQuestion.definitionPatterns ?? []).filter((pattern) => !new RegExp(pattern, "i").test(text));
    valueMatched = value.passed && !fabricated && decoys.length === 0 && missingDefinition.length === 0;
    assertions.push(
      check(
        "typed_gold",
        valueMatched,
        [value.detail, fabricated ? "states a figure where none is computable" : "", decoys.length ? `asserts decoy/wrong value(s): ${decoys.join(", ")}` : "", missingDefinition.length ? `definition not stated (${missingDefinition.join(" ; ")})` : ""]
          .filter(Boolean)
          .join("; ")
      )
    );
  }

  const forbidden = [...(goldQuestion?.forbiddenCanaries ?? []), ...extraForbidden];
  const leaked = forbidden.filter((canary) => canary && text.includes(canary));
  const leakedSecrets = secrets.filter((secret) => secret && text.includes(secret));
  assertions.push(check("no_leak", leaked.length === 0 && leakedSecrets.length === 0, `${leaked.length} forbidden canary hit(s), ${leakedSecrets.length} credential hit(s)`));

  const unauthorized = evidence?.upstreamUnauthorized ?? 0;
  if (expectation === "denied") {
    assertions.push(check("deny", DENIED_RE.test(text) && leaked.length === 0 && unauthorized === 0, DENIED_RE.test(text) ? "answer reports the content is not available to this identity" : "answer does not acknowledge the denial"));
  } else {
    // Authorized answers must still show zero unauthorized content and zero unauthorized upstream executions.
    assertions.push(check("deny", leaked.length === 0 && unauthorized === 0, `${leaked.length} forbidden canary hit(s), ${unauthorized} unauthorized upstream execution(s)`));
    if (expected) assertions.push(check("allow_control", valueMatched, valueMatched ? "the entitled question was answered correctly" : "the entitled control question was not answered correctly"));
  }

  const queries = (evidence?.queries ?? []).filter((q) => q.outcome === "ok");
  if (expectation === "answer") {
    assertions.push(check("real_query", queries.length > 0, queries.length > 0 ? `${queries.length} successful server-side query event(s)` : "no successful query was recorded by the server: a correct-looking answer without a query does not count"));
  }
  const traced = (evidence?.traceIds ?? []).length > 0;
  assertions.push(check("server_trace", traced && (evidence?.bindingProblems ?? []).length === 0, traced ? `${evidence.traceIds.length} server trace id(s) bound` : `no server trace bound (${(evidence?.bindingProblems ?? []).join("; ") || "none returned"})`));
  return assertions;
}

/** Stable signature used for cross-product consistency (UX-05): same business and security verdicts. */
export function outcomeSignature(assertions) {
  return assertions
    .map((a) => `${a.token}:${a.passed ? 1 : 0}`)
    .sort()
    .join("|");
}
