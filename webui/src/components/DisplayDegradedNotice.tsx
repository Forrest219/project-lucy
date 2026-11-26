import type { ReactElement } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useDisplayInfo, type DisplayInfo } from "../lib/displayState";

/**
 * P1-75 X5 — degraded-read notice (交互合同 §2–§4, 术语标准 §4.6.1).
 *
 * One neutral `pl-notice` line placed under the page header or inside the affected section.
 * Main sentence is one of 「数据可能不是最新」「正在加载…」「长时间未更新」; the only secondary text
 * is 「约 N 分钟前更新」 (omitted below one minute). Internal state words, reason codes,
 * milliseconds and view generations never reach the DOM text; the `data-display-state`
 * attribute is for tests / UAT counting only.
 */
export const DEGRADED_COPY = {
  stale: "数据可能不是最新",
  pending: "正在加载…",
  prolonged: "长时间未更新",
  refresh: "刷新"
} as const;

/** 「约 N 分钟前更新」, N floored to minutes; null below one minute or without an age. */
export function formatDisplayAge(ageMs: number | undefined): string | null {
  if (ageMs === undefined || !Number.isFinite(ageMs)) return null;
  const minutes = Math.floor(ageMs / 60_000);
  return minutes >= 1 ? `约 ${minutes} 分钟前更新` : null;
}

/** Main sentence for a degraded state; `pendingText` lets a page keep its own pending copy (P1-80). */
export function degradedMainText(info: DisplayInfo, pendingText: string = DEGRADED_COPY.pending): string {
  if (info.prolonged) return DEGRADED_COPY.prolonged;
  return info.state === "pending" ? pendingText : DEGRADED_COPY.stale;
}

/**
 * True only while a read is actually in flight. React Query keeps `isFetching` set while a
 * `pending` read waits between polls (failureCount > 0); the refresh button must stay usable then.
 */
export function displayRefreshing(...queries: Array<{ isFetching: boolean; failureCount?: number }>): boolean {
  return queries.some((query) => query.isFetching && !(query.failureCount && query.failureCount > 0));
}

export function DisplayDegradedNotice({
  paths,
  queryKeys,
  onRefresh,
  refreshing = false,
  pendingText,
  className,
  testId = "display-degraded-notice"
}: {
  /** Region keys (request pathnames, see DISPLAY_REGION_PATHS) this notice covers. */
  paths: readonly string[];
  /**
   * Queries behind the covered regions. 刷新 cancels a waiting `pending` poll of these first
   * (React Query would otherwise ignore a refetch until the next poll), then runs onRefresh.
   */
  queryKeys?: readonly QueryKey[];
  /** Re-read only the covered regions; no write, no permission change. */
  onRefresh?: () => unknown;
  refreshing?: boolean;
  /** Pending main sentence override, e.g. 「正在读取表清单…」 on the enabled-tables page. */
  pendingText?: string;
  className?: string;
  testId?: string;
}): ReactElement | null {
  const info = useDisplayInfo(paths);
  const client = useQueryClient();
  if (!info) return null;
  const refresh = async () => {
    // Only a query still waiting between pending polls is cancelled; a query with data refetches itself.
    await Promise.all(
      (queryKeys ?? [])
        .filter((queryKey) => client.getQueryCache().findAll({ queryKey }).some((query) => query.state.data === undefined && query.state.fetchStatus === "fetching"))
        .map((queryKey) => client.cancelQueries({ queryKey }))
    );
    await onRefresh?.();
  };
  const age = info.state === "pending" ? null : formatDisplayAge(info.ageMs);
  const classes = ["pl-notice", "pl-display-degraded-notice", className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" aria-live="polite" data-testid={testId} data-display-state={info.state} data-display-prolonged={info.prolonged ? "1" : undefined}>
      <span data-testid={`${testId}-text`}>{degradedMainText(info, pendingText)}</span>
      {age ? (
        <span className="pl-notice-inline" data-testid={`${testId}-age`}>
          {age}
        </span>
      ) : null}
      {onRefresh ? (
        <button
          type="button"
          className="pl-btn pl-btn--secondary pl-btn--xs"
          onClick={() => void refresh()}
          disabled={refreshing}
          data-testid={`${testId}-refresh`}
        >
          {DEGRADED_COPY.refresh}
        </button>
      ) : null}
    </div>
  );
}
