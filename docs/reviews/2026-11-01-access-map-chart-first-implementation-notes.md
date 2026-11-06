# 访问关系图图优先呈现 —— 实施记录（IMPLEMENTATION_NOTES）

> **本文件是本轮实施记录的可版本控制副本（权威副本）。**
> 委托方指定路径 `inbox/2026-11-01-access-map-chart-first-IMPLEMENTATION_NOTES.md` 下有一份同内容副本；
> `inbox/` 在本仓库被 `.gitignore` 排除（`.gitignore:52`），故两份并存以兼顾「按指定路径留痕」与「可入库」。

| 元数据 | 内容 |
|---|---|
| 实施日期 | 2026-11-01 |
| 主 Spec | [`docs/specs/lucy-20261101-access-map-chart-first-spec.md`](../specs/lucy-20261101-access-map-chart-first-spec.md) v0.2（功能合同已收口） |
| 实施 Plan | [`docs/plans/lucy-20261101-access-map-chart-first-plan.md`](../plans/lucy-20261101-access-map-chart-first-plan.md) v0.2 |
| 权威语义 | [`webui/docs/187-access-relation-sankey-spec.md`](../../webui/docs/187-access-relation-sankey-spec.md)（**未改其语义**：API、边状态机、两档措辞、Token 过滤原文、URL 参数合法值一律未动） |
| 结果 | **完成**：S1–S3 全部落地，SC-01–SC-13 有自动化断言并通过。SC-14 于 2026-11-02 拆出 |
| 未做 | 浏览器走查、Playwright 实跑、镜像构建、部署、`git commit` / `git push`（均不在本条出口） |

---

## 一、改了什么

### 1.1 页壳（Spec §5.1 / §5.2）

| 动作 | 对象 | 结果 |
|---|---|---|
| 删除 | `AccessMapSignalBar`（三张 `pl-metric-grid--three` 指标卡） | 首屏 DOM 里不再有 `pl-metric-card` / `pl-metric-grid--three`，也不再有 `access-map-signal-bar` / `-dormant` / `-needs-review` / `-confirmed` |
| 删除 | 两个独立宽条 `id="access-map-methodology"`（口径说明）与 `id="access-map-snapshot"`（快照） | 合并为**一个**默认关闭的 `<details data-testid="access-map-methodology-snapshot">`，summary 文案「口径与快照」 |
| 删除 | 信号筛选 state（`signalFilters` / `highlightStates` / `toggleSignal`）与 `tableEdges` 的过滤分支、`AccessMapCanvas` 的 `highlightStates` prop 与对应高亮逻辑 | 死代码清空；关系表默认展示当前响应里的全部边（仍受 URL `focus` / `token` 等既有过滤约束），不假造「已筛选态」 |
| 保留 | partial 等降级 | `access-map-partial-notice` 仍是 `pl-notice`，保留「N 个 Agent 授权未能解析，结果不完整。」+「前往配置审计」 |

### 1.2 图例拆分（Spec §5.3 / §5.4）

`webui/src/components/admin/AccessMapLegend.tsx` 拆成两个导出：

- `AccessMapLegend()` —— **短行**，无 props，`data-testid="access-map-legend"`，**直接子节点恰好四项**（流带宽度 / 深色内核 / 虚线 = 需复核 / 实线 = 确凿越权）。不含窗口 ISO、不含访问口径标签。
- `AccessMapLegendMeta({ meta })` —— 访问口径标签与统计窗口 ISO，搬进弱入口。

短行渲染位置：视图切换 `pl-admin-tabbar` **之后**、图区**之前**（文档序）。数据表视图不渲染短行（Spec §5.3 明确允许）。

### 1.3 弱入口内容（Spec §5.4）

弱入口内含（test id 保持原字符串，仅换容器）：`access-map-signal-needs-review-note`、`access-map-signal-confirmed-source`、`access-map-snapshot-coverage`、`access-map-signal-calls`、`access-map-orphan-grants`、`access-map-legend-trust`、`access-map-legend-window`、`access-map-snapshot-id`。

**僵尸授权口径句的落点**：原来挂在指标卡 ⓘ 上（`MetricCard` 的 `help` 属性，`ACCESS_MAP_DORMANT_TIER_NOTE`，无独立 test id）。卡片整排卸下后，这句话改写成弱入口正文里的普通段落「僵尸授权口径：授权路径数大于 0，且窗口内访问路径数为 0」。**不新增 test id** —— Spec §5.4 允许「否则写在同一折叠正文」，也避免给选择器契约表新增无必要的行。

### 1.4 图面几何与悬停（Spec §5.6）

| 项 | 改动 |
|---|---|
| 列间距 | `COLUMN_GAP` 240 → **300**，导出为 `ACCESS_MAP_COLUMN_GAP`（布局测试直接断言常量与实际列距一致，避免「挂着一个没人读的导出」） |
| 图区高度 | `CANVAS_HEIGHT` 560 → **640**；主容器 `access-map-canvas` 加内联 `min-height: clamp(420px, 58vh, 720px)`，导出为 `ACCESS_MAP_CANVAS_MIN_HEIGHT` |
| 悬停浮层 | 新增 HTML 浮层 `access-map-hover-tip`（**不是** SVG `<title>`；`<title>` 保留作无障碍补充）。节点浮层：全名 + 副标题计数 + 类型中文名；边浮层：`from → to`（节点名）+ 授权/访问路径数与调用数 + 状态文案（`confirmedUnauthorized` 时附「确凿越权：调用当时授权亦不覆盖」）。浮层 `pointer-events-none`，**不拦截指针** —— 点边仍开抽屉、点节点仍写 `focus`。浮层是根节点（`position: relative`）的绝对定位子元素，位置由鼠标**视口坐标**换算到根容器坐标（`rootRef.getBoundingClientRect()`），因此横向滚动时图形移动、浮层仍贴住鼠标 |

### 1.5 文件更名

`webui/src/components/admin/AccessMapSignalBar.tsx` → **`AccessMapSignalNotes.tsx`**。文件里原本同时导出「三卡」与「口径说明」；卡片删除后只剩口径说明，于是**改名并删除旧文件**，不留同名的空壳（否则会有人以为三卡还在）。

改名后 `components/admin/AccessMap*.tsx` 仍是 6 个 + 页文件 1 个 = 7 个，布局测试的 `files.length >= 7` 断言不受影响。

---

## 二、文件改动清单（与开工基线对照）

开工基线：`git status --short`（HEAD `c678c964`）。**注意**：实施期间另一条工作线提交了 `ca343e82`（e2e row-policy），HEAD 已变为 `ca343e82`；该提交不触碰本条任何文件。

### 2.1 本条新增／修改（全部在 Plan §3 落点内）

| 路径 | 动作 |
|---|---|
| `webui/src/pages/admin/AccessMap.tsx` | 改：页壳重排、删筛选 state、弱入口、图例短行 |
| `webui/src/components/admin/AccessMapSignalNotes.tsx` | **新增**（原 `AccessMapSignalBar.tsx` 的 notes 部分） |
| `webui/src/components/admin/AccessMapSignalBar.tsx` | **删除**（索引里是 staged 删除，见 §五） |
| `webui/src/components/admin/AccessMapLegend.tsx` | 改：拆成短行 + 元信息 |
| `webui/src/components/admin/AccessMapCanvas.tsx` | 改：栏距、高度策略、悬停浮层、删 `highlightStates` |
| `webui/src/__tests__/access-map.test.tsx` | 改：删/改写与三卡、双宽条、筛选 UI 冲突的断言；新增 chart-first describe（SC-01–SC-13） |
| `webui/src/__tests__/access-map-layout.test.tsx` | 改：新增「图区几何（chart-first Spec §5.6）」describe |
| `docs/qa/selector-contract.md` | 改：删 4 行过期登记、迁移 5 行指向、新增 2 行（见 §三） |
| `webui/docs/187-access-relation-sankey-spec.md` | 改：**仅加一条交叉引用句**，语义表、SC、API 一字未动 |
| `docs/specs/lucy-20261101-access-map-chart-first-spec.md` | 改：状态行 / 版本行 / 文首提示行（Plan §4 S3.4 要求的收口状态更新），**决策句与 §5／§7 一字未改** |
| `docs/plans/lucy-20261101-access-map-chart-first-plan.md` | 改：状态行 / 版本行 / 新增 §9 实施轮记录 |
| `docs/README.md`、`docs/plans/README.md` | 改：两条索引条目的状态 |
| `webui/tests/real-e2e/access-map-v025.spec.ts` | 改：见 §四 |
| `docs/reviews/2026-11-01-access-map-chart-first-implementation-notes.md` | **新增**：本文件的可版本控制副本 |

### 2.2 未触碰的既有 dirty 文件（属另一条工作线）

`docs/specs/lucy-20261019-audit-trust-and-admin-investigation-spec.md`、`docs/specs/lucy-20261030-audit-context-bar-spec.md`、`docs/specs/lucy-20261030-row-policy-view-presentation-spec.md`、`webui/docs/00-product-terminology-standard.md`、`webui/src/app/app.css`、`webui/src/components/admin/RowPolicyDnfPreview.tsx`、`webui/src/components/audit-trust/*`、`webui/src/pages/admin/Audit.tsx`、`webui/src/pages/admin/RowPolicyView.tsx`、`webui/src/__tests__/audit-trust/*`、`webui/src/__tests__/row-policy-*` —— **本轮一个字都没改**（其中 `docs/specs/lucy-20261030-access-map-quiet-reading-spec.md` 的 chart-first 指针是**开工前**就已在工作树里的，不是我加的）。

---

## 三、选择器契约表

| 动作 | test id |
|---|---|
| 删除登记 | `access-map-signal-bar`、`access-map-signal-dormant`、`access-map-signal-needs-review`、`access-map-signal-confirmed`（实现已删除，留着会变 ORPHAN） |
| 改指向 | `access-map-orphan-grants`、`access-map-signal-calls`、`access-map-signal-confirmed-source`、`access-map-signal-needs-review-note`、`access-map-snapshot-coverage` → `components/admin/AccessMapSignalNotes.tsx` |
| 新增登记 | `access-map-methodology-snapshot`（页文件）、`access-map-hover-tip`（画布文件） |

小节标题 `### webui/src/components/admin/AccessMapSignalBar.tsx` 同步改名为 `AccessMapSignalNotes.tsx`，并留一行说明卡片为何被删。

---

## 四、real-e2e 规格的两处最小改动

`webui/tests/real-e2e/access-map-v025.spec.ts`（该目录**不在**选择器契约门的扫描范围内，但引用了被删的 test id，不改会跑挂）：

1. `access-map-signal-bar` → `access-map-legend`（首屏元素换成图例短行）。
2. 读两档措辞前先点开弱入口的 `summary`（两档说明现在在默认关闭的 `<details>` 里），并把注释改成说明「口径说明搬进了弱入口」。

---

## 五、SC-01–SC-14 逐条落点

| SC | 断言 | 自动化落点 | 结果 |
|---|---|---|---|
| SC-01 | 默认关系图视图无三张信号 Metric Card | `access-map.test.tsx` →「chart-first Spec §7」→ `SC-01 — 默认首屏没有三张信号 Metric Card` | 通过 |
| SC-02 | 无 `access-map-methodology` / `access-map-snapshot` 两个宽条；有单个「口径与快照」弱入口 | 同上 → `SC-02 — 两个独立宽条消失，只剩一个「口径与快照」弱入口（默认关）` | 通过 |
| SC-03 | legend 在图区之前（文档序）；四项；不含窗口 ISO 句 | 同上 → `SC-03 — 图例短行在图正上方，只有四项线型释义，不含窗口 ISO` | 通过 |
| SC-04 | 弱入口里能找到 snapshot-id / coverage / needs-review-note / confirmed-source；需复核 note 不含「越权」 | 同上 → `SC-04 — 弱入口里能找到口径全文、覆盖率、调用数与快照 id` | 通过 |
| SC-05 | `grant.state=partial` 时 partial notice 可见且含「前往配置审计」 | 同上 → `SC-05 — partial 降级保留事实与「前往配置审计」` | 通过 |
| SC-06 | 视图切换与统计窗口选中态不用 `pl-btn--primary` | 同上 → `SC-06 — 关系图／数据表与统计窗口的选中态都不用 pl-btn--primary`（另有 quiet-reading 的 SC-03 断言覆盖同一约束） | 通过 |
| SC-07 | 列间距常量大于 240；主图容器有可断言的 `min-height` 策略 | `access-map-layout.test.tsx` →「图区几何（chart-first Spec §5.6）」→ `SC-07 — 列间距常量大于 quiet-reading 落地时的 240`、`SC-07 — 主图容器有基于视口的 min-height 策略`；另 `access-map.test.tsx` → `SC-07 — 主图容器有 min-height 策略` | 通过 |
| SC-08 | 悬停出现非 SVG-only-title 的可读浮层；边浮层含从→到与状态 | `access-map.test.tsx` → `SC-08 — 悬停节点出现可读浮层（不是只靠 SVG <title>）`、`SC-08 — 悬停边出现可读浮层，含从→到与状态文案` | 通过 |
| SC-09 | 着色回归（僵尸授权中性 / 需复核 warning 虚线 / 确凿越权 danger 实线） | `access-map.test.tsx` → quiet-reading describe → `SC-08 — 僵尸授权流带不含 warning；需复核为 warning 虚线；确凿越权内核为 danger 实线`（该用例的编号沿用 quiet-reading 的旧编号，覆盖的正是本条 SC-09） | 通过 |
| SC-10 | 点边后 `access-map-edge-detail` 在抽屉内 | `access-map.test.tsx` → `SC-10 — 点击边仍开既有抽屉`；另有 quiet-reading 的 `SC-10 — 边明细在右侧抽屉里…` | 通过 |
| SC-11 | Token 过滤提示句逐字不变 | `access-map.test.tsx` → `SC-11 — Token 过滤提示句逐字不变` | 通过 |
| SC-12 | 关键 `access-map-*` test id 仍可找到或迁入弱入口后仍可找到；页面不出现「桑基图」 | `access-map.test.tsx` → `SC-12 — 迁入弱入口的 test id 仍可找到；页面不出现「桑基图」` | 通过 |
| SC-13 | 页面源码无新增裸十六进制颜色 | `access-map-layout.test.tsx` → 「访问关系图源码的色值约束」→ `SC-15 — AccessMap*.tsx 里没有裸十六进制颜色`（扫 `components/admin/AccessMap*.tsx` + `pages/admin/AccessMap.tsx`，覆盖本轮新增的 `AccessMapSignalNotes.tsx` 与改过的画布／图例／页文件）。**该用例的编号沿用 quiet-reading 的旧编号，本条 SC-13 与它指的是同一条约束** | 通过 |
| SC-14 | 术语 lint | 命令级门禁（见 §六） | **拆出**。原退出码 0 只作过程记录 |

---

## 六、命令与结果

### 6.1 TDD 记录（每个可测切片都先 RED 再 GREEN）

**切片一：页壳 + 图例 + 弱入口（SC-01–SC-06、SC-12）**

```
RED —— cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
  × 渲染关系图；信号不再占首屏大卡，覆盖率口径仍在弱入口里披露
  × 页头 → 工具条 → 视图切换 → 图例短行 → 图区 → 弱入口 → 凭证清单
  × SC-01 — 默认首屏没有三张信号 Metric Card
  × SC-02 — 两个独立宽条消失，只剩一个「口径与快照」弱入口（默认关）
  × SC-03 — 图例短行在图正上方，只有四项线型释义，不含窗口 ISO
  × SC-04 — 弱入口里能找到口径全文、覆盖率、调用数与快照 id
  × SC-12 — 迁入弱入口的 test id 仍可找到；页面不出现「桑基图」
  Tests  10 failed | 34 passed (44)
```

**切片二：图面几何与悬停（SC-07、SC-08）**

```
RED —— 同上命令（补完图面断言后）
  × SC-07 — 主图容器有 min-height 策略
  × SC-08 — 悬停节点出现可读浮层（不是只靠 SVG <title>）
  × SC-08 — 悬停边出现可读浮层，含从→到与状态文案
```

**切片三：布局层常量断言（SC-07 布局侧）**

该切片与实现同批落地，为证明断言不是空断言，做了一次**回退验证**：把 `ACCESS_MAP_COLUMN_GAP` 临时改回 240、`ACCESS_MAP_CANVAS_MIN_HEIGHT` 临时改成 `"420px"`，再跑：

```
RED —— npx vitest run src/__tests__/access-map-layout.test.tsx
  × SC-07 — 列间距常量大于 quiet-reading 落地时的 240
  × SC-07 — 主图容器有基于视口的 min-height 策略
  AssertionError: expected 240 to be greater than 240
  AssertionError: expected '420px' to contain 'vh'
  Tests  2 failed | 6 passed (8)
```

随后恢复实现值 300 / `"clamp(420px, 58vh, 720px)"`。

**GREEN（最终态）**

```
$ cd webui && npx vitest run src/__tests__/access-map.test.tsx src/__tests__/access-map-layout.test.tsx
 Test Files  2 passed (2)
      Tests  46 passed (46)
   Duration  1.55s
```

相关文件一并回归（确认没碰坏邻页）：`navigation.test.ts`、`authorization-summary.test.tsx`、`help-center.test.tsx`、`authorization-summary-closure.test.tsx` + 上述两个文件 → **6 files / 131 tests passed**。

### 6.2 门禁

| 命令 | 结果 |
|---|---|
| `npm run lint:terminology` | **通过**，exit 0，1092 files scanned |
| `npm run lint:spec-docs` | **exit 1 —— 失败项不属本条**，见下 |
| `webui/scripts/check-selector-contract.mjs` | **exit 1 —— 失败项不属本条**，见下 |
| `npx tsc --noEmit -p webui/tsconfig.json` | 86 项报错，其中与 access-map 相关的**只有 1 项，且是开工前就存在**（见下） |

**`lint:spec-docs` 的唯一阻塞项**：`docs/specs/lucy-20261030-audit-context-bar-spec.md` [close-layer]「闭口层级」缺少或为空：本条承诺。原因是另一条工作线把该文件的 `本条承诺：` 改写成了 `本条承诺（v1.1）：`，形状门禁认不出。该文件**不在** Plan §3 的落点内，本轮**未代改**。本条自己的 Spec / Plan、两处索引、`webui/docs/187-access-relation-sankey-spec.md` 经门禁扫描**零违规**。

**选择器契约门禁**：exit 1，202 项全部落在本条之外的在途工作域（row-policy / workbench-publish / audit / role / skill / table-editor / wiki / breadcrumb 等）。按 `access-map` / `AccessMap` 过滤**零命中** —— 本条新增与迁移的登记行全部一致。

**TypeScript 报错**：`src/__tests__/access-map-layout.test.tsx(149,74): error TS18048: 'long.labelBox.width' is possibly 'undefined'`。该行在 HEAD（`c678c964`）就是第 147 行、内容完全相同，是**开工前既有的类型债**；本轮未修（不在落点内，且改动行为不相关）。本条新增代码零类型错误。

---

## 七、已知限制与需要人来拍板的事

1. **浏览器走查未做**（Spec §7 明写「浏览器走查不在本条出口」）。视觉层面的两点只能靠读代码判断、未经人眼确认：① 图区 `min-height` 用 `clamp(420px, 58vh, 720px)`，在超宽/超高视口下图区下方会留白（SVG 高度固定 640，容器可到 720）；② 悬停浮层以**根容器**为绝对定位基准、按鼠标坐标偏移 12px 定位：横向滚动时图形移动而浮层不动（浮层始终贴鼠标），浮层在靠近图区右缘时可能溢出根容器右缘。
2. **弱入口在数据表视图也渲染**（Spec §5.1 的骨架图把弱入口画在【关系图】分支下）。本轮把它放在视图分支**之后**，两个视图都能读到口径全文；若要求只在关系图视图出现，请说一声，改动是一行。
3. **`access-map-dormant` 这类无 test id 的口径句**没进选择器契约表（按 Spec §5.4「否则写在同一折叠正文」处理）。若希望它可被 E2E 直接断言，需要新增 test id + 契约行。
4. **`docs/plans/lucy-20261101-access-map-chart-first-coder-prompt.md` 未入库（保持 untracked）**。它是委托方下发的提示词、不是 Plan：形状门禁只扫 `docs/specs` 与 `docs/plans`，一旦 `git add` 就会从 7 条 WARN 变成 7 条**阻塞项**。Plan 元数据表里的引用已改成纯文本说明（不再是指向未入库文件的链接）。该文件留在工作树里未跟踪，**提交时不要 `git add` 它**。（**2026-11-05 现状更正**：该提示词已由另一工作线入库，现位于 `docs/prompts/lucy-20261101-access-map-chart-first-coder-prompt.md`——归位到 `docs/prompts/` 正是为了不再被 Plan 形态门禁扫到；本条原始观察「它是提示词、不是 Plan」仍然成立。）
5. **`git` 状态提醒**：本条全部改动都是**工作树未暂存**状态（索引为空，`git diff --cached` 无输出）。`AccessMapSignalBar.tsx` 是工作树删除（未暂存），新增的 `AccessMapSignalNotes.tsx` 是 untracked —— **若他人执行 `git commit -a`，删除会被提交而新文件不会**，import 会断在 `AccessMap.tsx` 的新 import 上。需要一并 `git add webui/src/components/admin/AccessMapSignalNotes.tsx`（以及本条的 spec/plan / reviews 等 untracked 文件）。本轮按指令**未执行任何 commit / push**。
6. **`npm run lint:spec-docs` 仍红**，需另一条工作线把 `本条承诺（v1.1）：` 改回 `本条承诺：`（或按门禁提示写进 baseline 并说明理由）。本条**没有**代改他人文件。

---

## 八、语义守恒自查

| 不得改的东西 | 本轮实际 |
|---|---|
| `/api/admin/access-map` | 未碰（`webui/server/admin/access-map.ts` 未改一行） |
| KTX | 未碰 |
| 边状态机（`normal` / `dormant` / `needs_review` / `overflow`） | 未碰（`AccessMapTypes.tsx` 未改一行） |
| 两档措辞（需复核档禁「越权」；确凿越权档标来源为调用当时的授权快照） | 未改文案；两段原文原样搬进弱入口，并各有独立断言 |
| Token 过滤提示句 | 逐字未改，`SC-11` 断言逐字相等 |
| URL 参数合法值（`24h` / `168h` / `720h` / `view` / `focus` / `token` / `agent` / `role` / `connection` / `table` / `layer` / `trust`） | 未改；`URL 参数全部透传到接口（可分享）` 用例仍绿 |
| 页面标题 / 导航不得用「桑基图」 | 标题仍是「访问关系图」；`SC-12` 断言整页正文不含「桑基」 |
| 需复核文案禁「越权」 | 短行的「虚线 = 需复核」项与弱入口的 needs-review note 均断言不含「越权」 |
| 选中态禁 `pl-btn--primary` | `SC-06` 断言视图切换与统计窗口分段控件都不含该类 |
| 不新增运行时依赖 | 未新增任何依赖（`package.json` 未改） |
| 不新增裸十六进制颜色 | 浮层只用语义层 token（`bg-bg-elevated` / `border-border-default` / `text-fg-default` / `text-fg-muted`）；布局测试的全量 hex 扫描仍绿 |
