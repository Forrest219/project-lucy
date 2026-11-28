# WebUI 设计系统强制落地与受限原语库 Spec（草案）

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI 设计系统强制落地与受限原语库 Spec |
| 文档类型 / 版本 | Spec（前端设计系统治理与基础体验升级）／**v0.1 草案** |
| 日期 / 目标版本 | 2026-11-28／产品线 `0.35.0`（`lucy-v0.35`）；目标版本待入池定 |
| 建议需求编号 / 优先级 | 建议 **`REQ-0123`**（待入 [`docs/backlog/README.md`](../backlog/README.md)）／建议 **P1**（不入核心问数分母） |
| 阶段 | S1 |
| 状态 | S1｜**v0.1 草案**（基于 [UI/UE 交互评审报告 v1.1](../reviews/2026-11-28-webui-ui-ue-interaction-review.md) 起草，基线 commit `8057bf76`）。**未入需求池；未终稿确权；未获开发授权**；测试台 NOT RUN。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | **草案 ≠ 入池 ≠ 终稿确权 ≠ 开发授权**。未获委托人明示开发授权前禁止修改任何运行代码、脚本或 `package.json`。本 Spec 不涉及主导航 IA 变更（不改 `navigation.ts`） |
| 关联评审与既有条目 | [UI/UE 评审报告 v1.1](../reviews/2026-11-28-webui-ui-ue-interaction-review.md) · 与既有 `REQ-030-044`（文档收敛）/`REQ-030-045`（逐页存量整改）的关系见 §1.2 |
| 实施主体 | Lucy WebUI（`webui/src/`、`webui/scripts/`、`webui/docs/design-system/`）；不改 KTX、不改后端业务接口 |
| 输出位置 | `docs/specs/lucy-20261128-design-system-enforcement-and-primitives-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 2026-11-28 初稿：基于 `8057bf76` 源码评审与交叉审阅修订版，提出「受限原语库 + `lint:design-system` 存量只减不增门禁 + 新页蓝图 + `app.css` 分层」四层根治方案，不碰运行代码 |

---

## 闭口层级

- **层级**：功能合同 ＋ 前端工程治理门禁
- **本条承诺**：通过沉淀薄封装 UI 原语库（`webui/src/components/ui/`）、上线 `lint:design-system` 静态门禁（存量基线只减不增）、建立新建页面蓝图（`25-new-page-blueprint.md`）并完成 Phase 1–3 存量清零，使新建与改版 WebUI 页面**天然遵循统一视觉与交互规范**，不再依赖人工自觉翻查 15 篇文档或事后应急返工。
- **本条出口**：SC-01–SC-12 全部有可复现证据，其中所有用户可见面改动均须通过 `docs/qa/uat/CONVENTIONS.md` 规定的**真实前台浏览器 UAT ＋ 即时计时（与 API 耗时分列）**。
- **不在本条出口**：引入重型第三方组件库（如 Ant Design / MUI）；改写后端业务逻辑或 MCP 协议；暗色主题（Dark Mode）切换；移动窄屏适配；主导航 IA 增删改（任何菜单变动仍须独立 IA 确认）。
- **上线关系**：本条收口不表示可上线。

---

## Terminology Compliance

This feature follows [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md).

- **既有术语沿用**：`Schema Manifest`、`overlay`、`Agent`、`Token`、`Role`、`Skill`、`Catalog` 等全部沿用术语标准；DOM 节点继续按 `lint:terminology` 添加 `translate="no"` 与 `notranslate`。
- **G3 前置硬约束**：`domain` 已在 `webui/docs/00-product-terminology-standard.md:958` 登记为 Skill 域的 Protected term。本方案 Phase 2 涉及 `eval/` 模块「`Domain` / `question`」等标签与 Placeholder 文案规范化时，**必须先在术语标准中登记或由委托人裁决中文主术语**，再修改 UI 文案与测试断言，禁止跳过术语登记直接替换。
- **无新增产品概念**：本 Spec 新增的 `<Button>`、`<StatusPill>`、`<DataGrid>`、`<EmptyState>`、`<ConfirmDialog>`、`<SideDrawer>` / `<ModalDialog>` 均为内部前端组件名，不进入用户可见产品术语表。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/02-foundations-grid-spacing.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/13-components-toast.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/15-components-overlay.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`

### What This Change Follows

- [x] 全部原语严格消费 `app.css` `@theme` 语义 Token，零新增硬编码 hex 与 Tailwind 原始调色板类。
- [x] 保持零重型 UI 框架原则，浮层与交互底层继续复用既有 `@radix-ui/react-dialog` / `@radix-ui/react-select` / `@radix-ui/react-tooltip` 与 `sonner`。
- [x] 遵守桌面最小可读宽度 `--layout-min-readable-width: 1200px` 与 `PageHeader`（动作 ≤ 3）约束。
- [x] `MarkdownPreview` 渲染的散文表格（`.pl-markdown-table`）明确豁免于业务数据网格强制约束。
- [x] 异步三态统一复用 `AsyncRegion`（120ms 防闪烁延迟 + 固定 `minHeight` 防 CLS + 局部重试）。

### Exceptions (If Any)

- `webui/src/components/admin/AccessMapCanvas.tsx` 的 SVG 图元坐标与流带尺寸保留内联 `style`，不属于通用原语替换范围（其配色仍受 TD-187-01 约束）。
- 深色日志终端 `.pl-raw-log-frame` 需在 `01-foundations-color.md` 补充一对语义 Token（`--token-color-terminal-bg` / `--token-color-terminal-fg`），替代现有 `bg-slate-950` / `text-slate-100`。

### Follow-up Needed

- 实现 Phase 1–3 时同步更新 `webui/docs/design-system/` 对应章节（`01`、`10`、`11`、`15`、`16`），并新增 `25-new-page-blueprint.md` 与 `AGENTS.md` 入口指针。
- 若启用 Phase 2 的 `eval/` 文案收口，先完成 `00-product-terminology-standard.md` 对评测域术语的登记。

---

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 纯 MCP 客户端问数与 Live Report 消费 | 不变：本方案仅改 WebUI 前端原语、CSS 与静态门禁，不触碰 MCP Proxy、ACL 或报表数据面 | ＝ | SC-12（主路径无损）；未改 `webui/server/proxy/` | — |
| P2 治理方 | 跨页使用语义资产、评测、访问治理时面临 8 张裸表无吸顶/无排序、14 处原生 `window.confirm` 无影响面提示、22 处失效 `border-border` 边框与 25 处闪烁加载态 | 业务表格统一接入 `<DataGrid>`（吸顶 + 列排序 + 等宽右对齐数字），破坏性操作走 `<ConfirmDialog>` 明示影响面，全站异步三态无闪烁且空态给下一步引导 | ↑ | SC-02、SC-03、SC-05–SC-08、SC-11（浏览器 UAT） | — |
| P3 运维方 | 在调用监控、运维步骤、访问日志等页面排障时表头滚丢、无排序；升级/部署路径不受影响 | P3·运行观察面 ↑（高频排障表支持吸顶与排序、异步失败局部可重试）；P3·交付运维面 ＝（不改镜像/Helm/探针/备份恢复路径） | P3·运行观察面 ↑／P3·交付运维面 ＝ | SC-06、SC-07、SC-12（未改 `deploy/`、`Dockerfile`、`/api/health`） | — |
| P4 管理层 | 不直接操作界面，消费概览与审计摘要口径 | 不变：不改任何业务指标计算、覆盖率口径或审计数据源 | ＝ | SC-12（无后端统计口径变更） | — |

---

## 第一性原理检查

| # | 问题 | 回答 |
|---|---|---|
| 1 | 问数主路径是否仍可用？ | 是。零后端与 MCP 代理改动，不触碰数据问答链路。 |
| 2 | 拒绝／门禁是否有逃生？ | 是。`lint:design-system` 对存量违规采用「基线文件只减不增」机制，不阻断无关功能 PR；新增例外须按 `99-governance.md` 登记 TD 与升级期限。 |
| 3 | 验收是否覆盖约束＋合法成交？ | 是。既验 `lint:design-system` 对违规代码的拦截（负向），也验原语组件、迁移页面与新页蓝图在真实浏览器中交互成交（正向）。 |
| 4 | 是否避免宿主缺席 BLOCKED？ | 是。全部验证基于本地 Docker / WebUI 开发实例与真实浏览器 UAT，不依赖外部宿主。 |

---

## 1. 背景与根因

### 1.1 现状问题（来自 `8057bf76` 评审报告 v1.1）

仓库已在 `webui/docs/design-system/` 沉淀 15 篇完整规范文档，但新建页面仍频繁“自由发挥”，根因有三：

1. **规范未下沉为代码原语**：开发者/Agent 缺少开箱即用的 `<StatusPill>`、`<ConfirmDialog>`、`<SideDrawer>`、`<ModalDialog>`、`<DataGrid>`、`<EmptyState>`，手写原生标签与零散类名比查 3,156 行 `app.css` 更快。
2. **机器门禁存在视觉与交互盲区**：`pretest` 的 5 项门禁未覆盖非 Token 色板（19 处）、失效 Tailwind 类（22 处 `border-border` + 1 处 `bg-bg`）、原生 `window.confirm`（14 处）、业务裸表（8 张）、临时 `z-[70]`/`z-[60]` 与手写 `加载中…`（25 处）。
3. **缺少新建页面蓝图**：无统一脚手架/蓝图约束新页的骨架与路由同步链，且 `e2e:release-ux` 非 PR 阻塞项。

### 1.2 与既有 Backlog 条目的关系

| 既有条目 | 定位 | 与本方案的关系 |
|---|---|---|
| `REQ-030-044`（P1-23） | UI/UX 标准文档收敛并与 `DEVELOPMENT.md` 绑定 | 侧重文档对齐；本方案在其之上补齐**代码原语层 + 静态机器门禁**，防止文档与代码再次脱节 |
| `REQ-030-045`（P1-24） | WebUI 存量逐页 UI/UX 整改（UXR-01–09，B1–B4） | 侧重逐页修补存量缺陷；本方案先建原语与门禁，再借 Phase 1–3 清零存量基线，避免“边改旧页、边产新债” |

---

## 2. 四层根治架构（核心合同）

本方案不引入外部重型 UI 框架，基于现有 React 19 + Tailwind v4 + Radix Primitives 建设四层防线。

### 2.1 第一层：受限 UI 原语库（`webui/src/components/ui/`）

新增统一出口 `webui/src/components/ui/index.ts`，对外只暴露语义 props（禁止通过随意透传色板类破坏规范），让**按规范拼装比手写更快**：

| 原语组件 | 核心 Props 契约 | 解决的问题与替换目标 |
|---|---|---|
| `<Button>` | `variant: "primary" \| "secondary" \| "ghost" \| "danger" \| "danger-ghost"`、`size: "sm" \| "md" \| "lg"`、`loading?: boolean`、`disabledReason?: string` | 剥离 `.pl-btn--xs` 全局 `min-w-[7.5rem]` 外溢；补齐 `danger` hover 态与 `danger-ghost`；统一 `aria-disabled` 提示 |
| `<StatusPill>` | `tone: "neutral" \| "info" \| "success" \| "warning" \| "danger"`、`variant: "soft" \| "outline"`、`size: "xs" \| "sm"` | 收敛 `app.css` 中 12+ 套重复 Badge/Status 类族；状态类统一 `rounded-pill soft`，元数据标签统一 `rounded-sm outline font-mono` |
| `<DataGrid>` | `columns`（含 `align: "left" \| "right"`、`numeric?: boolean`、`sortable?: boolean`）、`stickyHeader?: boolean`、`sortState` / `onSortChange`、`pagination`、`emptyState` | 收口 8 张业务裸表；全站补齐表头吸顶、`aria-sort` 列排序、纯数值右对齐 + `tabular-nums`、统一分页栏（含游标加载更多） |
| `<EmptyState>` | `kind: "no-data" \| "no-match"`、`title`、`description`、`action`（主引导按钮或「清除全部筛选」） | 终结 `FieldQuestions`/`RunList`/`SkillList` 等死文本空态，强约束给出下一步指引 |
| `<ConfirmDialog>` | `open`、`tone: "danger" \| "warning"`、`title`、`description`、`impactItems?: string[]`、`confirmLabel`、`requireTextMatch?: string`、`onConfirm` | 基于 Radix Dialog 替换全部 **14 处** `window.confirm`（含 `useRolesAgentDraftGuard.ts`）；高危操作明示影响面与明确动词按钮 |
| `<SideDrawer>` / `<ModalDialog>` | `open`、`size: "sm" \| "md" \| "lg"`、`title`、`description`、`footer`、`onClose` | 收敛 9 套 `fixed` 浮层样式；统一遮罩、圆角、内边距与 `--z-*` 层级阶梯，消除 `z-51` 与 `AgentDetail.tsx` 的 `z-[70]`/`z-[60]` |

既有优质组件（`PageHeader`、`AsyncRegion`、`RowMoreMenu`、`SelectField`）保留并从 `components/ui/index.ts` 重导出，形成单一 import 入口。

### 2.2 第二层：静态门禁 `lint:design-system`（存量只减不增）

沿用 `lint-copy-surfaces.mjs` / `lint-button-feedback.mjs` 的工程范式，新增 `webui/scripts/lint-design-system.mjs`，接入 `webui/package.json` 的 `pretest`：

| 规则 ID | 拦截内容 | 扫描范围（排除 `__tests__/`） | 豁免规则 |
|---|---|---|---|
| **DS-R1** | Tailwind 原始调色板类（`(bg\|text\|border)-(slate\|gray\|red\|green\|amber\|blue\|...)-\d+`）、裸 hex（`#[0-9a-fA-F]{3,8}`）以及未在 `@theme` 定义的 `border-border` / `bg-bg` | `src/{app,pages,components,lib}` 与 `app.css`（`:root` 原值层除外） | 仅允许 `tokens.css` 的 `:root` 块 |
| **DS-R2** | 浏览器原生 `window.confirm(`、`window.alert(`、裸 `confirm(` | `src/{app,pages,components,lib}` | 无豁免（存量进入 baseline，Phase 1 清零） |
| **DS-R3** | 未接入 `.pl-data-grid` 或 `<DataGrid>` 的裸 `<table` 标签 | `src/{pages,components}` | 仅豁免 `src/components/MarkdownPreview.tsx`（`.pl-markdown-table`） |
| **DS-R4** | 硬编码层级 `z-[\d+]`、`z-index:\s*51` 及页面内手写非原语 `fixed inset-0` 遮罩 | `src/{pages,components}`、`app.css` 业务段 | 仅原语样式层 `primitives.css` 允许声明浮层定位 |
| **DS-R5** | 页面内手写裸 `加载中` 占位节点（绕过 `AsyncRegion`） | `src/pages/` | 按钮提交态文案（如 `保存中…`、`启动中…`）不触发，仅拦整区占位 `加载中` |

**只减不增 Baseline 机制（`webui/scripts/design-system-baseline.json`）**：

- 门禁上线首日按 commit 现状生成各文件的存量计数基线；
- 任何 PR 若在任意文件**新增**违规（实际数 > 基线数），`npm run lint:design-system` 直接 exit 1 阻塞；
- 当 PR 修复存量违规（实际数 < 基线数）时，要求同步调低 baseline（否则提示更新基线），确保债务单向归零、绝不回流；
- Phase 1–3 清零完成后，删除对应规则的 baseline 条目，转为全仓零容忍。

### 2.3 第三层：新建页面蓝图与 `AGENTS.md` 硬入口

1. 新增 [`webui/docs/design-system/25-new-page-blueprint.md`]（规划落位）：
   - 提供 **3 类标准页面骨架**（列表管理页、双栏浏览器/工作台、对象详情页）的最小可复制 TSX 模板，固定组合 `PageHeader` + `AsyncRegion` + `DataGrid` + `EmptyState` + `ConfirmDialog` + `RowMoreMenu`。
   - 固化**新页路由同步清单**：`navigation.ts`（须先获 IA 独立确认）→ `navIcons.ts` → `App.tsx`（`Routes` + `GROUP_ICONS`）→ `server/admin/ui-usage.ts`（`UI_USAGE_MENUS` + `EXACT_PAGES`，由 `admin-ui-usage.test.ts` 回归兜底）→ `docs/SYSTEM_HANDBOOK.md` §1.5。
   - 固化**表单与搜索提示词规范**：搜索框统一「`搜索<字段1>、<字段2>…`」（中文省略号）；格式示例统一「`例如：<样本>`」；禁止暴露 URL Query 语法（如 `写入 agent=`）与与 `<label>` 重复的占位词。
2. 在根目录 `AGENTS.md` 增加一条简短入口指针（不复述正文）：新建或改版 WebUI 页面必须遵循 `25-new-page-blueprint.md`、优先复用 `webui/src/components/ui/` 原语并通过 `npm run lint:design-system`。

### 2.4 第四层：`app.css` 分层拆解与 `--z-*` 层级阶梯

在 Phase 3 将 3,156 行 `webui/src/app/app.css` 拆分为入口 import 的分层结构（保持单入口构建，零运行时性能退化）：

- `styles/tokens.css`：`:root` 颜色/圆角/阴影/终端色与显式层级阶梯（`--z-sticky: 10`、`--z-dropdown: 20`、`--z-dock: 30`、`--z-overlay: 40`、`--z-drawer: 50`、`--z-modal: 60`、`--z-popover: 70`、`--z-toast: 80`）+ `@theme`；
- `styles/base.css`：全局 reset 与 shell 骨架；
- `styles/primitives.css`：6 大原语样式；
- `styles/features/*.css`：按业务域拆分（`connections.css`、`catalog.css`、`wiki.css`、`skills.css`、`audit.css`、`publish.css`），同时删除 `app.css:2314-2333` 的 20 条死样式，合并 `.pl-inspector`（3 处）与 `.pl-command-palette-list`（2 处）重复声明。

---

## 3. 分阶段实施包（可独立授权）

| 批次 | 定位 | 核心交付物 | 预计工作量 | 依赖与前置 |
|---|---|---|---|---|
| **Batch A（先建防线）** | 门禁 + 蓝图 + 最小原语 | `lint-design-system.mjs` + baseline 文件、`25-new-page-blueprint.md`、`AGENTS.md` 指针、`<Button>` + `<ConfirmDialog>` | 3–5 天 | 终稿确权 + 开发授权；立即可止住“新页自由发挥” |
| **Batch B（Phase 1 止血）** | 存量高危与退化清零 | 替换 19 处非 Token 调色板 + 22 处 `border-border` + 1 处 `bg-bg`；迁移 8 张裸业务表；替换全部 14 处 `window.confirm`；修 `.pl-btn--xs` 外溢与 `.pl-btn--danger` hover | 1–2 周 | 依赖 Batch A 的 `<Button>` / `<ConfirmDialog>` |
| **Batch C（Phase 2 体验升级）** | 网格 + 异步 + 提示词 | `<DataGrid>`（吸顶 + 列排序 + 对齐）落地 5 个高频页；`AsyncRegion` 替换 25 处 `加载中…`；`<EmptyState>` 补 Next-Step；过 G3 术语登记后统一 Placeholder | 2–3 周 | 术语改动前先过 `00-product-terminology-standard.md`（G3） |
| **Batch D（Phase 3 架构收口）** | 样式解体与浮层/徽章收口 | `<StatusPill>` 收敛 12+ 套 Badge；`<SideDrawer>`/`<ModalDialog>` 收敛 9 套浮层并清除 `z-[70]`/`z-[60]`；拆分 `app.css`；`CommandPalette` + `/` 快捷键增强 | 2 周 | 可按子模块分 PR 滚动合入 |

---

## 4. 验收标准（SC）

| ID | 维度 | 验收要点 | 验证方式 |
|---|---|---|---|
| **SC-01** | 静态门禁拦截 | 故意引入 `text-red-500`、`border-border`、`window.confirm`、业务裸 `<table>`、`z-[70]` 或页面裸 `加载中` 时，`npm run lint:design-system` 均稳定报错并给出文件行号 | 单元/脚本负向测试（`lint-design-system.test.mjs`） |
| **SC-02** | Baseline 只减不增 | 存量违规清零前，新增违规触发 fail；存量减少但未更新 baseline 时给出提示；Batch B–D 完成后对应规则 baseline 归零 | 脚本正负向测试 |
| **SC-03** | 配色与失效类清零 | 全仓零非 Token Tailwind 调色板、零 `border-border`（22 处清零）、零 `bg-bg`（1 处清零）；`eval/` 页面边框与下拉底色在浏览器中清晰可见 | 静态门禁 ＋ **真实前台浏览器截图/检查** |
| **SC-04** | 原生确认流清零 | 全仓 `webui/src/` 14 处 `window.confirm`/`confirm()` 全部替换为 `<ConfirmDialog>`（含 `useRolesAgentDraftGuard.ts:17`），高危操作展示影响面与明确动词按钮 | 静态门禁 ＋ **真实前台浏览器交互实测** |
| **SC-05** | 业务数据表统一 | P0-01 的 8 张业务裸表 100% 迁入 `.pl-data-grid` / `<DataGrid>`；`MarkdownPreview` 散文表 `.pl-markdown-table` 保持不受影响 | 静态门禁 ＋ **真实前台浏览器实测** |
| **SC-06** | 网格吸顶与列排序 | `Catalog`、`Tokens`、`AgentList`、`RunList`、`PublishHistory` 5 个高频页支持表头吸顶、点击表头切换升/降序（带 `aria-sort`）与数值列右对齐 `tabular-nums` | 单测 ＋ **真实前台浏览器滚动与排序实测** |
| **SC-07** | 异步三态与空态引导 | 25 处手写 `加载中…` 全部迁移至 `AsyncRegion`；无数据/无命中空态走 `<EmptyState>` 并提供可点击下一步或「清除筛选」 | 单测 ＋ **真实前台浏览器实测（含慢网/错态重试）** |
| **SC-08** | 提示词与术语合规 | `AccessMap` 消除 `"写入 agent="` 等参数语法；全站搜索框统一中文省略号；涉及 `domain` 等新词已先过 `00-product-terminology-standard.md` 登记且 `lint:terminology` 全绿 | `lint:terminology` ＋ 人工抽检 ＋ 浏览器实测 |
| **SC-09** | 按钮与浮层收敛 | `.pl-btn--xs` 剥离全局 `min-w` 后两字「重试」按钮比例正常；`.pl-btn--danger` hover 有明确反馈；抽屉内再开 `<ConfirmDialog>` 或下拉框无 z-index 遮挡（消除 `z-[70]`/`z-[60]`） | **真实前台浏览器实测**（抽屉叠弹窗场景） |
| **SC-10** | 样式表分层与构建 | `app.css` 拆解为 `tokens/base/primitives/features` 后，`npm run build`、`npm run typecheck`、`npm test` 全绿，20 条死样式与重复声明清零 | 构建与全量测试 |
| **SC-11** | 浏览器＋分列计时 | 凡主张 WebUI PASS 的验收项均按 `docs/qa/uat/CONVENTIONS.md` 在真实前台浏览器执行，记录前端渲染/交互即时计时并与 API 耗时分列 | UAT 实测记录 |
| **SC-12** | 主路径无损 | MCP 问数主路径、既有全部 27 条侧栏路由、部署/探针路径均不受影响；`e2e:smoke` 与 `admin-ui-usage.test.ts` 全绿 | 回归测试 ＋ 浏览器冒烟 |

---

## 5. 非目标与开放决策（OQ）

### 5.1 明确非目标

- 不引入 Ant Design / MUI / Chakra 等重型组件库，避免包体膨胀与二次样式覆盖。
- 不在本 Spec 中改动任何侧栏菜单或二级页 Tab（如需调整须另走 IA 独立确认）。
- 不在本 Spec 中做 Dark Mode 主题切换（但 `tokens.css` 与零裸色板门禁会为未来主题化打好地基）。

### 5.2 待委托人确认的开放问题（OQ）

| ID | 议题 | 建议方案 |
|---|---|---|
| **OQ-1** | 是否优先只授权 **Batch A（门禁 + 蓝图 + `<Button>`/`<ConfirmDialog>`）** 先行落地，最快锁住后续所有新页面的规范底线？ | **建议是**：3–5 天即可形成“新代码零违规”的硬护栏，Batch B–D 再按排期滚动清零存量 |
| **OQ-2** | 既有 `REQ-030-044` / `REQ-030-045` 与本方案（建议 `REQ-0123`）是否合并或标注承接关系？ | 建议新增 `REQ-0123` 承载原语库＋静态门禁＋蓝图，并将 `REQ-030-044` / `REQ-030-045` 标注为由本方案分批承接或后续归档 |
| **OQ-3** | `eval/` 模块的 `Domain` 标签中文主术语如何定稿（避免与 Skill 域 Protected term `domain` 冲突）？ | 建议在 Batch C 启动前由术语标准明确「评测域（Domain）」或沿用「Domain」的统一口径 |

### 5.3 建议登记到 `docs/backlog/README.md` 的需求台条目草案（待确认入池）

```markdown
| REQ-0123 | — | 需求 | P1 | WebUI 设计系统强制落地：受限 UI 原语库、`lint:design-system` 门禁与新建页面蓝图 | S1｜ | — | [Spec](../specs/lucy-20261128-design-system-enforcement-and-primitives-spec.md) · [UI/UE 评审](../reviews/2026-11-28-webui-ui-ue-interaction-review.md) |
```
