import type { ReactNode } from "react";

export type PageHeaderProps = {
  /**
   * H1 标题，左下区域。
   */
  title: string;
  /**
   * 面包屑路径，左上区域。从首段到当前页逐级渲染。
   */
  breadcrumbs?: string[];
  /**
   * 业务说明文案，渲染在 H1 下方。
   */
  description?: ReactNode;
  /**
   * 右上区域：状态徽章（项目路径 / 连接数 / KTX 状态等）。
   * 渲染为一组圆角胶囊，与全站 token 保持一致。
   */
  badges?: ReactNode;
  /**
   * 右下区域：页面级主操作按钮（跳转 / 触发 / 复制等）。
   */
  actions?: ReactNode;
};

/**
 * 全站统一的页面级 PageHeader。
 *
 * 设计目标：
 * 1. 单一来源：消除全局 topbar + 内层 section-heading 同时渲染 H1/分类名的视觉冗余。
 * 2. 视觉一致：所有路由页面（connections / semantic / eval / admin）共用同一布局。
 *
 * 四象限布局：
 *   ┌──────────────────────────┬──────────────────┐
 *   │ breadcrumbs              │ badges          │
 *   ├──────────────────────────┼──────────────────┤
 *   │ title (H1) + description │ actions         │
 *   └──────────────────────────┴──────────────────┘
 */
export function PageHeader({
  title,
  breadcrumbs,
  description,
  badges,
  actions
}: PageHeaderProps) {
  const hasBreadcrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);
  const hasBadges = Boolean(badges);
  const hasActions = Boolean(actions);
  const hasDescription = Boolean(description);

  return (
    <header className="pl-page-header" data-testid="page-header">
      <div className="pl-page-header-grid">
        {hasBreadcrumbs ? (
          <nav
            className="pl-page-header-cell pl-page-header-cell--breadcrumbs"
            aria-label="面包屑"
          >
            <ol className="pl-page-header-breadcrumbs">
              {breadcrumbs!.map((item, index) => (
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
        ) : (
          <div className="pl-page-header-cell pl-page-header-cell--breadcrumbs pl-page-header-cell--empty" />
        )}

        {hasBadges ? (
          <div
            className="pl-page-header-cell pl-page-header-cell--badges"
            aria-label="页面上下文"
          >
            <div className="pl-page-header-badges">{badges}</div>
          </div>
        ) : (
          <div className="pl-page-header-cell pl-page-header-cell--badges pl-page-header-cell--empty" />
        )}

        <div className="pl-page-header-cell pl-page-header-cell--title">
          <h1 className="pl-page-header-title">{title}</h1>
          {hasDescription ? (
            <div className="pl-page-header-description">{description}</div>
          ) : null}
        </div>

        {hasActions ? (
          <div
            className="pl-page-header-cell pl-page-header-cell--actions"
            aria-label="页面操作"
          >
            <div className="pl-page-header-actions">{actions}</div>
          </div>
        ) : (
          <div className="pl-page-header-cell pl-page-header-cell--actions pl-page-header-cell--empty" />
        )}
      </div>
    </header>
  );
}
