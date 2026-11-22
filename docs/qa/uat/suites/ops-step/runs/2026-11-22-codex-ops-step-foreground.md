# P1-68 运维步骤账前台复测（2026-11-22）

| 项目 | 结果 |
|---|---|
| 套件 | `UAT-SUITE-OPS-STEP`／P1-68／REQ-030-089 |
| 选测结果 | **前台补跑 FAIL**。两个准备入口、51／52 表对号、同卷重启历史通过。管理页 E4 单次失败提示未达到期望；超过行数上限时新增的终态可在文件中核对，管理读模型未返回该步骤。 |
| 范围 | UAT-OPS-STEP-04、05 前台与持久化路径；另验 Hive 列名／读字段失败及入口 503 后自助查看。原 R0／01–08 跑次见[历史记录](2026-11-22-cursor-ops-step.md)。 |
| 候选 | Lucy `0.30.0`，`gitSha=8fe7cebc0e73d98aba3e687899fb83e34651e0aa`，`gitDirty=false`，使用本机已构建镜像 `sha256:e4ad33064b9cb6df1451cbe4141a33118c24e5c2657d40c83b79c5bb32bd7713`。P1-68 相关 WebUI／服务端路径与执行时 HEAD 一致。 |
| 环境 | 独立 demo Docker，Lucy 2 CPU／4 GiB，WebUI 环回端口 55582，专用内容卷。MySQL 8.4 与 Doris 2.0.14 → Hive 4.0.0 Metastore，均为合成空表。 |
| 浏览器 | 前台 Chrome `157.0.8103.79`，1920×1080。每笔计时起止均校验 `hasFocus=true`、`visibilityState=visible`。 |
| 时间 | 18:27:52–18:30:27（北京时间）。 |

## 页面与同次 API 分列计时

页面计时从侧栏点击、页面硬导航或准备入口实际触发请求的点击开始，止于对应内容可见后的双绘制帧。API 计时使用浏览器记录的同次请求开始到响应接收结束。下表为单次实测，单位毫秒。准备入口的故障造数在点击之前完成，耗时表以各次用户动作为计时起点。

| 场景 | 页面 | 同次 API | 结果 |
|---|---:|---|---|
| 运维步骤，硬导航 → 空态可见 | 104.4 | GET 200，5.6 | 通过 |
| 点击侧栏「运维步骤」→ 已结束记录可见 | 83.7 | GET 200，4.0 | 通过 |
| 运维步骤，点击刷新 → 注入 2 秒延迟后列表可用 | 2064.6 | GET 200，2018.1 | 刷新期间旧记录和加载状态可见 |
| 运维步骤，点击刷新 → 单次错误后列表恢复 | 1328.8 | 首次 GET 500，8.8；自动重试 200 | **E4 失败**，页面保留旧记录并自动恢复，未显示合同约定的错误区域与重试按钮 |
| 运维步骤，点击刷新 → 行数截断提示及进行中步骤可见 | 262.5 | GET 200，8.2 | 1001 次真实步骤操作后，`row_limit` 与在途同时可见 |
| MySQL，连接页 → 表名选择可见／读字段错误及操作号可见 | 63.8／47.0 | POST 200，35.6／POST 400，9.0 | `read_columns:fail/missing` |
| MySQL，向导第 2 步 → 表名选择可见／读字段错误及操作号可见 | 61.6／81.0 | POST 200，24.9／POST 400，44.4 | `read_columns:fail/missing` |
| Hive 外部目录，连接页 → 表名选择可见／读字段错误及操作号可见 | 111.4／62.2 | POST 200，60.0／POST 400，28.5 | `read_columns:fail/missing` |
| Hive 外部目录，向导第 2 步 → 表名选择可见／读字段错误及操作号可见 | 44.7／61.1 | POST 200，17.0／POST 400，20.7 | `read_columns:fail/missing` |
| Hive 外部目录链路中断，连接页 → 读表名失败及操作号可见 | 19097.3 | POST 400，19061.1 | `list_tables:fail/timeout` |
| Hive 外部目录链路中断，向导第 2 步 → 读表名失败及操作号可见 | 14330.8 | POST 400，14293.7 | `list_tables:fail/unreadable` |
| Hive 跑次强制重启前，运维步骤硬导航 → 在途记录可见 | 108.5 | GET 200，3.4 | `read_ktx_yaml` 进行中 |
| Hive 跑次强制重启后，运维步骤硬导航 → 旧操作记录可见 | 178.8 | GET 200，7.9 | `read_ktx_yaml` 上次进程未完成 |

两处准备入口均先在页面取得真实表名，再从相应数据源删除选中的哨兵表，由页面发起读取。API 原句、页面汇总原句和逐表操作号均核对。Hive 列名故障通过停止专用 Doris 前端断开 Hive 外部目录读取链路，之后恢复前端。该场景覆盖读取链路不可达。操作号逐个对齐页面、API、stdout 与 JSONL 文件。被核对的结构化日志只有冻结键，单行含换行不超过 512 字节，未包含哨兵表名或 SQL。管理员页面、过滤和写入健康可见，未登录读取返回 401。

### SC-17 的跨批关联

MySQL 夹具按顺序选中 51／52 张真实空表，随后删除第 1、51 张。实际请求表集合和失败行的逐表操作号均与所属请求一致。

| 入口／表数 | 点击到两个错误操作号可见 | 第 1 批 API | 第 2 批 API |
|---|---:|---|---|
| 连接页／51 | 115.5 | 50 张，200，54.9 | 1 张，400，11.5 |
| 向导／51 | 97.3 | 50 张，200，41.3 | 1 张，400，13.2 |
| 连接页／52 | 115.3 | 50 张，200，12.5 | 2 张，200，38.1 |
| 向导／52 | 81.2 | 50 张，200，12.5 | 2 张，200，12.0 |

## 503 后从页面取回历史

1. 通过挡板启动真实诊断采集器并托住已登记的读取步骤。Hive 跑次操作号 `ops_5cf3942d24771db1cfbc59429fef532e` 的 `read_ktx_yaml:enter` 在前台列表、容器 stdout 和内容卷 JSONL 均可见。文件里同操作的一些并行步骤已完成，`read_ktx_yaml` 仍在进行中。
2. 对专用 Lucy 容器发 SIGKILL。只在本机运行的测试网关实际连接 Lucy 上游，依次观测到 200 → 503 → 200，503 来自网关在 Lucy 不可达时的响应。用同一容器、同一内容卷启动新的 Lucy 进程。MySQL、Hive 两轮分别执行了该验证。
3. 恢复后使用管理员页面按同一操作号筛选，`read_ktx_yaml` 位于「已结束」区，显示「上次进程未完成」、用时未知，且当前进行中无该操作号。事实行仍只有 enter。按四个 Hive 操作号逐个查找，两个列名失败和两个字段读取失败均可打开查阅。MySQL 两个失败操作号也在该轮重启后找回。

通过范围是已登记且重启前成功写入内容卷、仍在历史窗口内的步骤。页面历史按最近 1 小时或 2000 行受限。网关 503 本身会出现在网关记录里，P1-68 提供的是同一时间段内已进入 Lucy 的命名步骤。未登记代码、尚未进入 Lucy 的请求及文件丢行没有对应的可恢复步骤证据。更深入的 Hive／Doris 错因仍需对应日志，步骤账展示的是操作、阶段和原因码。

## 管理页缺口和剩余矩阵

- **E4／SC-11 FAIL**。按既定用例注入一次真实 500，浏览器自动重试后获得 200，只显示加载和原记录，未出现错误提示与手动重试。证据保留真实 HTTP 顺序 `500 → 200`。
- **E7 行数截断和在途可见通过**。补充核对发现，随后完成的同一 `read_ktx_yaml` 在文件与 stdout 都有且只有一条 leave，按操作号读取管理 API 时，该步骤已从历史中裁掉，只返回后来开始的 `read_reload_state`。该限制影响高频写入期间通过页面追索刚结束的长步骤。
- E1／E2／E3／E5／E6／E8／E9 的本轮观察从截图与结构化证据复核。真实 1 小时边界、文件残行及轮转、服务用户追加拒绝、Linux 背压门槛、双连接重载配对、前台启用表保存，以及全套各操作审计水位均无本轮新增证据。

## 证据

[运维步骤页面 E1–E9 逐项结果](../../../../../reviews/2026-11-22-p1-68-ops-step-browser-evidence.md)。演练后确认 Lucy 健康、Doris 可重新列出 Hive 目录，随后清理专用容器、卷和网络。

[镜像与内容卷](2026-11-22-codex-ops-step-artifacts/candidate.json) · [MySQL 前台及重启](2026-11-22-codex-ops-step-artifacts/browser-mysql.json) · [Hive 前台及重启](2026-11-22-codex-ops-step-artifacts/browser-hive.json) · [51／52 表的请求和步骤行](2026-11-22-codex-ops-step-artifacts/browser-batch.json) · [管理页前台数据](2026-11-22-codex-ops-step-artifacts/browser-page.json) · [达到行数上限后的终态](2026-11-22-codex-ops-step-artifacts/row-limit-terminal.json) · [校验和](2026-11-22-codex-ops-step-artifacts/SHA256SUMS)。

[连接页 Hive 表名失败](2026-11-22-codex-ops-step-artifacts/hive-connections-list_tables.png) · [向导 Hive 表名失败](2026-11-22-codex-ops-step-artifacts/hive-wizard-list_tables.png) · [连接页 Hive 字段失败](2026-11-22-codex-ops-step-artifacts/hive-connections-read_columns.png) · [向导 Hive 字段失败](2026-11-22-codex-ops-step-artifacts/hive-wizard-read_columns.png) · [重启前进行中](2026-11-22-codex-ops-step-artifacts/hive-inflight.png) · [重启后未完成](2026-11-22-codex-ops-step-artifacts/hive-previous-incomplete.png) · [重启后的失败历史](2026-11-22-codex-ops-step-artifacts/hive-failed-history.png)。
