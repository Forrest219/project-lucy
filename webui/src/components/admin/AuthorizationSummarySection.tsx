/**
 * Lucy v0.25 P1-2 — 可复用的授权摘要区块（无页面外壳）。
 *
 * Authority:
 *   - docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md §4.1（Agent 详情与编辑）、
 *     §4.2（Role 详情与编辑）、§7（Design System）
 *
 * 「页面」组件 `pages/admin/AuthorizationSummary.tsx` 是**薄壳**：只带 `PageHeader`，
 * 取数与渲染都复用本组件——独立路由 `/admin/authorization-summary?kind=agent&id=<userId>`
 * 因此与内嵌场景共用**同一份**取数与 loading/error 表达，不会出现两套实现漂移。
 * 本组件供**三类**场景复用：
 *
 *   - Agent 详情页「权限预览」首屏（§4.1：授权摘要 → 资源卡片 → 工具分组 → 行边界 → 技术详情）；
 *   - Role 详情页「概览」（§4.2：显示当前 Role 授权摘要）；
 *   - 独立路由 `/admin/authorization-summary`（不进侧栏导航，仅 URL 可达）——「受影响
 *     Agent」列表链接到各自的摘要时，指向的就是这个路由。
 *
 * 只读投影：它读服务端算好的摘要，不在浏览器里拼装权限、不写配置。
 * 读取失败不改变宿主页面的基本身份与保存错误表达（Spec §4.3）。
 */
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../lib/apiClient";
import { AuthorizationSummaryPanel } from "./AuthorizationSummaryPanel";
import type { AuthorizationSummary, AuthorizationSubjectKind } from "./AuthorizationTypes";

type SummaryResponse = {
  summary: AuthorizationSummary;
  candidateDigest: string | null;
};

export function AuthorizationSummarySection(props: {
  kind: AuthorizationSubjectKind;
  id: string;
  /** Section heading. Omit to render the panel alone. */
  title?: string;
  testId?: string;
}) {
  const { kind, id, title, testId } = props;
  const query = useQuery({
    queryKey: ["admin", "authorization-summary", kind, id],
    queryFn: () =>
      apiGet<SummaryResponse>(
        `/api/admin/authorization-summary/${kind}/${encodeURIComponent(id)}`
      ),
    enabled: Boolean(id)
  });
  const summary = query.data?.summary;

  return (
    <section className="grid gap-3" data-testid={testId}>
      {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
      {query.isPending ? (
        <p className="text-[13px] text-fg-muted" data-testid="authorization-summary-loading">
          正在读取授权摘要…
        </p>
      ) : null}
      {query.isError ? (
        <p className="text-[13px]" data-testid="authorization-summary-error">
          授权摘要读取失败：{query.error instanceof Error ? query.error.message : String(query.error)}
        </p>
      ) : null}
      {summary ? <AuthorizationSummaryPanel summary={summary} /> : null}
    </section>
  );
}

export default AuthorizationSummarySection;
