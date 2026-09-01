#!/usr/bin/env node
import assert from 'node:assert/strict';
import { listAdapters, normalizeAdapterName, resolveAdapter } from './eval/adapters/index.mjs';
import { renderCommandParts } from './eval/adapters/shared.mjs';

let pass = 0;
let fail = 0;

function test(name, fn) {
  try {
    fn();
    pass += 1;
  } catch (error) {
    fail += 1;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

test('listAdapters includes customer adapters', () => {
  const ids = listAdapters().map((item) => item.id);
  for (const id of ['claude-code', 'hermes', 'cursor', 'openclaw', 'codex', 'generic-cli', 'noop']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test('resolveAdapter accepts aliases', () => {
  assert.equal(resolveAdapter('claude_code').id, 'claude-code');
  assert.equal(resolveAdapter('hermes').id, 'hermes');
  assert.equal(resolveAdapter('cursor').id, 'cursor');
});

test('normalizeAdapterName defaults to claude-code', () => {
  const prev = process.env.EVAL_AGENT_ADAPTER;
  delete process.env.EVAL_AGENT_ADAPTER;
  delete process.env.LUCY_EVAL_AGENT_ADAPTER;
  assert.equal(normalizeAdapterName(''), 'claude-code');
  if (prev === undefined) delete process.env.EVAL_AGENT_ADAPTER;
  else process.env.EVAL_AGENT_ADAPTER = prev;
});

test('renderCommandParts replaces question and mcp config', () => {
  const rendered = renderCommandParts(['exec', '{question}', '--mcp-config', '{mcp_config}'], {
    question: 'hello',
    mcpConfig: '/tmp/mcp.json',
  });
  assert.deepEqual(rendered, ['exec', 'hello', '--mcp-config', '/tmp/mcp.json']);
});

test('unknown adapter throws', () => {
  assert.throws(() => resolveAdapter('not-a-real-adapter'), /Unknown eval agent adapter/);
});

console.error(`eval-adapters.test.mjs: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
