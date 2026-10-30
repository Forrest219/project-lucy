/**
 * audit-trust-2026-10-19-r1 / T05b — AuditTopMetaBar
 *
 * Contract §5.2 item 2, presentation in
 * docs/specs/lucy-20261030-audit-context-bar-spec.md.
 * Displays the fixed time window + zone + stats-at + refresh / pause state +
 * audit sync lag. Visible times use the declared zone; raw ISO stays on title
 * and data-iso attributes.
 */

import { type ReactNode } from "react";

export type AuditTopMetaBarProps = {
  fixedStart: string; // ISO 8601
  fixedEnd: string; // ISO 8601
  zone: string; // e.g. "Asia/Shanghai"
  statsAt: string; // ISO 8601
  /** Relative freshness label, e.g. "刚刚". Falls back to the zoned timestamp. */
  statsLabel?: string;
  refreshState: "live" | "paused";
  pauseReason?: string;
  syncLagMs: number;
  /** Optional children for trailing slots (e.g. count badges). */
  trailing?: ReactNode;
};

const TIME_PARTS: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  hourCycle: "h23"
};

function isValidTimeZone(zone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function readZonedParts(iso: string, zone: string): { date: string; time: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions = { ...TIME_PARTS };
  if (isValidTimeZone(zone)) options.timeZone = zone;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", options).formatToParts(date);
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", TIME_PARTS).formatToParts(date);
  }
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}:${value("second")}`
  };
}

export function formatAuditInstant(iso: string, zone: string): string {
  const parts = readZonedParts(iso, zone);
  if (!parts) return iso;
  return `${parts.date} ${parts.time}`;
}

export function formatAuditWindow(startIso: string, endIso: string, zone: string): string {
  const start = readZonedParts(startIso, zone);
  const end = readZonedParts(endIso, zone);
  if (!start || !end) return `${startIso} → ${endIso}`;
  if (start.date === end.date) return `${start.date} ${start.time} → ${end.time}`;
  return `${start.date} ${start.time} → ${end.date} ${end.time}`;
}

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
  statsLabel,
  refreshState,
  pauseReason,
  syncLagMs,
  trailing
}: AuditTopMetaBarProps) {
  const windowLabel = formatAuditWindow(fixedStart, fixedEnd, zone);
  const statsPrecise = formatAuditInstant(statsAt, zone);
  const statsVisible = statsLabel ?? statsPrecise;
  const lagOverdue = syncLagMs > 5000;
  return (
    <div
      className="pl-audit-top-meta-bar"
      data-testid="audit-top-meta-bar"
      data-refresh-state={refreshState}
    >
      <div className="pl-audit-top-meta-facts">
        <div className="pl-audit-top-meta-slot" data-testid="audit-top-meta-window">
          <span className="pl-audit-top-meta-label">窗口</span>
          <span
            className="pl-audit-top-meta-value font-mono notranslate"
            translate="no"
            title={`${fixedStart} → ${fixedEnd}`}
            data-iso-start={fixedStart}
            data-iso-end={fixedEnd}
          >
            {windowLabel}
          </span>
        </div>
        <div className="pl-audit-top-meta-slot">
          <span className="pl-audit-top-meta-label">时区</span>
          <span className="pl-audit-top-meta-zone font-mono notranslate" translate="no" data-testid="audit-top-meta-zone">
            {zone}
          </span>
        </div>
        <div className="pl-audit-top-meta-slot" data-testid="audit-top-meta-stats-at">
          <span className="pl-audit-top-meta-label">统计时间</span>
          <span
            className={statsLabel ? "pl-audit-top-meta-value" : "pl-audit-top-meta-value font-mono notranslate"}
            translate={statsLabel ? undefined : "no"}
            title={`${statsPrecise} (${statsAt})`}
            data-iso={statsAt}
          >
            {statsVisible}
          </span>
        </div>
        <div
          className="pl-audit-top-meta-slot"
          data-testid="audit-top-meta-sync-lag"
          data-lag-ms={syncLagMs}
          data-overdue={lagOverdue}
        >
          <span className="pl-audit-top-meta-label">审计同步延迟</span>
          <span className={lagOverdue ? "pl-audit-top-meta-value pl-status-warning" : "pl-audit-top-meta-value"}>
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
      </div>
      {trailing ? (
        <div className="pl-audit-top-meta-trailing">{trailing}</div>
      ) : null}
    </div>
  );
}
