# 重读路径减负性能证据（SC-13／SC-14）

| 元数据 | 内容 |
|---|---|
| 文档名称 | 重读路径减负性能证据 |
| 文档类型 | Test Report |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 撰写人 | Grok（Cursor） |
| 委托人 | xingchen |
| 基于材料 | `docs/specs/lucy-20261113-heavy-read-path-and-probe-relief-spec.md` SC-13／SC-14；`npm --prefix webui run perf:event-loop-relief` |
| 适用范围 | P1-21／REQ-030-042 是否达到客户规模性能门槛，以及是否按 O1 启用 worker |
| 输出位置 | `docs/reviews/2026-11-13-heavy-read-path-relief-perf-evidence.md` |

## 结论

SC-13 通过。SC-14 按调整后的门槛通过。2026-11-13 委托人将 `/api/livez` p99 从 300ms 调整为 400ms，并确认这一跑过关。未启用 worker。

| 项 | 门槛 | 实测 | 结果 |
|---|---|---|---|
| `/api/admin/audit/turns?hours=168` p95 | ≤ 3,000ms | 105ms（10 次：105、97、97、102、101、95、93、104、98、95） | 通过 |
| `/api/livez` max | ≤ 1,000ms | 487ms | 通过 |
| `/api/livez` p99 | ≤ 400ms（原 300ms，委托人同日调整） | 359ms（293 次） | 通过 |
| 系统概览 `DISPLAY_SNAPSHOT_BUSY` | 0 | 0 | 通过 |

原始 JSON：`inbox/event-loop-relief-perf.json`。

## 夹具与环境

- 开发机，2026-11-13T15:37:53Z。
- 115,000 条 `access_log`，67 个用户（Zipf），183 张表，30 天窗口。维护器写完 28,776 条 `inferred_turns`，耗时 1,019ms。
- 负载 60 秒：3 路 `/turns?hours=168`，1 路 `/api/diff`，系统概览循环 `/api/project`、`/api/sources`、`/api/admin/agents`，同时采样 `/api/livez`。
- 本地夹具以 development＋`LUCY_WEBUI_AUTH=off` 打开，避免把登录 401 当成查询耗时。

## 未做的事

未启用 worker。`/turns` 单次 p95 为 105ms。并发负载下 livez p99 为 359ms，落在调整后的 400ms 门槛内。
