# Opus Thinker 复核：CIO 视角 WebUI Token 与访问日志能力

日期：2026-06-21  
执行方式：`claude -p ... --model opus --permission-mode dontAsk --allowedTools "Read,Grep,Glob"`  
输入材料：`inbox/cio-log-audit-gap-brief-2026-06-21.md` 及其列出的 WebUI / server 相关文件。  
说明：Claude Code 仅做只读审阅，未修改文件。

---

我已独立核对 brief 与源码。以下是审阅意见（仅意见，未改任何文件）。

---

# Thinker / 反方审阅：CIO 视角 WebUI Token 与访问日志能力

## 一、对 brief 结论的支持点（代码已证实）

逐条核对，brief 的事实陈述基本属实，不是空谈：

- **G1 token 不可归因** — 属实。`audit.ts` 的 `access_log` 建表（L52-68）确无 `token_hash`/`token_label` 列，`writeLog` 也不写；`agents.ts:142 getLastUsedMap()` 直接返回空 Map 并注释承认做不到 per-token。`last_used` 无法填充成立。
- **G3 UI 未展示后端字段** — 属实。`audit.ts` 的 API（L175-191）确实返回了 `decisionReason / roleIds / permissionSnapshotHash / effectiveTablesCount`，但 `Audit.tsx` 表格只渲染 时间/用户/工具/表/状态/耗时，展开区只有 args/error/requestId/client。**后端白做了，前端没接** —— 这是最廉价、最该先补的。
- **G4 CSV 字段不足** — 属实。`audit.ts:233` headers 硬编码 10 列，确实漏掉 `args_summary / decision_reason / role_ids / permission_snapshot_hash / effective_tables_count`。
- **G5 配置变更无页面** — 属实。`config_change_log` 表（`audit.ts:60-72`）与 `recordConfigChange()` 存在，`agents.ts` 的 create/patch/delete 都写了它，但无任何前端路由消费。
- **G6 协议噪音** — 属实。`mcp-proxy.ts` 对 `tools/list`（L320）、`initialize`/`notifications`（L390-403）一律 `recordAudit`，与业务调用混在同一张表、同一个列表。
- **G7/G8** — 属实。`tables` 以 JSON 字符串落库（`audit.ts:137`）；无 `row_count/bytes` 等返回规模字段。

结论：brief 的**现状描述可信**，没有夸大缺口的存在性。

---

## 二、反对意见与理由（brief 的偏差 / 遗漏）

### R1. G1 被严重高估了实现成本，反而应上调优先级

brief 把 token 归因写成"可权衡是否完整存储 hash"的设计取舍，暗示是个需要斟酌的中等工作量。**实际不是。** `identity.ts:61-65` 的 `Identity` 已经带 `tokenLabel`，且在 `mcp-proxy.ts` 每一处 `recordAudit` 调用点 `identity.tokenLabel` 都在作用域内。补齐只需：加一列 + `AccessLogEntry` 加字段 + 传 `identity.tokenLabel`。成本近乎零。

更关键的反驳：**历史行永远无法回填 token 归因**。今天每多记一条不带 token 的日志，就是一条永久不可追责的审计记录。brief 的 Q3"单 token 时可暂缓"是**错误的经济账**——暂缓省不下多少工作，却在持续制造不可逆的审计盲区。这条应是 P0，理由不是"功能缺失"，而是"数据损失不可逆"。

### R2. G5 的可信度被代码本身否定 —— actor 是假的

brief 建议配置变更页展示 "actor / 谁给了权限"。但 `audit.ts:100` 里 `actor` **硬编码为 `"local-admin"`**，且 `recordConfigChange` 的 `session_id` 在 `agents.ts` 各调用点根本没传。也就是说：即使现在就做出 `/admin/config-audit` 页面，"谁授权/谁撤权"这一列对所有记录都是同一个常量。

对 CIO 而言这比"没有页面"更危险——**做一个看起来有问责、实则无问责的页面**。反方立场：要么先让 actor 真实化（接入真实操作者身份），要么页面明确标注"单管理员模式，actor 不具备多人问责语义"。否则这是合规上的"纸面控制"。

### R3. brief 漏掉一个真实审计盲区：raw SQL 查询正文根本没记

`mcp-proxy.ts:99-105 summarizeArgs` + L10 的 `SENSITIVE_ARG_KEY_RE` 会把含 `sql`/`query`/`token` 等 key 的参数**整个过滤掉**。这意味着 agent 跑的实际 SQL 文本不进审计，只靠 `extractTables` best-effort 抽表名（且抽不到时 `tables` 为空）。

CIO 视角的核心问题恰恰是"它到底查了什么"。当前对最敏感的 raw SQL 路径，审计只剩"调了某工具、可能涉及某表"。这是隐私与审计的真实张力，brief 的 G7/G8 完全没触及。**反方判断**：这比 G8 的"返回行数"更该优先，因为没有查询意图，行数也解释不清。

### R4. G2（会话端到端）方向认同，但 brief 给的两个选项里要明确否决"接入 Hermes DB"

brief Q6 把"WebUI 直接接 Hermes session DB"列为候选。反对：那是把两个信任域、两个生命周期的库耦进治理面，POC 阶段纯属负债。正确做法只有一个——MCP header 透传 correlation id + proxy 记录，问答正文留在 Hermes。brief 自己也倾向这个，但既然让我反驳，我把"接 Hermes DB"明确标为**不要做**。

### R5. brief 的"已具备基础治理能力"结论，对 demo 风险估计不足

brief 第 1 节定调偏正面（"已具备基础治理查看能力"）。但 G6 + G3 叠加会在**现场 demo 直接反噬**：CIO 打开页面看到"workhorse 今天 382 次访问"，其中绝大多数是 `tools/list`/`initialize`，且页面无法一眼区分、也看不到任何 allow/deny 理由。结果要么显得"访问量惊人"引发误判，要么显得"日志很浅"。所以这不是 P2 优化，而是**影响 POC 第一印象的硬伤**。

---

## 三、当前能力是否足以给 CIO 做 POC 汇报？

**分两种汇报形态，结论不同：**

- **作为"有人讲解、控场的 POC 演示"** —— 勉强够，但有现场翻车风险（见 R5）。必须先做下面"最小闭环"的前两项，否则演示者要花一半时间口头解释"这些 382 条大多是握手协议""为什么这条被拒要去查数据库"。
- **作为"可交付、可自助、能拿去做审计/合规论证的产品能力"** —— **不够**。三个硬缺口：(a) 日志不可按 token 追责且历史不可回填（R1）；(b) 配置变更问责是纸面的（R2）；(c) raw SQL 意图不入审计（R3）。这三点决定它现在是"查看器"，不是"审计闭环"。

一句话给 CIO：**能演,不能审**。

---

## 四、必须补齐的最小闭环（POC 前的硬门槛）

按"数据已存在→成本"排序，四项，前三项几乎纯前端/小改：

1. **Audit UI 暴露 decision reason + 独立的 denied 视图**（G3）——数据后端已返回，纯前端。让"为什么允许/为什么拒绝"上屏，是治理叙事的命脉。
2. **协议调用与业务调用分流**（G6）——默认隐藏 `tools/list`/`initialize`/`notifications`，提供 toggle + 顶部分类计数（protocol / business / denied / data-bearing）。消除 382 的误导。
3. **token 归因写入**（G1，含 `token_label` + `token_hash_prefix`）——`tokenLabel` 已在作用域内，成本极低，且**越早越好因历史不可回填**。
4. **CSV 补齐已落库字段**（G4：`decision_reason / role_ids / permission_snapshot_hash / args_summary`）——给合规一份自洽、无需回查 DB 的导出。

补充建议（强烈）：对 R2 至少在任何配置变更展示处**加一句口径说明**"当前为单管理员模式"，避免把 `local-admin` 当成真问责。

> 说明：会话端到端（G2）、返回规模（G8）、数据源聚合（G7）**不进最小闭环**——它们是"产品化"需求，不是"POC 可信度"门槛。

---

## 五、优先级建议（对 brief 的修订）

brief 的 P0/P1/P2/P3 大方向合理，但我做三处调整：

| 项 | brief 定级 | 我的定级 | 理由 |
|---|---|---|---|
| G3 decision reason 上屏 | P0/P1 | **P0（最先做）** | 零数据成本、纯前端、demo 影响最大 |
| G6 协议/业务分流 | P0/P1 | **P0** | 同上，直接决定第一印象 |
| G1 token 归因 | P0/P1（但暗示可暂缓） | **P0，不可暂缓** | 成本近零 + 历史不可回填，每天延迟=永久盲区 |
| G4 CSV 补字段 | P0/P1 | P1 | 重要但非现场 demo 命脉 |
| **R2 actor 真实化 / 标注** | 未列出 | **P1（新增）** | 否则 G5 页面是误导性合规 |
| **R3 raw SQL 意图入审计** | 未列出 | **P1（新增）** | 真实审计盲区，重于 G8 |
| G5 配置变更页面 | P2 | P2（须在 R2 之后） | 没有真 actor 之前别急着做页面 |
| G2 会话关联（仅 header 透传方案） | P2 | P2 | 认同；**禁止接 Hermes DB** |
| G7 数据源聚合 | P2 | P2/P3 | 产品化，非门槛 |
| G8 返回规模 | P2 | P3 | 需 proxy 解析每个响应，成本/耦合最高，收益靠后 |
| CIO dashboard / 风险评分 / 审批流 | P3 | P3 | 同意，POC 不碰 |

**一句话排序**：先把"已经存在但没显示出来的信息"全部上屏（G3/G6/G4，~纯前端），同步补不可回填的 token 归因（G1）；再处理两个被 brief 低估的诚信问题（R2 假 actor、R3 SQL 盲区）；产品化（G2/G5/G7/G8/dashboard）一律靠后。

