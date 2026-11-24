# 错题：问询预算耗尽反复污染后续 MCP／UAT，合法 allow 被误判成 deny

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-22 |
| 标签 | `ux-regression` `gate-gap` `contract-stack` `sev-high` |
| 环境 | 本机 Docker demo；Lucy `0.30.0`；gitSha `d4615f8e` dirty；MCP `http://127.0.0.1:57881`；WebUI `http://127.0.0.1:55176` |
| 相关 | Spec 162／REQ-030-033（60 次／300s）；优化方案 **P1-74／REQ-030-095** [`lucy-20261122-question-budget-mainpath-escape-spec.md`](../specs/lucy-20261122-question-budget-mainpath-escape-spec.md)；`webui/server/proxy/question-experience.ts`；Wave D 证据 `inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`；PM 包 `inbox/2026-11-22-question-budget-pm-scenario-report.md` |
| 状态 | `open`（登记 ≠ 开发授权；优化 Spec／Plan 已入池 v0.1-draft，待终稿确权与开发授权） |

## 1. 症状与影响

- 同一组长期复用的 Bearer Token 上，多次全真 MCP／Agent 跑次后，后续 `lucy_query` 稳定返回 `reason=question_budget_exhausted`（工具 isError）。
- 兼容性判定器把「工具 isError」映射为 `observedOutcome=deny`，于是大量 **expected allow** 案被记成 **new deny**，功能轴直接 FAIL。
- **MCP 服务 RTT 仍正常**（本跑次 p50≈24ms、p95≈353ms，`serviceLatency=PASS`），表面像「权限／题库／产品回归」，实为**预算粘连**。
- 影响：开发／UAT／Wave D 反复空耗；排障误指向 Agent 客户端或 ACL；必须重签 Token／清预算才能继续，**严重拖慢主路径验证效率**。

## 2. 复现要点

1. 签发一组 demo Compat Token（如 `COMPAT_TOKEN_READONLY`），写入环境并**跨多次** candidate／Agent 跑次复用，不换 Token、不清预算状态。
2. 先跑会大量调用数据工具的路径（确定性 MCP 题库 +／或真实 Agent 多轮 MCP）。
3. 不重签 Token，再跑一轮「期望 allow」的 `lucy_query` 对照（或整份 `run-mcp-compatibility.mjs candidate`）。
4. 观察：同一 Token 上出现 `question_budget_exhausted`；证据里 allow 案变成 new deny；健康检查与 MCP RTT 仍绿。

## 3. 根因

分层（当前核实范围；产品裁定前不全归因单一模块）：

| 层 | 说明 |
|---|---|
| 产品合同 | 问询预算默认 60 次／300s 忙时（REQ-030-033）；按 identity（user＋token 前缀）＋session 作用域累计；耗尽后失败关闭。防火墙本身有意。 |
| 运行态粘连 | 预算状态**跨跑次持久**；同一 Token 不重签则后续跑次继承已耗尽窗口。Wave D 当日 Token 文件约 10:32 签发，午后 8 路 candidate 仍复用 → 功能对照大量 budget stop。 |
| 判定语义 | 兼容性 runner 将 `lucy_query` 的 isError／budget 记为 deny（非 ACL deny）。排障若不看 `reason`，会误判成权限回归。 |
| 并发放大 | Agent 8 路并行会加速同一 identity 的调用计数／忙时；与「串行 UAT 也复用 Token」叠加时更易提前触顶。 |
| 非主因 | Lucy MCP 服务慢：本跑次已证伪（`serviceLatency=PASS`）。 |

## 4. 为何漏检

- UAT／compat 证据顶层常只写 `new deny`，未强制把 `reason=question_budget_exhausted` 升为**一等事故类**。
- Token 签发与预算生命周期未绑成「每全真跑次必重签／必 `lucy_continue_question`／必隔离 identity」的硬门禁。
- 健康检查与 MCP RTT 绿，掩盖了「问数面已失败关闭」。
- Wave D 曾修过「预算粘连需重签」，但未固化为可交付的事故卡片与 PM 复现包，问题反复出现。

## 5. 举一反三

1. 凡功能轴 `new deny`／allow 变红：**先读 attempt.reason**；命中 `question_budget_*` 则先隔离预算，再谈 ACL／题库。
2. 全真 compat／UAT：**禁止**默认可跨多小时复用同一 Bearer 而不声明预算代次；跑前重签或显式 continue。
3. 证据摘要必须分列：`acl_deny`／`budget_exhausted`／`tool_error`／`empty`，禁止只写 deny。
4. Agent 并行与确定性 MCP 对照若共用 Token，必须在报告写明「预算争用」风险。
5. `serviceLatency=PASS` 不得用来否定「问数失败」——预算失败可以是毫秒级拒绝。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 交付 PM 场景报告＋证据摘录 | 完成 | 见 §7；登记 ≠ 开发授权 |
| 产品裁定：UAT／多跑次是否要自动换窗／隔离 identity／跑前重签门禁 | Spec／Plan **v1.1**；开发已落地（CR＝APPROVE） | 见 P1-74／REQ-030-095；测试台 [`UAT-SUITE-BUDGET-ESCAPE`](../qa/uat/suites/budget-escape/runs/2026-11-22-kimi-p174-budget-escape.md)＝**PASS WITH GAPS**（07／10A 环境 BLOCKED）；同 Token 两跑 compat 功能轴 PASS |
| 判定器把 budget 与 ACL deny 分列（避免 new deny 误导） | 方案已开 | 纳入同一 Spec D5／Plan Task 4；待开发授权 |
| 总账是否单列事故修复行 | 已入池 | **P1-74／REQ-030-095**（不入核心分母） |

## 7. 证据指针

- 全量证据：[`inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json`](../../inbox/wave-d-mcp-compat-results/mcp-compatibility-candidate.json)
- 脱敏摘录：[`inbox/2026-11-22-question-budget-evidence-excerpt.json`](../../inbox/2026-11-22-question-budget-evidence-excerpt.json)
- PM 场景报告：[`inbox/2026-11-22-question-budget-pm-scenario-report.md`](../../inbox/2026-11-22-question-budget-pm-scenario-report.md)
- Wave D 跑次说明：[`docs/qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md`](../qa/uat/suites/mcp-upgrade-compatibility/runs/2026-11-22-cursor-wave-d-candidate.md)
- 实现入口：`webui/server/proxy/question-experience.ts`（`QUESTION_BUDGET_MAX_CALLS=60` 等）
