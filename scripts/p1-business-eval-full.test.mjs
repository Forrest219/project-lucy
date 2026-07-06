#!/usr/bin/env node
import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import {
  EXIT_CODES,
  bearerTokenFromEnv,
  parseArgs,
  runFullEval,
  runPrecheck,
  selectSuites,
} from './p1-business-eval-full.mjs';

function okFetch(status = 404) {
  return async () => ({ status, text: async () => '' });
}

function cliReadyRun({ runnerStdout } = {}) {
  return async (command, args) => {
    if (command === 'fake-claude' && args[0] === '--version') {
      return { code: 0, stdout: 'fake-claude 1.0.0\n', stderr: '' };
    }
    if (command === 'fake-claude' && args[0] === 'auth') {
      return { code: 0, stdout: '{"loggedIn":true,"apiProvider":"anthropic"}\n', stderr: '' };
    }
    if (command === 'node' && args[0] === 'scripts/eval-runner.mjs') {
      return {
        code: 0,
        stdout: runnerStdout || JSON.stringify({ total: 1, pass: 1, fail: 0, cases: [{ id: 'case-1', pass: true }] }),
        stderr: '# runner ok\n',
      };
    }
    return { code: 127, stdout: '', stderr: `unexpected command: ${command} ${args.join(' ')}` };
  };
}

test('parseArgs supports suite selection and explicit MCP token requirement', () => {
  const args = parseArgs([
    'node',
    'scripts/p1-business-eval-full.mjs',
    '--suite',
    'superstore',
    '--suite',
    'data_agent_poc',
    '--retries',
    '2',
    '--cli',
    'fake-claude',
    '--mcp-url',
    'http://localhost:7879/mcp',
    '--require-mcp-token',
  ]);

  assert.deepEqual(args.suites, ['superstore', 'data_agent_poc']);
  assert.equal(args.retries, 2);
  assert.equal(args.cli, 'fake-claude');
  assert.equal(args.mcpUrl, 'http://localhost:7879/mcp');
  assert.equal(args.requireMcpToken, true);
});

test('selectSuites rejects unknown suite ids', () => {
  assert.throws(() => selectSuites(['missing_suite']), /unknown suite/);
});

test('bearerTokenFromEnv uses documented fallback order', () => {
  assert.equal(
    bearerTokenFromEnv({
      KTX_MCP_TOKEN: 'ktx-token',
      LUCY_LOCAL_TOKEN: 'lucy-token',
    }),
    'ktx-token'
  );
  assert.equal(
    bearerTokenFromEnv({
      EVAL_KTX_MCP_TOKEN: 'eval-token',
      KTX_MCP_TOKEN: 'ktx-token',
    }),
    'eval-token'
  );
});

test('runPrecheck blocks when a required MCP token is absent', async () => {
  const precheck = await runPrecheck({
    suites: selectSuites(['superstore']),
    cli: 'fake-claude',
    mcpUrl: 'http://localhost:7879/mcp',
    env: {},
    fetchImpl: okFetch(404),
    run: cliReadyRun(),
    requireMcpToken: true,
  });

  assert.equal(precheck.status, 'blocked');
  assert(precheck.blockedReasons.some((item) => item.name === 'mcp_token'));
  assert(precheck.checks.some((item) => item.name === 'agent_cli' && item.status === 'ok'));
  assert(precheck.checks.some((item) => item.name === 'model_secret' && item.status === 'ok'));
});

test('runPrecheck treats unauthenticated local MCP GET as usable when token is not required', async () => {
  const precheck = await runPrecheck({
    suites: selectSuites(['superstore']),
    cli: 'fake-claude',
    mcpUrl: 'http://localhost:7878/mcp',
    env: {},
    fetchImpl: okFetch(404),
    run: cliReadyRun(),
    requireMcpToken: false,
  });

  assert.equal(precheck.status, 'ok');
  assert(precheck.checks.some((item) => item.name === 'mcp_endpoint' && item.status === 'ok'));
  assert(precheck.checks.some((item) => item.name === 'mcp_token' && item.detail.source === 'not_required_by_endpoint'));
});

test('runFullEval returns blocked evidence without running eval-runner', async () => {
  let runnerCalled = false;
  const run = async (command, args) => {
    if (command === 'node' && args[0] === 'scripts/eval-runner.mjs') runnerCalled = true;
    return cliReadyRun()(command, args);
  };
  const args = parseArgs([
    'node',
    'scripts/p1-business-eval-full.mjs',
    '--suite',
    'superstore',
    '--cli',
    'fake-claude',
    '--require-mcp-token',
  ]);

  const { evidence, exitCode } = await runFullEval({
    args,
    env: {},
    fetchImpl: okFetch(404),
    run,
  });

  assert.equal(exitCode, EXIT_CODES.blocked);
  assert.equal(evidence.status, 'blocked');
  assert.equal(evidence.suites.length, 0);
  assert.equal(runnerCalled, false);
});

test('runFullEval aggregates eval-runner JSON artifacts for selected suites', async () => {
  const args = parseArgs([
    'node',
    'scripts/p1-business-eval-full.mjs',
    '--suite',
    'superstore',
    '--cli',
    'fake-claude',
    '--mcp-url',
    'http://localhost:7878/mcp',
  ]);

  const { evidence, exitCode } = await runFullEval({
    args,
    env: {},
    fetchImpl: okFetch(404),
    run: cliReadyRun({
      runnerStdout: JSON.stringify({
        total: 2,
        pass: 1,
        fail: 1,
        gates: {
          traceCoverage: true,
          traceUniqueness: true,
          contextEvidenceCoverage: true,
        },
        trace: {
          requiredCases: 2,
          tracedCases: 2,
          uniqueTraces: 2,
        },
        context: {
          requiredCases: 1,
          evidencedCases: 1,
        },
        cases: [
          { id: 'case-pass', pass: true },
          { id: 'case-fail', pass: false },
        ],
      }),
    }),
  });

  assert.equal(exitCode, EXIT_CODES.evalFail);
  assert.equal(evidence.status, 'fail');
  assert.equal(evidence.summary.totalCases, 2);
  assert.equal(evidence.summary.pass, 1);
  assert.equal(evidence.summary.fail, 1);
  assert.equal(evidence.summary.traceCoverage, true);
  assert.equal(evidence.summary.traceUniqueness, true);
  assert.equal(evidence.summary.contextEvidenceCoverage, true);
  assert.equal(evidence.summary.tracedCases, 2);
  assert.equal(evidence.summary.contextEvidencedCases, 1);
  assert.deepEqual(evidence.suites[0].failedCaseIds, ['case-fail']);

  rmSync('inbox/p1-business-eval-full-superstore.json', { force: true });
  rmSync('inbox/p1-business-eval-full-superstore.stderr.log', { force: true });
});
