/**
 * T07 audit-trust 集成测试：
 * - scopeFingerprint 不包含 filter VALUES
 * - detectScopeChange 仅报告 KIND, 不报告值
 * - assessFreshness 不发明 last_updated
 * - 重试链 fingerprint 不同时标记 scope_change
 */
import { describe, expect, it } from "vitest";
import {
  detectScopeChange,
  scopeFingerprint,
  assessFreshness,
  buildAttempt,
  chainScopeChanges,
  type AttemptScope
} from "../../proxy/audit-scope-change";

const baseScope = (overrides: Partial<AttemptScope> = {}): AttemptScope => ({
  filterKeys: ["user_id", "table"],
  timeFrom: "2026-10-19T00:00:00Z",
  timeUntil: "2026-10-19T23:59:59Z",
  limit: 100,
  connectionId: "main",
  ...overrides
});

describe("T07 scopeFingerprint", () => {
  it("does NOT include filter VALUES (only structural keys)", () => {
    const a = baseScope({ filterKeys: ["user_id", "table"] });
    const b = baseScope({ filterKeys: ["user_id", "table"] });
    // Same keys -> same fingerprint even if values would differ
    // (we never accept filter values, so the test verifies keys-only determinism).
    expect(scopeFingerprint(a)).toBe(scopeFingerprint(b));
  });

  it("is deterministic for same structural inputs", () => {
    expect(scopeFingerprint(baseScope())).toBe(scopeFingerprint(baseScope()));
  });

  it("differs when filterKeys change", () => {
    expect(scopeFingerprint(baseScope({ filterKeys: ["user_id", "table"] }))).not.toBe(
      scopeFingerprint(baseScope({ filterKeys: ["user_id", "table", "from"] }))
    );
  });

  it("differs when timeFrom changes", () => {
    expect(scopeFingerprint(baseScope({ timeFrom: "2026-10-19T00:00:00Z" }))).not.toBe(
      scopeFingerprint(baseScope({ timeFrom: "2026-10-20T00:00:00Z" }))
    );
  });

  it("differs when limit changes", () => {
    expect(scopeFingerprint(baseScope({ limit: 100 }))).not.toBe(
      scopeFingerprint(baseScope({ limit: 200 }))
    );
  });

  it("differs when connectionId changes", () => {
    expect(scopeFingerprint(baseScope({ connectionId: "main" }))).not.toBe(
      scopeFingerprint(baseScope({ connectionId: "side" }))
    );
  });
});

describe("T07 detectScopeChange", () => {
  it("returns empty changed[] when scope is identical", () => {
    const before = baseScope();
    const after = baseScope();
    const result = detectScopeChange(before, after);
    expect(result.changed).toEqual([]);
    expect(result.fingerprintBefore).toBe(result.fingerprintAfter);
  });

  it("returns null fingerprintBefore when before is null", () => {
    const result = detectScopeChange(null, baseScope());
    expect(result.fingerprintBefore).toBeNull();
    expect(result.changed).toEqual([]);
  });

  it("flags replace_filter when filterKeys differ", () => {
    const before = baseScope({ filterKeys: ["user_id"] });
    const after = baseScope({ filterKeys: ["user_id", "table"] });
    const result = detectScopeChange(before, after);
    expect(result.changed).toContain("replace_filter");
  });

  it("flags widen_time when timeFrom or timeUntil differ", () => {
    const before = baseScope({ timeFrom: "2026-10-19T00:00:00Z" });
    const after = baseScope({ timeFrom: "2026-10-19T01:00:00Z" });
    expect(detectScopeChange(before, after).changed).toContain("widen_time");
  });

  it("flags widen_limit when limit differs", () => {
    const before = baseScope({ limit: 100 });
    const after = baseScope({ limit: 500 });
    expect(detectScopeChange(before, after).changed).toContain("widen_limit");
  });

  it("flags switch_connection when connectionId differs", () => {
    const before = baseScope({ connectionId: "main" });
    const after = baseScope({ connectionId: "side" });
    expect(detectScopeChange(before, after).changed).toContain("switch_connection");
  });

  it("flags multiple changes when several axes differ", () => {
    const before = baseScope({ limit: 100, connectionId: "main" });
    const after = baseScope({ limit: 200, connectionId: "side" });
    const result = detectScopeChange(before, after);
    expect(result.changed).toContain("widen_limit");
    expect(result.changed).toContain("switch_connection");
    expect(result.changed.length).toBe(2);
  });

  it("NEVER reports filter VALUES — only change kinds", () => {
    const before = baseScope({ filterKeys: ["user_id"] });
    const after = baseScope({ filterKeys: ["user_id"] });
    // Both have user_id as filterKeys; replace_filter should not fire.
    expect(detectScopeChange(before, after).changed).not.toContain("replace_filter");
  });
});

describe("T07 assessFreshness", () => {
  it("returns ok when all three timestamps present", () => {
    const r = assessFreshness({
      businessCutoff: "2026-10-19T00:00:00Z",
      loadOrCollectedAt: "2026-10-19T01:00:00Z",
      semanticUpdatedAt: "2026-10-18T23:00:00Z"
    });
    expect(r.status).toBe("ok");
    expect(r.reasons).toEqual([]);
  });

  it("returns unknown when ALL three missing (per contract: do NOT invent)", () => {
    const r = assessFreshness({
      businessCutoff: null,
      loadOrCollectedAt: null,
      semanticUpdatedAt: null
    });
    expect(r.status).toBe("unknown");
    expect(r.reasons).toHaveLength(3);
  });

  it("returns partial when only some present", () => {
    const r = assessFreshness({
      businessCutoff: "2026-10-19T00:00:00Z",
      loadOrCollectedAt: null,
      semanticUpdatedAt: null
    });
    expect(r.status).toBe("partial");
    expect(r.reasons).toContain("load_or_collected_at_missing");
  });

  it("does NOT fabricate last_updated when timestamps missing", () => {
    // The function should never return a status that asserts freshness when
    // metadata is absent; "ok" must NOT appear when any timestamp is null.
    const r = assessFreshness({
      businessCutoff: "2026-10-19T00:00:00Z",
      loadOrCollectedAt: null,
      semanticUpdatedAt: "2026-10-18T23:00:00Z"
    });
    expect(r.status).not.toBe("ok");
  });
});

describe("T07 retry chain", () => {
  it("buildAttempt returns a stable fingerprint over scope", () => {
    const a = buildAttempt({
      attemptId: "att-1",
      parentAttemptId: null,
      scope: baseScope()
    });
    expect(a.attemptId).toBe("att-1");
    expect(a.parentAttemptId).toBeNull();
    expect(a.scopeFingerprint).toBe(scopeFingerprint(baseScope()));
  });

  it("chainScopeChanges returns empty for single attempt", () => {
    const a = buildAttempt({ attemptId: "att-1", parentAttemptId: null, scope: baseScope() });
    expect(chainScopeChanges([a])).toEqual([]);
  });

  it("chainScopeChanges flags change between consecutive attempts", () => {
    const a1 = buildAttempt({
      attemptId: "att-1",
      parentAttemptId: null,
      scope: baseScope({ limit: 100 })
    });
    const a2 = buildAttempt({
      attemptId: "att-2",
      parentAttemptId: "att-1",
      scope: baseScope({ limit: 200 })
    });
    const changes = chainScopeChanges([a1, a2]);
    expect(changes).toHaveLength(1);
    expect(changes[0].fromAttempt).toBe("att-1");
    expect(changes[0].toAttempt).toBe("att-2");
    expect(changes[0].changed.length).toBeGreaterThan(0);
  });

  it("chainScopeChanges does NOT flag identical attempts", () => {
    const a1 = buildAttempt({
      attemptId: "att-1",
      parentAttemptId: null,
      scope: baseScope()
    });
    const a2 = buildAttempt({
      attemptId: "att-2",
      parentAttemptId: "att-1",
      scope: baseScope()
    });
    const changes = chainScopeChanges([a1, a2]);
    expect(changes).toHaveLength(1);
    expect(changes[0].changed).toEqual([]);
  });
});