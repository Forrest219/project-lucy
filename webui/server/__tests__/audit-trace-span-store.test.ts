/**
 * P1-36 — span 表、外键、同事务写入与新列（vitest 契约；UAT 另行在 Docker demo 上执行）。
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessLogEntry } from "../proxy/audit.js";
import { TraceRecorder } from "../proxy/audit-trace-span.js";

let dir: string;
let dbPath: string;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-span-store-"));
  dbPath = path.join(dir, "audit.sqlite");
  previousAuditDb = process.env.LUCY_AUDIT_DB;
  process.env.LUCY_AUDIT_DB = dbPath;
});

afterEach(async () => {
  const audit = await import("../proxy/audit.js");
  audit.closeAuditDb();
  if (previousAuditDb === undefined) delete process.env.LUCY_AUDIT_DB;
  else process.env.LUCY_AUDIT_DB = previousAuditDb;
  await rm(dir, { recursive: true, force: true });
});

function buildEntry(traceId: string, withSpans: boolean): AccessLogEntry {
  const recorder = new TraceRecorder({ traceId });
  recorder.mark("acl", { status: "ok", reasonCode: "allowed" });
  const finished = recorder.finish();
  return {
    ts: new Date(finished.wallEndMs).toISOString(),
    userId: "u1",
    tool: "tools/list",
    outcome: "ok" as const,
    durationMs: finished.durationMs,
    requestId: "1",
    traceId,
    ...(withSpans ? { spans: finished.spans } : {})
  };
}

function peek<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
  const handle = new Database(dbPath, { readonly: true });
  try {
    return handle.prepare(sql).all(...params) as T[];
  } finally {
    handle.close();
  }
}

describe("access_trace_span 存储", () => {
  it("行与 span 同事务写入；有 span 的行派生版本为 v2p5-2，ip_source / trusted_source 落账", async () => {
    const audit = await import("../proxy/audit.js");
    const id = await audit.writeLog({
      ...buildEntry("trace_a", true),
      ipSource: "xff",
      trustedSource: "trusted_proxy"
    });
    const rows = peek<{ access_log_id: number; stage: string; seq: number }>(
      "SELECT access_log_id, stage, seq FROM access_trace_span WHERE trace_id = 'trace_a' ORDER BY seq"
    );
    expect(rows.map((r) => r.stage)).toEqual(["admission", "acl"]);
    expect(rows.every((r) => r.access_log_id === id)).toBe(true);
    const [row] = peek<{ derivation_version: string; ip_source: string; trusted_source: string }>(
      "SELECT derivation_version, ip_source, trusted_source FROM access_log WHERE id = ?",
      id
    );
    expect(row).toEqual({ derivation_version: "v2p5-2", ip_source: "xff", trusted_source: "trusted_proxy" });
  });

  it("无 span 的行保持 v2p5-1，旧写路径不受影响", async () => {
    const audit = await import("../proxy/audit.js");
    const id = await audit.writeLog(buildEntry("trace_legacy", false));
    const [row] = peek<{ derivation_version: string }>("SELECT derivation_version FROM access_log WHERE id = ?", id);
    expect(row.derivation_version).toBe("v2p5-1");
    expect(peek("SELECT 1 FROM access_trace_span")).toHaveLength(0);
  });

  it("span 插入失败整笔回滚：行与 span 都不落库", async () => {
    const audit = await import("../proxy/audit.js");
    await audit.writeLog(buildEntry("trace_warm", true));
    const admin = new Database(dbPath);
    admin.exec(`CREATE TRIGGER fail_span BEFORE INSERT ON access_trace_span BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
    admin.close();
    await expect(audit.writeLog(buildEntry("trace_fail", true))).rejects.toThrow(/injected/);
    expect(peek("SELECT 1 FROM access_log WHERE trace_id = 'trace_fail'")).toHaveLength(0);
    expect(peek("SELECT 1 FROM access_trace_span WHERE trace_id = 'trace_fail'")).toHaveLength(0);

    const cleanup = new Database(dbPath);
    cleanup.exec("DROP TRIGGER fail_span");
    cleanup.close();
    await audit.writeLog(buildEntry("trace_after", true));
    expect(peek("SELECT 1 FROM access_log WHERE trace_id = 'trace_after'")).toHaveLength(1);
  });

  it("部分唯一索引：v2p5-2 行 trace_id 不得重复，旧行可重复", async () => {
    const audit = await import("../proxy/audit.js");
    await audit.writeLog(buildEntry("trace_dup", true));
    await expect(audit.writeLog(buildEntry("trace_dup", true))).rejects.toThrow(/UNIQUE/);
    await audit.writeLog(buildEntry("trace_old", false));
    await audit.writeLog(buildEntry("trace_old", false));
    expect(peek("SELECT 1 FROM access_log WHERE trace_id = 'trace_old'")).toHaveLength(2);
  });

  it("DB CHECK：未知阶段 / 理由码 / 超限或非法 attrs / 负时长 被拒", async () => {
    const audit = await import("../proxy/audit.js");
    const id = await audit.writeLog(buildEntry("trace_chk", true));
    const handle = new Database(dbPath);
    const insert = (over: Record<string, unknown>) => {
      const base = {
        span_id: `s_${Math.random()}`, trace_id: "trace_chk", access_log_id: id, parent_span_id: null,
        seq: 50, stage: "acl", started_at_ms: 1, duration_ms: 0, status: "ok", reason_code: null,
        reason_param: null, error_category: null, attrs_json: null, derivation_version: "v2p5-2", ...over
      };
      handle.prepare(
        `INSERT INTO access_trace_span (span_id, trace_id, access_log_id, parent_span_id, seq, stage, started_at_ms, duration_ms, status, reason_code, reason_param, error_category, attrs_json, derivation_version)
         VALUES (@span_id, @trace_id, @access_log_id, @parent_span_id, @seq, @stage, @started_at_ms, @duration_ms, @status, @reason_code, @reason_param, @error_category, @attrs_json, @derivation_version)`
      ).run(base);
    };
    try {
      expect(() => insert({ stage: "bogus" })).toThrow(/CHECK/);
      expect(() => insert({ reason_code: "made_up" })).toThrow(/CHECK/);
      expect(() => insert({ attrs_json: "{not json" })).toThrow(/CHECK/);
      expect(() => insert({ attrs_json: JSON.stringify({ decision: "é".repeat(600) }) })).toThrow(/CHECK/);
      expect(() => insert({ duration_ms: -1 })).toThrow(/CHECK/);
      expect(() => insert({ seq: 0 })).toThrow(/CHECK/);
      expect(() => insert({ status: "weird" })).toThrow(/CHECK/);
      expect(() => insert({ derivation_version: "v2p5-1" })).toThrow(/CHECK/);
      expect(() => insert({ attrs_json: JSON.stringify({ decision: "allow" }), reason_code: "allowed" })).not.toThrow();
    } finally {
      handle.close();
    }
  });

  it("外键：服务连接 foreign_keys=ON；删父行级联删除 span；孤儿 span 被拒；既有 sources 写路径不被拒", async () => {
    const audit = await import("../proxy/audit.js");
    const status = await audit.getAuditSqliteStatus();
    expect(status.foreignKeys).toBe(true);
    expect(status.foreignKeyChildren.map((c) => c.table).sort()).toEqual(["access_log_sources", "access_trace_span"]);
    expect(status.foreignKeyChildren.find((c) => c.table === "access_trace_span")?.onDelete).toBe("CASCADE");

    const id = await audit.writeLog(buildEntry("trace_fk", true));
    await audit.writeAccessLogSources(id, new Date().toISOString(), "u1", "lucy_query", [
      { connectionId: "c", schemaName: "s", sourceName: "src", physicalTable: "s.t", extractionMethod: "parser", confidence: "high" }
    ]);
    expect(peek("SELECT 1 FROM access_log_sources WHERE access_log_id = ?", id)).toHaveLength(1);

    // 孤儿 span：连接开启 foreign_keys 后写入被拒（用服务自身的写路径之外的连接验证 DDL 语义）。
    const handle = new Database(dbPath);
    handle.pragma("foreign_keys = ON");
    try {
      expect(() =>
        handle.prepare(
          `INSERT INTO access_trace_span (span_id, trace_id, access_log_id, seq, stage, started_at_ms, duration_ms, status, derivation_version)
           VALUES ('orphan', 'trace_fk', 999999, 80, 'acl', 1, 0, 'ok', 'v2p5-2')`
        ).run()
      ).toThrow(/FOREIGN KEY/);
      handle.prepare("DELETE FROM access_log_sources WHERE access_log_id = ?").run(id);
      handle.prepare("DELETE FROM access_log WHERE id = ?").run(id);
      expect(handle.prepare("SELECT 1 FROM access_trace_span WHERE access_log_id = ?").all(id)).toHaveLength(0);
    } finally {
      handle.close();
    }
  });
});
