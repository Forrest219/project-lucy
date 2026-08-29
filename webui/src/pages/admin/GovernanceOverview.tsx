import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import * as Tooltip from "@radix-ui/react-tooltip";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";

type UsageOverview = {
  agentCount: number;
  activeAgentCount: number | null;
  agentActiveRate: number | null;
  agentActiveRatePartial?: boolean;
  configuredTokenCount: number;
  activeTokenCount: number | null;
  tokenActiveRate: number | null;
  tokenActiveRatePartial?: boolean;
  tokenPrefixAmbiguous?: boolean;
  configuredTableCount: number;
  activeTableCount: number | null;
  hasOpenEndedTableScope: boolean;
  tableRate?: number | null;
  tableRatePartial?: boolean;
  calls: number | null;
  denied?: number | null;
  p95LatencyMs: number | null;
  avgLatencyMs: number | null;
  metricsState?: "ok" | "unavailable";
};

type PopularTable = {
  table: string;
  calls: number;
  lastSeen: string | null;
};

type OverviewResponse = {
  windowHours: number;
  localAdminNotice?: string;
  usageOverview: UsageOverview;
  popularTables: PopularTable[];
  tableStatsSource?: "access_log_sources" | "access_log.tables";
  cards?: Record<string, number | string>;
};

type AgentRow = {
  id: string;
  name: string;
  enabled: boolean;
  roleId: string | null;
  calls: number;
  avgLatencyMs: number;
  lastSeen: string | null;
  activeTokenCount: number;
  configuredTokenCount: number;
  auditHref: string;
  agentHref: string;
};

type TokenRow = {
  agentId: string;
  label: string;
  tokenHashPrefix: string | null;
  lastUsed: string | null;
  calls: number;
  activeInWindow: boolean;
  configured: boolean;
  auditHref: string;
};

type WindowHours = 24 | 168;

const RANK_LIMIT = 10;

function formatRate(value: number): string {
  return `${value}%`;
}

function windowLabel(hours: WindowHours): string {
  return hours === 24 ? "近 24 小时" : "近 7 天";
}

/** Relative/absolute label aligned with `/overview` freshness badge. */
function formatStatsTimeLabel(statsAt: Date | null, now: Date): string {
  if (!statsAt) return "未知";
  const diffMs = now.getTime() - statsAt.getTime();
  if (diffMs < 5_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} 秒前`;
  if (diffMs < 15 * 60_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(statsAt.getHours())}:${pad(statsAt.getMinutes())}:${pad(statsAt.getSeconds())}`;
}

function TableNameLabel({ table }: { table: string }) {
  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={0}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <span className="notranslate block truncate" translate="no" title={table}>
            {table}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            className="rounded bg-fg-default px-2 py-1 text-xs text-bg-base shadow-card max-w-xs break-all"
            sideOffset={4}
          >
            {table}
            <Tooltip.Arrow className="fill-fg-default" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

function RankingBarList({
  rows,
  emptyLabel,
  testId
}: {
  rows: Array<{ key: string; label: ReactNode; calls: number }>;
  emptyLabel: ReactNode;
  testId: string;
}) {
  const maxCalls = rows.reduce((max, row) => Math.max(max, row.calls), 0);
  const totalCalls = rows.reduce((sum, row) => sum + row.calls, 0);
  if (rows.length === 0 || maxCalls <= 0) {
    return (
      <div className="pl-usage-rank-body" data-testid={`${testId}-body`}>
        <p className="pl-usage-rank-empty" data-testid={testId}>
          {emptyLabel}
        </p>
      </div>
    );
  }
  return (
    <div className="pl-usage-rank-body" data-testid={`${testId}-body`}>
      <ul className="pl-usage-rank-list" data-testid={testId}>
        {rows.map((row) => {
          const widthPct = Math.max(4, Math.round((row.calls / maxCalls) * 100));
          const sharePct = totalCalls > 0 ? Math.round((row.calls / totalCalls) * 100) : 0;
          return (
            <li className="pl-usage-rank-row" key={row.key}>
              <div className="pl-usage-rank-label">{row.label}</div>
              <div className="pl-usage-rank-value tabular-nums">
                {row.calls}
                {totalCalls > 0 ? <span className="text-fg-muted"> ({sharePct}%)</span> : null}
              </div>
              <div className="pl-usage-rank-track" aria-hidden="true">
                <div className="pl-usage-rank-bar" style={{ width: `${widthPct}%` }} />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function GovernanceOverview() {
  const [hours, setHours] = useState<WindowHours>(168);
  const [now, setNow] = useState(() => new Date());

  const overviewQuery = useQuery({
    queryKey: ["admin", "governance", "overview", hours],
    queryFn: () => apiGet<OverviewResponse>(`/api/admin/governance/overview?hours=${hours}`)
  });
  const agentsQuery = useQuery({
    queryKey: ["admin", "governance", "agents", hours],
    queryFn: () => apiGet<{ agents: AgentRow[] }>(`/api/admin/governance/agents?hours=${hours}`)
  });
  const tokensQuery = useQuery({
    queryKey: ["admin", "governance", "tokens", hours],
    queryFn: () => apiGet<{ tokens: TokenRow[] }>(`/api/admin/governance/tokens?hours=${hours}`)
  });

  const overview = overviewQuery.data;
  const agentsData = agentsQuery.data;
  const tokensData = tokensQuery.data;

  const statsReady =
    overviewQuery.isSuccess && agentsQuery.isSuccess && tokensQuery.isSuccess;
  const statsUpdatedAtMs = statsReady
    ? Math.max(
        overviewQuery.dataUpdatedAt,
        agentsQuery.dataUpdatedAt,
        tokensQuery.dataUpdatedAt
      )
    : 0;
  const statsAt = statsUpdatedAtMs > 0 ? new Date(statsUpdatedAtMs) : null;

  useEffect(() => {
    if (statsUpdatedAtMs <= 0) return;
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, [statsUpdatedAtMs]);

  const statsTimeLabel = formatStatsTimeLabel(statsAt, now);

  const usage = overview?.usageOverview;
  const popularTables = overview?.popularTables ?? [];

  // Spec 128 HR-1: unavailable when server reports metricsState=unavailable
  const auditMetricsState = usage?.metricsState === "unavailable" ? "unavailable" as const : "ok" as const;

  const agents = useMemo(() => {
    const rows = [...(agentsData?.agents ?? [])];
    rows.sort((a, b) => {
      if (b.calls !== a.calls) return b.calls - a.calls;
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });
    return rows.filter((row) => row.calls > 0).slice(0, RANK_LIMIT);
  }, [agentsData?.agents]);
  const tokens = useMemo(() => {
    const rows = [...(tokensData?.tokens ?? [])];
    rows.sort((a, b) => {
      if ((b.calls ?? 0) !== (a.calls ?? 0)) return (b.calls ?? 0) - (a.calls ?? 0);
      return (b.lastUsed ?? "").localeCompare(a.lastUsed ?? "");
    });
    return rows.filter((row) => (row.calls ?? 0) > 0).slice(0, RANK_LIMIT);
  }, [tokensData?.tokens]);
  const tables = useMemo(
    () => popularTables.filter((row) => row.calls > 0).slice(0, RANK_LIMIT),
    [popularTables]
  );

  const windowText = windowLabel(hours);

  // p95 is unavailable or no_data based on calls
  const p95MetricState = auditMetricsState === "unavailable"
    ? "unavailable" as const
    : ((usage?.calls ?? 0) > 0 ? "ok" as const : "no_data" as const);
  const p95Value = p95MetricState === "ok" ? `${usage?.p95LatencyMs ?? 0} ms` : "—";
  const p95Hint = p95MetricState === "ok" ? (
    <span>95% 的请求在此时间内完成（<span className="notranslate" translate="no">P95</span>）</span>
  ) : (
    "当前窗口无调用"
  );

  // Spec 128 HR-4 + Task 6: table rate is partial when open-ended scope or HR-4 violation.
  const tableRateState = auditMetricsState === "unavailable"
    ? "unavailable" as const
    : usage?.tableRatePartial
      ? "partial" as const
      : ((usage?.calls ?? 0) === 0 && (usage?.activeTableCount ?? 0) === 0 ? "no_data" as const : "ok" as const);
  const activeTableRate = tableRateState === "ok" && usage?.tableRate != null
    ? formatRate(usage.tableRate)
    : null;

  // Spec 128 HR-4: partial when active > configured
  const agentRateState = usage?.agentActiveRatePartial ? "partial" as const : auditMetricsState;
  // Spec 128 D4: partial when token prefixes are ambiguous
  const tokenRateState = (usage?.tokenActiveRatePartial || usage?.tokenPrefixAmbiguous) ? "partial" as const : auditMetricsState;

  // Spec 128 Task 7: denied count from audit DB, exposed in usageOverview.
  const deniedCount = usage?.denied ?? null;
  const deniedState = auditMetricsState;
  const deniedTone = (deniedCount ?? 0) > 0 ? "warning" as const : undefined;

  // Compound card values for Tier 2
  const agentCompoundValue = auditMetricsState !== "unavailable" ? (
    <span className="tabular-nums">
      <span className="text-fg-muted text-base font-normal">活跃 </span>
      <span>{usage?.activeAgentCount ?? 0}</span>
      <span className="text-fg-muted text-base font-normal"> / {usage?.agentCount ?? 0}</span>
    </span>
  ) : 0;

  const tokenCompoundValue = auditMetricsState !== "unavailable" ? (
    <span className="tabular-nums">
      <span className="text-fg-muted text-base font-normal">活跃 </span>
      <span>{usage?.activeTokenCount ?? 0}</span>
      <span className="text-fg-muted text-base font-normal"> / {usage?.configuredTokenCount ?? 0}</span>
    </span>
  ) : 0;

  const tableCompoundValue = auditMetricsState !== "unavailable" ? (
    <span className="tabular-nums">
      <span className="text-fg-muted text-base font-normal">活跃 </span>
      <span>{usage?.activeTableCount ?? 0}</span>
      <span className="text-fg-muted text-base font-normal"> / {usage?.configuredTableCount ?? 0}</span>
    </span>
  ) : 0;

  const agentRankRows = agents.map((agent) => ({
    key: agent.id,
    calls: agent.calls,
    label: (
      <Link
        className="pl-usage-rank-link notranslate"
        translate="no"
        to={agent.agentHref}
      >
        {agent.name || agent.id}
      </Link>
    )
  }));
  const tokenRankRows = tokens.map((token) => ({
    key: `${token.agentId}-${token.label}-${token.tokenHashPrefix ?? "none"}`,
    calls: token.calls ?? 0,
    label: (
      <Link
        className="pl-usage-rank-link notranslate"
        translate="no"
        to={`/admin/agents/${encodeURIComponent(token.agentId)}`}
      >
        {token.label}
      </Link>
    )
  }));
  const tableRankRows = tables.map((row) => ({
    key: row.table,
    calls: row.calls,
    label: <TableNameLabel table={row.table} />
  }));

  return (
    <div className="pl-page-stack" data-testid="governance-usage-overview">
      <PageHeader
        title="使用概况"
        description={
          <span>
            查看 <span className="notranslate" translate="no">Agent</span>、<span className="notranslate" translate="no">Token</span> 和数据表的活跃度、调用量与响应耗时。
          </span>
        }
        actions={
          <div
            className="flex items-center gap-3"
            data-testid="governance-stats-time-controls"
          >
            <span
              className="text-xs text-fg-muted whitespace-nowrap"
              data-testid="governance-stats-time"
              aria-hidden="true"
            >
              统计时间：{statsTimeLabel}
            </span>
            <div
              className="pl-segmented-control pl-segmented-control--cols-2"
              role="tablist"
              aria-label="时间窗口"
            >
              <button
                type="button"
                role="tab"
                className={hours === 24 ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
                aria-selected={hours === 24}
                data-testid="governance-window-24h"
                onClick={() => setHours(24)}
              >
                24 小时
              </button>
              <button
                type="button"
                role="tab"
                className={hours === 168 ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
                aria-selected={hours === 168}
                data-testid="governance-window-7d"
                onClick={() => setHours(168)}
              >
                7 天
              </button>
            </div>
          </div>
        }
      />

      <div className="pl-usage-metric-groups" data-testid="governance-usage-metrics">
        {/* ── Tier 1: 运行体征（Primary） ── */}
        <div
          className="pl-metric-grid pl-metric-grid--three"
          aria-label="运行体征"
          data-testid="governance-usage-metrics-primary"
        >
          <MetricCard
            label={<span>{windowText}调用量</span>}
            labelText={`${windowText}调用量`}
            value={usage?.calls ?? 0}
            help={`当前时间窗（${windowText}）内经 MCP Proxy 记录的所有调用次数（含成功、拒绝、错误）。`}
            subValue={auditMetricsState === "ok" ? <span><span className="notranslate" translate="no">MCP</span> 调用</span> : undefined}
            state={auditMetricsState}
            helpId="calls"
            testId="metric-calls"
          />
          <MetricCard
            label={<span>{windowText} <span className="notranslate" translate="no">ACL</span> 拒绝次数</span>}
            labelText={`${windowText} ACL 拒绝次数`}
            value={deniedCount ?? 0}
            tone={deniedTone}
            help={
              <span>
                当前时间窗内访问日志中 <span className="notranslate" translate="no">outcome='denied'</span> 的记录数，直接查询审计库（Task 7），不含认证失败（<span className="notranslate" translate="no">auth_error</span>）。
              </span>
            }
            subValue={deniedState === "ok" ? <span>来自审计库直查</span> : undefined}
            state={deniedState}
            helpId="acl-denied"
            testId="metric-acl-denied"
          />
          <MetricCard
            label="多数请求耗时"
            value={p95Value}
            help="当前时间窗内 95% 的请求完成耗时上限（P95），用于感知尾部延迟。"
            subValue={p95MetricState === "ok" ? p95Hint : undefined}
            state={p95MetricState}
            helpId="p95-latency"
            testId="metric-p95-latency"
          />
        </div>

        {/* ── Tier 2: 资产与活跃画像（Secondary Compound） ── */}
        <div
          className="pl-metric-grid pl-metric-grid--three"
          aria-label="资产与活跃"
          data-testid="governance-usage-metrics-secondary"
        >
          <MetricCard
            label={<span><span className="notranslate" translate="no">Agent</span> 资产与活跃</span>}
            labelText="Agent 资产与活跃"
            value={agentCompoundValue}
            help={
              <span>
                {windowText}活跃 <span className="notranslate" translate="no">Agent</span> / 已配置 <span className="notranslate" translate="no">Agent</span> 总数（含未启用）。活跃率 = 有访问记录的 <span className="notranslate" translate="no">Agent</span> / 总数。
              </span>
            }
            subValue={agentRateState === "ok" ? <span>活跃率 {formatRate(usage?.agentActiveRate ?? 0)}</span> : undefined}
            state={agentRateState}
            unavailableReason={agentRateState === "partial" ? "活跃数超过配置数，数据异常" : undefined}
            helpId="agent-asset"
            testId="metric-agent-asset"
          />
          <MetricCard
            label={<span><span className="notranslate" translate="no">Token</span> 凭证与活跃</span>}
            labelText="Token 凭证与活跃"
            value={tokenCompoundValue}
            help={
              <span>
                {windowText}活跃 <span className="notranslate" translate="no">Token</span> / 已下发凭证总数（含未启用 <span className="notranslate" translate="no">Agent</span> 的 <span className="notranslate" translate="no">Token</span>）。D4：若多个 <span className="notranslate" translate="no">Token</span> 共享同一前缀，计数存在歧义（<span className="notranslate" translate="no">partial</span>）。
              </span>
            }
            subValue={tokenRateState === "ok" ? <span>活跃率 {formatRate(usage?.tokenActiveRate ?? 0)}</span> : undefined}
            state={tokenRateState}
            unavailableReason={
              tokenRateState === "partial"
                ? (usage?.tokenPrefixAmbiguous ? "配置 Token 前缀存在冲突（D4），计数存在歧义" : "活跃 Token 数超过配置数，数据异常")
                : undefined
            }
            helpId="token-asset"
            testId="metric-token-asset"
          />
          <MetricCard
            label="授权表与活跃"
            labelText="授权表与活跃"
            value={tableCompoundValue}
            help={
              <span>
                {windowText}活跃授权表数 / 角色权限中明确授权的表数。活跃率 = 活跃授权表 / 已解析授权表；存在前缀授权时显示 <span className="notranslate" translate="no">partial</span>（口径未完全解析）。{usage?.hasOpenEndedTableScope ? "（含前缀授权）" : ""}
              </span>
            }
            subValue={tableRateState === "ok" && activeTableRate != null
              ? <span>活跃率 {activeTableRate}</span>
              : undefined}
            state={tableRateState}
            unavailableReason={tableRateState === "partial" ? "含前缀/通配符授权，活跃率无法精确计算" : undefined}
            helpId="table-asset"
            testId="metric-table-asset"
          />
        </div>
      </div>

      <div className="pl-usage-rank-grid" data-testid="governance-usage-rank-grid">
        <section className="pl-panel" data-testid="governance-agent-usage">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title">
                <span className="notranslate" translate="no">Agent</span> 调用排行 · {windowText}
              </h2>
              <p className="pl-notice">
                看哪些 <span className="notranslate" translate="no">Agent</span> 调用最多，便于发现主力与闲置。
              </p>
            </div>
          </div>
          <RankingBarList
            rows={agentRankRows}
            emptyLabel={<span>{windowText}暂无调用</span>}
            testId="governance-agent-rank"
          />
        </section>

        <section className="pl-panel" data-testid="governance-token-usage">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title">
                <span className="notranslate" translate="no">Token</span> 调用排行 · {windowText}
              </h2>
              <p className="pl-notice">
                看哪些 <span className="notranslate" translate="no">Token</span> 调用最多，便于回收闲置凭证。
              </p>
            </div>
          </div>
          <RankingBarList
            rows={tokenRankRows}
            emptyLabel={<span>{windowText}暂无调用</span>}
            testId="governance-token-rank"
          />
        </section>

        <section className="pl-panel" data-testid="governance-popular-tables">
          <div className="pl-section-heading">
            <div>
              <h2 className="pl-panel-title">表调用排行 · {windowText}</h2>
              <p className="pl-notice">看哪些表被访问最多，便于评估授权与热度。</p>
            </div>
          </div>
          <RankingBarList
            rows={tableRankRows}
            emptyLabel={<span>{windowText}暂无调用</span>}
            testId="governance-table-rank"
          />
        </section>
      </div>
    </div>
  );
}
