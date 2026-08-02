# Business Wiki Empty Directory Resource Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Empty Directory Resource Spec |
| 文档类型 | Product / UX / API / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M51-business-wiki-empty-directory-resource.md` |
| 事实来源 | 2026-08-02 用户反馈、浏览器核查、`docs/ui-ux-feedback/pages/wiki.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/49-business-wiki-md-library-operations-spec.md`、`webui/docs/52-business-wiki-directory-tree-and-density-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

M50 已将 `/wiki` 左侧目录升级为真实层级树，并让目录行展示 `N 篇` 与 scoped create 入口。但 2026-08-02 浏览器核查和用户反馈进一步确认：

1. 页面上存在两个裸 `+`，视觉上无法判断分别代表什么。
2. 两个 `+` 点击后均打开标题为 `新建文档` 的同一弹窗。
3. 用户预期是 `新建目录` 和 `新建文档` 两个独立操作。
4. 用户明确要求支持“空目录”独立存在，即目录不能再完全依赖 Markdown 文档路径推导。

因此，本 Spec 将 Business Wiki 目录从“由 Markdown key 隐式推导的视图节点”升级为“一等资源”。空目录可以被创建、展示、刷新后保留，并可作为后续上传 Markdown 或新建文档的目标目录。

## 2. 目标

- 支持空 Wiki 目录独立持久化，不要求目录下已有 Markdown 文档。
- 将 `新建目录` 与 `新建文档` 拆成两个清晰、独立的用户操作。
- 消除裸 `+` 的语义歧义，使用明确的按钮、图标、tooltip 和 aria-label。
- 让空目录在左侧目录树和默认首页目录列表中显示为 `0 篇`。
- 保持现有 Markdown 文档读写、上传、下载和 `wiki_search` / `wiki_read` 行为不被破坏。
- 保持写入安全边界：所有目录元数据和物理目录都只能位于项目 `wiki/` 根目录下。

## 3. 非目标

- 不实现目录重命名、拖拽移动、批量移动 Markdown 文档。
- 不实现删除非空目录。
- 不改变 Markdown 文档 frontmatter 格式。
- 不把空目录暴露给 MCP `wiki_search` 作为可检索文档。
- 不引入数据库表或远端 CMS；目录仍是本地项目文件系统资源。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Wiki Directory | Wiki 目录 / 目录 | 文件夹 | 菜单、项目 | `wiki/` 下可独立存在的目录资源 |
| Empty Wiki Directory | 空目录 | 无文档目录 | 空菜单、空项目 | 没有 Markdown 文档但已持久化的 Wiki 目录 |
| New Directory | 新建目录 | 新建子目录 | 新建 folder | 创建 Wiki 目录资源 |
| New Document | 新建文档 | 新建 Markdown 文档 | 新建 Wiki 混用 | 创建 `.md` 文档草稿 |

文案要求：

- UI 主文案使用 `目录`、`子目录`、`新建目录`、`新建文档`、`Markdown 文档`。
- 可在 tooltip 或帮助文案中补充“文件夹”，但按钮主文案不得使用 `folder`。
- `Wiki`、`Markdown`、路径、文件名、目录 key 必须加 `translate="no"` 与 `notranslate`。

## 5. 数据模型

### 5.1 目录事实源

新增目录元数据文件：

```text
wiki/.lucy-directories.json
```

建议格式：

```json
{
  "schemaVersion": 1,
  "directories": [
    {
      "path": "global",
      "createdAt": "2026-08-02T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:00:00.000Z"
    },
    {
      "path": "ops/playbooks",
      "createdAt": "2026-08-02T10:01:00.000Z",
      "updatedAt": "2026-08-02T10:01:00.000Z"
    }
  ]
}
```

规则：

- `wiki/.lucy-directories.json` 是显式目录的持久化事实源。
- Markdown key 仍会推导隐式目录，例如 `ops/playbooks/demo.md` 会推导出 `ops` 和 `ops/playbooks`。
- API 返回目录时必须合并显式目录和 Markdown 推导目录，并去重。
- 如果用户创建 `ops/playbooks`，系统必须同时保证祖先目录 `ops` 可见；祖先目录可以作为 derived ancestor 返回，也可显式写入 metadata。
- `global` 是默认目录，但不是唯一父级。初始化或读取时若没有任何目录和文档，应至少返回 `global`。

### 5.2 物理目录

创建目录时应尽量同步创建物理目录：

```text
wiki/ops/
wiki/ops/playbooks/
```

但空目录能否被 git 或 zip 保留不应依赖物理目录本身；跨环境和导出发布以 `wiki/.lucy-directories.json` 为准。

### 5.3 类型契约

后端建议新增：

```ts
type WikiDirectorySummary = {
  path: string;
  name: string;
  documentCount: number;
  explicit: boolean;
  empty: boolean;
  createdAt?: string;
  updatedAt?: string;
};

type WikiListResponse = {
  pages: WikiSummary[];
  directories: WikiDirectorySummary[];
};
```

前端目录树 helper 应同时接受 `pages` 和 `directories`：

```ts
buildWikiDirectoryTree({
  pages,
  directories
});
```

## 6. API 契约

### 6.1 `GET /api/wiki`

保持现有 `pages` 字段，新增 `directories` 字段：

```json
{
  "ok": true,
  "data": {
    "pages": [
      {
        "key": "global/demo-superstore.md",
        "summary": "demo-superstore",
        "tags": [],
        "slRefs": []
      }
    ],
    "directories": [
      {
        "path": "global",
        "name": "global",
        "documentCount": 1,
        "explicit": true,
        "empty": false
      },
      {
        "path": "ops",
        "name": "ops",
        "documentCount": 0,
        "explicit": true,
        "empty": true
      }
    ]
  }
}
```

兼容要求：

- 旧前端只读取 `pages` 时不应崩溃。
- 新前端必须以 `directories ?? []` 兼容旧开发服务。

### 6.2 `POST /api/wiki/directories`

创建空目录。

请求：

```json
{
  "parent": "ops",
  "name": "playbooks"
}
```

也允许直接传完整 path：

```json
{
  "path": "ops/playbooks"
}
```

响应：

```json
{
  "ok": true,
  "data": {
    "directory": {
      "path": "ops/playbooks",
      "name": "playbooks",
      "documentCount": 0,
      "explicit": true,
      "empty": true,
      "createdAt": "2026-08-02T10:01:00.000Z",
      "updatedAt": "2026-08-02T10:01:00.000Z"
    },
    "created": true,
    "filePath": "wiki/ops/playbooks/"
  }
}
```

错误：

| Code | HTTP | 条件 | 用户文案 |
|---|---:|---|---|
| `WIKI_DIRECTORY_INVALID` | 400 | 空 path、空 name、包含 `.` / `..`、绝对路径、path traversal | 目录路径不合法 |
| `WIKI_DIRECTORY_CONFLICT` | 409 | 目标路径已存在为 Markdown 文件或非目录文件 | 目标路径已被文件占用 |
| `FORBIDDEN_PATH` | 403 | fs-safe 判断写入逃逸或 symlink 风险 | 目录路径不在允许范围内 |

幂等性：

- 创建已存在目录返回 `created: false`，不报错。
- 已存在目录的 `updatedAt` 可不变；不得重复写入重复条目。

### 6.3 删除目录

本轮不要求实现删除目录。若实现删除，只允许删除：

- metadata 中显式存在；
- 没有子目录；
- 没有 Markdown 文档；
- 物理目录为空或只包含系统允许的目录元数据。

## 7. 安全与写入边界

- 新增 `normalizeWikiDirectoryPath`，与 `normalizeWikiKey` 分离。
- 目录 path 不允许：
  - 空字符串；
  - 绝对路径；
  - `.` 或 `..` segment；
  - `../` 或 `/../`；
  - 反斜杠逃逸；
  - 以 `.` 开头的用户目录名。
- 写入 `wiki/.lucy-directories.json` 必须走 `safeWrite`。
- 如创建物理目录，应新增 `safeMkdir` / `safeEnsureDirectory` 或等价 helper，复用 `fs-safe.ts` 的 realpath / symlink / allowlist 检查，不得直接裸 `mkdir`。
- `wiki/.lucy-directories.json` 不应被 `walkMarkdown` 当作 Wiki 文档。
- 所有 API 用户可见错误必须遵守 `webui/docs/00-product-terminology-standard.md`。

## 8. 信息架构与交互

### 8.1 左侧目录 Header

左侧 `目录` Header 不再使用裸 `+`。

推荐结构：

```text
目录          [新建目录] [新建文档]
搜索文档标题、标签、关联表...
```

如果侧栏宽度不足，使用 lucide icon buttons：

- `FolderPlus`：aria-label `新建目录`，tooltip `新建目录`。
- `FilePlus`：aria-label `新建文档`，tooltip `新建文档`。

### 8.2 目录行动作

目录行不再只显示裸 `+`。推荐使用 `MoreHorizontal` 行内菜单：

```text
▾ global                      1 篇   [...]
  - 新建子目录
  - 在此目录新建文档
```

行为：

- `新建子目录` 打开 `WikiNewDirectoryDialog`。
- `在此目录新建文档` 打开 `WikiNewDocumentDialog`。
- 两个弹窗标题、字段、确认按钮必须不同。

### 8.3 新建目录弹窗

标题：`新建目录`

字段：

- `父级目录`：可选择已有目录，默认 `global` 或触发目录。
- `目录名称`：单段名称，不允许 `/`。
- `目标路径`：只读预览，例如 `wiki/global/playbooks/`。

确认按钮：`创建目录`

成功后：

- 关闭弹窗。
- 重新拉取 `/api/wiki`。
- 目录树展开到新目录。
- toast：`目录已创建`。

### 8.4 新建文档弹窗

标题：`新建文档`

字段保持：

- `目标目录`
- `文件名`
- `目标路径`，例如 `wiki/global/new-note.md`

确认按钮：`创建草稿`

不得复用 `新建目录` 的确认文案。

### 8.5 空目录展示

- 空目录显示 `0 篇`。
- 空目录下不显示“没有匹配的 Wiki 页面”全局空态；该空态只用于整棵树没有结果。
- 默认首页中空目录也应显示，用户可点击目录行或菜单继续创建文档。

## 9. 验收标准

### 9.1 浏览器验收

1. 打开 `/wiki`，左侧目录 Header 不再出现语义不明的裸 `+`。
2. Header 中 `新建目录` 与 `新建文档` 是两个独立操作。
3. 点击 `新建目录`，弹窗标题为 `新建目录`，确认按钮为 `创建目录`。
4. 创建 `ops` 后，不创建任何 Markdown 文档，目录树立即显示 `ops 0 篇`。
5. 刷新 `/wiki` 后，`ops 0 篇` 仍存在。
6. 在 `ops` 行选择 `新建子目录`，创建 `playbooks` 后显示 `ops -> playbooks 0 篇`。
7. 在 `ops/playbooks` 行选择 `在此目录新建文档`，新建文档弹窗默认目标目录为 `ops/playbooks`。
8. 点击 `新建文档`，弹窗标题为 `新建文档`，确认按钮为 `创建草稿`。
9. 创建第一篇文档后，父目录和子目录文档数从 `0 篇` 更新为 `1 篇`。

### 9.2 自动化验收

- Server tests:
  - `normalizeWikiDirectoryPath` 拒绝 path traversal、绝对路径、`.` / `..`、隐藏目录名。
  - `POST /api/wiki/directories` 创建空目录并写入 `wiki/.lucy-directories.json`。
  - 重复创建同一目录返回 `created: false`。
  - `GET /api/wiki` 合并 explicit directories 与 Markdown-derived directories。
  - 空目录不出现在 `pages`。
- Frontend tests:
  - `WikiListResponse` 支持 `directories`。
  - `buildWikiDirectoryTree` 支持空目录和 `0 篇`。
  - `WikiTree` 渲染空目录，目录行菜单包含 `新建子目录` 与 `在此目录新建文档`。
  - Header `新建目录` 与 `新建文档` 打开不同 dialog。
  - `WikiNewDirectoryDialog` 目标路径预览以 `/` 结尾。
- Validation commands:
  - `npm test -- --run server/__tests__/wiki.test.ts src/__tests__/wiki.test.tsx`
  - `npm run lint:terminology`
  - `npm run build`
  - `git diff --check`

## 10. 迁移与兼容

- 没有 `wiki/.lucy-directories.json` 的项目：
  - `GET /api/wiki` 仍按 Markdown key 推导目录。
  - 如果没有任何 Wiki 文档，返回默认目录 `global`。
- 现有 Wiki 文档无需迁移。
- 首次创建目录时写入 metadata 文件。
- 不需要 reindex；空目录不是 MCP 可检索文档。
- 语义资产导出如包含 `wiki/`，应包含 `wiki/.lucy-directories.json`，以保留空目录。

## 11. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| metadata 文件与物理目录不一致 | API 以 metadata + Markdown key 合并结果为准，物理目录仅作本地表现 |
| 空目录被误认为可被 `wiki_search` 检索 | UI 明确显示 `0 篇`，MCP 搜索仍只返回 Markdown 文档 |
| 裸 `+` 改为多个动作后侧栏拥挤 | 使用 lucide icon + tooltip，目录行用 More 菜单承载低频动作 |
| 直接 mkdir 可能绕过 fs-safe | 新增 safe directory helper 并补 symlink / path traversal 测试 |
| 隐藏 metadata 文件被用户手改损坏 | 读取失败时返回可解释错误，不静默丢失目录；后续可增加 repair |

## 12. 回滚

- 回滚前端 `新建目录` UI、`WikiNewDirectoryDialog`、目录菜单和相关测试。
- 回滚后端 `POST /api/wiki/directories`、目录 metadata 读写 helper 和 `GET /api/wiki` 的 `directories` 字段。
- 不删除用户已有 Markdown 文档。
- 对已生成的 `wiki/.lucy-directories.json`，回滚时可保留在磁盘；旧代码会忽略该隐藏文件。

## 13. Implementation Status

Status: Fixed

2026-08-02 已落地：

- 后端支持 `wiki/.lucy-directories.json` 作为显式目录事实源，并通过 `safeMkdir` 与 `safeWrite` 保持写入边界。
- `GET /api/wiki` 返回 `pages` 与 `directories`；`POST /api/wiki/directories` 支持创建空目录并幂等返回。
- 前端目录树和默认首页支持 API 返回的空目录，显示 `0 篇`，并允许目录名搜索命中空目录。
- 左侧目录 Header 拆分为 `新建目录` 与 `新建文档`，目录行 More 菜单拆分为 `新建子目录` 与 `在此目录新建文档`。
- 本轮按用户约束只做非浏览器验证；浏览器验收清单仍作为后续 `Verified` 依据。
