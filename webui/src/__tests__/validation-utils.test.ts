// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  formatValidationFailureToast,
  listValidationIssueMessages,
  primaryValidationIssue
} from "../pages/semantic/validation-utils";
import type { ValidationResult } from "../lib/types";

function result(partial: Partial<ValidationResult>): ValidationResult {
  return {
    ok: false,
    exitCode: 1,
    stdout: "",
    stderr: "",
    issues: [],
    ...partial
  };
}

describe("validation-utils", () => {
  it("prefers substantive issues over Project banner lines", () => {
    const issue =
      "semantic-layer/demo-mysql/_schema/._dataforai.yaml: Semantic-layer source YAML must contain an object";
    const validation = result({
      issues: [{ message: "Project: /data/lucy" }, { message: issue }]
    });
    expect(primaryValidationIssue(validation)).toBe(issue);
    expect(listValidationIssueMessages(validation)).toEqual([
      "Project: /data/lucy",
      issue
    ]);
    expect(formatValidationFailureToast(validation)).toBe(`校验未通过：${issue}`);
  });

  it("falls back to stderr lines when issues are empty", () => {
    const validation = result({
      issues: [],
      stderr: "Project: /data/lucy\nbad yaml\n"
    });
    expect(primaryValidationIssue(validation)).toBe("bad yaml");
    expect(formatValidationFailureToast(validation)).toBe("校验未通过：bad yaml");
  });

  it("returns a generic toast when no messages exist", () => {
    expect(formatValidationFailureToast(result({}))).toBe("校验未通过");
  });
});
