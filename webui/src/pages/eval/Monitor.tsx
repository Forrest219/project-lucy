import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiGet, apiPut } from "../../lib/apiClient";
import type { EvalDomainInfo, EvalDriftDistribution, EvalTrendPoint, MonitorConfig } from "../../lib/types";

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
      <div className="flex items-center justify-center h-48 border border-border rounded text-fg-muted text-sm">
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

  // Y axis ticks
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8, 1.0];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: "220px" }}>
      {/* Grid lines */}
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={yPos(t)}
            y2={yPos(t)}
            stroke="var(--color-border, #e5e7eb)"
            strokeDasharray="4 4"
            strokeWidth={0.5}
          />
          <text
            x={PAD.left - 6}
            y={yPos(t) + 4}
            fontSize={10}
            textAnchor="end"
            fill="var(--color-fg-muted, #6b7280)"
          >
            {Math.round(t * 100)}%
          </text>
        </g>
      ))}

      {/* Threshold lines */}
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={yellowY} y2={yellowY}
        stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="6 3"
      />
      <text x={W - PAD.right + 3} y={Number(yellowY) + 4} fontSize={9} fill="#f59e0b">黄线</text>
      <line
        x1={PAD.left} x2={W - PAD.right}
        y1={redY} y2={redY}
        stroke="#ef4444" strokeWidth={1.5} strokeDasharray="6 3"
      />
      <text x={W - PAD.right + 3} y={Number(redY) + 4} fontSize={9} fill="#ef4444">红线</text>

      {/* Pass rate line */}
      <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth={2} />

      {/* Data points */}
      {points.map((p) => (
        <circle
          key={p.date}
          cx={xPos(p.date)}
          cy={yPos(p.passRate)}
          r={3}
          fill="#3b82f6"
        >
          <title>{p.date}: {Math.round(p.passRate * 100)}% ({p.totalRuns} runs)</title>
        </circle>
      ))}

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
            fill="var(--color-fg-muted, #6b7280)"
          >
            {p.date.slice(5)}
          </text>
        ))}
    </svg>
  );
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

  const saveConfigMutation = useMutation({
    mutationFn: () => apiPut<unknown>("/api/eval/monitor/config", { config: currentConfig }),
    onSuccess: () => {
      toast.success("阈值配置已保存");
      setConfigEdit(null);
      void qc.invalidateQueries({ queryKey: ["eval", "monitor", "config"] });
    },
    onError: (err) => toast.error(`保存失败：${(err as Error).message}`)
  });

  const points = trendData?.points ?? [];
  const thresholds = trendData?.thresholds ?? { yellow: 0.9, red: 0.8 };
  const topFails = topFailData?.items ?? [];
  const driftItems = driftData?.items ?? [];
  const driftTotal = driftItems.reduce((sum, item) => sum + item.count, 0);

  // Alert banner: check last point vs threshold
  const lastPoint = points[points.length - 1];
  const showAlert = lastPoint && lastPoint.passRate < thresholds.red;
  const showWarning = lastPoint && !showAlert && lastPoint.passRate < thresholds.yellow;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">趋势监控</h1>
        <p className="text-sm text-fg-muted mt-1">查看 eval 质量趋势，配置告警阈值。</p>
      </div>

      {/* Alert banner */}
      {showAlert && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          当前 {activeDomain} 通过率 {Math.round(lastPoint.passRate * 100)}%，已跌破红线（{Math.round(thresholds.red * 100)}%）
        </div>
      )}
      {showWarning && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-700">
          当前 {activeDomain} 通过率 {Math.round(lastPoint.passRate * 100)}%，已低于黄线（{Math.round(thresholds.yellow * 100)}%）
        </div>
      )}

      {/* Controls */}
      <div className="flex gap-3 flex-wrap">
        <select className="pl-input w-40" value={domain} onChange={(e) => setDomain(e.target.value)}>
          {domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
        </select>
        <select className="pl-input w-24" value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
          <option value={7}>7 天</option>
          <option value={14}>14 天</option>
          <option value={30}>30 天</option>
          <option value={90}>90 天</option>
        </select>
      </div>

      {/* Trend chart */}
      <div className="border border-border rounded p-4">
        <h2 className="font-medium text-sm mb-3">通过率趋势（近 {days} 天）</h2>
        {loadingTrend ? (
          <div className="pl-notice">加载中…</div>
        ) : (
          <TrendChart points={points} thresholds={thresholds} />
        )}
      </div>

      {/* Top failures */}
      {topFails.length > 0 && (
        <div className="border border-border rounded p-4">
          <h2 className="font-medium text-sm mb-3">失败 Top-{topFails.length}（近 {days} 天）</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-fg-muted">
                <th className="px-3 py-2">Case ID</th>
                <th className="px-3 py-2">失败次数</th>
                <th className="px-3 py-2">最近失败</th>
              </tr>
            </thead>
            <tbody>
              {topFails.map((item) => (
                <tr key={item.caseId} className="border-b border-border">
                  <td className="px-3 py-2 font-mono text-xs">{item.caseId}</td>
                  <td className="px-3 py-2 font-medium text-red-500">{item.failCount}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {new Date(item.lastFailAt).toLocaleString("zh-CN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border border-border rounded p-4">
        <h2 className="font-medium text-sm mb-3">Drift 分类分布（近 {days} 天）</h2>
        {driftItems.length === 0 ? (
          <div className="text-sm text-fg-muted">暂无 drift 数据</div>
        ) : (
          <div className="grid gap-2">
            {driftItems.map((item) => {
              const pct = driftTotal > 0 ? (item.count / driftTotal) * 100 : 0;
              return (
                <div key={item.drift} className="grid grid-cols-[160px_minmax(0,1fr)_64px] items-center gap-3 text-sm">
                  <span className="font-mono text-xs">{item.drift}</span>
                  <div className="h-2 rounded bg-bg-muted overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-fg-muted text-right">{item.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Threshold config */}
      <div className="border border-border rounded p-4">
        <h2 className="font-medium text-sm mb-3">告警阈值配置</h2>
        {domains.length === 0 ? (
          <div className="text-sm text-fg-muted">无 domain</div>
        ) : (
          <div className="grid gap-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-fg-muted">
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
                    <tr key={d.domain} className="border-b border-border">
                      <td className="px-3 py-2 font-medium">{d.domain}</td>
                      <td className="px-3 py-2">
                        <input
                          className="pl-input w-20 text-sm"
                          type="number"
                          min={0}
                          max={100}
                          value={Math.round(dc.passRateYellow * 100)}
                          onChange={(e) => {
                            const v = parseInt(e.target.value, 10) / 100;
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
                            const v = parseInt(e.target.value, 10) / 100;
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
                            const v = parseInt(e.target.value, 10);
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
              <button
                type="button"
                className="pl-btn pl-btn--primary text-sm"
                onClick={() => saveConfigMutation.mutate()}
                disabled={saveConfigMutation.isPending || !configEdit}
              >
                {saveConfigMutation.isPending ? "保存中…" : "保存阈值"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
