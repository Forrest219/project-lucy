import { useMemo, useState } from "react";
import type { RolePermissionDraft, TableGrant } from "../lib/rolePermissionDraft";
import { permissionTableKey } from "../lib/rolePermissionDraft";

export interface ConnectionSchema {
  id: string;
  schemas: string[];
}

export interface RoleTableGrantsProps {
  value: RolePermissionDraft["scope"];
  connections: ConnectionSchema[];
  candidateTablesByKey: Record<string, string[]>;
  candidatesLoaded: boolean;
  onChange: (next: RolePermissionDraft["scope"]) => void;
  disabled?: boolean;
}

function hasTable(tables: TableGrant[], connection: string, schema: string, name: string): boolean {
  return tables.some((table) => table.connection === connection && table.schema === schema && table.name === name);
}

export function RoleTableGrants({
  value,
  connections,
  candidateTablesByKey,
  candidatesLoaded,
  onChange,
  disabled = false,
}: RoleTableGrantsProps) {
  const [search, setSearch] = useState("");
  const [confirmMode, setConfirmMode] = useState<"enable" | "disable" | null>(null);
  const tables = value.mode === "names" ? value.tables : [];
  const selectedKeys = useMemo(() => new Set(tables.map(permissionTableKey)), [tables]);

  function replaceTables(nextTables: TableGrant[]) {
    onChange({ mode: "names", tables: nextTables });
  }

  function toggleTable(connection: string, schema: string, name: string, checked: boolean) {
    if (disabled || value.mode !== "names") return;
    if (checked) {
      if (!hasTable(tables, connection, schema, name)) {
        replaceTables([...tables, { connection, schema, name }]);
      }
      return;
    }
    replaceTables(tables.filter((table) => permissionTableKey(table) !== `${connection}/${schema}/${name}`));
  }

  function setSchema(connection: string, schema: string, names: string[], selected: boolean) {
    if (disabled || value.mode !== "names") return;
    const schemaKeys = new Set(names.map((name) => `${connection}/${schema}/${name}`));
    const kept = tables.filter((table) => !schemaKeys.has(permissionTableKey(table)));
    replaceTables(selected ? [...kept, ...names.map((name) => ({ connection, schema, name }))] : kept);
  }

  function confirmScopeChange() {
    if (confirmMode === "enable") onChange({ mode: "catalog_bound", connections: [] });
    if (confirmMode === "disable") onChange({ mode: "names", tables: [] });
    setConfirmMode(null);
  }

  function toggleCatalogConnection(connection: string, checked: boolean) {
    if (disabled || value.mode !== "catalog_bound") return;
    const next = checked
      ? value.connections.includes(connection) ? value.connections : [...value.connections, connection]
      : value.connections.filter((item) => item !== connection);
    onChange({ mode: "catalog_bound", connections: next });
  }

  const normalizedSearch = search.trim().toLowerCase();

  return (
    <div data-testid="role-table-grants" className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">已选 {tables.length} 张表</p>
          <p className="text-xs text-fg-muted">连接会根据明确选择的表自动推导。</p>
        </div>
        {value.mode === "names" ? (
          <input
            aria-label="搜索可访问的表"
            className="pl-input notranslate max-w-xs"
            translate="no"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索连接、Schema 或表名"
            disabled={disabled}
          />
        ) : null}
      </div>

      {value.mode === "catalog_bound" ? (
        <div className="grid gap-3" data-testid="table-grants-manual-connections">
          <div className="rounded-md border border-warning-strong bg-warning-soft p-3 text-sm text-warning-strong">
            已声明连接上，后续新启用的表自动进入，并走扩权审计。必须显式选择至少一个连接。
          </div>
          {connections.map((connection) => (
            <label key={connection.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.connections.includes(connection.id)}
                onChange={(event) => toggleCatalogConnection(connection.id, event.target.checked)}
                disabled={disabled}
                aria-label={`允许的连接 ${connection.id}`}
              />
              <span className="notranslate font-mono" translate="no">{connection.id}</span>
            </label>
          ))}
        </div>
      ) : (
        <div data-testid="table-grants-tree" className="grid gap-3">
          {connections.map((connection) => {
            const matchingSchemas = connection.schemas.filter((schema) => {
              if (!normalizedSearch) return true;
              const candidates = candidateTablesByKey[`${connection.id}\0${schema}`] ?? [];
              return connection.id.toLowerCase().includes(normalizedSearch)
                || schema.toLowerCase().includes(normalizedSearch)
                || candidates.some((table) => table.toLowerCase().includes(normalizedSearch));
            });
            if (matchingSchemas.length === 0) return null;
            return (
              <section key={connection.id} className="rounded-lg border border-border-default p-3">
                <h3 className="notranslate text-sm font-semibold" translate="no">{connection.id}</h3>
                <div className="mt-3 grid gap-3">
                  {matchingSchemas.map((schema) => {
                    const allCandidates = candidateTablesByKey[`${connection.id}\0${schema}`] ?? [];
                    const candidates = normalizedSearch
                      ? allCandidates.filter((table) =>
                          connection.id.toLowerCase().includes(normalizedSearch)
                          || schema.toLowerCase().includes(normalizedSearch)
                          || table.toLowerCase().includes(normalizedSearch))
                      : allCandidates;
                    const allSelected = allCandidates.length > 0
                      && allCandidates.every((name) => selectedKeys.has(`${connection.id}/${schema}/${name}`));
                    return (
                      <div key={schema} className="rounded-md bg-bg-subtle p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="notranslate text-xs font-medium" translate="no">{schema}</span>
                          <div className="flex gap-2">
                            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setSchema(connection.id, schema, allCandidates, true)} disabled={disabled || allSelected || allCandidates.length === 0}>全选</button>
                            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setSchema(connection.id, schema, allCandidates, false)} disabled={disabled || !allCandidates.some((name) => selectedKeys.has(`${connection.id}/${schema}/${name}`))}>清除</button>
                          </div>
                        </div>
                        <div className="mt-2 grid gap-1 sm:grid-cols-2">
                          {candidates.map((name) => (
                            <label key={name} className="flex items-center gap-2 text-sm">
                              <input type="checkbox" aria-label={name} checked={selectedKeys.has(`${connection.id}/${schema}/${name}`)} onChange={(event) => toggleTable(connection.id, schema, name, event.target.checked)} disabled={disabled} />
                              <span className="notranslate" translate="no">{name}</span>
                            </label>
                          ))}
                          {candidates.length === 0 ? <p className="text-xs text-fg-muted">{candidatesLoaded ? "没有匹配的表" : "候选表加载中…"}</p> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {value.mode === "names" && tables.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">查看已选表</summary>
          <ul className="mt-2 grid gap-1 text-xs text-fg-muted">
            {tables.map((table) => (
              <li key={permissionTableKey(table)} className="notranslate" translate="no">
                {permissionTableKey(table)}{table.predicates?.length ? ` · ${table.predicates.length} 条行级策略条件` : ""}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <details data-testid="table-grants-advanced">
        <summary className="cursor-pointer text-sm font-medium">高级设置</summary>
        <div className="mt-2 rounded-md border border-border-default p-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" aria-label="启用目录绑定" checked={value.mode === "catalog_bound"} onChange={(event) => setConfirmMode(event.target.checked ? "enable" : "disable")} disabled={disabled} />
            <span>
              启用目录绑定
              <span className="mt-1 block text-xs text-fg-muted">这是高权限范围。切换模式会清空当前明确表与行级策略，不会保留隐藏授权。</span>
            </span>
          </label>
        </div>
      </details>

      {confirmMode ? (
        <div className="rounded-md border border-warning-strong bg-warning-soft p-3" role="alertdialog" aria-label="确认切换表范围模式">
          <p className="text-sm font-medium text-warning-strong">{confirmMode === "enable" ? "确认启用目录绑定？" : "确认关闭目录绑定？"}</p>
          <p className="mt-1 text-xs text-warning-strong">切换后将从空范围开始，当前明确表和行级策略不会保留。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={() => setConfirmMode(null)}>取消</button>
            <button type="button" className="pl-btn pl-btn--primary text-xs" onClick={confirmScopeChange}>确认切换</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
