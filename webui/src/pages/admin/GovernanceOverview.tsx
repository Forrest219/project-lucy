import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";

type OverviewResponse = {
  windowHours: number;
  localAdminNotice: string;
  cards: Record<string, number | string>;
};

type AgentRow = {
  id: string;
  name: string;
  enabled: boolean;
  roleId: string | null;
  calls: number;
  denied: number;
  deniedRate: number;
  p95LatencyMs: number;
  lastSeen: string | null;
  activeTokenCount: number;
  configuredTokenCount: number;
  topDeniedReason: string | null;
  auditHref: string;
  agentHref: string;
};

type RoleRow = {
  id: string;
  description: string;
  sourceCount: number;
  toolCount: number;
  usageCount: number;
  status: string;
  flags: string[];
};

type TokenRow = {
  agentId: string;
  label: string;
  tokenHashPrefix: string | null;
  lastUsed: string | null;
  stale: boolean;
  auditHref: string;
};

type DenialResponse = {
  reasonCounts: Array<{ reason: string; count: number }>;
  topTools: Array<{ tool: string; count: number }>;
  topSources: Array<{ source: string; count: number }>;
};

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="pl-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "ok" ? "pl-status-done" :
    status === "sensitive" ? "pl-status-partial" :
    status === "over_broad" ? "pl-status-partial" :
    "pl-status-validation_failed";
  const label =
    status === "ok" ? "正常" :
    status === "sensitive" ? "敏感范围" :
    status === "over_broad" ? "范围过宽" :
    "待修复";
  return <span className={`pl-status-badge ${cls}`}>{label}</span>;
}

function formatTime(value: string | null): string {
  if (!value) return "未访问";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未访问";
  return date.toLocaleString("zh-CN");
}

export function GovernanceOverview() {
  const hours = 168;
  const { data: overview } = useQuery({
    queryKey: ["admin", "governance", "overview", hours],
    queryFn: () => apiGet<OverviewResponse>(`/api/admin/governance/overview?hours=${hours}`)
  });
  const { data: agentsData } = useQuery({
    queryKey: ["admin", "governance", "agents", hours],
    queryFn: () => apiGet<{ agents: AgentRow[] }>(`/api/admin/governance/agents?hours=${hours}`)
  });
  const { data: rolesData } = useQuery({
    queryKey: ["admin", "governance", "roles", hours],
    queryFn: () => apiGet<{ roles: RoleRow[] }>(`/api/admin/governance/roles?hours=${hours}`)
  });
  const { data: tokensData } = useQuery({
    queryKey: ["admin", "governance", "tokens", hours],
    queryFn: () => apiGet<{ tokens: TokenRow[] }>(`/api/admin/governance/tokens?hours=${hours}`)
  });
  const { data: denialsData } = useQuery({
    queryKey: ["admin", "governance", "denials", hours],
    queryFn: () => apiGet<DenialResponse>(`/api/admin/governance/denials?hours=${hours}`)
  });

  const cards = overview?.cards ?? {};
  const agents = agentsData?.agents ?? [];
  const roles = rolesData?.roles ?? [];
  const tokens = tokensData?.tokens ?? [];
  const reasons = denialsData?.reasonCounts ?? [];

  return (
    <div className="p-6">
      <PageHeader
        title="治理概览"
        breadcrumbs={["访问治理", "治理概览"]}
        description="按 Agent、Role、Token 与拒绝原因查看企业级访问治理状态。"
        badges={<span className="pl-status-badge pl-status-partial">{hours} 小时窗口</span>}
      />

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4">
        <MetricCard label="调用量" value={cards.calls ?? 0} hint="近窗口 MCP 调用" />
        <MetricCard label="拒绝率" value={`${cards.deniedRate ?? 0}%`} hint={`${cards.denied ?? 0} 次拒绝`} />
        <MetricCard label="P95 延迟" value={`${cards.p95LatencyMs ?? 0} ms`} hint="只展示聚合延迟" />
        <MetricCard label="活跃 Token" value={cards.activeTokenCount ?? 0} hint={`${cards.staleTokenCount ?? 0} 个未活跃`} />
        <MetricCard label="高拒绝 Agent" value={cards.highDenialAgentCount ?? 0} hint="拒绝率 >= 50%" />
        <MetricCard label="待修复 Role" value={cards.brokenRoleCount ?? 0} hint="缺工具或数据范围" />
        <MetricCard label="范围过宽 Role" value={cards.overBroadRoleCount ?? 0} hint="包含 wildcard 授权" />
        <MetricCard label="配置变更" value={cards.configChangeCount ?? 0} hint="审计窗口内变更" />
      </div>

      <div className="mt-4 rounded-md border border-border-default bg-bg-subtle px-4 py-3 text-sm text-fg-muted">
        {overview?.localAdminNotice ?? "local-admin mode"}
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold notranslate" translate="no">Agent 风险排行</h2>
        <div className="overflow-x-auto rounded-md border border-border-default">
          <table className="min-w-full divide-y divide-border-default text-sm">
            <thead className="bg-bg-subtle text-left text-fg-muted">
              <tr>
                <th className="px-3 py-2 notranslate" translate="no">Agent</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">调用</th>
                <th className="px-3 py-2">拒绝率</th>
                <th className="px-3 py-2 notranslate" translate="no">Token</th>
                <th className="px-3 py-2">最近访问</th>
                <th className="px-3 py-2">动作</th>
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
                  <td className="px-3 py-2 notranslate" translate="no">{agent.roleId ?? "legacy"}</td>
                  <td className="px-3 py-2">{agent.calls}</td>
                  <td className="px-3 py-2">{agent.deniedRate}%</td>
                  <td className="px-3 py-2">{agent.activeTokenCount} / {agent.configuredTokenCount}</td>
                  <td className="px-3 py-2">{formatTime(agent.lastSeen)}</td>
                  <td className="px-3 py-2">
                    <Link className="text-accent hover:underline" to={agent.auditHref}>查看日志</Link>
                  </td>
                </tr>
              ))}
              {agents.length === 0 ? (
                <tr><td className="px-3 py-6 text-center text-fg-muted notranslate" translate="no" colSpan={7}>暂无 Agent 数据</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-base font-semibold">Role 边界</h2>
          <div className="grid gap-2">
            {roles.map((role) => (
              <div className="rounded-md border border-border-default bg-bg-surface p-3" key={role.id}>
                <div className="flex items-center justify-between gap-3">
                  <span className="font-medium notranslate" translate="no">{role.id}</span>
                  <StatusBadge status={role.status} />
                </div>
                <div className="mt-1 text-sm text-fg-muted">{role.sourceCount} 个源 / {role.toolCount} 个工具 / {role.usageCount} 次引用</div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold">拒绝原因</h2>
          <div className="grid gap-2">
            {reasons.slice(0, 8).map((reason) => (
              <div className="flex items-center justify-between rounded-md border border-border-default bg-bg-surface px-3 py-2 text-sm" key={reason.reason}>
                <span className="notranslate" translate="no">{reason.reason}</span>
                <strong>{reason.count}</strong>
              </div>
            ))}
            {reasons.length === 0 ? <div className="rounded-md border border-border-default bg-bg-surface p-6 text-center text-sm text-fg-muted">暂无拒绝事件</div> : null}
          </div>
        </section>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-base font-semibold notranslate" translate="no">Token 巡检</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {tokens.map((token) => (
            <div className="rounded-md border border-border-default bg-bg-surface p-3 text-sm" key={`${token.agentId}-${token.label}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium notranslate" translate="no">{token.label}</span>
                <span className={`pl-status-badge ${token.stale ? "pl-status-partial" : "pl-status-done"}`}>
                  {token.stale ? "未活跃" : "活跃"}
                </span>
              </div>
              <div className="mt-1 text-fg-muted">
                <span className="notranslate" translate="no">{token.agentId}</span>
                <span> · prefix </span>
                <span className="notranslate" translate="no">{token.tokenHashPrefix ?? "unknown"}</span>
                <span> · {formatTime(token.lastUsed)}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
