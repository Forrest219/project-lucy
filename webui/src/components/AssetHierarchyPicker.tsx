import { useMemo, useState, type ReactNode } from "react";
import { CheckboxCandidatePicker } from "./CheckboxCandidatePicker";
import { TagInput } from "./TagInput";
import type { ConnectionInfo } from "../lib/types";

export type FormRowPredicate = {
  field: string;
  op: "eq" | "in";
  value: string;
  values: string[];
};

export type SelectorItem = {
  connection: string;
  schema: string;
  kind: "names" | "prefix";
  names: string[];
  prefix: string;
  rowAccess: "all" | "scoped";
  predicates: FormRowPredicate[];
};

export const EMPTY_PREDICATE: FormRowPredicate = { field: "", op: "eq", value: "", values: [] };

type Props = {
  selectors: SelectorItem[];
  onChange: (next: SelectorItem[]) => void;
  connections: string[];
  connectionCandidates: ConnectionInfo[];
  tablesByConnection: Map<string, { tables: string[]; isLoading: boolean; isError: boolean }>;
  isReadOnly?: boolean;
};

export function AssetHierarchyPicker({
  selectors,
  onChange,
  connections,
  connectionCandidates,
  tablesByConnection,
  isReadOnly = false
}: Props) {
  const availableConnectionIds = useMemo(
    () => (connections.length > 0 ? connections : connectionCandidates.map((c) => c.id)),
    [connections, connectionCandidates]
  );

  function handleAddSelector() {
    onChange([
      ...selectors,
      {
        connection: availableConnectionIds[0] ?? "",
        schema: "",
        kind: "names",
        names: [],
        prefix: "",
        rowAccess: "all",
        predicates: []
      }
    ]);
  }

  function handleRemoveSelector(index: number) {
    onChange(selectors.filter((_, i) => i !== index));
  }

  function handleUpdateSelector(index: number, updated: SelectorItem) {
    const next = [...selectors];
    next[index] = updated;
    onChange(next);
  }

  return (
    <div className="grid gap-3" data-testid="role-table-ranges-field">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-sm font-medium">可访问的表范围</div>
          <p className="text-xs text-fg-muted">
            限定可查询的 <span className="notranslate" translate="no">Schema</span> 与数据表规则。单次配置为单选模式，支持同 <span className="notranslate" translate="no">Schema</span> 独立添加多条规则以并集（OR）生效。
          </p>
        </div>
        {!isReadOnly && (
          <button
            type="button"
            className="pl-btn pl-btn--ghost text-xs"
            onClick={handleAddSelector}
          >
            + 添加表范围
          </button>
        )}
      </div>

      {selectors.length === 0 ? (
        <p className="text-xs text-fg-muted">
          尚未添加表范围。此 <span className="notranslate" translate="no">Role</span> 不能访问任何数据表。
        </p>
      ) : (
        <div className="grid gap-3">
          {selectors.map((row, idx) => {
            const connMeta = connectionCandidates.find((item) => item.id === row.connection);
            const schemaOptions = connMeta?.schemas ?? [];
            const schemaFallback = Boolean(row.connection) && schemaOptions.length === 0;
            const tableState = row.connection ? tablesByConnection.get(row.connection) : undefined;
            const allSchemaTables =
              row.schema && tableState
                ? tableState.tables
                    .filter((t) => t.startsWith(`${row.schema}.`))
                    .map((t) => t.slice(row.schema.length + 1))
                : [];
            const tablesFallback =
              row.kind === "names" &&
              Boolean(row.connection && row.schema) &&
              (tableState?.isError || (!tableState?.isLoading && allSchemaTables.length === 0));

            const matchedPrefixCount =
              row.kind === "prefix" && row.prefix.trim()
                ? allSchemaTables.filter((t) => t.startsWith(row.prefix.trim())).length
                : 0;

            return (
              <div
                key={idx}
                className="grid gap-3 rounded-md border border-border-default bg-bg-base p-3.5 shadow-sm"
                data-testid={`role-table-range-${idx + 1}`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-border-subtle pb-2">
                  <span className="text-xs font-semibold text-fg-muted uppercase tracking-wider">
                    规则 #{idx + 1}
                    {row.connection && row.schema ? (
                      <span className="ml-2 font-mono text-accent notranslate" translate="no">
                        {row.connection} / {row.schema}
                      </span>
                    ) : null}
                  </span>
                  {!isReadOnly && (
                    <button
                      type="button"
                      className="pl-btn pl-btn--ghost text-xs text-danger hover:text-danger-strong"
                      onClick={() => handleRemoveSelector(idx)}
                    >
                      删除规则
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="grid gap-1">
                    <span className="text-xs text-fg-muted">连接</span>
                    <select
                      className="pl-input notranslate text-xs"
                      translate="no"
                      value={row.connection}
                      aria-label={`表范围 ${idx + 1} 连接`}
                      disabled={isReadOnly}
                      onChange={(e) => {
                        handleUpdateSelector(idx, {
                          ...row,
                          connection: e.target.value,
                          schema: "",
                          names: []
                        });
                      }}
                    >
                      <option value="">选择连接</option>
                      {availableConnectionIds.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
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
                        className="pl-input notranslate text-xs"
                        translate="no"
                        placeholder="手动输入 Schema"
                        value={row.schema}
                        aria-label={`表范围 ${idx + 1} Schema`}
                        disabled={isReadOnly}
                        onChange={(e) => {
                          handleUpdateSelector(idx, {
                            ...row,
                            schema: e.target.value,
                            names: []
                          });
                        }}
                      />
                    ) : (
                      <select
                        className="pl-input notranslate text-xs"
                        translate="no"
                        value={row.schema}
                        aria-label={`表范围 ${idx + 1} Schema`}
                        disabled={isReadOnly || !row.connection}
                        onChange={(e) => {
                          handleUpdateSelector(idx, {
                            ...row,
                            schema: e.target.value,
                            names: []
                          });
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

                <div className="grid gap-2 border-t border-border-subtle pt-2">
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-xs font-medium text-fg-muted">规则匹配方式：</span>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name={`role-rule-kind-${idx}`}
                        checked={row.kind === "names"}
                        onChange={() => {
                          handleUpdateSelector(idx, { ...row, kind: "names" });
                        }}
                        disabled={isReadOnly}
                      />
                      指定表名 (names)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name={`role-rule-kind-${idx}`}
                        checked={row.kind === "prefix"}
                        onChange={() => {
                          handleUpdateSelector(idx, { ...row, kind: "prefix" });
                        }}
                        disabled={isReadOnly}
                      />
                      按前缀匹配 (prefix)
                    </label>
                  </div>

                  {row.kind === "names" ? (
                    <div className="grid gap-2 mt-1">
                      {tablesFallback ? (
                        <p className="text-xs text-warning-strong" data-testid={`role-table-names-fallback-${idx + 1}`}>
                          表候选暂不可用，可手动填写表名。
                        </p>
                      ) : null}
                      {!tablesFallback && allSchemaTables.length > 0 ? (
                        <CheckboxCandidatePicker
                          items={allSchemaTables.map((tableName) => ({
                            id: tableName,
                            label: (
                              <span className="notranslate font-mono" translate="no">
                                {tableName}
                              </span>
                            )
                          }))}
                          value={row.names}
                          onChange={(names) => {
                            handleUpdateSelector(idx, { ...row, names });
                          }}
                          ariaLabel={`表范围 ${idx + 1} 指定表名`}
                          testIdPrefix={`role-table-names-${idx + 1}`}
                          disabled={isReadOnly}
                          filterPlaceholder="筛选表名…"
                          listClassName="grid max-h-56 gap-1 overflow-auto rounded-md border border-border-subtle p-2"
                          itemClassName="flex items-center gap-2 text-xs"
                        />
                      ) : null}
                      <TagInput
                        value={row.names}
                        onChange={(names) => {
                          handleUpdateSelector(idx, { ...row, names });
                        }}
                        placeholder="输入表名后回车"
                      />
                    </div>
                  ) : (
                    <div className="grid gap-1 mt-1">
                      <label className="grid gap-1">
                        <span className="text-xs text-fg-muted">表名前缀</span>
                        <div className="flex items-center gap-2">
                          <input
                            className="pl-input notranslate text-xs flex-1"
                            translate="no"
                            placeholder="例如 ods_"
                            value={row.prefix}
                            aria-label={`表范围 ${idx + 1} 按前缀匹配`}
                            onChange={(e) => {
                              handleUpdateSelector(idx, { ...row, prefix: e.target.value });
                            }}
                            disabled={isReadOnly}
                          />
                          {row.prefix.trim() && allSchemaTables.length > 0 ? (
                            <span className="text-xs text-accent whitespace-nowrap">
                              已匹配 {matchedPrefixCount} 张表
                            </span>
                          ) : null}
                        </div>
                        <span className="text-xs text-fg-muted">
                          授权所有以此前缀开头的表，例如 <code className="notranslate" translate="no">ods_</code>
                        </span>
                      </label>
                    </div>
                  )}
                </div>

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
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name={`role-row-access-${idx}`}
                        checked={row.rowAccess === "all"}
                        disabled={isReadOnly}
                        onChange={() => {
                          handleUpdateSelector(idx, { ...row, rowAccess: "all", predicates: [] });
                        }}
                      />
                      全部行
                      <span className="font-mono text-fg-muted notranslate" translate="no">
                        all
                      </span>
                    </label>
                    <label className="flex items-center gap-1 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name={`role-row-access-${idx}`}
                        checked={row.rowAccess === "scoped"}
                        disabled={isReadOnly}
                        onChange={() => {
                          handleUpdateSelector(idx, {
                            ...row,
                            rowAccess: "scoped",
                            predicates: row.predicates.length > 0 ? row.predicates : [{ ...EMPTY_PREDICATE }]
                          });
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
                        ；同组内为 AND 逻辑）。
                      </p>
                      {row.predicates.map((pred, predIdx) => (
                        <div
                          key={predIdx}
                          className="grid gap-2 rounded border border-border-subtle bg-bg-base p-2"
                          data-testid={`role-row-predicate-${idx + 1}-${predIdx + 1}`}
                        >
                          <div className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_1fr_auto] items-end gap-2">
                            <label className="grid gap-1">
                              <span className="text-xs text-fg-muted">字段</span>
                              <input
                                className="pl-input notranslate text-xs"
                                translate="no"
                                value={pred.field}
                                placeholder="例如 region"
                                aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} 字段`}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const predicates = [...row.predicates];
                                  predicates[predIdx] = { ...pred, field: e.target.value };
                                  handleUpdateSelector(idx, { ...row, predicates });
                                }}
                              />
                            </label>
                            <label className="grid gap-1">
                              <span className="text-xs text-fg-muted">操作符</span>
                              <select
                                className="pl-input notranslate text-xs"
                                translate="no"
                                value={pred.op}
                                aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} 操作符`}
                                disabled={isReadOnly}
                                onChange={(e) => {
                                  const op = e.target.value as "eq" | "in";
                                  const predicates = [...row.predicates];
                                  predicates[predIdx] = {
                                    ...pred,
                                    op,
                                    value: op === "eq" ? pred.value : "",
                                    values: op === "in" ? pred.values : []
                                  };
                                  handleUpdateSelector(idx, { ...row, predicates });
                                }}
                              >
                                <option value="eq">eq (等于)</option>
                                <option value="in">in (包含在列表)</option>
                              </select>
                            </label>
                            {pred.op === "eq" ? (
                              <label className="grid gap-1">
                                <span className="text-xs text-fg-muted">取值</span>
                                <input
                                  className="pl-input notranslate text-xs"
                                  translate="no"
                                  value={pred.value}
                                  placeholder="例如 East"
                                  aria-label={`表范围 ${idx + 1} 条件 ${predIdx + 1} 取值`}
                                  disabled={isReadOnly}
                                  onChange={(e) => {
                                    const predicates = [...row.predicates];
                                    predicates[predIdx] = { ...pred, value: e.target.value };
                                    handleUpdateSelector(idx, { ...row, predicates });
                                  }}
                                />
                              </label>
                            ) : (
                              <div className="grid gap-1">
                                <span className="text-xs text-fg-muted">取值列表</span>
                                <TagInput
                                  value={pred.values}
                                  onChange={(values) => {
                                    const predicates = [...row.predicates];
                                    predicates[predIdx] = { ...pred, values };
                                    handleUpdateSelector(idx, { ...row, predicates });
                                  }}
                                  placeholder="输入取值后回车"
                                />
                              </div>
                            )}
                            <button
                              type="button"
                              className="pl-btn pl-btn--ghost text-xs"
                              aria-label={`删除表范围 ${idx + 1} 条件 ${predIdx + 1}`}
                              disabled={isReadOnly || row.predicates.length <= 1}
                              onClick={() => {
                                const predicates = row.predicates.filter((_, i) => i !== predIdx);
                                handleUpdateSelector(idx, { ...row, predicates });
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
                        disabled={isReadOnly}
                        onClick={() => {
                          handleUpdateSelector(idx, {
                            ...row,
                            predicates: [...row.predicates, { ...EMPTY_PREDICATE }]
                          });
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
  );
}
