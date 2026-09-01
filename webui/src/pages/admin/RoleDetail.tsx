import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/apiClient";
import type {
  AccessWriteAck,
  ConnectionInfo,
  ConnectionTablesResponse,
  ConnectionsResponse,
  McpToolInfo,
  RoleAllowConfig,
  RoleDetail as RoleDetailType,
  RoleRowPolicyPredicate,
  RoleSelector
} from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { TagInput } from "../../components/TagInput";
import { AssetHierarchyPicker } from "../../components/AssetHierarchyPicker";
import { CheckboxCandidatePicker } from "../../components/CheckboxCandidatePicker";
import { formatRowGrantPreviewLabel } from "../../lib/row-grant-preview";

type Tab = "identity" | "permissions" | "effective" | "usage" | "diff";

/** Returns true only when runtimeAck confirms the save; callers must not navigate/clear on false. */
function toastAccessWriteAck(result: AccessWriteAck, fallback: string): boolean {
  if (result.runtimeAck === false) {
    toast.error("保存未生效：runtime 未确认（runtimeAck=false）。磁盘可能已回滚，请检查策略降级 banner。");
    return false;
  }
  const version = result.policyVersion ? ` · policyVersion=${result.policyVersion.slice(0, 12)}…` : "";
  toast.success(`${fallback}${version}`);
  return true;
}

function visibleTabsForMode(
  mode: "create" | "edit" | "copy" | "delete",
  source: RoleDetailType["source"] | undefined
): Array<{ key: Tab; label: string }> {
  if (mode === "delete") {
    return [
      { key: "usage", label: "使用情况" },
      { key: "diff", label: "变更预览" }
    ];
  }
  if (mode === "create" || mode === "copy") {
    return [
      { key: "identity", label: "基本信息" },
      { key: "permissions", label: "权限配置" },
      { key: "diff", label: "变更预览" }
    ];
  }
  if (mode === "edit" && source === "template") {
    return [
      { key: "identity", label: "基本信息" },
      { key: "effective", label: "生效边界" },
      { key: "usage", label: "使用情况" }
    ];
  }
  return [
    { key: "identity", label: "基本信息" },
    { key: "permissions", label: "权限配置" },
    { key: "effective", label: "生效边界" },
    { key: "usage", label: "使用情况" },
    { key: "diff", label: "变更预览" }
  ];
}

type FormRowPredicate = {
  field: string;
  op: "eq" | "in";
  value: string;
  values: string[];
};

type RoleFormState = {
  roleId: string;
  description: string;
  connections: string[];
  tools: string[];
  selectors: Array<{
    connection: string;
    schema: string;
    kind: "names" | "prefix";
    names: string[];
    prefix: string;
    rowAccess: "all" | "scoped";
    predicates: FormRowPredicate[];
  }>;
};

const EMPTY_PREDICATE: FormRowPredicate = { field: "", op: "eq", value: "", values: [] };

function predicatesFromSelector(selector: RoleSelector): FormRowPredicate[] {
  const policy = "row_policy" in selector ? selector.row_policy : undefined;
  if (!policy?.predicates?.length) return [];
  return policy.predicates.map((pred) => ({
    field: typeof pred.field === "string" ? pred.field : "",
    op: pred.op === "in" ? "in" : "eq",
    value: pred.op === "eq" && pred.value !== undefined ? String(pred.value) : "",
    values:
      pred.op === "in" && Array.isArray(pred.values)
        ? pred.values.map((item) => String(item))
        : []
  }));
}

function rowAccessFromSelector(selector: RoleSelector): "all" | "scoped" {
  return selector.row_access === "scoped" ? "scoped" : "all";
}

function serializePredicates(predicates: FormRowPredicate[]): RoleRowPolicyPredicate[] {
  return predicates.map((pred) => {
    if (pred.op === "in") {
      return {
        field: pred.field.trim(),
        op: "in" as const,
        values: pred.values.map((item) => item.trim()).filter(Boolean)
      };
    }
    return {
      field: pred.field.trim(),
      op: "eq" as const,
      value: pred.value.trim()
    };
  });
}

function validateScopedSelectors(form: RoleFormState): string | null {
  for (let i = 0; i < form.selectors.length; i += 1) {
    const row = form.selectors[i]!;
    if (row.rowAccess !== "scoped") continue;
    if (row.predicates.length === 0) {
      return `表范围 ${i + 1}：限定行须至少一条行级策略条件`;
    }
    for (let j = 0; j < row.predicates.length; j += 1) {
      const pred = row.predicates[j]!;
      if (!pred.field.trim()) {
        return `表范围 ${i + 1}：第 ${j + 1} 条条件缺少字段`;
      }
      if (pred.op === "eq" && !pred.value.trim()) {
        return `表范围 ${i + 1}：第 ${j + 1} 条 eq 条件缺少取值`;
      }
      if (pred.op === "in" && pred.values.map((item) => item.trim()).filter(Boolean).length === 0) {
        return `表范围 ${i + 1}：第 ${j + 1} 条 in 条件缺少取值列表`;
      }
    }
  }
  return null;
}

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
  connections: [],
  tools: [],
  selectors: []
};

function roleWarningDiagnosis(warning: string): { diagnosis: string; technical: string } {
  const trimmed = warning.trim();
  if (trimmed.startsWith("role_resolution_failed")) {
    return {
      diagnosis: "权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。",
      technical: trimmed
    };
  }
  return {
    diagnosis: "权限配置需检查：系统返回了未识别的校验信息。",
    technical: trimmed
  };
}

function suggestRoleIdFromDescription(description: string): string {
  const ascii = description
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 64);
  return ascii;
}

function selectorsToForm(selectors: RoleSelector[] | undefined): RoleFormState["selectors"] {
  if (!selectors) return [];
  return selectors.map((selector) => {
    const rowAccess = rowAccessFromSelector(selector);
    const predicates = predicatesFromSelector(selector);
    if ("names" in selector) {
      return {
        connection: selector.connection ?? "",
        schema: selector.schema,
        kind: "names" as const,
        names: [...selector.names],
        prefix: "",
        rowAccess,
        predicates: rowAccess === "scoped" ? (predicates.length > 0 ? predicates : [{ ...EMPTY_PREDICATE }]) : []
      };
    }
    return {
      connection: selector.connection ?? "",
      schema: selector.schema,
      kind: "prefix" as const,
      names: [],
      prefix: selector.prefix,
      rowAccess,
      predicates: rowAccess === "scoped" ? (predicates.length > 0 ? predicates : [{ ...EMPTY_PREDICATE }]) : []
    };
  });
}

function formToAllow(state: RoleFormState): RoleAllowConfig {
  const connections = state.connections.map((item) => item.trim()).filter(Boolean);
  const tools = state.tools.map((item) => item.trim()).filter(Boolean);
  const tableSelectors: RoleSelector[] = state.selectors
    .filter((row) => row.schema.trim().length > 0)
    .map((row) => {
      const rowFields =
        row.rowAccess === "scoped"
          ? {
              row_access: "scoped" as const,
              row_policy: { predicates: serializePredicates(row.predicates) }
            }
          : { row_access: "all" as const };
      if (row.kind === "prefix") {
        return {
          connection: row.connection.trim() || undefined,
          schema: row.schema.trim(),
          prefix: row.prefix.trim(),
          ...rowFields
        } as RoleSelector;
      }
      return {
        connection: row.connection.trim() || undefined,
        schema: row.schema.trim(),
        names: row.names.map((item) => item.trim()).filter(Boolean),
        ...rowFields
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
    connections: [...(detail.role.allow.connections ?? [])],
    tools: [...(detail.role.allow.tools ?? [])],
    selectors: selectorsToForm(detail.role.allow.tableSelectors)
  };
}

function sameStringList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => item === b[index]);
}

function samePredicates(a: FormRowPredicate[], b: FormRowPredicate[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index]!;
    return (
      item.field === other.field &&
      item.op === other.op &&
      item.value === other.value &&
      sameStringList(item.values, other.values)
    );
  });
}

function isRoleDirty(form: RoleFormState, detail: RoleDetailType | null, mode: "create" | "edit" | "copy" | "delete"): boolean {
  if (mode === "create" || mode === "copy") return true;
  if (!detail) return false;
  const current = initFormFromDetail(detail);
  if (form.description !== current.description) return true;
  if (!sameStringList(form.connections, current.connections)) return true;
  if (!sameStringList(form.tools, current.tools)) return true;
  if (form.selectors.length !== current.selectors.length) return true;
  for (let i = 0; i < form.selectors.length; i += 1) {
    const a = form.selectors[i]!;
    const b = current.selectors[i]!;
    if (a.connection !== b.connection || a.schema !== b.schema || a.kind !== b.kind) return true;
    if (a.prefix !== b.prefix || !sameStringList(a.names, b.names)) return true;
    if (a.rowAccess !== b.rowAccess || !samePredicates(a.predicates, b.predicates)) return true;
  }
  return false;
}

function toggleInList(list: string[], value: string, enabled: boolean): string[] {
  if (enabled) {
    return list.includes(value) ? list : [...list, value];
  }
  return list.filter((item) => item !== value);
}

function tablesForSchema(flatTables: string[], schema: string): string[] {
  const prefix = `${schema}.`;
  return flatTables
    .filter((item) => item.startsWith(prefix))
    .map((item) => item.slice(prefix.length))
    .filter(Boolean);
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
  const [activeTab, setActiveTab] = useState<Tab>("identity");
  const [diffPreview, setDiffPreview] = useState<PatchPreview | null>(null);
  const [createPreview, setCreatePreview] = useState<CreatePreview | CopyPreview | null>(null);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);

  const connectionsQuery = useQuery({
    queryKey: ["connections"],
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections")
  });
  const mcpToolsQuery = useQuery({
    queryKey: ["admin", "mcp-tools"],
    queryFn: () => apiGet<{ tools: McpToolInfo[] }>("/api/admin/mcp-tools")
  });

  const connectionCandidates = connectionsQuery.data?.connections ?? [];
  const showConnectionPicker = connectionCandidates.length > 0;
  const connectionsFallback =
    connectionsQuery.isError || (!connectionsQuery.isLoading && connectionCandidates.length === 0);
  const mcpTools = mcpToolsQuery.data?.tools ?? [];
  const showToolPicker = mcpTools.length > 0;
  const toolsFallback = mcpToolsQuery.isError || (!mcpToolsQuery.isLoading && mcpTools.length === 0);

  const selectorConnIds = useMemo(
    () => [...new Set(form.selectors.map((row) => row.connection.trim()).filter(Boolean))],
    [form.selectors]
  );
  const tableQueries = useQueries({
    queries: selectorConnIds.map((connId) => ({
      queryKey: ["connection-tables", connId],
      queryFn: () => apiGet<ConnectionTablesResponse>(`/api/connections/${encodeURIComponent(connId)}/tables`),
      enabled: connId.length > 0
    }))
  });
  const tablesByConnection = useMemo(() => {
    const map = new Map<string, { tables: string[]; isError: boolean; isLoading: boolean }>();
    selectorConnIds.forEach((connId, index) => {
      const result = tableQueries[index];
      map.set(connId, {
        tables: result?.data?.tables ?? [],
        isError: Boolean(result?.isError),
        isLoading: Boolean(result?.isLoading)
      });
    });
    return map;
  }, [selectorConnIds, tableQueries]);

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

  const roleIdIsValid = useMemo(
    () => /^[A-Za-z0-9_-]{1,64}$/.test(form.roleId),
    [form.roleId]
  );
  const toolsCount = form.tools.filter((item) => item.trim().length > 0).length;
  const dirty = isRoleDirty(form, detail, mode);

  const createMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; payload: { roleId: string; role: RoleWritePayload } }) =>
      apiPost<{ diff: string; proposedYaml: string } | (AccessWriteAck & { role: RoleDetailType })>(
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
        void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
        if (!toastAccessWriteAck(data as AccessWriteAck, "Role 已创建")) return;
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        navigate(`/admin/roles/${encodeURIComponent(vars.payload.roleId)}`);
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const patchMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; version: string | undefined; patch: RoleWritePayload }) =>
      apiPatch<{ diff: string; proposedYaml: string; version?: string } | (AccessWriteAck & { version: string })>(
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
        void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
        if (!toastAccessWriteAck(data as AccessWriteAck, "Role 已保存")) return;
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agent", roleId] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        setActiveTab("identity");
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const copyMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; newRoleId: string; role: RoleWritePayload }) =>
      apiPost<{ diff: string; proposedYaml: string } | (AccessWriteAck & { role: RoleDetailType })>(
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
        void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
        if (!toastAccessWriteAck(data as AccessWriteAck, `Role '${vars.newRoleId}' 已从 '${roleId}' 复制`)) return;
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        navigate(`/admin/roles/${encodeURIComponent(vars.newRoleId)}`);
      }
    },
    onError: (err: Error) => toast.error(err.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (body: { dryRun: boolean; version: string | undefined }) =>
      apiDelete<{ diff: string; proposedYaml: string; version?: string } | AccessWriteAck>(
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
        void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
        if (!toastAccessWriteAck(data as AccessWriteAck, `Role '${roleId}' 已删除`)) return;
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
      toast.error("角色标识必须匹配 ^[A-Za-z0-9_-]{1,64}$");
      return;
    }
    if (toolsCount === 0) {
      toast.error("至少需要一个 MCP 工具");
      return;
    }
    if (form.tools.some((tool) => tool.includes("*"))) {
      toast.error("禁止使用 * 通配符");
      return;
    }
    const scopedError = validateScopedSelectors(form);
    if (scopedError) {
      toast.error(scopedError);
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
    const scopedError = validateScopedSelectors(form);
    if (scopedError) {
      toast.error(scopedError);
      return;
    }
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
      toast.error("新角色标识必须匹配 ^[A-Za-z0-9_-]{1,64}$");
      return;
    }
    if (form.tools.some((tool) => tool.includes("*"))) {
      toast.error("禁止使用 * 通配符");
      return;
    }
    const scopedError = validateScopedSelectors(form);
    if (scopedError) {
      toast.error(scopedError);
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

  const tabs = useMemo(() => visibleTabsForMode(mode, detail?.source), [mode, detail?.source]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.key === activeTab)) {
      setActiveTab(tabs[0]?.key ?? "identity");
    }
  }, [tabs, activeTab]);

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
        backAction={
          <Link to="/admin/roles" className="pl-page-header-back">
            ‹ 返回角色权限
          </Link>
        }
        description={
          <>
            {mode === "create" && (
              <>
                填写角色标识与说明，并在「权限配置」中设置连接、表范围与{" "}
                <span className="notranslate" translate="no">MCP</span> 工具。保存前须在「变更预览」中确认 diff。
              </>
            )}
            {mode === "edit" && detail?.source === "template" && (
              <>
                这是参考模板，UI 上只读。请使用「基于此模板创建 Role」展开为正式 Role。
              </>
            )}
            {mode === "edit" && detail?.source !== "template" && (
              <>
                编辑正式 Role 的访问边界。保存前须在「变更预览」中确认 diff。
              </>
            )}
            {mode === "copy" && (
              <>
                从已有 role 复制出新的正式 Role。需输入新的角色标识。
              </>
            )}
            {mode === "delete" && (
              <>
                删除前必须 dryRun diff。被 <span className="notranslate" translate="no">Agent</span> 引用的 role 不可删除。
              </>
            )}
          </>
        }
        badges={
          detail ? (
            <>
              <span>{detail.source === "template" ? "参考模板" : "正式 Role"}</span>
              <span>
                {detail.usageCount} 个 <span className="notranslate" translate="no">Agent</span> 引用
              </span>
            </>
          ) : null
        }
        actions={
          <>
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
        {activeTab === "identity" && (
          <div className="grid gap-4 max-w-2xl pb-32">
            <label className="grid gap-1" htmlFor="role-id-input">
              <span className="text-sm font-medium">角色标识</span>
              <input
                id="role-id-input"
                className="pl-input notranslate"
                translate="no"
                value={form.roleId}
                disabled={mode === "edit" && detail?.source !== "template"}
                placeholder="例：poc_data_engineer"
                onChange={(e) => updateForm({ ...form, roleId: e.target.value })}
              />
              <span className="text-xs text-fg-muted">
                <span className="notranslate" translate="no">Agent</span> 引用此 Role 时使用的技术标识。仅英文字母、数字、下划线与连字符，最多 64 位。
              </span>
            </label>
            <label className="grid gap-1" htmlFor="role-description-input">
              <span className="text-sm font-medium">说明</span>
              <input
                id="role-description-input"
                className="pl-input"
                value={form.description}
                placeholder="例如：POC 只读问答角色"
                onChange={(e) => {
                  const description = e.target.value;
                  const next: RoleFormState = { ...form, description };
                  if (
                    (mode === "create" || mode === "copy") &&
                    form.roleId.trim().length === 0
                  ) {
                    const suggested = suggestRoleIdFromDescription(description);
                    if (suggested) next.roleId = suggested;
                  }
                  updateForm(next);
                }}
                disabled={isReadOnlyTemplate}
              />
            </label>
            {isReadOnlyTemplate && (
              <div className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong">
                <p>这是参考模板，UI 上只读。</p>
                <p className="mt-1 text-warning-strong">
                  创建后会写入 <span className="notranslate" translate="no">access.yaml</span>
                  ，成为可编辑、可分配给 <span className="notranslate" translate="no">Agent</span>{" "}
                  的正式 Role。保存前必须确认{" "}
                  <span className="notranslate" translate="no">YAML</span> diff。
                </p>
                <Link
                  to={`/admin/roles/${encodeURIComponent(detail!.id)}?mode=copy`}
                  className="pl-btn pl-btn--secondary text-xs ml-0 mt-2"
                  aria-label={`基于参考模板 ${detail!.id} 创建 Role`}
                >
                  基于此模板创建 Role
                </Link>
              </div>
            )}
          </div>
        )}

        {activeTab === "permissions" && (
          <div className="grid gap-4 max-w-2xl pb-32">
            <div className="grid gap-2" data-testid="role-connections-field">
              <div className="text-sm font-medium">允许的连接</div>
              <p className="text-xs text-fg-muted">该 Role 可使用哪些数据库连接。</p>
              {connectionsFallback ? (
                <p className="text-xs text-warning-strong" data-testid="role-connections-fallback-hint">
                  连接候选暂不可用，可手动填写连接 ID。
                </p>
              ) : null}
              {!connectionsFallback && showConnectionPicker ? (
                <div className="grid gap-1 rounded-md border border-border-default bg-bg-base p-3" role="group" aria-label="允许的连接">
                  {connectionCandidates.map((conn: ConnectionInfo) => (
                    <label key={conn.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.connections.includes(conn.id)}
                        disabled={isReadOnlyTemplate}
                        onChange={(e) =>
                          updateForm({
                            ...form,
                            connections: toggleInList(form.connections, conn.id, e.target.checked)
                          })
                        }
                      />
                      <span className="notranslate font-mono text-xs" translate="no">
                        {conn.id}
                      </span>
                    </label>
                  ))}
                </div>
              ) : null}
              <TagInput
                value={form.connections}
                onChange={(connections) => updateForm({ ...form, connections })}
                placeholder="输入连接 ID 后回车"
              />
            </div>

            <div className="grid gap-2" data-testid="role-tools-field">
              <div className="text-sm font-medium">
                允许的 <span className="notranslate" translate="no">MCP</span> 工具
              </div>
              <p className="text-xs text-fg-muted">
                <span className="notranslate" translate="no">Agent</span> 可调用的能力清单；须显式勾选，禁止使用{" "}
                <code>*</code>。
              </p>
              {toolsFallback ? (
                <p className="text-xs text-warning-strong" data-testid="role-tools-fallback-hint">
                  工具候选暂不可用，可手动填写工具名。
                </p>
              ) : null}
              {!toolsFallback && showToolPicker ? (
                <div className="notranslate" translate="no">
                  <CheckboxCandidatePicker
                    items={mcpTools.map((tool) => ({
                      id: tool.name,
                      disabled: tool.globalDenied,
                      description: tool.description,
                      filterText: tool.description,
                      label: (
                        <>
                          <span className="notranslate font-mono text-xs" translate="no">
                            {tool.name}
                          </span>
                          {tool.globalDenied ? (
                            <span className="ml-2 text-xs text-danger">全局禁止</span>
                          ) : null}
                        </>
                      )
                    }))}
                    value={form.tools}
                    onChange={(tools) => updateForm({ ...form, tools })}
                    ariaLabel="允许的 MCP 工具"
                    testIdPrefix="role-tools"
                    disabled={isReadOnlyTemplate}
                    filterPlaceholder="筛选工具名…"
                    listClassName="grid max-h-72 gap-1 overflow-auto rounded-md border border-border-default bg-bg-base p-3 notranslate"
                  />
                </div>
              ) : null}
              <div id="role-tools-input">
                <TagInput
                  value={form.tools}
                  onChange={(tools) => {
                    const denied = new Set(
                      mcpTools.filter((tool) => tool.globalDenied).map((tool) => tool.name)
                    );
                    updateForm({
                      ...form,
                      tools: denied.size > 0 ? tools.filter((name) => !denied.has(name)) : tools
                    });
                  }}
                  placeholder="输入工具名后回车"
                />
              </div>
            </div>

            <div className="grid gap-2" data-testid="role-table-ranges-field">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">可访问的表范围</div>
                  <p className="text-xs text-fg-muted">
                    限定该 Role 可查询的 <span className="notranslate" translate="no">Schema</span> 与表。未添加任何范围时，不能访问数据表。
                  </p>
                </div>
                <button
                  type="button"
                  className="pl-btn pl-btn--ghost text-xs"
                  onClick={() =>
                    updateForm({
                      ...form,
                      selectors: [
                        ...form.selectors,
                        {
                          connection: form.connections[0] ?? "",
                          schema: "",
                          kind: "names",
                          names: [],
                          prefix: "",
                          rowAccess: "all",
                          predicates: []
                        }
                      ]
                    })
                  }
                  disabled={isReadOnlyTemplate}
                >
                  + 添加表范围
                </button>
              </div>
              {form.selectors.length === 0 ? (
                <p className="text-xs text-fg-muted">尚未添加表范围。此 Role 不能访问任何数据表。</p>
              ) : (
                <div className="grid gap-2">
                  {form.selectors.map((row, idx) => {
                    const connMeta = connectionCandidates.find((item) => item.id === row.connection);
                    const schemaOptions = connMeta?.schemas ?? [];
                    const schemaFallback = Boolean(row.connection) && schemaOptions.length === 0;
                    const tableState = row.connection
                      ? tablesByConnection.get(row.connection)
                      : undefined;
                    const tableCandidates =
                      row.schema && tableState ? tablesForSchema(tableState.tables, row.schema) : [];
                    const tablesFallback =
                      row.kind === "names" &&
                      Boolean(row.connection && row.schema) &&
                      (tableState?.isError ||
                        (!tableState?.isLoading && tableCandidates.length === 0));

                    return (
                      <div
                        key={idx}
                        className="grid gap-2 rounded-md border border-border-default bg-bg-base p-3"
                        data-testid={`role-table-range-${idx + 1}`}
                      >
                        <div className="grid grid-cols-2 gap-2">
                          <label className="grid gap-1">
                            <span className="text-xs text-fg-muted">连接</span>
                            <select
                              className="pl-input notranslate"
                              translate="no"
                              value={row.connection}
                              aria-label={`表范围 ${idx + 1} 连接`}
                              disabled={isReadOnlyTemplate}
                              onChange={(e) => {
                                const next = [...form.selectors];
                                next[idx] = { ...row, connection: e.target.value, schema: "", names: [] };
                                updateForm({ ...form, selectors: next });
                              }}
                            >
                              <option value="">选择连接</option>
                              {(form.connections.length > 0 ? form.connections : connectionCandidates.map((c) => c.id)).map(
                                (id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                )
                              )}
                            </select>
                          </label>
                          <label className="grid gap-1">
                            <span className="text-xs text-fg-muted">
                              <span className="notranslate" translate="no">
                                Schema
                              </span>
                              （必填）
                            </span>
                            {schemaFallback ? (
                              <input
                                className="pl-input notranslate"
                                translate="no"
                                placeholder="手动输入 Schema"
                                value={row.schema}
                                aria-label={`表范围 ${idx + 1} Schema`}
                                disabled={isReadOnlyTemplate}
                                onChange={(e) => {
                                  const next = [...form.selectors];
                                  next[idx] = { ...row, schema: e.target.value, names: [] };
                                  updateForm({ ...form, selectors: next });
                                }}
                              />
                            ) : (
                              <select
                                className="pl-input notranslate"
                                translate="no"
                                value={row.schema}
                                aria-label={`表范围 ${idx + 1} Schema`}
                                disabled={isReadOnlyTemplate || !row.connection}
                                onChange={(e) => {
                                  const next = [...form.selectors];
                                  next[idx] = { ...row, schema: e.target.value, names: [] };
                                  updateForm({ ...form, selectors: next });
                                }}
                              >
                                <option value="" className="notranslate" translate="no">
                                  选择 Schema
                                </option>
                                {schemaOptions.map((schema) => (
                                  <option key={schema} value={schema}>
                                    {schema}
                                  </option>
                                ))}
                              </select>
                            )}
                          </label>
                        </div>
                        {schemaFallback ? (
                          <p className="text-xs text-warning-strong">
                            当前连接无 <span className="notranslate" translate="no">Schema</span> 候选，可手动填写。
                          </p>
                        ) : null}
                        <div className="flex items-center gap-3">
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
                            指定表名
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
                            按前缀匹配（高级）
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
                          <div className="grid gap-2">
                            {tablesFallback ? (
                              <p className="text-xs text-warning-strong" data-testid={`role-table-names-fallback-${idx + 1}`}>
                                表候选暂不可用，可手动填写表名。
                              </p>
                            ) : null}
                            {!tablesFallback && tableCandidates.length > 0 ? (
                              <CheckboxCandidatePicker
                                items={tableCandidates.map((tableName) => ({
                                  id: tableName,
                                  label: (
                                    <span className="notranslate font-mono" translate="no">
                                      {tableName}
                                    </span>
                                  )
                                }))}
                                value={row.names}
                                onChange={(names) => {
                                  const next = [...form.selectors];
                                  next[idx] = { ...row, names };
                                  updateForm({ ...form, selectors: next });
                                }}
                                ariaLabel={`表范围 ${idx + 1} 指定表名`}
                                testIdPrefix={`role-table-names-${idx + 1}`}
                                disabled={isReadOnlyTemplate}
                                filterPlaceholder="筛选表名…"
                                listClassName="grid max-h-72 gap-1 overflow-auto rounded-md border border-border-subtle p-2"
                                itemClassName="flex items-center gap-2 text-xs"
                              />
                            ) : null}
                            <TagInput
                              value={row.names}
                              onChange={(names) => {
                                const next = [...form.selectors];
                                next[idx] = { ...row, names };
                                updateForm({ ...form, selectors: next });
                              }}
                              placeholder="输入表名后回车"
                            />
                          </div>
                        ) : (
                          <label className="grid gap-1">
                            <span className="text-xs text-fg-muted">表名前缀</span>
                            <input
                              className="pl-input notranslate"
                              translate="no"
                              placeholder="例如 poc_"
                              value={row.prefix}
                              aria-label={`表范围 ${idx + 1} 按前缀匹配`}
                              onChange={(e) => {
                                const next = [...form.selectors];
                                next[idx] = { ...row, prefix: e.target.value };
                                updateForm({ ...form, selectors: next });
                              }}
                              disabled={isReadOnlyTemplate}
                            />
                            <span className="text-xs text-fg-muted">
                              授权所有以此前缀开头的表，例如 <code className="notranslate" translate="no">poc_</code>
                            </span>
                          </label>
                        )}

                        <div
                          className="grid gap-2 border-t border-border-subtle pt-2"
                          data-testid={`role-row-access-${idx + 1}`}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-xs font-medium">
                              行访问
                              <span className="ml-1 font-mono text-fg-muted notranslate" translate="no">
                                row_access
                              </span>
                            </span>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                name={`role-row-access-${idx}`}
                                checked={row.rowAccess === "all"}
                                disabled={isReadOnlyTemplate}
                                onChange={() => {
                                  const next = [...form.selectors];
                                  next[idx] = { ...row, rowAccess: "all", predicates: [] };
                                  updateForm({ ...form, selectors: next });
                                }}
                              />
                              全部行
                              <span className="font-mono text-fg-muted notranslate" translate="no">
                                all
                              </span>
                            </label>
                            <label className="flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                name={`role-row-access-${idx}`}
                                checked={row.rowAccess === "scoped"}
                                disabled={isReadOnlyTemplate}
                                onChange={() => {
                                  const next = [...form.selectors];
                                  next[idx] = {
                                    ...row,
                                    rowAccess: "scoped",
                                    predicates: row.predicates.length > 0 ? row.predicates : [{ ...EMPTY_PREDICATE }]
                                  };
                                  updateForm({ ...form, selectors: next });
                                }}
                              />
                              限定行
                              <span className="font-mono text-fg-muted notranslate" translate="no">
                                scoped
                              </span>
                            </label>
                          </div>
                          {row.rowAccess === "scoped" ? (
                            <div className="grid gap-2" data-testid={`role-row-policy-${idx + 1}`}>
                              <p className="text-xs text-fg-muted">
                                编辑
                                <span className="mx-1 font-mono notranslate" translate="no">
                                  row_policy
                                </span>
                                条件（op 仅
                                <span className="mx-1 font-mono notranslate" translate="no">
                                  eq
                                </span>
                                /
                                <span className="mx-1 font-mono notranslate" translate="no">
                                  in
                                </span>
                                ；字段须为行级列，禁止 measure）。Preview 显示 digest；本页不宣称取数已行级生效。
                              </p>
                              {row.predicates.map((pred, predIdx) => (
                                <div
                                  key={predIdx}
                                  className="grid gap-2 rounded-md border border-border-subtle bg-bg-subtle p-2"
                                  data-testid={`role-row-predicate-${idx + 1}-${predIdx + 1}`}
                                >
                                  <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2">
                                    <label className="grid gap-1">
                                      <span className="text-xs text-fg-muted">字段</span>
                                      <input
                                        className="pl-input notranslate font-mono text-xs"
                                        translate="no"
                                        placeholder="region"
                                        value={pred.field}
                                        aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} 字段`}
                                        disabled={isReadOnlyTemplate}
                                        onChange={(e) => {
                                          const next = [...form.selectors];
                                          const predicates = [...row.predicates];
                                          predicates[predIdx] = { ...pred, field: e.target.value };
                                          next[idx] = { ...row, predicates };
                                          updateForm({ ...form, selectors: next });
                                        }}
                                      />
                                    </label>
                                    <label className="grid gap-1">
                                      <span className="text-xs text-fg-muted">
                                        <span className="notranslate" translate="no">
                                          op
                                        </span>
                                      </span>
                                      <select
                                        className="pl-input notranslate"
                                        translate="no"
                                        value={pred.op}
                                        aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} op`}
                                        disabled={isReadOnlyTemplate}
                                        onChange={(e) => {
                                          const op = e.target.value === "in" ? "in" : "eq";
                                          const next = [...form.selectors];
                                          const predicates = [...row.predicates];
                                          predicates[predIdx] = {
                                            ...pred,
                                            op,
                                            value: op === "eq" ? pred.value : "",
                                            values: op === "in" ? pred.values : []
                                          };
                                          next[idx] = { ...row, predicates };
                                          updateForm({ ...form, selectors: next });
                                        }}
                                      >
                                        <option value="eq">eq</option>
                                        <option value="in">in</option>
                                      </select>
                                    </label>
                                    {pred.op === "eq" ? (
                                      <label className="grid gap-1">
                                        <span className="text-xs text-fg-muted">取值</span>
                                        <input
                                          className="pl-input notranslate font-mono text-xs"
                                          translate="no"
                                          placeholder="East"
                                          value={pred.value}
                                          aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} 取值`}
                                          disabled={isReadOnlyTemplate}
                                          onChange={(e) => {
                                            const next = [...form.selectors];
                                            const predicates = [...row.predicates];
                                            predicates[predIdx] = { ...pred, value: e.target.value };
                                            next[idx] = { ...row, predicates };
                                            updateForm({ ...form, selectors: next });
                                          }}
                                        />
                                      </label>
                                    ) : (
                                      <div className="grid gap-1">
                                        <span className="text-xs text-fg-muted">取值列表</span>
                                        <TagInput
                                          value={pred.values}
                                          onChange={(values) => {
                                            const next = [...form.selectors];
                                            const predicates = [...row.predicates];
                                            predicates[predIdx] = { ...pred, values };
                                            next[idx] = { ...row, predicates };
                                            updateForm({ ...form, selectors: next });
                                          }}
                                          placeholder="输入取值后回车"
                                        />
                                      </div>
                                    )}
                                    <button
                                      type="button"
                                      className="pl-btn pl-btn--ghost text-xs"
                                      aria-label={`删除表范围 ${idx + 1} 条件 ${predIdx + 1}`}
                                      disabled={isReadOnlyTemplate || row.predicates.length <= 1}
                                      onClick={() => {
                                        const next = [...form.selectors];
                                        next[idx] = {
                                          ...row,
                                          predicates: row.predicates.filter((_, i) => i !== predIdx)
                                        };
                                        updateForm({ ...form, selectors: next });
                                      }}
                                    >
                                      删除
                                    </button>
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                className="pl-btn pl-btn--ghost text-xs justify-self-start"
                                disabled={isReadOnlyTemplate}
                                onClick={() => {
                                  const next = [...form.selectors];
                                  next[idx] = {
                                    ...row,
                                    predicates: [...row.predicates, { ...EMPTY_PREDICATE }]
                                  };
                                  updateForm({ ...form, selectors: next });
                                }}
                              >
                                + 添加条件
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "effective" && (
          <div className="grid gap-4 max-w-3xl pb-32">
            {!detail ? (
              <p className="text-sm text-fg-muted">尚未保存。保存后在此查看解析后的生效边界。</p>
            ) : detail.invalid ? (
              <div className="pl-card grid gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="pl-status-badge pl-status-validation_failed">待修复</span>
                  <span className="text-sm text-danger">该 Role 当前无法生成有效权限边界。</span>
                </div>
                {(detail.warnings?.length ?? 0) > 0 ? (
                  <ul className="grid gap-1 text-xs" data-testid="role-detail-invalid-warnings">
                    {detail.warnings.map((warning, idx) => {
                      const { diagnosis, technical } = roleWarningDiagnosis(warning);
                      return (
                        <li key={idx} className="text-danger">
                          <span data-testid={`role-detail-warning-diagnosis-${idx}`}>{diagnosis}</span>
                          <span className="ml-2 inline-flex items-center gap-1 text-fg-muted">
                            <span aria-hidden>·</span>
                            <span>技术详情：</span>
                            <code
                              className="notranslate rounded bg-bg-subtle px-1 py-0.5 font-mono text-[11px]"
                              translate="no"
                              data-testid={`role-detail-warning-tech-${idx}`}
                            >
                              {technical}
                            </code>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-semibold tracking-wider text-fg-muted uppercase mb-2">权限摘要</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="pl-metric-card"><span>工具</span><strong>{detail.effectivePermissions?.tools.length ?? 0}</strong><small>{detail.id}</small></div>
                    <div className="pl-metric-card"><span>连接</span><strong>{detail.effectivePermissions?.connections.length ?? 0}</strong><small>{detail.effectivePermissions?.connections.join(", ") || "—"}</small></div>
                    <div className="pl-metric-card"><span className="notranslate" translate="no">Source</span><strong>{detail.effectivePermissions?.sources.length ?? 0}</strong><small>{detail.effectivePermissions?.snapshotHash.slice(0, 12)}</small></div>
                  </div>
                </div>
                <div className="grid gap-2">
                  <div
                    className="text-sm font-medium notranslate"
                    translate="no"
                    data-testid="role-allowed-tools-label"
                  >
                    允许的 MCP 工具（过滤 <code>tools/list</code>，并拦截未授权 <code>tools/call</code>）
                  </div>
                  <p className="text-xs text-fg-muted">
                    这些 <span className="notranslate" translate="no">tool</span> 会在 <span className="notranslate" translate="no">Lucy MCP Proxy</span> 中拦截未授权的{" "}
                    <code className="notranslate" translate="no">tools/call</code>
                    ，并在{" "}
                    <code className="notranslate" translate="no">tools/list</code>
                    中只暴露 role 列出的工具名。
                  </p>
                  <div className="flex flex-wrap gap-2" data-testid="role-allowed-tools-list">
                    {(detail.effectivePermissions?.tools ?? []).map((tool) => (
                      <span
                        key={tool}
                        className="pl-status-badge pl-status-included notranslate"
                        translate="no"
                      >
                        {tool}
                      </span>
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
                <div className="grid gap-2" data-testid="capability-preview">
                  <div className="text-sm font-medium">
                    Data Capability Preview
                    {detail.effectivePermissions?.capabilityDigest ? (
                      <span className="ml-2 font-mono text-xs text-fg-muted notranslate" translate="no">
                        digest={detail.effectivePermissions.capabilityDigest}
                      </span>
                    ) : null}
                  </div>
                  {(detail.effectivePermissions?.capabilities?.length ?? 0) === 0 ? (
                    <p className="text-sm text-fg-muted">无 DataPlane capability。</p>
                  ) : (
                    <ul className="grid gap-1 font-mono text-xs">
                      {detail.effectivePermissions!.capabilities!.map((cap) => (
                        <li key={`${cap.tool}:${cap.sourceKey}`} className="notranslate" translate="no">
                          {cap.tool} × {cap.sourceKey} · rowGrant={formatRowGrantPreviewLabel(cap.rowGrant)}
                        </li>
                      ))}
                    </ul>
                  )}
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
              <p className="text-sm text-fg-muted">当前没有 <span className="notranslate" translate="no">Agent</span> 引用此 role。</p>
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
                  setActiveTab("identity");
                }}
                isPending={
                  createMutation.isPending || patchMutation.isPending || deleteMutation.isPending || copyMutation.isPending
                }
              />
            ) : (
              <p className="text-sm text-fg-muted">在「基本信息」或「权限配置」编辑后，点「预览保存」生成 diff。</p>
            )}
          </div>
        )}
      </div>

      {(activeTab === "identity" || activeTab === "permissions") && dirty && !showDeleteDiff && !isReadOnlyTemplate && (
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
      <p className="text-sm text-fg-muted notranslate" translate="no">以下改动将写入 access.yaml：</p>
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
