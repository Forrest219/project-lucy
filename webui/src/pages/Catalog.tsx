import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CatalogScopeTree,
  type CatalogScopeConnectionNode
} from "../components/CatalogScopeTree";
import { SelectField } from "../components/SelectField";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { AsyncRegion, asyncStatus } from "../components/AsyncRegion";
import { RowMoreMenu } from "../components/RowMoreMenu";
import {
  CatalogBatchPanel,
  type CatalogBatchMode
} from "../components/semantic-assets/CatalogBatchPanel";
import {
  CATALOG_SEARCH_COMMIT_MS,
  createCatalogVisitId,
  recordCatalogNavigationEvent,
  type CatalogNavigationContextLevel,
  type CatalogNavigationEventType
} from "../lib/catalogNavigationUsage";
import type { CompletionStatus, SourceSummary, SemanticBatchStaging } from "../lib/types";
import { sourcesQueryOptions, useDisplayFactsPending } from "../lib/displayQueryOptions";
import { apiPost } from "../lib/apiClient";
import { toast } from "sonner";

/** A disabled fact-dependent link has no href, including for keyboard/new-tab activation. */
function CatalogFactLink({ factsReady, ...props }: Pick<ComponentProps<typeof Link>, "to" | "children" | "className" | "onClick" | "title" | "aria-label" | "translate"> & { factsReady: boolean; "data-testid"?: string }) {
  if (factsReady) return <Link {...props} />;
  return <span role="link" aria-disabled="true" className={props.className} title={props.title} aria-label={props["aria-label"]} translate={props.translate} data-testid={props["data-testid"]}>{props.children}</span>;
}

const STATUS_LABELS: Record<CompletionStatus, string> = {
  not_started: "未开始",
  partial: "部分完成",
  done: "已完成",
  validation_failed: "校验失败"
};

type StatusFilter = CompletionStatus | "all" | "incomplete";
type ScopeFilter = "enabled" | "all" | "disabled";

function parseStatusParam(raw: string | null): StatusFilter {
  if (!raw || raw === "all") return "all";
  if (raw === "incomplete") return "incomplete";
  if (raw in STATUS_LABELS) return raw as CompletionStatus;
  return "all";
}

function parseScopeParam(raw: string | null): ScopeFilter {
  if (raw === "all" || raw === "disabled") return raw;
  return "enabled";
}

function matchesStatusFilter(completion: CompletionStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "incomplete") return completion !== "done";
  return completion === filter;
}

function matchesScopeFilter(enabled: boolean, filter: ScopeFilter): boolean {
  if (filter === "all") return true;
  if (filter === "enabled") return enabled;
  return !enabled;
}

function matchesCatalogSearch(table: SourceSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (!needle) return true;
  return `${table.conn}/${table.schema}/${table.table} ${table.columnNames.join(" ")}`
    .toLowerCase()
    .includes(needle);
}

function structureLabel(table: SourceSummary): string {
  return `字段 ${table.columnCount} / 关联 ${table.joinCount} / 指标 ${table.measureCount}`;
}

function agentReferenceLabel(count: number): string {
  return `${count} 个`;
}

function groupLabel(conn: string, schema: string, count: number): string {
  return `连接：${conn} · Schema：${schema}（共 ${count} 张表）`;
}

function slRefWikiHref(table: SourceSummary): string {
  const slRef = `${table.conn}/${table.schema}/${table.table}`;
  return `/wiki?sl_ref=${encodeURIComponent(slRef)}`;
}

function enabledTablesHref(table: SourceSummary): string {
  return `/connections/enabled-tables?connection=${encodeURIComponent(table.conn)}&schema=${encodeURIComponent(table.schema)}`;
}

/**
 * Lucy v0.25 / L25-11 §4.1 — the FULL table identity.
 *
 * The selection key is the whole triple, never a bare table name: two
 * connections (or two schemas) can carry the same table name, and a selection
 * keyed by the name alone would silently merge them.
 */
function catalogIdentityKey(table: SourceSummary): string {
  return `${table.conn}/${table.schema}/${table.table}`;
}

/**
 * Format an ISO timestamp as `YYYY-MM-DD HH:mm` in the local time zone.
 * Returns the raw string if the value cannot be parsed; the catalog surfaces
 * this column for at-a-glance triage so it must never throw.
 */
function formatSemanticUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function semanticUpdatedTooltip(table: SourceSummary): string {
  const source = table.semanticUpdatedAtSource === "overlay" ? "语义 overlay" : "Schema Manifest";
  return `取该表 Schema Manifest 与语义 overlay 文件的较晚修改时间。来源：${source}`;
}

function catalogEmptyMessage(input: {
  total: number;
  scope: ScopeFilter;
  enabledCount: number;
  factsReady: boolean;
  onEnabledScopeExit: () => void;
}): { title: string; detail: ReactNode } {
  if (input.total === 0) {
    return {
      title: "尚未加载到语义资产",
      detail: "请刷新本地 Catalog，或检查 semantic-layer YAML 是否已经存在。"
    };
  }
  if (input.scope === "enabled" && input.enabledCount === 0) {
    return {
      title: "当前没有已启用的语义资产",
      detail: (
        <>
          默认只展示已进入语义层的表。请先在{" "}
          <CatalogFactLink
            factsReady={input.factsReady}
            to="/connections/enabled-tables"
            className="pl-inline-link"
            onClick={input.onEnabledScopeExit}
          >
            启用表范围
          </CatalogFactLink>{" "}
          勾选表，或将启用范围切换为「全部」查看{" "}
          <span className="notranslate" translate="no">
            Manifest
          </span>{" "}
          库存。
        </>
      )
    };
  }
  return {
    title: "没有匹配的语义资产",
    detail: "清空搜索或筛选条件后重试；如刚修改 YAML，可刷新本地 Catalog。"
  };
}

export function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  // Spec 100 §7.1: URL is the single source of truth so deep links / Back work while mounted.
  // Spec 104: default scope is enabled (omit or scope=enabled).
  const connection = searchParams.get("connection") ?? "all";
  const schema = searchParams.get("schema") ?? "all";
  const scope = parseScopeParam(searchParams.get("scope"));
  const status = parseStatusParam(searchParams.get("completion"));
  const search = searchParams.get("q") ?? "";
  const [visitId] = useState(createCatalogVisitId);
  const visitStartedRef = useRef(false);
  const outcomeRecordedRef = useRef(false);
  const lastCommittedSearchRef = useRef(search);

  // ── Lucy v0.25 / L25-11 §3.1: the batch selection ───────────────────────
  //
  // The selection holds FULL table identities. Changing the search, the
  // connection, the schema, the enable scope or the semantic status clears
  // it: an invisible implicit selection would let the operator act on tables
  // they can no longer see.
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState<CatalogBatchMode | null>(null);
  const selectionRef = useRef<string[]>([]);
  selectionRef.current = selectedKeys;
  const importInputRef = useRef<HTMLInputElement | null>(null);

  function clearSelection(reason: string): void {
    if (selectionRef.current.length === 0) return;
    setSelectedKeys([]);
    toast.message(`筛选条件已变化，已清空选择（${reason}）。`, { id: "catalog-selection-cleared" });
  }

  /**
   * ★ Lucy v0.25 / L25-11 §3.1: 「导入语义资产包」 is always available.
   *
   * The import scope comes from the PACKAGE CONTENT — it is never silently
   * narrowed by the page filters. The package is staged (controlled staging
   * only) and the operator is sent to the publish workbench with the batch
   * id, where the complete plan is confirmed.
   */
  function importMaintenancePackage(): void {
    importInputRef.current?.click();
  }

  async function handleImportFile(files: FileList | null): Promise<void> {
    const file = files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      const response = await apiPost<SemanticBatchStaging>("/api/semantic-assets/validate", {
        packages: [{ filename: file.name, contentBase64: btoa(binary) }]
      });
      if (response.noChange) {
        toast.message("导入预检结果：无变化。未创建发布，也未同步其他待处理变更。", {
          id: "catalog-import"
        });
        return;
      }
      toast.success(`已暂存 ${response.files.length} 张表，请在发布工作台确认完整计划。`, {
        id: "catalog-import"
      });
      navigate(`/publish/workbench?validationId=${encodeURIComponent(response.validationId)}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "导入预检失败");
    }
  }

  function patchSearchParams(patch: {
    connection?: string;
    schema?: string;
    scope?: ScopeFilter;
    completion?: StatusFilter;
    q?: string;
  }) {
    const next = new URLSearchParams(searchParams);
    const apply = (key: string, value: string | undefined, clearWhen: string) => {
      if (value === undefined) return;
      if (!value || value === clearWhen) next.delete(key);
      else next.set(key, value);
    };
    apply("connection", patch.connection, "all");
    apply("schema", patch.schema, "all");
    // Default scope is enabled: omit from URL when enabled to keep deep links clean.
    apply("scope", patch.scope, "enabled");
    apply("completion", patch.completion, "all");
    apply("q", patch.q !== undefined ? patch.q.trim() : undefined, "");
    if (next.toString() !== searchParams.toString()) {
      // ★ L25-11 §3.1: any filter change clears the selection. The operator
      // must never act on a selection whose objects are no longer visible.
      clearSelection("筛选条件变化");
      setSearchParams(next, { replace: true });
    }
  }

  const sourcesQuery = useQuery({
    ...sourcesQueryOptions()
  });
  const { data } = sourcesQuery;
  const sourcesStatus = asyncStatus(sourcesQuery);
  const factsPending = useDisplayFactsPending("sources");
  // A successful API read may clear pending before React Query installs its data.
  // Keep actions locked until the displayed query has finished applying that read.
  const factsReady = !factsPending && !sourcesQuery.isFetching && !sourcesQuery.isError;
  const agentCountsKnown = !data?.meta || data.meta.authorizedCountsState === "ok";

  const tables = data?.tables ?? [];
  const enabledCount = useMemo(() => tables.filter((table) => table.enabled).length, [tables]);
  const scopeOptions = useMemo(
    () => [
      { value: "enabled", label: "已启用" },
      { value: "all", label: "全部" },
      { value: "disabled", label: "未启用" }
    ],
    []
  );
  const statusOptions = useMemo(
    () => [
      { value: "all", label: "全部状态" },
      { value: "incomplete", label: "未完成" },
      ...(Object.entries(STATUS_LABELS) as [CompletionStatus, string][]).map(([value, label]) => ({ value, label }))
    ],
    []
  );

  function recordEvent(eventType: CatalogNavigationEventType, contextLevel?: CatalogNavigationContextLevel) {
    recordCatalogNavigationEvent({ visitId, eventType, contextLevel });
  }

  function currentContextLevel(): CatalogNavigationContextLevel {
    if (connection === "all") return "root";
    if (schema === "all") return "connection";
    return "schema";
  }

  function recordOutcome(eventType: "row_open" | "enabled_scope_exit") {
    if (outcomeRecordedRef.current) return;
    outcomeRecordedRef.current = true;
    recordEvent(eventType, currentContextLevel());
  }

  useEffect(() => {
    if (!data || visitStartedRef.current) return;
    visitStartedRef.current = true;
    recordCatalogNavigationEvent({ visitId, eventType: "visit_start" });
  }, [data, visitId]);

  useEffect(() => {
    if (!data || search === lastCommittedSearchRef.current) return;
    const handle = window.setTimeout(() => {
      lastCommittedSearchRef.current = search;
      recordCatalogNavigationEvent({ visitId, eventType: "search_commit" });
    }, CATALOG_SEARCH_COMMIT_MS);
    return () => window.clearTimeout(handle);
  }, [data, search, visitId]);

  const baseFiltered = useMemo(
    () => tables.filter((table) =>
      matchesScopeFilter(table.enabled, scope) &&
      matchesStatusFilter(table.completion, status) &&
      matchesCatalogSearch(table, search)
    ),
    [scope, search, status, tables]
  );

  const treeConnections = useMemo<CatalogScopeConnectionNode[]>(() => {
    const nodes = new Map<string, CatalogScopeConnectionNode>();
    for (const table of tables) {
      let connectionNode = nodes.get(table.conn);
      if (!connectionNode) {
        connectionNode = { name: table.conn, count: 0, schemas: [] };
        nodes.set(table.conn, connectionNode);
      }
      if (!connectionNode.schemas.some((candidate) => candidate.name === table.schema)) {
        connectionNode.schemas.push({ name: table.schema, count: 0 });
      }
    }
    for (const table of baseFiltered) {
      const connectionNode = nodes.get(table.conn);
      if (!connectionNode) continue;
      connectionNode.count += 1;
      const schemaNode = connectionNode.schemas.find((candidate) => candidate.name === table.schema);
      if (schemaNode) schemaNode.count += 1;
    }
    return Array.from(nodes.values());
  }, [baseFiltered, tables]);

  useEffect(() => {
    if (!data) return;
    const connectionNode = treeConnections.find((candidate) => candidate.name === connection);
    if (connection !== "all" && !connectionNode) {
      patchSearchParams({ connection: "all", schema: "all" });
      return;
    }
    if (
      schema !== "all" &&
      (connection === "all" || !connectionNode?.schemas.some((candidate) => candidate.name === schema))
    ) {
      patchSearchParams({ schema: "all" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- normalize only after the source tree changes
  }, [connection, data, schema, treeConnections]);

  const filtered = useMemo(() => {
    return baseFiltered.filter((table) => {
      if (connection !== "all" && table.conn !== connection) {
        return false;
      }
      if (schema !== "all" && table.schema !== schema) {
        return false;
      }
      return true;
    });
  }, [baseFiltered, connection, schema]);

  const groupedTables = useMemo(() => {
    const groups = new Map<string, { conn: string; schema: string; rows: SourceSummary[] }>();
    for (const table of filtered) {
      const key = `${table.conn}/${table.schema}`;
      const group = groups.get(key);
      if (group) {
        group.rows.push(table);
      } else {
        groups.set(key, { conn: table.conn, schema: table.schema, rows: [table] });
      }
    }
    return Array.from(groups.values());
  }, [filtered]);

  // ── Lucy v0.25 / L25-11 §3.1: the selection helpers ─────────────────────
  const filteredKeys = useMemo(() => filtered.map(catalogIdentityKey), [filtered]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedTables = useMemo(
    () => tables.filter((table) => selectedSet.has(catalogIdentityKey(table))),
    [selectedSet, tables]
  );
  const allFilteredSelected = filteredKeys.length > 0 && filteredKeys.every((key) => selectedSet.has(key));
  const someFilteredSelected = filteredKeys.some((key) => selectedSet.has(key));

  function toggleTableSelection(table: SourceSummary): void {
    const key = catalogIdentityKey(table);
    setSelectedKeys((previous) =>
      previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key]
    );
  }

  function toggleSelectAllFiltered(): void {
    // "选择全部筛选结果" covers the COMPLETE filter result, not the visible
    // page — and it is the server that resolves it into a scope afterwards.
    if (allFilteredSelected) {
      setSelectedKeys((previous) => previous.filter((key) => !filteredKeys.includes(key)));
      return;
    }
    setSelectedKeys((previous) => Array.from(new Set([...previous, ...filteredKeys])));
  }

  function selectRoot() {
    if (connection === "all" && schema === "all") return;
    recordEvent("tree_select", "root");
    patchSearchParams({ connection: "all", schema: "all" });
  }

  function selectConnection(nextConnection: string) {
    if (connection === nextConnection && schema === "all") return;
    recordEvent("tree_select", "connection");
    patchSearchParams({ connection: nextConnection, schema: "all" });
  }

  function selectSchema(nextConnection: string, nextSchema: string) {
    if (connection === nextConnection && schema === nextSchema) return;
    recordEvent("tree_select", "schema");
    patchSearchParams({ connection: nextConnection, schema: nextSchema });
  }

  const empty = catalogEmptyMessage({
    total: tables.length,
    scope,
    enabledCount,
    factsReady,
    onEnabledScopeExit: () => recordOutcome("enabled_scope_exit")
  });

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="语义资产"
        description="管理表、字段、指标、分群与关联等结构化语义资产。"
      />

      <section className="pl-catalog-workspace">
        <aside className="pl-catalog-scope-panel">
          {/* The table region owns the error + retry; the tree keeps a quiet placeholder. */}
          <AsyncRegion status={sourcesStatus === "error" ? "pending" : sourcesStatus} label="范围树" minHeight={240}>
            <CatalogScopeTree
              activeConnection={connection}
              activeSchema={schema}
              connections={treeConnections}
              onSelectConnection={selectConnection}
              onSelectRoot={selectRoot}
              onSelectSchema={selectSchema}
              onToggleConnection={() => recordEvent("tree_toggle", "connection")}
              totalCount={baseFiltered.length}
            />
          </AsyncRegion>
        </aside>

        <div className="pl-panel pl-catalog-main">
          <div className="pl-whitelist-toolbar" role="toolbar" aria-label="语义资产工具栏">
          <div className="pl-whitelist-filter-area">
            <label className="grid gap-1.5 text-sm pl-whitelist-search">
              <span>搜索</span>
              <input
                className="pl-input pl-whitelist-search-input notranslate"
                translate="no"
                value={search}
                onChange={(event) => patchSearchParams({ q: event.target.value })}
                placeholder="搜索表名或字段名..."
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>启用范围</span>
              <SelectField
                className="pl-catalog-filter-select"
                ariaLabel="启用范围"
                value={scope}
                onValueChange={(value) => {
                  const nextScope = value as ScopeFilter;
                  if (nextScope !== scope) recordEvent("scope_change");
                  patchSearchParams({ scope: nextScope });
                }}
                options={scopeOptions}
                placeholder="已启用"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>语义状态</span>
              <SelectField
                className="pl-catalog-filter-select"
                ariaLabel="语义状态"
                value={status}
                onValueChange={(value) => {
                  const nextStatus = value as StatusFilter;
                  if (nextStatus !== status) recordEvent("completion_change");
                  patchSearchParams({ completion: nextStatus });
                }}
                options={statusOptions}
                placeholder="全部状态"
              />
            </label>
          </div>
          <div className="pl-whitelist-toolbar-actions">
            {data ? (
              <span className="pl-catalog-result-count" data-testid="catalog-result-count">
                {filtered.length} 条结果
              </span>
            ) : null}
          </div>
        </div>

        {/* ★ Lucy v0.25 / L25-11 §3.1: the batch action bar. The two actions
            that need a selection are disabled (with a readable reason) when
            nothing is selected; "导入语义资产包" is always available. */}
        <div className="pl-catalog-batch-bar" data-testid="catalog-batch-bar">
          <span className="pl-catalog-batch-count" data-testid="catalog-selected-count">
            已选择 {selectedKeys.length} 张表
          </span>
          <button
            className="pl-btn pl-btn--ghost pl-btn--sm"
            onClick={toggleSelectAllFiltered}
            disabled={!factsReady || filteredKeys.length === 0}
            title={
              allFilteredSelected
                ? "取消选择当前筛选结果"
                : "选择全部筛选结果（由服务端解析为范围快照）"
            }
            data-testid="catalog-select-all-filtered"
          >
            {allFilteredSelected ? "取消全选" : "选择全部筛选结果"}
          </button>
          <button
            className="pl-btn pl-btn--secondary pl-btn--sm"
            onClick={() => setBatchMode("download")}
            disabled={!factsReady || selectedKeys.length === 0}
            title={selectedKeys.length === 0 ? "请先选择至少一张表" : "下载语义维护包"}
            data-testid="catalog-batch-download"
          >
            批量下载
          </button>
          <button
            className="pl-btn pl-btn--secondary pl-btn--sm"
            onClick={() => setBatchMode("check")}
            disabled={!factsReady || selectedKeys.length === 0}
            title={selectedKeys.length === 0 ? "请先选择至少一张表" : "批量校验所选表"}
            data-testid="catalog-batch-check"
          >
            批量校验
          </button>
          <button
            className="pl-btn pl-btn--ghost pl-btn--sm"
            onClick={() => {
              void importMaintenancePackage();
            }}
            disabled={!factsReady}
            title="导入语义资产包（导入范围由包内容解析并单独预览）"
            data-testid="catalog-import-package"
          >
            导入语义资产包
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            hidden
            onChange={(event) => {
              void handleImportFile(event.target.files);
              event.target.value = "";
            }}
            data-testid="catalog-import-package-input"
          />
        </div>

        {data?.meta?.runtimeConsistency === "unconfirmed" ? (
          <div className="pl-notice mt-4" role="status" data-testid="catalog-runtime-unconfirmed">
            权限生效状态待确认
          </div>
        ) : null}

        {!data ? (
          <AsyncRegion
            status={sourcesStatus}
            label="语义资产"
            error={sourcesQuery.error}
            onRetry={() => void sourcesQuery.refetch()}
            minHeight={480}
            className="mt-4"
          />
        ) : filtered.length === 0 ? (
          <div className="pl-catalog-empty mt-4" data-testid="catalog-empty-state">
            <strong>{empty.title}</strong>
            <p>{empty.detail}</p>
          </div>
        ) : (
        <div className="pl-catalog-table-wrap mt-4" data-testid="catalog-table">
          <table className="pl-data-grid pl-catalog-table">
            <thead>
              <tr>
                <th scope="col" className="pl-catalog-table-select-col">
                  <span className="sr-only">选择</span>
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = !allFilteredSelected && someFilteredSelected;
                    }}
                    onChange={toggleSelectAllFiltered}
                    disabled={!factsReady || filteredKeys.length === 0}
                    aria-label="选择全部筛选结果"
                    data-testid="catalog-select-all"
                  />
                </th>
                <th scope="col">表名</th>
                <th scope="col">语义状态</th>
                <th scope="col">结构</th>
                <th scope="col"><span className="notranslate" translate="no">Agent 引用</span></th>
                <th scope="col">语义更新时间</th>
                <th scope="col" className="pl-catalog-table-actions-col">操作</th>
              </tr>
            </thead>
            {groupedTables.map(({ conn, schema: schemaName, rows }) => (
              <tbody key={`${conn}/${schemaName}`}>
                <tr className="pl-table-group-row">
                  <td colSpan={7}>
                    <span className="notranslate" translate="no">
                      {groupLabel(conn, schemaName, rows.length)}
                    </span>
                  </td>
                </tr>
                {rows.map((table) => {
                const editorHref = `/catalog/${encodeURIComponent(table.conn)}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.table)}`;
                const wikiHref = slRefWikiHref(table);
                const fullRef = `${table.conn}/${table.schema}/${table.table}`;
                const moreLabel = `更多操作：${fullRef}`;
                const rowKey = catalogIdentityKey(table);
                return (
                  <tr key={rowKey} data-testid={`catalog-row-${table.table}`}>
                    <td className="pl-catalog-table-select-col">
                      <input
                        type="checkbox"
                        checked={selectedSet.has(rowKey)}
                        onChange={() => toggleTableSelection(table)}
                        aria-label={`选择 ${fullRef}`}
                        data-testid={`catalog-row-select-${table.table}`}
                      />
                    </td>
                    <td className="pl-catalog-table-name">
                      <div className="pl-catalog-table-name-cell">
                        <CatalogFactLink
                          factsReady={factsReady}
                          to={table.enabled ? editorHref : enabledTablesHref(table)}
                          className="pl-catalog-table-name-link notranslate"
                          translate="no"
                          data-testid={`catalog-row-edit-${table.table}`}
                          onClick={() => recordOutcome(table.enabled ? "row_open" : "enabled_scope_exit")}
                          title={fullRef}
                        >
                          {table.table}
                        </CatalogFactLink>
                        {!table.enabled ? (
                          <span className="pl-status-badge pl-status-partial" data-testid={`catalog-row-not-enabled-${table.table}`}>
                            未启用，不对{" "}
                            <span className="notranslate" translate="no">
                              Agent
                            </span>{" "}
                            开放
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td><StatusBadge status={table.completion} /></td>
                    <td className="pl-catalog-table-structure notranslate" translate="no">{structureLabel(table)}</td>
                    <td className="pl-catalog-table-agents" data-testid={`catalog-row-agents-${table.table}`}>
                      {agentCountsKnown ? agentReferenceLabel(table.authorizedAgentCount) : <span className="notranslate" translate="no" title="Agent 引用数暂无法确认">—</span>}
                    </td>
                    <td className="pl-catalog-table-updated notranslate" translate="no" title={semanticUpdatedTooltip(table)}>
                      {formatSemanticUpdatedAt(table.semanticUpdatedAt)}
                    </td>
                    <td className="pl-catalog-table-actions">
                      <div className="pl-catalog-table-actions-inner">
                        {table.enabled ? (
                          <CatalogFactLink
                            factsReady={factsReady}
                            aria-label={`维护 ${table.schema}.${table.table} 语义`}
                            className="pl-inline-link text-xs notranslate"
                            translate="no"
                            to={editorHref}
                            data-testid={`catalog-row-maintain-${table.table}`}
                            onClick={() => recordOutcome("row_open")}
                          >
                            维护语义 ↗
                          </CatalogFactLink>
                        ) : (
                          <CatalogFactLink
                            factsReady={factsReady}
                            aria-label={`去启用表范围：${table.schema}.${table.table}`}
                            className="pl-inline-link text-xs notranslate"
                            translate="no"
                            to={enabledTablesHref(table)}
                            data-testid={`catalog-row-enable-scope-${table.table}`}
                            onClick={() => recordOutcome("enabled_scope_exit")}
                          >
                            去启用表范围 ↗
                          </CatalogFactLink>
                        )}
                        {table.wikiRefCount > 0 ? (
                          <RowMoreMenu
                            disabled={!factsReady}
                            ariaLabel={moreLabel}
                            items={[
                              { kind: "link", label: "查看关联的 业务 Wiki", href: wikiHref, testId: `catalog-row-wiki-${table.table}` }
                            ]}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              </tbody>
            ))}
          </table>
        </div>
          )}
        </div>
      </section>

      {batchMode ? (
        <CatalogBatchPanel
          open
          mode={batchMode}
          selection={selectedTables.map((table) => ({
            connectionId: table.conn,
            schema: table.schema,
            table: table.table
          }))}
          onClose={() => setBatchMode(null)}
        />
      ) : null}
    </div>
  );
}
