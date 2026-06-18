#!/usr/bin/env node
// scripts/eval-runner.test.mjs — minimal unit tests for T-A.3~T-A.6 helpers.
// Run with: node scripts/eval-runner.test.mjs (no test framework; asserts via process.exit).

import {
  parseClaudeOutput,
  checkSqlPatterns,
  checkResultMatch,
  checkTextResponse,
  normalizeText,
  matchApprox,
  matchListOfObjects,
  matchListSet,
  matchMustMentionList,
} from './eval-runner.mjs';

let pass = 0;
let fail = 0;
const failures = [];

function assert(name, cond, detail) {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push({ name, detail });
  }
}

// ── T-A.3: parseClaudeOutput ───────────────────────────────────────────────

{
  const stdout = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'call_1',
          name: 'mcp__ktx__sl_query',
          input: { connectionId: 'mysql-aliyun', measures: ['superstore_orders.weighted_discount'], include: ['sql'] },
        },
      ],
    },
  }) + '\n' + JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: [{ type: 'text', text: JSON.stringify({
            headers: ['weighted_discount'],
            rows: [['0.1398']],
            sql: 'SELECT SUM(discount * sales) / NULLIF(SUM(sales), 0) FROM t',
          }) }],
        },
      ],
    },
  }) + '\n' + JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: '整体加权折扣率约为 13.98%' }] },
  });

  const parsed = parseClaudeOutput(stdout);
  assert('T-A.3 sql extracted', parsed.sql && parsed.sql.includes('SUM(discount * sales)'), parsed.sql);
  assert('T-A.3 result parsed', parsed.result && parsed.result.weighted_discount === 0.1398, JSON.stringify(parsed.result));
  assert('T-A.3 finalText ends with last text', parsed.finalText.includes('13.98%'), parsed.finalText);
  assert('T-A.3 toolCalls tracked', parsed.toolCalls.length === 1, JSON.stringify(parsed.toolCalls));
}

// ── T-A.4: checkSqlPatterns ────────────────────────────────────────────────

{
  const r = checkSqlPatterns(
    'SELECT SUM(discount * sales) / NULLIF(SUM(sales), 0) FROM orders',
    ['SUM(discount * sales)', 'NULLIF(SUM(sales), 0)'],
    ['AVG(discount)']
  );
  assert('T-A.4 all required hit + no forbidden', r.ok && r.requiredHits.length === 2, JSON.stringify(r));
}
{
  const r = checkSqlPatterns('SELECT SUM(discount) FROM orders', ['SUM(discount * sales)'], []);
  assert('T-A.4 one missing required', !r.ok && r.failures.some((f) => f.includes('required missing')), JSON.stringify(r));
}
{
  const r = checkSqlPatterns('SELECT AVG(discount) FROM orders', [], ['AVG(discount)']);
  assert('T-A.4 forbidden hit detected', !r.ok && r.failures.some((f) => f.includes('forbidden hit')), JSON.stringify(r));
}

// ── T-A.5: 9-way result matcher ────────────────────────────────────────────

{
  // discount-001: weighted_discount as numeric string → approx
  const r = checkResultMatch({ weighted_discount: 0.13981 }, { weighted_discount: '0.1398' });
  assert('T-A.5 numeric string → _approx matches', r.ok, JSON.stringify(r));
}
{
  // ordercount-001: order_count as bare number → exact
  const r = checkResultMatch({ order_count: 5083 }, { order_count: 5083 });
  assert('T-A.5 bare number → exact matches', r.ok, JSON.stringify(r));
}
{
  // discount-003: profit_margin_sign: negative → sign of actual value
  const r = checkResultMatch({ profit_margin_sign: -0.15 }, { profit_margin_sign: 'negative' });
  assert('T-A.5 _sign matches negative', r.ok, JSON.stringify(r));
}
{
  // discount-004: measure_name text-equal (now normalized contains)
  const r = checkResultMatch({ measure_name: 'weighted_discount' }, { measure_name: 'weighted_discount' });
  assert('T-A.5 measure_name text matches', r.ok, JSON.stringify(r));
}
{
  // segment-001: description text-contains
  const r = checkResultMatch({ description: '折扣超过 20% 的行' }, { description: '折扣超过 20% 的行' });
  assert('T-A.5 description text-contains matches', r.ok, JSON.stringify(r));
}
{
  // degradation-001: must_mention list — handled by text channel
  const r = matchMustMentionList('semantic layer 未覆盖，需要 raw SQL，并列出假设', ['semantic layer 未覆盖', 'raw sql', '假设']);
  assert('T-A.5 must_mention list all hit (normalized)', r.ok, JSON.stringify(r));
}
{
  // discount-002: list-of-objects with approx
  const r = matchListOfObjects(
    [
      { category: '家具', weighted_discount_approx: 0.1712 },
      { category: '办公用品', weighted_discount_approx: 0.1401 },
    ],
    [
      { category: '家具', weighted_discount_approx: '0.17' },
      { category: '办公用品', weighted_discount_approx: '0.14' },
    ]
  );
  assert('T-A.5 list-of-objects approx matches within 4-decimal tolerance', r.ok, JSON.stringify(r));
}
{
  // join-001: tables list-set
  const r = matchListSet(['superstore_orders', 'superstore_people'], ['superstore_people', 'superstore_orders']);
  assert('T-A.5 list-set order-independent', r.ok, JSON.stringify(r));
}
{
  // multiturn-001: boolean
  const r = checkResultMatch({ must_use_same_measure_as_predecessor: true }, { must_use_same_measure_as_predecessor: true });
  assert('T-A.5 boolean matches', r.ok, JSON.stringify(r));
}

// ── T-A.6: checkTextResponse ───────────────────────────────────────────────

{
  const r = checkTextResponse('Semantic Layer 未覆盖这个 measure，建议降级到 raw SQL；关键假设需要列出。', {
    must_mention: ['semantic layer 未覆盖', 'raw sql', '假设'],
  });
  assert('T-A.6 must_mention all hit (normalized)', r.ok, JSON.stringify(r));
}
{
  const r = checkTextResponse('这是文本，但没有 mention 这个关键词', { must_mention: ['semantic layer 未覆盖'] });
  assert('T-A.6 must_mention missing one', !r.ok && r.missing.length === 1, JSON.stringify(r));
}
{
  const r = checkTextResponse('measure 是 weighted_discount', { measure_name: 'weighted_discount' });
  assert('T-A.6 measure_name normalized match', r.ok, JSON.stringify(r));
}

// ── extra: normalizeText ───────────────────────────────────────────────────

{
  const n = normalizeText('  Hello, World! 折扣超过 20% 的行。  ');
  assert('normalizeText strips punct & collapses whitespace', n === 'hello world 折扣超过 20 的行', n);
}
{
  assert('matchApprox basic', matchApprox(0.13981, '0.1398', 4) === true, 'approx should match');
  assert('matchApprox tolerance', matchApprox(0.14, '0.1399', 4) === false, 'approx at 4dp should reject');
}

// ── summarize ──────────────────────────────────────────────────────────────

console.log(`# test: pass=${pass} fail=${fail}`);
if (fail > 0) {
  for (const f of failures) console.log(`FAIL: ${f.name} — ${JSON.stringify(f.detail)}`);
  process.exit(1);
} else {
  console.log('# all tests passed');
  process.exit(0);
}
