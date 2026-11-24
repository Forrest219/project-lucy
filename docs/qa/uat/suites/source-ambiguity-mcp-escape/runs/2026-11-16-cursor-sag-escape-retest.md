# Run — 2026-11-16 — P1-35 纯 MCP 表级歧义逃生复测（优化后）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`（P1-35／REQ-030-056；伴生 P0-3） |
| Agent | Cursor 本机全真 MCP HTTP（非 Code Review；非 vitest 冒充） |
| 环境 | 本机 demo Docker `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；health `gitSha=c84e6d7d1a5bdc43891fac51159f49dc9b7b2b45`，`gitDirty=true`，`lucyVersion=0.30.0`，`ktxRuntime.status=ready` |
| 身份 | `~/.cursor/mcp.json` → `lucy-local-docker`（明文不入档） |
| 开始／结束 | 2026-11-16 20:18（UTC+8） |
| 证据 | `inbox/uat-sag-escape-2026-11-16-retest/summary.json`（可删） |
| 对照基线 | [2026-11-16-claude-sag-escape-baseline](2026-11-16-claude-sag-escape-baseline.md)（ESC-01 当时 FAIL） |
| 总判定 | **PASS**（必做 R0／ESC-01／ESC-02／ESC-03 全绿） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health `ok`；`gitSha=c84e6d7d…`；MCP `initialize` 200＋session |
| UAT-SAG-ESC-01 | **PASS** | begin「超市最近怎么样」＋**首次** `lucy_query` `measures=["superstore_orders.order_count"]` → `isError=false`；非 `source_ambiguity_gate`；响应含 `answer_verifiability`／`superstore_orders`（直接成交） |
| UAT-SAG-ESC-02 | **PASS** | 独立会话；intentSummary＝「仅查询 superstore_orders 订单明细金额」（不含「超市」）；首次 query 成交；非 ambiguity |
| UAT-SAG-ESC-03 | **PASS** | 同 MCP Bearer `POST .../source-ambiguity/confirm`（无 person／无 attestation）→ **403** `host_confirm_requires_person` |

## 伴生回归（非本套件必做，Plan T5）

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SAG-01 **v2** | **PASS** | begin「超市」后 `measures` 同时含 `superstore_orders.order_count`＋`superstore_returns.return_count` → `source_ambiguity_gate`；零成交 |

## 备注

- 是否使用 `docker restart`：**否**（此前已 `demo:upgrade` 平滑升级）
- 清理：无持久化配置变更；会话丢弃
- **关闭** `GAP-UAT-P0-3-ESCAPE`（逃生缺口）＝本跑次 INDEX＝PASS＋SAG-01 v2 回归。**≠** D5 全量功能合同收口；**≠** 可上线
