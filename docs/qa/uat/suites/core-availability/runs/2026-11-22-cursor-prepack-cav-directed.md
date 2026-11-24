# Run — 2026-11-22 — Cursor prepack 定向 CAV（PP-04）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CORE-AVAILABILITY`（**定向子集**；非整套） |
| 任务 | 出包前收口 PP-04；闭合 11-20「修复未进候选」阻断 |
| 候选 | `project-lucy:prepack-8e3e3f24`；image Id `sha256:8669d3b2c765013ab67e3ad726e04c445f3d86201fa629c39d08d0925d4b1adf` |
| BASE_SHA | `8e3e3f24ccc09cf08fda1dcb043471194e87d58e`；干净 worktree；`gitDirty=false` |
| 基线对照镜像 | `project-lucy:core-followup-baseline-20261120`（脚本参数需要；本轮判定只认候选 digest） |
| 判定 | **定向 PASS WITH GAP**（PP04-CAV-01／02-fault／02-control） |
| 非目标 | 完整 F61／F62／F63／R-CAV；≠ 整套 UAT PASS；≠ 可上线；≠ 出包 |

## 用例结果

| Case | 模式 | 判定 | 要点 |
|---|---|---|---|
| PP04-CAV-01 | `--verify-repair --seconds 120` | PASS WITH GAP | 路径恢复 fresh（旧 FIFO 未释放）；worker 有界；livez／readyz 120 样本 non200=0 |
| PP04-CAV-02-fault | `--assess-only` | PASS WITH GAP | 真实 MySQL sleep；TERM 后查询成交（~10.5s）；exit 143；同卷恢复 MCP oracle 4／100 |
| PP04-CAV-02-control | `--assess-only --no-fault` | PASS WITH GAP | 同上无 FIFO；查询成交；同卷恢复 |

## 证据

- `inbox/prepack-closure-20261122/04-cav-directed/diagnostic-v/summary.json`
- `inbox/prepack-closure-20261122/04-cav-directed/drain-fault-v/`（及 `.log`）
- `inbox/prepack-closure-20261122/04-cav-directed/drain-control-v/`（及 `.log`）
- 用例表：`inbox/prepack-closure-20261122/01-cav-lineage/directed-cases.md`

## 边界

本跑次只证明：在干净 `8e3e3f24` 候选上，诊断真实停止／恢复与 MCP TERM 排空两类反例成立。不签完整核心可用性合同，不代替客户升级取证。
