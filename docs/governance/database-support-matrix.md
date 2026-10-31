# Lucy 数据库支持矩阵

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy 数据库支持矩阵（Database Support Matrix） |
| 文档类型 | Governance / Capability Matrix |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-21 |
| 适用范围 | Lucy 可连接数据库类型的支持状态、状态判定证据、已知协议差异、对外口径与更新规则 |

## 1. 这张表解决什么问题

连接是 Lucy 最高频的用户触点，也是最容易「承诺过度」和「排障无门」的地方。本表回答三个问题，其他文档不再重复回答：

1. **能不能连**——每个数据库类型的支持状态，以及这个状态对外怎么说。
2. **凭什么这么说**——每个非 `verified` 状态缺哪一条证据、由谁补、什么时候补。
3. **坏了先看哪里**——已知协议差异与规避方式（新库接入前先读这一节，避免重复踩坑）。

### 1.1 真源声明

本文是**数据库支持状态的唯一真源**。以下文档**引用**本文，不再各自维护状态：

| 文档 | 原状态描述位置 | 处理方式 | 状态 |
|---|---|---|---|
| `docs/governance/version-matrix.md` §4 Database Matrix | 原 5 行，仅覆盖 2 个 UI 类型 | 改为指向本文 §3，并补齐其余 6 个类型的状态列 | ✅ 已处理（2026-10-21） |
| `docs/governance/project-overview.md` L120 | 一行散文，缺 6 个 UI 类型 | 保留摘要，指向本文 | ✅ 已处理（2026-10-21） |
| `docs/specs/lucy-platform-goal-checklist.md`（L120 / L170） | 散文两行 + 门禁规则 | 保留门禁规则，状态值改为引用本文 | ⬜ 待处理 |
| `docs/specs/lucy-aicon-online-capability-scorecard.md` §5 | 最接近矩阵的一处，但缺 3 个类型 | 保留为对外演讲视图，状态值引用本文 | ⬜ 待处理 |
| `docs/user-guide/data-sources.html`「支持的数据库」 | 6 种 driver 全部写为「支持」 | 属对外文案，表述须与本文状态一致（见 §5 冲突登记） | ⬜ 待处理（需产品确认口径） |

> 冲突时以本文为准。发现不一致 → 按 §7 更新规则修正，并在 §5 登记。

### 1.2 UI 类型真源

`webui/src/lib/connectionId.ts` 的 `DATABASE_TYPES` 是**新建连接表单可选类型**的唯一真源（当前 8 项）。本文 §3 必须覆盖其每一项——新增类型未登记即为登记缺失（§7 检查清单第 1 条）。

代码层真源与本文的关系：

- **代码真源**：`DATABASE_TYPES`（有哪些类型、driver、协议、默认端口）。
- **本文**：每个类型的**支持状态**与证据。

两者是互补的，不是重复。**当前本文不含自动化防漂移门禁**（状态靠人工核对，见 §6 Step 4），这是本版本的已知缺口。

## 2. 状态阶梯

状态只有六级，按证据强度从高到低。**判定按 §6 伪代码执行，首个命中即返回。**

| 状态 | 判定标准 | 对外口径 | 证据要求 |
|---|---|---|---|
| `verified` | 有可复跑证据命令，且在目标环境真实通过并留有 evidence | 可说「支持」 | ≥1 条可复跑命令 + evidence 文件 + 日期 |
| `gated` | 有支持计划 / evidence 流程，但实机 evidence 未齐，或需按环境各自举证 | 可说「受限支持」，**不进发布 verified matrix** | 支持计划文档 + evidence 流程；须写明「缺哪条证据、谁补、何时补」 |
| `experimental` | 类型可选、驱动可用，但**无实机证据、无支持计划** | 不得写「支持」 | 无（但必须有已知的限制说明） |
| `planned` | 有实施方案，尚未开发 | 可说「计划中」 | 实施方案文档 |
| `roadmap` | 仅候选，尚未决策 | 不得写「支持」 | 候选登记 |
| `unsupported` | 明确不支持 | 明确说不支持 | 决策记录 |

**`verified` 的判定是单向的**：没有 live evidence 就不许写 `verified`——这条规则来自 `docs/specs/lucy-platform-goal-checklist.md` L120「StarRocks live certification 前不得写入 verified database matrix」，本文将其推广到所有数据库类型。

## 3. 数据库类型支持矩阵

| 数据库类型 | UI driver | 协议 | 默认端口 | 状态 | 证据 / 依据 | 对外口径 |
|---|---|---|---|---|---|---|
| MySQL | `mysql` | MySQL | 3306 | `verified` | `npm run smoke:p0:demo`（`mysql:8.4` demo）；`npm run smoke:p0:customer`（Aliyun RDS MySQL 客户路径）；`npm run smoke:p0:headless-config`；UAT `docs/uat/uat-mysql-aliyun-data-qa.md` | 支持 |
| PostgreSQL | `postgres` | PostgreSQL | 5432 | `verified` | `npm run smoke:p0:postgres-demo`（`postgres:16-alpine`）；`deploy/compose/docker-compose.postgres-demo.yml` | 支持 |
| StarRocks（MySQL 协议） | `mysql` | MySQL（wire） | 9030 | `gated` | 支持计划 `docs/specs/starrocks-r1-support-plan.md`；`npm run smoke:p1:starrocks-certification`（无真实配置时 blocked）；`npm run r1:starrocks-smoke`；evidence 环境变量 `LUCY_R1_STARROCKS_EVIDENCE` | 受限支持；live certification 前不进发布 verified matrix |
| Apache Doris | `mysql` | MySQL（wire） | 9030 | `gated` | R1 计划 `docs/specs/lucy-r1-controlled-data-service-plan.md`；`npm run r1:doris-smoke`；`npm run r1:readiness:strict`；`npm run r1:release-bundle`；evidence 环境变量 `LUCY_R1_DORIS_EVIDENCE`；UAT 复测 `docs/uat/uat-mcp-session-regression.md` §7；客户环境审阅 `docs/reviews/2026-10-20-selectdb-hive-catalog-review.md` | 受限支持；R1 默认目标源，每个环境需各自举证 |
| SQL Server | `sqlserver` | TDS | 1433 | `experimental` | UI 与 KTX 驱动均存在（KTX 0.16.0 `dist/connectors/sqlserver`）；**`scripts/` 与 `deploy/` 零命中——无 smoke、无 compose demo、无 UAT、无论文级实机记录** | 不得写「支持」；需另立支持计划 |
| Oracle | `oracle` | Oracle | 1521 | `roadmap` | `docs/specs/lucy-platform-goal-checklist.md` v0.3 / v0.4：Oracle 并入 Open Risk，仍为 roadmap candidate，未启动协议兼容 spike | 不得写「支持」 |
| SQLite | `sqlite` | 文件 | — | `verified` | 本地文件型连接与 Lucy 内部存储（`storage.state: sqlite`）：`npm run smoke:p0:demo`、`customer-config.example/ktx.yaml` | 支持，**但仅限本地文件场景**，不是客户生产目标库 |
| Amazon Athena | `athena` | Athena API | — | `experimental` | 类型已在 `DATABASE_TYPES` 与术语标准登记（写入 KTX `driver: athena`，不保存数据库密码）；**`scripts/` 与 `deploy/` 零命中——无实机证据** | 不得写「支持」 |

### 3.1 KTX 已具备但 Lucy 未开放（计划支持候选）

KTX 0.16.0 的连接器目录（`dist/connectors/`）比 Lucy 开放范围更大。以下驱动**上游已支持、Lucy 未在 UI 暴露**，登记为潜在开放对象：

| 驱动 | KTX 连接器 | Lucy UI | 当前判断 |
|---|---|---|---|
| BigQuery | `dist/connectors/bigquery` | 未开放 | 候选，未决策 |
| ClickHouse | `dist/connectors/clickhouse` | 未开放 | `version-matrix.md` §4 记为「not verified for Lucy P0」；候选，未决策 |
| DuckDB | `dist/connectors/duckdb` | 未开放 | 候选，未决策 |
| MongoDB | `dist/connectors/mongodb` | 未开放 | 候选，未决策（语义层建模路径不同，开放成本高于其它） |
| Snowflake | `dist/connectors/snowflake` | 未开放 | `version-matrix.md` §4 记为「not verified for Lucy P0」；候选，未决策 |
| Hive（JDBC / HiveServer2） | 无独立连接器（复用 KTX Python 语义计算接口） | 未开放 | **`planned`**：编译侧 `docs/specs/lucy-20261025-v0p25-hive-direct-connection-spec.md` 已收口（V01／V02／V06）；问数执行波 `docs/specs/lucy-20261030-hive-query-execution-spec.md` Wave A 已落地（HQ 合成验收）；缺客户组合证据时不得晋级 |

> 开放任一候选前必须先补一份支持计划（含 evidence 流程），再更新本表状态。

### 3.2 接入能力边界（非数据库类型，同属对外承诺）

| 能力 | 状态 | 说明 |
|---|---|---|
| 写库 / DML | `unsupported` | Lucy 只读；`readonly` 默认开启 |
| 跨源联邦 Join | `unsupported` | 跨连接 Join 不支持 |
| BI 可视化 / 人类 Dashboard | `unsupported` | Lucy 不替代 BI |
| SaaS 多租户 | `unsupported` | 单租户交付形态 |

## 4. 已知协议差异与规避

接入新库或排障时先读本节。

### 4.1 MySQL 协议引擎不接受 `max_execution_time`（errno 1193）

**现象**：连接测试或取数报 `Unknown system variable 'max_execution_time'`（MySQL 错误码 1193）。

**根因**：KTX 0.16.0 的 MySQL 连接器在**每条只读查询前**无条件下发 `SET SESSION max_execution_time = <query_timeout_ms>`（`dist/connectors/mysql/connector.js` 的 `query()`）。连通测试走的也是这条路径（`testConnection()` → `query('SELECT 1')`），因此**探活即失败，真实取数同样失败**。

**受影响的库**：StarRocks / Doris 的 MySQL 协议端口；MariaDB（全系，其等价变量是 `max_statement_time`）；MySQL < 5.7.8。

**判定命令**（在 Lucy 容器内执行，输出 `1` = 镜像已带兼容补丁，`0` = 未带）：

```bash
grep -c "lucy-starrocks-max-execution-compat" \
  /usr/local/lib/node_modules/@kaelio/ktx/dist/connectors/mysql/connector.js
```

**规避**：使用已包含 `scripts/runtime/patch-ktx-mysql-starrocks-compat.js` 的镜像。该补丁在**构建期**把这条 SET 包进 try/catch 并吞掉 1193；因此**带补丁的镜像不会出现此报错**，出现即说明镜像不含补丁。

**残余风险**：补丁生效后服务端超时随之失效（该 SET 是这些引擎上唯一的查询超时边界，mysql2 连接池未设客户端查询超时）。当前兜底是 Lucy 层 `execFile` 超时（探活 30s、ingest 120s、validate 60s、reindex 180s、默认查询 30s），进程会被终止但服务端查询未必干净结束。

**已知治理缺口**（勿在排障时踩）：

- 校验脚本 `scripts/release/verify-ktx-starrocks-patch.cjs` **未接入任何构建门禁**，仅在 troubleshooting runbook 中被提及；「镜像是否含补丁」目前无自动化断言。
- 补丁脚本 `scripts/runtime/patch-ktx-mysql-starrocks-compat.js` 使用 CommonJS 但扩展名为 `.js`，在仓库根（`package.json` 为 `"type": "module"`）执行会抛 `ReferenceError: require is not defined in ES module scope`；镜像构建之所以正常，是因为它被 COPY 到 `/tmp` 且执行时 `/app/package.json` 尚未写入。

### 4.2 Doris / SelectDB 外部 Catalog

`default_init_catalog` 依赖 SelectDB / Doris 版本能力，客户版本未确认；外部目录上的表一般只可查、不可写。详见 `docs/reviews/2026-10-20-selectdb-hive-catalog-review.md` §7。

### 4.3 Oracle Instant Client

用户手册记载 Oracle 需额外安装 Oracle Instant Client。**该说明尚未经实机验证**（Oracle 状态为 `roadmap`），接入前先做协议兼容 spike。

## 5. 状态冲突登记

已发现、尚未消解的对外口径冲突。**本节是这张表存在的主要理由之一**——冲突不登记，下一个人还会踩。

| # | 冲突 | 涉及文档 | 处理建议 | 状态 |
|---|---|---|---|---|
| C1 | Oracle 在用户手册中记为「支持」，在目标清单中是 roadmap candidate | `docs/user-guide/data-sources.html` vs `docs/specs/lucy-platform-goal-checklist.md` | 用户手册改为「计划支持」或删除该行 | 未处理 |
| C2 | SQL Server 在用户手册中记为「支持」，实为 `experimental`（零实机证据） | 同上 | 同上 | 未处理 |
| C3 | Athena 在用户手册中记为「支持」，实为 `experimental` | 同上 | 同上 | 未处理 |
| C4 | Doris 在能力评分卡中记为「方案/契约层」，在 R1 计划中是默认目标源且有独立 evidence 流程 | `docs/specs/lucy-aicon-online-capability-scorecard.md` §5 vs `docs/specs/lucy-r1-controlled-data-service-plan.md` | 以 R1 计划为准（`gated`），评分卡改为引用本文 | 未处理 |
| C5 | `version-matrix.md` §4 的 Database Matrix 原只覆盖 2 个 UI 类型，缺 StarRocks / Doris / SQL Server / Oracle / SQLite / Athena | `docs/governance/version-matrix.md` | 改为指向本文 §3 | ✅ 已处理（2026-10-21） |

> C1–C3 属**对外文档过度承诺**，建议优先处理——它们直接影响售前口径。改动对外手册措辞属于产品口径决策，需产品确认后再改。

## 6. 核心流程（伪代码）

状态判定与升级按以下流程执行。

```text
输入：目标数据库 D 的候选状态变更（升级或降级）

Step 1 — 取基线事实
  baseline = {
    ui_exposed:      D.key ∈ webui/src/lib/connectionId.ts . DATABASE_TYPES,
    ktx_driver:      D.ktx_driver ∈ KTX 0.16.0 . dist/connectors/*,
    live_evidence:   D.evidence_files 中存在且校验通过,
    support_plan:    D.support_plan 存在,
    impl_plan:       D.implementation_plan 存在,
    roadmap_candidate: D 在 roadmap 候选清单中
  }

Step 2 — 判定目标状态（自上而下，首个命中即返回）
  if D ∈ 明确不支持清单          → unsupported
  else if baseline.live_evidence → verified
  else if baseline.support_plan 且 (evidence 流程 或 stub 证据存在)
                                   → gated
  else if baseline.impl_plan     → planned
  else if baseline.roadmap_candidate → roadmap
  else if baseline.ui_exposed 且 baseline.ktx_driver → experimental
  else                            → unsupported（默认不承诺）

Step 3 — 写回约束（不满足则本次变更无效）
  - 目标 = verified 时：
      必须存在 ≥1 条「可复跑证据命令」，
      且该命令在目标环境真实通过过一次，
      并登记 evidence 文件路径 + 通过日期。
  - 目标 = gated 时：
      必须写明「缺哪一条证据 / 由谁补 / 何时补」三要素。
  - 目标 = experimental 时：
      UI 文案与用户手册不得出现「支持」字样。
  - 降级（verified → 其它）：无需额外审批，
      但必须同步 §5 冲突登记与全部对外文案。

Step 4 — 文档自检（人工；当前无自动化门禁）
  for D ∈ 全部已登记类型:
    assert D 在 §3 有行                       # 防漏登记
    assert D 在 §4 / §5 登记范围内            # 已知差异与冲突
    assert 用户手册(data-sources.html)对 D 的表述
           与本文状态不冲突                    # experimental/planned/
                                              # roadmap 不得写成「支持」
    assert 若 D = verified:
             release bundle 的 databases.verified 含 D
  任一断言失败 → 本次变更不算完成
```

## 7. 更新规则

**触发更新**（任一成立即需更新本文，并同步 §1.1 表中列出的全部文档）：

- `DATABASE_TYPES` 增删类型（新增类型未登记即为登记缺失）。
- 任一数据库的状态发生变化（晋级或降级）。
- 证据补齐或失效（如 StarRocks live certification 通过）。
- 新增已知协议差异或规避方式变化。
- KTX 版本升级——可能带来新连接器或改变已有连接器行为（如 `SET SESSION` 行为），需重跑 §4 已知差异核对。
- 对外文档表述变化。

**登记检查清单**（人工执行，逐条打勾）：

- [ ] 新类型已加进 §3 表，且 driver / 协议 / 默认端口与 `webui/src/lib/connectionId.ts` 逐字一致。
- [ ] 状态按 §6 伪代码判定，不靠印象。
- [ ] 证据命令**真实跑过一次**（不是「应该能跑」）。
- [ ] §5 冲突登记已同步更新。
- [ ] 对外文档表述与本文一致（`docs/user-guide/data-sources.html` 至少）。
- [ ] 若状态为 `verified`，已在 `docs/governance/version-matrix.md` §4 与 release bundle 的 `databases.verified` 同步。
- [ ] 若涉及新协议差异，已在 §4 补一条「现象 / 根因 / 判定命令 / 规避 / 残余风险」。

**已知治理缺口**：本文**没有自动化防漂移门禁**。§6 Step 4 的自检目前靠人工执行。候选改造方向（未实施）：

- 在 `DATABASE_TYPES` 增 `support` 字段作为机器可读真源，本文由其渲染或被门禁逐格比对。
- 新增 `scripts/gates/database-matrix-gate.mjs`：校验「UI 类型全覆盖」「`verified` 必须挂可执行证据命令」「对外文案不得与状态冲突」三条。
- 把 `scripts/release/verify-ktx-starrocks-patch.cjs` 接入构建门禁（对应 §4.1 已知缺口）。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- **支持状态 / Support Status**：本文 §2 的六级阶梯。UI 主术语「支持状态」；禁止文案「支持度」「兼容度」「支持等级」。仅在本文与状态筛选语境中使用，不与「启用表范围 · 状态筛选」（术语标准 §4.7）的「状态」混用。
- **状态枚举值** `verified` / `gated` / `experimental` / `planned` / `roadmap` / `unsupported`：一律小写英文枚举，不翻译、不本地化。
- **数据库类型**：指新建连接表单中的数据库类型选择项（`DATABASE_TYPES`）。禁止用「数据源」「链接」「联接」指代连接（术语标准 §4.1）。
- 沿用既有术语：`连接`、`连接 ID`、`连通测试`、`连通探测`、`Schema Manifest`、`启用表范围`、`Amazon Athena`。

## 证据索引

| 结论 | 证据 |
|---|---|
| UI 可选类型共 8 项 | `webui/src/lib/connectionId.ts` `DATABASE_TYPES` |
| KTX 0.16.0 连接器全集（11 个） | KTX 包 `dist/connectors/`：athena / bigquery / clickhouse / duckdb / mongodb / mysql / postgres / shared / snowflake / sqlite / sqlserver |
| StarRocks 需 live certification | `docs/specs/lucy-platform-goal-checklist.md` L120；`scripts/smoke/p1-starrocks-certification.mjs` |
| Oracle 为 roadmap candidate | `docs/specs/lucy-platform-goal-checklist.md` v0.3 / v0.4 更新说明 |
| Doris 为 R1 默认目标源 | `docs/specs/lucy-r1-controlled-data-service-plan.md`；`scripts/smoke/lucy-r1-doris-smoke.mjs` |
| SQL Server / Athena 无实机证据 | `scripts/`、`deploy/` 全目录检索零命中 |
| SQLite 为内部存储与文件型连接 | `customer-config.example/ktx.yaml` `storage.state: sqlite`；`npm run smoke:p0:demo` |
| `max_execution_time` 触发点 | KTX 0.16.0 `dist/connectors/mysql/connector.js` `query()`；`testConnection()` / `executeReadOnly()` 均走该路径 |
| 镜像补丁机制 | `scripts/runtime/patch-ktx-mysql-starrocks-compat.js`；`Dockerfile` 补丁步骤；`scripts/release/verify-ktx-starrocks-patch.cjs`（未挂门禁） |
| 对外手册与本表冲突 | `docs/user-guide/data-sources.html`「支持的数据库」表；`docs/reviews/review-help-docs-wording-and-structure.md` |
| R1 证据环境变量 | `docs/specs/starrocks-r1-support-plan.md` §4：`LUCY_R1_STARROCKS_EVIDENCE` / `LUCY_R1_DORIS_EVIDENCE` |
