import { describe, expect, it } from "vitest";
import {
  classifyConnectionError,
  formatConnectionErrorMessage
} from "../connection-errors";

describe("connection-errors", () => {
  it("classifies StarRocks max_execution_time", () => {
    const g = classifyConnectionError(
      "Project: /data/lucy\nUnknown system variable 'max_execution_time'"
    );
    expect(g.category).toBe("starrocks_max_execution_time");
    expect(g.actions[0]).toMatch(/补丁/);
  });

  it("classifies uv runtime download failure", () => {
    const g = classifyConnectionError("ktx could not download uv 0.11.21");
    expect(g.category).toBe("ktx_runtime_uv");
  });

  it("formatConnectionErrorMessage includes actionable hint", () => {
    const msg = formatConnectionErrorMessage("Unknown system variable 'max_execution_time'");
    expect(msg).toMatch(/max_execution_time|StarRocks/);
    expect(msg).toMatch(/建议/);
  });
});
