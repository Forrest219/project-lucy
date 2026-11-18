# Run — 2026-11-18 — cursor-rpb-pause-uat（暂停交付双跑）

| 元数据 | 内容 |
|---|---|
| 套件 | `UAT-SUITE-REBUILD-PROBE-BUDGET` |
| 目的 | 验证 `LUCY_INFERRED_MAINTAINER=off` 能否消除与 11-17 客户回滚同形的 livez 秒级停顿，且 MCP 主路径可用 |
| 被测镜像 | `project-lucy:p147-pause-uat`（＝`project-lucy:demo`）；`BUILD_REVISION=ff4762c9…-dirty`（arm64） |
| 夹具 | `lucy-uat-cold-snap-old`（20 万行／67 用户）；blkio 读／写 30MB/s、读 300／写 100 IOPS、2 核 |
| 命令 | A（对照）：`node scripts/uat/rebuild-probe-budget.mjs all --image project-lucy:p147-pause-uat --label 2026-11-18-pause-uat-on --premigrate-wait-s 60`；B（暂停）：同命令加 `--env LUCY_INFERRED_MAINTAINER=off`、label `…-off` |
| 证据 | [evidence/2026-11-18-pause-uat/](evidence/2026-11-18-pause-uat/) |
| 判定口径 | **模拟台**。暂停 PASS ≠ P1-47 默认配置 PASS ≠ 客户现场 PASS ≠ 可上线 |

## 对照表

| 配置 | livez max／p99 | ≥1.5s 形态 | RPB-01 | RPB-05／06／07 | 套件 pass |
|---|---|---|---|---|---|
| A 不暂停（默认） | **2693／2693** | 秒级停顿同形 | **FAIL** | SKIPPED | false |
| B 暂停（`off`） | **13／9** | 无 | PASS | **PASS／PASS／PASS** | true |

## 暂停侧细节（B）

- 就绪 21.8s；客户 3s 观察器连续失败＝0；readyz p99 17ms。
- RPB-06：采样窗内 MCP `initialize`→`tools/list`→轻量工具循环全成功（见 `off/mcp.json`）。
- RPB-07：`inferredRebuild.paused=true`、`complete=false`；启动日志含暂停警告。

## 结论（模拟台）

**可解 11-17 回滚同形根因（交付缓解）**：同镜像同夹具下，不暂停仍复现秒级 livez；暂停后探针与 MCP 达标。  
**仍不可解／未宣称**：默认配置下 P1-47 功能合同（根治）；客户现网 K8s 平滑升级；正式出包门禁。

## 备注

- 跑次前 Docker  overlay 曾 ENOSPC；清理 build cache／闲置 volume 后重跑成功。
- dirty arm64 候选；amd64 干净树待测包见接力 Plan Task 8。
