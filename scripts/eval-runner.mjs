#!/usr/bin/env node
// scripts/eval-runner.mjs — Project Lucy eval runner (P3-A · path A: Claude Code subprocess)
// T-A.2~T-A.8: MCP config gen · claude CLI spawn · output parsing · SQL pattern checks
//              · 9-type result matchers · text response matcher · shell wrapper is sibling

import { chmodSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_CASES_PATH = 'evals/superstore/eval/superstore-eval-cases.yaml';
const EVAL_MCP_PATH = process.env.EVAL_MCP_CONFIG || '/tmp/eval-mcp.json';
const KTX_MCP_URL = process.env.EVAL_KTX_MCP_URL || 'http://localhost:7878/mcp';
const KTX_MCP_TOKEN = process.env.EVAL_KTX_MCP_TOKEN || process.env.KTX_MCP_TOKEN || '';
const SHOULD_CLEANUP_EVAL_MCP_CONFIG = !process.env.EVAL_MCP_CONFIG;

const USAGE = `Usage: node scripts/eval-runner.mjs [options]

Project Lucy eval runner — drives Claude Code CLI against KTX MCP tools
and checks the produced SQL / result / text against expected_result.

Options:
  --list-cases            Print all case ids and exit (no LLM calls)
  --case <id>             Run only the case with this id (repeatable)
  --format <md|json>      Output format (default: md)
  --cases <path>          Path to eval cases YAML (default: ${DEFAULT_CASES_PATH})
  --write-latest          Also write .ktx-ui/eval/latest.{md,json} (default: off)
  --retries <n>           Retry a failed case up to n times (default: EVAL_RETRIES or 0)
  --help                  Show this help

Environment:
  EVAL_MCP_CONFIG         Override path for generated MCP config file
                          (default: /tmp/eval-mcp.json)
  EVAL_KTX_MCP_URL        Override KTX MCP URL (default: ${KTX_MCP_URL})
  EVAL_KTX_MCP_TOKEN      Optional bearer token for token-auth MCP endpoints
  KTX_MCP_TOKEN           Fallback bearer token when EVAL_KTX_MCP_TOKEN is unset
  EVAL_RETRIES            Default retry count for failed cases
`;

// ─── arg parsing ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    cases: [],
    format: 'md',
    listCases: false,
    casesPath: DEFAULT_CASES_PATH,
    writeLatest: false,
    retries: parseNonNegativeInt(process.env.EVAL_RETRIES || '0', 'EVAL_RETRIES'),
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
      case '--retries':
        args.retries = parseNonNegativeInt(argv[++i], '--retries');
        break;
      default:
        throw new Error(`unknown arg: ${a}`);
    }
  }
  return args;
}

function parseNonNegativeInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return n;
}

// ─── YAML loading ───────────────────────────────────────────────────────────

function loadCases(casesPath) {
  const abs = resolve(REPO_ROOT, casesPath);
  const raw = readFileSync(abs, 'utf8');
  const doc = parseYaml(raw);
  if (!doc || !Array.isArray(doc.cases)) {
    throw new Error(`bad cases yaml: expected top-level 'cases' array at ${abs}`);
  }
  return { abs, cases: doc.cases, safetyContract: doc.safety_contract || {} };
}

// ─── T-A.2: buildEvalMcpConfig + invokeClaudeCode ──────────────────────────

function buildEvalMcpConfig(targetPath = EVAL_MCP_PATH) {
  // Bypass MCP Auth Proxy by default; add a bearer header only when the caller
  // provides one. Never log or persist the token anywhere except this temp MCP config.
  const server = {
    type: 'http',
    url: KTX_MCP_URL,
  };
  if (KTX_MCP_TOKEN) {
    server.headers = { Authorization: `Bearer ${KTX_MCP_TOKEN}` };
  }
  const cfg = {
    mcpServers: {
      ktx: server,
    },
  };
  writeFileSync(targetPath, JSON.stringify(cfg, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  chmodSync(targetPath, 0o600);
  return targetPath;
}

function cleanupEvalMcpConfig(targetPath = EVAL_MCP_PATH) {
  if (!SHOULD_CLEANUP_EVAL_MCP_CONFIG) return;
  rmSync(targetPath, { force: true });
}

async function preflightKtxMcpEndpoint(url = KTX_MCP_URL, token = KTX_MCP_TOKEN) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let res;
  try {
    res = await fetch(url, { method: 'GET', headers });
  } catch (err) {
    throw new Error(`KTX MCP endpoint is not reachable at ${url}: ${err.message}`);
  }
  if (res.status === 401) {
    throw new Error(
      `KTX MCP endpoint rejected bearer auth at ${url}. ` +
        `Set EVAL_KTX_MCP_TOKEN to the daemon token, refresh KTX_MCP_TOKEN, or restart \`ktx mcp start\` with the expected token.`
    );
  }
  if (res.status === 403) {
    throw new Error(`KTX MCP endpoint rejected access at ${url} (HTTP 403). Check the eval MCP token and endpoint ACL.`);
  }
  if (res.status >= 500) {
    const body = await res.text().catch(() => '');
    const detail = body ? `: ${body.slice(0, 200)}` : '';
    throw new Error(`KTX MCP endpoint is unhealthy at ${url} (HTTP ${res.status})${detail}`);
  }
  return { status: res.status };
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

  function candidateFromTool(c) {
    const toolRes = c.id ? toolResults.get(c.id) : null;
    if (!toolRes) return null;
    const candidate = {
      toolName: c.name,
      sqlArgs: c.input,
      sql: extractSqlFromToolInput(c.input, c.name),
      resultRaw: toolRes,
      result: rowsToObjects(toolRes),
    };
    if (typeof toolRes.sql === 'string') candidate.sql = toolRes.sql;
    if (!candidate.sql && toolRes && typeof toolRes === 'object' && toolRes.sql) candidate.sql = toolRes.sql;
    return candidate;
  }

  const toolCandidates = [];
  const lucyMeta = [];
  const wikiContextEvidence = [];
  const semanticQueries = [];
  for (const c of toolCalls) {
    if (!c.name.startsWith('mcp__ktx__')) continue;
    const candidate = candidateFromTool(c);
    if (candidate) toolCandidates.push(candidate);
    const toolRes = c.id ? toolResults.get(c.id) : null;
    lucyMeta.push(...extractLucyMeta(toolRes, c));
    wikiContextEvidence.push(...extractWikiContextEvidence(c, toolRes));
    semanticQueries.push(...extractSemanticQueries(c, toolRes));
  }

  // Find the data-bearing KTX tool call (last one wins for the default view).
  // sl_query returns generated SQL in its result; sql_execution usually carries
  // SQL in the tool input and result rows in the tool result.
  let sqlTool = null;
  let lastKtxTool = null;
  for (const c of toolCalls) {
    if (c.name.startsWith('mcp__ktx__')) lastKtxTool = c;
    if (c.name === 'mcp__ktx__sl_query' || c.name === 'mcp__ktx__sql_execution') sqlTool = c;
  }

  let sql = null;
  let sqlArgs = null;
  let result = null;
  let resultRaw = null;

  if (sqlTool) {
    sqlArgs = sqlTool.input;
    sql = extractSqlFromToolInput(sqlArgs, sqlTool.name);
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
    if (lastKtxTool) {
      sqlArgs = lastKtxTool.input;
      resultRaw = lastKtxTool.id ? toolResults.get(lastKtxTool.id) : null;
    }
    if (!resultRaw) {
      const last = Array.from(toolResults.entries()).pop();
      if (last) resultRaw = last[1];
    }
    if (resultRaw) {
      if (resultRaw && resultRaw.sql) sql = resultRaw.sql;
      result = rowsToObjects(resultRaw);
    }
  }

  const finalText = textChunks.length > 0 ? textChunks[textChunks.length - 1] : '';
  return { sql, sqlArgs, result, resultRaw, finalText, toolCalls, toolCandidates, lucyMeta, wikiContextEvidence, semanticQueries };
}

function extractLucyMeta(value, call = {}) {
  const out = [];
  const seen = new Set();
  function visit(item) {
    if (!item || typeof item !== 'object') return;
    if (seen.has(item)) return;
    seen.add(item);
    const meta = item._meta?.lucy || item.meta?.lucy || item.lucy;
    if (meta && typeof meta === 'object') {
      out.push({ toolName: call.name || undefined, ...meta });
    }
    for (const nested of Object.values(item)) {
      if (nested && typeof nested === 'object') visit(nested);
    }
  }
  visit(value);
  return out;
}

function textFromToolResult(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value?.content)) {
    return value.content
      .map((block) => typeof block === 'string' ? block : block?.text || '')
      .filter(Boolean)
      .join('\n');
  }
  if (typeof value?.raw === 'string') return value.raw;
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function maybeParseJsonText(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractWikiContextEvidence(call = {}, result) {
  const name = String(call.name || '');
  if (!/(^|__)wiki_(search|read)$/.test(name) && !/(^|__)context_(search|read)$/.test(name)) return [];
  const text = textFromToolResult(result);
  const parsed = maybeParseJsonText(text);
  const records = [];
  const add = (item = {}) => {
    if (!item || typeof item !== 'object') return;
    records.push({
      toolName: name,
      query: call.input?.query,
      key: item.key || item.path,
      title: item.title,
      snippet: item.snippet || (typeof item.content === 'string' ? item.content.slice(0, 240) : undefined)
    });
  };
  if (Array.isArray(parsed)) parsed.forEach(add);
  else if (Array.isArray(parsed?.results)) parsed.results.forEach(add);
  else if (parsed && typeof parsed === 'object') add(parsed);
  if (records.length === 0) records.push({ toolName: name, query: call.input?.query, snippet: text.slice(0, 240) });
  return records;
}

function extractSemanticQueries(call = {}, result) {
  const name = String(call.name || '');
  if (!/(^|__)(sl_query|lucy_query|sql_execution)$/.test(name)) return [];
  return [{
    toolName: name,
    args: call.input || {},
    sql: typeof result?.sql === 'string' ? result.sql : undefined,
    rowCount: Array.isArray(result?.rows) ? result.rows.length : undefined
  }];
}

function extractSqlFromToolInput(input, toolName = '') {
  if (!input || typeof input !== 'object') return null;
  if (toolName && toolName !== 'mcp__ktx__sl_query' && toolName !== 'mcp__ktx__sql_execution') {
    return null;
  }
  for (const key of ['sql', 'query', 'statement']) {
    if (typeof input[key] === 'string') return input[key];
  }
  return null;
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

function normalizeSqlAssertionText(value) {
  return normalizeSqlForMatching(value)
    .replace(/[`"“”‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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

function astLikeRegex(value) {
  const parts = String(value)
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(escapeRegexLiteral);
  return parts.length > 1 ? new RegExp(`\\b(${parts.join('|')})\\b`, 'i') : null;
}

function assertionTarget(sql, normalize = true) {
  const raw = sql == null ? '' : String(sql);
  return normalize ? normalizeSqlAssertionText(raw) : raw;
}

function checkSqlAssertions(sql, assertions = [], legacyRequired = [], legacyForbidden = []) {
  const normalizedAssertions = Array.isArray(assertions) ? assertions : [];
  const failures = [];
  const requiredHits = [];
  const forbiddenHits = [];

  const legacy = checkSqlPatterns(sql, legacyRequired, legacyForbidden);
  failures.push(...legacy.failures);
  requiredHits.push(...legacy.requiredHits);
  forbiddenHits.push(...legacy.forbiddenHits);

  const rawSql = sql == null ? '' : String(sql);
  for (const a of normalizedAssertions) {
    if (!a || typeof a !== 'object') continue;
    const type = String(a.type || '');
    const value = a.value == null ? '' : String(a.value);
    const normalize = a.normalize !== false;
    const target = assertionTarget(rawSql, normalize);
    const pattern = normalize ? normalizeSqlAssertionText(value) : value;
    const label = `${type}: ${value}`;
    const isRequired = type === 'required_ast' || type === 'required_sql_pattern' || type === 'measure_lineage';
    const isForbidden = type === 'forbidden_ast';

    if (type === 'required_normalized_regex' || type === 'forbidden_normalized_regex') {
      const regexTarget = normalizeSqlAssertionText(rawSql);
      const re = new RegExp(value, 'i');
      const hit = re.test(regexTarget);
      if (type === 'required_normalized_regex') {
        if (hit) requiredHits.push(value);
        else failures.push(`required regex missing: ${value}`);
      } else if (hit) {
        forbiddenHits.push(value);
        failures.push(`forbidden regex hit: ${value}`);
      }
      continue;
    }

    const pipeRegex = astLikeRegex(pattern);
    const hit = pipeRegex ? pipeRegex.test(target) : target.includes(pattern);
    if (isRequired) {
      if (hit) requiredHits.push(value);
      else failures.push(`required missing: ${label}`);
      continue;
    }
    if (isForbidden) {
      if (hit) {
        forbiddenHits.push(value);
        failures.push(`forbidden hit: ${label}`);
      }
      continue;
    }
  }

  return { ok: failures.length === 0, failures, requiredHits, forbiddenHits };
}

function toolAssertionTarget(toolCalls = []) {
  return toolCalls
    .map((c) => `${c.name || ''} ${JSON.stringify(c.input || {})}`)
    .join('\n');
}

function shortToolName(name = '') {
  return String(name).replace(/^mcp__ktx__/, '');
}

function inputValueAtPath(input = {}, inputPath = '') {
  if (!inputPath || typeof input !== 'object' || input == null) return undefined;
  const parts = String(inputPath).split('.').filter(Boolean);
  let current = input;
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function summarizeToolCalls(toolCalls = []) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const byTool = {};
  const ktxByShortName = {};
  const inputValueCounts = {};

  for (const call of calls) {
    const name = String(call?.name || '');
    byTool[name] = (byTool[name] || 0) + 1;
    if (name.startsWith('mcp__ktx__')) {
      const shortName = shortToolName(name);
      ktxByShortName[shortName] = (ktxByShortName[shortName] || 0) + 1;
    }
  }

  for (const field of ['sourceName', 'connectionId']) {
    for (const call of calls) {
      const name = String(call?.name || '');
      const value = inputValueAtPath(call?.input || {}, field);
      if (value === undefined || value === null) continue;
      const key = `${name}:${field}`;
      inputValueCounts[key] ||= {};
      const stringValue = String(value);
      inputValueCounts[key][stringValue] = (inputValueCounts[key][stringValue] || 0) + 1;
    }
  }

  return {
    total: calls.length,
    byTool,
    ktxByShortName,
    inputValueCounts,
  };
}

function numericLimit(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function checkToolAssertions(toolCalls = [], assertions = []) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return { ok: true, failures: [], requiredHits: [], forbiddenHits: [], budgetFailures: [] };
  }

  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const target = toolAssertionTarget(calls);
  const failures = [];
  const requiredHits = [];
  const forbiddenHits = [];
  const budgetFailures = [];

  for (const a of assertions) {
    if (!a || typeof a !== 'object') continue;
    const type = String(a.type || '');
    const value = a.value == null ? '' : String(a.value);
    const label = `${type}: ${value}`;

    if (type === 'required_tool' || type === 'forbidden_tool') {
      const re = astLikeRegex(value) || new RegExp(`^${escapeRegexLiteral(value)}$`, 'i');
      const hit = calls.some((c) => re.test(c.name || ''));
      if (type === 'required_tool') {
        if (hit) requiredHits.push(value);
        else failures.push(`required tool missing: ${value}`);
      } else if (hit) {
        forbiddenHits.push(value);
        failures.push(`forbidden tool hit: ${value}`);
      }
      continue;
    }

    if (type === 'required_tool_input_regex' || type === 'forbidden_tool_input_regex') {
      const re = new RegExp(value, 'i');
      const hit = re.test(target);
      if (type === 'required_tool_input_regex') {
        if (hit) requiredHits.push(value);
        else failures.push(`required tool input regex missing: ${value}`);
      } else if (hit) {
        forbiddenHits.push(value);
        failures.push(`forbidden tool input regex hit: ${value}`);
      }
      continue;
    }

    if (type === 'max_total_tool_calls') {
      const max = numericLimit(a.max);
      if (max == null) {
        failures.push(`unsupported tool_assertion: ${label} missing numeric max`);
        continue;
      }
      if (calls.length > max) {
        const failure = `budget: max_total_tool_calls actual=${calls.length} max=${max}`;
        failures.push(failure);
        budgetFailures.push(failure);
      }
      continue;
    }

    if (type === 'max_tool_calls') {
      const tool = String(a.tool || value || '');
      const max = numericLimit(a.max);
      if (!tool || max == null) {
        failures.push(`unsupported tool_assertion: ${label} missing tool or numeric max`);
        continue;
      }
      const actual = calls.filter((c) => c.name === tool).length;
      if (actual > max) {
        const failure = `budget: max_tool_calls ${tool} actual=${actual} max=${max}`;
        failures.push(failure);
        budgetFailures.push(failure);
      }
      continue;
    }

    if (type === 'max_repeated_tool_input') {
      const tool = String(a.tool || value || '');
      const inputPath = String(a.input_path || '');
      const max = numericLimit(a.max_per_value, numericLimit(a.max));
      if (!tool || !inputPath || max == null) {
        failures.push(`unsupported tool_assertion: ${label} missing tool, input_path, or numeric max_per_value`);
        continue;
      }
      const counts = new Map();
      for (const call of calls) {
        if (call.name !== tool) continue;
        const inputValue = inputValueAtPath(call.input || {}, inputPath);
        if (inputValue === undefined || inputValue === null) continue;
        const stringValue = String(inputValue);
        counts.set(stringValue, (counts.get(stringValue) || 0) + 1);
      }
      for (const [inputValue, actual] of counts.entries()) {
        if (actual > max) {
          const failure = `budget: max_repeated_tool_input ${tool}.${inputPath} value=${inputValue} actual=${actual} max=${max}`;
          failures.push(failure);
          budgetFailures.push(failure);
        }
      }
      continue;
    }

    if (type === 'max_tool_calls_by_input') {
      const tool = String(a.tool || '');
      const inputPath = String(a.input_path || '');
      const expectedValue = a.value;
      const max = numericLimit(a.max);
      if (!tool || !inputPath || expectedValue === undefined || max == null) {
        failures.push(`unsupported tool_assertion: ${label} missing tool, input_path, value, or numeric max`);
        continue;
      }
      const actual = calls.filter((call) => {
        if (call.name !== tool) return false;
        return String(inputValueAtPath(call.input || {}, inputPath)) === String(expectedValue);
      }).length;
      if (actual > max) {
        const failure = `budget: max_tool_calls_by_input ${tool}.${inputPath} value=${expectedValue} actual=${actual} max=${max}`;
        failures.push(failure);
        budgetFailures.push(failure);
      }
      continue;
    }

    failures.push(`unsupported tool_assertion: ${label}`);
  }

  return { ok: failures.length === 0, failures, requiredHits, forbiddenHits, budgetFailures };
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

function objectRows(actual) {
  if (actual == null) return [];
  if (Array.isArray(actual)) return actual.filter((r) => r && typeof r === 'object');
  if (Array.isArray(actual.rows)) return actual.rows.filter((r) => r && typeof r === 'object');
  if (typeof actual === 'object') return [actual];
  return [];
}

function valuesMatch(actual, expected, { tolerance = 0, mode = 'exact' } = {}) {
  if (expected === null) return actual === null || actual === undefined;
  const na = normalizeNumber(actual);
  const ne = normalizeNumber(expected);
  if (na != null && ne != null) {
    if (mode === 'exact' && tolerance === 0) return na === ne;
    return Math.abs(na - ne) <= tolerance + Number.EPSILON * 100;
  }
  return matchTextEqual(actual, expected);
}

const FIELD_ALIASES = {
  report_period: ['报表期间'],
  item_name: ['项目名称'],
  company_name: ['公司名称'],
  end_balance: ['期末余额'],
  begin_balance: ['年初余额'],
  year_to_date_amount: ['本年累计金额', 'amount_ytd', 'ytd_amount', 'amount_cumulative_ytd'],
  current_month_amount: ['本月金额', 'amount_month', 'month_amount', 'amount_mtd', 'amount_current_month'],
  amount: [
    '本年累计金额',
    '期末余额',
    'cumulative_amount',
    'current_month_amount',
    'year_to_date_amount',
    'amount_ytd',
    'ytd_amount',
    'amount_cumulative_ytd',
    'amount_month',
    'month_amount',
    'amount_current_month',
    'amount_mtd',
  ],
};

function valueFromRow(row, key) {
  if (!row || typeof row !== 'object') return undefined;
  if (row[key] !== undefined) return row[key];
  for (const alias of FIELD_ALIASES[key] || []) {
    if (row[alias] !== undefined) return row[alias];
  }
  if (key === 'current_month_amount' && row.amount_type === 'current_month') return row.amount;
  if (key === 'year_to_date_amount' && row.amount_type === 'year_to_date') return row.amount;
  if (key === 'end_balance' && row.amount_type === 'end_balance') return row.amount;
  if (key === 'begin_balance' && row.amount_type === 'begin_balance') return row.amount;
  return undefined;
}

function compareObjectFields(actual, expected, opts = {}) {
  const mismatches = [];
  const act = actual || {};
  for (const [key, exp] of Object.entries(expected || {})) {
    const actualValue = valueFromRow(act, key);
    if (!valuesMatch(actualValue, exp, opts)) {
      mismatches.push(`${key}: actual=${actualValue} expected=${exp}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function rowKey(row, keyColumns = []) {
  return keyColumns.map((k) => String(valueFromRow(row, k))).join('\u0001');
}

function checkDataFrameAssertion(actual, assertion) {
  const expectedRows = assertion?.data?.rows;
  if (!Array.isArray(expectedRows)) {
    return { ok: false, mismatches: ['dataframe: expected data.rows array'] };
  }
  const actualRows = objectRows(actual);
  const keyColumns = Array.isArray(assertion.key_columns) ? assertion.key_columns : [];
  const compareMode = assertion.compare_mode || 'exact';
  const tolerance = normalizeNumber(assertion.numeric_tolerance) ?? 0;
  const mismatches = [];
  const expectedColumns = Array.isArray(assertion?.data?.columns)
    ? assertion.data.columns.map(String)
    : Array.from(new Set(expectedRows.flatMap((row) => Object.keys(row || {}))));

  if (assertion.check_row_count !== false && compareMode !== 'subset' && actualRows.length !== expectedRows.length) {
    mismatches.push(`dataframe: row_count actual=${actualRows.length} expected=${expectedRows.length}`);
  }

  if (assertion.check_schema === true && expectedColumns.length > 0) {
    const actualColumns = new Set(actualRows.flatMap((row) => Object.keys(row || {})));
    for (const col of expectedColumns) {
      const hasColumn = actualColumns.has(col) || actualRows.some((row) => valueFromRow(row, col) !== undefined);
      if (!hasColumn) mismatches.push(`dataframe schema: missing column ${col}`);
    }
  }

  const remaining = [...actualRows];
  for (const exp of expectedRows) {
    let idx = -1;
    if (keyColumns.length > 0) {
      const expectedKey = rowKey(exp, keyColumns);
      idx = remaining.findIndex(
        (row) => rowKey(row, keyColumns) === expectedKey && compareObjectFields(row, exp, { tolerance, mode: compareMode }).ok
      );
      if (idx < 0) idx = remaining.findIndex((row) => rowKey(row, keyColumns) === expectedKey);
    } else {
      idx = remaining.findIndex((row) => compareObjectFields(row, exp, { tolerance, mode: compareMode }).ok);
    }
    if (idx < 0) {
      mismatches.push(`dataframe: missing row ${JSON.stringify(exp)}`);
      continue;
    }
    const row = remaining[idx];
    const cmp = compareObjectFields(row, exp, { tolerance, mode: compareMode });
    if (!cmp.ok) {
      mismatches.push(...cmp.mismatches.map((m) => `dataframe row ${JSON.stringify(exp)}: ${m}`));
    }
    remaining.splice(idx, 1);
  }

  return { ok: mismatches.length === 0, mismatches };
}

function extractScalarFromText(finalText, key) {
  if (!finalText) return undefined;
  if (key === 'source_count') {
    const text = String(finalText);
    const match =
      text.match(/(?:共|共有|当前共有)\s*(?:\*\*)?(\d+)(?:\*\*)?\s*个\s*(?:semantic layer\s*)?source/i) ||
      text.match(/source[^\n]{0,80}(?:共|共有|当前共有)\s*(?:\*\*)?(\d+)(?:\*\*)?\s*个/i) ||
      text.match(/(?:共|共有|当前共有)\s*(?:\*\*)?(\d+)(?:\*\*)?\s*个[^\n]{0,80}source/i);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function checkScalarAssertion(actual, assertion, finalText = '') {
  const expected = assertion?.data || {};
  const rows = objectRows(actual);
  const actualObj = rows.length === 1 ? { ...rows[0] } : { ...(actual && typeof actual === 'object' ? actual : {}) };
  if (Array.isArray(actual?.refs) && actualObj.source_count === undefined) actualObj.source_count = actual.refs.length;
  if (Array.isArray(actual?.rows) && actualObj.row_count === undefined) actualObj.row_count = actual.rows.length;
  for (const key of Object.keys(expected)) {
    if (actualObj[key] === undefined) {
      const textValue = extractScalarFromText(finalText, key);
      if (textValue !== undefined) actualObj[key] = textValue;
    }
  }
  const tolerance = normalizeNumber(assertion.numeric_tolerance) ?? 0;
  const mode = assertion.compare_mode || 'exact';
  return compareObjectFields(actualObj, expected, { tolerance, mode });
}

function checkTextAssertion(finalText, assertion) {
  const data = assertion?.data || {};
  const missing = [];
  const normFinal = normalizeText(finalText);
  if (Array.isArray(data.must_mention)) {
    for (const kw of data.must_mention) {
      if (!normFinal.includes(normalizeText(kw))) missing.push(`must_mention: ${kw}`);
    }
  }
  if (Array.isArray(data.must_not_mention)) {
    for (const kw of data.must_not_mention) {
      if (normFinal.includes(normalizeText(kw))) missing.push(`must_not_mention: ${kw}`);
    }
  }
  if (data.require_refusal_reason === true && !/拒绝|不能|无法|权限|越权|不可见|reason|permission|denied/i.test(String(finalText))) {
    missing.push('require_refusal_reason');
  }
  if (Array.isArray(data.rubric_must_mention)) {
    for (const kw of data.rubric_must_mention) {
      if (!normFinal.includes(normalizeText(kw))) missing.push(`rubric_must_mention: ${kw}`);
    }
  }
  return { ok: missing.length === 0, mismatches: missing };
}

function checkRankingSetAssertion(actual, assertion) {
  const rows = objectRows(actual);
  const expected = assertion?.data || {};
  const labelColumn = expected.label_column || assertion.label_column || assertion.key_column || 'label';
  const expectedOrder = Array.isArray(expected.order) ? expected.order.map(String) : [];
  const expectedSet = Array.isArray(expected.set) ? expected.set.map(String) : expectedOrder;
  const actualLabels = rows.map((row) => String(valueFromRow(row, labelColumn) ?? row[labelColumn] ?? ''));
  const mismatches = [];
  if (expectedSet.length > 0) {
    const actualSet = new Set(actualLabels);
    for (const label of expectedSet) {
      if (!actualSet.has(label)) mismatches.push(`ranking_set: missing ${label}`);
    }
    if (assertion.compare_mode !== 'subset') {
      for (const label of actualSet) {
        if (!expectedSet.includes(label)) mismatches.push(`ranking_set: unexpected ${label}`);
      }
    }
  }
  if (expectedOrder.length > 0 && assertion.check_order !== false) {
    const actualPrefix = actualLabels.slice(0, expectedOrder.length);
    if (JSON.stringify(actualPrefix) !== JSON.stringify(expectedOrder)) {
      mismatches.push(`ranking_set: order actual=${actualPrefix.join(',')} expected=${expectedOrder.join(',')}`);
    }
  }
  return { ok: mismatches.length === 0, mismatches };
}

function checkDistributionAssertion(actual, assertion) {
  const rows = objectRows(actual);
  const expectedRows = assertion?.data?.rows;
  if (!Array.isArray(expectedRows)) return { ok: false, mismatches: ['distribution: expected data.rows array'] };
  const tolerance = normalizeNumber(assertion.numeric_tolerance) ?? 0;
  const keyColumns = Array.isArray(assertion.key_columns) ? assertion.key_columns : [];
  const mismatches = [];
  for (const exp of expectedRows) {
    const row = keyColumns.length > 0
      ? rows.find((candidate) => rowKey(candidate, keyColumns) === rowKey(exp, keyColumns))
      : rows.find((candidate) => compareObjectFields(candidate, exp, { tolerance, mode: 'approx' }).ok);
    if (!row) {
      mismatches.push(`distribution: missing row ${JSON.stringify(exp)}`);
      continue;
    }
    const cmp = compareObjectFields(row, exp, { tolerance, mode: 'approx' });
    if (!cmp.ok) mismatches.push(...cmp.mismatches.map((m) => `distribution row ${JSON.stringify(exp)}: ${m}`));
  }
  return { ok: mismatches.length === 0, mismatches };
}

function checkResultAssertions(actual, finalText, assertions) {
  if (!Array.isArray(assertions) || assertions.length === 0) {
    return { ok: true, mismatches: [] };
  }
  const mismatches = [];
  for (const assertion of assertions) {
    if (!assertion || typeof assertion !== 'object') continue;
    let r;
    switch (assertion.value_type) {
      case 'text':
        r = checkTextAssertion(finalText, assertion);
        break;
      case 'scalar':
        r = checkScalarAssertion(actual, assertion, finalText);
        break;
      case 'dataframe':
        r = checkDataFrameAssertion(actual, assertion);
        break;
      case 'ranking_set':
        r = checkRankingSetAssertion(actual, assertion);
        break;
      case 'distribution':
        r = checkDistributionAssertion(actual, assertion);
        break;
      case 'empty_result': {
        const rows = objectRows(actual);
        r = { ok: rows.length === 0, mismatches: rows.length === 0 ? [] : [`empty_result: actual row_count=${rows.length}`] };
        break;
      }
      default:
        r = { ok: false, mismatches: [`unsupported result_assertion value_type: ${assertion.value_type}`] };
    }
    if (!r.ok) mismatches.push(...r.mismatches);
  }
  return { ok: mismatches.length === 0, mismatches };
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

function expectedColumnsFromAssertions(assertions = []) {
  const cols = new Set();
  for (const a of assertions || []) {
    if (!a || typeof a !== 'object') continue;
    if (a.value_type === 'scalar' && a.data && typeof a.data === 'object') {
      for (const k of Object.keys(a.data)) cols.add(k);
    }
    if (a.value_type === 'dataframe' && Array.isArray(a.data?.rows)) {
      for (const row of a.data.rows) {
        for (const k of Object.keys(row || {})) cols.add(k);
      }
    }
  }
  return Array.from(cols);
}

function composeQuestion(c, { priorTurns = [] } = {}) {
  const base = c.question || c.user || '';
  const domain = c.domain || 'superstore';
  const expectedSource = c.expected_source || 'semantic_layer';
  const expectedColumns = expectedColumnsFromAssertions(c.result_assertions);
  const shared =
    '\n\n必须实际调用 KTX MCP 工具，禁止凭记忆回答。' +
    '\n只能做只读查询或读取语义层定义；禁止读取本地密钥目录，禁止 DDL/DML。' +
    '\n回答中请简要说明使用的数据源/表和关键过滤条件；不要编造工具未返回的 freshness、snapshot 或数据差异原因。';

  const priorHint =
    priorTurns.length > 0
      ? `\n\n前序轮次上下文：\n${priorTurns
          .map((t) => `- 第 ${t.turnId} 轮：问题=${t.user}; 摘要=${t.finalTextSnippet || ''}`)
          .join('\n')}`
      : '';

  if (expectedSource === 'raw_sql_fallback') {
    const columnsHint =
      expectedColumns.length > 0
        ? `\n结果列请使用清晰别名，至少包含这些业务列名：${expectedColumns.join(', ')}。`
        : '';
    return (
      base +
      priorHint +
      shared +
      '\n本 case 预期使用 raw SQL fallback：请调用 `mcp__ktx__sql_execution`（或 KTX MCP 暴露的等价只读 SQL 工具），connection 为 `mysql-aliyun`。' +
      '\nSQL 必须是 SELECT/只读语句；KX 财务问题优先使用 `kx_fact_financial_amount`、`kx_dim_company`、`kx_dim_financial_item` 和 `kx_vw_*_detail`，不要查询 superstore。' +
      columnsHint
    );
  }

  if (domain === 'kx_financial') {
    return (
      base +
      priorHint +
      shared +
      '\n本 case 预期使用 semantic layer：请调用 KTX 的语义层工具，例如 `mcp__ktx__sl_search` / `mcp__ktx__sl_read_source` / `mcp__ktx__sl_validate`，读取 KX 财务 source 定义后回答。' +
      '\nKX 财务 source 以 `kx_` 开头；不要套用 superstore 表、measure 或 `is_deleted = 0` 过滤。'
    );
  }

  const measures = Array.isArray(c.expected_measures) && c.expected_measures.length > 0
    ? c.expected_measures.map((m) => `superstore_orders.${m}`)
    : ['superstore_orders.<measure>'];
  return (
    base +
    priorHint +
    shared +
    '\n本 case 预期使用 semantic layer：请调用 `mcp__ktx__sl_query` 工具，connectionId 为 `mysql-aliyun`，并设置 `include: ["sql"]`。' +
    `\n候选 measures：${measures.join(', ')}。分组字段使用 \`superstore_orders.<dim>\`，正常订单过滤使用 \`superstore_orders.is_deleted = 0\`。` +
    '\n最后用一句话说明 measure 名或计算口径。'
  );
}

// ─── run a single case ─────────────────────────────────────────────────────

function safetyAssertions(safetyContract = {}) {
  const assertions = [];
  if (Array.isArray(safetyContract.forbidden_ast)) assertions.push(...safetyContract.forbidden_ast);
  return assertions;
}

function checkSecretPathSafety(sql, finalText, safetyContract = {}) {
  const failures = [];
  const paths = Array.isArray(safetyContract.forbid_secret_paths) ? safetyContract.forbid_secret_paths : [];
  const haystack = normalizeText(`${sql || ''}\n${finalText || ''}`);
  for (const p of paths) {
    if (haystack.includes(normalizeText(p))) failures.push(`forbidden secret path mentioned: ${p}`);
  }
  return { ok: failures.length === 0, failures };
}

function classifyFailures(pass, failures = []) {
  if (pass) return 'pass';
  const joined = failures.join('\n').toLowerCase();
  if (joined.includes('budget:')) return 'logic_regression';
  if (joined.includes('reviewer gate') || joined.includes('forbidden') || joined.includes('required') || joined.includes('lineage')) return 'logic_regression';
  if (joined.includes('trace') || joined.includes('context evidence')) return 'logic_regression';
  if (joined.includes('cli:') || joined.includes('tool') || joined.includes('timeout')) return 'tool_error';
  if (joined.includes('parse:') || joined.includes('schema')) return 'schema_drift';
  return 'data_drift';
}

function safeId(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'case';
}

function generatedTraceId(caseId, suffix = '') {
  const raw = `${caseId}:${suffix}`;
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 10);
  return `eval-${safeId(caseId)}${suffix ? `-${safeId(suffix)}` : ''}-${digest}`;
}

function traceIdFromLucyMeta(lucyMeta = []) {
  for (const meta of lucyMeta || []) {
    for (const key of ['traceId', 'trace_id', 'turnId', 'turn_id', 'requestId', 'request_id']) {
      if (typeof meta?.[key] === 'string' && meta[key]) return meta[key];
    }
  }
  return null;
}

function traceInfoForCase(c, parsed, suffix = '') {
  const upstream = traceIdFromLucyMeta(parsed.lucyMeta || []);
  return {
    traceId: upstream || generatedTraceId(c.id, suffix),
    generated: !upstream,
    source: upstream ? 'lucy_meta' : 'runner_generated'
  };
}

function contextRequirement(c = {}) {
  const req = c.context_required;
  if (!req) return { required: false, keys: [], titles: [], queries: [] };
  if (req === true) return { required: true, keys: [], titles: [], queries: [] };
  if (typeof req === 'object') {
    return {
      required: true,
      keys: Array.isArray(req.keys) ? req.keys.map(String) : [],
      titles: Array.isArray(req.titles) ? req.titles.map(String) : [],
      queries: Array.isArray(req.queries) ? req.queries.map(String) : []
    };
  }
  return { required: Boolean(req), keys: [], titles: [], queries: [] };
}

function checkTraceAndContextGates(c, parsed, traceInfo) {
  const failures = [];
  const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
  if (c.trace_required === true && toolCalls.length === 0) {
    failures.push('trace: trace_required case has no tool calls to associate with traceId');
  }
  if (c.scoring?.require_lucy_meta === true && (!Array.isArray(parsed.lucyMeta) || parsed.lucyMeta.length === 0)) {
    failures.push('trace: require_lucy_meta scoring gate found no Lucy metadata');
  }
  if (c.trace_required === true && !traceInfo.traceId) {
    failures.push('trace: trace_required case has no traceId');
  }

  const context = contextRequirement(c);
  if (context.required) {
    const evidence = parsed.wikiContextEvidence || [];
    if (evidence.length === 0) {
      failures.push('context evidence: context_required case has no wiki/context tool evidence');
    }
    for (const key of context.keys) {
      if (!evidence.some((item) => String(item.key || '').includes(key))) {
        failures.push(`context evidence: required key missing: ${key}`);
      }
    }
    for (const title of context.titles) {
      const needle = normalizeText(title);
      if (!evidence.some((item) => normalizeText(item.title || item.snippet || '').includes(needle))) {
        failures.push(`context evidence: required title missing: ${title}`);
      }
    }
  }
  return failures;
}

function checkRuntimeReviewerGates(c, parsed, sql) {
  const failures = [];
  const sqlText = normalizeSqlAssertionText(sql || '');
  const finalText = normalizeText(parsed.finalText || '');
  const toolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls : [];
  const ktxCalls = toolCalls.filter((call) => String(call.name || '').startsWith('mcp__ktx__'));
  const riskTags = Array.isArray(c.risk_tags) ? c.risk_tags.map(String) : [];
  const reviewerRequired = riskTags.includes('reviewer_gate') || c.scoring?.reviewer_gate === true;

  if (/\bavg\s*\([^)]*(ratio|margin|rate|率)/i.test(sqlText)) {
    failures.push('reviewer gate: forbidden avg(ratio/margin/rate) pattern');
  }
  if (/(sum\s*\([^)]*sales[^)]*\)\s*\/\s*sum\s*\([^)]*sales)|(nullif\s*\(\s*sum\s*\([^)]*sales[^)]*\)[^)]*\)\s*\/\s*nullif\s*\(\s*sum\s*\([^)]*sales)/i.test(sqlText)) {
    failures.push('reviewer gate: repeated denominator aggregation pattern');
  }
  if ((reviewerRequired || c.trace_required === true) && ktxCalls.length === 0) {
    failures.push('reviewer gate: no controlled KTX/Lucy tool call captured');
  }
  if (/(\.ktx secrets|bearer|password|token|secret)/i.test(finalText)) {
    failures.push('reviewer gate: final answer mentions sensitive credential material');
  }
  return failures;
}

function buildScore(pass, failures, c = {}, finalText = '') {
  const classification = classifyFailures(pass, failures);
  const allowed = Array.isArray(c.scoring?.allowed_failure_classifications)
    ? c.scoring.allowed_failure_classifications.map(String)
    : [];
  const allFailures = [...failures];
  if (!pass && allowed.length > 0 && !allowed.includes(classification)) {
    allFailures.push(`scoring: failure classification ${classification} is not allowed for this case`);
    return {
      status: 'fail',
      failures: allFailures,
      classification: classifyFailures(false, allFailures)
    };
  }
  if (c.scoring?.require_refusal_reason === true && !/拒绝|不能|无法|权限|原因|reason/i.test(String(finalText || ''))) {
    allFailures.push('scoring: refusal reason required but not detected');
  }
  return {
    status: pass && allFailures.length === 0 ? 'pass' : 'fail',
    failures: allFailures,
    classification: classifyFailures(pass && allFailures.length === 0, allFailures)
  };
}

function collectSqlAssertions(c, safetyContract = {}) {
  return [
    ...safetyAssertions(safetyContract),
    ...(Array.isArray(c.sql_assertions) ? c.sql_assertions : []),
  ];
}

function collectTurnSqlAssertions(turn, safetyContract = {}) {
  return [
    ...safetyAssertions(safetyContract),
    ...(Array.isArray(turn.context_assertions?.sql_assertions) ? turn.context_assertions.sql_assertions : []),
    ...(Array.isArray(turn.sql_assertions) ? turn.sql_assertions : []),
  ];
}

function collectTurnToolAssertions(turn) {
  return [
    ...(Array.isArray(turn.context_assertions?.tool_assertions) ? turn.context_assertions.tool_assertions : []),
    ...(Array.isArray(turn.tool_assertions) ? turn.tool_assertions : []),
  ];
}

async function executePrompt(question) {
  let raw;
  let parseErr = null;
  let parsed = { sql: null, sqlArgs: null, result: null, resultRaw: null, finalText: '', toolCandidates: [] };
  let cliErr = null;
  try {
    buildEvalMcpConfig(EVAL_MCP_PATH);
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
  return { raw, parseErr, parsed, cliErr };
}

function evaluateCandidate(c, parsed, candidate, safetyContract = {}) {
  const assertionSql = candidate.assertionSql ?? candidate.sql;
  const sqlCheck = checkSqlAssertions(
    assertionSql,
    collectSqlAssertions(c, safetyContract),
    c.required_sql_pattern,
    c.forbidden_sql_pattern
  );
  const structuredResultCheck = checkResultAssertions(candidate.result || {}, parsed.finalText, c.result_assertions || []);
  const legacyResultCheck = c.expected_result ? checkResultMatch(candidate.result || {}, c.expected_result || {}) : { ok: true, mismatches: [] };
  const legacyTextCheck = c.expected_result ? checkTextResponse(parsed.finalText, c.expected_result || {}) : { ok: true, missing: [] };
  const safetyCheck = checkSecretPathSafety(assertionSql, parsed.finalText, safetyContract);
  const toolCheck = checkToolAssertions(parsed.toolCalls || [], c.tool_assertions || []);
  const failures = [];
  failures.push(...sqlCheck.failures);
  failures.push(...toolCheck.failures);
  failures.push(...structuredResultCheck.mismatches);
  failures.push(...legacyResultCheck.mismatches);
  failures.push(...legacyTextCheck.missing);
  failures.push(...safetyCheck.failures);
  return {
    candidate,
    ok: failures.length === 0,
    failures,
    requiredHits: [...sqlCheck.requiredHits, ...toolCheck.requiredHits],
    forbiddenHits: [...sqlCheck.forbiddenHits, ...toolCheck.forbiddenHits],
    budgetFailures: toolCheck.budgetFailures || [],
  };
}

function rowHasAnyExpectedColumn(row, expectedColumns = []) {
  if (!row || typeof row !== 'object') return false;
  for (const col of expectedColumns) {
    if (Object.prototype.hasOwnProperty.call(row, col)) return true;
    for (const alias of FIELD_ALIASES[col] || []) {
      if (Object.prototype.hasOwnProperty.call(row, alias)) return true;
    }
  }
  return false;
}

function mergedCandidateFromToolCandidates(toolCandidates = [], c = {}) {
  const candidates = Array.isArray(toolCandidates) ? toolCandidates : [];
  const expectedColumns = expectedColumnsFromAssertions(c.result_assertions || []);
  const rows = [];
  const sqlParts = [];
  const rawParts = [];
  let mergedCandidateCount = 0;
  for (const candidate of candidates) {
    const allCandidateRows = objectRows(candidate.result);
    const candidateRows =
      expectedColumns.length > 0
        ? allCandidateRows.filter((row) => rowHasAnyExpectedColumn(row, expectedColumns))
        : allCandidateRows;
    if (candidateRows.length === 0) continue;
    mergedCandidateCount++;
    rows.push(...candidateRows);
    if (candidate.sql) sqlParts.push(candidate.sql);
    if (candidate.resultRaw) rawParts.push(candidate.resultRaw);
  }
  if (rows.length === 0 || mergedCandidateCount < 2) return null;
  return {
    toolName: 'merged_tool_candidates',
    synthetic: true,
    sql: null,
    assertionSql: sqlParts.join('\n\n') || null,
    sqlParts,
    sqlArgs: null,
    result: { rows, totalRows: rows.length },
    resultRaw: rawParts,
  };
}

function chooseBestCandidate(c, parsed, safetyContract = {}) {
  const baseCandidate = {
    toolName: 'selected',
    sql: parsed.sql,
    sqlArgs: parsed.sqlArgs,
    result: parsed.result,
    resultRaw: parsed.resultRaw,
  };
  const mergedCandidate = mergedCandidateFromToolCandidates(parsed.toolCandidates, c);
  const candidates = [
    baseCandidate,
    ...(Array.isArray(parsed.toolCandidates) ? parsed.toolCandidates : []),
    ...(mergedCandidate ? [mergedCandidate] : []),
  ];
  let best = null;
  for (const candidate of candidates) {
    const evaluation = evaluateCandidate(c, parsed, candidate, safetyContract);
    if (!best || evaluation.failures.length < best.failures.length) best = evaluation;
    if (evaluation.ok) return evaluation;
  }
  return best || evaluateCandidate(c, parsed, baseCandidate, safetyContract);
}

function jsonEqual(a, b) {
  if (a === undefined || b === undefined) return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function isTextOnlyResultCase(c = {}) {
  const assertions = Array.isArray(c.result_assertions) ? c.result_assertions : [];
  return assertions.length > 0 && assertions.every((a) => a?.value_type === 'text');
}

async function runSingleTurnCase(c, { safetyContract = {}, priorTurns = [] } = {}) {
  const question = composeQuestion(c, { priorTurns });
  const { parseErr, parsed, cliErr } = await executePrompt(question);
  const selected = chooseBestCandidate(c, parsed, safetyContract);
  const traceInfo = traceInfoForCase(c, parsed);

  const failures = [];
  if (cliErr) failures.push(`cli: ${cliErr}`);
  if (parseErr) failures.push(`parse: ${parseErr}`);
  failures.push(...(selected.failures || []));
  const selectedCandidate = selected.candidate || {};
  failures.push(...checkTraceAndContextGates(c, parsed, traceInfo));
  failures.push(...checkRuntimeReviewerGates(c, parsed, selectedCandidate.assertionSql ?? selectedCandidate.sql));
  const rawOk = !cliErr && !parseErr && selected.ok && failures.length === 0;
  const score = buildScore(rawOk, failures, c, parsed.finalText);
  const ok = score.status === 'pass';
  const textOnlyResultCase = isTextOnlyResultCase(c);
  const result = textOnlyResultCase ? undefined : selectedCandidate.result;
  const resultRaw =
    textOnlyResultCase || jsonEqual(selectedCandidate.resultRaw, selectedCandidate.result)
      ? undefined
      : selectedCandidate.resultRaw;
  const actual = textOnlyResultCase ? undefined : selectedCandidate.result;

  return {
    id: c.id,
    pass: ok,
    failures: score.failures,
    traceId: traceInfo.traceId,
    traceRequired: c.trace_required === true,
    contextRequired: contextRequirement(c).required,
    trace: traceInfo,
    turns: [],
    semanticQueries: parsed.semanticQueries || [],
    wikiContextEvidence: parsed.wikiContextEvidence || [],
    lucyMeta: parsed.lucyMeta || [],
    finalAnswer: parsed.finalText,
    score,
    failureClassification: score.classification,
    sql: selectedCandidate.sql,
    syntheticSql: selectedCandidate.synthetic || undefined,
    sqlParts: selectedCandidate.synthetic ? selectedCandidate.sqlParts : undefined,
    finalText: parsed.finalText,
    finalTextSnippet: parsed.finalText ? parsed.finalText.slice(0, 200) : '',
    result,
    resultRaw,
    actual,
    expected: c.result_assertions || c.expected_result,
    requiredHits: selected.requiredHits,
    forbiddenHits: selected.forbiddenHits,
    budgetFailures: selected.budgetFailures || [],
    toolCalls: parsed.toolCalls || [],
    toolSummary: summarizeToolCalls(parsed.toolCalls || []),
  };
}

async function runMultiTurnCase(c, { safetyContract = {} } = {}) {
  const turnEntries = [];
  const priorTurns = [];
  for (const turn of c.turns || []) {
    const turnCase = {
      ...c,
      id: `${c.id}#turn-${turn.turn_id}`,
      question: turn.user,
      user: turn.user,
      expected_measures: turn.expected_measures || c.expected_measures,
      result_assertions: turn.result_assertions || [],
      sql_assertions: collectTurnSqlAssertions(turn, {}),
      tool_assertions: collectTurnToolAssertions(turn),
    };
    const entry = await runSingleTurnCase(turnCase, { safetyContract, priorTurns });
    entry.turnId = turn.turn_id;
    turnEntries.push(entry);
    priorTurns.push({
      turnId: turn.turn_id,
      user: turn.user,
      finalTextSnippet: entry.finalTextSnippet,
    });
  }

  const failures = [];
  for (const entry of turnEntries) {
    failures.push(...entry.failures.map((f) => `${entry.id}: ${f}`));
  }
  const traceInfo = {
    traceId: generatedTraceId(c.id, 'multi-turn'),
    generated: true,
    source: 'runner_generated'
  };
  const rawOk = turnEntries.every((e) => e.pass);
  const score = buildScore(rawOk, failures, c, turnEntries.map((e) => e.finalText || '').join('\n\n'));
  const result = turnEntries
    .map((e) => (e.result === undefined ? null : { id: e.id, result: e.result }))
    .filter(Boolean);
  const resultRaw = turnEntries
    .map((e) => (e.resultRaw === undefined ? null : { id: e.id, resultRaw: e.resultRaw }))
    .filter(Boolean);
  const actual = turnEntries.map((e) => e.actual).filter((v) => v !== undefined);
  return {
    id: c.id,
    pass: score.status === 'pass',
    failures: score.failures,
    traceId: traceInfo.traceId,
    traceRequired: c.trace_required === true,
    contextRequired: contextRequirement(c).required,
    trace: traceInfo,
    turns: turnEntries.map((entry) => ({
      turnId: entry.turnId,
      caseId: entry.id,
      traceId: entry.traceId,
      pass: entry.pass,
      failures: entry.failures,
      score: entry.score,
      sql: entry.sql,
      finalAnswer: entry.finalAnswer,
      finalTextSnippet: entry.finalTextSnippet,
      semanticQueries: entry.semanticQueries || [],
      wikiContextEvidence: entry.wikiContextEvidence || [],
      lucyMeta: entry.lucyMeta || [],
      toolSummary: entry.toolSummary
    })),
    semanticQueries: turnEntries.flatMap((e) => e.semanticQueries || []),
    wikiContextEvidence: turnEntries.flatMap((e) => e.wikiContextEvidence || []),
    lucyMeta: turnEntries.flatMap((e) => e.lucyMeta || []),
    finalAnswer: turnEntries.map((e) => e.finalAnswer || '').join('\n\n'),
    score,
    failureClassification: score.classification,
    sql: turnEntries.map((e) => e.sql).filter(Boolean).join('\n\n-- next turn --\n\n') || null,
    finalText: turnEntries.map((e) => e.finalText || '').join('\n\n'),
    finalTextSnippet: turnEntries.map((e) => e.finalTextSnippet || '').join('\n').slice(0, 200),
    result: result.length > 0 ? result : undefined,
    resultRaw: resultRaw.length > 0 ? resultRaw : undefined,
    actual: actual.length > 0 ? actual : undefined,
    expected: (c.turns || []).map((t) => t.result_assertions || []),
    requiredHits: turnEntries.flatMap((e) => e.requiredHits || []),
    forbiddenHits: turnEntries.flatMap((e) => e.forbiddenHits || []),
    budgetFailures: turnEntries.flatMap((e) => e.budgetFailures || []),
    toolCalls: turnEntries.flatMap((e) => e.toolCalls || []),
    toolSummary: summarizeToolCalls(turnEntries.flatMap((e) => e.toolCalls || [])),
  };
}

async function runCase(c, opts = {}) {
  if (c.case_type === 'multi_turn') return runMultiTurnCase(c, opts);
  return runSingleTurnCase(c, opts);
}

async function runCaseWithRetries(c, opts = {}) {
  const retries = opts.retries ?? 0;
  const attempts = [];
  for (let i = 0; i <= retries; i++) {
    const entry = await runCase(c, opts);
    attempts.push(entry);
    if (entry.pass || i === retries) {
      if (attempts.length > 1) {
        return {
          ...entry,
          attempts: attempts.length,
          previousFailures: attempts.slice(0, -1).map((a) => ({
            pass: a.pass,
            failures: a.failures,
          })),
        };
      }
      return entry;
    }
    process.stderr.write(`#   ${c.id} attempt ${i + 1}/${retries + 1} → FAIL; retrying\n`);
  }
  return attempts[attempts.length - 1];
}

// ─── summary + output formatting ───────────────────────────────────────────

function summarize(entries) {
  const total = entries.length;
  const pass = entries.filter((e) => e.pass).length;
  const fail = total - pass;
  const traceRequired = entries.filter((e) => e.traceRequired);
  const contextRequired = entries.filter((e) => e.contextRequired);
  const traceIds = traceRequired.map((e) => e.traceId).filter(Boolean);
  const uniqueTraceIds = new Set(traceIds);
  const contextEvidenced = contextRequired.filter((e) => Array.isArray(e.wikiContextEvidence) && e.wikiContextEvidence.length > 0);
  return {
    total,
    pass,
    fail,
    gates: {
      traceCoverage: traceRequired.length === 0 || traceIds.length === traceRequired.length,
      traceUniqueness: traceIds.length === uniqueTraceIds.size,
      contextEvidenceCoverage: contextRequired.length === 0 || contextEvidenced.length === contextRequired.length,
      scorePassRate: total > 0 ? pass / total : 0
    },
    trace: {
      requiredCases: traceRequired.length,
      tracedCases: traceIds.length,
      uniqueTraces: uniqueTraceIds.size
    },
    context: {
      requiredCases: contextRequired.length,
      evidencedCases: contextEvidenced.length
    },
    cases: entries
  };
}

function applyTraceUniquenessGates(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!entry.traceRequired || !entry.traceId) continue;
    const previous = seen.get(entry.traceId);
    if (previous) {
      const failure = `trace: duplicate traceId ${entry.traceId} also used by ${previous.id}`;
      entry.failures = [...(entry.failures || []), failure];
      entry.pass = false;
      entry.score = buildScore(false, entry.failures, {}, entry.finalAnswer || entry.finalText || '');
      entry.failureClassification = entry.score.classification;
      previous.failures = [...(previous.failures || []), `trace: duplicate traceId ${entry.traceId} also used by ${entry.id}`];
      previous.pass = false;
      previous.score = buildScore(false, previous.failures, {}, previous.finalAnswer || previous.finalText || '');
      previous.failureClassification = previous.score.classification;
    } else {
      seen.set(entry.traceId, entry);
    }
  }
  return entries;
}

function formatToolSummary(toolSummary = {}) {
  const parts = Object.entries(toolSummary.ktxByShortName || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tool, count]) => `${tool} ${count}`);
  const total = Number.isFinite(toolSummary.total) ? toolSummary.total : 0;
  return parts.length > 0 ? `total ${total}; ${parts.join('; ')}` : `total ${total}`;
}

function formatMarkdown(summary, { casesAbs } = {}) {
  const lines = [];
  lines.push('# project-lucy eval report');
  lines.push('');
  lines.push(`- cases: ${summary.total}`);
  lines.push(`- pass: ${summary.pass}`);
  lines.push(`- fail: ${summary.fail}`);
  lines.push(`- result: ${summary.total} cases · ${summary.pass} pass · ${summary.fail} fail`);
  if (summary.gates) {
    lines.push(`- traceCoverage: ${summary.gates.traceCoverage ? 'PASS' : 'FAIL'} (${summary.trace?.tracedCases ?? 0}/${summary.trace?.requiredCases ?? 0})`);
    lines.push(`- traceUniqueness: ${summary.gates.traceUniqueness ? 'PASS' : 'FAIL'} (${summary.trace?.uniqueTraces ?? 0} unique)`);
    lines.push(`- contextEvidenceCoverage: ${summary.gates.contextEvidenceCoverage ? 'PASS' : 'FAIL'} (${summary.context?.evidencedCases ?? 0}/${summary.context?.requiredCases ?? 0})`);
  }
  if (casesAbs) lines.push(`- source: ${casesAbs}`);
  lines.push('');
  for (const e of summary.cases) {
    lines.push(`## ${e.id}`);
    lines.push(`- pass: ${e.pass ? 'PASS' : 'FAIL'}`);
    if (e.traceId) lines.push(`- traceId: ${e.traceId}`);
    if (e.failureClassification) lines.push(`- failureClassification: ${e.failureClassification}`);
    if (Array.isArray(e.wikiContextEvidence) && e.wikiContextEvidence.length > 0) {
      lines.push(`- wikiContextEvidence: ${e.wikiContextEvidence.length}`);
    }
    if (e.toolSummary) {
      lines.push(`- tools: ${formatToolSummary(e.toolSummary)}`);
    }
    if (e.sql) {
      lines.push('- sql:');
      lines.push('```sql');
      lines.push(String(e.sql).trim());
      lines.push('```');
    } else if (Array.isArray(e.sqlParts) && e.sqlParts.length > 0) {
      lines.push(`- sql: (synthetic candidate; ${e.sqlParts.length} captured SQL parts)`);
      for (let i = 0; i < e.sqlParts.length; i++) {
        lines.push(`  - sqlPart ${i + 1}:`);
        lines.push('```sql');
        lines.push(String(e.sqlParts[i]).trim());
        lines.push('```');
      }
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

  const { abs: casesAbs, cases, safetyContract } = loadCases(args.casesPath);
  const selected = args.cases.length > 0 ? cases.filter((c) => args.cases.includes(c.id)) : cases;

  if (args.listCases) {
    for (const c of cases) process.stdout.write(`${c.id}\n`);
    process.stderr.write(`# loaded ${cases.length} case(s) from ${casesAbs}\n`);
    return;
  }

  process.stderr.write(`# eval runner: ${selected.length}/${cases.length} case(s) from ${casesAbs}\n`);
  if (args.retries > 0) process.stderr.write(`# retries enabled: ${args.retries} per failed case\n`);

  // T-A.2: write MCP config and fail-fast on claude CLI
  buildEvalMcpConfig(EVAL_MCP_PATH);
  process.stderr.write(
    `# wrote MCP config → ${EVAL_MCP_PATH} (url=${KTX_MCP_URL}, auth=${KTX_MCP_TOKEN ? 'bearer' : 'none'})\n`
  );
  const mcp = await preflightKtxMcpEndpoint();
  process.stderr.write(`# KTX MCP endpoint ok: HTTP ${mcp.status}\n`);
  const pre = await preflightClaude();
  process.stderr.write(`# preflight ok: ${pre.version}\n`);

  const entries = [];
  for (const c of selected) {
    process.stderr.write(`# running ${c.id}\n`);
    const entry = await runCaseWithRetries(c, { safetyContract, retries: args.retries });
    entries.push(entry);
    const attempts = entry.attempts ? ` (${entry.attempts} attempts)` : '';
    process.stderr.write(`#   ${c.id} → ${entry.pass ? 'PASS' : 'FAIL'}${attempts}\n`);
  }

  applyTraceUniquenessGates(entries);
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

  cleanupEvalMcpConfig(EVAL_MCP_PATH);
  process.exit(summary.fail === 0 ? 0 : 1);
}

// Export internals for unit tests when invoked as a module
export {
  parseArgs,
  preflightKtxMcpEndpoint,
  buildEvalMcpConfig,
  parseClaudeOutput,
  checkSqlPatterns,
  checkSqlAssertions,
  checkToolAssertions,
  summarizeToolCalls,
  checkResultMatch,
  checkResultAssertions,
  chooseBestCandidate,
  checkTextResponse,
  normalizeText,
  normalizeSqlForMatching,
  composeQuestion,
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
    cleanupEvalMcpConfig(EVAL_MCP_PATH);
    console.error(`fatal: ${err.stack || err.message || err}`);
    process.exit(2);
  });
}
