# Business Wiki Document Delete Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Business Wiki Document Delete Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | `/wiki` 核实：阅读态文档操作区无删除 Markdown 入口；Spec 58 将文档删除列为非目标；`WikiVersionOperation` 已预留 `delete` |
| 适用范围 | `/wiki`：已保存 Markdown 单文档删除（确认对话框 + API + 版本索引清理） |
| 输出位置 | `webui/docs/118-wiki-document-delete-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 118 |
| 关联工单 | `webui/docs/plans/wo-202608-51-wiki-document-delete.md` |
| 关联页面 | `/wiki` |
| 关联台账 | `docs/ui-ux-feedback/pages/wiki.md`（`UX-WIKI-045`） |
| 上游 Spec | Spec 49（文档库）、Spec 55（版本记录）、Spec 58（目录/文档治理；本能力曾为非目标）、Spec 81（阅读态 Header 动作层级） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | 阅读态 Header「删除文档」；确认对话框；`DELETE /api/wiki/:key`；清理该 key 版本快照；成功后离开文档页 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：承接 `UX-WIKI-045`；定义 UX / API / 数据契约 / 验收 |
| v1.1 | Implemented：server delete + UI + Vitest；`UX-WIKI-045` → Fixed |

## 1. 背景

代码与 Spec 核实确认：

1. 已加载文档阅读态 Header 仅有：下载当前 Markdown / 移动到目录 / 版本记录 / 上传覆盖 / 编辑。
2. 目录可删（空目录），文档无删除入口；亦无 `DELETE /api/wiki/:key`。
3. Spec 58 Non-Goals 写明不实现批量删除等；单文档删除此前未产品化，导致测试残留 / 误传文档无法在 UI 清理。
4. `WikiVersionOperation` 已包含 `delete`，但无写入路径。

本 Spec 补齐单文档删除，与空目录删除、移动文档同属治理能力。

## 2. 目标

1. 已保存文档阅读态 Header 增加主术语 **删除文档**。
2. 提供确认对话框，展示目标 Wiki 路径与不可逆说明。
3. `DELETE /api/wiki/:key`：经 `fs-safe` / `auditedRemoveFile` 删除 Markdown；并清理该 key 的版本历史索引与快照。
4. 成功后：刷新 `queryKeys.wiki`；URL 离开该文档（进入父目录 `?dir=` 或文档库首页）；Toast「已删除文档」。
5. 保持「编辑」为同组唯一 `primary`（Spec 81）；删除触发器不得抢主路径。
6. 台账 `UX-WIKI-045` → `Fixed`；本轮不做浏览器验证，结束后只做 code review。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 软删除 / 回收站 / 从版本记录恢复已删文档 | Spec 58 已排除；本轮靠确认 + 配置审计降低风险 |
| 批量删除、目录递归删文档 | 独立需求；空目录删除规则不变 |
| 编辑态内联删除 | 仅阅读态已保存文档；dirty 编辑先确认放弃 |
| 改动 UX-WIKI-020（树默认不混排文档） | 无关 |
| 本轮浏览器验证 | 按 DEVELOPMENT 约束与用户要求 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`。

本 Spec 登记：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Delete Markdown Document | 删除文档 | 删除 Markdown 文档 | 删除 MD、删文件、删除 page | 删除当前已保存 Wiki Markdown |
| Document Delete Confirmation | 删除确认 | 删除预检（勿与上传预检混用） | — | 确认对话框，展示目标路径 |

Protected / `notranslate`：`Wiki`、`Markdown`、Wiki key、文件路径、version id。

实现前须在术语标准补登记上表条目。

## 5. Target UX

### 5.1 入口与 Header 顺序

已加载文档、阅读态 Header actions（修订 Spec 81 §6.1）：

| 顺序 | 按钮 | `data-testid` | 样式 |
|---|---|---|---|
| 1 | 下载当前 Markdown | `wiki-download-button` | `pl-btn--ghost` |
| 2 | 移动到目录 | `wiki-move-button` | `pl-btn--ghost` |
| 3 | 版本记录 | `wiki-version-button` | `pl-btn--ghost` |
| 4 | 上传覆盖 | `wiki-upload-replace-button` | `pl-btn--ghost` |
| 5 | **删除文档** | `wiki-delete-document-button` | `pl-btn--ghost` |
| 6 | 编辑 | `wiki-edit-button` | **`pl-btn--primary`** |

约束：

- 同组最多一个 `primary`，且必须是 `编辑`。
- 「删除文档」仅在 `mode === "loaded"` 且阅读态显示；文档库首页 / 草稿 / 编辑态不显示。
- Dirty 编辑态若未来暴露入口：须先 confirm 放弃未保存内容（本轮不做编辑态入口）。

### 5.2 确认对话框

标题：`删除文档`

内容：

| 区域 | 说明 |
|---|---|
| 说明文案 | 删除后文档将从业务 Wiki 移除，且不可通过版本记录恢复。 |
| 目标文档 | 只读 `code`：`wiki/<key>`（`notranslate`） |
| 错误 | 服务端错误内联展示 |

按钮：

- 次：`取消`（ghost）
- 主确认：`删除文档`（`pl-btn--danger`）；进行中文案 `删除中...`

`data-testid`：

- `wiki-delete-document-dialog`
- `wiki-delete-document-target`
- `wiki-delete-document-cancel`
- `wiki-delete-document-confirm`
- `wiki-delete-document-error`

### 5.3 成功后导航

| 当前 key | 导航 |
|---|---|
| `global/foo.md` 等有父目录 | `?dir=<parent>`（如 `global`） |
| 顶层 `foo.md`（无 `/`） | 清除 query → 文档库首页 |

## 6. API

### `DELETE /api/wiki/:key`

- `:key`：URL 编码的 Wiki key（须以 `.md` 结尾，相对 `wiki/`）。
- 成功 `200`：

```json
{
  "ok": true,
  "data": {
    "key": "global/example.md",
    "deleted": true,
    "filePath": "wiki/global/example.md"
  }
}
```

- 不存在 → `404 WIKI_NOT_FOUND`
- 非法 key / 越权路径 → 既有 `ForbiddenPathError` / 400 族

副作用：

1. `auditedRemoveFile` 删除 `wiki/<key>`（`changeType: wiki_delete`）。
2. 删除该 key 在 `wiki/.lucy-history/index.json` 的条目，并 `safeRemove` 其快照文件。
3. 不自动删除父目录（即使变为空）；空目录仍走既有「删除目录」。

不提供 preview 端点：确认对话框即足够（对齐空目录删除，非移动/重命名那种路径改写预检）。

## 7. 数据与安全

- 全部删除经 `fs-safe` allowlist；禁止 symlink。
- 配置审计写入 config audit（与其它 Wiki 写操作一致）。
- 不暴露 `.lucy-history` 到 `wiki_search` / pages 列表。

## 8. 验收（非浏览器）

1. Vitest：Header 顺序含 `wiki-delete-document-button`；确认后发 `DELETE`；成功后 URL 离开文档。
2. Server test：删除存在文档；404；历史索引清理。
3. `npm run lint:terminology`、相关 `npm test`、`npm run build`。
4. 台账 `UX-WIKI-045` → `Fixed`；README 维护记录与跨页面主题更新。

## 9. 长期台账机制更新

### 9.1 页面台账

`docs/ui-ux-feedback/pages/wiki.md` 追加 `UX-WIKI-045`（缺少删除 Markdown 文档入口），实现后 `Fixed`。

### 9.2 跨页面主题

`docs/ui-ux-feedback/README.md`：

- 主题 `button hierarchy consistency` 增挂 `UX-WIKI-045`（破坏性动作 ghost 触发 + dialog danger 确认，不抢 primary）。
- 最近维护记录追加本轮条目。

### 9.3 交叉引用

- Spec 58 Non-Goals：单文档删除改由 Spec 118 承接（批量/递归仍非目标）。
- Spec 81 §6.1：Header 顺序插入「删除文档」。
