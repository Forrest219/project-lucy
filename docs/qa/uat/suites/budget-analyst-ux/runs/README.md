# Runs — UAT-SUITE-BUDGET-ANALYST-UX

| 日期 | 档位 | 范围 | 结果 | 记录 |
|---|---|---|---|---|
| 2026-11-28 | lean（本机 demo Docker） | R0／01–12B＋12 并发补充臂＋勾连指针（IMC-03 未执行） | **PASS WITH FINDINGS**（F1／F2／F3 待裁定） | [2026-11-28-kscc-budget-analyst-ux](2026-11-28-kscc-budget-analyst-ux.md)（套件设计 **v1.1**；慢源标定 45s 档全链路 45.4s／oracle 569.85；身份集 15 新建零态身份＋`ba_uat_orders_count` published 绑定；PRE-01 引用 [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md) 未重抓；UAT-IMC-03 仅登记指针） |

跑次记录约定见 [`../../CONVENTIONS.md`](../../CONVENTIONS.md)；文件名 `YYYY-MM-DD-<执行方>-<范围>.md`。每次跑次须写明：

- 套件设计版本 **v1.1**（不得用 v1.0 期望判 PASS）
- 环境档位（lean／scale）
- 慢源夹具标定值
- 身份集
- PRE-01 **引用**路径（[`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)），注明未现场重抓
- 跨套件 `UAT-IMC-03` 轻／重混合臂跑次指针或同批证据
