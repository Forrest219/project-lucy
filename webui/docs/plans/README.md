# Codex 执行总纲 — KTX WebUI

本目录是交给 **codex** 执行开发的工单包。codex 按 **M0 → M5 串行**领取工单，每个里程碑产出一个可验收增量。
本文件是**全局约定 + 护栏 + 完成定义**，每个工单前都默认适用。

## 0. 作业环境（必读）

| 项 | 值 |
| --- | --- |
| 工作目录 | `/Users/forrest/Projects/project-lucy/webui`（**所有路径相对此**） |
| ktx 项目根 | `/Users/forrest/Projects/project-lucy`（webui 操作的目标项目） |
| Node | v24（实测 24.14） |
| 运行 | `npm run dev`（前 5173 / 后 5174） · 测试 `npm test`（vitest） |

> ⚠️ 用户的 `codex` 是 shell 函数会 `cd ~/Workspace`。codex 启动后**第一步必须确认 cwd 切到 `/Users/forrest/Projects/project-lucy/webui`** 再作业。

### 0.1 开工前置检查（每张工单通用，开工前跑一遍）

```bash
pwd                       # 必须 = /Users/forrest/Projects/project-lucy/webui
node -v                   # ≥ v20（本机 v24.14）
command -v ktx            # ktx 在 PATH（本机 /Users/forrest/.local/node-current/bin/ktx）
git -C /Users/forrest/Projects/project-lucy status --short   # 记录开工前的脏文件基线
```
- **联网**：仅 M0 的 `npm install` 需要联网一次；其余里程碑默认离线可跑。
- ktx 的调用参数与 schema 支持**已探测并记录**在 `../01-architecture.md §9`，开工只需按需做**一次 sanity 复验**，不要从零重新探测。
- 各工单末尾若有「本单特异前置」只列该单独有项（如某里程碑依赖前一里程碑产物）。

## 1. 必读设计文档（事实源，不要另起炉灶）

| 文档 | 内容 |
| --- | --- |
| `../README.md` | 产品 MVP 方案（= PRD，验收口径） |
| `../01-architecture.md` | 架构、组件边界、**10 条 ADR**、安全模型 |
| `../02-arch-spec.md` | 模块契约、目录骨架、脚手架计划、测试策略 |
| `../03-api-spec.md` | REST API 契约 + 统一错误 envelope |
| `../04-data-model.md` | 内部模型 ↔ 真实 YAML 映射、完成度算法 |
| `../05-task-list.md` | 里程碑任务与验收（本工单包据此细化） |

冲突时优先级：**ADR > arch-spec > api/data-model > task-list > README**。发现设计本身有问题，**停下来报告**，不要自行改设计。

## 2. 全局护栏（每个工单都适用，违反即不合格）

1. **写入只经 `fs-safe.ts`**。允许写 `semantic-layer/ wiki/ .ktx-ui/`；禁止 `.ktx/secrets/ raw-sources/ .git/`。任何模块禁止直接 `fs.writeFile`。
2. **YAML 就地补丁**（ADR-01）：`parseDocument → 改 CST 节点 → toString()`。**严禁** parse→JS对象→dump（会毁掉 `"on"` 引号、注释、key 顺序、未知键）。
3. **表地址 = `conn + schema + table`**（ADR-02），不是 `conn/source`。
4. **人工描述写 `descriptions.human`**，保留既有 `descriptions.ai`（ADR-03）。
5. **错误 envelope 必检**（ADR-09）：API 失败返回 `{ok:false,error}`；前端 `apiClient` 必须先判 `ok===false` 再用 `data`，**绝不**回退渲染空/假数据。
6. **仅绑 `127.0.0.1`**，无鉴权。`/api/project` 必须剥离 password 值。
7. **增量字段**按 ADR-10 分层：`grain/measures/segments` 写 `semantic-layer/<conn>/<table>.yaml` overlay；`role/visibility/tags` 暂不写正式 YAML。保存后用 `ktx sl validate <table> --connection-id <conn>` 校验。
8. **不碰 secrets**：不返回 `.ktx/secrets/**` 内容，不解析 `password: file:` 指向的文件。

## 3. 每个里程碑的「完成定义」(DoD)

一个里程碑算完成，须**全部**满足：
- [ ] 工单列出的交付文件均已创建/修改
- [ ] 相关单元测试存在且 `npm test` 全绿
- [ ] 涉及护栏的安全/round-trip 用例有覆盖
- [ ] 用**真实数据**（`dataforai` / `dataforai`）跑过冒烟，并在收尾说明里贴结果
- [ ] 不引入对后续里程碑的破坏；改动可被 `git diff` 清晰看到
- [ ] 收尾给出：改了哪些文件、怎么验证的、已知遗留

## 4. 串行交付节奏

M0 → M1 → M2 → M3 →（M4、M5 可并行）→ M6。M6 依赖 M3 已完成的 fs-safe `ALLOW_FILES` 通道与 ktx CLI 封装。**每个里程碑结束后停下来交回**给用户/协调者确认，再领下一张工单。不要一口气从 M0 冲到 M6。

## 5. 工单清单

| 工单 | 里程碑 | 主题 |
| --- | --- | --- |
| [wo-M0-scaffold.md](wo-M0-scaffold.md) | M0 | 脚手架 + fs-safe 安全基座 |
| [wo-M1-readonly-catalog.md](wo-M1-readonly-catalog.md) | M1 | 项目读取 + 只读目录/单表 |
| [wo-M2-table-editor-diff.md](wo-M2-table-editor-diff.md) | M2 | 就地补丁 + 单表编辑 + diff 预览 |
| [wo-M3-save-validate.md](wo-M3-save-validate.md) | M3 | 落盘写回 + ktx validate + Review 页 |
| [wo-M4-measures-segments-joins.md](wo-M4-measures-segments-joins.md) | M4 | measures/segments/joins + sidecar |
| [wo-M5-wiki.md](wo-M5-wiki.md) | M5 | Wiki 编辑器 |
| [wo-M6-schema-onboarding.md](wo-M6-schema-onboarding.md) | M6 | Schema Onboarding（给已有连接加 schema） |
| [wo-M7-deployment-connection-ux-refresh.md](wo-M7-deployment-connection-ux-refresh.md) | M7 | 部署向导与连接概览体验升级 |
| [wo-M11-agent-admin-enterprise-delivery.md](wo-M11-agent-admin-enterprise-delivery.md) | M11 | Agent Admin 企业级交付体验升级 |
| [wo-M12-role-admin.md](wo-M12-role-admin.md) | M12 | Role Admin 角色配置管理 |
| [wo-M13-ingest-first-class-ux.md](wo-M13-ingest-first-class-ux.md) | M13 | Ingest 一等功能化：连接/Schema/白名单入口与诊断闭环 |
| [wo-M16-system-overview-runtime-monitoring.md](wo-M16-system-overview-runtime-monitoring.md) | M16 | 系统概览运行状态监控：`/onboarding` 去向导化 |
| [wo-M19-semantic-asset-publish-export.md](wo-M19-semantic-asset-publish-export.md) | M19 | 语义资产自助发布与安全导出：上传 manifest/overlay、Validate Gate、reindex、secrets hard block |
| [wo-M20-yaml-delivery-runbook.md](wo-M20-yaml-delivery-runbook.md) | M20 | YAML 交付规范进入 Help Center：用途、规则、常见错误、交付 checklist 与 Agent 自检协议 |
| [wo-M21-connection-module-terminology-ia-refresh.md](wo-M21-connection-module-terminology-ia-refresh.md) | M21 | 数据库接入模块术语与 IA 刷新：Connection 中心化、Schema / Manifest / Catalog 术语治理 |
| [wo-M22-database-connection-operations-runbook.md](wo-M22-database-connection-operations-runbook.md) | M22 | 数据库连接运维 Runbook：通用新增连接边界、配置、ACL 与验收 |
| [wo-M24-catalog-reload-result-ops-ux.md](wo-M24-catalog-reload-result-ops-ux.md) | M24 | 本地目录刷新结果运维体验：卡片内状态栏、Schema 资产列表优先、inline 缺失 Manifest 诊断 |
| [wo-M25-connection-semantic-boundary-automation.md](wo-M25-connection-semantic-boundary-automation.md) | M25 | 数据库接入与语义层维护边界自动化：asset kind、上传校验、IA lint 与 Review checklist |
| [wo-M26-help-markdown-rendering.md](wo-M26-help-markdown-rendering.md) | M26 | Help Center Markdown 渲染修复：系统手册表格、安全渲染、深链与回归测试 |
| [wo-M31-table-whitelist-catalog-reload-layout-stability.md](wo-M31-table-whitelist-catalog-reload-layout-stability.md) | M31 | 表白名单刷新反馈与布局稳定性：Toast 成功反馈、Schema 内缺失 Manifest 诊断、工具栏和行内操作降噪 |
| [wo-M37-lucy-webui-positioning-control-plane.md](wo-M37-lucy-webui-positioning-control-plane.md) | M37 | Lucy WebUI 品牌定位升级到 Data Agent Ops Control Plane：品牌区副标题、术语标准 v0.2、过期设计 spec 备注与测试断言 |
| [wo-M39-system-overview-enterprise-ops-polish.md](wo-M39-system-overview-enterprise-ops-polish.md) | M39 | 系统概览企业级运维控制台 polish：`/overview` 主入口、顶栏上下文、待处理事项治理、Metric-first 快照与 MCP 配置 Drawer |
| [wo-M42-business-wiki-workbench-productization.md](wo-M42-business-wiki-workbench-productization.md) | M42 | 业务 Wiki 工作台产品化改版：顶栏收敛、语义实体降噪、专注编辑、Markdown 工具栏与模板选择 |
| [wo-M43-eval-yaml-exchange-and-result-archive.md](wo-M43-eval-yaml-exchange-and-result-archive.md) | M43 | 质量评测 Eval YAML 上传 / 下载、本地运行指引与可选结果归档 |
| [wo-M44-connection-overview-visual-simplification.md](wo-M44-connection-overview-visual-simplification.md) | M44 | 连接概览视觉收敛修复：移除工作目录、去双层方框、刷新状态右移、Schema 表新增启用表数与术语降噪 |
| [wo-M45-table-whitelist-productization-followup.md](wo-M45-table-whitelist-productization-followup.md) | M45 | 启用表范围产品化二轮修复：Header 降噪、工具区重组、状态文案、最小 YAML diff 与保存后刷新闭环 |
| [wo-M46-catalog-and-table-semantic-workbench-productization.md](wo-M46-catalog-and-table-semantic-workbench-productization.md) | M46 | 表目录与表语义资产工作台产品化：`/catalog`、Connection 筛选、单表导出 / 导入 YAML 主路径与变更摘要 |
| [wo-M47-business-wiki-md-library-operations.md](wo-M47-business-wiki-md-library-operations.md) | M47 | 业务 Wiki Markdown 文档库化：默认首页、目录瘦身、下载 / 上传 Markdown、上传覆盖与在线编辑降级 |
| [wo-M48-table-semantic-workbench-ui-ux-hardening.md](wo-M48-table-semantic-workbench-ui-ux-hardening.md) | M48 | 表语义资产工作台 UI/UX hardening：键盘焦点、候选关联按钮上下文、File Input 隐藏、状态常驻、真折叠控件、字段批量操作与 `/catalog` 细节打磨 |
| [wo-M49-table-semantic-workbench-ia-separation.md](wo-M49-table-semantic-workbench-ia-separation.md) | M49 | 表语义资产工作台 IA separation：当前语义资产左上锚点、语义内容与维护手段分离、Claude Code / Codex 辅助维护默认可见、删除待处理建议 |
| [wo-M50-business-wiki-directory-tree-and-density.md](wo-M50-business-wiki-directory-tree-and-density.md) | M50 | 业务 Wiki 目录树与密度修复：多级目录可发现、目录计数单位、目录级新建入口与默认首页留白收敛 |
| [wo-M51-business-wiki-empty-directory-resource.md](wo-M51-business-wiki-empty-directory-resource.md) | M51 | 业务 Wiki 空目录一等资源：空目录持久化、新建目录 / 新建文档拆分、目录 metadata API 与 `0 篇` 展示 |
| [wo-M52-table-semantic-workbench-command-density-refactor.md](wo-M52-table-semantic-workbench-command-density-refactor.md) | M52 | 表语义资产工作台命令减噪与结果优先重构：Header 收敛、命令唯一性、辅助维护降级、Inspector 纯反馈化与 Double Sidebar 移除 |
| [wo-M53-business-wiki-version-history-restore.md](wo-M53-business-wiki-version-history-restore.md) | M53 | 业务 Wiki 版本记录与恢复：最近 5 版 Markdown 快照、历史预览、恢复预检与指定版本恢复 |
| [wo-M54-table-semantic-workbench-online-editing-actionbar-version-history.md](wo-M54-table-semantic-workbench-online-editing-actionbar-version-history.md) | M54 | 表语义工作台在线编辑优先、统一动作区与 YAML 版本记录 |
| [wo-M55-agent-admin-usage-observability-and-role-discoverability.md](wo-M55-agent-admin-usage-observability-and-role-discoverability.md) | M55 | Agent Admin 使用观测与 role 可发现性：活跃 Token、近 7 天调用/拒绝、role 链接与 MCP 工具限制解释 |
| [wo-M56-business-wiki-directory-document-governance.md](wo-M56-business-wiki-directory-document-governance.md) | M56 | 业务 Wiki 目录与文档治理：顶层目录、目录删除、文档移动、下载作用域与上传覆盖预检清晰化 |
| [wo-M57-role-admin-ops-ux-clarification.md](wo-M57-role-admin-ops-ux-clarification.md) | M57 | Role Admin 运维心智澄清：正式 Role 优先、参考模板降噪、待修复与已停用语义分离 |
| [wo-M60-sidebar-brand-navigation-polish.md](wo-M60-sidebar-brand-navigation-polish.md) | M60 | 侧栏品牌与导航体验升级：品牌区、折叠菜单、active 状态和命令面板入口 |
| [wo-M61-sidebar-brand-navigation-followup.md](wo-M61-sidebar-brand-navigation-followup.md) | M61 | 侧栏品牌与导航二轮修正：Logo 返回、命令面板默认态、菜单字体体系和品牌名对齐 |
| [wo-M63-command-palette-result-context.md](wo-M63-command-palette-result-context.md) | M63 | 命令面板结果上下文升级：breadcrumb、页面说明、命中高亮与稳定排序 |
| [wo-M64-catalog-and-business-wiki-visual-clarity.md](wo-M64-catalog-and-business-wiki-visual-clarity.md) | M64 | Catalog 与业务 Wiki 视觉层级修复：表名字重、Wiki 首页精简、小三角移除与上传预检层级 |
| [wo-202608-01-trace-evidence-kernel.md](wo-202608-01-trace-evidence-kernel.md) | 202608-01 | Trace / Evidence Kernel：append-only event store、MCP Proxy 基础写入、自检脚本 |
| [wo-202608-GOV-02-admin-governance-observability-dashboard.md](wo-202608-GOV-02-admin-governance-observability-dashboard.md) | 202608-GOV-02 | Admin Governance Observability Dashboard：**仅补** `/api/admin/governance/*` 聚合 API + Dashboard UI + 测试；不要重做 Trace Detail / Risk Review / Release Package |
| [wo-202608-GOV-02a-admin-governance-usage-overview-dashboard.md](wo-202608-GOV-02a-admin-governance-usage-overview-dashboard.md) | 202608-GOV-02a | 治理概览 usage-first：8 KPI + Agent/Token 使用 + 最受访问表；对齐 `pl-page-stack` 布局；风险列表主屏下沉 |
| [wo-202608-02-static-lint-reindex-diagnosis.md](wo-202608-02-static-lint-reindex-diagnosis.md) | Deferred | Static Lint 与 Reindex 诊断：不属于 202608 Governance & Observability 主线 |
| [wo-202608-03-tiered-publish-gate.md](wo-202608-03-tiered-publish-gate.md) | 202608-GOV-03 | Tiered Access Governance Gate：Agent / Role / Token / access policy 分级门禁 |
| [wo-202608-04-safe-log-to-eval.md](wo-202608-04-safe-log-to-eval.md) | 202608-GOV-04 | Safe Log-to-Security-Eval：**P1 Active 缺口**，当前无实现文件，需新建 candidate pool / reviewer / promotion preview + 根目录 verifier |
| [wo-202608-05-fde-copilot-candidate.md](wo-202608-05-fde-copilot-candidate.md) | Deferred | FDE Copilot Candidate：不属于 202608 Governance & Observability 主线 |
| [wo-202608-06-table-semantic-workbench-density-and-joins-inline.md](wo-202608-06-table-semantic-workbench-density-and-joins-inline.md) | 202608-06 | 单表语义工作台密度与关联内联：按钮 secondary 统一、表描述三段式、行粒度多选、字段表密度、价值文案、关联 tab 内联（修正 UX-CATALOG-011） |
| [wo-202608-07-wiki-workbench-secondary-feedback-fixes.md](wo-202608-07-wiki-workbench-secondary-feedback-fixes.md) | 202608-07 | Wiki 工作台二轮反馈修复：目录树层级引导线 + 默认只展目录、新建文档跳转新建目录、正文标题去重、移动到目录弹窗精简、版本记录表格化与历史预览懒加载 |
| [wo-202608-08-role-admin-list-clarity-followup.md](wo-202608-08-role-admin-list-clarity-followup.md) | 202608-08 | Role Admin 列表清晰度二轮：待修复 KPI 只计正式 Role、Header/状态条降噪、使用中/未引用、卡片字段标签、基于此新建、configUpdatedAt |
| [wo-202608-09-role-admin-create-edit-usability.md](wo-202608-09-role-admin-create-edit-usability.md) | 202608-09 | Role Admin 新建/编辑可用性：Wave A 中文标签与 picker+受控回退；Wave B `sourceNames` + 连接/工具/表能力筛选 |
| [wo-202608-10-admin-usage-overview-ux-refinement.md](wo-202608-10-admin-usage-overview-ux-refinement.md) | 202608-10 | Admin 使用概况 UX：命名、窗口全局化、KPI 2×4、表统计并集 |
| [wo-202608-11-wiki-edit-workbench-layout-and-save-status.md](wo-202608-11-wiki-edit-workbench-layout-and-save-status.md) | 202608-11 | Wiki 编辑态布局与保存状态：dirty 状态、预览 grid、三列标题、去工具栏、保存预检文案 |
| [wo-202608-12-wiki-version-history-list-first-ux.md](wo-202608-12-wiki-version-history-list-first-ux.md) | 202608-12 | Wiki 版本记录列表优先：全宽业务化表格、当前行收敛、查看进全宽详情 |
| [wo-202608-13-wiki-read-layout-and-header-action-hierarchy.md](wo-202608-13-wiki-read-layout-and-header-action-hierarchy.md) | 202608-13 | Wiki 阅读态 layout + Header primary 层级 |
| [wo-202608-14-admin-usage-overview-table-grid-light-conformance.md](wo-202608-14-admin-usage-overview-table-grid-light-conformance.md) | 202608-14 | Admin 使用概况三表轻量 `pl-data-grid` 收敛（12px 密度、数量次级、弱操作链；不做 connections colgroup） |
| [wo-202608-15-wiki-version-history-data-grid-alignment.md](wo-202608-15-wiki-version-history-data-grid-alignment.md) | 202608-15 | Wiki 版本记录表 pl-data-grid 对齐与当前行操作列留空 |
| [wo-202608-16-admin-usage-overview-activity-rank-and-header-polish.md](wo-202608-16-admin-usage-overview-activity-rank-and-header-polish.md) | 202608-16 | Admin 使用概况：调用排行 1×3 条形图、KPI 窗口进标题、Token `calls`、顶栏 segmented、删管理角色 |
| [wo-202608-17-publish-history-business-columns-and-export-clarity.md](wo-202608-17-publish-history-business-columns-and-export-clarity.md) | 202608-17 | 发布记录：序号/变更范围/规模、操作列去伪快照下载、Header 导出语义资产包、export ESM 修复、`pl-data-grid` |
| [wo-202608-18-admin-usage-overview-route-and-kpi-clarity.md](wo-202608-18-admin-usage-overview-route-and-kpi-clarity.md) | 202608-18 | Admin 使用概况：迁 `/admin/usage`、排行槽位高度、授权表、多数请求耗时 |
| [wo-202608-19-admin-usage-overview-stats-time.md](wo-202608-19-admin-usage-overview-stats-time.md) | 202608-19 | Admin 使用概况：顶栏「统计时间」徽标（24h/7d 左侧） |
| [wo-202608-20-agent-admin-list-ia-terminology-and-table-grid.md](wo-202608-20-agent-admin-list-ia-terminology-and-table-grid.md) | 202608-20 | `/admin/agents` 命名改 Agent、删 Header badges、KPI 对齐 usage、列表 `pl-data-grid` 表、去行内复制 MCP |
| [wo-202608-21-role-admin-list-and-detail-ia.md](wo-202608-21-role-admin-list-and-detail-ia.md) | 202608-21 | `/admin/roles` 静态 KPI + 描述对齐；Role 详情 Tab 拆分基本信息 / 权限配置 / 生效边界 |
| [wo-202608-22-admin-audit-turn-drilldown.md](wo-202608-22-admin-audit-turn-drilldown.md) | 202608-22 | `/admin/audit` 问询记录 + 调用流水双 Tab、起止时间、Drawer 明细、P95 交叉验证、删 heatmap / KPI badge |
| [wo-202608-23-admin-config-audit-unified-scope.md](wo-202608-23-admin-config-audit-unified-scope.md) | 202608-23 | 配置审计范围一视同仁：`safeWrite` 统一写审计、语义/Wiki/评测/发布、`asset_kind` 筛选与深链 |
| [wo-202608-24-list-page-header-consistency.md](wo-202608-24-list-page-header-consistency.md) | 202608-24 | 列表/历史页 PageHeader 收敛：删纯计数 badges、标题对齐、评测容器、表编辑 backAction |
| [wo-202608-25-help-center-header-consistency.md](wo-202608-25-help-center-header-consistency.md) | 202608-25 | `/help` 页头一致性：统一 `PageHeader`、去重 breadcrumb 末项、返回动作语义对齐 |
| [wo-202608-27-admin-audit-clarity-and-drawer-ux.md](wo-202608-27-admin-audit-clarity-and-drawer-ux.md) | 202608-27 | `/admin/audit` 筛选/列名/Agent 展示、删列表 P95 句、Drawer 分区与连接字段 |

### 202608 Governance & Observability — 并行启动建议

- **GOV-02** 与 **GOV-04** 两份工单的文件边界互不重叠，可以并行启动两个 minimax：
  - GOV-02 只动 `webui/server/admin/governance-observability.ts` + `webui/src/pages/admin/**`；先交 server 五个聚合 API，再交 Dashboard UI。
  - GOV-04 只动 `webui/server/eval/security-candidates.ts` + `webui/src/pages/eval/**`；先交 candidate pool / reviewer / promotion preview，再交轻量 UI。
- 两个任务都**不做浏览器验证**，只跑各自工单内的 Vitest + 根目录 verifier + `lint:terminology` / `lint:ia-boundary`。
- 总控细节（v0.6、并行边界、文件 ownership、Verification Matrix）见 `docs/lucy-202608-upgrade-execution-control.md`。

## 6. 如何把工单喂给 codex

每张工单顶部都有「codex 直投 prompt」块，可整段贴给 codex。建议一次只投一个里程碑的工单，跑完验收再投下一个。

## 7. 独立工单（非 M0-M5 主线）

以下工单改动范围在 `webui/server/proxy/` 等独立模块，与 M0-M5 语义层编辑器主线互不冲突，可并行领取：

| 工单 | 主题 |
| --- | --- |
| [wo-proxy-instructions-injection.md](wo-proxy-instructions-injection.md) | Lucy MCP Proxy initialize instructions 注入（Task A）+ 本地仓库切换到走 proxy（Task B），两个 Task 串行 |

---
_工单包 by Claude (特工队协调者) · 2026-06-15_
