import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/apiClient";
import type { SourceDetail } from "../lib/types";
import type { RowPolicyPredicateDraft, TableGrant } from "../lib/rolePermissionDraft";
import { permissionTableKey } from "../lib/rolePermissionDraft";

export interface RoleRowPolicyPanelProps {
  tables: TableGrant[];
  onChange: (tables: TableGrant[]) => void;
  disabled?: boolean;
  catalogBound?: boolean;
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
}: RoleRowPolicyPanelProps) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const drawerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activeTable = tables.find((table) => permissionTableKey(table) === activeKey) ?? null;
  const [drawerPredicates, setDrawerPredicates] = useState<RowPolicyPredicateDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <>
      <div className="grid gap-3" data-testid="role-row-policy-panel">
        {tables.length === 0 ? (
          <div className="rounded-md border border-border-default bg-bg-subtle p-4 text-sm text-fg-muted">
            请先在“可访问的表”中选择表，再配置行级策略。
          </div>
        ) : tables.map((table) => (
          <button
            type="button"
            key={permissionTableKey(table)}
            className="pl-card flex items-center justify-between gap-3 text-left"
            onClick={(event) => {
              drawerTriggerRef.current = event.currentTarget;
              setActiveKey(permissionTableKey(table));
            }}
            disabled={disabled}
            aria-label={`编辑 ${table.name} 行级策略`}
          >
            <span>
              <span className="notranslate block text-sm font-medium" translate="no">{table.name}</span>
              <span className="notranslate block text-xs text-fg-muted" translate="no">{table.connection} / {table.schema}</span>
            </span>
            <span className={`pl-status-badge ${table.predicates?.length ? "pl-status-done" : "pl-status-not_started"}`}>
              {table.predicates?.length ? `已配置 ${table.predicates.length} 条条件` : "全部行"}
            </span>
          </button>
        ))}
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
                  {drawerPredicates.length === 0 ? <p className="text-sm text-fg-muted">当前为全部行。添加条件后保存为限定行。</p> : null}
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
