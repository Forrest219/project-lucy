# Lucy × Fivetran Context Layer 竞品对比与差异化借鉴清单

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy × Fivetran Context Layer 竞品对比与差异化借鉴清单 |
| 文档类型 | Competitive Analysis / Blueprint（竞品分析 + 立项依据） |
| 版本 | v1.5（v1.3 经 Forrest 四轮评审后修订：修正 §8.1 覆盖率口径笔误、撤回单源中性提示、明确 measure 差分须为语义 Diff；v1.5 仅更新落位与状态，结论未变） |
| 日期 | 2026-10-13；v1.1～v1.4 更新 2026-10-14；v1.5 更新 2026-10-14 |
| 撰写人 | Mavis（v1.1～v1.4 依据 Forrest 评审意见修订） |
| 委托人 | Forrest |
| 适用范围 | 竞品定位与差异化立项依据。本文**不是功能 Spec**；实施依据为其派生出的三份正式 Spec（见下） |
| 落位依据 | `docs/governance/DEVELOPMENT.md`「Spec 落位规则」：仓库级 spec / 治理 / 跨模块产品视图落在 `docs/`。**v1.4 及之前落于 `inbox/`（gitignore 临时区），v1.5 迁入 `docs/specs/` 纳入版本控制**，因其已成为三份正式 Spec 的引用来源 |
| 派生 Spec | P0-1 `docs/specs/lucy-20261014-safe-log-to-quality-eval-spec.md`（工单 `docs/plans/wo-20261014-safe-log-to-quality-eval.md`）<br>P0-2 `docs/specs/lucy-20261014-release-bom-spec.md`（工单 `docs/plans/wo-20261014-release-bom.md`）<br>P1 `docs/specs/lucy-20261014-concept-dictionary-spec.md`（工单 `docs/plans/wo-20261014-concept-dictionary.md`） |
| 证据时效 | Fivetran 侧基于 2026-10-13 当日抓取的官方文档；Context Layer 处于 Public Preview，官方明示「supported plans, clouds, regions, and connectors are subject to change」 |
| 复核触发 | Fivetran 退出 Public Preview；或 Lucy 补齐本文任一 P0 能力 |

---

## 0. 一句话结论

两者不在同一抽象层，硬对比会失真：

- **Fivetran Context Layer** 是「数仓之上的 context 中枢」——不碰数据搬运，依赖已有 Snowflake/BigQuery/Databricks，靠连接器生态换广度。
- **Lucy** 是「从数据源直达 agent 的端到端栈」——自接数据库、自维护语义层 overlay、自做权限裁决与回归门禁，换深度与私有化。

**真正重叠的只有一块：把业务语义 + 数据访问通过一个受治理接口交给 agent。** 在这一块上 Lucy 权限模型更深、Fivetran 生态更宽；双方在「质量证据」上都偏软，但 Lucy 至少把这一点写进了自己的文档。

**差异化不该是功能追平（追不上），而应是补上 Fivetran 结构上不做、且对中小企业付费决策真正重要的那一层：可信度证据链。**

### 0.1 版本变更摘要

| 版本 | 核心变更 |
|---|---|
| v1.1 | P0-1 触发口径改为三层；概念字典落位收紧为 `semantic-layer/`；P0-2 形态由大屏收缩为 Release BOM |
| v1.2 | L1/L2 产物分层（断言型 vs 草稿型）；BOM 拆 v1/v2 消除 P0 依赖 P1；补概念字典运行时裁剪暴露机制 |
| v1.3 | **修正 v1.2 成本评级错误**（质量断言不可由审计日志推导）；补跨域概念激活条件；BOM 覆盖率拆双指标 |

各轮评审的完整记录见 §7 / §7.2 / §7.3，立项约束见 §8.1。

### 0.2 v1.0 最关键的错误假设（已废弃，保留供追溯）

v1.0 在 P0-1 中假设「问询结束时自动标记 ok/wrong/partial」。**该假设不成立**：Lucy 是 MCP Server，宿主为第三方客户端（Claude Code / Cursor / 自建 Agent），拿不到用户是否采纳回答的 UI 行为。任何依赖「用户显式反馈」或「agent 自评」的方案都不应作为质量基准。正确做法见 §3 P0-1 三层触发口径——**以确定性运行时信号为主，人工标注只覆盖机器无法判定的语义争议**。

---

## 1. 能力逐项对比

### 1.1 事实对照表

| 维度 | Fivetran Context Layer | Lucy（本仓） | Lucy 证据锚点 |
|---|---|---|---|
| **产品状态** | Public Preview（硬限制：连接 ≤ 50；Agent Context MCP 100,000 次/账号/日、1,000 次/时） | 自建交付中；文档自带「交付状态快照」标注未完成项 | `docs/governance/project-overview.md` §6.1 |
| **数据底座** | 必须已有目标仓：Snowflake / BigQuery / Databricks；区域限 North America；云限 GCP / AWS / Azure | 自带接入：MySQL / PostgreSQL 已验证；StarRocks P1 门禁中；Oracle 路线中 | `project-overview.md` §6.1「数据库接入」 |
| **接入广度** | 文档源 4 类（Confluence、Google Drive、Notion、SharePoint）＋ 分析源 6 类（dbt Cloud、Hex、Looker、Omni、Power BI、Sigma）＋ 系统记录 9 类（Asana、Bitbucket Files、GitHub、GitHub Files、Gong.io、HubSpot、Intercom、Jira、Zendesk） | 数据库 + 本机 `semantic-layer/` + `wiki/` + `skills/` + `raw-sources/`；**无任何第三方 SaaS 连接器** | `README.md` 核心目录表 |
| **语义表达** | 自动发现本体图，落目标仓 `AGENTS` schema：`_ENTITY` / `_EDGE` / `_CONCEPT` / `_INFERENCE` / `_MEMORY` / `_TABLE_SUPPORT` 等 | 人工 overlay YAML：grain / measures / segments / joins / source metadata；manifest 与 overlay 分层 | `project-overview.md` §5；`AGENTS.md` |
| **给 agent 的接口** | 仅 2 个工具：`execute_sql`（Read，只读 SQL）＋ `provide_feedback`（Write） | 数据面：`lucy_query` / `lucy_read_source`；Meta：`lucy_catalog` / `kx_catalog`；诊断：`lucy_freshness` / `lucy_explain_query`；上游：`entity_details`、`wiki_search` / `wiki_read`；协议：`lucy_begin_question` | `webui/docs/07-mcp-auth-proxy-spec.md` §工具表 |
| **上下文注入** | Fivetran 侧预存预处理，MCP 返回聚焦答案，主打省 token | Proxy 在 `initialize` 时按 effective permissions **动态生成 role-aware instructions**，只列当前 token 可见的连接与 source | `CLAUDE.md` 双语境表；`07-mcp-auth-proxy-spec.md` §4.4 |
| **权限粒度** | schema 层有 `USER` / `PERMISSION_GROUP` / `USER_PERMISSION_GROUP` / `ENTITY_PERMISSION_GROUP` 四张表；**裁决逻辑未在文档公开** | 工具三分级（AbsoluteDeny / DataPlane / Meta，未分类默认 AbsoluteDeny）＋ capability 元组 `(tool, canonicalSourceKey, rowGrant)` 求并集 ＋ Agent 个人行约束（AND）＋ `permission_model_version` v1/v2（v2 禁 `prefix`） | `docs/access-control/design-upgrade.md` v1.1.2 术语表与 §0 |
| **失败语义** | 文档未说明 | fail-closed 写进设计：意图收窄但编译/切换失败 → 禁止沿用更宽旧权；YAML 非法且可定位 Agent → 该 Agent 数据面全拒；无法定位 → 数据面整体拒 | `07-mcp-auth-proxy-spec.md` §5.1.2 |
| **质量回归** | Playground 试问 + `provide_feedback` 回流 | `evals/` 套件 + `skill_version` 绑定 + tiered publish gate；**但运行时无任何反馈入口** | `skills/README.md`；`webui/docs/64-tiered-publish-gate-spec.md` |
| **治理工作台** | Fivetran Dashboard | 自建 WebUI 七模块：部署向导 / 数据库接入 / 语义层 / 业务文档 / 审阅校验 / 质量评测 / 访问治理 | `project-overview.md` §6 |
| **部署形态** | 托管 SaaS（`https://api.fivetran.ai/mcp`） | 私有化：Docker Compose（开发演示）＋ Kubernetes/Helm 单副本（客户交付，amd64）；HA 不在范围 | `AGENTS.md` 环境表 |

### 1.2 Fivetran 侧事实来源

| 事实 | 来源 URL |
|---|---|
| Context Layer 总览、能力边界、Public Preview 状态 | https://fivetran.com/docs/context-layer |
| Agent Context MCP 托管地址、两个工具定义 | https://fivetran.com/docs/context-layer/agent-context-mcp |
| `AGENTS` schema ERD（`FIVETRAN_CONTEXT_LAYER_*` 全部表与关系） | https://fivetran.com/docs/context-layer（同页内嵌 AgentsSchemaErd 组件） |
| Agents Schema 开源标准（dbt-labs） | https://github.com/dbt-labs/agents_schema |
| 三类支持源清单、前置条件、用量限制 | https://fivetran.com/docs/context-layer |

> 注：Fivetran 官方文档中，Context Layer 与 Agent Context MCP 两页标题均带 **Public Preview** 徽章；原文明示「Supported plans, clouds, regions, and connectors are subject to change」「This tool interface is subject to change as AI models evolve」。引用其能力时不应视作 GA 承诺。

---

## 2. 三个真实差异（含诚实边界）

### 2.1 权限深度：Lucy 更强，但行级是「设计深、落地浅」

Fivetran 的权限组模型在公开文档里只是四张元数据表，裁决发生在 MCP 服务端黑盒里。Lucy 把裁决规则、失效语义、版本化配置全部写成可审计契约（`design-upgrade.md` v1.1.2 六项 ADR）。

**但必须同时说清**：Lucy 的 Row Grant 在 AC-P0 阶段**恒为 TRUE**；`scoped` + `row_policy` 属 AC-P1 冻结态（`README.md` §5「AC-P1 状态：冻结（须上游强制谓词契约）」）。区域级行隔离目前靠 `VIEW-as-pseudo-table` 变通（`superstore_region_huadong` → `dataforai.superstore_orders_huadong`，零代理层代码改动）。

即：**现在真跑的行级是「能演示、非一等公民」**。对外材料不应把它讲成已交付的行级安全。

### 2.2 生态广度：Fivetran 碾压，且短期内补不上

Lucy 的源是「我们自己维护的文件和库」；Fivetran 的源是 Confluence + Notion + SharePoint + dbt + Power BI + Sigma + Jira + HubSpot + Gong + Intercom…… 这条线。Lucy 要追平等于自建一整条 SaaS 集成产品线，与现有工程量级不在一个数量级。

**结论：不追。** 并把「私有库 + 本地文档、不接 SaaS」转成隐私与合规卖点，而非能力缺失。

### 2.3 双方的质量证据都不硬

- Fivetran：停在 Public Preview，带连接数与请求数配额。
- Lucy：虽有 eval 套件与门禁脚本，但 `project-overview.md` §6.1 自陈「完整 LLM/agent eval 未形成稳定证据」「Observability / alerting 未开发」「Skill management 闭环未开发」「MCP endpoint 启停/状态/健康/轮换 UI 未开发」。

两边都是设计跑在证据前面。**Lucy 的优势在于把这事写进了自己的文档**，这是可信的团队信号，但也意味着当前不能拿 eval 覆盖率当销售承诺。

---

## 3. 值得借鉴的 4 项（按 ROI 排序）

### P0-1 `provide_feedback` → 真实使用回流成 eval case

**这是两边差距最大的一项，而且是闭环差距。**

**现状证据（已核实）**：
- 运行时**有**单向问询上报：`lucy_begin_question`，Proxy 侧强制 `intentSummary`（`mcp-proxy.ts:3435-3503`，缺字段或持久化失败均返回 isError 并拒记该轮）。
- 运行时**没有**任何答案级反馈工具：grep `answer_quality|user_rating|thumbs|not_helpful` 在 `webui/` 下零命中；`lucy_begin_question` 在 `mcp-proxy.ts:398` 被显式排除出审计统计。
- eval 侧**有**写入通道但**无运行时来源**：`eval/cases.ts:300`（`eval_case_save`）、`eval/suite-import.ts:542/581`（`/api/eval/suites/import`、`/api/eval/results/import`）。
- 门禁侧**已就位**：`64-tiered-publish-gate-spec.md` 的 P0 拦截 / P1 复核 / P2 告警三级模型，只等有人喂真实失败样本。

即：Lucy 有完整前半段（审计 trace → eval 套件 → skill_version 绑定 → 发布门禁），**唯独缺「线上真实提问进不了 eval」这一环**。eval 资产只能靠人工手写，等于回归门禁守的是一份手写快照，不是真实流量。

**建议补法（v1.1 修订）**：v1.0 曾假设「问询结束时自动标记 ok/wrong/partial」，该假设不成立——详见 §0.2 评审修正。改为三层触发口径。

#### 三层触发口径

| 层 | 信号来源 | 是否需人工 | 可自动化程度 |
|---|---|---|---|
| **L1 确定性运行时失败** | `outcome` ∈ `error` / `denied` / `budget_stop`；`decision_reason`、`error_detail`、`failure_dimension` | 否 | **完全自动**，Proxy 已落库 |
| **L2 意向未覆盖** | 同 turn 内多次 `wiki_search` / `lucy_catalog` 探索但未产出 `lucy_query`；或 `result_empty`；或 `call_count` 逼近预算上限 | 否 | **可自动**（需新写聚合逻辑） |
| **L3 业务口径争议** | 管理员在 WebUI 审计日志中主动捞取并标注 | **是** | 不可自动化 |

```
L1（Proxy 自动，零人工）—— 可直接产出断言型候选 case
  → 生成 candidate（携带 source/measure/filter/freshness/skill_version + 失败维度）
  → WebUI 待审队列 → 人工确认后入 evals/ 并绑定 skill_version

L2（Proxy 自动，零人工）—— 仅产出 Intent Gap Draft，不可直接转回归用例
  → 生成 context trace（探索过的 catalog/wiki/连接、budget 消耗、终止原因）
  → 强制进入 L3 人工打标：补全预期口径与标准 SQL / 断言
  → 补全后方可转为正式回归用例

L3（管理员主动标注或补全 L2）
  → 进入同一待审队列；L3 来源优先级最高
```

**关键约束 3（v1.2 新增）：L1 与 L2 的产物性质不同，不得合并处理。**

L1 的语义是「Agent 知道要什么、但被系统或数据库挡住了」——失败时有明确的 SQL 报错、目标表、入参，**天然具备断言基础**。L2 的语义是「Agent 自己也没成型」——系统无从得知它意图的 measure 或 filter，**只��产出 trace 而非断言**。

若把 L2 草稿直接当 eval case 入库，会产出「无断言的假回归用例」：它不校验任何东西，却占据覆盖率分母，反而稀释门禁信号——比没有更糟。

**关键约束 1：绑定关系不能断。** 每条回流 case 必须记住它覆盖的 measure 与 skill 版本，否则「改了 wiki 口径导致老 case 挂掉」这一最常见回归无法被门禁捕获。

**关键约束 2：回流 case 必须强制人工审阅。** 真实流量含敏感数据、歧义口径与幻觉 prompt；未经审阅直接入库会污染回归基线，反噬发布门禁本身的可信度。与现有 tiered publish gate「禁止无证据一键 override」精神一致。

**差异化落点**：Fivetran 的反馈终点是供应商（`provide_feedback` 提交给 Fivetran）；Lucy 的反馈终点是**客户自己的变更流程**——它直接决定下一版发布能否放行。这是功能对功能之外的东西，Fivetran 结构上不会做。

**实施成本重估（v1.1）**：v1.0 估「低风险」。实际上 L1 只需在现有审计查询上加 SELECT，L2 需要新写 turn 级聚合，L3 需要 WebUI 标注入口。整体仍属**低到中**，但不是「纯复用」。**前置依赖：须先完成 §6 待决问题 1 的裁定。**

**实施成本重估（v1.2，大幅下调）**：核实后发现 **Lucy 已有 `security-candidates.ts` 完整实现了「审计事件 → 候选 case → 人工审 → 晋升正式用例」的全套范式**，可作为 P0-1 的直接模板：

- `security_eval_candidate` / `security_eval_candidate_review` 两张表已实现候选与审阅分离
- `formalCaseFor()`（`security-candidates.ts:321`）展示候选如何晋升为带 `result_assertions` 的正式用例
- `buildPromotionPreview()`（同文件 `:339`）展示晋升时的 YAML 合并与去重逻辑
- `hasAcceptedReview()`（同文件 `:310`）已实现「已有接受记录则跳过」的幂等保护

即：**P0-1 不需要发明流转机制，只需把既有安全域范式扩展到质量域。**

#### ⚠️ 成本评级修正（v1.3，采纳三轮评审意见）

**流转框架可 100% 复用，但断言构造不可复用。评级回退为「低到中」。**

v1.2 的下调是错误的，原因在于**高估了范式复用的覆盖面**：

| 维度 | 安全域现状 | 质量域需求 | 可否复用 |
|---|---|---|---|
| 断言结构 | `formalCaseFor()` 只产出一个 `value_type: "text"` + `compare_mode: "denied"`（`security-candidates.ts:330-335`） | `ResultAssertion` 支持 `scalar` / `dataframe` / `text` / `empty_result`，可带 `numeric_tolerance`、`check_schema`、`check_row_count`、`key_columns`（`cases.ts:22-30`） | **不可复用** |
| 执行契约 | 无 | `executable` 需 `required_measures` / `grain` / `required_columns` / `required_filters` / `reconciliation`（`cases.ts:56-62`） | **不可复用** |
| 语义标签 | `decision_reason` 即全部语义 | `expected_measures` / `skill_version` / `semantic_version` / `as_of_binding` 多维绑定（`cases.ts:37-55`） | **不可复用** |

**核心判断：安全断言是二元的（被拒 / 未被拒），质量断言是结构化的（SQL 聚合粒度、指标容差、过滤条件、结果 schema）。** 前者可从 `decision_reason` 一比一映射，后者无法从审计日志自动推导——**这正是 L1 也需要人工补全 `executable` 契约的原因**（与 v1.2 已确立的「强制人工审阅」一致，只是理由需从「防污染」扩展为「补断言」）。

**修正后的成本拆分**：
- 候选生成 / 审阅流转 / YAML 合并 / 幂等保护 → 复用，低
- **质量用例的 `assertion_builder` 与 `executable` 契约构造 → 新写，中**
- L2→L3 人工补全界面 → 新写，中

---

### P0-2 组织指纹（Organization Fingerprint）

**现状**：Lucy 有零散 trace、access audit、publish history，但**没有一张能给客户决策层看的总览**。Fivetran 在 build 完成后提供 organization fingerprint 审阅环节。

#### 形态修正（v1.1，采纳评审意见）

v1.0 提出「给决策层看的大屏」，对私有化交付团队是**沉重包袱**——需长期维护实时聚合视图。改为：

> **随每次发布生成的 Release Bill of Materials（发布审计摘要）**，而非实时 Dashboard。

形态示例：

```
本次发布审计摘要
  口径变更        12 项（新增 3 / 修改 6 / 下线 3）
  变更口径覆盖率   67%（3 个新增口径中 2 个有 eval case）  ← 门禁阈值判定
  基线回归通过率   85%（127/149 case）                    ← 存量健康度
  跨域冲突消解    2 项（revenue: kx_financial vs superstore）
  权限变更        新增 role × 1，表级授权扩大 × 2（P0 门禁已拦截 × 1）
  ── 以下待 BOM v2 ──
  零调用口径      3 项（近 30 天，建议下线）
  未覆盖高频口径   1 项（gross_margin，近 30 天调用 47 次，无 eval）
```

> 覆盖率单指标已废除。变更口径覆盖率与基线回归通过率**分母不同、不可互相抵消**——存量全绿不得掩盖新增未覆盖。

**为什么这个形态更好**：
- 输出时机是**发布事件**而非任意时刻——与 Lucy 既有 `publish history` 天然对齐，不引入新运维负担
- 消费场景是**发布审批**，不是「日常盯盘」——恰好是已有 tiered publish gate 的位置
- 客户决策层要的「这数能不能拿去汇报」变成一张可归档、可追溯的凭证，而非需要长期养着的看板

#### 交付分期（v1.2，采纳评审意见）

v1.1 曾把 BOM 排在 §5 第 2 位，但其展示指标含「零调用口径」「未覆盖高频口径」——这两项依赖第 4 项（用量反向清理）的聚合逻辑，构成 **P0 依赖 P1 的时序冲突**。拆为两期：

| 版本 | 指标 | 依赖 | 可交付性 |
|---|---|---|---|
| **BOM v1** | 口径变更差分（增/删/改）、**变更口径覆盖率**、**基线回归通过率**、门禁拦截状态、跨域概念冲突消解清单 | 仅需发布事件与既有 eval 套件，**零运行时依赖** | 可与 P0-1 同期交付 |
| **BOM v2** | 口径调用频次热度、零调用下线建议、高频未覆盖告警 | 依赖 P1 用量反向清理的 SQLite 聚合引擎 | 追加交付 |

#### 覆盖率必须双指标（v1.3，采纳三轮评审意见）

v1.2 的示例写「eval 覆盖 85%（127/149 case）」存在**分母歧义**，且单一指标会给决策层虚假安全感：若本次发布只新增 1 个口径，而历史 149 个 case 全通过，显示 100% 属实，但**该新口径可能根本没有 eval case**。

拆为两个口径不同的指标：

| 指标 | 定义 | 分母 | 用途 |
|---|---|---|---|
| **变更口径覆盖率**<br>Targeted Coverage | 本次变更/新增的 measure 中，有对应 eval case 覆盖的比例 | **本次变更涉及的 measure 数** | **门禁阈值判定**——新口径无 case 不得放行 |
| **基线回归通过率**<br>Baseline Pass Rate | 历史存量 case 的通过比例 | **全部存量 case 数** | 存量健康度，不参与新口径放行判定 |

**判定示例**：新增 2 个口径、其中 1 个有 case，变更口径覆盖率 50% → **门禁不通过**；同时基线回归 127/149 = 85% → 存量健康但**不能**用来抵消前者。**存量全绿不得掩盖新增未覆盖。**

**实施前提**：变更口径覆盖率依赖「measure 变更集」与「eval case 覆盖集」的映射。覆盖侧已有 `EvalCase.expected_measures`（`cases.ts:42`）与 `executable.required_measures`（`cases.ts:57`）。

#### Measure 差分必须是语义 Diff（v1.4，采纳四轮评审意见）

**变更侧严禁使用 Git 文本行级 diff。** 若直接对 `semantic-layer/*.yaml` 做文件行比对，开发人员格式化缩进、修改注释、调整字段顺序都会触发「measure 变更」，进而要求补 eval case——门禁会被噪声淹没而逐渐被绕过。

**正确做法**：YAML 解析为 AST → 反序列化为语义模型 → 比对 **formula / filter / grain 等业务语义值**（或其规范化哈希），**仅业务逻辑改变才计入变更集合**。

**现有基础设施可复用**（已核实）：
- `server/semantic-layer.ts:3,230` — 已引入 `yaml` 包的 `parse` / `parseDocument` / `Scalar` / `YAMLMap` / `YAMLSeq`，具备完整 AST 操作能力
- `server/overlay.ts:3,25` — 已实现 overlay 的 parse 路径
- `server/project.ts` — 大量 `parseDocument` 用法，含 `keepSourceTokens` 模式

即：语义 diff 引擎不需要引入新的 YAML 依赖或解析模式，**在既有 AST 能力上加一层「语义模型规范化 + 哈希比对」即可**。这也是 BOM v1 的核心工程量所在。

**拆分依据**：BOM v1 的四项指标全部可从「发布产物 + eval 套件」静态比对得出，不依赖任何运行时 trace 聚合，因此可在 P1 之前独立交付。BOM v2 追加而非重做，避免返工。

**差异化落点**：Fivetran 的指纹回答「我们连了什么」；Lucy's BOM 回答「你这一版发布的口径覆盖到哪、还差什么」。中小企业客户付钱买的不是连接器数量，是「这数能不能拿去汇报」——BOM 把这句话变成了可交付的物。

---

### P1 概念层（Concept Dictionary）

**现状**：Lucy 语义层是**单表视角**——grain / measures / segments / joins 全挂在 source 上。Fivetran 有 `_CONCEPT` / `_EDGE` / `_INFERENCE` 做跨表概念图。

**Lucy 的真实痛点（非假设）**：Superstore（零售订单）与 KX Financial（财报）是两条独立数据线，「公司」「期间」「金额」在两边含义并不一致——KX 的「金额」带 `amount_type` 维度，Superstore 的「收入」是 `sales`。**Lucy 现在靠 wiki 散文描述这个差异，没有一个结构化的位置放它。** 相关坑点目前寄居在 `evals/kx_financial/` 的 case 说明与 `skills/domains/superstore/pitfalls.md` 中。

#### 落位修正（v1.1，采纳评审意见）

v1.0 写「挂在 `semantic-layer/` 或 `wiki/` 均可」，此表述有误。**必须进 `semantic-layer/`，不得进 `wiki/`。**

理由：Lucy 现有问题不是「没有散文说明」，而是**散文在 LLM context 里极易被忽略**。若概念字典仍是 Markdown，会重蹈「写了规则但 Agent 照样算错」的覆辙——即没有修复任何问题。放进 `wiki/` 等于造第二份 wiki。

进 `semantic-layer/` 的三个实质收益：
1. 受发布门禁管控（`64-tiered-publish-gate-spec.md`），变更可拦截、可追溯
2. 可参与 `access.yaml` 编译与自动化检查（`design-upgrade.md` 的 Policy Compilation Input 含 semantic-layer source map）
3. 可在 `lucy_explain_query` 或动态 prompt 注入时作为**硬约束**生效，而非弱提示词

#### 建议 Schema 形态（强结构化 YAML）

```yaml
concepts:
  revenue:
    description: "集团营业收入"
    bindings:
      - domain: kx_financial
        measure: kx.amount
        filter: "amount_type = 'REVENUE'"
      - domain: superstore
        measure: superstore.sales
        filter: null
    conflict_rule: "跨域对比时，优先以 kx_financial 财报口径为准"
```

**关键设计点：只有结构化绑定，才能在 `lucy_explain_query` 或动态 prompt 注入时作为硬约束生效。** 自由文本的 `conflict_rule` 仍受「散文被忽略」风险影响——实施时应优先确保 `bindings` 部分结构化可校验，`conflict_rule` 作为人类可读补充。

#### 运行时暴露机制（v1.2 补充，采纳评审意见）

v1.1 只定义了落位与 Schema，**遗漏了最关键的一环：这份元数据在运行时如何交给 Agent。** 落进 `semantic-layer/` 只解决了治理与门禁，不解决 agent 能不能用。

**风险**：若直接全量拼入 `buildRoleAwareInstructions()`（`mcp-proxy.ts:1585`），随着跨域概念累积到数十上百个，会挤占 system prompt 窗口、抬高推理成本，且违背 Lucy 既有的「role-aware 裁剪」设计意图。

**两条暴露路径，建议同时采用**：

| 路径 | 机制 | 适用 |
|---|---|---|
| **冷拉取（按需工具）** | 扩展 `lucy_catalog` 或 `entity_details` 返回结构，Agent 判断涉及跨域分析时主动查询 | 概念数量多、绝大多数查询不涉及的概念 |
| **热注入（权限裁剪）** | Proxy 依 `Effective Data Capabilities` 解析当前 token 有权访问的 Source 列表，**仅**将该 Source 明确关联的 Concepts 拼入 instructions，禁止全量倾倒 | 当前权限范围内的高频概念 |

**硬约束**：概念注入必须复用既有 ACL 语义。**token 不可见的 source，其概念一律不得进入 instructions**——否则 concepts 会成为绕过 `tableSelectors` 的权限泄漏通道。这与「catalog 源列表为空 / Meta 输出按 Effective Data Capabilities 过滤」是同一原则（见 `07-mcp-auth-proxy-spec.md` §工具表对 `kx_catalog` / `lucy_catalog` 的约束）。

#### 跨域概念的激活条件（v1.3 补充，采纳三轮评审意见）

「按权限裁剪 concepts」本身不足以避免语义断裂。**跨域概念的价值恰恰在于跨域消解，而裁剪会把它毁掉。** 三难困境：

设 token 仅有 `superstore` 权限，无 `kx_financial` 权限：

| 处置 | 后果 |
|---|---|
| 注入含 `kx_financial` 的完整消解规则 | **泄漏未授权源的存在**（回退到 v1.2 想堵的侧信道） |
| 只保留 `superstore` 一条 binding | 概念退化为普通字段别名，**跨域消解彻底失效**——而这正是概念字典存在的唯一理由 |
| 注入跨域规则但不授权 | Agent 可能据此规划跨域 join 或财报口径查询，**执行时被 ACL 拦截报错**，把配置问题误导成查询失败 |

**解法（按可见 binding 数分档）**：

| 条件 | 行为 |
|---|---|
| token 可见该 Concept 下 **≥2 个 binding source** | **完整热注入**：注入跨域消解规则、冲突优先级、各 binding 的口径差异 |
| token 仅可见 **1 个 binding source** | **降级为单表别名注入**：仅注入该 source 的 binding 定义，**屏蔽所有跨域对比描述、冲突规则与其他 binding 的存在** |
| token 可见 **0 个** | 不注入 |

**降级不是缺陷，是 fail-closed 语义在概念层的延伸**——与「无数据权限时 catalog 置空而非展示全量」完全同构（见 `07-mcp-auth-proxy-spec.md`：纯 Meta、无 DataPlane capability 时 catalog 源列表为空）。

**降级的副作用（v1.3 考虑，v1.4 裁定：接受，不做补偿）**：降级后 Agent 不知道存在口径歧义，可能直接用单域口径作答而不提示。

**曾提议的「中性歧义提示」经四轮评审后撤回。** 该提示（如「该指标在多口径下可能有不同定义」）看似折中，实则有害——LLM 读到「可能存在其他口径」后的典型防御性反应是：

1. 停止直接计算，反问用户「您指的是财务口径还是销售口径？」；或
2. 循环调用 `wiki_search` 试图枚举还有哪些口径。

但该 token 仅有单源权限，**追问后也调不出第二个源**——结果是 Agent 知道有歧义却既查不到、也无法消解，**平白打断用户的正常单域查询**，把一个本可正常完成的单域问题变成悬案。

**裁定：遵循完全隔离原则（Ignorance is Bliss）。** 单源场景下彻底降级为单表别名，**严禁注入任何暗示其他口径存在的表述**。当前可见口径即该 token 权限世界里的唯一真理；只有当且仅当 token 可见 ≥2 个源、真实歧义上下文存在时，才激活消解指引。**宁可牺牲准确性，不牺牲可用交互。**

> 注：此裁定与 §3 P0-2「无 DataPlane capability 时 catalog 置空而非展示全量」同构——**fail-closed 体现在「不提供信息」而非「提供半截信息」。**

**实施时须验证**：概念裁剪后的 instructions 长度是否有上限保护；裁剪结果与 `tableSelectors` 授权集合是否严格一致；**以及分档判定是否会在 token 权限变更（role 重编译）后及时重算**（可用既有 ACL 单测范式覆盖）。

**差异化落点**：概念层是 Fivetran 的通用机制；Lucy 的概念字典是**本企业跨数据域的具体歧义消解表**——通用引擎解不了「KX 的金额 ≠ Superstore 的收入」这种业务特定冲突，而后者才是客户真正付钱的理由。

---

### P1 用量反向驱动 context 清理

**现状**：Fivetran 用 warehouse usage 做**正向**发现。Lucy 可以做**反向**的，这个方向几乎无人做，且成本极低——审计 trace 里数据已经在了。

| 信号 | 判定 | 动作 |
|---|---|---|
| 声明了但 N 天零调用的 measure | 死 context | 标注或下线 |
| 被频繁调用但从未进 eval 的 measure | 高风险未覆盖 | 优先补 case |
| Wiki 文档改了但对应 measure 的 eval 未跑 | 门禁漏放 | 补跑或拦截 |

纯聚合查询，不新增运行时组件，直接接现有 SQLite audit。

---

## 4. 明确不该抄的 3 项

| Fivetran 的东西 | 决策 | 理由 |
|---|---|---|
| 连接器生态（Confluence / Notion / SharePoint / dbt / Power BI / Sigma / Jira / HubSpot / Gong / Intercom 等 19 类） | **不抄** | 量级不同，等于自建 SaaS 集成产品线。应转成「私有库 + 本地文档，不接 SaaS」的隐私合规卖点 |
| SaaS 配额模型（≤50 连接、10 万次/日、1000 次/时） | **不抄** | Lucy 是客户内网私有化部署，quota 是 SaaS 成本约束不是能力；抄了等于自设天花板 |
| 「约 1 天建成」的 build 时效承诺 | **不抄** | Lucy 的 overlay 是人工撰写，承诺时效就是承诺质量。Lucy 该卖「可验证、可回归」，不卖「快」 |

**另需警惕（技术路线风险，非功能借鉴）**：Agents Schema 已由 dbt-labs 开源并成为事实标准（https://github.com/dbt-labs/agents_schema）。若 Lucy 未来需要对接采用该标准的数据栈，自研 `lucy_*` 工具名与 `access.yaml` 语义将需要一层适配。建议评估「Lucy 能否反向导出符合 Agents Schema 的 `AGENTS` schema」——**这本身也是一项可防守的差异化能力**（让客户不被任何一家锁死）。此项本文仅记录，不列入 P0。

---

## 5. 落地顺序建议

| 顺序 | 项 | 依赖 | 风险 |
|---|---|---|---|
| 1 | 反馈回流 → eval（P0-1，L1 断言型 / L2 草稿型分层） | 无。**复用 `security-candidates.ts` 既有范式** | 低。不碰 ACL 语义 |
| 2 | Release BOM **v1**（P0-2，静态四项指标） | 与 1 并行。零运行时依赖 | 低。发布事件驱动 |
| 3 | 概念字典（P1，含运行时裁剪暴露） | 无，可与 1/2 并行 | 中。涉及 `semantic-layer/` schema 扩展 + 权限裁剪正确性 |
| 4 | 用量反向清理（P1） | 1、2 | 低。数据源已在 |
| 5 | Release BOM **v2**（追加频次与零调用指标） | 4 | 低。追加非重做 |

**时序冲突已消除**（v1.2）：v1.1 中 BOM 排在第 2 位却依赖第 4 位的聚合逻辑；现将 BOM 拆为 v1（第 2 位，零依赖）与 v2（第 5 位，依赖 P1），P0 不再依赖 P1。

前三项均不触碰运行时 ACL 判定语义、不新增数据面工具，风险可控。

**明确不建议现在碰的**：本体图引擎、自动 schema 发现、任何形式的多 SaaS 连接器——这三样是拿 Lucy 的短板去打 Fivetran 的长板。

---

## 6. 待决问题裁定（2026-10-14 Forrest 已裁定）

| # | 问题 | 裁定 | 依据 |
|---|---|---|---|
| 1 | 反馈判定主体 | **系统级异常自动抓取（L1/L2）＋ WebUI 审计追溯手动打标（L3）** | 客户经 MCP 接入第三方客户端，Lucy 无法控制前端点击事件；agent 自评噪声极大，不能作为质量基准 |
| 2 | 回流 case 准入 | **强制人工审阅确认** | 真实流量含敏感数据、歧义口径、幻觉 prompt；未经审阅直接入库会污染回归基线，反噬发布门禁 |
| 3 | 概念字典落位 | **必须进 `semantic-layer/`** | 概念消解是语义路由核心；置 `wiki/` 只能作弱提示，无法参与 `access.yaml` 编译与门禁自动化检查 |
| 4 | Agents Schema 兼容 | **P2 观察，但提前保留标准 Schema 导出接口** | dbt-labs Agents Schema 正成事实标准；提供 Export 可大幅降低「自研私有锁死」的销售阻力 |

裁定 1 已回写至 §3 P0-1 三层触发口径；裁定 3 已回写至 §3 P1 落位修正与 Schema 形态。

**新增技术前提（裁定后仍待确认）**：L1/L2 自动抓取依赖 Proxy 侧持久化审计。已核实 `webui/server/proxy/audit.ts` 的 access_log 表结构含 `outcome`（`ok`/`error`/`denied`/`budget_stop`）、`decision_reason`、`error_detail`、`failure_dimension`、`result_empty`、`lucy_turn_id`、`call_count`（`inferred_turns` 表）等字段，**L1 所需信号均已落库，可直接聚合；L2 需基于 turn 级数据新建聚合逻辑。** 若后续 Proxy 审计字段有变，须同步复核本节。

---

## 7. v1.1 评审修正记录

v1.0 经 Forrest 交叉评审，提出三条反对意见，全部采纳：

| 评审意见 | v1.0 原表述 | v1.1 处置 | 核实结果 |
|---|---|---|---|
| P0-1 轻视了「无 Chat 交互界面」下的信号获取难度 | 「问询结束时自动标记 ok/wrong/partial」 | 假设不成立，改为三层触发口径（L1 自动 / L2 可自动 / L3 必须人工） | **意见成立**。Lucy 是 MCP Server，宿主为第三方客户端，确实拿不到 UI 行为。L1/L2 所需字段经核实已在 `audit.ts` 落库 |
| P1 概念字典会沦为「第二份 Wiki」 | 「挂在 `semantic-layer/` 或 `wiki/` 均可」 | 表述有误，改为**必须进 `semantic-layer/`**，并给出强结构化 YAML Schema | **意见成立**。原表述会重蹈「散文被 LLM 忽略」的既有失败模式，等于没修复问题 |
| P0-2 大屏是私有化团队的沉重包袱 | 「给客户决策层看的大屏」 | 改为**随发布生成的 Release Bill of Materials** | **意见成立**。发布事件驱动与既有 `publish history` 对齐，不引入长期运维负担 |

**评审未反对且维持原判的部分**：不抄连接器生态 / SaaS 配额 / build 时效承诺；用量反向驱动 context 清理的 ROI 判断。

**评审遗留的一处未展开**：大屏形态收缩后，「未覆盖高频口径」「零调用口径」两项信号（源自 P1 用量反向清理）被并入 BOM 输出，但两者的计算仍依赖 §3 P1 的聚合逻辑。即 P0-2 与 P1 存在数据依赖，非完全独立。

**上条遗留已在 v1.2 消解**：见 §3 P0-2「交付分期」与 §5 顺序表。

---

## 7.2 v1.2 二轮评审修正记录（2026-10-14）

v1.1 经 Forrest 二轮评审，提出三条技术盲区，全部采纳。其中第 1 条的结论成立但**成因描述需修正**——真实情况优于 v1.1 的表述。

| 评审意见 | v1.1 缺口 | v1.2 处置 | 核实结果 |
|---|---|---|---|
| L2 候选 case 的「元数据缺失悖论」 | §3 流程图将 L1/L2 合并为「生成候选 case（携带 source/measure/filter/freshness/skill_version）」，但 L2 本质是 Agent 迷路，系统无从得知其意图 measure/filter | 拆为两条路径：L1 产出断言型候选；L2 仅产出 Intent Gap Draft，**必须经 L3 人工补全口径与断言后方可转正式用例** | **结论成立，成因描述需修正**。L1 天然有断言基础；L2 确实无断言。补充发现：L2 直接入库存入「无断言假回归用例」会稀释覆盖率分母，比没有更糟 |
| §5 时序与 BOM 指标来源冲突 | BOM 排第 2 位，但「零调用口径」「未覆盖高频口径」依赖第 4 位聚合逻辑，构成 P0 依赖 P1 | BOM 拆为 v1（静态四项，零运行时依赖）与 v2（频次类，依赖 P1） | **成立**。原排期确实自相矛盾 |
| 概念字典缺运行时暴露机制 | 只定义了落位与 Schema，未说明运行时如何交付 Agent；全量注入会挤占 prompt 窗口 | 补冷拉取（按需工具）＋ 热注入（按权限裁剪）双路径，并加权限泄漏硬约束 | **成立**。`buildRoleAwareInstructions()` 确为注入点，v1.1 遗漏此环 |

**核实中发现的额外利好（v1.1 未预见）**：`webui/server/eval/security-candidates.ts` 已完整实现「审计事件 → 候选 case → 人工审 → 晋升正式用例」范式，含候选/审阅分表、`formalCaseFor()` 断言构造、`buildPromotionPreview()` YAML 合并去重、`hasAcceptedReview()` 幂等保护。

> **该「利好」的边界已在 v1.3 修正**——见 §3 P0-1「成本评级修正」。流转框架可复用，**断言构造不可复用**。

---

## 7.3 v1.3 三轮评审修正记录（2026-10-14）

v1.2 经 Forrest 三轮评审，提出三条技术盲区，全部采纳。其中第 1 条**否决了 v1.2 自己的结论**。

| 评审意见 | v1.2 缺口 | v1.3 处置 | 核实结果 |
|---|---|---|---|
| 低估质量断言与安全断言的异构性 | v1.2 将 P0-1 成本下调为「低」，理由是复用 `security-candidates.ts` | **评级回退为「低到中」**，拆为「流转框架可复用（低）」+「断言构造新写（中）」 | **成立且比评审描述更严重**。`formalCaseFor()` 只产出一个二元 `text/denied` 断言；`ResultAssertion`（`cases.ts:22-30`）支持 4 种 value_type + 容差 + schema 校验 + key_columns，且需构造 `executable` 契约（`cases.ts:56-62`：required_measures / grain / required_columns / required_filters / reconciliation）。**安全断言是二元判定，质量断言是结构化契约，无法从审计日志自动推导。** |
| 跨域概念热注入的「简单裁剪」造成语义断裂 | v1.2 只写「按权限裁剪、禁止全量倾倒」，未考虑部分可见性 | 补三难困境分析 + 按可见 binding 数分档激活条件（≥2 完整注入 / 1 降级为别名 / 0 不注入） | **成立**。裁剪确实会毁掉跨域消解这一核心价值。v1.3 补充了降级副作用（Agent 不知歧义存在）与「无源名中性提示」这一待验证设计 |
| BOM 覆盖率分母歧义 | v1.2 示例「eval 覆盖 85%（127/149）」分母不明，可能给决策层虚假安全感 | 拆为**变更口径覆盖率**（分母＝本次变更 measure 数，门禁阈值判定）与**基线回归通过率**（分母＝存量 case 数，不参与放行判定） | **成立**。存量全绿不得掩盖新增未覆盖。覆盖侧数据已有（`expected_measures` / `executable.required_measures`），变更侧需新生成 measure 差分——这是 BOM v1 唯一新增工程量 |

**三轮评审共同指向的模式**：v1.0→v1.2 每次都在「假设运行时能力」上出错（假设能拿到 UI 反馈 → 假设能自动推断言 → 假设概念可简单裁剪）。**立 Spec 时应对所有「运行时自动可得」的假设逐条标注证据来源**，避免同类问题带入实现阶段。

## 7.4 v1.4 四轮评审修正记录（2026-10-14）

v1.3 经 Forrest 四轮评审，提出三条硬伤，全部采纳。其中第 1 条**是 v1.3 自身引入的逻辑漏洞**，且方向比「笔误」更糟。

| 评审意见 | v1.3 缺口 | v1.4 处置 | 核实结果 |
|---|---|---|---|
| §8.1 第 2 条覆盖率口径笔误 | 写作「无断言 case 不得计入覆盖率**分母**」，实则应为其 measure 计为**未覆盖**且不得计入**分子** | 改为双重约束：关联无断言 case 的 measure 计为未覆盖（不入分子）＋ 无断言用例严禁晋升 ＋ **变更集合任何情况下不得剔除未覆盖项** | **成立且严重**。若剔除未覆盖项，分母变小、覆盖率被人为抬高——**本意是收紧门禁的条款，实际效果是给出一条作弊路径** |
| 单源中性歧义提示诱发「虚空探索」 | v1.3 建议降级时附中性提示以提示歧义存在 | **撤回该建议**，改为完全隔离原则（Ignorance is Bliss） | **成立**。token 仅单源权限时，追问后仍调不出第二源，Agent 知道歧义却无法消解，平白打断正常单域查询。宁可牺牲准确性，不牺牲可用交互 |
| Measure 差分须为语义 Diff 而非文本 Git Diff | v1.3 未明确差分方式 | 明确须 YAML AST 反序列化后比对业务语义值；严禁文本行级 diff | **成立**。缩进/注释/字段顺序变更会触发假变更淹没门禁。且已核实 `semantic-layer.ts` / `overlay.ts` / `project.ts` 均有现成 AST 能力，无需新依赖 |

**四轮评审的共同模式（§7.3 已记录，此处补充结论）**：v1.0～v1.3 的四次修正全部指向同一类错误——**在指标与约束的设计上引入「看似收紧、实则可被利用」的表述**（假设运行时可得 → 假设断言可自动推导 → 假设概念可简单裁剪 → 假设剔除分母项是收紧）。**立 Spec 时凡涉及分子分母、权限裁剪、降级行为的条款，须逐条做「反向利用测试」**：能否通过该条款本身的字面含义，让门禁更容易通过。

---

## 8. 立项准备度评估（v1.4）

| 维度 | 结论 |
|---|---|
| 战略定性 | 清晰。坚守私有部署、强权限裁决、质量门禁闭环，不与 Fivetran 卷 SaaS 生态与黑盒自动化 |
| 架构可行性 | 高。核心改动基于现有 SQLite Trace、Proxy 鉴权代理与 YAML 语义层（AST 能力已现成），无新增重量级依赖 |
| 成本可控性 | 中。流转框架复用度高，但质量断言引擎与人工补全界面为净新增工作量 |
| 开工准备度 | **v1.4 已修补全部已知断层，同意移出 `inbox/` 并在 `docs/specs/` 正式立项** |

### 8.1 立 Spec 时须写入的技术约束与验收准则

| # | 约束 | 验收方式 |
|---|---|---|
| 1 | L2 Intent Gap Draft **不得**绕过 L3 直接晋升为正式用例 | 强制路径测试：绕过则晋升失败 |
| 2 | 质量用例必须含 `executable` 契约。**关联无断言 case 的 measure 一律计为「未覆盖」（不得计入分子），且无断言用例严禁晋升入库。变更 measure 集合在任何情况下不得剔除未覆盖项——剔除即等于人为抬高覆盖率。** | 覆盖率计算单测：构造「变更 3 个 measure，其中 1 个只关联无断言 case」场景，须得 0/3 而非 1/2 |
| 3 | 跨域概念注入按可见 binding 数分档：≥2 完整、1 降级别名、0 不注入 | 三档各自的 ACL 单测 |
| 4 | 概念可见性严格 ⊆ `tableSelectors` 授权集合，不得成为侧信道 | 权限泄漏测试（含 instructions 内容断言） |
| 5 | 角色重编译后概念裁剪结果须同步重算 | role 变更后注入内容变化测试 |
| 6 | BOM 双覆盖率指标分母不同且不可互相抵消 | 存量全绿 + 新增未覆盖 → 门禁必须不通过 |
| 7 | BOM v1 须在无任何 trace 聚合能力的环境下可运行 | 降级环境集成测试 |
| 8 | 概念注入后 instructions 长度有上限保护 | 超限截断行为测试 |

**说明**：第 2 条经 v1.4 修正——原文「不得计入分母」是**方向性错误**（剔除分母反而抬高覆盖率），已改为「计为未覆盖、不入分子、且变更集合不得剔除」。若只验「有 case」而不验「有断言」，覆盖率会退化为 v1.2 试图避免的虚假安全感。

### 8.2 拆分立项方案（v1.4 新增）

按评审裁定，拆为三份独立 Spec，避免单文档跨三块导致评审面过大：

| Spec | 范围 | 关键前置 |
|---|---|---|
| `spec-p0-1-eval-feedback-loop.md` | 复用 `security-candidates.ts` 流转框架；L1 断言型 / L2 草稿型分层；质量 `executable` 契约人工补全 | 无 |
| `spec-p0-2-release-bom.md` | 语义 Diff 引擎（YAML AST → 语义哈希比对）；双覆盖率门禁；BOM v1 静态输出 | 建议后于 P0-1，变更集可复用其 case 资产 |
| `spec-p1-concept-dictionary.md` | YAML Schema；≥2 binding 跨域热注入门控；单源完全隔离降级 | 需先确认与既有 ACL 编译输入的边界 |

**建议顺序**：P0-1 → P0-2 → P1。三者无强耦合，可并行推进，但 P0-2 的覆盖率依赖 P0-1 产出的 case 覆盖数据。

---

## 9. 免责与复核

- 本文所有 Fivetran 事实来自 2026-10-13 当日抓取的官方文档页面，两页均处 Public Preview，官方明示能力范围与工具接口可能变更。**超过一个季度未复核即应视为过期。**
- 本文所有 Lucy 事实来自本仓已提交文档与代码检索，非运行时实测。凡涉及「已实现 / 未实现」的判断，一律以 `docs/governance/project-overview.md` §6.1 的自陈状态为准，不采信 README 的定位性表述。
- 本文是**竞品分析**文档，v1.5 起纳入 `docs/specs/` 版本控制，**保留为三份派生 Spec 的引用来源与评审历史**。**功能语义以三份派生 Spec 为准**；本文与派生 Spec 冲突时，以派生 Spec 为准。
- 本文结论经 Forrest 四轮交叉评审，每轮修正均记录于 §7 ～ §7.4，可追溯修订理由。