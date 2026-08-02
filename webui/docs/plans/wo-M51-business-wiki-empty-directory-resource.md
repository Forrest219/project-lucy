# M51 — Business Wiki Empty Directory Resource

> codex 直投 prompt：请在 `/Users/forrest/Projects/project-lucy/webui` 开工。先读 `../docs/53-business-wiki-empty-directory-resource-spec.md`、`../docs/52-business-wiki-directory-tree-and-density-spec.md`、`../docs/49-business-wiki-md-library-operations-spec.md`、`../docs/00-product-terminology-standard.md`、`../../docs/DEVELOPMENT.md` 和本工单。目标是让 `/wiki` 支持空目录独立存在，并将 `新建目录` 与 `新建文档` 拆成两个独立操作。必须新增后端目录持久化，不再只依赖 Markdown key 推导目录。

## 0. 背景

M50 已解决 `/wiki` 全局导航、目录树层级、计数单位和首页密度问题。Docker 重建后的浏览器复核显示这些问题已通过，但新的用户反馈确认：

- 页面上有两个裸 `+`。
- 两个 `+` 点击后都打开 `新建文档` 弹窗。
- 用户预期 `新建目录` 与 `新建文档` 是独立操作。
- 用户明确要求支持“空目录”独立存在。

本工单承接 `webui/docs/53-business-wiki-empty-directory-resource-spec.md`。它是后端 API + 前端 IA 的功能变更，不是纯样式修复。

## 1. 范围

### 1.1 预期修改区域

- `server/wiki.ts`
- `server/index.ts`
- `server/fs-safe.ts`
- `server/__tests__/wiki.test.ts`
- `src/lib/types.ts`
- `src/lib/queryKeys.ts`
- `src/lib/wiki.ts`
- `src/components/WikiTree.tsx`
- `src/components/WikiLibraryHome.tsx`
- `src/components/WikiNewDocumentDialog.tsx`
- 新增 `src/components/WikiNewDirectoryDialog.tsx`
- `src/pages/WikiEditor.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`
- `docs/ui-ux-feedback/pages/wiki.md`

实际文件以当前代码结构为准，不为迁就本列表做搬迁。

### 1.2 不做

- 不实现目录重命名。
- 不实现拖拽移动或批量移动 Markdown 文档。
- 不删除非空目录。
- 不改变 Markdown frontmatter。
- 不让 MCP `wiki_search` 返回空目录。
- 不修改 Lucy MCP Proxy runtime instructions。

## 2. 开工前置

在 `webui/` 目录执行并记录结果：

```bash
pwd
node -v
git -C /Users/forrest/Projects/project-lucy status --short
```

阅读：

- `../docs/53-business-wiki-empty-directory-resource-spec.md`
- `../docs/52-business-wiki-directory-tree-and-density-spec.md`
- `../docs/49-business-wiki-md-library-operations-spec.md`
- `../docs/00-product-terminology-standard.md`
- `../../docs/DEVELOPMENT.md`

如果工作树已有无关脏改动，只记录并避开，不得回滚。

## 3. 任务拆分

### T1. 后端目录 path 校验与 fs-safe 目录写入

修改 `server/wiki.ts`：

- 新增 `normalizeWikiDirectoryPath(path: string): string`。
- 与 `normalizeWikiKey` 分离；目录 path 不要求 `.md` 后缀。
- 拒绝：
  - 空 path；
  - 绝对路径；
  - `.` / `..` segment；
  - path traversal；
  - 反斜杠逃逸；
  - 以 `.` 开头的用户目录 segment。

修改 `server/fs-safe.ts`：

- 新增 `safeMkdir(projectRoot: string, relPath: string): Promise<void>` 或等价 helper。
- 复用 `resolveWritable` 的 allowlist、denylist、realpath、symlink 防护。
- 只允许在 `wiki/` 等既有 allowlist 内创建目录，不得裸 `mkdir`。

测试 `server/__tests__/wiki.test.ts`：

- `normalizeWikiDirectoryPath("ops/playbooks")` 返回 `ops/playbooks`。
- 拒绝 `../x`、`/tmp/x`、`ops/../x`、`.hidden`、`ops/.hidden`。
- `safeMkdir` 不允许通过 symlink parent 逃逸项目根。

### T2. 目录 metadata 读写

修改 `server/wiki.ts`：

- 新增 metadata 常量：`wiki/.lucy-directories.json`。
- 新增类型：

```ts
type WikiDirectoryMetadata = {
  schemaVersion: 1;
  directories: Array<{
    path: string;
    createdAt: string;
    updatedAt: string;
  }>;
};
```

- 新增 helper：
  - `readWikiDirectoryMetadata(projectRoot)`
  - `writeWikiDirectoryMetadata(projectRoot, metadata)`
  - `listExplicitWikiDirectories(projectRoot)`
  - `createWikiDirectory(projectRoot, input)`

写入规则：

- metadata 写入必须走 `safeWrite(projectRoot, "wiki/.lucy-directories.json", json)`。
- 写入前排序并去重。
- 创建 `ops/playbooks` 时，确保 `ops` 和 `ops/playbooks` 都能被列表返回。
- 重复创建同一路径返回 `created: false`。
- metadata 文件缺失时按空列表处理。
- metadata JSON 损坏时返回用户可解释错误，不静默清空。

测试：

- 首次创建 `ops` 写入 metadata。
- 重复创建 `ops` 不产生重复条目。
- 创建 `ops/playbooks` 后列表包含 `ops` 与 `ops/playbooks`。
- 空目录不出现在 `pages`。

### T3. 扩展 Wiki list API 与新增目录 API

修改 `server/wiki.ts`：

- `listWiki(projectRoot)` 保持返回 pages 或拆出 `listWikiPages(projectRoot)`，避免破坏内部调用。
- 新增 `listWikiDirectories(projectRoot)`：
  - 从 metadata 读取显式目录。
  - 从 Markdown keys 推导目录。
  - 合并去重。
  - 计算 subtree `documentCount`。
  - 标记 `explicit`、`empty`。
  - 无目录无文档时返回 `global 0 篇`。

修改 `server/index.ts`：

- `GET /api/wiki` 返回 `{ pages, directories }`。
- 新增：

```ts
app.post<{ Body: WikiDirectoryCreateInput }>("/api/wiki/directories", ...)
```

- POST 成功后把 `wiki/.lucy-directories.json` 和可选物理目录登记到 `writtenFiles`，以便 diff / review 能看到。

测试：

- `GET /api/wiki` 返回 existing pages 与 explicit empty directories。
- `POST /api/wiki/directories` 创建目录后再 `GET /api/wiki` 可见 `0 篇`。
- 创建 path 被文件占用时返回 `WIKI_DIRECTORY_CONFLICT`。

### T4. 前端类型与目录树 helper 支持空目录

修改 `src/lib/types.ts`：

- 新增 `WikiDirectorySummary`。
- 扩展 `WikiListResponse`：

```ts
export type WikiListResponse = {
  pages: WikiSummary[];
  directories?: WikiDirectorySummary[];
};
```

修改 `src/lib/wiki.ts`：

- 让 `buildWikiDirectoryTree` 接受 `{ pages, directories }` 或新增 `buildWikiDirectoryTreeFromPagesAndDirectories`。
- 空目录节点 `documentCount` 为 0。
- 目录搜索支持目录名匹配：命中目录名时显示该目录及其子树。
- 保留根目录 Markdown 文件与 top-level 目录并存边界测试。

测试 `src/__tests__/wiki.test.tsx`：

- 只有 `{ path: "ops" }`、无 pages 时，树包含 `ops 0 篇`。
- `{ path: "ops/playbooks" }` 自动显示 `ops -> playbooks`。
- 目录名搜索 `playbooks` 命中空目录。

### T5. 拆分 Header 与目录行动作

修改 `src/pages/WikiEditor.tsx` 与 `src/components/WikiTree.tsx`：

- 左侧 `目录` Header 不再渲染裸 `+`。
- Header 至少提供两个独立动作：
  - `新建目录`
  - `新建文档`
- 如果使用 icon-only button，使用 `lucide-react`：
  - `FolderPlus`：aria-label `新建目录`
  - `FilePlus`：aria-label `新建文档`
- 目录行不再渲染裸 `+`。
- 目录行使用 `MoreHorizontal` menu 或等价动作菜单，包含：
  - `新建子目录`
  - `在此目录新建文档`

验收：

- DOM 中不再存在两个语义不明的裸 `+`。
- `新建目录` 和 `新建文档` 点击后打开不同 dialog。
- `在此目录新建文档` 默认目录为当前目录。
- `新建子目录` 默认父级目录为当前目录。

### T6. 新增 WikiNewDirectoryDialog

新增 `src/components/WikiNewDirectoryDialog.tsx`：

Props 建议：

```ts
type WikiNewDirectoryDialogProps = {
  open: boolean;
  directories: string[];
  defaultParentDirectory: string;
  error: string | null;
  onCancel: () => void;
  onConfirm: (input: { parent: string; name: string }) => void;
};
```

UI：

- Title：`新建目录`
- Description：`选择父级目录，并输入新的目录名称。`
- `父级目录` input / datalist。
- `目录名称` input，placeholder `playbooks`。
- `目标路径` preview：`wiki/<父级目录>/<目录名称>/`。
- Footer：
  - `取消`
  - `创建目录`

要求：

- 目标路径 preview 的路径节点加 `notranslate` / `translate="no"`。
- `目录名称` 不允许输入 `/`，但最终以后端校验为准。

测试：

- 默认父级目录为 `global`。
- 输入 `playbooks` 后 preview 为 `wiki/global/playbooks/`。
- 点击 `创建目录` 调用 POST `/api/wiki/directories`。

### T7. WikiEditor 接入目录 API

修改 `src/pages/WikiEditor.tsx`：

- 从 `listQuery.data?.directories ?? []` 取得目录列表。
- `uploadDirectories` 改名或扩展为 `wikiDirectories`，包含空目录。
- 新增 state：
  - `newDirectoryOpen`
  - `newDirectoryError`
  - `newDirectoryParent`
- 新增 mutation：
  - `createDirectoryMutation` -> `apiPost("/api/wiki/directories", body)`
- 成功后：
  - invalidate `queryKeys.wiki`
  - 关闭 dialog
  - toast `目录已创建`
  - 展开目录树到新目录；若当前组件不支持受控展开，至少确保刷新后可见。
- `WikiNewDocumentDialog` 的目录候选也必须包含空目录。

测试：

- Header `新建目录` 创建 `ops` 后，fetch mock 被 POST `/api/wiki/directories`。
- list response 包含 empty directory 时，树显示 `ops 0 篇`。
- 在 `ops` 下新建文档时 default directory 是 `ops`。

### T8. WikiLibraryHome 与 CSS 收尾

修改 `src/components/WikiLibraryHome.tsx`：

- 使用目录列表 + pages 构建 tree。
- 空目录显示 `0 篇`。
- 首页目录行也不把空目录隐藏。

修改 `src/app/app.css`：

- 删除或废弃裸 `+` 相关样式。
- 新增：
  - `.pl-wiki-sidebar-actions`
  - `.pl-wiki-sidebar-action`
  - `.pl-wiki-tree-group-menu`
  - `.pl-wiki-directory-dialog-*`
- 保持 M50 的 compact library layout。

验收：

- `/wiki` 默认首页中能看到空目录。
- 目录列表仍紧凑，无大面积 stretch 回归。

### T9. 台账与文档索引

更新：

- `docs/ui-ux-feedback/pages/wiki.md`
  - 新增 `UX-WIKI-007: 新建目录与新建文档未拆分且不支持空目录`，状态 `Fixed` 或 `Verified` 视是否完成浏览器复核。
- `webui/docs/README.md`
  - 登记 `53-business-wiki-empty-directory-resource-spec.md`。
- `webui/docs/plans/README.md`
  - 登记 `wo-M51-business-wiki-empty-directory-resource.md`。

本工单实施完成但未做浏览器验证时，台账只能标 `Fixed`，不能标 `Verified`。

## 4. 验证命令

必须运行：

```bash
npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

建议追加：

```bash
npm test -- --run src/__tests__/app-shell.test.tsx
```

若用户明确要求浏览器验证，追加 Playwright / browser check：

1. 打开 `/wiki`。
2. 创建空目录 `ops`。
3. 刷新页面。
4. 验证 `ops 0 篇` 仍存在。
5. 在 `ops` 下创建子目录 `playbooks`。
6. 验证 `ops -> playbooks 0 篇`。
7. 点击 `在此目录新建文档`，验证目标目录默认 `ops/playbooks`。

## 5. 验收清单

- [x] `新建目录` 与 `新建文档` 是两个独立操作。
- [x] 目录 Header 不再只有裸 `+`。
- [x] 目录行不再只有裸 `+`。
- [x] `新建目录` dialog 标题为 `新建目录`，确认按钮为 `创建目录`。
- [x] `新建文档` dialog 标题为 `新建文档`，确认按钮为 `创建草稿`。
- [x] `POST /api/wiki/directories` 可创建空目录。
- [x] `wiki/.lucy-directories.json` 写入目录 metadata。
- [x] 刷新后空目录仍显示。
- [x] 空目录显示 `0 篇`。
- [x] 空目录可作为上传 Markdown 和新建文档目标目录。
- [x] 现有 Markdown 文档读写、上传、下载不回归。
- [x] 术语 lint 通过。
- [x] Wiki server 与 frontend tests 通过。

## 7. 落地记录

- 2026-08-02：已实现后端目录 metadata、`POST /api/wiki/directories`、`GET /api/wiki` 的 `directories` 返回、前端空目录树、新建目录弹窗、目录行 More 菜单，以及长期台账 `UX-WIKI-007` 状态更新。
- 2026-08-02：本轮按用户约束不做浏览器验证；台账状态保持 `Fixed`，不标记 `Verified`。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| metadata 文件损坏导致目录列表失败 | 返回明确错误；后续可加 repair，不静默清空 |
| 空目录与 Markdown 推导目录重复 | 后端列表合并去重，测试覆盖 |
| 物理目录无法被 git 保留 | 以 `wiki/.lucy-directories.json` 为跨环境事实源 |
| 目录 API 绕过 fs-safe | 新增 `safeMkdir` 并覆盖 symlink / traversal 测试 |
| 前端双动作增加侧栏拥挤 | Header 使用 icon + tooltip，目录行用 More 菜单 |

回滚方式：

- 回退本工单新增 API、metadata helper、前端 dialog、目录 action menu 和测试。
- 不删除用户已有 Markdown 文件。
- 可保留 `wiki/.lucy-directories.json`；旧代码会忽略该隐藏文件。
