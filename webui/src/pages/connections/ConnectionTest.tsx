import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  ConnectionInfo,
  ConnectionTestResult,
  ConnectionsResponse,
  ProjectInfo
} from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type LatencyTone = "muted" | "success" | "warning" | "danger";

function latencyTone(latencyMs: number | undefined): {
  label: string;
  tone: LatencyTone;
} {
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

export function ConnectionTest() {
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);

  const connectionsQuery = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections")
  });
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });

  const connections = connectionsQuery.data?.connections ?? [];
  const activeConnId = selectedConnId || connections[0]?.id || "";
  const activeConn = connections.find((c) => c.id === activeConnId);

  const testMutation = useMutation({
    mutationFn: (connId: string) =>
      apiPost<ConnectionTestResult>(
        `/api/connections/${encodeURIComponent(connId)}/test`,
        {}
      ),
    onMutate: () => {
      setResult(null);
      setLogsExpanded(false);
    },
    onSuccess: (data, connId) => {
      if (connId === activeConnId) {
        setResult(data);
      }
    },
    onError: (err, connId) => {
      if (connId === activeConnId) {
        setResult({
          status: "error",
          reason: err instanceof Error ? err.message : "未知错误"
        });
      }
    }
  });

  if (connectionsQuery.isLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  const isPending = testMutation.isPending;
  const latency = latencyTone(result?.latencyMs);

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
    <div className="pl-page-stack">
      <PageHeader
        title="连通测试"
        breadcrumbs={["数据库接入", "连通测试"]}
        description="测试数据库连通性，验证凭据、网络与驱动配置是否正确。"
        badges={
          projectQuery.data ? (
            <>
              <span>{projectQuery.data.root}</span>
              <span>{connections.length} 个连接</span>
              <span>KTX {projectQuery.data.ktxAvailable ? "可用" : "不可用"}</span>
            </>
          ) : null
        }
      />

      <section className="pl-panel">
        {connections.length === 0 && (
          <div className="pl-empty-state">
            暂无连接配置。请先在 <Link to="/connections">连接概览</Link> 添加连接。
          </div>
        )}

        {connections.length > 0 && (
          <div className="pl-toolbar">
          <label className="grid gap-1.5 text-sm">
            <span>选择连接</span>
            <select
              className="pl-input"
              value={activeConnId}
              onChange={(e) => {
                setSelectedConnId(e.target.value);
                setResult(null);
                setLogsExpanded(false);
              }}
              aria-label="选择连接"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id}
                </option>
              ))}
            </select>
          </label>
          <button
            className="pl-btn pl-btn--primary"
            onClick={() => {
              if (activeConnId) testMutation.mutate(activeConnId);
            }}
            disabled={isPending || !activeConnId}
            data-testid="rerun-connection-test"
          >
            {isPending ? "测试中..." : "重新测试连接"}
          </button>
        </div>
      )}

      {activeConn && (
        <div className="pl-diagnostic-panel" data-testid="connection-test-panel">
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
                <strong>{engineDisplay(activeConn.engine, activeConn.driver)}</strong>
              </div>
              <div>
                <span>传输协议</span>
                <strong>{protocolLabel(activeConn.wireProtocol)}</strong>
              </div>
              <div>
                <span>访问模式</span>
                <strong>{accessModeLabel(activeConn.readOnlyExpected)}</strong>
              </div>
            </div>
          )}

          {result && (
            <div
              className="pl-collapsible-log"
              role="region"
              aria-label="原始诊断日志 (ktx connection test stdout/stderr)"
              data-testid="connection-test-log"
            >
              <button
                type="button"
                className="pl-btn pl-btn--ghost text-sm"
                aria-expanded={logsExpanded}
                onClick={() => setLogsExpanded((v) => !v)}
              >
                原始诊断日志 (ktx connection test stdout/stderr)
              </button>
              {logsExpanded && (
                <div className="grid gap-2">
                  {result.stdout !== undefined && result.stdout !== "" && (
                    <pre data-testid="connection-test-stdout">{result.stdout}</pre>
                  )}
                  {result.stderr !== undefined && result.stderr !== "" && (
                    <pre data-testid="connection-test-stderr">{result.stderr}</pre>
                  )}
                  {result.detail !== undefined && result.detail !== "" && (
                    <pre data-testid="connection-test-detail">{result.detail}</pre>
                  )}
                  {result.reason !== undefined && result.reason !== "" && (
                    <pre data-testid="connection-test-reason">{result.reason}</pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
      </section>
    </div>
  );
}
