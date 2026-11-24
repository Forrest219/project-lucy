# Fixtures — UAT-SUITE-PAGE-SWEEP

| 键 | 值 | 备注 |
|---|---|---|
| 项目副本 | `docker cp compose-lucy-1:/data/lucy /tmp/lucy-sweep/root` | 不改 demo volume；副本含 demo secrets，跑完删除 |
| 容器名 | `compose-lucy-1` | `SWEEP_CONTAINER` 可覆盖 |
| 前端 | `vite build --outDir /tmp/lucy-sweep/dist` | 仓库当前源码 |
| 服务 | `webui/scripts/page-event-loop-sweep-server.mts`（独立子进程，`LUCY_WEBUI_AUTH=off`、`LUCY_DEPLOYMENT_MODE=development`） | 须强制关鉴权与开发模式，否则测到的全是 401 |
| 审计夹具 | `webui/tests/performance/fixtures/audit-scale-fixture.ts`：30 天、115,000 条、67 用户、183 表 | 与 P1-21 同一把尺子 |
| 账本夹具 | `webui/tests/performance/fixtures/audit-ledger-fixture.ts`：向真实安全账本追加 2,000 条事件，把 `ledger_seq` 按行 id 单调铺开，归属改写基线置 0 | **合成**。让「精确 as-of S 证明」能过，从而测到正式对账与 v2 导出。不含 `primary_status` 等派生列，所以 v2 导出的完整性校验仍过不了，见下 |
| 访问配置 | demo 的 `access.yaml` 加 67 个 `scale-user-NN` | |
| UI 使用记录 | 30 万条 `ui_page_views`、15 万条 `ui_catalog_navigation_events` | 客户规模估计，不是事故实测 |
| 门槛 | livez p99 ≤ 400ms；livez max ≤ 1000ms；路由顺序最大 ≤ 3000ms；状态码 200；无 `DISPLAY_SNAPSHOT_BUSY` | 沿用 P1-21，p99 为 2026-11-13 调整后的 400ms |
| 基线文件 | `webui/scripts/page-event-loop-sweep.baseline.json` | 登记已知越线（挂整改条目）与已知未测。**只减不增** |
| 证据 | `inbox/page-event-loop-sweep.json` | 跑次只抄路径与汇总数字 |
| Chart 存活探针 | `/api/livez` period 10s、timeout 3s、failureThreshold 6 | 解读重路由单次耗时：连续约 60 秒不应答即被重启 |
| Pod 内存上限 | 2Gi（`deploy/k8s/helm/lucy/values.yaml`） | 解读 RSS 峰值 |

## 夹具已知覆盖不到（必须写成「未测」，不得写通过）

- 评测运行、语义资产操作／发布记录、Wiki 与来源的历史版本：夹具里没有。
- 宿主无 `ktx` 命令行：`/connections` 的连接测试、`/publish/workbench` 的变更校验不可测。
- 完整性合法的 v2 导出：合成行没有 `primary_status` 等派生列，`export-v2`／`export-pack-v2` 在小窗口下返回 `integrity_or_relation_failed`；默认全量范围则先撞 SQLite 变量上限（见排查报告 F-6）。
- 客户 amd64 环境、多人并发打开页面：不在范围。

## 禁止

- 把 `/tmp/lucy-sweep` 里的 secrets 复制出来或写入跑次。
- 把门禁绿（UAT-SWEEP-03）写成 UAT-SWEEP-02 PASS。
- 用读代码或「功能合同收口」代替跑次。
