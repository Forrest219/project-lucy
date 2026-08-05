/**
 * Shared labels / CSV helpers for `/publish/history` (Spec 113).
 * Imported by both WebUI and server export route.
 */

import type {
  SemanticAssetReleaseRecord,
  SemanticAssetReleaseStatus,
  SemanticAssetReleaseTrigger
} from "./types";

export const PUBLISH_HISTORY_PAGE_SIZE = 20;

export const PUBLISH_HISTORY_CSV_HEADERS = [
  "序号",
  "发布时间",
  "发布状态",
  "触发方式",
  "操作人",
  "变更范围",
  "规模",
  "Reindex 状态",
  "发布 ID"
] as const;

export type PublishHistoryReindexStatusFilter =
  | "success"
  | "failed"
  | "running"
  | "not_run";

export type TriggerLabel = "WebUI 发布" | "WebUI 强制重建索引" | "系统";
export type ReindexLabel = "成功" | "失败" | "进行中" | "未执行";

export function coerceTrigger(
  raw: SemanticAssetReleaseTrigger | undefined
): SemanticAssetReleaseTrigger {
  if (raw === "webui_manual_reindex" || raw === "webui_publish") return raw;
  return "webui_publish";
}

export function triggerLabelFor(record: SemanticAssetReleaseRecord): TriggerLabel {
  const trigger = coerceTrigger(record.trigger);
  if (trigger === "webui_manual_reindex") return "WebUI 强制重建索引";
  if (trigger === "webui_publish") return "WebUI 发布";
  return "系统";
}

export function reindexLabelFor(record: SemanticAssetReleaseRecord): ReindexLabel {
  if (record.status === "reindexing") return "进行中";
  if (record.reindex) return record.reindex.ok ? "成功" : "失败";
  return "未执行";
}

export function reindexStatusFilterValue(
  record: SemanticAssetReleaseRecord
): PublishHistoryReindexStatusFilter {
  const label = reindexLabelFor(record);
  switch (label) {
    case "成功":
      return "success";
    case "失败":
      return "failed";
    case "进行中":
      return "running";
    case "未执行":
    default:
      return "not_run";
  }
}

export function statusLabelFor(record: SemanticAssetReleaseRecord): string {
  switch (record.status as SemanticAssetReleaseStatus) {
    case "blocked":
      return "已阻断";
    case "promote_failed":
      return "落盘失败";
    case "reindexing":
      return "Reindex 中";
    case "published":
      return "已发布";
    case "reindex_failed":
      return "Reindex 失败";
    default:
      return record.status;
  }
}

export function uniqueConnectionIds(record: SemanticAssetReleaseRecord): string[] {
  const fromField = record.connectionIds ?? [];
  const fromSources = (record.changedSources ?? []).map((s) => s.connectionId);
  return Array.from(new Set([...fromField, ...fromSources].filter(Boolean)));
}

export function hasAssetChanges(record: SemanticAssetReleaseRecord): boolean {
  return (
    uniqueConnectionIds(record).length > 0 ||
    (record.changedSources?.length ?? 0) > 0 ||
    (record.files?.length ?? 0) > 0
  );
}

export function isEmptyManualReindex(record: SemanticAssetReleaseRecord): boolean {
  return coerceTrigger(record.trigger) === "webui_manual_reindex" && !hasAssetChanges(record);
}

/** Full change-scope text for CSV (no truncation). */
export function changeScopeTextFor(record: SemanticAssetReleaseRecord): string {
  if (isEmptyManualReindex(record)) return "全库索引重建（无资产变更）";
  const connections = uniqueConnectionIds(record);
  const sources = Array.from(
    new Set((record.changedSources ?? []).map((s) => s.sourceName).filter(Boolean))
  );
  const parts: string[] = [];
  if (connections.length > 0) parts.push(connections.join("、"));
  else parts.push("（无连接信息）");
  if (sources.length > 0) parts.push(sources.join("、"));
  return parts.join(" / ");
}

export function scaleTextFor(record: SemanticAssetReleaseRecord): string {
  if (isEmptyManualReindex(record)) return "—";
  const fileCount = record.files?.length ?? 0;
  const sourceCount = record.changedSources?.length ?? 0;
  return `文件 ${fileCount} · 语义源 ${sourceCount}`;
}

export function formatPublishHistoryTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** Export filename stamp: YYYYMMDD-HHmmss in Asia/Shanghai. */
export function formatPublishHistoryExportFilenameStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}${get("month")}${get("day")}-${get("hour")}${get("minute")}${get("second")}`;
}

function csvCell(value: unknown): string {
  const raw = value == null ? "" : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export function buildPublishHistoryCsvRows(
  records: SemanticAssetReleaseRecord[]
): string {
  const lines = [
    PUBLISH_HISTORY_CSV_HEADERS.join(","),
    ...records.map((record, index) =>
      [
        csvCell(index + 1),
        csvCell(formatPublishHistoryTs(record.createdAt)),
        csvCell(statusLabelFor(record)),
        csvCell(triggerLabelFor(record)),
        csvCell(record.actor || "unknown"),
        csvCell(changeScopeTextFor(record)),
        csvCell(scaleTextFor(record)),
        csvCell(reindexLabelFor(record)),
        csvCell(record.id)
      ].join(",")
    )
  ];
  return `${lines.join("\n")}\n`;
}
