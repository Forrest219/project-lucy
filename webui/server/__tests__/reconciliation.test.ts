/**
 * Lucy v0.25 — P0-4 问询详情（E4）与 Token 对账（E6）单元测试。
 *
 * 覆盖 Spec 验收矩阵中的可静态验证部分：
 *   - V01 完整表身份（数量与去重集合一致，无「等 N 个」断点）
 *   - V02 同名表位于两个连接／Schema **不合并**
 *   - V03 缺表身份进未知桶，不猜表、不填空数组冒充无访问
 *   - V04 只有真实 budget_stopped 凭据才显示预算用尽
 *   - V05 调用数 ≠ 尝试数；attempt_id 缺失时尝试数为 null 而非 0
 *   - V06 已确认／候选分列；握手不进业务问询分母
 *   - V07／V08 Token 配置数与活跃数、四类差异集合、差异不一律报「数据异常」
 *   - 集合闭合：八桶合计等于集合总数
 */

import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import {
  buildInquiryReconciliation,
  configureReconciliationPorts,
  paginateByKey,
  reconcileTokens,
  resetReconciliationPortsForTests,
  type PrimaryStatusPort,
  type ReconciliationFacts,
  type ReconciliationUnit
} from "../admin/reconciliation";
import {
  createReconciliationContext,
  normalizeReconciliationFilter,
  type ReconciliationContext
} from "../admin/reconciliation-context";

// ─── 测试夹具 ────────────────────────────────────────────────────────────────

function makeContext(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
  const filter = normalizeReconciliationFilter({});
  return createReconciliationContext({
    instanceId: "lucy-test",
    filter,
    timeRange: {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-25T00:00:00.000Z",
      timezone: "Asia/Shanghai"
    },
    watermarkSeq: 100,
    snapshotId: "snap-1",
    rowBoundAccessLogId: 10_000,
    metricUnit: "tool_call",
    completeness: {
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
    },
    auditCoverage: {
      version: "not_connected",
      seqUpperBound: 100,
      checks: [],
      allConclusive: false,
      combined: "unknown"
    },
    ...overrides
  });
}

/** 建一张与生产同形的最小审计库。 */
function makeDb(): Database.Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE access_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      user_id TEXT NOT NULL,
      tool TEXT NOT NULL,
      request_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      decision_reason TEXT,
      error_detail TEXT,
      duration_ms INTEGER,
      response_row_count INTEGER,
      lucy_turn_id TEXT,
      lucy_session_id TEXT,
      token_hash_prefix TEXT,
      turn_wall_clock_ms INTEGER
    );
    CREATE TABLE access_log_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      access_log_id INTEGER NOT NULL,
      ts TEXT NOT NULL,
      connection_id TEXT,
      schema_name TEXT,
      source_name TEXT,
      physical_table TEXT NOT NULL,
      extraction_method TEXT NOT NULL,
      confidence TEXT NOT NULL
    );
    CREATE TABLE conversation_turns (
      turn_id TEXT PRIMARY KEY,
      session_id TEXT,
      question_preview TEXT,
      question_source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return db;
}

type AccessLogInput = {
  id?: number;
  ts?: string;
  tool?: string;
  turnId?: string | null;
  outcome?: string;
  decisionReason?: string | null;
  durationMs?: number;
  tokenPrefix?: string | null;
};

function insertCall(db: Database.Database, input: AccessLogInput): number {
  const info = db
    .prepare(
      `INSERT INTO access_log
       (ts, user_id, tool, request_id, outcome, decision_reason, duration_ms, lucy_turn_id, token_hash_prefix)
       VALUES (?, 'agent-a', ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.ts ?? "2026-10-10T10:00:00.000Z",
      input.tool ?? "lucy_query",
      `req-${input.id ?? 1}`,
      input.outcome ?? "ok",
      input.decisionReason ?? null,
      input.durationMs ?? 120,
      input.turnId ?? "turn-1",
      input.tokenPrefix ?? "sha256:aaa"
    );
  return Number(info.lastInsertRowid);
}

function insertSource(
  db: Database.Database,
  accessLogId: number,
  source: {
    connectionId?: string | null;
    schema?: string | null;
    name?: string | null;
    physicalTable: string;
  }
): void {
  db.prepare(
    `INSERT INTO access_log_sources
     (access_log_id, ts, connection_id, schema_name, source_name, physical_table, extraction_method, confidence)
     VALUES (?, '2026-10-10T10:00:00.000Z', ?, ?, ?, ?, 'catalog', 'high')`
  ).run(
    accessLogId,
    source.connectionId ?? null,
    source.schema ?? null,
    source.name ?? null,
    source.physicalTable
  );
}

function insertTurn(
  db: Database.Database,
  turnId: string,
  options: { source?: string; preview?: string | null; createdAt?: string } = {}
): void {
  db.prepare(
    `INSERT INTO conversation_turns (turn_id, session_id, question_preview, question_source, created_at)
     VALUES (?, 'sess-1', ?, ?, ?)`
  ).run(
    turnId,
    options.preview ?? null,
    options.source ?? "reported",
    options.createdAt ?? "2026-10-10T09:59:00.000Z"
  );
}

/** 端口：把 legacy outcome 映射成主状态（模拟 P0-1 接线后的行为）。 */
function legacyOutcomePort(): PrimaryStatusPort {
  return {
    connected: true,
    derive: (unit: ReconciliationUnit): ReconciliationFacts => {
      const budgetStopped = unit.legacyOutcome === "budget_stop";
      const denied = unit.legacyOutcome === "denied";
      const failed = unit.legacyOutcome === "error";
      return {
        primaryStatus: budgetStopped
          ? "budget_stopped"
          : denied
            ? "denied"
            : failed
              ? "failed"
              : "succeeded",
        conflict: false,
        authorization: denied ? "denied" : "allowed",
        execution: budgetStopped || denied ? "not_executed" : failed ? "failed" : "succeeded",
        delivery: "unknown",
        evidenceRefs: [`access_log:${unit.unitId}`],
        nullReasons: { delivery: "not_collected" }
      };
    }
  };
}

// ─── E4 问询详情 ─────────────────────────────────────────────────────────────

describe("buildInquiryReconciliation", () => {
  it("V01/V02 同名表位于两个连接／Schema 不合并，完整身份全部保留", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    const a = insertCall(db, { id: 1 });
    const b = insertCall(db, { id: 2 });
    insertSource(db, a, { connectionId: "mysql", schema: "sales", name: "orders", physicalTable: "sales.orders" });
    insertSource(db, b, { connectionId: "pg", schema: "sales", name: "orders", physicalTable: "sales.orders" });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.tables.complete).toHaveLength(2);
    expect(detail.tables.complete.map((t) => t.connectionId).sort()).toEqual(["mysql", "pg"]);
    expect(detail.tables.complete.map((t) => t.schema)).toEqual(["sales", "sales"]);
    expect(detail.tables.complete.map((t) => t.table)).toEqual(["orders", "orders"]);
    // 数量与去重集合一致，没有「等 N 个」信息断点。
    expect(detail.tables.complete.reduce((sum, t) => sum + t.callCount, 0)).toBe(2);
    db.close();
  });

  it("V03 缺表身份的调用进入独立未知桶，不猜表", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    const withSource = insertCall(db, { id: 1 });
    insertCall(db, { id: 2 }); // 无来源引用
    insertSource(db, withSource, {
      connectionId: "mysql",
      schema: "sales",
      name: "orders",
      physicalTable: "sales.orders"
    });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.tables.complete).toHaveLength(1);
    expect(detail.tables.unknownBucket.callCount).toBe(1);
    expect(detail.tables.unknownBucket.reason).toBe("not_collected");
    expect(detail.differences.some((d) => d.id === "calls_without_source_identity")).toBe(true);
    db.close();
  });

  it("V03 来源引用缺连接／Schema 时单列，不并入完整身份集合", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    const call = insertCall(db, { id: 1 });
    insertSource(db, call, { connectionId: null, schema: null, name: null, physicalTable: "orders" });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.tables.complete).toHaveLength(0);
    expect(detail.differences.some((d) => d.id === "source_identity_incomplete")).toBe(true);
    db.close();
  });

  it("V05 attempt_id 缺失时尝试数为 null + 原因，不填 0；调用数不等于尝试数", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1 });
    insertCall(db, { id: 2 });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.calls.total).toBe(2);
    expect(detail.calls.attemptCount).toBeNull();
    expect(detail.calls.attemptCountNullReason).toBe("not_collected");
    expect(detail.calls.items.every((c) => c.attemptIdNullReason === "not_collected")).toBe(true);
    db.close();
  });

  it("V04 只有真实 budget_stopped 凭据才显示预算用尽", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1, outcome: "ok" });

    const normal = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });
    expect(normal.budget.exhausted).toBe(false);
    expect(normal.budget.status).toBe("not_exhausted");
    expect(normal.budget.continuable).toBeNull();

    insertCall(db, { id: 2, outcome: "budget_stop", decisionReason: "question_budget_exhausted" });
    const stopped = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });
    expect(stopped.budget.exhausted).toBe(true);
    expect(stopped.budget.status).toBe("budget_stopped");
    expect(stopped.budget.continuable).toBe(true);
    expect(stopped.budget.terminationEventRefs.length).toBe(1);
    db.close();
  });

  it("V06 已确认与候选调用数分列；握手不进业务问询分母", () => {
    const db = makeDb();
    db.exec("ALTER TABLE access_log ADD COLUMN association_status TEXT");
    insertTurn(db, "turn-1");
    const confirmed = insertCall(db, { id: 1, tool: "lucy_query" });
    const candidate = insertCall(db, { id: 2, tool: "lucy_query" });
    insertCall(db, { id: 3, tool: "initialize" }); // 协议握手
    db.prepare("UPDATE access_log SET association_status = 'confirmed' WHERE id = ?").run(confirmed);
    db.prepare("UPDATE access_log SET association_status = 'candidate' WHERE id = ?").run(candidate);

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.calls.total).toBe(2); // 握手不计入业务问询分母
    expect(detail.calls.confirmedCount).toBe(1);
    expect(detail.calls.candidateCount).toBe(1);
    expect(detail.exclusions.some((e) => e.id === "protocol_events_excluded_from_business_denominator")).toBe(true);
    expect(detail.differences.some((d) => d.id === "candidate_association_not_upgraded")).toBe(true);
    db.close();
  });

  it("集合闭合：八桶合计等于集合总数", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1, outcome: "ok" });
    insertCall(db, { id: 2, outcome: "error" });
    insertCall(db, { id: 3, outcome: "denied" });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    const total = Object.values(detail.results.bucketCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(detail.results.bucketTotal);
    expect(detail.results.closureVerified).toBe(true);
    expect(detail.results.bucketCounts.succeeded).toBe(1);
    expect(detail.results.bucketCounts.failed).toBe(1);
    expect(detail.results.bucketCounts.denied).toBe(1);
    db.close();
  });

  it("集合闭合按声明单位（tool_call）：协议行不混入工具调用桶", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1, outcome: "ok" });
    insertCall(db, { id: 2, outcome: "error" });
    insertCall(db, { id: 3, tool: "initialize" }); // 协议请求：另一个计量单位

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    const total = Object.values(detail.results.bucketCounts).reduce((a, b) => a + b, 0);
    expect(total).toBe(detail.calls.total); // 只含 tool_call
    expect(detail.results.closureVerified).toBe(true);
    expect(detail.results.bucketCounts.succeeded).toBe(1);
    expect(detail.results.bucketCounts.failed).toBe(1);
    db.close();
  });

  it("未接入派生端口时不产生任何已核验结论", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1, outcome: "ok" });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: unconnectedPort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.results.factsSource).toBe("not_connected");
    expect(detail.results.primaryStatus).toBe("unknown");
    expect(detail.results.primaryStatusNullReason).toBe("not_supported");
    expect(detail.results.authorization).toBe("unknown");
    expect(detail.results.execution).toBe("unknown");
    expect(detail.results.delivery).toBe("unknown");
    // 旧 outcome 不推定成功。
    expect(detail.results.bucketCounts.succeeded).toBe(0);
    expect(detail.results.bucketCounts.unknown).toBe(1);
    db.close();
  });

  it("工具调用数不是用户轮次；客户端轮次不可观测时为 null + 原因", () => {
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1 });
    insertCall(db, { id: 2 });

    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });

    expect(detail.turns.toolCallCountIsNotUserTurns).toBe(true);
    expect(detail.turns.registeredInquiryTurns).toBe(1);
    expect(detail.turns.observableClientTurns).toBeNull();
    expect(detail.turns.observableClientTurnsNullReason).toBe("not_collected");
    db.close();
  });

  it("问询历时在缺起点时为 null + 原因，不填 0", () => {
    const db = makeDb();
    insertCall(db, { id: 1 }); // 无 conversation_turns → 无起点
    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });
    expect(detail.durations.inquiryDurationMs).toBeNull();
    expect(detail.durations.inquiryDurationNullReason).toBe("not_collected");
    db.close();
  });

  it("候选 turn 必须显式标识", () => {
    const db = makeDb();
    insertCall(db, { id: 1 }); // 无登记来源 → 未登记 → candidateTurn
    const detail = buildInquiryReconciliation({
      db,
      context: makeContext(),
      turnId: "turn-1",
      ports: { primaryStatus: legacyOutcomePort(), auditCoverage: resetAuditCoverage() }
    });
    expect(detail.inquiry.registrationSource).toBe("unregistered");
    expect(detail.inquiry.candidateTurn).toBe(true);
    expect(detail.inquiry.registrationSourceNullReason).toBe("not_collected");
    db.close();
  });
});

function unconnectedPort(): PrimaryStatusPort {
  return {
    connected: false,
    derive: () => ({
      primaryStatus: "unknown",
      conflict: false,
      authorization: "unknown",
      execution: "unknown",
      delivery: "unknown",
      evidenceRefs: [],
      nullReasons: {
        primaryStatus: "not_supported",
        authorization: "not_supported",
        execution: "not_supported",
        delivery: "not_supported"
      }
    })
  };
}

function resetAuditCoverage() {
  return {
    connected: false,
    summarizeCoverage: (context: ReconciliationContext) => ({
      version: "not_connected",
      seqUpperBound: context.watermarkSeq,
      checks: [],
      allConclusive: false,
      combined: "unknown" as const
    })
  };
}

// ─── E6 Token 对账 ──────────────────────────────────────────────────────────

describe("reconcileTokens", () => {
  const context = makeContext();

  it("V07 配置 5 个 Token、窗口内 3 个活跃：两数与差异集合可复算", () => {
    const configured = {
      capturedAt: "2026-10-25T00:00:00.000Z",
      configVersion: "v1",
      identityAmbiguity: false,
      available: true,
      tokens: ["t1", "t2", "t3", "t4", "t5"].map((identity) => ({
        identity,
        identityKind: "hash_prefix" as const,
        userId: "agent-a",
        label: identity,
        enabled: true,
        expired: false,
        createdAt: null
      }))
    };
    const active = ["t1", "t2", "t3"].map((identity) => ({
      identity,
      identityKind: "hash_prefix" as const,
      toolCallCount: 2,
      firstSeenAt: null,
      lastSeenAt: null
    }));

    const result = reconcileTokens({
      context,
      configured,
      active,
      unknownIdentity: [],
      protocolEventCount: 4
    });

    expect(result.configuredSnapshot.total).toBe(5);
    expect(result.activeWindow.identityCount).toBe(3);
    expect(result.activeWindow.protocolEventsExcluded).toBe(4);
    expect(result.activeWindow.metricUnit).toBe("tool_call");
    const notActive = result.differences.find((d) => d.id === "configured_not_active");
    expect(notActive?.count).toBe(2);
    expect(notActive?.identities.sort()).toEqual(["t4", "t5"]);
    expect(result.completeness.numerator).toBe(3);
    expect(result.completeness.denominator).toBe(5);
    expect(result.completeness.ratio).toBe(60);
  });

  it("V08 活跃数大于配置数时按差异原因解释，不一律报数据异常", () => {
    const configured = {
      capturedAt: "2026-10-25T00:00:00.000Z",
      configVersion: "v1",
      identityAmbiguity: false,
      available: true,
      tokens: [
        {
          identity: "t1",
          identityKind: "hash_prefix" as const,
          userId: "agent-a",
          label: null,
          enabled: true,
          expired: false,
          createdAt: null
        }
      ]
    };
    const active = ["t1", "legacy-t9"].map((identity) => ({
      identity,
      identityKind: "hash_prefix" as const,
      toolCallCount: 1,
      firstSeenAt: null,
      lastSeenAt: null
    }));

    const result = reconcileTokens({
      context,
      configured,
      active,
      unknownIdentity: [
        {
          reason: "unverifiable_historical_mapping" as const,
          callCount: 2,
          distinctRequestIds: 2,
          lastSeenAt: null
        }
      ],
      protocolEventCount: 0
    });

    expect(result.anomaly.activeGreaterThanConfigured).toBe(true);
    // 存在身份未核验时不得强行配平、不得判定对账失败。
    expect(result.anomaly.flagged).toBe(false);
    expect(result.anomaly.reason).toBe("active_greater_than_configured_is_not_by_itself_anomaly");
    expect(result.unknownIdentity.count).toBe(2);
    expect(result.differences.find((d) => d.id === "active_not_in_current_config")?.identities).toEqual([
      "legacy-t9"
    ]);
    expect(result.differences.find((d) => d.id === "identity_unverified")?.count).toBeGreaterThan(0);
  });

  it("已停用／删除单列一档", () => {
    const configured = {
      capturedAt: "2026-10-25T00:00:00.000Z",
      configVersion: "v1",
      identityAmbiguity: false,
      available: true,
      tokens: [
        {
          identity: "t-off",
          identityKind: "hash_prefix" as const,
          userId: "agent-a",
          label: null,
          enabled: false,
          expired: false,
          createdAt: null
        },
        {
          identity: "t-expired",
          identityKind: "hash_prefix" as const,
          userId: "agent-a",
          label: null,
          enabled: true,
          expired: true,
          createdAt: null
        }
      ]
    };
    const result = reconcileTokens({
      context,
      configured,
      active: [],
      unknownIdentity: [],
      protocolEventCount: 0
    });
    const disabled = result.differences.find((d) => d.id === "disabled_or_deleted");
    expect(disabled?.identities.sort()).toEqual(["t-expired", "t-off"]);
    expect(disabled?.reasons.sort()).toEqual(["agent_disabled", "expired"]);
    expect(result.configuredSnapshot.enabled).toBe(0);
    expect(result.configuredSnapshot.disabled).toBe(1);
    expect(result.configuredSnapshot.expired).toBe(1);
  });

  it("活跃但当前配置不可见与身份未核验是两类，不合并", () => {
    const configured = {
      capturedAt: "2026-10-25T00:00:00.000Z",
      configVersion: "v1",
      identityAmbiguity: false,
      available: true,
      tokens: []
    };
    const result = reconcileTokens({
      context,
      configured,
      active: [
        {
          identity: "known-but-rotated",
          identityKind: "hash_prefix" as const,
          toolCallCount: 1,
          firstSeenAt: null,
          lastSeenAt: null
        }
      ],
      unknownIdentity: [],
      protocolEventCount: 0
    });
    expect(result.differences.find((d) => d.id === "active_not_in_current_config")?.identities).toEqual([
      "known-but-rotated"
    ]);
    // 身份可见但不在配置快照中 → 归第 2 类，不重复计入「身份未核验」。
    expect(result.differences.find((d) => d.id === "identity_unverified")?.count).toBe(0);
  });

  it("D=0 时不显示 0% 或 100% 的确定结论", () => {
    const result = reconcileTokens({
      context,
      configured: {
        capturedAt: "2026-10-25T00:00:00.000Z",
        configVersion: null,
        identityAmbiguity: false,
        available: true,
        tokens: []
      },
      active: [],
      unknownIdentity: [],
      protocolEventCount: 0
    });
    expect(result.completeness.denominator).toBe(0);
    expect(result.completeness.ratio).toBeNull();
    expect(result.completeness.ratioNullReason).toBe("not_applicable");
  });

  it("配置读不到时不得当成「配置了 0 个 Token」", () => {
    // 缺陷：配置读取失败被当成零 Token —— 配置计数显示 0、依赖配置的差异集合
    // 显示「0 差异」、并可能把全部活跃身份误判成「活跃但当前配置不可见」。
    const result = reconcileTokens({
      context,
      configured: {
        capturedAt: "2026-10-25T00:00:00.000Z",
        configVersion: null,
        identityAmbiguity: false,
        available: false,
        unavailableReason: "Error: access.yaml not found",
        tokens: []
      },
      active: [
        {
          identity: "t-live",
          identityKind: "hash_prefix",
          toolCallCount: 3,
          firstSeenAt: null,
          lastSeenAt: null
        }
      ],
      unknownIdentity: [],
      protocolEventCount: 0
    });

    // 1) 配置计数不可观测 → null，**不是 0**。
    expect(result.configuredSnapshot.available).toBe(false);
    expect(result.configuredSnapshot.unavailableReason).toBe("Error: access.yaml not found");
    expect(result.configuredSnapshot.total).toBeNull();
    expect(result.configuredSnapshot.enabled).toBeNull();
    expect(result.configuredSnapshot.disabled).toBeNull();
    expect(result.configuredSnapshot.expired).toBeNull();

    // 2) 比率不得显示 0% / 100%。
    expect(result.completeness.denominator).toBeNull();
    expect(result.completeness.ratio).toBeNull();
    expect(result.completeness.ratioNullReason).toBe("not_collected");

    // 3) 差异不可观测 ≠ 存在差异：不得判定对账失败。
    expect(result.anomaly.flagged).toBe(false);
    expect(result.anomaly.reason).toBe("configuration_not_observable");
    expect(result.anomaly.activeGreaterThanConfigured).toBe(false);

    // 4) 三个依赖配置的差异集合不可观测（count 为 null + 原因），不得写成 0。
    for (const id of [
      "configured_not_active",
      "active_not_in_current_config",
      "disabled_or_deleted"
    ] as const) {
      const difference = result.differences.find((d) => d.id === id);
      expect(difference?.count).toBeNull();
      expect(difference?.nullReason).toBe("not_collected");
      expect(difference?.identities).toEqual([]);
    }

    // 5) 不依赖配置的集合仍然可观测。
    const unverified = result.differences.find((d) => d.id === "identity_unverified");
    expect(unverified?.count).toBe(0);
    expect(unverified?.nullReason).toBeNull();
    // 活跃窗口本身来自审计事实，照常计数。
    expect(result.activeWindow.identityCount).toBe(1);
    expect(result.activeWindow.toolCallCount).toBe(3);
  });

  it("身份基础不一致时不判定对账失败（不强行配平）", () => {
    const result = reconcileTokens({
      context,
      configured: {
        capturedAt: "2026-10-25T00:00:00.000Z",
        configVersion: "v1",
        identityAmbiguity: true,
        available: true,
        tokens: []
      },
      active: [
        {
          identity: "x",
          identityKind: "hash_prefix",
          toolCallCount: 1,
          firstSeenAt: null,
          lastSeenAt: null
        }
      ],
      unknownIdentity: [],
      protocolEventCount: 0
    });
    expect(result.anomaly.flagged).toBe(false);
    expect(result.configuredSnapshot.identityAmbiguity).toBe(true);
  });
});

// ─── 游标分页 ────────────────────────────────────────────────────────────────

describe("paginateByKey", () => {
  it("声明是否完整，不把当前页完整冒充全部匹配完整", () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => ({ id }));
    const page1 = paginateByKey({ items, keyOf: (item) => item.id, cursor: null, limit: 2 });
    expect(page1.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(page1.complete).toBe(false);
    expect(page1.totalMatched).toBe(5);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = paginateByKey({
      items,
      keyOf: (item) => item.id,
      cursor: page1.nextCursor,
      limit: 2
    });
    expect(page2.items.map((i) => i.id)).toEqual(["c", "d"]);
    expect(page2.complete).toBe(false);

    const page3 = paginateByKey({
      items,
      keyOf: (item) => item.id,
      cursor: page2.nextCursor,
      limit: 2
    });
    expect(page3.items.map((i) => i.id)).toEqual(["e"]);
    expect(page3.complete).toBe(true);
    expect(page3.nextCursor).toBeNull();
  });

  it("分页不丢重", () => {
    const items = ["a", "b", "c"].map((id) => ({ id }));
    const page1 = paginateByKey({ items, keyOf: (item) => item.id, cursor: null, limit: 2 });
    const page2 = paginateByKey({
      items,
      keyOf: (item) => item.id,
      cursor: page1.nextCursor,
      limit: 2
    });
    const all = [...page1.items, ...page2.items].map((i) => i.id);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("configureReconciliationPorts", () => {
  it("注入端口后可切回未接入默认", () => {
    configureReconciliationPorts({ primaryStatus: legacyOutcomePort() });
    resetReconciliationPortsForTests();
    const db = makeDb();
    insertTurn(db, "turn-1");
    insertCall(db, { id: 1 });
    const detail = buildInquiryReconciliation({ db, context: makeContext(), turnId: "turn-1" });
    expect(detail.results.factsSource).toBe("not_connected");
    db.close();
  });
});
