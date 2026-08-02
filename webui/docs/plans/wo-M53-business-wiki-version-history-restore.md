# M53 — Business Wiki Version History and Restore

> codex 直投 prompt：请在 `/Users/forrest/Projects/project-lucy/webui` 开工。先读 `../docs/55-business-wiki-version-history-restore-spec.md`、`../docs/49-business-wiki-md-library-operations-spec.md`、`../docs/53-business-wiki-empty-directory-resource-spec.md`、`../docs/00-product-terminology-standard.md`、`../../docs/DEVELOPMENT.md` 和本工单。目标是为 `/wiki` Markdown 文档增加最近 5 版版本记录、历史预览和恢复到指定版本能力。必须保证历史快照不进入 `GET /api/wiki` pages，也不暴露给 `wiki_search`。

## 0. 背景

浏览器核查确认 `/wiki` 当前存在高风险覆盖路径：用户上传 `指标服务表设计草案.md`
时可能覆盖当前选中的 `global/demo-superstore.md`，且页面没有版本记录、上传源文件名、
首次创建时间、最近上传时间或恢复能力。

本工单承接 `webui/docs/55-business-wiki-version-history-restore-spec.md`。它是后端历史快照 + API + 前端恢复流程的企业治理能力。

## 1. 范围

### 1.1 预期修改区域

- `server/wiki.ts`
- `server/fs-safe.ts`
- `server/index.ts`
- `server/__tests__/wiki.test.ts`
- `src/lib/types.ts`
- `src/lib/queryKeys.ts`
- `src/pages/WikiEditor.tsx`
- 新增 `src/components/WikiVersionHistoryDialog.tsx`
- 新增 `src/components/WikiRestorePreflight.tsx`
- `src/app/app.css`
- `src/__tests__/wiki.test.tsx`
- `docs/ui-ux-feedback/pages/wiki.md`

实际文件以当前代码结构为准，不为迁就本列表做搬迁。

### 1.2 不做

- 不实现无限版本保留。
- 不实现多人协同冲突合并。
- 不实现目录 / 文档删除、移动、重命名。
- 不实现远端对象存储或数据库表。
- 不让历史快照进入 MCP `wiki_search`。

## 2. 开工前置

在 `webui/` 目录执行并记录结果：

```bash
pwd
node -v
git -C /Users/forrest/Projects/project-lucy status --short
```

阅读：

- `../docs/55-business-wiki-version-history-restore-spec.md`
- `../docs/49-business-wiki-md-library-operations-spec.md`
- `../docs/53-business-wiki-empty-directory-resource-spec.md`
- `../docs/00-product-terminology-standard.md`
- `../../docs/DEVELOPMENT.md`

如果工作树已有无关脏改动，只记录并避开，不得回滚。

## 3. 任务拆分

### T1. 后端版本 metadata 与快照基础设施

修改 `server/wiki.ts`：

- 新增常量：
  - `WIKI_HISTORY_INDEX_PATH = "wiki/.lucy-history/index.json"`
  - `WIKI_HISTORY_SNAPSHOT_ROOT = "wiki/.lucy-history/snapshots"`
  - `WIKI_VERSION_RETENTION_LIMIT = 5`
- 新增类型：

```ts
type WikiVersionOperation =
  | "create"
  | "edit_save"
  | "upload_create"
  | "upload_replace"
  | "restore"
  | "move"
  | "rename"
  | "delete";

type WikiVersionSummary = {
  versionId: string;
  key: string;
  createdAt: string;
  operation: WikiVersionOperation;
  title?: string;
  summary?: string;
  sourceFileName?: string;
  previousKey?: string;
  restoredFromVersionId?: string;
  contentHash: string;
};
```

- 新增 helper：
  - `readWikiHistoryIndex(projectRoot)`
  - `writeWikiHistoryIndex(projectRoot, index)`
  - `wikiDocumentHash(key)`
  - `wikiContentHash(markdown)`
  - `createWikiVersionSnapshot(projectRoot, key, markdown, metadata)`
  - `pruneWikiVersions(projectRoot, key)`

修改 `server/fs-safe.ts`：

- 如裁剪快照需要删除文件，新增 `safeRemove(projectRoot, relPath)`。
- `safeRemove` 必须复用 `resolveWritable`，并拒绝删除目录外路径。

测试 `server/__tests__/wiki.test.ts`：

- `createWikiVersionSnapshot` 写入 `wiki/.lucy-history/index.json` 和 snapshot `.md`。
- `walkMarkdown` / `listWiki` 不返回 `wiki/.lucy-history/**`。
- 同一 key 生成 6 版后只保留最近 5 版。
- `safeRemove` 拒绝 symlink / path traversal 删除。

### T2. 接入创建、编辑保存和上传覆盖版本生成

修改 `server/wiki.ts`：

- `writeWiki(projectRoot, key, input)`：
  - 首次写入不存在 key 时生成 `create` 版本。
  - 已存在 key 保存时生成 `edit_save` 版本。
  - 如果内容 hash 与当前版本相同，不重复生成版本。
- `commitWikiUpload(projectRoot, input)`：
  - 新建上传生成 `upload_create` 版本。
  - 覆盖上传生成 `upload_replace` 版本。
  - 记录 `sourceFileName`；如果当前 upload input 没有 filename，需要扩展类型和前端调用。
- `previewWikiWrite` 和 `previewWikiUpload` 不写版本。

测试：

- 创建新文档生成 `create`。
- 编辑保存生成 `edit_save`。
- 上传新文档生成 `upload_create`。
- 上传覆盖生成 `upload_replace`，并记录 `sourceFileName`。
- 重复保存同内容不新增版本。

### T3. 新增版本 API

修改 `server/wiki.ts`：

- 新增：
  - `listWikiVersions(projectRoot, key)`
  - `readWikiVersion(projectRoot, key, versionId)`
  - `previewWikiVersionRestore(projectRoot, key, versionId)`
  - `restoreWikiVersion(projectRoot, key, versionId)`

修改 `server/index.ts`：

```ts
app.get("/api/wiki/:key/versions", ...)
app.get("/api/wiki/:key/versions/:versionId", ...)
app.post("/api/wiki/:key/versions/:versionId/restore/preview", ...)
app.post("/api/wiki/:key/versions/:versionId/restore", ...)
```

注意：

- `:key` 当前已有 `/api/wiki/:key` 路由，新增版本路由必须放在更具体位置，避免被原路由吞掉。
- 成功恢复后把 `wiki/<key>`、`wiki/.lucy-history/index.json` 和 snapshot 文件登记到 `writtenFiles`。

测试：

- `GET /api/wiki/:key/versions` 倒序返回列表。
- `GET /api/wiki/:key/versions/:versionId` 返回 raw Markdown 和当前 Diff。
- `restore/preview` 不写入磁盘。
- `restore` 写回当前 Markdown，并新增 `restore` 版本。
- 非法 version id 返回 `WIKI_VERSION_NOT_FOUND` 或 `WIKI_VERSION_INVALID`。

### T4. 前端类型、queryKeys 与 API 客户端接入

修改 `src/lib/types.ts`：

- 新增：
  - `WikiVersionOperation`
  - `WikiVersionSummary`
  - `WikiVersionDetail`
  - `WikiVersionListResponse`
  - `WikiVersionRestorePreview`
  - `WikiVersionRestoreResult`

修改 `src/lib/queryKeys.ts`：

- 新增：

```ts
wikiVersions: (key: string) => ["wiki", "versions", key] as const
```

测试：

- TypeScript build 通过。
- 前端 wiki tests 的 fetch mock 支持 `/api/wiki/:key/versions` 和 restore API。

### T5. 新增版本记录 UI

新增 `src/components/WikiVersionHistoryDialog.tsx`：

Props 建议：

```ts
type WikiVersionHistoryDialogProps = {
  open: boolean;
  keyName: string;
  versions: WikiVersionSummary[];
  selectedVersion?: WikiVersionDetail | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onSelectVersion: (versionId: string) => void;
  onRestore: (versionId: string) => void;
};
```

UI 要求：

- Title：`版本记录`
- 展示 `保留最近 5 版`
- 列表项展示：
  - 操作时间；
  - 操作类型中文；
  - 标题；
  - 上传源文件名（如有）；
  - `查看`；
  - `恢复此版本`。
- 右侧或下方展示 Markdown 预览和 Diff。

新增 `src/components/WikiRestorePreflight.tsx`：

- Title：`恢复预检`
- 展示当前文档、来源版本、恢复后标题、Diff。
- 按钮：
  - `取消`
  - `确认恢复`

文案节点中路径、文件名、version id、hash 加 `notranslate` / `translate="no"`。

### T6. WikiEditor 接入版本记录和恢复流程

修改 `src/pages/WikiEditor.tsx`：

- 已选中文档 Header 增加 `版本记录`。
- 点击后拉取 `queryKeys.wikiVersions(key)`。
- 选择版本时请求详情 API。
- 点击 `恢复此版本` 时先请求 restore preview，打开 `WikiRestorePreflight`。
- 确认恢复后调用 restore API：
  - invalidate `queryKeys.wiki`
  - invalidate 当前 page query
  - invalidate `queryKeys.wikiVersions(key)`
  - toast `已恢复历史版本`
  - 回到 read mode

测试 `src/__tests__/wiki.test.tsx`：

- 文档页面存在 `版本记录` 按钮。
- 打开后显示最近版本和 `保留最近 5 版`。
- 点击 `查看` 显示 raw Markdown / Diff。
- 点击 `恢复此版本` 打开 `恢复预检`。
- 点击 `确认恢复` 调用 restore API，并刷新当前文档。

### T7. 上传源文件名传递

修改 `src/pages/WikiEditor.tsx` 和上传 API payload：

- `previewWikiUpload` 可继续不保存文件名，但 `commitWikiUpload` 必须收到：

```ts
sourceFileName: uploadFileNameFromBrowser
```

- 覆盖上传记录显示本地源文件名，例如 `指标服务表设计草案.md`。

测试：

- 覆盖上传后版本列表中出现 `上传源文件：指标服务表设计草案.md`。

### T8. 台账与文档索引

更新：

- `docs/ui-ux-feedback/pages/wiki.md`
  - 新增 `UX-WIKI-009: Markdown 覆盖/编辑缺少版本记录与恢复能力`，状态 `Open` 或实现后 `Fixed`。
- `docs/ui-ux-feedback/README.md`
  - 最近维护记录追加 M53。
- `webui/docs/README.md`
  - 登记 `55-business-wiki-version-history-restore-spec.md`。
- `webui/docs/plans/README.md`
  - 登记 `wo-M53-business-wiki-version-history-restore.md`。

## 4. 验证命令

必须运行：

```bash
npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx
npm run lint:terminology
npm run build
git diff --check
```

如本轮明确要求浏览器验证，追加：

1. 打开 `/wiki?key=global/demo-superstore.md`。
2. 点击 `版本记录`。
3. 验证最近版本、上传源文件名和操作类型可见。
4. 查看历史版本，验证 Markdown 预览和 Diff。
5. 执行恢复预检和确认恢复。
6. 验证当前内容恢复，并新增 `恢复` 版本记录。

## 5. 验收清单

- [x] 每篇 Markdown 默认保留最近 5 版。
- [x] 创建文档生成 `create` 版本。
- [x] 编辑保存生成 `edit_save` 版本。
- [x] 上传新文档生成 `upload_create` 版本。
- [x] 上传覆盖生成 `upload_replace` 版本并记录上传源文件名。
- [x] 同内容重复保存不重复生成版本。
- [x] `GET /api/wiki/:key/versions` 可列版本。
- [x] 历史版本详情可预览 Markdown 和 Diff。
- [x] 恢复预检不写入磁盘。
- [x] 确认恢复写回当前 Markdown，并新增 `restore` 版本。
- [x] `wiki/.lucy-history/**` 不出现在 Wiki 文档列表。
- [x] 版本 UI 的路径、文件名、version id 有翻译防御。
- [x] 术语 lint 通过。
- [x] Wiki server 与 frontend tests 通过。

## 6. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 历史快照占用磁盘 | 每篇只保留最近 5 版 |
| 快照删除绕过 fs-safe | 新增 `safeRemove` 并测试 symlink / traversal |
| 恢复误操作覆盖当前内容 | 必须先展示 `恢复预检` |
| metadata 损坏导致版本列表不可用 | 返回明确错误，不静默清空 |
| 历史快照误入 Wiki 列表 | `walkMarkdown` 跳过隐藏目录，并加测试 |

回滚方式：

- 回退版本 API、历史写入 helper、版本 UI 和相关测试。
- 不删除用户已有 Markdown 文档。
- 可保留 `wiki/.lucy-history/**`；旧代码会跳过隐藏目录。
