/**
 * P1-36 — `spans.csv` 导出与 C7 / C8 / C9 对账（vitest 契约；UAT 另行在 Docker demo 上执行）。
 */
import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AccessLogEntry } from "../proxy/audit.js";
import { TraceRecorder, completeTrace } from "../proxy/audit-trace-span.js";
import { buildExportPackV2, EXPORT_V2_HEADERS } from "../admin/audit-export-v2.js";
import { SPANS_CSV_HEADERS, computeSpanCoverage, countUnsequencedSpans, renderSpansCsv } from "../admin/audit-trace-export.js";

let dir: string;
let dbPath: string;
let previousAuditDb: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "lucy-span-export-"));
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

/** 一条完整的 `ping` 调用：本地处理 + 根 span，经 `completeTrace` 收口，与代理生产路径同形。 */
function pingEntry(traceId: string): AccessLogEntry {
  const recorder = new TraceRecorder({ traceId });
  recorder.mark("local_handler", { status: "ok", attrs: { handler: "ping" } });
  const { evidence, root } = completeTrace(recorder, {
    tool: "ping",
    outcome: "ok",
    decisionReason: undefined,
    errorDetail: undefined,
    policyVersion: undefined,
    isToolCall: false
  });
  const finished = recorder.finish(root);
  return {
    ts: new Date(finished.wallEndMs).toISOString(),
    userId: "u1",
    tool: "ping",
    outcome: "ok",
    durationMs: finished.durationMs,
    requestId: traceId,
    traceId,
    spans: finished.spans,
    executionEvidence: evidence
  };
}

async function seed(count: number): Promise<{ ids: number[]; db: Database.Database }> {
  const audit = await import("../proxy/audit.js");
  const ids: number[] = [];
  for (let i = 0; i < count; i += 1) ids.push(await audit.writeLog(pingEntry(`trace_${i}`)));
  const db = new Database(dbPath);
  // `ledger_seq` 由安全账本在写入后分配；此处等价地按 id 顺序赋值。
  db.prepare("UPDATE access_log SET ledger_seq = id").run();
  return { ids, db };
}

describe("spans.csv 渲染", () => {
  it("按 access_log_id, seq 排序，ledger_seq 来自所属行，表头固定", async () => {
    const { ids, db } = await seed(2);
    const out = await renderSpansCsv(db, ids, "Asia/Shanghai");
    const lines = out.csv.trimEnd().split("\n");
    expect(lines[0]).toBe(SPANS_CSV_HEADERS.join(","));
    expect(out.rowCount).toBe(lines.length - 1);
    expect(out.rowCount).toBeGreaterThanOrEqual(4);
    const dataRows = lines.slice(1).map((l) => l.split(","));
    const idCol = SPANS_CSV_HEADERS.indexOf("access_log_id");
    const seqCol = SPANS_CSV_HEADERS.indexOf("seq");
    const ledgerCol = SPANS_CSV_HEADERS.indexOf("ledger_seq");
    for (const row of dataRows) expect(row[ledgerCol]).toBe(row[idCol]);
    const keys = dataRows.map((r) => [Number(r[idCol]), Number(r[seqCol])]);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    db.close();
  });

  it("同一输入重复导出字节一致（封存前缀稳定）", async () => {
    const { ids, db } = await seed(3);
    const a = await renderSpansCsv(db, ids, "Asia/Shanghai");
    const b = await renderSpansCsv(db, ids, "Asia/Shanghai");
    expect(b.csv).toBe(a.csv);
    expect(b.sha256).toBe(a.sha256);
    // 只取前两行时，其 CSV 是全量的行前缀。
    const prefix = await renderSpansCsv(db, ids.slice(0, 2), "Asia/Shanghai");
    const prefixBody = prefix.csv.split("\n").slice(1, -1);
    const fullBody = a.csv.split("\n").slice(1, -1);
    expect(fullBody.slice(0, prefixBody.length)).toEqual(prefixBody);
    db.close();
  });

  it("分块边界不改变产出：块大小 1／2／3 的 CSV、摘要与对账结果逐项相同，入参乱序亦同", async () => {
    const { ids, db } = await seed(5);
    const whole = await renderSpansCsv(db, ids, "Asia/Shanghai");
    for (const chunkSize of [1, 2, 3]) {
      const chunked = await renderSpansCsv(db, [...ids].reverse(), "Asia/Shanghai", { chunkSize });
      expect(chunked.csv).toBe(whole.csv);
      expect(chunked.sha256).toBe(whole.sha256);
      expect(chunked.rowCount).toBe(whole.rowCount);
    }
    const coverageWhole = await computeSpanCoverage(db, 100);
    for (const chunkSize of [1, 2, 3]) {
      expect(await computeSpanCoverage(db, 100, { chunkSize })).toEqual(coverageWhole);
    }
    db.close();
  });

  it("分块之间真的让出事件循环（同时运行的 setImmediate 计数在导出期间持续增长）", async () => {
    const { ids, db } = await seed(6);
    let ticks = 0;
    let running = true;
    const spin = (async () => {
      while (running) {
        await new Promise<void>((resolve) => setImmediate(resolve));
        ticks += 1;
      }
    })();
    await renderSpansCsv(db, ids, "Asia/Shanghai", { chunkSize: 1 });
    await computeSpanCoverage(db, 100, { chunkSize: 1 });
    running = false;
    await spin;
    expect(ticks).toBeGreaterThanOrEqual(10);
    db.close();
  });

  it("所属行 ledger_seq 为 NULL 的 span 不进文件，单列计数 unsequenced", async () => {
    const { ids, db } = await seed(2);
    db.prepare("UPDATE access_log SET ledger_seq = NULL WHERE id = ?").run(ids[1]);
    const out = await renderSpansCsv(db, ids, "Asia/Shanghai");
    const idCol = SPANS_CSV_HEADERS.indexOf("access_log_id");
    const present = new Set(out.csv.trimEnd().split("\n").slice(1).map((l) => l.split(",")[idCol]));
    expect([...present]).toEqual([String(ids[0])]);
    expect(out.unsequenced).toBeGreaterThan(0);
    // 基础导出路径（不渲染 spans.csv）用同一口径计数，不再硬编码 0。
    expect(countUnsequencedSpans(db, ids)).toBe(out.unsequenced);
    db.close();
  });

  it("没有选中行或没有 span 表时返回空导出", async () => {
    const { db } = await seed(1);
    expect((await renderSpansCsv(db, [], "Asia/Shanghai")).rowCount).toBe(0);
    const bare = new Database(":memory:");
    bare.exec("CREATE TABLE access_log (id INTEGER PRIMARY KEY)");
    expect(await renderSpansCsv(bare, [1], "Asia/Shanghai")).toEqual({ csv: "", rowCount: 0, sha256: "", unsequenced: 0 });
    expect((await computeSpanCoverage(bare, 10)).traceLinked.status).toBe("not_applicable");
    db.close();
    bare.close();
  });
});

describe("C7 / C8 / C9 对账", () => {
  it("正常写入的行三项全 PASS，旧版本行只单独计数", async () => {
    const audit = await import("../proxy/audit.js");
    const { db } = await seed(3);
    // 一条无 span 的旧写路径行。
    const legacyId = await audit.writeLog({
      ts: new Date().toISOString(), userId: "u1", tool: "ping", outcome: "ok", durationMs: 1, requestId: "legacy"
    });
    db.prepare("UPDATE access_log SET ledger_seq = id WHERE id = ?").run(legacyId);
    const coverage = await computeSpanCoverage(db, 100);
    expect(coverage.traceLinked).toMatchObject({ status: "pass", numerator: 3, denominator: 3 });
    expect(coverage.spanIntegrity).toMatchObject({ status: "pass", numerator: 3, denominator: 3 });
    expect(coverage.spanTiming).toMatchObject({ status: "pass", numerator: 3, denominator: 3 });
    expect(coverage.legacyUnlinked).toBe(1);
    db.close();
  });

  it("C7：trace_id 缺失被标为失败并给出反例；重复由唯一索引在写入时拒绝", async () => {
    const { db } = await seed(3);
    expect(() => db.prepare("UPDATE access_log SET trace_id = 'trace_0' WHERE id = 2").run()).toThrow(/UNIQUE/);
    db.prepare("UPDATE access_log SET trace_id = NULL WHERE id = 2").run();
    const coverage = await computeSpanCoverage(db, 100);
    expect(coverage.traceLinked).toMatchObject({ status: "fail", numerator: 2, denominator: 3 });
    expect(coverage.traceLinked.counterexamples[0]).toContain("empty");
    db.close();
  });

  it("C8：缺少必有 span / 孤儿 span / trace_id 不一致各自失败", async () => {
    const { ids, db } = await seed(3);
    db.pragma("foreign_keys = OFF");
    // 缺少执行 span。
    db.prepare("DELETE FROM access_trace_span WHERE access_log_id = ? AND stage = 'local_handler'").run(ids[0]);
    // span.trace_id 与行不一致。
    db.prepare("UPDATE access_trace_span SET trace_id = 'other' WHERE access_log_id = ?").run(ids[1]);
    let coverage = await computeSpanCoverage(db, 100);
    expect(coverage.spanIntegrity.status).toBe("fail");
    expect(coverage.spanIntegrity.numerator).toBe(1);
    const text = coverage.spanIntegrity.counterexamples.join("\n");
    expect(text).toContain("ping:missing_exec_span");
    expect(text).toContain("span_trace_id_mismatch");

    // 孤儿 span：父行不存在。
    db.prepare("DELETE FROM access_log WHERE id = ?").run(ids[2]);
    coverage = await computeSpanCoverage(db, 100);
    expect(coverage.spanIntegrity.counterexamples[0]).toMatch(/^orphan_spans=/);
    db.close();
  });

  it("C9：根 span 时长与行 duration_ms 不一致被标为失败", async () => {
    const { ids, db } = await seed(2);
    db.prepare("UPDATE access_log SET duration_ms = duration_ms + 500 WHERE id = ?").run(ids[0]);
    const coverage = await computeSpanCoverage(db, 100);
    expect(coverage.spanTiming.status).toBe("fail");
    expect(coverage.spanTiming.numerator).toBe(1);
    expect(coverage.spanTiming.counterexamples).toHaveLength(1);
    db.close();
  });

  it("截止序号 S 之后的行不进分母", async () => {
    const { db } = await seed(4);
    const coverage = await computeSpanCoverage(db, 2);
    expect(coverage.traceLinked.denominator).toBe(2);
    db.close();
  });
});

describe("导出包接线", () => {
  it("包内含 spans.csv，manifest 带 spanCoverage 与 spans 上界，calls-v2 含 ip_source / trusted_source 列", async () => {
    const { db } = await seed(3);
    const result = await buildExportPackV2({
      mode: "diagnostic",
      confirmDiagnostic: true,
      fixedFilter: {},
      fixedZone: "UTC",
      auditStoreAvailable: true,
      securityStoreAvailable: true,
      classificationVersion: "audit-trust-2026-10-19-r1.v1",
      digestVersion: "audit-trust-2026-10-19-r1.v1",
      ledgerUpperSeq: 100,
      snapshotDb: db
    });
    const spans = result.files.find((f) => f.name === "spans.csv");
    expect(EXPORT_V2_HEADERS).toEqual(expect.arrayContaining(["ip_source", "trusted_source"]));
    expect(spans?.rowCount).toBeGreaterThanOrEqual(6);
    expect(spans?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifest.spans).toEqual({ ledgerUpperSeq: 100, unsequenced: 0 });
    // P1-36 D7：manifest 声明现行派生版本，与 spanCoverage.version 一致。
    expect(result.manifest.derivationVersion).toBe("v2p5-2");
    expect(result.manifest.derivationVersion).toBe(result.manifest.spanCoverage.version);
    expect(result.manifest.spanCoverage.traceLinked).toMatchObject({ status: "pass", denominator: 3 });
    expect(result.manifest.spanCoverage.spanIntegrity.status).toBe("pass");
    expect(result.manifest.spanCoverage.spanTiming.status).toBe("pass");
    db.close();
  });
});
