# 全页面事件循环与探针风险排查 Plan（P1-31）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 全页面事件循环与探针风险排查 Plan |
| 文档类型 | Other（排查 Plan） |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-15 |
| 撰写人 | Claude（Cursor） |
| 委托人 | xingchen |
| 基于材料 | [P1-21 Spec](../specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md)、[错题：7 天访问日志占住事件循环](../lessons/2026-11-13-audit-read-blocks-event-loop.md)、`webui/server` 路由与 `webui/src/app/App.tsx` 页面表、委托人 2026-11-15 同句「批准升级为全局问题，进行逐个页面的排查」 |
| 适用范围 | P1-31／REQ-030-052：只读排查。产出排查报告与越线清单。**不含开发授权** |
| 状态 | **排查已完成（2026-11-15）**，结果见 [排查报告](../reviews/2026-11-15-page-by-page-event-loop-sweep-report.md)。已补账本夹具、升格门禁并挂测试台 `UAT-SUITE-PAGE-SWEEP`（首跑 FAIL）；整改立项 P1-32／P1-33，开发未授权 |
| 授权边界 | 委托人 2026-11-15 同句「批准升级为全局问题，进行逐个页面的排查」＝立项＋**只读排查**授权。**不含开发授权**；越线条目改运行代码须各自终稿确权＋委托人另发开发授权 |
| 验收 | §5 出口：全部页面与全部 GET 路由都有判定；报告与总账镜像已落盘 |
| 输出位置 | `docs/plans/lucy-20261115-page-by-page-event-loop-sweep-plan.md` |

**清单**：P1-31（**不入核心分母**）｜**REQ**：REQ-030-052｜**总账**：[功能清单池](../governance/lucy-20261107-lucy-0-30-feature-inventory-pool.md)

## 开工前置

- 已入总账：P1-31／REQ-030-052（立项＋只读排查授权）。
- 本机 demo 容器在跑，用于拷贝项目内容夹具；宿主已安装 Chromium（Playwright）。
- 不触碰客户实例、不改 demo volume、不改运行代码。

## 1. 目标与边界

P1-21 只处理了访问日志重建、`/api/diff` 和探针拆分。服务端同步 SQLite 占住事件循环是整体模式，约 40 个文件使用 `better-sqlite3`，没有 `worker_threads`。本 Plan 把 P1-21 的判据套到**全部页面与全部 GET 路由**上，找出还会拖垮事件循环或让探针超时的接口。

| 做 | 不做 |
|---|---|
| 服务端全部 GET 路由逐个量化 | 改任何运行代码（越线条目另立行，各自终稿确权＋开发授权） |
| WebUI 全部页面逐页加载，记录每页实际发出的 `/api/*` | 打客户实例、业务高峰跑 `hours=168` |
| 状态码、耗时、对 `/api/livez` 的影响 | 引入 worker 线程（按 P1-21 Spec O1，另议） |
| 说明夹具覆盖不到的部分 | 把夹具内的通过写成现场通过 |

## 2. 判定线（沿用 P1-21）

| 项 | 门槛 |
|---|---|
| 状态码 | 必须 200。非 200 的耗时**不算**性能样本，记 `NOT MEASURED` 或 `FAIL` |
| 单接口顺序 5 次最大值 | ≤ 3000ms |
| 压测该接口（并发 2，5 秒）时 `/api/livez` | p99 ≤ 400ms 且 max ≤ 1000ms |
| 页面加载期间 `/api/livez` | p99 ≤ 400ms 且 max ≤ 1000ms |
| `DISPLAY_SNAPSHOT_BUSY`／页面红字「暂时无法完成刷新」 | 0 |

## 3. 方法

两层，同一进程内起服务，轮询 `/api/livez` 的计时器与服务共享事件循环，因此量到的就是客户端实际会看到的延迟。

1. **Layer 1：全部 GET 路由。** 用 Fastify `printRoutes` 还原路由树，共 125 条 GET。路径参数用夹具里发现的真实 ID 填充，缺 ID 记 `NOT MEASURED`。每条先预热，再顺序 5 次；顺序最大值 ≥ 40ms 的再并发压 5 秒并同步轮询 livez。排除：`oidc/callback`、`*/stream`、`/api/auth/*`。
2. **Layer 2：全部页面。** Chromium 逐页加载（`networkidle` 后再等 1.2 秒），记录该页发出的 `/api/*`、状态码、最慢一条、耗时合计，以及加载期间的 livez 分位数；检测页面红字。页面清单取自 `webui/src/app/App.tsx` 路由表，共 40 余页。
3. **页面汇总。** 第二层给出每页实际调用，与第一层的并发压测结果合并，得到每页最坏接口。

脚本：`webui/scripts/page-event-loop-sweep.mts`。原始数字：`inbox/page-event-loop-sweep.json`（临时，不入库）。

## 4. 夹具

| 项 | 来源 |
|---|---|
| 项目内容（连接、Wiki、语义资产、Skill、评测） | 从本机 demo 容器 `/data/lucy` 拷贝到 `/tmp/lucy-sweep/root`，不改 demo volume |
| 审计库 | `audit-scale-fixture.ts`：30 天、115,000 条调用、67 用户、183 张表（与 P1-21 一致） |
| 审计账本（2026-11-15 补） | `audit-ledger-fixture.ts`：向真实安全账本追加 2,000 条事件，`ledger_seq` 按行 id 单调铺开，归属改写基线置 0。让精确 as-of S 证明通过，正式对账与 v2 导出才测得到。**合成数据**，不含 `primary_status` 等派生列，v2 导出的完整性校验仍过不了 |
| UI 使用记录 | 30 万条 `ui_page_views`、15 万条 `ui_catalog_navigation_events`（客户规模估计） |
| 访问配置 | demo 的 `access.yaml` 加 67 个用户 |
| 前端 | `vite build --outDir /tmp/lucy-sweep/dist`（仓库 `webui/dist` 是 10 月 27 日旧构建，不用） |
| 认证 | 关闭，开发模式（同 P1-21 压测） |

### 夹具覆盖不到（必须在报告里写明，不得写成通过）

- 审计库之外的大表：追踪证据、通知、配置变更日志**没有按客户量级灌数据**；安全账本只有 2,000 条合成事件。依赖它们的接口，快不代表客户现场快。
- 需要连真实业务库的页面（目录实时读表、连接测试、MCP 工具列表）：本机进程连不到 demo 容器内的库，记 `NOT MEASURED`，由后续对 demo 容器的实测补。
- 客户实例（0.25）：不打。

## 5. 验收：产出与出口

| 产出 | 位置 |
|---|---|
| 排查报告（每页一行＋越线清单＋夹具局限） | `docs/reviews/2026-11-15-page-by-page-event-loop-sweep-report.md` |
| 越线条目 | 每个越线接口在总账另立 P1 行；**登记 ≠ 开发授权** |
| 总账／REQ 镜像 | P1-31 跟进状态同句更新 |

**出口**：全部页面与全部 GET 路由都有判定（`OK` / `OVER` / `FAIL` / `NOT MEASURED` 并写原因）；越线清单已入总账；报告已落盘。**≠ UAT PASS；≠ 可上线。**

## 完成定义

- 125 个 GET 路由、43 个页面均有判定，且未测项都写明原因与补测条件。
- 越线清单、夹具局限、过程更正已写进排查报告。
- 总账 P1-31 与 REQ-030-052 的跟进状态与报告同句。
- 未改任何运行代码。

## 风险

| 风险 | 缓解 |
|---|---|
| 夹具比客户小或形状不同，数字偏乐观 | 报告逐条写明夹具覆盖不到的部分；未测不记通过 |
| 服务与压测同进程时，一个路由卡死或崩溃拖垮整个排查 | 服务跑独立子进程，崩溃记录退出信号并重启 |
| 空转负载造成假通过（P1-21 压测的 agents 即为先例） | 每条只把状态码 200 的样本算性能，非 200 记未测 |
| 排查脚本被误当成一次性工具而无人维护 | 2026-11-15 已升格为门禁：新增路由／页面自动被扫到，新增未测也让门禁变红 |

## 6. 后续（不在本 Plan）

- ~~越线接口的修复方案与是否引入 worker~~：**已承接**。整改立项 P1-32／P1-33（不含开发授权）；[O1 复评](../reviews/2026-11-15-p1-21-o1-worker-thread-reassessment.md)建议维持不默认引入 worker。
- ~~把本脚本升格为持续看守~~：**已升格**（2026-11-15，委托人批准）。入口 `npm --prefix webui run sweep:event-loop[:gate]`，基线 `webui/scripts/page-event-loop-sweep.baseline.json`（只减不增），测试台 [`UAT-SUITE-PAGE-SWEEP`](../qa/uat/suites/page-event-loop-sweep/suite.md)。上文「一次性脚本」的措辞自此作废。
- 夹具仍未覆盖：评测运行、语义资产操作、完整性合法的 v2 导出账本、宿主 `ktx`。补齐后重跑并从基线的「未测」清单里划掉。
