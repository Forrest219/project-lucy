# Run — 2026-11-17 — cursor-docker-baseline（改前基线）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COLD-START-SLOW-DISK` |
| Agent | Cursor |
| 环境 | 本机 Docker Desktop（arm64）；限速 读写各 30MB/s、读 300／写 100 IOPS、2 核（设备 `/dev/vda`）；每次启动前宿主 `drop_caches`。种子快照 `lucy-uat-cold-snap-old`：0.25.0 建表、200,000 行、67 用户、30 天、943MB |
| 被测构建 | **改前**：`project-lucy:cold-head-7b882c7c`（HEAD `7b882c7c`，已含 `79db4352`）。对照：`project-lucy:old-9c78b0e3`（0.25.0／`9c78b0e3`＝客户上一次平滑升级 `20261111-r1`） |
| 开始／结束 | 2026-11-17 夜 |
| 总判定 | **FAIL（改前基线；符合预期）**。R0／01 PASS 证明台子有判定力；02／03／05 在 `onReady` 阶段 `FST_ERR_HOOK_TIMEOUT` 退出码 1；04 因启动即崩无法按正式口径测量，改用 `--warm-start` 对照 FAIL |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-COLD-R0 | PASS | 块设备 `/dev/vda`；60MB 直写 31.2MB/s（限速生效）；可清页缓存；两个镜像身份可读；种子快照 943MB。证据 `inbox/uat-cold-start-design-baseline/UAT-COLD-R0.json` |
| UAT-COLD-01 | PASS | 0.25.0 在同一限速冷启动台上 **30.8 秒**就绪（复盘值 33 秒，复现一致）；容器不退出、重启 0；就绪后 60 秒 `/api/health` 全 200，max 493ms。证据 `inbox/uat-cold-start-design-baseline/UAT-COLD-01.json`。注：本次与 HEAD 镜像构建并行跑，构建只会让台子更苛，未影响判定 |
| UAT-COLD-02 | **FAIL** | HEAD 旧库首次升级：约 124 秒时 `FST_ERR_HOOK_TIMEOUT`／`AVV_ERR_READY_TIMEOUT`，退出码 1，从未就绪。日志无 `schema ready` 行（SC-06 不满足）。证据 `inbox/uat-cold-start-head-7b882c7c-baseline/UAT-COLD-02*` |
| UAT-COLD-03 | **FAIL** | HEAD 已迁移库（正常盘热缓存预迁移后再上限速冷盘）：约 49 秒时同一错误退出码 1。与首次升级相比早约 75 秒，说明首次升级的迁移等其他预监听同步工作在这台台子上约占 75 秒（间接估算，**非逐语句实测**）。证据 `…/UAT-COLD-03*` |
| UAT-COLD-04 | **FAIL（正式口径不可测）＋ `--warm-start` 对照 FAIL** | 正式口径：HEAD 冷启动即崩，到不了就绪，无法测量稳态。对照（`--warm-start`，已迁移库、限速盘、启动不清缓存）：HEAD **13 秒就绪、进程不死、重启 0**；就绪后 `/api/livez` 反复 **1574、1694、1783、1849、2224、7297、9901 毫秒**——**这些都发生在清页缓存之前**；清缓存后窗口内 livez max 8002ms（超时）、readyz 两次 8001ms 超时。证据 `inbox/uat-cold-start-head-7b882c7c-baseline-warmstart/UAT-COLD-04*` 与正式口径 `…/UAT-COLD-04*` |
| UAT-COLD-05 | **FAIL** | HEAD 首次升级路径约 123 秒崩溃，从未就绪，合法用户（管理员认领、MCP 握手）全程不可用。主路径用例按「进程不起来＝不可用」判 FAIL，未执行后续步骤。证据 `…/UAT-COLD-05*` |
| UAT-COLD-D1（诊断，不判分） | 数据 | 同一用户同一条重建 SQL（LIMIT 400，4 页，毫秒）：**限速冷盘 2695／5902／5005／4091**；限速热缓存 2／1／2／2；不限速冷盘 29／23／23／21。证据 `inbox/uat-cold-start-head-7b882c7c-baseline/pagecost.json` |
| UAT-COLD-06 | BLOCKED | 需客户配合回传 fsync 延迟、`audit.sqlite*` 大小、故障启动日志。未请求，未执行。我方不对客户实例执行写操作 |

## 关键结论（改前）

1. **HEAD 没有修好冷启动。** `79db4352` 把轮询改成 `id > ? DISTINCT`，但计划仍是 `SCAN … idx_al_user_ts`（产品自带 SQLite 3.53.2 实测，见 Spec §1.3）。
2. **启动幸存时稳态仍卡。** 重建页读取（宽列、非覆盖索引）单页在限速冷盘上同步 2.7–5.9 秒，形态上与客户现场「`livez` 1.5–2.2 秒、不崩溃」一致。归因边界见 Spec §1.4：只证明量级与时段强相关，没有把每次卡顿逐条对到语句。
3. **本机限速是复盘值的复现，不是客户盘实测。** 客户盘真实随机读延迟未知，UAT-COLD-06 待客户配合。
4. 改后跑次沿用同一套件：`npm run uat:cold-start -- all --new-image <候选镜像> --window-s 600 --premigrate-wait-s 1800`，另跑 `pagecost` 对照。

## 备注

- 是否使用 `docker restart`：**否**（每个用例均为整卷复制＋新建容器＋清页缓存）。
- 04 的 `--warm-start` 仅用于改前基线，正式门禁不得使用。
- 清理是否完成：运行容器已删；数据卷 `lucy-uat-cold-*` 保留以便复跑，`npm run uat:cold-start -- clean` 可清除。
- 脚本修正记录：首次 02 基线因 `docker logs` 的 stderr 未被收集，看不到崩溃原因；已修脚本并**重跑**，本跑次采用重跑结果。
