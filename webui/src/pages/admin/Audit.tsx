import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import type { AuditLogEntry, AuditResponse, AuditSourcesResponse } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

const OUTCOME_LABELS = { ok: "成功", error: "错误", denied: "拒绝" };
const PAGE_SIZE = 50;

/**
 * localStorage key for the Audit page's last-used filter snapshot. We
 * persist only the "non-shareable" filter values (the most-recent tab and
 * the last non-empty filter values) so users can come back to the page
 * and see what they were investigating, but URL params still drive the
 * shareable surface.
 */
const AUDIT_FILTER_STORAGE_KEY = "lucy:webui:audit:filters:v1";
const FILTER_PERSIST_FIELDS = ["tab", "user", "tool", "outcome", "tableSearch", "sessionId", "turnId", "platform"] as const;
type FilterSnapshot = Partial<Record<(typeof FILTER_PERSIST_FIELDS)[number], string>>;

function readFilterSnapshot(): FilterSnapshot {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(AUDIT_FILTER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as FilterSnapshot;
  } catch {
    return {};
  }
}

function writeFilterSnapshot(snapshot: FilterSnapshot) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUDIT_FILTER_STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // localStorage may be disabled (e.g. private mode); fall back to URL-only.
  }
}
const SENSITIVE_KEY = /(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)/i;
const SENSITIVE_PAIR = /\b(password|token|secret|api[_-]?key|private[_-]?key|cert|credentials?)\b\s*[:=]\s*([^,\s;]+)/gi;

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

function HeatmapView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", "heatmap"],
    queryFn: () => apiGet<AuditSourcesResponse>("/api/admin/audit/sources")
  });
  const maxCalls = Math.max(1, ...(data?.topTables ?? []).map((item) => item.calls));

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error) return <div className="pl-notice">加载失败：{(error as Error).message}</div>;

  return (
    <>
      <div className="pl-metric-grid">
        <div className="pl-metric-card"><span>连接</span><strong>{data?.connections.length ?? 0}</strong><small>审计派生</small></div>
        <div className="pl-metric-card"><span className="notranslate" translate="no">Schema</span><strong>{data?.schemas.length ?? 0}</strong><small>有访问记录</small></div>
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
  );
}

function buildQuery(params: Record<string, string | undefined | number | boolean>): string {
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
        <td className="px-3 py-2 text-xs text-fg-muted">{entry.decisionReason ?? "—"}</td>
        <td className="px-3 py-2">
          <span className={`pl-status-badge ${outcomeClass}`}>{OUTCOME_LABELS[entry.outcome]}</span>
        </td>
        <td className="px-3 py-2 text-xs text-fg-muted">
          <div className="flex flex-wrap items-center gap-2">
            <span>{entry.durationMs}ms</span>
            <Link
              to={buildObjectDetailSearch({ kind: "auditEvent", eventId: entry.id })}
              state={{ initialAuditEntry: entry }}
              className="pl-inline-link notranslate"
              translate="no"
              aria-label={`查看审计事件 #${entry.id} 的对象详情`}
              data-testid={`audit-row-detail-${entry.id}`}
              onClick={(event) => event.stopPropagation()}
            >
              查看详情
            </Link>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={7} className="px-3 py-3 text-xs">
            <div className="pl-audit-detail-grid">
              <div>
                <span className="font-medium">关联 <span className="notranslate" translate="no">Agent</span>：</span>
                <span className="ml-2 inline-flex flex-wrap items-center gap-2">
                  <Link
                    to={buildObjectDetailSearch({ kind: "agent", agentId: entry.userId })}
                    className="pl-inline-link notranslate"
                    translate="no"
                    aria-label={`查看 Agent ${entry.userId} 的对象详情`}
                    data-testid={`audit-related-agent-${entry.id}`}
                  >
                    查看 Agent 详情
                  </Link>
                  {entry.userId ? (
                    <span className="font-mono text-fg-muted notranslate" translate="no">
                      ({entry.userId})
                    </span>
                  ) : null}
                </span>
              </div>
              {(entry.tokenLabel || entry.tokenHashPrefix) && (
                <div>
                  <span className="font-medium"><span className="notranslate" translate="no">Token</span>：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.tokenLabel ?? "—"} {entry.tokenHashPrefix ? <span className="font-mono">({entry.tokenHashPrefix}…)</span> : null}
                  </span>
                </div>
              )}
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
              {entry.decisionReason && (
                <div>
                  <span className="font-medium">裁决原因：</span>
                  <span className="ml-2 text-fg-muted font-mono">{entry.decisionReason}</span>
                </div>
              )}
              {entry.roleIds && (
                <div>
                  <span className="font-medium">角色：</span>
                  <span className="ml-2 text-fg-muted">{entry.roleIds.join(", ") || "—"}</span>
                </div>
              )}
              {(entry.permissionSnapshotHash || entry.effectiveTablesCount !== undefined) && (
                <div>
                  <span className="font-medium">权限快照：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.permissionSnapshotHash ? <span className="font-mono">{entry.permissionSnapshotHash.slice(0, 16)}…</span> : "—"}
                    {entry.effectiveTablesCount !== undefined ? ` · ${entry.effectiveTablesCount} 张有效表` : ""}
                  </span>
                </div>
              )}
              {entry.client && (
                <div>
                  <span className="font-medium">客户端：</span>
                  <span className="ml-2 text-fg-muted">{entry.client}</span>
                </div>
              )}
              {(entry.lucySessionId || entry.lucyTurnId || entry.lucyPlatform) && (
                <div>
                  <span className="font-medium">关联会话：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.lucyPlatform ? `${entry.lucyPlatform} · ` : ""}
                    {entry.lucySessionId ? <span className="font-mono">{entry.lucySessionId}</span> : "—"}
                    {entry.lucyTurnId ? <span className="font-mono"> / {entry.lucyTurnId}</span> : ""}
                  </span>
                </div>
              )}
              {(entry.queryHash || entry.queryPreview) && (
                <div>
                  <span className="font-medium">Query 审计：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.queryOperation ?? "unknown"}
                    {entry.queryLength !== undefined ? ` · ${entry.queryLength} chars` : ""}
                    {entry.queryHash ? <span className="font-mono"> · {entry.queryHash.slice(0, 16)}…</span> : ""}
                  </span>
                  {entry.queryPreview ? <code className="ml-2">{entry.queryPreview}</code> : null}
                </div>
              )}
              {(entry.responseBytes !== undefined || entry.responseRowCount !== undefined || entry.responseColumnCount !== undefined) && (
                <div>
                  <span className="font-medium">返回规模：</span>
                  <span className="ml-2 text-fg-muted">
                    {entry.responseBytes !== undefined ? `${entry.responseBytes} bytes` : "—"}
                    {entry.responseRowCount !== undefined ? ` · ${entry.responseRowCount} rows` : ""}
                    {entry.responseColumnCount !== undefined ? ` · ${entry.responseColumnCount} cols` : ""}
                    {entry.responseTruncated ? " · truncated" : ""}
                  </span>
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
  const [hasHydratedFromStorage, setHasHydratedFromStorage] = useState(false);

  const user = searchParams.get("user") ?? "";
  const tool = searchParams.get("tool") ?? "";
  const outcome = searchParams.get("outcome") ?? "";
  const tableSearch = searchParams.get("tableSearch") ?? "";
  const sessionId = searchParams.get("sessionId") ?? "";
  const turnId = searchParams.get("turnId") ?? "";
  const platform = searchParams.get("platform") ?? "";
  const includeProtocol = searchParams.get("includeProtocol") === "true";
  const tab: "log" | "heatmap" = searchParams.get("tab") === "heatmap" ? "heatmap" : "log";

  // M36: hydrate the last-used tab + filter values from localStorage so the
  // user comes back to the same investigation context. URL params still
  // win when present (so a shared link overrides the local cache).
  useEffect(() => {
    if (hasHydratedFromStorage) return;
    if (searchParams.toString().length > 0) {
      setHasHydratedFromStorage(true);
      return;
    }
    const snapshot = readFilterSnapshot();
    if (Object.keys(snapshot).length === 0) {
      setHasHydratedFromStorage(true);
      return;
    }
    const next = new URLSearchParams(searchParams);
    for (const field of FILTER_PERSIST_FIELDS) {
      const value = snapshot[field];
      if (value) next.set(field, value);
    }
    setSearchParams(next, { replace: true });
    setHasHydratedFromStorage(true);
    // searchParams intentionally not in deps: we only want to read on first mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasHydratedFromStorage]);

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
    if ((FILTER_PERSIST_FIELDS as readonly string[]).includes(key)) {
      const snapshot = readFilterSnapshot();
      if (value) {
        snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]] = value;
      } else {
        delete snapshot[key as (typeof FILTER_PERSIST_FIELDS)[number]];
      }
      writeFilterSnapshot(snapshot);
    }
  }

  const queryStr = buildQuery({
    user: user || undefined,
    tool: tool || undefined,
    outcome: outcome || undefined,
    since: since || undefined,
    until: until || undefined,
    tableSearch: tableSearch || undefined,
    sessionId: sessionId || undefined,
    turnId: turnId || undefined,
    platform: platform || undefined,
    includeProtocol,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "audit", queryStr],
    queryFn: () => apiGet<AuditResponse>(`/api/admin/audit${queryStr}`),
    enabled: tab === "log"
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const exportUrl = `/api/admin/audit/export${buildQuery({ user: user || undefined, tool: tool || undefined, outcome: outcome || undefined, since: since || undefined, until: until || undefined, tableSearch: tableSearch || undefined, sessionId: sessionId || undefined, turnId: turnId || undefined, platform: platform || undefined, includeProtocol })}`;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="访问日志"
        breadcrumbs={tab === "heatmap" ? ["访问治理", "访问日志", "数据热力"] : undefined}
        description="查看 MCP Proxy 记录的工具调用，可按用户、工具、状态过滤。"
        badges={tab === "log" ? <span>{total} 条记录</span> : undefined}
        actions={tab === "log" ? <a href={exportUrl} download className="pl-btn pl-btn--secondary text-sm">导出 CSV</a> : undefined}
      />

      <div className="flex items-center gap-2" role="tablist" aria-label="访问日志视图">
        <Link
          to="/admin/audit"
          role="tab"
          aria-selected={tab === "log"}
          className="pl-btn pl-btn--ghost text-sm"
        >
          明细
        </Link>
        <Link
          to="/admin/audit?tab=heatmap"
          role="tab"
          aria-selected={tab === "heatmap"}
          className="pl-btn pl-btn--ghost text-sm"
        >
          数据热力
        </Link>
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
        <input
          className="pl-input w-40"
          placeholder="Session ID"
          value={sessionId}
          onChange={(e) => updateParam("sessionId", e.target.value)}
        />
        <input
          className="pl-input w-36"
          placeholder="Turn ID"
          value={turnId}
          onChange={(e) => updateParam("turnId", e.target.value)}
        />
        <input
          className="pl-input w-32"
          placeholder="平台"
          value={platform}
          onChange={(e) => updateParam("platform", e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={includeProtocol}
            onChange={(e) => updateParam("includeProtocol", e.target.checked ? "true" : "")}
          />
          显示协议调用
        </label>
      </div>

      {tab === "log" && (isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : error ? (
        <div className="pl-notice">加载失败：{(error as Error).message}</div>
      ) : (
        <>
          <div className="pl-metric-grid">
            <div className="pl-metric-card"><span>业务调用</span><strong>{data?.summary?.businessCalls ?? 0}</strong><small>默认展示</small></div>
            <div className="pl-metric-card"><span>协议调用</span><strong>{data?.summary?.protocolCalls ?? 0}</strong><small>{includeProtocol ? "已显示" : "已隐藏"}</small></div>
            <div className="pl-metric-card"><span>拒绝</span><strong>{data?.summary?.deniedCalls ?? 0}</strong><small>ACL 拒绝</small></div>
            <div className="pl-metric-card"><span>触达数据</span><strong>{data?.summary?.dataBearingCalls ?? 0}</strong><small>有表记录</small></div>
          </div>
          <div className="text-sm text-fg-muted">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} / 共 {total} 条</div>
          <div className="overflow-x-auto">
            <table className="pl-audit-table w-full text-sm">
              <thead>
                <tr className="border-b border-border-default text-left text-xs text-fg-muted">
                  <th className="px-3 py-2">时间</th>
                  <th className="px-3 py-2">用户</th>
                  <th className="px-3 py-2">工具</th>
                  <th className="px-3 py-2">表</th>
                  <th className="px-3 py-2">裁决原因</th>
                  <th className="px-3 py-2">状态</th>
                  <th className="px-3 py-2">耗时</th>
                </tr>
              </thead>
              <tbody>
                {entries.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
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
      ))}

      {tab === "heatmap" && <HeatmapView />}
    </div>
  );
}
