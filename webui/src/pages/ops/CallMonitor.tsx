import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";

export type CallMonitorRange = "24h" | "1h";

type CallMonitorResponse = {
  generatedAt: string;
  window: { range: CallMonitorRange; hours: number; since: string; slowMs: number };
  traffic: {
    businessCalls: number;
    okCalls: number;
    errorCalls: number;
    deniedCalls: number;
    successRate: number;
    errorRate: number;
    deniedRate: number;
  };
  latency: {
    p50Ms: number | null;
    p95Ms: number | null;
    slowCalls: number;
  };
  slo: {
    thresholds: {
      p95LatencyMs: number;
      maxErrorRate: number;
      maxDeniedRate: number;
    };
    status: "ok" | "warn" | "no_data";
    violations: Array<"latency_p95" | "error_rate" | "denied_rate">;
  };
  topTools: Array<{ tool: string; calls: number; errors: number; denied: number }>;
  recentFailures: Array<{
    id: number;
    ts: string;
    tool: string;
    outcome: "error" | "denied";
    durationMs: number;
    userId: string;
    decisionReason?: string;
    requestId: string;
    traceId?: string;
  }>;
};

function parseRange(searchParams: URLSearchParams): CallMonitorRange {
  const range = searchParams.get("range");
  if (range === "1h" || range === "24h") return range;
  const hours = searchParams.get("hours");
  return hours === "1" ? "1h" : "24h";
}

function windowLabel(range: CallMonitorRange): string {
  return range === "1h" ? "近 1 小时" : "近 24 小时";
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(rate >= 0.1 || rate === 0 ? 1 : 2)}%`;
}

function formatStatsTimeLabel(statsAt: Date | null, now: Date): string {
  if (!statsAt) return "未知";
  const diffMs = now.getTime() - statsAt.getTime();
  if (diffMs < 5_000) return "刚刚";
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)} 秒前`;
  if (diffMs < 15 * 60_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(statsAt.getHours())}:${pad(statsAt.getMinutes())}:${pad(statsAt.getSeconds())}`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

function formatLocalTs(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sloStatusLabel(status: CallMonitorResponse["slo"]["status"]): string {
  if (status === "warn") return "需关注";
  if (status === "no_data") return "暂无数据";
  return "正常";
}

export function buildAuditCallsHref(options: {
  range: CallMonitorRange;
  outcome?: "error" | "denied" | "ok";
  tool?: string;
  slowOnly?: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("view", "calls");
  params.set("range", options.range);
  if (options.outcome) params.set("outcome", options.outcome);
  if (options.tool) params.set("tool", options.tool);
  if (options.slowOnly) params.set("slowOnly", "1");
  return `/admin/audit?${params.toString()}`;
}

export function CallMonitor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRange(searchParams);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [now, setNow] = useState(() => new Date());

  const query = useQuery({
    queryKey: ["ops", "call-monitor", range],
    queryFn: () =>
      apiGet<CallMonitorResponse>(`/api/ops/call-monitor?range=${encodeURIComponent(range)}`),
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchIntervalInBackground: false
  });

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  function setRange(next: CallMonitorRange) {
    const params = new URLSearchParams(searchParams);
    params.set("range", next);
    params.delete("hours");
    setSearchParams(params, { replace: true });
  }

  const data = query.data;
  const noData = !data || data.traffic.businessCalls <= 0;
  const metricState = query.isError ? ("unavailable" as const) : noData ? ("no_data" as const) : ("ok" as const);
  const violations = new Set(data?.slo.violations ?? []);
  const windowText = windowLabel(range);
  const statsAt = query.dataUpdatedAt ? new Date(query.dataUpdatedAt) : null;
  const statsTimeLabel = formatStatsTimeLabel(statsAt, now);
  const maxToolCalls = useMemo(
    () => Math.max(1, ...(data?.topTools.map((row) => row.calls) ?? [1])),
    [data?.topTools]
  );

  const sloBadge = (
    <span
      className={`pl-badge ${data?.slo.status === "warn" ? "pl-badge--warning" : ""}`}
      data-testid="call-monitor-slo-status"
    >
      {sloStatusLabel(data?.slo.status ?? (query.isLoading ? "ok" : "no_data"))}
    </span>
  );

  return (
    <div className="space-y-4" data-testid="call-monitor-page">
      <PageHeader
        title="调用监控"
        breadcrumbs={["运行状态", "调用监控"]}
        description={
          <span>
            准实时查看{" "}
            <span className="notranslate" translate="no">
              MCP
            </span>{" "}
            工具调用量、成败与请求时效。
          </span>
        }
        badges={
          <div className="flex flex-wrap items-center gap-2">
            <span data-testid="call-monitor-stats-time">统计时间：{statsTimeLabel}</span>
            {sloBadge}
          </div>
        }
        actions={
          <div className="flex flex-wrap items-center gap-3" data-testid="call-monitor-controls">
            <div
              className="pl-segmented-control pl-segmented-control--cols-2"
              role="tablist"
              aria-label="时间窗口"
            >
              <button
                type="button"
                role="tab"
                className={
                  range === "24h"
                    ? "pl-segmented-control-item pl-segmented-control-item--active"
                    : "pl-segmented-control-item"
                }
                aria-selected={range === "24h"}
                onClick={() => setRange("24h")}
                data-testid="call-monitor-range-24h"
              >
                近 24 小时
              </button>
              <button
                type="button"
                role="tab"
                className={
                  range === "1h"
                    ? "pl-segmented-control-item pl-segmented-control-item--active"
                    : "pl-segmented-control-item"
                }
                aria-selected={range === "1h"}
                onClick={() => setRange("1h")}
                data-testid="call-monitor-range-1h"
              >
                近 1 小时
              </button>
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                data-testid="call-monitor-auto-refresh"
              />
              自动刷新
            </label>
            <button
              type="button"
              className="pl-btn pl-btn--secondary"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
              data-testid="call-monitor-refresh"
            >
              刷新
            </button>
          </div>
        }
      />

      {query.isError ? (
        <p className="pl-error" data-testid="call-monitor-error">
          调用监控加载失败：{query.error instanceof Error ? query.error.message : "未知错误"}
        </p>
      ) : null}

      <div className="pl-metric-grid pl-metric-grid--three" data-testid="call-monitor-kpis">
        <MetricCard
          helpId="call-monitor-volume"
          testId="call-monitor-kpi-volume"
          label={`近 ${range === "1h" ? "1 小时" : "24 小时"}调用量`}
          help={<span>窗口内业务 <span className="notranslate" translate="no">MCP</span> 工具调用次数（不含协议工具）。</span>}
          value={data?.traffic.businessCalls ?? 0}
          state={metricState}
          subValue={windowText}
        />
        <MetricCard
          helpId="call-monitor-success"
          testId="call-monitor-kpi-success"
          label="成功率"
          help="ok 调用占业务调用的比例。"
          value={formatPercent(data?.traffic.successRate ?? 0)}
          state={metricState}
        />
        <MetricCard
          helpId="call-monitor-error"
          testId="call-monitor-kpi-error"
          label="错误率"
          help="error 调用占业务调用的比例。"
          value={formatPercent(data?.traffic.errorRate ?? 0)}
          state={metricState}
          tone={violations.has("error_rate") ? "warning" : undefined}
        />
        <MetricCard
          helpId="call-monitor-denied"
          testId="call-monitor-kpi-denied"
          label="拒绝率"
          help="denied 调用占业务调用的比例。"
          value={formatPercent(data?.traffic.deniedRate ?? 0)}
          state={metricState}
          tone={violations.has("denied_rate") ? "warning" : undefined}
        />
        <MetricCard
          helpId="call-monitor-p95"
          testId="call-monitor-kpi-p95"
          label={
            <span>
              多数请求耗时
              <span className="text-fg-muted font-normal">（<span className="notranslate" translate="no">P95</span>）</span>
            </span>
          }
          labelText="多数请求耗时"
          help={<span>95% 的请求在此时间内完成（<span className="notranslate" translate="no">P95</span>）。</span>}
          value={data?.latency.p95Ms != null ? `${data.latency.p95Ms} ms` : "—"}
          state={metricState}
          tone={violations.has("latency_p95") ? "warning" : undefined}
        />
        <MetricCard
          helpId="call-monitor-slow"
          testId="call-monitor-kpi-slow"
          label="慢于多数请求"
          help={`耗时严格大于慢调用阈值（${data?.window.slowMs ?? 30000} ms）的调用数。`}
          value={data?.latency.slowCalls ?? 0}
          state={metricState}
          tone={(data?.latency.slowCalls ?? 0) > 0 ? "warning" : undefined}
        />
      </div>

      {noData && !query.isLoading && !query.isError ? (
        <p className="pl-notice" data-testid="call-monitor-empty">
          当前窗口暂无 <span className="notranslate" translate="no">MCP</span> 业务调用。可先到{" "}
          <Link to="/overview">系统概览</Link> 检查接入状态。
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="pl-panel" data-testid="call-monitor-top-tools">
          <div className="pl-panel-header">
            <h2 className="pl-panel-title">工具调用排行 · {windowText}</h2>
          </div>
          {(data?.topTools.length ?? 0) === 0 ? (
            <p className="text-sm text-fg-muted">暂无排行数据</p>
          ) : (
            <ul className="space-y-2">
              {data!.topTools.map((row) => (
                <li key={row.tool}>
                  <Link
                    className="pl-usage-rank-link block"
                    to={buildAuditCallsHref({ range, tool: row.tool })}
                    data-testid={`call-monitor-tool-${row.tool}`}
                  >
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="notranslate truncate" translate="no">
                        {row.tool}
                      </span>
                      <span className="tabular-nums text-fg-muted shrink-0">{row.calls}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded bg-bg-muted overflow-hidden">
                      <div
                        className="h-full bg-fg-muted/40"
                        style={{ width: `${Math.max(4, (row.calls / maxToolCalls) * 100)}%` }}
                      />
                    </div>
                    <div className="mt-1 text-xs text-fg-muted">
                      错误 {row.errors} · 拒绝 {row.denied}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="pl-panel" data-testid="call-monitor-recent-failures">
          <div className="pl-panel-header flex items-center justify-between gap-2">
            <h2 className="pl-panel-title">最近失败与拒绝</h2>
            <div className="flex gap-2 text-xs">
              <Link
                className="pl-link"
                to={buildAuditCallsHref({ range, outcome: "error" })}
                data-testid="call-monitor-link-errors"
              >
                查看错误
              </Link>
              <Link
                className="pl-link"
                to={buildAuditCallsHref({ range, outcome: "denied" })}
                data-testid="call-monitor-link-denied"
              >
                查看拒绝
              </Link>
            </div>
          </div>
          {(data?.recentFailures.length ?? 0) === 0 ? (
            <p className="text-sm text-fg-muted">暂无失败或拒绝记录</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="pl-data-grid w-full text-sm">
                <thead>
                  <tr>
                    <th scope="col">时间</th>
                    <th scope="col">工具</th>
                    <th scope="col">结果</th>
                    <th scope="col">耗时</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.recentFailures.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link
                          className="pl-link notranslate"
                          translate="no"
                          to={buildAuditCallsHref({
                            range,
                            outcome: row.outcome,
                            tool: row.tool
                          })}
                          data-testid={`call-monitor-failure-${row.id}`}
                        >
                          {formatLocalTs(row.ts)}
                        </Link>
                      </td>
                      <td>
                        <span className="notranslate" translate="no">
                          {row.tool}
                        </span>
                      </td>
                      <td>{row.outcome === "denied" ? "拒绝" : "错误"}</td>
                      <td className="tabular-nums">{formatDurationMs(row.durationMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
