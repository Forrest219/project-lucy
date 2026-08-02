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
import { ConnectionTestResultPanel } from "../../components/connections";

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
  const activeConn: ConnectionInfo | null =
    connections.find((c) => c.id === activeConnId) ?? null;

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
        setLogsExpanded(true);
      }
    },
    onError: (err, connId) => {
      if (connId === activeConnId) {
        setResult({
          status: "error",
          reason: err instanceof Error ? err.message : "未知错误",
          command: `ktx connection test ${connId}`,
          args: ["connection", "test", connId],
          exitCode: null,
          stdout: "",
          stderr: err instanceof Error ? err.message : ""
        });
        setLogsExpanded(true);
      }
    }
  });

  if (connectionsQuery.isLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  const isPending = testMutation.isPending;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="连通测试"
        description="测试数据库连通性，验证凭据、网络与驱动配置是否正确。"
        badges={
          projectQuery.data ? <span>{projectQuery.data.root}</span> : null
        }
      />

      <p
        className="pl-notice notranslate"
        data-testid="connection-test-overview-hint"
        translate="no"
      >
        也可以在连接概览中对单个连接执行测试。
        如需核对连接配置，请前往{" "}
        <Link to="/connections" className="pl-link" data-testid="connection-test-overview-link">
          连接概览
        </Link>
        。
      </p>

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
        <ConnectionTestResultPanel
          connection={activeConn}
          result={result}
          isPending={isPending}
          logsExpanded={logsExpanded}
          onToggleLogs={() => setLogsExpanded((v) => !v)}
        />
      )}
      </section>
    </div>
  );
}
