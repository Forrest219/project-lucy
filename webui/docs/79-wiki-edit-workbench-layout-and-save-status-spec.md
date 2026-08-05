# Wiki Edit Workbench Layout and Save Status Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Wiki Edit Workbench Layout and Save Status Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/wiki?key=global%2Ftest%2Fdemo-superstore.md`（编辑态）；用户 5 点反馈；`WikiEditor.tsx`、`WikiEditView.tsx`、`MarkdownToolbar.tsx`、`app.css`；`webui/docs/36-business-wiki-read-edit-workbench-spec.md` |
| 适用范围 | 指导 `/wiki` 编辑态：保存状态表达、渲染预览布局、三列标题对齐、移除 Markdown 工具栏、保存预检文案收敛的实现与验收 |
| 输出位置 | `webui/docs/79-wiki-edit-workbench-layout-and-save-status-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 79 |
| 关联工单 | `webui/docs/plans/wo-202608-11-wiki-edit-workbench-layout-and-save-status.md` |
| 关联页面 | `/wiki`（编辑态） |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（新增 `UX-WIKI-026` ~ `UX-WIKI-030`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 编辑态 Header 状态、编辑区 CSS 布局、面板标题对齐、删除 Markdown 工具栏、保存入口文案；不引入服务端草稿 / 发布闸门 |

## 1. 背景

用户在编辑态核查 `/wiki?key=global/test/demo-superstore.md` 后给出 5 点反馈，浏览器 + DOM 测量确认属实：

1. 右上角「已保存」信息有用，但与整体设计风格不统一；且编辑后仍显示「已保存」（只跟 `mode`，不跟 dirty）。
2. 「渲染预览」区域布局混乱，不是自上而下排版。根因：`.pl-wiki-edit-preview` 作为等高 CSS grid，多余高度均分到标题行与内容行；header 使用 `items-center`，标题被垂直居中，正文被顶到面板中部（同类于已修的 `UX-WIKI-006`）。
3. 「目录 / 正文 Markdown / 渲染预览」视觉上像平级三列标题，但竖直错位严重（测量 Δ：目录→正文 ≈52px，正文→预览 ≈170px）。
4. 「正文 Markdown」上方的 `B I </> { } H ▦ 🔗` 工具栏不需要；产品鼓励本地 MD 工具编写后粘贴。
5. 询问「保存」与「发布」是否应分开。现状只有「保存并发布」→「保存预检」→「保存」；Wiki 写入 `wiki/*.md` 即对 Agent 生效，无服务端草稿 / 发布闸门。本轮**不**拆两阶段发布，只收敛文案与心智。

## 2. 目标

1. 编辑态保存状态改为 dirty 驱动，并并入主操作行，去掉孤立圆角胶囊。
2. 修复渲染预览 grid 拉伸，标题置顶、正文自上而下。
3. 使「目录 / 正文 Markdown / 渲染预览」三列标题处于同一水平基线（编辑态）。
4. 移除 Markdown 插入工具栏；保留粘贴导向与 `⌘/Ctrl+S` 提示。
5. Header 主按钮由「保存并发布」改为「保存预检」；不新增独立「发布」动作或服务端草稿。

## 3. 非目标

- 不新增后端 API，不改变 `wiki/` 物理存储、版本记录或 `fs-safe.ts` 安全边界。
- 不引入 draft / publish 两阶段工作流、审批闸门或「未发布」阅读态。
- 不重做阅读态 IA、目录树内容模型（`UX-WIKI-017` / `018` / `019`–`025` 已有独立条目）。
- 不做移动窄屏专项；不做浏览器验证——本轮约束要求收尾只做 code review，验收以 Vitest + `lint:terminology` + `build` 为准。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md` and Spec 36 terminology.

| 概念 | UI 主术语 | 禁止 / 避免 |
|---|---|---|
| Save Preflight | 保存预检 | 保存并发布（作为主按钮，本轮移除） |
| Unsaved changes | 有未保存修改 | 已保存（在 dirty 时） |
| Render Preview | 渲染预览 | 常规预览中展示 Diff / Raw |
| Markdown Document | 正文 Markdown / Markdown | — |

Browser translation defense 继续覆盖：`Markdown`、`Diff`、`Raw`、Wiki key、路径。

本轮不新增产品概念；若文案使用「保存预检」，与 Spec 36 一致，无需改术语标准表。

## 5. 保存状态（对应反馈 1）

### 5.1 现状

- `PageHeader` 的 `badges` 槽渲染 `.pl-wiki-header-status` 圆角胶囊。
- 文案：`mode === "draft" ? "未保存草稿" : "已保存"`。
- `dirtyRef` 跟踪未保存编辑，但**不驱动**该 pill；已加载文档编辑后仍显示「已保存」。

### 5.2 要求

- 移除编辑态 `badges` 中的孤立 status pill。
- 在 `pl-wiki-header-actions` 主操作行内、`取消` 左侧（或紧邻）展示状态文本：
  - dirty：`有未保存修改`（可用既有 warning token 的轻量文字样式，**不用**大圆角 pill）。
  - 非 dirty 且 `mode === "draft"`：`未保存草稿`。
  - 非 dirty 且已加载文档：**不显示**状态文案（减少常态噪音）。
- `dirty` 必须是可渲染 React state（可与现有 `dirtyRef` 同步），编辑 / 模板填充置 true，保存成功 / 放弃编辑 / 切换文档重置时置 false。
- `data-testid="wiki-status-pill"` 可保留在状态节点上以便测试，但视觉不再是独立右上胶囊。

## 6. 渲染预览布局（对应反馈 2）

### 6.1 要求

- `.pl-wiki-edit-source` / `.pl-wiki-edit-preview`：
  - `align-content: start`（或等价），禁止 auto 行被均分拉高。
  - 采用 `grid-template-rows: auto minmax(0, 1fr)`（若面板内仍含 header + body），或把 header 提升到父 grid 第一行（见 §7），预览内容区从顶部开始排布并可内部滚动。
- `.pl-wiki-edit-preview-header` 不得在拉伸后垂直居中标题（避免 `items-center` 在被拉高容器中下沉）。
- 验收：预览区标题紧贴面板顶部，正文标题（如 `Demo Superstore`）紧随其后，标题行与内容行之间无大块空白。

## 7. 三列标题对齐（对应反馈 3）

### 7.1 要求

编辑态下，「目录」「正文 Markdown」「渲染预览」三个标题的 `getBoundingClientRect().top` 差值应 ≤ 4px（同基线）。

推荐实现（方案 A 轻量版）：

1. `WikiEditView` 的编辑 grid 将「正文 Markdown」「渲染预览」标题放在**同一 grid 行**（`grid-template-rows: auto minmax(0, 1fr)`），内容区在第二行。
2. `.pl-wiki-layout--edit` 下统一三标题字号 / 行高（建议 `text-sm font-semibold` 或与侧栏 `font-medium` 对齐后两边一致），并消除卡片 `padding-top` 与侧栏标题之间的系统性错位（例如编辑卡片标题行与 `.pl-wiki-sidebar-header` 顶对齐）。
3. 预览区旁的长提示「仅显示最终渲染结果；Diff / Raw 在保存预检中查看。」缩短为次级 hint，或改为 `title` tooltip，避免标题行折行破坏基线。

不要求把侧栏树与编辑区合并为单一 DOM 三列；允许侧栏仍在 `aside`，只要视觉基线对齐。

## 8. 移除 Markdown 工具栏（对应反馈 4）

### 8.1 要求

- `WikiEditView` 不再渲染 `MarkdownToolbar`。
- 删除对用户可见的插入按钮（加粗 / 斜体 / 行内代码 / 代码块 / 标题 / 表格 / 链接）。
- 源码标题旁 hint 改为粘贴导向，例如：`粘贴本地 Markdown；⌘/Ctrl+S 打开保存预检`（`⌘/Ctrl + S` 段保留 `notranslate`）。
- 若 `MarkdownToolbar.tsx` 无其它引用，删除该组件文件及仅服务于它的 CSS（`.pl-wiki-markdown-toolbar*`）；更新依赖该工具栏的测试。

## 9. 保存入口文案（对应反馈 5）

### 9.1 决策

**不**拆分「保存」与「发布」为两个产品动作。理由：当前无服务端草稿；`PUT /api/wiki/:key` 写入即生效；Diff 已在「保存预检」中确认。

### 9.2 要求

- Header 主按钮文案：`保存并发布` → `保存预检`（`data-testid="wiki-save-preflight-button"` 保留）。
- 编辑态 `PageHeader` description 同步去掉「保存并发布」措辞，改为指向保存预检（例如「直接粘贴或撰写 Markdown；保存前通过保存预检查看 Diff 与校验。」）。
- 预检弹窗标题保持「保存预检」；确认按钮保持「保存」。
- 不新增「仅保存草稿」或「发布」按钮。

## 10. 测试要求

### 10.1 Unit / Component Tests

更新 `webui/src/__tests__/wiki.test.tsx`：

- 编辑态主按钮文案为「保存预检」，不再断言「保存并发布」。
- 进入已加载文档编辑态且未改内容时，不显示「已保存」孤立 pill；修改 textarea 后出现「有未保存修改」。
- 不再渲染 `wiki-markdown-toolbar`；相关插入测试删除或改为断言工具栏不存在。
- CSS / 结构：断言 `app.css` 中编辑预览相关规则含 `align-content: start`（或文档约定的等价类名），或断言编辑 grid 标题行结构（`wiki-edit-source` / `wiki-edit-preview` 的 header 与内容分层）。
- 既有保存预检、取消 dirty、Cmd+S 路径回归通过。

### 10.2 Verification Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

本轮**不**做浏览器验证。

## 11. 验收标准（非浏览器）

- 编辑态无右上孤立「已保存」胶囊；dirty 时操作行显示「有未保存修改」。
- 预览面板 CSS 不再均分拉伸标题行；结构上标题与内容自上而下。
- 编辑态三列标题同基线（实现层：共享标题行 + 侧栏对齐样式）。
- Markdown 工具栏从编辑 UI 移除；粘贴导向 hint 可见。
- 主按钮为「保存预检」；无「保存并发布」用户可见文案；无新的发布闸门。
- `lint:terminology`、`wiki.test.tsx`、`build`、`git diff --check` 通过。
- 台账 `UX-WIKI-026`～`030` 状态为 `Fixed`。
- Code review 确认范围与本 Spec 一致。

## 12. 风险与边界

- 去掉工具栏后，完全依赖用户本地编辑器或手写 Markdown；与产品拍板一致。
- 不引入草稿态意味着「保存预检 → 保存」仍是唯一持久化路径；若未来需要审阅发布，需新 Spec。
- 三列标题对齐依赖 CSS 与结构，不同字体度量下允许 ≤4px 误差；本轮不以浏览器截图像素验收。
