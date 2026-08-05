# Publish History Business Columns & Export Clarity Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Publish History Business Columns & Export Clarity Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/publish/history`（`:55176`）；用户 4 点反馈；`webui/docs/design-system/11-components-data-grid.md`；`webui/docs/35-semantic-publish-workbench-ia-spec.md`；`PublishHistory.tsx`；`semantic-asset-export.ts` |
| 适用范围 | 指导 `/publish/history` 表格信息架构、导出语义澄清、export ESM 修复与 Data Grid 轻量收敛 |
| 输出位置 | `webui/docs/85-publish-history-business-columns-and-export-clarity-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 85 |
| 关联工单 | `webui/docs/plans/wo-202608-17-publish-history-business-columns-and-export-clarity.md` |
| 关联页面 | `/publish/history` |
| 关联台账 | `docs/ui-ux-feedback/pages/publish-history.md`（`UX-PUBLISH-HISTORY-001` ~ `005`） |
| 上游 Spec | Spec 35（发布记录 IA）；`11-components-data-grid.md`；Spec 23（语义资产导出） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 序号列、变更范围/规模列、操作列改名与行内去伪下载、Header 导出文案、export `require` ESM 修复、`pl-data-grid` 轻量收敛；不实现按 releaseId 历史包下载 |

## 1. 背景

浏览器核查确认用户 4 点反馈属实：

1. 表格无序号列。
2. 列标题「动作/快照」无法表达用户价值；列内只有模糊动作链。
3. 「下载当前快照」点击失败（`POST /api/semantic-assets/export` → 500，`require is not defined`）；且文案无法说明下载的是什么。
4. 表格缺少连接 / 变更源 / 文件数等业务信息；现网多为手动 Reindex 记录，业务字段为空，空洞感被放大。

额外产品语义问题：行内「下载当前快照」实际导出的是**当前工作区全量语义资产包**，不是该历史批次的存档；与 Spec 35 v0.1「current full snapshot」一致，但放在每一行会误导。

## 2. 目标

1. 表格增加倒序 **序号** 列。
2. 用 **变更范围**（主标识）+ **规模**（次级数量）表达业务价值；手动 Reindex 无变更时给出明确空态文案。
3. 列「动作/快照」改为 **操作**；行内仅保留与本条相关的 Diff / 错误动作；**去掉行内导出按钮**。
4. Header 唯一导出入口，文案改为 **「导出当前语义资产包 (.zip)」**，语义对齐术语标准「语义资产包」。
5. 修复 export ESM bug（`require("yaml")`），使 Header 导出可用。
6. 表格轻量收敛 `pl-data-grid` + 页面语义类；状态用紧凑 badge，不用 `pl-validation-banner`。

## 3. 非目标

- 不实现按 `releaseId` 下载历史批次快照（需存档/可复现打包，属后续能力）。
- 不改 release API 契约 / sidecar 写入格式。
- 不搬 connections 工作台完整 `colgroup` 模板。
- 不做浏览器验证 / 移动窄屏；本轮 Vitest + `lint:terminology` + `build`；台账止于 `Fixed`。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None。

UI 文案约束：

| 场景 | 采用 | 禁止 |
|---|---|---|
| Header 导出 | 导出当前语义资产包 (.zip) | 下载当前快照（歧义） |
| 操作列标题 | 操作 | 动作/快照 |
| Reindex 无变更空态 | 全库索引重建（无资产变更） | 空白单元格 |
| 规模列 | 文件 / 语义源 | 裸英文 count 缩写 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：

- `Reindex`（表头与状态文案中的英文片段）
- Connection ID、sourceName、actor 标识符、release id（展开面板标题中）

## 5. Design System Compliance

- 引用：`11-components-data-grid.md` §3–§8、§10。
- 结构：`className="pl-data-grid pl-data-table pl-publish-history-table"`。
- 12px 密度由 `pl-data-grid` 表头 + 页面语义类正文覆盖（对齐 Spec 82/83 轻量模式）。
- 规模列：`tabular-nums` + `text-fg-body` + `font-normal`（次于主标识）。
- 操作列：弱链 `pl-row-action-link` 的 12px 变体；左对齐。
- 状态：紧凑 badge（如 `pl-publish-history-status`），禁止行内使用 `pl-validation-banner`。
- 不做完整 colgroup；序号列固定窄宽即可。

## 6. UI 变更

### 6.1 列模板

| 列 | 角色 | 内容 |
|---|---|---|
| # | 序号 | 当前列表倒序展示下的 1…n（最新为 1） |
| 发布时间 | 时间 + 发布状态次行 | `YYYY-MM-DD HH:mm` + `statusLabelFor` |
| 触发方式 | 文本 | WebUI 发布 / WebUI 强制重建索引 |
| 操作人 | 标识 | actor；`notranslate` |
| 变更范围 | **主标识** | 见 §6.2 |
| 规模 | 数量 | `文件 N` · `语义源 M`；无变更时 `—` |
| 结果 | 状态 | 发布状态可继续放时间列次行；本列展示 Reindex 紧凑 badge（成功/失败/进行中/未执行） |
| 操作 | 行内动作 | 查看 Diff / 查看错误（有则显示）；**无导出** |

说明：为控制列数，可将「触发方式」「操作人」保留；若视觉过挤，允许把触发方式并入发布时间次行——本轮默认保留独立列，优先保证变更范围/规模可见。

### 6.2 变更范围规则

```text
if trigger === webui_manual_reindex && connectionIds.length === 0 && changedSources.length === 0 && files.length === 0:
  → 「全库索引重建（无资产变更）」
else:
  主行：连接摘要（unique connectionIds，过多时前 2 +「+N」）
  次行：变更源摘要（changedSources 的 sourceName，前 2 +「+N」；无则省略）
```

Connection ID / sourceName 必须 `translate="no"` + `notranslate`。

### 6.3 导出

- Header `actions`：唯一 `SemanticAssetExportButton`，`label="导出当前语义资产包 (.zip)"`，`variant="secondary"`。
- 行内 **删除** `SemanticAssetExportButton`。
- 不在本轮增加「下载该批次」按钮（能力不存在）。

### 6.4 Export 后端修复

`webui/server/semantic-asset-export.ts` 的 `makeScalar` 不得使用 `require("yaml")`；改为从已有 `yaml` ESM import 使用 `Scalar`（或等价构造）。

### 6.5 CSS

最小语义块（不得复制整套 schema-asset 列宽）：

- `.pl-publish-history-table`：tbody 12px medium / leading-4（如需）
- `.pl-publish-history-table-num`：tabular-nums、次级色重
- `.pl-publish-history-table .pl-row-action-link`：12px 弱链
- `.pl-publish-history-status` (+ success/danger/warning)：紧凑 pill/badge
- `.pl-publish-history-scope`：主/次行 grid gap

## 7. 验收标准

### 7.1 自动化

- 表格 class 含 `pl-data-grid`。
- 存在「#」「变更范围」「规模」「操作」表头；不存在「动作/快照」。
- 行内无「下载当前快照」/「导出当前语义资产包」按钮；Header 有「导出当前语义资产包 (.zip)」。
- 发布记录展示连接/语义源摘要与文件·语义源数量；手动 Reindex 空变更展示「全库索引重建（无资产变更）」。
- 序号：最新记录为 `1`。
- export 单测仍绿；可选补一条直接调用 `makeScalar` 路径不抛（现有 sanitize 覆盖即可）。
- `lint:terminology`、`build` 通过。

### 7.2 浏览器（本轮不做）

复核时验证：导出成功可下载 zip；列信息可读；无行内伪历史下载。

## 8. 对既有 Spec 的修订

- 修订 Spec 35 §7：发布记录表应展示变更范围与规模；当前快照导出仅作 Header 辅助动作，不得作为每行「该批次快照」入口。
- 不废止 Spec 23 导出契约；仅修复实现并澄清 UI 入口。
