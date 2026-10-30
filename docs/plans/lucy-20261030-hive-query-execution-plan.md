# Lucy Hive 问数（执行侧）实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.1-draft |
| 日期 | 2026-10-30 |
| 功能编号 | L25-10（执行波） |
| 状态 | **T0 已落盘；T1 及以后未授权实现**。配对 Spec 待需求审查 |
| 授权边界 | 本 Plan 授权编写与修订 Spec／Plan／术语／索引；**不**授权 JDBC worker、MCP 分流、镜像构建、客户环境改动、支持矩阵晋级或 git 发布。Wave A 代码须在 Spec 需求审查通过后另批 |
| 验收 | Spec §7 HQ-01–HQ-18；本 Plan §4。缺客户 HS2 时相关项记 `blocked_environment`，不得计通过 |
| 配对 Spec | [lucy-20261030-hive-query-execution-spec.md](../specs/lucy-20261030-hive-query-execution-spec.md) |
| 上游 | 编译侧已收口 Spec；实施方案 `2026-10-20-hive-direct-connection-implementation-plan.md` |

---

## 1. 目标

让外部 Agent 经 Lucy MCP 对 HiveServer2 **在分区边界成立时**完成只读语义问数；分区未知或缺失分区边界时失败关闭。不把 Hive 写成 MySQL 扫表模型。

## 2. 开工前置

1. Spec 需求审查通过（HQ-D1–HQ-D12 冻结，尤其 HQ-D5 有界前缀）。
2. 编译侧库可复用（`webui/server/hive/*` 已存在且 V01／V02／V06 单测绿）。
3. 不改 KTX 源码；不写 `driver: hive` 进 `ktx.yaml`。
4. Wave A 开工前具备：隔离 HS2 或明确 `blocked_environment` 范围；只读账号与 setup 种数账号分离。
5. `mcp-proxy.ts` 等并发修改文件：分流变更前确认文件归属无冲突，或走隔离分支。

## 3. 工作波次（对应已批准 Task）

| 波次 | Task | 内容 | 依赖 | 本轮授权？ |
|---|---|---|---|---|
| T0 | 合同 | Spec／Plan／术语／索引 | — | **是（本文件）** |
| T1 | 环境 | HS2／认证／TLS／JDBC／JRE；多级分区样例 | T0 审查通过 | 否 |
| T2 | JDBC worker | test／execute／fetch／cancel／close；凭据隔离；类型保真 | T1 | 否 |
| T3 | 元数据＋分区画像 | 三态状态、有序分区键、Manifest 可消费 | T2 | 否 |
| T4 | 分区门禁 | AST 证明；前缀规则；拒绝码；单测 HQ-03–HQ-10 | T0＋编译侧库；可与 T2／T3 部分并行 | 否 |
| T5 | MCP／发现 | `lucy_query`／explain／catalog／read 分流 | T2–T4 | 否 |
| T6 | 资产可发现性 | 分区键进 catalog／发布校验；（可选）管理台 | T3／T5 | 否 |
| T7 | 治理与故障 | 取消、审计区分、预算接线深测 | T5 | 否 |
| T8 | 夹具与 HQ 验收 | 固定分区 oracle；HQ-01–HQ-18 | T5+ | 否 |
| T9 | 支持矩阵 | 仅指定组合另行申请晋级 | T8＋客户证据 | 否 |

### 3.1 Wave A（最小可问数，审查通过后另批）

T1 → T2 → T3 → T4 → T5 → T8（HQ 核心子集：HQ-01–HQ-12、HQ-17、HQ-18）。

Wave B：T6／T7 与剩余 HQ。  
Wave C：T9。

## 4. 验收

- 功能合同出口：Spec §7 HQ-01–HQ-18。
- 发布取证：`HIV25-*` 仍由 E2E Spec 持有；本 Plan 不把 `HIV25` 标为通过。
- 支持矩阵：保持 `planned`，除非 T9 另批。

## 5. 完成定义

### 5.1 T0（本波）完成

- [x] Spec 落盘且含闭口层级、伪代码、HQ-D、HQ-01–HQ-18
- [x] Plan 落盘且含目标／开工前置／验收／完成定义／风险
- [x] 术语标准补 Hive 表分区相关词
- [x] `docs/README.md` 与 `docs/plans/README.md` 索引
- [x] 建议书／概览登记「执行波合同草案」
- [x] `npm run lint:spec-docs` 对本 Spec／Plan 无命中（全库 exit 1 来自无关在途文档，不属本条）

### 5.2 Wave A 完成（未来）

- HQ-01–HQ-12、HQ-17、HQ-18 有自动化或夹具证据为 `pass`，或明示 `blocked_environment` 且未计入收口。
- Agent 经 MCP 对分区夹具查出与独立 oracle 一致的结果。
- 缺分区边界的请求 JDBC 调用次数为 0。

### 5.3 不视为完成

- 仅编译成功、仅管理 API 能写连接、仅参考环境手工 Beeline。
- 支持矩阵改为 `verified`／`gated` 但无 T9 证据。

## 6. 风险

| 风险 | 影响 | 处置 |
|---|---|---|
| 客户无 HS2／分区样例 | Wave A 执行维 blocked | 门禁与分流单测仍可做；执行项如实 blocked |
| 分区剪枝与 AST「有界」定义不一致 | 门禁过宽或过严 | HQ-D5／§2.1 冻结；跳级与单侧开区间单测锁住 |
| `mcp-proxy.ts` 并发修改 | 分流难合入 | 隔离分支或等归属空闲；只改一处钩子 |
| 把 `LIMIT` 当成本边界 | 全分区扫描 | HQ-D4；HQ-04 必测 |
| 编译侧 Spec 被误重开 | 合同混乱 | 本 Plan 明确只引用、不改其出口 |
| 窗口 `PARTITION BY` 误当表分区 | 门禁被绕过 | HQ-D6；HQ-09 |

## 7. 默认冻结（T0 已写入 Spec，审查可改）

- **HQ-D5 有界前缀**：多级分区允许只约束从最左键起的连续前缀；零约束拒绝；跳级拒绝。
- **三态**：`partitioned`／`unpartitioned`／`unknown`；`unknown` 默认拒绝问数。

若审查改裁，先改 Spec 再开工 Wave A。
