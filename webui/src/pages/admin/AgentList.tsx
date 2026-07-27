import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, CreateAgentBody, Role } from "../../lib/types";

type AgentsResponse = { agents: Agent[]; version: string };
type RolesResponse = { roles: Role[] };

/**
 * Default MCP endpoint advertised in the safe .mcp.json template.
 * The template never embeds a real token; users must set LUCY_AGENT_TOKEN.
 */
export const SAFE_MCP_URL = "http://localhost:7879/mcp";

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
 * Build a safe .mcp.json snippet for a given agent.
 * The snippet uses ${LUCY_AGENT_TOKEN} as a placeholder and never
 * embeds a real token or hash, so it can be safely shared.
 */
export function buildSafeMcpConfig(_agentId: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        lucy: {
          type: "http",
          url: SAFE_MCP_URL,
          headers: {
            Authorization: "Bearer ${LUCY_AGENT_TOKEN}"
          }
        }
      }
    },
    null,
    2
  );
}

async function copyAgentMcpConfig(agent: Agent): Promise<void> {
  const snippet = buildSafeMcpConfig(agent.id);
  await navigator.clipboard.writeText(snippet);
  toast.success("MCP 配置已复制");
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="pl-metric-card">
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

function AgentCard({ agent, onViewLogs }: { agent: Agent; onViewLogs: () => void }) {
  const sourceCount = agent.effectivePermissions?.sources.length ?? agent.allow?.tables?.length ?? 0;
  const toolCount = agent.effectivePermissions?.tools.length ?? agent.allow?.tools?.length ?? 0;
  const tokenCount = agent.tokens.length;
  const legacyWildcard = agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");

  return (
    <div className="pl-card">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{agent.name}</span>
            <span className="text-fg-muted text-sm">({agent.id})</span>
            <span className={`pl-status-badge ${agent.enabled ? "pl-status-done" : "pl-status-not_started"}`}>
              {agent.enabled ? "启用" : "禁用"}
            </span>
          </div>
          <div className="text-sm text-fg-muted mt-1">
            role: {agent.role ?? "旧 ACL"} · {tokenCount} 个 token · {legacyWildcard ? "legacy wildcard" : `${sourceCount} 个源`} · {toolCount} 个工具
          </div>
          <div className="text-sm text-fg-muted mt-0.5">
            最近访问 <LastSeen lastSeen={agent.stats?.lastSeen} /> ·{" "}
            近 7 天 {agent.stats?.callsLast7d ?? 0} 次调用 / {agent.stats?.deniedLast7d ?? 0} 次拒绝
          </div>
          {agent.note && <div className="text-sm text-fg-muted mt-0.5">{agent.note}</div>}
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex gap-2">
            <Link to={`/admin/agents/${agent.id}`} className="pl-btn pl-btn--ghost text-sm">编辑</Link>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-sm"
              onClick={() => {
                void copyAgentMcpConfig(agent);
              }}
              aria-label={`复制 ${agent.name} 的 MCP 配置`}
            >
              📋 复制 MCP 配置
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
        <span className="pl-status-badge pl-status-done">{role.id}</span>
        {role.source && (
          <span className="pl-status-badge pl-status-not_started">{role.source === "template" ? "template" : "yaml"}</span>
        )}
        {role.invalid && <span className="pl-status-badge pl-status-validation_failed">invalid</span>}
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
        <span className="text-xs text-fg-muted">MCP 工具</span>
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
            <li key={idx}>⚠ {w}</li>
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
        <h2 className="text-lg font-semibold mb-4">新建 Agent</h2>
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
              <span className="text-sm font-medium">角色 <span className="text-danger">*</span></span>
              <select className="pl-input" value={role} onChange={(e) => setRole(e.target.value)}>
                {roles.map((item) => (
                  <option key={item.id} value={item.id} disabled={item.invalid}>
                    {item.id}{item.source === "template" ? " (template)" : ""}{item.invalid ? " (invalid)" : ""}
                  </option>
                ))}
              </select>
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
            <p className="text-sm text-fg-muted">以下改动将写入 access.yaml：</p>
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

  const agents = data?.agents ?? [];
  const enabledCount = agents.filter((agent) => agent.enabled).length;
  const tokenCount = agents.reduce((sum, agent) => sum + agent.tokens.length, 0);
  const deniedLast7d = agents.reduce((sum, agent) => sum + (agent.stats?.deniedLast7d ?? 0), 0);
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="pl-eyebrow">访问治理</p>
          <h1 className="text-xl font-semibold">Agent 实例</h1>
          <p className="pl-page-intro">配置每个 Agent 实例能用哪些 MCP 工具和访问哪些表。</p>
        </div>
        <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建 Agent</button>
      </div>

      <div className="pl-metric-grid">
        <MetricCard label="Agent 数" value={agents.length} hint="access.yaml 中的实例" />
        <MetricCard label="启用数" value={enabledCount} hint={`${agents.length - enabledCount} 个禁用`} />
        <MetricCard label="Token 数" value={tokenCount} hint="不含明文 token" />
        <MetricCard label="7d denied" value={deniedLast7d} hint="来自 Agent stats 汇总" />
      </div>

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
              <p className="text-fg-muted mb-4">还没有任何 Agent。创建第一个 Agent 以开始管理访问权限。</p>
              <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建第一个 Agent</button>
            </div>
          ) : "没有匹配的 Agent"}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
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
