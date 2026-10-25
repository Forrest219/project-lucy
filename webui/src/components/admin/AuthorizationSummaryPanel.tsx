/**
 * Lucy v0.25 P1-2 — 授权摘要主面板（Agent 详情与 Role 详情共用）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4.1（Agent 详情「权限预览」）、
 *     §4.2（Role「概览」）、§7（Design System）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B7）
 *
 * 首屏顺序固定：授权摘要 → 资源卡片 → 工具分组 → 行边界说明 → 技术详情（默认折叠）。
 *
 * 三条硬规则：
 *
 *  1. **不可用时不渲染资源卡片。** 状态为 `unavailable` 时只渲染降级说明，绝不渲染
 *     空资源卡或「0 张表」。
 *  2. **候选摘要必须标「候选预览，尚未生效」。**
 *  3. **摘要不能替代 dry-run 或确认 Drawer。** 本面板只读，不提供任何写入口。
 *
 * 「关联页面」区（Spec §4.1／§4.2）：服务端算好的 `actions` 里那三条深链
 * （访问关系图／行权限视图／MCP 调试台）与「受影响 Agent」列表必须**被前端渲染**，
 * 否则摘要就只剩一段文字，读者拿不到下一步入口。链接目标是服务端给的，本组件不拼 URL；
 * 唯一由前端拼的是「受影响 Agent」的摘要路由，它的落点由 App.tsx 挂载。
 */
import { Link } from "react-router-dom";
import { AuthorizationHeadline } from "./AuthorizationHeadline";
import { AuthorizationResourceCard } from "./AuthorizationResourceCard";
import { AuthorizationRowBoundary } from "./AuthorizationRowBoundary";
import { AuthorizationTechnicalDetails } from "./AuthorizationTechnicalDetails";
import { AuthorizationToolGroupsView } from "./AuthorizationToolGroups";
import type { AuthorizationSummary } from "./AuthorizationTypes";

/**
 * 「受影响 Agent」各自的摘要路由。
 *
 * 这条路由由 `webui/src/app/App.tsx` 挂在 `/admin/authorization-summary`（不在侧栏导航里，
 * 只在 URL 可达）。`kind` 只能是 `agent`——服务端 `actions.referencingAgentIds` 给的
 * 就是 Agent ID。
 */
function referencingAgentSummaryUrl(agentId: string): string {
  return `/admin/authorization-summary?kind=agent&id=${encodeURIComponent(agentId)}`;
}

/**
 * 关联页面区。
 *
 * 只在**有链接可给**时渲染：服务端说「这张表没有行约束」时就不出现行权限视图链接，
 * 而不是给一条指向空页面的链接（Spec §4.1「目标页未实施前不得显示可用链接」的同一条原则）。
 */
function AuthorizationRelatedLinks({ summary }: { summary: AuthorizationSummary }) {
  const { actions } = summary;
  const referencingAgentIds = actions.referencingAgentIds ?? [];
  const hasLinks = Boolean(
    actions.accessMapUrl || actions.rowPolicyViewUrl || actions.playgroundUrl
  );
  if (!hasLinks && referencingAgentIds.length === 0) return null;

  return (
    <section className="grid gap-2" data-testid="authorization-related-links">
      <h3 className="text-sm font-medium">关联页面</h3>
      {hasLinks ? (
        <ul className="flex flex-wrap gap-3 text-[13px]">
          {actions.accessMapUrl ? (
            <li>
              <Link
                className="underline"
                to={actions.accessMapUrl}
                data-testid="authorization-access-map-link"
              >
                访问关系图
              </Link>
            </li>
          ) : null}
          {actions.rowPolicyViewUrl ? (
            <li>
              <Link
                className="underline"
                to={actions.rowPolicyViewUrl}
                data-testid="authorization-row-policy-link"
              >
                行权限视图
              </Link>
            </li>
          ) : null}
          {actions.playgroundUrl ? (
            <li>
              <Link
                className="underline"
                to={actions.playgroundUrl}
                data-testid="authorization-playground-deep-link"
              >
                <span className="notranslate" translate="no">
                  MCP
                </span>
                {" 调试台"}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}
      {referencingAgentIds.length > 0 ? (
        <div className="grid gap-1" data-testid="authorization-referencing-agents">
          <span className="text-[13px] text-fg-muted notranslate" translate="no">
            受影响的 Agent
          </span>
          <ul className="flex flex-wrap gap-3 text-[13px]">
            {referencingAgentIds.map((agentId) => (
              <li key={agentId}>
                <Link
                  className="underline notranslate"
                  translate="no"
                  to={referencingAgentSummaryUrl(agentId)}
                  data-testid={`authorization-referencing-agent-${agentId}`}
                >
                  {agentId}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function AuthorizationSummaryPanel({ summary }: { summary: AuthorizationSummary }) {
  const unavailable = summary.summaryContext.state === "unavailable";

  return (
    <section className="grid gap-4" data-testid="authorization-summary-panel">
      <AuthorizationHeadline summary={summary} />
      {unavailable ? null : (
        <>
          <AuthorizationResourceCard summary={summary} />
          <AuthorizationToolGroupsView summary={summary} />
          <AuthorizationRowBoundary summary={summary} />
        </>
      )}
      <AuthorizationRelatedLinks summary={summary} />
      <AuthorizationTechnicalDetails summary={summary} />
    </section>
  );
}
