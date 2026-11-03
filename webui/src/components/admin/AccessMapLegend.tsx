/**
 * Lucy v0.25 P1-3 — 访问关系图图例。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md` §7.4 / §9
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` §2.3 / §5.3
 * 呈现修订: `docs/specs/lucy-20261101-access-map-chart-first-spec.md` §5.3 / §5.4
 *
 * 图例拆成两半：
 *
 *   `AccessMapLegend`      —— **短行**，四项线型释义，紧贴图区正上方。
 *   `AccessMapLegendMeta`  —— 访问口径与统计窗口 ISO，搬进图下弱入口。
 *
 * 短行只回答「图上每种线是什么意思」，不再重复「这是哪个时间窗、哪个信任口径」：
 * 那两句是元信息，占着图正上方的位置会把读者第一眼要看的线型说明挤下去。
 *
 * 四项与 §5.3 的着色表一一对应：
 * 授权流带（`series/grant`）、访问内核（`series/access`）、
 * 需复核（warning 虚线）、确凿越权（danger 实线）。
 * 僵尸授权的流带与正常授权同色，状态由卡片上的「僵尸授权」文字承担，
 * 所以图例里**不再**有「警示描边 = 需复核 / 确凿越权」这种合并项。
 */
import { accessMapTrustLabel, type AccessMapMeta } from "./AccessMapTypes";

export type AccessMapLegendMetaProps = {
  meta: AccessMapMeta;
};

/**
 * 图例短行（chart-first Spec §5.3）。
 *
 * 直接子节点**恰好四项** —— 它是图正上方的一行说明，不是容器：
 * 多一层包裹元素会让人把「短行」误当成一整块面板。
 */
export function AccessMapLegend() {
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
 *
 * 访问口径标签与统计窗口 ISO 从短行挪进弱入口「口径与快照」，
 * 与口径全文、覆盖率、快照 id 放在同一处折叠。
 */
export function AccessMapLegendMeta({ meta }: AccessMapLegendMetaProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted">
      <span className="notranslate" translate="no" data-testid="access-map-legend-trust">
        问询计入：{accessMapTrustLabel(meta.access.trust)}
      </span>
      <span className="notranslate" translate="no" data-testid="access-map-legend-window">
        统计窗口：{meta.window.startIso} ~ {meta.window.endIso}
      </span>
    </div>
  );
}
