# 访问关系图使用量优先呈现 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 呈现修订 / **v0.4.2** |
| 日期 / 目标版本 | 2026-11-05 / 不绑定产品版本号。不升 Spec 187 版本号 |
| 功能编号 / 优先级 | **无** / **P1**。不进入 v0.25 登记册 |
| 状态 | **v0.4.2 可交付开发（2026-11-05）**。故事线合并后 Codex 三轮完成；F06 附条件已补（深链映射＋SC-29）。用户授权定稿后开工；**不 Docker 重建**；收尾 Code Review。本条收口不表示可上线 |
| 决策来源 | 故事线合并后三轮对抗；第 3 轮可定稿附条件（F06 深链须验目标页生效） |
| 需求来源 | 运维经理用桑基图做使用观察与收权优化（数据运营），不是权限百科 |
| 实施主体 | `AccessMapCanvas`／`AccessMapLegend`／`AccessMap.tsx`；`webui/server/admin/access-map.ts`（折叠受害序、`agent=` 重投影、可选投影 meta）；测试与文档指针。不改 KTX；边状态机不变；允许只读 meta 增补 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | 再修订 geometry 计量；187 语义字段不变；idle-grant-copy 悬停用语不变（聚合示意另定清单交互）；chart-first 页壳不变 |
| 实施计划 | [`docs/plans/lucy-20261105-access-map-usage-first-plan.md`](../plans/lucy-20261105-access-map-usage-first-plan.md) |
| 审阅记录 | [`docs/reviews/2026-11-05-codex-review-access-map-usage-first.md`](../reviews/2026-11-05-codex-review-access-map-usage-first.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：§1 故事 S1–S9 成立（含同筛选用量对账、筛选／悬停支撑 S6–S8）；柱高／有使用流宽按访问路径；画布不被闲置扇出压缩；闲置经端点示意＋清单可达；图例使用优先。
- 本条出口：SC-01–SC-30。
- 不在本条出口：浏览器 E2E、镜像、Docker 重建、部署、改边状态机、KPI 墙、`accessCalls` 几何守恒、已打开访问日志页的实时双向同步；不重开 audit-echo／hourly-detail 已收口 SC 分母。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None as a new product concept. 聚合示意 UI 可用「闲置授权 N 条」（非新 Canonical）。

| 控件 | 文案 |
|---|---|
| 图例 1 | 流带宽度 = 访问路径数 |
| 图例 2 | 闲置授权 = 端点细空心示意（不撑柱／不进列） |
| 图例 3–4 | 虚线 = 需复核；实线 = 确凿越权 |

Forbidden：图例「流带宽度 = 授权路径数」；闲置表按张进列撑高／压刻度。

---

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/01-foundations-color.md`
- `webui/docs/design-system/99-governance.md`
- geometry／quiet-reading／chart-first／idle-grant-copy

### What This Change Follows

- [ ] 计量与命中解耦；无裸 hex；状态非仅颜色
- [ ] 图例四项；无 KPI 墙
- [ ] 闲置清单交互可读

### Exceptions (If Any)

- geometry 授权主厚度与「全量节点进列」在使用优先下由本条覆盖；S3 指针。
- 单边悬停三段式仍属 idle-grant-copy；**聚合示意**悬停／清单见本条 §5.5。

### Follow-up Needed

- Plan S3 文档指针。

---

## 1. 桑基可读故事线（Normative · 数据分析核心）

> **本条先定「用户在图上读到什么故事」，再定几何怎么画。**  
> 几何（§5）是故事的编码手段；若编码妨碍故事，以本节为准回改呈现，而不是堆更多信息。

### 1.1 一句话目的

运维经理打开访问关系图，要在**一张桑基图**上读完数据运营故事：

**谁（Agent）→ 凭哪张角色牌 → 落到哪个连接／表 → 统计窗口内真实用了多少 → 对照授权后决定留／收／查。**

从黑盒运维变成可读运维：先看使用，再对照闲置与异常，而不是先被授权面「胖子柱」带跑。

### 1.2 四列是一条因果链，不是四把比高尺子

| 列 | 在故事里的角色 | 用户应读到的问题 |
|---|---|---|
| Agent | 主人公 | 谁在产生数据面活动？ |
| 角色 | 权力来源 | 活动归因到哪张角色牌？ |
| 连接 | 落点域 | 用到了哪条数据连接？ |
| 表 | 落点实体 | 具体碰了哪些表？（**仅使用活跃表进画布**） |

流带从左到右＝同一条访问故事的展开；**柱高／流宽比较的是使用量（访问路径）**，不是授权路径谁更大。

### 1.3 图上必须能读出的故事（验收叙事）

下列故事是功能合同的一部分：实现后运维经理应能**不查百科、不先读长文**，只靠图＋轻量悬停／清单读完。

| ID | 故事名 | 用户在桑基上看到什么 | 读完应能说出的结论 | 编码要点 |
|---|---|---|---|---|
| S1 | **使用主线** | 粗实心流带连接 Agent→角色→连接→表；越厚＝窗口内访问路径越多 | 「这些主体／表在被用，用量相对关系是这样」 | 厚度＝`accessPaths`；副标／悬停补调用次数 |
| S2 | **相对谁更忙** | 同列节点高低可比较（使用活跃节点之间） | 「何老师 vs 张星辰，谁在本窗口更活跃」 | 柱高只计使用；禁止授权撑高 |
| S3 | **闲置／过宽对照** | 使用带旁边或端点有**细空心示意**，不抢主视觉；点开是闲置授权清单（表名在清单里，不铺满表列） | 「还有一大片授权窗口内没用上，可考虑收权」 | 闲置表不进列；stub→清单 |
| S4 | **需复核／确凿越权** | 虚线中线＝需复核；danger 实线＝确凿越权（或等价既有非颜色编码） | 「有使用但对不上当前授权／当时也不覆盖，要查」 | §5.3 矩阵；不靠颜色独辨 |
| S5 | **筛选后的运营切片** | 问询种类／访问等级只收缩**访问主线**；故事仍是 S1–S4／S6–S8，不是另一套百科 | 「在当前运营切片下，谁还在用、闲置仍多少」 | 不改筛选语义；几何仍使用优先 |
| S6 | **选中连接反查上游** | **持久**选中连接（写入 `focus=` 连接节点或 `connection=`）后，连通使用子图可读：哪些 Agent／角色流向该连接 | 「这个连接是谁在用」 | `focus`／`connection` 子图；**不得**用 `focus=agent` 冒充 S8 |
| S7 | **打开即见高频居首** | 全图各列：使用最高者在列顶；折叠不得先吃掉最热表名 | 「最热的一眼在顶上」 | 列序＝`accessPaths` 降序；折叠受害序＝使用优先（§5.8） |
| S8 | **单 Agent 行为轨迹** | **仅** `agent=`（工具条或点击 Agent 写入）后，整图为该 Agent 轨迹；共享角色／连接上的路径／调用须按该 Agent **重投影重算** | 「这个人怎么走数据面」 | 禁止用双向 `focus` 冒充；见 §5.1.1 |
| S9 | **同筛选用量呼应（日指标）** | 区分结构筛选前集合 **E** 与当前投影 **P**；图与数据表对 **P** 的允许调用 ID 集合一致；无结构筛选时 \|P\|=\|E\| | 「图与指标讲同一事实」 | §1.8；禁止拿 \|E\| 去对结构筛选后的表总数 |

### 1.4 示例走读：何老师（必须成立）

在 demo 同构（`hehe`／何老师 ← `lucy_admin` ← `demo-mysql`，角色常为 `catalog_bound` 宽授权）且窗口内使用远小于授权面时，用户从左到右应读到：

1. **Agent 列**：何老师柱高反映**其使用**，不得因 catalog 摊开的巨量授权而独高。
2. **角色列**：看到 `lucy_admin` 是权力来源（标签可读）；角色柱高同样跟使用走。
3. **连接／表列**：只突出**窗口内真正碰到的表**；未用到的授权表不占满表列。
4. **对照**：何老师（或角色／连接）端点细空心 → 清单里才是「还有哪些表闲置」——故事收束为「牌很大、用很少 → 收权候选」，而不是「柱子很高所以很重要」。

若用户第一眼仍觉得「何老师最高＝授权最大」，本条呈现失败。

### 1.4.1 续例：选中连接／高频居首／单人轨迹

| 故事 | 走读 |
|---|---|
| S6 | 点击连接 `demo-mysql`（focus）→ 图收成「谁连到这条连接」：可见何老师／张星辰等 Agent 与其角色，而不是只剩连接孤岛 |
| S7 | 打开全图 → 表列最顶是本窗口访问路径最多的表；角色列／连接列同理；用户不必滚动找「谁最热」 |
| S8 | 工具条选 Agent「何老师」或点击该柱写入 `agent=hehe`（非 focus）→ 行为链；共享连接上不得残留他人路径计量 |
| S9 | 无结构筛选：图披露 \|E\|＝数据表允许调用去重总数。筛 `agent=hehe` 后：双方对 **P_hehe** 的允许调用 ID 集合相等（不是拿全局 \|E\| 去对表） |

### 1.5 故意不讲的故事（防百科回潮）

| 不在桑基主视觉讲 | 原因 |
|---|---|
| 按授权路径比谁权大 | 数据分析核心是使用与收权，不是授权排行榜 |
| 画布铺开全部已授权表 | 淹没使用主线；压刻度 |
| 同时用几何精确表达授权量＋调用量双守恒 | 双尺度硬拗；调用留副标／悬停 |
| KPI 卡／信号墙抢第一眼 | chart-first；故事在图上 |
| 按授权量决定列内顺位 | 第一顺位只服务使用频率故事（S7） |
| 图与数据表各用一套数 | 破坏 S9 |
| 已打开访问日志页实时跟着改 | 过宽；跨页只做同条件深链对照 |

### 1.6 与几何／交互章节的关系

- §1＝故事；§1.7＝交互最低条；§1.8＝E／P 对账；§5＝画法与折叠／重投影。
- URL 锚点沿用 Spec 187；用量投影沿用 audit-echo／hourly-detail。
- 冲突时先保故事，再改编码（同步 SC）。

### 1.7 筛选器与悬停联动（Normative · 支撑 S6–S8）

区分两种交互：

| 种类 | 定义 | 是否满足「最低条」 |
|---|---|---|
| **持久筛选** | 写入 URL（`agent=`／`connection=`／`focus=` 等），刷新可复现；可清除 | **S6／S8 最低必备** |
| **悬停预览** | 不写 URL 的临时高亮 | **可选增强**，单独不满足最低条 |

| 场景 | 持久筛选（必备） | 悬停预览（可选） |
|---|---|---|
| S6 | 工具条／定位／**点击连接** → 写 `focus=`（连接）或 `connection=`；子图含上游 Agent／角色；可清除回全图 | 悬停高亮连通边 |
| S7 | 打开全图即可 | — |
| S8 | 工具条选 Agent 或**点击 Agent** → 写 **`agent=`**（禁止只写 `focus=agent` 冒充）；清除回全图 | 悬停高亮该 Agent 出流 |
| S5 | 问询种类／访问等级／窗口 | — |
| S3 | — | stub 悬停／清单（已定） |

**最低条：** S6／S8 须能在页面内完成持久筛选，不得只靠手改 URL。定位框若写入同等参数可计。

### 1.8 同筛选与日指标呼应（Normative · S9）

定义：

- **E**：结构筛选（agent／role／connection／table／focus）**之前**的允许调用候选集合；`meta` 上 `enteringAllowCallCount = |E|`（audit-echo D8，**有结构筛选时仍表示 \|E\|，不得改成局部数**）。
- **P**：施加当前结构筛选／重投影之后，关系图渲染与「数据表」共用的允许调用集合。

| 对账 | 合同 |
|---|---|
| 无结构筛选 | \|P\|=\|E\|；图披露的全局允许调用数＝数据表允许调用去重总数＝\|E\| |
| 有结构筛选 | 图与数据表对 **集合 P** 一致（**ID 集合相等**，非仅个数）；披露「当前投影允许调用 \|P\|」；**禁止**要求 `enteringAllowCallCount == 表筛选后总数` |
| 跨页 | 深链目标：`/admin/audit` 且进入**调用流水**视图（`view=calls` 或现行等价）。参数映射（Normative）：`window`→日志近窗／起止等价；`inquiryKind`→日志请求必须带上（若日志端此前忽略则**本条授权改 Audit 读取**）；`accessGrade`→同名；`agent=`→日志侧 Agent 过滤键 **`user`**（或现行等价）；访问层默认与 map 一致的 protocol 排除（`includeProtocol` 等与 E 一致）。SC-29 须断言：链接 href 含上述映射，**且** Audit 页解析后发出的列表请求应用这些条件（不得只测字符串）。不要求已打开页实时同步 |
| 量纲 | 厚度＝`accessPaths`；对账＝允许调用 ID；禁止路径数冒充调用数相等 |

## 2. 目标

1. S1–S9 可读；何老师走读成立。
2. 使用计量／列序／使用优先折叠；闲置不进列。
3. `agent=` 重投影；S6／S8 持久筛选可操作。
4. S9：E／P 分账；图↔表对 P 的 ID 集合打假。
5. 边状态机不变；允许只读 meta 增补投影调用数；不另起计数微服务。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改边状态机／路径主键 | Spec 187 |
| `accessCalls` 几何 | 扇出不守恒 |
| 闲置表铺满画布 | 破坏 S1／S3 |
| 授权柱高／授权折叠优先 | 破坏 S7 |
| KPI 墙／百科 | §1.1 |
| 已打开访问日志实时同步 | F06；只做深链对照 |
| 浏览器 E2E／Docker 重建 | 本条出口外 |

## 4. 拍板记录

| ID | 决议 |
|---|---|
| D1 | 受众＝运维经理；故事 S1–S9 |
| D2 | 因果链 Agent→角色→连接→表；使用主线 |
| D3–D10 | 同前：accessPaths 厚度、IDLE_GRANT_PX、四态、max(in,out)、图例、无授权外带、accessOk 降级 |
| D11 | URL 参数名沿用 Spec 187；可增只读 meta 投影字段 |
| D12–D18 | 同前：夹具、闲置不抬柱、密度、节点集、stub、降级抽屉、何老师叙事 |
| D19 | S6：持久 focus／connection；上游可读 |
| D20 | S7：列序 accessPaths 降序 |
| D21 | S8：**仅** `agent=`；路径／调用／边权按该 Agent 重投影；禁止 focus 冒充 |
| D22 | S9：E 与 P 分账；图↔表对 **P 的 ID 集合**；不改 enteringAllowCallCount 语义 |
| D23 | S6／S8 最低条＝持久筛选（写 URL）；悬停预览可选 |
| D24 | 折叠受害序使用优先（§5.8）；超预算时最热使用实体保留到最后 |
| D25 | 跨页深链：`view=calls`；agent→`user`；inquiryKind／accessGrade／window／protocol 与 E 对齐；可改 Audit 读取；SC-29 验请求生效 |
| D26 | `agent=`／`role=`／`connection=`／`table=`：**路径属性过滤＋重算边权**（与 hourly-detail 精确维一致）；**禁止**用双向连通分量实现这些 scope |
| D27 | `focus=`：连通子图（S6）；图与数据表对 focus 使用**同一** focus 投影定义生成 P；与 D26 scope 语义分离 |

---

## 5. 核心流程（伪代码）

### 5.1 画布节点集、列序与刻度

```text
usageNodes = { n | n.accessPaths > 0 }
idleEndpointNodes = { n | n.kind ∈ {agent,role,connection,schema}
                        and n.accessPaths == 0
                        and exists idle out-edge from n }
canvasNodes = usageNodes ∪ idleEndpointNodes
# Table with accessPaths==0 NEVER in canvasNodes

# S7：每一 depth 列内，usageNodes 排序
sort usageNodes in column by accessPaths DESC, then id ASC
# idleEndpointNodes 置列底（或不与使用节点争第一顺位）

density and gapReserve use only canvasNodes that are in usageNodes
  (idleEndpointNodes do not add NODE_GAP into rawUnit denominator)
unitPx = min(rawUnitFromUsageOnly, MAX_PX_PER_PATH)

assert: add 100 idle-only tables ⇒ unitPx, existing usage ribbon thickness,
        and usage pillarHeights unchanged
assert: in a column, node with max accessPaths is first (top) among usageNodes
```

### 5.1.1 结构筛选：scope 路径投影 vs focus 连通子图

```text
# —— D26 scope：agent= / role= / connection= / table=（可组合）——
# 与 hourly-detail 精确维一致：按路径字段过滤，再重算
on scope filters:
  keep paths where each present filter matches path.agentId / roleId /
       connectionId / table key
  drop non-matching paths entirely (including their callIds)
  RECOMPUTE all edge/node grantPaths, accessPaths, accessCallIds from kept paths
  # table=T1 反例：A 调 T1(a) 与 T2(b)；筛 table=T1 后 P={a}，不得残留 b
  # 禁止用双向连通分量实现 scope（那会把 T2 路径带回来）

# S8：agent= 是 D26 的特例；禁止 focus=agent 冒充

# —— D27 focus=nodeId（S6）——
on focus=F:
  build connected subgraph from F (Spec 187)
  P = union of allow-call IDs on paths/edges retained in that subgraph
  map render AND hourly-detail MUST use the same focus→P definition
  caption: 正在看 {label} 的链路

# UI 持久写入：§1.7；map 与 view=table 同 query
# enteringAllowCallCount = |E| 始终；另披露 |P|
```

### 5.8 折叠受害序（使用优先 · D24）

```text
# 在 layout 列序之前执行；输入为全量图（含闲置表节点若服务端仍构建）
# 受害权重：仅 accessPaths（闲置表 = 0，优先被折）
while over NODE_BUDGET or EDGE_BUDGET:
  victim = deepest among non-agent nodes with minimal accessPaths
            (tie: grantPaths asc, then id)
  fold victim into depth「其他」
# 断言：超预算夹具含 ≫预算的闲置表 + 少量高 accessPaths 表时，
# 高使用表名仍出现在 render 中（未被折进「其他」）
# 前端列序不得假定「折叠已按授权轻重排过」
```

### 5.2 柱高与使用槽位

```text
for each usage edge e (accessOk && accessPaths>0):
  thickness = accessPaths(e) * unitPx
  allocate out-slot on source, in-slot on target (geometry 排序规则可沿用)

pillarHeight(n) = max(sum(in-slot thicknesses on n), sum(out-slot thicknesses on n))
# 中间节点入＝出（单路径）⇒ 高度 = unitPx，不得 in+out

assert: one access path across Agent→Role→Conn→Table:
  all four pillarHeights equal (±0.1px)
assert: in-slot sum ≤ pillarHeight and out-slot sum ≤ pillarHeight
```

### 5.3 四态绘制（accessOk=true，使用边）

| 优先条件 | 主填充 | 非颜色 | 厚度 |
|---|---|---|---|
| confirmedUnauthorized | danger | danger 实线 | accessPaths×unitPx |
| overflow | access／使用 | danger 实线 | 同上 |
| needs_review | **warning** | 虚线中线 | 同上 |
| normal | access／使用 | 无 | 同上 |

### 5.4 闲置端点示意（不进柱高）

```text
for n in idleEndpointNodes ∪ {usage nodes with idle outs}:
  idleEdges = out-edges where grantPaths>0 and accessPaths==0
  if idleEdges empty: continue
  draw ONE hollow stub at n, thickness IDLE_GRANT_PX, fill=none
  stub does not change pillarHeight
```

### 5.5 闲置示意交互（F04 闭合）

```text
onHover(stub at n):
  tip lines:
    1. {n.label} → 闲置授权 {idleEdges.length} 条
    2. 有授权，窗口内未调用
    3. 授权路径 {sum grantPaths} 条 · 调用 0 次
  # 不要求一次画到具体表名；表名在清单

onClick(stub at n):
  open idle-grant list panel (testid access-map-idle-grant-list)
  each row = one idle edge: targetLabel · 授权路径 g 条
  onClick(row): open existing edge drawer for that edge id
    (复用 access-map-edge-detail；悬停三段式可在进入单边后按 idle-grant-copy)

SC: from one stub covering targets T1 and T2, both rows reachable and open correct drawer
```

### 5.6 accessOk=false

```text
# 禁止 if (edge.accessPaths>0) 走使用绘制
canvasNodes = idleEndpoint-style for agents/roles/connections with grantPaths>0
  (仍禁止闲置表进列)
stubs + list only; pillarHeight ≤ IDLE_GRANT_PX
hover / list / edge drawer (opened from list):
  一律「调用情况暂不可用」口径（对齐 idle-grant-copy §5.3 精神）
  禁止：调用 0 次、调用 N 次、确凿越权括注（无可靠访问面时不断言）
```

### 5.7 标签

使用活跃节点副标须含使用向数字（访问路径或调用）。

---

## 6. 验收场景

| ID | 断言 | 打假 |
|---|---|---|
| SC-01 | `IDLE_GRANT_PX` 导出 ∈[2,4] 并锁定稿值 | 导出 |
| SC-02 | 闲置表 1→100：`unitPx`、既有使用边厚度、使用节点柱高均不变 | 布局 |
| SC-03 | 同布局同 `unitPx`：accessPaths 加倍 ⇒ 厚度加倍；厚度＝accessPaths×unitPx | 布局 |
| SC-04 | 单路径四层：四柱高相等；`pillarHeight=max(in,out)` 非 in+out | 布局 |
| SC-05 | 何老师同构（高 grant、零／低 access）：无 `pillarHeight≈grantPaths×unitPx`；闲置表不进 `canvasNodes` | 布局 |
| SC-06 | 图例含访问路径宽度；不含授权路径宽度主释义 | 组件 |
| SC-07 | 图例含闲置端点示意／不进列；不含深色内核主释义 | 组件 |
| SC-08 | normal 使用边主厚度非 grantPaths；access 填充 | 布局＋组件 |
| SC-09 | needs_review：warning＋虚线 | 布局＋组件 |
| SC-10 | overflow／confirmedUnauthorized：danger 实线；厚度按 accessPaths | 布局＋组件 |
| SC-11 | 闲置示意 fill=none；不改变 pillarHeight | 布局 |
| SC-12 | 同源两闲置目标：stub→清单两行→各自打开正确边抽屉 | 组件 |
| SC-13 | `accessOk=false`：无使用填充带；闲置表不进列；柱高≤IDLE_GRANT_PX；**stub→清单→边抽屉**全链路无 `调用 \d+ 次`／「调用 0 次」／确凿越权括注，须含「调用情况暂不可用」（或等价降级句） | 组件 |
| SC-14 | 使用节点副标含使用向数字 | 组件 |
| SC-15 | 无「僵尸授权」 | 组件 |
| SC-16 | MIN_HIT_PX 不抬高示意计量厚度 | 布局 |
| SC-17 | 图例恰四项 | 组件 |
| SC-18 | server／API 契约不因本条改字段而红 | server 抽样 |
| SC-19 | 何老师同构夹具：使用活跃表在画布；仅闲置表不在 `canvasNodes`；Agent（及对照角色）柱高不随纯 `grantPaths` 升高；存在闲置端点示意可进入清单——合起来支撑 §1.4「牌很大、用很少」故事，而非「柱高＝授权大」 | 布局＋组件（可与 SC-05／SC-11／SC-12 共用夹具，本条锁叙事组合） |
| SC-20 | focus 到连接节点：连通子图内可见至少一个上游 Agent 与角色（夹具预设）；不得只剩连接孤立节点 | 组件 |
| SC-21 | 同列两使用节点 `accessPaths` 不同：较大者排在列内更先（第一顺位方向）；排序键不含 `grantPaths` | 布局 |
| SC-22 | `agent=`：无第二 Agent 使用带；共享下游夹具（A／B 共角色连接）下 B 的表边与 B 的 callIds 不出现；边权为重算后 A-only | 服务端＋组件 |
| SC-23 | 页面内可持久写入 `agent=`（工具条或点击 Agent）；清除可回全图；不得仅手改 URL | 组件 |
| SC-24 | 页面内可持久写入连接 `focus=`／`connection=`；子图含上游；清除可回全图 | 组件 |
| SC-25 | 无结构筛选：图 \|E\|＝数据表允许调用去重总数＝预写期望 ID 集；改 inquiryKind 后仍对期望集；**计数相同但 ID 被替换必须失败** | 服务端 |
| SC-26 | `agent=` 夹具：预写期望 **P**（非空，含同路径多 callId）；图＝表＝期望 P；双方同时漏 ID 必须失败；`enteringAllowCallCount=\|E\|` 且 \|E\|≥\|P\| | 服务端 |
| SC-27 | 超节点预算：大量闲置表＋少量高 accessPaths 表 → 高使用表标签仍在 render | 服务端 fold |
| SC-28 | 悬停 alone 不通过 SC-23／24；点击／工具条须写 URL | 组件 |
| SC-29 | 深链 href：`view=calls`（或等价）、window／inquiryKind／accessGrade 映射、有 agent 时含 `user=`（或文档锁定的等价键）；组件或集成断言 Audit 解析后列表请求带上 inquiryKind／accessGrade／user（不得只断言 href 字符串） | 组件＋／或 Audit 请求构造测试 |
| SC-30 | `table=`（及 role／connection）夹具：图与表 P 相等且＝预写期望；连通分量不得把未选中表的 callId 带进 P | 服务端 |

## 7. 完成定义

SC-01–SC-30 有证据；S1–S9；E／P；scope 路径投影；focus 同定义；使用优先折叠；持久筛选；深链对照。不要求 Docker 重建。
