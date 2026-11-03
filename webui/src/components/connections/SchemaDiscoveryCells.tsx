import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  DiscoveryStatusResponse,
  LiveTablesResponse,
  TableDiffResponse
} from "../../lib/types";

/**
 * Spec 190 §7.9 — minimal Schema-row presentation of the live table list and
 * of the continuous discovery state.
 *
 * The counts of the four facts stay in separate columns (Spec 190 §5.3):
 * 库内目录 / 库内表清单 / 已发现表数 / 已启用表数 are never merged.
 */

/** Human wording for the closed failure-reason vocabulary (Spec 190 §7.1). */
export const DISCOVERY_REASON_LABELS: Record<string, string> = {
  PROTOCOL_UNSUPPORTED: "连接协议无法识别",
  TABLE_LIST_UNSUPPORTED: "当前数据库类型暂不提供库内表清单",
  CONNECTION_FAILED: "无法连接数据库",
  AUTH_FAILED: "凭据无效或被拒绝",
  SCHEMA_NOT_FOUND: "数据库报告该 Schema 不存在",
  SCHEMA_NOT_VISIBLE: "无法确认该 Schema 是否可见，可能是权限不足",
  TABLE_LIST_TOO_LARGE: "表数量超过单次可读取上限",
  QUERY_FAILED: "查询失败",
  PROBE_QUEUE_FULL: "探测队列已满",
  PROBE_QUEUE_TIMEOUT: "探测排队超时",
  GENERATION_INVALIDATED: "连接配置变更，本次结果作废",
  PROVIDER_UNAVAILABLE: "读取能力不可用",
  SNAPSHOT_WRITE_FAILED: "快照落盘失败"
};

export function discoveryReasonLabel(reason: string | null | undefined): string {
  if (!reason) return "";
  return DISCOVERY_REASON_LABELS[reason] ?? reason;
}

function formatInterval(intervalMs: number): string {
  const minutes = Math.round(intervalMs / 60_000);
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} 小时` : `${hours.toFixed(1)} 小时`;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
}

/**
 * 库内表清单 cell — the entry that expands one Schema's table list.
 *
 * The count comes from the persisted successful snapshot (no database round
 * trip on page load); the list itself is read on demand.
 */
export function LiveTableListCell({
  connectionId,
  schema,
  tableDiff
}: {
  connectionId: string;
  schema: string;
  tableDiff: TableDiffResponse | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  // The payload shape is the API contract, but a partial answer must never
  // take the whole overview page down.
  const snapshotTableCount =
    tableDiff?.schemas?.find((entry) => entry.schema === schema)?.reconciliation
      ?.discoveredInLibrary?.length ?? null;
  const liveTablesQuery = useQuery({
    queryKey: queryKeys.connectionLiveTables(connectionId, schema),
    queryFn: ({ signal }: { signal: AbortSignal }) =>
      apiGet<LiveTablesResponse>(
        `/api/connections/${encodeURIComponent(connectionId)}/live-tables?schema=${encodeURIComponent(schema)}&purpose=manual`,
        { signal }
      ),
    enabled: expanded,
    staleTime: 60_000,
    retry: false
  });

  const live = liveTablesQuery.data;
  const count = live?.status === "ok" ? live.tables.length : snapshotTableCount;
  const reason =
    live?.status === "error" ? discoveryReasonLabel(live.reason) : "";

  return (
    <td className="pl-schema-asset-table-num">
      <button
        type="button"
        className="pl-row-action-link notranslate"
        translate="no"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        data-testid={`live-table-list-toggle-${connectionId}-${schema}`}
        title="展开该 Schema 在库内的表清单"
      >
        {count === null ? "查看表清单" : `${count} 张表`}
      </button>
      {expanded ? (
        <div
          className="pl-schema-live-table-list"
          data-testid={`live-table-list-${connectionId}-${schema}`}
        >
          {liveTablesQuery.isLoading ? (
            <span className="pl-schema-live-table-hint notranslate" translate="no">
              读取中...
            </span>
          ) : liveTablesQuery.isError ? (
            <span className="pl-schema-live-table-hint notranslate" translate="no">
              读取失败
            </span>
          ) : live?.status === "error" ? (
            <span className="pl-schema-live-table-hint notranslate" translate="no">
              {reason || "读取失败"}
            </span>
          ) : (
            <ul className="pl-schema-live-table-items">
              {(live?.tables ?? []).map((entry) => (
                <li key={entry.table} className="pl-schema-live-table-item">
                  <code className="notranslate" translate="no" dir="ltr">
                    {entry.table}
                  </code>
                  <span className="pl-schema-live-table-columns notranslate" translate="no">
                    {entry.columnCount} 列
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </td>
  );
}

/**
 * 持续感知 cell — switch state, last sensing time, interval and the
 * table-list difference counters.
 */
export function DiscoveryStateCell({
  connectionId,
  schema,
  discovery,
  tableDiff
}: {
  connectionId: string;
  schema: string;
  discovery: DiscoveryStatusResponse | undefined;
  tableDiff: TableDiffResponse | undefined;
}) {
  const schemaState = discovery?.schemas?.find((entry) => entry.schema === schema);
  const diffRow = tableDiff?.schemas?.find((entry) => entry.schema === schema);
  const added = diffRow?.listDiff?.added?.length ?? 0;
  const missing = diffRow?.listDiff?.missing?.length ?? 0;
  const columnCountChanged = diffRow?.listDiff?.columnCountChanged?.length ?? 0;
  const hasDiff = added > 0 || missing > 0 || columnCountChanged > 0;

  let stateLabel = "—";
  let stateTone = "muted";
  if (discovery) {
    if (!discovery.enabled) {
      stateLabel = "未开启";
    } else if (schemaState?.status === "paused") {
      stateLabel = "已暂停";
      stateTone = "danger";
    } else if (schemaState?.status === "error") {
      stateLabel = "感知失败";
      stateTone = "danger";
    } else {
      stateLabel = "已开启";
      stateTone = "success";
    }
  }

  const lastCompletedAt = schemaState?.lastCompletedAt ?? null;

  return (
    <td className="pl-schema-asset-table-num">
      <span
        className={`pl-schema-discovery-state pl-schema-discovery-state--${stateTone} notranslate`}
        data-testid={`discovery-state-${connectionId}-${schema}`}
        translate="no"
      >
        {stateLabel}
      </span>
      {discovery?.enabled ? (
        <span className="pl-schema-discovery-meta notranslate" translate="no">
          {lastCompletedAt ? `上次感知 ${formatClock(lastCompletedAt)}` : "尚未感知"}
          {` · 间隔 ${formatInterval(discovery.intervalMs)}`}
        </span>
      ) : null}
      {schemaState?.status === "paused" && schemaState.lastReason ? (
        <span
          className="pl-schema-discovery-reason notranslate"
          data-testid={`discovery-paused-reason-${connectionId}-${schema}`}
          translate="no"
        >
          {discoveryReasonLabel(schemaState.lastReason)}
        </span>
      ) : null}
      {hasDiff ? (
        <span
          className="pl-schema-discovery-diff notranslate"
          data-testid={`table-diff-count-${connectionId}-${schema}`}
          translate="no"
        >
          新增 {added} · 已消失 {missing} · 列数变化 {columnCountChanged}
        </span>
      ) : null}
    </td>
  );
}
