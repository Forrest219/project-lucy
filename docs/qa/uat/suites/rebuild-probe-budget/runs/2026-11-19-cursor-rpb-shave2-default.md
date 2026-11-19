# Run — 2026-11-19 — cursor-rpb-shave2-default（削峰后默认开着多跑）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 目的 | P1-47 写片／窗口 DELETE off-thread 削峰后，默认配置（无 `LUCY_INFERRED_MAINTAINER=off`）关单多跑 |
| 被测镜像 | `project-lucy:demo`；`BUILD_REVISION=7d7ee831…-dirty`（含削峰代码） |
| 夹具 | `lucy-uat-cold-snap-old`；blkio 30MB/s、读 300／写 100 IOPS、2 核 |
| 命令 | `node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:demo --label 2026-11-19-cursor-rpb-shave2-rN --premigrate-wait-s 60 --env LUCY_REBUILD_TRACE=1`（r1 加 `--remigrate`） |
| 证据 | `inbox/uat-rebuild-probe-budget-2026-11-19-cursor-rpb-shave2-r{1,2,3}/`；Plan [write-slice-spike-shave](../../../../plans/lucy-20261119-p147-write-slice-spike-shave-plan.md) |
| 判定口径 | **模拟台**。RPB-09＝3／3。≠ 客户现场；≠ 可上线 |

## 多跑摘要

| 跑次 | pass | livez max／p99 | readyz p99 | maxStreak | 备注 |
|---|---|---|---|---|---|
| r1 | **PASS** | **9／8** | 16 | 0 | 窗口 DELETE 仍可达 ~3s，但 **off_thread**，不挡 livez |
| r2 | **PASS** | **7／7** | 16 | 0 | 同上 |
| r3 | **PASS** | **17／10** | 16 | 0 | 同上 |

对照改前／半程：

| 时代 | livez max／p99 | 形态 |
|---|---|---|
| 尖峰取证 FAIL | 2686／315 | 主线程 `write_slice` ~3050ms |
| shave1（仅写片 off-thread） | 2653–2790／154–224 | 主线程 `delete_window` ~2900–3192ms |
| **shave2（写片＋DELETE off-thread）** | **7–17／7–10** | 无 ≥1s livez |

## 必做判定

| ID | 结果 |
|---|---|
| UAT-RPB-R0／01／02／03 | **PASS**（3／3） |
| UAT-RPB-09 | **PASS**（3／3 独立冷启动） |
| UAT-RPB-05–07 | SKIPPED（本批默认配置） |

## 套件判定

**PASS（默认配置，模拟台多跑）。**  
30 天回看未改。暂停安全带仍可用，但不作为本关单依据。≠ 可上线；≠ 客户现网 K8s 已验。
