import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";
import { apiGet } from "../../lib/apiClient";
import {
  CHANGE_TYPE_OPTIONS,
  actorLabel,
  assetKindLabel,
  changeTypeLabel,
  formatConfigAuditTs,
  sourceLabel,
  type ConfigAuditAssetKind
} from "../../lib/configAuditLabels";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import type { ConfigAuditEntry, ConfigAuditResponse } from "../../lib/types";

const PAGE_SIZE = 20;

type AssetKind = ConfigAuditAssetKind;

function buildQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") q.set(key, String(value));
  }
  return q.toString() ? `?${q.toString()}` : "";
}

function toDatetimeLocalValue(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalValue(local: string): string {
  if (!local) return "";
  const date = new Date(local);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function sinceDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Map a Config Audit entry's `changeType` + `targetId` to a deep-link into
 * the related admin page. Returns null when we cannot infer a target.
 */
function configTargetLink(entry: ConfigAuditEntry): string | null {
  if (entry.assetKind === "wiki" && entry.targetId) {
    return `/wiki/${encodeURIComponent(entry.targetId)}`;
  }
  if (entry.assetKind === "publish") {
    return "/publish/history";
  }
  if (entry.assetKind === "semantic") {
    const parts = (entry.targetId ?? "").split(":");
    if (parts.length >= 3) {
      return `/catalog/${encodeURIComponent(parts[0])}/${encodeURIComponent(parts[1])}/${encodeURIComponent(parts[2])}`;
    }
  }
  if (!entry.targetId) return null;
  if (entry.changeType.includes("agent") || entry.filePath.includes("access.yaml")) {
    return buildObjectDetailSearch({ kind: "agent", agentId: entry.targetId });
  }
  if (entry.changeType.includes("role")) {
    return `/admin/roles/${encodeURIComponent(entry.targetId)}`;
  }
  return null;
}

function ChangeRow({ entry }: { entry: ConfigAuditEntry }) {
  const [expanded, setExpanded] = useState(false);
  const targetLink = configTargetLink(entry);
  return (
    <>
      <tr className="pl-audit-row" onClick={() => setExpanded(!expanded)}>
        <td className="pl-audit-table-muted whitespace-nowrap">{formatConfigAuditTs(entry.ts)}</td>
        <td>{actorLabel(entry.actor)}</td>
        <td className="pl-audit-table-muted">{sourceLabel(entry.source)}</td>
        <td>{assetKindLabel(entry.assetKind)}</td>
        <td>{changeTypeLabel(entry.changeType)}</td>
        <td className="pl-audit-table-mono">
          {targetLink ? (
            <Link
              to={targetLink}
              className="pl-inline-link notranslate"
              translate="no"
              data-testid={`config-audit-target-link-${entry.id}`}
            >
              {entry.targetId ?? "—"}
            </Link>
          ) : (
            entry.targetId ?? "—"
          )}
        </td>
        <td className="pl-audit-table-mono pl-audit-table-muted">{entry.filePath}</td>
      </tr>
      {expanded && (
        <tr className="pl-audit-detail">
          <td colSpan={7} className="px-3 py-3 text-xs">
            <div className="grid gap-3">
              <div className="pl-audit-detail-grid">
                <div><span className="font-medium">请求 ID：</span><span className="ml-2 text-fg-muted font-mono">{entry.requestId ?? "—"}</span></div>
                <div><span className="font-medium">会话：</span><span className="ml-2 text-fg-muted font-mono">{entry.sessionId ?? "—"}</span></div>
                <div><span className="font-medium">操作者原始值：</span><span className="ml-2 text-fg-muted font-mono">{entry.actor}</span></div>
                <div><span className="font-medium">操作者类型：</span><span className="ml-2 text-fg-muted font-mono">{entry.actorType}</span></div>
                <div><span className="font-medium">来源 code：</span><span className="ml-2 text-fg-muted font-mono">{entry.source ?? "—"}</span></div>
                <div><span className="font-medium">操作：</span><span className="ml-2 text-fg-muted font-mono">{entry.operation ?? "—"}</span></div>
                <div><span className="font-medium">写入状态：</span><span className="ml-2 text-fg-muted font-mono">{entry.writeStatus}</span></div>
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
  const assetKind = searchParams.get("assetKind") ?? "";
  const changeType = searchParams.get("changeType") ?? "";
  const source = searchParams.get("source") ?? "";
  const since = searchParams.get("since") ?? "";
  const until = searchParams.get("until") ?? "";
  const windowPreset = searchParams.get("window") ?? "";

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value); else next.delete(key);
    setSearchParams(next);
    setPage(0);
  }

  function applyWindowPreset(preset: string) {
    const next = new URLSearchParams(searchParams);
    if (!preset) {
      next.delete("window");
      next.delete("since");
      next.delete("until");
    } else {
      const days = preset === "7d" ? 7 : 30;
      next.set("window", preset);
      next.set("since", sinceDaysAgo(days));
      next.delete("until");
    }
    setSearchParams(next);
    setPage(0);
  }

  function updateSinceLocal(local: string) {
    const next = new URLSearchParams(searchParams);
    const iso = fromDatetimeLocalValue(local);
    if (iso) next.set("since", iso); else next.delete("since");
    next.delete("window");
    setSearchParams(next);
    setPage(0);
  }

  function updateUntilLocal(local: string) {
    const next = new URLSearchParams(searchParams);
    const iso = fromDatetimeLocalValue(local);
    if (iso) next.set("until", iso); else next.delete("until");
    next.delete("window");
    setSearchParams(next);
    setPage(0);
  }

  const changeTypeOptions = useMemo(() => {
    if (!assetKind) return CHANGE_TYPE_OPTIONS;
    return CHANGE_TYPE_OPTIONS.filter((item) => item.assetKinds.includes(assetKind as AssetKind));
  }, [assetKind]);

  const filterParams = {
    targetId: targetId || undefined,
    filePath: filePath || undefined,
    assetKind: assetKind || undefined,
    changeType: changeType || undefined,
    source: source || undefined,
    since: since || undefined,
    until: until || undefined
  };

  const queryStr = buildQuery({
    ...filterParams,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE
  });
  const exportUrl = `/api/admin/config-audit/export.csv${buildQuery(filterParams)}`;
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "config-audit", queryStr],
    queryFn: () => apiGet<ConfigAuditResponse>(`/api/admin/config-audit${queryStr}`)
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="配置审计"
        description="查看治理配置与语义资产的写入历史。"
        actions={<a href={exportUrl} className="pl-btn pl-btn--secondary text-sm">导出 CSV</a>}
      />

      <div className="pl-admin-filterbar" data-testid="config-audit-filterbar">
        <select
          className="pl-input w-32"
          value={windowPreset}
          onChange={(e) => applyWindowPreset(e.target.value)}
          aria-label="时间窗口"
          data-testid="config-audit-window"
        >
          <option value="">全部时间</option>
          <option value="7d">近 7 天</option>
          <option value="30d">近 30 天</option>
        </select>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={toDatetimeLocalValue(since)}
          onChange={(e) => updateSinceLocal(e.target.value)}
          aria-label="开始时间"
          data-testid="config-audit-since"
        />
        <span className="text-fg-muted self-center">—</span>
        <input
          className="pl-input w-44"
          type="datetime-local"
          value={toDatetimeLocalValue(until)}
          onChange={(e) => updateUntilLocal(e.target.value)}
          aria-label="结束时间"
          data-testid="config-audit-until"
        />
        <select
          className="pl-input w-36"
          value={assetKind}
          onChange={(e) => {
            const next = new URLSearchParams(searchParams);
            if (e.target.value) next.set("assetKind", e.target.value); else next.delete("assetKind");
            next.delete("changeType");
            setSearchParams(next);
            setPage(0);
          }}
          aria-label="资产域"
        >
          <option value="">全部资产域</option>
          <option value="governance">访问治理</option>
          <option value="semantic">语义 YAML</option>
          <option value="wiki">业务 Wiki</option>
          <option value="eval">评测</option>
          <option value="publish">发布</option>
        </select>
        <select
          className="pl-input w-44"
          value={changeType}
          onChange={(e) => updateParam("changeType", e.target.value)}
          aria-label="变更类型"
          data-testid="config-audit-change-type"
        >
          <option value="">全部变更类型</option>
          {changeTypeOptions.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <input
          className="pl-input w-40 notranslate"
          translate="no"
          placeholder="目标 ID"
          value={targetId}
          onChange={(e) => updateParam("targetId", e.target.value)}
          aria-label="目标 ID"
        />
        <input
          className="pl-input w-48"
          placeholder="文件路径"
          value={filePath}
          onChange={(e) => updateParam("filePath", e.target.value)}
          aria-label="文件路径"
        />
        <input
          className="pl-input w-40"
          placeholder="来源"
          value={source}
          onChange={(e) => updateParam("source", e.target.value)}
          aria-label="来源"
        />
      </div>

      {isLoading ? (
        <div className="pl-notice">加载中…</div>
      ) : error ? (
        <div className="pl-notice">加载失败：{(error as Error).message}</div>
      ) : (
        <>
          <div className="text-sm text-fg-muted" data-testid="config-audit-page-range">
            {total === 0 ? "共 0 条" : `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / 共 ${total} 条`}
          </div>
          <div className="overflow-x-auto">
            <table className="pl-data-grid pl-data-table pl-config-audit-table pl-audit-table w-full" data-testid="config-audit-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作者</th>
                  <th>来源</th>
                  <th>资产域</th>
                  <th>变更类型</th>
                  <th>目标</th>
                  <th>文件路径</th>
                </tr>
              </thead>
              <tbody>
                {(data?.entries ?? []).length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-6 text-center text-fg-muted">暂无记录</td></tr>
                ) : (
                  data?.entries.map((entry) => <ChangeRow key={entry.id} entry={entry} />)
                )}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center">
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>‹ 上一页</button>
            <span className="text-sm text-fg-muted" data-testid="config-audit-page-index">{page + 1} / {totalPages || 1}</span>
            <button type="button" className="pl-btn pl-btn--ghost text-sm" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>下一页 ›</button>
          </div>
        </>
      )}
    </div>
  );
}
