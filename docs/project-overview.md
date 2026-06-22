# project-lucy 项目概览

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy 项目概览 |
| 文档类型 | Overview |
| 版本 | v1.4 |
| 撰写日期 | 2026-06-17；v1.1 更新 2026-06-21；v1.2 更新 2026-06-21；v1.3 更新 2026-06-21；v1.4 更新 2026-06-22 |
| 适用范围 | 新成员 onboarding、模块索引、当前能力边界 |

project-lucy 是一个本地自服务数据分析 Agent 栈，底座为 KTX 语义层、wiki、eval cases、skills 和 Lucy WebUI 治理工作台。目标是在受控数据访问前提下，让 Claude Code / Codex 等 Agent 优先使用语义层和业务口径回答数据问题，并通过 eval/quiz 形成回归门禁。

面向产品化交付，Lucy 的目标形态是位于数据库和 agents 之间的 MCP 服务管理平台：用户通过 Docker 部署 Lucy，接入数据库，配置语义层，并在 agents 平台配置 MCP endpoint/token 接入数据能力。该目标的验收合同见 `docs/lucy-platform-goal-checklist.md`。

## 1. 双轨语境

| 文件 | 语境 | 说明 |
|---|---|---|
| `CLAUDE.md` | 运行时 | KTX 数据问答运行时 prompt，只放数据问答规则 |
| `AGENTS.md` → `docs/DEVELOPMENT.md` | 开发态 | 代码、配置、spec 修改治理规则 |
| `inbox/` | 临时产物 | 一次性审计、过程报告、临时计划，可在进程结束后删除 |

开发规则不得写入 `CLAUDE.md`；数据问答规则不得写入开发治理文档。

## 2. 当前数据域

| Domain | 主要用途 | 语义层 / 资产 |
|---|---|---|
| Superstore | 零售订单、折扣、利润、退货、区域经理分析 | `semantic-layer/mysql-aliyun/superstore_orders.yaml` · `skills/domains/superstore/*` · `wiki/global/superstore-analysis-playbook.md` · `evals/superstore/*` |
| KX Financial | 柯西公司财报金额、利润表、资产负债表、现金流分析 | `semantic-layer/mysql-aliyun/kx_fact_financial_amount.yaml` · `wiki/global/kx-financial-analysis-playbook.md` · `evals/kx_financial/*` |

底层数据库为 Aliyun RDS MySQL 8.0.34，当前连接 ID 为 `mysql-aliyun`，schema 为 `dataforai`。

## 3. 核心目录

```text
project-lucy/
├── CLAUDE.md                         # KTX 数据问答运行时上下文
├── AGENTS.md                         # Agent 开发入口
├── docs/                             # 仓库级治理、设计、review、UAT、用户文档
├── inbox/                            # 临时审计/计划/过程产物
├── semantic-layer/mysql-aliyun/       # KTX manifest + overlay
│   ├── _schema/dataforai.yaml         # KTX 扫描生成的物理结构 manifest
│   ├── superstore_orders.yaml         # Superstore overlay
│   └── kx_fact_financial_amount.yaml  # KX 财务事实表 overlay
├── skills/
│   ├── warehouse/                     # 顶层数据问答路由与指标规则
│   ├── reviewer/                      # 高风险回答审查清单
│   ├── domains/superstore/            # Superstore 领域 reference docs
│   └── analysis/                      # 折扣、利润拆解程序性参考
├── wiki/global/                       # 可被 KTX wiki 检索的业务口径文档
├── evals/
│   ├── superstore/                    # Superstore eval + quiz
│   └── kx_financial/                  # KX 财务 eval + quiz
├── webui/                             # Lucy WebUI 本地治理工作台
└── lucy-skills/                       # lucy-skills MCP server spec（当前以 spec 为主）
```

## 4. 运行时回答链

数据问答运行时遵循 `CLAUDE.md`：

1. 先查 KTX semantic layer：`sl_read` / `sl_query`。
2. 再查 KTX wiki / reference docs：`wiki_search`。
3. 语义层和 wiki 都不能覆盖时才允许 raw SQL fallback，并必须声明假设。
4. 财务指标、跨表 JOIN、领导汇报、因果分析触发 reviewer 检查。
5. 最终回答必须附 Provenance Footer。

## 5. 语义层现状

| Source | 类型 | 当前人工 overlay | 说明 |
|---|---|---|---|
| `superstore_orders` | 事实表 | grain、派生列、9 measures、3 segments、2 joins | Superstore 主事实源 |
| `kx_fact_financial_amount` | 事实表 | 表描述、grain、3 measures、多个 statement/amount segments | KX 财报金额主事实源 |
| `kx_dim_company` | 维表 | manifest 为主 | KX 公司维度 |
| `kx_dim_financial_item` | 维表 | manifest 为主 | KX 财报项目维度 |
| `kx_vw_balance_sheet_detail` | 视图 | manifest 为主 | 资产负债表明细 |
| `kx_vw_cash_flow_statement_detail` | 视图 | manifest 为主 | 现金流量表明细 |
| `kx_vw_income_statement_detail` | 视图 | manifest 为主 | 利润表明细 |

manifest / overlay 分层规则见 `docs/DEVELOPMENT.md`。人工维护的 grain、measures、segments、joins 应写入 overlay，不手改 `_schema/*.yaml`。

## 6. WebUI 模块现状

WebUI 是本地治理工作台，当前导航有 7 个一级模块：

| 模块 | 入口 | 状态 | 说明 |
|---|---|---|---|
| 部署向导 | `/onboarding` | 已实现 | 聚合客户上线主链路、MCP endpoint 和 agent 配置复制 |
| 数据库接入 | `/connections` | 已实现；安全契约待补强 | 连接概览、表白名单、连通测试、ingest |
| 语义层维护 | `/`、`/sources/:conn/:schema/:table`、`/joins/:conn/:schema/:table` | 已实现 | 表目录、表编辑、Join 管理 |
| 业务文档 | `/wiki` | 已实现 | Wiki frontmatter + Markdown 编辑 |
| 审阅与校验 | `/review` | 已实现 | `GET /api/diff`、`POST /api/validate-changed` |
| 质量评测 | `/eval/cases`、`/eval/runs`、`/eval/monitor` | 已实现 | Case 管理、运行历史、趋势监控 |
| 访问治理 | `/admin/agents`、`/admin/audit` | 已实现；role-first admin UI/API 已闭环，Role 模板库 P1 已落地 | Agent、Token、ACL、访问日志、配置审计 |

详细状态表见 `docs/webui-impl-status.md`。`webui/docs/codex/*` 是 M0-M5 执行历史归档，不代表当前全部模块范围。

## 7. Eval / Quiz 现状

| Domain | Eval YAML | Quiz HTML | 说明 |
|---|---|---|---|
| Superstore | `evals/superstore/eval/superstore-eval-cases.yaml` | `evals/superstore/superstore-quiz-cases.html` | 零售口径、反模式、多轮、路径选择等 |
| KX Financial | `evals/kx_financial/eval/kx_financial-eval-cases.yaml` | `evals/kx_financial/kx_financial-quiz-cases.html` | KX source 路由、财报视图、amount_type、NULL、join 等 |

新增或刷新 eval/quiz 必须遵循 `docs/eval-quiz-conventions.md`。

## 8. 访问治理现状

Lucy MCP Proxy 运行在 `http://127.0.0.1:7879/mcp`，用于：

- Bearer token → userId 映射。
- `tools/list` 过滤与 `kx_catalog` 注入。
- 工具级、connection 级、表级 ACL。
- SQLite audit 记录。

当前 `webui/config/access.yaml` 已含 v1.2 role 模型（例如 `kx_readonly`），Admin UI/API 已按 role-first 写入路径闭环：新建/编辑 Agent 强制 role，legacy `allow` 只读，token 与配置写入进入审计。2026-06-22 P1 增量已补 Role 模板库、模板展开落盘、`lint:spec` 防模板指针漂移、Onboarding MCP 失败原因细分和 `config_change_log` CSV 导出。后续列级 / 行级权限仅作为长期 spec 锚点，见 `docs/access-governance-design.md`。

## 9. 关键文档索引

| 主题 | 文档 |
|---|---|
| Lucy MCP 平台产品化目标 | `docs/lucy-platform-goal-checklist.md` |
| Docker 部署 | `docs/deployment-docker.md` |
| 客户部署 / 运维手册 | `docs/customer-deployment-guide.md` |
| 版本矩阵 | `docs/version-matrix.md` |
| 测试分层与发布门禁 | `docs/test-layers-and-release-gates.md` |
| Release CI | `docs/release-ci.md` |
| Docker demo | `examples/docker-demo/README.md` |
| 产品文档索引 | `docs/product-docs-index.md` |
| 管理员指南 | `docs/admin-guide.md` |
| 用户指南 | `docs/user-guide.md` |
| Agent 接入指南 | `docs/agent-integration-guide.md` |
| 安全指南 | `docs/security-guide.md` |
| 排障指南 | `docs/troubleshooting-guide.md` |
| 开发治理 | `docs/DEVELOPMENT.md` |
| WebUI 当前状态 | `docs/webui-impl-status.md` |
| WebUI 模块使用 | `docs/webui-module-guide.md` |
| WebUI 基础架构 | `webui/docs/01-architecture.md`、`webui/docs/02-arch-spec.md`、`webui/docs/03-api-spec.md`、`webui/docs/04-data-model.md` |
| MCP Auth Proxy | `webui/docs/07-mcp-auth-proxy-spec.md` |
| Agent 权限设计 | `docs/design-agent-permissions.md` |
| 访问治理闭环设计 | `docs/access-governance-design.md` |
| Eval 设计 | `docs/design-eval-monitoring.md` |
| Eval Tool-Budget 设计 | `docs/design-eval-tool-budget.md` |
| Eval / Quiz 约定 | `docs/eval-quiz-conventions.md` |
| DB 接入设计 | `docs/design-db-connection.md` |
| Spec 审计与整改 | `inbox/spec-audit-2026-06-21.md`、`inbox/spec-remediation-plan-2026-06-21.md` |

## 10. 当前整改优先级

1. ✅ 2026-06-22 P0-1 Admin Role-First 已闭环；剩余长期 Policy 表达式锚点见 `docs/access-governance-design.md`。
2. ✅ `ktx.yaml` / `access.yaml` 等配置写入已补 dryRun、diff、输入校验与审计；`config_change_log` 支持 CSV 导出。
3. ✅ 建立 spec 防漂移检查：route/status、API/spec、skill dependencies、eval schema、access role selector，并新增模板指针字段 fail 规则。
4. 补全当前 API / Model 索引，避免 `webui/docs/03-04` 与实现漂移。
5. 在事实源稳定后补 semantic-layer、wiki、skills、domain index 的长期治理规范。
