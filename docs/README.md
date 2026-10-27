# docs/ 文档地图

> 本页是 `docs/` 的分类导航索引。自 2026-09-25 二级分类起，平铺文档已归入
> `governance/ design/ specs/ runbooks/ reviews/ uat/ webui/` 六个新子目录，
> 与既有 `access-control/ licensing/ plans/ qa/ ui-ux-feedback/ user-guide/` 并列。
> 客户交付向的子集另见 `docs/governance/product-docs-index.md`。

## 目录布局

| 子目录 | 内容 |
|---|---|
| `governance/` | 开发治理、项目总览、发布/版本/测试门禁、约定 |
| `releases/` | 发版台账：每个已发布产品版本一份机器可读记录（版本 → tag → 提交 → 交付物摘要 → 门禁执行与未执行原因） |
| `design/` | 未实现/在建功能的技术设计（`design-*.md` 及设计类文档） |
| `specs/` | 功能/交付的 spec、plan、contract、register（`lucy-*`、CEO 一眼报系列等） |
| `runbooks/` | 部署/运维 runbook、客户交付指南、管理与安全指南、SOP |
| `reviews/` | 已实现代码的审查报告 |
| `uat/` | 人工验收用例 |
| `webui/` | WebUI 功能地图 / 实现状态 / 模块指南（仓库级视角） |

根目录保留 4 个入口文件：`README.md`（本页）、`SYSTEM_HANDBOOK.md`（WebUI 内置系统手册源，`webui/server/help.ts` 运行时读取）、`agent-pipeline.md`（可选交付流水线）、`user-guide.md`（业务用户指南）。

## 1. 入口 / 治理（先看这里）→ `governance/`

| 文档 | 用途 |
|---|---|
| `governance/DEVELOPMENT.md` | 开发治理总纲：Plan Mode 强制场景、红线、Spec 落位与内容规格（重要功能伪代码）、术语合规 |
| `governance/project-overview.md` | 项目总览：onboarding、模块索引、当前能力边界（v1.4，持续更新） |
| `governance/vision.md` | Lucy 产品愿景 |
| `specs/lucy-platform-goal-checklist.md` | POC → 可部署 MCP 平台的产品化验收清单 |
| `governance/product-docs-index.md` | 客户交付文档子索引（admin/user/agent 接入/安全/排障指南） |
| `SYSTEM_HANDBOOK.md` | WebUI 内置系统手册 / Help Center 内容源（根目录保留，运行时被 `webui/server/help.ts` 按 `docs/SYSTEM_HANDBOOK.md` 读取） |
| `user-guide/lucy-architecture-diagram.html` | 产品架构总览全屏图（权威；`/help` §1.6 与 `/api/help/diagrams/lucy-architecture-diagram`） |
| `user-guide/lucy-docs-flows.html` | 摄取与服务流程全屏图（权威；`/help` §1.6 与 `/api/help/diagrams/lucy-docs-flows`） |
| `agent-pipeline.md` | Vibe coding 双核角色协作的可选完整交付流水线（按需启用） |

## 2. 设计（Design — 未实现/在建功能的技术方案）→ `design/` + `specs/`

| 文档 | 用途 |
|---|---|
| [specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md](specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) | **v0.25 P1-1，需求审查已签核通过；已实现未验收**（提交 `28780eae`）：L25-14 R1 静态行策略模板与 R3 独立只读反查；共享写入协调与同源诊断，RTP／RTV 全部未执行 |
| [specs/lucy-20261025-v0p25-access-authorization-summary-spec.md](specs/lucy-20261025-v0p25-access-authorization-summary-spec.md) | **v0.25 P1-2，需求审查已签核通过；已实现未验收**（提交 `28780eae`）：L25-01 Agent 与角色授权摘要、资源卡片、行边界和只读深链；ASV-01–14 全部未执行 |
| [../webui/docs/187-access-relation-sankey-spec.md](../webui/docs/187-access-relation-sankey-spec.md) | **v0.25 P1-3，需求审查已签核通过**：L25-08 授权／访问双层关系图、凭证清单与快照证据；SC-01–14 全部未执行 |
| [specs/lucy-20261025-v0p25-hive-direct-connection-spec.md](specs/lucy-20261025-v0p25-hive-direct-connection-spec.md) | **v0.25 P1-4，需求审查已签核通过；已实现未验收（仅编译侧）**（提交 `28780eae`）：HS2 直连、原版 KTX 只编译与 Lucy JDBC；V01–V17 全部未执行，支持状态 `planned` |
| [specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md](specs/lucy-20261025-v0p25-upgrade-e2e-automation-spec.md) | **v0.25 P1-5，需求审查已签核通过；已实现未验收、非门禁**（提交 `28780eae`）：三种 amd64 部署形态的真实旧版原地升级与恢复；UPG-01–16 全部未执行 |
| [specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md](specs/lucy-20261025-v0p25-upgrade-candidate-verification-spec.md) | **v0.25 P1-6，需求审查已签核通过；已实现未验收、非门禁**（提交 `28780eae`）：空卷整卷恢复与候选迁移验证；RVC-01–13 全部未执行，不是交付通道 |
| [specs/lucy-20261025-v0p25-skill-owner-spec.md](specs/lucy-20261025-v0p25-skill-owner-spec.md) | **v0.25 L25-04，P2，PM 签核通过、S1／S2 已实施**：业务 Skill 自由文本负责人及保存／审计增量，不改变授权；SKO-01–16 仍未执行；[实施记录](reviews/2026-10-26-lucy-v0.25-l25-04-skill-owner-implementation-record.md) |
| [specs/lucy-20261025-v0p25-smtp-notifications-spec.md](specs/lucy-20261025-v0p25-smtp-notifications-spec.md) | **v0.25 L25-05，P2 可选能力，PM 签核通过、S1 已实施并完成最终复审签核、S1.1 收口已实施**：默认关闭的部署侧 SMTP、审计账本健康提醒与测试邮件；**S2／S3 本轮实施，S4 不启动、SMTP-26 保持 blocked**；**不发信**；SMTP-01–26 正式验收全部未执行；[实施记录](reviews/2026-10-26-lucy-v0.25-l25-05-smtp-notifications-implementation-record.md) |
| [specs/lucy-20261022-v2p5-row-permission-management-spec.md](specs/lucy-20261022-v2p5-row-permission-management-spec.md) | **v0.25 P0-2，需求审查已签核通过；已实现未验收**（提交 `21de5168`）：L25-14 行权限管理；P0 仅 R2 最终行约束预览、R4 配置审计与 R5 字段诊断，R1 模板与 R3 反查视图归 P1；不改 Spec 99／100 运行时语义，V01–V22 全部未执行 |
| [specs/lucy-20261021-v2p5-help-center-spec.md](specs/lucy-20261021-v2p5-help-center-spec.md) | **设计交付，未实施**：v0.25 L25-12 系统手册帮助中心体验优化；手册三层 IA 派生、分类 / 文章 / 本页目录与归属化搜索 |
| [specs/lucy-20261027-v0p25-semantic-release-restore-spec.md](specs/lucy-20261027-v0p25-semantic-release-restore-spec.md) | **v0.25 L25-15，P0，设计完成待需求审查**：语义发布历史版本与整批恢复 Spec／Plan 经 Claude Code 三轮只读审查修订至 v0.4；批次前快照、双面 CAS／受控镜像删除、恢复生成新批次与固定保留，SRR-01–SRR-22 全部未执行，暂不开发 |
| [specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md](specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md) | **v0.25 P0-3，需求审查已签核通过；已实现未验收**（提交 `21de5168`）：L25-11 语义资产批量维护完整闭环；共享发布协调器覆盖角色保存等写入口，V01–V22 全部未执行，Wave 0b 未解锁保持 `blocked_delivery` |
| [specs/lucy-20261020-v2p5-audit-increment-spec.md](specs/lucy-20261020-v2p5-audit-increment-spec.md) | **v0.25 P0-1，需求审查已签核通过；已实现未验收**（提交 `21de5168`）：L25-09 审计运行时全量 S01–S08，保留 U1–U12 冻结合同；旧规范 R1–R10／R12 已完成文档同步，功能验收未执行 |
| [specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md](specs/lucy-20261024-v0p25-audit-reconciliation-view-spec.md) | **v0.25 P0-4，需求审查已签核通过；已实现未验收**（提交 `21de5168`）：L25-02／03 审计只读对账展示，统一表身份、轮次／调用／尝试、已知耗时、预算凭据及配置／活跃 Token 对账口径；不新增预算、配额或金额，V01–V12 全部未执行 |
| [specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md](specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md) | **设计交付，未实施**：审计可信度与管理员调查增量契约；取消近邻强制补绑、分离身份和归属质量、统一计数与导出范围；关联实施 Plan 和独立验收矩阵 |
| `specs/ceo-one-report-sow-product-risk-register.md` | CEO 一眼报 SOW 对照下的 Lucy 产品功能风险 register，聚焦 Eval/trace/context/reviewer/observability 等非数据主题能力 |
| `specs/ceo-one-report-sow-eval-uat-contract.md` | CEO 一眼报 SOW 可信 Eval/UAT contract，冻结 trace、scoring、context evidence、per-case artifact 与验收口径 |
| `specs/ceo-one-report-lucy-migration-delivery-plan.md` | CEO 一眼报从现有 finreport/BI 资产迁移到 Lucy/KTX 的端到端实施交付计划 |
| `specs/ceo-one-report-lucy-data-model-notes.md` | CEO 一眼报 MVP 源表/SQL 到 Lucy 专用服务层表的建模理解和 DDL 索取清单 |
| `specs/lucy-r1-controlled-data-service-plan.md` | Lucy R1 受控数据服务层底座方案与实施计划 |
| `runbooks/lucy-r1-release-runbook.md` | Lucy R1 发布检查、Doris/Hermes 证据、排障和回滚手册 |
| `specs/lucy-202608-reliable-delivery-upgrade-spec.md` | Lucy 202608 Enterprise Governance & Observability 升级蓝图：访问治理 Trace / Evidence、ACL policy decision trace、Admin 可观测、Security Eval、风险复核与发布证据包 |
| `specs/lucy-202608-upgrade-execution-control.md` | Lucy 202608 升级执行总控：spec / plan / task 状态、并行波次、minimax handoff、验证矩阵 |
| `access-control/integrity-p0-decision.md` | 企业完整性 P0 决策备忘：须承诺项（Trace/问询绑定/查询指纹/触达对账等）与已知限制；扩展而非替代 202608 工程 P0 |
| `specs/starrocks-r1-support-plan.md` | StarRocks R1 P1 gated support 边界、证据路径与发布限制 |
| **`access-control/`** | **访问权限域档案**（设计 / ADR / UAT / 本域 WO）；入口 [`access-control/README.md`](access-control/README.md)；现行基线 [`access-control/design-upgrade.md`](access-control/design-upgrade.md) v1.1.2 |
| `design/design-db-connection.md` | 数据库接入模块技术设计 |
| `design/design-eval-monitoring.md` | Module 2 Eval 配置与监控详细设计 |
| `design/design-eval-tool-budget.md` | Eval Tool-Budget 设计：把"少重复调用"做成可测回归约束 |
| `design/design-webui-ui-refresh.md` | WebUI UI Refresh 与工作台化改造 Spec |
| `design/design-lucy-agent-chat-a3.md` | 可选 Agent Chat（A3）：Open WebUI + Hermes API Server 旁路叠加 Lucy MCP；Lucy 独立交付、单租户验证；非默认 headless 交付 |
| `runbooks/runbook-lucy-agent-chat-a3.md` | A3 手工联调 / 排障 Runbook（compose profile `agent-chat`） |
| `design/access-governance-design.md` | **跳转桩** → `access-control/design-governance-baseline.md` |
| `design/design-semantic-platform-ontology-proposal.md` | ⚠️ **提案稿·挂起中** 语义平台本体化架构（四层架构 + 4 个 MCP 端点）。**与 2026-10-14 已裁定的「不建议现在碰本体图引擎」及 `concept-dictionary-spec` Non-goals 冲突，重新裁定前不得实施** |

## 3. 复核（Review — 已实现代码的审查报告）→ `reviews/`

| 文档 | 用途 |
|---|---|
| `reviews/review-module1-agent-permissions.md` | **跳转桩** → `access-control/review-agent-permissions-v1.md` |
| `reviews/review-module2-eval-monitoring.md` | Module 2 Eval 配置与监控代码审查 |
| `reviews/review-ktx-llm-switch-to-minimax.md` | KTX LLM Backend 切换 Claude Code → MiniMax 结论 |
| `reviews/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan-review.md` | **已作废**：v0.2 计划的评审过程稿，不得执行。结论已纳入计划 v0.3 |
| `reviews/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan-review-crosscheck.md` | **已作废**：上述评审的交叉验证过程稿，不得执行。结论已纳入计划 v0.3 |
| `reviews/2026-10-20-selectdb-hive-catalog-review.md` | SelectDB / Hive 外部 Catalog 与 Lucy 连接接入评审 |
| `reviews/2026-10-20-upgrade-feature-validation.md` | 升级功能测试验证与复核（14 项功能映射 + 19 条真实用例） |
| [reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md](reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md) | **已签核**：v0.25 六项 P1 的需求审查记录——逐项核对依据、四条实施前待办（F-01–F-04）与核验动作边界；全部 P1 验收仍未执行，不授权开发 |
| [reviews/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-review.md](reviews/2026-10-25-lucy-v0.25-e2e-mainline-and-branch-optimization-review.md) | **已签核（设计基线）**：v0.25 E2E 主线与旁线优化 Spec／Plan 已按 11 条认同项、11 条反对项及 10 条修订建议定稿。§9 终审复核：11 条反对项中 10 条完全关闭并实测核验，PM 两处数据更正均正确，**通过**；R-01（`lint:spec` 基线过期）已在 W0 开工前修正，R-02（`J25-01` 无 owner）已并入 W0-1 的 manifest schema。§9.7 W0 实施记录：编号／合同层已交付（覆盖清单 255+173+1、schema、读取器、28 例测试全绿、兼容映射、结果格式、证据盘点）；W0-01 记 `test:e2e-harness` 的 1 项既有失败（安全缺陷台账 15 条 `fixed` 缺 `verifiedBy`），待 PM 裁决。P0／P1 验收仍全部未执行 |
| [reviews/2026-10-25-lucy-v0.25-e2e-test-report.md](reviews/2026-10-25-lucy-v0.25-e2e-test-report.md) | **s2 测试报告**：v0.25 E2E 主线与旁线优化的重建与 UAT 证据。三栏分列——**实现完成 173/173、验收通过 0/173、客户交付通过 0**，不聚合。amd64 客户镜像本地构建过 G1–G4／G4b／G4c／G4d／G8（**未推送**，G‑06 未解锁）；compose 栈重建后 `p0-postgres-demo-smoke` **PASS**（真实 Postgres 查询 ＋ 越权 ACL 拒绝路径）；J25-01 浏览器腿 **J01-01 passed**、J01-02 因夹具 Schema 冲突 **failed**、J01-03…08 `not_run`；真实 Agent 腿因隔离边界缺模型 API 出口 **blocked**（`modelCalls=0`）。本轮修复三处缺陷：连接探测结构性丢弃密码（**产品行为错误**，已加红→绿回归测试）、隔离边界 `denyHome` 挡住客户端二进制、既有坏门禁 `p0-postgres-demo-smoke` 调用被 ACL 硬拒的上游工具名。三项待 PM 裁决：模型 API 出口、J01-02 Schema 冲突、安全台账 15 条 `fixed` 缺 `verifiedBy` |
| [reviews/2026-10-25-lucy-v0.25-e2e-implementation-record.md](reviews/2026-10-25-lucy-v0.25-e2e-implementation-record.md) | **s3 实施记录**：v0.25 E2E 优化的落地汇总——范围与授权、五条 track 的逐项交付物与验收证据（新增自动化 **206 例全绿**，173 个执行 id 恰好各实现一次）、门禁结果、本轮发现并修复的缺陷、**未完成与 blocked 清单**、遗留项与责任人、与设计基线的偏差说明、提交纪律与文件归属核对（纳入 54 个文件，**排除并发 agent 的 10 个 `webui/server/**` 文件**）。未对「客户交付通过」做任何声明 |
| [reviews/2026-10-24-lucy-v0.25-p0-final-decision.md](reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) | **已批准**：v0.25 首批四个 P0 的最终范围、Spec 收口决议、Wave 0b 交付链解锁责任与完整退出口径；不授权实现、部署或发布 |
| `reviews/2026-10-23-lucy-v2.0-release-readiness-review.md` | **已审阅**：v2.0 合流 main / 开 2.5 线的发版就绪度评审。D1（受保护 runner）裁定为 **B**：本期不 provisioning，死线为 2.5 首次客户交付前就位；D2（2.5 波次版本号）裁定为 **`2.10.0`**。§4.8–§4.20 记录 CI 恢复后暴露的**十一项**门禁缺陷的根因与修复（含 `docker-smoke` 挂死真根因、demo smoke 架构缺陷、WebUI 套件三类时序脆弱点、demo smoke 鉴权缺口） |
| `reviews/2026-10-24-lucy-v2.0-release-execution-record.md` | **已执行**：v2.0 发版列车阶段一至三的执行记录——11 项门禁修复的落地、PR #45 合流（merge commit `14a8bee`，禁 squash）、`main` 分支保护与 `v*` 标签保护下发、`v2.0.0` tag 与 GitHub Release、`lucy-v2.5` 开线，以及转入 2.5 线的 8 项未决事项（含 D3 待裁定、demo smoke 鉴权缺口） |

## 4. UAT（人工验收用例）→ `uat/`

| 文档 | 用途 |
|---|---|
| `uat/uat-agent-permissions.md` | **跳转桩** → `access-control/uat-agent-permissions-v1.md` |
| `uat/uat-module2-eval-monitoring.md` | Module 2 Eval 配置与监控人工 UAT 用例 |
| `uat/uat-mysql-aliyun-data-qa.md` | MySQL Aliyun 数据问答人工 UAT 用例 |
| `uat/uat-invest-db-data-qa.md` | invest-db 投研夹具的接入与问数 UAT |
| `uat/uat-mcp-session-regression.md` | MCP Session 回归 UAT：代理持有上游会话后的无会话标识取数验证 |
| `uat/uat-mcp-session-customer-verification.md` | 客户环境 MCP Session 修复取证与验收（可交付证明材料；配套 `runbooks/customer-mcp-session-400-upgrade.md`） |

## 5. WebUI 现状 → `webui/`

| 文档 | 用途 |
|---|---|
| `webui/webui-feature-map.md` | WebUI 功能地图 |
| `webui/webui-impl-status.md` | 模块实现状态（⚠️ `scripts/lint-spec.mjs` 据此做 stale-status 校验，CI gate 依赖） |
| `webui/webui-module-guide.md` | WebUI 模块使用说明 |
| `webui/webui-snapshot-product.md` | WebUI 产品快照（截图产物与 launchd 调度契约） |
| `ui-ux-feedback/` | 页面级 UI/UX 反馈台账，用于定向浏览器核查与修复验收 |

> WebUI 自身的架构/API/数据模型细节在 `webui/docs/01-architecture.md` … `07-mcp-auth-proxy-spec.md`（子模块就近 docs，已是编号有序的好范例）。

## 6. 客户 / 运维交付指南 → `runbooks/`

| 文档 | 用途 |
|---|---|
| `runbooks/admin-guide.md` | 部署、配置、运维、升级 |
| `user-guide.md` | 业务用户如何提受治理的数据问题 |
| `runbooks/agent-integration-guide.md` | MCP endpoint / bearer token / 客户端配置 |
| `runbooks/troubleshooting-guide.md` | 常见故障 + 升级排查包 |
| `runbooks/security-guide.md` | Token/ACL/审计/secrets/发布门禁（⚠️ `scripts/release/security-baseline.mjs` 依赖） |
| `runbooks/customer-deployment-guide.md` | 端到端客户部署与运维（⚠️ CI release-artifacts 文案引用） |
| `runbooks/deployment-docker.md` | Docker Compose 细节（⚠️ 同上） |
| `runbooks/customer-amd64-docker-deploy-runbook.md` | amd64 离线包客户部署 runbook（配套 `specs/lucy-customer-amd64-offline-delivery-spec.md`） |
| `runbooks/customer-mcp-session-400-upgrade.md` | 客户 MCP Session 400 的根因、版本对照、升级动作单与对外沟通稿（配套 `uat/uat-mcp-session-customer-verification.md`） |
| `runbooks/lucy-release-train-workflow.md` | 发版列车流程：分支模型、版本切线、合流与交付阶段、门禁矩阵、回滚 |
| `user-guide/`（目录） | 现有 HTML 帮助中心；`user-guide.md` 末尾已显式指向此目录，两者是同一主题的 Markdown 摘要 + HTML 详情，非命名冲突 |

## 7. 发布 / 版本 / 测试门禁 → `governance/`

| 文档 | 用途 |
|---|---|
| `governance/release-ci.md` | Release CI 与 KTX 升级 gate |
| `governance/version-matrix.md` | 支持的运行时与兼容性矩阵 |
| `releases/README.md` | **发版台账**：逐版本机器可读记录（版本 → tag → 提交 → 交付物 → 门禁执行情况与未执行原因）；判断客户是否在跑新版本以构建提交为准，不比较产品版本号 |
| `governance/database-support-matrix.md` | 数据库支持矩阵：各数据库类型的支持状态、判定证据、已知协议差异与更新规则（状态唯一真源） |
| `governance/test-layers-and-release-gates.md` | Runtime/platform/business eval gate 分层；索引 E2E 测试集 |
| `governance/lucy-test-cases.md` | 全链路 P0/P1/P2 测试用例矩阵（release-artifacts 打包清单依赖） |
| `qa/e2e-sop.md` | **E2E SOP 总指引**（测试集总表 + 选用决策） |
| `qa/suite-*.md` | E2E 分表：`WEBUI` / `ONBOARD-EVAL` / `AGENT` |
| `qa/README.md` | QA / E2E 目录地图 |

## 8. 约定（新增内容前必读）→ `governance/` + `runbooks/`

| 文档 | 用途 |
|---|---|
| `governance/eval-quiz-conventions.md` | eval YAML / quiz HTML 设计原则、命名约定（⚠️ `scripts/lint-spec.mjs` 依赖） |
| `runbooks/mysql-comment-maintenance.md` | `superstore_orders.discount`/`profit` 等字段 COMMENT 维护说明 |
| `runbooks/kx-security-guardrail-test-process.md` | KX Security Guardrail 测试流程 |

## 9. 仓库级执行计划 → `plans/`

| 文档 | 用途 |
|---|---|
| `plans/README.md` | 仓库级 plan 索引 |
| [plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md](plans/2026-10-27-lucy-v0.25-semantic-release-restore-implementation-plan.md) | **v0.25 L25-15，P0，设计完成待需求审查**：整批恢复 S0–S7 实施 Plan；全部阶段待后续授权，SRR-01–SRR-22 未执行 |
| [plans/2026-10-25-lucy-v0.25-e2e-implementation-plan.md](plans/2026-10-25-lucy-v0.25-e2e-implementation-plan.md) | **v0.25 E2E 优化实施计划**：三工作流（s1 开发＋Code Review＋Debug&优化 → s2 重建 Docker＋模拟用户 UAT＋输出测试报告 → s3 汇总＋交付审阅＋commit）、五条并行 track 的**文件所有权互斥**、与外部并发 agent 的隔离协议、证据边界与完成定义。落地结果见[实施记录](reviews/2026-10-25-lucy-v0.25-e2e-implementation-record.md)与[测试报告](reviews/2026-10-25-lucy-v0.25-e2e-test-report.md) |
| [plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md](plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) | **v0.25 P1 唯一需求签核入口**：六项 Spec、跨功能追踪矩阵、依赖、非门禁与全部验收未执行声明；2026-10-25 需求审查已签核通过（不授权开发），逐项依据见 [P1 需求审查记录](reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md) |
| `plans/2026-10-22-upgrade-candidate-verification-plan.md` | 升级候选验证环境实施方案 v0.2-spec-baseline（v0.25 L25-13，已收口 P1-6 Spec、需求审查已签核通过、非门禁；原地升级仍为客户现场主线） |
| `plans/2026-10-21-customer-20260828-v1-upgrade-package-plan.md` | 20260828-v1 客户升级包生成计划 v0.1（待确认；镜像、引导密钥、随包文档；验收前不交给客户） |
| `plans/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan.md` | 客户 20260828-v1 → Lucy 2.0 升级计划 v0.3（未执行；r6 不是放行包；评审过程稿已作废） |
| `plans/2026-10-12-acceptance-gap-closure.md` | 验收缺口修复：SC-15 / SC-19 / SC-20 / SC-23 接到查数路径，工单 WO-202610-15 |
| `plans/2026-10-11-customer-log-next-optimizations.md` | 客户日志优化最终版 v1.1；Spec 162 v0.3，WO-12 已验收 |
| `plans/2026-10-11-eval-module-functional-upgrade.md` | Eval 模块产品能力 v0.4；评审看 Spec 161 与工单 `webui/docs/plans/wo-202610-11-offline-eval-customer-ops.md` |
| `plans/2026-10-11-eval-result-policy-context-upgrade.md` | Eval 升级建议：结果 / 策略 / 解释分轴、上下文四臂、拒答与轨迹晋升（产品/架构，不含实现 WO） |
| `plans/2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md` | Eval 优化方案：准确率闭环 + Publish 变更触发 smoke 回归（产品/架构，不含实现 WO） |
| `plans/2026-08-03-lucy-enterprise-data-agent-access-governance-plan.md` | Lucy Enterprise Governance & Observability 三层实施计划，不包含 Dynamic RLS / CLS POC |
| `plans/wo-202608-06-governance-review-release-evidence.md` | 202608-GOV-06 MiniMax Code 交付提示词：风险复核候选项与发布证据包 |
