# UAT-SUITE-BUDGET-ANALYST-UX — 问询预算分析师工作流与慢数仓体验

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-BUDGET-ANALYST-UX` / **v1.0** |
| 日期 | 2026-11-27 |
| 总账 / 合同 | **REQ-0122** · [Spec](../../../../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md) SC-01–SC-12 |
| 目标 | 证明在保留 runaway 防火墙的前提下，Claude Code 并行探索、轻工具批量读表、慢数仓（`hive-jd` 类）多轮下钻、Esc 中断重问、长会话静默逃生在纯 MCP 下端到端成交；同时验「防火墙仍拦得住 runaway」与「合法高频工作流成交」双覆盖 |
| 运行环境 | 本机 demo Docker＋真实 KTX／只读数据连接＋真实 Claude Code 纯 MCP＋慢源夹具（`v_sleep` 视图，45–90s 首字节可调）＋多 Token／多 Agent 身份；**无浏览器臂**（非 WebUI，Spec §8 豁免）；`hive-jd` 实况可在客户环境补跑，本机以 MySQL 慢源夹具等价模拟慢引擎 |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md) 为唯一结果事实源。当前 **NOT RUN**（Spec v1.0 终稿已确权 2026-11-27；**开发未授权**、实现未落地；正式跑次须开发授权后执行。≠ 功能合同收口；≠ UAT PASS；≠ 可上线） |

## 来源与定位

承接 REQ-0122 Spec（v1.0，D1–D8 全案采纳 (a)）：预算、并发舱壁与上游超时三层默认值针对「并行 Agent（Claude Code）＋ 慢分析型外部目录」重新校准。本套件验收 SC-01–SC-12，并补齐既有预算套件的回归缺口。

| 套件 | 分工 |
|---|---|
| `UAT-SUITE-QUESTION-BUDGET`（P1-12） | 默认 60／300 旧口径基线；本套件不重复 |
| `UAT-SUITE-BUDGET-ESCAPE`（P1-74） | 触顶逃生主合同；本套件 **BA-10 兼作 BESC-07 回归臂**（`begin active` 新默认 3 档）、**BA-06 兼作 BESC-10A 补齐**（busy 触顶＋续查成交） |
| `UAT-SUITE-INTEGRATION-MCP-CAP`（REQ-0119） | integration 借槽与背压；本套件只验分析师 interactive 侧容量与预算 |
| **本套件** | 轻重分层（D1）、并发 8 路＋元数据池（D2）、慢源超时／忙时（D3）、失败封顶（D4）、取消冻结（D5）、active 3 档（D6）、Claude Code 端到端（D7）、环境变量回退（D8） |

## 全真性

- 真实 Lucy／KTX／DB／Agent Token；慢源必须真实消耗挂钟时间（`SLEEP` 视图或等价真实慢引擎），禁止 mock 时钟、桩上游或客户端截断冒充服务端行为。
- SC-12 必须使用**真实 Claude Code**（非脚本模拟 Agent）完成端到端多轮任务；轨迹须含自动缩并发重试与静默 `lucy_continue_question` 证据。
- 预算初态必须为已知零态（新 Token／新 Agent 作用域）；非零态不得用于次数／忙时边界判定。
- 审计证据取真实 `budgetSettlement` 记录（含 `rawDeltaMs` 与 `billedBusyMs` 双字段），不得以日志代替。
- 环境变量回退（BA-11）须在独立容器跑次验证并恢复默认档，不得与放行类用例混场。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-BA-R0、01–12 全部 | BA-13（`hive-jd` 真实目录现场补跑，条件具备时） |

## 判定口径（强制）

1. **双覆盖**：约束生效类（BA-01／02／03 拒绝臂）与合法成交类（BA-04／05／06／08／09／12）均须 PASS；缺任一臂不得主张 PASS。
2. **成交定义**：工具成功＋事实行匹配独立数据库 oracle；「没有 exhausted」「非 ACL」均不等于成交。
3. **失败封顶验证**（BA-07）必须同时呈现 `rawDeltaMs≈90000` 与 `billedBusyMs=30000` 双审计字段；只验其一不算 PASS。
4. **改前基线**：实现前如需预跑，按真实结果记 FAIL 作为缺陷锚点，不得改为 SKIPPED。
5. **禁止** vitest／CR／读代码冒充真实 MCP／Claude Code 执行结果；跑次不得写入 Bearer／密码明文。
6. UAT 设计定稿及登记本套件 **≠** 开发授权；正式跑次须开发授权后执行。

## 边界

- 纯 MCP／真实 Agent；不强制浏览器（Spec §8 豁免交互合同门禁）。
- 本机以 MySQL 慢源夹具等价模拟慢引擎；`hive-jd` 真实目录证据为可选增强（BA-13），不阻塞套件判定。
- G3 已接受权衡：快源上真挂起查询多等 60s 才报超时；BA 用例不得将该权衡记为缺陷。
- per-connection 超时配置（OQ-1）不在本套件范围。
