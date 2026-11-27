# Cases — UAT-SUITE-BUDGET-ANALYST-UX

| 元数据 | 内容 |
|---|---|
| UAT 设计版本 | **v1.0** |
| 执行状态 | NOT RUN；实跑另按开发授权与跑次记录 |
| 公共判定 | 真实 MCP／真实 Claude Code；成交必须匹配独立数据库 oracle；拒绝臂与成交臂双覆盖 |

| ID | 标题 | Spec | 层级 | 期望摘要 |
|---|---|---|---|---|
| UAT-BA-R0 | 环境、身份、会话与事实 oracle（含 PRE-01 抓包证据归档） | — | 手工／脚本 | 固定版本、多身份授予、session 模式取证、慢源夹具标定、预算零态确认 |
| UAT-BA-01 | 重查询第 61 次触顶，防火墙仍生效 | SC-01 | MCP 全真 | 第 61 次 `lucy_query` 返回 `question_budget_exhausted`，`outcome=budget_stop` |
| UAT-BA-02 | 轻工具独立 200 次上限且不占主预算 | SC-02 | MCP 全真 | 201 次 `lucy_read_source`／`wiki_search`：前 200 次放行且 `calls=0`、`busyMs=0`；第 201 次触独立上限 |
| UAT-BA-03 | 轻重并发分池互不干扰＋超限结构化拒绝 | SC-03 | MCP 全真 | 8 轻＋8 重并行全放行；第 9 路重查询返回 `question_budget_concurrency_exceeded`（`retryable: true`、`retryAfterMs`、`next_step.max_inflight=8`）且不扣 `calls`/`busyMs`；第 17 路轻工具被元数据池（token 16）拒绝并返回 `retryAfterMs` |
| UAT-BA-04 | 缩并发重试真实成交 | SC-04 | MCP 全真 | 第 9 路被拒后缩并发重发，合法查询成功出数且匹配 oracle |
| UAT-BA-05 | 45 秒慢查询不被 30s 掐断 | SC-05 | MCP 全真 | 慢源夹具 45s 首字节正常返回，`busyMs=45000` 全额结算 |
| UAT-BA-06 | 900s 忙时窗口与续查成交（兼 BESC-10A 补齐） | SC-06 | MCP 全真 | 15 次 × 60s 成功放行（累计 900s）；第 16 次 `question_budget_exhausted`；`lucy_continue_question` 换窗后重试成交 |
| UAT-BA-07 | 失败封顶记账与审计双字段 | SC-07 | MCP 全真＋审计 | 4 次 90s 超时失败各计 busyMs 封顶 30s（合计 120s）；第 5 次正常查询放行成交；审计同时含 `rawDeltaMs≈90000` 与 `billedBusyMs=30000` |
| UAT-BA-08 | Esc 中断后 5s 冻结期满可重问 | SC-08 | MCP 全真 | 客户端断开 8 路在途慢查询，5.5s 后新 `lucy_query` 正常准入成交 |
| UAT-BA-09 | 多 Token 共连接 32 路放行与第 33 路拒绝 | SC-09 | MCP 全真 | 4 Token × 8 路共 32 路全放行；第 33 路按 connection 维度拒绝并返回 `retryAfterMs` |
| UAT-BA-10 | begin active 续查 3 档与第 4 次硬停（兼 BESC-07 回归） | SC-10 | MCP 全真 | active 身份前 3 次 `lucy_continue_question` 均换窗成交；第 4 次前硬停且 `next_step` 指向 `lucy_begin_question`；预算终止不计四类失败维度 |
| UAT-BA-11 | 环境变量全量回退旧档 | SC-11 | 独立容器 | 按 Spec SC-11 变量集设置后，容量 `4/8/16/24` 与预算并发／忙时／active 续查／超时／取消冻结全部精确回退 |
| UAT-BA-12 | 真实 Claude Code 端到端静默逃生 | SC-12 | Agent 全真 | 真实 Claude Code 完成含预算触顶与并发超限的多轮分析任务；轨迹含自动缩并发重试与静默 `lucy_continue_question`；最终答复与 oracle 一致，无提前放弃 |
| UAT-BA-13（可选） | `hive-jd` 真实目录现场补跑 | SC-05／09 变体 | 客户环境 | 真实外部 Hive Catalog 上复验慢查询超时与多 Token 共连接水位 |

---

## 公共定义与证据

- **合法身份**：Token、Agent、数据工具、connection、source 和行权限均允许 fixtures 查询；开跑前用普通查询匹配 oracle，排除 ACL／语义／连接故障。
- **重查询工具**＝`lucy_query`／`lucy_certified_route`／`lucy_report_template`；**轻工具**＝`lucy_read_source`／`lucy_freshness`／`lucy_explain_query`／`wiki_search`／`wiki_read`（OQ-3 已随 D1(a) 闭合）。
- **真实成交**：工具成功、返回 fixtures 预期事实行、关键值匹配独立只读 oracle；空 envelope、ACL／上游错误均不算成交。
- **拒绝臂证据**：保存完整结构化载荷（reason、retryable、retryAfterMs、next_step）与准入审计快照；验证拒绝不扣 `calls`/`busyMs`。
- **预算证据**：逐窗保存脱敏 identity／session、round、windowId、calls、busyMs、metaCalls（如已实现）、continuations、requestId、reason、continuable 与 `budgetSettlement` 审计快照；不得记录 Token 明文。
- **PRE-01 归档**：R0 必须附 Claude Code 三模式（单窗口主会话／多终端并行／Subagent 派发）`mcp-session-id` 透传抓包结论；若存在退化落入无会话桶 `-` 的模式，须记录桶隔离策略或客户端提示的实测行为。

## UAT-BA-R0 — 环境、身份、会话与事实 oracle

### 步骤

1. `GET /api/health`，记录版本、gitSha、dirty、镜像／配置指纹和 KTX 版本。
2. 归档 PRE-01 抓包结论（三模式 `mcp-session-id` 透传情况）。
3. 对每类身份执行真实 MCP `initialize`／`tools/list`，记录 begin、continue 和数据工具可见性；读取 `initialize` instructions 全文，确认 D7 文案版本（无 `"stop looping"` 首句、含并发上限披露）。
4. 部署并标定慢源夹具（45s／60s／90s 档位实测首字节，见 [fixtures](fixtures.md)）。
5. 读取脱敏预算初态：round、windowId、calls、busyMs、continuations；非已知零态不得用于边界判定。
6. 用独立数据库只读 SQL 计算 fixtures oracle，再执行一次普通合法 query 核对。
