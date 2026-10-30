/**
 * Lucy v0.25 — P0-4 对账上下文（E2 / E3）单元测试。
 *
 * 覆盖：
 *   - 规范化筛选（缺失值显式为 null，不静默丢弃字段）
 *   - 统一时间窗（左闭右开，固定时区）
 *   - 账本上界 S 的**唯一正确来源**是 canonical ledger（不得取投影自身序号）
 *   - 快照标识稳定且随筛选 / 上界变化
 *   - 投影追平：追平成功 / 超时失败关闭 / 账本不可用
 *   - 上下文冻结（同一次查询的明细、汇总、CSV 共用同一份）
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RECONCILIATION_SCHEMA_VERSION,
  buildReconciliationTimeRange,
  captureLedgerWatermarkSeq,
  computeReconciliationSnapshotId,
  createReconciliationContext,
  normalizeReconciliationFilter,
  resolveReconciliationWindowHours,
  waitUntilProjectionCovers,
  withFrozenAuditSnapshot,
  type Completeness
} from "../admin/reconciliation-context";
import { openSecurityStore, type SecurityStore } from "../security/store";
import type { SecurityResult } from "../security/types";

function unwrap<T>(result: SecurityResult<T>): T {
  if (!result.ok) throw new Error(`${result.code}/${result.reason}: ${result.message}`);
  return result.value;
}

let root: string;
let store: SecurityStore;
let target: Database.Database;
let clock = 1_000;

function emptyCompleteness(): Completeness {
  return {
    complete: true,
    combined_complete: true,
    dataScope: { ok: true, reason: null },
    associationQuality: {
      confirmed: 0,
      candidate: 0,
      unassigned: 0,
      conflict: 0,
      legacy_unverified: 0
    },
    clientCoverage: { observed: false, gapWindows: [], unknownReason: null },
    integrityVerification: { fileHashOk: true, relationCheckOk: true },
    reasons: []
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "lucy-reconciliation-context-"));
  await writeFile(path.join(root, "ktx.yaml"), "connections: {}\n", "utf8");
  store = unwrap(openSecurityStore(root, { now: () => ++clock }));
  target = new Database(path.join(root, "audit.sqlite"));
});

afterEach(async () => {
  target.close();
  store.close();
  await rm(root, { recursive: true, force: true });
});

describe("normalizeReconciliationFilter", () => {
  it("缺失值显式为 null，空白字符串视为缺失", () => {
    const filter = normalizeReconciliationFilter({ user: "  ", tool: "lucy_query" });
    expect(filter.user).toBeNull();
    expect(filter.tool).toBe("lucy_query");
    expect(filter.turnId).toBeNull();
    expect(filter.includeProtocol).toBe(false);
  });

  it("includeProtocol 只接受 true / 1", () => {
    expect(normalizeReconciliationFilter({ includeProtocol: "true" }).includeProtocol).toBe(true);
    expect(normalizeReconciliationFilter({ includeProtocol: "1" }).includeProtocol).toBe(true);
    expect(normalizeReconciliationFilter({ includeProtocol: "yes" }).includeProtocol).toBe(false);
    expect(normalizeReconciliationFilter({ includeProtocol: "0" }).includeProtocol).toBe(false);
  });
});

describe("buildReconciliationTimeRange", () => {
  it("缺省回落到默认窗口，左闭右开", () => {
    const now = Date.parse("2026-10-25T00:00:00.000Z");
    const range = buildReconciliationTimeRange(normalizeReconciliationFilter({}), now, 24);
    expect(range.from).toBe("2026-10-24T00:00:00.000Z");
    expect(range.to).toBe("2026-10-25T00:00:00.000Z");
    expect(range.timezone).toBe("Asia/Shanghai");
  });

  it("显式 since / until 优先", () => {
    const now = Date.parse("2026-10-25T00:00:00.000Z");
    const filter = normalizeReconciliationFilter({
      since: "2026-10-01T00:00:00.000Z",
      until: "2026-10-02T00:00:00.000Z"
    });
    const range = buildReconciliationTimeRange(filter, now);
    expect(range.from).toBe("2026-10-01T00:00:00.000Z");
    expect(range.to).toBe("2026-10-02T00:00:00.000Z");
  });
});

describe("resolveReconciliationWindowHours", () => {
  it("缺省与空白都是 168，只接受 24 / 168 / 720", () => {
    expect(resolveReconciliationWindowHours({})).toEqual({ ok: true, windowHours: 168 });
    expect(resolveReconciliationWindowHours({ hours: "  " })).toEqual({ ok: true, windowHours: 168 });
    expect(resolveReconciliationWindowHours({ hours: "24" })).toEqual({ ok: true, windowHours: 24 });
    expect(resolveReconciliationWindowHours({ hours: "720" })).toEqual({ ok: true, windowHours: 720 });
    expect(resolveReconciliationWindowHours({ hours: "15" })).toEqual({
      ok: false,
      code: "RECONCILIATION_WINDOW_HOURS_INVALID"
    });
  });

  it("since 或 until 已给出时忽略 hours，包括非法值", () => {
    expect(
      resolveReconciliationWindowHours({
        hours: "15",
        since: "2026-10-01T00:00:00.000Z"
      })
    ).toEqual({ ok: true, windowHours: 168 });
    expect(
      resolveReconciliationWindowHours({
        hours: "24",
        until: "2026-10-02T00:00:00.000Z"
      })
    ).toEqual({ ok: true, windowHours: 168 });
  });
});

describe("captureLedgerWatermarkSeq", () => {
  it("S 来自 canonical ledger 的已提交上界", () => {
    store.appendEvent({
      eventId: "e1",
      operationId: "op-1",
      phase: "prepare",
      actor: "admin",
      actorType: "ui_admin"
    });
    store.appendEvent({
      eventId: "e2",
      operationId: "op-1",
      phase: "commit",
      actor: "admin",
      actorType: "ui_admin"
    });
    const captured = captureLedgerWatermarkSeq(store);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.watermarkSeq).toBe(2);
  });

  it("账本无事件时上界为 0（不是投影自身序号）", () => {
    // 投影表里写入更高 id 的行，S 仍必须是账本上界。
    target.exec("CREATE TABLE IF NOT EXISTS security_operation_projection (operation_id TEXT PRIMARY KEY)");
    target.prepare("INSERT INTO security_operation_projection (operation_id) VALUES (?)").run("x");
    const captured = captureLedgerWatermarkSeq(store);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;
    expect(captured.watermarkSeq).toBe(0);
  });
});

describe("computeReconciliationSnapshotId", () => {
  it("相同输入得到相同标识；筛选或上界变化则变化", () => {
    const filter = normalizeReconciliationFilter({ user: "agent-a" });
    const a = computeReconciliationSnapshotId({
      watermarkSeq: 10,
      filter,
      rowBoundAccessLogId: 42,
      matchedRowCount: 7
    });
    const b = computeReconciliationSnapshotId({
      watermarkSeq: 10,
      filter,
      rowBoundAccessLogId: 42,
      matchedRowCount: 7
    });
    expect(a).toBe(b);
    expect(a).toHaveLength(64);

    const c = computeReconciliationSnapshotId({
      watermarkSeq: 11,
      filter,
      rowBoundAccessLogId: 42,
      matchedRowCount: 7
    });
    expect(c).not.toBe(a);
  });
});

describe("createReconciliationContext", () => {
  it("冻结上下文并带上版本与 S", () => {
    const filter = normalizeReconciliationFilter({ user: "agent-a" });
    const context = createReconciliationContext({
      instanceId: "lucy-test",
      filter,
      timeRange: { from: "a", to: "b", timezone: "Asia/Shanghai" },
      watermarkSeq: 12,
      snapshotId: "snap",
      rowBoundAccessLogId: 99,
      metricUnit: "tool_call",
      completeness: emptyCompleteness(),
      auditCoverage: {
        version: "not_connected",
        seqUpperBound: 12,
        checks: [],
        allConclusive: false,
        combined: "unknown"
      }
    });

    expect(context.schemaVersion).toBe(RECONCILIATION_SCHEMA_VERSION);
    expect(context.watermarkSeq).toBe(12);
    expect(context.derivationVersion).toBe("v2p5-1");
    expect(context.classificationVersion).toBe("v2p5-1");
    // S05 口径单位名由唯一映射表得出（供 P0-1 `summarize()` 使用）。
    expect(context.s05MetricUnit).toBe("tool_call");
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => {
      (context as { watermarkSeq: number }).watermarkSeq = 13;
    }).toThrow();
  });
});

describe("waitUntilProjectionCovers", () => {
  it("投影追平到 S 时返回 covered", async () => {
    store.appendEvent({
      eventId: "e1",
      operationId: "op-1",
      phase: "prepare",
      actor: "admin",
      actorType: "ui_admin"
    });
    const captured = captureLedgerWatermarkSeq(store);
    expect(captured.ok).toBe(true);
    if (!captured.ok) return;

    const result = await waitUntilProjectionCovers({
      store,
      target,
      watermarkSeq: captured.watermarkSeq,
      deadlineMs: 1_000,
      pollIntervalMs: 1
    });
    expect(result.covered).toBe(true);
    expect(result.reason).toBe("covered");
    expect(result.cursor).toBeGreaterThanOrEqual(captured.watermarkSeq);
  });

  it("投影未追平时超时失败关闭（不得静默换用较新数据）", async () => {
    const result = await waitUntilProjectionCovers({
      store,
      target,
      watermarkSeq: 999,
      deadlineMs: 0,
      pollIntervalMs: 1,
      now: () => clock
    });
    expect(result.covered).toBe(false);
    expect(result.reason).toBe("deadline_exceeded");
    expect(result.watermarkSeq).toBe(999);
  });

  it("账本不可用时返回 store_unavailable，不伪造上界", async () => {
    const broken = {
      maxEventSeq: () => ({ ok: false, code: "X", reason: "io_error", message: "down" }),
      listEventsAfter: () => ({ ok: true, value: [] })
    } as unknown as SecurityStore;
    const result = await waitUntilProjectionCovers({
      store: broken,
      target,
      watermarkSeq: 1,
      deadlineMs: 10,
      pollIntervalMs: 1
    });
    expect(result.covered).toBe(false);
    expect(result.reason).toBe("store_unavailable");
  });
});

describe("withFrozenAuditSnapshot", () => {
  it("快照内看不到其他连接的并发写入（审计库为 WAL）", () => {
    target.pragma("journal_mode = WAL");
    target.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)");
    target.prepare("INSERT INTO t (v) VALUES (?)").run("a");
    const other = new Database(path.join(root, "audit.sqlite"));

    try {
      const seen = withFrozenAuditSnapshot(target, () => {
        const before = target.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number };
        other.prepare("INSERT INTO t (v) VALUES (?)").run("b");
        const after = target.prepare("SELECT COUNT(*) AS c FROM t").get() as { c: number };
        return { before: before.c, after: after.c };
      });
      expect(seen.before).toBe(1);
      expect(seen.after).toBe(1);
    } finally {
      other.close();
    }
  });
});
