import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import type { AuditResponse, AuditLogEntry } from "../../lib/types";

const OUTCOME_LABELS = { ok: "成功", error: "错误", denied: "拒绝" };
const PAGE_SIZE = 50;
const SENSITIVE_KEY = /(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)/i;
const SENSITIVE_PAIR = /\b(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)\b\s*[:=]\s*([^,\s;]+)/gi;

function buildQuery(params: Record<string, string | undefined | number>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "" && v !== null) q.set(k, String(v));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
        key,
        SENSITIVE_KEY.test(key) ? "[REDACTED]" : redactValue(nested)
      ])
    );
  }
  return value;
}

function redactErrorDetail(detail: string) {
  const firstLine = detail.split("\n")[0] ?? detail;
  return firstLine.replace(SENSITIVE_PAIR, "$1=[REDACTED]");
}

function EntryRow({ entry }: { entry: AuditLogEntry }) {
  const [expanded, setExpanded] = useState(false);
  const outcomeClass =
    entry.outcome === "ok" ? "pl-status-done" : entry.outcome === "denied" ? "pl-status-partial" : "pl-status-validation_failed";
  const redactedArgs = entry.argsSummary ? redactValue(entry.argsSummary) : null;

  return (
    <>
      <tr className="pl-audit-row" onClick={() => setExpanded(!expanded)}>
        <td className="px-3 py-2 text-xs text-fg-muted whitespace-nowrap">{new Date(entry.ts).toLocaleString("zh-CN")}</td>
        <td className="px-3 py-2 text-sm">{entry.userId}</td>
        <td className="px-3 py-2 text-sm font-mono">{entry.tool}</td>
        <td className="px-3 py-2 text-xs text-fg-muted">{entry.tables?.join(", ")}</td>
        <td className="px-3 py-2">
          <span className={`pl-status-badge ${outcomeClass}`}>{OUTCOME_LABELS[entry.outcome]}</span>
        </td>
        <td className="px-3 py-2 text-xs text-fg-muted">{entry.durationMs}ms</td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={6} className="px-3 py-3 text-xs">
            <div className="pl-audit-detail-grid">
              {redactedArgs !== null && (
                <div>
                  <span className="font-medium">Args：</span>
                  <code className="ml-2">{JSON.stringify(redactedArgs)}</code>
                </div>
              )}
              {entry.errorDetail && (
                <div>
                  <span className="font-medium text-danger">错误：</span>
                  <span className="ml-2 text-fg-muted">{redactErrorDetail(entry.errorDetail)}</span>
                </div>
              )}
              <div>
                <span className="font-medium">请求 ID：</span>
                <span className="ml-2 text-fg-muted font-mono">{entry.requestId}</span>
              </div>
              {entry.client && (
                <div>
                  <span className="font-medium">客户端：</span>
                  <span className="ml-2 text-fg-muted">{entry.client}</span>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function Audit() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);

  const user = searchParams.get("user") ?? "";
  const tool = searchParams.get("tool") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const tableSearch = searchParams.get("tableSearch") ?? "";

  // Default: last 24h
  const [since, setSince] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 16);
  });
  const [until, setUntil] = useState("");

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
    setPage(0);
  }

  const queryStr = buildQuery({ user: user || undefined, tool: tool || undefined, outcome: outcome || undefined, since: since || undefined, until: until || undefined, tableSearch: tableSearch || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", queryStr],
    queryFn: () => apiGet<AuditResponse>(`/api/admin/audit${queryStr}`)
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const exportUrl = `/api/admin/audit/export${buildQuery({ user: user || undefined, tool: tool || undefined, outcome: outcome || undefined, since: since || undefined, until: until || undefined, tableSearch: tableSearch || undefined })}`;

  return (
    <div className="pl-page-stack">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="pl-eyebrow">访问治理</p>
          <h1 className="text-xl font-semibold">访问日志</h1>
          <p className="pl-page-intro">查看 MCP Proxy 记录的工具调用，可按用户、工具、状态过滤。</p>
        </div>
        <a href={exportUrl} download className="pl-btn pl-btn--secondary text-sm">导出 CSV</a>
      </div>

      <div className="pl-admin-filterbar">
        <input
          className="pl-input w-36"
          placeholder="用户 ID"
          value={user}
          onChange={(e) => updateParam("user", e.target.value)}
        />
        <input
          className="pl-input w-36"
          placeholder="工具名"
          value={tool}
          onChange={(e) => updateParam("tool", e.target.value)}
        />
        <select
          className="pl-input w-28"
          value={outcome}
          onChange={(e) => updateParam("outcome", e.target.value)}
        >
          <option value="">全部状态</option>
          <option value="ok">成功</option>
          <option value="error">错误</option>
          <option value="denied">拒绝</option>
        </select>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={since}
          onChange={(e) => { setSince(e.target.value); setPage(0); }}
        />
        <span className="text-fg-muted self-center">—</span>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={until}
          onChange={(e) => { setUntil(e.target.value); setPage(0); }}
        />
        <input
          className="pl-input w-40"
          placeholder="搜索表名"
          value={tableSearch}
          onChange={(e) => updateParam("tableSearch", e.target.value)}
        />
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
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">工具</th>
                  <th className="px-3 py-2">表</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">耗时</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
                ) : (
                  entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center">
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              ‹ 上一页
            </button>
            <span className="text-sm text-fg-muted">{page + 1} / {totalPages || 1}</span>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              disabled={page >= totalPages - 1}
              onClick={() => setPage(page + 1)}
            >
              下一页 ›
            </button>
          </div>
        </>
      )}
    </div>
  );
}
