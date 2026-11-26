# 渐进开放 KTX 已内置分析型连接器（ClickHouse / DuckDB）Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 渐进开放 KTX 已内置分析型连接器（ClickHouse / DuckDB）Spec |
| 文档类型 / 版本 | Spec（数据源接入与数据库支持矩阵升级）／**v0.1-draft** |
| 日期 / 目标版本 | 2026-11-26／产品线 `0.35.0`（`lucy-v0.35`） |
| 功能编号 / 优先级 | **REQ-0115**／**P0（计划纳入本期开发）**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0115` |
| 阶段 | S1 |
| 状态 | S1｜v0.1-draft。草案；终稿未确权；未获开发授权；测试台 `not_registered`；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 对标 [ktx Cloud](https://www.kaelio.com/products/ktx-cloud) 全栈数仓开箱能力，结合 [`docs/governance/database-support-matrix.md`](../governance/database-support-matrix.md) §3.1 盘点事实：KTX `0.16.0` `dist/connectors/` 已内置 `clickhouse` 与 `duckdb` 驱动，但 Lucy `DATABASE_TYPES` 尚未开放 |
| 实施主体 | `webui/src/lib/connectionId.ts`、`webui/server/project.ts`、新建连接表单与连通测试路径、`deploy/compose/` 测试夹具、`docs/governance/database-support-matrix.md`、`docs/user-guide/data-sources.html`；不改 KTX 源码；不改 WebUI 运行导航 |
| 配对计划 | [`docs/plans/lucy-20261126-ktx-analytical-connectors-rollout-plan.md`](../plans/lucy-20261126-ktx-analytical-connectors-rollout-plan.md) |
| 测试台 | `not_registered`（计划随本套件新建 `UAT-SUITE-ANALYTICAL-CONNECTORS`） |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 2026-11-26 初稿落盘。完成 KTX `0.16.0` 内置连接器与 Lucy `DATABASE_TYPES` 差距盘点，明确 ClickHouse / DuckDB 开放路径、协议兼容验证与矩阵晋级规则。 |
| v0.1-draft | 2026-11-26 修订：补齐交互合同／元素清单／交互评审（Q1–Q6 未评）；配对 Plan「浏览器验证」节改为四行标签格式；消除 `lint:spec-docs` interaction-contract 警告。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：治理方可在 WebUI 新建连接与无头 `ktx.yaml` 中选择 `clickhouse`（HTTP/HTTPS 端口）与 `duckdb`（本地只读文件路径）数据库类型，完成连通测试、Schema Manifest 扫描（`ktx ingest`）以及经过 ACL 与 Row Policy 护栏的只读 `lucy_query` 查询；同时数据库支持矩阵如实标定为 `gated`（未过实机认证前不夸大为 `verified`）。
- 本条出口：ClickHouse 与 DuckDB 的配置校验、连通探测、Schema 扫描、只读查询、越权拦截及非安全写操作拒绝的本机自动化与隔离 Docker Compose 跑次（`SC-01`–`SC-08`）。
- 不在本条出口：BigQuery、Snowflake、MongoDB 连接器开放；ClickHouse 分布式集群高可用路由；DuckDB 远端对象存储（S3/GCS）动态凭据注入；修改 KTX 上游连接器源码。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（复用「连接」「连接 ID」「连通测试」「支持状态」「Schema Manifest」等既有术语；新增数据库类型标识 `clickhouse`、`duckdb` 的 DOM 节点须加 `translate="no"` 与 `notranslate`）。

## 交互合同

- 路由：/connections
- 基准页：新模式：webui/docs/design-system/15-components-overlay.md
- 一件事：治理方在新建连接弹窗中选择 ClickHouse / DuckDB 类型、完成连通测试并保存，新连接以受限支持状态进入连接列表。
- 状态：首访：不适用：新建连接弹窗由既有入口触发，本条不改页头与首访结构；空：不适用：连接列表空态沿用既有页面承载，本条不改动；加载：不适用：连通测试探测期间沿用按钮禁用与进行中文案，不新增加载态面板；错误：连通测试失败按原因分类提示（连接超时／认证失败／文件不存在），不静默吞错；0 条：不适用：本条不触及 0 条态；成功：连通测试通过显示成功提示，保存后连接列表新增卡片并如实标注受限支持；部分：不适用：表单字段校验未通过即地提示，不产生部分成功态
- 主动作：弹窗底部保存按钮为唯一 primary，连通测试与保存进行中禁用；不做第二同组 primary。
- 决定信息：用户凭连通测试结果分类提示与支持状态标签即可知晓本次探测结论与连接受限支持级别。
- 术语：「连接」「连通测试」「支持状态」已登记；数据库类型标识 `clickhouse`／`duckdb` 按本条 Terminology Compliance 登记并加翻译防御。
- 台账：无新台账
- 状态维度：连通测试的成功与失败提示互斥且文案可区分，同一状态维度不得互相否定。

## 元素清单

- E1｜/connections｜错误｜新建/编辑连接弹窗｜连通测试失败按原因分类提示（连接超时／认证失败／文件不存在），不静默吞错
- E2｜/connections｜成功｜新建/编辑连接弹窗与连接概览卡片｜连通测试通过显示成功提示；保存后新连接卡片如实标注受限支持（`gated`）
- E3｜/connections｜主动作｜新建/编辑连接弹窗底部操作区｜保存按钮为唯一 primary，连通测试与保存进行中禁用
- E4｜/connections｜决定信息｜新建连接弹窗表单与连接概览卡片｜数据库类型切换自动填充默认端口或切为文件路径输入；支持状态标签与矩阵一致

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：未评
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：未评
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：未评
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：未评
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：未评
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：未评

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。4 画像逐行判定；不得写「所有用户」。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | **问数面**：无法通过 Lucy 查询 ClickHouse 或 DuckDB 中的分析数据；**报告面**：未触碰 | **问数面**：在治理方接入并授权后，可通过同一 MCP 入口与受治理语义层查询 ClickHouse / DuckDB 数据，且受相同 ACL/Row Policy 保护；**报告面**：未触碰 | P1·问数面 ↑／P1·报告面 ＝ | `SC-04`、`SC-05` | — |
| P2 治理方 | **语义口径面**：WebUI `DATABASE_TYPES` 仅 8 项，无 ClickHouse / DuckDB 入口；**权限授权面**：按既有 Role/ACL 模型配置 | **语义口径面**：可在 `/connections` 直接配置 ClickHouse / DuckDB 并触发 `ktx ingest` 维护语义层；**权限授权面**：复用既有 Role/ACL 规则，无需新学授权模型 | P2·语义口径面 ↑／P2·权限授权面 ＝ | `SC-01`、`SC-02`、`SC-03` | — |
| P3 运维方 | **交付运维面**：无 ClickHouse / DuckDB 夹具与支持矩阵说明；**运行观察面**：审计日志正常记录 | **交付运维面**：获得标准 Docker Compose 验证夹具与 `database-support-matrix.md` 明确的支持状态与已知协议限制；**运行观察面**：复用现有日志与健康检查 | P3·交付运维面 ↑／P3·运行观察面 ＝ | `SC-07`、`SC-08` | — |
| P4 管理层 | 仅可见 MySQL/PG 覆盖数据 | 数据覆盖范围扩展至行为日志（ClickHouse）与本地分析库（DuckDB），且对外口径与真实证据严格一致 | P4·口径质量面 ↑／P4·业务结果面 ＝ | `SC-08` | — |

## 第一性原理检查（主路径可用性优先）

| # | 问题 | 回答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。原有 8 种 `DATABASE_TYPES` 及 MySQL/PG 主路径零改动 |
| 2 | 若增加拒绝／门禁，逃生或钉选路径是否在同一部署实况下可执行且纳入必做 UAT？ | 是。DuckDB 路径校验与 ClickHouse 只读超时限制在拒绝时均返回明确修复指引 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是。`SC-05`/`SC-06` 验越权与非法路径拒绝，`SC-03`/`SC-04` 验合法扫描与查询成交 |
| 4 | 是否避免把「宿主缺席／凭据缺席」记成用例前置 BLOCKED？ | 是。Docker Compose 内置轻量 ClickHouse 容器与本地 DuckDB 样本文件，可全真脱网执行 |

## 1. 需求摘要

1. **类型注册与配置模型（`DATABASE_TYPES` & `ktx.yaml`）**：
   - 在 `webui/src/lib/connectionId.ts` 与服务端 `project.ts` 新增 `clickhouse`（默认端口 `8123`，`driver: "clickhouse"`）与 `duckdb`（`isFileBased: true`，`driver: "duckdb"`，只读文件路径）。
   - DuckDB 文件路径必须做沙箱目录白名单与路径穿越校验（仅允许受控数据目录或项目挂卷目录内的 `.duckdb`/`.db` 文件，禁止读取 `/etc`、`.ktx/secrets/` 等敏感路径）。
2. **协议兼容与只读边界验证**：
   - 验证 KTX `0.16.0` `dist/connectors/clickhouse` 与 `dist/connectors/duckdb` 在只读查询、`ktx ingest` 宽表扫描、查询超时（30s/120s）下的行为。
   - 若上游 KTX 存在类似 StarRocks `max_execution_time` 的方言兼容问题，优先在 Lucy 构建期兼容层或 `ktx.yaml` 参数映射中解决，不改 KTX 源码。
   - 严禁 DDL/DML 写操作穿透（DuckDB 以 `READ_ONLY` 模式打开，ClickHouse 校验只读用户或 Proxy 只读守卫）。
3. **支持矩阵与文档对齐**：
   - 更新 `docs/governance/database-support-matrix.md` §3，将 ClickHouse 与 DuckDB 从 §3.1「未开放」移入正式矩阵，初始标为 `gated`（随 Docker smoke 证据与支持计划齐备，通过实机认证后方可升 `verified`）。

## 核心流程（伪代码）

```text
// 1. 新建连接校验与写入（webui/server/project.ts）
function validateAndSaveConnection(input):
  if input.type == "duckdb":
    assertSafeFilePath(input.filePath, allowedRoots=[DATA_DIR, PROJECT_DATA_DIR])
    assertFileExtension(input.filePath, [".duckdb", ".db"])
    ktxConfig = { driver: "duckdb", database: input.filePath, readonly: true }
  else if input.type == "clickhouse":
    assertValidHostAndPort(input.host, input.port ?? 8123)
    ktxConfig = { driver: "clickhouse", host: input.host, port: input.port,
                  database: input.database, user: input.username,
                  passwordFile: writeSecretFile(input.id, input.password),
                  readonly: true }
  writeKtxYamlAtomic(ktxConfig)
  triggerExecutionRuntimeReload()

// 2. 运行时只读查询与护栏（复用 Lucy MCP Proxy）
function handleLucyQuery(connId, sqlOrSemanticQuery, role):
  enforceAclAndRowPolicy(connId, role)
  enforceReadOnlyStatement(sqlOrSemanticQuery)          // 拒绝 INSERT/UPDATE/DELETE/ATTACH/COPY
  return forwardToKtxWithTimeout(connId, sqlOrSemanticQuery, timeoutMs=30000)
```

## 验收（SC）

| ID | 合同 |
|---|---|
| SC-01 | `DATABASE_TYPES` 与后端连接校验正确识别 `clickhouse` 与 `duckdb`；DuckDB 非白名单路径或非法扩展名被拒绝（`400`） |
| SC-02 | WebUI 新建连接弹窗选择 `clickhouse` / `duckdb` 时表单字段、默认端口与翻译防御属性（`translate="no"`）渲染正确（含前台浏览器计时） |
| SC-03 | 在隔离 Docker Compose 环境下，ClickHouse 与 DuckDB 均能通过连通测试并完成 `ktx ingest` 生成合法 Schema Manifest |
| SC-04 | 基于生成后的语义层，Agent 经 Lucy MCP Proxy（`:7879`）调用 `lucy_query` 能对 ClickHouse 与 DuckDB 返回正确聚合结果 |
| SC-05 | 对 ClickHouse 与 DuckDB 配置表级 ACL 与 Row Policy 后，越权 Agent 被拒绝且合法 Agent 仅返回授权行数据 |
| SC-06 | 尝试通过 DuckDB `ATTACH`/`COPY` 或 ClickHouse DML 写入时被只读守卫拦截，零数据修改 |
| SC-07 | 连续执行 `npm run smoke:p0:clickhouse-demo` 与 `duckdb` 冒烟用例全绿 |
| SC-08 | `docs/governance/database-support-matrix.md` 与 `docs/user-guide/data-sources.html` 已同步状态为 `gated` 且无对外过度承诺冲突 |
