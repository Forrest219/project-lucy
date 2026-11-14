# WebUI 存量 UI/UX 整改 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI 存量 UI/UX 整改 Spec |
| 文档类型 / 版本 | Spec（整改总纲）/ **v0.2-draft** |
| 状态 | **v0.2 草案（已含浏览器盘点），待委托人确认范围、批次与 §5 裁决项**。清单编号 P1-24／REQ-030-045。**本 Spec 与配对 Plan 只做优化方案，不做开发，不构成任何页面的开发授权**；各批改运行代码须各自另入子 Plan、终稿确权、委托人另发开发授权 |
| 撰写日期 | 2026-11-14 |
| 撰写人 | Claude |
| 委托人 | zhangxingchen |
| 基于材料 | [`webui/docs/design-system/`](../../webui/docs/design-system/README.md) 全部章节（含 2026-11-14 新增 15、16）、`webui/src/` 静态盘点（`rg` 与 `lint:url-driven-input`／`lint:terminology`）、**2026-11-14 浏览器盘点**（Lucy demo 容器，1920×1080／1440×900／1280×800）、[核对报告](../../inbox/20261114-0130-uiux-standard-audit.md)、[盘点脚本](../../inbox/uiux-browser-audit/audit.js) |
| 适用范围 | 逐页整改的问题清单、批次、验收口径；后期每页整改均引用本 Spec 的 UXR 编号 |
| 输出位置 | `docs/specs/lucy-20261114-webui-uiux-remediation-spec.md` |
| 总账 | [功能清单池](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) P1-24；[需求池](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md) REQ-030-045；**不入核心分母** |
| 实施主体 | 本 Spec 本身仅文档。整改实施主体是 `webui/src/`，不改 KTX |

## 闭口层级

- 层级：功能合同
- 本条承诺：把已核实的存量 UI/UX 偏差登记成带证据命令的 UXR 清单，给出整改意见、批次与逐页验收口径；清单可由命令复跑。
- 本条出口：SC-01–SC-06（§9）。
- 不在本条出口：任何页面的实际整改、浏览器走查、截图验证、移动窄屏、发版走查签字、UAT、客户环境。
- 上线关系：本条收口不表示可上线

---

## 交互合同豁免

- 原因：本 Spec 只落盘问题清单与整改意见，不改变用户可见 WebUI 表面；文中出现的 `webui/src/` 路径仅作证据指向。
- 不改变：页面、组件、颜色、间距、文案与路由。各页整改在各自的 Spec／Plan 中重新走交互合同，不继承本豁免。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None.

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/15-components-overlay.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/03-foundations-typography.md`

### What This Change Follows

- [x] 本条只登记偏差，不新增视觉模式。
- [x] 整改目标均取自上列章节的既有规定，没有自创新口径。
- [x] 浮层收敛方向沿用 `15-components-overlay.md` v1.1（委托人 2026-11-14 裁决）。

### Exceptions (If Any)

- None.

### Follow-up Needed

- D-1–D-4 需委托人裁决（§5），才能确定 UXR-09、UXR-10、UXR-11、UXR-12 是否整改；D-1–D-3 还要先在设计系统对应章节补条款。

## 核心流程（伪代码）

伪代码豁免：本 Spec 为问题清单与整改总纲，不引入算法或状态机；每批整改的流程由该批 Plan 描述。

---

## 1. 背景

2026-11-14 设计系统收敛后，新增了浮层与状态两章，并清理了临时决策。对照现行规范盘点 `webui/src/`，发现一批存量偏差。委托人同意：把偏差与整改意见落盘为本 Spec，**后期逐页修改**。

## 2. 盘点方法与限度

**静态**：对 `webui/src/`（排除 `__tests__`）做 `rg` 检索，并运行 `npm run lint:url-driven-input`、`lint:terminology`、`lint:ia-boundary`。

**浏览器**（2026-11-14，委托人指示后补做）：
- 对象：本机 Lucy demo 容器 `http://127.0.0.1:55176`（`gitSha` 82809ae，`gitDirty`，容器创建于 2026-11-13 23:50）；已登录 `verify-admin`。涉及的 UI 源文件修改时间均早于容器创建，视为与当前源码一致，**但容器 `gitSha` 与仓库 HEAD 不同，结论以容器为准**。
- 视口：1920×1080（`Emulation` 未改）；另用 `Emulation.setDeviceMetricsOverride` 临时切到 1440×900、1280×800，用完已清除。不做移动窄屏。
- 路由：1440×900 下遍历 32 条路由；1920×1080 下对约 20 个主要页面做逐页审计；1280×800 下遍历 23 条。
- 判定项：`h1`／`PageHeader`、文档级横向溢出、无名按钮、小点击目标、无标签输入、表格是否落在 `pl-data-grid`、小字号、文本对比度（按 WCAG 公式，含背景叠加）、空状态、浮层语义与键盘行为。
- 浮层探针：点击打开 → 记录 `role`／`aria-modal`／名称／焦点 → 发 `Escape` → 看是否关闭。破坏性按钮（吊销）**只打开、不确认**。`续期` 浮层另用真实 `Escape` 按键复验，结果一致。
- 脚本：`inbox/uiux-browser-audit/audit.js`（临时文件，定稿后迁入证据目录）。

**限度**：
- 没有截图证据（截图接口多次超时），结论全部来自 DOM 与计算样式。
- 视觉层级、间距美感、动效、真实键盘 Tab 顺序与 `focus-visible` 样式**未判定**（程序化聚焦不触发 `:focus-visible`，该项不下结论）。
- 评测运行、字段问题等页面在 demo 里没有数据，对应表格只能保持静态结论（见 UXR-04）。
- `rg` 会漏掉动态拼接的类名。**本清单是下限，不是完整列表。**

## 3. 盘点中未发现偏差的项（避免重复劳动）

| 检查项 | 结果 | 依据 |
|---|---|---|
| 每个可达页面恰好一个 `h1` 且有 `PageHeader` | 1440×900 下遍历的页面均满足 | 浏览器 |
| 文档级横向溢出 | 1440×900、1920×1080 下 0 处；1280×800 下 0 处（但见 UXR-14、UXR-15 的容器内溢出） | 浏览器 |
| 无名按钮（无文本、无 `aria-label`、无 `title`） | 约 20 个页面 0 处 | 浏览器 |
| `PageHeader` 动作预算 | 可见动作 ≤ 3，且 primary ≤ 1（发布工作台 3 个动作，其余 ≤ 2） | 浏览器 |
| `.tsx` 中裸 hex／`rgb()` | 0 处 | 静态 |
| 用 `primary`／`danger` 表示选中态 | 0 处（启发式匹配） | 静态 |
| Toast 落点 | 合规：唯一 `<Toaster position="bottom-right" />` | 静态 |
| `MetricCard` 的 ⓘ | 类型强制 `help` | 静态 |
| `lint:ia-boundary` | 通过 | lint |

## 4. 偏差清单（UXR）

证据来源标记：**[浏览器]** 已在运行中的页面确认；**[静态]** 仅代码检索；**[lint]** 来自现有 lint；**[双证]** 两者一致。

### UXR-01 手写 Drawer：未用 Radix，多数无 `Esc`，打开后焦点不进入浮层

- **依据**：`15-components-overlay.md` §2、§4。
- **证据 [静态]**：23 个 Drawer 文件（`pl-drawer-panel`，不含测试）中 6 个已用 Radix，17 个手写（`pl-drawer-backdrop`），其中 13 个文件检索不到 `Escape` 处理（文件级粗查，可能误报）。
- **证据 [浏览器]**：`/connections`「新建连接」抽屉：`role="dialog"`、`aria-modal="true"`、有名称，`Escape` 可关闭（与静态「有 Esc」一致）；**但打开后焦点仍留在入口按钮，没有进入抽屉**。同类手写抽屉很可能有同样问题，需逐页确认。
- **整改意见**：迁到 Radix Dialog＋`pl-drawer-overlay`＋`pl-drawer-panel`；补焦点陷阱、打开后焦点进入、`Esc`（提交中除外）、关闭后焦点归还；保持现有 `data-testid`。
- **优先级**：高（可达性缺口）。
- **文件**：

| 文件 | `Esc` |
|---|---|
| `pages/TableEditor.tsx` | 无 |
| `pages/connections/TableWhitelist.tsx` | 无 |
| `pages/admin/AdminAccounts.tsx` | 无 |
| `components/connections/ConnectionTestDrawer.tsx` | 无 |
| `components/RemoveSchemaDrawer.tsx` | 无 |
| `components/SchemaStructurePrep.tsx` | 无 |
| `components/AddSchemaDrawer.tsx` | 无 |
| `components/DeleteConnectionDrawer.tsx` | 无 |
| `components/semantic-assets/CatalogBatchPanel.tsx` | 无 |
| `components/semantic-assets/SemanticAssetPublishDrawer.tsx` | 无 |
| `components/semantic-assets/PublishBatchPlanPanel.tsx` | 无 |
| `components/catalog/CatalogAssetUploadDrawer.tsx` | 无 |
| `components/catalog/CatalogAssetManifestDrawer.tsx` | 无 |
| `pages/Onboarding.tsx` | 有 |
| `pages/publish/PublishWorkbench.tsx` | 有 |
| `components/CreateConnectionDrawer.tsx` | 有 |
| `components/semantic-assets/PublishSyncConfirmDrawer.tsx` | 有 |

### UXR-02 手写 Modal：缺对话框语义、不响应 `Esc`、焦点不进入

- **依据**：`15-components-overlay.md` §2、§4。
- **证据 [静态]**：7 个文件使用 `pl-modal-panel`（手写）；`pages/admin/AgentDetail.tsx`、`pages/admin/AgentList.tsx` 检索不到 `aria-modal`、`role="dialog"` 或 Radix。
- **证据 [浏览器]**（1920×1080）：

| 浮层 | `role` | `aria-modal` | 有名称 | `Esc` 关闭 | 焦点进入 |
|---|---|---|---|---|---|
| `/admin/agents`「新建 Agent」 | 无 | 无 | 否 | **否** | 否 |
| `/admin/tokens`「续期」 | dialog | true | **否** | **否**（真实按键复验） | 否 |
| `/admin/tokens`「吊销」（只打开，未确认） | dialog | true | **否** | **否** | 否 |

- **整改意见**：迁到 Radix Dialog＋`pl-dialog-*`；补标题作为可访问名称、`Esc`、焦点进入与归还。先做 AgentList（语义全缺），再做 Tokens 的两个确认框（破坏性操作，键盘用户无法取消）。
- **优先级**：高。
- **文件**：`pages/admin/AgentDetail.tsx`（浏览器未单独验证）、`pages/admin/AgentList.tsx`、`pages/admin/Tokens.tsx`、`pages/admin/AdminAccounts.tsx`、`components/onboarding/SetupAssistantModal.tsx`、`components/connections/EditConnectionDialog.tsx`、`components/admin/RenewTokenDialog.tsx`。

### UXR-03 `pl-wiki-preflight-*` 样式族并入 `pl-dialog-*`

- **依据**：`15-components-overlay.md` §2。
- **证据 [静态]**：8 个文件使用 `pl-wiki-preflight-content`，均已是 Radix；`pl-dialog-content` 只有 `pages/skills/SkillList.tsx` 一处使用。
- **整改意见**：只换样式类，不改行为；并入后删除 `app.css` 中无引用的 `pl-wiki-preflight-*`。
- **优先级**：低（无可达性风险）。

### UXR-04 评测页表格未用 `pl-data-grid`，并有外包滚动层

- **依据**：`11-components-data-grid.md`：必须复用共享契约；`pl-data-grid-scroll` 是唯一横向滚动层，其外不得再包 `overflow-x-auto`。
- **证据 [静态]**：`pages/eval/FieldQuestions.tsx:58`、`pages/eval/RunList.tsx:206`（外层 `:205`）、`pages/eval/RunDetail.tsx:243`（外层 `:242`）与 `:274` 的 `<table>` 为 `w-full text-sm` 自定义写法。
- **证据 [浏览器]**：`/eval/cases` 的表格已在 `pl-data-grid` 内（合规）；`/eval/runs`、`/eval/field-questions` 在 demo 中无数据，**表格未渲染，无法确认**。
- **整改意见**：改用 `pl-data-grid` 契约，移除外包 `overflow-x-auto`。子 Plan 须先造种子数据或在有数据的环境确认。
- **优先级**：中。

### UXR-05 筛选输入的 `value` 取自路由状态

- **依据**：`14-components-filter-input.md` INV-1–INV-3。
- **证据 [lint]**：`npm run lint:url-driven-input` 现报 1 处：`pages/admin/Audit.tsx:2471`「事件 ID」`value={eventId}`。
- **整改意见**：改用局部状态镜像，URL 跟随；清除筛选时调用 `reset`。
- **优先级**：高（lint 现为红，且影响中文输入法组合）。

### UXR-06 高风险术语缺翻译防御

- **依据**：术语标准、`AGENTS.md`「全系统术语规范」。
- **证据 [lint]**：`npm run lint:terminology` 现报 3 处：`components/CreateConnectionDrawer.tsx:1094`（MCP）、`components/connections/EditConnectionDialog.tsx:341`（MCP）、`pages/TableEditor.tsx:2002`（Agent），缺 `translate="no"` 与 `notranslate`。
- **整改意见**：补两个属性；不改文案。
- **优先级**：高（lint 现为红，改动最小）。

### UXR-07 `JoinEditor` 无 `PageHeader` —— **已关闭（静态假阳性）**

- **浏览器核实**：`pages/JoinEditor.tsx` 只有 24 行，渲染 `<Navigate>` 重定向；访问 `/joins/…` 实际落到 `/catalog/…`，该页有 `PageHeader` 与 `h1`。**无需整改**。
- 保留编号，避免旧引用错位。

### UXR-08 空状态文案缺原因

- **依据**：`16-patterns-states.md` §2。
- **证据 [双证]**：`/eval/monitor`「暂无 drift 数据」「暂无失败用例集中项」，`/eval/field-questions`「暂无现场提问」，均只说"没有"，不说为什么、下一步做什么。
- **整改意见**：改动相关页面时顺手改为说明原因并给出下一步；**不单独立批**。
- **优先级**：低。

### UXR-09 加载态规则覆盖面不足（待裁决，不整改）

- **依据**：`20-patterns-page-layout.md` §8 仅限四页使用 `AsyncRegion`。
- **证据 [静态]**：另有约 200 处自写「加载中」文案。这不构成违规，是**规范覆盖不足**。
- **待裁决**：见 §5 D-4。

### UXR-10 文本对比度未达 4.5:1（系统性，主要在 token 层）

- **依据**：`01-foundations-color.md`「文本与背景对比度必须满足可读性要求」——**该章没有数值标准**，见 §5 D-1。本条按 WCAG 2.2 AA（正文 4.5:1，大字 3:1）度量。
- **证据 [浏览器]**：约 10 个页面逐元素计算（含半透明背景叠加），主要集中在下列组合（hex 由 `rgb` 换算）：

| 前景 → 背景 | 比值 | 出现位置（示例） | 性质 |
|---|---|---|---|
| `fg-muted #6b7280` → `bg-muted #f3f4f6` | **4.39** | 侧栏 `⌘ K`、分段控件未选项（「近 7 天」）、`dt`／`dd`、Wiki 目录计数、`status-not_started` 徽章、`code`；**10 个页面都有** | token 对，差 0.11 |
| `fg-muted` → `success-soft #dcfce7` | 4.40 | 系统概览健康条说明 | 同上 |
| 链接蓝 `#3c83f6` → 白 | 3.64 | 角色权限页的角色名链接、「前往补全 ↗」 | 链接色 |
| 链接蓝 → `success-soft` | 3.31 | 「查看未完成语义资产 ↗」 | 链接色 |
| 危险红（渲染 `#fb2c36`）→ 白 | 3.81 | 评测用例「删除」ghost 按钮 | 状态色用于文字 |
| 品牌珊瑚 `#ff5a3d` → 白 | 3.10 | Token 页 Agent 名链接 | 品牌色用于文字 |
| `warning #ff8f1f` → 白 | **2.28** | Token 页「(2 IPs)」 | 状态色用于文字 |

  不计入的装饰符号：`brand-mark`「L」、面包屑分隔符「/」、流程箭头「→」「⋯」（2.3–2.9），建议标 `aria-hidden` 并在子 Plan 中确认。
- **整改意见**（候选，由子 Plan 用脚本验证后定稿）：
  1. **改 token，不逐页改**：把 `fg-muted` 加深到约 `#656d7a`（`bg-muted` 上约 4.74，`success-soft` 上约 4.75）。一个改动覆盖 10 个页面。
  2. **文字用强色语义**：`danger`／`warning` 用于文字时改用已存在的 `danger-strong #b42318`（白底 6.57）、`warning-strong #92400e`（白底 7.09）；这两个 token 已存在，是用法问题。
  3. **链接色**：指定文字用链接色（候选 `#2563eb`，白底 5.17，`success-soft` 上 4.71），不再用 `accent #3c83f6` 渲染文字。
  4. 品牌珊瑚不用于小号文字链接；Agent 名链接改用链接色。
- **优先级**：高（`4.39` 影响面最大，改动最小）；链接与状态色中。
- **风险**：改 token 会影响全站视觉，必须在子 Plan 里逐页复核；须先裁决 D-1。

### UXR-11 小于 12px 的文字

- **依据**：`03-foundations-typography.md` **没有最小字号规定**，见 §5 D-2。
- **证据 [浏览器]**：`/admin/tokens` 状态徽章 10px（「可用」）、IP 说明 11px、`(2 IPs)` 11px；该页共 6 处小于 12px，其他页面 1–7 处不等（多为同一类徽章或辅助文字）。
- **整改意见**：先裁决最小字号（建议 12px）；再统一徽章与辅助文字到该下限。
- **优先级**：中。

### UXR-12 点击目标小于 24px

- **依据**：`10-components-button.md` 以 32px 为节奏，但**未规定文字型行内操作的最小点击区域**，见 §5 D-3。WCAG 2.2 AA（2.5.8）要求 24×24px，独立操作不适用行内文字例外。
- **证据 [浏览器]**：`pl-row-action-link` 高 16–20px：`/connections` 约 23 个、`/admin/row-policies` 15、`/skills` 7（20px）、`/catalog` 6、`/admin/access-map` 5；`/admin/tokens` 两个 22×22 的 ghost 图标按钮。
- **整改意见**：用 padding 或伪元素扩大点击区到 ≥24px，**不改变视觉尺寸**；只改共享类 `pl-row-action-link` 一处，覆盖多页。
- **优先级**：中。

### UXR-13 输入控件缺可访问名称

- **依据**：`00-principles.md` 的可达性原则（屏幕阅读器可理解）。
- **证据 [浏览器]**：`/eval/cases` 搜索框「搜索 case id 或问题…」仅有 placeholder；`/eval/runs` 有一个 `select` 无标签。其余约 20 个页面 0 处。
- **整改意见**：补 `aria-label`（或可见 `label`）；不改文案与布局。
- **优先级**：高（改动最小，建议与 B1 同批）。

### UXR-14 行权限视图：长哈希值超出视口被截断

- **依据**：`11-components-data-grid.md`：不得为单屏展示牺牲完整 ID；`20-patterns-page-layout.md` §6：不得隐藏关键字段。
- **证据 [浏览器]**：`/admin/row-policies` 与 `/admin/row-policy-templates` 在 1440×900 下各有 8 个元素的右边界超出视口（`配置版本`、`策略版本` 的 `dd` 哈希值，右边界最远 1854px），其祖先没有滚动容器，文档也不横向滚动，**内容被裁掉**。
- **整改意见**：让哈希值可换行（`break-all`）或放进可滚动容器，并保留 `notranslate`；「复制」入口属新功能，不在本条内。
- **优先级**：中。

### UXR-15 1280×800（MacBook 13"）下的容器内溢出

- **依据**：设计系统 README「Viewport Policy」：13" 为最低可读保障；`11-components-data-grid.md`：滚动区须有 `role="region"`、业务化 `aria-label`、`tabIndex={0}`。
- **证据 [浏览器]**：
  - `/catalog`：表格在 `pl-catalog-table-wrap` 内，内容宽 756、容器宽 678，**「操作」列被隐藏 78px**，需容器内横向滚动才完整可见；该滚动容器**没有** `role`、`aria-label`、`tabindex`。
  - `/help`：Markdown 表格右边界 1289，比视口多 9px；代码块在 `pre` 内滚动（合规）。
  - 其余 20 个页面在 1280×800 下无溢出。
- **整改意见**：`/catalog` 的滚动容器补可访问性三件套，并评估把「操作」列固定或压缩前列；`/help` 的 Markdown 表格套滚动容器。
- **优先级**：中。

## 5. 待委托人裁决项

| 编号 | 问题 | 我的建议 | 影响 |
|---|---|---|---|
| D-1 | 对比度标准：文本是否采用 WCAG 2.2 AA（正文 4.5:1，大字 3:1）作为设计系统的硬标准？ | 采用；并在 `01-foundations-color.md` 补 token 对照表和「文字可用的前景／背景组合」清单 | 决定 UXR-10 是否整改 |
| D-2 | 最小字号：是否规定正文与辅助文字 ≥ 12px？ | 规定 12px 下限；徽章如需更小须登记例外 | 决定 UXR-11 |
| D-3 | 最小点击目标：文字型行内操作是否规定 ≥ 24px 点击区？ | 规定；用 padding 扩点击区而不改视觉 | 决定 UXR-12 |
| D-4 | `AsyncRegion` 是否扩为全站默认加载态（UXR-09）？ | 先不扩；仅在相关页面子 Plan 里局部采用，避免一次性大改 | 决定是否另立批次 |

D-1–D-3 是**设计系统新增条款**，须先在 `webui/docs/design-system/` 对应章节落盘，再整改；落盘本身是文档工作，条款文字须你确认。

## 6. 批次与顺序

| 批次 | 内容 | 理由 | 改动面 |
|---|---|---|---|
| **B1** | UXR-05、UXR-06、UXR-13 | 让两条 lint 回到绿；补输入标签；改动最小 | 约 5 个文件 |
| **B2** | UXR-02（先 AgentList，再 Tokens 两个确认框）、UXR-01 中无 `Esc` 的 13 个 | 破坏性操作键盘无法取消，属可达性缺口 | 约 15 个文件 |
| **B3** | UXR-10（需 D-1）、UXR-12（需 D-3）、UXR-11（需 D-2） | 多为 token／共享类一处改动，覆盖多页 | `app.css` 为主，后逐页复核 |
| **B4** | UXR-04、UXR-14、UXR-15 | 数据网格与容器内溢出 | 约 7 个文件 |
| **B5** | UXR-02 其余、UXR-01 其余、UXR-03 | 样式收敛，无可达性风险 | 约 14 个文件 |
| 挂起 | UXR-09 | 等 D-4 | — |
| 随改随修 | UXR-08 | 不单独立批 | — |
| 已关闭 | UXR-07 | 浏览器核实为假阳性 | — |

顺序理由：先让门禁恢复绿（B1），再修键盘用户无法取消的确认框（B2），然后做影响面最大的 token（B3），最后做一致性（B4、B5）。

## 7. 逐页整改规则

1. **一页（或一组强相关文件）一个 Plan**，引用本 Spec 的 UXR 编号，不得另立问题口径。
2. 每个 Plan 在开工前先入 0.30 总账行（挂 P1-24 之下），取得**终稿确权＋委托人开发授权**；本 Spec 不替代任何一次授权。
3. 每个 Plan 须含交互合同（走 `lint:spec-docs` 交互合同门禁），不继承本 Spec 的豁免。
4. 保持既有 `data-testid` 与用户可见文案不变，除非该 UXR 明确要求；变更须写进该 Plan。
5. 页面整改完成后，在 §8 台账把对应行改状态，并写下验证命令及结果。
6. 浏览器验证仅在该页 Plan 明确要求时执行；默认不做移动窄屏。

## 8. 逐页进度台账

状态口径：`未开始`／`Plan 已出`／`已授权`／`已实现（静态验证）`／`浏览器已走查`。**本表是 UXR 进度的唯一现值**，总账 P1-24 只做同句镜像。

| 文件 | UXR | 批次 | 状态 |
|---|---|---|---|
| `pages/admin/Audit.tsx` | 05 | B1 | 未开始 |
| `components/CreateConnectionDrawer.tsx` | 06、01（焦点进入） | B1／B5 | 未开始 |
| `components/connections/EditConnectionDialog.tsx` | 06、02 | B1／B5 | 未开始 |
| `pages/TableEditor.tsx` | 06、01 | B1／B2 | 未开始 |
| `pages/eval/CaseList.tsx` | 13 | B1 | 未开始 |
| `pages/eval/RunList.tsx` | 13、04 | B1／B4 | 未开始 |
| `pages/admin/AgentList.tsx` | 02 | B2 | 未开始 |
| `pages/admin/AgentDetail.tsx` | 02 | B2 | 未开始 |
| `pages/admin/Tokens.tsx` | 02、11 | B2／B3 | 未开始 |
| `components/admin/RenewTokenDialog.tsx` | 02 | B2 | 未开始 |
| `pages/connections/TableWhitelist.tsx` | 01 | B2 | 未开始 |
| `pages/admin/AdminAccounts.tsx` | 01、02 | B2／B5 | 未开始 |
| `components/connections/ConnectionTestDrawer.tsx` | 01 | B2 | 未开始 |
| `components/RemoveSchemaDrawer.tsx` | 01 | B2 | 未开始 |
| `components/SchemaStructurePrep.tsx` | 01 | B2 | 未开始 |
| `components/AddSchemaDrawer.tsx` | 01 | B2 | 未开始 |
| `components/DeleteConnectionDrawer.tsx` | 01 | B2 | 未开始 |
| `components/semantic-assets/CatalogBatchPanel.tsx` | 01 | B2 | 未开始 |
| `components/semantic-assets/SemanticAssetPublishDrawer.tsx` | 01 | B2 | 未开始 |
| `components/semantic-assets/PublishBatchPlanPanel.tsx` | 01 | B2 | 未开始 |
| `components/catalog/CatalogAssetUploadDrawer.tsx` | 01 | B2 | 未开始 |
| `components/catalog/CatalogAssetManifestDrawer.tsx` | 01 | B2 | 未开始 |
| app/app.css（token 与共享类 `pl-row-action-link`） | 10、11、12 | B3（待 D-1／D-2／D-3） | 未开始 |
| `pages/eval/FieldQuestions.tsx` | 04、08 | B4 | 未开始 |
| `pages/eval/RunDetail.tsx` | 04 | B4 | 未开始 |
| components/admin/RowPolicyStateBadge.tsx（及行权限两页） | 14 | B4 | 未开始 |
| `pages/Catalog.tsx` | 15 | B4 | 未开始 |
| `components/MarkdownPreview.tsx` | 15 | B4 | 未开始 |
| `pages/Onboarding.tsx` | 01、（焦点进入） | B5 | 未开始 |
| `pages/publish/PublishWorkbench.tsx` | 01 | B5 | 未开始 |
| `components/semantic-assets/PublishSyncConfirmDrawer.tsx` | 01 | B5 | 未开始 |
| `components/onboarding/SetupAssistantModal.tsx` | 02 | B5 | 未开始 |
| 8 个 `pl-wiki-preflight-*` 文件 | 03 | B5 | 未开始 |
| `pages/eval/Monitor.tsx` | 08 | 随改随修 | 未开始 |
| `pages/JoinEditor.tsx` | 07 | 已关闭（假阳性） | 不适用 |

## 9. 验收（本 Spec 自身）

| 编号 | 条件 |
|---|---|
| SC-01 | 每条 UXR 含依据、证据（标明来源）、整改意见、优先级；静态证据可由 §2 方法复跑，浏览器证据可由 `inbox/uiux-browser-audit/audit.js` 复跑 |
| SC-02 | §8 台账覆盖 §4 中每个已确定的文件，无孤儿 UXR；已关闭条目有关闭理由 |
| SC-03 | `npm run lint:spec-docs` 对本 Spec 无新增违规 |
| SC-04 | 本 Spec 与配对 Plan 未修改任何 `webui/src/`、`app.css` 或运行代码 |
| SC-05 | 总账 P1-24／需求池 REQ-030-045 与本 Spec 状态同句，且标「不入核心分母」「≠ 开发授权」 |
| SC-06 | §5 的 D-1–D-4 每项有建议与影响，未裁决前不得把对应 UXR 排入批次 |

## 10. 非目标

- 不重做页面视觉，不改颜色、间距、文案。
- 不新增设计系统章节。D-1–D-3 获批后只在 `01`／`03`／`10` 既有章节补条款，且先于对应整改；其余规范缺口另议。
- 不做发版走查签字与移动窄屏；浏览器盘点只为取证，不等于「浏览器已走查」状态。
- 不修改 KTX。
