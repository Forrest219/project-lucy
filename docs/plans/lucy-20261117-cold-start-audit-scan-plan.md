# 冷启动审计库整表扫描消除 Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **v0.3。冷启动后的同步读取不再随历史总行数或磁盘延迟失控：启动补算与稳态轮询都不再整条扫描 access_log（启动补算改为按用户逐个探测，轮询改为不带 DISTINCT 的 id 水位范围读取并在代码里去重）；启动不再把窗口内全部用户一律标脏后做 30 天整段重建，只补算有未处理新行的用户，补算每一页同步读取按时间预算收敛；审计库两个连接的打开与迁移（含 foreign_key_check）在 app.listen 之前完成。本机慢盘冷缓存台实测：HEAD 7b882c7c 旧库首次升级与已迁移库重启都在 onReady 阶段 FST_ERR_HOOK_TIMEOUT 崩溃；启动幸存时就绪后 livez 反复 1.6–9.9 秒且进程不死，补算单页（400 行）同步读取 2.7–5.9 秒（热缓存 1–2 毫秒）；0.25.0 对照 30.8 秒就绪。测试台 UAT-SUITE-COLD-START-SLOW-DISK 已建。终稿已确权、开发已授权（委托人 2026-11-18「授权定稿，进入开发」；不含新增持久化表等 schema 变更，不含线上升级）。代码已实现，vitest 守卫通过。测试台改后跑次（候选镜像 `cold-fix-p139c`）**FAIL**：R0／01／03／04／05 PASS，02 只差一项——首次升级补算窗口 livez p99 609ms 超门槛 400ms（max 643ms 过 1000ms，进程不崩，113 秒就绪）；待委托人决定放宽门槛或另批手段。不入核心分母。≠ 可上线** |
| 主 Spec | [`docs/specs/lucy-20261117-cold-start-audit-scan-spec.md`](../specs/lucy-20261117-cold-start-audit-scan-spec.md) |
| 总账 | **P1-39**／REQ-030-060；**不入核心分母**；事故修复 |
| 授权边界 | **当前不得改运行代码。** 获得终稿确权（Codex CLI 终审，或无 Codex 时委托人明示确权）与委托人明确的开发授权之后，只改：`webui/server/admin/inferred-turn-maintainer.ts`、`webui/server/index.ts` 的启动顺序、`webui/server/proxy/audit.ts` 与 `webui/server/admin/audit.ts` 的预热入口，以及对应 vitest。不改 Helm 探针、`synchronous`、索引与表结构、P1-38 补算切片。扩大改动面须另获授权 |
| 验收 | Spec SC-01–SC-14。SC-07–SC-10 只认测试台 `UAT-SUITE-COLD-START-SLOW-DISK` 的跑次 |

## 目标

冷慢盘＋客户规模审计库下，升级后进程能起来、就绪探针在预算内转 200、转 200 之后探针不再被同步 SQL 拖过预算；启动补算与后台轮询的代价不再随历史总行数增长；重启时没有新行的用户不重建；补算每一次同步读取有时间预算；合法用户主路径不受影响。

## 开工前置

- 已入总账：P1-39／REQ-030-060（根因登记 v1.23；本条 Spec 起草 v1.24）。
- **终稿确权**：已取得。委托人 2026-11-18「授权定稿，进入开发」明示确权。
- **开发授权**：已取得（同上）。范围＝本 Plan 授权边界内的文件；**不含**新增持久化表等 schema 变更，**不含**线上升级。
- 测试台基建不属于运行代码，已先行：`scripts/uat/cold-start-slow-disk.mjs`、`scripts/uat/cold-start-slow-disk-seed.cjs`、套件 `docs/qa/uat/suites/cold-start-slow-disk/`。
- 环境：本机 Docker Desktop（arm64）。慢盘用 blkio 限速，冷缓存用 `drop_caches`。不涉及客户拓扑。
- 客户侧证据（不阻塞本条，用于校准）：容器内 `dd if=/dev/zero of=/data/lucy/.fsync-probe bs=4k count=200 oflag=dsync`、`audit.sqlite*` 三文件大小、故障 Pod 启动五分钟日志。

## 步骤

| 步骤 | 内容 | 验证 |
|---|---|---|
| 0 | **改前基线（已完成 2026-11-17）**：HEAD `7b882c7c` 上跑 `uat:cold-start`，记入 [runs/2026-11-17-cursor-docker-baseline.md](../qa/uat/suites/cold-start-slow-disk/runs/2026-11-17-cursor-docker-baseline.md)。R0／01 PASS；02／03／05 `FST_ERR_HOOK_TIMEOUT` 崩溃；04 用 `--warm-start` 证明启动幸存时稳态 livez 仍 1.6–9.9 秒 | 跑次已入 `runs/` |
| 1 | 先写失败测试：计划守卫（SC-01）、等价守卫（SC-02／SC-03）、让出（SC-04）、「无新行不重建」（SC-14）、时间预算分页（SC-13）。在 HEAD 上确认计划守卫红灯 | vitest 红灯截图写入 `runs/` 或评审记录 |
| 2 | 启动补算改逐用户探测，每 64 个用户让出 | SC-01／SC-02／SC-04 转绿 |
| 3 | 轮询改 `id` 水位范围读取：无 `DISTINCT`、每页 2000、代码去重、页间让出 | SC-01／SC-03／SC-04 转绿 |
| 3b | **补算范围与时间预算（§4.4）**：启动只对有未覆盖新行的用户标脏；重建分页按上一页毫秒自适应（25–400 行）。先按 OQ-1 在演练库上量化「已覆盖」反推查询的计划与耗时，须 `SEARCH`；需新表则暂停申请 schema 授权 | SC-13／SC-14 转绿；OQ-1 结论写入 Spec |
| 4 | 两个审计连接各导出预热入口，`main()` 在 `app.listen` 之前调用，输出 `schema ready` 日志；`onReady` 里维护器启动只剩调度 | SC-05／SC-06；`git diff` 无探针改动（SC-11） |
| 5 | 构建候选镜像，跑全套 `uat:cold-start -- all --new-image … --window-s 600 --premigrate-wait-s 1800`（首次补算较长时加长窗口与预迁移等待），另跑一次 `pagecost` 作对照诊断，记入 `runs/` | SC-07–SC-10；INDEX 更新 |
| 6 | 状态登记：Spec 头部、总账跟进状态、`docs/README.md`、`docs/plans/README.md`、e2e-ledger、INDEX 同一句 | `lint:spec-docs` 与 `check-e2e-ledger` |

## 浏览器验证

不适用：本条不改变用户可见 WebUI 表面；验收以 vitest 与慢盘冷启动演练为准，默认不做浏览器测试，也不做移动窄屏测试。

## 验收

- SC-01–SC-06、SC-11、SC-13、SC-14 的 vitest 部分以 Spec §6 的打假为准：`cd webui && npx vitest run --maxWorkers=1 server/__tests__/inferred-turn-maintainer*.test.ts server/__tests__/event-loop-relief.test.ts server/__tests__/proxy-audit.test.ts`（测试文件名以实现为准）。
- SC-07–SC-10、SC-12：`npm run uat:cold-start -- all --new-image <候选镜像>`，证据写入测试台 `runs/`。
- vitest 绿 ≠ UAT PASS。INDEX 只认 `runs/`。

## 完成定义

Spec、本 Plan、总账、需求池、`docs/README.md`、`docs/plans/README.md`、`docs/qa/uat/INDEX.md` 与 e2e-ledger 使用同一句状态。测试台改后跑次 PASS，且 UAT-COLD-02 的 `schema ready` 耗时已记录。**终稿确权与开发授权已于 2026-11-18 取得；UAT 结果以测试台为准，≠ 可上线。**

## 风险

| 风险 | 处理 |
|---|---|
| 改前基线 HEAD 全绿，说明演练台太宽松或 HEAD 已不触发 | 步骤 0 的出口条件：先复核演练台（限速值、库规模、子表规模），不得直接结论「无需修复」 |
| 首次升级的整段补算总时长未知（基线估算半小时量级） | 受时间预算约束、不要求 120 秒内完成；用 `--window-s` 加长窗口实测并入 `runs/` |
| 「已覆盖」判定若需持久水位表即为 schema 变更 | OQ-1：先量化反推查询；需新表则暂停，向委托人申请 schema 变更授权 |
| 监听前迁移超过 150 秒预算 | 本条不收口；另立条目做迁移分块或后台化。不得回退为监听后同步 |
| 演练库子表（`access_log_sources` 等）比客户库小，`foreign_key_check` 被低估 | 种子脚本先只灌 `access_log`。若 UAT-COLD-02 的 `foreign_key_check` 耗时占比显著，扩种子到子表后复跑，并在 `runs/` 单列 |
| 本机限速不等于客户盘 | 环境变量可调；客户侧 `dd` 数据回来后校准 |
| 客户现场症状与本机机制不同 | Spec §1.6。保持在总账 |
