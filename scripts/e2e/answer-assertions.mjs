// Typed gold checking for Agent answers (Spec §7 UX-02, §8.1). Never a word/number-existence check on its own:
//   - the stated value must equal the typed gold (money in integer cents, integers exact, no fuzzy tolerance
//     beyond what the question states),
//   - the FINAL conclusion (not every number in the text) must equal the gold,
//   - the answer must explicitly state the gold value as its conclusion, not just hint at it,
//   - the answer must NOT also explicitly state a different value as a competing conclusion,
//   - known wrong answers and decoys (the averaged ratio, the other database's count …) must not be
//     presented as the final answer, and any pre-registered decoy appearing AS the conclusion is a fail,
//   - the required definition must be stated,
//   - forbidden canaries / credentials must not appear,
//   - and a real, successful, QUESTION-BOUND query must exist: an answer without a query never passes,
//     and a successful query on a DIFFERENT question never satisfies this case (no any-ok-query shortcut).
// Pure functions: no I/O, so every rule is unit-tested.

const NUMBER_RE = /(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(\s*)(亿|万|元|分|CNY|RMB|¥)?/g;
const CURRENCY_PREFIX_RE = /(?:¥|￥|CNY\s*|RMB\s*)(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
const PAREN_CONTENT_RE = /[（(]([^）)]+)[）)]/g;

// A non-CNY unit (percentage, USD, EUR, ...) must be detected even though the number regex does not
// capture it. We scan the characters right after the number for these tokens so we don't silently
// treat "123.45%" or "123.45 USD" as 123.45 CNY. The non-word-bounded tokens (%, 美元, 欧元, ...)
// must match as a literal; the word-bounded tokens (USD, dollar, ...) use a trailing \b.
const NON_CNY_UNIT_AFTER_RE = /(?:\s*(?:%|％|美元|欧元|英镑|日元|韩元|港币|USD|US\$|dollar|EUR|GBP|HKD|JPY|KRW|percent|百?分比|cents?|pence|penny|dime|quarter)(?:\b|(?=$|[，。；,.;\s!？?])))/i;
// A computed-expression conclusion: "X / Y = Z" or "X = Y" makes Z the conclusion. We allow "="
// with optional whitespace as a math verb that introduces the conclusion.
const EQUALS_VERB_TAIL = /=\s*$/i;
// Exponent notation must fail-closed (no silent parse). We refuse to read "1e3" as 1 or as 1000.
const EXPONENT_NOTATION_RE = /\d+(?:\.\d+)?\s*[eE]\s*[+-]?\d+/;

function toNumber(raw) {
  return Number(raw.replaceAll(",", ""));
}

/** All numeric facts in the text, each with the currency unit it was stated in (if any). */
export function extractNumbers(text) {
  const found = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    found.push({ value: toNumber(match[1]), unit: match[3] ?? null, index: match.index, raw: match[0].trim() });
  }
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

/** True when the text right after the number carries a non-CNY unit (%, USD, EUR, ...). The number
 *  itself was extracted as a bare value; the unit context disqualifies it from being the gold. */
function hasNonCnyUnitSuffix(text, fact) {
  const tail = text.slice(fact.index + fact.raw.length, fact.index + fact.raw.length + 12);
  return NON_CNY_UNIT_AFTER_RE.test(tail);
}

/** True when the text contains exponent notation anywhere — used to fail-closed when the answer
 *  writes "1e3" instead of the integer 1000 (or a clear plain-numeric statement). */
export function textHasExponentNotation(text) {
  return EXPONENT_NOTATION_RE.test(text);
}

/** Cents implied by a stated amount. Unit 亿/万 scale yuan; 分 is already cents; bare numbers are yuan. */
function centsOf(fact) {
  const scale = { 亿: 1e8, 万: 1e4 }[fact.unit] ?? 1;
  if (fact.unit === "分") return Math.round(fact.value);
  return Math.round(fact.value * scale * 100);
}

function _parenRanges(text) {
  const ranges = [];
  for (const m of text.matchAll(PAREN_CONTENT_RE)) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}

function _inParen(idx, ranges) {
  return ranges.some(([s, e]) => idx >= s && idx < e);
}

const NEGATION_TAIL = /(?:不(?:是|为|对|算|是\s*该\s*金额)|≠|!=|is\s+wrong|is\s+incorrect|not\s+the|not\s+this|is\s+not|are\s+not)/i;

// A leading "不" (or English "not") that targets a NO_DATA / UNDEFINED marker. Examples that MUST
// be rejected as empty/undefined gold: "不是没有数据，订单数为42", "并非无法计算，最终结果为999",
// "not that there is no data, the order count is 42". We treat the negation as scoping only the
// negative marker that immediately follows (within 6 CJK chars or 2 English words).
const NEGATED_NO_DATA_RE = /(?:不(?:是|为)?\s*)?(无数据|没有.{0,6}数据|未找到|不存在|没有记录|没有.{0,4}(?:行|结果)|为空|无结果|no data|no rows|no matching|not found)/i;
const NEGATED_NO_DATA_LEAD_RE = /(?:^|[，,。.;；:：\s])(?:不是没有数据|并不是没有数据|不是无数据|并非没有数据|并非无数据|not\s+(?:that\s+)?there\s+is\s+no\s+data|not\s+no\s+data)/i;
const NEGATED_UNDEFINED_LEAD_RE = /(?:^|[，,。.;；:：\s])(?:并非无法计算|并非不能计算|并非无意义|不是无法计算|不是不能计算|not\s+that\s+it\s+cannot\s+be\s+computed|not\s+undefined)/i;

function isNegated(text, fact) {
  const after = text.slice(fact.index, Math.min(text.length, fact.index + fact.raw.length + 8));
  if (NEGATION_TAIL.test(after)) return true;
  // Look back up to 16 characters for a negation that targets this number (e.g. "成本不是 123.45 元",
  // "The cost is not 123.45 CNY", "not 123.45 yuan; actual cost is 999.99 CNY").
  const before = text.slice(Math.max(0, fact.index - 16), fact.index);
  if (/(?:不(?:是|为|对)|≠|not\s+(?:\d|the|this|a|an)|is\s+not|are\s+not)/i.test(before)) return true;
  return false;
}

/** Numbers that already appear in the question are not the answer; remove them as candidates. */
function candidateFacts(answer, question) {
  const asked = new Set(extractNumbers(question).map((f) => f.value));
  return extractNumbers(answer).filter((fact) => !asked.has(fact.value) || fact.unit);
}

const NO_DATA_RE = /无数据|没有.{0,6}数据|未找到|不存在|没有记录|没有.{0,4}(?:行|结果)|为空|无结果|no data|no rows|no matching|not found/i;
const UNDEFINED_RE = /无法计算|不能计算|无法得出|分母为\s*(?:0|零)|除以\s*(?:0|零)|零分母|无意义|未定义|undefined|division by zero|cannot be computed/i;
const DENIED_RE = /无权|没有权限|无法访问|不可用|context_not_available|拒绝|not\s+(?:available|permitted|authorized)|permission|denied/i;

/** A "conclusion" verb subject phrase that, when followed by a number, marks the number as the answer.
 *  Word boundaries matter: bare "金额" would match inside "投放金额" (a support context) and falsely mark a
 *  numerator/denominator breakdown value as the conclusion. We use a negative lookbehind so the bare
 *  "金额" / "合计" tokens only fire when NOT immediately preceded by "投" (the only CJK prefix that
 *  turns the token into a SUPPORT subject we recognize). */
const FINAL_PHRASE_RE = /(?<!投)(?:成本|结果|答案|数值|结论|获客\s*成本|订单数?|金额|单价|总数|合计|均值|占比|率|答|最终|因此|所以|故|综上|回答)\s*(?:为|是|等于|约为|达|约|达到|是\s*该\s*金额|为\s*该\s*金额|为\s*这个|是这个|为该|是该)/i;
const FINAL_VERB_TAIL = /(?:为|是|等于|约为|达|约|达到|是\s*该\s*金额|为\s*该\s*金额|为该|是该|为\s*这个|是这个)\s*$/i;
const SUPPORT_HEAD_RE = /(?:口径|分子|分母|投放金额|新增客户|投放\s*合计|客户\s*合计|算式|计算公式|定义|公式|说明|其中|分项|拆解|依据|基于|按照|按)\s*[:：是为]?/i;

function check(token, passed, detail) {
  return { token, passed: Boolean(passed), detail: String(detail).slice(0, 300) };
}

/**
 * "Final conclusion" extraction. The conclusion is the money/integer fact stated as the answer — the
 * number a reader would quote back as "the answer". We require ALL of:
 *   1. the number is NOT negated (e.g. "不是 X 元" → not asserted),
 *   2. the number is presented as the conclusion: either (a) preceded by a "final" verb like
 *      成本为/答案是/最终为/所以, or (b) if no verb is present, it is the first non-paren, non-negated,
 *      non-support-context money fact in the text,
 *   3. the number is not inside a paren whose head is a support context (口径/分子/分母/…),
 *   4. the number is not the units the question itself used (we strip question numbers separately).
 */
function isSupportParen(text, ranges, idx) {
  if (!_inParen(idx, ranges)) return false;
  const paren = ranges.find(([s, e]) => idx >= s && idx < e);
  const head = text.slice(Math.max(0, paren[0] - 16), paren[0]);
  if (SUPPORT_HEAD_RE.test(head)) return true;
  // The support context can also live INSIDE the paren itself (the "分子投放金额为 246.90 元" inside
  // a paren that follows the conclusion). Check the slice of the paren up to the fact for a
  // support-keyword head that targets the current number, e.g. "（分子投放金额为 246.90 元" — the
  // head preceding the fact (within the paren) is "分子投放金额为", which IS a support subject.
  const parenBody = text.slice(paren[0], idx);
  return SUPPORT_HEAD_RE.test(parenBody);
}

function isConclusionShape(text, ranges, fact) {
  if (isNegated(text, fact)) return false;
  if (isSupportParen(text, ranges, fact.index)) return false;
  const before = text.slice(Math.max(0, fact.index - 16), fact.index);
  // (1) Standard CJK/EN conclusion verb ("成本为 X", "final answer is X").
  if (FINAL_PHRASE_RE.test(before) && FINAL_VERB_TAIL.test(before)) return true;
  // (2) Math-equation conclusion: a number preceded by "=" (with optional whitespace) is the
  // right-hand-side of an equation like "246.90元 / 2 = 123.45元" or "sum = 1000". We require the
  // "=" to be the immediate non-whitespace character before the fact to avoid matching "X = 5.0
  // == 0.05" (where the second "=" is not the RHS introduction).
  const eqBefore = text.slice(Math.max(0, fact.index - 4), fact.index);
  if (EQUALS_VERB_TAIL.test(eqBefore) && /=\s*$/.test(eqBefore)) return true;
  return false;
}

function isTypedFor(fact, expected) {
  if (expected.type === "money_cents") return Boolean(fact.unit) || /\.\d{1,2}\b/.test(fact.raw);
  if (expected.type === "int") return Number.isInteger(fact.value) && !fact.unit;
  return true;
}

function typedCandidates(answer, question, expected) {
  const all = extractNumbers(answer);
  const asked = new Set(extractNumbers(question).map((f) => f.value));
  // Question numbers are NOT removed for int gold when the answer restates them as a conclusion (e.g. an
  // answer to "28 days" might legitimately be "28"), but the shape check (conclusion verb) is what really
  // distinguishes "Q-restated as A" from "no answer".
  return all.filter((f) => isTypedFor(f, expected) && (expected.type !== "int" || !asked.has(f.value) || f.unit));
}

export function findFinalConclusion(answer, question, expected) {
  const text = String(answer ?? "");
  const ranges = _parenRanges(text);
  const candidates = typedCandidates(text, question, expected);
  const shaped = candidates.filter((f) => isConclusionShape(text, ranges, f));
  if (shaped.length > 0) return { value: shaped[0], kind: "explicit" };
  // No "final verb" conclusion. Fall back to a single implicit candidate. If there are two or more
  // non-negated, non-support, non-paren candidates of the same shape the answer is ambiguous
  // (e.g. "123.45元；999.99元") and we MUST fail closed — picking the first would silently accept
  // an answer that did not commit to a single value.
  const fallbackCandidates = candidates.filter((f) => !isNegated(text, f) && !isSupportParen(text, ranges, f.index));
  if (fallbackCandidates.length === 1) return { value: fallbackCandidates[0], kind: "implicit" };
  if (fallbackCandidates.length > 1) return { value: null, kind: "ambiguous" };
  return { value: null, kind: "none" };
}

/** All conclusion-shaped facts (used to detect competing conclusions). */
export function findAllConclusionShape(answer, question, expected) {
  const text = String(answer ?? "");
  const ranges = _parenRanges(text);
  return typedCandidates(text, question, expected).filter((f) => isConclusionShape(text, ranges, f));
}

/** Value match for one typed gold expectation. Deterministic final-conclusion interpretation. */
export function matchTypedGold(expected, answer, goldQuestion) {
  const text = String(answer ?? "");
  const question = goldQuestion?.question ?? "";

  switch (expected.type) {
    case "money_cents": {
      const tolerance = expected.toleranceCents ?? 0;
      // Exponent notation anywhere in the text → fail-closed. A bare "1e3" or "1.23e6" must not be
      // silently parsed; the only correct way to state a money figure is with an explicit unit and
      // plain decimal notation.
      if (textHasExponentNotation(text)) {
        return { passed: false, detail: `money gold ${expected.cents} cents: text uses exponent notation (e.g. "1e3") and cannot be matched as a plain figure` };
      }
      const conclusion = findFinalConclusion(text, question, expected);
      if (!conclusion.value) {
        return { passed: false, detail: `no money figure presented as a non-negated, non-support conclusion for gold ${expected.cents} cents` };
      }
      // Reject any unit other than CNY: percentage (%), USD/EUR/GBP/..., 美元, 欧元, etc. The number
      // itself was extracted bare; the suffix context disqualifies it from being the gold.
      if (hasNonCnyUnitSuffix(text, conclusion.value)) {
        return { passed: false, detail: `final conclusion ${conclusion.value.raw} carries a non-CNY unit suffix and cannot match a CNY money gold of ${expected.cents} cents` };
      }
      // Detect a leading minus sign in the ORIGINAL text just before the fact (the number regex
      // strips it, but the original character determines the sign). "-123.45元" must NEVER match
      // a positive 12345 cents gold: a signed-negative stated value is a different answer.
      const signChar = text.slice(Math.max(0, conclusion.value.index - 1), conclusion.value.index);
      if (signChar === "-" || signChar === "−") {
        return { passed: false, detail: `conclusion is signed-negative (${signChar}${conclusion.value.raw}) and cannot match a positive gold` };
      }
      const statedCents = centsOf(conclusion.value);
      const valueOk = Math.abs(statedCents - expected.cents) <= tolerance;
      // Also reject if the answer asserts a different money value AS a competing final conclusion.
      const shapedCompeting = findAllConclusionShape(text, question, expected);
      const competingDecoy = shapedCompeting.find((f) => f !== conclusion.value && Math.abs(centsOf(f) - expected.cents) > tolerance);
      if (competingDecoy) {
        return { passed: false, detail: `competing final conclusion at ${centsOf(competingDecoy)} cents disagrees with gold ${expected.cents} cents` };
      }
      return { passed: valueOk, detail: valueOk ? `states ${expected.cents} cents as conclusion (${conclusion.kind})` : `final conclusion ${statedCents} cents differs from gold ${expected.cents} cents` };
    }
    case "int": {
      // Exponent notation anywhere in the text → fail-closed. "订单数为1e3" must not be read as 1
      // and must not be parsed as 1000 silently; the answer must restate the integer plainly.
      if (textHasExponentNotation(text)) {
        return { passed: false, detail: `int gold ${expected.value}: text uses exponent notation (e.g. "1e3") and cannot be matched as a plain integer` };
      }
      const conclusion = findFinalConclusion(text, question, expected);
      if (!conclusion.value) {
        return { passed: false, detail: `no integer figure presented as a non-negated, non-support conclusion for gold ${expected.value}` };
      }
      const signChar = text.slice(Math.max(0, conclusion.value.index - 1), conclusion.value.index);
      if (signChar === "-" || signChar === "−") {
        return { passed: false, detail: `conclusion is signed-negative (${signChar}${conclusion.value.raw}) and cannot match a non-negative gold` };
      }
      const stated = conclusion.value.value;
      const valueOk = stated === expected.value;
      const shapedCompeting = findAllConclusionShape(text, question, expected);
      const competingDecoy = shapedCompeting.find((f) => f !== conclusion.value && f.value !== expected.value);
      if (competingDecoy) {
        return { passed: false, detail: `competing final conclusion ${competingDecoy.value} disagrees with gold ${expected.value}` };
      }
      return { passed: valueOk, detail: valueOk ? `states ${expected.value} as conclusion (${conclusion.kind})` : `final conclusion ${stated} differs from gold ${expected.value}` };
    }
    case "empty": {
      // A negated empty claim ("不是没有数据", "并非无数据") does not satisfy empty gold.
      if (NEGATED_NO_DATA_LEAD_RE.test(text)) {
        return { passed: false, detail: `empty gold: text negates the no-data claim ("不是没有数据" / "not that there is no data")` };
      }
      // If the answer ALSO states a typed money/integer conclusion that disagrees with the empty
      // claim, that is a categorical contradiction: the answer asserts BOTH "no data" AND a
      // computed figure, so the empty gold is not actually satisfied.
      const typedConflictingConclusion = hasConflictingTypedConclusion(text, question, expected);
      if (typedConflictingConclusion) {
        return { passed: false, detail: `empty gold: answer also states a final numeric conclusion (${typedConflictingConclusion}) contradicting the empty claim` };
      }
      return { passed: NO_DATA_RE.test(text), detail: NO_DATA_RE.test(text) ? "reports that there is no data" : "does not clearly report an empty result" };
    }
    case "undefined": {
      // A negated undefined claim ("并非无法计算", "not that it cannot be computed") does not
      // satisfy undefined gold.
      if (NEGATED_UNDEFINED_LEAD_RE.test(text)) {
        return { passed: false, detail: `undefined gold: text negates the cannot-be-computed claim ("并非无法计算" / "not that it cannot be computed")` };
      }
      // Same contradiction guard: an answer that says "无法计算" AND ALSO "结果为 999" is a
      // categorical contradiction; undefined gold is not actually satisfied.
      const typedConflictingConclusion = hasConflictingTypedConclusion(text, question, expected);
      if (typedConflictingConclusion) {
        return { passed: false, detail: `undefined gold: answer also states a final numeric conclusion (${typedConflictingConclusion}) contradicting the cannot-be-computed claim` };
      }
      return { passed: UNDEFINED_RE.test(text), detail: UNDEFINED_RE.test(text) ? "explains the value cannot be computed" : "does not explain that the value cannot be computed" };
    }
    default:
      return { passed: false, detail: `unknown gold type ${expected.type}` };
  }
}

/** True when the answer carries a non-negated, non-support, conclusion-shaped number that ALSO
 *  contradicts the empty/undefined claim. We look at money figures (with any unit) and plain
 *  integers that are presented as a final conclusion (verb-headed) and are NOT inside a paren.
 *  A bare 0 is a contradiction when it's the FINAL conclusion (e.g. "结果为0" presented as the
 *  answer to a "无法计算" question); the same 0 in a support paren like "（行数 0）" is a
 *  legitimate companion to the empty claim and is filtered by the _inParen check above. */
function hasConflictingTypedConclusion(answer, question, expected) {
  if (expected.type !== "empty" && expected.type !== "undefined") return null;
  const text = String(answer ?? "");
  const ranges = _parenRanges(text);
  const all = extractNumbers(text).filter((f) => {
    if (isNegated(text, f)) return false;
    if (isSupportParen(text, ranges, f.index)) return false;
    if (_inParen(f.index, ranges)) return false;
    return true;
  });
  for (const fact of all) {
    const before = text.slice(Math.max(0, fact.index - 16), fact.index);
    if (FINAL_PHRASE_RE.test(before) && FINAL_VERB_TAIL.test(before)) {
      return fact.unit ? `${fact.raw} ${fact.unit}` : `${fact.raw}`;
    }
  }
  return null;
}

/** Fabrication guard for empty / undefined answers: they must not state a cost figure. */
function fabricatesNumber(expected, answer, goldQuestion) {
  if (expected.type !== "empty" && expected.type !== "undefined") return false;
  return extractNumbers(answer).some((f) => f.unit === "元" || f.unit === "¥" || /\.\d{2}\b/.test(f.raw));
}

/**
 * A pre-registered decoy (wrong answer / decoy value) asserted as the final conclusion is a fail. This
 * check runs AFTER matchTypedGold so a gold-shaped final that equals a known decoy still fails. We do NOT
 * blanket-reject decoys appearing in supporting context (numerator/denominator, breakdown, definition).
 */
function decoyAssertedAsConclusion(expected, answer, goldQuestion) {
  if (!expected) return [];
  const text = String(answer ?? "");
  const conclusion = findFinalConclusion(text, goldQuestion?.question ?? "", expected);
  if (!conclusion.value) return [];
  const hits = [];
  for (const [label, cents] of Object.entries(goldQuestion?.wrongAnswers ?? {})) {
    if (expected.type === "money_cents" && cents !== expected.cents && centsOf(conclusion.value) === cents) hits.push(label);
  }
  for (const decoy of goldQuestion?.decoys ?? []) {
    if (expected.type === "int" && decoy.value !== expected.value && conclusion.value.value === decoy.value) hits.push(decoy.label);
  }
  return hits;
}

/**
 * Binds the server-side query to the question + typed gold. A successful query that does not reference
 * the gold (or that returned rows that don't match) is NOT a real_query proof. We require:
 *   - at least one successful server query in the case window,
 *   - that query's filter references the gold's binding key (table/region/period),
 *   - that query carries a result row/aggregate that matches the typed gold shape, not merely
 *     numerically: each gold type has its own "what proves it" shape and we reject ambiguous
 *     fallbacks (e.g. money_cents by rowCount, int by rowCount, empty by value:null with nonempty
 *     rows, undefined by aggregate:0 or rows:[]),
 *   - and for empty/undefined gold, the bound query proves the empty/undefined condition rather
 *     than any successful query.
 *
 * TYPED RESULT BINDING (review-a3-extra; review-a-blocking §A3):
 *   * empty gold: the bound query must return a *qualifying* row set of length 0. `value: null`
 *     with nonempty `rows` is NULL-vs-EMPTY — empty means there are no qualifying rows, NULL
 *     means the aggregate of a populated set was null. These are not the same answer, and a
 *     `value: null` would launder a wrong-region/wrong-filter query into a fake empty.
 *   * undefined gold: the bound query must explicitly return an *aggregate: null* (SQL NULL when
 *     the ratio's denominator was 0). An `aggregate: 0` is a DEFINED value (a computed zero
 *     ratio); `rows: []` is just an empty row set (could be the wrong region/filter). Neither
 *     proves a zero denominator inside a successful aggregate — they prove an empty set of
 *     qualifying rows, not "the ratio cannot be computed". A runner that satisfied Q-ZERO-DAY
 *     with `aggregate: 0` would be claiming the customer-acquisition cost was 0 CNY that day;
 *     that's a fabricated result, not undefined.
 *   * int gold: the bound query must return an *aggregate: <integer>* or *value: <integer>*. A
 *     `rowCount` of 1 is "the query returned 1 row"; for a COUNT(DISTINCT order_id) on a region
 *     that holds 1 row, that rowCount happens to be 1 but the rowset itself contains whatever
 *     the driver returned. A runner that satisfied Q-ORDERS-EAST=1 by submitting
 *     `SELECT note FROM orders WHERE region='East' LIMIT 1` and reading rowCount=1 is not
 *     proving the gold. We refuse to fall back to rowCount for int gold.
 *   * money_cents gold: `aggregateCents` (preferred) or `aggregate*100` or `value*100` (and only
 *     these). rowCount, rows.length, or any fabricated integer from rows.length must NOT count.
 *     Units/currency are NOT encoded in the integer cents value — `aggregateCents` only proves
 *     CNY if the runner also reports the currency (or it matches the gold's currency); we
 *     compare the gold's currency literally and refuse mismatched currencies.
 *
 * Source/result currency/units and metric/aggregation matter as well as table/region/days.
 * Correct numeric coincidence of the wrong measure isn't proof: a wrong-currency 12345 cents
 * does NOT satisfy a CNY 12345-cents gold.
 *
 * Measured shapes the runner CANNOT legitimately emit (rowCount-as-money, etc.) must be reported
 * as `shape_unknown` and BLOCK the case. The runner must adopt a stable per-type measurement
 * format (collect-server-evidence.mjs) so this assertion always has real typed shapes to bind
 * against.
 */
export function checkRealQuery({ goldQuestion, evidence }) {
  const queries = (evidence?.queries ?? []).filter((q) => q.outcome === "ok");
  if (queries.length === 0) {
    return { passed: false, detail: "no successful server-side query in the case window" };
  }
  const expected = goldQuestion?.expected;
  const key = goldQuestion?.queryKey ?? null;
  if (!key) return { passed: false, detail: `${expected?.type ?? "<no-type>"} gold has no queryKey; cannot bind measured result to question (no any-ok shortcut)` };
  const matched = queries.find((q) => {
    if (!q.query || typeof q.query !== "object") return false;
    if (key.region !== undefined && String(q.query.region ?? "") !== String(key.region)) return false;
    if (key.days !== undefined && Number(q.query.days ?? 0) !== Number(key.days)) return false;
    if (key.table !== undefined && String(q.query.table ?? "") !== String(key.table)) return false;
    if (key.filter !== undefined && String(q.query.filter ?? "") !== String(key.filter)) return false;
    return true;
  });
  if (!matched) return { passed: false, detail: `no successful query bound to the question's region/period/table for gold ${expected?.type ?? "<no-type>"}` };
  const result = matched.result;
  if (result === undefined || result === null) return { passed: false, detail: `bound query has no measured result; ${expected?.type ?? "<no-type>"} gold requires a measured aggregate, not any successful query` };

  if (expected?.type === "empty") {
    // empty gold: rows MUST be a measured array of length 0 AND any aggregate must be consistent
    // with that (a SUM/AVG over 0 rows is null or 0, never 999). We refuse:
    //   * value:null with nonempty rows (NULL from a populated set is NOT empty),
    //   * aggregate:0 (a defined value, not empty),
    //   * rowCount alone (it is "rows returned", not "qualifying rows"; a wrong-region query
    //     happens to return 0 rows and could pass the loose check),
    //   * shape_unknown (rows absent entirely),
    //   * contradictory aggregate: e.g. rows=[] but aggregate=999 (a SUM over 0 rows is null/0,
    //     so aggregate=999 is a fabricated/inconsistent reading from a wrong source).
    if (!Array.isArray(result.rows)) return { passed: false, detail: `empty gold requires an empty rows array; bound query returned shape=${describeShape(result)}` };
    if (result.rows.length !== 0) return { passed: false, detail: `empty gold requires rows.length===0, got ${result.rows.length}` };
    if (result.value !== undefined && result.value !== null) return { passed: false, detail: `empty gold has rows=[] but result.value=${JSON.stringify(result.value)} is non-null; NULL-vs-EMPTY is not the same` };
    if (result.aggregate !== undefined && result.aggregate !== null && !(typeof result.aggregate === "number" && (result.aggregate === 0 || !Number.isFinite(result.aggregate)))) {
      return { passed: false, detail: `empty gold has rows=[] but result.aggregate=${JSON.stringify(result.aggregate)} is a defined non-zero value; rows=[] + aggregate=999 is contradictory (a SUM over 0 rows is null/0, not 999)` };
    }
    if (result.aggregateCents !== undefined && result.aggregateCents !== null && result.aggregateCents !== 0) {
      return { passed: false, detail: `empty gold has rows=[] but result.aggregateCents=${JSON.stringify(result.aggregateCents)} is a defined non-zero value; rows=[] + non-zero aggregateCents is contradictory` };
    }
    return { passed: true, detail: "bound query returned rows=[] — qualifying row set is empty" };
  }

  if (expected?.type === "undefined") {
    // undefined gold: aggregate MUST be null (SQL NULL when the ratio's denominator is 0) AND
    // the denominator helper must confirm zero (an aggregate:null with denominator=2 means the
    // numerator was null, not a divide-by-zero — a different reason). We refuse:
    //   * aggregate:0 (a defined computed zero ratio, not "cannot be computed"),
    //   * rows:[] (an empty qualifying row set, which is a different reason — could be wrong
    //     region/filter),
    //   * value:null with nonempty rows (NULL-of-populated-set, not NULL-of-divide-by-zero),
    //   * shape_unknown (aggregate absent entirely),
    //   * aggregate:null with denominator != 0 (the null is from a missing numerator, not a
    //     divide-by-zero — that is "not enough data", not "undefined").
    if (result.aggregate === undefined) return { passed: false, detail: `undefined gold requires an aggregate:null proof of zero denominator; bound query returned shape=${describeShape(result)}` };
    if (result.aggregate !== null) return { passed: false, detail: `undefined gold requires aggregate:null (zero-denominator); got aggregate=${JSON.stringify(result.aggregate)} which is a defined value` };
    // A denominator helper must confirm zero. The runner records `denominator: 0` (or `denominator: 0.0`)
    // for divide-by-zero cases; anything else is "null numerator" or "no observation", not undefined.
    const denom = result.denominator;
    if (denom !== undefined && denom !== null) {
      if (typeof denom !== "number" || !Number.isFinite(denom)) {
        return { passed: false, detail: `undefined gold has aggregate:null but denominator=${JSON.stringify(denom)} is not a numeric zero` };
      }
      if (denom !== 0) {
        return { passed: false, detail: `undefined gold requires denominator=0; got denominator=${denom} — aggregate:null with non-zero denominator means missing numerator, not divide-by-zero` };
      }
    }
    return { passed: true, detail: "bound query returned aggregate:null with denominator=0 — ratio is undefined" };
  }

  if (expected?.type === "money_cents") {
    let measuredCents = null;
    let measuredCurrency = result.currency ?? null;
    // aggregateCents must be an INTEGER. A fractional cents value (12344.6) is a measurement bug,
    // not a rounding opportunity — we refuse to silently round. The DB driver reports integer cents
    // and a fractional result means the query hit a non-money field (a percentage, a rate, a
    // ratio scaled wrong).
    if (typeof result.aggregateCents === "number" && Number.isInteger(result.aggregateCents) && Number.isFinite(result.aggregateCents)) measuredCents = result.aggregateCents;
    else if (typeof result.aggregate === "number" && Number.isInteger(result.aggregate) && Number.isFinite(result.aggregate)) {
      // `aggregate` is a money value ONLY when the runner explicitly reports it as cents. The
      // presence of a non-cents unit (元/yuan/USD/...) means the aggregate is in a different scale
      // and must NOT be treated as cents. aggregate:12345 with unit:yuan would otherwise pass as
      // 12345 cents (1.2345 yuan != 12345 cents = 123.45 yuan).
      const aggUnit = result.unit ?? result.currencyUnit ?? null;
      const centsUnits = new Set(["cents", "分", "CNY-cent", "CNY-cent", null]);
      if (aggUnit && !centsUnits.has(String(aggUnit).toLowerCase())) {
        return { passed: false, detail: `bound query returned aggregate=${result.aggregate} with unit=${JSON.stringify(aggUnit)} which is not a cents unit; 12345 yuan != 12345 cents` };
      }
      measuredCents = result.aggregate;
    }
    else if (typeof result.value === "number" && Number.isInteger(result.value) && Number.isFinite(result.value)) {
      // Same unit guard: value with a non-cents unit must not be treated as cents.
      const valUnit = result.unit ?? result.currencyUnit ?? null;
      const centsUnits = new Set(["cents", "分", "CNY-cent", null]);
      if (valUnit && !centsUnits.has(String(valUnit).toLowerCase())) {
        return { passed: false, detail: `bound query returned value=${result.value} with unit=${JSON.stringify(valUnit)} which is not a cents unit` };
      }
      measuredCents = result.value;
    }
    else return { passed: false, detail: `bound query result is not a measured money aggregate (got shape=${describeShape(result)}); rowCount-as-money, fractional cents and partial/NaN are not proof` };
    if (Math.abs(measuredCents - expected.cents) > (expected.toleranceCents ?? 0)) {
      return { passed: false, detail: `bound query returned ${measuredCents} cents, gold is ${expected.cents} cents; a wrong-result query does not prove real_query` };
    }
    // Source/result currency must agree with the gold's currency. A runner that submitted a USD
    // SELECT with a coincidentally-12345 result does NOT satisfy a CNY 12345-cents gold. The
    // runner must report currency alongside the aggregate; the absence of currency when the
    // gold declares one is a measurement gap (we fail closed, not silently accept).
    const goldCurrency = expected.currency ?? null;
    if (goldCurrency && !measuredCurrency) {
      return { passed: false, detail: `bound query returned ${measuredCents} cents without a currency, but gold requires ${goldCurrency}; missing-currency is a measurement gap, not proof` };
    }
    if (goldCurrency && measuredCurrency && String(measuredCurrency).toUpperCase() !== String(goldCurrency).toUpperCase()) {
      return { passed: false, detail: `bound query returned ${measuredCents} ${measuredCurrency}, gold is ${expected.cents} ${goldCurrency} cents; wrong-currency coincidence is not proof` };
    }
    return { passed: true, detail: `bound query returned ${measuredCents} cents (${measuredCurrency ?? goldCurrency ?? "currency-undeclared"}), matches gold` };
  }

  if (expected?.type === "int") {
    // int gold: require a real integer aggregate. We refuse rowCount as the answer because
    // "the query returned 1 row" is not "the count was 1". The runner must populate aggregate.
    let measured = null;
    if (typeof result.aggregate === "number" && Number.isInteger(result.aggregate) && Number.isFinite(result.aggregate)) measured = result.aggregate;
    else if (typeof result.value === "number" && Number.isInteger(result.value) && Number.isFinite(result.value)) measured = result.value;
    else return { passed: false, detail: `bound query result is not a measured integer aggregate (got shape=${describeShape(result)}); rowCount-as-count and partial/NaN are not proof` };
    if (measured !== expected.value) {
      return { passed: false, detail: `bound query returned ${measured}, gold is ${expected.value}; a wrong-result query does not prove real_query` };
    }
    return { passed: true, detail: `bound query returned aggregate=${measured}, matches gold` };
  }

  return { passed: false, detail: `${queries.length} successful query event(s) but gold type ${expected?.type ?? "<none>"} still requires query/result binding` };
}

/** Diagnostic: shape the runner emitted. Lets us surface a clear failure for "shape_unknown". */
function describeShape(result) {
  if (!result || typeof result !== "object") return "none";
  const fields = [];
  if (result.aggregateCents !== undefined) fields.push(`aggregateCents=${JSON.stringify(result.aggregateCents)}`);
  if (result.aggregate !== undefined) fields.push(`aggregate=${JSON.stringify(result.aggregate)}`);
  if (result.value !== undefined) fields.push(`value=${JSON.stringify(result.value)}`);
  if (Array.isArray(result.rows)) fields.push(`rows.length=${result.rows.length}`);
  if (result.rowCount !== undefined) fields.push(`rowCount=${JSON.stringify(result.rowCount)}`);
  if (result.currency !== undefined) fields.push(`currency=${JSON.stringify(result.currency)}`);
  return fields.length > 0 ? `{${fields.join(", ")}}` : "shape_unknown";
}

/**
 * Evaluates one Agent answer. `evidence` comes from collect-server-evidence.mjs (never from the runner).
 * Returns assertion records in the catalog vocabulary. No silent zero defaults: any missing measurement
 * becomes a `bindingProblems` entry and the verifier sees the gap.
 */
export function evaluateAnswer({ goldQuestion, answer, evidence, secrets = [], extraForbidden = [], expectation = "answer" }) {
  const assertions = [];
  const text = String(answer ?? "");
  const expected = goldQuestion?.expected;

  let valueMatched = false;
  if (expectation === "answer" && expected) {
    const value = matchTypedGold(expected, text, goldQuestion);
    const fabricated = fabricatesNumber(expected, text, goldQuestion);
    const decoys = decoyAssertedAsConclusion(expected, text, goldQuestion);
    const missingDefinition = (goldQuestion.definitionPatterns ?? []).filter((pattern) => !new RegExp(pattern, "i").test(text));
    valueMatched = value.passed && !fabricated && decoys.length === 0 && missingDefinition.length === 0;
    const detail = [value.detail, fabricated ? "states a figure where none is computable" : "", decoys.length ? `conclusion equals a known decoy: ${decoys.join(", ")}` : "", missingDefinition.length ? `definition not stated (${missingDefinition.join(" ; ")})` : ""]
      .filter(Boolean)
      .join("; ");
    assertions.push(check("typed_gold", valueMatched, detail));
  }

  const forbidden = [...(goldQuestion?.forbiddenCanaries ?? []), ...extraForbidden];
  const leaked = forbidden.filter((canary) => canary && text.includes(canary));
  const leakedSecrets = secrets.filter((secret) => secret && text.includes(secret));
  assertions.push(check("no_leak", leaked.length === 0 && leakedSecrets.length === 0, `${leaked.length} forbidden canary hit(s), ${leakedSecrets.length} credential hit(s)`));

  // Distinguish: upstreamUnauthorized counts UNSUCCESSFUL upstream tool executions (a real bad execution).
  // deniedCount is a successful deny verdict from the server and is NOT unauthorized execution.
  const upstream = evidence?.upstreamUnauthorized;
  const denied = evidence?.deniedCount;
  // Strict: upstream must be a non-negative integer when present. A boolean / string / NaN / negative
  // value indicates the runner/coordinator faked the measurement and is treated as "not measured".
  const upstreamIntegerOk = upstream === undefined || upstream === null || (typeof upstream === "number" && Number.isInteger(upstream) && upstream >= 0);
  const upstreamUnknown = !upstreamIntegerOk || upstream === undefined || upstream === null;
  const upstreamValue = upstreamUnknown ? null : upstream;
  if (expectation === "denied") {
    // The denied branch is just as bound by upstream measurement: a denial that succeeded while an
    // upstream unauthorized execution occurred is NOT a clean denial (the leaked execution is its
    // own security violation). A missing measurement BLOCKS the denied case, same as the answer branch.
    const denyAck = DENIED_RE.test(text) && leaked.length === 0;
    let denyOk = denyAck;
    let denyDetail = denyAck ? "answer reports the content is not available to this identity" : "answer does not acknowledge the denial";
    if (!upstreamIntegerOk) {
      denyOk = false;
      denyDetail = `${denyDetail}; upstream tool execution count was not a measured non-negative integer (got ${JSON.stringify(upstream)})`;
    } else if (upstreamValue !== null && upstreamValue > 0) {
      denyOk = false;
      denyDetail = `${denyDetail}; ${upstreamValue} unauthorized upstream execution(s) leaked through the denial`;
    } else if (upstreamValue === null) {
      denyOk = false;
      denyDetail = `${denyDetail}; upstream tool execution count was not measured; no zero-default allowed`;
    }
    assertions.push(check("deny", denyOk, denyDetail));
  } else {
    // A legitimate answer must have zero upstream tool executions that were NOT policy-denied. A missing
    // or malformed measurement is recorded as upstream_unmeasured and the assertion fails (no zero-default).
    const deniedAware = typeof denied === "number" && Number.isInteger(denied) && denied >= 0 ? denied : 0;
    if (!upstreamIntegerOk) {
      assertions.push(check("deny", false, `upstream tool execution count was not a measured non-negative integer (got ${JSON.stringify(upstream)}); no zero-default allowed (denials=${deniedAware})`));
    } else if (upstreamValue === null) {
      assertions.push(check("deny", false, `upstream tool execution count was not measured; no zero-default allowed (denials=${deniedAware})`));
    } else {
      assertions.push(check("deny", leaked.length === 0 && upstreamValue === 0, `${leaked.length} forbidden canary hit(s), ${upstreamValue} unauthorized upstream execution(s) (denials=${deniedAware})`));
    }
    if (expected) assertions.push(check("allow_control", valueMatched, valueMatched ? "the entitled question was answered correctly" : "the entitled control question was not answered correctly"));
  }

  // Real query binding: a successful query is necessary AND it must bind to the question + gold.
  if (expectation === "answer") {
    const real = checkRealQuery({ goldQuestion, evidence });
    assertions.push(check("real_query", real.passed, real.detail));
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
