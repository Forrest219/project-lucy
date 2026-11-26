# 非直连外部目录（Doris / SelectDB → Hive）无分区边界查询治理 Spike 草案

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spike 草案 / v0.1-draft |
| 日期 | 2026-11-25 |
| 性质 | 前期问题核实与现场取证方案；**不是正式功能 Spec，不修改运行代码，不构成开发授权** |
| 目标范围 | 经 KTX 访问的外部目录源（典型场景：Doris / SelectDB 外部 Hive Catalog，如 `hive`、`hive_jd`） |
| 当前状态 | **待现场取证（Go / No-Go 决策前置）** |
| 相关基线 | [`docs/specs/lucy-20261030-hive-query-execution-spec.md`](../specs/lucy-20261030-hive-query-execution-spec.md)（Hive 直连分区门禁）；[`docs/reviews/2026-10-20-selectdb-hive-catalog-review.md`](2026-10-20-selectdb-hive-catalog-review.md)（SelectDB 外部目录现状）；[`docs/lessons/2026-11-13-external-catalog-column-read-ktx-describe.md`](../lessons/2026-11-13-external-catalog-column-read-ktx-describe.md)（外部目录直连探测）；[`docs/lessons/2026-11-22-question-budget-exhausted-recurring.md`](../lessons/2026-11-22-question-budget-exhausted-recurring.md)（问询预算）；[`2026-11-26-hms-thrift-handshake-evidence-review.md`](2026-11-26-hms-thrift-handshake-evidence-review.md)（客户 HMS thrift 握手失败定性与 S2 取证策略修订，含 S0 前置） |

## 1. 问题背景与核心判断

当前怀疑存在一条高损耗的故障链路：

> 口语问数（未明确时间窗）→ Agent 发出无分区边界的 `lucy_query` → KTX 转发至 Doris / SelectDB → 外推扫描 Hive 全量分区 → 撞上游硬截止 / 问询预算 / 客户端超时 → Agent 重试 → 进一步拉长耗时并挤占并发名额。

初步判断：

- **超时只是症状，不是根因**：调大超时无法加速无界分区扫描，只会让慢查询占用并发名额更久，并更容易触发客户端先断开后的惩罚占位。
- **是否必须立项开发仍属未知数**：目前缺乏客户现网关于「无分区边界导致的超时占比」「Doris 2.0.14 外部目录实际剪枝行为」「只读账号能否采集分区键」以及「软引导是否已足够止血」的一手证据。因此先通过本 Spike 完成零代码改造的现场取证，再做 Go / No-Go 决策。

## 2. 当前代码能力基线（已核实）

以下结论均基于当前仓库代码实探，不代表现网运行数据：

| 能力维度 | 现状 | 代码落点 |
|---|---|---|
| Hive 直连分区门禁 | 已实现三态分区画像（`partitioned` / `unpartitioned` / `unknown`）与编译后 AST 前缀分区谓词门禁，缺边界时 0 次 JDBC 调用；但仅针对 `hive-connections.yaml` 中的 Hive 直连（仍为 `planned`） | `webui/server/hive/partition-profile.ts`、`webui/server/hive/partition-gate.ts`、`webui/server/hive/proxy-hook.ts` |
| 非直连（KTX / Doris）前置护栏 | Doris / SelectDB 外部目录走 `passthrough_ktx` → `forwardToKtxWithSession` → KTX `sl_query`；前置护栏仅校验聚合嵌套、`count(*)` 无 source、字段歧义与别名，**无任何分区边界检查** | `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/query-guardrails.ts` |
| 超时、预算与并发护栏 | `UPSTREAM_TIMEOUT_MS = 30s`（socket 空闲）、`UPSTREAM_HARD_DEADLINE_MS = 90s`（单次上游硬截止）、`QUESTION_BUDGET_ABS_EXEC_MS = 120s`（单次记账封顶）、问询预算 `300s / 60 次`、`LUCY_QUERY_MAX_INFLIGHT = 4`；客户端断开或超时后因取消未获库侧确认，名额额外保留 `CANCEL_UNCONFIRMED_HOLD_MS = 30s` | `webui/server/proxy/mcp-proxy.ts`、`webui/server/proxy/question-experience.ts` |
| 外部目录元数据采集 | 直连探测白名单仅放行 `SHOW DATABASES` / `SHOW TABLES` / `DESC` / `SHOW COLUMNS` / `DESCRIBE`，且仅映射前 4 列（列名、类型、可空、主键），**不采集分区键** | `webui/server/catalog-show.ts`、`webui/server/schema-structure.ts` |
| 语义资产与发现面暴露 | `semantic-layer.ts` 与 `lucy_query` 已支持 `segments`，但 `TableModel` 与 Manifest 无 `partitionStatus` / `partitionKeys`；`lucy_catalog` 仅暴露 `description` 与 `grain`，**不暴露分区键与 `segments`** | `webui/server/model.ts`、`webui/server/semantic-layer.ts`、`webui/server/proxy/source-descriptions.ts` |
| 运行时问数指引 | `data-qa-instructions.md` 的「先问再查」仅覆盖指代、双意图与多表歧义，**未包含「分区表/大事实表缺时间窗先澄清」**；且简单事实题规则鼓励最短路径直接发 `lucy_query` | `webui/config/data-qa-instructions.md`、`webui/server/proxy/mcp-proxy.ts` |

## 3. 待验证假设（H1–H4）

| 编号 | 假设内容 | 决定什么 |
|---|---|---|
| **H1（痛点占比）** | 现网外部目录 `lucy_query` 的超时与慢查询（> 5s 或撞 90s 硬截止）中，**无分区边界扫描**是主要成因（如占比 ≥ 30%），而非主要由多表 JOIN、集群队列拥堵或剪枝失效引起 | 决定「是否值得为非直连分区门禁立项」 |
| **H2（Doris 剪枝行为）** | 客户现网 **Doris 2.0.14** 对外部 Hive Catalog（`hive` / `hive_jd`）上的分区表，不仅支持常量等值/闭区间剪枝，也能对相对时间 `segment`（如 `dt >= date_sub(curdate(), 7)`）稳定触发 Hive 分区剪枝，且明确 `STRING` 与 `DATE` 类型分区键的边界行为 | 决定「常用时间窗做成 `segment`」是否成立，以及硬门禁对 `segment` 的放行口径 |
| **H3（元数据采集）** | 客户现网给 Lucy 配置的只读账号，能够通过只读语句（如 `SHOW CREATE TABLE`、`SHOW PARTITIONS` 或扩展 `DESC`）稳定识别外部目录表是否为分区表并提取有序分区键 | 决定分区元数据是「自动采集」还是「治理方手工/半自动登记」 |
| **H4（软约束有效率）** | 仅靠在高频大表上补齐业务说明、常用时间窗 `segment` 及「缺时间窗先问人」指引，是否已能将无分区边界调用压低到可接受水平，还是 Agent 仍会高频漏带条件 | 决定是否必须投入「执行前硬门禁（杠杆 1）」 |

## 4. 现场零改造取证方案（S1–S4）

所有步骤均为只读或对照观测，不修改 Lucy 运行代码、不改动 KTX、不触发写操作。

### S1：审计日志与慢/超时查询归因（验证 H1）

- **取样范围**：抽取最近 7–14 天内面向外部目录连接的 `lucy_query` 记录（重点筛选 `outcome = 'error'` 且含 `timeout` / `source_timeout`、`outcome = 'budget_stop'`、或 `duration_ms >= 5000` 的记录）。
- **人工/脚本归类维度**（每条样本只归主因）：
  1. **无分区过滤**：`generated_sql` / `filters` 完全不含分区键条件（含仅带 `LIMIT` 或仅带非分区维度过滤）。
  2. **带了时间条件但未命中剪枝**：例如对分区键套函数（`DATE_FORMAT(dt, ...)`）、类型不匹配、或单侧开区间。
  3. **非分区成因**：已带窄分区条件但仍慢（大表 JOIN、复杂聚合、Doris 集群拥堵、并发槽耗尽连带超时）。
- **产出物**：样本总数、三类占比、Top 5 高频超时外部目录表及分区键形态（列名、类型、层级数）。

### S2：Doris 2.0.14 外部 Hive Catalog 分区剪枝 `EXPLAIN` 对照（验证 H2）

在客户 SelectDB / Doris 2.0.14 上，选取 1–2 张 S1 中出现的高频 Hive 分区表（如单级 `dt` 与多级 `dt, region`），**只跑 `EXPLAIN`，不执行实际扫表**，观察执行计划中 `HiveScanNode` 的 `partition=` 裁剪结果（例如 `partitions=1/365` vs `partitions=365/365`）：

```sql
-- 1. 基线：无分区过滤（确认全分区数）
EXPLAIN SELECT COUNT(*) FROM `hive`.`<db>`.`<table>`;

-- 2. 常量等值（按实际分区键类型：STRING 或 DATE）
EXPLAIN SELECT COUNT(*) FROM `hive`.`<db>`.`<table>`
WHERE dt = '2026-11-24';

-- 3. 常量闭区间
EXPLAIN SELECT COUNT(*) FROM `hive`.`<db>`.`<table>`
WHERE dt >= '2026-11-18' AND dt <= '2026-11-24';

-- 4. 相对时间表达式（验证「近 7 天」segment 能否被 Doris 2.0.14 常量折叠并剪枝）
EXPLAIN SELECT COUNT(*) FROM `hive`.`<db>`.`<table>`
WHERE dt >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL 7 DAY), '%Y-%m-%d');

-- 5. 常见误写对照（对分区键套函数或类型混用，确认是否退化为全分区扫）
EXPLAIN SELECT COUNT(*) FROM `hive`.`<db>`.`<table>`
WHERE LEFT(dt, 7) = '2026-11';
```

- **记录要点**：每种写法下 `EXPLAIN` 展示的扫描分区数；明确 `STRING` 分区键使用 `DATE_SUB` / `CURDATE()` 时是否需要 `DATE_FORMAT` 才会触发剪枝。

### S3：只读账号分区元数据探测验证（验证 H3）

使用客户现网配置给 Lucy 的同一只读账号，在同一张外部目录分区表和一张非分区表上依次执行以下只读语句：

```sql
SHOW CREATE TABLE `hive`.`<db>`.`<table>`;
SHOW PARTITIONS FROM `hive`.`<db>`.`<table>`;
DESC `hive`.`<db>`.`<table>` ALL;
```

- **记录要点**：
  - 每条语句是否被权限放行、耗时多少；
  - `SHOW CREATE TABLE` 是否明确包含 `PARTITIONED BY (...)`（且能稳定区分分区表与非分区表）；
  - 当表有数千个历史分区时，`SHOW PARTITIONS` 是否存在耗时过长或触发行数上限的风险。

### S4：软引导小样本对照（验证 H4，可选但强烈建议）

- 选取 S1 中的 2–3 张典型大分区表，在不改代码的前提下，使用测试用口语问询集（10–15 题：含「未指定时间窗」「近 7 天」「本月」「指定日期」「全量趋势」等）观察：
  - 当前默认状态下，无分区边界 `lucy_query` 的触发次数与超时率；
  - 仅在表描述/示例/测试提示中显式标注分区键和「缺时间窗先澄清」后，无界调用率下降到多少、是否仍有模型绕过或遗漏。

## 5. 候选方案与已识别的设计红线（供 Go 决策参考）

若取证确认需要推进，候选能力按杠杆分为四层，且须提前守住三条设计红线：

1. **执行前有界（产品硬能力）**：对已显式登记为分区表的非直连源，在 Proxy 转发 KTX 前校验 `filters`、展开后的 `segments` 与行策略 `forcedFilters`；缺分区前缀有界条件时 0 次上游调用，返回含分区键名与可用时间窗 `segments` 的可行动错误。
2. **资产与发现面暴露**：Manifest / Overlay 支持 `partitionKeys` 登记；常用时间窗做成 `segment`；`lucy_catalog` / `lucy_read_source` 暴露分区状态、分区键与推荐时间窗 `segments`。
3. **缺范围先问人**：在 `data-qa-instructions.md` 中补充「对已标明分区键的大表，用户未给时间窗时先澄清一次再发 `lucy_query`」，不波及非分区小表。
4. **超时只做护栏**：保持现有 90s 硬截止与 300s 预算防拖死平面，不靠抬高超时治标；超时回执中若命中未带分区过滤的外部目录表，补充可行动提示抑制盲重试。

**三条设计红线（避免正式立项时返工）**：

- **红线 1 — 主路径可用性优先**：存量外部目录表禁止照搬 Hive 直连对 `unknown` 一刀切拒查的做法；未登记分区状态的存量表默认放行，仅对已显式标记为 `partitioned` 的表执行硬拦截。
- **红线 2 — 门禁与动态时间窗 `segment` 一致**：Hive 直连 `partition-gate.ts` 当前仅认常量字面量；非直连门禁若与「近 7 天／本月」`segment` 联动，必须将**受治理且经 S2 验证可剪枝的时间窗 `segment`**纳入合法边界，避免建议 1 误拦建议 2。
- **红线 3 — KTX 依赖边界**：全程不修改 KTX 源码，参数层门禁、资产暴露与直连元数据探测均在 Lucy 侧完成。

## 6. 受影响用户画像预评估

依据 [`docs/governance/user-personas.md`](../governance/user-personas.md) 预评估（若后续进入正式 Spec，须转为正式验收项）：

| 画像 | 预期影响 | 说明与补偿路径 |
|---|---|---|
| 问数方 | `↑`（局部 `↓` 风险） | 减少 90s 干等与预算耗尽；风险是无界问法被拒绝或先反问一次 → **补偿**：拒绝报文必须带出分区键名、格式示例和可用时间窗 `segment`，让 Agent 一轮内可修正或引导用户确认 |
| 治理方 | `↓` 风险 | 若 S3 证明无法自动采集分区键，全靠手工登记会增加维护负担 → **补偿**：仅要求对高频大分区表登记，不强制全库补齐；若 S3 可行则优先自动采集 |
| 运维方 | `↑` | 阻断无界全分区扫描进入执行面，显著降低 90s 硬截止＋30s 取消未确认占位把 `LUCY_QUERY_MAX_INFLIGHT = 4` 打满的概率 |
| 管理层 | `＝` / `↑` | 降低慢查询与超时失败率，审计侧可将「缺分区边界」与「引擎超时」明确区分归因 |

## 7. Go / No-Go 决策矩阵

现场完成 S1–S4 后，按以下门槛收口：

| 取证结果组合 | 决策结论 | 下一步动作 |
|---|---|---|
| **H1 证伪**：无分区边界导致的超时占比低（如 < 10%），慢查询主因是 JOIN / 集群拥堵 / 其他 | **No-Go（暂不立项硬门禁）** | 归档本 Spike，转向真实瓶颈（如模型优化或集群侧治理），不引入分区门禁复杂度 |
| **H1 成立，且 H4 显示软约束已拦住 ≥ 85% 无界调用** | **轻量止血（仅做建议 2 + 3）** | 仅补充指引、业务说明与常用时间窗 `segment` 规范，暂不开 Proxy 硬门禁 Spec |
| **H1 成立，且 H4 显示 Agent 仍高频发无界查询；H3 不可自动采集** | **Go — 最小闭环（分期一）** | 入总账开正式 Spec：Manifest 手工/半自动登记 `partitionKeys` + `lucy_catalog` 暴露 + Proxy 参数层硬门禁（含受治理 `segment` 白名单）+ 指引更新 |
| **H1 成立，H4 需硬门禁，且 H3 可通过只读语句稳定采集** | **Go — 完整闭环（分期一＋自动采集）** | 在最小闭环基础上，同步扩展 `catalog-show.ts` / `schema-structure.ts` 自动采集外部目录分区键 |

补充分支：若 **H2 证伪**（Doris 2.0.14 对相对时间函数 `segment` 无法触发 Hive 分区剪枝），则所有 Go 路径均不得推广相对时间函数 `segment`，改为由 Agent 基于当前业务日期生成**显式常量日期闭区间**（如 `dt >= 'YYYY-MM-DD' AND dt <= 'YYYY-MM-DD'`）。

## 8. 现场取证记录表（待回填）

> 现场执行 S1–S4 后直接在此表回填客观数据与截图/日志指针，再触发 Go / No-Go 评审。

| 项目 | 验证内容 | 实测结果（待填） | 证据指针（日志 / EXPLAIN 输出） |
|---|---|---|---|
| 环境基线 | 客户 Doris / SelectDB 版本、外部 Catalog 名、Lucy 版本 | | |
| S1 审计归因 | 样本时间窗、总超时/慢查询数、无分区过滤占比、Top 表 | | |
| S2 剪枝对照 | 常量等值 / 常量闭区间 / 相对时间函数 / 误写对照的 `partitions=` 结果 | | |
| S3 元数据探测 | `SHOW CREATE TABLE` / `SHOW PARTITIONS` / `DESC ALL` 权限、耗时、输出样本 | | |
| S4 软引导对照 | 对照题数、默认无界触发率 vs 补指引后无界触发率 | | |
| **最终决策** | `No-Go` / `轻量止血` / `Go 最小闭环` / `Go 完整闭环` | | |
