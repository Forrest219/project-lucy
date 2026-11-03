/**
 * Lucy v0.25 P1-2 — 授权摘要只读页面（独立路由）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4（页面与 API 合同）、
 *     §4.1、§4.3、§7（Design System）、§8（ASV-14）
 *   - docs/plans/2026-10-25-lucy-v0.25-p1-implementation-plan.md §5（B6、B7）
 *
 * 页面是**只读投影**：它读服务端算好的摘要，不在浏览器里拼装权限、不写配置、
 * 不发起任何受控试调。
 *
 * ─── 路由 ──────────────────────────────────────────────────────────────────
 *
 * 本页挂在 **`/admin/authorization-summary`**（由 `webui/src/app/App.tsx` 注册的
 * lazy route）。它**不在侧栏导航里** —— 它是深链落点，不是导航入口。
 *
 *   /admin/authorization-summary?kind=agent&id=<userId>   → 某个 Agent 的摘要
 *   /admin/authorization-summary?kind=role&id=<roleId>    → 某个 Role 的摘要
 *
 * §4.2 的「使用情况区另列受影响 Agent 并链接各自摘要」指向的就是这条路由。
 *
 * 本页同时支持被内嵌（传 `kind` / `id`）：
 *
 *   <AuthorizationSummaryPage />                                  → 读 URL 查询参数
 *   <AuthorizationSummaryPage kind="agent" id="<userId>" />       → Agent 详情页内嵌
 *   <AuthorizationSummaryPage kind="role" id="<roleId>" />        → Role 详情页内嵌
 *
 * ─── 与 Section 的分工（去重） ─────────────────────────────────────────────
 *
 * **取数、loading 与 error 只有一份实现**：在
 * `components/admin/AuthorizationSummarySection.tsx`。本页只负责「路由外壳」
 * （PageHeader + 解析 kind/id），然后复用 Section。
 *
 * 之前两处各写了一遍 `useQuery`、同一套 `data-testid`
 * （`authorization-summary-loading` / `authorization-summary-error`）与同一份
 * 面板渲染，任何一处改文案都会让另一处漂移。现在只有一处。
 */
import { useParams, useSearchParams } from "react-router-dom";
import { PageHeader } from "../../components/PageHeader";
import { AuthorizationSummarySection } from "../../components/admin/AuthorizationSummarySection";
import type { AuthorizationSubjectKind } from "../../components/admin/AuthorizationTypes";

export function AuthorizationSummaryPage(props: {
  kind?: AuthorizationSubjectKind;
  id?: string;
} = {}) {
  const [searchParams] = useSearchParams();
  const params = useParams<{ userId?: string; roleId?: string }>();

  const kind: AuthorizationSubjectKind =
    props.kind ??
    (params.roleId ? "role" : params.userId ? "agent" : searchParams.get("kind") === "role" ? "role" : "agent");
  const id = props.id ?? params.userId ?? params.roleId ?? searchParams.get("id") ?? "";

  return (
    <div className="grid gap-4">
      <PageHeader
        title="授权摘要"
        description="说清该主体可以访问哪些表、使用哪些工具、行边界是什么。"
      />
      {id ? (
        <AuthorizationSummarySection kind={kind} id={id} />
      ) : (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-summary-missing-id">
          缺少查询参数：请在地址里带上{" "}
          <span className="notranslate" translate="no">
            kind
          </span>
          {" 与 "}
          <span className="notranslate" translate="no">
            id
          </span>
          {"。"}
        </p>
      )}
    </div>
  );
}

export default AuthorizationSummaryPage;
