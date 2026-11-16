# Run — 2026-11-16 — P0-3 纯 MCP 表级歧义逃生基线（优化前）

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE`（P0-3／REQ-030-024；逃生／死路专测） |
| Agent | **Claude 委托波次**（委托人要求克劳德测试）；全真 MCP HTTP 取证由本机 Cursor 会话代执行（Claude Code CLI `-p` 两次均超时无产出，见 `inbox/uat-sag-escape-2026-11-16/claude-*.log`）。**不是** Code Review |
| 环境 | 本机 demo Docker `compose-lucy-1`；WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp`；health `gitSha=d64414d68a19bd2ade981c74a2c8b23e56a5893b`，`gitDirty=true`，`lucyVersion=0.30.0`，`ktxRuntime.status=ready` |
| 身份 | `~/.cursor/mcp.json` → `lucy-local-docker`；`tokenSha12=3f1abd548a1a`（明文不入档）。桌面 `lucymcp.txt` 同日探针 **401**，未使用 |
| 开始／结束 | 2026-11-16 18:56:03（UTC+8，evidence 时间戳） |
| 证据 | `inbox/uat-sag-escape-2026-11-16/evidence.json`（可删临时目录） |
| 错题回链 | [`docs/lessons/2026-11-16-source-ambiguity-gate-deadlock.md`](../../../../../lessons/2026-11-16-source-ambiguity-gate-deadlock.md) |
| 总判定 | **FAIL**（必做 UAT-SAG-ESC-01 FAIL＝优化前基线；其余必做 PASS） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health `status=ok`；`gitSha=d64414d68a19…`；MCP `initialize` 200＋session |
| UAT-SAG-ESC-01 | **FAIL** | begin「超市最近怎么样」＋`lucy_query` `measures=["superstore_orders.order_count"]` → `isError=true`；`reason=source_ambiguity_gate`；候选 3 张（orders／people／returns）；`usableTargets=[]`；`rejected` 三条均为 `schema_evidence_unavailable`（文案「缺少真实 Schema 证据，无法判定」）。已限定表名仍无 MCP 可达逃生 → 对照 cases **优化后期望**为 FAIL 基线 |
| UAT-SAG-ESC-02 | **PASS** | 独立会话；intentSummary＝「仅查询 superstore_orders 订单明细金额」（**不含**「超市」）；同 measures → 非 `source_ambiguity_gate`；响应含 `answer_verifiability`／`superstore_orders`（成交） |
| UAT-SAG-ESC-03 | **PASS** | 同 MCP Bearer `POST /mcp/host/source-ambiguity/confirm` → **403** `host_confirm_requires_person`；加 `x-lucy-host-attestation` 伪头仍 **403** 同 reason（非 person 不得自证） |

## 备注

- 是否使用 `docker restart`：**否**
- 清理：无持久化配置变更；会话丢弃
- 桌面 token 过期不影响本判定（已改用可用 Cursor MCP 凭据）
- ESC-02 首稿曾误写「不涉及其他超市表」→ 含「超市」n-gram 假 FAIL；cases／fixtures 已改正后重跑，以本跑次为准
- 本记录＝**优化前失败基线**；产品优化后须用**同一 cases** 复跑并期望 ESC-01 翻绿，套件才可写 PASS
- **≠** 可上线；**≠** 功能合同收口；**≠** 开发授权
