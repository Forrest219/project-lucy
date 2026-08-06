import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CompletionStatus,
  ConnectionInfo,
  ConnectionTablesResponse,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";

type WhitelistTableRow = {
  connectionId: string;
  schema: string;
  table: string;
  qualifiedName: string;
  enabledPersisted: boolean;
  enabledDraft: boolean;
  /** Spec 116: in enabled_tables (or draft) but absent from local Manifest scan. */
  invalidEnabled: boolean;
  columnCount?: number;
  hasTableDesc?: boolean;
  completion?: CompletionStatus;
};

type WhitelistStatus =
  | "enabled_complete"
  | "enabled_semantic_pending"
  | "disabled"
  | "draft_enable"
  | "draft_disable"
  | "invalid_enabled"
  | "orphan_pending_remove";

type EnabledTableWarning = {
  code: "ENABLED_TABLE_NOT_SCANNED";
  table: string;
  message: string;
};

type EnabledTablesPreview = {
  diff: string;
  proposedYaml: string;
  oldEnabledTables: string[];
  newEnabledTables: string[];
  warnings?: EnabledTableWarning[];
};

type EnabledTablesPreviewByConnection = {
  connId: string;
  preview: EnabledTablesPreview;
};

type EnabledTablesWrite = {
  written: true;
  auditId?: number;
  oldEnabledTables: string[];
  newEnabledTables: string[];
  warnings?: EnabledTableWarning[];
};

const STATUS_LABELS: Record<WhitelistStatus, string> = {
  enabled_complete: "已启用，语义完成",
  enabled_semantic_pending: "已启用，待补语义",
  disabled: "未启用",
  draft_enable: "待启用",
  draft_disable: "待禁用",
  invalid_enabled: "无效启用",
  orphan_pending_remove: "待移出"
};

const STATUS_CLASS: Record<WhitelistStatus, string> = {
  enabled_complete: "pl-status-badge pl-status-badge--included",
  enabled_semantic_pending: "pl-status-badge pl-status-badge--semantic-pending",
  disabled: "pl-status-badge pl-status-badge--disabled",
  draft_enable: "pl-status-badge pl-status-badge--pending",
  draft_disable: "pl-status-badge pl-status-badge--pending",
  invalid_enabled: "pl-status-badge pl-status-badge--semantic-pending",
  orphan_pending_remove: "pl-status-badge pl-status-badge--pending"
};

function parseQualifiedName(name: string): { schema: string; table: string } {
  const idx = name.indexOf(".");
  if (idx === -1) return { schema: "", table: name };
  return { schema: name.slice(0, idx), table: name.slice(idx + 1) };
}

function whitelistStatus(row: WhitelistTableRow): WhitelistStatus {
  if (row.invalidEnabled) {
    if (row.enabledDraft !== row.enabledPersisted) {
      return row.enabledDraft ? "draft_enable" : "orphan_pending_remove";
    }
    return row.enabledDraft ? "invalid_enabled" : "disabled";
  }
  if (row.enabledDraft !== row.enabledPersisted) {
    return row.enabledDraft ? "draft_enable" : "draft_disable";
  }
  if (!row.enabledDraft) return "disabled";
  if (row.completion === "done") return "enabled_complete";
  return "enabled_semantic_pending";
}

function setDifference<T>(a: Iterable<T>, b: Iterable<T>): T[] {
  const bs = new Set(b);
  const out: T[] = [];
  for (const x of a) if (!bs.has(x)) out.push(x);
  return out;
}

function isEqualSet<T>(a: Iterable<T>, b: Iterable<T>): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

export function TableWhitelist() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialConnectionParam = searchParams.get("connection") ?? null;
  const initialSchemaParam = searchParams.get("schema") ?? null;
  const [connectionFilter, setConnectionFilter] = useState<string>(
    initialConnectionParam && initialConnectionParam.length > 0 ? initialConnectionParam : "all"
  );
  const [schemaFilter, setSchemaFilter] = useState<string>(
    initialSchemaParam && initialSchemaParam.length > 0 ? initialSchemaParam : "all"
  );
  const [userOverrodeConnection, setUserOverrodeConnection] = useState<boolean>(false);
  const [userOverrodeSchema, setUserOverrodeSchema] = useState<boolean>(false);
  const [search, setSearch] = useState("");
  const [draftByConnection, setDraftByConnection] = useState<Record<string, string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "warning" | "danger" | null>(null);
  const [openDetails, setOpenDetails] = useState<Record<string, boolean>>({});

  const connectionsQuery = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiGet<{ connections: ConnectionInfo[] }>("/api/connections")
  });
  const connections = connectionsQuery.data?.connections ?? [];

  const sourcesQuery = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const tablesQueries = useQueries({
    queries: connections.map((c) => ({
      queryKey: queryKeys.connectionTables(c.id),
      queryFn: () =>
        apiGet<ConnectionTablesResponse>(`/api/connections/${encodeURIComponent(c.id)}/tables`),
      enabled: true
    }))
  });

  // Build semantic lookup keyed by conn.schema.table
  const sourceByKey = useMemo(() => {
    const map = new Map<string, SourceSummary>();
    for (const s of sourcesQuery.data?.tables ?? []) {
      map.set(`${s.conn}.${s.schema}.${s.table}`, s);
    }
    return map;
  }, [sourcesQuery.data]);

  // Build all connection rows (before filters)
  const connectionRows = useMemo(() => {
    return connections.map((conn, idx) => {
      const tablesData = tablesQueries[idx]?.data;
      const tables = tablesData?.tables ?? [];
      const scannedSet = new Set(tables);
      const persisted = conn.enabledTables;
      const draft = draftByConnection[conn.id] ?? persisted;
      const persistedSet = new Set(persisted);
      const draftSet = new Set(draft);
      const rows: WhitelistTableRow[] = tables.map((qualifiedName) => {
        const { schema, table } = parseQualifiedName(qualifiedName);
        const key = `${conn.id}.${schema}.${table}`;
        const source = sourceByKey.get(key);
        return {
          connectionId: conn.id,
          schema,
          table,
          qualifiedName,
          enabledPersisted: persistedSet.has(qualifiedName),
          enabledDraft: draftSet.has(qualifiedName),
          invalidEnabled: false,
          columnCount: source?.columnCount,
          hasTableDesc: source?.hasTableDesc,
          completion: source?.completion
        };
      });
      // Spec 116: surface invalid enabled (enabled but not in local Manifest).
      const invalidCandidates = new Set<string>();
      for (const name of persisted) if (!scannedSet.has(name)) invalidCandidates.add(name);
      for (const name of draft) if (!scannedSet.has(name)) invalidCandidates.add(name);
      for (const qualifiedName of Array.from(invalidCandidates).sort()) {
        const { schema, table } = parseQualifiedName(qualifiedName);
        rows.push({
          connectionId: conn.id,
          schema,
          table,
          qualifiedName,
          enabledPersisted: persistedSet.has(qualifiedName),
          enabledDraft: draftSet.has(qualifiedName),
          invalidEnabled: true
        });
      }
      return { conn, rows };
    });
  }, [connections, tablesQueries, sourceByKey, draftByConnection]);

  const allConnectionIds = useMemo(() => connections.map((conn) => conn.id).sort(), [connections]);

  // M46: connection is a first-class filter because Schema names can repeat
  // across physical connections.
  useEffect(() => {
    if (userOverrodeConnection) return;
    if (!initialConnectionParam) return;
    if (allConnectionIds.includes(initialConnectionParam)) {
      setConnectionFilter(initialConnectionParam);
    } else if (allConnectionIds.length > 0) {
      setConnectionFilter("all");
    }
  }, [allConnectionIds, initialConnectionParam, userOverrodeConnection]);

  const connectionFilteredRows = useMemo(() => {
    if (connectionFilter === "all") return connectionRows;
    return connectionRows.filter(({ conn }) => conn.id === connectionFilter);
  }, [connectionRows, connectionFilter]);

  const allSchemas = useMemo(() => {
    const set = new Set<string>();
    for (const { conn, rows } of connectionFilteredRows) {
      for (const schema of conn.schemas) if (schema) set.add(schema);
      for (const r of rows) if (r.schema) set.add(r.schema);
    }
    return Array.from(set).sort();
  }, [connectionFilteredRows]);

  // M17: re-honor the ?schema= query param when the user lands on the page.
  // Do not override a later manual selection. Falls back to "all" if the
  // schema is unknown.
  useEffect(() => {
    if (userOverrodeSchema) return;
    if (!initialSchemaParam) return;
    if (allSchemas.includes(initialSchemaParam)) {
      setSchemaFilter(initialSchemaParam);
    } else {
      setSchemaFilter("all");
    }
  }, [allSchemas, initialSchemaParam, userOverrodeSchema]);

  useEffect(() => {
    if (schemaFilter === "all") return;
    if (allSchemas.length === 0) return;
    if (!allSchemas.includes(schemaFilter)) setSchemaFilter("all");
  }, [allSchemas, schemaFilter]);

  // Apply search + schema filter for visible groups (scanned tables only)
  const visibleGroups = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return connectionFilteredRows.flatMap(({ conn, rows }) => {
      const rowsBySchema = new Map<string, WhitelistTableRow[]>();
      for (const row of rows) {
        if (row.invalidEnabled) continue;
        if (schemaFilter !== "all" && row.schema !== schemaFilter) continue;
        if (lowerSearch) {
          const matched =
            row.table.toLowerCase().includes(lowerSearch) ||
            row.qualifiedName.toLowerCase().includes(lowerSearch);
          if (!matched) continue;
        }
        const schemaKey = row.schema || "default";
        const existing = rowsBySchema.get(schemaKey) ?? [];
        existing.push(row);
        rowsBySchema.set(schemaKey, existing);
      }
      return Array.from(rowsBySchema.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([schema, groupedRows]) => ({ conn, schema, rows: groupedRows }));
    });
  }, [connectionFilteredRows, search, schemaFilter]);

  // Spec 116: invalid enabled rows shown when filter is all or matches their schema.
  const visibleInvalidGroups = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return connectionFilteredRows.flatMap(({ conn, rows }) => {
      const invalidRows = rows.filter((row) => {
        if (!row.invalidEnabled) return false;
        if (schemaFilter !== "all" && row.schema !== schemaFilter) return false;
        if (lowerSearch) {
          const matched =
            row.table.toLowerCase().includes(lowerSearch) ||
            row.qualifiedName.toLowerCase().includes(lowerSearch);
          if (!matched) return false;
        }
        return true;
      });
      if (invalidRows.length === 0) return [];
      return [{ conn, rows: invalidRows }];
    });
  }, [connectionFilteredRows, search, schemaFilter]);

  const hiddenInvalidEnabledCount = useMemo(() => {
    if (schemaFilter === "all") return 0;
    let count = 0;
    for (const { rows } of connectionFilteredRows) {
      for (const row of rows) {
        if (row.invalidEnabled && row.enabledDraft && row.schema !== schemaFilter) {
          count += 1;
        }
      }
    }
    return count;
  }, [connectionFilteredRows, schemaFilter]);

  const draftInvalidEnabledCount = useMemo(() => {
    let count = 0;
    for (const { rows } of connectionFilteredRows) {
      for (const row of rows) {
        if (row.invalidEnabled && row.enabledDraft) count += 1;
      }
    }
    return count;
  }, [connectionFilteredRows]);

  const configuredSchemasWithoutTables = useMemo(() => {
    if (search.trim()) return [];
    return connectionFilteredRows.flatMap(({ conn, rows }) => {
      const scannedSchemas = new Set(
        rows.filter((row) => !row.invalidEnabled).map((row) => row.schema).filter(Boolean)
      );
      return conn.schemas
        .filter((schema) => schema && (schemaFilter === "all" || schemaFilter === schema))
        .filter((schema) => !scannedSchemas.has(schema))
        .map((schema) => ({ conn, schema }));
    });
  }, [connectionFilteredRows, search, schemaFilter]);

  const showFocusedMissingManifest =
    schemaFilter !== "all" && configuredSchemasWithoutTables.length === 1;

  const visibleTotal = visibleGroups.reduce((sum, g) => sum + g.rows.length, 0);
  const visibleChecked = visibleGroups.reduce(
    (sum, g) => sum + g.rows.filter((r) => r.enabledDraft).length,
    0
  );

  // Dirty check + diff stats
  const diffStats = useMemo(() => {
    let added = 0;
    let removed = 0;
    for (const { conn } of connectionRows) {
      const draft = new Set(draftByConnection[conn.id] ?? conn.enabledTables);
      const persisted = new Set(conn.enabledTables);
      added += setDifference(draft, persisted).length;
      removed += setDifference(persisted, draft).length;
    }
    return { added, removed, isDirty: added + removed > 0 };
  }, [connectionRows, draftByConnection]);
  const changedTableCount = diffStats.added + diffStats.removed;

  const changedConnections = useMemo(() => {
    return connectionRows.filter(({ conn }) => {
      const draft = draftByConnection[conn.id] ?? conn.enabledTables;
      return !isEqualSet(draft, conn.enabledTables);
    });
  }, [connectionRows, draftByConnection]);

  function setDraftForConnection(connId: string, newDraft: string[]) {
    setDraftByConnection((prev) => ({ ...prev, [connId]: newDraft }));
  }

  function toggleRow(row: WhitelistTableRow) {
    const conn = connections.find((c) => c.id === row.connectionId);
    if (!conn) return;
    const current = new Set(draftByConnection[conn.id] ?? conn.enabledTables);
    if (current.has(row.qualifiedName)) current.delete(row.qualifiedName);
    else current.add(row.qualifiedName);
    setDraftForConnection(conn.id, Array.from(current));
    setPreviewOpen(false);
  }

  function selectAllVisible() {
    setPreviewOpen(false);
    setDraftByConnection((prev) => {
      const next = { ...prev };
      for (const { conn, rows } of visibleGroups) {
        const current = new Set(next[conn.id] ?? conn.enabledTables);
        for (const r of rows) current.add(r.qualifiedName);
        next[conn.id] = Array.from(current);
      }
      return next;
    });
  }

  function invertVisible() {
    setPreviewOpen(false);
    setDraftByConnection((prev) => {
      const next = { ...prev };
      for (const { conn, rows } of visibleGroups) {
        const current = new Set(next[conn.id] ?? conn.enabledTables);
        for (const r of rows) {
          if (current.has(r.qualifiedName)) current.delete(r.qualifiedName);
          else current.add(r.qualifiedName);
        }
        next[conn.id] = Array.from(current);
      }
      return next;
    });
  }

  function resetDraft() {
    setDraftByConnection({});
    setPreviewOpen(false);
    setStatusMessage(null);
    setStatusTone(null);
  }

  /** Spec 116: drop all invalid-enabled entries from draft for filtered connections. */
  function removeInvalidEnabled() {
    setPreviewOpen(false);
    setDraftByConnection((prev) => {
      const next = { ...prev };
      for (const { conn, rows } of connectionFilteredRows) {
        const current = new Set(next[conn.id] ?? conn.enabledTables);
        for (const row of rows) {
          if (row.invalidEnabled) current.delete(row.qualifiedName);
        }
        next[conn.id] = Array.from(current);
      }
      return next;
    });
  }

  /**
   * Action-column cell renderer. The action column must never mix in-page
   * state toggles with cross-module navigation; enable / disable is owned
   * exclusively by the row checkbox. Draft states always render 待保存.
   */
  function renderActionCell(status: WhitelistStatus, row: WhitelistTableRow) {
    if (status === "draft_enable" || status === "draft_disable" || status === "orphan_pending_remove") {
      return (
        <span
          className="text-xs text-fg-muted notranslate"
          translate="no"
          data-testid="whitelist-action-draft"
        >
          待保存
        </span>
      );
    }
    if (status === "invalid_enabled") {
      return (
        <span
          className="text-xs text-fg-muted notranslate"
          translate="no"
          data-testid="whitelist-action-invalid-enabled"
        >
          本地无 Manifest
        </span>
      );
    }
    const target = `/catalog/${encodeURIComponent(row.connectionId)}/${encodeURIComponent(row.schema)}/${encodeURIComponent(row.table)}`;
    const label =
      status === "enabled_complete"
        ? "查看语义 ↗"
        : status === "enabled_semantic_pending"
          ? "编辑语义 ↗"
          : "查看字段 ↗";
    const testId =
      status === "enabled_complete"
        ? "whitelist-action-view"
        : status === "enabled_semantic_pending"
          ? "whitelist-action-edit"
          : "whitelist-action-fields";
    return (
      <Link
        className="pl-inline-link text-xs notranslate"
        to={target}
        data-testid={testId}
        translate="no"
      >
        {label}
      </Link>
    );
  }

  function toggleDetails(key: string) {
    setOpenDetails((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function copyManifestPath(schemaManifestPath: string) {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(schemaManifestPath);
      toast.success("已复制 Manifest 路径");
    } catch (err) {
      void err;
      toast.error("复制路径失败");
    }
  }

  function updateSaveProgress(_connId: string, _phase: never, _detail?: string) {
    // Removed in M14. Saving the whitelist only writes enabled_tables; catalog
    // reload is an explicit toolbar action.
    void _connId;
    void _phase;
  }

  const previewMutation = useMutation({
    mutationFn: async () => {
      const results: EnabledTablesPreviewByConnection[] = [];
      for (const { conn } of changedConnections) {
        const draft = draftByConnection[conn.id] ?? conn.enabledTables;
        const preview = await apiPut<EnabledTablesPreview>(
          `/api/connections/${encodeURIComponent(conn.id)}/enabled-tables`,
          { dryRun: true, enabledTables: draft }
        );
        results.push({ connId: conn.id, preview });
      }
      return results;
    },
    onSuccess: () => setPreviewOpen(true),
    onError: (err) =>
      toast.error(`预览失败：${err instanceof Error ? err.message : "未知错误"}`)
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const results: Array<{ connId: string; write: EnabledTablesWrite }> = [];
      for (const { conn } of changedConnections) {
        const draft = draftByConnection[conn.id] ?? conn.enabledTables;
        const write = await apiPut<EnabledTablesWrite>(
          `/api/connections/${encodeURIComponent(conn.id)}/enabled-tables`,
          { dryRun: false, enabledTables: draft }
        );
        results.push({ connId: conn.id, write });
      }
      return results;
    },
    onSuccess: async (results) => {
      const allWritten = results.every((r) => r.write.written);
      if (!allWritten) {
        toast.error("启用表范围保存未完成，请重试。");
        setStatusMessage("启用表范围保存未完成");
        setStatusTone("danger");
        return;
      }

      // Sync drafts to the just-persisted state for the changed connections.
      setDraftByConnection((prev) => {
        const next = { ...prev };
        for (const r of results) delete next[r.connId];
        return next;
      });
      setPreviewOpen(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
      for (const r of results) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(r.connId) });
      }

      // M45: auto-reload local catalog after save so the user never sees a
      // stale "保存不会自动刷新本地目录" warning with no follow-up.
      const warningCount = results.reduce(
        (sum, r) => sum + (r.write.warnings?.length ?? 0),
        0
      );
      if (warningCount > 0) {
        toast.success(
          `启用表范围已保存；仍有 ${warningCount} 张无效启用，可在本页移出。`
        );
        setStatusMessage(
          `启用表范围已保存；仍有 ${warningCount} 张无效启用（本地无 Manifest），可使用「移出无效启用」清理。`
        );
        setStatusTone("warning");
      } else {
        toast.success("启用表范围已保存");
        setStatusMessage("启用表范围已保存，正在刷新本地目录...");
        setStatusTone("success");
      }
      const reloadErrors: string[] = [];
      for (const { connId } of results) {
        try {
          await apiPost<{ tables: number; enabledTables: number; warnings: unknown[] }>(
            "/api/catalog/reload",
            { connectionId: connId }
          );
        } catch (err) {
          reloadErrors.push(
            `${connId}: ${err instanceof Error ? err.message : "未知错误"}`
          );
        }
      }
      if (reloadErrors.length === 0) {
        if (warningCount === 0) {
          setStatusMessage("启用表范围已保存，本地目录已刷新。");
          setStatusTone("success");
        }
      } else {
        setStatusMessage(
          `启用表范围已保存；本地目录刷新失败，请重试。${reloadErrors.join(" / ")}`
        );
        setStatusTone("danger");
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.sources });
    },
    onError: (err) => {
      toast.error(`保存失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  if (connectionsQuery.isLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  return (
    <div
      className={`pl-page-stack${diffStats.isDirty ? " pl-page-stack--safe-bottom" : ""}`}
    >
      <PageHeader
        title="启用表范围"
        description={
          <>
            维护进入语义层的表范围，保存后写入 <code>ktx.yaml</code> 的 <code>enabled_tables</code> 字段。
          </>
        }
      />

      <section className="pl-panel">
        {connections.length === 0 && (
          <p className="text-sm text-fg-muted">暂无连接配置。</p>
        )}

        {connections.length > 0 && (
          <div className="pl-whitelist-toolbar" role="toolbar" aria-label="启用表范围工具栏">
            <div className="pl-whitelist-filter-area" data-testid="pl-whitelist-filter-area">
              <label className="grid gap-1.5 text-sm pl-whitelist-search">
                <span>搜索</span>
                <input
                  className="pl-input pl-whitelist-search-input"
                  placeholder="搜索表名/描述..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="notranslate" translate="no">连接筛选</span>
                <select
                  className="pl-input notranslate"
                  value={connectionFilter}
                  onChange={(e) => {
                    setUserOverrodeConnection(true);
                    setConnectionFilter(e.target.value);
                  }}
                  aria-label="连接筛选"
                  translate="no"
                >
                  <option className="notranslate" value="all" translate="no">全部连接</option>
                  {allConnectionIds.map((connId) => (
                    <option className="notranslate" key={connId} value={connId} translate="no">
                      {connId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="notranslate" translate="no">Schema 筛选</span>
                <select
                  className="pl-input notranslate"
                  value={schemaFilter}
                  onChange={(e) => {
                    setUserOverrodeSchema(true);
                    setSchemaFilter(e.target.value);
                  }}
                  aria-label="Schema 筛选"
                  translate="no"
                >
                  <option className="notranslate" value="all" translate="no">全部 Schema</option>
                  {allSchemas.map((s) => (
                    <option className="notranslate" key={s} value={s} translate="no">
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="pl-whitelist-toolbar-actions" data-testid="pl-whitelist-toolbar-actions">
              <span
                className="pl-whitelist-selection-summary"
                aria-live="polite"
                data-testid="pl-whitelist-selection-summary"
              >
                已选 {visibleChecked}/{visibleTotal} 张表
              </span>
              {draftInvalidEnabledCount > 0 ? (
                <button
                  type="button"
                  className="pl-btn pl-btn--secondary"
                  onClick={removeInvalidEnabled}
                  data-testid="whitelist-remove-invalid-enabled"
                  translate="no"
                >
                  移出无效启用
                </button>
              ) : null}
              {visibleTotal > 0 ? (
                <div className="pl-whitelist-batch-actions" data-testid="whitelist-batch-actions">
                  <button
                    type="button"
                    className="pl-btn pl-btn--secondary"
                    onClick={selectAllVisible}
                    data-testid="whitelist-select-all"
                    translate="no"
                  >
                    全选
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--secondary"
                    onClick={invertVisible}
                    data-testid="whitelist-invert"
                    translate="no"
                  >
                    反选
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

      {hiddenInvalidEnabledCount > 0 ? (
        <div
          className="pl-validation-banner pl-validation-banner--warning mt-4"
          role="status"
          data-testid="whitelist-hidden-invalid-enabled-banner"
        >
          <span className="notranslate" translate="no">
            本连接另有 {hiddenInvalidEnabledCount} 张无效启用（本地无 Manifest），当前 Schema 筛选下未显示。
          </span>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-btn--sm"
            onClick={() => {
              setUserOverrodeSchema(true);
              setSchemaFilter("all");
            }}
            data-testid="whitelist-show-invalid-enabled"
          >
            查看全部
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--ghost pl-btn--sm"
            onClick={removeInvalidEnabled}
            data-testid="whitelist-remove-invalid-enabled-from-banner"
          >
            移出无效启用
          </button>
        </div>
      ) : null}

      {visibleGroups.length > 0 && (
        <div className="pl-table-wrapper mt-4">
          <table className="pl-data-grid pl-data-table" data-testid="pl-whitelist-table">
            <thead>
              <tr>
                <th>选择</th>
                <th className="notranslate" translate="no">表名 (Table)</th>
                <th>字段数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            {visibleGroups.map(({ conn, schema, rows }) => (
              <tbody
                key={`${conn.id}-${schema}`}
                data-testid={`whitelist-group-${conn.id}-${schema}`}
              >
                <tr className="pl-table-group-row">
                  <td colSpan={5}>
                    <span className="notranslate" translate="no">
                      连接：{conn.id} · Schema：{schema}
                    </span>
                    <span className="pl-table-group-row-count notranslate" translate="no">
                      （共 {rows.length} 张表）
                    </span>
                  </td>
                </tr>
                {rows.map((row) => {
                  const status = whitelistStatus(row);
                  return (
                    <tr
                      key={`${row.connectionId}-${row.qualifiedName}`}
                      data-testid={`whitelist-row-${row.qualifiedName}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={row.enabledDraft}
                          onChange={() => toggleRow(row)}
                          aria-label={`选择 ${row.table}`}
                        />
                      </td>
                      <td>
                        <span className="font-medium notranslate" translate="no">{row.table}</span>
                      </td>
                      <td>
                        {row.columnCount !== undefined ? `${row.columnCount} 个` : "-"}
                      </td>
                      <td>
                        <span className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</span>
                      </td>
                      <td>
                        {renderActionCell(status, row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {visibleInvalidGroups.length > 0 ? (
        <div className="pl-table-wrapper mt-4" data-testid="whitelist-invalid-enabled-section">
          <table className="pl-data-grid pl-data-table">
            <thead>
              <tr>
                <th>选择</th>
                <th className="notranslate" translate="no">表名 (Table)</th>
                <th>字段数</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            {visibleInvalidGroups.map(({ conn, rows }) => (
              <tbody
                key={`${conn.id}-invalid-enabled`}
                data-testid={`whitelist-invalid-group-${conn.id}`}
              >
                <tr className="pl-table-group-row">
                  <td colSpan={5}>
                    <span className="notranslate" translate="no">
                      连接：{conn.id} · 已启用 · 本地无 Manifest
                    </span>
                    <span className="pl-table-group-row-count notranslate" translate="no">
                      （共 {rows.length} 张表）
                    </span>
                  </td>
                </tr>
                {rows.map((row) => {
                  const status = whitelistStatus(row);
                  return (
                    <tr
                      key={`${row.connectionId}-invalid-${row.qualifiedName}`}
                      data-testid={`whitelist-invalid-row-${row.qualifiedName}`}
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={row.enabledDraft}
                          onChange={() => toggleRow(row)}
                          aria-label={`选择无效启用 ${row.qualifiedName}`}
                        />
                      </td>
                      <td>
                        <span className="font-medium notranslate" translate="no">
                          {row.qualifiedName}
                        </span>
                      </td>
                      <td>-</td>
                      <td>
                        <span className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</span>
                      </td>
                      <td>{renderActionCell(status, row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
      ) : null}

      {configuredSchemasWithoutTables.length > 0 && !showFocusedMissingManifest ? (
        <div
          className="pl-whitelist-missing-summary notranslate"
          translate="no"
          data-testid="whitelist-missing-manifest-summary"
        >
          <span className="notranslate" translate="no">
            {configuredSchemasWithoutTables.length} 个 Schema 缺少 Manifest，暂不可配置表范围。
          </span>
          <Link
            to="/connections"
            className="pl-card-cta notranslate"
            translate="no"
            data-testid="whitelist-missing-manifest-summary-link"
          >
            去连接概览上传 Manifest ↗
          </Link>
        </div>
      ) : null}

      {showFocusedMissingManifest && configuredSchemasWithoutTables.map(({ conn, schema }) => {
        const schemaManifestPath = `semantic-layer/${conn.id}/_schema/${schema}.yaml`;
        const detailsKey = `${conn.id}-${schema}`;
        const detailsId = `whitelist-missing-manifest-details-${conn.id}-${schema}`;
        const isDetailsOpen = openDetails[detailsKey] === true;
        return (
          <section
            key={`${conn.id}-${schema}-configured-empty`}
            className="pl-table-group mt-4"
            data-testid={`configured-schema-empty-${conn.id}-${schema}`}
          >
            <div className="pl-table-group-heading notranslate" translate="no">
              连接：{conn.id} · Schema：{schema}
            </div>
            <div
              className="pl-missing-manifest-diagnostic notranslate"
              translate="no"
            >
              <p
                className="pl-missing-manifest-title notranslate"
                translate="no"
                data-testid={`whitelist-missing-manifest-title-${conn.id}-${schema}`}
              >
                {`缺少 Manifest：${schema}`}
              </p>
              <p className="pl-missing-manifest-description notranslate" translate="no">
                {`${schema} 已在连接配置中启用，但本地 schema 文件不存在。`}
              </p>
              <p className="pl-missing-manifest-path-row">
                <span>路径：</span>
                <code
                  className="notranslate"
                  translate="no"
                  dir="ltr"
                  data-testid={`whitelist-missing-manifest-path-${conn.id}-${schema}`}
                >
                  {schemaManifestPath}
                </code>
              </p>
              {isDetailsOpen ? (
                <p
                  id={detailsId}
                  className="pl-missing-manifest-details-content notranslate"
                  translate="no"
                  data-testid={`whitelist-missing-manifest-details-${conn.id}-${schema}`}
                >
                  启用表范围只读取本地 <code className="notranslate" translate="no">YAML</code> 资产。刷新本地目录不会连接数据库，也不会生成新的 Manifest。
                </p>
              ) : null}
              <div className="pl-missing-manifest-actions">
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost pl-btn--sm"
                  aria-expanded={isDetailsOpen}
                  aria-controls={detailsId}
                  onClick={() => toggleDetails(detailsKey)}
                  data-testid={`whitelist-missing-manifest-toggle-${conn.id}-${schema}`}
                >
                  {isDetailsOpen ? "收起详情" : "展开详情"}
                </button>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost pl-btn--sm"
                  onClick={() => void copyManifestPath(schemaManifestPath)}
                  data-testid={`whitelist-missing-manifest-copy-${conn.id}-${schema}`}
                >
                  复制路径
                </button>
                <Link
                  to="/connections"
                  className="pl-card-cta notranslate"
                  translate="no"
                  data-testid={`whitelist-missing-manifest-overview-${conn.id}-${schema}`}
                >
                  去连接概览上传 Manifest ↗
                </Link>
              </div>
            </div>
          </section>
        );
      })}

      {connections.length > 0 &&
        visibleGroups.length === 0 &&
        visibleInvalidGroups.length === 0 &&
        configuredSchemasWithoutTables.length === 0 && (
        <div className="pl-empty-state mt-4">
          当前筛选条件下没有可启用的表。
        </div>
      )}
      </section>

      {statusMessage && (
        <div
          className={`pl-validation-banner ${
            statusTone === "danger"
              ? "pl-validation-banner--danger"
              : statusTone === "warning"
                ? "pl-validation-banner--warning"
              : "pl-validation-banner--success"
          }`}
          role="status"
          aria-live="polite"
          data-testid="whitelist-status-banner"
        >
          {statusMessage}
        </div>
      )}

      {diffStats.isDirty && (
        <div
          className="pl-floating-dock"
          role="region"
          aria-label="启用表范围变更操作"
          data-testid="whitelist-floating-bar"
        >
          <div className="pl-floating-dock-text notranslate" translate="no">
            已修改 {changedTableCount} 张表，尚未写入 ktx.yaml
            <span className="block text-xs font-normal text-fg-muted notranslate" translate="no">
              新增 {diffStats.added} 张表 / 移除 {diffStats.removed} 张表，保存成功后会自动刷新本地目录。
            </span>
            {saveMutation.isPending && (
              <span className="block text-xs font-normal text-fg-muted notranslate" translate="no">
                正在写入 ktx.yaml（共 {changedConnections.length} 个连接）
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pl-btn pl-btn--ghost" onClick={resetDraft}>
              放弃
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => previewMutation.mutate()}
              disabled={previewMutation.isPending || changedConnections.length === 0}
            >
              {previewMutation.isPending ? "生成中..." : "预览 YAML"}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
              data-testid="whitelist-save-changes"
            >
              {saveMutation.isPending ? "保存中..." : "保存变更"}
            </button>
          </div>
        </div>
      )}

      {previewOpen && previewMutation.data && previewMutation.data.length > 0 && (
        <div
          className="pl-drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="YAML 预览"
          data-testid="yaml-preview-drawer"
        >
          <div className="pl-drawer-panel">
            <header className="pl-drawer-header">
              <div>
                <h2 className="pl-panel-title">YAML 预览</h2>
                <p className="pl-notice notranslate" translate="no">
                  写入 ktx.yaml 前的最终检查，共 {previewMutation.data.length} 个连接。
                </p>
              </div>
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => setPreviewOpen(false)}
                aria-label="关闭 YAML 预览"
              >
                关闭
              </button>
            </header>
            <div className="pl-drawer-body">
              {previewMutation.data.map(({ connId, preview }) => (
                <section className="pl-preview-section" key={connId}>
                  <h3 className="text-sm font-semibold notranslate" translate="no">Connection: {connId}</h3>
                  <p className="text-sm notranslate" translate="no">
                    启用表范围：{preview.oldEnabledTables.length} -&gt;{" "}
                    {preview.newEnabledTables.length}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {setDifference(
                      preview.newEnabledTables,
                      preview.oldEnabledTables
                    ).map((t) => (
                      <span
                        key={`${connId}-add-${t}`}
                        className="pl-status-badge pl-status-badge--included"
                      >
                        新增：{t}
                      </span>
                    ))}
                    {setDifference(
                      preview.oldEnabledTables,
                      preview.newEnabledTables
                    ).map((t) => (
                      <span
                        key={`${connId}-del-${t}`}
                        className="pl-status-badge pl-status-badge--disabled"
                      >
                        移除：{t}
                      </span>
                    ))}
                  </div>
                  <details className="pl-preview-diff" data-testid={`preview-diff-${connId}`}>
                    <summary className="text-xs font-medium text-fg-muted cursor-pointer">
                      完整 YAML diff
                    </summary>
                    <DiffViewer diff={preview.diff} />
                  </details>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
