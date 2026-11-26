# 非直连外部目录分区边界 Spike · 首轮取证证据评审

| 元数据 | 内容 |
|---|---|
| 文档名称 | 非直连外部目录（Doris / SelectDB → Hive）分区边界 Spike · 首轮取证证据评审 |
| 文档类型 | Review（过程评审记录） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-26 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 评审对象 | [Spike 草案 v0.1-draft](2026-11-25-external-catalog-partition-bound-spike.md) |
| 关联登记 | `docs/plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md`（0.35 分支沿用）· 未登记独立 REQ |
| 配套文档 | [客户 HMS thrift 握手失败定性与本机取证边界 Review](2026-11-26-hms-thrift-handshake-evidence-review.md)（同轮并行产出，聚焦 §4.3 的 thrift 定性；本记录为 Spike 全量取证评审，**结论以本记录为准**） |
| 评审方法 | 只读核对 Spike §2 代码基线与仓库实现；用本机真实 Doris 2.0.14 ＋ 真实 Hive HMS 做零改造只读取证；用 demo 栈真实 `audit.sqlite` 检验 S1 取样方法 |
| 评审结论 | **不足以支撑 Go / No-Go 决策。H1／H2／H4 未取证且本机不可闭环；H3 已取证成立但推翻了 Spike 的采集路径假设。不建议现在立项硬门禁。** |
| 授权边界 | 本记录不构成终稿确权、开发授权、功能合同收口、UAT 判定或发布取证；全程未修改运行代码、未改导航 IA、未登记需求池条目 |
| 输出位置 | `docs/reviews/2026-11-26-external-catalog-partition-bound-spike-evidence-review.md` |

## 1. 裁决

Spike 的问题描述、代码基线与三条设计红线**方向正确、质量可用**，值得继续推进取证。但**当前证据不足以回答「是否需要功能优化」**：

- **H1（痛点占比）未取证**，且在 demo 上**结构性不可取证**（单 MySQL 源、无外部目录连接、无慢查询）。demo 上「无超时」**不等于** H1 被证伪 —— 观测域不对，两者不可混同。
- **H2（剪枝行为）本机不可闭环**。客户 HMS 与 Doris 2.0.14 在 thrift 握手层失败（§4.3），本机 HMS 正常，二者差异因子在客户侧。
- **H3（元数据采集）已取证成立**，但实测结果**修正了 Spike 的采集路径假设**：`DESC` 不足，必须 `SHOW CREATE TABLE`，而该语句**不在**现有只读白名单内（§4.2）。
- **H4（软约束有效率）未取证**，demo 无外部目录连接与真实 Agent 行为。

因此**建议保持 Spike 为未决策状态**，先补 H1／H2／H4 现场证据，再走 §6 的 Go / No-Go 矩阵。

## 2. 认同项

| 编号 | 认同项 | 理由 |
|---|---|---|
| A1 | 把「超时只是症状不是根因」写成显式判断 | 与仓库既有护栏设计（90s 硬截止、300s 预算、并发槽）一致，避免把调参当治理 |
| A2 | 明确「是否必须立项仍属未知数」，用 Spike 而非 Spec 推进 | 符合仓库「先入需求池再动手」与「未授权条目禁止改运行代码」 |
| A3 | §2 代码基线逐条给出代码落点 | 全部核对属实（§3），使评审可直接落到文件行 |
| A4 | 三条设计红线（主路径可用性优先／门禁与 `segment` 一致／KTX 依赖边界） | 红线 3 已验证可落地（§5.2），红线 1／2 指出了两处真实缺口（§5.1、§5.3） |
| A5 | 候选方案按杠杆分层、且把「超时只做护栏」单列 | 避免用抬高超时掩盖根因，与既有超时治理不冲突 |
| A6 | §8 取证记录表预置空白 | 本记录按该表结构回填，便于后续现场补录 |

## 3. Spike §2 代码基线核对结果：**全部属实**

| Spike §2 主张 | 核对结论 | 落点 |
|---|---|---|
| 直连已实现三态分区画像与编译后 AST 前缀门禁，缺边界 0 次 JDBC 调用 | ✅ 属实 | `webui/server/hive/partition-profile.ts`、`webui/server/hive/partition-gate.ts` |
| 非直连前置护栏仅校验聚合嵌套／`count(*)` 无 source／字段歧义／别名，**无任何分区边界检查** | ✅ 属实 | `webui/server/proxy/query-guardrails.ts`（`applyLucyCallGuard` 四类检查，无分区项） |
| `UPSTREAM_TIMEOUT_MS=30s`、`UPSTREAM_HARD_DEADLINE_MS=90s`、`QUESTION_BUDGET_ABS_EXEC_MS=120s`、预算 `300s/60次`、`LUCY_QUERY_MAX_INFLIGHT=4`、`CANCEL_UNCONFIRMED_HOLD_MS=30s` | ✅ 全部属实 | `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/question-experience.ts` |
| 直连探测白名单仅放行 `SHOW DATABASES`/`SHOW TABLES`/`DESC`/`SHOW COLUMNS`/`DESCRIBE`，且不采集分区键 | ✅ 属实 | `webui/server/catalog-show.ts`（`CATALOG_SHOW_STATEMENT`） |
| `TableModel` 与 Manifest 无 `partitionStatus`/`partitionKeys`；`lucy_catalog` 不暴露分区键与 `segments` | ✅ 属实 | `webui/server/model.ts`、`webui/server/semantic-layer.ts`、`webui/server/proxy/source-descriptions.ts` |
| `data-qa-instructions.md` 未包含「分区表／大事实表缺时间窗先澄清」 | ✅ 属实（全文无「分区／时间窗／澄清」） | `webui/config/data-qa-instructions.md` |

**补充事实**：仓库中 `hive-connections.yaml` **不存在**（仅 `webui/server/admin/routes/hive.ts` 写路径与测试夹具），与 Spike「仍为 `planned`」一致。

## 4. 现场取证结果

### 4.1 S1／H1：方法可行，但 demo **结构性不可取证**

**方法可行性（正面结论）**：`access_log` 字段足以支撑 S1 的三分类归因 —— `args_summary`（JSON，含 `connectionId`／`measures`／`filters`／`dimensions`）、`generated_sql`、`duration_ms`、`outcome`、`error_detail` 齐备；`access_log_sources` 提供 `connection_id`／`schema_name`／`source_name`／`physical_table` 维度。**S1 的取样与归因方法本身成立**，可直接复用到客户现网。

**demo 实测（`compose-lucy-1` 的 `/data/lucy/.ktx-ui/audit.sqlite`）**：

| 指标 | 实测值 |
|---|---|
| `access_log` 总行数 | 1,002,041 |
| `lucy_query` 行数 | 375,638 |
| `outcome` 分布 | `ok` 951,874／`denied` 50,159／**`error` 仅 8** |
| Spike S1 取样条件命中 | **8 条** |
| `lucy_query` `duration_ms` | min 1／**max 2,103**／avg 458 |
| 命中 90s 硬截止／`budget_stop`／`source_timeout` | **0** |
| `access_log_sources` 中的连接 | **仅 `demo-mysql`**，无外部目录连接 |

**8 条 `error` 全为守卫层文案**，无一条与分区相关：
`count(distinct order_id) does not reference any source`、`列 region 在多个来源中存在…`（字段歧义）、`Query-time segment 'active_rows' must be a dotted 'source.segment_name' reference.`、`Circular dependency detected: order_count`。

**判读**：demo 是 MySQL 单源小表栈，**在结构上无法产生 H1 所观测的现象**。因此 demo 上「零超时」**不能**写成「H1 证伪 → No-Go」。按 Spike §7 矩阵，**H1 仍属未取证**。

### 4.2 S3／H3：**成立**，但修正了采集路径假设

**环境**：本机 `selectdb/doris.fe-ubuntu:2.0.14` ＋ `selectdb/doris.be-ubuntu:2.0.14`（`Version: doris-2.0.14-eaaf726019`，**与客户版本一致**）＋ 本机真实 `apache/hive:4.0.0` HMS（Doris 侧 `CREATE CATALOG hive ... type=hms`）。

| 只读语句 | 实测结果 |
|---|---|
| `SHOW CREATE TABLE` | ✅ 分区表明确含 `PARTITIONED BY (\n \`dt\` string)`；非分区表（`fact_flat`）**无此段** → **可干净区分分区表／非分区表** |
| `SHOW PARTITIONS` | ✅ 返回 `dt=2026-11-20` … `dt=2026-11-24`（5 个分区） |
| `DESC ... ALL` | ❌ `External catalog 'hiveloc' is not allowed in 'DescribeStmt ALL'` |
| `DESC`（普通） | ⚠️ `dt` 以 `varchar(65533)` **普通列**返回，**无任何分区键标记** → **无法据此识别分区键** |

**对 Spike 的修正结论**：

1. **H3 成立**：只读账号可稳定识别外部目录表是否分区表并提取有序分区键 —— 但**只能靠 `SHOW CREATE TABLE`**（或 `SHOW PARTITIONS` 推断），**不能靠 `DESC`**。
2. Spike §4 S3「扩展 `DESC`」的思路**不成立**。Spike §2「直连探测白名单仅放行 … 且不采集分区键」这一现状判断属实，但**出路是新增 `SHOW CREATE TABLE` 白名单，不是扩展 `DESC`**。
3. **`SHOW CREATE TABLE` 当前不在 `catalog-show.ts` 的 `CATALOG_SHOW_STATEMENT` 白名单内** —— 任何自动采集方案都必须先新增该白名单条目。这是**新需求**，按仓库治理应先入需求池，不是本 Spike 的授权范围。
4. **可执行的修法已定位**：`catalog-show.ts` 的白名单是**正则**（`CATALOG_SHOW_STATEMENT`），新增 `SHOW CREATE TABLE` 属于同机制内扩展，不是新增通道。

### 4.3 S2／H2：**本机不可闭环**，且发现客户侧 thrift 握手失败

**客户 HMS（`10.69.67.141:9083`／`10000`）**：TCP **可连通**，但 Doris 侧操作最终失败：

```
ERROR 1105 (HY000): HMSClientException, msg:
shade.doris.hive.org.apache.thrift.transport.TTransportException: null
```

**这修正了既有认知**：`inbox/hive-lab/REPORT.md` 记录的是「9083／10000 能 TCP 连通但无应答，`set_ugi` 无回应，本次未能使用」。本轮把该现象**从「网络不通／无响应」定性为「Doris 的 HMS 客户端在 thrift 传输层失败」** —— TCP 三次握手成功不代表 thrift RPC 可用。同拓扑的本机 HMS（4.0.0）一切正常（`SHOW DATABASES`／`SHOW CREATE TABLE`／`SHOW PARTITIONS` 均正常返回），**唯一差异因子在客户 HMS 版本与鉴权方式**。

> **证据链缺口**：上述 `TTransportException` 原始输出**仅存在于会话观测，未落盘**；`inbox/hive-lab/` 既有日志经核对不含该错误文本。客户现场须重新捕获并落盘（含 Doris FE 日志中的 HMS 客户端栈）方能作为一手证据。详见配套文档 [HMS thrift 握手失败定性与本机取证边界 Review](2026-11-26-hms-thrift-handshake-evidence-review.md) §3。

**H2 无法在本机闭环的原因链**：

1. 用本机 Hive 4.0.0 时，Doris 2.0.14 报 `get file split failed for table: fact_bkt, err: java.lang.IllegalArgumentException: bucket is null/empty`。
2. 根因判定：HMS 侧元数据**正确**（HMS 日志 `Table fact_bkt,#bucket=4,isBucketed:true`），是 **Doris 2.0.14 读不了 Hive 4.0.0 的 bucket 元数据**（Hive 4.0.0 晚于 Doris 2.0.14 两年）；同一表在 Hive 侧 `Num Buckets: 4`／`Bucket Columns: [id]` 正常读出。
3. 仓库与本机镜像库**只有 `apache/hive:4.0.0`**；已改用 `apache/hive:3.1.3` 复现（HS2 起来并确认 `HS2 OPEN`），但本轮窗口内未完成端到端剪枝对照。

**因此 H2 必须在客户现网取证**（客户 Doris 2.0.14 ＋ 客户 HMS 组合）：本机任何 Hive 版本的剪枝结论**不能代表客户**，因为客户组合本身在 thrift 层就有差异。

**附带工程事实**：Doris 外部目录需 `REFRESH CATALOG` 才可见新建库 —— `CREATE CATALOG` 后 `SHOW DATABASES` 仅返回 `default`，`REFRESH CATALOG` 后才出现目标库。任何分区元数据自动采集方案**必须处理 catalog 缓存刷新**，否则会静默漏采。

## 5. 对 Spike 候选方案与红线的证据化修正

### 5.1 红线 1（主路径可用性优先）—— 缺口具体化

Spike 主张「存量外部目录表默认放行，仅对已显式标记 `partitioned` 的表执行硬拦截」。实测补强：**自动采集会立刻把大量存量表标成 `partitioned`**（`SHOW CREATE TABLE` 覆盖全库表），若无「采集结果不等于启用门禁」的分层，风险面远大于 Spike 描述。**建议**：自动采集产出与门禁启用**分离**，采集只填充状态，门禁启用需显式清单或按表规模阈值启用。

### 5.2 红线 3（KTX 依赖边界）—— 验证可落地 ✅

**参数层门禁存在唯一且干净的挂载点**：`webui/server/proxy/mcp-proxy.ts` 的 `lucyQueryUpstreamArgs` 是 `lucy_query` → KTX `sl_query` 的唯一收敛点，其中 `filters` 经 `normalizeLucyFiltersForUpstream` 归一、`forcedFilters`（行策略）已在同层注入。**在该层做分区边界校验即可实现硬门禁，全程不触碰 KTX 源码**。Spike 红线 3 的技术可行性**成立**。

### 5.3 红线 2（门禁与 `segment` 一致）—— 缺口具体化

`model.ts` 的 `Segment` 定义为 `{ name; expr; description? }`，其中 `expr` 是**任意 SQL 表达式字符串**，**不是**受治理的时间窗白名单；当前**不存在**「哪些 segment 受治理」的机制。因此 Spike「将受治理且经 S2 验证可剪枝的时间窗 `segment` 纳入合法边界」在 H2 未取证前**无法定义放行口径**，且即使 H2 成立，仍需先补「segment 受治理」这一前置机制（否则 `segment` 表达式可能是任意 SQL，门禁无法静态判定其是否含分区边界）。

### 5.4 H4 取证前提

`access_log` 无 Agent 决策过程字段，`args_summary` 只记最终工具入参，**无法区分「模型漏带条件」与「模型带了但被守卫改写」**。H4 若要结论可信，需走**Agent 对照实验**（同一批题，默认指引 vs 补指引后比对无界调用率），而非审计日志统计 —— 与 Spike §4 S4 的设计一致。

## 6. Go / No-Go 决策矩阵的当前状态

| 假设 | 状态 | 依据 |
|---|---|---|
| **H1** 痛点占比 | **未取证**（demo 结构性不可观测，**非证伪**） | §4.1 |
| **H2** 剪枝行为 | **未取证**（本机不可闭环，须客户现网） | §4.3 |
| **H3** 元数据采集 | **已成立**（须 `SHOW CREATE TABLE`，不在现有白名单） | §4.2 |
| **H4** 软约束有效率 | **未取证**（须外部目录＋真实 Agent 对照） | §5.4 |

**结论：当前不进入任何 Go 分支。** 按 Spike §7：

- **不得**因 demo 无超时而写「H1 证伪 → No-Go」—— 观测域不对。
- **不得**因 H3 成立而开硬门禁 Spec —— 红线 1 的存量放行分层、红线 2 的 `segment` 口径均未闭合，H2 未知。
- **可以**先行推进**只读、低风险**的前置项（新增 `SHOW CREATE TABLE` 白名单属于新需求，须先入需求池）。

## 7. 建议的下一步（按性价比排序）

| 优先级 | 动作 | 目的 | 前置 |
|---|---|---|---|
| 1 | **客户现网取 H1**：按 `outcome IN ('error','budget_stop')` 或 `duration_ms>=5000` 取近 7–14 天样本，用 `generated_sql`／`args_summary` 做 Spike §4 S1 的三分类归因 | 解锁决策矩阵的唯一必经项 | 客户审计库只读访问 |
| 2 | **客户现网取 H2**：客户 Doris 2.0.14 ＋ 客户 HMS 上跑 S2 的 5 组 `EXPLAIN`（常量等值／常量闭区间／相对时间函数／误写对照），记录 `partitions=` 裁剪结果 | 决定 `segment` 放行口径与红线 2 可行性 | **须先过 S0 前置**（见下） |
| 3 | **入需求池登记**「外部目录分区元数据只读采集（`SHOW CREATE TABLE`）」 | 让 H3 已成立的能力有正式落位 | 按仓库治理先入 `docs/backlog/README.md` |
| 4 | **H4 对照实验**：在 S1 抽样出的 Top 表上做默认指引 vs 补指引的无界调用率对照 | 决定是否需要硬门禁 | 依赖 1 的 Top 表清单 |
| 5 | 补齐 S2 的本机复现路径（`apache/hive:3.1.3` ＋ 同 warehouse 卷挂载） | 供后续回归复现用，**不作为客户结论** | 与 2 并行 |

**S0（取 H2 前必须先过的连通性前置）**：客户 HMS 的 thrift 失败（§4.3）意味着 S2 的 5 条 `EXPLAIN` 有可能整步跑不通。因此取 H2 前须先做最小连通验证 —— 客户 Doris 对客户 Hive Catalog 执行 `SWITCH hive; SHOW DATABASES;` ＋ 任选一表只读探针，确认**客户 Doris ↔ 客户 HMS 组合本身可读表**：

- 若客户 Doris 正在跑业务查询（大概率成立），说明其 thrift 层可通 → 需采集使能配置（`hive_jd` 的 Kerberos keytab、`hadoop.username`、`hive.metastore.uris` 实际指向），Lucy 侧连接必须对齐同一形态。
- 若组合本身也不通（复现 `TTransportException`）→ S2／S3 全部降级为「先解决连通性」，Go / No-Go 决策**顺延**。

**证据链缺口（须在客户现场补齐）**：`TTransportException` 原始输出目前**仅存在于会话观测，未落盘**。`inbox/hive-lab/` 既有日志（`big.log`／`before.txt`／`after.txt`）经核对**不含**该错误文本。客户现场取证时须重新捕获并落盘该错误（含 Doris FE 日志中的 HMS 客户端栈），作为 H2 边界的一手证据；取证脚本统一 `tee` 到带日期的文件并在 Spike §8 登记指针。

## 8. 取证记录表回填（对应 Spike §8）

| 项目 | 验证内容 | 实测结果 | 证据指针 |
|---|---|---|---|
| 环境基线 | 客户 Doris／SelectDB 版本、外部 Catalog 名、Lucy 版本 | **客户侧未取证**；本机侧：Doris `doris-2.0.14-eaaf726019`、Hive `apache/hive:4.0.0`（HS2＋HMS Derby）、Doris catalog `hiveloc`（`type=hms`） | §4.2、§4.3 |
| S1 审计归因 | 样本时间窗、总超时／慢查询数、无分区过滤占比、Top 表 | **方法可行；demo 结构性不可取证**：1,002,041 行 `access_log`／375,638 条 `lucy_query`，`error` 仅 8 条且全非分区原因，`lucy_query` max 2,103ms，零超时／零 `budget_stop`，连接仅 `demo-mysql` | §4.1 |
| S2 剪枝对照 | 五组写法的 `partitions=` 结果 | **未取证**。客户 HMS thrift 握手失败（`TTransportException`）；本机 Hive 4.0.0 与 Doris 2.0.14 bucket 元数据不兼容（`bucket is null/empty`） | §4.3 |
| S3 元数据探测 | `SHOW CREATE TABLE`／`SHOW PARTITIONS`／`DESC ALL` 权限、耗时、输出样本 | **成立**：`SHOW CREATE TABLE` 含 `PARTITIONED BY (\`dt\` string)`（非分区表无此段，可区分）；`SHOW PARTITIONS` 返回 5 个分区；`DESC ALL` 被外部目录拒绝；`DESC` 不带分区键标记 | §4.2 |
| S4 软引导对照 | 对照题数、默认无界触发率 vs 补指引后无界触发率 | **未取证**（demo 无外部目录连接） | §5.4 |
| **最终决策** | `No-Go`／`轻量止血`／`Go 最小闭环`／`Go 完整闭环` | **保持未决策**：H1／H2／H4 未取证，H3 成立但前置未闭合 | §6 |

## 9. 本轮未做与未覆盖

- **未修改任何运行代码**，未新增／修改导航 IA，未登记需求池条目 —— 符合「未授权条目禁止改运行代码」。
- 未对客户现网做任何访问；客户侧结论**全部**标注为「未取证」，无一处写成客户 live PASS。
- H2 的本机复现路径（`apache/hive:3.1.3`）**未端到端完成**：HS2 已起、`HS2 OPEN` 已确认，但建表与剪枝对照在本轮窗口内未跑完。
- 未验证 S4 的 Agent 对照实验（依赖 H1 的 Top 表清单）。
- 未验证客户 Kerberos 目录 `hive_jd` 的分区元数据采集（`hive_jd` 需 keytab；本轮只用无 Kerberos 的 `hive` 目录验证）。
- 未测「数千历史分区下 `SHOW PARTITIONS` 的耗时与行数上限风险」（本轮仅 5 个分区），该风险在客户大表上仍成立。
- 本记录**不是 UAT 跑次证据**，不改变测试台现值，不构成终稿确权或开发授权。

## 10. 复现与清理

**本轮实验环境（全部为只读／对照观测，无写操作进入客户环境）**：

- Doris 2.0.14 FE＋BE：`inbox/doris-lab/compose.doris-2.0.14.yml`（`doris-lab-2014`）
- Hive 4.0.0 HMS＋HS2：`deploy/compose/docker-compose.uat-hive-local.yml`（`lucy-uat-hive`）
- Hive 3.1.3：`apache/hive:3.1.3` ＋ 共享 warehouse 卷（复现路径，未跑完）
- BE 启动前置：`vm.max_map_count=2000000`（Docker VM 内）；BE 侧 `swapon` 检测用 `inbox/doris-lab/stubs/swapon` 替身
- 分区表夹具：`pdb.fact_part`（5 分区）、`pdb.fact_bkt`（4 bucket）、`pdb.fact_flat`（非分区）、`pdb3.fact3`（Hive 3，未跑完）

**清理状态**：本轮启动的容器（`doris-lab-2014-fe/be`、`lucy-uat-hive-hms/hs2`、`lucy-uat-hive3-hms/hs2`）已移除；临时文件（`/tmp/hive3-compose.yml`、`/tmp/seed_part*.sql`、审计库副本、warehouse 副本）已删；三个空卷（`lucy-hive3-warehouse`、`lucy-uat-hive-warehouse`、`tmp_lucy-hive3-warehouse`）已删除。demo 栈（`compose-lucy-1`、`compose-demo-db-1`）与 `lucy-uat-p18182` 未受影响，保持运行。

**副作用提示**：本轮为 BE 启动在 Docker VM 内设置了 `vm.max_map_count=2000000`（Doris BE 启动前置条件）。该值为 Docker Desktop 虚拟机级设置，**非仓库改动**，但会留在本机 Docker VM 上；如需还原可执行 `sysctl -w vm.max_map_count=65530`（macOS Docker Desktop 默认值）。
