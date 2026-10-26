# 库表发现与持续感知 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 库表发现与持续感知 Spec |
| 文档类型 | Spec |
| 编号 | 190 |
| 版本 | **v0.2** |
| 撰写日期 | 2026-10-26 |
| 状态 | **待审阅，未授权实现**（v0.1 审阅意见已并入，见 §1.4） |
| 适用范围 | `/connections` 连接概览（最小展示）、连接级接入预览、运行时 sidecar `.ktx-ui/`。不改语义层 overlay 维护面 |
| 上游 Spec | 17（零 AI 依赖）、21 / 28 / 29 / 34（不扫物理库边界）、107（库内目录）、116（启用表范围门禁）、164（读取表结构）、182（启用表范围交集）、183（导入范围预览）、L25-11（语义资产批量维护） |
| 关联审阅 | [`docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md`](../../docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md) |
| 关联评估 | [`docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md`](../../docs/specs/lucy-20261026-warehouse-table-scan-capability-analysis.md) |
| 关联工单 | [`webui/docs/plans/wo-202610-26-live-table-discovery-and-continuous-sync.md`](plans/wo-202610-26-live-table-discovery-and-continuous-sync.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿。定义 Schema 级表清单、接入范围预览接入发现结果、持续感知与结构差异清单。写盘结构事实、自动启用与批量补齐列为非目标 |
| **v0.2** | **并入 2026-10-26 交叉审阅意见。** ① 新增「最新成功快照」存储契约，S2 改为消费快照而非差异记录（P0-1）② 拆分「当前对账状态」与「变更事件历史」，移除 `union` 累积；明确首轮只建基线不出事件（P0-2）③ 新增差异读取端点与列级深查端点，并纳入最小 UI 交付（P0-3）④ 差异能力拆成「表清单差异」（每轮自动）与「表结构差异」（按需深查）两层，修正 v0.1 §6.3「段 1 看不到表级变化」的事实错误（P0-4 / P1-1）⑤ 错误码词表补为封闭式，并给保守分类规则（P1-5）⑥ 补齐 per-Schema 状态、聚合规则、退避与恢复语义（P1-4）⑦ 验收项由 SC-1~SC-17 扩为 SC-1~SC-29，覆盖审阅列出的 10 项缺口（P1-6） |

---

## 1. 背景与问题

### 1.1 现状

Lucy 对物理库的只读访问只有三条路径：

| 能力 | 粒度 | 协议 | 触发 |
|---|---|---|---|
| 连接测试 | 连接 | 由 KTX 决定 | 手动 |
| 库内目录（live-schemas） | Schema + 表计数 | mysql/pg/sqlserver/oracle | 进页懒加载 |
| 读取表结构（schema-structure） | Schema 的列结构 | mysql/pg | 手动，逐 Schema |

三处缺口：

1. **没有表级清单**。全仓不存在「列出某 Schema 下所有表名」的只读端点；表名只能从列行反推，或从本地 Schema Manifest 读。
2. **存量连接没有入口**。读取表结构这条路（Spec 164）是为「刚添加 Schema」设计的。历史已存在的连接若缺 Schema Manifest，只能手工上传 YAML 或离线 `ktx ingest`。
3. **库内新增表不会被感知**。Schema Manifest 是本地静态文件，库里的表变了，本地不知道。运维只能人工重跑一次全量流程。

### 1.2 存量连接的真实形态

Manifest 的表是唯一 source 来源（`catalog-reload.ts:244-275`、`semantic-layer.ts:425`）。因此：

- `enabled_tables` 里的表若没有对应 Manifest 条目，就不是真实 source，角色拿不到；
- `enabled_tables` 缺省或为空时，按 Spec 182 是空集（不退回全表），点到该连接的 selector 角色与 `catalog_bound` 角色零命中，角色编译失败，而 Pod 仍然 Ready。

而仓库内无法证明现网存量连接是否处于该状态（2026-08-28 升级评审 §7 明确承认这一点）。**「存量连接到底缺什么」目前没有人能回答**，只能人工逐个连接点开看。

### 1.3 上游已有的扫描面

运行中 Lucy MCP Proxy 的 `entity_details` 在无扫描快照时返回：

```text
scan_missing: No live-database scan found for connection "<id>";
run `ktx ingest <id>` or `ktx scan <id>`.
```

即 KTX 侧已维护 per-connection 的 live-database scan snapshot，且 Lucy 已经能读它。本 Spec 不新建快照**语义**面（见 §6.2）。

### 1.4 v0.1 审阅意见的处置

2026-10-26 交叉审阅（[`docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md`](../../docs/reviews/2026-10-26-spec-190-plan-work-order-cross-review.md)）判定「方向认同，但不建议按 v0.1 批准生产代码实施」，列 P0 四条、P1 六条。v0.2 逐条处置如下：

| 审阅项 | v0.2 处置 |
|---|---|
| P0-1 S2 无持久化成功快照 | §5.2 新增「最新成功快照」存储契约；S2 改为消费快照（§7.2） |
| P0-2 对账与前后轮混用 | §5.1 拆成四类数据；§8.3 当前对账状态按快照重算；§8.4 事件历史不再 `union` 累积；§8.2 明确首轮只建基线不出事件 |
| P0-3 差异无读取端点 | §7.3 新增差异读取端点、§7.4 新增列级深查端点；§2 与 WO 纳入最小 UI 交付 |
| P0-4 结构差异名不副实 | §6.3 拆成「表清单差异」（每轮自动）与「表结构差异」（按需深查）两层，各自诚实命名 |
| P1-1 两段式未进流程 | §6.3 重写；§8.2 写入轮转与升级条件；后台不消费面向人工的 TTL 缓存（§6.4） |
| P1-2 WO 扩大 KTX 阻塞 | WO v0.2：T0 的 KTX 结论只阻塞 S3 生产 provider 选择，不阻塞 T1 |
| P1-3 依赖与回滚矛盾 | WO v0.2 按真实依赖重写实现顺序与回滚 |
| P1-4 部分失败被记为 pass | §8.2 per-Schema 状态 + 连接级聚合规则（§7.6） |
| P1-5 错误码词表未闭合 | §7.1 补为封闭式词表并给保守分类规则 |
| P1-6 SC 覆盖不足 | §11 扩为 SC-1 ~ SC-29 |

---

## 2. 目标

1. 提供 **Schema 级库内表清单**只读能力：表名、表类型、列数、表注释。
2. 让 **连接级接入预览**（import-scope）的「发现表」由已持久化的成功快照自动填入，不再必须由调用方手工传入。
3. 提供 **持续感知**：后台定期读取库内表清单，产出**当前对账状态**（库 vs Manifest vs 启用表范围）与**变更事件历史**（库内前后轮变化）。
4. 按需提供 **表结构差异深查**：对指定表比较列名、类型、可空、主键。
5. 差异与状态**落盘**（`.ktx-ui/`），Pod 重启后不丢；只读呈现，不打断用户。
6. 感知行为**可按连接关闭、可配置间隔**；失败按 Schema 隔离，有明确原因，可自动恢复或进入人工暂停。
7. 全程**只读**；不写 Schema Manifest，不写 `enabled_tables`，不改角色权限。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| 自动写 Schema Manifest（追加新表） | 自动改「已发现表」口径会影响启用表范围页与角色有效 source。需 staging + 确认 + 基线对账，依赖 L25-11（当前「设计完成、待需求审查；暂不开发」）。另立 Spec |
| 自动写 `enabled_tables` | 这是授权变更。Spec 182 与 L25-11 均要求「不把导入等同授权」 |
| 自动移除已消失表的本地条目 | 移除 = 改授权 + 破坏性操作。只报告，不自动执行 |
| 一次性扫描全部 Schema 的批量补齐 | 依赖 L25-11 的 staging 与发布工作台 |
| 数据画像（采样、空值率、基数、Top 值） | 独立能力，依赖 L3 立项 |
| 语义生成（业务描述、指标、维度） | 依赖 L4 立项；且与零 AI 依赖原则冲突（§9.1） |
| 覆盖已有 Schema Manifest | 交付给客户的 Manifest 含 `descriptions.ai`（来自 KTX ingest 增强），Lucy 生成的最小 Manifest 只有 `descriptions.db`。覆盖即抹掉语义 |
| 每轮自动做列级结构比对 | 列级比对成本高且受行数上限约束（§6.3）。改为按需深查 |
| 新增数据库类型接入 | 本轮表级能力与 `schema-structure.ts` 的可读判定对齐：mysql / postgres 家族（StarRocks、Doris 按 mysql）。sqlserver / oracle 的表级清单延期 |
| 事件驱动的变更捕获 | MySQL binlog 需 `REPLICATION SLAVE` 权限、Postgres event trigger 需超级用户、Oracle / SQL Server 无等价机制，客户库通常不给。只做轮询 |
| 完整的差异管理界面 | 本轮只做最小展示（状态 + 计数 + 清单查看）。批量启用与批量补结构属 L25-11 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md`。本 Spec 引入新词并已登记到术语标准 §4.1。

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Live Table List | 库内表清单 | 物理表清单、扫描结果、库内表名 | 物理库账号可见的表名清单。非 Schema Manifest、非启用表范围 |
| Table Structure | 表结构 | 表定义、字段清单 | 物理表的列、类型、可空、主键与注释 |
| Table List Diff | 表清单差异 | 结构差异、变更清单、差异结果 | 自动层的差异：新增表、已消失表、列数变化 |
| Table Structure Diff | 表结构差异 | 深度扫描结果、列级差异报告 | 按需深查的列级差异：列名、类型、可空、主键 |
| Reconciliation State | 当前对账状态 | 差异结果、对比结果 | 最新快照与 Schema Manifest、启用表范围的当前差集 |
| Change Event | 变更事件 | 操作日志、变更记录 | 库内前后两轮之间发生过的变化，仅供审计与追踪 |
| Continuous Discovery | 持续感知 | 自动扫描、定时扫描、后台扫描 | 后台定期读取库内表清单并比对。只读，不改授权 |
| Discovery Paused | 持续感知已暂停 | 扫描暂停、发现失败 | 凭据或连通性原因导致持续感知停止。必须带具体原因 |
| Read Table Structure | 读取库表结构 | 扫描、物理扫描、重新扫描物理库 | 只读读取物理库的表结构 |

沿用既有说法：库内目录、库内表数、已发现表数、已启用表数、无效启用、启用表范围、Schema Manifest、添加 Schema、目标 Schema、刷新本地目录。

本 Spec 的 UI 文案**不得**出现：扫描、物理扫描、重新扫描物理库、Ingest、白名单、本地表数。

Protected：`Schema`、连接 ID、Schema 名、`ktx sql`、`information_schema`、`ktx.yaml`、`semantic-layer`、`enabled_tables`、`.yaml` 节点必须加浏览器翻译防御（`translate="no"` + `className="notranslate"`）。

---

## 5. 事实源与数据层

### 5.1 四类数据（互不混用）

| 数据 | 内容 | 主要消费者 | 生命周期 |
|---|---|---|---|
| **最新成功快照** | 每连接、每 Schema 的完整表清单（表名、表类型、列数、注释） | 接入预览、当前对账状态 | 同代次最近一次成功结果；持久化 |
| **物理基线** | 上一轮用于变化检测的表清单 | reconciler | 成功处理后推进；落盘失败不推进 |
| **当前对账状态** | 最新快照与 Schema Manifest、启用表范围的当前差集 | 差异读取端点、连接概览 | 随最新快照或本地资产变化而重算；**不累积** |
| **变更事件历史** | 曾经发生的新增、消失、列数变化与失败 | 审计、问题追踪 | 每连接限量保留；**不冒充当前状态** |

**关键区分**：

- 「当前对账状态」回答**本地缺什么、本地多什么**（库 vs Manifest vs 启用表范围）——这是存量连接最需要的答案。
- 「变更事件历史」回答**物理库新增、删除或变化了什么**（本轮库 vs 上一轮库）——这是持续运营需要的答案。
- 两者**不得**互相冒充。读取当前状态时按最新快照**重新计算**，不累加历史事件；表恢复、再次变化或本地后来补齐后，旧差异必须从当前状态中消失。

**物理基线 = 上一份成功快照**。实现上保留两份（当前 / 上一份）即可，不另设第三个存储。

### 5.2 存储契约

三个 sidecar 文件，均在 `<projectRoot>/.ktx-ui/` 下（与 `catalog-reloads.json`、`ingest-runs.json` 同构；**不进 content root，不进 git，不进交付包**）。

#### ① `live-table-snapshots.json` — 最新成功快照

```ts
type LiveTableSnapshot = {
  connectionId: string;
  schema: string;
  generation: number;          // 连接配置代次
  provider: "ktx_sql" | "ktx_scan";
  fetchedAt: string;           // ISO，完成时间
  tables: Array<{
    table: string;             // 物理表名
    tableType: "BASE TABLE" | "VIEW";
    columnCount: number;
    tableComment?: string;
  }>;
  previousFetchedAt?: string;  // 上一份快照的时间；即为物理基线
};
```

- 按 `connectionId + schema` 键存**当前**与**上一份**两份。
- 表身份统一为 `schema.table`，与 Spec 182 / 183 的 `normalizeRef(physicalTable)` 一致。
- 写入原子（临时文件 + rename），文件模式 `0600`。
- **只存表名、列数、注释与时间戳；不存列内容、不存样本值。**
- 落盘成功后，新快照成为「当前」，原「当前」降为「上一份」（即基线）。**落盘失败 ⇒ 当前与基线均不变**，下一轮重报同一差异。

#### ② `live-table-discovery.json` — 配置与状态

```ts
type DiscoveryConfig = {
  connectionId: string;
  enabled: boolean;
  intervalMs: number;         // 白名单值
  generation: number;
  schemas: Record<string, {
    status: "ok" | "error" | "paused";
    lastAttemptAt: string;     // 最后一次尝试开始
    lastCompletedAt: string | null;  // 最后一次成功完成
    lastReason: LiveTableFailureReason | null;
    consecutiveFailures: number;
    nextAttemptAt: string | null;     // 退避后的下次尝试
  }>;
};
```

- **不进 `ktx.yaml`**：避免触碰 KTX 配置 schema（`ktx admin schema` 定义），未知字段可能被 KTX 拒绝。

#### ③ `live-table-events.json` — 变更事件历史

```ts
type ChangeEvent = {
  connectionId: string;
  schema: string;
  generation: number;
  at: string;                  // 事件时间
  kind: "added" | "missing" | "column_count_changed";
  tables: string[];            // schema.table
  provider: "ktx_sql" | "ktx_scan";
};
```

- 每连接保留最近 50 条（`MAX_RECORDS`）。
- 事件**只追加**，不参与当前状态计算。

### 5.3 库内目录、库内表清单、Schema Manifest、启用表范围的边界

| 口径 | 含义 | 与其它口径的关系 |
|---|---|---|
| 库内目录 | 账号可见的 Schema 列表与表计数 | 连接级；已有 |
| 库内表清单 | 账号可见的表名、表类型、列数、注释 | Schema 级；本 Spec 新增 |
| 已发现表数 | Schema Manifest 已读入本地目录的表数 | 本地事实 |
| 已启用表数 | `enabled_tables` | 授权范围 |

四者严格区分，UI 不得合并列（沿用 Spec 107 §5.2 的三列分离口径）。

---

## 6. 发现能力的实现路径与查询形状

### 6.1 协议支持

本轮表级能力与 `schema-structure.ts` 的可读判定对齐：**mysql / postgres 家族**（StarRocks、Doris 按 mysql）。sqlserver / oracle 已有 Schema 级计数（`live-catalog.ts`），但**表级清单延期**——延期原因写明，避免「4 种协议都支持」的误解。

### 6.2 provider 抽象

本 Spec 只规定接口与结果语义，不锁定实现：

```ts
type LiveTableProvider = {
  /** 返回该 Schema 的表清单；不抛业务错误，失败以 reason 返回 */
  listTables(input: {
    projectRoot: string;
    connectionId: string;
    schema: string;
    generation: number;
  }): Promise<{
    status: "ok" | "error";
    tables: LiveTableSnapshot["tables"];
    fetchedAt: string;
    reason?: LiveTableFailureReason;
  }>;
};
```

**两条候选路径**：

| 路径 | 内容 | 状态 |
|---|---|---|
| **A. 编排 KTX scan** | 调用交付版 KTX 的扫描能力，读其 per-connection 快照 | 待 T0 实测决定 |
| **B. 只读 SQL 适配层** | `ktx sql` 查 `information_schema`，与 `schema-structure.ts` 同源 | **默认可用，不被 T0 阻塞** |

**交付要求**：统一接口 + 测试假实现 + **一套生产实现**（按 T0 结论选 A 或 B）。不要求同时交付两套生产实现。

> **前置调研项（只阻塞 S3 的 provider 选择，不阻塞 S1/S2）**：交付镜像锁 `KTX_VERSION=0.16.0`（`Dockerfile:22`）。本机 CLI `@kaelio/ktx` 0.12.0 执行 `ktx scan --help` 返回 `unknown command 'scan'`，而运行实例的 MCP 错误信息建议 `ktx scan`。两者不一致，且 `docs/specs/lucy-platform-goal-checklist.md:87` 记录的「KTX 0.16.0 无顶层 `scan` 命令」需要复核。开工 S3 前必须实测：命令是否存在、参数、是否需要 AI / enrichment、扫描产物落在哪。

### 6.3 两层差异能力（成本分层）

| 层 | 内容 | 触发 | 查询形状 | 行数 |
|---|---|---|---|---|
| **表清单差异**（自动） | 新增表、已消失表、列数变化 | 每轮持续感知 | 按 Schema 一条聚合查询 | = 表数 |
| **表结构差异**（按需） | 列名、类型、可空、主键的增删改 | 用户对指定表发起 | 按表查列行 | = 列数 |

**自动层查询形状**（以 mysql 为例）：

```sql
SELECT t.table_name, t.table_type, t.table_comment, COUNT(c.column_name) AS column_count
FROM information_schema.tables t
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema AND c.table_name = t.table_name
WHERE t.table_schema = '<schema>' AND t.table_type = 'BASE TABLE'
GROUP BY t.table_name, t.table_type, t.table_comment
```

关键点：**由数据库侧聚合到表粒度**，返回行数 = 表数而非列数，因此不受「列行数上限 10000」的约束（500 张表 × 20 列 = 10000 列行会撞上限，聚合后只有 500 行）。

**按需层查询形状**：复用 `schema-structure.ts` 已有的列行查询（列名、类型、可空、主键、注释），在**应用侧**按表分组比较。

> **不在每轮自动做列级比对的理由**：① 应用侧聚合会撞 10000 列行上限；② DB 侧 `GROUP_CONCAT` 有 `group_concat_max_len`（默认 1024）截断风险，截断后摘要错误且不可察；③ 每轮成本随列数线性增长。改为按需深查，成本可控且结论精确。

### 6.4 缓存与轮询间隔的关系

| 消费者 | 缓存 | TTL |
|---|---|---|
| 人工读取（`purpose=manual`） | 面向人工的表清单缓存 | 10 分钟 |
| **后台持续感知（`purpose=automatic`）** | **独立缓存条目** | **= 轮询间隔** |

**后台轮询不得消费面向人工的 TTL 缓存**，否则 5 分钟轮询会命中 10 分钟缓存，实际感知频率退化为 10 分钟，且缓存命中会让该轮「无差异」被误判为库未变化。

> v0.1 §6.3 写「绝大多数轮次只花段 1 的代价」是**事实错误**：Schema 级计数（段 1）根本看不见表级变化，表级新增 / 删除只能由表粒度查询发现。v0.2 删除该表述，改为 §6.3 的两层划分。

### 6.5 轮转与升级条件

每轮持续感知：

1. 读库内目录（已有 `live-schemas`）→ 得到账号可见的 Schema 集合与表计数。
2. 对**已跟踪的 Schema**（配置里有、快照里有）逐个执行表粒度查询 → 与上一份快照比较 → 产出表清单差异。
3. 对**新出现的 Schema**（配置里有、快照里没有）执行同一查询 → **建立基线**，产出当前对账状态，**不产出变更事件**（没有上一份可比）。
4. 对配置里没有的 Schema 不查询、不跟踪。

**升级条件**：Schema 集合变化（新增 / 消失）只影响该 Schema 的基线建立或停用，不触发其它 Schema 的全量重扫。

---

## 7. API 契约

### 7.1 `GET /api/connections/:connId/live-tables`

只读。Query：`schema`（**必填**）、`refresh=1`（可选，绕过面向人工的 TTL）。

> `schema` 必填是刻意的：连接级一次拉全量表清单在万表库上不可行。连接级汇总由 `live-schemas` 承担。

成功（HTTP 200）：

```ts
{
  ok: true,
  data: {
    status: "ok",
    connectionId: string,
    schema: string,
    tables: Array<{
      table: string;              // 物理表名（不含 Schema 前缀）
      tableType: "BASE TABLE" | "VIEW";
      columnCount: number;
      tableComment?: string;
    }>,
    fetchedAt: string,            // ISO
    cached: boolean,
    latencyMs?: number,
    wireProtocol: "mysql" | "postgres" | "unknown"
  }
}
```

失败（HTTP 200，与既有只读端点同构，便于分连接 UI）：

```ts
{
  ok: true,
  data: {
    status: "error",
    connectionId: string,
    schema: string,
    tables: [],
    fetchedAt: string,
    cached: false,
    reason: LiveTableFailureReason,
    wireProtocol: "mysql" | "postgres" | "unknown"
  }
}
```

#### `LiveTableFailureReason`（封闭式词表）

| reason | 触发条件 | 归类策略 |
|---|---|---|
| `PROTOCOL_UNSUPPORTED` | 连接协议不可识别 | 确定 |
| `TABLE_LIST_UNSUPPORTED` | 该协议不支持表级清单（sqlserver / oracle 等） | 确定 |
| `CONNECTION_FAILED` | 连不上（DNS 拒绝、超时、进程退出） | 确定 |
| `AUTH_FAILED` | 凭据无效 / 明确拒绝 | 确定（stderr 明确为认证类） |
| `SCHEMA_NOT_FOUND` | 数据库**明确**报告该 Schema 不存在 | **仅在错误信息明确时使用** |
| `SCHEMA_NOT_VISIBLE` | Schema 可能存在但账号无权限 | **保守默认**：无法区分不存在与不可见时归此类 |
| `TABLE_LIST_TOO_LARGE` | 命中行数上限 | 确定；**不静默截断** |
| `QUERY_FAILED` | 其它查询失败（语法、类型、权限被拒但不可分类） | 保守默认 |
| `PROBE_QUEUE_FULL` | 探测队列已满 | 确定 |
| `PROBE_QUEUE_TIMEOUT` | 排队超过 60 秒 | 确定 |
| `GENERATION_INVALIDATED` | 探测期间连接配置代次变化，结果作废 | 确定 |
| `PROVIDER_UNAVAILABLE` | provider 不可用（KTX scan 不存在、CLI 缺失等） | 确定 |
| `SNAPSHOT_WRITE_FAILED` | 快照落盘失败 | 确定；**基线不推进** |

**保守分类规则**（回应审阅 P1-5）：

- 多数数据库对「Schema 不存在」与「无权限」返回同样的信息（MySQL 的 `information_schema` 只显示有权限的 Schema；Postgres 权限不足时直接报权限错）。
- 因此：**只有错误信息明确指出「对象不存在」时才用 `SCHEMA_NOT_FOUND`；其余无法区分的一律归 `SCHEMA_NOT_VISIBLE`**。宁可提示「检查权限」，也不断言「表被删了」——后者会误导运维去恢复表。
- 分类逻辑集中在**一个**函数里，输入为 `ktx sql` 的 `exitCode` + `stdout` + `stderr`，输出为 reason。每个 reason 都要有单测。

HTTP 状态码：连接不存在 → `404 CONNECTION_NOT_FOUND`；`schema` 缺失或非法 → `400 BAD_REQUEST`。

### 7.2 `GET /api/connections/:connectionId/import-scope`（升级）

沿用 Spec 183 的四份对账 + 两份差异，**唯一变化**：`discovered` 的来源优先级。

1. 调用方显式传 `?discovered=` ⇒ 以传入值为准，`discoverySource: "manual"`。
2. 未传 ⇒ 取 `live-table-snapshots.json` 中该连接该 Schema **最新成功快照**（`generation` 与当前连接配置代次一致）⇒ 填入，`discoverySource: "continuous"`。
3. 未传且无匹配快照 ⇒ `discovered` 为空，`discoveryExecuted: false`，`discoverySource: "none"`。

**消费的是快照，不是差异记录**（回应审阅 P0-1）。差异记录只含变化量，不含完整表清单。

**不得**为了填满 `discovered` 而在本端点内同步连库（Spec 183 明确「不要连真实数据库」）。本端点只消费已持久化的快照。

响应新增字段：`discoverySource: "manual" | "continuous" | "none"`。

### 7.3 `GET /api/connections/:connId/table-diff`（新增）

返回**当前对账状态**与**变更事件历史**。

Query：`schema`（可选，缺省=该连接全部 Schema）、`includeEvents=1`（可选，默认只返回事件计数）。

```ts
{
  ok: true,
  data: {
    connectionId: string,
    generation: number,
    computedAt: string,
    schemas: Array<{
      schema: string;
      // 当前对账状态（按最新快照重算，不累积）
      reconciliation: {
        discoveredInLibrary: string[];      // 库内表清单
        missingInManifest: string[];        // 库里有、本地 Manifest 没有
        missingInEnabled: string[];         // 库里有、启用表范围没有
        notInLibrary: string[];             // 本地 Manifest 有、库里没有
      };
      // 表清单差异（本轮库 vs 上一轮库）
      listDiff: {
        added: string[];                   // schema.table
        missing: string[];                 // 库中已消失
        columnCountChanged: Array<{ table: string; before: number; after: number }>;
      };
      snapshotAt: string | null;           // 最新成功快照时间；null = 从未成功
    }>;
    events: Array<ChangeEvent>;            // includeEvents=1 时返回
    eventCount: number;
  }
}
```

**计算规则**：`reconciliation` 由「最新成功快照 + 本地 Manifest + `enabled_tables`」**每次重算**；`listDiff` 由「最新成功快照 vs 上一份快照」算出。两者都不读事件历史。

### 7.4 `GET /api/connections/:connId/table-structure-diff`（新增，按需深查）

Query：`schema`（必填）、`tables`（必填，逗号分隔的表名，最多 20 张）。

```ts
{
  ok: true,
  data: {
    connectionId: string,
    schema: string,
    tables: Array<{
      table: string;
      status: "ok" | "error" | "not_in_library";
      reason?: LiveTableFailureReason;
      columns: {
        added: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean }>;
        removed: Array<{ name: string; type: string; nullable: boolean; primaryKey: boolean }>;
        changed: Array<{ name: string; before: { type: string; nullable: boolean; primaryKey: boolean }; after: { type: string; nullable: boolean; primaryKey: boolean } }>;
      };
    }>;
  }
}
```

- 基线来源：本地 Schema Manifest 中该表的列定义（结构事实源）。
- 逐表独立失败：一张表查失败不影响其它表（逐表 `not_in_library` / `error`）。
- 每次调用都真实查库（只读），**不读快照**——因为快照只到列数粒度。
- 命中列行上限 → 该表 `status: "error"`, `reason: TABLE_LIST_TOO_LARGE`。

### 7.5 `GET /api/connections/:connId/discovery`

```ts
{
  ok: true,
  data: {
    connectionId: string;
    enabled: boolean;
    intervalMs: number;
    generation: number;
    // 连接级聚合状态（规则见 §7.6）
    status: "ok" | "partial" | "error" | "paused" | "never_run";
    lastAttemptAt: string | null;        // 最后一次尝试开始
    lastCompletedAt: string | null;      // 最后一次成功完成
    schemas: Array<{
      schema: string;
      status: "ok" | "error" | "paused";
      lastAttemptAt: string;
      lastCompletedAt: string | null;
      lastReason: LiveTableFailureReason | null;
      consecutiveFailures: number;
      nextAttemptAt: string | null;
    }>;
    diffCount: { added: number; missing: number; columnCountChanged: number };
  }
}
```

### 7.6 连接级状态聚合规则

| 条件 | `status` |
|---|---|
| 从未尝试过 | `never_run` |
| 该连接全部 Schema 本轮成功 | `ok` |
| 部分 Schema 成功、部分失败 | **`partial`** |
| 全部 Schema 失败 | `error` |
| 全部 Schema 处于人工暂停 | `paused` |

`lastAttemptAt` = 最后一次**尝试开始**时间；`lastCompletedAt` = 最后一次**成功完成**时间。两者语义不同，UI 都要展示。

### 7.7 `PUT /api/connections/:connId/discovery`

**owner 限定**（对齐 Spec 107 的「Owner 按需」措辞）。

请求体：`{ enabled: boolean; intervalMs: number }`

- `intervalMs` 允许值（白名单）：`300_000`（5 分钟）、`900_000`（15 分钟）、`1800_000`（30 分钟）、`3600_000`（1 小时）、`21600_000`（6 小时）、`86400_000`（24 小时）。默认 `3600_000`。
- 越界 → `400 BAD_REQUEST`，配置不变。
- 关闭时 `intervalMs` 保留，便于再次开启。
- 关闭后后台不再发起任何库表查询；已有快照与事件保留。

### 7.8 权限与审计

| 端点 | 读权限 | 写 | 审计 |
|---|---|---|---|
| `live-tables` | 已登录管理员 | — | 写 discovery 审计事件（时间、连接、Schema、耗时、结果、reason） |
| `table-diff` | 已登录管理员 | — | 同上 |
| `table-structure-diff` | 已登录管理员 | — | 同上 |
| `import-scope` | 已登录管理员 | — | 沿用既有 |
| `GET discovery` | 已登录管理员 | — | 沿用既有 |
| `PUT discovery` | **owner** | 写 sidecar | 必须走 `auditedWriteFile` / `recordConfigChange` 等价路径 |

**审计事件字段**：`at`、`connectionId`、`schema`、`action`（`list` | `structure_diff` | `reconcile`）、`outcome`（`ok` | `error`）、`reason`、`latencyMs`、`tableCount`、`operator`。
**频率**：每次库表查询一条。后台持续感知的审计**与人工读取同等对待**（不因是自动任务而免记）。

> 现状缺口：只读探测不落 audit（`index.ts:1545` 仅记 request.log timing）。本 Spec 为库表查询建立独立审计事件类型，不并入既有 write 审计通道。

### 7.9 UI（最小展示）

`/connections` 是本轮适用范围，因此必须有最小 UI 交付（回应审阅 P0-3）。

| 位置 | 内容 |
|---|---|
| Schema 行 | 「库内表清单」入口：显示表数，点击展开该 Schema 的表清单（表名 + 列数） |
| Schema 行 | 「持续感知」状态：已开启 / 已暂停（带原因）/ 上次感知时间 / 间隔 |
| Schema 行 | 「表清单差异」计数：新增 N · 已消失 N · 列数变化 N（均为 0 时不显示） |
| 连接卡 | 失败时显示「持续感知已暂停：<reason>」 |

**不做**：批量启用、批量补结构、差异管理界面——属 L25-11。

---

## 8. 核心流程（伪代码）

### 8.1 读取 Schema 级库内表清单

```text
readLiveTables(projectRoot, connectionId, schema, refresh, purpose, deps):
  schema = assertSchemaIdent(schema)                 # 白名单标识符；非法 → 400 BAD_REQUEST
  conn = findConnection(projectRoot, connectionId)
  if conn is null: throw 404 CONNECTION_NOT_FOUND

  protocol = resolveWireProtocol(conn)                # 复用 live-catalog.ts
  if protocol == "unknown":
    return errorPayload(PROTOCOL_UNSUPPORTED)
  if not supportsTableList(protocol):                 # mysql / postgres 家族
    return errorPayload(TABLE_LIST_UNSUPPORTED)

  generation = currentConnectionGeneration(connectionId)   # L 代次
  if not refresh:
    hit = peekCache(connectionId, schema, generation, purpose)   # manual / automatic 分开
    if hit != null: return { ...hit, cached: true }

  result = await probeScheduler.submit(
    kind = "live-tables",
    key = connectionId + " " + schema + " " + generation + " " + purpose,
    generation = generation,
    purpose = purpose,                                # manual | automatic
    run = () -> provider.listTables(...)              # 只读 SQL；timeout 30s
  )
  # 队列满 / 排队超时 / 代次失效 由调度器以 reason 返回，不抛异常

  if result.status == "error":
    return errorPayload(result.reason)

  tables = parseRows(result.tables)                   # 丢弃缺表名或缺列数的行
  if count(tables) >= TABLE_LIST_MAX_ROWS:             # 满页即失败，不静默截断
    return errorPayload(TABLE_LIST_TOO_LARGE)

  payload = { status:"ok", schema, tables, fetchedAt = nowISO(), cached:false }
  storeCache(connectionId, schema, generation, purpose, payload, ttl = purpose==manual ? 10min : intervalMs)
  return payload
```

### 8.2 持续感知一轮（reconciler）

```text
reconcileConnection(projectRoot, connectionId):
  cfg = loadDiscoveryConfig(projectRoot, connectionId)
  if cfg == null or not cfg.enabled: return            # 未开启：不连库

  generation = currentConnectionGeneration(connectionId)
  if cfg.generation != generation:
    invalidateSnapshots(connectionId)                  # 配置代次变化 → 旧快照与基线全部作废
    cfg.generation = generation
    persistDiscoveryConfig(cfg)

  for schema in configuredSchemas(connectionId):       # 只取 ktx.yaml 里已配置的 Schema
    if isPaused(cfg, schema): continue                  # 人工暂停的 Schema 不再自动尝试

    cfg.schemas[schema].lastAttemptAt = nowISO()
    live = readLiveTables(projectRoot, connectionId, schema, refresh = false, purpose = "automatic")
    # automatic 目的缓存 TTL = 轮询间隔，不受面向人工的 10 分钟 TTL 限制（§6.4）

    if live.status == "error":
      cfg.schemas[schema].status = "error"
      cfg.schemas[schema].lastReason = live.reason
      cfg.schemas[schema].consecutiveFailures += 1
      cfg.schemas[schema].nextAttemptAt = backoff(cfg.schemas[schema].consecutiveFailures)
      if cfg.schemas[schema].consecutiveFailures >= MAX_CONSECUTIVE_FAILURES:
        cfg.schemas[schema].status = "paused"          # 转入人工暂停，不再自动重试
      persistDiscoveryConfig(cfg)
      continue                                          # 失败隔离到 Schema 级

    cfg.schemas[schema].status = "ok"
    cfg.schemas[schema].lastReason = null
    cfg.schemas[schema].consecutiveFailures = 0
    cfg.schemas[schema].lastCompletedAt = nowISO()
    cfg.schemas[schema].nextAttemptAt = null

    snapshot = loadSnapshot(connectionId, schema)
    previous = snapshot?.previous                        # 上一份快照 = 物理基线

    if previous == null:
      # 首轮：建立基线。产出当前对账状态，不产出变更事件（没有上一份可比）
      writeSnapshot(connectionId, schema, live, previous = null)   # 失败则基线不推进
      persistDiscoveryConfig(cfg)
      continue

    diff = diffTableLists(previous.tables, live.tables)  # added / missing / columnCountChanged
    if diff is empty:
      writeSnapshot(connectionId, schema, live, previous = previous)  # 只推进基线
      persistDiscoveryConfig(cfg)
      continue

    if not writeSnapshot(connectionId, schema, live, previous = previous):
      # 落盘失败 ⇒ 当前快照与基线都不变，下一轮重报同一差异
      cfg.schemas[schema].status = "error"
      cfg.schemas[schema].lastReason = SNAPSHOT_WRITE_FAILED
      persistDiscoveryConfig(cfg)
      continue

    appendEvents(connectionId, schema, diff, live.fetchedAt)   # 事件只追加，不参与当前状态
    persistDiscoveryConfig(cfg)
```

**退避规则**：`backoff(n) = min(intervalMs * 2^(n-1), 1h)`。`n` 达到 `MAX_CONSECUTIVE_FAILURES`（默认 10）后转入 `paused`，**需人工介入**（修凭据或改配置）才恢复；`paused` 的 Schema 不再自动尝试。

**恢复规则**：任一 Schema 成功一次即清零其 `consecutiveFailures` 并退出退避。人工暂停态只能由 `PUT /discovery`（重置该连接的失败计数）或修复凭据后的显式触发恢复。

### 8.3 计算当前对账状态（按快照重算，不累积）

```text
computeReconciliation(connectionId):
  snapshots = loadSnapshots(connectionId)               # 每 Schema 的最新成功快照
  manifest = loadManifestTables(connectionId)           # 本地 Schema Manifest 的表名
  enabled  = loadEnabledTables(connectionId)            # ktx.yaml enabled_tables

  for schema in snapshots:
    discovered = snapshot.tables.map(t -> schema + "." + t.table)
    result[schema] = {
      discoveredInLibrary: discovered,
      missingInManifest:  discovered - manifest,         # 库里有、本地没有
      missingInEnabled:   discovered - enabled,          # 库里有、启用表范围没有
      notInLibrary:       manifest - discovered          # 本地有、库里没有
    }
  return result
```

**与 §8.2 的关系**：`computeReconciliation` **不读事件历史**。表被删除后、下一轮发现时，`missingInManifest` 会随最新快照重算而自动消除旧状态；`notInLibrary` 则会正确反映「本地有、库里没了」。

### 8.4 计算表清单差异（前后轮）

```text
diffTableLists(previousTables, currentTables):
  prevByName = index(previousTables, t.table)
  currByName = index(currentTables, t.table)
  added   = names(currByName) - names(prevByName)
  missing = names(prevByName) - names(currByName)
  columnCountChanged = [ { table, before: prev.columnCount, after: curr.columnCount }
                          for t in both, prev.columnCount != curr.columnCount ]
  return { added, missing, columnCountChanged }
```

### 8.5 关键分支与验收映射

| 分支 | 行为 | 验收项 |
|---|---|---|
| Schema 非法 / 缺失 | `400 BAD_REQUEST`，不连库 | SC-1 |
| 连接不存在 | `404 CONNECTION_NOT_FOUND` | SC-2 |
| 协议不可识别 | `PROTOCOL_UNSUPPORTED` | SC-3 |
| 协议不支持表级清单 | `TABLE_LIST_UNSUPPORTED` | SC-4 |
| 表清单命中行数上限 | `TABLE_LIST_TOO_LARGE`，不返回部分表 | SC-5 |
| 探测队列满 | `PROBE_QUEUE_FULL`，不 500 | SC-6 |
| 排队超时 / 代次失效 | `PROBE_QUEUE_TIMEOUT` / `GENERATION_INVALIDATED` | SC-7 |
| 同代次人工重复请求 | 命中缓存，`cached: true`，不重新连库 | SC-8 |
| 连接配置代次变化 | 旧代次结果不返回、不入缓存 | SC-9 |
| 错误分类 | 无法区分不存在与不可见时归 `SCHEMA_NOT_VISIBLE` | SC-10 |
| 某 Schema 失败 | 该 Schema 记失败，其余 Schema 继续 | SC-11 |
| 连续失败 | 指数退避；达上限转 `paused` 不再自动重试 | SC-12 |
| 失败后成功一次 | 失败计数清零、退出退避 | SC-13 |
| 连接级状态 | 部分成功 ⇒ `partial`；全失败 ⇒ `error`；全暂停 ⇒ `paused` | SC-14 |
| 库内新增一张表 | 进入 `listDiff.added`；**Manifest 与 `enabled_tables` 均不变** | SC-15 |
| 库内删除一张表 | 进入 `listDiff.missing`；**本地条目未被删除** | SC-16 |
| 某表列数变化 | 进入 `listDiff.columnCountChanged` | SC-17 |
| 首轮 | 建立基线 + 产出当前对账状态；**不产出变更事件** | SC-18 |
| 差异写盘失败 | 快照与基线均不推进；下一轮重报同一差异 | SC-19 |
| 表恢复 / 本地补齐后 | 当前对账状态**不再**含该表；事件历史仍保留 | SC-20 |
| 事件历史累积 | 只追加、限量 50 条；**不参与**当前状态计算 | SC-21 |
| 持续感知未开启 | 后台不发起任何库表查询 | SC-22 |
| 感知间隔越界 | `PUT` 拒绝，配置不变 | SC-23 |
| 非 owner 改配置 | `PUT` 拒绝，配置不变 | SC-24 |
| 接入预览未传 discovered 且有快照 | 自动填入，`discoverySource: "continuous"` | SC-25 |
| 接入预览显式传 discovered | 以传入值为准，`discoverySource: "manual"` | SC-26 |
| 快照无差异时也落盘 | 最新成功快照每轮都更新（含空差异轮次） | SC-27 |
| 人工读取 TTL 与轮询间隔交互 | 后台自动目的**不**命中面向人工的 10 分钟缓存 | SC-28 |
| Pod 重启 | 快照、事件、配置与失败状态均从 sidecar 恢复 | SC-29 |

---

## 9. 失败、降级与安全

### 9.1 零 AI 依赖

核心链路不得因 LLM / embedding 未配置而失败。本 Spec 全程只读 SQL，不触发 enrichment。若最终选择的 provider 路径（§6.2 路径 A）需要 AI，必须证明存在只跑 database-schema 阶段的开关，否则改走路径 B。

### 9.2 失败语义

| 场景 | 行为 |
|---|---|
| 库不可达 / 凭据失效 | 记失败 + reason；退避重试（指数退避，上限 1 小时）；达上限转人工暂停；**不刷屏、不弹窗**；连接概览显示「持续感知已暂停：<reason>」 |
| 权限收窄导致表突然变少 | **不得**据此清空本地条目或快照。`notInLibrary` 如实报告 + 原因归 `SCHEMA_NOT_VISIBLE`，由人判断 |
| 库真的删了表 | 同上走 `notInLibrary` 报告，不自动移除本地条目 |
| 队列满 / 排队超时 | 本轮跳过该 Schema，记对应 reason；下一轮重试 |
| 代次失效 | 丢弃旧代次结果；该连接的快照与基线作废，下一轮重新建立 |
| 落盘失败 | 记 `SNAPSHOT_WRITE_FAILED`；**快照与基线均不推进**；下一轮重报同一差异 |

### 9.3 安全边界

- **只读**：SQL 为内部常量 + 标识符白名单（复用 `assertSchemaIdent`）。
- **不读凭据明文**：复用 `ktx` 既有凭据通道。
- **不返回敏感内容**：表清单只含表名、表类型、列数、注释；不含列内容、不含样本值。
- **不扩大 Agent 可见面**：库内表清单、当前对账状态与变更事件**不进入** MCP 可见目录，不参与角色有效 source 编译。发现 ≠ 授权。
- **不覆盖已有资产**：本 Spec 不写 Schema Manifest。

### 9.4 单副本前提

交付形态为单副本（`replicaCount: 1` + Recreate 策略 + RWO PVC，Chart values 注释明确「single-replica only」）。因此：

- 后台调度**不引入** leader election 与分布式协调；
- 快照、事件、配置与失败状态落盘，Pod 重启后恢复（SC-29）；
- 感知失败状态在重启后仍可见。

---

## 10. 前置依赖与未决项

| # | 事项 | 阻塞对象 | 处置 |
|---|---|---|---|
| P1 | 交付版 KTX 是否提供 `ktx scan`、是否需要 AI | **仅 S3 的 provider 选择** | 开工 S3 前实测；按 §6.2 选 A 或 B。**不阻塞 S1 / S2** |
| P2 | `docs/specs/lucy-platform-goal-checklist.md:87` 的记录需复核 | 文档一致性 | 与 P1 一并复核 |
| P3 | 存量连接验收样本（真实客户连接或含多 Schema / 多表 / 孤儿启用 / 空 `enabled_tables` 的夹具） | 全部阶段验收 | 需 PM 指定来源；仓内无样本 |
| P4 | 「不扫物理库」家族（Spec 21 §2.2 / 28 §3 / 29 非目标 / 34 §3）与实际实现（107 / 157 / 164 已能读库并落盘 Manifest）未对账 | 文档一致性 | 先对账再开工 |
| P5 | 自动写 Schema Manifest（追加新表）的档位设计 | 后续 Spec | 依赖 L25-11；本轮只报告不写 |
| P6 | 是否把感知开关与间隔纳入交付级配置 | 后续 Spec | 本轮存 sidecar |
| P7 | 真实存量连接的基线数据不可从仓库证明 | 验收证据要求 | 需在客户环境做只读角色编译对账（沿用 2026-08-28 升级评审 §3.2 的方法） |

---

## 11. 验收标准

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | `live-tables` 缺 `schema` 或 schema 名非法 | `400 BAD_REQUEST`，不连库 |
| SC-2 | 连接不存在 | `404 CONNECTION_NOT_FOUND` |
| SC-3 | 连接协议不可识别 | `reason: PROTOCOL_UNSUPPORTED` |
| SC-4 | 连接协议为 sqlserver / oracle | `reason: TABLE_LIST_UNSUPPORTED` |
| SC-5 | 表清单命中行数上限 | `reason: TABLE_LIST_TOO_LARGE`，**不返回部分表** |
| SC-6 | 探测队列已满 | `reason: PROBE_QUEUE_FULL`，不抛 500 |
| SC-7 | 排队超时 / 探测期间代次变化 | `reason: PROBE_QUEUE_TIMEOUT` / `GENERATION_INVALIDATED` |
| SC-8 | 同代次人工重复请求 | 第二次 `cached: true`，不重新连库 |
| SC-9 | 连接配置代次变化后请求 | 不返回旧代次结果；旧结果不入缓存；该连接的快照与基线作废 |
| SC-10 | 数据库错误无法区分 Schema 不存在与不可见 | 归 `SCHEMA_NOT_VISIBLE`（保守），不误报为表被删 |
| SC-11 | 三个 Schema 中一个读取失败 | 该 Schema 记失败原因，另两个正常产出差异 |
| SC-12 | 同一 Schema 连续失败 | 指数退避；达 10 次转 `paused` 且不再自动重试 |
| SC-13 | 失败后成功一次 | 失败计数清零、退出退避、`lastCompletedAt` 更新 |
| SC-14 | 部分成功 / 全失败 / 全暂停 | 连接级状态分别为 `partial` / `error` / `paused` |
| SC-15 | 库内新增一张表 | 出现在 `listDiff.added`；**本地 Schema Manifest 与 `enabled_tables` 均未变化** |
| SC-16 | 库内删除一张表 | 出现在 `listDiff.missing`；**本地条目未被删除** |
| SC-17 | 某表列数变化 | 出现在 `listDiff.columnCountChanged`，带 before / after |
| SC-18 | 该连接首轮感知 | 建立基线 + 产出当前对账状态；**不产生变更事件** |
| SC-19 | 差异记录写盘失败 | 快照与基线均不推进；下一轮重报同一差异；reason = `SNAPSHOT_WRITE_FAILED` |
| SC-20 | 表被删除后又恢复 / 本地补齐 Manifest | 当前对账状态**不再**含该表；事件历史仍保留 |
| SC-21 | 多轮变化 | 事件历史只追加、限量 50 条；**当前状态不随历史累积** |
| SC-22 | 该连接未开启持续感知 | 后台不发起任何库表查询 |
| SC-23 | `PUT discovery` 传越界 `intervalMs` | `400`，配置未变更 |
| SC-24 | 非 owner 调用 `PUT discovery` | 拒绝，配置未变更 |
| SC-25 | 接入预览未传 `discovered`，且有同代次成功快照 | `discovered` 自动填入，`discoverySource: "continuous"` |
| SC-26 | 接入预览显式传 `discovered` | 以传入值为准，`discoverySource: "manual"` |
| SC-27 | 某 Schema 本轮无差异 | 最新成功快照**仍然更新**（含空差异轮次），否则 S2 会读到过期快照 |
| SC-28 | 轮询间隔 5 分钟且人工刚读过同一 Schema | 后台自动轮询**仍重新查询**，不命中面向人工的 10 分钟缓存 |
| SC-29 | 进程重启 | 快照、事件、配置与每 Schema 失败状态均从 sidecar 恢复 |
| SC-30 | 库表查询发生 | 产生 discovery 审计事件，含时间、连接、Schema、结果、reason、耗时、表数 |
| SC-31 | sidecar 写入 | 原子写；文件模式 `0600`；内容不含列值与样本 |
| SC-32 | 持续感知与连接健康检查并发 | 库表查询走**独立队列配额**，不占用 `test` 与 `live-schemas` 的并发额度 |
| SC-33 | 列级深查 | `table-structure-diff` 返回列的 added / removed / changed；一张表失败不影响其它表 |
| SC-34 | 连接概览展示 | Schema 行可见库内表清单入口、持续感知状态与差异计数；暂停时显示原因 |

**少一条不算完成。**

---

## 12. 测试

- 单元（`webui/server/__tests__/`）：
  - `live-tables` 端点：SC-1 ~ SC-10、SC-27、SC-28。
  - 持续感知 reconciler：SC-11 ~ SC-22、SC-29（临时目录 + 假 provider）。
  - 当前对账状态与事件历史分离：SC-20、SC-21。
  - 错误码分类：构造 `ok:false` 的 `ktx sql` 结果，逐个 reason 断言（SC-10 必测）。
- 集成：SC-23、SC-24（权限路径）、SC-30 ~ SC-32。
- 前端：SC-34（组件断言，不要求浏览器测试，除非 PM 另行要求）。
- 术语：`npm run lint:terminology` 必须绿（新词已登记）。
- Spec 门禁：`npm run lint:spec` 必须绿。
- 真实存量连接验收：SC-1 ~ SC-34 在夹具上全过后，仍需在**真实存量连接**上做一次只读对账（§10 P3 / P7），产出角色有效 source 基线对比。

---

## 13. 风险

| 风险 | 严重度 | 缓解 |
|---|---|---|
| 常态轮询扩大凭据暴露面 | 高 | 可按连接关闭；间隔可配；每次查询入审计；失败退避不刷屏 |
| 元数据即敏感数据 | 高 | 表清单只含表名 / 类型 / 列数 / 注释；不进 Agent 可见面；owner 限定配置 |
| 误判「表被删除」 | 高 | 错误分类保守化：无法区分时归 `SCHEMA_NOT_VISIBLE`（SC-10） |
| 空转误报（权限收窄） | 中 | 不自动清空本地；`notInLibrary` 如实报告 + 原因 |
| 库负载 | 中 | 表粒度聚合查询（一行一表）；段 1 / 段 2 分层；独立队列配额 |
| 误把「表清单差异」当「表结构差异」 | 中 | 两层分别命名（术语标准已分列）；列级差异只按需深查 |
| 架构押注未验证的 KTX 命令 | 中 | provider 抽象；一套生产实现按 T0 结论选；**S1/S2 不被阻塞** |
| 单副本无 HA | 中 | 快照 / 事件 / 配置 / 失败状态全部落盘；重启恢复（SC-29） |
| 命名回归 | 中 | 新词已登记；禁止「扫描」类文案 |

---

## 14. 与其它 Spec 的关系

| Spec | 关系 |
|---|---|
| 17 静态 Catalog 载入 | 本 Spec **不写**本地 YAML 资产，核心管道仍零 AI 依赖 |
| 21 / 28 / 29 / 34 | P4：需对账。107 已开的受控例外（Owner 按需只读）在本 Spec 扩展到表级 |
| 107 库内目录 | 复用其 TTL、代次、探测队列、协议判定；新增表级粒度与连接级状态聚合 |
| 116 启用表范围门禁 | 本 Spec 不写 `enabled_tables`，不触发 `TABLE_NOT_SCANNED` |
| 164 读取表结构 | 本 Spec 的列级深查复用其列行查询；差异能力扩展到表粒度且不落盘 |
| 182 启用表范围交集 | 本 Spec 的发现结果不参与角色有效 source 编译 |
| 183 导入范围预览 | 只改 `discovered` 的来源（改为消费持久化快照）；四份对账与两份差异口径不变 |
| L25-11 语义资产批量维护 | 本 Spec 只产出「缺什么」；写入类动作归 L25-11 的 staging 与发布工作台 |
