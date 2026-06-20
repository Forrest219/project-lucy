import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DiffViewer } from "../../components/DiffViewer";
import { apiGet, apiPatch, apiDelete } from "../../lib/apiClient";
import type { Agent, AgentPatch, McpToolInfo } from "../../lib/types";

type AgentDetailResponse = { agent: Agent; version: string };
type PatchDryRunResponse = { diff: string; proposedYaml: string };
type PatchSaveResponse = { written: boolean; agent: Agent };
type McpToolsResponse = { tools: McpToolInfo[] };

type Tab = "info" | "tokens" | "tools" | "tables" | "diff";

export function AgentDetail() {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>("info");

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "agent", userId],
    queryFn: () => apiGet<AgentDetailResponse>(`/api/admin/agents/${userId}`)
  });

  const { data: toolsData } = useQuery({
    queryKey: ["admin", "mcp-tools"],
    queryFn: () => apiGet<McpToolsResponse>("/api/admin/mcp-tools")
  });

  const [editName, setEditName] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null);
  const [editAllowTools, setEditAllowTools] = useState<string[] | null>(null);
  const [editAllowTables, setEditAllowTables] = useState<string[] | null>(null);
  const [wildcardTools, setWildcardTools] = useState<boolean | null>(null);
  const [wildcardTables, setWildcardTables] = useState<boolean | null>(null);
  const [diffPreview, setDiffPreview] = useState<{ diff: string; proposedYaml: string } | null>(null);

  const agent = data?.agent;
  const version = data?.version;

  function getToolsValue(): string[] | ["*"] {
    if (wildcardTools !== null) return wildcardTools ? ["*"] : (editAllowTools ?? agent?.allow.tools ?? []);
    return editAllowTools ?? agent?.allow.tools ?? [];
  }

  function getTablesValue(): string[] | ["*"] {
    if (wildcardTables !== null) return wildcardTables ? ["*"] : (editAllowTables ?? agent?.allow.tables ?? []);
    return editAllowTables ?? agent?.allow.tables ?? [];
  }

  function buildPatch(): AgentPatch {
    const patch: AgentPatch = {};
    if (editName !== null) patch.name = editName;
    if (editNote !== null) patch.note = editNote;
    if (editEnabled !== null) patch.enabled = editEnabled;
    const tools = getToolsValue();
    const tables = getTablesValue();
    if (editAllowTools !== null || wildcardTools !== null || editAllowTables !== null || wildcardTables !== null) {
      patch.allow = { tools, tables };
    }
    return patch;
  }

  const previewMutation = useMutation({
    mutationFn: (patch: AgentPatch) =>
      apiPatch<PatchDryRunResponse>(`/api/admin/agents/${userId}`, { dryRun: true, version, patch }),
    onSuccess: (data) => {
      setDiffPreview(data);
      setActiveTab("diff");
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const saveMutation = useMutation({
    mutationFn: (patch: AgentPatch) =>
      apiPatch<PatchSaveResponse>(`/api/admin/agents/${userId}`, { dryRun: false, version, patch }),
    onSuccess: () => {
      toast.success("已保存");
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      setDiffPreview(null);
      setActiveTab("info");
      setEditName(null);
      setEditNote(null);
      setEditEnabled(null);
      setEditAllowTools(null);
      setEditAllowTables(null);
      setWildcardTools(null);
      setWildcardTables(null);
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDelete<{ written: boolean }>(`/api/admin/agents/${userId}`),
    onSuccess: () => {
      toast.success(`Agent ${userId} 已删除`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      navigate("/admin/agents");
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (label: string) => apiDelete<{ written: boolean; revokedAt: string }>(`/api/admin/agents/${userId}/tokens/${encodeURIComponent(label)}`),
    onSuccess: (_, label) => {
      toast.success(`Token "${label}" 已撤销。代理可能在 30 秒内仍接受该 token。`);
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  function handleDelete() {
    if (!confirm(`确定要删除 Agent "${userId}" 吗？此操作将同时撤销所有关联 token。`)) return;
    deleteMutation.mutate();
  }

  function handleRevokeToken(label: string) {
    if (!confirm(`确定要撤销 token "${label}" 吗？`)) return;
    revokeTokenMutation.mutate(label);
  }

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error || !agent) return <div className="pl-notice">加载失败：{error ? (error as Error).message : "Agent 不存在"}</div>;

  const allTools = toolsData?.tools ?? [];
  const currentTools = getToolsValue();
  const currentTables = getTablesValue();
  const isWildcardTools = wildcardTools !== null ? wildcardTools : currentTools.includes("*");
  const isWildcardTables = wildcardTables !== null ? wildcardTables : currentTables.includes("*");

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "info", label: "基本信息" },
    { key: "tokens", label: "Token" },
    { key: "tools", label: "工具权限" },
    { key: "tables", label: "表权限" },
    { key: "diff", label: "变更预览" }
  ];

  const hasEdits = editName !== null || editNote !== null || editEnabled !== null || editAllowTools !== null || editAllowTables !== null || wildcardTools !== null || wildcardTables !== null;

  return (
    <div className="pl-page-stack">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link to="/admin/agents" className="text-sm text-fg-muted hover:text-fg">‹ 返回列表</Link>
          <h1 className="text-xl font-semibold mt-1">{agent.name} <span className="text-fg-muted font-normal text-base">({agent.id})</span></h1>
          <p className="pl-page-intro">编辑前先生成变更预览，确认后写入访问配置。</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-sm"
            onClick={() => {
              const newEnabled = !(editEnabled !== null ? editEnabled : agent.enabled);
              setEditEnabled(newEnabled);
              previewMutation.mutate({ enabled: newEnabled });
            }}
          >
            {(editEnabled !== null ? editEnabled : agent.enabled) ? "禁用" : "启用"}
          </button>
          <button type="button" className="pl-btn pl-btn--danger text-sm" onClick={handleDelete} disabled={deleteMutation.isPending}>
            删除
          </button>
        </div>
      </div>

      <div className="pl-admin-tabbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`pl-admin-tab ${activeTab === tab.key ? "pl-admin-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div>
        {activeTab === "info" && (
          <div className="grid gap-4 max-w-md">
            <div className="grid gap-1">
              <span className="text-sm text-fg-muted">用户 ID（不可改）</span>
              <span className="font-mono text-sm">{agent.id}</span>
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-medium">显示名</span>
              <input
                className="pl-input"
                value={editName !== null ? editName : agent.name}
                onChange={(e) => setEditName(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">备注</span>
              <textarea
                className="pl-input"
                rows={3}
                value={editNote !== null ? editNote : (agent.note ?? "")}
                onChange={(e) => setEditNote(e.target.value)}
              />
            </label>
            <div className="grid gap-1">
              <span className="text-sm font-medium">状态</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editEnabled !== null ? editEnabled : agent.enabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                />
                启用
              </label>
            </div>
          </div>
        )}

        {activeTab === "tokens" && (
          <div className="grid gap-4">
            {agent.tokens.length === 0 ? (
              <p className="text-sm text-fg-muted">暂无 token，点下方按钮创建。</p>
            ) : (
              agent.tokens.map((token) => (
                <div key={token.hash} className="pl-card flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium text-sm">{token.label}</div>
                    <div className="text-xs text-fg-muted mt-0.5">
                      创建 {token.created} · <span className="font-mono">{token.hash.slice(0, 20)}…</span>
                    </div>
                    {token.expires_at && <div className="text-xs text-fg-muted">过期：{token.expires_at}</div>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                  <button
                      type="button"
                      className="pl-btn pl-btn--ghost text-xs"
                      onClick={() => void navigator.clipboard.writeText(token.hash).then(() => toast.success("Hash 已复制"))}
                    >
                      复制 hash
                    </button>
                    <button
                      type="button"
                      className="pl-btn pl-btn--danger text-xs"
                      onClick={() => handleRevokeToken(token.label)}
                    >
                      撤销
                    </button>
                  </div>
                </div>
              ))
            )}
            <Link to={`/admin/agents/${userId}/tokens/new`} className="pl-btn pl-btn--ghost text-sm inline-block">
              + 新建 Token
            </Link>
          </div>
        )}

        {activeTab === "tools" && (
          <div className="grid gap-4 max-w-2xl">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={isWildcardTools}
                onChange={(e) => {
                  setWildcardTools(e.target.checked);
                  if (e.target.checked) setEditAllowTools(null);
                }}
              />
              通配 (*) — 允许所有未在全局 deny 的工具
            </label>
            {!isWildcardTools && (
              <div className="grid grid-cols-2 gap-2">
                {allTools.map((tool) => {
                  const currentToolsArr = currentTools as string[];
                  const checked = currentToolsArr.includes("*") ? true : currentToolsArr.includes(tool.name);
                  return (
                    <label
                      key={tool.name}
                      className={`flex items-center gap-2 text-sm ${tool.globalDenied ? "opacity-50" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={tool.globalDenied}
                        onChange={(e) => {
                          const current = (editAllowTools ?? agent.allow.tools).filter((t) => t !== "*");
                          if (e.target.checked) {
                            setEditAllowTools([...current, tool.name]);
                          } else {
                            setEditAllowTools(current.filter((t) => t !== tool.name));
                          }
                        }}
                      />
                      {tool.name}
                      {tool.globalDenied && <span className="text-xs text-fg-muted">（全局禁用）</span>}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === "tables" && (
          <div className="grid gap-4 max-w-2xl">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={isWildcardTables}
                onChange={(e) => {
                  setWildcardTables(e.target.checked);
                  if (e.target.checked) setEditAllowTables(null);
                }}
              />
              通配 (*) — 允许所有 ktx.yaml 中的 enabled_tables
            </label>
            {!isWildcardTables && (
              <div className="grid gap-2">
                <p className="text-xs text-fg-muted">当前授权表（逗号分隔输入）：</p>
                <textarea
                  className="pl-input font-mono text-sm"
                  rows={4}
                  value={(editAllowTables ?? agent.allow.tables.filter((t) => t !== "*")).join("\n")}
                  onChange={(e) => {
                    const vals = e.target.value.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
                    setEditAllowTables(vals);
                  }}
                  placeholder="每行一个表名，如 dataforai.superstore_orders"
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "diff" && (
          <div className="grid gap-4">
            {diffPreview ? (
              <>
                <DiffViewer diff={diffPreview.diff} />
                <div className="flex justify-end gap-2">
                  <button type="button" className="pl-btn pl-btn--ghost" onClick={() => { setDiffPreview(null); setActiveTab("info"); }}>取消</button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--primary"
                    onClick={() => saveMutation.mutate(buildPatch())}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "保存中…" : "保存"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">在其他标签页编辑后，点「预览变更」生成 diff。</p>
            )}
          </div>
        )}
      </div>

      {hasEdits && activeTab !== "diff" && (
        <div className="flex justify-end gap-2 pt-4 border-t border-border-default">
          <button type="button" className="pl-btn pl-btn--ghost" onClick={() => {
            setEditName(null); setEditNote(null); setEditEnabled(null);
            setEditAllowTools(null); setEditAllowTables(null);
            setWildcardTools(null); setWildcardTables(null);
          }}>
            取消
          </button>
          <button
            type="button"
            className="pl-btn pl-btn--primary"
            onClick={() => previewMutation.mutate(buildPatch())}
            disabled={previewMutation.isPending}
          >
            {previewMutation.isPending ? "生成中…" : "预览变更"}
          </button>
        </div>
      )}
    </div>
  );
}
