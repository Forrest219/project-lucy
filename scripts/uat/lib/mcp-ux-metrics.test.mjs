import assert from "node:assert/strict";
import test from "node:test";
import { computeMetrics, percentile } from "./mcp-ux-metrics.mjs";

let id = 0;
const row = (over) => ({
  id: (id += 1), ts: "2026-11-17T02:00:00.000Z", user_id: "u1", lucy_session_id: "s1", tool: "lucy_query",
  outcome: "ok", error_category: null, decision_reason: null, duration_ms: 10, rejection_fingerprint: null, ...over
});
const at = (seconds) => new Date(Date.parse("2026-11-17T02:00:00.000Z") + seconds * 1000).toISOString();

test("percentile 取最近秩", () => {
  assert.equal(percentile([10, 20, 30, 40], 50), 20);
  assert.equal(percentile([10, 20, 30, 40], 99), 40);
  assert.equal(percentile([], 50), null);
});

test("M1 只统计 initialize，按 15 分钟窗分组，> 30 s 计数", () => {
  const m = computeMetrics([
    row({ tool: "initialize", duration_ms: 100 }),
    row({ tool: "initialize", duration_ms: 31_000, ts: at(901) }),
    row({ tool: "lucy_query", duration_ms: 99_999 })
  ]);
  assert.equal(m.M1.n, 2);
  assert.equal(m.M1.over30s, 1);
  assert.equal(Object.keys(m.M1.by15min).length, 2);
});

test("M3 只按 rejection_fingerprint：同指纹 60 s 内重提计重复；args 相同但指纹不同不计；跨身份、跨会话、跨版本前缀不计", () => {
  const deny = (over) => row({ outcome: "denied", decision_reason: "source_ambiguity_gate", error_category: "policy_denied", ...over });
  const m = computeMetrics([
    deny({ rejection_fingerprint: "rf1:aaaa", ts: at(0) }),
    deny({ rejection_fingerprint: "rf1:aaaa", ts: at(30) }),   // 重复
    deny({ rejection_fingerprint: "rf1:bbbb", ts: at(31) }),   // 仅值不同：不重复
    deny({ rejection_fingerprint: "rf1:aaaa", ts: at(200) }),  // 超过 60 s：不重复
    deny({ rejection_fingerprint: "rf1:aaaa", ts: at(210), user_id: "u2" }),            // 他人：不重复
    deny({ rejection_fingerprint: "rf1:aaaa", ts: at(211), lucy_session_id: "s2" }),    // 另一会话：不重复
    deny({ rejection_fingerprint: "rf2:aaaa", ts: at(212) }),  // 另一版本前缀：不重复
    deny({ rejection_fingerprint: null, ts: at(213) })          // 无指纹：不入分母
  ]);
  assert.equal(m.M3.rejected, 7);
  assert.equal(m.M3.repeated, 1);
});

test("M2 含代理侧入参拒绝；M4 按理由前缀；M6 占比与误记检查", () => {
  const m = computeMetrics([
    row({ outcome: "denied", decision_reason: "tool_unclassified:foo", duration_ms: 5, tool: "foo" }),
    row({ outcome: "error", error_category: "client_schema_failure", decision_reason: "invalid_arguments:lucy_query:measures_required", duration_ms: 7 }),
    row({ outcome: "error", error_category: "upstream_failed", decision_reason: "invalid_arguments:lucy_query:x", duration_ms: 9 }),
    row({ outcome: "ok", duration_ms: 50 }),
    row({ tool: "initialize" })
  ]);
  assert.equal(m.M2.n, 2);
  assert.equal(m.M4.count, 1);
  assert.equal(m.M6.clientSchemaFailure, 1);
  assert.equal(m.M6.totalCalls, 4);
  assert.equal(m.M6.invalidArgsStillUpstreamFailed, 1);
});

test("M5 恢复率与同会话最大连续失败数", () => {
  const m = computeMetrics([
    row({ decision_reason: "session_lost" }),
    row({ decision_reason: "session_lost" }),
    row({ decision_reason: "ok" }),
    row({ decision_reason: "session_lost" }),
    row({ decision_reason: "x;upstream_session_recovered" })
  ]);
  assert.equal(m.M5.sessionLost, 3);
  assert.equal(m.M5.recovered, 1);
  assert.equal(m.M5.maxConsecutiveFailures, 2);
  assert.equal(m.M5.recoveryRate, 0.25);
});
