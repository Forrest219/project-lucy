# WO-M40 PageHeader Standardization — IMPLEMENTATION_NOTES

| 元数据 | 内容 |
|---|---|
| 工单号 | M40 |
| 标题 | PageHeader 全站标准化 |
| 提交人 | Mulan 特工队 |
| 撰写日期 | 2026-08-01 |
| 关联 Spec | `webui/docs/42-page-header-standardization-spec.md` |
| 关联 Plan | `webui/docs/plans/wo-M40-page-header-standardization.md` |
| 关联 Clarification | `webui/docs/plans/wo-M40-page-header-standardization-clarification.md` |

## 完成情况

T1-T8 全部完成。

### 关键改动

**组件层**

- `webui/src/components/PageHeader.tsx`：新增 `backAction?: ReactNode` prop；移除 `pl-page-header-cell--empty` 占位；网格改为 `grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto]`；同名抑制仅对 `typeof title === "string"` 启用；string title 容器加 `data-truncate` + `title` 属性兜底。
- `webui/src/app/app.css`：`.pl-page-header` 移除 `rounded-lg border bg-bg-surface shadow-card p-4`，改为 `border-b border-border-default pb-3 mb-4`；标题改为 `text-[16px] font-semibold leading-6`；移除 4 象限 `grid-template-areas` 残留；新增 `.pl-page-header-back`；保留 `.pl-page-header-actions--stacked`（Onboarding 用）。

**调用层**

- 13 个一级根页面删除 `breadcrumbs`：
  - `webui/src/pages/connections/ConnectionOverview.tsx`
  - `webui/src/pages/connections/TableWhitelist.tsx`
  - `webui/src/pages/connections/ConnectionTest.tsx`
  - `webui/src/pages/Catalog.tsx`（顺手把 title 从已弃用别名 `"语义维护工作台"` 改为 `"表目录"`）
  - `webui/src/pages/publish/PublishWorkbench.tsx`
  - `webui/src/pages/publish/PublishHistory.tsx`
  - `webui/src/pages/eval/CaseList.tsx`（2 处：loading + normal）
  - `webui/src/pages/eval/RunList.tsx`
  - `webui/src/pages/eval/Monitor.tsx`
  - `webui/src/pages/admin/AgentList.tsx`
  - `webui/src/pages/admin/RoleList.tsx`
  - `webui/src/pages/admin/ConfigAudit.tsx`
  - `webui/src/pages/admin/Audit.tsx`（log 分支删除；heatmap 子分支保留 `["访问治理", "访问日志", "数据热力"]`）
- 5 个详情页文件 / 7 个调用点改 `backAction`（同时删除原 actions 中的"返回"按钮）：
  - `webui/src/pages/eval/RunDetail.tsx`（1 处）
  - `webui/src/pages/eval/CaseEditor.tsx`（1 处）
  - `webui/src/pages/admin/RoleDetail.tsx`（1 处）
  - `webui/src/pages/admin/AgentDetail.tsx`（1 处）
  - `webui/src/pages/admin/NewToken.tsx`（3 处；新增 `Link` 导入）

**Onboarding 收敛**

- `webui/src/pages/Onboarding.tsx`：badges 从 5 个收敛到 4 个（`活跃 Token` 下沉到 `pl-page-intro` meta 行）。

**测试**

- 新增 `webui/src/__tests__/page-header.test.tsx`：8 个用例覆盖 backAction / breadcrumbs / 同名抑制 / ReactNode 旁路 / grid / data-truncate / description / badges+actions。
- 更新 5 个页面级测试断言（"访问治理" / "质量评测" / "访问日志" 文本断言改为"无面包屑 nav" 断言）：
  - `webui/src/__tests__/audit.test.tsx`
  - `webui/src/__tests__/admin-config-audit.test.tsx`
  - `webui/src/__tests__/eval-cases.test.tsx`
  - `webui/src/__tests__/role-list.test.tsx`
  - `webui/src/__tests__/agent-list.test.tsx`

### 验证结果

| 项 | 结果 |
|---|---|
| `cd webui && npx tsc --noEmit` | ✅ 通过 |
| `cd webui && npx vitest run` | ✅ 74 个测试文件 / 755 个用例 全绿 |
| `cd webui && npm run lint:terminology` | ✅ 207 文件扫描通过 |
| `cd webui && npm run build` | ✅ vite build 通过，dist 生成 849.33 kB / 164.40 kB CSS |
| 视觉结构快查（root 无卡片、无面包屑；backAction 抑制；string title truncate + title 兜底） | ✅ 3 项全绿 |
| Dev server 启动 (`npm run dev` + curl `/`) | ✅ HTML 正常返回 |

### 边界与限制

- **真实浏览器 1440 / 1366 视觉验证未在本会话执行**：本会话无浏览器交互能力，T8 仅完成结构性快查。人类验收请在本地起 `npm run dev`，按 SPEC §6.4 路径检查：
  - `/overview`、`/connections`、`/connections/whitelist`、`/connections/test`、`/`（Catalog）、`/publish/workbench`、`/publish/history`、`/eval/cases`、`/eval/runs`、`/eval/monitor`、`/admin/agents`、`/admin/roles`、`/admin/audit`、`/admin/config-audit`
  - 详情页：`/admin/agents/:userId`、`/admin/roles/:roleId`、`/eval/cases/:domain/:caseId`、`/eval/runs/:runId`
- **工作目录中已存在的无关改动**（不在本工单范围）：
  - `webui/src/lib/opsDashboard.ts`
  - `webui/src/__tests__/onboarding.test.tsx`
  - `webui/src/__tests__/ops-dashboard.test.ts`
  - `webui/scripts/screenshot-overview.mjs`
  - 这些文件已被另一条工作线（可能是 Onboarding action queue 改造）触碰，未在本工单范围内处理；建议：
    - 提交前请人类 reviewer 决定是 `git stash` / 单独提交 / 留在工作区
    - 不要与本工单合并到同一个 commit

### Backout

按 SPEC §12 走：

```bash
# 整体回滚
git revert -m 1 <merge-sha>

# 或仅回滚组件 + CSS
git checkout <merge-parent-sha> -- \
  webui/src/components/PageHeader.tsx \
  webui/src/app/app.css \
  webui/src/__tests__/page-header.test.tsx
```

调用方单独 `git revert` 涉及 `breadcrumbs` / `backAction` 删除或新增的页面文件即可。

## 任务清单状态

- [x] **T1** 改 PageHeader 组件 API：新增 `backAction`，删除 `pl-page-header-cell--empty` 占位，统一网格
- [x] **T2** 改 `app.css` 中 `.pl-page-header*` 类：去除卡片外框，新增轻量分隔；标题改为 `text-[16px] font-semibold leading-6`；string title 容器可 `truncate` + `title` 兜底（ReactNode title 不动）
- [x] **T3** 一级根页面 13 处删除 `breadcrumbs`（Catalog.tsx 顺手改 title 为 `"表目录"`）
- [x] **T4** 详情页 5 文件 / 7 调用点改 `backAction`；同时删除各页面原 actions 中的返回按钮
- [x] **T5** Onboarding badges 收敛（≤ 4）+ `活跃 Token` 下沉到 `pl-page-intro`
- [x] **T6** 更新测试（`app-shell.test.tsx` + 5 个页面级测试更新 + 新增 `page-header.test.tsx`）
- [x] **T7** tsc / test / lint / build 四件套绿
- [x] **T8** 视觉结构快查（root 无卡片、无面包屑；backAction 抑制；string title truncate + title 兜底）+ Dev server 启动验证（无浏览器环境的真实像素验证待人类验收）