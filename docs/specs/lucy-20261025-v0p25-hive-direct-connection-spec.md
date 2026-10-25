# Lucy v0.25 Hive 直连 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.1-requirements-review |
| 日期 / 目标版本 | 2026-10-25 / v0.25 |
| 功能编号 / 优先级 | L25-10 / P1-4 |
| 状态 | **设计完成、需求审查已签核通过（2026-10-25）；暂不开发，数据库支持状态保持 `planned`** |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；本轮只做设计与需求审查材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-10；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 审查执行通过、PM 已签核；附带 F-01–F-04 实施前待办） |
| 权威上游 | [Hive 直连实施方案](../plans/2026-10-20-hive-direct-connection-implementation-plan.md)；L25-09 审计合同；数据库支持矩阵 |
| 实施边界 | 单实例／单副本；只改 Lucy，不修改、复制、补丁或 monkey-patch KTX；客户目标为 linux/amd64 Kubernetes 离线交付 |

本文件把上游方案收口为需求审查基线。静态接口核查只证明设计有复用入口，不证明 Hive 查询、权限或交付已经可用。本轮未新增代码、驱动、测试、镜像或真实连接配置；V01–V17 全部未执行，H25-01–08 全部未开始。客户 HS2／认证／TLS／依赖未提供时，对应认证为 `blocked_environment`，不得写成 `passed`。

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **HiveServer2（HS2）**：Hive 查询服务端；不得与 Hive Metastore 混称，连接元数据服务不等于可问数。
- **Hive 直连**：Lucy 通过受管 Hive JDBC worker 连接 HS2；不是 Doris／SelectDB 外部 Hive Catalog，也不是 MySQL／PostgreSQL 协议兼容。
- **Hive 编译桥**：Lucy 调用原版 `ktx-daemon semantic-query`、显式传入 `dialect=hive` 的只编译进程边界；不执行 SQL，不持有数据库凭据。

沿用「连接」「连接 ID」「连通测试」「Schema」「Schema Manifest」「semantic overlay」「启用表范围」「最终行约束」「配置审计」。Hive database 在治理界面映射为 Schema，不另造含混的 Catalog 层级。

Protected DOM：`HiveServer2`、`HS2`、`JDBC`、`JRE`、`KTX`、`ktx-daemon`、`semantic-query`、`dialect=hive`、`SourceDefinition`、`forced_filters`、`filters[]`、`predefined_measures_only`、数据库／表／字段标识、文件名、路径与 URL，均须 `translate="no"` + `notranslate`。

## 1. 需求目标与范围

### 1.1 目标

使外部 Agent 经 Lucy MCP Proxy 对 HS2 数据使用统一连接治理、语义资产、ACL、行策略、预算与审计。最小纵向链路为：

> 连接配置 → 元数据采集 → 资产发布 → 工具发现 → 带 Token 的 Proxy 准入 → Hive 编译 → JDBC 执行 → 审计持久化 → 有界结果返回。

支持声明必须绑定实际 HS2 版本、发行版、transport、认证、TLS 和完整依赖身份；参考环境通过不能替代客户匹配环境认证，不能外推为整个 Hive 版本系列。

### 1.2 首期范围

- HS2 直连、连通测试、数据库／表／列／注释／分区元数据与 Schema Manifest 生成。
- 沿用 `semantic-layer/<connectionId>/` 的 Manifest 与 overlay；单 Hive 连接内语义查询、读取与只编译解释。
- 连接、Schema、启用表范围、角色授权、Agent 个人行限制、预算、取消和审计的统一治理。
- 受管 JDBC worker、离线依赖锁定、amd64 交付验证与升级恢复设计。

### 1.3 非目标

- 不跨连接联邦查询，不开放任意 JDBC 驱动上传、Agent 自定义 JDBC URL／JAR／会话初始化语句。
- 不开放 DML／DDL、CTAS、EXPORT、LOAD、ADD JAR、SET、USE 或自动修改 HS2／Hadoop 配置。
- 不把 `sql_execution`、`ktx sql`、`ktx ingest` 作为 Hive 入口；不把 Hive 写入 `ktx.yaml` 或伪装成其他驱动。
- 不默认支持复杂类型内部表达式；需要时通过受审阅 Hive 视图投影为可治理标量。
- 不以静默降级到原始 SQL、正则改 SQL、字符串替换函数或盲目二次转译换取“可用”。

## 2. 已锁定设计裁决

| 编号 | 裁决 | 失败边界 |
|---|---|---|
| H-D1 | 终点是 HS2；Lucy 自有连接模型与 JDBC worker 负责执行 | 不得经 Doris／SelectDB／Trino 冒充直连 |
| H-D2 | 复用原版 `ktx-daemon semantic-query` 只编译，显式 `dialect=hive` | 未知方言回退 Postgres、编译与执行耦合或需改 KTX 时停止 |
| H-D3 | Lucy 从已发布同一 generation 构造完整 resolved sources | 字段丢失、来源合并不一致、未知依赖时拒绝 |
| H-D4 | 强制行策略由 Lucy 在编译前转成可信 `filters[]` | 不能证明聚合前生效、策略被删或仅客户端提供时拒绝 |
| H-D5 | 编译后 SQL 经严格 Hive AST、只读、来源闭包、能力与行数检查 | 任一项未知或不符合即不向 JDBC 分派 |
| H-D6 | 编译进程与执行进程隔离；凭据只到受管 worker | 编译进程不得有 HS2 凭据；worker 不接受未授权连接参数 |
| H-D7 | 支持矩阵逐组合认证 | 缺客户组合为 `blocked_environment`；局部成功不升级为 `verified` |
| H-D8 | Hive 能力不改变现行审计、预算、单实例与发布门禁 | 不新增竞争性账本、共享写卷或默认发布阻断 |

### 2.1 停止交付条件

以下任一条件成立，停止对应能力交付并回到设计评审：

1. 锁定镜像中的计算入口不可用，或必须修改 KTX 才能保证正确。
2. Manifest／overlay 合并结果不一致，或物理来源闭包不能完整证明。
3. 生成 SQL 不能被目标 HS2 正确解析执行，或方言适配只能靠禁止的文本改写。
4. 行策略不能证明在聚合前对每个受保护来源生效。
5. 审计、取消、类型保真或资源释放无法遵守现行合同。

无法收敛的组合明确标为不支持；不得以切换 MySQL／Postgres 驱动或删除安全断言绕过。

## 3. 架构与配置合同

### 3.1 运行架构

```text
外部 Agent
  → Lucy MCP Proxy：身份、ACL、行策略、预算、审计准入
  → Lucy 数据源路由
      ├─ 既有 KTX 数据源：保持原链路
      └─ Hive：已发布语义资产快照
                → 原版 ktx-daemon semantic-query（只编译，dialect=hive）
                → Lucy Hive AST／来源／策略／能力检查
                → Lucy JDBC worker → HiveServer2
  → Lucy 类型保真、结果截断、审计持久化与响应释放
```

编译响应中的 `plan` 是语义计划，不是 HS2 物理执行计划。`lucy_explain_query` 只编译并解释权限与语义计划，不执行业务 SQL，也不冒充 HS2 EXPLAIN。

### 3.2 配置与身份

拟新增 `<projectRoot>/webui/config/hive-connections.yaml`，只存 Hive 连接及凭据引用，不写明文秘密，不写入 `ktx.yaml`。该路径在实施时纳入备份、恢复、迁移、脱敏和配置审计。

- Lucy 统一连接视图合并 KTX 与 Hive 配置，连接 ID 全局唯一；冲突失败关闭，不覆盖或按优先级隐藏。
- 写字段按认证矩阵开放：host、port、默认 database、允许的 databases、启用表范围、transport、HTTP path、auth、凭据引用与 TLS 信任材料引用。
- NONE 与 NOSASL 分开建模；TCP／HTTP、LDAP／Kerberos／TLS 以现场组合为准，不共用一个“免密”分支。
- 创建、编辑、删除复用单实例写入串行化与 generation 失效；管理台、MCP、连接池读取同一已提交快照。

### 3.3 语义资产与来源闭包

- Hive database 对应 Schema；物理对象为 `database.table`，规范源键包含连接与 Schema，跨 database 同名表不得合并。
- resolved-source 构建器读取同一已发布 generation，保留 grain、列覆盖、派生列、排除列、segments、joins、隐藏与可见性；不得只拼 `measures`。
- 重复名称、孤立 overlay、缺失 join 目标、未知引用或目录失败均显式报错，不返回旧快照成功状态。
- `sql:` source 的子查询／CTE、join 目标与编译后物理依赖都展开检查；CTE 名不得误作物表，未知依赖拒绝。
- `connection_list`、`lucy_catalog`、source 读取、搜索和权限预览合入 Hive；若复用 KTX 索引，须先证明未登记连接的索引与重建行为，否则由 Lucy 合并 ACL 过滤后的本地结果。

## 4. 工具、执行与安全合同

### 4.1 工具路由

| 工具／入口 | Hive 合同 |
|---|---|
| `connection_list`、`lucy_catalog` | 返回经授权的统一连接、Schema、表与指标 |
| `lucy_query`、获准的 `sl_query` 别名 | 同一 Lucy 准入后进入 Hive 编译／执行链 |
| `lucy_read_source` 与内部读取 | 相同 ACL 与行策略，受控投影和行数上限 |
| `lucy_explain_query` | 只编译解释，不触发 JDBC 业务执行 |
| 模板、内部工具、别名 | 与外部 HTTP 走同一数据源路由、预算与审计 |
| `sql_execution`、`ktx sql`、`ktx ingest`、联邦查询 | 显式不支持，不静默换路 |

### 4.2 编译与执行隔离

编译请求包含完整 `sources`、规范化 `query` 和字符串 `dialect: "hive"`；`predefined_measures_only` 由服务端策略决定，Agent 不得提供权威值。请求经 stdin，响应经 stdout，进程有时限、输出上限、错误脱敏和环境隔离；不联网安装依赖。

JDBC worker 只接收服务端批准的连接 ID、最终 SQL、deadline、取数上限和关联 ID。driver／JRE／Python／sqlglot 等依赖锁定并随证据记录；worker 首选容器内受管子进程与带长度／类型校验的本地 IPC，不新增对外监听端口，秘密不进 argv 或日志。

### 4.3 行策略与 SQL 安全

1. 先规范化请求、绑定来源并通过现有 shape gate，再从服务端裁决注入强制谓词。
2. 复用 Role 内 AND、Role 间 OR、Agent 个人行限制 AND 与强制字段保护；转换为计算接口支持的 `filters[]`，不假设存在 `forced_filters` 字段。
3. 引号、反斜杠、Unicode、NULL、布尔值、标识符与保留字必须经 AST 和真实结果验证。
4. 受保护 JOIN、fan-out、CTE 与聚合只有在每个受保护来源均被证明于聚合前约束时才开放。
5. 编译 SQL 必须严格 Hive 解析、单语句、只读、实际依赖匹配，并满足输出列、隐藏列、LIMIT、字节和截断合同。
6. 系统元数据操作走独立固定列表；JDBC `setReadOnly` 与只读账号只是纵深措施，不替代 AST 检查。

### 4.4 类型、预算、取消与审计

- decimal／bigint 保真输出，不经过 JavaScript number 丢精度；日期、时间戳、时区、跨年周与截断行为有明确结果合同。
- 现有问询预算不变；连接、编译、执行、取数共享剩余 deadline。LIMIT 不等于扫描成本限制，不为统计卡默认全表 COUNT。
- 连接池按连接 generation 与认证上下文隔离，复用前重置会话；旧 generation 池不得服务新配置。
- 断开、超时或预算终止后请求服务端取消并观察终态，再关闭 operation／session；杀本地进程不等于远端取消。未知终态记 `unknown/indeterminate`，不自动重发业务查询。
- 复用 canonical ledger 与先持久后释放；编译、数据库执行与 delivery 分开记录。无真实 JDBC operation/query ID 时说明缺失，不编造；HTTP 200 或编译成功不等于执行成功。

## 5. 核心流程（伪代码）

```text
handleHiveCall(identity, tool, untrustedArgs):
  received = persistReceivedUsingExistingLedger()
  if received failed: return AUDIT_UNAVAILABLE; no compile and no JDBC

  snapshot = loadCommittedConnectionAndPublishedSourceGeneration()
  request = normalizeAndValidateExistingToolContract(tool, untrustedArgs)
  stripClientForcedFieldsAndPolicyOverrides(request)
  decision = existingAuthorizeAndRewrite(identity, request, snapshot)
  if denied: persistDecisionAndFinishWithoutJDBC()

  deadline = existingBudgetAndConcurrencyAdmission(identity, request)
  if unavailable: persistBudgetOrConcurrencyOutcomeAndFinish()
  sources = resolveCompleteSourcesAndTransitiveDependencies(request, snapshot)
  assertEveryPhysicalDependencyAllowed(sources, decision, snapshot.enabledTables)

  compilerQuery = normalizeQueryAndInjectTrustedFilters(request, decision)
  compilerQuery.predefined_measures_only = deriveFromServerQueryPolicy(snapshot)
  compiled = callUnmodifiedKtxDaemon(sources, compilerQuery, dialect="hive", deadline)
  if rejected, crashed, malformed, too large or timed out:
    persistTypedFailure(); no JDBC and no raw-SQL fallback

  checked = strictHiveAstAndCapabilityCheck(compiled.sql, compiled.plan, decision)
  assertPoliciesApplyBeforeAggregationAndDependenciesMatch(checked)
  if explain: persistDiagnosticAndReturnWithoutDatabaseExecution()

  persistAdmittedDispatchUsingExistingLedger()  # failure → no JDBC
  operation = jdbcExecute(checked.sql, trustedConnection, deadline, limits)
  while fetching bounded batches:
    if cancel, disconnect or deadline:
      requestCancelAndObserveTerminalState(); break
  result = normalizeTypesAndTruncationWithoutPrecisionLoss()

  persistObservedExecutionAndResponsePrepared()
  if persistence failed: withhold payload; do not claim upstream never executed
  releaseResponseAccordingToExistingDeliveryContract()
  finally: closeOperationAndReleaseOrDiscardSession(); releaseConcurrencySlot()
```

失败顺序固定为：审计接收 → 配置／资产快照 → 请求与 ACL → 预算并发 → 来源闭包 → 编译 → AST／策略检查 → 准入账本 → JDBC → 类型与截断 → 响应准备账本 → 释放。任何安全前置失败不得通过后续“空结果”伪装成功。

## 6. 工作包与依赖

| 工作包 | 设计交付 | 前置与退出 |
|---|---|---|
| H25-01 环境与依赖 | HS2／协议／认证／TLS、JDBC／JRE／Python 物料、隔离环境 | 现场输入齐；参考与客户匹配组合分开 |
| H25-02 编译复用验证 | 原版进程调用、完整 sources、AST 与 SQL 样本 | H25-01；V01–V06 通过后才进入完整实现 |
| H25-03 JDBC／元数据 | worker、test/list/describe/execute/fetch/cancel/close | H25-01；只读账号与类型／取消行为明确 |
| H25-04 最小贯通 | 配置合并、资产解析、ACL 后编译执行、结果与审计 | H25-02／03；V07–V10 经真实 Proxy 完成 |
| H25-05 治理与异常 | 行策略、别名／内部入口、取消、故障与审计 | H25-04；V11–V15 通过，未认证形态拒绝 |
| H25-06 管理台与发现 | 表单、状态、Schema／表治理、搜索／读取／解释 | H25-04／05；统一 generation |
| H25-07 离线与升级 | amd64 物料、Secret／证书、备份恢复与旧连接回归 | H25-06；V16／V17 及适用既有交付门禁 |
| H25-08 支持矩阵收口 | 客户组合认证、手册、限制与证据目录 | 前述完成；仅指定证据组合可晋级 |

**所有工作包未开始。** 需求审查通过后仍需另行授权隔离验证与开发；本 Spec 不设未经验证的工期。

## 7. 验收矩阵

**V01–V17 全部未执行。** 结果只允许 `pass / fail / blocked_environment / not_run`；`blocked_environment` 与 `not_run` 均不得计为通过。默认不新增浏览器或移动窄屏测试，相关验证须另行批准。

| ID | 场景 | 通过标准 |
|---|---|---|
| V01 | 固定 runtime 的 semantic-validate／query | 无数据库配置和凭据仍返回结构化 SQL／plan；输入拒绝与进程失败可分 |
| V02 | Manifest＋overlay 完整来源 | grain、派生列、segment、join、隐藏列不丢；重复／孤立／未知引用失败 |
| V03 | 聚合、NULL、过滤、排序、limit | 独立 Hive AST、参考 HS2 EXPLAIN 与真实执行通过；结果等于独立 oracle |
| V04 | 时间分组、时区、标识符 | 日／月／周／季度／年与跨年周正确；编译成功但 EXPLAIN 失败判 fail |
| V05 | JOIN、fan-out、CTE、sql source | 来源闭包与列血缘正确、聚合不膨胀；不支持形态明确拒绝 |
| V06 | 非法输入、编译异常、超时、超大输出 | 无 JDBC 分派；不回退 Postgres、不返回未校验 SQL |
| V07 | 新建→测试→采集→发布→发现 | 页面／API／MCP 同连接、表和 generation；KTX 配置无 Hive 污染 |
| V08 | 带 Token 的 Proxy 语义查询 | 固定数据结果正确；最终 SQL、物理表、快照与 JDBC 执行可关联 |
| V09 | 明细、读取、explain、模板／内部调用 | 同一路由与 ACL；explain 不执行；内部入口不绕过预算审计 |
| V10 | 跨 database 同名表与配置变更 | 不串库；新 generation 生效、旧池失效；删除后拒绝且原连接不受影响 |
| V11 | 越权、隐藏列、未启用表、伪造强制字段 | ExecuteStatement 前拒绝并记录原因；不以空结果代替拒绝 |
| V12 | 租户、角色组合、个人限制、转义、聚合 JOIN | 与 FinalRows 和独立 oracle 一致；不只靠 SQL 包含字符串判策略有效 |
| V13 | 多语句、写入与 JDBC 参数注入 | driver 执行前拒绝；固定元数据操作可用；只读账号不构成唯一证明 |
| V14 | 慢查询、断开、超时、取消失败、worker 崩溃 | operation 终态可核对；未知记 unknown；无盲重试与资源泄漏 |
| V15 | 接收／准入／响应准备账本失败 | 不准入则无分派；响应准备失败不释放；execution 与 delivery 分离 |
| V16 | 客户认证／HTTP／TLS／离线与 amd64 | 不联网拉依赖；秘密不泄漏；目标组合通过、失败或 blocked 如实记录 |
| V17 | 升级、备份恢复与既有数据库回归 | 无 Hive→KTX 污染；原角色／Token／历史审计不改写；恢复原路径可用 |

### 7.1 固定数据与独立基准

未来验证使用独立 setup 身份写入固定合成数据，Lucy 账号只读。至少覆盖租户 A／B、精确 decimal、NULL、日期、分区、另一 database 同名表、customer 维表与 order_items 一对多表。上游方案的固定预期保留：A 的 sum=30.50、COUNT(*)=3、COUNT(amount)=2；B 的 sum=100.00；全量 sum=130.50。独立 JDBC／Beeline 手写 SQL 交叉核对，禁止用被测编译器生成 oracle。

## 8. 证据与支持状态

每次验证记录 run ID、用例、时间、入口、Lucy commit＋镜像 digest、KTX tar／wheel 摘要、完整 Python／JRE／JDBC 依赖、HS2 与 transport／auth／TLS 组合，以及配置／资产／权限快照摘要。查询证据含脱敏编译输入、最终 SQL／摘要、plan、独立 oracle、类型／行数／截断、operation 观测与账本 ID。

过程材料可落 `inbox/hive-direct/<runId>/`；正式证据须移入受控保留位置，不只链接可删除的 inbox。不得导出密码、keytab、票据、完整 Token 或原始客户业务行。

数据库支持矩阵中 Hive 当前保持 **`planned`**。只有指定组合的实现与证据齐全后，才能按矩阵规则另行申请状态变更；本 Spec 与文档 lint 都不是支持证据。

## 9. Design System Compliance

未来连接界面沿用既有 Drawer、表单、连接卡、状态与错误模式，不新增视觉原语。认证／TLS 字段按所选组合渐进披露；秘密只写引用且不可回显；连接、Schema、数据库对象、文件路径和专业英文均加翻译防御。状态与失败不只靠颜色表达，桌面最小宽度下沿用既有布局；默认不做移动窄屏适配。

## 10. 需求审查边界

审查需确认：直连边界、原版 KTX 复用、完整来源闭包、聚合前行策略、严格 AST、取消与审计、停止条件、非门禁验收和支持状态。审查通过不自动授权 H25-01–08、真实环境连接、依赖安装、镜像构建、部署、发布或客户支持声明。
