/**
 * Lucy v0.25 / L25-09 §18.10 F-02 —— 归属就地改写日志与来源行账本序号。
 *
 * 覆盖存储侧的三件事：
 * 1. 握手 attachment 的就地改写必须留下**前像**与账本序号（否则 as-of S 的归属
 *    维度不可证明）；
 * 2. 归属改写日志表的基线必须登记（否则无法排除基线前的未登记改写）；
 * 3. 来源行必须带账本序号（否则晚于 S 的来源行会成为混入的 >S 关联事实）。
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let projectRoot: string;
let auditDbPath: string;
let previousRoot: string | undefined;
let previousContentRoot: string | undefined;
let previousAuditDb: string | undefined;
/** `vi.resetModules()` 之后必须重新注入，否则注入的是另一个模块实例。 */
let resetLedgerSeqResolver: ((resolver: (() => Promise<number | null>) | null) => void) | null = null;

beforeEach(async () => {
  vi.resetModules();
  const reconcile = await import("../proxy/audit-reconcile");
  resetLedgerSeqResolver = reconcile.setLedgerSeqResolver;
  projectRoot = await mkdtemp(path.join(os.tmpdir(), "ktx-asof-audit-"));
  await mkdir(projectRoot, { recursive: true });
  await writeFile(path.join(projectRoot, "ktx.yaml"), "connections: {}\n", "utf8");
  auditDbPath = path.join(projectRoot, "audit.sqlite");
  previousRoot = process.env.KTX_PROJECT_ROOT;
  previousContentRoot = process.env.LUCY_CONTENT_ROOT;
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.KTX_PROJECT_ROOT = projectRoot;
  process.env.LUCY_CONTENT_ROOT = ".";
  process.env.LUCY_AUDIT_DB = auditDbPath;
  // 账本序号解析器：固定上界，便于断言。
  reconcile.setLedgerSeqResolver(async () => 7);
});

afterEach(async () => {
  resetLedgerSeqResolver?.(null);
  resetLedgerSeqResolver = null;
  if (previousRoot === undefined) delete process.env.KTX_PROJECT_ROOT;
  else process.env.KTX_PROJECT_ROOT = previousRoot;
  if (previousContentRoot === undefined) delete process.env.LUCY_CONTENT_ROOT;
  else process.env.LUCY_CONTENT_ROOT = previousContentRoot;
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(projectRoot, { recursive: true, force: true });
});

describe("F-02 归属就地改写日志", () => {
  it("握手 attachment 留下前像、后像与账本序号", async () => {
    const { writeLog, bindPriorSessionCalls } = await import("../proxy/audit");
    const initializeId = await writeLog({
      ts: new Date().toISOString(),
      userId: "asof-user",
      tool: "initialize",
      outcome: "ok",
      durationMs: 1,
      requestId: "asof-init",
      lucySessionId: "sess-asof",
      tokenHashPrefix: "sha256:aabbccddeeff",
      turnAttributionMode: "unassigned"
    });

    await bindPriorSessionCalls({
      turnId: "lucy_turn_asof",
      userId: "asof-user",
      tokenHashPrefix: "sha256:aabbccddeeff",
      sessionId: "sess-asof",
      at: new Date().toISOString()
    });

    const db = new Database(auditDbPath, { readonly: true });
    try {
      const mutation = db
        .prepare(
          `SELECT access_log_id, ledger_seq, kind, before_turn_id, after_turn_id,
                  before_mode, after_mode, before_confidence, after_confidence
             FROM access_log_attribution_mutations WHERE access_log_id = ?`
        )
        .get(initializeId) as {
        access_log_id: number;
        ledger_seq: number | null;
        kind: string;
        before_turn_id: string | null;
        after_turn_id: string | null;
        before_mode: string | null;
        after_mode: string | null;
        before_confidence: string | null;
        after_confidence: string | null;
      };
      expect(mutation).toBeDefined();
      expect(mutation.access_log_id).toBe(initializeId);
      expect(mutation.kind).toBe("handshake_attachment");
      expect(mutation.ledger_seq).toBe(7);
      // 前像：改写前的归属为空 / unassigned。
      expect(mutation.before_turn_id).toBeNull();
      expect(mutation.before_mode).toBe("unassigned");
      // 后像：改写后的归属。
      expect(mutation.after_turn_id).toBe("lucy_turn_asof");
      expect(mutation.after_mode).toBe("session_bound");
      expect(mutation.after_confidence).toBe("low");
    } finally {
      db.close();
    }
  });

  it("归属改写日志基线被登记为账本已提交上界", async () => {
    const { writeLog } = await import("../proxy/audit");
    await writeLog({
      ts: new Date().toISOString(),
      userId: "asof-user",
      tool: "initialize",
      outcome: "ok",
      durationMs: 1,
      requestId: "asof-init-2"
    });
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db
        .prepare(`SELECT value FROM access_log_asof_meta WHERE key = 'attribution_journal_baseline_seq'`)
        .get() as { value: string } | undefined;
      expect(row?.value).toBe("7");
    } finally {
      db.close();
    }
  });

  it("来源行写入账本序号", async () => {
    const { writeLog, writeAccessLogSources } = await import("../proxy/audit");
    const accessLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "asof-user",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 1,
      requestId: "asof-query"
    });
    await writeAccessLogSources(accessLogId, new Date().toISOString(), "asof-user", "lucy_query", [
      {
        connectionId: "main",
        schemaName: "public",
        sourceName: "users",
        physicalTable: "users",
        extractionMethod: "literal",
        confidence: "high"
      }
    ]);
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db
        .prepare(`SELECT ledger_seq FROM access_log_sources WHERE access_log_id = ?`)
        .get(accessLogId) as { ledger_seq: number | null } | undefined;
      expect(row?.ledger_seq).toBe(7);
    } finally {
      db.close();
    }
  });

  it("审计行本身也带账本序号（as-of S 的基础事实凭据）", async () => {
    const { writeLog } = await import("../proxy/audit");
    const accessLogId = await writeLog({
      ts: new Date().toISOString(),
      userId: "asof-user",
      tool: "lucy_query",
      outcome: "ok",
      durationMs: 1,
      requestId: "asof-query-2"
    });
    const db = new Database(auditDbPath, { readonly: true });
    try {
      const row = db.prepare(`SELECT ledger_seq FROM access_log WHERE id = ?`).get(accessLogId) as {
        ledger_seq: number | null;
      };
      expect(row.ledger_seq).toBe(7);
    } finally {
      db.close();
    }
  });
});
