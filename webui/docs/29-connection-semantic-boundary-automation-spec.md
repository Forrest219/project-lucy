# Connection And Semantic Layer Boundary Automation Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection And Semantic Layer Boundary Automation Spec |
| 文档类型 | Product / UX / API / Automation Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI 数据库接入、语义层维护、Catalog YAML 上传、语义资产发布、Review 与 lint 自动化 |
| 架构决议 | 将“数据库接入”和“语义层维护”的职责边界从口头 know-how 固化为产品术语、UI 文案、API asset kind、上传结构校验、lint gate 与 Review checklist |
| 事实源 | `ktx.yaml`、`semantic-layer/<connection>/_schema/<schema>.yaml`、`semantic-layer/<connection>/<table>.yaml`、`.ktx-ui/**` sidecar |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/04-data-model.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/23-semantic-asset-publish-export-spec.md`、`webui/docs/24-yaml-delivery-runbook-spec.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/26-database-connection-operations-runbook-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

数据库接入模块已经承担受控 Schema Manifest 上传，因此用户会自然追问：“数据库接入和语义层维护的区别是什么？数据库接入不是也能上传 Manifest / YAML 吗？”

本规格明确产品边界：

```text
数据库接入：让连接、Schema、表范围和本地 Manifest 资产进入 Lucy，并保持 Catalog 可读。
语义层维护：让已进入 Lucy 的表具备可问、可信、可审阅的业务语义。
```

因此，“上传 YAML”不能继续作为未限定动作裸露在 UI、API、测试或文档中。必须显式区分：

- `上传 Schema Manifest`：数据库接入动作，写入 `semantic-layer/<connection>/_schema/<schema>.yaml`。
- `上传 semantic overlay`：语义层维护动作，写入 `semantic-layer/<connection>/<table>.yaml`。
- `上传资产包`：语义资产交付动作，按资产包验证与发布流程处理。

入口也必须显式收敛，避免客户把同一种 Schema 级 YAML 当成多套补充流程：

- Schema 级 YAML 的主入口只保留在 `/connections` 连接概览，包含连接级 `上传 Schema Manifest` 和 Schema 行内 `上传 Manifest`。
- `/connections/whitelist` 只展示缺失 Manifest 诊断与跳转，不作为独立 Schema Manifest 上传入口。
- Table 级 YAML 的主入口放在语义层维护的 `表目录` / 表详情，不进入数据库接入或表白名单页面。

本规格新增自动化机制：

1. 系统术语标准新增模块职责矩阵。
2. UI 文案禁止裸用 `上传 YAML` 表达跨模块动作。
3. 上传 API 显式携带 `assetKind`，后端根据 kind 约束路径与 YAML 结构。
4. 新增 IA boundary lint，扫描连接页、语义层维护页、测试、spec 与 plan 的错位文案。
5. Review 页面或 Review checklist 根据 changed files 自动提示边界检查项。

## 2. 用户心智模型

### 2.1 数据库接入

数据库接入回答的是：

1. 这个 Connection 是否存在？
2. 这个 Connection 配了哪些 Schema？
3. 哪些表允许进入语义层？
4. 本地是否已有该 Schema 的 Manifest？
5. WebUI 是否已经刷新本地 Catalog？
6. 当前连接是否能通过连通测试？

它不回答：

- 指标口径是什么。
- Join 是否可信。
- 字段业务含义是否完整。
- grain / measures / segments 应该怎么建模。

### 2.2 语义层维护

语义层维护回答的是：

1. 这张表是否已经有业务描述？
2. grain 是否明确？
3. 字段说明是否足够让 Agent 正确使用？
4. 指标、分群、Join 是否已定义并通过 validate？
5. 语义变更是否需要审阅？

它不负责：

- 新增数据库凭据。
- 新增物理 Connection。
- 把 Schema 写入 `ktx.yaml`。
- 上传或生成物理 Schema Manifest 的主入口。

## 3. 职责矩阵

| 能力 | 数据库接入 | 语义层维护 | 语义资产交付 |
|---|---|---|---|
| 查看 Connection | Owner | Consumer | Consumer |
| 添加 Schema 到 `ktx.yaml` | Owner | 不负责 | 不负责 |
| 连通测试 | Owner | 不负责 | 不负责 |
| 表白名单 / `enabled_tables` | Owner | Consumer | Consumer |
| Manifest 状态 | Owner | Consumer | Consumer |
| 上传 Schema Manifest | Owner | 不作为主入口 | 可包含在资产包中 |
| 刷新本地目录 | Owner | 可提示 | 可触发发布后刷新 |
| 表目录浏览 | Consumer | Owner | Consumer |
| 字段描述 | 不负责编辑 | Owner | 可发布 |
| grain | 不负责编辑 | Owner | 可发布 |
| Metric / Measure | 不负责编辑 | Owner | 可发布 |
| Segment | 不负责编辑 | Owner | 可发布 |
| Join | 不负责编辑 | Owner | 可发布 |
| semantic overlay YAML | 不作为主入口 | Owner | 可包含在资产包中 |
| 资产包导入 / 导出 | Consumer | Consumer | Owner |
| validate / reindex | 基础刷新后可触发 | 语义变更后必须触发 | 发布 gate 必须触发 |

## 4. 产品语言规则

### 4.1 禁止裸动作

以下文案不得作为按钮、菜单、Drawer 标题或 Toast 主动作：

```text
上传 YAML（禁止裸用）
上传语义层
更新 YAML
导入 YAML
```

例外：说明文中可以使用 `YAML 资产` 作为总称，但必须在同一段落中说明具体类型。

### 4.2 数据库接入推荐文案

| 场景 | 推荐文案 |
|---|---|
| Schema 行缺失 manifest | `上传 Manifest` |
| Drawer 标题 | `上传 <connection> 的 Schema Manifest` |
| 目标说明 | `目标 Schema：<schema>` |
| 目标路径说明 | `此操作只写入 semantic-layer/<connection>/_schema/<schema>.yaml。` |
| 边界说明 | `不会编辑指标、Join 或业务语义。` |
| 成功 Toast | `已上传 Schema Manifest，并刷新本地目录。` |

### 4.3 语义层维护推荐文案

| 场景 | 推荐文案 |
|---|---|
| overlay 上传入口 | `上传 semantic overlay` |
| Drawer 标题 | `上传 <table> 的 semantic overlay` |
| 目标路径说明 | `此操作写入 semantic-layer/<connection>/<table>.yaml。` |
| 边界说明 | `用于维护 grain、指标、分群、Join 等业务语义，不用于新增数据库 Schema。` |
| 成功 Toast | `已上传 semantic overlay，请运行 validate。` |

推荐位置：

- `语义层维护 / 表目录` 的表行操作：`上传 semantic overlay`。
- 表详情页或编辑 Drawer 的业务语义区域：`上传 semantic overlay` / `编辑 semantic overlay`。
- 不在 `/connections` 或 `/connections/whitelist` 中展示 table 级 YAML 上传入口。

### 4.4 资产交付推荐文案

| 场景 | 推荐文案 |
|---|---|
| 多文件导入 | `上传资产包` |
| 多文件导出 | `下载资产包` |
| 发布 gate | `Validate Gate` |
| 风险说明 | `资产包可包含 Schema Manifest 与 semantic overlay，但必须通过路径、secret 与结构校验。` |

## 5. API 与数据契约

### 5.1 Asset Kind

上传类 API 必须显式接收 asset kind。前端不得只传 `file` 或 `yaml`，后端不得只靠内容猜测业务意图。

```ts
type SemanticAssetKind =
  | "schema_manifest"
  | "semantic_overlay"
  | "asset_package";
```

兼容说明：当前实现中的 `assetType: "schemaManifest"` 可在 M25 中作为向后兼容输入映射到 `assetKind: "schema_manifest"`，但新 UI、新测试和新文档使用 `assetKind`。

### 5.2 路径约束

| `assetKind` | 必需上下文 | 允许目标路径 |
|---|---|---|
| `schema_manifest` | `connectionId` + `schema` | `semantic-layer/<connection>/_schema/<schema>.yaml` |
| `semantic_overlay` | `connectionId` + `table` | `semantic-layer/<connection>/<table>.yaml` |
| `asset_package` | package manifest | 仅允许解包后命中上述两类路径或受控 sidecar 路径 |

后端必须继续禁止：

- client-supplied arbitrary target path。
- 写入 `.ktx/secrets/**`。
- 写入 `ktx.yaml`，除非走 Add Schema / connection config 的专用 API。
- 写入 `.git/**`、`raw-sources/**` 或项目根外路径。

### 5.3 结构校验

`schema_manifest` 必须满足：

- YAML 可解析为 map。
- 顶层存在 `tables:`。
- `tables` 下每个 value 是 table manifest object。
- 每个 table manifest 至少包含 `table: <schema>.<table>` 或可被现有 manifest parser 接受的等价结构。
- 不允许出现 overlay-only 顶层建模字段：`grain`、`measures`、`segments`。

`semantic_overlay` 必须满足：

- YAML 可解析为 map。
- 顶层存在 `name:` 或可从目标 table 上下文确定 table name。
- 允许 `grain`、`columns`、`column_overrides`、`measures`、`segments`、`joins`。
- 不允许写入 `_schema/<schema>.yaml`。
- 不允许创建与 manifest 物理列同名的 computed column；应使用 `column_overrides`。

`asset_package` 必须满足：

- 每个文件先分类，再按对应 kind 校验。
- package 内不得含 secret、absolute path、parent traversal path。
- package sidecar 不得保存 raw YAML content。

### 5.4 错误码

| 错误码 | 触发条件 | 用户可见文案 |
|---|---|---|
| `ASSET_KIND_REQUIRED` | 请求缺少 `assetKind` 且无法兼容映射 | `请选择要上传的资产类型。` |
| `ASSET_KIND_UNSUPPORTED` | kind 不在允许集合 | `不支持此类 YAML 资产。` |
| `ASSET_KIND_ROUTE_MISMATCH` | 在数据库接入上传 semantic overlay，或在语义层维护上传 Schema Manifest | `此入口不接受该资产类型，请切换到对应模块。` |
| `SCHEMA_MANIFEST_EXPECTED` | `schema_manifest` 缺少 `tables:` | `这是 semantic overlay 或普通 YAML，不是 Schema Manifest。` |
| `SEMANTIC_OVERLAY_EXPECTED` | `semantic_overlay` 缺少 overlay 结构 | `这是 Schema Manifest 或普通 YAML，不是 semantic overlay。` |
| `OVERLAY_FIELD_IN_MANIFEST` | manifest 上传中出现 `grain` / `measures` / `segments` | `业务语义字段应写入 semantic overlay，不应写入 Schema Manifest。` |
| `MANIFEST_SHAPE_IN_OVERLAY` | overlay 上传中出现 manifest-style `tables:` | `Schema Manifest 应在数据库接入中上传。` |

## 6. UI 与路由要求

### 6.1 `/connections`

- Schema 行内缺失 manifest 的主动作必须是 `上传 Manifest`。
- 连接级上传入口如保留，必须显示 `上传 Schema Manifest` 或在 tooltip 中说明只处理 Schema Manifest。
- 连接级上传 Drawer 可选择 Schema；Schema 行内上传 Drawer 必须锁定 `connectionId` 和已知 `schema`。
- 目标路径必须由后端按 `connectionId + schema` 计算。
- Drawer 中必须显示边界说明：不编辑指标、Join 或业务语义。
- YAML 示例、校验提示和错误文案必须随当前 Schema 更新，避免出现所选 Schema 与示例 YAML 中 Schema 不一致。

### 6.2 `/connections/whitelist`

- 表白名单页面不再提供独立 Schema Manifest 上传入口。
- 空 Schema / 缺失 Manifest 诊断中的主修复动作应为 `去连接概览上传 Manifest` 或 `打开连接概览`，并携带或展示目标 `connection + schema` 上下文。
- 页面不得显示 `上传该 Schema 的 YAML`、裸 `上传 YAML` 或看起来会在当前页直接补充 YAML 的按钮。
- 同一提示块必须说明白名单只读取本地 YAML 资产，不访问物理数据库，也不会生成新的 Manifest。

### 6.3 语义层维护 / TableEditor

- 表编辑保存仍走 patch / overlay 写入路径，不复用数据库接入的 Schema Manifest 上传文案。
- 如果新增 overlay 上传入口，按钮必须为 `上传 semantic overlay`。
- Table 级 YAML 上传入口优先放在 `表目录` 表行或表详情业务语义区域。
- 保存或上传成功后必须提示 validate / reindex 闭环。

### 6.4 语义资产发布

- 资产包可以包含 `schema_manifest` 和 `semantic_overlay`，但 UI 必须展示分类结果。
- 发布前必须展示 Validate Gate，包括目标路径、文件数量、错误和 warning。

## 7. 自动化机制

### 7.1 IA Boundary Lint

新增脚本：

```bash
cd webui
npm run lint:ia-boundary
```

建议实现文件：

```text
webui/scripts/lint-ia-boundary.mjs
```

最小规则：

1. `webui/src/pages/connections/**`、`webui/src/components/catalog/**` 中禁止裸字符串 `上传 YAML`，除非同一 JSX 节点或相邻说明包含 `Manifest` / `Schema` / `该 Schema`。
2. `webui/src/pages/connections/**` 中禁止主动作出现 `新增指标`、`编辑 Join`、`保存到语义层`。
3. `webui/src/pages/Catalog.tsx`、`webui/src/pages/TableEditor.tsx` 中禁止主动作出现 `添加 Schema`、`测试连接`。
4. `刷新本地目录` 附近的说明不得包含 `触发 ingest`、`扫描数据库`、`重新生成语义层`。
5. 文档中新增 `上传 YAML` 必须在同一段落说明 `Schema Manifest`、`semantic overlay` 或 `资产包` 的具体类型。

### 7.2 CI / Test Gate

`webui/package.json` 应新增：

```json
{
  "scripts": {
    "lint:ia-boundary": "node scripts/lint-ia-boundary.mjs",
    "pretest": "npm run lint:terminology && npm run lint:ia-boundary"
  }
}
```

根 `package.json` 如已代理 `lint:terminology`，应新增对应代理脚本：

```json
{
  "scripts": {
    "lint:ia-boundary": "node webui/scripts/lint-ia-boundary.mjs"
  }
}
```

### 7.3 Review Checklist

Review 页或 PR 模板应根据 changed files 自动提示：

| Changed files | 自动提示 |
|---|---|
| `webui/src/pages/connections/**` | 检查数据库接入是否只处理 Connection / Schema / Manifest / Catalog / 白名单 / 连通测试。 |
| `webui/src/components/catalog/**` | 检查上传文案是否明确 Schema Manifest，且目标路径由系统计算。 |
| `webui/src/pages/TableEditor.tsx` | 检查语义层维护是否只处理业务语义和 overlay。 |
| `webui/server/catalog-assets.ts` | 检查 `assetKind`、路径约束、结构校验和 sidecar raw content 禁止。 |
| `webui/server/semantic-assets.ts` | 检查资产包分类、secret hard block 和 Validate Gate。 |

## 8. 测试策略

### 8.1 Lint Tests

- 新增 lint fixture，覆盖允许的 `上传 Schema Manifest`。
- 新增 lint fixture，覆盖禁止的连接页裸 `上传 YAML`。
- 新增 lint fixture，覆盖禁止的连接页 `新增指标`。
- 新增 lint fixture，覆盖允许的文档说明：`上传 YAML 资产` 后明确分型。

### 8.2 API Tests

覆盖：

- `schema_manifest` 上传合法 manifest 成功。
- `schema_manifest` 上传 overlay 被拒绝，返回 `SCHEMA_MANIFEST_EXPECTED` 或 `OVERLAY_FIELD_IN_MANIFEST`。
- `semantic_overlay` 上传 manifest 被拒绝，返回 `MANIFEST_SHAPE_IN_OVERLAY`。
- 兼容旧 `assetType: "schemaManifest"`，但响应中返回 canonical `assetKind: "schema_manifest"`。
- sidecar 不保存 raw YAML content。

### 8.3 Frontend Tests

覆盖：

- 连接概览缺失 Manifest 行显示 `上传 Manifest`。
- 上传 Drawer 标题显示 `Schema Manifest`。
- Drawer 边界说明包含“不编辑指标、Join 或业务语义”。
- 表白名单缺失 Manifest 诊断不出现直接上传入口，只跳转到连接概览。
- 语义层表目录或表详情中的 table 级 YAML 入口显示 `上传 semantic overlay`。
- TableEditor 不出现数据库接入主动作。
- 语义资产发布显示分类后的 asset kind。

## 9. 非目标

本规格不做：

- 新建物理数据库 Connection 的 WebUI 表单。
- WebUI 执行 `ktx ingest`。
- 在线扫描物理数据库 DDL。
- 重新设计语义层编辑器。
- 替代 `webui/docs/23-semantic-asset-publish-export-spec.md` 的资产包发布流程。

## 10. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Asset Kind | asset kind / 资产类型 | 上传 API 与 Validate Gate 中用于区分 Schema Manifest、semantic overlay、资产包 |
| Schema Manifest Upload | 上传 Schema Manifest | 数据库接入中的受控 manifest 上传动作 |
| Semantic Overlay Upload | 上传 semantic overlay | 语义层维护中的 overlay 上传动作 |
| IA Boundary Lint | IA boundary lint | 自动检查模块职责错位文案和动作 |

禁止文案：

- 裸按钮或 Drawer 标题：`上传 YAML`。
- 在数据库接入主动作中使用：`新增指标`、`编辑 Join`、`保存到语义层`。
- 在语义层维护主动作中使用：`添加 Schema`、`测试连接`。

## 11. 验收标准

- `webui/docs/00-product-terminology-standard.md` 包含数据库接入 / 语义层维护 / 语义资产交付职责矩阵。
- `webui/docs/README.md` 和 `webui/docs/plans/README.md` 登记本规格与工单。
- UI 中不存在裸按钮 `上传 YAML`。
- `/connections/whitelist` 不再出现 `上传该 Schema 的 YAML` 或独立 Schema Manifest 上传 Drawer。
- Table 级 YAML 上传入口位于语义层维护，不位于数据库接入。
- 上传 API 接收 canonical `assetKind`，并兼容旧 `assetType: "schemaManifest"`。
- 错传 manifest / overlay 时返回结构化错误，不靠 Toast 模糊失败。
- `npm run lint:terminology` 通过。
- `npm run lint:ia-boundary` 通过。
- `npm test` 通过。
