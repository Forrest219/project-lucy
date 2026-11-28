# UAT-SUITE-BUDGET-ANALYST-UX — 问询预算分析师工作流与慢数仓体验

| 元数据 | 内容 |
|---|---|
| Suite ID / 版本 | `UAT-SUITE-BUDGET-ANALYST-UX` / **v1.1** |
| 日期 | 2026-11-27（v1.0 建套；v1.1＝Spec §10.3 六项同步） |
| 总账 / 合同 | **REQ-0122** · [Spec](../../../../specs/lucy-20261126-question-budget-analyst-workflow-revision-spec.md) **v1.0-r6＋** SC-01–SC-12＋SC-02b＋SC-07b |
| 目标 | 证明在保留 runaway 防火墙的前提下，Claude Code 并行探索、轻工具批量读表、慢数仓（`hive-jd` 类）多轮下钻、Esc 中断重问、长会话静默逃生在纯 MCP 下端到端成交；同时验「防火墙仍拦得住 runaway」与「合法高频工作流成交」双覆盖（含 OQ-4／OQ-6 敌对臂） |
| 运行环境 | 本机 demo Docker＋真实 KTX／只读数据连接＋真实 Claude Code 纯 MCP＋慢源夹具（`v_sleep` 视图，45–90s 首字节可调）＋多 Token／多 Agent 身份；**无浏览器臂**（非 WebUI，Spec §8 豁免）；`hive-jd` 实况可在客户环境补跑，本机以 MySQL 慢源夹具等价模拟慢引擎 |
| 剧本 | [用例](cases.md) · [夹具](fixtures.md) · [跑次槽](runs/README.md) |
| 判定 | [INDEX](../../INDEX.md) 为唯一结果事实源。当前 **PASS WITH FINDINGS**（2026-11-28 [跑次](runs/2026-11-28-kscc-budget-analyst-ux.md)：15 臂全 PASS＋并发补充臂 PARTIAL；F1／F2／F3 均已修复并回归验证关闭（SC-03 预算层闸、不扣 calls、reason 命名三子点闭合）；mcp-proxy-smoke 3 个 P1-82 失败为存量（基线一致）。≠ 功能合同收口；≠ 可上线） |

## 来源与定位

承接 REQ-0122 Spec（D1–D8；OQ-4／OQ-6 已裁；PRE-01 已闭合）。v1.1 按 Spec §10.3 同步防假绿门禁，**取代** v1.0 旧映射；v1.0 设计不得再执行或判 PASS。

| 套件 | 分工 |
|---|---|
| `UAT-SUITE-QUESTION-BUDGET`（P1-12） | 默认 60／300 旧口径基线；本套件不重复 |
| `UAT-SUITE-BUDGET-ESCAPE`（P1-74） | 触顶逃生主合同；本套件 **BA-10 兼作 BESC-07 回归臂**（`begin active` 新默认 3 档）、**BA-06 兼作 BESC-10A 补齐**（busy 触顶＋续查成交） |
| `UAT-SUITE-INTEGRATION-MCP-CAP`（REQ-0119） | integration 借槽与背压；**UAT-IMC-03 轻／重混合臂**为本条 SC-03 跨 Spec 组合证据（见 cases 勾连） |
| **本套件** | 轻重分层（D1）、并发 8 路＋元数据池（D2）、慢源超时／忙时（D3）、失败封顶＋持续失败有界（D4／OQ-4）、取消冻结（D5）、active 3 档（D6）、Claude Code 双臂逃生（D7／SC-12）、环境变量回退（D8）、轻工具跨窗有界（OQ-6／SC-02b） |

## §10.3 同步清单（v1.1）

| # | 门禁项 | v1.1 落位 |
|---|---|---|
| 1 | BA-07／OQ-4 | `UAT-BA-07`＋`UAT-BA-07b`（`failedKind`、SC-07b 连败停机、跨窗总档） |
| 2 | IMC-03 轻／重混合 | 勾连 `UAT-IMC-03`（integration-mcp-capacity v1.0-r4）；本套件 R0 记录勾连指针 |
| 3 | BA-09 全信封＋释放成交 | `UAT-BA-09` 扩写 |
| 4 | BA-12 begin 双臂 | `UAT-BA-12A`／`UAT-BA-12B` |
| 5 | PRE-01 移出执行链 | `UAT-BA-R0` 只**引用**已落盘证据，不再现场抓包 |
| 6 | OQ-6／SC-02b | `UAT-BA-02b` |

## 全真性

- 真实 Lucy／KTX／DB／Agent Token；慢源必须真实消耗挂钟时间（`SLEEP` 视图或等价真实慢引擎），禁止 mock 时钟、桩上游或客户端截断冒充服务端行为。
- SC-12／BA-12 必须使用**真实 Claude Code**（非脚本模拟 Agent）；轨迹须含自动缩并发重试与静默逃生证据。
- 预算初态必须为已知零态（新 Token／新 Agent 作用域）；非零态不得用于次数／忙时边界判定。
- 审计证据取真实 `budgetSettlement`（含 `failedKind`、`rawDeltaMs`、`billedBusyMs`），不得以日志代替。
- 环境变量回退（BA-11）须在独立容器跑次验证并恢复默认档，不得与放行类用例混场。

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-BA-R0、01、02、02b、03–07、07b、08–11、12A、12B | BA-13（`hive-jd` 真实目录现场补跑，条件具备时） |
| 跨套件：`UAT-IMC-03` 轻／重混合臂（记入本套件判定勾连，不以本套件 interactive Token 冒充） | — |

## 判定口径（强制）

1. **双覆盖**：约束生效类与合法成交类均须 PASS；缺任一必做臂不得主张 PASS。
2. **成交定义**：工具成功＋事实行匹配独立数据库 oracle；「没有 exhausted」「非 ACL」均不等于成交。
3. **失败封顶**（BA-07）：须同时呈现 `failedKind`（窄集合）＋`rawDeltaMs`＋`billedBusyMs`；合法空结果不得走 30s 封顶。
4. **持续失败**（BA-07b）：单窗停机 reason 仅为 `question_budget_exhausted`（靠 calls／busy），**无**连败 N 独立 reason。
5. **轻工具跨窗**（BA-02b）：敌对臂档尽硬停＋正臂合法换窗成交双臂都要。
6. **改前基线**：实现前如需预跑，按真实结果记 FAIL 作为缺陷锚点，不得改为 SKIPPED。
7. **禁止** vitest／CR／读代码冒充真实 MCP／Claude Code 执行结果；跑次不得写入 Bearer／密码明文。
8. UAT 设计定稿及登记本套件 **≠** 开发授权；正式跑次须开发授权后执行。

## 边界

- 纯 MCP／真实 Agent；不强制浏览器（Spec §8 豁免交互合同门禁）。
- 本机以 MySQL 慢源夹具等价模拟慢引擎；`hive-jd` 真实目录证据为可选增强（BA-13），不阻塞套件判定。
- G3 已接受权衡：快源上真挂起查询多等 60s 才报超时；BA 用例不得将该权衡记为缺陷。
- per-connection 超时配置（OQ-1）不在本套件范围。
- PRE-01 现场抓包不在本套件执行链；R0 只引用 [`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)。
