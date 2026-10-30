import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, AgentsResponseSummary, CreateAgentBody, EffectivePermissionsPreview, Role } from "../../lib/types";
import { buildMcpConfig } from "../../lib/mcpEndpoint";
import { AgentRoleCapability, AgentRoleField, agentRoleIds, roleSelectionSavable } from "../../components/AgentRoleField";
import { PageHeader } from "../../components/PageHeader";
import { PolicyDegradeNotice } from "../../components/PolicyDegradeBanner";
import { AsyncRegion, asyncStatus } from "../../components/AsyncRegion";
import { MetricCard } from "../../components/MetricCard";
import { buildObjectDetailSearch } from "../../lib/objectDetail";
import { RowMoreMenu } from "../../components/RowMoreMenu";
import { isLucyAdminDataPlaneRole } from "../../lib/lucyAdminRole";
import { OPS_EVIDENCE_ROLE_ID, OPS_EVIDENCE_ROLE_WARNING } from "../../lib/opsEvidence";
import { adminAgentsQueryOptions } from "../../lib/displayQueryOptions";
import { queryKeys } from "../../lib/queryKeys";

type AgentsResponse = {
  agents: Agent[];
  version: string;
  /** Optional server-side aggregate; absent on backends pre-dating M55. */
  summary?: AgentsResponseSummary;
  /** Spec 174 §3.3 — display permission meta. */
  meta?: { runtimeConsistency?: "matched" | "unconfirmed" };
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
  const backend = agent.stats?.usedCredentialsLast7d ?? agent.stats?.activeTokensLast7d;
  // null means unavailable; undefined means legacy backend (pre-M55) — use fallback
  if (typeof backend === "number") return backend;
  if (backend === null) return 0; // unavailable; caller checks metricsState separately
  return agent.tokens.filter((token) => isTokenRecentlyActive(token, now)).length;
}

/**
 * 名册活动分档 —— Agent 名册 Spec §6。
 *
 * 分类只在页面派生，不新增接口字段。窗口只用本响应的
 * `summary.windowStart` / `summary.windowEnd`，半开区间 [windowStart, windowEnd)。
 * 缺 summary 或缺任一端时时间条款不成立；协议请求量大于 0 仍可标仅连接。
 */
export type AgentActivityBucket = "business" | "connect_only" | "idle" | "unknown";

export type AgentActivityWindow = {
  windowStart?: string;
  windowEnd?: string;
};

function parseTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const ts = new Date(value).getTime();
  return Number.isNaN(ts) ? null : ts;
}

/**
 * 把一个 Agent 分到 business / connect_only / idle / unknown 四档。
 *
 * - unknown：指标不可用，或近 7 天业务调用量缺失 / 为 null。不是 0，也不是闲置。
 * - business：近 7 天业务调用量大于 0。
 * - connect_only：协议请求量大于 0，或最近 MCP 访问落在窗口内而最近业务使用为空或早于窗口。
 * - idle：其余。近 7 天没有业务调用，且不是仅连接。
 */
export function classifyAgentActivity(
  agent: Pick<Agent, "stats">,
  window: AgentActivityWindow = {}
): AgentActivityBucket {
  const stats = agent.stats;
  const calls = stats?.usageCallsLast7d;
  if (stats?.metricsState === "unavailable" || calls === undefined || calls === null) {
    return "unknown";
  }
  if (calls > 0) return "business";
  const protocol = stats?.protocolCallsLast7d ?? 0;
  const windowStart = parseTimestamp(window.windowStart);
  const windowEnd = parseTimestamp(window.windowEnd);
  const lastSeen = parseTimestamp(stats?.lastSeen);
  const lastBusinessSeen = parseTimestamp(stats?.lastBusinessSeen);
  const mcpInWindow =
    windowStart !== null &&
    windowEnd !== null &&
    lastSeen !== null &&
    lastSeen >= windowStart &&
    lastSeen < windowEnd;
  const businessOutside =
    lastBusinessSeen === null ||
    (windowStart !== null && windowEnd !== null && lastBusinessSeen < windowStart);
  return protocol > 0 || (mcpInWindow && businessOutside) ? "connect_only" : "idle";
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
  let businessCallsLast7d = 0;
  let protocolCallsLast7d = 0;
  let usageCallsLast7d = 0;
  let evalProbeCallsLast7d = 0;
  let usageActiveAgentCountLast7d = 0;
  let availableTokens = 0;
  let deniedLast7d = 0;
  let anyUnavailable = false;
  // Spec 189 §5.2 — a legacy response (no `usage*` fields) must not be
  // back-filled from `callsLast7d` / `businessCallsLast7d`: those carry a
  // different record layer and would silently present a wrong number. The
  // summary reports the usage layer as unavailable instead.
  let usageMetricsAvailable = true;
  let businessMetricsAvailable = true;
  for (const agent of agents) {
    if (agent.enabled) enabledAgentCount += 1;
    configuredTokens += configuredTokenCount(agent);
    availableTokens += agent.stats?.availableTokens ?? (agent.enabled ? configuredTokenCount(agent) : 0);
    if (agent.stats?.metricsState === "unavailable") {
      anyUnavailable = true;
      continue;
    }
    const businessCalls = agent.stats?.businessCallsLast7d;
    if (businessCalls === undefined || businessCalls === null) {
      // No Raw Business figure → the legacy business-derived metrics are
      // unavailable, not zero.
      businessMetricsAvailable = false;
    } else {
      if (businessCalls > 0) activeAgentCountLast7d += 1;
      businessCallsLast7d += businessCalls;
    }
    const usageCalls = agent.stats?.usageCallsLast7d;
    if (usageCalls === undefined || usageCalls === null) {
      usageMetricsAvailable = false;
    } else {
      usageCallsLast7d += usageCalls;
      if (usageCalls > 0) usageActiveAgentCountLast7d += 1;
    }
    const evalProbeCalls = agent.stats?.evalProbeCallsLast7d;
    if (evalProbeCalls === undefined || evalProbeCalls === null) {
      usageMetricsAvailable = false;
    } else {
      evalProbeCallsLast7d += evalProbeCalls;
    }
    activeTokenCountLast7d += activeTokenCount(agent, now);
    callsLast7d += agent.stats?.callsLast7d ?? 0;
    protocolCallsLast7d += agent.stats?.protocolCallsLast7d ?? 0;
    deniedLast7d += agent.stats?.deniedLast7d ?? 0;
  }
  if (anyUnavailable) {
    return {
      agentCount: agents.length,
      enabledAgentCount,
      activeAgentCountLast7d: null,
      businessActiveAgentCountLast7d: null,
      configuredTokenCount: configuredTokens,
      availableTokenCount: availableTokens,
      activeTokenCountLast7d: null,
      usedCredentialCountLast7d: null,
      usedCredentialState: "unavailable",
      callsLast7d: null,
      businessCallsLast7d: null,
      protocolCallsLast7d: null,
      usageCallsLast7d: null,
      evalProbeCallsLast7d: null,
      usageActiveAgentCountLast7d: null,
      deniedLast7d: null,
      metricsState: "unavailable"
    };
  }
  return {
    agentCount: agents.length,
    enabledAgentCount,
    activeAgentCountLast7d: businessMetricsAvailable ? activeAgentCountLast7d : null,
    businessActiveAgentCountLast7d: businessMetricsAvailable ? activeAgentCountLast7d : null,
    configuredTokenCount: configuredTokens,
    availableTokenCount: availableTokens,
    activeTokenCountLast7d,
    usedCredentialCountLast7d: activeTokenCountLast7d,
    usedCredentialState: "ok",
    callsLast7d,
    businessCallsLast7d: businessMetricsAvailable ? businessCallsLast7d : null,
    protocolCallsLast7d,
    // Spec 189 §5.2 — null (not 0) when the response carries no usage layer.
    usageCallsLast7d: usageMetricsAvailable ? usageCallsLast7d : null,
    evalProbeCallsLast7d: usageMetricsAvailable ? evalProbeCallsLast7d : null,
    usageActiveAgentCountLast7d: usageMetricsAvailable ? usageActiveAgentCountLast7d : null,
    deniedLast7d,
    metricsState: "ok"
  };
}


function LastSeen({
  lastSeen,
  unavailable = false,
  emptyLabel = "未访问",
  ariaPrefix = "最近访问"
}: {
  lastSeen?: string | null;
  unavailable?: boolean;
  emptyLabel?: string;
  ariaPrefix?: string;
}) {
  if (unavailable) {
    return <span className="text-fg-muted" title="审计数据不可用">—</span>;
  }
  const { label, title } = formatLastSeen(lastSeen);
  if (!title) {
    return <span className="text-fg-muted">{label === "未访问" ? emptyLabel : label}</span>;
  }
  return (
    <span title={title} aria-label={`${ariaPrefix}：${title}`}>
      {label}
    </span>
  );
}

function NewAgentModal({ roles, onClose, onCreated }: { roles: Role[]; onClose: () => void; onCreated: (id: string) => void }) {
  const formalRoles = roles.filter((item) => item.source !== "template");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
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
      roles: selectedRoles
    };
  }

  const canSubmit = !!id.trim() && !!name.trim() && roleSelectionSavable(selectedRoles, formalRoles, false);
  const capabilityQuery = useQuery({
    queryKey: ["admin", "agent-create-capability", id.trim(), selectedRoles.join("\n")],
    enabled: canSubmit && /^[A-Za-z0-9_-]{1,32}$/.test(id.trim()),
    queryFn: () => apiPost<{ effectivePermissions?: EffectivePermissionsPreview }>("/api/admin/agents", {
      dryRun: true,
      agent: buildAgent()
    })
  });

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

  const showLucyAdminWarning = selectedRoles.some((roleId) => isLucyAdminDataPlaneRole(formalRoles.find((item) => item.id === roleId)) || roleId === "lucy_admin");
  // Spec 149 §6 / SC-23 — 绑定运维问数角色时的警示。
  const showOpsEvidenceWarning = selectedRoles.some((roleId) => roleId === OPS_EVIDENCE_ROLE_ID);

  return (
    <div className="pl-modal-backdrop">
      <div className="pl-modal-panel flex max-h-[calc(100vh-2rem)] flex-col overflow-hidden" data-testid="new-agent-modal">
        <h2 className="mb-4 shrink-0 text-lg font-semibold">新建 <span className="notranslate" translate="no">Agent</span></h2>
        {step === "form" ? (
          <>
            <div className="grid min-h-0 gap-4 overflow-y-auto">
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
              <AgentRoleField
                roles={formalRoles}
                selected={selectedRoles}
                onChange={setSelectedRoles}
                required
                header={
                  <Link to="/admin/roles" className="text-xs text-accent hover:underline" aria-label="管理角色">
                    管理角色 →
                  </Link>
                }
              />
              {formalRoles.length === 0 && (
                <span className="text-xs text-warning-strong">
                  还没有可用角色。请先创建角色。
                  <Link to="/admin/roles/new" className="ml-2 pl-btn pl-btn--secondary text-xs">
                    创建角色
                  </Link>
                </span>
              )}
              {showLucyAdminWarning && (
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
              {showOpsEvidenceWarning && (
                <div
                  className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong"
                  data-testid="agent-ops-evidence-role-warning"
                >
                  {OPS_EVIDENCE_ROLE_WARNING}
                </div>
              )}
              {selectedRoles.length > 0 && canSubmit && (
                <AgentRoleCapability
                  loading={capabilityQuery.isFetching}
                  error={capabilityQuery.error ? (capabilityQuery.error as Error).message : undefined}
                  permissions={capabilityQuery.data?.effectivePermissions}
                />
              )}
              {selectedRoles.length > 0 && !canSubmit && (
                <span className="text-xs text-warning">至少选择 1 个有效角色，并填写用户 ID 和显示名后显示数据能力</span>
              )}
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border-default pt-3">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>取消</button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={handlePreview} disabled={!canSubmit || previewMutation.isPending}>
                {previewMutation.isPending ? "生成中…" : "下一步：预览配置"}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="grid min-h-0 gap-4 overflow-y-auto">
              <p className="text-sm text-fg-muted notranslate" translate="no">以下改动将写入 access.yaml：</p>
              <pre className="pl-diff-viewer text-xs max-h-64 overflow-auto">
                {preview?.diff}
              </pre>
            </div>
            <div className="flex shrink-0 justify-end gap-2 border-t border-border-default pt-3">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={() => setStep("form")}>返回编辑</button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "保存中…" : "确认创建"}
              </button>
            </div>
          </>
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
  const [filterActivity, setFilterActivity] = useState<
    "all" | "business" | "connect_only" | "idle"
  >("all");

  const agentsQuery = useQuery({
    ...adminAgentsQueryOptions<AgentsResponse>()
  });
  const { data, error } = agentsQuery;
  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles", { includeTemplates: false }],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles?includeTemplates=false")
  });

  const agents = data?.agents ?? [];
  const summary = data?.summary ?? summarizeAgents(agents);
  // 名册窗口只读本响应的 summary。缺 summary 或缺任一端时按缺窗口处理，
  // 不在页面自造 7 天（Agent 名册 Spec D12）。
  const activityWindow: AgentActivityWindow = {
    windowStart: data?.summary?.windowStart,
    windowEnd: data?.summary?.windowEnd
  };
  // Spec 189 §5.2 — the business-active count and the business call volume
  // read the **usage** layer. `usage*` is null when the response carries no
  // usage layer (legacy backend) — the UI then shows "—", never a 0 or a
  // number borrowed from a different record layer.
  const activeAgentCountLast7d = summary.usageActiveAgentCountLast7d ?? null;
  const businessCallsLast7dTotal = summary.usageCallsLast7d ?? null;
  // Spec 189 §5.2 / §8 — a missing usage layer is "unavailable", not 0. The
  // card must render "—" instead of a fabricated zero.
  const usageMetricsState: "ok" | "unavailable" =
    summary.usageCallsLast7d === null || summary.usageActiveAgentCountLast7d === null
      ? "unavailable"
      : "ok";
  const isFilterActive = search !== "" || filterEnabled !== "all" || filterRole !== "all" || filterActivity !== "all";
  function clearFilters() {
    setSearch("");
    setFilterEnabled("all");
    setFilterRole("all");
    setFilterActivity("all");
  }

  const roleOptions = Array.from(
    new Set(agents.flatMap((agent) => agentRoleIds(agent)))
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
    const roleIds = agentRoleIds(a);
    const matchRole =
      filterRole === "all" ||
      (filterRole === "unbound" ? roleIds.length === 0 : roleIds.includes(filterRole));
    // Agent 名册 Spec §5.4 —— 四档筛选：全部、有业务调用、仅连接、闲置。
    // 指标不可用的行落在 unknown，只留在「全部」；四档都不改变行的先后。
    const bucket = classifyAgentActivity(a, activityWindow);
    const matchActivity = filterActivity === "all" || bucket === filterActivity;
    return matchSearch && matchEnabled && matchRole && matchActivity;
  });

  if (!data) {
    return (
      <div className="pl-page-stack">
        <PageHeader
          title={<span className="notranslate" translate="no">Agent</span>}
          description={
            <>
              管理 <span className="notranslate" translate="no">Agent</span> 身份、角色、<span className="notranslate" translate="no">Token</span> 及数据访问边界。
            </>
          }
        />
        <AsyncRegion
          status={asyncStatus(agentsQuery)}
          label="Agent 列表"
          error={error}
          onRetry={() => void agentsQuery.refetch()}
          minHeight={480}
        />
      </div>
    );
  }

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
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => void agentsQuery.refetch()}
              disabled={agentsQuery.isFetching}
              data-testid="agent-refresh"
            >
              刷新
            </button>
            <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建 Agent</button>
          </div>
        }
      />

      <PolicyDegradeNotice
        scope={{
          agentNames: Object.fromEntries(agents.map((agent) => [agent.id, agent.name]))
        }}
      />

      {data.meta?.runtimeConsistency === "unconfirmed" ? (
        <div className="pl-notice" role="status" data-testid="agent-runtime-unconfirmed">
          权限生效状态待确认
        </div>
      ) : null}

      {summary.auditCompleteness?.state === "partial" ? (
        <div className="pl-notice" data-testid="agent-audit-partial-notice">
          当前进程观测到 {summary.auditCompleteness.pendingWrites} 条审计写入尚未完成、{summary.auditCompleteness.failedWrites} 条失败；近窗统计可能不完整。
        </div>
      ) : null}

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
          value={activeAgentCountLast7d}
          help="近 7 天至少出现过一次默认用量业务调用的去重 Agent 数（排除协议事件与默认视图排除的评测探针）。"
          subValue={usageMetricsState === "ok" ? "仅按业务调用判定" : undefined}
          state={usageMetricsState}
          helpId="active-agent-count"
          testId="metric-active-agent-count"
        />
        <MetricCard
          label="近 7 天业务调用量"
          value={businessCallsLast7dTotal}
          help="近 7 天默认用量业务调用次数；用于判定真实业务使用（排除协议事件与默认视图排除的评测探针）。"
          subValue={usageMetricsState === "ok" ? "排除协议事件与评测探针" : undefined}
          state={usageMetricsState}
          helpId="business-calls"
          testId="metric-business-calls"
        />
        <MetricCard
          label={
            <span>
              可用 <span className="notranslate" translate="no">Token</span>
            </span>
          }
          labelText="可用 Token"
          value={summary.availableTokenCount ?? 0}
          help="当前 Agent 已启用且 Token 未过期的配置凭据数。"
          subValue={`配置 ${summary.configuredTokenCount} 个`}
          helpId="active-token-count"
          testId="metric-active-token-count"
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
                onChange={(e) =>
                  setFilterActivity(e.target.value as "all" | "business" | "connect_only" | "idle")
                }
                aria-label="近 7 天活跃"
              >
                <option value="all">全部</option>
                <option value="business">有业务调用</option>
                <option value="connect_only">仅连接</option>
                <option value="idle">闲置</option>
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
                  <th scope="col">显示名/用户 ID</th>
                  <th scope="col">角色</th>
                  <th scope="col" className="notranslate" translate="no">Token</th>
                  <th scope="col">近 7 天业务调用量</th>
                  <th scope="col">最近业务使用</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((agent) => {
                  const legacyWildcard =
                    agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");
                  const metricsUnavailable = agent.stats?.metricsState === "unavailable";
                  // Spec 189 §6 — the table reads the Default Usage layer.
                  const callsLast7d = agent.stats?.usageCallsLast7d;
                  // Agent 名册 Spec §6 —— 分档在页面派生，窗口只读响应里的 summary。
                  const bucket = classifyAgentActivity(agent, activityWindow);
                  const configuredTokens = configuredTokenCount(agent);
                  const availableTokens = agent.stats?.availableTokens ?? (agent.enabled ? configuredTokens : 0);
                  const noAvailableToken = availableTokens === 0 && configuredTokens > 0;

                  return (
                    <tr key={agent.id} data-testid={`agent-row-${agent.id}`}>
                      <td>
                        <div className="pl-agent-list-table-name">
                          <div className="flex items-center gap-1.5">
                            <Link
                              to={buildObjectDetailSearch({ kind: "agent", agentId: agent.id })}
                              className="font-medium pl-agent-list-table-name-link"
                              aria-label={`查看 ${agent.name} 的对象详情`}
                              data-testid={`agent-name-link-${agent.id}`}
                            >
                              {agent.name}
                            </Link>
                            {/* Agent 名册 Spec D4 —— 已启用不放任何状态标记；未启用只标「已禁用」。 */}
                            {!agent.enabled ? (
                              <span className="pl-status-badge pl-status-not_started">已禁用</span>
                            ) : null}
                          </div>
                          <span className="pl-agent-list-table-meta notranslate" translate="no">
                            {agent.id}
                          </span>
                        </div>
                      </td>
                      <td data-testid={`agent-role-line-${agent.id}`}>
                        {agentRoleIds(agent).length > 0 ? (
                          <span className="inline-flex flex-wrap gap-2">
                            {agentRoleIds(agent).map((roleId) => (
                              <Link
                                key={roleId}
                                to={`/admin/roles/${encodeURIComponent(roleId)}`}
                                className="pl-agent-list-table-name-link notranslate"
                                translate="no"
                                aria-label={`查看角色 ${roleId}`}
                                data-testid={
                                  agentRoleIds(agent).length === 1
                                    ? `agent-role-link-${agent.id}`
                                    : `agent-role-link-${agent.id}-${roleId}`
                                }
                              >
                                {roleId}
                              </Link>
                            ))}
                          </span>
                        ) : (
                          <span className="text-fg-muted notranslate" translate="no">旧 ACL</span>
                        )}
                        {legacyWildcard && agentRoleIds(agent).length === 0 && (
                          <span className="pl-agent-list-table-meta notranslate" translate="no">legacy wildcard</span>
                        )}
                      </td>
                      <td data-testid={`agent-active-tokens-${agent.id}`}>
                        <div className="pl-agent-list-table-name">
                          {noAvailableToken ? (
                            <span className="text-warning-strong">
                              无可用 <span className="notranslate" translate="no">Token</span>
                            </span>
                          ) : (
                            <span className="pl-agent-list-table-num">可用 {availableTokens}</span>
                          )}
                          <span className="pl-agent-list-table-meta">配置 {configuredTokens}</span>
                        </div>
                      </td>
                      <td data-testid={`agent-calls-7d-${agent.id}`}>
                        <div className="pl-agent-list-table-name">
                          <span className="pl-agent-list-table-num">
                            {bucket === "unknown" ? "—" : callsLast7d}
                          </span>
                          {metricsUnavailable ? (
                            <span className="pl-agent-list-table-meta" data-testid={`agent-metrics-unavailable-${agent.id}`}>数据不可用</span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        {bucket === "unknown" ? (
                          <span className="text-fg-muted">—</span>
                        ) : (
                          <>
                            <LastSeen
                              lastSeen={agent.stats?.lastBusinessSeen}
                              emptyLabel="未使用"
                              ariaPrefix="最近业务使用"
                            />
                            {/* Agent 名册 Spec D6 —— 仅连接是次级文字，不上 warning 色。 */}
                            {bucket === "connect_only" ? (
                              <span className="text-fg-muted"> · 仅连接</span>
                            ) : null}
                          </>
                        )}
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
            void queryClient.invalidateQueries({ queryKey: queryKeys.adminAgents });
            navigate(`/admin/agents/${id}?tab=tokens`);
          }}
        />
      )}
    </div>
  );
}
