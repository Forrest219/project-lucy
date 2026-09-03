import { describe, expect, it } from "vitest";
import { canonicalizeLucyQueryArgs } from "../proxy/lucy-query-normalization";

describe("canonicalizeLucyQueryArgs", () => {
  it("restores serialized JSON filter arrays to the structured shape", () => {
    const structured = [{ field: "orders.region", op: "in", values: ["East", "West"] }];
    expect(canonicalizeLucyQueryArgs({
      connectionId: "demo",
      measures: ["orders.sales"],
      filters: JSON.stringify(structured)
    })).toEqual({
      ok: true,
      args: {
        connectionId: "demo",
        measures: ["orders.sales"],
        filters: structured
      }
    });
  });

  it("restores a serialized JSON filter object", () => {
    const filter = { field: "orders.region", op: "eq", value: "East" };
    expect(canonicalizeLucyQueryArgs({ filters: JSON.stringify(filter) })).toEqual({
      ok: true,
      args: { filters: filter }
    });
  });

  it("rejects malformed JSON-looking filters without exposing the input", () => {
    expect(canonicalizeLucyQueryArgs({ filters: '[{"field":"orders.region"}' })).toEqual({
      ok: false,
      reason: "invalid_arguments:lucy_query:filters_serialized_json_invalid"
    });
  });

  it("leaves non-JSON filter expressions compatible", () => {
    expect(canonicalizeLucyQueryArgs({ filters: "orders.region = 'East'" })).toEqual({
      ok: true,
      args: { filters: "orders.region = 'East'" }
    });
  });

  it("canonicalizes orderBy to order_by", () => {
    const order = [{ field: "orders.load_time", direction: "desc" }];
    expect(canonicalizeLucyQueryArgs({ orderBy: order })).toEqual({
      ok: true,
      args: { order_by: order }
    });
  });

  it("accepts equivalent aliases and keeps only order_by", () => {
    const order = [{ field: "orders.load_time", direction: "desc" }];
    expect(canonicalizeLucyQueryArgs({ order_by: order, orderBy: structuredClone(order) })).toEqual({
      ok: true,
      args: { order_by: order }
    });
  });

  it("rejects conflicting order aliases", () => {
    expect(canonicalizeLucyQueryArgs({
      order_by: [{ field: "orders.load_time", direction: "asc" }],
      orderBy: [{ field: "orders.load_time", direction: "desc" }]
    })).toEqual({
      ok: false,
      reason: "invalid_arguments:lucy_query:order_by_conflict"
    });
  });

  it("keeps legacy measure object normalization", () => {
    expect(canonicalizeLucyQueryArgs({
      measures: [{ $text: " orders.sales " }, { name: "orders.profit" }, { expr: "SUM(x)", name: "x" }]
    })).toEqual({
      ok: true,
      args: { measures: ["orders.sales", "orders.profit", { expr: "SUM(x)", name: "x" }] }
    });
  });
});
