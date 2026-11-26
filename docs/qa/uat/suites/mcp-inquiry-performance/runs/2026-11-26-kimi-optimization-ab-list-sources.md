# 跑次：2026-11-26 optimization-ab 对照（listSources readdir 优化臂）

| 元数据 | 内容 |
|---|---|
| 跑次 / runId | `2026-11-26-kimi-optimization-ab-list-sources` / `mip-mwx6wvyo-76qsck` |
| 日期 / 触发档 / 执行 | 2026-11-26 / `optimization-ab`（formal，MCP lane 全家族 29 组）/ Kimi（委托人本会话明示授权「挂一次 mcp-inquiry-performance 套件对照跑」） |
| 对照目的 | 验证 `listSourcesWithManifests` 按连接 readdir 优化（＋非 ENOENT warn 日志）对 MCP 数据问询主路径**无回退**；对照真源＝冻结候选基线 `baselines/1-lucy-mip-uat-capB-…json`（runId `mip-mwwwsrq0-k8cgto`） |
| 候选身份 | 镜像 `project-lucy:mip-ab-20261126`＝`sha256:4a3b2dadc6c6…`（独立 tag，未动共享 `project-lucy:demo`）；源码 `git:5f1b4152…+dirty`；`environmentFingerprint` 与基线一致（`sha256:4ef6013…`），contract/questionSet/config/budget digest 全与基线相同 |
| 环境 | 隔离栈 `lucy-mip-uat`（端口 55276/57981，舱壁扩容裁定 B 同基线）；夹具未重灌（基线同卷，跑前规模断言默认档＋MCP-PERF profile 均 PASS，2 项 Hive SKIPPED 同基线口径）；**未跑伴随哨兵**（runner 直调）；跑次窗口主机 load avg 21–27（多 UAT 栈并行） |
| 判定 | **FAIL（相对门禁 8 组回退）——归因：候选树差＋主机环境，非本次 listSources 优化**（机制豁免见下）；非发布证据 |
| 证据 | `evidence/mip-mwx6wvyo-76qsck/attempts.ndjson`（2920 条全保留；入库形态 gz＋`EVIDENCE_SHA256.txt`，正文 sha256 `eda9530a…`）；逐组复算脚本 `inbox/mip-ab-verdicts-20261126.mjs` |

## 结果（复算自 attempts，judge 与 runner 同一代码路径）

- 2920 尝试：无 wrong_answer／timeout／crash 报告；denial 家族预期拒绝形态与基线一致。
- **相对门禁（vs 冻结基线 p95，MCP_RELATIVE 双阈值）**：
  - 回退 8 组：`CONCURRENT_C50_SIMPLE` +67.3%（p95 14044ms，**同时破 simple warm 10000ms 绝对线**）、`CONCURRENT_C50_COMPLEX` +72.7%、`CONCURRENT_C20_SIMPLE` +85.6%、`CONCURRENT_C20_COMPLEX` +145.0%、`FILTER_GROUP_WARM` +117.3%、`SIMPLE_WARM` +38.1%、`FILTER_TIME_WARM` +20.0%、`DENIAL_READONLY_OPS_WARM` +179.6%（75→209ms，绝对值仍远低于 denial 500ms 预算）。
  - 改善 15 组：FOLLOW 系 −30~−49%、JOIN −38.5%、MULTI_DB −28.4%、WIDE −23~−48%、COLD_COMPLEX −28.1%、legal control 各组 −15~−39%。
  - 持平 6 组（|Δp95| < 20%）。
- 复算口径说明：逐组 `denial scenario has no legal control (D16)` 与 C20 `samples 60 < formal floor 100` 为离线复算未传入 `legalControls`/`plannedCounts` 的接线产物（基线跑次 C20 同为 n=60）；相对 delta 与绝对预算判定由 attempts 直接算出，为有效信号。

## 归因分析（为什么不是本次优化）

1. **机制豁免**：夹具 semantic-layer 仅 15 表／13 overlay。旧实现每次 listing＝15 次 `stat`；新实现＝1 次 `readdir`＋13 次 `stat`——**每查询差异约 2 次系统调用（亚毫秒）**，不可能产生 +3.0~5.7s 的并发档回退。
2. **函数级微基准**（5000 表，本机，`inbox/bench-list-sources-20261126.mts`）：稀疏 overlay 旧 309ms→新 22ms（≈13.8×）；全量 overlay 最坏档新仍 1.13×。**任何规模下无回退方向**。
3. **候选树 ≠ 基线树**：基线臂（`b4bc7c6e+dirty`）之后落了 8 个提交（P1-84 公开入口分类器与 SC-07 计数、P1-88 敏感元数据修复引导、P1-89/90/91 语义写等）＋ 大量未提交 P1-75 展示面改动（`display-snapshot.ts` +542 行、`mcp-proxy.ts` 每查询新增 `notePublicEntryHeavyWork` 与 explain 路径 `detectStandaloneOverlayConflicts`）。15 组改善与 8 组回退并存的形态与「树差＋负载」一致，不像单一优化的均匀效应。
4. **主机环境**：跑次窗口 load avg 21–27，`compose-lucy-1` 等其他会话栈持续负载；基线臂跑在当日 09–10 时另一负载窗口。并发档对主机争抢最敏感，回退恰好集中在并发档。

**结论**：本次 `listSources` readdir 优化（＋warn 日志）对 MCP 数据问询主路径**无回退**（机制＋函数级双重证据）；套件级 FAIL 信号指向候选树其他改动与主机环境，**建议**由 P1-75／P1-84 属主在安静窗口对并发档做同刻双臂复测（本跑次数据可作为对照输入）。

## 状态遗留

- 隔离栈 `lucy-mip-uat` 当前运行在 `project-lucy:mip-ab-20261126`（经 `/tmp/mip-ab-image-override.yml` 指向；基线臂原镜像 `9253857e…` 已不在本机镜像库）。下次对该栈 `compose up` 需带同一 override 文件，或重建镜像后恢复。
- `/tmp/mip-ab-image-override.yml`、`/tmp/mip-compat-env.sh`（0600）为本次跑次临时件，可随时删。
- 本跑次不构成 `LATEST.json` 基线接受输入；SEED_ONLY 候选基线地位不变。
