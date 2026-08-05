import { useEffect, useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SelectField } from "../components/SelectField";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { RowMoreMenu } from "../components/RowMoreMenu";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { CompletionStatus, SourcesResponse, SourceSummary } from "../lib/types";

const STATUS_LABELS: Record<CompletionStatus, string> = {
  not_started: "未开始",
  partial: "部分完成",
  done: "已完成",
  validation_failed: "校验失败"
};

type StatusFilter = CompletionStatus | "all" | "incomplete";

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function parseStatusParam(raw: string | null): StatusFilter {
  if (!raw || raw === "all") return "all";
  if (raw === "incomplete") return "incomplete";
  if (raw in STATUS_LABELS) return raw as CompletionStatus;
  return "all";
}

function matchesStatusFilter(completion: CompletionStatus, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "incomplete") return completion !== "done";
  return completion === filter;
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

function catalogEmptyMessage(total: number): { title: string; detail: string } {
  if (total === 0) {
    return {
      title: "尚未加载到语义资产",
      detail: "请刷新本地 Catalog，或检查 semantic-layer YAML 是否已经存在。"
    };
  }
  return {
    title: "没有匹配的语义资产",
    detail: "清空搜索或筛选条件后重试；如刚修改 YAML，可刷新本地 Catalog。"
  };
}

export function Catalog() {
  const [searchParams, setSearchParams] = useSearchParams();
  // Spec 100 §7.1: URL is the single source of truth so deep links / Back work while mounted.
  const connection = searchParams.get("connection") ?? "all";
  const schema = searchParams.get("schema") ?? "all";
  const status = parseStatusParam(searchParams.get("completion"));
  const search = searchParams.get("q") ?? "";

  function patchSearchParams(patch: {
    connection?: string;
    schema?: string;
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
    apply("completion", patch.completion, "all");
    apply("q", patch.q !== undefined ? patch.q.trim() : undefined, "");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const tables = data?.tables ?? [];
  const connections = useMemo(() => unique(tables.map((table) => table.conn)), [tables]);
  const connectionOptions = useMemo(
    () => [
      { value: "all", label: "全部连接" },
      ...connections.map((value) => ({ value, label: value }))
    ],
    [connections]
  );
  const schemas = useMemo(
    () =>
      unique(
        tables
          .filter((table) => connection === "all" || table.conn === connection)
          .map((table) => table.schema)
      ),
    [connection, tables]
  );
  const schemaOptions = useMemo(
    () => [{ value: "all", label: "全部 Schema" }, ...schemas.map((value) => ({ value, label: value }))],
    [schemas]
  );
  const statusOptions = useMemo(
    () => [
      { value: "all", label: "全部状态" },
      { value: "incomplete", label: "未完成" },
      ...(Object.entries(STATUS_LABELS) as [CompletionStatus, string][]).map(([value, label]) => ({ value, label }))
    ],
    []
  );

  useEffect(() => {
    if (schema !== "all" && !schemas.includes(schema)) {
      patchSearchParams({ schema: "all" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reset invalid schema when options change
  }, [schema, schemas]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tables.filter((table) => {
      if (connection !== "all" && table.conn !== connection) {
        return false;
      }
      if (schema !== "all" && table.schema !== schema) {
        return false;
      }
      if (!matchesStatusFilter(table.completion, status)) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${table.conn}/${table.schema}/${table.table} ${table.columnNames.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [connection, schema, search, status, tables]);

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

  if (isLoading) {
    return <p className="pl-notice">正在加载语义资产...</p>;
  }

  if (error) {
    return <p className="pl-error">语义资产加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="语义资产"
        description={<span className="notranslate" translate="no">维护当前 KTX 项目的结构化 semantic-layer YAML 模型，按搜索、连接、Schema 和语义状态定位对象。</span>}
      />

      <section className="pl-panel">
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
              <span className="notranslate" translate="no">连接筛选</span>
              <SelectField
                className="notranslate pl-catalog-filter-select"
                translate="no"
                ariaLabel="连接筛选"
                value={connection}
                onValueChange={(value) => patchSearchParams({ connection: value, schema: "all" })}
                options={connectionOptions}
                placeholder="全部连接"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="notranslate" translate="no">Schema 筛选</span>
              <SelectField
                className="notranslate pl-catalog-filter-select"
                translate="no"
                ariaLabel="Schema 筛选"
                value={schema}
                onValueChange={(value) => patchSearchParams({ schema: value })}
                options={schemaOptions}
                placeholder="全部 Schema"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>语义状态</span>
              <SelectField
                className="pl-catalog-filter-select"
                ariaLabel="语义状态"
                value={status}
                onValueChange={(v) => patchSearchParams({ completion: v as StatusFilter })}
                options={statusOptions}
                placeholder="全部状态"
              />
            </label>
          </div>
          <div className="pl-whitelist-toolbar-actions">
            <span className="pl-catalog-result-count" data-testid="catalog-result-count">
              {filtered.length} 条结果
            </span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="pl-catalog-empty mt-4" data-testid="catalog-empty-state">
            <strong>{catalogEmptyMessage(tables.length).title}</strong>
            <p className="notranslate" translate="no">{catalogEmptyMessage(tables.length).detail}</p>
          </div>
        ) : (
        <div className="pl-catalog-table-wrap mt-4" data-testid="catalog-table">
          <table className="pl-data-grid pl-catalog-table">
            <thead>
              <tr>
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
                  <td colSpan={6}>
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
                return (
                  <tr key={`${table.conn}/${table.schema}/${table.table}`} data-testid={`catalog-row-${table.table}`}>
                    <td className="pl-catalog-table-name">
                      <Link
                        to={editorHref}
                        className="pl-catalog-table-name-link notranslate"
                        translate="no"
                        data-testid={`catalog-row-edit-${table.table}`}
                        title={fullRef}
                      >
                        {table.table}
                      </Link>
                    </td>
                    <td><StatusBadge status={table.completion} /></td>
                    <td className="pl-catalog-table-structure notranslate" translate="no">{structureLabel(table)}</td>
                    <td className="pl-catalog-table-agents" data-testid={`catalog-row-agents-${table.table}`}>
                      {agentReferenceLabel(table.authorizedAgentCount)}
                    </td>
                    <td className="pl-catalog-table-updated notranslate" translate="no" title={semanticUpdatedTooltip(table)}>
                      {formatSemanticUpdatedAt(table.semanticUpdatedAt)}
                    </td>
                    <td className="pl-catalog-table-actions">
                      <div className="pl-catalog-table-actions-inner">
                        <Link
                          aria-label={`维护 ${table.schema}.${table.table} 语义`}
                          className="pl-inline-link text-xs notranslate"
                          translate="no"
                          to={editorHref}
                          data-testid={`catalog-row-maintain-${table.table}`}
                        >
                          维护语义 ↗
                        </Link>
                        {table.wikiRefCount > 0 ? (
                          <RowMoreMenu
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
      </section>
    </div>
  );
}
