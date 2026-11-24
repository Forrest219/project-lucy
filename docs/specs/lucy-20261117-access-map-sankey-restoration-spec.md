# 访问关系图桑基还原 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 访问关系图桑基还原 Spec |
| 文档类型 | Spec（事故修复合同＋呈现修订） |
| 版本 | v0.2 |
| 撰写日期 | 2026-11-17 |
| 撰写人 | Claude（Cursor） |
| 委托人 | 星辰 |
| 基于材料 | 线上实例 `http://10.69.95.109:8276/admin/access-map` 的 `/api/health`；仓库 `65f40847`；沙箱 A/B 复现（旧码 `6d2664b3` 对 HEAD）；Spec 187、geometry、usage-first、empty-fix、outcome-vocabulary、confirmed-only；错题 `2026-11-13-access-map-sankey-empty` |
| 适用范围 | 访问关系图桑基还原的功能合同（D0＝C）与实施记录。**线上升级（A1／D5）不在本次开发授权内** |
| 输出位置 | `docs/specs/lucy-20261117-access-map-sankey-restoration-spec.md` |

| 状态项 | 现值 |
|---|---|
| 功能编号／优先级 | **P1-41**／REQ-030-062／**P1** |
| 阶段 | S5 |
| 收口范围 | Docker 种子沙箱必做 R0／01–05；SANKEY-06 沿用旧码基线；SANKEY-07 归发布取证 |
| 状态 | S5｜v0.2；功能合同已收口（2026-11-22，S4→S5 并行波次·scoped）。D0＝C；终稿由委托人明示确权；已授权并实现 A2／A3 与 Track B 方案 C，已提交。不入核心分母。≠ 可上线 |
| 决策来源 | 委托人 2026-11-17：「批准方案 C，授权定稿开发」。此前同日：「当前并没有实现桑基图的效果，出现了严重偏离设计意图的」 |
| 已裁定 | **D0＝C**（使用优先＋闲置授权幽灵层）。D1–D4 按 §4 推荐；D5 线上升级未授权 |

## 闭口层级

- 层级：功能合同
- 本条承诺：§7 SC-A2–A7 与 SC-B1–B6 在目标构建上成立。SC-A1（线上含修复提交）属发布动作，不在本次开发授权内。
- 本条出口：测试台 `UAT-SUITE-ACCESS-MAP-SANKEY` 产品侧必做用例全绿，按 [DEVELOPMENT.md「产品侧修复收口」](../governance/DEVELOPMENT.md#产品侧修复收口) 记录判定。
- 不在本条出口：线上 UAT-SANKEY-07（归发布取证）、改边状态机、改路径主键、放开 `include_candidate`、改写历史审计行、出包与客户部署、窄屏。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: 闲置授权聚合节点（`闲置授权 · {k} 张表`）、未确认关联调用数（空态说明中的 `{N}`）。

产品名仍为「访问关系图」；「桑基」只作图形形式描述，不作页面标题。沿用「授权路径」「访问路径」「闲置授权」「需复核」「确凿越权」「已确认关联」。

新增用户可见文案（登记于此，实施前须并入术语标准 §4.8）：

| 位置 | 文案 | 说明 |
|---|---|---|
| 闲置聚合节点 | `闲置授权 · {k} 张表` | 每个连接至多一个，取代逐表铺开 |
| 空态说明 | `窗口内另有 {N} 次调用因问询关联未确认，未计入本图（口径：已确认关联）` | 不得再把原因归给筛选条件 |
| 图例第 2 项 | `虚线轮廓 = 闲置授权（示意宽度，封顶，不与实心带同尺度）` | 仍为四项 |

禁止：「僵尸授权」；把 `{N}` 次未确认调用写成「越权」或「异常」。

---

## 1. 结论

| ID | 结论 | 证据 |
|---|---|---|
| F1 | **线上镜像没有改善，也不可能改善。** 它是 `6d2664b3`（2026-11-05），含 `556fdc30`（只计已确认关联），**不含** `f3f88837`（闲置骨干＋begin 后归因）与 `e2ca2ca7`（`ok` 进访问路径）。同一份数据，旧码 `rawCalls=0`、`deniedCalls=175`、156 条边全为 `dormant`；页面只剩文字标签，没有柱和流带 | §2 表 A；证据图 `old-6d2664b3-rich` |
| F2 | **含修复的 HEAD 在「无已确认访问」时仍不是桑基。** 只有 3px 发丝线（`BACKBONE_PX=3`），表列整列消失，188 条授权路径不可读 | `head-grants-only`；`AccessMapCanvas.tsx` 常量 |
| F3 | **HEAD 在活跃 Agent 多时桑基整体塌缩。** 刻度＝`(576 − 16·(N−1)) / 列内路径数`。42 个 Agent、146 条访问路径时刻度＝0：柱高 0、流带不可见，SVG 却高 1350px。客户环境有 67 个用户，属主路径问题 | `head-dense`；DOM：`rect height="0"`；§2 表 C |
| F4 | **HEAD 的编码是「使用优先」，授权面几乎不可见。** 何老师 132 条授权里未被使用的部分只画成一个发丝 stub；图例写「流带宽度 = 访问路径数」。这与 Spec 187 §4.1「授权骨架＋访问内核」不是同一张图 | `head-rich`、`head-sparse`；[usage-first §1.5](lucy-20261105-access-map-usage-first-spec.md) |
| F5 | **候选关联被静默吞掉。** 175 次带表调用全为未确认关联时，页面只说「没有进入访问路径的允许调用，可调整筛选再看」，API 不披露被排除的次数。调筛选无效 | `candidate-only` 沙箱 |

线上页面本身未能登录核对（无凭据）。F1 由 `/api/health` 的 `gitSha` 与 git 祖先关系证明；F3 在线上是否触发取决于该实例的活跃 Agent 数，**待登录后验证**（UAT-SANKEY-07）。

## 2. 证据

**表 A：同一份 `rich` 种子数据，旧码对 HEAD（API，`inquiryKind=all&accessGrade=all`）**

| 指标 | 期望 | 旧码 `6d2664b3`（≈线上） | HEAD `65f40847` |
|---|---|---|---|
| `accessPaths` | 20 | **0** | 20 |
| `rawCalls` | 173 | **0** | 173 |
| `deniedCalls` | 2 | **175**（`ok` 被当拒绝） | 2 |
| 边状态 | 含 normal／dormant／needs_review／overflow | 156 条全 `dormant` | normal 23／dormant 132／overflow 1／needs_review 1 |

**表 B：HEAD 在各数据形态下的画面**

| 形态 | 画面 | 判定 |
|---|---|---|
| `rich`（20 条访问路径） | 使用优先桑基，四态齐全 | 可读；授权面不可见（F4） |
| `sparse`（4 条访问路径，2 个 Agent、3 张表） | 使用流带＋其余 Agent 为发丝 stub | 可读；宽授权只剩发丝（F4） |
| `grants-only`（0 条） | 3 列发丝线，无表列 | **不是桑基**（F2） |
| `candidate-only`（175 次未确认） | 同 `grants-only`，且无任何原因披露 | **不是桑基＋误导**（F2、F5） |
| `dense`（42 Agent） | 只剩标签与一条游离曲线 | **塌缩**（F3） |

**表 C：刻度塌缩（`usableForUnit=576`，`NODE_GAP=16`，访问路径 146）**

| 列内活跃节点 N | 10 | 20 | 25 | 30 | 36 | ≥37 |
|---|---|---|---|---|---|---|
| 每条路径厚度 px | 2.96 | 1.86 | 1.32 | 0.77 | 0.11 | **0** |

## 3. 设计意图是怎么丢的

| 顺序 | 合同 | 编码 | 对「桑基」的影响 |
|---|---|---|---|
| 1 | Spec 187 | 骨架宽度＝授权路径；内核＝访问路径；全部授权表进列 | 原始意图：一张图读授权与使用 |
| 2 | geometry v0.2（11-01，截图 `access-map-geometry-sparse-1920.png`） | 细柱＋面积带；粉带＋蓝核 | 最接近原意图的实现 |
| 3 | confirmed-only（11-05） | 访问面只计已确认关联 | 真实库里 confirmed 极少 → 访问侧近乎为 0 |
| 4 | usage-first（11-05） | 厚度只跟访问路径；闲置表不进列；授权退为 3px stub | 授权面从图上消失；访问为 0 时图近乎空 |
| 5 | 空桑基修复（11-13） | 空访问画 3px 骨干；begin 后归因 | 修了「几乎空图」的症状，仍是发丝线 |
| 6 | 词表对齐（11-13） | `ok` 进访问路径 | 修 F-1；线上镜像尚未含 |

第 3、4 步各自的验收在夹具上都绿，组合后的部署形态未进任何一条出口——与错题本 §4 一致。

## 4. 决策

**D0（已裁定＝C，委托人 2026-11-17）：桑基的「设计意图」按哪一版编码。**

| 选项 | 内容 | 利 | 弊 |
|---|---|---|---|
| A 恢复 Spec 187 双层 | 骨架＝授权路径，内核＝访问路径，全部授权表进列 | 与原始设计、geometry 截图一致 | 何老师类宽授权（132 条）撑爆列高；与 usage-first S1–S9 全面冲突；需改写其 SC |
| B 维持使用优先 | 只修 Track A | 改动最小 | F2、F4 保留：授权面不可见；无访问时仍非桑基 |
| **C 使用优先＋闲置授权幽灵层（推荐）** | 使用流带不变；授权剩余量画成虚线轮廓流带，终点聚合为每连接一个「闲置授权 · k 张表」节点 | 授权面可见；使用刻度不被撑；无访问时仍是完整四列桑基；兼容 usage-first 的 SC-02／05／19 | 幽灵层宽度是示意量（封顶），须在图例明示；改写 usage-first §5.4 与空桑基骨干 |

推荐 C 的理由：它同时满足「一眼读到授权与使用」与「不让宽授权淹没使用主线」，且是对 usage-first 的增量。

| ID | 裁定（与 D0 无关） |
|---|---|
| D1 | 访问面继续硬锁 `association_status='confirmed'`；不放开候选 |
| D2 | 刻度设下限，列高超预算时增高画布并纵向滚动，**不再**把刻度压向 0 |
| D3 | 每列可见节点设上限，余者折入「其他」，折叠受害序沿用 usage-first §5.8 |
| D4 | 允许只读 meta 增补 `access.unconfirmedCalls`；不改边状态机、路径主键、既有字段 |
| D5 | 线上镜像升级是**发布动作**，不属本 Spec 开发范围；须委托人另行授权，并按 amd64 出包／客户环境另议 |

## 5. 设计

### 5.1 Track A（与 D0 无关，必做）

**A1 发布取证。** 线上实例升级后 `/api/health.gitSha` 必须含 `f3f88837` 与 `e2ca2ca7`。升级前后各跑一次 UAT-SANKEY-R0 与 07。

**A2 刻度下限与列节点上限（修 F3）。**

```text
UNIT_MIN = 2            # px / 路径，使用流带
COLUMN_NODE_CAP = 24    # 每列可见使用节点上限；其余折入「其他（n）」

rawUnit = (usable - reserve(col)) / columnFlow(col)        # 现行公式
unitPx  = clamp(rawUnit, UNIT_MIN, MAX_PX_PER_PATH)         # 新增下限
# 现行 `unitPx *= usable / maxColumnHeight` 回缩循环：回缩后仍不得 < UNIT_MIN
contentHeight = Σ 步进（可 > DENSE_BUDGET_H）               # 允许增高
canvas container: max-height = ACCESS_MAP_CANVAS_MIN_HEIGHT 上限；超出纵向滚动
```

**A3 空态诚实（修 F5）。** 服务端在访问面不可用之外，额外统计窗口内「有带表来源、但 `association_status` 不是 `confirmed`」的去重调用数，写入 `meta.access.unconfirmedCalls`（只读，口径与访问面同窗、同默认用量条件）。空态说明按 §Terminology 文案显示，并链接「对照访问日志」。`trust=include_candidate` 仍返回 400。

### 5.2 Track B（D0＝C，已实施）

```text
对每个连接 c：idleTables(c) = 该连接内「有授权、且窗口内无任何 Agent 的访问路径」的去重表数
若 idleTables(c) > 0：表列加一个聚合节点「闲置授权 · k 张表」，排在使用表之后；不逐表进列
沿 Agent→角色→连接→聚合节点 画幽灵流带：
  idleGrant(e) = grantPaths(e) − accessPaths(e)            # ≥ 0
  ghostPx(e)   = clamp(idleGrant(e) × GHOST_UNIT, GHOST_MIN, GHOST_MAX)   # 仅当 idleGrant > 0
  GHOST_UNIT = 0.5，GHOST_MIN = 6，GHOST_MAX = 40          # 示意尺度，与 unitPx 无关
绘制：fill 为极淡 tint，stroke 为 fg-muted 虚线 1px；画在使用流带之后（底层）
柱高：使用节点仍 = max(in, out) × unitPx；纯闲置节点柱高 = 0，其幽灵带落在柱体下方的「幽灵区」（高 = 该节点入／出幽灵带厚度之和的较大者），不进使用刻度分母
闲置判定：按入边——表的所有入边 accessPaths 均为 0 才算闲置表（节点元数据可能与边不一致，以边为准）
聚合计数：按未折叠全量图（census）数表，渲染图里已折进「其他（n）」的闲置表不得被数成 1
访问面不可用（accessOk=false）：不出聚合节点、不称「闲置」，授权余量仍以幽灵带示意，悬停文案写「授权」
点击聚合节点 → 复用 access-map-idle-grant-list；点行 → 既有边抽屉
悬停措辞沿用 idle-grant-copy：有授权，窗口内未调用；调用 0 次
```

被改写的既有条款：usage-first §5.4（3px 单 stub）、SC-01（`IDLE_GRANT_PX∈[2,4]`）、空桑基修复 §3（`BACKBONE_PX`）。保持不变：usage-first SC-02／05／19、厚度＝`accessPaths×unitPx`、列序＝访问路径降序、四态配色与非颜色编码。

### 5.3 核心流程（伪代码）

本 Spec 的算法只有两处，均已写在上文代码块中：§5.1 A2 的刻度下限与列节点上限，§5.2 的闲置授权聚合与幽灵带。除此之外不引入新的算法。

## 6. 非目标

| 不做 | 原因 |
|---|---|
| 放开 `include_candidate`／回填历史关联 | confirmed-only 与信任 Spec |
| 幽灵层与实心带同尺度 | 会让宽授权重新撑爆画布（选项 A 的弊） |
| 逐表铺开闲置授权 | 破坏 usage-first S1／S3 |
| 改默认问询种类／访问等级 | 本次证据未显示它是主因 |
| 浏览器 E2E 套件、窄屏 | 仓库约束 |

## 7. 验收

| ID | 断言 | 打假 | 对应 UAT |
|---|---|---|---|
| SC-A1 | 线上 `gitSha` 含 `f3f88837`、`e2ca2ca7` | git 祖先判定 | SANKEY-07 |
| SC-A2 | `dense`：每条使用流带厚度 ≥ `UNIT_MIN`；无使用节点柱高为 0 | DOM 量 `rect height`、`path` 包围盒 | SANKEY-05 |
| SC-A3 | `layoutAccessMap` 对 N＝1…80 个活跃 Agent：`unitPx ≥ UNIT_MIN`；`contentHeight` 随 N 单调不减 | 单测 | SANKEY-05 |
| SC-A4 | `dense`：每列可见使用节点 ≤ `COLUMN_NODE_CAP`＋1 个「其他」；闲置授权聚合节点不占上限（每父节点至多 1 个，另计）；容器纵向可滚动 | DOM | SANKEY-05 |
| SC-A5 | `candidate-only`：`meta.access.unconfirmedCalls` ＝ 175；`trust` 仍为 `confirmed`；`include_candidate`＝400 | API | SANKEY-04 |
| SC-A6 | `candidate-only` 页面说明含 `175`，且不再写「可调整筛选后再看」 | DOM 文本 | SANKEY-04 |
| SC-A7 | F-1 回归：`rich` 在目标构建上 `rawCalls=173`、`deniedCalls=2` | API | SANKEY-R0／01 |
| SC-B1 | `grants-only`：表列恰 4 个聚合节点（非 144 个）；每个连接 ≥ 1 条幽灵带，厚度 ∈ [6, 40] | DOM | SANKEY-02 |
| SC-B2 | `sparse`（4 条访问路径、3 张被用表）：表列为 3 个使用表＋4 个聚合节点，文案依次含 `119`（warehouse_dw）、`10`（sales_mysql）、`8`（finance_mysql）、`4`（hr_pg）；何老师有 2 条实心使用带，且其 Agent→角色→连接链上有幽灵带。`k` 按连接内「无任何访问路径」的去重表数计，不按 Agent 拆 | DOM 文本与 path 数 | SANKEY-03 |
| SC-B3 | 闲置表 1→100：既有使用带厚度、使用柱高不变（usage-first SC-02 保持） | 布局单测 | SANKEY-03 |
| SC-B4 | 图例恰四项，第 2 项为幽灵层文案；不含「流带宽度 = 授权路径数」 | 组件 | SANKEY-03 |
| SC-B5 | 点击聚合节点打开闲置清单，行数＝k；点行打开正确边抽屉 | 组件 | SANKEY-03 |
| SC-B6 | 幽灵带不写「调用 N 次」，悬停仍为「调用 0 次」 | 组件 | SANKEY-03 |

SC-B* 在 D0＝C 下生效（已裁定）。

## 8. 风险与开放问题

| ID | 问题 |
|---|---|
| Q1 | 已闭合：D0＝C（委托人 2026-11-17） |
| Q2 | 线上实例 `lucyVersion=0.25.0` 却带 0.30 池提交 `6d2664b3`，应升到哪个产品版本？（D5，发布另议） |
| Q3 | 线上活跃 Agent 数与 `association_status` 分布未知，F3／F5 在线上的触发程度需登录后核对 |
| Q4 | 已闭合：`GHOST_UNIT=0.5`、`GHOST_MIN=6`、`GHOST_MAX=40` 在 `rich`／`grants-only`／`dense` 目视可读（`grants-only` 四个聚合带实测 8／6／24／40）。线上数据下是否需调，待 07 |
| Q5 | 已闭合：本 Spec 末尾已补「交互合同」「元素清单」「交互评审」，配对 Plan 见 [lucy-20261117-access-map-sankey-restoration-plan.md](../plans/lucy-20261117-access-map-sankey-restoration-plan.md)。Plan 的浏览器验证证据保持「未执行」：沙箱目视与 DOM 量值记在 UAT run，不冒充该证据 |
| R1 | 增高画布会让「首屏一眼看全」让位于滚动；以 `COLUMN_NODE_CAP` 限制最坏高度 |

## 9. 授权范围与实施记录

**授权**：委托人 2026-11-17「批准方案 C，授权定稿开发」。范围＝Track A 的 A2（刻度下限＋列节点上限）、A3（未确认关联披露）＋Track B 方案 C。**不含** A1／D5（线上升级与发布）。

**实现落点**

| 项 | 位置 |
|---|---|
| A2 刻度下限 `UNIT_MIN=2`；回缩循环只看使用几何 | `webui/src/components/admin/AccessMapCanvas.tsx` |
| A2 列节点上限 `COLUMN_NODE_CAP=24` | `webui/server/admin/access-map.ts`（`foldAccessMapGraph`） |
| A3 `meta.access.unconfirmedCalls` | `webui/server/admin/access-map-echo.ts`（`countUnconfirmedCalls`）＋ `access-map.ts` |
| A3 空态说明与「对照访问日志」链接 | `webui/src/pages/admin/AccessMap.tsx` |
| B 幽灵带、幽灵区、聚合节点、图例 | `AccessMapCanvas.tsx`、`AccessMapLegend.tsx`、`AccessMapTypes.tsx` |

**与设计稿的差异（已核对，均不违背合同）**

- 聚合节点是画布合成节点（`idle-agg:<父节点 id>`，`meta.idleTableIds`），不在服务端响应里。
- 闲置表按入边判定，不信节点自带的 `accessPaths`。
- 纯闲置节点柱高为 0，幽灵区另计；因此 `rich` 里 `idle_bot`、`hr_reader`、`hr_pg` 柱高为 0 属预期，它们不是使用节点。
- `dense` 表列可见 26 个：24 个使用节点＋「其他」＋1 个闲置聚合节点。
- 图区容器最大高度 `clamp(480px, 78vh, 960px)`，内部纵向滚动。

**被取代的既有断言**（`IDLE_GRANT_PX`、`BACKBONE_PX`、`idleStubs`、`layer==="backbone"`、旧图例第 2 项）：`access-map-usage-first.test.tsx`、`access-map-layout.test.tsx`、`access-map.test.tsx` 已按 §5.2 改写；usage-first SC-02／05／19 与厚度＝`accessPaths×unitPx` 保持。

**验证**：`npx vitest run src/__tests__/access-map server/__tests__/p1-access-map` 230／231 通过。唯一失败为 `p1-access-map-contract` SC-11 的 `lint-terminology`，原因是 `CreateConnectionDrawer.tsx`、`EditConnectionDialog.tsx`、`TableEditor.tsx`、`NewToken.tsx` 的受保护术语未加翻译防御；不是本条改动引入，本条未改这四个文件。

复现入口见 [`UAT-SUITE-ACCESS-MAP-SANKEY` fixtures](../qa/uat/suites/access-map-sankey-design/fixtures.md)。

## 交互合同

- 路由：/admin/access-map
- 基准页：新模式：webui/docs/design-system/20-patterns-page-layout.md
- 一件事：在同一张图里读到谁被授权了什么、实际用了什么，并看见没被用到的授权在哪里
- 状态：首访：打开页面默认近 7 天、全部种类、排除连接，图区按已确认关联画出；空：没有授权也没有访问时图区为空且列头卡片为 0，本条不改此行为；加载：数据返回前不渲染图区与卡片，不显示过期数据；错误：接口失败时在面板内写出错误原因并提示修正参数后重试；0 条：有授权但窗口内没有进入访问路径的调用时图区只画闲置授权，面板说明写出未确认关联的调用次数；成功：使用流带与闲置授权聚合节点同时可读；部分：访问面不可用时只画授权余量，不称闲置，并写明调用情况暂不可用
- 主动作：页头不放 primary 按钮，保持现状；图区内的点击只用于查看，不做写入类动作
- 决定信息：每条流带的授权路径数与调用次数、闲置授权聚合节点收纳的表数、未确认关联的调用次数、关联口径与统计窗口
- 术语：已登记，见 Terminology Compliance 与术语标准 §4.8
- 台账：无新台账
- 状态维度：同一状态维度不得互相否定；图例写「虚线轮廓 = 闲置授权」时，悬停与清单不得再把同一条授权写成已使用

## 元素清单

- E1｜/admin/access-map｜首访｜页面主工作区｜默认筛选下直接出图，图例与关联口径同屏可见
- E2｜/admin/access-map｜空｜图区与列头卡片｜无授权无访问时列头卡片为 0，行为与改前一致
- E3｜/admin/access-map｜加载｜页面主工作区｜数据返回前不渲染图区，不显示过期数据
- E4｜/admin/access-map｜错误｜面板内错误说明｜接口失败时写出错误原因并提示修正参数后重试
- E5｜/admin/access-map｜0 条｜图区上方说明｜有未确认关联调用时写出次数与口径并链接访问日志，否则按筛选条件提示
- E6｜/admin/access-map｜成功｜图区｜使用流带实心，闲置授权为虚线轮廓，聚合节点可点击查看表清单
- E7｜/admin/access-map｜部分｜图区与悬停浮层｜访问面不可用时不出现闲置字样，悬停写调用情况暂不可用
- E8｜/admin/access-map｜主动作｜图区点击｜点节点钉住链路，点聚合节点开清单，点流带开关系明细抽屉
- E9｜/admin/access-map｜决定信息｜列头卡片与悬停浮层｜卡片给出节点数与闲置授权数，浮层给出授权路径与调用次数

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过
