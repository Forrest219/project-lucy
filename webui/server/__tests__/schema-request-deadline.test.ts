import { describe, expect, it, vi } from "vitest";
import type { ConnectionInfo } from "../model.js";
import { readSchemaColumns } from "../schema-structure.js";

const hive: ConnectionInfo = {
  id: "budget-hive",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  database: "hive_jd.app",
  schemas: ["app"],
  enabledTables: []
};

describe("schema API shared request deadline", () => {
  it("never publishes fields obtained after the requestTimeoutMs envelope is exhausted", async () => {
    let tick = 0;
    const calls: number[] = [];
    const read = await readSchemaColumns("/isolated", hive.id, "app", {
      tables: ["orders"],
      requestTimeoutMs: 10_000,
      now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => ({
        close: vi.fn(),
        async run(_sql, options) {
          calls.push(options.timeoutMs);
          tick += 7_100;
          if (calls.length < 3) throw new Error("You have an error in your SQL syntax");
          return { rows: [["id", "bigint", "NO", "PRI"]], truncated: false };
        }
      })
    });
    // Envelope exhaustion may surface as status error, or as a timeout rejection when the
    // channel adapter catches SchemaReadTimeout (must not publish late fields either way).
    if (read.status === "error") {
      expect(read.message).toContain("超时");
    } else {
      expect(read.status).toBe("ok");
      expect(read.columns).toEqual([]);
      expect(read.rejections).toEqual([{ table: "orders", reason: "timeout" }]);
    }
    expect(calls[0]).toBeLessThanOrEqual(10_000);
  });

  it("charges connection setup to the same requestTimeoutMs envelope", async () => {
    let tick = 0;
    const read = await readSchemaColumns("/isolated", hive.id, "app", {
      tables: ["orders"],
      requestTimeoutMs: 10_000,
      now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => {
        tick += 12_000;
        return {
          close() {},
          async run() {
            tick += 8_000;
            return { rows: [["id", "bigint", "NO", "PRI"]], truncated: false };
          }
        };
      }
    });
    expect(read.status).toBe("error");
    if (read.status !== "error") return;
    expect(read.message).toContain("超时");
  });

  it("still reads a legal third syntax when the request envelope leaves enough time", async () => {
    let tick = 0;
    let calls = 0;
    const read = await readSchemaColumns("/isolated", hive.id, "app", {
      tables: ["orders"],
      requestTimeoutMs: 10_000,
      now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => ({
        close() {},
        async run() {
          calls++;
          tick += calls < 3 ? 100 : 1_000;
          if (calls < 3) throw new Error("You have an error in your SQL syntax");
          return { rows: [["id", "bigint", "NO", "PRI"]], truncated: false };
        }
      })
    });
    expect(read.status === "ok" && read.columns.map((c) => c.column)).toEqual(["id"]);
    expect(read.status === "ok" && read.tables).toEqual(["orders"]);
  });

  it("keeps callBudgetMs deferral when requestTimeoutMs is absent", async () => {
    let tick = 0;
    const read = await readSchemaColumns("/isolated", hive.id, "app", {
      tables: ["a", "b", "c"],
      callBudgetMs: 10_000,
      now: () => tick,
      readConnectionsImpl: async () => [hive],
      openChannelImpl: async () => ({
        close() {},
        async run() {
          tick += 6_000;
          return { rows: [["id", "bigint", "NO", "PRI"]], truncated: false };
        }
      })
    });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.tables).toEqual(["a", "b"]);
    expect(read.deferred).toEqual(["c"]);
  });
});
