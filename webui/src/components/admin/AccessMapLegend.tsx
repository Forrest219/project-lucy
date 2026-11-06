/**
 * Lucy v0.25 P1-3 — 访问关系图图例。
 *
 * Authority: usage-first Spec v0.4.2 Terminology Compliance
 *   流带宽度 = 访问路径数
 *   闲置授权 = 端点细空心示意（不撑柱／不进列）
 *   虚线 = 需复核；实线 = 确凿越权
 *
 * Forbidden：授权路径宽度主释义；深色内核主释义。
 */
import type { AccessMapMeta } from "./AccessMapTypes";

export type AccessMapLegendMetaProps = {
  meta: AccessMapMeta;
};

/**
 * 图例短行：恰好四项。
 */
export function AccessMapLegend() {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted"
      data-testid="access-map-legend"
    >
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-6 rounded-sm bg-accent opacity-90" aria-hidden="true" />
        流带宽度 = 访问路径数
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-2 w-6 border border-fg-muted bg-transparent"
          aria-hidden="true"
        />
        闲置授权 = 端点细空心示意（不撑柱／不进列）
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-0 w-6 border-t-2 border-dashed border-warning-strong"
          aria-hidden="true"
        />
        虚线 = 需复核
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-0 w-6 border-t-2 border-danger-strong" aria-hidden="true" />
        实线 = 确凿越权
      </span>
    </div>
  );
}

/**
 * 图例元信息（chart-first Spec §5.4）。
 */
export function AccessMapLegendMeta({ meta }: AccessMapLegendMetaProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span data-testid="access-map-legend-trust">关联口径：已确认关联</span>
      <span className="notranslate" translate="no" data-testid="access-map-legend-window">
        统计窗口：{meta.window.startIso} ~ {meta.window.endIso}
      </span>
    </div>
  );
}
