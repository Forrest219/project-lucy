/** P1-33 / F-4 — cached formatter must render every instant exactly like the per-call formatter. */
import { describe, expect, it } from "vitest";
import { formatAuditLocalTimestamp } from "../../admin/audit-local-timestamp";
import { legacyFormatAuditLocalTimestamp } from "./legacy/audit-local-timestamp.legacy";
import { rng } from "./fixtures";

const ZONES = ["Asia/Shanghai", "UTC", "America/New_York", "Asia/Kolkata"];

describe("F-4 local timestamp equivalence", () => {
  it("non-date inputs", () => {
    for (const zone of ZONES) {
      for (const v of [null, undefined, "", "not-a-date", "2026-13-45T99:00:00Z"]) {
        expect(formatAuditLocalTimestamp(v, zone)).toBe(legacyFormatAuditLocalTimestamp(v, zone));
      }
    }
  });

  it("midnight, month/year boundaries, leap day and DST edges", () => {
    const edges = [
      "2026-11-14T16:00:00Z", "2026-11-14T15:59:59.999Z", "2024-02-29T23:59:59Z", "2026-12-31T16:00:00Z",
      "2026-03-08T07:00:00Z", "2026-11-01T06:00:00Z", "1970-01-01T00:00:00Z", "2099-12-31T23:59:59Z"
    ];
    for (const zone of ZONES) for (const e of edges) expect(formatAuditLocalTimestamp(e, zone)).toBe(legacyFormatAuditLocalTimestamp(e, zone));
  });

  it("50,000 pseudo-random instants across 80 years in every zone", () => {
    const rand = rng(99);
    for (let i = 0; i < 50_000; i += 1) {
      const iso = new Date(Date.UTC(1990, 0, 1) + Math.floor(rand() * 80 * 365 * 86_400_000)).toISOString();
      const zone = ZONES[i % ZONES.length];
      if (formatAuditLocalTimestamp(iso, zone) !== legacyFormatAuditLocalTimestamp(iso, zone)) throw new Error(`mismatch ${zone} ${iso}`);
    }
  });

  it("is at least 3x cheaper than constructing a formatter per cell (guards the regression, not a wall-clock)", () => {
    const iso = "2026-11-15T10:20:30Z";
    const n = 20_000;
    let t = performance.now();
    for (let i = 0; i < n; i += 1) legacyFormatAuditLocalTimestamp(iso, "Asia/Shanghai");
    const legacyMs = performance.now() - t;
    t = performance.now();
    for (let i = 0; i < n; i += 1) formatAuditLocalTimestamp(iso, "Asia/Shanghai");
    expect(performance.now() - t).toBeLessThan(legacyMs / 3);
  });
});
