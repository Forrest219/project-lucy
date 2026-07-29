import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import type { AuditSourcesResponse } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

function HeatRow({ label, calls, denied, max }: { label: string; calls: number; denied?: number; max: number }) {
  const width = max > 0 ? Math.max(4, Math.round((calls / max) * 100)) : 0;
  return (
    <div className="grid grid-cols-[minmax(180px,1fr)_minmax(160px,260px)_80px_80px] items-center gap-3 text-sm">
      <span className="font-mono text-fg-muted truncate">{label}</span>
      <div className="h-2 rounded-pill bg-bg-muted overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      <span>{calls}</span>
      <span className={denied ? "text-danger font-medium" : "text-fg-muted"}>{denied ?? 0}</span>
    </div>
  );
}

export function AuditSources() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit-sources"],
    queryFn: () => apiGet<AuditSourcesResponse>("/api/admin/audit/sources")
  });
  const maxCalls = Math.max(1, ...(data?.topTables ?? []).map((item) => item.calls));

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="数据源热力视图"
        breadcrumbs={["访问治理", "数据源热力视图"]}
        description="从访问审计派生表级访问和拒绝分布，不读取业务数据内容。"
        actions={
          <Link to="/admin/audit" className="pl-btn pl-btn--secondary text-sm">访问日志</Link>
        }
      />

      {isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : error ? (
        <div className="pl-notice">加载失败：{(error as Error).message}</div>
      ) : (
        <>
          <div className="pl-metric-grid">
            <div className="pl-metric-card"><span>连接</span><strong>{data?.connections.length ?? 0}</strong><small>审计派生</small></div>
            <div className="pl-metric-card"><span>Schema</span><strong>{data?.schemas.length ?? 0}</strong><small>有访问记录</small></div>
            <div className="pl-metric-card"><span>表</span><strong>{data?.topTables.length ?? 0}</strong><small>Top 50</small></div>
            <div className="pl-metric-card"><span>拒绝表</span><strong>{data?.deniedTables.length ?? 0}</strong><small>有 denied</small></div>
          </div>

          <section className="pl-card grid gap-3">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold mb-0">Top Tables</p>
              <span className="text-xs text-fg-muted">calls / denied</span>
            </div>
            {(data?.topTables ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">暂无表级访问记录。</p>
            ) : (
              data?.topTables.map((item) => (
                <HeatRow key={item.table} label={item.table} calls={item.calls} denied={item.denied} max={maxCalls} />
              ))
            )}
          </section>

          <section className="pl-card grid gap-3">
            <p className="text-base font-semibold mb-0">Denied Tables</p>
            {(data?.deniedTables ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">暂无表级拒绝记录。</p>
            ) : (
              data?.deniedTables.map((item) => (
                <HeatRow key={item.table} label={item.table} calls={item.calls} denied={item.denied} max={maxCalls} />
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
