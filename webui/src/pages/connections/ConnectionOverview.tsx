import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { queryKeys } from "../../lib/queryKeys";
import type { ConnectionsResponse } from "../../lib/types";

export function ConnectionOverview() {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.connections,
    queryFn: () => apiGet<ConnectionsResponse>("/api/connections")
  });

  const connections = data?.connections ?? [];

  if (isLoading) {
    return <p className="pl-notice">正在加载连接列表...</p>;
  }

  if (error) {
    return <p className="pl-error">连接列表加载失败：{error instanceof Error ? error.message : "未知错误"}</p>;
  }

  return (
    <section className="pl-panel">
      <div className="pl-section-heading">
        <div>
          <p className="pl-eyebrow">数据库接入</p>
          <h1 className="text-xl font-semibold">连接概览</h1>
        </div>
        <p className="text-sm text-fg-muted">{connections.length} 个连接</p>
      </div>
      <p className="pl-page-intro">查看当前 KTX 项目中配置的所有数据库连接及其状态。如需新建连接，请使用 <code>ktx setup</code> 命令行向导。</p>

      <div className="pl-table-list">
        {connections.length === 0 && (
          <p className="text-sm text-fg-muted py-4">暂无连接配置，请在 ktx.yaml 中添加 connections。</p>
        )}
        {connections.map((conn) => (
          <div className="pl-table-row" key={conn.id}>
            <div>
              <strong>{conn.id}</strong>
              <span>{conn.driver ?? "未知 driver"}</span>
            </div>
            <span className="text-sm text-fg-muted">
              schemas: {conn.schemas.length > 0 ? conn.schemas.join(", ") : "—"}
            </span>
            <span className="text-sm text-fg-muted">
              已启用 {conn.enabledTables.length} 张表
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
