// W-05 regression tests: the independent upstream observation channel.
//
// The channel used to be dead in three independent ways, and every one of them made
// the security leg's numbers untrustworthy:
//
//   1. `createDefaultObserverFactory` handed out a FRESH closure per call, so the
//      instance the runner started was not the instance the SecurityContext observed
//      ⇒ every observation came back "loopback-observer-not-started";
//   2. the observer was never ON the request path (Lucy talked to the KTX upstream
//      directly), so it could never see an execution;
//   3. nothing asserted that an authorized query actually produced an upstream
//      execution, so a mis-wired channel would turn every "zero upstream executions"
//      claim into a VACUOUS PASS.
//
// These tests pin the fixes: the shared instance, the classification that separates
// protocol chatter from tool calls, the positive control that fails closed, the
// per-case gate, and the polarity of the two assertion helpers (a denied request
// must cause zero upstream executions; an allowed request MUST cause at least one).

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createServer, request as httpRequest } from "node:http";
import { createDefaultObserverFactory, LocalLoopbackObserver, classifyUpstreamCall } from "../lib/local-loopback-observer.mjs";
import { observationGateVerdict, proveUpstreamObservation, OBSERVATION_DEPENDENT_SCENARIOS } from "../run-security.mjs";
import { Checks } from "../security/context.mjs";
import { expectAuthorizedUpstream, expectUpstreamZero, observationWindow } from "../security/observation.mjs";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function startUpstream(handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, port };
}

async function post(port, body, headers = {}) {
  // A plain http request with `agent: false`: a keep-alive socket would keep the
  // server open and hang the test process at the end.
  return new Promise((resolve, reject) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = httpRequest(
      { host: "127.0.0.1", port, path: "/mcp", method: "POST", agent: false, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers } },
      (response) => {
        response.on("data", () => {});
        response.on("end", () => resolve(response.statusCode));
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/** A synthetic SecurityContext whose observation channel reports a fixed delta. */
function fakeCtx({ delta = 0, unknown = false } = {}) {
  let counter = 0;
  return {
    tokens: { e2e_finance: "tok-fin" },
    authorizedUpstreamBaseline: 1,
    async observeUpstream() {
      counter += 1;
      return {
        upstreamExecutionCount: unknown ? "unknown" : counter === 1 ? 0 : delta,
        window: { since: "x", until: "y" },
        source: "loopback-observer",
        attribution: "instance-wide",
        snapshotId: `snap-${counter}`,
        cursor: counter,
        problems: []
      };
    },
    upstreamDelta(before, after) {
      if (before.upstreamExecutionCount === "unknown" || after.upstreamExecutionCount === "unknown") return null;
      if (after.cursor <= before.cursor) return null;
      return after.upstreamExecutionCount - before.upstreamExecutionCount;
    },
    async lucyQuery() {
      return { status: 200, text: "" };
    }
  };
}

/** A minimal context that can compute a delta between two snapshots. */
function ctxStub() {
  return {
    upstreamDelta(before, after) {
      if (before.upstreamExecutionCount === "unknown" || after.upstreamExecutionCount === "unknown") return null;
      if (after.cursor <= before.cursor) return null;
      return after.upstreamExecutionCount - before.upstreamExecutionCount;
    }
  };
}

/** A window that has been closed with the given measured delta. */
function closedWindow(before = 0, after = 0) {
  return {
    before: { upstreamExecutionCount: before, source: "loopback-observer", attribution: "instance-wide", cursor: 1 },
    after: { upstreamExecutionCount: after, source: "loopback-observer", cursor: 2 }
  };
}

// ---------------------------------------------------------------------------
// 1. the factory shares ONE instance across every closure it hands out
// ---------------------------------------------------------------------------

describe("W-05 the observer factory shares its started instance", () => {
  it("hands out a CALLABLE provider (observeExecutions invokes it as a function)", async () => {
    const factory = createDefaultObserverFactory({ run: { instance: { startedBy: "runner" }, runId: "r1", instanceId: "i1" } });
    const observer = factory({ runId: "r1", instanceId: "i1", agentId: "e2e_finance", identity: "lucy-e2e-observer" });
    assert.equal(typeof observer, "function", "a plain object here silently degraded every observation to 'no-observer'");
    const result = await observer({ runId: "r1", instanceId: "i1", agentId: "e2e_finance", tokenFingerprint: "abc", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown", "not started yet ⇒ unknown, never a fabricated 0");
    assert.equal(result.source, "loopback-observer-not-started");
    assert.equal(typeof observer.ensureStarted, "function");
    assert.equal(typeof observer.stop, "function");
    assert.equal(typeof observer.observeUpstream, "function");
  });

  it("an external run's provider is callable too and reports 'unknown'", async () => {
    const factory = createDefaultObserverFactory({ run: { instance: { startedBy: "external" } } });
    const observer = factory({ runId: "r-ext", instanceId: "i-ext", agentId: "a", identity: "x" });
    assert.equal(typeof observer, "function");
    const result = await observer({ runId: "r-ext", instanceId: "i-ext", agentId: "a", tokenFingerprint: "t", since: "2026-10-18T00:00:00.000Z", until: "2026-10-18T01:00:00.000Z" });
    assert.equal(result.count, "unknown");
    assert.equal(result.source, "external-no-in-process-recording");
  });

  it("a closure created AFTER ensureStarted() observes the same instance", async () => {
    const upstream = await startUpstream((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "ok" }] } }));
      });
    });
    const factory = createDefaultObserverFactory({ run: { instance: { startedBy: "runner" }, runId: "r1", instanceId: "i1" } });
    const first = factory({ runId: "r1", instanceId: "i1", agentId: "e2e_finance", identity: "lucy-e2e-observer" });
    const instance = await first.ensureStarted(`http://127.0.0.1:${upstream.port}`);
    assert.ok(instance instanceof LocalLoopbackObserver);
    const observerPort = Number(new URL(instance.baseUrl()).port);

    // A SECOND closure from the same factory — this is what the SecurityContext asks
    // for on every observation. Before the fix it carried its own empty state and
    // answered "loopback-observer-not-started".
    const second = factory({ runId: "r1", instanceId: "i1", agentId: "e2e_finance", identity: "lucy-e2e-observer" });
    await post(observerPort, { method: "tools/call", params: { name: "lucy_query" } });
    const observation = await second.observeUpstream({
      since: new Date(Date.now() - 1000).toISOString(),
      until: new Date(Date.now() + 60_000).toISOString(),
      agentId: "e2e_finance",
      tokenFingerprint: "abc"
    });
    assert.equal(observation.source, "loopback-observer", "the second closure observes the STARTED instance");
    assert.equal(observation.count, 1);

    await first.stop();
    await new Promise((resolve) => upstream.server.close(resolve));
  });
});

// ---------------------------------------------------------------------------
// 2. the classification separates protocol chatter from upstream tool calls
// ---------------------------------------------------------------------------

describe("W-05 upstream call classification", () => {
  it("a tools/call is a data-plane execution, whatever tool it names", () => {
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "tools/call", params: { name: "sl_query" } }))).kind, "query");
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "tools/call", params: { name: "sl_read_source" } }))).kind, "source_read");
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "tools/call" }))).kind, "other_tool");
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "tools/call", params: { name: "lucy_catalog" } }))).toolName, "lucy_catalog");
  });

  it("initialize / tools/list / notifications are protocol chatter, not executions", () => {
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "initialize" }))).kind, "control");
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "tools/list" }))).kind, "control");
    assert.equal(classifyUpstreamCall(Buffer.from(JSON.stringify({ method: "notifications/initialized" }))).kind, "control");
    assert.equal(classifyUpstreamCall(Buffer.from("not json")).kind, "unknown");
  });

  it("the observer counts tool calls and ignores the protocol chatter", async () => {
    const upstream = await startUpstream((req, res) => {
      req.on("data", () => {});
      req.on("end", () => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end("{}");
      });
    });
    const observer = new LocalLoopbackObserver({ runId: "r1", upstreamUrl: `http://127.0.0.1:${upstream.port}` });
    await observer.start();
    const observerPort = Number(new URL(observer.baseUrl()).port);
    const since = new Date(Date.now() - 1000).toISOString();
    const until = new Date(Date.now() + 60_000).toISOString();
    await post(observerPort, { method: "initialize", params: {} });
    await post(observerPort, { method: "tools/list" });
    await post(observerPort, { method: "tools/call", params: { name: "sl_query" } });
    const observation = observer.observeUpstream({ since, until, agentId: "a", tokenFingerprint: "t" });
    assert.equal(observation.count, 1, "only the tool call counts as an upstream execution");
    assert.equal(observation.controlCallCount, 2, "the protocol chatter is still visible in the evidence");
    assert.equal(observation.queryCount, 1);
    assert.equal(observation.attribution, "instance-wide", "the upstream carries no client identity, so the count is instance-wide");
    await observer.stop();
    await new Promise((resolve) => upstream.server.close(resolve));
  });
});

// ---------------------------------------------------------------------------
// 3. the positive control fails closed
// ---------------------------------------------------------------------------

describe("W-05 the positive control", () => {
  it("is NOT proven when the observer never sees an upstream execution", async () => {
    const proof = await proveUpstreamObservation({
      ctx: fakeCtx({ delta: 0 }),
      run: { runId: "r1" },
      observerPath: { status: "wired", observerUrl: "http://127.0.0.1:1" }
    });
    assert.equal(proof.proven, false);
    assert.equal(proof.required, true);
    assert.match(proof.reason, /no upstream execution/i);
    assert.ok(proof.probes.length >= 1, "the probes are recorded even when the proof fails");
  });

  it("is proven when the observer sees the authorized query's execution", async () => {
    const ctx = fakeCtx({ delta: 1 });
    const proof = await proveUpstreamObservation({
      ctx,
      run: { runId: "r1" },
      observerPath: { status: "wired", observerUrl: "http://127.0.0.1:1" }
    });
    assert.equal(proof.proven, true);
    assert.equal(proof.baseline, 1, "the authorized baseline is MEASURED, not guessed");
    assert.equal(ctx.authorizedUpstreamBaseline, 1, "the measured baseline reaches the case helpers");
  });

  it("is not required (and not a proof failure) when no observer was wired at all", async () => {
    const proof = await proveUpstreamObservation({
      ctx: fakeCtx({ delta: 1 }),
      run: { runId: "r1" },
      observerPath: { status: "not_wired", reason: "the upstream was unavailable" }
    });
    assert.equal(proof.proven, false);
    assert.equal(proof.required, false);
    assert.match(proof.reason, /not wired/);
  });
});

// ---------------------------------------------------------------------------
// 4. the per-case gate
// ---------------------------------------------------------------------------

describe("W-05 the observation gate", () => {
  it("blocks the cases that MEASURE the upstream when the channel is not proven", () => {
    const verdict = observationGateVerdict({
      testCase: { id: "SEC-09-S05", scenario: "SEC-09" },
      observationProof: { proven: false, reason: "the observer saw nothing" }
    });
    assert.equal(verdict.status, "blocked");
    assert.deepEqual(verdict.blockedBy, ["upstream_observation_unproven"]);
    assert.match(verdict.detail, /not proven/);
  });

  it("does NOT block the cases that do not measure the upstream", () => {
    const verdict = observationGateVerdict({
      testCase: { id: "SEC-13-V01", scenario: "SEC-13" },
      observationProof: { proven: false, reason: "the observer saw nothing" }
    });
    assert.equal(verdict, null, "the rest of the leg still runs, so a broken channel does not hide other findings");
  });

  it("never blocks once the channel is proven", () => {
    for (const scenario of OBSERVATION_DEPENDENT_SCENARIOS) {
      const verdict = observationGateVerdict({
        testCase: { id: `${scenario}-X`, scenario },
        observationProof: { proven: true, reason: "ok" }
      });
      assert.equal(verdict, null);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. the polarity of the two assertion helpers
// ---------------------------------------------------------------------------

describe("W-05 the upstream assertion polarity", () => {
  it("a DENIED request that caused no upstream execution passes the zero claim", () => {
    const checks = new Checks();
    expectUpstreamZero(ctxStub(), checks, "deny case", closedWindow(0, 0));
    const zero = checks.assertions.find((a) => a.token === "upstream_exec_zero");
    assert.equal(zero.passed, true);
    assert.equal(checks.extra.upstreamExecutions, 0, "the release evidence carries the INTEGER unauthorized count");
  });

  it("a DENIED request that DID reach the upstream fails the zero claim", () => {
    const checks = new Checks();
    expectUpstreamZero(ctxStub(), checks, "deny case", closedWindow(0, 1));
    const zero = checks.assertions.find((a) => a.token === "upstream_exec_zero");
    assert.equal(zero.passed, false);
    assert.equal(checks.extra.upstreamExecutions, 1, "the unauthorized execution count is reported, not hidden");
  });

  it("an ALLOWED request must have executed upstream (no vacuous pass)", () => {
    const checks = new Checks();
    expectAuthorizedUpstream(ctxStub(), checks, "allow case", closedWindow(0, 1), { authorizedRequests: 1 });
    const positive = checks.assertions.find((a) => a.token === "upstream_exec_positive");
    const zero = checks.assertions.find((a) => a.token === "upstream_exec_zero");
    assert.equal(positive.passed, true);
    assert.equal(zero.passed, true, "the query's own authorized execution is not an unauthorized one");
    assert.equal(checks.extra.upstreamExecutions, 0);
  });

  it("an ALLOWED request that executed NOTHING upstream fails (the channel is not on the path)", () => {
    const checks = new Checks();
    expectAuthorizedUpstream(ctxStub(), checks, "allow case", closedWindow(0, 0), { authorizedRequests: 1 });
    const positive = checks.assertions.find((a) => a.token === "upstream_exec_positive");
    assert.equal(positive.passed, false, "a channel that sees no execution must NOT let the case pass");
  });

  it("a measurement gap never becomes a fabricated zero", () => {
    const checks = new Checks();
    expectUpstreamZero(ctxStub(), checks, "deny case", { before: { upstreamExecutionCount: "unknown", source: "no-observer", cursor: 1 }, after: null });
    const zero = checks.assertions.find((a) => a.token === "upstream_exec_zero");
    assert.equal(zero.passed, false, "the declared token is still evaluated, and it does not pass");
    assert.equal(checks.extra.upstreamExecutions, undefined, "no fabricated 0 reaches the release evidence");
    assert.equal(checks.extra.upstreamObservation.measured, false, "the measurement gap is reported as such");
  });
});

// ---------------------------------------------------------------------------
// 6. the observation window is wide enough for a slow request
// ---------------------------------------------------------------------------

describe("W-05 the observation window", () => {
  it("reaches far beyond the request, so a slow upstream execution is still counted", () => {
    const { since, until } = observationWindow(new Date());
    const horizon = Date.parse(until) - Date.parse(since);
    assert.ok(horizon >= 10 * 60_000, `the window must span at least ten minutes, got ${horizon} ms`);
    assert.ok(Date.parse(until) > Date.now() + 60_000, "the window must still be open when the request finishes");
  });
});
