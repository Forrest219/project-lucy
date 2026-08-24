# Lucy Product Terminology Standard

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy Product Terminology Standard |
| 文档类型 | System-wide Product Language / Terminology Standard |
| 版本 | v0.2 |
| 撰写日期 | 2026-07-31；2026-08-01 v0.2（新增 Data Agent Ops Control Plane / Data Agent 运维控制台，标记『语义维护工作台』与『运维控制面』为弃用别名）；2026-08-05 增补 §4.8 MCP 调试台术语（Spec 99）；同日 Spec 100 交叉审阅补齐 incomplete / impact / evidence / 裁决双行；2026-08-06 Spec 109 增补目录重命名术语；2026-08-06 Spec 114/115 增补表 YAML 导入与工作台校验披露术语；2026-08-06 Spec 117 增补 Remove Schema 术语；2026-08-20 增补 §4.7.1 Trace Read Model 术语（Spec 62 v0.5） |
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
| Create Connection | 新建连接 | — | 新建链接、添加联接、创建数据源（作主按钮） | 在 WebUI 创建 `ktx.yaml` 连接配置（Spec 124）；持久密码仅为 `file:` 引用 |
| Connection ID | 连接 ID | — | 连接名（作主标签）、Connection Name（作主标签） | `connections.<id>` 键 |
| Connection Password | 数据库密码 | — | 密钥、Token（作连接表单主标签） | 仅新建表单一次性输入；写入后不可回显（Spec 124） |
| Password File Reference | 密码文件引用 | — | 明文密码（配置态主标签） | `ktx.yaml` 中 `password: file:…` |
| Connection Create Preview | 新建预览 | — | — | dryRun：脱敏 diff + 将写入的 secret 相对路径（Spec 124） |
| Connection Test | 连通测试 | 按钮可用“测试连接” | 替代测试 | 验证凭据、网络、驱动配置是否可用 |
| Connection Health Summary | 连通健康 | 健康摘要 | 数据库健康度（作主标签）、DB Health | `/connections` 卡右侧摘要（Spec 108） |
| Connectivity Probe | 连通探测 | 进页探测 | 心跳、Ping（作主标签） | 打开连接概览时自动 `connection test` |
| Response Latency | 响应延时 | ms 延迟（tooltip） | RTT（作主标签） | 连通测试耗时；卡摘要与诊断面板同词 |
| Connectivity OK | 通 | 正常（诊断面板 banner） | — | `status=ok` 且 &lt;200ms；卡摘要优先「通」 |
| Connectivity Slow | 偏慢 | — | 慢 | 200–1000ms |
| Connectivity Attention | 需关注 | — | 很慢 | &gt;1000ms |
| Connectivity Down | 不通 | 失败（次级） | — | `status=error` 或探测请求失败 |
| Probing | 探测中… | — | 测试中…（卡摘要禁用） | 卡摘要异步态；Drawer 内可保留「测试中...」 |
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
| Semantic Coverage | 语义覆盖 | 完成度（作 overview 主标签） | 分母 = 已启用 ∩ Manifest（`SourceSummary.enabled`）；不含未启用 Manifest 表（Spec 104） |
| Enabled Scope Filter | 启用范围 | 白名单筛选 | Catalog 工具栏：已启用 / 全部 / 未启用 |
| Metric | 指标 | Metric | 度量混用 | 可聚合的业务数值定义 |
| Dimension | 维度 | Dimension | 维数 | 分析分组或切片字段 |
| Measure | 度量 | Measure | 指标混用 | 语义模型内的聚合表达式；当面向业务用户时优先叫“指标” |
| Segment | 分群 | Segment | 片段 | 可复用过滤条件 |
| Join | 关联 | Join | 加入、连接表 | 表之间的 join 关系 |
| Semantic Validate | 校验 | 结构校验 | 裸 Validate 作主标签/主徽章（如「Validate 未通过」） | 表工作台 Header「校验」与变更审阅状态；针对已保存语义层（Spec 110）；发布工作台校验摘要同用（Spec 115） |
| Validation Issue | 校验问题 | 问题详情 | 仅 Exit Code / 仅 FAIL 作为失败主信息 | `ValidationResult.issues[].message` 可读列表（Spec 110 / 115） |
| Validation Technical Detail | 技术详情 | 原始输出 | 默认主屏展示 Exit Code | 折叠：退出码、stderr、stdout（Spec 110 / 115） |
| Table YAML Import | 导入 YAML | 导入表 YAML | 裸「上传 YAML」作表页抽屉主标题 | 表语义工作台单表导入（Spec 114） |
| Schema Manifest Table Snippet | Schema Manifest 表片段 | 含字段的表 YAML | 把 overlay 叫 Manifest | 含 `columns`/`descriptions`/`joins` 的导入内容 |
| Semantic Overlay (table editor) | 表级 semantic overlay | overlay（指标/分群/行粒度） | 暗示导入会改字段列表 | 仅 grain/measures/segments（Spec 114） |
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
| Config Audit Actor | 操作者 | 本机管理员（开放模式）或已登录管理员 id | Actor、local-admin（作为唯一可见列头） | Spec 96：表头用「操作者」；开放模式展示「本机管理员」；多管理员模式下展示管理员 id |
| WebUI Admin | 登录账户 | WebUI 控制面账户 | 超管（除非专指所有者）、用户（易与 Agent 混淆） | WO-62：本地登录主体，非 MCP Agent |
| WebUI Admin Owner | 所有者 | 所有者 | 超管（主术语）、管理者（可用作叙述同义） | 可管理其他登录账户 |
| WebUI Admin Operator | 运维 | 运维人员 | 管理员（易与所有者混淆）、普通用户 | 日常连接 / 语义 / Eval / Agent Role；不可管登录账户 |
| WebUI Login | 登录 | 控制面登录 | Sign in 裸用 | `/login` |
| Token Expiry | 过期时间 | Token 失效时间 | 失效日期（可作为说明同义） | `expires_at`；到期后 Proxy 拒绝 |
| Config Audit Change Type | 变更类型 | 配置变更类型 | 类型（过宽）、changeType（裸露） | Spec 96 表头与筛选 |
| Config Audit Asset Kind | 资产域 | 配置资产域 | assetKind、资产类型（与 Semantic Asset Kind 混淆） | Spec 90/96：governance/semantic/wiki/eval/publish |
| Config Audit CSV Export | 导出 CSV（与主表一致） | 配置审计导出 | 英文原始列 dump、仅到日的文件名 | Spec 97：列头/单元格与主表 7 列中文一致；文件名 `config-audit-YYYYMMDD-HHmmss.csv` |
| Publish History CSV Export | 导出 CSV（与主表一致） | 发布记录导出 | 导出当前语义资产包 (.zip)（作发布记录主导出） | Spec 113：明细 CSV；文件名 `publish-history-YYYYMMDD-HHmmss.csv`；工作台 ZIP UI 已移除（Spec 123） |
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
| Quality Operations | 质量运营 | 质量评测运营 | 质量评价 | 评测模块从列表管理升级为持续运营，含趋势、阈值、失败归因 |

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
| Create Connection | 新建连接 | 新建链接、添加联接、创建数据源（作主按钮） | `/connections` 创建连接配置；非「添加 Schema」（Spec 124） |
| Connection ID | 连接 ID | 连接名（作主标签） | `connections.<id>` 键；受标识符规则约束 |
| Connection Password | 数据库密码 | 密钥、Token（作主标签） | 新建表单一次性输入；写入 `.ktx/secrets/<id>-password` 后不可回显 |
| Password File Reference | 密码文件引用 | 明文密码（配置态） | `password: file:…`；API 只暴露 `passwordSource` |
| Connection Create Preview | 新建预览 | — | dryRun 脱敏 diff 与 secret 路径预告 |
| Table Whitelist | 启用表范围 | 白表、表白、表白名单（主导航禁用） | `enabled_tables` 的 UI 管理入口 |
| Add Schema | 添加 Schema | 添加架构、添加模式 | 向连接配置追加 Schema |
| Target Schema | 目标 Schema | 目标架构、目标模式 | 上传或添加流程中的目标 Schema |
| Manifest Status | Manifest 状态 | 清单状态、舱单状态 | Schema manifest 是否存在 |
| Missing Manifest | 缺失 Manifest | 财政部舱单、缺失清单 | 本地 manifest 文件不存在 |
| Upload Schema Manifest | 上传 Schema Manifest | 上传 Manifest | 上传该 Schema 的 YAML、裸用“上传 YAML” | 写入 `semantic-layer/<connection>/_schema/<schema>.yaml`；主入口位于 `/connections` |
| Schema Manifest Repair Link | 去连接概览上传 Manifest | 打开连接概览 | 当前页独立上传 YAML | 启用表范围缺失 Manifest 诊断只跳转，不在当前页上传 |
| Refresh Local Catalog | 刷新本地目录 | 重新加载资产 | 重新读取本地 YAML 资产 |
| Live Table Count | 库内表数 | 物理表数（主导航）、远端表数、DB 表数 | 物理库账号可见 BASE TABLE 数量；与 Manifest / 启用计数严格区分 |
| Discovered Table Count | 已发现表数 | 本地表数（作主标签时易混）、物理表数、远端表数 | Schema Manifest 已读入本地 Catalog 的表数；KPI 卡亦称「服务器目录已发现表」；非 DB 实时扫描 |
| Enabled Table Count | 已启用表数 | 白名单表数、启用表数（旧列头，仅兼容旧文档） | `ktx.yaml` `enabled_tables`；对齐 `/connections` 列头「已启用表数」 |
| Unenabled Table Count | 未启用表 | 未白名单表（主导航禁用） | 已发现但未进入 `enabled_tables`；缺 Manifest 的未知表不计入 |
| Invalid Enabled Table | 无效启用 | 孤儿表、孤儿启用（用户可见主文案禁用） | `enabled_tables` 有、本地 Schema Manifest 无的 `schema.table`（Spec 116） |
| Remove Invalid Enabled | 移出无效启用 | 清理孤儿、删除脏启用 | 启用表范围页从草稿移除全部无效启用（Spec 116） |
| Live Catalog | 库内目录 | 物理扫描（作主标签） | Owner 按需只读目录查询结果 |
| Refresh Live Catalog | 重新拉取库内目录 | 刷新本地目录（易混） | 仅 bypass TTL 重查物理库 |
| Select Schema | 选择 Schema | 选择架构、选择模式 | Add Schema 下拉候选 |
| Enter Schema Manually | 手动输入 Schema 名称 | 手动输入架构 | 候选不可用或自定义时 |
| Remove Schema | 移除 Schema | 删除数据库、删库、删除架构、删除模式 | 从连接配置卸载 Schema；不触碰物理库（Spec 117） |
| Schema Remove Impact | 移除影响 | — | dryRun 摘要：已启用表、Manifest、overlay、Wiki 引用（Spec 117） |
| Delete Schema Manifest (optional) | 同时删除 Schema Manifest | 默认级联删除 | 可选勾选；默认关；仅 dryRun:false 时生效（Spec 117） |
| Delete Semantic Overlays (optional) | 同时删除 semantic overlay | 默认级联删除 | 可选勾选；默认关；仅 dryRun:false 时生效（Spec 117） |

### 4.2 语义建模

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Table Catalog | 语义资产 | 表目录（历史别名，仅兼容旧文档 / 深链语义） | 表格目录、表目录（主导航 / PageHeader 禁用） | 已入库语义层结构化 YAML 对象列表 |
| Business Wiki | 业务 Wiki | Wiki 文档（仅兼容期） | 业务解释和口径文档 |
| Rename Wiki Directory | 重命名目录 | 重命名 folder、改名 folder | 同父级下修改 Wiki 目录路径最后一段（Spec 109） |
| Directory Rename Preflight | 重命名预检 | 覆盖预检混用 | 重命名前展示源/目标路径与影响摘要 |
| Source Wiki Directory | 当前目录路径 | 源目录（仅预检补充） | 改名前 `wiki/<path>/` |
| Target Wiki Directory | 目标目录路径 | 新目录（仅预检补充） | 改名后 `wiki/<path>/` |
| Delete Markdown Document | 删除文档 | 删除 MD、删文件、删除 page | 删除当前已保存 Wiki Markdown（Spec 118） |
| Document Delete Confirmation | 删除确认 | 删除预检（与上传预检混用） | 删除文档确认对话框；展示目标 `wiki/<key>` |
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

运维口径（Spec 104）：`/overview`「语义覆盖 / 待补语义」与 `/catalog` 默认列表只统计 **已启用 ∩ Manifest**；Manifest 中未启用的表可经 Catalog「启用范围 = 全部」查看，但不进入待办分母。

| 能力 | 数据接入 | 语义建模 | 语义资产交付 |
|---|---|---|---|
| 查看 Connection | Owner | Consumer | Consumer |
| 新建连接（含一次性密码落盘） | Owner | 不负责 | 不负责 |
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

### 4.3 审阅与审核 / 语义发布

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Change Review | 变更审阅 | 变更审核混用 | 人工检查语义资产变更 |
| Approval Flow | 审批流程 | 审阅流程混用 | 需要批准 / 驳回的流程 |
| Reviewer | 审阅人 | 审核员混用 | 执行 review 的角色 |
| Approver | 审批人 | 审阅人混用 | 执行 approval 的角色 |
| Activation Prep Panel | 生效准备 | 发布门禁（作本页栏标题） | `/publish/workbench` 右栏（Spec 123；取代 Spec 112「发布门禁」栏名） |
| Sync Change List | 本次将同步的变更 | 待发布变更（作唯一栏标题） | 左栏；副文「本批一并同步 N 项（不可分文件勾选）」（Spec 123） |
| Change Detail | 变更详情 | 裸文件路径作栏主标题；默认常驻最大栏 Diff | 按需 Drawer；路径为副信息（Spec 119） |
| File Change Status | 已修改 / 新增 / 已删除 / 已重命名 / 已变更 | 状态：W、M、A（裸内部码） | 待同步文件业务态 |
| Schema Manifest Impact | Schema Manifest 变更 | 把 `_schema` basename 当作「表」 | 生效准备影响区分栏 |
| Table Overlay Impact | 表语义变更 | — | overlay 影响表列表 |
| Publish Flow Steps | 审阅变更 → 校验 → 同步索引 | 发布并重建索引（作本页步骤末项） | 生效步骤指示（Spec 123） |
| Sync Index and Activate | 同步索引并生效 | 发布并重建索引（作本页 Header/确认主 CTA） | 有待同步变更时主按钮（Spec 123） |
| Sync Index | 同步索引 | — | 无待同步变更时增量 reindex |
| Full Reindex | 全量重建索引 | 强制重建索引（作本页文案） | 「更多」菜单；`force:true`（Spec 123） |
| Confirm Sync Drawer | 确认同步索引并生效 | 确认发布并重建索引；发布语义资产（作本确认侧栏标题） | 确认路径（Spec 121+123）；非上传 |
| Upload Semantic Assets | 上传语义资产 | — | Catalog / 连接等入口；**禁止**作为 `/publish/workbench` 本页入口（Spec 123） |
| Publish Semantic Assets Drawer | 发布语义资产 | — | 仅上传路径 Drawer 标题；不在工作台本页 |

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
| Device Name Remark | 设备名备注 | 备注 | Device（裸露作主标签）、绑定设备（暗示硬件强绑定） | 签发时可选；不写 access_log；见 Spec 124 |
| Last Seen Device Name | 最近设备名 | 运行时设备名 | 与备注混用为单一「设备名」 | 仅 `x-lucy-device-name`；见 Spec 124 |
| Agent Client Type | Agent 类型 | 客户端 | Device 类型 | `clientInfo.name` + version |
| Client IP | 访问 IP | 最近访问 IP | remoteAddress、XFF（裸露作主标签） | `access_log.client_ip`；Token 列表派生 `last_ip` |
| User-Agent | User-Agent | UA | 浏览器指纹 | HTTP 头截断存储；DOM 值 `notranslate` |
| Client Version | 客户端版本 | — | clientInfo.version（裸露） | MCP `initialize.clientInfo.version` |
| Token Device Inventory | Token 设备清单 | 设备视角 Token 列表 | 已登录设备、Sessions | Agent 详情 Token Tab |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Agent`、`Token`、`MCP`、`P95`、表名 / physical table、token hash prefix、role id、Agent id、设备名值、访问 IP、`User-Agent`。

详见 Spec 78 / 84 / 86 / 87；设备与网络上下文见 Spec 124。

### 4.6 系统与运维

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| System Overview | 系统概览 | 系统总览混用 | 全局运行状态页 |
| Runtime Status | 运行状态 | 运行时间状态 | 服务运行健康情况 |
| Public MCP URL | Public MCP URL | 公共 MCP 地址 | 部署暴露给外部的 MCP URL |
| Asset Delivery | 资产交付 | 资产下载区 | 运维级导出、发布、交付入口 |
| Sidebar Group | 系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理 | 5+1 主导航混用其它分组名 | Lucy WebUI 侧边栏固定 IA |
| Semantic Completion Incomplete | 未完成 | partial / not_started（作用户主文案）、status=partial | Catalog / overview 深链 value=`incomplete`（`!== done`）；见 Spec 100 |
| Action Impact | 影响 | impact（裸露） | 待办行必填次级文案；Spec 100 |
| Action Evidence | 证据来源 | evidence（裸露） | 待办行必填；Spec 100 |

### 4.7 访问日志 / Admin Audit

`/admin/audit` 页面术语来自 Spec 89，并与 Spec 86 的「多数请求耗时」口径交叉验证：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Turn Inquiry Tab | 问询记录 | — | 问题簇、turn（裸露） | 默认视图 `?view=turns`（可省略）；兼容旧 `?tab=turns` |
| Call Log Tab | 调用流水 | — | 明细（旧 Tab 名）、access_log | 取证视图 `?view=calls`；含 CSV 导出；兼容旧 `?tab=calls` |
| Turn / Question cluster | 问询 | 问询摘要 | 问题簇 | 列表行对象；Drawer 标题 |
| Turn ID | 问询 ID | — | turn id（裸露作主标签）、问题簇 ID | L1 身份列；可复制；关联调用流水 |
| Audit Event ID | 事件 ID | — | access_log id（裸露作主标签） | 调用流水 L1 身份列；`access_log.id` |
| Range preset | 近 24 小时 / 近 7 天 | — | 地址栏 `hours=168`（新写入） | URL `range=24h\|7d`；兼容读 `hours=24\|168` |
| Reported turn | 已上报问询 | — | reported turn | 来源 badge |
| Inferred turn | 推断问询 | — | 推断问题（无来源标注） | 来源 badge |
| Turn span | 问询时长 | — | turn span | 开始至结束 wall-clock |
| Slow call | 慢于多数请求 | 慢调用 | 慢查询 | 相对 P95 参照 |
| Typical Request Latency | 多数请求耗时 | P95（次级括注） | 响应上限（P95）作主标签 | 与 `/admin/usage` 同算法；**列表页不再展示整句参照文案**（Spec 94） |
| Source type filter | 来源类型 | — | 全部来源、推断（筛选项裸词） | 选项：`全部 / 用户原始问询 / 系统推断问询`；**仅问询记录 Tab** |
| Call origin filter | 调用来源 | — | 全部来源（作选项文案）、来源类型（挪用到调用流水） | 调用流水筛选项：`全部 / MCP 调试台受控试调 / Agent 接入调用`；`callSource=playground\|agent`；`playground` 对应 `lucy_platform=mcp-playground` 并自动包含协议调用 |
| Tool call count | 工具调用数 | — | 调用数 | L1 列表列 |
| Tables touched | 涉及数据表 | — | 工具 / 表 | L1 与 Drawer 列；列表仅 physical table |
| Database connection | 数据库连接 | — | connection_id（裸露） | Drawer 调用明细列 |
| Stats Snapshot Time | 统计时间 | — | 上次更新（本页主标签） | 顶栏 24h/7d 左侧 |
| Decision Reason dual-line | 裁决原因（主行中文 + 次行码） | — | 仅机器码单行（最终态） | Spec 99 §6.4；调用流水/Drawer |
| Client IP | 访问 IP | 最近访问 IP | remoteAddress（裸露） | 调用流水 / Drawer；Spec 124 |
| Last Seen Device Name | 最近设备名 | 运行时设备名 | Device（裸露作主标签）；与「设备名备注」混用 | 可选头观测值；Spec 124 |
| Device Name Remark | 设备名备注 | 备注 | 绑定设备 | 仅签发 YAML；不进 access_log |
| User-Agent | User-Agent | UA | — | 调用流水高级区；值 `notranslate` |
| Client Version | 客户端版本 | — | — | 与 `client`（产品名）成对 |
| Agent Client Type | Agent 类型 | 客户端 | — | Token 清单运行时列 |

#### 4.7.1 Trace Read Model（Spec 62）

`/admin/audit` 内只读 Trace 核查链路（非 Visual Debugger）。术语来自 Spec 62 v0.5：

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Trace Detail | Trace 详情 | 核查链路 | 调试器、Visual Debugger、审计 2.0 | 从访问日志行打开的只读 Drawer / 面板 |
| Trace Event | Trace Event | — | 审计行（与事件 ID 混淆）、log event（裸露作主标签） | append-only span 行 |
| Evidence Event | Evidence Event | — | Action Evidence、发布证据 | 挂在 Trace 上的证据行 |
| Evidence Ref | Evidence Ref | — | 证据来源（Action Evidence 挪用）、附件 | kind + ref + hash 引用 |
| Ordered Spans | 有序 Span | — | Timeline（无说明）、调用树（过宽） | 按时间 / 父子排序的 span 列表 |
| Policy Decision | 策略裁决 | — | 裁决原因（单独指 Decision Reason 展示）、ACL dump | `policy_decision` span；展示时可同时含裁决原因双行 |
| Trace ID | Trace ID | — | trace id（裸露作唯一主标签且无保护） | 与 `access_log.trace_id` 对齐；可复制 |

**消歧（禁止混用）：**

| 概念 | UI / 文档应使用 | 不得称为 |
|---|---|---|
| Kernel Evidence（Spec 62） | Evidence Event / Evidence Ref | Action Evidence、发布证据包 |
| Action Evidence（Spec 100） | 证据来源 | Trace Evidence、Evidence Ref |
| Release Readiness Evidence Package（P2） | 发布就绪证据包（若产品化） | Trace 详情 |
| Access Governance Gate（P1） | 访问治理门禁 | 发布门禁、Eval 质量门禁 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Trace`、`Evidence`、`Span`、`Agent`、`Token`、`MCP`、`P95`、tool name、physical table、Agent id、问询 ID / 事件 ID / Trace ID 值、裁决原因码、`trace_id`。

详见 Spec 89；Spec 94 补充来源筛选与列表/Drawer 列名；Spec 99 要求双行 DecisionReasonView；**Spec 106** 要求身份列、共享筛选与 `view`/`range` URL；**Spec 62** 要求 Trace Read Model 术语与热库证据消歧。

### 4.8 MCP 调试台 / ACL 裁决可见性

| Canonical Term | Preferred EN | UI 主术语 | 禁止 / 弃用 | 说明 |
|---|---|---|---|---|
| MCP Playground | MCP Playground | MCP 调试台 | API 操场、Playground（单独作 H1）、协议沙箱 | `/admin/mcp-playground`；侧栏与 PageHeader |
| ACL Decision Preview | ACL Decision Preview | ACL 裁决预览 | 权限模拟、DryRun（单独作主标签） | 默认主模式；不转发上游 |
| Live Smoke Call | Live Smoke Call | 受控试调 | 真实调用（无「受控」）、生产探测 | 白名单工具 + 确认；Token 不落盘；落库 `lucy_platform=mcp-playground` |
| Call origin · playground | Call origin (playground) | MCP 调试台受控试调 | Playground 调用（裸词）、调试流量 | 访问日志 `callSource=playground` 筛选项与行内 badge「受控试调」 |
| Call origin · agent | Call origin (agent) | Agent 接入调用 | 用户真实调用（作唯一主标签时易误解 dry-run） | 访问日志 `callSource=agent`：排除 `lucy_platform=mcp-playground` |
| Decision Reason | Decision Reason | 裁决原因 | 拒绝码、reason（裸露作主标签） | 与访问日志列对齐；主行中文 |
| Decision Reason Code | Decision Reason Code | 裁决原因码 | — | 机器码（如 `tool_forbidden`）；次行 `notranslate` |
| Effective Permissions Snapshot | Effective Permissions Snapshot | 生效权限快照 | 权限 dump | DryRun 结果只读摘要 |

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`MCP`、`Agent`、`Role`、`Token`、`ACL`、tool name、`decision_reason` 码、connection / schema / table、JSON-RPC method。

详见 Spec 99。Catalog 语义筛选「未完成」(`incomplete`) 与 overview 深链见 Spec 100，不在本表重复造译名。

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
