/**
 * Lucy v0.25 P1-2 — 授权摘要首屏一句话与降级提示。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §1.1（成功目标 1）、
 *     §2.1（状态）、§2.2（计数口径）、§6（一致性与降级）、§7（Design System）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B2、B7）
 *
 * 两条硬规则：
 *
 *  1. **不可用时不说数字。** 状态为 `unavailable` 时本组件只渲染降级说明，绝不渲染
 *     「0 张表」——那会把「读不到」说成「没有权限」（Spec §6）。
 *  2. **分母不可证明时不填 0。** `enabledTableCount` 为 `null` 时写「启用表总数暂不可用」，
 *     不写 0，也不写百分比。
 */
import type { AuthorizationSummary } from "./AuthorizationTypes";

/** 中文口径 → 内部原因码。未知原因码原样显示，不吞掉。 */
const PROBLEM_LABELS: Record<string, string> = {
  access_unreadable: "授权配置读不到",
  access_invalid: "授权配置无法解析",
  access_config_path_mismatch: "授权配置路径与管理台读取路径不一致"
};

function problemLabel(problem: string | null): string {
  if (!problem) return "授权配置当前不可用";
  return PROBLEM_LABELS[problem] ?? problem;
}

export function AuthorizationHeadline({ summary }: { summary: AuthorizationSummary }) {
  const { headline, summaryContext } = summary;
  const unavailable = summaryContext.state === "unavailable";
  const partial = summaryContext.state === "partial";
  const denominatorKnown = headline.enabledTableCount !== null;
  const subjectLabel = summaryContext.subject.kind === "agent" ? "Agent" : "Role";

  return (
    <div className="grid gap-2" data-testid="authorization-headline">
      {summaryContext.candidateOnly ? (
        <p
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[13px] text-amber-900"
          data-testid="authorization-candidate-notice"
        >
          候选预览，尚未生效。该摘要来自内存中的草稿，未写入配置。
        </p>
      ) : null}

      {unavailable ? (
        <p className="text-[13px]" data-testid="authorization-headline-unavailable">
          授权摘要当前不可用：{problemLabel(summaryContext.problem)}。
          <span className="ml-1 text-fg-muted">
            这不代表该主体没有权限，只代表当前读不到可证明的授权结果。
          </span>
        </p>
      ) : (
        <p className="text-sm" data-testid="authorization-headline-text">
          <span className="notranslate" translate="no">
            {subjectLabel}
          </span>
          {` 可读 ${headline.connectionCount} 个连接、`}
          {denominatorKnown
            ? `${headline.enabledTableCount} 张表中的 ${headline.tableCount} 张`
            : `${headline.tableCount} 张表；启用表总数暂不可用`}
          {`；授权路径 ${headline.grantPathCount} 条。`}
        </p>
      )}

      {!unavailable && headline.scopedTableCount !== null ? (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-scoped-count">
          {`其中 ${headline.scopedTableCount} 张表有行约束（`}
          {headline.scopedTableCountBasis === "final_rows" ? "最终行约束" : "有效行授予"}
          {`）。`}
        </p>
      ) : null}

      {!unavailable && headline.scopedTableCount === null ? (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-scoped-unknown">
          受限表数暂不可用：最终行约束未合成，不能推断哪些表受行限制。
        </p>
      ) : null}

      {!unavailable && !denominatorKnown ? (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-denominator-unknown">
          {`启用表分母未知（${headline.enabledTableDenominatorUnavailableReason ?? "目录不可用"}），只展示可确定的分子。`}
        </p>
      ) : null}

      {partial ? (
        <div
          className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-[13px] text-amber-900"
          data-testid="authorization-partial-notice"
        >
          <p>部分角色解析失败，以下是已解析集合，不等于完整授权。</p>
          <ul className="mt-1 list-disc pl-5">
            {summaryContext.failures.map((failure) => (
              <li key={failure.subjectId}>
                <span className="notranslate" translate="no">
                  {failure.subjectId}
                </span>
                {`：${failure.reason}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {summary.diagnostics.length > 0 ? (
        <ul className="grid gap-1 text-[13px] text-fg-muted" data-testid="authorization-diagnostics">
          {summary.diagnostics.map((diagnostic) => (
            <li key={diagnostic.code}>
              <span className="notranslate" translate="no">
                {diagnostic.code}
              </span>
              {`：${diagnostic.detail}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
