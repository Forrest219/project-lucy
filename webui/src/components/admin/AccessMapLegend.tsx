/**
 * Lucy v0.25 P1-3 — 访问关系图图例。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md` §7.4 / §9
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` §2.3 / §5.3
 *
 * 图例只保留四枚色块或线型 —— 它回答的是「图上每种线是什么意思」，
 * 不再重复「这是哪个时间窗、哪个信任口径」。窗口起止与访问口径落在下面那行
 * 元信息里，跟着口径说明一起折叠。
 *
 * 四项与 §5.3 的着色表一一对应：
 * 授权流带（`series/grant`）、访问内核（`series/access`）、
 * 需复核（warning 虚线）、确凿越权（danger 实线）。
 * 僵尸授权的流带与正常授权同色，状态由卡片上的「僵尸授权」文字承担，
 * 所以图例里**不再**有「警示描边 = 需复核 / 确凿越权」这种合并项。
 */
import { accessMapTrustLabel, type AccessMapMeta } from "./AccessMapTypes";

export type AccessMapLegendProps = {
  meta: AccessMapMeta;
};

export function AccessMapLegend({ meta }: AccessMapLegendProps) {
  return (
    <div
      className="flex flex-col gap-1 text-xs text-fg-muted"
      data-testid="access-map-legend"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="notranslate" translate="no" data-testid="access-map-legend-trust">
          访问口径：{accessMapTrustLabel(meta.access.trust)}
        </span>
        <span className="notranslate" translate="no" data-testid="access-map-legend-window">
          统计窗口：{meta.window.startIso} ~ {meta.window.endIso}
        </span>
      </div>
    </div>
  );
}
