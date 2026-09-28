import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckSquare, Square, Table2, AlertCircle } from "lucide-react";
import { apiGet, apiPut, ApiError } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { SourcesResponse, SourceSummary } from "../../lib/types";

export type Step3SelectTablesProps = {
  connectionId: string;
  schema: string;
  initialTables?: string[];
  onSuccess: (enabledTables: string[]) => void;
  onBack: () => void;
};

export function Step3SelectTables({
  connectionId,
  schema,
  initialTables,
  onSuccess,
  onBack
}: Step3SelectTablesProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTables || []));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notScanned, setNotScanned] = useState(false);
  const [query, setQuery] = useState("");

  const { data: sourcesData, isLoading } = useQuery({
    queryKey: queryKeys.sources,
    queryFn: () => apiGet<SourcesResponse>("/api/sources")
  });

  const availableTables: SourceSummary[] = useMemo(
    () =>
      (sourcesData?.tables || []).filter(
        (s) => s.conn === connectionId && (!schema || s.schema === schema)
      ),
    [connectionId, schema, sourcesData?.tables]
  );
  const availableKey = availableTables.map(
    (table) => table.qualifiedName || `${table.schema}.${table.table}`
  ).join("|");

  useEffect(() => {
    if (isLoading || availableTables.length === 0) return;
    const availableNames = new Set(
      availableTables.map((table) => table.qualifiedName || `${table.schema}.${table.table}`)
    );
    const persisted = (initialTables ?? []).filter((table) => availableNames.has(table));
    setSelected(new Set(persisted));
  }, [availableKey, connectionId, schema, isLoading]);

  const toggleTable = (qualName: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(qualName)) {
        next.delete(qualName);
      } else {
        next.add(qualName);
      }
      return next;
    });
  };

  const selectAll = () => {
    setSelected(new Set(availableTables.map((t) => t.qualifiedName || `${t.schema}.${t.table}`)));
  };

  const selectNone = () => {
    setSelected(new Set());
  };

  const visibleTables = availableTables.filter((table) => {
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    const qualName = table.qualifiedName || `${table.schema}.${table.table}`;
    return qualName.toLowerCase().includes(needle) || table.table.toLowerCase().includes(needle);
  });

  const saveMutation = useMutation({
    mutationFn: (tables: string[]) =>
      apiPut(`/api/connections/${encodeURIComponent(connectionId)}/enabled-tables`, {
        enabledTables: tables,
        dryRun: false
      }),
    onSuccess: (_data, tables) => {
      onSuccess(tables);
    },
    onError: (err) => {
      setNotScanned(err instanceof ApiError && err.code === "TABLE_NOT_SCANNED");
      setSaveError(err instanceof Error ? err.message : String(err));
    }
  });

  return (
    <div className="space-y-6" data-testid="setup-step-3">
      <div className="bg-bg-subtle p-5 rounded-lg border border-border-default space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-fg-muted">
            已发现数据表：
            <span className="font-semibold text-fg-default ml-1">{availableTables.length} 张</span>
            <span className="mx-2">·</span>
            当前选中：
            <span className="font-semibold text-primary ml-1">{selected.size} 张</span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs py-1 px-2"
              onClick={selectAll}
              disabled={availableTables.length === 0}
              data-testid="setup-select-all"
            >
              全选
            </button>
            <button
              type="button"
              className="pl-btn pl-btn--ghost text-xs py-1 px-2"
              onClick={selectNone}
              disabled={availableTables.length === 0}
              data-testid="setup-select-none"
            >
              清空
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-8 text-center text-xs text-fg-muted">
            正在读取数据表列表...
          </div>
        ) : availableTables.length === 0 ? (
          <div className="py-8 text-center bg-bg-surface rounded border border-border-default space-y-2">
            <Table2 className="w-8 h-8 text-fg-muted mx-auto" />
            <p className="text-xs text-fg-default font-medium">暂未发现数据表</p>
            <p className="text-xs text-fg-muted max-w-sm mx-auto notranslate" translate="no">
              当前 Schema 没有可选择的数据表。请返回上一步重新同步。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <input
              className="pl-input w-full text-xs"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索数据表"
              aria-label="搜索数据表"
              data-testid="setup-table-search"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto p-1">
            {visibleTables.map((tbl) => {
              const qualName = tbl.qualifiedName || `${tbl.schema}.${tbl.table}`;
              const isChecked = selected.has(qualName);
              return (
                <button
                  type="button"
                  key={qualName}
                  className={`p-3 rounded border cursor-pointer flex items-start gap-3 text-left transition-colors ${
                    isChecked
                      ? "bg-primary/5 border-primary/40 text-fg-default"
                      : "bg-bg-surface border-border-default text-fg-muted hover:border-border-hover"
                  }`}
                  onClick={() => toggleTable(qualName)}
                  aria-pressed={isChecked}
                  data-setup-dirty
                  data-testid={`setup-table-item-${qualName}`}
                >
                  <span className="mt-0.5 text-primary" aria-hidden="true">
                    {isChecked ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4 text-fg-muted" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-fg-default truncate notranslate" translate="no">
                      {tbl.table}
                    </div>
                    <div className="text-[11px] text-fg-muted truncate notranslate" translate="no">
                      {qualName} · {tbl.columnCount} 个字段
                    </div>
                  </div>
                </button>
              );
            })}
            </div>
          </div>
        )}
      </div>

      {saveError ? (
        <div className="p-3 bg-danger/10 border border-danger/30 rounded text-xs text-danger flex items-start gap-2" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{saveError}</span>
        </div>
      ) : null}

      {notScanned ? (
        <div className="flex justify-end">
          <button type="button" className="pl-btn pl-btn--outline text-xs" onClick={onBack} data-testid="setup-step3-resync">
            返回上一步重新同步
          </button>
        </div>
      ) : null}

      {!isLoading && (availableTables.length === 0 || selected.size === 0) ? (
        <p className="pl-notice text-xs notranslate" translate="no" id="setup-step3-disabled-reason" role="status">
          {availableTables.length === 0
            ? "当前 Schema 没有可选择的数据表。请返回上一步重新同步。"
            : "请至少选择 1 张数据表后再继续。"}
        </p>
      ) : null}

      <div className="flex items-center justify-between p-4 bg-bg-surface rounded-lg border border-border-default">
        <button
          type="button"
          className="pl-btn pl-btn--ghost text-xs"
          onClick={onBack}
        >
          ← 上一步
        </button>

        <button
          type="button"
          className="pl-btn pl-btn--primary"
          disabled={isLoading || availableTables.length === 0 || selected.size === 0 || saveMutation.isPending}
          aria-describedby={
            !isLoading && (availableTables.length === 0 || selected.size === 0)
              ? "setup-step3-disabled-reason"
              : undefined
          }
          onClick={() => saveMutation.mutate(Array.from(selected))}
          data-testid="setup-step3-next"
        >
          {saveMutation.isPending ? "正在保存..." : "确认并继续 →"}
        </button>
      </div>
    </div>
  );
}
