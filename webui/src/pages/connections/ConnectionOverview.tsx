import { Fragment } from "react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Database, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchCatalogSchemaManifest } from "../../lib/catalog-assets";
import { apiGet } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CatalogReloadsResponse,
  CatalogReloadRun,
  CatalogReloadWarning,
  CatalogSchemaManifestReadResponse,
  ConnectionInfo,
  ProjectInfo,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { AddSchemaDrawer } from "../../components/AddSchemaDrawer";
import {
  CatalogAssetManifestDrawer,
  CatalogAssetUploadButton,
  CatalogAssetUploadDrawer,
  CatalogReloadButton,
  triggerCatalogManifestDownload
} from "../../components/catalog";
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

function engineKey(engine?: string): "mysql" | "postgres" | "doris" | "starrocks" | "db" {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "mysql";
  if (normalized === "postgres" || normalized === "postgresql") return "postgres";
  if (normalized === "doris") return "doris";
  if (normalized === "starrocks") return "starrocks";
  return "db";
}

function catalogReloadTimestampTitle(iso: string): string {
  return `本地目录刷新时间：${iso}。读取本地 YAML / Schema Manifest 后生成的 Catalog 快照时间，不会连接数据库。`;
}

function formatLocalTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")} ${value("hour")}:${value("minute")}`;
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

type ManifestViewTarget = {
  connectionId: string;
  schema: string;
};

type ManifestUploadTarget = ManifestViewTarget & {
  initialContent: string;
  initialFilename: string;
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

function schemaHasReadableManifest(assetState: SchemaAssetState): boolean {
  return (
    assetState.label === "已存在" ||
    assetState.label === "空 Manifest" ||
    assetState.label === "Manifest 解析失败"
  );
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

function schemaRefKey(connectionId: string, schema: string): string {
  return `${connectionId}\u0001${schema}`;
}

function configuredSchemaRefs(connections: ConnectionInfo[]): Set<string> {
  const refs = new Set<string>();
  for (const conn of connections) {
    for (const schema of conn.schemas) {
      refs.add(schemaRefKey(conn.id, schema));
    }
  }
  return refs;
}

function localManifestSchemaRefs(
  tables: SourceSummary[],
  manifestSchemas?: SourcesResponse["manifestSchemas"]
): Set<string> {
  const refs = new Set<string>();
  if (manifestSchemas) {
    for (const manifest of manifestSchemas) {
      refs.add(schemaRefKey(manifest.conn, manifest.schema));
    }
    return refs;
  }
  for (const table of tables) {
    refs.add(schemaRefKey(table.conn, table.schema));
  }
  return refs;
}

function enabledLocalTableCount(connections: ConnectionInfo[], tables: SourceSummary[]): number {
  const enabledByConnection = new Map(connections.map((conn) => [conn.id, new Set(conn.enabledTables)]));
  return tables.filter((table) =>
    enabledByConnection.get(table.conn)?.has(table.qualifiedName ?? `${table.schema}.${table.table}`)
  ).length;
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
  const semanticTables = sourcesQuery.data?.tables ?? [];
  const schemaCount = connections.reduce((sum, conn) => sum + conn.schemas.length, 0);
  const configuredSchemas = configuredSchemaRefs(connections);
  const localManifestSchemas = localManifestSchemaRefs(semanticTables, sourcesQuery.data?.manifestSchemas);
  const missingManifestSchemaCount = [...configuredSchemas].filter((schemaRef) => !localManifestSchemas.has(schemaRef)).length;
  const enabledLocalCount = enabledLocalTableCount(connections, semanticTables);
  const unenabledLocalTableCount = semanticTables.length - enabledLocalCount;
  const catalogReloadHistoryReady = catalogReloadsQuery.isSuccess;
  const catalogReloadHistoryLoading = catalogReloadsQuery.isLoading;
  const catalogReloadHistoryError = catalogReloadsQuery.error instanceof Error ? catalogReloadsQuery.error : null;
  const loading = projectQuery.isLoading || sourcesQuery.isLoading;
  const error = projectQuery.error ?? sourcesQuery.error;
  const [addTarget, setAddTarget] = useState<ConnectionInfo | null>(null);
  const [reloadRunsByConnection, setReloadRunsByConnection] = useState<Record<string, CatalogReloadRun>>({});
  const [reloadErrorsByConnection, setReloadErrorsByConnection] = useState<Record<string, Error | null>>({});
  const [reloadingConnections, setReloadingConnections] = useState<Record<string, boolean>>({});
  const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
  const [copiedWarningPath, setCopiedWarningPath] = useState<string | null>(null);
  const [manifestViewTarget, setManifestViewTarget] = useState<ManifestViewTarget | null>(null);
  const [manifestUploadTarget, setManifestUploadTarget] = useState<ManifestUploadTarget | null>(null);
  const [downloadingManifestKey, setDownloadingManifestKey] = useState<string | null>(null);

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

  function openReuploadDrawer(asset: CatalogSchemaManifestReadResponse) {
    setManifestViewTarget(null);
    setManifestUploadTarget({
      connectionId: asset.connectionId,
      schema: asset.schema,
      initialContent: asset.content,
      initialFilename: asset.filename
    });
  }

  async function downloadManifest(connectionId: string, schema: string) {
    const key = warningKey(connectionId, schema);
    setDownloadingManifestKey(key);
    try {
      const asset = await fetchCatalogSchemaManifest(connectionId, schema);
      triggerCatalogManifestDownload(asset);
      toast.success("Schema Manifest 已开始下载");
    } catch (downloadError) {
      toast.error(
        `下载失败：${downloadError instanceof Error ? downloadError.message : "未知错误"}`
      );
    } finally {
      setDownloadingManifestKey(null);
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
          type="missingManifestSchemas"
          value={missingManifestSchemaCount}
          subValue={`配置 ${configuredSchemas.size} 个 Schema / 有 Manifest ${localManifestSchemas.size} 个`}
          tone={missingManifestSchemaCount > 0 ? "warning" : undefined}
        />
        <MetricCard
          type="localCatalogTables"
          value={semanticTables.length}
          subValue={`来自 ${localManifestSchemas.size} 个 Schema Manifest`}
        />
        <MetricCard
          type="unenabledTables"
          value={unenabledLocalTableCount}
          subValue={`已启用 ${enabledLocalCount} / 本地 ${semanticTables.length} 张表`}
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
            const engine = engineLabel(conn.engine ?? conn.driver);
            const engineTone = engineKey(conn.engine ?? conn.driver);
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
                    <span className="pl-connection-engine-icon" data-engine={engineTone} aria-hidden="true">
                      <Database className="pl-connection-engine-icon-svg" strokeWidth={1.8} />
                    </span>
                    <span className="pl-connection-title-copy">
                      <strong className="notranslate" translate="no">{conn.id}</strong>
                      <span
                        className="pl-engine-badge notranslate"
                        data-testid={`engine-badge-${conn.id}`}
                        translate="no"
                      >
                        {engine}
                      </span>
                    </span>
                  </div>
                  <div className="pl-connection-card-meta notranslate" translate="no">
                    {readOnly.tone === "risk" ? (
                      <span
                        className={`pl-connection-readonly-status pl-connection-readonly-status--${readOnly.tone}`}
                        translate="no"
                        title={readOnly.title}
                        data-testid={`connection-readonly-${conn.id}`}
                      >
                        {readOnly.label}
                      </span>
                    ) : null}
                    {headerTimestamp ? (
                      <span
                        className={`pl-connection-last-reload pl-connection-last-reload--${lastRun?.status === "failed" ? "danger" : "muted"}`}
                        data-testid={`connection-last-reload-${conn.id}`}
                        title={headerTimestampIso ? catalogReloadTimestampTitle(headerTimestampIso) : undefined}
                        translate="no"
                      >
                        <span>本地目录刷新：</span>
                        <time className="notranslate" translate="no" dir="ltr">{headerTimestamp}</time>
                        {lastRun?.status === "failed" ? <span> · 失败</span> : null}
                      </span>
                    ) : null}
                  </div>
                  <dl className="pl-connection-kv-grid pl-connection-kv-grid--compact" data-testid={`connection-kv-${conn.id}`}>
                    <div className="pl-connection-kv">
                      <dt className="notranslate" translate="no">Host</dt>
                      <dd>
                        <Server className="pl-connection-kv-icon" aria-hidden="true" strokeWidth={1.8} />
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
                        <Database className="pl-connection-kv-icon" aria-hidden="true" strokeWidth={1.8} />
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

                  {conn.schemas.length === 0 ? (
                    <p className="text-sm text-fg-muted py-3 notranslate" translate="no">尚未配置 Schema。请先添加 Schema。</p>
                  ) : (
                    <table className="pl-data-grid pl-data-table pl-schema-asset-table" data-testid={`schema-asset-table-${conn.id}`}>
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
                          <th className="pl-schema-asset-table-num-head">本地表数</th>
                          <th className="pl-schema-asset-table-num-head">启用表数</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaRows.map(({ schema, assetState, enabledTableCount }) => {
                          const hasReadableManifest = schemaHasReadableManifest(assetState);
                          const warning = missingManifestWarningsBySchema.get(schema);
                          const key = warning ? warningKey(conn.id, schema) : "";
                          const expanded = key ? Boolean(expandedWarnings[key]) : false;
                          const manifestPath = warning ? missingManifestPath(conn.id, schema, warning) : "";
                          const rowManifestKey = warningKey(conn.id, schema);
                          // UX-CONNECTIONS-005: when local Manifest read 0 but
                          // enabled_tables configured N>0, surface a tooltip +
                          // inline source explanation so the two counts stop
                          // looking self-contradictory. The numbers are
                          // source-backed: local table count comes from
                          // /api/connections/<id>/tables (Schema Manifest);
                          // enabled count comes from `enabled_tables` in
                          // ktx.yaml.
                          const explainSourceDrift =
                            assetState.tableCount === 0 && enabledTableCount > 0;
                          const sourceDriftHintId = `schema-source-drift-hint-${conn.id}-${schema}`;
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
                                <td className="pl-schema-asset-table-num">
                                  <span
                                    className="pl-schema-asset-local-count"
                                    data-state={explainSourceDrift ? "drift" : "ok"}
                                    data-testid={`schema-local-count-${conn.id}-${schema}`}
                                    title={
                                      explainSourceDrift
                                        ? `本地 Manifest 未读到表，但 enabled_tables 已配置 ${enabledTableCount} 张：两个数字来自不同数据源。`
                                        : undefined
                                    }
                                    aria-describedby={
                                      explainSourceDrift ? sourceDriftHintId : undefined
                                    }
                                  >
                                    {assetState.tableCount} 张表
                                    {explainSourceDrift ? (
                                      <span
                                        className="pl-schema-asset-source-drift-tag"
                                        data-testid={`schema-source-drift-tag-${conn.id}-${schema}`}
                                      >
                                        {" · 来源：enabled_tables"}
                                      </span>
                                    ) : null}
                                  </span>
                                </td>
                                <td
                                  className="pl-schema-asset-table-num"
                                  data-testid={`schema-enabled-count-${conn.id}-${schema}`}
                                >
                                  {enabledTableCount} 张表
                                </td>
                                <td className="pl-schema-asset-table-action">
                                  <div className="pl-schema-asset-actions">
                                    {hasReadableManifest ? (
                                      <>
                                        <button
                                          type="button"
                                          className="pl-row-action-link notranslate"
                                          translate="no"
                                          onClick={() => setManifestViewTarget({ connectionId: conn.id, schema })}
                                          data-testid={`view-manifest-${conn.id}-${schema}`}
                                        >
                                          查看 Manifest
                                        </button>
                                        <button
                                          type="button"
                                          className="pl-row-action-link pl-row-action-link--muted"
                                          disabled={downloadingManifestKey === rowManifestKey}
                                          onClick={() => void downloadManifest(conn.id, schema)}
                                          data-testid={`download-manifest-${conn.id}-${schema}`}
                                        >
                                          {downloadingManifestKey === rowManifestKey ? "下载中..." : "下载"}
                                        </button>
                                        <button
                                          type="button"
                                          className="pl-row-action-link"
                                          onClick={async () => {
                                            try {
                                              const asset = await fetchCatalogSchemaManifest(conn.id, schema);
                                              openReuploadDrawer(asset);
                                            } catch (openError) {
                                              toast.error(
                                                `读取失败：${openError instanceof Error ? openError.message : "未知错误"}`
                                              );
                                            }
                                          }}
                                          data-testid={`reupload-manifest-${conn.id}-${schema}`}
                                        >
                                          重新上传
                                        </button>
                                        <Link
                                          className="pl-row-action-link pl-row-action-link--muted"
                                          to={`/connections/enabled-tables?connection=${encodeURIComponent(conn.id)}&schema=${encodeURIComponent(schema)}`}
                                          data-testid={`schema-whitelist-${conn.id}-${schema}`}
                                        >
                                          维护启用范围
                                        </Link>
                                      </>
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
                                    {warning ? (
                                      <button
                                        type="button"
                                        className="pl-row-action-link pl-row-action-link--muted"
                                        aria-expanded={expanded}
                                        onClick={() => toggleWarning(key)}
                                        data-testid={`catalog-reload-warning-toggle-${conn.id}-${schema}`}
                                      >
                                        {expanded ? "收起详情" : "查看详情"}
                                      </button>
                                    ) : null}
                                  </div>
                                </td>
                              </tr>
                              {warning && expanded ? (
                                <tr
                                  className="pl-schema-warning-subrow notranslate"
                                  data-testid={`catalog-reload-warning-${conn.id}-${schema}`}
                                  translate="no"
                                >
                                  <td colSpan={5}>
                                    <div className="pl-schema-warning-subrow-content">
                                      <div className="pl-catalog-reload-warning-main">
                                        <div className="pl-catalog-reload-warning-copy">
                                          <strong className="notranslate" translate="no">
                                            缺少 Manifest：<span className="notranslate" translate="no">{schema}</span>
                                          </strong>
                                          <p className="notranslate" translate="no">
                                            已启用但本地 Schema Manifest 文件不存在。
                                          </p>
                                          <div className="pl-catalog-reload-warning-path notranslate" translate="no">
                                            <span>预期路径</span>
                                            <code dir="ltr">{manifestPath}</code>
                                          </div>
                                        </div>
                                        <div className="pl-catalog-reload-warning-actions">
                                          <button
                                            type="button"
                                            className="pl-btn pl-btn--ghost pl-btn--sm"
                                            aria-expanded={expanded}
                                            onClick={() => toggleWarning(key)}
                                          >
                                            <span aria-hidden="true">⌃</span>
                                            收起详情
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
                      variant="secondary"
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
      {manifestViewTarget ? (
        <CatalogAssetManifestDrawer
          open={Boolean(manifestViewTarget)}
          onClose={() => setManifestViewTarget(null)}
          connectionId={manifestViewTarget.connectionId}
          schema={manifestViewTarget.schema}
          onReupload={openReuploadDrawer}
        />
      ) : null}
      {manifestUploadTarget ? (
        <CatalogAssetUploadDrawer
          open={Boolean(manifestUploadTarget)}
          onClose={() => setManifestUploadTarget(null)}
          connectionId={manifestUploadTarget.connectionId}
          schema={manifestUploadTarget.schema}
          mode="update"
          initialContent={manifestUploadTarget.initialContent}
          initialFilename={manifestUploadTarget.initialFilename}
        />
      ) : null}
    </div>
  );
}
