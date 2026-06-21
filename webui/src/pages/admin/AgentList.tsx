import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, CreateAgentBody, Role } from "../../lib/types";

type AgentsResponse = { agents: Agent[]; version: string };
type RolesResponse = { roles: Role[] };

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <div className="pl-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
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
            {agent.stats?.lastSeen ? `最近访问 ${new Date(agent.stats.lastSeen).toLocaleString("zh-CN")} · ` : "最近访问 — · "}
            近 7 天 {agent.stats?.callsLast7d ?? 0} 次调用 / {agent.stats?.deniedLast7d ?? 0} 次拒绝
          </div>
          {agent.note && <div className="text-sm text-fg-muted mt-0.5">{agent.note}</div>}
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to={`/admin/agents/${agent.id}`} className="pl-btn pl-btn--ghost text-sm">编辑</Link>
          <button type="button" onClick={onViewLogs} className="pl-btn pl-btn--ghost text-sm">查看日志</button>
        </div>
      </div>
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

  function handlePreview() {
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
                    {item.id}{item.invalid ? " (invalid)" : ""}
                  </option>
                ))}
              </select>
              {role && (
                <span className="text-xs text-fg-muted">
                  {roles.find((item) => item.id === role)?.description ?? "角色模板"}
                </span>
              )}
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="pl-btn pl-btn--ghost" onClick={onClose}>取消</button>
              <button type="button" className="pl-btn pl-btn--primary" onClick={handlePreview} disabled={previewMutation.isPending}>
                {previewMutation.isPending ? "生成中…" : "预览变更"}
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
                {saveMutation.isPending ? "保存中…" : "确认保存"}
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
            navigate(`/admin/agents/${id}`);
          }}
        />
      )}
    </div>
  );
}
