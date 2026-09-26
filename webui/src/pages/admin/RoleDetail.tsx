import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../lib/apiClient";
import type {
  AccessWriteAck,
  ConnectionTablesResponse,
  ConnectionsResponse,
  McpToolInfo,
  RoleAllowConfig,
  RoleDetail as RoleDetailType,
  RoleRowPolicyPredicate,
  RoleSelector,
} from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { TagInput } from "../../components/TagInput";
import { RoleTableGrants } from "../../components/RoleTableGrants";
import { RoleToolGrants } from "../../components/RoleToolGrants";
import { RoleRowPolicyPanel } from "../../components/RoleRowPolicyPanel";
import { RolePermissionReviewDrawer } from "../../components/RolePermissionReviewDrawer";
import {
  buildTableAllow,
  derivePermissionImpact,
  partitionGrantableTools,
  permissionTableKey,
  rolePermissionDraftHash,
  type PermissionImpactSummary,
  type PermissionSection,
  type RolePermissionDraft,
  type RowPolicyPredicateDraft,
  type TableGrant,
} from "../../lib/rolePermissionDraft";

type PageMode = "create" | "edit" | "copy";

type RoleWritePayload = {
  description?: string;
  permission_model_version: 2;
  allow: RoleAllowConfig;
};

type ReviewSnapshot = {
  kind: "create" | "copy" | "patch" | "delete";
  draftHash: string;
  payload?: RoleWritePayload;
  roleId?: string;
  version?: string;
  diff: string;
  proposedYaml: string;
  impact: PermissionImpactSummary;
};

type DraftInit = {
  baseline: RolePermissionDraft;
  draft: RolePermissionDraft;
  rejectedTools: string[];
  migrationBlocked: string | null;
  migratedPrefix: boolean;
};

const EMPTY_DRAFT: RolePermissionDraft = {
  roleId: "",
  description: "",
  scope: { mode: "names", tables: [] },
  tools: [],
};

const ROW_POLICY_INCOMPATIBLE_TOOLS = new Set([
  "lucy_read_source",
  "lucy_freshness",
  "entity_details",
  "sl_validate",
]);

function toastAccessWriteAck(result: AccessWriteAck, message: string): boolean {
  if (result.runtimeAck === false) {
    toast.error("保存未生效：runtime 未确认（runtimeAck=false）。草稿已保留，请检查策略降级状态。");
    return false;
  }
  const version = result.policyVersion ? ` · policyVersion=${result.policyVersion.slice(0, 12)}…` : "";
  toast.success(`${message}${version}`);
  return true;
}

function copyPredicates(selector: RoleSelector): RowPolicyPredicateDraft[] | undefined {
  if (selector.row_access !== "scoped" || !selector.row_policy?.predicates?.length) return undefined;
  return selector.row_policy.predicates.map((predicate) => ({
    field: String(predicate.field),
    op: predicate.op,
    value: predicate.op === "in"
      ? (predicate.values ?? []).map((value) => String(value))
      : String(predicate.value ?? ""),
  }));
}

function explicitTables(selectors: RoleSelector[] | undefined): TableGrant[] {
  const result: TableGrant[] = [];
  for (const selector of selectors ?? []) {
    if (!("names" in selector)) continue;
    for (const name of selector.names) {
      result.push({
        connection: selector.connection ?? "",
        schema: selector.schema,
        name,
        predicates: copyPredicates(selector),
      });
    }
  }
  return result;
}

function expandLegacyPrefixes(detail: RoleDetailType): {
  tables: TableGrant[];
  migrated: boolean;
  blocked: string | null;
} {
  const tables = explicitTables(detail.role.allow.tableSelectors);
  const prefixSelectors = (detail.role.allow.tableSelectors ?? []).filter(
    (selector): selector is Extract<RoleSelector, { prefix: string }> => "prefix" in selector
  );
  if (prefixSelectors.length === 0) return { tables, migrated: false, blocked: null };

  const sources = detail.effectivePermissions?.sources ?? [];
  for (const selector of prefixSelectors) {
    const matches = sources.filter((source) =>
      source.schema === selector.schema
      && (!selector.connection || source.connectionId === selector.connection)
      && source.sourceName.startsWith(selector.prefix)
    );
    if (matches.length === 0) {
      return {
        tables,
        migrated: true,
        blocked: `旧版前缀 ${selector.schema}.${selector.prefix} 无法从当前生效源确定性展开，请先修复 Role 配置。`,
      };
    }
    for (const source of matches) {
      const next = {
        connection: source.connectionId,
        schema: source.schema,
        name: source.sourceName,
        predicates: copyPredicates(selector),
      };
      if (!tables.some((table) => permissionTableKey(table) === permissionTableKey(next))) tables.push(next);
    }
  }
  return { tables, migrated: true, blocked: null };
}

function initializeDraft(detail: RoleDetailType | null, mode: PageMode): DraftInit {
  if (!detail) {
    return {
      baseline: EMPTY_DRAFT,
      draft: EMPTY_DRAFT,
      rejectedTools: [],
      migrationBlocked: null,
      migratedPrefix: false,
    };
  }

  const prefix = expandLegacyPrefixes(detail);
  const partitioned = partitionGrantableTools(detail.role.allow.tools ?? []);
  const scope: RolePermissionDraft["scope"] = detail.role.allow.source_scope === "catalog_bound"
    ? { mode: "catalog_bound", connections: [...(detail.role.allow.connections ?? [])] }
    : { mode: "names", tables: prefix.tables };
  const rawBaseline: RolePermissionDraft = {
    roleId: detail.id,
    description: detail.role.description ?? "",
    scope: detail.role.allow.source_scope === "catalog_bound"
      ? { mode: "catalog_bound", connections: [...(detail.role.allow.connections ?? [])] }
      : { mode: "names", tables: explicitTables(detail.role.allow.tableSelectors) },
    tools: [...(detail.role.allow.tools ?? [])],
  };
  return {
    baseline: rawBaseline,
    draft: {
      roleId: mode === "copy" ? "" : detail.id,
      description: detail.role.description ?? "",
      scope,
      tools: partitioned.grantable,
    },
    rejectedTools: partitioned.rejected,
    migrationBlocked: prefix.blocked,
    migratedPrefix: prefix.migrated,
  };
}

function serializeDraft(draft: RolePermissionDraft): RoleWritePayload {
  const partitioned = partitionGrantableTools(draft.tools);
  let allow: RoleAllowConfig;
  if (draft.scope.mode === "catalog_bound") {
    allow = {
      connections: draft.scope.connections.length ? draft.scope.connections : undefined,
      source_scope: "catalog_bound",
      tools: partitioned.grantable.length ? partitioned.grantable : undefined,
    };
  } else {
    const built = buildTableAllow({ mode: "names", tables: draft.scope.tables });
    const tableSelectors: RoleSelector[] = (built.tableSelectors ?? []).map((selector) => {
      const predicates = selector.row_policy?.predicates.map(({ sourceName: _sourceName, ...predicate }) => predicate as RoleRowPolicyPredicate);
      return {
        connection: selector.connection || undefined,
        schema: selector.schema,
        names: selector.names,
        row_access: selector.row_access,
        ...(predicates?.length ? { row_policy: { predicates } } : {}),
      };
    });
    allow = {
      connections: built.connections.length ? built.connections : undefined,
      tableSelectors: tableSelectors.length ? tableSelectors : undefined,
      tools: partitioned.grantable.length ? partitioned.grantable : undefined,
    };
  }
  return {
    description: draft.description.trim() || undefined,
    permission_model_version: 2,
    allow,
  };
}

function tablesForSchema(flatTables: string[], schema: string): string[] {
  const prefix = `${schema}.`;
  return flatTables.filter((item) => item.startsWith(prefix)).map((item) => item.slice(prefix.length)).filter(Boolean);
}

function tabsFor(mode: PageMode, source?: RoleDetailType["source"]): Array<{ key: PermissionSection; label: string }> {
  if (mode === "create" || mode === "copy") {
    return [
      { key: "overview", label: "基本信息" },
      { key: "tables", label: "可访问的表" },
      { key: "tools", label: "允许的 MCP 工具" },
      { key: "rowPolicy", label: "行级策略（可选）" },
    ];
  }
  const base: Array<{ key: PermissionSection; label: string }> = [
    { key: "overview", label: "概览" },
    { key: "tables", label: "可访问的表" },
    { key: "tools", label: "允许的 MCP 工具" },
    { key: "rowPolicy", label: "行级策略（可选）" },
    { key: "usage", label: "使用情况" },
  ];
  return source === "template" ? base : base;
}

function canonicalSection(raw: string | null): PermissionSection {
  if (raw === "permissions") return "tables";
  if (raw === "effective" || raw === "identity" || raw === "diff") return "overview";
  if (raw === "tables" || raw === "tools" || raw === "rowPolicy" || raw === "usage" || raw === "overview") return raw;
  return "overview";
}

function validateDraft(draft: RolePermissionDraft, migrationBlocked: string | null): { section: PermissionSection; message: string } | null {
  if (migrationBlocked) return { section: "tables", message: migrationBlocked };
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(draft.roleId)) {
    return { section: "overview", message: "角色标识必须匹配 ^[A-Za-z0-9_-]{1,64}$" };
  }
  if (draft.tools.some((tool) => tool.includes("*"))) {
    return { section: "tools", message: "允许的 MCP 工具禁止使用 * 通配符" };
  }
  if (draft.scope.mode === "catalog_bound" && draft.scope.connections.length === 0) {
    return { section: "tables", message: "启用目录绑定时至少选择一个允许的连接" };
  }
  if (draft.scope.mode === "names") {
    for (const table of draft.scope.tables) {
      for (const predicate of table.predicates ?? []) {
        if (!predicate.field.trim()) return { section: "rowPolicy", message: `${table.name} 的行级策略缺少字段` };
        const values = Array.isArray(predicate.value) ? predicate.value : [predicate.value];
        if (values.map(String).map((value) => value.trim()).filter(Boolean).length === 0) {
          return { section: "rowPolicy", message: `${table.name} 的行级策略缺少取值` };
        }
      }
    }
  }
  return null;
}

function riskLabel(risk: PermissionImpactSummary["risk"]): string {
  if (risk === "expanded") return "权限扩大";
  if (risk === "contracted") return "权限收缩";
  if (risk === "mixed") return "扩大与收缩并存";
  return "范围未变化";
}

function RoleBoundarySummary({
  draft,
  detail,
  impact,
}: {
  draft: RolePermissionDraft;
  detail: RoleDetailType | null;
  impact: PermissionImpactSummary;
}) {
  const tables = draft.scope.mode === "names" ? draft.scope.tables : [];
  const connections = draft.scope.mode === "catalog_bound"
    ? draft.scope.connections
    : [...new Set(tables.map((table) => table.connection).filter(Boolean))];
  const restricted = tables.filter((table) => table.predicates?.length).length;
  const incompatible = draft.tools.filter((tool) => ROW_POLICY_INCOMPATIBLE_TOOLS.has(tool));

  return (
    <aside className="pl-card order-first grid content-start gap-4 xl:order-none xl:sticky xl:top-4" data-testid="role-boundary-summary" aria-label="生效边界摘要">
      <div>
        <h2 className="text-sm font-semibold">生效边界摘要</h2>
        <p className="mt-1 text-xs text-fg-muted">基于当前草稿实时计算；正式保存后才会生效。</p>
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-fg-muted">允许的连接</dt><dd className="mt-1 font-semibold">{connections.length}</dd></div>
        <div><dt className="text-xs text-fg-muted">可访问的表</dt><dd className="mt-1 font-semibold">{draft.scope.mode === "catalog_bound" ? "目录绑定" : tables.length}</dd></div>
        <div><dt className="notranslate text-xs text-fg-muted" translate="no">MCP 工具</dt><dd className="mt-1 font-semibold">{draft.tools.length}</dd></div>
        <div><dt className="text-xs text-fg-muted">限定行表</dt><dd className="mt-1 font-semibold">{restricted}</dd></div>
      </dl>
      <div className="rounded-md bg-bg-subtle p-3 text-sm">
        <p className="font-medium">{riskLabel(impact.risk)}</p>
        <p className="notranslate mt-1 text-xs text-fg-muted" translate="no">受影响 Agent：{detail?.usageCount ?? 0} 个</p>
      </div>
      {draft.scope.mode === "catalog_bound" ? (
        <p className="rounded-md border border-warning-strong bg-warning-soft p-3 text-xs text-warning-strong">后续新启用的表会自动进入，并走扩权审计。</p>
      ) : null}
      {restricted > 0 && incompatible.length > 0 ? (
        <div className="rounded-md border border-warning-strong p-3 text-xs text-warning-strong" data-testid="row-policy-tool-warning">
          受行级策略保护的表上，以下工具会被运行时拒绝：{" "}
          <span className="notranslate font-mono" translate="no">{incompatible.join("、")}</span>
        </div>
      ) : null}
      {detail?.invalid ? (
        <div className="rounded-md border border-danger-strong bg-danger-soft p-3 text-xs text-danger" role="alert">
          当前正式 Role 待修复：{detail.warnings.join("；")}
        </div>
      ) : null}
      {detail?.skillAccess ? (
        <section className="rounded-md border border-border p-3 text-xs" data-testid="role-skill-access-summary" aria-label="业务 Skill 摘要">
          <h3 className="font-medium">业务 Skill</h3>
          <dl className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div><dt className="text-fg-muted">可检索</dt><dd className="mt-1 font-semibold">{detail.skillAccess.discoverable.length}</dd></div>
            <div><dt className="text-fg-muted">可读取</dt><dd className="mt-1 font-semibold">{detail.skillAccess.readable.length}</dd></div>
            <div><dt className="text-fg-muted">通道不完整</dt><dd className="mt-1 font-semibold">{detail.skillAccess.declaredWithoutChannel.length}</dd></div>
          </dl>
          {detail.skillAccess.declared.length > 0 ? (
            <ul className="mt-2 max-h-28 space-y-1 overflow-auto text-fg-muted">
              {detail.skillAccess.declared.map((uri) => <li key={uri} className="notranslate break-all font-mono" translate="no">{uri}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-fg-muted">没有声明给此角色的业务 Skill。</p>
          )}
          <p className="mt-2 text-fg-muted">授权修改请前往 Skill 编辑页。</p>
        </section>
      ) : null}
      {detail?.effectivePermissions ? (
        <details>
          <summary className="notranslate cursor-pointer text-xs font-medium" translate="no">Data Capability Preview</summary>
          <div className="mt-2 text-xs text-fg-muted">
            <p>服务器当前解析：{detail.effectivePermissions.capabilities?.length ?? 0} 个能力元组</p>
            {detail.effectivePermissions.capabilityDigest ? <code className="notranslate mt-1 block break-all" translate="no">{detail.effectivePermissions.capabilityDigest}</code> : null}
          </div>
        </details>
      ) : null}
    </aside>
  );
}

export function RoleDetail({ mode: initialMode }: { mode?: "create" } = {}) {
  const { roleId: routeRoleId } = useParams<{ roleId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteIntent = searchParams.get("mode") === "delete" || searchParams.get("action") === "delete";
  const mode: PageMode = initialMode === "create"
    ? "create"
    : searchParams.get("mode") === "copy"
      ? "copy"
      : "edit";
  const roleId = routeRoleId ?? "";
  const needsDetail = mode !== "create";

  const detailQuery = useQuery({
    queryKey: ["admin", "role", roleId],
    queryFn: () => apiGet<RoleDetailType>(`/api/admin/roles/${encodeURIComponent(roleId)}`),
    enabled: needsDetail && roleId.length > 0,
  });
  const detail = detailQuery.data ?? null;
  const [baseline, setBaseline] = useState<RolePermissionDraft>(EMPTY_DRAFT);
  const [draft, setDraft] = useState<RolePermissionDraft>(EMPTY_DRAFT);
  const [rejectedTools, setRejectedTools] = useState<string[]>([]);
  const [migrationBlocked, setMigrationBlocked] = useState<string | null>(null);
  const [migratedPrefix, setMigratedPrefix] = useState(false);
  const [review, setReview] = useState<ReviewSnapshot | null>(null);
  const reviewTriggerRef = useRef<HTMLElement | null>(null);
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const handledDeleteIntentRef = useRef<string | null>(null);
  const [activeSection, setActiveSectionState] = useState<PermissionSection>(() => canonicalSection(searchParams.get("tab")));

  const connectionsQuery = useQuery({ queryKey: ["connections"], queryFn: () => apiGet<ConnectionsResponse>("/api/connections") });
  const toolsQuery = useQuery({ queryKey: ["admin", "mcp-tools"], queryFn: () => apiGet<{ tools: McpToolInfo[] }>("/api/admin/mcp-tools") });
  const connectionCandidates = connectionsQuery.data?.connections ?? [];
  const connectionIds = useMemo(() => connectionCandidates.map((connection) => connection.id), [connectionCandidates]);
  const tableQueries = useQueries({
    queries: connectionIds.map((connectionId) => ({
      queryKey: ["connection-tables", connectionId],
      queryFn: () => apiGet<ConnectionTablesResponse>(`/api/connections/${encodeURIComponent(connectionId)}/tables`),
    })),
  });
  const candidateTablesByKey = useMemo(() => {
    const result: Record<string, string[]> = {};
    connectionCandidates.forEach((connection, index) => {
      const flatTables = tableQueries[index]?.data?.tables ?? [];
      for (const schema of connection.schemas ?? []) result[`${connection.id}\0${schema}`] = tablesForSchema(flatTables, schema);
    });
    return result;
  }, [connectionCandidates, tableQueries]);
  const candidatesLoaded = connectionIds.length === 0
    ? !connectionsQuery.isLoading
    : tableQueries.every((query) => !query.isLoading && !query.isError);

  useEffect(() => {
    if (needsDetail && !detail) return;
    const initialized = initializeDraft(detail, mode);
    setBaseline(initialized.baseline);
    setDraft(initialized.draft);
    setRejectedTools(initialized.rejectedTools);
    setMigrationBlocked(initialized.migrationBlocked);
    setMigratedPrefix(initialized.migratedPrefix);
    setReview(null);
  }, [detail, mode, needsDetail]);

  const tabs = useMemo(() => tabsFor(mode, detail?.source), [mode, detail?.source]);
  useEffect(() => {
    const requested = canonicalSection(searchParams.get("tab"));
    const next = tabs.some((tab) => tab.key === requested) ? requested : tabs[0]?.key ?? "overview";
    setActiveSectionState(next);
    if (searchParams.get("tab") !== next) {
      const params = new URLSearchParams(searchParams);
      params.set("tab", next);
      setSearchParams(params, { replace: true });
    }
  }, [searchParams, setSearchParams, tabs]);

  function setActiveSection(section: PermissionSection) {
    setActiveSectionState(section);
    const params = new URLSearchParams(searchParams);
    params.set("tab", section);
    setSearchParams(params, { replace: true });
  }

  function updateDraft(next: RolePermissionDraft) {
    setDraft(next);
    setReview(null);
  }

  const impact = useMemo(
    () => derivePermissionImpact(baseline, draft, rejectedTools, detail?.users ?? []),
    [baseline, draft, rejectedTools, detail?.users]
  );
  const dirty = mode === "copy"
    || migratedPrefix
    || rejectedTools.length > 0
    || rolePermissionDraftHash(draft) !== rolePermissionDraftHash(baseline);
  const isReadOnlyTemplate = mode === "edit" && detail?.source === "template";

  function finishSave(result: AccessWriteAck, message: string, targetRoleId: string): boolean {
    void queryClient.invalidateQueries({ queryKey: ["admin", "policy-runtime"] });
    if (!toastAccessWriteAck(result, message)) return false;
    void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
    void queryClient.invalidateQueries({ queryKey: ["admin", "role", targetRoleId] });
    setBaseline(draft);
    setRejectedTools([]);
    setMigratedPrefix(false);
    setReview(null);
    navigate(`/admin/roles/${encodeURIComponent(targetRoleId)}?tab=overview`);
    return true;
  }

  const createMutation = useMutation({
    mutationFn: (vars: { dryRun: boolean; roleId: string; payload: RoleWritePayload; draftHash: string; impact: PermissionImpactSummary }) =>
      apiPost<{ diff: string; proposedYaml: string } | AccessWriteAck>("/api/admin/roles", { dryRun: vars.dryRun, roleId: vars.roleId, role: vars.payload }),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const preview = data as { diff: string; proposedYaml: string };
        setReview({ kind: "create", draftHash: vars.draftHash, payload: vars.payload, roleId: vars.roleId, diff: preview.diff, proposedYaml: preview.proposedYaml, impact: vars.impact });
      } else finishSave(data as AccessWriteAck, "Role 已创建", vars.roleId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const copyMutation = useMutation({
    mutationFn: (vars: { dryRun: boolean; roleId: string; payload: RoleWritePayload; draftHash: string; impact: PermissionImpactSummary }) =>
      apiPost<{ diff: string; proposedYaml: string } | AccessWriteAck>(`/api/admin/roles/${encodeURIComponent(roleId)}/copy`, { dryRun: vars.dryRun, newRoleId: vars.roleId, role: vars.payload }),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const preview = data as { diff: string; proposedYaml: string };
        setReview({ kind: "copy", draftHash: vars.draftHash, payload: vars.payload, roleId: vars.roleId, diff: preview.diff, proposedYaml: preview.proposedYaml, impact: vars.impact });
      } else finishSave(data as AccessWriteAck, `Role '${vars.roleId}' 已复制`, vars.roleId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const patchMutation = useMutation({
    mutationFn: (vars: { dryRun: boolean; payload: RoleWritePayload; version?: string; draftHash: string; impact: PermissionImpactSummary }) =>
      apiPatch<{ diff: string; proposedYaml: string; version?: string } | AccessWriteAck>(`/api/admin/roles/${encodeURIComponent(roleId)}`, { dryRun: vars.dryRun, version: vars.version, patch: vars.payload }),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const preview = data as { diff: string; proposedYaml: string; version?: string };
        setReview({ kind: "patch", draftHash: vars.draftHash, payload: vars.payload, version: preview.version ?? vars.version, diff: preview.diff, proposedYaml: preview.proposedYaml, impact: vars.impact });
      } else finishSave(data as AccessWriteAck, "Role 已保存", roleId);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (vars: { dryRun: boolean; version?: string }) =>
      apiDelete<{ diff: string; proposedYaml: string; version?: string } | AccessWriteAck>(`/api/admin/roles/${encodeURIComponent(roleId)}`, { dryRun: vars.dryRun, version: vars.version }),
    onSuccess: (data, vars) => {
      if (vars.dryRun) {
        const preview = data as { diff: string; proposedYaml: string; version?: string };
        const empty: RolePermissionDraft = { roleId: draft.roleId, description: "", scope: { mode: "names", tables: [] }, tools: [] };
        setReview({ kind: "delete", draftHash: rolePermissionDraftHash(draft), version: preview.version ?? vars.version, diff: preview.diff, proposedYaml: preview.proposedYaml, impact: derivePermissionImpact(draft, empty, [], detail?.users ?? []) });
      } else if (toastAccessWriteAck(data as AccessWriteAck, `Role '${roleId}' 已删除`)) {
        void queryClient.invalidateQueries({ queryKey: ["admin", "roles"] });
        void queryClient.invalidateQueries({ queryKey: ["admin", "agents"] });
        navigate("/admin/roles");
      }
    },
    onError: (error: Error) => toast.error(error.message),
  });

  useEffect(() => {
    if (!deleteIntent || !detail) return;
    const intentKey = `${detail.id}:${detail.version ?? "unknown"}`;
    if (handledDeleteIntentRef.current === intentKey) return;
    handledDeleteIntentRef.current = intentKey;

    const params = new URLSearchParams(searchParams);
    params.delete("mode");
    params.delete("action");
    params.set("tab", "overview");
    setSearchParams(params, { replace: true });

    if (detail.source !== "yaml" || detail.usageCount > 0) return;
    reviewTriggerRef.current = deleteButtonRef.current;
    deleteMutation.mutate({ dryRun: true, version: detail.version });
  }, [deleteIntent, detail, searchParams, setSearchParams]);

  function requestSave() {
    const validation = validateDraft(draft, migrationBlocked);
    if (validation) {
      setActiveSection(validation.section);
      toast.error(validation.message);
      if (validation.section === "overview") setTimeout(() => document.getElementById("role-id-input")?.focus(), 0);
      return;
    }
    const payload = serializeDraft(draft);
    const draftHash = rolePermissionDraftHash(draft);
    if (mode === "create") createMutation.mutate({ dryRun: true, roleId: draft.roleId, payload, draftHash, impact });
    else if (mode === "copy") copyMutation.mutate({ dryRun: true, roleId: draft.roleId, payload, draftHash, impact });
    else patchMutation.mutate({ dryRun: true, payload, version: detail?.version, draftHash, impact });
  }

  function confirmReview() {
    if (!review) return;
    if (review.kind !== "delete" && rolePermissionDraftHash(draft) !== review.draftHash) {
      setReview(null);
      toast.error("配置已变化，请重新检查");
      return;
    }
    if (review.kind === "delete") {
      deleteMutation.mutate({ dryRun: false, version: review.version });
      return;
    }
    const common = { dryRun: false, payload: review.payload!, draftHash: review.draftHash, impact: review.impact };
    if (review.kind === "create") createMutation.mutate({ ...common, roleId: review.roleId! });
    else if (review.kind === "copy") copyMutation.mutate({ ...common, roleId: review.roleId! });
    else patchMutation.mutate({ ...common, version: review.version });
  }

  function discardChanges() {
    const initialized = initializeDraft(detail, mode);
    setBaseline(initialized.baseline);
    setDraft(initialized.draft);
    setRejectedTools(initialized.rejectedTools);
    setMigrationBlocked(initialized.migrationBlocked);
    setMigratedPrefix(initialized.migratedPrefix);
    setReview(null);
  }

  if (needsDetail && detailQuery.isLoading) return <div className="pl-notice">加载中…</div>;
  if (needsDetail && (detailQuery.error || !detail)) {
    return <div className="pl-notice">加载失败：{detailQuery.error instanceof Error ? detailQuery.error.message : "Role 不存在"}<div className="mt-3"><Link to="/admin/roles" className="pl-btn pl-btn--ghost text-sm">‹ 返回角色权限</Link></div></div>;
  }

  const mutationPending = createMutation.isPending || copyMutation.isPending || patchMutation.isPending || deleteMutation.isPending;
  const tables = draft.scope.mode === "names" ? draft.scope.tables : [];

  return (
    <div className="pl-page-stack min-w-[880px] xl:min-w-[960px]">
      <PageHeader
        title={mode === "create" ? "新建 Role" : mode === "copy" ? `复制 Role · ${roleId}` : detail?.id ?? roleId}
        backAction={<Link to="/admin/roles" className="pl-page-header-back">‹ 返回角色权限</Link>}
        description={
          mode === "create" ? <>按表、<span className="notranslate" translate="no">MCP</span> 工具和行级策略分别配置，最后一次确认并保存。</>
            : isReadOnlyTemplate ? <>这是参考模板，全部配置只读。可基于模板创建正式 Role。</>
              : <>按独立编辑面维护访问边界，所有改动会作为一个原子草稿保存。</>
        }
        badges={detail ? <><span>{detail.source === "template" ? "参考模板" : "正式 Role"}</span><span>{detail.usageCount} 个 <span className="notranslate" translate="no">Agent</span> 引用</span></> : null}
        actions={
          isReadOnlyTemplate ? <Link to={`/admin/roles/${encodeURIComponent(detail!.id)}?mode=copy&tab=overview`} className="pl-btn pl-btn--primary text-sm">基于此模板创建 Role</Link>
            : detail?.source === "yaml" ? <button ref={deleteButtonRef} type="button" className="pl-btn pl-btn--danger text-sm" disabled={detail.usageCount > 0 || deleteMutation.isPending} onClick={(event) => { reviewTriggerRef.current = event.currentTarget; deleteMutation.mutate({ dryRun: true, version: detail.version }); }}>{deleteMutation.isPending ? "检查中…" : "删除 Role"}</button>
              : null
        }
      />

      {migratedPrefix ? (
        <div className={`rounded-md border p-3 text-sm ${migrationBlocked ? "border-danger-strong bg-danger-soft text-danger" : "border-warning-strong bg-warning-soft text-warning-strong"}`} data-testid="legacy-prefix-migration">
          {migrationBlocked ?? "已将旧版前缀规则展开为当前明确表清单；保存后完成 v2 迁移，不再保留 prefix。"}
        </div>
      ) : null}

      <div className="pl-admin-tabbar" role="tablist" aria-label="Role 权限编辑面">
        {tabs.map((tab) => (
          <button key={tab.key} type="button" role="tab" aria-selected={activeSection === tab.key} className={`pl-admin-tab ${activeSection === tab.key ? "pl-admin-tab--active" : ""}`} onClick={() => setActiveSection(tab.key)}>
            {tab.label}
            {tab.key === "tables" && <span className="ml-1 text-xs text-fg-muted">{draft.scope.mode === "catalog_bound" ? "目录" : tables.length}</span>}
            {tab.key === "tools" && <span className="ml-1 text-xs text-fg-muted">{draft.tools.length}</span>}
            {tab.key === "rowPolicy" && <span className="ml-1 text-xs text-fg-muted">{tables.filter((table) => table.predicates?.length).length}</span>}
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <main className="pl-admin-tab-panel min-w-0" role="tabpanel">
          {activeSection === "overview" ? (
            <div className="grid max-w-2xl gap-4 pb-28">
              <label className="grid gap-1" htmlFor="role-id-input">
                <span className="text-sm font-medium">角色标识</span>
                <input id="role-id-input" className="pl-input notranslate" translate="no" value={draft.roleId} disabled={isReadOnlyTemplate || (mode === "edit" || mode === "delete")} onChange={(event) => updateDraft({ ...draft, roleId: event.target.value })} placeholder="例：poc_data_engineer" />
                <span className="text-xs text-fg-muted">供 <span className="notranslate" translate="no">Agent</span> 引用的技术标识；仅字母、数字、下划线和连字符，最多 64 位。</span>
              </label>
              <label className="grid gap-1" htmlFor="role-description-input">
                <span className="text-sm font-medium">说明</span>
                <input id="role-description-input" className="pl-input" value={draft.description} disabled={isReadOnlyTemplate} onChange={(event) => updateDraft({ ...draft, description: event.target.value })} placeholder="例如：POC 只读问答角色" />
              </label>
              {isReadOnlyTemplate ? <p className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong">参考模板不会直接写入 <span className="notranslate" translate="no">access.yaml</span>，请基于模板创建正式 Role。</p> : null}
            </div>
          ) : null}

          {activeSection === "tables" ? (
            <div className="grid gap-4 pb-28">
              <div><h2 className="text-base font-semibold">可访问的表</h2><p className="mt-1 text-sm text-fg-muted">只选择该 Role 确实需要访问的表；连接由选择结果自动推导。</p></div>
              {connectionsQuery.isError ? <p className="text-sm text-warning-strong">连接候选暂不可用，不能修改表范围。</p> : null}
              <RoleTableGrants value={draft.scope} connections={connectionCandidates.map((connection) => ({ id: connection.id, schemas: connection.schemas ?? [] }))} candidateTablesByKey={candidateTablesByKey} candidatesLoaded={candidatesLoaded} onChange={(scope) => updateDraft({ ...draft, scope })} disabled={isReadOnlyTemplate || connectionsQuery.isError} />
            </div>
          ) : null}

          {activeSection === "tools" ? (
            <div className="grid max-w-2xl gap-4 pb-28" data-testid="role-tools-field">
              <div><h2 className="notranslate text-base font-semibold" translate="no">允许的 MCP 工具</h2><p className="mt-1 text-sm text-fg-muted">优先使用职责预设；只有特殊 Role 才展开自定义工具。</p></div>
              {rejectedTools.length > 0 ? <div className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong">旧配置包含 {rejectedTools.length} 个系统禁止工具，保存时将移除。</div> : null}
              <RoleToolGrants candidates={toolsQuery.data?.tools ?? []} value={draft.tools} onChange={(tools) => updateDraft({ ...draft, tools })} disabled={isReadOnlyTemplate} />
              {toolsQuery.isError ? <><p className="text-xs text-warning-strong">工具候选暂不可用，可手工填写工具 ID。</p><TagInput value={draft.tools} onChange={(tools) => updateDraft({ ...draft, tools })} placeholder="输入工具 ID 后回车" /></> : null}
            </div>
          ) : null}

          {activeSection === "rowPolicy" ? (
            <div className="grid max-w-3xl gap-4 pb-28">
              <div><h2 className="text-base font-semibold">行级策略（可选）</h2><p className="mt-1 text-sm text-fg-muted">只为必须限制行的表配置静态条件；其余表保持全部行。</p></div>
              <RoleRowPolicyPanel tables={tables} onChange={(nextTables) => updateDraft({ ...draft, scope: { mode: "names", tables: nextTables } })} disabled={isReadOnlyTemplate} catalogBound={draft.scope.mode === "catalog_bound"} />
            </div>
          ) : null}

          {activeSection === "usage" ? (
            <div className="grid max-w-3xl gap-3 pb-28">
              {(detail?.users ?? []).length === 0 ? <p className="text-sm text-fg-muted">当前没有 <span className="notranslate" translate="no">Agent</span> 引用此 Role。</p> : detail!.users.map((user) => (
                <Link key={user.id} to={`/admin/agents/${encodeURIComponent(user.id)}`} className="pl-card flex items-center justify-between gap-3 no-underline">
                  <span><span className="block text-sm font-medium">{user.name}</span><span className="notranslate text-xs text-fg-muted" translate="no">{user.id} · {user.tokenCount} 个 Token</span></span>
                  <span className={`pl-status-badge ${user.enabled ? "pl-status-done" : "pl-status-not_started"}`}>{user.enabled ? "启用" : "禁用"}</span>
                </Link>
              ))}
            </div>
          ) : null}
        </main>
        <RoleBoundarySummary draft={draft} detail={detail} impact={impact} />
      </div>

      {dirty && !isReadOnlyTemplate ? (
        <div className="pl-floating-action-bar" role="region" aria-label="未保存修改" data-testid="role-dirty-bar">
          <span className="pl-floating-action-bar-text">您有未保存的修改</span>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="pl-btn pl-btn--ghost" onClick={discardChanges}>放弃修改</button>
            <button type="button" className="pl-btn pl-btn--primary" onClick={(event) => { reviewTriggerRef.current = event.currentTarget; requestSave(); }} disabled={mutationPending || Boolean(migrationBlocked)}>{mutationPending ? "检查中…" : "保存权限配置"}</button>
          </div>
        </div>
      ) : null}

      <RolePermissionReviewDrawer
        open={Boolean(review)}
        impact={review?.impact ?? impact}
        diff={review?.diff ?? ""}
        proposedYaml={review?.proposedYaml}
        onClose={() => setReview(null)}
        onConfirm={confirmReview}
        pending={mutationPending}
        deleteMode={review?.kind === "delete"}
        returnFocusRef={reviewTriggerRef}
      />
    </div>
  );
}
