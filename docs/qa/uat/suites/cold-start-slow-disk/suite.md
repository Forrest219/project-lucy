# UAT-SUITE-COLD-START-SLOW-DISK — 慢盘冷页缓存冷启动

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-COLD-START-SLOW-DISK` |
| 总账 ID | **P1-39**／REQ-030-060 |
| 目标 | 看守 2026-11-17 客户升级事故：旧 schema 的客户规模审计库在慢盘、冷页缓存下冷启动，0.30 在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 退出，而 0.25.0 能起来。门禁补上「热缓存单测看不出」的那一类 |
| 合同回链 | [Spec](../../../../specs/lucy-20261117-cold-start-audit-scan-spec.md) SC-06–SC-10／SC-12–SC-14／SC-16–SC-17；[Plan](../../../../plans/lucy-20261117-cold-start-audit-scan-plan.md)；[复盘](../../../../lessons/2026-11-17-k8s-upgrade-event-loop-readiness-timeout.md)；勾连 [e2e-ledger](../../../../governance/e2e-ledger.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |
| 脚本 | `npm run uat:cold-start -- <r0\|seed\|cold01\|cold02\|cold03\|cold04\|cold05\|pagecost\|all\|clean> [--new-image IMG] [--window-s N] [--premigrate-wait-s N]` |

## 全真性

真实镜像、真实 entrypoint、真实 HTTP、真实 SQLite 文件。慢盘用 Docker blkio 限速，冷缓存用宿主 VM 的 `drop_caches`。**不 mock，不 `docker restart`**（重启会带着热缓存，没有判定力）。审计库由 0.25.0 镜像自己建表，再灌合成行，保证是**旧 schema**，让候选镜像走真实的首次升级迁移。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-COLD-R0、UAT-COLD-01、UAT-COLD-02、UAT-COLD-03、UAT-COLD-04、UAT-COLD-05 | UAT-COLD-06（客户侧只读证据：fsync 延迟、审计库文件大小、启动日志；客户配合时才跑，否则 BLOCKED） |

## 持续节奏

| 时机 | 跑哪些 |
|---|---|
| **改前**：HEAD 或现役构建上跑一次基线 | R0、01、02、03、04、05 全部，结果入 `runs/` 作对照 |
| 每个包含本修复的 `0.30` 候选构建 | R0、01、02、03、04、05 全部 |
| 任何改动审计库 schema、索引、`getDb`／`getAuditDb` 的构建 | 02、03 |
| 任何改动 `inferred-turn-maintainer`、启动顺序、`app.listen` 之前的恢复步骤的构建 | 02、03、04 |
| 客户提供 fsync／文件大小／日志后 | 06；并按客户数据校准环境变量里的限速值，再跑 02 |

## 门槛（与 Spec §6 同源，改门槛先改 Spec）

| 项 | 门槛 |
|---|---|
| 首次升级就绪 | 容器不退出、无 `FST_ERR_HOOK_TIMEOUT`、重启 0、`/api/readyz` ≤ 150 秒转 200 |
| 重启就绪 | ≤ 60 秒 |
| 首次升级转 200 之后 120 秒（02） | `livez` max ≤ 2000ms、p99 ≤ 1000ms；`readyz` p99 ≤ 1500ms；全 200 |
| 重启转 200 之后 120 秒（03） | `livez` max ≤ 1000ms、p99 ≤ 400ms；`readyz` p99 ≤ 1500ms；全 200 |
| 冲掉页缓存后 60 秒 | 同上 |
| 主路径每一步 | 成功且 ≤ 5 秒 |

## 边界

- 本套件是客户场景看守，**≠** 功能合同收口，**≠** 可上线。
- 本机限速是复盘值的复现，**不是**客户盘的测量。客户症状是否同一机制见 Spec §1.6。
- 本套件只用合成数据。不连客户库、不读客户数据。
- 种子库只灌 `access_log`。子表（如 `access_log_sources`）为空，`foreign_key_check` 的代价被低估；见 cases 备注。
