import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, apiPut } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type {
  CompletionStatus,
  ConnectionInfo,
  ConnectionTablesResponse,
  SourceSummary,
  SourcesResponse
} from "../../lib/types";
import { DiffViewer } from "../../components/DiffViewer";
import { CatalogReloadButton } from "../../components/catalog";
import { PageHeader } from "../../components/PageHeader";

type WhitelistTableRow = {
  connectionId: string;
  schema: string;
  table: string;
  qualifiedName: string;
  enabledPersisted: boolean;
  enabledDraft: boolean;
  columnCount?: number;
  hasTableDesc?: boolean;
  completion?: CompletionStatus;
};

type WhitelistStatus = "included" | "pending" | "semantic_pending" | "disabled";

type EnabledTablesPreview = {
  diff: string;
  proposedYaml: string;
  oldEnabledTables: string[];
  newEnabledTables: string[];
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
};

const STATUS_LABELS: Record<WhitelistStatus, string> = {
  included: "已纳入",
  pending: "待同步",
  semantic_pending: "已启用，待补语义",
  disabled: "未启用"
};

const STATUS_CLASS: Record<WhitelistStatus, string> = {
  included: "pl-status-badge pl-status-badge--included",
  pending: "pl-status-badge pl-status-badge--pending",
  semantic_pending: "pl-status-badge pl-status-badge--semantic-pending",
  disabled: "pl-status-badge pl-status-badge--disabled"
};

function parseQualifiedName(name: string): { schema: string; table: string } {
  const idx = name.indexOf(".");
  if (idx === -1) return { schema: "", table: name };
  return { schema: name.slice(0, idx), table: name.slice(idx + 1) };
}

function whitelistStatus(row: WhitelistTableRow): WhitelistStatus {
  if (row.enabledDraft !== row.enabledPersisted) return "pending";
  if (row.enabledPersisted && row.completion === "done") return "included";
  if (row.enabledPersisted) return "semantic_pending";
  return "disabled";
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
  const [search, setSearch] = useState("");
  const [schemaFilter, setSchemaFilter] = useState("all");
  const [draftByConnection, setDraftByConnection] = useState<Record<string, string[]>>({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<"success" | "danger" | null>(null);

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
          columnCount: source?.columnCount,
          hasTableDesc: source?.hasTableDesc,
          completion: source?.completion
        };
      });
      return { conn, rows };
    });
  }, [connections, tablesQueries, sourceByKey, draftByConnection]);

  const allSchemas = useMemo(() => {
    const set = new Set<string>();
    for (const { conn, rows } of connectionRows) {
      for (const schema of conn.schemas) if (schema) set.add(schema);
      for (const r of rows) if (r.schema) set.add(r.schema);
    }
    return Array.from(set).sort();
  }, [connectionRows]);

  // Apply search + schema filter for visible groups
  const visibleGroups = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return connectionRows.flatMap(({ conn, rows }) => {
      const rowsBySchema = new Map<string, WhitelistTableRow[]>();
      for (const row of rows) {
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
  }, [connectionRows, search, schemaFilter]);

  const configuredSchemasWithoutTables = useMemo(() => {
    if (search.trim()) return [];
    return connectionRows.flatMap(({ conn, rows }) => {
      const scannedSchemas = new Set(rows.map((row) => row.schema).filter(Boolean));
      return conn.schemas
        .filter((schema) => schema && (schemaFilter === "all" || schemaFilter === schema))
        .filter((schema) => !scannedSchemas.has(schema))
        .map((schema) => ({ conn, schema }));
    });
  }, [connectionRows, search, schemaFilter]);

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
    onSuccess: (results) => {
      const allWritten = results.every((r) => r.write.written);
      if (allWritten) {
        toast.success("表白名单已保存");
        setStatusMessage("表白名单已保存。需要刷新本地表清单时，可点击右上角“刷新本地表目录”。");
        setStatusTone("success");
      } else {
        toast.error("表白名单保存未完成，请重试。");
        setStatusMessage("表白名单保存未完成");
        setStatusTone("danger");
      }
      // Sync drafts to the just-persisted state for the changed connections
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
    },
    onError: (err) => {
      toast.error(`保存失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  // M14: pick a catalog reload target for the toolbar button.
  // - single connection + specific schema → connection/schema scope
  // - single connection + "all"           → connection scope
  // - multiple connections                → global scope, with optional schema filter
  const toolbarReloadConnId = connections.length === 1 ? connections[0]?.id : undefined;
  const toolbarReloadSchema = schemaFilter !== "all" ? schemaFilter : undefined;

  if (connectionsQuery.isLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="表白名单"
        breadcrumbs={["数据库接入", "表白名单"]}
        description={
          <>
            维护进入语义层的表范围，保存后写入 <code>ktx.yaml</code> 的 <code>enabled_tables</code> 字段。
          </>
        }
        badges={
          connections.length > 0 ? (
            <>
              <span>{connections.length} 个连接</span>
              <span>已勾选 {visibleChecked} / {visibleTotal} 张表</span>
            </>
          ) : null
        }
      />

      <section className="pl-panel">
        {connections.length === 0 && (
          <p className="text-sm text-fg-muted">暂无连接配置。</p>
        )}

        {connections.length > 0 && (
          <div className="pl-whitelist-toolbar" role="toolbar" aria-label="表白名单工具栏">
          <label className="grid gap-1.5 text-sm">
            <span>搜索</span>
            <input
              className="pl-input"
              placeholder="搜索表名/描述..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            <span>Schema 筛选</span>
            <select
              className="pl-input"
              value={schemaFilter}
              onChange={(e) => setSchemaFilter(e.target.value)}
              aria-label="Schema 筛选"
            >
              <option value="all">全部 Schema</option>
              {allSchemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-fg-muted">已勾选</span>
            <strong>已勾选 {visibleChecked} / {visibleTotal} 张表</strong>
          </div>
          <div className="flex flex-wrap items-end gap-2 ml-auto">
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={selectAllVisible}
              disabled={visibleTotal === 0}
            >
              全选当前结果
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={invertVisible}
              disabled={visibleTotal === 0}
            >
              反选当前结果
            </button>
            <CatalogReloadButton
              connectionId={toolbarReloadConnId}
              schema={toolbarReloadSchema}
              label="刷新本地表目录"
              variant="secondary"
              testId="whitelist-reload-catalog"
            />
          </div>
        </div>
      )}

      {visibleGroups.map(({ conn, schema, rows }) => (
        <section key={`${conn.id}-${schema}`} className="pl-table-group mt-4">
          <div className="pl-table-group-heading">
            Connection: {conn.id} · Schema: {schema}
          </div>
          <table className="pl-data-table">
            <thead>
              <tr>
                <th>选择</th>
                <th>表名 (Table)</th>
                <th>字段数</th>
                <th>状态</th>
                <th>动作</th>
              </tr>
            </thead>
            <tbody>
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
                      <span className="font-medium">{row.table}</span>
                    </td>
                    <td>
                      {row.columnCount !== undefined ? `${row.columnCount} 个` : "-"}
                    </td>
                    <td>
                      <span className={STATUS_CLASS[status]}>{STATUS_LABELS[status]}</span>
                    </td>
                    <td>
                      {status === "included" || status === "semantic_pending" ? (
                        <Link
                          className="pl-btn pl-btn--ghost text-xs"
                          to={`/sources/${encodeURIComponent(row.connectionId)}/${encodeURIComponent(row.schema)}/${encodeURIComponent(row.table)}`}
                        >
                          查看语义
                        </Link>
                      ) : status === "disabled" ? (
                        <button
                          type="button"
                          className="pl-btn pl-btn--ghost text-xs"
                          onClick={() => toggleRow(row)}
                        >
                          加入白名单
                        </button>
                      ) : status === "pending" ? (
                        <span className="text-xs text-fg-muted">待保存</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {configuredSchemasWithoutTables.map(({ conn, schema }) => (
        <section
          key={`${conn.id}-${schema}-configured-empty`}
          className="pl-table-group mt-4"
          data-testid={`configured-schema-empty-${conn.id}-${schema}`}
        >
          <div className="pl-table-group-heading">
            Connection: {conn.id} · Schema: {schema}
          </div>
          <div className="pl-empty-state">
            <strong>{schema} 已在连接配置中启用，但本地 semantic-layer 尚未提供表清单。</strong>
            <p className="mt-1">
              请将 manifest 文件放入 <code>semantic-layer/{conn.id}/_schema/{schema}.yaml</code>，
              或在具备 KTX/数据库权限的离线环境中生成后提交。
              白名单只读取本地 YAML 资产，不会访问物理数据库。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <CatalogReloadButton
                connectionId={conn.id}
                schema={schema}
                label="刷新本地表目录"
                variant="primary"
                size="sm"
                testId={`whitelist-empty-reload-catalog-${conn.id}-${schema}`}
              />
              <Link
                to="/connections"
                className="pl-btn pl-btn--ghost"
                data-testid={`whitelist-empty-back-to-overview-${conn.id}-${schema}`}
              >
                打开连接概览
              </Link>
            </div>
          </div>
        </section>
      ))}

      {connections.length > 0 && visibleGroups.length === 0 && configuredSchemasWithoutTables.length === 0 && (
        <div className="pl-empty-state mt-4">
          当前筛选条件下没有可加入白名单的表。
        </div>
      )}
      </section>

      {statusMessage && (
        <div
          className={`pl-validation-banner ${
            statusTone === "danger"
              ? "pl-validation-banner--danger"
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
          className="pl-floating-action-bar"
          role="region"
          aria-label="白名单变更操作"
          data-testid="whitelist-floating-bar"
        >
          <div className="pl-floating-action-bar-text">
            变更未保存（新增 {diffStats.added} 张表 / 移除 {diffStats.removed} 张表）
            {saveMutation.isPending && (
              <span className="block text-xs font-normal text-fg-muted">
                正在写入 ktx.yaml（共 {changedConnections.length} 个连接）
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="pl-btn pl-btn--ghost" onClick={resetDraft}>
              重置
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
                <p className="pl-notice">
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
                  <h3 className="text-sm font-semibold">Connection: {connId}</h3>
                  <p className="text-sm">
                    enabled_tables: {preview.oldEnabledTables.length} -&gt;{" "}
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
                  <DiffViewer diff={preview.diff} />
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
