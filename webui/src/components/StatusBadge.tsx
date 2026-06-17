import type { CompletionStatus } from "../lib/types";

const LABELS: Record<CompletionStatus, string> = {
  not_started: "未开始",
  partial: "部分完成",
  done: "已完成",
  validation_failed: "校验失败"
};

export function StatusBadge({ status }: { status: CompletionStatus }) {
  return <span className={`status-badge status-${status}`}>{LABELS[status]}</span>;
}
