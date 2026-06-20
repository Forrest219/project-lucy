import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionsResponse, ConnectionTablesResponse } from "../../lib/types";

type IngestResult = { exitCode: number; stdout: string; stderr: string };

export function TableWhitelist() {
  const queryClient = useQueryClient();
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [pendingEnabled, setPendingEnabled] = useState<string[] | null>(null);
  const [ingestLog, setIngestLog] = useState<string | null>(null);

  const { data: connData, isLoading: connLoading } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections")
  });

  const connections = connData?.connections ?? [];
  const activeConnId = selectedConnId || connections[0]?.id || "";
  const activeConn = connections.find((c) => c.id === activeConnId);

  const { data: tablesData, isLoading: tablesLoading } = useQuery({
    queryKey: queryKeys.connectionTables(activeConnId),
    queryFn: () => apiGet<ConnectionTablesResponse>(`/api/connections/${encodeURIComponent(activeConnId)}/tables`),
    enabled: !!activeConnId
  });

  const allTables = tablesData?.tables ?? [];
  const currentEnabled: string[] = pendingEnabled ?? activeConn?.enabledTables ?? [];

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<void>(`/api/connections/${encodeURIComponent(activeConnId)}/enabled-tables`, { enabledTables: currentEnabled }),
    onSuccess: () => {
      toast.success("表白名单已保存");
      setPendingEnabled(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.connections });
    },
    onError: (err) => {
      toast.error(`保存失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  const ingestMutation = useMutation({
    mutationFn: () =>
      apiPost<IngestResult>(`/api/connections/${encodeURIComponent(activeConnId)}/ingest`, {}),
    onSuccess: (result) => {
      const log = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      setIngestLog(log || `退出码 ${result.exitCode}`);
      if (result.exitCode === 0) {
        toast.success("扫描完成");
        void queryClient.invalidateQueries({ queryKey: queryKeys.connectionTables(activeConnId) });
      } else {
        toast.error(`扫描失败（退出码 ${result.exitCode}）`);
      }
    },
    onError: (err) => {
      toast.error(`扫描失败：${err instanceof Error ? err.message : "未知错误"}`);
    }
  });

  function toggleTable(table: string) {
    const next = currentEnabled.includes(table)
      ? currentEnabled.filter((t) => t !== table)
      : [...currentEnabled, table];
    setPendingEnabled(next);
  }

  const isDirty = pendingEnabled !== null;

  if (connLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  return (
    <section className="pl-panel">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">数据库接入</p>
          <h1 className="text-xl font-semibold">表白名单</h1>
        </div>
        <div className="flex items-center gap-3">
          {connections.length > 1 && (
            <select
              className="pl-input"
              value={activeConnId}
              onChange={(e) => {
                setSelectedConnId(e.target.value);
                setPendingEnabled(null);
                setIngestLog(null);
              }}
              aria-label="选择连接"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.id}</option>
              ))}
            </select>
          )}
          <button
            className="pl-btn pl-btn--ghost"
            onClick={() => ingestMutation.mutate()}
            disabled={ingestMutation.isPending || !activeConnId}
          >
            {ingestMutation.isPending ? "扫描中..." : "触发扫描"}
          </button>
          <button
            className="pl-btn"
            onClick={() => saveMutation.mutate()}
            disabled={!isDirty || saveMutation.isPending}
          >
            {saveMutation.isPending ? "保存中..." : "保存白名单"}
          </button>
        </div>
      </div>
      <p className="pl-page-intro">
        勾选需要纳入语义层的表，保存后写入 <code>ktx.yaml</code> 的 <code>enabled_tables</code> 字段。
        点击「触发扫描」可将新表 schema 同步到语义层。
      </p>

      {!activeConnId && (
        <p className="text-sm text-fg-muted">暂无连接配置。</p>
      )}

      {activeConnId && (
        <div className="grid gap-2 mt-4">
          {tablesLoading && <p className="pl-notice">正在加载可选表...</p>}
          {!tablesLoading && allTables.length === 0 && (
            <p className="text-sm text-fg-muted">
              未在 <code>semantic-layer/{activeConnId}/_schema/</code> 中发现任何表。请先触发扫描。
            </p>
          )}
          {allTables.map((table) => {
            const checked = currentEnabled.includes(table);
            return (
              <label key={table} className="flex items-center gap-3 cursor-pointer text-sm py-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleTable(table)}
                  className="h-4 w-4"
                />
                <span className={checked ? "font-medium" : "text-fg-muted"}>{table}</span>
              </label>
            );
          })}
        </div>
      )}

      {ingestLog !== null && (
        <div className="mt-6">
          <p className="text-sm font-medium mb-2">扫描日志</p>
          <pre className="text-xs bg-surface-muted p-3 rounded overflow-auto max-h-64 whitespace-pre-wrap">
            {ingestLog || "（无输出）"}
          </pre>
        </div>
      )}
    </section>
  );
}
