# Wiki Edit Workbench Layout and Save Status Implementation Plan

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Edit Workbench Layout and Save Status Implementation Plan |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | `webui/docs/79-wiki-edit-workbench-layout-and-save-status-spec.md`；浏览器核查结论与用户 5 点反馈 |
| 适用范围 | 指导 `/wiki` 编辑态状态、布局、工具栏移除、保存预检文案的实施与非浏览器验收 |
| 输出位置 | `webui/docs/plans/wo-202608-11-wiki-edit-workbench-layout-and-save-status.md` |

**Goal:** 落地 Spec 79：dirty 驱动的保存状态、修复渲染预览拉伸、三列标题对齐、移除 Markdown 工具栏、主按钮改为「保存预检」。

**Architecture:** 纯前端展示与交互修复。不改后端 API / `wiki/` 存储。触及 `WikiEditor.tsx`、`WikiEditView.tsx`、`MarkdownToolbar.tsx`（删除）、`app.css`、`wiki.test.tsx`、台账。

**Tech Stack:** React、TypeScript、CSS (`src/app/app.css`)、Vitest/Testing Library。

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行本工单，按 Phase 顺序实施并逐步验证。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/79-wiki-edit-workbench-layout-and-save-status-spec.md`
- `src/pages/WikiEditor.tsx`
- `src/components/WikiEditView.tsx`
- `src/components/MarkdownToolbar.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`

## Non-Negotiable Boundaries

- 不新增后端 API；不引入 draft / publish 两阶段。
- 不改目录树内容模型、阅读态 IA、版本 / 移动弹窗（非本 Spec 范围）。
- 路径 / key / `Markdown` / `Diff` / `Raw` 保留 `notranslate` / `translate="no"`。
- 本轮约束：完成后只做 code review，**不做浏览器验证**。

## Scope

### Phase 1: Dirty state + header status + button copy

修改 `src/pages/WikiEditor.tsx`：

1. 新增 `const [isDirty, setIsDirty] = useState(false)`；所有 `dirtyRef.current = true/false` 处同步 `setIsDirty`。
2. 编辑态 `badges={null}`（或不再传 status pill）。
3. 在 `pl-wiki-header-actions` 内、`取消` 前渲染状态：
   - `isDirty` → `有未保存修改`（`data-testid="wiki-status-pill"`，`data-status="dirty"`）
   - `!isDirty && mode === "draft"` → `未保存草稿`（`data-status="draft"`）
   - 否则不渲染状态节点
4. 主按钮文案：`保存并发布` → `保存预检`。
5. 编辑态 description 去掉「保存并发布」，改为指向保存预检 + 粘贴/撰写。

样式：调整 `.pl-wiki-header-status`，去掉 `rounded-pill` 大胶囊感，改为操作行内 `text-xs` 状态文字；dirty 可用 warning 色。

### Phase 2: WikiEditView — remove toolbar + title row structure

修改 `src/components/WikiEditView.tsx`：

1. 移除 `MarkdownToolbar` import 与渲染；`textareaRef` 若仅服务工具栏可删除。
2. 将「正文 Markdown」「渲染预览」header 提升为 `pl-wiki-edit-grid` 的同一行子节点；第二行分别为 source textarea 与 preview body。
3. 源码 hint：`粘贴本地 Markdown；⌘/Ctrl+S 打开保存预检`（快捷键段 `notranslate`）。
4. 预览 hint 缩短为：`Diff / Raw 见保存预检`（或 `title` tooltip）。

删除 `src/components/MarkdownToolbar.tsx`（确认无其它引用后）。

### Phase 3: CSS layout fix + three-title baseline

修改 `src/app/app.css`：

1. `.pl-wiki-edit-grid`：`grid-template-rows: auto minmax(0, 1fr)`；标题行两列、内容行两列。
2. `.pl-wiki-edit-source` / `.pl-wiki-edit-preview`：`align-content: start`；预览内容区可 `overflow: auto`；禁止标题行被 stretch 居中。
3. `.pl-wiki-layout--edit`：侧栏标题与编辑区标题同字号/行高，顶对齐（消除系统性 50px+ 错位）。
4. 删除仅服务工具栏的 `.pl-wiki-markdown-toolbar*` 规则。

### Phase 4: Tests

更新 `src/__tests__/wiki.test.tsx`：

1. 断言主按钮「保存预检」，不出现「保存并发布」。
2. 替换工具栏测试为「不存在 `wiki-markdown-toolbar`」。
3. 新增：编辑已加载文档后 `wiki-status-pill` 文案为「有未保存修改」；未编辑时不显示「已保存」。
4. 断言 `app.css` 含编辑预览 `align-content` / 标题行相关规则（`readFileSync` 模式）。

### Phase 5: Full verification

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

### Phase 6: Ledger

在 `docs/ui-ux-feedback/pages/wiki.md` 追加 `UX-WIKI-026`～`030`，状态 `Fixed`；更新 `docs/ui-ux-feedback/README.md` 最近维护记录。

## Acceptance Criteria

- dirty 状态正确；无孤立「已保存」胶囊。
- 预览不再垂直居中大留白（CSS + 结构）。
- 三列标题同基线（结构 + CSS）。
- 无 Markdown 工具栏；主按钮为「保存预检」。
- 验证命令全部通过；台账已更新；仅 code review、无浏览器验证。

## Code Review Checklist

- [ ] `isDirty` 与 `dirtyRef` 所有写入点同步，无漏重置。
- [ ] 未引入假「发布」或服务端草稿。
- [ ] `MarkdownToolbar` 无残留引用；孤儿 CSS 已清。
- [ ] 预览 grid 拉伸根因已消除（`align-content: start` 或标题外提）。
- [ ] 术语符合 Spec 36 / 本 Spec；技术标识保留 notranslate。
- [ ] 改动范围与 Spec 79 一致，无无关重构。
