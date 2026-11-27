# Fixtures — UAT-SUITE-BUDGET-ANALYST-UX

| 元数据 | 内容 |
|---|---|
| Fixtures 版本 | **v1.0** |
| 适用 | [suite](suite.md) · [cases](cases.md) |

## 身份与作用域

| 身份 | 用途 | 要点 |
|---|---|---|
| `ba-zero-*`（≥5 组 Token／Agent） | BA-01–BA-09 计数／忙时边界 | 全新作用域，预算零态；每组用后即弃，不跨用例复用 |
| `ba-active-*` | BA-10 | 启用口径绑定（`lucy_begin_question` 可见）的 active 实况身份 |
| `ba-cc-main` | BA-12 | 真实 Claude Code 单窗口主会话 |
| `ba-cc-sub-*` | BA-12／R0 PRE-01 | 真实 Claude Code Subagent 派发与多终端并行模式 |
| `ba-rollback-*` | BA-11 | 独立容器跑次专用，验证后恢复默认档 |

## 慢源夹具（等价模拟慢引擎）

- demo MySQL 新建库 `slow_gauge`：视图 `v_sleep(sec INT)` 执行 `SELECT SLEEP(sec)` 后返回单行标量，用于精确控制首字节延迟；配一张小事实表 `gauge_fact`（≥3 行可核对值）作 oracle 锚。
- 经 ktx SL 注册为语义源 `slow_gauge`（只读连接）；`lucy_query` 打到该源即产生真实挂钟延迟。
- 档位标定（R0 实测并记录）：45s（BA-05）、60s（BA-06）、90s（BA-07 超时臂——以硬时限 120s 内必超时的方式构造，如 `SLEEP(200)` 被 90s 空闲超时掐断）。
- `hive-jd` 实况（BA-13，可选）：客户环境真实外部 Hive Catalog，宽表 `information_schema` 级探查＋大表聚合，不构造合成延迟。

## 并发夹具

- BA-03／09：脚本化 MCP 客户端（真实 HTTP＋Bearer）同时发起 N 路工具调用；记录每路发起时刻、响应时刻、完整载荷。
- BA-08：客户端在响应返回前主动断开 socket（模拟 Claude Code `Esc`），计时起点＝断开时刻。
- BA-07 审计导出：WebUI Admin 审计（`budgetSettlement`）导出脱敏样本，须含 `rawDeltaMs`／`billedBusyMs` 双字段。

## Oracle

- 所有事实行断言以独立数据库只读 SQL 为准（`slow_gauge.gauge_fact` 与各语义源既有 oracle 表）。
- 预算/容量断言以服务端审计与结构化响应载荷为准，客户端日志仅作辅助。

## 环境变量矩阵（BA-11 回退集）

`QUESTION_BUDGET_MAX_INFLIGHT=4`、`QUESTION_BUDGET_MAX_BUSY_MS=300000`、`QUESTION_BUDGET_MAX_CONTINUATIONS_WHEN_BEGIN_ACTIVE=1`、`LUCY_QUERY_MAX_INFLIGHT=4`、`LUCY_MCP_AGENT_MAX_INFLIGHT=8`、`LUCY_MCP_CONNECTION_MAX_INFLIGHT=16`、`LUCY_MCP_GLOBAL_MAX_INFLIGHT=24`、`LUCY_MCP_CANCEL_HOLD_MS=30000`、`LUCY_PROXY_UPSTREAM_TIMEOUT_MS=30000`、`LUCY_PROXY_UPSTREAM_HARD_DEADLINE_MS=90000`（以 Spec SC-11 终值为准，实现落定后如有增删须回写本表）。

## 禁止

- 禁止 mock 时钟、桩上游、修改 `QUESTION_BUDGET_MAX_*` 图快、客户端截断冒充服务端行为。
- 禁止在跑次记录写入 Bearer／密码明文。
