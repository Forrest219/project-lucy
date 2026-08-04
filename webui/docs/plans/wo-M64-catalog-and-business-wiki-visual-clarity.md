# Catalog and Business Wiki Visual Clarity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement M64: reduce Catalog table-name visual weight, simplify Business Wiki typography and homepage IA, remove Wiki triangle glyphs, and clarify the upload Markdown preflight.

**Architecture:** This is a frontend-only polish pass. Keep existing Wiki data APIs, routing, upload commit flow, and directory tree model; change rendering, CSS, and component tests around Catalog, WikiTree, WikiLibraryHome, and WikiUploadPreflight.

**Tech Stack:** React, TypeScript, Tailwind-style CSS in `src/app/app.css`, Vitest / Testing Library.

---

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中执行 M64：Catalog and Business Wiki Visual Clarity。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/48-catalog-and-table-semantic-workbench-productization-spec.md`
- `docs/49-business-wiki-md-library-operations-spec.md`
- `docs/52-business-wiki-directory-tree-and-density-spec.md`
- `docs/58-business-wiki-directory-document-governance-spec.md`
- `docs/71-catalog-and-business-wiki-visual-clarity-spec.md`
- `src/pages/Catalog.tsx`
- `src/components/WikiTree.tsx`
- `src/components/WikiLibraryHome.tsx`
- `src/components/WikiUploadPreflight.tsx`
- `src/app/app.css`
- `src/__tests__/catalog.test.tsx`
- `src/__tests__/wiki.test.tsx`

## Non-Negotiable Boundaries

- 不新增后端 API。
- 不改变 `wiki/` 物理存储、Markdown key、版本记录、上传 commit 语义或 `fs-safe.ts` 安全边界。
- 不改变 `/catalog` 表行链接目标、维护语义入口、筛选或 API 数据契约。
- 不重做全局导航、命令面板、移动端布局或移动窄屏验证。
- 不使用 triangle / chevron glyph 作为 Wiki 目录视觉符号，包括 `▼`、`▶`、`▾`、`▸`。
- 路径、文件名、目录 key、表名和产品英文术语必须保留 `notranslate` / `translate="no"`。
- CSS 修改需要 scoped，避免污染保存预检、恢复预检、移动预检等同样使用 `.pl-wiki-preflight-*` 的 Modal。

## Scope

### Phase 1: Baseline Source Review

执行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
rg -n "pl-catalog-table-name-link|pl-wiki-library|pl-wiki-preflight|▼|▶|▾|▸" src/
rg -n "按目录管理业务口径文档|解析摘要|目标目录|目标 Wiki 路径" src/
```

预期：

- `src/app/app.css` 命中 `.pl-catalog-table-name-link`、`.pl-wiki-library-*`、`.pl-wiki-preflight-*`。
- `src/components/WikiLibraryHome.tsx` 命中 `Markdown 文档库`、`按目录管理业务口径文档`、`▾`。
- `src/components/WikiUploadPreflight.tsx` 命中 `目标`、`目标目录`、`解析摘要`。
- `src/components/WikiTree.tsx` 命中目录展开 glyph 或等价渲染。

如果这些命中已不存在，先确认是否被其它工单实现，不要重复改动。

### Phase 2: Catalog Table-Name Weight Tests

修改 `src/__tests__/catalog.test.tsx`：

1. 找到或新增 Catalog 表格渲染测试。
2. 断言表名链接仍渲染 `superstore_orders` 或 fixture 中的表名。
3. 断言表名链接带 `notranslate` className 和 `translate="no"`。
4. 断言表名链接不包含 `font-medium` class。
5. 如果测试无法直接读 computed style，则以 class contract 为准。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/catalog.test.tsx
```

Expected before implementation: FAIL。

### Phase 3: Implement Catalog CSS

修改 `src/app/app.css`：

1. 将 `.pl-catalog-table-name-link` 从 `font-medium` 改为 `font-normal` 或移除显式 font weight，使它为正文 `400`。
2. 保留 `text-sm`、`text-fg-default`、`no-underline`、`hover:underline`。
3. 不改变 `.pl-data-grid thead th` 的 `font-semibold`。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/catalog.test.tsx
```

Expected after implementation: PASS。

### Phase 4: Wiki Home IA Tests

修改 `src/__tests__/wiki.test.tsx`：

1. `/wiki` 默认首页测试中，断言存在统计摘要 `当前收录 2 篇 Markdown 文档，分布在 11 个目录中。` 或当前 fixture 对应数字。
2. 断言不再出现 `按目录管理业务口径文档`。
3. 断言右侧文档列表使用新 test id，例如 `wiki-library-documents`。
4. 断言右侧列表展示 Markdown 文档标题和完整 Wiki 路径 metadata。
5. 断言右侧不再渲染目录 group header / nested directory group 的旧 test id 或旧 class contract。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected before implementation: FAIL。

### Phase 5: Implement WikiLibraryHome Document List

修改 `src/components/WikiLibraryHome.tsx`：

1. 保留 `buildWikiDirectoryTree` 仅用于 `directoryCount`，或改用已有 directory summary 计算目录数。
2. 移除 hero 内可见的 `Markdown 文档库` kicker 和 `按目录管理业务口径文档` title。
3. 保留 summary：`当前收录 {total} 篇 Markdown 文档，分布在 {directoryCount} 个目录中。`
4. 将右侧主体从递归 `DirectorySection` 改为 flat Markdown document list。
5. 每个文档 item 展示：
   - `MD` icon；
   - 文档标题；
   - `wiki/${page.key}` 路径 metadata。
6. 路径 metadata 加 `className="... notranslate"` 与 `translate="no"`。
7. 删除 `DirectorySection` 或保留为未使用前确认无 lint warning。

修改 `src/app/app.css`：

1. 将 `.pl-wiki-library-hero` 改为紧凑 summary band。
2. 增加或调整：
   - `.pl-wiki-library-documents`
   - `.pl-wiki-library-document`
   - `.pl-wiki-library-document-button`
   - `.pl-wiki-library-document-path`
3. 删除或弱化不再使用的目录 group 样式时，确认不影响其它组件。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected: Wiki 首页 IA 相关测试通过。

### Phase 6: Triangle Removal Tests

修改 `src/__tests__/wiki.test.tsx`：

1. 在 Wiki 首页 fixture 渲染后，断言可见文本不包含 `▼`、`▶`、`▾`、`▸`。
2. 对左侧目录 row 断言：
   - 仍有可点击目录按钮或 treeitem；
   - 展开状态通过 `aria-expanded` 或 treeitem 语义表达；
   - 可访问名称包含目录名。
3. 断言右侧 Markdown 文档列表不包含 folder triangle / fake toggle。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected before implementation: FAIL。

### Phase 7: Implement Triangle Removal And Typography

修改 `src/components/WikiTree.tsx`：

1. 移除目录按钮内的 `▼` / `▶` 文本。
2. 如果需要图形提示，改用已有 icon 库中的 folder / folder-open 图标；不要使用 chevron / triangle。
3. 确保目录 row button 或 treeitem 具备 `aria-expanded`。
4. 确保目录 row button `cursor: pointer`。
5. 保留展开 / 收起点击行为。

修改 `src/components/WikiLibraryHome.tsx`：

1. 移除右侧 `.pl-wiki-library-folder-icon` 及 `▾`。
2. 如果已经按 Phase 5 改成 flat 文档列表，此处应自然无命中。

修改 `src/app/app.css`：

1. 将 `.pl-wiki-sidebar-title` 从 `font-semibold` 降为 `font-medium`。
2. 将 `.pl-wiki-tree-group-toggle` 目录文字从 `font-semibold` 降为 `font-medium`，并设置 `cursor-pointer`。
3. 将 `.pl-wiki-library-group-title` 或新文档列表标题按 spec 降噪。
4. 将 `.pl-wiki-library-item-title` 视情况保持 `font-medium`，文档标题可比路径略重。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected: Triangle removal and typography tests PASS。

### Phase 8: Upload Preflight Tests

修改 `src/__tests__/wiki.test.tsx`：

1. 触发 `上传 Markdown` 预检。
2. 在 `wiki-upload-target` 中断言：
   - 新建上传仍有 `目标目录` input；
   - 路径预览 label 或 section 文案是 `目标 Wiki 路径`；
   - `.md` 文件路径不被 `目标目录` label 包裹为唯一描述。
3. 断言新建 / 覆盖状态使用稳定 badge 或状态节点，例如 `wiki-upload-target-status`。
4. 在 `wiki-upload-summary` 中断言每个 row 有 label/value class 或 test id：
   - `wiki-upload-summary-source`
   - `wiki-upload-summary-target`
   - `wiki-upload-summary-existing`
   - `wiki-upload-summary-title`
   - `wiki-upload-summary-refs`
5. 断言 `解析摘要` 中 label 使用 muted class contract，value 使用 value class contract。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected before implementation: FAIL。

### Phase 9: Implement Upload Preflight IA

修改 `src/components/WikiUploadPreflight.tsx`：

1. 在目标 section 中区分：
   - `目标目录` input（仅 create mode）；
   - `目标 Wiki 路径` path preview；
   - `新建文档` / `覆盖现有 Markdown 文档` status badge。
2. 不再使用单独段落 `将新建 Markdown 文档。`。
3. 将 `关联表` 纳入 `解析摘要` 的 description list，而不是额外 `p`。
4. 为 `dt` / `dd` 增加 className，例如：
   - `.pl-wiki-preflight-summary-label`
   - `.pl-wiki-preflight-summary-value`
5. 文件名、路径、关联表继续加翻译防御。

修改 `src/app/app.css`：

1. `.pl-wiki-preflight-summary-list` 使用两列 grid。
2. `.pl-wiki-preflight-summary-row` 使用 `grid-template-columns: minmax(96px, 128px) minmax(0, 1fr)`。
3. label muted，value 正文；长路径允许换行或截断但不溢出。
4. 新增 `.pl-wiki-preflight-target-status` 或等价 badge 样式。
5. CSS scoped 到 upload preflight 的新 class，避免影响 save / restore / move preflight。

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- src/__tests__/wiki.test.tsx
```

Expected: PASS。

### Phase 10: Terminology And Build Verification

运行：

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm run lint:terminology
npm test -- src/__tests__/catalog.test.tsx src/__tests__/wiki.test.tsx
npm run build
git diff --check
```

Expected：全部 PASS。`npm run build` 允许保留当前已知 Vite chunk size warning。

### Phase 11: Browser Verification

本轮是用户明确要求浏览器核查后的改动，完成实现后需要桌面浏览器复核：

1. 打开 `http://127.0.0.1:55176/catalog`。
2. 确认 `superstore_orders`、`superstore_people` 表名不再明显加粗。
3. 打开 `http://127.0.0.1:55176/wiki`。
4. 确认页面不再出现 `▼`、`▶`、`▾`、`▸`。
5. 确认目录和首页文档列表不再大面积粗体化。
6. 确认首页只保留统计摘要作为主要说明。
7. 确认右侧为 Markdown 文档列表，并展示文档路径 metadata。
8. 点击 `上传 Markdown`，选择测试 `.md` 文件进入预检。
9. 确认目标区和解析摘要层级清晰。
10. 取消预检，不执行最终上传。

不做移动窄屏专项验证。

### Phase 12: Ledger Update

修改：

- `docs/ui-ux-feedback/pages/catalog.md`
- `docs/ui-ux-feedback/pages/wiki.md`

要求：

1. 将本轮对应反馈记录为 M64。
2. 实现完成但浏览器复核前标记为 `Fixed`。
3. 浏览器复核通过后标记为 `Verified`。
4. Notes 中记录核心实现文件：
   - `webui/src/app/app.css`
   - `webui/src/components/WikiTree.tsx`
   - `webui/src/components/WikiLibraryHome.tsx`
   - `webui/src/components/WikiUploadPreflight.tsx`
   - `webui/src/pages/Catalog.tsx`（如有触及）
   - `webui/src/__tests__/catalog.test.tsx`
   - `webui/src/__tests__/wiki.test.tsx`

## Acceptance Criteria

- `/catalog` 表名链接视觉权重降到正文级别，并保留链接可发现性。
- `/wiki` 页面没有小三角 glyph。
- 左侧 Wiki 目录仍可展开 / 收起，且可访问语义明确。
- `/wiki` 首页只保留文档数 / 目录数统计摘要，不再展示冗余 hero title。
- `/wiki` 右侧展示 Markdown 文档列表，不再重复完整目录树。
- 上传 Markdown 预检目标区区分目标目录、目标 Wiki 路径和新建 / 覆盖状态。
- 上传 Markdown 预检解析摘要使用清晰的 label/value 两列层级。
- 文件名、路径、目录 key、表名、Markdown / Wiki / Schema / Table / Agent / MCP 等术语有翻译防御。
- `npm run lint:terminology`、相关测试、`npm run build`、`git diff --check` 通过。
- 浏览器复核通过后，台账状态更新为 `Verified`。

## Code Review Checklist

- [ ] 没有 triangle / chevron glyph 残留在 Wiki 首页和目录树可见文本中。
- [ ] 去掉小三角后，左侧目录展开 / 收起仍可发现、可键盘访问、可读屏。
- [ ] 右侧文档列表以 Markdown 文档为主，路径 metadata 不抢主视觉。
- [ ] Catalog 表名降重后仍保留 hover underline / focus ring。
- [ ] Upload preflight 的 CSS 只影响上传预检，不破坏保存 / 恢复 / 移动预检。
- [ ] 所有新增文案符合术语标准。
- [ ] 长路径、长文档标题、长目录 key 不溢出。
- [ ] 不动后端 API、安全边界、路由和数据契约。
