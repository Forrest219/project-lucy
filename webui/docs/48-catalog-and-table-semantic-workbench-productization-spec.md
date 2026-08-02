# 表目录与表语义资产工作台产品化 Spec

## Background

当前 `表目录` 与单表维护页已经具备基础能力，但浏览器验收和产品反馈显示：页面仍偏“工程对象暴露”，而不是面向 data agent MCP 语义资产治理的工作台。

核心问题：

- `表目录` 使用根路径 `/`，与其他页面 URL 语义不一致。
- 表目录 Header 存在跨模块入口和统计 badge，增加噪音。
- 表格行内存在表名 / 完整名 / Schema 重复展示。
- 筛选仅有 `Schema`，缺少优先级更高的 `Connection`。
- 单表页 `/sources/:conn/:schema/:table` 与表目录的父子关系不清。
- 单表页默认呈现大量手工编辑与候选信息，但真实主流程通常是：
  `导出 YAML -> Claude Code / Codex 完善 -> 导入 -> 校验 -> 保存 / 发布`。
- `变更预览` 默认展示原始 diff，格式化噪音淹没真正变化。

本 Spec 将 `表目录` 定位为表语义资产入口，将单表页定位为表语义资产工作台，而不是大型手工表单。

## Goals

1. 明确 Catalog URL 与单表页层级关系。
2. 降低表目录 Header 和行内信息冗余。
3. 增加 `Connection` 筛选，匹配多数据库治理场景。
4. 将单表页从“手工录入页”调整为“导出 / 导入 / 校验 / 审阅工作台”。
5. 默认聚焦当前表的 YAML 语义资产状态和变化。
6. 简化 `变更预览`，优先展示变化摘要，原始 diff 折叠为高级详情。

## Non-goals

- 不新增 `Owner` 字段。
- 不新增看板引用、血缘、下游引用。
- 不改变 semantic-layer YAML 分层规则。
- 不引入在线 LLM 自动生成语义的 UI。
- 不取消现有轻量手工编辑能力，但默认降级为辅助路径。
- 不改变保存落盘和 validate 的安全边界。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- `表语义资产工作台`：单表语义资产导出、导入、校验和审阅的工作台页面。UI 可简称为 `语义资产` 或 `表语义`，不得称为“手工录入中心”。

Protected terms:

- `Connection`
- `Schema`
- `Agent`
- `YAML`
- `semantic-layer`
- `Manifest`
- `overlay`
- `Diff`
- `Validate`

这些术语在 DOM 中必须使用 `notranslate` 与 `translate="no"`。

## Current Findings

### Catalog

| 反馈 | 验证结论 | 处理方向 |
|---|---|---|
| URL 是 `/`，缺少语义后缀 | 属实 | 新增 canonical `/catalog`，`/` redirect 到 `/catalog` |
| `66 / 66 张表` 可删除 | 合理 | 从 PageHeader 移除，必要时移入筛选结果弱提示 |
| Header `业务 Wiki / 审阅` 可删除 | 合理 | Header 不放跨模块入口，统一从侧边栏或行内菜单进入 |
| 表名重复 | 属实 | 第一列只显示表名，完整路径放 tooltip / copy / 更多菜单 |
| 仅按 Schema 筛选不够 | 属实 | 筛选顺序改为 `Connection -> Schema -> 状态 -> 搜索` |

### Table Semantic Workbench

| 反馈 | 验证结论 | 处理方向 |
|---|---|---|
| `/sources/...` 与 `/` 关系不清 | 属实 | 明确为 `/catalog` 下的表语义资产详情 / 工作台 |
| 页面信息过多 | 属实 | 默认保留导出 / 导入 / 校验 / 保存主链路，折叠次要信息 |
| Header `业务 Wiki / 关联关系 / 审阅` 干扰 | 属实 | Header 只保留保存 / 校验 / 导入导出主操作；其他进更多菜单或区块内 |
| 候选关联关系抢占注意力 | 属实 | 默认折叠为“待处理建议”，在 Joins 区块内处理 |
| 变更预览噪音过大 | 属实 | 摘要优先，原始 Diff 折叠 |

## IA And Routing

### Canonical Routes

| 页面 | 当前 | 新 canonical | 兼容策略 |
|---|---|---|---|
| 表目录 | `/` | `/catalog` | `/` redirect 到 `/catalog` |
| 表语义资产工作台 | `/sources/:conn/:schema/:table` | `/catalog/:conn/:schema/:table` | 旧 `/sources/...` 必须 redirect 到新路由，并保留 query/hash |

### Navigation

侧边栏 `语义建模 -> 表目录` 指向 `/catalog`。

单表页不新增独立一级菜单。它是 `表目录` 的二级页面，不应在侧边栏新增“单表维护”入口。

Breadcrumb:

```txt
表目录 / {Connection} / {Schema} / {table}
```

## Catalog Requirements

### Header

Catalog PageHeader:

- Title: `表目录`
- Description: 保留一句说明即可。
- 删除 PageHeader badge：`66 / 66 张表`。
- 删除 Header actions：`业务 Wiki`、`审阅`。

结果数量如需保留，放在筛选栏右侧弱提示：

```txt
66 条结果
```

### Filters

筛选顺序：

1. `Connection`
2. `Schema`
3. `状态`
4. `搜索`

Data source:

- `Connection` 来自 `/api/sources[].conn`。
- `Schema` 来自当前 Connection 下的 `/api/sources[].schema`。
- `状态` 来自 `/api/sources[].completion`。
- `搜索` 继续匹配 `schema.table` 与 `columnNames`。

Behavior:

- 选择 Connection 后，Schema 选项只显示该 Connection 下的 Schema。
- 切换 Connection 时，如果当前 Schema 不属于新 Connection，重置为 `全部 Schema`。
- 多 Connection 时 Connection 为第一筛选项；单 Connection 时仍展示但可弱化。

### Table Columns

推荐列：

1. `表名`
2. `Connection`
3. `Schema`
4. `语义状态`
5. `结构`
6. `Agent 引用`
7. `语义更新时间`
8. `操作`

`表名` 列：

- 主文本只显示 `table`。
- 不再在同一格重复显示 `{schema}.{table}`。
- 完整引用 `{conn}/{schema}/{table}` 放入 tooltip 或 copy affordance。

`Agent 引用` 列：

- 取 `/api/sources[].authorizedAgentCount`。
- 含义是当前 data agent mcp 系统中引用 / 可见该表的 Agent 数。
- 不表达业务审批意义上的“授权”，也不允许根据表名、schema 或描述猜测。

`操作` 列：

- 主操作保留：`维护语义` 或改名为 `打开工作台`。
- 更多菜单包含：
  - `复制完整引用`
  - `查看详情`
  - `业务 Wiki`

### Responsive Layout

Catalog 表格必须在中等宽度下保持可读。

Acceptance:

- `1440x900`：无横向页面溢出，首屏至少可见 10 条记录。
- `1024x768`：不得撑出整个 document；如需横向滚动，应发生在表格容器内。
- `结构`、`语义更新时间`、`操作` 不得被压成竖排。
- 表头不得使用 `text-transform: uppercase` 导致 `Schema` / `Agent` 视觉变为 `SCHEMA` / `AGENT`。

## Table Semantic Workbench Requirements

### Page Positioning

单表页定位为：

```txt
表语义资产工作台
```

目标用户进入后第一眼应看到：

- 当前表是谁。
- 当前语义资产是否完整。
- 如何导出给 Claude Code / Codex 完善。
- 如何导入完善后的 YAML。
- 导入后发生了哪些变化。
- 是否可校验 / 保存。

### Header

Header 保留：

- Title: `{table}`
- Context chips: `Connection`、`Schema`、`completion`
- Primary actions:
  - `导出 YAML`
  - `导入 YAML`
  - `校验`
  - `保存`（仅有变更时突出）

Header 移除或收敛：

- `业务 Wiki`：放入更多菜单。
- `审阅`：放入更多菜单或侧边栏。
- `关联关系`：不放 Header；进入 Joins 区块或“待处理建议”。

### Main Workflow

默认主路径：

```txt
导出 YAML -> Claude Code / Codex 完善 -> 导入 YAML -> 变更摘要 -> Validate -> 保存
```

页面主区域建议分为三块：

1. `语义资产交换`
   - 导出当前表 YAML。
   - 导入完善后的 YAML。
   - 支持粘贴 Claude Code / Codex 返回的 YAML 并生成 dry-run 预览。
   - 展示导入文件名、校验状态、影响文件。

2. `变更摘要`
   - 只展示本次变化。
   - 按对象分组：
     - 表描述
     - 行粒度
     - 字段描述
     - Measures
     - Segments
     - Joins
   - 每组显示新增 / 修改 / 删除数量。

3. `轻量修正`
   - 表描述
   - 行粒度
   - 必要时可展开字段 / Measures / Segments / Joins。
   - 默认不展示完整大型表单。

### Secondary Information

默认折叠或移到次级区域：

- 左侧表目录树。
- 智能推断候选关联关系。
- 基础语义指标卡。
- 原始 YAML。
- 原始 Diff。
- Validate 详细日志。

建议折叠组：

```txt
待处理建议（1）
目录导航
高级手工编辑
原始 Diff / YAML
Validate 详情
```

### Candidate Joins

候选关联不应默认占据主视觉。

Placement:

- 放在 Joins 区块内，或折叠为 `待处理建议（1）`。

Actions:

- `确认写入语义层`
- `保留为候选`
- `标记不采用`

这些动作保留，但不与导出 / 导入 / 保存争抢 Header 注意力。

## Change Preview Requirements

当前 `变更预览` 默认原始 diff 噪音较大。新的默认视图必须先展示摘要。

### Summary First

默认显示：

```txt
本次变更
- 表描述：新增 human 描述 1 处
- 字段描述：修改 3 处
- Measures：新增 0 / 修改 0 / 删除 0
- Joins：新增 1 / 修改 0 / 删除 0
影响文件
- semantic-layer/mysql-aliyun/_schema/dataforai.yaml
- semantic-layer/mysql-aliyun/kx_dim_company.yaml
```

### Raw Diff

原始 Diff 放入折叠区：

```txt
高级：查看原始 Diff
```

Raw Diff 仍可保留红绿 diff，但不默认占满右侧。

### Formatting Noise

如果 diff 中只有 YAML 折行变化，应尽量识别为格式化变化并弱化显示。

Acceptance:

- 用户修改表描述时，摘要必须明确显示“表描述变更”。
- 用户导入 YAML 后，摘要必须显示影响对象和影响文件。
- 原始 Diff 不得成为默认唯一解释。

## API / Data Contract

优先复用现有接口；新增接口前必须确认现有能力不足。

可能涉及：

- `GET /api/sources`
- `GET /api/sources/:conn/:schema/:table`
- `PUT /api/sources/:conn/:schema/:table`
- 现有 semantic asset upload / export 能力

如需新增表级导出 / 导入接口，建议契约：

```http
GET /api/sources/:conn/:schema/:table/export
POST /api/sources/:conn/:schema/:table/import?dryRun=true
```

Import dry-run response 必须包含：

```ts
type TableYamlImportPreview = {
  ok: true;
  changed: boolean;
  summary: Array<{
    section: "table_description" | "grain" | "columns" | "measures" | "segments" | "joins";
    added: number;
    modified: number;
    removed: number;
  }>;
  files: Array<{
    filePath: string;
    status: "created" | "modified" | "unchanged";
  }>;
  diff: string;
  validation?: ValidationResult;
};
```

## Accessibility And Visual Requirements

- Header actions 不超过 4 个。
- 次要操作使用更多菜单或折叠区。
- 表格中专业英文术语必须防翻译。
- `Schema` / `Agent` 不得被 CSS uppercase 改写视觉大小写。
- 中等宽度不得出现 document 级横向滚动。
- 重要操作必须可键盘访问。
- 变更摘要不依赖颜色表达增删改。

## Acceptance Criteria

Catalog:

- `/catalog` 可访问，`/` redirect 到 `/catalog`。
- 侧边栏 `表目录` 指向 `/catalog`。
- PageHeader 不再展示 `66 / 66 张表`。
- PageHeader 不再展示 `业务 Wiki`、`审阅`。
- 筛选栏包含 `Connection`，且在 `Schema` 前。
- 表名不重复展示。
- `1024x768` 下无 document 级横向溢出。

Table Semantic Workbench:

- `/catalog/:conn/:schema/:table` 可访问。
- 旧 `/sources/:conn/:schema/:table` redirect 到 `/catalog/:conn/:schema/:table`，并保留 query/hash。
- Header 只保留当前表上下文和主链路动作。
- `业务 Wiki`、`审阅` 不再作为 Header 固定按钮。
- `关联关系` 不再作为 Header 固定按钮。
- 页面默认主路径体现 `导出 YAML / 导入 YAML / 校验 / 保存`。
- 候选关联默认折叠。
- 表目录导航和手工维护区默认折叠或降级，不抢占主视觉。
- 变更预览默认展示摘要，原始 Diff 折叠。

Tests:

- Catalog route redirect / canonical route。
- Catalog Header 降噪。
- Connection filter 联动 Schema。
- 表名不重复。
- 旧 `/sources/...` redirect 到 canonical `/catalog/...`。
- 单表页 Header 动作收敛。
- 候选关联默认折叠。
- 变更摘要渲染。
- 原始 Diff 折叠。
- 术语 lint 与 IA boundary lint 通过。

## Rollout

建议分两阶段：

1. Catalog URL / Header / 筛选 / 表格冗余修复。
2. 单表语义资产工作台重构与变更预览摘要化。

阶段 1 可独立上线；阶段 2 涉及较多交互和测试，应单独验收。
