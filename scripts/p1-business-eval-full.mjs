#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const DEFAULT_OUT = 'inbox/p1-business-eval-full-evidence.json';
const DEFAULT_MCP_URL =
  process.env.EVAL_KTX_MCP_URL ||
  process.env.LUCY_MCP_PROXY_URL ||
  process.env.LUCY_PROXY_URL ||
  'http://localhost:7879/mcp';
const DEFAULT_AGENT_CLI = process.env.EVAL_AGENT_CLI || 'claude';
const MODEL_SECRET_ENVS = ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

const EXIT_CODES = {
  pass: 0,
  evalFail: 1,
  usage: 2,
  blocked: 42,
};

const SUITES = [
  {
    id: 'superstore',
    label: 'Superstore',
    casesPath: 'evals/superstore/eval/superstore-eval-cases.yaml',
  },
  {
    id: 'kx_financial',
    label: 'KX Financial',
    casesPath: 'evals/kx_financial/eval/kx_financial-eval-cases.yaml',
  },
  {
    id: 'data_agent_poc',
    label: 'Data Agent POC',
    casesPath: 'evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml',
  },
];

const USAGE = `Usage: node scripts/p1-business-eval-full.mjs [options]

Runs the full P1 business LLM/agent eval suites and writes evidence JSON.

Options:
  --suite <id>             Run one suite id; repeatable. Defaults to all suites.
  --out <path>             Evidence output path (default: ${DEFAULT_OUT})
  --retries <n>            Pass through to scripts/eval-runner.mjs --retries
  --cli <command>          Agent CLI command (default: ${DEFAULT_AGENT_CLI})
  --mcp-url <url>          KTX/Lucy MCP endpoint (default: ${DEFAULT_MCP_URL})
  --require-mcp-token      Block if no MCP bearer token env is present
  --help                   Show this help

Environment:
  EVAL_KTX_MCP_TOKEN       Bearer token for auth-protected MCP endpoints
  KTX_MCP_TOKEN            Fallback bearer token
  LUCY_LOCAL_TOKEN         Fallback bearer token for Lucy MCP Proxy
  LUCY_MCP_PROXY_TOKEN     Fallback bearer token for Lucy MCP Proxy
  EVAL_AGENT_CLI           Default agent CLI command
  EVAL_RETRIES             Default retry count when --retries is omitted
`;

function parseArgs(argv = process.argv) {
  const args = {
    suites: [],
    out: DEFAULT_OUT,
    retries: parseNonNegativeInt(process.env.EVAL_RETRIES || '0', 'EVAL_RETRIES'),
    cli: DEFAULT_AGENT_CLI,
    mcpUrl: DEFAULT_MCP_URL,
    requireMcpToken: process.env.P1_BUSINESS_EVAL_REQUIRE_MCP_TOKEN === '1',
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--suite':
        args.suites.push(argv[++i]);
        break;
      case '--out':
        args.out = argv[++i];
        break;
      case '--retries':
        args.retries = parseNonNegativeInt(argv[++i], '--retries');
        break;
      case '--cli':
        args.cli = argv[++i];
        break;
      case '--mcp-url':
        args.mcpUrl = argv[++i];
        break;
      case '--require-mcp-token':
        args.requireMcpToken = true;
        break;
      default:
        throw new Error(`unknown arg: ${arg}`);
    }
  }

  if (!args.out) throw new Error('--out requires a path');
  if (!args.cli) throw new Error('--cli requires a command');
  if (!args.mcpUrl) throw new Error('--mcp-url requires a URL');
  return args;
}

function parseNonNegativeInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return n;
}

function selectSuites(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return SUITES;
  const known = new Map(SUITES.map((suite) => [suite.id, suite]));
  return ids.map((id) => {
    const suite = known.get(id);
    if (!suite) {
      throw new Error(`unknown suite: ${id}. Known suites: ${SUITES.map((s) => s.id).join(', ')}`);
    }
    return suite;
  });
}

function bearerTokenFromEnv(env = process.env) {
  return env.EVAL_KTX_MCP_TOKEN || env.KTX_MCP_TOKEN || env.LUCY_LOCAL_TOKEN || env.LUCY_MCP_PROXY_TOKEN || '';
}

function hasModelSecret(env = process.env) {
  return MODEL_SECRET_ENVS.some((name) => Boolean(env[name]));
}

function runCommand(command, commandArgs, { cwd = REPO_ROOT, env = process.env, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timeout after ${timeoutMs}ms: ${command} ${commandArgs.join(' ')}`));
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function okCheck(name, detail = {}, extra = {}) {
  return { name, status: 'ok', detail, ...extra };
}

function blockedCheck(name, reason, detail = {}, extra = {}) {
  return { name, status: 'blocked', reason, detail, ...extra };
}

function redactCommandOutput(value = '') {
  return String(value).replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer <redacted>').slice(0, 1000);
}

async function runPrecheck({
  suites = SUITES,
  cli = DEFAULT_AGENT_CLI,
  mcpUrl = DEFAULT_MCP_URL,
  env = process.env,
  fetchImpl = globalThis.fetch,
  run = runCommand,
  requireMcpToken = false,
} = {}) {
  const checks = [];

  for (const suite of suites) {
    try {
      readFileSync(resolve(REPO_ROOT, suite.casesPath), 'utf8');
      checks.push(okCheck(`cases:${suite.id}`, { path: suite.casesPath }));
    } catch (error) {
      checks.push(blockedCheck(`cases:${suite.id}`, 'case file is not readable', { path: suite.casesPath, error: error.message }));
    }
  }

  try {
    const version = await run(cli, ['--version'], { cwd: REPO_ROOT, env, timeoutMs: 10000 });
    if (version.code === 0) {
      checks.push(okCheck('agent_cli', { command: cli, version: redactCommandOutput(version.stdout || version.stderr).trim() }));
    } else {
      checks.push(blockedCheck('agent_cli', `${cli} --version exited ${version.code}`, {
        stderr: redactCommandOutput(version.stderr),
      }));
    }
  } catch (error) {
    checks.push(blockedCheck('agent_cli', `${cli} CLI is not executable`, { error: error.message }));
  }

  if (hasModelSecret(env)) {
    checks.push(okCheck('model_secret', { source: 'environment', envNamesPresent: MODEL_SECRET_ENVS.filter((name) => Boolean(env[name])) }));
  } else {
    try {
      const auth = await run(cli, ['auth', 'status'], { cwd: REPO_ROOT, env, timeoutMs: 15000 });
      const authText = `${auth.stdout}\n${auth.stderr}`;
      if (auth.code === 0 && /loggedIn|apiProvider|authenticated|logged in|active/i.test(authText)) {
        checks.push(okCheck('model_secret', { source: 'agent_cli_auth', command: `${cli} auth status` }));
      } else {
        checks.push(blockedCheck('model_secret', 'no model secret env and agent CLI auth is not ready', {
          command: `${cli} auth status`,
          exitCode: auth.code,
          output: redactCommandOutput(authText),
        }));
      }
    } catch (error) {
      checks.push(blockedCheck('model_secret', 'no model secret env and agent CLI auth check failed', { error: error.message }));
    }
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(mcpUrl);
  } catch (error) {
    checks.push(blockedCheck('mcp_endpoint', 'MCP endpoint URL is invalid', { url: mcpUrl, error: error.message }));
  }

  const token = bearerTokenFromEnv(env);
  if (requireMcpToken && !token) {
    checks.push(blockedCheck('mcp_token', 'MCP token is required but no token env is present', {
      envFallbackOrder: ['EVAL_KTX_MCP_TOKEN', 'KTX_MCP_TOKEN', 'LUCY_LOCAL_TOKEN', 'LUCY_MCP_PROXY_TOKEN'],
    }));
  } else if (token) {
    checks.push(okCheck('mcp_token', {
      source:
        token === env.EVAL_KTX_MCP_TOKEN ? 'EVAL_KTX_MCP_TOKEN' :
        token === env.KTX_MCP_TOKEN ? 'KTX_MCP_TOKEN' :
        token === env.LUCY_LOCAL_TOKEN ? 'LUCY_LOCAL_TOKEN' :
        'LUCY_MCP_PROXY_TOKEN',
    }));
  }

  if (parsedUrl) {
    if (typeof fetchImpl !== 'function') {
      checks.push(blockedCheck('mcp_endpoint', 'fetch is not available in this Node runtime', { url: mcpUrl }));
    } else {
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const response = await fetchImpl(mcpUrl, { method: 'GET', headers });
        if (response.status === 401) {
          checks.push(blockedCheck('mcp_endpoint', 'MCP endpoint rejected bearer auth or requires a token', { url: mcpUrl, status: 401 }));
        } else if (response.status === 403) {
          checks.push(blockedCheck('mcp_endpoint', 'MCP endpoint rejected access', { url: mcpUrl, status: 403 }));
        } else if (response.status >= 500) {
          const body = await response.text().catch(() => '');
          checks.push(blockedCheck('mcp_endpoint', 'MCP endpoint is unhealthy', {
            url: mcpUrl,
            status: response.status,
            bodySnippet: redactCommandOutput(body).slice(0, 300),
          }));
        } else {
          checks.push(okCheck('mcp_endpoint', {
            url: mcpUrl,
            status: response.status,
            auth: token ? 'bearer' : 'none',
          }));
          if (!token) {
            checks.push(okCheck('mcp_token', { source: 'not_required_by_endpoint', endpointStatus: response.status }));
          }
        }
      } catch (error) {
        checks.push(blockedCheck('mcp_endpoint', 'MCP endpoint is not reachable', { url: mcpUrl, error: error.message }));
      }
    }
  }

  const blocked = checks.filter((check) => check.status === 'blocked');
  return {
    status: blocked.length > 0 ? 'blocked' : 'ok',
    checks,
    blockedReasons: blocked.map((check) => ({ name: check.name, reason: check.reason })),
  };
}

function evidenceBase({ status, exitCode, args, suites, precheck }) {
  return {
    generatedAt: new Date().toISOString(),
    status,
    exitCode,
    command: 'scripts/p1-business-eval-full.mjs',
    config: {
      suites: suites.map((suite) => suite.id),
      retries: args.retries,
      agentCli: args.cli,
      mcpUrl: args.mcpUrl,
      requireMcpToken: args.requireMcpToken,
    },
    precheck,
    suites: [],
    summary: {
      totalCases: 0,
      pass: 0,
      fail: 0,
    },
  };
}

function ensureParentDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeEvidence(path, evidence) {
  const abs = resolve(REPO_ROOT, path);
  ensureParentDir(abs);
  writeFileSync(abs, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  return abs;
}

async function runSuite(suite, { args, env = process.env, run = runCommand } = {}) {
  const artifactPath = resolve(REPO_ROOT, `inbox/p1-business-eval-full-${suite.id}.json`);
  const stderrPath = resolve(REPO_ROOT, `inbox/p1-business-eval-full-${suite.id}.stderr.log`);
  const mcpConfigPath = resolve('/tmp', `project-lucy-p1-business-eval-full-${suite.id}-${process.pid}.json`);
  ensureParentDir(artifactPath);

  const commandArgs = [
    'scripts/eval-runner.mjs',
    '--format',
    'json',
    '--cases',
    suite.casesPath,
    '--retries',
    String(args.retries),
  ];
  const childEnv = {
    ...env,
    EVAL_KTX_MCP_URL: args.mcpUrl,
    EVAL_MCP_CONFIG: mcpConfigPath,
  };
  const token = bearerTokenFromEnv(env);
  if (token) childEnv.EVAL_KTX_MCP_TOKEN = token;

  const startedAt = new Date().toISOString();
  let result;
  try {
    result = await run('node', commandArgs, { cwd: REPO_ROOT, env: childEnv, timeoutMs: 60 * 60 * 1000 });
  } finally {
    rmSync(mcpConfigPath, { force: true });
  }
  const finishedAt = new Date().toISOString();

  writeFileSync(artifactPath, result.stdout, 'utf8');
  writeFileSync(stderrPath, redactCommandOutput(result.stderr), 'utf8');

  let summary = null;
  let parseError = null;
  try {
    summary = JSON.parse(result.stdout);
  } catch (error) {
    parseError = error.message;
  }

  return {
    id: suite.id,
    label: suite.label,
    casesPath: suite.casesPath,
    command: ['node', ...commandArgs].join(' '),
    startedAt,
    finishedAt,
    exitCode: result.code,
    status: result.code === 0 && summary && summary.fail === 0 ? 'pass' : 'fail',
    artifactPath,
    stderrPath,
    parseError,
    totalCases: summary?.total ?? 0,
    pass: summary?.pass ?? 0,
    fail: summary?.fail ?? (summary ? 0 : 1),
    failedCaseIds: Array.isArray(summary?.cases) ? summary.cases.filter((entry) => !entry.pass).map((entry) => entry.id) : [],
  };
}

async function runFullEval({ args, env = process.env, fetchImpl = globalThis.fetch, run = runCommand } = {}) {
  const suites = selectSuites(args.suites);
  const precheck = await runPrecheck({
    suites,
    cli: args.cli,
    mcpUrl: args.mcpUrl,
    env,
    fetchImpl,
    run,
    requireMcpToken: args.requireMcpToken,
  });

  if (precheck.status === 'blocked') {
    const evidence = evidenceBase({ status: 'blocked', exitCode: EXIT_CODES.blocked, args, suites, precheck });
    return { evidence, exitCode: EXIT_CODES.blocked };
  }

  const evidence = evidenceBase({ status: 'running', exitCode: null, args, suites, precheck });
  for (const suite of suites) {
    const suiteEvidence = await runSuite(suite, { args, env, run });
    evidence.suites.push(suiteEvidence);
    evidence.summary.totalCases += suiteEvidence.totalCases;
    evidence.summary.pass += suiteEvidence.pass;
    evidence.summary.fail += suiteEvidence.fail;
  }

  evidence.status = evidence.suites.every((suite) => suite.status === 'pass') ? 'pass' : 'fail';
  evidence.exitCode = evidence.status === 'pass' ? EXIT_CODES.pass : EXIT_CODES.evalFail;
  return { evidence, exitCode: evidence.exitCode };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(`error: ${error.message}\n\n${USAGE}`);
    process.exit(EXIT_CODES.usage);
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const { evidence, exitCode } = await runFullEval({ args });
  const outPath = writeEvidence(args.out, evidence);
  console.error(`[p1-business-eval-full] wrote evidence: ${outPath}`);
  if (evidence.status === 'blocked') {
    console.error(`[p1-business-eval-full] BLOCKED: ${evidence.precheck.blockedReasons.map((item) => item.name).join(', ')}`);
  } else {
    console.error(`[p1-business-eval-full] ${evidence.status.toUpperCase()}: ${evidence.summary.pass}/${evidence.summary.totalCases} cases passed`);
  }
  process.exit(exitCode);
}

export {
  EXIT_CODES,
  MODEL_SECRET_ENVS,
  SUITES,
  bearerTokenFromEnv,
  hasModelSecret,
  parseArgs,
  runFullEval,
  runPrecheck,
  selectSuites,
  writeEvidence,
};

const isEntry = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === __filename;
  } catch {
    return false;
  }
})();

if (isEntry) {
  main().catch((error) => {
    console.error(`fatal: ${error.stack || error.message || error}`);
    process.exit(EXIT_CODES.usage);
  });
}
