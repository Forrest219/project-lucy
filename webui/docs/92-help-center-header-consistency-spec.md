# Help Center Header Consistency Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Help Center Header Consistency Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/help` 设计排查（2026-08-05）；`webui/docs/42-page-header-standardization-spec.md`；`docs/ui-ux-feedback/pages/help.md` |
| 适用范围 | `/help` 页面头部（标题、面包屑、右上上下文与返回动作）一致性修复 |
| 输出位置 | `webui/docs/92-help-center-header-consistency-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 92 |
| 关联工单 | `webui/docs/plans/wo-202608-25-help-center-header-consistency.md` |
| 关联页面 | `/help` |
| 关联台账 | `docs/ui-ux-feedback/pages/help.md`（`UX-HELP-001`～`003`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |

## 1. 背景

`/help` 在本轮全站统一性排查中新增纳入范围。该页虽不存在“共 N 条记录”类右上角计数冗余，但存在三类一致性问题：

1. 页面头部仍手写实现，未复用统一 `PageHeader` 组件。
2. 面包屑末项“系统手册”与 H1 同名重复。
3. 右上角动作“返回工作台”实际落点与全局“系统概览”心智不一致。

## 2. 目标

1. `/help` 头部复用统一 `PageHeader` 组件。
2. 去除面包屑与 H1 重复项，仅保留模块级 breadcrumb 上下文。
3. 返回动作文案/路由语义统一为“返回系统概览” → `/overview`。
4. 保留右上上下文 chips（来源路径、更新时间），不新增计数型 badge。

## 3. 非目标

- 不改 `HelpCenter` TOC、Markdown 分段与锚点逻辑。
- 不改 `/api/help/handbook` 契约。
- 不做浏览器验证（本轮仅 code review + 单测）。

## 4. 设计与实现

### 4.1 PageHeader 收敛

- `HelpCenter.tsx` 引入 `PageHeader`。
- `title`: `系统手册`
- `breadcrumbs`: `["系统帮助"]`（无末项同名重复）
- `description`: `handbook.title`
- `badges`: 来源路径与更新时间
- `actions`: `返回系统概览` 链接到 `/overview`

### 4.2 文案与导航语义

| 项 | 修复前 | 修复后 |
|---|---|---|
| Breadcrumb + H1 | `系统帮助 / 系统手册` + `系统手册` | `系统帮助` + `系统手册` |
| 返回动作 | 返回工作台 → `/` | 返回系统概览 → `/overview` |

## 5. 验收标准

1. `/help` 使用统一 `PageHeader`（`data-testid="page-header"`）。
2. 面包屑中不再出现末项“系统手册”与 H1 重复。
3. 右上返回动作为“返回系统概览”，`href=/overview`。
4. 台账 `UX-HELP-001`～`003` 更新为 `Fixed`。
5. `help-center.test.tsx` 通过，且全量 gate 通过。

## 6. 测试要求

- 更新 `webui/src/__tests__/help-center.test.tsx`：
  - 头部测试从 `help-header` 切到统一 `page-header`。
  - 断言返回动作 `href=/overview`。
  - 断言面包屑仅含“系统帮助”，不存在 `"/ 系统手册"` 重复尾项。
