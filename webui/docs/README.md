# KTX WebUI — 文档索引

本目录是 KTX Local WebUI 的**架构与规格交付物**（source of truth 仍是 `../README.md` 的产品 MVP 方案）。
文档按「先架构、后规格、再任务」的顺序组织，供后续实现（含 Mulan 特工队）直接消费。

| 文档 | 作用 | 读者 |
| --- | --- | --- |
| [01-architecture.md](01-architecture.md) | 系统架构、组件分解、关键决策(ADR)、安全模型 | 全员 |
| [02-arch-spec.md](02-arch-spec.md) | 模块契约、目录骨架、脚手架计划、测试策略 | 实现者 |
| [03-api-spec.md](03-api-spec.md) | REST API 契约（请求/响应/错误） | 前后端 |
| [04-data-model.md](04-data-model.md) | 内部数据模型 ↔ 真实 YAML 映射、完成度算法 | 实现者 |
| [05-task-list.md](05-task-list.md) | 里程碑任务拆分与验收标准 | 实现者 / 验收 |
| [06-navigation-ia.md](06-navigation-ia.md) | 导航与信息架构优化，明确语义层/业务文档/审阅校验的用户口径 | 产品 / 前端 |
| [07-mcp-auth-proxy-spec.md](07-mcp-auth-proxy-spec.md) | MCP Auth Proxy、访问日志、多用户权限与工具过滤 | 后端 / 安全 / 前端 |
| [08-mcp-audit-question-tracing-spec.md](08-mcp-audit-question-tracing-spec.md) | MCP 审计增强：数据源正规化、问题簇推断、可选自然语言问题上报 | 后端 / 前端 / 审计 |
| [09-lucy-r1-mcp-tool-contract.md](09-lucy-r1-mcp-tool-contract.md) | Lucy R1 `lucy_*` MCP 工具契约、错误 reason、返回 metadata 和 contract eval 要点 | 后端 / 安全 / Agent |
| [10-deployment-connection-ux-refresh.md](10-deployment-connection-ux-refresh.md) | 部署向导与连接概览体验升级：交付闭环、Metric Tooltip、连接卡片、Add Schema 抽屉 | 产品 / 前端 |
| [14-agent-admin-enterprise-delivery-spec.md](14-agent-admin-enterprise-delivery-spec.md) | 访问治理 Agent Admin 企业级交付体验：列表配置复制、新建权限透明度、Token 首秀、详情页保存与权限树 | 产品 / 前端 / 安全 |
| [15-role-admin-spec.md](15-role-admin-spec.md) | 访问治理 Role Admin：角色列表、新建/编辑/删除、template 复制、dryRun diff 与 Agent 入口联动 | 产品 / 前端 / 后端 / 安全 |
| [16-ingest-first-class-ux-spec.md](16-ingest-first-class-ux-spec.md) | 数据库接入 Ingest 一等功能化：连接级入口、Schema 扫描入口、白名单解耦、运行状态与诊断日志 | 产品 / 前端 / 后端 |
| [17-static-catalog-loading-spec.md](17-static-catalog-loading-spec.md) | 静态 Catalog 载入：核心数据管道零 LLM 依赖、废弃 WebUI CLI ingest、改用本地 YAML reload | 产品 / 前端 / 后端 |
| [18-minimax-console-style-extraction.md](18-minimax-console-style-extraction.md) | MiniMax 控制台样式提取：全局 token、后台密度、导航/卡片/按钮视觉规范 | 产品 / 前端 |
| [19-system-overview-runtime-monitoring-spec.md](19-system-overview-runtime-monitoring-spec.md) | 系统概览运行状态监控：将 `/onboarding` 从部署向导重构为上线后的 Runtime Dashboard | 产品 / 前端 |
| [20-metric-bar-contrast-spec.md](20-metric-bar-contrast-spec.md) | Metric 卡片与进度条低色域对比度修复：实体浅底、清晰边框与可见 track | 产品 / 前端 / Accessibility |
| [21-connection-catalog-upload-ux-spec.md](21-connection-catalog-upload-ux-spec.md) | 数据库接入 Catalog 上传体验：受控 YAML 上传、连接页 IA 收敛与静态目录刷新 | 产品 / 前端 / 后端 |
| [22-public-mcp-endpoint-runtime-config-spec.md](22-public-mcp-endpoint-runtime-config-spec.md) | Public MCP Endpoint runtime 配置：统一 WebUI 与 Agent config 中展示和复制的 MCP endpoint | 产品 / Runtime / 前端 / 后端 |
| [23-semantic-asset-publish-export-spec.md](23-semantic-asset-publish-export-spec.md) | 语义资产自助发布与安全导出：staging validate gate、PVC 写入、KTX reindex、secrets hard block | 产品 / 前端 / 后端 / 安全 |
| [24-yaml-delivery-runbook-spec.md](24-yaml-delivery-runbook-spec.md) | YAML 交付规范与自助运维手册：manifest/overlay/new source 分型、GO/NO-GO checklist、Agent 自检协议 | 产品 / 文档 / 运维 / Agent |
| [25-connection-module-terminology-ia-refresh-spec.md](25-connection-module-terminology-ia-refresh-spec.md) | 数据库接入模块术语与 IA 刷新：Connection 中心化、Schema / Manifest / Catalog 术语治理、连接卡片动作收敛 | 产品 / 前端 / 运维 |
| [26-database-connection-operations-runbook-spec.md](26-database-connection-operations-runbook-spec.md) | 数据库连接运维 Runbook：明确 WebUI 不新建物理连接，给出通用 `ktx.yaml` / secret / ACL / 验收路径 | 产品 / 文档 / 运维 / 安全 |
| [28-catalog-reload-result-ops-ux-spec.md](28-catalog-reload-result-ops-ux-spec.md) | 本地目录刷新结果运维体验：卡片内状态栏、Schema 资产列表优先、inline 缺失 Manifest 诊断与修复闭环 | 产品 / 前端 / 运维 |
| [29-connection-semantic-boundary-automation-spec.md](29-connection-semantic-boundary-automation-spec.md) | 数据库接入与语义层维护边界自动化：职责矩阵、asset kind、上传结构校验、IA boundary lint 与 Review checklist | 产品 / 前端 / 后端 / 运维 |
| [30-help-markdown-rendering-spec.md](30-help-markdown-rendering-spec.md) | Help Center Markdown 渲染修复：系统手册表格、深链、安全渲染与翻译防御 | 产品 / 前端 / 文档 / 安全 |
| [34-table-whitelist-catalog-reload-layout-stability-spec.md](34-table-whitelist-catalog-reload-layout-stability-spec.md) | 表白名单刷新反馈与布局稳定性：Toast 成功反馈、Schema 内缺失 Manifest 诊断、工具栏和行内操作降噪 | 产品 / 前端 |
| [40-lucy-webui-positioning-control-plane.md](40-lucy-webui-positioning-control-plane.md) | Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane：品牌区副标题、术语标准 v0.2、过期设计 spec 备注与测试断言 | 产品 / 前端 / 文档 |
| [41-system-overview-enterprise-ops-polish-spec.md](41-system-overview-enterprise-ops-polish-spec.md) | 系统概览企业级运维控制台 polish：canonical `/overview`、顶栏上下文、待处理事项治理、Metric-first 快照与 MCP 配置 Drawer | 产品 / UX / 前端 / Accessibility |
| [44-connection-overview-productization-spec.md](44-connection-overview-productization-spec.md) | 连接概览产品化改版 v0.2：移除冗余上下文、收敛卡片容器、刷新状态右移、Schema 表新增启用表数与术语降噪 | 产品 / UX / 前端 / Accessibility |
| [45-business-wiki-workbench-productization-spec.md](45-business-wiki-workbench-productization-spec.md) | 业务 Wiki 工作台产品化改版：顶栏收敛、语义实体降噪、专注编辑、Markdown 工具栏与模板选择 | 产品 / UX / 前端 / Accessibility |
| [46-eval-yaml-exchange-and-result-archive-spec.md](46-eval-yaml-exchange-and-result-archive-spec.md) | 质量评测 YAML 交换与可选结果归档：上传 / 下载 Eval YAML、本地 runner 运行、Result JSON 可选归档与 suite hash 防错配 | 产品 / UX / API / 数据契约 |
| [47-table-whitelist-productization-followup-spec.md](47-table-whitelist-productization-followup-spec.md) | 启用表范围产品化二轮修复：Header 降噪、工具区重组、状态文案、最小 YAML diff 与保存后刷新闭环 | 产品 / UX / API / 前端 |
| [48-catalog-and-table-semantic-workbench-productization-spec.md](48-catalog-and-table-semantic-workbench-productization-spec.md) | 表目录与表语义资产工作台产品化：`/catalog` canonical、Connection 筛选、表名降噪、导出/导入 YAML 主路径与变更摘要 | 产品 / UX / API / 前端 |
| [49-business-wiki-md-library-operations-spec.md](49-business-wiki-md-library-operations-spec.md) | 业务 Wiki Markdown 文档库化：默认首页、目录瘦身、下载 / 上传 Markdown、上传覆盖与在线编辑降级 | 产品 / UX / API / 前端 |

## 与原 README 的关键校正

架构阶段比对了 `semantic-layer/` 的**真实文件**，发现并修正了几处与原 MVP 方案的出入，详见
[01-architecture.md §8 与真实布局的对齐](01-architecture.md#8-与真实-semantic-layer-布局的对齐)：

1. 文件粒度是 **schema 文件**（`<conn>/_schema/<schema>.yaml` 内含多表），编辑单元「表」地址 = `connectionId + schema + table`。
2. YAML 编辑必须**就地补丁**（保留 `"on"` 引号、key 顺序、注释、未知字段）。
3. 人工描述写入独立作者桶（`human`），不覆盖 `ai`。
4. ADR-10 已探测：`grain / measures / segments` 写独立 overlay `semantic-layer/<conn>/<table>.yaml`；`role / visibility` 暂不落盘。

---
_架构设计 by Claude (architect) · 2026-06-15_
