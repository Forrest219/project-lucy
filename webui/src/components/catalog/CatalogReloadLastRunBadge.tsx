import type { CatalogReloadRun } from "../../lib/types";

export type CatalogReloadLastRunBadgeProps = {
  run?: CatalogReloadRun | null;
  className?: string;
};

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function CatalogReloadLastRunBadge({
  run,
  className
}: CatalogReloadLastRunBadgeProps) {
  if (!run) {
    return (
      <span
        className={`pl-catalog-last-run pl-catalog-last-run--never ${className ?? ""}`.trim()}
        data-testid="catalog-last-run"
        data-state="never"
      >
        上次 Reload：未运行
      </span>
    );
  }

  const time = formatLocalTime(run.startedAt);
  const warningCount = run.warnings.length;
  const state = warningCount > 0 ? "warnings" : run.status;
  const detail =
    warningCount > 0
      ? `${warningCount} 个提示`
      : `${run.tables} 张表`;

  return (
    <span
      className={`pl-catalog-last-run pl-catalog-last-run--${state} ${className ?? ""}`.trim()}
      data-testid="catalog-last-run"
      data-state={state}
      title={`开始于 ${time} · ${run.status} · ${detail}`}
    >
      上次 Reload：{time} · {run.status === "success" ? "成功" : "失败"} · {detail}
    </span>
  );
}
