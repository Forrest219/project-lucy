# 访问关系图几何语言修订 —— 实施记录（IMPLEMENTATION_NOTES）

> **本文件与 `inbox/2026-11-01-access-map-geometry-IMPLEMENTATION_NOTES.md` 是同一份文档的两处落点。**
> 权威副本：本文件（`docs/reviews/`，受版本控制）。
> `inbox/` 在本仓库被 `.gitignore` 排除（`.gitignore:52`），只作为委托方指定路径的便捷副本。

| 元数据 | 内容 |
|---|---|
| 实施日期 | 2026-11-01 |
| 主 Spec | [`docs/specs/lucy-20261101-access-map-geometry-spec.md`](../specs/lucy-20261101-access-map-geometry-spec.md) v0.2（功能合同，**已实施**） |
| 实施 Plan | [`docs/plans/lucy-20261101-access-map-geometry-plan.md`](../plans/lucy-20261101-access-map-geometry-plan.md) v0.2（S1→S2→S3→S4 按序执行，未跳步） |
| 权威语义 | [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md) —— **语义、API、边状态机、两档措辞、Token 过滤原文、URL 合法值一字未动**；只加一条交叉引用句 |
| 结果 | **完成**：SC-01–SC-14 有自动化出处，SC-16 桌面截图已落盘。SC-15 术语 lint 于 2026-11-02 拆出 |
| 未做 | Docker / demo 镜像重建、部署、`git commit` / `git push`、完整 Playwright 套件、移动窄屏、发布走查（均在本轮禁令之外） |

---

## 一、结论

访问关系图已从「168px 定宽卡片 + 单 path 超粗 stroke」改写为「**细柱 + `labelBlock` 外标 + 计量刻度封顶 + 四态填充面积流带**」：

- 计量与命中**解耦**：`MIN_HIT_PX = 8` 只做透明命中扩展，**不进入**任何厚度求和（不再出现 `max(2, w*unit)`）。
- 稀疏图**不被撑满**：`unitPx = min(rawUnit, 24)`，稀疏时 SVG 垂直居中于槽位（`data-layout-mode="sparse-centered"`），**不增大 unit 填槽**。
- 四态几何逐条落地：normal 顶对齐内核、dormant 只有授权面积、needs_review 独立警示面积 + 虚线中线、overflow 内核夹紧为授权厚度 + danger 实线轮廓。
- 着色 token 未变：dormant 与 normal 同为 `fill-brand`；warning 只给 needs_review；danger 只给 overflow / 确凿越权。

---

## 二、改了什么（Spec §5 逐条 → 实现）

### 2.1 节点（Spec §5.1）

| 项 | 实现 |
|---|---|
| `PILLAR_WIDTH = 16` | 导出常量；柱体 `<rect width={PILLAR_WIDTH} rx={3}>`。**168px 定宽卡片形态已废除**（旧卡片容器、旧高度地板、旧卡片内名称渲染全部删除） |
| 计量高度 | `flow(node) * unitPx`。**无**两行字高地板、**无** ≥54px 卡片地板 |
| 命中 | 柱体外套一层透明 `rect`（宽高各取 `max(PILLAR_WIDTH | MIN_HIT_PX)`），**不改变计量高度** |

### 2.2 `labelBlock` 与纵向步进（Spec §5.2）

- 组成 = 名称 + 副标题（`accessMapNodeSubtitle`）+ 状态（可选，取 `accessMapEdgeStateLabel`）。
- 位置：首列在柱**左**、末列在柱**右**、中间列在柱**上方**（底缘距柱顶 ≤ 4px）；左右两侧的 gutter 已计入 `layout.width`。
- 避碰（强制）：迭代求解，最多 160 轮。任意两块互不相交，且不与任一面积带的**上/下缘采样**相交（不只中线）。
- 状态优先级：overflow > needs_review > dormant（Spec §5.4 语义）。

### 2.3 刻度、预算与槽位（Spec §5.3）

```text
DENSE_BUDGET_H        = 640
usableForUnit         = 640 - PADDING*2 - COLUMN_HEADER_HEIGHT = 550
rawUnit               = min over columns of (usableForUnit - gapReserve(col)) / max(columnFlow, ε)
unitPx                = min(rawUnit, MAX_PX_PER_PATH)   # MAX_PX_PER_PATH = 24
pillarHeight(node)    = flow(node) * unitPx
metricRibbon(edge)    = edgeWeight(edge) * unitPx      # 授权面积
metricKernel(edge)    = edge.accessPaths * unitPx      # 访问内核
```

- **无**计量下限抬升 unit；**无**「撑满槽位」逻辑。
- 预算超限时**只向下**压缩 unit（≤8 轮），不回弹放大。
- 槽位：出边按**目标节点 y** 再按 id 排序；入边按**源节点 y** 再按 id 排序；同柱入/出槽位互不重叠、不越出柱体计量高。
- `NODE_GAP = 16`。

### 2.4 四态面积流带、线型与命中（Spec §5.4）

| 状态 | 实现 |
|---|---|
| `normal` | 授权面积（闭合 fill path，`fill-brand`）+ 访问内核（`fill-accent`），**顶对齐**叠在授权槽内；`access < grant` 时按 `access/grant` 比例沿曲线自源端截断（De Casteljau），否则全长 |
| `dormant` | 只有授权面积（`fill-brand`，**不带 warning**），**不绘制内核**；`labelBlock` 状态行「僵尸授权」；授权面积本身可悬停 / 可点击 |
| `needs_review` | **不绘制**授权面积；独立警示面积（`fill-warning`，厚度 `access*unit`）+ **虚线中线**（`stroke-dasharray="6 4"` / `stroke-warning-strong`）；该独立面积可悬停 / 可点击 |
| `overflow` | 授权面积（`fill-danger-soft`）+ 内核**厚度夹紧为 grant**（不把 `access > grant` 画得更厚）+ **danger 实线轮廓**（`stroke-danger-strong`，`fill="none"`）。**不靠加厚表达越权** |
| `confirmedUnauthorized` | 内核 fill 走 `fill-danger-strong`，实线 |

- 主视觉是**填充面积**（`d` 以 `Z` 收尾的闭合 path），**不是**「单 path + 超粗 stroke」：渲染层不给面积带写 `stroke-width`。
- 命中层：面积带与内核各生成上下两条 `MIN_HIT_PX` 透明扩展 path（`fill="transparent"` / `pointerEvents="all"`），只做命中，不参与计量。

### 2.5 列距与横滚（Spec §5.5）

- `ACCESS_MAP_COLUMN_GAP = 300`（> 240，保持 chart-first 现行值）；左右 label gutter 计入 `layout.width`。
- `overflow-x: auto`；**不**整图 `max-w-full` 缩小。

### 2.6 未动的东西（逐条确认）

`/api/admin/access-map` · KTX · 边状态机 · 两档措辞（需复核不含「越权」）· Token 过滤提示原文 · URL 合法值 · 页壳（页头 / 工具条 / 视图切换 / 图例短行 / 弱入口 / 凭证清单）· quiet-reading §5.3 着色 token · 既有 `access-map-*` test id 的可达性 · 无新增运行时依赖 · 无新增裸 hex。

---

## 三、文件改动清单（与开工基线对照）

开工基线：`git status --short`，记录于 **2026-11-01 21:22:35**，HEAD `0b55aba4`。
收口时 HEAD 已变为 `404ab05d`（**另一条工作线**提交，本条未提交任何东西）。

### 3.1 本条触碰（全部在 Plan §3 落点内）

| 路径 | 动作 |
|---|---|
| `webui/src/components/admin/AccessMapCanvas.tsx` | 改：细柱 / `labelBlock` / 封顶刻度 / 四态面积带 / 按 y 分槽 / 命中层 / 稀疏居中。**重写布局与绘制，页壳与交互语义不动** |
| `webui/src/__tests__/access-map-layout.test.tsx` | 改：重写为 geometry Spec §5 的 13 条纯计算断言（SC-01–SC-10 + 裸 hex 静态扫描 + 既有文字宽度能力） |
| `webui/src/__tests__/access-map.test.tsx` | 改：改写与旧卡片 / 旧内核假设冲突的断言（quiet-reading SC-08、chart-first SC-08 悬停）；新增 `describe("访问关系图几何语言（geometry Spec §7 组件侧）")`（SC-05 / 07 / 11 / 12 / 13 / 14） |
| `docs/qa/selector-contract.md` | 改：**仅追加** 5 行新可见 test id 登记（ribbon / label / midline / outline / hit）+ 澄清 kernel 行。基线时该文件已由他线改过，本条未动他人内容 |
| `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` | 改：§5.4 加**取代声明**横幅（指针性；§5.3 着色继续有效；**未删旧正文**，仅标为历史约定） |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | 改：§5.6 / §5.8 指向 geometry Spec（指针性；**决策句未改**） |
| `webui/docs/187-access-relation-sankey-spec.md` | 改：**仅加一条交叉引用段**（几何语言修订）；§4.4 判定顺序、§9 着色 token、语义表、SC、API 一字未动 |
| `docs/reviews/2026-11-01-access-map-geometry-implementation-notes.md` | **新增**（本文件，权威副本） |
| `docs/reviews/assets/2026-11-01-access-map-geometry/*.png` | **新增** 5 张 SC-16 桌面截图 |
| `inbox/2026-11-01-access-map-geometry-IMPLEMENTATION_NOTES.md` | **新增**（便捷副本；`inbox/` 被 gitignore） |

### 3.2 明确未触碰的既有 dirty 文件（他线工作，开工基线即存在）

`docs/README.md`、`docs/plans/README.md`、`docs/plans/lucy-20261030-agent-roster-plan.md`、`docs/specs/lucy-20261030-agent-roster-spec.md`、`docs/specs/lucy-20261030-row-policy-view-presentation-spec.md`、`webui/docs/00-product-terminology-standard.md`、`webui/src/__tests__/row-policy-dnf-preview.test.tsx`、`webui/src/__tests__/row-policy-view.test.tsx`、`webui/src/components/admin/RowPolicyDnfPreview.tsx`、`webui/src/pages/admin/RowPolicyView.tsx`，以及收口时新出现的 e2e fixture / `scripts/demo/init-e2e-fixture.sh` 等 staged 改动。

**本条未改、未回滚、未覆盖上述任何一项。**

---

## 四、SC-01–SC-16 逐条状态

| SC | 要求摘要 | 状态 | 出处 |
|---|---|---|---|
| SC-01 | `PILLAR_WIDTH ∈ [12,20]`，布局宽 == 常量，≠ 168 | ✅ | `access-map-layout.test.tsx`「SC-01」 |
| SC-02 | `labelBlock` 完整；首列左 / 末列右 / 中间列上 | ✅ | 同上「SC-02」（含 dormant 夹具断言状态文字 == 「僵尸授权」） |
| SC-03 | `MAX_PX_PER_PATH === 24`；`unitPx ≤ 24` | ✅ | 同上「SC-03」 |
| SC-04 | `DEMO_SPARSE_9` 的 `contentHeight ∈ [280,420]`，且显著小于「无封顶撑满预算」对照 | ✅ | 同上「SC-04」（实测 contentHeight ≈ 384.4，对照 ≈ 640） |
| SC-05 | 主视觉是 fill 面积，不是「单 path + 超粗 stroke」 | ✅ | layout「SC-05」+ 组件 `access-map.test.tsx`「geometry SC-05」 |
| SC-06 | `grantPaths` 加倍 ⇒ 计量厚度加倍；命中地板不介入 | ✅ | layout「SC-06」 |
| SC-07 | 四态几何（顶对齐 / 无内核 / 无授权面积 + 虚线 / 夹紧 + danger 轮廓） | ✅ | layout「SC-07」+ 组件「geometry SC-07」 |
| SC-08 | 同柱入/出槽位不重叠、不越柱；按对端 y 排序 | ✅ | layout「SC-08」 |
| SC-09 | `labelBlock` 互不重叠，且不与面积带上下缘采样相交 | ✅ | layout「SC-09」 |
| SC-10 | `ACCESS_MAP_COLUMN_GAP > 240`；稀疏居中 / 缩槽钩子可断言 | ✅ | layout「SC-10」 |
| SC-11 | dormant 不带 warning；needs_review 虚线；overflow / 确凿越权 danger 实线 | ✅ | 组件「geometry SC-11」 |
| SC-12 | **可见面积**悬停出浮层（含无内核的 dormant 与 normal），含从→到与状态 | ✅ | 组件「geometry SC-12」 |
| SC-13 | **可见面积**点击开抽屉（dormant 授权面积、needs_review 独立带） | ✅ | 组件「geometry SC-13」 |
| SC-14 | 无裸 hex、无新增运行时依赖 | ✅ | layout「SC-14」静态扫描 + 组件「geometry SC-14」 |
| SC-15 | 术语 lint | **拆出** | 原退出码见 §5.3，只作过程记录 |
| SC-16 | 桌面截图人工验收（稀疏占比 / 外标可读 / 四态 / 悬停点击） | ✅ | 见 §六（5 张截图已落盘 `docs/reviews/assets/2026-11-01-access-map-geometry/`） |

---

## 五、验证证据

### 5.1 RED（真实失败，不是想象）

**S1 —— 先写布局断言，先跑失败：**

```
$ cd webui && npx vitest run src/__tests__/access-map-layout.test.tsx
 ❯ src/__tests__/access-map-layout.test.tsx (13 tests | 10 failed) 18ms
   × SC-01 — 导出 PILLAR_WIDTH ∈ [12,20]；…                    3ms
   × SC-02 — labelBlock 完整（名称 + 副标题 + 状态）；…           9ms
   × SC-03 … × SC-10 …
TypeError: actual value must be number or bigint, received "undefined"
 ❯ src/__tests__/access-map-layout.test.tsx:140:26
 Test Files  1 failed (1)
      Tests  10 failed | 3 passed (13)
   Start at  21:38:30
```

**S1 —— 实现后 SC-09 仍未收敛（真实残留失败）：**

```
 ❯ src/__tests__/access-map-layout.test.tsx (13 tests | 1 failed) 47ms
   × SC-09 — labelBlock 互不重叠，且不与任一面积带的上下缘采样相交 19ms
AssertionError: expected true to be false // Object.is equality
- Expected   + Received
- false       + true
 ❯ src/__tests__/access-map-layout.test.tsx:399:43
 Test Files  1 failed (1)
      Tests  1 failed | 12 passed (13)
   Start at  21:44:48
```

> 根因：避碰迭代只跑 6 轮，而收缩是几何收敛（每轮约 ×0.89），提前退出后回落到了兜底位置。**自愈第 1 次**：把迭代上限提到 160 轮 → 转 GREEN。

**S2 —— 组件侧先跑失败：**

```
 ❯ src/__tests__/access-map.test.tsx (38 tests | 2 failed) 752ms
   × SC-08 — 僵尸授权流带不含 warning；需复核为 warning 虚线；确凿越权内核为 danger 实线
TypeError: Cannot read properties of null (reading 'getAttribute')
 ❯ src/__tests__/access-map.test.tsx:586:20
   × SC-08 — 悬停边出现可读浮层，含从→到与状态文案
TestingLibraryElementError: Unable to find an element by:
  [data-testid="access-map-kernel-e|role:role_reader|conn:mysql_main"]
```

> 这两条正是被 geometry Spec 推翻的旧假设（内核 = 流带本体）。改写为「可见面积 / 内核分离」的新机制后转 GREEN。

**S2 —— SC-14 静态扫描自身的环境问题：**

```
 ❯ src/__tests__/access-map.test.tsx (44 tests | 1 failed) 815ms
   × SC-14 — 没有新增运行时依赖，也没有裸十六进制颜色
TypeError: The URL must be of scheme file
 ❯ src/__tests__/access-map.test.tsx:1294:7
```

> **自愈第 1 次**：`import.meta.url` 在 jsdom 环境下不是 `file:` URL → 改用 `resolve(process.cwd(), …)` 定位源码与 `package.json` → 转 GREEN。

### 5.2 GREEN（验收命令）

```
$ cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
 Test Files  2 passed (2)
      Tests  57 passed (57)
   Start at  22:00:31
   Duration  1.67s
```

相关四文件（同页/同域回归）：`authorization-summary-closure`、`authorization-summary`、`help-center`、`navigation` → **85 passed**。

### 5.3 门禁

```
$ npm run lint:terminology
Terminology lint passed (1097 files scanned).      # exit 0

$ npm run lint:spec-docs
Spec/Plan doc lint passed (358 files scanned, 875 baseline exemptions, 16 warnings on untracked files).
                                                   # exit 0
```

> `lint:spec-docs` 的 16 条 warning 全部落在**他线**未跟踪的 `*-prompt.md` 文件（`docs/plans/lucy-20261101-*-prompt.md`），**没有一条指向本条改动的文件**。

### 5.4 全量 webui 套件（回归面）

```
$ cd webui && npx vitest run
 Test Files  1 failed | 433 passed | 1 skipped (435)
      Tests  2 failed | 5317 passed | 8 skipped (5327)
```

失败项**全部**在 `src/__tests__/row-policy-view-readonly-a11y.test.tsx`（RTV-07 × 2）：

```
FAIL  row-policy-view-readonly-a11y.test.tsx > RTV-07 翻译防御（真实实现缺口）：并集小节的「来源角色」列表尚未受翻译防御
FAIL  row-policy-view-readonly-a11y.test.tsx > RTV-07 只读：页面没有写入口
```

> **该文件不在本条改动范围内**，其被测实现 `webui/src/pages/admin/RowPolicyView.tsx` 属**他线**在开工基线即存在的 dirty 改动。本条未触碰、未修复、未回滚。首轮全量跑曾出现 3 个文件 4 条失败（含同源的行权限用例），二次全量跑收敛为 1 个文件 2 条失败——**该区域存在并行工作导致的波动**，与本条无关。

---

## 六、SC-16 桌面截图记录

**取证方式**：本机已运行的开发栈（Vite `127.0.0.1:5173` → Fastify `127.0.0.1:5174`），Playwright 驱动 Chromium，`deviceScaleFactor=2`。**未做任何 Docker / demo 镜像重建**，**未运行 `npm run demo:upgrade`、`docker compose build/up`、`--fresh`、`--no-cache`**。

> ⚠️ **数据来源说明**：本机后端的 `/api/admin/access-map` 当前返回 `meta.grant.state = "unavailable"`（`role_resolution_failed:*`）、`nodes: []`，**实页画不出任何图**。因此截图通过 Playwright **路由拦截**注入符合 `AccessMapResponse` 契约的**夹具负载**（dense 四态夹具 + `DEMO_SPARSE_9` 同构夹具），跑的是**真实页面壳 + 真实 `AccessMapCanvas` 组件 + 真实 CSS**。Spec §7 SC-16 明确允许「**可用夹具或实页**」。

| 截图 | 观察点 |
|---|---|
| `assets/2026-11-01-access-map-geometry/access-map-geometry-dense-1920.png` | 1920×1080 桌面全图：5 列细柱、首列标签在柱左 / 中间列在柱上 / 末列在柱右；normal 授权面积 + 深色顶对齐内核；dormant 只有淡色面积（无内核）；needs_review 橙色独立面积 + **虚线中线**；overflow 深红面积 + **实线 danger 轮廓**；四态 `labelBlock` 状态文字（需复核 / 访问超出授权 / 僵尸授权）均可读 |
| `assets/…/access-map-geometry-dense-1440.png` | 1440×900 桌面：图区**横向滚动**（不缩 SVG），末列部分出屏，符合 Spec §5.5 |
| `assets/…/access-map-geometry-sparse-1920.png` | `DEMO_SPARSE_9` 同构夹具（3 Agent × 3 路径、角色分流、1 连接、3 表）：`data-layout-mode="sparse-centered"`，`viewBox="0 0 1211 338"`（contentHeight 338 ∈ [280,420]），图在槽位中**垂直居中**、四周留白充足，未被撑成「粉肉块」也未被压成顶条 |
| `assets/…/access-map-geometry-hover-dormant-1920.png` | 悬停 **dormant 的可见授权面积** → 浮层「客服专员 → 生产 MySQL / 授权路径 2 条 · 访问路径 0 条 · 调用 0 次 / 状态：僵尸授权」（dormant 无内核，但面积本身可悬停） |
| `assets/…/access-map-geometry-hover-node-1920.png` | 悬停节点细柱 → 浮层「调度 Agent / 3 个 Agent · 9 条路径 / 类型：Agent」 |

---

## 七、已知限制与需人工裁决

1. **SC-16 是夹具截图，不是 demo 实页截图。** 本机后端授权面不可用（`role_resolution_failed`），且**委托人明令禁止本轮重建 Docker / demo**。若委托人要求「当前 demo 实页」口径，需先恢复授权面可用（另一条工作线的配置问题），或由委托人在自己的 demo 环境补截。**本条未声称实页已验收。**
2. **未提交。** 按禁令未执行 `git commit` / `git push`；本条的 9 个文件改动全部留在工作区，需要委托人决定提交时机与范围。
3. **并行工作线在同仓库同时改动。** 全量套件里 `row-policy-view-readonly-a11y.test.tsx` 的 2 条失败来自他线未完成的 `RowPolicyView` 改动；本条未介入。**收口前建议该工作线先落地。**
4. **`docs/qa/selector-contract.md` 是他线也在改的文件**（开工基线即 dirty）。本条只做了**追加**，未动他人行；合并时留意行序冲突。
5. **quiet-reading §5.4 / chart-first §5.4–§5.8 的旧正文保留未删**，只在前面加了取代声明。若委托人希望物理删除历史条款，需要另一次指针性清理。
6. **本条不表示可上线。** Spec §「闭口层级」已写明：功能合同层收口 ≠ 发布取证。

---

## 八、本轮明确未做（按禁令）

- 未运行 `npm run demo:upgrade`、`docker compose … build/up`、`--fresh`、`--no-cache`，**未做任何镜像 / 容器重建**。
- 未部署，未 `git commit`，未 `git push`。
- 未跑完整 Playwright / 发布走查套件（只跑了取证所需的单页截图脚本）。
- 未做移动窄屏 / 响应式验证。
- 未新增运行时依赖（`d3-sankey` 等一律不引入），未新增裸 hex 颜色。
- 未改 `/api/admin/access-map`、KTX、边状态机、两档措辞、Token 过滤原文、URL 合法值、页壳。
