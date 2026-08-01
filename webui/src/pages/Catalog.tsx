import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SelectField } from "../components/SelectField";
import { StatusBadge } from "../components/StatusBadge";
import { PageHeader } from "../components/PageHeader";
import { RowMoreMenu } from "../components/RowMoreMenu";
import { apiGet } from "../lib/apiClient";
import { queryKeys } from "../lib/queryKeys";
import { buildObjectDetailSearch } from "../lib/objectDetail";
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

function structureLabel(table: SourceSummary): string {
  return `字段 ${table.columnCount} / 关联 ${table.joinCount} / 指标 ${table.measureCount}`;
}

function authorizedAgentLabel(count: number): string {
  return `${count} 个`;
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

export function Catalog() {
  const [connection, setConnection] = useState("all");
  const [schema, setSchema] = useState("all");
  const [status, setStatus] = useState<CompletionStatus | "all">("all");
  const [search, setSearch] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const tables = data?.tables ?? [];
  const connections = useMemo(() => unique(tables.map((table) => table.conn)), [tables]);
  const connectionOptions = useMemo(
    () => [
      { value: "all", label: "全部 Connection" },
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
      ...(Object.entries(STATUS_LABELS) as [CompletionStatus, string][]).map(([value, label]) => ({ value, label }))
    ],
    []
  );

  useEffect(() => {
    if (schema !== "all" && !schemas.includes(schema)) {
      setSchema("all");
    }
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
      if (status !== "all" && table.completion !== status) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return `${table.conn}/${table.schema}/${table.table} ${table.columnNames.join(" ")}`.toLowerCase().includes(needle);
    });
  }, [connection, schema, search, status, tables]);

  function copyFullReference(table: SourceSummary) {
    const fullRef = `${table.conn}/${table.schema}/${table.table}`;
    void navigator.clipboard?.writeText(fullRef);
  }

  if (isLoading) {
    return <p className="pl-notice">正在加载表目录...</p>;
  }

  if (error) {
    return <p className="pl-error">表目录加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="表目录"
        description={<span className="notranslate" translate="no">浏览当前 KTX 项目的语义层数据表，按 Connection、Schema、状态和关键词定位需要维护的对象。</span>}
      />

      <section className="pl-panel">
        <div className="pl-toolbar">
          <label className="grid gap-1.5 text-sm">
            <span className="notranslate" translate="no">Connection</span>
            <SelectField
              className="notranslate"
              translate="no"
              ariaLabel="按 Connection 筛选"
              value={connection}
              onValueChange={setConnection}
              options={connectionOptions}
              placeholder="全部 Connection"
            />
          </label>
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
            <input className="pl-input notranslate" translate="no" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Connection、Schema、表名或字段名" />
          </label>
          <span className="pl-catalog-result-count" data-testid="catalog-result-count">
            {filtered.length} 条结果
          </span>
        </div>

        <div className="pl-catalog-table-wrap" data-testid="catalog-table">
          <table className="pl-catalog-table">
            <thead>
              <tr>
                <th scope="col">表名</th>
                <th scope="col" className="notranslate" translate="no">Connection</th>
                <th scope="col" className="notranslate" translate="no">Schema</th>
                <th scope="col">语义状态</th>
                <th scope="col">结构</th>
                <th scope="col"><span className="notranslate" translate="no">授权 Agent</span></th>
                <th scope="col">语义更新时间</th>
                <th scope="col" className="pl-catalog-table-actions-col">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((table) => {
                const editorHref = `/catalog/${encodeURIComponent(table.conn)}/${encodeURIComponent(table.schema)}/${encodeURIComponent(table.table)}`;
                const wikiHref = slRefWikiHref(table);
                const detailHref = buildObjectDetailSearch({
                  kind: "table",
                  conn: table.conn,
                  schema: table.schema,
                  table: table.table
                });
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
                    <td className="pl-catalog-table-connection notranslate" translate="no">{table.conn}</td>
                    <td className="pl-catalog-table-schema notranslate" translate="no">{table.schema}</td>
                    <td><StatusBadge status={table.completion} /></td>
                    <td className="pl-catalog-table-structure notranslate" translate="no">{structureLabel(table)}</td>
                    <td className="pl-catalog-table-agents" data-testid={`catalog-row-agents-${table.table}`}>
                      {authorizedAgentLabel(table.authorizedAgentCount)}
                    </td>
                    <td className="pl-catalog-table-updated notranslate" translate="no" title={semanticUpdatedTooltip(table)}>
                      {formatSemanticUpdatedAt(table.semanticUpdatedAt)}
                    </td>
                    <td className="pl-catalog-table-actions">
                      <Link
                        aria-label={`维护表语义：${table.schema}.${table.table}`}
                        className="pl-btn pl-btn--secondary pl-btn--sm notranslate"
                        translate="no"
                        to={editorHref}
                        data-testid={`catalog-row-maintain-${table.table}`}
                      >
                        维护语义
                      </Link>
                      <RowMoreMenu
                        ariaLabel={moreLabel}
                        items={[
                          { kind: "action", label: "复制完整引用", onSelect: () => copyFullReference(table), testId: `catalog-row-copy-ref-${table.table}` },
                          { kind: "link", label: "查看详情", href: detailHref, testId: `catalog-row-detail-${table.table}` },
                          { kind: "link", label: "业务 Wiki", href: wikiHref, testId: `catalog-row-wiki-${table.table}` }
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
