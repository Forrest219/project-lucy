# Lucy v2.5 Hive 直连实施方案

| 元数据 | 内容 |
|---|---|
| 版本 / 日期 | v0.1-draft / 2026-10-20，Asia/Shanghai |
| target_release / 规划编号 | v2.5 / L25-10 |
| 状态 | **方案待评审，未授权开发；所有动态验证均未执行** |
| 本次交付 | 接入设计、语义编译复用核查、分阶段任务及贯通验证合同 |
| 实施边界 | 只修改 Lucy；不修改、复制、打补丁或 monkey-patch KTX 源码、npm dist、Python wheel；不 fork KTX |
| 基线 | Lucy 当前 Dockerfile 固定 `@kaelio/ktx@0.16.0`；依赖核查身份见 §2 |
| 部署 | 单实例、单副本；开发 Mac arm64；客户 linux/amd64 Kubernetes，离线交付 |
| 当前授权 | 仅编写和登记方案；不新增运行代码、测试脚本、驱动依赖、镜像或真实连接配置，不启动验证环境 |
| 关联 | [v2.5 建议书 L25-10](2026-10-18-lucy-2.5-upgrade-proposal.md#24-hive-直连l25-10)；L25-09 审计增量和 SelectDB Hive Catalog 核查为独立文档，不属于本方案交付物 |

## 1. 目标、范围与设计决定

目标是让外部 Agent 经 Lucy MCP Proxy，对 Hive 数据使用现有的连接治理、语义指标、权限和审计。直连终点为 **HiveServer2（HS2）**，不是 Hive Metastore，也不经 Doris、SelectDB 或 Trino。HS2 接受查询并提供结果；JDBC 是官方推荐的客户端方式。[Apache Hive HS2 概述](https://hive.apache.org/docs/latest/user/hiveserver2-overview/)

本方案选择 **Lucy 自有 Hive 适配器 + 原封不动的 KTX Python 语义计算接口 + Hive JDBC 执行器**。不将 Hive 冒充 MySQL/Postgres，也不假定 KTX 的 `sl_query`、`ktx sql` 或 `ktx ingest` 因 JDBC 接通就支持 Hive。

首期包含：连接测试，数据库/表/列/注释/分区元数据，Manifest 与 overlay，单 Hive 连接内的语义查询、读取、解释，以及受治理的 MCP 贯通。支持矩阵必须绑定实际 HS2 版本、发行版、认证、传输模式和依赖身份；环境尚未指定，不能提前承诺整个 Hive 版本系列。

首期不包含跨连接联邦查询、任意 JDBC 驱动上传、Agent 自定义 JDBC URL/会话参数、DML/DDL、自动修改 Hive 服务端配置或 Hadoop 集群。复杂类型首期保留原始类型并默认不开放结构内部表达式；需要时由受审阅的 Hive 视图投影为可治理的标量。没有证明的能力应明确拒绝，不静默降级为原始 SQL。

## 2. 语义编译能否复用：核查结论

**结论：接口层具备复用条件，Hive 查询正确性尚未证明。** 已静态确认打包接口可以绕开 KTX 的数据库驱动注册，以显式 `dialect: "hive"` 编译内存中的语义定义。不能据此宣称已经完成 Hive 支持，也不能保证任意 Hive SQL 均兼容。

### 2.1 核查材料身份

核查的是已下载的发布包，不以本机较旧的 KTX clone 或 GitHub main 替代 0.16.0：

| 材料 | SHA-256 |
|---|---|
| `@kaelio/ktx@0.16.0` npm tarball | `18bdbb165b90ee8c9e9d4d843e26d22451168db10353481b079fd8c01886dea3` |
| 随包 `assets/python/kaelio_ktx-0.16.0-py3-none-any.whl` | `60c7240bd7b66ec27f9d95b47315d6e41bc1fd2da2660b381800553a8eea7a9d` |

临时材料位于分析工作区 `inbox/20261020-hive-investigation/`，不是客户交付资产。实施时重新取得同版本发布包并核对摘要。wheel 只声明 `sqlglot>=26` 等范围，**wheel 版本相同不等于 Python 依赖相同**；贯通证据还必须固定实际 Python、sqlglot、pydantic 等完整依赖版本和锁定物料。

### 2.2 已静态确认的接口与限制

下表路径相对于 npm 包或其随包 wheel；符号均已读取，未执行编译：

| 证据位置 | 确认事实 | 对本设计的影响 |
|---|---|---|
| `dist/context/project/driver-schemas.js`、`dist/context/connections/drivers.js` | 没有 Hive 注册 | 不把 `driver: hive` 写入交给 KTX 加载的配置 |
| `dist/context/connections/dialects.js`、`dist/context/sl/local-query.js::compileLocalSlQuery` | KTX 本地查询先做可查询驱动检查 | `ktx sl query --execute=false` 也不是可直接复用的 Hive 入口 |
| `dist/context/sql-analysis/dialect.js::sqlAnalysisDialectForDriver` | Hive 未映射，未知值回退 Postgres | Lucy 显式指定 Hive，禁止沿用这个默认回退 |
| `ktx_daemon/__main__.py::build_parser/main` | `ktx-daemon semantic-query` 从 stdin 读 JSON，stdout 返回 JSON；`semantic-validate` 可单独校验 | 首选复用此已打包的进程接口，不导入 npm 私有子路径 |
| `ktx_daemon/semantic_layer.py::SemanticLayerQueryRequest/query_semantic_layer` | 请求为 `sources`、`query`、字符串 `dialect`；直接调用 `SemanticEngine.from_sources`；响应为 `sql/dialect/columns/plan` | 编译不需要连接 ID、数据库凭据或已注册的仓库驱动 |
| `ktx_daemon/app.py::create_app` | 有 `/semantic-layer/query`、`/semantic-layer/validate` 和 `/sql/validate-read-only` | 证明计算与数据库执行分离；本期不为 Hive 额外暴露 HTTP 计算服务 |
| `semantic_layer/generator.py::SqlGenerator.__init__` | 用 `sqlglot.Dialect.get_or_raise` 校验目标方言 | Hive 的实际可用性取决于锁定的 sqlglot 版本 |
| 同文件 `_transpile`、`_time_trunc` | `_transpile` 在异常时返回原 SQL；时间分组仅对部分方言特判，其他使用 `DATE_TRUNC` 形态 | 返回成功/`dialect=hive` 不足以证明 SQL 可执行；时间分组是必测项 |
| `semantic_layer/models.py::SourceDefinition/SemanticQuery` | sources 需要完整解析后的定义；query 有 `predefined_measures_only`，没有 `forced_filters` 字段 | 必须先合并 Manifest/overlay；不能把行策略载荷直接塞给计算接口并假定会生效 |
| Lucy `webui/server/proxy/row-policy.ts::applyLucyQueryForcedFilters` | 当前已将服务端强制谓词转换并前置到 `filters[]` | 复用现有权限语义，额外证明 Hive 下的绑定、转义和聚合前执行 |

SQLGlot 提供 Hive 方言实现，但这是方言能力的依据，不是 KTX 已验证 Hive 的依据。[SQLGlot Hive 方言](https://sqlglot.com/sqlglot/dialects/hive.html)

### 2.3 复用方式与停止条件

Lucy 从镜像内预装、校验过的 Python runtime 取得 `ktx-daemon` 可执行文件，用参数数组启动 `semantic-query`，请求经 stdin 传入，不放命令行。进程调用须有时限、输出字节上限、错误脱敏和环境隔离；不自动联网安装运行时。优先沿用现有离线 runtime 物料，不另维护第二套 KTX。

示意合同，**不是已经新增的命令或已执行记录**：

```json
{
  "dialect": "hive",
  "sources": ["由 Lucy 在服务端解析、筛选并校验后的 SourceDefinition 对象"],
  "query": {
    "measures": ["orders.revenue"],
    "dimensions": [{"field": "orders.region"}],
    "filters": ["orders.tenant_id = 'A'"],
    "limit": 100,
    "predefined_measures_only": true
  }
}
```

上例 `sources` 是说明占位，真实请求必须为对象；强制谓词和 `predefined_measures_only` 来自 Lucy，不允许 Agent 提供权威值。编译响应的 `plan` 是语义计划，不是 HS2 物理执行计划。

以下任一条件成立即停止该能力的交付：计算入口在锁定镜像不可用；来源合并不一致；生成 SQL 无法被 Hive 正确执行；策略在聚合之后才生效；需要修改 KTX 才能保证正确。可在 **Lucy** 增加有明确覆盖范围、严格失败的 AST 方言适配，并重新执行全部受影响用例；禁止正则改 SQL、按字符串替换函数、盲目二次转译或复制 KTX 生成器。无法收敛时回到设计评审，相关能力标记不支持，不以换成 MySQL 驱动绕过。

## 3. 运行架构与配置归属

```text
外部 Agent
  → Lucy MCP Proxy：身份、ACL、行策略、预算、审计准入
  → Lucy 数据源路由（按服务端连接类型）
      ├─ 现有 KTX 连接 → 原有 KTX MCP 链路
      └─ Hive → Lucy 语义资产快照与来源解析
                → 原版 ktx-daemon semantic-query（dialect=hive，只编译）
                → Lucy Hive AST/物理表/策略/行数检查
                → Lucy JDBC worker → HiveServer2
  → Lucy 统一结果封装、审计持久化、释放响应
```

### 3.1 Hive 配置由 Lucy 持有

拟新增 `<projectRoot>/webui/config/hive-connections.yaml`，只存 Hive 连接和凭据引用；不写入 `ktx.yaml`，不在其中放伪装的 Postgres/MySQL 占位连接。该路径为拟议，实施前纳入现有备份、恢复、迁移、脱敏和配置审计范围。

Lucy 对外的连接视图合并 KTX 配置与 Hive 配置，连接 ID 全局唯一；冲突必须拒绝，不覆盖或按优先级隐藏。创建、编辑、删除复用现有单进程写入串行化和配置 generation 失效机制；管理台与 MCP 同读已提交配置，新建连接无需靠旧 KTX 常驻进程识别。

Hive 字段包括 host、port、默认 database、允许的 databases、启用表范围、transport、HTTP path、auth 类型及相应凭据引用、TLS 信任材料引用。按选定的支持矩阵开放字段；不强制所有认证方式都有密码。NONE 与 NOSASL 必须区分，不能共用“免密”分支。TCP/HTTP、LDAP/Kerberos/TLS 的适配以官方配置和现场模式为准。[HS2 配置](https://hive.apache.org/docs/latest/admin/setting-up-hiveserver2/)

### 3.2 语义资产及发现链路

沿用内容根目录下 `semantic-layer/<connectionId>/_schema/<database>.yaml` 与 overlay 文件；Hive database 在现有界面中对应 Schema。物理对象使用 `database.table`；不同数据库同名表必须生成可区分的 source key，并保留物理对象映射，不凭裸表名路由。

Lucy 新增小范围的 resolved-source 构建器：从同一已发布 generation 读取 Manifest/overlay，遵循现有字段合同，输出完整 SourceDefinition；不得只拼装 `measures` 而丢掉 grain、派生列、列覆盖、排除列、segments、joins 或可见性。读取与编译使用同一快照，解析失败不得返回旧版本的成功状态。

KTX 没有导出可供 Lucy 直接使用的 npm source resolver；本方案不使用绝对路径深导入。构建器要对照打包模型及现有加载行为做契约测试，重复名称、孤立 overlay、缺失 join 目标等均显式报错。Python 文件 loader 与 npm loader 的细节并非完全相同，必须选定并记录与现行 Lucy 资产一致的合并合同，不随调用入口切换。

`lucy_catalog`、连接列表、source 读取、指标发现和权限预览都要合入 Hive 数据；不得只让手填 `connectionId` 的查询能运行。首期 Hive source 的精确发现从 Lucy 已发布资产提供，不以“先把 Hive 登记进 KTX”作为前提。现有全局语义搜索涉及 Hive 时，在 Lucy 层合并 ACL 过滤后的本地结果；若复用 KTX 索引，须先证明未登记连接的索引、检索和重建行为，否则不依赖它。Wiki 仍走原路径。

## 4. Lucy 模块改动范围（拟议）

| 工作面 | 现有落点 / 拟新增模块 | 要交付的行为 |
|---|---|---|
| 连接模型与配置 | `webui/server/project.ts`、`model.ts`、`index.ts`、前端 `lib/types.ts`、`lib/connectionId.ts`、`CreateConnectionDrawer.tsx`；拟新增 Hive 配置模块 | 创建/编辑/测试/删除、跨配置 ID 冲突、凭据只引用、能力矩阵和 generation |
| 元数据 | `webui/server/live-catalog.ts`、`schema-structure.ts`；拟新增 `connectors/hive/` | 经 JDBC metadata 或受控 SHOW/DESCRIBE 列数据库/表/列/分区；不复用 MySQL information_schema 查询 |
| 资产与语义 | 现有发布/校验/内容路径模块；拟新增 Hive source resolver、compiler bridge | Manifest/overlay 合并、只编译调用、Hive AST 检查、可见性、类型和来源闭包 |
| 查询路由 | `webui/server/ktx.ts`、`proxy/mcp-proxy.ts` | Hive 不再转发给 KTX 的数据库执行器；现有 KTX 数据源行为保留 |
| 权限与审计 | `proxy/acl.ts`、`row-policy.ts`、`query-guardrails.ts`、现有账本/结果封装模块 | 统一准入、策略合取、预算、并发、持久化屏障、错误和查询证据 |
| JDBC worker | 拟新增 Lucy 自有 Java worker 及 Node bridge | 受控请求协议、连接池隔离、取数、取消、资源释放和进程健康 |
| 交付 | `Dockerfile`、runtime/healthcheck、Helm、升级与离线物料检查 | 固定 JRE/JDBC/runtime，Secret 引用，amd64 校验与恢复 |
| 验证与文档 | 拟新增 Hive 契约测试/合成夹具/MCP 验证入口、连接手册 | §7 验证矩阵及可复核证据；不把本次方案当作已新增测试 |

所有路径仅界定后续工作，不表示本次新增了这些模块。具体接口和错误码在实施 Spec 中冻结。

### 4.1 MCP 工具路由合同

| 工具 | Hive 处理 |
|---|---|
| `connection_list`、`lucy_catalog` | 从 Lucy 统一视图返回经过授权的连接、Schema、表和指标 |
| `lucy_query`、被允许的 `sl_query` 别名 | 同一 Lucy 准入后进入 Hive 语义编译/执行链路 |
| `lucy_read_source` / 对应内部读取 | 相同权限和行策略，受控投影、行数限制；不以任意 SQL 替代 |
| `lucy_explain_query` | 只编译并解释权限和语义计划；不触发业务执行，不冒充 HS2 EXPLAIN |
| source/entity 详情、搜索和发布校验 | Lucy 读取同一 Hive 资产快照；不得转发后得到 KTX“连接不存在” |
| `sql_execution`、`ktx sql`、`ktx ingest`、联邦查询 | 首期不作为 Hive 入口；显式不支持。原数据源继续原有合同 |

Agent 可发现的工具、模板/认证路径、内部工具调用和别名都要经过同一数据源路由；不能只拦截外部 HTTP 的 `lucy_query` 一处。

## 5. 执行、安全与运行约束

1. **只编译和执行分离**：编译进程无 Hive 凭据，不能连接数据库；JDBC worker 只接收服务端批准的连接 ID、最终 SQL、deadline、取数上限和关联 ID，不接受 Agent 指定 JDBC URL、JAR 或会话初始化语句。
2. **来源闭包**：模型来源与编译后物理表依赖都要处于本次有效授权和启用表范围内。`sql:` source 的子查询/CTE、join 目标也需展开检查；不能把整个连接的未授权定义交给编译器后仅检查顶层 source。未知依赖拒绝，CTE 名不能误作物理表。
3. **强制行策略**：沿用 Lucy 现有多角色 OR/单角色 AND、用户条件合取和强制字段保护语义。先做请求规格化、来源绑定和现有 shape gate，再从服务端决策注入强制谓词，转成计算接口支持的 `filters[]`；不依赖未知的 `forced_filters` 字段。Hive 字符串转义、反斜杠、引号、Unicode、NULL 与布尔值须经 AST 和实库结果验证。受保护 JOIN、fan-out、聚合只有证明每个受保护来源在聚合前被正确约束才可开放；无法证明就拒绝该组合，不删除策略放行。
4. **SQL 校验**：显式 Hive 方言、严格解析、单语句、只读 AST、实际依赖、输出列/隐藏列、limit 与字节上限。禁止 INSERT/CTAS/EXPORT/LOAD/ADD JAR/SET/USE 等 Agent 数据操作；系统元数据语句使用独立的固定操作列表。只读账号为纵深约束，JDBC `setReadOnly` 不能单独作为只读证明。
5. **能力边界**：基础聚合、segments、排序分页、标量派生列、时间分组和关联分别认证。复杂类型/未知函数不得静默转换成“已支持”。时间/月周季度、时区、decimal 精度、bigint 超安全整数都要定义输出；decimal/bigint 保真输出，不能经 JavaScript number 悄悄丢精度。
6. **资源和预算**：现有问询预算（20 次数据工具或 120 秒，先到先停）不变。连接/编译/执行/取数合计受剩余 deadline 约束；行数 LIMIT 不等于扫描成本限制。优先用已登记分区和有界日期过滤，禁止为统计卡默认全表 COUNT。worker 的池按连接配置 generation 与认证上下文隔离，复用前重置会话状态。
7. **取消与不确定性**：客户端断开、预算终止或超时后尝试服务端取消并取得终态证据，随后关闭 operation/session；杀掉本地进程不等于远端已取消。取消未确认记 unknown/indeterminate 并按既有审计/告警合同处理，不回报已取消，不自动重发业务查询。
8. **审计一致性**：复用 canonical ledger 和先持久后释放；映射 `request/call/attempt` 与 JDBC operation/query ID（若驱动可取得），编译和数据库执行作为可区分的内部/上游操作。适用字段缺失带原因，不造 Hive query ID，不因 HTTP 200 或编译成功写执行成功。遵循 L25-09 冻结合同，不修改历史审计记录。

JDBC worker 首选容器内受管子进程与带长度/类型校验的本地 IPC；凭据不进 argv 或日志，不新增对外监听端口。driver/JRE 最终版本、认证实现和依赖集合由 H25-01 环境核查确定并锁定，升级后重新认证；不开放任意驱动插件系统。

## 核心流程（伪代码）

```text
handleHiveCall(identity, tool, untrustedArgs):
  received = persistReceivedUsingExistingLedger()
  if received failed: return existing AUDIT_UNAVAILABLE; do not compile or dispatch
  snapshot = loadCommittedConnectionAndPublishedSourceGeneration()
  request = normalizeAndValidateExistingToolContract(tool, untrustedArgs)
  stripClientForcedFieldsAndPolicyOverrides(request)
  decision = existingAuthorizeAndRewrite(identity, request, snapshot)
  if denied: persistDecisionAndFinishWithoutJDBC()
  deadline = existingBudgetAndConcurrencyAdmission(identity, request)
  if unavailable: persistBudgetOrConcurrencyOutcomeAndFinish()
  sources = resolveSourcesAndTransitiveDependencies(request, snapshot)
  assertEveryPhysicalDependencyAllowed(sources, decision, snapshot.enabledTables)
  if explain: compileAndCheckWithoutDatabaseExecution(); persistAndReturnDiagnostic()
  compilerQuery = normalizeQueryAndInjectTrustedFilters(request, decision)
  compilerQuery.predefined_measures_only = deriveFromServerQueryPolicy(snapshot)
  result = callUnmodifiedKtxDaemon(sources, compilerQuery, dialect="hive", deadline)
  if rejected, crash, invalid output, or deadline expired:
    persistTypedFailure(); do not dispatch; do not switch to raw SQL
  checked = strictHiveAstAndCapabilityCheck(result.sql, result.plan, decision)
  assertPoliciesApplyBeforeAggregationAndPhysicalDependenciesMatch(checked)
  persistAdmittedDispatchUsingExistingLedger()  // fail → no JDBC dispatch
  operation = jdbcExecute(checked.sql, trustedConnection, deadline, limits)
  while fetching bounded batches:
    if cancel/disconnect/deadline: requestCancelAndObserveTerminalState(); break
  normalizeTypesAndTruncationWithoutPrecisionLoss()
  persistObservedExecutionAndResponsePrepared()
  if persistence failed: withhold payload; do not claim upstream never executed
  releaseResponseAccordingToExistingDeliveryContract()
  finally: closeOperationAndReleaseOrDiscardSession(); releaseConcurrencySlot()
```

这是后续实现顺序的规范草案，受现有 ACL、预算和审计合同约束，不创建竞争性账本。生产分支不得执行 fixture DDL；合成环境的种数由验证人员另用 setup 身份完成。

## 6. 分阶段任务及依赖

| 工作包 | 内容 / 交付物 | 前置与完成条件 |
|---|---|---|
| H25-01 环境与依赖 | HS2 版本/发行版/协议/认证/TLS、JDBC/JRE/Python 物料、隔离环境和数据合同 | 取得现场信息，选定一套参考环境和客户匹配环境；不能以参考环境代替客户匹配认证 |
| H25-02 编译复用验证 | 未改 KTX 的进程调用、完整 sources 请求、校验器、基础与边界 SQL 样本 | H25-01；V01–V06 通过才继续完整产品实现；失败先评审 Lucy AST 适配可行性 |
| H25-03 JDBC/元数据 | 受管 worker、test/list/describe/execute/fetch/cancel/close，Manifest 生成 | H25-01；独立只读账号，确定结果类型、取消及认证行为 |
| H25-04 最小贯通 | Lucy 配置合并、资产解析、ACL 后编译和执行路由、统一结果和审计 | H25-02/03；V07–V10 经真实 Proxy 完成，不以内部编译调用替代 |
| H25-05 治理与异常 | 角色组合、行策略、别名/内部入口、错误状态、取消与故障注入 | H25-04；V11–V15 通过；未认证的受保护查询形态拒绝 |
| H25-06 管理台与发现 | 表单、状态、Schema/表治理、搜索/读取/解释、发布/重载/删除 | H25-04/05；前后端与 MCP 使用一致 generation，不依赖 KTX 认识 Hive |
| H25-07 离线与升级 | amd64 镜像、JRE/JAR/原生库架构、Secret/证书挂载、备份恢复和旧连接回归 | H25-06；V16/V17 与现有适用交付门禁完成 |
| H25-08 支持矩阵收口 | 客户匹配认证、运维手册、能力/限制、证据目录和验收签收 | 前述完成；才能将指定组合标为支持 |

上述工作包均为**未开始**。先批准方案，再授权 H25-01/02/03 的隔离验证；验证通过后再启动 H25-04 及后续开发。本方案不设置未经验证的工期，不自动升级/冻结其他 v2.5 Spec，也不改变当前发布门禁。

## 7. 贯通验证设计

### 7.1 环境、数据和独立基准

只在新建隔离实例操作。准备参考 HS2 和客户匹配 HS2；没有客户信息时对应认证记 `blocked_environment`，不能以跳过计为通过。测试使用独立 setup 身份种数，Lucy 只读账号不能拥有 DDL/DML 权限；另准备全量、限定租户 A、限定租户 B、跨数据库拒绝及多角色测试身份。

固定合成表（精确 decimal、日期和分区，不用随机种数）：

| orders 行 | tenant_id | order_id / customer_id | order_date | amount |
|---|---|---|---|---|
| 1 | A | 1 / 101 | 2026-01-01 | 10.00 |
| 2 | A | 2 / 102 | 2026-01-02 | 20.50 |
| 3 | A | 3 / 101 | 2026-02-01 | NULL |
| 4 | B | 4 / 201 | 2026-01-03 | 100.00 |

增加 customer 维表（101/102/201 各唯一）、order_items 一对多表（order 1 两项，2 和 4 各一项）和另一 database 的同名 orders。预期值由固定数据人工计算，并由独立 JDBC/Beeline 手写基准 SQL交叉核对，禁止用被测编译器产生 oracle：A 的 sum=30.50、COUNT(*)=3、COUNT(amount)=2；B 的 sum=100.00；全量 sum=130.50；A 按月为 2026-01=30.50、2026-02=NULL（除非资产显式定义 COALESCE）。一对多 JOIN 后收入不得因重复行变成 40.50；无度量的基表明细和空交集另给固定预期。

### 7.2 验证矩阵

**全部状态：未执行。** V01–V06 是编译复用与方言认证，V07 起才证明产品贯通。验证结果使用 `pass / fail / blocked_environment / not_run`；结果与产品的 `unsupported` 能力声明分开，不把未执行等同不支持。

| ID | 场景与操作 | 必须断言 |
|---|---|---|
| V01 | 固定 wheel/runtime，调用 semantic-validate/query；传完整 sources 与 `dialect=hive` | 无数据库连接配置和凭据仍能返回结构化 SQL/plan；模型字段可解释，输入拒绝与进程失败分开 |
| V02 | 从采集 Manifest + overlay 得到 sources；列覆盖、派生列、grain、segment、join、隐藏列 | 合并字段不丢失；重复/孤立/未知引用失败；与现行资产合同的 golden 样本一致 |
| V03 | sum/count/distinct/NULL、过滤、排序、limit、预定义指标限制 | 生成 SQL 通过独立 Hive AST 检查、参考 HS2 EXPLAIN 和真实执行，结果等于固定 oracle；非预定义 expr 被正确拒绝 |
| V04 | 日/月/周/季度/年、跨年周、日期/时间戳、时区、标识符/保留字 | 真实 Hive 结果正确；特别覆盖 `_time_trunc`；编译成功但 EXPLAIN 失败应判 fail |
| V05 | many-to-one、一对多 fan-out、多个 measure/CTE、受审阅的 sql source | 依赖闭包正确、聚合不膨胀、列来源匹配；无法支持的形态明确登记并拒绝 |
| V06 | 无效方言/SQL/函数、编译异常、超时、非 JSON/超大输出 | 无 JDBC 分派；不回退 Postgres、不返回原始未校验 SQL；依赖身份可复核 |
| V07 | 管理 API 新建 Hive 连接→测试→列 Schema/表→采集→发布→MCP catalog 发现 | 页面/API/MCP 同一连接、表和 generation；KTX 配置未加入 Hive，原连接可用 |
| V08 | 外部客户端经带 Token 的 Lucy Proxy，以 `orders.revenue` 发起语义查询 | 返回 130.50/对应租户值；关联到最终 SQL、物理表、配置/资产/权限快照及实际 JDBC 执行记录 |
| V09 | 单表明细、预定义指标发现、source 读取、只编译 explain、模板/内部调用 | 同一路由和 ACL；explain 不执行数据查询；内部调用不绕过预算和审计 |
| V10 | 同名表在两个 database，配置创建/更新/删除/重载、资产发布后查询 | 不串库；新 generation 生效；旧池失效；删除后拒绝且原连接不受影响 |
| V11 | 无连接权限/无表权限、隐藏列、未启用表、sql source 藏入越权表、客户端伪造 forced 字段 | 在业务 ExecuteStatement 前拒绝；记录 denied 及原因；不以“结果为空”代替拒绝证明 |
| V12 | 租户 A/B、角色 OR、角色内 AND、用户条件冲突、引号/反斜杠/Unicode、聚合与 JOIN | 与既有 FinalRows 契约及独立 oracle 一致；A=30.50/B=100.00；不能仅凭 SQL 含某段字符串判策略有效 |
| V13 | 只读绕过/多语句、CTAS/EXPORT/LOAD/SET/ADD JAR、客户端 JDBC URL/初始化参数注入 | 进入 driver 执行前拒绝；系统元数据固定操作仍可用；只读账号也拒绝写入 |
| V14 | 慢查询、预算到期、客户端断开、fetch 截断、取消失败、worker 崩溃 | HS2 operation 终态可核对；取消不明记 unknown/indeterminate；无盲目重试，无池/operation 泄漏；后续正常请求可恢复 |
| V15 | 接收/准入/响应准备账本失败、查询完成但响应丢失 | 不准入则无分派；响应准备失败不释放数据；execution 与 delivery 分离，符合 L25-09 |
| V16 | 客户匹配认证/HTTP/TLS/Kerberos（按实际组合）、离线启动与 amd64 镜像 | 不联网拉依赖；证书拒绝/凭据过期可解释；无秘密泄漏；目标组合明确通过或不支持 |
| V17 | 旧版本升级、配置及资产备份恢复、MySQL/Postgres/Doris 现有路径 | 无 Hive→KTX 未知驱动污染；原角色/Token/历史审计不改写；恢复后能力/配置一致 |

HS2 EXPLAIN 仅在受控验证阶段由测试操作者执行；产品的 `lucy_explain_query` 不因此变成执行 SQL 的通道。V08 的结果断言通过固定语义调用完成，真实 Agent 的自然语言问数旅程作为其附加验收，不用模型文字自述代替数据/审计证据。默认不新增浏览器测试或移动窄屏测试。

### 7.3 最小贯通顺序与停止规则

1. 固定依赖、环境和 oracle → V01/V02，证明不改 KTX 能得到可靠 sources 和 Hive SQL。
2. V03–V06，在真实 HS2 验证 SQL；基础指标也不通时停止，不能先做完 UI 再补执行。
3. V07/V08，完成“配置→采集→资产发布→发现→带 Token 的 Proxy→编译→JDBC→审计→返回”的最小纵向链路。
4. V09–V15，补治理、关联聚合及失败分支；任何安全断言失败不得开放相应能力。
5. V16/V17，认证客户组合及实际离线交付/升级路径；证据充分后登记支持矩阵。

“内部 CLI 编译成功”“JDBC SELECT 1 成功”“KTX 索引读到 YAML”各只证明局部。完整支持至少需要对应组合的编译、执行、权限、审计和交付证据，不把任一局部结果写成贯通通过。

### 7.4 证据合同

未来每次验证保留 run ID、用例 ID、开始结束时间、实际命令/入口、Lucy commit+镜像 digest、KTX tar/wheel 摘要、Python/依赖锁、JRE/JDBC/HS2 版本、transport/auth/TLS 组合，以及 fixture/配置/资产/权限快照摘要。查询证据包括脱敏的编译输入、最终执行 SQL/摘要、plan、oracle、结果类型/行数/截断、operation 观测、Proxy 账本 ID、预期与实际比较。

开发过程材料放 `inbox/hive-direct/<runId>/`（拟议），被用于评审或交付的证据须按现有证据保留/封存规则移入正式保留位置或受控附件，不能仅链接可删除的 inbox。敏感配置只记录引用/摘要和脱敏元数据，不导出密码、keytab、票据、原始客户业务行。当前没有创建此目录或任何“通过”报告。

## 8. 评审前需补齐的信息与风险

| 项目 | 当前状态 / 后续处理 |
|---|---|
| 客户 HS2 版本、发行版、地址、认证、传输模式、TLS/Knox/ZooKeeper 情况 | 未提供；H25-01 收集，不能从 SelectDB Hive Catalog 截图推断 |
| 语义编译 | 静态接口可复用；V01–V06 未执行；时间分组、嵌入表达式与 fan-out 为优先风险 |
| 资产合并合同 | 输入必须 resolved sources；需比较现行 Lucy 资产与 npm/Python loader 差异，不能把合并遗漏当方言问题 |
| 行策略 | Python query 无 forced_filters 字段；必须沿用 Lucy 注入并验证实际 SQL/结果；受保护 JOIN 未证明即拒绝 |
| SQLGlot/JDBC/JRE/运行时锁定 | 尚未选定实际部署依赖集合；0.16.0 版本号不足以复现 |
| 取消能力 | 驱动提供的 operation/query 身份和 HS2 状态可观测性需实测；关闭 socket 不构成取消证明 |
| 交付与现有版本关系 | L25-10 为独立 v2.5 能力增量，沿用 L25-09 审计合同；不重开其冻结裁决，不扩大现有问询预算 |

本方案可在上述现场信息未齐时完成设计评审；是否启动隔离验证、各客户组合的支持范围和正式开发授权，均在后续明确安排。本次不连接客户环境、不读取真实密钥、不启动开发。

## Terminology Compliance

本方案遵守 [全系统术语标准](../../webui/docs/00-product-terminology-standard.md)。沿用“连接”“Schema”“Manifest”“启用表范围”“连通测试”等主术语。

New terms:
- HiveServer2（HS2）：Hive 的查询服务端；不得与 Hive Metastore 混称“连接 Hive 元数据就能问数”。
- Hive 直连：Lucy 通过 Hive JDBC 连接 HS2；不得将 Doris 外部 Hive Catalog 标为此能力。
- Hive database 在现有 Schema 治理层表示，不新增含混的 Catalog 层级；分区字段为物理元数据，不作权限凭据。

Design System Compliance：未来连接界面沿用既有 Drawer、表单、连接卡和状态模式，实施前对照 `webui/docs/design-system/` 对应规范；本方案不新增视觉模式。英文术语和数据库对象 DOM 节点按标准配置 `translate="no"` 与 `notranslate`。

## 9. 本次完成记录

- 已完成：发布包/wheel 静态核查；方案编写；v2.5 L25-10 登记与项目索引。
- 未完成且未执行：编译调用、JDBC 连接、HS2 EXPLAIN/查询、POC、代码/测试/镜像/部署变更及客户验证。
- 方案状态为 draft；登记 v2.5 不等于冻结设计、授权实现或承诺已支持 Hive。
