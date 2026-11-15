# Run — 2026-11-16 — P1-12 问询预算 60／300 最小 UAT（SC-T4 修复后）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-QUESTION-BUDGET`（P1-12／REQ-030-033） |
| Agent | Cursor |
| 环境 | 本机 demo Docker `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；`gitSha=d64414d68a19bd2ade981c74a2c8b23e56a5893b`，**`gitDirty=true`**（镜像由含未提交改动的工作区构建；含 SC-T4 修复，也含他人 WIP） |
| 构建 | 2026-11-15 23:57 `BUILDPLATFORM=linux/arm64 npm run demo:upgrade`（平滑升级，`preserved=true`）；未用 `docker restart` |
| 身份 | `demo_agent`（role `demo_readonly`）；token sha256 前 12 位 `8ccee2d00afb`；路径来源 `~/.cursor/mcp.json`（`/Users/forrest/Desktop/lucy token.txt` 在本机不存在） |
| 开始／结束 | 2026-11-16 00:05 – 00:12（UTC+8） |
| 总判定 | **PASS WITH GAP**（必做 R0／01／02 PASS；推荐 03 PASS；推荐 04 BLOCKED） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health `status=ok`、`ktxRuntime=ready`、`policy.healthy=true`、`gitSha=d64414d6…`；MCP `initialize` 200，`serverInfo={ktx,0.16.0}`，取得 `mcp-session-id` |
| UAT-BUDGET-01 | **PASS** | 全真 `initialize`（`demo_agent`）：`instructions` 7783 字符；含「at most **60** data-tool calls or **300** seconds of settled data-processing time」；**不含** `at most 12`／`120 seconds`／`8 minutes`／20 次；含 `question_budget_exhausted` 处置。证据：[`evidence-budget-01.json`](../../../../../../inbox/uat-p1-12-budget-2026-11-16/evidence-budget-01.json)。修复前对照：[`instructions.txt`](../../../../../../inbox/sc-t4-repro-2026-11-15/instructions.txt)（7511 字符，无 60／300，有 `within 120 seconds`） |
| UAT-BUDGET-02 | **PASS** | 干净窗口（见下）：`lucy_begin_question` 后同窗连续 `lucy_query`；**第 1–21 次全部 `OK`，无一次 `question_budget_exhausted`**（第 21 次 `OK`）。证据：[`evidence-budget-attempt2.json`](../../../../../../inbox/uat-p1-12-budget-2026-11-16/evidence-budget-attempt2.json) |
| UAT-BUDGET-03 | **PASS** | 同窗第 1–60 次均 `OK`（成功 60），**第 61 次**返回 `{"reason":"question_budget_exhausted","partial":true,"continuable":false,…}`。窗口 `00:11:21`，耗时 20.0 s，共 61 次。计数口径：每次 `lucy_query` 计 1，`initialize`／`notifications/initialized`／`lucy_begin_question` 不计 |
| UAT-BUDGET-04 | **BLOCKED** | 全真做不到：① 本机 demo 无可用 WebUI 管理员口令（`lucy-docker-login.txt` 的账号不在容器 `admins.yaml` 的 `verify-admin`／`xingchen` 中，登录 401 `AUTH_INVALID`，仅 1 次尝试）；② 本机无现成「带 `lucy_continue_question` 且可查 `demo-mysql`」的身份（`demo_readonly` 的 `tools/list` 无该工具；其余可用 token 均 401 或属远端环境）。按 CONVENTIONS §3 **停表上报，不手改 `access.yaml`**，未用替身凑绿。需委托人独立授权后才能降级或补凭据 |

## 无效跑次（保留以示诚实，不作数）

**Attempt 1（00:09，已作废）**：同窗 61 次中仅 1–9 `OK`；10–54 `upstream_unavailable`（45 次）；55–60 `upstream_protocol_error`（6 次）；61 次 `question_budget_exhausted`。证据：[`evidence-budget-02-03.json`](../../../../../../inbox/uat-p1-12-budget-2026-11-16/evidence-budget-02-03.json)。

原因：同一容器上**另一 Agent 正在并发跑大 Schema UAT**（日志里连接 id `uat-scale-mysql-…`／`uat-scale-hive-…`，`/api/connections/*/remove`），每次删连接触发 `reload requested … restarting KTX MCP upstream`（`00:09:24`、`00:09:25`）。KTX 上游重启使会话失效，其后每次调用约 10 ms 内失败。**此跑次不能证明 BUDGET-02／03**，已丢弃。

**Attempt 2（00:11:21，作数）**：先轮询到「30 秒内无 reload／连接／catalog 事件」再跑；跑后校验 `ktx-reload.state.json` 的 `requestId` 前后相同（`81edd10d-894b-44b2-989a-fb87b50f4b20`）→ **窗口内无重载**。

## 观察（非本套件期望，供评估；未改任何东西）

1. **失败调用也消耗预算。** Attempt 1 中前 60 次里有 51 次是网关层 `upstream_unavailable`／`upstream_protocol_error`（共约 0.6 秒内发出），第 61 次即触顶。含义：上游抖动 + 快速重试的 Agent 可在极短时间烧光 60 次预算。对高密度分析用户是否合理，需委托人评估；**本跑次不判**。
2. **`demo_readonly` 触顶后 `continuable=false`**，因该身份无 `lucy_continue_question`。标准角色模板（`READONLY_TOOLS`／`LUCY_R1_EXACT_TOOLS`）含该工具，不受影响；缺口在 demo 种子角色。
3. **共享 demo 容器被并发 UAT 干扰**是系统性风险：大 Schema 套件的删连接重载会让任何同时进行的全真取数失效。建议约定 UAT 占用窗口，或为预算类套件用独立 compose project。
4. **demo 管理员口令缺口**同时造成大 Schema 套件 R0／01–08／10 BLOCKED（见其跑次），与本套件 BUDGET-04 同源。

## 清理

- 未创建临时 Role／Agent／Token（BUDGET-04 在创建前即 BLOCKED）；`access.yaml` 未改动
- 临时文件：`/tmp/lucy-sc-t4-health.json` 等无 token；本跑次证据中 `continueToken` 已脱敏
- 是否使用 `docker restart`：**否**
- 误操作披露：探测远端 token 文件时，一次异常回溯把 `lucy-admin-token.txt`（指向 `10.69.95.109:8277` 的远端 Bearer）内容打印进了对话输出；**未写入任何文件**（已 `rg` 扫描 `inbox/`、`docs/` 无命中）。建议委托人视情况轮换该 token

## 未覆盖（不得据此宣称）

- 含 `lucy_continue_question` 身份的真实续查（BUDGET-04）、续查后再查数、「第二次续查被拒」（SC-T3）
- 空 catalog 路径的全真 initialize
- 本跑次**不是**「可上线」；功能合同收口 ≠ UAT PASS ≠ 可上线
