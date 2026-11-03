import * as Dialog from "@radix-ui/react-dialog";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/apiClient";
import type { SourceDetail } from "../lib/types";
import type { RowPolicyPredicateDraft, TableGrant } from "../lib/rolePermissionDraft";
import { permissionTableKey } from "../lib/rolePermissionDraft";
import {
  useRowPolicyPreview,
  type RowPolicyPreviewConfirmation,
  type RowPolicyPreviewEntry
} from "../lib/rowPolicyPreview";
import {
  RowPolicyDnfPreview,
  type RowPolicyDnfGrant
} from "./admin/RowPolicyDnfPreview";
import {
  RowPolicyAuthoringModeBadge,
  RowPolicyTemplatePicker,
  type RowPolicyTemplateOption
} from "./admin/RowPolicyTemplatePicker";
import type { RowPolicyTemplateListResponse } from "./admin/RowPolicyTemplatePanel";

export interface RoleRowPolicyPanelProps {
  tables: TableGrant[];
  onChange: (tables: TableGrant[]) => void;
  disabled?: boolean;
  catalogBound?: boolean;
  /** The Role id the draft belongs to — the final-row preview is computed for it. */
  roleId?: string;
  /**
   * The candidate Role (draft). The preview is computed from the in-memory
   * candidate, never from the committed configuration.
   */
  previewRole?: unknown;
  /**
   * Spec §14.2.1 — the preview confirmation the save has to carry.
   *
   * The panel reports the confirmation of the CURRENT preview. The save entry
   * point refuses a save without one, so the confirmation and the draft can
   * never drift apart.
   */
  onConfirmation?: (confirmation: RowPolicyPreviewConfirmation | null) => void;
}

export type { RowPolicyPreviewConfirmation };

/**
 * Lucy v0.25 P1-1 §3.1 — 一张表的完整身份。
 *
 * 逐表可用性只能针对**一张确定的表**判定，所以缺连接标识的表拿不到可用性结论。
 */
type TableIdentity = { connectionId: string; schema: string; sourceName: string };

function tableIdentityOf(table: TableGrant): TableIdentity {
  return {
    connectionId: table.connection.trim(),
    schema: table.schema.trim(),
    sourceName: table.name.trim()
  };
}

function isCompleteIdentity(identity: TableIdentity): boolean {
  return Boolean(identity.connectionId && identity.schema && identity.sourceName);
}

/**
 * 模板列表的取数与模板管理页一致（同一个只读端点、同一个 `apiGet` 封装）：
 * `GET /api/admin/row-policy/templates`，带表身份时额外返回**该表**的可用性。
 *
 * 前端不另算一套可用性判断：可绑定 / 字段不存在 / 清单不可用 / 目录能力未知
 * 四个结论全部来自服务端（P1-1 §3.2、RTP-08）。
 */
function templatesUrl(identity: TableIdentity | null): string {
  if (!identity || !isCompleteIdentity(identity)) return "/api/admin/row-policy/templates";
  const query = new URLSearchParams({
    connectionId: identity.connectionId,
    schema: identity.schema,
    sourceName: identity.sourceName
  });
  return `/api/admin/row-policy/templates?${query.toString()}`;
}

/**
 * 把服务端的读模型转成 picker 的选项。
 *
 * `usabilityByTable` 里对应这张表的那一条就是这张表的可用性结论；拿不到时
 * 按「目录能力未知」处理——宁可让运维看见原因，也不能默默当成可绑定。
 */
function templateOptionsFor(
  response: RowPolicyTemplateListResponse | undefined,
  identity: TableIdentity | null
): RowPolicyTemplateOption[] {
  const templates = response?.templates ?? [];
  const judged = Boolean(identity && isCompleteIdentity(identity));
  return templates.map((template) => {
    const entry = judged && identity
      ? template.usabilityByTable.find(
          (item) =>
            item.connectionId === identity.connectionId &&
            item.schema === identity.schema &&
            item.sourceName === identity.sourceName
        )
      : undefined;
    const usability = entry?.usability
      ? (entry.usability as RowPolicyTemplateOption["usability"])
      : {
          status: "catalog_unknown" as const,
          reason: judged
            ? "服务端未返回该表的可用性结论"
            : "该表缺少连接标识，无法判定可绑定性"
        };
    return {
      name: template.name,
      description: template.description,
      usability
    };
  });
}

type PreviewGrant = RowPolicyDnfGrant;

type PreviewEntry = RowPolicyPreviewEntry;

/**
 * The operations-side reason for a table whose final row constraints could not
 * be computed. It MUST replace 「全部行」: an unavailable catalog is an
 * operations-side fault, not a user configuration error.
 */
function previewUnavailableReason(
  entry: PreviewEntry | undefined,
  queryFailed: boolean
): string | null {
  if (queryFailed) {
    return "最终行约束预览失败：无法读取字段目录状态，请联系运维核查。";
  }
  if (!entry) return null;
  if (entry.catalog?.status === "manifest_unavailable") {
    return `清单不可用（需运维处理）：${entry.catalog.stage ?? "unknown"}`;
  }
  if (entry.catalog?.status === "catalog_capability_unknown") {
    return "目录能力未知（需运维处理）：当前适配器无法证明字段目录可用。";
  }
  if (entry.error) {
    return `最终行约束预览失败：${entry.error.message}`;
  }
  return null;
}


function normalizePredicates(predicates: RowPolicyPredicateDraft[]): RowPolicyPredicateDraft[] {
  return predicates.map((predicate) => {
    if (predicate.op === "in") {
      const values = (Array.isArray(predicate.value) ? predicate.value : String(predicate.value).split(","))
        .map((value) => String(value).trim())
        .filter(Boolean);
      return { field: predicate.field.trim(), op: "in" as const, value: [...new Set(values)] };
    }
    return {
      field: predicate.field.trim(),
      op: "eq" as const,
      value: (Array.isArray(predicate.value) ? String(predicate.value[0] ?? "") : String(predicate.value)).trim(),
    };
  });
}

export function RoleRowPolicyPanel({
  tables,
  onChange,
  disabled = false,
  catalogBound = false,
  roleId,
  previewRole,
  onConfirmation,
}: RoleRowPolicyPanelProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeTable = tables.find((table) => permissionTableKey(table) === activeKey) ?? null;
  const [drawerPredicates, setDrawerPredicates] = useState<RowPolicyPredicateDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ── R2: the final-row preview is computed from the in-memory candidate ─────
  // The query is shared with the save entry point, so the confirmation the save
  // carries is the confirmation of the preview the user actually saw.
  const previewQuery = useRowPolicyPreview({ roleId, previewRole, tables });

  const previewEntries = previewQuery.data?.tables ?? [];
  const previewEntryFor = (table: TableGrant): PreviewEntry | undefined =>
    previewEntries.find(
      (entry) =>
        entry.requested.connection === table.connection &&
        entry.requested.schema === table.schema &&
        entry.requested.name === table.name
    );

  // Spec §14.2.1 — report the confirmation of the CURRENT preview. It is null
  // whenever the preview did not succeed for every affected table, so the save
  // entry point can refuse a save that has no valid confirmation.
  const previewConfirmation = previewQuery.data?.confirmation ?? null;
  useEffect(() => {
    onConfirmation?.(previewConfirmation);
  }, [previewConfirmation, onConfirmation]);

  // ── P1-1 §3.1 / §6.1: 行策略模板候选与逐表可用性 ────────────────────────────
  // 每张表一个查询：可用性是**逐表**结论，别处的可绑定不代表这里可绑定。
  const tableIdentities = useMemo(() => tables.map((table) => tableIdentityOf(table)), [tables]);
  const templateQueries = useQueries({
    queries: tableIdentities.map((identity) => ({
      queryKey: ["admin", "row-policy", "templates", identity.connectionId, identity.schema, identity.sourceName],
      queryFn: () => apiGet<RowPolicyTemplateListResponse>(templatesUrl(identity)),
      enabled: isCompleteIdentity(identity)
    }))
  });
  // 缺连接标识的表拿不到逐表可用性：仍要列出**全部候选**（只是全部不可绑定），
  // 否则运维会看到「没有模板」，误以为模板不存在。
  const needsCatalogOnlyList = tableIdentities.some((identity) => !isCompleteIdentity(identity));
  const catalogOnlyQuery = useQuery({
    queryKey: ["admin", "row-policy", "templates"],
    queryFn: () => apiGet<RowPolicyTemplateListResponse>("/api/admin/row-policy/templates"),
    enabled: needsCatalogOnlyList
  });
  const templateOptionsForTable = (index: number): RowPolicyTemplateOption[] => {
    const identity = tableIdentities[index] ?? null;
    const response = identity && isCompleteIdentity(identity)
      ? templateQueries[index]?.data
      : catalogOnlyQuery.data;
    return templateOptionsFor(response, identity);
  };
  const templateQueryFailedAt = (index: number): boolean => {
    const identity = tableIdentities[index] ?? null;
    return identity && isCompleteIdentity(identity)
      ? Boolean(templateQueries[index]?.isError)
      : Boolean(catalogOnlyQuery.isError);
  };
  /** 模板列表已读回（不是加载中、也没有失败）。 */
  const templateListLoadedAt = (index: number): boolean => {
    const identity = tableIdentities[index] ?? null;
    if (identity && isCompleteIdentity(identity)) {
      return !templateQueries[index]?.isPending && !templateQueries[index]?.isError;
    }
    return !catalogOnlyQuery.isPending && !catalogOnlyQuery.isError;
  };

  function setTableTemplate(table: TableGrant, templateName: string | undefined) {
    // 只改模板引用，**不动内联谓词**：切到「直接写条件」不丢已写的内容，
    // 切到「两者并用」也不丢（P1-1 §3.1：模板谓词与内联谓词取交集）。
    onChange(tables.map((candidate) =>
      permissionTableKey(candidate) === permissionTableKey(table)
        ? { ...candidate, rowPolicyTemplate: templateName }
        : candidate
    ));
  }

  useEffect(() => {
    setDrawerPredicates(activeTable?.predicates?.map((predicate) => ({ ...predicate, value: Array.isArray(predicate.value) ? [...predicate.value] : predicate.value })) ?? []);
    setError(null);
  }, [activeKey]);

  const sourceUrl = activeTable
    ? `/api/sources/${encodeURIComponent(activeTable.connection)}/${encodeURIComponent(activeTable.schema)}/${encodeURIComponent(activeTable.name)}`
    : "";
  const sourceQuery = useQuery({
    queryKey: ["source", activeTable?.connection, activeTable?.schema, activeTable?.name],
    queryFn: () => apiGet<SourceDetail>(sourceUrl),
    enabled: Boolean(activeTable),
  });
  const columns = useMemo(() => sourceQuery.data?.model.columns.map((column) => column.name) ?? [], [sourceQuery.data]);

  function updatePredicate(index: number, patch: Partial<RowPolicyPredicateDraft>) {
    setDrawerPredicates((current) => current.map((predicate, currentIndex) => currentIndex === index ? { ...predicate, ...patch } : predicate));
    setError(null);
  }

  function apply() {
    if (!activeTable || sourceQuery.isError || !sourceQuery.data) return;
    const normalized = normalizePredicates(drawerPredicates);
    for (let index = 0; index < normalized.length; index += 1) {
      const predicate = normalized[index]!;
      if (!columns.includes(predicate.field)) {
        setError(`条件 ${index + 1} 必须选择当前表的物理字段`);
        return;
      }
      if (predicate.op === "eq" && !String(predicate.value).trim()) {
        setError(`条件 ${index + 1} 缺少取值`);
        return;
      }
      if (predicate.op === "in" && (!Array.isArray(predicate.value) || predicate.value.length === 0)) {
        setError(`条件 ${index + 1} 至少需要一个取值`);
        return;
      }
    }
    onChange(tables.map((table) => permissionTableKey(table) === activeKey
      ? { ...table, predicates: normalized.length > 0 ? normalized : undefined }
      : table));
    setActiveKey(null);
  }

  if (catalogBound) {
    return (
      <div className="rounded-md border border-border-default bg-bg-subtle p-4" data-testid="row-policy-catalog-bound-disabled">
        <p className="text-sm font-medium">启用目录绑定不支持行级策略</p>
        <p className="mt-1 text-xs text-fg-muted">如需限制行，请先回到“可访问的表”，关闭启用目录绑定并明确选择表。</p>
      </div>
    );
  }

  const previewQueryFailed = previewQuery.isError;

  return (
    <>
      <div className="grid gap-3" data-testid="role-row-policy-panel">
        {tables.length === 0 ? (
          <div className="rounded-md border border-border-default bg-bg-subtle p-4 text-sm text-fg-muted">
            请先在“可访问的表”中选择表，再配置行级策略。
          </div>
        ) : tables.map((table, tableIndex) => {
          const key = permissionTableKey(table);
          const entry = previewEntryFor(table);
          const unavailableReason = previewUnavailableReason(entry, previewQueryFailed);
          const grant = entry?.preview?.effectiveRowGrant;
          const inlineCount = table.predicates?.length ?? 0;
          const templateName = table.rowPolicyTemplate;
          const hasTemplate = Boolean(templateName);
          const hasPolicy = hasTemplate || inlineCount > 0;
          const templateOptions = templateOptionsForTable(tableIndex);
          const templateQueryFailed = templateQueryFailedAt(tableIndex);
          // 「全部行」 may only be claimed when the preview actually succeeded.
          const badge = hasTemplate && inlineCount === 0
            ? { text: "已引用行策略模板", state: "done" as const }
            : hasPolicy
              ? { text: `已配置 ${inlineCount} 条条件`, state: "done" as const }
              : unavailableReason
                ? { text: "受限状态未知", state: "warning" as const }
                : grant?.kind === "all"
                  ? { text: "全部行", state: "not_started" as const }
                  : grant?.kind === "scoped"
                    ? { text: "受其他角色限制", state: "warning" as const }
                    : { text: "受限状态未知", state: "warning" as const };
          return (
            <div key={key} className="grid gap-2" data-testid={`row-policy-entry-${key}`}>
              <div className="pl-card flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={(event) => {
                    drawerTriggerRef.current = event.currentTarget;
                    setActiveKey(key);
                  }}
                  disabled={disabled}
                  aria-label={`编辑 ${table.name} 行级策略`}
                >
                  <span className="min-w-0">
                    <span className="notranslate block text-sm font-medium" translate="no">{table.name}</span>
                    <span className="notranslate block text-xs text-fg-muted" translate="no">{table.connection} / {table.schema}</span>
                  </span>
                </button>
                <span className={`pl-status-badge ${badge.state === "done" ? "pl-status-done" : badge.state === "not_started" ? "pl-status-not_started" : "pl-status-partial"}`}>
                  {badge.text}
                </span>
              </div>
              {hasPolicy ? (
                <div className="flex items-center gap-2" data-testid={`row-policy-authoring-mode-${key}`}>
                  <RowPolicyAuthoringModeBadge templateName={templateName} inlinePredicateCount={inlineCount} />
                  <span className="text-xs text-fg-muted">
                    {templateName && inlineCount > 0
                      ? "模板条件与直接写的条件在同一选择器内取交集。"
                      : templateName
                        ? "只使用模板条件；模板只作溯源，不改变展开后的语义。"
                        : "只使用直接写的条件。"}
                  </span>
                </div>
              ) : null}
              {templateQueryFailed ? (
                <p className="text-xs text-warning-strong" role="status" data-testid={`row-policy-template-error-${key}`}>
                  行策略模板列表读取失败，暂时不能选择模板；直接写的条件不受影响。
                </p>
              ) : null}
              {templateName && templateListLoadedAt(tableIndex) && !templateOptions.some((option) => option.name === templateName) ? (
                <p className="text-xs text-warning-strong" role="status" data-testid={`row-policy-template-missing-${key}`}>
                  当前引用的行策略模板不在模板列表中，保存会被拒绝；请在模板管理页恢复该模板，或改选其它模板。
                </p>
              ) : null}
              <RowPolicyTemplatePicker
                templates={templateOptions}
                value={templateName}
                onChange={(name) => setTableTemplate(table, name)}
                disabled={disabled || templateQueryFailed}
                id={`row-policy-template-${key}`}
              />
              {unavailableReason ? (
                <p className="text-xs text-warning-strong" role="status" data-testid={`row-policy-preview-unavailable-${key}`}>
                  {unavailableReason}
                </p>
              ) : null}
              <details data-testid={`row-policy-preview-details-${key}`}>
                <summary className="cursor-pointer text-xs text-fg-muted">最终行约束预览</summary>
                <div className="mt-2">
                  <RowPolicyDnfPreview
                    effectiveRowGrant={grant}
                    roleIds={entry?.preview?.roleIds}
                    finalRowsByAgent={entry?.preview?.finalRowsByAgent}
                    unavailableReason={unavailableReason}
                    footer={
                      entry?.preview ? (
                        <p className="text-xs text-fg-muted notranslate" translate="no">
                          candidateDigest={previewQuery.data?.candidateDigest ?? ""}
                        </p>
                      ) : null
                    }
                  />
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <Dialog.Root open={Boolean(activeTable)} onOpenChange={(open) => { if (!open) setActiveKey(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="pl-drawer-overlay" />
          <Dialog.Content
            className="pl-drawer-panel"
            data-testid="row-policy-drawer"
            aria-describedby="row-policy-description"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              drawerTriggerRef.current?.focus();
            }}
          >
            <header className="pl-drawer-header">
              <div>
                <Dialog.Title className="pl-panel-title">编辑行级策略</Dialog.Title>
                <Dialog.Description id="row-policy-description" className="mt-1 text-sm text-fg-muted">
                  仅允许使用当前表可证明为行级的物理字段。
                </Dialog.Description>
                {activeTable ? <code className="notranslate mt-1 block text-xs" translate="no">{permissionTableKey(activeTable)}</code> : null}
              </div>
              <Dialog.Close className="pl-btn pl-btn--ghost pl-drawer-close pl-drawer-close--prominent">关闭</Dialog.Close>
            </header>

            <div className="pl-drawer-body min-h-0 flex-1 overflow-auto">
              {sourceQuery.isPending ? <p className="text-sm text-fg-muted">正在读取字段…</p> : null}
              {sourceQuery.isError ? (
                <div className="pl-drawer-error" role="alert">字段元数据加载失败，不能新增或修改行级策略。关闭 Drawer 不会改变现有配置。</div>
              ) : null}
              {sourceQuery.data ? (
                <div className="grid content-start gap-3">
                  {activeTable?.rowPolicyTemplate ? (
                    <p className="text-sm text-fg-muted" data-testid="row-policy-drawer-template">
                      这张表已引用行策略模板{" "}
                      <span className="notranslate" translate="no">{activeTable.rowPolicyTemplate}</span>
                      ，下面直接写的条件与模板条件取交集。
                    </p>
                  ) : null}
                  {drawerPredicates.length === 0 ? (
                    <p className="text-sm text-fg-muted">
                      {activeTable?.rowPolicyTemplate
                        ? "当前没有直接写的条件；这张表的行限制来自引用的模板。"
                        : "当前为全部行。添加条件后保存为限定行。"}
                    </p>
                  ) : null}
                  {drawerPredicates.map((predicate, index) => (
                    <div key={index} className="grid gap-2 rounded-md border border-border-default p-3">
                      <label className="grid gap-1 text-sm">
                        <span>字段</span>
                        <select
                          aria-label={`${activeTable?.name ?? "表"} 条件 ${index + 1} 字段`}
                          className="pl-input notranslate"
                          translate="no"
                          value={predicate.field}
                          onChange={(event) => updatePredicate(index, { field: event.target.value })}
                        >
                          <option value="">请选择物理字段</option>
                          {!columns.includes(predicate.field) && predicate.field ? <option value={predicate.field}>{predicate.field}（待修复）</option> : null}
                          {columns.map((column) => <option key={column} value={column}>{column}</option>)}
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span>条件</span>
                        <select
                          aria-label={`${activeTable?.name ?? "表"} 条件 ${index + 1} 运算符`}
                          className="pl-input"
                          value={predicate.op}
                          onChange={(event) => updatePredicate(index, { op: event.target.value as "eq" | "in", value: event.target.value === "in" ? [] : "" })}
                        >
                          <option value="eq">等于</option>
                          <option value="in">属于</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-sm">
                        <span>{predicate.op === "in" ? "取值（逗号分隔）" : "取值"}</span>
                        <input
                          aria-label={`${activeTable?.name ?? "表"} 条件 ${index + 1} 取值`}
                          className="pl-input"
                          value={Array.isArray(predicate.value) ? predicate.value.join(", ") : String(predicate.value)}
                          onChange={(event) => updatePredicate(index, { value: predicate.op === "in" ? event.target.value.split(",") : event.target.value })}
                        />
                      </label>
                      <button
                        type="button"
                        className="pl-btn pl-btn--ghost justify-self-start text-xs text-danger"
                        aria-label={`删除 ${activeTable?.name ?? "表"} 条件 ${index + 1}`}
                        onClick={() => setDrawerPredicates((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                      >删除条件</button>
                    </div>
                  ))}
                  <button type="button" className="pl-btn pl-btn--secondary justify-self-start text-sm" onClick={() => setDrawerPredicates((current) => [...current, { field: "", op: "eq", value: "" }])}>添加条件</button>
                  {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
                </div>
              ) : null}
            </div>

            <footer className="pl-drawer-footer pl-drawer-footer-border-t">
              <Dialog.Close className="pl-btn pl-btn--ghost">取消</Dialog.Close>
              <button type="button" className="pl-btn pl-btn--primary" onClick={apply} disabled={!sourceQuery.data || sourceQuery.isError}>应用</button>
            </footer>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
