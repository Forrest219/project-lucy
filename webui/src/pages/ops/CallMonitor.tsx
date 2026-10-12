import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import {
  parseCallMonitorRange,
  type CallMonitorBucket,
  type CallMonitorRange
} from "../../lib/callMonitorWindow";
import { PageHeader } from "../../components/PageHeader";
import { MetricCard } from "../../components/MetricCard";

type CallMonitorSeriesPoint = {
  start: string;
  businessCalls: number;
  okCalls: number;
  errorCalls: number;
  deniedCalls: number;
  successRate: number | null;
  errorRate: number | null;
  deniedRate: number | null;
  p95Ms: number | null;
  slowCalls: number;
};

type CallMonitorResponse = {
  generatedAt: string;
  window: {
    range: CallMonitorRange;
    timeZone: "Asia/Shanghai";
    bucket: CallMonitorBucket;
    bucketCount: number;
    since: string;
    until: string;
    slowMs: number;
  };
  series?: CallMonitorSeriesPoint[];
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

export type { CallMonitorRange };

const RANGE_OPTIONS: Array<{ range: CallMonitorRange; label: string; noun: string }> = [
  { range: "1h", label: "近 1 小时", noun: "1 小时" },
  { range: "24h", label: "近 24 小时", noun: "24 小时" },
  { range: "7d", label: "近 7 天", noun: "7 天" },
  { range: "30d", label: "近 30 天", noun: "30 天" }
];

const GRAIN_LABEL: Record<CallMonitorBucket, string> = {
  "5m": "5 分钟",
  hour: "小时",
  day: "天"
};

function parseRange(searchParams: URLSearchParams): CallMonitorRange {
  return parseCallMonitorRange(searchParams.get("range") ?? undefined, searchParams.get("hours") ?? undefined);
}

function windowLabel(range: CallMonitorRange): string {
  return RANGE_OPTIONS.find((option) => option.range === range)?.label ?? "近 24 小时";
}

function windowNoun(range: CallMonitorRange): string {
  return RANGE_OPTIONS.find((option) => option.range === range)?.noun ?? "24 小时";
}

function seriesLabel(metric: string, rangeLabel: string, bucket: CallMonitorBucket | undefined): string {
  return `${metric}，${rangeLabel}，按${GRAIN_LABEL[bucket ?? "hour"]}`;
}

function formatPercent(rate: number): string {
  return `${(rate * 100).toFixed(rate >= 0.1 || rate === 0 ? 1 : 2)}%`;
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes} m ${seconds} s`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatFailureTime(iso: string, now = new Date()): { visible: string; full: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { visible: iso, full: iso };
  const clock = `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
  const full = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${clock}`;
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  return { visible: sameDay ? clock : full, full };
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

function FailureTimeLink({
  row,
  range
}: {
  row: { id: number; ts: string; tool: string; outcome: "error" | "denied" };
  range: CallMonitorRange;
}) {
  const time = formatFailureTime(row.ts);
  return (
    <Link
      className="pl-link notranslate"
      translate="no"
      title={time.full}
      aria-label={time.full}
      to={buildAuditCallsHref({
        range,
        outcome: row.outcome,
        tool: row.tool
      })}
      data-testid={`call-monitor-failure-${row.id}`}
    >
      {time.visible}
    </Link>
  );
}

export function CallMonitor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const range = parseRange(searchParams);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const query = useQuery({
    queryKey: ["ops", "call-monitor", range],
    queryFn: () =>
      apiGet<CallMonitorResponse>(`/api/ops/call-monitor?range=${encodeURIComponent(range)}`),
    refetchInterval: autoRefresh ? 30_000 : false,
    refetchIntervalInBackground: false
  });

  function setRange(next: CallMonitorRange) {
    const params = new URLSearchParams(searchParams);
    params.set("range", next);
    params.delete("hours");
    setSearchParams(params, { replace: true });
  }

  const data = query.data;
  const awaitingFirstLoad = !data && query.isPending;
  const failedWithoutSnapshot = query.isError && !data;
  const noData = Boolean(data) && data.traffic.businessCalls <= 0;
  const metricState = failedWithoutSnapshot
    ? ("unavailable" as const)
    : awaitingFirstLoad
      ? ("ok" as const)
      : noData
        ? ("no_data" as const)
        : ("ok" as const);
  const showNumbers = Boolean(data) && metricState === "ok";
  const violations = new Set(data?.slo.violations ?? []);
  const windowText = windowLabel(range);
  const errorMessage = query.error instanceof Error ? query.error.message : "未知错误";
  const maxToolCalls = useMemo(
    () => Math.max(1, ...(data?.topTools.map((row) => row.calls) ?? [1])),
    [data?.topTools]
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
        actions={
          <div className="flex flex-wrap items-center gap-3" data-testid="call-monitor-controls">
            <div
              className="pl-segmented-control pl-segmented-control--cols-4"
              role="tablist"
              aria-label="时间窗口"
            >
              {RANGE_OPTIONS.map((option) => (
                <button
                  key={option.range}
                  type="button"
                  role="tab"
                  className={
                    range === option.range
                      ? "pl-segmented-control-item pl-segmented-control-item--active"
                      : "pl-segmented-control-item"
                  }
                  aria-selected={range === option.range}
                  onClick={() => setRange(option.range)}
                  data-testid={`call-monitor-range-${option.range}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm text-fg-muted">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                data-testid="call-monitor-auto-refresh"
              />
              每 30 秒刷新
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
          {data ? "本次刷新失败" : "调用监控加载失败"}：{errorMessage}
        </p>
      ) : null}

      <div className="pl-metric-grid pl-metric-grid--three" data-testid="call-monitor-kpis">
        <MetricCard
          helpId="call-monitor-volume"
          testId="call-monitor-kpi-volume"
          label={`近 ${windowNoun(range)}调用量`}
          help={<span>窗口内业务 <span className="notranslate" translate="no">MCP</span> 工具调用次数（不含协议工具）。</span>}
          value={showNumbers ? data?.traffic.businessCalls ?? 0 : "—"}
          state={metricState}
          series={showNumbers ? data?.series?.map((point) => point.businessCalls) : undefined}
          seriesLabel={seriesLabel(`近 ${windowNoun(range)}调用量`, windowText, data?.window.bucket)}
          seriesMetric="volume"
        />
        <MetricCard
          helpId="call-monitor-success"
          testId="call-monitor-kpi-success"
          label="成功率"
          help="ok 调用占业务调用的比例。"
          value={showNumbers ? formatPercent(data?.traffic.successRate ?? 0) : "—"}
          state={metricState}
          series={showNumbers ? data?.series?.map((point) => point.successRate) : undefined}
          seriesLabel={seriesLabel("成功率", windowText, data?.window.bucket)}
          seriesMetric="success"
        />
        <MetricCard
          helpId="call-monitor-error"
          testId="call-monitor-kpi-error"
          label="错误率"
          help="error 调用占业务调用的比例。"
          value={showNumbers ? formatPercent(data?.traffic.errorRate ?? 0) : "—"}
          state={metricState}
          tone={showNumbers && violations.has("error_rate") ? "warning" : undefined}
          series={showNumbers ? data?.series?.map((point) => point.errorRate) : undefined}
          seriesLabel={seriesLabel("错误率", windowText, data?.window.bucket)}
          seriesMetric="error"
        />
        <MetricCard
          helpId="call-monitor-denied"
          testId="call-monitor-kpi-denied"
          label="拒绝率"
          help="denied 调用占业务调用的比例。"
          value={showNumbers ? formatPercent(data?.traffic.deniedRate ?? 0) : "—"}
          state={metricState}
          tone={showNumbers && violations.has("denied_rate") ? "warning" : undefined}
          series={showNumbers ? data?.series?.map((point) => point.deniedRate) : undefined}
          seriesLabel={seriesLabel("拒绝率", windowText, data?.window.bucket)}
          seriesMetric="denied"
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
          help={<span>95% 的请求在此时间内完成（<span className="notranslate" translate="no">P95</span>）。时段内调用少于 20 次时，折线在该段断开。</span>}
          value={showNumbers ? (data?.latency.p95Ms != null ? `${data.latency.p95Ms} ms` : "—") : "—"}
          state={metricState}
          tone={showNumbers && violations.has("latency_p95") ? "warning" : undefined}
          series={showNumbers ? data?.series?.map((point) => point.p95Ms) : undefined}
          seriesLabel={seriesLabel("多数请求耗时", windowText, data?.window.bucket)}
          seriesMetric="p95"
        />
        <MetricCard
          helpId="call-monitor-slow"
          testId="call-monitor-kpi-slow"
          label="慢于多数请求"
          help={`耗时严格大于慢调用阈值（${data?.window.slowMs ?? 30000} ms）的调用数。`}
          value={showNumbers ? data?.latency.slowCalls ?? 0 : "—"}
          state={metricState}
          tone={showNumbers && (data?.latency.slowCalls ?? 0) > 0 ? "warning" : undefined}
          series={showNumbers ? data?.series?.map((point) => point.slowCalls) : undefined}
          seriesLabel={seriesLabel("慢于多数请求", windowText, data?.window.bucket)}
          seriesMetric="slow"
        />
      </div>

      <p className="pl-notice" data-testid="call-monitor-usage-slow-mark">
        问询慢标记自 <span className="notranslate" translate="no">2026-10-12</span> 起生效。
        <span className="notranslate" translate="no">lucy_query</span> 达到 5 秒，或问询墙钟达到 120 秒，记入问询慢标记。
      </p>

      {noData && !query.isPending && !failedWithoutSnapshot ? (
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
                        <FailureTimeLink row={row} range={range} />
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
