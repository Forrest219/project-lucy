# 语义地图（Semantic Map Canvas）设计稿

| 元数据 | 内容 |
|---|---|
| 文档类型 | 设计稿（Design）；定稿后另开功能 Spec／落地 Plan；**不构成**开发授权 |
| 版本 | **v1.2**（按 Claude Code R1＋R2 对抗评审修订；§1–§4 方向仍有效，合同细节以本版为准） |
| 日期 | 2026-11-27 |
| 委托人 | xingchen |
| 方案 | **方案 1** — 独立只读「语义地图」页；YAML 投影；Schema 岛 → 连通团 → 表钻取 |
| 需求池 | [`REQ-0121`](../backlog/entries/REQ-0121-semantic-map-canvas.md) |
| 对抗评审 | [`docs/reviews/2026-11-27-semantic-map-canvas-adversarial-review.md`](../reviews/2026-11-27-semantic-map-canvas-adversarial-review.md) |
| 状态 | **v1.2**；Claude Code 三轮 ACCEPT WITH GAPS。委托人 2026-11-27 **授权 Spec 定稿**（§0.1 OQ 同批确认）→ Spec／Plan／UAT v1.0。**仍 ≠ 开发授权**；正式挂导航须 IA 独立确认 |

## 0. 已裁定决策

| 议题 | 裁定 |
|---|---|
| 本质 | **YAML／语义层配置的只读可视化投影**，不是知识图谱产品，不另建图库 |
| 与单表页关系 | **不抢**现有表单式表工作台；精细查阅与修改仍走工作台（表单／粘贴导入／文件外编辑 YAML） |
| 修改路径 | Canvas **只做查看、筛选、钻取**；**无写 API** |
| 宏观组织 | **Schema 岛**为默认分区；岛内再按 **formal join 无向连通团**聚类；孤立表单独成区 |
| 规模前提 | 对齐仓库登记基线：设计／验收以 **`customer-stability`：≥10 连接／≥30 Schema／≥3500 已发现表、容器 ≤2C／2Gi** 为压力上限；客户现网参考 **8 连接／25 Schema／2691 表**（见 `docs/qa/uat/scale-baseline.md` §1.2）。禁止一次平铺全表散点 |
| 产品形态 | **独立页**（方案 1） |
| Join 事实源（R1-B1／R2-B5／OQ-1／OQ-9） | **Manifest∪overlay 的 formal joins 并集保留，禁止静默丢弃任一层**。仅 `source=formal`（及 `manual`→formal）**入边**；candidate **不入边**。去重键＝`(fromIdentity, toIdentity, on)`。同一 `(fromIdentity, toIdentity)` 两层 `on` 不一致时：**并列保留／侧栏双列 `on`，并标「Manifest／overlay 来源冲突」**（粒度＝`(from,to)`）。落盘分叉事实须对用户可见：工作台保存→Manifest；REQ-0116 采纳→overlay；发布读 overlay。**不得**只读 Manifest |
| 节点身份（R1-B2） | `(connectionId, schema, sourceName)`；主标签默认 `sourceName`；`qualifiedName`＝物理 `table:`。**SQL Server 三段名** `db.schema.table`：岛分组仍按 Manifest 所属 Schema；`schemaMismatch` 时节点角标「物理名与 Schema 声明不一致」，**不以物理前缀改岛**。Overlay 路径＝`semantic-layer/<conn>/<sourceName>.yaml` |
| 共享 overlay 边归属（R2-N9／OQ-11） | 同一 overlay 文件被多节点共享时：其中 formal joins 视为**各共享节点的共同出边**（每节点都计入连通／孤立判定），节点与边标注「出边来自共享 overlay」；侧栏列出共享同伴。overlay 原文仍为 GAP 时，核对手段＝工作台关联列表＋共享同伴提示 |
| 「未语义化」（R1-B2） | **复用** `completion != done`。可选筛「无 overlay 文件」**必须**单独命名，且 UI 注明「≠未完成语义；与概览待补语义无关」 |
| 引用解析（R1-B3） | 与 `semantic-identity.ts` 对齐。Schema 岛＝Manifest 所属 Schema |
| 孤立表（R1-B3） | 合并 formal 边集（含共享 overlay 出边）的无向图上，入度与出度皆 0 |
| 断引用／跨连接（R1-B3／R2-N10／OQ-3／OQ-10） | **读面 payload 按连接返回**；**解析／分类索引按全站 SemanticModelIndex 构建**（可缓存；计入代次）。断引用＝全站索引下本连接内无法唯一解析。跨连接可解析：**不画边**，标「外部引用 N」。仅有本连接索引、尚未拿到全站索引时：**禁止**使用「断引用」字样，统一标「外部或断引用·未判定」直至索引就绪。歧义单独呈现 |
| 作用域（R1-N5／OQ-2） | 默认全量 Manifest＋启用标记；可切「仅已启用」。汇总数标作用域。**与概览差异须明示**：概览「待补语义」只统计 **enabled** 且 `completion!=done`；地图全量「未完成」数**不得**表述为同一指标 |
| 候选 join（R1-N4／OQ-4） | 不入边；可选角标「待采纳推荐 N」 |
| 地图边 vs 运行时闭包（R2-N11） | 对外口径固定为：**「关联边＝正式 join（Manifest∪overlay 并集，已去重；含来源冲突标注）」**。运行时依赖闭包（可含 candidate、按选表计算）**是另一口径**，侧栏链到差异说明，**禁止**把地图边称作「运行时闭包」 |
| 钻取 YAML（R1-N3／OQ-5／OQ-12） | 主钻取＝打开工作台。次入口＝「查看合成表 YAML」，旁注：**「合成 YAML 不含 overlay 中的 joins 段；地图关联数可能大于本 YAML 可见 joins」**。overlay 原文／整份 Manifest＝GAP |
| 读面（R1-N1／OQ-7） | 按连接投影端点＋**全站解析索引**；挂展示快照／代次；跳过授权计数；不直扫 YAML 绕过写屏障。快照 scope＝`per-conn payload × global-index generation`；首包 ≤2MiB 约束的是 **per-conn payload**，不含强制内联全站索引字节 |
| 写后可见性 | 写屏障结束后，下一成功快照代次须反映并集边；冲突标注随两层内容更新 |
| 与访问关系图 | 正交；术语不混用 |
| 与本体化／REQ-0118 | 不引入本体引擎；不依赖元数据入库 |

### 0.1 作者预裁的 OQ（待委托人确认；未确认前 Spec 不得当终稿）

| OQ | 预裁 |
|---|---|
| OQ-1／OQ-9 | 并集保留；`(from,to)` 级冲突并列标注；禁止静默丢层 |
| OQ-2 | 默认全量＋启用标记；明示与概览「待补语义」差异 |
| OQ-3／OQ-10 | 不画跨连接边；外部引用角标；读面按连接＋全站索引；索引未就绪用「未判定」 |
| OQ-4 | 候选只作角标 |
| OQ-5／OQ-12 | 合成表 YAML＋joins 缺口旁注；overlay 原文＝GAP |
| OQ-6 | 规模以登记基线为准；数字分「全站／单连接」标注 |
| OQ-7 | 挂展示快照；scope 如上 |
| OQ-8 | IA 独立确认 |
| OQ-11 | 共享 overlay 出边归属全部共享节点并标注 |

## 1. 定位、入口与层级

**一句话**  
语义地图是治理方（P2）在「多连接 × 多 Schema × 近三千～三千五百表」下，对**表级语义配置**做宏观理解与定位的只读投影；配置权威仍是磁盘 YAML，维护手段仍是现有工作台路径。

**何时用地图／何时用工作台（R1-N4）**

| 问题类型 | 去哪 |
|---|---|
| 「这个连接／Schema 里表怎么成团？谁孤立？哪里断引用？」 | **语义地图** |
| 「这一张表的 grain／指标／字段／关联怎么改？」 | **表工作台**（及粘贴导入／文件外 YAML） |
| 「谁被授权访问这些表／实际访问路径？」 | **访问关系图**（非本页） |

**入口（提案，未改导航）**

- 路由提案：`/semantic-map`（最终页名／分组待 OQ-8 IA 确认）。
- 先选连接；深链：`conn`（必填）、`schema`、`cluster`、`table`（可选）；非法参数降级到上一合法层并提示。
- Catalog／工作台可链「在地图中查看」（M3）；不替代 Catalog 列表心智。

**四级钻取**

```
连接（全站约 ≥10；先选一连接）
  → Schema 岛总览（**单连接**内 Schema 数：现网常见个位数～十余；全站 Schema≥30 是跨连接合计。
     单连接岛卡硬上限 ≤40；超限聚合＋提示，禁止静默截断）
    → 岛内：连通团 + 孤立表区（表点默认折叠进团；全站均摊约 ~110 表／Schema，作 150 表点预算推导）
      → 表：侧栏摘要 →「打开工作台」／「查看合成表 YAML」（含 joins 缺口旁注）
```

**做／不做**

| 做 | 不做 |
|---|---|
| 查看拓扑与分组、筛选、钻取 | 画布改 join／grain／指标；任何写盘 |
| 跨 Schema 弱边；跨连接外部引用角标 | 默认跨连接一张巨图；知识图谱推理 |
| 与 Catalog 完成度／启用标记可解释对齐 | 与访问关系图合并；把 candidate 画成边 |

## 2. 画布信息、筛选与同源口径

**数据源**  
按连接构建只读投影：Manifest 表集合＋（Manifest∪overlay）formal joins＋overlay／Manifest 的完成度字段摘要。布局会话内计算，不落盘。

**节点**

| 层级 | 节点 | 可见信息 |
|---|---|---|
| Schema 总览 | Schema 岛 | 岛名、表数（标作用域）、连通团数、孤立表数、启用表占比 |
| 岛内 | 连通团 | 团内表数；展开后露表点 |
| 表 | 表点 | 主标签＝`sourceName`（消歧时加 schema／qualifiedName）；徽章：启用／完成度／formal 边有无／外部引用 N／待采纳推荐 N（可选）／共享 overlay（若适用） |
| 选中 | 侧栏 | completion、grain／指标／分群摘要、formal 关联列表（含跨 Schema）、外部引用、钻取按钮 |

**边与筛选**

- 同 Schema 实线；跨 Schema 弱线＋计数。
- 筛选：关键字；仅孤立；仅 `completion!=done`；仅断引用；仅未启用（可选）；清除。
- **筛选结果仍受节点预算约束**（超限保持团聚合／分页／强制搜索，禁止静默放大到上千散点）。

**与 Catalog／概览同源（R1-N4／N5／R2-N11）**

- 完成度：与 Catalog／概览同一 `completion` 口径。
- 关联边可核对句（固定）：「**关联边＝正式 join（Manifest∪overlay 并集，已去重；冲突并列标注）。Catalog『关联 N』今日可能仅计 Manifest；运行时依赖闭包另含候选关联且按选表计算——与地图边不是同一对象。**」
- 汇总数带作用域；全量「未完成」≠ 概览「待补语义」（后者仅 enabled）。

## 3. 交互、读面、状态与性能

**主路径**  
选连接 → 岛总览 → 进岛看团／孤立区 → 搜索或展开到表 → 侧栏 → 打开工作台。

**读面合同（R1-N1）**

- 新增只读 API（名待 Spec）：`GET …/semantic-map/:conn`（或等价）返回岛／团摘要＋formal 边；表详情懒加载。
- 挂展示快照／代次；写窗口／busy 遵循既有 display-snapshot 语义。
- 跳过授权计数编译。

**状态与降级（R1-N2）**  
至少：正常／加载中／数据可能不是最新（含刷新，复用 `DisplayDegradedNotice` 与术语 §4.6.1）／读取失败（可归因，**不得用 0 边冒充真空**）／空（真无表）／部分可见（单岛失败时该岛失败态＋汇总数标不完整）。

**性能硬约束（对齐 2C／2Gi · R1-B4）**

| 规则 | 合同 |
|---|---|
| 永不一次画全库表点 | 默认岛；岛内默认团 |
| 单屏预算 | **单连接**总览岛卡 ≤ **40**（单连接 Schema 无登记上界；超限聚合＋提示）；岛内表点 ≤ **150**（推导：全站 ~3500 表／~30 Schema ≈110 表／岛）；筛选命中同样受约束 |
| 首包 | **per-conn payload** ≤ **2 MiB**；全站解析索引可另缓存，不计入该 2 MiB 内联预算，但须有代次与失效 |
| 可交互 | 2C／2Gi 下连接总览可交互 **p95 ≤ 3s**；岛内团布局计算 **p95 ≤ 1s**（设计目标；Spec 冻结测法） |
| 布局 | 岛稳定分区；团一次性布局可会话缓存 |
| 超时／超预算 | 强制团聚合＋明确提示，禁止假空图 |

## 4. 范围切片、风险、术语与画像

**切片**

| 切片 | 内容 |
|---|---|
| M1 | 单连接投影端点＋岛／团／孤立＋侧栏＋打开工作台＋合成 YAML＋搜索；join 双层合并 |
| M2 | 筛选（孤立／未完成／断引用／作用域）＋跨 Schema 弱边＋外部引用角标＋深链／面包屑＋降级态 |
| M3 | Catalog／工作台互链、多连接切换、性能门禁、候选推荐角标（若 OQ-4 确认） |

**风险**  
假绿（只读 Manifest）、规模名单化、与 Catalog 口径 silently 不一致、第二套读路径绕过快照——均由 §0／§2／§3 合同约束。

**术语（R1-N7）**  
Spec 阶段登记：「语义地图」「Schema 岛」「连通团」「孤立表区」「断引用」「外部引用」；禁止与「访问关系图」混称。设计阶段沿用上述中文工作名。

**受影响画像（R1-N6）**

| 画像 | 判定 | 变更前 | 变更后 | 可核对依据 |
|---|---|---|---|---|
| P2 治理方 | `↑` | 近三千表靠 Catalog 翻页或读 YAML，难见跨表拓扑 | 按连接／Schema／团定位；孤立与断引用可筛 | SC 占位：在 ≥30 Schema／≥3500 表夹具上，搜索表名 ≤3s 钻到侧栏；孤立／断引用筛选项与双层 formal 边集一致 |
| P1 问数方 | `＝` | MCP 问数主路径 | 不变 | 本需求无 MCP／ACL 写变更 |
| P3 运维方 | `＝` | 部署／健康 | 不变 | 无 Helm／探针合同变更 |
| P4 管理层 | `＝` | 不直接操作 | 不把地图汇总数默认为对外覆盖率 KPI（须标作用域） | 文案禁止把「全量 Manifest 未完成数」表述成「已启用覆盖率」 |

## 5. 下一步（非本文件授权）

1. 委托人确认 §0.1 全部 OQ 预裁。  
2. 授权开功能 Spec＋Plan时，须吸收评审 §8 GAP **G2–G6**（解析细则逐条入合同、索引代次与「断引用」字样、冲突边计数、共享 overlay 汇总数、孤立区与外部引用同屏）；**G1** 现网 joins 分层抽样并行取证（不挡开 Spec，挡「formal 边集已在现网充分取证」类主张）。  
3. IA 独立确认后再改 `navigation.ts`；术语登记与 UAT 台账按阶段落（G7）。  
4. 获终稿确权与**开发授权**后方可改运行代码。  

## 关联

- 需求池：[`REQ-0121`](../backlog/entries/REQ-0121-semantic-map-canvas.md)  
- 评审：[`2026-11-27-semantic-map-canvas-adversarial-review.md`](../reviews/2026-11-27-semantic-map-canvas-adversarial-review.md)  
- 规模：[`docs/qa/uat/scale-baseline.md`](../qa/uat/scale-baseline.md)  
- 相邻：REQ-0116、REQ-0118、访问关系图、挂起本体化提案  
- 实现锚点：`webui/server/semantic-identity.ts`（join 闭包）、`webui/server/semantic-layer.ts`（completion／合成 YAML）
