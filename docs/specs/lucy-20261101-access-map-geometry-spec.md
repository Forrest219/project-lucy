# 访问关系图几何语言修订 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.2 已实施** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号。不升 Spec 187 版本号 |
| 功能编号 / 优先级 | **无** / **P1**（图面几何）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.2 已实施（2026-11-01）**。S1–S4 已落地。SC-01–SC-14 与桌面截图 SC-16 见 [实施笔记](../reviews/2026-11-01-access-map-geometry-implementation-notes.md)。SC-15 已拆出。本状态只对齐实施笔记，不另写收口记录，也不表示可上线 |
| 决策来源 | 2026-11-01 几何复盘结论（委托人批准）＋交叉审阅 [`inbox/2026-11-01-access-map-geometry-spec-plan-cross-review.md`](../../inbox/2026-11-01-access-map-geometry-spec-plan-cross-review.md)；修订裁定接受阻断项与桌面截图最低视觉出口，拒绝「取消刻度封顶、撑满槽位放大 unit」 |
| 需求来源 | 治理台访问关系图的流带厚度须可比较、节点不得喧宾夺主；稀疏图不得被撑成粉肉块，也不得缩成槽位里的迷你图顶条 |
| 实施主体 | Lucy WebUI `AccessMapCanvas` 布局与绘制（`webui/src/components/admin/AccessMapCanvas.tsx` 及对应测试）。不修改 KTX，不修改 `/api/admin/access-map` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **再修订** quiet-reading [`lucy-20261030-access-map-quiet-reading-spec.md`](lucy-20261030-access-map-quiet-reading-spec.md) **§5.4**，以及 chart-first [`lucy-20261101-access-map-chart-first-spec.md`](lucy-20261101-access-map-chart-first-spec.md) 对卡片规则的沿用句。**保持** quiet-reading §5.3 着色 token、chart-first 页壳。权威语义 [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md) 不变 |
| 实施计划 | [`docs/plans/lucy-20261101-access-map-geometry-plan.md`](../plans/lucy-20261101-access-map-geometry-plan.md) |
| 审阅 | 交叉审阅 v0.1 → 本 v0.2 定稿 |

> v0.2 已实施（2026-11-01）。D1–D12 按 §4 拍板。SC 出处见实施笔记。本条收口不表示可上线。

## 闭口层级

- 层级：功能合同
- 本条承诺：访问关系图 SVG 采用「细柱 + `labelBlock` 外标 + 计量刻度封顶 + 四态面积流带」，路径厚度可比；计量几何与命中地板解耦；着色 token 与 Spec 187 双层编码语义不变；当前 demo 稀疏图达到约定图面占比并经桌面截图验收。
- 本条出口：SC-01–SC-14 与桌面截图 SC-16。
- 不在本条出口：SC-15 术语 lint（2026-11-02 拆出，见 [出口拆分记录](../reviews/2026-11-02-functional-contract-exit-split.md)）；完整浏览器发布走查、Playwright 套件、窄屏/移动、镜像构建、部署、证据等级；Spec 187 / quiet-reading / chart-first 既有 SC（冲突的布局断言由本条改写承接）。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 不新增产品概念。沿用访问关系图、授权路径、访问路径、僵尸授权、需复核、确凿越权、Agent、角色、连接、Schema、表、Token。

控件文案（不登记为新术语）：

| 控件 | 文案 | 说明 |
|---|---|---|
| 图例短行 | 沿用 chart-first 四项 | 本条不改图例文案 |
| 节点 `labelBlock` | 名称 + `accessMapNodeSubtitle` + 状态文字（若有） | 状态文字用既有标签 |

Forbidden terms:

- 用「桑基图」「拓扑图」「权限流向图」作页面标题或导航名。
- 「需复核」的图例、ⓘ、抽屉标题中出现「越权」。
- 把几何改动写成新的授权模型或新的路径口径。

`Agent`、`Token`、`Schema`、连接名、表名、角色 id 在 DOM 上使用 `translate="no"` 与 `notranslate`。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/99-governance.md`（`TD-187-01`）
- [`docs/specs/lucy-20261030-access-map-quiet-reading-spec.md`](lucy-20261030-access-map-quiet-reading-spec.md)
- [`docs/specs/lucy-20261101-access-map-chart-first-spec.md`](lucy-20261101-access-map-chart-first-spec.md)

### What This Change Follows

- [ ] 颜色只用语义 token / class；无新增裸十六进制
- [ ] `TD-187-01` / quiet-reading §5.3：`series/grant`、`series/access`；僵尸与正常同色；需复核 warning + 非颜色线型；确凿越权 / overflow danger + 实线
- [ ] 外侧标签在图区底上用 `fg-strong` / `fg-muted`；禁止深底深字作唯一可读名
- [ ] 选中态沿用 chart-first，不用 `pl-btn--primary`
- [ ] 过窄横滚；不做窄屏重排
- [ ] 不新增运行时依赖

### Exceptions (If Any)

- quiet-reading §5.4 定宽卡片布局：**废止**。
- chart-first §5.6 卡片几何沿用句：**由本条取代**；页壳、栏距常量下限、悬停浮层保持。
- 不重开 quiet-reading D3 着色决议。
- 本条出口含**当前 demo 桌面截图人工验收**（SC-16），不等于完整发布 UX 走查或 Playwright 套件。

### Follow-up Needed

- None 于本条。

---

## 1. 背景

v0.1 方向正确（细柱、外标、封顶、面积带），交叉审阅指出合同缺口：四态内核几何未闭口、外标避碰不足、计量地板与比例断言矛盾、`6–14px/路径` 未对 demo 验占比、面积化后虚线/命中未定义、SC 有假阳性空间。v0.2 关闭上述缺口后再实施。

## 2. 目标

1. 细柱锚点 + 完整 `labelBlock` 外标与强制避碰。
2. 计量刻度封顶；**禁止**用槽位高度反向放大 `unitPx`；稀疏图以内容高度为准，槽位过大则垂直居中（或收缩槽位），避免迷你顶条。
3. 面积流带为主视觉；四态骨架/内核/线型/命中分别定义。
4. 计量厚度严格 `weight * unitPx`；可见性/点击用独立命中层，不改计量。
5. 出入槽位按对端纵向位置排序，减少无意义交叉。
6. 着色与页壳合同保持；自动化 + 桌面截图可打假。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改 API / 边状态机 / 路径守恒 / 折叠预算 / URL 合法值 | Spec 187 |
| 改两档措辞、Token 过滤原文 | Spec 187 |
| 改 chart-first 页壳结构 | 已收口 |
| 重开 quiet-reading D3 着色 | 已拍板 |
| 引入 `d3-sankey` | 依赖约束 |
| 窄屏重排、完整 Playwright、发布走查套件 | 不在本条；SC-16 仅桌面截图 |
| 取消刻度封顶以撑满槽位 | 复盘原病 |
| 财报 Logo / 绿红损益语义 | 不适用 |

## 4. 拍板记录

| ID | 决议 |
|---|---|
| D1 | 只改呈现几何与绘制；语义与 API 不变 |
| D2 | 细柱宽度导出常量 **`PILLAR_WIDTH = 16`**（允许实现微调但必须 ∈ [12, 20] 且测试锁导出值） |
| D3 | **`labelBlock`** = 名称行 + 副标题行 + 状态行（若有）。首列：柱左；末列：柱右；**中间列：柱上方**（避免入向流带）。名称 `fg-strong`，副标题/状态弱一级。超长省略；全名在浮层/`<title>`/抽屉 |
| D4 | **`MAX_PX_PER_PATH = 24`**（导出）。`unitPx = min(rawUnit, MAX_PX_PER_PATH)`。**禁止** `max(..., MIN_PX)` 式抬高计量刻度。`rawUnit` 的预算见 §5.3，**不得**用「填满 chart-first 槽位」作预算目标 |
| D5 | 授权与内核主视觉为**填充面积 path**；禁止仅靠接近节点高的单 path `strokeWidth` 表达面积 |
| D6 | `NODE_GAP = 16`（导出，≥ 12）。`ACCESS_MAP_COLUMN_GAP` 不回退到 240。列步进见 §5.2 |
| D7 | 状态文字在 `labelBlock` 内；非颜色编码见 §5.4 |
| D8 | 着色 token 映射保持 quiet-reading §5.3；图例短行与浮层保持 chart-first |
| D9 | **四态几何**按 §5.4 闭口：`normal` / `dormant` / `needs_review` / `overflow`（及 `confirmedUnauthorized`） |
| D10 | **计量与命中解耦**：计量厚度 = `weight * unitPx`（可亚像素，布局可 round 到 0.1px）；`MIN_HIT_PX = 8` 仅用于透明命中扩展，不进入槽位求和 |
| D11 | 出边按 **目标节点 y**（再 id）分配源柱槽位；入边按 **源节点 y**（再 id）分配目标柱槽位 |
| D12 | 夹具 **`DEMO_SPARSE_9`**（与当前 demo 同构：3 Agent×3 路径、角色分流、1 连接、3 表）为比例基线；内容高度与槽位关系见 §5.3；**SC-16 桌面截图**为收口必要出口 |

## 5. 呈现规格

### 5.1 节点（细柱）

| 项 | 要求 |
|---|---|
| 宽度 | `PILLAR_WIDTH`（导出，定稿值 16） |
| 计量高度 | `flow(node) * unitPx`（**无**两行字高地板；**无** ≥54 卡片地板） |
| 命中 | 柱体可加透明命中扩展到至少 `MIN_HIT_PX` 宽/高，不改变计量高度 |
| 填充 | 沿用按 `kind` 的语义 fill；不因此加宽 |
| 点击 | 可点节点写 `focus`；未解析不可点 |

### 5.2 `labelBlock` 与纵向步进

| 项 | 要求 |
|---|---|
| 组成 | 名称、副标题、状态（可选）；整块为轴对齐盒 |
| 首列 | 盒在柱左，右缘距柱左 ≥ 6px；垂直对齐该节点**步进单元**中线 |
| 末列 | 盒在柱右，左缘距柱右 ≥ 6px |
| 中间列 | 盒在柱**上方**，底缘距柱顶 ≤ 4px；水平以柱中线为锚（可微偏以避重叠） |
| 步进 | 首/末列：`step = max(pillarHeight, labelBlockHeight) + NODE_GAP`；中间列：`step = labelBlockHeight + labelPillarGap + pillarHeight + NODE_GAP`（`labelPillarGap` ∈ [0, 4]） |
| 禁令 | **不得**为容纳文字抬高计量柱体 |
| 避碰（强制） | （1）任意两 `labelBlock` 不相交；（2）`labelBlock` 不与任一授权/内核/需复核面积带的上下边界采样相交（采样点含带的上缘与下缘，**不只**中线） |

### 5.3 刻度、预算与槽位占比

```text
# 密度预算：只用于压缩过密图，不用于撑稀疏图
DENSE_BUDGET_H = 640
usableForUnit = DENSE_BUDGET_H - PADDING*2 - COLUMN_HEADER_HEIGHT
# 列间隙预扣按「该列节点数-1」* NODE_GAP；中间列另预扣 label 区时，
# 实现须保证 unit 选取后 §5.2 步进与避碰仍成立（可多轮或保守预扣）

rawUnit = min over columns of (usableForUnit - gapReserve(col)) / max(columnFlow[col], ε)
unitPx = min(rawUnit, MAX_PX_PER_PATH)    # MAX = 24；无计量下限抬升

pillarHeight(n) = flow(n) * unitPx
metricRibbon(e) = edgeWeight(e) * unitPx
metricKernel(e) = edge.accessPaths * unitPx

contentHeight = 由 §5.2 步进累加的真实布局高度 + padding
svgHeight = contentHeight
```

**稀疏占比（反迷你顶条）：**

- 夹具 `DEMO_SPARSE_9` 布局后：`contentHeight ∈ [280, 420]`。
- chart-first 容器 `ACCESS_MAP_CANVAS_MIN_HEIGHT` 可保留为槽位上限参考；当 `contentHeight < 0.65 * 槽位计算高度` 时：SVG **垂直居中**于槽位，**或**将槽位高度收至 `contentHeight + 小余量`；**禁止**增大 `unitPx` 填槽。
- `usableHeight` / `DENSE_BUDGET_H` 仅服务 `rawUnit` 压缩；与稀疏居中策略分离。

### 5.4 四态面积流带、线型与命中

公共：

- 授权面积：源柱右缘槽位上下界 → 目标柱左缘槽位上下界，一对三次贝塞尔闭合 **fill** path；fill class = `series/grant`（实现可用既有 `stroke-brand`/`fill` 语义等价 class，测试锁「授权面积 fill ≠ none」且主厚度不来自超粗 stroke）。
- 槽位高度严格 `metricRibbon`；同柱出/入槽位不重叠、不越出柱体计量高。
- 悬停淡出不相干边：保持。

| 状态 | 授权面积 | 访问内核 | 非颜色编码 | 命中（开抽屉） |
|---|---|---|---|---|
| `normal` | `grant*unit` fill | `access*unit` fill，**顶对齐**叠在授权槽内；沿曲线长度：`access<grant` 时自源端截断至比例 `access/grant`，否则全长 | 无额外线型 | 授权面积与内核均可 |
| `dormant` | 同 normal | **不绘制** | `labelBlock`「僵尸授权」 | **授权面积**可悬停/点击（不得只靠隐藏按钮） |
| `needs_review` | **不绘制**授权面积 | 独立警示面积，厚度 `access*unit`，fill = warning 系 subtle/default | **虚线中线**（`strokeDasharray` 画在面积中线 path 上，warning）；不得只靠虚线描边外框冒充 | **该独立面积**可悬停/点击 |
| `overflow` | `grant*unit` fill | 内核 **fill 厚度夹紧为 `grant*unit`**（不把 `access>grant` 画成更厚填充）；沿曲线全长 | 授权+内核复合轮廓 **danger 实线**边界；`labelBlock` 既有越权/overflow 文案 | 授权面积与夹紧内核均可 |
| `confirmedUnauthorized` | 随边状态 | 内核 fill 用 danger（可叠在 access 语义上） | 实线 | 同所属边 |

说明：与 Spec 187「超出部分以警示描边标出」对齐——overflow 多余访问不靠加厚填充表达，靠 danger 实线边界。

### 5.5 列距与横滚

- `ACCESS_MAP_COLUMN_GAP > 240`（保持 chart-first 现行值或更大）。
- 为左/右 `labelBlock` 预留 gutter，计入 `layout.width`。
- `overflow-x: auto`；不整图 `max-w-full` 缩小。

### 5.6 着色 token（保持）

与 quiet-reading §5.3 / 上表一致：`dormant` 与 `normal` 同 grant 色；warning / danger 仅异常态；状态不只有颜色。

### 5.7 与前序承接

| 条款 | 本条 |
|---|---|
| quiet-reading §5.3 | 保持 |
| quiet-reading §5.4 卡片 | **取代** |
| quiet-reading §5.5 抽屉/Esc | 保持 |
| chart-first 页壳/图例/弱入口/浮层 | 保持 |
| chart-first 卡片沿用句 | **取代**；栏距下限与浮层保持 |
| Spec 187 守恒与双层计数 | 保持；本条只闭口几何表达 |

## 6. 核心流程（伪代码）

```text
layoutAccessMap(nodes, edges):
  columns = groupByDepth(flowNodes).sortWithin(flow desc, id)
  unitPx = min(rawUnitFromDenseBudget(columns), MAX_PX_PER_PATH)  # 24

  for col in columns:
    y = contentTop
    for node in col:
      ph = flow(node) * unitPx
      lb = measureLabelBlock(node)   # name + subtitle + status?
      place pillar(colX, yPillar, PILLAR_WIDTH, ph)  # yPillar per §5.2
      place labelBlock per §5.2 (first/last/intermediate)
      y += step(ph, lb) + NODE_GAP   # §5.2
    assert no labelBlock overlaps; assert labels vs ribbon bounds later

  # 槽位：按对端 y 排序
  for each node:
    outEdges = sort by target.y, target.id
    inEdges  = sort by source.y, source.id
    allocate contiguous slots of height weight*unitPx; sum == ph for conserved

  for edge in edges:
    match edge.state:
      normal:
        grantPoly = areaRibbon(grantSlot)
        kernelPoly = areaRibbon(kernelSlot top-aligned in grantSlot,
                                lengthRatio = min(1, access/grant))
        hit = grantPoly ∪ kernelPoly
      dormant:
        grantPoly = areaRibbon(grantSlot); hit = grantPoly
      needs_review:
        reviewPoly = areaRibbon(accessSlot); centerDash = midline(reviewPoly)
        hit = reviewPoly
      overflow:
        grantPoly = areaRibbon(grantSlot)
        kernelPoly = areaRibbon(grantSlot)  # thickness clamped
        dangerOutline = outline(grantPoly)
        hit = grantPoly ∪ kernelPoly

  assert slots within pillars; metric widths == weight*unitPx
  contentHeight = computed; maybe center svg in slot if sparse (§5.3)

onActivate(hit): open edge drawer
onHover(hit): show chart-first tip (dormant 含授权面积)
```

## 7. 验收

| ID | 断言 | 落点 |
|---|---|---|
| SC-01 | 导出 `PILLAR_WIDTH` ∈ [12,20]；流节点布局宽等于该常量；≠ 168 | layout 测试 |
| SC-02 | 完整 `labelBlock`：首列在柱左、末列在柱右、中间列在柱上方；盒与柱间距满足 §5.2 | layout 测试 |
| SC-03 | 导出 `MAX_PX_PER_PATH === 24`；布局 `unitPx ≤ 24` | layout 测试 |
| SC-04 | `DEMO_SPARSE_9`：`contentHeight ∈ [280, 420]`；且显著小于「无封顶、预算撑满 640」的对照高度 | layout 测试 |
| SC-05 | 授权主视觉为 fill 面积；布局/DOM 可证明主厚度不是「单 path 且 strokeWidth≈节点高」；超粗 stroke 不得作为唯一面积表达 | layout + 组件 |
| SC-06 | 在计量无命中地板介入下，`grantPaths` 加倍边的计量厚度为对照边 2 倍（允许 0.1px 取整误差） | layout 测试 |
| SC-07 | 四态几何：normal 内核顶对齐且厚度 `access*unit`≤`grant*unit`；dormant 无内核；needs_review 无授权面积且有虚线中线；overflow 内核厚度夹紧为 grant 且有 danger 实线轮廓 | layout + 组件 |
| SC-08 | 同柱入/出槽位不重叠、不越柱；出边按目标 y、入边按源 y 排序可测 | layout 测试 |
| SC-09 | `labelBlock` 互不重叠；与面积带上下缘采样不相交 | layout 测试 |
| SC-10 | `ACCESS_MAP_COLUMN_GAP > 240`；稀疏时居中或缩槽策略可断言（class/style/测试钩子） | layout + 组件 |
| SC-11 | `dormant` class 不含 warning；needs_review 含虚线；overflow/confirmedUnauthorized 含 danger 实线语义 | 组件测试 |
| SC-12 | 可见 path 悬停：覆盖 dormant（无内核）与 normal；浮层非仅 `<title>`，含从→到与状态 | 组件测试 |
| SC-13 | 可见 path 点击开抽屉：至少 dormant 授权面积与 needs_review 独立带；`access-map-edge-detail` 可见。不得只靠点击隐藏清单按钮充当本条唯一证据 | 组件测试 |
| SC-14 | 无新增裸 hex；无新增运行时依赖 | 组件/静态 |
| SC-15 | **拆出。** 术语 lint 是过程门禁，不在本条出口 | 过程记录 |
| SC-16 | 当前 demo 桌面截图人工验收：稀疏全图占比与留白、三列外标可读、四态（可用夹具或实页）、节点与可见流带悬停/点击。记录落入 `docs/reviews/` 或 `inbox/` 并在收口时引用 | 人工（收口必要） |

上线关系：本条收口不表示可上线。完整发布走查不在本条出口。

## 8. 落盘清单

| # | 要求 | 本文件 |
|---|---|---|
| 1 | Spec 落 `docs/specs/`，`lucy-YYYYMMDD-<slug>-spec.md` | 本文件 |
| 2 | 核心流程（伪代码） | §6 |
| 3 | 文档类型/版本、状态 | 文首 |
| 4 | Plan 五类小节 | 配套 Plan |
| 5 | Terminology Compliance | 上文 |
| 6 | Design System Compliance 四段式 | 上文 |
| 7 | 索引登记 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令/CI | 无 |
| 9 | 功能编号 | 无 |
| 10 | `lint:spec-docs` | Plan §8 |
| 11 | 闭口层级 | 上文 |
