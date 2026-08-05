/** Spec 108 — shared latency / connectivity health copy for card + drawer. */

import type { ConnectionTestResult } from "./types";

export type LatencyTone = "muted" | "success" | "warning" | "danger";

export type LatencyToneResult = {
  label: string;
  tone: LatencyTone;
};

/** Diagnostic panel banner labels (保留「正常」). */
export function latencyTone(latencyMs: number | undefined): LatencyToneResult {
  if (latencyMs === undefined) return { label: "未返回", tone: "muted" };
  if (latencyMs < 200) return { label: "正常", tone: "success" };
  if (latencyMs <= 1000) return { label: "偏慢", tone: "warning" };
  return { label: "需关注", tone: "danger" };
}

/**
 * Card summary status label (Spec 108): shorten ok+fast to 「通」 for scan width.
 * error path uses 「不通」 at the call site when status !== ok.
 */
export function connectionHealthStatusLabel(
  status: "ok" | "error" | undefined,
  latencyMs: number | undefined
): LatencyToneResult {
  if (status === "error" || status === undefined) {
    return { label: "不通", tone: "danger" };
  }
  const panel = latencyTone(latencyMs);
  if (panel.label === "正常") return { label: "通", tone: "success" };
  return panel;
}

export function formatProbeClock(isoOrMs: number | string): string {
  const date = typeof isoOrMs === "number" ? new Date(isoOrMs) : new Date(isoOrMs);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("hour")}:${value("minute")}`;
}

/** Synthetic error result when the probe request itself fails (HTTP / network). */
export function connectionHealthProbeErrorResult(
  connId: string,
  error: unknown
): ConnectionTestResult {
  const message = error instanceof Error ? error.message : "连通探测失败";
  return {
    status: "error",
    reason: message,
    command: `ktx connection test ${connId}`,
    args: ["connection", "test", connId],
    exitCode: null,
    stdout: "",
    stderr: message
  };
}

/**
 * Drawer must not show「尚未测试」when the card already reports failure.
 * If React Query keeps a stale ok payload after a failed refetch, prefer the error.
 */
export function connectionHealthDrawerResult(
  connId: string,
  data: ConnectionTestResult | undefined,
  isError: boolean,
  error: unknown
): ConnectionTestResult | null {
  if (isError && (!data || data.status === "ok")) {
    return connectionHealthProbeErrorResult(connId, error);
  }
  return data ?? null;
}
