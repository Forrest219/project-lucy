# Run — 2026-11-16 — claude-page-sweep-after-fix

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-PAGE-SWEEP` |
| Agent | Claude（Cursor） |
| 环境 | 本机 Mac（Apple Silicon）；被测源码＝本仓库工作树（`HEAD`＝`d64414d6`，含未提交的 P1-32／P1-33 整改与其他会话的改动）；服务为独立子进程，`LUCY_WEBUI_AUTH=off`、`LUCY_DEPLOYMENT_MODE=development`；Playwright Chromium |
| 与首跑的差异（如实记录） | **复用沙箱**：本次**没有**重新 `docker cp` demo 容器，而是复用此前拷出的项目副本与已灌好的审计夹具（`SWEEP_RESEED=0`；30 天 115,000 条调用、67 用户、合成账本、30 万条 `ui_page_views`）。夹具规模与首跑相同；项目内容副本不是本次现拷。UAT-R0 在测量结束后单独补做（见下） |
| 开始／结束 | 2026-11-16 ≈00:15–00:45 CST |
| 总判定 | **PASS WITH GAP**（整改路径全部不越线；沙箱副本未现拷；仍有 25 条路由、3 个页面因夹具覆盖不到记「未测」，其中 `export-v2`／`export-pack-v2` 为本次由「失败」转入未测） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS（环境可达；沙箱副本未现拷）** | 测量后补做：`compose-lucy-1` healthy，`gitSha=d64414d6…`＝本仓库 `HEAD`，`gitDirty=true`；Playwright 1.62.1。**注意**：测量所用项目副本是此前拷出的，不是本次现拷；容器已被并行会话重建过，副本内容与现容器不保证一致，只作为性能夹具的项目内容 |
| UAT-SWEEP-01 | **PASS WITH GAP** | 43 页：**40 通过**，3 未测（`/connections`、`/publish/workbench`＝宿主无 `ktx`；`/eval/runs/:runId`＝夹具无评测运行）。无红字、无 5xx；页面加载期间 livez max 最大 344ms、p99 最大 149ms |
| UAT-SWEEP-02 | **PASS WITH GAP** | 125 路由：**96 通过**、**0 越线、0 失败**、**25 未测**、4 排除（首跑：89／7／2／23／4）。原 9 条登记越线全部转通过或转未测，见下表。未测里新增 2 条＝`export-v2`／`export-pack-v2`：整改后不再撞 SQLite 变量上限，改为夹具缺 `primary_status` 等派生列而返回 409 `integrity_or_relation_failed`，**不能写成通过** |
| UAT-SWEEP-03 | **PASS** | 对本次完整报告：基线收缩后 `regressions=0`，`tracked-open=0`；**红绿自检**：基线去掉 `export-v2` 未测登记→退出码 **1**＋`newly unmeasured`。完整测量用 `npm run sweep:event-loop:gate` 的同一脚本（环境变量指向沙箱）；首轮对照旧基线时，`export-v2`／`export-pack-v2` 被正确判为「新增未测」→ 已按总账规则把它们移入基线 `unmeasuredRoutes` 并写明原因 |
| UAT-SWEEP-04 | **PASS（对本次报告回放）** | `SWEEP_STRICT=1 SWEEP_GATE=1 SWEEP_REPLAY=<本次报告>` 退出码 **0**（已登记越线清零）。这是对已有报告的判定，**不是**另一次完整测量 |

## 登记路由前后对照

| 路由 | 条目 | 首跑（2026-11-15） | 本次 | 结果 |
|---|---|---|---|---|
| `/api/admin/audit/export-inquiry-pack` | P1-32／F-1 | 单次 115–117 秒；压测期 livez 30 秒超时 | 单次 0.76–0.82 秒；livez p99 266ms、max 431ms | OK |
| `/api/admin/audit/export-v2`、`export-pack-v2` | P1-32／F-6 | 409 `too many SQL variables` | 409 `integrity_or_relation_failed`（夹具缺派生列） | **未测**（缺陷已修，完整路径无夹具） |
| `/api/admin/access-map` | P1-33／F-2 | 单次 1.7 秒 | 单次 0.03 秒 | OK |
| `/api/admin/governance/overview` | P1-33／F-3 | livez p99 419–442ms | 单次约 0.18 秒；livez p99 372ms（**贴线，余量 28ms**） | OK |
| `/api/admin/audit/export` | P1-33／F-4 | livez 1.7–1.8 秒 | 单次约 0.22 秒；livez p99 76ms、max 98ms | OK |
| `/api/admin/audit/turns/export` | P1-33／F-4 | livez 1.4 秒 | 单次约 0.14 秒；livez p99 192ms | OK（另两次单路由复测 p99 338／408ms，见备注） |
| `/api/admin/ui-usage/overview` | P1-33／F-5 | livez p99 565–623ms | 单次约 0.05 秒；livez p99 86ms | OK |
| `/api/admin/audit/reconciliation/export` | P1-33／F-7 | 单次约 2 秒；livez 1.8–2.1 秒 | 单次约 0.13 秒；livez p99 205ms | OK |

## 证据

- 报告 JSON：`inbox/page-event-loop-sweep-fix2.json`（本次完整测量）。临时文件，不入库。
- 判定线：livez p99 ≤ 400ms、max ≤ 1000ms；路由顺序最大 ≤ 3000ms；状态码 200。
- 等价守卫见 [`UAT-SUITE-EQUIV-GUARD`](../../audit-scale-equivalence-guard/suite.md)；本跑次只证明**不卡**，不证明**输出没变**。

## 备注

- **余量很薄的两条：** `governance/overview` p99 372ms（线 400ms）；`turns/export` 在单路由复测中 p99 出现过 338ms 与 408ms（同一代码，单个 livez 样本落在 GC 或另一请求的同步块之后）。当前判定用同一把尺子，门禁以「第二个 5 秒窗口再次越线才记 OVER」抑制单次噪声；这两条**值得下一轮继续盯**，不能把 372ms 读成充裕。
- 中间调试发现：导出路径里「列表查询」「调用行查询」两个同步块若在同一个微任务链里连续执行，两路并发时会叠加成一个 ≈240ms 的块；已在两块之间显式让出事件循环。
- 压测期间服务进程 RSS 峰值约 2.0–2.3GB（Chart 内存上限 2Gi）。**未做内存剖析，不下结论**；与首跑同量级，未恶化。
- 夹具盲区未补：评测运行、语义资产操作、完整性合法的 v2 导出、宿主 `ktx`、`export-pack`（HTTP 413）。仍写「未测」。
- 清理：沙箱目录为本机 `/tmp` 临时目录；未改 demo volume、ACL、Agent；未写凭据内容。
- **≠ 可上线**；**≠** 客户现场验证（本机开发夹具，非客户 amd64）。
