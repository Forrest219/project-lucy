import { describe, expect, it } from "vitest";
import { isPublicUiPath } from "../lib/publicAccess";

describe("isPublicUiPath", () => {
  it("allows login and help without a WebUI session", () => {
    expect(isPublicUiPath("/login")).toBe(true);
    expect(isPublicUiPath("/help")).toBe(true);
    expect(isPublicUiPath("/overview")).toBe(false);
    expect(isPublicUiPath("/admin/agents")).toBe(false);
  });
});
