# UAT-SUITE-TRACE-LEDGER — 调用流水 trace 级可追溯与存档

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-TRACE-LEDGER` |
| 总账 ID | **P1-36**／REQ-030-057（主合同）；伴生 v0.25 审计增量（S01／S03／S05／S06）、P1-32／P1-33（导出规模与等价守卫） |
| 目标 | 证明：每条已落库的调用流水行（含协议请求、wiki、被拒调用；审计写入健康时即每条请求）都带调用链路 ID 并能还原阶段记录；调用流水行与阶段记录同事务；封存包带阶段记录文件且与库对账；协议与 wiki 的主状态不再大面积 `unknown`；审计库不存内网地址与存储路径；热路径开销在门槛内。**合法用户的主路径（`lucy_query`、`initialize`）不因记录能力而变慢或失败** |
| 合同回链 | Spec [`lucy-20261116-trace-span-ledger-spec.md`](../../../../specs/lucy-20261116-trace-span-ledger-spec.md)（P1-36）；基准 [v0.25 审计增量 Spec](../../../../specs/lucy-20261020-v2p5-audit-increment-spec.md)；等价守卫 [`UAT-SUITE-EQUIV-GUARD`](../audit-scale-equivalence-guard/suite.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-TRC-01～UAT-TRC-11 | —（UAT-TRC-11 容量对应 Spec SC-11，必做；未跑或 O6 预算未冻结，套件不得写整体 PASS） |

## 状态说明

- 本套件**先于实现登记**（2026-11-16）：INDEX＝**NOT RUN**。实现获得授权前，不得写任何 PASS／FAIL 现值。
- 实现授权后第一步是**改前基线跑次**（Plan 步骤 0）：预期 `UAT-TRC-01／06／07` FAIL（协议行无 `trace_id`、`unknown` 占比高、`error_detail` 含内网地址），基线值入 `runs/`。该跑次的 FAIL 是合法基线，不是缺陷。

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| 改动 `access_trace_span` 写入、`writeLog`、阶段埋点或导出 v2 | UAT-TRC-01／02／03／05；同跑 `UAT-SUITE-EQUIV-GUARD` UAT-EQ-01／02 |
| 每个 `0.30` 候选构建 | UAT-TRC-01～11；UAT-TRC-09 的基线对比 |
| 新增阶段或改白名单 | 先改 Spec（D6），再改用例 02 的期望 |

## 边界

- 本套件是**本机 demo Docker 全真**复现，**≠** 客户现场验证，**≠** 功能合同收口，**≠** 可上线。
- UAT-TRC-03 的故障注入允许在 demo 审计库里临时建触发器；**必须在用例结束时清理**，不得遗留。
- 真实流量触发不了的分支（如 span 超过 32 的 `truncated` 汇总）与 `hdfs://` 路径脱敏只由 vitest 契约覆盖，**不写进 UAT PASS**；其余做不到全真的子项按 BLOCKED 停表，另请委托人授权降级，不得用 mock 凑绿。
- **夹具就绪门禁**：混合流量脚本（含发送清单）、规模夹具扩容脚本等由 Plan 步骤 0 交付；任一夹具未 dry-run 通过时，依赖它的用例记 **NOT READY**，不得写基线结果或 PASS／FAIL 现值；O6 容量预算未冻结前 UAT-TRC-11 同样 NOT READY。
- 第 2、3 层（防篡改、外送）不在本套件；不得在跑次里暗示已覆盖。
- 禁止用 vitest／CR／读代码冒充本套件 PASS。跑次不得写入 Bearer／密码明文。
