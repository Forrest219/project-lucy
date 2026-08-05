# Business Wiki Version History and Restore Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Version History and Restore Spec |
| 文档类型 | Product / UX / API / Data Contract / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-02 |
| 关联页面 | `/wiki` |
| 关联工单 | `webui/docs/plans/wo-M53-business-wiki-version-history-restore.md` |
| 事实来源 | 2026-08-02 用户反馈、浏览器核查、`docs/ui-ux-feedback/pages/wiki.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/49-business-wiki-md-library-operations-spec.md`、`webui/docs/53-business-wiki-empty-directory-resource-spec.md`、`docs/DEVELOPMENT.md` |

> **UI 修订（2026-08-05）**：§8.2–8.3 弹窗列表与历史预览的前端呈现由 [`80-wiki-version-history-list-first-ux-spec.md`](80-wiki-version-history-list-first-ux-spec.md) 修订（列表优先、业务化列、当前行收敛、查看进全宽详情）。API / 快照存储 / 恢复预检契约仍以本文为准。

## 1. 背景

2026-08-02 的 `/wiki` 浏览器核查确认：用户将本机 `Downloads/指标服务表设计草案.md`
上传到当前选中的 `global/demo-superstore.md` 时，系统执行的是“覆盖当前文档”，而不是
“上传为同名新文档”。页面没有明显的上传记录、首次创建日期、最近上传日期、源文件名或
可恢复版本。一旦用户误覆盖，就只能依赖 git 或手工备份恢复，这不符合企业 Wiki 的基本治理预期。

因此，Business Wiki 需要把 Markdown 版本历史升级为一等能力：

- 每次创建、编辑保存、上传覆盖、恢复都生成版本记录。
- 默认保留每篇 Markdown 最近 5 版。
- 支持历史版本预览、Diff、恢复到指定版本。
- 恢复动作本身也生成新版本，保证审计链不断裂。

## 2. 目标

- 为每篇 Wiki Markdown 文档保留最近 5 版可恢复快照。
- 在文档详情页提供 `版本记录` 入口，展示创建、编辑、上传覆盖、恢复等操作历史。
- 支持查看历史版本 Markdown 内容和当前版本对比 Diff。
- 支持恢复到指定历史版本，并在恢复前展示恢复预检。
- 记录用户可理解的版本元信息：操作类型、时间、源文件名、原路径、目标路径、标题、内容 hash。
- 不让历史快照进入 `wiki_search` / `wiki_read` 检索结果。
- 保持写入安全边界：历史 metadata 和快照只能写入项目 `wiki/` 下的隐藏系统目录。

## 3. 非目标

- 不实现多人协同冲突合并。
- 不实现无限版本保留、全量审计报表或远端对象存储。
- 不实现分支、草稿审批或发布审批流。
- 不在本轮实现目录 / 文档删除、移动、重命名；但版本模型需要为这些动作预留字段。
- 不把版本历史暴露给 MCP `wiki_search` 作为可检索业务文档。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Wiki Version History | 版本记录 | 历史版本 | 历史记录泛化 | 某篇 Wiki Markdown 文档的版本快照列表 |
| Version Snapshot | 版本快照 | Markdown 快照 | 备份文件作为主术语 | 一次保存或上传前后的可恢复内容 |
| Restore Version | 恢复此版本 | 恢复到该版本 | 回滚数据库 | 将当前 Markdown 内容恢复为历史快照 |
| Restore Preflight | 恢复预检 | 恢复确认 | 覆盖预检混用 | 恢复前展示目标版本、当前版本和 Diff |
| Upload Source File | 上传源文件 | 源文件名 | 原文件混用 | 触发上传的本地 Markdown 文件名 |

文案要求：

- UI 主文案使用 `版本记录`、`历史版本`、`恢复此版本`、`恢复预检`。
- `Markdown`、文件名、路径、hash、version id 必须加 `translate="no"` 与 `notranslate`。
- 不把 `恢复` 写成 `回滚`，避免和数据库事务 / 发布回滚混淆。

## 5. 数据模型

### 5.1 历史事实源

新增隐藏目录：

```text
wiki/.lucy-history/
  index.json
  snapshots/
    <docHash>/
      <versionId>.md
```

规则：

- `wiki/.lucy-history/index.json` 是版本记录事实源。
- `wiki/.lucy-history/snapshots/**` 保存 Markdown 快照。
- `walkMarkdown` 必须继续跳过以 `.` 开头的目录，历史快照不得出现在 Wiki 文档列表。
- `docHash` 使用 normalized Wiki key 的 SHA-256 前 16 位，避免中文路径或斜杠造成目录问题。
- `versionId` 建议格式：`YYYYMMDDTHHmmssSSSZ-<shortHash>`。
- 每篇文档默认保留最近 5 版；超过 5 版时删除最旧快照和 index 条目。
- 保留数可先作为常量 `WIKI_VERSION_RETENTION_LIMIT = 5`，后续再配置化。

### 5.2 `index.json` 建议格式

```json
{
  "schemaVersion": 1,
  "documents": {
    "global/demo-superstore.md": {
      "key": "global/demo-superstore.md",
      "createdAt": "2026-08-02T10:00:00.000Z",
      "updatedAt": "2026-08-02T10:15:00.000Z",
      "currentVersionId": "20260802T101500000Z-a1b2c3d4",
      "versions": [
        {
          "versionId": "20260802T100000000Z-11111111",
          "createdAt": "2026-08-02T10:00:00.000Z",
          "operation": "create",
          "key": "global/demo-superstore.md",
          "title": "Demo Superstore",
          "summary": "Demo Superstore",
          "contentHash": "sha256:...",
          "snapshotPath": "wiki/.lucy-history/snapshots/9a5e.../20260802T100000000Z-11111111.md"
        },
        {
          "versionId": "20260802T101500000Z-a1b2c3d4",
          "createdAt": "2026-08-02T10:15:00.000Z",
          "operation": "upload_replace",
          "key": "global/demo-superstore.md",
          "title": "指标服务表设计草案",
          "sourceFileName": "指标服务表设计草案.md",
          "contentHash": "sha256:...",
          "snapshotPath": "wiki/.lucy-history/snapshots/9a5e.../20260802T101500000Z-a1b2c3d4.md"
        }
      ]
    }
  }
}
```

### 5.3 类型契约

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

type WikiVersionDetail = WikiVersionSummary & {
  rawMarkdown: string;
  diffFromCurrent: string;
};
```

## 6. 版本生成规则

### 6.1 创建文档

- `writeWiki` 首次写入不存在的 key 时，写入后生成 `create` 版本。
- `commitWikiUpload` 新建上传时，写入后生成 `upload_create` 版本，并记录 `sourceFileName`。

### 6.2 编辑保存

- 在线编辑保存成功后生成 `edit_save` 版本。
- 如果内容 hash 与当前版本完全相同，不重复生成版本；返回现有 `currentVersionId`。

### 6.3 上传覆盖

- `commitWikiUpload` 覆盖已有 key 成功后生成 `upload_replace` 版本。
- 必须记录 `sourceFileName`，并让前端展示“上传源文件”。
- 覆盖预检仍负责展示即将写入的内容 Diff；版本记录负责事后追溯和恢复。

### 6.4 恢复版本

- 恢复指定历史版本时，将该历史快照写回当前 key。
- 恢复动作必须生成新的 `restore` 版本，`restoredFromVersionId` 指向来源版本。
- 恢复不得删除历史版本；保留策略只在新增版本后裁剪超出最近 5 版的旧记录。

### 6.5 未来移动 / 重命名 / 删除

本轮不实现移动、重命名、删除，但版本 metadata 预留：

- `previousKey`
- `key`
- `operation: "move" | "rename" | "delete"`

后续实现时必须保证路径变更可追溯。

## 7. API 契约

### 7.1 `GET /api/wiki/:key/versions`

返回某篇 Markdown 文档的版本列表，按 `createdAt` 倒序。

```json
{
  "ok": true,
  "data": {
    "key": "global/demo-superstore.md",
    "retentionLimit": 5,
    "versions": [
      {
        "versionId": "20260802T101500000Z-a1b2c3d4",
        "key": "global/demo-superstore.md",
        "createdAt": "2026-08-02T10:15:00.000Z",
        "operation": "upload_replace",
        "title": "指标服务表设计草案",
        "sourceFileName": "指标服务表设计草案.md",
        "contentHash": "sha256:..."
      }
    ]
  }
}
```

### 7.2 `GET /api/wiki/:key/versions/:versionId`

返回历史版本详情、Markdown 原文和与当前版本的 Diff。

```json
{
  "ok": true,
  "data": {
    "versionId": "20260802T101500000Z-a1b2c3d4",
    "key": "global/demo-superstore.md",
    "createdAt": "2026-08-02T10:15:00.000Z",
    "operation": "upload_replace",
    "rawMarkdown": "# 指标服务表设计草案\n",
    "diffFromCurrent": "@@\n- old\n+ new\n"
  }
}
```

### 7.3 `POST /api/wiki/:key/versions/:versionId/restore/preview`

返回恢复预检，不写入磁盘。

```json
{
  "ok": true,
  "data": {
    "key": "global/demo-superstore.md",
    "versionId": "20260802T101500000Z-a1b2c3d4",
    "targetTitle": "指标服务表设计草案",
    "diff": "@@\n- current\n+ historical\n"
  }
}
```

### 7.4 `POST /api/wiki/:key/versions/:versionId/restore`

执行恢复，并生成新的 `restore` 版本。

```json
{
  "ok": true,
  "data": {
    "key": "global/demo-superstore.md",
    "restoredFromVersionId": "20260802T101500000Z-a1b2c3d4",
    "newVersionId": "20260802T103000000Z-b5c6d7e8",
    "filePath": "wiki/global/demo-superstore.md"
  }
}
```

### 7.5 错误

| Code | HTTP | 条件 | 用户文案 |
|---|---:|---|---|
| `WIKI_VERSION_NOT_FOUND` | 404 | version id 不存在或不属于该 key | 未找到该历史版本 |
| `WIKI_VERSION_INVALID` | 400 | metadata 格式损坏、version id 非法 | 版本记录格式不合法 |
| `FORBIDDEN_PATH` | 403 | 快照路径或目标 key 逃逸 allowlist | 路径不在允许范围内 |

## 8. UI / UX

### 8.1 文档 Header

在已选中文档的 Header 动作区增加 `版本记录` 入口。建议位置：

```text
下载当前文档 | 上传覆盖 | 版本记录 | 编辑
```

如空间不足，可放入文档 More 菜单，但入口必须可发现。

### 8.2 版本记录抽屉 / 弹窗

`版本记录` 展示：

- 当前文档路径；
- 保留策略：`保留最近 5 版`；
- 版本列表，倒序；
- 每项显示：
  - 操作时间；
  - 操作类型；
  - 标题；
  - 上传源文件名（如有）；
  - `查看`；
  - `恢复此版本`。

### 8.3 历史版本预览

历史预览区域显示：

- 版本 Markdown 预览；
- 与当前版本的 Diff；
- path、version id、content hash 节点使用 `notranslate`。

### 8.4 恢复预检

点击 `恢复此版本` 后必须二次确认：

标题：`恢复预检`

内容：

- 当前文档：`wiki/<key>`
- 恢复来源：`<versionId>` / 时间 / 操作类型
- 恢复后标题
- Diff

确认按钮：`确认恢复`

成功 Toast：`已恢复历史版本`

## 9. 安全与写入边界

- 历史 index 和快照写入必须走 `safeWrite`。
- 裁剪旧快照如需删除文件，必须新增 `safeRemove` 或等价 helper，复用 allowlist / denylist / realpath / symlink 防护。
- `wiki/.lucy-history/**` 不得被 `walkMarkdown` 列入业务 Wiki 文档。
- API 只接受 normalized Wiki key 和 version id，不接受任意文件路径。
- version id 必须匹配安全正则，例如 `/^[0-9TZ.-]+-[a-f0-9]{8,16}$/`。

## 10. 验收标准

### 10.1 自动化验收

- 创建新文档后生成 `create` 版本。
- 上传新 Markdown 后生成 `upload_create` 版本，并记录 `sourceFileName`。
- 覆盖上传后生成 `upload_replace` 版本，并记录 `sourceFileName`。
- 在线编辑保存后生成 `edit_save` 版本。
- 同内容重复保存不重复生成版本。
- 每篇文档最多保留 5 条版本记录和 5 个快照文件。
- `GET /api/wiki/:key/versions` 返回倒序版本列表。
- 历史版本详情返回 raw Markdown 和当前 Diff。
- 恢复预检不写入磁盘。
- 确认恢复后当前 Markdown 内容等于历史快照，并新增 `restore` 版本。
- `wiki/.lucy-history/**` 不出现在 `GET /api/wiki` pages。
- `npm run lint:terminology` 通过。

### 10.2 浏览器验收

1. 打开 `/wiki?key=global/demo-superstore.md`。
2. 点击 `版本记录`。
3. 验证列表显示最近版本、操作类型和上传源文件名。
4. 点击某个历史版本 `查看`，验证 Markdown 预览和 Diff 可见。
5. 点击 `恢复此版本`，验证出现 `恢复预检`。
6. 点击 `确认恢复`，验证当前文档内容恢复到历史版本。
7. 再次打开 `版本记录`，验证新增一条 `恢复` 记录。

## 11. 迁移与兼容

- 没有 `wiki/.lucy-history/index.json` 的项目按空版本记录处理。
- 首次对现有 Markdown 文档执行编辑保存或上传覆盖时，可先生成一个 `create` baseline 版本，再生成本次操作版本。
- 不要求批量为所有既有 Markdown 建立历史；避免首次加载产生大量写入。
- 旧前端不读取版本 API 时不受影响。

## 12. 风险与开放问题

| 风险 | 缓解 |
|---|---|
| 历史快照占用磁盘 | 默认每篇只保留最近 5 版，后续可配置 |
| metadata 损坏导致版本列表不可读 | 返回明确错误，不静默清空；后续可加 repair |
| 恢复误操作再次覆盖当前内容 | 恢复前必须预检，并且恢复动作也生成新版本 |
| 上传覆盖与上传为新文档语义混淆 | 本 spec 记录版本；上传入口语义拆分由后续 Wiki 上传 IA 工单承接 |

## 13. 回滚

- 回滚版本 API、版本 UI、历史写入 helper 和测试。
- 不删除用户已有 Markdown 文档。
- 已生成的 `wiki/.lucy-history/**` 可保留在磁盘；旧代码会跳过隐藏目录。
