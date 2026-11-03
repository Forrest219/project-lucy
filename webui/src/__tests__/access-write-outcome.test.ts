import { describe, expect, it } from "vitest";
import {
  describeAccessWriteFailure,
  describeAccessWriteOutcome
} from "../lib/accessWriteOutcome";

/**
 * Lucy v0.25 (L25-14 §14.3.2) — the three terminal states of an access write.
 *
 * - only `committed` may be shown as a success;
 * - `rolled_back` shows that the new change was NOT saved;
 * - `recovery_required` shows that the affected reads and the writes are blocked;
 * - the outcome is never derived from the HTTP status alone.
 */
describe("describeAccessWriteOutcome", () => {
  it("treats a committed write as the only success", () => {
    const outcome = describeAccessWriteOutcome(
      { written: true, status: "committed", runtimeAck: true, policyVersion: "abcdef0123456789" },
      "Role 已保存"
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.message).toContain("Role 已保存");
    expect(outcome.message).toContain("policyVersion=abcdef012345");
  });

  it("shows a rolled-back write as not saved and the old policy as verified back", () => {
    const outcome = describeAccessWriteOutcome(
      { written: false, status: "rolled_back", runtimeAck: false },
      "Role 已保存"
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("新变更已回滚");
    expect(outcome.message).toContain("旧配置与旧策略已核验恢复");
    expect(outcome.message).not.toContain("Role 已保存");
  });

  it("shows a recovery-required write as blocked", () => {
    const outcome = describeAccessWriteOutcome(
      { written: false, status: "recovery_required", runtimeAck: false, recoveryRequired: true },
      "Role 已保存"
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("受影响读取与后续写入已阻断");
  });

  it("never reports a success when the runtime did not acknowledge", () => {
    const outcome = describeAccessWriteOutcome(
      { written: true, status: "committed", runtimeAck: false },
      "Role 已保存"
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("runtimeAck=false");
  });
});

describe("describeAccessWriteFailure", () => {
  it("reads the terminal state out of a rejected write envelope", () => {
    const outcome = describeAccessWriteFailure({
      message: "保存未生效：新变更已回滚，旧配置与旧策略已核验恢复。",
      data: { status: "rolled_back", written: false, runtimeAck: false }
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain("新变更已回滚");
  });

  it("keeps the original message when the error carries no terminal state", () => {
    const outcome = describeAccessWriteFailure(new Error("网络异常"));
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toBe("网络异常");
  });
});
