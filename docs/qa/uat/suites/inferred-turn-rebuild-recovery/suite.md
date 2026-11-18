# UAT-SUITE-INFERRED-REBUILD-RECOVERY — 推断问询重建中断后自动恢复

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-INFERRED-REBUILD-RECOVERY` |
| 总账 ID | **P1-45**／REQ-030-066（前方报告 **P0-02**） |
| 目标 | 看守「重建中断 → 残缺推断结果被判已覆盖 → 重启不补算」；全真进程中断或等价提交边界注入后，重启必须自动补全 |
| 合同回链 | [Spec](../../../../specs/lucy-20261118-inferred-turn-rebuild-recovery-spec.md) SC-01–SC-08；前方报告 LUCY-TR-20261118-01 v1.2 §3.1 C／§4.1 P0-02；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 脚本指针 | 改前可用报告侧 `codex-interruption-review.mts`／独立 vitest 合同作**开发台**证据；本套件关单须容器级全真跑次（见 cases） |

## 全真性

真实子进程或真实容器内重建；真实 SIGKILL 或产品提交边界中断；真实 SQLite 持久卷；重启后真实维护器扫描。**禁止**用 Code Review 或「读代码看起来会补」冒充 PASS。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-IRR-R0、UAT-IRR-01、UAT-IRR-02、UAT-IRR-03、UAT-IRR-04 | UAT-IRR-05（客户额度 20 万行／慢盘，对齐前方 C；资源不足则 BLOCKED 并报委托人） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| Spec 改前基线（现行 71e5b941 系构建） | R0、01–04；预期 FAIL（对齐前方硬复现） |
| 含本修复的候选构建 | 全部必做；05 若环境具备则跑 |
| 改动 `rebuildInferredTurns*`／`covered()`／覆盖水位 | 01–04 |

## 边界

- 本套件 **≠** 功能合同收口，**≠** 可上线，**≠** K8s 网关验收。
- 不证明原始 `access_log` 丢失；只证明派生推断结果可恢复。
- INDEX 现值：套件已挂、尚无正式跑次 → **NOT RUN**。
