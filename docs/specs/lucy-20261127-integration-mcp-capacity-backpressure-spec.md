# 系统间 MCP 查数：容量保留、大明细背压与开发者水位 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 系统间 MCP 查数：容量保留、大明细背压与开发者水位 Spec |
| 文档类型 / 版本 | Spec（韧性／集成面）／**v1.0** |
| 日期 / 目标版本 | 2026-11-27／产品线 `0.35.0` 候选（待挑入 [`v0.35.0-scope.md`](../releases/v0.35.0-scope.md)） |
| 功能编号 / 优先级 | **REQ-0119**／**P1**。**不入核心分母** |
| 台账号 | 无。挂常青需求池 `REQ-0119` |
| 阶段 | S2 |
| 状态 | S2｜v1.0-r4。**终稿已确权并经 r3 重新确权**（委托人 2026-11-27 明示「授权 spec定稿」，同日明示「批准」OQ-3 修订／OQ-6／OQ-7 及配套吸收项）；**r4（2026-11-27，委托人授权）与 [REQ-0122](lucy-20261126-question-budget-analyst-workflow-revision-spec.md) 完成跨 Spec 冲突消解**（两 Spec 同日终稿互不引用所致）：C1 采案 A（四层默认改随 REQ-0122 D2、OQ-global 冻结解除）、borrowMax 与 global×0.5 解耦（OQ-R）、CANCEL_HOLD 接受全局 5s、口径锚定与排期（REQ-0122 P0 先落地）见 Changelog v1.0-r4；设计对抗 R1 已吸收；Plan／UAT 对抗 R1→R2（Kimi）**PASS WITH FIXES** 且 N-01～N-05 已吸收；**开发未授权**；实现未落地；测试台 [`UAT-SUITE-INTEGRATION-MCP-CAP`](../qa/uat/suites/integration-mcp-capacity/suite.md) **NOT RUN**；≠ 功能合同收口；≠ UAT PASS；≠ 可上线 |
| 需求来源 | 委托人：Python／Java **系统间** MCP 查数（非对话 Agent 宿主），担心大明细堵死 MCP 致员工不可用。[设计稿](../design/design-2026-11-27-integration-mcp-capacity-backpressure.md)；[R1 对抗](../reviews/2026-11-27-req-0119-integration-mcp-adversarial-review.md)（原 `inbox/20261127-req-0119-adversarial-r1.md` 已按 inbox tmp 属性清除，归档以评审文件为准） |
| 实施主体 | Lucy MCP Proxy／容量协调器／Agent 管控面；不改 KTX 源码；本轮不拆 WebUI↔MCP 进程 |
| 配对计划 | [`docs/plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md`](../plans/lucy-20261127-integration-mcp-capacity-backpressure-plan.md) |
| 测试台 | [`UAT-SUITE-INTEGRATION-MCP-CAP`](../qa/uat/suites/integration-mcp-capacity/suite.md) |
| 评审 | [过程对抗归档](../reviews/2026-11-27-req-0119-integration-mcp-adversarial-review.md)（设计 R1；Plan／UAT 对抗见同文件后续节） |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 2026-11-27 **定稿**。吸收设计 R1（Kimi）B-01～B-06／M／OQ；委托人明示 Spec 定稿；裁定 SC-06 由本条承接实现（覆盖 P1-82「移下期」出口划分，见「与既有 Spec 的关系」）。开发未授权。 |
| v1.0-r1 | 2026-11-27 Plan／UAT 对抗 R1（Kimi）处置：OQ-global **维持 24** 书面裁定；SC-06／OQ-5 显式覆盖 `pipeResponse` 裸管道；SC-10 补 interactive 代理告警；WebUI 枚举本轮不做（IMC-09=N/A）；SC-07 要求 UAT 核 SC-06 预算结算。开发未授权。 |
| v1.0-r2 | 2026-11-27 Plan／UAT 对抗 R2 **PASS WITH FIXES**；吸收 N-01～N-05（无浏览器臂措辞、SSE 普查、IMC-06 证据挂链、Task 3 Files、版本标签对齐）。开发未授权。 |
| v1.0-r3 | 2026-11-27 吸收委托人补充评审（对照 `20261126` 客户端与 `mcp-proxy.ts` 现行实现）：**OQ-3 修订**（integration 豁免问询预算＋影子计数＋env 止血开关；速率护栏分期不做，残余风险登记 §7）；新增 **OQ-6／OQ-7／OQ-8／OQ-RATE／OQ-CAPS**；SC-02 补 Token 发放硬检查点、SC-07 语义化改写、SC-10 增强（agentId Top-N＋每 agent 用量聚合＋影子计数）、SC-11 最低契约、新增 **SC-13**（integration 握手轻量路径）；事实表补 F-01～F-03（F-04 客户端侧断言锚点待补，见脚注）；§7 补 health 重启循环残余风险。委托人明示「批准」，r3 重新确权完成。开发未授权。 |
| v1.0-r4 | 2026-11-27 **跨 Spec 冲突消解**（委托人授权，对照 [REQ-0122](lucy-20261126-question-budget-analyst-workflow-revision-spec.md) v1.0——两 Spec 同日终稿互不引用，经评估存在 1 硬冲突＋1 锚点矛盾＋5 组合缝隙）：① **C1 采案 A**——OQ-global 冻结解除，四层容量默认改随 REQ-0122 D2（`token 8 / agent 16 / connection 32 / global 48`），本条不再独立冻结四层档位；② **OQ-R 修订**——`borrowMax` 与 `global×0.5` 显式解耦，独立待校准初始假设 **borrowMax=12**（global=48 时对应 reserveR=36，integration 可借槽包络维持原风险水位、不随 global 上调放大），最终值仍由 Task 0／T2 压测冻结；③ **OQ-hold／§7**——接受 REQ-0122 D5 全局 5s 冻结（不分流），§7 补短冻结残余风险；④ **OQ-3 口径锚定**——interactive 基线改锚「REQ-0122 落地后口径」；`budgetShadowRejected` 降为下界参考（OQ-RATE 定阈值须结合 SC-10 用量聚合）；SC-10 补 SC-06 触顶按轻重工具分桶；⑤ **OQ-7 定性**——integration 静态极简指引不随 REQ-0122 D7 对话式文案更新，契约以 SC-11 开发者指引为准；⑥ **排期**——REQ-0122（P0）先落地，本条 Task 0／T1–T5 在其落地后基线上校准。开发未授权。 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在 Docker 单实例同进程拓扑下，（1）`integration` Agent 不得占用 interactive 保留槽；（2）上游响应体（含握手与全部上游语义工具）实施流式字节上限与全局 in-flight 内存预算（**SC-06**）；（3）混压下 interactive 小查询在预注册通过线下仍成交；（4）交付 Python／Java MCP 接入与限流指引（非官方 SDK）；（5）`integration` 身份豁免对话式问询预算，配套影子计数与 env 止血开关（OQ-3 修订）。
- 本条出口：`SC-01`–`SC-13`；配对 UAT 必做项；开发者指引落盘。
- 不在本条出口：WebUI↔MCP 进程拆分、KTX worker 池、多副本、零停机升级、官方 PyPI／Maven SDK、REST `lucy_query`、改变 ACL／行权限语义、**速率护栏**（分期裁定 OQ-RATE）、**修改 `lucy_query` 语义形状**（OQ-6）。
- 上线关系：本条收口不表示可上线；不证明进程级 HA。

## 与既有 Spec 的关系

| 既有 | 关系 |
|---|---|
| [P1-82／REQ-030-103](lucy-20261124-mcp-data-plane-isolation-ha-spec.md) | **继承**四层容量与立即拒绝语义。本条**增量**：workload 维（integration 可借槽）、`workloadClass`、**承接并实现 SC-06**（P1-82 v0.3 曾移下期；**委托人 2026-11-27 裁定由 REQ-0119 实现**；P1-82 状态行／UAT-MCPHA-05 改为「由 REQ-0119 验收」指针，不重开 P1-82 开发出口）。 |
| [P1-78／REQ-030-099](lucy-20261123-mcp-inquiry-performance-baseline-spec.md) | 复用测程／哨兵方法；本条不替代问询性能基线合同。 |
| [P1-74 问询预算](lucy-20261122-question-budget-mainpath-escape-spec.md) | 容量／体量拒绝**不**冒充预算耗尽；`interactive` 身份预算语义 100% 不变；`integration` 身份整体豁免（OQ-3 修订，env 可关回）；是否扣减预算见 OQ-3 裁定。 |
| [P1-84 公共入口](lucy-20261124-public-entry-static-isolation-spec.md) | 同进程；本条不改公共入口合同。 |
| [REQ-0122 问询预算分析师修订](lucy-20261126-question-budget-analyst-workflow-revision-spec.md) | **基线与排期（r4，C1 案 A）**：REQ-0122（P0）先落地；本条四层默认改随其 D2 档（8/16/32/48），OQ-global 冻结解除，Task 0／OQ-CAPS 校准以其落地后口径为基线。**workload 门全覆盖**：其 D2 轻工具独立元数据并发池不免除本条 workload 判定——integration 身份全部调用（含轻工具）计入 `integrationActive`，元数据池不构成绕过路径（§4.2）。**指引分工**：其 D7 对话式文案仅面向 interactive；integration 静态极简指引不跟随（OQ-7）。OQ-3(a) 的「既有 upstream 失败规则」锚定其 D4 失败封顶口径。 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 用户可见：不新增中文产品词。错误继续复用 `query_concurrency_exceeded`；体量拒绝使用机读 reason（工程字段，如 `response_too_large`），不进 WebUI 文案表除非另登术语。
- 工程字段：`workloadClass`（`interactive`｜`integration`）、`capacityScope` 可增 `workload`、`retryAfterMs`、保留槽相关 `_meta.lucy`、预算影子计数（工程字段，如 `budgetShadowRejected`）、integration 轻量握手标记（定稿前复核术语标准）。

## 交互合同豁免

- 原因：本轮不改变用户可见 WebUI 表面——WebUI Agent 编辑枚举不做（仅 OpenAPI／存储）；主交付为 MCP 数据面、容量协调器与 Admin 配置字段，纯 MCP 与开发者指引文档不强制浏览器。
- 不改变：既有 Agent 编辑页、导航 IA 与 WebUI 文案均不变；UAT-IMC-09＝N/A（以 IMC-01 为据）。

## 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向补偿 |
|---|---|---|---|---|---|
| P1 问数方（员工 interactive） | 系统间大明细可占满 global／整包缓冲拖死 MCP | 保留槽＋SC-06 下小查询仍可成交 | ↑ | SC-04／SC-05／SC-08 | — |
| P1 问数方（系统集成） | 无明确水位与体量硬顶 | 高峰／超限更多拒绝 | ↓ | SC-03／SC-06／SC-11 | 机读 scope／`retryAfterMs`、分页指引、独立 Agent、可配更高但有顶配额（SC-11） |
| P2 治理方 | 无 workload 标记 | Agent 可标 `workloadClass`；ACL 语义不变 | ＝／↑（可运维） | SC-01／SC-02 | — |
| P3 运维方 | 缺 integration 拒绝聚合与水位 | health／容量摘要可观测；有打标 SOP | ↑ | SC-10／SC-12 | — |
| P4 管理层 | 系统调用拖垮全员风险未合同化 | 有合同与 UAT 套件，仍单实例 | ＝ | 闭口层级 | — |

## 第一性原理检查（主路径可用性优先）

- 约束生效：integration 可借槽打满立即拒绝；大响应流式触顶中止。
- 合法用户仍可用：interactive 在预注册通过线下成交（SC-08）；纯 MCP 员工路径不依赖 WebUI。
- 不把「全面拒绝数据面」当作入口绿。

## 1. 已核实事实

| 事实 | 证据 |
|---|---|
| 四层容量无 workload 维 | `webui/server/runtime/mcp-execution-capacity.ts` |
| 上游 `readUpstreamBody` 无流式上限；`MAX_BODY_BYTES` 只管入站请求 | `mcp-proxy.ts` |
| `LUCY_QUERY_DEFAULT_LIMIT`／`MAX_LIMIT` 已存在 | `mcp-proxy.ts` |
| `CANCEL_HOLD` 默认 30s | `mcp-proxy.ts` |
| 全仓无 `workloadClass` | grep 零命中 |
| 2C2Gi 约 8 并发 CPU 饱和、~50MiB／查询 | P1-82 v0.3-r1 |
| 计费数据工具默认启用问询预算；无 begin 时按 `bq:<identity>:<session>` 兜底累计（60 次／问询，续问 ≤5），超限 `question_budget_exhausted` | `question-experience.ts:10,21`；`mcp-proxy.ts:5408`（B24 兜底注释） |
| `lucy_query` 强制 `measures` 非空；`limit` 硬顶 1000；无 `offset`／游标字段 | `mcp-proxy.ts:254,1800`＋`lucy_query` inputSchema |
| `initialize` 默认走 `decideInitializeInstructions` 动态构建，占 `INSTRUCTIONS_WORK_MAX_CONCURRENT=20` 全局槽 | `mcp-proxy.ts:2137,7946,8124` |
| `lucy_certified_route` 不支持参数化（inputSchema 仅 `routeId`／`templateId`，`additionalProperties: false`） | `mcp-proxy.ts:1405-1420` |

> 脚注（F-04，锚点待补）：`20261126` 参考客户端包的客户端侧断言（`isError` 全视为不可重试、404／`upstream_session_required` 不重建会话、非预期响应静默返回空 `rows`、Java 类位于默认包）待包文件路径锚点补入后确认；服务端侧对应机读信号（404→`upstream_session_required` 分类、`retryAfterMs`、`isError` 语义）已核实（`mcp-proxy.ts:3352-3468`）。锚点补齐前，客户端侧断言只作 SC-11 最低契约的动因，不作为已核实事实引用。

## 2. 需求摘要

### 2.1 功能需求

1. Agent 持久化 `workloadClass`：`interactive`｜`integration`；Admin OpenAPI＋存储＋审计；热更新语义见 §4.4。
2. 容量：在既有 token→agent→connection→global 上增加 **workload（integration）** 前置：`integration` 在途合计 ≤ `global − R`（`R`＝interactive 保留）。立即拒绝，不排队。
3. **SC-06**：所有上游 HTTP 响应体读取（initialize／initialized／全部上游语义工具）边读边计；单响应上限＋全局 in-flight 缓冲预算；越限中止并机读失败；禁止先完整缓冲再拒。
4. 行数轨与字节轨并存：既有 query limit 与 SC-06 同时生效；触顶顺序在 Spec 伪代码钉死。
5. 压测 T1–T5 出水位表；开发者指引（Python／Java 最小示例，非官方 SDK）。
6. `/api/health`（或既有 `mcpCapacity`）暴露 integration／workload 拒绝聚合与 reserved 占用摘要（无敏感正文）。
7. **OQ-3 修订**：`workloadClass=integration` 豁免对话式问询预算；预算机制对该身份改为**影子计数**（只记「若未豁免将被拦」次数，不拦截）；豁免提供 env 级整体开关（关回即恢复预算约束，试点期查询风暴止血手段）。`interactive` 行为 100% 不变。
8. **观测增强（扩充第 6 条）**：health 摘要补脱敏 `agentId` 有界 Top-N（漏打标定位）、每 agent 用量聚合（调用次数／累计耗时／峰值并发／SC-06 触顶次数）、预算影子计数；数据优先复用既有 audit 流，不新建持久化设计。
9. **OQ-7**：`workloadClass=integration` 的 `initialize` 走进程内静态极简指引路径，不进 `decideInitializeInstructions`、不占 instructionsWork 槽位；**不变量：`tools/list` 可见集与完整构建路径同构**。

### 2.2 非功能

| 维 | 要求 |
|---|---|
| 可用性 | integration 过载不得转化为 interactive 无界失败；停压后在 hold 宽限外容量可回落 |
| 性能 | 准入判定不新增上游调用；A3／SC-08 绑定时延分母 |
| 安全 | 不改 ACL／Row Policy；拒绝不泄露 Token／结果正文 |
| 兼容 | MCP HTTP 200＋JSON-RPC `isError`；不强制 HTTP 429 |
| 部署 | 单实例 Docker；不改 Helm 多副本假设 |

## 3. OQ 裁定记录（终稿确权一并闭合）

| ID | 裁定（委托人 2026-11-27 Spec 定稿授权下的程序性闭合） |
|---|---|
| OQ-1 打标责任 | Admin（治理方）经 OpenAPI／Agent 编辑设置 `workloadClass`；变更写审计。系统间 Token 发放前必须为 `integration`（SOP＋指引强制；UAT-IMC-02）。 |
| OQ-2 存量默认 | 迁移／缺省字段＝`interactive`（兼容员工）。漏打标残余风险由 SOP＋**SC-10 代理告警**（interactive Agent 持续高并发或大响应触顶计数）承担，**不**把未打标自动改成 integration。 |
| OQ-3 预算扣减 | **v1.0-r3 修订（委托人 2026-11-27 批准）**：(a) 容量拒绝（未启动上游）**不**扣问询预算 busy／calls；SC-06 中止（上游已开始）**按既有 upstream 失败规则**结算——此两条对**所有**身份不变。(b) `workloadClass=integration` 身份**整体豁免对话式问询预算**：不触发 `question_budget_exhausted`、不要求 `lucy_begin_question`／`lucy_continue_question`；预算机制对该身份转为**影子计数**（记录「若未豁免将被拦」次数，供未来速率护栏定阈值，避免误伤合法调用的设计无据）。豁免默认生效，env 级开关可整体关回（关回后重新受预算约束；**不复用**既有 `LUCY_QUESTION_BUDGET_BYPASS` 语义，避免一 env 两义）。`interactive` 身份与 P1-74 保持 100% 不变（**r4 锚定**：interactive 基线改锚「REQ-0122 落地后口径」——900s 忙时／30s 失败封顶／8 路并发／active 3 档；本条冻结的是机制语义，不约束其拨盘值）。**r4 影子计数下界口径**：REQ-0122 落地后预算口径大幅放宽，`budgetShadowRejected` 触发率显著下降，**仅作下界参考**；OQ-RATE 定阈值必须结合 SC-10 每 agent 用量聚合，禁止单以影子计数拍板。 |
| OQ-6 查数契约边界 | **维持 `lucy_query` 语义形状不变**（写入非目标与 SC-11 指引）：`measures` 必填、单次 `limit ≤ 1000`、无原生 `offset`／游标分页；超 1000 行明细由调用方按时间／主键过滤区间手动分片。**注意**：`lucy_certified_route` 当前不支持参数化——「指定查询」场景暂无等价路径，过渡手段为预注册多条固定 `routeId`；无 `measures` 纯明细、原生分页、参数化指定查询均另立独立需求，不夹带进 REQ-0119。 |
| OQ-7 握手轻量路径 | `workloadClass=integration` 的 `initialize` 直接返回进程内预装载极简基础指引：不进 `decideInitializeInstructions` 动态构建、不占 `INSTRUCTIONS_WORK_MAX_CONCURRENT` 槽位、不触发目录／Skill 扫描；**不变量：`tools/list` 可见集与完整构建路径同构**（SC-13）。`interactive` 握手行为不变（其指引文案随 REQ-0122 D7 修订）。**r4 定性**：integration 静态极简指引**不跟随** REQ-0122 D7 对话式文案更新——系统间调用方为 Python／Java 代码而非读 prompt 的模型；退避、`capacityScope=workload` 与重试契约统一以 **SC-11 开发者指引**为唯一事实源，消除双指引漂移面。 |
| OQ-8 打标 SOP 与定位 | 不做 WebUI 枚举不变（IMC-09=N/A）；SOP 提供可直接复制执行的 OpenAPI 打标／校验 `curl`；SC-10 代理告警输出**脱敏 `agentId` 有界 Top-N**（无 Token／查询正文）。**发放系统间 Token 前核对目标 Agent 非 `interactive`** 为 SOP 硬检查点（防存量 Token 天然持有 interactive 权利绕过 borrowMax）。 |
| OQ-RATE 速率护栏分期 | **本轮不做**（试点期用户少、滥用源以调用方分页循环 bug 为主，靠人工巡检可发现；无真实使用分布时拍阈值易误杀合法批处理）。并发墙＋SC-06 保护 lucy 进程本身；**上游数据库压力不在本合同保护范围**，残余风险登记 §7。回补触发条件：单 agent 调用频率显著越出试点分布／上游查询时长异常波动 → 入池速率护栏需求；每 agent 用量聚合与影子计数自第一天记录（第 8 条），作为未来定阈值的数据基础。 |
| OQ-CAPS 字节顶默认值 | SC-06 两档字节顶（per-response／globalBudget）出厂默认值**随 Task 0 与 R 一并冻结**：以合法 interactive 大查询不被误杀为下界校核（≈合法并发 × 平均体量）；**r4**：「合法并发」基数按 REQ-0122 D2 落地后口径（global=48）校核，REQ-0122 未落地前不得冻结；冻结前不得实现拍脑袋默认值。 |
| OQ-4 拆进程压测 | 本条出口不含；收口后另场隔离环境对照（设计 §8）。环境默认对齐 2C2Gi 除非另裁。 |
| OQ-5 会话型工具体量 | `lucy_begin_question`／`lucy_continue_question`／`lucy_report_template`／`lucy_certified_route`／skills 读 **全部**走 SC-06 同一读取闸（含今日 `pipeResponse`／passthrough／skills passthrough 出口：须改为可计量中止，**禁止**无界 `pipe` 直灌作为合规路径）。分档硬顶可按工具类配置，默认共用两档字节顶。 |
| OQ-SC06 | **批准 SC-06 由本条实现并验收**（覆盖 P1-82「移下期」划分）。 |
| OQ-A3 预注册 | 成功率 ≥ max(95%, T1_success−2pp)；interactive p95 ≤ 1.5× T1 p95（同硬件档）；采样窗与 T2 并发在 Task 0 冻结后写入 Plan／UAT，**开跑前**登记，禁止事后改通过线。 |
| OQ-R | **r4 修订（与 REQ-0122 D2 解耦）**：`borrowMax` **不再绑定** `global×0.5`；独立待校准初始假设 **`borrowMax=12`**（REQ-0122 落地、global=48 时对应 `reserveR=36`，满足 `reserveR < global`）——integration 可借槽包络维持原风险水位，不随 global 上调放大（2C2Gi 约 8 并发 CPU 饱和下 24 路借槽风险过高）。最终值仍由 Task 0／T2 压测冻结；对外水位表只公布冻结值；出厂 env 可保留假设但文档标注未校准。 |
| OQ-global | **已裁定（2026-11-27，随 Spec 定稿）；r4 修订（委托人 2026-11-27 授权，跨 Spec 冲突 C1 采案 A）**：冻结解除——四层容量默认**改随 [REQ-0122](lucy-20261126-question-budget-analyst-workflow-revision-spec.md) D2**（`token 8 / agent 16 / connection 32 / global 48`）；REQ-0122（P0）先落地，本条不再独立冻结四层档位，部署侧可经 REQ-0122 SC-11 env 臂回调。本条冻结对象收窄为 **reserveR／borrowMax（OQ-R）与 SC-06 字节顶（OQ-CAPS）**。可用性合同仍靠 **SC-08 时延分母**＋保留槽／borrow，而非假设全部并发皆为舒适时延。实现禁止偷偷改默认；另裁须新变更行。 |
| OQ-hold | T4／SC-09 判定：**停压后等待 ≥ `CANCEL_HOLD_MS`＋5s** 再测回落；reserved 槽上的 hold 租约计入占用（不豁免），水位表标注最坏回收时延。`CANCEL_HOLD_MS` 默认接受 REQ-0122 D5 **全局 5s（不分 workloadClass，r4 极简裁定）**；短冻结残余风险见 §7。 |
| OQ-HEALTHCHECK | T2／T3 期间容器 HEALTHCHECK 假红：跑次记录但不单独判本条 FAIL；须在跑次注明；轻量探针改动**不在本条出口**（可另立）。 |

## 4. 核心流程（伪代码）

### 4.1 workloadClass

```text
Agent.workloadClass ∈ { interactive, integration }
缺省 / 存量迁移 → interactive
integration → 仅可占用「可借槽」；不可占用保留槽 R
interactive → 可占用保留槽；仍受 token/agent/connection/global 约束
```

### 4.2 容量代数（B-02 闭合）

```text
limits: token, agent, connection, global, reserveR
borrowMax = global - reserveR          # reserveR >= 1, borrowMax >= 1
assert agent < connection <= global
assert reserveR < global

tryAcquire(req):
  # 既有四层顺序不变
  check token / agent / connection / global as today
  if req.workloadClass == integration:
    # integrationActive 计入该身份全部调用（含轻元数据工具；REQ-0122 D2
    # 独立元数据并发池不是绕过路径，见「与既有 Spec 的关系」REQ-0122 行）
    if integrationActive >= borrowMax:
      reject scope=workload, retryAfterMs=...
  # interactive 不增加 integrationActive
  # 占用 global 时：integration 与 interactive 都计入 globalActive
```

多 Agent 的 integration 合计受 `borrowMax` 约束（闭合「3×agent 绕过」）。

### 4.3 SC-06 读取闸（B-03 闭合）

```text
readUpstreamBodyLimited(stream, caps):
  # 替换所有 readUpstreamBody 调用点（握手 + 工具）
  while chunk:
    total += len(chunk)
    globalInflight += len(chunk)
    if total > caps.perResponse OR globalInflight > caps.globalBudget:
      abort stream
      release partial buffers
      return error response_too_large / memory_pressure
  ...
finally: globalInflight -= accounted
```

入站 `MAX_BODY_BYTES` 保持；与 SC-06 正交。

### 4.4 热更新（M-06）

- 已发 Token：下次 admission 读 Agent 当前 class（撤权屏障后的已提交视图）。
- 在途租约：不改 class 归属计数维度直到 release；禁止中途把 interactive 租约「偷换」为占用 borrow。
- 打标错误回滚：改回 interactive 后新请求走 interactive 规则。

### 4.5 行数轨 vs 字节轨（M-04）

1. 请求参数 limit 钳制（既有 DEFAULT／MAX）  
2. 上游执行  
3. SC-06 字节／内存闸  
任一触顶即失败；不先缓冲完整结果再截断冒充成功。

### 4.6 问询预算闸（OQ-3 修订）

```text
consumeBudget(req):
  if req.workloadClass == integration AND budgetExemptEnabled():
    shadowRejected += wouldExceed(state)   # 只计数，不拦截
    return allow
  # interactive：P1-74 语义 100% 不变（既有路径）
  ...
```

豁免开关 env 默认开；关回后 integration 走与 interactive 相同的预算路径。影子计数随请求累计并进 health 摘要。

### 4.7 initialize 轻量路径（OQ-7）

```text
handleInitialize(req):
  if req.agent.workloadClass == integration:
    return STATIC_MINIMAL_INSTRUCTIONS   # 进程内预装载，不占槽
  decision = await decideInitializeInstructions(...)   # 既有路径不变
```

不变量：两条路径产出的 `tools/list` 可见集同构。

## 5. 验收 SC

| ID | 条件 |
|---|---|
| SC-01 | Agent 可读写 `workloadClass`；OpenAPI 可见；审计留痕；缺省 interactive |
| SC-02 | 系统间 SOP：integration Agent＋Token；**发放系统间 Token 前核对目标 Agent 非 interactive（硬检查点）**；UAT 夹具含两类 Agent |
| SC-03 | 多 integration Agent 合计打满 borrowMax → `capacityScope=workload`（或等价机读）；立即拒绝；无新上游 |
| SC-04 | borrow 打满时 interactive 小查询仍成交（独立 SQL 核对） |
| SC-05 | T3 大响应：流式触顶；RSS／event-loop 不因整包缓冲假死；interactive 仍成交 |
| SC-06 | 上游响应**全出口**挂钩限流：`readUpstreamBody` 调用点＋`pipeResponse`／passthrough／skills passthrough；封闭清单含 grep 模式集；禁止无界 pipe 合规 |
| SC-07 | `interactive` 身份：容量拒绝不扣预算；SC-06 中止按 OQ-3(a) 结算预算（须 UAT 核 counters）。`integration` 身份：计费数据工具调用**不受问询预算约束**（不产生 `question_budget_exhausted`、无续问要求），仍受四层容量墙、`borrowMax` 与 SC-06 约束；影子计数随请求累计（单测＋UAT 实证） |
| SC-08 | T2 混压：预注册成功率＋p95 分母通过（OQ-A3） |
| SC-09 | T4：停压后 wait≥hold+5s，capacity 回落，interactive 恢复 |
| SC-10 | health／mcpCapacity 含 workload／integration 拒绝计数；**interactive 高并发／大响应触顶**代理计数（漏打标告警）；**脱敏 `agentId` 有界 Top-N**（无 Token／查询正文）；**每 agent 用量聚合**（调用次数／累计耗时／峰值并发／SC-06 触顶次数）；**预算影子计数**；**SC-06 触顶计数按工具分层分桶**（重查询桶／轻元数据桶，分层随 REQ-0122 D1），**漏打标代理告警以重查询桶为准**——轻桶（如宽表 `lucy_read_source`）触顶属分析师正常探索，不计入漏打标嫌疑、单列观测；无敏感正文 |
| SC-11 | 开发者指引：Python＋Java 示例、水位表、退避、**显著「非官方 SDK」**。最低契约：① 显式说明 `measures` 必填、单次 `limit ≤ 1000`、按过滤区间手动分片（OQ-6）；② `workloadClass=integration` 的 OpenAPI 打标＋校验命令（OQ-8 SOP）；③ 示例代码须解析 HTTP 200＋`isError` 机读字段（`query_concurrency_exceeded` 按 `retryAfterMs` 退避；`response_too_large`／`memory_pressure` 禁止无节流原样重打）、在 `404`／`upstream_session_required` 时自动重建会话、非预期响应严格抛错（禁止静默返回空 `rows`）、Java 示例须具正式 `package` 与线程安全共享 `HttpClient`；④ 示例标注对应 lucy 版本 |
| SC-12 | stability-sentinel：引用现行阈值；「持续」＝连续 3 个哨兵采样窗越线 → FAIL（与 sentinel 实现对齐并写 UAT） |
| SC-13 | `workloadClass=integration` 的 `initialize` 走静态极简指引：不占 instructionsWork 槽位、不触发目录／Skill 扫描；**`tools/list` 可见集与完整构建路径同构**；`interactive` 握手行为不变；指引内容冻结口径见 OQ-7（不随 REQ-0122 D7 更新） |

## 6. 压测场景（合同化）

| 场景 | 内容 |
|---|---|
| T1 | 仅 interactive 小查询基线 |
| T2 | integration 约 10–40 路＋interactive 探针 |
| T3 | 故意大明细／大响应（**须记录 interactive 探针当窗 p95**，水位表按「内存触顶」与「CPU 挤压」分别归因，防字节口径得出偏乐观结论） |
| T4 | 停压＋hold 宽限后恢复 |
| T5 | sentinel 全程 |

## 7. 风险与非目标

- 漏打标 integration 占用 interactive 权利：残余运维风险（OQ-2），由 SC-02 硬检查点＋SC-10 脱敏 Top-N 定位承担。
- **速率型滥用无闸（OQ-RATE 显式分期）**：豁免预算后，并发墙不拦速率——低频高量长打（如分页循环 bug）压力穿透到上游数据库，且上游压力最终会以查询变慢形式反噬 interactive 主路径；本合同不保护上游数据库，试点期依赖用量观测＋人工巡检；回补触发条件见 OQ-RATE。
- **短取消冻结窗口（REQ-0122 D5：30s→5s）× 脚本断连重试**：integration 脚本若在超时重试循环中高频断连，槽位 5s 即释放，上游僵尸大查询更易堆积并穿透到上游数据库（上游压力不在本合同保护范围，见上条／OQ-RATE）。r4 裁定**接受全局 5s、不分流**——120s 硬时限已封死单查询上游成本上界，分流会分叉 REQ-0122 刚统一的单一默认值、多一组 env 与测试矩阵，收益不抵复杂度。兜底：SC-11 退避契约（禁止无节流原样重打）＋SC-10 每 agent 用量聚合／SC-06 触顶分桶监控；试点期若观测到穿透，按 OQ-RATE 触发条件回补速率护栏。
- 同进程 event-loop 被非 MCP 路径阻塞：本条不闭合（P1-84／审计读等）。
- **合同外编排行为击穿本保护**：integration 过载 → event-loop 拥塞 → health 探针超时 → 编排器重启循环（全员雪崩）。探针轻量化不在本条出口（OQ-HEALTHCHECK 已裁）；须另立 backlog 条目登记，禁止在事故前无人认领。
- 进程拆分：另场。

## 8. 授权边界

- **终稿已确权并 r3 重新确权**（2026-11-27：spec 定稿授权＋OQ-3 修订／OQ-6／OQ-7 及配套吸收项「批准」）。  
- **开发未授权**：未获委托人另行开发授权前禁止改运行代码。  
- 设计／Plan／UAT 对抗过程 ≠ 开发授权 ≠ UAT PASS ≠ 可上线。
