import { describe, expect, it } from "vitest";
import {
  accessPathKey,
  assertCountingInvariant,
  canonicalSourceKeyDisplay,
  countAccessPaths,
  countDistinctAgents,
  countGrantPaths,
  countTables,
  edgeCallCounts,
  globalCallCount,
  grantPathKey,
  tableCountKey
} from "../admin/counting.js";

const orders = { connectionId: "warehouse", schema: "finance", sourceName: "orders", physicalTable: "finance.orders" };
const ordersOtherSchema = { connectionId: "warehouse", schema: "ops", sourceName: "orders", physicalTable: "ops.orders" };

describe("P1 counting vocabulary", () => {
  it("counts tables by canonical source key, not by connection+source name", () => {
    // Same connection, same source name, different Schema → two tables.
    expect(countTables([orders, ordersOtherSchema])).toBe(2);
    // The same table twice → one table.
    expect(countTables([orders, orders])).toBe(1);
  });

  it("keeps the table count key aligned with the existing admin counting key", () => {
    // permission-display.ts sourceCountKey(conn, schema, table)
    expect(tableCountKey(orders)).toBe("warehouse\u0000finance\u0000orders");
  });

  it("treats two Roles over one table as two grant paths and one table", () => {
    const refs = [
      { ...orders, agentId: "a1", roleId: "r1" },
      { ...orders, agentId: "a1", roleId: "r2" }
    ];
    expect(countGrantPaths(refs)).toBe(2);
    expect(countTables(refs)).toBe(1);
    expect(countDistinctAgents(refs)).toBe(1);
  });

  it("keeps grant path keys five-part so cross-Schema same-name tables do not merge", () => {
    const a = grantPathKey({ ...orders, agentId: "a1", roleId: "r1" });
    const b = grantPathKey({ ...ordersOtherSchema, agentId: "a1", roleId: "r1" });
    expect(a).not.toBe(b);
    expect(accessPathKey({ ...orders, agentId: "a1", roleId: "r1" })).toBe(a);
  });

  it("counts access paths as deduplicated existence, not calls", () => {
    const refs = [
      { ...orders, agentId: "a1", roleId: "r1" },
      { ...orders, agentId: "a1", roleId: "r1" },
      { ...orders, agentId: "a2", roleId: "r1" }
    ];
    expect(countAccessPaths(refs)).toBe(2);
  });

  it("does not double-count one call that was attributed to two Roles globally", () => {
    const calls = [
      { callId: "c1", roleId: "r1" },
      { callId: "c1", roleId: "r2" }
    ];
    // Per edge, each Role edge counts the call once.
    expect(edgeCallCounts(calls).get("r1")).toBe(1);
    expect(edgeCallCounts(calls).get("r2")).toBe(1);
    // Globally it is ONE call — summing the edges would report two.
    expect(globalCallCount(calls)).toBe(1);
  });

  it("reports the misread when a path count is presented as a table count", () => {
    const tables = new Set([tableCountKey(orders), tableCountKey(ordersOtherSchema)]);
    // 2 tables, 1 grant path → legal, but the two numbers are not interchangeable.
    expect(assertCountingInvariant({ tables, grantPaths: 1, accessPaths: 0 })).toHaveLength(1);
    expect(assertCountingInvariant({ tables, grantPaths: 4, accessPaths: 2 })).toHaveLength(0);
  });

  it("keeps the display identity four-part", () => {
    expect(canonicalSourceKeyDisplay(orders)).toBe("warehouse|finance|orders|finance.orders");
  });
});
