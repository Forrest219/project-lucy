import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/apiClient";
import type { RoleAllowConfig, RoleDetail as RoleDetailType, RoleSelector } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";

type Tab = "config" | "permissions" | "usage" | "diff";

type RoleFormState = {
  roleId: string;
  description: string;
  connectionsText: string;
  toolsText: string;
  selectors: Array<{
    connection: string;
    schema: string;
    kind: "names" | "prefix";
    namesText: string;
    prefix: string;
  }>;
};

type RoleWritePayload = {
  description?: string;
  allow: RoleAllowConfig;
};

type CreatePreview = {
  diff: string;
  proposedYaml: string;
  payload: {
    roleId: string;
    role: RoleWritePayload;
  };
};

type PatchPreview = {
  diff: string;
  proposedYaml: string;
  version?: string;
  patch: RoleWritePayload;
};

type CopyPreview = {
  diff: string;
  proposedYaml: string;
  newRoleId: string;
  role: RoleWritePayload;
};

type DeletePreview = {
  diff: string;
  proposedYaml: string;
  version?: string;
};

const EMPTY_FORM: RoleFormState = {
  roleId: "",
  description: "",
  connectionsText: "",
  toolsText: "",
  selectors: []
};

function splitList(value: string): string[] {
  return value
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(items: string[] | undefined): string {
  return items ? items.join("\n") : "";
}

function selectorsToForm(selectors: RoleSelector[] | undefined): RoleFormState["selectors"] {
  if (!selectors) return [];
  return selectors.map((selector) => {
    if ("names" in selector) {
      return {
        connection: selector.connection ?? "",
        schema: selector.schema,
        kind: "names" as const,
        namesText: selector.names.join("\n"),
        prefix: ""
      };
    }
    return {
      connection: selector.connection ?? "",
      schema: selector.schema,
      kind: "prefix" as const,
      namesText: "",
      prefix: selector.prefix
    };
  });
}

function formToAllow(state: RoleFormState): RoleAllowConfig {
  const connections = splitList(state.connectionsText);
  const tools = splitList(state.toolsText);
  const tableSelectors: RoleSelector[] = state.selectors
    .filter((row) => row.schema.trim().length > 0)
    .map((row) => {
      if (row.kind === "prefix") {
        return {
          connection: row.connection.trim() || undefined,
          schema: row.schema.trim(),
          prefix: row.prefix.trim()
        } as RoleSelector;
      }
      return {
        connection: row.connection.trim() || undefined,
        schema: row.schema.trim(),
        names: splitList(row.namesText)
      } as RoleSelector;
    });
  return {
    connections: connections.length > 0 ? connections : undefined,
    tools: tools.length > 0 ? tools : undefined,
    tableSelectors: tableSelectors.length > 0 ? tableSelectors : undefined
  };
}

function initFormFromDetail(detail: RoleDetailType): RoleFormState {
  return {
    roleId: detail.id,
    description: detail.role.description ?? "",
    connectionsText: joinList(detail.role.allow.connections),
    toolsText: joinList(detail.role.allow.tools),
    selectors: selectorsToForm(detail.role.allow.tableSelectors)
  };
}

function isRoleDirty(form: RoleFormState, detail: RoleDetailType | null, mode: "create" | "edit" | "copy" | "delete"): boolean {
  if (mode === "create" || mode === "copy") return true;
  if (!detail) return false;
  const current = initFormFromDetail(detail);
  if (form.description !== current.description) return true;
  if (form.connectionsText !== current.connectionsText) return true;
  if (form.toolsText !== current.toolsText) return true;
  if (form.selectors.length !== current.selectors.length) return true;
  for (let i = 0; i < form.selectors.length; i += 1) {
    const a = form.selectors[i]!;
    const b = current.selectors[i]!;
    if (a.connection !== b.connection || a.schema !== b.schema || a.kind !== b.kind) return true;
    if (a.namesText !== b.namesText || a.prefix !== b.prefix) return true;
  }
  return false;
}

export function RoleDetail({ mode: initialMode }: { mode?: "create" } = {}) {
  const { roleId: routeRoleId } = useParams<{ roleId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const mode: "create" | "edit" | "copy" | "delete" = useMemo(() => {
    if (initialMode === "create") return "create";
    if (searchParams.get("mode") === "copy") return "copy";
    if (searchParams.get("mode") === "delete") return "delete";
    return "edit";
  }, [initialMode, searchParams]);

  const roleId = routeRoleId ?? "";
  const isTemplate = mode === "edit" || mode === "copy" || mode === "delete";

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "role", roleId],
    queryFn: () => apiGet<RoleDetailType>(`/api/admin/roles/${roleId}`),
    enabled: isTemplate && roleId.length > 0
  });
  const detail = data ?? null;

  const [form, setForm] = useState<RoleFormState>(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState<Tab>("config");
  const [diffPreview, setDiffPreview] = useState<PatchPreview | null>(null);
  const [createPreview, setCreatePreview] = useState<CreatePreview | CopyPreview | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);

  function clearPreviews() {
    setCreatePreview(null);
    setDeletePreview(null);
    setDiffPreview(null);
  }

  function updateForm(next: RoleFormState) {
    setForm(next);
    clearPreviews();
  }

  useEffect(() => {
    if (mode === "edit" && detail) {
      setForm(initFormFromDetail(detail));
      clearPreviews();
    } else if (mode === "copy" && detail) {
      setForm({
        ...initFormFromDetail(detail),
        roleId: ""
      });
      clearPreviews();
    } else if (mode === "create") {
      setForm(EMPTY_FORM);
      clearPreviews();
    }
  }, [mode, detail]);

  const allow = useMemo(() => formToAllow(form), [form]);
  const roleIdIsValid = useMemo(
    () => /^[A-Za-z0-9_-]{1,64}$/.test(form.roleId),
    [form.roleId]
  );
  const toolsCount = splitList(form.toolsText).length;
  const dirty = isRoleDirty(form, detail, mode);

  const createMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; payload: { roleId: string; role: RoleWritePayload } }) =>
      apiPost<{ diff: string; proposedYaml: string } | { written: boolean; role: RoleDetailType }>(
        "/api/admin/roles",
        { dryRun: body.dryRun, roleId: body.payload.roleId, role: body.payload.role }
      ),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const result = data as { diff: string; proposedYaml: string };
        setCreatePreview({ ...result, payload: vars.payload });
        setDiffPreview(null);
        setDeletePreview(null);
        setActiveTab("diff");
      } else {
        toast.success("Role 已创建");
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        navigate(`/admin/roles/${encodeURIComponent(vars.payload.roleId)}`);
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const patchMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; version: string | undefined; patch: RoleWritePayload }) =>
      apiPatch<{ diff: string; proposedYaml: string; version?: string } | { written: boolean; version: string }>(
        `/api/admin/roles/${roleId}`,
        { dryRun: body.dryRun, version: body.version, patch: body.patch }
      ),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const result = data as { diff: string; proposedYaml: string; version?: string };
        setDiffPreview({ ...result, version: result.version ?? vars.version, patch: vars.patch });
        setCreatePreview(null);
        setDeletePreview(null);
        setActiveTab("diff");
      } else {
        toast.success("Role 已保存");
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agent", roleId] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        setActiveTab("config");
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const copyMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; newRoleId: string; role: RoleWritePayload }) =>
      apiPost<{ diff: string; proposedYaml: string } | { written: boolean; role: RoleDetailType }>(
        `/api/admin/roles/${roleId}/copy`,
        { dryRun: body.dryRun, newRoleId: body.newRoleId, role: body.role }
      ),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const result = data as { diff: string; proposedYaml: string };
        setCreatePreview({ ...result, newRoleId: vars.newRoleId, role: vars.role });
        setDiffPreview(null);
        setDeletePreview(null);
        setActiveTab("diff");
      } else {
        toast.success(`Role '${vars.newRoleId}' 已从 '${roleId}' 复制`);
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        navigate(`/admin/roles/${encodeURIComponent(vars.newRoleId)}`);
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; version: string | undefined }) =>
      apiDelete<{ diff: string; proposedYaml: string; version?: string } | { written: boolean }>(
        `/api/admin/roles/${roleId}`,
        { dryRun: body.dryRun, version: body.version }
      ),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const result = data as { diff: string; proposedYaml: string; version?: string };
        setDeletePreview({ ...result, version: result.version ?? vars.version });
        setCreatePreview(null);
        setDiffPreview(null);
        setActiveTab("diff");
      } else {
        toast.success(`Role '${roleId}' 已删除`);
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        navigate("/admin/roles");
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  function buildRolePayload(): RoleWritePayload {
    const allowConfig = formToAllow(form);
    return {
      description: form.description.trim() || undefined,
      allow: allowConfig
    };
  }

  function handleCreatePreview() {
    if (!roleIdIsValid) {
      toast.error("Role id 必须匹配 ^[A-Za-z0-9_-]{1,64}$");
      return;
    }
    if (toolsCount === 0) {
      toast.error("至少需要一个 MCP 工具");
      return;
    }
    const payload = {
      roleId: form.roleId,
      role: buildRolePayload()
    };
    createMutation.mutate({
      dryRun: true,
      payload
    });
  }

  function handleCreateSave() {
    if (!createPreview || !("payload" in createPreview)) return;
    createMutation.mutate({
      dryRun: false,
      payload: createPreview.payload
    });
  }

  function handlePatchPreview() {
    if (!detail) return;
    patchMutation.mutate({
      dryRun: true,
      version: detail.version,
      patch: buildRolePayload()
    });
  }

  function handlePatchSave() {
    if (!diffPreview) return;
    patchMutation.mutate({
      dryRun: false,
      version: diffPreview.version,
      patch: diffPreview.patch
    });
  }

  function handleCopyPreview() {
    if (!roleIdIsValid) {
      toast.error("新 Role id 必须匹配 ^[A-Za-z0-9_-]{1,64}$");
      return;
    }
    copyMutation.mutate({ dryRun: true, newRoleId: form.roleId, role: buildRolePayload() });
  }

  function handleCopySave() {
    if (!createPreview || !("newRoleId" in createPreview)) return;
    copyMutation.mutate({ dryRun: false, newRoleId: createPreview.newRoleId, role: createPreview.role });
  }

  function handleDeletePreview() {
    deleteMutation.mutate({ dryRun: true, version: detail?.version });
  }

  function handleDeleteSave() {
    if (!deletePreview) return;
    deleteMutation.mutate({ dryRun: false, version: deletePreview.version });
  }

  function resetToForm() {
    if (detail) setForm(initFormFromDetail(detail));
    else setForm(EMPTY_FORM);
    clearPreviews();
  }

  if (mode === "edit" || mode === "copy" || mode === "delete") {
    if (isLoading) return <div className="pl-notice">加载中…</div>;
    if (error || !detail) {
      return (
        <div className="pl-notice">
          加载失败：{error ? (error as Error).message : "Role 不存在"}
          <div className="mt-3">
            <Link to="/admin/roles" className="pl-btn pl-btn--ghost text-sm">‹ 返回列表</Link>
          </div>
        </div>
      );
    }
  }

  const isReadOnlyTemplate = mode === "edit" && detail?.source === "template";
  const showCreateDiff = mode === "create" || mode === "copy";
  const showPatchDiff = mode === "edit";
  const showDeleteDiff = mode === "delete";

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "config", label: "基本配置" },
    { key: "permissions", label: "权限预览" },
    { key: "usage", label: "使用情况" },
    { key: "diff", label: "变更预览" }
  ];

  return (
    <div className="pl-page-stack">
      <PageHeader
        title={
          mode === "create"
            ? "新建 Role"
            : mode === "copy"
              ? `复制 Role · ${roleId}`
              : mode === "delete"
                ? `删除 Role · ${roleId}`
                : `${detail?.id ?? roleId}`
        }
        breadcrumbs={
          mode === "create"
            ? ["访问治理", "角色配置", "新建 Role"]
            : ["访问治理", "角色配置", roleId]
        }
        description={
          <>
            {mode === "create" && "新建 YAML role，所有写入必须经过 dryRun diff 确认。"}
            {mode === "edit" && detail?.source === "template" && "这是内置模板，UI 上只读。请使用「复制为 YAML Role」展开为普通 YAML role。"}
            {mode === "edit" && detail?.source !== "template" && "编辑 YAML role，所有写入必须经过 dryRun diff 确认。"}
            {mode === "copy" && "从已有 role 复制出新的 YAML role。需输入新 id。"}
            {mode === "delete" && "删除前必须 dryRun diff。被 Agent 引用的 role 不可删除。"}
          </>
        }
        badges={
          detail ? (
            <>
              <span>{detail.source === "template" ? "template" : "YAML role"}</span>
              <span>{detail.usageCount} 个 Agent 引用</span>
            </>
          ) : null
        }
        actions={
          <>
            <Link to="/admin/roles" className="pl-btn pl-btn--ghost text-sm">‹ 返回列表</Link>
            {mode === "delete" && (
              <button
                type="button"
                className="pl-btn pl-btn--danger text-sm"
                onClick={handleDeletePreview}
                disabled={(detail?.usageCount ?? 0) > 0 || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "生成 diff 中…" : "预览删除"}
              </button>
            )}
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
            {tab.key === "diff" && (diffPreview || createPreview || deletePreview) && (
              <span className="ml-2 inline-flex items-center rounded-pill bg-warning-soft px-1.5 py-0.5 text-[10px] font-semibold text-warning-strong">
                待保存
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="pl-admin-tab-panel">
        {activeTab === "config" && (
          <div className="grid gap-4 max-w-2xl pb-32">
            <label className="grid gap-1" htmlFor="role-id-input">
              <span className="text-sm font-medium">Role ID</span>
              <input
                id="role-id-input"
                className="pl-input"
                value={form.roleId}
                disabled={mode === "edit" && detail?.source !== "template"}
                placeholder="例：poc_data_engineer"
                onChange={(e) => updateForm({ ...form, roleId: e.target.value })}
              />
              <span className="text-xs text-fg-muted">规则：{"^[A-Za-z0-9_-]{1,64}$"}</span>
            </label>
            <label className="grid gap-1" htmlFor="role-description-input">
              <span className="text-sm font-medium">描述</span>
              <input
                id="role-description-input"
                className="pl-input"
                value={form.description}
                placeholder="可选"
                onChange={(e) => updateForm({ ...form, description: e.target.value })}
                disabled={isReadOnlyTemplate}
              />
            </label>
            <label className="grid gap-1" htmlFor="role-connections-input">
              <span className="text-sm font-medium">Connections</span>
              <textarea
                id="role-connections-input"
                className="pl-input"
                rows={2}
                placeholder="一行或逗号分隔，例如：mysql-aliyun"
                value={form.connectionsText}
                onChange={(e) => updateForm({ ...form, connectionsText: e.target.value })}
                disabled={isReadOnlyTemplate}
              />
            </label>
            <label className="grid gap-1" htmlFor="role-tools-input">
              <span className="text-sm font-medium">MCP 工具</span>
              <textarea
                id="role-tools-input"
                className="pl-input"
                rows={3}
                placeholder="lucy_query&#10;lucy_read_source"
                value={form.toolsText}
                onChange={(e) => updateForm({ ...form, toolsText: e.target.value })}
                disabled={isReadOnlyTemplate}
              />
              <span className="text-xs text-fg-muted">
                显式列举工具名，禁止使用 <code>*</code> 通配符。
              </span>
            </label>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Table Selectors</span>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost text-xs"
                  onClick={() =>
                    updateForm({
                      ...form,
                      selectors: [...form.selectors, { connection: "", schema: "", kind: "names", namesText: "", prefix: "" }]
                    })
                  }
                  disabled={isReadOnlyTemplate}
                >
                  + 添加 selector
                </button>
              </div>
              {form.selectors.length === 0 ? (
                <p className="text-xs text-fg-muted">没有 selector。此 role 不能访问任何数据源。</p>
              ) : (
                <div className="grid gap-2">
                  {form.selectors.map((row, idx) => (
                    <div key={idx} className="grid gap-2 rounded-md border border-border-default bg-bg-base p-3">
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          className="pl-input"
                          placeholder="connection (可选)"
                          value={row.connection}
                          onChange={(e) => {
                            const next = [...form.selectors];
                            next[idx] = { ...row, connection: e.target.value };
                            updateForm({ ...form, selectors: next });
                          }}
                          disabled={isReadOnlyTemplate}
                          aria-label={`selector ${idx + 1} connection`}
                        />
                        <input
                          className="pl-input"
                          placeholder="schema (必填)"
                          value={row.schema}
                          onChange={(e) => {
                            const next = [...form.selectors];
                            next[idx] = { ...row, schema: e.target.value };
                            updateForm({ ...form, selectors: next });
                          }}
                          disabled={isReadOnlyTemplate}
                          aria-label={`selector ${idx + 1} schema`}
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            checked={row.kind === "names"}
                            onChange={() => {
                              const next = [...form.selectors];
                              next[idx] = { ...row, kind: "names" };
                              updateForm({ ...form, selectors: next });
                            }}
                            disabled={isReadOnlyTemplate}
                          />
                          names
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="radio"
                            checked={row.kind === "prefix"}
                            onChange={() => {
                              const next = [...form.selectors];
                              next[idx] = { ...row, kind: "prefix" };
                              updateForm({ ...form, selectors: next });
                            }}
                            disabled={isReadOnlyTemplate}
                          />
                          prefix
                        </label>
                        <button
                          type="button"
                          className="pl-btn pl-btn--ghost text-xs ml-auto"
                          onClick={() => {
                            const next = form.selectors.filter((_, i) => i !== idx);
                            updateForm({ ...form, selectors: next });
                          }}
                          disabled={isReadOnlyTemplate}
                        >
                          删除
                        </button>
                      </div>
                      {row.kind === "names" ? (
                        <textarea
                          className="pl-input"
                          rows={2}
                          placeholder="一行或逗号分隔 source name"
                          value={row.namesText}
                          onChange={(e) => {
                            const next = [...form.selectors];
                            next[idx] = { ...row, namesText: e.target.value };
                            updateForm({ ...form, selectors: next });
                          }}
                          disabled={isReadOnlyTemplate}
                          aria-label={`selector ${idx + 1} names`}
                        />
                      ) : (
                        <input
                          className="pl-input"
                          placeholder="source name 前缀"
                          value={row.prefix}
                          onChange={(e) => {
                            const next = [...form.selectors];
                            next[idx] = { ...row, prefix: e.target.value };
                            updateForm({ ...form, selectors: next });
                          }}
                          disabled={isReadOnlyTemplate}
                          aria-label={`selector ${idx + 1} prefix`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {isReadOnlyTemplate && (
              <div className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong">
                这是内置模板，UI 上只读。
                <Link to={`/admin/roles/${encodeURIComponent(detail!.id)}?mode=copy`} className="pl-btn pl-btn--secondary text-xs ml-3">
                  复制为 YAML Role
                </Link>
              </div>
            )}
          </div>
        )}

        {activeTab === "permissions" && (
          <div className="grid gap-4 max-w-3xl pb-32">
            {!detail ? (
              <p className="text-sm text-fg-muted">尚未保存。先在「基本配置」中填写并预览保存。</p>
            ) : detail.invalid ? (
              <div className="pl-card">
                <p className="text-sm text-danger">该 role 当前无法解析：{detail.warnings.join("; ")}</p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="pl-metric-card"><span>工具</span><strong>{detail.effectivePermissions?.tools.length ?? 0}</strong><small>{detail.id}</small></div>
                  <div className="pl-metric-card"><span>连接</span><strong>{detail.effectivePermissions?.connections.length ?? 0}</strong><small>{detail.effectivePermissions?.connections.join(", ") || "—"}</small></div>
                  <div className="pl-metric-card"><span>Source</span><strong>{detail.effectivePermissions?.sources.length ?? 0}</strong><small>{detail.effectivePermissions?.snapshotHash.slice(0, 12)}</small></div>
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">允许的 MCP 工具</div>
                  <div className="flex flex-wrap gap-2">
                    {(detail.effectivePermissions?.tools ?? []).map((tool) => (
                      <span key={tool} className="pl-status-badge pl-status-included">{tool}</span>
                    ))}
                  </div>
                </div>
                <div className="grid gap-2">
                  <div className="text-sm font-medium">解析的 Source</div>
                  <div className="grid gap-1">
                    {(detail.effectivePermissions?.sources ?? []).map((src) => (
                      <div key={`${src.connectionId}:${src.sourceName}:${src.table}`} className="font-mono text-xs text-fg-muted">
                        {src.connectionId} / {src.schema} / {src.sourceName} / {src.table}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {activeTab === "usage" && (
          <div className="grid gap-4 max-w-3xl pb-32">
            {!detail ? (
              <p className="text-sm text-fg-muted">尚未保存。</p>
            ) : (detail.users ?? []).length === 0 ? (
              <p className="text-sm text-fg-muted">当前没有 Agent 引用此 role。</p>
            ) : (
              <div className="grid gap-2">
                {detail.users!.map((u) => (
                  <Link
                    key={u.id}
                    to={`/admin/agents/${encodeURIComponent(u.id)}`}
                    className="pl-card flex items-center justify-between gap-3 no-underline"
                  >
                    <div>
                      <div className="font-medium text-sm">{u.name}</div>
                      <div className="text-xs text-fg-muted">({u.id}) · {u.tokenCount} 个 token</div>
                    </div>
                    <span className={`pl-status-badge ${u.enabled ? "pl-status-done" : "pl-status-not_started"}`}>
                      {u.enabled ? "启用" : "禁用"}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "diff" && (
          <div className="grid gap-4 pb-32">
            {createPreview || diffPreview || deletePreview ? (
              <DiffTabContent
                diff={(deletePreview ?? createPreview ?? diffPreview)!.diff}
                proposedYaml={(deletePreview ?? createPreview ?? diffPreview)!.proposedYaml}
                primaryLabel={showDeleteDiff ? "确认删除" : showCreateDiff ? "确认创建" : "保存"}
                onSave={() => {
                  if (showDeleteDiff) handleDeleteSave();
                  else if (showCreateDiff && mode === "copy") handleCopySave();
                  else if (showCreateDiff) handleCreateSave();
                  else handlePatchSave();
                }}
                onCancel={() => {
                  if (showDeleteDiff) setDeletePreview(null);
                  else if (showCreateDiff) setCreatePreview(null);
                  else setDiffPreview(null);
                  setActiveTab("config");
                }}
                isPending={
                  createMutation.isPending || patchMutation.isPending || deleteMutation.isPending || copyMutation.isPending
                }
              />
            ) : (
              <p className="text-sm text-fg-muted">在「基本配置」编辑后，点「预览保存」生成 diff。</p>
            )}
          </div>
        )}
      </div>

      {activeTab === "config" && dirty && !showDeleteDiff && !isReadOnlyTemplate && (
        <div
          data-testid="role-dirty-bar"
          className="pl-floating-action-bar"
          role="region"
          aria-label="未保存修改"
        >
          <span className="pl-floating-action-bar-text">您有未保存的修改</span>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--ghost"
              onClick={resetToForm}
              aria-label="放弃修改"
            >
              放弃修改
            </button>
            {mode === "create" && (
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={handleCreatePreview}
                disabled={!roleIdIsValid || toolsCount === 0 || createMutation.isPending}
              >
                {createMutation.isPending ? "生成中…" : "预览保存"}
              </button>
            )}
            {mode === "copy" && (
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={handleCopyPreview}
                disabled={!roleIdIsValid || copyMutation.isPending}
              >
                {copyMutation.isPending ? "生成中…" : "预览复制"}
              </button>
            )}
            {mode === "edit" && (
              <button
                type="button"
                className="pl-btn pl-btn--primary"
                onClick={handlePatchPreview}
                disabled={patchMutation.isPending}
              >
                {patchMutation.isPending ? "生成中…" : "预览并保存"}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffTabContent({
  diff,
  proposedYaml,
  primaryLabel,
  onSave,
  onCancel,
  isPending
}: {
  diff: string;
  proposedYaml: string;
  primaryLabel: string;
  onSave: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  return (
    <>
      <p className="text-sm text-fg-muted">以下改动将写入 access.yaml：</p>
      <pre className="pl-diff-viewer text-xs max-h-96 overflow-auto" data-testid="role-diff">
        {diff}
      </pre>
      <details>
        <summary className="text-sm cursor-pointer">展开查看完整 proposed YAML</summary>
        <pre className="pl-diff-viewer text-xs max-h-96 overflow-auto mt-2">{proposedYaml}</pre>
      </details>
      <div className="flex justify-end gap-2">
        <button type="button" className="pl-btn pl-btn--ghost" onClick={onCancel}>
          取消
        </button>
        <button
          type="button"
          className={`pl-btn ${primaryLabel === "确认删除" ? "pl-btn--danger" : "pl-btn--primary"}`}
          onClick={onSave}
          disabled={isPending}
        >
          {isPending ? "保存中…" : primaryLabel}
        </button>
      </div>
    </>
  );
}
