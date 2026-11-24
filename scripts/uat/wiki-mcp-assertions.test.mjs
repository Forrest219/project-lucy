import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertWikiRead, assertWikiSearch } from './wiki-mcp-assertions.mjs';
const key = 'global/uat-wua-unit.md';
const result = (data, isError = false) => ({ status: 200, json: { result: { isError, content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] } } });
test('authorized read requires both exact key and current body marker', () => {
  assertWikiRead(result({ key, content: 'checkpoint-new' }), key, 'checkpoint-new', true);
  assert.throws(() => assertWikiRead(result({ key: 'other', content: 'checkpoint-new' }), key, 'checkpoint-new', true));
  assert.throws(() => assertWikiRead(result({ key, content: 'old' }), key, 'checkpoint-new', true));
});
test('denial rejects transport errors, generic error text, empty bodies and a successful payload containing access', () => {
  assertWikiRead(result('context_not_available', true), key, 'marker', false);
  assertWikiRead({ status: 200, json: { error: { code: -32003, message: 'context_not_available', data: { reason: 'context_not_available' } } } }, key, 'marker', false);
  for (const r of [
    { status: 503, json: {} },
    { status: 200, json: { error: { message: 'unauthorized' } } },
    result('network error', true), result(''), result({ key, content: 'access granted' }),
    result('context_not_available', false)
  ]) assert.throws(() => assertWikiRead(r, key, 'marker', false));
});
test('search uses exact keys and cannot be satisfied by another page or an error', () => {
  assertWikiSearch(result({ results: [{ key }] }), key, true);
  assertWikiSearch(result({ results: [{ key: 'unrelated' }] }), key, false);
  assert.throws(() => assertWikiSearch(result({ results: [{ key: key + '.other' }] }), key, true));
  assert.throws(() => assertWikiSearch(result({ results: [{ key }] }), key, false));
  assert.throws(() => assertWikiSearch(result('context_not_available', true), key, false));
});
