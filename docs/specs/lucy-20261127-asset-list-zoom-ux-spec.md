# 资产列表 Zoom 交互规范 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 资产列表 Zoom 交互规范 Spec |
| 文档类型 / 版本 | Spec（WebUI 交互规范）／**v1.0** |
| 日期 / 目标版本 | 2026-11-27／产品线 `0.35.0`（`lucy-v0.35`） |
| 功能编号 / 优先级 | **REQ-0120**／**P1**。**不入核心分母** |
| 台账号 | 无 |
| 阶段 | S2 |
| 状态 | S2｜**v1.0；终稿已确权**（委托人 2026-11-27 明示「授权 spec定稿」）。过程对抗见[评审](../reviews/2026-11-27-asset-list-zoom-ux-adversarial-review.md)。配对 [Plan](../plans/lucy-20261127-asset-list-zoom-ux-plan.md)／[`UAT-SUITE-ASSET-LIST-ZOOM`](../qa/uat/suites/asset-list-zoom/suite.md)。**未获开发授权**；测试台 NOT RUN。≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 授权边界 | **终稿已确权 ≠ 开发授权**。未获委托人另发开发授权前禁止改运行代码 |
| 需求 / 验收 | [常青需求池 REQ-0120](../backlog/README.md) · 验收 SC-01–SC-15 · 测试台 `UAT-SUITE-ASSET-LIST-ZOOM` |
| 配对计划 | [Plan](../plans/lucy-20261127-asset-list-zoom-ux-plan.md) |
| 评审 | [Spec 过程对抗](../reviews/2026-11-27-asset-list-zoom-ux-adversarial-review.md) · [Plan／UAT 对抗](../reviews/2026-11-27-asset-list-zoom-plan-uat-adversarial-review.md) |
| 基于材料 | 2026-11-27 委托人 UX 裁定；对抗评审闭合 B1–B6；现行实现：`ConnectionOverview.tsx`、`TableWhitelist.tsx`、`Catalog.tsx`、`RoleTableGrants.tsx`、`AgentDetail.tsx`；既有 Spec 133／152／47／163／P1-80 |
| 输出位置 | `docs/specs/lucy-20261127-asset-list-zoom-ux-spec.md` |
| 实施主体 | Lucy WebUI（`webui/src/`）；不改 KTX；不改 ACL／启用表后端语义 |

## 闭口层级

- 层级：功能合同
- 本条承诺：为连接／Schema／表资产相关 WebUI 页面建立统一的 **Zoom 交互合同**——按页面管理对象定默认深度、按版式家族定曝光与翻页手段，并以**系统内搜索**为长清单主定位路径；落地后用户打开页面不再默认面对「全 Schema × 全表」墙。
- 本条出口：SC-01–SC-15 全部通过（含浏览器前台必做项）。
- 不在本条出口：访问关系图 Sankey 主契约改写；虚拟滚动性能专项；ACL／启用表保存语义变更；导航 IA 增删改；客户环境／发版取证。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- 显示更多（Show more）：将当前列表可见窗口再扩大一批的次要动作；不是分页器。
- 显示 a / b（Showing a of b）：可见条数与过滤后总量的计数文案模式。

既有沿用：连接、Schema、启用表范围、语义资产、角色、Agent。禁用把浏览器 Ctrl+F 写成产品能力或验收替代。专业词连接 ID、`schema`、`table`、URL 节点须 `translate="no"`／`notranslate`。

**落地门禁（N1）**：开发授权对应的实现 PR 合并前，须将上列 New terms 登记进 `webui/docs/00-product-terminology-standard.md`（或该 PR 同批登记）。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/14-components-filter-input.md`
- `webui/docs/design-system/16-patterns-states.md`
- `webui/docs/design-system/20-patterns-page-layout.md`

### What This Change Follows

- [x] 筛选搜索框遵循 `14-components-filter-input.md`（本地 state 驱动 value，URL 跟随）。
- [x] 表／Schema 清单落在既有 data grid／工作台节奏内，不新造视觉主题。
- [x] 「显示更多」与分页为次要／导航动作，不与页头唯一 primary 抢位。
- [x] 空／0 条／错误态在面板内写明原因（`16-patterns-states.md`）。

### Exceptions (If Any)

- 设计系统尚无独立「Show more／Capped list」章节。本 Spec 定义产品合同；实现期若需升格正式 DS 章节，记入 `99-governance.md` 临时决策并设升级期限。

### Follow-up Needed

- 配对 Plan 与 UAT 套件登记（测试台）在开发授权前完成（N2）。
- 术语标准正文登记（N1）。

## 交互合同

- 路由：/connections/enabled-tables、/admin/roles/:roleId
- 基准页：/connections/enabled-tables
- 一件事：按版式家族控制资产列表默认深度与曝光，让治理方用系统内搜索定位目标，而不是滚动整座清单。
- 状态：首访：可见搜索与有界清单；空：不适用：本条矩阵假定已有连接与候选，无连接走既有空态；加载：清单未就绪时不伪装成没有表；错误：读取失败可重试且不假报缺 Manifest；0 条：搜索无命中时引导改关键词；成功：计数诚实且挂载不超过可见窗口；部分：家族 A 多 Schema 时仅一组有表行，家族 B 当前页以外表行不挂载
- 主动作：各页原有保存至多一个 primary；「显示更多」与分页不做 primary
- 决定信息：可见窗口、过滤后总量、搜索引导与窗口重置可感知。
- 术语：本条新增「显示更多」「显示 a / b」；其余已登记。
- 台账：无新台账
- 状态维度：可见窗口、过滤集合、展开组标明，同一状态维度不得互相否定。

## 元素清单

- E1｜/connections/enabled-tables｜首访｜工具条｜系统内搜索可见
- E2｜/connections/enabled-tables｜加载｜表工作台｜未就绪时不伪装成没有表
- E3｜/connections/enabled-tables｜错误｜表工作台｜读取失败可重试
- E4｜/connections/enabled-tables｜0 条｜筛选区｜无命中时引导改关键词
- E5｜/connections/enabled-tables｜成功｜表工作台｜同时只展开一组；组内默认最多 5 行；显示更多每次加 5
- E6｜/connections/enabled-tables｜部分｜表工作台｜其余 Schema 仅摘要
- E7｜/connections/enabled-tables｜主动作｜工具条｜保存至多一个 primary；显示更多非 primary
- E8｜/connections/enabled-tables｜决定信息｜计数区｜显示可见条数与过滤后总量
- E9｜/admin/roles/:roleId｜首访｜表授权区｜系统内搜索可见
- E10｜/admin/roles/:roleId｜加载｜表授权区｜候选加载中可感知
- E11｜/admin/roles/:roleId｜错误｜表授权区｜加载失败可重试
- E12｜/admin/roles/:roleId｜0 条｜表授权区｜无命中时引导改关键词
- E13｜/admin/roles/:roleId｜成功｜表授权区｜过滤后超过 50 表行则分页；单页不超过 50
- E14｜/admin/roles/:roleId｜部分｜已选摘要｜展开后超过 50 表行则分页
- E15｜/admin/roles/:roleId｜主动作｜表授权区｜保存至多一个 primary；分页非 primary
- E16｜/admin/roles/:roleId｜决定信息｜表授权区｜已选计数全局可见且页码可感知

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 不触碰 MCP／报告问数路径 | 不触碰 | ＝ | 本条仅改 WebUI 治理列表展示；不改 MCP 工具面（闭口层级） | — |
| P2 治理方 | **权限授权面／语义口径面**：连接概览 Schema 全列、启用表／Catalog 易出现多 Schema×多表墙；角色选表 checkbox 全铺；搜索有但未当主路径 | 按对象定深度；家族 A 单组+5+显示更多+挂载合同；家族 B 硬 50／页分页；搜索为长清单主路径并有引导 | P2·权限授权面 ↑／P2·语义口径面 ↑ | SC-01–SC-15；E1–E14 | 显示更多／分页 + 搜索可到达过滤后全集（SC-06／SC-09／SC-13） |
| P3 运维方 | 不改部署／探针 | 不改 | ＝ | 无部署契约变更 | — |
| P4 管理层 | 不改概览业务指标口径 | 不改 | ＝ | 无管理层消费面变更 | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 最终用户（含纯 MCP）原先主任务是否仍可完成？ | 是。纯 MCP 未改；治理方仍可通过搜索／显示更多／分页到达任意合法表／Schema |
| 2 | 若增加约束，逃生是否同实况可达？ | 是。「显示更多」／分页与搜索均为同页可达逃生；禁止以未挂载 DOM 冒充「表不存在」 |
| 3 | 验收是否同时覆盖约束生效与合法路径？ | 是。SC 同时验默认有界（约束）与搜索命中／展开全集可达（合法路径） |
| 4 | 是否避免宿主缺席记成 BLOCKED？ | 是。验证对齐本机 Docker demo + 前台浏览器 |

---

## 1. 背景与问题

现行 WebUI 在连接、启用表、Catalog、角色／Agent 授权等页面对 Schema／表的默认曝光策略不一致：连接概览 Schema 全列、启用表在 `WHITELIST_ROW_BUDGET=50` 以下全组展开、Catalog 右表对 `filtered` 易全量铺开、`RoleTableGrants` 全铺 checkbox（与 Spec 133 漂移）。委托人判定默认全展开不符合企业级 zoom；长清单应以系统内搜索为主路径。

## 2. 产品原则

1. **对象定深度**：管连接 → 默认到 Schema 摘要；管表 → 直接到表，但受曝光上限约束。
2. **版式分家族**：启用表与 Catalog（家族 A）vs 角色／Agent 授权（家族 B），不硬套同一控件。
3. **搜索优先于滚动**：管表／授权选表页必须有系统内搜索；过滤后总量超过该页默认 cap 时，须有系统内搜索引导文案；Ctrl+F 不得作验收替代。
4. **挂载即可见窗口**：可见窗口之外的表行不得进入文档（禁止「全量挂载 + CSS 隐藏」冒充有界）。
5. **虚拟滚动可选**：可作性能增强，不得替代本规范的 cap／分页／搜索／挂载合同。

## 3. 交互家族与常数

机器交互合同以家族 A／B 各一基准路由取证；连接概览、Catalog、Agent 权限预览的同款合同见本节与 SC-01–SC-03／SC-07／SC-10，实现与浏览器验证在 Plan 中扩路由，不另削弱本条承诺。

| 常数 | 值 | 适用 |
|---|---|---|
| `LIST_CAP_SCHEMA_SUMMARY` | 20 | 连接概览 Schema 摘要；家族 A／Catalog 左树 Schema 节点过多时 |
| `LIST_CAP_TABLE_WORKBENCH` | 5 | 家族 A 单展开组内默认表行；「显示更多」步长 = 5 |
| `LIST_PAGE_SIZE_GRANTS` | 50 | 家族 B 每页最大**表行**数（不含 Schema／连接头） |

### 3.0 挂载合同（全家族）

- 表行（或候选表 checkbox、已授表名行）只有落入**当前可见窗口**才可挂载到文档。
- 禁止用 `hidden`／`display:none`／零高度滚动容器承载窗外全量行来声称满足 cap。
- 验收可断言：相关 `data-testid` 范围内表行节点数 ≤ 当前可见上限（SC-13）。

### 3.1 家族 A — 按连接组织的表工作台

适用范围：`/connections/enabled-tables`、`/catalog`。

| 规则 | 合同 |
|---|---|
| 分组键 | `connectionId + schema`（Catalog 即现有 `groupedTables` 键） |
| Schema 组 | **同时只展开一组**；其余仅摘要（名 + 计数等），**零表行 DOM** |
| `schema=all` / 多连接 | 仍只允许一组展开；不得因「全部」而挂多组表行 |
| 组内表 | 默认最多 5；「显示更多」每次 +5；窗外不挂载 |
| 搜索／筛选变更 | 重置显示更多进度；可自动展开命中最多／唯一命中组 |
| Schema 摘要／左树 Schema 过多 | 20 +「显示更多」 |
| 与旧启用表逻辑 | **取代**「`visibleTotal ≤ 50` 则所有 Schema 组全展开」；家族 A 默认即单组+5，与旧 `WHITELIST_ROW_BUDGET` 全展开阈值无关 |

### 3.2 家族 B — 角色／Agent 授权类

适用范围：角色详情表授权编辑区；Agent 详情权限预览中的**表名行**。

| 规则 | 合同 |
|---|---|
| 计数单位 | 候选表 checkbox 行，或有效权限树中的表名行；**连接头／Schema 头不计入 50** |
| 硬上限 | 过滤后表行数 >50 ⇒ **必须分页**；单页表行 ≤50 |
| 搜索 | 先过滤再分页；页数按过滤后集合计算 |
| 已选摘要 | 全局已选计数可见；默认折叠；展开后表名行 >50 同样分页 |
| 禁止 | 所有连接×所有 Schema×所有表同时铺成不可分页墙；禁止仅用滚动容器代替分页 |

### 3.3 连接概览（管连接）

- Schema 摘要列表：20 +「显示更多」。
- 表：默认不展开；点开懒加载；展开后单 Schema 适用 5 +「显示更多」+ 挂载合同。
- 搜索：须提供该清单的系统内搜索；**默认实现**为单元格内最小搜索（N5），不阻塞家族 A 主路径。

### 3.4 另案

- `/admin/access-map`：本 Spec 不改 Sankey 主契约。

## 4. 核心流程（伪代码）

```
onOpen(page):
  if page.manages == connection:
    show schemaSummaries capped(LIST_CAP_SCHEMA_SUMMARY)  # mount only visible
    tables := collapsed
  else if page.family == A:
    require systemSearch
    expand at most one groupKey(conn, schema)
    mount tablesInGroup[0:LIST_CAP_TABLE_WORKBENCH] only
  else if page.family == B:
    require systemSearch
    mount pageSlice(filteredTableRows, LIST_PAGE_SIZE_GRANTS) only

onSearchOrFilterChange:
  reset showMoreWindow or pageIndex := 1
  maybeAutoExpandBestMatchingGroup()  # family A
  if filteredTotal > pageDefaultCap: showSearchGuidance()

onShowMore:  # family A
  next := min(visible + 5, filteredInGroup)
  mount exactly rows[0:next]  # replace window; do not keep hidden tail in DOM

onPageChange(delta):  # family B
  pageIndex := clamp(pageIndex + delta, 1, pageCount(filteredTableRows, 50))
  remount only current page rows
```

## 5. 实现边界（指导，非开发授权）

建议共享：`ShowMoreList`／等价 hook（含挂载窗口）、`PagedList`／等价、单组展开状态、上表常数。

建议落地顺序（须另获开发授权与 Plan）：

1. 家族 A：`TableWhitelist` + `Catalog`（含废止 ≤50 全展开）
2. 连接概览 Schema cap + 展开表清单搜索／5 行 cap
3. 家族 B：`RoleTableGrants` + Agent 权限预览

非目标：见闭口层级「不在本条出口」。不削弱 P1-80 启用表三态诚实。

## 6. 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| SC-01 | 连接概览首访 | 表清单未默认展开；可见为 Schema 摘要 |
| SC-02 | 连接概览 Schema >20 | 默认 ≤20 行 +「显示更多」；计数诚实 |
| SC-03 | 连接概览展开单 Schema 表 >5 | 默认 ≤5 +「显示更多」；可系统内搜索 |
| SC-04 | 启用表首访／多 Schema | 同时只展开一组；未展开组无表行 DOM |
| SC-05 | 启用表展开组表 >5 | 默认 ≤5；显示更多每次 +5 |
| SC-06 | 启用表搜索命中远端表 | 能定位到目标；不依赖 Ctrl+F；窗口重置正确 |
| SC-07 | Catalog 右表；`schema=all` 且多组 | 同时只展开一组表行；其余组仅摘要 |
| SC-08 | 角色表授权过滤后 >50 候选 | 单页表行 ≤50；可分页 |
| SC-09 | 角色搜索某表名 | 过滤后分页；能勾选；已选计数全局可见 |
| SC-10 | Agent 权限预览表名行 >50 | 分页；单页 ≤50；搜索可用 |
| SC-11 | 搜索 0 命中 | 空态写明原因并引导改关键词 |
| SC-12 | 浏览器验证 | 用户可见面须真实前台浏览器 + 即时计时；禁止只验 API |
| SC-13 | 挂载合同 | 有界列表区域内表行 DOM 数 ≤ 当前可见上限（含显示更多后的窗口） |
| SC-14 | 搜索引导 | 过滤后总量 > 该页默认 cap 时，可见系统内搜索引导文案 |
| SC-15 | 启用表小集合 | 即使过滤后总表行 ≤50，仍不得多 Schema 组同时挂表行（废止旧全展开） |

## 7. 与既有 Spec 的关系

| 既有 | 关系 |
|---|---|
| Spec 133 | 角色选表收回「有界＋层级」方向；本轮不强制重做 AssetHierarchyPicker 全功能，但禁止全铺墙 |
| Spec 152 | 左树折叠保留；右表补家族 A；左树 Schema 节点过多适用 20 cap |
| Spec 47／11／启用表预算 | **本条取代**「过滤行 ≤50 则全组展开」的默认策略；分页常数可复用思路但语义改为家族 A 的 5／单组 |
| Spec 163 | 正交 |
| P1-80 | 不削弱三态诚实 |

## 8. 已冻结决策（原 OQ）

| ID | 决策 |
|---|---|
| D1（原 OQ-1） | 家族 B 的 50 只计表行／checkbox／表名行，不含连接／Schema 头 |
| D2（原 OQ-2） | Catalog 左树 Schema 节点过多时适用 `LIST_CAP_SCHEMA_SUMMARY=20` |
| D3（原 OQ-3） | 深链 `?schema=` 优先展开该组，仍只允许一组，且组内受 5 行 cap |

## Changelog

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1-draft | 2026-11-27 | 首稿落盘；委托人批准启动对抗评审 |
| v0.2-draft | 2026-11-27 | 轮次1：闭合 B1–B6（Catalog 组单位、挂载合同、家族 B 硬 50、搜索引导、废止 50 全展开、Agent 计数）；SC-13–15；OQ→D |
| v0.3-draft | 2026-11-27 | 轮次2–3：已选摘要分页 E14；连接概览默认单元格内搜索；三轮结论 Approve with nits；仍待终稿确权／开发授权 |
| v1.0 | 2026-11-27 | **终稿确权**（委托人明示「授权 spec定稿」）。阶段 S2；未授权开发；配对 Plan／UAT 套件同批制作 |
