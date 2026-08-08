# Button Hierarchy, Selection Controls, and Icon Affordance Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Button Hierarchy, Selection Controls, and Icon Affordance Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | Attu v3 官方截图（Home / Overview / Explorer / Backups / Playground / Search）；Attu v2.5.12 OSS `ToolBar` / `ActionBar`；Lucy `webui/docs/design-system/10-components-button.md`；`docs/ui-ux-feedback/README.md` 主题 `button hierarchy consistency` / `button semantic consistency`；Spec 81 / 91；对比 Canvas `attu-vs-lucy-button-ux` |
| 适用范围 | 全站按钮层级、选中控件、图标工具按钮与 PageHeader 动作预算；升级 Design System 按钮章节并落地首批高杠杆页面 |
| 输出位置 | `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 101 |
| 关联工单 | `webui/docs/plans/wo-202608-34-button-hierarchy-selection-and-icon-affordance.md` |
| 关联页面 | 横切：全站 `pl-btn` / PageHeader；首批落地：`/eval/cases`、`/overview`、`/connections`；规范事实源：`design-system/10-components-button.md` |
| 关联台账 | `docs/ui-ux-feedback/pages/eval.md`（`UX-EVAL-004`）；`docs/ui-ux-feedback/pages/overview.md`（`UX-OVERVIEW-015`）；`docs/ui-ux-feedback/pages/connections.md`（`UX-CONNECTIONS-024`）；跨页面主题见 §11 |
| 上游 Spec | Design System `10-components-button.md`；Spec 81（Wiki Header primary）；Spec 91（列表 Header）；Spec 73（secondary vs ghost） |
| 状态 | Draft |
| 日期 | 2026-08-05 |
| 范围 | 升级按钮规范；禁止选中态用 primary；PageHeader 动作预算；新增 `pl-icon-btn`；首批页面收敛；loading / disabledTooltip 契约 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿：自 Attu vs Lucy 按钮对比收敛为可执行规范与 Wave A/B |

## 1. 背景

Lucy 已具备 `primary / secondary / ghost / danger` 与「同组最多一个 primary」规则，并在 Connections / Overview / Wiki 等多轮 ledger 中收敛。对照 Attu（运维控制台同类产品）后确认：**最大差距不在品牌色，而在层级纪律与密度**：

1. Attu 列表页 Header 通常只有 **1 个**实心主 CTA（如 `+ New Backup`、`Send`）；工具动作（刷新 / 搜索 / 复制）为 **icon-only ghost**。
2. Attu 的 Tab / SDK 切换使用 recessed **segmented control**，选中态为白底浮起，**绝不染色成 Primary**。
3. Attu 表行动作极轻（ghost 文案 / 红危险图标）；disabled 配 **disabledTooltip** 解释前置条件。
4. Lucy 侧：`/eval/cases` 域名切换仍用 `pl-btn--primary` 表示选中；Overview / Connections 刷新等工具动作仍占完整文案按钮；Design System 未定义 icon-btn、Header 动作预算、选中控件与 loading/disabled 可解释性。

本 Spec **不换肤成 Attu 绿**；吸收其层级与密度纪律，升级 Lucy 既有按钮事实源。

## 2. 目标

1. **升级** `webui/docs/design-system/10-components-button.md` 为 v1.1：补充选中控件分离、Header 动作预算、`pl-icon-btn`、loading 锁宽、disabled 解释。
2. **禁止**用 `pl-btn--primary` / `pl-btn--danger` 表达「当前选中」；筛选 / 域名 / 时间窗 / 视图切换一律走 `pl-segmented-control`（或等价 recessed pill）。
3. **PageHeader actions 预算**：可见槽位 ≤ 3（至多 1 primary + ≤ 2 secondary/ghost）；超出进「更多」菜单（本轮可先文档化预算，溢出菜单实现可延后到 Wave C）。
4. **新增** `.pl-icon-btn`（及可选 React 薄封装）：32×32 ghost 图标按钮，强制 `aria-label` + tooltip。
5. **首批落地**：
   - `/eval/cases` 域名 Tab → segmented（`UX-EVAL-004`）。
   - `/overview`「刷新首页数据」→ icon-btn + 保留相邻「上次更新」徽标（`UX-OVERVIEW-015`）；MCP 区并列动作保持 secondary，复制可保留文案或降为 icon+tooltip（与 Spec 10 §6 同级策略兼容）。
   - `/connections`「刷新本地目录」→ icon-btn + tooltip（`UX-CONNECTIONS-024`）；「+ 添加 Schema」保持 secondary 文案按钮（可加 leading `+`）。
6. **Loading / Disabled**：`pl-btn[data-loading]` 锁 min-width；disabled 时提供可见 tooltip 或 `aria-describedby` 说明原因（首批覆盖新改按钮）。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 不改品牌主色为 Attu 绿 | 学纪律不换肤 |
| 不引入右键 context menu 全局框架 | Wave C；本轮不阻塞 |
| 不扫全站表行动作改 ghost | Wave C；避免无边界大改 |
| 不改 API / 路由 / 术语标准新概念（除按钮规范文案） | 纯交互层 |
| 不做浏览器验证（本轮） | Vitest + terminology + build + code review |
| 不强制所有主 CTA 加 leading icon | 可选；中文主路径以文案为准 |
| 不合并 Spec 100 指标卡 icon 工作 | Spec 100 独立；本单只动动作按钮 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`.

| Canonical Term | UI 主术语 | 禁止 | 说明 |
|---|---|---|---|
| Primary Action | （页面声明的主动作文案，如「保存」「编辑」「新建 Agent」） | 用 primary 表示「已选中」 | 唯一推荐下一步 |
| Secondary Action | 并列维护动作文案 | — | 描边按钮 |
| Icon Button | （无可见文案；aria-label 说明动作） | 无障碍名称缺失的纯图标 | 刷新 / 复制 / 更多 |
| Segmented Control | （各选项业务名，如域名、24h/7d） | 把选中项做成「主按钮」 | 选中 ≠ primary |
| More Actions | 更多 | …（无障碍名缺失） | Header 溢出 |

Protected：既有产品名、path、`MCP`、`Agent` 等按术语标准。

**无新增产品概念**；`pl-icon-btn` / `segmented` 为设计系统术语，不进用户文案。

## 5. Design System 升级（事实源）

必须修订 `webui/docs/design-system/10-components-button.md` → **v1.1**，新增 / 强化：

### 5.1 类型矩阵（扩展）

| Variant | 用途 | 视觉 |
|---|---|---|
| `primary` | 唯一主路径 | 实心主色 |
| `secondary` | 并列维护 | 描边 |
| `ghost` | 低干扰辅助 / 行内 | 无边框 |
| `danger` | 不可逆风险 | 危险色描边/软底 |
| `icon`（新） | 工具型、无可见文案 | `.pl-icon-btn`，默认 ghost 图标 |

### 5.2 选中态分离（强约束）

- **禁止** `pl-btn--primary` / `pl-btn--danger` 表示当前选中的筛选、Tab、域名、时间窗、视图。
- **必须**使用 `.pl-segmented-control` + `.pl-segmented-control-item--active`（或文档登记的等价模式）。
- 选中态视觉：轨道浅底 + 白底浮起 / 轻微 shadow；**不得**使用主色实心填充冒充按钮层级。

### 5.3 PageHeader 动作预算（强约束）

| 规则 | 要求 |
|---|---|
| 可见上限 | ≤ 3 个可见动作控件（不含状态徽标） |
| Primary | 同组至多 1 个；位于组首或组末，且与页面 Spec 主动作一致 |
| 并列维护 | 默认全部 `secondary`（延续既有规则） |
| 工具刷新/复制/更多 | 优先 `pl-icon-btn`，不占文案按钮宽度 |
| 溢出 | >3 时低频动作进入「更多」；本 WO Wave A 可只强制预算审计，溢出菜单实现标 Wave C |

### 5.4 `pl-icon-btn` 契约

- 尺寸：默认 32×32（`h-8 w-8`），与 `pl-btn--xs` 高度节奏对齐。
- 必须：`type="button"`、`aria-label`（中文动作名）、可见或可聚焦 tooltip（hover/focus）。
- 禁止：无障碍名称仅依赖图标形状。
- 状态：hover / focus-visible / disabled / loading 与 `pl-btn` 同等要求。

### 5.5 Loading / Disabled

- Loading：`data-loading="true"` + `aria-busy="true"`；锁定 `min-width` 为触发前宽度或预设；文案用进行时（「保存中…」「刷新中…」）或 icon-btn 内 spinner。
- Disabled：除 `opacity` 外，若存在可解释前置条件，必须 tooltip / `aria-describedby`（例如「请先选择至少一个对象」）。

### 5.6 PR Compliance 增补

`30-pr-compliance-template.md` 按钮相关勾选追加：

- [ ] 选中态是否误用了 primary？
- [ ] PageHeader 可见动作是否 ≤ 3？工具动作是否优先 icon-btn？
- [ ] disabled 是否解释原因？

## 6. 首批页面变更

### 6.1 `/eval/cases`（`UX-EVAL-004`）

| 项 | 调整前 | 调整后 |
|---|---|---|
| 域名切换 | `pl-btn` + 选中 `pl-btn--primary` / 未选中 `pl-btn--ghost` | `pl-segmented-control`（列数随域名动态或横向 wrap 的 segmented 项）；选中用 `--active` |
| 「新建 Case」 | `pl-btn--ghost` | 保持或升为该区唯一 `secondary`/`primary`（若为页内主路径）；**不得**与域名选中抢 primary |

实现注意：域名数量可能 >3，允许 segmented 横向 wrap，或使用可滚动轨道；**禁止**回退到 primary 按钮组。

### 6.2 `/overview`（`UX-OVERVIEW-015`）

| 项 | 调整前 | 调整后 |
|---|---|---|
| 刷新首页数据 | 文案 `pl-btn--secondary` | `pl-icon-btn`（刷新图标）+ `aria-label="刷新首页数据"` + tooltip；紧邻「上次更新」徽标保持同组（延续 Spec 41 / ledger 邻接规则） |
| MCP 复制 / 查看配置 | 并列 `secondary` | **保持同级 secondary**（不升 primary）；可选：复制改为 icon-btn，查看配置保留文案 secondary——若只改其一，须在 Notes 说明同组视觉仍可读 |

### 6.3 `/connections`（`UX-CONNECTIONS-024`）

| 项 | 调整前 | 调整后 |
|---|---|---|
| 刷新本地目录 | 文案 `secondary`（与添加 Schema 同级） | `pl-icon-btn` + `aria-label`/`tooltip`「刷新本地目录」 |
| + 添加 Schema | `secondary` 文案 | 保持 `secondary`；可加 leading `+` |

同组视觉：文案 secondary + icon-btn 允许并存，因语义一为「创建」、一为「工具刷新」，符合 Attu Backups「New Backup / Upload / Refresh」节奏。

## 7. 实现要点

| 区域 | 文件（预期） |
|---|---|
| CSS | `webui/src/app/app.css`：`.pl-icon-btn`、`pl-btn[data-loading]` |
| 可选组件 | `webui/src/components/IconButton.tsx`（薄封装，非必须；可用纯 class） |
| Eval | `webui/src/pages/eval/CaseList.tsx` |
| Overview | `webui/src/pages/Onboarding.tsx` |
| Connections | `webui/src/components/catalog/CatalogReloadButton.tsx` 及/或 `ConnectionOverview.tsx` |
| Design System | `10-components-button.md` v1.1；`30-pr-compliance-template.md` 勾选 |
| 测试 | `eval-cases.test.tsx`、`onboarding.test.tsx`、`connection-overview.test.tsx` |

## 8. 验收标准

1. `10-components-button.md` 为 v1.1，含 §选中分离、Header 预算、icon-btn、loading/disabled 条款。
2. `/eval/cases` 域名切换 DOM **不含**以 `pl-btn--primary` 表示选中的域名按钮；存在 `pl-segmented-control`（或登记等价 class）。
3. Overview 刷新控件为 icon-btn，具备中文 `aria-label`；「上次更新」仍与刷新同组。
4. Connections「刷新本地目录」为 icon-btn；「添加 Schema」仍为 secondary 文案按钮。
5. 新改按钮在 loading 时具备 `data-loading` 或等价稳定宽度策略（至少覆盖刷新类）。
6. `cd webui && npm test` 相关用例通过；`lint:terminology`、`build` 通过。
7. 台账 `UX-EVAL-004` / `UX-OVERVIEW-015` / `UX-CONNECTIONS-024` → `Fixed`；跨页面主题已登记。
8. 本轮不做浏览器验证。

## 9. 测试要求

- `eval-cases.test.tsx`：域名切换不使用 `pl-btn--primary` 作为选中；断言 segmented active class；「新建 Case」可达。
- `onboarding.test.tsx`：刷新控件 `aria-label` 含「刷新」；class 含 `pl-icon-btn`（或 data-testid）；不破坏上次更新徽标断言。
- `connection-overview.test.tsx`：刷新为 icon-btn；添加 Schema 仍 secondary；无双 primary。
- 可选：轻量 CSS/组件 smoke（若新增 `IconButton.tsx`）。

## 10. Wave 边界（本 Spec 与后续）

| Wave | 内容 | 本 WO |
|---|---|---|
| A | Design System v1.1 + CaseList segmented + 规范/PR checklist | **必须** |
| B | `pl-icon-btn` + Overview / Connections 刷新图标化 | **必须** |
| C | Header「更多」菜单；全站行内 ghost 扫尾；disabledTooltip 平台化 | **延期**（仅文档登记，不阻塞合并） |

## 11. 跨页面主题（台账）

本 Spec 关闭前须在 `docs/ui-ux-feedback/README.md` 登记 / 更新：

| Theme | 说明 |
|---|---|
| `selection-control not primary` | 选中态不得使用 primary/danger 按钮 |
| `header action budget` | PageHeader 可见动作 ≤3；工具优先 icon-btn |
| `icon-button affordance` | 工具刷新/复制/更多用 pl-icon-btn + aria-label + tooltip |
| `disabled action explainability` | disabled 须解释前置条件（Wave C 平台化） |

既有主题 `button hierarchy consistency`、`button semantic consistency` 保持，本 Spec 为其强化而非替换。

## 12. Design System Compliance（本单自检）

### Referenced Specs
- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`（本单升级至 v1.1）
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows
- 视觉层级与交互语义一致（主路径 / 并列 / 工具 / 选中分离）
- 不新增硬编码品牌色；沿用 token
- 焦点态、禁用态、加载态契约写入规范

### Exceptions
- Wave C 溢出菜单与全站行内扫尾不在本 WO 实现

### Follow-up Needed
- Wave C：`disabledTooltip` 平台组件；Header More menu；表 Actions 列密度扫尾
