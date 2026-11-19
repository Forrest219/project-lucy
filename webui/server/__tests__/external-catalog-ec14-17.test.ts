/**
 * EC-14–EC-17  FDE 3b1c62af F02 合同修订（P1-20 §8.4）
 * 使用假时钟（vi.useFakeTimers）确保测试不依赖真实等待时长。
 *
 * EC-14: 三次探针耗时 [7100,100,100]，前两条语法拒绝 → 读到字段，`reason` 不为 timeout
 * EC-15: 三次探针耗时 [7100,7100,7100]，预算压缩 → 结果必须是 `deferred`
 * EC-16: 探针返回明确超时信号且 timeoutMs = PER_TABLE_TIMEOUT_MS → 1 条，reason=timeout（应绿对照）
 * EC-17: 非超时失败的耗时取 timeout−1501…timeout，均不判 timeout，均继续回退，每个后接成功探针
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInfo } from "../model";
import { readSchemaColumns } from "../schema-structure";

const hiveConn: ConnectionInfo = {
  id: "hive-probe",
  driver: "mysql",
  engine: "mysql",
  wireProtocol: "mysql",
  database: "hive_jd.app",
  schemas: ["app"],
  enabledTables: []
};

afterEach(() => {
  vi.useRealTimers();
});

type ChannelRun = (sql: string, options: { maxRows?: number; timeoutMs?: number }) => Promise<{
  rows: unknown[][];
  truncated: boolean;
}>;

/**
 * Creates a channel that advances fake timers on each call.
 * costsMsPerSql: simulated cost per SQL call.
 * syntaxFailUpTo: index up to which calls throw a syntax error.
 * timeoutText: optional text to use in a timeout error (default: syntax error).
 */
function makeFakeChannel(costsMsPerSql: number[], syntaxFailUpTo = -1, explicitTimeoutText?: string) {
  let callIndex = 0;
  const calls: { sql: string; timeoutMs: number }[] = [];
  const run: ChannelRun = async (sql: string, options) => {
    const index = callIndex++;
    const cost = costsMsPerSql[index] ?? 100;
    const timeoutMs = options.timeoutMs ?? 8_000;
    calls.push({ sql, timeoutMs });
    // Advance fake clock by min(cost, timeoutMs) so budget calculations reflect elapsed time.
    await vi.advanceTimersByTimeAsync(Math.min(cost, timeoutMs));
    if (explicitTimeoutText && cost >= timeoutMs) {
      throw new Error(explicitTimeoutText);
    }
    if (index <= syntaxFailUpTo) {
      throw new Error("You have an error in your SQL syntax near DESC");
    }
    if (cost >= timeoutMs) {
      // Simulate a timeout by text pattern
      throw new Error(`Catalog connection/query timed out after ${timeoutMs}ms`);
    }
    return { rows: [["id", "bigint", "NO", "PRI", ""]], truncated: false };
  };
  return { run, calls };
}

function makeChannel(costsMsPerSql: number[], syntaxFailUpTo = -1) {
  const { run, calls } = makeFakeChannel(costsMsPerSql, syntaxFailUpTo);
  return {
    calls,
    close() { /* noop */ },
    run
  };
}

function makeTimeoutChannel(explicitText: string) {
  const calls: { sql: string; timeoutMs: number }[] = [];
  const run: ChannelRun = async (sql: string, options) => {
    const timeoutMs = options.timeoutMs ?? 8_000;
    calls.push({ sql, timeoutMs });
    await vi.advanceTimersByTimeAsync(timeoutMs);
    throw new Error(explicitText);
  };
  return { calls, close() { /* noop */ }, run };
}

describe("EC-14–EC-17 F02 external catalog probe classifier (fake timers)", () => {
  it("EC-14: slow first syntax refusal (7100ms) → continues probing, reads column", async () => {
    vi.useFakeTimers();
    const ch = makeChannel([7100, 100, 100], 1);
    const read = await readSchemaColumns("/isolated", "hive-probe", "app", {
      tables: ["orders"],
      mode: "per-table",
      callBudgetMs: 10_000,
      requestTimeoutMs: 20_000,
      readConnectionsImpl: async () => [hiveConn],
      openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
    });
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && read.columns.length).toBeGreaterThan(0);
    // Not deferred
    expect(read.status === "ok" && (read.deferred ?? [])).toHaveLength(0);
    // At least 2 probes attempted (first two failed, third succeeded)
    expect(ch.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("EC-15 (read-layer): three probes [7100,7100,7100], budget-compressed → result must be deferred", async () => {
    vi.useFakeTimers();
    // First probe: 7100ms of 10000ms budget used. Remaining = ~2900ms < PER_TABLE_TIMEOUT_MS=8000ms.
    // Second probe gets timeoutMs=min(8000, 2900)=2900 (budget-capped). Advance 2900ms → timeout.
    // With classifyProbeFailure: isBudgetCapped=true + no explicit timeout text in syntax error
    // But wait: with the channel, budget-capped probe throws syntax error (not timeout text).
    // So classifyProbeFailure sees: no explicit timeout, no connection failure → "unreadable".
    // But remaining will be very low after the second probe, and the third probe should be deferred
    // via the remaining <= 50 check.
    // Let's make the channel simulate timeout when cost >= timeoutMs by throwing explicit text:
    const calls: { sql: string; timeoutMs: number }[] = [];
    const run: ChannelRun = async (sql, options) => {
      const index = calls.length;
      const timeoutMs = options.timeoutMs ?? 8_000;
      calls.push({ sql, timeoutMs });
      const cost = 7100;
      await vi.advanceTimersByTimeAsync(Math.min(cost, timeoutMs));
      if (cost >= timeoutMs) {
        // Budget-capped: explicit timeout signal from driver
        throw new Error(`Catalog connection/query timed out after ${timeoutMs}ms`);
      }
      throw new Error("You have an error in your SQL syntax");
    };
    const ch = { calls, close() { /* noop */ }, run };
    const read = await readSchemaColumns("/isolated", "hive-probe", "app", {
      tables: ["orders"],
      mode: "per-table",
      callBudgetMs: 10_000,
      requestTimeoutMs: 20_000,
      readConnectionsImpl: async () => [hiveConn],
      openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
    });
    // Result must be deferred (not a failure, not an empty success)
    expect(read.status).toBe("ok");
    expect(read.status === "ok" && (read.deferred ?? [])).toContain("orders");
    // Not in columns
    expect(read.status === "ok" && read.columns.map((c) => c.table)).not.toContain("orders");
  });

  it("EC-16: explicit timeout signal + full PER_TABLE_TIMEOUT_MS → 1 probe, reason=timeout (应绿对照)", async () => {
    vi.useFakeTimers();
    const ch = makeTimeoutChannel("Catalog connection/query timed out after 8000ms");
    const read = await readSchemaColumns("/isolated", "hive-probe", "app", {
      tables: ["orders"],
      mode: "per-table",
      callBudgetMs: 20_000, // generous budget so not budget-capped
      requestTimeoutMs: 30_000,
      readConnectionsImpl: async () => [hiveConn],
      openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
    });
    expect(read.status).toBe("ok");
    // Should be a rejection with reason=timeout (not deferred)
    const rejections = read.status === "ok" ? (read.rejections ?? []) : [];
    expect(rejections).toHaveLength(1);
    expect(rejections[0]?.reason).toBe("timeout");
    // Only 1 probe attempted (terminal)
    expect(ch.calls.length).toBe(1);
    // Not deferred
    expect(read.status === "ok" && (read.deferred ?? [])).toHaveLength(0);
  });

  it.each([
    ["timeout-1501", 8000 - 1501],
    ["timeout-1500", 8000 - 1500],
    ["timeout-1",    8000 - 1],
    ["timeout",      8000],
  ])("EC-17: latency=%s (%i ms) is NOT a timeout — continues to next probe and reads column", async (_name, latencyMs) => {
    vi.useFakeTimers();
    // All probes return a syntax error after `latencyMs` ms. Post-fix: NOT classified as timeout.
    // We use a generous budget (30s) so no budget-capping occurs.
    const calls: { sql: string; timeoutMs: number }[] = [];
    let n = 0;
    const run: ChannelRun = async (sql, options) => {
      const index = n++;
      const timeoutMs = options.timeoutMs ?? 8_000;
      calls.push({ sql, timeoutMs });
      await vi.advanceTimersByTimeAsync(latencyMs);
      if (index < 2) {
        throw new Error("You have an error in your SQL syntax");
      }
      // Third probe succeeds
      return { rows: [["id", "bigint", "NO", "PRI", ""]], truncated: false };
    };
    const ch = { calls, close() { /* noop */ }, run };
    const read = await readSchemaColumns("/isolated", "hive-probe", "app", {
      tables: ["orders"],
      mode: "per-table",
      callBudgetMs: 30_000, // generous budget so no budget-capping
      requestTimeoutMs: 60_000,
      readConnectionsImpl: async () => [hiveConn],
      openChannelImpl: async () => ch as unknown as import("../metadata-channel").MetadataChannel
    });
    // After the fix, the third probe must succeed
    expect(read.status).toBe("ok");
    const readColumns = read.status === "ok" ? read.columns : [];
    // Should have read the column (from the third probe)
    expect(readColumns.length).toBeGreaterThan(0);
    // Not in rejections with reason=timeout
    const rejections = read.status === "ok" ? (read.rejections ?? []) : [];
    const timeoutRejection = rejections.find((r) => r.reason === "timeout");
    expect(timeoutRejection).toBeUndefined();
    // All 3 probes should be attempted
    expect(ch.calls.length).toBe(3);
  });
});
