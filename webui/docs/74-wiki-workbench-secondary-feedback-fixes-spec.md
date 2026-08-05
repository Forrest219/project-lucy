# Wiki Workbench Secondary Feedback Fixes Spec

| 元数据 | 内容 |
| --- | --- |
| 文档名称 | Wiki Workbench Secondary Feedback Fixes Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/wiki`；`webui/src/components/WikiTree.tsx`、`WikiNewDocumentDialog.tsx`、`WikiReadView.tsx`、`MarkdownPreview.tsx`、`WikiMoveDocumentDialog.tsx`、`WikiVersionHistoryDialog.tsx`、`WikiEditor.tsx`；用户对 7 条反馈的逐条拍板 |
| 适用范围 | 指导 `/wiki` 本轮 7 条反馈中 1、2、3、4、5、6、7 的修复实现与验收（6 保留为“移除 diff”而非折叠） |
| 输出位置 | `webui/docs/74-wiki-workbench-secondary-feedback-fixes-spec.md` |

> **§9 修订（2026-08-05）**：版本记录「右侧历史预览」分栏由 [`80-wiki-version-history-list-first-ux-spec.md`](80-wiki-version-history-list-first-ux-spec.md) 进一步修订为列表优先 + 全宽详情。表格化与懒加载结论仍有效。

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 74 |
| 关联工单 | `webui/docs/plans/wo-202608-07-wiki-workbench-secondary-feedback-fixes.md` |
| 关联页面 | `/wiki` |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（新增 `UX-WIKI-019` ~ `UX-WIKI-025`） |
| 状态 | Draft |
| 日期 | 2026-08-04 |
| 范围 | 目录树层级视觉、目录树内容模型（目录 vs 文档）、新建文档弹窗文案、Markdown 正文重复标题、移动到目录弹窗字段与 Diff 展示、版本记录表格化与历史预览懒加载 |

## 1. 背景

用户在浏览器核查 `/wiki` 后给出 7 条反馈，逐条核查确认属实（含 1 条部分属实），并对修复方向拍板：

1. 目录层级视觉设计缺失，看不出多级目录的父子关系。**拍板：采纳建议**（补视觉层级辅助）。
2. 目录树把"目录"和"具体 md 文档"混排在同一棵树里，用户期望目录树默认只呈现目录结构和文档数 pill。**拍板：目录树默认只展示目录节点 + 文档数 pill，去掉文档行内混排。**
3. `新建文档` 弹窗文案"选择已有目录，或输入新的子目录路径"暗示可以新建空目录，但该弹窗实际只能新建文档。**拍板：选 b）**——在文案旁加一个跳转入口，指向已有的"新建目录"弹窗。
4. 打开 `demo-superstore.md` 后正文渲染出现标题重复 + 异常留白。**拍板：采纳建议**（剥离正文内与页面标题重复的首个 H1）。
5. "移动到目录"弹窗里"目标目录"文案重复出现两次。**拍板：采纳建议**（去重，保留一份）。
6. "移动到目录"弹窗默认展示大段 Diff（"文档内容"区域）。**拍板：移动不需要看 diff**——与此前"折叠"的建议不同，本轮口径是完全移除该区域，不做折叠展开。
7. "版本记录"弹窗左侧应是清晰的表格记录（时间、操作类型、预览链接、Diff、恢复此版本），右侧"历史预览"默认渲染冗余，应改为点击后才生成。**拍板：采纳建议**（表格化 + 懒加载）。

本 Spec 只覆盖上述 7 条反馈对应的实现范围，不重新设计 Wiki 的存储模型、版本 API 契约或安全边界。

## 2. 目标

1. `WikiTree` 补充可辨识的层级视觉线索，让 1/2/3 级目录的父子关系一望可知。
2. `WikiTree` 默认渲染只包含目录节点（名称 + `N 篇` 计数），不再渲染具体 Markdown 文档行；仅当用户在搜索框输入内容时，才在匹配的目录下临时展示命中的文档行（用于"搜索直达"）。
3. `新建文档` 弹窗在既有文案旁新增一个"新建空目录"跳转链接，点击后关闭当前弹窗并打开已有的 `新建目录` 弹窗（复用现有组件与 API，不新增后端能力）。
4. `WikiReadView` 渲染正文时，如果 Markdown 正文的第一个块是 H1 标题且其文本与页面级标题（`wikiTitleFromContent` 计算结果）完全一致，则不重复渲染该 H1，避免标题重复和相关的双重留白。
5. `WikiMoveDocumentDialog` 的"目标目录"文案只出现一次。
6. `WikiMoveDocumentDialog` 完全移除"文档内容"/Diff 展示区域及其加载态文案；移动预检只保留当前路径、目标目录、目标路径预览、冲突提示和确认/取消动作。
7. `WikiVersionHistoryDialog` 左侧"历史版本"改为语义化表格（时间、操作类型、版本、操作），右侧"历史预览"默认不加载任何历史版本内容，只有点击某一行的"查看"后才请求并渲染该版本的 Markdown 预览和 Diff。

## 3. 非目标

- 不新增后端 API，不改变 `wiki/` 物理存储、Markdown key、版本记录写入语义或 `fs-safe.ts` 安全边界。
- 不改变移动/恢复/删除目录的后端校验逻辑，只改前端展示。
- 不实现"隐藏空目录""目录级文档列表面板"等更大范围的 IA 重构；`WikiLibraryHome`（首页 Markdown 文档列表）和搜索仍是从目录树之外触达具体文档的主要方式。
- 不处理 `UX-WIKI-017`（目录 row 展开/收起视觉 affordance 偏弱）与 `UX-WIKI-018`（首页目录数口径），两者已在台账中登记为独立候选项，不在本轮范围内。
- 不做移动窄屏专项验证。
- 不做浏览器验证——本轮约束明确要求收尾只做代码审查，不做浏览器复核；验收以 Vitest + `lint:terminology` + `build` 为准。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None。

文案要求：

- 继续使用 `业务 Wiki`、`目录`、`Markdown 文档`、`目标目录`、`目标 Wiki 路径`、`版本记录`、`历史版本`、`历史预览`、`移动到目录`。
- 目录名、文档标题、路径、`versionId`/`contentHash` 等技术标识继续保持既有的 `notranslate` / `translate="no"` 防御，本轮改动不能移除这些属性。

## 5. `WikiTree` 层级视觉与内容模型

### 5.1 层级视觉辅助（对应反馈 1）

现状：目录行/文档行只靠 `paddingLeft: level * 12px` 缩进区分层级，没有连接线、阶梯背景或其它视觉线索。

要求：

- 为嵌套的 `<ul className="pl-wiki-tree-pages">`（即某个目录展开后承载子目录/文档的列表）增加左侧引导线（`border-left`），配合缩进形成经典的树形层级视觉。
- 顶层 `<ul className="pl-wiki-tree-list">` 不加引导线（没有父级）。
- 引导线使用弱对比色（`border-border-default` 或等价 muted token），不与选中态、hover 态冲突。
- 不引入三角 / chevron glyph（沿用 `UX-WIKI-014` 之后的既有约束）。

### 5.2 目录树默认内容模型（对应反馈 2）

现状：`renderDirectory` 无条件渲染 `node.children`（子目录）和 `node.pages`（文档），两者在同一个 `<ul>` 里混排。

要求：

- 当搜索框 (`wiki-tree-search`) 为空时，目录树的每个目录节点只渲染：
  - 子目录（递归）；
  - 目录自身的名称 + `N 篇` 计数 pill（沿用现有 `documentCount` 计算）。
  - **不渲染** `node.pages`（具体 Markdown 文档行）。
- 当搜索框有输入且触发了过滤（`filterDirectoryTree` 命中）时，命中的文档行照常渲染在其所属目录下（保留"搜索直达文档"的既有能力，避免功能回归）。
- 目录节点本身的点击行为（展开/收起、创建子目录、创建文档、删除目录）不变。
- 文档访问路径调整为：
  - 从 `/wiki` 首页的 `WikiLibraryHome` 文档列表点击；
  - 从目录树搜索结果点击；
  - 从已打开文档内的其它入口（如 Catalog 表详情跳转 `sl_ref` 关联文档）。

## 6. `WikiNewDocumentDialog` 文案与跳转（对应反馈 3）

现状：Dialog.Description 是"选择已有目录，或输入新的子目录路径。"，但该弹窗只有"创建草稿"一个出口，无法单独新建空目录。

要求（选项 b）：

- 保留现有文案不变（说明"新建文档时可以顺带创建新目录路径"仍然真实有效）。
- 在文案下方新增一个轻量级跳转入口，例如："需要新建一个空目录？<按钮/链接>新建目录</按钮/链接>"。
- 点击该入口：
  - 关闭当前 `新建文档` 弹窗；
  - 打开已有的 `新建目录` 弹窗（`WikiNewDirectoryDialog`），并将其默认父级目录设为当前 `新建文档` 弹窗里正在输入的目标目录值，减少用户重新输入。
- 不新增后端接口；复用 `WikiEditor.tsx` 中已存在的 `openNewDirectoryDialog`。

## 7. `WikiReadView` / `MarkdownPreview` 去重（对应反馈 4）

现状：`WikiReadView` 用 `wikiTitleFromContent` 计算出的标题渲染为 `<h1 class="pl-wiki-read-title">`；`MarkdownPreview` 完整渲染 `content`，如果正文第一行是 `# <与标题相同的文本>`，会在正文内再渲染一个 `<h1>`，造成同一标题渲染两次和额外的视觉间隔。

要求：

- `MarkdownPreview` 新增可选 prop（例如 `hideLeadingHeading?: string`）：解析出的第一个 Block 如果是 `level === 1` 的 heading，且其渲染前文本（trim 后）与传入值完全相等，则跳过渲染该 heading block，其余内容正常渲染。
- `WikiReadView` 调用 `MarkdownPreview` 时传入 `hideLeadingHeading={title}`。
- 该 prop 默认不传（其它调用方，如 `WikiVersionHistoryDialog` 的历史预览、Help Center 的 Markdown 渲染，不受影响，继续渲染完整正文，包括其中的 H1）。
- 只去重"第一个块且完全匹配"的场景，不做全文范围的模糊去重，避免误删用户正文中合法的重复标题文本。

## 8. `WikiMoveDocumentDialog` 精简（对应反馈 5、6）

### 8.1 目标目录文案去重（反馈 5）

现状：`<h3 class="pl-wiki-preflight-section-title">目标目录</h3>` 和 `<label><span>目标目录</span>...</label>` 重复渲染"目标目录"文本两次。

要求：

- 保留 section 标题 `目标目录`（`h3`）。
- 移除 `<label>` 内重复的可见 `<span>目标目录</span>` 文本，改为在 `<input>` 上补 `aria-label="目标目录"`，保证可访问名称不丢失。
- 视觉上"目标目录"文案在弹窗中只出现一次。

### 8.2 移除文档内容 / Diff 展示（反馈 6）

现状：`<section data-testid="wiki-move-diff">` 渲染 `<h3>文档内容</h3>` + `DiffViewer`（或加载态文案），默认展开，占用弹窗近一半高度。

要求：

- 整段移除该 `section`（标题、`DiffViewer` 引用、加载态文案），移动预检里不再展示 Diff。
- 组件不再 import `DiffViewer`。
- 服务端 `move/preview` 响应仍可以返回 `diff` 字段（不改后端契约），前端只是不再渲染它；如果后续需要该字段用于审计或别处消费，不受本轮影响。
- `确认移动` 按钮的可用性逻辑（依赖 `preview` 是否存在、是否冲突、`isLoading`/`isMoving`）保持不变。

## 9. `WikiVersionHistoryDialog` 表格化与懒加载（对应反馈 7）

### 9.1 左侧"历史版本"表格化

现状：`历史版本` 用一组 `<article class="pl-wiki-version-item">` 卡片渲染，每张卡片包含操作类型、时间、`versionId`、来源/恢复来源文案，以及"查看"/"恢复此版本"两个按钮；不是语义表格。

要求：

- 改为 `<table class="pl-wiki-version-table">` 语义表格，列至少包含：

  | 列 | 内容 |
  | --- | --- |
  | 时间 | `formatVersionTime(version.createdAt)`，`<time dateTime={...}>` |
  | 操作类型 | `OPERATION_LABELS[version.operation]`，如存在 `sourceFileName` / `restoredFromVersionId` 可作为该单元格内的次级说明文本 |
  | 版本 | `version.versionId`（`notranslate`） |
  | 操作 | `查看` + `恢复此版本` 两个按钮 |

- 当前行高亮（`selectedVersionId === version.versionId`）通过 `<tr>` 的 className 表达，替代原 `pl-wiki-version-item--active`。
- 保留既有 `data-testid`（`wiki-version-item-${versionId}`、`wiki-version-view-${versionId}`、`wiki-version-restore-${versionId}`）以维持测试和调用约定的稳定性，只改变外层标签语义（`article` → `tr`/`td`）。
- 空状态（`暂无历史版本...`）和加载态（`正在加载版本记录...`）文案不变。

### 9.2 右侧"历史预览"懒加载

现状：`WikiEditor.tsx` 在 `版本记录` 弹窗打开且 `versionsQuery` 返回数据后，用一个 `useEffect` 自动把 `selectedVersionId` 设置为列表第一项，导致弹窗一打开就默认渲染最新版本的 Markdown 预览和 Diff。

要求：

- 移除该"自动选中第一个版本"的 `useEffect`。
- 弹窗打开时 `selectedVersionId` 保持为 `null`（`openVersionHistory` 已经会 `setSelectedVersionId(null)`，不需要额外改动）。
- 右侧"历史预览" section 在没有 `selectedVersionId` 时继续显示既有占位文案"选择一个历史版本查看 Markdown 预览和 Diff。"，不发起版本详情请求（`versionDetailQuery` 的 `enabled` 条件已经依赖 `Boolean(selectedVersionId)`，天然满足懒加载）。
- 点击某一行的"查看"按钮后，才通过 `onSelectVersion` 设置 `selectedVersionId`，触发详情请求并渲染 Markdown 预览 + Diff（既有行为，不需要改动 `MarkdownPreview` / `DiffViewer` 的调用方式）。

## 10. 测试要求

### 10.1 Unit / Component Tests

更新 `webui/src/__tests__/wiki.test.tsx`：

- **目录层级视觉**：断言嵌套 `.pl-wiki-tree-pages` 存在引导线相关 class（例如通过读取 `app.css` 源文本断言规则存在，参考既有 `readFileSync("src/app/app.css", ...)` 的用法）。
- **目录树默认内容模型**：
  - 默认（未搜索）状态下，`within(tree).queryByRole("button", { name: /Superstore guide/ })` 等文档行断言为 `not.toBeInTheDocument()`；目录节点（如 `global 1 篇`）仍然可见。
  - 在搜索框输入匹配文本后，命中的文档行重新出现；清空搜索框后文档行再次消失。
  - 更新所有依赖"默认从树里点击文档行"的既有测试，改为先输入搜索词再点击，或改用 `WikiLibraryHome` / 直接 URL `key` 参数进入文档。
- **新建文档弹窗跳转**：断言弹窗内存在"新建目录"跳转入口；点击后 `新建文档` 弹窗关闭、`新建目录` 弹窗打开，且默认父级目录等于点击前 `新建文档` 弹窗里的目标目录输入值。
- **正文标题去重**：新增/调整 fixture，让页面 `frontmatter.summary`（或首个 `# ` 标题）与正文第一行 H1 文本一致，断言 `wiki-read-body` 内只有一个 `<h1>` 或 `wiki-markdown-preview` 不再重复渲染该标题文本；同时断言 `WikiVersionHistoryDialog` 的历史预览（不同调用路径）不受影响，仍然渲染完整正文首个标题。
- **移动到目录弹窗**：断言渲染后的可见文本中"目标目录"只出现一次（`getAllByText` 长度为 1，或断言 `wiki-move-target` 内不存在重复的 `<span>` 文案）；断言 `wiki-move-diff` / 文档内容 section、`DiffViewer` 相关内容不再渲染。
- **版本记录表格化 + 懒加载**：
  - 断言 `wiki-version-list` 内使用 `<table>`（例如 `container.querySelector("table")` 非空），表头包含"时间""操作类型""版本""操作"文案。
  - 断言弹窗刚打开、未点击任何"查看"按钮时，`wiki-version-markdown-preview` / `wiki-version-diff` 不存在，右侧显示"选择一个历史版本查看 Markdown 预览和 Diff。"占位文案，且不会发出对应版本详情的请求。
  - 保留/调整既有"点击查看后渲染历史 Markdown 预览和 Diff、点击恢复此版本后打开恢复预检"的测试，确保点击驱动的路径仍然通过。

### 10.2 Verification Commands

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

`npm run build` 允许保留当前已知 Vite chunk size warning。

## 11. 验收标准（非浏览器）

本轮约束明确"结束后只做 code review，不做浏览器验证"，因此验收以下述非浏览器手段为准：

- `WikiTree` 默认状态下不渲染任何具体 Markdown 文档行，只渲染目录 + 计数；搜索状态下文档行可正常出现和消失。
- 嵌套目录列表存在可辨识的层级引导线样式。
- `新建文档` 弹窗提供可跳转到 `新建目录` 的入口，且携带当前目标目录作为默认父级。
- 打开任意 Markdown 文档时，`wiki-read-body` 内不再重复渲染与页面标题相同的首个 H1；其它 Markdown 渲染场景（版本历史预览等）不受影响。
- `移动到目录` 弹窗内"目标目录"文案只出现一次，且不再渲染"文档内容"/ Diff 区域。
- `版本记录` 弹窗左侧改为语义表格，右侧"历史预览"默认不加载任何内容，只有点击"查看"后才渲染。
- `npm run lint:terminology`、`npm test -- src/__tests__/wiki.test.tsx`、`npm run build`、`git diff --check` 全部通过。
- 代码审查（Code Review）确认改动范围与本 Spec 一致，未夹带无关重构。

## 12. 风险与边界

- 目录树默认隐藏文档行是一次可感知的行为变化：如果用户已经习惯"直接在左侧树里点文档"，需要通过 `WikiLibraryHome` 首页文档列表或搜索框重新建立路径。本 Spec 不新增额外的"选中目录后在主区域展示该目录文档列表"的过渡态，属于已知取舍，后续如需要可作为独立候选项排期。
- 正文标题去重只按"第一个 block 完全匹配"判断，如果 Markdown 正文的第一个标题文本与页面标题存在细微差异（大小写、多余空格已经 trim 处理，但标点/表情符号等仍可能不匹配），将不会被去重，属于预期内的保守策略，不做模糊匹配以避免误删用户内容。
- 移动预检移除 Diff 后，用户在确认移动前将不再看到内容层面的变化确认；此为用户本轮明确拍板的取舍（移动本身不改变内容，只改变路径，Diff 价值有限）。
- 版本记录表格化改变了 DOM 结构（`article` → `table` 行），如果有未在本 Spec 列出的其它测试或样式依赖旧结构，需要在实现阶段一并排查修正。
