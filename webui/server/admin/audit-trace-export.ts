/**
 * P1-36 — span 的封存导出（`spans.csv`）与对账（C7 / C8 / C9）。
 *
 * 只读 SQLite；结构／时间／必有集合的判定全部复用 `proxy/audit-trace-span.ts` 的纯函数，
 * 本模块不另造口径。分母＝截止序号 S 以内、`derivation_version = 'v2p5-2'` 的行。
 */
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import {
  SPAN_DERIVATION_VERSION,
  checkSpanIntegrity,
  checkSpanTiming,
  requiredSpanViolations,
  type SpanLike
} from "../proxy/audit-trace-span.js";
import { formatAuditLocalTimestamp } from "./audit-local-timestamp.js";

export const SPANS_CSV_HEADERS = [
  "trace_id", "span_id", "parent_span_id", "access_log_id", "seq", "stage",
  "started_at_utc", "started_at_local", "duration_ms", "status", "reason_code",
  "reason_param", "error_category", "attrs_json", "derivation_version", "ledger_seq"
] as const;

const MAX_DIFF_IDS = 20;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return s.includes(",") || s.includes("\"") || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

function hasSpanTable(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='access_trace_span'").get() !== undefined;
}

export type SpansCsv = { csv: string; rowCount: number; sha256: string; unsequenced: number };

/** 每块处理的流水行数；块与块之间让出事件循环（10 万 trace 下单块阻塞需远低于 `/api/livez` 门槛）。 */
export const SPAN_EXPORT_CHUNK_ROWS = 2000;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

type ChunkOptions = { chunkSize?: number };

/** 所选调用行里「所属行 `ledger_seq` 为 NULL」的 span 数；与 `renderSpansCsv().unsequenced` 同一口径。 */
export function countUnsequencedSpans(db: Database.Database, selectedIds: readonly number[]): number {
  if (selectedIds.length === 0 || !hasSpanTable(db)) return 0;
  const stmt = db.prepare(
    `SELECT COUNT(*) AS n FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id
      WHERE s.access_log_id IN (SELECT value FROM json_each(?)) AND a.ledger_seq IS NULL`
  );
  const chunkSize = SPAN_EXPORT_CHUNK_ROWS;
  let total = 0;
  for (let offset = 0; offset < selectedIds.length; offset += chunkSize) {
    total += (stmt.get(JSON.stringify(selectedIds.slice(offset, offset + chunkSize))) as { n: number }).n;
  }
  return total;
}

/**
 * 导出所选调用行的全部 span。`ledger_seq` 经 JOIN 所属行取得；所属行 `ledger_seq` 为 NULL 的 span
 * 不进文件、单列计数 `unsequenced`（不静默忽略）。排序固定：`access_log_id, seq`。
 *
 * 分块读取（每块 `chunkSize` 行流水）并在块间让出事件循环；产出与一次性读取逐字节相同。
 */
export async function renderSpansCsv(
  db: Database.Database,
  selectedIds: readonly number[],
  zone: string,
  options: ChunkOptions = {}
): Promise<SpansCsv> {
  const empty: SpansCsv = { csv: "", rowCount: 0, sha256: "", unsequenced: 0 };
  if (selectedIds.length === 0 || !hasSpanTable(db)) return empty;
  const chunkSize = Math.max(1, options.chunkSize ?? SPAN_EXPORT_CHUNK_ROWS);
  const ordered = [...selectedIds].sort((a, b) => a - b);
  const unsequencedStmt = db.prepare(
    `SELECT COUNT(*) AS n FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id
      WHERE s.access_log_id IN (SELECT value FROM json_each(?)) AND a.ledger_seq IS NULL`
  );
  const rowsStmt = db.prepare(
    `SELECT s.trace_id, s.span_id, s.parent_span_id, s.access_log_id, s.seq, s.stage, s.started_at_ms,
            s.duration_ms, s.status, s.reason_code, s.reason_param, s.error_category, s.attrs_json,
            s.derivation_version, a.ledger_seq
       FROM access_trace_span s JOIN access_log a ON a.id = s.access_log_id
      WHERE s.access_log_id IN (SELECT value FROM json_each(?)) AND a.ledger_seq IS NOT NULL
      ORDER BY s.access_log_id ASC, s.seq ASC`
  );
  const header = SPANS_CSV_HEADERS.join(",") + "\n";
  const hash = createHash("sha256").update(header);
  const parts: string[] = [];
  let rowCount = 0;
  let unsequenced = 0;
  for (let offset = 0; offset < ordered.length; offset += chunkSize) {
    const ids = JSON.stringify(ordered.slice(offset, offset + chunkSize));
    unsequenced += (unsequencedStmt.get(ids) as { n: number }).n;
    const rows = rowsStmt.all(ids) as Array<Record<string, unknown>>;
    if (rows.length > 0) {
      const lines: string[] = [];
      for (const row of rows) {
        const utc = new Date(Number(row.started_at_ms)).toISOString();
        lines.push([
          row.trace_id, row.span_id, row.parent_span_id, row.access_log_id, row.seq, row.stage,
          utc, formatAuditLocalTimestamp(utc, zone), row.duration_ms, row.status, row.reason_code,
          row.reason_param, row.error_category, row.attrs_json, row.derivation_version, row.ledger_seq
        ].map(csvCell).join(","));
      }
      const text = lines.join("\n") + "\n";
      parts.push(text);
      hash.update(text);
      rowCount += rows.length;
    }
    await yieldToEventLoop();
  }
  if (rowCount === 0) return { ...empty, unsequenced };
  return { csv: header + parts.join(""), rowCount, sha256: hash.digest("hex"), unsequenced };
}

export type SpanCheck = {
  status: "pass" | "fail" | "not_applicable";
  numerator: number;
  denominator: number;
  /** 前 N 个反例（trace_id: 违规码）。 */
  counterexamples: string[];
};

export type SpanCoverage = {
  version: typeof SPAN_DERIVATION_VERSION;
  seqUpperBound: number;
  traceLinked: SpanCheck;
  spanIntegrity: SpanCheck;
  spanTiming: SpanCheck;
  /** 截止 S 以内非 v2p5-2 的行：单独计数，不算失败、不入分母。 */
  legacyUnlinked: number;
  /** v2p5-2 行但 ledger_seq 为 NULL，无法定位到 S（不入分母，如实上报）。 */
  unsequenced: number;
};

function finishCheck(numerator: number, denominator: number, counterexamples: string[]): SpanCheck {
  if (denominator === 0) return { status: "not_applicable", numerator, denominator, counterexamples };
  return { status: numerator === denominator ? "pass" : "fail", numerator, denominator, counterexamples };
}

type CoverageRow = { id: number; trace_id: string | null; tool: string; ts: string; duration_ms: number };
type SpanDbRow = {
  access_log_id: number; trace_id: string; span_id: string; parent_span_id: string | null; seq: number;
  stage: string; started_at_ms: number; duration_ms: number; status: string; reason_code: string | null;
  attrs_json: string | null;
};

const toSpanLike = (r: SpanDbRow): SpanLike => ({
  spanId: r.span_id, parentSpanId: r.parent_span_id, seq: r.seq, stage: r.stage,
  startedAtMs: r.started_at_ms, durationMs: r.duration_ms, status: r.status,
  reasonCode: r.reason_code, attrsJson: r.attrs_json
});

/**
 * C7 / C8 / C9。`spanIntegrity` 同时包含「必有 span 集合」「无孤儿 span」「span.trace_id 与行一致」。
 * 分块读取并在块间让出事件循环（语义与一次性计算逐项相同）。
 */
export async function computeSpanCoverage(
  db: Database.Database,
  upperSeq: number,
  options: ChunkOptions = {}
): Promise<SpanCoverage> {
  const base = (): SpanCoverage => ({
    version: SPAN_DERIVATION_VERSION,
    seqUpperBound: upperSeq,
    traceLinked: finishCheck(0, 0, []),
    spanIntegrity: finishCheck(0, 0, []),
    spanTiming: finishCheck(0, 0, []),
    legacyUnlinked: 0,
    unsequenced: 0
  });
  if (!hasSpanTable(db)) return base();
  const chunkSize = Math.max(1, options.chunkSize ?? SPAN_EXPORT_CHUNK_ROWS);

  const legacyUnlinked = (db.prepare(
    `SELECT COUNT(*) AS n FROM access_log
      WHERE ledger_seq IS NOT NULL AND ledger_seq <= ? AND COALESCE(derivation_version, '') <> ?`
  ).get(upperSeq, SPAN_DERIVATION_VERSION) as { n: number }).n;
  const unsequenced = (db.prepare(
    `SELECT COUNT(*) AS n FROM access_log WHERE ledger_seq IS NULL AND derivation_version = ?`
  ).get(SPAN_DERIVATION_VERSION) as { n: number }).n;

  // 第一遍：分块取出分母行（keyset 翻页，不在让出期间持有迭代器）。
  const rowsPage = db.prepare(
    `SELECT id, trace_id, tool, ts, duration_ms FROM access_log
      WHERE derivation_version = ? AND ledger_seq IS NOT NULL AND ledger_seq <= ? AND id > ?
      ORDER BY id ASC LIMIT ?`
  );
  const rows: CoverageRow[] = [];
  for (let lastId = 0; ;) {
    const page = rowsPage.all(SPAN_DERIVATION_VERSION, upperSeq, lastId, chunkSize) as CoverageRow[];
    if (page.length === 0) break;
    for (const row of page) rows.push(row);
    lastId = page[page.length - 1]!.id;
    await yieldToEventLoop();
  }

  // C7：trace_id 非空且唯一。
  const seen = new Map<string, number>();
  for (const row of rows) if (row.trace_id) seen.set(row.trace_id, (seen.get(row.trace_id) ?? 0) + 1);
  const linkedBad: string[] = [];
  let linkedOk = 0;
  for (const row of rows) {
    if (row.trace_id && seen.get(row.trace_id) === 1) linkedOk += 1;
    else if (linkedBad.length < MAX_DIFF_IDS) linkedBad.push(`${row.trace_id ?? `row#${row.id}`}: ${row.trace_id ? "duplicate" : "empty"}`);
  }

  // C8 / C9：按块装载 span 并逐行判定。
  const spansStmt = db.prepare(
    `SELECT access_log_id, trace_id, span_id, parent_span_id, seq, stage, started_at_ms,
            duration_ms, status, reason_code, attrs_json
       FROM access_trace_span
      WHERE access_log_id IN (SELECT value FROM json_each(?))
      ORDER BY access_log_id ASC, seq ASC`
  );
  const integrityBad: string[] = [];
  const timingBad: string[] = [];
  let integrityOk = 0;
  let timingOk = 0;
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    const spansByRow = new Map<number, SpanDbRow[]>();
    for (const span of spansStmt.all(JSON.stringify(chunk.map((r) => r.id))) as SpanDbRow[]) {
      const list = spansByRow.get(span.access_log_id);
      if (list) list.push(span);
      else spansByRow.set(span.access_log_id, [span]);
    }
    for (const row of chunk) {
      const dbSpans = spansByRow.get(row.id) ?? [];
      const spans = dbSpans.map(toSpanLike);
      const problems = [
        ...checkSpanIntegrity(spans),
        ...requiredSpanViolations(row.tool, spans),
        ...(dbSpans.some((s) => s.trace_id !== row.trace_id) ? ["span_trace_id_mismatch"] : [])
      ];
      if (problems.length === 0) integrityOk += 1;
      else if (integrityBad.length < MAX_DIFF_IDS) integrityBad.push(`${row.trace_id ?? `row#${row.id}`}: ${problems.slice(0, 3).join("|")}`);
      const timing = spans.length === 0
        ? ["no_spans"]
        : checkSpanTiming(spans, { tsMs: Date.parse(row.ts), durationMs: row.duration_ms });
      if (timing.length === 0) timingOk += 1;
      else if (timingBad.length < MAX_DIFF_IDS) timingBad.push(`${row.trace_id ?? `row#${row.id}`}: ${timing.slice(0, 3).join("|")}`);
    }
    await yieldToEventLoop();
  }
  const orphanSpans = (db.prepare(
    `SELECT COUNT(*) AS n FROM access_trace_span s LEFT JOIN access_log a ON a.id = s.access_log_id WHERE a.id IS NULL`
  ).get() as { n: number }).n;
  if (orphanSpans > 0) integrityBad.unshift(`orphan_spans=${orphanSpans}`);

  const integrity = finishCheck(integrityOk, rows.length, integrityBad);
  if (orphanSpans > 0 && integrity.status === "pass") integrity.status = "fail";
  return {
    version: SPAN_DERIVATION_VERSION,
    seqUpperBound: upperSeq,
    traceLinked: finishCheck(linkedOk, rows.length, linkedBad),
    spanIntegrity: integrity,
    spanTiming: finishCheck(timingOk, rows.length, timingBad),
    legacyUnlinked,
    unsequenced
  };
}
