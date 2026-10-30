# 访问关系图阅读降噪 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.3 已验收** |
| 日期 / 目标版本 | 2026-10-30 / 不绑定产品版本号。不升 Spec 187 版本号 |
| 功能编号 / 优先级 | **无** / **P1**（页头与图面）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.3 已验收**（2026-10-30）。D1–D8 已按 §4 提议采纳。SC-01–SC-16 由组件测试、布局测试与 `npm run lint:terminology` 关闭。浏览器走查不在本条出口。本条验收不表示可上线 |
| 决策来源 | 2026-10-30 对 `http://127.0.0.1:55176/admin/access-map` 的页面探查：4 个 Agent、23 条边全部为僵尸授权、需复核 0、确凿越权 0、统计窗口 168h。信号文案、图例、桑基图、节点按钮、技术 ID 链接和凭证清单叠在同一条纵向流里 |
| 需求来源 | 治理台访问关系图需要企业级阅读层级：一屏只回答「这张图现在怎样」，口径和等价清单离开主视觉 |
| 实施主体 | Lucy WebUI 访问关系图页（`webui/src/pages/admin/AccessMap.tsx` 与 `webui/src/components/admin/AccessMap*.tsx`）。不修改 KTX，不修改 `/api/admin/access-map` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」：仓库级呈现修订落 `docs/specs/` |
| 与既有 Spec 的关系 | **修订 Spec 187 的呈现，不修订其语义。** 权威仍是 [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)。边状态、路径守恒、Token 只过滤访问层、两档措辞、URL 参数、降级矩阵沿用该文。Spec 187 §4.4「僵尸授权」一行的 UI 表现已指向本 Spec §5.3。Spec 187 的 SC-01–SC-14 不在本条出口 |
| 实施计划 | [`docs/plans/2026-10-30-lucy-access-map-quiet-reading-plan.md`](../plans/2026-10-30-lucy-access-map-quiet-reading-plan.md) |

> v0.3 已验收（2026-10-30）。D1–D8 已按 §4 的「提议」列全部拍板采纳，无否决项。Spec 187 §4.4 僵尸授权行的 UI 表现与 `TD-187-01` 的着色句已指向本文 §5.3；语义（API、URL 值、边状态判定、两档措辞）不变。SC-01–SC-16 已关闭。本条收口不表示可上线。

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图按页头、工具条、三张指标卡、主工作区、凭证表阅读；口径与快照离开首屏；节点名称落在卡片内；警告色只留给大于 0 的需复核、确凿越权，以及指标卡上的僵尸授权计数。
- 本条出口：SC-01–SC-16。组件测试与布局测试打假可见文案、选中态、URL 值、列标题、文字盒与流带、着色、视觉隐藏清单、抽屉、聚焦面包屑、数据表与凭证表；SC-15 扫描源码色值；SC-16 以 `npm run lint:terminology` 退出码 0 为准。
- 不在本条出口：浏览器走查、Playwright、窄屏视口、镜像构建、部署、证据等级，以及 Spec 187 的 SC-01–SC-14（含守恒、降级、跨页回归与跨模块对账）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用访问关系图、授权路径、访问路径、僵尸授权、需复核、确凿越权、凭证清单、Agent、角色、连接、Schema、表、Token。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 统计窗口 | 近 24 小时 / 近 7 天 / 近 30 天 | URL 值仍是 `24h` / `168h` / `720h` |
| Schema 层 | 折叠 / 展开 | URL 值仍是 `flat` / `schema` |
| 视图 | 关系图 / 数据表 | URL 值仍是缺省或 `view=table` |
| 聚焦 | 全图 / {节点名} | 「全图」清除 `focus` |
| 折叠区 | 口径说明、快照 | 口径与 `config` / `policy` 哈希离开标题行 |

Forbidden terms:

- 用「桑基图」「拓扑图」「权限流向图」作页面标题或导航名。
- 「需复核」的按钮、ⓘ、图例、抽屉标题中出现「越权」。
- 把 `agent` / `role` / `connection` / `table` / `schema` 原样写进数据表「类型」列。
- 把 `24h` / `168h` / `720h` 作为统计窗口的可见选项文案。

`Agent`、`Token`、`Schema`、连接名、表名、角色 id、`config` / `policy` 哈希、规范源键在 DOM 上使用 `translate="no"` 与 `notranslate`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/11-components-data-grid.md`
- `webui/docs/design-system/12-components-metric-card.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`（`TD-187-01`）

### What This Change Follows

- [x] 页头可见主动作不超过 3 个；关系图 / 数据表用已有 `pl-admin-tabbar`，选中态不用 `primary`
- [x] 统计窗口用 `pl-segmented-control`，选中态不用 `primary`
- [x] 三枚信号使用共享 Metric Card：标题、ⓘ、主值、副文；网格为 `pl-metric-grid--three`
- [x] 卡壳与 ⓘ 是兄弟按钮，ⓘ 不嵌进另一枚按钮
- [x] 计数为 0 时主值中性；僵尸授权、需复核大于 0 时主值用 warning tone；确凿越权大于 0 时主值用 danger tone
- [x] 流带与内核只用既有语义 token，不新增硬编码色值
- [x] 数据表与凭证表沿用 `pl-data-grid`；数字右对齐；表题可见
- [x] 小于最小可读宽度时图区横向滚动，不做窄屏重排
- [x] 状态同时有文字或线型，不只靠颜色

### Exceptions (If Any)

- `TD-187-01` 原写「僵尸授权用 `warning`」。本 Spec §5.3 已改为：僵尸授权的流带本体用 `series/grant` 的 default，状态由卡片上的「僵尸授权」标记承担。需复核仍是 warning 虚线，确凿越权仍是 danger 实线。该句已写入 `TD-187-01` 与 Spec 187 §4.4。
- 抽屉沿用治理台已有的 Radix Dialog 侧栏样式，不引入 `ObjectDetailDrawer`（该组件绑定 Agent / 角色 / 表 / 审计对象）。

### Follow-up Needed

- None。`TD-187-01` 与 Spec 187 §4.4 僵尸授权行已指向本文 §5.3。不新增设计系统章节。

---

## 1. 背景

Spec 187 要求页头、信号条、图区、侧边明细。现行页面把下列内容按同一字号叠成一列：

1. 标题、一句定义、`config` / `policy` 哈希。
2. 统计窗口、Schema 层、访问口径、搜索与「定位」。
3. 三枚信号按钮，以及需复核定义、确凿越权来源、原始调用数、覆盖率警告。
4. 一行图例，含色块和 ISO 起止时间。
5. SVG 流带。当前 23 条边全是僵尸授权，流带全部是警告色，表名被流带盖住。
6. 每个节点一枚按钮，每条非正常边一条技术 ID 链接。
7. 按 Agent 分组的虚线凭证区，每组重复守恒说明。

数据表视图在同一套信号条文案下面接两张表。类型列显示 `agent` / `role` / `connection` / `table`。表题只在 `sr-only` caption 里。

## 2. 目标

1. 首屏阅读顺序固定为：页头 → 工具条 → 三张指标卡 → 主工作区。
2. 主工作区在关系图视图是带列标题的图；在数据表视图是「节点」「关系」两张表。
3. 口径、快照哈希、覆盖率说明放在折叠区。图例只保留四枚色块或线型，窗口起止放进指标卡副文或口径说明。
4. 节点名称完整落在卡片内。流带只画在列与列之间。
5. 图下节点清单和异常边清单保留在无障碍树里，视觉上不占位。
6. 点边打开右侧明细。点节点仍写 `focus`。聚焦时工具条显示「全图 / {节点名}」。
7. 凭证清单是一张表。点击 Token 仍只过滤访问层，提示句保持 Spec 187 原文。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 `/api/admin/access-map`、边状态机、路径守恒、折叠预算 | Spec 187 §4–§6 仍是语义事实源 |
| 改 URL 参数名与合法值 | `window` / `layer` / `trust` / `view` / `focus` / `token` 等保持可分享 |
| 改「需复核」「确凿越权」两档定义与措辞 | Spec 187 §4.9 |
| 让 Token 进入流带或参与守恒 | Spec 187 §4.5 |
| 引入 `d3-sankey` 或其他运行时依赖 | 现行实现的依赖约束保持 |
| 重排窄屏、做移动端断点 | 治理约定：未要求时不做窄屏适配；图区横向滚动 |
| 在图上直接改授权 | 页面保持只读 |
| 用警告色涂满「全部为僵尸授权」的图 | 警告色留给大于 0 的需复核与确凿越权；僵尸授权的数量放在指标卡 |

## 4. 拍板记录

**拍板记录（2026-10-30）**：D1–D8 全部按本表「提议」列采纳，**无否决项**。D3 与 D5 的否决退路已关闭，不留作后续实现路径。本节保留原「拍板前的现行口径」列作为变更前的事实记录。

| ID | 提议 | 拍板前的现行口径 |
|---|---|---|
| D1 | 只改呈现。API、URL 值、边状态、两档措辞、Token 过滤句不变 | Spec 187 |
| D2 | 三枚信号改为 Metric Card。卡壳是筛选按钮，ⓘ 是兄弟按钮。筛选仍只影响高亮与数据表行，不改响应体 | 三枚 `pl-btn` 与长文并排 |
| D3 | 僵尸授权流带用 `series/grant` default，卡片上保留「僵尸授权」文字。需复核保持 warning 虚线。确凿越权与 `overflow` 保持 danger 实线 | `TD-187-01`：僵尸授权用 warning |
| D4 | 节点是定宽卡片。高度仍按流量，且不小于两行字。列标题写在 SVG 内。图区不缩小 SVG，放不下时横向滚动 | 14px 细条，标签画在流带通道上，`max-w-full` 缩小整图 |
| D5 | `access-map-node-list` 与 `access-map-edge-badges` 加视觉隐藏，test id 保留。键盘焦点在图内节点、以及这两份隐藏清单上 | 两份清单以普通按钮铺在图下 |
| D6 | 边明细放右侧抽屉。`access-map-edge-detail` 跟着走。Esc 关闭抽屉，不清除 `focus` | 明细展开在图下 |
| D7 | 凭证清单改为一张表：Agent、Token、状态、窗口内调用。守恒说明只出现一次 | 按 Agent 分组的虚线框 |
| D8 | 关系图 / 数据表用 `pl-admin-tabbar`。统计窗口用分段控件，可见文案为近 24 小时 / 近 7 天 / 近 30 天 | 页头两枚按钮用 `primary` 表示选中；下拉框显示 `168h` |

D3 未否决：僵尸授权流带使用 `series/grant` default。D5 未否决：节点清单与异常边清单视觉隐藏。这两条退路不再打开。

## 5. 呈现规格

### 5.1 页面骨架

```text
Page Header
  标题：访问关系图
  描述：授权路径与窗口内实际访问对照。
  动作：无。视图切换不放在页头。

工具条
  左：统计窗口分段控件
  中：Schema 层、访问口径（标签在控件上方）
  右：搜索框 + pl-icon-btn（aria-label「定位」）
  focus 存在时：面包屑「全图 / {节点 label}」，「全图」使用 data-testid="access-map-back-to-full"

指标
  pl-metric-grid--three
  僵尸授权 | 需复核 | 确凿越权

折叠（默认关）
  口径说明：两档定义、覆盖率、原始调用数、被拒绝的访问尝试、图例四项、窗口 ISO 起止
  快照：config 版本与 policy 版本。data-testid="access-map-snapshot-id" 留在这块里

主工作区
  pl-admin-tabbar：关系图 | 数据表
  关系图：列标题 + 卡片节点 + 流带
  数据表：标题「节点」、标题「关系」

次级
  凭证清单表
```

页头不再渲染哈希。`access-map-snapshot-id` 移到「快照」折叠内，文案保持 `config {accessConfigVersion} · policy {policyVersion}`。

### 5.2 指标卡

| 卡 | 标题 | 主值 | ⓘ 内容 | 大于 0 时的主值 tone |
|---|---|---|---|---|
| 僵尸授权 | 僵尸授权 | `{dormantEdges}` | 授权路径数大于 0，且窗口内访问路径数为 0 | warning |
| 需复核 | 需复核 | `{needsReviewEdges}` | Spec 187 的 `ACCESS_MAP_NEEDS_REVIEW_TIER_NOTE` 全文。不得含「越权」 | warning |
| 确凿越权 | 确凿越权 | `{confirmedUnauthorizedEdges}` | Spec 187 的 `ACCESS_MAP_CONFIRMED_TIER_SOURCE` 全文 | danger |

- 主值为 0 时不用 warning / danger tone。
- 副文：未按下时「未筛选」；按下时「正在筛选」。
- `aria-pressed` 与现有 `access-map-signal-dormant` / `access-map-signal-needs-review` / `access-map-signal-confirmed` 留在筛选按钮上。
- 覆盖率句子、原始调用数、孤儿授权句移入「口径说明」。`access-map-snapshot-coverage`、`access-map-signal-calls`、`access-map-orphan-grants`、`access-map-signal-needs-review-note`、`access-map-signal-confirmed-source` 这些 test id 留在折叠内容里，文案不改。

### 5.3 流带着色

在 Spec 187 §4.4 的状态判定之后着色。判定顺序不变。

| 边状态 | 流带本体 | 内核 | 卡片标记 |
|---|---|---|---|
| `normal` | `series/grant` default，低透明度 | `series/access` default | 无 |
| `dormant` | 与 `normal` 相同的流带本体 | 不画内核 | 文字「僵尸授权」 |
| `needs_review` | warning，虚线 | warning，虚线 | 文字「需复核」 |
| `overflow` | danger，实线 | danger，实线 | 文字「确凿越权」或 Spec 187 对该状态的现有标签 |

`confirmedUnauthorized` 为真时，内核使用 danger 实线，并在抽屉里保留「确凿越权：调用当时授权亦不覆盖」。

信号筛选的淡出规则不变：未命中的边降透明度，数据本身不删除。

### 5.4 图面布局

- 列顺序保持 Agent → 角色 → 连接 →（Schema，仅 `layer=schema`）→ 表。
- 每列一个标题，使用上表中文列名。标题在 SVG 内，与列左缘对齐。
- 节点卡片宽度固定，能放下约 18 个拉丁字符；更长的 `label` 尾部省略，`<title>` 与抽屉给全名。
- 卡片高度 = `max(两行字高, 流量比例高度)`。副行仍是现有 `accessMapNodeSubtitle`。
- 流带从源卡片右缘连到目标卡片左缘，不穿过卡片文字盒。
- 去掉 SVG 的 `max-w-full` 缩小。图区容器 `overflow-x: auto`。
- 悬停节点时，不相连的边降透明度。该行为保持。

### 5.5 聚焦、搜索、边明细

- 点击卡片或隐藏节点按钮：`setParam("focus", nodeId)`，与现在相同。
- 面包屑「全图」：`setParam("focus", null)`。
- 搜索：Enter 或「定位」图标按钮调用现有 `runSearch`。无命中时仍显示 `access-map-search-message`。
- 点击内核、或激活隐藏的异常边按钮：打开抽屉，写入同一份边明细（授权路径、去重 Agent、访问路径、调用次数、状态、`reviewEvaluations`）。
- 抽屉打开不写 URL。关闭抽屉不改 `focus`、不改筛选。
- Esc：若抽屉开着，只关抽屉；若抽屉关着且 `focus` 存在，清除 `focus`。

### 5.6 数据表与凭证表

数据表：

- 第一张可见标题「节点」。列保持：节点、类型、去重 Agent 数、授权路径数、访问路径数。
- 类型列：`agent`→Agent，`role`→角色，`connection`→连接，`schema`→Schema，`table`→表。
- 第二张可见标题「关系」。列保持 Spec 187 §7.5。
- 状态用 `pl-status-badge`。僵尸授权用 warning 徽章，确凿越权用 danger 徽章，正常态用中性徽章。
- 数字列右对齐。表头在各自滚动容器内吸顶。
- 信号筛选仍只过滤关系行，节点表保持全量。

凭证表：

- 可见标题「凭证清单」。
- 标题下只留一句：Token 只过滤访问层，授权层不受影响。
- 列：Agent、Token、状态、窗口内调用。
- 状态文案保持：生效中、已过期、已吊销。
- 行按钮保留 `access-map-token-${token.id}`。再次点击同一 Token 取消过滤。
- 过滤生效时，工具条下仍显示 Spec 187 的句子：「已按 Token {label} 过滤访问层，授权层不受影响。」`access-map-token-filter-notice` 保留。

### 5.7 无障碍

- SVG `aria-label` 摘要保持现有句式。
- 隐藏清单仍可 Tab 聚焦，Enter 触发与现在相同的回调。
- 视觉隐藏使用同时满足「不占位」和「可被读屏读到」的既有手法；不得 `display: none`，不得 `aria-hidden="true"`。
- 数据表仍是整页等价视图，`view=table` 深链保持。

## 6. 核心流程（伪代码）

```text
render(response, url):
  view = url.view == "table" ? "table" : "map"
  show header without version hashes
  show toolbar(window label, layer, trust, search, focus breadcrumb)
  show three metric cards from response.meta.signals
  show disclosures collapsed
  show tabbar(view)

  if response.meta.grant.state == "unavailable":
    show existing grant notice
    return

  show signal-filtered highlight set
  if view == "table":
    show node grid with chinese kind labels
    show edge grid filtered by highlight set
  else:
    layout = cards with min height for two text lines
    paint ribbons by section 5.3
    hide node list and edge badges visually, keep them focusable
  show credential grid

paint(edge):
  state = existing Spec 187 classifier(edge)
  if state == "needs_review":
    stroke = warning, dash = true
  else if state == "overflow" or edge.confirmedUnauthorized:
    stroke = danger, dash = false
  else:
    stroke = series/grant default
    if edge.accessPaths == 0: omit kernel
    else: kernel = series/access default
  if highlight set exists and state not in set:
    opacity = dimmed

onEdgeActivate(edge):
  open drawer(edge)
  do not write url

onToken(label):
  toggle url.token
  keep grant ribbons
  show the Spec 187 token notice while url.token is set

onEscape:
  if drawer open: close drawer
  else if url.focus: clear focus
```

失败与降级分支沿用 Spec 187 §5.5 / §7.6：授权面不可用时不画图；访问面不可用时仍画授权骨架，并保留现有「审计数据不可用」提示。本 Spec 不新增降级文案。

## 7. 验收

| ID | 断言 |
|---|---|
| SC-01 | 三张指标卡可见。主值为 0 时无 warning / danger tone。主值大于 0 时按 §5.2 上色 |
| SC-02 | 「需复核」ⓘ 与 `access-map-signal-needs-review-note` 的文本不含「越权」 |
| SC-03 | 关系图 / 数据表的选中态不使用 `pl-btn--primary`。统计窗口选中态不使用 `pl-btn--primary` |
| SC-04 | 统计窗口可见文案为近 24 小时、近 7 天、近 30 天；写入 URL 的值仍是 `24h` / `168h` / `720h` |
| SC-05 | 页头不出现 `config` / `policy` 哈希；展开快照后 `access-map-snapshot-id` 文本与现网一致 |
| SC-06 | 列标题按层出现：Agent、角色、连接、表；`layer=schema` 时增加 Schema |
| SC-07 | 节点 `label` 的绘制盒与流带通道不相交。超长名称在卡片内省略，`title` 为全名 |
| SC-08 | `dormant` 边的流带 class 不含 warning。`needs_review` 为虚线 warning。确凿越权内核为实线 danger |
| SC-09 | `access-map-node-list` 与 `access-map-edge-badges` 不占据布局高度，其中按钮仍可聚焦，test id 仍在 |
| SC-10 | 点击边后 `access-map-edge-detail` 在抽屉内，不在图下方的文档流里 |
| SC-11 | `focus` 存在时可见「全图 / {label}」。激活 `access-map-back-to-full` 后 URL 无 `focus` |
| SC-12 | 数据表类型列为 Agent、角色、连接、Schema、表之一。两张表都有可见标题「节点」「关系」 |
| SC-13 | 凭证区是表。点击 Token 后提示句等于「已按 Token {label} 过滤访问层，授权层不受影响。」再次点击清除 `token` |
| SC-14 | 现有访问关系图单测与选择器契约中的 test id 保持可找到。允许改断言的是可见文案、class 和「清单是否占位」 |
| SC-15 | 页面源码无新增裸十六进制颜色 |
| SC-16 | `npm run lint:terminology` 通过 |

SC-01–SC-16 **已验收**（2026-10-30）。依据是 `webui/src/__tests__/access-map.test.tsx` 与 `webui/src/__tests__/access-map-layout.test.tsx` 合计 36 项通过，以及仓库根 `npm run lint:terminology` 退出码 0（1087 个文件）。

验收证据（2026-10-30，配套 Plan 的 §5）：

| SC | 自动化断言 | 落点 |
|---|---|---|
| SC-01 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-02 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-03 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-04 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-05 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-06 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-07 | 有断言（几何自检 + 省略与全名） | `webui/src/__tests__/access-map-layout.test.tsx`、`webui/src/__tests__/access-map.test.tsx` |
| SC-08 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-09 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-10 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-11 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-12 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-13 | 有断言 | `webui/src/__tests__/access-map.test.tsx` |
| SC-14 | 有断言（既有 test id 仍可找到） | `webui/src/__tests__/access-map.test.tsx` |
| SC-15 | 有断言（源码扫描无裸十六进制） | `webui/src/__tests__/access-map-layout.test.tsx` |
| SC-16 | 命令级门禁（`npm run lint:terminology` 退出码 0） | 仓库根脚本 |

上表是本条出口。浏览器走查归 [`lucy-20261030-webui-release-ux-review-spec.md`](lucy-20261030-webui-release-ux-review-spec.md) 的必走表面。窄屏视口、镜像构建、部署，以及 Spec 187 的 SC-01–SC-14，不在本条出口。

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
| 10 | 落盘后跑 `lint:spec-docs` | 闭口时执行，结果记在配套 Plan §8 |
| 11 | 闭口层级 | 上文。层级为功能合同 |
