import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { StatusBadge } from "../components/StatusBadge";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import type { CompletionStatus, SourcesResponse, SourceSummary } from "../lib/types";

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
    return <p className="notice">正在加载表目录...</p>;
  }

  if (error) {
    return <p className="error">表目录加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <section className="page-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">语义层维护</p>
          <h1>语义维护工作台</h1>
        </div>
        <div className="heading-actions">
          <Link className="back-link" to="/wiki">业务 Wiki</Link>
          <Link className="back-link" to="/review">审阅</Link>
          <p className="table-count">{filtered.length} / {tables.length} 张表</p>
        </div>
      </div>
      <p className="page-intro">浏览当前 KTX 项目的语义层数据表，按 schema、状态和关键词定位需要维护的对象。</p>

      <div className="toolbar">
        <label>
          Schema
          <select value={schema} onChange={(event) => setSchema(event.target.value)}>
            <option value="all">全部 schema</option>
            {schemas.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select value={status} onChange={(event) => setStatus(event.target.value as CompletionStatus | "all")}>
            <option value="all">全部状态</option>
            <option value="not_started">未开始</option>
            <option value="partial">部分完成</option>
            <option value="done">已完成</option>
            <option value="validation_failed">校验失败</option>
          </select>
        </label>
        <label className="search-field">
          搜索
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="表名、字段名或 schema" />
        </label>
      </div>

      <div className="table-list">
        {filtered.map((table) => (
          <Link
            className="table-row"
            key={`${table.conn}/${table.schema}/${table.table}`}
            to={`/sources/${encodeURIComponent(table.conn)}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.table)}`}
          >
            <div>
              <strong>{table.table}</strong>
              <span>{table.schema}</span>
            </div>
            <span>{displayDescription(table)}</span>
            <StatusBadge status={table.completion} />
            <span className="row-action">维护语义</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
