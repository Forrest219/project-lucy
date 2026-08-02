import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import type { Agent, AgentsResponseSummary, CreateAgentBody, ProjectInfo, Role } from "../../lib/types";
import { buildMcpConfig } from "../../lib/mcpEndpoint";
import { PageHeader } from "../../components/PageHeader";

type AgentsResponse = {
  agents: Agent[];
  version: string;
  /** Optional server-side aggregate; absent on backends pre-dating M55. */
  summary?: AgentsResponseSummary;
};
type RolesResponse = { roles: Role[] };

/**
 * Placeholder token marker used in the safe .mcp.json template.
 * Replaced by the user with their real LUCY_AGENT_TOKEN; we never embed
 * a real token or hash in the safe template.
 */
export const SAFE_MCP_TOKEN_PLACEHOLDER = "${LUCY_AGENT_TOKEN}";

/**
 * Format a lastSeen timestamp as a relative label (e.g. "10 分钟前").
 * The full ISO/local timestamp is returned as `title` for hover tooltip
 * and accessibility consumers that need the absolute time.
 */
export function formatLastSeen(lastSeen?: string | null): { label: string; title: string | undefined } {
  if (!lastSeen) {
    return { label: "未访问", title: undefined };
  }
  const date = new Date(lastSeen);
  if (Number.isNaN(date.getTime())) {
    return { label: "未访问", title: undefined };
  }
  const diffMs = Date.now() - date.getTime();
  const future = diffMs < 0;
  const absMs = Math.abs(diffMs);
  const sec = Math.floor(absMs / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  let label: string;
  if (sec < 45) label = future ? "即将" : "刚刚";
  else if (min < 60) label = `${min} 分钟前`;
  else if (hr < 24) label = `${hr} 小时前`;
  else if (day < 30) label = `${day} 天前`;
  else label = date.toLocaleDateString("zh-CN");

  if (future && min >= 1) label = `${min} 分钟后`;

  return {
    label,
    title: date.toLocaleString("zh-CN")
  };
}

/**
 * Build a safe .mcp.json snippet for a given endpoint.
 * The snippet uses ${LUCY_AGENT_TOKEN} as a placeholder and never
 * embeds a real token or hash, so it can be safely shared.
 */
export function buildSafeMcpConfig(endpoint: string): string {
  return buildMcpConfig(endpoint, SAFE_MCP_TOKEN_PLACEHOLDER);
}

/**
 * Configuration-side token count for an agent: tokens still present
 * in `access.yaml`, regardless of expiry. Mirrors `Agent.tokens.length`
 * and is also surfaced via `AgentStats.configuredTokens` from M55+.
 */
export function configuredTokenCount(agent: Pick<Agent, "tokens">): number {
  return agent.tokens.length;
}

/**
 * Whether a token's `last_used` timestamp falls inside the look-back
 * window relative to `now`. Used as a fallback when the backend does
 * not yet emit `stats.activeTokensLast7d` (older Lucy deployments).
 */
export function isTokenRecentlyActive(token: Agent["tokens"][number], now: Date = new Date()): boolean {
  if (!token.last_used) return false;
  const ts = new Date(token.last_used);
  if (Number.isNaN(ts.getTime())) return false;
  const diff = now.getTime() - ts.getTime();
  return diff >= 0 && diff <= 7 * 24 * 60 * 60 * 1000;
}

/**
 * Number of distinct, recently active tokens belonging to an agent.
 *
 * Prefers the backend-supplied `stats.activeTokensLast7d` (a denormalized
 * `COUNT(DISTINCT token_hash_prefix)` against `access_log` for the last
 * 7 days, scoped to this user_id). Falls back to `last_used` based
 * counting for backends that pre-date M55 and do not emit the metric.
 *
 * The `now` parameter exists so tests can inject a deterministic clock
 * without reaching into `Date.now` directly.
 */
export function activeTokenCount(agent: Agent, now: Date = new Date()): number {
  const backend = agent.stats?.activeTokensLast7d;
  if (typeof backend === "number") return backend;
  return agent.tokens.filter((token) => isTokenRecentlyActive(token, now)).length;
}

/**
 * Aggregate metrics for the AgentList page. Mirrors the optional
 * `summary` field returned by `GET /api/admin/agents` and also acts
 * as the client-side fallback when the backend has not yet shipped
 * the field. Exposed for tests.
 */
export function summarizeAgents(
  agents: Agent[],
  now: Date = new Date()
): AgentsResponseSummary {
  let enabledAgentCount = 0;
  let configuredTokens = 0;
  let activeTokenCountLast7d = 0;
  let callsLast7d = 0;
  let deniedLast7d = 0;
  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    configuredTokens += configuredTokenCount(agent);
    activeTokenCountLast7d += activeTokenCount(agent, now);
    callsLast7d += agent.stats?.callsLast7d ?? 0;
    deniedLast7d += agent.stats?.deniedLast7d ?? 0;
  }
  return {
    agentCount: agents.length,
    enabledAgentCount,
    configuredTokenCount: configuredTokens,
    activeTokenCountLast7d,
    callsLast7d,
    deniedLast7d
  };
}

async function copyAgentMcpConfig(endpoint: string | null): Promise<void> {
  if (!endpoint) {
    toast.error("Lucy MCP endpoint 不可用，无法复制 MCP 配置");
    return;
  }
  const snippet = buildSafeMcpConfig(endpoint);
  await navigator.clipboard.writeText(snippet);
  toast.success("MCP 配置已复制");
}

function MetricCard({ label, value, hint, testId }: { label: string; value: string | number; hint: string; testId?: string }) {
  return (
    <div className="pl-metric-card" data-testid={testId}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function LastSeen({ lastSeen }: { lastSeen?: string | null }) {
  const { label, title } = formatLastSeen(lastSeen);
  if (!title) {
    return <span className="text-fg-muted">{label}</span>;
  }
  return (
    <span title={title} aria-label={`最近访问：${title}`}>
      {label}
    </span>
  );
}

function AgentCard({ agent, endpoint, onViewLogs }: { agent: Agent; endpoint: string | null; onViewLogs: () => void }) {
  const legacyWildcard = agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");
  const canCopyMcp = endpoint !== null;
  const callsLast7d = agent.stats?.callsLast7d ?? 0;
  const deniedLast7d = agent.stats?.deniedLast7d ?? 0;
  const activeTokens = activeTokenCount(agent);
  const configuredTokens = configuredTokenCount(agent);
  const authorizedSourceCount =
    agent.effectivePermissions?.sources.length ?? agent.allow?.tables?.length ?? 0;
  const authorizedResourceLabel = agent.effectivePermissions
    ? `${agent.effectivePermissions.sources.length} 个源 / ${agent.effectivePermissions.connections.length} 个 connection`
    : legacyWildcard
      ? "legacy wildcard"
      : `${authorizedSourceCount} 个源`;

  return (
    <div className="pl-card" data-testid={`agent-card-${agent.id}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="text-fg-muted text-sm notranslate" translate="no">({agent.id})</span>
            <span className={`pl-status-badge ${agent.enabled ? "pl-status-done" : "pl-status-not_started"}`}>
              {agent.enabled ? "启用" : "禁用"}
            </span>
          </div>
          <div className="text-sm text-fg-muted mt-1" data-testid={`agent-role-line-${agent.id}`}>
            {agent.role ? (
              <>
                <span>角色：</span>
                <Link
                  to={`/admin/roles/${encodeURIComponent(agent.role)}`}
                  className="text-accent hover:underline notranslate"
                  translate="no"
                  aria-label={`查看角色 ${agent.role}`}
                  data-testid={`agent-role-link-${agent.id}`}
                >
                  {agent.role}
                </Link>
                {!legacyWildcard && (
                  <span className="ml-2">· {authorizedResourceLabel}</span>
                )}
                {legacyWildcard && <span className="ml-2">· legacy wildcard</span>}
              </>
            ) : (
              <span className="notranslate" translate="no">旧 ACL · legacy wildcard</span>
            )}
          </div>
          <div
            className="text-sm text-fg-muted mt-0.5"
            data-testid={`agent-usage-row-${agent.id}`}
          >
            最近访问 <LastSeen lastSeen={agent.stats?.lastSeen} />
            <span className="ml-1">·</span>
            <span className="ml-1" data-testid={`agent-calls-7d-${agent.id}`}>
              近 7 天 {callsLast7d} 次调用
            </span>
            <span className="ml-1">·</span>
            <span
              className="ml-1 notranslate"
              translate="no"
              data-testid={`agent-active-tokens-${agent.id}`}
            >
              {activeTokens} 个活跃 Token
            </span>
            <span className="ml-1">·</span>
            <span
              className={`ml-1 ${deniedLast7d > 0 ? "text-warning-strong" : ""}`}
              data-testid={`agent-denied-7d-${agent.id}`}
            >
              {deniedLast7d} 次拒绝
            </span>
          </div>
          <div
            className="text-sm text-fg-muted mt-0.5 notranslate"
            translate="no"
            data-testid={`agent-config-row-${agent.id}`}
          >
            配置 Token：{configuredTokens} 个
            <span className="ml-3">
              <Link
                to={`/admin/agents/${encodeURIComponent(agent.id)}?tab=permissions`}
                className="text-accent hover:underline"
                aria-label={`查看 ${agent.name} 的权限`}
                data-testid={`agent-permissions-link-${agent.id}`}
              >
                查看权限
              </Link>
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex gap-2">
            <Link
              to={buildObjectDetailSearch({ kind: "agent", agentId: agent.id })}
              className="pl-btn pl-btn--ghost text-sm notranslate"
              translate="no"
              aria-label={`查看 ${agent.name} 的对象详情`}
              data-testid={`agent-row-detail-${agent.id}`}
            >
              查看详情
            </Link>
            <Link to={`/admin/agents/${agent.id}`} className="pl-btn pl-btn--ghost text-sm">编辑</Link>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm notranslate"
              translate="no"
              onClick={() => {
                void copyAgentMcpConfig(endpoint);
              }}
              aria-label={`复制 ${agent.name} 的 MCP 配置`}
              disabled={!canCopyMcp}
              title={canCopyMcp ? undefined : "Lucy MCP endpoint 不可用"}
            >
              📋 复制 <span className="notranslate" translate="no">MCP</span> 配置
            </button>
            <button type="button" onClick={onViewLogs} className="pl-btn pl-btn--ghost text-sm">查看日志</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RoleSummaryCard({ role }: { role: Role | undefined }) {
  if (!role) {
    return (
      <div className="rounded-md border border-border-default bg-bg-base p-3 text-xs text-fg-muted">
        请选择一个角色查看权限预览
      </div>
    );
  }
  return (
    <div
      className={`grid gap-2 rounded-md border p-3 text-sm ${
        role.invalid ? "border-danger-strong bg-danger-soft" : "border-border-default bg-bg-base"
      }`}
      data-testid="role-summary-card"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold tracking-wider text-fg-muted uppercase">角色权限预览</span>
        <span className="pl-status-badge pl-status-done notranslate" translate="no">
          {role.id}
        </span>
        {role.source && (
          <span className="pl-status-badge pl-status-partial">
            {role.source === "template" ? "参考模板" : "正式 Role"}
          </span>
        )}
        {role.invalid && (
          <span className="pl-status-badge pl-status-validation_failed">待修复</span>
        )}
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-fg-muted">数据源</span>
        <strong>{role.sourceCount} 个授权 source</strong>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-fg-muted">Connections</span>
        <div className="flex flex-wrap gap-1.5">
          {role.connections.length === 0 ? (
            <span className="text-xs text-fg-muted">—</span>
          ) : (
            role.connections.map((conn) => (
              <span key={conn} className="pl-status-badge pl-status-included">
                {conn}
              </span>
            ))
          )}
        </div>
      </div>
      <div className="grid gap-1">
        <span className="text-xs text-fg-muted"><span className="notranslate" translate="no">MCP</span> 工具</span>
        <div className="flex flex-wrap gap-1.5">
          {role.tools.length === 0 ? (
            <span className="text-xs text-fg-muted">—</span>
          ) : (
            role.tools.map((tool) => (
              <span key={tool} className="pl-status-badge pl-status-included">
                {tool}
              </span>
            ))
          )}
        </div>
      </div>
      {role.description && <p className="text-xs text-fg-muted">{role.description}</p>}
      {role.warnings.length > 0 && (
        <ul className="grid gap-1 text-xs text-warning-strong">
          {role.warnings.map((w, idx) => (
            <li key={idx} className="grid gap-0.5">
              <span>
                ⚠{" "}
                {w.startsWith("role_resolution_failed")
                  ? "权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。"
                  : "权限配置需检查：系统返回了未识别的校验信息。"}
              </span>
              <span className="text-fg-muted">
                技术详情：{" "}
                <code
                  className="notranslate rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px]"
                  translate="no"
                >
                  {w}
                </code>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NewAgentModal({ roles, onClose, onCreated }: { roles: Role[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState(roles.find((item) => !item.invalid)?.id ?? roles[0]?.id ?? "");
  const [preview, setPreview] = useState<{ diff: string; proposedYaml: string } | null>(null);
  const [step, setStep] = useState<"form" | "diff">("form");

  const previewMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; agent: CreateAgentBody }) => apiPost<{ diff: string; proposedYaml: string }>("/api/admin/agents", body),
    onSuccess: (data) => {
      setPreview(data);
      setStep("diff");
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const saveMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; agent: CreateAgentBody }) => apiPost<{ written: boolean; agent: Agent }>("/api/admin/agents", body),
    onSuccess: (data) => {
      toast.success(`Agent ${data.agent.name} 已创建`);
      onCreated(data.agent.id);
    },
    onError: (err: Error) => toast.error(err.message)
  });

  function buildAgent(): CreateAgentBody {
    return {
      id: id.trim(),
      name: name.trim(),
      note: note.trim() || undefined,
      role
    };
  }

  const selectedRole = roles.find((item) => item.id === role);
  const isInvalid = !!selectedRole?.invalid;
  const canSubmit = !!id.trim() && !!name.trim() && !!role && !isInvalid;

  function handlePreview() {
    if (!canSubmit) {
      toast.error("请先填写用户 ID、显示名，并选择一个有效角色");
      return;
    }
    previewMutation.mutate({ dryRun: true, agent: buildAgent() });
  }

  function handleSave() {
    saveMutation.mutate({ dryRun: false, agent: buildAgent() });
  }

  return (
    <div className="pl-modal-backdrop">
      <div className="pl-modal-panel">
        <h2 className="text-lg font-semibold mb-4">新建 <span className="notranslate" translate="no">Agent</span></h2>
        {step === "form" ? (
          <div className="grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-medium">用户 ID <span className="text-danger">*</span></span>
              <input className="pl-input" placeholder="例：wangwu" value={id} onChange={(e) => setId(e.target.value)} />
              <span className="text-xs text-fg-muted">1-32 位，仅 A-Z a-z 0-9 _ -</span>
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">显示名 <span className="text-danger">*</span></span>
              <input className="pl-input" placeholder="例：王五" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">备注</span>
              <input className="pl-input" placeholder="可选" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">角色 <span className="text-danger">*</span></span>
                <Link to="/admin/roles" className="text-xs text-accent hover:underline" aria-label="管理角色">
                  管理角色 →
                </Link>
              </div>
              <select className="pl-input" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.length === 0 && <option value="" disabled>暂无可用角色</option>}
                {roles.map((item) => {
                  const tags: string[] = [];
                  if (item.source === "template") tags.push("参考模板");
                  if (item.invalid) tags.push("待修复");
                  const suffix = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
                  return (
                    <option key={item.id} value={item.id} disabled={item.invalid}>
                      {item.id}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              {roles.length === 0 && (
                <span className="text-xs text-warning-strong">
                  还没有可用角色。请先创建角色。
                  <Link to="/admin/roles/new" className="ml-2 pl-btn pl-btn--secondary text-xs">
                    创建角色
                  </Link>
                </span>
              )}
            </label>
            <RoleSummaryCard role={selectedRole} />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>取消</button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={handlePreview} disabled={!canSubmit || previewMutation.isPending}>
                {previewMutation.isPending ? "生成中…" : "下一步：预览配置"}
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-fg-muted notranslate" translate="no">以下改动将写入 access.yaml：</p>
            <pre className="pl-diff-viewer text-xs max-h-64 overflow-auto">
              {preview?.diff}
            </pre>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setStep("form")}>返回编辑</button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "保存中…" : "确认创建"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEnabled, setFilterEnabled] = useState<"all" | "enabled" | "disabled">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents")
  });
  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles")
  });
  const { data: projectData } = useQuery({
    queryKey: queryKeys.project,
    queryFn: () => apiGet<ProjectInfo>("/api/project")
  });
  const mcpEndpointInfo = projectData?.mcpEndpoint;
  const mcpEndpoint = mcpEndpointInfo?.url ?? null;

  const agents = data?.agents ?? [];
  // Prefer the server-supplied aggregate when present, but always derive a
  // client-side fallback so legacy backends (pre-M55) keep rendering the
  // same metric grid without dropping the active-token column.
  const summary = data?.summary ?? summarizeAgents(agents);
  const enabledCount = summary.enabledAgentCount;
  const configuredTokenTotal = summary.configuredTokenCount;
  const activeTokenTotal = summary.activeTokenCountLast7d;
  const callsLast7dTotal = summary.callsLast7d;
  const deniedLast7dTotal = summary.deniedLast7d;
  const filtered = agents.filter((a) => {
    const matchSearch = !search || a.id.includes(search) || a.name.includes(search);
    const matchEnabled =
      filterEnabled === "all" ||
      (filterEnabled === "enabled" && a.enabled) ||
      (filterEnabled === "disabled" && !a.enabled);
    return matchSearch && matchEnabled;
  });

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error) return <div className="pl-notice">加载失败：{(error as Error).message}</div>;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="Agent 实例"
        description={
          <>
            配置每个 <span className="notranslate" translate="no">Agent</span> 实例能用哪些 <span className="notranslate" translate="no">MCP</span> 工具和访问哪些表。
          </>
        }
        badges={
          <>
            <span data-testid="badge-agent-total">{agents.length} 个 Agent</span>
            <span data-testid="badge-enabled-total">{enabledCount} 已启用</span>
            <span data-testid="badge-configured-token-total">{configuredTokenTotal} 配置 Token</span>
          </>
        }
        actions={
          <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建 Agent</button>
        }
      />

      <div className="pl-metric-grid" data-testid="agent-metric-grid">
        <MetricCard
          label="Agent 数"
          value={agents.length}
          hint="access.yaml 中的实例"
          testId="metric-agent-count"
        />
        <MetricCard
          label="活跃 Token"
          value={activeTokenTotal}
          hint="近 7 天访问日志中出现过的去重 token"
          testId="metric-active-tokens"
        />
        <MetricCard
          label="近 7 天调用"
          value={callsLast7dTotal}
          hint="来自访问日志 access_log"
          testId="metric-calls-last-7d"
        />
        <MetricCard
          label="近 7 天拒绝"
          value={deniedLast7dTotal}
          hint="访问日志 access_log 中 outcome=denied"
          testId="metric-denied-last-7d"
        />
      </div>

      {mcpEndpointInfo?.status === "invalid" || projectData === undefined ? (
        <div className={mcpEndpointInfo?.status === "invalid" ? "pl-error" : "pl-notice"} data-testid="mcp-endpoint-diagnostic">
          {mcpEndpointInfo?.diagnostics.length
            ? mcpEndpointInfo.diagnostics.map((d, i) => <div key={`${d.code}-${i}`}>{d.message}</div>)
            : "Lucy MCP endpoint 正在加载；加载完成前无法复制 MCP 配置。"}
        </div>
      ) : null}

      <div className="pl-admin-filterbar">
        <input
          className="pl-input flex-1"
          placeholder="按用户 id / 名称搜索"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="pl-input w-32"
          value={filterEnabled}
          onChange={(e) => setFilterEnabled(e.target.value as "all" | "enabled" | "disabled")}
        >
          <option value="all">全部</option>
          <option value="enabled">已启用</option>
          <option value="disabled">已禁用</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="pl-notice">
          {agents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">还没有任何 <span className="notranslate" translate="no">Agent</span>。创建第一个 <span className="notranslate" translate="no">Agent</span> 以开始管理访问权限。</p>
              <button type="button" className="pl-btn pl-btn--primary notranslate" translate="no" onClick={() => setShowNew(true)}>新建第一个 <span className="notranslate" translate="no">Agent</span></button>
            </div>
          ) : "没有匹配的 Agent"}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              endpoint={mcpEndpoint}
              onViewLogs={() => navigate(`/admin/audit?user=${agent.id}`)}
            />
          ))}
        </div>
      )}

      {showNew && (
        <NewAgentModal
          roles={rolesData?.roles ?? []}
          onClose={() => setShowNew(false)}
          onCreated={(id) => {
            setShowNew(false);
            void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
            navigate(`/admin/agents/${id}?tab=tokens`);
          }}
        />
      )}
    </div>
  );
}
