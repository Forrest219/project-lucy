---
summary: 运维问数连接（lucy-ops）：调用流水、可问治理面、MECE 五档、近窗未访问、表活跃率、日历窗、图≠论述、旧 Role 须显式扩权。
allowed_roles: [lucy_ops_reader]
---

# 运维问数连接（lucy-ops）

只读连接，指向当前实例的审计热库。

## 源一览

| 源 | 交付 | 用途 |
|---|---|---|
| `ops_calls` | W0 | 调用流水；活跃 Agent（窗内去重） |
| `ops_call_tables` | W0 | 调用 × 来源表；拒绝与生成 SQL |
| `ops_agents` | W1 | 配置 Agent 人口；可用 Token 合计 |
| `ops_tokens` | W1 | `(agent_id, token_label)` 调用量（D23＝E） |
| `ops_agent_activity` | W1 | UTC `call_day` 窗口活跃 |
| `ops_question_kpi_agents` | W1 | Q4 MECE ①–⑤ |
| `ops_grant_paths` | W2 | 授权路径（builder） |
| `ops_access_paths` | W2 | 访问路径（builder） |
| `ops_edge_signals` | W2 | 边状态／`confirmedUnauthorized` |
| `ops_map_nodes` | W2 | 图节点 |
| `ops_map_meta` | W2 | counts／raw／denied／coverage／orphan |
| `ops_table_adoption` | W2 | 近窗未访问／表活跃率（Q5／Q6） |

W0 与治理源 **查询分支分离**：旧源不走治理快照、拒绝任何 `gov.*`；治理源缺省窗＝`gov.calendar_days=30`（Asia/Shanghai，含今日半开公式）。

## 图 ≠ 论述

访问关系图是静态呈现；问数论述按查询窗动态物化。**不要求**与 `/admin/access-map` 页展示数字逐格一致。路径／边／覆盖率对账 **builder／投影**（`ops_map_meta`），不对页面折叠与凭证清单 UI。`ops_tokens` 按 Agent×label 归因，**故意不对齐**图凭证清单聚合（D23＝E）。

## 三套人口（勿混）

| 问法 | 口径 | 源 |
|---|---|---|
| 有效／配置 Agent | 配置 Agent 人口（access.yaml 全集，含未启用） | `ops_agents` |
| 活跃 Agent | 窗口活跃 Agent（§4.2＝默认用量∧自追问排除） | `ops_agent_activity` |
| 近 N 活跃 Agent | Spec 189 名册卡片 | **不是**本连接默认 |
| 可用 Token | 名册 availableTokenCount | `ops_agents.available_token_count` |
| 业务活跃 Token | 使用概况 | 本连接不答 |
| `token_label` 去重 | **禁止**称为任何 Token 人口 | — |

§4.2 事件集 ≠ Spec 189 近 N 活跃分子。

## Q4 MECE 五档

配置 Agent × 窗口；最深水位只归一档（⑤→④→③→②→①）：

1. 窗口无记录 — 协议=0 ∧ 默认用量=0  
2. 窗口仅连接 — 协议>0 ∧ 默认用量=0  
3. 窗口轻量业务未问 — 有默认用量；查数=0；真实问询=0（含失败 begin）  
4. 窗口查数未问 — 查数>0；真实问询=0  
5. 窗口问询活跃 — 真实问询>0  

禁止「从未连接」。工具／问询分界＝Spec 194。

## Q5 近窗未访问／Q6 表活跃率

- **近窗未访问表**：授权面表集合中，查询窗口内无 allow 且非评测探针的访问（D17＝C）。**不是**「上线以来从未访问」，也**不是**「上线 30 天从未访问」。旧问法须改述后再答。  
- **表活跃率**＝`active_days/denom_days`（D19）：`active_days`＝窗内 Asia/Shanghai 日中至少 1 次访问的日数；`denom_days`＝`[start,end)` 相交上海日历日数（&lt;1 则不可用）；deny／评测探针不计；新表仍用全窗分母并披露 `days_online_in_window`。

## 日历窗（SC-24）

`calendar_days=N`、时区缺省 Asia/Shanghai、`asOf` 时刻：

- `endExclusive = startOfCalendarDay(asOf) + 1 day`  
- `startInclusive = endExclusive - N days`  

例：`asOf=2026-11-01T12:00:00+08:00`、N=30 → `[2026-10-03T00:00:00+08:00, 2026-11-02T00:00:00+08:00)`（含今日，不是「此前 N 个完整日」）。

## 旧 Role 扩权（D22）

ensure／升级只扩展 `lucy-ops.enabled_tables` 与标准语义／Skill／Wiki；**永不写 access.yaml**。参考模板已列全部 sourceName；已落盘正式 Role（含 demo 故意只留 W0 两表作 SC-17c）须管理员显式扩表或从模板新建。未扩权时新源应 **deny**，不得静默空结果冒充无能。

## W0 流水口径

两视图同一事件集：默认用量再排除本连接自身追问（整事件）。对调用流水人口仍**只回答活跃 Agent**。

- **不把 `token_label` 去重称为业务活跃 Token**（也禁止称为活跃用户或任何 Token 人口）。
- **业务活跃 Token** 以使用概况为准；本连接不答。
- **访问账户不在本连接**。
- **`call_day` 是 UTC 日历日**。问「过去 7 天」时过滤这 7 个 UTC 日，并写明窗口是 UTC。
- **生成 SQL 不作为默认分组**；高基数，过滤后取明细。
