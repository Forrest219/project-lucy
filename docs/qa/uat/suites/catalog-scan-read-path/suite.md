# UAT-SUITE-CATALOG-SCAN — 库内扫表读法

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-CATALOG-SCAN` |
| 总账 ID | **P1-16**／REQ-030-037；**P1-20**／REQ-030-041（续作，同套件） |
| 目标 | 证明普通 MySQL 宽库「准备表结构」走 Schema 宽一次 columns；外部目录列库／列表由替身和可选 live 覆盖，P1-20 单表字段另用真实 Doris／Hive lab 验证；错误无密码泄漏 |
| 合同回链 | [P1-16 Spec](../../../../specs/lucy-20261111-catalog-scan-read-path-spec.md) SC-01–SC-14（字段侧 SC-10 由 P1-20 取代）；[P1-20 Spec](../../../../specs/lucy-20261113-external-catalog-column-read-spec.md) EC-01–EC-13；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 本机模拟策略

| 场景 | 做法 |
|---|---|
| 宽 Schema（客户 `tblu`／多表超时类） | `scripts/uat/seed-catalog-scan-fixtures.sh` 在 `demo-db` 生成 `uat_wide_scan`（默认 200 表×5 列） |
| 外部目录 `SHOW`／单表字段（客户 SelectDB／Hive） | 合同守卫：`UAT-SCAN-SIM` ＋ `UAT-SCAN-KTX-GUARD`。产品侧场景：本机真实 Doris／Hive 双目录 lab 跑 EXT-03-DUAL（含 EXT-03 单路断言）和 EXT-05；EXT-01／02／04 按可选覆盖记录。 |

demo 默认连接无 `hive.*` 形态，**不得**把「只测了 demo-mysql」或「只跑了 vitest」写成外部目录 live PASS。

## 主张规则（P1-20）

P1-20 **单独记状态**，不借 P1-16 的「PASS WITH GAP」。同一套件两份合同，状态各写各的。产品侧按 [DEVELOPMENT.md「产品侧修复收口」](../../../../governance/DEVELOPMENT.md#产品侧修复收口) 判定。指定客户生产 SelectDB 兼容性归发布取证或客户交付。

| 条件 | 可主张 |
|---|---|
| `UAT-SCAN-SIM` 全绿（含 EC→用例名对照逐行出现） | EC 替身合同；≠ 客户 SelectDB live |
| `UAT-SCAN-SIM` ＋ `UAT-SCAN-KTX-GUARD` 都 PASS | 替身与真实 KTX 拒绝行为一致；可主张「替身合同有效」；仍 ≠ live |
| `KTX-GUARD` 退出码 1 | 替身前提失效：SIM 的 PASS 不再可信，P1-20 记 **FAIL** |
| `KTX-GUARD` 退出码 2 | `BLOCKED`；SIM 的「替身有效」不可主张 |
| EXT-03 live 真跑通（含跑前自检、跑次记录构建标识） | 「P1-20 现场／lab 单表字段 live PASS」；仍 ≠ 可上线 |
| EXT-03-DUAL 两路（plain Hive ＋ `hive_jd`）都 PASS | 「客户同形双目录对照 lab／现场 PASS」；可关闭「只测了一路」缺口；仍 ≠ 客户生产 live（除非连接的就是客户 FE） |
| EXT-03／05／03-DUAL live 跑了但失败 | P1-20 **FAIL**；按判定表回流 |
| 本机 lab 必做场景无法全真执行 | 对应用例记 `BLOCKED` 并写明前置，替身或人工检查不可充当 live PASS |
| 明确要求验收客户生产 SelectDB 兼容性 | 在指定客户环境执行 EXT-03／04／05，记录目标及实际结论 |
| 可选 EXT-04 无中文表夹具 | `SKIPPED`，不影响 EXT-03／03-DUAL 判定 |

跑次元数据：每个 live 跑次必须记 `git rev-parse HEAD`、工作区是否脏、容器构建标识、容器内源码自检结果（见 `cases.md`「跑前统一前置」）。
