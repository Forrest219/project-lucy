/**
 * L25-16 S1 — 结果四分类与 operation 级五态聚合（Spec §4.2，Q01 / Q02 / F6-01 / F6-06）。
 */

import { describe, expect, it } from "vitest";
import {
  aggregateOperationState,
  OpsStateCorruptError,
  Outcome,
  OPS_PERSISTENT_STATES,
  OPS_TERMINAL_STATES
} from "../ops-outcome";

describe("L25-16 S1 持久态与终态", () => {
  it("五态与终态口径固定", () => {
    expect([...OPS_PERSISTENT_STATES]).toEqual([
      "pending",
      "succeeded",
      "failed",
      "recovery_required",
      "pending_activation"
    ]);
    expect([...OPS_TERMINAL_STATES]).toEqual(["succeeded", "failed"]);
  });
});

describe("L25-16 S1 Outcome 唯一构造器", () => {
  it("kind 与 ok 严格成对", () => {
    expect(Outcome.succeeded()).toMatchObject({ kind: "succeeded", ok: true });
    expect(Outcome.failed("boom")).toMatchObject({ kind: "failed", ok: false, code: "boom" });
    expect(Outcome.pendingActivation()).toMatchObject({ kind: "pending_activation", ok: null });
    expect(Outcome.recoveryRequired()).toMatchObject({ kind: "recovery_required", ok: null });
  });

  it("keep= 保留既有字段（如 release / activation）", () => {
    const pending = Outcome.pendingActivation({ release: { id: "rel-1" }, activation: { state: "pending" } });
    const failed = Outcome.failed("ops_write_failed", { keep: pending });
    expect(failed.kind).toBe("failed");
    expect(failed.ok).toBe(false);
    expect(failed.release).toEqual({ id: "rel-1" });
    expect(failed.activation).toEqual({ state: "pending" });
  });

  it("未提供的字段不出现在结果里", () => {
    expect("code" in Outcome.succeeded()).toBe(false);
    expect("stage" in Outcome.succeeded()).toBe(false);
  });
});

describe("L25-16 S1 aggregateOperationState", () => {
  it("空集合 → pending（没有「全部成功」的证据）", () => {
    expect(aggregateOperationState([])).toBe("pending");
  });

  it("全部成功 → succeeded", () => {
    expect(
      aggregateOperationState([
        { state: "succeeded", attempt: 1 },
        { state: "succeeded", attempt: 1 }
      ])
    ).toBe("succeeded");
  });

  it("全终态且含一个 failed → failed", () => {
    expect(
      aggregateOperationState([
        { state: "succeeded", attempt: 1 },
        { state: "failed", attempt: 1 }
      ])
    ).toBe("failed");
  });

  it("仍有 pending 成员时不得转 failed", () => {
    expect(
      aggregateOperationState([
        { state: "failed", attempt: 1 },
        { state: "pending", attempt: null }
      ])
    ).toBe("pending");
  });

  it("recovery_required 优先级最高", () => {
    expect(
      aggregateOperationState([
        { state: "succeeded", attempt: 1 },
        { state: "failed", attempt: 1 },
        { state: "pending_activation", attempt: 1 },
        { state: "recovery_required", attempt: 1 }
      ])
    ).toBe("recovery_required");
  });

  it("pending_activation 次于 recovery_required", () => {
    expect(
      aggregateOperationState([
        { state: "succeeded", attempt: 1 },
        { state: "pending_activation", attempt: 1 }
      ])
    ).toBe("pending_activation");
  });

  it("未知状态（含执行态 claimed 与已废止 skipped/reused）抛错", () => {
    expect(() => aggregateOperationState([{ state: "claimed" as never }])).toThrow(OpsStateCorruptError);
    expect(() => aggregateOperationState([{ state: "skipped" as never }])).toThrow(OpsStateCorruptError);
    expect(() => aggregateOperationState([{ state: "reused" as never }])).toThrow(OpsStateCorruptError);
  });

  it("错误携带稳定原因码 ops_state_corrupt", () => {
    try {
      aggregateOperationState([{ state: "claimed" as never }]);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(OpsStateCorruptError);
      expect((err as OpsStateCorruptError).code).toBe("ops_state_corrupt");
    }
  });
});
