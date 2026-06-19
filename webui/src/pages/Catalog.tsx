import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SelectField } from "../components/SelectField";
import { StatusBadge } from "../components/StatusBadge";
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
    () => [{ value: "all", label: "全部 schema" }, ...schemas.map((value) => ({ value, label: value }))],
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
    <section className="pl-panel">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">语义层维护</p>
          <h1 className="text-xl font-semibold">语义维护工作台</h1>
        </div>
        <div className="flex items-center gap-3">
          <Link className="pl-btn pl-btn--ghost" to="/wiki">业务 Wiki</Link>
          <Link className="pl-btn pl-btn--ghost" to="/review">审阅</Link>
          <p className="text-sm text-fg-muted">{filtered.length} / {tables.length} 张表</p>
        </div>
      </div>
      <p className="pl-page-intro">浏览当前 KTX 项目的语义层数据表，按 schema、状态和关键词定位需要维护的对象。</p>

      <div className="pl-toolbar">
        <label className="grid gap-1.5 text-sm">
          <span>Schema</span>
          <SelectField ariaLabel="按 schema 筛选" value={schema} onValueChange={setSchema} options={schemaOptions} placeholder="全部 schema" />
        </label>
        <label className="grid gap-1.5 text-sm">
          <span>状态</span>
          <SelectField ariaLabel="按完成状态筛选" value={status} onValueChange={(v) => setStatus(v as CompletionStatus | "all")} options={statusOptions} placeholder="全部状态" />
        </label>
        <label className="flex-1 min-w-50">
          <span className="block mb-1.5 text-sm">搜索</span>
          <input className="pl-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="表名、字段名或 schema" />
        </label>
      </div>

      <div className="pl-table-list">
        {filtered.map((table) => (
          <Link
            className="pl-table-row"
            key={`${table.conn}/${table.schema}/${table.table}`}
            to={`/sources/${encodeURIComponent(table.conn)}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.table)}`}
          >
            <div>
              <strong>{table.table}</strong>
              <span>{table.schema}</span>
            </div>
            <span>{displayDescription(table)}</span>
            <StatusBadge status={table.completion} />
            <span className="text-sm text-primary font-medium">维护语义</span>
          </Link>
        ))}
      </div>
    </section>
  );
}