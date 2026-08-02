import { useState } from "react";
import type { ConnectionInfo, ConnectionTestResult } from "../../lib/types";

type LatencyTone = "muted" | "success" | "warning" | "danger";

function latencyTone(latencyMs: number | undefined): { label: string; tone: LatencyTone } {
  if (latencyMs === undefined) return { label: "未返回", tone: "muted" };
  if (latencyMs < 200) return { label: "正常", tone: "success" };
  if (latencyMs <= 1000) return { label: "偏慢", tone: "warning" };
  return { label: "需关注", tone: "danger" };
}

function protocolLabel(protocol: ConnectionInfo["wireProtocol"]): string {
  if (protocol === "mysql") return "MySQL Wire";
  if (protocol === "postgres") return "Postgres Wire";
  if (protocol === "native") return "Native";
  return "Unknown";
}

function engineDisplay(engine: string | undefined, driver: string | undefined): string {
  const normalized = (engine ?? driver ?? "").toLowerCase();
  if (normalized === "mysql") return "MySQL";
  if (normalized === "postgres" || normalized === "postgresql") return "Postgres";
  if (normalized === "doris") return "Doris";
  if (normalized === "starrocks") return "StarRocks";
  return "DB";
}

function accessModeLabel(readOnlyExpected: boolean | undefined): string {
  return readOnlyExpected ? "Read-Only (受控访问)" : "未声明";
}

function rawLogSections(result: ConnectionTestResult): Array<{ label: string; value: string }> {
  const primary = [
    { label: "stdout", value: result.stdout ?? "" },
    { label: "stderr", value: result.stderr ?? "" }
  ].filter((section) => section.value.trim().length > 0);
  if (primary.length > 0) return primary;
  return [
    { label: "detail", value: result.detail ?? "" },
    { label: "reason", value: result.reason ?? "" }
  ].filter((section) => section.value.trim().length > 0);
}

function commandFor(connection: ConnectionInfo, result: ConnectionTestResult): string {
  return result.command || `ktx connection test ${connection.id}`;
}

function logCopyText(connection: ConnectionInfo, result: ConnectionTestResult): string {
  const command = commandFor(connection, result);
  return [
    `$ ${command}`,
    "",
    "[stdout]",
    result.stdout || "",
    "",
    "[stderr]",
    result.stderr || "",
    ...(result.detail && !result.stdout ? ["", "[detail]", result.detail] : []),
    ...(result.reason && !result.stderr ? ["", "[reason]", result.reason] : [])
  ].join("\n");
}

export type ConnectionTestResultPanelProps = {
  connection: ConnectionInfo;
  result: ConnectionTestResult | null;
  isPending: boolean;
  logsExpanded: boolean;
  onToggleLogs: () => void;
};

export function ConnectionTestResultPanel({
  connection,
  result,
  isPending,
  logsExpanded,
  onToggleLogs
}: ConnectionTestResultPanelProps) {
  const [copyStatus, setCopyStatus] = useState("");
  const latency = latencyTone(result?.latencyMs);
  const logSections = result ? rawLogSections(result) : [];
  const command = result ? commandFor(connection, result) : `ktx connection test ${connection.id}`;

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard?.writeText(text);
      setCopyStatus(message);
    } catch {
      setCopyStatus("复制失败，请手动选择文本");
    }
  }

  let bannerText: string;
  let bannerClass: string;
  if (isPending) {
    bannerText = "正在测试连接...";
    bannerClass = "pl-diagnostic-banner pl-diagnostic-banner--muted";
  } else if (result === null) {
    bannerText = "尚未测试";
    bannerClass = "pl-diagnostic-banner pl-diagnostic-banner--muted";
  } else if (result.status === "ok") {
    bannerText = "连接成功 (Connection Passed)";
    bannerClass = "pl-diagnostic-banner pl-diagnostic-banner--success";
  } else {
    bannerText = "连接失败 (Connection Failed)";
    bannerClass = "pl-diagnostic-banner pl-diagnostic-banner--danger";
  }

  return (
    <div className="pl-diagnostic-panel" data-testid="connection-test-panel" data-connection={connection.id}>
      <div
        className={bannerClass}
        role="status"
        aria-live="polite"
        data-testid="connection-test-banner"
      >
        <strong>{bannerText}</strong>
        {result && result.latencyMs !== undefined && (
          <span data-testid="connection-test-latency">
            响应延时: {result.latencyMs} ms
          </span>
        )}
        {result && (
          <span className={`pl-latency-badge pl-latency-badge--${latency.tone}`}>
            {latency.label}
          </span>
        )}
      </div>

      {result && (
        <div className="pl-diagnostic-grid" data-testid="connection-test-metadata">
          <div>
            <span>数据库驱动</span>
            <strong className="notranslate" translate="no">{engineDisplay(connection.engine, connection.driver)}</strong>
          </div>
          <div>
            <span>传输协议</span>
            <strong className="notranslate" translate="no">{protocolLabel(connection.wireProtocol)}</strong>
          </div>
          <div>
            <span>访问模式</span>
            <strong>{accessModeLabel(connection.readOnlyExpected)}</strong>
          </div>
          <div>
            <span>退出码</span>
            <strong className="notranslate" translate="no" data-testid="connection-test-exit-code">
              {result.exitCode ?? "未返回"}
            </strong>
          </div>
        </div>
      )}

      {result && (
        <div
          className="pl-collapsible-log notranslate"
          role="region"
          aria-label="原始诊断日志 (ktx connection test stdout/stderr)"
          data-testid="connection-test-log"
          translate="no"
        >
          <div className="pl-raw-log-toolbar">
            <code data-testid="connection-test-command">{command}</code>
            <div className="pl-raw-log-actions">
              <button
                type="button"
                className="pl-btn pl-btn--ghost pl-btn--sm"
                onClick={() => void copyText(command, "命令已复制")}
              >
                复制命令
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--ghost pl-btn--sm"
                onClick={() => void copyText(logCopyText(connection, result), "Log 已复制")}
              >
                复制 Log
              </button>
            </div>
          </div>
          {copyStatus ? (
            <span className="text-xs text-fg-muted" role="status" aria-live="polite">
              {copyStatus}
            </span>
          ) : null}
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-sm notranslate"
            aria-expanded={logsExpanded}
            onClick={onToggleLogs}
            translate="no"
          >
            原始诊断日志 (ktx connection test stdout/stderr)
          </button>
          {logsExpanded && (
            <div className="pl-raw-log-frame" data-testid="connection-test-raw-log-frame">
              {logSections.length > 0 ? (
                logSections.map((section) => (
                  <pre key={section.label} data-testid={`connection-test-${section.label}`}>
                    <span>{section.label}</span>
                    {section.value}
                  </pre>
                ))
              ) : (
                <p className="pl-raw-log-placeholder" data-testid="connection-test-log-empty">
                  ktx 未返回原始日志输出
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
