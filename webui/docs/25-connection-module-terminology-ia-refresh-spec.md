# Connection Module Terminology And IA Refresh Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Connection Module Terminology And IA Refresh Spec |
| 文档类型 | Product / UX / IA Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI 数据库接入模块：`/connections`、`/connections/whitelist`、`/connections/test`、连接卡片、上传 YAML Drawer、本地 Catalog reload 结果提示、语义资产包导出入口 |
| 架构决议 | 数据库接入模块以 Connection 为核心业务对象；Schema / Manifest / Catalog 等数据产品术语不得被浏览器翻译或本地文案误译；连通测试和白名单维护应回到连接上下文中，孤立页面仅作为兼容入口 |
| 事实源 | `ktx.yaml`、`semantic-layer/<connection>/_schema/<schema>.yaml`、`semantic-layer/<connection>/<table>.yaml`、`.ktx-ui/**` sidecar |
| 关联文档 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/22-public-mcp-endpoint-runtime-config-spec.md`、`webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/11-connection-whitelist-test-ux-refresh.md`、`webui/docs/03-api-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 决策摘要

数据库接入模块已从 CLI ingest 转为静态 Catalog Loading，并引入了受控 YAML 上传能力。但最新界面暴露出新的交付风险：

1. 关键术语被错误翻译，例如 `Schema Manifest` 被显示为“财政部舱单”，`Connection Test` 被显示为“替代测试”，`Package` 被显示为“报价包”。
2. 数据库接入二级页面被拆成“连接概览 / 表白名单 / 连通测试”三个孤岛，用户需要频繁切换上下文才能完成同一个 Connection 的配置闭环。
3. 连接卡片内按钮过多，连接级动作、Schema 上下文动作、系统级资产包导出混在同一层级。
4. 上传 YAML Drawer 的示例占位符出现非法中文 YAML key，可能诱导用户提交无法解析的 YAML。
5. Catalog reload 结果提示信息过重，微观指标和 warning 形成嵌套噪声。

本规格作出以下产品决议：

1. 全站术语以 `webui/docs/00-product-terminology-standard.md` 为准，禁止把 `Schema`、`Manifest`、`Package` 交给机器翻译式中文化。
2. `/connections` 作为数据库接入主工作台，以 Connection Card 为核心承载连接身份、Schema 资产状态、白名单入口、连通测试入口和本地 Catalog 刷新。
3. `/connections/test` 保留兼容路由，但从主导航降级；连通测试主入口迁移到连接卡片内，通过 Drawer / Modal 展示诊断结果。
4. 系统级资产包导出不再挂在连接列表下方，应迁移到语义资产交付或运维管理页面。
5. 上传 YAML Drawer 必须提供合法英文 YAML 示例，并修复关闭按钮、文件名回显和底部操作区布局。
6. Reload 结果主提示只保留面向用户的摘要；耗时、schema 比例、warning 明细进入可展开详情。

## 2. 术语合规与模块增补

本模块必须服从系统级术语标准：`webui/docs/00-product-terminology-standard.md`。

如本节与系统级标准冲突，以系统级标准为准。本节只记录数据库接入模块的术语投影和实现侧落地要求。

### 2.1 数据库接入术语表

| 英文术语 | UI 推荐中文 | 禁止文案 | 说明 |
|---|---|---|---|
| Connection | 连接 | 链接、联接 | 数据库连接配置对象 |
| Connection Test | 连通测试 | 替代测试 | 页面标题用“连通测试”，动作按钮用“测试连接” |
| Schema | Schema | 架构、模式 | 数据库领域保留英文，必要时写“数据库 Schema” |
| Schema Manifest | Manifest / Schema Manifest | 舱单、财政部舱单、模式清单 | 状态推荐“缺失 Manifest”“待上传 Manifest” |
| Catalog | Catalog / 本地目录 | 目录状态可接受；不要混作表目录 | 指本地 YAML catalog，不是物理数据库扫描 |
| Catalog Reload | 刷新本地目录 | 重新加载资产、触发 ingest | 必须说明只读本地 YAML，不连库 |
| YAML Asset | YAML 资产 | YAML 报价 | 指语义层 YAML 文件 |
| Asset Package | 资产包 | 报价包 | 指 zip / bundle 交付物 |
| Whitelist | 表白名单 | 表白、白表 | 现有产品名保留 |

### 2.2 术语落地规则

- UI 文案、测试断言、文档示例必须统一使用上表术语。
- Schema 不再翻译成“架构”或“模式”，包括：
  - `+ 添加 Schema`
  - `Schema 筛选`
  - `目标 Schema`
  - `上传该 Schema 的 YAML`
- Manifest 不翻译成“清单”或“舱单”。可以组合为：
  - `缺失 Manifest`
  - `待上传 Manifest`
  - `Manifest 状态`
- 资产包相关动作统一：
  - `上传资产包`
  - `下载当前全量资产包`
  - 不得出现“报价包”。
- 连通测试统一：
  - 导航、面包屑、页面标题：`连通测试`
  - 连接卡片按钮：`测试连接`

## 3. 信息架构

### 3.1 Connection 作为核心对象

数据库接入模块的主业务对象是 Connection。白名单、Schema manifest、连通测试、本地 Catalog 刷新都是 Connection 的配置或状态，不应被拆成互不关联的页面体验。

推荐工作流：

```text
/connections
  Connection Card: demo-mysql
    ├─ Schema 资产表
    │   ├─ dataforai: 已存在 -> 维护白名单
    │   └─ openclaw_db: 缺失 Manifest -> 上传 Manifest
    ├─ 测试连接 -> Drawer 展示连通结果和原始日志
    ├─ 添加 Schema -> AddSchemaDrawer
    └─ 刷新本地目录 -> Reload 结果摘要 + 详情
```

### 3.2 `/connections/test` 兼容策略

`/connections/test` 不应继续作为数据库接入主导航中的一等页面。

阶段性策略：

1. P1：保留路由，移出或弱化左侧导航主菜单。
2. P1：页面内增加提示：建议在连接概览中选择具体连接并点击“测试连接”。
3. P2：当连接卡片内测试 Drawer 完整覆盖能力后，`/connections/test` 可降级为兼容跳转页或隐藏页。

不得直接删除路由，以免破坏已有 URL、测试或外部文档链接。

### 3.3 表白名单定位

`/connections/whitelist` 可以继续保留为独立页面，因为白名单维护需要较大表格空间。但必须保留 Connection / Schema 上下文入口：

- 从连接卡片的 `维护白名单` 跳转到 `/connections/whitelist?schema=<schema>`。
- 白名单页继续支持 `schema` query param 自动筛选。
- 白名单页术语统一使用 `Schema`，不再使用“架构 / 模式”。

### 3.4 全局资产包导出

`下载当前全量资产包 (.zip)` 是系统级 / 运维级 / 交付级动作，不属于某个数据库 Connection。

决议：

- 从 `/connections` 连接列表底部移除全量资产包导出卡片。
- 推荐迁移到以下位置之一：
  - `审阅与审核 / 资产交付`
  - `运维管理 / 资产包导出`
  - 语义资产发布页面的顶部 Action Bar
- 在 `/connections` 中最多保留短链接或轻量入口，不占用连接卡片下方主空间。

## 4. 页面规格

### 4.1 `/connections` 连接概览

#### Header

沿用 M17 Header 治理：

- 面包屑：`数据库接入 / 连接概览`
- 标题：`连接概览`
- 描述：`维护每个连接的 Schema、YAML 资产与本地目录刷新状态。`
- Badge：仅保留项目路径，例如 `/data/lucy`

不得在 Header 放跨页面导航按钮或系统级导出按钮。

#### Metric Cards

保留 4 张指标卡：

1. 数据连接。
2. 启用的表。
3. 语义层对象。
4. Catalog 状态。

指标卡内术语必须统一：

- `2 个 Schema`
- `来自 ktx.yaml enabled_tables`
- `已进入语义层的表`
- `Catalog 状态`

#### Connection Card

连接卡片使用三段式结构：

```text
┌──────────────────────────────────────────────────────────────┐
│ [MySQL] demo-mysql                [未测试] [预期只读]          │
│ 配置来源：ktx.yaml。凭据不在 WebUI 中编辑。                    │
├──────────────────────────────────────────────────────────────┤
│ 关联 Schema 资产列表                                           │
│ Schema        Manifest 状态       本地表数       上下文动作     │
│ dataforai     已存在              3 张表         维护白名单     │
│ openclaw_db   缺失 Manifest       0 张表         上传 Manifest  │
├──────────────────────────────────────────────────────────────┤
│ Catalog 已同步 · 2026-07-29 23:50 · 1 个提示                    │
│                    [添加 Schema] [上传 YAML] [测试连接] [刷新本地目录] │
└──────────────────────────────────────────────────────────────┘
```

按钮层级：

- Schema 行内动作只处理当前 Schema：
  - 已存在 Manifest：`维护白名单`
  - 缺失 Manifest：`上传 Manifest`
  - 解析失败：`查看错误` 或 `重新上传 Manifest`
- 卡片 Footer 只处理连接级动作：
  - `添加 Schema`
  - `上传 YAML`
  - `测试连接`
  - `刷新本地目录`
- 如果任一 Schema 缺失 Manifest，则 `上传 YAML` 可以作为 Primary。
- 不在连接卡片 Footer 放 `上传资产包` 或 `下载资产包`。

#### 缺失 Manifest 行

- 状态 Tag：`缺失 Manifest`。
- 行背景可使用极浅 warning 色，例如 `#FEFCE8`。
- 不使用“财政部舱单”“模式清单”等翻译。

#### Catalog 状态

只渲染一个状态行，避免“上次刷新”和“上次 Reload”重复。

推荐文案：

```text
Catalog 已同步 · 2026-07-29 23:50 · 1 个提示
Catalog 未刷新 · 尚未读取本地 YAML
Catalog 刷新失败 · 2026-07-29 23:50
```

### 4.2 `/connections/whitelist` 表白名单

必须修复术语：

- `Schema 筛选`，不要用“架构筛选”或“模式筛选”。
- `全部 Schema`。
- 分组标题：`连接：DEMO-MYSQL · Schema：DATAFORAI`。
- 空 Schema 提示中使用 `Manifest`，例如：

```text
openclaw_db 已在连接配置中启用，但本地语义层尚未提供 Manifest。
```

按钮：

- `上传该 Schema 的 YAML`
- `打开连接概览`
- `刷新本地目录`

### 4.3 `/connections/test` 连通测试

短期修复：

- 导航和 Header 必须显示 `连通测试`。
- 主按钮显示 `重新测试连接`。
- 空状态显示 `尚未测试`。

中期收敛：

- 从连接卡片点击 `测试连接` 打开 `ConnectionTestDrawer`。
- Drawer 展示：
  - 状态 Banner：成功 / 失败 / 尚未测试。
  - 延时。
  - Driver / Wire Protocol / Read-only expected。
  - 可折叠原始日志 stdout / stderr。
- `/connections/test` 页面作为兼容入口调用同一套组件，不再维护第二套 UI。

### 4.4 上传 YAML Drawer

#### 标题与说明

推荐文案：

```text
上传 demo-mysql 的 Schema Manifest
目标路径由系统计算；会校验连接、Schema、YAML 结构、文件大小与目标路径。写入成功后会自动刷新本地目录。
目标 Schema：openclaw_db
```

不得出现：

- `上传 demo-mysql 的模式清单`
- `目标架构`
- `目标模式`

#### 关闭按钮

- 右上角使用图标按钮或单行 `关闭`。
- 不允许出现“关 / 闭”竖排。
- 按钮应有稳定尺寸，例如 `32px x 32px` 或使用现有 icon button 规范。

#### YAML Placeholder

必须提供合法英文 YAML：

```yaml
tables:
  customers:
    table: openclaw_db.customers
    columns:
      - name: customer_id
      - name: customer_name
```

不得出现中文 key，例如：

```yaml
表:
客户:
```

#### 文件名回显

- 文件名必须原样显示用户选择的文件名。
- 不得拼接状态词，例如 `openclaw_db已.yaml`。
- 文件名展示区域建议使用 `dir="ltr"` 和 `translate="no"`，避免浏览器翻译插件篡改。

#### 底部操作区

- Drawer Footer 固定在底部，保持足够 padding。
- 主按钮：`上传并刷新本地目录`。
- 次按钮：`取消`。
- 禁用状态要有明确原因，例如未选择文件或未粘贴 YAML 时禁用主按钮。

### 4.5 Catalog Reload 结果提示

主提示只显示摘要：

```text
本地 Catalog 已重新加载 · 1 个提示
```

详细信息进入可展开区域：

```text
详情
- 范围：连接 demo-mysql
- 表：3
- 已启用：3
- Schema：1 / 2
- 耗时：8 ms
```

Warning 展示：

```text
缺失 Manifest · openclaw_db
openclaw_db 已在连接配置中启用，但 semantic-layer/demo-mysql/_schema/openclaw_db.yaml 不存在。
```

不得使用橙色外框套橙色内框的大面积双重警告样式。主容器和 warning item 应有清晰层级：摘要为轻量状态，warning 为可展开明细。

## 5. 功能与 API 影响

本规格不要求新增后端 API。主要是前端 IA、文案和组件复用调整。

可能涉及的既有 API：

- `GET /api/project`
- `GET /api/sources`
- `GET /api/catalog/reloads`
- `POST /api/catalog/reload`
- `POST /api/connections/:connId/test`
- `POST /api/catalog/assets/validate`
- `POST /api/catalog/assets/upload`
- 语义资产包导出相关 API，如已存在，则迁移入口；如未稳定，不在 `/connections` 暴露。

## 6. 非目标

- 不恢复 `ktx ingest`。
- 不访问物理数据库扫描 DDL。
- 不引入 LLM / embedding / enrichment 依赖。
- 不删除 `/connections/test` 路由。
- 不重做整个左侧导航系统。
- 不把 Schema 翻译成“架构”或“模式”。
- 不新增任意路径上传能力。

## 7. 验收标准

### 7.1 P0 术语验收

- `/connections`、`/connections/whitelist`、`/connections/test` 不出现：
  - `财政部舱单`
  - `上传报价包`
  - `替代测试`
  - `添加架构`
  - `目标架构`
  - `模式清单`
- 缺失 manifest 状态显示为 `缺失 Manifest` 或 `待上传 Manifest`。
- Connection Test 页面和导航显示 `连通测试`。
- Schema 相关控件统一使用 `Schema`。

### 7.2 P0 上传 Drawer 验收

- 右上角关闭按钮不竖排。
- YAML placeholder 是合法英文 YAML。
- 选择文件后文件名原样展示，不拼接“已”等状态词。
- Footer 按钮有稳定 padding 和间距。

### 7.3 P1 IA 验收

- 连接卡片内不出现 `上传报价包` 或系统级资产包按钮。
- 全量资产包导出不再位于 `/connections` 连接列表下方。
- `测试连接` 可从连接卡片直接触发 Drawer / Modal。
- `/connections/test` 作为兼容入口仍可访问，但主导航不再强化“替代测试”式孤立页面。

### 7.4 P2 结果提示验收

- Catalog reload 成功提示主文案精简。
- 耗时、schema 比例等细节默认不挤在主标题中。
- Warning 明细不再形成橙色外框套橙色内框的双重嵌套。

### 7.5 技术验收

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run src/__tests__/connection-overview.test.tsx
npm test -- --run src/__tests__/table-whitelist.test.tsx
npm test -- --run src/__tests__/connection-test.test.tsx
npm test -- --run src/__tests__/catalog-asset-upload.test.tsx
npm test -- --run src/__tests__/catalog-reload-components.test.tsx
npm test -- --run
npm run build
```

Vite chunk-size warning 如与本任务无关，可接受。
