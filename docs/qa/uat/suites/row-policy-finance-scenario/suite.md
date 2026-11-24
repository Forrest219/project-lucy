# UAT-SUITE-ROW-POLICY — 行级隔离场景（十几人 × 一批表）

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-ROW-POLICY` |
| 总账 ID | **P1-28**／REQ-030-049（**核心分母**） |
| 目标 | 财务／业务分析场景：至少 12 个用户对至少 2 张表按不同行范围问数；每人只看到自己的行；范围可因表而异（默认自动强制行域，见 P1-72） |
| 合同回链 | 方向 [§4.5／§9 第 5 条](../../../../plans/lucy-20261107-lucy-0-30-core-direction.md)；需求池 REQ-030-049。既有行权限 Spec **状态不动**，本套件不改它们的验收编号。委托人 2026-11-22 选解耦：ROW-07／P1-29 **不挡**本套件对核心分母的 PASS |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做（计入套件 PASS／核心分母） | 单列（不计入套件 PASS） | 可选 |
|---|---|---|
| UAT-R0、UAT-ROW-01、UAT-ROW-02、UAT-ROW-03、UAT-ROW-04、UAT-ROW-05、UAT-ROW-06、UAT-ROW-08 | UAT-ROW-07（P1-29／`GAP-UAT-P1-28-VALUE`；现行预期 FAIL） | UAT-ROW-OBS（Wiki 是否带出其他范围的数字；不计入套件 PASS） |

## 边界

- 本套件是 **0.30 核心分母** 的客户场景 UAT。判定只写在 [`INDEX.md`](../../INDEX.md)。数据用本套件在 demo 里自造的一批表，前缀 `uat_row_policy_`。**计入 PASS 的必做**全部达到期望才可写 **PASS**。ROW-07 仍须跑并记结果，但不挡套件 PASS。**≠** 可上线，**≠** 功能合同收口。
- 禁止用 vitest、强度 B 审判包、Code Review 或 [2026-11-14 评审](../../../../reviews/2026-11-14-row-policy-capability-assessment.md) 冒充本套件 PASS。
- 临时资源 id 前缀必须为 `uat-row-policy-`。测后必须清理；普通场景无需为行权限切换 proven 或重建 lucy（P1-72 起人工证明变量已忽略）。
- 跑次不得写入密码、Token 明文。
- 现行实现达不到某条期望时，跑次记 **FAIL**，不得改期望去迁就实现。改产品行为须另开 Spec 并取得开发授权。
- 配错取值在现行实现上预期 FAIL，归 `GAP-UAT-P1-28-VALUE`／P1-29。不得改期望，也不得据此阻止核心分母 PASS。
- 遗留 `LUCY_UPSTREAM_FORCED_PREDICATE_PROVEN` 兼容测试由 [UAT-SUITE-ROW-POLICY-AUTO](../row-policy-automatic-enforcement/suite.md) 承接；本套件主场景保持变量未设置。禁止 `-p lucy-ac-p1-by01`。用重启掩盖失败仍是 FAIL。
- 度量作谓词的本机拒绝归 P1-2／REQ-030-013／016，本套件不把它单列成必做。若实测在强制过滤失效时泄漏了范围外的行，UAT-ROW-05 记 FAIL。
