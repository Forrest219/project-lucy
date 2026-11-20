import assert from 'node:assert/strict';

/** A transport failure or malformed MCP envelope must never count as an ACL denial. */
export function decodeWikiTool(response) {
  assert.equal(response.status, 200, 'MCP transport must succeed');
  const envelope = response.json;
  assert.ok(envelope && !envelope.error && envelope.result, 'MCP result envelope required');
  const result = envelope.result;
  assert.ok(Array.isArray(result.content), 'MCP content array required');
  const texts = result.content.filter(x => x.type === 'text').map(x => x.text);
  assert.equal(texts.length, 1, 'one unambiguous tool payload required');
  assert.equal(typeof texts[0], 'string');
  let data;
  try { data = JSON.parse(texts[0]); } catch { data = texts[0]; }
  return { isError: result.isError === true, data };
}
export function assertWikiSearch(response, key, visible) {
  const { isError, data } = decodeWikiTool(response);
  assert.equal(isError, false, 'search must succeed, including denied-target search');
  assert.ok(data && Array.isArray(data.results), 'structured search results required');
  const hit = data.results.some(x => x.key === key);
  assert.equal(hit, visible, `exact target search visibility: ${key}`);
  return { exactKey: key, visible: hit, resultCount: data.results.length };
}
export function assertWikiRead(response, key, marker, allowed) {
  if (!allowed && response.status === 200 && response.json?.error) {
    const error = response.json.error;
    assert.equal(error.code, -32003, 'only the stable context RPC denial counts');
    assert.equal(error.message, 'context_not_available');
    assert.equal(error.data?.reason, 'context_not_available');
    return { exactKey: key, allowed: false, code: error.data.reason, rpcCode: error.code };
  }
  const { isError, data } = decodeWikiTool(response);
  if (!allowed) {
    assert.equal(isError, true, 'ACL read denial must be a tool error');
    assert.equal(data, 'context_not_available', 'only the stable ACL denial counts');
    return { exactKey: key, allowed: false, code: data };
  }
  assert.equal(isError, false, 'authorized read must succeed');
  assert.ok(data && typeof data === 'object');
  assert.equal(data.key, key, 'authorized read must return the exact target');
  assert.equal(typeof data.content, 'string');
  assert.ok(data.content.includes(marker), 'authorized read must contain this write checkpoint marker');
  return { exactKey: key, allowed: true, markerMatched: true };
}
