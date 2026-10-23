/**
 * audit-trust-2026-10-19-r1 / T05b — AuditTopMetaBar
 *
 * Contract §5.2 item 2. Displays the fixed time window + zone + stats-at +
 * refresh / pause state + audit sync lag. Never lets the user think "this is
 * the latest" when sync is behind; the lag figure is mandatory.
 */

import { type ReactNode } from "react";

export type AuditTopMetaBarProps = {
  fixedStart: string; // ISO 8601
  fixedEnd: string; // ISO 8601
  zone: string; // e.g. "Asia/Shanghai"
  statsAt: string; // ISO 8601
  refreshState: "live" | "paused";
  pauseReason?: string;
  syncLagMs: number;
  /** Optional children for trailing slots (e.g. count badges). */
  trailing?: ReactNode;
};

function formatLag(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} min`;
}

export function AuditTopMetaBar({
  fixedStart,
  fixedEnd,
  zone,
  statsAt,
  refreshState,
  pauseReason,
  syncLagMs,
  trailing
}: AuditTopMetaBarProps) {
  return (
    <div
      className="pl-audit-top-meta-bar"
      data-testid="audit-top-meta-bar"
      data-refresh-state={refreshState}
    >
      <div className="pl-audit-top-meta-slot" data-testid="audit-top-meta-window">
        <span className="pl-audit-top-meta-label">窗口</span>
        <span className="pl-audit-top-meta-value font-mono notranslate" translate="no">
          {fixedStart} → {fixedEnd}
        </span>
        <span className="pl-audit-top-meta-zone" data-testid="audit-top-meta-zone">
          {zone}
        </span>
      </div>
      <div className="pl-audit-top-meta-slot" data-testid="audit-top-meta-stats-at">
        <span className="pl-audit-top-meta-label">统计时间</span>
        <span className="pl-audit-top-meta-value font-mono notranslate" translate="no">
          {statsAt}
        </span>
      </div>
      <div
        className="pl-audit-top-meta-slot"
        data-testid="audit-top-meta-sync-lag"
        data-lag-ms={syncLagMs}
        data-overdue={syncLagMs > 5000}
      >
        <span className="pl-audit-top-meta-label">审计同步延迟</span>
        <span
          className={
            syncLagMs > 5000
              ? "pl-audit-top-meta-value pl-status-warning"
              : "pl-audit-top-meta-value"
          }
        >
          {formatLag(syncLagMs)}
        </span>
      </div>
      <div
        className="pl-audit-top-meta-slot"
        data-testid="audit-top-meta-refresh"
        data-state={refreshState}
      >
        <span className="pl-audit-top-meta-label">刷新</span>
        <span className="pl-audit-top-meta-value">
          {refreshState === "live" ? "实时" : `已暂停${pauseReason ? `（${pauseReason}）` : ""}`}
        </span>
      </div>
      {trailing ? (
        <div className="pl-audit-top-meta-trailing">{trailing}</div>
      ) : null}
    </div>
  );
}