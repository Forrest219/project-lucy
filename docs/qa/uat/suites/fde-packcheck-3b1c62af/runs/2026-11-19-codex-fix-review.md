# Run — 2026-11-19 — Codex 修复后评审

| 元数据 | 本轮事实 |
|---|---|
| Suite | `UAT-SUITE-FDE-PACKCHECK`；P1-55／P1-56 |
| 任务 | 评审 FDE 报告所列缺陷的落地修复，判断是否可回复全部阻塞已修复、交客户测试；不修改运行代码、不出包 |
| 判定 | **BLOCKED**：现行 cases 的 R0 身份门禁不满足；不得把下文的局部实测或 L1 自动化结论提升为整套 UAT PASS |
| 时间 | 2026-11-19，北京时间；约 13:39 开始 |
| 用户给定入口 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp` |
| 镜像 | `sha256:08be21d3dd0a9867ce113f1c82f837592040cc8091f54efff4b2eaa038b880f4`；arm64；创建于 2026-11-19 13:39:20 +0800 |
| 构建身份 | health `gitSha=3b1c62af32af7b6d045caef7fa10ccc92300ae97`、`gitDirty=true`；`BUILD_REVISION=3b1c62af…-dirty` |
| 源码关联 | 开始时工作区为 3b1c62af＋未提交修复；评审中外部会话提交为 `d8c3f0971e29bf74c2fe7cfb45e7265d372f6c8e`。四处运行修复的工作区、隔离快照、容器文件 SHA256 一致；本轮未提交代码 |
| 凭据 | 使用仓库外现存登录凭据文件；密码、token、cookie 不写入测试台或 inbox |
| 过程证据 | `inbox/codex-fde-review-20261119/`；临时文件，不作为永久制品 |

## 1. 正式套件判定

本套件现行 [cases](../cases.md)／[fixtures](../fixtures.md) 仍是旧候选复现场景：R0 要求候选及三个基线的干净 worktree、独立沙箱镜像且 `gitDirty=false`。当前给定环境是含修复的 dirty demo 镜像；四基线的修复后对照及干净镜像身份门禁未完成。**不修改原期望来迁就当前环境。**

整改 [Plan v1.0](../../../../../plans/lucy-20261119-fde-3b1c62af-contract-remediation-plan.md) 的授权比套件旧文字更新：已批准延迟注入、受控投影进度与缩短窗口，须先尝试全真并标受控降级；本轮不重新申请已有授权，也不把 L1 替身当作 L2。

| Case | 本轮正式结果 | 原因 |
|---|---|---|
| UAT-FDE-R0 | **BLOCKED** | 现行干净候选身份门禁不满足；新修复候选与旧复现候选尚未在 cases／fixtures 完成区分 |
| UAT-FDE-R1 | **BLOCKED** | R0 前置未通过；剩余 4 个 skip 的完整逐项承接未在本轮确权 |
| UAT-FDE-01 | **BLOCKED** | 未完成真实 lag 的所有时序及基线对照；真实 demo 正式 CSV／ZIP 均 409，见 §2，不能用诊断导出代通过 |
| UAT-FDE-02 | **BLOCKED** | 未执行真实外部目录＋延迟代理的完整步骤；原 FDE 受控 channel 复跑只属于 L1 |
| UAT-FDE-03 | **BLOCKED** | 未执行真实外部目录＋延迟代理的正式 HTTP／客户端多轮步骤 |
| UAT-FDE-04 | **BLOCKED** | 未执行真实 50×400 实表＋延迟代理的整套步骤；独立 L1 仍检出 LS-20 失败，见评审报告，不能用新测试绿灯替代 |
| UAT-FDE-05 | **BLOCKED** | 同镜像真实时钟的局部场景满足预期，但未完成三基线、后台维护器与读时重建两路径；见 §3 |
| UAT-FDE-07 | **BLOCKED** | 本轮未执行 IRR／COLD／RPB 全套；旧 3b1c62af 跑次不证明本批跨界闭包的 SC-16 满量场景 |

## 2. 给定 demo 的真实 API／MCP 探查

这些是当前运行环境的补充实测，不计作 R0 后正式套件通过。

- 管理员登录 200；livez／readyz／health 均 200，单次约 4–5ms。
- MCP initialize 200，有会话，instructions 长度 8447；tools/list 成功。health 的 `dataQaInstructions.source=missing` 不代表 initialize 无 instructions，本轮以实际握手为准。
- 纯 MCP `lucy_query` 成交：`demo-mysql`／`superstore_orders`，按 region 汇总 total_sales，返回 4 行。仅证明此条主路径，不冒充真实 Agent 全旅程或全业务答案验收。
- 正式 CSV 与 ZIP 均 **409 `integrity_or_relation_failed`**，未成功交付正式导出。
- 随后诊断 ZIP 200；manifest 显示 `projectionComplete=true`、`lagMs=0`、`fileHashOk=true`、`relationCheckOk=true`，但 `scopeComplete=false`。
- 只读调用 as-of-S 证明器（S=52）定位到 `attribution_journal_baseline_unknown`，归属修订历史不可证明。这是当前 demo 的证据基线缺口；**不能误报为 F01 的 lag 误拒仍在，也不能把它判为正式导出 PASS**。本轮未修改数据、补基线或放宽门禁。

证据：`live-smoke.log`／`live-smoke.json`、`export-diagnostic.json`、`export-proof.log`。

## 3. 同镜像、真实时钟的滚动窗口探查

独立临时容器 `lucy-codex-fde-rolling-20261119`，固定上表 image ID，`--network none --read-only --tmpfs /tmp`；执行脚本只读挂载。未操作 demo 审计库，未改系统时钟，未替换 Date.now、SQLite、重建 worker 或 HTTP 响应。

1. 使用真实 `writeLog` 写入边界前后两条日志：起点时刻 `now−30d+10s` 和 `now−30d+50s`，同一 session。
2. 真实重建形成一个问询，编号 1。
3. 真实等待 35 秒，使第一条滑出默认 30 天窗口，第二条仍在窗口。
4. 新 session 写入当前第三条日志，再调用真实重建。
5. 用真实 TCP HTTP 请求问询详情，并核对实际 `presentCallRows` 呈现和 SQLite 关联。

观察：35386ms 后第二条调用仅有 1 个归属；旧问询 ID 与编号 1 保持；新问询编号 2；详情 HTTP 200、调用呈现编号 1；原始日志总数 3。脚本断言通过，临时容器自动删除。

证据：`audit-live-rolling.mts`／`audit-live-rolling.log`。**局部场景满足预期，不代表 SC-16 满量性能门槛、存量自动标脏或整套 UAT-FDE-05 已通过。**

## 4. 放行判断

**本轮不能回复「所有阻塞已经修复，可交客户测试」。** 正式测试台为 BLOCKED；独立修复评审另有可重复的功能失败。源码问题、L1 门禁与缺口详见 `inbox/codex-fde-review-20261119/review.md`，它们不计作本套件的 L2 PASS／FAIL。

可对 FDE 说明已落地修复并提交候选供其继续复验，同时明确 F04 混合权限与大规模缩批仍需处理；不要宣称修复已全部关闭或已经具备客户测试准入。此次不评价客户部署制品，也不以缺少客户现场证据否定功能合同。
