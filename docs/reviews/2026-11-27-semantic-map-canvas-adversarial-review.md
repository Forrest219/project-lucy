# REQ-0121 语义地图（Semantic Map Canvas）· 第 1 轮对抗性评审

| 元数据 | 内容 |
|---|---|
| 文档名称 | REQ-0121 语义地图（只读 Canvas）· 第 1 轮对抗性评审 |
| 文档类型 | Review（过程评审记录） |
| 版本 | v1.0 |
| 日期 | 2026-11-27 |
| 评审对象 | [设计稿](../design/design-2026-11-27-semantic-map-canvas.md)（v1.0「设计协商定稿」）· [REQ-0121](../backlog/entries/REQ-0121-semantic-map-canvas.md) |
| 评审人 | Claude Code（只读对抗评审员） |
| 委托人 | xingchen |
| 关联登记 | REQ-0121（需求池阶段 S1） |
| 适用范围 | 设计阶段的对抗性评审；评「设计稿能否兑现自身承诺」，不评实现、不评 UAT |
| 输出位置 | `docs/reviews/2026-11-27-semantic-map-canvas-adversarial-review.md` |

## 0. 本记录的效力

- 本评审**不构成**终稿确权、开发授权、功能合同收口、UAT PASS 或可上线结论。
- 本轮**未改任何运行代码、导航或配置**；只读核查了仓库内既有实现与规格，产出本文件。
- 本轮不引入新需求，只指出设计稿与其所依赖的现行事实之间的差距；每条发现都可按给出的路径与行号复核。
- 复核方式说明：B1/B2 附有一次只读实测（`listSourcesWithManifests` 在本仓库资产上的调用结果），命令与输出写在 B1 详述内，可原样重跑。

---

## 1. 结论

**REQUEST CHANGES**（退回设计稿修订；**不构成**阻断立项，但在 B1–B4 关闭前**不得**据此开写功能 Spec，也不得进入 Plan／开发授权）。

一句话理由：设计方向（只读投影、不抢单表工作台、不做 KG）与现行产品边界基本对齐，但**它赖以成立的三条事实前提——join 落在哪一层、表身份与 overlay 文件如何对应、规模按多少张表推预算——与仓库现行实现和已登记的客户现网基线不一致**；按稿实现会出现「页面正常、结构结论相反」的假绿。

---

## 2. 逐项总表

| 编号 | 级别 | 结论 | 关闭条件 |
|---|---|---|---|
| B1 | 阻断 | join 落盘层被假定错：稿称 joins 只在 Schema Manifest，实际运行时/发布事实源在 overlay；按稿实现可能整片 0 边 | 设计稿钉死「join 事实源 = Manifest 表节点 ∪ overlay（同表同 `to`+`on` 去重；`source≠formal` 不入图）」，并补客户现网逐连接抽样统计（joins 各层占比）作为依据 |
| B2 | 阻断 | 节点身份与 overlay 命名未写清：「无 overlay」「未语义化」两个筛选按稿无法机判，且大概率误判 | 设计稿写明节点身份 = `(connectionId, schema, sourceName)`；overlay 路径 = `semantic-layer/<conn>/<sourceName>.yaml`；「未语义化」复用 `completion` 口径而非 overlay 文件存在性；同名 sourceName 跨 Schema 共用 overlay 的呈现规则 |
| B3 | 阻断 | 「孤立表」「断引用」不可机判：`to` 的解析范围/歧义处理与运行时解析器不一致，跨 Schema、跨连接引用会被误判成断引用 | 引用解析合同与 `semantic-identity.ts` 对齐（含裸名只在引用方连接内解析、限定名先本连接后跨连接、歧义阻断）；「孤立表」定义为无向闭包上入度出度皆 0；规定跨连接引用与歧义引用的呈现 |
| B4 | 阻断 | 规模前提与仓库登记的客户现网基线不一致，节点预算由错误数字推出 | 以已登记口径（10 连接 / 30 Schema / 3500 表；客户现网 25 Schema / 2691 表）重算或明确采用；补「筛选命中后是否仍受节点预算约束」的判定与可验收数字（首包上限、打开 p95、可交互门槛） |
| N1 | 重要 | 数据获取合同缺失：端点、展示快照/代次缓存、是否编译权限数都没写 | 设计稿写明 (a) 数据来源端点或复用面、(b) 是否走展示快照与代次缓存、(c) 是否跳过授权计数编译、(d) 读失败/写窗口/未就绪时的呈现 |
| N2 | 重要 | 缺降级与错误态合同：只有「岛过大强制团聚合」，没有读失败态与「数据可能不是最新」 | 补降级/错误态小节，至少区分 读取失败 / 数据可能不是最新 / 正在加载 / 空 / 部分可见；复用 `DisplayDegradedNotice` 与术语标准 §4.6.1 文案，不自造 |
| N3 | 重要 | 「查看 YAML」指向的东西与现行产品不符：现有 YAML 视图是合成表 YAML，且不含 overlay 里的 joins | 明确「查看 YAML」的产物（合成表 YAML／overlay 原文／Manifest 片段）并写明与地图口径的对应；若要 overlay 原文须新增只读端点或显式记 GAP |
| N4 | 重要 | 与现有面的双心智与口径打架：Catalog 的「关联 N」、概览的完成度、工作台的候选 join 三处口径不同 | 补「与 Catalog / 概览 / 工作台同源与差异」小节；给 P2 一条「何时用地图／何时用工作台」的判据；规定候选 join 与地图的关系 |
| N5 | 重要 | 启用范围（`enabled_tables`）与地图口径未对齐，汇总数作用域不明 | 明确地图作用域（全量 Manifest 表 vs 已启用表）并提供可切换标记；所有汇总数标注作用域 |
| N6 | 重要 | 画像小节不达模板要求：缺「变更前后体验」与「可核对依据」 | 4 画像逐行扩成模板形态；P2 的 `↑` 锚到可验收事实并挂 SC 占位 |
| N7 | 重要 | 新术语未登记术语标准 | Spec 阶段把「语义地图／Schema 岛／连通团／孤立表区／断引用」登记进 `00-product-terminology-standard.md`，并写明与 Access Map 的区分语 |
| C1 | 建议 | 深链与返回路径契约缺失 | 钉 `conn/schema/table` 深链参数、返回路径、非法参数的降级 |
| C2 | 建议 | 写后可见性与缓存策略未写清 | 写明地图刷新时机与陈旧窗口，与写后立即可见义务对齐 |
| C3 | 建议 | 落位分组、IA 事实表与索引登记未写 | 提案须写清增删项、分组、路由、受影响画像；同批更新 IA 事实表与 `docs/README.md` 索引；需求池行回填本评审链接 |
| C4 | 建议 | 验收与 UAT 台账为空 | Plan 阶段登记 `UAT-SUITE-…`，并按「WebUI 验证强制浏览器＋计时」补计时口径 |

---

## 3. 阻断／重要项详述

### B1（阻断）join 落盘层被假定错——按稿实现可能整片 0 边

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 `docs/design/design-2026-11-27-semantic-map-canvas.md:62` | §2 数据源：「同一连接下读现有语义层：Schema Manifest（表／joins）＋ per-table overlay（grain／measures 等**存在性**摘要）」——即把 joins 定位在 Manifest，overlay 只负责 grain/measures |
| `webui/server/semantic-layer.ts:484` | `modelFromTable()` 的 joins 只来自 Manifest 表节点：`compact((Array.isArray(record.joins) ? record.joins : []).map(normalizeJoin))`；**overlay 的 joins 不参与**（overlay 在该函数里只喂 grain/measures/segments，见 `:485-487`） |
| `webui/server/semantic-identity.ts:394-413` | 运行时依赖闭包**同时**读两处：Manifest 表节点 `manifestTable.joins`（`:394`）与 overlay 文件 `<conn>/<sourceName>.yaml` 的 `overlay.joins`（`:410`） |
| `webui/server/semantic-assets.ts:2556-2566` | 发布路径把 `joins: parsed.joins` 取自 **overlay 文件内容**（overlay 才是被发布的语义源） |
| `docs/specs/lucy-20261126-auto-join-graph-inference-spec.md:27,138` | REQ-0116「一键采纳后**写入对应 overlay YAML** 并刷新索引」——又一条把 joins 写进 overlay 的路径 |
| 资产实证 `semantic-layer/demo-mysql/superstore_orders.yaml:45-53` | 该表声明 2 条 `source: formal` join（`to: superstore_returns` / `to: superstore_people`），**全部写在 overlay**；其 Manifest `semantic-layer/demo-mysql/_schema/dataforai.yaml` 的同名表节点**无 joins** |
| 只读实测 | 以 `LUCY_CONTENT_ROOT=<repo root>` 调 `listSourcesWithManifests`：demo-mysql 3 张表 `joinCount` 全为 **0**；全库 15 张表中 `joinCount>0` 的表数为 **0** |

**对抗性反例**

1. 客户现场 2691 张表，joins 主要写在 overlay（overlay 才是发布/运行时事实源）。实现严格按稿只读 Manifest → 地图整片 **0 条边**、每张表都是「孤立表」，而这批表在问数运行时是有连通的。页面不会报错、不会白屏，只是**安静地给出与运行时相反的结论**——这是最典型的假绿。
2. 反向也成立：若客户现场 joins 在 Manifest，而 Map 与工作台的 `关联` 页签同源于 `modelFromTable`（`semantic-layer.ts:484`），则地图边数与工作台一致但**都与运行时不一致**。无论实现者选哪一层，只要不同时读两层，就有一半真相丢失。
3. 落盘侧已经分叉：WebUI PUT patch 写 Manifest（`semantic-layer.ts:802-806`），REQ-0116 采纳写 overlay。两层会持续漂移，地图必须显式处理「两层都有、且不一致」的情况。

**必须修订**

- 设计稿写明 join 事实源合同：**Manifest 表节点 ∪ overlay**；同一张表同一 `to`+`on` 只画一条边；`source ≠ formal`（candidate／manual）不入图；两层冲突时以哪一层为准（建议：按运行时语义层，即 overlay 与发布路径一致）并写出理由。
- 补一条**客户现网抽样证据**（至少逐连接统计「joins 落在 Manifest 的表数／落在 overlay 的表数／两层都有且不一致的表数」）。没有这条统计，「以 formal join 为唯一边」这条裁定在真实资产上不可证。
- 同时补上「同表两个 schema」情形：overlay 无 schema 维度，B2 的结论同样适用于 join 归属。

### B2（阻断）节点身份与 overlay 命名未写清——「无 overlay」「未语义化」大概率误判

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 `:70` / `:83` | 节点徽章「有无 overlay／grain」；筛选 3「仅无 overlay／未语义化」 |
| `webui/server/semantic-identity.ts:36-40` | 模块头注释：「An overlay file is `semantic-layer/<connection>/<sourceName>.yaml` — it has **NO schema dimension**. Two schemas of the same connection that use the same source name therefore share one physical file.」 |
| `webui/server/semantic-identity.ts:273,288` | `overlayRelPath = semantic-layer/<conn>/<sourceName>.yaml`；`overlayExists` 按该路径判定 |
| `webui/server/semantic-layer.ts:393-404, 599-601` | WebUI 侧 overlay 存在性判定＝连接目录 `readdir` 结果里有没有 `<table>.yaml`，其中 `table` 是 **Manifest 的 `tables:` 键（= sourceName）** |
| `docs/specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md` D3（`:44`） | 同名冲突时 sourceName 依次尝试 `<schema>_<table>`、`<schema>_<table>_2`、`<schema>_<table>_3`；**只有冲突表才加前缀** |
| `webui/server/semantic-layer.ts:485-487` | grain/measures/segments 是 **overlay 优先、Manifest 兜底** → 「有 grain」≠「有 overlay 文件」 |
| `docs/SYSTEM_HANDBOOK.md:84` | 既有产品口径：「未语义化」= `completion != done`（需表描述＋grain＋主键＋全部非 hidden 列描述＋至少一个 measure）；且概览的待补语义计数**只统计 `enabled_tables` 内表** |

**对抗性反例**

1. 实现者按直觉去找 `<schema>_<table>.yaml` → 现场经 P1-64 分配过前缀的表命中，**裸名表全部误判为「无 overlay」**；再叠加 `_2` 后缀分配，误判面进一步扩大。「仅无 overlay」筛选会一次性返回大量**已被语义化**的表。
2. 反例二：一张表的 grain 写在 Manifest、根本没建 overlay 文件 → 它被判「无 overlay／未语义化」并被筛出来，但 Catalog 里它的完成度是 `done`。治理方在同一产品里看到两个互相打架的读数。
3. 反例三：同连接两个 Schema 用了同一 sourceName → 两张表**共用一份 overlay 文件**（`semantic-identity.ts:36-40`）。地图若给两张表各打一个「有 overlay」徽章，等于把一份文件的内容算给两个对象；若一张改了，另一张的徽章静默变化，无从察觉。
4. 反例四：SQL Server 的 `db.schema.table` 三段名（`semantic-identity.ts:289-292` 已有 `schemaMismatch` 标志）——设计稿从未说明节点标签用物理名、sourceName 还是 `schema.table`。三种标签在三种现场会指向不同的表。

**必须修订**

- 节点身份写死为 `(connectionId, schema, sourceName)`，并声明「`sourceName` 取 Manifest `tables:` 键；物理名另存为 `qualifiedName`（`table:` 字段），仅在需要消歧时展示」。
- overlay 路径写死为 `semantic-layer/<conn>/<sourceName>.yaml`，并说明**同名 sourceName 跨 Schema 共用一份文件**时的呈现（合并为一条事实并标注共享？禁止出现两个互不相干的「有 overlay」徽章）。
- 「无 overlay／未语义化」必须复用 `computeCompletion`／`completion` 的既有口径（`webui/server/semantic-layer.ts:661`、`docs/SYSTEM_HANDBOOK.md:84`），**不得**用 overlay 文件存在性代替语义完整度；两个筛选要么合并为一个「未达 done」，要么各自写死定义。
- 节点标签用哪个名字（物理名／sourceName／限定名）写进合同，并说明 SQL Server 三段名的展示规则。

### B3（阻断）「孤立表」「断引用」不可机判——引用解析规则必须与运行时对齐

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 `:75-77` | 同 Schema 团内实线；跨 Schema 岛间弱线＋计数；「断边／指向不存在表：标『断引用』，可筛」 |
| 设计稿 `:82,84` | 筛选 2「仅孤立表」；筛选 4「仅断引用」 |
| `webui/server/semantic-identity.ts:454-462` | 解析合同注释：「`to` may be `<schema>.<table>` or a bare table name. A qualified reference is resolved inside the referring connection first and then across connections; a bare name is resolved inside the referring connection only. More than one candidate is an ambiguity and is blocked — the module never guesses a default connection.」 |
| `webui/server/semantic-identity.ts:161-168` | 限定名解析：末段为 table，其余段为 schema（SQL Server 的库段不参与文件/Schema 判定） |
| `webui/server/semantic-identity.ts:161,285-292` | 已有 `schemaMismatch` 标志：Manifest 声明的物理 `table:` 前缀与所属 Schema 不一致时，不视为文件错配 |
| `webui/server/semantic-layer.ts:182-199` | `normalizeJoin`：`to`/`on` 缺失即丢弃该 join；`relationship` 缺省落 `many_to_one`；`source` 仅认 `manual`/`candidate`，其余落 `formal` |

**对抗性反例**

1. 实现用「同 Schema 内按裸名找表」解析 `to` → 现场一条 `to: orders` 实际指向**同连接另一 Schema** 的 orders（运行时解析成立），地图把它标成「断引用」。治理方打开「仅断引用」清单，看到几十条**有效关联**被标为断引用，据此去清理配置 → 破坏可用的问数路径。
2. 反例二：跨连接限定名（`to: other_conn.schema.table`）在运行时可解析，但地图「不默认跨连接一张巨图」→ 这条边**被静默丢弃**，地图比运行时少画边，且没有任何提示（属"看起来定了、实际少了一半"）。
3. 反例三：把「孤立」实现成 `joinCount == 0` → 那些**只作为 join 目标被引用、自身不声明 join** 的表会被算成孤立表。实际上 `joinCount` 来自 `modelFromTable`（`semantic-layer.ts:659`），只数「本表声明出去的」边，入度为 0 的表 `joinCount` 就是 0。
4. 反例四：把 Manifest 的物理 `table:`（`db.schema.table`）当作 Schema 分组依据 → SQL Server 连接整片落到错误岛，或被误判成 schemaMismatch。

**必须修订**

- 引用解析合同与 `semantic-identity.ts` 对齐（或明确声明一套新规则，并写明与运行时不一致会造成什么后果）。
- 「孤立表」定义：**在 formal join 的无向闭包上，入度与出度皆为 0**；并写明这一判定必须在「B1 合并后的双层事实源」上做。
- 「断引用」定义：按上述解析规则**无法唯一解析**到本连接内某张 Manifest 表；并把「歧义（多候选）」与「解析到别的连接」分成两种不同呈现（歧义≠断引用；跨连接引用不得静默丢弃）。
- Schema 分组依据写死：**Manifest 所属 Schema**，不是物理 `table:` 前缀；并说明 `schemaMismatch` 时的呈现。

### B4（阻断）规模前提与仓库登记的客户现网基线不一致——节点预算由错误数字推出

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 `:21` | 规模前提：「约 **10 连接 × ~8 Schema × 每 Schema 200～300 表 ≈ 2600～3000 表**」 |
| 设计稿 `:103` | 节点预算：「总览 ≤ ~30 岛级；岛内同时可见表点 ≤ ~150」 |
| 设计稿 `:109` | 体验验收直觉：「约 10 连接、单连接近三千表：打开连接总览数秒内可交互」 |
| `docs/qa/uat/scale-baseline.md:73` | 客户现网口径：「**8 连接／25 Schema／2691 张已发现表**／Helm 默认 `2C / 2Gi`」 |
| `docs/qa/uat/scale-baseline.md:79` | customer-stability profile：「跨源已发现表数 **≥ 3500**」 |
| `docs/reviews/2026-11-26-mcp-hotpath-list-sources-cache-assessment.md` §2.3 | customer-stability 基线：「**10 连接 / 30 Schema / 3500 表**」 |

**对抗性反例**

1. 现场是 **25～30 个 Schema**，不是 8 个；每 Schema 约 **110 表**（2691/25、3500/30），不是 200～300。稿中「总览 ≤ ~30 岛级」的预算**恰好等于真实岛数** → 总览层退化成「一岛一格」的名单，岛与岛之间没有可比较的量，拓扑信息为零。这是典型的「看起来有总览、实际没有信息」。
2. 反例二：若某客户确实存在单岛 300 表，「仅孤立表」一筛就可能返回 300 张表点 —— 这与「岛内同时可见表点 ≤ ~150」直接冲突，而稿中**没有写筛选命中后是否仍受节点预算约束**。实现者可以任选一边，两边都能自辩。
3. 反例三：现场是 `2C / 2Gi`（`scale-baseline.md:73`）。稿中「打开连接总览数秒内可交互」在 2 核容器上没有任何数字约束，而 3000 表的节点摘要＋边集合本身就是不小的 JSON——首包体积、序列化耗时、浏览器解析耗时都没有预算。
4. 反例四：稿中「每 Schema 200～300 表」若被写进 Spec 的验收数字，就会与仓库已登记的规模基线（`scale-baseline.md` §1／§1.1）冲突；后续按 §1 档位做 UAT 时，「地图在客户规模下可用」这条无法证伪。

**必须修订**

- 规模前提改用仓库已登记口径（10 连接 / 30 Schema / 3500 表；客户现网 25 Schema / 2691 表），或明确声明「客户现场是 25～30 Schema，每 Schema 约 110 表」并解释与稿中数字的差异来源。
- 节点预算按真实现场重算，并写死：**筛选命中后的结果集是否仍受节点预算约束**（建议受约束，超限走团聚合＋分页/搜索，而不是静默放大）。
- 补可验收数字：单岛可见节点上限、总览首包字节上限、连接总览可交互的 p95 目标、布局计算的时延上限；并引用 `2C / 2Gi` 现场档位作为约束前提。
- 补「失败降级」的量化形态：超时/超预算时展示什么（见 N2）。

### N1（重要）数据获取合同缺失——端点、快照、权限编译都没写

**证据**

- 设计稿 `:62`（读现有语义层）、`:104`（「数据加载：按连接拉节点摘要 + join 边」）、`:105`（「布局为会话内计算，不落盘」）。
- 现行读面：`GET /api/sources`（`webui/server/index.ts:1172-1179`，走 `getSourcesDisplaySnapshot`，Spec 174/195 展示快照）与 `GET /api/sources/:conn/:schema/:table`（`index.ts:1182-1190`）。`/api/sources` 返回的是**全库** `SourceSummary[]`，含 `joinCount`（`webui/server/model.ts:62-67`）但**不含 join 边**——设计稿要的「节点摘要 + join 边」没有现成端点。
- `/api/sources` 的 `authorizedAgentCount` 需按角色编译权限（`webui/server/semantic-layer.ts:614-616`）；`listSourcesWithManifests` 全量重算的开销与代次缓存方案见 `docs/reviews/2026-11-26-mcp-hotpath-list-sources-cache-assessment.md` §2.2／§4。
- 展示快照有 `grace/stale/pending` 与 503 `DISPLAY_SNAPSHOT_BUSY`（`webui/server/display-snapshot.ts:13-15,75,139-147`）。

**对抗性反例**

1. 实现直接复用 `/api/sources` 全库响应 → 3000 表全量 + 200 角色权限编译，首包就把 WebUI 展示面拖垮；现有 MCP 热路径已经因为这件事在评估缓存（同一评估文档的出发点）。
2. 实现另开一条直读 YAML 的路径（不接展示快照/代次缓存）→ 绕过写屏障与代次失效 → 写窗口内地图显示上一代结构、工作台显示新一代结构，且**地图没有任何降级提示**（N2），治理方按旧结构改配置。
3. 反例三：实现为了「按连接拉」而给 `/api/sources` 加连接参数 → 触及 Spec 174 §3.2 的版本化展示快照 envelope 与快照键，属于共享读面的合同变更，设计稿对此毫无着落。

**必须修订**

写明：(a) 数据来源端点（新增只读端点，还是复用 `/api/sources` 的只读子集）；(b) 是否挂展示快照与代次缓存（建议复用既有代次缓存方案，避免第二套扫描路径）；(c) 是否跳过授权计数编译（地图不需要 `authorizedAgentCount`）；(d) 读失败、写窗口、快照未就绪三态的呈现（接 N2）。

### N2（重要）缺降级与错误态合同——假绿的温床

**证据**

- 设计稿 `:106` 降级只有一行：「单岛过大强制团聚合，提示缩小范围」。全文没有读失败态、没有写窗口态、没有「数据可能不是最新」。
- 既有可复用合同：`docs/specs/lucy-20261124-p175-degraded-read-ui-contract-spec.md`；组件 `webui/src/components/DisplayDegradedNotice.tsx:15`（`stale: "数据可能不是最新"`）；术语标准 §4.6.1（`webui/docs/00-product-terminology-standard.md:655-668`，含 Stale Data Notice／Long Time No Update Notice／Manual Refresh Entry 三类主句与「degraded/stale/pending 不得进 UI」的禁用词）。
- 同类页面先例：访问关系图要求配置不可读时给三态提示而非空图（`webui/docs/187-access-relation-sankey-spec.md:576-579, 698-699`）。

**对抗性反例**

1. 写窗口内读面返回 pending 或 503 → 地图要么白屏（用户以为系统故障），要么继续显示上一代结构却不提示 → 治理方按旧结构改配置，保存后才发现结构已变。
2. 某 Schema Manifest 解析失败 → 地图把该岛画成「0 张表／0 条边」，读数**看起来是事实**（这正是 `webui/docs/187-access-relation-sankey-spec.md` 里「不得用空集合或 0 冒充没有」的反面教材，`webui/docs/03-api-spec.md:1497` 同款要求）。
3. 筛选「仅断引用」返回 0 条时，用户无法区分「真的没有断引用」与「本次读取失败/部分可见」。

**必须修订**

补一节「状态与降级」，至少五态：正常 / 正在加载 / 数据可能不是最新（含「刷新」入口）/ 读取失败（可归因）/ 空（真的没有）；并写明部分可见（如某岛读取失败）时该岛如何呈现、汇总数是否标注为不完整。复用既有组件与术语标准文案，不自造。

### N3（重要）「查看 YAML」在现行产品里没有它承诺的那个东西

**证据**

- 设计稿 `:47`（「表：侧栏摘要；『打开工作台』／『查看 YAML』离开地图去改」）、`:56`（「钻取到现有单表页／YAML 只读」）、`:19`（「改配置回到 YAML（及现有写 YAML 路径）」）。
- 现行唯一的 YAML 视图在表工作台的 Inspector 内：`webui/src/pages/TableEditor.tsx:824-851`（页签 `diff | yaml | validate`；yaml 面板标题「**拟写入 YAML**」，内容 `preview?.proposedYaml ?? source.rawYaml`）。
- `source.rawYaml` **不是磁盘原文**：`webui/server/semantic-layer.ts:293-318` 的 `tableYaml()` = Manifest 表节点 + overlay 的 grain/measures/segments 合成，并 `stripManifestOnlyColumnKeys`（`:315`）剥掉 manifest-only 列键；**合成结果不含 overlay 的 joins**。
- 产品内没有整份 Manifest（`_schema/<schema>.yaml`，数百张表）的只读查看器，也没有「原始 YAML 文本编辑器」；维护手段是表单／粘贴导入（`webui/server/index.ts:1276-1283`）。

**对抗性反例**

1. 治理方在地图上看到一张表「有 3 个关联」，点「查看 YAML」跳到工作台 YAML 页签，看到的合成 YAML **没有 joins 段**（joins 在 overlay，合成只取 Manifest 表节点 + overlay 的 grain/measures/segments）→ 结论：「地图编造了 3 条边」。地图与 YAML 永远对不上。
2. 反例二：合成 YAML 里的 `table:` 字段被改写成 `schema.table`（`semantic-layer.ts:312`）→ 用户拿它当「Manifest 原文」比对会以为 Manifest 被改过。
3. 反例三：反向场景——客户 joins 在 Manifest 时，合成 YAML 里 joins 段确实在，但那是**单表片段**，不是 Manifest 文件；用户想确认「这张 Manifest 还有哪些表、joins 是谁写的」时无处可去。

**必须修订**

- 明确「查看 YAML」到底指哪个产物，并建议改名为与产物一致的中性说法（合成表 YAML／overlay 原文／Manifest 片段三选一）。
- 写明该产物与地图口径的对应关系（哪些键会出现在地图徽章里）。
- 若目标是 overlay 原文或 Manifest 片段：要么列入 M1 的新增只读端点，要么显式记为 GAP（不要让设计稿把它写成已有能力）。
- 把「改配置回到 YAML」的表述改成现行真实维护手段（表单／粘贴导入 YAML／文件外编辑），避免让人以为产品内有 YAML 文本编辑器。

### N4（重要）与现有面的双心智与口径打架

**证据**

- 设计稿 `:52-57`（做／不做表）、`:135-140`（画像 P2 `↑`）。
- `docs/governance/user-personas.md:75` — P2 治理方的典型负向体验：「**每加一个能力就多一套入口，治理方被迫记住第二套心智模型**」。
- Catalog 已展示同一批对象的关联数与语义状态：`webui/src/pages/Catalog.tsx:82`（`字段 X / 关联 Y / 指标 Z`），且与 `/api/sources` 的 `completion` 同源（`docs/SYSTEM_HANDBOOK.md:83`）。
- REQ-0116 在「关联」页签展示候选推荐（`docs/specs/lucy-20261126-auto-join-graph-inference-spec.md:27`），未采纳前它们不是 formal join。

**对抗性反例**

1. 治理方在地图数出 40 张「孤立表」→ 切到 Catalog，发现 Catalog 的「关联」列也全是 0（两边同源于 manifest-only 口径，都不对但彼此一致）→ 再打开其中一张的关联页签，看到「推荐关联 3 条」→ 地图被读成「漏了」；或反向把 40 张实际已被候选 join 覆盖的表当成无人使用。
2. 地图说「该 Schema 8 张表、3 个连通团」，工作台逐表看却是 8 张表各写各的 —— 用户不知道该信哪个，也无从判断「去改哪一处」。
3. M3 计划的「从 Catalog 在地图中查看」会再造一个入口（工作台 ⇄ 地图 ⇄ 工作台），与 P2 的典型负向体验正面相撞。

**必须修订**

- 补一节「与现有面的同源与差异」：哪些读数与 Catalog／概览共用同一口径源、哪些必然不同、差异如何在 UI 上解释（一句可核对的话，而不是「不合并」）。
- 给 P2 一条**判据**（不是一句「不抢」）：什么问题去地图、什么问题去工作台，各自的入口与一句话理由。
- 规定候选 join 与地图的关系：不入边是合理的，但要决定是否在节点上标「有 N 条待采纳推荐」，以免地图的「孤立表」被误读为「这张表没人管」。

### N5（重要）启用范围（`enabled_tables`）与地图口径未对齐

**证据**

- 设计稿全文未出现 `enabled_tables`（`:64-88` 节点／边／筛选，`:98-107` 性能，`:119-121` 切片均无）。
- `webui/server/semantic-layer.ts:636-646` — `enabled` 由 `manifestTableIsEnabled` 对 `logicalName`（`<schema>.<table>`）与 `qualifiedName` 判定，含 SQL Server 特例。
- `docs/SYSTEM_HANDBOOK.md:84` — 概览「N 张表待补语义」只统计**已进入启用表范围**且出现在 Manifest 的表。

**对抗性反例**

1. 现场 2691 张已发现表里若只有数百张在 `enabled_tables` 内，地图按 Manifest 全量画 → 「未语义化 2000 张」既不是 Catalog 的口径也不是概览的口径；治理方拿这个数去做覆盖率汇报，等于拿「发现表」冒充「已纳管表」，直接违反 `docs/SYSTEM_HANDBOOK.md:74` 对「已发现表数 vs 已启用表数」的既有区分。
2. 汇总数（孤立表数、连通团数、无 overlay 数）没有作用域标注 → 数字在汇报里不可解释。

**必须修订**

明确地图作用域（全量 Manifest 表 vs 已启用表，或可切换）；节点提供启用标记；所有汇总数标注作用域，并说明与概览「待补语义」的关系。

### N6（重要）画像小节不达模板要求

**证据**

- 设计稿 `:133-140`：4 画像各一行，只给 `↑`/`＝` 与三字理由，无「变更前后体验」，无「可核对依据」。
- `docs/governance/DEVELOPMENT.md:443`（落盘清单第 17 条）：「新功能 Spec 必含『受影响画像』小节：4 画像逐行判定 `↑`／`＝`／`↓`，写明**变更前后体验**与**可核对依据**；判 `↓` 必须写补偿路径并挂验收编号」。模板与口径见 `docs/governance/user-personas.md:52-57`（4 画像定义）与 `:68-93`（P2 目标／不可牺牲／负向体验）。

**对抗性反例**

评审/出门人工核对第 17 条时，4 行里 3 行是 `＝` 且无依据行 → 无法判定通过；P2 判 `↑` 但没有可核对陈述 → `↑` 无支撑。

**必须修订**

把画像表扩成模板形态（判定／变更前体验／变更后体验／可核对依据），P2 的 `↑` 锚到具体可验收事实（例如「从 O(N) 翻表定位变为搜索命中并给出岛／团归属」），并挂 SC 编号占位。

### N7（重要）新术语未登记

**证据**

- 设计稿引入的用户可见概念：「语义地图」「Schema 岛」「连通团」「孤立表区」「断引用」（`:43-48, 64-77`）。
- 上述词在 `webui/docs/00-product-terminology-standard.md` 中**均无登记**（检索无命中）；同文件 §4.8 已为 Access Map 固定主术语「访问关系图」并列出禁止混淆词（拓扑图等），`:400` 已固定 Catalog 的主术语「语义资产／表目录」。
- 术语标准 §4.6.1（`:655-668`）已规定降级提示类文案的主句与禁用词。

**对抗性反例**

实现时把「连通团」写成「图」「力导向图」「ER 图」→ 与 Access Map 的禁止混淆清单撞车，两个图页的术语互相污染；新页在主导航与命令面板里的最终名（「语义地图」vs「语义资产图」）也会漂移。

**必须修订**

Spec 阶段把新术语登记进术语标准 §4.x，并写明与 Access Map 的区分语（不得用「图／拓扑图」混称）；同时确定页名与导航名（本轮仍属提案，需委托人 IA 独立确认，见 C3）。

---

## 4. 第 1 轮结束时的开放问题（OQ）

| 编号 | 问题 | 待裁方 | 建议默认倾向 |
|---|---|---|---|
| OQ-1 | join 事实源以哪一层为准：Manifest 表节点、overlay，还是两者合并？合并时冲突以谁为准？ | 作者 ＋ 委托人 | 合并；冲突以运行时语义层（overlay／发布路径）为准并写明理由 |
| OQ-2 | 地图作用域是全部 Manifest 表，还是 `enabled_tables` 内表？是否可切换？ | 委托人 | 默认「全部 Manifest 表」＋ 节点级启用标记；汇总数标注作用域 |
| OQ-3 | 跨连接 join 引用在地图中如何呈现（不可见／外部引用角标／独立视图）？ | 作者 | 不画跨连接边，但在源节点上标「外部引用 N 条」；不得静默丢弃 |
| OQ-4 | 是否在节点上体现 REQ-0116 的候选 join（哪怕只作角标计数）？ | 委托人 | 标「待采纳推荐 N 条」，不入边 |
| OQ-5 | 「查看 YAML」的产物是哪一个？是否为此新增只读端点（列入 M1 还是记 GAP）？ | 作者 | 先落「合成表 YAML」（已有），overlay 原文记 GAP 并显式告知用户 |
| OQ-6 | 规模前提以哪套数字为准：客户现网 25 Schema／2691 表、customer-stability 30 Schema／3500 表，还是稿中 8 Schema／300 表？ | 委托人 | 以已登记基线（30 Schema／3500 表）为准 |
| OQ-7 | 地图读面是否挂展示快照与代次缓存（复用 P1-75 合同）？ | 作者 | 挂；否则需论证为何允许第二套陈旧窗口 |
| OQ-8 | 导航落位分组与最终页名（落在既有语义层分组？独立组？）—— 需委托人 IA 独立确认（`docs/governance/DEVELOPMENT.md:51-82`） | 委托人 | 提案写全增删项／分组／路由／受影响画像，待独立确认 |

---

评审方=Claude Code；轮次=R1；日期=2026-11-27；≠终稿确权

---

## 5. R1 处置回执（Cursor Agent · 2026-11-27）

设计稿已升 **v1.1**。处置摘要：

| 编号 | 处置 | 落点 |
|---|---|---|
| B1 | **接受** | §0 Join 事实源＝Manifest∪overlay；冲突以 overlay 为准；禁止只读 Manifest |
| B2 | **接受** | §0 节点身份／overlay 路径／共享 overlay；未语义化＝`completion!=done` |
| B3 | **接受** | §0 解析对齐 semantic-identity；孤立＝无向入出度皆 0；断引用／歧义／外部引用分列 |
| B4 | **接受** | §0／§3 对齐 scale-baseline；筛选仍受预算；首包／p95／2C2Gi |
| N1–N7 | **接受** | §2–§4 读面、降级五态、合成 YAML／GAP、同源说明、作用域、画像模板、术语待 Spec |
| C1–C4 | **部分接受** | 深链／IA／UAT 写入设计；池行回填评审链接；完整 UAT 套件留 Plan |
| OQ-1…8 | **作者预裁** | 见设计稿 §0.1；**待委托人确认**后方可当 Spec 终稿输入 |

未改运行代码。进入 R2 复审。

---

## 6. 第 2 轮复审（Claude Code · 2026-11-27）

| 元数据 | 内容 |
|---|---|
| 复审对象 | [设计稿](../design/design-2026-11-27-semantic-map-canvas.md) **v1.1**（§1–§4 方向仍有效，合同细节以 v1.1 为准） |
| 复审人 | Claude Code（只读对抗评审员） |
| 复审范围 | R1 的 B1–B4、N1–N7 逐条关闭判定；v1.1 新引入的矛盾／假绿路径／空头支票 |
| 效力 | **≠终稿确权／开发授权／UAT／可上线**；本轮未改任何运行代码、导航或配置，只更新本评审文件 |
| 计数 | CLOSED **5** ／ PARTIAL **6** ／ OPEN **0**；新发现 **B 级 1 项（B5）、N 级 4 项（N8–N11）** |

### 6.1 结论

**REQUEST CHANGES**（v1.1 的方向与大部分合同已可用，但仍有 1 项阻断级（B5）与 6 项部分未闭；在 B5 与 PARTIAL 残余关闭前，**不得**据此开功能 Spec，也不得进入 Plan／开发授权）。

一句话理由：v1.1 把 R1 最硬的三条事实前提（join 事实源＝Manifest∪overlay、节点身份＝`(conn, schema, sourceName)`、未语义化＝`completion != done`）都写成了可机判条款，**假绿的主路径已经关上**；但它为关掉假绿而新引入了一条**新的静默丢弃路径**——§0 的「冲突以 overlay 为准」与运行时的**并集**读法、以及与工作台**写 Manifest** 的落盘路径方向相反（B5），结果是「工作台刚保存的 formal join 在地图上不出现、地图侧栏还宣称『按运行时闭包』」。另外，读面合同只写「按连接投影」，而跨连接／歧义判定必须依赖**全库** Manifest 索引（N10），二者不匹配会把 v1.1 明确要避免的「跨连接引用被误判为断引用」以另一种形式放回来。

另需指出：§5 处置回执把 B1–B4、N1–N7 整体记为「接受」，但按 v1.1 文本逐条核对，实际为 **5 项 CLOSED、6 项 PARTIAL**——回执是作者自述，**不构成关闭证据**，本节表格才是。

### 6.2 R1 逐条关闭表（B1–B4、N1–N7）

| 编号 | R1 关闭条件（摘要） | v1.1 落点 | 判定 | 残余（详见 6.3／6.4） |
|---|---|---|---|---|
| B1 | join 事实源钉死＝Manifest∪overlay；`source≠formal` 不入图；冲突定优先级；补现网逐连接抽样 | 设计稿 §0「Join 事实源」行、§2「与 Catalog／概览同源」 | **PARTIAL** | 合同已钉死（并集、formal-only、`(from,to,on)` 去重），且明确「不得只读 Manifest」；但 (a) **冲突仲裁方向与运行时并集、与工作台写路径相反 → 升级为 B5**；(b) R1 要求的**客户现网逐连接「joins 在 Manifest／overlay／冲突」占比抽样仍未做**（设计稿 §5.4 把它推为 Spec 前置取证任务），「formal join 唯一边集」在真实资产上仍不可证 |
| B2 | 节点身份＝`(connectionId, schema, sourceName)`；overlay 路径写死；「未语义化」复用 `completion`；同名跨 Schema 共用文件的呈现规则 | 设计稿 §0「节点身份」「未语义化」行、§2 节点表、§2 边与筛选 | **PARTIAL** | 身份、路径、`completion != done` 口径、可选第二筛独立命名均已落地，方向正确；残余：(a) **SQL Server 三段名 `db.schema.table` 与 `schemaMismatch` 的展示规则未写死**（R1「必须修订」第 4 条原文）；(b) 共享 overlay 只定义了**徽章**标注，**边的归属／去重未定义 → N9**；(c) 「无 overlay 文件」作为独立筛选引入了一个新的展示口径，Spec 需钉死其与 `completion` 的关系 |
| B3 | 引用解析对齐 `semantic-identity.ts`；孤立＝无向图入出度皆 0；断引用定义；歧义与跨连接分列；Schema 分组按 Manifest 所属 Schema | 设计稿 §0「引用解析」「孤立表」「断引用／跨连接」行、§2 边与筛选 | **PARTIAL** | 解析规则、孤立定义、断引用定义、歧义／跨连接分列、Schema 分组依据全部落地且与运行时文字一致；残余：(a) `schemaMismatch` 呈现仍未写；(b) **判定口径需全库索引、读面合同只写「按连接」→ N10**（跨连接引用会被误判成断引用）；(c) 「限定名先本连接后跨连接」在按连接投影下的可实现性未说明 |
| B4 | 用仓库登记基线（10 连接／30 Schema／3500 表；现网 25 Schema／2691 表）重算；写死筛选命中仍受预算；补可验收数字（首包／p95／2C2Gi） | 设计稿 §0「规模前提」行、§2 末、§3 性能硬约束表 | **PARTIAL** | 基线数字已换成 `customer-stability` 与现网登记口径；已补「单屏 ≤40 岛卡／≤150 表点／首包 ≤2MiB／p95 ≤3s／2C2Gi」，并写死「筛选结果仍受节点预算约束」；残余：(a) **§1「该连接下可达 ~25–30 岛」把 site 级 Schema 总数当成单连接岛数，与 §0／`scale-baseline.md` §1.2 口径冲突 → N8**；(b) R1 要求的**布局计算时延上限**仍缺；(c) 预算数字的推导链（每岛 ≈110 表）未写明 |
| N1 | 写明数据来源端点；是否挂展示快照／代次；是否跳过授权计数编译；读失败／写窗口／未就绪呈现 | 设计稿 §0「读面」行、§3 读面合同、§3 状态与降级 | **CLOSED** | 四项均已落条款（新增按连接只读投影端点、表详情懒加载、挂展示快照／代次、跳过 `authorizedAgentCount`、不直扫 YAML 绕过写屏障）；四态呈现转由 §3 承接。备注：端点的**快照 scope 键**与**全库索引来源**留给 Spec，与 N10 联动 |
| N2 | 补降级／错误态：至少区分加载中／可能不是最新／读取失败／空／部分可见；复用 `DisplayDegradedNotice` 与术语 §4.6.1 | 设计稿 §3「状态与降级」 | **CLOSED** | 五态齐备，明写「不得用 0 边冒充真空」「单岛失败时该岛失败态＋汇总数标不完整」，并复用既有组件与术语标准，未自造文案 |
| N3 | 明确「查看 YAML」产物；写明与地图口径的对应；overlay 原文须记 GAP；把「改配置回到 YAML」改成真实维护手段 | 设计稿 §0「钻取 YAML」行 | **PARTIAL** | 产物已钉为「合成表 YAML（现有 Inspector 产物）」，overlay 原文／整份 Manifest 明确记 GAP，且「改配置＝工作台表单／粘贴导入／文件外编辑」已改对；残余：**R1 要求的「该产物与地图口径的对应关系（哪些键会出现在地图徽章里）」未写** —— 合成表 YAML **不含 overlay 的 joins**（`webui/server/semantic-layer.ts:293-318` 的 `tableYaml()` 只合成 Manifest 表节点＋overlay 的 grain/measures/segments），而地图主边源正是 overlay 的 joins → 地图显示 N 条边、点开 YAML 无 `joins` 段的落差未向用户交代 |
| N4 | 补「与现有面同源与差异」；给 P2 判据；规定候选 join 与地图的关系 | 设计稿 §1 判据表、§2「与 Catalog／概览同源」、§0「候选 join」行 | **CLOSED** | 判据表（什么问题去地图／去工作台）、完成度同源、关联边口径差异的一句话说明、候选 join 只作「待采纳推荐 N」角标不入边，均已落地。备注：那句说明本身的可核对性有偏差 → N11 |
| N5 | 明确作用域（全量 vs 已启用）；节点级启用标记；汇总数标作用域；说明与概览「待补语义」的关系 | 设计稿 §0「作用域」行、§2 末 | **PARTIAL** | 作用域（默认全量 Manifest＋启用标记＋可切「仅已启用」）与「一切汇总数须标注作用域」已落地；残余：**R1 要求的「与概览『待补语义』的关系」仍未写** —— 概览的「待补语义」只统计 `enabled_tables` 内表（`docs/SYSTEM_HANDBOOK.md:84`），地图全量口径下的「未完成数」与之**天然不等**，设计只让汇总数带作用域标签，没有把这条差异说破 |
| N6 | 4 画像逐行扩成模板形态（判定／变更前／变更后／可核对依据）；P2 的 `↑` 锚到可验收事实并挂 SC 占位 | 设计稿 §4「受影响画像」表 | **CLOSED** | 4 行已按模板形态展开，P2 `↑` 锚到「≥30 Schema／≥3500 表夹具上搜索表名 ≤3s 钻到侧栏」并挂 SC 占位；P4 明确禁止把「全量 Manifest 未完成数」表述成「已启用覆盖率」 |
| N7 | Spec 阶段登记新术语进术语标准 §4.x；写明与 Access Map 的区分语 | 设计稿 §4「术语」、§0「与访问关系图」行 | **CLOSED** | 术语登记责任明确落到 Spec（与 R1 关闭条件一致），并写明「禁止与访问关系图混称」「术语不得混用拓扑图／关系图指称两者」 |

**计数**：CLOSED 5（N1、N2、N4、N6、N7）／PARTIAL 6（B1、B2、B3、B4、N3、N5）／OPEN 0。

### 6.3 R2 新发现

#### B5（阻断）join 冲突仲裁「overlay 为准」与运行时并集读法、工作台写路径方向相反 —— 工作台刚保存的 formal join 会在地图上被静默丢弃

**证据（v1.1 原文 + 仓库现行实现）**

| 位置 | 事实 |
|---|---|
| 设计稿 §0「Join 事实源」行 | 「Manifest 表节点 ∪ overlay 的 joins；……同一 `(from, to, on)` 去重一条；**冲突以 overlay／发布路径为准（对齐 `semantic-identity.ts` 运行时闭包读法）**」 |
| `webui/server/semantic-identity.ts:394-413` | 运行时依赖闭包把 **Manifest 表节点 joins 与 overlay joins 一起读进同一个 `refs` 集合**：两层**并集**，**不按 `source` 过滤**，**没有任何冲突仲裁**（同一 `to` 只去重，不比较 `on`） |
| `webui/server/semantic-layer.ts:774-807`（`applyPatch`）＋ `:836-853`（`buildSourcePatchPreview` → `resolveSchemaManifestPath`） | 工作台「关联」页签保存的 joins 写进的是 **Schema Manifest 表节点**（`setNodeIn(tableNode, ["joins"], …)`），并把 `manual` 归一为 `formal` —— 即**产品主写路径落在 Manifest 层** |
| `webui/server/semantic-assets.ts:2554-2566` | 发布路径把 `joins` 取自 **overlay 文件内容**（overlay 是被发布的语义源） |
| `webui/server/semantic-layer.ts:182-199`（`normalizeJoin`） | `source` 只认 `manual`／`candidate`，其余落 `formal` —— `formal` 不是「overlay 专属」标记 |
| 资产实证 `semantic-layer/demo-mysql/superstore_orders.yaml:45-53` vs `semantic-layer/demo-mysql/_schema/dataforai.yaml` | 该表 2 条 `source: formal` join **只写在 overlay**，同名 Manifest 表节点**无 joins** —— 即本仓库当前资产里 Manifest 层与 overlay 层的 join 事实已经分叉 |

**对抗性反例**

1. 治理方在工作台「关联」页签给表 T 新增一条 formal join 并保存 → 落盘到 **Manifest**。若 T 同时存在 overlay 文件（当前 demo 资产就是这种形态），按 v1.1 的「冲突以 overlay 为准」，地图上 **T 的新 join 不出现**，只剩 overlay 里的旧 join；而运行时闭包（并集）**两条都算依赖**。三方读数：地图＝旧边、工作台＝新边、运行时＝两条。地图却宣称自己的口径「按运行时闭包」——**这句承诺在冲突场景下是假的**。
2. 反例二：若「冲突」被实现为**按边**仲裁（同一 `(from,to)` 下 `on` 不一致时取 overlay），则 Manifest 边被丢；若被实现为**按节点**仲裁（overlay 存在即整表覆盖），则 Manifest 里所有 join 被丢。设计稿**没有定义仲裁粒度**，两种实现都能自辩，且结论相反（边数与孤立表判定随之改变）。
3. 反例三：反向漂移也存在——REQ-0116 采纳写 **overlay**（`docs/specs/lucy-20261126-auto-join-graph-inference-spec.md:27`），工作台保存写 **Manifest**。两层会持续分叉，地图的仲裁规则必须对此有确定答案，否则每一次「保存后地图没变」都无法归因。

**必须修订**

- 把冲突规则从「overlay 为准」改为**并集保留 + 显式标注**：同一 `(from,to)` 在两层都有且 `on` 不一致时，**两条都画**（或画一条但侧栏并列列出两套 `on`），并标「Manifest／overlay 来源冲突」；**禁止**静默丢弃任一层。
- 写明仲裁**粒度**（按 `(from,to)`？按 `(from,to,on)`？按节点？）并说明与运行时并集闭包的关系（必须一致，或显式声明差异及其后果）。
- 登记落盘分叉事实：「工作台保存 → Manifest；REQ-0116 采纳 → overlay；发布取 overlay」，并给出一条写后可见性口径（地图在写后多久反映哪一层的变更）。
- §2 那句可核对说明按修订后的事实重写（见 N11）。

#### N8（重要）§1「该连接下可达 ~25–30 岛」把 site 级 Schema 总数当成单连接岛数，与 §0／`scale-baseline.md` §1.2 口径冲突

**证据**

| 位置 | 事实 |
|---|---|
| `docs/qa/uat/scale-baseline.md` §1.2 | `customer-stability` 档位口径为**全站聚合**：数据连接数 ≥10、**Schema 数 ≥30**（计数口径＝`semantic-layer/<conn>/_schema/*.yaml` 文件计数）、跨源已发现表数 ≥3500；已知客户现网参考为 **8 连接／25 Schema／2691 表**（同为全站） |
| 设计稿 §0「规模前提」行 | 引用的是同一套**全站**数字（≥10 连接／≥30 Schema／≥3500 表）——此处口径正确 |
| 设计稿 §1「四级钻取」 | 「连接（~10）→ Schema 岛总览（**该连接下可达 ~25–30 岛**）」——把全站 30 个 Schema 当成了**单个连接**的岛数 |
| 设计稿 §3 性能硬约束 | 「总览同时渲染岛卡 ≤ **40**（覆盖 **30 Schema 基线**并留余量）」——推导前提继承同一处混淆 |

**对抗性反例**

1. 按 site 级口径：10 个连接 / 30 个 Schema ⇒ **平均每连接约 3 个岛**（现网 8/25 ⇒ 约 3 个）。§1 的「每连接 25–30 岛」比真实值高一个数量级，会让实现者按「一连接一屏几十个岛卡」去设计布局与首包分片，而真实场景里连接视图只有个位数岛卡 —— **总览层的信息密度与岛内聚合策略都会被算错**。
2. 反向风险：某些连接（尤其 SQL Server／Hive 类多 Schema 源）确实可能承载数十个 Schema。届时 §3 的「岛卡 ≤40」与 §2 的「禁止静默放大到上千散点」之间出现未定义裁剪行为：岛卡超 40 时怎么裁、裁掉哪些、是否提示，稿中没有答案，而 §1 又暗示「25–30 岛是常态」——实现者会认为 40 绰绰有余，从而在真实多 Schema 连接上静默截断总览。
3. §3 的 150 表点预算同理：按 site 级每 Schema ≈110 表推导是自洽的，但稿中未写出这条推导链，验收数字来源不可追溯。

**必须修订**：统一「规模数字的层级」（全站 vs 单连接），在 §0／§1／§3 三处标明每个数字的层级；给出单连接岛数的**上界口径**（例如「单连接 Schema 数无登记上界，按连接加载时 IslandCard ≤40，超限走聚合＋提示」），并把「每岛 ≈110 表」写进 §3 作为 150 表点预算的推导依据。

#### N9（重要）跨 Schema 同名 `sourceName` 共用一份 overlay 时的**边归属**未定义（只定义了徽章）

**证据**

| 位置 | 事实 |
|---|---|
| `webui/server/semantic-identity.ts:36-40` | 模块头注释：「An overlay file is `semantic-layer/<connection>/<sourceName>.yaml` — it has **NO schema dimension**. Two schemas of the same connection that use the same source name therefore share one physical file.」 |
| `webui/server/semantic-identity.ts:271-291` | 节点身份含 `schema` 与 `sourceName`，但 overlay 读取路径**只按 `sourceName`**（`:409` 附近 `<conn>/<sourceName>.yaml`） |
| 设计稿 §0「节点身份」行 | 已写明「跨 Schema 同名共用一文件须在 UI 标注共享」；§2 节点徽章列有「共享 overlay（若适用）」——**只处理了徽章，未处理边** |
| `docs/specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md` D1/D5 | `sourceName` 唯一性只在**同一 Connection 内**强制，冲突时失败关闭；D8 说明存量资产不自动改名 —— 故「同连接跨 Schema 同名」在**存量／未重扫资产**中仍可能出现 |
| 运行时既有概念 `unselectedImpact`（`semantic-identity.ts:437-441`） | 运行时已经承认「共享同一物理 overlay 文件但未被选中」的表会被写操作连带影响 |

**对抗性反例**

1. 同连接两个 Schema 各有一张 `sourceName = orders` 的表 → 两者共用 `semantic-layer/<conn>/orders.yaml`。按 v1.1「节点级 Manifest 表节点 ∪ overlay 的 joins」读法，**同一份 overlay 里的 joins 会被算作两个节点各自的出边** → 出边重复计数、边集去重键 `(from,to,on)` 因 `from` 不同而保留两条。地图上出现「两条一模一样的边指向同一张表」，且「孤立表数」「连通团数」随实现细节漂移。
2. 反例二：若实现取「overlay 只归属给某一个节点」（例如 Schema 字典序首个），则另一张表**丧失自己的出边** → 被误判为孤立表（而运行时把它算作有依赖）。这正是 B3 用整个 §0 条款去防的那类误判。
3. 反例三：即便视觉上标了「共享 overlay」，用户看到 A、B 两张表各带 3 条边、而磁盘上只有一份 YAML 时，仍会问「这两份配置在哪」——地图没有给出答案（overlay 原文仍是 GAP，见 N3）。

**必须修订**：写死共享 overlay 情形下的边归属规则（建议：把 overlay joins 归属为「该 overlay 覆盖的全部节点共享的出边」，并在节点上标「出边来自共享 overlay」；同时把共享事实纳入孤立／连通团判定的口径说明）；并明确「overlay 原文为 GAP」在此情形下的替代核对手段。

#### N10（重要）读面范围（按连接）与判定口径（跨连接／歧义需全库索引）不匹配 —— 跨连接引用会被误判成断引用

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 §3 读面合同 | 「新增只读 API：`GET …/semantic-map/:conn`（或等价）返回**岛／团摘要＋formal 边**；表详情懒加载」——读面范围是**单连接** |
| 设计稿 §0「断引用／跨连接」行 | 「**断引用＝本连接内无法唯一解析到 Manifest 表**。跨连接可解析引用：……源节点标『外部引用 N』；**不得静默丢弃**。歧义单独呈现」——要区分「断引用／跨连接／歧义」三态，必须知道**其他连接**里是否存在同名或同限定名候选 |
| `webui/server/semantic-identity.ts:454-462`（解析合同注释）＋ `:480-500` | 运行时解析是**全库 `SemanticModelIndex`**：限定名先在**本连接**找，找不到再**跨连接**找；多候选即歧义 |
| 设计稿 §0「读面」行 | 「不直扫 YAML 绕过写屏障」＋「挂展示快照／代次缓存合同」 |

**对抗性反例**

1. 实现按 §3 只加载**本连接**的 Manifest 与 overlay 来解析 `to` → 一条 `to: other_conn.analytics.orders` 在本连接找不到 → 依 §0 定义被标成「**断引用**」。而运行时它是**可解析的跨连接依赖**。治理方据此去「清理断引用」，可能改坏一条实际生效的关联 —— **与 v1.1 明确要避免的假绿同型，只是换了触发条件**。
2. 反例二：歧义判定同理需要**跨连接候选集**；只加载本连接时，「歧义」与「断引用」不可区分，设计却要求两者「分列呈现」。
3. 反例三：若为了分类而改成全局投影（一次加载 10 连接／30 Schema／3500 表），则与 §3 的「按连接端点＋首包 ≤2MiB＋p95 ≤3s」互相拉扯：全局投影首包与单连接首包不是一回事，快照 scope 也得从 per-connection 变成 global。设计必须在两者之间做出显式选择，而不是留给实现。

**必须修订**：写明投影端点的**索引范围合同**——建议：读面仍按连接返回，但**分类所需的解析索引按全站构建**（或明确把「跨连接可解析」的判定降级为「本连接不可解析 → 一律标『外部或断引用，未判定』」并禁止在此状态下用「断引用」字样）；同时写清快照 scope 键（per-connection payload × global index）与首包预算覆盖的是**哪一段**数据。

#### N11（重要）侧栏那句「可核对说明」本身不可核对：「按运行时闭包」与运行时实现有偏差

**证据**

| 位置 | 事实 |
|---|---|
| 设计稿 §2「与 Catalog／概览同源」 | 要求地图侧栏给出**一句可核对说明**：「关联边按**运行时闭包**（Manifest＋overlay）；Catalog 列表关联数口径见其页说明」 |
| `webui/server/semantic-identity.ts:394-413` | 运行时闭包是**并集**且**不按 `source` 过滤**（candidate 来源的 join 也进 `refs`）；`normalizeJoin`（`semantic-layer.ts:182-199`）又确实承认 `source` 可为 `candidate` —— 即 YAML 中**可能**存在 `source: candidate` 的 join |
| 设计稿 §0「候选 join」行 | 地图**只画 formal**（`manual` 归一为 formal），candidate 不入边 |
| 同上 | 运行时闭包是**按被选表**计算的依赖闭包（`selected` + `dependencies` + `unselectedImpact`），**不是**一个全局边集；地图要的是全局边集 |

**对抗性反例**

1. 一张表的 overlay 里存着 `source: candidate` 的 join（`normalizeJoin` 承认这种取值；REQ-0116 的推荐在被采纳前也以候选形态出现在配置面）→ 运行时闭包把它算作依赖，地图不画 → 用户按侧栏那句「按运行时闭包」去核对会**核不上**，从而怀疑地图或运行时之一是错的。
2. 反例二：「运行时闭包」不是一个可以在 UI 上被普通治理方核对的对象（它是运行时内部的依赖集合，不对外暴露）。要求 P2 拿这句话去核对，实际不可执行 —— N4 要求的「一句可核对的话」在可执行性上落空。

**必须修订**：把该句改为**可核对的对物说明**，例如：「关联边＝**正式 join**（Manifest 与 overlay 的并集，已去重）；运行时依赖闭包另有口径（含未采纳的候选关联），二者差异见〈差异说明〉」；并在 Spec 里把 formal-only 与运行时闭包的差异写成明文口径，而不是用同一个词「运行时闭包」同时指两件事。

### 6.4 更新后的 OQ 表

| 编号 | 问题 | 当前状态 | R2 建议默认倾向 | 待裁方 |
|---|---|---|---|---|
| OQ-1 | join 事实源以哪一层为准 | 已预裁（合并）；冲突方向被 B5 判为不成立 | **改裁**：并集保留＋冲突显式标注（见 B5） | 作者 ＋ 委托人 |
| OQ-2 | 地图作用域（全量 vs 已启用） | 已预裁 | 保留；补「与概览『待补语义』只算 enabled」的差异说明（N5 残余） | 委托人 |
| OQ-3 | 跨连接引用的呈现 | 已预裁（不画边＋外部引用角标） | 保留，但须先解决判定所需的索引范围（N10） | 作者 |
| OQ-4 | 候选 join 是否上角标 | 已预裁（角标计数） | 保留；并明确「formal-only」与运行时闭包的差异文案（N11） | 委托人 |
| OQ-5 | 「查看 YAML」产物 | 已预裁（合成表 YAML；overlay 原文＝GAP） | 保留；补「合成 YAML 不含 overlay joins」的对应关系与用户可见提示（N3 残余） | 作者 |
| OQ-6 | 规模前提以哪套数字为准 | 已预裁（`customer-stability`／现网登记） | 保留；**统一层级标注**并给单连接岛数上界口径（N8） | 委托人 |
| OQ-7 | 是否挂展示快照／代次 | 已预裁（挂） | 保留；补快照 scope 键与索引范围（与 N10 联动） | 作者 |
| OQ-8 | 导航落位与最终页名 | 已预裁（提案） | 保留；须委托人 IA 独立确认 | 委托人 |
| **OQ-9**（新） | join 冲突时以哪一层为准、粒度为何 | 未裁（B5 的根问题） | 并集保留＋并列标注；粒度＝`(from,to)` 级 | 作者 ＋ 委托人 |
| **OQ-10**（新） | 投影端点的索引范围＝单连接还是全站 | 未裁（N10） | 读面按连接返回＋分类索引按全站构建；或把「断引用」字样降级为「未判定」 | 作者 |
| **OQ-11**（新） | 共享 overlay 的边归属 | 未裁（N9） | 出边归属为「共享 overlay 覆盖的全部节点」并显式标注 | 作者 |
| **OQ-12**（新） | 合成表 YAML 与地图边的对应关系如何向用户交代 | 未裁（N3 残余） | 侧栏/YAML 入口旁明写「本表关联数含 overlay 中的 join，合成 YAML 不含 joins 段」 | 作者 |

### 6.5 本轮复审的取证与边界

- 只读核查：`docs/design/design-2026-11-27-semantic-map-canvas.md`（v1.1）、本评审文件 §1–§5、`webui/server/semantic-identity.ts`（join 闭包 `:394-413`、解析合同 `:454-462`／`:480-500`、overlay 无 schema 维 `:36-40`、`unselectedImpact` `:437-441`）、`webui/server/semantic-layer.ts`（`normalizeJoin` `:182-199`、`tableYaml` `:293-318`、`applyPatch` `:774-807`、`buildSourcePatchPreview` `:836-853`）、`webui/server/semantic-assets.ts`（发布取 overlay joins `:2554-2566`）、`webui/server/display-snapshot.ts`（快照／代次／grace-stale-pending 语义）、`docs/qa/uat/scale-baseline.md` §1／§1.1／§1.2、`docs/specs/lucy-20261126-auto-join-graph-inference-spec.md`、`docs/specs/lucy-20261120-source-shortname-uniqueness-runtime-ack-spec.md` D1–D8、资产 `semantic-layer/demo-mysql/superstore_orders.yaml` 与 `semantic-layer/demo-mysql/_schema/dataforai.yaml`。
- 未执行任何写操作、脚本运行或接口调用；未改运行代码、导航与配置；本轮只更新本评审文件。
- 未复算客户现网逐连接 joins 分层占比（B1 残余）：该抽样需现场资产，Spec 前置取证任务仍有效。

---

评审方=Claude Code；轮次=R2；日期=2026-11-27；≠终稿确权

---

## 7. R2 处置回执（Cursor Agent · 2026-11-27）

设计稿已升 **v1.2**。

| 编号 | 处置 | 落点 |
|---|---|---|
| B5 | **接受** | 并集保留＋`(from,to)` 冲突并列标注；禁止静默丢层；落盘分叉对用户可见 |
| N8 | **接受** | 全站 vs 单连接数字分层；单连接岛卡≤40 超限聚合 |
| N9 | **接受** | 共享 overlay 出边归属全部共享节点并标注 |
| N10 | **接受** | 读面按连接＋全站解析索引；索引未就绪用「未判定」 |
| N11 | **接受** | 禁止称「运行时闭包」；固定 formal 并集可核对句 |
| B1–B4／N3／N5 PARTIAL 残余 | **接受** | schemaMismatch 角标；合成 YAML joins 旁注；概览待补语义差异；布局 p95；现网抽样仍推 Spec 前置（不挡设计复审） |
| OQ-9…12 | **作者预裁** | 见设计稿 §0.1 |

未改运行代码。进入 R3。

---

## 8. 第 3 轮复审（Claude Code · 2026-11-27）

| 元数据 | 内容 |
|---|---|
| 复审对象 | [设计稿](../design/design-2026-11-27-semantic-map-canvas.md) **v1.2**（版本头已确认＝v1.2；§1–§4 方向仍有效，合同细节以 v1.2 为准） |
| 复审人 | Claude Code（只读对抗评审员） |
| 复审范围 | (a) R2 的 **B5、N8–N11** 逐条关闭判定；(b) R1 中仍标 PARTIAL 的残余逐条复核；(c) v1.2 新引入条款的内部矛盾／新假绿路径扫描 |
| 效力 | **≠终稿确权／开发授权／UAT／可上线**；本轮未改任何运行代码、导航或配置，只更新本评审文件 |
| 计数 | R2 项：CLOSED **5** ／ PARTIAL **0** ／ OPEN **0**；R1 残余：CLOSED **5** ／ PARTIAL **1**（B1 取证）；**新开阻断 B6+：0**；GAP 清单 **8** 条（G1–G8，其中 0 条挡「开 Spec 起草」） |

### 8.1 结论

**ACCEPT WITH GAPS**（v1.2 可作为**功能 Spec 起草输入**；仍 **≠** 终稿确权、≠ 开发授权、≠ UAT PASS、≠ 可上线）。

一句话理由：v1.2 把 R2 的唯一阻断项（B5「冲突以 overlay 为准」）与四项重要项（N8–N11）全部转成了**可机判条款**——并集保留且禁止静默丢层、冲突按 `(from,to)` 并列标注、落盘分叉对用户可见、规模数字分层标注、共享 overlay 出边归属全部共享节点、读面按连接返回但分类索引按全站构建且索引未就绪禁用「断引用」字样、对外口径固定为「正式 join 并集」并禁用「运行时闭包」称谓——**R2 的假绿与静默丢弃路径均已封堵**；本轮逐条复核未发现新的真实阻断假绿路径，因此**不开 B6**。

留下的均为**取证／测法／条款细化类 GAP**，其中唯一可能影响验收数值可信度的是 B1 的客户现网逐连接 joins 分层抽样（须现场资产，本仓库不可得）。该抽样已由设计稿 §5.4 明确列为「Spec 前置取证任务」，按本轮约定属**允许保留的 PARTIAL**，**不挡开 Spec 起草**，但**不得**在 Spec 定稿或对外汇报中宣称「formal join 并集口径已在真实客户资产上验证」。

### 8.2 R2 关闭表（B5、N8–N11）

| 编号 | R2 关闭条件（摘要） | v1.2 落点 | 判定 | 残余 |
|---|---|---|---|---|
| **B5** | 冲突规则由「overlay 为准」改为**并集保留＋显式标注**，禁止静默丢层；写明仲裁**粒度**；登记落盘分叉事实并给写后可见性口径 | 设计稿 §0「Join 事实源」行（并集保留／禁止静默丢弃任一层；去重键 `(fromIdentity,toIdentity,on)`；同 `(from,to)` 两层 `on` 不一致→**并列保留／侧栏双列 `on`＋标「Manifest／overlay 来源冲突」，粒度＝`(from,to)`**；落盘分叉三行「工作台保存→Manifest；REQ-0116 采纳→overlay；发布读 overlay」）、§0「写后可见性」行、§0.1 OQ-1／OQ-9、§2 固定口径句 | **CLOSED** | 三处代码锚点本轮复核**与设计稿表述一致**：工作台保存写 **Manifest** 表节点且 `manual→formal`（`webui/server/semantic-layer.ts:802-807`）；发布取 **overlay** 的 `joins`（`webui/server/semantic-assets.ts:2556-2566`）；运行时依赖闭包是**两层并集且不按 `source` 过滤**（`webui/server/semantic-identity.ts:394-413`）。v1.2 未宣称与运行时等价，而是另立并公示口径（§0「地图边 vs 运行时闭包」），**B5 的根因（自相矛盾的双口径）已消除**。残余＝计数口径（见 G4） |
| **N8** | 统一「规模数字的层级」（全站 vs 单连接）；给单连接岛数上界口径；把「每岛 ≈110 表」写进 §3 作为 150 表点预算推导依据 | 设计稿 §0「规模前提」行（全站口径）、§1 四级钻取（「单连接内 Schema 数：现网常见个位数～十余；全站 Schema≥30 是跨连接合计」；「单连接岛卡硬上限 ≤40；超限聚合＋提示，**禁止静默截断**」）、§3 性能表（「**单连接**总览岛卡 ≤40（单连接 Schema 无登记上界；超限聚合＋提示）」「岛内表点 ≤150（推导：全站 ~3500 表／~30 Schema ≈110 表／岛）」） | **CLOSED** | 层级标注在 §0／§1／§3 三处齐备；§1 原「该连接下可达 ~25–30 岛」的层级错置已消失。本轮复核 `docs/qa/uat/scale-baseline.md` §1.2：Schema 计数口径＝`semantic-layer/<conn>/_schema/*.yaml` 文件计数，**确为全站**，与设计稿 §0 引用一致。残余＝「个位数～十余」未取证（G8） |
| **N9** | 写死共享 overlay 的**边归属**规则；纳入孤立／连通团判定口径；给「overlay 原文＝GAP」情形下的替代核对手段 | 设计稿 §0「共享 overlay 边归属」行（formal joins 视为**各共享节点的共同出边**，**每节点都计入连通／孤立判定**；节点与边标注「出边来自共享 overlay」；侧栏列出共享同伴；overlay 原文仍 GAP 时核对手段＝工作台关联列表＋共享同伴提示）、§0「孤立表」行（含共享 overlay 出边） | **CLOSED** | 边归属、判定口径、标注、替代核对手段四项齐备，R2 所列三种反例（重复计边／单节点独占致误判孤立／两份配置疑问）均被条款覆盖。本轮复核 `webui/server/semantic-assets.ts:2543` 的 overlay 键为 `connectionId+sourceName`（**无 schema 维**），与设计稿「同一 overlay 被多节点共享」的设定吻合。残余＝汇总计数口径（G5） |
| **N10** | 写明投影端点的**索引范围合同**；读面按连接返回、分类索引按全站构建（或把「断引用」降级为「未判定」）；写清快照 scope 键与首包预算覆盖哪一段 | 设计稿 §0「断引用／跨连接」行（**读面 payload 按连接返回；解析／分类索引按全站 `SemanticModelIndex` 构建（可缓存；计入代次）**；断引用＝全站索引下本连接内无法唯一解析；跨连接可解析→**不画边**、标「外部引用 N」；**仅有本连接索引、尚未拿到全站索引时：禁止使用「断引用」字样，统一标「外部或断引用·未判定」直至索引就绪**；歧义单独呈现）、§0「读面」行（快照 scope＝`per-conn payload × global-index generation`；**2 MiB 只约束 per-conn payload**，不含强制内联全站索引字节）、§3 首包行 | **CLOSED** | 「分类需要全局、返回按连接」的错配已由**显式选择**消除，且为「索引未就绪」留了**不造词**的安全态（「未判定」）。本轮复核 `webui/server/semantic-identity.ts:463-499`：运行时解析确为全库 `index`、先同连接后跨连接、候选>1 即歧义阻断——设计稿的分类口径与之同源。残余＝索引**陈旧于**payload 代次的判定（G3） |
| **N11** | 把「按运行时闭包」改为**可核对的对物说明**；把 formal-only 与运行时闭包的差异写成明文口径，禁止同词指两事 | 设计稿 §0「地图边 vs 运行时闭包」行（对外口径**固定**为「关联边＝正式 join（Manifest∪overlay 并集，已去重；含来源冲突标注）」；运行时依赖闭包**是另一口径**、侧栏链到差异说明；**禁止**把地图边称作「运行时闭包」）、§2 固定可核对句（补齐「Catalog『关联 N』今日可能仅计 Manifest」「运行时依赖闭包另含候选关联且按选表计算——与地图边不是同一对象」）、§0「候选 join」行（候选只作角标不入边） | **CLOSED** | 「同词指两事」已消除：正式 join 并集 vs 运行时依赖闭包被显式拆成两个对象，且给出可核对句。本轮复核 `webui/server/semantic-layer.ts:198`（`source` 仅认 `manual`／`candidate`，其余落 `formal`）、`:484`（Catalog 侧 `joinCount` 只来自 Manifest 表节点→**只计 Manifest** 的表述成立）、`semantic-identity.ts:394-413`（运行时**不按 `source` 过滤**，candidate 也进闭包→差异句成立） |

### 8.3 R1 残余（PARTIAL 项）逐条复核

| 编号 | R1/R2 残余 | v1.2 落点 | 判定 | 说明 |
|---|---|---|---|---|
| **B1** | 客户现网逐连接「joins 在 Manifest／overlay／冲突」占比抽样（唯一未做的是**现场取证**，不是条款） | 设计稿 §5 第 4 条（列为「Spec 前置取证任务」） | **PARTIAL（取证类，不挡开 Spec）** | 合同面已于 v1.2 闭合（并集保留＋禁止只读 Manifest＋formal-only＋冲突并列）。抽样需现场资产，本仓库不可得，按本轮约定允许保留。**约束**：Spec／UAT 不得引用「已验证」措辞，直到抽样产出 |
| **B2** | SQL Server 三段名 `db.schema.table` 与 `schemaMismatch` 展示规则未写死；共享 overlay 只定义徽章未定义边 | §0「节点身份」行（三段名**岛分组仍按 Manifest 所属 Schema**；`schemaMismatch` 时节点角标「物理名与 Schema 声明不一致」，**不以物理前缀改岛**）；共享 overlay 边归属见 §0 | **CLOSED** | R1「必须修订」第 4 条已逐字落地；共享 overlay 的边归属转入 N9 项下亦已 CLOSED |
| **B3** | `schemaMismatch` 呈现未写；判定口径需全库索引而读面只写「按连接」 | §0「节点身份」行（角标规则）；§0「断引用／跨连接」行（全站索引＋未就绪禁用「断引用」字样） | **CLOSED** | 两项残余均已落地 |
| **B4** | 缺布局计算时延上限；缺「每岛 ≈110 表」推导链 | §3 性能表（岛内团布局计算 **p95 ≤ 1s**，标注「设计目标；Spec 冻结测法」；150 表点预算推导链写在同一行） | **CLOSED** | 推导链与时延上限齐备；「Spec 冻结测法」的挂账方式符合设计阶段定位 |
| **N3** | 合成表 YAML 与地图口径的对应关系（哪些键会出现在地图徽章里）未向用户交代 | §0「钻取 YAML」行（次入口＝「查看合成表 YAML」，旁注「**合成 YAML 不含 overlay 中的 joins 段；地图关联数可能大于本 YAML 可见 joins**」；overlay 原文／整份 Manifest＝GAP） | **CLOSED** | 落差已对用户可见地交代 |
| **N5** | 未说破「概览『待补语义』只算 enabled」与地图全量「未完成数」的差异 | §0「作用域」行（**与概览差异须明示**：概览「待补语义」只统计 **enabled** 且 `completion!=done`；地图全量「未完成」数**不得**表述为同一指标）、§2 末（汇总数带作用域） | **CLOSED** | 差异已说破并给了禁止性表述 |
| **C1–C4** | 深链／返回路径、IA 事实表与索引登记、验收与 UAT 台账 | §1（深链参数 `conn`/`schema`/`cluster`/`table`＋非法参数降级）、§0.1 OQ-8＋§4（IA 独立确认才可改 `navigation.ts`）、§5.2（立项时登记 UAT 套件占位） | **PARTIAL（按阶段设计，预期内）** | 深链与 IA 条款已闭合；UAT 套件完整台账与术语标准登记按设计稿自身安排落在 Plan／Spec 阶段，**属阶段设计而非遗漏**，不挡开 Spec |

### 8.4 本轮新发现

**未发现新的真实阻断假绿路径，不开 B6+。**

理由（对抗性自检）：v1.2 的核心路径是「按连接取 payload → 用全站索引分类 → 并集去重 → 无向连通团／孤立判定」。本轮针对该链路的每一环都构造了失败注入：①只有本连接索引 → 被「禁止使用『断引用』字样／统一标『外部或断引用·未判定』」拦截；②两层 `on` 冲突 → 被「并列保留＋双列 `on`＋冲突标注」拦截，不会静默丢边；③工作台刚保存到 Manifest 的 join → 被「并集保留」接住，不会因 overlay 存在而消失（B5 假绿路径已闭合）；④共享 overlay → 被「共同出边＋显式标注」拦截，不会出现两份互不相干的配置事实；⑤单连接 Schema 超限 → 被「≤40 且超限聚合＋提示、禁止静默截断」拦截，不会静默丢岛；⑥读失败／部分可见 → 被 §3 五态与「不得用 0 边冒充真空」拦截。以上六条均未找到「页面正常、结构结论相反」的静默路径。剩余 GAP 均为**条款细化／测法／取证**类，可在 Spec 内一次性收口。

### 8.5 GAP 清单（ACCEPT WITH GAPS 的具体内容）

| 编号 | GAP | 是否挡「开 Spec 起草」 | 收口位置 |
|---|---|---|---|
| **G1** | 客户现网逐连接「joins 在 Manifest／overlay／两层冲突」占比抽样未做（B1 残余） | **否**（取证类，按约定可留 PARTIAL） | Spec 前置取证任务；产出入证据后方可写「已验证」 |
| **G2** | 引用解析细则在设计稿中以「与 `semantic-identity.ts` 对齐」的**指针**形式存在，未逐条写死（裸名**仅**本连接解析／限定名先本连接后跨连接／同连接多候选＝歧义阻断／物理 `table:` 前缀不参与 Schema 判定） | 否 | Spec 逐条抄录为条款（否则实现者自选规则即产生新的口径分叉） |
| **G3** | **索引代次落后于 payload 代次**时的判定未定（设计稿只写了「索引未就绪」的安全态，未写「已就绪但陈旧」）。此态下可产生与 N10 同型的假绿——新表引用按旧索引判成「断引用」 | 否（但 Spec 必须写） | Spec 明确「payload 代次 > index 代次 ⇒ 一律用『未判定』，禁用『断引用』字样」 |
| **G4** | 冲突并列保留时的**边计数口径**：地图按 `(from,to,on)` 去重，运行时按 `to` 去重（`semantic-identity.ts:396/412`），同一 `(from,to)` 双 `on` 时地图边数 2、运行时依赖数 1 | 否 | Spec 定义「关联边计数」与「运行时依赖数」两个数各自的语义，并在差异说明里点出该具体差异 |
| **G5** | 共享 overlay 的共同出边会让同一物理 join 在多个节点上重复计入**边数／孤立数／团数**的口径 | 否 | Spec 定义汇总口径（按边去重后计／按共享文件计），与「出边来自共享 overlay」标注保持一致 |
| **G6** | 「孤立表区」判定不含跨连接引用（§0 明确不画跨连接边）→ **仅有跨连接依赖的表会计入孤立区**，尽管其节点带「外部引用 N」角标 | 否 | Spec 要求：孤立区节点必须同屏可见外部引用角标；**禁止**把孤立表数表述为「无任何依赖」 |
| **G7** | 术语标准登记（§4 已列词表）与 UAT 套件台账（`UAT-SUITE-…`）按设计稿自身安排落在 Spec／Plan 阶段 | 否 | Spec／Plan |
| **G8** | §1「现网单连接 Schema 数常见个位数～十余」**未取证**：登记基线只有全站口径（25 Schema／8 连接 ⇒ 平均约 3），「十余」无证据 | 否（但不得当验收假设） | Spec／UAT 前抽样逐连接 Schema 分布；基线更新时同步修订 §1 措辞 |

### 8.6 建议委托人下一步

1. **确认 §0.1 的作者预裁**（OQ-1／9 并集＋冲突并列标注；OQ-3／10 读面按连接＋全站索引＋未就绪用「未判定」；OQ-11 共享 overlay 出边归属；OQ-5／12 合成 YAML 旁注；OQ-2 作用域；OQ-4 候选只作角标；OQ-6 规模口径；OQ-7 挂展示快照；OQ-8 IA 独立确认）。设计稿状态行已标「作者预裁，待委托人确认」——**未确认前 v1.2 不得当终稿输入**。
2. **授权开功能 Spec（REQ-0121）**：v1.2 已满足开 Spec 门槛（无未闭阻断）。Spec 必须吸收 **G2／G3／G4／G5／G6** 五条条款化收口，并同时登记术语（G7）与 UAT 套件占位。
3. **并行启动 G1 现网抽样取证**（不挡 Spec 起草，但须与 Spec 起草并行，否则 Spec 定稿时「formal join 并集口径」仍处不可证状态）。
4. **IA 变更单独立项确认**（OQ-8／`navigation.ts`）——不要与「开 Spec 授权」混为一次授权；正式挂导航须委托人另行独立确认。
5. **开发授权仍需终稿确权**：本轮结论是 ACCEPT WITH GAPS，只表示「可以开 Spec」，**不表示**可以改运行代码、可以进 Plan 执行或可以宣称 UAT PASS。

### 8.7 本轮取证与边界

- 只读核查：`docs/design/design-2026-11-27-semantic-map-canvas.md`（v1.2 版本头与全文）、本评审文件 §1–§7、`webui/server/semantic-identity.ts`（join 并集读法 `:394-413`、解析合同 `:454-462`／`:463-499`）、`webui/server/semantic-layer.ts`（`normalizeJoin` `:198`、`modelFromTable` 侧 `joins` 来源 `:484`、Catalog `joinCount` `:659`、`applyPatch` 写 Manifest 且 `manual→formal` `:802-807`）、`webui/server/semantic-assets.ts`（发布取 overlay `joins` `:2556-2566`、overlay 键无 schema 维 `:2543`）、`docs/qa/uat/scale-baseline.md` §1.2（Schema/表数计数口径）。
- 未执行任何写操作、脚本运行或接口调用；未改运行代码、导航与配置；本轮只更新本评审文件。
- 未复算 G1 的现网逐连接 joins 分层占比（需现场资产，仓库内不可得）。

---

评审方=Claude Code；轮次=R3；日期=2026-11-27；≠终稿确权

---

## 9. 三轮过程总结（Cursor Agent）

| 轮次 | 结论 | 要点 |
|---|---|---|
| R1 | REQUEST CHANGES | B1–B4（join 层／身份／孤立机判／规模数字） |
| R2 | REQUEST CHANGES | B5（冲突丢层）＋N8–N11；R1 多项 PARTIAL |
| R3 | **ACCEPT WITH GAPS** | B5／N8–N11 CLOSED；B1 现网抽样 PARTIAL；GAP G1–G8 不挡开 Spec |

**效力重申**：三轮均为过程评审（Claude Code）。**≠** Codex CLI 终稿确权、**≠** 开发授权、**≠** UAT、**≠** 可上线。设计稿维持 v1.2；开 Spec 前须委托人确认 OQ。
