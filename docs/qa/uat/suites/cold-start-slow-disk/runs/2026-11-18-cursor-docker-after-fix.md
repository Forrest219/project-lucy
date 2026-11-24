# Run — 2026-11-18 — cursor-docker-after-fix（改后）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COLD-START-SLOW-DISK` |
| Agent | Cursor |
| 环境 | 与改前基线相同：本机 Docker Desktop（arm64）；限速读写各 30MB/s、读 300／写 100 IOPS、2 核（`/dev/vda`）；每次启动前宿主 `drop_caches`；种子快照 `lucy-uat-cold-snap-old`（0.25.0 建表、200,000 行、67 用户、30 天、943MB） |
| 被测构建 | `project-lucy:cold-fix-p139c`，由 HEAD `7b882c7c` 加**未提交工作树**构建（`LUCY_GIT_DIRTY=true`）。对照：`project-lucy:old-9c78b0e3`（0.25.0） |
| 命令 | `npm run uat:cold-start -- all --new-image project-lucy:cold-fix-p139c --label fix-p139c --window-s 120 --premigrate-wait-s 1800`。证据已归档到仓库：[evidence/2026-11-18-after-fix/](evidence/2026-11-18-after-fix/)（原始位置 `inbox/uat-cold-start-fix-p139c/`，inbox 可能被清）；改前基线证据见 [evidence/2026-11-17-baseline/](evidence/2026-11-17-baseline/) |
| 总判定 | **FAIL**。R0／01／03／04／05 PASS；**02 只差一项**：首次升级补算窗口 `livez` p99 609ms 超门槛 400ms（max 643ms 过 ≤1000ms） |

| Case ID | 改前（HEAD） | 改后 | 证据摘要 |
|---|---|---|---|
| UAT-COLD-R0 | PASS | PASS | 环境门禁同前 |
| UAT-COLD-01 | PASS | PASS | 0.25.0 对照 30.5 秒就绪 |
| UAT-COLD-02 | FAIL（约 124 秒 `FST_ERR_HOOK_TIMEOUT` 退出 1） | **FAIL（仅 livez p99）** | 进程不退出、无 `FST_ERR_HOOK_TIMEOUT`、重启 0、**113 秒就绪（≤150）**；就绪后 120 秒窗口 `livez` max **643ms（≤1000 ✓）**、p99 **609ms（>400 ✗）**，`readyz` p99 **227ms（≤1500 ✓）**，全部 200。该窗口内后台在对 67 个用户做首次 30 天全量重建（旧库没有推断问询，等于首次回填），每个同步段都被页读取／写入事务切碎 |
| UAT-COLD-03 | FAIL（约 49 秒崩溃） | **PASS** | 30.6 秒就绪；livez max 773ms、p99 7ms；readyz p99 9ms |
| UAT-COLD-04 | FAIL（`--warm-start` 对照：livez 反复 1.6–9.9 秒） | **PASS** | 30.7 秒就绪；清页缓存后窗口 livez max 4ms、p99 4ms；readyz p99 156ms |
| UAT-COLD-05 | FAIL（约 123 秒崩溃，主路径不可用） | **PASS** | 103.3 秒就绪；管理员认领 267ms、读 `/api/project` 4ms、建角色／智能体／令牌 510ms、MCP `initialize` 31ms、`tools/list` 59ms，全部 ≤5 秒 |
| UAT-COLD-06 | BLOCKED | BLOCKED | 客户侧证据仍未取 |

## 补充数据（由样本 CSV 复算，不判分）

| 用例 | 窗口样本数 | readyz p50 | readyz p95 | livez 超过 350ms 的样本（距就绪秒数：毫秒） |
|---|---|---|---|---|
| UAT-COLD-02 | 110 | 5ms | 214ms | 0s：355；88s：399；116s：643；117s：609 |
| UAT-COLD-03 | 114 | 3ms | 7ms | 0s：773（就绪后第一个样本，非稳态） |

02 里 p99 609ms 对应的是窗口末尾两个相邻样本（116s、117s），不是均匀分布的抖动；其余样本都在 400ms 以内。占空比让出（SC-17）仍在起作用：没有它时 readyz 样本是 1.2–1.9 秒，现在 p95 只有 214ms。从本次起脚本在 `stats` 里同时记录 `readyzP50Ms`／`readyzP95Ms`（只记录，不判分）。

## 开发期定位（不是正式跑次）

首次改后跑次（只含探测改写与预热移前）：03／04 PASS，02／05 仍在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT`。用 `--cpu-prof` 与分段计时定位：首轮补算在 `onReady` 钩子之后立刻开始，和其余钩子争同一块冷盘，把某个钩子拖过 10 秒。处理：首轮扫描与轮询等服务开始监听之后才启动（SC-16）。随后 02 能就绪，但 `livez` 最大 2.4–3.1 秒，来自三处：写入事务一片 25 个簇（600–900 毫秒，首次带检查点 2.5–3.8 秒）、页读取后没有留空窗使 `readyz` 多跳请求被每个同步段各拖一次（readyz 1.2–1.9 秒）。处理：写入分片按时间预算收敛并从 8 个簇起步；较长同步段后占空比让出（SC-17）。这些中间跑次用 `docker run -v` 把工作树源码挂进候选镜像做 `cold02`，**只作定位，不入测试台**；最终判定只认上表的整镜像整套跑次。

## 关键结论（改后）

1. 事故形态已修：旧库首次升级与已迁移库重启都不再崩溃；稳态（启动幸存、页缓存被冲掉）`livez` 不再反复 1.6–9.9 秒（04：max 4ms）。合法用户主路径在冷启动后可用（05）。
2. **残余缺口**：首次升级的 30 天首次回填窗口内，`livez` p99 609ms、max 643ms（多次开发期复跑 575–754ms，另有一次 2.4 秒落在首次检查点）。剩余抖动来自同步 SQLite 读写在限速盘上的 I/O 排队（单页 25–100 行也会出现 0.7–1.0 秒），调预算目标 100→50 毫秒、页下限 25→10 行均无改善。同步段内无法再切；要根治只有只读 worker（Spec 已写「须另批」），或把一次性分配询价序号的写入事务按块分批（改变 P1-38 的原子语义），或调低 `wal_autocheckpoint`（改 PRAGMA）。这三项都**不在本次授权内**，已停下来等委托人决定。
3. `schema ready in 2ms`：旧库的打开与迁移发生在比 `recoverSemanticJournals` 更早的预监听步骤里（02 比 03 晚就绪约 80 秒，即首次升级预监听同步工作量级；仍是间接估算），预热步骤本身只剩 2 毫秒。SC-06 的日志行存在且在监听日志之前，但**不能**用它读出迁移耗时。
4. 本机限速是复盘值的复现，不是客户盘实测；UAT-COLD-06 仍待客户配合。

## 备注

- 是否使用 `docker restart`：否（整卷复制＋新建容器＋清页缓存）。
- 候选镜像含未提交工作树；出包前须提交并按正式流程重建，**本跑次不等于可上线证据**。
- 清理：运行容器已删（诊断期保留的 `lucy-uat-cold-run` 已由下一次用例重建）；数据卷 `lucy-uat-cold-*` 保留，`npm run uat:cold-start -- clean` 可清。
