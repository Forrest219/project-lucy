# PageHeader Standardization — Release Notes

| 元数据 | 内容 |
|---|---|
| 工单号 | M40 |
| 类型 | UX Polish / Frontend |
| 影响面 | 全站（13 个一级根页面 + 5 个详情页文件 / 7 调用点 + 1 个系统概览 badges 收敛） |
| Breaking Change | 无（PageHeader 新增 `backAction` 可选 prop，所有原有调用兼容；现有 title / breadcrumbs / description / badges / actions 调用均保留） |
| Backout | `git revert` 即可（详见 SPEC §12） |

## 用户可见变化

### 全局页面顶部

- **页面顶部去卡片化**：不再有圆角、边框、阴影、浅色背景围住标题栏；改为轻量 `border-bottom` 分隔。
- **标题字号微调**：从 `text-[17px]` 调整为 `text-[16px]`，与正文 13px 拉开层级，配合分隔线即可。
- **字体重叠修复**：标题、描述、面包屑三段视觉节奏清晰，描述统一 `text-[13px]`。
- **右栏自然换行**：badges / actions 在 1366px 窄屏下不会挤压标题。

### 一级根页面（13 处）

不再重复显示 `<模块名> · <页面名>` 的双层结构。模块上下文由侧栏 + H1 提供：

- `/overview`（无变化）
- `/connections`、`/connections/whitelist`、`/connections/test`
- `/`（Catalog；同时顺手把已弃用别名"语义维护工作台"改为"表目录"）
- `/publish/workbench`、`/publish/history`
- `/eval/cases`、`/eval/runs`、`/eval/monitor`
- `/admin/agents`、`/admin/roles`、`/admin/audit`（log 分支）
- `/admin/config-audit`

### 详情页（5 文件 / 7 调用点）

顶部新增 `backAction` 返回按钮；同时删除原 actions 里的"返回"按钮（避免双返回入口）：

- `/eval/runs/:runId` → 返回运行历史
- `/eval/cases/:domain/:caseId` / `/eval/cases/:domain/new` → 返回 domain 用例列表
- `/admin/roles/:roleId` / `/admin/roles/new` → 返回角色权限列表
- `/admin/agents/:userId` → 返回 Agent 实例列表
- `/admin/agents/:userId/tokens/new` → 返回 Agent 详情 / 列表

`/admin/audit?tab=heatmap` 仍保留面包屑（视图内 tab 切换，不是跳页）。

### Onboarding

- 顶部 badges 由 5 个收敛到 4 个（`活跃 Token` 下沉到标题下方 meta 行）。
- `pr-176` 等 release 不影响其它模块。

## 开发可见变化

- 新增可选 prop：`backAction?: ReactNode`。
- 同名抑制：`title` 是 string 且 `breadcrumbs` 末项等于 `title` 时整条面包屑不渲染（ReactNode title 跳过抑制，避免误判）。
- string title 容器自动加 `data-truncate="true"` 与 `title` 属性（悬停看完整值）。
- `.pl-page-header-actions--stacked` 保留（Onboarding 仍按列布局刷新菜单）。

## 验收

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ |
| `npx vitest run` | ✅ 755 / 755 |
| `npm run lint:terminology` | ✅ 207 文件扫描通过 |
| `npm run build` | ✅ 849 kB / 164 kB CSS |
| 浏览器视觉（1440 / 1366 px） | 待人类验收；建议路径见 SPEC §6.4 |

## 回滚

```bash
# 整体回滚（推荐）
git revert -m 1 <merge-sha>

# 局部回滚：仅组件 + CSS
git checkout <merge-parent-sha> -- \
  webui/src/components/PageHeader.tsx \
  webui/src/app/app.css \
  webui/src/__tests__/page-header.test.tsx
# 然后调用方单独 revert 涉及 breadcrumbs / backAction 的页面文件
```