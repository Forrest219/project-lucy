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
  "重建索引状态",
  "发布 ID"
] as const;

export type PublishHistoryReindexStatusFilter =
  | "success"
  | "failed"
  | "running"
  | "not_run";

export type TriggerLabel = "WebUI 发布" | "WebUI 强制重建索引" | "整批恢复" | "系统";
export type ReindexLabel = "成功" | "失败" | "进行中" | "未执行";

export function coerceTrigger(
  raw: SemanticAssetReleaseTrigger | undefined
): SemanticAssetReleaseTrigger {
  if (raw === "webui_manual_reindex" || raw === "webui_publish" || raw === "webui_restore") return raw;
  return "webui_publish";
}

export function triggerLabelFor(record: SemanticAssetReleaseRecord): TriggerLabel {
  const trigger = coerceTrigger(record.trigger);
  if (trigger === "webui_manual_reindex") return "WebUI 强制重建索引";
  if (trigger === "webui_restore") return "整批恢复";
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
  if (record.terminalAuditPending === true) return "生效待确认";
  switch (record.status as SemanticAssetReleaseStatus) {
    case "blocked":
      return "已阻断";
    case "promoting":
      return "写入中";
    case "promote_failed":
      return "落盘失败";
    case "reindexing":
      return "重建索引中";
    case "published":
      return "已发布";
    case "reindex_failed":
      return "重建索引失败";
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

const SEMANTIC_SOURCE_PATH = /^semantic-layer\/([^/]+)\/([^/]+)\.yaml$/;
const MANIFEST_PATH = /^semantic-layer\/[^/]+\/_schema\/([^/]+)\.yaml$/;

function uniqueNames(names: Array<string | null | undefined>): string[] {
  return Array.from(new Set(names.filter((name): name is string => Boolean(name))));
}

function isSemanticSourceFile(file: SemanticAssetReleaseRecord["files"][number]): boolean {
  if (file.kind === "schemaManifest" || file.targetPath.includes("/_schema/")) return false;
  if (file.kind === "semanticSource") return true;
  return SEMANTIC_SOURCE_PATH.test(file.targetPath);
}

function sourceNameOf(file: SemanticAssetReleaseRecord["files"][number]): string | null {
  const match = SEMANTIC_SOURCE_PATH.exec(file.targetPath);
  if (!match || file.targetPath.includes("/_schema/")) return null;
  return match[2] ?? null;
}

/** Semantic sources whose overlay was readable when the record was written. */
export function writtenSourceNames(record: SemanticAssetReleaseRecord): string[] {
  const semanticFiles = (record.files ?? []).filter(isSemanticSourceFile);
  if (semanticFiles.length > 0) {
    return uniqueNames(semanticFiles.filter((file) => Boolean(file.sha256)).map(sourceNameOf));
  }
  return uniqueNames((record.changedSources ?? []).map((source) => source.sourceName));
}

/** Pending overlay paths that had no content-root file at record time. */
export function removedSourceNames(record: SemanticAssetReleaseRecord): string[] {
  return uniqueNames(
    (record.files ?? []).filter((file) => isSemanticSourceFile(file) && !file.sha256).map(sourceNameOf)
  );
}

export function manifestSchemaNames(record: SemanticAssetReleaseRecord): string[] {
  return uniqueNames(
    (record.files ?? []).map((file) => {
      if (file.kind !== "schemaManifest" && !file.targetPath.includes("/_schema/")) return null;
      return MANIFEST_PATH.exec(file.targetPath)?.[1] ?? null;
    })
  );
}

/** Full change-scope text for CSV (no truncation). */
export function changeScopeTextFor(record: SemanticAssetReleaseRecord): string {
  if (isEmptyManualReindex(record)) return "全库索引重建（无资产变更）";
  const connections = uniqueConnectionIds(record);
  const parts: string[] = [];
  parts.push(connections.length > 0 ? connections.join("、") : "（无连接信息）");
  const written = writtenSourceNames(record);
  const removed = removedSourceNames(record);
  const manifests = manifestSchemaNames(record);
  if (written.length > 0) parts.push(`写入 ${written.join("、")}`);
  if (removed.length > 0) parts.push(`已删除 ${removed.join("、")}`);
  if (manifests.length > 0) parts.push(`Schema Manifest ${manifests.join("、")}`);
  return parts.join(" / ");
}

export function scaleTextFor(record: SemanticAssetReleaseRecord): string {
  if (isEmptyManualReindex(record)) return "—";
  const fileCount = record.files?.length ?? 0;
  const sourceCount = writtenSourceNames(record).length;
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

/** Hide an unconfirmed terminal success from every public payload. */
export function projectPublicRelease<T extends SemanticAssetReleaseRecord>(record: T): T {
  if (record.terminalAuditPending !== true) return record;
  return {
    ...record,
    status: "reindexing",
    activationStatus: "unconfirmed"
  };
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
