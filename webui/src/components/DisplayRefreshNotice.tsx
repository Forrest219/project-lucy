import type { ReactElement } from "react";

/**
 * Spec 195 §7 — a background refresh failed while data is already on screen.
 *
 * The existing data stays exactly as it is (no re-render of the table, no
 * Toast storm). The notice states the failure, the time of the last
 * SUCCESSFUL read and offers a retry. The time comes from the query's
 * `dataUpdatedAt` — the cache build time (`meta.generatedAt`) is a different
 * fact and must never stand in for it.
 */
export type DisplayRefreshQuery = {
  data?: unknown;
  isError: boolean;
  isFetching?: boolean;
  error?: unknown;
  /** React Query: the timestamp of the last successful read. */
  dataUpdatedAt?: number;
  refetch?: () => unknown;
};

/** Local time of the last successful read. */
export function formatLastSuccessfulRead(dataUpdatedAt?: number): string {
  if (!dataUpdatedAt) return "未知";
  const date = new Date(dataUpdatedAt);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN");
}

export function DisplayRefreshNotice({
  query,
  className
}: {
  query: DisplayRefreshQuery;
  className?: string;
}): ReactElement | null {
  // A first load that failed is the existing AsyncRegion's business.
  if (query.data === undefined || !query.isError) return null;
  const classes = ["pl-notice", "pl-display-refresh-notice", className].filter(Boolean).join(" ");
  return (
    <div className={classes} role="status" data-testid="display-refresh-notice">
      <span>刷新失败，当前显示上次成功读取的数据。</span>
      <span className="pl-notice-inline" data-testid="display-refresh-notice-time">
        上次成功读取：{formatLastSuccessfulRead(query.dataUpdatedAt)}
      </span>
      {query.refetch ? (
        <button
          type="button"
          className="pl-btn pl-btn--secondary pl-btn--xs"
          onClick={() => void query.refetch?.()}
          disabled={query.isFetching}
          data-testid="display-refresh-retry"
        >
          重试
        </button>
      ) : null}
    </div>
  );
}
