import { describe, expect, it } from "vitest";
import {
  MAX_SPANS_PER_TRACE,
  REASON_CODES,
  TraceRecorder,
  checkSpanIntegrity,
  checkSpanTiming,
  mapReasonCode,
  sanitizeSpanAttrs
} from "../proxy/audit-trace-span.js";

function fakeClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe("mapReasonCode（§5.4 全函数）", () => {
  const cases: Array<[string | null, string | null, string, string | null]> = [
    ["allowed", "ok", "allowed", null],
    ["budget_continuation_declared", "ok", "allowed", null],
    ["upstream_session_recovered", "ok", "upstream_session_recovered", null],
    ["question_budget_exhausted", "budget_stop", "budget_stopped", "budget_stopped"],
    ["question_budget_concurrency_exceeded", "denied", "budget_stopped", "budget_stopped"],
    ["no_credit", "denied", "continuation_rejected", "validation_failed"],
    ["cancelled", "error", "cancelled", "cancelled"],
    ["timeout", "error", "timeout", "timeout"],
    ["table_forbidden:orders", "denied", "acl_denied", "policy_denied"],
    ["explicit_table_required:orders", "denied", "acl_denied", "policy_denied"],
    ["tool_forbidden", "denied", "acl_denied", "policy_denied"],
    ["policy_degraded_deny", "denied", "acl_denied", "policy_denied"],
    ["role_resolution_failed:r1:x", "denied", "acl_denied", "policy_denied"],
    ["ops_not_granted:ops_x", "denied", "acl_denied", "policy_denied"],
    ["source_ambiguity_gate", "denied", "gate_denied", "validation_failed"],
    ["caliber_binding_unresolved", "denied", "gate_denied", "validation_failed"],
    ["count_without_source", "denied", "validation_failed", "validation_failed"],
    ["explicit_table_required:<empty>", "denied", "validation_failed", "validation_failed"],
    ["invalid_arguments", "error", "arg_invalid", "client_schema_failure"],
    ["audit_unavailable", "error", "audit_unavailable", "upstream_failed"],
    ["execution_runtime_unavailable", "error", "execution_unavailable", "upstream_failed"],
    ["upstream_error", "error", "upstream_error", "upstream_failed"],
    ["allowed", "error", "upstream_error", "upstream_failed"],
    ["session_lost", "error", "session_lost", "upstream_failed"],
    ["session_shortcircuit", "error", "session_shortcircuit", "upstream_failed"],
    ["conversation_turn_write_failed", "error", "internal_error", "upstream_failed"],
    ["something_new_never_seen", "denied", "unclassified", "policy_denied"]
  ];
  it.each(cases)("%s / %s → %s", (reason, outcome, code, category) => {
    const mapped = mapReasonCode({ decisionReason: reason, outcome });
    expect(mapped.code).toBe(code);
    expect(mapped.errorCategory).toBe(category);
    expect(REASON_CODES).toContain(mapped.code);
  });

  it("detail 含 Timeout 归 timeout；空理由 + ok 归 allowed", () => {
    expect(mapReasonCode({ decisionReason: "x", outcome: "error", errorDetail: "Timeout 30s" }).code).toBe("timeout");
    expect(mapReasonCode({ decisionReason: null, outcome: "ok" }).code).toBe("allowed");
  });

  it("reason_param 脱敏并限 128 字节，保留原始动态后缀", () => {
    const mapped = mapReasonCode({ decisionReason: `table_forbidden:${"é".repeat(200)}`, outcome: "denied" });
    expect(Buffer.byteLength(mapped.param ?? "", "utf8")).toBeLessThanOrEqual(128);
    expect(mapped.param?.startsWith("table_forbidden:")).toBe(true);
    expect(mapReasonCode({ decisionReason: null, outcome: "ok" }).param).toBeNull();
  });

  it("任意字符串输入都落在注册表内（全函数）", () => {
    for (const reason of ["", "x", "table_forbidden:", "a|b", "允许", "\u0000"]) {
      for (const outcome of ["ok", "denied", "error", "budget_stop", ""]) {
        expect(REASON_CODES).toContain(mapReasonCode({ decisionReason: reason, outcome }).code);
      }
    }
  });
});

describe("sanitizeSpanAttrs", () => {
  it("只保留白名单键与原子值", () => {
    const json = sanitizeSpanAttrs("acl", { decision: "allow", policy_version: 7, sql: "select 1", nested: { a: 1 } });
    expect(JSON.parse(json ?? "{}")).toEqual({ decision: "allow", policy_version: 7 });
  });
  it("无合法键 → null；dropped 对所有阶段可用", () => {
    expect(sanitizeSpanAttrs("acl", { sql: "x" })).toBeNull();
    expect(JSON.parse(sanitizeSpanAttrs("upstream_call", { dropped: 3 }) ?? "{}")).toEqual({ dropped: 3 });
  });
  it("超过 1024 UTF-8 字节时不会产出超限结果", () => {
    const json = sanitizeSpanAttrs("acl", { decision: "x".repeat(500), policy_version: "y".repeat(500) });
    expect(Buffer.byteLength(json ?? "", "utf8")).toBeLessThanOrEqual(1024);
  });
});

describe("TraceRecorder", () => {
  function build() {
    const clock = fakeClock();
    const recorder = new TraceRecorder({ traceId: "trace_t1", monoNow: clock.now, wallNow: () => 1_700_000_000_000 });
    return { clock, recorder };
  }

  it("根 span 起点＝0 偏移，终点与 durationMs 同一读数；行 ts 锚定 wall0 + duration", () => {
    const { clock, recorder } = build();
    clock.advance(5);
    const acl = recorder.start("acl");
    clock.advance(3);
    acl.end({ status: "ok", reasonCode: "allowed", attrs: { decision: "allow" } });
    clock.advance(10);
    const fin = recorder.finish();
    expect(fin.durationMs).toBe(18);
    expect(fin.wallEndMs).toBe(1_700_000_000_018);
    const [root, child] = fin.spans;
    expect(root.stage).toBe("admission");
    expect(root.parentSpanId).toBeNull();
    expect(root.durationMs).toBe(18);
    expect(child.parentSpanId).toBe(root.spanId);
    expect(child.startedAtMs).toBe(1_700_000_000_005);
    expect(child.durationMs).toBe(3);
    expect(checkSpanIntegrity(fin.spans)).toEqual([]);
    expect(checkSpanTiming(fin.spans, { tsMs: fin.wallEndMs, durationMs: fin.durationMs })).toEqual([]);
  });

  it("finish 幂等，且之后不再接收 span", () => {
    const { recorder } = build();
    const first = recorder.finish();
    recorder.start("acl");
    expect(recorder.finish()).toBe(first);
    expect(first.spans).toHaveLength(1);
  });

  it("未结束的 span 在根结束时记为 error，区间不越界", () => {
    const { clock, recorder } = build();
    recorder.start("upstream_call");
    clock.advance(40);
    const fin = recorder.finish();
    const span = fin.spans[1];
    expect(span.status).toBe("error");
    expect(span.durationMs).toBe(40);
    expect(checkSpanTiming(fin.spans, { tsMs: fin.wallEndMs, durationMs: fin.durationMs })).toEqual([]);
  });

  it("mark 记录零时长裁决点；record 钳制到根区间内", () => {
    const { clock, recorder } = build();
    clock.advance(2);
    recorder.mark("acl", { status: "denied", reasonCode: "acl_denied" });
    recorder.record("upstream_call", 900, 5000, { status: "ok" });
    clock.advance(4);
    const fin = recorder.finish();
    const [, mark, rec] = fin.spans;
    expect(mark.durationMs).toBe(0);
    expect(mark.status).toBe("denied");
    expect(rec.startedAtMs).toBe(fin.wallStartMs);
    expect(rec.startedAtMs + rec.durationMs).toBeLessThanOrEqual(fin.wallEndMs);
  });

  it("父子：显式 parent 生效，parent.seq < child.seq", () => {
    const { recorder } = build();
    const recover = recorder.start("session_recover");
    const handshake = recorder.start("upstream_handshake", recover);
    handshake.end();
    recover.end({ attrs: { recovered: true } });
    const fin = recorder.finish();
    expect(fin.spans[2].parentSpanId).toBe(fin.spans[1].spanId);
    expect(checkSpanIntegrity(fin.spans)).toEqual([]);
  });

  it("超过 32 行：保留 31 条＋1 条 truncated，dropped = 总数 − 31", () => {
    const { clock, recorder } = build();
    for (let i = 0; i < 39; i += 1) {
      clock.advance(1);
      recorder.mark("acl", { status: "ok" });
    }
    const fin = recorder.finish();
    expect(fin.spans).toHaveLength(MAX_SPANS_PER_TRACE);
    const last = fin.spans[MAX_SPANS_PER_TRACE - 1];
    expect(last.status).toBe("truncated");
    expect(JSON.parse(last.attrsJson ?? "{}")).toEqual({ dropped: 40 - 31 });
    expect(fin.spans.filter((s) => s.status !== "truncated")).toHaveLength(31);
    expect(checkSpanIntegrity(fin.spans)).toEqual([]);
    expect(checkSpanTiming(fin.spans, { tsMs: fin.wallEndMs, durationMs: fin.durationMs })).toEqual([]);
  });

  it("恰好 32 条不触发 truncated", () => {
    const { recorder } = build();
    for (let i = 0; i < 31; i += 1) recorder.mark("acl");
    const fin = recorder.finish();
    expect(fin.spans).toHaveLength(32);
    expect(fin.spans.some((s) => s.status === "truncated")).toBe(false);
  });
});

describe("checkSpanIntegrity / checkSpanTiming 反例", () => {
  const base = (over: Partial<Parameters<typeof checkSpanIntegrity>[0][number]> & { spanId: string; seq: number }) => ({
    parentSpanId: "root", stage: "acl", startedAtMs: 100, durationMs: 1, status: "ok", reasonCode: null, attrsJson: null,
    ...over
  });
  const root = { spanId: "root", parentSpanId: null, seq: 1, stage: "admission", startedAtMs: 100, durationMs: 10, status: "ok", reasonCode: null, attrsJson: null };

  it("双根 / 断号 / 未知阶段 / 未知理由码 / 越权属性键 / 缺父", () => {
    expect(checkSpanIntegrity([root, { ...root, spanId: "r2", seq: 2 }]).join()).toContain("root_count=2");
    expect(checkSpanIntegrity([root, base({ spanId: "a", seq: 3 })]).join()).toContain("seq_gap");
    expect(checkSpanIntegrity([root, base({ spanId: "a", seq: 2, stage: "bogus" })]).join()).toContain("stage_unknown");
    expect(checkSpanIntegrity([root, base({ spanId: "a", seq: 2, reasonCode: "made_up" })]).join()).toContain("reason_unknown");
    expect(checkSpanIntegrity([root, base({ spanId: "a", seq: 2, attrsJson: '{"sql":"x"}' })]).join()).toContain("attr_key_not_allowed");
    expect(checkSpanIntegrity([root, base({ spanId: "a", seq: 2, parentSpanId: "ghost" })]).join()).toContain("parent_missing");
  });

  it("环路被检出", () => {
    const a = base({ spanId: "a", seq: 2, parentSpanId: "b" });
    const b = base({ spanId: "b", seq: 3, parentSpanId: "a" });
    expect(checkSpanIntegrity([root, a, b]).join()).toMatch(/cycle|parent_seq_not_before_child/);
  });

  it("C9 反例：子 span 越界、行时长错位、整体平移、串行重叠", () => {
    const row = { tsMs: 110, durationMs: 10 };
    expect(checkSpanTiming([root, base({ spanId: "a", seq: 2, startedAtMs: 95 })], row).join()).toContain("C9a");
    expect(checkSpanTiming([root], { tsMs: 110, durationMs: 14 }).join()).toContain("C9b");
    expect(checkSpanTiming([root], { tsMs: 5_000_110, durationMs: 10 }).join()).toContain("C9c");
    const overlap = [
      root,
      base({ spanId: "a", seq: 2, startedAtMs: 100, durationMs: 6 }),
      base({ spanId: "b", seq: 3, startedAtMs: 103, durationMs: 3 })
    ];
    expect(checkSpanTiming(overlap, row).join()).toContain("C9d");
  });

  it("并行阶段不检查重叠", () => {
    const parallel = [
      root,
      base({ spanId: "a", seq: 2, stage: "catalog_resolve", startedAtMs: 100, durationMs: 6 }),
      base({ spanId: "b", seq: 3, stage: "skills_load", startedAtMs: 103, durationMs: 3 })
    ];
    expect(checkSpanTiming(parallel, { tsMs: 110, durationMs: 10 })).toEqual([]);
  });
});
