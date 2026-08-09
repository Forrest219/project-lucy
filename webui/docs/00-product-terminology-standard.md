# Lucy Product Terminology Standard

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Terminology Standard |
| 文档类型 | System-wide Product Language / Terminology Standard |
| 版本 | v0.3 |
| 撰写日期 | 2026-07-31；2026-08-01 v0.2（新增 Data Agent Ops Control Plane）；2026-08-08 v0.3（登记 Access Control Upgrade / AC-P0 术语，见 §3 与 §4.8） |
| 适用范围 | Lucy WebUI、API 用户可见错误、Toast、Modal、Drawer、表格列名、导航、测试断言、Spec、Plan、Runbook、交付文档 |
| 维护者 | Product / UX / Architecture Review |
| 优先级 | 高于单模块 Spec。单模块 Spec 可新增术语，但不得覆盖本标准中的固定术语 |
| 关联文档 | `webui/docs/06-navigation-ia.md`、`webui/docs/17-static-catalog-loading-spec.md`、`webui/docs/21-connection-catalog-upload-ux-spec.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/98-access-control-p0-runtime-spec.md`、`docs/access-control/design-upgrade.md`、`docs/DEVELOPMENT.md` |

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
| Semantic Asset | 语义资产 | 表语义资产、结构化 YAML 模型 | 表目录（主导航 / PageHeader 禁用） | 语义建模下的结构化 YAML 模型维护入口 |
| Metric | 指标 | Metric | 度量混用 | 可聚合的业务数值定义 |
| Dimension | 维度 | Dimension | 维数 | 分析分组或切片字段 |
| Measure | 度量 | Measure | 指标混用 | 语义模型内的聚合表达式；当面向业务用户时优先叫“指标” |
| Segment | 分群 | Segment | 片段 | 可复用过滤条件 |
| Join | 关联 | Join | 加入、连接表 | 表之间的 join 关系 |
| Business Wiki | 业务 Wiki | Wiki 文档 | 维基文档可用于导航 | 业务解释和口径文档 |
| Evaluation | 质量评测 | 评测 | 质量评价混用 | 数据问答或语义质量评测 |
| Evaluation Case | 评测用例 | 评测集 | Case 管理、案例管理 | 数据问答 / 语义质量评测的单条样例 |
| Role Permission | 角色权限 | Role、RBAC 角色 | 角色配置、角色模板 | access.yaml 中的 role 模板 |
| Role ID | 角色标识 | 技术 ID、role id | Role Name（暗示可当 yaml key 的中文名）、流水号（无 schema 时） | `access.yaml.roles.<id>`；Agent 引用用技术标识；规则 `^[A-Za-z0-9_-]{1,64}$` |
| Role Description | 说明 | 用途说明 | Role Name（与角色标识混淆时） | Role 的中文用途说明；列表/详情主文案 |
| Role Connection Allow-list | 允许的连接 | 数据库连接 | Connections（裸露主标签）、链接 | Role 可使用的连接；`allow.connections` |
| Role MCP Tool Allow-list | 允许的 MCP 工具 | 工具权限 | Tools（裸露）、MCP Tools（无中文主标签） | Role 显式工具清单；禁止 `*` |
| Role Table Selector | 可访问的表范围 | 表授权范围 | Table Selectors（裸露）、selector（主按钮文案） | `allow.tableSelectors` |
| Exact Table Names | 指定表名 | 精确授权这些表 | names（裸露 radio） | selector `names` |
| Table Name Prefix | 按前缀匹配 | 前缀批量授权 | prefix（裸露 radio） | selector `prefix`；UI 标为高级 |
| Role Capability Filter | 按能力筛选 | 按连接 / 工具 / 表筛选 | 功能筛选（与状态筛选混淆） | `/admin/roles` 次级筛选维 |
| Persisted Role | 正式 Role | 已落盘 Role、正式（badge 短标签） | YAML role（作为主标签）、已启用（无 enabled 字段时） | `source=yaml`，写入 access.yaml |
| Reference Role Template | 参考模板 | 内置参考模板 | Template（裸露）、模板角色（暗示可直接运行） | 系统预置只读参考配置，低频辅助创建 |
| In Use Role | 使用中 | 被 Agent 引用 | 正在服务 Agent（主标签）、in use、已启用 | 正式 Role 且至少 1 个 Agent 引用 |
| Unused Role | 未引用 | 暂无 Agent 引用 | 未被 Agent 使用（主标签）、空闲（暗示可删） | 正式 Role 且无 Agent 引用 |
| Needs Repair Role | 待修复 | 权限解析失败 | Invalid、禁用、已停用 | 正式 Role 无法解析为有效权限边界 |
| Config Last Written | 配置最近写入 | access.yaml 最近修改 | 创建日期（在无字段时伪造） | 来自 access.yaml mtime（Asia/Shanghai 展示） |
| Data Heatmap | 数据热力 | 表级访问热力 | 数据源热力、源热力 | 表级访问与拒绝分布 API（`/api/admin/audit/sources`）仍保留；Spec 89 已从 `/admin/audit` 移除 heatmap Tab；原 `/admin/audit-sources` 重定向到 `/admin/audit` |
| Config Audit | 配置审计 | 配置变更审计 | 配置变更（仅限主导航/PageHeader 标题） | 访问配置写入的审计记录 |
| Config Audit Actor | 操作者 | 本机管理员（local-admin 展示） | Actor、local-admin（作为唯一可见列头/单元格） | Spec 96：表头用「操作者」；单管理员模式下单元格展示「本机管理员」 |
| Config Audit Change Type | 变更类型 | 配置变更类型 | 类型（过宽）、changeType（裸露） | Spec 96 表头与筛选 |
| Config Audit Asset Kind | 资产域 | 配置资产域 | assetKind、资产类型（与 Semantic Asset Kind 混淆） | Spec 90/96：governance/semantic/wiki/eval/publish |
| Config Audit CSV Export | 导出 CSV（与主表一致） | 配置审计导出 | 英文原始列 dump、仅到日的文件名 | Spec 97：列头/单元格与主表 7 列中文一致；文件名 `config-audit-YYYYMMDD-HHmmss.csv` |
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
| Data Agent Ops Control Plane | Data Agent Ops Control Plane | Data Agent 运维控制台 | 语义维护工作台、KTX WebUI（仅作为 UI 副标题时）、控制台（作为唯一称谓）、运维控制面（M37 后视为弃用） | Lucy WebUI 的产品定位；自 M37 起在品牌区副标题出现，文档叙事中以英文 brand term 优先 |
| Ops Dashboard | 运维驾驶舱 | 系统概览 | 大屏、看板（作为主标题） | 系统概览的产品心智升级，强调 data agent 可服务状态 |
| Action Required | 待处理事项 | 运维待办 | 告警列表泛化 | 首页聚合的跨模块待处理队列 |
| Object Detail Drawer | 对象详情抽屉 | 详情抽屉 | 详情弹窗泛化 | 跨模块查看 Connection / Table / Agent / Eval Run / Audit Event 等对象上下文 |
| Change Impact | 变更影响范围 | 影响范围 | 影响分析（作为按钮主名） | 发布前说明哪些对象、Agent、eval 可能被影响 |
| Quality Operations | 质量运营 | 质量评测运营 | 质量评价 | 评测模块从列表管理升级为持续运营，含趋势、频率、失败归因 |
| Access Control Upgrade | 访问权限升级 | AC Upgrade、权限升级 | Dynamic RLS、行级动态隔离（作为本升级总称） | 访问权限独立升级域总称；波次 AC-P0 / AC-P1；设计见 `docs/access-control/design-upgrade.md` |
| Data Capability | 数据能力元组 | capability、工具×源授权 | 工具并集、表并集、权限笛卡尔积 | `(tool, canonicalSourceKey, rowGrant)`；Admin 权限摘要必须按元组展示 |
| Effective Data Capabilities | 有效数据能力集 | 有效 capability、合成后的数据能力 | `(∪tools)×(∪sources)`、工具并集+表并集 | 多 Role capability 并集；禁止独立维度笛卡尔放大 |
| Row Grant | 行授予 | rowGrant | Agent Constraints、Role 间 AND | 某 capability 上的行集合；AC-P0 恒 TRUE；AC-P1 可为 Row Policy AST |
| Effective Row Grant | 有效行授予 | EffectiveRowGrant | Role 间 AND、FinalRows（混称） | 同源多 Role 行授予 **OR**；见 Spec 99 §4.2 |
| Final Rows | 最终行约束 | FinalRows | 仅用户 filter、仅 Role 并集 | `EffectiveRowGrant AND Constraints AND TokenScope`；AC-P1 本波 Constraints/TokenScope≡TRUE |
| Forced Predicate | 强制谓词 | ForcedPredicateAST | 拼进用户 filters 的 SQL | Proxy 编译自 FinalRows；不可被 OR/括号等放宽 |
| Forced Filters Field | 专用强制字段 | `forced_filters` | 用户可写 filters | AC-P1 上游主路径；仅 Proxy 可写 |
| Upstream Forced Predicate Proven | 上游强制谓词已证明 | proven 标志 | 代码写完即已证明 | Gate C bypass 全绿后才可置真；未证明取数 deny |
| Row Policy Requires Wrapped Tool | 需包装工具 | `row_policy_requires_wrapped_tool` | capability_forbidden（混作主文案） | 受保护源上非 lucy_query 取数通道 |
| Row Policy Upstream Unproven | 上游契约未证明 | `row_policy_upstream_unproven` | 临时放行碰运气 | FinalRows≠TRUE 且 proven≠true 的取数路径 |
| Agent Constraints | Agent 强制约束 | 人级收紧、FinalRows 收紧 | Role 间 AND、Row Grant OR（混称） | 挂在 Agent 上、与 EffectiveRowGrant AND；**AC-P1.5**；AC-P1 配置出现即失败 |
| Permission Model Version | 权限模型版本 | `permission_model_version`、模型版本 | 用户字段 role/roles、修改历史推断世代 | Role 上 `1`=legacy、`2`=显式模型 |
| Row Policy | 行级策略 | row_policy、结构化行谓词 | Segment、查询 filters、overlay 表达式当权限 | 仅 `access.yaml` 内 structured 谓词；op∈{eq,in}；Spec 99 |
| Canonical Source Key | 规范源键 | canonicalSourceKey、源键四元组 | 裸 sourceName、裸 physicalTable 作唯一身份 | `connectionId \| schema \| sourceName \| physicalTable` |
| Tool Class | 工具分级 | AbsoluteDeny / DataPlane / Meta | known_tools、table_touching_tools（现网字段名当分级） | 代码分类表；未分类默认 AbsoluteDeny |
| Effective Policy | 有效策略包 | 已编译策略、runtime 策略 | 热路径临时拼装、仅 YAML 原文 | 编译后不可变对象，含 `policyVersion` |
| Policy Compilation Input | 策略编译输入 | 编译输入 | 仅 access.yaml（漏 source map） | access.yaml digest + source map version（+ 分类表版本）共同决定策略世代 |
| Policy Version | 策略版本 | `policyVersion` | source map TTL、配置 mtime 裸展示当版本 | sha256(编译输入)；写入快照与 access_log |
| Runtime Ack | 运行时确认 | `runtimeAck`、策略已生效确认 | 仅写盘成功、dryRun 通过即成功 | Admin 保存成功须 `runtimeAck: true` |
| Capability Forbidden | 能力未授权 | `capability_forbidden` | 仅用 table_forbidden 作文案主码（AC-P0 DataPlane） | 裁决码 `capability_forbidden:<tool>:<sourceKey>` |
| Policy Scope Expanded | 授权范围扩大 | `policy_scope_expanded`、前缀扩权记录 | 静默扩权、无审计扩权 | legacy v1 `prefix` 因语义层变化扩权时的可观测事件 |
| Policy Degraded | 策略降级 | 权限降级态、DataPlane 整体拒绝 | 服务不可用、完全健康（降级时） | 编译失败导致受影响 Agent 或整体 DataPlane deny |

### 3.0 弃用别名（仅供溯源，不允许出现在新代码 / 新文档）

| 弃用别名 | 最后出现 | 弃用理由 | 替代 |
|---|---|---|---|
| 语义维护工作台 | `webui/src/app/App.tsx:114`（v0.1 及之前） | M36 §4 已将 Lucy WebUI 心智从「资源维护」升级为「运维控制台」 | Data Agent Ops Control Plane |
| 运维控制面 | `webui/docs/39-data-agent-ops-platform-global-ux-spec.md` §1 背景 line 25（v0.1） | M37 顺手统一为「运维控制台」，避免 spec 39 ↔ spec 40 漂移 | Data Agent 运维控制台 |
| KTX WebUI 治理控制台 | `docs/webui-module-guide.md:19`（v1.3 及之前） | 品牌已切到 Lucy | Data Agent Ops Control Plane |
| 本地治理工作台 | `docs/project-overview.md:67` | 同上 | Data Agent Ops Control Plane |

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
| Table Catalog | 语义资产 | 表目录（历史别名，仅兼容旧文档 / 深链语义） | 表格目录、表目录（主导航 / PageHeader 禁用） | 已入库语义层结构化 YAML 对象列表 |
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

### 4.5 访问治理 / 使用概况

`/admin/usage` 页面（侧栏项 `admin-governance`；旧 path `/admin/governance` redirect）术语来自 Spec 78 / 84，并由 Spec 86 修订路由与 KPI 主标签：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Usage Overview Page | 使用概况 | 访问使用概况 | 治理概览（本页主标题）、风控看板 | 主路由 `/admin/usage` |
| Agent Admin Page Title | Agent | — | Agent 实例（弃用主标签） | `/admin/agents` 侧栏与 H1 |
| Agent Display Name | 显示名 | Agent 名称 | 列表主列用 Agent | 人读名称；详情可编辑、新建表单 |
| Agent User ID | 用户 ID | 用户 id | Agent 标识（与显示名混用） | 技术标识；搜索、详情只读 |
| Agent List Identity Column | 显示名/用户 ID | — | 列表主列仅写「显示名」而单元格含用户 ID | `/admin/agents` 列表主列头；双行：主行显示名、次行用户 ID（Spec 98） |
| Agent List Search | 搜索显示名或用户 ID | 搜索 Agent 名称 / 用户 ID | Agent 名称 | 列表搜索 placeholder |
| Configured Agent Count | Agent 总数 | 已配置实例 | access.yaml 中的实例（主 hint） | 不随窗口变；含 `enabled: false` |
| Active Agent | 近 N 活跃 Agent | 活跃 Agent（叙述） | 最近活跃 Agent（主标签）；卡底「近 N 有调用」藏窗口 | N 进**标题** |
| Agent Active Rate | Agent 活跃率 | 活跃 / 总数 | — | 并入活跃 Agent 卡副行，不独立成卡 |
| Configured Token Count | 配置 Token | 已下发凭证 | access.yaml 配置数（主 hint） | 不随窗口变 |
| Active Token | 近 N 活跃 Token | 活跃 Token（叙述） | 近 7 天活跃 Token（写死）；卡底藏窗口 | N 进标题 |
| Token Active Rate | Token 活跃率 | 活跃 / 配置 | access_log 去重 prefix | 并入活跃 Token 卡副行 |
| Authorized Table Count | 授权表 | 角色已授权表 | 配置表（本页主标签）、白名单表、启用表（本页禁止混用） | ACL 授权去重；≠ 启用表范围；不随窗口变 |
| Active Table Count | 近 N 活跃表 | 活跃表（叙述） | 热门表（与排行区分）；卡底藏窗口 | N 进标题；活跃率分母=授权表 |
| Call Volume | 近 N 调用量 | 调用量（叙述） | 最近调用 | 跟随窗口；hint 可留「MCP 调用」 |
| Typical Request Latency | 多数请求耗时 | P95（次级括注） | 响应上限（P95）作主标签；平均响应时长、AVG(duration_ms) | hint：95% 的请求在此时间内完成 |
| Agent Call Ranking | Agent 调用排行 · 近 N | Agent 使用排行 | 近窗口调用；实现向排序说明 | 条形图 Top 10；跟随窗口 |
| Token Call Ranking | Token 调用排行 · 近 N | Token 使用摘要 | 不重复展示顶部 KPI | 按窗口 `calls` 降序 |
| Table Call Ranking | 表调用排行 · 近 N | 最受访问表（Top 10） | 仅统计已结构化…（主副文案） | 条形图 Top 10 |
| Stats Snapshot Time | 统计时间 | — | 上次更新（本页主标签） | 三组 query 成功后的快照新鲜度；相对时间对齐系统概览；位于时间窗口切换左侧 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Agent`、`Token`、`MCP`、`P95`、表名 / physical table、token hash prefix、role id、Agent id。

详见 Spec 78 / 84 / 86 / 87。

### 4.6 系统与运维

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| System Overview | 系统概览 | 系统总览混用 | 全局运行状态页 |
| Runtime Status | 运行状态 | 运行时间状态 | 服务运行健康情况 |
| Public MCP URL | Public MCP URL | 公共 MCP 地址 | 部署暴露给外部的 MCP URL |
| Asset Delivery | 资产交付 | 资产下载区 | 运维级导出、发布、交付入口 |
| Sidebar Group | 系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理 | 5+1 主导航 | 运行状态、数据库接入、语义层维护、业务文档作为主导航分组 | Lucy WebUI 侧边栏固定 IA |

### 4.7 访问日志 / Admin Audit

`/admin/audit` 页面术语来自 Spec 89，并与 Spec 86 的「多数请求耗时」口径交叉验证：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Turn Inquiry Tab | 问询记录 | — | 问题簇、turn（裸露） | 默认 Tab `?tab=turns`；L1 Agent × 问询列表 |
| Call Log Tab | 调用流水 | — | 明细（旧 Tab 名）、access_log | 取证 Tab `?tab=calls`；含 CSV 导出 |
| Turn / Question cluster | 问询 | 问询摘要 | 问题簇 | 列表行对象；Drawer 标题 |
| Reported turn | 已上报问询 | — | reported turn | 来源 badge |
| Inferred turn | 推断问询 | — | 推断问题（无来源标注） | 来源 badge |
| Turn span | 问询时长 | — | turn span | 开始至结束 wall-clock |
| Slow call | 慢于多数请求 | 慢调用 | 慢查询 | 相对 P95 参照 |
| Typical Request Latency | 多数请求耗时 | P95（次级括注） | 响应上限（P95）作主标签 | 与 `/admin/usage` 同算法；**列表页不再展示整句参照文案**（Spec 94） |
| Source type filter | 来源类型 | — | 全部来源、推断（筛选项裸词） | 选项：`全部 / 用户原始问询 / 系统推断问询` |
| Tool call count | 工具调用数 | — | 调用数 | L1 列表列 |
| Tables touched | 涉及数据表 | — | 工具 / 表 | L1 与 Drawer 列；列表仅 physical table |
| Database connection | 数据库连接 | — | connection_id（裸露） | Drawer 调用明细列 |
| Stats Snapshot Time | 统计时间 | — | 上次更新（本页主标签） | 顶栏 24h/7d 左侧 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Agent`、`Token`、`MCP`、`P95`、tool name、physical table、Agent id。

详见 Spec 89；Spec 94 补充来源筛选与列表/Drawer 列名。

### 4.8 访问权限升级（Access Control Upgrade / AC-P0 + AC-P1）

术语事实源：`docs/access-control/design-upgrade.md`；实现 Spec：[`98`](98-access-control-p0-runtime-spec.md)（P0）、[`99`](99-access-control-p1-row-policy-spec.md)（P1）；Gate A ADR：`docs/access-control/adr-upstream-forced-predicate.md`。

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Data Capability Preview | 数据能力 | capability 列表、工具 × 源 | 工具并集、表并集（作为唯一摘要） | Agent / Role 详情权限预览；须展示元组（含 rowGrant） |
| Permission Model Version | 权限模型版本 | v1 legacy / v2 | 角色版本、修改代数 | Role 表单与 dryRun diff |
| Row Access | 行访问 | `row_access: all` / `scoped` | 行级已开启但未注入；Dynamic RLS 已交付 | AC-P0 仅 `all`；AC-P1 允许 `scoped`+`row_policy`（Gate B 后） |
| Row Policy Editor | 行级策略 | predicates / eq / in | Segment 当行权限 | Role Admin；op 仅 eq\|in |
| Final Rows Preview | 最终行约束 | FinalRows 摘要 | 已取数成功（explain 场景） | dryRun / explain 诊断 |
| Forced Filters Field | 专用强制字段 | `forced_filters` | 用户 filters 即行权限 | 仅 Proxy 注入 |
| Row Policy Requires Wrapped Tool | 需包装工具 | 请使用 lucy_query | 表未授权（混用） | Toast / 审计主文案 |
| Row Policy Upstream Unproven | 上游契约未证明 | 行策略未启用取数 | 临时可用 | proven 前取数 deny |
| Canonical Source Key | 规范源键 | 源键 | 表名（作为唯一 ID） | 预览 / snapshot 展示四元组 |
| Policy Version | 策略版本 | `policyVersion` | 配置时间戳（冒充策略世代） | 保存成功回执与审计列 |
| Runtime Ack | 运行时确认 | 已生效 | 已保存（无 ack 时显示成功） | 收窄保存成功条件 |
| Capability Forbidden | 能力未授权 | 无该工具×源能力 | 表未授权（AC-P0 DataPlane 主文案，避免与旧 table_forbidden 混用） | 审计筛选与 Toast |
| Policy Scope Expanded | 授权范围扩大 | 前缀匹配扩权 | 自动加表（无事件） | Admin 可观测记录 |
| Policy Degraded | 策略降级 | 数据面拒绝 | 系统正常（降级时） | Admin 常驻 banner |
| Tool Class Absolute Deny | 绝对拒绝工具 | 代码基线拒绝 | 可配置放开的禁用 | `sl_*` 等；YAML 无法解除 |
| Tool Class Data Plane | 数据面工具 | DataPlane | 元数据工具 | 须绑 capability |
| Tool Class Meta | 元信息工具 | Meta | 数据查询工具 | catalog / wiki 等 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Role`、`Agent`、`Token`、`MCP`、`YAML`、`policyVersion`、`permission_model_version`、`capability`、`runtimeAck`、`row_policy`、`row_access`、`forced_filters`、`FinalRows`、tool name、`sourceName`、`connectionId`、physical table、规范源键四元组、裁决码全文。

与既有 Role Admin 术语（§3 `Role Permission` / `Role Table Selector` / `Table Name Prefix` 等）并存：升级后「权限摘要」主展示改为 Data Capability Preview，不得回退为仅工具并集+表并集。

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

- 把品牌区副标题从「语义维护工作台」替换为 `Data Agent Ops Control Plane` + `Data Agent 运维控制台`（M37 已完成；后续 brand term 调整才需再回到本节）。
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
