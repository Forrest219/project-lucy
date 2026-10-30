import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Database, Server } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { fetchCatalogSchemaManifest } from "../../lib/catalog-assets";
import { countEnabledForSchema, manifestTableIsEnabled } from "../../lib/enabled-table-identity";
import { apiGet, apiPost } from "../../lib/apiClient";
import { copyTextToClipboard } from "../../lib/clipboard";
import {
  connectionHealthDrawerResult,
  connectionHealthStatusLabel,
  connectionReadinessLabel,
  formatProbeClock
} from "../../lib/connectionHealth";
import { queryKeys } from "../../lib/queryKeys";
import {
  OPS_EVIDENCE_CONNECTION_DISPLAY_NAME,
  OPS_EVIDENCE_CONNECTION_ID
} from "../../lib/opsEvidence";
import type {
  CatalogReloadsResponse,
  CatalogReloadRun,
  CatalogReloadWarning,
  CatalogSchemaManifestReadResponse,
  ConnectionInfo,
  ConnectionTestResult,
  DiscoveryStatusResponse,
  ExecutionRuntimeStatus,
  LiveSchemasResponse,
  SourceSummary,
  SourcesResponse,
  TableDiffResponse
} from "../../lib/types";
import {
  canReadDatabaseStructure,
  deriveAssistantResumeState,
  formatAssistantProgressCompact,
  formatAssistantProgressLabel,
  getAssistantDraft,
  type SetupStep
} from "../../lib/setupAssistant";
import {
  CatalogAssetManifestDrawer,
  CatalogAssetUploadButton,
  CatalogAssetUploadDrawer,
  CatalogReloadButton,
  triggerCatalogManifestDownload
} from "../../components/catalog";
import { ConnectionTestDrawer } from "../../components/connections";
import {
  DiscoveryStateCell,
  LiveTableListCell,
  discoveryReasonLabel
} from "../../components/connections/SchemaDiscoveryCells";
import { PageHeader } from "../../components/PageHeader";
import { AsyncRegion, asyncStatus } from "../../components/AsyncRegion";
import { MetricCard } from "./MetricCard";
import { catalogReloadsQueryOptions, mcpRuntimeStatusQueryOptions, projectQueryOptions, sourcesQueryOptions, useDisplayFactsPending } from "../../lib/displayQueryOptions";

// Spec 174 §6 — drawers / the setup assistant only load when opened.
const AddSchemaDrawer = lazy(() => import("../../components/AddSchemaDrawer").then((m) => ({ default: m.AddSchemaDrawer })));
const PrepareSchemaStructureDrawer = lazy(() => import("../../components/SchemaStructurePrep").then((m) => ({ default: m.PrepareSchemaStructureDrawer })));
const CreateConnectionDrawer = lazy(() => import("../../components/CreateConnectionDrawer").then((m) => ({ default: m.CreateConnectionDrawer })));
const DeleteConnectionDrawer = lazy(() => import("../../components/DeleteConnectionDrawer").then((m) => ({ default: m.DeleteConnectionDrawer })));
const RemoveSchemaDrawer = lazy(() => import("../../components/RemoveSchemaDrawer").then((m) => ({ default: m.RemoveSchemaDrawer })));
const SetupAssistantModal = lazy(() => import("../../components/onboarding").then((m) => ({ default: m.SetupAssistantModal })));

/** Spec 107: client staleTime aligned with server TTL. */
const LIVE_SCHEMAS_STALE_MS = 10 * 60 * 1000;

function engineLabel(engine?: string) {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "MySQL";
  if (normalized === "postgres" || normalized === "postgresql") return "Postgres";
  if (normalized === "doris") return "Doris";
  if (normalized === "starrocks") return "StarRocks";
  if (normalized === "athena") return "Athena";
  // Spec 149 §4 — 运维问数连接指向审计热库，引擎显示 SQLite。
  if (normalized === "sqlite") return "SQLite";
  return "DB";
}

function engineKey(engine?: string): "mysql" | "postgres" | "doris" | "starrocks" | "db" {
  const normalized = engine?.toLowerCase();
  if (normalized === "mysql") return "mysql";
  if (normalized === "postgres" || normalized === "postgresql") return "postgres";
  if (normalized === "doris") return "doris";
  if (normalized === "starrocks") return "starrocks";
  if (normalized === "athena") return "db";
  return "db";
}

function catalogReloadTimestampTitle(iso: string): string {
  return `配置同步时间：${iso}。上传或修改 Schema Manifest 后，可用“刷新本地目录”让页面读取最新 YAML 资产，不会连接数据库。`;
}

function executionNoticeCopy(status: ExecutionRuntimeStatus | undefined): string | null {
  if (status === "stale") {
    return "问数服务仍在使用旧配置。已保存的连接里有尚未被它加载的项。";
  }
  if (status === "unavailable" || status === "error") {
    return "问数服务当前不可用。连接配置已保存，问数要等服务恢复后才能使用这些连接。";
  }
  return null;
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
  mode: "create" | "update";
  initialContent?: string;
  initialFilename?: string;
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
  run: CatalogReloadsResponse["lastByConnection"][string] | undefined,
  hasLocalManifestFile = false
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
  // Align row status with KPI「缺 Manifest 的 Schema」: configured schema without a
  // readable local Manifest uses one canonical label. Do not introduce a near-synonym
  // fallback such as「未发现本地 Manifest」when the last sync warning is absent.
  if (hasLocalManifestFile) {
    return { label: "空 Manifest", tableCount, tone: "warning" };
  }
  return { label: "缺失 Manifest", tableCount, tone: "warning" };
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
      label: "正在同步配置变更...",
      detail: "",
      tone: "muted",
      badgeLabel: "刷新中",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (error) {
    return {
      label: "配置同步失败",
      detail: error.message,
      tone: "danger",
      badgeLabel: "失败",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (isHistoryLoading) {
    return {
      label: "正在读取配置同步状态...",
      detail: "",
      tone: "muted",
      badgeLabel: "加载中",
      tableCount: run?.tables ?? 0,
      warningCount: run?.warnings.length ?? 0
    };
  }
  if (historyError) {
    return {
      label: "配置同步状态加载失败",
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
      label: "配置同步失败",
      detail: formatLocalTime(run.startedAt),
      tone: "danger",
      badgeLabel: "失败",
      tableCount: run.tables,
      warningCount: run.warnings.length
    };
  }
  return {
    label: "配置已同步",
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

/** Pointer can cross the 4px gap between a Schema 「更多」 and its menu without closing. */
const SCHEMA_MORE_CLOSE_DELAY_MS = 150;

type OpenMore =
  | { kind: "connection"; id: string }
  | { kind: "schema"; key: string };

function sameOpenMore(current: OpenMore | null, target: OpenMore | null): boolean {
  if (current === target) return true;
  if (!current || !target || current.kind !== target.kind) return false;
  if (current.kind === "connection" && target.kind === "connection") return current.id === target.id;
  if (current.kind === "schema" && target.kind === "schema") return current.key === target.key;
  return false;
}

function findOpenMoreRoot(target: OpenMore): HTMLElement | null {
  if (target.kind === "schema") {
    for (const node of document.querySelectorAll<HTMLElement>("[data-schema-more]")) {
      if (node.dataset.schemaMore === target.key) return node;
    }
    return null;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-connection-more]")) {
    if (node.dataset.connectionMore === target.id) return node;
  }
  return null;
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
  const byId = new Map(connections.map((conn) => [conn.id, conn]));
  return tables.filter((table) => {
    const conn = byId.get(table.conn);
    if (!conn) return false;
    const logicalName = `${table.schema}.${table.table}`;
    const physicalName = table.qualifiedName?.trim() || logicalName;
    return manifestTableIsEnabled(
      conn.enabledTables,
      logicalName,
      physicalName,
      conn.driver === "sqlserver"
    );
  }).length;
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

/** Body status line for reload facts; history loading / error is shown in the header slot (Spec 174 R5). */
function shouldShowCatalogRunStatus(
  lastRun: CatalogReloadRun | undefined,
  isReloading: boolean,
  hasReloadError: boolean
): boolean {
  return Boolean(isReloading || hasReloadError || lastRun?.status === "failed");
}

function liveTableCountCell(
  schema: string,
  live: LiveSchemasResponse | undefined,
  isLoading: boolean,
  isFetching: boolean,
  queryFailed: boolean
): { text: string; title?: string; state: "loading" | "ok" | "missing" | "error" } {
  if (isLoading || (isFetching && !live)) {
    return { text: "加载中", state: "loading" };
  }
  if (queryFailed || !live) {
    return {
      text: "不可用",
      title: "无法加载库内目录",
      state: "error"
    };
  }
  if (live.status === "error") {
    return {
      text: "不可用",
      title: live.reason || "无法查询库内目录",
      state: "error"
    };
  }
  const row = live.schemas?.find((item) => item.schema === schema);
  if (!row) {
    return {
      text: "—",
      title: "当前账号可见目录中未找到该 Schema",
      state: "missing"
    };
  }
  return { text: `${row.tableCount} 张表`, state: "ok" };
}

export function ConnectionOverview() {
  const queryClient = useQueryClient();
  const projectQuery = useQuery({
    ...projectQueryOptions()
  });
  const sourcesQuery = useQuery({
    ...sourcesQueryOptions()
  });
  const catalogReloadsQuery = useQuery({
    ...catalogReloadsQueryOptions()
  });
  const mcpRuntimeQuery = useQuery({
    ...mcpRuntimeStatusQueryOptions()
  });

  const connections = projectQuery.data?.connections ?? [];
  // Spec 174 §5: background probes start only after the primary connection cards
  // commit and paint (double rAF); the server queue (concurrency 2) runs them in card order.
  const [probesArmed, setProbesArmed] = useState(false);
  const cardsCommitted = projectQuery.data !== undefined;
  useLayoutEffect(() => {
    if (!cardsCommitted || probesArmed) return;
    performance.mark("lucy-connections-cards-commit");
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        performance.mark("lucy-connections-probes-armed");
        setProbesArmed(true);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [cardsCommitted, probesArmed]);
  const manualProbeIds = useRef(new Set<string>());
  const liveSchemaQueries = useQueries({
    queries: connections.map((conn) => ({
      queryKey: queryKeys.connectionLiveSchemas(conn.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiGet<LiveSchemasResponse>(
          `/api/connections/${encodeURIComponent(conn.id)}/live-schemas?purpose=automatic`,
          { signal }
        ),
      staleTime: LIVE_SCHEMAS_STALE_MS,
      retry: false,
      enabled: probesArmed
    }))
  });
  const liveByConnectionId = new Map(
    connections.map((conn, index) => [conn.id, liveSchemaQueries[index]] as const)
  );
  // Spec 190 §7.9 — continuous discovery state and the reconciliation state.
  // Both are read-only sidecar reads: no database round trip on page load.
  const discoveryQueries = useQueries({
    queries: connections.map((conn) => ({
      queryKey: queryKeys.connectionDiscovery(conn.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiGet<DiscoveryStatusResponse>(
          `/api/connections/${encodeURIComponent(conn.id)}/discovery`,
          { signal }
        ),
      staleTime: 30_000,
      retry: false,
      enabled: probesArmed
    }))
  });
  const tableDiffQueries = useQueries({
    queries: connections.map((conn) => ({
      queryKey: queryKeys.connectionTableDiff(conn.id),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiGet<TableDiffResponse>(
          `/api/connections/${encodeURIComponent(conn.id)}/table-diff`,
          { signal }
        ),
      staleTime: 30_000,
      retry: false,
      enabled: probesArmed
    }))
  });
  const discoveryByConnectionId = new Map(
    connections.map((conn, index) => [conn.id, discoveryQueries[index]] as const)
  );
  const tableDiffByConnectionId = new Map(
    connections.map((conn, index) => [conn.id, tableDiffQueries[index]] as const)
  );
  // Spec 108: parallel connectivity probe on every page entry (staleTime 0).
  // gcTime 0 drops cache on leave so remount cannot show a stale「通」.
  const healthQueries = useQueries({
    queries: connections.map((conn) => ({
      queryKey: queryKeys.connectionHealth(conn.id),
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        const purpose = manualProbeIds.current.delete(conn.id) ? "manual" : "automatic";
        return apiPost<ConnectionTestResult>(
          `/api/connections/${encodeURIComponent(conn.id)}/test`,
          { purpose },
          { signal }
        );
      },
      staleTime: 0,
      gcTime: 0,
      retry: false,
      enabled: probesArmed
    }))
  });
  const healthByConnectionId = new Map(
    connections.map((conn, index) => [conn.id, healthQueries[index]] as const)
  );
  const semanticTables = sourcesQuery.data?.tables ?? [];
  const schemaCount = connections.reduce((sum, conn) => sum + conn.schemas.length, 0);
  const configuredSchemas = configuredSchemaRefs(connections);
  const localManifestSchemas = localManifestSchemaRefs(semanticTables, sourcesQuery.data?.manifestSchemas);
  const configuredManifestSchemaCount = [...configuredSchemas].filter((schemaRef) =>
    localManifestSchemas.has(schemaRef)
  ).length;
  const missingManifestSchemaCount = [...configuredSchemas].filter((schemaRef) => !localManifestSchemas.has(schemaRef)).length;
  const enabledLocalCount = enabledLocalTableCount(connections, semanticTables);
  const unenabledLocalTableCount = semanticTables.length - enabledLocalCount;
  const catalogReloadHistoryReady = catalogReloadsQuery.isSuccess;
  const catalogReloadHistoryLoading = catalogReloadsQuery.isLoading;
  const catalogReloadHistoryError = catalogReloadsQuery.error instanceof Error ? catalogReloadsQuery.error : null;
  // Spec 174 §4.1: project alone drives the cards; sources only feeds local Manifest facts.
  // Runtime notice and reload times are decorations with stable slots (never a card gate).
  const projectStatus = asyncStatus(projectQuery);
  const cardsStatus = projectStatus;
  // If the runtime status is still pending when the cards first appear, keep a
  // notice-sized slot above the list for this page visit so a late notice (or
  // its absence) never moves the whole column.
  const runtimeSlotRef = useRef<boolean | null>(null);
  if (cardsCommitted && runtimeSlotRef.current === null) runtimeSlotRef.current = mcpRuntimeQuery.isPending;
  const reserveRuntimeSlot = runtimeSlotRef.current === true;
  const runtimeNotice = !mcpRuntimeQuery.isLoading && !mcpRuntimeQuery.isError ? executionNoticeCopy(mcpRuntimeQuery.data?.execution?.status) : null;
  const sourcesReady = sourcesQuery.data !== undefined;
  // Spec 174 §4.2: a pending write (or no re-read since) keeps Manifest facts unconfirmed for actions.
  const sourcesFactsPending = useDisplayFactsPending("sources");
  const sourcesActionsReady = sourcesReady && !sourcesFactsPending && !sourcesQuery.isFetching && !sourcesQuery.isError;
  const [addTarget, setAddTarget] = useState<ConnectionInfo | null>(null);
  const [structureTarget, setStructureTarget] = useState<{ connection: ConnectionInfo; schema: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantStep, setAssistantStep] = useState<SetupStep>(1);
  const [assistantConnId, setAssistantConnId] = useState("");
  const [removeTarget, setRemoveTarget] = useState<{ connection: ConnectionInfo; schema: string } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ConnectionInfo | null>(null);
  const [reloadRunsByConnection, setReloadRunsByConnection] = useState<Record<string, CatalogReloadRun>>({});
  const [reloadErrorsByConnection, setReloadErrorsByConnection] = useState<Record<string, Error | null>>({});
  const [reloadingConnections, setReloadingConnections] = useState<Record<string, boolean>>({});
  const [expandedWarnings, setExpandedWarnings] = useState<Record<string, boolean>>({});
  const [copiedWarningPath, setCopiedWarningPath] = useState<string | null>(null);
  const [manifestViewTarget, setManifestViewTarget] = useState<ManifestViewTarget | null>(null);
  const [manifestUploadTarget, setManifestUploadTarget] = useState<ManifestUploadTarget | null>(null);
  const [downloadingManifestKey, setDownloadingManifestKey] = useState<string | null>(null);
  const [refreshingLiveByConnection, setRefreshingLiveByConnection] = useState<Record<string, boolean>>({});
  const [testDrawerConnId, setTestDrawerConnId] = useState<string | null>(null);
  const [testLogsExpanded, setTestLogsExpanded] = useState(false);
  const [openMore, setOpenMore] = useState<OpenMore | null>(null);
  const schemaMoreCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelSchemaMoreClose() {
    if (schemaMoreCloseTimer.current != null) {
      clearTimeout(schemaMoreCloseTimer.current);
      schemaMoreCloseTimer.current = null;
    }
  }

  function closeMore() {
    cancelSchemaMoreClose();
    setOpenMore(null);
  }

  function toggleMore(next: OpenMore) {
    cancelSchemaMoreClose();
    setOpenMore((current) => (sameOpenMore(current, next) ? null : next));
  }

  function scheduleSchemaMoreClose(key: string) {
    cancelSchemaMoreClose();
    schemaMoreCloseTimer.current = setTimeout(() => {
      schemaMoreCloseTimer.current = null;
      setOpenMore((current) => (current?.kind === "schema" && current.key === key ? null : current));
    }, SCHEMA_MORE_CLOSE_DELAY_MS);
  }

  useEffect(() => {
    return () => {
      if (schemaMoreCloseTimer.current != null) clearTimeout(schemaMoreCloseTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!openMore) return;
    const target = openMore;

    function onPointerDown(event: PointerEvent) {
      const root = findOpenMoreRoot(target);
      if (root && event.target instanceof Node && root.contains(event.target)) return;
      cancelSchemaMoreClose();
      setOpenMore((current) => (sameOpenMore(current, target) ? null : current));
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      const root = findOpenMoreRoot(target);
      const summary = root?.querySelector("summary");
      const returnFocus =
        root != null &&
        document.activeElement instanceof Node &&
        root.contains(document.activeElement);
      cancelSchemaMoreClose();
      setOpenMore((current) => (sameOpenMore(current, target) ? null : current));
      if (returnFocus && summary instanceof HTMLElement) summary.focus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openMore]);

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
    const result = await copyTextToClipboard(manifestPath);
    if (!result.ok) {
      toast.error("复制路径失败，请手动选择文本");
      return;
    }
    setCopiedWarningPath(key);
  }

  function openReuploadDrawer(asset: CatalogSchemaManifestReadResponse) {
    setManifestViewTarget(null);
    setManifestUploadTarget({
      connectionId: asset.connectionId,
      schema: asset.schema,
      mode: "update",
      initialContent: asset.content,
      initialFilename: asset.filename
    });
  }

  function openCreateUploadDrawer(connectionId: string, schema: string) {
    closeMore();
    setManifestUploadTarget({
      connectionId,
      schema,
      mode: "create"
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

  const unknownMetric = "—";
  // Keeps every metric card's row structure identical before / after the facts arrive (PERF-09).
  const pendingSubValue = "\u00a0";

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="连接概览"
        description={
          <>
            管理数据库连接、<span className="notranslate" translate="no">Schema</span> 与{" "}
            <span className="notranslate" translate="no">Schema Manifest</span>，并查看连通性和本地目录同步状态。
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={() => {
                setAssistantConnId("");
                setAssistantStep(1);
                setAssistantOpen(true);
              }}
              data-testid="start-onboarding-assistant-btn"
            >
              启动接入向导
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => setCreateOpen(true)}
              data-testid="create-connection-btn"
            >
              新建连接
            </button>
          </div>
        }
      />

      <div className="pl-metric-grid">
        <MetricCard
          type="connections"
          value={projectStatus === "success" ? connections.length : unknownMetric}
          subValue={projectStatus !== "success" ? pendingSubValue : schemaCount > 0 ? `${schemaCount} 个 Schema` : "未配置 Schema"}
        />
        <MetricCard
          type="missingManifestSchemas"
          value={sourcesReady && projectStatus === "success" ? missingManifestSchemaCount : unknownMetric}
          subValue={sourcesReady && projectStatus === "success" ? `${configuredSchemas.size} 个 Schema 中 ${configuredManifestSchemaCount} 个已有 Manifest` : pendingSubValue}
          tone={sourcesReady && missingManifestSchemaCount > 0 ? "warning" : undefined}
        />
        <MetricCard
          type="localCatalogTables"
          value={sourcesReady ? semanticTables.length : unknownMetric}
          subValue={sourcesReady && projectStatus === "success" ? `来自 ${configuredManifestSchemaCount} 个 Schema Manifest` : pendingSubValue}
        />
        <MetricCard
          type="unenabledTables"
          value={sourcesReady && projectStatus === "success" ? unenabledLocalTableCount : unknownMetric}
          subValue={sourcesReady && projectStatus === "success" ? `已启用 ${enabledLocalCount} / 本地 ${semanticTables.length} 张表` : pendingSubValue}
        />
      </div>

      <AsyncRegion
        status={cardsStatus}
        label="连接列表"
        error={projectQuery.error}
        onRetry={() => void projectQuery.refetch()}
        minHeight={320}
      >
      {/* Rendered with the cards (never above a still-pending list placeholder), so it cannot push it down. */}
      {runtimeNotice ? (
        <p className="pl-notice text-sm" role="status" data-testid="execution-runtime-notice">
          {runtimeNotice}{" "}
          <Link className="notranslate underline" translate="no" to="/admin/mcp-playground">
            打开 MCP 调试台
          </Link>
        </p>
      ) : reserveRuntimeSlot ? (
        <p className="pl-notice text-sm" aria-hidden="true" style={{ visibility: "hidden" }} data-testid="execution-runtime-slot">
          &nbsp;
        </p>
      ) : null}
      <div className="pl-overview-grid pl-overview-grid--flat">
        {connections.length === 0 && (
          <div className="py-8 px-6 text-center bg-bg-surface border border-border-default rounded-xl space-y-4" data-testid="connections-empty-state">
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Database className="w-6 h-6" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <p className="text-sm text-fg-muted">暂无连接配置。</p>
              <h3 className="text-base font-bold text-fg-default">欢迎使用 Lucy 数据库接入向导</h3>
              <p className="text-xs text-fg-muted notranslate" translate="no">
                一步只做一件事：从物理连接、上传 Schema Manifest、启用表配置到 Agent 客户端 MCP 接入，轻松完成配置。也可在 <code className="notranslate" translate="no">ktx.yaml</code> 中手工添加。
              </p>
            </div>
            <div className="flex justify-center gap-3">
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => {
                  setAssistantConnId("");
                  setAssistantStep(1);
                  setAssistantOpen(true);
                }}
                data-testid="start-assistant-empty-btn"
              >
                启动数据库接入向导
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--secondary"
                onClick={() => setCreateOpen(true)}
                data-testid="create-connection-empty-btn"
              >
                新建连接
              </button>
            </div>
          </div>
        )}
        {connections.map((conn) => {
            const lastRun =
              reloadRunsByConnection[conn.id] ??
              (catalogReloadHistoryReady ? catalogReloadsQuery.data?.lastByConnection?.[conn.id] : undefined);
            const reloadError = reloadErrorsByConnection[conn.id] ?? null;
            const catalogState = catalogRunState(
              lastRun,
              Boolean(reloadingConnections[conn.id]),
              reloadError,
              catalogReloadHistoryLoading,
              catalogReloadHistoryError
            );
            const liveQuery = liveByConnectionId.get(conn.id);
            const liveData = liveQuery?.data;
            const discoveryState = discoveryByConnectionId.get(conn.id)?.data;
            const tableDiffState = tableDiffByConnectionId.get(conn.id)?.data;
            const schemaRows = conn.schemas.map((schema) => {
              const enabledTableCountForSchema = countEnabledForSchema(
                schema,
                conn.enabledTables,
                semanticTables.filter((table) => table.conn === conn.id),
                conn.driver === "sqlserver"
              );
              return {
                schema,
                assetState: schemaAssetState(
                  conn.id,
                  schema,
                  semanticTables,
                  lastRun,
                  localManifestSchemas.has(schemaRefKey(conn.id, schema))
                ),
                enabledTableCount: enabledTableCountForSchema,
                liveCount: liveTableCountCell(
                  schema,
                  liveData,
                  Boolean(liveQuery?.isLoading),
                  Boolean(liveQuery?.isFetching),
                  Boolean(liveQuery?.isError)
                )
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
            const cardAssistantState = deriveAssistantResumeState({
              connection: conn,
              sources: sourcesQuery.data ?? null,
              draft: getAssistantDraft(conn.id)
            });
            const cardAssistantStep = cardAssistantState.step;
            const isAssistantInProgress = sourcesReady && cardAssistantStep < 6;
            const showCatalogRunStatus = shouldShowCatalogRunStatus(
              lastRun,
              Boolean(reloadingConnections[conn.id]),
              Boolean(reloadError)
            );
            const showHistoryStatus = !headerTimestamp && !showCatalogRunStatus && (catalogReloadHistoryLoading || Boolean(catalogReloadHistoryError));
            return (
              <div className="pl-connection-row" key={conn.id} data-testid={`connection-card-${conn.id}`}>
                <div className="pl-connection-card-header">
                  <div className="pl-connection-card-title">
                    <span className="pl-connection-engine-icon" data-engine={engineTone} aria-hidden="true">
                      <Database className="pl-connection-engine-icon-svg" strokeWidth={1.8} />
                    </span>
                    <span className="pl-connection-title-copy">
                      {/* Spec 149 §10 — 运维问数连接的卡片主称是「运维问数连接」；
                          连接 ID 仍然以 translate="no" 单独呈现。 */}
                      {conn.id === OPS_EVIDENCE_CONNECTION_ID ? (
                        <>
                          <strong data-testid={`connection-title-${conn.id}`}>
                            {OPS_EVIDENCE_CONNECTION_DISPLAY_NAME}
                          </strong>
                          <code
                            className="notranslate"
                            translate="no"
                            data-testid={`connection-id-${conn.id}`}
                          >
                            {conn.id}
                          </code>
                        </>
                      ) : (
                        <strong className="notranslate" translate="no">{conn.id}</strong>
                      )}
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
                    {(() => {
                      const healthQuery = healthByConnectionId.get(conn.id);
                      const healthResult = healthQuery?.data;
                      const queryFailed = Boolean(healthQuery?.isError);
                      const healthPending =
                        Boolean(healthQuery?.isFetching) && !healthResult && !queryFailed;
                      // Prefer query error over stale ok cache after a failed refetch.
                      const healthFailed =
                        queryFailed || healthResult?.status === "error";
                      const readiness = connectionReadinessLabel({
                        healthPending,
                        healthFailed,
                        healthOk: !healthPending && !healthFailed && Boolean(healthResult),
                        latencyMs: healthResult?.latencyMs
                      });
                      const statusTone = healthPending
                        ? { label: readiness.label, tone: readiness.tone }
                        : healthFailed
                          ? { label: readiness.label, tone: readiness.tone }
                          : connectionHealthStatusLabel("ok", healthResult?.latencyMs);
                      const displayLatencyMs =
                        !healthPending &&
                        healthResult?.latencyMs !== undefined &&
                        (!queryFailed || healthResult.status === "error")
                          ? healthResult.latencyMs
                          : undefined;
                      const probeClock =
                        healthQuery?.dataUpdatedAt &&
                        healthResult &&
                        (!queryFailed || healthResult.status === "error")
                          ? formatProbeClock(healthQuery.dataUpdatedAt)
                          : "";
                      const ariaStatus = healthPending
                        ? "探测中"
                        : `${statusTone.label}${
                            displayLatencyMs !== undefined ? ` ${displayLatencyMs} 毫秒` : ""
                          }`;
                      return (
                        <button
                          type="button"
                          className={`pl-connection-health pl-connection-health--${statusTone.tone}`}
                          data-testid={`connection-health-${conn.id}`}
                          data-tone={statusTone.tone}
                          aria-haspopup="dialog"
                          aria-label={`连通健康 · ${conn.id} · ${ariaStatus}。打开连通测试`}
                          title="打开连通测试"
                          onClick={() => {
                            setTestDrawerConnId(conn.id);
                            setTestLogsExpanded(false);
                          }}
                        >
                          <span className="pl-connection-health-status">{statusTone.label}</span>
                          {displayLatencyMs !== undefined ? (
                            <span className="pl-connection-health-latency tabular-nums notranslate" translate="no">
                              · {displayLatencyMs} ms
                            </span>
                          ) : null}
                          {probeClock ? (
                            <time
                              className="pl-connection-health-time notranslate"
                              translate="no"
                              dateTime={new Date(healthQuery!.dataUpdatedAt).toISOString()}
                            >
                              · {probeClock}
                            </time>
                          ) : null}
                          <ChevronRight className="pl-connection-health-chevron" aria-hidden="true" strokeWidth={2} />
                        </button>
                      );
                    })()}
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
                        <span>配置同步：</span>
                        <time className="notranslate" translate="no" dir="ltr">{headerTimestamp}</time>
                        {lastRun?.status === "failed" ? <span> · 失败</span> : null}
                      </span>
                    ) : showHistoryStatus ? (
                      <span
                        className={`pl-connection-last-reload pl-connection-last-reload--${catalogState.tone === "danger" ? "danger" : "muted"} notranslate`}
                        data-testid={`catalog-reload-status-${conn.id}`}
                        role={catalogState.tone === "danger" ? "alert" : "status"}
                        title={catalogState.detail || undefined}
                        translate="no"
                      >
                        {catalogState.label}
                      </span>
                    ) : null}
                    {isAssistantInProgress ? (
                      <button
                        type="button"
                        className="pl-connection-progress notranslate"
                        translate="no"
                        title={formatAssistantProgressLabel(cardAssistantStep)}
                        aria-label={`继续向导，${formatAssistantProgressCompact(cardAssistantStep)}`}
                        data-testid={`resume-assistant-${conn.id}`}
                        onClick={() => {
                          setAssistantConnId(conn.id);
                          setAssistantStep(cardAssistantStep);
                          setAssistantOpen(true);
                        }}
                      >
                        {formatAssistantProgressCompact(cardAssistantStep)}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="pl-btn pl-btn--secondary notranslate"
                      onClick={() => setAddTarget(conn)}
                      data-testid={`add-schema-${conn.id}`}
                      translate="no"
                    >
                      添加 Schema
                    </button>
                    <details
                      className="pl-row-action-more pl-connection-more"
                      open={openMore?.kind === "connection" && openMore.id === conn.id}
                      data-connection-more={conn.id}
                      data-testid={`connection-more-${conn.id}`}
                      onToggle={(event) => {
                        const nextOpen = event.currentTarget.open;
                        const mine: OpenMore = { kind: "connection", id: conn.id };
                        setOpenMore((current) => {
                          if (nextOpen) return mine;
                          return sameOpenMore(current, mine) ? null : current;
                        });
                      }}
                    >
                      <summary
                        className="pl-row-action-link notranslate"
                        translate="no"
                        aria-label={`更多连接操作：${conn.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          toggleMore({ kind: "connection", id: conn.id });
                        }}
                      >
                        更多
                      </summary>
                      <div className="pl-row-action-more-menu pl-connection-more-menu">
                        <div className="pl-connection-more-entry">
                          <button
                            type="button"
                            className="pl-row-action-link pl-connection-more-action notranslate"
                            disabled={Boolean(liveQuery?.isFetching || refreshingLiveByConnection[conn.id])}
                            onClick={() => {
                              closeMore();
                              void (async () => {
                                setRefreshingLiveByConnection((current) => ({ ...current, [conn.id]: true }));
                                try {
                                  const data = await apiGet<LiveSchemasResponse>(
                                    `/api/connections/${encodeURIComponent(conn.id)}/live-schemas?refresh=1&purpose=manual`
                                  );
                                  queryClient.setQueryData(queryKeys.connectionLiveSchemas(conn.id), data);
                                } catch (err) {
                                  toast.error(
                                    err instanceof Error ? err.message : "重新拉取库内目录失败"
                                  );
                                } finally {
                                  setRefreshingLiveByConnection((current) => ({ ...current, [conn.id]: false }));
                                }
                              })();
                            }}
                            data-testid={`refresh-live-catalog-${conn.id}`}
                            title="向数据库查询当前可见的 Schema 和表数量。"
                            translate="no"
                          >
                            {liveQuery?.isFetching || refreshingLiveByConnection[conn.id]
                              ? "拉取库内目录..."
                              : "重新拉取库内目录"}
                          </button>
                          <p className="pl-connection-more-hint">
                            向数据库查询当前可见的 <span className="notranslate" translate="no">Schema</span> 和表数量。
                          </p>
                        </div>
                        <div className="pl-connection-more-entry">
                          <CatalogReloadButton
                            connectionId={conn.id}
                            label="刷新本地目录"
                            pendingLabel="刷新中..."
                            variant="menu"
                            testId={`catalog-reload-${conn.id}`}
                            title="重新读取本机 YAML，不连接数据库。"
                            showCompletionLabel={false}
                            showInlineResult={false}
                            onReloadStart={() => {
                              closeMore();
                              handleReloadStart(conn.id);
                            }}
                            onReloadComplete={(run) => handleReloadComplete(conn.id, run)}
                            onReloadError={(reloadButtonError) => handleReloadError(conn.id, reloadButtonError)}
                          />
                          <p className="pl-connection-more-hint">
                            重新读取本机 <span className="notranslate" translate="no">YAML</span>，不连接数据库。
                          </p>
                        </div>
                        <div className="pl-connection-more-separator" role="separator" />
                        {/* Spec 149 §10 — 运维问数连接不可删除：入口不可用。 */}
                        <button
                          type="button"
                          className="pl-row-action-link pl-row-action-link--danger pl-connection-more-action notranslate"
                          onClick={() => {
                            closeMore();
                            setDeleteTarget(conn);
                          }}
                          data-testid={`delete-connection-${conn.id}`}
                          translate="no"
                          disabled={conn.id === OPS_EVIDENCE_CONNECTION_ID}
                          aria-disabled={conn.id === OPS_EVIDENCE_CONNECTION_ID}
                        >
                          删除连接
                        </button>
                      </div>
                    </details>
                  </div>
                  <dl className="pl-connection-kv-grid pl-connection-kv-grid--compact" data-testid={`connection-kv-${conn.id}`}>
                    <div className="pl-connection-kv">
                      <dt className="notranslate" translate="no">
                        <Server className="pl-connection-kv-icon" aria-hidden="true" strokeWidth={1.8} />
                        <span>Host：</span>
                      </dt>
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
                      <dt className="notranslate" translate="no">
                        <Database className="pl-connection-kv-icon" aria-hidden="true" strokeWidth={1.8} />
                        <span>Database：</span>
                      </dt>
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
                  {discoveryState && (discoveryState.status === "paused" || discoveryState.status === "error") ? (
                    <p
                      className="pl-notice pl-connection-discovery-notice text-sm"
                      role="status"
                      data-testid={`connection-discovery-notice-${conn.id}`}
                    >
                      <span className="notranslate" translate="no">
                        {discoveryState.status === "paused" ? "持续感知已暂停：" : "持续感知失败："}
                      </span>
                      <span className="notranslate" translate="no">
                        {discoveryReasonLabel(discoveryState.lastReason) || "原因未知"}
                      </span>
                    </p>
                  ) : null}
                  {showRefreshWarning ? (
                    <div
                      className="pl-connection-refresh-warning notranslate"
                      data-testid={`connection-refresh-warning-${conn.id}`}
                      role="status"
                      translate="no"
                    >
                      <p className="pl-connection-refresh-warning-text">
                        <span>本地目录未刷新：</span>
                        <span>首次接入或修改本地 YAML 后，可刷新以读取最新资产。</span>
                      </p>
                      <CatalogReloadButton
                        connectionId={conn.id}
                        label="刷新本地目录"
                        pendingLabel="刷新中..."
                        title="首次接入或修改本地 YAML 后，点击刷新本地目录让页面读取最新资产；不会连接数据库，也不会执行 ingest。"
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
                        <col className="pl-schema-asset-col-live-count" />
                        <col className="pl-schema-asset-col-live-tables" />
                        <col className="pl-schema-asset-col-local-count" />
                        <col className="pl-schema-asset-col-enabled-count" />
                        <col className="pl-schema-asset-col-discovery" />
                        <col className="pl-schema-asset-col-action" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="notranslate" translate="no">Schema</th>
                          <th className="notranslate" translate="no">Manifest 状态</th>
                          <th className="pl-schema-asset-table-num-head notranslate" translate="no" title="物理库中当前账号可见的 BASE TABLE 数量">
                            库内表数
                          </th>
                          <th className="pl-schema-asset-table-num-head notranslate" translate="no" title="该 Schema 在库内的表清单，可展开查看表名与列数">
                            库内表清单
                          </th>
                          <th className="pl-schema-asset-table-num-head notranslate" translate="no" title="本地 Schema Manifest 中的表数量">
                            已发现表数
                          </th>
                          <th className="pl-schema-asset-table-num-head notranslate" translate="no" title="ktx.yaml enabled_tables 中该 Schema 的表数量">
                            已启用表数
                          </th>
                          <th className="pl-schema-asset-table-num-head notranslate" translate="no" title="持续感知状态与表清单差异计数">
                            持续感知
                          </th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {schemaRows.map(({ schema, assetState, enabledTableCount, liveCount }) => {
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
                            sourcesReady && assetState.tableCount === 0 && enabledTableCount > 0;
                          const sourceDriftHintId = `schema-source-drift-hint-${conn.id}-${schema}`;
                          return (
                            <Fragment key={schema}>
                              <tr
                                data-tone={sourcesReady ? assetState.tone : "muted"}
                                data-testid={`schema-row-${conn.id}-${schema}`}
                              >
                                <td><code className="notranslate" translate="no" dir="ltr">{schema}</code></td>
                                <td>
                                  <span
                                    className={`pl-schema-asset-status pl-schema-asset-status--${sourcesReady ? assetState.tone : "muted"} notranslate`}
                                    data-testid={`schema-asset-status-${conn.id}-${schema}`}
                                    translate="no"
                                  >
                                    {sourcesReady ? assetState.label : "—"}
                                  </span>
                                </td>
                                <td className="pl-schema-asset-table-num">
                                  <span
                                    className="pl-schema-asset-live-count notranslate"
                                    data-state={liveCount.state}
                                    data-testid={`schema-live-count-${conn.id}-${schema}`}
                                    title={liveCount.title}
                                    translate="no"
                                  >
                                    {liveCount.text}
                                  </span>
                                </td>
                                <LiveTableListCell
                                  connectionId={conn.id}
                                  schema={schema}
                                  tableDiff={tableDiffState}
                                />
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
                                    {sourcesReady ? `${assetState.tableCount} 张表` : "—"}
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
                                <DiscoveryStateCell
                                  connectionId={conn.id}
                                  schema={schema}
                                  discovery={discoveryState}
                                  tableDiff={tableDiffState}
                                />
                                <td className="pl-schema-asset-table-action">
                                  {/* Spec 174 §4.1: Manifest-dependent actions wait for real sources facts. */}
                                  {!sourcesActionsReady ? <span className="pl-notice pl-schema-asset-actions-pending" aria-hidden="true" data-testid={`schema-actions-pending-${conn.id}-${schema}`}>—</span> : (
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
                                        <Link
                                          className="pl-row-action-link"
                                          to={`/connections/enabled-tables?connection=${encodeURIComponent(conn.id)}&schema=${encodeURIComponent(schema)}`}
                                          data-testid={`schema-whitelist-${conn.id}-${schema}`}
                                        >
                                          维护启用表范围
                                        </Link>
                                      </>
                                    ) : canReadDatabaseStructure(conn) ? (
                                      <button
                                        type="button"
                                        className="pl-row-action-link notranslate"
                                        translate="no"
                                        onClick={() => setStructureTarget({ connection: conn, schema })}
                                        data-testid={`read-structure-${conn.id}-${schema}`}
                                      >
                                        从数据库读取表结构
                                      </button>
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
                                    <details
                                      className="pl-row-action-more"
                                      open={openMore?.kind === "schema" && openMore.key === rowManifestKey}
                                      data-schema-more={rowManifestKey}
                                      data-testid={`schema-more-${conn.id}-${schema}`}
                                      onMouseEnter={() => {
                                        if (openMore?.kind === "schema" && openMore.key === rowManifestKey) cancelSchemaMoreClose();
                                      }}
                                      onMouseLeave={() => {
                                        if (openMore?.kind === "schema" && openMore.key === rowManifestKey) scheduleSchemaMoreClose(rowManifestKey);
                                      }}
                                      onToggle={(event) => {
                                        const nextOpen = event.currentTarget.open;
                                        const mine: OpenMore = { kind: "schema", key: rowManifestKey };
                                        setOpenMore((current) => {
                                          if (nextOpen) return mine;
                                          return sameOpenMore(current, mine) ? null : current;
                                        });
                                      }}
                                      onBlur={(event) => {
                                        const next = event.relatedTarget;
                                        if (next instanceof Node && event.currentTarget.contains(next)) return;
                                        if (!(openMore?.kind === "schema" && openMore.key === rowManifestKey)) return;
                                        closeMore();
                                      }}
                                    >
                                      <summary
                                        className="pl-row-action-link notranslate"
                                        translate="no"
                                        aria-label={`更多 Schema 操作：${schema}`}
                                        onClick={(event) => {
                                          event.preventDefault();
                                          toggleMore({ kind: "schema", key: rowManifestKey });
                                        }}
                                      >
                                        更多
                                      </summary>
                                      <div className="pl-row-action-more-menu">
                                        {hasReadableManifest ? (
                                          <>
                                            <button
                                              type="button"
                                              className="pl-row-action-link notranslate"
                                              translate="no"
                                              disabled={downloadingManifestKey === rowManifestKey}
                                              onClick={() => {
                                                closeMore();
                                                void downloadManifest(conn.id, schema);
                                              }}
                                              data-testid={`download-manifest-${conn.id}-${schema}`}
                                            >
                                              {downloadingManifestKey === rowManifestKey ? "下载中..." : "下载 Manifest"}
                                            </button>
                                            <button
                                              type="button"
                                              className="pl-row-action-link notranslate"
                                              translate="no"
                                              onClick={async () => {
                                                closeMore();
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
                                              重新上传 Manifest
                                            </button>
                                          </>
                                        ) : canReadDatabaseStructure(conn) ? (
                                          <CatalogAssetUploadButton
                                            connectionId={conn.id}
                                            schema={schema}
                                            label="上传 Manifest"
                                            variant="link"
                                            size="sm"
                                            testId={`upload-yaml-${conn.id}-${schema}`}
                                            renderDrawer={false}
                                            onOpen={() => openCreateUploadDrawer(conn.id, schema)}
                                          />
                                        ) : null}
                                        <button
                                          type="button"
                                          className="pl-row-action-link pl-row-action-link--danger notranslate"
                                          translate="no"
                                          onClick={() => {
                                            closeMore();
                                            setRemoveTarget({ connection: conn, schema });
                                          }}
                                          data-testid={`remove-schema-${conn.id}-${schema}`}
                                        >
                                          移除 Schema
                                        </button>
                                      </div>
                                    </details>
                                  </div>
                                  )}
                                </td>
                              </tr>
                              {warning && expanded ? (
                                <tr
                                  className="pl-schema-warning-subrow notranslate"
                                  data-testid={`catalog-reload-warning-${conn.id}-${schema}`}
                                  translate="no"
                                >
                                  <td colSpan={6}>
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
                                            <dd>同步配置变更只读取本地 YAML，不会连接数据库。</dd>
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
                </div>
              </div>
            );
          })}
      </div>
      </AsyncRegion>

      <Suspense fallback={null}>
      {createOpen ? (
        <CreateConnectionDrawer
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          existingIds={connections.map((conn) => conn.id)}
        />
      ) : null}
      {structureTarget ? (
        <PrepareSchemaStructureDrawer
          connection={structureTarget.connection}
          schema={structureTarget.schema}
          open
          onClose={() => setStructureTarget(null)}
        />
      ) : null}
      {addTarget && (
        <AddSchemaDrawer
          connection={addTarget}
          open={Boolean(addTarget)}
          onClose={() => setAddTarget(null)}
        />
      )}
      {removeTarget && (
        <RemoveSchemaDrawer
          connection={removeTarget.connection}
          schema={removeTarget.schema}
          open={Boolean(removeTarget)}
          onClose={() => setRemoveTarget(null)}
        />
      )}
      {deleteTarget ? (
        <DeleteConnectionDrawer
          connection={deleteTarget}
          open={Boolean(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
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
          mode={manifestUploadTarget.mode}
          {...(manifestUploadTarget.initialContent !== undefined
            ? { initialContent: manifestUploadTarget.initialContent }
            : {})}
          {...(manifestUploadTarget.initialFilename !== undefined
            ? { initialFilename: manifestUploadTarget.initialFilename }
            : {})}
        />
      ) : null}
      {(() => {
        const drawerConn = testDrawerConnId
          ? connections.find((c) => c.id === testDrawerConnId)
          : undefined;
        if (!drawerConn || !testDrawerConnId) return null;
        const healthQuery = healthByConnectionId.get(testDrawerConnId);
        return (
          <ConnectionTestDrawer
            connection={drawerConn}
            open
            result={connectionHealthDrawerResult(
              testDrawerConnId,
              healthQuery?.data,
              Boolean(healthQuery?.isError),
              healthQuery?.error
            )}
            isPending={Boolean(healthQuery?.isFetching)}
            logsExpanded={testLogsExpanded}
            onClose={() => setTestDrawerConnId(null)}
            onRunTest={() => {
              manualProbeIds.current.add(testDrawerConnId);
              void healthQuery?.refetch();
            }}
            onToggleLogs={() => setTestLogsExpanded((v) => !v)}
          />
        );
      })()}
      {assistantOpen ? (
        <SetupAssistantModal
          open={assistantOpen}
          onClose={() => {
            setAssistantOpen(false);
            void queryClient.invalidateQueries({ queryKey: queryKeys.project });
            void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
          }}
          initialStep={assistantStep}
          initialConnectionId={assistantConnId}
          initialConnection={connections.find((connection) => connection.id === assistantConnId) ?? null}
          initialSources={sourcesQuery.data ?? null}
          existingIds={connections.map((c) => c.id)}
        />
      ) : null}
      </Suspense>
    </div>
  );
}
