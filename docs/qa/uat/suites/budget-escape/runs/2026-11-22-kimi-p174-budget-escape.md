# Run — 2026-11-22 — P1-74 问询预算主路径逃生 UAT（实施后全真）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUDGET-ESCAPE`（P1-74／REQ-030-095）v1.0 |
| Agent | Kimi Code（实现代理兼 UAT 执行）；BESC-11 真实 Agent＝Kimi Code CLI 2.7.2（未为本测试修改） |
| 环境 | 本机 demo Docker `compose-lucy-1`（**平滑升级**，`preserved=true`，未用 `--fresh`／`down -v`／`docker restart`）；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；`gitSha=78c8d259…`（`gitDirty=true`，含本条实现） |
| 身份 | `demo_agent`（demo_readonly；**未显式授予 `lucy_continue_question`**——BESC-09C legacy 实况）；token sha256 前 12 位 `8ccee2d00afb`；来源 `~/.cursor/mcp.json`，Bearer 经环境变量注入，**未写入证据** |
| 事实 oracle | 容器内独立只读 SQL：`COUNT(DISTINCT order_id) WHERE is_deleted=0`＝**1000**；总销售额 1,459,476.10；总利润 294,190.22；整体利润率 20.16%；region 利润率 Central South 21.01%（最高）／Northeast 19.04%（最低） |
| 成交定义 | `lucy_query` 工具成功 **且** `order_count==1000`（或题面各项与 oracle 逐项一致） |
| 证据目录 | `inbox/uat-besc-2026-11-22/`（Bearer／continueToken 已脱敏） |
| 总判定 | **PASS WITH GAPS**：必做 13 项中 R0／01–06／08／09（A/B/C）／10B／11／12 的**功能轴**全部 PASS；**BESC-07／10A＝BLOCKED**（环境构造不能，原因见下）；按 suite 判定口径 6「任一 BLOCKED 不得记完整 PASS」，如实记 **PASS WITH GAPS，不是完整 PASS** |

## 逐案结果

| Case | 结果 | 证据摘要 |
|---|---|---|
| UAT-BESC-R0 | **PASS** | health `status=ok`、`ktxRuntime.ready=true`、`gitSha=78c8d259…`；`initialize` 取得 `mcp-session-id`；instructions 8361 字符含 `question_budget_exhausted` 处置、`new_question`、「not a permission denial」、「up to 5 times」，inactive 模式**不点名 begin**；`tools/list`：**begin 隐藏**、**continue 可见（D7，无显式授予）**、lucy_query 可见。证据：`r0-env.json` |
| UAT-BESC-01 | **PASS** | 全新 session 已知零态：第 **61** 次 `question_budget_exhausted`（`continuable=true`），第 **62** 次无显式动作仍停机未执行。证据：`besc-01-window61.json` |
| UAT-BESC-02 | **PASS** | inactive＋无 session：首窗触顶 `continuable=true` → 默认 mode 声明 → 下一数据工具换窗放行，`order_count=1000==oracle`。证据：`besc-02-03-04-08-09a-chain.json`（窗 1–5 各 61 次触顶） |
| UAT-BESC-03 | **PASS** | 连续 5 次换窗每窗成交；第 6 次声明**独立证据**：`besc-03-sixth-declare.json`（硬停后 continue 声明 `{ok:false, reason:"no_credit"}`；本生命周期跨进程累计 5 档用尽，亦证持久态跨进程）；随后无声明数据调用硬停 `continuable=false`。首次链式跑 window0 剩 40 次触顶（先前失败跑次残留 20 次，已披露），窗 1–5 均为满 61 次 |
| UAT-BESC-04 | **PASS** | 硬停载荷：`reason=question_budget_exhausted`、`continuable=false`、`next_step={action:lucy_continue_question, mode:new_question, then:retry_data_tool}`；reason 全文无 forbidden／denied／权限字样；执行该 next_step 后查询成交 1000。证据：同上 chain |
| UAT-BESC-05 | **PASS** | 真实 compat 两跑 runner 原始 JSON：预算 attempt `reason=question_budget_exhausted` 直读；**顶层 reasons 无 `new deny`**（功能轴 PASS）；expected deny 案（禁用 connectionId）真实 ACL `tool_is_error`、归 `other` **未因 budget 字样假绿**；分列单测 9/9（exhausted／concurrency／unavailable 三分列）。证据：`compat-run1/`、`compat-run2/`、`mcp-compat-budget-escape.test.mjs` |
| UAT-BESC-06 | **PASS** | 停机当次 `reason=question_budget_exhausted`、RTT **31ms**；同分钟 `GET /api/health` `status=ok`、`ktxRuntime.ready=true`。两组事实并存。证据：`besc-06-health-contrast.json` |
| UAT-BESC-07 | **BLOCKED** | demo 卷无已发布口径绑定（`caliber-bindings` 目录不存在），begin 全量隐藏属 P1-60 默认实况；无 WebUI 管理员口令，无法按 begin-zero-binding A0 夹具发布绑定。不以 inactive 结果冒充 |
| UAT-BESC-08 | **PASS** | 强制 `lucy_begin_question`（带 intentSummary）→ `isError=true`、`reason=begin_not_available`；随后查询正常成交 1000，无「满血」重置。证据：chain（`beginNegPass:true`） |
| UAT-BESC-09 | **PASS** | A 无 session：硬停→`mode=new_question`（同 Token）→下一工具新窗成交 1000→新生命周期第二查 OK→**新进程**同 Token 再查成交；B 稳定 session：首窗 61 次触顶→续查成交→**断开重连（1.5s 后同 session 头）作用域未清零**→续查耗尽硬停→new_question 成交；C legacy：升级前 tools/list 无 continue（2026-11-16 跑次记录在案），**平滑升级后可见（D7）**，硬停→new_question→成交。证据：`besc-02-03-04-08-09a-chain.json`、`besc-09b-session.json`、`besc-09c-legacy.json` |
| UAT-BESC-10 | **A BLOCKED／B PASS** | A：demo 无真实受控慢源，无法在不改 `QUESTION_BUDGET_MAX_*`／不 mock 时钟下累计 settled busy ≥300s，记 BLOCKED；B：全新 session 查询成交 1000→**真实空闲 305 秒**（无计费调用）→再查成交 1000，idle 不触顶。证据：`besc-10b-idle.json` |
| UAT-BESC-11 | **PASS** | 真实 Agent（Kimi Code CLI 2.7.2，MCP-only 约束）×2 进程、同 Token 同 session 头（预耗尽 61 次构造触顶）：跑次 1 轨迹 `lucy_catalog→lucy_read_source(触顶, continuable=true)→lucy_continue_question→read_source→lucy_query×4`，无死循环，**最终答案逐项匹配 oracle**（1000／1,459,476.10／294,190.22／20.16%／Central South 21.01% 最高／Northeast 19.04% 最低），并在答复中披露续查事实；跑次 2（新进程）无预算事件，答案同样逐项匹配。轨迹：`besc-11-agent-run1.stream.json`、`besc-11-agent-run2.stream.json`（continueToken 已脱敏） |
| UAT-BESC-12 | **功能轴 PASS（两跑）** | 同 Token 连续两跑完整 candidate（聚焦套件 `besc-12-suite.yaml`，`--budget-escape`，不同结果目录）：跑次 1 目标 allow 案 QB-BESC-BIZ-01 重现 Wave D 形态（`question_budget_exhausted`）→runner 自动 continue（escRound 1）→**真实成交**，4/4 案 PASS；跑次 2 同 Token 第二进程 4/4 案 PASS（未继承旧硬停）；begin 不可见 4/4 走 N 路径（`skipped:begin_not_visible`）；无陈旧 turn。总状态 BLOCKED 仅因**样本数 7/5<20 与 AGENT_ADAPTER_MISSING（未选 client）**——时延轴与 Agent 轴缺口，**功能轴两跑均 PASS**；JOIN chasm／ACL-03b 等另案未纳入本套件（按原结论保留）。证据：`compat-run1/`、`compat-run2/` |

## 跑次说明与诚实披露

1. **BESC-12 套件为预算聚焦派生套件**（4 案／单 identity），非 Wave D 全量 34 案分母：Wave D fixture 角色的 13 个 token 已轮换（`inbox/wave-d-compat-tokens.env` 为旧世代，与现行 `inbox/wave-d-compat-root/webui/config/access.yaml` 全部不匹配，401），无管理员口令无法重建身份。按 BESC-12「另案独立保留」口径，用 demo_agent 同 Token 复现「同 Token 粘滞桶→逃逸成交→第二跑不继承失败」的闭环；全量 Wave D 回归需委托人补 fixture token 后另跑。
2. **完整 candidate 全量重跑（含 agent 轴、34 案）曾用 `--selected-client kimi-code-cli --agent-concurrency 4` 启动一次，runner 在 agent 轴前挂起 20 分钟（事件循环全空闲、无 socket）**；因 token 已 401 无意义，已终止，未计入证据。挂起点未复查（另案）。
3. BESC-03 首链 window0 为残留窗口（40 次触顶），窗 1–5 均为满 61 次；第 6 次声明拒绝以 `besc-03-sixth-declare.json` 独立补证（该生命周期跨 3 个进程累计 5 档，亦证持久化跨进程）。
4. BESC-11 首版 agent 工作目录在仓库内，agent 绕过 MCP 用本地 shell 查库（该跑次作废未计）；重跑在 `/tmp` 空目录＋MCP-only 约束下完成，两跑均全程走 lucy MCP 工具。
5. BESC-07／10A 为环境 BLOCKED（无 active 绑定夹具／无慢源），未用任何替身、降阈值或 mock 冒充。
6. 未改动 `QUESTION_BUDGET_MAX_*`、未 `LUCY_QUESTION_BUDGET=off`、未 mock 时钟；BESC-09/11 未重签 Token、未重启容器、未清预算库。

## 与改前基线对照

- Wave D（2026-11-22 上午，PM 报告）：同 Token 多跑次后 14 条 `question_budget_exhausted` 假红、顶层 `new deny`、无逃生 → 本跑次同形态预算命中可被 runner/agent **合同内自动恢复并真实成交**，顶层归因直读预算 reason。
- 2026-11-16 P1-12 跑次：demo_readonly `tools/list` 无 continue、触顶 `continuable=false` 无通道 → 本跑次同身份 **D7 可达**、inactive 5 档＋硬停 new_question 全通。

## 清理

- 未创建／未删除任何 Role／Agent／Token；`access.yaml` 未被本 UAT 修改（compat runner 的 A1 profile 自行 backup/restore，跑后校验 demo token 仍可用）。
- 临时身份：`uat-besc-*` session 头为进程内标识，非服务端实体，无需删除。
- 未使用 `docker restart`；平滑升级 `preserved=true`。

## 未覆盖（不得据此宣称）

- begin **active** 实况的续查 1 档回归（BESC-07 BLOCKED，非产品 FAIL）。
- busy 维度触顶逃生（BESC-10A BLOCKED，非产品 FAIL）。
- 全量 Wave D 34 案分母的同 Token 两跑（fixture token 轮换，另案）。
- 本跑次 **≠ 完整 PASS**（两项环境 BLOCKED）；功能合同收口与可上线判断须由委托人按 DEVELOPMENT 漏斗另行裁决。
