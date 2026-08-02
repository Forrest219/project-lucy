# M56 — Business Wiki Directory and Document Governance

> codex 直投 prompt：请在 `/Users/forrest/Projects/project-lucy/webui` 开工。先读 `../docs/58-business-wiki-directory-document-governance-spec.md`、`../docs/49-business-wiki-md-library-operations-spec.md`、`../docs/53-business-wiki-empty-directory-resource-spec.md`、`../docs/55-business-wiki-version-history-restore-spec.md`、`../docs/00-product-terminology-standard.md`、`../../docs/DEVELOPMENT.md` 和本工单。目标是修复 `/wiki` 的顶层目录创建、目录删除、文档移动目录、下载作用域和上传预检表达。结束后必须做 code review；浏览器验证仅在用户明确要求或 Docker 重建后执行。

## 0. 背景

Docker 重建后的 `/wiki` 浏览器复核确认：

- `UX-WIKI-008` 仍失败：清空 `父级目录` 后回到 `global`，预览为 `wiki/global/<目录>/`。
- `UX-WIKI-010` 仍失败：目录操作菜单缺少 `删除目录`。
- `UX-WIKI-011` 仍失败：文档页缺少 `移动到目录`。
- `UX-WIKI-012` 仍失败：下载按钮仍为 `下载 Markdown`，作用域不清楚。
- `UX-WIKI-013` 仍需修复：上传预检没有清楚表达本地文件名、目标 Wiki 路径、当前标题和上传后标题。

本工单承接 `webui/docs/58-business-wiki-directory-document-governance-spec.md`。

## 1. 范围

### 1.1 预期修改区域

- `server/wiki.ts`
- `server/fs-safe.ts`
- `server/index.ts`
- `server/__tests__/wiki.test.ts`
- `src/lib/types.ts`
- `src/lib/queryKeys.ts`
- `src/lib/wiki.ts`
- `src/pages/WikiEditor.tsx`
- `src/components/WikiNewDirectoryDialog.tsx`
- `src/components/WikiTree.tsx`
- 新增 `src/components/WikiMoveDocumentDialog.tsx`
- `src/components/WikiUploadPreflight.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`
- `docs/ui-ux-feedback/pages/wiki.md`
- `docs/ui-ux-feedback/README.md`

实际文件以当前代码结构为准，不为迁就本列表做搬迁。

### 1.2 不做

- 不实现目录递归删除。
- 不实现批量移动 / 批量下载。
- 不实现目录重命名。
- 不实现回收站。
- 不改变 MCP `wiki_search` / `wiki_read` 的业务结果。

## 2. 开工前置

在 `webui/` 目录执行并记录结果：

```bash
pwd
node -v
git -C /Users/forrest/Projects/project-lucy status --short
```

阅读：

- `../docs/58-business-wiki-directory-document-governance-spec.md`
- `../docs/49-business-wiki-md-library-operations-spec.md`
- `../docs/53-business-wiki-empty-directory-resource-spec.md`
- `../docs/55-business-wiki-version-history-restore-spec.md`
- `../docs/00-product-terminology-standard.md`
- `../../docs/DEVELOPMENT.md`
- `../../docs/ui-ux-feedback/pages/wiki.md`

如果工作树已有无关脏改动，只记录并避开，不得回滚。

## 3. 任务拆分

### T1. 修复顶层目录创建语义

修改 `src/pages/WikiEditor.tsx` 和 `src/components/WikiNewDirectoryDialog.tsx`：

- 不再把空父级目录 normalize 成 `global`。
- 新建目录 dialog 增加明确的 `顶层目录` 选项。
- 当选择 `顶层目录` 时，预览为 `wiki/<name>/`。
- 提交 payload 使用 `{ path: name }` 或 `{ parent: "", name }`。

修改 `server/wiki.ts`：

- 确认 `createWikiDirectory(projectRoot, { path: "ops" })` 写 `wiki/ops/`。
- 如当前 `{ parent: "", name: "ops" }` 不支持，则补齐。

测试：

- `server/__tests__/wiki.test.ts` 覆盖 top-level directory create。
- `src/__tests__/wiki.test.tsx` 覆盖清空 / 选择顶层目录后预览 `wiki/<name>/`。

### T2. 增加目录删除 API 与安全删除

修改 `server/fs-safe.ts`：

- 新增 `safeRemoveDirectory(projectRoot, relPath)`。
- 必须复用 `resolveWritable`。
- 拒绝 symlink。
- 只允许删除空目录；不得 recursive 删除。

修改 `server/wiki.ts`：

- 新增 `deleteWikiDirectory(projectRoot, path)`。
- 目录不存在返回 `WIKI_DIRECTORY_NOT_FOUND`。
- 非空目录返回 `WIKI_DIRECTORY_NOT_EMPTY`。
- 删除成功后更新 `wiki/.lucy-directories.json`。

修改 `server/index.ts`：

```ts
app.delete("/api/wiki/directories/:path", ...)
```

注意：目录 path 需要 URL encode；路由必须放在泛化 Wiki routes 前。

测试：

- 空目录删除成功。
- 非空目录删除失败。
- traversal / symlink 删除失败。
- API route 返回正确 envelope。

### T3. 增加目录删除 UI

修改 `src/components/WikiTree.tsx`：

- 目录 `...` menu 增加 `删除目录`。
- 对非空目录可置 disabled，并说明原因；或点击后在确认 dialog 中阻止。

新增或复用确认 dialog：

- Title：`删除目录`
- 展示目录路径。
- 空目录确认按钮 `删除目录`。
- 非空目录展示阻止原因。

修改 `src/pages/WikiEditor.tsx`：

- 接入 delete mutation。
- 成功后 invalidate `queryKeys.wiki`。
- toast `目录已删除`。

测试：

- menu contains `删除目录`。
- 空目录删除调用 API。
- 非空目录不会直接调用删除 API。

### T4. 增加文档移动 API

修改 `server/wiki.ts`：

- 新增 `previewWikiMove(projectRoot, key, input)`。
- 新增 `moveWiki(projectRoot, key, input)`。
- 目标 key = `${targetDirectory}/${basename(key)}`。
- 目标存在返回 `WIKI_MOVE_TARGET_EXISTS`。
- 源不存在返回 `WIKI_NOT_FOUND`。
- 移动时创建目标目录 metadata / physical directory if needed。
- 成功后：
  - target file exists；
  - source file removed；
  - version history index 从 old key 迁到 new key；
  - 新增 `move` version，带 `previousKey`。

修改 `server/index.ts`：

```ts
app.post("/api/wiki/:key/move/preview", ...)
app.post("/api/wiki/:key/move", ...)
```

这些 routes 必须放在 `GET /api/wiki/:key` / `PUT /api/wiki/:key` 之前。

测试：

- preview returns source / target path。
- move preserves content。
- target conflict fails。
- move creates version history record。

### T5. 增加文档移动 UI

新增 `src/components/WikiMoveDocumentDialog.tsx`：

Props 建议：

```ts
type WikiMoveDocumentDialogProps = {
  open: boolean;
  keyName: string;
  directories: string[];
  preview: WikiMovePreview | null;
  error: string | null;
  isLoading: boolean;
  isMoving: boolean;
  onTargetDirectoryChange: (directory: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};
```

UI：

- Title：`移动到目录`
- 展示当前路径、目标路径、目标目录。
- 路径使用 `code.notranslate`。
- Confirm：`确认移动`。

修改 `WikiEditor.tsx`：

- 已保存文档 Header actions 增加 `移动到目录`。
- 打开 dialog 时先预览当前目录。
- 目标目录变化时重新 preview。
- confirm 后调用 move API。
- 成功后 `setSearchParams({ key: result.key }, { replace: true })`。
- invalidate `queryKeys.wiki`、old / new `queryKeys.wikiPage`、old / new `queryKeys.wikiVersions`。

测试：

- `移动到目录` 按钮可见。
- 预检显示目标路径。
- confirm 调用 move API。
- 成功后 URL 切换新 key。

### T6. 下载作用域改文案

修改 `src/pages/WikiEditor.tsx`：

- `下载 Markdown` 改为 `下载当前 Markdown`。
- 可加 `title="下载当前选中的已保存 Markdown"`。

测试：

- selected document action text 为 `下载当前 Markdown`。
- library home 不出现该按钮。
- 现有下载 raw Markdown 测试更新按钮查询。

### T7. 上传预检信息架构升级

修改 `server/wiki.ts`：

- `previewWikiUpload` 返回：
  - `sourceFileName`
  - `targetKey`
  - `existingTitle`
  - `targetTitle` / `title`
  - `mode`
- 当 source filename basename 与 target key basename 不一致，追加 warning。

修改 `src/pages/WikiEditor.tsx`：

- preview upload payload 带 `sourceFileName: uploadFileName`。
- commit upload payload 已带 source filename，保留。

修改 `src/components/WikiUploadPreflight.tsx`：

- Summary 区拆成 labeled rows：
  - `本地文件名`
  - `目标 Wiki 路径`
  - `当前被覆盖文档`
  - `上传后标题`
- 覆盖模式说明：`将用本地文件内容覆盖当前 Wiki 文档。`
- 本地文件名与 target basename 不一致时显示 warning。

测试：

- upload create preflight 显示本地文件名和目标路径。
- upload replace preflight 显示 existing title 和 proposed title。
- basename mismatch warning visible。

### T8. 台账和索引

更新：

- `docs/ui-ux-feedback/pages/wiki.md`
  - `UX-WIKI-008` 至 `UX-WIKI-013` 修复后更新为 `Fixed`。
  - Notes 写明主要文件和非浏览器验证命令。
- `docs/ui-ux-feedback/README.md`
  - 最近维护记录追加 M56。
- `webui/docs/README.md`
  - 登记 `58-business-wiki-directory-document-governance-spec.md`。
- `webui/docs/plans/README.md`
  - 登记 `wo-M56-business-wiki-directory-document-governance.md`。

## 4. 验证命令

必须运行：

```bash
npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

如本轮明确要求浏览器验证，追加：

1. 打开 `/wiki`。
2. 创建顶层目录并确认它与 `global` 平级。
3. 删除该空目录并刷新确认消失。
4. 移动一个临时 Markdown 文档到另一个目录。
5. 验证 URL、目录树和版本记录 `move`。
6. 验证下载按钮为 `下载当前 Markdown`。
7. 选择本地 Markdown 文件，验证上传预检字段齐全。

## 5. 验收清单

- [ ] 顶层目录创建预览和实际路径一致。
- [ ] `global` 不再是唯一可发现父级。
- [ ] 空目录可删除。
- [ ] 非空目录不会被静默删除。
- [ ] 目录删除走 `fs-safe`。
- [ ] 文档可移动到已有目录。
- [ ] 文档移动冲突有明确错误。
- [ ] 文档移动后 URL、目录树、内容一致。
- [ ] 文档移动新增 `move` 版本记录。
- [ ] 下载按钮明确为 `下载当前 Markdown`。
- [ ] 上传预检显示本地文件名、目标 Wiki 路径、当前被覆盖文档、上传后标题。
- [ ] 上传文件名与目标 key 不一致时有 warning。
- [ ] 术语 lint 通过。
- [ ] Wiki server 与 frontend tests 通过。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 删除误删文档 | v0.1 只允许空目录删除，不 recursive |
| 移动破坏版本历史 | 先写 server tests，强制验证 `previousKey` 和新 key history |
| 顶层目录和 `global` 默认冲突 | UI 明确 `顶层目录` 选项，不再把空值 normalize 为 `global` |
| 上传预检过载 | 用紧凑 labeled rows，不写长说明卡片 |

回滚方式：

- 回退 delete / move API 和 UI。
- 保留已有 Wiki Markdown 内容。
- 如移动中断，优先以实际存在的 Markdown 文件为事实源，版本 index 可通过后续修复脚本重建。
