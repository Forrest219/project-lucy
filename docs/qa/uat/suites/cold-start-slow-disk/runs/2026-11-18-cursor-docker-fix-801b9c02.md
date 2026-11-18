# Run — 2026-11-18 — cursor-docker-fix-801b9c02（放宽 02 门槛后的取证跑次）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-COLD-START-SLOW-DISK` |
| Agent | Cursor |
| 环境 | 本机 Docker Desktop（arm64）；限速读写各 30MB/s、读 300／写 100 IOPS、2 核（`/dev/vda`）；每次启动前宿主 `drop_caches`；**种子快照本次重新生成**（`seed --reseed`，最新行 `ts` = 2026-11-17 23:56:53Z，200,000 行、67 用户、30 天） |
| 被测构建 | `project-lucy:cold-fix-801b9c02`，由提交 `801b9c023ed8e7ac5725eda0862fc34c0028e69d` 的 `git archive` 干净树构建（`LUCY_GIT_DIRTY=false`）。服务端代码与此前 `cold-fix-p139c` 逐文件比对一致（`diff -rq` 仅差 `.DS_Store`）。对照：`project-lucy:old-9c78b0e3`（0.25.0） |
| 命令 | `npm run uat:cold-start -- all --new-image project-lucy:cold-fix-801b9c02 --label fix-801b9c02 --window-s 120 --premigrate-wait-s 1800`；03 复跑：`cold03 … --label fix-801b9c02-rerun`。证据：[evidence/2026-11-18-fix-801b9c02/](evidence/2026-11-18-fix-801b9c02/)（含 `rerun-03-04/`） |
| 门槛 | 02：livez max ≤ 2000ms、p99 ≤ 1000ms（Spec OQ-2 已决，委托人 2026-11-18 批准）；03／04：max ≤ 1000ms、p99 ≤ 400ms；readyz p99 ≤ 1500ms |
| 总判定 | **FAIL**。R0／01／02／05 PASS；**03／04 FAIL** |

| Case ID | 判定 | 证据摘要 |
|---|---|---|
| UAT-COLD-R0 | PASS | 限速 31.2 MB/s；快照存在 |
| UAT-COLD-01 | PASS | 0.25.0 在同台 30.8 秒就绪 |
| UAT-COLD-02 | **PASS（新门槛）** | 122.8 秒就绪；不崩；重启 0；livez max **788ms**／p99 **694ms**（门槛 2000／1000）；readyz p99 315ms（p50 6ms／p95 219ms）；全 200。注：这一次 p99 694ms 同样超过旧门槛 400ms，说明放宽不是为了让某个偶然值过关 |
| UAT-COLD-03 | **FAIL** | 38.9 秒就绪；不崩；livez max 8002ms／p99 8002ms，1 次非 200（客户端 8 秒超时）；readyz p99 300ms。复跑 livez max 7493ms，同样复现 |
| UAT-COLD-04 | **FAIL** | 39.1 秒就绪；livez max 7399ms／p99 7399ms；readyz p99 13ms。复跑未执行（03 复跑失败后脚本串联中止） |
| UAT-COLD-05 | PASS | 管理员认领 159ms；`/api/project` 7ms；建角色／Agent／令牌 946ms；MCP initialize 49ms、tools/list 29ms |

## 03／04 失败的原因（已核实的部分与推断的部分）

**已核实**

1. 失败不是环境噪声：同一台机器、同一镜像，复跑复现；改成手工起容器（同限速、同卷拷贝）、从宿主与从容器内各探一次，两处都看到同样的 1.2／7 秒停顿，宿主和容器内 `livez` 排队形状一致（6849、5845、4843……每秒递减 1000ms，即一次停顿后积压的探测一起返回）。
2. 容器内 webui 进程（Node 主进程）处于 `D` 状态（等磁盘），累计写入 100MB+ 且仍在持续写；审计库 `audit.sqlite` 从 988MB 涨到 1.13GB。
3. 审计库里 `inferred_turns.updated_at` 的最大值**就是当前时刻**，每隔二三十秒多一个用户被重建（`uat-cold-user-002`、`003`、`004`……）。也就是说 03 的「重启」并没有做到「没有新行的用户不重建」；观察到前 5 个用户陆续被重建，67 个用户同属一个时间戳区间，按覆盖判定同样应被标脏（后者由判定公式推出，未逐个观察）。
4. 本次种子快照里，用户最新一行 `ts` 为 23:56，预迁移（premigrate）完成补算的时间是 00:03，差 7 分钟，小于覆盖判定的 15 分钟余量（`INFERRED_COVERAGE_MARGIN_MS`，Spec SC-14）。覆盖判定 `builtAt − 15min ≥ newestAt` 因此为假，重启后这些用户被标为需重算。
5. 重算时对已有推断问询的用户先整窗口删除：`webui/server/proxy/audit.ts` 的 `DELETE FROM inferred_turn_access_logs … WHERE inferred_turn_id IN (…)` 与 `DELETE FROM inferred_turns WHERE user_id = ? AND started_at >= ?` 各是一条不分片的语句（约 3000 个问询＋3000 条关联）。首次升级（02）时库里还没有这些行，删除是空操作，所以这条路径在 02 里从未被测到。

**推断（未直接重放验证）**

- 此前 `cold-fix-p139c` 跑次 03／04 PASS，是因为当时种子的最新行比预迁移早数小时（种子 15:34Z，预迁移在之后数小时），覆盖判定为真、重启时不重算。依据是时间戳比对，没有用旧种子重放。
- 1.2／7 秒量级的停顿来自上述不分片删除及其后的写入在限速盘上的同步 I/O。`--cpu-prof` 的服务端主进程画像没有抓到这段（SIGTERM 退出时主进程画像未必落盘），所以这一条是由 `D` 状态、写入量与重算时间线推断，不是画像直接证明。

## 结论与待决

- 02 在放宽后的门槛下 PASS；01／05 PASS；R0 PASS。
- 03／04 FAIL 暴露了一条此前没有用例覆盖的真实路径：**重启时存在「最新行距上次重算不足 15 分钟」的用户，会触发整窗口删除加重建，且删除不分片**。客户现场里，只要重启发生在用户活跃之后不久，就会走到这里。
- 这是主路径可用性问题（合法用户在重启后的几分钟内 livez 出现秒级停顿），不能用放宽 03／04 门槛糊过去。
- 候选处置（需委托人批准，涉及 `webui/server/proxy/audit.ts` 的替换事务语义）：(a) 把整窗口 DELETE 改为按 `inferred_turn_id` 分片删除并 `rest()` 让出（会放宽「删除加插入同一事务」的原子性，需明确回滚口径）；(b) 评估覆盖判定是否可对「只差余量内」的用户只补算增量而不全窗口替换；(c) 另增专用 UAT 用例「重启时有已建用户需重算」。
- 夹具侧：本轮没有改种子脚本。若委托人确认 03／04 的门槛本意是「静默用户重启」，应把种子最新行 `ts` 提前，或在预迁移后等满 15 分钟，并另设上述专用用例覆盖「活跃用户重启」；两件事不要混在一个用例里。
