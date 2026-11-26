import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  SESSION_REQUIRED_TEXT,
  classifyMcpError,
  percentile,
  runMcpMainpathSmoke
} from "./p0-mcp-mainpath-smoke.mjs";

const BASELINE = {
  sales_by_region: { East: 100.5, West: 200.25 }
};

function jsonRes(body, { status = 200, sessionId } = {}) {
  const headers = new Headers({ "content-type": "application/json" });
  if (sessionId) headers.set("mcp-session-id", sessionId);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    async text() {
      return JSON.stringify(body);
    }
  };
}

function makeMockFetch(overrides = {}) {
  let sessionSeq = 1;
  let clock = 1_000;
  let ambiguityTriggeredOnce = false;
  let deletedSessions = new Set();

  const now = () => clock;
  const fetchImpl = async (_url, init) => {
    if (init.method === "DELETE") {
      const sid = init.headers?.["mcp-session-id"];
      if (sid) deletedSessions.add(sid);
      return jsonRes({ ok: true }, { status: 200 });
    }
    const req = JSON.parse(init.body);
    const sid = init.headers?.["mcp-session-id"];
    if (req.method === "initialize") {
      clock += overrides.handshakeDelayMs ?? 15;
      const newSid = `sess-${sessionSeq++}`;
      return jsonRes({ jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2025-03-26" } }, { sessionId: newSid });
    }
    if (req.method === "notifications/initialized") {
      return jsonRes({ jsonrpc: "2.0", id: req.id, result: {} });
    }
    if (req.method === "tools/list") {
      return jsonRes({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: [
            { name: "lucy_catalog" },
            { name: "lucy_begin_question" },
            { name: "lucy_query" }
          ]
        }
      });
    }
    if (req.method === "tools/call") {
      const name = req.params?.name;
      if (name === "lucy_catalog") {
        clock += overrides.catalogDelayMs ?? 20;
        return jsonRes({
          jsonrpc: "2.0",
          id: req.id,
          result: { content: [{ type: "text", text: JSON.stringify({ sources: ["superstore_orders"] }) }] }
        });
      }
      if (name === "lucy_begin_question") {
        if (overrides.beginUnresolved) {
          // Real mcp-proxy.ts wire format: plain text content + machine-readable result.data
          return jsonRes({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              isError: true,
              content: [{ type: "text", text: "口径绑定尚未就绪，请联系管理员。" }],
              data: { reason: "caliber_binding_unresolved" }
            }
          });
        }
        return jsonRes({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: JSON.stringify({ ok: true, turnId: `turn-${sessionSeq}` }) }]
          }
        });
      }
      if (name === "sql_execution") {
        if (overrides.unauthMaskedByBudget) {
          return jsonRes({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              isError: true,
              content: [{ type: "text", text: JSON.stringify({ reason: "question_budget_exhausted" }) }]
            }
          });
        }
        // Real mcp-proxy.ts wire format (line 5704): HTTP 200 + isError:true + plain text, no result.data
        return jsonRes({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            isError: true,
            content: [{ type: "text", text: "Access denied: tool_absolute_deny:sql_execution" }]
          }
        });
      }
      if (name === "lucy_query") {
        if (deletedSessions.has(sid) && overrides.failAfterDelete) {
          return jsonRes({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32000, message: SESSION_REQUIRED_TEXT }
          });
        }
        if (overrides.ambiguityDeadlock && !ambiguityTriggeredOnce && init.headers?.["x-lucy-turn-id"]) {
          // Real mcp-proxy.ts wire format (line 5848): plain text content + result.data.repair
          if (overrides._turnCalls === 1) {
            ambiguityTriggeredOnce = true;
            return jsonRes({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                isError: true,
                content: [{ type: "text", text: "表级歧义：请先确认来源表" }],
                data: {
                  reason: "source_ambiguity_gate",
                  repair: { usableTargets: [] }
                }
              }
            });
          }
          overrides._turnCalls = (overrides._turnCalls ?? 0) + 1;
        }
        if (overrides.ambiguityEscapable && !ambiguityTriggeredOnce && init.headers?.["x-lucy-turn-id"]) {
          if (overrides._turnCalls === 1) {
            ambiguityTriggeredOnce = true;
            return jsonRes({
              jsonrpc: "2.0",
              id: req.id,
              result: {
                isError: true,
                content: [{ type: "text", text: "表级歧义：请先确认来源表" }],
                data: {
                  reason: "source_ambiguity_gate",
                  repair: { usableTargets: ["superstore_orders"] }
                }
              }
            });
          }
          overrides._turnCalls = (overrides._turnCalls ?? 0) + 1;
        }
        return jsonRes({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            structuredContent: {
              headers: ["region", "total_sales"],
              rows: [["East", 100.5], ["West", 200.25]]
            }
          }
        });
      }
    }
    return jsonRes({ jsonrpc: "2.0", id: req.id, error: { code: -32601, message: "method not found" } }, { status: 400 });
  };
  return { fetchImpl, now };
}

describe("p0-mcp-mainpath-smoke", () => {
  it("passes full M1-M5 main-path and writes redacted evidence", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "mcp-mainpath-"));
    const out = path.join(dir, "evidence.json");
    const secret = "secret-bearer-token-value";
    try {
      const { fetchImpl, now } = makeMockFetch();
      const evidence = await runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: secret,
        baseline: BASELINE,
        concurrentHandshakes: 4,
        fetchImpl,
        now,
        out
      });
      assert.equal(evidence.verdict, "pass");
      assert.equal(evidence.checks.length, 5);
      assert.equal(evidence.errorBreakdown.acl_deny, 1);
      assert.equal(evidence.errorBreakdown.budget_exhausted, 0);
      const raw = readFileSync(out, "utf8");
      assert.ok(!raw.includes(secret), "evidence must never contain raw Bearer token");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("M1 fails when concurrent handshake P50 exceeds latency budget", async () => {
    const { fetchImpl, now } = makeMockFetch({ handshakeDelayMs: 600 });
    await assert.rejects(
      () => runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: "tok",
        baseline: BASELINE,
        concurrentHandshakes: 4,
        budgets: { maxWarmupMs: 2000, maxHandshakeP50Ms: 500, maxHandshakeP95Ms: 1500, maxCatalogMs: 1500 },
        fetchImpl,
        now
      }),
      /M1 concurrent handshake P50/
    );
  });

  it("M2 fails independently when lucy_begin_question returns caliber_binding_unresolved", async () => {
    const { fetchImpl, now } = makeMockFetch({ beginUnresolved: true });
    await assert.rejects(
      () => runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: "tok",
        baseline: BASELINE,
        concurrentHandshakes: 2,
        fetchImpl,
        now
      }),
      /caliber_unresolved/
    );
  });

  it("M3 rejects source_ambiguity_gate deadlock when usableTargets is empty, and passes when escapable", async () => {
    const deadlock = makeMockFetch({ ambiguityDeadlock: true, _turnCalls: 0 });
    await assert.rejects(
      () => runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: "tok",
        baseline: BASELINE,
        concurrentHandshakes: 2,
        fetchImpl: deadlock.fetchImpl,
        now: deadlock.now
      }),
      /usableTargets is empty/
    );

    const escapable = makeMockFetch({ ambiguityEscapable: true, _turnCalls: 0 });
    const evidence = await runMcpMainpathSmoke({
      proxyUrl: "http://mock.local/mcp",
      token: "tok",
      baseline: BASELINE,
      concurrentHandshakes: 2,
      fetchImpl: escapable.fetchImpl,
      now: escapable.now
    });
    const m3 = evidence.checks.find((c) => c.id === "M3_ambiguity_gate_pure_mcp_escape");
    assert.equal(m3?.outcome, "escaped_via_usable_target");
  });

  it("M4 separates budget_exhausted from acl_deny and rejects masked ACL failures", async () => {
    const budget = classifyMcpError({
      status: 200,
      body: { result: { isError: true, content: [{ type: "text", text: JSON.stringify({ reason: "question_budget_exhausted" }) }] } },
      text: "question_budget_exhausted"
    });
    assert.equal(budget.errorClass, "budget_exhausted");

    const { fetchImpl, now } = makeMockFetch({ unauthMaskedByBudget: true });
    await assert.rejects(
      () => runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: "tok",
        baseline: BASELINE,
        concurrentHandshakes: 2,
        fetchImpl,
        now
      }),
      /masked by budget error/
    );
  });

  it("M5 fails when post-DELETE query leaks historical Session error", async () => {
    const { fetchImpl, now } = makeMockFetch({ failAfterDelete: true });
    await assert.rejects(
      () => runMcpMainpathSmoke({
        proxyUrl: "http://mock.local/mcp",
        token: "tok",
        baseline: BASELINE,
        concurrentHandshakes: 2,
        fetchImpl,
        now
      }),
      /session_error/
    );
  });

  it("computes percentiles accurately", () => {
    assert.equal(percentile([10, 20, 30, 40, 50], 50), 30);
    assert.equal(percentile([10, 20, 30, 40, 50], 95), 50);
    assert.equal(percentile([], 50), 0);
  });
});
