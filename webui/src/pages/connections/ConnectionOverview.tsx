import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionInfo, ConnectionTestResult, ProjectInfo, SourcesResponse } from "../../lib/types";
import { AddSchemaDrawer } from "../../components/AddSchemaDrawer";
import { MetricCard } from "./MetricCard";

type TestUiStatus = "unknown" | "testing" | "connected" | "disconnected";

const MCP_ENDPOINT = "http://127.0.0.1:7879/mcp";

function engineLabel(engine?: string) {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "MySQL";
  if (normalized === "postgres" || normalized === "postgresql") return "Postgres";
  if (normalized === "doris") return "Doris";
  if (normalized === "starrocks") return "StarRocks";
  return "DB";
}

function statusLabel(state: TestUiStatus) {
  if (state === "unknown") return "Not tested";
  if (state === "testing") return "Testing";
  if (state === "connected") return "Connected";
  return "Disconnected";
}

export function ConnectionOverview() {
  const projectQuery = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });
  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const connections = projectQuery.data?.connections ?? [];
  const enabledTableCount = connections.reduce((sum, conn) => sum + conn.enabledTables.length, 0);
  const semanticTables = sourcesQuery.data?.tables ?? [];
  const semanticTableCount = semanticTables.length;
  const semanticSourceCount = new Set(semanticTables.map((table) => `${table.conn}.${table.schema}`)).size;
  const schemaCount = connections.reduce((sum, conn) => sum + conn.schemas.length, 0);
  const loading = projectQuery.isLoading || sourcesQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error;
  const [addTarget, setAddTarget] = useState<ConnectionInfo | null>(null);
  const [testStates, setTestStates] = useState<Record<string, TestUiStatus>>({});

  const testMutation = useMutation({
    mutationFn: (connId: string) =>
      apiPost<ConnectionTestResult>(`/api/connections/${encodeURIComponent(connId)}/test`, {}),
    onMutate: (connId) => {
      setTestStates((prev) => ({ ...prev, [connId]: "testing" }));
    },
    onSuccess: (data, connId) => {
      setTestStates((prev) => ({
        ...prev,
        [connId]: data.status === "ok" ? "connected" : "disconnected"
      }));
    },
    onError: (_error, connId) => {
      setTestStates((prev) => ({ ...prev, [connId]: "disconnected" }));
    }
  });

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(MCP_ENDPOINT);
      toast.success("MCP endpoint 已复制");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "复制失败");
    }
  }

  if (loading) {
    return <p className="pl-notice">正在加载连接状态...</p>;
  }

  if (error) {
    return <p className="pl-error">连接状态加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">数据库接入</p>
          <h1 className="text-xl font-semibold">连接概览</h1>
          <p className="pl-page-intro">查看当前 KTX 项目的数据库连接、启用表范围和语义层覆盖情况。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="pl-btn pl-btn--secondary" to="/connections/whitelist">表白名单</Link>
          <Link className="pl-btn pl-btn--secondary" to="/connections/test">连通测试</Link>
          <Link className="pl-btn pl-btn--primary" to="/">打开表目录</Link>
        </div>
      </div>

      <div className="pl-metric-grid">
        <MetricCard
          type="connections"
          value={connections.length}
          subValue={schemaCount > 0 ? `${schemaCount} 个 schema` : "未配置 schema"}
        />
        <MetricCard
          type="enabledTables"
          value={enabledTableCount}
          subValue="来自 ktx.yaml enabled_tables"
        />
        <MetricCard
          type="semanticTables"
          value={semanticTableCount}
          subValue="已进入 semantic-layer 的表"
        />
        <MetricCard
          type="semanticSources"
          value={semanticSourceCount}
          subValue="按 connection/schema 聚合"
        />
        <MetricCard
          type="ktxRuntime"
          value={projectQuery.data?.ktxAvailable ? "可用" : "不可用"}
          subValue={projectQuery.data?.root ?? "项目根目录未知"}
        />
      </div>

      <div className="pl-overview-grid">
        <section className="pl-panel">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title">Connection Details</h2>
              <p className="pl-notice">连接配置来自当前项目，不在 WebUI 中直接编辑凭据。</p>
            </div>
          </div>
          <div className="pl-table-list">
            {connections.length === 0 && (
              <p className="text-sm text-fg-muted py-4">暂无连接配置，请在 ktx.yaml 中添加 connections。</p>
            )}
            {connections.map((conn) => {
              const state: TestUiStatus = testStates[conn.id] ?? "unknown";
              return (
                <div className="pl-connection-row" key={conn.id} data-testid={`connection-card-${conn.id}`}>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="pl-engine-badge" data-testid={`engine-badge-${conn.id}`}>
                        {engineLabel(conn.engine ?? conn.driver)}
                      </span>
                      <strong>{conn.id}</strong>
                      <span
                        className={`pl-connection-status pl-connection-status--${state}`}
                        data-testid={`connection-status-${conn.id}`}
                      >
                        {statusLabel(state)}
                      </span>
                    </div>
                    <span>
                      {conn.engine ?? "unknown engine"}
                      {conn.wireProtocol ? ` / ${conn.wireProtocol} wire` : ""}
                      {conn.r1Target ? " / R1 target" : ""}
                      {conn.readOnlyExpected === false ? " / write-risk" : " / read-only expected"}
                    </span>
                    <span>{conn.driver ?? "未知 driver"}</span>
                  </div>
                  <div>
                    <span>schemas</span>
                    <strong>{conn.schemas.length > 0 ? conn.schemas.join(", ") : "-"}</strong>
                  </div>
                  <div>
                    <span>enabled</span>
                    <strong>{conn.enabledTables.length} 张表</strong>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="pl-btn pl-btn--secondary"
                      onClick={() => setAddTarget(conn)}
                      data-testid={`add-schema-${conn.id}`}
                    >
                      + 添加 schema
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost"
                      onClick={() => testMutation.mutate(conn.id)}
                      disabled={testMutation.isPending && testMutation.variables === conn.id}
                      data-testid={`test-connection-${conn.id}`}
                    >
                      {state === "testing" ? "Testing..." : "测试连接"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="pl-panel">
          <h2 className="pl-panel-title">Quick Start</h2>
          <div className="pl-action-list">
            <Link to="/connections/whitelist">
              <strong>维护表白名单</strong>
              <span>选择需要进入语义层的物理表。</span>
            </Link>
            <Link to="/connections/test">
              <strong>运行连通测试</strong>
              <span>验证当前连接的访问状态。</span>
            </Link>
            <Link to="/">
              <strong>打开表目录</strong>
              <span>查看已入库的语义对象与完成度。</span>
            </Link>
          </div>
          <div className="pl-code-snippet">
            <div className="pl-copy-line">
              <span>MCP endpoint</span>
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                aria-label="复制 MCP endpoint"
                onClick={copyEndpoint}
                data-testid="copy-mcp-endpoint"
              >
                复制
              </button>
            </div>
            <code>{MCP_ENDPOINT}</code>
          </div>
        </aside>
      </div>

      {addTarget && (
        <AddSchemaDrawer
          connection={addTarget}
          open={Boolean(addTarget)}
          onClose={() => setAddTarget(null)}
        />
      )}
    </div>
  );
}
