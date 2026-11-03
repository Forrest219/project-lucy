# Lucy 扫描库表能力评估

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 扫描库表能力评估 |
| 文档类型 | 评估 / 能力分析（决策输入，非 Spec） |
| 日期 | 2026-10-26 |
| 状态 | 待决策 |
| 适用范围 | Lucy 数据接入（`/connections`）、存量连接资产补齐、Schema Manifest 生命周期、语义层建设路径 |
| 追加需求 | ① 扫描对象是**历史已经有的连接**（存量连接）② **L1 表目录 + L2 表结构都要** ③ **库内新增表后 Lucy 要能自动感知，不能每次让用户选** |
| 关联 | Spec 17 / 21 / 28 / 29 / 34 / 107 / 116 / 157 / 164 / 182 / 183、L25-11 语义资产批量维护 Spec |

---

## 1. 结论

**「扫描库表」不是一个能力，是四层递进能力，Lucy 只做了最窄的一层。而三项追加需求把它从「体验优化」变成了「存量资产可用性 + 持续运营」的必要条件。**

| 层 | 产出 | Lucy 现状 | 价值 | 风险 |
|---|---|---|---|---|
| L1 表目录 | 表名、表类型、表注释 | **缺**（只有 schema 级计数，没有表名） | **高（已确认要做）** | 中（元数据暴露面） |
| L2 表结构 | 列、类型、可空、PK、注释 | **已有**（MySQL/PG 家族，逐 schema 手动） | **高（已确认要做）** | 低 |
| L3 数据画像 | 采样、空值率、基数、Top 值 | 缺 | 高 | 低（限于已启用表时） |
| L4 语义生成 | 业务描述、指标、维度、关系 | 缺 | 高 | 高（AI 依赖） |

七个核心判断：

1. **真正的产品问题不是「能不能扫」（`ktx sql` 一条只读 SQL 就能扫），而是「扫到的东西落在哪个真源、谁授权、谁审」。**
2. **存量扫描的第一产出是「对账」，不是「建结构」。** `import-scope` 的 `discovered` 槽位就是为此预留的接口位（Spec 183 §2/§4 明确「未传入时为空，并标记发现未执行」）。
3. **补齐 Manifest 是存量连接授权生效的必要条件，不是可选项。** Manifest 的表是唯一 source 来源；`enabled_tables` 里的表若没有 Manifest，就不是真实 source，角色照样拿不到（§4.2）。
4. **存量扫描不能覆盖已有 Manifest。** 交付给客户的 Manifest 含 `descriptions.ai`（来自 KTX ingest 增强），Lucy 自己生成的最小 Manifest 只有 `descriptions.db`——覆盖即抹掉语义（§4.4）。
5. **「不让用户每次选」的正解是：发现自动、写入批量、授权人工。** 把「选择」从「每次触发时逐表勾选」上移为「一次性设定 + 自动累积 + 批量确认」。技术上成立的关键是 **Manifest ≠ 授权**：Manifest 是物理事实，`enabled_tables` 才是授权范围（§5.3）。
6. **扫描快照面在 KTX 侧已经存在，Lucy 应编排而非自造。** 实测 `entity_details` 返回 `scan_missing`，并给出「run `ktx ingest <conn>` 或 `ktx scan <conn>`」——KTX 已维护 per-connection 的 live-database scan snapshot，且 Lucy 已经能读它。Lucy 不该自己再写一套轮询 + 自己的快照存储（§5.4）。
7. **自动感知只能靠轮询，事件驱动不可行**（MySQL binlog 需 REPLICATION SLAVE 权限、Postgres event trigger 需超级用户、Oracle/SQL Server 无等价物，客户库通常不给）。成本由查询形状决定，不由频率决定 ⇒ 两段式探测（§5.3）。

**对上一版建议的修正**：上一版建议「暂缓连接级批量扫描」。**追加需求下翻案**——逐 schema 手动在存量规模下不可行，批量能力从「暂缓」升为「必要」，但必须重塑为「存量对账 + 批量补齐（补缺不覆盖 + staging + 确认 + 基线对账）」，而不是「一键覆盖」。

推荐路线：**先对账 → 加固现有能力 → 自动感知（编排 KTX scan）→ 批量补齐**。

---

## 2. 术语先对齐

「扫描库表」在 Lucy 里**不是新词，是四个被混用的词**。现有术语标准没有「已扫描」一词（`webui/docs/00-product-terminology-standard.md` 全文无此词），已改为三列口径：

| 现有规范词 | 含义 | 禁用词 |
|---|---|---|
| 库内目录（Live Catalog） | Owner 按需只读目录查询结果 | 物理扫描（作主标签） |
| 库内表数 | 物理库账号可见 BASE TABLE 数量 | 物理表数（主导航） |
| 已发现表数 | Schema Manifest 已读入本地 Catalog 的表数 | 本地表数 |
| 已启用表数 | `ktx.yaml` `enabled_tables` | 白名单表数 |

Spec 17 §4.1 明确禁用「扫描 / Ingest / 重新扫描物理库」等暗示访问数据库的词，`刷新本地目录` 也被刻意定义为「只读本地 YAML，不连库」。

**结论**：任何新能力落地前必须先在术语标准登记新词（例如「库内表清单」「读取表结构」「发现变更」），并且**不能**把新动作命名为「扫描」。

---

## 3. 现状地图

### 3.1 三条事实源

| 源 | 内容 | 刷新机制 | 落盘 |
|---|---|---|---|
| 库内目录 | 物理库实时目录 | `GET /api/connections/:connId/live-schemas`，10 分钟 TTL + 连接配置代次隔离 | 不落盘 |
| Schema Manifest | `semantic-layer/<conn>/_schema/*.yaml`，**「已扫描」唯一事实源**，**也是唯一 source 来源** | 上传 / 读库生成 / 人工编辑 | 落盘 |
| `enabled_tables` | `ktx.yaml` 白名单，**必须 ⊆ Manifest** | 启用表范围页 | 落盘 |

消费链：`GET /api/connections/:connId/tables` → 启用表范围页 → `TABLE_NOT_SCANNED` 门禁（Spec 116）。
Manifest → source 的映射在 `catalog-reload.ts:244-275` 与 `semantic-layer.ts:425`。

### 3.2 已有的连库能力（全部经 `ktx` CLI 子进程，Lucy 进程内无 DB driver）

| 能力 | 端点 | 协议 | 行数上限 | 队列 | 缓存 | 审计 |
|---|---|---|---|---|---|---|
| 连接测试 | `POST /api/connections/:connId/test` | 由 KTX 决定 | — | ✅ | — | ❌ |
| 库内目录 | `GET .../live-schemas` | mysql/pg/sqlserver/oracle | 2000 | ✅ | ✅ TTL+代次 | ❌ |
| **读取表结构** | `POST .../schema-structure` | **仅 mysql/pg**（StarRocks/Doris 按 MySQL） | **10000，满页即失败** | **❌ 直连** | ❌ | ❌ |
| 语义校验 | `POST /api/sources/.../validate` | — | — | — | — | ✅ |

**关键缺口**：全仓**不存在**「列出某 schema 下所有表名」的表级查询端点。表名目前只能从列行反推，或从本地 Manifest 读。

### 3.3 已有的「读库 → 落盘」闭环

Spec 157 / 164 已经打通一条完整链路：

```
添加 Schema 成功步 → 「从数据库读取表结构」
  → POST /api/connections/:connId/schema-structure（只读 information_schema / pg_catalog）
  → buildMinimalSchemaManifest → 最小 Manifest YAML
  → validateCatalogAsset → uploadCatalogAsset（原子写 + mirror + 审计 sidecar）
  → POST /api/catalog/reload → 打开该 Schema 的启用表范围
```

**这条路已经存在，但：**
- 只支持 MySQL/PG 家族；SQL Server / Oracle / SQLite 只能上传 YAML
- **逐 schema 手动触发，无法一次扫完一个连接** ← 存量规模下的致命短板
- 产出的 Manifest 只有 `name/type/nullable/pk/descriptions.db`，**没有 `descriptions.ai`**
- Spec 164 非目标明确：**「不把表结构已写入写成可以问数」**
- 只服务「新建/刚添加 Schema」这条路，**存量连接没有对应入口**

### 3.4 KTX 侧已存在的扫描快照面（本轮实测发现）

实测调用运行中 Lucy MCP Proxy 的 `entity_details`：

```
entity_details({ connectionId: "demo-mysql", entities: [{ table: "dataforai.superstore_orders" }] })
→ { ok: false, error: { code: "scan_missing",
      message: "No live-database scan found for connection \"demo-mysql\"; run `ktx ingest demo-mysql` or `ktx scan demo-mysql`." } }
```

三条事实：

1. **KTX 维护 per-connection 的 live-database scan snapshot**，`entity_details` 读的就是它。
2. **快照是按需产生的，不是自动维护的**——`demo-mysql` 从未被扫过，所以是 `scan_missing`。**这正是「自动感知」要补的缺口。**
3. **`ktx scan <connection>` 是 KTX 侧的扫描入口**（错误信息明确建议）。但本机 CLI（`@kaelio/ktx` 0.12.0）执行 `ktx scan --help` 返回 `unknown command 'scan'`。

⇒ **交付镜像锁定的 KTX 0.16.0 是否提供 `ktx scan`，是本方案的前置未知项**，必须先核实（见 §5.4）。另注：`docs/specs/lucy-platform-goal-checklist.md:87` 记录的「KTX 0.16.0 无顶层 `scan` 命令」与运行实例的错误信息不一致，该记录需要复核。

---

## 4. 存量连接专项

### 4.1 存量连接与新建连接的根本差异

| 维度 | 新建连接 | 存量连接 |
|---|---|---|
| 资产状态 | 全空 | 可能有 `enabled_tables`、可能有老 Manifest、可能有 overlay、可能有 Wiki 引用 |
| 写入风险 | 无冲突 | 覆盖会丢信息，且直接影响在用的问数链路 |
| 可用入口 | 添加 Schema 抽屉（Spec 164）已覆盖 | **无**——只能手工上传 YAML 或离线 `ktx ingest` |
| 授权状态 | 新建即需配置 | 可能是孤儿启用 / 空 `enabled_tables` |
| 规模 | 小 | 大（几十 schema、几百表） |
| 谁在用 | 无 | 生产中，Agent 可能正在查它 |

### 4.2 存量连接的四种典型状态（按严重度排序）

**状态 1（最严重）：`enabled_tables` 缺省或为空**
→ Spec 182：缺省 / 空数组 = 空集，**不退回该连接的全部 source**。selector 角色与 `catalog_bound` 角色在该连接上零命中 → `selector_zero_match` → 角色编译失败，**Pod 仍然 Ready**。
→ 典型的**静默失效**：连得上、页面正常、Agent 拿不到 source。
→ 仓库内**未证实**存量客户一定处于此状态（2026-08-28 升级评审 §7 明确承认「这份现网 ktx.yaml 一定没写该字段」推不出来）——**这正是存量扫描首先要回答的问题**。

**状态 2：`enabled_tables` 有表，但 Manifest 缺失**
→ 孤儿启用（Spec 116 给 warning，允许暂留不阻塞保存）。
→ 且因 Manifest 表是唯一 source 来源（§3.1），这些表**不是真实 source**，角色照样拿不到。
→ ⇒ **补齐 Manifest 是让存量 `enabled_tables` 生效的必要条件**。

**状态 3：Manifest 由老版本 `ktx ingest` 生成**
→ 字段集可能比 `buildMinimalSchemaManifest` 更全（见 §4.4）。
→ 现有「目标已存在时不覆盖」（Spec 164 §6）只处理「文件存在」，**不处理「文件存在但内容更全」**。

**状态 4：`ktx.yaml` 的 schemas 与实际不符 / 凭据失效 / 权限收窄**
→ 扫描前要先做连通性判定；「库或 schema 不存在」与「账号不可见」必须分开报——现状错误码不分层（超时被 execFile 杀进程后退化为 `ktx sql failed (exit 1)`）。

### 4.3 存量扫描的首要用途是对账，不是建结构

现状没人能回答「存量连接到底缺什么」：
- 「库内表数」只给计数不给表名（live-schemas 只出 schema + COUNT）
- 「已发现表数」只反映本地 Manifest
- `import-scope` 的 `discovered` **必须由调用方手工传入**

⇒ **存量扫描的第一产出 = 连接级四份对账 + 两份差异**：

| 口径 | 来源 | 现状 |
|---|---|---|
| `discovered` | 库内发现表 | **空，等扫描填入** |
| `manifest` | 本地 Manifest 表 | 已有 |
| `enabled` | `enabled_tables` | 已有 |
| `roles` | 角色有效能力（权限编译） | 已有 |
| `manifestNotEnabled` | Manifest 有、启用表没有 | 已有 |
| `enabledMissingManifest` | 启用表有、Manifest 没有（**= 孤儿启用**） | 已有 |

这四份 + 两份差异 **Spec 183 已实现且已治理**，只需把 `discovered` 从「手工传入」变成「扫描产出」。

### 4.4 硬约束：存量扫描不得覆盖已有 Manifest

对照交付给客户的真实形态（`customer-config.example/config/semantic-layer/customer-db/_schema/analytics.yaml`）：

```yaml
columns:
  - name: snapshot_date
    type: time
    nullable: false
    descriptions:
      db: 快照日期
      ai: Business date of the CEO metric snapshot.   # ← Lucy 自己生成的 Manifest 没有这一层
```

`descriptions.ai` 来自 KTX `ktx ingest` 的 enrichment；Lucy 的 `buildMinimalSchemaManifest` 只产 `descriptions.db`（`schema-structure.ts:124-131`）。

⇒ **存量连接若用 Lucy 扫描结果覆盖已有 Manifest，会直接抹掉 `descriptions.ai` 这层语义。** 这不是理论风险，是交付模板里就摆着的形态。
⇒ 写入纪律：**补缺 + diff 确认，绝不整体覆盖**；已有 `descriptions.ai` 必须保留；新增表才追加。

### 4.5 入口归属：连接概览（发现/补结构）vs import-scope（对账）vs 批量维护（语义）

L25-11（语义资产批量维护）已写死分工：

> 「缺失物理表或 Manifest 时**不能通过上传 overlay 自动建表、发现或补齐结构**。」
> 「维护包中的 Manifest 为**只读上下文**；修改 Manifest 的文件须阻断并提示**去连接概览处理**。」
> 「不更改连接、启用表范围、角色权限或行级策略，**不把导入等同授权**。」

⇒ 三块的职责边界已经存在，不需要新造：

| 面 | 职责 | 本次新增 |
|---|---|---|
| 连接概览（`/connections`） | 发现物理表、补齐结构 | **扫描动作的主入口**（补 Manifest） |
| `import-scope` | 四份对账 + 两份差异 | **`discovered` 由扫描产出** |
| 发布工作台 / L25-11 | 语义 overlay 批量维护 | 消费扫描产出的 Manifest（只读上下文） |

### 4.6 授权纪律：扫描不能改授权

- Spec 182：有效 source = Manifest ∩ `enabled_tables` ∩ selector。
- L25-11：「不把导入等同授权」「不更改……启用表范围、角色权限或行级策略」。
- ⇒ 扫描只产出「缺什么」。**写 `enabled_tables` = 改授权**，必须是独立的显式授权动作。

### 4.7 存量写入的六条纪律

1. 只读扫描 → 生成差异 → 人工确认 → 写 Manifest（**不写 `enabled_tables`**）
2. 写 Manifest 走**受控 staging + 发布工作台**（L25-11 §3.2 既有机制），不直接落盘
3. **不覆盖**已有 Manifest；补缺为主，已有 `descriptions.ai` 必须保留（§4.4）
4. 写入后必须跑**角色有效 source 基线对账**——升级评审已确立的断言：逐角色有效 source 数不少于基线、编译失败的角色单列、比较键用 `normalizeRef(physicalTable)`（`schema.table`）
5. 可回滚：复用 L25-11 的 digest / 基线 / 30 分钟快照机制
6. 失败隔离到 schema 级，一个 schema 失败不阻断其余

### 4.8 验收样本缺口

仓库内**没有真实存量连接样本**：`config/semantic-layer/` 为空；`customer-config.example/` 是模板（1 连接 1 Schema 1 表，结构完备，**不是存量形态**）；`examples/*/project-template/` 是 demo 模板。
⇒ 若要做真实验收，**需要一个真实存量客户连接**（或至少一个含多 schema、多表、含孤儿启用 / 空 `enabled_tables` 的夹具）。这一项需要你指定来源。

---

## 5. 自动感知专项（第三项追加需求）

### 5.1 需求解构：「不能每次都让用户选」有两种读法

| 读法 | 含义 | 解法 |
|---|---|---|
| 读法 1（触发成本） | 不想每次手动点「读取表结构」/ 逐 schema 触发 | **自动发现**：系统定期感知 |
| 读法 2（授权成本） | 不想每次逐表勾选哪些表纳入 | **自动登记结构事实 + 批量确认授权** |

两个读法都要满足，但**必须分开实现**，因为一个碰物理事实，一个碰授权。

### 5.2 感知机制：只能轮询，事件驱动不可行

| 方案 | 可行性 |
|---|---|
| MySQL binlog DDL 监听 | 需 `REPLICATION SLAVE` 权限，客户库通常不给；运维成本高 |
| Postgres event trigger | 需超级用户 / 扩展；非标准路径 |
| Oracle / SQL Server 事件 | 无等价机制 |
| **定时轮询** | **唯一可移植方案** |

成本由**查询形状**决定，不由频率决定 ⇒ 见 §5.3 的两段式。

### 5.3 两段式探测 + 一个端点服务三个用途

**段 1「指纹」**：轻量查询拿「schema + 表名 + 列数」。成本接近现有 live-schemas（已在跑 `information_schema.tables` 聚合）。
**段 2「详情」**：只有指纹变了才拉完整列结构（`information_schema.columns`）。
⇒ 大多数轮次只花段 1 的成本；结构变更才触发段 2。

**收敛建议**：把 live-schemas 从「schema + count」升级为「schema + 表清单 + 列数指纹」，**一次查询同时服务三个用途**：

```
GET /api/connections/:connId/live-schemas（升级后）
  ├─ (a) 连接概览的「库内目录」展示（L1）
  ├─ (b) 自动感知的指纹源（轮询）
  └─ (c) import-scope 的 discovered 输入（对账）
```

一个端点、一个查询、一个缓存，代次机制直接继承。

### 5.4 架构落点：编排 KTX scan，不要自造第二套

依据 §3.4 实测：KTX 已有 scan snapshot 存储面，Lucy 已经能读它（`entity_details`）。因此正确的分工是：

| 层 | 归属 |
|---|---|
| **触发**（谁去扫） | Lucy 编排 `ktx` CLI（符合 AGENTS.md 的 KTX 边界规则：只用其 CLI/接口，不改源码） |
| **存储**（快照在哪） | 复用 KTX 的 per-connection scan snapshot，不自建 |
| **消费**（差异 → Manifest / 对账） | Lucy 侧做增量对账 + 补缺式写入 |

**禁止**：Lucy 自己写第二套轮询 + 自己的快照存储 + 自己的 SQL 方言分支。理由：① 会与 KTX 的协议覆盖不一致（KTX 已支持 4 种协议，Lucy 列级预览只有 2 种）；② 违反 KTX 依赖边界；③ 两套快照会产生新的漂移。

⚠️ **前置未知项（必须先落实）**：`ktx scan` 在**交付镜像锁定的 KTX 0.16.0** 上是否存在。本机 CLI 0.12.0 执行 `ktx scan --help` 返回 `unknown command 'scan'`，而运行实例的 MCP 错误信息却在建议 `ktx scan demo-mysql`。这条不验证，§5.4 的架构就是空中楼阁。

**前置调研任务（0.5–1 人日）**：在交付镜像同版本 KTX 上确认 `ktx scan` 的存在性、参数（是否支持 schema 粒度、`--json` 输出）、是否需要 AI/enrichment（若需要则违反约束 1，须找只跑 database-schema 阶段的开关）、以及它写到哪里。

### 5.5 自动感知的三个档位（产品决策）

| 档 | 行为 | 改授权？ | 建议 |
|---|---|---|---|
| 1 只提示 | 记「库内新增表 N 张」，进待处理清单 | ❌ | ✅ 起点 |
| 2 自动登记结构 | 自动把新表**追加进 Manifest**（结构事实），不启用 | ❌ | ✅ **推荐** |
| 3 自动启用 | 同时写 `enabled_tables` | **扩大 Agent 可见面** | ❌ 不做 |

**档 2 为什么安全**：Manifest ≠ 授权。`enabled_tables` 不变 ⇒ Spec 182 的交集不变 ⇒ **Agent 可见面不变**。这正是「不让用户每次选」的技术基础——用户不必每次选表去扫，但仍然掌握「哪些表对 Agent 开放」的决定权。

### 5.6 漂移的另一半：表被删除

自动感知必须同时报告两类差异：
- **库里有、本地没有** → 新增表（可自动登记结构）
- **本地有、库里没了** → 消失的表。若它还在 `enabled_tables` 里，就成了「已启用但库中不存在」→ 查询必然失败。

⇒ 自动感知能提前暴露这类隐患。**处理：只提示，不自动移除**（移除 = 改授权 + 破坏性操作）。
⇒ 同理：权限收窄导致突然 0 表时，**不得自动清空本地**（可能是凭据问题，不是库真的空了）。

### 5.7 部署与运行代价

| 维度 | 结论 |
|---|---|
| **副本数** | **单副本**（`replicaCount: 1` + Recreate 策略 + RWO PVC，Chart values 注释明确「single-replica only」）⇒ **不需要 leader election**，这是最大利好 |
| **调度地基** | 已有三套可抄范式：`notifications/worker.ts:267-273`（pass 不重叠）、`security/projector.ts:367-429`（debounce + 不重叠 + unref）、`display-snapshot.ts:381-385`（reconciler + generation + 新鲜度） |
| **队列隔离** | 扫描**不能**占用 live-schemas 的探测队列（并发 2 是留给连接健康检查的）→ 独立队列或独立配额 |
| **凭据暴露面** | 从「Owner 按需触发」变成「常态化使用」——**客户安全评审的新增项**：可按连接关闭、可配置间隔、每次扫描入审计 |
| **失败处理** | 库不可达 / 凭据过期 → 明确状态「自动感知已暂停：<reason>」，退避重试，不刷屏、不阻塞其它连接 |
| **代次继承** | 连接配置代次变化即清缓存（`display-generation.ts` 的 L 代次），自动感知必须继承，否则会用旧配置的结果 |

### 5.8 用户体验：一次累积，多次批量

用户不该「每次都选」。正确形态：

```
系统自动维护一份累积的差异清单（新增表 / 结构变更 / 已消失表）
  → 在连接概览可见，不弹窗、不打断
  → 用户在一个地方批量处理：
      · 批量补结构（走 L25-11 批量维护 / staging + 发布工作台）
      · 批量启用（授权动作，独立确认）
```

⇒ **发现自动、写入批量、授权人工**。「不让用户选」的落点是「一次累积、多次批量」，而不是「每次弹窗问」。

### 5.9 工作量估算

| 块 | 估算 |
|---|---|
| KTX scan 能力可用性调研（前置，§5.4） | 0.5–1 人日 |
| 指纹查询扩展（live-schemas → 表清单 + 列数）+ 解析 + 缓存 | 1–2 人日 |
| 后台 reconciler（间隔、退避、单副本、暂停/恢复、审计、代次失效、队列隔离） | 3–5 人日 |
| 差异清单存储 + UI（连接概览展示，不打断） | 2–3 人日 |
| 与 L25-11 批量补齐接线（staging + 批量确认） | 2–4 人日 |
| **合计（不含 L25-11 本体）** | **9–15 人日** |

---

## 6. 硬约束（10 条，附证据）

1. **Zero AI Dependency 核心管道**（Spec 17）：历史上 WebUI 触发 `ktx ingest` 因扫描链路进入 enrichment / embeddings 配置、在私有化无 LLM 环境直接失败而被主动废弃（M14）。⇒ 带 LLM 增强的能力**不得成为接入主链路的前置条件**；若 KTX 的 scan 必经 enrichment，必须找只跑 database-schema 阶段的开关。
2. **Manifest 唯一事实源 + `enabled_tables ⊆ Manifest`**（Spec 116：`400 TABLE_NOT_SCANNED`）。
3. **术语红线**（Spec 17 §4.1、术语标准 §4.2）：禁「扫描 / Ingest / 重新扫描物理库」；禁「物理扫描」。
4. **连库唯一出口是 `ktx` CLI 子进程**（`webui/server/ktx.ts:241`）；`ktx sql` 本身是 parser-validated 只读。
5. **探测队列全局共享且有硬上限**：并发 2、队列 ≤64、排队 60s、同 key 合并、manual 连续 3 次后让位（`background-probes.ts:15-18`）。扫描任务必须独立配额。
6. **权限落差**：Spec 107 措辞是「Owner 按需」，实现上连接类端点只要求「已登录管理员」，未挂 `requireOwner`。表级扫描把暴露面从「schema 名 + 计数」放大到「表名 + 列名 + 注释」；自动轮询把它变成常态化。
7. **审计缺口**：只读探测不落 audit。扫描一旦写盘必须走 `auditedWriteFile` / `recordConfigChange`；自动感知的每次扫描也应留痕。
8. **KTX 边界**：交付镜像锁 `KTX_VERSION=0.16.0`（`Dockerfile:22`）。Lucy 不改 KTX 源码，只能编排与消费。
9. **不覆盖已有资产**（§4.4）：存量 Manifest 可能含 Lucy 产不出的 `descriptions.ai`。
10. **单副本交付形态**（Chart `replicaCount: 1`）：后台调度**没有** HA 保障，Pod 重启即丢未落盘状态 ⇒ 自动感知的差异清单必须落盘（文件或 SQLite），不能只在内存。

---

## 7. 方案对比（按存量 + 自动感知重估）

| | A：只读表目录 | B：存量对账 + 批量补齐 | C：离线扫描器收产物 | D：加固现有能力（基线） | E：自动感知（编排 KTX scan） |
|---|---|---|---|---|---|
| 覆盖层 | L1 | L1 + L2 | L1 + L2（+L3/L4） | L2 加固 | L1 持续 + L2 变更检测 |
| 写盘 | ❌ | ✅ **补缺式**写 Manifest | ✅ 外部生成后上传 | 不变 | ✅ 档 2 自动追加结构 |
| 入口 | 连接概览 | import-scope（对账）+ 连接概览（补结构） | 客户侧流程 | — | 连接概览（差异清单） |
| 触碰真源/门禁 | 不碰 | 碰，但受控 | 不碰 | 不碰 | 只碰结构事实，不碰授权 |
| 存量可用性收益 | 中 | **高** | 中 | 低 | 中（维持长期可用） |
| 用户操作成本 | 每次手动 | 批量 | 批量 | — | **接近零**（自动累积） |
| 需新建机制 | 端点 + UI | 批量作业 + staging + 确认 + 基线对账 | 客户侧流程 | 队列/缓存/审计/错误码 | 后台 reconciler + 差异清单存储 + 队列隔离 + 暂停策略 |
| 工作量（估算） | 3–5 人日 | **10–15 人日 + 真实存量对账** | 1–2 人日 | 2–3 人日 | **9–15 人日** |
| 建议 | **做** | **做（必要）** | 保留兜底 | **先做** | **做（前提：KTX scan 可用）** |

**A 与 E 的关系**：E 是 A 的持续化版本，不是替代。**建议合并设计**——把「表目录查询」升级成「表清单 + 列数指纹」，一个端点同时服务展示、轮询与对账（§5.3）。合并后 A 的增量成本只有 1–2 人日。

---

## 8. 推荐路线

### 第 0 步：治理对账 + 前置调研（不写生产代码）
1. 「不扫物理库」家族（Spec 21 §2.2 / 28 §3 / 29 非目标 / 34 §3）与实际实现（107 / 157 / 164 已能读库并落盘 Manifest）**未对账**，先对齐口径。
2. 核实交付镜像 KTX 0.16.0 是否提供 `ktx scan`、其参数与 AI 依赖（§5.4）。
3. 复核 `docs/specs/lucy-platform-goal-checklist.md:87` 关于「无顶层 scan 命令」的记录。

### 第 1 步：对账先行（存量最低成本、最高价值）
把 `import-scope` 的 `discovered` 从「手工传入」变成「扫描产出」。四份对账 + 两份差异立刻给出存量连接全景，**不写盘**，风险最低。

### 第 2 步：加固现有「读取表结构」（方案 D）
- `schema-structure` 纳入探测队列 + 连接配置代次 + TTL 缓存
- 补审计；把「超时 / 权限不足 / 库或 schema 不存在 / 协议不支持」升级为**分层错误码**
- 补 SQL Server / Oracle 列级预览分支
- 补齐「补缺式」写入语义：已有 Manifest 不覆盖；保留 `descriptions.ai`

### 第 3 步：自动感知（方案 E）
- 编排 KTX scan（或等价只读扫描），产出 per-connection 指纹
- 后台 reconciler：单副本、间隔可配、可暂停、退避、代次失效、每次扫描入审计、**不占用健康检查队列**
- 差异清单落盘（约束 10），连接概览可见，不弹窗
- 默认动作 = **档 2（自动追加结构事实）**；**不自动启用**；表消失只提示不自动移除

### 第 4 步：批量补齐（方案 B，存量主战场）
逐 schema 生成最小 Manifest → staging → 差异预览 → 确认 → 发布工作台 → 角色有效 source 基线对账。

### 第 5 步：L3 数据画像（仅已启用表）
采样、空值率、基数、Top 值。可选、可降级、不阻塞（约束 1）。

### 明确不做（本轮）
连接级「一键覆盖」Manifest、扫描结果自动写 `enabled_tables`、L4 语义自动生成。

---

## 9. 风险清单

| 风险 | 严重度 | 说明 | 缓解 |
|---|---|---|---|
| **覆盖抹掉 `descriptions.ai`** | **极高** | 存量 Manifest 比 Lucy 能生成的更全，覆盖即丢语义（§4.4） | 补缺不覆盖；diff 确认；保留已有描述 |
| **自动轮询扩大凭据暴露面** | **高** | 从「Owner 按需」变成常态化连库，是客户安全评审的新增项 | 可按连接关闭；间隔可配；扫描入审计；失败退避 |
| **自动感知被误当作授权** | **高** | 若自动追加的表被连带自动启用，Agent 可见面扩大 | 结构与授权彻底分离（§5.5）；自动只做结构 |
| 元数据即敏感数据 | 高 | 表名 + 列名 + 注释可反推业务 | 优先已启用表；owner 限定；审计 |
| 误改生产资产 | 高 | 存量连接在用，扫描写盘影响 catalog reload → MCP 可见源 → 问数 | staging + 发布工作台 + 基线对账 + 回滚 |
| 「扫到了」≠「能问数」 | 高 | Spec 164 明确禁止该暗示 | 文案分层：结构已读取 ≠ 语义已就绪 ≠ 可问数 |
| 静默授权失效 | 高 | 存量 `enabled_tables` 空/缺省 ⇒ 角色编译失败而 Pod Ready | 扫描顺带诊断；补齐后跑基线对账 |
| 库负载 | 中 | 多连接 × 轮询频率 | 两段式探测；间隔可配；独立配额 |
| 空转误报 | 中 | 权限收窄导致突然 0 表 | **不自动清空本地**；只报差异，附原因 |
| 大库硬失败 | 中 | 单次 10000 行上限，满页即失败而非截断 | 分批 + 明确错误码 + 失败隔离到 schema 级 |
| 绕过 ACL | 中 | 扫描结果若进 Agent 可见目录，等于暴露未授权表的元数据 | 扫描产物不进 Agent 可见面；或与 ACL 编译口径对齐 |
| 单副本无 HA | 中 | Pod 重启丢内存态 | 差异清单落盘；重启后重扫对账（约束 10） |
| 命名回归 | 中 | 「扫描」类词汇违反现有术语标准 | 术语登记作为发布前置 |

---

## 10. 待拍板的决策点

**通用**
1. 扫描对象：全库表 vs **已启用表**（建议后者；存量下优先级更明确）
2. 权限口径：Spec 107 说「Owner」，实现只要「已登录管理员」→ 是否收紧到 owner
3. 协议范围：先 MySQL/PG 家族，还是本轮补齐 SQL Server / Oracle
4. 命名：新动作的规范词（现有禁用「扫描 / 物理扫描」）

**存量追加**
5. **验收样本来源**：拿哪个真实存量连接做对账验收？仓内无样本（§4.8），需你指定
6. **写 `enabled_tables` 是否纳入本需求**：建议**否**（属授权变更，应独立）

**自动感知追加**
7. **自动感知的默认动作档位**：档 1（只提示）／**档 2（自动追加结构事实）**／档 3（自动启用，不建议）→ 建议档 2
8. **轮询间隔与默认值**：按连接可配？默认多少？（建议小时级起步，不建议分钟级）
9. **是否允许「自动感知」整体开关**（按连接 / 按实例）：建议**按连接可关**，客户安全评审需要
10. **自动感知失败时的呈现**：暂停状态是否需要进通知通道（L25-05 SMTP 已有 worker）
11. **KTX scan 不可用时的退路**：若交付版 KTX 0.16.0 没有 `ktx scan`，是否接受 Lucy 自建轮询 + 自建快照存储（会突破 KTX 边界，需你明确授权）

---

## 11. 证据索引

| 结论 | 证据 |
|---|---|
| **KTX 已有 per-connection scan snapshot，Lucy 已能读** | 实测 `entity_details` → `scan_missing`：「No live-database scan found for connection "demo-mysql"; run `ktx ingest demo-mysql` or `ktx scan demo-mysql`」 |
| **快照非自动维护（自动感知的缺口）** | 同上：`demo-mysql` 无 scan ⇒ 扫描必须被显式触发 |
| **本机 KTX CLI 无 `scan` 命令（前置未知项）** | `ktx scan --help` → `error: unknown command 'scan'`（`@kaelio/ktx` 0.12.0） |
| 既有记录与运行实例不一致 | `docs/specs/lucy-platform-goal-checklist.md:87`「KTX 0.16.0 无顶层 `scan` 命令」 |
| live-schemas 能力与代次/TTL | `webui/server/live-catalog.ts:5,60,200-265`；`webui/server/index.ts:1517-1549` |
| 列级预览只支持 mysql/pg | `webui/server/schema-structure.ts:146-160` |
| 列级预览直连不走队列、无缓存 | `webui/server/index.ts:1500-1515` |
| 10000 行上限、满页即失败 | `webui/server/schema-structure.ts:70-71,201-203` |
| 最小 Manifest 只产 `descriptions.db` | `webui/server/schema-structure.ts:110-133` |
| 交付客户 Manifest 含 `descriptions.ai` | `customer-config.example/config/semantic-layer/customer-db/_schema/analytics.yaml` |
| Manifest 表 = 唯一 source 来源 | `webui/server/catalog-reload.ts:244-275`；`webui/server/semantic-layer.ts:425` |
| 读库→落盘闭环 | `webui/src/lib/prepareSchemaStructure.ts:68-101`；`webui/server/catalog-assets.ts:825,859-903` |
| 「已扫描」= Manifest 唯一事实源、门禁 | `webui/docs/04-data-model.md:195`；`webui/docs/116-enabled-tables-orphan-drift-save-spec.md` |
| 启用表范围交集、空集不退回全表 | `webui/docs/182-enabled-table-intersection-spec.md` §2 |
| import-scope 四份对账 + 两份差异、`discovered` 为调用方传入 | `webui/docs/183-import-scope-preview-spec.md` §2/§4；`webui/server/admin/import-scope.ts:9-10,259-271` |
| L25-11 分工：不自动补结构 / 不把导入等同授权 | `docs/specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md:62-64` |
| L25-11 staging + 发布工作台 + 快照/回滚 | 同上 §3.2、§4.5 |
| Zero AI Dependency 与 M14 废弃 ingest | `webui/docs/17-static-catalog-loading-spec.md:16-30`；`webui/server/index.ts:1746-1776` |
| 「不扫物理库」家族 | `webui/docs/21-connection-catalog-upload-ux-spec.md:59-66,176-180`；`28-...:63`；`29-...:347`；`34-...:63` |
| 受控例外与 Owner 措辞 | `webui/docs/107-connection-live-catalog-discovery-spec.md:47,61-67,120,176-179` |
| 读库生成 Manifest 已实现（服务新建路径） | `webui/docs/157-setup-assistant-live-structure-ux-spec.md`；`webui/docs/164-add-schema-structure-next-step-spec.md` |
| 术语三列与禁用词 | `webui/docs/00-product-terminology-standard.md:320-334`；`webui/docs/17-...:179` |
| 权限落差（Owner vs 登录管理员） | `webui/server/index.ts:663`；`webui/server/auth/guard.ts:81,140` |
| ACL 与敏感元数据面 | `webui/server/proxy/acl.ts:67-74,141-163,2957-2970` |
| **单副本交付形态（无 HA）** | `deploy/k8s/helm/lucy/values.yaml:4-5,62-64`（`replicaCount: 1` + Recreate + RWO PVC） |
| 后台调度范式（可抄） | `webui/server/notifications/worker.ts:267-273`；`security/projector.ts:367-429`；`display-snapshot.ts:381-385` |
| 探测队列硬上限 | `webui/server/background-probes.ts:15-18,20` |
| 代次失效机制 | `webui/server/display-generation.ts:3-10`；`webui/server/index.ts:627-631` |
| 升级评审的逐角色有效 source 基线断言 | `docs/reviews/2026-10-21-customer-20260828-v1-to-lucy-2.0-upgrade-plan-review-crosscheck.md:96` |
| 升级评审承认现网 ktx.yaml 状态不可从仓库证明 | 同上 `:94` |
| KTX 版本锁定 | `Dockerfile:22`（`KTX_VERSION=0.16.0`） |
| 仓内无真实存量样本 | `config/semantic-layer/`（空）；`customer-config.example/`（模板）；`examples/*/project-template/`（demo 模板） |
