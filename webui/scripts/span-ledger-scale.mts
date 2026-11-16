/**
 * P1-36 UAT-TRC-11 — span 账本规模与事件循环占用。
 *
 *   cd webui
 *   npx tsx scripts/span-ledger-scale.mts [--traces 100000] [--out ../inbox/span-ledger-scale.json]
 *
 * 在**临时沙箱审计库**里（不碰 demo 库）：先用真实写入路径 `writeLog` 写入三种形状的 trace
 * （ping、tools/list 形态、tools/call 形态），再把它们按时间平移克隆到 N 条（含 span 与 ledger_seq），
 * 然后分别度量：
 *   - span 表＋索引平均每 trace 字节数（Spec O6：≤ 8 KB）；
 *   - `computeSpanCoverage`、`renderSpansCsv`、完整 `buildExportPackV2` 的同步阻塞时长、
 *     事件循环延迟（P99／max）与 RSS 峰值。
 * 判定门槛沿用 UAT-TRC-11：事件循环 P99 ≤ 400 ms、max ≤ 1000 ms。输出一份 JSON，退出码 0＝全过、1＝有超标。
 * 这是度量脚本：超标就如实输出，不放宽门槛。
 */
import Database from "better-sqlite3";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? fallback) : fallback;
};
const TRACES = Number(flag("traces", "100000"));
const OUT = path.resolve(process.cwd(), flag("out", path.join(here, "../../inbox/span-ledger-scale.json")));
const BAR = { eventLoopP99Ms: 400, eventLoopMaxMs: 1000, bytesPerTrace: 8 * 1024 } as const;

const dir = await mkdtemp(path.join(os.tmpdir(), "lucy-span-scale-"));
const dbPath = path.join(dir, "audit.sqlite");
process.env.LUCY_AUDIT_DB = dbPath;

const audit = await import("../server/proxy/audit.ts");
const { TraceRecorder, completeTrace } = await import("../server/proxy/audit-trace-span.ts");
const { computeSpanCoverage, renderSpansCsv } = await import("../server/admin/audit-trace-export.ts");
const { buildExportPackV2 } = await import("../server/admin/audit-export-v2.ts");

type Entry = Parameters<typeof audit.writeLog>[0];

function buildEntry(shape: "ping" | "tools/list" | "tools/call", traceId: string): Entry {
  const recorder = new TraceRecorder({ traceId });
  const isToolCall = shape === "tools/call";
  if (shape === "ping") {
    recorder.mark("local_handler", { status: "ok", attrs: { handler: "ping" } });
  } else if (shape === "tools/list") {
    recorder.mark("admission", { status: "ok" });
    recorder.mark("upstream_call", { status: "ok", attrs: { upstream_status: 200 } });
  } else {
    for (const stage of ["admission", "role_resolve", "envelope", "arg_validate", "acl", "caliber", "source_gate", "budget"] as const) {
      recorder.mark(stage, { status: "ok" });
    }
    recorder.mark("upstream_call", { status: "ok", attrs: { upstream_status: 200 } });
    recorder.mark("response_serialize", { status: "ok" });
  }
  const tool = shape === "tools/call" ? "lucy_query" : shape;
  const { evidence, root } = completeTrace(recorder, {
    tool, outcome: "ok", decisionReason: undefined, errorDetail: undefined, policyVersion: undefined, isToolCall
  });
  const finished = recorder.finish(root);
  return {
    ts: new Date(finished.wallEndMs).toISOString(),
    userId: "scale-user",
    tool,
    outcome: "ok",
    durationMs: finished.durationMs,
    requestId: traceId,
    traceId,
    spans: finished.spans,
    executionEvidence: evidence
  };
}

type Row = Record<string, unknown>;
const lagHistogram = monitorEventLoopDelay({ resolution: 10 });

/** 度量一个（可能让出事件循环的）阶段：墙钟、事件循环延迟 P99／max、RSS。 */
async function measure<T>(label: string, run: () => Promise<T>): Promise<{ label: string; wallMs: number; eventLoopP99Ms: number; eventLoopMaxMs: number; rssPeakMb: number; value: T }> {
  lagHistogram.reset();
  lagHistogram.enable();
  const started = performance.now();
  const value = await run();
  const wallMs = performance.now() - started;
  lagHistogram.disable();
  return {
    label, wallMs: Math.round(wallMs),
    eventLoopP99Ms: Math.round(lagHistogram.percentile(99) / 1e6),
    eventLoopMaxMs: Math.round(lagHistogram.max / 1e6),
    rssPeakMb: Math.round(process.memoryUsage().rss / 1048576), value
  };
}

async function main(): Promise<number> {
  const shapes = ["ping", "tools/list", "tools/call"] as const;
  for (const shape of shapes) await audit.writeLog(buildEntry(shape, `tpl_${shape}`));
  audit.closeAuditDb();

  const db = new Database(dbPath);
  const templates = db.prepare("SELECT * FROM access_log ORDER BY id ASC").all() as Row[];
  const spanOf = db.prepare("SELECT * FROM access_trace_span WHERE access_log_id = ? ORDER BY seq ASC");
  const templateSpans = templates.map((row) => spanOf.all(row.id) as Row[]);
  const logCols = Object.keys(templates[0]!).filter((c) => c !== "id");
  const insertLog = db.prepare(`INSERT INTO access_log (${logCols.join(",")}) VALUES (${logCols.map((c) => `@${c}`).join(",")})`);
  const spanCols = Object.keys(templateSpans[0]![0]!);
  const insertSpan = db.prepare(`INSERT INTO access_trace_span (${spanCols.join(",")}) VALUES (${spanCols.map((c) => `@${c}`).join(",")})`);

  const seedStarted = performance.now();
  const baseMs = Date.parse(String(templates[0]!.ts));
  const seed = db.transaction((from: number, to: number) => {
    for (let n = from; n < to; n += 1) {
      const t = n % templates.length;
      const tpl = templates[t]!;
      const shiftMs = (n + 1) * 1000;
      const traceId = `scale_${n}`;
      const row: Row = { ...tpl, trace_id: traceId, request_id: traceId, ts: new Date(Date.parse(String(tpl.ts)) + shiftMs).toISOString(), ledger_seq: null };
      delete row.id;
      for (const col of ["ingress_event_id", "client_call_id", "client_event_id", "rpc_request_id", "attempt_id"]) {
        if (typeof row[col] === "string") row[col] = `${row[col]}_${n}`;
      }
      const accessLogId = Number(insertLog.run(row).lastInsertRowid);
      for (const span of templateSpans[t]!) {
        insertSpan.run({
          ...span,
          span_id: `${span.span_id}_${n}`,
          trace_id: traceId,
          access_log_id: accessLogId,
          parent_span_id: span.parent_span_id ? `${span.parent_span_id}_${n}` : null,
          started_at_ms: Number(span.started_at_ms) + shiftMs
        });
      }
    }
  });
  const batch = 5000;
  for (let from = 0; from < TRACES; from += batch) seed(from, Math.min(TRACES, from + batch));
  db.prepare("UPDATE access_log SET ledger_seq = id WHERE trace_id LIKE 'scale_%'").run();
  const seedMs = Math.round(performance.now() - seedStarted);

  const upperSeq = (db.prepare("SELECT MAX(ledger_seq) AS m FROM access_log").get() as { m: number }).m;
  const spanRows = (db.prepare("SELECT COUNT(*) AS n FROM access_trace_span").get() as { n: number }).n;

  // 容量：span 表＋索引的页占用（dbstat 不可用时退回到整库体积差，如实标注）。
  let spanBytes: number | null = null;
  try {
    spanBytes = (db.prepare(
      "SELECT SUM(pgsize) AS b FROM dbstat WHERE name = 'access_trace_span' OR name IN (SELECT name FROM sqlite_master WHERE tbl_name = 'access_trace_span')"
    ).get() as { b: number | null }).b;
  } catch { /* dbstat 未编译进来 */ }
  const bytesPerTrace = spanBytes === null ? null : Math.round(spanBytes / TRACES);

  const ids = (db.prepare("SELECT id FROM access_log WHERE trace_id LIKE 'scale_%' ORDER BY id ASC").all() as Array<{ id: number }>).map((r) => r.id);
  const coverage = await measure("computeSpanCoverage", () => computeSpanCoverage(db, upperSeq));
  const csv = await measure("renderSpansCsv", () => renderSpansCsv(db, ids, "UTC"));
  const fullExport = await measure("buildExportPackV2", () => buildExportPackV2({
    mode: "diagnostic", confirmDiagnostic: true, fixedFilter: {}, fixedZone: "UTC",
    auditStoreAvailable: true, securityStoreAvailable: true,
    classificationVersion: "audit-trust-2026-10-19-r1.v1", digestVersion: "audit-trust-2026-10-19-r1.v1",
    ledgerUpperSeq: upperSeq, snapshotDb: db
  }));
  const packFiles = fullExport.value.files.map((f) => ({ name: f.name, rowCount: f.rowCount }));

  const brief = (m: { wallMs: number; eventLoopP99Ms: number; eventLoopMaxMs: number; rssPeakMb: number }) =>
    ({ wallMs: m.wallMs, eventLoopP99Ms: m.eventLoopP99Ms, eventLoopMaxMs: m.eventLoopMaxMs, rssPeakMb: m.rssPeakMb });
  const result = {
    probe: "span-ledger-scale", traces: TRACES, spanRows, seedMs, upperSeq,
    capacity: { spanTableAndIndexBytes: spanBytes, bytesPerTrace, barBytesPerTrace: BAR.bytesPerTrace },
    computeSpanCoverage: { ...brief(coverage), traceLinked: coverage.value.traceLinked.status, spanIntegrity: coverage.value.spanIntegrity.status, spanTiming: coverage.value.spanTiming.status },
    renderSpansCsv: { ...brief(csv), rowCount: csv.value.rowCount, csvMb: Math.round(csv.value.csv.length / 1048576) },
    buildExportPackV2: { ...brief(fullExport), files: packFiles },
    bar: BAR
  };
  const overs: string[] = [];
  if (bytesPerTrace !== null && bytesPerTrace > BAR.bytesPerTrace) overs.push(`bytesPerTrace=${bytesPerTrace}`);
  for (const phase of [coverage, csv, fullExport]) {
    if (phase.eventLoopMaxMs > BAR.eventLoopMaxMs) overs.push(`${phase.label} event loop max ${phase.eventLoopMaxMs}ms`);
    if (phase.eventLoopP99Ms > BAR.eventLoopP99Ms) overs.push(`${phase.label} event loop p99 ${phase.eventLoopP99Ms}ms`);
  }
  const verdict = { overs, pass: overs.length === 0 };

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ ...result, verdict }, null, 2));
  console.log(JSON.stringify({ ...result, verdict }));
  db.close();
  return verdict.pass ? 0 : 1;
}

let code = 2;
try { code = await main(); } finally {
  audit.closeAuditDb();
  await rm(dir, { recursive: true, force: true });
}
process.exit(code);
