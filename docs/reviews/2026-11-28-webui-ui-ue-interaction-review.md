# Project Lucy WebUI UI/UE 交互评审报告与优化方案（v1.1 交叉审阅修订版）

| 项 | 内容 |
| --- | --- |
| 评审日期 | 2026-11-28（同日完成交叉审阅修订） |
| 基线 Commit | `8057bf76`（`8057bf76e27fd51dcfb5b306f735a9271459e322`） |
| 评审范围 | `webui/src/app/navigation.ts`（7 个一级分组 / 27 个二级菜单）、`webui/src/app/app.css`（3,156 行）、`webui/src/pages/`（42 个页面）、`webui/src/components/`、`webui/src/lib/` 与 `webui/scripts/lint-*.mjs`（5 项静态门禁） |
| 统计口径 | 源码静态扫描统一排除 `__tests__/` 与测试文件；类名与调用计数按行命中统计并标注涉及文件数；所有行号基于 commit `8057bf76` |
| 评审性质 | **只读审计与优化建议（非开发授权）**。文中 P0 / P1 / P2 表示问题严重度；进入开发前须按治理流程先入 `docs/backlog` 需求池并挂 Spec / 验收编号 |
| 同步修复状态 | 已修改 `webui/server/admin/ui-usage.ts`（`/admin/accounts` 映射 + `/admin/admins` 入重定向集）、`webui/server/__tests__/admin-ui-usage.test.ts`（实测 11/11 通过）与 `webui/docs/06-navigation-ia.md`（§3/§4 文档对齐，不触碰 `navigation.ts`）。**当前处于未提交状态，待按 `docs/governance/DEVELOPMENT.md`「产品侧修复收口」流程提交并登记验收** |

---

## 1. 总体结论与量化基线

Project Lucy WebUI 已经具备扎实的工程化 UX 底座：

* **信息架构与安全门禁扎实**：侧栏 7 组 27 项由 `navigation.ts` 单一事实源驱动；38/42 个页面接入统一 `PageHeader`；TSX 中 **0 处硬编码 hex 颜色**；并已建设术语/翻译防御（`lint-terminology.mjs`）、IA 边界（`lint-ia-boundary.mjs`）、剪贴板防假成功（`lint-copy-surfaces.mjs`）、下载/写入防假成功（`lint-button-feedback.mjs`）等静态门禁。
* **核心债务集中在“多 Spec 增量演进后的样式膨胀与体验断层”**：新近迭代的页面（如 `Catalog`、`Audit`、`PublishWorkbench`、`SkillList`）体验较完善，而早期或独立演进的模块（尤其是 `eval/` 评测模块与部分管理抽屉）在配色 Token、表格网格、异步三态、提示词规范和确认流上存在明显断层。

### 关键量化基线（基线 `8057bf76`，排除 `__tests__/`）

| 维度 | 统计指标 | 当前现状 |
| --- | --- | --- |
| 样式表规模 | `webui/src/app/app.css` 行数 / 体积 | 3,156 行（约 170 KB），单文件承载全部 Token + 通用组件 + 页面特例 |
| 配色泄露 | 非 Token 原生 Tailwind 调色板（`text-red-500`、`bg-green-500` 等） | 19 处（集中在 `eval/` 与 4 个组件、`app.css` 日志框）；另 `.pl-login-page` 含硬编码 hex/rgba |
| 失效工具类 | 无对应 `@theme` Token 的 `border-border` / `bg-bg` | **`border-border` 22 处**（6 个文件）+ **`bg-bg` 1 处**（`CaseList.tsx:249`） |
| 状态标签碎片 | `app.css` 中独立 Badge / Status / Pill 类族 | 12+ 套独立前缀，圆角与字重不统一 |
| 浮层体系碎片 | `app.css` 中独立 `fixed` Drawer / Modal 类族 | 9 套独立定位/遮罩/圆角/z-index 实现，另 `AgentDetail.tsx` 出现临时 `z-[70]` / `z-[60]` 覆盖 |
| 按钮规范 | `src/{app,pages,components}` 中 `.pl-btn` / `.pl-btn--danger` / `.pl-btn--xs` | 基础类 455 行命中；`.pl-btn--danger` 16 处（12 文件）；`.pl-btn--xs` 14 处（含 `App.tsx:331,347`，外溢至 8 个非 Onboarding 文件） |
| 数据网格统一率 | 业务数据表 `<table>` / 未接入 `.pl-data-grid` 的裸表 | 全站 39 处 `<table>`（含 1 处 `MarkdownPreview` 散文表 `.pl-markdown-table` 豁免），其中 **8 张业务数据表**未接入 `.pl-data-grid` |
| 网格高级能力 | 表头吸顶（`sticky`）表格数 / 可排序列表数 | 2 处吸顶（`.pl-audit-grid-scroll` L824、`.pl-field-table` L1606）/ **0 处列排序** |
| 异步三态收口 | 接入 `AsyncRegion` 页面数 / 仍手写 `加载中` 处数 | **5 / 42 页**（`Catalog`、`ConnectionOverview`、`Onboarding`、`OpsSteps`、`AgentList`）；25 处手写 `加载中…` |
| 确认流一致性 | `webui/src/` 全量原生 `window.confirm` / `confirm()` 调用 | **14 处**（13 处位于 `pages/components` + 1 处位于 `src/lib/useRolesAgentDraftGuard.ts:17`） |

---

## 2. 风格统一评审（配色、按钮、布局、浮层与状态标签）

### 2.1 配色与 Design Token 体系

#### [P1-01] 19 处非 Token 原生 Tailwind 调色板泄露 + 22 处失效 `border-border` / 1 处失效 `bg-bg`

* **现状证据**：
  * **非 Token 调色板（19 处）**：
    * `webui/src/pages/eval/CaseList.tsx:517`、`CaseEditor.tsx:254,306,483,569,712`、`RunList.tsx:121,145`、`RunDetail.tsx:334` 硬编码 `text-red-500`，未走 `--color-danger` / `text-danger-strong`。
    * `webui/src/pages/eval/RunDetail.tsx:202` 使用 `bg-green-500`；`webui/src/components/SchemaStructurePrep.tsx:291`、`DeleteConnectionDrawer.tsx:442`、`RemoveSchemaDrawer.tsx:305` 使用 `text-green-700`，未走 `text-success-strong`。
    * `webui/src/components/admin/AuthorizationHeadline.tsx:41,90` 使用 `border-amber-300 bg-amber-50 text-amber-900`，未走 `border-warning-strong bg-warning-soft text-warning-strong`。
    * `webui/src/app/app.css:1564-1568`（`.pl-raw-log-frame`）使用 `bg-slate-950` / `text-slate-100` / `text-slate-400`；`app.css:3150,3153`（`.pl-login-page`）硬编码 `#f4f5f7` 与 `rgba(255, 90, 61, 0.14)`。
  * **失效工具类（共 23 处）**：`@theme` 仅定义了 `--color-border-default` / `muted` / `strong`（`app.css:65-67`）及 `--color-bg-base` / `surface` / `elevated` / `muted` / `subtle` / `selected`，Tailwind v4 CSS-first 下不存在 `border-border` 或 `bg-bg`，导致以下位置边框/背景实际不生效：
    * `border-border`（**22 处**）：`eval/RunDetail.tsx`（8 处：L171,211,220,246,255,277,294,311）、`eval/CaseEditor.tsx`（4 处：L204,231,478,564）、`eval/CaseList.tsx`（4 处：L249,273,286,316）、`eval/RunList.tsx`（3 处：L118,208,221）、`eval/FieldQuestions.tsx`（2 处：L60,69）、`admin/AgentDetail.tsx:1220`（1 处）。
    * `bg-bg`（**1 处**）：`eval/CaseList.tsx:249`（下拉浮层 `bg-bg` 导致透明底色）。
* **优化建议**：
  1. 将 19 处原生调色板替换为语义 Token，并为深色日志终端补充 `--token-color-terminal-bg` / `--token-color-terminal-fg`。
  2. 将 22 处 `border-border` 修正为 `border-border-default`，将 `CaseList.tsx:249` 的 `bg-bg` 修正为 `bg-bg-elevated`。
  3. 新增静态校验规则，禁止 `src/{pages,components}` 出现 Tailwind 原始调色板类、裸 hex 以及未在 `@theme` 注册的 `border-border` / `bg-bg`。

#### [P1-02] 状态徽章（Badge / Pill）存在 12+ 套重复样式定义

* **现状证据**：`webui/src/app/app.css` 中并存 12+ 套独立状态类族：`.pl-status-badge`（无边框、`rounded-pill`、`font-medium`）、`.pl-publish-history-status` / `.pl-schema-asset-status`（有边框、`rounded-pill`、`font-semibold`）、`.pl-catalog-reload-badge` / `.pl-inspector-badge` / `.pl-wiki-preflight-target-status`（有边框、`rounded-pill`、`font-medium`）、`.pl-ingest-last-run` / `.pl-catalog-last-run`（有边框、`rounded-md`）、`.pl-meta-badge` / `.pl-overlay-badge`（有边框、`rounded-sm`、`10px/11px`），以及 `.pl-latency-badge`、`.pl-connection-status`、`.pl-env-badge`、`.pl-chip`。
* **优化建议**：抽象统一的 `<StatusPill tone="neutral|info|success|warning|danger" variant="soft|outline" size="xs|sm" />` 原语组件：状态类统一 `rounded-pill` + `soft` 底色 + `12px font-medium`；元数据标签类（PK、Overlay、字段类型、后缀）统一 `rounded-sm` + `outline` 细边 + `11px font-mono`。

### 2.2 按钮体系

#### [P1-03] `.pl-btn--xs` 耦合固定最小宽度 `120px` 且外溢至 8 个非 Onboarding 文件

* **现状证据**：`webui/src/app/app.css:696` 定义 `.pl-btn--xs { @apply h-8 min-w-[7.5rem] px-3 text-xs font-medium; }`，原意仅为拉齐 Onboarding 的 MCP 接入区两个按钮宽度，但已外溢复用至 **8 个非 Onboarding 文件**（共 14 处，含 `AsyncRegion.tsx:49` 与 `App.tsx:331,347` 错误边界的「重试」按钮），导致两字小按钮被撑宽至 120px。
* **优化建议**：将 `min-w-[7.5rem]` 剥离至局部修饰类（如 `.pl-mcp-actions .pl-btn--xs`），全局收敛为三档清晰尺寸：`lg`（`h-10 px-4 text-sm`）、`md`（默认，`h-9 px-3 text-sm`）、`sm`（`h-7 px-2.5 text-xs`）。

#### [P1-04] 危险按钮悬停无反馈且页头主动作层级分裂

* **现状证据**：
  * `webui/src/app/app.css:689` 中 `.pl-btn--danger` 的 hover 与常态同为 `bg-danger-soft`，悬停无视觉变化。
  * `eval/CaseList.tsx:517`、`eval/CaseEditor.tsx:483,569` 手拼 `pl-btn pl-btn--ghost text-xs text-red-500` 替代危险按钮。
  * 页头操作栏主动作层级不一致：`eval/RunList.tsx:101`（「服务器运行」）与 `eval/FieldQuestions.tsx:46`（「刷新」）使用 `pl-btn--ghost`，在白底页头中缺少边界感。
* **优化建议**：拆分为实心危险主按钮 `.pl-btn--danger`（确认弹窗内：`bg-danger text-fg-inverse hover:bg-danger-strong`）与轻量危险次按钮 `.pl-btn--danger-ghost`（行内删除：`text-danger-strong hover:bg-danger-soft`）；明确 `PageHeader.actions` 规则（每页至多 1 个 `primary`，次级/刷新统一用 `secondary`）。

### 2.3 布局、卡片与浮层体系

#### [P1-05] 9 套独立 Drawer / Modal 样式与临时 `z-[70]` / `z-[60]` 层级失控

* **现状证据**：
  * `app.css` 存在 9 套独立 `fixed` 浮层样式（`.pl-drawer-panel`、`.pl-modal-panel`、`.pl-dialog-content`、`.pl-version-panel`、`.pl-trace-detail-content`、`.pl-wiki-preflight-content`、`.pl-wiki-template-content`、`.pl-wiki-meta-content`、`.pl-wiki-new-document-content`）。
  * 遮罩透明度 4 种写法（`bg-black/20`、`bg-fg-default/30`、`bg-fg-default/40`、纯 CSS `rgba(15, 23, 42, 0.4)`），`backdrop-blur-sm` 有无不一，圆角混用 `md/lg/xl/2xl`，内边距混用 `p-4/p-5/p-6`。
  * `z-index` 缺乏阶梯管理：`app.css:2472` 为 Wiki Preflight 手写 `z-index: 51`；`trace-detail` / `wiki-template` / `wiki-meta` 遮罩为 `z-40` 而主体为 `z-50`；更直接的失控证据是 `webui/src/pages/admin/AgentDetail.tsx:1884,1917` 被迫在 JSX 上临时硬塞 `z-[70]`（`agent-leave-confirm-modal`）和 `z-[60]`（`agent-save-confirm-modal`）以压过既有抽屉。
* **优化建议**：
  1. 在 `:root` 固化层级阶梯：`--z-sticky: 10`、`--z-dropdown: 20`、`--z-dock: 30`、`--z-overlay: 40`、`--z-drawer: 50`、`--z-modal: 60`、`--z-popover: 70`、`--z-toast: 80`。
  2. 收敛为两个标准 Radix 封装原语：`<SideDrawer size="sm|md|lg" />` 与 `<ModalDialog size="sm|md|lg" />`，统一遮罩、圆角、Header/Body/Footer 间距与焦点陷阱。

#### [P2-01] `app.css` 3,156 行单文件膨胀、死样式与重复声明

* **现状证据**：`app.css:2314-2333` 残留 20 条 `.pl-wiki-library-* { display: none; }` 废弃规则；同一选择器存在多处重复声明，包括 `.pl-inspector` **3 处**（`app.css:1756,1776,3039`）与 `.pl-command-palette-list` **2 处**（`app.css:311,339`）。
* **优化建议**：拆分为 `styles/tokens.css`、`styles/base.css`、`styles/primitives.css` 与按域拆分的 `styles/features/*.css`，合并重复选择器并清理死样式。

---

## 3. 用户体验升级评审（网格/表格、提示词/文案、交互反馈与微体验）

### 3.1 数据网格 / 表格（Grid / Table）体验升级

#### [P0-01] 8 张业务数据表未接入 `.pl-data-grid`，视觉与可读性断层

* **现状证据**：排除 `MarkdownPreview.tsx:348` 的散文表格（`.pl-markdown-table`，维持豁免），以下 8 张业务数据表仍使用手写原生类：
  * `webui/src/pages/eval/FieldQuestions.tsx:58`（`w-full text-sm` + 失效 `border-border`）
  * `webui/src/pages/eval/RunList.tsx:206`（`w-full text-sm` + 失效 `border-border`）
  * `webui/src/pages/eval/Monitor.tsx:498`（`w-full text-sm mt-2`；同页 L464、L527 两表已用 `pl-data-grid`）
  * `webui/src/pages/eval/RunDetail.tsx:244,275`（`w-full text-xs` / `w-full text-sm` + 失效 `border-border`）
  * `webui/src/components/admin/AuthorizationResourceCard.tsx:78`（`w-full border-collapse text-[13px]`）
  * `webui/src/components/admin/RowPolicyTemplatePanel.tsx:107,280`（`w-full text-left text-sm/xs`）
* **优化建议**：将上述 8 张业务数据表统一迁移至 `.pl-data-grid-frame` + `.pl-data-grid-scroll` + `.pl-data-grid`，所有数值/百分比/时间列统一加 `tabular-nums`。

#### [P1-06] 数据网格缺少“表头吸顶 + 列排序 + 统一数值对齐”三大高频能力

* **现状证据**：
  * **表头吸顶仅 2 处**：`.pl-audit-grid-scroll`（`app.css:824`）与 `.pl-field-table`（`app.css:1606`）；`Catalog`、`TableWhitelist`、`AgentList`、`Tokens`、`RoleList`、`PublishHistory`、`ConfigAudit`、`RunList` 滚动后均丢失表头。
  * **列排序能力为 0**：全站 0 处 `aria-sort` 及任何 `sortBy / toggleSort / ArrowUpDown` 排序逻辑。运维在 `Catalog`（按更新时间/Agent 引用数）、`Tokens`（按到期时间）、`RunList` / `CallMonitor`（按通过率/耗时）等高频场景无法按列排序。
  * **对齐不统一**：数值列在部分表显式左对齐（如 `.pl-schema-asset-table-num`、`.pl-whitelist-table-num`），跨页扫读数字节奏不连贯。
* **优化建议**：封装轻量级 `<DataGrid>` 包装组件（基于现有 `.pl-data-grid`，零重依赖）：默认提供吸顶表头 + 受控/非受控列排序（含 `aria-sort`）；统一对齐约定（文本/标识左对齐，纯数值/百分比/耗时右对齐 + `tabular-nums`，状态胶囊左对齐，操作列右对齐）。优先在 `Catalog`、`Tokens`、`AgentList`、`RunList`、`PublishHistory` 5 个高频页落地。

#### [P1-07] 行内操作模式与分页承载跨页割裂

* **现状证据**：
  * 行操作 4 种形态并存：主链 + `RowMoreMenu`（`Catalog`/`AgentList`/`RoleList`/`TableEditor`）、原生 `<details className="pl-row-action-more">`（`ConnectionOverview`）、整行 `onClick`（`RunList`）、行尾平铺按钮（`AdminAccounts`/`Tokens`/`FieldQuestions`）。
  * 分页承载分裂：`TableWhitelist`/`SkillList`/`PublishHistory`/`ConfigAudit` 为页码分页；`AuditReconciliation` 仅显示「还有更多（按游标分页）」而无翻页按钮；`Catalog`/`AgentList`/`Tokens`/`RunList` 一次性渲染全量行。
* **优化建议**：统一行操作约定（1 个主操作链接 + ≥2 个次/危险动作收进 `RowMoreMenu`）；提供统一 `<TablePagination>` 栏并补齐 `AuditReconciliation` 的游标「加载更多」交互。

### 3.2 提示词、占位符与空态/错误引导（Copy & Prompts）

#### [P1-08] 输入框 Placeholder 风格混乱且暴露技术参数（含术语合规前置要求）

* **现状证据**：
  * **暴露 URL Query 语法与裸英文标签**：`admin/AccessMap.tsx:518`（`"写入 agent="`）、`534`（`"写入 connection="`）；`admin/AuditReconciliation.tsx:424`（`"问询 ID（turn id）"`）；`eval/CaseEditor.tsx:306`（`question *`）；`eval/RunList.tsx:121,132`（`Domain *`、`— 选择 domain —`、`全部 domain`）。
  * **标点与前缀 5 种风格混用**：英文 `...`（`Catalog.tsx:526`）vs 中文 `…`（`HelpCenter.tsx:362`、`Tokens.tsx:192`）vs 无省略号（`OpsSteps.tsx:328`）；`例：`（`Login.tsx:211`、`AgentList.tsx:468`）vs `例如：`（`RunList.tsx:167`）；`请输入…` vs `输入…` vs 与 `<label>` 重复的裸名词（`ConfigAudit.tsx:375-389`）。
* **优化建议与治理前置约束**：
  * 制定《表单与搜索提示词规范》：搜索框统一「`搜索<字段1>、<字段2>…`」（中文省略号）；格式示例统一「`例如：<具体样本>`」；消除 `AccessMap.tsx` 中 `"写入 agent="` 类技术语法暴露。
  * **术语合规前置（G3）**：`domain` 已在 `webui/docs/00-product-terminology-standard.md:958` 登记为 Skill 域的 Protected term；涉及「评测域（Domain）」等新概念或术语中文映射的 UI 文案改动，**必须先更新术语标准或在对应 Spec 的 Terminology Compliance 小节登记**，再修改 UI 文案与测试断言，不得直接做普通文案替换。

#### [P1-09] 异步三态与空态引导未收口（`AsyncRegion` 覆盖率仅 5/42）

* **现状证据**：
  * 全站实际仅 **5/42 个页面**接入 `AsyncRegion`：`Catalog.tsx`、`ConnectionOverview.tsx`、`Onboarding.tsx`、`OpsSteps.tsx`、`AgentList.tsx`（注：`TableWhitelist.tsx` 尚未接入）。其余页面存在 **25 处手写 `加载中…`**（如 `FieldQuestions.tsx:55`、`RunList.tsx:201` 等），缺少 120ms 防闪烁延迟、固定 `minHeight` 防 CLS 抖动与内置局部重试按钮。
  * 空态引导两极分化：`Catalog.tsx:125-158` 区分无数据/未启用/筛选无命中并给出可点击跳转；而 `FieldQuestions.tsx:56`（「暂无现场提问」）、`RunList.tsx:203`（「暂无 run 记录」）、`SkillList.tsx:275` 仅给静态文本，缺少下一步操作提示。
* **优化建议**：以现有 5 页为范本将 `AsyncRegion` 推广至所有数据页；封装 `<EmptyState icon title description action />` 组件，区分“无初始数据（说明来源 + 主引导动作）”与“筛选无命中（提供一键「清除筛选」）”。

### 3.3 交互反馈、防呆确认与快捷体验（Micro-UX）

#### [P0-02] 14 处破坏性操作与未保存拦截仍使用浏览器原生 `window.confirm()`

* **现状证据（`webui/src/` 全量 14 处）**：
  * **高危数据面/控制面操作（6 处）**：`admin/AgentDetail.tsx:712`（删除 Agent）、`760,766`（撤销单个/批量 Token）、`eval/CaseList.tsx:519`（删除评测用例）、`admin/AdminAccounts.tsx:906`、`components/admin/OidcBindingPanel.tsx:216`。
  * **未保存离开与草稿守卫（8 处）**：`lib/useRolesAgentDraftGuard.ts:17`（共享角色草稿守卫，被角色页复用）、`admin/AgentList.tsx:374`、`skills/SkillList.tsx:398,413`、`WikiEditor.tsx:837,1094,1278,1532`。
* **优化建议**：封装统一 `<ConfirmDialog tone="danger|warning" title description impactItems confirmLabel cancelLabel />`（基于 Radix Dialog）替换全部 **14 处**调用，高危操作明示影响面与具体动词按钮（如「确认撤销 3 个 Token」）；完成后在 Lint 门禁中新增禁止 `window.confirm` / `window.alert` 规则。

#### [P2-02] 操作反馈分层、快捷键可发现性与 `CommandPalette` 增强

* **现状证据**：Toast（`sonner`）与页内 `.pl-error`/`.pl-notice` 分工不明确；除 `⌘K` 与编辑器 `⌘S` 外缺少列表页 `/` 快速聚焦搜索框；`CommandPalette` 仅索引 27 个侧栏入口，未覆盖 `/help` 与高频新建动作。
* **优化建议**：确立反馈分层（瞬态结果走 Toast、阻断性校验/降级走页内 Alert、区域加载失败走 `AsyncRegion` + 重试）；在搜索型列表页增加 `/` 聚焦快捷键与角标，并把「系统手册」与常用快捷动作纳入 `CommandPalette`。

---

## 4. 治理前置门禁与分阶段落地路线图

### 4.1 治理前置门禁（进入开发前必须满足）

1. **先入需求池再立项（G1）**：本路线图作为评审输入，**不构成开发授权**。Phase 1–3 各改造包进入实施前须先在 `docs/backlog` 登记需求台条目并关联 Spec 与验收编号。
2. **真实前台浏览器实测验收（G2）**：所有用户可见面改动除通过静态门禁与单测外，**必须按 `docs/qa/uat/CONVENTIONS.md` 执行真实前台浏览器 UAT 与即时计时（与 API 耗时分列）**，不得仅以静态指标宣告验收通过。
3. **术语标准前置（G3）**：涉及 `domain` 等 Protected term 的文案调整（P1-08），必须先更新 `webui/docs/00-product-terminology-standard.md` 或在 Spec 的 Terminology Compliance 小节登记后再改代码。
4. **本次同步修复收口（G4）**：已完成且单测 11/11 通过的 `ui-usage.ts` 路由映射修复与 `06-navigation-ia.md` 文档同步，需单独按 `docs/governance/DEVELOPMENT.md`「产品侧修复收口」提交并登记验收，不与后续 UI 改造混包。

### 4.2 分阶段改造清单

| 阶段 | 严重度 | 改造项 | 涉及范围 | 验收口径（静态 + 真实浏览器 UAT） |
| --- | --- | --- | --- | --- |
| **Phase 1：止血与基线拉齐（1–2 周）** | **P0 / P1** | 1. 替换 19 处非 Token 调色板、22 处失效 `border-border` 与 1 处失效 `bg-bg`<br>2. 8 张裸业务数据表迁移至 `.pl-data-grid`<br>3. 封装 `<ConfirmDialog>` 替换全部 **14 处** `window.confirm`（含 `useRolesAgentDraftGuard.ts`）并加 Lint 门禁<br>4. 剥离 `.pl-btn--xs` 全局 `min-w` 并补齐 `.pl-btn--danger` hover 态 | `eval/` 全模块、`AgentDetail`、`AdminAccounts`、`OidcBindingPanel`、`useRolesAgentDraftGuard`、`WikiEditor`、`SkillList`、`app.css` | **静态**：零 `window.confirm`、零失效 `border-border`/`bg-bg`、零非 Token 调色板泄露；**业务数据表 100% 接入 `.pl-data-grid`**（`MarkdownPreview` 散文表 `.pl-markdown-table` 豁免）。<br>**浏览器 UAT**：按 `CONVENTIONS.md` 实测 8 张迁移表、14 处确认弹窗与 `eval/` 边框/底色渲染，记录前端与 API 分列耗时 |
| **Phase 2：网格与提示词体验升级（2–3 周）** | **P1** | 1. 封装 `<DataGrid>`（吸顶表头 + 列排序 + 统一数值右对齐）并在 5 个高频页落地<br>2. 推广 `AsyncRegion` 替换 25 处手写 `加载中…`<br>3. 封装 `<EmptyState>` 补齐空态 Next-Step 引导<br>4. 过术语标准评审（G3）后统一全站 Placeholder 与英文标签文案 | `Catalog`、`Tokens`、`AgentList`、`RunList`、`PublishHistory`、`TableWhitelist`、`AccessMap`、`FieldQuestions`、`AuditReconciliation` | **静态**：高频 5 表支持 `aria-sort`；术语/Placeholder Lint 全绿；`AsyncRegion` 覆盖全部数据页。<br>**浏览器 UAT**：实测长表滚动吸顶、点击列排序、空态一键清除筛选与加载态无闪烁/无 CLS 抖动，记录分列耗时 |
| **Phase 3：设计系统架构收口（持续）** | **P2** | 1. 收敛 12+ 套 Badge 为 `<StatusPill>`<br>2. 收敛 9 套 Drawer/Modal 为 `<SideDrawer>` + `<ModalDialog>`，落地 `--z-*` 阶梯并移除 `AgentDetail.tsx` 的 `z-[70]`/`z-[60]`<br>3. 拆分 3,156 行 `app.css`，合并 `.pl-inspector`（3 处）/`.pl-command-palette-list`（2 处）并清理 20 条死样式<br>4. 增强 `CommandPalette` 快捷动作与 `/` 搜索快捷键 | `app.css`、`src/components/ui/`、`AgentDetail`、`CommandPalette` | **静态**：`app.css` 完成分层拆分、零死样式/重复选择器、零硬编码 `z-[*]`。<br>**浏览器 UAT**：实测抽屉套弹窗/下拉框层级无遮挡、`/` 快捷键与命令面板直达动作可用 |
