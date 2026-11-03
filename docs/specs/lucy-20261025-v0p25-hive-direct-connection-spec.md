# Lucy v0.25 Hive 直连 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.2-compile-side-closed |
| 日期 / 目标版本 | 2026-10-25／2026-10-30 闭口修订 / v0.25 |
| 功能编号 / 优先级 | L25-10 / P1-4 |
| 状态 | **编译侧功能合同已收口**（2026-10-30）。本条出口＝V01、V02、V06 与配置失败关闭；证据在 `webui/server/__tests__/p1-hive-*.test.ts`，实施提交 `28780eae`。JDBC 执行、MCP 入口接入、真实 HS2 与支持矩阵晋级**不在本条出口**；发布取证编号 `HIV25-V01`…`V17` 由 [E2E Spec](lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 持有。数据库支持状态保持 `planned`。本条收口不表示可上线 |
| 授权来源 | 2026-10-25 Forrest 批准按项目规范完成 P1 梯队 Spec；2026-10-30 批准按「功能合同／发布取证」闭口原则收窄本条出口 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) L25-10；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) §1 |
| 审查入口 | [P1 需求审查清单](../plans/2026-10-25-lucy-v0.25-p1-requirements-review-checklist.md) |
| 审查记录 | [P1 需求审查记录](../reviews/2026-10-25-lucy-v0.25-p1-requirements-review-record.md)（2026-10-25 审查执行通过、PM 已签核；附带 F-01–F-04 实施前待办） |
| 权威上游 | [Hive 直连实施方案](../plans/2026-10-20-hive-direct-connection-implementation-plan.md)；L25-09 审计合同；数据库支持矩阵 |
| 实施边界 | 单实例／单副本；只改 Lucy，不修改、复制、补丁或 monkey-patch KTX；客户目标为 linux/amd64 Kubernetes 离线交付 |

本文件收口 **Hive 编译侧功能合同**。静态接口核查与现有单测证明：独立配置、来源闭包、只编译桥、严格 AST、可信 `filters[]`，以及 JDBC 未实现时不得报成已执行。它们不证明 Hive 已可问数、不证明客户 HS2 组合已认证、也不把支持矩阵从 `planned` 晋级。

---

## 闭口层级

- 层级：功能合同
- 本条承诺：管理员可以把 Hive 连接写成独立配置（只存凭据引用、不写 `ktx.yaml`）；Lucy 能把同一已发布 generation 编译成受检查的 Hive SQL；JDBC 未执行时必须返回未执行，不得报成已查询
- 本条出口：配置失败关闭、来源闭包、只编译桥、严格 Hive AST、可信 `filters[]`、流水线在 `jdbc` 段拒绝冒充执行。验收编号 **V01、V02、V06** 与配置失败关闭断言；证据见 `webui/server/__tests__/p1-hive-*.test.ts`
- 不在本条出口：整库旅程、带 Token 的 Agent／Proxy 问数路径、真实 HS2 `EXPLAIN`／执行／独立 oracle、JDBC worker、管理台发现页、客户认证／TLS／离线／amd64、升级与备份恢复、证据等级；审计账本本身（[L25-09](lucy-20261020-v2p5-audit-increment-spec.md)）；ACL／`FinalRows`／行策略模板／问询预算（各自既有 Spec）；运维控制面 Hive 来源拒绝（[L25-16](lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)）；支持矩阵晋级与 SelectDB 外部 Catalog。发布取证编号 `HIV25-V01`…`V17` 由 [E2E Spec](lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 持有
- 上线关系：本条收口不表示可上线；数据库支持状态保持 `planned`

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

### 1.1 本条承诺（功能合同）

管理员可以把 Hive 连接写成独立配置；Lucy 能把同一已发布 generation 编译成受检查的 Hive SQL；JDBC 未执行时必须返回未执行。

完整问数纵向链路（采集 → 发布 → Proxy 准入 → JDBC 执行 → 有界结果）是产品方向，**其中执行与旅程部分不在本条出口**，由 `HIV25` 与后续授权持有。

### 1.2 本条范围内

- 连接配置模型：`webui/config/hive-connections.yaml`，只存凭据引用，不写明文秘密，不写入 `ktx.yaml`；统一连接视图与连接 ID 全局唯一（冲突失败关闭）。
- 来源闭包：同一已发布 generation 的 Manifest／overlay 完整解析（grain、列覆盖、派生列、排除列、segments、joins、隐藏与可见性）。
- Hive 编译桥：原版 `ktx-daemon semantic-query`，显式 `dialect=hive`；stdin／stdout；进程时限、输出上限、错误脱敏、环境隔离。
- 严格 Hive AST 与能力检查；强制行策略转可信 `filters[]`（不假设 `forced_filters` 字段）。
- 流水线固定失败顺序；`jdbc` 阶段未实现时返回 `not_implemented`，不得报成已执行查询。

### 1.3 非目标（本条与产品方向）

- 不跨连接联邦查询，不开放任意 JDBC 驱动上传、Agent 自定义 JDBC URL／JAR／会话初始化语句。
- 不开放 DML／DDL、CTAS、EXPORT、LOAD、ADD JAR、SET、USE 或自动修改 HS2／Hadoop 配置。
- 不把 `sql_execution`、`ktx sql`、`ktx ingest` 作为 Hive 入口；不把 Hive 写入 `ktx.yaml` 或伪装成其他驱动。
- 不默认支持复杂类型内部表达式；需要时通过受审阅 Hive 视图投影为可治理标量。
- 不以静默降级到原始 SQL、正则改 SQL、字符串替换函数或盲目二次转译换取“可用”。
- **本条不交付**：真实 HS2 连接、JDBC worker、元数据采集、管理台发现页、MCP 问数接线、客户认证／TLS／离线／amd64、支持矩阵晋级。

## 2. 已锁定设计裁决

| 编号 | 裁决 | 失败边界 | 本条出口？ |
|---|---|---|---|
| H-D1 | 终点是 HS2；Lucy 自有连接模型与 JDBC worker 负责执行 | 不得经 Doris／SelectDB／Trino 冒充直连 | 设计边界；执行侧不在本条出口 |
| H-D2 | 复用原版 `ktx-daemon semantic-query` 只编译，显式 `dialect=hive` | 未知方言回退 Postgres、编译与执行耦合或需改 KTX 时停止 | **是**（V01／V06） |
| H-D3 | Lucy 从已发布同一 generation 构造完整 resolved sources | 字段丢失、来源合并不一致、未知依赖时拒绝 | **是**（V02） |
| H-D4 | 强制行策略由 Lucy 在编译前转成可信 `filters[]` | 不能证明聚合前生效、策略被删或仅客户端提供时拒绝 | **是**（编译侧转译；裁决本身沿用既有 ACL Spec） |
| H-D5 | 编译后 SQL 经严格 Hive AST、只读、来源闭包、能力与行数检查 | 任一项未知或不符合即不向 JDBC 分派 | **是**（V06；「不向 JDBC 分派」含未实现阶段） |
| H-D6 | 编译进程与执行进程隔离；凭据只到受管 worker | 编译进程不得有 HS2 凭据；worker 不接受未授权连接参数 | 编译侧隔离 **是**；worker **否** |
| H-D7 | 支持矩阵逐组合认证 | 缺客户组合为 `blocked_environment`；局部成功不升级为 `verified` | **否**（支持矩阵／`HIV25`） |
| H-D8 | Hive 能力不改变现行审计、预算、单实例与发布门禁 | 不新增竞争性账本、共享写卷或默认发布阻断 | 边界声明；账本／预算合同不在本条 |

### 2.1 停止交付条件（编译侧）

以下任一条件成立，停止对应编译侧能力并回到设计评审：

1. 锁定镜像中的计算入口不可用，或必须修改 KTX 才能保证正确。
2. Manifest／overlay 合并结果不一致，或物理来源闭包不能完整证明。
3. 方言适配只能靠禁止的文本改写，或未知方言静默回退 Postgres。

HS2 无法执行、取消终态、类型保真与客户组合认证属于执行／交付侧停止条件，由后续授权与 `HIV25` 持有，不阻塞本条编译侧收口。

## 3. 架构与配置合同

### 3.1 运行架构（本条边界）

```text
配置面／调用方
  → Hive 连接配置（hive-connections.yaml，凭据只存引用）
  → 已发布语义资产快照（同一 generation）
  → 原版 ktx-daemon semantic-query（只编译，dialect=hive）
  → Lucy Hive AST／来源／策略／能力检查
  → jdbc 阶段：本条未实现 → not_implemented（不得报成已执行）
```

完整问数架构（MCP Proxy 准入 → JDBC worker → HS2 → 类型保真与交付）仍是产品方向，接线与执行不在本条出口。编译响应中的 `plan` 是语义计划，不是 HS2 物理执行计划。

### 3.2 配置与身份

路径：`<projectRoot>/webui/config/hive-connections.yaml`。只存 Hive 连接及凭据引用，不写明文秘密，不写入 `ktx.yaml`。该路径纳入备份、恢复、迁移、脱敏和配置审计。

- Lucy 统一连接视图合并 KTX 与 Hive 配置，连接 ID 全局唯一；冲突失败关闭，不覆盖或按优先级隐藏。
- 写字段按认证矩阵开放：host、port、默认 database、允许的 databases、启用表范围、transport、HTTP path、auth、凭据引用与 TLS 信任材料引用。
- NONE 与 NOSASL 分开建模；TCP／HTTP、LDAP／Kerberos／TLS 以现场组合为准，不共用一个“免密”分支。
- 创建、编辑、删除复用单实例写入串行化与 generation 失效。

管理 API：`GET/POST/DELETE /api/admin/hive/connections`（配置面；连通测试与元数据采集不在本条）。

### 3.3 语义资产与来源闭包

- Hive database 对应 Schema；物理对象为 `database.table`，规范源键包含连接与 Schema，跨 database 同名表不得合并。
- resolved-source 构建器读取同一已发布 generation，保留 grain、列覆盖、派生列、排除列、segments、joins、隐藏与可见性；不得只拼 `measures`。
- 重复名称、孤立 overlay、缺失 join 目标、未知引用或目录失败均显式报错，不返回旧快照成功状态。
- `sql:` source 的子查询／CTE、join 目标与编译后物理依赖都展开检查；CTE 名不得误作物表，未知依赖拒绝。
- 规范源名格式为 `<schema>_<table>`（如 `finance_orders`）；Manifest 键与 overlay 文件名须遵循，不符即 `hive_source_name_mismatch`。
- `connection_list`、`lucy_catalog`、source 读取与 MCP 发现合入 Hive：**不在本条出口**（属 `HIV25`／后续接线授权）。

## 4. 工具、执行与安全合同

### 4.1 工具路由（边界）

| 工具／入口 | 本条合同 |
|---|---|
| 管理 API ` /api/admin/hive/connections` | **本条出口**：配置读改写与统一视图 |
| 编译桥／流水线库（`webui/server/hive/`） | **本条出口**：只编译至 AST／策略检查；`jdbc` → `not_implemented` |
| `lucy_query`、`lucy_explain_query`、`connection_list`、`lucy_catalog` | **不在本条出口**：接线与问数旅程归后续授权与 `HIV25` |
| `sql_execution`、`ktx sql`、`ktx ingest`、联邦查询 | 显式不支持，不静默换路 |

### 4.2 编译隔离

编译请求包含完整 `sources`、规范化 `query` 和字符串 `dialect: "hive"`；`predefined_measures_only` 由服务端策略决定，Agent 不得提供权威值。请求经 stdin，响应经 stdout，进程有时限、输出上限、错误脱敏和环境隔离；不联网安装依赖；编译进程不得持有 HS2 凭据。

JDBC worker 的接收面、依赖锁定与 IPC：**不在本条出口**。

### 4.3 行策略与 SQL 安全（编译侧）

1. 先规范化请求、绑定来源，再从服务端裁决注入强制谓词；剥离客户端伪造的强制字段与策略覆盖。
2. 复用 Role 内 AND、Role 间 OR、Agent 个人行限制 AND 与强制字段保护；转换为计算接口支持的 `filters[]`，不假设存在 `forced_filters` 字段。裁决算法本身沿用既有 ACL／行策略 Spec；本条只保证转译与注入发生在编译前。
3. 编译 SQL 必须严格 Hive 解析、单语句、只读、实际依赖匹配，并满足输出列、隐藏列、LIMIT、字节和截断合同；任一项失败则不分派。
4. 引号、反斜杠、Unicode、NULL、布尔值、标识符与真实 HS2 结果交叉验证：**执行维不在本条出口**。

### 4.4 沿用他条、不重开

- 审计账本、接收／准入／响应准备：沿用 [L25-09](lucy-20261020-v2p5-audit-increment-spec.md)。本条只保留「接收失败则不编译」。
- ACL、`FinalRows`、行策略模板、问询预算：沿用各自既有 Spec。
- 运维控制面：Hive 来源连接在 preview 返回 `ops_connection_origin_unsupported`（[L25-16](lucy-20261028-v0p25-lucy-ops-control-plane-spec.md)）。
- 取消终态、类型保真、连接池 generation、客户认证／TLS／离线／amd64：不在本条出口。

## 5. 核心流程（伪代码）

本条伪代码止于编译侧与「未执行」边界。JDBC 执行与交付释放不在本条出口。

```text
handleHiveCompileSide(identity, tool, untrustedArgs):
  received = persistReceivedUsingExistingLedger()   # 沿用 L25-09
  if received failed: return AUDIT_UNAVAILABLE; no compile

  snapshot = loadCommittedConnectionAndPublishedSourceGeneration()
  request = normalizeAndValidateExistingToolContract(tool, untrustedArgs)
  stripClientForcedFieldsAndPolicyOverrides(request)
  decision = existingAuthorizeAndRewrite(identity, request, snapshot)
  if denied: persistDecisionAndFinishWithoutDispatch()

  deadline = existingBudgetAndConcurrencyAdmission(identity, request)
  if unavailable: persistBudgetOrConcurrencyOutcomeAndFinish()

  sources = resolveCompleteSourcesAndTransitiveDependencies(request, snapshot)
  assertEveryPhysicalDependencyAllowed(sources, decision, snapshot.enabledTables)

  compilerQuery = normalizeQueryAndInjectTrustedFilters(request, decision)
  compilerQuery.predefined_measures_only = deriveFromServerQueryPolicy(snapshot)
  compiled = callUnmodifiedKtxDaemon(sources, compilerQuery, dialect="hive", deadline)
  if rejected, crashed, malformed, too large or timed out:
    persistTypedFailure(); no JDBC; no raw-SQL fallback; no postgres dialect fallback

  checked = strictHiveAstAndCapabilityCheck(compiled.sql, compiled.plan, decision)
  assertPoliciesApplyBeforeAggregationAndDependenciesMatch(checked)
  if explain: persistDiagnosticAndReturnWithoutDatabaseExecution()

  # jdbc stage: NOT IMPLEMENTED in this contract
  return hive_stage_not_implemented:jdbc
  # MUST NOT claim the query was executed
```

失败顺序（本条已实现段）：审计接收 → 配置／资产快照 → 请求与 ACL → 预算并发 → 来源闭包 → 编译 → AST／策略检查 →（`jdbc` = `not_implemented`）。任何安全前置失败不得通过后续“空结果”伪装成功；`jdbc` 未实现不得伪装为执行成功。

## 6. 工作包

| 工作包 | 归属 | 状态 |
|---|---|---|
| H25-02 编译复用验证 | **本条** | 已收口：V01、V02、V06 与配置失败关闭有单测证据 |
| H25-01 环境与依赖 | 不在本条出口 | 客户 HS2／认证／TLS／JDBC／JRE 物料；归 `HIV25`／交付 |
| H25-03 JDBC／元数据 | 不在本条出口 | 后续授权 |
| H25-04 最小贯通 | 不在本条出口 | `HIV25`（V07–V10 对应维度） |
| H25-05 治理与异常 | 不在本条出口 | `HIV25`（V11–V15 对应维度）；ACL／审计合同沿用他条 |
| H25-06 管理台与发现 | 不在本条出口 | 后续授权；本条仅有配置 API，无侧栏页 |
| H25-07 离线与升级 | 不在本条出口 | `HIV25` 交付维／`LIFECYCLE`（V16／V17） |
| H25-08 支持矩阵收口 | 不在本条出口 | [数据库支持矩阵](../governance/database-support-matrix.md)；保持 `planned` |

## 7. 验收矩阵（本条出口）

本条出口只含下表。结果只允许 `pass / fail`；本条不以 `blocked_environment` 充当本条出口状态。默认不新增浏览器或移动窄屏测试。

| ID | 场景 | 通过标准 | 证据 |
|---|---|---|---|
| V01 | 固定 runtime 的只编译 | 无数据库配置和凭据仍返回结构化 SQL／plan；输入拒绝与进程失败可分 | `p1-hive-compile-bridge.test.ts` |
| V02 | Manifest＋overlay 完整来源 | grain、派生列、segment、join、隐藏列不丢；重复／孤立／未知引用失败 | `p1-hive-source-closure.test.ts` |
| V06 | 非法输入、编译异常、超时、超大输出 | 无 JDBC 分派；不回退 Postgres；不返回未校验 SQL；`jdbc` 未实现时报 `not_implemented` 而非已执行 | `p1-hive-compile-bridge.test.ts`、`p1-hive-pipeline.test.ts` |
| （配置） | 配置失败关闭 | 写入 `hive-connections.yaml` 不进 `ktx.yaml`；拒绝明文秘密；连接 ID 与 KTX 冲突失败关闭（409） | `p1-hive-config.test.ts`、`p1-hive-routes.test.ts` |

### 7.1 不在本条出口（发布取证 `HIV25`）

下列编号**保留原号**，由 [E2E Spec](lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 的 `HIV25-V01`…`V17` 持有。`HIV25-V01`／`V02`／`V06` 可引用本条编译侧证据作编译维；不得把「生成结构化 SQL／plan」写成「HS2 执行通过」。

| ID | 场景 | 归处 |
|---|---|---|
| V03 | 聚合、NULL、过滤、排序、limit；HS2 EXPLAIN 与真实执行／oracle | `HIV25`（编译维可离线；执行维需 HS2） |
| V04 | 时间分组、时区、标识符；编译成功但 EXPLAIN 失败判 fail | `HIV25` |
| V05 | JOIN、fan-out、CTE、sql source；执行维 oracle | `HIV25` |
| V07 | 新建→测试→采集→发布→发现 | `HIV25` |
| V08 | 带 Token 的 Proxy 语义查询 | `HIV25` |
| V09 | 明细、读取、explain、模板／内部调用 | `HIV25` |
| V10 | 跨 database 同名表与配置变更 | `HIV25` |
| V11 | 越权、隐藏列、未启用表、伪造强制字段 | `HIV25`／ACCESS 相关 Spec |
| V12 | 租户、角色组合、个人限制、转义、聚合 JOIN | `HIV25`／行策略 Spec |
| V13 | 多语句、写入与 JDBC 参数注入 | `HIV25` |
| V14 | 慢查询、断开、超时、取消失败、worker 崩溃 | `HIV25` |
| V15 | 接收／准入／响应准备账本失败 | [L25-09](lucy-20261020-v2p5-audit-increment-spec.md)；旅程维在 `HIV25` |
| V16 | 客户认证／HTTP／TLS／离线与 amd64 | `HIV25` 交付维 |
| V17 | 升级、备份恢复与既有数据库回归 | `LIFECYCLE`（`UPG25`／`RVC25`） |

固定合成数据与独立 oracle 预期（租户 A／B、sum=30.50／100.00／130.50 等）随真实执行走，归 `HIV25`，不作为本条出口。

## 8. 证据与支持状态

本条编译侧证据：`webui/server/__tests__/p1-hive-*.test.ts`；实施提交 `28780eae`。过程材料可落 `inbox/hive-direct/<runId>/`，非正式发布证据。

数据库支持矩阵中 Hive 当前保持 **`planned`**。只有指定组合的实现与证据齐全后，才能按矩阵规则另行申请状态变更；本 Spec 收口与文档 lint 都不是支持证据，也不是可上线声明。

## 9. Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/00-product-terminology-standard.md` §4.1／§4.1.1（Hive 术语与 Protected DOM）

### What This Change Follows

- [x] 本条无新增治理台页面与视觉原语；配置面不进侧栏镜像
- [x] 术语与 Protected DOM 沿用术语标准（`HiveServer2`、`HS2`、`JDBC`、`dialect=hive` 等）
- [x] 管理 API 错误与失败关闭不冒充执行成功；状态不只靠颜色（本条无 UI 状态面）

### Exceptions (If Any)

- None（本条不交付连接管理界面）

### Follow-up Needed

- 连接管理 Drawer／表单／认证渐进披露若在后续授权中实施，须另开 Spec／变更并沿用既有连接卡与表单模式；不在本条出口

## 10. 闭口边界

本条确认：直连边界、原版 KTX 复用、完整来源闭包、编译前可信 `filters[]`、严格 AST、以及 JDBC 未实现时不得冒充执行。

本条收口：

- **不**表示 Hive 已可问数；
- **不**授权 JDBC worker、MCP 接线、真实 HS2、镜像构建、部署、发布或客户支持声明；
- **不**把 `HIV25-V03`…`V17` 记为本条 `blocked_environment` 出口——它们不在本条出口。
