# Lucy Product Terminology Standard

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Terminology Standard |
| 文档类型 | System-wide Product Language / Terminology Standard |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-31 |
| 适用范围 | Lucy WebUI、API 用户可见错误、Toast、Modal、Drawer、表格列名、导航、测试断言、Spec、Plan、Runbook、交付文档 |
| 维护者 | Product / UX / Architecture Review |
| 优先级 | 高于单模块 Spec。单模块 Spec 可新增术语，但不得覆盖本标准中的固定术语 |
| 关联文档 | `webui/docs/06-navigation-ia.md`、`webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 目标

Lucy 是面向数据与语义层运维的 SaaS 产品。术语必须稳定、专业、可审阅，不能依赖浏览器翻译、机器直译或开发时临时命名。

本标准用于解决以下问题：

1. 同一概念在不同页面中出现多个名称，例如 `Schema` 被显示为“架构 / 模式 / Schema”。
2. 行业术语被错误中文化，例如 `Manifest` 被显示为“舱单”，`Package` 被显示为“报价包”。
3. 页面、Toast、测试断言和文档使用不同语言，导致用户认知和开发审阅脱节。
4. 新模块新增术语时缺乏登记入口，后续难以统一治理。

## 2. 治理原则

### 2.1 准确性优先

数据产品、工程系统、语义层和运维语境中的术语必须优先准确，不为了中文化而牺牲含义。

允许保留行业通用英文术语，例如：

- `Schema`
- `Manifest`
- `Catalog`
- `MCP`
- `YAML`
- `Endpoint`
- `API`

### 2.2 一个概念一个主术语

每个产品概念只能有一个 UI 主术语。允许在说明文中补充别名，但按钮、标题、导航、状态 Tag、表头必须使用主术语。

示例：

- 正确：`Schema 筛选`
- 错误：同一模块内同时出现 `Schema 筛选`、`模式筛选`、`架构筛选`

### 2.3 动作用动词短语，状态用状态短语

动作按钮应该回答“用户点击后做什么”：

- `测试连接`
- `刷新本地目录`
- `上传 Schema Manifest`
- `保存变更`

状态文案应该回答“当前处于什么状态”：

- `缺失 Manifest`
- `Catalog 已同步`
- `未测试`
- `预期只读`

### 2.4 禁止机器翻译式幻觉

严禁出现与产品语境不符的直译、误译或浏览器翻译残留。

典型禁止项：

- `财政部舱单`
- `舱单`
- `替代测试`
- `上传报价包`
- `添加架构`
- `目标架构`
- `模式清单`

### 2.5 用户可见文案全部纳入治理

术语标准覆盖所有用户可见文本，包括但不限于：

- 左侧导航和顶部 Header
- 页面标题、副标题、说明文案
- 按钮、链接、菜单项
- Toast、Banner、Alert、Empty State
- Modal / Drawer 标题、表单 Label、Placeholder
- 表格列名、状态 Tag、Tooltip
- API 返回给前端并被直接展示的错误文案
- 测试断言中使用的 UI 文案
- Spec、Plan、Runbook 和用户手册

### 2.6 WebUI 浏览器翻译防御

Chrome / Edge / 浏览器翻译插件可能会篡改 DOM 文本，造成专业术语被误译，例如 `Schema Manifest` 被显示为“财政部舱单”。WebUI 必须在工程层面对专业英文术语进行防御，而不仅依赖文案审阅。

所有包含专业英文术语、代码标识符、文件名、路径、数据库对象名的用户可见 DOM 节点，必须同时添加：

- `translate="no"`
- `className` 包含 `notranslate`

必须覆盖的 UI 类型：

- 状态 Badge：例如 `缺失 Manifest`、`Manifest 状态`。
- 表格单元格：例如 `Schema`、`Endpoint`、`openclaw_db`、`superstore_orders`。
- 表头和字段 Label：例如 `Schema 筛选`、`目标 Schema`。
- 文件名显示区：例如 `openclaw_db.yaml`。
- 路径和 URL：例如 `semantic-layer/demo-mysql/_schema/openclaw_db.yaml`、`http://127.0.0.1:7879/mcp`。
- 代码块和 YAML 示例。

推荐实现：

```tsx
<span translate="no" className="notranslate">
  Schema Manifest
</span>
```

```tsx
<code translate="no" className="notranslate">
  openclaw_db.yaml
</code>
```

如果一个句子中只有部分专业术语需要保护，只包裹术语本身，避免破坏普通中文段落的可读性。

## 3. 全局固定术语表

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Connection | 连接 | 数据库连接 | 链接、联接 | 数据库连接配置对象 |
| Connection Test | 连通测试 | 按钮可用“测试连接” | 替代测试 | 验证凭据、网络、驱动配置是否可用 |
| Schema | Schema | 数据库 Schema | 架构、模式 | 数据库 Schema，UI 默认保留英文 |
| Manifest | Manifest | Schema Manifest | 舱单、财政部舱单、清单、模式清单 | 描述 Schema / 表资产的 YAML manifest |
| Catalog | Catalog | 本地目录、本地 Catalog | 表目录混用 | WebUI 从本地 YAML 读取出的资产目录 |
| Catalog Reload | 刷新本地目录 | 重新读取本地 Catalog | 重新加载资产、触发 ingest | 只读取 `ktx.yaml` 与 `semantic-layer` YAML，不连接数据库 |
| YAML Asset | YAML 资产 | 语义层 YAML | YAML 报价 | 语义层资产文件 |
| Asset Package | 资产包 | 语义资产包 | 报价包 | zip / bundle 形式的资产交付物 |
| Asset Kind | asset kind / 资产类型 | 上传资产类型 | 上传类别泛化 | 上传 API 与 Validate Gate 中区分 Schema Manifest、semantic overlay、资产包 |
| Schema Manifest Upload | 上传 Schema Manifest | 上传 Manifest | 上传该 Schema 的 YAML、裸用“上传 YAML” | 数据库接入中的受控 manifest 上传动作；主入口位于 `/connections` |
| Schema Manifest Repair Link | 去连接概览上传 Manifest | 打开连接概览 | 上传该 Schema 的 YAML、当前页独立上传 YAML | `/connections/whitelist` 缺失 Manifest 诊断中的跳转动作 |
| Semantic Overlay Upload | 上传 semantic overlay | 上传 overlay YAML | 裸用“上传 YAML” | 语义层维护中的 overlay 上传动作 |
| Whitelist | 启用表范围 | 白名单、表白名单（兼容） | 表白、白表 | 控制进入语义层的表范围 |
| Enabled Tables | 启用表范围 | 启用的表 | 表白名单（主导航禁用）、白表、表白 | 控制进入语义层的表范围 |
| Semantic Layer | 语义层 | semantic-layer | 语义图层 | 表、指标、维度、业务语义定义层 |
| Semantic Modeling | 语义建模 | 语义模型 | 语义层维护 + 业务文档作为两个分组 | 涵盖结构化语义（YAML Overlay）与非结构化业务文档（Markdown Wiki） |
| Metric | 指标 | Metric | 度量混用 | 可聚合的业务数值定义 |
| Dimension | 维度 | Dimension | 维数 | 分析分组或切片字段 |
| Measure | 度量 | Measure | 指标混用 | 语义模型内的聚合表达式；当面向业务用户时优先叫“指标” |
| Segment | 分群 | Segment | 片段 | 可复用过滤条件 |
| Join | 关联 | Join | 加入、连接表 | 表之间的 join 关系 |
| Business Wiki | 业务 Wiki | Wiki 文档 | 维基文档可用于导航 | 业务解释和口径文档 |
| Evaluation | 质量评测 | 评测 | 质量评价混用 | 数据问答或语义质量评测 |
| Evaluation Case | 评测用例 | 评测集 | Case 管理、案例管理 | 数据问答 / 语义质量评测的单条样例 |
| Role Permission | 角色权限 | Role、RBAC 角色 | 角色配置、角色模板 | access.yaml 中的 role 模板 |
| Data Heatmap | 数据热力 | 表级访问热力 | 数据源热力、源热力 | 从访问审计派生的表级访问与拒绝分布；UI 收敛为访问日志内的 heatmap Tab（`/admin/audit?tab=heatmap`），原独立路由 `/admin/audit-sources` 保留为兼容重定向（M35） |
| Config Audit | 配置审计 | 配置变更审计 | 配置变更（仅限主导航/PageHeader 标题） | 访问配置写入的审计记录 |
| Review | 审阅 | 变更审阅 | 审核混用 | 人工审阅、PR-like review |
| Approval | 审批 | 批准 | 审阅混用 | 需要明确批准 / 驳回的流程 |
| Audit | 审计 | 审计日志 | 审阅 | 操作追踪、合规记录 |
| Run History | 运行历史 | 执行历史 | 历史记录泛化 | 作业、评测、发布等运行记录 |
| Endpoint | Endpoint | 端点 | 终点、端口 | 服务访问地址或协议入口 |
| MCP Endpoint | MCP Endpoint | MCP 端点 | MCP 地址乱用 | MCP 服务访问入口 |
| Read-only | 只读 | 预期只读 | 读取模式 | 连接或运行环境只读约束 |
| Runtime | Runtime | 运行时 | 运行时间 | 系统运行环境或服务状态 |
| Upload | 上传 | 上传文件 | 上载 | 用户提交本地文件或文本 |
| Download | 下载 | 导出 | 下传 | 用户获取文件 |
| Export | 导出 | 下载资产包 | 输出 | 从系统生成可下载交付物 |
| Import | 导入 | 上传资产包 | 输入 | 将外部资产纳入系统 |
| Ops Dashboard | 运维驾驶舱 | 系统概览 | 大屏、看板（作为主标题） | 系统概览的产品心智升级，强调 data agent 可服务状态 |
| Action Required | 待处理事项 | 运维待办 | 告警列表泛化 | 首页聚合的跨模块待处理队列 |
| Object Detail Drawer | 对象详情抽屉 | 详情抽屉 | 详情弹窗泛化 | 跨模块查看 Connection / Table / Agent / Eval Run / Audit Event 等对象上下文 |
| Change Impact | 变更影响范围 | 影响范围 | 影响分析（作为按钮主名） | 发布前说明哪些对象、Agent、eval 可能被影响 |
| Quality Operations | 质量运营 | 质量评测运营 | 质量评价 | 评测模块从列表管理升级为持续运营，含趋势、阈值、失败归因 |

### 3.1 Review 与 Approval 的边界

`Review` 和 `Approval` 都可能发生在变更治理流程中，但产品语义不同，不能混用。

| 概念 | UI 主术语 | 典型对象 | 推荐动作按钮 | 不应使用 |
|---|---|---|---|---|
| Review | 审阅 | YAML diff、语义变更、PR-like 变更集、质量评测结果 | `提交审阅`、`通过审阅`、`退回修改` | `同意`、`驳回` |
| Approval | 审批 | 带权限控制的发布、上线、访问授权、治理流程 | `同意`、`驳回`、`撤回审批` | `通过审阅` |

判定规则：

- 如果核心任务是检查内容质量、差异、可维护性，使用 `审阅`。
- 如果核心任务是基于权限作出治理决策，使用 `审批`。
- `审阅人` 负责检查内容；`审批人` 负责作出批准 / 驳回决定。
- 同一流程可以先审阅再审批，但两个阶段的标题、按钮和状态必须分开表达。

## 4. 模块术语分区

### 4.1 数据库接入

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Connection Overview | 连接概览 | 连接总览混用 | 数据库接入主工作台 |
| Table Whitelist | 启用表范围 | 白表、表白、表白名单（主导航禁用） | `enabled_tables` 的 UI 管理入口 |
| Add Schema | 添加 Schema | 添加架构、添加模式 | 向连接配置追加 Schema |
| Target Schema | 目标 Schema | 目标架构、目标模式 | 上传或添加流程中的目标 Schema |
| Manifest Status | Manifest 状态 | 清单状态、舱单状态 | Schema manifest 是否存在 |
| Missing Manifest | 缺失 Manifest | 财政部舱单、缺失清单 | 本地 manifest 文件不存在 |
| Upload Schema Manifest | 上传 Schema Manifest | 上传 Manifest | 上传该 Schema 的 YAML、裸用“上传 YAML” | 写入 `semantic-layer/<connection>/_schema/<schema>.yaml`；主入口位于 `/connections` |
| Schema Manifest Repair Link | 去连接概览上传 Manifest | 打开连接概览 | 当前页独立上传 YAML | 启用表范围缺失 Manifest 诊断只跳转，不在当前页上传 |
| Refresh Local Catalog | 刷新本地目录 | 重新加载资产 | 重新读取本地 YAML 资产 |

### 4.2 语义建模

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Table Catalog | 表目录 | 表格目录 | 已入库语义层对象列表 |
| Business Wiki | 业务 Wiki | Wiki 文档（仅兼容期） | 业务解释和口径文档 |
| Business Annotation | 业务注释 | 查看注释可接受 | 面向业务的表 / 字段解释 |
| Metric Definition | 指标定义 | 度量定义混用 | 指标口径、聚合方式、过滤条件 |
| Dimension Definition | 维度定义 | 维数定义 | 维度字段和展示属性 |
| Upload Semantic Overlay | 上传 semantic overlay | 上传 overlay YAML | 裸用“上传 YAML” | 写入 `semantic-layer/<connection>/<table>.yaml` |

语义层对象展示必须遵守自顶向下的层级顺序：

```text
Connection (连接)
  -> Schema
  -> Table (表 / 底表)
  -> Semantic Source (语义源)
  -> Metric / Dimension (指标 / 维度)
```

面向业务分析师的 UI 优先使用 `指标 (Metric)`，因为用户关心业务口径和分析结果。只有在语义模型内部表达式、聚合节点或兼容 Cube/dbt 等建模术语时，才使用 `度量 (Measure)`。

示例：

- 业务页面：`新增指标`、`指标定义`、`指标口径`
- 模型内部：`Measure 表达式`、`Measure SQL`

### 4.2.1 数据接入 / 语义建模 / 语义资产交付边界

数据接入负责让 Connection、Schema、启用表范围和 Schema Manifest 进入 Lucy，并保持本地 Catalog 可读。
语义建模负责维护已进入 Lucy 的表的业务语义，包括字段说明、grain、指标、分群和 Join。
语义资产交付负责资产包级导入、导出、Validate Gate 与发布。

| 能力 | 数据接入 | 语义建模 | 语义资产交付 |
|---|---|---|---|
| 查看 Connection | Owner | Consumer | Consumer |
| 添加 Schema 到 `ktx.yaml` | Owner | 不负责 | 不负责 |
| 连通测试 | Owner | 不负责 | 不负责 |
| 启用表范围 / `enabled_tables` | Owner | Consumer | Consumer |
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

按钮、Drawer 标题、Toast 主动作不得裸用 `上传 YAML`。必须写明 `上传 Schema Manifest`、`上传 semantic overlay` 或 `上传资产包`；说明文中使用 `YAML 资产` 总称时，必须在同一段落中说明具体类型。

入口归属：

- Schema 级 YAML（Schema Manifest）上传主入口位于 `/connections`。
- `/connections/whitelist` 只展示缺失 Manifest 诊断与 `去连接概览上传 Manifest` / `打开连接概览` 跳转，不提供独立上传入口。
- Table 级 YAML（semantic overlay）上传入口位于语义层维护的 `表目录` 或表详情业务语义区域。

### 4.3 审阅与审核

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Change Review | 变更审阅 | 变更审核混用 | 人工检查语义资产变更 |
| Approval Flow | 审批流程 | 审阅流程混用 | 需要批准 / 驳回的流程 |
| Reviewer | 审阅人 | 审核员混用 | 执行 review 的角色 |
| Approver | 审批人 | 审阅人混用 | 执行 approval 的角色 |

审阅与审批的流程分工必须与第 3.1 节一致：

- `变更审阅` 使用 `提交审阅`、`通过审阅`、`退回修改`。
- `审批流程` 使用 `同意`、`驳回`、`撤回审批`。
- 不得把 `通过审阅` 用作权限审批动作。
- 不得把 `同意` 用作普通 YAML diff review 动作。

### 4.4 质量评测

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Evaluation Case | 评测用例 / 评测集 | Case 管理、案例管理 | 单条测试问题或评测样例 |
| Evaluation Run | 评测运行 | 评价运行 | 一次批量评测执行 |
| Trend Monitoring | 趋势监控 | 趋势监管 | 质量指标随时间变化 |
| Pass Rate | 通过率 | 成功率混用 | 评测通过比例 |

### 4.5 系统与运维

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| System Overview | 系统概览 | 系统总览混用 | 全局运行状态页 |
| Runtime Status | 运行状态 | 运行时间状态 | 服务运行健康情况 |
| Public MCP URL | Public MCP URL | 公共 MCP 地址 | 部署暴露给外部的 MCP URL |
| Asset Delivery | 资产交付 | 资产下载区 | 运维级导出、发布、交付入口 |
| Sidebar Group | 系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理 | 5+1 主导航 | 运行状态、数据库接入、语义层维护、业务文档作为主导航分组 | Lucy WebUI 侧边栏固定 IA |

## 5. 新术语登记流程

任何新功能 Spec 或 Plan 引入新的产品概念时，必须执行以下流程：

1. 先查本标准第 3 节全局术语表。
2. 如果已有术语，直接复用主术语。
3. 如果没有术语，在对应模块分区新增一行。
4. 如果该概念会跨模块使用，必须加入第 3 节全局固定术语表。
5. 在功能 Spec 中增加 `Terminology Compliance` 小节，说明是否新增术语。
6. 在开发测试中增加关键文案断言，防止回归。

功能 Spec 推荐模板：

```md
## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- Foo Bar: UI 主术语为“Foo Bar”，用于描述...

Forbidden terms:
- ...
```

如果没有新增术语：

```md
## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

No new product terms introduced.
```

## 6. 测试与审阅要求

### 6.1 Forbidden Terms 测试

前端测试应维护一组禁止文案，至少覆盖：

```ts
const forbiddenTerms = [
  "财政部舱单",
  "舱单",
  "替代测试",
  "上传报价包",
  "添加架构",
  "目标架构",
  "模式清单",
  "重新加载资产",
]
```

关键页面测试应断言页面中不出现这些词：

- `/connections`
- `/connections/whitelist`
- `/connections/test`
- 上传 YAML Drawer
- Catalog Reload 结果面板

### 6.2 术语静态检查

除 Vitest / Testing Library 页面断言外，建议增加轻量术语 linter，用正则扫描 `webui/src/**`、`webui/server/**` 和 `webui/docs/**` 中的硬编码用户可见字符串。

推荐落地位置：

- `npm test` 的前置或并行任务。
- Git commit hook，例如 Husky `pre-commit`。
- CI 的独立 job，例如 `npm run lint:terminology`。

建议扫描范围：

- `.tsx`
- `.ts`
- `.md`
- `.html`

建议规则：

- 禁止出现第 6.1 节 forbidden terms。
- 检查包含 `Schema`、`Manifest`、`Endpoint`、文件名、路径、数据库对象名的关键 JSX 节点是否具备 `translate="no"` 和 `notranslate`。
- 对文档中的 forbidden terms 允许只出现在“禁止文案 / Forbidden Terms / 反例”上下文中。

静态检查不替代人工审阅。它只负责拦截高确定性的禁用词和明显缺失的浏览器翻译防御。

### 6.3 Review Checklist

所有涉及 UI 文案的代码审阅必须检查：

- 是否复用全局固定术语。
- 是否把 `Schema` 错译为“架构 / 模式”。
- 是否把 `Manifest` 错译为“舱单 / 清单”。
- 是否把 `Package` 错译为“报价包”。
- 是否为专业英文术语、代码标识符、文件名、路径和 URL 添加 `translate="no"` 与 `notranslate`。
- 是否正确区分 `审阅 (Review)` 与 `审批 (Approval)`。
- 按钮文案是否是清晰动词短语。
- 状态 Tag 是否是稳定状态短语。
- Toast / Banner 是否避免技术噪声压过用户结论。

### 6.4 文档审阅

Spec、Plan、Runbook 中的新概念也必须遵守本标准。文档可以解释英文术语，但不得在标题、表头、状态名称中制造新译名。

## 7. 迁移优先级

### P0

- 删除所有机器翻译幻觉：
  - `财政部舱单`
  - `替代测试`
  - `上传报价包`
- 为专业英文术语、数据库对象名、文件名、路径、URL 的 DOM 节点补齐 `translate="no"` 和 `notranslate`。
- 修复上传 YAML Drawer 中非法中文 YAML placeholder。
- 修复用户可见的 `架构 / 模式` 混用，统一为 `Schema`。

### P1

- 将数据库接入模块中的 `Catalog Reload` 文案统一为 `刷新本地目录`。
- 将全量资产包导出从 `/connections` 页面迁出到系统级资产交付入口。
- 在前端测试中加入 forbidden terms guard。
- 增加轻量术语 linter，接入 `npm test`、pre-commit 或 CI。
- 在审阅与审核模块中明确区分 `审阅` 与 `审批` 的页面标题、按钮和状态。

### P2

- 对其他模块做术语巡检：
  - 语义层维护
  - 业务 Wiki
  - 审阅与审核
  - 质量评测
  - 系统概览
- 在每个新增 Spec 模板中固定 `Terminology Compliance` 小节。

## 8. 非目标

- 本标准不定义 API 字段名，除非字段值会直接展示给用户。
- 本标准不要求所有英文技术词强制翻译为中文。
- 本标准不替代设计系统、布局规范或交互规范。
- 本标准不改变 M14 / M17 的静态 Catalog 架构决议。
