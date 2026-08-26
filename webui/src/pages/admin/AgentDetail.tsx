import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DiffViewer } from "../../components/DiffViewer";
import { PageHeader } from "../../components/PageHeader";
import { apiGet, apiPatch, apiDelete } from "../../lib/apiClient";
import type {
  AccessWriteAck,
  Agent,
  AgentConstraintsConfig,
  AgentPatch,
  EffectivePermissionsPreview,
  Role,
  RoleRowPolicyPredicate
} from "../../lib/types";
import { formatFinalRowsPreviewLabel, formatRowGrantPreviewLabel } from "../../lib/row-grant-preview";

type AgentDetailResponse = { agent: Agent; version: string };
type PatchDryRunResponse = {
  diff: string;
  proposedYaml: string;
  effectivePermissions?: EffectivePermissionsPreview;
};
type DiffPreview = PatchDryRunResponse & { patch: AgentPatch };
type PatchSaveResponse = AccessWriteAck & { agent: Agent };
type RolesResponse = { roles: Role[] };

/** Spec 100 TypedScalar — form keeps JSON scalar types; never trim/case-fold values. */
type ConstraintScalar = string | number | boolean;

type FormConstraintPredicate = {
  field: string;
  op: "eq" | "in";
  value: ConstraintScalar;
  values: ConstraintScalar[];
  /** When non-null, `in` list is edited as raw text (no trim on values). */
  inText: string | null;
};

type FormConstraintBinding = {
  connection: string;
  schema: string;
  names: string;
  predicates: FormConstraintPredicate[];
};

const EMPTY_CONSTRAINT_PRED: FormConstraintPredicate = {
  field: "",
  op: "eq",
  value: "",
  values: [],
  inText: null
};

function isConstraintScalar(value: unknown): value is ConstraintScalar {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function formatConstraintScalar(value: ConstraintScalar): string {
  return typeof value === "string" ? value : String(value);
}

/** Split `in` draft text; no trim. Drop only a trailing empty segment from a trailing delimiter. */
function splitConstraintListNoTrim(text: string): string[] {
  const parts = text.split(/[,，]/);
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function inValuesForSerialize(pred: FormConstraintPredicate): ConstraintScalar[] {
  if (pred.inText !== null) return splitConstraintListNoTrim(pred.inText);
  return pred.values;
}

function isMissingEqValue(value: ConstraintScalar): boolean {
  return typeof value === "string" && value.length === 0;
}

export function constraintsFromAgent(agent: Agent): FormConstraintBinding[] {
  const sources = agent.constraints?.sources;
  if (!Array.isArray(sources) || sources.length === 0) return [];
  return sources.map((binding) => ({
    connection: binding.connection ?? "",
    schema: binding.schema ?? "",
    names: Array.isArray(binding.names) ? binding.names.join(", ") : "",
    predicates: (binding.predicates ?? []).map((pred) => ({
      field: typeof pred.field === "string" ? pred.field : "",
      op: pred.op === "in" ? "in" : "eq",
      // Spec 100 §8.1 — preserve TypedScalar; do not String() coerce on load.
      value: pred.op === "eq" && isConstraintScalar(pred.value) ? pred.value : "",
      values:
        pred.op === "in" && Array.isArray(pred.values)
          ? pred.values.filter(isConstraintScalar)
          : [],
      inText: null
    }))
  }));
}

export function serializeConstraints(bindings: FormConstraintBinding[]): AgentConstraintsConfig | null {
  if (bindings.length === 0) return null;
  const sources = bindings.map((binding) => {
    const names = binding.names
      .split(/[,，\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    const predicates: RoleRowPolicyPredicate[] = binding.predicates.map((pred) => {
      if (pred.op === "in") {
        return {
          field: pred.field.trim(),
          op: "in" as const,
          // Values: no trim / filter(Boolean) (would drop 0 / false).
          values: inValuesForSerialize(pred)
        };
      }
      return {
        field: pred.field.trim(),
        op: "eq" as const,
        value: pred.value
      };
    });
    return {
      connection: binding.connection.trim(),
      ...(binding.schema.trim() ? { schema: binding.schema.trim() } : {}),
      names,
      predicates
    };
  });
  return { sources };
}

function validateConstraintsForm(bindings: FormConstraintBinding[]): string | null {
  for (let i = 0; i < bindings.length; i += 1) {
    const row = bindings[i]!;
    if (!row.connection.trim()) return `强制约束源 ${i + 1}：缺少 connection`;
    const names = row.names.split(/[,，\s]+/).map((item) => item.trim()).filter(Boolean);
    if (names.length === 0) return `强制约束源 ${i + 1}：names 不能为空`;
    if (row.predicates.length === 0) return `强制约束源 ${i + 1}：须至少一条谓词`;
    for (let j = 0; j < row.predicates.length; j += 1) {
      const pred = row.predicates[j]!;
      if (!pred.field.trim()) return `强制约束源 ${i + 1}：第 ${j + 1} 条缺少字段`;
      if (pred.op === "eq" && isMissingEqValue(pred.value)) {
        return `强制约束源 ${i + 1}：第 ${j + 1} 条 eq 缺少取值`;
      }
      if (pred.op === "in" && inValuesForSerialize(pred).length === 0) {
        return `强制约束源 ${i + 1}：第 ${j + 1} 条 in 缺少取值列表`;
      }
    }
  }
  return null;
}

function sameConstraints(a: FormConstraintBinding[], b: FormConstraintBinding[]): boolean {
  return JSON.stringify(serializeConstraints(a)) === JSON.stringify(serializeConstraints(b));
}

/** Spec 14 §0.3 — success only when runtimeAck === true (missing/false both fail). */
function toastAccessWriteAck(result: AccessWriteAck, fallback = "已保存"): boolean {
  if (result.runtimeAck !== true) {
    toast.error("保存未生效：runtime 未确认（runtimeAck≠true）。磁盘可能已回滚，请检查策略降级 banner。");
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

function buildChangeSummary(
  patch: AgentPatch,
  currentAgent: Agent
): Array<{ field: string; from: string; to: string }> {
  const items: Array<{ field: string; from: string; to: string }> = [];
  if (patch.name !== undefined) items.push({ field: "名称", from: currentAgent.name, to: patch.name });
  if (patch.note !== undefined) items.push({ field: "备注", from: currentAgent.note ?? "—", to: patch.note || "—" });
  if (patch.enabled !== undefined) {
    items.push({ field: "状态", from: currentAgent.enabled ? "已启用" : "已禁用", to: patch.enabled ? "已启用" : "已禁用" });
  }
  if (patch.role !== undefined) items.push({ field: "角色", from: currentAgent.role ?? "旧ACL", to: patch.role });
  if (patch.constraints !== undefined) items.push({ field: "强制约束", from: "—", to: "已变更" });
  return items;
}

export function AgentDetail() {
  const { userId } = useParams<{ userId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const activeTab: Tab = tabFromSearch(location.search);
  const [leaveConfirmVisible, setLeaveConfirmVisible] = useState(false);
  const [pendingNavTarget, setPendingNavTarget] = useState<string | null>(null);

  function goToTab(tab: Tab) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "info") next.delete("tab");
        else next.set("tab", tab);
        return next;
      },
      { replace: false }
    );
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "agent", userId],
    queryFn: () => apiGet<AgentDetailResponse>(`/api/admin/agents/${userId}`)
  });

  const { data: rolesData } = useQuery({
    queryKey: ["admin", "roles", "formal"],
    queryFn: () => apiGet<RolesResponse>("/api/admin/roles?includeTemplates=false")
  });

  const [editName, setEditName] = useState<string | null>(null);
  const [editNote, setEditNote] = useState<string | null>(null);
  const [editEnabled, setEditEnabled] = useState<boolean | null>(null);
  const [editRole, setEditRole] = useState<string | null>(null);
  /** null = untouched; array (possibly empty) = dirty Constraints editor. */
  const [editConstraints, setEditConstraints] = useState<FormConstraintBinding[] | null>(null);
  const [diffPreview, setDiffPreview] = useState<DiffPreview | null>(null);
  const [confirmSave, setConfirmSave] = useState<DiffPreview | null>(null);
  const [selectedTokenLabels, setSelectedTokenLabels] = useState<string[]>([]);

  const agent = data?.agent;
  const version = data?.version;
  const constraintsDirty =
    editConstraints !== null
    && (!agent || !sameConstraints(editConstraints, constraintsFromAgent(agent)));
  const hasEdits =
    editName !== null
    || editNote !== null
    || editEnabled !== null
    || editRole !== null
    || constraintsDirty;

  function buildPatch(): AgentPatch {
    const patch: AgentPatch = {};
    if (editName !== null) patch.name = editName;
    if (editNote !== null) patch.note = editNote;
    if (editEnabled !== null) patch.enabled = editEnabled;
    if (editRole !== null) patch.role = editRole;
    if (editConstraints !== null && agent) {
      const baseline = constraintsFromAgent(agent);
      if (!sameConstraints(editConstraints, baseline)) {
        patch.constraints = serializeConstraints(editConstraints);
      }
    }
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

  function updateEditConstraints(next: FormConstraintBinding[]) {
    clearStaleDiffPreview();
    setEditConstraints(next);
  }

  function clearEditForm() {
    setEditName(null);
    setEditNote(null);
    setEditEnabled(null);
    setEditRole(null);
    setEditConstraints(null);
  }

  const previewMutation = useMutation({
    mutationFn: async (patch: AgentPatch) => {
      const data = await apiPatch<PatchDryRunResponse>(`/api/admin/agents/${userId}`, { dryRun: true, version, patch });
      return { ...data, patch };
    },
    onSuccess: (data) => {
      setDiffPreview(data);
      goToTab("diff");
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
      goToTab("info");
      clearEditForm();
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
      clearEditForm();
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
      toast.success(`Token "${label}" 已撤销，新请求将立即拒绝。`);
      setSelectedTokenLabels((prev) => prev.filter((item) => item !== label));
      void queryClient.invalidateQueries({ queryKey: ["admin", "agent", userId] });
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const bulkRevokeMutation = useMutation({
    mutationFn: async (labels: string[]) => {
      for (const label of labels) {
        await apiDelete<{ written: boolean; revokedAt: string }>(
          `/api/admin/agents/${userId}/tokens/${encodeURIComponent(label)}`
        );
      }
      return labels;
    },
    onSuccess: (labels) => {
      toast.success(`已撤销 ${labels.length} 个 Token，新请求将立即拒绝。`);
      setSelectedTokenLabels([]);
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

  function handleBulkRevoke() {
    if (selectedTokenLabels.length === 0) return;
    if (!confirm(`确定要撤销选中的 ${selectedTokenLabels.length} 个 Token 吗？`)) return;
    bulkRevokeMutation.mutate(selectedTokenLabels);
  }

  function toggleTokenSelection(label: string) {
    setSelectedTokenLabels((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  }

  function handleDiscardEdits() {
    clearEditForm();
    setDiffPreview(null);
    setConfirmSave(null);
  }

  function handleSave() {
    if (!agent) return;
    if (editConstraints !== null) {
      const formError = validateConstraintsForm(editConstraints);
      if (formError) {
        toast.error(formError);
        return;
      }
    }
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      toast.message("没有可保存的修改");
      return;
    }
    if (patchChangesRole(patch, agent) || patch.constraints !== undefined) {
      confirmPreviewMutation.mutate(patch);
    } else {
      directSaveMutation.mutate(patch);
    }
  }

  function handleViewDiff() {
    if (editConstraints !== null) {
      const formError = validateConstraintsForm(editConstraints);
      if (formError) {
        toast.error(formError);
        return;
      }
    }
    previewMutation.mutate(buildPatch());
  }

  // Normalize unknown ?tab= values to info via URL replace.
  useEffect(() => {
    const rawTab = new URLSearchParams(location.search).get("tab");
    if (rawTab && !["info", "tokens", "permissions", "diff"].includes(rawTab)) {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete("tab");
        return next;
      }, { replace: true });
    }
  }, [location.search, setSearchParams]);

  // beforeunload guard when there are unsaved edits.
  useEffect(() => {
    if (!hasEdits) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [hasEdits]);

  // Capture-phase <a> intercept: prompt when navigating away from this agent's page.
  useEffect(() => {
    if (!hasEdits) return;
    const agentPathname = `/admin/agents/${userId}`;
    function onCapture(e: MouseEvent) {
      const anchor = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      try {
        const url = new URL(href, window.location.href);
        if (url.pathname === agentPathname) return;
      } catch {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      setPendingNavTarget(href);
      setLeaveConfirmVisible(true);
    }
    document.addEventListener("click", onCapture, true);
    return () => document.removeEventListener("click", onCapture, true);
  }, [hasEdits, userId]);

  // Cmd+S / Ctrl+S mirrors the sticky-bar save action (low-risk one-step or role confirm).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "s") return;
      if (!agent) return;
      if (
        editName === null
        && editNote === null
        && editEnabled === null
        && editRole === null
        && editConstraints === null
      ) return;
      e.preventDefault();
      handleSave();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, editName, editNote, editEnabled, editRole, editConstraints, version]);

  if (isLoading) return <div className="pl-notice">加载中…</div>;
  if (error || !agent) return <div className="pl-notice">加载失败：{error ? (error as Error).message : "Agent 不存在"}</div>;

  const roles = rolesData?.roles ?? [];
  const formalRoles = roles.filter((r) => r.source !== "template");
  const currentRoleInFormalList = !agent.role || formalRoles.some((r) => r.id === agent.role);
  const currentRole = editRole !== null ? editRole : agent.role;
  const effective = agent.effectivePermissions;
  const legacyWildcard = agent.allow?.tables?.includes("*") || agent.allow?.tools?.includes("*");
  const constraintRows = editConstraints !== null ? editConstraints : constraintsFromAgent(agent);
  const groupedSources = effective ? groupSourcesByConnectionAndSchema(effective.sources) : [];
  const dryRunEffective = diffPreview?.effectivePermissions ?? confirmSave?.effectivePermissions;

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
            <Link
              to={`/admin/mcp-playground?agentId=${encodeURIComponent(agent.id)}&mode=dry-run`}
              className="pl-btn pl-btn--secondary text-sm notranslate"
              translate="no"
              data-testid="agent-detail-mcp-playground"
            >
              在 MCP 调试台试调
            </Link>
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

      <div className="pl-admin-tabbar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.key}
            aria-controls={`tab-panel-${tab.key}`}
            id={`tab-${tab.key}`}
            className={`pl-admin-tab ${activeTab === tab.key ? "pl-admin-tab--active" : ""}`}
            onClick={() => goToTab(tab.key)}
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

      <div className="pl-admin-tab-panel" role="tabpanel" id={`tab-panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`}>
        {activeTab === "info" && (
          <div className="grid gap-4 max-w-3xl pb-32">
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
                  {!currentRoleInFormalList && agent.role && (
                    <option value={agent.role} disabled>
                      {agent.role} · 当前绑定（已失效）
                    </option>
                  )}
                  {formalRoles.map((role) => (
                    <option key={role.id} value={role.id} disabled={role.invalid}>
                      {role.id}
                      {role.invalid ? " · 待修复" : ""}
                    </option>
                  ))}
                </select>
                {!agent.role && agent.allow && (
                  <span className="text-xs text-fg-muted">
                    旧 ACL 只读兼容；保存角色后会移除该 <span className="notranslate" translate="no">Agent</span> 的 legacy allow。
                  </span>
                )}
                {!currentRoleInFormalList && agent.role && (
                  <div className="flex items-center gap-1 text-xs text-warning">
                    当前角色不在正式列表中；
                    <Link to={`/admin/roles/${agent.role}`} className="text-accent underline">
                      前往修复 →
                    </Link>
                  </div>
                )}
              </label>
            </div>

            <div className="pl-card grid gap-3" data-testid="agent-constraints-editor">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">
                    <span className="notranslate" translate="no">Agent</span>
                    {" "}强制约束
                    <span className="ml-2 font-mono text-xs text-fg-muted notranslate" translate="no">
                      constraints
                    </span>
                  </div>
                  <p className="text-xs text-fg-muted mt-1">
                    对人级最终行约束做 AND 收紧；多 Role 不会自动对人级行集做 AND。配置成功只表示编译通过，
                    <strong className="font-medium"> 不表示行级取数已生效</strong>。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost text-xs"
                    onClick={() =>
                      updateEditConstraints([
                        ...constraintRows,
                        {
                          connection: "",
                          schema: "",
                          names: "",
                          predicates: [{ ...EMPTY_CONSTRAINT_PRED }]
                        }
                      ])
                    }
                  >
                    添加源约束
                  </button>
                  {constraintRows.length > 0 && (
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost text-xs"
                      onClick={() => updateEditConstraints([])}
                    >
                      清除全部
                    </button>
                  )}
                </div>
              </div>

              {constraintRows.length === 0 ? (
                <p className="text-sm text-fg-muted">未配置强制约束（等同 Constraints≡TRUE）。</p>
              ) : (
                <ul className="grid gap-4">
                  {constraintRows.map((row, idx) => (
                    <li key={idx} className="grid gap-2 rounded-md border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">源约束 {idx + 1}</span>
                        <button
                          type="button"
                          className="pl-btn pl-btn--ghost text-xs"
                          onClick={() => updateEditConstraints(constraintRows.filter((_, i) => i !== idx))}
                        >
                          删除
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <label className="grid gap-1 text-xs">
                          <span className="notranslate" translate="no">connection</span>
                          <input
                            className="pl-input font-mono text-xs"
                            value={row.connection}
                            onChange={(e) => {
                              const next = [...constraintRows];
                              next[idx] = { ...row, connection: e.target.value };
                              updateEditConstraints(next);
                            }}
                          />
                        </label>
                        <label className="grid gap-1 text-xs">
                          <span className="notranslate" translate="no">schema</span>
                          <input
                            className="pl-input font-mono text-xs"
                            value={row.schema}
                            onChange={(e) => {
                              const next = [...constraintRows];
                              next[idx] = { ...row, schema: e.target.value };
                              updateEditConstraints(next);
                            }}
                          />
                        </label>
                        <label className="grid gap-1 text-xs">
                          <span className="notranslate" translate="no">names</span>
                          <input
                            className="pl-input font-mono text-xs"
                            placeholder="comma-separated"
                            value={row.names}
                            onChange={(e) => {
                              const next = [...constraintRows];
                              next[idx] = { ...row, names: e.target.value };
                              updateEditConstraints(next);
                            }}
                          />
                        </label>
                      </div>
                      <div className="grid gap-2">
                        <div className="text-xs text-fg-muted">
                          谓词（同组 AND；op 仅
                          <span className="mx-1 font-mono notranslate" translate="no">eq</span>/
                          <span className="mx-1 font-mono notranslate" translate="no">in</span>）
                        </div>
                        {row.predicates.map((pred, predIdx) => (
                          <div key={predIdx} className="grid gap-2 sm:grid-cols-[1fr_6rem_1fr_auto] items-end">
                            <label className="grid gap-1 text-xs">
                              <span>字段</span>
                              <input
                                className="pl-input font-mono text-xs"
                                value={pred.field}
                                onChange={(e) => {
                                  const predicates = [...row.predicates];
                                  predicates[predIdx] = { ...pred, field: e.target.value };
                                  const next = [...constraintRows];
                                  next[idx] = { ...row, predicates };
                                  updateEditConstraints(next);
                                }}
                              />
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span className="notranslate" translate="no">op</span>
                              <select
                                className="pl-input text-xs notranslate"
                                translate="no"
                                value={pred.op}
                                onChange={(e) => {
                                  const op = e.target.value === "in" ? "in" : "eq";
                                  const predicates = [...row.predicates];
                                  predicates[predIdx] = {
                                    ...pred,
                                    op,
                                    value: op === "eq" ? pred.value : "",
                                    values: op === "in" ? pred.values : [],
                                    inText: op === "in" ? (pred.inText ?? "") : null
                                  };
                                  const next = [...constraintRows];
                                  next[idx] = { ...row, predicates };
                                  updateEditConstraints(next);
                                }}
                              >
                                <option value="eq">eq</option>
                                <option value="in">in</option>
                              </select>
                            </label>
                            <label className="grid gap-1 text-xs">
                              <span>{pred.op === "in" ? "取值列表（逗号分隔）" : "取值"}</span>
                              {pred.op === "eq" ? (
                                <input
                                  className="pl-input font-mono text-xs"
                                  value={formatConstraintScalar(pred.value)}
                                  onChange={(e) => {
                                    // Text input yields string; typed scalars preserved until edited.
                                    const predicates = [...row.predicates];
                                    predicates[predIdx] = { ...pred, value: e.target.value };
                                    const next = [...constraintRows];
                                    next[idx] = { ...row, predicates };
                                    updateEditConstraints(next);
                                  }}
                                />
                              ) : (
                                <input
                                  className="pl-input font-mono text-xs"
                                  value={
                                    pred.inText !== null
                                      ? pred.inText
                                      : pred.values.map(formatConstraintScalar).join(",")
                                  }
                                  onChange={(e) => {
                                    // Spec 100 — no trim on values; keep draft until serialize.
                                    const predicates = [...row.predicates];
                                    predicates[predIdx] = { ...pred, inText: e.target.value };
                                    const next = [...constraintRows];
                                    next[idx] = { ...row, predicates };
                                    updateEditConstraints(next);
                                  }}
                                />
                              )}
                            </label>
                            <button
                              type="button"
                              className="pl-btn pl-btn--ghost text-xs"
                              disabled={row.predicates.length <= 1}
                              onClick={() => {
                                const next = [...constraintRows];
                                next[idx] = {
                                  ...row,
                                  predicates: row.predicates.filter((_, i) => i !== predIdx)
                                };
                                updateEditConstraints(next);
                              }}
                            >
                              删谓词
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          className="pl-btn pl-btn--ghost text-xs w-fit"
                          onClick={() => {
                            const next = [...constraintRows];
                            next[idx] = {
                              ...row,
                              predicates: [...row.predicates, { ...EMPTY_CONSTRAINT_PRED }]
                            };
                            updateEditConstraints(next);
                          }}
                        >
                          添加谓词
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === "tokens" && (
          <div className="grid gap-4 max-w-3xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-fg-muted">
                当前活跃 token：{agent.tokens.length} 个。按设备/客户端定向吊销；已撤销的 token 在此版本不展示历史，可在变更历史中查询。
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedTokenLabels.length > 0 ? (
                  <button
                    type="button"
                    className="pl-btn pl-btn--danger text-sm notranslate"
                    translate="no"
                    onClick={handleBulkRevoke}
                    disabled={bulkRevokeMutation.isPending}
                    aria-label={`批量撤销 ${selectedTokenLabels.length} 个 Token`}
                  >
                    撤销选中（{selectedTokenLabels.length}）
                  </button>
                ) : null}
                <Link
                  to={`/admin/agents/${userId}/tokens/new`}
                  className="pl-btn pl-btn--primary text-sm notranslate"
                  translate="no"
                  aria-label="生成新 Token"
                >
                  + 生成新 <span className="notranslate" translate="no">Token</span>
                </Link>
              </div>
            </div>
            {agent.tokens.length === 0 ? (
              <p className="text-sm text-fg-muted">暂无 token，点「生成新 <span className="notranslate" translate="no">Token</span>」创建。</p>
            ) : (
              <div className="grid gap-2">
                {agent.tokens.map((token) => (
                  <div key={token.hash} className="pl-card flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedTokenLabels.includes(token.label)}
                        onChange={() => toggleTokenSelection(token.label)}
                        aria-label={`选择 ${token.label}`}
                      />
                      <div className="grid gap-2 min-w-0">
                        <div className="grid gap-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">身份</div>
                          <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{token.label}</span>
                          <span className="pl-status-badge pl-status-done">活跃</span>
                          </div>
                          <div className="text-xs text-fg-muted">
                            <span>创建 {token.created}</span>
                            {token.expires_at && <span> · 过期 {token.expires_at}</span>}
                          </div>
                          <div className="text-xs text-fg-muted">
                            备注：
                            {token.device_name ? (
                              <span className="notranslate" translate="no">{token.device_name}</span>
                            ) : (
                              "—"
                            )}
                          </div>
                        </div>
                        <div className="grid gap-1">
                          <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted">最近使用</div>
                          <div className="text-xs text-fg-muted">
                            <span className="notranslate" translate="no">Agent</span> 类型：
                            <span className="notranslate" translate="no">
                              {token.last_client
                                ? `${token.last_client}${token.last_client_version ? ` ${token.last_client_version}` : ""}`
                                : "—"}
                            </span>
                          </div>
                          <div className="text-xs text-fg-muted">
                            最近设备名：
                            {token.last_device_name_seen ? (
                              <span className="notranslate" translate="no">{token.last_device_name_seen}</span>
                            ) : (
                              "—"
                            )}
                          </div>
                          <div className="text-xs text-fg-muted">
                            最近使用：
                            {token.last_used ? new Date(token.last_used).toLocaleString("zh-CN") : "—"}
                            {token.last_tool ? ` · ${token.last_tool}` : ""}
                            {token.last_outcome ? ` · ${token.last_outcome}` : ""}
                          </div>
                        </div>
                        <details className="text-xs text-fg-muted">
                          <summary className="cursor-pointer select-none">安全信息 / 技术详情</summary>
                          <div className="grid gap-1 mt-1 pl-2">
                            <div>
                              访问 IP：
                              <span className="notranslate font-mono" translate="no">
                                {token.last_ip ?? "—"}
                              </span>
                              {token.distinct_ips_7d != null && token.distinct_ips_7d > 1 ? (
                                <span className="text-warning"> · 近 7 日 {token.distinct_ips_7d} 个 IP</span>
                              ) : null}
                            </div>
                            {token.last_user_agent ? (
                              <div className="truncate" title={token.last_user_agent}>
                                <span className="notranslate" translate="no">User-Agent</span>：
                                <span className="notranslate" translate="no">{token.last_user_agent}</span>
                              </div>
                            ) : null}
                            <div className="font-mono notranslate" translate="no">
                              hash: [REDACTED]
                            </div>
                          </div>
                        </details>
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
                <div>
                  <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase mb-2">权限摘要</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="pl-metric-card"><span>工具</span><strong>{effective.tools.length}</strong><small>{effective.roleIds.join(", ") || "legacy"}</small></div>
                    <div className="pl-metric-card"><span>连接</span><strong>{effective.connections.length}</strong><small>{effective.connections.join(", ") || "—"}</small></div>
                    <div className="pl-metric-card"><span className="notranslate" translate="no">Source</span><strong>{effective.sources.length}</strong><small>{effective.snapshotHash.slice(0, 12)}</small></div>
                  </div>
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
                  <div className="text-sm font-medium">数据能力</div>
                  {(effective.capabilities?.length ?? 0) === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {legacyWildcard
                        ? "legacy tables:* — capability 列表为空（按设计）。"
                        : "无 DataPlane capability。"}
                    </p>
                  ) : (
                    <>
                      <ul className="grid gap-1 text-sm">
                        {effective.capabilities!.map((cap) => (
                          <li key={`${cap.tool}:${cap.sourceKey}`}>
                            <span className="notranslate" translate="no">{cap.tool}</span>
                            {" × "}
                            <span className="notranslate" translate="no">{cap.sourceKey}</span>
                            {cap.constraintsSummary ? (
                              <span className="notranslate" translate="no">{` · constraints=${cap.constraintsSummary}`}</span>
                            ) : null}
                            {cap.protected ? " · protected" : ""}
                          </li>
                        ))}
                      </ul>
                      <details>
                        <summary className="text-xs text-fg-muted cursor-pointer select-none">技术详情</summary>
                        <div className="mt-2 grid gap-1">
                          {effective.capabilityDigest ? (
                            <div className="font-mono text-xs notranslate" translate="no">
                              {`digest=${effective.capabilityDigest}`}
                            </div>
                          ) : null}
                          <ul className="grid gap-1 font-mono text-xs">
                            {effective.capabilities!.map((cap) => (
                              <li key={`tech:${cap.tool}:${cap.sourceKey}`} className="notranslate" translate="no">
                                {cap.tool} × {cap.sourceKey}
                                {" · rowGrant="}
                                {formatRowGrantPreviewLabel(cap.rowGrant)}
                                {" · FinalRows="}
                                {formatFinalRowsPreviewLabel(cap.finalRows, cap.rowGrant)}
                                {cap.protected ? " · protected" : ""}
                                {cap.constraintsSummary ? ` · constraints=${cap.constraintsSummary}` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    </>
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
                {(() => {
                  const summary = buildChangeSummary(diffPreview.patch, agent);
                  return summary.length > 0 ? (
                    <div className="pl-card grid gap-2" data-testid="diff-change-summary">
                      <div className="text-sm font-medium">变更摘要</div>
                      <ul className="grid gap-1 text-sm">
                        {summary.map(({ field, from, to }) => (
                          <li key={field} className="flex flex-wrap items-center gap-1">
                            <span className="font-medium">{field}</span>
                            <span className="text-fg-muted">{from}</span>
                            <span>→</span>
                            <span>{to}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null;
                })()}
                <details>
                  <summary className="text-xs text-fg-muted cursor-pointer select-none mb-2 notranslate" translate="no">
                    技术详情（access.yaml diff）
                  </summary>
                  <DiffViewer diff={diffPreview.diff} />
                </details>
                {dryRunEffective?.capabilities && dryRunEffective.capabilities.length > 0 && (
                  <div className="pl-card grid gap-2" data-testid="dryrun-finalrows-preview">
                    <div className="text-sm font-medium">
                      dryRun
                      <span className="mx-1 font-mono notranslate" translate="no">FinalRows</span>
                      摘要
                    </div>
                    <p className="text-xs text-fg-muted">编译预览；不表示行级取数已生效。</p>
                    <ul className="grid gap-1 font-mono text-xs">
                      {dryRunEffective.capabilities.map((cap) => (
                        <li key={`dry:${cap.tool}:${cap.sourceKey}`} className="notranslate" translate="no">
                          {cap.tool} × {cap.sourceKey}
                          {" · FinalRows="}
                          {formatFinalRowsPreviewLabel(cap.finalRows, cap.rowGrant)}
                          {cap.protected ? " · protected" : ""}
                          {cap.constraintsSummary ? ` · constraints=${cap.constraintsSummary}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    className="pl-btn pl-btn--ghost"
                    onClick={() => {
                      setDiffPreview(null);
                      goToTab("info");
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
              <p className="text-sm text-fg-muted">在其他标签页编辑后，可点「查看变更 diff」审阅，或保存角色 / 强制约束变更时在确认框中查看 diff。</p>
            )}
          </div>
        )}
      </div>

      {hasEdits && activeTab !== "diff" && !confirmSave && (
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

      {leaveConfirmVisible && (
        <div className="pl-modal-backdrop z-[70]" data-testid="agent-leave-confirm-modal">
          <div className="pl-modal-panel max-w-sm">
            <h2 className="text-lg font-semibold mb-2">确认离开</h2>
            <p className="text-sm text-fg-muted mb-4">您有未保存的修改，离开后将丢失。</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="pl-btn pl-btn--ghost"
                onClick={() => {
                  setLeaveConfirmVisible(false);
                  setPendingNavTarget(null);
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="pl-btn pl-btn--danger"
                onClick={() => {
                  const target = pendingNavTarget;
                  setLeaveConfirmVisible(false);
                  setPendingNavTarget(null);
                  if (target) navigate(target);
                }}
              >
                确认离开
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmSave && (
        <div className="pl-modal-backdrop z-[60]" data-testid="agent-save-confirm-modal">
          <div className="pl-modal-panel max-w-2xl max-h-[90vh] flex flex-col">
            <h2 className="text-lg font-semibold mb-2 shrink-0">
              {confirmSave.patch.constraints !== undefined ? "确认强制约束变更" : "确认角色变更"}
            </h2>
            <p className="text-sm text-fg-muted mb-4 shrink-0 notranslate" translate="no">以下改动将写入 access.yaml，确认后才会落盘。</p>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <DiffViewer diff={confirmSave.diff} />
              {confirmSave.effectivePermissions?.capabilities
                && confirmSave.effectivePermissions.capabilities.length > 0 && (
                <div className="mt-3 grid gap-1" data-testid="confirm-finalrows-preview">
                  <div className="text-xs text-fg-muted">
                    编译态
                    <span className="mx-1 font-mono notranslate" translate="no">FinalRows</span>
                    （不表示行级取数已生效）
                  </div>
                  <ul className="grid gap-1 font-mono text-xs">
                    {confirmSave.effectivePermissions.capabilities.map((cap) => (
                      <li key={`c:${cap.tool}:${cap.sourceKey}`} className="notranslate" translate="no">
                        {cap.sourceKey}
                        {" · FinalRows="}
                        {formatFinalRowsPreviewLabel(cap.finalRows, cap.rowGrant)}
                        {cap.protected ? " · protected" : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-4 shrink-0">
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
                data-testid="agent-save-confirm-submit"
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
