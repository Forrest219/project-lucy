# Run — 2026-11-19 — cursor-rpb-spike-trace（尖峰取证）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 目的 | 默认开着下残余 livez 单尖峰根因取证（`LUCY_REBUILD_TRACE=1`） |
| 被测镜像 | `project-lucy:demo`／`7d7ee831…` |
| 命令 | `node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:demo --label 2026-11-19-cursor-rpb-spike-trace-rN --premigrate-wait-s 60 --env LUCY_REBUILD_TRACE=1` |
| 证据 | [`inbox/2026-11-19-rpb-spike-root-cause.md`](../../../../../../inbox/2026-11-19-rpb-spike-root-cause.md)；`inbox/uat-rebuild-probe-budget-2026-11-19-cursor-rpb-spike-trace-r{1,2,3}/` |

## 多跑摘要

| 跑次 | pass | livez max／p99 | 尖峰 | 对齐的同步段 |
|---|---|---|---|---|
| r1 | **FAIL** | 2686／315 | t≈30.33s | **`write_slice` 3050ms**（随后 checkpoint 84ms） |
| r2 | PASS | 421／360 | 无 | 最大写片 444ms |
| r3 | PASS | 254／243 | 无 | 最大写片 311ms |

## 判定

取证完成：**尖峰＝主线程偶发秒级 `write_slice`，非本跑大块 `wal_checkpoint`。**  
套件默认配置仍不能关单（存在 FAIL 跑次）。详情见 inbox 取证文。≠ 可上线。
