import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CatalogReloadsResponse,
  CatalogReloadWarning,
  ConnectionInfo,
  ConnectionTestResult,
  McpEndpointInfo,
  ProjectInfo,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { AddSchemaDrawer } from "../../components/AddSchemaDrawer";
import {
  CatalogAssetUploadButton,
  CatalogReloadButton,
  CatalogReloadLastRunBadge
} from "../../components/catalog";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "./MetricCard";

type TestUiStatus = "unknown" | "testing" | "connected" | "disconnected";

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

function catalogStatusLabel(run: CatalogReloadsResponse["last"]): string {
  if (!run) return "未运行";
  if (run.status === "failed") return "失败";
  if (run.warnings.length > 0) return "有提示";
  return "成功";
}

function catalogStatusDetail(run: CatalogReloadsResponse["last"]): string {
  if (!run) return "尚未运行过本地目录刷新";
  const warningText = run.warnings.length > 0 ? ` · ${run.warnings.length} 个提示` : "";
  return `${run.tables} 张表 · ${run.connectionIds.length} 个连接${warningText}`;
}

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

type SchemaAssetState = {
  label: string;
  tableCount: number;
  tone: "success" | "warning" | "danger" | "muted";
};

function matchingSchemaWarnings(
  warnings: CatalogReloadWarning[],
  connectionId: string,
  schema: string
): CatalogReloadWarning[] {
  return warnings.filter((warning) => {
    if (warning.connectionId !== connectionId) return false;
    if (warning.schema === schema) return true;
    return Boolean(warning.table?.startsWith(`${schema}.`));
  });
}

function schemaAssetState(
  connectionId: string,
  schema: string,
  tables: SourceSummary[],
  run: CatalogReloadsResponse["lastByConnection"][string] | undefined
): SchemaAssetState {
  const tableCount = tables.filter((table) => table.conn === connectionId && table.schema === schema).length;
  const warnings = matchingSchemaWarnings(run?.warnings ?? [], connectionId, schema);
  if (warnings.some((warning) => warning.code === "MANIFEST_PARSE_FAILED")) {
    return { label: "解析失败", tableCount, tone: "danger" };
  }
  if (warnings.some((warning) => warning.code === "SCHEMA_MANIFEST_MISSING")) {
    return { label: "缺失 manifest", tableCount, tone: "warning" };
  }
  if (warnings.some((warning) => warning.code === "SCHEMA_MANIFEST_EMPTY")) {
    return { label: "空 manifest", tableCount, tone: "warning" };
  }
  if (tableCount > 0) {
    return { label: "已存在", tableCount, tone: "success" };
  }
  return { label: "未发现本地 manifest", tableCount, tone: "muted" };
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
  const catalogReloadsQuery = useQuery({
    queryKey: queryKeys.catalogReloads,
    queryFn: () => apiGet<CatalogReloadsResponse>("/api/catalog/reloads")
  });

  const connections = projectQuery.data?.connections ?? [];
  const enabledTableCount = connections.reduce((sum, conn) => sum + conn.enabledTables.length, 0);
  const semanticTables = sourcesQuery.data?.tables ?? [];
  const semanticTableCount = semanticTables.length;
  const schemaCount = connections.reduce((sum, conn) => sum + conn.schemas.length, 0);
  const lastCatalogRun = catalogReloadsQuery.data?.last ?? null;
  const mcpEndpointInfo: McpEndpointInfo | undefined = projectQuery.data?.mcpEndpoint;
  const mcpEndpoint = mcpEndpointInfo?.url ?? null;
  const canCopyMcpEndpoint = mcpEndpoint !== null;
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
    if (!mcpEndpoint) {
      toast.error("Lucy MCP endpoint 不可用，无法复制");
      return;
    }
    try {
      await navigator.clipboard.writeText(mcpEndpoint);
      toast.success("MCP endpoint 已复制");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "复制失败");
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
      <PageHeader
        title="连接概览"
        breadcrumbs={["数据库接入", "连接概览"]}
        description="维护每个连接的 schema、YAML 资产与本地目录刷新状态。"
        badges={
          projectQuery.data ? (
            <span data-testid="page-header-badge-root">{projectQuery.data.root}</span>
          ) : null
        }
      />

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
          type="catalogStatus"
          value={catalogStatusLabel(lastCatalogRun)}
          subValue={catalogStatusDetail(lastCatalogRun)}
        />
      </div>

      <div className="pl-overview-grid">
        <section className="pl-panel">
          {connections.length === 0 && (
            <p className="text-sm text-fg-muted py-4">暂无连接配置，请在 ktx.yaml 中添加 connections。</p>
          )}
          {connections.map((conn) => {
            const state: TestUiStatus = testStates[conn.id] ?? "unknown";
            const lastRun = catalogReloadsQuery.data?.lastByConnection[conn.id];
            const lastRunAt = lastRun ? formatLocalTime(lastRun.startedAt) : "尚未运行";
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
                    <span className="text-xs text-fg-muted">
                      {conn.readOnlyExpected === false ? "Write-risk" : "Read-only expected"}
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted">
                    配置来源：ktx.yaml。凭据不在 WebUI 中编辑。
                  </p>
                  <p className="text-xs text-fg-muted">
                    上次刷新：{lastRunAt}
                    {lastRun ? ` · ${catalogStatusLabel(lastRun)}` : ""}
                  </p>
                  <CatalogReloadLastRunBadge run={lastRun ?? null} />
                </div>
                <div className="pl-schema-cell">
                  <span className="text-xs text-fg-muted">schemas</span>
                  {conn.schemas.length === 0 ? (
                    <strong>-</strong>
                  ) : (
                    <ul className="pl-schema-list" data-testid={`schema-list-${conn.id}`}>
                      {conn.schemas.map((schema) => {
                        const assetState = schemaAssetState(conn.id, schema, semanticTables, lastRun);
                        const hasManifest = assetState.tone === "success";
                        return (
                          <li
                            className="pl-schema-row"
                            key={schema}
                            data-testid={`schema-row-${conn.id}-${schema}`}
                          >
                            <code>{schema}</code>
                            <span
                              className={`pl-schema-asset-status pl-schema-asset-status--${assetState.tone}`}
                              data-testid={`schema-asset-status-${conn.id}-${schema}`}
                            >
                              {assetState.label}
                            </span>
                            <span className="text-xs text-fg-muted">
                              {assetState.tableCount} 张表
                            </span>
                            {hasManifest ? (
                              <Link
                                className="pl-btn pl-btn--ghost pl-btn--sm"
                                to={`/connections/whitelist?schema=${encodeURIComponent(schema)}`}
                                data-testid={`schema-whitelist-${conn.id}-${schema}`}
                              >
                                维护白名单
                              </Link>
                            ) : (
                              <CatalogAssetUploadButton
                                connectionId={conn.id}
                                schema={schema}
                                label="上传该 Schema 的 YAML"
                                variant="ghost"
                                size="sm"
                                testId={`upload-yaml-${conn.id}-${schema}`}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="pl-btn pl-btn--secondary"
                    onClick={() => setAddTarget(conn)}
                    data-testid={`add-schema-${conn.id}`}
                  >
                    + 添加 Schema
                  </button>
                  <CatalogAssetUploadButton
                    connectionId={conn.id}
                    schemaOptions={conn.schemas}
                    label="上传 YAML"
                    variant="primary"
                    testId={`upload-yaml-${conn.id}`}
                  />
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost"
                    onClick={() => testMutation.mutate(conn.id)}
                    disabled={testMutation.isPending && testMutation.variables === conn.id}
                    data-testid={`test-connection-${conn.id}`}
                  >
                    {state === "testing" ? "Testing..." : "测试连接"}
                  </button>
                  <CatalogReloadButton
                    connectionId={conn.id}
                    label="刷新本地目录"
                    variant="secondary"
                    testId={`catalog-reload-${conn.id}`}
                  />
                </div>
              </div>
            );
          })}
        </section>

        <aside className="pl-panel">
          <div className="pl-code-snippet mt-0">
            <div className="pl-copy-line">
              <span>MCP endpoint</span>
              {canCopyMcpEndpoint ? (
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost"
                  aria-label="复制 MCP endpoint"
                  onClick={copyEndpoint}
                  data-testid="copy-mcp-endpoint"
                >
                  复制
                </button>
              ) : null}
            </div>
            {mcpEndpoint ? (
              <code data-testid="mcp-endpoint-value">{mcpEndpoint}</code>
            ) : (
              <div className="pl-error" data-testid="mcp-endpoint-diagnostic">
                {mcpEndpointInfo?.diagnostics.map((d, i) => (
                  <div key={`${d.code}-${i}`}>{d.message}</div>
                ))}
              </div>
            )}
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
