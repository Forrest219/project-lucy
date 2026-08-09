import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPatch, apiDelete } from "../../lib/apiClient";
import type { AccessWriteAck, Agent, AgentPatch, EffectivePermissionsPreview, Role } from "../../lib/types";
import { formatRowGrantPreviewLabel } from "../../lib/row-grant-preview";

type AgentDetailResponse = { agent: Agent; version: string };
type PatchDryRunResponse = { diff: string; proposedYaml: string };
type DiffPreview = PatchDryRunResponse & { patch: AgentPatch };
type PatchSaveResponse = AccessWriteAck & { agent: Agent };
type RolesResponse = { roles: Role[] };

/** Returns true only when runtimeAck confirms the save; callers must not navigate/clear on false. */
function toastAccessWriteAck(result: AccessWriteAck, fallback = "已保存"): boolean {
  if (result.runtimeAck === false) {
    toast.error("保存未生效：runtime 未确认（runtimeAck=false）。磁盘可能已回滚，请检查策略降级 banner。");
    return false;
  }
  const version = result.policyVersion ? ` · policyVersion=${result.policyVersion.slice(0, 12)}…` : "";
  toast.success(`${fallback}${version}`);
  return true;
}

type Tab = "info" | "tokens" | "permissions" | "diff";

function tabFromSearch(search: string): Tab {
  const tab = new URLSearchParams(search).get("tab");
  return tab === "tokens" || tab === "permissions" || tab === "diff" || tab === "info" ? tab : "info";
}

/**
 * Group effective-permission sources by connection and schema so the UI
 * can render a Connection → Schema → Source/Table tree.
 */
export function groupSourcesByConnectionAndSchema(
  sources: EffectivePermissionsPreview["sources"] = []
): Array<{
  connectionId: string;
  schemas: Array<{ schema: string; sources: Array<{ sourceName: string; tables: string[] }> }>;
}> {
  const byConn = new Map<string, Map<string, Map<string, Set<string>>>>();
  for (const src of sources) {
    let schemaMap = byConn.get(src.connectionId);
    if (!schemaMap) {
      schemaMap = new Map();
      byConn.set(src.connectionId, schemaMap);
    }
    let sourceMap = schemaMap.get(src.schema);
    if (!sourceMap) {
      sourceMap = new Map();
      schemaMap.set(src.schema, sourceMap);
    }
    let tables = sourceMap.get(src.sourceName);
    if (!tables) {
      tables = new Set();
      sourceMap.set(src.sourceName, tables);
    }
    tables.add(src.table);
  }
  return Array.from(byConn.entries()).map(([connectionId, schemaMap]) => ({
    connectionId,
    schemas: Array.from(schemaMap.entries()).map(([schema, sourceMap]) => ({
      schema,
      sources: Array.from(sourceMap.entries()).map(([sourceName, tableSet]) => ({
        sourceName,
        tables: Array.from(tableSet).sort()
      }))
    }))
  }));
}

export function AgentDetail() {
  const { userId } = useParams<{ userId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>(() => tabFromSearch(location.search));

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "agent", userId],
    queryFn: () => apiGet<AgentDetailResponse>(`/api/admin/agents/${userId}`)
  });

  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles")
  });

  const [editName, setEditName] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  const [diffPreview, setDiffPreview] = useState<DiffPreview | null>(null);
  const [confirmSave, setConfirmSave] = useState<DiffPreview | null>(null);

  const agent = data?.agent;
  const version = data?.version;

  function buildPatch(): AgentPatch {
    const patch: AgentPatch = {};
    if (editName !== null) patch.name = editName;
    if (editNote !== null) patch.note = editNote;
    if (editEnabled !== null) patch.enabled = editEnabled;
    if (editRole !== null) patch.role = editRole;
    return patch;
  }

  function patchChangesRole(patch: AgentPatch, currentAgent: Agent): boolean {
    return patch.role !== undefined && patch.role !== currentAgent.role;
  }

  function clearStaleDiffPreview() {
    if (diffPreview) setDiffPreview(null);
  }

  function updateEditName(value: string) {
    clearStaleDiffPreview();
    setEditName(value);
  }

  function updateEditNote(value: string) {
    clearStaleDiffPreview();
    setEditNote(value);
  }

  function updateEditEnabled(value: boolean) {
    clearStaleDiffPreview();
    setEditEnabled(value);
  }

  function updateEditRole(value: string) {
    clearStaleDiffPreview();
    setEditRole(value);
  }

  const previewMutation = useMutation({
    mutationFn: async (patch: AgentPatch) => {
      const data = await apiPatch<PatchDryRunResponse>(`/api/admin/agents/${userId}`, { dryRun: true, version, patch });
      return { ...data, patch };
    },
    onSuccess: (data) => {
      setDiffPreview(data);
      setActiveTab("diff");
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const saveMutation = useMutation({
    mutationFn: (patch: AgentPatch) =>
      apiPatch<PatchSaveResponse>(`/api/admin/agents/${userId}`, { dryRun: false, version, patch }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
      if (!toastAccessWriteAck(result)) return;
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      setDiffPreview(null);
      setConfirmSave(null);
      setActiveTab("info");
      setEditName(null);
      setEditNote(null);
      setEditEnabled(null);
      setEditRole(null);
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const directSaveMutation = useMutation({
    mutationFn: async (patch: AgentPatch) => {
      if (!version) throw new Error("配置版本未知，请刷新后重试");
      await apiPatch<PatchDryRunResponse>(`/api/admin/agents/${userId}`, { dryRun: true, version, patch });
      return apiPatch<PatchSaveResponse>(`/api/admin/agents/${userId}`, { dryRun: false, version, patch });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
      if (!toastAccessWriteAck(result)) return;
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
      void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
      setDiffPreview(null);
      setConfirmSave(null);
      setEditName(null);
      setEditNote(null);
      setEditEnabled(null);
      setEditRole(null);
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const confirmPreviewMutation = useMutation({
    mutationFn: async (patch: AgentPatch) => {
      const data = await apiPatch<PatchDryRunResponse>(`/api/admin/agents/${userId}`, { dryRun: true, version, patch });
      return { ...data, patch };
    },
    onSuccess: (data) => setConfirmSave(data),
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

  function handleDiscardEdits() {
    setEditName(null);
    setEditNote(null);
    setEditEnabled(null);
    setEditRole(null);
    setDiffPreview(null);
    setConfirmSave(null);
  }

  function handleSave() {
    if (!agent) return;
    const patch = buildPatch();
    if (patchChangesRole(patch, agent)) {
      confirmPreviewMutation.mutate(patch);
    } else {
      directSaveMutation.mutate(patch);
    }
  }

  function handleViewDiff() {
    previewMutation.mutate(buildPatch());
  }

  useEffect(() => {
    setActiveTab(tabFromSearch(location.search));
  }, [location.search]);

  // Cmd+S / Ctrl+S mirrors the sticky-bar save action (low-risk one-step or role confirm).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "s") return;
      if (!agent) return;
      if (editName === null && editNote === null && editEnabled === null && editRole === null) return;
      e.preventDefault();
      handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, editName, editNote, editEnabled, editRole, version]);

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error || !agent) return <div className="pl-notice">加载失败：{error ? (error as Error).message : "Agent 不存在"}</div>;

  const roles = rolesData?.roles ?? [];
  const currentRole = editRole !== null ? editRole : agent.role;
  const effective = agent.effectivePermissions;
  const legacyWildcard = agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");
  const hasEdits = editName !== null || editNote !== null || editEnabled !== null || editRole !== null;
  const groupedSources = effective ? groupSourcesByConnectionAndSchema(effective.sources) : [];

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "info", label: "基本信息" },
    { key: "tokens", label: "Token" },
    { key: "permissions", label: "权限预览" },
    { key: "diff", label: "变更预览" }
  ];

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={agent.name}
        backAction={
          <Link to="/admin/agents" className="pl-page-header-back">
            ‹ 返回 Agent
          </Link>
        }
        description="编辑显示名、备注或启用状态后可一步保存；变更角色需确认变更 diff。Cmd+S / Ctrl+S 保存。"
        badges={
          <>
            <span>{agent.enabled ? "已启用" : "已禁用"}</span>
            {agent.role ? <span>role: {agent.role}</span> : <span>legacy allow</span>}
            <span>{agent.tokens.filter((t) => !t.revoked).length} 有效 token</span>
          </>
        }
        actions={
          <>
            <Link to={`/admin/config-audit?targetId=${encodeURIComponent(agent.id)}`} className="pl-btn pl-btn--secondary text-sm">
              变更历史
            </Link>
            <button
              type="button"
              className="pl-btn pl-btn--danger text-sm"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              删除
            </button>
          </>
        }
      />

      <div className="pl-admin-tabbar">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={`pl-admin-tab ${activeTab === tab.key ? "pl-admin-tab--active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.key === "diff" && diffPreview && (
              <span className="ml-2 inline-flex items-center rounded-pill bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning-strong">
                待保存
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pl-admin-tab-panel">
        {activeTab === "info" && (
          <div className="grid gap-4 max-w-md pb-32">
            <div className="grid gap-1">
              <span className="text-sm text-fg-muted">用户 ID（不可改）</span>
              <span className="font-mono text-sm">{agent.id}</span>
            </div>
            <label className="grid gap-1">
              <span className="text-sm font-medium">显示名</span>
              <input
                className="pl-input"
                value={editName !== null ? editName : agent.name}
                onChange={(e) => updateEditName(e.target.value)}
              />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">备注</span>
              <textarea
                className="pl-input"
                rows={3}
                value={editNote !== null ? editNote : (agent.note ?? "")}
                onChange={(e) => updateEditNote(e.target.value)}
              />
            </label>
            <div className="grid gap-1">
              <span className="text-sm font-medium">状态</span>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={editEnabled !== null ? editEnabled : agent.enabled}
                  onChange={(e) => updateEditEnabled(e.target.checked)}
                />
                启用
              </label>
            </div>
            <label className="grid gap-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">角色</span>
                <Link to="/admin/roles" className="text-xs text-accent hover:underline" aria-label="管理角色">
                  管理角色 →
                </Link>
              </div>
              <select
                className="pl-input"
                value={currentRole ?? ""}
                onChange={(e) => updateEditRole(e.target.value)}
              >
                <option value="" disabled>选择角色</option>
                {roles.map((role) => {
                  const tags: string[] = [];
                  if (role.source === "template") tags.push("参考模板");
                  if (role.invalid) tags.push("待修复");
                  const suffix = tags.length > 0 ? ` · ${tags.join(" · ")}` : "";
                  return (
                    <option key={role.id} value={role.id} disabled={role.invalid}>
                      {role.id}
                      {suffix}
                    </option>
                  );
                })}
              </select>
              {!agent.role && agent.allow && (
                <span className="text-xs text-fg-muted">
                  旧 ACL 只读兼容；保存角色后会移除该 <span className="notranslate" translate="no">Agent</span> 的 legacy allow。
                </span>
              )}
            </label>
          </div>
        )}

        {activeTab === "tokens" && (
          <div className="grid gap-4 max-w-3xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg-muted">
                当前活跃 token：{agent.tokens.length} 个。已撤销的 token 在此版本不展示历史，可在变更历史中查询。
              </p>
              <Link
                to={`/admin/agents/${userId}/tokens/new`}
                className="pl-btn pl-btn--primary text-sm notranslate"
                translate="no"
                aria-label="生成新 Token"
              >
                + 生成新 <span className="notranslate" translate="no">Token</span>
              </Link>
            </div>
            {agent.tokens.length === 0 ? (
              <p className="text-sm text-fg-muted">暂无 token，点「生成新 <span className="notranslate" translate="no">Token</span>」创建。</p>
            ) : (
              <div className="grid gap-2">
                {agent.tokens.map((token) => (
                  <div key={token.hash} className="pl-card flex items-start justify-between gap-4">
                    <div className="grid gap-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{token.label}</span>
                        <span className="pl-status-badge pl-status-done">活跃</span>
                      </div>
                      <div className="text-xs text-fg-muted">
                        <span>创建 {token.created}</span>
                        {token.expires_at && <span> · 过期 {token.expires_at}</span>}
                      </div>
                      <div className="text-xs text-fg-muted">
                        最近使用：
                        {token.last_used ? new Date(token.last_used).toLocaleString("zh-CN") : "—"}
                        {token.last_tool ? ` · ${token.last_tool}` : ""}
                        {token.last_outcome ? ` · ${token.last_outcome}` : ""}
                      </div>
                      <div className="text-xs text-fg-muted font-mono">
                        hash: {token.hash.slice(0, 24)}…
                      </div>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        className="pl-btn pl-btn--ghost text-xs"
                        onClick={() => void navigator.clipboard.writeText(token.hash).then(() => toast.success("Hash 已复制"))}
                        aria-label={`复制 ${token.label} 的 hash`}
                      >
                        复制 hash
                      </button>
                      <button
                        type="button"
                        className="pl-btn pl-btn--danger text-xs notranslate"
                        translate="no"
                        onClick={() => handleRevokeToken(token.label)}
                        aria-label={`撤销 ${token.label}`}
                      >
                        撤销 <span className="notranslate" translate="no">Token</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "permissions" && (
          <div className="grid gap-4 max-w-3xl pb-32">
            <div className="pl-card">
              <div className="text-sm font-medium">当前角色</div>
              <div className="text-sm text-fg-muted mt-1">
                {agent.role ?? "旧 ACL"}{legacyWildcard ? " · legacy wildcard" : ""}
              </div>
              {agent.permissionWarnings && agent.permissionWarnings.length > 0 && (
                <ul className="text-sm text-danger mt-2 list-disc pl-5">
                  {agent.permissionWarnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
            {effective ? (
              <div data-testid="permissions-tree" className="grid gap-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="pl-metric-card"><span>工具</span><strong>{effective.tools.length}</strong><small>{effective.roleIds.join(", ") || "legacy"}</small></div>
                  <div className="pl-metric-card"><span>连接</span><strong>{effective.connections.length}</strong><small>{effective.connections.join(", ") || "—"}</small></div>
                  <div className="pl-metric-card"><span>Source</span><strong>{effective.sources.length}</strong><small>{effective.snapshotHash.slice(0, 12)}</small></div>
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium notranslate" translate="no">连接 / Schema / Source / Table</div>
                  {groupedSources.length === 0 ? (
                    <p className="text-sm text-fg-muted">无可展开 source。</p>
                  ) : (
                    <ul className="grid gap-3 pl-2">
                      {groupedSources.map((connGroup) => (
                        <li key={connGroup.connectionId} className="grid gap-2">
                          <div className="flex items-center gap-2">
                            <span className="pl-status-badge pl-status-included">{connGroup.connectionId}</span>
                            <span className="text-xs text-fg-muted">连接</span>
                          </div>
                          <ul className="grid gap-2 pl-4">
                            {connGroup.schemas.map((schemaGroup) => (
                              <li key={`${connGroup.connectionId}:${schemaGroup.schema}`} className="grid gap-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm">{schemaGroup.schema}</span>
                                  <span className="text-xs text-fg-muted notranslate" translate="no">Schema</span>
                                </div>
                                <ul className="grid gap-1 pl-4">
                                  {schemaGroup.sources.map((sourceGroup) => (
                                    <li
                                      key={`${connGroup.connectionId}:${schemaGroup.schema}:${sourceGroup.sourceName}`}
                                      className="font-mono text-xs text-fg-muted"
                                    >
                                      {sourceGroup.sourceName}
                                      {sourceGroup.tables.length > 0 && (
                                        <ul className="pl-4">
                                          {sourceGroup.tables.map((tbl) => (
                                            <li key={tbl}>
                                              <span>{tbl}</span>
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </li>
                                  ))}
                                </ul>
                              </li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">允许的 <span className="notranslate" translate="no">MCP</span> 工具</div>
                  <div className="flex flex-wrap gap-2">
                    {effective.tools.length === 0 ? (
                      <span className="text-sm text-fg-muted">—</span>
                    ) : (
                      effective.tools.map((tool) => <span key={tool} className="pl-status-badge pl-status-included">{tool}</span>)
                    )}
                  </div>
                </div>
                <div className="grid gap-2" data-testid="capability-preview">
                  <div className="text-sm font-medium">
                    Data Capability Preview
                    {effective.capabilityDigest ? (
                      <span className="ml-2 font-mono text-xs text-fg-muted notranslate" translate="no">
                        digest={effective.capabilityDigest}
                      </span>
                    ) : null}
                  </div>
                  {(effective.capabilities?.length ?? 0) === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {legacyWildcard
                        ? "legacy tables:* — capability 列表为空（按设计）。"
                        : "无 DataPlane capability。"}
                    </p>
                  ) : (
                    <ul className="grid gap-1 font-mono text-xs">
                      {effective.capabilities!.map((cap) => (
                        <li key={`${cap.tool}:${cap.sourceKey}`} className="notranslate" translate="no">
                          {cap.tool} × {cap.sourceKey} · rowGrant={formatRowGrantPreviewLabel(cap.rowGrant)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <div className="pl-card">
                <p className="text-sm text-fg-muted">当前权限无法解析。请先迁移到有效角色。</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "diff" && (
          <div className="grid gap-4 pb-32">
            {diffPreview ? (
              <>
                <p className="text-sm text-fg-muted notranslate" translate="no">以下改动将写入 access.yaml，确认后才会落盘。</p>
                <DiffViewer diff={diffPreview.diff} />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost"
                    onClick={() => {
                      setDiffPreview(null);
                      setActiveTab("info");
                    }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn--primary"
                    onClick={() => diffPreview && saveMutation.mutate(diffPreview.patch)}
                    disabled={saveMutation.isPending}
                  >
                    {saveMutation.isPending ? "保存中…" : "保存"}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-fg-muted">在其他标签页编辑后，可点「查看变更 diff」审阅，或保存角色变更时在确认框中查看 diff。</p>
            )}
          </div>
        )}
      </div>

      {hasEdits && activeTab !== "diff" && (
        <div
          data-testid="sticky-save-bar"
          className="pl-floating-action-bar"
          role="region"
          aria-label="未保存修改"
        >
          <span className="pl-floating-action-bar-text">您有未保存的修改</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={handleDiscardEdits}
              aria-label="放弃修改"
            >
              放弃修改
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={handleViewDiff}
              disabled={previewMutation.isPending}
              aria-label="查看变更 diff"
            >
              {previewMutation.isPending ? "生成中…" : "查看变更 diff"}
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--primary"
              onClick={handleSave}
              disabled={directSaveMutation.isPending || confirmPreviewMutation.isPending}
              aria-label="保存"
            >
              {directSaveMutation.isPending || confirmPreviewMutation.isPending ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {confirmSave && (
        <div className="pl-modal-backdrop" data-testid="agent-save-confirm-modal">
          <div className="pl-modal-panel max-w-2xl">
            <h2 className="text-lg font-semibold mb-2">确认角色变更</h2>
            <p className="text-sm text-fg-muted mb-4 notranslate" translate="no">以下改动将写入 access.yaml，确认后才会落盘。</p>
            <DiffViewer diff={confirmSave.diff} />
            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => setConfirmSave(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={() => saveMutation.mutate(confirmSave.patch)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? "保存中…" : "确认保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
