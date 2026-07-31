import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CatalogReloadsResponse,
  CatalogReloadWarning,
  ConnectionInfo,
  ConnectionTestResult,
  ProjectInfo,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { AddSchemaDrawer } from "../../components/AddSchemaDrawer";
import {
  CatalogAssetUploadButton,
  CatalogReloadButton
} from "../../components/catalog";
import { ConnectionTestDrawer } from "../../components/connections";
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

type CatalogRunState = {
  label: string;
  detail: string;
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
    return { label: "Manifest 解析失败", tableCount, tone: "danger" };
  }
  if (warnings.some((warning) => warning.code === "SCHEMA_MANIFEST_MISSING")) {
    return { label: "缺失 Manifest", tableCount, tone: "warning" };
  }
  if (warnings.some((warning) => warning.code === "SCHEMA_MANIFEST_EMPTY")) {
    return { label: "空 Manifest", tableCount, tone: "warning" };
  }
  if (tableCount > 0) {
    return { label: "已存在", tableCount, tone: "success" };
  }
  return { label: "未发现本地 Manifest", tableCount, tone: "muted" };
}

function catalogRunState(
  run: CatalogReloadsResponse["lastByConnection"][string] | undefined
): CatalogRunState {
  if (!run) {
    return {
      label: "Catalog 未刷新",
      detail: "尚未读取本地 YAML",
      tone: "muted"
    };
  }
  const warningText = run.warnings.length > 0 ? ` · ${run.warnings.length} 个提示` : "";
  if (run.status === "failed") {
    return {
      label: "Catalog 刷新失败",
      detail: `${formatLocalTime(run.startedAt)}${warningText}`,
      tone: "danger"
    };
  }
  return {
    label: "Catalog 已同步",
    detail: `${formatLocalTime(run.startedAt)}${warningText}`,
    tone: run.warnings.length > 0 ? "warning" : "success"
  };
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
  const loading = projectQuery.isLoading || sourcesQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error;
  const [addTarget, setAddTarget] = useState<ConnectionInfo | null>(null);
  const [testDrawerTarget, setTestDrawerTarget] = useState<ConnectionInfo | null>(null);
  // M21: ConnectionOverview is the single source of truth for connection-test
  // results. We cache the latest `ConnectionTestResult` per connection, the
  // current drawer target, and the drawer's collapsible log state. The
  // `ConnectionTestDrawer` is fully controlled — it never owns its own
  // mutation or result state, so the card status, drawer banner, and
  // compatibility page stay in lockstep.
  const [testResults, setTestResults] = useState<Record<string, ConnectionTestResult | null>>({});
  const [drawerLogsExpanded, setDrawerLogsExpanded] = useState(false);

  const testMutation = useMutation({
    mutationFn: (connId: string) =>
      apiPost<ConnectionTestResult>(`/api/connections/${encodeURIComponent(connId)}/test`, {}),
    onSuccess: (data, connId) => {
      setTestResults((prev) => ({ ...prev, [connId]: data }));
    },
    onError: (err, connId) => {
      setTestResults((prev) => ({
        ...prev,
        [connId]: {
          status: "error",
          reason: err instanceof Error ? err.message : "未知错误"
        }
      }));
    }
  });

  const testStates = useMemo(() => {
    const out: Record<string, TestUiStatus> = {};
    for (const conn of connections) {
      const isPending =
        testMutation.isPending && testMutation.variables === conn.id;
      const result = testResults[conn.id];
      if (isPending) {
        out[conn.id] = "testing";
      } else if (result === undefined) {
        out[conn.id] = "unknown";
      } else if (result.status === "ok") {
        out[conn.id] = "connected";
      } else {
        out[conn.id] = "disconnected";
      }
    }
    return out;
  }, [connections, testMutation.isPending, testMutation.variables, testResults]);

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
        description={<span className="notranslate" translate="no">维护每个连接的 Schema、YAML 资产与本地目录刷新状态。</span>}
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
          subValue={schemaCount > 0 ? `${schemaCount} 个 Schema` : "未配置 Schema"}
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
            <p className="text-sm text-fg-muted py-4 notranslate" translate="no">暂无连接配置，请在 ktx.yaml 中添加 connections。</p>
          )}
          {connections.map((conn) => {
            const state: TestUiStatus = testStates[conn.id] ?? "unknown";
            const lastRun = catalogReloadsQuery.data?.lastByConnection[conn.id];
            const catalogState = catalogRunState(lastRun);
            const schemaRows = conn.schemas.map((schema) => ({
              schema,
              assetState: schemaAssetState(conn.id, schema, semanticTables, lastRun)
            }));
            const hasManifestGap = schemaRows.some(({ assetState }) => assetState.tone !== "success");
            return (
              <div className="pl-connection-row" key={conn.id} data-testid={`connection-card-${conn.id}`}>
                <div className="pl-connection-card-header">
                  <div className="pl-connection-card-title">
                    <span
                      className="pl-engine-badge notranslate"
                      data-testid={`engine-badge-${conn.id}`}
                      translate="no"
                    >
                      {engineLabel(conn.engine ?? conn.driver)}
                    </span>
                    <strong className="notranslate" translate="no">{conn.id}</strong>
                  </div>
                  <div className="pl-connection-card-badges">
                    <span
                      className={`pl-connection-status pl-connection-status--${state}`}
                      data-testid={`connection-status-${conn.id}`}
                      translate="no"
                    >
                      {statusLabel(state)}
                    </span>
                    <span
                      className="text-xs text-fg-muted notranslate"
                      translate="no"
                      data-testid={`connection-readonly-${conn.id}`}
                    >
                      {conn.readOnlyExpected === false ? "Write-risk" : "Read-only expected"}
                    </span>
                  </div>
                  <p className="pl-connection-card-meta notranslate" translate="no">
                    配置来源：ktx.yaml。凭据不在 WebUI 中编辑。
                  </p>
                </div>
                <div className="pl-connection-card-body">
                  <div className="pl-schema-asset-heading">
                    <span className="notranslate" translate="no">关联 Schema 资产列表</span>
                  </div>
                  {conn.schemas.length === 0 ? (
                    <p className="text-sm text-fg-muted py-3 notranslate" translate="no">尚未配置 Schema。请先添加 Schema。</p>
                  ) : (
                    <table className="pl-schema-asset-table" data-testid={`schema-list-${conn.id}`}>
                      <thead>
                        <tr>
                          <th className="notranslate" translate="no">Schema</th>
                          <th className="notranslate" translate="no">Manifest 状态</th>
                          <th>本地表数</th>
                          <th>上下文动作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaRows.map(({ schema, assetState }) => {
                          const hasManifest = assetState.tone === "success";
                          return (
                            <tr
                              key={schema}
                              data-tone={assetState.tone}
                              data-testid={`schema-row-${conn.id}-${schema}`}
                            >
                              <td><code className="notranslate" translate="no">{schema}</code></td>
                              <td>
                                <span
                                  className={`pl-schema-asset-status pl-schema-asset-status--${assetState.tone}`}
                                  data-testid={`schema-asset-status-${conn.id}-${schema}`}
                                  translate="no"
                                >
                                  {assetState.label}
                                </span>
                              </td>
                              <td>{assetState.tableCount} 张表</td>
                              <td>
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
                                    label="上传 Manifest"
                                    variant="ghost"
                                    size="sm"
                                    testId={`upload-yaml-${conn.id}-${schema}`}
                                  />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="pl-connection-card-footer">
                  <div
                    className={`pl-catalog-status-line pl-catalog-status-line--${catalogState.tone}`}
                    data-testid={`catalog-status-${conn.id}`}
                  >
                    <strong>{catalogState.label}</strong>
                    <span>{catalogState.detail}</span>
                  </div>
                  <div className="pl-connection-card-actions">
                    <button
                      type="button"
                      className={`pl-btn notranslate ${hasManifestGap ? "pl-btn--secondary" : "pl-btn--primary"}`}
                      onClick={() => setAddTarget(conn)}
                      data-testid={`add-schema-${conn.id}`}
                      translate="no"
                    >
                      + 添加 Schema
                    </button>
                    <CatalogAssetUploadButton
                      connectionId={conn.id}
                      schemaOptions={conn.schemas}
                      label="上传 YAML"
                      variant={hasManifestGap ? "primary" : "secondary"}
                      testId={`upload-yaml-${conn.id}`}
                    />
                    <button
                      type="button"
                      className="pl-btn pl-btn--secondary"
                      onClick={() => {
                        setDrawerLogsExpanded(false);
                        setTestDrawerTarget(conn);
                        // Auto-run on first open so the card status flips
                        // and the drawer banner reflects the latest result
                        // without an extra click.
                        if (testResults[conn.id] === undefined) {
                          testMutation.mutate(conn.id);
                        }
                      }}
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
              </div>
            );
          })}
        </section>
      </div>

      {addTarget && (
        <AddSchemaDrawer
          connection={addTarget}
          open={Boolean(addTarget)}
          onClose={() => setAddTarget(null)}
        />
      )}

      {testDrawerTarget && (
        <ConnectionTestDrawer
          connection={testDrawerTarget}
          open={Boolean(testDrawerTarget)}
          result={testResults[testDrawerTarget.id] ?? null}
          isPending={
            testMutation.isPending && testMutation.variables === testDrawerTarget.id
          }
          logsExpanded={drawerLogsExpanded}
          onClose={() => setTestDrawerTarget(null)}
          onRunTest={() => testMutation.mutate(testDrawerTarget.id)}
          onToggleLogs={() => setDrawerLogsExpanded((v) => !v)}
        />
      )}

      <p className="pl-notice" data-testid="connections-export-hint">
        系统级资产包导出已迁移到{" "}
        <Link to="/review" className="pl-link" data-testid="connections-export-link">
          变更审阅
        </Link>
        页面，仅在发布语义资产或交付运维包时使用，与 Connection 无关。
      </p>
    </div>
  );
}
