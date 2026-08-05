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
  activeInWindow: boolean;
  configured: boolean;
  auditHref: string;
};

type WindowHours = 24 | 168;

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
  hint: ReactNode;
  testId?: string;
}) {
  return (
    <div className="pl-metric-card" data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
      {subline ? <small>{subline}</small> : null}
      <small>{hint}</small>
    </div>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "未访问";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未访问";
  return date.toLocaleString("zh-CN");
}

function formatRate(value: number): string {
  return `${value}%`;
}

function windowLabel(hours: WindowHours): string {
  return hours === 24 ? "近 24 小时" : "近 7 天";
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
  const tableStatsSource = overview?.tableStatsSource;
  const agents = useMemo(() => {
    const rows = [...(agentsData?.agents ?? [])];
    rows.sort((a, b) => {
      if (b.calls !== a.calls) return b.calls - a.calls;
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });
    return rows;
  }, [agentsData?.agents]);
  const tokens = useMemo(() => {
    const rows = [...(tokensData?.tokens ?? [])];
    rows.sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""));
    return rows;
  }, [tokensData?.tokens]);

  const windowText = windowLabel(hours);
  const p95Value = (usage?.calls ?? 0) > 0 ? `${usage?.p95LatencyMs ?? 0} ms` : "—";
  const p95Hint = (usage?.calls ?? 0) > 0 ? "95% 的访问低于此值" : "当前窗口无调用";
  const activeTableRate = usage
    ? usage.configuredTableCount > 0
      ? formatRate(Math.round((usage.activeTableCount / usage.configuredTableCount) * 1000) / 10)
      : formatRate(0)
    : formatRate(0);

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
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex overflow-hidden rounded-md border border-border-default" role="group" aria-label="时间窗口">
              <button
                type="button"
                className={`pl-btn text-sm ${hours === 24 ? "pl-btn--primary" : "pl-btn--secondary"}`}
                aria-pressed={hours === 24}
                data-testid="governance-window-24h"
                onClick={() => setHours(24)}
              >
                24 小时
              </button>
              <button
                type="button"
                className={`pl-btn text-sm ${hours === 168 ? "pl-btn--primary" : "pl-btn--secondary"}`}
                aria-pressed={hours === 168}
                data-testid="governance-window-7d"
                onClick={() => setHours(168)}
              >
                7 天
              </button>
            </div>
            <Link className="pl-btn pl-btn--secondary text-sm" to="/admin/roles">
              管理角色
            </Link>
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
          label={<span>活跃 <span className="notranslate" translate="no">Agent</span></span>}
          value={usage?.activeAgentCount ?? 0}
          subline={<span>活跃率 {formatRate(usage?.agentActiveRate ?? 0)} · 共 {usage?.agentCount ?? 0} 个</span>}
          hint={<span>{windowText}有调用</span>}
          testId="metric-active-agent-count"
        />
        <MetricCard
          label={<span>配置 <span className="notranslate" translate="no">Token</span></span>}
          value={usage?.configuredTokenCount ?? 0}
          hint="已下发凭证（含未启用 Agent）"
          testId="metric-configured-token-count"
        />
        <MetricCard
          label={<span>活跃 <span className="notranslate" translate="no">Token</span></span>}
          value={usage?.activeTokenCount ?? 0}
          subline={<span>活跃率 {formatRate(usage?.tokenActiveRate ?? 0)} · 共 {usage?.configuredTokenCount ?? 0} 个</span>}
          hint={<span>{windowText}有使用</span>}
          testId="metric-active-token-count"
        />
        <MetricCard
          label="配置表"
          value={usage?.configuredTableCount ?? 0}
          hint={<span>角色已授权{usage?.hasOpenEndedTableScope ? "（含前缀授权）" : ""}</span>}
          testId="metric-configured-table-count"
        />
        <MetricCard
          label="活跃表"
          value={usage?.activeTableCount ?? 0}
          subline={<span>活跃率 {activeTableRate}</span>}
          hint={<span>{windowText}有访问</span>}
          testId="metric-active-table-count"
        />
        <MetricCard
          label="调用量"
          value={usage?.calls ?? 0}
          hint={<span>{windowText} <span className="notranslate" translate="no">MCP</span> 调用</span>}
          testId="metric-calls"
        />
        <MetricCard
          label={<span>响应上限（<span className="notranslate" translate="no">P95</span>）</span>}
          value={p95Value}
          hint={p95Hint}
          testId="metric-p95-latency"
        />
      </div>

      <section className="pl-panel" data-testid="governance-agent-usage">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">Agent 使用排行</h2>
            <p className="pl-notice">
              按近窗口调用量排序；活跃 <span className="notranslate" translate="no">Token</span> 与顶部窗口一致。
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table
            className="pl-data-grid pl-data-table pl-usage-overview-table"
            data-testid="governance-agent-table"
          >
            <thead>
              <tr>
                <th className="notranslate" translate="no">Agent</th>
                <th>最近访问</th>
                <th>近窗口调用</th>
                <th>平均响应时长</th>
                <th className="notranslate" translate="no">活跃 Token</th>
                <th className="notranslate" translate="no">配置 Token</th>
                <th>审计</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td>
                    <div className="pl-usage-overview-table-name">
                      <Link
                        className="pl-usage-overview-table-name-link notranslate"
                        translate="no"
                        to={agent.agentHref}
                      >
                        {agent.name || agent.id}
                      </Link>
                      <span className="pl-usage-overview-table-meta notranslate" translate="no">
                        {agent.id}
                      </span>
                    </div>
                  </td>
                  <td>{formatTime(agent.lastSeen)}</td>
                  <td className="pl-usage-overview-table-num">{agent.calls}</td>
                  <td className="pl-usage-overview-table-num">{agent.avgLatencyMs} ms</td>
                  <td className="pl-usage-overview-table-num">{agent.activeTokenCount}</td>
                  <td className="pl-usage-overview-table-num">{agent.configuredTokenCount}</td>
                  <td>
                    <Link className="pl-row-action-link" to={agent.auditHref}>
                      查看日志
                    </Link>
                  </td>
                </tr>
              ))}
              {agents.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-fg-muted" colSpan={7}>
                    暂无 <span className="notranslate" translate="no">Agent</span> 数据
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pl-panel" data-testid="governance-token-usage">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">Token 使用摘要</h2>
            <p className="pl-notice">按最近访问排序；不重复展示顶部 KPI。</p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table
            className="pl-data-grid pl-data-table pl-usage-overview-table"
            data-testid="governance-token-table"
          >
            <thead>
              <tr>
                <th className="notranslate" translate="no">Token</th>
                <th className="notranslate" translate="no">Agent</th>
                <th>最近访问</th>
                <th>窗口内活跃</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((token) => (
                <tr key={`${token.agentId}-${token.label}-${token.tokenHashPrefix ?? "none"}`}>
                  <td>
                    <div className="pl-usage-overview-table-name">
                      <span className="notranslate" translate="no">{token.label}</span>
                      <span className="pl-usage-overview-table-meta notranslate" translate="no">
                        {token.tokenHashPrefix ?? "unknown"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <Link
                      className="pl-usage-overview-table-name-link notranslate"
                      translate="no"
                      to={`/admin/agents/${encodeURIComponent(token.agentId)}`}
                    >
                      {token.agentId}
                    </Link>
                  </td>
                  <td>{formatTime(token.lastUsed)}</td>
                  <td>
                    <span className={`pl-status-badge ${token.activeInWindow ? "pl-status-done" : "pl-status-partial"}`}>
                      {token.activeInWindow ? "活跃" : "未活跃"}
                    </span>
                  </td>
                </tr>
              ))}
              {tokens.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-fg-muted" colSpan={4}>
                    暂无 <span className="notranslate" translate="no">Token</span> 配置
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="pl-panel" data-testid="governance-popular-tables">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title">最受访问表（Top 10）</h2>
            <p className="pl-notice">
              {windowText}按调用次数排序。
              {tableStatsSource === "access_log_sources" ? "仅统计已结构化访问记录。" : ""}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table
            className="pl-data-grid pl-data-table pl-usage-overview-table"
            data-testid="governance-popular-tables-table"
          >
            <thead>
              <tr>
                <th>表名</th>
                <th>调用次数</th>
                <th>最近访问</th>
              </tr>
            </thead>
            <tbody>
              {popularTables.map((row) => (
                <tr key={row.table}>
                  <td className="notranslate" translate="no">{row.table}</td>
                  <td className="pl-usage-overview-table-num">{row.calls}</td>
                  <td>{formatTime(row.lastSeen)}</td>
                </tr>
              ))}
              {popularTables.length === 0 ? (
                <tr>
                  <td className="py-6 text-center text-fg-muted" colSpan={3}>
                    暂无表访问数据（{windowText}）
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
