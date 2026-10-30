# Lucy Hive 问数（执行侧）Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-draft |
| 日期 / 目标版本 | 2026-10-30 / v0.25 |
| 功能编号 / 优先级 | L25-10（执行波）／P1 |
| 状态 | **T0 合同草案已落盘，待需求审查；未授权 JDBC／MCP 实现**。本条不回开 [编译侧 Spec](lucy-20261025-v0p25-hive-direct-connection-spec.md) 的已收口出口。数据库支持状态保持 `planned` |
| 授权来源 | 2026-10-30 用户批准推进「Hive 能问数」Task，并要求分区为一等公民 |
| 配对 Plan | [lucy-20261030-hive-query-execution-plan.md](../plans/lucy-20261030-hive-query-execution-plan.md) |
| 上游 | [Hive 直连编译侧 Spec](lucy-20261025-v0p25-hive-direct-connection-spec.md)（已收口）；[上游实施方案](../plans/2026-10-20-hive-direct-connection-implementation-plan.md)；[E2E Spec](lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 的 `HIV25` |
| 实施边界 | 单实例／单副本；只改 Lucy，不修改、复制、补丁或 monkey-patch KTX；不经 Doris／SelectDB／Trino 冒充直连；客户目标 linux/amd64 Kubernetes 离线交付 |

本条把「Hive 能经 Lucy MCP 问数」收成功能合同。相对 MySQL／PostgreSQL，**表分区（partition columns）是硬门禁**，不是优化建议。`LIMIT`、行策略与问询预算都不能替代分区边界。

---

## 闭口层级

- 层级：功能合同
- 本条承诺：对已登记的 Hive 连接与已发布语义资产，经统一准入后，Agent 可以在**分区边界成立**的前提下编译并执行只读语义查询；缺分区边界、分区未知或 JDBC 未就绪时失败关闭，不得报成已成功问数
- 本条出口：HQ-01–HQ-18（见 §7）；能打假分区登记、分区门禁、MCP 分流、JDBC 只读执行与「未执行不得冒充成功」
- 不在本条出口：整库旅程、多客户端 Agent 深度矩阵、客户认证／TLS／离线／amd64 全组合、升级与备份恢复、证据等级、支持矩阵晋级；编译侧 V01／V02／V06（已由编译侧 Spec 收口）；审计账本本身（L25-09）；ACL／`FinalRows`／行策略模板／问询预算引擎（各自既有 Spec）；管理台连接 Drawer 的完整视觉交付（可后置）
- 上线关系：本条收口不表示可上线；数据库支持状态保持 `planned`，直至按支持矩阵另行取证晋级

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **Hive Table Partition**：Hive 表分区。物理表按分区键（如 `dt`、`region`）切分存储与剪枝的单位；不是窗口函数 `PARTITION BY`，也不是术语标准里的「模块术语分区」。
- **Partition Key**：分区键。已登记的分区列名及层级顺序；必须来自元数据采集，不得由 Agent 臆造。
- **Partition Bound**：分区边界。聚合前、针对每个物理分区表可证明的有界分区谓词集合（见 HQ-D3／HQ-D5）。
- **Partition Predicate Gate**：分区谓词门禁。编译后、JDBC 分派前的硬检查；失败则稳定拒绝，不分派。
- **Hive JDBC Worker**：Hive JDBC 执行器。受管只读执行进程；持有凭据；不接受 Agent 自定义 JDBC URL／JAR／会话初始化语句。

沿用：HiveServer2（HS2）、Hive 直连、Hive 编译桥、连接、连接 ID、Schema、Schema Manifest、semantic overlay、启用表范围、最终行约束、配置审计。

Protected DOM：`HiveServer2`、`HS2`、`JDBC`、`JRE`、`PARTITION BY`（窗口）、分区键列名、`hive_partition_predicate_required`、`hive_partition_status_unknown`、`dialect=hive`、数据库／表／字段标识、文件名、路径与 URL。

---

## 1. 目标与范围

### 1.1 目标

外部 Agent 经 Lucy MCP Proxy，对 HiveServer2 上的受治理表完成：

> 统一准入 → 已发布资产与来源闭包 → Hive 编译桥 → 严格 AST／行策略证明 → **分区谓词门禁** → 受管 JDBC 执行 → 有界结果与审计。

### 1.2 本条包括

- JDBC worker：连通测试、只读 execute／fetch／cancel／close；类型保真；凭据隔离。
- 元数据：database／表／列／注释／**分区键与层级**；写入 Manifest 可消费的分区画像。
- 分区谓词门禁（HQ-D1–HQ-D8）与稳定拒绝码。
- MCP／发现分流：`lucy_query`、`lucy_explain_query`、`lucy_read_source`（受控）、`connection_list`、`lucy_catalog` 合入 Hive。
- 与既有 ACL、行策略转译、预算、审计合同的接线（不重做引擎）。

### 1.3 本条不包括

- 回开或改写编译侧 Spec 已收口出口（V01／V02／V06）。
- 跨连接联邦、DML／DDL、ADD JAR、SET、USE、Agent 自定义驱动。
- SelectDB／Doris 外部 Hive Catalog。
- 客户全认证矩阵晋级、离线 amd64 交付包、升级 E2E（归 `HIV25`／`LIFECYCLE`／支持矩阵）。
- 默认浏览器／移动窄屏测试（须另行批准）。

---

## 2. 已冻结设计裁决

| 编号 | 裁决 | 失败边界 |
|---|---|---|
| HQ-D1 | 元数据采集必须登记分区键名与层级顺序；写入已发布资产可消费的分区画像 | 无分区画像不得把该表当作「已确认非分区表」放行问数 |
| HQ-D2 | 分区状态三态：`partitioned`／`unpartitioned`／`unknown`。`unknown` 默认拒绝问数（仅允许另授权的元数据探测） | 不得把 `unknown` 当成 `unpartitioned` |
| HQ-D3 | 对 `partitioned` 表：每个物理分区表在聚合前必须具备**分区边界**；门禁在 JDBC 前；失败码 `hive_partition_predicate_required`（或等价稳定码） | 不以空结果、超时或预算耗尽冒充「已拒绝」 |
| HQ-D4 | `LIMIT`、问询预算、行数截断、行策略、`ORDER BY` **都不是**分区边界 | 仅有上述条件仍缺分区边界 → 拒绝 |
| HQ-D5 | **有界前缀规则**：多级分区键 `(p1, p2, …, pk)` 允许只约束从 `p1` 起的连续前缀；前缀每一级必须有界（等值、闭区间或显式枚举）；后缀未约束可以放行。零级约束 → 拒绝 | 跳级约束（如只约束 `p2` 不约束 `p1`）→ 拒绝 |
| HQ-D6 | SQL 窗口／分析函数中的 `PARTITION BY` **不计入**表分区边界 | 不得用窗口子句冒充分区门禁 |
| HQ-D7 | 行策略（可信 `filters[]`）与分区边界同时成立；二者合取 | 行策略成立但无分区边界 → 仍拒绝 |
| HQ-D8 | `unpartitioned` 表不走 HQ-D3；仍须通过编译、AST、ACL、启用表与预算 | 不得把分区表误标为 `unpartitioned` 以绕过门禁 |
| HQ-D9 | 复用未修改的 `ktx-daemon semantic-query`（`dialect=hive`）与既有编译侧库；凭据只到 JDBC worker | 编译进程持有 HS2 凭据或回退 Postgres → 停止交付 |
| HQ-D10 | Hive 问数挂在同一道 Lucy 准入之后分流；非 Hive 连接行为不变 | 另开未准入入口或污染 KTX `driver` → 停止 |
| HQ-D11 | `lucy_explain_query` 只编译 + AST + 分区门禁诊断，不触发 JDBC 业务执行 | explain 触发业务执行 → 缺陷 |
| HQ-D12 | 支持矩阵逐组合认证；本条通过不晋级 `planned` | 局部参考环境成功不得写成客户 `verified` |

### 2.1 「有界」的操作性定义

对分区键列 `p` 的谓词，在严格 Hive AST 下满足下列之一即视为对该级有界：

1. 等值：`p = const` 或 `p IN (const, …)` 且枚举非空、元素可求值；
2. 闭区间：可规范化为 `p >= const1 AND p <= const2`（或类型等价），两端皆可求值；
3. 显式有限集合的其它形态，须在实现中映射到 1 或 2，并有单测锁住。

下列**不**算有界：`p IS NOT NULL`、仅 `p > const`／`p < const` 的单侧开区间、对非分区列的过滤、参数无法在服务端求值为常量、仅注释或字符串拼进 SQL。

字符串常量的引号、转义与类型（`STRING`／`DATE`／`INT` 分区键）必须与元数据登记类型一致；不一致 → 门禁失败。

### 2.2 停止交付条件

1. 必须修改 KTX 才能保证编译正确。
2. 分区状态可被 Agent 或错误采集路径改写成 `unpartitioned` 以绕过门禁。
3. 门禁只做 SQL 文本子串匹配，不能经 AST 证明聚合前谓词。
4. JDBC 在门禁失败后仍被调用。
5. decimal／bigint 经 JavaScript `number` 丢精度仍对 Agent 返回。

---

## 3. 架构

```text
外部 Agent
  → Lucy MCP Proxy：身份、ACL、行策略、预算、审计准入
  → 连接来源分流
      ├─ KTX 连接：原链路
      └─ Hive 连接：
            已发布 generation + 分区画像
            → Hive 编译桥（dialect=hive）
            → 严格 AST／来源／行策略证明
            → 分区谓词门禁（HQ-D3–HQ-D7）
            → 准入账本
            → Hive JDBC Worker → HS2
            → 类型保真、截断、响应准备账本、释放
```

配置仍在 `webui/config/hive-connections.yaml`（凭据只存引用，不写 `ktx.yaml`）。编译侧模块继续作为库复用；本条新增 JDBC、元数据分区画像、门禁与 MCP 分流。

---

## 4. 分区画像与元数据合同

### 4.1 采集

经受管 JDBC／固定只读元数据操作采集（不复用 MySQL `information_schema` 假设）：

- database（映射为 Schema）、table、column、类型、注释；
- **分区键列表（有序）**；
- 分区状态：有分区键 → `partitioned`；确认无分区键 → `unpartitioned`；采集失败或不完整 → `unknown`。

可选：分区值枚举或边界摘要，仅用于治理展示与测试夹具；生产枚举必须有行数／时间上限，超限记截断，不得阻塞门禁（门禁依赖谓词证明，不依赖枚举穷尽）。

### 4.2 资产

已发布 generation 必须能让来源闭包读到：

- `partitionStatus`
- `partitionKeys: [{ name, position, type }, …]`（字段名实现可对齐现有 Manifest 风格，语义不可缺）

发布校验：目标为「可问数」的分区表若缺分区键登记 → 发布失败或保持不可问数；不得静默当非分区表。

### 4.3 发现

`lucy_catalog`／source 读取对授权可见的 Hive 源披露分区键与分区状态（Protected DOM 保护列名）。Agent 必须能发现「要带哪些分区键」，而不是只在拒绝后才知道。

---

## 5. 工具路由

| 工具 | 合同 |
|---|---|
| `connection_list`、`lucy_catalog` | 合入经授权的 Hive 连接／Schema／表／指标／分区画像 |
| `lucy_query`、获准 `sl_query` 别名 | 准入后走 Hive 链；过分区门禁后才 JDBC |
| `lucy_read_source` | 相同 ACL、行策略与分区门禁；受控投影与行数上限 |
| `lucy_explain_query` | 编译 + AST + 分区门禁诊断；**不** JDBC |
| `sql_execution`、`ktx sql`、`ktx ingest`、联邦 | 显式不支持 |

---

## 6. 核心流程（伪代码）

```text
handleHiveQuery(identity, tool, untrustedArgs):
  received = persistReceivedUsingExistingLedger()
  if received failed: return AUDIT_UNAVAILABLE; no compile; no JDBC

  snapshot = loadCommittedHiveConnectionAndPublishedGeneration()
  request = normalizeAndValidateToolContract(tool, untrustedArgs)
  stripClientForcedFieldsAndPolicyOverrides(request)
  decision = existingAuthorizeAndRewrite(identity, request, snapshot)
  if denied: persistAndFinishWithoutJDBC()

  deadline = existingBudgetAndConcurrencyAdmission(identity, request)
  if unavailable: persistAndFinish()

  sources = resolveCompleteSourcesAndTransitiveDependencies(request, snapshot)
  assertEveryPhysicalDependencyAllowed(sources, decision, snapshot.enabledTables)

  for each physicalTable in sources.physicalDependencies:
    status = partitionStatus(physicalTable, snapshot)
    if status == unknown:
      return hive_partition_status_unknown; no JDBC
    # partitioned / unpartitioned recorded for gate below

  compilerQuery = normalizeQueryAndInjectTrustedFilters(request, decision)
  compiled = callUnmodifiedKtxDaemon(sources, compilerQuery, dialect="hive", deadline)
  if compile failed: persistTypedFailure(); no JDBC; no postgres fallback

  checked = strictHiveAstAndCapabilityCheck(compiled.sql, compiled.plan, decision)
  assertRowPoliciesBeforeAggregation(checked)

  gate = partitionPredicateGate(checked.ast, sources, snapshot)
  # HQ-D3–HQ-D8: prefix bounds; window PARTITION BY ignored; LIMIT ignored
  if gate.failed:
    persist gate.reason  # hive_partition_predicate_required | …
    return deny; no JDBC

  if tool == explain:
    persistDiagnostic(compiled, gate); return without JDBC

  persistAdmittedDispatch()
  if persist failed: no JDBC

  operation = jdbcWorker.execute(checked.sql, trustedConnectionId, deadline, limits)
  fetchBoundedBatchesWithCancelObservation()
  result = normalizeTypesWithoutPrecisionLoss()

  persistObservedExecutionAndResponsePrepared()
  if response-prepared failed: withhold payload; do not claim upstream never executed
  releasePerExistingDeliveryContract()
  finally: closeOperation; releaseConcurrencySlot()
```

失败顺序：审计接收 → 配置／资产 → 请求与 ACL → 预算 → 来源闭包 → 分区状态（unknown）→ 编译 → AST／行策略 → **分区谓词门禁** → 准入账本 → JDBC → 类型与截断 → 响应准备 → 释放。

---

## 7. 验收矩阵（本条出口）

结果只允许 `pass / fail`。缺环境的项不得记入本条 `pass`；可在 Plan 中标 `blocked_environment` 并排除出本条收口条件。默认不新增浏览器测试。

| ID | 场景 | 通过标准 |
|---|---|---|
| HQ-01 | 分区画像采集 | 分区表登记有序分区键与类型；非分区表为 `unpartitioned`；采集失败为 `unknown` |
| HQ-02 | `unknown` 拒绝 | 分区 `unknown` 的表问数在 JDBC 前拒绝，稳定码可测 |
| HQ-03 | 缺分区谓词拒绝 | `partitioned` 表无任何分区键有界谓词 → `hive_partition_predicate_required`，JDBC 调用次数为 0 |
| HQ-04 | 仅 LIMIT 仍拒绝 | 有 `LIMIT` 无分区边界 → 同 HQ-03 |
| HQ-05 | 仅行策略仍拒绝 | 仅有租户等行策略、无分区边界 → 同 HQ-03 |
| HQ-06 | 有界等值通过 | `dt = '2026-01-01'`（或资产等价 filter）过门禁并可执行（有环境时） |
| HQ-07 | 有界前缀通过 | 二级分区只约束 `p1` 有界、`p2` 不约束 → 门禁通过 |
| HQ-08 | 跳级拒绝 | 只约束 `p2` 不约束 `p1` → 拒绝 |
| HQ-09 | 窗口非表分区 | 仅有窗口 `PARTITION BY`、无表分区边界 → 拒绝 |
| HQ-10 | 非分区表 | `unpartitioned` 不要求分区谓词；仍受 ACL／AST／启用表约束 |
| HQ-11 | explain 不执行 | `lucy_explain_query` 返回编译／门禁诊断，JDBC 业务执行次数为 0 |
| HQ-12 | MCP 分流 | Hive `connectionId` 走本链；KTX 连接行为与本条无关且回归不变 |
| HQ-13 | 编译凭据隔离 | 编译子进程环境无 HS2 秘密；秘密仅 worker 可见 |
| HQ-14 | 只读与多语句 | 多语句／写入类 AST 在分派前拒绝 |
| HQ-15 | 类型保真 | decimal／bigint 不经 JS number 丢精度（契约测试或固定夹具） |
| HQ-16 | 取消观察 | 取消／超时时尝试服务端取消并记录终态；不盲重试业务查询 |
| HQ-17 | 审计区分 | 编译成功≠执行成功；门禁拒绝无 JDBC attempt 成功记录 |
| HQ-18 | 固定分区夹具 oracle | 合成多分区数据上，带分区边界的聚合结果与独立 JDBC／Beeline 手写 SQL 一致；不用被测编译器生成 oracle |

### 7.1 固定夹具最低要求

- 至少一张二级分区表（如 `dt` + `region`）与一张非分区表。
- 跨分区写入固定行，使「全表合计」与「单分区合计」可区分。
- 独立 setup 账号种数；Lucy 只读账号无 DDL／DML。

---

## 8. 与既有 Spec／编号的关系

| 对象 | 关系 |
|---|---|
| 编译侧 Spec（L25-10 编译波） | 已收口；本条复用其库与 V01／V02／V06 证据，不重开其出口 |
| `HIV25-V01`…`V17` | 仍为发布取证编号，由 E2E Spec 持有；本条 HQ-* 可被 `HIV25` 引用为功能证据，不得把 HQ 通过写成客户交付通过 |
| L25-09 | 账本合同沿用；本条只要求接线遵守 |
| 支持矩阵 | 保持 `planned` 直至另行晋级 |

---

## 9. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/00-product-terminology-standard.md` §4.1／§4.1.1（本条新增术语须同步入库后才可上 UI 文案）

### What This Change Follows

- [x] 本条最小闭环以 MCP／API／worker 为主；不强制本波交付新导航页
- [x] 分区键与拒绝码若出现在治理台，须 Protected DOM 与既有连接／Schema 模式
- [x] 失败关闭不靠颜色唯一表达（API 稳定码 + 可测消息）

### Exceptions (If Any)

- None for the MCP／worker minimum slice

### Follow-up Needed

- 连接 Drawer、分区画像展示、认证渐进披露若做管理台，另开变更并沿用既有连接卡；不阻塞 HQ-01–HQ-18 中与 UI 无关的项

---

## 10. 审查与授权边界

需求审查需确认：HQ-D1–HQ-D12、有界前缀规则、三态分区状态、MCP 分流与停止条件。

审查通过 **不** 自动授权：客户环境安装、镜像构建、部署、发布、支持矩阵晋级。实现按配对 Plan 分波授权；**T0 完成＝合同可审，≠ 已可问数**。
