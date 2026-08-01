import { isValidElement, type ReactNode } from "react";

export type PageHeaderProps = {
  /**
   * H1 标题，左下区域。
   */
  title: ReactNode;
  /**
   * 面包屑路径，左上区域。从首段到当前页逐级渲染。
   *
   * 当 `backAction` 存在时整条面包屑被抑制；当 `title` 是字符串且与
   * `breadcrumbs` 末项同名时也整条抑制（避免重复标题）。
   */
  breadcrumbs?: string[];
  /**
   * 业务说明文案，渲染在 H1 下方，统一 `text-[13px]`。
   */
  description?: ReactNode;
  /**
   * 右上区域：状态徽章（项目路径 / 连接数 / KTX 状态等）。
   * 渲染为一组圆角胶囊，与全站 token 保持一致。推荐 ≤ 4；超出由调用方下沉。
   */
  badges?: ReactNode;
  /**
   * 右下区域：页面级主操作按钮（跳转 / 触发 / 复制等）。
   */
  actions?: ReactNode;
  /**
   * 可选的返回入口，渲染在标题上方左侧；存在时抑制 `breadcrumbs`。
   * 由调用方提供 ReactNode（通常为 `<Link>` 或 `<button>`）。
   */
  backAction?: ReactNode;
};

/**
 * 全站统一的页面级 PageHeader。
 *
 * 设计目标：
 * 1. 单一来源：消除全局 topbar + 内层 section-heading 同时渲染 H1/分类名的视觉冗余。
 * 2. 视觉一致：所有路由页面（connections / semantic / eval / admin）共用同一布局。
 * 3. 自然顶部：仅保留轻量 `border-b` 分隔，不再是卡片。
 *
 * 渲染优先级：
 *   backAction > breadcrumbs（同名抑制后）> 单独 title
 */
export function PageHeader({
  title,
  breadcrumbs,
  description,
  badges,
  actions,
  backAction
}: PageHeaderProps) {
  const isStringTitle = typeof title === "string";
  const trimmedBreadcrumbs =
    breadcrumbs && breadcrumbs.length > 0
      ? isStringTitle && breadcrumbs[breadcrumbs.length - 1] === title
        ? undefined
        : breadcrumbs
      : undefined;
  const showBackAction = Boolean(backAction);
  const showBreadcrumbs = !showBackAction && Boolean(trimmedBreadcrumbs && trimmedBreadcrumbs.length > 0);
  const showBadges = Boolean(badges);
  const showActions = Boolean(actions);
  const showDescription = Boolean(description);

  const titleAttr = isStringTitle ? (title as string) : undefined;

  return (
    <header className="pl-page-header" data-testid="page-header">
      <div className="pl-page-header-grid">
        <div className="pl-page-header-cell pl-page-header-cell--primary">
          {showBackAction ? (
            <div className="pl-page-header-back-wrap">{backAction}</div>
          ) : showBreadcrumbs ? (
            <nav className="pl-page-header-breadcrumbs-nav" aria-label="面包屑">
              <ol className="pl-page-header-breadcrumbs">
                {trimmedBreadcrumbs!.map((item, index) => (
                  <li
                    key={`${index}-${item}`}
                    className="pl-page-header-breadcrumb-item"
                  >
                    {index > 0 ? (
                      <span className="pl-page-header-breadcrumb-sep" aria-hidden>
                        /
                      </span>
                    ) : null}
                    <span>{item}</span>
                  </li>
                ))}
              </ol>
            </nav>
          ) : null}
          <h1
            className="pl-page-header-title"
            title={titleAttr}
            {...(isStringTitle ? { "data-truncate": "true" } : {})}
          >
            {isValidElement(title) || !isStringTitle
              ? title
              : <span className="pl-page-header-title-text">{title}</span>}
          </h1>
          {showDescription ? (
            <div className="pl-page-header-description">{description}</div>
          ) : null}
        </div>

        {(showBadges || showActions) ? (
          <div className="pl-page-header-cell pl-page-header-cell--aside">
            {showBadges ? (
              <div
                className="pl-page-header-badges"
                aria-label="页面上下文"
                data-testid="page-header-badges"
              >
                {badges}
              </div>
            ) : null}
            {showActions ? (
              <div
                className="pl-page-header-actions"
                aria-label="页面操作"
                data-testid="page-header-actions"
              >
                {actions}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}