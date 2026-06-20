import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiGet, apiPost } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionsResponse } from "../../lib/types";

type TestResult = {
  status: "ok" | "error";
  latencyMs?: number;
  detail?: string;
  reason?: string;
};

export function ConnectionTest() {
  const [selectedConnId, setSelectedConnId] = useState<string>("");
  const [result, setResult] = useState<TestResult | null>(null);

  const { data: connData, isLoading: connLoading } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections")
  });

  const connections = connData?.connections ?? [];
  const activeConnId = selectedConnId || connections[0]?.id || "";

  const testMutation = useMutation({
    mutationFn: () => apiPost<TestResult>(`/api/connections/${encodeURIComponent(activeConnId)}/test`, {}),
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (err) => {
      setResult({ status: "error", reason: err instanceof Error ? err.message : "未知错误" });
    }
  });

  if (connLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  return (
    <section className="pl-panel">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">数据库接入</p>
          <h1 className="text-xl font-semibold">连通测试</h1>
        </div>
      </div>
      <p className="pl-page-intro">测试数据库连通性，验证凭证与网络配置是否正确。</p>

      <div className="flex items-end gap-3 mt-4">
        {connections.length > 0 ? (
          <label className="grid gap-1.5 text-sm">
            <span>选择连接</span>
            <select
              className="pl-input"
              value={activeConnId}
              onChange={(e) => {
                setSelectedConnId(e.target.value);
                setResult(null);
              }}
              aria-label="选择连接"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.id}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-sm text-fg-muted">暂无连接配置。</p>
        )}

        {connections.length > 0 && (
          <button
            className="pl-btn"
            onClick={() => {
              setResult(null);
              testMutation.mutate();
            }}
            disabled={testMutation.isPending || !activeConnId}
          >
            {testMutation.isPending ? "测试中..." : "测试连接"}
          </button>
        )}
      </div>

      {result && (
        <div className={`mt-6 p-4 rounded border ${result.status === "ok" ? "border-green-500 bg-green-50" : "border-red-400 bg-red-50"}`}>
          {result.status === "ok" ? (
            <div>
              <p className="font-semibold text-green-700">连接成功</p>
              {result.latencyMs !== undefined && (
                <p className="text-sm text-green-600 mt-1">延迟：{result.latencyMs} ms</p>
              )}
              {result.detail && (
                <pre className="text-xs mt-2 whitespace-pre-wrap text-green-700">{result.detail}</pre>
              )}
            </div>
          ) : (
            <div>
              <p className="font-semibold text-red-700">连接失败</p>
              {result.reason && (
                <pre className="text-xs mt-2 whitespace-pre-wrap text-red-600">{result.reason}</pre>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
