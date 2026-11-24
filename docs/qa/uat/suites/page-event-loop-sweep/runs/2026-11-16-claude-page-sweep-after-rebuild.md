# Run — 2026-11-16 — claude-page-sweep-after-rebuild

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PAGE-SWEEP`（并联跑 `UAT-SUITE-EQUIV-GUARD` UAT-EQ-01／02） |
| Agent | Claude（Cursor） |
| 环境 | 本机 Mac（Apple Silicon）；demo 容器 `compose-lucy-1` 已重建，healthy，`lucyVersion=0.30.0`，`gitSha=299de2c9c2249c1543b648d4a1e1d0a46ac42037`，`gitDirty=false`；本仓库 `HEAD` 同 sha、工作树干净（含 P1-32／P1-33 提交 `a04bd5ac`）；Playwright 1.62.1；服务为独立子进程，`LUCY_WEBUI_AUTH=off`、`LUCY_DEPLOYMENT_MODE=development` |
| 与上一跑次的差异 | 本次是**从干净状态完整跑**：`npm --prefix webui run sweep:event-loop:gate` 自行 `docker cp` 重建后的容器项目、`vite build`、重造审计夹具（30 天 115,000 条调用、67 用户、合成账本、30 万条 `ui_page_views`）。**不复用沙箱**，补上了上一跑次「未现拷」的缺口；容器 sha＝`HEAD`，被测源码与容器同一提交 |
| 开始／结束 | 2026-11-16 ≈09:30–09:40 CST（完整门禁约 4 分钟） |
| 总判定 | **PASS WITH GAP**（0 越线／0 失败；仍有 25 路由、3 页面因夹具覆盖不到记「未测」） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | 容器 healthy；容器 `gitSha`＝本仓库 `HEAD`＝`299de2c9`，`gitDirty=false`；Chromium 可用 |
| UAT-SWEEP-01 | **PASS WITH GAP** | 43 页：**40 通过**，3 未测（`/connections`、`/publish/workbench`＝宿主无 `ktx`；`/eval/runs/:runId`＝夹具无评测运行）。无红字、无 5xx；页面加载期间 livez max 最大 293ms、p99 最大 132ms |
| UAT-SWEEP-02 | **PASS WITH GAP** | 125 路由：**96 通过、0 越线、0 失败、25 未测**、4 排除，与上一跑次一致；未测项同样是夹具盲区（含 `export-v2`／`export-pack-v2` 的 409 `integrity_or_relation_failed`、`export-pack` 的 413） |
| UAT-SWEEP-03 | **PASS** | `sweep:event-loop:gate` 退出码 **0**：`regressions=0`、`tracked-open=0`、未测路由 25／页面 3，与基线一致 |
| UAT-SWEEP-04 | **PASS（对本次报告回放）** | `SWEEP_STRICT=1 SWEEP_GATE=1 SWEEP_REPLAY=<本次报告>` 退出码 **0**。回放判定，不是另一次完整测量 |
| UAT-EQ-01／02（EQUIV-GUARD） | **PASS** | 重建后的 `HEAD` 上 `npm --prefix webui run test:equivalence`：10 个文件、71 条全绿 |

## 登记路由对照（本次 vs 上一跑次 vs 首跑）

| 路由 | 首跑（整改前） | 上一跑次 | 本次 |
|---|---|---|---|
| `export-inquiry-pack` | 单次 115–117 秒 | 0.76–0.82 秒；p99 266／max 431ms | 0.74–0.84 秒；livez p99 248ms、max 420ms |
| `access-map` | 1.7 秒 | 0.03 秒 | 0.02–0.03 秒 |
| `governance/overview` | livez p99 419–442ms | 约 0.18 秒；p99 372ms | 约 0.17 秒；livez p99 **386ms（贴线，余量 14ms）** |
| `audit/export` | livez 1.7–1.8 秒 | 约 0.22 秒；p99 76ms | 约 0.21 秒；p99 75ms、max 105ms |
| `audit/turns/export` | livez 1.4 秒 | 约 0.14 秒；p99 192ms | 约 0.14 秒；p99 187ms |
| `ui-usage/overview` | livez p99 565–623ms | 约 0.05 秒；p99 86ms | 约 0.05 秒；p99 130ms |
| `reconciliation/export` | 约 2 秒；livez 1.8–2.1 秒 | 约 0.13 秒；p99 205ms | 约 0.13 秒；p99 216ms |

## 备注

- **`governance/overview` 余量继续变薄：** 三次同尺度测量的 livez p99 为 419–442（整改前）→372→386ms。它没越线，但**只有 14ms 余量**，噪声就可能把它推过 400。建议下一轮对它单独剖析（日问数 KPI 窗口扫描），不要把「0 越线」读成充裕。
- 压测期间服务进程 RSS 峰值约 2.1GB（Chart 内存上限 2Gi）；与前两跑次同量级。**未做内存剖析，不下结论。**
- 夹具盲区未补：评测运行、语义资产操作、完整性合法的 v2 导出、`export-pack`（HTTP 413）、宿主 `ktx`。仍写「未测」。
- 清理：脚本跑完已自动删除临时目录（含 demo 项目副本里的 secrets）；未改 demo volume、ACL、Agent；未写凭据内容。
- 证据：`inbox/page-event-loop-sweep-rebuilt.json`（临时，不入库）。
- **≠ 可上线**；**≠** 客户现场验证（本机开发夹具，非客户 amd64）。
