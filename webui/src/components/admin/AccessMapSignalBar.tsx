/**
 * Lucy v0.25 P1-3 — 访问关系图的三张指标卡与口径说明。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.9  越权信号的可信度边界（两档措辞 + 快照覆盖率披露）
 *   §7.4  顶部信号条「僵尸授权 N 条 · 需复核 M 条 · 确凿越权 K 条」
 *   §10   SC-13 覆盖率披露；低覆盖率不得解释为低越权率
 *
 * 呈现修订: `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`
 *   §5.2  三枚信号改为共享 Metric Card；卡壳与 ⓘ 是兄弟按钮
 *   §5.1  口径与快照离开首屏，落到默认关闭的折叠区
 *
 * 「需复核」与「确凿越权」是两档，措辞不同、结论强度不同。
 * 本组件是这两个词在 UI 上的唯一定义处：第一档一律不含「越权」二字。
 *
 * ─── 翻译防御的刻意取舍（术语标准 §2.6） ──────────────────────────────
 *
 * 访问关系图里凡是承载**标识**的 DOM（节点标签、边端点、Agent／Role／连接／表名）
 * 都必须 `translate="no"` + `notranslate`。
 *
 * `pages/admin/AccessMap.tsx` 顶部的**自由文本搜索框**是一个需要说明的混合输入：
 * 它的 placeholder 与 aria-label 里是受保护术语（Agent／角色／表名），而用户实际
 * 键入的是任意文本（可能只是一个表名片段，也可能是中文备注）。给整个输入框加
 * `translate="no"` + `notranslate` 是为了保护**框本身的标签**，它**不**承诺保护
 * 用户输入的值。此处记录该取舍，避免以后有人以「自由文本不算标识」为由把它删掉，
 * 也避免有人误以为它能保护输入内容。
 */
import { MetricCard } from "../MetricCard";
import {
  ACCESS_MAP_CONFIRMED_TIER_SOURCE,
  ACCESS_MAP_DORMANT_TIER_NOTE,
  ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE,
  accessMapCoverageText,
  type AccessMapMeta
} from "./AccessMapTypes";

export type AccessMapSignalFilter = "dormant" | "needs_review" | "confirmed_unauthorized";

export type AccessMapSignalBarProps = {
  meta: AccessMapMeta;
  activeFilters: AccessMapSignalFilter[];
  onToggleFilter: (filter: AccessMapSignalFilter) => void;
};

export type AccessMapSignalNotesProps = {
  meta: AccessMapMeta;
};

/**
 * 三张指标卡（呈现修订 Spec §5.2）。
 *
 * 卡壳是**筛选按钮**（`aria-pressed` + 既有 test id 都在按钮上），ⓘ 是它的**兄弟**
 * 按钮而不是被嵌进按钮里 —— 嵌套按钮是非法的 HTML，而且会让读者点 ⓘ 时误触发筛选。
 *
 * tone 规则：主值为 0 时保持中性；僵尸授权 / 需复核大于 0 用 warning，
 * 确凿越权大于 0 用 danger。**不用** `pl-btn--primary` 表示选中。
 *
 * 三张卡逐张写开（不 map 数组）：筛选按钮上的 test id 必须以字面量出现在源码里，
 * 否则选择器契约的静态扫描认不出它，契约表会出现孤儿登记。
 */
export function AccessMapSignalBar({
  meta,
  activeFilters,
  onToggleFilter
}: AccessMapSignalBarProps) {
  const dormantPressed = activeFilters.includes("dormant");
  const needsReviewPressed = activeFilters.includes("needs_review");
  const confirmedPressed = activeFilters.includes("confirmed_unauthorized");

  const filterButtonClass =
    "rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

  return (
    <div className="pl-metric-grid pl-metric-grid--three gap-3" data-testid="access-map-signal-bar">
      <MetricCard
        label={
          <button
            type="button"
            className={filterButtonClass}
            aria-pressed={dormantPressed}
            data-testid="access-map-signal-dormant"
            onClick={() => onToggleFilter("dormant")}
          >
            僵尸授权
          </button>
        }
        labelText="僵尸授权"
        value={meta.signals.dormantEdges}
        help={ACCESS_MAP_DORMANT_TIER_NOTE}
        subValue={dormantPressed ? "正在筛选" : "未筛选"}
        tone={meta.signals.dormantEdges > 0 ? "warning" : undefined}
        helpId="access-map-dormant"
      />
      <MetricCard
        label={
          <button
            type="button"
            className={filterButtonClass}
            aria-pressed={needsReviewPressed}
            data-testid="access-map-signal-needs-review"
            onClick={() => onToggleFilter("needs_review")}
          >
            需复核
          </button>
        }
        labelText="需复核"
        value={meta.signals.needsReviewEdges}
        help={ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE}
        subValue={needsReviewPressed ? "正在筛选" : "未筛选"}
        tone={meta.signals.needsReviewEdges > 0 ? "warning" : undefined}
        helpId="access-map-needs-review"
      />
      <MetricCard
        label={
          <button
            type="button"
            className={filterButtonClass}
            aria-pressed={confirmedPressed}
            data-testid="access-map-signal-confirmed"
            onClick={() => onToggleFilter("confirmed_unauthorized")}
          >
            确凿越权
          </button>
        }
        labelText="确凿越权"
        value={meta.signals.confirmedUnauthorizedEdges}
        help={ACCESS_MAP_CONFIRMED_TIER_SOURCE}
        subValue={confirmedPressed ? "正在筛选" : "未筛选"}
        tone={meta.signals.confirmedUnauthorizedEdges > 0 ? "danger" : undefined}
        helpId="access-map-confirmed"
      />
    </div>
  );
}

/**
 * 口径说明（呈现修订 Spec §5.1「折叠（默认关）」）。
 *
 * 这些句子解释的是「这几个数字怎么来的」，不是首屏要回答的问题，
 * 所以离开标题行、落进默认关闭的折叠区。**文案一个字都不改**：
 * test id 与可见文字都保持原样，只是换了位置。
 */
export function AccessMapSignalNotes({ meta }: AccessMapSignalNotesProps) {
  return (
    <div className="flex flex-col gap-2 text-xs text-fg-muted">
      {/*
        第一档的档位说明（§4.9.2）：**不含「越权」二字**。
        「访问了但当前无授权路径」首先意味着需要复核，不必然等于越权。
      */}
      <p data-testid="access-map-signal-needs-review-note">{ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE}</p>
      {/*
        第二档的**来源标注**（§4.9.2 / SC-10）：结论来自调用当时的授权快照，
        不是当前授权。必须单独标出来源，否则两档会被读成同一种证据强度。
      */}
      <p data-testid="access-map-signal-confirmed-source">{ACCESS_MAP_CONFIRMED_TIER_SOURCE}</p>
      <p data-testid="access-map-snapshot-coverage">
        {accessMapCoverageText(meta.snapshotCoverage)}
        <span className="ml-1 text-warning-strong">
          快照覆盖率低不代表越权率低：缺失或无效的快照只能保留「需复核」，不会判为确凿越权。
        </span>
      </p>
      {/*
        访问面不可用时**不得用 0 冒充真实计数**（P1-3 §5.5 / SC-07）。
        服务端只在 `access.state === "ok"` 分支里赋值 `rawCalls` / `deniedCalls`，
        不可用时它们停在 0；写出来就是「原始调用数 0 次」，把「读不到」说成
        「没有发生过」。所以降级态写「暂不可用」。
      */}
      <p data-testid="access-map-signal-calls" data-access-state={meta.access.state}>
        {meta.access.state === "ok" ? (
          <>
            原始调用数 {meta.access.rawCalls} 次 · 被拒绝的访问尝试 {meta.access.deniedCalls} 次
          </>
        ) : (
          <>
            原始调用数暂不可用 · 被拒绝的访问尝试暂不可用
            {meta.access.reason ? `（${meta.access.reason}）` : ""}
          </>
        )}
      </p>
      {meta.orphanGrants > 0 ? (
        <p data-testid="access-map-orphan-grants">
          已授权但连接未启用该表：{meta.orphanGrants} 张（不进入图面，属配置漂移信号）
        </p>
      ) : null}
      {/*
        守恒说明只出现一次（呈现修订 D7）：Token 不承载授权，不进流主干、不参与守恒。
      */}
      <p className="notranslate" translate="no">Token 不进入流主干、不参与守恒，只承载调用归因。</p>
    </div>
  );
}
