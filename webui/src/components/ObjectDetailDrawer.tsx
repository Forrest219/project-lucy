import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../lib/apiClient";
import {
  buildObjectDetailSearch,
  clearObjectDetailSearch,
  objectDetailTitle,
  parseObjectDetailSearch
} from "../lib/objectDetail";
import type {
  Agent,
  AuditLogEntry,
  AuditResponse,
  EvalRun,
  EvalRunWithResults,
  SourceSummary,
  SourcesResponse
} from "../lib/types";

type AgentsResponse = { agents: Agent[]; version?: string };

const TABLE_NOT_FOUND_TITLE = "未找到该表";
const AGENT_NOT_FOUND_TITLE = "未找到该 Agent";
const RUN_NOT_FOUND_TITLE = "未找到该 Run";
const EVENT_NOT_FOUND_TITLE = "未找到该审计事件";

type CloseSource = "button" | "backdrop" | "esc" | "unknown";

/**
 * M36 review follow-up: callers (notably the Audit page) can pass an
 * initial entry via `location.state` so the drawer renders immediately
 * without waiting for a re-fetch that may not contain the row (e.g. when
 * the user is on a paginated or filtered page). The state object lives
 * in history only — the URL Query is still the shareable truth.
 */
type DrawerLocationState = {
  initialAuditEntry?: AuditLogEntry;
};

function readLocationState(location: ReturnType<typeof useLocation>): DrawerLocationState {
  const state = location.state as DrawerLocationState | null;
  return state ?? {};
}

export function ObjectDetailDrawer() {
  const location = useLocation();
  const navigate = useNavigate();
  const target = parseObjectDetailSearch(location.search);
  const locationState = readLocationState(location);
  const [closeSource, setCloseSource] = useState<CloseSource>("unknown");

  function close() {
    if (closeSource === "unknown") setCloseSource("button");
    const nextSearch = clearObjectDetailSearch(location.search);
    navigate(nextSearch ? `${location.pathname}${nextSearch}` : location.pathname, { replace: true });
  }

  useEffect(() => {
    if (!target) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCloseSource("esc");
        close();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // close() reads from location/navigate but is stable for our purposes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, location.pathname, location.search]);

  if (!target) return null;

  return (
    <div
      className="pl-drawer-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="对象详情"
      data-testid="object-detail-drawer"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          setCloseSource("backdrop");
          close();
        }
      }}
    >
      <div className="pl-drawer-panel" role="document">
        <header className="pl-drawer-header">
          <div className="grid gap-1 min-w-0">
            <span className="pl-eyebrow">{drawerEyebrow(target.kind)}</span>
            <h2 className="pl-panel-title mb-0" data-testid="object-detail-title">
              <span className="notranslate" translate="no">{objectDetailTitle(target)}</span>
            </h2>
          </div>
          <button
            type="button"
            className="pl-drawer-close"
            onClick={() => {
              setCloseSource("button");
              close();
            }}
            aria-label="关闭对象详情抽屉"
            data-testid="object-detail-close"
          >
            关闭
          </button>
        </header>
        <div className="pl-drawer-body">
          {target.kind === "table" ? (
            <TableDetailBody target={target} />
          ) : target.kind === "agent" ? (
            <AgentDetailBody target={target} />
          ) : target.kind === "evalRun" ? (
            <EvalRunDetailBody target={target} />
          ) : (
            <AuditEventDetailBody target={target} initialEntry={locationState.initialAuditEntry} />
          )}
        </div>
        <footer className="pl-drawer-footer pl-drawer-footer-border-t">
          <span className="text-xs text-fg-muted" data-testid="object-detail-close-source">
            关闭方式：{closeSourceLabel(closeSource)}
          </span>
          <Link
            className="pl-btn pl-btn--ghost text-sm"
            to={deepLinkHref(target)}
            onClick={() => setCloseSource("button")}
            data-testid="object-detail-deep-link"
          >
            打开完整页面 →
          </Link>
        </footer>
      </div>
    </div>
  );
}

function drawerEyebrow(kind: "table" | "agent" | "evalRun" | "auditEvent"): string {
  switch (kind) {
    case "table":
      return "Table · 对象详情";
    case "agent":
      return "Agent · 对象详情";
    case "evalRun":
      return "Eval Run · 对象详情";
    case "auditEvent":
      return "Audit Event · 对象详情";
  }
}

function closeSourceLabel(source: CloseSource): string {
  switch (source) {
    case "button":
      return "按钮";
    case "backdrop":
      return "点击空白";
    case "esc":
      return "Esc 键";
    default:
      return "尚未关闭";
  }
}

function deepLinkHref(target: NonNullable<ReturnType<typeof parseObjectDetailSearch>>): string {
  switch (target.kind) {
    case "table":
      return `/sources/${encodeURIComponent(target.conn)}/${encodeURIComponent(target.schema)}/${encodeURIComponent(target.table)}`;
    case "agent":
      return `/admin/agents/${encodeURIComponent(target.agentId)}`;
    case "evalRun":
      return `/eval/runs/${target.runId}`;
    case "auditEvent":
      return `/admin/audit`;
  }
}

type TableTarget = Extract<NonNullable<ReturnType<typeof parseObjectDetailSearch>>, { kind: "table" }>;

function TableDetailBody({ target }: { target: TableTarget }) {
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });
  const tables = sourcesQuery.data?.tables ?? [];
  const match: SourceSummary | undefined = tables.find(
    (table) => table.conn === target.conn && table.schema === target.schema && table.table === target.table
  );
  if (sourcesQuery.isLoading) {
    return <p className="pl-notice">加载中…</p>;
  }
  if (!match) {
    return (
      <div className="pl-drawer-error" data-testid="object-detail-table-not-found">
        <strong>{TABLE_NOT_FOUND_TITLE}</strong>
        <p className="mt-2 notranslate" translate="no">
          未在 <code className="notranslate" translate="no">{target.schema}.{target.table}</code>{" "}
          找到对应的 semantic 资产。<span className="notranslate" translate="no">Catalog</span> 加载失败时也会触发该状态。
        </p>
        {sourcesQuery.error ? (
          <pre className="mt-2">
            {sourcesQuery.error instanceof Error ? sourcesQuery.error.message : "未知错误"}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-3" data-testid="object-detail-table-body">
      <DetailRow label="Connection" value={match.conn} notranslate />
      <DetailRow label="Schema" value={match.schema} notranslate />
      <DetailRow label="Table" value={match.table} notranslate />
      <DetailRow label="字段数" value={`${match.columnCount}`} />
      <DetailRow label="指标" value={`${match.measureCount} 个`} />
      <DetailRow label="关联" value={`${match.joinCount} 个`} />
      <DetailRow label="业务 Wiki 引用" value={`${match.wikiRefCount} 处`} />
      <DetailRow label="完成度" value={match.completion} />
      <DetailRow label="最近修改" value={new Date(match.mtime).toLocaleString("zh-CN")} />
      <DetailRow label="文件路径" value={match.filePath} notranslate />
    </div>
  );
}

type AgentTarget = Extract<NonNullable<ReturnType<typeof parseObjectDetailSearch>>, { kind: "agent" }>;

function AgentDetailBody({ target }: { target: AgentTarget }) {
  const agentsQuery = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents")
  });
  const match: Agent | undefined = (agentsQuery.data?.agents ?? []).find(
    (agent: Agent) => agent.id === target.agentId
  );
  if (agentsQuery.isLoading) {
    return <p className="pl-notice">加载中…</p>;
  }
  if (!match) {
    return (
      <div className="pl-drawer-error" data-testid="object-detail-agent-not-found">
        <strong>{AGENT_NOT_FOUND_TITLE}</strong>
        <p className="mt-2 notranslate" translate="no">
          Agent <code className="notranslate" translate="no">{target.agentId}</code> 不在 <code className="notranslate" translate="no">access.yaml</code> 中。
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-3" data-testid="object-detail-agent-body">
      <DetailRow label="显示名" value={match.name} />
      <DetailRow label="Role" value={match.role ?? "旧 ACL"} notranslate />
      <DetailRow label="状态" value={match.enabled ? "启用" : "禁用"} />
      <DetailRow label="Token 数" value={`${match.tokens.length}`} />
      <DetailRow label="近 7 天调用" value={`${match.stats?.callsLast7d ?? 0}`} />
      <DetailRow label="近 7 天拒绝" value={`${match.stats?.deniedLast7d ?? 0}`} />
      {match.note ? <DetailRow label="备注" value={match.note} /> : null}
    </div>
  );
}

type EvalRunTarget = Extract<NonNullable<ReturnType<typeof parseObjectDetailSearch>>, { kind: "evalRun" }>;

function EvalRunDetailBody({ target }: { target: EvalRunTarget }) {
  const runQuery = useQuery({
    queryKey: ["eval", "run", target.runId],
    queryFn: () => apiGet<EvalRunWithResults>(`/api/eval/runs/${target.runId}`),
    retry: false
  });
  if (runQuery.isLoading) {
    return <p className="pl-notice">加载中…</p>;
  }
  if (runQuery.error) {
    return (
      <div className="pl-drawer-error" data-testid="object-detail-run-not-found">
        <strong>{RUN_NOT_FOUND_TITLE}</strong>
        <p className="mt-2">
          Run <code className="notranslate" translate="no">#{target.runId}</code> 拉取失败。
        </p>
        <pre className="mt-2">
          {runQuery.error instanceof Error ? runQuery.error.message : "未知错误"}
        </pre>
      </div>
    );
  }
  const run = runQuery.data as EvalRun | undefined;
  if (!run) {
    return (
      <div className="pl-drawer-error" data-testid="object-detail-run-not-found">
        <strong>{RUN_NOT_FOUND_TITLE}</strong>
        <p className="mt-2">
          Run <code className="notranslate" translate="no">#{target.runId}</code> 不存在。
        </p>
      </div>
    );
  }
  const failed = (runQuery.data?.results ?? []).filter((r) => r.status === "FAIL").slice(0, 5);
  return (
    <div className="grid gap-3" data-testid="object-detail-run-body">
      <DetailRow label="Domain" value={run.domain} notranslate />
      <DetailRow label="状态" value={run.status} />
      <DetailRow label="通过率" value={`${run.passCount}/${run.totalCases}`} />
      <DetailRow label="触发原因" value={run.triggerReason ?? "—"} />
      <DetailRow label="开始时间" value={new Date(run.startedAt).toLocaleString("zh-CN")} />
      {run.finishedAt ? (
        <DetailRow label="结束时间" value={new Date(run.finishedAt).toLocaleString("zh-CN")} />
      ) : null}
      {failed.length > 0 ? (
        <div className="grid gap-1">
          <span className="pl-eyebrow">最近失败 Case</span>
          <ul className="grid gap-1 text-sm">
            {failed.map((item) => (
              <li key={item.caseId} className="notranslate" translate="no">
                {item.caseId} — {item.failedAssertions?.join(", ") ?? item.errorMessage ?? "未给出原因"}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

type AuditEventTarget = Extract<NonNullable<ReturnType<typeof parseObjectDetailSearch>>, { kind: "auditEvent" }>;

function AuditEventDetailBody({
  target,
  initialEntry
}: {
  target: AuditEventTarget;
  initialEntry?: AuditLogEntry;
}) {
  // We still attempt a fetch in case the entry is missing from the
  // current page slice — but we now prefer the caller-provided
  // `initialEntry` (M36 review follow-up) so the drawer does not flash
  // an "未找到" error when the user is on a paginated or filtered audit
  // page.
  const auditQuery = useQuery({
    queryKey: ["admin", "audit", "drawer", target.eventId],
    queryFn: () => apiGet<AuditResponse>("/api/admin/audit?limit=200"),
    retry: false,
    enabled: !initialEntry || initialEntry.id !== target.eventId
  });
  const fetchedEntry: AuditLogEntry | undefined = (auditQuery.data?.entries ?? []).find(
    (item) => item.id === target.eventId
  );
  const entry: AuditLogEntry | undefined = initialEntry && initialEntry.id === target.eventId
    ? initialEntry
    : fetchedEntry;
  if (!entry) {
    return (
      <div className="pl-drawer-error" data-testid="object-detail-audit-not-found">
        <strong>{EVENT_NOT_FOUND_TITLE}</strong>
        <p className="mt-2 notranslate" translate="no">
          审计事件 <code className="notranslate" translate="no">#{target.eventId}</code> 不在当前查询结果中。
        </p>
        {auditQuery.error ? (
          <pre className="mt-2">
            {auditQuery.error instanceof Error ? auditQuery.error.message : "未知错误"}
          </pre>
        ) : null}
      </div>
    );
  }
  return (
    <div className="grid gap-3" data-testid="object-detail-audit-body">
      <DetailRow label="时间" value={new Date(entry.ts).toLocaleString("zh-CN")} />
      <DetailRow label="用户" value={entry.userId} notranslate />
      <DetailRow label="工具" value={entry.tool} notranslate />
      <DetailRow label="状态" value={entry.outcome} />
      <DetailRow label="裁决原因" value={entry.decisionReason ?? "—"} />
      <DetailRow label="耗时" value={`${entry.durationMs}ms`} />
      <DetailRow label="关联表" value={entry.tables?.join(", ") ?? "—"} notranslate />
      <DetailRow label="请求 ID" value={String(entry.requestId)} notranslate />
    </div>
  );
}

function DetailRow({
  label,
  value,
  notranslate
}: {
  label: string;
  value: string;
  notranslate?: boolean;
}) {
  return (
    <div className="grid grid-cols-[120px_minmax(0,1fr)] items-baseline gap-3">
      <span className="text-xs font-semibold tracking-wider text-fg-muted uppercase">{label}</span>
      <span className={notranslate ? "notranslate text-sm text-fg-default" : "text-sm text-fg-default"} translate={notranslate ? "no" : undefined}>
        {value}
      </span>
    </div>
  );
}

/**
 * Re-export the helpers that pages use to build drawer-opening links. The
 * drawer itself is mounted once in `AppFrame`; callers only need to
 * generate the search string.
 */
export { buildObjectDetailSearch };
