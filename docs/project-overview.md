# project-lucy 项目概览

| 元数据 | 内容 |
|---|---|
| 文档名称 | project-lucy 项目概览 |
| 文档类型 | Overview |
| 版本 | v1.8 |
| 撰写日期 | 2026-06-17；v1.1 更新 2026-06-21；v1.2 更新 2026-06-21；v1.3 更新 2026-06-21；v1.4 更新 2026-06-22；v1.5 更新 2026-06-24（澄清 Lucy 不直接回答问题的定位措辞）；v1.6 更新 2026-07-06（同步交付缺口、headless 边界、运行时 instructions 来源和本机配置治理）；v1.7 更新 2026-07-06（同步 data agent context compiler + governed MCP runtime 定位）；v1.8 更新 2026-07-27（新增 Agent Admin 企业级交付 spec 索引） |
| 适用范围 | 新成员 onboarding、模块索引、当前能力边界 |

project-lucy 是面向中小企业的 **data agent context compiler + governed MCP runtime**。它把数据库、BI、文档、人工口径编译成 Agent 可安全使用、可审计、可回归的数据服务；底座为 KTX 语义层、wiki、eval cases、skills、Lucy MCP Proxy 和 Lucy WebUI 治理工作台。

Lucy 自身不直接生成分析结论或回答问题；语义问答由 Claude Code / Codex / Hermes / Cursor 等 Agent 通过 Lucy 提供的受治理 MCP 能力完成。面向产品化交付，用户通过 Docker 部署 Lucy，接入数据库，维护客户 context package，并在 agents 平台配置 MCP endpoint/token 接入数据能力。该目标的验收合同见 `docs/lucy-platform-goal-checklist.md`。

Lucy 当前 context compiler 的四类资产：

| Context Pack | 当前承载 | 说明 |
|---|---|---|
| Semantic Pack | `semantic-layer/` | schema、grain、measures、segments、joins、source metadata |
| Knowledge Pack | `wiki/`、`skills/` | 业务口径、分析路径、领域坑点、reviewer checklist |
| Query Pack | `evals/`、审计 trace、后续 trusted query 资产 | 当前以 eval 和 trace 为基础；BI/dashboard trusted query ingestion 属后续增强 |
| Quality Pack | `evals/`、`.ktx-ui/audit.sqlite`、release gates | business eval、安全回归、MCP contract、审计和发布门禁 |

## 1. 双轨语境

| 文件 | 语境 | 说明 |
|---|---|---|
| Lucy MCP Proxy `initialize` instructions（来源 `webui/config/data-qa-instructions.md`） | 运行时 | 数据问答规则由 proxy 注入给 MCP client |
| `CLAUDE.md` | 开发/运行入口指引 | 只做入口引用，不承载数据问答规则正文 |
| `AGENTS.md` → `docs/DEVELOPMENT.md` | 开发态 | 代码、配置、spec 修改治理规则 |
| `inbox/` | 临时产物 | 一次性审计、过程报告、临时计划，可在进程结束后删除 |

开发规则不得写入 `CLAUDE.md` 或 `webui/config/data-qa-instructions.md`；数据问答规则只维护在 `webui/config/data-qa-instructions.md`，不复制到开发治理文档。

## 2. 当前数据域

| Domain | 主要用途 | 语义层 / 资产 |
|---|---|---|
| Superstore | 零售订单、折扣、利润、退货、区域经理分析 | `semantic-layer/mysql-aliyun/superstore_orders.yaml` · `skills/domains/superstore/*` · `wiki/global/superstore-analysis-playbook.md` · `evals/superstore/*` |
| KX Financial | 柯西公司财报金额、利润表、资产负债表、现金流分析 | `semantic-layer/mysql-aliyun/kx_fact_financial_amount.yaml` · `wiki/global/kx-financial-analysis-playbook.md` · `evals/kx_financial/*` |
| Data Agent POC | 广告收入、活跃、CEO 指标快照和受限财务表验证 | `semantic-layer/poc-mysql-aliyun/*` · `wiki/global/poc-*.md` · `evals/data_agent_poc/*` |

底层数据库以 Aliyun RDS MySQL 8.0.34 为主，当前正式连接 ID 为 `mysql-aliyun`，POC 连接 ID 为 `poc-mysql-aliyun`。

## 3. 核心目录

```text
project-lucy/
├── CLAUDE.md                         # 开发/运行入口指引，不承载数据问答规则正文
├── AGENTS.md                         # Agent 开发入口
├── ktx.yaml.example                  # 共享 KTX 配置模板；真实 ktx.yaml 为本机 ignored 文件
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

数据问答运行时遵循 Lucy MCP Proxy `initialize` 注入的 instructions，正文来源为 `webui/config/data-qa-instructions.md`：

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

### 6.1 交付状态快照（2026-07-06）

| 模块 / 能力 | 当前判断 | 交付含义 |
|---|---|---|
| Docker headless customer path | 达到当前交付预期 | 标准入口是 Docker Compose、配置文件、Lucy MCP Proxy、Agent MCP config、smoke/eval 证据 |
| WebUI 管理台 | 已实现内部治理能力，但非当前客户标准入口 | 代码和测试作为内部质量门禁；客户承诺需另补 UAT、用户文档和稳定性证据 |
| 数据库接入 | MySQL/PostgreSQL verified；StarRocks P1 gated；Oracle roadmap | StarRocks live certification 前不能写入 verified matrix |
| Semantic layer / Wiki 管理 | 编辑能力已实现，reindex 与 wiki_search 交付证据仍不足 | 不能把 WebUI 维护链路整体标记为 verified 治理闭环 |
| Skill management | 文件资产存在，Skill Editor / 版本化 / 自动加载闭环未开发 | 当前只能作为代码库治理资产，不是产品化 Skill 管理模块 |
| MCP endpoint lifecycle | Proxy、token、config 复制已实现；M18 起 endpoint 由 `LUCY_PUBLIC_MCP_URL` runtime 配置，WebUI 统一从 `GET /api/project.mcpEndpoint` 读取并展示；启停、状态、健康、轮换 UI 未开发 | 当前交付为“runtime-configured 接入配置”，不是完整 endpoint 生命周期管理 |
| Business eval | Catalog/smoke/WebUI run 基础已实现；完整 LLM/agent eval 未形成稳定证据 | 未达到自动质量门禁预期，需具备 agent/model secret 后补跑并归档 |
| Observability / alerting | R1 最小排障端点存在；通用 metrics、告警、日志聚合未开发 | 不属于当前 headless 交付承诺，后续需独立 spec |

## 7. Eval / Quiz 现状

| Domain | Eval YAML | Quiz HTML | 说明 |
|---|---|---|---|
| Superstore | `evals/superstore/eval/superstore-eval-cases.yaml` | `evals/superstore/superstore-quiz-cases.html` | 零售口径、反模式、多轮、路径选择等 |
| KX Financial | `evals/kx_financial/eval/kx_financial-eval-cases.yaml` | `evals/kx_financial/kx_financial-quiz-cases.html` | KX source 路由、财报视图、amount_type、NULL、join 等 |

新增或刷新 eval/quiz 必须遵循 `docs/eval-quiz-conventions.md`。

## 8. 访问治理现状

Lucy MCP Proxy 监听 `LUCY_PROXY_HOST:LUCY_PROXY_PORT`（默认容器内 `0.0.0.0:7879`），实际对外可访问的 endpoint 是部署方通过 `LUCY_PUBLIC_MCP_URL` 注入的 URL（详见 `docs/deployment-docker.md` §9 与 `docs/customer-deployment-guide.md` §1）。WebUI `/onboarding`、`/connections`、`/admin/agents` 与 Token 首秀页面统一从 `GET /api/project.mcpEndpoint` 读取该值用于展示与复制；前端不再根据浏览器 host、容器端口或 `localhost` 推断 endpoint。MCP proxy 用于：

- Bearer token → userId 映射。
- `tools/list` 过滤与 `kx_catalog` 注入。
- 工具级、connection 级、表级 ACL。
- SQLite audit 记录。

当前 `webui/config/access.yaml` 已含 v1.2 role 模型（例如 `kx_readonly`），Admin UI/API 已按 role-first 写入路径闭环：新建/编辑 Agent 强制 role，legacy `allow` 只读，token 与配置写入进入审计。2026-06-22 P1 增量已补 Role 模板库、模板展开落盘、`lint:spec` 防模板指针漂移、Onboarding MCP 失败原因细分和 `config_change_log` CSV 导出。后续列级 / 行级权限仅作为长期 spec 锚点，见 `docs/access-governance-design.md`。

2026-06-22 另验证了「VIEW-as-pseudo-table」变通方案（CIO demo）：role `superstore_region_huadong` 通过 VIEW `dataforai.superstore_orders_huadong` 把表级 ACL 锁定到单一区域，零代理层代码改动；细节与局限见 `docs/access-governance-design.md` §3.2。

## 9. 关键文档索引

| 主题 | 文档 |
|---|---|
| Lucy 产品定位与愿景 | `docs/vision.md` |
| Lucy context compiler / MCP runtime 产品化目标 | `docs/lucy-platform-goal-checklist.md` |
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
| WebUI 内置系统手册 / Help Center | `docs/design-system-handbook-help.md`、`docs/SYSTEM_HANDBOOK.md` |
| YAML 交付自助运维 / Agent 自检 | `webui/docs/24-yaml-delivery-runbook-spec.md`、`webui/docs/plans/wo-M20-yaml-delivery-runbook.md` |
| MCP Auth Proxy | `webui/docs/07-mcp-auth-proxy-spec.md` |
| Agent 权限设计 | `docs/design-agent-permissions.md` |
| 访问治理闭环设计 | `docs/access-governance-design.md` |
| Agent Admin 企业级交付 spec | `webui/docs/14-agent-admin-enterprise-delivery-spec.md` |
| Eval 设计 | `docs/design-eval-monitoring.md` |
| Eval Tool-Budget 设计 | `docs/design-eval-tool-budget.md` |
| Eval / Quiz 约定 | `docs/eval-quiz-conventions.md` |
| DB 接入设计 | `docs/design-db-connection.md` |
| Spec 审计与整改 | `inbox/spec-audit-2026-06-21.md`、`inbox/spec-remediation-plan-2026-06-21.md` |

## 10. 当前整改优先级

1. ✅ 2026-06-22 P0-1 Admin Role-First 已闭环；剩余长期 Policy 表达式锚点见 `docs/access-governance-design.md`。
2. ✅ `access.yaml` 等治理配置写入已补 dryRun、diff、输入校验与审计；`config_change_log` 支持 CSV 导出。真实 `ktx.yaml` 已改为本机 ignored 配置，仓库只提交 `ktx.yaml.example`。
3. ✅ 建立 spec 防漂移检查：route/status、API/spec、skill dependencies、eval schema、access role selector，并新增模板指针字段 fail 规则。
4. 补全当前 API / Model 索引，避免 `webui/docs/03-04` 与实现漂移。
5. ✅ P1 headless gates 已新增：`smoke:p1:context`、`smoke:p1:skills`、`smoke:p1:endpoint`、`smoke:p1:observability`、`e2e:agent`、`e2e:agent:local-hermes`、`smoke:p1:business-eval-full`、`smoke:p1:starrocks-certification`、`smoke:p1:release-readiness`。旧 `smoke:p1:agent-e2e*` 只保留为兼容入口。
6. 真实上线前仍需在具备 runtime/secret 的环境补齐 evidence：KTX/proxy runtime context、endpoint live token、observability live URL、完整 all-profile agent E2E、完整 agent eval、StarRocks live certification。本机 Hermes workhorse/moz 数据库到 agent E2E 已通过 `npm run e2e:agent:local-hermes`，机器证据落在 `inbox/p1-agent-e2e-hermes-moz-evidence.json`，人类报告落在 `inbox/p1-agent-e2e-hermes-moz-report.html`；token 每次运行临时生成且仅 hash 写入 ignored access config。
7. 明确 v1 后续范围：Skill Editor、复杂告警系统、Kubernetes/Helm 不在本轮 headless 达标范围；若进入产品承诺需另补 spec、UAT 和 release gate。
8. 访问治理 UI 的企业级交付优化已落 spec：列表页 MCP 配置交付、新建 Agent 权限透明度、Token 一次性首秀、详情页 sticky 保存和 Effective Permissions tree，见 `webui/docs/14-agent-admin-enterprise-delivery-spec.md`；执行工单见 `webui/docs/codex/wo-M11-agent-admin-enterprise-delivery.md`。
