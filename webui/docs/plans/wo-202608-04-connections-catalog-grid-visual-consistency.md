# Connections and Catalog Grid Visual Consistency Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connections and Catalog Grid Visual Consistency Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/72-connections-catalog-grid-visual-consistency-spec.md`；浏览器核查结果；当前 `webui` 网格实现与测试 |
| 适用范围 | 指导 `/connections`、`/connections/enabled-tables`、`/catalog` 网格风格统一实施与验收 |
| 输出位置 | `webui/docs/plans/wo-202608-04-connections-catalog-grid-visual-consistency.md` |

**Goal:** 收敛三页网格视觉基线，消除 `/connections` 与另两页在字体、字重、行高、内边距、颜色和列宽策略上的漂移。

**Architecture:** 仅做 WebUI 前端样式和列配置收敛，优先复用共享网格样式（`pl-data-grid` 或等价基类），不改后端接口和业务流程。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中完成 M72 网格一致性任务，按以下步骤执行并逐步验证。

## Non-Negotiable Boundaries

- 不新增后端 API，不修改响应结构。
- 不改变连接管理、启用表切换、语义维护入口的业务行为。
- 不改全局导航和页面级信息架构。
- 不做移动窄屏专项适配或验证。
- 术语、路径、表名、Schema 名保留 `notranslate` / `translate="no"` 防御。

## Scope

### Phase 1: Baseline Audit

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "pl-schema-asset-table|pl-data-grid|pl-data-table|pl-catalog-table" src/
rg -n "font-size|font-weight|line-height|padding" src/app/app.css
```

预期：

- 明确 `/connections` 表格与另外两页共享/差异类名。
- 定位造成 `14px/400/20px/6px` 的样式来源。

### Phase 2: Add/Update Test Contracts First

优先补测试，覆盖三页网格契约：

- `connection-overview`：断言网格正文不再使用 `14px` 基线类或等价旧契约。
- `enabled-tables` 与 `catalog`：断言仍使用共享 `pl-data-grid` 契约。
- 增加数值列右对齐、操作列宽度约束的断言（按现有实现可断言 class 或列配置）。

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/connection-overview.test.tsx src/__tests__/connection-enabled-tables.test.tsx src/__tests__/catalog.test.tsx
```

Expected before implementation: 至少一项失败（反映待收敛差异）。

### Phase 3: Unify Grid Tokens in CSS

修改 `src/app/app.css`：

1. 将 `/connections` 表格正文字号/字重/行高/padding 收敛到共享 token：`12px/500/16px/8px`。
2. 表头统一保持 `12px/600/16px`。
3. 统一正文文本色与分隔线语义 token，移除页面特定深色偏差。
4. 保持变更 scoped，避免影响非目标组件。

### Phase 4: Normalize Column Alignment and Width Strategy

在相关页面组件中统一列配置：

- 数值列统一 `text-right`（本地表数、启用表数、字段数、Agent 引用等）。
- 操作列设置上限宽度（建议 `180~260px`），避免占比异常。
- 名称列保持弹性主列，确保长文本可读但不挤压关键数值列。

### Phase 5: Regression Tests

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/connection-overview.test.tsx src/__tests__/connection-enabled-tables.test.tsx src/__tests__/catalog.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

Expected: 全部通过（允许保留现有已知构建 warning）。

### Phase 6: Browser Verification

实施后浏览器复核：

1. `http://127.0.0.1:55176/connections`
2. `http://127.0.0.1:55176/connections/enabled-tables`
3. `http://127.0.0.1:55176/catalog`

检查项：

- 三页网格字体、字重、颜色、行高、对齐、列宽视觉一致。
- 页面切换无明显密度跳变。
- 操作列不再过宽挤压其他信息列。

## Acceptance Criteria

- `/connections` 网格视觉基线与另两页一致（12px/500/16px/8px）。
- 表头风格一致，正文色和分隔线色一致。
- 数值列右对齐规则在三页得到统一执行。
- 操作列宽度受控，不再出现明显超宽。
- 相关单测、术语 lint、build、`git diff --check` 均通过。
- 浏览器复核通过后，可标记为 `Verified`。

## Risk Notes

- `/connections` 若包含依赖大字号的密集操作区域，收敛后需观察可点击性和换行。
- 列宽压缩可能造成文本截断，需配套 tooltip 或省略策略（仅在必要时）。
