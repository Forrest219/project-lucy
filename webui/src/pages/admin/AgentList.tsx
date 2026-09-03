import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, AgentsResponseSummary, CreateAgentBody, Role } from "../../lib/types";
import { buildMcpConfig } from "../../lib/mcpEndpoint";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import { RowMoreMenu } from "../../components/RowMoreMenu";
import { isLucyAdminDataPlaneRole } from "../../lib/lucyAdminRole";

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
  // null means unavailable; undefined means legacy backend (pre-M55) — use fallback
  if (typeof backend === "number") return backend;
  if (backend === null) return 0; // unavailable; caller checks metricsState separately
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
  let activeAgentCountLast7d = 0;
  let configuredTokens = 0;
  let activeTokenCountLast7d = 0;
  let callsLast7d = 0;
  let deniedLast7d = 0;
  let anyUnavailable = false;
  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    configuredTokens += configuredTokenCount(agent);
    if (agent.stats?.metricsState === "unavailable") {
      anyUnavailable = true;
      continue;
    }
    if ((agent.stats?.callsLast7d ?? 0) > 0) activeAgentCountLast7d += 1;
    activeTokenCountLast7d += activeTokenCount(agent, now);
    callsLast7d += agent.stats?.callsLast7d ?? 0;
    deniedLast7d += agent.stats?.deniedLast7d ?? 0;
  }
  if (anyUnavailable) {
    return {
      agentCount: agents.length,
      enabledAgentCount,
      activeAgentCountLast7d: null,
      configuredTokenCount: configuredTokens,
      activeTokenCountLast7d: null,
      callsLast7d: null,
      deniedLast7d: null,
      metricsState: "unavailable"
    };
  }
  return {
    agentCount: agents.length,
    enabledAgentCount,
    activeAgentCountLast7d,
    configuredTokenCount: configuredTokens,
    activeTokenCountLast7d,
    callsLast7d,
    deniedLast7d,
    metricsState: "ok"
  };
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
  const formalRoles = roles.filter((item) => item.source !== "template");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [role, setRole] = useState(formalRoles.find((item) => !item.invalid)?.id ?? formalRoles[0]?.id ?? "");
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

  const selectedRole = formalRoles.find((item) => item.id === role);
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
                {formalRoles.length === 0 && <option value="" disabled>暂无可用角色</option>}
                {formalRoles.map((item) => {
                  const suffix = item.invalid ? " · 待修复" : "";
                  return (
                    <option key={item.id} value={item.id} disabled={item.invalid}>
                      {item.id}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              {formalRoles.length === 0 && (
                <span className="text-xs text-warning-strong">
                  还没有可用角色。请先创建角色。
                  <Link to="/admin/roles/new" className="ml-2 pl-btn pl-btn--secondary text-xs">
                    创建角色
                  </Link>
                </span>
              )}
            </label>
            <RoleSummaryCard role={selectedRole} />
            {isLucyAdminDataPlaneRole(selectedRole) && (
              <div
                className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong"
                data-testid="agent-lucy-admin-role-warning"
              >
                高权限运维数据面：所选 Role 在已声明连接内绑定启用表目录。这是{" "}
                <span className="notranslate" translate="no">
                  MCP
                </span>{" "}
                数据面权限，不是 WebUI 登录账户；签发{" "}
                <span className="notranslate" translate="no">
                  Token
                </span>{" "}
                时建议设置过期时间。
              </div>
            )}
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
  const [filterRole, setFilterRole] = useState<"all" | "unbound" | string>("all");
  const [filterActivity, setFilterActivity] = useState<"all" | "active" | "inactive">("all");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "agents"],
    queryFn: () => apiGet<AgentsResponse>("/api/admin/agents")
  });
  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles", { includeTemplates: false }],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles?includeTemplates=false")
  });

  const agents = data?.agents ?? [];
  const summary = data?.summary ?? summarizeAgents(agents);
  // Spec 128 HR-1: metricsState=unavailable means null values; do not coerce to 0
  const auditMetricsState: "ok" | "unavailable" = summary.metricsState === "unavailable" ? "unavailable" : "ok";
  const activeAgentCountLast7d = summary.activeAgentCountLast7d ?? agents.filter((agent) => (agent.stats?.callsLast7d ?? 0) > 0).length;
  const activeTokenTotal = summary.activeTokenCountLast7d;
  const callsLast7dTotal = summary.callsLast7d;
  const isFilterActive = search !== "" || filterEnabled !== "all" || filterRole !== "all" || filterActivity !== "all";
  function clearFilters() {
    setSearch("");
    setFilterEnabled("all");
    setFilterRole("all");
    setFilterActivity("all");
  }

  const roleOptions = Array.from(
    new Set(agents.map((agent) => agent.role).filter((role): role is string => Boolean(role)))
  ).sort((a, b) => a.localeCompare(b, "zh-CN"));
  const filtered = agents.filter((a) => {
    const normalizedSearch = search.trim().toLowerCase();
    const matchSearch =
      !normalizedSearch ||
      a.id.toLowerCase().includes(normalizedSearch) ||
      a.name.toLowerCase().includes(normalizedSearch);
    const matchEnabled =
      filterEnabled === "all" ||
      (filterEnabled === "enabled" && a.enabled) ||
      (filterEnabled === "disabled" && !a.enabled);
    const matchRole =
      filterRole === "all" ||
      (filterRole === "unbound" ? !a.role : a.role === filterRole);
    const callsLast7d = a.stats?.callsLast7d ?? 0;
    const matchActivity =
      filterActivity === "all" ||
      (filterActivity === "active" && callsLast7d > 0) ||
      (filterActivity === "inactive" && callsLast7d === 0);
    return matchSearch && matchEnabled && matchRole && matchActivity;
  });

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error) return <div className="pl-notice">加载失败：{(error as Error).message}</div>;

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={<span className="notranslate" translate="no">Agent</span>}
        description={
          <>
            管理 <span className="notranslate" translate="no">Agent</span> 身份、角色、<span className="notranslate" translate="no">Token</span> 及数据访问边界。
          </>
        }
        actions={
          <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建 Agent</button>
        }
      />

      <div className="pl-metric-grid" data-testid="agent-metric-grid">
        {/* D1: config-class — always ok, reads directly from config response */}
        <MetricCard
          label={<span><span className="notranslate" translate="no">Agent</span> 总数</span>}
          labelText="Agent 总数"
          value={agents.length}
          help="统计 access 配置中已声明的全部 Agent 实例，含未启用。"
          subValue="已配置实例（含未启用）"
          helpId="agent-count"
          testId="metric-agent-count"
        />
        <MetricCard
          label={<span>近 7 天活跃 <span className="notranslate" translate="no">Agent</span></span>}
          labelText="近 7 天活跃 Agent"
          value={activeAgentCountLast7d ?? 0}
          help="近 7 天访问日志中至少出现过一次的去重 Agent 数。"
          subValue={auditMetricsState === "ok" ? "近 7 天有访问记录" : undefined}
          state={auditMetricsState}
          helpId="active-agent-count"
          testId="metric-active-agent-count"
        />
        <MetricCard
          label={
            <span>
              近 7 天活跃 <span className="notranslate" translate="no">Token</span>
            </span>
          }
          labelText="近 7 天活跃 Token"
          value={activeTokenTotal ?? 0}
          help="近 7 天访问日志中出现过的去重 Token 数，不代表配置 Token 总数。"
          subValue={auditMetricsState === "ok" ? "访问日志中去重 token" : undefined}
          state={auditMetricsState}
          helpId="active-token-count"
          testId="metric-active-token-count"
        />
        <MetricCard
          label="近 7 天调用量"
          value={callsLast7dTotal ?? 0}
          help="近 7 天经 MCP Proxy 记录的调用次数合计。"
          subValue={auditMetricsState === "ok" ? <span><span className="notranslate" translate="no">MCP</span> 调用</span> : undefined}
          state={auditMetricsState}
          helpId="calls"
          testId="metric-calls"
        />
      </div>

      <section className="pl-panel">
        <div className="pl-whitelist-toolbar" role="toolbar" aria-label="列表筛选">
          <div className="pl-whitelist-filter-area">
            <label className="grid gap-1.5 text-sm pl-whitelist-search">
              <span>搜索</span>
              <input
                className="pl-input pl-whitelist-search-input"
                placeholder="搜索显示名或用户 ID"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="搜索显示名或用户 ID"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>当前状态</span>
              <select
                className="pl-input pl-catalog-filter-select"
                value={filterEnabled}
                onChange={(e) => setFilterEnabled(e.target.value as "all" | "enabled" | "disabled")}
                aria-label="当前状态"
              >
                <option value="all">全部状态</option>
                <option value="enabled">已启用</option>
                <option value="disabled">已禁用</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>角色</span>
              <select
                className="pl-input pl-catalog-filter-select"
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value)}
                aria-label="角色"
              >
                <option value="all">全部角色</option>
                <option value="unbound">未绑定角色</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role} className="notranslate" translate="no">
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span>近 7 天活跃</span>
              <select
                className="pl-input pl-catalog-filter-select"
                value={filterActivity}
                onChange={(e) => setFilterActivity(e.target.value as "all" | "active" | "inactive")}
                aria-label="近 7 天活跃"
              >
                <option value="all">全部</option>
                <option value="active">有访问</option>
                <option value="inactive">无访问</option>
              </select>
            </label>
          </div>
          <div className="pl-whitelist-toolbar-actions">
            {isFilterActive && (
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={clearFilters}
                data-testid="clear-filters-btn"
              >
                清除筛选
              </button>
            )}
            <span className="pl-catalog-result-count" data-testid="agent-list-result-count">
              {filtered.length} 条结果
            </span>
          </div>
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="pl-notice">
          {agents.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">还没有任何 <span className="notranslate" translate="no">Agent</span>。创建第一个 <span className="notranslate" translate="no">Agent</span> 以开始管理访问权限。</p>
              <button type="button" className="pl-btn pl-btn--primary notranslate" translate="no" onClick={() => setShowNew(true)}>新建第一个 <span className="notranslate" translate="no">Agent</span></button>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-fg-muted mb-4">未找到符合条件的 <span className="notranslate" translate="no">Agent</span></p>
              <button type="button" className="pl-btn pl-btn--ghost" onClick={clearFilters} data-testid="clear-filters-btn-empty">清除筛选</button>
            </div>
          )}
        </div>
      ) : (
        <section
          className="pl-data-grid-frame"
          data-testid="agent-list-section"
        >
          <div className="pl-data-grid-scroll" data-testid="agent-list-grid-scroll">
            <table
              className="pl-data-grid pl-data-table pl-agent-list-table"
              data-testid="agent-list-table"
            >
              <thead>
                <tr>
                  <th scope="col">序号</th>
                  <th scope="col">显示名/用户 ID</th>
                  <th scope="col">角色</th>
                  <th scope="col">当前状态</th>
                  <th scope="col">
                    配置 <span className="notranslate" translate="no">Token</span>
                  </th>
                  <th scope="col">
                    近 7 天活跃 <span className="notranslate" translate="no">Token</span>
                  </th>
                  <th scope="col">近 7 天调用量</th>
                  <th scope="col">最近访问时间</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent, index) => {
                  const legacyWildcard =
                    agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");
                  const callsLast7d = agent.stats?.callsLast7d ?? 0;
                  const activeTokens = activeTokenCount(agent);
                  const configuredTokens = configuredTokenCount(agent);

                  return (
                    <tr key={agent.id} data-testid={`agent-row-${agent.id}`}>
                      <td className="pl-agent-list-table-num" data-testid={`agent-row-index-${agent.id}`}>{index + 1}</td>
                      <td>
                        <div className="pl-agent-list-table-name">
                          <Link
                            to={buildObjectDetailSearch({ kind: "agent", agentId: agent.id })}
                            className="font-medium pl-agent-list-table-name-link"
                            aria-label={`查看 ${agent.name} 的对象详情`}
                            data-testid={`agent-name-link-${agent.id}`}
                          >
                            {agent.name}
                          </Link>
                          <span className="pl-agent-list-table-meta notranslate" translate="no">
                            {agent.id}
                          </span>
                        </div>
                      </td>
                      <td data-testid={`agent-role-line-${agent.id}`}>
                        {agent.role ? (
                          <Link
                            to={`/admin/roles/${encodeURIComponent(agent.role)}`}
                            className="pl-agent-list-table-name-link notranslate"
                            translate="no"
                            aria-label={`查看角色 ${agent.role}`}
                            data-testid={`agent-role-link-${agent.id}`}
                          >
                            {agent.role}
                          </Link>
                        ) : (
                          <span className="text-fg-muted notranslate" translate="no">旧 ACL</span>
                        )}
                        {legacyWildcard && !agent.role && (
                          <span className="pl-agent-list-table-meta notranslate" translate="no">legacy wildcard</span>
                        )}
                      </td>
                      <td>
                        <span
                          className={`pl-status-badge ${agent.enabled ? "pl-status-done" : "pl-status-not_started"}`}
                        >
                          {agent.enabled ? "启用" : "禁用"}
                        </span>
                      </td>
                      <td className="pl-agent-list-table-num notranslate" translate="no">
                        {configuredTokens}
                      </td>
                      <td
                        className="pl-agent-list-table-num notranslate"
                        translate="no"
                        data-testid={`agent-active-tokens-${agent.id}`}
                      >
                        {activeTokens}
                      </td>
                      <td
                        className="pl-agent-list-table-num"
                        data-testid={`agent-calls-7d-${agent.id}`}
                      >
                        {callsLast7d}
                      </td>
                      <td>
                        <LastSeen lastSeen={agent.stats?.lastSeen} />
                      </td>
                      <td>
                        <div className="pl-agent-list-row-actions">
                          <Link
                            to={`/admin/agents/${agent.id}`}
                            className="pl-row-action-link"
                          >
                            编辑
                          </Link>
                          <RowMoreMenu
                            ariaLabel={`${agent.name} 更多操作`}
                            items={[
                              {
                                kind: "link",
                                label: "查看权限",
                                href: `/admin/agents/${encodeURIComponent(agent.id)}?tab=permissions`,
                                testId: `agent-permissions-link-${agent.id}`
                              },
                              {
                                kind: "action",
                                label: "查看日志",
                                onSelect: () => navigate(`/admin/audit?user=${agent.id}`)
                              }
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
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
