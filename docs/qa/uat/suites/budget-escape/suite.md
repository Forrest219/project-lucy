# UAT-SUITE-BUDGET-ESCAPE — 问询预算耗尽与主路径逃生

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-BUDGET-ESCAPE` |
| 总账 ID | **P1-74**／REQ-030-095 |
| UAT 设计版本 | **v1.0（定稿）**；仅测试设计定稿，不改 Spec／Plan 的功能确权与开发授权状态 |
| 目标 | **看守第一性原理**：合法用户长问询触顶后，必须仍有可达 fallback；不得因 runaway 防火墙变成无逃生死角。同时验「拦得住」与「逃得生」。修复后及未来版本回归用 |
| 合同回链 | [问询预算主路径逃生 Spec](../../../../specs/lucy-20261122-question-budget-mainpath-escape-spec.md) SC-E1–E10（含 E9b）；互补 [`UAT-SUITE-QUESTION-BUDGET`](../question-budget/suite.md)（P1-12）；[`UAT-SUITE-BEGIN-ZERO-BINDING`](../begin-zero-binding/suite.md)（P1-60）；错题 [`2026-11-22-question-budget-exhausted-recurring`](../../../../lessons/2026-11-22-question-budget-exhausted-recurring.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做项

UAT-BESC-R0、UAT-BESC-01～12 **全部必做**。busy／idle 对照、真实 Agent 长问询和同 Token 两次 compat 不再是可永久省略的可选项；缺少任一项，套件不得记完整 PASS。

## 与 P1-12 套件分工

| 套件 | 验什么 | 不验什么 |
|---|---|---|
| `UAT-SUITE-QUESTION-BUDGET` | 默认 60／300；第 21 次不误杀；第 61 次触顶；active 下 1 次续查 | inactive 多档逃生、硬停后新问询、无 session／跨跑次恢复、真实 Agent 成交、判定分列 |
| **本套件** | 触顶拦截、续查成交、硬停后新问询、busy／idle、compat 归因、真实 Agent 与未来版本回归 | 不重复以「指导文案含 60／300」为主目标；可引用 BUDGET-01 证据 |

## 判定口径（强制）

1. **双覆盖**：只验触顶而 BESC-02／03／09 未跑或 FAIL → 不得主张 PASS，也不得以「防火墙正确」结案。
2. **成交定义**：续查／新问询后的 `lucy_query` 必须工具成功，事实行与独立数据库 oracle 一致。「没有 exhausted」「非 ACL」「进入下一窗」均不等于成交。
3. **完整生命周期**：BESC-09 必须走到续查档数耗尽、显式新问询及同 Token 再次成交；只验第一次 continue 不得 PASS。
4. **实况分列**：inactive＋无 session、inactive＋稳定 session、无 continue 授予的合法问数身份分别留证，不得互相代替。
5. **改前基线**：允许必做项按真实结果记 FAIL，作为缺陷锚点；不得改成 SKIPPED 掩盖。环境或场景未构造成功记 BLOCKED，不算产品 PASS／FAIL 证据。
6. **修复后及未来版本**：所有必做项均须 PASS；任一 FAIL 则套件 FAIL，任一 BLOCKED／NOT RUN 则不得记完整 PASS。
7. **禁止** vitest／CR／读代码／跑次手记冒充真实 MCP、compat 或 Agent 执行结果。
8. **≠** 可上线；UAT 设计定稿及登记本套件均 **≠** Spec 终稿确权或开发授权。

## 边界

- 纯 MCP／真实 Agent；不强制浏览器。
- 零绑定（begin inactive）为 demo 默认实况；BESC-07 使用 begin-zero-binding 套件的 active 夹具。
- 禁止为图快修改 `QUESTION_BUDGET_MAX_*`、使用 mock 时钟或关掉预算。
- 重签 Token、重启容器、清预算库只能用于独立环境初始化或对照，不得充当 BESC-09／11 的逃生证据。
- 跑次不得写入 Bearer／密码明文。
