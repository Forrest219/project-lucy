import { useMemo, useState } from "react";
import { expansionNotice, permissionTableKey, type RolePermissionDraft, type TableGrant } from "../lib/rolePermissionDraft";

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
  /** lucy_admin covers every connection, including ones added later. */
  grantAllConnections?: boolean;
}

function hasTable(tables: TableGrant[], connection: string, schema: string, name: string): boolean {
  return tables.some((table) => table.connection === connection && table.schema === schema && table.name === name);
}

function enabledTableCountForConnection(
  connection: ConnectionSchema,
  candidateTablesByKey: Record<string, string[]>
): number {
  let total = 0;
  for (const schema of connection.schemas) {
    total += candidateTablesByKey[`${connection.id}\0${schema}`]?.length ?? 0;
  }
  return total;
}

export function RoleTableGrants({
  value,
  connections,
  candidateTablesByKey,
  candidatesLoaded,
  onChange,
  disabled = false,
  grantAllConnections = false,
}: RoleTableGrantsProps) {
  const [search, setSearch] = useState("");
  const [confirmMode, setConfirmMode] = useState<"enable" | "disable" | null>(null);
  const [pendingSeedConnection, setPendingSeedConnection] = useState<string | null>(null);
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
    const kept = tables.filter((table) => !(table.connection === connection && table.schema === schema));
    replaceTables(selected ? [...kept, ...names.map((name) => ({ connection, schema, name }))] : kept);
  }

  function removeTable(connection: string, schema: string, name: string) {
    toggleTable(connection, schema, name, false);
  }

  function removeStaleTables() {
    if (disabled || value.mode !== "names") return;
    replaceTables(tables.filter((table) => !staleKeys.has(permissionTableKey(table))));
  }

  const liveKeys = useMemo(() => {
    const next = new Set<string>();
    if (!candidatesLoaded) return next;
    for (const connection of connections) {
      for (const schema of connection.schemas) {
        for (const name of candidateTablesByKey[`${connection.id}\0${schema}`] ?? []) {
          next.add(`${connection.id}/${schema}/${name}`);
        }
      }
    }
    return next;
  }, [candidateTablesByKey, candidatesLoaded, connections]);

  const staleTables = useMemo(() => {
    if (value.mode !== "names" || !candidatesLoaded) return [];
    return tables.filter((table) => !liveKeys.has(permissionTableKey(table)));
  }, [candidatesLoaded, liveKeys, tables, value.mode]);
  const staleKeys = useMemo(
    () => new Set(staleTables.map((table) => permissionTableKey(table))),
    [staleTables]
  );

  function clearConfirm() {
    setConfirmMode(null);
    setPendingSeedConnection(null);
  }

  function confirmScopeChange() {
    if (confirmMode === "enable") {
      onChange({
        mode: "catalog_bound",
        connections: grantAllConnections ? ["*"] : pendingSeedConnection ? [pendingSeedConnection] : [],
      });
    }
    if (confirmMode === "disable") {
      onChange({ mode: "names", tables: [] });
    }
    clearConfirm();
  }

  function requestFollowToggle(connectionId: string, wantOn: boolean) {
    if (disabled || grantAllConnections) return;

    if (value.mode === "names") {
      if (!wantOn) return;
      setPendingSeedConnection(connectionId);
      setConfirmMode("enable");
      return;
    }

    if (wantOn) {
      const next = value.connections.includes(connectionId)
        ? value.connections
        : [...value.connections, connectionId];
      onChange({ mode: "catalog_bound", connections: next });
      return;
    }

    const next = value.connections.filter((item) => item !== connectionId);
    if (next.length === 0) {
      setConfirmMode("disable");
      return;
    }
    onChange({ mode: "catalog_bound", connections: next });
  }

  function isFollowChecked(connectionId: string): boolean {
    if (grantAllConnections && value.mode === "catalog_bound") return true;
    if (value.mode !== "catalog_bound") return false;
    return value.connections.includes(connectionId);
  }

  const normalizedSearch = search.trim().toLowerCase();

  function connectionMatchesSearch(connection: ConnectionSchema): boolean {
    if (!normalizedSearch) return true;
    if (connection.id.toLowerCase().includes(normalizedSearch)) return true;
    return connection.schemas.some((schema) => {
      const candidates = candidateTablesByKey[`${connection.id}\0${schema}`] ?? [];
      return schema.toLowerCase().includes(normalizedSearch)
        || candidates.some((table) => table.toLowerCase().includes(normalizedSearch));
    });
  }

  const visibleConnections = value.mode === "catalog_bound"
    ? connections
    : connections.filter(connectionMatchesSearch);

  return (
    <div data-testid="role-table-grants" className="grid gap-4">
      {value.mode === "names" ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-medium">已选 {tables.length} 张表</p>
          <input
            aria-label="搜索可访问的表"
            className="pl-input notranslate max-w-xs"
            translate="no"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索连接、Schema 或表名"
            disabled={disabled}
          />
        </div>
      ) : (
        <p className="text-sm text-fg-muted" data-testid="catalog-bound-scope-note">
          {grantAllConnections
            ? "跟随全部已配置连接（含日后新增）。全部连接上的已启用表都会进入。"
            : <>已允许 {value.connections.length} 个连接。{expansionNotice("catalog_bound")}。{value.connections.length === 0 ? "必须显式选择至少一个连接。" : null}</>}
        </p>
      )}

      <div
        className="grid gap-3"
        data-testid={value.mode === "catalog_bound" ? "table-grants-manual-connections" : "table-grants-tree"}
      >
        {visibleConnections.map((connection) => {
          const followChecked = isFollowChecked(connection.id);
          const enabledCount = candidatesLoaded
            ? enabledTableCountForConnection(connection, candidateTablesByKey)
            : null;
          const matchingSchemas = connection.schemas.filter((schema) => {
            if (!normalizedSearch || value.mode === "catalog_bound") return true;
            const candidates = candidateTablesByKey[`${connection.id}\0${schema}`] ?? [];
            return connection.id.toLowerCase().includes(normalizedSearch)
              || schema.toLowerCase().includes(normalizedSearch)
              || candidates.some((table) => table.toLowerCase().includes(normalizedSearch));
          });

          return (
            <section
              key={connection.id}
              className="rounded-lg border border-border-default p-3"
              data-testid={`table-grants-connection-card-${connection.id}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h3 className="notranslate text-sm font-semibold" translate="no">{connection.id}</h3>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    data-testid={`table-grants-follow-enabled-${connection.id}`}
                    aria-label={`跟随此连接的启用表 ${connection.id}`}
                    checked={followChecked}
                    disabled={disabled || grantAllConnections}
                    onChange={(event) => requestFollowToggle(connection.id, event.target.checked)}
                  />
                  <span>跟随此连接的启用表</span>
                </label>
              </div>

              {value.mode === "catalog_bound" ? (
                <p className="mt-2 text-xs text-fg-muted">
                  {grantAllConnections || followChecked
                    ? (enabledCount === null
                      ? "将覆盖该连接当前启用表"
                      : `将覆盖该连接当前启用表（约 ${enabledCount} 张）`)
                    : "未纳入目录绑定"}
                </p>
              ) : (
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
              )}
            </section>
          );
        })}
      </div>

      {value.mode === "names" && staleTables.length > 0 ? (
        <section
          className="rounded-lg border border-warning-strong bg-warning-soft p-3"
          data-testid="stale-table-grants"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-warning-strong">
              失效授权 {staleTables.length} 条
            </p>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs"
              data-testid="stale-table-grants-clear"
              disabled={disabled}
              onClick={removeStaleTables}
            >
              清除全部失效授权
            </button>
          </div>
          <p className="mt-1 text-xs text-warning-strong notranslate" translate="no">
            这些路径已不在当前可授权候选中（连接已删除、Schema 已变更或表已停用），保存前请移除。行级策略会随该条授权一起删除。
          </p>
          <ul className="mt-2 grid gap-1">
            {staleTables.map((table) => {
              const key = permissionTableKey(table);
              return (
                <li key={key} className="flex items-center justify-between gap-2 text-xs">
                  <span className="notranslate" translate="no">
                    {key}
                    {table.predicates?.length ? ` · ${table.predicates.length} 条行级策略条件` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除失效授权 ${key}`}
                    className="pl-btn pl-btn--ghost text-xs"
                    disabled={disabled}
                    onClick={() => removeTable(table.connection, table.schema, table.name)}
                  >
                    移除
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {value.mode === "names" && tables.length > 0 ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium">查看已选表</summary>
          <ul className="mt-2 grid gap-1 text-xs text-fg-muted">
            {tables.map((table) => {
              const key = permissionTableKey(table);
              const stale = staleKeys.has(key);
              return (
                <li key={key} className="flex items-center justify-between gap-2">
                  <span className="notranslate" translate="no">
                    {key}
                    {stale ? " · 失效" : ""}
                    {table.predicates?.length ? ` · ${table.predicates.length} 条行级策略条件` : ""}
                  </span>
                  <button
                    type="button"
                    aria-label={`移除 ${key}`}
                    className="pl-btn pl-btn--ghost text-xs"
                    data-testid={`selected-table-remove-${key}`}
                    disabled={disabled}
                    onClick={() => removeTable(table.connection, table.schema, table.name)}
                  >
                    移除
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {confirmMode ? (
        <div
          className="rounded-md border border-warning-strong bg-warning-soft p-3"
          role="alertdialog"
          aria-label="确认切换表范围模式"
          data-testid="table-grants-scope-confirm"
        >
          <p className="text-sm font-medium text-warning-strong">
            {confirmMode === "enable" ? "确认切换为跟随启用表？" : "确认改回指定表？"}
          </p>
          <p className="mt-1 text-xs text-warning-strong">切换后将从空范围开始，当前明确表和行级策略不会保留。</p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" className="pl-btn pl-btn--ghost text-xs" onClick={clearConfirm}>取消</button>
            <button type="button" className="pl-btn pl-btn--primary text-xs" onClick={confirmScopeChange}>确认切换</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
