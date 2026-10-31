# Lucy Hive 问数（执行侧）实施 Plan

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 实施计划 / v0.3-wave-a |
| 日期 | 2026-10-30；2026-10-31 收窄为仅本模块；Wave A 落地 |
| 功能编号 | L25-10（执行波） |
| 状态 | **本模块 Wave A 已完成（审查→M1–M5）**。客户环境／旅程／交付／矩阵不在本 Plan todo |
| 授权边界 | 本 Plan 只跟踪**功能合同**实现。不授权客户 HS2 组合认证、整库 Agent 旅程、离线 amd64、升级恢复、支持矩阵晋级。那些归 [E2E Spec](../specs/lucy-20261025-v0p25-e2e-mainline-and-branch-optimization-spec.md) 的 `HIV25`／`LIFECYCLE` |
| 验收 | Spec §7 本模块出口 HQ-01–HQ-15、HQ-17，及 HQ-16／HQ-18 的合成夹具维；不得用 `HIV25` 通过冒充本条收口 |
| 配对 Spec | [lucy-20261030-hive-query-execution-spec.md](../specs/lucy-20261030-hive-query-execution-spec.md) |
| 上游 | 编译侧已收口 Spec；2026-10-31 用户批准「只留本模块 todo」并批准完成本模块 Wave A 与 commit |

---

## 1. 目标

本模块：经 Lucy MCP，在**分区边界成立**时对 Hive 完成只读语义问数；缺边界／`unknown`／未就绪时失败关闭。

不在本 Plan：客户匹配环境、多客户端旅程、交付与矩阵晋级（见 §4）。

## 2. 开工前置

1. Spec 需求审查通过（HQ-D1–HQ-D12，尤其 HQ-D5）。✅
2. 编译侧库可复用（`webui/server/hive/*`；V01／V02／V06 绿）。✅
3. 不改 KTX；不写 `driver: hive` 进 `ktx.yaml`。✅
4. Wave A 可用**合成**多级分区夹具（本地／CI）；**不**以客户 HS2 到位为开工前置。✅
5. `mcp-proxy.ts` 分流钩子已落地（单点 divert）。✅

## 3. 本模块 todo（仅此表）

| ID | 内容 | 依赖 | 状态 |
|---|---|---|---|
| T0 | Spec／Plan／术语／索引 | — | **完成** |
| **审查** | 需求审查冻结 HQ-D（尤其 HQ-D5） | T0 | **完成** |
| M1 | 元数据＋分区画像（三态、有序分区键、Manifest 可消费） | 审查通过 | **完成** |
| M2 | 分区谓词门禁（AST、前缀规则、拒绝码；HQ-03–HQ-10） | 审查通过；可与 M1 并行 | **完成** |
| M3 | JDBC worker 契约（execute／fetch／cancel／close；凭据隔离；类型保真） | 审查通过；合成夹具即可 | **完成** |
| M4 | MCP／发现分流（`lucy_query`／explain／catalog／read） | M1–M3 | **完成** |
| M5 | 本模块 HQ 验收（合成夹具 + 单测／协议测） | M4 | **完成** |

### 3.1 Wave A 顺序

```text
审查 → M1 分区画像 → M2 门禁 → M3 JDBC 契约 → M4 MCP 分流 → M5 HQ 验收
```

落地路径（摘要）：

- `webui/server/hive/partition-profile.ts` / `partition-gate.ts` / `jdbc-worker.ts` / `execution.ts` / `mcp-bridge.ts` / `proxy-hook.ts`
- `webui/server/proxy/mcp-proxy.ts`：ACL 后单点 Hive divert（非 Hive 仍走 KTX）
- `webui/server/__tests__/hq-hive-execution.test.ts`：HQ-01–HQ-18 合成维

## 4. 已拆到 E2E（本 Plan 不跟踪）

下列原 T1／T6 UI／T7 深故障／T9 及客户维，由 E2E Spec 的 `HIV25`（及适用时 `LIFECYCLE`）持有：

| 原编号 | 内容 | E2E 归属 |
|---|---|---|
| （原 T1） | 客户匹配 HS2／认证／TLS／JRE 全组合 | `HIV25` 环境／交付维 |
| （原 T6 UI） | 连接 Drawer、分区画像治理台呈现 | 另开 UI 变更或 `HIV25` 发现旅程；不挡本模块 MCP 闭环 |
| （原 T7） | 系统级断连／worker 崩溃／跨模块审计演练 | `HIV25`；本模块只保留局部 cancel／审计区分（HQ-16／HQ-17） |
| （原 T8 客户维） | 真实 Agent 多轮旅程、客户集群 oracle | `HIV25` |
| （原 T9） | 支持矩阵晋级 | 支持矩阵另批；`HIV25` 可引用证据 |
| — | 升级／备份恢复 | `LIFECYCLE`（`UPG25`／`RVC25`） |

`HIV25` 可引用本模块 HQ 通过结果作功能证据，**不得**把本模块收口写成客户交付通过。

## 5. 验收

- 本模块出口：HQ-01–HQ-15、HQ-17；HQ-16／HQ-18 的**合成夹具**维 → 见 `hq-hive-execution.test.ts`（pass）。
- 结果只允许 `pass / fail`。不得用客户环境缺失把本模块出口记成通过。
- `HIV25-*` 状态不写入本 Plan 完成定义。

## 6. 完成定义

### 6.1 T0（已完成）

- [x] Spec／Plan／术语／索引／登记
- [x] 2026-10-31：todo 收窄为仅本模块；E2E 项移出本 Plan

### 6.2 Wave A（本模块）

- [x] 需求审查通过
- [x] M1–M5 完成
- [x] HQ-01–HQ-15、HQ-17 与 HQ-16／HQ-18 合成维为 `pass`（`hq-hive-execution.test.ts`）
- [x] 缺分区边界时 JDBC 调用次数为 0
- [x] 合成分区夹具上查询结果与独立 oracle 一致

### 6.3 不视为本模块完成

- 仅编译成功、仅配置 API、仅手工 Beeline
- 客户组合认证、矩阵晋级、升级 E2E 通过

## 7. 风险（本模块）

| 风险 | 处置 |
|---|---|
| HQ-D5 与真实剪枝理解不一致 | 审查冻结；跳级／单侧开区间单测 |
| `mcp-proxy.ts` 并发 | 单点 divert 钩子；逻辑在 `hive/proxy-hook.ts` |
| `LIMIT` 被当成成本边界 | HQ-D4；HQ-04 |
| 窗口 `PARTITION BY` 冒充表分区 | HQ-D6；HQ-09 |
| 误把 E2E 当本模块出口 | §4；完成定义不含 `HIV25` |

## 8. 默认冻结（审查已确认）

- **HQ-D5**：有界前缀；零约束拒绝；跳级拒绝。
- **三态**：`partitioned`／`unpartitioned`／`unknown`；`unknown` 默认拒绝问数。
