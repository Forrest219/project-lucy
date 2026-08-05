# Table Editor Overlay-Safe YAML Import Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Table Editor Overlay-Safe YAML Import Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-06 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器 + API 核实：`/catalog/demo-mysql/chatbi/ai_intl_ad_daily` 导入 overlay 后字段归零；`previewSourceYamlImport` 整段替换 schema；用户批准改善方案 |
| 适用范围 | 表语义工作台「导入 YAML」与 `POST /api/sources/:conn/:schema/:table/import`；不改发布工作台多文件上传主路径 |
| 输出位置 | `webui/docs/114-table-editor-overlay-safe-yaml-import-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 114 |
| 关联工单 | `webui/docs/plans/wo-202608-47-table-editor-overlay-safe-yaml-import.md` |
| 关联页面 | `/catalog/:conn/:schema/:table` |
| 关联台账 | `docs/ui-ux-feedback/pages/catalog.md`（`UX-CATALOG-030`） |
| 上游 Spec | Spec 48 / 56（导入导出）；Spec 110（校验披露，并列） |
| 状态 | Implemented |
| 日期 | 2026-08-06 |
| 范围 | Overlay-only 导入不得冲掉 Schema Manifest columns；导入抽屉区分 Manifest 表片段 vs semantic overlay；引导完整包走发布工作台 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | Implemented：merge-safe import + drawer 指引 + 台账 UX-CATALOG-030 Fixed |

## 1. 背景

现场（2026-08-06）：

1. 用户按桌面 `lucy_upload/ai_intl_ad_daily.yaml`（semantic overlay：`name`/`table`/`grain`/`measures`/`segments`，无 `columns`）在表编辑器导入。
2. `previewSourceYamlImport` 去掉 overlay 键后把 schema 表节点整段设为 `{ name, table }`，**冲掉既有 columns**。
3. UI 出现「字段 0」+ grain「字段已不存在」；用户感知为「导入 YAML 报错 / 坏了」。

正确分工：字段在 Schema Manifest；指标/分群/行粒度在 overlay。完整包应走发布工作台一次上传。

## 2. 目标

1. **Schema 写盘安全**：仅当导入 YAML 含 `columns` 和/或 `descriptions` 和/或 `joins` 时，才更新 Schema Manifest 表节点；更新方式为 **与现有表条目 merge**，不得用「去掉 overlay 后的剩余对象」整段替换。
2. **Overlay-only**：仅含 `grain` / `measures` / `segments`（及可选 `name`/`table`）时，只预览/写入 overlay；Schema Manifest **零 diff**。
3. **抽屉文案**：说明「本页导入接受：当前表 Schema Manifest 片段（含字段）或表级 overlay（指标/分群/行粒度）；完整 Schema Manifest + 多表 overlay 请用发布工作台上传语义资产」。
4. 台账 `UX-CATALOG-030` → `Fixed`；本轮不做浏览器验证。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 改发布工作台多文件校验门禁展示 | Spec 115 |
| 清理 / 忽略 `._*` | Spec 115 |
| 禁止表编辑器导入 overlay | 允许 merge-safe；不强制拒绝 |
| 本轮浏览器验证 | 用户约束 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`。

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Table YAML Import | 导入 YAML | 导入表 YAML | 裸「上传 YAML」作本抽屉主标题 | 表页单表导入 |
| Schema Manifest Table Snippet | Schema Manifest 表片段 | 含字段的表 YAML | 把 overlay 叫 Manifest | 含 `columns`/`descriptions`/`joins` |
| Semantic Overlay (table editor) | 表级 semantic overlay | overlay（指标/分群/行粒度） | 暗示会改字段列表 | 仅 grain/measures/segments |

Protected / `notranslate`：路径、`Schema Manifest`、文件名。

## 5. 行为契约

### 5.1 `previewSourceYamlImport` / `writeSourceYamlImport`

1. 解析导入内容（既有 `importedTableValue`：整份 Manifest 取当前表，或扁平表片段）。
2. **Schema patch 键**：仅 `table`、`descriptions`、`columns`、`joins`。
3. **仅当**导入含 `columns` ∨ `descriptions` ∨ `joins`：`merged = { ...existingTable, ...schemaPatch }`，删除误入的 `name`/`grain`/`measures`/`segments`，再 `setIn(["tables", table], merged)`。
4. **否则**不修改 Schema Manifest 文件。
5. 若导入含 `grain` / `measures` / `segments`：照旧走 `previewOverlayUpdate`。
6. 若既无 schema 实质补丁又无 overlay 实质字段 → 返回空 `files`（与「无变更」一致）；不抛错。

### 5.2 API

- 路径与 envelope 不变；成功仍 `{ ok, data: SourcePreview }`。
- 不新增必改错误码；可选在空变更时保持 200。

### 5.3 UI

- Drawer 增加简短说明（见 §2.3）；placeholder 改为提示含字段的表片段或表级 overlay。
- 导入预览失败仍走既有 `previewError`。

## 6. 验收标准

1. Vitest（server）：overlay-only dry-run → schema 文件无 diff；现有 columns 保留；overlay 可有 diff。
2. Vitest（server）：含 `columns`/`descriptions` 的片段 → schema merge，不丢未声明的既有键（如既有 `joins` 在仅改 descriptions 时保留，若实现为 shallow merge of top-level keys）。
3. Vitest（frontend）：抽屉可见发布工作台引导文案。
4. `lint:terminology`、`build` 通过。
5. 台账 `UX-CATALOG-030` = `Fixed`。

## 7. Design System Compliance

- Referenced：既有 drawer / `pl-notice`
- Follows：说明短文，不新增第三栏
- Exceptions：无

## 8. 修订关系

- 修正 Spec 48/56 隐含的「导入 = 整段覆盖」风险。
- Spec 110 Non-Goal「清理 `._*`」仍由 Spec 115 承接。
