import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";

type UsageOverview = {
  agentCount: number;
  activeAgentCount: number;
  agentActiveRate: number;
  configuredTokenCount: number;
  activeTokenCount: number;
  tokenActiveRate: number;
  configuredTableCount: number;
  activeTableCount: number;
  hasOpenEndedTableScope: boolean;
  calls: number;
  p95LatencyMs: number;
  avgLatencyMs: number;
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

function MetricCard({
  label,
  value,
  subline,
  hint,
  testId
}: {
  label: ReactNode;
  value: string | number;
  subline?: ReactNode;
  hint?: ReactNode;
  testId?: string;
}) {
  return (
    <div className="pl-metric-card" data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subline ? <small>{subline}</small> : null}
      {hint ? <small>{hint}</small> : null}
    </div>
  );
}

function formatRate(value: number): string {
  return `${value}%`;
}

function windowLabel(hours: WindowHours): string {
  return hours === 24 ? "近 24 小时" : "近 7 天";
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
          return (
            <li className="pl-usage-rank-row" key={row.key}>
              <div className="pl-usage-rank-label">{row.label}</div>
              <div className="pl-usage-rank-value tabular-nums">{row.calls}</div>
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

  const { data: overview } = useQuery({
    queryKey: ["admin", "governance", "overview", hours],
    queryFn: () => apiGet<OverviewResponse>(`/api/admin/governance/overview?hours=${hours}`)
  });
  const { data: agentsData } = useQuery({
    queryKey: ["admin", "governance", "agents", hours],
    queryFn: () => apiGet<{ agents: AgentRow[] }>(`/api/admin/governance/agents?hours=${hours}`)
  });
  const { data: tokensData } = useQuery({
    queryKey: ["admin", "governance", "tokens", hours],
    queryFn: () => apiGet<{ tokens: TokenRow[] }>(`/api/admin/governance/tokens?hours=${hours}`)
  });

  const usage = overview?.usageOverview;
  const popularTables = overview?.popularTables ?? [];
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
  const p95Value = (usage?.calls ?? 0) > 0 ? `${usage?.p95LatencyMs ?? 0} ms` : "—";
  const p95Hint = (usage?.calls ?? 0) > 0 ? (
    <span>95% 的请求在此时间内完成（<span className="notranslate" translate="no">P95</span>）</span>
  ) : (
    "当前窗口无调用"
  );
  const authorizedTableHint = (
    <span>角色权限中已明确授权的表{usage?.hasOpenEndedTableScope ? "（含前缀授权）" : ""}</span>
  );
  const activeTableRate = usage
    ? usage.configuredTableCount > 0
      ? formatRate(Math.round((usage.activeTableCount / usage.configuredTableCount) * 1000) / 10)
      : formatRate(0)
    : formatRate(0);

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
    label: (
      <span className="notranslate" translate="no">
        {row.table}
      </span>
    )
  }));

  return (
    <div className="pl-page-stack" data-testid="governance-usage-overview">
      <PageHeader
        title="使用概况"
        description={
          <span>
            查看 <span className="notranslate" translate="no">Agent</span> / <span className="notranslate" translate="no">Token</span> 与表的访问使用情况。
          </span>
        }
        actions={
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
        }
      />

      <div className="pl-metric-grid" data-testid="governance-usage-metrics">
        <MetricCard
          label={<span><span className="notranslate" translate="no">Agent</span> 总数</span>}
          value={usage?.agentCount ?? 0}
          hint="已配置实例（含未启用）"
          testId="metric-agent-count"
        />
        <MetricCard
          label={<span>{windowText}活跃 <span className="notranslate" translate="no">Agent</span></span>}
          value={usage?.activeAgentCount ?? 0}
          subline={<span>活跃率 {formatRate(usage?.agentActiveRate ?? 0)} · 共 {usage?.agentCount ?? 0} 个</span>}
          testId="metric-active-agent-count"
        />
        <MetricCard
          label={<span>配置 <span className="notranslate" translate="no">Token</span></span>}
          value={usage?.configuredTokenCount ?? 0}
          hint="已下发凭证（含未启用 Agent）"
          testId="metric-configured-token-count"
        />
        <MetricCard
          label={<span>{windowText}活跃 <span className="notranslate" translate="no">Token</span></span>}
          value={usage?.activeTokenCount ?? 0}
          subline={<span>活跃率 {formatRate(usage?.tokenActiveRate ?? 0)} · 共 {usage?.configuredTokenCount ?? 0} 个</span>}
          testId="metric-active-token-count"
        />
        <MetricCard
          label="授权表"
          value={usage?.configuredTableCount ?? 0}
          hint={authorizedTableHint}
          testId="metric-configured-table-count"
        />
        <MetricCard
          label={<span>{windowText}活跃表</span>}
          value={usage?.activeTableCount ?? 0}
          subline={<span>活跃率 {activeTableRate}</span>}
          testId="metric-active-table-count"
        />
        <MetricCard
          label={<span>{windowText}调用量</span>}
          value={usage?.calls ?? 0}
          hint={<span><span className="notranslate" translate="no">MCP</span> 调用</span>}
          testId="metric-calls"
        />
        <MetricCard
          label="多数请求耗时"
          value={p95Value}
          hint={p95Hint}
          testId="metric-p95-latency"
        />
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
