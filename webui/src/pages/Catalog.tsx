import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SelectField } from "../components/SelectField";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { CompletionStatus, SourcesResponse, SourceSummary } from "../lib/types";

const STATUS_LABELS: Record<CompletionStatus, string> = {
  not_started: "未开始",
  partial: "部分完成",
  done: "已完成",
  validation_failed: "校验失败"
};

function unique(values: string[]) {
  return Array.from(new Set(values)).sort();
}

function displayDescription(table: SourceSummary) {
  const parts = [`${table.columnCount} 个字段`];
  if (table.joinCount) {
    parts.push(`${table.joinCount} 个关联`);
  }
  if (table.measureCount) {
    parts.push(`${table.measureCount} 个指标`);
  }
  return parts.join(" / ");
}

function slRefWikiHref(table: SourceSummary): string {
  const slRef = `${table.conn}/${table.schema}/${table.table}`;
  return `/wiki?sl_ref=${encodeURIComponent(slRef)}`;
}

export function Catalog() {
  const [schema, setSchema] = useState("all");
  const [status, setStatus] = useState<CompletionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const tables = data?.tables ?? [];
  const schemas = useMemo(() => unique(tables.map((table) => table.schema)), [tables]);
  const schemaOptions = useMemo(
    () => [{ value: "all", label: "全部 Schema" }, ...schemas.map((value) => ({ value, label: value }))],
    [schemas]
  );
  const statusOptions = useMemo(
    () => [
      { value: "all", label: "全部状态" },
      ...(Object.entries(STATUS_LABELS) as [CompletionStatus, string][]).map(([value, label]) => ({ value, label }))
    ],
    []
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return tables.filter((table) => {
      if (schema !== "all" && table.schema !== schema) {
        return false;
      }
      if (status !== "all" && table.completion !== status) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${table.schema}.${table.table} ${table.columnNames.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [schema, search, status, tables]);

  if (isLoading) {
    return <p className="pl-notice">正在加载表目录...</p>;
  }

  if (error) {
    return <p className="pl-error">表目录加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="语义维护工作台"
        breadcrumbs={["语义层维护", "表目录"]}
        description={<span className="notranslate" translate="no">浏览当前 KTX 项目的语义层数据表，按 Schema、状态和关键词定位需要维护的对象。</span>}
        badges={
          <span data-testid="catalog-count">
            {filtered.length} / {tables.length} 张表
          </span>
        }
        actions={
          <>
            <Link className="pl-btn pl-btn--ghost" to="/wiki">业务 Wiki</Link>
            <Link className="pl-btn pl-btn--ghost" to="/review">审阅</Link>
          </>
        }
      />

      <section className="pl-panel">
      <div className="pl-toolbar">
        <label className="grid gap-1.5 text-sm">
          <span className="notranslate" translate="no">Schema</span>
          <SelectField className="notranslate" translate="no" ariaLabel="按 Schema 筛选" value={schema} onValueChange={setSchema} options={schemaOptions} placeholder="全部 Schema" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span>状态</span>
          <SelectField ariaLabel="按完成状态筛选" value={status} onValueChange={(v) => setStatus(v as CompletionStatus | "all")} options={statusOptions} placeholder="全部状态" />
        </label>
        <label className="flex-1 min-w-50">
          <span className="block mb-1.5 text-sm">搜索</span>
          <input className="pl-input notranslate" translate="no" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="表名、字段名或 Schema" />
        </label>
      </div>

      <div className="pl-table-list">
        {filtered.map((table) => {
          const editorHref = `/sources/${encodeURIComponent(table.conn)}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.table)}`;
          const wikiHref = slRefWikiHref(table);
          return (
            <div
              className="pl-table-row"
              key={`${table.conn}/${table.schema}/${table.table}`}
              role="group"
            >
              <div className="pl-table-row-meta">
                <strong>{table.table}</strong>
                <span>{table.schema}</span>
              </div>
              <span className="pl-table-row-stats">{displayDescription(table)}</span>
              <StatusBadge status={table.completion} />
              <div className="pl-table-row-actions">
                <Link
                  aria-label={`打开 ${table.schema}.${table.table} 的业务 Wiki`}
                  className="pl-btn pl-btn--ghost notranslate"
                  translate="no"
                  to={wikiHref}
                >
                  业务 Wiki
                </Link>
                <Link
                  aria-label={`维护表语义：${table.schema}.${table.table}`}
                  className="pl-btn pl-btn--secondary notranslate"
                  translate="no"
                  to={editorHref}
                >
                  维护语义
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      </section>
    </div>
  );
}
