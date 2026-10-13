import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

/** Spec 174 §4.1 — local loading text only appears after this delay. */
export const ASYNC_REGION_HINT_DELAY_MS = 120;

export type AsyncRegionStatus = "pending" | "error" | "success";

export function useDelayedFlag(active: boolean, delayMs = ASYNC_REGION_HINT_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [active, delayMs]);
  return active && shown;
}

type AsyncRegionProps = {
  status: AsyncRegionStatus;
  /** Region noun used in the loading / error copy, e.g. 「连接列表」. */
  label: string;
  error?: unknown;
  onRetry?: () => void;
  /** Stable placeholder size so real content does not shift the layout. */
  minHeight?: CSSProperties["minHeight"];
  className?: string;
  children?: ReactNode;
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "未知错误";
}

/**
 * Spec 174 §4.1 — one independently ready page region. The placeholder is
 * static (no animation) and appears immediately; the loading text appears
 * after 120 ms; errors stay inside the region with a retry action. Success
 * renders children only, so real-content selectors never match a placeholder.
 */
export function AsyncRegion({ status, label, error, onRetry, minHeight, className, children }: AsyncRegionProps) {
  const showHint = useDelayedFlag(status === "pending");
  if (status === "success") return <>{children}</>;
  const classes = ["pl-async-region", `pl-async-region--${status}`, className].filter(Boolean).join(" ");
  if (status === "error") {
    return (
      <div className={classes} style={{ minHeight }} role="alert" data-testid="async-region-error">
        <p className="pl-error">{label}加载失败：{errorMessage(error)}</p>
        {onRetry ? (
          <button type="button" className="pl-btn pl-btn--secondary pl-btn--xs" onClick={onRetry} data-testid="async-region-retry">
            重试
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <div className={classes} style={{ minHeight }} aria-busy="true" aria-label={label} data-testid="async-region-pending">
      {showHint ? <p className="pl-notice pl-async-region-hint">正在加载{label}…</p> : null}
    </div>
  );
}

/** Data already on screen stays visible during refetch and after a failed refetch. */
export function asyncStatus(query: { isError: boolean; data?: unknown }): AsyncRegionStatus {
  if (query.data !== undefined) return "success";
  return query.isError ? "error" : "pending";
}
