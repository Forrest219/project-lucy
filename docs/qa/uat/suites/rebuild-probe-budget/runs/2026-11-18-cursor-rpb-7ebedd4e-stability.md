# Run — 2026-11-18 — cursor-rpb-7ebedd4e-stability（出包前多跑）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 目的 | 对客户 11-17 回滚同形问题（readyz 超时／health 抖动）做交付前能力评估；执行优化后的 UAT-RPB-08／09 |
| 被测镜像 | `project-lucy:demo`；`BUILD_REVISION=7ebedd4eb79b75ae2b6651caeee62595a6fffbe5`（`gitDirty=false`；与当前 compose-lucy-1 一致） |
| 夹具 | `lucy-uat-cold-snap-old`（20 万行／67 用户）；blkio 读／写 30MB/s、读 300／写 100 IOPS、2 核 |
| 命令 | `node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:demo --label <label> --premigrate-wait-s 60`（默认配置，无 `LUCY_INFERRED_MAINTAINER=off`） |
| 证据 | `inbox/uat-rebuild-probe-budget-2026-11-18-demo-7ebedd4e-default/`；`…-bd14e0da-default-r1/`；`…-bd14e0da-default-r2/`；（确认跑另见同日 confirm 标签） |

## UAT-RPB-09 多跑汇总（默认配置）

| 跑次 | label | RPB-01 | livez max／p99 | ≥1.5s 次数 | RPB-02 maxStreak | 形态 |
|---|---|---|---|---|---|---|
| A | `demo-7ebedd4e-default` | **PASS** | **308／193** | 0 | 0 | 全绿 |
| B | `demo-bd14e0da-default-r1`（revision 仍为 7ebedd4e） | **FAIL** | **2507／306** | 1（t≈33.8s） | 0 | 残余单尖峰 |
| C | `demo-bd14e0da-default-r2` | **FAIL** | **2071／208** | 1（t≈33.9s） | 0 | 残余单尖峰 |
| D | `demo-bd14e0da-default-r3` | **FAIL** | **2189／193** | 1（t≈33.8s） | 0 | 残余单尖峰（同相位） |

**多跑结论（RPB-09）**：**FAIL／不稳定**（1／4 PASS）。B／C／D 尖峰均落在就绪后 **≈33.8s**，属可复现相位尖峰而非随机噪声。不得宣称默认配置可出镜像。

> 同日追加 `confirm-r3` 曾两次因孤儿 `lucy-uat-rpb-run`／进程早退后挂起，**未产出 summary**；判定以 A–D 四跑为准，不依赖 confirm。

## UAT-RPB-08 客户指纹判别

| 指纹项 | 客户现场（11-17） | 本批三跑 |
|---|---|---|
| livez 1.5–2.2s **持续** | 是（p99≈2.2s；改前本机 38／42 ≥1.5s） | **否**。PASS 跑 0／114；FAIL 跑各仅 1 个 ≥1.5s，p99 均 ≤306ms |
| readyz 常 &gt;3s | 是（2.4–7.5s） | **否**。readyz max ≤246ms；p99 ≤203ms |
| health ok↔degraded（KTX MCP 1500ms） | 是 | 见确认跑 `health-fingerprint.jsonl`（同窗采样）；空载 demo 健康体非本条证据 |
| 客户 3s 观察器连续失败 ≥6 | Ready=False | **否**。三跑 maxStreak＝0 |

**分型**：**非客户同形未解**；属 **残余单尖峰**（偶发 livez max 2.0–2.5s，仍低于客户 3s timeout，但越过 Spec max≤1000ms）。

对照改前／暂停台：

| 配置／时代 | livez max／p99 | ≥1.5s 形态 |
|---|---|---|
| 客户 11-17／`abb38913` | livez≈2.17s；eventLoop p99≈2.2s | 持续 |
| 本机改前满量（pause-uat on） | **2693／2693** | 持续秒级 |
| 暂停 `off` | 13／9 | 无 |
| 本批 `7ebedd4e` 默认 | 308～2507／193～306 | 偶发单尖峰或全绿 |

## 必做用例判定

| ID | 结果 | 说明 |
|---|---|---|
| UAT-RPB-R0 | PASS | 夹具／镜像／限速齐全 |
| UAT-RPB-01 | **FAIL（不稳定）** | 仅 1／3 过 max≤1000；p99 三跑均达标 |
| UAT-RPB-02 | PASS | 连续失败＝0 |
| UAT-RPB-03 | PASS | burst 全 200 |
| UAT-RPB-04 | BLOCKED | 无真实 K8s |
| UAT-RPB-05–07 | SKIPPED | 本批默认配置 |
| UAT-RPB-08 | PASS（判别完成） | 分型＝残余单尖峰，非 11-17 同形 |
| UAT-RPB-09 | **FAIL** | 未达 3／3 |

## 套件判定

**FAIL（默认配置不稳定）**。  
相对 11-17／改前持续停顿：**能力已显著改善，客户同形主因可视为已收敛**；相对出包门禁：**不得放行**——偶发 2s+ livez 尖峰仍可能在更慢盘上逼近／超过 3s readiness。

≠ 可上线；≠ 客户现场 K8s 已验；暂停逃生阀仍可用但不计入本批默认 PASS。
