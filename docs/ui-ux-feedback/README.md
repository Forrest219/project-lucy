# UI/UX Feedback Ledger

本目录用于长期记录 WebUI 页面级 UI/UX 反馈，作为后续浏览器核查、回归检查和修复验收的稳定事实源。

## 目录结构

```text
docs/ui-ux-feedback/
  README.md
  pages/
    admin-agents.md
    admin-audit.md
    catalog.md
    connections.md
    global-shell.md
    overview.md
    wiki.md
  assets/
    catalog/
    connections/
      UX-CONNECTIONS-001.png
    global-shell/
    wiki/
```

## 使用规则

- 每个页面维护一个文档，放在 `pages/` 下。
- 每条反馈使用稳定 ID：`UX-<PAGE>-NNN`，例如 `UX-CONNECTIONS-001`。
- 新反馈只追加，不覆盖历史；若问题复现，用同一个 ID 更新状态和补充证据。
- 每条反馈必须包含 `Status`、`Route`、`Feedback`、`Expected`、`Browser Check`。
- 修复代码后将 `Status` 更新为 `Fixed`；浏览器复核通过后再更新为 `Verified`。
- 截图放在 `assets/<page>/`，文件名尽量和反馈 ID 对齐。
- 浏览器检测应优先读取对应条目的 `Browser Check`，不要依赖聊天记录回忆。

## 页面索引

| Page | Route | Ledger |
|---|---|---|
| Catalog / Semantic Asset | `/catalog`, `/catalog/:conn/:schema/:table` | [`pages/catalog.md`](pages/catalog.md) |
| Connections | `/connections`, `/connections/enabled-tables` | [`pages/connections.md`](pages/connections.md) |
| Business Wiki | `/wiki` | [`pages/wiki.md`](pages/wiki.md) |
| Publish History | `/publish/history` | [`pages/publish-history.md`](pages/publish-history.md) |
| Quality Eval | `/eval/cases`, `/eval/runs`, `/eval/security-candidates` | [`pages/eval.md`](pages/eval.md) |
| Config Audit | `/admin/config-audit` | [`pages/admin-config-audit.md`](pages/admin-config-audit.md) |
| Help Center | `/help` | [`pages/help.md`](pages/help.md) |
| Agent Admin | `/admin/agents`, `/admin/roles` | [`pages/admin-agents.md`](pages/admin-agents.md) |
| Admin Governance / Usage Overview | `/admin/usage`（旧 `/admin/governance` redirect） | [`pages/admin-governance.md`](pages/admin-governance.md) |
| Admin Audit / Access Log | `/admin/audit` | [`pages/admin-audit.md`](pages/admin-audit.md) |
| Global Shell | all WebUI routes, including `/overview` | [`pages/global-shell.md`](pages/global-shell.md) |
| Overview | `/overview` | [`pages/overview.md`](pages/overview.md) |

## 最近维护记录

| Date | Scope | Update |
|---|---|---|
| 2026-08-05 | Agent Admin `/admin/agents` | Spec 98 / `wo-202608-31` 落地：`UX-ADMIN-AGENTS-037`～`039` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。KPI 顺序改为总数→活跃 Agent→活跃 Token→调用量；表列改为配置 Token→活跃 Token→调用量→创建→配置变更→最近访问；主列头「显示名/用户 ID」。跨页面主题新增 `kpi stock-then-adoption-then-volume`、`ops table column grouping`；延伸 `agent identity terminology`。验证：`agent-list.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Config Audit `/admin/config-audit` | Spec 97 / `wo-202608-30` 落地：`UX-ADMIN-CONFIG-AUDIT-007`～`008` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。删页头「访问日志」；CSV 与主表 7 列中文对齐；文件名精确到秒。跨页面主题新增 `header sibling nav redundancy`、`export-table field parity`、`export filename second precision`。验证：`admin-config-audit.test.tsx`、`admin-audit.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Config Audit `/admin/config-audit` | Spec 96 / `wo-202608-29` 落地：`UX-ADMIN-CONFIG-AUDIT-002`～`006` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。固定每页 20 行；`pl-data-grid`；中文业务列头与枚举；删 actorNotice；时间筛选 since/until + 快捷窗口 + 变更类型动态选项。验证：`admin-config-audit.test.tsx`、`admin-audit.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Audit `/admin/audit` | Spec 94 / `wo-202608-27` 落地：`UX-ADMIN-AUDIT-011`～`017` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。筛选改「Agent 名称或 ID」；来源筛选项业务化；删列表 P95 参照句；列改「工具调用数 / 涉及数据表」+ 序号；Agent 列 `名称 (id)`；Drawer 卡片分区 + 调用明细含「数据库连接」；头部关闭按钮对齐。验证：`admin-audit-turns.test.tsx`、`admin-audit.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Agent Admin `/admin/agents`, `/admin/agents/:id` | Spec 95 / `wo-202608-28` 落地：`UX-ADMIN-AGENTS-034`～`036` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。统一显示名/用户 ID 术语；筛选器 catalog 式 label + 删配置 Token 分层 + 结果计数；详情低风险一步保存、角色变更 Modal 确认 diff。验证：`agent-list.test.tsx`、`agent-detail.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Agent Admin `/admin/agents` | Spec 93 / `wo-202608-26` 落地：`UX-ADMIN-AGENTS-031`～`033` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。KPI 从拒绝导向切换为稳定性/使用率导向（总数、调用量、活跃 Agent、活跃 Token）；明细表新增 `创建日期`、`配置最后变更时间` 并按运维价值重排；筛选条升级为 `搜索 + 状态 + 角色 + 近 7 天活跃`（Token 分层已由 Spec 95 移除）。验证：`agent-list.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Help Center `/help` | Spec 92 / `wo-202608-25` 落地：`UX-HELP-001`～`003` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。`HelpCenter` 页头改为统一 `PageHeader`；breadcrumbs 收敛为单项「系统帮助」；右上动作改「返回系统概览」并指向 `/overview`。验证：`help-center.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Help Center `/help` | 纳入本轮统一性检查：新增 `pages/help.md` 条目 `UX-HELP-001`～`003`（状态 `Open`，本轮不做浏览器验证）。结论：无“共 N 条”计数冗余，但存在页头实现路径不统一（手写 header）、面包屑末项与 H1 重复、返回动作语义与落点不一致。 |
| 2026-08-05 | List pages cross-cutting | Spec 91 / `wo-202608-24` 落地：`UX-PUBLISH-HISTORY-006`～`007`、`UX-EVAL-001`～`003`、`UX-ADMIN-CONFIG-AUDIT-001`、`UX-CATALOG-027` → `Fixed`；`UX-HELP-001` → `Open`（本轮不做浏览器验证）。删 PageHeader 纯计数 badges；发布记录 H1 对齐侧栏；配置审计导出改 secondary；评测模块 `pl-page-stack`；安全候选去 breadcrumbs + `pl-btn`；表编辑补 backAction；`/help` 纳入检查范围并登记长期跟踪。新建 `pages/eval.md`、`pages/admin-config-audit.md`、`pages/help.md`；跨页面主题新增 `list-page header count badge`。验证：`publish-history`、`admin-config-audit`、`eval-cases`、`security-eval-candidates`、`table-editor` tests、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Audit `/admin/audit` | Spec 89 / `wo-202608-22` 落地：`UX-ADMIN-AUDIT-001`～`010` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。默认「问询记录」Tab + Drawer；删 heatmap / 四 KPI / count badge；起止时间与 P95 参照；导出 CSV 改 primary 且仅 calls Tab。同步 `06-navigation-ia.md`、术语 §4.7。验证：`admin-audit-turns.test.tsx`、`audit.test.tsx`、`audit-sources-redirect.test.tsx`、`server/__tests__/admin-audit.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Agent Admin `/admin/roles`, `/admin/roles/new` | Spec 89 / `wo-202608-21` 落地：`UX-ADMIN-AGENTS-027`～`030` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。列表描述去 `access.yaml`；KPI 改静态四卡（含解析异常、无 danger）；详情 Tab 拆基本信息/权限配置/生效边界；新建隐藏使用情况。验证：`role-list.test.tsx`、`role-detail.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Agent Admin `/admin/agents` | Spec 88 / `wo-202608-20` 落地：`UX-ADMIN-AGENTS-022`～`026` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。H1/侧栏改「Agent」；删 PageHeader count badges；KPI 对齐 usage；列表改 `pl-data-grid` 表；去行内复制 MCP。验证：`agent-list.test.tsx`、`navigation.test.ts`、`app-shell.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Governance `/admin/usage` | Spec 87 / `wo-202608-19` 落地：`UX-ADMIN-GOV-021` → `Fixed`（本轮不做浏览器验证）。PageHeader actions 在 24h/7d 左侧增加「统计时间」徽标（相对时间对齐系统概览）；术语 §4.5 登记 Stats Snapshot Time。验证：`admin-governance-observability.test.tsx`、`lint:terminology`。 |
| 2026-08-05 | Admin Governance `/admin/usage` | Spec 86 / `wo-202608-18` 落地：`UX-ADMIN-GOV-017`～`020` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。主路由迁 `/admin/usage`（旧 path redirect）；排行 Top-10 槽位高度；「配置表」→「授权表」；「响应上限（P95）」→「多数请求耗时」。同步术语 §4.5、`06-navigation-ia.md`。验证：`admin-governance-observability.test.tsx`、`navigation.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Publish History `/publish/history` | Spec 85 / `wo-202608-17` 落地：新建 `pages/publish-history.md`（`UX-PUBLISH-HISTORY-001`～`005`）→ `Fixed`（本轮不做浏览器验证，结束后只做 code review）。序号/变更范围/规模列；操作列去行内伪快照下载；Header「导出当前语义资产包 (.zip)」；export `require("yaml")` ESM 修复；`pl-data-grid` 轻量收敛。验证：`publish-history.test.tsx`、`api.semantic-asset-export.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Governance `/admin/governance` | Spec 84 / `wo-202608-16` 落地：`UX-ADMIN-GOV-010`～`016` → `Fixed`（本轮不做浏览器验证，结束后只做 code review）。KPI 窗口进标题；三块改为 1×3 调用排行条形图；Token API `calls`；顶栏 `pl-segmented-control`；删「管理角色」；页面索引补登记 `admin-governance.md`；术语 §4.5 同步。验证：`admin-governance-observability`（前后端）、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Governance `/admin/governance` | Spec 82 / `wo-202608-14` 落地：`UX-ADMIN-GOV-009` → `Fixed`（本轮不做浏览器验证）。三表轻量收敛 `pl-data-grid` + `pl-usage-overview-table`（12px 密度、数量 `tabular-nums`、弱 `pl-row-action-link`）；不搬 connections colgroup。验证：`admin-governance-observability.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Business Wiki `/wiki` 阅读态 | Spec 81 / `wo-202608-13` 落地：`UX-WIKI-036`～`037` → `Fixed`（本轮不做浏览器验证）。阅读区 `content-start` 防 grid 拉伸；`编辑` 为末位唯一 primary，`上传覆盖` 降为 ghost。同步跨页面主题 `css grid track stretch` 与治理规则。 |
| 2026-08-05 | Business Wiki `/wiki` 版本记录 | Spec 80 / `wo-202608-12` 落地：`UX-WIKI-031`～`035` → `Fixed`（本轮不做浏览器验证）。列表优先全宽表；变更说明业务化；当前行无查看/恢复；查看进全宽详情；截图 `assets/wiki/UX-WIKI-031-035-*`。验证：`wiki.test.tsx`、`lint:terminology`、`build`。 |
| 2026-08-05 | Business Wiki `/wiki` 编辑态 | Spec 79 / `wo-202608-11` 落地：`UX-WIKI-026`～`030` → `Fixed`（本轮不做浏览器验证）。dirty 驱动状态并入操作行；修复渲染预览 grid 拉伸；三列标题同基线；移除 Markdown 工具栏；「保存并发布」→「保存预检」。 |
| 2026-08-05 | Admin Governance `/admin/governance` | Spec 78 / `wo-202608-10` 落地：`UX-ADMIN-GOV-001`～`008` → `Fixed`（本轮不做浏览器验证）。页面/侧栏改「使用概况」；顶栏删窗口 badge 与「访问日志」；活跃 Agent/Token/表、调用量、P95、热门表全部随 `hours` 窗口；KPI 合并为 2×4（活跃卡含活跃率副行，新增配置表/活跃表，P95 替代平均响应时长）；`activeTableCount` 两源并集，`popularTables` 暴露 `tableStatsSource`；tokens 返回 `activeInWindow`（双发废弃 `activeInLast7d`）。同步 `00-product-terminology-standard.md` §4.5、`06-navigation-ia.md`。验证：`admin-governance-observability`（前后端）、`navigation.test.ts`、`lint:terminology`、`build`。 |
| 2026-08-05 | Admin Governance `/admin/governance` | 浏览器核查确认 8 条使用概况反馈属实，新建 `pages/admin-governance.md`（`UX-ADMIN-GOV-001`～`008`，状态 `Open`）；落盘 Spec 78 + `wo-202608-10`（修订 Spec 75 窗口/KPI/命名）；Spec 75 顶部增加交叉引用。 |
| 2026-08-05 | Ledger governance / Overview `/overview` | 补齐 Overview 文案与布局反馈遗漏的长期机制：1) 跨页面主题新增 `internal-term translation`（挂 `UX-OVERVIEW-010`）与 `header microcopy value density`（挂 `UX-OVERVIEW-009`）；2) 改写 PageHeader 规则为「状态反馈与触发动作默认同组同排」，纠正旧「优先把时间戳放到 description」指引与 `UX-OVERVIEW-004` 现实现冲突；3) 登记 2026-08-04 docker 重建后浏览器复核未通过事实（运行实例仍渲染旧文案，`004/009/010` 保持 `Fixed`，证据 `assets/overview/UX-OVERVIEW-009-010-verify-blocked-20260804.png`）。页面条目与代码修复此前已在 `427ab38`。 |
| 2026-08-04 | Agent Admin `/admin/roles`, `/admin/roles/new` | Spec 77 / `wo-202608-09` 落地：`UX-ADMIN-AGENTS-016`～`021` → `Fixed`（本轮不做浏览器验证）。Wave A：新建/编辑中文标签、picker+TagInput 受控回退、表范围匹配模式；Wave B：`sourceNames` 列表字段 + 连接/工具/表能力筛选。验证：`role-detail`/`role-list`/`admin-roles` Vitest、`lint:terminology`、`build`。 |
| 2026-08-04 | Connections `/connections`, Overview `/overview` | 用户确认 docker 已重建后执行并列按钮复核：`UX-CONNECTIONS-023` 与 `UX-OVERVIEW-008` 均未通过。`/connections` 中刷新动作仍为 `pl-btn--primary`；`/overview` 中 `复制 MCP 配置` 仍为 `pl-btn--primary`，与 host 源码统一 `secondary` 不一致。已在对应条目 Notes 补充 CDP class 证据；两条状态保持 `Fixed`，待部署产物与源码版本同步后再复核。 |
| 2026-08-04 | Catalog `/catalog/:conn/:schema/:table` | Spec 73 / wo-202608-06 落地 `UX-CATALOG-021`–`026`（状态 `Fixed`，本轮不做浏览器验证）：`校验` 统一 `secondary` + tooltip；表描述 DB/AI/Human 三段式；行粒度字段多选；字段改为 `pl-data-grid` 表密度；指标/分群补业务价值文案；关联内联进 tab 并修正 `UX-CATALOG-011`（首屏仍禁 banner，候选仅在关联 tab）。非浏览器验证：`table-editor.test.tsx` 28/28、`lint:terminology`、`build`。 |
| 2026-08-04 | Catalog `/catalog/:conn/:schema/:table` | 浏览器 + 代码双重核查单表编辑页 6 项新反馈，追加 `UX-CATALOG-021` 至 `UX-CATALOG-026`（均确认属实）：按钮语义不一致、表描述缺 AI、行粒度自由输入、字段卡片冗余、价值文案缺失、关联独立跳转；截图归档 `assets/catalog/`。 |
| 2026-08-04 | Agent Admin `/admin/roles` | Spec 76 / `wo-202608-08` 落地：`UX-ADMIN-AGENTS-009`～`015` → `Fixed`（本轮不做浏览器验证）。待修复/使用中/未引用 KPI+筛选强制 `source=yaml`；Header/状态条降噪；卡片字段标签；`基于此新建`；`configUpdatedAt` 复用 `readAccessYaml` 单次 mtime（Asia/Shanghai）；MetricCard `button`+a11y。验证：`role-list`/`role-detail`/`admin-roles` 61 passed、`lint:terminology`、`build`。 |
| 2026-08-04 | Agent Admin `/admin/roles` | 浏览器核查确认 7 条二轮反馈属实，追加 `UX-ADMIN-AGENTS-009`～`015`（状态 `Open`）：待修复 KPI 与默认列表脱节（实为模板 invalid）、Header 模板句冗余、Agent 主语 KPI/状态条冗余、卡片缺字段标签、badge 连读歧义、复制表意弱、缺配置时间。落盘 Spec 76 + `wo-202608-08`（修订 Spec 59 §7.1–7.5）。 |
| 2026-08-04 | Connections `/connections`, Overview `/overview` | 浏览器核查确认两处并列动作存在主次混用：`UX-CONNECTIONS-023`（`+ 添加 Schema` vs `刷新本地目录`）与 `UX-OVERVIEW-008`（`复制 MCP 配置` vs `查看配置`）。按同组同级原则修复为统一 `secondary`：`ConnectionOverview.tsx` 将 `CatalogReloadButton` `variant: primary -> secondary`，`Onboarding.tsx` 将 `复制 MCP 配置` `pl-btn--primary -> pl-btn--secondary`；同步更新 `connection-overview.test.tsx` 断言。两条状态更新为 `Fixed`，待下一轮浏览器复核升 `Verified`。 |
| 2026-08-04 | Overview `/overview` | M-Next-1 完成 `UX-OVERVIEW-003/004/005` host 源码修复，三条状态由 `Open` 升至 `Fixed`，待 docker rebuild 浏览器复核后升 `Verified`：`UX-OVERVIEW-003` 视觉徽标改 `aria-hidden="true"`，独立 sr-only `<span role="status" aria-live="polite">` 承载 announce（仅 mount / 刷新成功 / 刷新失败三个时机写入），解耦每秒 ticker 与屏幕阅读器噪音；`UX-OVERVIEW-004` 把 `上次更新` 徽标从 PageHeader `actions` 槽移到 `description` 内部右侧，actions 只剩 button，1280px 主流桌面视口 description 行数 ≤ 2；`UX-OVERVIEW-005` 新增 `consecutiveFailures` state + `failureLabel`（"刷新失败，重试中" / "连续 N 次未更新" / "连续 3 次以上未更新"）+ `badgeState`（1-2 次 `warning`、≥3 次 `danger`），并修复连带 bug：原 `if (error)` 早 return 在 refetch 失败时会把整页替换为 `<p className="pl-error">` wipe 掉 button + badge，新守门条件 `if (error && lastUpdatedAt === null)` 仅在首次加载失败时整页替换。`webui/src/__tests__/onboarding.test.tsx` 34/34 passed（含 3 条新增 / 翻转断言）。Docker rebuild 在 MacBook Pro M 系列 + Docker Desktop 上因 `ARG BUILDPLATFORM` 未被 buildx 注入暂时跑不起来，本轮跳本地 rebuild，源码 commit `67c86a2` 已落地、ledger 三条 `Fixed` 已 commit（见最近 commit），待用户在 x86_64 build host 或 CI 跑 `docker compose up --build` 后复核即可升至 `Verified`。 |
| 2026-08-04 | Overview `/overview`, Global Shell sidebar | Docker 重建后浏览器复核 `UX-OVERVIEW-001` 通过，状态保持 `Verified`；修正 Notes 反映实际 fix 路径（CSS 把 chip 视觉从 span 下放到容器 + span 清掉 chip 样式；JSX 把 `:` 包成 `aria-hidden` span 让 label/`: `/URL 三段同落一个 flex 子节点）。追加 `UX-OVERVIEW-006`：`Endpoint` 行 label / 冒号 / URL 视觉间距冗余，host 源码已 fix（`gap-x-0` + 冒号 span `mr-1`），标 `Fixed`，待 docker rebuild 升 `Verified`。追加 `UX-OVERVIEW-007`：1920×1080 视口下侧栏分组全展开时中段 nav 被截断、`访问治理` 整组不可见，标 `Open`，根因为 `.pl-sidebar { overflow: hidden }` + `<nav>` 缺 `flex-1 min-h-0 overflow-y-auto`。同步在跨页面治理规则追加 sidebar overflow 规则。 |
| 2026-08-04 | Overview `/overview`, Global Shell sidebar | `UX-OVERVIEW-006` 浏览器复核通过，DOM + CSS 编译产物验证 `Endpoint` 紧贴 `:`、`:` 与 URL 间 4px gap，状态 `Fixed → Verified`。`UX-OVERVIEW-007` host 源码 fix 落地：`.pl-nav` 加 `scrollbar-width: thin` + `scrollbar-color` + `::-webkit-scrollbar { width:6px }` 四条自定义滚动条规则，让 Chrome / Safari / Firefox 滚动条始终可见。DOM 滚动 effect `moved:true, deltaY:400`、CSS bundle 含 5 条新规则、22 行 nav 子菜单全部可达、screenshot 落盘 `UX-OVERVIEW-007-verified.jpg`，状态 `Open → Fixed → Verified`。跨页面治理规则同步追加"滚动条必须可见"子条目。注：macOS docker buildx `BUILDPLATFORM` 空字符串解析 bug 导致 image rebuild 失败，本轮通过 `docker cp` host `vite build` 产物覆盖容器 `webui/dist/` 做验证，源码改动未变；待 `docker buildx` 修复或下次 image rebuild 自动同步。 |
| 2026-08-04 | Catalog `/catalog`, Business Wiki `/wiki`, Global Shell | M64 浏览器复核后追加 4 条 page-level ledger：`UX-CATALOG-020`（thead 失去参照）、`UX-WIKI-017`（WikiTree 去三角后 affordance 偏弱）、`UX-WIKI-018`（首页目录数与 sidebar 空目录视觉冲突）、`UX-GLOBAL-SHELL-008`（help-center test 与 navigation drift，与 M64 无关）。状态均为 `Open`，P3，等候选 wave（M65 / M66 / 产品口径 / 跨工单清理）排期。 |
| 2026-08-04 | Ledger governance | 在 `跨页面主题索引` 新章节首次列出 7 条 Cross-Cutting Themes（font-weight / chevron affordance / hover discoverability / empty-state clarity / preflight IA / chip nesting / aria-live noise），便于 wave planning 定位重复面。配套 UI/UX 评估与建议报告写在 [`inbox/M64-browser-verification-and-ledger-followup.md`](../../inbox/M64-browser-verification-and-ledger-followup.md)。 |
| 2026-08-04 | Catalog `/catalog`, Business Wiki `/wiki` | Docker 重建后完成 M64 浏览器复核，`UX-CATALOG-019`、`UX-WIKI-014`、`UX-WIKI-015`、`UX-WIKI-016` 更新为 `Verified`：Catalog 表名链接字重降为正文级 `400`；Wiki 目录小三角移除且 row toggle 仍可点击；Wiki 首页只保留统计与 Markdown 文档列表；上传 Markdown 预检的目标路径、状态 badge 和解析摘要层级通过。同步补充表格链接字重、主体区不复刻侧栏树、展开控件不得使用装饰三角、预检目标 / 摘要分层治理规则。 |
| 2026-08-04 | Overview `/overview` | 在 UX-OVERVIEW-002 基础上追加 `UX-OVERVIEW-003` 至 `UX-OVERVIEW-005`：`UX-OVERVIEW-003` aria-live 每秒 ticker 对屏幕阅读器播报噪音（P2）；`UX-OVERVIEW-004` 按钮变宽挤压 PageHeader description 换行（P3）；`UX-OVERVIEW-005` 刷新失败时徽标静默，缺少 inline 失败指示（P2）。三条状态均为 `Open`，待选型后进入 M-Next 排期。 |
| 2026-08-04 | Overview `/overview` | 追加 `UX-OVERVIEW-002`：刷新按钮文案过于简约，缺少上次刷新时间戳。Docker 重建后浏览器复核通过，按钮文案 `刷新 → 刷新首页数据`，紧邻右侧新增 `上次更新：刚刚/xx 秒前/xx 分钟前/HH:MM:SS` 徽标，状态 `Verified`。已知次生风险（aria-live 每秒 ticker 噪音、按钮变宽挤压 description）暂不阻塞，列入后续评估。 |
| 2026-08-03 | Global Shell command palette | 追加 `UX-GLOBAL-SHELL-007`：命令面板结果缺少命中上下文和搜索解释力。已保存 Kaelio docs reference 与 Lucy current screenshots，状态 `Open`；同步落盘 `webui/docs/70-command-palette-result-context-spec.md` 与 `webui/docs/plans/wo-M63-command-palette-result-context.md`。 |
| 2026-08-03 | Global Shell all WebUI routes | 追加 `UX-GLOBAL-SHELL-006`：全局侧栏一级 / 二级缩进层级不足。已将二级列表调整为 inset rail，状态 `Fixed`，待 Docker 重建后浏览器复核。同步补充侧栏父子层级缩进治理规则。 |
| 2026-08-03 | Global Shell all WebUI routes | 根据全局侧栏与命令面板反馈新增 `pages/global-shell.md`，追加 `UX-GLOBAL-SHELL-001` 至 `UX-GLOBAL-SHELL-005`：品牌区回首页、命令面板空态、菜单字体节奏已通过 Docker 浏览器复核，状态 `Verified`；品牌两行实际字形长度未对齐与折叠菜单 focus ring 过重保留 `Open`。同步补充全局品牌、命令面板和侧栏导航治理规则。 |
| 2026-08-03 | Connections `/connections/enabled-tables`, Catalog `/catalog` | Docker `--no-cache` 重建后浏览器复核 `UX-CONNECTIONS-022` 通过，状态升至 `Verified`：启用表范围默认分组 `连接：demo-mysql · Schema：dataforai（共 3 张表）`，`openclaw_db` 缺失 Manifest 诊断块 heading `连接：demo-mysql · Schema：openclaw_db`，Schema 下拉与 `/connections` / `/catalog` 全部对齐全链路原始大小写。`UX-CATALOG-018` 此前已 `Verified`，跨页 companion 关系保留。 |
| 2026-08-03 | Overview `/overview` | 追加 `UX-OVERVIEW-001`：MCP 接入区 `Endpoint:` 被双重包裹（chip-in-chip）；直接修复（去掉 facts 行外层多余 wrapper span），docker 重建后浏览器复核通过，状态 `Verified`。同步新建 `pages/overview.md`、补"页面索引" Overview 行、在"跨页面治理规则"加一条：chip 容器类不得用裸后代选择器给所有 span 加 chip 样式，修复优先在 markup 层收口。 |
| 2026-08-02 | Catalog `/catalog/:conn/:schema/:table` | 根据单表语义维护页最新反馈修订 `UX-CATALOG-010`、`UX-CATALOG-013`、`UX-CATALOG-016`，追加 `UX-CATALOG-017`：YAML 导入导出不占主编辑流、状态与变更详情合并为常驻变更审阅、长页面字段编辑必须对象级说明变更。 |
| 2026-08-02 | Agent Admin `/admin/roles`, `/admin/roles/:roleId` | 根据 Role Admin UI/UX 反馈追加 `UX-ADMIN-AGENTS-005` 至 `UX-ADMIN-AGENTS-008`：Role 指标运维语义、筛选器业务口径、参考模板 / 待修复状态区分、模板创建心智降噪。M57 已落地并在 Docker 重建后完成浏览器复核，状态均为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成 M56 浏览器复核，`UX-WIKI-007`、`UX-WIKI-008`、`UX-WIKI-010` 至 `UX-WIKI-013` 更新为 `Verified`：顶层空目录、目录删除拦截、文档移动、下载作用域、上传创建 / 覆盖预检均通过。 |
| 2026-08-02 | Ledger governance | 根据 Agent Admin 反馈补充跨页面规则：对象关系指标必须说明统计口径；权限 / 能力数量必须绑定配置位置、允许范围和运行时生效边界。 |
| 2026-08-02 | Business Wiki `/wiki` | M56 follow-up 完成 code review 后修复 `UX-WIKI-008`、`UX-WIKI-010` 至 `UX-WIKI-013`，状态更新为 `Fixed`；本轮按用户要求只做非浏览器验证，待后续浏览器复核后再升级 `Verified`。 |
| 2026-08-02 | Agent Admin `/admin/agents`, `/admin/roles/demo_readonly` | Docker 重建后完成浏览器复核，`UX-ADMIN-AGENTS-001` 至 `UX-ADMIN-AGENTS-004` 更新为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后复核 `UX-WIKI-008` 至 `UX-WIKI-013`：`UX-WIKI-008` 专项检查仍失败并退回 `Open`；`UX-WIKI-010` 至 `UX-WIKI-012` 浏览器确认仍属实；`UX-WIKI-013` 完整上传流因当前浏览器 harness 无法设置本地文件，保留 `Open` 并标注待完整复核。 |
| 2026-08-02 | Agent Admin `/admin/agents` | 追加 `UX-ADMIN-AGENTS-001` 至 `UX-ADMIN-AGENTS-004`：usage-oriented metrics、role 可发现性、MCP 工具权限解释、demo smoke 文案清理。M55 已落地并完成 code review / 非浏览器验证，状态 `Fixed`，待浏览器复核。 |
| 2026-08-02 | Business Wiki `/wiki` | 根据用户后续反馈新增 `UX-WIKI-010` 至 `UX-WIKI-013`：目录删除、文档移动目录、下载作用域、上传目标可发现性 / 覆盖预检表达；状态均为 `Open`。同步修正 `UX-WIKI-008` 的 `Fixed` 备注表达。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成 M53 浏览器复核，`UX-WIKI-009` 更新为 `Verified`：版本记录、历史预览、恢复预检、确认恢复和新增恢复记录均通过。 |
| 2026-08-02 | Business Wiki `/wiki` | 追加 `UX-WIKI-009`：Markdown 覆盖 / 编辑缺少版本记录与恢复能力；已落地 M53 spec/plan 和实现，状态 `Fixed`，待浏览器复核。 |
| 2026-08-02 | Catalog `/catalog/:conn/:schema/:table` | Docker 重建后完成 M52 浏览器复核，`UX-CATALOG-005`、`UX-CATALOG-010`、`UX-CATALOG-012` 至 `UX-CATALOG-016` 更新为 `Verified`。 |
| 2026-08-02 | Catalog `/catalog/:conn/:schema/:table` | M52 修订 `UX-CATALOG-005`、`UX-CATALOG-010`、`UX-CATALOG-012`，追加 `UX-CATALOG-013` 至 `UX-CATALOG-016`；状态 `Fixed`，按用户要求仅做 code review / lint / test / build，待浏览器复核。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后复核 `UX-WIKI-007`：拆分动作、`global/<目录>` 空目录持久化、子目录和 scoped 新建文档通过；因顶层空目录预览与实际路径不一致，暂不升级 `Verified`，新增 `UX-WIKI-008` 为 `Open`。 |
| 2026-08-02 | Business Wiki `/wiki` | M51 已落地 `UX-WIKI-007`：新建目录 / 新建文档拆分，并支持空目录独立存在；状态更新为 `Fixed`，待后续浏览器复核后再升级 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | 初评曾决定暂不新增 `UX-WIKI-008`；后续浏览器复核发现顶层空目录路径不一致，已改为新增独立条目追踪。 |
| 2026-08-02 | Business Wiki `/wiki` | Docker 重建后完成浏览器复核，`UX-WIKI-001` 至 `UX-WIKI-006` 更新为 `Verified`。 |
| 2026-08-02 | Business Wiki `/wiki` | M50 将 `UX-WIKI-004`、`UX-WIKI-005`、`UX-WIKI-006` 更新为 `Fixed`；本轮按用户要求只做非浏览器验证与 code review，后续浏览器复核通过后再改为 `Verified`。 |

## 跨页面主题索引（Cross-Cutting Themes）

按主题聚合多次出现的横切 UI/UX 问题，方便 wave planning 时定位重复面。每行：主题名、影响 ledger、当前状态分布、负责 spec/plan。

| Theme | 影响 ledger | Status 分布 | Spec / Plan |
|---|---|---|---|
| `font-weight consistency`（链接 / toggle / sidebar 不应升级到 heading 级粗体） | UX-CATALOG-019、UX-WIKI-014 | 2 Verified | [wo-M64](../../webui/docs/plans/wo-M64-catalog-and-business-wiki-visual-clarity.md) |
| `chevron affordance`（可点 row 不得用装饰三角字符） | UX-WIKI-014（WikiTree 去三角）、UX-WIKI-017（去三角后需补 chevron svg） | 1 Verified + 1 Open | wo-M64 / 待 M65 |
| `hover discoverability`（去掉视觉 affordance 后必须补 cursor/hover bg/focus ring） | UX-WIKI-014、UX-WIKI-017 | 1 Verified + 1 Open | wo-M64 / 待 M65 |
| `empty-state clarity`（空目录 / 0 篇统计是否计入总数） | UX-WIKI-015、UX-WIKI-018 | 1 Verified + 1 Open | wo-M64 / 待产品口径 |
| `preflight IA`（目标 / 路径 / 状态 badge / 摘要分层） | UX-WIKI-016 | Verified | wo-M64 |
| `thead sticky / visual anchor`（长表格 thead 失去参照） | UX-CATALOG-020 | Open | 待 M66 |
| `chip nesting`（chip 容器不得套 chip） | UX-OVERVIEW-001 | Verified | 已在 README 规则集中 |
| `aria-live noise`（每秒 ticker 不得走 aria-live） | UX-OVERVIEW-003 | Open | 待排期 |
| `button hierarchy consistency`（同组并列动作不得主次混用；唯一主路径 primary 须在组首或组末且与 Spec 主动作一致） | UX-CONNECTIONS-023、UX-OVERVIEW-008、UX-WIKI-037 | 2 Fixed + 1 Fixed | Spec 81 / wo-202608-13；Connections/Overview 待浏览器复核 |
| `internal-term translation`（内部状态术语不得裸露给用户） | UX-OVERVIEW-010 | 1 Fixed | 代码已修（`427ab38`），待浏览器复核 |
| `header microcopy value density`（页头说明必须表达用户价值，不讲内部实现叙事） | UX-OVERVIEW-009 | 1 Fixed | 代码已修（`427ab38`），待浏览器复核 |
| `button semantic consistency (secondary vs ghost)`（同一 action group 不得混用 `secondary`/`ghost` 造成误导性弱化） | UX-CATALOG-021 | Fixed | Spec 73 / wo-202608-06，待浏览器复核 |
| `long-list density (card vs table row)`（长列表用重卡片堆叠代替表格行，滚动负担高） | UX-CATALOG-024 | Fixed | Spec 73 / wo-202608-06，待浏览器复核 |
| `microcopy value density (写入路径 vs 业务价值)`（提示文案只讲实现机制、不讲为什么要维护） | UX-CATALOG-025 | Fixed | Spec 73 / wo-202608-06，待浏览器复核 |
| `single-table editing IA fragmentation`（单表编辑内容跳转到独立页面维护） | UX-CATALOG-026 | Fixed | Spec 73；与 UX-CATALOG-011 已按「禁首屏 banner、允许关联 tab 内联」修正 |
| `test / source drift`（测试 fixture 与 source 脱钩） | UX-GLOBAL-SHELL-008 | Open | 跨工单清理 |
| `version-history list-first`（版本列表优先，预览外置，当前行收敛） | UX-WIKI-031～035 | 5 Fixed | Spec 80 / wo-202608-12，待浏览器复核 |
| `css grid track stretch`（父级拉高时 auto 行均分，须 `content-start`） | UX-WIKI-006、UX-WIKI-027、UX-WIKI-036 | 1 Verified + 2 Fixed | Spec 79 / 81；`006` 已 Verified |
| `role-detail tab IA`（配置编辑 vs 只读生效边界 Tab 命名与 mode 可见性） | UX-ADMIN-AGENTS-029、UX-ADMIN-AGENTS-030 | 2 Fixed | Spec 89 / wo-202608-21，待浏览器复核 |
| `role-admin kpi vs filter separation`（KPI 静态概览、异常钻取下沉筛选） | UX-ADMIN-AGENTS-027、UX-ADMIN-AGENTS-028 | 2 Fixed | Spec 89 / wo-202608-21，待浏览器复核 |
| `history table business density`（发布/审计类历史表须展示变更范围与规模，导出不得冒充批次快照） | UX-PUBLISH-HISTORY-001～005 | 5 Fixed | Spec 85 / wo-202608-17，待浏览器复核 |
| `export entry clarity`（当前工作区资产包导出仅 Header；禁止行内伪历史下载） | UX-PUBLISH-HISTORY-003 | 1 Fixed | Spec 85 / wo-202608-17，待浏览器复核 |
| `list-page header count badge`（列表/历史页纯计数不得进 PageHeader badges） | UX-PUBLISH-HISTORY-006、UX-EVAL-001、UX-ADMIN-CONFIG-AUDIT-001 | 3 Fixed | Spec 91 / wo-202608-24，待浏览器复核 |
| `audit source terminology`（访问日志来源筛选须业务化，推断须 tooltip / disclaimer） | UX-ADMIN-AUDIT-014 | 1 Fixed | Spec 94 / wo-202608-27，待浏览器复核 |
| `audit drawer wayfinding`（问询 Drawer 须序号 + 连接 + 分区卡片） | UX-ADMIN-AUDIT-016、UX-ADMIN-AUDIT-017 | 2 Fixed | Spec 94 / wo-202608-27，待浏览器复核 |
| `ops adoption-first KPI`（新系统阶段先看稳定可用与使用率，不让拒绝指标挤占首排 KPI） | UX-ADMIN-AGENTS-031 | 1 Fixed | Spec 93 / wo-202608-26，待浏览器复核 |
| `kpi stock-then-adoption-then-volume`（KPI：存量 → 活跃覆盖 → 调用强度） | UX-ADMIN-AGENTS-037 | 1 Fixed | Spec 98 / wo-202608-31，待浏览器复核 |
| `ops lifecycle metadata visibility`（长列表需显式展示对象创建时间与配置最近变更时间） | UX-ADMIN-AGENTS-032 | 1 Fixed | Spec 93 / wo-202608-26，待浏览器复核 |
| `ops table column grouping`（配置 Token / 活跃 Token / 调用 / 生命周期时间相邻分组） | UX-ADMIN-AGENTS-038 | 1 Fixed | Spec 98 / wo-202608-31，待浏览器复核 |
| `list multi-dimensional filters`（列表页至少提供状态 + 活跃 + 规模等关键维度筛选） | UX-ADMIN-AGENTS-033、UX-ADMIN-AGENTS-035 | 2 Fixed | Spec 93 / 95，待浏览器复核 |
| `agent identity terminology`（显示名 vs 用户 ID；列表主列头须覆盖双行内容） | UX-ADMIN-AGENTS-034、UX-ADMIN-AGENTS-039 | 2 Fixed | Spec 95 / 98，待浏览器复核 |
| `low-risk one-step save`（低风险配置编辑一步落盘，diff 仅作审计/高风险确认） | UX-ADMIN-AGENTS-036 | 1 Fixed | Spec 95 / wo-202608-28，待浏览器复核 |
| `audit filter-table alignment`（筛选字段须与表头对齐，并含时间窗） | UX-ADMIN-CONFIG-AUDIT-006 | 1 Fixed | Spec 96 / wo-202608-29，待浏览器复核 |
| `ops table density (pl-data-grid)`（治理/审计列表须轻量 `pl-data-grid` 12px） | UX-ADMIN-CONFIG-AUDIT-003 | 1 Fixed | Spec 96 / wo-202608-29，待浏览器复核 |
| `header sibling nav redundancy`（PageHeader 不得重复侧栏已有的兄弟页入口） | UX-ADMIN-CONFIG-AUDIT-007 | 1 Fixed | Spec 97 / wo-202608-30，待浏览器复核 |
| `export-table field parity`（列表导出须与主表列头/业务文案一致，禁止原始字段 dump） | UX-ADMIN-CONFIG-AUDIT-008 | 1 Fixed | Spec 97 / wo-202608-30，待浏览器复核 |
| `export filename second precision`（审计类 CSV 文件名须含到秒的时间戳） | UX-ADMIN-CONFIG-AUDIT-008 | 1 Fixed | Spec 97 / wo-202608-30，待浏览器复核 |

新增 / 更新 ledger 时，如果属于以上主题，请在 `Notes` 引用主题名；新主题直接在表格追加一行。

## 跨页面治理规则

- Header 只承载对象身份、位置上下文和关键状态；不得放低价值统计 chips 或页面功能说明。
- 列表/历史页的「共 N 条」「N 个 case」等纯计数只能出现在表格空态、表尾或分页区，不得出现在 PageHeader `badges`（主题 `list-page header count badge`；样板见 Spec 88 Agent 列表、Spec 91）。
- PageHeader `actions` 不得重复侧栏已有的兄弟页导航入口（主题 `header sibling nav redundancy`；样板见 Spec 97 配置审计删「访问日志」）。
- 列表页「导出 CSV」默认须与主表可见列头及业务文案一致，禁止把英文原始字段 / 详情 dump 作为默认导出（主题 `export-table field parity`；样板见 Spec 97）。
- 审计类 CSV 的 `Content-Disposition` 文件名须含到秒的时间戳（`YYYYMMDD-HHmmss`），避免同日多次导出覆盖混淆（主题 `export filename second precision`；样板见 Spec 97）。
- 数据库对象标识符（Connection ID、Schema 名、表名、列名、路径、URL）必须保留仓库源字符串大小写；不得通过 JavaScript `.toUpperCase()` / `.toLowerCase()` 或 CSS `text-transform: uppercase` / `capitalize` / `lowercase` 强制改写。涉及数据库对象名的分组标题、链接文案、aria-label 都必须带 `translate="no"` 与 `notranslate`。测试必须直接断言渲染文本为仓库源字符串大小写，并保留反向断言（`queryByText(/UPPERCASE/)` 为空）。后端数据库标识符约定优先于 UI 渲染约定。
- 高密度数据表格里的对象链接默认保持正文级字重；可点击性优先通过颜色、hover underline、focus ring、图标或动作列表达，不靠把链接升成标题级粗体。表头、分组标题和真正的对象详情 H1 才使用更高字重建立层级。
- 同一视口内，同一个全局命令只能有一个主触发点；不得依赖 aria label 来补救可见命令重复。
- 全局品牌区必须是稳定 home affordance：logo / wordmark 整块可点击回 `/overview`，accessible name 应表达返回系统概览，且焦点态与侧栏其他可交互项一致。
- 全局品牌 wordmark / tagline 的对齐验收必须测量实际渲染文本范围；不能只让两行容器同宽就宣称“视觉长度一致”。
- 命令面板默认必须是搜索空态，不得在空输入时倾倒完整导航列表；空输入 Enter 不应触发隐式导航，结果项不得以 URL/path 作为主视觉信息。
- 命令面板查询结果必须解释匹配原因：结果项应提供 breadcrumb、页面标题、简短说明和命中高亮；不得只展示分组名 + 页面名的导航菜单形态。
- 全局侧栏一级分组与二级导航应保持统一字体节奏；层级差异优先通过颜色、字重、缩进、图标、active marker 和折叠状态表达，不通过字号跳变表达。
- 全局侧栏父子层级必须有明确几何差异：一级分组保持 full-width 行宽，二级列表进入 inset rail；二级文本相对一级分组文本应至少右移约 16px，active background 和 active marker 必须跟随子级内缩行。
- 辅助流程入口必须可发现，但不得挤占主任务首屏空间。
- Inspector / sticky rail 不承载全局操作；当页面存在长表单或长列表编辑时，应优先作为常驻审阅反馈区，集中展示状态摘要、对象级变更摘要和必要证据。
- 当“状态”和“详情”对用户都像提醒时，应合并为一个审阅反馈区；状态是摘要，详情 / Diff 是证据，不应拆成两个相邻心智模型。
- 长页面编辑的变更审阅必须对象级表达，不得只显示 `修改 1` 这类计数；可识别对象时应展示字段 / 指标 / 分群名称及关键 old -> new 值。
- Raw Diff / YAML Diff 如果是用户识别变更的最直接证据，不得默认藏在 `高级` 折叠里；可用 tabs 降级 YAML / 校验等次要视图，但核心 Diff 应默认可见。
- 生产 UI 不展示研发 spec 式说明文案；必要帮助使用短 label、tooltip、帮助入口或文档链接承载。
- 全局侧栏之外，页面主体内不得再引入视觉上等价的第二侧栏；局部导航优先使用 tabs、segmented controls 或紧凑切换器。
- 当全局侧栏或页面侧栏已经承载目录树 / 层级导航时，页面主体首页不得再复刻同一棵树；主体应展示当前任务最有价值的资源列表、摘要或工作区内容，层级关系作为路径 metadata、筛选器或轻量 breadcrumb 表达。
- 展开 / 收起 affordance 不得使用不可交互或语义不清的装饰三角 glyph（如 `▼`、`▶`、`▾`、`▸`）。如果行可展开，交互目标必须是 button 或等价控件，并在同一控件上提供 `aria-expanded`、可访问名称、hover / cursor / focus 状态；如果只是静态分组，不显示类似可展开的符号。
- 预检 / 确认类界面必须把目标对象、写入路径、操作状态和解析摘要拆开：目标路径使用明确 label（如 `目标 Wiki 路径`），新建 / 覆盖等动作语义用紧凑状态 badge，不用句子段落重复说明；解析摘要使用稳定 label / value 两列结构，关联对象也进入同一摘要结构，不作为游离段落。
- 运维指标必须区分静态配置数量与真实使用观测；涉及时间窗的指标必须在 label 或 hint 中明确时间范围和数据来源。
- 涉及对象关系的指标必须说明统计口径和关系边界，例如 Agent 数、配置 Token、活跃 Token、调用次数分别按哪个实体聚合、是否去重、时间窗是什么。
- Metric label 不使用不解释的英文缩写；安全异常指标可以保留，但不得挤掉更高价值的近期使用信息。
- 低频、高责任配置页默认展示可服务状态、异常状态和审阅入口；不得把模板数量、复制入口或预设清单作为页面主心智。
- 列表页 KPI 行默认只做静态概览，不承担筛选交互；业务钻取（含解析异常 / 待修复）下沉到 filterbar 下拉或列表内 badge。
- 配置编辑 Tab 与只读生效边界 Tab 必须分离命名：编辑区用「权限配置」，解析结果用「生效边界」；新建 / 复制流程不得展示无数据的「使用情况」空 Tab。
- 筛选器选项必须表达用户要完成的业务 / 运维判断，不展示裸后端枚举值，如 `yaml`、`template`、`invalid`。
- 状态标签必须区分对象来源、异常状态和生命周期状态；`待修复` 不得替代 `已停用`，中性来源标签不得使用 danger 视觉。
- 配置复制 / 从模板创建必须进入明确的新建流程，并展示写入目标、diff / dry-run 和人工确认语义。
- 列表页中的配置引用（如 role id、Connection id、Schema id）应能导航到其事实源或详情页，不应只作为纯文本出现。
- 列表页不默认展开完整技术 scope；高噪声工具清单、raw 权限和 runtime 边界说明应进入详情页、Role 页或权限预览。
- 权限 / 能力数量（如 N 个工具、N 个源）只有在同时提供配置位置、允许范围和运行时生效边界时才作为主信息展示；否则应弱化为摘要，并提供查看详情入口。
- Chip / Badge 容器类（如 `.pl-onboarding-facts`、`*.fact-chip` 等）的 CSS 不得用裸后代选择器给所有 `<span>` / 子节点加 chip 样式；要么只命中 `:scope > .chip` / 显式 chip class 的直接子节点，要么用 markup 收口（每个 chip 一个显式 class）。否则一旦 markup 多套一层 wrapper span，就会出现"chip 嵌 chip"的双重边框。修复优先在 markup 层去掉多余 wrapper，不要靠 CSS `> :first-child` 或 `* :not(...)` 打补丁。
- 全局侧栏在所有分组同时展开时，footer 必须固定贴底、中段 nav 必须独立可滚、滚动条始终可见：父容器（`.pl-sidebar`）固定 `h-screen overflow-hidden` + 中间 `<nav>` 必须 `flex-1 min-h-0 overflow-y-auto` + 显式 webkit 滚动条规则（`::-webkit-scrollbar { width: 6px }` + thumb 颜色 + hover 加深）；底部 footer（`.pl-sidebar-footer`）必须 `shrink-0` 固定贴底。**说明（M65 用户拍板 A 方案）**：1920×1080 视口下 5 个分组全展开时，中段 nav 内容超过视口高度，**依赖用户主动滚动查看底部分组**；不通过默认折叠二级菜单来"塞进视口"。否则分组数量增加或子菜单展开后，footer 会被滚动后的 nav 遮挡或被错认为"被裁断"。浏览器验收时需在 1920×1080 视口下展开所有 5 个分组，先确认 footer 贴底，再向下滚动 nav 验证 5 分组子菜单项全部可达、滚动条始终可见。
- 全局侧栏 nav 的滚动条必须对用户**视觉可见**——不能依赖 macOS / Linux overlay scrollbar 默认行为（仅在主动滚动时短暂出现），否则用户会把"nav 可滚"误读为"内容被截断 / footer 遮挡"。`.pl-nav` 必须显式声明 `scrollbar-width: thin` + `scrollbar-color: var(--color-border-default) transparent`，并对 webkit 浏览器（Chrome / Safari / 新 Edge）加 `::-webkit-scrollbar { width: 6px }` + `::-webkit-scrollbar-track { background: transparent }` + `::-webkit-scrollbar-thumb { background-color: var(--color-border-default); border-radius: pill }` + hover 时升级到 `var(--color-fg-muted)`；track 透明避免在 `px-3` 容器内出现"第二条边"。thumb 颜色与现有 sidebar 配色节奏（`border-default` / `fg-muted`）保持一致，避免引入新色阶。
- `aria-live` 区域只承载"通知"，不得承载"状态指针"；任何每秒 / 每分钟自动重渲染的状态徽标（最后更新时间、最后同步时间、活跃计数 ticker）必须把"视觉更新"与"屏幕阅读器 announce"解耦——视觉用普通元素（`aria-hidden` 或无 live 属性），announce 走独立 `<span role="status" aria-live="polite">` 仅在状态真正变化时写入。否则依赖 a11y 工具的运维用户会被每秒一次的播报噪音淹没。
- 顶部 PageHeader 的状态反馈元素（如“上次更新”）与其触发动作（如“刷新首页数据”）默认应同组同排放在 actions 槽，保持“动作-反馈”邻接关系，避免跨区造成错位或语义割裂；仅当窄视口出现拥挤时，才允许在同组内换行或降级展示样式。任何新增元素仍需评估 ≥1280px 主流视口下 description 换行回归。该规则纠正早期“把时间戳优先挪到 description”的指引，与 `UX-OVERVIEW-004` 现实现一致。
- 同一 action group 内的并列维护动作必须同级呈现：默认全部使用 `secondary`，不得把某个并列动作升为 `primary` 造成误导性显著性。只有存在唯一推荐主路径（用户下一步成功率最高且可证）时，才允许单个 `primary`，且同组最多一个；该 primary 应位于组首或组末，并与页面 Spec 声明的主动作一致（Wiki 阅读态为 `编辑`，见 `UX-WIKI-037`）。
- 可拉伸的 CSS Grid 内容面板（阅读卡片、预览面板、空态容器、库首页等）必须显式 `content-start` / `align-content: start`（或把标题外提到 `auto` 行），禁止依赖默认 `align-content: normal` 在父级被拉高时均分 auto 行，导致标题/正文垂直居中或大块留白。同类已见 `UX-WIKI-006` / `027` / `036`（主题 `css grid track stretch`）。
- 用户可见文案不得直接暴露内部状态枚举（如 `partial` / `done` / `stale` / `invalid`）；须改写为中文、可理解的影响描述，并尽量给出下一步动作入口。页头 description 只保留“页面能力 + 用户动作价值”，不得写内部实现叙事（如 data agent 可交付状态判断）。
- 发布 / 审计类历史表必须优先展示业务变更范围（连接、变更源）与规模（文件数、语义源数）；纯运维触发信息不得挤掉主列。手动索引重建且无资产变更时，须用明确空态文案，不得留白。
- 「导出当前语义资产包」类动作若导出的是当前工作区而非历史批次，只能放在 Header（或页级辅助区）；禁止在历史行内用「下载快照」等文案冒充该批次存档。按 releaseId 的历史包下载未交付前，不得放假按钮。

## 工作流

1. 收到页面级 UI/UX 反馈后，先按页面追加到 `pages/<page>.md`，保留用户原始反馈摘要、截图和目标路由。
2. 若同一轮反馈包含多个可独立回归的问题，拆成多个稳定 ID；若多个现象共享同一修复，可在 `Notes` 交叉引用。
3. 浏览器核查时只记录事实，不把修复建议写成已验证结果；修复后但未做浏览器复核时，状态保持 `Fixed`。
4. 代码修复应在 `Notes` 写明主要文件和验证命令；如果用户明确要求不做浏览器验证，需要在 `Browser Check` 或 `Notes` 标注“待复核”。
5. 后续回归检查从 `Open` 和 `Fixed` 条目开始，`Verified` 条目只在相关页面大改或问题复现时重开。
6. 每轮修复完成后必须做一次非浏览器 code review；若未做浏览器复核，相关条目只能停在 `Fixed`，不得写成 `Verified`。

## Status

| Status | 含义 |
|---|---|
| `Open` | 已确认或待确认的问题，尚未修复 |
| `Fixed` | 已有代码修复，但尚未完成浏览器复核 |
| `Verified` | 已通过浏览器或人工验收复核 |
| `Won't Fix` | 经确认不修复，需在 Notes 说明原因 |

## 条目模板

```md
## UX-CONNECTIONS-001: 表格统计列对齐不一致

Status: Open
Route: /connections
Area: Connection card schema table
Severity: P2
Reported: 2026-08-02

### Feedback
用户原始反馈或问题摘要。

### Evidence
- Screenshot: ../assets/connections/UX-CONNECTIONS-001.png

### Expected
期望体验和验收口径。

### Browser Check
1. Open `/connections`.
2. Locate the affected area.
3. Verify the expected behavior.

### Notes
实现备注、PR、残余风险或待复核事项。
```
