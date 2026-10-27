# Lucy 访问关系图（Access Map）Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 访问关系图（Access Map）Spec |
| 文档类型 / 版本 | 功能设计基线 / v0.3-requirements-review |
| 日期 / 目标版本 | 2026-10-20；2026-10-25 收口 / v0.25 |
| 功能编号 / 优先级 | L25-08 / P1-3 |
| 状态 | **设计完成、需求审查已签核通过（2026-10-25）；暂不开发，不代表实现或验收通过** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 撰写人 / 委托人 | Mavis（minimax Code）；v0.3 由 Kimi 收口 / Forrest |
| 基于材料 | `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`（L25-01 / L25-03）；`webui/docs/06-navigation-ia.md`；`webui/docs/00-product-terminology-standard.md`；`webui/docs/131-lucy-admin-catalog-bound-role-spec.md`；`webui/server/admin/permission-display.ts`；`webui/server/proxy/acl.ts`；`webui/server/proxy/audit.ts`；`webui/server/admin/metric-window.ts`；`webui/docs/design-system/README.md` |
| 适用范围 | v0.25 治理台 WebUI 的访问关系可视化。授权面读取现有 effective permissions，访问面读取现有审计日志。**不新增授权模型，不改变运行时裁决** |
| 输出位置 | `webui/docs/187-access-relation-sankey-spec.md` |
| 规划 / 审查入口 | [v0.25 建议书](../../docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-08；[P0 Final 决议](../../docs/reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1；[P1 需求审查清单](../../docs/plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../../docs/reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 审查执行通过、PM 已签核；附带 F-01–F-04 实施前待办） |
| v0.3 收口 | 统一 v0.25／P1 元数据；明确访问路径与调用次数、L25-01 同源对账、四项原待定口径；全部验收仍未执行 |
| 冲突裁决 | 与 `webui/docs/07-mcp-auth-proxy-spec.md`（运行时授权/裁决）冲突 → 该文件；与 `docs/access-control/design-upgrade.md` 冲突 → 该文件。本文只做**展示**，不参与任何授权判定 |

> **Spec 189 修订（2026-10-27）**：本文的**授权面**、**`access_log_sources` 访问主体**、调用 ID 去重与守恒算法**全部不变**；仅**凭证清单的「统计期调用次数」**改为 Default Usage Call（排除全部协议事件与默认视图排除的评测探针）。真实表访问事实（含真实评测调用）**不因默认用量口径被过滤**，Access Path 的存在性去重语义不变。口径见 `webui/docs/189-usage-metrics-truthfulness-and-cross-page-consistency-spec.md` §6。

---

## Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`。

### 新增术语（需在术语标准 §4.8「访问权限升级」登记，见附录 A）

| Canonical Term | UI 主术语 | 定义 | 禁止混淆 |
|---|---|---|---|
| Access Map | 访问关系图 | 展示 Agent 授权面与实际访问面的关系图 | 拓扑图、权限流向图、桑基图（桑基是图形形式，不是产品名） |
| Grant Path | 授权路径 | 一个 `(Agent, Role, Connection, Schema, Table)` 的存在性实例 | 权限、授权项、访问路径 |
| Access Path | 访问路径 | 统计窗口内至少有一次允许调用的去重 `(Agent, Role, Connection, Schema, Table)` 存在性路径 | 调用次数、请求数 |
| Dormant Grant | 僵尸授权 | 授权路径数 > 0 且访问路径数 = 0 的边 | 未使用权限、闲置资源 |
| Needs-review Signal | 需复核信号 | 访问路径数 > 0 但当前授权无对应授权路径的边 | 越权（见 §4.9.3，二者不等价） |
| Credential List | 凭证清单 | 挂在 Agent 下的 Token 附属区，不承载授权 | 权限节点、凭证流 |

### 既有术语沿用

- **Agent**：沿用 `webui/docs/14-agent-admin-enterprise-delivery-spec.md`。UI 主术语「Agent」，不译「代理 / 智能体」。
- **Token 凭据**：沿用现有「访问治理 › Token 凭据」导航名。
- **Role**：UI 主术语「角色」，沿用 `webui/docs/15-role-admin-spec.md`。
- **Connection / Schema / Table**：沿用术语标准 §2.1，保留英文原文，禁止「架构 / 模式 / 舱单 / 清单」。
- **Metric Window（统计窗口）**：沿用 Spec 128 §7，`webui/server/admin/metric-window.ts`。

### Protected DOM

`access-map`、`sankey`、`grantPath`、`accessPath`、`dormant`、`needs-review`、`credential-list`，以及全部 `connection id` / `schema` / `table` / `role id` / `token label` 节点。必须加 `translate="no"` + `notranslate`。

---

## 1. 背景与目标

### 1.1 问题

v0.25 提案 L25-01 的验收标准是「不打开 YAML，能说出这个 Agent 能读哪些表」。当前治理台距离这个标准有明确差距：

| 现状 | 位置 | 缺什么 |
|---|---|---|
| Agent 页只有 Token 数与近 7 天调用次数 | `webui/src/pages/admin/AgentList.tsx` | 看不出这个 Agent 能读哪些表 |
| 角色权限页是四张计数卡 + 一张表 | `webui/src/pages/admin/RoleList.tsx` | 看不出授权落到哪些连接、哪些表，以及谁在用 |
| 「Token 凭证与活跃」卡片写「活跃 Token 数超过配置数，数据异常」 | 提案 L25-03 已列为改造项 | 数字对不上账，只能看到异常结论 |
| 访问日志表名截断成「dataforai.superstore 等 13 个」 | 提案 L25-02 已列为改造项 | 看不出全局的访问结构 |

这些页面是**列表视角**：一维的、逐项的。要回答「这个 Agent 和别的 Agent 共享了哪些表」「哪个角色的授权大面积闲置」「哪个表被谁访问但当前没授权」，需要一张**关系视角**的全局图。

### 1.2 目标

1. **G-01 一张图看清授权面**：Agent → 角色 → 连接 → 表的完整授权拓扑，一眼看出谁有权读什么。
2. **G-02 授权与访问同图对照**：授权骨架 + 实际访问内核双层叠加，暴露「有权限但没访问」（僵尸授权）与「访问了但当前无授权路径」（需复核信号）。
3. **G-03 Token 以凭证清单呈现**：Token 不承载授权，因此不进入流主干，作为 Agent 下的凭证清单，承载调用归因。
4. **G-04 独立页 + 详情页深链**：全局拓扑在独立页；Agent / 角色详情页提供下钻入口，两处共享同一份数据源。
5. **G-05 零新授权模型**：不新增任何 `access.yaml` 字段，不改变运行时授权与裁决，只读展示。

### 1.3 成功标准

| ID | 标准 |
|---|---|
| SC-01 | 独立页 `/admin/access-map` 渲染出 Agent → 角色 → 连接 → 表四层主干，节点带 Agent 数与路径数两套计数 |
| SC-02 | 流带宽度严格满足守恒：对任一非凭证节点，入流授权路径数 = 出流授权路径数（误差 0） |
| SC-03 | 每条流带内叠加访问内核，宽度 = 访问路径数；访问数为 0 的边呈「僵尸授权」态且可被筛出 |
| SC-04 | Token 以凭证清单形式挂在 Agent 下，显示 label、状态、统计期调用次数；点击只过滤访问层，不改变授权骨架 |
| SC-05 | 访问层默认只统计 `association_status = 'confirmed'` 的记录，图例标明当前口径；可切到含候选口径 |
| SC-06 | Agent 详情页与角色详情页各有一个深链入口，携带过滤参数跳转独立页并正确预置过滤 |
| SC-07 | 授权面不可用（`access.yaml` 缺失/非法/路径不一致）时，页面显示与角色权限页口径一致的三态降级提示，不渲染空白图 |
| SC-08 | 节点数 / 边数超过渲染预算时自动折叠，折叠数量显式可见且可展开 |
| SC-09 | 提供与桑基图等价的表格视图，键盘可达，屏幕阅读器可读出全部节点与边 |
| SC-10 | 图上「需复核信号」不表述为「越权」；确凿越权判定单独标注来源为调用当时的授权快照 |
| SC-11 | 术语 lint 通过（`npm run lint:terminology`），新术语已在术语标准 §4.8「访问权限升级」登记 |
| SC-12 | 零回归：现有 Agent 页、角色权限页、访问日志页、MCP 调试台行为不变 |
| SC-13 | 需复核记录披露快照可关联数、总数、缺失数与覆盖率；缺失／无效快照不判确凿越权，低覆盖率不解释为低越权率 |
| SC-14 | 与 L25-01 在同一配置／目录快照下按表集合并集对账；授权路径数、去重表数、访问路径数、调用数分别表达 |

---

## 2. Non-Goals

| 不做 | 原因 |
|---|---|
| 改变授权判定、加新 deny 码、拦截访问 | 本图只读展示。裁决权在 `07-mcp-auth-proxy-spec.md` |
| 新增 `access.yaml` 字段（如「图分组」「图优先级」） | 违反 G-05。图不得成为授权模型的一部分 |
| 数据血缘（表 → 列 → 行级策略的实际字段流） | 血缘是另一张图。本图是**访问关系**，粒度到表 |
| Agent 编排 / 拓扑 / 上下游依赖 | 越出访问治理域 |
| Token 之间的权限继承或加权 | Token 在 Lucy 里只是凭证，不携带授权（§4.5） |
| 实时流式刷新 / WebSocket 推送 | 治理台现有页面均为请求-响应式刷新，不引入新的实时通道 |
| 移动窄屏适配 | 按 `AGENTS.md` 浏览器测试约束，Lucy 默认不做窄屏 |
| 把本图纳入发布门禁 | 提案 §2.1 明确 v0.25 只做展示，不新增门禁 |
| 自研桑基布局算法 | 引入 `d3-sankey`（§8.1），不自研层分配与交叉最小化 |

---

## 3. 位置与导航

### 3.1 独立页

- 规划路由：`/admin/access-map`（与 `/admin/agents`、`/admin/roles`、`/admin/tokens`、`/admin/audit` 同级）；当前路由与导航尚未实现。
- 规划导航：P1-1 **行权限视图**位于「角色权限」之后，P1-3 **访问关系图**位于其后、「访问日志」之前。「访问治理」由当前 6 项（Agent / Token 凭据 / 角色权限 / 访问日志 / MCP 调试台 / 配置审计）规划扩为 8 项，现有项相对顺序不变。
- 本轮只在 `webui/docs/06-navigation-ia.md` 与 `webui/docs/61-help-sidebar-entry-map-spec.md` 登记规划入口（§12.3），不得把规划项写成当前代码事实。

### 3.2 详情页下钻深链

| 来源页 | 位置 | 目标 |
|---|---|---|
| Agent 详情页 `webui/src/pages/admin/AgentDetail.tsx` | 「资源卡片」区（提案 L25-01 新增区）下方 | `/admin/access-map?agent=<userId>` |
| 角色详情页 `webui/src/pages/admin/RoleDetail.tsx` | 权限摘要区 | `/admin/access-map?role=<roleId>` |
| 访问日志页 `webui/src/pages/admin/Audit.tsx` | 单笔问询详情的「涉数据表」 | `/admin/access-map?table=<conn>::<schema>::<table>` |
| 独立页自身 | Agent / Role / Table 节点点击 | 同页下钻聚焦，URL 同步 `focus=<nodeId>` |

深链参数见 §6.3。**深链必须可分享**：打开即复现同一过滤与同一统计窗口。

### 3.3 与 L25-01 的关系

本图与提案 L25-01 共享数据源（同一份 effective permissions 解析），但**验收互不覆盖**：

- L25-01 验收：Agent 详情页的文字摘要与资源卡片是否说清了能读哪些表。
- 本 Spec 验收：全局拓扑的守恒性、双层对照的准确性、详情页深链是否正确预置。

两者必须复用同一配置／目录快照与 per-role 编译事实，但**同源不等于同数**：L25-01 资源卡片按规范源键展示去重表集合，本图 `grantPaths` 按 `(Agent, Role, Table)` 计算授权路径。对账断言是“同一 Agent 的摘要表集合 == 本图授权路径的表集合并集”，不是“表数 == 路径数”；多角色重复授权时两者合法不同。共享派生快照身份与集合，不在前端用另一套算法拼数。详见 [L25-01 授权摘要 Spec](../../docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md) §2.2、§6。

---

## 4. 语义模型（Normative）

### 4.1 双层对照总览

一张图，两个度量：

```
授权面（骨架）                                                 访问面（叠加）
─────────────────────────────────────────────────────────────────────────
Agent ──▶ Role ──▶ Connection ──▶ [Schema] ──▶ Table
  │         │           │             │            │
  │         │           │             │            └─ 访问内核：被实际访问过的路径
  │         │           │             └─ 访问内核
  │         │           └─ 访问内核
  │         └─ 访问内核
  └─ 凭证清单（Token 1:N，不参与守恒，非流连线）
```

- **骨架（宽度）**：授权路径数。决定节点高度与流带宽度，严格守恒。
- **内核（叠加于流带内）**：访问路径数。起点对齐绘制，长度 ≤ 流带宽度的同量纲比例；超出部分以警示描边标出。
- **凭证清单**：Token 挂在 Agent 下的虚线附属区，**不进入流主干，不参与守恒**。

两层同量纲是本设计成立的前提：授权路径与访问路径都以 `(Agent, Role, Table)` 为计数单位，口径一致才能直接相减、相比。

### 4.2 授权路径与访问路径（Normative 定义）

**授权路径 Grant Path**

```
GrantPath = (AgentId, RoleId, ConnectionId, Schema, TableName)
```

存在性由「该 Agent 的有效授权集合中包含该表，且该表可归因到该 Role」决定。

**访问路径 Access Path**

```
AccessPath = (AgentId, RoleId, ConnectionId, Schema, TableName)
  WHERE 该路径在 [startIso, endIso) 内至少有一次 outcome='allow' 调用
```

访问路径是统计窗口内的**存在性去重结果**，不是一次调用，也不把 `ts` 放进路径主键。先按当前 Token／信任口径筛选审计调用，再按路径去重；原始调用次数另记 `accessCalls`。因此同一路径调用 1 次或 100 次，`accessPaths` 都为 1，`accessCalls` 分别为 1 或 100。

**Role 归因口径（两侧必须一致）**

- 授权侧：逐 `(Agent, Role)` 单独解析，取该 Role 单独贡献的 source 集合。
- 访问侧：优先取 `access_log.matched_role_id`（单值）；为空时回退到 `access_log.role_ids`（JSON 数组，逐个展开）；两者都为空时归入伪节点 `role:<unresolved>`（灰显，不可点击）。

**去重主体数、路径数与调用数是三个不同的数，不得混用**

| 口径 | 定义 | 用途 |
|---|---|---|
| `grantPaths` | 授权路径实例数（含角色重复） | 流带宽度、守恒校验 |
| `grantUsers` | 流过该边的**去重 Agent 数** | 节点标签副标题 |
| `accessPaths` | 窗口内有允许调用的去重访问路径数 | 访问内核宽度 |
| `accessUsers` | 流过该边的去重 Agent 数 | 节点标签副标题、信号计数 |
| `accessCalls` | 当前筛选与角色归因后的调用次数；跨 Role 汇总可能重复 | 凭证清单、浮层明细 |

全局“原始调用数”必须按稳定调用 ID 另行去重，不能把各 Role 边的 `accessCalls` 相加后冒充全局调用数。

**多角色重复授权的处理（Normative）**

同一 Agent 持两个 Role 且都授权同一张表时：

- 该表有 **2 条授权路径**（`(A,R1,T)` 与 `(A,R2,T)`），去重 Agent 数为 **1**。
- 流带上体现为两条路径，节点标签显示「1 个 Agent · 2 条路径」。
- **不得**把路径数显示成 Agent 数，否则用户会误读为「2 个 Agent 访问了 T」。

### 4.3 边宽 = 授权路径数（流守恒）

每条授权路径在它经过的每一跳上贡献恰好 1。因此：

> 对任一非凭证节点 `n`：
> `Σ grantPaths(e) for e ∈ incoming(n)` **==** `Σ grantPaths(e) for e ∈ outgoing(n)`

- Agent 节点为源点：出流总量 = 该 Agent 的授权路径总数。
- Role / Connection / Schema / Table 节点：入流 = 出流。
- 凭证清单节点不参与守恒（§4.5）。

**实现约束（Normative，重要）**

> 合并后的 `EffectivePermissions.sources` **不可反推角色归因**。多个 Role 的 source 集合取并集后，丢失了「哪张表来自哪个 Role」的信息；并集不等于各 Role 之和（同一张表可被多个 Role 覆盖）。
>
> 因此 Access Map 构建器**不得**复用 `resolveEffectivePermissionsBatchForAdmin` 的合并结果再尝试拆分，**必须**对每个 `(Agent, Role)` 组合单独走 per-role 编译路径取该 Role 单独贡献的 source 集合。
>
> 实现入口：`webui/server/proxy/acl.ts` 的 per-role 编译（`compileRole` / 单 role 解析路径），与 `webui/server/admin/permission-display.ts` 的批量入口并列但独立。

### 4.4 访问内核 = 访问路径数

每条访问路径在它经过的每一跳上贡献 1，与授权侧同构。因此访问层本身也守恒，且可直接与授权层逐边比较：

| 条件 | 边状态 | UI 表现 | 含义 |
|---|---|---|---|
| `grantPaths > 0` 且 `accessPaths > 0` | `normal` | 内核填充，无描边 | 正常 |
| `grantPaths > 0` 且 `accessPaths == 0` | `dormant` | 内核缺失，节点徽标「僵尸授权 N」 | 有权未用（僵尸授权） |
| `grantPaths == 0` 且 `accessPaths > 0` | `needs_review` | 警示描边 + 计数 | 需复核信号（§4.9） |
| `grantPaths > 0` 且 `accessPaths > grantPaths` | `overflow` | 警示描边 | 当前授权口径下访问路径多于授权路径 |

`overflow` 与 `needs_review` 在数据上互斥于同一条边（`grantPaths==0` 时 `accessPaths>grantPaths` 必然成立），实现时按上表顺序判定，`needs_review` 优先。

### 4.5 Token 凭证清单（不参与守恒）

**Token 不携带任何授权。** 它是 Agent 的 1:N 凭证，作用是**调用归因**——把一次调用落到具体的持有者与客户端上。因此：

- Token **不进入流主干**，不与 Role / Connection / Table 连流带。
- Token 以**虚线附属区**挂在 Agent 节点下方，视觉上是「这个 Agent 手上有几张凭证」的清单，不是流。
- 凭证清单的宽度是**固定视觉尺寸**，不随路径数缩放，**不参与守恒校验**。
- 凭证清单承载两类信息：
  - 静态：`label`、状态（active / expired / revoked）、创建时间、过期时间、最近使用时间。
  - 动态：统计窗口内的调用次数（`access_log` 按 `token_label` 聚合）。

**交互诚实性（Normative）**

> 点击某个 Token，**只过滤访问层内核**（只显示该 Token 产生的访问路径），**授权骨架保持不变**。
>
> 理由：Token 不携带授权，过滤 Token 不会改变任何授权路径。UI 必须显式提示「已按 Token 过滤访问层，授权层不受影响」，避免用户误以为该 Agent 的授权变窄了。

### 4.6 Schema 层可选

用户列出的实体是 Agent / Token / 角色 / 数据库 / 表，共 5 类，**不含 Schema**。但连接与表之间在语义层确实存在 Schema 层级。

**决定**：Schema 层**默认折叠**（连接直接连到表），提供「显示 Schema 层」开关。

- 折叠态：4 层主干（Agent → 角色 → 连接 → 表），横向可读性最好。
- 展开态：5 层主干（Agent → 角色 → 连接 → Schema → 表）。
- 折叠不改变任何计数：无论是否展开，`grantPaths` / `grantUsers` 的口径完全一致，只是中间节点不同。

开关状态写入 URL 参数 `layer=schema|flat`（§6.3），可分享。

### 4.7 节点类型表

| kind | id 形态 | depth | 层级 | 补充信息 `meta` |
|---|---|---|---|---|
| `agent` | `agent:<userId>` | 0 | Agent | `enabled`、`roleIds[]`、`tokenCount`、`grantUsers`、`grantPaths`、`accessUsers` |
| `role` | `role:<roleId>` | 1 | 角色 | `sourceScope`、`toolCount`、`tableCount`、`agents[]` |
| `connection` | `conn:<connectionId>` | 2 | 连接 | `status`、`schemaCount`、`tableCount` |
| `schema` | `schema:<conn>::<schema>` | 3 | Schema | `tableCount` |
| `table` | `table:<conn>::<schema>::<table>` | 3 或 4 | 表 | `physicalTable`、`enabled`、`grantUsers`、`grantPaths`、`accessUsers`、`accessPaths` |
| `token` | `token:<userId>::<label>` | —（附属） | 凭证清单 | `label`、`status`、`createdAt`、`expiresAt`、`lastUsedAt`、`callCount`、`revokedAt` |

节点标签统一两行：

- 主行：显示名（`agent` 用 `name`，缺省回退 `id`；`table` 用 `sourceName`）。
- 副行：`N 个 Agent · M 条路径`（N = 去重主体数，M = 路径数）。

### 4.8 零授权表的处理

- 没有任何 Agent 拥有授权的表，**不进入图**。
- 有授权但连接未启用（`ktx.yaml` `enabled_tables` 未包含）的表，**不进入图**，计入 `meta.orphanGrants` 并在浮层中说明「已授权但连接未启用该表」。这类表是真实的配置漂移信号，应在浮层里可见，但不占图面。

### 4.9 越权信号的可信度边界（Normative，诚实性要求）

#### 4.9.1 当前授权 ≠ 调用当时的授权

授权面来自**当前** `access.yaml` 编译结果；访问面来自**历史**审计记录。两者时间口径不同：一次历史调用在当时是合法的，但当前授权可能已收紧（表被撤、角色被解绑、Agent 被停用）。

因此「访问了但当前无授权路径」**不必然等于越权**，它首先意味着**需要复核**。

#### 4.9.2 两档信号定义

| 档位 | 判定 | 结论强度 | UI 措辞 |
|---|---|---|---|
| 需复核信号 | 当前授权无对应授权路径，但审计记录显示发生过允许的访问 | 线索 | 「需复核：当前授权无对应路径」 |
| 确凿越权 | 用 `access_log.permission_snapshot_hash` 关联 `permission_snapshots.resolved_json`，**当时**的授权快照里也不含该表 | 结论 | 「确凿越权：调用当时授权亦不覆盖」 |

`permission_snapshots` 表已存在（`webui/server/proxy/audit.ts`，字段 `hash` / `roles_json` / `resolved_json` / `capability_digest`），`access_log.permission_snapshot_hash` 已写入，**本期设计两档判定**。响应与页面必须披露需复核记录的快照覆盖率：可关联快照数／需复核记录数，以及缺失快照数。快照缺失、损坏或身份不一致时只保留「需复核」，不得判为「确凿越权」，也不得把低覆盖率解释为低越权率。

#### 4.9.3 图不是裁决器（Normative）

- 图上的警示描边**只做展示**，不写任何审计事件，不改变任何裁决结果。
- 访问层的 `deny` 记录**不进入访问内核**（`outcome != 'allow'`），只单独统计为「被拒绝的访问尝试」，用于佐证需复核信号。
- UI 文案禁止出现「越权」二字用于第一档信号。第一档一律表述为「需复核」。

---

## 5. 核心流程（伪代码）

### 5.1 授权骨架构建

```ts
type GrantLayer = {
  state: "ok" | "partial" | "unavailable";
  nodes: Map<string, AccessMapNode>;
  edges: Map<string, AccessMapEdge>;
  failedAgents: string[];        // 未能解析的 Agent（→ partial）
  orphanGrants: number;          // 已授权但连接未启用的表数
};

function buildGrantLayer(
  snapshot: AccessSnapshot,
  enabledUserIds: string[],
  catalog: CatalogSources,        // connection → schema → table，及 enabled 标记
  withSchema: boolean,
): GrantLayer {
  // G1. access.yaml 快照：管理员路径与运行时路径必须逐字节一致
  //     - snapshot.problem 存在 → 授权面不可用
  if (snapshot.problem) {
    return { state: "unavailable", nodes: new Map(), edges: new Map(),
             failedAgents: [], orphanGrants: 0 };
  }

  // G2. 构建权限上下文（复用 permission-display.ts 的 buildAdminPermissionContext）
  const context = await buildAdminPermissionContext(snapshot.runtimeConfig!);
  if (!context) {
    return { state: "unavailable", nodes: new Map(), edges: new Map(),
             failedAgents: [], orphanGrants: 0 };
  }

  const nodes = new Map<string, AccessMapNode>();
  const edges = new Map<string, AccessMapEdge>();
  const failedAgents: string[] = [];
  let orphanGrants = 0;

  // G3. 路径去重键：(Agent, Role, Conn, Schema, Table)
  //     同一路径只计一次，避免 selector 重复导致多计
  const seenPaths = new Set<string>();

  for (const userId of enabledUserIds) {
    // G4. 逐 Agent 解析
    const resolved = await resolveEffectivePermissions(userId, context);
    if (!resolved.ok) {
      failedAgents.push(userId);          // → partial（不是 unavailable）
      continue;
    }

    // G5. 逐 Role 单独解析 —— 合并结果不可反推角色归因（§4.3）
    for (const roleId of resolved.permissions.roleIds) {
      const perRole = await resolveSingleRolePermissions(userId, roleId, context);
      if (!perRole.ok) {
        // 单个 Role 失败不阻断该 Agent 的其他 Role
        continue;
      }

      // G6. 逐 source 构造授权路径
      for (const src of perRole.sources) {
        const pathKey = `${userId}\u0000${roleId}\u0000${src.connectionId}\u0000${src.schema}\u0000${src.sourceName}`;
        if (seenPaths.has(pathKey)) continue;
        seenPaths.add(pathKey);

        // G6.1 连接不在目录里 → 孤儿授权，计数但不入图
        const conn = catalog.connection(src.connectionId);
        if (!conn) { orphanGrants += 1; continue; }

        // G6.2 连接未启用该表 → 孤儿授权，计数但不入图（§4.8）
        if (!conn.enabledTables.has(`${src.schema}.${src.sourceName}`)) {
          orphanGrants += 1;
          continue;
        }

        // G6.3 节点
        const aId = `agent:${userId}`;
        const rId = `role:${roleId}`;
        const cId = `conn:${src.connectionId}`;
        const sId = `schema:${src.connectionId}::${src.schema}`;
        const tId = `table:${src.connectionId}::${src.schema}::${src.sourceName}`;

        upsertNode(nodes, aId, { kind: "agent", depth: 0, label: resolved.name ?? userId });
        upsertNode(nodes, rId, { kind: "role", depth: 1, label: roleId });
        upsertNode(nodes, cId, { kind: "connection", depth: 2, label: src.connectionId });
        if (withSchema) upsertNode(nodes, sId, { kind: "schema", depth: 3, label: src.schema });
        upsertNode(nodes, tId, {
          kind: "table",
          depth: withSchema ? 4 : 3,
          label: src.sourceName,
          meta: { physicalTable: `${src.schema}.${src.sourceName}` },
        });

        // G6.4 边：每条路径在每一跳贡献 1
        const hops = withSchema
          ? [[aId, rId], [rId, cId], [cId, sId], [sId, tId]]
          : [[aId, rId], [rId, cId], [cId, tId]];
        for (const [from, to] of hops) {
          const e = upsertEdge(edges, from, to);
          e.grantPaths += 1;
          e.grantUsers.add(userId);
        }
      }
    }
  }

  // G7. 守恒自检（Normative §4.3）——不通过即视为实现缺陷，抛错而非静默降级
  assertFlowConservation(nodes, edges);

  return {
    state: failedAgents.length === 0 ? "ok"
         : failedAgents.length === enabledUserIds.length ? "unavailable"
         : "partial",
    nodes, edges, failedAgents, orphanGrants,
  };
}
```

### 5.2 访问层构建

```ts
type AccessRow = {
  userId: string;
  roleId: string;          // matched_role_id，缺失时回退 role_ids 展开
  connectionId: string;
  schemaName: string;
  sourceName: string;
  tokenLabel: string | null;
  calls: number;
  ts: string;
  outcome: "allow" | "deny";
  permissionSnapshotHash: string | null;
};

function buildAccessLayer(
  window: MetricWindow,        // 复用 metric-window.ts 的 buildMetricWindow
  trust: "confirmed_only" | "include_candidate",
  tokenLabel: string | null,   // 只过滤访问层；不参与路径主键或授权骨架
): { state: "ok" | "unavailable"; rows: AccessRow[]; denied: number } {
  // A1. 审计库不可用 → 访问层不可用（授权骨架仍可渲染）
  const db = openAuditDb();
  if (!db) return { state: "unavailable", rows: [], denied: 0 };

  // A2. 取窗口内涉及表的调用；时间条件必须用 metric-window 的半开区间
  //     禁止在 SQL 里内联 datetime('now','-7 days')（Spec 128 HR-5）
  const rows = db.prepare(`
    SELECT al.id, al.user_id, al.matched_role_id, al.role_ids, al.token_label,
           al.outcome, al.ts, al.permission_snapshot_hash,
           als.connection_id, als.schema_name, als.source_name
    FROM access_log al
    JOIN access_log_sources als ON als.access_log_id = al.id
    WHERE al.ts >= :startIso AND al.ts < :endIso
      AND (:trust = 'include_candidate' OR al.association_status = 'confirmed')
      AND (:tokenLabel IS NULL OR al.token_label = :tokenLabel)
  `).all({ startIso: window.startIso, endIso: window.endIso, trust, tokenLabel });

  // A3. 归因到 Role：
  //     - matched_role_id 单值优先
  //     - 否则展开 role_ids JSON 数组（多角色 → 每角色一条访问路径，与授权侧同构）
  //     - 都没有 → role:<unresolved>
  // A4. 仅 outcome='allow' 进入访问路径；deny 单独计数（§4.9.3）
  // A5. 同一 (user, role, conn, schema, table) 去重，calls 求和；ts 与 token 不进主键
  // A6. 全局原始调用数按稳定 al.id 去重；不得累加多 Role 展开后的 accessCalls
  return { state: "ok", rows: normalizeAccessRows(rows), denied: countDenied(rows) };
}
```

### 5.3 边聚合与状态判定

```ts
function mergeLayers(
  grant: GrantLayer,
  access: AccessLayer,
): AccessMapEdge[] {
  for (const row of access.rows) {
    // A1. 把访问路径投射到与授权侧同构的每一跳上
    const hops = tableHops(row);          // 同 §5.1 G6.4 的 hop 序列
    for (const [from, to] of hops) {
      const e = upsertEdge(grant.edges, from, to);
      e.accessPaths += 1;
      e.accessUsers.add(row.userId);
      e.accessCalls += row.calls;
    }
  }

  for (const e of grant.edges.values()) {
    // A2. 状态判定，顺序固定（§4.4）
    if (e.grantPaths === 0 && e.accessPaths > 0)      e.state = "needs_review";
    else if (e.accessPaths > e.grantPaths)            e.state = "overflow";
    else if (e.accessPaths === 0)                     e.state = "dormant";
    else                                              e.state = "normal";

    // A3. 逐条访问路径用调用当时的授权快照判定；不得任取边上的一个 hash 代表全部路径
    e.reviewEvaluations = e.state === "needs_review" || e.state === "overflow"
      ? evaluateEachContributingAccessPath(e)
      : [];
    e.confirmedUnauthorized = e.reviewEvaluations.some(x => x.result === "confirmed_unauthorized");
    e.snapshotCoverage = summarizeSnapshotCoverage(e.reviewEvaluations);

    // A4. 去重主体数落盘
    e.grantUsersCount = e.grantUsers.size;
    e.accessUsersCount = e.accessUsers.size;
  }
  return [...grant.edges.values()];
}

// permission_snapshots.resolved_json 存的是当时的解析结果。
// 有匹配快照且当时也不含该表 → 该路径确凿越权；缺失／损坏／身份不符 → unknown。
// 边可因任一路径有确凿证据显示 danger，但其它 unknown 路径仍在明细中保留「需复核」。
function evaluateAccessPathSnapshot(row: AccessRow): SnapshotEvaluation {
  if (!row.permissionSnapshotHash) return { result: "unknown", reason: "snapshot_missing" };
  const snap = loadPermissionSnapshot(row.permissionSnapshotHash);
  if (!snapshotIdentityMatches(snap, row)) return { result: "unknown", reason: "snapshot_invalid" };
  return snapshotCoversTable(snap, row)
    ? { result: "covered_at_call_time" }
    : { result: "confirmed_unauthorized" };
}
```

### 5.4 折叠（规模预算）

```ts
const NODE_BUDGET = 150;
const EDGE_BUDGET = 400;

function foldIfNeeded(graph: AccessMapGraph): AccessMapGraph {
  if (graph.nodes.size <= NODE_BUDGET && graph.edges.size <= EDGE_BUDGET) {
    return graph;                            // 全量渲染
  }
  // F1. 按「入流授权路径数」降序排序下游节点
  // F2. 保留前 K 个（K 由预算反推，使总边数 ≤ EDGE_BUDGET）
  // F3. 被折叠的边合并到同层的「其他（N）」节点
  // F4. 折叠数量必须显式写入 meta.folded，并在图上以徽标呈现「已折叠 N 个节点」
  // F5. 折叠只影响渲染，不影响任何计数口径；表格视图仍展示全量
  return fold(graph, { nodeBudget: NODE_BUDGET, edgeBudget: EDGE_BUDGET });
}
```

### 5.5 降级矩阵

| 授权面 | 访问面 | 渲染 | 页面提示 |
|---|---|---|---|
| ok | ok | 完整双层图 | — |
| ok | unavailable | 只渲染授权骨架；访问内核区显示「审计数据不可用」 | 提示「访问层不可用，已降级为授权面」 |
| partial | ok | 完整图；未解析的 Agent 不入图 | 提示「N 个 Agent 授权未能解析，结果不完整」+ 跳转配置审计 |
| partial | unavailable | 只渲染已解析 Agent 的授权骨架 | 同上 + 访问层不可用 |
| unavailable | 任意 | **不渲染图** | 三态提示（与角色权限页 `CountState` 口径一致）：`access_unreadable` / `access_invalid` / `access_config_path_mismatch`，提供跳转配置审计的链接 |

> 降级态**不得**用空图或零值图冒充正常结果。这与 `permission-display.ts` 的 `CountState` 三态语义一致。

---

## 6. API 契约

### 6.1 端点

```
GET /api/admin/access-map
```

鉴权沿用现有 admin 路由（登录账户 + Admin 角色），与 `/api/admin/agents`、`/api/admin/roles` 一致。

### 6.2 响应结构

```jsonc
{
  "meta": {
    "window": { "startIso": "2026-10-13T...", "endIso": "2026-10-20T...", "asOf": "2026-10-20T..." },
    "grant": { "state": "ok", "accessConfigVersion": "1712...-a3f9...", "policyVersion": "...", "sourceMapVersion": "...", "capabilityDigest": "..." },
    "access": { "state": "ok", "trust": "confirmed_only", "deniedCalls": 12, "rawCalls": 12 },
    "counts": { "agents": 3, "roles": 2, "connections": 1, "schemas": 1, "tables": 13, "tokens": 4, "edges": 28 },
    "signals": { "dormantEdges": 5, "needsReviewEdges": 1, "confirmedUnauthorizedEdges": 0 },
    "snapshotCoverage": { "reviewPaths": 1, "matched": 0, "missingOrInvalid": 1, "ratio": 0 },
    "orphanGrants": 0,
    "folded": { "nodes": 0, "edges": 0 }
  },
  "nodes": [
    { "id": "agent:demo_agent", "kind": "agent", "label": "Demo Agent", "depth": 0,
      "meta": { "enabled": true, "roleIds": ["demo_readonly"], "tokenCount": 1, "grantUsers": 1, "grantPaths": 6 } },
    { "id": "token:demo_agent::p0-demo", "kind": "token", "label": "p0-demo", "parentId": "agent:demo_agent",
      "meta": { "status": "active", "createdAt": "2026-06-21", "callCount": 12, "lastUsedAt": "2026-10-19T..." } }
  ],
  "edges": [
    { "id": "e|agent:demo_agent|role:demo_readonly",
      "source": "agent:demo_agent", "target": "role:demo_readonly",
      "grantPaths": 6, "grantUsers": 1,
      "accessPaths": 3, "accessUsers": 1, "accessCalls": 12,
      "state": "normal", "confirmedUnauthorized": false }
  ]
}
```

`grantUsers` / `accessUsers` 在响应中以**计数**形式给出（不在响应里传 Set）。

### 6.3 URL 参数

| 参数 | 取值 | 说明 |
|---|---|---|
| `agent` | userId | 只看该 Agent 的子图 |
| `role` | roleId | 只看该角色的子图 |
| `token` | token label | **只过滤访问层**，授权层不变（§4.5） |
| `table` | `conn::schema::table` | 定位到该表 |
| `connection` | connectionId | 只看该连接的子图 |
| `window` | `24h` / `168h` / `720h` | 默认 `168h`（与 L25-03 使用概况一致） |
| `layer` | `flat` / `schema` | 默认 `flat`（折叠 Schema，§4.6） |
| `trust` | `confirmed` / `include_candidate` | 默认 `confirmed`（§4.9） |
| `view` | `map` / `table` | 默认 `map`；`table` 为无障碍等价视图（§7.5） |
| `focus` | node id | 下钻聚焦的节点 |

参数组合必须全部生效且可分享；非法参数值返回 400（用户可见错误按术语标准措辞）。

---

## 7. 交互规格

### 7.1 布局

- 横向从左到右分层：Agent → 角色 → 连接 → [Schema] → 表。
- 层内节点按出流权重降序排列，权重相同按 id 字典序（保证渲染稳定、可对比）。
- 使用 `d3-sankey` 的 `sankeyLinkHorizontal`，节点对齐（`nodeAlign = sankeyJustify`）保持列整齐。
- 节点纵向顺序做**交叉最小化**的轻量优化：按相邻列的连接目标做一次稳定排序（不追求全局最优，够用即可）。

### 7.2 节点与边交互

| 操作 | 行为 |
|---|---|
| 悬停节点 | 高亮该节点全部相连路径，其余淡出；浮层显示明细（去重 Agent 数、路径数、访问路径数、调用次数、异常计数） |
| 点击节点 | 下钻聚焦：只渲染该节点的连通子图；URL 写 `focus=<nodeId>`；提供「返回全图」 |
| 悬停边 | 浮层显示该边的两端、授权路径数、访问路径数、状态 |
| 点击边 | 选中该边，右侧面板展示该边的路径明细列表（可展开到单条授权路径） |
| 搜索框 | 按 Agent 名 / 角色 id / 表名定位并聚焦；无结果时明确提示 |
| 信号筛选 | 复选「僵尸授权」「需复核」「确凿越权」；筛选作用于**高亮与列表**，不改变数据本身 |

### 7.3 凭证清单

- 位于 Agent 节点正下方的虚线分隔区内，纵向排列每个 Token。
- 每条显示：`label`（主）、状态 Tag（active / expired / revoked）、统计期调用次数。
- 点击 → 只过滤访问层内核，UI 顶部出现提示条：「已按 Token `p0-demo` 过滤访问层，授权层不受影响」。
- 再次点击取消过滤。
- 凭证清单**不随路径数缩放**，不参与守恒。

### 7.4 图例与信号

- 图例固定在图区上方，说明：流带宽度 = 授权路径数；深色内核 = 访问路径数；虚线 = 凭证清单；警示描边 = 需复核 / 确凿越权。
- 图例必须标明当前访问层口径（`confirmed` 或 `含候选`）与统计窗口起止。
- 顶部信号条：「僵尸授权 N 条 · 需复核 M 条 · 确凿越权 K 条」，点击可筛选。

### 7.5 无障碍等价视图（SC-09）

SVG 桑基图对屏幕阅读器不友好，**必须**提供表格视图作为等价物：

- 切换按钮在页面头部：「关系图 / 数据表」。
- 数据表视图复用 `webui/docs/design-system/11-components-data-grid.md` 的 Base Contract，列出每一行一条边：起点、终点、授权路径数、去重 Agent 数、访问路径数、调用次数、状态。
- 图区本身提供 `aria-label` 摘要（节点数、边数、信号计数）+ 节点列表的可聚焦跳转。
- 键盘：`Tab` 聚焦节点列表项，`Enter` 下钻，`Esc` 返回全图。

### 7.6 空态与降级态

- 没有任何 Agent → 没有任何节点：显示空态「尚无 Agent 授权关系」，提供跳转「Agent 凭据」页的链接。
- 授权面 unavailable：显示三态原因（`access_unreadable` / `access_invalid` / `access_config_path_mismatch`），与角色权限页文案口径一致，并提供跳转「配置审计」的链接。
- 访问面 unavailable：图仍渲染授权骨架，访问内核位置显示「审计数据不可用」。

---

## 8. 技术实现

### 8.1 依赖

| 包 | 版本 | 许可 | 用途 |
|---|---|---|---|
| `d3-sankey` | `0.12.3` | MIT | 桑基布局（层分配、节点排序、交叉最小化） |
| `d3-shape` | `3.2.0` | MIT | `sankeyLinkHorizontal` 路径生成 |
| `@types/d3-sankey` | `0.12.5` | MIT | 类型定义（devDependency） |

- `d3-sankey` 仅依赖 `d3-array` + `d3-shape`，不引入整个 `d3` 伞包。
- 体积：`d3-sankey` 解包 46 KB；`d3-shape` 解包 247 KB（gzip 后约 7 KB）。**实施时须记录实际打包体积增量**。
- 建议按需加载：`import("d3-sankey")` 动态导入，避免进入首屏 bundle（依赖 §3 的「允许引入」选项，本期为强约束）。
- 依赖新增须走既有依赖审查流程（`docs/governance/DEVELOPMENT.md`）。

### 8.2 组件划分

```
webui/src/pages/admin/AccessMap.tsx          页面容器（头部、信号条、图/表切换）
webui/src/components/access-map/
  ├── AccessMapCanvas.tsx        SVG 渲染（d3-sankey 布局 + 流带 + 节点）
  ├── AccessMapLegend.tsx        图例
  ├── AccessMapSignalBar.tsx     顶部信号条 + 筛选
  ├── AccessMapCredentialList.tsx 凭证清单（Token 附属区）
  ├── AccessMapTable.tsx         表格等价视图
  └── accessMapTypes.ts          节点/边类型（与 API 契约一致）
webui/server/admin/access-map.ts 服务端：授权层 + 访问层构建 + 降级
```

### 8.3 性能预算

| 指标 | 预算 |
|---|---|
| API 响应（150 节点 / 400 边） | < 300 ms（本地 fixture） |
| 首帧渲染 | < 500 ms |
| 交互（悬停高亮 / 下钻） | < 100 ms |
| 表格视图切换 | < 200 ms |

降级优先于超时：宁可折叠，不可转圈。

---

## 9. Design System Compliance

引用章节与遵循点：

| 章节 | 遵循点 |
|---|---|
| `design-system/01-foundations-color.md` | 流带与内核只引用语义层 token（`fg/*` / `border/*` / `brand/*` / `success|warning|danger|info/*`），**禁止裸 hex**。状态色仅用于状态语义（僵尸授权 / 需复核 / 确凿越权），不得用于普通强调 |
| `design-system/02-foundations-grid-spacing.md` | 图区按桌面基线布局；最小可读宽度锁定，不做窄屏适配 |
| `design-system/03-foundations-typography.md` | 节点标签两行结构：主行名称用正文级字号，副行计数用次要文本色 |
| `design-system/10-components-button.md` | 图/表切换、信号筛选、返回全图等按钮走既有按钮分层与图标约定（`lucide-react`） |
| `design-system/11-components-data-grid.md` | 表格等价视图复用 Base Contract；列对齐、状态 Tag、行高与现有数据网格一致 |
| `design-system/20-patterns-page-layout.md` | 标准页面结构：页头（标题 + 描述 + 头部动作）→ 信号条 → 图区 → 侧边明细面板 |

**本轮已完成设计登记（不代表组件已实现）**

`webui/docs/design-system/99-governance.md` 的 TD-187-01 已登记：`series/grant` 与 `series/access` 各有 `default` / `subtle`；僵尸授权与需复核使用 `warning`，确凿越权使用 `danger`；需复核为虚线、确凿越权为实线；禁止裸 hex，状态不得只靠颜色区分。两组系列色实施时仍须验证流带与背景对比度，`danger` 不得用于非状态语义。本 Spec 的 §7.4 图例与 §4.4 状态引用以该登记为准。

---

## 10. 验收映射

**SC-01–SC-14 全部未执行。** 本轮仅完成需求与验收设计；未来实施须按授权边界留证，不把文档 lint 或上游既有功能证据转记为本功能验收通过。

| SC | 验收方式 | 断言要点 |
|---|---|---|
| SC-01 | 组件测试 + E2E | 四层主干渲染；节点副行同时含去重 Agent 数与路径数 |
| SC-02 | **单元测试：守恒自检** | 对随机权限配置，遍历所有非凭证节点，断言入流 `grantPaths` == 出流 `grantPaths`（误差 0） |
| SC-03 | 组件测试 | 构造「授权有 / 访问无」的 fixture，断言该边 `state === "dormant"` 且内核宽度为 0 |
| SC-04 | 组件测试 | 点击 Token 后断言：访问层内核变化，授权骨架边数与 `grantPaths` 不变；顶部提示条出现 |
| SC-05 | 单元测试 | 注入 `association_status = 'candidate'` 记录，断言默认口径下不计入内核；切到含候选口径后计入 |
| SC-06 | E2E | 从 Agent 详情页点击深链 → 独立页 URL 含 `agent=<id>` 且图已聚焦该 Agent |
| SC-07 | 单元测试 | 分别构造 `access_unreadable` / `access_invalid` / `access_config_path_mismatch`，断言渲染对应降级提示而非空图 |
| SC-08 | 单元测试 | 注入 200 节点配置，断言 `meta.folded.nodes > 0` 且图上有可见折叠徽标 |
| SC-09 | E2E / 可访问性检查 | 表格视图可切换，节点列表可 Tab 聚焦，图区有 `aria-label` 摘要 |
| SC-10 | 文案断言 | 需复核档的 UI 文案不含「越权」二字；确凿越权档文案含「调用当时授权亦不覆盖」 |
| SC-11 | `npm run lint:terminology` | 通过；术语标准 §4.8「访问权限升级」已含 §附录 A 的 6 个新词 |
| SC-12 | 现有测试全量 | `cd webui && npm test` 全绿；现有 Agent / 角色 / 审计页快照无变化 |
| SC-13 | 单元测试 + 文案断言 | 覆盖 matched／missing／invalid 快照；覆盖率分子分母正确，unknown 不升级为确凿越权 |
| SC-14 | 跨模块契约测试 | 同快照下摘要表集合等于授权路径表集合并集；多角色、重复访问时四种计数不混用 |

**E2E 边界**：`AGENTS.md` 规定 Lucy 默认不做浏览器测试。本 Spec 的 SC-06 / SC-09 需要 E2E 覆盖，**须在实施计划中显式批准**后才新增对应 Playwright 用例；未获批准前以组件测试 + 单元测试覆盖，不擅自扩展 E2E 套件。

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| **授权面与访问面量纲错配** | 双层对照失效，图变成误导 | §4.2 强制两侧同以 `(Agent, Role, Table)` 计数；SC-02 守恒自检作为门禁 |
| **当前授权 vs 历史访问的时间错配** | 误报越权 | §4.9 两档信号；第一档禁称「越权」；第二档用 `permission_snapshots` 当时快照判定；快照缺失时不下结论 |
| **合并 permissions 不可反推角色归因** | 角色层宽度错误 | §4.3 强制 per-role 解析；实现评审检查是否误用批量合并结果 |
| **规模爆炸**（表上千张） | 页面不可用 | §5.4 折叠预算 + 表格视图看全量；零授权表不入图 |
| **Schema 层展开后横向不可读** | 图不可用 | §4.6 默认折叠 Schema，开关显式 |
| **Token 过滤造成误读** | 用户以为授权变窄 | §4.5 交互诚实性：只过滤访问层 + 顶部提示条 |
| **新增图表依赖影响首屏** | 性能回归 | §8.1 动态导入按需加载 + §8.3 性能预算 |
| **颜色语义缺口** | 违反设计系统 | TD-187-01 已完成设计登记；实施时验证对比度与文本／线型降级 |
| **与 L25-01 数字不一致** | 同一仓库两个口径 | §3.3 要求同快照、表集合并集对账；路径数与去重表数分开，SC-14 验证 |

---

## 12. 文档交叉引用与后续动作

### 12.1 交叉引用

- `webui/docs/06-navigation-ia.md` — 当前导航事实与 v0.25 P1 规划入口分表维护
- `webui/docs/00-product-terminology-standard.md` — 术语标准 §4.8
- `webui/docs/07-mcp-auth-proxy-spec.md` — 运行时授权与裁决（本图只读，不改）
- `webui/docs/14-agent-admin-enterprise-delivery-spec.md` / `15-role-admin-spec.md` — Agent / Role Admin 契约
- `webui/docs/128-enterprise-kpi-contract-spec.md` — 统计窗口口径（`metric-window.ts`）
- `webui/docs/131-lucy-admin-catalog-bound-role-spec.md` — `catalog_bound` 源范围语义（影响授权路径的表集合）
- `webui/docs/124-audit-query-artifact-cold-store-spec.md` / `125-audit-generated-sql-hot-store-spec.md` — 审计存储（访问层数据源）
- `webui/docs/186-trust-boundary-inventory-spec.md` — 信任边界（`association_status` 口径）
- [P1-1 行策略模板与按表反查 Spec](../../docs/specs/lucy-20261025-v0p25-row-policy-templates-and-view-spec.md) — 同源行边界与只读深链
- [P1-2 授权摘要 Spec](../../docs/specs/lucy-20261025-v0p25-access-authorization-summary-spec.md) — 表集合、快照与深链对账
- `docs/access-control/README.md` — 访问权限域索引
- `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` — v0.25 建议书，登记 L25-08 及本批 P1 范围

### 12.2 已裁决设计项

1. **Schema 层**：本期默认折叠，可经 URL 开关展开；折叠不改变计数。未来是否调整默认值须另行依据真实规模证据裁决。
2. **多角色重复授权**：固定使用「去重 Agent 数＋授权路径数」双计数；不得为了图面简化而合并角色路径或把二者互换。
3. **访问信任口径**：`confirmed_only` 只按 `association_status`；本期不把 `confidence` 叠加成第三档，避免与 audit-trust 域形成第二套口径。
4. **快照证据边界**：缺失／无效快照只保留需复核，不判确凿越权；响应和页面披露快照覆盖率，低覆盖率不解释为低越权率。

### 12.3 设计登记与实施待办

| # | 动作 | 位置 | 状态 |
|---|---|---|---|
| 1 | 增补 §附录 A 的 6 个新术语 | `webui/docs/00-product-terminology-standard.md` §4.8 | 设计登记完成 |
| 2 | 登记「授权层 / 访问层」两组系列色与状态映射 | `webui/docs/design-system/99-governance.md` TD-187-01 | 设计登记完成 |
| 3 | 登记行权限视图与访问关系图规划入口 | `webui/docs/06-navigation-ia.md` + `webui/docs/61-help-sidebar-entry-map-spec.md` | 设计索引已登记；路由与导航实现待办 |
| 4 | 建议书登记 L25-08 与 P1 Spec | `docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md` | 设计索引已登记 |
| 5 | 域索引交叉引用本文及 P1-1／P1-2 | `docs/access-control/README.md` §1 | 设计索引已登记 |

---

## 附录 A：术语登记清单

供 `webui/docs/00-product-terminology-standard.md` §4.8「访问权限升级」直接摘录：

| Canonical Term | UI 主术语 | 定义 | 禁止混淆 |
|---|---|---|---|
| Access Map | 访问关系图 | 展示 Agent 授权面与实际访问面的关系图 | 拓扑图、权限流向图、桑基图 |
| Grant Path | 授权路径 | `(Agent, Role, Connection, Schema, Table)` 的存在性实例 | 权限、授权项、访问路径 |
| Access Path | 访问路径 | 统计窗口内至少有一次允许调用的去重 `(Agent, Role, Connection, Schema, Table)` 存在性路径 | 调用次数、请求数 |
| Dormant Grant | 僵尸授权 | 授权路径数 > 0 且访问路径数 = 0 的边 | 未使用权限、闲置资源 |
| Needs-review Signal | 需复核信号 | 访问路径数 > 0 但当前授权无对应授权路径的边 | 越权 |
| Credential List | 凭证清单 | 挂在 Agent 下的 Token 附属区，不承载授权 | 权限节点、凭证流 |

## 附录 B：示例数据（自洽性样例）

以下样例用于实现自测，**不代表**任何客户配置：

```yaml
# access.yaml 片段
roles:
  demo_readonly:
    allow:
      connections: [demo-mysql]
      tableSelectors:
        - connection: demo-mysql
          schema: dataforai
          names: [superstore_orders, superstore_returns, superstore_people]
users:
  - id: demo_agent
    name: Demo Agent
    enabled: true
    tokens:
      - { hash: "sha256:8ccee2d0...", label: p0-demo, created: 2026-06-21 }
    role: demo_readonly
```

派生结果：

| 层 | 节点 | 出流 `grantPaths` | 说明 |
|---|---|---|---|
| Agent | `agent:demo_agent` | 3 | 经 1 个角色可读 3 张表 |
| Role | `role:demo_readonly` | 3 | |
| Connection | `conn:demo-mysql` | 3 | |
| Table | `table:demo-mysql::dataforai::superstore_orders` | 0（终点） | 标签「1 个 Agent · 1 条路径」 |
| 凭证清单 | `token:demo_agent::p0-demo` | — | 不参与守恒 |

若审计窗口内 `superstore_orders` 被 `p0-demo` 访问 4 次（allow）、`superstore_returns` 被访问 2 次、`superstore_people` 未被访问：

- `edge(agent→role).accessPaths = 2`、`accessCalls = 6`
- `edge(role→conn).accessPaths = 2`
- `edge(conn→table:superstore_orders).accessPaths = 1`、`accessCalls = 4`、`state = "normal"`
- `edge(conn→table:superstore_people).accessPaths = 0`、`state = "dormant"`（僵尸授权）
- 守恒校验：Agent 出流 3 == Role 入流 3 == Connection 入流 3 == Table 入流合计 3 ✔
