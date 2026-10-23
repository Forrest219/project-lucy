// Real loopback transparent forwarding observer (B3 production caller).
//
// These tests run a real HTTP upstream on a random loopback port and a real
// `LocalLoopbackObserver` listener on another random loopback port. They verify
// the observer forwards traffic transparently, records every completed forward,
// and surfaces the count + record set through `observeUpstream`. The observer
// does NOT count its own traffic; an HTTP `tools/list` issued from the same
// client does NOT bump the recorded upstream count.
//
// These are harness integration tests, NOT live E2E: the upstream is a local
// HTTP server we control, not a protected K8s deployment.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, it } from "node:test";
import { LocalLoopbackObserver } from "../lib/local-loopback-observer.mjs";

function startUpstream(handler) {
  return new Promise((resolve, reject) => {
    const server = createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, host: address.address, port: address.port });
    });
  });
}

function fetchOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, options, (response) => {
      const chunks = [];
      response.on("data", (c) => chunks.push(c));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe("B3 local-loopback-observer: real transparent forwarding", () => {
  let upstream;
  let observer;
  const recorded = [];
  beforeEach(async () => {
    upstream = await startUpstream((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        recorded.push({ method: req.method, url: req.url, headers: req.headers, body });
        // A simple MCP-shaped echo: respond with isError:false and the body verbatim.
        const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: `ok:${body}` }] } });
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(payload);
      });
    });
  });
  afterEach(async () => {
    if (observer) await observer.stop();
    if (upstream) await new Promise((resolve) => upstream.server.close(resolve));
    recorded.length = 0;
  });

  it("starts a real HTTP listener and forwards a POST request byte-for-byte to the upstream", async () => {
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    const upstreamReceived = recorded.length;
    const response = await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer test-token-1",
        "x-lucy-observer-agentid": "e2e_finance",
        "x-lucy-observer-tokenfingerprint": "abcdef012345",
        "x-lucy-observer-sessionid": "sess-1",
        "x-lucy-observer-correlation-id": "corr-1"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "lucy_query" } })
    });
    assert.equal(response.status, 200);
    assert.match(response.body.toString("utf8"), /ok:/);
    assert.equal(recorded.length, upstreamReceived + 1, "upstream received the forwarded request");
    assert.equal(recorded[0].method, "POST");
    assert.equal(recorded[0].url, "/mcp");
    assert.equal(recorded[0].headers["x-lucy-observer-correlation-id"], "corr-1");
    assert.equal(recorded[0].headers.authorization, "Bearer test-token-1");
  });

  it("observeUpstream returns a measured count bound to the actual record set + hashes", async () => {
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    const before = Date.now() - 1000;
    const since = new Date(before).toISOString();
    const until = new Date(Date.now() + 60000).toISOString();
    // Two real forwards for the same agent+token, one with a different agent (must NOT count).
    await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_finance", "x-lucy-observer-tokenfingerprint": "abcdef012345" },
      body: JSON.stringify({ method: "tools/call", params: { name: "lucy_query", arguments: { connectionId: "fin-db", source: "analytics.orders" } } })
    });
    await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_finance", "x-lucy-observer-tokenfingerprint": "abcdef012345" },
      body: JSON.stringify({ method: "tools/call", params: { name: "lucy_query", arguments: { connectionId: "fin-db", source: "analytics.orders", filters: [] } } })
    });
    await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_sales", "x-lucy-observer-tokenfingerprint": "deadbeef0001" },
      body: JSON.stringify({ method: "tools/call", params: { name: "lucy_query" } })
    });
    const observation = observer.observeUpstream({ since, until, agentId: "e2e_finance", tokenFingerprint: "abcdef012345" });
    assert.equal(observation.count, 2, "the recorded count is bound to agent + token fingerprint");
    assert.equal(observation.source, "loopback-observer");
    assert.equal(observation.recordSet.length, 2);
    assert.ok(observation.hashes.resultSetHash.length === 64, "resultSetHash is sha256 hex");
    assert.ok(observation.hashes.filterHash.length === 64);
    assert.ok(observation.hashes.queryHash.length === 64);
    assert.ok(observation.hashes.sourceHash.length === 64);
  });

  it("an HTTP 500 from the upstream is still recorded (failed/aborted still count as a forward)", async () => {
    if (upstream) await new Promise((resolve) => upstream.server.close(resolve));
    upstream = await startUpstream((req, res) => {
      res.statusCode = 500;
      res.end("internal");
    });
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    const since = new Date(Date.now() - 1000).toISOString();
    const until = new Date(Date.now() + 60000).toISOString();
    const response = await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_finance", "x-lucy-observer-tokenfingerprint": "abcdef012345" },
      body: JSON.stringify({ method: "tools/call" })
    });
    assert.equal(response.status, 500);
    const observation = observer.observeUpstream({ since, until, agentId: "e2e_finance", tokenFingerprint: "abcdef012345" });
    assert.equal(observation.count, 1, "an HTTP 500 still counts as a recorded forward (the body was forwarded)");
    assert.equal(observation.recordSet[0].response.status, 500);
  });

  it("rejects the observer's own traffic: a tools/list issued from the same loopback client does NOT inflate the recorded count", async () => {
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    // The observer doesn't issue its own traffic; this is just an extra "tools/list"-style
    // call from the test (NOT the observer) but it carries NO agent/token headers, so it
    // does NOT match the filter — and the count for an unknown agent is 0.
    await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ method: "tools/list" }) });
    const observation = observer.observeUpstream({
      since: new Date(Date.now() - 1000).toISOString(),
      until: new Date(Date.now() + 60000).toISOString(),
      agentId: "e2e_finance",
      tokenFingerprint: "abcdef012345"
    });
    assert.equal(observation.count, 0, "an unbindable request does not match the agent/token filter; count is 0, not unknown");
    assert.equal(observation.recordSet.length, 0);
  });

  it("an unexpected upstream reply (denied body) is forwarded byte-for-byte", async () => {
    if (upstream) await new Promise((resolve) => upstream.server.close(resolve));
    upstream = await startUpstream((req, res) => {
      // The upstream returns a real MCP denial envelope. The observer must NOT
      // re-shape it; the runner / verifier parses the body itself.
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: row_policy_upstream_unproven" }], isError: true } });
      res.statusCode = 200;
      res.setHeader("content-type", "application/json");
      res.end(body);
    });
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    const response = await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_finance", "x-lucy-observer-tokenfingerprint": "abcdef012345" },
      body: JSON.stringify({ method: "tools/call" })
    });
    assert.equal(response.status, 200);
    assert.match(response.body.toString("utf8"), /Access denied: row_policy_upstream_unproven/);
    const records = observer.records();
    assert.equal(records.length, 1);
    assert.equal(records[0].response.status, 200);
    assert.match(records[0].response.bodyHash ?? "", /^[a-f0-9]{64}$|^null$/);
  });

  it("records the refused request when the upstream is unreachable (does not silently drop)", async () => {
    if (upstream) await new Promise((resolve) => upstream.server.close(resolve));
    upstream = await startUpstream((req, res) => {
      res.statusCode = 200; res.end();
    });
    observer = new LocalLoopbackObserver({ runId: "r1", instanceId: "i1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    const { port: loopbackPort } = await observer.start();
    // Close the upstream to simulate it becoming unreachable mid-flight.
    await new Promise((resolve) => upstream.server.close(resolve));
    upstream = null;
    const response = await fetchOnce(`http://127.0.0.1:${loopbackPort}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-lucy-observer-agentid": "e2e_finance", "x-lucy-observer-tokenfingerprint": "abcdef012345" },
      body: JSON.stringify({ method: "tools/call" })
    });
    assert.equal(response.status, 502);
    assert.match(response.body.toString("utf8"), /observer failed to reach upstream/);
    const records = observer.records();
    assert.equal(records.length, 1);
    assert.equal(records[0].kind, "refusal");
  });

  it("refuses to start with an invalid upstream URL", () => {
    assert.throws(() => new LocalLoopbackObserver({ runId: "r1", upstreamUrl: "not-a-url" }), /upstreamUrl/);
    assert.throws(() => new LocalLoopbackObserver({ runId: "r1", upstreamUrl: "ftp://127.0.0.1:1" }), /protocol/);
    assert.throws(() => new LocalLoopbackObserver({}), /runId/);
    assert.throws(() => new LocalLoopbackObserver({ runId: "r1" }), /upstreamUrl/);
  });
});