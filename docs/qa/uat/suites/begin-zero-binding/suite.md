# UAT-SUITE-BEGIN-ZERO-BINDING — 零绑定隐藏 begin 不影响正常问数

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-BEGIN-ZERO-BINDING` |
| 版本 / 状态 | v0.5；配对 Spec／Plan v0.7 终稿＋T1–T5 开发授权；R／T6 另授；NOT RUN，尚无跑次 |
| 总账 / 需求 | P1-60／REQ-030-081；P0 主路径修复 |
| 合同 / 计划 | [Spec](../../../../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)；[Plan](../../../../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| 目标 | 纯 MCP 在 inactive 下看不到／不调用 begin 即可问数；合法强制 call 无副作用且不挡 query；现行权限、预算、continue 和真实强制快照不变 |
| 环境 | 隔离本机 Docker 单实例单副本；真实 Lucy／KTX／数据库／普通 MCP Token；R 含 RC1 真实 Agent |
| 入口 | [cases.md](cases.md)；[fixtures.md](fixtures.md)；[runs/](runs/) |
| 判定真源 | [INDEX](../../INDEX.md)，文档齐不等于通过；本轮未构建、未造数、未测试 |
| 修订依据 | [首轮决议](../../../../reviews/2026-11-19-begin-zero-binding-review-decisions.md)、[隐藏决议](../../../../reviews/2026-11-20-begin-hide-decision.md)、[新定位复审](../../../../../inbox/20261120-kimi-begin-hidden-positioning-review.md)；Spec／Plan **v0.7 终稿＋T1–T5 授权**；T6 另授 |
| 复盘 | [测试漏检](../../../../lessons/2026-11-19-begin-zero-binding-test-gap.md) |

## 选择器与范围

| 选择器 | 用途 | 证据 |
|---|---|---|
| F | 模块功能合同 SC-01–12；非 UAT 局部自动化映射 | 真协议、本地实际状态、发布交错、局部恢复与函数调用计数；不以替身称全真查数 |
| R | 本 suite 的 Docker／真实 Agent 组合旅程与系统恢复 | UAT-ZB-R0、01–12 全部必做；逐请求／响应与数据库 oracle；不以 F 绿代替 |

R 在修复候选准备主张用户路径恢复时执行，负责人为候选 UAT 执行者。当前只获文档修订授权；F／R 均未运行。绑定正反例是防绕过必做项，不列为可选 Wave B。

## 总判定

- inactive 必须验 list／指导无 begin、N 成交；合法强制 call 返回 begin_not_available、无副作用且 query 仍成交。
- 产品可达却因隐藏失败、注册表门禁或人工补凭据才成交为 FAIL，不记 BLOCKED 前置。
- 缺凭据／真实数据／控制条件／真实客户端或性能容差为对应 BLOCKED，不用 mock 补绿。
- 全部必做达到期望才能 PASS；无“仅健康 happy path 通过即 PASS WITH GAP”的出口。
- 不改旧套件历史；失败进入独立 P0 跟进和当前跑次。预算／ACL 不改，continue 不得联合隐藏。

## 证据槽

正式跑次文件名 `runs/YYYY-MM-DD-<agent>-<candidate>-<selector>.md`。记录候选身份、夹具与内容根指纹、现有注册表凭据／bindings／BindingSession、每个会话强制历史、预算 round／window／calls／busyMs／续查、逐请求 isError／reason／trace、实际行与 SQL oracle、显式／推断／缺失审计、耗时与工具调用数、恢复和清理结果。

原始必要响应保存在正式跑次配套脱敏附件，临时大文件可放 inbox 但不能成为唯一证据。禁止 Token、Cookie、认证头、客户原文或配置密钥入库。范围以 [fixtures M01–M10](fixtures.md#统一路径与覆盖矩阵)为准；RC1 固定为修复前既有 Codex CLI 0.165.0，版本核对不是兼容运行证据。P3／P4 补偿任务见 ZB-08，未证成的下降保留。

当前 runs 只有 README，无执行记录。
