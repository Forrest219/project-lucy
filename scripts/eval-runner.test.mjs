#!/usr/bin/env node
// scripts/eval-runner.test.mjs — minimal unit tests for T-A.3~T-A.6 helpers.
// Run with: node scripts/eval-runner.test.mjs (no test framework; asserts via process.exit).

import {
  parseArgs,
  parseClaudeOutput,
  checkSqlPatterns,
  checkSqlAssertions,
  checkToolAssertions,
  checkResultMatch,
  checkResultAssertions,
  chooseBestCandidate,
  checkTextResponse,
  normalizeText,
  composeQuestion,
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

{
  const parsed = parseArgs(['node', 'eval-runner', '--retries', '2', '--case', 'kx-cashflow-001']);
  assert('parseArgs supports --retries', parsed.retries === 2 && parsed.cases[0] === 'kx-cashflow-001', JSON.stringify(parsed));
}
{
  const oldRetries = process.env.EVAL_RETRIES;
  process.env.EVAL_RETRIES = '3';
  const parsed = parseArgs(['node', 'eval-runner']);
  if (oldRetries === undefined) delete process.env.EVAL_RETRIES;
  else process.env.EVAL_RETRIES = oldRetries;
  assert('parseArgs supports EVAL_RETRIES default', parsed.retries === 3, JSON.stringify(parsed));
}
{
  let threw = false;
  try {
    parseArgs(['node', 'eval-runner', '--retries', '-1']);
  } catch {
    threw = true;
  }
  assert('parseArgs rejects negative retries', threw, 'expected parseArgs to throw');
}

{
  const stdout = JSON.stringify({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'call_sql',
          name: 'mcp__ktx__sql_execution',
          input: {
            connectionId: 'mysql-aliyun',
            sql: 'SELECT COUNT(*) AS row_count FROM kx_fact_financial_amount',
          },
        },
      ],
    },
  }) + '\n' + JSON.stringify({
    type: 'user',
    message: {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_sql',
          content: [{ type: 'text', text: JSON.stringify({
            headers: ['row_count'],
            rows: [[2330]],
          }) }],
        },
      ],
    },
  });

  const parsed = parseClaudeOutput(stdout);
  assert('parseClaudeOutput extracts sql_execution input SQL', parsed.sql.includes('kx_fact_financial_amount'), parsed.sql);
  assert('parseClaudeOutput parses sql_execution rows', parsed.result.row_count === 2330, JSON.stringify(parsed.result));
  assert('parseClaudeOutput records KTX tool candidates', parsed.toolCandidates.length === 1, JSON.stringify(parsed.toolCandidates));
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
{
  const r = checkSqlAssertions(
    "SELECT COUNT(*) AS row_count, COUNT(DISTINCT report_period) AS periods FROM kx_fact_financial_amount",
    [
      { type: 'required_ast', value: 'COUNT(*)', normalize: true },
      { type: 'required_normalized_regex', value: 'count\\(distinct report_period\\)', normalize: true },
      { type: 'forbidden_ast', value: 'UPDATE | DELETE | DROP', normalize: true },
    ]
  );
  assert('v1.4 SQL assertions support required_ast and normalized regex', r.ok, JSON.stringify(r));
}
{
  const r = checkSqlAssertions('SELECT SUM(amount) FROM kx_fact_financial_amount', [
    { type: 'forbidden_ast', value: 'SUM(amount)', normalize: true },
  ]);
  assert('v1.4 SQL assertions detect forbidden_ast', !r.ok && r.failures.some((f) => f.includes('forbidden hit')), JSON.stringify(r));
}
{
  const r = checkToolAssertions(
    [{ name: 'mcp__ktx__sl_search', input: { query: 'kx 财务 source' } }],
    [
      { type: 'required_tool', value: 'mcp__ktx__sl_search | mcp__ktx__sl_read_source' },
      { type: 'required_tool_input_regex', value: 'kx' },
      { type: 'forbidden_tool', value: 'mcp__ktx__sql_execution' },
    ]
  );
  assert('v1.4 tool assertions support required/forbidden tools and input regex', r.ok, JSON.stringify(r));
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
{
  const r = checkResultAssertions(
    { rows: [{ report_period: '202605', row_count: 466 }, { report_period: '202604', row_count: 466 }] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202604', row_count: 466 }, { report_period: '202605', row_count: 466 }] },
      compare_mode: 'unordered_rows',
      key_columns: ['report_period'],
      numeric_tolerance: 0,
      check_row_count: true,
    }]
  );
  assert('v1.4 dataframe assertions support unordered_rows keyed compare', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    { rows: [{ report_period: '202605' }] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202605', row_count: 466 }] },
      compare_mode: 'unordered_rows',
      key_columns: ['report_period'],
      check_schema: true,
      check_row_count: false,
    }]
  );
  assert('v1.4 dataframe schema check fails missing expected columns', !r.ok && r.mismatches.some((m) => m.includes('missing column row_count')), JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    { rows: [{ 报表期间: '202605', 项目名称: '货币资金', 期末余额: 25872.08, 年初余额: 15871.88 }] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202605', item_name: '货币资金', end_balance: 25872.08, begin_balance: 15871.88 }] },
      compare_mode: 'unordered_rows',
      key_columns: ['report_period', 'item_name'],
      numeric_tolerance: 0.01,
      check_row_count: true,
    }]
  );
  assert('v1.4 dataframe assertions map Chinese KX view columns to canonical aliases', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    { rows: [{ report_period: '202605', item_name: '一、营业收入', amount_type: 'current_month', amount: null }] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202605', item_name: '一、营业收入', current_month_amount: null }] },
      compare_mode: 'subset',
      key_columns: ['report_period', 'item_name'],
      check_row_count: false,
    }]
  );
  assert('v1.4 dataframe assertions map amount+amount_type to current_month_amount', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    { rows: [{ report_period: '202605', item_name: '五、期末现金余额', amount_cumulative_ytd: 25872.08, amount_current_month: 25872.08 }] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202605', item_name: '五、期末现金余额', amount: 25872.08 }] },
      compare_mode: 'unordered_rows',
      key_columns: ['report_period', 'item_name'],
      numeric_tolerance: 0.01,
      check_schema: true,
      check_row_count: false,
    }]
  );
  assert('v1.4 dataframe assertions map KX cumulative/current aliases to amount', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    { rows: [
      { report_period: '202605', item_name: '五、期末现金余额', amount: 0 },
      { report_period: '202605', item_name: '五、期末现金余额', amount: 25872.08 },
    ] },
    '',
    [{
      value_type: 'dataframe',
      data: { rows: [{ report_period: '202605', item_name: '五、期末现金余额', amount: 25872.08 }] },
      compare_mode: 'unordered_rows',
      key_columns: ['report_period', 'item_name'],
      numeric_tolerance: 0.01,
      check_row_count: false,
    }]
  );
  assert('v1.4 dataframe assertions choose matching duplicate-key row', r.ok, JSON.stringify(r));
}
{
  const selected = chooseBestCandidate(
    {
      result_assertions: [{
        value_type: 'dataframe',
        data: {
          rows: [
            { source_name: 'kx_vw_balance_sheet_detail', row_count: 310 },
            { source_name: 'kx_vw_cash_flow_statement_detail', row_count: 125 },
          ],
        },
        compare_mode: 'unordered_rows',
        key_columns: ['source_name'],
        check_row_count: true,
      }],
    },
    {
      finalText: '',
      toolCalls: [],
      sql: 'SELECT one source',
      result: { source_name: 'kx_vw_cash_flow_statement_detail', row_count: 125 },
      resultRaw: {},
      toolCandidates: [
        {
          toolName: 'mcp__ktx__sql_execution',
          sql: 'SELECT balance',
          result: { source_name: 'kx_vw_balance_sheet_detail', row_count: 310 },
          resultRaw: {},
        },
        {
          toolName: 'mcp__ktx__sql_execution',
          sql: 'SELECT cashflow',
          result: { source_name: 'kx_vw_cash_flow_statement_detail', row_count: 125 },
          resultRaw: {},
        },
      ],
    }
  );
  assert(
    'chooseBestCandidate can merge rows across multiple tool candidates',
    selected.ok && selected.candidate.toolName === 'merged_tool_candidates',
    JSON.stringify(selected)
  );
}
{
  const r = checkResultAssertions(
    { row_count: 2330, periods: 5 },
    '',
    [{ value_type: 'scalar', data: { row_count: 2330, periods: 5 }, numeric_tolerance: 0, compare_mode: 'exact' }]
  );
  assert('v1.4 scalar assertions compare single-row object', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    {},
    '通过 KTX 语义层检索 kx_ 前缀的 source，共 **6 个**：',
    [{ value_type: 'scalar', data: { source_count: 6 }, numeric_tolerance: 0, compare_mode: 'exact' }]
  );
  assert('v1.4 scalar assertions can extract source_count from final text', r.ok, JSON.stringify(r));
}
{
  const r = checkResultAssertions(
    {},
    'KX 财务表不含 is_deleted，不要套用超市软删除过滤，应按 report_period 过滤',
    [{
      value_type: 'text',
      data: { must_mention: ['KX 财务表不含 is_deleted', 'report_period'], must_not_mention: ['WHERE is_deleted = 0'] },
      compare_mode: 'subset',
    }]
  );
  assert('v1.4 text assertions support must_mention and must_not_mention', r.ok, JSON.stringify(r));
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

// ── composeQuestion domain/source routing ──────────────────────────────────

{
  const q = composeQuestion({
    question: 'KX 财报金额事实表有多少行？',
    domain: 'kx_financial',
    expected_source: 'raw_sql_fallback',
    result_assertions: [{ value_type: 'scalar', data: { row_count: 2330 } }],
  });
  assert('composeQuestion KX raw SQL uses sql_execution', q.includes('sql_execution'), q);
  assert('composeQuestion KX raw SQL does not hardcode superstore_orders', !q.includes('superstore_orders.<measure>'), q);
  assert('composeQuestion KX raw SQL includes expected result aliases only, not values', q.includes('row_count') && !q.includes('2330'), q);
}

{
  const q = composeQuestion({
    question: 'KTX 里 KX 财务域现在有几个 source？',
    domain: 'kx_financial',
    expected_source: 'semantic_layer',
  });
  assert('composeQuestion KX semantic layer routes to sl_read/sl_search', q.includes('sl_read_source') && q.includes('sl_search'), q);
  assert('composeQuestion KX semantic layer warns against is_deleted', q.includes('不要套用 superstore') && q.includes('is_deleted'), q);
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
