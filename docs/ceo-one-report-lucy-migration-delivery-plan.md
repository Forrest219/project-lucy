# CEO 一眼报迁移到 Lucy/KTX 的端到端实施交付计划

| 元数据 | 内容 |
|---|---|
| 文档名称 | CEO 一眼报迁移到 Lucy/KTX 的端到端实施交付计划 |
| 文档类型 | Delivery Plan / Implementation Consulting |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-06 |
| 适用范围 | 将现有 finreport / FineReport / FineBI / FineVis / CEO 一眼报资产迁移为以 KTX 为核心的 Lucy 受控数据服务 |
| 首发主题 | CEO 一眼报 |
| 目标完成点 | Agent 通过 Lucy MCP 受控调用数据，完成业务口径、权限、安全、审计和准确率验收 |

## 1. 交付目标

本计划面向实施交付，而不是单纯技术研发。目标是把现有报表系统沉淀的指标、SQL、前端计算、参数、截图和历史导出值，迁移为 Lucy/KTX 可消费、可审计、可回归的数据服务资产。

端到端目标：

```text
现有 BI / CEO 一眼报资产
  -> 资产盘点与口径反向工程
  -> 指标契约与来源映射
  -> 数据平台授权视图 / 汇总表
  -> KTX scan / ingest / semantic overlay
  -> Wiki / Skill / ACL / audit / eval
  -> Agent 通过 Lucy MCP 调数
  -> 标准报表基准对账
  -> 准确率与安全验收
  -> 业务 owner 签字交付
```

本计划承接 CIO 版汇报方案中的原则：

- Agent 严禁直连原始库，只能通过 MCP 受控网关访问白名单语义资产。
- 现有 BI 资产不是废弃物，而是口径来源、对账基准和验收依据。
- CEO 一眼报作为首发样板主题，沉淀后续主题可复制的资产包、语义包、MCP 配置包和评测包。
- 成功标准必须量化：口径一致率、可答率、熔断准确率、审计可追溯率和业务问答准确率。

## 2. 当前依据

### 2.1 已有 Lucy/KTX 资产

当前仓库已具备可复用底座：

| 资产 | 位置 | 用途 |
|---|---|---|
| R1 受控数据服务层计划 | `docs/lucy-r1-controlled-data-service-plan.md` | 平台底座、MCP 契约、Policy、Guardrail、Eval 与可观测性总计划 |
| Data Agent POC 语义层 | `semantic-layer/poc-mysql-aliyun/*` | 已建 CEO/活跃/广告 POC 表的 KTX overlay |
| POC Wiki | `wiki/global/poc-*.md` | DAU、广告收入、IDM 治理层、CEO 快照的口径说明 |
| POC Eval | `evals/data_agent_poc/eval/data_agent_poc-eval-cases.yaml` | 已覆盖 UTC 日期误读、CEO 快照对账等关键反模式 |
| 数据问答 UAT 模板 | `docs/uat-mysql-aliyun-data-qa.md` | 可复用 95% 准确率、审计、安全红线的 UAT 结构 |

### 2.2 已有业务解析依据

| 业务材料 | 位置 | 已识别价值 |
|---|---|---|
| CIO 版汇报方案 | `CauchyWorks/03-AI方案专家/05-最终交付/03-构建 AI 友好的受控数据服务层/构建 AI 友好的受控数据服务层-CIO版-20260702.html` | 定义 AI 友好受控数据服务层、4 Gates、三个月排期和六大交付包 |
| Data Agent MCP POC 方案 | `CauchyWorks/01-WIP/晨阳/03-POC方案/01-Data-Agent-MCP-POC方案-2026-06-29.md` | 三位 owner 代表场景、模拟数据模型、来源映射、ACL、eval 与真实替换路径 |
| CEO 一眼报指标清单 | `inbox/ceo_report_v13_conversion/output/ceo-report-v13.indicators.csv` | 18 页面指标清单、来源系统、频率、统计维度和表名线索 |
| 指标交叉对照 | `CauchyWorks/01-WIP/晨阳/02-交叉对照/01-指标交叉对照-2026-06-29.md` | DAU、广告 DAU、ARPU 双公式、IDM 治理层等口径冲突和证据等级 |

## 3. 范围边界

### 3.1 首发主题范围

首发主题为 CEO 一眼报，按价值和风险拆成三层：

| 层级 | 范围 | 目标 |
|---|---|---|
| MVP 样板 | DAU、营业收入-广告、IDM 分品类广告、CEO 快照对账、ACL deny | 在 2026-07-31 前跑通端到端调用和基础验收 |
| 完整首发 | CEO 一眼报 18 页面指标清单中已确认 owner、来源和基准的核心指标 | 在 2026-08-15 前完成首发主题交付 |
| 后续扩展 | 主题二、主题三；具体业务边界由 owner 决定 | 到 2026-09-30 形成三大主题的常态化治理闭环 |

### 3.2 R1 不直接承诺的事项

下列事项可以作为数据平台或后续版本工作，但不能混入首发验收口径：

- 不由 Lucy 仲裁业务口径，Lucy 只承接 owner 已签字的口径。
- 不让 Agent 临时跨生产库拼 SQL，跨源逻辑应沉淀为授权视图、汇总表或明确的单源分步分析。
- 不用 raw table 替代业务视图做最终交付。
- 不承诺列级、行级权限由 Lucy R1 原生完成；字段裁剪和脱敏优先由数据平台授权视图实现。
- 不把 POC 模拟数据准确率等同于真实生产数据准确率。

## 4. 总体实施方法

实施采用“四个 Gate + 常态化治理边车”。

| Gate | 目标 | 关键产出 | 通过标准 |
|---|---|---|---|
| Gate 1 资产与口径盘点 | 从 finreport/BI/CEO 报表中还原指标与业务语义 | 报表资产清单、指标清单、来源映射、证据等级、待确认项、容差规则 | 核心指标 owner 已确认；中低证据项有明确处理策略 |
| Gate 2 数据模型与语义层 | 将报表私有逻辑迁移为 AI-Ready 数据资产 | 授权视图设计、字段映射、KTX manifest、semantic overlay、Wiki、Skill 路由 | KTX 可检索、可读、可执行；核心指标使用标准 measure |
| Gate 3 MCP 服务与安全 | 通过 Lucy MCP 发布受控数据服务 | connection、role、token、ACL、guardrail、audit、Agent 接入说明 | Agent 只能看到授权资产；越权和 DDL/DML 100% 拒绝 |
| Gate 4 对账与回归验收 | 证明 Agent 调数准确且可追溯 | benchmark、eval YAML、对账报告、Hermes/Codex/Claude 运行证据、签字记录 | 业务准确率达到门槛，核心指标 100%，安全用例 100% |

常态化治理边车贯穿所有 Gate，负责变更对账、回归评测、审计留痕和失败病例回流。

## 5. Gate 1：资产与口径盘点

### 5.1 输入

- CEO 一眼报 V1.3 原始 docx、解析后的指标 CSV、结构化 JSON。
- FineBI 活跃分析、FineVis 营业收入-广告等 owner 资产。
- CEO 前端截图、历史导出、日报/月报静态值。
- 已有 SQL、FineReport 数据集、FineDataLink 数仓配置、调度和表血缘说明。

### 5.2 工作步骤

1. 建立报表资产目录：页面、组件、数据集、SQL、参数、过滤器、前端计算字段、访问频次、owner。
2. 抽取指标清单：指标名、别名、频率、维度、来源系统、来源表、公式、展示单位、容差。
3. 反向工程计算逻辑：区分 SQL 聚合、前端计算、参数过滤、手工填报和跨页一致性约束。
4. 建立证据等级：
   - A：表、字段、公式、SQL、前端基准均已确认。
   - B：指标与来源明确，字段或公式需 owner 二次确认。
   - C：只有页面/widget 线索，不能进入准确率硬验收。
5. 建立口径冲突清单：同名异义、同义异名、跨页面口径差、时间口径、刷新/不刷新、重复存储字段。
6. 确认业务容差：金额、比率、排名、留存、DAU、ARPU、eCPM 等分别定义容差。

### 5.3 CEO 一眼报首批盘点重点

| 域 | 指标 / 问题 | 处理原则 |
|---|---|---|
| DAU | DAU、Android/iOS/Harmony DAU、MAU、人均打开次数、活跃留存 | 优先沉淀第 14 页；明确是否含后台刷新 |
| 广告经营 | 广告收入、广告 DAU、广告 ARPU、曝光、eCPM、人均打开次数 | 明确广告 DAU 与产品 DAU 不同源；ARPU 双公式必须 owner 确认 |
| IDM 治理层 | 品牌/电商/效果/外包广告收入、IDM 广告 DAU、治理层 eCPM | 用于证明治理层汇总与源表明细一致 |
| CEO 快照 | 指标值、日期、维度、页面、容差 | 作为 eval ground truth，不允许手工猜数 |
| 财务页 | 净现金流、营业收入、净利润、M-ROE | 先做边界确认和安全策略；真实接入由生产库/授权视图承接 |

### 5.4 Gate 1 交付件

- `CEO 一眼报资产目录.xlsx` 或等价 Markdown/CSV。
- `指标口径与来源映射表`。
- `口径冲突与待确认清单`。
- `核心指标容差标准`。
- `Owner 签字确认记录`。

## 6. Gate 2：数据模型与 KTX 语义层

### 6.1 数据模型原则

1. Agent 不直接消费报表私有 SQL 或物理明细表。
2. 数据平台提供 AI-Ready 授权视图或汇总表，命名、粒度、过滤条件和数据新鲜度稳定。
3. 比率指标必须以 measure 形式定义，优先用 sum/sum 重算，禁止 AVG(ratio)。
4. 重复存储的日级分母字段必须声明聚合方式，例如 `max(ad_dau)`，禁止 `sum(ad_dau)`。
5. 中低证据指标可以进入探索目录，但不得进入核心准确率硬验收。

### 6.2 从 POC 表到真实视图的替换策略

| POC 表 | 真实落地目标 | 替换前置条件 |
|---|---|---|
| `poc_app_active_daily` | 产品活跃日级授权视图 | DAU 含/不含刷新字段、包名映射、国内/国际过滤确认 |
| `poc_ad_revenue_daily` | 广告经营日级授权视图 | 广告位、国家、收入、曝光、广告 DAU 来源确认 |
| `poc_ad_revenue_by_type_daily` | IDM 分品类广告治理视图 | 品类枚举、平台合并规则、DAU/打开次数重复存储规则确认 |
| `poc_ceo_metric_snapshot` | CEO 前端基准快照表 | 快照来源、采集频率、容差、业务签字流程确认 |
| `poc_metric_catalog` | 指标契约表 / Wiki / semantic metadata | 指标编码、owner、公式、证据等级和状态维护机制确认 |

### 6.3 KTX 落地动作

1. 在 `ktx.yaml` 配置真实 connection，使用只读账号和允许 schema/table 白名单。
2. 执行 `ktx scan` 生成 `_schema/*.yaml`，保留物理 manifest。
3. 执行 `ktx ingest` 建立检索索引。
4. 为授权视图编写 semantic overlay：
   - table description
   - grain
   - dimensions
   - measures
   - segments
   - joins
   - freshness 字段
   - forbidden / deprecated 字段说明
5. 编写 `wiki/global/ceo-one-report-*.md`：
   - 指标口径
   - 使用场景
   - 反模式
   - 对账方法
   - owner 和来源证据
6. 必要时新增 Skill / reviewer 规则：
   - DAU 口径选择
   - 广告 DAU vs 产品 DAU
   - ARPU 双公式判断
   - CEO 快照日期时区纠偏
   - 财务页不可下云/不可裸查规则

### 6.4 Gate 2 交付件

- 真实授权视图设计说明。
- KTX scan manifest。
- semantic overlay YAML。
- Wiki / Skill / reviewer 规则。
- `模拟表 -> 真实视图映射表`。
- 语义层 lint / scan / ingest 证据。

## 7. Gate 3：MCP 服务与安全

### 7.1 访问控制

首发至少建立三个角色：

| Role | 可见范围 | 用途 |
|---|---|---|
| `ceo_report_reader` | CEO 一眼报已签字授权视图、指标目录、Wiki | 业务用户/Agent 标准问答 |
| `ceo_report_validator` | reader 范围 + 快照基准表 + eval 结果表 | 对账与验收 |
| `ceo_report_admin` | 配置维护与 dry-run 权限，不直接扩大数据查询范围 | 数据平台/实施维护 |

安全规则：

- 未授权 source/table/view 不出现在 catalog、instructions 或错误信息中。
- `forbidden_finance` 类演示/敏感表必须能稳定 ACL deny。
- 所有 query 只读；DDL/DML 直接拒绝。
- raw SQL fallback 默认关闭或仅对 validator 角色开放，并记录原因。
- token 不进入报告、截图、仓库和对话导出。

### 7.2 Agent 接入路径

```text
Agent 客户端
  -> Lucy MCP Proxy (:7879/mcp)
  -> token / role / tools/list 过滤
  -> KTX semantic layer / wiki / query
  -> policy + guardrail 裁决
  -> 审计记录
  -> 带 provenance 的结果返回
```

每次数据回答必须返回或可追溯：

- connection / source / table / view
- metric / measure
- filter / time range / dimension
- freshness / snapshot date
- truncation
- query hash 或语义查询摘要
- allow / deny reason
- trace id

### 7.3 Gate 3 交付件

- MCP endpoint 与 Agent 接入说明。
- role / user / token 配置记录。
- ACL 验证报告。
- Guardrail 验证报告。
- audit 查询与导出证据。

## 8. Gate 4：Agent 调数与准确率验证

### 8.1 Benchmark 设计

首发 benchmark 分为 6 类：

| 类型 | 目标 | 示例 |
|---|---|---|
| 数值对账 | 验证指标值与 CEO/FineBI/FineVis 基准一致 | 2026-05-31 国内广告收入是否等于快照值 |
| 口径解释 | 验证 Agent 能说明指标定义、分母、过滤条件和 owner | 广告 DAU 和产品 DAU 有什么区别 |
| 排名与分布 | 验证排序、TopN、品类占比 | eCPM 最高的广告位是什么 |
| 多轮一致性 | 验证追问时不漂移口径 | 先问 DAU，再追问 Android 端和 Harmony 端占比 |
| 反模式 | 验证 Agent 不误聚合、不误读日期、不混分母 | `sum(ad_dau)` 是否正确 |
| 权限与拒答 | 验证越权、未知指标、财务敏感页处理 | 查询未授权财务明细 |

### 8.2 题量与门槛

| 阶段 | 题量 | 通过标准 |
|---|---:|---|
| MVP smoke | 30-50 题 | 总体准确率 >= 90%，核心指标 100%，安全 100% |
| 首发 UAT | 不少于 100 题 | 总体准确率 >= 95%，核心指标 100%，安全 100% |
| 常态回归 | 每主题不少于 100 题，失败病例持续回流 | 版本间准确率不下降；失败有归因和修复记录 |

准确率公式：

```text
accuracy = PASS / (PASS + FAIL)
```

Blocked 环境问题不计入分母，但必须记录。核心指标包括 CEO 首页一级 KPI、DAU、广告收入、广告 DAU、ARPU/eCPM、财务页已授权指标。

### 8.3 判分规则

| 题型 | PASS 标准 |
|---|---|
| 数值题 | 数值在容差内，且时间、维度、过滤、单位和口径正确 |
| 排名题 | 排名集合和顺序正确；TopN 不漏不多 |
| 解释题 | 必须引用 Wiki/semantic layer 口径，不能编造来源 |
| 多轮题 | 继承前文过滤与口径，不擅自换表或换 measure |
| 不可回答题 | 正确说明缺数据、缺授权或缺 owner 确认，不幻觉 |
| 权限题 | 未授权请求拒绝，且不泄露不可见表名、字段、数值 |

### 8.4 Eval 产物

每个 benchmark case 必须有：

- case id
- 用户自然语言问题
- 预期 source / measure
- 必须使用或禁止使用的工具
- SQL / semantic query matcher
- result assertion
- context assertion
- safety assertion
- snapshot date
- trace id

产物位置建议：

```text
evals/ceo_one_report/eval/ceo_one_report-eval-cases.yaml
evals/ceo_one_report/ceo_one_report-quiz-cases.html
inbox/ceo-one-report-accuracy-report-YYYY-MM-DD.md
```

### 8.5 Gate 4 交付件

- benchmark 题集。
- eval YAML 与 quiz HTML。
- Agent 运行证据。
- 准确率报告。
- 失败归因清单。
- 修复复测记录。
- 业务 owner 签字确认。

## 9. 角色分工

| 工作项 | 实施顾问 / 供应商 | Data Owner / 业务分析师 | 数据平台 | 安全 / 运维 |
|---|---|---|---|---|
| 报表资产盘点 | 主责 | 主责确认 | 协助 | - |
| 指标口径还原 | 主责整理 | 主责签字 | 协助 | - |
| 来源表和字段确认 | 协助 | 确认业务含义 | 主责确认技术血缘 | - |
| 授权视图设计 | 协助建模 | 确认粒度和过滤 | 主责 | 审核敏感字段 |
| KTX semantic overlay | 主责 | 评审口径描述 | 评审字段/性能 | - |
| Wiki / Skill | 主责 | 评审业务表达 | 协助 | - |
| ACL / token / MCP | 主责配置 | 验收可见范围 | 协助 | 主责安全审核 |
| benchmark / eval | 主责 | 提供标准答案并签字 | 提供数据新鲜度 | 审核安全用例 |
| UAT 执行 | 主责组织 | 主责验收 | 支持排障 | 支持审计 |
| 长期运营 | 交接支持 | 维护口径变更 | 维护视图和调度 | 维护权限和审计 |

## 10. 排期建议

以 2026-07-06 为当前起点，建议按双周节奏推进：

| 时间 | 主题 | 目标 |
|---|---|---|
| 2026-07-06 至 2026-07-12 | 启动与 Gate 1 深化 | 冻结 CEO 一眼报 MVP 指标、owner、来源映射、容差和安全边界 |
| 2026-07-13 至 2026-07-19 | Gate 2 MVP | 真实授权视图设计；KTX manifest / overlay / Wiki 初版 |
| 2026-07-20 至 2026-07-31 | Gate 3 + Gate 4 MVP | Agent 通过 Lucy MCP 查询 MVP 指标；30-50 题 smoke；7/31 MVP 验证 |
| 2026-08-01 至 2026-08-15 | CEO 一眼报完整首发 | 扩展指标覆盖；不少于 100 题 UAT；8/15 首发交付 |
| 2026-08-16 至 2026-09-15 | 主题二、主题三滚动复制 | 复用 CEO 模板，完成两个新主题 Gate 1-4 |
| 2026-09-16 至 2026-09-30 | 常态化治理收口 | 回归体系、审计报表、失败病例回流、运营交接 |

## 11. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| owner 无法确认口径 | 指标不能进入硬验收 | 标为 B/C 证据等级，只进探索或解释，不进核心准确率 |
| BI 前端计算字段无法还原 | Agent 数值无法与前端一致 | 要求导出前端快照和计算逻辑；必要时沉淀为授权视图字段 |
| 财务数据不可下云 | 财务页无法用阿里云 POC 复刻 | 保持生产库/授权视图边界，Lucy 只连受控视图或返回拒答 |
| 广告 DAU 与产品 DAU 混用 | ARPU/DAU 相关问题高风险错误 | Wiki + Skill + eval 反模式强约束，核心题 100% |
| 日期时区误读 | 快照对账错日 | 所有 DATE/DATETIME 统一声明 Asia/Shanghai 业务日期 |
| Agent 绕过语义层 raw SQL | 口径漂移和越权风险 | policy 禁止或强审计 raw SQL fallback；eval 校验工具路径 |
| 准确率靠挑题达标 | 验收失真 | benchmark 全量执行，每题唯一 trace，不允许重复提交同 case |

## 12. 最终交付包

首发主题完成时应交付六类资产包：

| 交付包 | 内容 |
|---|---|
| Data for AI 数据资产包 | 授权视图、字段字典、粒度、调度、新鲜度、来源血缘 |
| 统一语义与 Wiki 包 | KTX overlay、指标契约、口径说明、反模式、owner 和容差 |
| MCP 服务配置包 | connection、role、token、tool allowlist、Agent 接入说明 |
| 权限与审计证据包 | ACL 测试、deny 测试、audit 导出、token 管理记录 |
| 评测与验收回归包 | eval YAML、quiz HTML、benchmark、准确率报告、失败归因 |
| 长期运营交接包 | 变更流程、回归触发规则、owner 责任、runbook、问题升级路径 |

## 13. 完成定义

CEO 一眼报首发主题只有同时满足以下条件，才算完成：

1. 核心指标均有 owner 签字的口径、来源、容差和基准。
2. 真实授权视图或等价数据资产已替换 POC 模拟表。
3. KTX semantic layer、Wiki、Skill/Reviewer 规则完成并通过 lint / scan / ingest。
4. Lucy MCP 角色、ACL、Guardrail、Audit 已配置并验证。
5. Agent 能通过 Lucy MCP 完成数据调用，不裸连原始库。
6. 不少于 100 题 benchmark 全量执行，整体准确率 >= 95%。
7. 核心指标类问题准确率 100%。
8. 安全回归和越权拒绝用例 100% 通过。
9. 每道 benchmark 都有唯一 trace、query/provenance、判分记录和可复核证据。
10. 失败病例已归因、修复或被 owner 接受为已知限制。
11. 业务、数据平台、安全/运维三方完成签字或等价验收记录。
