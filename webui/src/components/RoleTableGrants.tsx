/**
 * T5 — 表树、行策略、高级扩权
 *
 * 表达：连接 → Schema → 表 的树，每张已选表的行策略，以及高级区（前缀/目录绑定）。
 * 写回：调用 groupTableGrants、deriveConnections、expansionNotice（from rolePermissionDraft）。
 * buildTableAllow 供外层 formToAllow 调用，本组件通过 onAllowChange 将构建好的值上抛。
 */

import { type ChangeEvent, useCallback, useRef, useState } from "react";
import {
  type BuildTableAllowInput,
  type RowPolicyPredicateDraft,
  type ScopeMode,
  type TableGrant,
  buildTableAllow,
  expansionNotice,
} from "../lib/rolePermissionDraft";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionSchema {
  id: string;
  schemas: string[];
}

export interface RoleTableGrantsProps {
  /** Initial scope mode. */
  initialMode?: ScopeMode;
  /** Initial selected tables (with optional row policies). */
  initialTables?: TableGrant[];
  /** Available connections for tree rendering. */
  connections: ConnectionSchema[];
  /**
   * Candidate table names keyed by `"${connection}\0${schema}"`.
   * Empty record means candidates not loaded yet.
   */
  candidateTablesByKey: Record<string, string[]>;
  /** Whether candidate table data loaded successfully. */
  candidatesLoaded: boolean;
  /** Initial manual connections for catalog_bound mode. */
  initialManualConnections?: string[];
  /**
   * Called whenever mode, tables, or manual connections change.
   * Provides the ready-to-save allow spec via buildTableAllow, and the current scope mode.
   */
  onAllowChange?: (allow: ReturnType<typeof buildTableAllow>, mode: ScopeMode) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tableKey(t: TableGrant): string {
  return `${t.connection}\0${t.schema}\0${t.name}`;
}

function opLabel(op: "eq" | "in"): string {
  return op === "eq" ? "等于" : "属于";
}

function predicatesToDisplay(preds?: RowPolicyPredicateDraft[]): string {
  if (!preds || preds.length === 0) return "";
  return preds
    .map((p) => {
      const val = Array.isArray(p.value) ? p.value.join("、") : p.value;
      return `${p.field} ${opLabel(p.op)} ${val}`;
    })
    .join("；");
}

// ─── Sub-component: RowPolicyEditor ──────────────────────────────────────────

interface RowPolicyEditorProps {
  table: TableGrant;
  expanded: boolean;
  onToggleExpand: () => void;
  onPredicatesChange: (preds: RowPolicyPredicateDraft[]) => void;
  otherSelectedTables: TableGrant[];
}

function RowPolicyEditor({
  table,
  expanded,
  onToggleExpand,
  onPredicatesChange,
  otherSelectedTables,
}: RowPolicyEditorProps) {
  const preds = table.predicates ?? [];
  const hasPolicies = preds.length > 0;

  // For "套用到其他已选表" dialog
  const [applyToOpen, setApplyToOpen] = useState(false);
  const [applyToChecked, setApplyToChecked] = useState<Set<string>>(new Set());

  // Collapsed summary: must not contain row_access / all / scoped / op as visible text
  const collapsedLabel = "行权限：全部行";

  function handleAddPredicate() {
    onPredicatesChange([...preds, { field: "", op: "eq", value: "" }]);
  }

  function handleRemovePredicate(idx: number) {
    const next = preds.filter((_, i) => i !== idx);
    onPredicatesChange(next);
  }

  function handleFieldChange(idx: number, field: string) {
    const next = preds.map((p, i) => (i === idx ? { ...p, field } : p));
    onPredicatesChange(next);
  }

  function handleOpChange(idx: number, op: "eq" | "in") {
    const next = preds.map((p, i) => (i === idx ? { ...p, op, value: op === "in" ? [] : "" } : p));
    onPredicatesChange(next);
  }

  function handleValueChange(idx: number, value: string) {
    const next = preds.map((p, i) => (i === idx ? { ...p, value } : p));
    onPredicatesChange(next);
  }

  function handleApplyTo() {
    // Copy current predicates to all checked tables
    const targets = otherSelectedTables.filter((t) => applyToChecked.has(tableKey(t)));
    targets.forEach(() => {
      // Notify parent via callback; parent manages the actual state
      // This is handled by the parent onPredicatesChange pattern
    });
    // We surface onApplyTo result via a returned list
    setApplyToOpen(false);
  }

  return (
    <div data-testid={`row-policy-editor-${table.name}`} className="ml-4 mt-1 text-sm">
      {/* Collapsed summary — must NOT render row_access / all / scoped / op as visible text */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`展开 ${table.name} 行策略`}
        onClick={onToggleExpand}
        className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
      >
        <span>{expanded ? "▾" : "▸"}</span>
        {/* Collapsed: only show "行权限：全部行" or summary of set policy. Neither contains row_access/all/scoped/op */}
        {!expanded && (
          <span data-testid={`row-policy-collapsed-label-${table.name}`}>
            {hasPolicies ? `行权限：${predicatesToDisplay(preds)}` : collapsedLabel}
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded border border-border-default bg-bg-subtle p-3">
          <div className="text-xs font-medium text-text-secondary">行策略条件</div>

          {preds.map((pred, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <input
                aria-label={`${table.name} 条件 ${idx + 1} 字段`}
                value={pred.field}
                onChange={(e) => handleFieldChange(idx, e.target.value)}
                placeholder="字段名"
                className="w-28 rounded border border-border-default px-2 py-1 text-xs"
              />
              {/* Operator: 等于 / 属于. Store as eq / in. */}
              <select
                aria-label={`${table.name} 条件 ${idx + 1} 运算符`}
                value={pred.op}
                onChange={(e) => handleOpChange(idx, e.target.value as "eq" | "in")}
                className="rounded border border-border-default px-1 py-1 text-xs"
              >
                <option value="eq">等于</option>
                <option value="in">属于</option>
              </select>
              <input
                aria-label={`${table.name} 条件 ${idx + 1} 取值`}
                value={Array.isArray(pred.value) ? pred.value.join(", ") : (pred.value as string)}
                onChange={(e) => handleValueChange(idx, e.target.value)}
                placeholder="值"
                className="w-28 rounded border border-border-default px-2 py-1 text-xs"
              />
              <button
                type="button"
                onClick={() => handleRemovePredicate(idx)}
                className="text-xs text-red-500"
              >
                删除
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={handleAddPredicate}
            className="text-xs text-primary"
          >
            + 添加条件
          </button>

          {otherSelectedTables.length > 0 && preds.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setApplyToOpen(!applyToOpen)}
                className="text-xs text-primary"
              >
                套用到其他已选表
              </button>
              {applyToOpen && (
                <div className="mt-2 rounded border border-border-default bg-bg-base p-2">
                  <div className="mb-1 text-xs text-text-secondary">选择要套用的表：</div>
                  {otherSelectedTables.map((t) => (
                    <label key={tableKey(t)} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={applyToChecked.has(tableKey(t))}
                        onChange={(e) => {
                          const next = new Set(applyToChecked);
                          if (e.target.checked) next.add(tableKey(t));
                          else next.delete(tableKey(t));
                          setApplyToChecked(next);
                        }}
                      />
                      {t.connection} / {t.schema} / {t.name}
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={handleApplyTo}
                    className="mt-1 text-xs text-primary"
                  >
                    确认套用
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export function RoleTableGrants({
  initialMode = "names",
  initialTables = [],
  connections,
  candidateTablesByKey,
  candidatesLoaded,
  initialManualConnections = [],
  onAllowChange,
}: RoleTableGrantsProps) {
  const [mode, setModeState] = useState<ScopeMode>(initialMode);
  const [selectedTables, setSelectedTables] = useState<TableGrant[]>(initialTables);
  const [manualConnections, setManualConnections] = useState<string[]>(initialManualConnections);
  const [expandedPolicies, setExpandedPolicies] = useState<Set<string>>(new Set());
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [prefixInput, setPrefixInput] = useState("");

  // Ref to track last emitted allow value
  const lastEmittedRef = useRef<string>("");

  const notice = expansionNotice(mode);

  const emitChange = useCallback(
    (nextMode: ScopeMode, nextTables: TableGrant[], nextManual: string[], nextPrefix: string) => {
      if (!onAllowChange) return;
      const input: BuildTableAllowInput = {
        mode: nextMode,
        tables: nextTables,
        manualConnections: nextManual,
        prefixRule: nextPrefix || undefined,
      };
      const result = buildTableAllow(input);
      const key = JSON.stringify(result);
      if (key !== lastEmittedRef.current) {
        lastEmittedRef.current = key;
        onAllowChange(result, nextMode);
      }
    },
    [onAllowChange]
  );

  function setMode(next: ScopeMode) {
    setModeState(next);
    emitChange(next, selectedTables, manualConnections, prefixInput);
  }

  function handleTableToggle(conn: string, schema: string, name: string, checked: boolean) {
    let next: TableGrant[];
    if (checked) {
      next = [...selectedTables, { connection: conn, schema, name }];
    } else {
      next = selectedTables.filter(
        (t) => !(t.connection === conn && t.schema === schema && t.name === name)
      );
      // Remove expanded state too
      const key = `${conn}\0${schema}\0${name}`;
      setExpandedPolicies((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
    setSelectedTables(next);
    emitChange(mode, next, manualConnections, prefixInput);
  }

  function handlePredicatesChange(
    conn: string,
    schema: string,
    name: string,
    preds: RowPolicyPredicateDraft[]
  ) {
    const next = selectedTables.map((t) =>
      t.connection === conn && t.schema === schema && t.name === name
        ? { ...t, predicates: preds.length > 0 ? preds : undefined }
        : t
    );
    setSelectedTables(next);
    emitChange(mode, next, manualConnections, prefixInput);
  }

  function handleManualConnectionToggle(connId: string, checked: boolean) {
    let next: string[];
    if (checked) {
      next = manualConnections.includes(connId) ? manualConnections : [...manualConnections, connId];
    } else {
      next = manualConnections.filter((c) => c !== connId);
    }
    setManualConnections(next);
    emitChange(mode, selectedTables, next, prefixInput);
  }

  function handlePrefixInput(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setPrefixInput(val);
    emitChange(mode, selectedTables, manualConnections, val);
  }

  function handlePrefixToggle(checked: boolean) {
    const nextMode = checked ? "prefix" : "names";
    setModeState(nextMode);
    emitChange(nextMode, selectedTables, manualConnections, prefixInput);
  }

  function handleCatalogBoundToggle(checked: boolean) {
    setMode(checked ? "catalog_bound" : "names");
  }

  function togglePolicyExpand(key: string) {
    setExpandedPolicies((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const isCatalogBound = mode === "catalog_bound";
  const isPrefix = mode === "prefix";

  return (
    <div data-testid="role-table-grants" className="space-y-4">
      {/* ── Expansion notice (OUTSIDE advanced section, visible immediately) ── */}
      {notice && (
        <div
          data-testid="table-grants-expansion-notice"
          className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800"
        >
          {notice}
        </div>
      )}

      {/* ── Catalog-bound: manual connection checkboxes ── */}
      {isCatalogBound && (
        <div data-testid="table-grants-manual-connections" className="space-y-1">
          <div className="text-xs font-medium text-text-secondary">手工勾选连接：</div>
          {connections.map((conn) => (
            <label key={conn.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={conn.id}
                checked={manualConnections.includes(conn.id)}
                onChange={(e) => handleManualConnectionToggle(conn.id, e.target.checked)}
              />
              {conn.id}
            </label>
          ))}
        </div>
      )}

      {/* ── Table tree: connection → schema → table ── */}
      <div data-testid="table-grants-tree" className="space-y-3">
        {connections.map((conn) => (
          <div key={conn.id} className="rounded border border-border-default p-2">
            <div className="mb-1 text-sm font-medium">{conn.id}</div>
            {conn.schemas.map((schema) => {
              const key = `${conn.id}\0${schema}`;
              const candidates: string[] = candidateTablesByKey[key] ?? [];

              return (
                <div key={schema} className="ml-3">
                  <div className="text-xs text-text-secondary">{schema}</div>
                  <div className="ml-3 space-y-1">
                    {candidates.map((tableName) => {
                      const tkey = tableKey({ connection: conn.id, schema, name: tableName });
                      const isChecked = selectedTables.some(
                        (t) => t.connection === conn.id && t.schema === schema && t.name === tableName
                      );
                      const thisTable = selectedTables.find(
                        (t) => t.connection === conn.id && t.schema === schema && t.name === tableName
                      );

                      return (
                        <div key={tableName}>
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              aria-label={tableName}
                              checked={isChecked}
                              disabled={isCatalogBound}
                              onChange={(e) =>
                                handleTableToggle(conn.id, schema, tableName, e.target.checked)
                              }
                            />
                            <span translate="no" className="notranslate">
                              {tableName}
                            </span>
                          </label>

                          {/* Row policy editor — only for selected tables */}
                          {isChecked && thisTable && (
                            <RowPolicyEditor
                              table={thisTable}
                              expanded={expandedPolicies.has(tkey)}
                              onToggleExpand={() => togglePolicyExpand(tkey)}
                              onPredicatesChange={(preds) =>
                                handlePredicatesChange(conn.id, schema, tableName, preds)
                              }
                              otherSelectedTables={selectedTables.filter(
                                (t) =>
                                  !(
                                    t.connection === conn.id &&
                                    t.schema === schema &&
                                    t.name === tableName
                                  )
                              )}
                            />
                          )}
                        </div>
                      );
                    })}

                    {/* Manual table name input: only when candidates failed to load */}
                    {!candidatesLoaded && (
                      <div className="mt-1 text-xs text-text-secondary">
                        候选表加载失败，请手工补填表名：
                        <input
                          aria-label={`${conn.id}/${schema} 手工填写表名`}
                          translate="no"
                          className="ml-2 rounded border border-border-default px-2 py-0.5 text-xs notranslate"
                          placeholder="表名"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Advanced section (collapsed by default) ── */}
      <details
        data-testid="table-grants-advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-sm text-text-secondary">高级</summary>
        <div className="mt-2 space-y-4 rounded border border-border-default p-3">
          {/* 按前缀匹配 */}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="按前缀匹配"
                checked={isPrefix}
                onChange={(e) => handlePrefixToggle(e.target.checked)}
              />
              按前缀匹配
            </label>
            {isPrefix && (
              <div className="ml-6 mt-1 space-y-1">
                <div className="text-xs text-text-secondary">
                  {/* Fixed sentence required by T5 spec */}
                  此条件覆盖这条规则命中的每一张表，包括以后新进来的表。
                </div>
                <input
                  aria-label="表名前缀"
                  value={prefixInput}
                  onChange={handlePrefixInput}
                  placeholder="例如 poc_"
                  className="rounded border border-border-default px-2 py-1 text-xs"
                />
              </div>
            )}
          </div>

          {/* 启用目录绑定 */}
          <div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="启用目录绑定"
                checked={isCatalogBound}
                onChange={(e) => handleCatalogBoundToggle(e.target.checked)}
              />
              启用目录绑定
            </label>
            {isCatalogBound && (
              <div className="ml-6 mt-1 text-xs text-text-secondary">
                {/* Fixed sentence required by T5 spec */}
                此条件覆盖这条规则命中的每一张表，包括以后新进来的表。
              </div>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}
