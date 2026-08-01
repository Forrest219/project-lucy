import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut } from "../../lib/apiClient";
import type { EvalDomainInfo, EvalDriftDistribution, EvalTrendPoint, MonitorConfig } from "../../lib/types";
import { PageHeader } from "../../components/PageHeader";
import { EVAL_MONITOR_EMPTY_ACTIONS } from "../../lib/opsDashboard";

type DomainsResponse = { domains: EvalDomainInfo[] };
type TrendResponse = { points: EvalTrendPoint[]; thresholds: { yellow: number; red: number } };
type TopFailuresResponse = { items: Array<{ caseId: string; failCount: number; lastFailAt: string }> };
type ConfigResponse = { config: MonitorConfig };

// SVG line chart (native, no external library)
function TrendChart({ points, thresholds }: { points: EvalTrendPoint[]; thresholds: { yellow: number; red: number } }) {
  const W = 700;
  const H = 200;
  const PAD = { top: 20, right: 20, bottom: 40, left: 50 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (points.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-md border border-border-default text-sm text-fg-muted">
        暂无数据
      </div>
    );
  }

  const minDate = points[0].date;
  const maxDate = points[points.length - 1].date;
  const totalDays = Math.max(
    1,
    (new Date(maxDate).getTime() - new Date(minDate).getTime()) / 86400_000
  );

  function xPos(date: string): number {
    const days = (new Date(date).getTime() - new Date(minDate).getTime()) / 86400_000;
    return PAD.left + (days / totalDays) * innerW;
  }

  function yPos(rate: number): number {
    return PAD.top + (1 - rate) * innerH;
  }

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xPos(p.date).toFixed(1)} ${yPos(p.passRate).toFixed(1)}`)
    .join(" ");

  const yellowY = yPos(thresholds.yellow).toFixed(1);
  const redY = yPos(thresholds.red).toFixed(1);
  const yellowPct = Math.round(thresholds.yellow * 100);
  const redPct = Math.round(thresholds.red * 100);

  // Y axis ticks
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: "220px" }} data-testid="monitor-trend-chart">
      {/* Grid lines */}
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yPos(t)}
            y2={yPos(t)}
            stroke="var(--color-border-default)"
            strokeDasharray="4 4"
            strokeWidth={0.5}
          />
          <text
            x={PAD.left - 6}
            y={yPos(t) + 4}
            fontSize={10}
            textAnchor="end"
            fill="var(--color-fg-muted)"
          >
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}

      {/* Threshold lines (yellow + red) with text labels so colour is
          not the only carrier. M36 spec calls for explicit text labels
          next to the dashed lines. */}
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={yellowY} y2={yellowY}
        stroke="var(--color-warning)" strokeWidth={1.5} strokeDasharray="6 3"
        data-testid="monitor-threshold-yellow-line"
      />
      <text
        x={W - PAD.right + 3}
        y={Number(yellowY) + 4}
        fontSize={9}
        fill="var(--color-warning)"
        data-testid="monitor-threshold-yellow-label"
      >黄线 {yellowPct}%</text>
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={redY} y2={redY}
        stroke="var(--color-danger)" strokeWidth={1.5} strokeDasharray="6 3"
        data-testid="monitor-threshold-red-line"
      />
      <text
        x={W - PAD.right + 3}
        y={Number(redY) + 4}
        fontSize={9}
        fill="var(--color-danger)"
        data-testid="monitor-threshold-red-label"
      >红线 {redPct}%</text>

      {/* Pass rate line */}
      <path d={pathD} fill="none" stroke="var(--color-accent)" strokeWidth={2} />

      {/* Data points. Points below the red threshold are highlighted in
          danger colour and exposed as the drill-down target. */}
      {points.map((p) => {
        const belowRed = p.passRate < thresholds.red;
        return (
          <circle
            key={p.date}
            cx={xPos(p.date)}
            cy={yPos(p.passRate)}
            r={belowRed ? 4 : 3}
            fill={belowRed ? "var(--color-danger)" : "var(--color-accent)"}
            data-testid={belowRed ? `monitor-below-red-${p.date}` : `monitor-point-${p.date}`}
          >
            <title>{p.date}: {Math.round(p.passRate * 100)}% ({p.totalRuns} runs)</title>
          </circle>
        );
      })}

      {/* X axis labels */}
      {points
        .filter((_, i) => i === 0 || i === points.length - 1 || i % Math.ceil(points.length / 5) === 0)
        .map((p) => (
          <text
            key={p.date}
            x={xPos(p.date)}
            y={H - PAD.bottom + 15}
            fontSize={9}
            textAnchor="middle"
            fill="var(--color-fg-muted)"
          >
            {p.date.slice(5)}
          </text>
        ))}
    </svg>
  );
}

function pct(value: number | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "-";
}

function MetricCard({ label, value, hint, tone = "default" }: { label: string; value: string | number; hint: string; tone?: "default" | "warning" | "danger" | "success" }) {
  return (
    <div className={`pl-metric-card pl-metric-card--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function clampNumber(rawValue: string, min: number, max: number): number | null {
  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Map an empty-state CTA to a destination href. Centralised here so the
 * Monitor empty state stays in sync with the dashboard view model.
 */
function emptyActionHref(action: string, domain: string): string {
  switch (action) {
    case "触发首次 Run":
      return `/eval/runs${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`;
    case "导入评测用例":
      return `/eval/cases${domain ? `/${encodeURIComponent(domain)}` : ""}`;
    case "配置阈值":
      return "#monitor-threshold-config";
    default:
      return "/eval/monitor";
  }
}

/**
 * Build a deep-link to the run list filtered to a specific date. M36 polish:
 * the link is documented as "查看相关 Run" (not "查看失败 Case") because
 * the RunList page does not yet consume the `?date=` filter. The
 * `?domain=` half is honoured and lands the user on the right list; once
 * RunList honours `?date=` we can re-label the CTA back to "查看失败 Case".
 */
function belowRedDeepLinkHref(
  points: EvalTrendPoint[],
  red: number,
  domain: string
): string {
  const first = [...points].reverse().find((point) => point.passRate < red) ?? points[0];
  const params = new URLSearchParams();
  if (domain) params.set("domain", domain);
  if (first) params.set("date", first.date);
  return `/eval/runs${params.toString() ? `?${params.toString()}` : ""}`;
}

export function Monitor() {
  const qc = useQueryClient();
  const [domain, setDomain] = useState("");
  const [days, setDays] = useState(30);

  const { data: domainsData } = useQuery({
    queryKey: ["eval", "domains"],
    queryFn: () => apiGet<DomainsResponse>("/api/eval/domains")
  });
  const domains = domainsData?.domains ?? [];

  const activeDomain = domain || domains[0]?.domain || "";

  const { data: trendData, isLoading: loadingTrend } = useQuery({
    queryKey: ["eval", "monitor", "trend", activeDomain, days],
    queryFn: () => apiGet<TrendResponse>(`/api/eval/monitor/trend?domain=${activeDomain}&days=${days}`),
    enabled: Boolean(activeDomain)
  });

  const { data: topFailData } = useQuery({
    queryKey: ["eval", "monitor", "top-failures", activeDomain, days],
    queryFn: () => apiGet<TopFailuresResponse>(`/api/eval/monitor/top-failures?domain=${activeDomain}&days=${days}`),
    enabled: Boolean(activeDomain)
  });

  const { data: driftData } = useQuery({
    queryKey: ["eval", "monitor", "drift-distribution", activeDomain, days],
    queryFn: () => apiGet<EvalDriftDistribution>(`/api/eval/monitor/drift-distribution?domain=${activeDomain}&days=${days}`),
    enabled: Boolean(activeDomain)
  });

  const { data: configData } = useQuery({
    queryKey: ["eval", "monitor", "config"],
    queryFn: () => apiGet<ConfigResponse>("/api/eval/monitor/config")
  });

  const [configEdit, setConfigEdit] = useState<MonitorConfig | null>(null);
  const currentConfig = configEdit ?? configData?.config ?? { domains: {} };
  const invalidThresholdConfig = Object.values(currentConfig.domains).some((item) => item.passRateYellow <= item.passRateRed);

  const saveConfigMutation = useMutation({
    mutationFn: () => apiPut<unknown>("/api/eval/monitor/config", { config: currentConfig }),
    onSuccess: () => {
      toast.success("阈值配置已保存");
      setConfigEdit(null);
      void qc.invalidateQueries({ queryKey: ["eval", "monitor", "config"] });
      void qc.invalidateQueries({ queryKey: ["eval", "monitor"] });
    },
    onError: (err) => toast.error(`保存失败：${(err as Error).message}`)
  });

  const points = useMemo(() => [...(trendData?.points ?? [])].sort((a, b) => a.date.localeCompare(b.date)), [trendData?.points]);
  const activeDomainConfig = activeDomain ? currentConfig.domains[activeDomain] : undefined;
  const thresholds = activeDomainConfig
    ? { yellow: activeDomainConfig.passRateYellow, red: activeDomainConfig.passRateRed }
    : trendData?.thresholds ?? { yellow: 0.9, red: 0.8 };
  const topFails = topFailData?.items ?? [];
  const driftItems = driftData?.items ?? [];
  const driftTotal = driftItems.reduce((sum, item) => sum + item.count, 0);

  // Alert banner: check last point vs threshold
  const lastPoint = points[points.length - 1];
  const showAlert = lastPoint && lastPoint.passRate < thresholds.red;
  const showWarning = lastPoint && !showAlert && lastPoint.passRate < thresholds.yellow;
  const statusTone = showAlert ? "danger" : showWarning ? "warning" : lastPoint ? "success" : "default";
  const statusText = showAlert ? "红线" : showWarning ? "黄线" : lastPoint ? "正常" : "无数据";

  return (
    <div className="pl-page-stack">
      <PageHeader
        title="趋势监控"
        breadcrumbs={["质量评测", "趋势监控"]}
        description="查看 eval 质量趋势、失败集中度与 drift 分布。"
        badges={
          <>
            <span>{activeDomain}</span>
            <span>近 {days} 天</span>
            {lastPoint ? <span>最新 {pct(lastPoint.passRate)}</span> : null}
          </>
        }
        actions={
          <>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-fg-muted">Domain</span>
              <select className="pl-input" value={activeDomain} onChange={(e) => setDomain(e.target.value)}>
                {domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
              </select>
            </label>
            <div className="pl-segmented-control" role="tablist" aria-label="时间窗口">
              {[7, 30, 90].map((value) => (
                <button
                  aria-selected={days === value}
                  className={days === value ? "pl-segmented-control-item pl-segmented-control-item--active" : "pl-segmented-control-item"}
                  key={value}
                  onClick={() => setDays(value)}
                  role="tab"
                  type="button"
                >
                  {value}d
                </button>
              ))}
            </div>
            <button
              className="pl-btn pl-btn--secondary"
              onClick={() => void qc.invalidateQueries({ queryKey: ["eval", "monitor"] })}
              type="button"
            >
              刷新
            </button>
          </>
        }
      />

      <div className="pl-metric-grid">
        <MetricCard label="最新通过率" value={pct(lastPoint?.passRate)} hint={lastPoint?.date ?? "暂无趋势数据"} tone={statusTone} />
        <MetricCard label="最近 run" value={lastPoint?.totalRuns ?? 0} hint={`近 ${days} 天最后统计点`} />
        <MetricCard label="失败 case" value={topFails.length} hint={topFails.length > 0 ? "见 Top failures" : "暂无失败集中项"} tone={topFails.length > 0 ? "warning" : "success"} />
        <MetricCard label="红线状态" value={statusText} hint={`红线 ${pct(thresholds.red)} / 黄线 ${pct(thresholds.yellow)}`} tone={statusTone} />
      </div>

      <div className="pl-monitor-grid">
        <section className="pl-panel pl-monitor-trend" data-testid="monitor-trend-panel">
          <div className="flex items-center justify-between gap-2">
            <p className="pl-panel-title mb-0">通过率趋势（近 {days} 天）</p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <span data-testid="monitor-threshold-summary">
                黄线 {Math.round(thresholds.yellow * 100)}% · 红线 {Math.round(thresholds.red * 100)}%
              </span>
              {points.some((point) => point.passRate < thresholds.red) ? (
                <span
                  className="pl-status-badge pl-status-validation_failed"
                  data-testid="monitor-below-red-summary"
                >
                  {points.filter((point) => point.passRate < thresholds.red).length} 个点跌破红线
                </span>
              ) : null}
            </div>
          </div>
          {loadingTrend ? (
            <div className="pl-notice mt-2">加载中...</div>
          ) : points.length === 0 ? (
            <div
              className="mt-3 grid gap-3 rounded-md border border-dashed border-border-default bg-bg-subtle p-4"
              data-testid="monitor-trend-empty"
            >
              <div className="grid gap-1">
                <strong>暂无趋势数据</strong>
                <p className="text-xs text-fg-muted">
                  你可以选择下面任一动作建立质量基线。
                </p>
              </div>
              <div className="flex flex-wrap gap-2" data-testid="monitor-trend-empty-actions">
                {EVAL_MONITOR_EMPTY_ACTIONS.map((action) => (
                  <a
                    key={action}
                    href={emptyActionHref(action, activeDomain)}
                    className="pl-btn pl-btn--secondary text-sm notranslate"
                    translate="no"
                    data-testid={`monitor-empty-action-${action}`}
                  >
                    {action}
                  </a>
                ))}
              </div>
            </div>
          ) : (
            <>
              <TrendChart points={points} thresholds={thresholds} />
              {points.some((point) => point.passRate < thresholds.red) ? (
                <div
                  className="mt-3 rounded-md border border-danger-strong bg-danger-soft p-3 text-sm text-danger-strong"
                  data-testid="monitor-below-red-callout"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {points.filter((point) => point.passRate < thresholds.red).length} 个点跌破红线，请查看相关 Run。
                    </span>
                    <Link
                      to={belowRedDeepLinkHref(points, thresholds.red, activeDomain)}
                      className="pl-btn pl-btn--secondary text-sm notranslate"
                      translate="no"
                      data-testid="monitor-below-red-drilldown"
                    >
                      查看相关 Run →
                    </Link>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </section>

        <section className="pl-panel">
          <p className="pl-panel-title">Drift 分布</p>
          {driftItems.length === 0 ? (
            <div className="pl-empty-state">暂无 drift 数据</div>
          ) : (
            <div className="grid gap-2">
              {driftItems.map((item) => {
                const percent = driftTotal > 0 ? (item.count / driftTotal) * 100 : 0;
                return (
                  <div key={item.drift} className="pl-distribution-row">
                    <span>{item.drift}</span>
                    <div><i style={{ width: `${percent}%` }} /></div>
                    <strong>{item.count}</strong>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="pl-panel">
          <p className="pl-panel-title">失败 Top-{topFails.length}</p>
          {topFails.length === 0 ? (
            <div className="pl-empty-state">暂无失败 case</div>
          ) : (
            <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-left text-xs text-fg-muted">
                <th className="px-3 py-2">Case ID</th>
                <th className="px-3 py-2">失败次数</th>
                <th className="px-3 py-2">最近失败</th>
              </tr>
            </thead>
            <tbody>
              {topFails.map((item) => (
                <tr key={item.caseId} className="border-b border-border-default">
                  <td className="px-3 py-2 font-mono text-xs">{item.caseId}</td>
                  <td className="px-3 py-2 font-medium text-danger">{item.failCount}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {new Date(item.lastFailAt).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </section>
      </div>

      <section className="pl-panel">
        <p className="pl-panel-title">告警阈值配置</p>
        {domains.length === 0 ? (
          <div className="pl-empty-state">无 domain</div>
        ) : (
          <div className="grid gap-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default text-left text-xs text-fg-muted">
                  <th className="px-3 py-2">Domain</th>
                  <th className="px-3 py-2">黄线（%）</th>
                  <th className="px-3 py-2">红线（%）</th>
                  <th className="px-3 py-2">连续失败告警次数</th>
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => {
                  const dc = currentConfig.domains[d.domain] ?? { passRateYellow: 0.9, passRateRed: 0.8, consecutiveFailThreshold: 3 };
                  return (
                    <tr key={d.domain} className="border-b border-border-default">
                      <td className="px-3 py-2 font-medium">{d.domain}</td>
                      <td className="px-3 py-2">
                        <input
                          className="pl-input w-20 text-sm"
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(dc.passRateYellow * 100)}
                          onChange={(e) => {
                            const percent = clampNumber(e.target.value, 0, 100);
                            if (percent === null) {
                              return;
                            }
                            const v = percent / 100;
                            setConfigEdit((prev) => {
                              const cfg = prev ?? { ...currentConfig };
                              return {
                                ...cfg,
                                domains: { ...cfg.domains, [d.domain]: { ...dc, passRateYellow: v } }
                              };
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="pl-input w-20 text-sm"
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(dc.passRateRed * 100)}
                          onChange={(e) => {
                            const percent = clampNumber(e.target.value, 0, 100);
                            if (percent === null) {
                              return;
                            }
                            const v = percent / 100;
                            setConfigEdit((prev) => {
                              const cfg = prev ?? { ...currentConfig };
                              return {
                                ...cfg,
                                domains: { ...cfg.domains, [d.domain]: { ...dc, passRateRed: v } }
                              };
                            });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="pl-input w-20 text-sm"
                          type="number"
                          min={1}
                          max={20}
                          value={dc.consecutiveFailThreshold}
                          onChange={(e) => {
                            const v = clampNumber(e.target.value, 1, 20);
                            if (v === null) {
                              return;
                            }
                            setConfigEdit((prev) => {
                              const cfg = prev ?? { ...currentConfig };
                              return {
                                ...cfg,
                                domains: { ...cfg.domains, [d.domain]: { ...dc, consecutiveFailThreshold: v } }
                              };
                            });
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-end">
              {invalidThresholdConfig ? <p className="pl-error mr-auto">黄线必须高于红线。</p> : null}
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending || !configEdit || invalidThresholdConfig}
              >
                {saveConfigMutation.isPending ? "保存中…" : "保存阈值"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
