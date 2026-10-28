/**
 * audit-trust-2026-10-19-r1 / T05d — ReadonlySqlRowset
 *
 * Contract §5.2 item 6. Renders the SQL row count + columns + bytes for a
 * generated SQL cell, alongside its `usability_status` label. Exists alongside
 * the existing "生成 SQL" cell — never replaces the discoverable entrypoint.
 *
 * Distinct labels:
 *   - not_applicable:    row count does not apply (e.g. schema / metadata calls)
 *   - not_collected:     server did not record the row count
 *   - redacted:          row count suppressed by redaction
 *   - parse_failed:      SQL was generated but failed to parse / run
 *   - unknown:           unknown collection state — do NOT default to 0
 *   - not_supported:     this shape is confirmed not to support the dimension
 *
 * 20261019 §4.4 / U2：六值空值原因的**唯一真源在后端**
 * （`webui/server/proxy/audit-null-reasons.ts`）。本组件直接消费该枚举，
 * 不再维护一份前端局部枚举 —— 否则两边会漂移（前一轮就少了 `not_supported`）。
 */

import { NULL_REASON_LABELS, NULL_REASON_VALUES } from "../../../server/proxy/audit-null-reasons";

export type ReadonlySqlRowsetStatus = (typeof NULL_REASON_VALUES)[number];

export type ReadonlySqlRowsetProps = {
  rows?: number | null;
  cols?: number | null;
  bytes?: number | null;
  status: ReadonlySqlRowsetStatus;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

const STATUS_PALETTE: Record<ReadonlySqlRowsetStatus, string> = {
  not_applicable: "pl-status-neutral",
  not_collected: "pl-status-warning",
  redacted: "pl-status-warning",
  parse_failed: "pl-status-error",
  unknown: "pl-status-neutral",
  not_supported: "pl-status-neutral"
};

export function ReadonlySqlRowset({ rows, cols, bytes, status }: ReadonlySqlRowsetProps) {
  return (
    <div
      className="pl-readonly-sql-rowset"
      data-testid="readonly-sql-rowset"
      data-status={status}
    >
      <span className="pl-readonly-sql-rowset-stat" data-testid="readonly-sql-rows">
        <span className="pl-readonly-sql-rowset-label">行数</span>
        <span className="pl-readonly-sql-rowset-value font-mono notranslate" translate="no">
          {rows === null || rows === undefined ? "—" : String(rows)}
        </span>
      </span>
      <span className="pl-readonly-sql-rowset-stat" data-testid="readonly-sql-cols">
        <span className="pl-readonly-sql-rowset-label">列数</span>
        <span className="pl-readonly-sql-rowset-value font-mono notranslate" translate="no">
          {cols === null || cols === undefined ? "—" : String(cols)}
        </span>
      </span>
      <span className="pl-readonly-sql-rowset-stat" data-testid="readonly-sql-bytes">
        <span className="pl-readonly-sql-rowset-label">字节</span>
        <span className="pl-readonly-sql-rowset-value font-mono notranslate" translate="no">
          {bytes === null || bytes === undefined ? "—" : formatBytes(bytes)}
        </span>
      </span>
      <span
        className={`pl-readonly-sql-rowset-status ${STATUS_PALETTE[status]}`}
        data-testid="readonly-sql-status"
      >
        {NULL_REASON_LABELS[status]}
      </span>
    </div>
  );
}