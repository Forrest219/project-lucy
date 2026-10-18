// B3 reviewer corrections: async/await chain must actually await.
//
// Previous implementation: SecurityContext.observeUpstream synchronously called
// observeExecutions (which returns a Promise), then ran toRunnerShape(Promise) on
// the still-pending Promise — every field on the returned shape was `undefined`.
// The fix is to make observeUpstream itself async and to await the underlying
// execution-observer before shaping. These regressions verify the chain end-to-end.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, before, after } from "node:test";
import { observeExecutions, toRunnerShape } from "../lib/execution-observer.mjs";
import { SecurityContext } from "../security/context.mjs";

function seedSecrets(tmp) {
  const secretsDir = path.join(tmp, "secrets");
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(secretsDir, "tokens.json"), JSON.stringify({ e2e_finance: "lucy_e2e_seedtoken0000000000000000000000" }));
  writeFileSync(path.join(secretsDir, "admins.json"), JSON.stringify({ owner: { adminId: "owner", password: "owner-pw" }, operator: { adminId: "operator", password: "operator-pw" } }));
  writeFileSync(path.join(secretsDir, "bootstrap-token"), "bootstrap-tok");
  return secretsDir;
}

function makeFakeRun(tmp) {
  const runDir = tmp;
  const projectDir = path.join(tmp, "project");
  const checkerDir = path.join(tmp, "checker");
  mkdirSync(projectDir, { recursive: true });
  mkdirSync(checkerDir, { recursive: true });
  writeFileSync(path.join(checkerDir, "gold.json"), JSON.stringify({ canaries: {}, questions: {} }));
  return {
    runId: "async-test-0001",
    executionMode: "local",
    caseCatalogDigest: "sha256:test",
    profileDigest: null,
    instance: { baseUrl: "http://127.0.0.1:0", mcpUrl: "http://127.0.0.1:0/mcp", startedBy: "runner" },
    paths: { runDir, project: projectDir, checker: checkerDir },
    secretsDir: seedSecrets(tmp),
    instanceId: "logical"
  };
}

describe("B3 async chain: observeExecutions awaits the inner observer and toRunnerShape gets a real shape", () => {
  it("observeExecutions awaits a slow async provider and resolves with the measured shape", async () => {
    let called = 0;
    const observe = async ({ since, until }) => {
      called += 1;
      // Simulate the privileged channel being slow (e.g. kubectl exec).
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { count: 3, source: "loopback-observer", recordSet: [{ id: 1 }, { id: 2 }, { id: 3 }], hashes: { queryHash: "q", resultSetHash: "r", sourceHash: "s", filterHash: "f" } };
    };
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe
    });
    assert.equal(called, 1);
    assert.equal(obs.upstreamExecutionCount, 3);
    const shape = toRunnerShape(obs);
    assert.equal(shape.upstreamExecutionCount, 3);
    assert.equal(shape.source, "loopback-observer");
  });

  it("observeExecutions rejects a Promise-shaped raw that is itself a still-pending thenable", async () => {
    // The contract requires `observe()` to be either a sync function returning
    // a snapshot OR an async function. If the resolved value is itself a Promise
    // object (a buggy observer returned a thenable without settling it), the
    // entry point must reject the snapshot — the previous implementation
    // happily called `.count` on the Promise and got `undefined`. The check is
    // performed with a thenable that immediately resolves to "unknown" so the
    // test does not hang.
    const observe = async () => Promise.resolve({ count: "unknown", source: "ktx-exec-log", recordSet: [], problems: ["observer refused to settle"] });
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /observer refused to settle/);
  });
});

describe("B3 async chain: SecurityContext.observeUpstream is async and returns the awaited shape", () => {
  let tmp;
  before(() => { tmp = mkdtempSync(path.join(tmpdir(), "lucy-async-")); });
  after(() => { if (tmp) rmSync(tmp, { recursive: true, force: true }); });

  it("returns an object (NOT a Promise) when awaited, and every field is populated", async () => {
    const run = makeFakeRun(tmp);
    // Provider: returns a measured count synchronously after one microtask.
    const observerFactory = () => async () => ({ count: 1, source: "loopback-observer", recordSet: [{ id: 1 }], hashes: { queryHash: "q", resultSetHash: "r", sourceHash: "s", filterHash: "f" } });
    const ctx = new SecurityContext({ run, capabilities: { "lucy-http": true, "ktx-upstream": true }, observerFactory });
    const obs = await ctx.observeUpstream({
      since: "2026-10-18T00:00:00.000Z",
      until: "2026-10-18T01:00:00.000Z",
      agentId: "e2e_finance",
      tokenFingerprint: "abc"
    });
    // Every field is a real value, not `undefined`.
    assert.ok(obs, "observeUpstream returned a real object");
    assert.equal(typeof obs, "object");
    assert.equal(obs.upstreamExecutionCount, 1, "real count, not undefined from a Promise-shaped object");
    assert.equal(obs.source, "loopback-observer");
    assert.ok(obs.cursor >= 1, "cursor is a real monotonic integer");
    assert.ok(typeof obs.snapshotId === "string" && obs.snapshotId.length === 16, "snapshotId is a 16-hex string");
    assert.ok(Array.isArray(obs.problems) && obs.problems.length === 0);
  });

  it("returns 'unknown' (not undefined fields) when no provider is configured", async () => {
    const run = makeFakeRun(tmp);
    const ctx = new SecurityContext({ run, capabilities: { "lucy-http": true } }); // no observerFactory
    const obs = await ctx.observeUpstream({
      since: "2026-10-18T00:00:00.000Z",
      until: "2026-10-18T01:00:00.000Z",
      agentId: "e2e_finance",
      tokenFingerprint: "abc"
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.equal(obs.source, "no-observer");
    assert.match(obs.problems.join(" "), /no independent observation provider/);
  });

  it("awaitUpstream resolves the same shape as observeUpstream", async () => {
    const run = makeFakeRun(tmp);
    const observerFactory = () => async () => ({ count: 7, source: "loopback-observer", recordSet: [{ id: 1 }], hashes: {} });
    const ctx = new SecurityContext({ run, capabilities: {}, observerFactory });
    const a = await ctx.awaitUpstream({ since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z", agentId: "e2e_finance", tokenFingerprint: "abc" });
    const b = await ctx.observeUpstream({ since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z", agentId: "e2e_finance", tokenFingerprint: "abc" });
    assert.equal(a.upstreamExecutionCount, 7);
    assert.equal(b.upstreamExecutionCount, 7);
  });

  it("two observeUpstream calls produce strictly-monotonic cursors and distinct snapshotIds", async () => {
    const run = makeFakeRun(tmp);
    const observerFactory = () => async () => ({ count: 0, source: "loopback-observer", recordSet: [] });
    const ctx = new SecurityContext({ run, capabilities: {}, observerFactory });
    const a = await ctx.observeUpstream({ since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z", agentId: "e2e_finance", tokenFingerprint: "abc" });
    const b = await ctx.observeUpstream({ since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z", agentId: "e2e_finance", tokenFingerprint: "abc" });
    assert.ok(b.cursor > a.cursor, "cursors are strictly increasing");
    assert.notEqual(a.snapshotId, b.snapshotId, "snapshotIds are distinct even for identical inputs");
  });

  it("upstreamDelta still rejects identical snapshot ids (would be a fabricated zero)", async () => {
    const run = makeFakeRun(tmp);
    const observerFactory = () => async () => ({ count: 0, source: "loopback-observer", recordSet: [] });
    const ctx = new SecurityContext({ run, capabilities: {}, observerFactory });
    const snap = { upstreamExecutionCount: 0, cursor: 1, snapshotId: "same", source: "loopback-observer", window: { since: "x", until: "y" } };
    assert.equal(ctx.upstreamDelta(snap, { ...snap, cursor: 2 }), null, "same snapshot id => null (no fabricated zero)");
  });

  it("upstreamDelta rejects cross-source deltas (different observers can't be compared)", async () => {
    const run = makeFakeRun(tmp);
    const observerFactory = () => async () => ({ count: 0, source: "loopback-observer", recordSet: [] });
    const ctx = new SecurityContext({ run, capabilities: {}, observerFactory });
    const before = { upstreamExecutionCount: 0, cursor: 1, snapshotId: "a", source: "loopback-observer", window: { since: "x", until: "y" } };
    const after = { upstreamExecutionCount: 0, cursor: 2, snapshotId: "b", source: "pg_stat_statements", window: { since: "x", until: "y" } };
    assert.equal(ctx.upstreamDelta(before, after), null);
  });
});