# Fixtures — UAT-SUITE-BUDGET-ESCAPE

| 元数据 | 内容 |
|---|---|
| UAT 设计版本 | **v1.0（定稿）** |
| 秘钥纪律 | 只记录仓库外凭据路径；Token／密码不得进入 runs、日志摘要或报告 |

| 键 | 值 | 备注 |
|---|---|---|
| WebUI | `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` | 仅管理夹具／健康检查；本套件不主张 WebUI 用户面 |
| Health | `…/api/health` | BESC-06 同时记录健康与预算码 |
| MCP Proxy | `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}/mcp` | 真实 MCP，不用 mock |
| MCP Bearer | 仓库外文件路径（问数 Token） | 路径 only；勿写入 runs |
| 连接 | `demo-mysql` | 真实 demo MySQL |
| source | `superstore_orders` | 统一使用 `active_rows` 基础过滤 |
| 推荐查询 | `lucy_query`：`measures=["superstore_orders.order_count"]`，`segments=["superstore_orders.active_rows"]` | 每次计 1 次数据工具；结果须匹配 oracle |
| 独立事实 oracle | 对物理表执行只读 `COUNT(DISTINCT order_id)`，并应用 `is_deleted = 0` | 保存 SQL、行值和数据库指纹；不从 Lucy 答案反推 oracle |
| 备选计费调用 | `lucy_read_source` 读取 `superstore_orders` | 可构造计数边界；不能代替 BESC-02／03／07／09／10／11 的事实成交 |
| 不计预算 | `lucy_catalog`、`lucy_begin_question`、`lucy_continue_question`、`initialize`／`tools/list` | 不得充「第 N 次」 |
| 零绑定实况 | tools/list 无 begin；强制 begin → `begin_not_available` | demo 默认；BESC-02／03／08／09 |
| active 实况 | 使用 [`../begin-zero-binding/fixtures.md`](../begin-zero-binding/fixtures.md) 的 A0／正式发布控制夹具 | BESC-07；无真实 active 则 BLOCKED |
| 续查身份 | Role／Agent／Token 含数据权限和 `lucy_continue_question` | `uat-besc-continue-*` 每跑次换后缀；测后删除 |
| legacy 未显式授予 continue 的身份 | 升级前具有相同数据权限，但未显式授予 continue；升级后须按 D7 获得逃生工具 | BESC-09C；不得手工补授或新增数据权限来取得 PASS |
| 无 session 变体 | 不发送 `mcp-session-id`／`x-lucy-session-id` | 原 Wave D 关键路径；保存请求头形态证据，不记敏感值 |
| 稳定 session 变体 | 真实 initialize 获取并固定复用 session；断开重连仍复用 | BESC-09B；记录脱敏关联 |
| 显式新问询 | inactive 硬停后调用 `lucy_continue_question`：`mode="new_question"`＋硬停 `continueToken`；active 硬停走 begin | 声明后由下一数据工具兑现；不得重签／清库／重启代替 |
| 合同默认加档 | inactive 时 `maxContinuations=5`（P1-74 Spec D2） | 初始窗＋5 次续查＝至多 6 窗；第 6 次续查拒绝另验 |
| Admin 写入 | 同 [`../question-budget/fixtures.md`](../question-budget/fixtures.md) BUDGET-04 要点 | 口令只走环境变量；退役 Role id 不复用 |
| busy 慢源 | 真实受控慢源／长查询；逐次读取审计 busyMs | BESC-10A；禁止 mock 时钟，calls 必须小于 60 |
| idle 对照 | 独立新窗真实空闲超过 300 秒，期间无计费调用 | BESC-10B；不能用 busy 窗口兼作 idle 对照 |
| compat 入口 | `scripts/e2e/run-mcp-compatibility.mjs` 及其实际结果 JSON | BESC-05／12；同 Token 两跑使用不同结果目录；跑次手记不能替代 runner 输出 |
| Agent 客户端 | 未为本测试修改的真实既有 Agent；记录版本／摘要 | 可复用 compat 已支持客户端；不用 mock |
| Agent 冻结长问题 | 「基于 superstore_orders 的有效行，回答：订单总数；总销售额、总利润和整体利润率；按 region 分组的订单数、销售额、利润和利润率；指出利润率最高与最低的 region。逐项给出 source、measure 和口径。」 | 跑前冻结提示与数据库 oracle；不得在跑中为凑结果改题 |
| Agent 跨跑次 | 同 Token 新开 runner／Agent 进程再跑合法问题 | BESC-11；第二次不得继承旧硬停 |
| 改前锚点 | Wave D／错题 2026-11-22；PM 报告 `inbox/2026-11-22-question-budget-pm-scenario-report.md` | 非本套件跑次，仅作对照 |

## 跑前冻结

- 固定候选 gitSha／dirty／镜像摘要、配置指纹、身份授予、session 模式、预算初态、查询参数和独立 oracle。
- 次数边界从已知 `calls=0`、`busyMs<300000` 开始；旧桶状态不明时换新临时身份，而不是手改状态。
- 多档续查逐窗记录 windowId／continuations／声明／消费／成交，避免把声明成功误当换窗成功。
- compat 和 Agent 必须保存实际工具轨迹、原始结果及最终答案；手工结论不能替代。

## 清理

- 删除本跑次临时 Agent（连带吊销 Token）与 Role，核对无 `uat-besc-*` 残留。
- 清理专用慢源／会话夹具，保留脱敏证据；不得删除共享审计历史来修绿。
- 已退役 Role id 不复用；下一跑次使用新后缀。

## 禁止

- 改 `QUESTION_BUDGET_MAX_*`、`LUCY_QUESTION_BUDGET=off`、mock 时钟或替身服务图快。
- Token／密码写入 runs。
- 用 vitest／CR／跑次手记冒充本套件 PASS。
- 用重签 Token、`--fresh`、重启容器、清预算库、临时补授 continue 冒充 BESC-09／11 逃生。
- 用「非 ACL」「非 budget」「进入下一窗」代替事实行与独立 oracle 成交断言。
