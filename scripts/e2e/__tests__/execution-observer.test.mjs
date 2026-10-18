// B3 independent execution observer (Spec §6.2, §8.1; A4/C1 binding).
//
// These tests prove the observer contract: missing provider is `unknown`, a measured
// zero is a non-negative integer bound to a real record set, the verifier-friendly
// shape carries hashes (incl. a recordSetHash of the actual rows the source returned),
// and the observer is bound to the run / instance / agent / time window. Tests do not
// exercise the network.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPassThroughObserver, observeExecutions, toRunnerShape } from "../lib/execution-observer.mjs";

describe("B3 execution-observer: missing provider is 'unknown' (never 0)", () => {
  it("returns upstreamExecutionCount='unknown' when no observe() provider is configured", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z"
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /no independent observation provider/);
  });

  it("returns upstreamExecutionCount='unknown' when observe() returns undefined/null/'unknown'", async () => {
    for (const value of [undefined, null, "unknown"]) {
      const obs = await observeExecutions({
        runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
        since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
        observe: () => ({ count: value, source: "ktx-exec-log", recordSet: [] })
      });
      assert.equal(obs.upstreamExecutionCount, "unknown", `got count=${value}`);
    }
  });

  it("returns upstreamExecutionCount='unknown' when observe() throws (sync)", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => { throw new Error("boom"); }
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /observer threw: boom/);
  });

  it("returns upstreamExecutionCount='unknown' when observe() throws (async)", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: async () => { throw new Error("async-boom"); }
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /observer threw: async-boom/);
  });

  it("returns upstreamExecutionCount='unknown' when observe() returns a non-integer / negative number", async () => {
    for (const bad of [-1, 1.5, "0", true, NaN]) {
      const obs = await observeExecutions({
        runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
        since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
        observe: () => ({ count: bad, source: "ktx-exec-log", recordSet: [] })
      });
      assert.equal(obs.upstreamExecutionCount, "unknown", `bad count=${bad}`);
    }
  });
});

describe("B3 execution-observer: measured zero is a real 0 (not 'unknown'), bound to a real record set", () => {
  it("returns upstreamExecutionCount='unknown' when the production source returns no recordSet", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => ({ count: 0, source: "ktx-exec-log" })  // no recordSet field
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /did not return a recordSet/);
  });

  it("returns upstreamExecutionCount=0 when the observer measures zero upstream executions with a non-empty record set", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => ({ count: 0, source: "ktx-exec-log", recordSet: [{ q: "empty-window-marker" }] })
    });
    assert.equal(obs.upstreamExecutionCount, 0);
    assert.equal(obs.source, "ktx-exec-log");
    assert.equal(obs.hashes.resultSetHash.length, 64);
  });

  it("returns upstreamExecutionCount=0 when the production source returns an empty record set (legitimate 0)", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => ({ count: 0, source: "pg_stat_statements", recordSet: [] })
    });
    // An empty record set is a legitimate "no rows in this window" indicator for
    // `pg_stat_statements`. The verifier hashes the empty set and binds the count to
    // it; the gate collector can then independently re-query to corroborate.
    assert.equal(obs.upstreamExecutionCount, 0);
    assert.equal(obs.hashes.resultSetHash.length, 64);
  });

  it("accepts count=0 with a non-empty record set (the source actually executed the query)", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => ({ count: 0, source: "ktx-exec-log", recordSet: [{ query_hash: "abc", row_count: 0 }] })
    });
    assert.equal(obs.upstreamExecutionCount, 0);
    assert.equal(obs.source, "ktx-exec-log");
    assert.equal(obs.hashes.resultSetHash.length, 64);
  });

  it("returns upstreamExecutionCount=N with hashes bound to the run / agent / window", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abcdef012345",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: ({ runId, agentId, tokenFingerprint, since, until }) => ({
        count: 2,
        source: "sidecar-trace",
        recordSet: [{ id: 1 }, { id: 2 }],
        hashes: {
          queryHash: "qhash",
          resultSetHash: "rshash",
          sourceHash: `${runId}-${agentId}`,
          filterHash: `${tokenFingerprint}-${since}-${until}`
        }
      })
    });
    assert.equal(obs.upstreamExecutionCount, 2);
    assert.equal(obs.hashes.queryHash, "qhash");
    assert.equal(obs.hashes.filterHash, "abcdef012345-2026-10-18T00:00:00.000Z-2026-10-18T01:00:00.000Z");
    assert.equal(obs.hashes.synthetic, false);
  });
});

describe("B3 execution-observer: window and identity validation", () => {
  it("rejects missing required fields", async () => {
    const obs = await observeExecutions({ since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /runId is required/);
  });

  it("rejects invalid since/until (non-ISO timestamps)", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "a", tokenFingerprint: "t",
      since: "not-a-date", until: "2026-10-18T00:00:00.000Z"
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /valid ISO-8601|invalid|required/);
  });

  it("rejects until < since (ambiguous window)", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T01:00:00.000Z", until: "2026-10-18T00:00:00.000Z"
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /until is before since/);
  });
});

describe("B3 execution-observer: toRunnerShape preserves the unknown/measured distinction", () => {
  it("forwards unknown + problems to the runner-visible shape", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z"
    });
    const shape = toRunnerShape(obs);
    assert.equal(shape.upstreamExecutionCount, "unknown");
    assert.ok(Array.isArray(shape.problems));
    assert.equal(shape.window.since, "2026-10-18T00:00:00.000Z");
  });
});

describe("B3 execution-observer: source allowlist refuses tools/list-style sources AND synthetic in production", () => {
  it("refuses an unallowlisted source (e.g. an HTTP tools/list self-count)", async () => {
    const obs = await observeExecutions({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      observe: () => ({ count: 1, source: "http:tools/list", recordSet: [{ id: 1 }] })
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /not in the production allowlist|tools\/list/);
  });

  it("refuses pass-through:synthetic in production (synthetic flag is false)", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      synthetic: false,
      observe: () => ({ count: 0, source: "pass-through:synthetic", recordSet: [{ id: 1 }] })
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /production allowlist/);
  });

  it("accepts pass-through:synthetic only when synthetic:true is explicit", async () => {
    const obs = await observeExecutions({
      runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
      synthetic: true,
      observe: () => ({ count: 1, source: "pass-through:synthetic", recordSet: [{ id: 1 }] })
    });
    assert.equal(obs.upstreamExecutionCount, 1);
    assert.equal(obs.hashes.synthetic, true);
  });

  it("accepts the registered production pass-through sources", async () => {
    for (const source of ["ktx-exec-log", "pg_stat_statements", "sidecar-trace"]) {
      const obs = await observeExecutions({
        runId: "r1", agentId: "e2e_finance", tokenFingerprint: "abc",
        since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z",
        observe: () => ({ count: 0, source, recordSet: [{ q: "abc" }] })
      });
      assert.equal(obs.upstreamExecutionCount, 0, `source=${source} should yield count=0`);
    }
  });
});

describe("B3 execution-observer: createPassThroughObserver wires the privileged exec channel", () => {
  it("calls runCommand with the filtered identity and returns the parsed count", async () => {
    const calls = [];
    const runCommand = async (cmd) => {
      calls.push(cmd);
      return { ok: true, stdout: "5\n", rows: [{ n: 5 }] };
    };
    const observe = createPassThroughObserver({
      source: "pg_stat_statements",
      runCommand,
      identity: "lucy-e2e-observer",
      runId: "r1",
      instanceId: "i1"
    });
    const result = await observe({
      runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abc",
      since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z"
    });
    assert.equal(result.count, 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.identity, "lucy-e2e-observer");
    assert.equal(calls[0].args.runId, "r1");
    assert.equal(result.hashes.filterHash.length, 64);
    assert.equal(result.hashes.resultSetHash.length, 64);
  });

  it("refuses an unallowlisted source at construction time", () => {
    assert.throws(() => createPassThroughObserver({ source: "tools/list", runCommand: () => ({}), identity: "obs", runId: "r1" }), /must be in/);
  });

  it("returns unknown when runCommand fails", async () => {
    const observe = createPassThroughObserver({
      source: "ktx-exec-log",
      runCommand: async () => ({ ok: false, error: "kubectl exec timed out" }),
      identity: "obs",
      runId: "r1"
    });
    const result = await observe({ runId: "r1", agentId: "a", tokenFingerprint: "t", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown");
    assert.match(result.problems.join(" "), /pass-through exec failed/);
  });

  it("returns unknown when the source returns a non-integer count", async () => {
    const observe = createPassThroughObserver({
      source: "ktx-exec-log",
      runCommand: async () => ({ ok: true, stdout: "lots", rows: [{ q: "abc" }] }),
      identity: "obs",
      runId: "r1"
    });
    const result = await observe({ runId: "r1", agentId: "a", tokenFingerprint: "t", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown");
    assert.match(result.problems.join(" "), /non-integer/);
  });

  it("returns unknown when the source returns zero rows AND zero stdout (refuses to fabricate 0)", async () => {
    const observe = createPassThroughObserver({
      source: "ktx-exec-log",
      runCommand: async () => ({ ok: true, stdout: "", rows: [] }),
      identity: "obs",
      runId: "r1"
    });
    const result = await observe({ runId: "r1", agentId: "a", tokenFingerprint: "t", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown");
    assert.match(result.problems.join(" "), /refusing to fabricate|zero rows/);
  });

  it("returns unknown when the runner does not return a rows[] field", async () => {
    const observe = createPassThroughObserver({
      source: "ktx-exec-log",
      runCommand: async () => ({ ok: true, stdout: "5\n" }), // no rows field
      identity: "obs",
      runId: "r1"
    });
    const result = await observe({ runId: "r1", agentId: "a", tokenFingerprint: "t", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown");
    assert.match(result.problems.join(" "), /no rows\[\] field/);
  });
});
