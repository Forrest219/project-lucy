/**
 * WO-202610-13 T1 / SC-10 — `lucy_query` success rows always report
 * `response_truncated` as 0 or 1. Hitting the row cap forces 1 and carries
 * the aggregate repair hint. `lucy_freshness` / `lucy_explain_query` keep the
 * existing 0 they already write.
 */
import { describe, expect, it } from "vitest";
import {
  resolveResponseTruncated,
  TRUNCATION_REPAIR_HINT,
} from "../proxy/question-experience.js";

describe("lucy_query truncation marker", () => {
  it("reports 0 for a successful query under the row cap", () => {
    expect(resolveResponseTruncated({ rowCount: 10, rowCap: 100 })).toEqual({ responseTruncated: 0 });
    expect(resolveResponseTruncated({ upstreamTruncated: false, rowCount: 10, rowCap: 100 }))
      .toEqual({ responseTruncated: 0 });
  });

  it("reports 1 with the aggregate repair hint when the row cap is hit", () => {
    const resolved = resolveResponseTruncated({ rowCount: 100, rowCap: 100 });
    expect(resolved.responseTruncated).toBe(1);
    expect(resolved.repair).toBe(TRUNCATION_REPAIR_HINT);
    expect(resolved.repair).toContain("聚合");
  });

  it("reports 1 when the engine itself says the response was truncated", () => {
    const resolved = resolveResponseTruncated({ upstreamTruncated: true, rowCount: 3, rowCap: 100 });
    expect(resolved.responseTruncated).toBe(1);
    expect(resolved.repair).toBe(TRUNCATION_REPAIR_HINT);
  });

  it("never invents truncation when the row count or cap is unknown", () => {
    expect(resolveResponseTruncated({ rowCount: null, rowCap: null }).responseTruncated).toBe(0);
    expect(resolveResponseTruncated({ rowCount: 5000, rowCap: null }).responseTruncated).toBe(0);
    expect(resolveResponseTruncated({ rowCount: 5000, rowCap: 0 }).responseTruncated).toBe(0);
  });

  it("only ever produces 0 or 1, never undefined or null", () => {
    const inputs = [
      { rowCount: 0, rowCap: 100 },
      { rowCount: 100, rowCap: 100 },
      { rowCount: 101, rowCap: 100 },
      { upstreamTruncated: true },
      { upstreamTruncated: false },
      {},
    ];
    for (const input of inputs) {
      expect([0, 1]).toContain(resolveResponseTruncated(input).responseTruncated);
    }
  });
});