#!/usr/bin/env node
// scripts/eval-runner.mjs — Project Lucy eval runner (P3-A · path A: Claude Code subprocess)
// T-A.2~T-A.8: MCP config gen · claude CLI spawn · output parsing · SQL pattern checks
//              · 9-type result matchers · text response matcher · shell wrapper is sibling

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_CASES_PATH = 'evals/superstore/eval/superstore-eval-cases.yaml';
const EVAL_MCP_PATH = process.env.EVAL_MCP_CONFIG || '/tmp/eval-mcp.json';
const KTX_MCP_URL = process.env.EVAL_KTX_MCP_URL || 'http://localhost:7878/mcp';

const USAGE = `Usage: node scripts/eval-runner.mjs [options]

Project Lucy eval runner — drives Claude Code CLI against KTX MCP tools
and checks the produced SQL / result / text against expected_result.

Options:
  --list-cases            Print all case ids and exit (no LLM calls)
  --case <id>             Run only the case with this id (repeatable)
  --format <md|json>      Output format (default: md)
  --cases <path>          Path to eval cases YAML (default: ${DEFAULT_CASES_PATH})
  --write-latest          Also write .ktx-ui/eval/latest.{md,json} (default: off)
  --help                  Show this help

Environment:
  EVAL_MCP_CONFIG         Override path for generated MCP config file
                          (default: /tmp/eval-mcp.json)
  EVAL_KTX_MCP_URL        Override KTX MCP URL (default: ${KTX_MCP_URL})
`;

// ─── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    cases: [],
    format: 'md',
    listCases: false,
    casesPath: DEFAULT_CASES_PATH,
    writeLatest: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--list-cases':
        args.listCases = true;
        break;
      case '--case':
        args.cases.push(argv[++i]);
        break;
      case '--cases':
        args.casesPath = argv[++i];
        break;
      case '--format':
        args.format = argv[++i];
        break;
      case '--write-latest':
        args.writeLatest = true;
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return args;
}

// ─── YAML loading ───────────────────────────────────────────────────────────

function loadCases(casesPath) {
  const abs = resolve(REPO_ROOT, casesPath);
  const raw = readFileSync(abs, 'utf8');
  const doc = parseYaml(raw);
  if (!doc || !Array.isArray(doc.cases)) {
    throw new Error(`bad cases yaml: expected top-level 'cases' array at ${abs}`);
  }
  return { abs, cases: doc.cases };
}

// ─── T-A.2: buildEvalMcpConfig + invokeClaudeCode ──────────────────────────

function buildEvalMcpConfig(targetPath = EVAL_MCP_PATH) {
  // Bypass MCP Auth Proxy (.mcp.json points to 7879 with Bearer; we want direct 7878).
  const cfg = {
    mcpServers: {
      ktx: {
        type: 'http',
        url: KTX_MCP_URL,
      },
    },
  };
  writeFileSync(targetPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  return targetPath;
}

function runCliCapture(cmd, args, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout after ${timeoutMs}ms: ${cmd} ${args.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

async function preflightClaude() {
  const verRes = await runCliCapture('claude', ['--version'], { timeoutMs: 10000 });
  if (verRes.code !== 0) {
    throw new Error(`claude --version failed (code=${verRes.code}): ${verRes.err.trim()}`);
  }
  const authRes = await runCliCapture('claude', ['auth', 'status'], { timeoutMs: 15000 });
  if (authRes.code !== 0) {
    throw new Error(
      `claude auth status failed (code=${authRes.code}). ` +
        `Please run \`claude login\` first. stderr: ${authRes.err.trim()}`
    );
  }
  // sanity: auth status must mention loggedIn or apiProvider
  if (!/loggedIn|apiProvider/.test(authRes.out)) {
    throw new Error(`claude auth status returned unexpected output: ${authRes.out.slice(0, 200)}`);
  }
  return { version: verRes.out.trim(), auth: authRes.out.trim() };
}

async function invokeClaudeCode(question, mcpConfigPath, { timeoutMs = 360000 } = {}) {
  const args = [
    '-p',
    question,
    '--output-format',
    'stream-json',
    '--verbose',
    '--mcp-config',
    mcpConfigPath,
    '--strict-mcp-config',
    '--permission-mode',
    'bypassPermissions',
  ];
  const res = await runCliCapture('claude', args, { timeoutMs });
  return { ...res, args };
}

// ─── T-A.3: parseClaudeOutput ──────────────────────────────────────────────

function parseClaudeOutput(stdout) {
  // claude -p --output-format stream-json --verbose emits one JSON object per line:
  //   {type:"system", subtype:"init", ...}
  //   {type:"assistant", message:{content:[{type:"thinking|tool_use|text", ...}]}}
  //   {type:"user", message:{content:[{type:"tool_result", tool_use_id, content:[{type:"text", text:"<json>"}]}]}}
  //   {type:"result", subtype:"success", result:"<final assistant text>"}
  // We extract: (a) the sl_query tool_use + matching tool_result; (b) the final assistant text.

  const lines = stdout.split('\n').filter((l) => l.trim().length > 0);
  const events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // skip non-JSON noise lines
    }
  }

  // Track tool_use_id → tool name/input, so we can match tool_result blocks back
  const toolUseById = new Map();
  const toolResults = new Map(); // tool_use_id → parsed JSON object

  const textChunks = [];
  const toolCalls = [];

  function unwrapStructured(content) {
    // tool_result.content may be a JSON string, an array of {type:"text", text}, or already an object.
    if (content == null) return null;
    if (typeof content === 'string') {
      try { return JSON.parse(content); } catch { return { raw: content }; }
    }
    if (Array.isArray(content)) {
      // Concatenate text blocks; then JSON.parse if possible
      const text = content
        .filter((b) => b && (b.type === 'text' || typeof b === 'string'))
        .map((b) => (typeof b === 'string' ? b : b.text || ''))
        .join('\n');
      try { return JSON.parse(text); } catch { return { raw: text }; }
    }
    if (typeof content === 'object') return content;
    return null;
  }

  function rowsToObjects(parsed) {
    // KTX sl_query returns {headers: [...], rows: [[...], ...]}.
    // Convert to {header1: row0val, header2: row0val, ...} (single-row assumed) or
    // {rows: [{...}, ...]} for multi-row.
    if (!parsed || !Array.isArray(parsed.headers)) return parsed;
    if (!Array.isArray(parsed.rows)) return parsed;
    if (parsed.rows.length === 1) {
      const obj = {};
      parsed.headers.forEach((h, i) => {
        const v = parsed.rows[0][i];
        const n = Number(v);
        obj[h] = Number.isFinite(n) && String(n) === String(v) ? n : v;
      });
      // Preserve sql if present
      if (parsed.sql) obj.sql = parsed.sql;
      return obj;
    }
    const arr = parsed.rows.map((row) => {
      const o = {};
      parsed.headers.forEach((h, i) => {
        const v = row[i];
        const n = Number(v);
        o[h] = Number.isFinite(n) && String(n) === String(v) ? n : v;
      });
      return o;
    });
    const obj = { rows: arr, totalRows: parsed.totalRows ?? arr.length };
    if (parsed.sql) obj.sql = parsed.sql;
    return obj;
  }

  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;

    // Final summary: {type:"result", result:"<text>"}
    if (ev.type === 'result' && typeof ev.result === 'string') {
      textChunks.push(ev.result);
      continue;
    }

    const msg = ev.message || ev;
    const content = msg && Array.isArray(msg.content) ? msg.content : [];

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;

      if (block.type === 'text' && typeof block.text === 'string') {
        textChunks.push(block.text);
      } else if (block.type === 'tool_use') {
        const name = block.name || '';
        const id = block.id || block.tool_use_id || '';
        const input = block.input || {};
        if (id) toolUseById.set(id, { name, input });
        toolCalls.push({ id, name, input });
      } else if (block.type === 'tool_result') {
        const id = block.tool_use_id || block.id || '';
        const parsed = unwrapStructured(block.content);
        if (parsed) toolResults.set(id, parsed);
      }
    }
  }

  // Find the sl_query call (last one wins if multiple)
  let sqlTool = null;
  for (const c of toolCalls) {
    if (c.name === 'mcp__ktx__sl_query') sqlTool = c;
  }

  let sql = null;
  let sqlArgs = null;
  let result = null;
  let resultRaw = null;

  if (sqlTool) {
    sqlArgs = sqlTool.input;
    // The SQL is returned in tool_result.content.sql when include:["sql"] is set;
    // fall back to extracting from text if present.
    const toolRes = sqlTool.id ? toolResults.get(sqlTool.id) : null;
    if (toolRes) {
      resultRaw = toolRes;
      // If response has sql field, surface it
      if (typeof toolRes.sql === 'string') sql = toolRes.sql;
      // Normalize headers+rows → object
      result = rowsToObjects(toolRes);
    }
    // Also peek at notes or sql in nested fields
    if (!sql && resultRaw && typeof resultRaw === 'object' && resultRaw.sql) {
      sql = resultRaw.sql;
    }
  } else {
    // No sl_query called — try to recover from any tool_result (e.g. sql_execution)
    const last = Array.from(toolResults.entries()).pop();
    if (last) {
      resultRaw = last[1];
      if (resultRaw && resultRaw.sql) sql = resultRaw.sql;
      result = rowsToObjects(resultRaw);
    }
  }

  const finalText = textChunks.length > 0 ? textChunks[textChunks.length - 1] : '';
  return { sql, sqlArgs, result, resultRaw, finalText, toolCalls };
}

// ─── T-A.4: SQL pattern checks ─────────────────────────────────────────────

function normalizeSqlForMatching(sql) {
  // Strip table alias prefixes from column refs so patterns like "SUM(discount * sales)"
  // still match generated SQL like "SUM(superstore_orders.discount * superstore_orders.sales)".
  // Also collapse whitespace.
  if (sql == null) return '';
  let s = String(sql);
  s = s.replace(/\b[A-Za-z_][A-Za-z0-9_]*\./g, ''); // strip any alias.column
  s = s.replace(/\s+/g, ' ');
  return s;
}

function escapeRegexLiteral(s) {
  // Treat the yaml pattern as a literal substring, escape regex metacharacters.
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function checkSqlPatterns(sql, required, forbidden) {
  const reqList = Array.isArray(required) ? required : [];
  const forbList = Array.isArray(forbidden) ? forbidden : [];
  const sqlStr = sql == null ? '' : String(sql);
  const sqlNorm = normalizeSqlForMatching(sql);
  const failures = [];
  const requiredHits = [];
  for (const p of reqList) {
    const re = new RegExp(escapeRegexLiteral(p), 'i');
    if (re.test(sqlStr) || re.test(sqlNorm)) requiredHits.push(p);
    else failures.push(`required missing: ${p}`);
  }
  const forbiddenHits = [];
  for (const p of forbList) {
    const re = new RegExp(escapeRegexLiteral(p), 'i');
    if (re.test(sqlStr) || re.test(sqlNorm)) {
      forbiddenHits.push(p);
      failures.push(`forbidden hit: ${p}`);
    }
  }
  return { ok: failures.length === 0, failures, requiredHits, forbiddenHits };
}

// ─── T-A.5: 9-way result matcher ───────────────────────────────────────────

function normalizeNumber(x) {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function approxEq(a, b, places = 4) {
  const na = normalizeNumber(a);
  const nb = normalizeNumber(b);
  if (na == null || nb == null) return false;
  // Auto-detect places from expected (b). If b is "0.17", places = 2.
  let actualPlaces = places;
  if (typeof b === 'string' && b.includes('.')) {
    const frac = b.split('.')[1] || '';
    actualPlaces = Math.max(frac.length, 1);
  } else if (typeof b === 'string') {
    actualPlaces = 0;
  }
  const f = Math.pow(10, actualPlaces);
  return Math.round(na * f) / f === Math.round(nb * f) / f;
}

function signOf(x) {
  const n = normalizeNumber(x);
  if (n == null) return null;
  if (n < 0) return 'negative';
  if (n > 0) return 'positive';
  return 'zero';
}

function matchExact(actual, expected) {
  return actual === expected || String(actual) === String(expected);
}

function matchApprox(actual, expected) {
  return approxEq(actual, expected, 4);
}

function matchSign(actual, expected) {
  return signOf(actual) === expected;
}

function matchTextEqual(actual, expected) {
  return normalizeText(actual) === normalizeText(expected);
}

function matchTextContains(actual, expected) {
  return normalizeText(actual).includes(normalizeText(expected));
}

function matchMustMentionList(actual, expectedList) {
  const normActual = normalizeText(actual);
  const missing = [];
  for (const kw of expectedList) {
    if (!normActual.includes(normalizeText(kw))) missing.push(kw);
  }
  return { ok: missing.length === 0, missing };
}

function matchListOfObjects(actualList, expectedList) {
  // Each row: compare each key via approx (and any non-numeric via text-contains)
  const out = { ok: true, mismatches: [] };
  if (!Array.isArray(actualList) || !Array.isArray(expectedList)) {
    return { ok: false, mismatches: [`list-of-objects: actual or expected not array`] };
  }
  if (actualList.length !== expectedList.length) {
    out.ok = false;
    out.mismatches.push(`list-of-objects: length ${actualList.length} != expected ${expectedList.length}`);
    return out;
  }
  for (let i = 0; i < expectedList.length; i++) {
    const exp = expectedList[i] || {};
    const act = actualList[i] || {};
    for (const k of Object.keys(exp)) {
      const ev = exp[k];
      if (typeof ev === 'string' && /_approx$/.test(k)) {
        if (!approxEq(act[k], ev, 4)) {
          out.ok = false;
          out.mismatches.push(`row[${i}].${k}: actual=${act[k]} expected~${ev}`);
        }
      } else {
        if (!matchTextContains(act[k], ev)) {
          out.ok = false;
          out.mismatches.push(`row[${i}].${k}: actual=${act[k]} expected~${ev}`);
        }
      }
    }
  }
  return out;
}

function matchListSet(actualList, expectedList) {
  const a = new Set(Array.isArray(actualList) ? actualList.map(String) : []);
  const e = new Set(Array.isArray(expectedList) ? expectedList.map(String) : []);
  if (a.size !== e.size) return { ok: false, mismatches: [`list-set: size ${a.size} != ${e.size}`] };
  for (const v of e) {
    if (!a.has(v)) return { ok: false, mismatches: [`list-set: missing ${v}`] };
  }
  return { ok: true, mismatches: [] };
}

function matchBoolean(actual, expected) {
  return Boolean(actual) === Boolean(expected);
}

function checkResultMatch(actual, expected) {
  const mismatches = [];
  if (actual == null || typeof actual !== 'object') {
    return { ok: false, mismatches: [`result: actual is null/non-object`] };
  }
  if (expected == null || typeof expected !== 'object') {
    return { ok: false, mismatches: [`result: expected is null/non-object`] };
  }
  let allOk = true;
  for (const key of Object.keys(expected)) {
    const exp = expected[key];
    const act = actual[key];
    if (Array.isArray(exp) && key === 'must_mention') {
      // skip must_mention here; handled by checkTextResponse
      continue;
    }
    if (Array.isArray(exp) && exp.length > 0 && typeof exp[0] === 'object') {
      const r = matchListOfObjects(act, exp);
      if (!r.ok) {
        allOk = false;
        mismatches.push(...r.mismatches.map((m) => `${key}: ${m}`));
      }
      continue;
    }
    if (Array.isArray(exp)) {
      const r = matchListSet(act, exp);
      if (!r.ok) {
        allOk = false;
        mismatches.push(...r.mismatches.map((m) => `${key}: ${m}`));
      }
      continue;
    }
    if (/_sign$/.test(key)) {
      if (!matchSign(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual=${act} sign!=${exp}`);
      }
      continue;
    }
    if (/_approx$/.test(key)) {
      if (!matchApprox(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual=${act} expected~${exp}`);
      }
      continue;
    }
    if (typeof exp === 'boolean') {
      if (!matchBoolean(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual=${act} != ${exp}`);
      }
      continue;
    }
    // numeric string ("0.1398") → approx; bare number → exact
    if (typeof exp === 'string' && Number.isFinite(Number(exp)) && Number(exp) !== 0) {
      if (!matchApprox(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual=${act} expected~${exp}`);
      }
      continue;
    }
    if (typeof exp === 'number') {
      if (!matchExact(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual=${act} != ${exp}`);
      }
      continue;
    }
    if (typeof exp === 'string' && (key === 'description' || key === 'today_observed' || key === 'explanation')) {
      if (!matchTextContains(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual="${String(act).slice(0, 60)}..." not contains "${exp}"`);
      }
      continue;
    }
    if (typeof exp === 'string' && (key === 'measure_name' || key === 'expr' || key === 'filter_pattern')) {
      if (!matchTextContains(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual="${String(act).slice(0, 80)}" not contains "${exp}"`);
      }
      continue;
    }
    // text-equal fallback (string)
    if (typeof exp === 'string') {
      if (!matchTextEqual(act, exp)) {
        allOk = false;
        mismatches.push(`${key}: actual="${act}" != "${exp}"`);
      }
      continue;
    }
  }
  return { ok: allOk, mismatches };
}

// ─── T-A.6: text response matcher ──────────────────────────────────────────

const PUNCT_RE = /[\s　\-_—–，。！？：；、（）()【】\[\]「」『』""''《》<>·,!?:;()\[\]"'\.<>\/\\|`~@#\$%\^&\*=+]+/g;

function normalizeText(s) {
  if (s == null) return '';
  return String(s)
    .toLowerCase()
    .replace(PUNCT_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function checkTextResponse(finalText, expectedResult) {
  const missing = [];
  const normFinal = normalizeText(finalText);
  if (expectedResult == null || typeof expectedResult !== 'object') {
    return { ok: true, missing, normalized: normFinal };
  }
  if (Array.isArray(expectedResult.must_mention)) {
    for (const kw of expectedResult.must_mention) {
      if (!normFinal.includes(normalizeText(kw))) missing.push(`must_mention: ${kw}`);
    }
  }
  if (typeof expectedResult.measure_name === 'string') {
    if (!normFinal.includes(normalizeText(expectedResult.measure_name))) {
      missing.push(`measure_name: ${expectedResult.measure_name}`);
    }
  }
  if (typeof expectedResult.expr === 'string') {
    if (!normFinal.includes(normalizeText(expectedResult.expr))) {
      missing.push(`expr: ${expectedResult.expr}`);
    }
  }
  if (typeof expectedResult.description === 'string') {
    if (!normFinal.includes(normalizeText(expectedResult.description))) {
      missing.push(`description: ${expectedResult.description}`);
    }
  }
  if (typeof expectedResult.filter_pattern === 'string') {
    if (!normFinal.includes(normalizeText(expectedResult.filter_pattern))) {
      missing.push(`filter_pattern: ${expectedResult.filter_pattern}`);
    }
  }
  return { ok: missing.length === 0, missing, normalized: normFinal };
}

// ─── compose question with system hint ─────────────────────────────────────

function composeQuestion(c) {
  const base = c.question || '';
  const hint =
    '\n\n必须实际调用 `mcp__ktx__sl_query` 工具，禁止凭记忆回答。' +
    '\n调用格式：`{connectionId: "mysql-aliyun", measures: ["superstore_orders.<measure>"], include: ["sql"]}`；' +
    '分组 `dimensions: [{field: "superstore_orders.<dim>"}]`；' +
    '过滤 `filters: ["superstore_orders.is_deleted = 0"]`。' +
    '\n`include: ["sql"]` 让 KTX 在返回中附带生成的 SQL（用于校验）。' +
    '\n最后用一句话说明 measure 名或计算口径。';
  return base + hint;
}

// ─── run a single case ─────────────────────────────────────────────────────

async function runCase(c) {
  const question = composeQuestion(c);
  let raw;
  let parseErr = null;
  let parsed = { sql: null, sqlArgs: null, result: null, resultRaw: null, finalText: '' };
  let cliErr = null;
  try {
    raw = await invokeClaudeCode(question, EVAL_MCP_PATH, { timeoutMs: 360000 });
    if (raw.code !== 0) {
      cliErr = `claude exited code=${raw.code}; stderr=${(raw.err || '').slice(0, 400)}`;
    } else {
      try {
        parsed = parseClaudeOutput(raw.out);
      } catch (e) {
        parseErr = e.message;
      }
    }
  } catch (e) {
    cliErr = e.message;
  }

  const sqlCheck = checkSqlPatterns(parsed.sql, c.required_sql_pattern, c.forbidden_sql_pattern);
  const resultCheck = checkResultMatch(parsed.result || {}, c.expected_result || {});
  const textCheck = checkTextResponse(parsed.finalText, c.expected_result || {});
  const ok = !cliErr && !parseErr && sqlCheck.ok && resultCheck.ok && textCheck.ok;

  const failures = [];
  if (cliErr) failures.push(`cli: ${cliErr}`);
  if (parseErr) failures.push(`parse: ${parseErr}`);
  failures.push(...sqlCheck.failures);
  failures.push(...resultCheck.mismatches);
  failures.push(...textCheck.missing);

  return {
    id: c.id,
    pass: ok,
    failures,
    sql: parsed.sql,
    finalText: parsed.finalText,
    finalTextSnippet: parsed.finalText ? parsed.finalText.slice(0, 200) : '',
    result: parsed.result,
    requiredHits: sqlCheck.requiredHits,
    forbiddenHits: sqlCheck.forbiddenHits,
  };
}

// ─── summary + output formatting ───────────────────────────────────────────

function summarize(entries) {
  const total = entries.length;
  const pass = entries.filter((e) => e.pass).length;
  const fail = total - pass;
  return { total, pass, fail, cases: entries };
}

function formatMarkdown(summary, { casesAbs } = {}) {
  const lines = [];
  lines.push('# project-lucy eval report');
  lines.push('');
  lines.push(`- cases: ${summary.total}`);
  lines.push(`- pass: ${summary.pass}`);
  lines.push(`- fail: ${summary.fail}`);
  lines.push(`- result: ${summary.total} cases · ${summary.pass} pass · ${summary.fail} fail`);
  if (casesAbs) lines.push(`- source: ${casesAbs}`);
  lines.push('');
  for (const e of summary.cases) {
    lines.push(`## ${e.id}`);
    lines.push(`- pass: ${e.pass ? 'PASS' : 'FAIL'}`);
    if (e.sql) {
      lines.push('- sql:');
      lines.push('```sql');
      lines.push(String(e.sql).trim());
      lines.push('```');
    } else {
      lines.push('- sql: (none captured)');
    }
    if (e.failures.length > 0) {
      lines.push('- failures:');
      for (const f of e.failures) lines.push(`  - ${f}`);
    }
    lines.push('- finalTextSnippet:');
    lines.push('```');
    lines.push((e.finalTextSnippet || '').toString());
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (err) {
    console.error(`error: ${err.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { abs: casesAbs, cases } = loadCases(args.casesPath);
  const selected = args.cases.length > 0 ? cases.filter((c) => args.cases.includes(c.id)) : cases;

  if (args.listCases) {
    for (const c of cases) process.stdout.write(`${c.id}\n`);
    process.stderr.write(`# loaded ${cases.length} case(s) from ${casesAbs}\n`);
    return;
  }

  process.stderr.write(`# eval runner: ${selected.length}/${cases.length} case(s) from ${casesAbs}\n`);

  // T-A.2: write MCP config and fail-fast on claude CLI
  buildEvalMcpConfig(EVAL_MCP_PATH);
  process.stderr.write(`# wrote MCP config → ${EVAL_MCP_PATH} (url=${KTX_MCP_URL})\n`);
  const pre = await preflightClaude();
  process.stderr.write(`# preflight ok: ${pre.version}\n`);

  const entries = [];
  for (const c of selected) {
    process.stderr.write(`# running ${c.id}\n`);
    const entry = await runCase(c);
    entries.push(entry);
    process.stderr.write(`#   ${c.id} → ${entry.pass ? 'PASS' : 'FAIL'}\n`);
  }

  const summary = summarize(entries);
  const md = formatMarkdown(summary, { casesAbs });
  const json = JSON.stringify(summary, null, 2);

  if (args.writeLatest) {
    const evalDir = resolve(REPO_ROOT, '.ktx-ui/eval');
    mkdirSync(evalDir, { recursive: true });
    writeFileSync(join(evalDir, 'latest.md'), md, 'utf8');
    writeFileSync(join(evalDir, 'latest.json'), json, 'utf8');
    process.stderr.write(`# wrote .ktx-ui/eval/latest.{md,json}\n`);
  }

  if (args.format === 'json') {
    process.stdout.write(json);
  } else {
    process.stdout.write(md);
  }

  process.exit(summary.fail === 0 ? 0 : 1);
}

// Export internals for unit tests when invoked as a module
export {
  buildEvalMcpConfig,
  parseClaudeOutput,
  checkSqlPatterns,
  checkResultMatch,
  checkTextResponse,
  normalizeText,
  normalizeSqlForMatching,
  matchExact,
  matchApprox,
  matchSign,
  matchTextEqual,
  matchTextContains,
  matchMustMentionList,
  matchListOfObjects,
  matchListSet,
  matchBoolean,
};

// Only run main() when this file is the entry point (not when imported for tests).
// Detection: when imported, import.meta.url points to this file but process.argv[1]
// points to the importer. Compare their real paths.
import { realpathSync } from 'node:fs';
const isEntry = (() => {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((err) => {
    console.error(`fatal: ${err.stack || err.message || err}`);
    process.exit(2);
  });
}


