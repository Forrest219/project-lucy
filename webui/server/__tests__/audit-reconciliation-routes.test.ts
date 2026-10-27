/**
 * Lucy v0.25 — P0-4 对账只读 API（E10 / E11）单元测试。
 *
 * 覆盖：
 *   - 三端点注册与路径正确
 *   - **只读**：对账读取不写审计事实源（只写 meta-audit 到 canonical ledger）
 *   - meta-audit 前置：账本不可用 / meta-audit 写入失败 → 拒绝读取，不静默放行
 *   - actor 不可解析 → 401
 *   - 投影未追平时正式模式 409（不静默换用较新数据）
 *   - 游标分页声明是否完整
 *   - 响应携带统一 `reconciliationContext`（同一 S / 快照 / 规则版本）
 */

import Fastify from "fastify";
import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openSecurityStore, type SecurityStore } from "../security/store";
import type { SecurityEvent, SecurityResult } from "../security/types";
import {
  configureReconciliationPorts,
  resetReconciliationPortsForTests
} from "../admin/reconciliation";
import { createProductionAuditCoveragePort } from "../admin/reconciliation-ports";

const auditDb = new Database(":memory:");

let projectRoot: string;
/** 账本句柄（SecurityResult 形态，与 `openSecurityStore` 一致）。 */
let store: SecurityResult<SecurityStore>;

/** 可被测试改写的账本句柄（默认是真实账本）。 */
let storeResult: SecurityResult<SecurityStore>;

const trustedActorFromRequestMock = vi.fn(() => ({
  actorId: "admin-1",
  actorType: "ui_admin" as const,
  accountUid: null,
  role: "owner" as const,
  authMode: "required" as const,
  sessionId: null,
  requestId: null,
  actorIp: null
}));

vi.mock("../admin/audit.js", () => ({
  getAuditDb: async () => auditDb
}));

vi.mock("../security/instance.js", () => ({
  getSecurityStore: async () => storeResult
}));

vi.mock("../security/request-actor.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    trustedActorFromRequest: trustedActorFromRequestMock
  };
});

const { registerAuditReconciliationRoutes, canonicalConfiguredHash } = await import(
  "../admin/audit-reconciliation-routes.js"
);

function makeApp() {
  const app = Fastify({ logger: false });
  registerAuditReconciliationRoutes(app);
  return app;
}

/** 读取账本中的全部事件（验证 meta-audit 确实落账）。 */
function ledgerEvents(): SecurityEvent[] {
  if (!store.ok) return [];
  const result = store.value.listEventsAfter(0, 500);
  return result.ok ? result.value : [];
}

/** 重建与生产同形的最小审计库结构。 */
function resetAuditSchema(): void {
  auditDb.exec("DROP TABLE IF EXISTS access_log");
  auditDb.exec("DROP TABLE IF EXISTS access_log_sources");
  auditDb.exec("DROP TABLE IF EXISTS conversation_turns");
  auditDb.exec(`
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
      attempt_id TEXT,
      parent_attempt_id TEXT,
      association_status TEXT,
      effective_turn_id TEXT,
      original_turn_id TEXT,
      event_type TEXT,
      credential_principal_id TEXT,
      turn_wall_clock_ms INTEGER,
      ledger_seq INTEGER
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
}

beforeEach(async () => {
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "lucy-reconciliation-routes-"));
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  const opened = openSecurityStore(projectRoot, { now: () => Date.now() });
  if (!opened.ok) throw new Error("security store unavailable");
  store = opened;
  // 账本上界 S = 1。
  store.value.appendEvent({
    eventId: "ledger-1",
    operationId: "op-1",
    phase: "prepare",
    actor: "admin",
    actorType: "ui_admin"
  });
  storeResult = { ok: true, value: store.value };
  resetAuditSchema();
  trustedActorFromRequestMock.mockImplementation(
    () =>
      ({
        actorId: "admin-1",
        actorType: "ui_admin",
        accountUid: null,
        role: "owner",
        authMode: "required",
        sessionId: null,
        requestId: null,
        actorIp: null
      }) as never
  );
});

afterEach(async () => {
  if (store.ok) store.value.close();
  await rm(projectRoot, { recursive: true, force: true });
});

describe("canonicalConfiguredHash", () => {
  it("三种配置形态归一到与运行时一致的身份前缀", () => {
    const hex = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const expected = "sha256:abcdef012345"; // "sha256:" 7 字符 + 12 位 hex = 19 字符
    expect(canonicalConfiguredHash(`sha256:${hex}`)?.slice(0, 19)).toBe(expected);
    expect(canonicalConfiguredHash(hex)?.slice(0, 19)).toBe(expected);
    expect(canonicalConfiguredHash({ sha256: hex })?.slice(0, 19)).toBe(expected);
  });

  it("无法识别或为空的形态返回 null（不补造身份）", () => {
    expect(canonicalConfiguredHash(null)).toBeNull();
    expect(canonicalConfiguredHash(undefined)).toBeNull();
    expect(canonicalConfiguredHash("")).toBeNull();
    expect(canonicalConfiguredHash("   ")).toBeNull();
    expect(canonicalConfiguredHash({ md5: "x" })).toBeNull();
    expect(canonicalConfiguredHash(123)).toBeNull();
  });
});

describe("registerAuditReconciliationRoutes", () => {
  it("注册三个只读对账端点", async () => {
    const app = makeApp();
    const routes = app
      .printRoutes({ commonPrefix: false })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("/api/admin/audit/reconciliation"))
      .join("\n");
    expect(routes).toContain("/api/admin/audit/reconciliation/inquiries/:turnId");
    expect(routes).toContain("/api/admin/audit/reconciliation/usage");
    expect(routes).toContain("/api/admin/audit/reconciliation/export");
    await app.close();
  });

  it("meta-audit 写入失败时拒绝读取（不静默放行）", async () => {
    if (!store.ok) throw new Error("security store unavailable");
    const failing = {
      ...store.value,
      appendEvent: () => ({
        ok: false as const,
        code: "SECURITY_STORE_UNAVAILABLE",
        reason: "io_error" as const,
        message: "down"
      })
    } as unknown as SecurityStore;
    storeResult = { ok: true, value: failing };

    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/usage"
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().ok).toBe(false);
    expect(response.json().error.code).toBe("RECONCILIATION_READ_REFUSED");
    await app.close();
  });

  it("安全账本不可用时拒绝读取", async () => {
    storeResult = {
      ok: false,
      code: "SECURITY_STORE_UNAVAILABLE",
      reason: "io_error",
      message: "down"
    };
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/usage"
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("RECONCILIATION_READ_REFUSED");
    await app.close();
  });

  it("actor 不可解析时 401", async () => {
    trustedActorFromRequestMock.mockImplementation(() => {
      throw new Error("actor unresolved");
    });
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/usage"
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("D-25 进程重启复用同一 request id 时，两次读取都成功且留两条不同 meta-audit", async () => {
    // Fastify 的 request.id 是**每进程计数器**（base-36）：进程重启后会复用上一轮的 id。
    // 固定 genReqId 模拟「重启后计数器回到同一个值」。
    const app = Fastify({ logger: false, genReqId: () => "req-fixed" });
    registerAuditReconciliationRoutes(app);

    const first = await app.inject({ method: "GET", url: "/api/admin/audit/reconciliation/usage" });
    const second = await app.inject({ method: "GET", url: "/api/admin/audit/reconciliation/usage" });

    // 修复前：第二次会因 event_id 撞 UNIQUE 约束 → SECURITY_CONFLICT → 503。
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    // 两次读取必须各自留下**不同**的一条 meta-audit（event_id 不得由 request.id 派生）。
    const reads = ledgerEvents().filter((event) => event.eventId.startsWith("reconciliation-read-"));
    expect(reads).toHaveLength(2);
    expect(new Set(reads.map((event) => event.eventId)).size).toBe(2);
    // request.id 仍可追溯（降级为 trace_id）。
    expect(reads.every((event) => event.traceId === "req-fixed")).toBe(true);

    await app.close();
  });

  it("问询详情返回统一 reconciliationContext，并只写 meta-audit", async () => {
    const before = ledgerEvents().length;
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/inquiries/turn-1"
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    const context = body.data.reconciliationContext;
    expect(context.schemaVersion).toBe("audit-reconciliation-view/v1");
    // S = canonical ledger 已提交上界（meta-audit 先落账，因此含该事件）。
    expect(context.watermarkSeq).toBe(ledgerEvents().length);
    expect(context.derivationVersion).toBe("v2p5-1");
    expect(context.classificationVersion).toBe("v2p5-1");
    expect(body.data.inquiry.context.watermarkSeq).toBe(context.watermarkSeq);

    // 只读：审计事实源未被写入，只多了一条 meta-audit 事件。
    const after = ledgerEvents();
    expect(after.length).toBe(before + 1);
    const metaAudit = after[after.length - 1]!;
    expect(metaAudit.auditEventKind).toBe("audit_management");
    await app.close();
  });

  it("缺少 turnId 时 400", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/inquiries/%20"
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("usage 端点返回 Token 对账与分页完整性声明", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/usage?limit=10"
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.tokenReconciliation).toBeDefined();
    expect(body.data.calls).toMatchObject({ complete: true, totalMatched: 0, returned: 0 });
    expect(body.data.calls.nextCursor).toBeNull();
    await app.close();
  });

  it("D-20 usage 按账本上界 S 选行，不按投影 id 选行", async () => {
    // The row timestamp must sit inside the reconciliation 7-day window, which
    // is derived from the current clock. A hard-coded date silently dropped
    // these rows out of the window once it aged past 7 days.
    const insideWindow = new Date(Date.now() - 60_000).toISOString();
    const insert = auditDb.prepare(
      `INSERT INTO access_log (id, ts, user_id, tool, request_id, outcome, ledger_seq)
       VALUES (?, ?, 'u1', 'lucy_query', ?, 'ok', ?)`
    );
    insert.run(1, insideWindow, "req-post-s", 99);
    insert.run(2, insideWindow, "req-pre-s", 1);

    const app = makeApp();
    const response = await app.inject({ method: "GET", url: "/api/admin/audit/reconciliation/usage" });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.calls.totalMatched).toBe(1);
    expect(body.data.calls.items.map((row: { unitId: string }) => row.unitId)).toEqual(["2"]);
    await app.close();
  });

  it("D-26 usage 经生产端口返回六项 S05 检查，缺证据项保持 unknown", async () => {
    auditDb.prepare(
      `INSERT INTO access_log (id, ts, user_id, tool, request_id, outcome, ledger_seq)
       VALUES (1, ?, 'u1', 'lucy_query', 'req-1', 'ok', 2)`
    ).run(new Date(Date.now() - 60_000).toISOString());
    configureReconciliationPorts({ auditCoverage: createProductionAuditCoveragePort() });
    try {
      const app = makeApp();
      const response = await app.inject({ method: "GET", url: "/api/admin/audit/reconciliation/usage" });
      expect(response.statusCode).toBe(200);
      const coverage = response.json().data.reconciliationContext.auditCoverage;
      expect(coverage.version).toBe("v2p5-1");
      expect(coverage.checks).toHaveLength(6);
      expect(coverage.checks.find((check: { id: string }) => check.id === "projection_catchup"))
        .toMatchObject({ status: "pass", numerator: 1, denominator: 1 });
      expect(coverage.checks.filter((check: { id: string }) => check.id !== "projection_catchup"))
        .toHaveLength(5);
      expect(coverage.checks.filter((check: { id: string }) => check.id !== "projection_catchup")
        .every((check: { status: string }) => check.status === "unknown")).toBe(true);
      await app.close();
    } finally {
      resetReconciliationPortsForTests();
    }
  });

  it("export 端点返回五类 CSV 与 Manifest", async () => {
    const app = makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/audit/reconciliation/export"
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data.files.map((file: { name: string }) => file.name)).toEqual([
      "inquiry-summary.csv",
      "complete-table-list.csv",
      "calls-attempts.csv",
      "token-reconciliation.csv",
      "difference-sets.csv"
    ]);
    expect(body.data.manifest.context.watermarkSeq).toBe(ledgerEvents().length);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    await app.close();
  });
});
