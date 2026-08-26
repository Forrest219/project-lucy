# docs/ 文档地图

> 本页是 `docs/` 全量文件的分类索引，不改变任何文件位置。按"先看哪类文档"分组，
> 而非按文件名字母序。客户交付向的子集另见 `docs/product-docs-index.md`。

## 1. 入口 / 治理（先看这里）

| 文档 | 用途 |
|---|---|
| `DEVELOPMENT.md` | 开发治理总纲：Plan Mode 强制场景、红线、Spec 落位与内容规格（重要功能伪代码）、术语合规 |
| `project-overview.md` | 项目总览：onboarding、模块索引、当前能力边界（v1.4，持续更新） |
| `vision.md` | Lucy 产品愿景 |
| `lucy-platform-goal-checklist.md` | POC → 可部署 MCP 平台的产品化验收清单 |
| `product-docs-index.md` | 客户交付文档子索引（admin/user/agent 接入/安全/排障指南） |

## 2. 设计（Design — 未实现/在建功能的技术方案）

| 文档 | 用途 |
|---|---|
| `ceo-one-report-sow-product-risk-register.md` | CEO 一眼报 SOW 对照下的 Lucy 产品功能风险 register，聚焦 Eval/trace/context/reviewer/observability 等非数据主题能力 |
| `ceo-one-report-sow-eval-uat-contract.md` | CEO 一眼报 SOW 可信 Eval/UAT contract，冻结 trace、scoring、context evidence、per-case artifact 与验收口径 |
| `ceo-one-report-lucy-migration-delivery-plan.md` | CEO 一眼报从现有 finreport/BI 资产迁移到 Lucy/KTX 的端到端实施交付计划 |
| `ceo-one-report-lucy-data-model-notes.md` | CEO 一眼报 MVP 源表/SQL 到 Lucy 专用服务层表的建模理解和 DDL 索取清单 |
| `lucy-r1-controlled-data-service-plan.md` | Lucy R1 受控数据服务层底座方案与实施计划 |
| `lucy-r1-release-runbook.md` | Lucy R1 发布检查、Doris/Hermes 证据、排障和回滚手册 |
| `lucy-202608-reliable-delivery-upgrade-spec.md` | Lucy 202608 Enterprise Governance & Observability 升级蓝图：访问治理 Trace / Evidence、ACL policy decision trace、Admin 可观测、Security Eval、风险复核与发布证据包 |
| `lucy-202608-upgrade-execution-control.md` | Lucy 202608 升级执行总控：spec / plan / task 状态、并行波次、minimax handoff、验证矩阵 |
| `access-control/integrity-p0-decision.md` | 企业完整性 P0 决策备忘：须承诺项（Trace/问询绑定/查询指纹/触达对账等）与已知限制；扩展而非替代 202608 工程 P0 |
| `starrocks-r1-support-plan.md` | StarRocks R1 P1 gated support 边界、证据路径与发布限制 |
| **`access-control/`** | **访问权限域档案**（设计 / ADR / UAT / 本域 WO）；入口 [`access-control/README.md`](access-control/README.md)；现行基线 [`access-control/design-upgrade.md`](access-control/design-upgrade.md) v1.1.2 |
| `design-db-connection.md` | 数据库接入模块技术设计 |
| `design-eval-monitoring.md` | Module 2 Eval 配置与监控详细设计 |
| `design-eval-tool-budget.md` | Eval Tool-Budget 设计：把"少重复调用"做成可测回归约束 |
| `design-webui-ui-refresh.md` | WebUI UI Refresh 与工作台化改造 Spec |
| `design-lucy-agent-chat-a3.md` | 可选 Agent Chat（A3）：Open WebUI + Hermes API Server 旁路叠加 Lucy MCP；Lucy 独立交付、单租户验证；非默认 headless 交付 |
| `runbook-lucy-agent-chat-a3.md` | A3 手工联调 / 排障 Runbook（compose profile `agent-chat`） |
| `access-governance-design.md` | **跳转桩** → `access-control/design-governance-baseline.md` |

## 3. 复核（Review — 已实现代码的审查报告）

| 文档 | 用途 |
|---|---|
| `review-module1-agent-permissions.md` | **跳转桩** → `access-control/review-agent-permissions-v1.md` |
| `review-module2-eval-monitoring.md` | Module 2 Eval 配置与监控代码审查 |
| `review-ktx-llm-switch-to-minimax.md` | KTX LLM Backend 切换 Claude Code → MiniMax 结论 |

## 4. UAT（人工验收用例）

| 文档 | 用途 |
|---|---|
| `uat-agent-permissions.md` | **跳转桩** → `access-control/uat-agent-permissions-v1.md` |
| `uat-module2-eval-monitoring.md` | Module 2 Eval 配置与监控人工 UAT 用例 |

## 5. WebUI 现状

| 文档 | 用途 |
|---|---|
| `webui-feature-map.md` | WebUI 功能地图 |
| `webui-impl-status.md` | 模块实现状态（⚠️ `scripts/lint-spec.mjs` 据此做 stale-status 校验，CI gate 依赖） |
| `webui-module-guide.md` | WebUI 模块使用说明 |
| `ui-ux-feedback/` | 页面级 UI/UX 反馈台账，用于定向浏览器核查与修复验收 |

> WebUI 自身的架构/API/数据模型细节在 `webui/docs/01-architecture.md` … `07-mcp-auth-proxy-spec.md`（子模块就近 docs，已是编号有序的好范例）。

## 6. 客户 / 运维交付指南

| 文档 | 用途 |
|---|---|
| `admin-guide.md` | 部署、配置、运维、升级 |
| `user-guide.md` | 业务用户如何提受治理的数据问题 |
| `agent-integration-guide.md` | MCP endpoint / bearer token / 客户端配置 |
| `troubleshooting-guide.md` | 常见故障 + 升级排查包 |
| `security-guide.md` | Token/ACL/审计/secrets/发布门禁（⚠️ `scripts/security-baseline.mjs` 依赖） |
| `customer-deployment-guide.md` | 端到端客户部署与运维（⚠️ CI release-artifacts 文案引用） |
| `deployment-docker.md` | Docker Compose 细节（⚠️ 同上） |
| `user-guide/`（目录） | 现有 HTML 帮助中心；`user-guide.md` 末尾已显式指向此目录，两者是同一主题的 Markdown 摘要 + HTML 详情，非命名冲突 |

## 7. 发布 / 版本 / 测试门禁

| 文档 | 用途 |
|---|---|
| `release-ci.md` | Release CI 与 KTX 升级 gate |
| `version-matrix.md` | 支持的运行时与兼容性矩阵 |
| `test-layers-and-release-gates.md` | Runtime/platform/business eval gate 分层；索引 E2E 测试集 |
| `qa/e2e-sop.md` | **E2E SOP 总指引**（测试集总表 + 选用决策） |
| `qa/suite-*.md` | E2E 分表：`WEBUI` / `ONBOARD-EVAL` / `AGENT` |
| `qa/README.md` | QA / E2E 目录地图 |

## 8. 约定（新增内容前必读）

| 文档 | 用途 |
|---|---|
| `eval-quiz-conventions.md` | eval YAML / quiz HTML 设计原则、命名约定（⚠️ `scripts/lint-spec.mjs` 依赖） |
| `mysql-comment-maintenance.md` | `superstore_orders.discount`/`profit` 等字段 COMMENT 维护说明 |
| `kx-security-guardrail-test-process.md` | KX Security Guardrail 测试流程 |

## 9. 仓库级执行计划

| 文档 | 用途 |
|---|---|
| `plans/README.md` | 仓库级 plan 索引 |
| `plans/2026-08-26-eval-accuracy-closed-loop-and-change-triggered-regression.md` | Eval 优化方案：准确率闭环 + Publish 变更触发 smoke 回归（产品/架构，不含实现 WO） |
| `plans/2026-08-03-lucy-enterprise-data-agent-access-governance-plan.md` | Lucy Enterprise Governance & Observability 三层实施计划，不包含 Dynamic RLS / CLS POC |
| `plans/wo-202608-06-governance-review-release-evidence.md` | 202608-GOV-06 MiniMax Code 交付提示词：风险复核候选项与发布证据包 |
