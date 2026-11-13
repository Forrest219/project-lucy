# P1-13 发布取证 acceptance 代替实现 CR（路径 A）

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-13 |
| 对象 | **P1-13／REQ-030-034**（发版性能基线与相对不回退；发布取证／harness） |
| 依据 | [landed 收口 Plan](../plans/lucy-20261113-landed-middev-closure-batch-plan.md) Task W1-4 默认路径 **A**；§Global「P1-13 除外：可书面登记 acceptance 代替实现 CR」 |
| 性质 | **书面收口**。**不是**独立实现层 Code Review；**不**登记「实现 CR PASS」 |

## 结论

本条属 **发布取证出口**（Spec SC-01–SC-16），已有 [`2026-11-13-release-perf-baseline-gate-acceptance.md`](2026-11-13-release-perf-baseline-gate-acceptance.md) 证据齐。**W1-4 路径 A**：以该 **acceptance** 作为 landed 收口所需的 **实现 CR 等价物**；**不**另起 implementation CR 附件，**不**伪造实现 CR 结论。

## 边界

- **≠ 可上线**；**≠** 各模块无问题；**≠** 功能合同层独立实现复审已 PASS。
- 其他 P1／P0 条目不因本登记而默认可用 acceptance 代 CR。
- 若日后补独立实现 CR，须新文件并回写清单／Spec，**撤销**本条代替关系（路径 B）。

## 回链

| 文档 | 链接 |
|---|---|
| Spec | [release-perf-baseline-gate-spec](../specs/lucy-20261113-release-perf-baseline-gate-spec.md) |
| Plan | [release-perf-baseline-gate-plan](../plans/lucy-20261113-release-perf-baseline-gate-plan.md) |
| 验收（等价证据） | [release-perf-baseline-gate-acceptance](2026-11-13-release-perf-baseline-gate-acceptance.md) |
