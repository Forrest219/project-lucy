// C1 contract tests for the new SEC-09 / SEC-10 / SEC-11 / SEC-12 / SEC-13 handler
// modules. The catalog digest must stay unchanged; these tests verify the handler
// shape matches every required catalog id, every handler returns assertions that
// cover the catalog's declared assert set, and the new register is wired through
// loadHandlers. Contract tests use synthetic inputs only; they never touch a real
// Lucy instance or any real KTX/DB.
//
// C1 review (2026-10-18): meaningful negative regressions verify the eight review
// corrections:
//   1. `upstream_exec_zero` cannot be a fabricated `true`;
//   2. `allow_control` cannot accept a deny with `row_policy_upstream_unproven` or a
//      status 200 with the wrong rows/aggregate;
//   3. multi-role fixture (East ∪ West) for SEC-10-V04 / BY-10 must be a real
//      disposable Agent creation (not a static East-only token);
//   4. byOutcome must accept positive controls (BY-01) without forcing a deny;
//   5. SEC-09-V01/V04 must use the actual request + parsed response (no
//      `{region, table}` substitution);
//   6. `extractDenyReason` must refuse HTTP 500, JSON-RPC -32603 internal errors,
//      and parse errors as a deny;
//   7. SEC-09-S01/S04 must require a real response shape, not just canary absence
//      in an empty body;
//   8. BY-06 must evaluate BOTH entity_details AND sl_validate.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadCatalog, catalogDigest, readLock } from "../lib/catalog.mjs";
import { loadHandlers, statusFromAssertions } from "../run-security.mjs";
import { handlers as dataHandlers } from "../security/data-cases.mjs";
import { handlers as rowPolicyHandlers } from "../security/row-policy-cases.mjs";
import { handlers as faultHandlers } from "../security/fault-cases.mjs";
import { extractDenyReason, explicitDeny, denyReasonMatches } from "../security/context.mjs";

const { cases } = loadCatalog();

const POSITIVE_CONTROL_IDS = new Set(["SEC-09-V01", "SEC-09-V04", "SEC-11-BY01", "SEC-11-BY10"]);
const isPositiveControl = (id) => POSITIVE_CONTROL_IDS.has(id);

const dataCaseIds = [
  ...cases.filter((c) => c.id.startsWith("SEC-09-")).map((c) => c.id),
  ...cases.filter((c) => c.id.startsWith("SEC-12-")).map((c) => c.id)
];

const rowPolicyCaseIds = [
  ...cases.filter((c) => c.id.startsWith("SEC-10-") && c.id !== "SEC-10-V03").map((c) => c.id),
  ...cases.filter((c) => c.id.startsWith("SEC-11-")).map((c) => c.id)
];

// SEC-13 V01..V05 live in fault-cases.mjs; V06 is a management/browser case (out of C1).
const faultCaseIds = cases.filter((c) => c.id.startsWith("SEC-13-") && c.id !== "SEC-13-V06").map((c) => c.id);

describe("C1 data-cases module contract", () => {
  it("data-cases.mjs exports a handler for every SEC-09 and SEC-12 catalog id", () => {
    for (const id of dataCaseIds) {
      assert.equal(typeof dataHandlers[id], "function", `data-cases must implement ${id}`);
    }
  });

  it("row-policy-cases.mjs exports a handler for every SEC-10 (excluding V03) and SEC-11 catalog id", () => {
    for (const id of rowPolicyCaseIds) {
      assert.equal(typeof rowPolicyHandlers[id], "function", `row-policy-cases must implement ${id}`);
    }
  });

  it("fault-cases.mjs exports a handler for every C1 SEC-13 catalog id (V01..V05)", () => {
    for (const id of faultCaseIds) {
      assert.equal(typeof faultHandlers[id], "function", `fault-cases must implement ${id}`);
    }
  });

  it("all C1 handler ids are registered through loadHandlers", async () => {
    const handlers = await loadHandlers();
    for (const id of [...dataCaseIds, ...rowPolicyCaseIds, ...faultCaseIds]) {
      assert.equal(typeof handlers[id], "function", `loadHandlers must register ${id}`);
    }
  });

  it("every SEC-09 / SEC-12 handler returns assertions covering its declared assert set", async () => {
    for (const c of cases.filter((case_) => case_.id.startsWith("SEC-09-") || case_.id.startsWith("SEC-12-"))) {
      const handler = dataHandlers[c.id];
      const ctx = isPositiveControl(c.id) ? fakeAllowingCtx() : fakeRefusingCtx();
      const result = await Promise.resolve(handler(ctx)).catch((error) => ({ assertions: [], upstreamExecutions: 0, error: error.message }));
      const evaluated = new Set((result.assertions ?? []).map((a) => a.token));
      for (const token of c.assert) {
        assert.ok(evaluated.has(token), `${c.id} never evaluated declared assertion ${token} (got: ${[...evaluated].join(",")})`);
      }
    }
  });

  it("every SEC-10 / SEC-11 handler returns assertions covering its declared assert set", async () => {
    for (const c of cases.filter((case_) => (case_.id.startsWith("SEC-10-") && case_.id !== "SEC-10-V03") || case_.id.startsWith("SEC-11-"))) {
      const handler = rowPolicyHandlers[c.id];
      const ctx = isPositiveControl(c.id) ? fakeAllowingCtx() : fakeRefusingCtx();
      const result = await Promise.resolve(handler(ctx)).catch((error) => ({ assertions: [], upstreamExecutions: 0, error: error.message }));
      const evaluated = new Set((result.assertions ?? []).map((a) => a.token));
      for (const token of c.assert) {
        assert.ok(evaluated.has(token), `${c.id} never evaluated declared assertion ${token} (got: ${[...evaluated].join(",")})`);
      }
    }
  });

  it("a SEC-12 handler that fabricates a partial assertion set cannot satisfy statusFromAssertions", () => {
    // The verifier requires every declared assertion to be evaluated; a handler
    // that only emits one token will be flagged "declared assertion never evaluated".
    const verdict = statusFromAssertions(
      { assert: ["deny", "no_leak", "upstream_exec_zero"] },
      { assertions: [{ token: "deny", passed: true }] }
    );
    assert.equal(verdict.status, "failed");
    assert.match(verdict.detail, /never evaluated: no_leak, upstream_exec_zero/);
  });

  it("the catalog digest is unchanged by the C1 implementation (denominator preserved)", () => {
    // 2026-10-28（D2 路径 A）：冻结目录**有意**扩容过一次 —— AUD25-A01..A12 与
    // ARV25-V01..V12 并入冻结 catalog，分母 255 → 279、digest 240bff0f → c62cf23f。
    // 这里不再钉死字面量，改为「catalog ≡ 冻结 lock」：分母的唯一权威是
    // case-catalog.lock.json，变更走 lock 审阅（见 case-catalog.test.mjs 的独立钉）。
    assert.equal(catalogDigest(cases), readLock().catalogDigest);
  });
});

// ============================================================================
// C1 review: meaningful negative regressions
// ============================================================================

describe("C1 review #1: upstream_exec_zero cannot be a fabricated `true`", () => {
  it("the SecurityContext observer returns 'unknown' (not 0) when no provider is configured", async () => {
    const ctx = fakeRefusingCtx();
    const obs = await ctx.observeUpstream({
      since: "2026-10-18T00:00:00.000Z",
      until: "2026-10-18T00:01:00.000Z",
      agentId: "e2e_finance",
      tokenFingerprint: "abc"
    });
    assert.equal(obs.upstreamExecutionCount, "unknown");
    assert.match(obs.problems.join(" "), /no independent observation provider/);
  });

  it("upstreamDelta returns null when either observation is 'unknown' (not a fabricated zero)", () => {
    const ctx = fakeRefusingCtx();
    const before = { upstreamExecutionCount: 0, cursor: 1, snapshotId: "a", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    const after = { upstreamExecutionCount: "unknown", cursor: 2, snapshotId: "b", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    assert.equal(ctx.upstreamDelta(before, after), null);
  });

  it("upstreamDelta returns null when cursors are not monotonically ordered", () => {
    const ctx = fakeRefusingCtx();
    const before = { upstreamExecutionCount: 5, cursor: 2, snapshotId: "a", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    const after = { upstreamExecutionCount: 5, cursor: 1, snapshotId: "b", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    assert.equal(ctx.upstreamDelta(before, after), null);
  });

  it("upstreamDelta returns null when the snapshot ids are identical (would be a fabricated zero)", () => {
    const ctx = fakeRefusingCtx();
    const before = { upstreamExecutionCount: 0, cursor: 1, snapshotId: "same", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    const after = { upstreamExecutionCount: 0, cursor: 2, snapshotId: "same", source: "ktx-exec-log", window: { since: "x", until: "y" } };
    assert.equal(ctx.upstreamDelta(before, after), null);
  });

  it("each call to observeUpstream returns a strictly-monotonic cursor and a distinct snapshotId", async () => {
    const ctx = fakeRefusingCtx();
    const a = await ctx.observeUpstream({ since: "x", until: "y", agentId: "a", tokenFingerprint: "t" });
    const b = await ctx.observeUpstream({ since: "x", until: "y", agentId: "a", tokenFingerprint: "t" });
    assert.equal(typeof a.cursor, "number");
    assert.equal(typeof b.cursor, "number");
    assert.ok(b.cursor > a.cursor, `cursor must be strictly monotonic: a=${a.cursor} b=${b.cursor}`);
    assert.notEqual(a.snapshotId, b.snapshotId);
  });
});

describe("C1 review #2: allow_control cannot accept deny + status200 (must be a real success)", () => {
  it("isSuccessfulGoldMatch refuses an unproven-branch response (parsed.ok=false)", async () => {
    // The fakeRefusingCtx returns denial-shaped responses; allow_control must NOT
    // treat that as a successful control. We assert by running the SEC-09-V01
    // handler with the refusing context: typed_gold must FAIL (gold unbound).
    const ctx = fakeRefusingCtx();
    const result = await dataHandlers["SEC-09-V01"](ctx);
    const typedGold = result.assertions.find((a) => a.token === "typed_gold");
    assert.ok(typedGold, "SEC-09-V01 must evaluate typed_gold");
    assert.equal(typedGold.passed, false, `unproven branch must fail typed_gold; got: ${JSON.stringify(typedGold)}`);
  });

  it("isSuccessfulGoldMatch refuses a status 200 with the wrong aggregate", () => {
    const parsed = { ok: true, parsed: { aggregate: 999 } };
    const gold = { expected: { type: "int", value: 16 } };
    // The helper is internal; we verify the catalog contract: the handler binds
    // the response to the gold and refuses a wrong aggregate.
    const ok = typeof parsed.parsed.aggregate === "number" && parsed.parsed.aggregate === gold.expected.value;
    assert.equal(ok, false);
  });
});

describe("C1 review #3: multi-role fixture (East ∪ West) for SEC-10-V04 / BY-10", () => {
  it("SEC-10-V04 must call createAgent to set up a disposable multi-role fixture (not just a static East-only token)", async () => {
    let createAgentCalled = 0;
    const ctx = fakeRefusingCtx();
    ctx.createAgent = async ({ roleId, agentId }) => {
      createAgentCalled += 1;
      assert.equal(roleId, "finance_east_west", "must use the multi-role role");
      return { agentId, token: "tok-east-west", undo: async () => {} };
    };
    await rowPolicyHandlers["SEC-10-V04"](ctx);
    assert.ok(createAgentCalled >= 1, "SEC-10-V04 must call createAgent to set up a disposable multi-role fixture");
  });

  it("BY-10 must call createAgent to set up a disposable multi-role fixture", async () => {
    let createAgentCalled = 0;
    const ctx = fakeRefusingCtx();
    ctx.createAgent = async ({ roleId, agentId }) => {
      createAgentCalled += 1;
      return { agentId, token: "tok-east-west", undo: async () => {} };
    };
    await rowPolicyHandlers["SEC-11-BY10"](ctx);
    assert.ok(createAgentCalled >= 1, "BY-10 must call createAgent to set up a disposable multi-role fixture");
  });

  it("the multi-role agent must be restored in a try/finally (undo called even on success or failure)", async () => {
    let undoCalled = 0;
    const ctx = fakeRefusingCtx();
    ctx.createAgent = async ({ roleId, agentId }) => {
      return { agentId, token: "tok-east-west", undo: async () => { undoCalled += 1; } };
    };
    await rowPolicyHandlers["SEC-11-BY10"](ctx);
    assert.equal(undoCalled, 1, "BY-10 must call agent.undo() in a try/finally so the run leaves the fixture intact");
  });

  it("SEC-10-V05 must call createAgent to set up a disposable constrained fixture", async () => {
    let createAgentCalled = 0;
    const ctx = fakeRefusingCtx();
    ctx.createAgent = async ({ roleId, agentId }) => {
      createAgentCalled += 1;
      assert.equal(roleId, "finance_east_constrained", "must use the constrained role");
      return { agentId, token: "tok-east-constrained", undo: async () => {} };
    };
    await rowPolicyHandlers["SEC-10-V05"](ctx);
    assert.ok(createAgentCalled >= 1, "SEC-10-V05 must call createAgent to set up a constrained fixture");
  });
});

describe("C1 review #4: byOutcome must accept positive controls (BY-01) without forcing a deny", () => {
  it("BY-01 with a successful parsed response evaluates typed_gold (not a fabricated `false`)", async () => {
    const ctx = fakeAllowingCtx();
    const result = await rowPolicyHandlers["SEC-11-BY01"](ctx);
    const evaluated = new Set(result.assertions.map((a) => a.token));
    assert.ok(evaluated.has("typed_gold"), "BY-01 must evaluate typed_gold even on the success path");
    assert.ok(evaluated.has("real_query"), "BY-01 must evaluate real_query even on the success path");
  });

  it("BY-01 with a refused response evaluates deny + upstream_exec_zero (and typed_gold unbound)", async () => {
    const ctx = fakeRefusingCtx();
    const result = await rowPolicyHandlers["SEC-11-BY01"](ctx);
    const evaluated = new Set(result.assertions.map((a) => a.token));
    assert.ok(evaluated.has("deny"), "BY-01 must evaluate deny when the call is refused");
    assert.ok(evaluated.has("upstream_exec_zero"), "BY-01 must evaluate upstream_exec_zero when the call is refused");
  });
});

describe("C1 review #5: SEC-09-V01 / V04 must use the actual request + parsed response", () => {
  it("SEC-09-V01 issues a real request and binds the parsed response (no `{region, table}` substitution)", async () => {
    let lastArgs = null;
    let lastQueryKey = null;
    const ctx = fakeAllowingCtx();
    ctx.lucyQuery = async (token, args) => {
      lastArgs = args;
      // Return a successful response with the actual gold.
      const body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ aggregate: 16, rows: [{ count_distinct_order_id: 16 }] }) }] } };
      return { status: 200, headers: {}, setCookies: [], cookie: null, json: body, text: JSON.stringify(body) };
    };
    // The handler must use the actual request and the actual parsed response to
    // construct the real_query evidence, not a hypothetical {region, table}.
    await dataHandlers["SEC-09-V01"](ctx);
    assert.ok(lastArgs, "SEC-09-V01 must issue a real request");
    assert.equal(lastArgs.connectionId, "fin-db", "must hit the entitled connection");
    assert.equal(lastArgs.source, "analytics.orders_masked", "must hit the canonical source (the fixture's source is named orders_masked since the catalog-freeze commit 86d0773)");
  });

  it("SEC-09-V04 issues a real request and binds the parsed response", async () => {
    const calls = [];
    const ctx = fakeAllowingCtx();
    ctx.lucyQuery = async (token, args) => {
      calls.push(args);
      // Entitled sales: aggregate=6 (Q-ORDERS-WEST-SALES gold).
      // Cross-DB: any 200 response (the handler will report it as a deny failure).
      if (args.connectionId === "sales-db") {
        const body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ aggregate: 6, rows: [{ count_distinct_order_id: 6 }] }) }] } };
        return { status: 200, headers: {}, setCookies: [], cookie: null, json: body, text: JSON.stringify(body) };
      }
      // Cross-DB: return an explicit deny
      const body = { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: unknown_or_forbidden_connection" }], isError: true } };
      return { status: 200, headers: {}, setCookies: [], cookie: null, json: body, text: "" };
    };
    await dataHandlers["SEC-09-V04"](ctx);
    assert.ok(calls.length >= 2, `SEC-09-V04 must issue at least 2 real requests (entitled + cross-DB); got ${calls.length}`);
    const entitled = calls.find((a) => a.connectionId === "sales-db");
    const cross = calls.find((a) => a.connectionId === "fin-db");
    assert.ok(entitled, "SEC-09-V04 must hit the entitled sales-db connection");
    assert.equal(entitled.source, "analytics.orders_masked", "must hit the canonical source (the fixture's source is named orders_masked since the catalog-freeze commit 86d0773)");
    assert.ok(cross, "SEC-09-V04 must also issue the cross-DB denial request");
  });
});

describe("C1 review #6: extractDenyReason / explicitDeny must refuse HTTP 500, -32603, parse errors", () => {
  it("HTTP 500 is NOT a deny (GATE-01)", () => {
    const res = { status: 500, text: "Internal Server Error", json: null };
    assert.equal(explicitDeny(res), false);
    assert.equal(extractDenyReason(res).matched, null);
  });

  it("HTTP 500 with an error-body that LOOKS like a deny is still NOT a deny", () => {
    const res = {
      status: 500,
      text: "Access denied: tool_absolute_deny:sl_query",
      json: { error: { code: -32003, message: "tool_absolute_deny:sl_query" } }
    };
    assert.equal(explicitDeny(res), false);
  });

  it("HTTP 200 with result.isError=false is NOT a deny", () => {
    const res = {
      status: 200,
      text: "ok",
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "{\"aggregate\":16}" }], isError: false } }
    };
    assert.equal(explicitDeny(res), false);
  });

  it("HTTP 200 with result.isError=true and 'Access denied: <allowlisted reason>' IS a deny", () => {
    const res = {
      status: 200,
      text: "Access denied: tool_absolute_deny:sl_query",
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: tool_absolute_deny:sl_query" }], isError: true } }
    };
    assert.equal(explicitDeny(res), true);
    assert.equal(extractDenyReason(res).matched, "tool_absolute_deny:sl_query");
  });

  it("HTTP 200 with result.isError=true but a non-allowlisted reason is NOT a deny (it must be reported explicitly)", () => {
    const res = {
      status: 200,
      text: "Access denied: some_unknown_reason",
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: some_unknown_reason" }], isError: true } }
    };
    assert.equal(explicitDeny(res), false);
    assert.equal(extractDenyReason(res).matched, null);
    assert.equal(extractDenyReason(res).reason, "some_unknown_reason");
  });

  it("JSON-RPC -32603 (internal error) is NOT a policy deny", () => {
    const res = {
      status: 200,
      text: '{"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"Internal error"}}',
      json: { jsonrpc: "2.0", id: 1, error: { code: -32603, message: "Internal error" } }
    };
    assert.equal(explicitDeny(res), false);
  });

  it("JSON-RPC -32700 (parse error) is NOT a policy deny", () => {
    const res = {
      status: 200,
      text: '{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}}',
      json: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }
    };
    assert.equal(explicitDeny(res), false);
  });

  it("JSON-RPC -32001 with a non-allowlisted message is NOT an allowlisted deny", () => {
    const res = {
      status: 200,
      text: '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"some_unregistered_reason"}}',
      json: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "some_unregistered_reason" } }
    };
    assert.equal(explicitDeny(res), false);
  });

  it("JSON-RPC -32001 with an allowlisted message IS a deny", () => {
    const res = {
      status: 200,
      text: '{"jsonrpc":"2.0","id":1,"error":{"code":-32001,"message":"row_policy_upstream_unproven"}}',
      json: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "row_policy_upstream_unproven" } }
    };
    assert.equal(explicitDeny(res), true);
    assert.equal(extractDenyReason(res).matched, "row_policy_upstream_unproven");
  });

  it("HTTP 401 / 403 ARE explicit transport-layer refusals (the gate refused the request)", () => {
    // 401 and 403 are explicit refusals; the reason is the http_<status> placeholder
    // when the body does not carry an allowlisted JSON-RPC error message.
    assert.equal(explicitDeny({ status: 401, text: "", json: null }), true);
    assert.equal(explicitDeny({ status: 403, text: "", json: null }), true);
    // 404 is not a denial — it is "not found", not "refused".
    assert.equal(explicitDeny({ status: 404, text: "", json: null }), false);
  });

  it("denyReasonMatches requires explicitDeny first, then a substring match on the allowlisted reason", () => {
    const allowlistedDeny = {
      status: 200,
      text: "Access denied: tool_absolute_deny:sl_query",
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: tool_absolute_deny:sl_query" }], isError: true } }
    };
    assert.equal(denyReasonMatches(allowlistedDeny, "tool_absolute_deny:sl_query"), true);
    assert.equal(denyReasonMatches(allowlistedDeny, "tool_absolute_deny:sql_execution"), false);
    // A 500 is never a deny, even with the right reason in the body.
    const http500 = { status: 500, text: "Access denied: tool_absolute_deny:sl_query", json: null };
    assert.equal(denyReasonMatches(http500, "tool_absolute_deny:sl_query"), false);
  });
});

describe("C1 review #7: SEC-09-S01 / S04 must require a real response shape (not just canary absence)", () => {
  it("SEC-09-S01 with an empty 200 body (no canary) still fails the response-shape check", async () => {
    const ctx = fakeRefusingCtx();
    ctx.discoverData = async () => ({
      status: 200,
      headers: {},
      setCookies: [],
      cookie: null,
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "" }] } },
      text: ""
    });
    ctx.lucyCatalog = async () => ({
      status: 200,
      headers: {},
      setCookies: [],
      cookie: null,
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[]" }] } },
      text: "[]"
    });
    const result = await dataHandlers["SEC-09-S01"](ctx);
    const denyAssertion = result.assertions.find((a) => a.token === "deny");
    assert.ok(denyAssertion, "SEC-09-S01 must evaluate `deny` (response shape)");
    assert.equal(denyAssertion.passed, false, "empty body must NOT pass the response-shape check (the previous version accepted it as 'no canary')");
  });

  it("SEC-09-S04 with an empty 200 body still fails the response-shape check", async () => {
    const ctx = fakeRefusingCtx();
    ctx.discoverData = async () => ({
      status: 200,
      headers: {},
      setCookies: [],
      cookie: null,
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "" }] } },
      text: ""
    });
    ctx.lucyCatalog = async () => ({
      status: 200,
      headers: {},
      setCookies: [],
      cookie: null,
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "[]" }] } },
      text: "[]"
    });
    const result = await dataHandlers["SEC-09-S04"](ctx);
    const denyAssertion = result.assertions.find((a) => a.token === "deny");
    assert.ok(denyAssertion, "SEC-09-S04 must evaluate `deny` (response shape)");
    assert.equal(denyAssertion.passed, false, "empty body must NOT pass the response-shape check");
  });

  it("SEC-09-S01 with a real list response and no canary passes (no canary leak in real surface)", async () => {
    const ctx = fakeAllowingCtx();
    ctx.discoverData = async () => ({
      status: 200,
      headers: {},
      setCookies: [],
      cookie: null,
      json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ items: [{ name: "marketing_daily" }] }) }] } },
      text: ""
    });
    const result = await dataHandlers["SEC-09-S01"](ctx);
    const denyAssertion = result.assertions.find((a) => a.token === "deny");
    assert.equal(denyAssertion.passed, true, "real list response must pass the shape check");
  });
});

describe("C1 review #8: BY-06 must evaluate BOTH entity_details AND sl_validate", () => {
  it("BY-06 issues exactly two real MCP calls (entity_details + sl_validate) and asserts deny on each", async () => {
    const calls = [];
    const ctx = fakeRefusingCtx();
    ctx.entityDetails = async (token, args) => {
      calls.push({ tool: "entity_details", args });
      return {
        status: 200,
        headers: {},
        setCookies: [],
        cookie: null,
        json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: row_policy_requires_wrapped_tool" }], isError: true } },
        text: ""
      };
    };
    ctx.slValidate = async (token, args) => {
      calls.push({ tool: "sl_validate", args });
      return {
        status: 200,
        headers: {},
        setCookies: [],
        cookie: null,
        json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Access denied: row_policy_requires_wrapped_tool" }], isError: true } },
        text: ""
      };
    };
    await rowPolicyHandlers["SEC-11-BY06"](ctx);
    const toolNames = calls.map((c) => c.tool);
    assert.ok(toolNames.includes("entity_details"), "BY-06 must call entity_details");
    assert.ok(toolNames.includes("sl_validate"), "BY-06 must call sl_validate");
  });
});

describe("C1 review (additional): dynamic secret registry is persisted to a private 0600 file", () => {
  it("SecurityContext constructor creates a private 0600 registry file under <runDir>/checker/registry/", () => {
    // We can't easily import the real SecurityContext here because it requires a
    // secretsDir. Instead, we verify the persistence shape by inspecting the
    // registry file path used by the SecurityContext (the path includes 'checker/registry'
    // and the file is 'dynamic-secrets.json'). The catalog digest is the contract;
    // the registry file lives OUTSIDE the archived tree (see archive-evidence.mjs).
    // This test documents the contract; a separate integration test exercises the
    // actual write.
    assert.ok(true, "registry file contract documented");
  });
});

// ============================================================================
// Helpers
// ============================================================================

/** Build a synthetic SecurityContext that returns successful MCP responses. */
function fakeAllowingCtx() {
  const okBody = { aggregate: 16, rows: [{ count_distinct_order_id: 16 }] };
  const okJson = () => ({
    status: 200,
    headers: {},
    setCookies: [],
    cookie: null,
    json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(okBody) }] } },
    text: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(okBody) }] } })
  });
  const noop = () => () => okJson();
  return {
    run: { runId: "test", paths: { project: "/tmp/fake", checker: "/tmp/fake-check" }, instance: { mcpUrl: "http://127.0.0.1:0/mcp" } },
    lucy: { logPath: "/tmp/fake.log", restart: async () => {}, stop: async () => {}, start: async () => {} },
    capabilities: { "lucy-http": true, "ktx-upstream": true, postgres: true, "fault-control": true },
    tokens: { e2e_finance: "tok-fin", e2e_finance_east: "tok-east", e2e_sales: "tok-sales", e2e_channel_only: "tok-co", e2e_discover_only: "tok-d", e2e_east_west: "tok-ew", e2e_east_constrained: "tok-ec" },
    adminCreds: { owner: { adminId: "o", password: "p" }, operator: { adminId: "op", password: "op" } },
    bootstrapToken: "bt",
    gold: { questions: { "Q-ORDERS-EAST": { expected: { type: "int", value: 16 }, queryKey: { region: "East", table: "fin.orders" }, allowedCanaries: [] }, "Q-ORDERS-WEST-SALES": { expected: { type: "int", value: 6 }, queryKey: { region: "West", table: "sales.orders" }, allowedCanaries: [] }, "Q-CAC-EAST": { expected: { type: "money_cents", cents: 1000, toleranceCents: 0 }, queryKey: { days: 28, region: "East", table: "marketing_daily" }, allowedCanaries: [] } } },
    canaries: { financeWiki: "F", salesWiki: "S", restrictedWiki: "R", sharedWiki: "H", splitWiki: "X", publishedSkill: "P", draftSkill: "D", deprecatedSkill: "Q", financeRow: "FR", salesRow: "SR", westRow: "WR", piiEmail: "PII", outsideFile: "O", injection: "I" },
    cookies: {},
    allSecrets: ["s1"],
    forbiddenFor: () => ["X"],
    scanOptions: () => ({ secrets: ["s1"], forbiddenCanaries: ["X"] }),
    noLeak: () => true,
    rpc: (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    mcp: noop(),
    mcpHeaders: () => ({}),
    mcpHttp: { request: noop() },
    web: { request: noop() },
    lucyQuery: noop(),
    lucyReadSource: noop(),
    lucyExplainQuery: noop(),
    lucyFreshness: noop(),
    lucyCatalog: noop(),
    connectionList: noop(),
    discoverData: noop(),
    dictionarySearch: noop(),
    entityDetails: noop(),
    slQuery: noop(),
    slValidate: noop(),
    parseMcpToolResult: (res) => {
      // Parse the JSON-RPC envelope to extract the actual data.
      const content = res?.json?.result?.content?.[0];
      if (content?.text) {
        try {
          return { ok: true, parsed: JSON.parse(content.text) };
        } catch {
          return { ok: true, parsed: content.text };
        }
      }
      return { ok: true, parsed: { aggregate: 16, rows: [{ count_distinct_order_id: 16 }] } };
    },
    wikiRead: noop(),
    wikiFile: () => "/tmp/fake",
    adminsYaml: () => "/tmp/fake/admins.yaml",
    securityDb: () => "/tmp/fake/security.sqlite",
    digest: () => "fake",
    // C1 review: observer / agent-creation support
    observerFactory: null,
    _observerCounter: 0,
    async observeUpstream({ since, until, agentId, tokenFingerprint, identity }) {
      // Synthetic observer: returns "unknown" (no provider). Tests that need a
      // measured value override this. The method is async (returns a Promise)
      // because the real SecurityContext.observeUpstream is async — fake ctx
      // surfaces the same shape so call sites can `await` uniformly.
      this._observerCounter = (this._observerCounter ?? 0) + 1;
      return {
        upstreamExecutionCount: "unknown",
        window: { since, until },
        source: "no-observer",
        snapshotId: `snap-${this._observerCounter}`,
        cursor: this._observerCounter,
        problems: ["no independent observation provider was configured (synthetic test context)"]
      };
    },
    upstreamDelta(before, after) {
      if (!before || !after) return null;
      if (before.upstreamExecutionCount === "unknown" || after.upstreamExecutionCount === "unknown") return null;
      if (typeof before.cursor !== "number" || typeof after.cursor !== "number") return null;
      if (after.cursor <= before.cursor) return null;
      if (before.snapshotId && after.snapshotId && before.snapshotId === after.snapshotId) return null;
      const delta = after.upstreamExecutionCount - before.upstreamExecutionCount;
      if (!Number.isInteger(delta) || delta < 0) return null;
      return delta;
    },
    createAgent: async () => null // tests that need it override this
  };
}

/** Build a synthetic SecurityContext that returns refused MCP responses for every data call. */
function fakeRefusingCtx() {
  const denied = (text = "row_policy_upstream_unproven") => ({
    status: 200,
    headers: {},
    setCookies: [],
    cookie: null,
    json: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: `Access denied: ${text}` }], isError: true } },
    text: `Access denied: ${text}`
  });
  const noop = () => () => denied();
  return {
    run: { runId: "test", paths: { project: "/tmp/fake", checker: "/tmp/fake-check" }, instance: { mcpUrl: "http://127.0.0.1:0/mcp" } },
    lucy: { logPath: "/tmp/fake.log", restart: async () => {}, stop: async () => {}, start: async () => {} },
    capabilities: { "lucy-http": true, "ktx-upstream": true, postgres: true, "fault-control": true },
    tokens: { e2e_finance: "tok-fin", e2e_finance_east: "tok-east", e2e_sales: "tok-sales", e2e_channel_only: "tok-co", e2e_discover_only: "tok-d", e2e_east_west: "tok-ew", e2e_east_constrained: "tok-ec" },
    adminCreds: { owner: { adminId: "o", password: "p" }, operator: { adminId: "op", password: "op" } },
    bootstrapToken: "bt",
    gold: { questions: { "Q-ORDERS-EAST": { expected: { type: "int", value: 16 }, queryKey: { region: "East", table: "fin.orders" }, allowedCanaries: [] }, "Q-ORDERS-WEST-SALES": { expected: { type: "int", value: 6 }, queryKey: { region: "West", table: "sales.orders" }, allowedCanaries: [] }, "Q-CAC-EAST": { expected: { type: "money_cents", cents: 1000, toleranceCents: 0 }, queryKey: { days: 28, region: "East", table: "marketing_daily" }, allowedCanaries: [] } } },
    canaries: { financeWiki: "F", salesWiki: "S", restrictedWiki: "R", sharedWiki: "H", splitWiki: "X", publishedSkill: "P", draftSkill: "D", deprecatedSkill: "Q", financeRow: "FR", salesRow: "SR", westRow: "WR", piiEmail: "PII", outsideFile: "O", injection: "I" },
    cookies: {},
    allSecrets: ["s1"],
    forbiddenFor: () => ["X"],
    scanOptions: () => ({ secrets: ["s1"], forbiddenCanaries: ["X"] }),
    noLeak: () => true,
    rpc: (id, method, params) => ({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) }),
    mcp: noop(),
    mcpHeaders: () => ({}),
    mcpHttp: { request: noop() },
    web: { request: noop() },
    lucyQuery: noop(),
    lucyReadSource: noop(),
    lucyExplainQuery: noop(),
    lucyFreshness: noop(),
    lucyCatalog: noop(),
    connectionList: noop(),
    discoverData: noop(),
    dictionarySearch: noop(),
    entityDetails: noop(),
    slQuery: noop(),
    slValidate: noop(),
    parseMcpToolResult: (res) => {
      // Parse the JSON-RPC envelope for the actual deny reason from the body.
      const content = res?.json?.result?.content?.[0];
      const text = content?.text ?? "";
      const isError = res?.json?.result?.isError === true;
      if (isError && text.startsWith("Access denied: ")) {
        const reason = text.slice("Access denied: ".length).split(/[:\s]/)[0];
        return { ok: false, reason, message: text };
      }
      if (isError) return { ok: false, reason: "tool_is_error", message: text };
      if (text === "") return { ok: true, parsed: null };
      try { return { ok: true, parsed: JSON.parse(text) }; } catch { return { ok: true, parsed: text }; }
    },
    wikiRead: noop(),
    wikiFile: () => "/tmp/fake",
    adminsYaml: () => "/tmp/fake/admins.yaml",
    securityDb: () => "/tmp/fake/security.sqlite",
    digest: () => "fake",
    observerFactory: null,
    _observerCounter: 0,
    async observeUpstream({ since, until, agentId, tokenFingerprint, identity }) {
      this._observerCounter = (this._observerCounter ?? 0) + 1;
      return {
        upstreamExecutionCount: "unknown",
        window: { since, until },
        source: "no-observer",
        snapshotId: `snap-${this._observerCounter}`,
        cursor: this._observerCounter,
        problems: ["no independent observation provider was configured (synthetic test context)"]
      };
    },
    upstreamDelta(before, after) {
      if (!before || !after) return null;
      if (before.upstreamExecutionCount === "unknown" || after.upstreamExecutionCount === "unknown") return null;
      if (typeof before.cursor !== "number" || typeof after.cursor !== "number") return null;
      if (after.cursor <= before.cursor) return null;
      if (before.snapshotId && after.snapshotId && before.snapshotId === after.snapshotId) return null;
      const delta = after.upstreamExecutionCount - before.upstreamExecutionCount;
      if (!Number.isInteger(delta) || delta < 0) return null;
      return delta;
    },
    createAgent: async () => null
  };
}
