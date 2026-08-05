# Business Wiki Directory and Document Governance Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Directory and Document Governance Spec |
| 文档类型 | Product / UX / IA / API / Data Contract / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M56-business-wiki-directory-document-governance.md` |
| 事实来源 | 2026-08-02 用户反馈、Docker 重建后浏览器复核、`docs/ui-ux-feedback/pages/wiki.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/49-business-wiki-md-library-operations-spec.md`、`webui/docs/53-business-wiki-empty-directory-resource-spec.md`、`webui/docs/55-business-wiki-version-history-restore-spec.md`、`docs/DEVELOPMENT.md` |

## 1. Background

Business Wiki 已完成目录树、空目录、上传覆盖和版本恢复的基础能力，但 2026-08-02
Docker 重建后的浏览器复核确认仍存在 5 个企业治理缺口：

- `UX-WIKI-008`：顶层空目录创建仍不可发现。清空 `父级目录` 后输入框回到 `global`，预览变成 `wiki/global/<目录>/`，用户无法明确创建 `wiki/<目录>/` 顶层 sibling。
- `UX-WIKI-010`：目录 `...` 菜单没有 `删除目录`。
- `UX-WIKI-011`：已保存 Markdown 文档没有 `移动到目录` 能力。
- `UX-WIKI-012`：`下载 Markdown` 作用域不清晰，用户不确定是当前文档还是全部下载。
- `UX-WIKI-013`：上传预检没有清楚区分本地文件名、目标 Wiki 路径、当前被覆盖文档标题和上传后标题，导致“上传覆盖”语义怪异。

这些问题共享同一个产品边界：Business Wiki 不只是 Markdown 编辑器，而是企业内部知识资产库。目录、文档、上传、下载和移动 / 删除都必须有明确作用域、预检和可恢复 / 可追溯机制。

## 2. Goals

1. 让 `global` 不再看起来是唯一父级；支持可发现、可验证的顶层目录创建。
2. 为目录提供受保护的删除能力，至少支持空目录删除。
3. 为已保存 Markdown 文档提供 `移动到目录`，并接入版本记录中的 `move` 操作。
4. 将下载命令作用域产品化为 `下载当前 Markdown`。
5. 改善上传预检，让本地源文件、目标 Wiki 文档、覆盖对象和上传后标题清晰可理解。
6. 保持所有写入继续走 `fs-safe.ts`，不得越过 `wiki/` allowlist。
7. 更新 UI/UX 长期台账状态，修复后为 `Fixed`，浏览器复核通过后为 `Verified`。

## 3. Non-goals

- 不实现批量删除、批量移动、目录递归移动或目录重命名。（目录重命名已独立为 Spec 109 / `UX-WIKI-044`，不在本 Spec 范围。）
- 不实现软删除回收站；删除保护先通过确认、阻止非空目录和版本记录降低风险。
- 不实现全量审计报表；只补足当前写入 API 的 `writtenFiles` 与 Wiki 版本记录。
- 不改变 MCP `wiki_read` / `wiki_search` 的业务语义。
- 不实现移动时的多人协同冲突合并。
- 不做移动窄屏专项验证，除非后续工单明确要求。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Top-level Wiki Directory | 顶层目录 | Wiki 根目录下的目录 | 空父级目录 | `wiki/<目录>/`，与 `global` 平级 |
| Delete Directory | 删除目录 | 移除空目录 | 删除 folder | 删除 Wiki 目录资源 |
| Move Markdown Document | 移动到目录 | 移动文档 | 移动 folder（用于文档） | 将当前 Markdown key 移到目标目录 |
| Move Preflight | 移动预检 | 移动确认 | 覆盖预检混用 | 移动前展示当前路径、目标路径和影响 |
| Current Markdown Download | 下载当前 Markdown | 下载当前文档 | 下载 Markdown（无作用域） | 下载当前选中的已保存 Markdown |
| Upload Target | 目标 Wiki 路径 | 目标文档路径 | 目标（单独使用） | 上传将写入的 `wiki/<key>` |
| Upload Source File | 本地文件名 | 上传源文件 | 文件（单独使用） | 用户从本机选择的 Markdown 文件名 |

Protected terms:

- `Markdown`
- `Wiki`
- `global`
- 文件名、目录路径、Wiki key、version id、hash

路径、文件名、Wiki key、version id、hash DOM 节点必须添加 `notranslate` / `translate="no"`。

## 5. Target UX

### 5.1 顶层目录创建

`新建目录` dialog 必须明确支持两种模式：

| 模式 | 用户输入 | 预览 | API payload |
|---|---|---|---|
| 顶层目录 | 父级目录为空或选择 `顶层目录` | `wiki/<name>/` | `{ path: "<name>" }` 或 `{ parent: "", name }` |
| 子目录 | 父级目录为 `global` / `ops` 等 | `wiki/<parent>/<name>/` | `{ parent, name }` |

UI 要求：

- `父级目录` 输入不能在用户清空后自动回填 `global`。
- 建议使用 select / combobox，第一项为 `顶层目录`，后续为已有目录。
- 预览必须与提交 payload 和最终目录树一致。
- 创建成功后，顶层目录显示为 `目录名 0 篇`，与 `global` 平级。

### 5.2 目录删除

目录行 `...` 菜单新增 `删除目录`。

规则：

- 空目录可删除。
- 非空目录默认阻止删除，提示“该目录下仍有 Markdown 文档或子目录，请先移动或删除内容”。
- 删除确认 dialog 展示：
  - 目录路径；
  - 是否为空；
  - 删除后不可在目录树中继续选择；
  - 确认按钮 `删除目录`。
- 删除成功后刷新：
  - `queryKeys.wiki`
  - 当前目录树
  - 文档库首页

本轮不递归删除 Markdown 文档。

### 5.3 文档移动到目录

已保存文档页 Header actions 增加 `移动到目录`。

流程：

1. 点击 `移动到目录`。
2. 打开 `移动预检` dialog。
3. 用户选择已有目录或输入新目录。
4. Dialog 展示：
   - 当前 Wiki 路径；
   - 目标 Wiki 路径；
   - 目标目录是否新建；
   - 与版本记录关系：会生成 `move` 记录。
5. 确认后移动文件。
6. URL 替换为新 key，目录树选中新文档。
7. `版本记录` 中新增 `move` 记录，包含 `previousKey` 和新 `key`。

约束：

- 目标 key 已存在时必须阻止，提示用户换目录或文件名。
- 移动不改变 Markdown 内容。
- 移动后历史版本应随文档迁移；`GET /api/wiki/:newKey/versions` 可以看到旧版本链。
- 旧 key 的版本入口不应再可用，除非未来实现 redirect。

### 5.4 下载当前 Markdown

选中文档页按钮改为：

```text
下载当前 Markdown
```

要求：

- 只在 `mode === "loaded"` 时显示。
- 下载当前选中的已保存 Markdown。
- 如果正在编辑且有未保存内容，继续提示“下载的是已保存版本”。
- `/wiki` 文档库首页不显示单文档下载动作。
- 未来如支持批量导出，必须另起 `导出目录` / `下载全部`，不能复用此按钮。

### 5.5 上传预检信息架构

`上传 Markdown 预检` 和 `上传覆盖预检` 都必须区分以下概念：

| 字段 | 新建上传 | 覆盖上传 |
|---|---|---|
| 本地文件名 | 必显 | 必显 |
| 目标 Wiki 路径 | 必显 | 必显 |
| 当前被覆盖文档 | 不显示或显示 `无` | 必显：当前 key 和当前标题 |
| 上传后标题 | 必显 | 必显 |
| 结果说明 | 将新建 Markdown 文档 | 将用本地文件内容覆盖当前 Wiki 文档 |

如果本地文件名和目标 key basename 不一致：

- 显示 warning：`本地文件名与目标 Wiki 文件名不一致，请确认覆盖对象。`
- 仍允许确认，但确认按钮文案必须与模式一致：`确认上传` / `确认覆盖`。

上传新文档成功后：

- URL 切换到新 key。
- 目录树中显示并选中新文档。
- 若目标目录此前为空，`documentCount` 更新。

## 6. Data and API Contract

### 6.1 Directory create fix

Existing `POST /api/wiki/directories` can stay, but frontend must stop normalizing empty parent to `global`.

Request examples:

```json
{ "path": "ops" }
```

```json
{ "parent": "ops", "name": "playbooks" }
```

Acceptance:

- `{ "path": "ops" }` creates `wiki/ops/`.
- `{ "parent": "", "name": "ops" }` also creates `wiki/ops/` if supported.
- The API response `filePath` matches the UI preview.

### 6.2 Delete directory

Add:

```http
DELETE /api/wiki/directories/:path
```

Path parameter is URL-encoded, e.g. `/api/wiki/directories/ops%2Fplaybooks`.

Response:

```json
{
  "ok": true,
  "data": {
    "path": "ops/playbooks",
    "deleted": true,
    "filePath": "wiki/ops/playbooks/"
  }
}
```

Errors:

| Code | Status | Meaning |
|---|---:|---|
| `WIKI_DIRECTORY_NOT_FOUND` | 404 | 目录不存在 |
| `WIKI_DIRECTORY_NOT_EMPTY` | 409 | 目录下仍有 Markdown 文档或子目录 |
| `WIKI_DIRECTORY_INVALID` | 400 | 路径非法 |

Implementation note:

- `safeRemoveDirectory(projectRoot, relPath)` may be added to `fs-safe.ts`, but must reject symlink and path traversal.
- Do not use recursive deletion for non-empty directories.
- Metadata `wiki/.lucy-directories.json` must remove the explicit directory entry.

### 6.3 Move document

Add preview:

```http
POST /api/wiki/:key/move/preview
```

Request:

```json
{
  "targetDirectory": "ops/playbooks"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "key": "global/demo-superstore.md",
    "targetKey": "ops/playbooks/demo-superstore.md",
    "sourceFilePath": "wiki/global/demo-superstore.md",
    "targetFilePath": "wiki/ops/playbooks/demo-superstore.md",
    "targetDirectoryExists": true,
    "targetExists": false,
    "title": "Demo Superstore"
  }
}
```

Confirm:

```http
POST /api/wiki/:key/move
```

Response:

```json
{
  "ok": true,
  "data": {
    "key": "ops/playbooks/demo-superstore.md",
    "previousKey": "global/demo-superstore.md",
    "filePath": "wiki/ops/playbooks/demo-superstore.md"
  }
}
```

Errors:

| Code | Status | Meaning |
|---|---:|---|
| `WIKI_NOT_FOUND` | 404 | 源 Markdown 不存在 |
| `WIKI_MOVE_TARGET_EXISTS` | 409 | 目标 Markdown 已存在 |
| `WIKI_DIRECTORY_INVALID` | 400 | 目标目录非法 |

Version history:

- Move succeeds only after current Markdown and version index are updated.
- Add `move` version metadata with `previousKey`.
- Existing snapshot files may remain in the same docHash directory for v0.1, but `index.documents` must be addressable by new key.
- `writtenFiles` includes source path, target path, `wiki/.lucy-history/index.json`, and `wiki/.lucy-directories.json` if a target directory is created.

### 6.4 Upload preview response

Extend `WikiUploadPreview`:

```ts
type WikiUploadPreview = WikiPreview & {
  exists: boolean;
  title: string;
  slRefs: string[];
  warnings: string[];
  sourceFileName?: string;
  targetKey: string;
  targetTitle?: string;
  existingTitle?: string;
  mode: "create" | "replace";
};
```

Frontend must pass `sourceFileName` to both preview and commit.

## 7. Frontend Requirements

### 7.1 Components

New or modified components:

- `WikiNewDirectoryDialog.tsx`
  - Support explicit top-level directory option.
  - Do not normalize empty parent to `global`.
- `WikiTree.tsx`
  - Directory menu adds `删除目录`.
  - Non-empty directories show disabled / guarded delete behavior.
- `WikiMoveDocumentDialog.tsx`
  - New component for move preview and confirm.
- `WikiUploadPreflight.tsx`
  - Add local filename, target Wiki path, existing title, proposed title, mismatch warning.
- `WikiEditor.tsx`
  - Add `移动到目录`.
  - Rename download button to `下载当前 Markdown`.
  - Wire delete / move mutations and invalidations.

### 7.2 Interaction details

- Do not put destructive actions behind icon-only controls without visible confirmation.
- Use `删除目录` in menu, not bare `删除`.
- Use `移动到目录`, not `移动 folder`.
- Confirmation buttons:
  - `删除目录`
  - `确认移动`
  - `确认覆盖`
- All paths / filenames in dialog bodies use `code.notranslate`.

### 7.3 Visual density

- Keep dialogs compact and workbench-style.
- Do not add instructional cards or landing-page copy.
- Do not introduce a second page sidebar.
- Error and warning text should sit next to the affected target path, not only in a toast.

## 8. Testing Requirements

### 8.1 Server tests

Add / update `webui/server/__tests__/wiki.test.ts`:

- Top-level directory creation:
  - `{ path: "ops" }` creates `wiki/ops/`.
  - `{ parent: "", name: "ops" }` creates `wiki/ops/` if supported.
- Directory deletion:
  - empty directory deletion succeeds.
  - non-empty directory deletion returns `WIKI_DIRECTORY_NOT_EMPTY`.
  - symlink / traversal deletion is rejected.
- Move document:
  - preview returns source and target paths.
  - move writes target, removes source, preserves content.
  - target conflict returns `WIKI_MOVE_TARGET_EXISTS`.
  - move creates a `move` version with `previousKey`.
- Upload preview:
  - source filename is returned.
  - existing title and proposed title are distinct when covering another document.

### 8.2 Frontend tests

Add / update `webui/src/__tests__/wiki.test.tsx`:

- New directory dialog can select / keep top-level directory and preview `wiki/<name>/`.
- Directory row menu contains `删除目录`.
- Delete empty directory shows confirm dialog and calls API.
- Non-empty directory delete is blocked or requires high-risk state.
- Selected document page shows `移动到目录`.
- Move preflight shows source path, target path and calls move API.
- Download action says `下载当前 Markdown`.
- Upload preflight shows:
  - local filename;
  - target Wiki path;
  - existing title;
  - proposed title;
  - mismatch warning when applicable.

### 8.3 Browser verification

After Docker rebuild:

1. Open `/wiki`.
2. Create a top-level directory `browser-top-<id>` and verify it appears as a sibling of `global`.
3. Delete that empty directory and verify it disappears after refresh.
4. Create a temporary document and move it to another directory.
5. Verify URL and directory tree update.
6. Verify `版本记录` includes `移动`.
7. Verify selected document action says `下载当前 Markdown`.
8. Upload a local Markdown file as new document and verify the tree selects it.
9. Upload the same file over an existing selected document and verify upload preflight explains local filename, target path, existing title and proposed title.

## 9. Ledger Updates

Expected status transitions:

- `UX-WIKI-008`: `Open` -> `Fixed` after code, `Verified` after browser check.
- `UX-WIKI-010`: `Open` -> `Fixed` after code, `Verified` after browser check.
- `UX-WIKI-011`: `Open` -> `Fixed` after code, `Verified` after browser check.
- `UX-WIKI-012`: `Open` -> `Fixed` after code, `Verified` after browser check.
- `UX-WIKI-013`: `Open` -> `Fixed` after code, `Verified` after browser check.

Also update `docs/ui-ux-feedback/README.md` recent maintenance record.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Directory delete accidentally removes Markdown documents | Block non-empty delete in v0.1; no recursive deletion |
| Moving a document breaks history lookup | Move index document entry to new key and add `move` version |
| Top-level directory support conflicts with `global` default | Make `顶层目录` explicit in UI and tests |
| Upload preflight becomes too verbose | Use compact labeled rows, not long explanatory paragraphs |
| Existing hidden history directories leak into Wiki list | Keep `walkMarkdown` skipping dot directories; retain tests |
