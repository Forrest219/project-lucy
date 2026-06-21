import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../../components/DiffViewer";
import { apiGet } from "../../lib/apiClient";
import type { ConfigAuditEntry, ConfigAuditResponse } from "../../lib/types";

const PAGE_SIZE = 50;

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") q.set(key, String(value));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

function ChangeRow({ entry }: { entry: ConfigAuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="pl-audit-row" onClick={() => setExpanded(!expanded)}>
        <td className="px-3 py-2 text-xs text-fg-muted whitespace-nowrap">{new Date(entry.ts).toLocaleString("zh-CN")}</td>
        <td className="px-3 py-2 text-sm font-mono">{entry.actor}</td>
        <td className="px-3 py-2 text-sm">{entry.changeType}</td>
        <td className="px-3 py-2 text-sm font-mono">{entry.targetId ?? "—"}</td>
        <td className="px-3 py-2 text-xs text-fg-muted">{entry.filePath}</td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={5} className="px-3 py-3 text-xs">
            <div className="grid gap-3">
              <div className="pl-audit-detail-grid">
                <div><span className="font-medium">Request ID：</span><span className="ml-2 text-fg-muted font-mono">{entry.requestId ?? "—"}</span></div>
                <div><span className="font-medium">Session：</span><span className="ml-2 text-fg-muted font-mono">{entry.sessionId ?? "—"}</span></div>
                {entry.oldSummary !== undefined && <div><span className="font-medium">旧摘要：</span><code className="ml-2">{JSON.stringify(entry.oldSummary)}</code></div>}
                {entry.newSummary !== undefined && <div><span className="font-medium">新摘要：</span><code className="ml-2">{JSON.stringify(entry.newSummary)}</code></div>}
              </div>
              {entry.diff ? <DiffViewer diff={entry.diff} /> : null}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function ConfigAudit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);
  const targetId = searchParams.get("targetId") ?? "";
  const filePath = searchParams.get("filePath") ?? "";

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
    setPage(0);
  }

  const queryStr = buildQuery({
    targetId: targetId || undefined,
    filePath: filePath || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "config-audit", queryStr],
    queryFn: () => apiGet<ConfigAuditResponse>(`/api/admin/config-audit${queryStr}`)
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="pl-page-stack">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="pl-eyebrow">访问治理</p>
          <h1 className="text-xl font-semibold">配置变更日志</h1>
          <p className="pl-page-intro">查看访问配置写入历史，当前 actor 为单管理员本机语义。</p>
        </div>
        <Link to="/admin/audit" className="pl-btn pl-btn--secondary text-sm">访问日志</Link>
      </div>

      {data?.actorNotice ? <div className="pl-notice">{data.actorNotice}</div> : null}

      <div className="pl-admin-filterbar">
        <input className="pl-input w-40" placeholder="Agent / target" value={targetId} onChange={(e) => updateParam("targetId", e.target.value)} />
        <input className="pl-input w-56" placeholder="文件路径" value={filePath} onChange={(e) => updateParam("filePath", e.target.value)} />
      </div>

      {isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : error ? (
        <div className="pl-notice">加载失败：{(error as Error).message}</div>
      ) : (
        <>
          <div className="text-sm text-fg-muted">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / 共 {total} 条</div>
          <div className="overflow-x-auto">
            <table className="pl-audit-table w-full text-sm">
              <thead>
                <tr className="border-b border-border-default text-left text-xs text-fg-muted">
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">目标</th>
                  <th className="px-3 py-2">文件</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
                ) : (
                  data?.entries.map((entry) => <ChangeRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center">
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ 上一页</button>
            <span className="text-sm text-fg-muted">{page + 1} / {totalPages || 1}</span>
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页 ›</button>
          </div>
        </>
      )}
    </div>
  );
}
