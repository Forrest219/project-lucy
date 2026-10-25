/**
 * Lucy v0.25 P1-3 — 访问关系图顶部信号条。
 *
 * Authority: `webui/docs/187-access-relation-sankey-spec.md`
 *   §4.9  越权信号的可信度边界（两档措辞 + 快照覆盖率披露）
 *   §7.4  顶部信号条「僵尸授权 N 条 · 需复核 M 条 · 确凿越权 K 条」
 *   §10   SC-13 覆盖率披露；低覆盖率不得解释为低越权率
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
import {
  ACCESS_MAP_CONFIRMED_TIER_SOURCE,
  ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE,
  accessMapCoverageText,
  type AccessMapMeta,
  type AccessMapResponse
} from "./AccessMapTypes";

export type AccessMapSignalFilter = "dormant" | "needs_review" | "confirmed_unauthorized";

export type AccessMapSignalBarProps = {
  meta: AccessMapMeta;
  response: AccessMapResponse;
  activeFilters: AccessMapSignalFilter[];
  onToggleFilter: (filter: AccessMapSignalFilter) => void;
};

export function AccessMapSignalBar({
  meta,
  response,
  activeFilters,
  onToggleFilter
}: AccessMapSignalBarProps) {
  const toggle = (filter: AccessMapSignalFilter): void => onToggleFilter(filter);

  return (
    <div className="flex flex-col gap-2" data-testid="access-map-signal-bar">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className={`pl-btn pl-btn--ghost text-xs ${activeFilters.includes("dormant") ? "pl-btn--primary" : ""}`}
          aria-pressed={activeFilters.includes("dormant")}
          data-testid="access-map-signal-dormant"
          onClick={() => toggle("dormant")}
        >
          僵尸授权 {meta.signals.dormantEdges} 条
        </button>
        <button
          type="button"
          className={`pl-btn pl-btn--ghost text-xs ${activeFilters.includes("needs_review") ? "pl-btn--primary" : ""}`}
          aria-pressed={activeFilters.includes("needs_review")}
          data-testid="access-map-signal-needs-review"
          onClick={() => toggle("needs_review")}
        >
          需复核 {meta.signals.needsReviewEdges} 条
        </button>
        {/*
          第一档的档位说明（§4.9.2）：**不含「越权」二字**。
          「访问了但当前无授权路径」首先意味着需要复核，不必然等于越权。
        */}
        <span className="text-xs text-fg-muted" data-testid="access-map-signal-needs-review-note">
          {ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE}
        </span>
        <button
          type="button"
          className={`pl-btn pl-btn--ghost text-xs ${activeFilters.includes("confirmed_unauthorized") ? "pl-btn--primary" : ""}`}
          aria-pressed={activeFilters.includes("confirmed_unauthorized")}
          data-testid="access-map-signal-confirmed"
          onClick={() => toggle("confirmed_unauthorized")}
        >
          确凿越权 {meta.signals.confirmedUnauthorizedEdges} 条
        </button>
        {/*
          第二档的**来源标注**（§4.9.2 / SC-10）：结论来自调用当时的授权快照，
          不是当前授权。必须单独标出来源，否则两档会被读成同一种证据强度。
        */}
        <span className="text-xs text-fg-muted" data-testid="access-map-signal-confirmed-source">
          {ACCESS_MAP_CONFIRMED_TIER_SOURCE}
        </span>
        {/*
          访问面不可用时**不得用 0 冒充真实计数**（P1-3 §5.5 / SC-07）。
          服务端只在 `access.state === "ok"` 分支里赋值 `rawCalls` / `deniedCalls`，
          不可用时它们停在 0；写出来就是「原始调用数 0 次」，把「读不到」说成
          「没有发生过」。所以降级态写「暂不可用」。
        */}
        <span
          className="text-xs text-fg-muted"
          data-testid="access-map-signal-calls"
          data-access-state={meta.access.state}
        >
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
        </span>
      </div>

      <div className="text-xs text-fg-muted" data-testid="access-map-snapshot-coverage">
        {accessMapCoverageText(meta.snapshotCoverage)}
        <span className="ml-1 text-warning-strong">
          快照覆盖率低不代表越权率低：缺失或无效的快照只能保留「需复核」，不会判为确凿越权。
        </span>
      </div>

      {meta.orphanGrants > 0 ? (
        <div className="text-xs text-fg-muted" data-testid="access-map-orphan-grants">
          已授权但连接未启用该表：{meta.orphanGrants} 张（不进入图面，属配置漂移信号）
        </div>
      ) : null}
    </div>
  );
}
