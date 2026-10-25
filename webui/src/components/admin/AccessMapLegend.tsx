/**
 * Lucy v0.25 P1-3 — 访问关系图图例。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md` §7.4 / §9
 *
 * 图例必须标明当前访问层口径与统计窗口起止：读者要能判断
 * 「僵尸授权 N 条」是哪个时间窗、哪个信任口径下的结论。
 */
import { accessMapTrustLabel, type AccessMapMeta } from "./AccessMapTypes";

export type AccessMapLegendProps = {
  meta: AccessMapMeta;
};

export function AccessMapLegend({ meta }: AccessMapLegendProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted"
      data-testid="access-map-legend"
    >
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-6 rounded-sm bg-brand opacity-40" aria-hidden="true" />
        流带宽度 = 授权路径数
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-6 rounded-sm bg-accent opacity-90" aria-hidden="true" />
        深色内核 = 访问路径数
      </span>
      <span className="flex items-center gap-1">
        <span
          className="inline-block h-0 w-6 border-t-2 border-dashed border-border-strong"
          aria-hidden="true"
        />
        虚线附属区 = 凭证清单
      </span>
      <span className="flex items-center gap-1">
        <span className="inline-block h-2 w-6 rounded-sm bg-warning-strong opacity-70" aria-hidden="true" />
        警示描边 = 需复核 / 确凿越权
      </span>
      <span className="notranslate" translate="no" data-testid="access-map-legend-trust">
        访问口径：{accessMapTrustLabel(meta.access.trust)}
      </span>
      <span className="notranslate" translate="no" data-testid="access-map-legend-window">
        统计窗口：{meta.window.startIso} ~ {meta.window.endIso}
      </span>
    </div>
  );
}
