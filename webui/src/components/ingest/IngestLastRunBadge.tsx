import type { IngestRun } from "../../lib/types";

export type IngestLastRunBadgeProps = {
  run?: IngestRun | null;
  emptyLabel?: string;
  className?: string;
};

const STATUS_LABEL: Record<IngestRun["status"], string> = {
  running: "运行中",
  success: "成功",
  failed: "失败"
};

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function IngestLastRunBadge({ run, emptyLabel = "未运行", className }: IngestLastRunBadgeProps) {
  if (!run) {
    return (
      <span
        className={`pl-ingest-last-run pl-ingest-last-run--never ${className ?? ""}`.trim()}
        data-testid="ingest-last-run"
        data-state="never"
      >
        上次 Ingest：{emptyLabel}
      </span>
    );
  }

  const time = formatLocalTime(run.startedAt);
  const state = run.status;
  const detail =
    state === "failed"
      ? `退出码 ${run.exitCode ?? "?"}`
      : state === "running"
        ? "运行中"
        : typeof run.scannedTableCount === "number"
          ? `${run.scannedTableCount} 张表`
          : "已完成";

  return (
    <span
      className={`pl-ingest-last-run pl-ingest-last-run--${state} ${className ?? ""}`.trim()}
      data-testid="ingest-last-run"
      data-state={state}
      title={`开始于 ${time} · ${STATUS_LABEL[state]} · ${detail}`}
    >
      上次 Ingest：{time} · {STATUS_LABEL[state]} · {detail}
    </span>
  );
}
