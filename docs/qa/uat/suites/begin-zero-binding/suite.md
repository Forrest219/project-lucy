# UAT-SUITE-BEGIN-ZERO-BINDING — 零绑定 begin 不影响正常问数

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-BEGIN-ZERO-BINDING` |
| 版本 / 状态 | v0.3-draft；复审闭合参与载体、原子事务及 C1／C2 恢复证据槽；已挂测试台，NOT RUN，尚无跑次 |
| 总账 / 需求 | P1-60／REQ-030-081；P0 主路径修复 |
| 合同 / 计划 | [Spec](../../../../specs/lucy-20261119-webui-publish-caliber-registry-repair-spec.md)；[Plan](../../../../plans/lucy-20261119-webui-publish-caliber-registry-repair-plan.md) |
| 目标 | 纯 MCP 用户默认不 begin 可问数；旧客户端调用 begin 也不新增故障；真实强制绑定、权限及预算不被绕过 |
| 环境 | 隔离本机 Docker 单实例单副本；真实 Lucy／KTX／数据库／普通 MCP Token；R 含 ≥1 真实 Agent |
| 入口 | [cases.md](cases.md)；[fixtures.md](fixtures.md)；[runs/](runs/) |
| 判定真源 | [INDEX](../../INDEX.md)，文档齐不等于通过；本轮未构建、未造数、未测试 |
| 修订依据 | [评审决议](../../../../reviews/2026-11-19-begin-zero-binding-review-decisions.md)；Spec／Plan v0.5-draft，OQ-1／OQ-2 文档方案已闭合，未确权、未授权开发 |
| 复盘 | [测试漏检](../../../../lessons/2026-11-19-begin-zero-binding-test-gap.md) |

## 选择器与范围

| 选择器 | 用途 | 证据 |
|---|---|---|
| F | 模块功能合同 SC-01–12；非 UAT 的局部自动化映射 | 真协议、本地实际存储与确定性并发；函数调用计数。不得把局部上游计数替身称全真查数 |
| R | 本 suite 的完整 Docker／真实 Agent 组合用户旅程与系统恢复 | UAT-ZB-R0、01–12 全部必做；逐个请求／响应与数据库 oracle；不以 F 绿代替 |

R 在本修复形成候选并准备主张用户路径恢复时执行，负责人为候选 UAT 执行者。当前只获文档授权；F／R 都未运行。绑定正反例是本修复防绕过所必需，不列为可选 Wave B。

## 总判定

- 每个合法正常路径分别验证 begin 结果、query 结果与最终事实答案；query 成功不能覆盖 begin 出错，只有 Spec 明确的 G1 未记录及 G2／G5 仅记录非阻断降级为期望。
- 产品可达但 begin unresolved、需要人工删凭据／补 reindex／重启／WebUI 确认才成交：FAIL，不记 BLOCKED 前置。
- 凭据／真实数据／可控局部故障条件缺失：对应项 BLOCKED，停表上报；不得自动改用 mock。缺性能容差或真实客户端同样不能标 PASS。
- 全部必做达到期望才能 PASS；无“仅零绑定健康 happy path 通过即 PASS WITH GAP”的出口。
- 不改旧套件历史结果；失败入独立 P0 跟进与当前跑次，不能只挂在其他业务套件 BLOCKED。

## 证据槽

正式跑次文件名 `runs/YYYY-MM-DD-<agent>-<candidate>-<selector>.md`。记录候选身份、夹具与内容根指纹、参与凭据 phase／generation／participation／publishedBindingCount、每个会话是否有强制历史、预算前后、逐请求 isError／recorded／turnId／activeBindingId、questionState／budgetStatus、operationId／提交回执、round／window／有效归属、实际行与 SQL oracle、trace、显式／推断审计、耗时与工具调用数、C1／C2 恢复及清理结果。

原始必要响应保存在正式跑次配套脱敏附件，临时大文件可放 inbox 但不能成为唯一证据。禁止 Token、Cookie、认证头、客户原文或配置密钥入库。范围以 [fixtures 单一矩阵 M01–M10](fixtures.md#统一路径与覆盖矩阵)为准；RC1 固定为修复前既有 Codex CLI 0.165.0，版本核对不是兼容运行证据。F 覆盖全部 G1–G6，R 保留实际组合；P3／P4 补偿任务见 ZB-08，未证成的下降仍保留。

当前 runs 只有 README，无执行记录。
