import { useState } from "react";
import type { IngestRun } from "../../lib/types";

export type IngestResultPanelProps = {
  run: IngestRun;
  // The DOM id used to anchor the toggle button. Tests use this to assert the
  // panel reacts to user input even though the markup is shared.
  testIdPrefix?: string;
  // Override the empty fallback copy (the modal drawer also uses this for
  // consistent "no output" handling).
  emptyOutputLabel?: string;
};

function ingestFailureHintLocal(run: IngestRun): string {
  if (run.hint) return run.hint;
  const output = `${run.stderr ?? ""}\n${run.stdout ?? ""}`;
  if (!output.trim()) return "ktx ingest 未返回任何日志，请检查 KTX 运行时与连接配置。";
  const lower = output.toLowerCase();
  if (lower.includes("is not configured")) {
    return `当前项目的 ktx.yaml 中没有配置连接 ${run.connectionId}，请确认 WebUI 指向的项目根和连接 ID 是否一致。`;
  }
  if (lower.includes("unknown database") || lower.includes("does not exist")) {
    return "物理 schema/database 可能不存在，请确认库名已创建且已写入 ktx.yaml。";
  }
  if (lower.includes("access denied") || lower.includes("permission denied") || lower.includes("privilege")) {
    return "数据库账号可能缺少访问权限，请确认具备 SHOW TABLES 以及读取目标库表结构的权限。";
  }
  if (lower.includes("0 tables") || lower.includes("no tables")) {
    return "目标 schema/database 未扫描到表，请确认库中存在可见表。";
  }
  return "ktx ingest 返回非 0 退出码，请展开原始日志查看 stderr/stdout。";
}

/**
 * Compact, inline failure panel used inside the Add Schema drawer. The full
 * `IngestDiagnosticsDrawer` is a slide-over; this component keeps the
 * collapsible stdout/stderr pattern that the drawer already exposed.
 */
export function IngestResultPanel({
  run,
  testIdPrefix = "ingest-result",
  emptyOutputLabel = "（ktx 未返回 stdout/stderr）"
}: IngestResultPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const stderr = run.stderr?.trim() ?? "";
  const stdout = run.stdout?.trim() ?? "";
  const hint = ingestFailureHintLocal(run);
  const failed = run.status === "failed";

  if (!failed) {
    return (
      <p className="text-sm text-fg-muted" data-testid={`${testIdPrefix}-success`}>
        ingest {run.connectionId} 完成（{run.scannedTableCount ?? 0} 张表）。
      </p>
    );
  }

  return (
    <div
      className="pl-drawer-error"
      role="alert"
      data-testid={`${testIdPrefix}-failed`}
    >
      <p className="font-semibold">
        ingest {run.connectionId} 失败（退出码 {run.exitCode ?? "?"}）
      </p>
      <p>{hint}</p>
      <button
        type="button"
        className="pl-btn pl-btn--ghost"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        data-testid={`${testIdPrefix}-toggle`}
      >
        {expanded ? "隐藏 ingest 日志" : "查看 ingest 日志"}
      </button>
      {expanded ? (
        <div className="grid gap-2" data-testid={`${testIdPrefix}-detail`}>
          {stderr ? (
            <section>
              <p className="font-semibold">stderr</p>
              <pre>{stderr}</pre>
            </section>
          ) : null}
          {stdout ? (
            <section>
              <p className="font-semibold">stdout</p>
              <pre>{stdout}</pre>
            </section>
          ) : null}
          {!stderr && !stdout ? <pre>{emptyOutputLabel}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
