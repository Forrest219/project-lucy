# Cases — UAT-SUITE-BUDGET-ESCAPE

| 元数据 | 内容 |
|---|---|
| UAT 设计版本 | **v1.0（定稿）** |
| 执行状态 | NOT RUN；实跑另按授权与跑次记录 |
| 公共判定 | 真实 MCP／compat／Agent；成交必须匹配独立数据库 oracle；所有必做项不得相互替代 |

| ID | 标题 | Spec | 层级 | 期望摘要 |
|---|---|---|---|---|
| UAT-BESC-R0 | 环境、身份、会话与事实 oracle | — | 手工／脚本 | 固定版本、授予、session 模式、预算初态和事实答案 |
| UAT-BESC-01 | 单窗第 61／62 次触顶且不自动放行 | SC-E1 | MCP 全真 | 次数触顶；无显式动作不执行后续查询 |
| UAT-BESC-02 | inactive＋无 session：第一次续查真实成交 | SC-E2 | MCP 全真 | continue 换窗；query 成功且匹配 oracle |
| UAT-BESC-03 | inactive：完成 5 次换窗并验证第 6 次硬停 | SC-E3 | MCP 全真 | 每窗成交；第 6 次声明与后续停机分别验证 |
| UAT-BESC-04 | 硬停非 ACL 且 next_step 实际可达 | SC-E4 | MCP 全真 | 非权限归因；执行提示路径后真实成交 |
| UAT-BESC-05 | 真实 compat 判定分列 budget／ACL／平台错误 | SC-E5 | compat 全真 | allow 不假 deny；deny 不假绿；手记不算证据 |
| UAT-BESC-06 | 健康绿不否定触顶 | SC-E6 | MCP＋health | 同时留下预算码、RTT 与 health 证据 |
| UAT-BESC-07 | begin active 回归 | SC-E7 | MCP 全真 | 续查仍 1 档；新 begin 后真实成交 |
| UAT-BESC-08 | begin_not_available 无 reset | SC-E8 | MCP 全真 | 强制 begin 无新 turn／换窗；后续仅正常计费 |
| UAT-BESC-09 | **第一性原理全生命周期看守** | SC-E9／DEVELOPMENT | MCP 全真 | 续查耗尽后，同 Token 新问询仍真实成交 |
| UAT-BESC-10 | busy 触顶／逃生与 idle 对照 | SC-E1 伴生 | MCP 全真 | busy 触顶且能逃生；纯 idle 不触顶 |
| UAT-BESC-11 | 真实 Agent 长问询与跨跑次恢复 | 第一性原理伴生 | Agent 全真 | 工具轨迹含合同内逃生；最终答案匹配 oracle |
| UAT-BESC-12 | Wave D：同 Token 两次真实 compat 成交 | SC-E10 | compat 全真 | 目标 allow 案恢复成交；budget 不误报 ACL；另案独立保留 |

---

## 公共定义与证据

- **合法身份**：Token、Agent、数据工具、connection、source 和行权限均允许 fixtures 查询；开跑前用普通查询匹配 oracle，排除 ACL／语义／连接故障。
- **无 session**：数据调用不携带 `mcp-session-id` 或 `x-lucy-session-id`。使用稳定 session 的另一变体必须记录脱敏 session 标识和实际请求头证据。
- **显式新问询**：inactive 硬停后调用 `lucy_continue_question`，参数为 `mode="new_question"` 和硬停返回的 `token=continueToken`；active 硬停仍调用 `lucy_begin_question`。声明只写 pending，下一计费数据工具才兑现。若合同没有该动作，BESC-09 对应步骤 FAIL，不得用重签 Token、清库、重启或关闭预算代替。
- **真实成交**：工具成功、返回 fixtures 预期事实行，关键值匹配独立数据库只读 oracle。`not executed`、空 envelope、ACL／语义／上游错误均不算成交。
- **预算证据**：逐窗保存脱敏 identity／session、round、windowId、calls、busyMs、continuations、requestId、reason、continuable 和审计快照；不得记录 Token 明文。
- **改前基线**：按真实结果保留 FAIL；不得为适配旧缺陷删去新问询、真实成交、无 session 或真实 Agent 断言。

## UAT-BESC-R0 — 环境、身份、会话与事实 oracle

### 步骤

1. `GET /api/health`，记录版本、gitSha、dirty、镜像／配置指纹和 KTX 版本。
2. 对每类身份执行真实 MCP `initialize`／`tools/list`，记录 begin、continue 和数据工具可见性。
3. 明确标记本例为无 session 或稳定 session；稳定 session 保存实际返回及后续复用证据。
4. 读取脱敏预算初态：round、windowId、calls、busyMs、continuations；非已知零态不得用于次数边界判定。
5. 用独立数据库只读 SQL 计算 fixtures oracle，再执行一次普通合法 query 核对。

### 期望

- 环境、身份、授权、数据 oracle 和预算初态均可复查。
- 零绑定／active、continue 授予、有无 session 不得靠口头假设。
- 缺真实环境、oracle 或初态证据 → 对应用例 BLOCKED；不得用 mock／CR 凑绿。

## UAT-BESC-01 — 单窗第 61／62 次触顶且不自动放行

### 前置

- 合法身份可见 continue；使用已知 `calls=0`、`busyMs<300000` 的新临时身份或 active begin 新窗。
- inactive 下不得以清库、改阈值或旧桶未知计数冒充零态。

### 步骤

1. 同窗执行 **60** 次 fixtures 计费查询；逐次确认未触顶，记录实际准入计数。
2. 第 **61** 次发同形查询，保存工具响应、requestId 和审计快照。
3. 不调用 continue／新问询，再发第 **62** 次查询。

### 期望

- 第 61 次：`reason=question_budget_exhausted`，legacy outcome=`budget_stop`，执行结论为预算终止且 `notExecuted=true`，不是 ACL deny。
- 审计快照证明 `calls>=60`、`busyMs<300000`、`exhaustedBy=calls`／等价次数原因。
- 第 62 次仍预算终止且未执行；不得由下一次 query 自动换窗放行。
- 本条单独 PASS 不能结案本套件。

## UAT-BESC-02 — inactive＋无 session：第一次续查真实成交

### 前置

- 零绑定；`tools/list` 无 begin，强制 begin 为 `begin_not_available`。
- 合法 Token 可见 continue；数据调用不带 session 头。
- 已在 BESC-01 同身份同窗触顶，且首次续查额度仍在。

### 步骤

1. 读取触顶载荷的 `continuable`、`continueToken`。
2. 调用 `lucy_continue_question`，参数名 `token`＝`continueToken`。
3. 再执行一次 fixtures `lucy_query`，读取结果和预算状态。

### 期望

- 触顶时 `continuable=true` 且有非空 token。
- continue 声明成功；下一数据调用消费声明并换窗，windowId 增加、续查计数增加。
- query **真实成交并匹配 oracle**；不得仅以「未 exhausted」判 PASS。

## UAT-BESC-03 — inactive：完成 5 次换窗并验证第 6 次硬停

### 前置

- 同 BESC-02；合同默认 inactive `maxContinuations=5`。
- 固定同一身份和 session 模式；若使用有 turn 的历史桶，须另保留同 token 多窗凭证／幂等证据。

### 步骤

1. 从首次触顶起，重复 5 次：显式 continue → 新窗先执行一次 oracle 查询 → 推满该窗至再次触顶。
2. 每次记录声明响应、下一数据调用的换窗事实、windowId、continuations 和实际成交结果。
3. 第 **6** 次调用 continue，保存其独立响应。
4. 不再声明，直接发一次数据工具，保存硬停响应。

### 期望

- 5 次换窗均实际生效，每窗至少一次 query 真实成交；不是只返回成功声明。
- 第 6 次 continue 明确返回 `ok=false`／`no_credit` 或合同等价拒绝，不得再次换窗。
- 随后的数据调用返回 `question_budget_exhausted`、`continuable=false`，并进入 BESC-04 的硬停检查。
- 续查声明拒绝与数据调用硬停是两个独立证据点，不得用「或」合并略过。

## UAT-BESC-04 — 硬停非 ACL 且 next_step 实际可达

### 前置

- 已到 BESC-03 的硬停状态；保留当前身份、session 模式和全部续查计数。

### 步骤

1. 读取硬停工具结果全文／结构化字段及 initialize 指导中的预算处置段。
2. 核对主归因、continuable 和 next_step。
3. 选择载荷中对当前实况实际可达的一条 next_step 并真实执行，再发 fixtures 查询。
4. 无 session 变体不得选择依赖 session 头的提示；纯等待 begin active 或运维清桶不得冒充用户主路径成交。

### 期望

- `continuable=false`；主归因不得为「无权限」「ACL deny」「权限拒绝」。
- next_step 为结构化、与当前实况相符的动作，而非只有 reason 码。
- 执行后 query 真实成交；若提示不可达、仅文案存在或执行后仍硬停 → FAIL，并由 BESC-09 保留主路径缺陷。

## UAT-BESC-05 — 真实 compat 判定分列 budget／ACL／平台错误

### 步骤

1. 用真实 compat runner 跑一个 expected allow 案，构造其实际 `question_budget_exhausted` attempt，保存 runner 原始 JSON。
2. 读取该 attempt.reason、observedOutcome、case status 和顶层 reasons；不得用跑次手记代替。
3. 跑 expected deny 对照，只有真实 ACL 拒绝证据才可 PASS；若实际为 budget stop，则该案不得记权限 PASS。
4. 若覆盖 `question_budget_unavailable`／`question_budget_concurrency_exceeded`，分别核对平台错误／并发类，不得并入 exhausted。

### 期望

- expected allow 的 budget attempt 归为 `budget_exhausted`／预算终止，不出现 `new deny`／`acl_deny`／权限失败主归因。
- 未恢复成交时该案为 budget 类 FAIL／BLOCKED，不得伪报 allow；若 runner 已自动执行合同内逃生并真实成交，须另存恢复证据。
- expected deny 不得因 budget stop 假绿。
- 顶层报告能直接读到具体预算原因。

## UAT-BESC-06 — 健康绿不否定触顶

### 步骤

1. 触顶当次记录 requestId、reason 和 `mcpClientRttMs`／等价 RTT。
2. 同分钟调用 `GET /api/health`／livez，保存状态与耗时。

### 期望

- 同时留下「服务健康／RTT 正常」和「数据调用预算终止」两组事实。
- health／RTT 不得用于否定触顶，也不得把毫秒级 budget stop 误诊为服务宕机。

## UAT-BESC-07 — begin active 回归

### 前置

- 使用 [`UAT-SUITE-BEGIN-ZERO-BINDING`](../begin-zero-binding/fixtures.md) 的 active／A0 正式控制夹具；tools/list 含 begin 且真实 begin 成功。
- 不以「临时启用问询上报」文字代替真实绑定证据。

### 步骤

1. begin → 推至次数触顶 → continue 一次 → fixtures query。
2. 再次触顶后第二次 continue，保存声明拒绝；再发数据工具保存 `continuable=false`。
3. 调用新的 `lucy_begin_question`，读取新 round／window／calls／continuations，再执行 fixtures query。

### 期望

- active 续查仍为 1 档；第二次 continue 不换窗。
- 新 begin 清零当前窗口次数／忙时和续查计数，后续 query 真实成交并匹配 oracle。
- 环境无法构造 active → BLOCKED；不得用 inactive 结果冒充 PASS。

## UAT-BESC-08 — begin_not_available 无 reset

### 前置

- 零绑定；桶内已有部分消费但未触顶，保存 calls、busyMs、round、windowId、turn 和 BindingSession 前像。

### 步骤

1. 强制调用带 intentSummary 的 `lucy_begin_question`。
2. 保存完整响应及预算／turn／BindingSession 后像。
3. 不 continue，直接再发一次 fixtures query，并读取计数差分。

### 期望

- begin 返回 `isError=true`、`reason=begin_not_available`；无新 turn、round／window 切换、continuations 清零或绑定副作用。
- 后续 query 仅按既有窗口正常消费一次并真实成交；不得「突然满血」。

## UAT-BESC-09 — 第一性原理全生命周期看守

> 本条优先看守 DEVELOPMENT 的主路径可用性。若 draft Spec 未提供某一步所需的新问询合同，本条保持 FAIL，不得删步骤迎合草案。

### A：inactive＋无 session＋可见 continue

1. 用合法临时身份建立已知零态，数据调用不带 session 头。
2. 推至次数触顶；显式 continue 后执行 oracle 查询，证明同一长问询可继续。
3. 按 BESC-03 用尽全部续查档数，验证第 6 次声明拒绝和后续硬停。
4. 使用合同内**显式新问询**动作；不得换 Token、重启、清库或关闭预算。
5. 同 Token、同一无 session 身份再次执行 oracle 查询。
6. 新开一个 runner 进程，以同 Token 再开始一个合法新问询并执行 oracle 查询。

### B：inactive＋稳定 session＋重连

1. 使用真实 initialize 返回的 session，固定复用同一 session 头。
2. 触顶后按合同逃生并真实成交；断开重连后核对仍属原预算作用域，未因重连意外清零。
3. 续查耗尽后使用显式新问询，同 Token 再次真实成交。

### C：legacy 合法问数身份未显式授予 continue

1. 使用升级前配置中数据查询合法、但未显式授予 continue 的独立身份，保存升级前 tools/list 与授予证据。
2. 平滑升级后重新 initialize／tools/list；按 D7，逃生工具必须因既有计费问数能力而可达，且不得新增 connection／source／行权限。
3. 推至硬停后，以硬停凭证调用 `mode=new_question`，下一数据工具真实成交。
4. 若升级后工具仍不可达 → FAIL；不得通过手工补授、重签 Token 或清库取得本条 PASS。

### 期望

- A／B／C 分别留证，所有终点均为真实成交并匹配 oracle。
- 任一变体在触顶／硬停后无可达动作、动作执行失败或后续仍 exhausted → 本条 FAIL。
- 重签 Token、重启容器、清预算状态、关闭预算、补授 continue 均不得作为本条逃生手段。

## UAT-BESC-10 — busy 触顶／逃生与 idle 对照

### A：settled busy 触顶并逃生

1. 在已知零态窗口，以真实受控慢源累计 settled busy；不得使用 mock 时钟。
2. 确认 `calls<60`，读取审计快照证明 `busyMs>=300000`。
3. 发起下一次数据工具，保存预算终止响应。
4. 执行当前实况的 continue／显式新问询，再执行 fixtures query。

### B：纯 idle 不触顶

1. 使用另一已知零态窗口，完成一次快速 oracle 查询，确认 `busyMs<300000`、`calls<60`。
2. 真实空闲超过 300 秒，期间不执行计费数据工具。
3. 再执行 fixtures query，读取预算差分。

### 期望

- A：下一次准入因 busy 触顶，快照 `exhaustedBy=busy`／等价原因；逃生后真实成交。
- B：仅 idle 不触顶，查询真实成交，busy 只增加实际数据处理时长。
- 两项均须实际执行；缺少慢源、空闲对照或快照 → BLOCKED，不得凭代码口径记 PASS。

## UAT-BESC-11 — 真实 Agent 长问询与跨跑次恢复

### 前置

- 使用未为本测试修改的真实 Agent 客户端和 fixtures 冻结长问题；记录客户端版本／摘要、模型、提示和非敏感配置指纹。
- 同一合法 Token 可供确定性 MCP 与 Agent 跑次复用；不得以 mock MCP／mock Agent 替代。
- 独立数据库先计算长问题各项 oracle。

### 步骤

1. 第一次真实 Agent 跑次执行冻结长问题；若需确定性预耗构造触顶，须在同一真实 identity／session 上完成并保留轨迹。
2. 检查完整工具轨迹：实际触顶后，Agent 必须停止无效重试，并执行合同内 continue／显式新问询。
3. 保存最终答案，逐项比对 oracle、source／measure／口径和失败披露。
4. 不换 Token，再开新 runner／Agent 进程执行同一或另一合法问题，保存第二次工具轨迹和最终答案。

### 期望

- 两跑次均完成正确答案；触顶后无 continue／新问询死循环，不把 budget 报成权限故障。
- 第一次跑次的轨迹必须实际覆盖触顶及合同内逃生；未构造到触顶 → BLOCKED，不得以普通短问题 PASS 代替。
- 第二次跑次不得继承旧硬停而失败；重签 Token、重启服务或关预算不算恢复证据。
- 最终答案不得用预算错误、wiki-only 内容或推测值冒充事实数据。

---

## UAT-BESC-12 — Wave D：同 Token 两次真实 compat 成交

### 前置

- 使用 Wave D 同形题库、配置和合法 Token；保留原事故 requestId／证据作为改前对照，不在本用例重签 Token。
- 跑前记录预算状态和目标案清单：原报告 14 条 `question_budget_exhausted` expected allow 案；其他 identity 的同形合法案作为对照。
- JOIN chasm、ACL-03b、Agent 墙钟等原报告明确另案的问题单列，不得纳入本项修绿范围，也不得删除其历史失败。

### 步骤

1. 以同一组 Token 执行第一次真实 `run-mcp-compatibility.mjs candidate`，保存原始结果 JSON、工具轨迹和配置／suite 指纹。
2. 核对 runner 实际行为：initialize／session 管理；begin 不可见时走 N；无陈旧 turn；触顶后按 `continuable` 执行 continue，inactive 硬停后按 next_step 执行 new_question。
3. 不换 Token、不重启服务、不清预算，使用另一结果目录执行第二次完整 candidate。
4. 逐案核对目标 allow 的最终工具结果、事实行／合法空结果合同、attempt reason 和顶层归因；比较两次是否均能成交。

### 期望

- 原预算命中的目标合法 allow 案在两跑次均真实成交；不得只从 `new deny` 改写为 `budget_exhausted` 后仍失败。
- 恢复路径中的 continue／new_question 声明、下一数据工具兑现和最终结果可关联；同 Token 第二跑不继承旧硬停。
- budget、ACL deny、并发和 unavailable 按实际 reason 分列；expected deny 只有真实 ACL 证据才 PASS。
- 其他 identity 的合法对照不回退；健康／RTT 与功能结果分列。
- 另案按原结论保留；本项 PASS 只证明 Wave D 预算粘连与误判闭环，不声称整个 candidate 或 Agent 墙钟轴 PASS。
