/**
 * P1-74 / REQ-030-095 —— compat 分列（Task 4）与预算逃生成交链（Task 4b）单测。
 *
 * 覆盖：
 * - classifyAttemptReason：exhausted／concurrency／unavailable 分列；ACL reason 不归预算；
 * - judgeFunctional：expected allow 的预算停机记 `budget_exhausted` 而非 `new deny`；
 *   expected deny 不得因 budget stop 假绿；
 * - runMcpControl 逃生链：tools/list 预检（begin 不可见走 N）、session 复用、
 *   continue／mode=new_question＋重试直至真实成交；未恢复时归因 budget_exhausted。
 *
 * 全部离线：fetch 为注入桩。
 */

import assert from "node:assert/strict";
import test from "node:test";

import { threeAxis } from "../lib/mcp-compatibility.mjs";
import {
  classifyAttemptReason,
  createMcpClient,
  functionalCaseFromControl,
  isBudgetDenyClass,
  runMcpControl
} from "../lib/mcp-compatibility-client.mjs";

const TOKEN = "compat-budget-escape-token";

function toolResult(payload, { isError = false, sessionId = null, raw = false } = {}) {
  const result = raw
    ? payload
    : {
        ...(isError ? { isError: true } : {}),
        content: [{ type: "text", text: JSON.stringify(payload) }]
      };
  return {
    status: 200,
    headers: sessionId ? new Map([["mcp-session-id", sessionId]]) : new Map(),
    text: async () => JSON.stringify({ jsonrpc: "2.0", id: 1, result })
  };
}

function scriptedFetch(script) {
  let call = 0;
  const requests = [];
  return {
    requests,
    async fn(url, options) {
      call += 1;
      requests.push({ url, headers: { ...options.headers }, body: JSON.parse(options.body) });
      const step = script.shift();
      if (!step) throw new Error(`script exhausted at call ${call}`);
      return typeof step === "function" ? step(options) : step;
    }
  };
}

test("classifyAttemptReason splits budget reasons from ACL (SC-E5/E5b)", () => {
  assert.equal(classifyAttemptReason("question_budget_exhausted"), "budget_exhausted");
  assert.equal(classifyAttemptReason("question_budget_concurrency_exceeded"), "budget_concurrency_exceeded");
  assert.equal(classifyAttemptReason("question_budget_unavailable"), "budget_unavailable");
  assert.equal(classifyAttemptReason("no_credit"), "budget_escape_rejected");
  assert.equal(classifyAttemptReason("tool_forbidden"), "other");
  assert.equal(classifyAttemptReason("sensitive_metadata_forbidden"), "other");
  assert.equal(classifyAttemptReason(null), "none");
  assert.equal(isBudgetDenyClass("budget_exhausted"), true);
  assert.equal(isBudgetDenyClass("budget_concurrency_exceeded"), true);
  assert.equal(isBudgetDenyClass("budget_unavailable"), true);
  assert.equal(isBudgetDenyClass("budget_escape_rejected"), false);
  assert.equal(isBudgetDenyClass("other"), false);
});

test("judgeFunctional reports budget_exhausted instead of new deny (SC-E5)", () => {
  const axes = threeAxis({
    functionalCases: [
      {
        id: "QB-BIZ-01:allow_readonly",
        expectedOutcome: "allow",
        observedOutcome: "deny",
        observedDenyClass: "budget_exhausted",
        envelopeEmpty: false
      }
    ],
    mcp: { samplesMs: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49], budgetClass: "simple" },
    agent: {}
  });
  assert.equal(axes.functionalCompatibility, "FAIL");
  assert.ok(axes.reasons.some((r) => r.includes("budget_exhausted (expected allow)")));
  assert.ok(!axes.reasons.some((r) => r.includes("new deny")));
});

test("judgeFunctional keeps concurrency/unavailable split from exhausted (SC-E5b)", () => {
  for (const [denyClass, text] of [
    ["budget_concurrency_exceeded", "budget_concurrency_exceeded (expected allow)"],
    ["budget_unavailable", "budget_unavailable (platform/storage) (expected allow)"]
  ]) {
    const axes = threeAxis({
      functionalCases: [
        {
          id: "QB-DB-01:x",
          expectedOutcome: "allow",
          observedOutcome: "deny",
          observedDenyClass: denyClass,
          envelopeEmpty: false
        }
      ],
      mcp: { samplesMs: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49], budgetClass: "simple" },
      agent: {}
    });
    assert.equal(axes.functionalCompatibility, "FAIL");
    assert.ok(axes.reasons.some((r) => r.includes(text)), `${denyClass} surfaced`);
    assert.ok(!axes.reasons.some((r) => r.includes("budget_exhausted")), `${denyClass} not lumped into exhausted`);
  }
});

test("judgeFunctional: expected ACL deny must not go green on a budget stop (SC-E5b)", () => {
  const axes = threeAxis({
    functionalCases: [
      {
        id: "QB-ACL-03b:x",
        expectedOutcome: "deny",
        observedOutcome: "deny",
        observedDenyClass: "budget_exhausted",
        envelopeEmpty: false
      }
    ],
    mcp: { samplesMs: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49], budgetClass: "simple" },
    agent: {}
  });
  assert.equal(axes.functionalCompatibility, "FAIL");
  assert.ok(axes.reasons.some((r) => r.includes("expected deny observed via budget_exhausted (not ACL)")));
});

test("judgeFunctional: non-budget allow-case deny still reads new deny", () => {
  const axes = threeAxis({
    functionalCases: [
      {
        id: "QB-ACL-07:x",
        expectedOutcome: "allow",
        observedOutcome: "deny",
        observedDenyClass: "other",
        envelopeEmpty: false
      }
    ],
    mcp: { samplesMs: [30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49], budgetClass: "simple" },
    agent: {}
  });
  assert.ok(axes.reasons.some((r) => r.includes("new deny (expected allow)")));
});

test("escape chain: begin invisible → N, continuable → continue + retry until real rows (SC-E10)", async () => {
  const script = scriptedFetch([
    toolResult({ protocolVersion: "2024-11-05", capabilities: {} }, { sessionId: "sess-escape-1" }),
    toolResult({ tools: [{ name: "lucy_query" }, { name: "lucy_continue_question" }] }, { raw: true }),
    toolResult({
      reason: "question_budget_exhausted",
      partial: true,
      continuable: true,
      continueToken: "tok-1",
      next_step: { action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" }
    }),
    toolResult({ ok: true, declared: true }),
    toolResult({ rows: [{ order_count: 42 }], rowCount: 1 })
  ]);
  const client = createMcpClient({
    baseUrl: "http://127.0.0.1:9/mcp",
    token: TOKEN,
    fetchImpl: script.fn
  });
  const controlResult = await runMcpControl({
    client,
    control: { query: { connectionId: "demo-mysql", measures: ["superstore_orders.order_count"] } },
    identityId: "allow_readonly",
    caseId: "QB-BIZ-01",
    budgetEscape: { session: "auto" }
  });

  // begin 不可见 ⇒ 走 N（skip），不产生预期外 begin 错误
  assert.equal(controlResult.attempts[0].kind, "lucy_begin_question");
  assert.equal(controlResult.attempts[0].skipped, true);
  assert.equal(controlResult.attempts[0].reason, "begin_not_visible");
  assert.equal(controlResult.attempts[0].isError, false);

  const kinds = controlResult.attempts.map((a) => a.kind);
  assert.deepEqual(kinds, [
    "lucy_begin_question",
    "lucy_query",
    "lucy_continue_question",
    "lucy_query"
  ]);
  assert.equal(controlResult.toolRes.parsed.ok, true);
  assert.equal(client.sessionId, "sess-escape-1");
  // initialize 之后的请求都带 mcp-session-id
  const sessionHeaders = script.requests.slice(1).map((r) => r.headers["mcp-session-id"]);
  assert.ok(sessionHeaders.every((value) => value === "sess-escape-1"));

  const caseRow = functionalCaseFromControl({
    identity: { id: "allow_readonly", expect: { outcome: "allow" } },
    controlResult,
    caseId: "QB-BIZ-01"
  });
  assert.equal(caseRow.observedOutcome, "allow");
  const firstQuery = caseRow.attempts.find((a) => a.kind === "lucy_query");
  assert.equal(firstQuery.denyClass, "budget_exhausted");
});

test("escape chain: inactive hard stop → mode=new_question + retry (SC-E9)", async () => {
  const script = scriptedFetch([
    toolResult({ tools: [{ name: "lucy_query" }, { name: "lucy_continue_question" }] }, { raw: true }),
    toolResult({
      reason: "question_budget_exhausted",
      partial: true,
      continuable: false,
      continueToken: "tok-hard",
      next_step: { action: "lucy_continue_question", mode: "new_question", then: "retry_data_tool" }
    }),
    toolResult({ ok: true, declared: true, reopen: true }),
    toolResult({ rows: [{ order_count: 7 }], rowCount: 1 })
  ]);
  const client = createMcpClient({
    baseUrl: "http://127.0.0.1:9/mcp",
    token: TOKEN,
    fetchImpl: script.fn
  });
  const controlResult = await runMcpControl({
    client,
    control: { query: { connectionId: "demo-mysql", measures: ["superstore_orders.order_count"] } },
    identityId: "allow_readonly",
    caseId: "QB-BIZ-02",
    budgetEscape: {}
  });
  const continueAttempt = controlResult.attempts.find((a) => a.kind === "lucy_continue_question");
  assert.ok(continueAttempt, "continue attempt recorded");
  assert.equal(controlResult.toolRes.parsed.ok, true);
  // continue 调用必须携带 mode=new_question
  const continueCall = script.requests.find((r) => r.body?.params?.name === "lucy_continue_question");
  assert.equal(continueCall.body.params.arguments.mode, "new_question");
  assert.equal(continueCall.body.params.arguments.token, "tok-hard");
});

test("no escape config: budget stop stays a budget_exhausted deny (改前基线)", async () => {
  const script = scriptedFetch([
    toolResult({ turnId: "t2" }),
    toolResult({
      reason: "question_budget_exhausted",
      partial: true,
      continuable: true,
      continueToken: "tok-x",
      next_step: { action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" }
    })
  ]);
  const client = createMcpClient({
    baseUrl: "http://127.0.0.1:9/mcp",
    token: TOKEN,
    fetchImpl: script.fn
  });
  const controlResult = await runMcpControl({
    client,
    control: { query: { connectionId: "demo-mysql", measures: ["superstore_orders.order_count"] } },
    identityId: "allow_readonly",
    caseId: "QB-BIZ-03"
  });
  assert.equal(controlResult.attempts.length, 2); // begin + query，无逃生动作
  const caseRow = functionalCaseFromControl({
    identity: { id: "allow_readonly", expect: { outcome: "allow" } },
    controlResult,
    caseId: "QB-BIZ-03"
  });
  assert.equal(caseRow.observedOutcome, "deny");
  assert.equal(caseRow.observedDenyClass, "budget_exhausted");
});

test("begin failure clears the stale turn before the retried data call (Task 4b)", async () => {
  const script = scriptedFetch([
    toolResult({ tools: [{ name: "lucy_begin_question" }, { name: "lucy_query" }, { name: "lucy_continue_question" }] }, { raw: true }),
    // begin 成功（turn t1）
    toolResult({ turnId: "t1" }),
    // 数据工具触顶可续
    toolResult({
      reason: "question_budget_exhausted",
      partial: true,
      continuable: true,
      continueToken: "tok-b",
      next_step: { action: "lucy_continue_question", mode: "continue", then: "retry_data_tool" }
    }),
    toolResult({ ok: true, declared: true }),
    toolResult({ rows: [{ n: 1 }], rowCount: 1 }),
    toolResult({ tools: [{ name: "lucy_begin_question" }, { name: "lucy_query" }, { name: "lucy_continue_question" }] }, { raw: true }),
    // 第二次 begin 失败（isError）→ turn 必须重置，不得带陈旧 t1
    toolResult({ reason: "begin_not_available" }, { isError: true }),
    toolResult({ rows: [{ n: 2 }], rowCount: 1 })
  ]);
  const client = createMcpClient({
    baseUrl: "http://127.0.0.1:9/mcp",
    token: TOKEN,
    fetchImpl: script.fn
  });
  await runMcpControl({
    client,
    control: { begin: "q1", query: { connectionId: "demo-mysql", measures: ["m"] } },
    identityId: "allow_readonly",
    caseId: "QB-FOLLOW-01",
    budgetEscape: {}
  });
  assert.equal(client.turnId, "t1");
  await runMcpControl({
    client,
    control: { begin: "q2", query: { connectionId: "demo-mysql", measures: ["m"] } },
    identityId: "allow_readonly",
    caseId: "QB-FOLLOW-02",
    budgetEscape: {}
  });
  assert.equal(client.turnId, null);
  const followupCalls = script.requests.filter((r) => r.body?.params?.name === "lucy_query");
  // 第二次 begin 失败后，后续 query 不得再携带 x-lucy-turn-id: t1
  const lastQueryHeaders = followupCalls.map((r) => r.headers["x-lucy-turn-id"]);
  assert.equal(lastQueryHeaders[lastQueryHeaders.length - 1], undefined);
});
