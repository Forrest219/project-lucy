import { Fragment, type ReactNode } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CatalogReloadsResponse,
  CatalogReloadRun,
  CatalogReloadWarning,
  ConnectionInfo,
  ProjectInfo,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { AddSchemaDrawer } from "../../components/AddSchemaDrawer";
import { CatalogAssetUploadButton, CatalogReloadButton } from "../../components/catalog";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "./MetricCard";

function engineLabel(engine?: string) {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "MySQL";
  if (normalized === "postgres" || normalized === "postgresql") return "Postgres";
  if (normalized === "doris") return "Doris";
  if (normalized === "starrocks") return "StarRocks";
  return "DB";
}

function catalogStatusLabel(
  run: CatalogReloadsResponse["last"],
  isLoading = false,
  error: Error | null = null
): string {
  if (isLoading) return "加载中";
  if (error) return "加载失败";
  if (!run) return "未运行";
  if (run.status === "failed") return "失败";
  if (run.warnings.length > 0) return `${run.warnings.length} 个待处理`;
  return "成功";
}

function warningIssueLabel(warning: CatalogReloadWarning): string {
  if (warning.code === "MANIFEST_PARSE_FAILED") return "Manifest 解析失败";
  if (warning.code === "SCHEMA_MANIFEST_MISSING") return "缺失 Manifest";
  if (warning.code === "SCHEMA_MANIFEST_EMPTY") return "空 Manifest";
  if (warning.code === "ENABLED_TABLE_NOT_SCANNED") return "enabled_tables 未扫描";
  return warning.message;
}

function warningSubject(warning: CatalogReloadWarning): string {
  return warning.schema ?? warning.table ?? warning.connectionId;
}

function warningSummary(warnings: CatalogReloadWarning[]): string {
  if (warnings.length === 0) return "";
  const first = warnings[0];
  const summary = `${warningSubject(first)} ${warningIssueLabel(first)}`;
  if (warnings.length === 1) return summary;
  return `${summary} 等 ${warnings.length} 个待处理`;
}

function catalogStatusDetail(
  run: CatalogReloadsResponse["last"],
  isLoading = false,
  error: Error | null = null
): string {
  if (isLoading) return "正在读取本地目录刷新记录";
  if (error) return `本地目录状态加载失败：${error.message}`;
  if (!run) return "尚未运行过本地目录刷新";
  const warningText = run.warnings.length > 0 ? ` · ${warningSummary(run.warnings)}` : "";
  return `${run.tables} 张表 · ${run.connectionIds.length} 个连接${warningText}`;
}

function catalogStatusSubValue(
  run: CatalogReloadsResponse["last"],
  isLoading = false,
  error: Error | null = null
): ReactNode {
  return <span className="notranslate" translate="no">{catalogStatusDetail(run, isLoading, error)}</span>;
}

function catalogStatusTone(
  run: CatalogReloadsResponse["last"],
  isLoading = false,
  error: Error | null = null
): "warning" | "danger" | undefined {
  if (isLoading) return undefined;
  if (error) return "danger";
  if (!run || run.status === "failed" || run.warnings.length > 0) return "warning";
  return undefined;
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
  badgeLabel: string;
  tableCount: number;
  warningCount: number;
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
  run: CatalogReloadsResponse["lastByConnection"][string] | undefined,
  isLoading = false,
  error: Error | null = null,
  isHistoryLoading = false,
  historyError: Error | null = null
): CatalogRunState {
  if (isLoading) {
    return {
      label: "正在刷新本地目录...",
      detail: "",
      tone: "muted",
      badgeLabel: "刷新中",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (error) {
    return {
      label: "本地目录刷新失败",
      detail: error.message,
      tone: "danger",
      badgeLabel: "失败",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (isHistoryLoading) {
    return {
      label: "正在读取本地目录状态...",
      detail: "",
      tone: "muted",
      badgeLabel: "加载中",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (historyError) {
    return {
      label: "本地目录状态加载失败",
      detail: historyError.message,
      tone: "danger",
      badgeLabel: "失败",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (!run) {
    return {
      label: "本地目录未刷新",
      detail: "尚未读取本地 YAML",
      tone: "muted",
      badgeLabel: "未刷新",
      tableCount: 0,
      warningCount: 0
    };
  }
  if (run.status === "failed") {
    return {
      label: "本地目录刷新失败",
      detail: formatLocalTime(run.startedAt),
      tone: "danger",
      badgeLabel: "失败",
      tableCount: run.tables,
      warningCount: run.warnings.length
    };
  }
  return {
    label: "本地目录已刷新",
    detail: formatLocalTime(run.startedAt),
    tone: run.warnings.length > 0 ? "warning" : "success",
    badgeLabel: "已完成",
    tableCount: run.tables,
    warningCount: run.warnings.length
  };
}

function missingManifestPath(connectionId: string, schema: string, warning?: CatalogReloadWarning): string {
  return warning?.filePath ?? `semantic-layer/${connectionId}/_schema/${schema}.yaml`;
}

function warningDiagnosticCode(warning: CatalogReloadWarning): string {
  if (warning.code === "SCHEMA_MANIFEST_MISSING") return "missing_manifest";
  return warning.code.toLowerCase();
}

function warningKey(connectionId: string, schema: string): string {
  return `${connectionId}:${schema}`;
}

function readOnlyStatus(conn: ConnectionInfo): { label: string; tone: "safe" | "risk"; title: string } {
  return {
    label: conn.readOnlyExpected === false ? "未声明只读" : "预期只读",
    tone: conn.readOnlyExpected === false ? "risk" : "safe",
    title: "来自 ktx.yaml 的 readonly 标记；真实只读能力由数据库账号权限保证。"
  };
}

function hostValue(conn: ConnectionInfo): { text: string; title: string } {
  if (!conn.host) {
    return { text: "未声明 Host", title: "未声明 Host" };
  }
  const text = conn.port ? `${conn.host}:${conn.port}` : conn.host;
  return { text, title: text };
}

function databaseValue(conn: ConnectionInfo): { text: string; title: string } {
  if (!conn.database) {
    return { text: "未声明 Database", title: "未声明 Database" };
  }
  return { text: conn.database, title: conn.database };
}

function shouldShowRefreshWarning(
  lastRun: CatalogReloadRun | null,
  isReloading: boolean,
  hasError: boolean,
  hasReloadHistory: boolean
): boolean {
  if (!hasReloadHistory) return false;
  if (isReloading) return false;
  if (hasError) return false;
  return !lastRun;
}

function shouldShowCatalogRunStatus(
  lastRun: CatalogReloadRun | undefined,
  isReloading: boolean,
  hasReloadError: boolean,
  isHistoryLoading: boolean,
  hasHistoryError: boolean
): boolean {
  return Boolean(isReloading || hasReloadError || isHistoryLoading || hasHistoryError || lastRun?.status === "failed");
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
  const catalogReloadHistoryReady = catalogReloadsQuery.isSuccess;
  const catalogReloadHistoryLoading = catalogReloadsQuery.isLoading;
  const catalogReloadHistoryError = catalogReloadsQuery.error instanceof Error ? catalogReloadsQuery.error : null;
  const lastCatalogRun = catalogReloadHistoryReady ? catalogReloadsQuery.data.last : null;
  const loading = projectQuery.isLoading || sourcesQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error;
  const [addTarget, setAddTarget] = useState<ConnectionInfo | null>(null);
  const [reloadRunsByConnection, setReloadRunsByConnection] = useState<Record<string, CatalogReloadRun>>({});
  const [reloadErrorsByConnection, setReloadErrorsByConnection] = useState<Record<string, Error | null>>({});
  const [reloadingConnections, setReloadingConnections] = useState<Record<string, boolean>>({});
  const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
  const [copiedWarningPath, setCopiedWarningPath] = useState<string | null>(null);

  function handleReloadStart(connectionId: string) {
    setReloadingConnections((current) => ({ ...current, [connectionId]: true }));
    setReloadErrorsByConnection((current) => ({ ...current, [connectionId]: null }));
  }

  function handleReloadComplete(connectionId: string, run: CatalogReloadRun) {
    setReloadRunsByConnection((current) => ({ ...current, [connectionId]: run }));
    setReloadingConnections((current) => ({ ...current, [connectionId]: false }));
    setReloadErrorsByConnection((current) => ({ ...current, [connectionId]: null }));
  }

  function handleReloadError(connectionId: string, reloadError: Error) {
    setReloadingConnections((current) => ({ ...current, [connectionId]: false }));
    setReloadErrorsByConnection((current) => ({ ...current, [connectionId]: reloadError }));
  }

  function toggleWarning(key: string) {
    setExpandedWarnings((current) => ({ ...current, [key]: !current[key] }));
  }

  async function copyWarningPath(key: string, manifestPath: string) {
    await navigator.clipboard?.writeText(manifestPath);
    setCopiedWarningPath(key);
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
        description={
          <span className="notranslate" translate="no">维护每个连接的 Schema、YAML 资产与本地目录刷新状态。</span>
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
          value={catalogStatusLabel(lastCatalogRun, catalogReloadHistoryLoading, catalogReloadHistoryError)}
          subValue={catalogStatusSubValue(lastCatalogRun, catalogReloadHistoryLoading, catalogReloadHistoryError)}
          tone={catalogStatusTone(lastCatalogRun, catalogReloadHistoryLoading, catalogReloadHistoryError)}
        />
      </div>

      <div className="pl-overview-grid pl-overview-grid--flat">
        {connections.length === 0 && (
          <p className="text-sm text-fg-muted py-4 notranslate" translate="no">暂无连接配置，请在 ktx.yaml 中添加 connections。</p>
        )}
        {connections.map((conn) => {
            const lastRun =
              reloadRunsByConnection[conn.id] ??
              (catalogReloadHistoryReady ? catalogReloadsQuery.data.lastByConnection[conn.id] : undefined);
            const reloadError = reloadErrorsByConnection[conn.id] ?? null;
            const catalogState = catalogRunState(
              lastRun,
              Boolean(reloadingConnections[conn.id]),
              reloadError,
              catalogReloadHistoryLoading,
              catalogReloadHistoryError
            );
            const schemaRows = conn.schemas.map((schema) => {
              const enabledTableCountForSchema = conn.enabledTables.filter((entry) =>
                entry.startsWith(`${schema}.`)
              ).length;
              return {
                schema,
                assetState: schemaAssetState(conn.id, schema, semanticTables, lastRun),
                enabledTableCount: enabledTableCountForSchema
              };
            });
            const missingManifestWarnings = (lastRun?.warnings ?? []).filter(
              (warning) => warning.connectionId === conn.id && warning.code === "SCHEMA_MANIFEST_MISSING" && warning.schema
            );
            const missingManifestWarningsBySchema = new Map(
              missingManifestWarnings.map((warning) => [warning.schema, warning])
            );
            const readOnly = readOnlyStatus(conn);
            const host = hostValue(conn);
            const database = databaseValue(conn);
            const showRefreshWarning = shouldShowRefreshWarning(
              lastRun ?? null,
              Boolean(reloadingConnections[conn.id]),
              Boolean(reloadError || catalogReloadHistoryError),
              catalogReloadHistoryReady
            );
            const headerTimestamp = lastRun ? formatLocalTime(lastRun.startedAt) : null;
            const headerTimestampIso = lastRun?.startedAt ?? null;
            const showCatalogRunStatus = shouldShowCatalogRunStatus(
              lastRun,
              Boolean(reloadingConnections[conn.id]),
              Boolean(reloadError),
              catalogReloadHistoryLoading,
              Boolean(catalogReloadHistoryError)
            );
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
                  <div className="pl-connection-card-meta notranslate" translate="no">
                    <span
                      className={`pl-connection-readonly-status pl-connection-readonly-status--${readOnly.tone}`}
                      translate="no"
                      title={readOnly.title}
                      data-testid={`connection-readonly-${conn.id}`}
                    >
                      {readOnly.label}
                    </span>
                    {headerTimestamp ? (
                      <span
                        className={`pl-connection-last-reload pl-connection-last-reload--${lastRun?.status === "failed" ? "danger" : "muted"}`}
                        data-testid={`connection-last-reload-${conn.id}`}
                        title={headerTimestampIso ?? undefined}
                        translate="no"
                      >
                        <span>上次刷新：</span>
                        <time className="notranslate" translate="no" dir="ltr">{headerTimestamp}</time>
                        {lastRun?.status === "failed" ? <span> · 失败</span> : null}
                      </span>
                    ) : null}
                  </div>
                  <dl className="pl-connection-kv-grid pl-connection-kv-grid--compact" data-testid={`connection-kv-${conn.id}`}>
                    <div className="pl-connection-kv">
                      <dt className="notranslate" translate="no">Host</dt>
                      <dd>
                        <code
                          className="pl-connection-kv-host notranslate"
                          translate="no"
                          dir="ltr"
                          title={host.title}
                        >
                          {host.text}
                        </code>
                      </dd>
                    </div>
                    <div className="pl-connection-kv">
                      <dt className="notranslate" translate="no">Database</dt>
                      <dd>
                        <code
                          className="notranslate"
                          translate="no"
                          dir="ltr"
                          title={database.title}
                        >
                          {database.text}
                        </code>
                      </dd>
                    </div>
                  </dl>
                </div>
                <div className="pl-connection-card-body">
                  {showRefreshWarning ? (
                    <div
                      className="pl-connection-refresh-warning notranslate"
                      data-testid={`connection-refresh-warning-${conn.id}`}
                      role="status"
                      translate="no"
                    >
                      <p className="pl-connection-refresh-warning-text">
                        <span>本地目录未刷新：</span>
                        <span>尚未读取本地 YAML 资产配置。</span>
                      </p>
                      <CatalogReloadButton
                        connectionId={conn.id}
                        label="立即刷新"
                        variant="ghost"
                        size="sm"
                        testId={`connection-refresh-warning-action-${conn.id}`}
                        showCompletionLabel={false}
                        showInlineResult={false}
                        onReloadStart={() => handleReloadStart(conn.id)}
                        onReloadComplete={(run) => handleReloadComplete(conn.id, run)}
                        onReloadError={(reloadButtonError) => handleReloadError(conn.id, reloadButtonError)}
                      />
                    </div>
                  ) : null}

                  <div className="pl-schema-asset-heading">
                    <span className="notranslate" translate="no">关联 Schema 资产列表</span>
                  </div>
	                  {conn.schemas.length === 0 ? (
	                    <p className="text-sm text-fg-muted py-3 notranslate" translate="no">尚未配置 Schema。请先添加 Schema。</p>
	                  ) : (
	                    <table className="pl-schema-asset-table" data-testid={`schema-asset-table-${conn.id}`}>
                        <colgroup>
                          <col className="pl-schema-asset-col-schema" />
                          <col className="pl-schema-asset-col-status" />
                          <col className="pl-schema-asset-col-local-count" />
                          <col className="pl-schema-asset-col-enabled-count" />
                          <col className="pl-schema-asset-col-action" />
                        </colgroup>
	                      <thead>
                        <tr>
                          <th className="notranslate" translate="no">Schema</th>
                          <th className="notranslate" translate="no">Manifest 状态</th>
                          <th>本地表数</th>
                          <th>启用表数</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaRows.map(({ schema, assetState, enabledTableCount }) => {
                          const hasManifest = assetState.tone === "success";
                          const warning = missingManifestWarningsBySchema.get(schema);
                          const key = warning ? warningKey(conn.id, schema) : "";
                          const expanded = key ? Boolean(expandedWarnings[key]) : false;
                          const manifestPath = warning ? missingManifestPath(conn.id, schema, warning) : "";
                          return (
                            <Fragment key={schema}>
                              <tr
                                data-tone={assetState.tone}
                                data-testid={`schema-row-${conn.id}-${schema}`}
                              >
                                <td><code className="notranslate" translate="no" dir="ltr">{schema}</code></td>
                                <td>
                                  <span
                                    className={`pl-schema-asset-status pl-schema-asset-status--${assetState.tone} notranslate`}
                                    data-testid={`schema-asset-status-${conn.id}-${schema}`}
                                    translate="no"
                                  >
                                    {assetState.label}
                                  </span>
                                </td>
                                <td className="pl-schema-asset-table-num">{assetState.tableCount} 张表</td>
                                <td
                                  className="pl-schema-asset-table-num"
                                  data-testid={`schema-enabled-count-${conn.id}-${schema}`}
                                >
                                  {enabledTableCount}
                                </td>
                                <td>
                                  {hasManifest ? (
                                    <Link
                                      className="pl-row-action-link"
                                      to={`/connections/whitelist?schema=${encodeURIComponent(schema)}`}
                                      data-testid={`schema-whitelist-${conn.id}-${schema}`}
                                    >
                                      维护启用范围
                                    </Link>
                                  ) : (
                                    <CatalogAssetUploadButton
                                      connectionId={conn.id}
                                      schema={schema}
                                      label="上传 Manifest"
                                      variant="link"
                                      size="sm"
                                      testId={`upload-yaml-${conn.id}-${schema}`}
                                    />
                                  )}
                                </td>
                              </tr>
                              {warning ? (
                                <tr
                                  className="pl-schema-warning-subrow notranslate"
                                  data-testid={`catalog-reload-warning-${conn.id}-${schema}`}
                                  translate="no"
                                >
                                  <td colSpan={5}>
                                    <div className="pl-schema-warning-subrow-content">
                                      <div className="pl-catalog-reload-warning-copy">
                                        <strong className="notranslate" translate="no">
                                          缺少 Manifest：<span className="notranslate" translate="no">{schema}</span>
                                        </strong>
                                        <p className="notranslate" translate="no">
                                          已启用但本地 schema 文件不存在。路径：<code dir="ltr">{manifestPath}</code>
                                        </p>
                                      </div>
                                      <div className="pl-catalog-reload-warning-actions">
                                        <button
                                          type="button"
                                          className="pl-btn pl-btn--ghost pl-btn--sm"
                                          aria-expanded={expanded}
                                          onClick={() => toggleWarning(key)}
                                        >
                                          <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span>
                                          {expanded ? "收起详情" : "展开详情"}
                                        </button>
                                        <button
                                          type="button"
                                          className="pl-btn pl-btn--ghost pl-btn--sm"
                                          onClick={() => void copyWarningPath(key, manifestPath)}
                                        >
                                          <span aria-hidden="true">⧉</span>
                                          {copiedWarningPath === key ? "已复制路径" : "复制路径"}
                                        </button>
                                        <CatalogReloadButton
                                          connectionId={conn.id}
                                          label="↻ 重新检查"
                                          variant="secondary"
                                          size="sm"
                                          testId={`catalog-reload-recheck-${conn.id}-${schema}`}
                                          showCompletionLabel={false}
                                          showInlineResult={false}
                                          onReloadStart={() => handleReloadStart(conn.id)}
                                          onReloadComplete={(run) => handleReloadComplete(conn.id, run)}
                                          onReloadError={(reloadButtonError) => handleReloadError(conn.id, reloadButtonError)}
                                        />
                                      </div>
                                      {expanded ? (
                                        <dl
                                          className="pl-catalog-reload-warning-details"
                                          data-testid={`catalog-reload-warning-details-${conn.id}-${schema}`}
                                        >
                                          <div>
                                            <dt>诊断代码</dt>
                                            <dd>{warningDiagnosticCode(warning)}</dd>
                                          </div>
                                          <div>
                                            <dt>预期路径</dt>
                                            <dd><code dir="ltr">{manifestPath}</code></dd>
                                          </div>
                                          <div>
                                            <dt>刷新范围</dt>
                                            <dd>刷新本地目录只读取本地 YAML，不会连接数据库。</dd>
                                          </div>
                                        </dl>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              ) : null}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
	                </div>
	                <div className="pl-connection-card-footer">
                    {showCatalogRunStatus ? (
                      <div
                        className={`pl-catalog-reload-status pl-catalog-reload-status--${catalogState.tone} notranslate`}
                        data-testid={`catalog-reload-status-${conn.id}`}
                        role={catalogState.tone === "danger" ? "alert" : "status"}
                        translate="no"
                      >
                        <span className="pl-catalog-reload-status-main">{catalogState.label}</span>
                        {catalogState.detail ? <span>{catalogState.detail}</span> : null}
                      </div>
                    ) : null}
	                  <div
	                    className="pl-connection-card-schema-actions"
                    data-testid={`connection-card-schema-actions-${conn.id}`}
                  >
                    <button
                      type="button"
                      className="pl-btn pl-btn--secondary notranslate"
                      onClick={() => setAddTarget(conn)}
                      data-testid={`add-schema-${conn.id}`}
                      translate="no"
                    >
                      + 添加 Schema
                    </button>
                    <CatalogReloadButton
                      connectionId={conn.id}
                      label="刷新本地目录"
                      variant="primary"
                      testId={`catalog-reload-${conn.id}`}
                      showCompletionLabel={false}
                      showInlineResult={false}
                      onReloadStart={() => handleReloadStart(conn.id)}
                      onReloadComplete={(run) => handleReloadComplete(conn.id, run)}
                      onReloadError={(reloadButtonError) => handleReloadError(conn.id, reloadButtonError)}
                    />
                  </div>
                </div>
              </div>
            );
          })}
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
