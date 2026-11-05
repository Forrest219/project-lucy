---
name: ops-questioning
title: 运维问数
version: 1.2.0
domain: lucy-ops
status: published
roles_allowed: [lucy_ops_reader]
prerequisites:
  sources:
    - "lucy-ops.ops_calls"
    - "lucy-ops.ops_call_tables"
    - "lucy-ops.ops_agents"
    - "lucy-ops.ops_tokens"
    - "lucy-ops.ops_agent_activity"
    - "lucy-ops.ops_question_kpi_agents"
    - "lucy-ops.ops_grant_paths"
    - "lucy-ops.ops_access_paths"
    - "lucy-ops.ops_edge_signals"
    - "lucy-ops.ops_map_nodes"
    - "lucy-ops.ops_map_meta"
    - "lucy-ops.ops_table_adoption"
  wiki_docs:
    - "lucy-ops/ops-questioning.md"
triggers:
  - "谁被拒绝"
  - "生成 SQL"
  - "哪张表被问得最多"
  - "活跃 Agent"
  - "调用流水"
  - "裁决原因"
  - "有效 Agent"
  - "配置 Agent"
  - "可用 Token"
  - "沉默"
  - "连续 N 天未访问"
  - "窗口无记录"
  - "窗口仅连接"
  - "窗口轻量业务未问"
  - "窗口查数未问"
  - "窗口问询活跃"
  - "正式问询"
  - "真实问询"
  - "闲置授权"
  - "需复核"
  - "确凿越权"
  - "授权路径"
  - "访问路径"
  - "原始调用"
  - "近窗未访问"
  - "表活跃率"
  - "访问关系图"
  - "治理投影快照"
description: 运维问数 SOP：调用流水 + 可问治理面（人口、MECE、图结构、近窗未访问、表活跃率）。图≠论述；D23≠图凭证清单。
---

# 运维问数

本连接只读当前实例审计热库。源分三类：

| 类 | 源 | 说明 |
|---|---|---|
| 旧源 W0 | `ops_calls`、`ops_call_tables` | 调用流水；**不**接受 `gov.*`；无 snapshot |
| 治理源 W1 | `ops_agents`、`ops_tokens`、`ops_agent_activity`、`ops_question_kpi_agents` | 人口／活跃／MECE；经 `gov.*` |
| 治理源 W2 | `ops_grant_paths`、`ops_access_paths`、`ops_edge_signals`、`ops_map_nodes`、`ops_map_meta`、`ops_table_adoption` | 图结构／表采用；同源 access-map **builder** |

**图是静态的，论述是动态的，两者不必对等。** Token 用量以问数 `(agent_id, token_label)` 为准（D23＝E），**不对账** access-map 图凭证清单。路径／边对账 builder／投影，不对页面折叠数字。

## 路由（Q1–Q6）

先澄清歧义（D4／D5），再选源：

1. **Q1 有效 Agent／Token 数量**  
   - 「有效 Agent」默认＝**配置 Agent 人口** → `ops_agents.agent_count`  
   - 问句含「活跃」→ **窗口活跃 Agent** → `ops_agent_activity`  
   - 「Token 数量」默认＝**可用 Token 人口** → `ops_agents.available_token_count`  
   - **禁止** `count(distinct token_label)` 当任何 Token 人口  
   - 业务活跃 Token → 指向**使用概况**，本连接不答

2. **Q2 过去 7 天哪些 Agent 访问了** → `ops_agent_activity`；显式传 `gov.window_hours=168` 或按 UTC `call_day` 过滤近 7 日；回答写明 UTC。

3. **Q3 连续 30 天没有访问** → **沉默 Agent**＝配置人口 − 窗口活跃；窗用 `gov.calendar_days=30`（缺省上海日历日，含今日）。不是「从未连接」。

4. **Q4 访问如何区分** → `ops_question_kpi_agents`；MECE 五档（最深水位只归一档）：  
   - ① 窗口无记录  
   - ② 窗口仅连接  
   - ③ 窗口轻量业务未问（含失败的 `lucy_begin_question`、浏览／准备／运维／未分级）  
   - ④ 窗口查数未问  
   - ⑤ 窗口问询活跃  
   禁止输出「从未连接」。别名「窗口浏览未问」→ ③。

5. **Q5 近 30 天哪些表没有被访问** → **近窗未访问表** → `ops_table_adoption` 且 `window_unvisited=1`。  
   - 人口＝当前授权面／可启用表（grant 可解析），不是「流水里出现过的表」。  
   - 若用户说「从未访问」「上线 30 天从未访问」：**必须先改述**为近窗未访问，再答 C；禁止答成上线以来从未。  
   - deny／评测探针不计为访问。

6. **Q6 哪些表活跃率高** → `ops_table_adoption.activity_rate`＝`active_days/denom_days`（Asia/Shanghai；denom&lt;1 不可用）。披露 `days_online_in_window`。

图结构／边／确凿越权／原始调用／拒绝 → `ops_map_meta`／`ops_edge_signals`／paths／nodes（§5.4）。`gov.focus_token_label` **不**改变授权路径物化。

窗参数一律走 `lucy_query.filters` 的 `gov.*`（`gov.window_hours`∈{24,168}；`gov.calendar_days`∈{7,30}+可选 `gov.calendar_tz`；或成对 `gov.start_iso`/`gov.end_iso`）。多种窗互斥。旧源带任何 `gov.*` 会 `invalid_arguments`。

## 旧 Role 扩权（D22／SC-17c）

参考模板 `lucy_ops_reader` 已列全部 sourceName。已落盘正式 Role（含 Docker demo）可能仍只有 W0 两表——ensure **永不**改 `access.yaml`。新源 deny 时说明须管理员显式扩表选择器，不要报成「无能数据」。

## 调用流水口径（W0，保留）

两张旧视图＝默认用量 ∧ 自追问整事件排除。对**调用流水人口**仍只回答活跃 Agent（窗内 `ops_calls.agent_id` 去重）；配置人口走 W1 `ops_agents`。

- **不把 `token_label` 去重称为业务活跃 Token**（也禁止称为活跃用户或任何 Token 人口）。
- **业务活跃 Token** 以使用概况为准；本连接不答。
- **访问账户不在本连接**；不查 `ui_page_views`。
- **`call_day` 是 UTC 日历日**（`ts` 的 UTC 日历日）。问「过去 7 天」时过滤这 7 个 UTC 日，并在回答里写明窗口是 UTC。
- **生成 SQL 不作为默认分组**：只在已按表、Agent、结果或 `request_id` 过滤之后取出。
