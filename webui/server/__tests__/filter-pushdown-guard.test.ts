import { describe, expect, it } from "vitest";
import { filterPushdownGuardEnabled, isFilterPushdownText } from "../proxy/question-experience.js";

const KSC_STRUCT = "STRUCT('month' AS field, '=' AS op, '2026-09' AS val)";
const MJ_TRUNCATED = "errCode = 2, detailMessage = ...RUCT(";

describe("filter pushdown guard", () => {
  it("matches a full STRUCT filter and a truncated engine fragment", () => {
    expect(isFilterPushdownText(KSC_STRUCT)).toBe(true);
    expect(isFilterPushdownText(`You have an error in your SQL syntax; check the manual near '${MJ_TRUNCATED}'`)).toBe(true);
    expect(isFilterPushdownText("SELECT region, SUM(sales) FROM orders GROUP BY region")).toBe(false);
  });

  it("stays on unless the kill switch is set", () => {
    const previous = process.env.LUCY_FILTER_PUSHDOWN_GUARD;
    delete process.env.LUCY_FILTER_PUSHDOWN_GUARD;
    expect(filterPushdownGuardEnabled()).toBe(true);
    process.env.LUCY_FILTER_PUSHDOWN_GUARD = "off";
    expect(filterPushdownGuardEnabled()).toBe(false);
    if (previous === undefined) delete process.env.LUCY_FILTER_PUSHDOWN_GUARD;
    else process.env.LUCY_FILTER_PUSHDOWN_GUARD = previous;
  });
});
