# Fixtures — UAT-SUITE-BUDGET-ANALYST-UX

| 元数据 | 内容 |
|---|---|
| Fixtures 版本 | **v1.1** |
| 适用 | [suite](suite.md) · [cases](cases.md) |

## 身份与作用域

| 身份 | 用途 | 要点 |
|---|---|---|
| `ba-zero-*`（≥5 组 Token／Agent） | BA-01–BA-09／02b／07b 计数／忙时／跨窗边界 | 全新作用域，预算零态；每组用后即弃，不跨用例复用 |
| `ba-active-*` | BA-10／BA-12A | 启用口径绑定（`lucy_begin_question` 可见）的 active 实况身份 |
| `ba-inactive-*` | BA-12B | begin 隐藏／零绑定；验证 `mode=new_question` |
| `ba-cc-main` | BA-12A／12B | 真实 Claude Code 宿主会话 |
| `ba-rollback-*` | BA-11 | 独立容器跑次专用，验证后恢复默认档 |
| integration 双 Agent | 勾连 IMC-03 | **不得**用本套件 interactive Token 冒充；见 integration-mcp-capacity fixtures |

## PRE-01 证据（只引用）

- 路径：[`inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md`](../../../../../inbox/pre01-2026-11-27/PRE-01-EVIDENCE.md)
- R0 登记结论即可；禁止本套件跑次内重做三模式抓包。

## 慢源夹具（等价模拟慢引擎）

- demo MySQL 新建库 `slow_gauge`：视图 `v_sleep(sec INT)` 执行 `SELECT SLEEP(sec)` 后返回单行标量；配小事实表 `gauge_fact`（≥3 行）作 oracle 锚。
- 经 ktx SL 注册为语义源 `slow_gauge`（只读连接）。
- 档位标定（R0 实测并记录）：45s（BA-05）、60s（BA-06）、90s（BA-07／07b 超时臂——如 `SLEEP(200)` 被空闲超时掐断）。
- `hive-jd` 实况（BA-13，可选）：客户环境真实外部 Hive Catalog。

## 并发与信封夹具

- BA-03／09：脚本化 MCP 客户端（真实 HTTP＋Bearer）同时发起 N 路；记录每路时刻与**完整**拒绝载荷（含 `retryable`／`retryAfterMs`／`next_step`）。
- BA-09 另需：槽释放后缩并发重试＋独立 SQL oracle。
- BA-08：响应返回前主动断开 socket；计时起点＝断开时刻。
- BA-07／07b 审计：`budgetSettlement` 须含 `failedKind`、`rawDeltaMs`、`billedBusyMs`；07 对照臂准备合法空结果夹具。

## 跨窗／续查夹具

- BA-02b：可重复换窗的续查档（inactive 默认 5 或 active 3，按用例身份）；敌对臂跑满总档；正臂保留≥1 档。
- BA-07b：与 02b 共用总档语义，但工具为超时失败重查询。
- BA-12A／12B：真实 Claude Code；12B 须能读到同一 `continueToken`。

## Oracle

- 事实行以独立数据库只读 SQL 为准。
- 预算／容量以服务端审计与结构化响应为准。

## 环境变量矩阵（BA-11 回退集）

`QUESTION_BUDGET_MAX_INFLIGHT=4`、`QUESTION_BUDGET_MAX_BUSY_MS=300000`、`QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_ACTIVE=1`、`LUCY_QUERY_MAX_INFLIGHT=4`、`LUCY_MCP_AGENT_MAX_INFLIGHT=8`、`LUCY_MCP_CONNECTION_MAX_INFLIGHT=16`、`LUCY_MCP_GLOBAL_MAX_INFLIGHT=24`、`LUCY_MCP_CANCEL_HOLD_MS=30000`、`LUCY_PROXY_UPSTREAM_TIMEOUT_MS=30000`、`LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS=90000`（以 Spec SC-11 为准）。

## 禁止

- 禁止 mock 时钟、桩上游、客户端截断冒充服务端行为。
- 禁止跑次写入 Bearer／密码明文。
- 禁止用 v1.0 旧期望（仅 `retryAfterMs`、仅 BA-07 四次失败正臂、仅 BA-12 单臂 continue）主张 v1.1 PASS。
