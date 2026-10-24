import { describe, expect, it } from "vitest";
import { formatBundledKtxVersion, formatWorkspaceStatus, isRecordedCommit } from "./lucyRevision";

const SHA = "e8863b8a".padEnd(40, "0");

describe("version info revision text", () => {
  it("describes a recorded commit without the word dirty", () => {
    expect(isRecordedCommit(SHA)).toBe(true);
    expect(formatWorkspaceStatus(SHA, false)).toBe("与记录的提交一致");
    expect(formatWorkspaceStatus(SHA, true)).toBe("构建时工作区有未提交改动");
    expect(formatWorkspaceStatus(SHA, true)).not.toMatch(/dirty/i);
  });

  it("does not turn a product version or a short sha into a commit id", () => {
    expect(isRecordedCommit("0.2.0")).toBe(false);
    expect(isRecordedCommit("e8863b8")).toBe(false);
    expect(formatWorkspaceStatus("0.2.0", false)).toBe("unknown");
    expect(formatWorkspaceStatus("e8863b8", true)).toBe("unknown");
  });

  it("keeps a missing KTX version as unknown", () => {
    expect(formatBundledKtxVersion("0.16.0")).toBe("0.16.0");
    expect(formatBundledKtxVersion("  ")).toBe("unknown");
    expect(formatBundledKtxVersion(undefined)).toBe("unknown");
  });
});
