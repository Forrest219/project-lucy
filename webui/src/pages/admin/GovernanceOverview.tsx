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
  calls: number;
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
  activeInLast7d: boolean;
  configured: boolean;
  auditHref: string;
};

type WindowHours = 24 | 168;

function MetricCard({
  label,
  value,
  hint,
  testId
}: {
  label: ReactNode;
  value: string | number;
  hint: ReactNode;
  testId?: string;
}) {
  return (
    <div className="pl-metric-card" data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
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
  return hours === 24 ? "24 小时" : "7 天";
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
    return rows;
  }, [agentsData?.agents]);
  const tokens = useMemo(() => {
    const rows = [...(tokensData?.tokens ?? [])];
    rows.sort((a, b) => (b.lastUsed ?? "").localeCompare(a.lastUsed ?? ""));
    return rows;
  }, [tokensData?.tokens]);

  return (
    <div className="pl-page-stack" data-testid="governance-usage-overview">
      <PageHeader
        title="治理概览"
        description={
          <>
            查看 <span className="notranslate" translate="no">Agent</span> / <span className="notranslate" translate="no">Token</span> 使用与调用概况。
          </>
        }
        badges={
          <span className="pl-status-badge pl-status-partial" data-testid="governance-window-badge">
            {windowLabel(hours)}窗口
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
            <Link className="pl-btn pl-btn--secondary text-sm" to="/admin/audit">
              访问日志
            </Link>
          </div>
        }
      />

      <div className="pl-metric-grid" data-testid="governance-usage-metrics">
        <MetricCard
          label={<><span className="notranslate" translate="no">Agent</span> 总数</>}
          value={usage?.agentCount ?? 0}
          hint={<><span className="notranslate" translate="no">access.yaml</span> 中的实例</>}
          testId="metric-agent-count"
        />
        <MetricCard
          label={<>最近活跃 <span className="notranslate" translate="no">Agent</span></>}
          value={usage?.activeAgentCount ?? 0}
          hint="近 7 天有调用"
          testId="metric-active-agent-count"
        />
        <MetricCard
          label={<><span className="notranslate" translate="no">Agent</span> 活跃率</>}
          value={formatRate(usage?.agentActiveRate ?? 0)}
          hint={<>最近活跃 / 总 <span className="notranslate" translate="no">Agent</span></>}
          testId="metric-agent-active-rate"
        />
        <MetricCard
          label={<>配置 <span className="notranslate" translate="no">Token</span></>}
          value={usage?.configuredTokenCount ?? 0}
          hint={<><span className="notranslate" translate="no">access.yaml</span> 配置数</>}
          testId="metric-configured-token-count"
        />
        <MetricCard
          label={<>近 7 天活跃 <span className="notranslate" translate="no">Token</span></>}
          value={usage?.activeTokenCount ?? 0}
          hint={<><span className="notranslate" translate="no">access_log</span> 去重 prefix</>}
          testId="metric-active-token-count"
        />
        <MetricCard
          label={<><span className="notranslate" translate="no">Token</span> 活跃率</>}
          value={formatRate(usage?.tokenActiveRate ?? 0)}
          hint="活跃 / 配置"
          testId="metric-token-active-rate"
        />
        <MetricCard
          label="调用量"
          value={usage?.calls ?? 0}
          hint={<>{windowLabel(hours)} <span className="notranslate" translate="no">MCP</span> 调用</>}
          testId="metric-calls"
        />
        <MetricCard
          label="平均响应时长"
          value={`${usage?.avgLatencyMs ?? 0} ms`}
          hint={<>{windowLabel(hours)} AVG(<span className="notranslate" translate="no">duration_ms</span>)</>}
          testId="metric-avg-latency"
        />
      </div>

      <section className="pl-panel" data-testid="governance-agent-usage">
        <div className="pl-section-heading">
          <div>
            <h2 className="pl-panel-title notranslate" translate="no">Agent 使用排行</h2>
            <p className="pl-notice">
              按近窗口调用量排序；活跃 <span className="notranslate" translate="no">Token</span> 固定近 7 天口径。
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="min-w-full divide-y divide-border-default text-sm">
            <thead className="bg-bg-subtle text-left text-fg-muted">
              <tr>
                <th className="px-3 py-2 notranslate" translate="no">Agent</th>
                <th className="px-3 py-2">最近访问</th>
                <th className="px-3 py-2">近窗口调用</th>
                <th className="px-3 py-2">平均响应时长</th>
                <th className="px-3 py-2 notranslate" translate="no">活跃 Token</th>
                <th className="px-3 py-2 notranslate" translate="no">配置 Token</th>
                <th className="px-3 py-2">审计</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default bg-bg-surface">
              {agents.map((agent) => (
                <tr key={agent.id}>
                  <td className="px-3 py-2">
                    <Link className="text-accent hover:underline notranslate" translate="no" to={agent.agentHref}>
                      {agent.name || agent.id}
                    </Link>
                    <div className="text-xs text-fg-muted notranslate" translate="no">{agent.id}</div>
                  </td>
                  <td className="px-3 py-2">{formatTime(agent.lastSeen)}</td>
                  <td className="px-3 py-2">{agent.calls}</td>
                  <td className="px-3 py-2">{agent.avgLatencyMs} ms</td>
                  <td className="px-3 py-2">{agent.activeTokenCount}</td>
                  <td className="px-3 py-2">{agent.configuredTokenCount}</td>
                  <td className="px-3 py-2">
                    <Link className="text-accent hover:underline" to={agent.auditHref}>查看日志</Link>
                  </td>
                </tr>
              ))}
              {agents.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-fg-muted" colSpan={7}>
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
            <p className="pl-notice">按最近访问排序；活跃判定固定近 7 天，不重复展示顶部 KPI。</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="min-w-full divide-y divide-border-default text-sm">
            <thead className="bg-bg-subtle text-left text-fg-muted">
              <tr>
                <th className="px-3 py-2 notranslate" translate="no">Token</th>
                <th className="px-3 py-2 notranslate" translate="no">Agent</th>
                <th className="px-3 py-2">最近访问</th>
                <th className="px-3 py-2">最近活跃</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default bg-bg-surface">
              {tokens.map((token) => (
                <tr key={`${token.agentId}-${token.label}-${token.tokenHashPrefix ?? "none"}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium notranslate" translate="no">{token.label}</span>
                    <div className="text-xs text-fg-muted notranslate" translate="no">
                      {token.tokenHashPrefix ?? "unknown"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      className="text-accent hover:underline notranslate"
                      translate="no"
                      to={`/admin/agents/${encodeURIComponent(token.agentId)}`}
                    >
                      {token.agentId}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{formatTime(token.lastUsed)}</td>
                  <td className="px-3 py-2">
                    <span className={`pl-status-badge ${token.activeInLast7d ? "pl-status-done" : "pl-status-partial"}`}>
                      {token.activeInLast7d ? "活跃" : "未活跃"}
                    </span>
                  </td>
                </tr>
              ))}
              {tokens.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-fg-muted" colSpan={4}>
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
            <p className="pl-notice">近 7 天按调用次数排序；口径优先 <span className="notranslate" translate="no">access_log_sources</span>。</p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="min-w-full divide-y divide-border-default text-sm">
            <thead className="bg-bg-subtle text-left text-fg-muted">
              <tr>
                <th className="px-3 py-2">表名</th>
                <th className="px-3 py-2">调用次数</th>
                <th className="px-3 py-2">最近访问</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-default bg-bg-surface">
              {popularTables.map((row) => (
                <tr key={row.table}>
                  <td className="px-3 py-2 notranslate" translate="no">{row.table}</td>
                  <td className="px-3 py-2">{row.calls}</td>
                  <td className="px-3 py-2">{formatTime(row.lastSeen)}</td>
                </tr>
              ))}
              {popularTables.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-fg-muted" colSpan={3}>
                    暂无表访问数据（近 7 天）
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
