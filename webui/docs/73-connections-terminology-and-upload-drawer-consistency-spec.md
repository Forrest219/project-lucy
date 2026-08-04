# Connections Terminology and Upload Drawer Consistency Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connections Terminology and Upload Drawer Consistency Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-04 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `http://127.0.0.1:55176/connections`（含重新上传抽屉）；`webui/src/pages/connections/ConnectionOverview.tsx`；`webui/src/pages/connections/constants.ts`；`webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`；`webui/src/components/catalog/CatalogAssetValidationPanel.tsx`；`webui/src/app/app.css` |
| 适用范围 | 统一 `/connections` 页面表格列名与 KPI 命名、Host/Database 信息排版、重新上传抽屉文案冗余收敛、上传按钮术语统一 |
| 输出位置 | `webui/docs/73-connections-terminology-and-upload-drawer-consistency-spec.md` |

| 字段 | 内容 |
| --- | --- |
| Spec 编号 | 73 |
| 关联工单 | `webui/docs/plans/wo-202608-04-connections-terminology-and-upload-drawer.md` |
| 关联页面 | `/connections`（含 Schema Manifest 重新上传抽屉） |
| 状态 | Draft |
| 日期 | 2026-08-04 |
| 范围 | 术语一致性、Host/Database 排版、上传抽屉文案冗余收敛 |

## 1. 背景

浏览器核查确认 `/connections` 页面在术语统一性和信息冗余方面存在 5 处问题：

1. 表格列名"本地表数 / 启用表数"与 KPI 卡片"服务器目录已发现表 / 未启用表"描述同一概念但命名不统一。
2. Host/Database 信息的视觉顺序为"名称 icon 值"，不符合"icon 在前、名称在后"的常规阅读顺序。
3. 重新上传抽屉顶部说明"受控上传 Schema Manifest；系统计算目标路径并校验文件，成功后刷新本地目录。"与下方"目标文件""目标路径"等字段信息重复。
4. 校验面板中"目标路径"行与 `TARGET_EXISTS` 警告中的路径完全重复，同一路径出现两次。
5. 上传按钮文案"上传并刷新本地目录"未随 M72 术语收敛（"刷新本地目录"→"同步配置变更"）同步更新。

## 2. 目标

1. 表格列名与 KPI 命名对齐，消除同一概念的两套术语。
2. Host/Database 信息排版改为「icon 名称：值」结构，符合阅读直觉。
3. 收敛重新上传抽屉文案冗余，每处信息只出现一次。
4. 上传按钮文案与"同步配置变更"术语体系统一。
5. 建立测试契约，防止术语回退。

## 3. 非目标

- 不新增后端 API，不修改数据返回结构。
- 不改变上传流程的业务行为（校验、覆盖、刷新逻辑不变）。
- 不重做 KPI 卡片布局或表格列宽（M72 已收敛）。
- 不做移动窄屏专项适配与验证。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

术语映射变更：

| 当前文案 | 目标文案 | 位置 |
| --- | --- | --- |
| 本地表数 | 已发现表数 | 表格列头 |
| 启用表数 | 已启用表数 | 表格列头 |
| 上传并刷新本地目录 | 上传并同步配置变更 | 上传抽屉提交按钮、toast |
| YAML 已上传并刷新本地目录 | YAML 已上传并同步配置变更 | 上传成功 toast |
| 刷新本地目录（AddSchemaDrawer 按钮） | 同步配置变更 | AddSchemaDrawer |
| 成功后刷新本地目录 | 成功后同步配置变更 | 上传抽屉说明文案 |

文案与标识要求：

- `Schema`、`Manifest`、`YAML`、路径、表名继续加 `notranslate` / `translate="no"` 防御。
- `Host`、`Database` 标签保持 `notranslate`。

## 5. 现状差异（核查结论）

### 5.1 列名与 KPI 命名不一致

- 表格列头：`本地表数`、`启用表数`。
- KPI 卡片：`服务器目录已发现表`、`未启用表`。
- 同一数据，两套命名，用户需自行建立映射。

### 5.2 Host/Database 排版顺序

- 当前视觉顺序：`Host` → `Server icon` → `demo-db:3306`（名称在前，icon 居中，值在后）。
- 不符合"icon 引领、名称随后、值收尾"的常规模式。

### 5.3 抽屉头部说明冗余

- 顶部说明提到的"目标路径"在下方"目标文件"字段和校验面板中各出现一次。
- "成功后刷新本地目录"的行为已由提交按钮文案承担，说明中重复。

### 5.4 校验面板路径重复

- `catalog-asset-target-path` 行展示完整路径。
- `TARGET_EXISTS` 警告 message 中再次包含同一完整路径。

### 5.5 按钮术语未同步

- `CatalogAssetUploadDrawer` 提交按钮与 toast 仍使用"刷新本地目录"。
- `AddSchemaDrawer` 中 `CatalogReloadButton` label 仍为"刷新本地目录"。

## 6. 目标态规范

### 6.1 表格列名

| 列 | 目标文案 | 对齐 KPI |
| --- | --- | --- |
| 第 3 列 | 已发现表数 | 服务器目录已发现表 |
| 第 4 列 | 已启用表数 | 未启用表（取反） |

同步更新 `constants.ts` 中 `localCatalogTables.hint` 的交叉引用文案。

### 6.2 Host/Database 排版

- 结构：`[icon] Host：demo-db:3306`。
- icon（`Server` / `Database`）置于最左，名称紧随其后，冒号分隔，值在右。
- 保持一行展示，不换行。

### 6.3 抽屉头部说明

精简为单句，聚焦"上传即覆盖"的核心语义，不再重复"目标路径""刷新"概念。

### 6.4 校验面板路径合并

- 移除独立的"目标路径"行。
- `TARGET_EXISTS` 警告 message 直接携带完整路径，作为唯一路径展示处。
- `mode === "update"` 时下方已有"将覆盖现有 YAML。"提示，语义完整。

### 6.5 按钮与 toast 术语

- 提交按钮：`上传并同步配置变更`。
- 上传中：`上传中...`（不变）。
- 成功 toast：`YAML 已上传并同步配置变更`。
- `AddSchemaDrawer` 的 `CatalogReloadButton` label：`同步配置变更`。

## 7. 实现要求

- 改动文件：
  - `webui/src/pages/connections/ConnectionOverview.tsx`（表格列头）
  - `webui/src/pages/connections/constants.ts`（KPI hint 交叉引用）
  - `webui/src/components/catalog/CatalogAssetUploadDrawer.tsx`（头部说明、按钮、toast）
  - `webui/src/components/catalog/CatalogAssetValidationPanel.tsx`（路径合并）
  - `webui/src/components/AddSchemaDrawer.tsx`（reload 按钮 label）
  - `webui/src/app/app.css`（Host/Database 排版）
- 测试契约：
  - 列头断言"已发现表数""已启用表数"。
  - 上传抽屉断言按钮文案、toast 文案。
  - 校验面板断言路径只在警告中出现一次。
  - Host/Database 断言 icon 在名称之前（DOM 顺序）。

## 8. 验收标准

- 表格列头与 KPI 命名语义一致。
- Host/Database 视觉顺序为 icon → 名称 → 值。
- 重新上传抽屉中同一路径只出现一次。
- "刷新本地目录"字样在上传相关交互中全部替换为"同步配置变更"。
- 相关单测、术语 lint、build、`git diff --check` 均通过。

## 9. 风险与边界

- `TableWhitelist.tsx`、`help-center` 等处的"刷新本地目录"文案若涉及同一术语体系，需同步评估；本工单仅覆盖上传链路（上传抽屉 + AddSchemaDrawer reload 按钮）。
- 列名变更不影响 API 字段名，仅为 UI 展示层。
