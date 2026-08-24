import { describe, expect, it } from "vitest";
import { formatFinalRowsPreviewLabel, formatRowGrantPreviewLabel } from "../lib/row-grant-preview";

describe("formatRowGrantPreviewLabel", () => {
  it("renders FinalRows TRUE for all-access grants", () => {
    expect(formatRowGrantPreviewLabel(true)).toBe("TRUE");
    expect(formatRowGrantPreviewLabel("all")).toBe("TRUE");
    expect(formatRowGrantPreviewLabel({ kind: "all" })).toBe("TRUE");
  });

  it("renders scoped digest for protected sources (Spec 99 §8)", () => {
    expect(formatRowGrantPreviewLabel({ kind: "scoped", digest: "883501db707ba111" })).toBe(
      "scoped:883501db707ba111"
    );
  });

  it("appends predicate summary when Role preview includes predicates", () => {
    expect(
      formatRowGrantPreviewLabel({
        kind: "scoped",
        digest: "883501db707ba111",
        predicates: [
          { field: "region", op: "eq", value: "East" },
          { field: "segment", op: "in", values: ["Consumer", "Corporate"] }
        ]
      })
    ).toBe("scoped:883501db707ba111 · region=East AND segment in [Consumer,Corporate]");
  });

  it("does not invent TRUE when grant shape is unknown", () => {
    expect(formatRowGrantPreviewLabel(undefined)).toBe("unknown");
    expect(formatRowGrantPreviewLabel({ kind: "scoped" })).toBe("unknown");
  });
});

describe("formatFinalRowsPreviewLabel", () => {
  it("prefers FinalRows over rowGrant fallback", () => {
    expect(
      formatFinalRowsPreviewLabel(
        { kind: "scoped", digest: "aabbccddeeff0011" },
        { kind: "all" }
      )
    ).toBe("scoped:aabbccddeeff0011");
  });

  it("falls back to rowGrant when FinalRows omitted", () => {
    expect(formatFinalRowsPreviewLabel(undefined, "all")).toBe("TRUE");
  });
});
