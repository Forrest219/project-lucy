# Run — 2026-11-19 — cursor-rpb-default-on-7d7ee831（默认开着复测）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 目的 | 委托人授权：默认配置（维护器开，无 `LUCY_INFERRED_MAINTAINER=off`）再测一轮，确认能否过 P1-47 门禁 |
| 被测镜像 | `project-lucy:demo`；`BUILD_REVISION=7d7ee8310a67b84c0bbea86aa2cc4472076fe899`（与 HEAD 一致；`gitDirty=false`；arm64） |
| 夹具 | `lucy-uat-cold-snap-old`（20 万行／67 用户）；blkio 读／写 30MB/s、读 300／写 100 IOPS、2 核 |
| 命令 | `node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:demo --label 2026-11-19-cursor-rpb-default-on-7d7ee831 --premigrate-wait-s 60`（**无** `--env LUCY_INFERRED_MAINTAINER=off`） |
| 证据 | [`inbox/uat-rebuild-probe-budget-2026-11-19-cursor-rpb-default-on-7d7ee831/`](../../../../../../inbox/uat-rebuild-probe-budget-2026-11-19-cursor-rpb-default-on-7d7ee831/)（`summary.json`／`samples.json`／`customer.json`） |
| 判定口径 | **模拟台**。单次默认跑次；≠ 客户现场；≠ 可上线 |

## 结果摘要

| 项 | 值 |
|---|---|
| 就绪 | 30.9s |
| livez max／p99 | **2854／276** |
| readyz max／p99 | 101／76 |
| ≥1.5s livez 次数 | **1／111**（t≈30.2s，2854ms） |
| 客户 3s 观察器 maxStreak | **0** |
| RPB-01 | **FAIL**（max 越线；p99 达标） |
| RPB-02／03 | **PASS**／**PASS** |
| RPB-05–07 | SKIPPED（非暂停配置） |
| RPB-04 | BLOCKED（无真实 K8s） |
| 套件 `pass`／`defaultConfigPass` | **false**／**false** |

## 指纹分型（对照套件门槛）

| 指纹项 | 客户现场（11-17） | 本跑 |
|---|---|---|
| livez 1.5–2.2s **持续** | 是 | **否**（仅 1 个 ≥1.5s；p99 276ms） |
| readyz 常 &gt;3s | 是 | **否**（readyz max 101ms） |
| 客户 3s 观察器连续失败 ≥6 | Ready=False | **否**（maxStreak＝0） |

**分型：残余单尖峰**（偶发 livez max 2.85s，仍低于客户探针 timeout 3s，但越过 Spec max≤1000ms）。**非** 11-17 持续停顿同形。

对照：

| 配置／时代 | livez max／p99 | ≥1.5s 形态 |
|---|---|---|
| 客户 11-17 | ≈2.17s；eventLoop p99≈2.2s | 持续 |
| 改前满量（pause-uat on） | 2693／2693 | 持续秒级 |
| 暂停 `off` | 13／9 | 无 |
| 本跑默认 `7d7ee831` | **2854／276** | 单尖峰（t≈30.2s） |
| 前序 `7ebedd4e` 多跑 | 308～2507／193～306 | 同形残余单尖峰或全绿 |

## 必做用例判定

| ID | 结果 | 说明 |
|---|---|---|
| UAT-RPB-R0 | PASS | 夹具／镜像／限速齐全 |
| UAT-RPB-01 | **FAIL** | livez max 2854＞1000；p99 276≤400；readyz p99 76≤1500；全 200 |
| UAT-RPB-02 | PASS | 连续失败＝0 |
| UAT-RPB-03 | PASS | burst 全 200 |
| UAT-RPB-04 | BLOCKED | 无真实 K8s |
| UAT-RPB-05–07 | SKIPPED | 本批默认配置 |

## 套件判定

**FAIL（默认配置未过门禁）。**  
相对 11-17／改前持续停顿：**非同形**；能力仍显著好于事故基准线。  
相对 P1-47 Spec：**不得关单**——单次残余尖峰使 RPB-01 FAIL；本跑亦未做 RPB-09（≥3 次独立冷启动全绿）。

≠ 可出默认镜像；≠ 可上线；暂停逃生阀历史 PASS 不计入本跑默认 PASS。
