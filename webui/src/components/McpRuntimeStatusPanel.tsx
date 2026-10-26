import type { ReactNode } from "react";
import type {
  ExecutionRuntimeStatus,
  McpRuntimeCanaryResult,
  McpRuntimeReloadResult,
  McpRuntimeStatus
} from "../lib/types";

type StatusTone = "done" | "partial" | "validation_failed" | "not_started";

type RuntimeChip = {
  label: string;
  value: string;
  tone: StatusTone;
};

function executionStatusForConnection(
  status: McpRuntimeStatus | undefined,
  connectionId: string,
  canary: McpRuntimeCanaryResult | undefined
): ExecutionRuntimeStatus {
  if (canary?.connectionId === connectionId) {
    if (canary.executionRuntimeAck) return "ok";
    if (canary.decisionReason === "execution_config_stale") return "stale";
    if (canary.decisionReason === "execution_runtime_unavailable") return "unavailable";
    if (canary.decisionReason === "upstream_error") return "error";
    return "unknown";
  }
  if (status?.execution?.missingConnections?.includes(connectionId)) return "stale";
  if (status?.execution?.loadedConnectionIds?.includes(connectionId)) return "ok";
  return status?.execution?.status ?? "unknown";
}

function executionChip(status: ExecutionRuntimeStatus): Pick<RuntimeChip, "value" | "tone"> {
  if (status === "ok") return { value: "已确认", tone: "done" };
  if (status === "stale") return { value: "未加载", tone: "validation_failed" };
  if (status === "unavailable") return { value: "不可用", tone: "validation_failed" };
  if (status === "error") return { value: "异常", tone: "validation_failed" };
  return { value: "待确认", tone: "partial" };
}

/**
 * Spec 191 §5/§14 — the reload result is reported as three separate facts.
 * They are never merged into one "ok".
 */
function reloadOutcomeText(result: McpRuntimeReloadResult): string {
  if (result.reloadStatus === "unsupported") {
    return result.detail ?? "当前部署不支持执行层重载";
  }
  if (result.reloadStatus === "already_running") {
    return result.detail ?? "上一次执行层重载仍在进行中";
  }
  if (result.reloadStatus === "failed") {
    return result.detail ?? "执行层重载失败";
  }
  if (result.configVerification === "verified") {
    return "执行层重载完成，目标配置已通过连接级验证";
  }
  if (result.configVerification === "failed") {
    return result.detail ?? "执行层已重启，但目标配置未通过连接级验证";
  }
  return result.detail ?? "执行层已重启，配置验证未完成";
}

export function McpRuntimeStatusPanel({
  status,
  connectionId,
  canary,
  pending = false,
  error,
  controls,
  compact = false,
  onRecheck,
  onReload,
  reloadPending = false,
  reloadResult
}: {
  status?: McpRuntimeStatus;
  connectionId: string;
  canary?: McpRuntimeCanaryResult;
  pending?: boolean;
  error?: string;
  controls?: ReactNode;
  compact?: boolean;
  onRecheck: () => void;
  /** Spec 191 — the owner confirmed action that reloads the execution layer. */
  onReload?: () => void;
  reloadPending?: boolean;
  reloadResult?: McpRuntimeReloadResult;
}) {
  const testConnectionId = connectionId || "unselected";
  const configured = Boolean(connectionId && status?.config?.connectionIds?.includes(connectionId));
  const catalogRun = connectionId ? status?.catalog?.lastByConnection?.[connectionId] : undefined;
  const executionStatus = executionStatusForConnection(status, connectionId, canary);
  const execution = executionChip(executionStatus);
  const chips: RuntimeChip[] = [
    {
      label: "Config",
      value: !connectionId
        ? "—"
        : configured
          ? "已读取"
          : status
            ? "缺失"
            : "加载中",
      tone: !connectionId
        ? "not_started"
        : configured
          ? "done"
          : status
            ? "validation_failed"
            : "not_started"
    },
    {
      label: "Catalog",
      value: !connectionId
        ? "—"
        : catalogRun?.status === "success"
          ? "已同步"
          : catalogRun
            ? "失败"
            : "待同步",
      tone: !connectionId
        ? "not_started"
        : catalogRun?.status === "success"
          ? "done"
          : catalogRun
            ? "validation_failed"
            : "partial"
    },
    {
      label: "Policy Runtime",
      value: status?.policy?.healthy ? "已确认" : status ? "降级" : "加载中",
      tone: status?.policy?.healthy ? "done" : status ? "validation_failed" : "not_started"
    },
    { label: "MCP Execution", ...execution }
  ];
  const canaryNeedsRuntimeRemediation = Boolean(
    canary && [
      "execution_config_stale",
      "execution_canary_blocked",
      "execution_runtime_unavailable",
      "upstream_error"
    ].includes(canary.decisionReason)
  );
  const unacknowledged = Boolean(
    connectionId && (executionStatus === "stale" || canaryNeedsRuntimeRemediation)
  );
  // Spec 191 §14 — 「待重载」 is the configuration state, not the operation state.
  const reloadRequired = status?.execution?.activation === "reload_required";
  const reloadRunning = reloadPending || status?.execution?.reload?.state === "running";
  const reloadOutcome = reloadResult ? reloadOutcomeText(reloadResult) : undefined;

  return (
    <section
      className={compact ? "grid gap-2" : "pl-panel grid gap-3"}
      data-testid={`mcp-runtime-status-${testConnectionId}`}
      aria-label="执行运行时状态"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap" data-testid="mcp-runtime-status-chips">
          {chips.map((chip) => (
            <span key={chip.label} className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <span className="notranslate" translate="no">{chip.label}</span>
              <span className={`pl-status-badge pl-status-${chip.tone}`}>{chip.value}</span>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {controls}
          <button
            type="button"
            className="pl-btn pl-btn--secondary"
            disabled={!connectionId || pending}
            data-loading={pending ? "true" : undefined}
            aria-busy={pending}
            data-testid={`mcp-runtime-recheck-${testConnectionId}`}
            onClick={onRecheck}
          >
            {pending ? "检测中..." : "重新检测执行层"}
          </button>
          {onReload ? (
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              disabled={reloadRunning}
              data-loading={reloadRunning ? "true" : undefined}
              aria-busy={reloadRunning}
              data-testid={`mcp-runtime-reload-${testConnectionId}`}
              onClick={onReload}
            >
              {reloadRunning ? "重载中..." : "重载执行层"}
            </button>
          ) : null}
        </div>
      </div>

      {unacknowledged || reloadRequired ? (
        <p className="pl-notice text-sm" role="status" data-testid="mcp-runtime-remediation">
          {onReload
            ? "配置已写入，执行层尚未加载。可点「重载执行层」使其生效。"
            : "配置已写入，执行层尚未加载。"}
        </p>
      ) : null}
      {reloadOutcome ? (
        <p
          className="text-sm"
          role="status"
          data-testid="mcp-runtime-reload-outcome"
        >
          {reloadOutcome}
        </p>
      ) : null}
      {error ? <p className="pl-error text-sm">运行时状态读取失败：{error}</p> : null}
      {canary?.remediation && !unacknowledged ? (
        <p className="text-xs text-fg-muted">{canary.remediation.detail}</p>
      ) : null}
    </section>
  );
}
