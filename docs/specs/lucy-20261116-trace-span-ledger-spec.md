# 调用流水 trace 级可追溯与存档（span 模型）Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 调用流水 trace 级可追溯与存档（span 模型）Spec |
| 文档类型 / 版本 | Spec / **v1.0** |
| 日期 / 目标版本 | 2026-11-16／产品线 `0.30.0`（分支 `lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-36**／REQ-030-057／**P1**（审计证据增量；延伸 v0.25 审计增量）。**不入 0.30 核心分母** |
| 阶段 | S4 |
| 状态 | **S4｜终稿确权（委托人 2026-11-17 授权代理修正后定稿，免 Codex 终审）；v1.0；已获开发授权（委托人 2026-11-17「授权开发落地」）；代码已落地（span 表、同事务写入、spans.csv 与 spanCoverage、`/api/admin/audit/status`），vitest 回归无新增失败，本机 demo 已平滑升级并取证；测试台 `UAT-SUITE-TRACE-LEDGER`＝**PASS WITH GAP**（2026-11-17 宽目录沙箱 Tier-A 跑次 `docs/qa/uat/suites/trace-span-ledger/runs/2026-11-17-claude-wide-sandbox-tierA.md`；TRC-01/02/03/04/05/06/10/11 有证据，TRC-07/08/09 NOT RUN，不是整套 PASS）；登记发现 F-1～F-5，其中 F-2（正式完整导出 `mode=complete` 因既有 F-02 失败关闭，`spans.csv` 只在诊断包验证）与 F-3（SC-06 与 §6.2 口径冲突）待委托人裁定。≠ UAT PASS；≠ 可上线** |
| 决策来源 | 委托人 2026-11-16 夜：要求「平台记录日志、流水的能力满足 trace 级的访问追溯和存档，同时满足审计要求」；经澄清选定：本轮交付＝文档＋指标＋UAT 套件（不改运行代码）；存档范围＝**第 1 层**（trace 全链路关联＋封存导出，不含防篡改链与外送）；实现路线＝**方案 B（新增 span 表）**（评审建议过方案 A，委托人选 B，代价见 §9）；委托人批准设计后授权对抗性审阅（过程评审，记录见 [评审记录](../reviews/2026-11-16-p1-36-p1-37-adversarial-review.md)） |
| 需求来源 | 客户全量调用流水分析（2026-11-09 18:54–11-16 18:50，23,687 条；客户材料**未入仓**，见 §1 证据等级）；基准 [v0.25 审计增量 Spec](lucy-20261020-v2p5-audit-increment-spec.md) S01–S07 |
| 撰写日期 / 撰写人 / 委托人 | 2026-11-16／Claude（Cursor Agent）／xingchen |
| 基于材料 | 上述客户流水与问询记录导出；`webui/server/proxy/{audit,audit-classification,audit-derivation,mcp-proxy,request-client-meta}.ts`、`webui/server/admin/{audit,audit-export-v2}.ts` 现状摸底（符号与复核行号见 §3） |
| 适用范围 | 调用流水（`access_log`）的 trace 级关联、封存导出与对账；不改任何运行代码 |
| 实施主体 | WebUI 服务端：`webui/server/proxy/`（埋点、写入、派生）、`webui/server/admin/audit-export-v2.ts`（导出）；测试 `webui/server/__tests__/` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **延伸**（不改写）v0.25 审计增量 S01（主状态八桶）、S03（标识）、S05（对账）、S06（导出封存与版本链）；**不改** S07 七分类取值、不改已收口的导出文件的既有列与顺序（`calls-v2.csv` 只允许在**末尾追加** additive 列：D8 的 `ip_source`／`trusted_source` 与 [P1-37](lucy-20261116-mcp-ux-resilience-spec.md) 的 `rejection_fingerprint`；追加不改既有列取值，历史行追加列为空）；与 [P1-37](lucy-20261116-mcp-ux-resilience-spec.md) 共用阶段枚举与**理由码登记表**（§5.4，登记权在本 Spec）；与 P1-32／P1-33 的等价守卫 [`UAT-SUITE-EQUIV-GUARD`](../qa/uat/suites/audit-scale-equivalence-guard/suite.md) 同改动面，须一并跑 |
| 实施计划 | [`docs/plans/lucy-20261116-trace-span-ledger-plan.md`](../plans/lucy-20261116-trace-span-ledger-plan.md) |
| 测试台 | [`UAT-SUITE-TRACE-LEDGER`](../qa/uat/suites/trace-span-ledger/suite.md)（INDEX：NOT RUN） |
| 输出位置 | `docs/specs/lucy-20261116-trace-span-ledger-spec.md` |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 CR-07 确权 | 2026-11-17 委托人确权：`calls-v2.csv` 末尾追加 `ip_source`／`trusted_source`／`rejection_fingerprint` 属 D8／P1-37 允许的 additive 变化，批准豁免；第 17 行与豁免条款由「列与顺序不改」改为「既有列与顺序不改、仅末尾追加」；等价守卫登记 F-8（`calls-v2.csv` 既有列，golden 由追加前 `28cad205` 的实现产出）与 F-9（`spans.csv` 冻结首版） |
| v1.0 复核修订 | 2026-11-17 代码审查后的实现对齐，不改合同：manifest `derivationVersion` 取现行派生版本 `v2p5-2`（D7，与 `spanCoverage.version` 一致）；基础导出路径的 `spans.unsequenced` 与 pack 路径同口径计数（不再硬编码 0；仍为被排除 span 数，与 `spanCoverage.unsequenced` 的行数量纲不同）；Trace ID／Trace Span 并入术语标准 §4.7；`redactStorageDetail` 补 `scheme://user:password@host` 口令段；TRC-11 事件环度量改为先锚点再补尾（Node 直方图首个回调只作锚点），脚本默认规模降为 2 万条、10 万条须显式 `--traces 100000` |
| v1.0 | 2026-11-17 **终稿确权（委托人授权代理修正后定稿，免 Codex 终审；≠ 开发授权）**：O1–O8 全部闭合（O6 冻结为每 trace span 表＋索引平均 ≤ 8 KB、平均 span 数协议 ≤ 6／业务 ≤ 14，span 与父行同寿命、不新增清理；O2／O7／O8 取建议值）；`session_shortcircuit` 注明为 P1-37 U3b 预留。R3 修订**未经第 4 轮复审**，为已知缺口。|
| v0.4-draft | 2026-11-17 对抗性审阅 R3（终轮；GPT 5.6 子代理，**非 Codex CLI**；8 条，逐项状态见评审记录）修订：§5.4 理由码注册表 v1 冻结为 17 项粗粒度码＋全函数映射（原始 `decision_reason` 留旧列与 `reason_param`，DB `CHECK`）；`sl_query` 脱敏 UAT 改为「基线能用合法入参真实触发才入 UAT，否则 vitest」；D8 补 `X-Real-IP` 分类修正；C9c 墙钟锚定（`v2p5-2` 行 `ts` 与根终点同读数）；`attrs_json` 按 UTF-8 字节＋`json_valid`；`foreign_keys` 由 admin 状态接口读服务连接值；O1 去掉已冻结的 20 ms。总账出口同步改为「已落库行」。|
| v0.3-draft | 2026-11-17 对抗性审阅 R2（GPT 5.6 子代理，**非 Codex CLI**；15 条，逐项状态见评审记录）修订：承诺收窄为「已落库行的 span 扩展与原子性」，入口完整性不由本条承担（漏记由 UAT 检出、故障下丢行归 S02）；发送清单关联键改用 UA＋唯一 JSON-RPC id；`spans.csv` 的 `ledger_seq` 经 JOIN 所属行；`ip_source`／`trusted_source` 改为**新增两列**（`trusted_source` 现状未落账）；C8 增加连通／无环／序号连续／列约束并落 DB CHECK；`tools/call` 最小阶段集合；理由码改为有限版本化注册表（`reason_code`＋`reason_param`）；`foreign_keys` 开启的子表盘点与删除顺序；根 span 关闭边界冻结、C9 容差由 20 ms 改为 1 ms 取整；同 S 重导须 pending=0，因果序号问题登记 O7；hdfs 脱敏子项移出必做 UAT（O8）；§3 改按分支矩阵；脱敏预期表补公网／IPv6 等反例 |
| v0.2-draft | 2026-11-17 对抗性审阅 R1（GPT 5.6 子代理，**非 Codex CLI**；19 条）修订：D4 拆为「原子性」与「失败语义」并按现状（审计在响应后异步写）重写；C9 改为根 span 区间包含＋固定容差；主状态改为 `primary_status=denied`＋`error_category=policy_denied`；导出重导一致性降为 `spans.csv` 规范化内容一致（不要求整包字节一致）；证据合成改为各请求类必有 span 集合；新增数据完整性约束（FK／唯一键）；新增 §5.4 理由码登记表；`ip_source` 与既有 `trusted_source` 联合；SC-11 升必做；32 上限改为 31＋1；§3 改符号锚点；§1 增证据等级 |
| v0.1-draft | 2026-11-16 初稿：span 模型、同事务写入、派生版本、封存导出与对账三检查、脱敏与 `ip_source`；挂测试台 `UAT-SUITE-TRACE-LEDGER` |

## 闭口层级

- 层级：功能合同
- 本条承诺：**已落库**的调用流水行（迁移提交后写入、`derivation_version=v2p5-2`，含协议请求、wiki、被拒请求）**每一条**都带 `trace_id`，且能还原该请求从准入到响应的**阶段记录（span）**；行与其阶段记录在同一事务写入（要么都在，要么都不在）；封存导出包带阶段记录文件，行数、哈希与截止序号可与库对账。**本条不承诺「每个请求都必有一行」**：入口完整性（先持久后释放、received 屏障）属 v0.25 S02／S05；本条只在审计写入健康时用测试台独立发送清单**检出**漏记，写入故障下的丢行是 S02 缺口，在 §9 如实登记，不被本条掩盖也不被本条修复。
- 本条出口：SC-01–SC-12（vitest 契约／等价测试＋测试台 `UAT-SUITE-TRACE-LEDGER` 必做，含 UAT-TRC-11）。
- 不在本条出口：防篡改链与外送（本轮第 2、3 层）；历史行回写；客户现场复测与客户 amd64（证据等级归发布取证）；**审计写入改为先持久后释放（fail-closed）**——属 v0.25 S02 规范流程，本条不承担也不削弱（见 D4、O2）；身份归责、最小权限解释、字段敏感性分级、结果流向（审计报告 v1.1 非目标，不变）。
- 上线关系：本条收口不表示可上线；**功能合同收口 ≠ UAT PASS ≠ 可上线**。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: **调用链路 ID**（Trace ID；调用流水列 `trace_id` 的展示名，禁用「追踪号」「链路号」混称）；**阶段记录**（Span；一次请求内某一阶段的耗时与结果，禁用「子调用」「节点」）。两词已并入术语标准 §4.7（Trace ID／Trace Span）；调用流水 CSV 与封存包的列头沿用既有「调用流水」「事件 ID」口径，不新增面向用户的 WebUI 文案。

## 交互合同豁免

- 原因：本条只改服务端写入、派生与导出文件，不改变用户可见 WebUI 表面（WebUI 页面、组件、按钮、文案与布局）。
- 不改变：页面路由与组件；调用流水页、问询记录页的既有列与筛选；既有导出文件的既有列、顺序与文本（新增文件不替换旧文件；`calls-v2.csv` 仅在末尾追加上述三列，由等价守卫 F-8 冻结既有列）。

## 1. 背景与证据

**证据等级**：下表数字来自对客户全量调用流水的分析。客户导出（xlsx）与分析报告在**仓外**（`/Users/zhangxingchen/Projects/Inbox@Projects/20261116-2305-lucy客户日志审计可观测体验评估.md`），仓库内无脱敏证据包、查询或哈希，因此**全部标「不可核（仓外材料）」**。它们是需求线索，**不作为阈值或验收依据**；本条验收只用 demo 基线（Plan 步骤 0）。E7 的「仓内无 xlsx 生成器」可在仓库核对。

| # | 事实 | 数字（不可核） |
|---|---|---|
| E1 | 协议请求（`initialize`／`tools/list`／`notifications/*`／`ping`）无 `trace_id` | 14,378 行，占 61%（总 23,687；11 个账号） |
| E2 | `primary_status=unknown` | 15,113 行（64%）：协议请求全部、wiki_search 2,570、wiki_read 1,347、另有 `lucy_query` 104 |
| E3 | 耗时只有总 `duration_ms`，无阶段分解；握手日中位数从 10 ms 退到 1.6 s、尾部达 403 s，无法定位阶段 | 149 次 initialize 超过 30 s（11-16） |
| E4 | `client_ip` 只有 2 个取值，77% 的会话在会话内换 IP（网关地址，非客户端） | 2,439／3,160 会话 |
| E5 | `error_detail` 含内网地址、HDFS 路径；`lucy_query` 的上游错误可含内部工具名 | 9 行含 IP／路径 |
| E6 | `wiki_search` 的摘要被标 `digest_kind=sql`；`lucy_query` 的 1,960 条 SQL 摘要无 `digest_kind` | 2,566 行 |
| E7 | 导出文件（xlsx）存在 16,384 列与 19 行损坏数据；仓内审计导出为 CSV／ZIP，**无 xlsx 生成器**（可核），产出路径未知 | 见 §9 O3 |
| E8 | 没有部署／重载／重启事件入账，无法判定停顿窗口与 `policy_version` 变更的因果 | 12 个窗口中 5 个与变更重合 |

**根因（代码摸底，可核，符号见 §3）**：`trace_id` 只在 `tools/call` 写入；协议与 wiki 审计不传 `executionEvidence`，按 S01 规则 9 落 `unknown`；现有 trace kernel（`recordMcpTrace*`）是**异步、尽力而为、会清理**的，不能当存档真源；审计写入 `recordAudit()` 在响应发出**之后**异步执行，失败只记运行日志。

## 2. 非目标

- 不回写、不重算历史行（旧行保持 `derivation_version=v2p5-1`，不进入 C7／C8 分母，单列 `legacyUnlinked` 计数）。
- 不做防篡改（hash 链／签名）与外送（OTel／syslog／对象存储）；留待第 2、3 层另立行。
- 不引入采样。存档语义下，丢 span 与丢行同样是缺陷。
- 不改 S07 七分类枚举与 S01 主状态八桶；不改 ACL／门闩等任何业务裁决。
- 不改审计写入的时序（仍在响应后异步）、不引入新的 503／阻塞分支（见 D4）。
- 不修复客户 xlsx 的来源（O3 先取证）。

## 3. 现状锚点（摸底，复核于 2026-11-17）

> 以符号名为准；`mcp-proxy.ts` 在工作区含未提交改动，行号会漂移，括号内为 2026-11-17 复核值，仅作定位提示。

| 项 | 位置 |
|---|---|
| 关联列与子表 | `access_log` 已有 `user_agent`、`rpc_request_id`、`ledger_seq`（写入时读取的 MAX，非 ingress 因果序号）；指向 `access_log(id)` 的子表不止一个（已知 `access_log_sources`〔FK 无 CASCADE〕、`access_log_attribution_mutations` 等，Plan 步骤 1 盘点） |
| 主表与迁移 | `webui/server/proxy/audit.ts`：`access_log` DDL（约 `537–568`）；`ACCESS_LOG_COLUMNS`；`ensureColumn` additive 迁移；`writeLog`（约 `990–1167`，只插 `access_log`，无事务、不接收 span）。**未发现** `PRAGMA foreign_keys` 设置，**未发现**对 `access_log` 的清理任务（只有 trace kernel 与问询预览有各自保留） |
| 审计写入时序 | `mcp-proxy.ts`：`recordAudit()`（约 `581–614`）在多数路径 `res.end()` **之后**调用，`writeLog().then(…)` 异步，失败走 `failAuditWrite()`＋`console.error`；`writeAccessLogSources` 在行之后**单独**写，不在同一事务 |
| `trace_id` 生成与写入 | `mcp-proxy.ts`：`trace_${randomUUID()}`（约 `4026`）；`recordRequestAudit` 仅 `rpcMethod==="tools/call"` 注入 `trace_id`（约 `4118–4126`） |
| 请求时间 | 旧行 `ts` 在**请求结束时**构造（`new Date().toISOString()`；`v2p5-2` 行改取与根 span 终点同一读数，见 C9c），`duration_ms` 自请求开始累计，故调用区间为 `[ts − duration_ms, ts]`，**不是** `[ts, ts + duration_ms]` |
| 主状态派生 | `audit-classification.ts`、`audit-derivation.ts`（约 `189–236`）；`DERIVATION_VERSION="v2p5-1"`；无 `executionEvidence` → 规则 9 `unknown`；主状态只有八桶，`denied` 为其一，`policy_denied` 是 S07 `error_category` 取值 |
| 协议／wiki 审计证据（按分支，不作整体断言） | 已传 `executionEvidence`（**不改**）：上游 `initialize`（约 `6986–7005`）、本地协议如 `resources/list`（约 `6169–6181`）。**未传**（本条要补）：本地 `initialize` 降级（约 `6831–6854`）、wiki 本地分支（约 `4146–4162`）与上游分支（约 `7147–7164`）、通用协议 passthrough（约 `7361–7373`） |
| 来源 IP | `request-client-meta.ts`：默认 socket；`LUCY_TRUST_PROXY` 时取 XFF／`x-real-ip`（约 `38–49`）；`classifyTrustedSource()`（`trusted_proxy`／`untrusted_peer`／`customer`…，约 `241–275`）只产生**内存中的** `trustedSource`，`requestMeta` 组装未复制它，`AccessLogEntry` 与 `ACCESS_LOG_COLUMNS` 均**无** `trusted_source` 列，只有 `client_ip`／`client_forwarded_for`——即该可信度**现状未落账** |
| 导出 | `admin/audit.ts` v1 CSV／`export-pack`；`admin/audit-export-v2.ts`：每次导出生成新 `exportId`／`exportedAt`，截止序号取 canonical ledger `maxEventSeq()`；manifest v2 含 `derivationVersion`、`exportId`、`files[]`、`cutoffAt`；路由只接受筛选与版本链参数 |
| 脱敏 | `security/redaction.ts` 的 `redactAuditText` 只处理凭据／哈希，不处理内网地址、`hdfs://`、`sl_query` |
| 同进程既有看守 | 等价守卫 `webui/server/__tests__/equivalence/`；性能门禁 `sweep:event-loop:gate` |

## 4. 设计决策

| ID | 决策 | 理由 |
|---|---|---|
| D1 | **trace 粒度＝一次 HTTP 请求（一个 JSON-RPC 调用）**；`trace_id` 在**准入入口**生成，贯穿全部阶段；跨请求串联仍用既有 `lucy_session_id`／问询 ID | 协议请求也要有；`request_id` 是 RPC id 且会复用，不能当键 |
| D2 | `trace_id` 与既有 `operation_id`／`ingress_event_id` 的关系：**保持 `trace_<uuid>` 独立列，不改 operation_id**；二者经同一调用流水行互相可查 | 避免改动 S03 已收口标识；开放项 O4 评审可改为 1:1 同值派生 |
| D3 | 新表 `access_trace_span`（§5.1）。一次请求多行；`access_log` 仍**一行一调用** | 委托人选定方案 B |
| D4 | **原子性与失败语义分开定义。** ①原子性：`access_log` 行与其全部 span 在**同一 SQLite 事务**（`BEGIN IMMEDIATE`…`COMMIT`）提交，任一插入失败整笔回滚，不留孤儿行或孤儿 span。②失败语义：**不新增失败路径**——审计写入仍在响应发出后异步进行；span 写入失败等价于该行写入失败，沿用现状处理（`failAuditWrite()`＋运行日志，该请求的行与 span 一并缺失），并把 span 失败原因计入既有审计写入失败计数。**不引入 503、不阻塞响应、不改变响应内容**。「先持久后释放」（S02 §12.1 规范流程）不由本条承担，也不被本条削弱；若委托人要求本条升级为 fail-closed，须另行决策并重走主路径可用性评审（O2） | 存档要求行与 span 要么都在要么都不在；主路径优先——不因新增阶段记录而新增会让合法请求失败的路径。丢行属现状缺陷，由 S02 落地解决，不在此偷渡 |
| D5 | **不采样、不异步拆写**；每个 trace 最多写 **32 行** span：正常 span 最多 **31 条**，超出的合并为第 32 条 `status=truncated` 的汇总 span，`attrs.dropped = 总数 − 31`，**不得静默丢弃**。该分支用 vitest 契约覆盖（真实流量不会触顶，UAT 只断言真实流量 `dropped` 恒为 0） | 可对账；有界；诚实标明该分支无法由真实流量触发 |
| D6 | **阶段枚举固定**（§5.2），新增阶段须改本 Spec；`attrs_json` 只允许白名单键（§5.3），**禁止自由文本、SQL、凭据** | 可审、可导出、可脱敏 |
| D7 | `primary_status` 派生版本升至 `v2p5-2`：协议请求与 wiki 的 `executionEvidence` 由 span 结果合成（§6.2），**各请求类必有的 span 集合见 §6.2，缺失即完整性违规，不得落 `unknown` 当作「前置不满足」**；**旧行不回写**；导出带 `derivationVersion` | S01 规则 9 不动，补证据来源而非改规则 |
| D8 | **新增两列**：`ip_source`（`socket`／`xff`／`real_ip`＝实际写入 `client_ip` 的取值来源）与 `trusted_source`（取 `classifyTrustedSource()` 的结果，现状只在内存、未落账），二者**联合落账**，补齐 `AccessLogEntry`、迁移、写入与导出；未开 `LUCY_TRUST_PROXY` 时明示记录的是网关地址；头部值只有在 `trusted_source=trusted_proxy` 时才可被报表称为「客户端地址」，`untrusted_peer` 的头部值必须保留可见但不得被当作已验证来源。**证据分类修正**：`classifyTrustedSource()` 现状只对 XFF 判不可信，不可信对端仅发 `X-Real-IP` 时 `extractClientIp()` 会在 `LUCY_TRUST_PROXY` 下采用它并被标 `customer`（`request-client-meta.ts:38-49、249-275`）；本条要求分类同时检查 XFF 与 `X-Real-IP`，且 `trusted_proxy` 仅表示**实际采用了来自可信代理的头**。**不改 `client_ip` 取值本身**：伪造头在该配置下影响 ACL／限流地址属既有风险，本条只让证据如实自述并在 UAT 记录现状，另行登记不在此修 | E4：不改取值逻辑，只让证据自述来源与可信度 |
| D9 | 审计库存储侧脱敏：`error_detail` 写入前去除内网地址（IPv4／IPv6／带端口）、`hdfs://` 等存储路径、内部工具名 `sl_query`，**替换为带类别的占位（`[REDACTED_ADDR]`／`[REDACTED_PATH]`／`[REDACTED_TOOL]`），保留稳定原因码与非敏感上下文；禁止用空串／NULL 代替**。**脱敏范围**：内网＝RFC1918（`10/8`、`172.16/12`、`192.168/16`）、回环（`127/8`、`::1`）、链路本地（`169.254/16`、`fe80::/10`）、ULA（`fc00::/7`）；**公网 IP、版本号、时间戳、端口样式串保持原样**。规则集中在写入前的单一函数，复用既有 `redactAuditText` 链 | E5；不依赖客户端文案修复（后者属 P1-37）；防止「全删」作弊 |
| D10 | `digest_kind` 补全：`lucy_query` 的 SQL 摘要标 `sql`；`wiki_search` 的检索文本摘要标 `search_text` | E6 |
| D11 | **保留与清理**：现状 `access_log` 无清理任务；本条**不引入**清理。span 与行的一致性由 §5.1 的外键级联保证；`access_log` 另有多个无 CASCADE 的子表，若日后引入保留清理，必须在**单事务内先删全部子表（含 span）、后删父表**，或把相关外键统一改为级联，按同一截止集执行，不得留下孤儿。**O6 已冻结（定稿决策，见 §9）**：span 与父行同寿命、不设更短保留期；容量门槛为每 trace 体积与平均 span 数（SC-11） | 存档完整性；不把未经证明的容量写成事实 |
| D12 | 封存导出（v2）**新增** `spans.csv`，manifest 登记行数、sha256、`ledgerUpperSeq`；不替换既有文件；`calls-v2.csv` 追加列只在末尾（见 D8），既有列字节不变 | 向后兼容 |
| D13 | 理由码登记（§5.4，v1 已冻结 17 项）：`reason_code` 是粗粒度有限集合，原始 `decision_reason` 保留在旧列与 `reason_param`；**新增取值只能先改 §5.4 并升版本**，P1-37 的 `session_lost`／`session_shortcircuit` 已在册；登记不等于实现授权 | 两个 Spec 不各自解释同一个词表 |

## 5. 数据模型

### 5.1 `access_trace_span`（拟）

| 列 | 类型 | 说明 |
|---|---|---|
| `span_id` | TEXT PK | `span_<uuid>`；trace 内唯一 |
| `trace_id` | TEXT NOT NULL | 与所属 `access_log.trace_id` 一致 |
| `access_log_id` | INTEGER NOT NULL | 对应调用流水行；**外键 `REFERENCES access_log(id) ON DELETE CASCADE`** |
| `parent_span_id` | TEXT NULL | 根 span 为 NULL；其余必须存在于同 trace |
| `seq` | INTEGER NOT NULL | trace 内起始顺序，从 1 起；**`UNIQUE(trace_id, seq)`** |
| `stage` | TEXT NOT NULL | §5.2 枚举 |
| `started_at_ms` | INTEGER NOT NULL | UTC 毫秒（以请求起点为锚的墙钟换算，区间比较以此为准）。**根 span 的起点＝请求起点，终点＝响应已序列化并完成发送调用的时刻，且与行 `duration_ms` 取自同一次单调读数** |
| `duration_ms` | INTEGER NOT NULL | ≥ 0；来自单调时钟 |
| `status` | TEXT NOT NULL | `ok`／`denied`／`error`／`skipped`／`truncated` |
| `reason_code` | TEXT NULL | §5.4 注册表 v1 的 17 项之一（DB `CHECK` 约束） |
| `reason_param` | TEXT NULL | 原始 `decision_reason`（含动态后缀如表名）的脱敏拷贝；≤ 128 字节，导出前经脱敏 |
| `error_category` | TEXT NULL | 复用 S07 七分类 |
| `attrs_json` | TEXT NULL | 白名单键（§5.3），≤ 1 KB |
| `derivation_version` | TEXT NOT NULL | 写入时派生版本（`v2p5-2`） |

索引：`(trace_id, seq)`（即唯一键）、`(access_log_id)`、`(stage, started_at_ms)`。对 `access_log` 另加**部分唯一索引** `UNIQUE(trace_id) WHERE derivation_version='v2p5-2'`（旧行 `trace_id` 可为空或重复，不受约束）。

**完整性前提**：SQLite 需在该连接显式 `PRAGMA foreign_keys=ON`（现状未设置），并有 vitest 断言；否则级联删除不生效，须改为清理事务内显式 `DELETE`。该 PRAGMA 是**逐连接**的，另开连接读到的值不能代表服务连接，因此验收须靠服务自身的只读诊断：admin 审计状态接口新增 `sqlite.foreign_keys`（返回服务单例连接的实际 PRAGMA 值），UAT 读取该字段，而不是另开 `sqlite3` 自查。**开启后会让既有无 CASCADE 的外键真正生效**（如 `access_log_sources`），因此 Plan 步骤 1 须先盘点全部指向 `access_log` 的子表、做存量孤儿扫描，并以专项测试证明既有写路径（写 `access_log`、写 sources／attribution）不被拒；删除顺序按 D11。

**列约束（落 DB `CHECK`，不只靠事后对账）**：`status` 属值域集合；`duration_ms >= 0`；`seq >= 1`；`json_valid(attrs_json)`（非空时）；`length(CAST(attrs_json AS BLOB)) <= 1024`（**UTF-8 字节数**，不是字符数）；`reason_code IN (§5.4 的 17 项)`；`derivation_version = 'v2p5-2'`。

**容量（假设，非事实）**：按客户流量粗估约 2.4 万行／周、协议行约 5 个 span、业务行约 12 个，约 18–19 万 span 行／周、约 1000 万行／年；**能否承受由 SC-09／SC-11 实测与 O6 冻结的预算决定**，在此之前不得写「SQLite 可承受」。

### 5.2 阶段枚举（18 个，与 P1-37 共用）

| 类 | 阶段 |
|---|---|
| 准入 | `admission`（根）、`ledger_received`、`role_resolve`、`envelope` |
| 门控 | `session_guard`、`arg_validate`、`acl`、`caliber`、`source_gate`、`budget` |
| 构造 | `catalog_resolve`、`skills_load`、`instructions_build` |
| 上游 | `upstream_handshake`、`upstream_call`、`session_recover` |
| 本地与收尾 | `local_handler`、`response_serialize` |

**串行阶段集合**（同一父 span 下区间不得重叠，C9d 检查）：准入类、门控类、上游类与 `response_serialize`。**可并行**：`catalog_resolve`、`skills_load`（构造类内部）。

写库本身的耗时**不入 span**（它在同一事务内，不能自测）；由进程级指标观测（P1-37 M9）。

### 5.3 `attrs_json` 白名单

| 阶段 | 允许键 |
|---|---|
| `acl` | `decision`、`policy_version` |
| `source_gate` | `candidate_count`、`pinned`、`tier` |
| `upstream_call`／`upstream_handshake` | `upstream_status`、`retry_count` |
| `session_recover` | `recovered`、`reason` |
| `session_guard` | `failure_count`、`shortcircuit` |
| `skills_load` | `skill_count`、`cache_hit` |
| `instructions_build` | `cache_hit`、`role_count`、`bytes` |
| `local_handler` | `handler`（枚举：`wiki_search`／`wiki_read`／`catalog`／`initialize_fallback`／`wiki_fallback`／`notification_ack`／`ping`） |
| 全部 | `dropped`（truncated 合并时） |

不在表内的键写入即为缺陷（SC-02 校验）。

### 5.4 理由码登记表（v1，冻结于本节）

**设计**：`reason_code` 是本节下表的**粗粒度有限集合**（共 17 项，下表即全集）；原始 `decision_reason` 的完整取值**不入 `reason_code`**，保留在 `access_log.decision_reason`（旧列不变）并在 span 的 `reason_param` 中以脱敏、≤128 字节形式带出。映射函数是**全函数**：任何既有或未来的 `decision_reason` 都有确定落点，匹配不到的归 `unclassified`（本表登记项）。因此集合是有限、可在本 Spec 内冻结的，不依赖实现阶段再「生成存量表」。

**映射规则（按序，首个命中者生效；分类复用 `audit-classification.ts` 既有集合与前缀，不另造口径）**：

| 序 | 命中条件（`decision_reason` / 状态） | `reason_code` | `error_category` |
|---|---|---|---|
| 1 | 成功（`allowed` 或 `outcome=ok` 且无拒绝理由） | `allowed` | — |
| 2 | `question_budget_exhausted`、`question_budget_concurrency_exceeded`、`question_budget_unavailable`、`outcome=budget_stop` | `budget_stopped` | `budget_stopped`（并发超限沿用既有 `upstream_failed` 归类，不改） |
| 3 | 续查声明被拒：`pending_exists`／`no_credit`／`not_exhausted`／`mismatch`（既有 `CONTINUATION_DECLARATION_REJECTIONS`） | `continuation_rejected` | `validation_failed` |
| 4 | `cancelled`／`execution_cancelled` | `cancelled` | `cancelled` |
| 5 | `timeout`／`query_concurrency_exceeded` 或 `error_detail` 含 `Timeout` | `timeout` | `timeout` |
| 6 | `ACL_DENIAL_REASONS`、`sensitive_metadata_forbidden*`、`table_forbidden:*`、`unknown_or_forbidden_connection:*`、`tool_unclassified:*`、`wiki_forbidden*`、`explicit_table_required:<具名表>` | `acl_denied` | `policy_denied` |
| 7 | `source_ambiguity_gate`、`caliber_binding_unresolved`（含门闩类拒绝） | `gate_denied` | `validation_failed` |
| 8 | `VALIDATION_REASONS`（`count_without_source`／`ambiguous_field`／`aggregate_of_aggregate`／`wiki_not_found`／`completeness_denominator_required`）、`explicit_table_required:<empty>` | `validation_failed` | `validation_failed` |
| 9 | `SCHEMA_FAILURE_REASONS`（`invalid_arguments`／`schema_validation_failed`／`missing_required_argument`…） | `arg_invalid` | `client_schema_failure` |
| 10 | `audit_unavailable`、`security_store_unavailable` | `audit_unavailable` | `upstream_failed` |
| 11 | `execution_runtime_unavailable`、`execution_config_stale`、`execution_canary_blocked`、`config_missing`、`policy_missing_connection`、`execution_interrupted` | `execution_unavailable` | `upstream_failed` |
| 12 | `upstream_error`、`hive_query_failed` 及其他上游返回错误 | `upstream_error` | `upstream_failed` |
| 13 | `session_lost`（P1-37 登记） | `session_lost` | `upstream_failed` |
| 14 | `session_shortcircuit`（P1-37 U3b 预留；本条不写入，登记仅为词表稳定） | `session_shortcircuit` | `upstream_failed` |
| 15 | `upstream_session_recovered`（既有取值） | `upstream_session_recovered` | — |
| 16 | 代理内部错误（`answer_verifiability_assemble_failed`、`conversation_turn_write_failed` 等写路径内部失败） | `internal_error` | `upstream_failed` |
| 17 | 以上均未命中 | `unclassified` | 沿用 `classifyErrorCategory` 现值 |

`budget_continuation_declared` 是成功声明，归第 1 行。实现以 `classifyErrorCategory` 现有集合为准；本表与代码既有分类冲突时，以代码既有分类为准并回写本表、升注册表版本。

**约束**：①`reason_code` 落 DB `CHECK (reason_code IN (…17 项…))`，未知值写入即被拒；②新增 `reason_code` 须先改本节并升注册表版本（v1→v2），不得由实现自扩；③**`unclassified` 不是兜底豁免**：UAT 固定场景表（cases TRC-02）为每个拒绝／失败场景写死期望 `reason_code`，命中 `unclassified` 即 FAIL；发布后 `unclassified` 占比纳入观测；④精度（某 `decision_reason` 应归哪一码）由固定场景表与 vitest 逐项表覆盖，不靠自证。

## 核心流程（伪代码）

```text
# 1. 准入与 trace 建立（所有 JSON-RPC 方法，含 initialize／tools/list／notifications／ping／wiki）
on_request(R):
  t0 = monotonic_now(); wall0 = now_ms()            # 区间以 t0/wall0 为锚
  trace_id = "trace_" + uuid()
  buf = SpanBuffer(trace_id, cap = 32)              # 31 正常 + 1 truncated 汇总
  root = buf.open("admission", parent = NULL)
  for stage in [ledger_received, role_resolve, envelope]:
      s = buf.open(stage, parent = root)
      result = run(stage)
      s.close(status = map(result), reason_code = result.reason?)
      if result.denied: goto FINISH

# 2. 业务阶段（顺序由各功能 Spec 决定；本条只记录，不改顺序、不改裁决）
  for stage in dispatch_plan(R):          # session_guard → arg_validate → acl → caliber → source_gate → budget → ...
      s = buf.open(stage, parent = root)
      result = run(stage)
      s.close(status, reason_code, attrs = whitelist(stage, result))
      if result.denied or result.error: goto FINISH

FINISH:
  evidence = evidence_from_spans(buf, R)  # §6.2：缺必有 span 集合 → 记完整性违规，不得静默落 unknown
  s = buf.open("response_serialize", parent = root); send_response(R); s.close(...)   # 与现状一致：响应先发出
  t_end = monotonic_now()                  # 根 span 终点与行 duration_ms 取同一读数
  wall_end = wall0 + (t_end - t0)          # v2p5-2 行 ts ＝ wall_end（同一读数；旧行 ts 语义不变）
  root.close(end = t_end)
  row = build_access_log_row(R, outcome, evidence, trace_id,
                             duration_ms = t_end - t0,
                             ip_source = client_ip_source(R), trusted_source = classify_trusted_source(R),
                             error_detail = redact_audit_text(result.detail),
                             digest_kind = digest_kind_for(R.tool),
                             ts = iso(wall_end))   # 不再另取 new Date()
  async:
    BEGIN IMMEDIATE
        id = INSERT access_log(row)
        for sp in buf.finalize():          # 超过 31 条：合并为第 32 条 truncated，attrs.dropped = 总数 − 31
            INSERT access_trace_span(sp, access_log_id = id)
    COMMIT                                 # 任一失败 → 整笔回滚；沿用现状失败处理（D4），计入审计写入失败计数

# 3. 对账（导出时；S05 追加三检查，仅对 derivation_version = v2p5-2 的行）
reconcile(cutoff_seq):
  C7  每条纳入行有非空且唯一的 trace_id；legacyUnlinked 单独计数、不入分母
  C8  结构完整性：
        每个 trace 恰有 1 个根 span；parent_span_id 存在于同 trace；stage ∈ 枚举；attrs 键 ∈ 白名单；reason_code ∈ 注册表
        所有节点沿 parent 链可达根，且无环；parent.seq < child.seq；seq 在 trace 内从 1 连续无空洞
        status 值域、duration_ms ≥ 0、attrs_json（UTF-8 字节）≤ 1024 且 json_valid、derivation_version 合法（同时由 DB CHECK 保证）
        span.trace_id = 其 access_log_id 所指行的 trace_id；每个纳入行至少有 1 个 span；无孤儿 span
        各请求类的必有 span 集合齐全（§6.2）
  C9  时间一致性（根 span 区间为准；根终点与行 duration_ms 取自同一读数，因此只允许 1 ms 取整容差，写入跑次，不得放宽）：
        C9a 每个子 span 区间 ⊂ 根 span 区间（1 ms 取整容差）
        C9b |根 span.duration_ms − access_log.duration_ms| ≤ 1 ms
        C9c 墙钟锚定：v2p5-2 行的 `ts` 取自与根 span 终点同一次 response_sent 读数；断言 |(root.started_at_ms + root.duration_ms) − ts_ms| ≤ 1 ms 且 |root.started_at_ms − (ts_ms − access_log.duration_ms)| ≤ 1 ms（防止整体平移到任意时间仍全绿）；跑次内发生时钟跳变则该跑次作废重跑
        C9d 串行阶段集合（§5.2）在同一父 span 下区间不重叠（1 ms 容差）；并行阶段不检查
  任何一项失败 → 导出 manifest.auditCoverage 记 failed 并列出前 N 个反例；不得静默通过
```

## 6. 与既有合同的衔接

### 6.1 对账（S05 追加）

在 S05 既有六项 `auditCoverage` 之外追加：`traceLinked`（C7）、`spanIntegrity`（C8）、`spanTiming`（C9）。取值与失败呈现沿用既有格式。**分母＝截止序号以内、`derivation_version=v2p5-2` 的行**；旧行（`v2p5-1`）只出现在 `legacyUnlinked` 计数里，不算失败也不入分母。UAT 只靠已落库行无法发现漏记，**漏记检测由测试台用独立发送清单对账**（UAT-TRC-01，关联键见该用例），不得用同侧投影自证（沿用 S05 原则）。本条**检出**漏记，不承担修复（S02）。

### 6.2 `executionEvidence` 合成（D7）

主状态仍是 S01 八桶：被拒请求为 `primary_status=denied`，同时 `error_category=policy_denied`（若为策略拒绝）；两列分别断言，不混桶。

| 请求类 | 必有 span 集合 | 主状态 | 反例（须判违规） |
|---|---|---|---|
| `initialize` | `upstream_handshake`；上游不可达而本地降级时另有 `local_handler(initialize_fallback)` | 握手 `ok`→`succeeded`；握手 `error` 且降级 `ok`→`succeeded`（降级由 span 区分，不靠主状态）；握手 `error` 且无降级→`failed` | 无 `upstream_handshake` span 的 `initialize` 行 |
| `tools/list` | `upstream_call` | `ok`→`succeeded`；`error`→`failed` | 无 `upstream_call` |
| `notifications/*` | `local_handler(notification_ack)` 或 `upstream_call` | 确认→`succeeded` | 两者皆无 |
| `ping` | `upstream_call` 或 `local_handler(ping)` | `ok`→`succeeded` | 两者皆无 |
| `wiki_search`／`wiki_read` | `upstream_call` 或 `local_handler(wiki_*)`；上游失败后本地回退成功须同时有 `upstream_call(error)` 与 `local_handler(wiki_fallback)` | 按**最终返回给客户端的结果**：成功→`succeeded`，失败→`failed` | 只有回退没有上游失败记录；两者皆无 |
| 任一阶段被拒 | 被拒阶段 span `status=denied` 与对应 `reason_code` | `denied` | 被拒但无 `denied` span |
| 其他 `tools/call`（`lucy_query`、`lucy_read_source`、`lucy_catalog` 等） | 主状态证据路径保持 `v2p5-1` 不变；但 **span 最小集合无条件**：非拒绝请求＝`acl`（`ok`）＋执行方式（`upstream_call` 或 `local_handler`）＋`response_serialize`；拒绝请求＝被拒阶段 `denied` span | 不变 | 只有 `admission` 根 span 的业务调用；成功却无执行方式 span |
| 已传 `executionEvidence` 的既有分支（上游 `initialize`、本地 `resources/list` 等） | 不改证据路径；仍须满足上表对应类的 span 集合 | 不变 | — |

「必有 span 集合」是**无条件**的：新协议／wiki 行缺少它即 C8 违规，不得以「凭据不满足」为由落 `unknown`。

### 6.3 导出（D12）

`export-v2`／`export-pack-v2` 新增 `spans.csv`。拟定列：`trace_id,span_id,parent_span_id,access_log_id,seq,stage,started_at_utc,started_at_local,duration_ms,status,reason_code,reason_param,error_category,attrs_json,derivation_version,ledger_seq`。**`ledger_seq` 不是 span 表的列**，导出时 `JOIN access_log` 取所属行的 `ledger_seq`（UAT 的 SQL 同样走该 JOIN）；所属行 `ledger_seq` 为 NULL 的行单列计数 `unsequenced`，不进 `spans.csv` 也不静默忽略，须在 manifest 报出。manifest 追加 `files[]` 条目（`rowCount`、`sha256`）与 `spans` 截止序号（与 `ledgerUpperSeq` 同一值）。

**重导合同（按 S06 版本链，不升级为整包字节一致）**：每次导出生成新 `exportId`／`exportedAt`，整包与 manifest 允许不同。仅要求：同一截止序号、同筛选、同协议规则、同计量单位、同规则版本下，`spans.csv` 的**规范化内容**（排序固定、去掉 `exportId` 类易变字段后）逐行一致；跨时间重导时，较早截止序号以内的行在新包中是旧包的子集等价。分片并让出事件循环，沿用 P1-32 写法，等价守卫登记 `spans.csv`。

**测试入口**：不新增公开参数。UAT 在两次导出之间保持账本静止，且**先确认审计写入 pending＝0**（读既有 `beginAuditWrite`／`completeAuditWrite` 计数的只读出口）再取 S1；两份 manifest 的 `ledgerUpperSeq` 相等才比较，不等则作废重做；另做「新增流量并待 pending＝0 后重导，较早截止序号以内的 `spans.csv` 行与旧包一致」的前缀比较。**已知限制**：`access_log.ledger_seq` 取写入时的 MAX（非 ingress 因果序号），响应后异步写入的迟到行可落到较小序号，使同 S 内容在 pending>0 时漂移；是否改为绑定 ingress 事件的确定序号需改 S03／S06 约定，登记为 O7，本条默认不改。

## 7. 成功标准

| ID | 标准 | 验证 |
|---|---|---|
| SC-01 | 迁移提交后落库的所有 JSON-RPC 方法行（含协议、wiki、被拒调用）`trace_id` 非空且唯一；**审计写入健康时，测试台发送清单 ＝ 落库清单**（逐类期望数量固定，无 missing／extra，零行即 FAIL）。故障下丢行不在本条（S02），但必须被清单检出而非被掩盖 | `UAT-TRC-01` |
| SC-02 | 每个 trace 恰一个根 span；全部节点可达根且无环；`parent.seq<child.seq`、`seq` 连续；阶段在枚举内；`attrs` 键在白名单内；`reason_code` 在有限注册表内（未知值 FAIL）；列约束由 DB `CHECK` 保证；真实流量 `attrs.dropped` 恒为 0；32 上限与 `truncated` 汇总（31＋1、`dropped` 计算）由 vitest 契约覆盖；外键与唯一键生效（`foreign_keys=ON`），既有子表写路径不被拒 | `UAT-TRC-02`＋vitest |
| SC-03 | 原子性：对 span 插入注入失败，行与 span **都不落库**（无孤儿）；客户端响应与注入前一致、不新增失败形态；审计写入失败计数增加；清除注入后恢复 | `UAT-TRC-03` |
| SC-04 | 时间一致性（C9a–C9d，取整容差 1 ms 固定；根终点与行 `duration_ms` 同一读数） | `UAT-TRC-04` |
| SC-05 | 封存包含 `spans.csv`；行数、sha256、截止序号与库一致（`ledger_seq` 经 JOIN 所属行；`unsequenced` 单列上报）；审计写入 pending＝0 且 S 相等时两次导出规范化内容一致，前缀比较一致；既有文件的既有列不变（`calls-v2.csv` 仅末尾追加 D8／P1-37 列） | `UAT-TRC-05` |
| SC-06 | 新版本写入的协议、wiki 与其他 `tools/call` 行：必有 span 集合齐全（§6.2，含 `tools/call` 最小集合），`primary_status` 与最终结果一致且不为 `unknown`；被拒为 `denied`＋`error_category=policy_denied`；旧行不变且 `derivation_version` 仍为 `v2p5-1` | `UAT-TRC-06` |
| SC-07 | `error_detail` 对固定输入按预期输出表脱敏（占位保留、无空串／NULL、无误伤：公网 IPv4／IPv6、版本号、时间戳、端口样式串保持原样）；`digest_kind` 补全。**`hdfs://` 等存储路径的脱敏由 vitest 契约表覆盖（纯字符串函数），不入必做 UAT**（需 hive／hdfs 环境，见 O8）；UAT 用真实内网 IP 连接错误验证脱敏函数确实接在写入路径上；`[REDACTED_TOOL]`（`sl_query`）仅当基线跑次能用**合法入参**触发含 `sl_query` 的真实上游错误时才入 UAT，否则降为 vitest（缺 `measures` 的入参会被 `validateLucyToolArgs()` 本地拦截，错误不含 `sl_query`，不得用作夹具） | `UAT-TRC-07`＋vitest |
| SC-08 | **两列均存在且落账**；`ip_source` 与 `trusted_source` 在五种场景（默认、可信代理 XFF、`X-Real-IP`、不可信对端伪造 XFF、不可信对端伪造 `X-Real-IP`）下联合取值正确；默认配置下明示为 `socket`；不可信对端分别伪造 `X-Forwarded-For` 与 `X-Real-IP` 都不得被标为 `customer`／`trusted_proxy`；UAT 记录伪造头对 ACL／限流地址的现状（既有风险，不在本条修） | `UAT-TRC-08` |
| SC-09 | 热路径开销：`lucy_query` P95 相对写入前基线增量 ≤ 5 ms；`initialize` P95 增量 ≤ 3 ms（建议值，见 O1）；合法请求成功率不降 | `UAT-TRC-09` |
| SC-10 | 给定 `trace_id` 可还原请求→阶段→结果→导出行（至少抽：合法查询、协议、本地处理、拒绝、上游失败各一条）；给定会话可列出全部 trace | `UAT-TRC-10` |
| SC-11 | 容量：沙箱审计库扩到 10 万 trace，导出与对账不撞 SQLite 变量上限，`/api/livez` p99 ≤ 400 ms、max ≤ 1000 ms；索引与库体积不超过 O6 冻结的预算（每 trace 的 span 表＋索引平均 ≤ 8 KB；平均 span 数：协议类 ≤ 6、业务类 ≤ 14）（每 trace 的 span 表＋索引平均 ≤ 8 KB；平均 span 数：协议类 ≤ 6、业务类 ≤ 14） | `UAT-TRC-11`（**必做**）＋`UAT-SUITE-PAGE-SWEEP` |
| SC-12 | 等价守卫：既有导出文件的既有列逐字等价（`calls-v2.csv` 去掉末尾追加列后与 P1-36 之前一致，golden F-8）；`spans.csv` 登记入册（golden F-9） | `UAT-SUITE-EQUIV-GUARD`（UAT-EQ-01／02） |

## 8. 主路径可用性自检（DEVELOPMENT 四问）

| # | 问 | 答 |
|---|---|---|
| 1 | 本条生效后，最终用户（含纯 MCP）原先能完成的主任务是否仍能完成？ | 是。本条不改任何裁决、响应内容与响应时序，不引入 503／阻塞分支（D4）。**新增风险（如实登记）**：①请求路径多了内存中的 span 缓冲（SC-09 量化）；②同事务多写 5–12 行，延长 SQLite 写锁持有，锁争用或写失败时该请求的**行与 span 一并缺失**（与现状行写失败语义一致，不影响客户端结果）。 |
| 2 | 若增加拒绝／门禁，逃生是否纳入必做 UAT？ | 本条不增加拒绝／门禁。 |
| 3 | 验收是否同时覆盖「约束触发」与「合法路径成交」？ | 是：`UAT-TRC-09` 在合法 `lucy_query`／`initialize` 路径上测开销与成功率；`UAT-TRC-03` 注入写失败后**同时断言合法请求的客户端结果不变**；`UAT-TRC-01` 的混合流量含合法查询与协议请求。 |
| 4 | 是否避免把宿主／凭据缺席记成 BLOCKED 掩盖不可用？ | 是：必做用例只用 demo 内置账号与 Bearer 文件路径，不依赖宿主 person。 |

## 9. 风险、代价与开放问题

### 选方案 B 带来的代价（已知，不是遗漏）

| 项 | 代价 |
|---|---|
| 写放大 | 每请求多写 5–12 行；同事务；需 SC-09 实测 |
| 导出体积 | 新增 `spans.csv`，约为调用流水的 6–10 倍行数 |
| 迁移 | 新表、外键、部分唯一索引；回滚＝停写新表、保留旧列，旧导出不受影响；`PRAGMA foreign_keys` 开启是新增的连接级行为，须专项测试 |
| 同进程风险 | 与 P1-21／P1-32 同样的事件循环风险：导出必须分片让出；等价守卫登记 |
| 丢行仍可能发生 | 审计异步写入的现状缺陷不被本条消除（D4、闭口层级）；漏记由测试台独立清单**检出**，修复属 S02 落地；本条不得被解读为入口完整性已保证 |

### 开放问题（已于 2026-11-17 定稿时闭合；委托人授权代理定稿，可撤销）

| ID | 问题 | 建议 |
|---|---|---|
| O1 | SC-09 开销阈值（5 ms／3 ms）是否采纳（C9 容差已冻结为 1 ms，不再作为开放项） | **已闭合（定稿决策）**：采纳；以 P1-13 性能取证与 Plan 步骤 0 demo 基线为准，实测超限回到委托人 |
| O2 | 本条是否接受「span 失败＝行失败，沿用现状异步语义」，并接受「入口完整性不由本条承担」 | **已闭合**：接受（D4、闭口层级）；fail-closed 由 S02 实现，需要时另立决策 |
| O3 | 客户 xlsx（16,384 列、19 行损坏）由哪条导出路径产出 | **已闭合（不属本条）**：仓内无 xlsx 生成器，不假定原因；归客户沟通／发布取证，不阻塞定稿 |
| O4 | `trace_id` 与 `operation_id` 是否改为 1:1 同值派生 | **已闭合**：保持独立列（D2） |
| O5 | 客户运行版本与镜像 | **已闭合（不阻塞定稿与开发）**：按 AGENTS「Docker 对齐」，功能以 demo／仓库代码为准；客户侧版本核对归发布取证 |
| O6 | 保留期与容量预算 | **已冻结（定稿决策，建议值，由 SC-11／Plan 步骤 0 实测校准）**：①保留＝span 与父 `access_log` 行**同寿命**，本条不新增清理、不设更短保留期；②容量门槛＝10 万 trace 沙箱下，每 trace 的 span 表＋索引**平均 ≤ 8 KB**，平均 span 数协议类 ≤ 6、业务类 ≤ 14（单 trace 硬上限仍为 32）；③年规模仅作估算（约 1000 万 span 行／年，不当作事实）；实测超过任一门槛＝SC-11 FAIL，**回到委托人另行决策**（归档／清理另立行，不在本条擅自加清理） |
| O7 | `access_log.ledger_seq` 是否改为绑定 ingress 事件的确定序号 | **已闭合**：不改；以导出前审计 pending＝0 为前置条件规避（§6.3）；要求同 S 绝对一致另立行 |
| O8 | `hdfs://` 等存储路径（及基线无法真实触发的 `sl_query`）脱敏不进必做 UAT | **已闭合**：接受；该函数是纯字符串规则，UAT 以真实内网 IP 错误证明写入路径已接线；要求全真需先提供 hive／hdfs 实验环境 |
