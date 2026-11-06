# 访问关系图图优先呈现 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.2 功能合同已收口** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号。不升 Spec 187 版本号 |
| 功能编号 / 优先级 | **无** / **P1**（页壳与图面）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.2 功能合同已收口**（2026-11-01）。方案 A′ 已落地：去掉三张指标卡与双折叠墙；图例短行在图正上方；口径全文与快照沉到图下弱入口；抬高图区、拉开栏距、补可读悬停。SC-01–SC-13 有组件与布局断言并通过。SC-14 术语 lint 于 2026-11-02 拆出，见 [出口拆分记录](../reviews/2026-11-02-functional-contract-exit-split.md)。实施记录见 [`docs/plans/lucy-20261101-access-map-chart-first-plan.md`](../plans/lucy-20261101-access-map-chart-first-plan.md) §9 与 `inbox/2026-11-01-access-map-chart-first-IMPLEMENTATION_NOTES.md`。本条收口不表示可上线。**有效呈现指针（2026-11-04；已落地）**：主工具条「问询种类／访问等级」以 [`lucy-20261102-access-map-audit-echo-spec.md`](lucy-20261102-access-map-audit-echo-spec.md) 为准；**数据表／凭证清单／口径行**以 [`lucy-20261104-access-map-hourly-detail-spec.md`](lucy-20261104-access-map-hourly-detail-spec.md) 为准（已取代本条弱入口折叠与次级凭证清单；Token 条件取消）。本条页壳骨架（去 KPI、图例短行位置）仍有效，收口状态不变 |
| 决策来源 | 2026-11-01 对 `http://127.0.0.1:55176/admin/access-map` 的反馈与拍板：桑基图是打开本页的重点；三 KPI 卡与「口径说明 / 快照」宽条喧宾夺主；partial 提示突兀；图面偏小、四栏挤、悬停不友好。委托人明确选 **方案 A**（去掉 KPI 卡），并要求图相关图例/口径保留但放在不明显位置；图例短行放**正上方** |
| 需求来源 | 治理台访问关系图以关系图为主视觉；诚实性口径与快照不得消失，但不得抢首屏 |
| 实施主体 | Lucy WebUI 访问关系图页（`webui/src/pages/admin/AccessMap.tsx` 与 `webui/src/components/admin/AccessMap*.tsx`）。不修改 KTX，不修改 `/api/admin/access-map` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级呈现修订落 `docs/specs/` |
| 与既有 Spec 的关系 | **再修订** [`lucy-20261030-access-map-quiet-reading-spec.md`](lucy-20261030-access-map-quiet-reading-spec.md) 的页壳骨架（§5.1 三指标卡 + 双 `details`），**不撤销**其图面着色（§5.3）、抽屉（§5.5）、数据表与凭证表（§5.6）等已验收呈现。权威语义仍是 [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)。边状态、路径守恒、Token 过滤、两档措辞、降级矩阵沿用 Spec 187。**主筛选**以 [`lucy-20261102-access-map-audit-echo-spec.md`](lucy-20261102-access-map-audit-echo-spec.md) 为准；**关联口径下拉已废止、固定已确认关联**以 [`lucy-20261105-access-map-confirmed-only-spec.md`](lucy-20261105-access-map-confirmed-only-spec.md) 为准（本条不推翻已收口页壳合同的其余部分）。Spec 187 与 quiet-reading 的既有 SC **不在本条出口** |
| 实施计划 | [`docs/plans/lucy-20261101-access-map-chart-first-plan.md`](../plans/lucy-20261101-access-map-chart-first-plan.md) |

> v0.2 功能合同已收口（2026-11-01）。D1–D8 按 §4 提议列拍板，未在实施中改写。SC-01–SC-13 有自动化断言并通过。SC-14 已拆出。本条收口不表示可上线。

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图页默认阅读路径以关系图为主工作区；首屏不再渲染三张信号 Metric Card，也不再渲染独立宽条「口径说明」「快照」；图正上方保留图例短行；图下方保留弱入口承载口径全文与快照哈希；partial 降级仍可见但不抢主视觉；图区有可用高度与可读栏距；节点/边悬停有可读浮层。
- 本条出口：SC-01–SC-13。组件测试与布局测试打假 DOM 结构、test id 迁移、图例位置、弱入口内容、悬停文案要点、栏距/高度类约束、术语用词。
- 不在本条出口：SC-14 术语 lint；浏览器走查、Playwright、窄屏视口、镜像构建、部署、证据等级，以及 Spec 187 的 SC-01–SC-14、quiet-reading 的 SC-01–SC-16（其中与本条冲突的页壳断言由本条测试改写承接）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用访问关系图、授权路径、访问路径、僵尸授权、需复核、确凿越权、凭证清单、Agent、角色、连接、Schema、表、Token、口径说明、快照。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 图例短行 | 沿用现有四项可读标签（流带 / 内核 / 虚线需复核 / 实线确凿越权） | `data-testid="access-map-legend"` 留在图上方 |
| 图下弱入口 | 口径与快照 | 单个折叠；默认关 |
| Partial 提示 | `{N} 个 Agent 授权未能解析，结果不完整。` + 链接「前往配置审计」 | 可缩短可见强调，但不得删降级事实与链接 |

Forbidden terms:

- 用「桑基图」「拓扑图」「权限流向图」作页面标题或导航名。
- 「需复核」的图例、ⓘ、抽屉标题中出现「越权」。
- 把三张信号 Metric Card 的标题行重新加回默认首屏。
- 把 `24h` / `168h` / `720h` 作为统计窗口的可见选项文案。

`Agent`、`Token`、`Schema`、连接名、表名、角色 id、`config` / `policy` 哈希、规范源键在 DOM 上使用 `translate="no"` 与 `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`（`TD-187-01`）
- [`docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`](lucy-20261030-access-map-quiet-reading-spec.md)（图面着色与抽屉既有合同）

### What This Change Follows

- [ ] 页头可见主动作不超过 3 个；关系图 / 数据表用已有 `pl-admin-tabbar`，选中态不用 `primary`
- [ ] 统计窗口用 `pl-segmented-control`，选中态不用 `primary`
- [ ] 首屏不以 `pl-metric-grid--three` 三卡抢主视觉
- [ ] 图例短行使用既有语义色 token，不新增硬编码色值
- [ ] 悬停浮层文案可读；状态同时有文字，不只靠颜色
- [ ] 小于最小可读宽度时图区横向滚动，不做窄屏重排
- [ ] Partial / grant / access 降级仍用既有 `pl-notice` 家族，不静默吞掉

### Exceptions (If Any)

- Spec 187 §7.4「顶部信号条点击可筛选」与 quiet-reading §5.2 三枚 Metric Card：**本条默认首屏不再提供该筛选入口**。`meta.signals` API 字段保留。本轮不把筛选迁到图例点击（列为非目标）。数据表视图也不再依赖指标卡筛选高亮；若需恢复筛选，须另开呈现修订。
- `TD-187-01` / quiet-reading §5.3 流带着色合同不变：僵尸授权流带中性；需复核 warning 虚线；确凿越权 danger 实线。

### Follow-up Needed

- None 于本条。若产品后续要「图例点击筛选」，另开 Spec，不夹带本条。

---

## 1. 背景

quiet-reading（2026-10-30）已把口径/快照折进默认关闭的 `details`，并把信号收成三张 Metric Card。实页仍出现：

1. 工具条下的 partial 裸提示与三张大卡、两条折叠墙连续占位，关系图被压到首屏下半。
2. 用户打开本页的目标是读授权↔访问流向；三 KPI 在常见「僵尸授权 > 0、另两档 = 0」下摘要价值低、占地高。
3. 图例被埋在「口径说明」折叠内，读图时看不见。
4. 悬停主要依赖 SVG `<title>`，缺少「从→到 / 路径数 / 状态」的可读浮层。
5. 四栏水平间距偏紧，流带短陡。

## 2. 目标

1. **图优先**：默认路径为页头 → 工具条 →（必要时轻量 partial）→ 视图 Tab → **图例短行** → **关系图主区** → 图下弱入口 → 凭证表。
2. **去掉**默认首屏的三张信号 Metric Card 与两个独立宽条 `details`（「口径说明」「快照」）。
3. **图例短行**固定在关系图**正上方**，只含四项线型/色块释义；不承载长 ISO 窗口句。
4. **口径全文 + 快照哈希**沉到图**下方**单个弱入口「口径与快照」（默认关）。
5. **抬高图区**、**加大列间距**；悬停提供自定义可读浮层（替代「仅靠原生 title」作为主提示）。
6. Partial / grant unavailable / access unavailable 降级提示保留，形态收成工具条下轻量 `pl-notice`，不得删链接「前往配置审计」。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 `/api/admin/access-map`、边状态机、路径守恒、折叠预算 | Spec 187 语义事实源不变 |
| 改 URL 参数名与合法值 | `window` / `layer` / `trust` / `view` / `focus` / `token` 等保持 |
| 改「需复核」「确凿越权」两档定义与措辞 | Spec 187 §4.9 |
| 本轮恢复或迁移「信号卡点击筛选」 | 方案 A 明确去掉 KPI；筛选另议 |
| 引入 `d3-sankey` 或其他新运行时依赖 | 依赖约束保持 |
| 重排窄屏、移动端断点 | 治理约定：未要求不做 |
| 在图上直接改授权 | 页面只读 |
| 浏览器走查作为本条出口 | 归发布 UX 走查表面 |

## 4. 拍板记录

**拍板记录（2026-11-01）**：委托人选方案 A，并批准图例短行在图正上方、口径/快照弱化保留、按规范落 Spec + Plan。

| ID | 决议 |
|---|---|
| D1 | 只改呈现。API、URL 值、边状态、两档措辞、Token 过滤句不变 |
| D2 | **移除**默认首屏三张信号 Metric Card；不提供本轮信号筛选 UI |
| D3 | **移除**两个独立宽条 `details`（口径说明、快照） |
| D4 | 图例短行（四项）放在关系图**正上方**；`access-map-legend` 留在此处 |
| D5 | 口径全文、覆盖率句、原始调用数、孤儿授权说明、窗口 ISO、信任口径、`access-map-snapshot-id` 并入图下「口径与快照」弱入口（默认关） |
| D6 | Partial 等降级：保留事实与「前往配置审计」；用轻量 `pl-notice`，不做成与 KPI 同级的大卡 |
| D7 | 图区：主工作区提高可用高度；加大列间距；过窄横滚；不 `max-w-full` 缩小整图 |
| D8 | 节点与边悬停：自定义浮层，至少含名称（边为从→到）、路径相关计数、状态文案；点击边仍开既有抽屉 |

## 5. 呈现规格

### 5.1 页面骨架（关系图视图）

```text
Page Header
  标题：访问关系图
  描述：授权路径与窗口内实际访问对照。

工具条
  左：统计窗口分段控件
  中：Schema 层、问询种类、访问等级（两下拉；有效呈现见 audit-echo Spec）
  右：搜索 + 定位
  focus 存在时：面包屑「全图 / {节点名}」
  （关联口径不在主工具条；常驻行静态披露「已确认关联」——下拉已废止，见 confirmed-only Spec）

降级区（按需）
  partial / access unavailable / grant unavailable — pl-notice
  （不得插入 Metric Card 行）

主工作区
  pl-admin-tabbar：关系图 | 数据表
  【关系图】
    图例短行（access-map-legend，仅四项色块/线型）
    图区（抬高；列间距加大；横向滚动）
    弱入口 details「口径与快照」（默认关）
  【数据表】
    节点表、关系表（沿用 quiet-reading §5.6；不再依赖信号卡筛选）

次级
  凭证清单表
```

页头不渲染哈希。`access-map-snapshot-id` 仅出现在「口径与快照」展开内容中，文案保持 `config {accessConfigVersion} · policy {policyVersion}`。

### 5.2 明确删除的首屏元素

| 元素 | 处置 |
|---|---|
| `pl-metric-grid--three` 三张信号卡 | 默认 DOM **不得出现**。`access-map-signal-dormant` / `needs-review` / `confirmed` 及其 ⓘ 按钮从默认页壳移除 |
| `id="access-map-methodology"` 与 `id="access-map-snapshot"` 两个独立宽条 | 删除；内容迁入图下单一弱入口 |
| 信号本地筛选状态驱动的高亮 | 本轮无 UI 入口；实现可删除筛选 state，或保留但不可达（优先删除，避免死代码） |

`meta.signals` 仍由 API 返回；可在弱入口或 SVG `aria-label` 摘要中出现计数，但**不是**三张大卡。

### 5.3 图例短行（图正上方）

- 仅四项：流带宽度释义、深色内核释义、虚线=需复核、实线=确凿越权（文案与 quiet-reading / 现行 `AccessMapLegend` 四项一致）。
- **不得**在短行内放完整窗口 ISO 起止或大段口径定义。
- `data-testid="access-map-legend"` 必须在关系图 Tab 下、SVG/canvas **之前**的文档序中出现。
- 数据表视图可不渲染图例短行。

### 5.4 图下弱入口「口径与快照」

默认关闭的单个 `<details>`（或等价折叠），summary 文案：**口径与快照**。

展开后须仍能找到（test id 可迁容器，但 id 字符串保留）：

| test id / 内容 | 要求 |
|---|---|
| `access-map-signal-needs-review-note` | 全文；不得含「越权」 |
| `access-map-signal-confirmed-source` | 全文 |
| 僵尸授权 ⓘ 原口径句 | 若原有独立 note test id，一并迁入；否则写在同一折叠正文 |
| `access-map-snapshot-coverage` | 覆盖率句 + 「快照覆盖率低不代表越权率低…」提醒 |
| `access-map-signal-calls` | 原始调用数 / 被拒绝尝试 |
| `access-map-orphan-grants` | 若有孤儿授权说明 |
| `access-map-legend-trust` / `access-map-legend-window` | **关联口径：已确认关联**（静态字面量；禁止「问询计入」）与窗口 ISO。下拉控件废止见 confirmed-only Spec |
| `access-map-trust` | **废止**：不得再作为可操作下拉出现于默认 DOM |
| `access-map-snapshot-id` | `config … · policy …` |

弱入口视觉：小字、边框弱于主工作区；**不得**再使用与主图抢权的双行大条并排样式。

### 5.5 Partial 与其它降级

- `grant.state === "partial"`：保留 `{N} 个 Agent 授权未能解析，结果不完整。` +「前往配置审计」。
- 允许改为更紧凑的 `pl-notice`（可含 icon），但不得改为仅 icon 无文字，不得删除链接。
- `access-map-partial-notice` test id 保留。
- grant unavailable / access unavailable 文案与 quiet-reading / Spec 187 一致。

### 5.6 图区几何与悬停

沿用 quiet-reading §5.3 着色；**图面几何改指**
[`lucy-20261101-access-map-geometry-spec.md`](lucy-20261101-access-map-geometry-spec.md)（**v0.2 功能合同已收口**）
§5.1–§5.5（细柱 + 外标块 + 面积流带 + 刻度封顶 + 列间距与横滚），
quiet-reading §5.4 的定宽卡片规则已被该 Spec 取代。本条新增/继续有效：

| 项 | 要求 |
|---|---|
| 高度 | 关系图主容器须有明确的最小高度策略（例如基于视口剩余高度的 `min-height`），使默认桌面视口下图区显著高于工具条+图例占用 |
| 列间距 | 布局常量加大列间隙，使四栏流带弧度可读；放不下时横向滚动 |
| 悬停浮层 | 节点：显示 `label`（全名）、副标题计数要点、类型中文名。边悬停**有效呈现**改指 [`lucy-20261105-access-map-idle-grant-copy-spec.md`](lucy-20261105-access-map-idle-grant-copy-spec.md)（三段式结论优先、突出调用次数、主术语「闲置授权」、访问面不可用时降级）。不得把原生 SVG `<title>` 当作唯一用户可读提示 |
| 点击 | 节点写 `focus`；边开既有抽屉。Esc 规则沿用 quiet-reading §5.5 |

### 5.7 数据表与凭证表

- 沿用 quiet-reading §5.6。
- 因本轮无信号筛选 UI：关系表默认展示当前响应当中的边（仍受 URL `focus` / `token` 等既有过滤约束）。不得假造已筛选态。

### 5.8 与 quiet-reading 的承接

| quiet-reading 条款 | 本条 |
|---|---|
| §5.1 三指标卡 + 双 details | **取代** |
| §5.2 指标卡 tone / 筛选 | **不再生效于默认页壳** |
| §5.3 流带着色 | **保持** |
| §5.4 卡片与横滚 | **卡片规则已被 geometry Spec §5.1–§5.5 取代**；横滚与「加强栏距/高度」的意图由 geometry Spec 承接（`ACCESS_MAP_COLUMN_GAP`、图区最小高度策略、稀疏图垂直居中） |
| §5.5 抽屉与 Esc | **保持** |
| §5.6 表 | **保持**（去掉对信号筛选的依赖） |
| SC-01（三指标卡可见） | **由本条 SC 取代；旧断言改写** |

## 6. 核心流程（伪代码）

```text
render(response, url):
  view = url.view == "table" ? "table" : "map"
  show header without version hashes
  show toolbar(window, layer, inquiryKind, accessGrade, search, focus breadcrumb)
  // 关联口径：无下拉；常驻／图例静态「已确认关联」；见 confirmed-only Spec

  if response.meta.grant.state == "partial":
    show compact partial notice + link to config-audit
  if response.meta.access.state == "unavailable":
    show access unavailable notice
  if response.meta.grant.state == "unavailable":
    show grant unavailable notice
    return

  show tabbar(view)

  if view == "table":
    show node grid + edge grid   # no signal-card filter
  else:
    show legend short row        # four swatches only, above chart
    show chart with taller min-height and wider column gaps
    on hover node|edge: show readable floating tip
    on activate edge: open drawer
    show details "口径与快照" collapsed below chart
      include notes, coverage, calls, orphan, trust, window ISO, snapshot id

  show credential grid

# paint(edge) unchanged from quiet-reading §5.3 / Spec 187 classifier
```

## 7. 验收

| ID | 断言 |
|---|---|
| SC-01 | 默认关系图视图下，DOM 中不存在三张信号 Metric Card（无 `access-map-signal-dormant` / `needs-review` / `confirmed` 筛选按钮） |
| SC-02 | 默认关系图视图下，不存在独立的 `access-map-methodology` 与 `access-map-snapshot` 两个宽条；存在单个「口径与快照」弱入口 |
| SC-03 | `access-map-legend` 在关系图视图中位于图区之前（文档序）；短行只含四项线型释义，不含完整窗口 ISO 句 |
| SC-04 | 展开「口径与快照」后：`access-map-snapshot-id`、`access-map-snapshot-coverage`、`access-map-signal-needs-review-note`、`access-map-signal-confirmed-source` 可找到；需复核 note 不含「越权」 |
| SC-05 | `grant.state=partial` 时 `access-map-partial-notice` 可见且含「前往配置审计」 |
| SC-06 | 关系图 / 数据表与统计窗口选中态不使用 `pl-btn--primary` |
| SC-07 | 图区布局列间距常量大于 quiet-reading 落地时的列间距；主图容器有 `min-height`（或等价）策略且测试可断言其存在 |
| SC-08 | 悬停节点或边时，出现非 SVG-only-title 的可读浮层，边浮层含从→到与状态文案要点 |
| SC-09 | `dormant` 流带 class 不含 warning；`needs_review` 为虚线 warning；确凿越权为实线 danger（承接 quiet-reading SC-08） |
| SC-10 | 点击边后 `access-map-edge-detail` 在抽屉内（承接 quiet-reading SC-10） |
| SC-11 | Token 过滤提示句保持 Spec 187 原文（承接 quiet-reading SC-13） |
| SC-12 | 既有关键 `access-map-*` test id（legend、snapshot-id、partial-notice、canvas、edge-drawer、view tabs 等）仍可找到或按本 Spec 迁入弱入口后仍可找到 |
| SC-13 | 页面源码无新增裸十六进制颜色 |
| SC-14 | **拆出。** 术语 lint 是过程门禁，不在本条出口 |

上线关系：本条收口不表示可上线。浏览器走查不在本条出口。

## 8. 落盘清单

| # | 要求 | 本文件 |
|---|---|---|
| 1 | Spec 落 `docs/specs/`，命名 `lucy-YYYYMMDD-<slug>-spec.md` | 本文件 |
| 2 | 核心流程（伪代码）或显式豁免 | §6 |
| 3 | 头部含文档类型 / 版本、状态 | 文首元数据表 |
| 4 | Plan 五类小节 | 见配套 Plan |
| 5 | Terminology Compliance 含 `This feature follows` 与 `New terms:` | 上文 |
| 6 | Design System Compliance 四段式 | 上文 |
| 7 | 索引登记 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令 / CI | 无 |
| 9 | 功能编号 | 无。不进入 v0.25 登记册 |
| 10 | 落盘后跑 `lint:spec-docs` | 配套 Plan 记录 |
| 11 | 闭口层级 | 上文。层级为功能合同 |
