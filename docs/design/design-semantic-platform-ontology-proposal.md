# Lucy 语义平台本体化架构提案（挂起中·与既有裁定冲突）

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 语义平台本体化架构提案 |
| 文档类型 | Design Proposal（**挂起中，未获批准**） |
| 版本 | v0.1（提案稿） |
| 撰写日期 | 2026-10-16 |
| 来源 | 库主 2026-10-15 口述设计，经知识库侧核证后迁入本仓库 |
| 状态 | **⚠️ 与本仓库既有裁定直接冲突，见下节「零、与既有裁定的冲突」** |
| 适用范围 | Lucy 语义层架构的长期方向讨论；**当前实现不以此为准** |
| 参考 | `docs/specs/lucy-20261014-concept-dictionary-spec.md` v0.1；`docs/specs/lucy-20261014-fivetran-context-layer-competitive-analysis.md` v1.4 §5、§6 |

---

## 零、与既有裁定的冲突（**先读本节**）

本提案提出的本体图引擎 / 虚拟知识图谱 / SHACL 校验，与本仓库 **2026-10-14 Forrest 已裁定**的三条既有结论直接冲突。**在重新裁定前，本提案不得进入实施。**

| 既有裁定 | 出处 | 与本提案的关系 |
|---|---|---|
| **「明确不建议现在碰本体图引擎、自动 schema 发现」**——理由是「拿 Lucy 的短板去打 Fivetran 的长板」 | `lucy-20261014-fivetran-context-layer-competitive-analysis.md` v1.4 §5（2026-10-14 裁定） | **正面冲突**。本提案第 1 层（上下文投影网关）与第 3 层（VKG 下推）均在「不建议碰」清单内 |
| **「不实现通用本体图 / ontology 引擎（那是 Fivetran 量级，非本项目目标）」** | `lucy-20261014-concept-dictionary-spec.md` v0.1 §3 Non-goals 第 1 条 | **正面冲突**。这是概念字典 spec 的显式 Non-goal，本提案要推翻它 |
| **概念字典必须进 `semantic-layer/`，不得进 `wiki/`** | 同上 §1 落位裁定 + 竞品分析 §6 裁定 3 | **不冲突，但相邻**。本提案第 4 层「资产化存储用 OWL/RDF」是概念字典的**替代方案**，而既有裁定已选 YAML。两者只能存其一 |

### 已有工作正覆盖本提案想解决的问题

`concept-dictionary-spec.md` §1 已经诊断出与本提案同源的失败模式：

> **散文在 LLM context 中极易被忽略**，导致「写了规则但 Agent 照样算错」。

其解法是**强结构化 YAML**（`concepts.yaml`，`bindings` 为参与门禁校验的硬约束），不是本体图。本提案的 SHACL 校验层解决的是相邻但不同的问题（**运行时查询计划的类型/路径校验**，而非**跨域概念消歧**）。**两者不是同一件事，不能互相替代。**

### 需要重新回答的问题

若要推进本提案，须先明确回答：**Fivetran 短板（本体图）是否已从"不该碰"变为"该碰"？** 若答案是肯定的，应先修订上述两份 spec 的 Non-goals，而不是在 design 层另起一份提案。

---

## 一、ktx 与本体的定位差异（库主原述）

一个管过程（动），一个管事实（静）。

| 维度 | ktx（运行时编排基座） | 本体 / Ontology（业务语义模型） |
|---|---|---|
| 核心职责 | How to run（怎么跑、何时停） | What is what（业务概念定义与实体关系） |
| 抽象层级 | 系统与协议层（流程、事件、通信） | 业务与认知层（领域知识、实体逻辑图谱） |
| 管理对象 | 线程/协程、Agent 状态机、Tool 调用、记忆栈、超时重试 | 实体（Class）、属性（Property）、维度/指标、上下位关系、约束规则 |
| 关注点 | 吞吐量、并发调度、低延迟、流水线容错 | 语义消歧、业务指标口径唯一性、防幻觉、逻辑推演 |
| 典型异常 | ToolTimeoutError、NetworkError、TokenLimitExceeded | MissingRequiredProperty、SemanticConstraintViolation |

类比：ktx 是自动驾驶汽车的操作控制系统（转向、油门、避障调度）；本体是车机里的高精矢量地图与交通交规（道路网络、通行约束、路标定义）。

> 注：仓库 `AGENTS.md` 已明确 **KTX 依赖边界**——KTX 是 Lucy 引用的上游依赖，本仓库不修改 KTX 源码。本提案与该边界一致：本体层不侵入 KTX。

---

## 二、四层架构（库主原述）

目标：让 Lucy 独立为可靠语义中枢，对接不同 Agent（ChatBI Agent、指标诊断 Agent、报表生成 Agent）。核心是把本体从「代码内部库」转变为「对外提供语义契约的 Service」。

```text
            上层消费 Agent（ChatBI / 治理 / 外部平台）
                        ▲
              标准语义协议（MCP / gRPC）
┌───────────────────────────────────────────────────────────────┐
│ Lucy 语义中枢（Platform）                                       │
│ 1. 上下文投影网关（Context Serving Gateway）                     │
│    · 动态子图修剪（Token 预算感知）                              │
│    · 业务术语归一化与消歧（Resolving）                           │
│ 2. 规则校验网关（Semantic Guardrails — pySHACL）                │
│    · 实体关系路径校验 · 聚合算子与字段类型强约束                  │
│ 3. 虚拟映射与下推层（VKG Engine — Ontop 架构思想）               │
│    · 概念模型 → 物理表映射（Mapping）                            │
│    · 自动转译与下推至数仓                                        │
│ 4. 资产化存储与治理（Semantics as Code — Owlready2 / Git）       │
│    · OWL/RDF 格式存储 · Git CI/CD 语义 Lint 与热加载             │
└───────────────────────────────────────────────────────────────┘
```

### 四个机制要点

1. **资产化管理 Semantics as Code**：本体定义用统一标准（OWL/Turtle/YAML）存语义代码库；CI/CD 合并前 Lint 循环依赖、孤立节点、属性定义冲突。
2. **动态上下文抽取 Context Pruning**：不把全量本体塞 prompt。按输入 Query 做图遍历取相关度最高的 K 阶局部子图，结构化输出指标口径、关联维度、同义词。
3. **确定性防护网关 pySHACL**：Agent 输出的查询意图（Logical AST）进入物理数仓前必过 SHACL 规则，把自然语言错误转成机器可读结构化 Payload（如 `{"error":"TYPE_MISMATCH","node":"GMV","constraint":"cannot_group_by_unrelated_dimension"}`）。
4. **虚拟映射下推 Ontop 模式**：数据留在数仓，Lucy 只管「业务实体 → 物理表/字段」映射，Agent 不感知物理 Schema。

---

## 三、四个标准服务接口（库主原述）

| # | 接口 | 用途 |
|---|---|---|
| 1 | `lucy.resolve_term(query, domain) -> TermContext` | 提问模糊时（如"看下大盘毛利"），返回对齐后的标准术语、归属业务域、标准修饰词 |
| 2 | `lucy.get_context_graph(entities, max_hops=2) -> SemanticGraph` | 拿到实体后取最小拓扑关系（如 用户→订单→支付方式），组装 SQL prompt |
| 3 | `lucy.validate_logical_plan(plan) -> ValidationResult` | 生成中间计划后预检。通过返回 OK；违规返回违约路径与修正建议，供 Agent 触发自纠错 |
| 4 | `lucy.execute(semantic_query, security_context) -> ResultData` | 提交标准语义查询，完成到物理 SQL 的翻译，注入表级行权限后下推底座执行 |

---

## 四、三条工程原则（库主原述）

1. **确定性与概率性彻底分离**：LLM 负责意图理解、文本泛化、生成；平台负责指标公式、实体关系连通性校验、表结构映射。杜绝让 LLM 自由拼凑表关联关系。
2. **权限控制下沉，避免权限树冗余**：不在语义层内重建脆弱的"指标级权限树"；语义映射严格锚定物理底层，权限直接继承数仓的表级与行级访问控制（RLS），保证跨 Agent 安全边界一致。
3. **闭环自愈契约 Self-Correction Protocol**：抛出校验异常时，错误格式严格遵循固定 Schema（错误根因 + 违反规则 + 推荐修正候选）；调度器捕获此类异常即判定为"语义可修复错误"，自动把修正上下文反馈当前 Agent 触发自我迭代。

> 原则 2 与本仓库既有 ACL 设计一致（`docs/access-control/design-upgrade.md` 的 fail-closed 与 capability 元组裁决）。**该原则可直接采纳，不受第零节冲突影响。**

---

## 五、外部组件核证结论（2026-10-15 核证）

| 组件 | 核证结论 |
|---|---|
| **Ontop** | Apache-2.0，980⭐，2026-10-15 当天有提交；最新稳定版 **5.5.0（2026-02-14）**；已支持 Snowflake / Databricks / BigQuery / Redshift / DuckDB / DynamoDB。**成熟可用** |
| **pySHACL** | Apache-2.0，360⭐，0.40.1（2026-07-28）；SHACL 标准 Python 实现 |
| **Owlready2** | ⚠️ **不宜作 Git 资产底座**：GitHub `pwin/owlready2` 是从 Bitbucket 同步的 fork 镜像，最后 commit **2020-11-26**，原 Bitbucket `solyaris/owlready2` **已 404**，48 个 open issue 无人响应；PyPI 仍发版至 **0.51（2026-06-22）**。**pip 安装可用，但无人维护 PR/issue 流程** |
| **LLM4VKG**（IJCAI 2025） | 与 Ontop **同一作者群**（Guohui Xiao、Davide Lanti），README 要求先装 `ontop/ontop` + `logmap-matcher`，即 Ontop 之上的增强层非竞品。⚠️ **仓库无 LICENSE 声明 = 默认保留所有权利，不可直接商用** |
| **OntoEKG**（arXiv 2602.01276） | LLM 从非结构化文档抽本体。**精确匹配 F1 ≈ 0**（Data 0.102 / Finance 0.000 / Logistics 0.048），模糊匹配 F1 最高 0.724。作者自承无法自主划本体边界、实例/类混淆、层级方向性错误 → **输出只能当草稿，不能当 schema** |

---

## 六、风险清单

| # | 风险 | 级别 |
|---|---|---|
| R1 | **与 §6 裁定 3 冲突**（concept-dictionary Non-goals） | **阻断级** |
| R2 | **Owlready2 无维护痕迹**，作 Semantics as Code 底座会失去可追溯性 | 高 |
| R3 | **概念字典已覆盖跨域消歧**，本提案第 1 层与之功能重叠，须先划清边界 | 高 |
| R4 | **OWL 本体资产不存在**：现有本体形态是 `wiki/` 散文 + `skills/` 规程，非 OWL | 高 |
| R5 | **SHACL 层与既有 fail-closed ACL 是两套东西**，若都叫"校验"易混淆职责边界 | 中 |
| R6 | **Ontop 的价值成立于"复杂 schema + 数据不出源 + 多源联邦"**，若 Lucy 长期单源单 schema，属提前引入 | 中 |

---

## 七、待决问题

| # | 问题 | 状态 |
|---|---|---|
| 1 | Fivetran 短板（本体图）是否已从"不该碰"变为"该碰"？ | **待裁定（阻断项）** |
| 2 | 概念字典 YAML 与 OWL 本体二选一，还是可共存？ | 待裁定 |
| 3 | SHACL 校验层是否值得独立于既有 fail-closed ACL 存在？ | 待裁定 |
| 4 | 若推进，是否修订 `concept-dictionary-spec.md` §3 Non-goals？ | 待裁定 |

---

## 八、覆盖范围与缺口

**已记录**：库主口述的架构与原则原样保留，未改写。补充部分为外部组件核证、既有裁定冲突核对与风险清单。

**未做**：未本地安装或验证任何外部组件；未设计接口 Schema / 错误码；未测算工期；未建实施计划。

**本文件状态**：提案稿。未获批准，不作为实施依据。
