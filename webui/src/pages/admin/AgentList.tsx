import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPost } from "../../lib/apiClient";
import type { Agent, CreateAgentBody } from "../../lib/types";

type AgentsResponse = { agents: Agent[]; version: string };

function AgentCard({ agent, onViewLogs }: { agent: Agent; onViewLogs: () => void }) {
  const tableCount = agent.allow.tables.includes("*") ? "*" : agent.allow.tables.length;
  const toolCount = agent.allow.tools.includes("*") ? "*" : agent.allow.tools.length;
  const tokenCount = agent.tokens.length;

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
            {tokenCount} 个 token · {tableCount === "*" ? "*(全部表)" : `${tableCount} 张表`} · {toolCount === "*" ? "*(全部工具)" : `${toolCount} 个工具`}
          </div>
          {agent.stats && (
            <div className="text-sm text-fg-muted mt-0.5">
              {agent.stats.lastSeen ? `最近访问 ${new Date(agent.stats.lastSeen).toLocaleString("zh-CN")} · ` : ""}
              共 {agent.stats.callsLast7d} 次调用（近 7 天）
            </div>
          )}
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

function NewAgentModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [tables, setTables] = useState("");
  const [tools, setTools] = useState("");
  const [wildcardTables, setWildcardTables] = useState(false);
  const [wildcardTools, setWildcardTools] = useState(false);
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
      allow: {
        tables: wildcardTables ? ["*"] : tables.split(",").map((s) => s.trim()).filter(Boolean),
        tools: wildcardTools ? ["*"] : tools.split(",").map((s) => s.trim()).filter(Boolean)
      }
    };
  }

  function handlePreview() {
    previewMutation.mutate({ dryRun: true, agent: buildAgent() });
  }

  function handleSave() {
    saveMutation.mutate({ dryRun: false, agent: buildAgent() });
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-bg-surface rounded-lg shadow-xl p-6 w-full max-w-lg">
        <h2 className="text-lg font-semibold mb-4">新建 Agent</h2>
        {step === "form" ? (
          <div className="grid gap-4">
            <label className="grid gap-1">
              <span className="text-sm font-medium">用户 ID <span className="text-red-500">*</span></span>
              <input className="pl-input" placeholder="例：wangwu" value={id} onChange={(e) => setId(e.target.value)} />
              <span className="text-xs text-fg-muted">1-32 位，仅 A-Z a-z 0-9 _ -</span>
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">显示名 <span className="text-red-500">*</span></span>
              <input className="pl-input" placeholder="例：王五" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">备注</span>
              <input className="pl-input" placeholder="可选" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <div className="grid gap-1">
              <span className="text-sm font-medium">授权表</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wildcardTables} onChange={(e) => setWildcardTables(e.target.checked)} />
                通配 (*) — 允许所有表
              </label>
              {!wildcardTables && (
                <input className="pl-input" placeholder="逗号分隔，如 dataforai.superstore_orders" value={tables} onChange={(e) => setTables(e.target.value)} />
              )}
            </div>
            <div className="grid gap-1">
              <span className="text-sm font-medium">授权工具</span>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={wildcardTools} onChange={(e) => setWildcardTools(e.target.checked)} />
                通配 (*) — 允许所有工具
              </label>
              {!wildcardTools && (
                <input className="pl-input" placeholder="逗号分隔，如 sl_query,wiki_search" value={tools} onChange={(e) => setTools(e.target.value)} />
              )}
            </div>
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

  const agents = data?.agents ?? [];
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
    <div className="grid gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Agent 实例</h1>
          <p className="text-sm text-fg-muted mt-1">配置每个 Agent 实例能用哪些 MCP 工具和访问哪些表。</p>
        </div>
        <button type="button" className="pl-btn pl-btn--primary" onClick={() => setShowNew(true)}>新建 Agent</button>
      </div>

      <div className="flex gap-3">
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
