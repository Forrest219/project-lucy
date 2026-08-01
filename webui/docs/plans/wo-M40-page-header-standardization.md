# WO-M40 PageHeader Standardization

| 元数据 | 内容 |
|---|---|
| 工单号 | M40 |
| 标题 | PageHeader 全站标准化 |
| 来源 Spec | `webui/docs/42-page-header-standardization-spec.md` |
| 撰写日期 | 2026-08-01 |
| 适用范围 | `webui/src/components/PageHeader.tsx`、`webui/src/app/app.css`、13 个一级根页面（其中 Catalog 顺手改 title）+ 5 个详情页文件 / 7 个 PageHeader 调用点 + 1 个系统概览 badges 收敛 |
| 关联 Spec | `webui/docs/19-system-overview-runtime-monitoring-spec.md`、`webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`、`webui/docs/39-data-agent-ops-platform-global-ux-spec.md` |
| 关联澄清 | `webui/docs/plans/wo-M40-page-header-standardization-clarification.md`（Q1-Q16） |

## 目标

按 SPEC 改造 PageHeader 组件与全站调用点，消除卡片化、字体重叠、重复面包屑、badges 挤压标题等问题。顺手把 `Catalog.tsx` 的 PageHeader title 从已弃用别名 `"语义维护工作台"` 改为 `"表目录"`。

## 任务清单

- [x] **T1** 改 PageHeader 组件 API：新增 `backAction`，删除 `pl-page-header-cell--empty` 占位，统一网格
- [ ] **T2** 改 `app.css` 中 `.pl-page-header*` 类：去除卡片外框，新增轻量分隔；标题改为 `text-[16px] font-semibold leading-6`；string title 容器可 `truncate` + `title` 兜底（ReactNode title 不动）
- [ ] **T3** 一级根页面 13 处删除 `breadcrumbs`（详见 SPEC §5.1；Catalog.tsx 顺手改 title 为 `"表目录"`）
- [ ] **T4** 详情页 5 文件 / 7 调用点改 `backAction`（详见 SPEC §5.2 与 clarification Q16）；同时删除各页面原 actions 中的返回按钮
- [ ] **T5** Onboarding badges 收敛（≤ 4）+ `活跃 Token` 下沉到 `pl-page-intro`；PR 附 `/overview` 截图
- [ ] **T6** 更新测试（`app-shell.test.tsx` 整体重生成 snapshot + 新增 `page-header.test.tsx`）
- [ ] **T7** tsc / test / lint / build 四件套绿
- [ ] **T8** 视觉验证 1440px / 1366px（路由路径以 `App.tsx` 实际定义为准，含 `/` 而非 `/semantic`）

## 验收口径

详见 SPEC §6。

## 风险与边界

详见 SPEC §8。

## Backout

按 SPEC §12 走 PR revert 或局部 `git checkout <merge-parent-sha> --` 路径，**不依赖 M39 tag/branch**。