import { useState } from "react";
import type { IngestRun } from "../../lib/types";

export type IngestDiagnosticsDrawerProps = {
  run: IngestRun | null;
  open: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onCopyLogs?: (run: IngestRun) => void;
};

const STAGE_LABELS: Record<IngestRun["status"], string> = {
  running: "运行中",
  success: "成功",
  failed: "失败"
};

function formatTimestamp(value?: string): string {
  if (!value) return "-";
  return value;
}

function formatDuration(value?: number): string {
  if (value === undefined) return "-";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(2)} s`;
}

function scopeLabel(scope: IngestRun["requestedScope"]): string {
  if (scope === "schema") return "Schema 范围";
  return "连接范围";
}

function tryCopy(run: IngestRun): void {
  const text = [
    `command: ${run.command.join(" ")}`,
    `exitCode: ${run.exitCode ?? "-"}`,
    `--- stdout ---`,
    run.stdout ?? "",
    `--- stderr ---`,
    run.stderr ?? ""
  ].join("\n");
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    void navigator.clipboard.writeText(text).catch(() => undefined);
  }
}

export function IngestDiagnosticsDrawer({
  run,
  open,
  onClose,
  onRetry,
  onCopyLogs
}: IngestDiagnosticsDrawerProps) {
  if (!open || !run) return null;
  const [tab, setTab] = useState<"stderr" | "stdout">("stderr");

  const isFailed = run.status === "failed";
  const title = isFailed ? "Ingest 失败" : "Ingest 日志";

  return (
    <div
      className="pl-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={`ingest-diagnostics-${run.id}`}
    >
      <div className="pl-drawer-panel pl-ingest-diagnostics" data-testid="ingest-diagnostics-panel">
        <header className="pl-drawer-header">
          <div>
            <p className="pl-eyebrow">Ingest 诊断</p>
            <h2 className="pl-panel-title">
              {title} <span className="pl-ingest-diagnostics-conn">· {run.connectionId}</span>
            </h2>
          </div>
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={onClose}
            data-testid="ingest-diagnostics-close"
            aria-label="关闭"
          >
            关闭
          </button>
        </header>

        <section className="pl-drawer-body" aria-label="运行元数据">
          <div className="pl-ingest-diagnostics-grid">
            <div>
              <span>状态</span>
              <strong data-testid="ingest-diagnostics-status">{STAGE_LABELS[run.status]}</strong>
            </div>
            <div>
              <span>范围</span>
              <strong>
                {scopeLabel(run.requestedScope)}
                {run.schema ? ` · ${run.schema}` : ""}
              </strong>
            </div>
            <div>
              <span>执行范围</span>
              <strong>{run.executedScope === "connection" ? "连接级" : "Schema 级"}</strong>
            </div>
            <div>
              <span>退出码</span>
              <strong data-testid="ingest-diagnostics-exitcode">
                {run.exitCode === undefined ? "-" : `退出码 ${run.exitCode}`}
              </strong>
            </div>
            <div>
              <span>开始</span>
              <strong>{formatTimestamp(run.startedAt)}</strong>
            </div>
            <div>
              <span>耗时</span>
              <strong>{formatDuration(run.durationMs)}</strong>
            </div>
            {typeof run.scannedTableCount === "number" ? (
              <div>
                <span>扫描到</span>
                <strong>
                  {run.scannedTableCount} 张表{run.scannedSchemas?.length ? `（${run.scannedSchemas.join(", ")}）` : ""}
                </strong>
              </div>
            ) : null}
            {run.schemaScopedSupported === false ? (
              <div>
                <span>能力</span>
                <strong>当前 KTX 仅支持连接级 ingest</strong>
              </div>
            ) : null}
          </div>

          {run.hint ? (
            <p className="pl-ingest-diagnostics-hint" role="note" data-testid="ingest-diagnostics-hint">
              <strong>提示：</strong>
              {run.hint}
            </p>
          ) : null}

          <div className="pl-log-section" data-testid="ingest-diagnostics-command">
            <p className="pl-log-section-title">命令</p>
            <pre>{run.command.join(" ")}</pre>
          </div>

          <div className="pl-log-section" data-testid="ingest-diagnostics-logs">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className={`pl-btn pl-btn--ghost pl-btn--sm ${tab === "stderr" ? "is-active" : ""}`}
                onClick={() => setTab("stderr")}
                aria-pressed={tab === "stderr"}
                data-testid="ingest-diagnostics-tab-stderr"
              >
                stderr
              </button>
              <button
                type="button"
                className={`pl-btn pl-btn--ghost pl-btn--sm ${tab === "stdout" ? "is-active" : ""}`}
                onClick={() => setTab("stdout")}
                aria-pressed={tab === "stdout"}
                data-testid="ingest-diagnostics-tab-stdout"
              >
                stdout
              </button>
            </div>
            <pre
              data-testid="ingest-diagnostics-stderr"
              hidden={tab !== "stderr"}
            >
              {run.stderr?.trim() || "（无 stderr 输出）"}
            </pre>
            <pre
              data-testid="ingest-diagnostics-stdout"
              hidden={tab !== "stdout"}
            >
              {run.stdout?.trim() || "（无 stdout 输出）"}
            </pre>
          </div>
        </section>

        <footer className="pl-drawer-footer">
          <button
            type="button"
            className="pl-btn pl-btn--ghost"
            onClick={() => (onCopyLogs ? onCopyLogs(run) : tryCopy(run))}
            data-testid="ingest-diagnostics-copy"
          >
            复制日志
          </button>
          {onRetry ? (
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={onRetry}
              data-testid="ingest-diagnostics-retry"
            >
              重试
            </button>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
