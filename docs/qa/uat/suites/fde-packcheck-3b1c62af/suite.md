# UAT-SUITE-FDE-PACKCHECK — FDE 历史复现与修复候选复验

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-FDE-PACKCHECK` |
| 总账 ID | **P1-55**／REQ-030-076（复现任务）；**P1-56**／REQ-030-077（FDE 候选缺陷补录）；**P1-57**／REQ-030-078（修复复评整改）。均不入核心分母 |
| 目标 | 对 FDE 报告 `Lucy升级检查_3b1c62af_20261119` 的每条结论，在本机给出可复查判定：成立（全真）／仅替身成立／证据不可重现／无法判定／新增发现 |
| 合同回链 | [本机复现 Plan v0.2](../../../../plans/lucy-20261119-fde-3b1c62af-local-repro-uat-plan.md)；相关既有套件：[`INFERRED-REBUILD-RECOVERY`](../inferred-turn-rebuild-recovery/suite.md)、[`COLD-START-SLOW-DISK`](../cold-start-slow-disk/suite.md)、[`REBUILD-PROBE-BUDGET`](../rebuild-probe-budget/suite.md)、[`LARGE-SCHEMA`](../large-schema-ingestion/suite.md)、[`CATALOG-SCAN`](../catalog-scan-read-path/suite.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 全真性

L2 用例使用真实容器、真实服务、真实数据与真实 HTTP 入口。**禁止** CR 冒充；**禁止**用 FDE 的受控替身直接充当 L2 结果。

**降级授权现值**：原本机复现 Plan D2 仅延迟代理；后续整改 Plan（委托人 2026-11-19 12:35）另已批准受控投影进度与缩短回看窗口，须先尝试全真、无法构造再降级，并在 INDEX 标「受控降级」，不与全真 PASS 混写。不得把原 D2 的范围当成后续授权从未发生，也不得自动扩大到 SQL 拒绝注入。新增修复复验模式尚待本轮确认，见下文。

**L1 与 L2 分离**：L1（原样重跑 FDE 脚本、门禁命令）是自动化复现，结果存 `inbox/uat-fde-3b1c62af-2026-11-19/l1/`，**不进 INDEX、不写 UAT PASS／FAIL**。只有 L2 结果写入本套件 `runs/` 与 INDEX。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-FDE-R0（身份门禁）、UAT-FDE-R1（合同适用性）、UAT-FDE-05（AUDIT-01，全真 A 级） | UAT-FDE-01／02／03／04（B 级，依赖降级授权，未获批则 `BLOCKED`）、UAT-FDE-07（复用既有套件的正向结论复核） |

L1 门禁复现（Plan 的 UAT-FDE-06）不属于 UAT 用例，不在本套件判定内。

## 判定口径

对已知缺陷，复现成立记 `FAIL（预期，复现 FDE-xx）`，不得记 PASS。「约束」与「合法用户路径」成对判定，任一对不满足即该用例不是 PASS。

## 被测对象

候选 `3b1c62af32af7b6d045caef7fa10ccc92300ae97`（干净 worktree，`gitDirty=false`）。对照基线：`ff4762c9`、`3a9f0711`、`84becc34`。**本套件不修复任何缺陷。**


## 修复候选复验模式（v1.0，委托人已确认）

- 统筹：[P1-57 Plan](../../../../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。委托人已确认 D1–D5 并授权 Task 1–7；当前开始执行，尚无新验收结果。
- 旧候选 3b1c62af／三基线复现继续用原 `UAT-FDE-*` 剧本；修复复验使用 `UAT-FDE-FIX-*`。每个 run 必须明确 mode，禁止覆盖历史跑次或挪低原期望。
- 新模式的候选是包含 d8c3f097 与后续整改的**干净完整 SHA**，不是把镜像内旧 dirty 标签重命名为新提交。以实际 image ID 和运行文件哈希锁定。
- **新模式必做**：FIX-R0、FIX-R1、FIX-01～08；全部在真实独立 Docker 运行。原模式的可选 B 级用例分组不自动迁移为新模式的放行豁免。
- D5 **已独立确认授权**：真实 lab 不能自然产生相应 SQL 拒绝时，才考虑指定请求的语法／权限拒绝注入；只能确认后使用，合法字段取真实数据库，结果标受控降级。未确认或无法满足则 BLOCKED，不用 mock 代真。
- FDE 回复边界：功能合同、当前 UAT 和客户制品分开；必做 FAIL／BLOCKED／NOT RUN 不宣称全部阻塞已修复。批准的受控降级也不得写成全真 PASS 或客户驱动已验证。

当前 INDEX 仍指向 2026-11-19 Codex 修复评审 BLOCKED 跑次。新增模式为 NOT RUN 的验收草案，不产生新的最近跑次，也不替换该判定。
