# Run — 2026-11-15 — cursor-p1-12-budget — UAT-SUITE-QUESTION-BUDGET

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-QUESTION-BUDGET` |
| 总账 | P1-12／REQ-030-033 |
| Agent | Cursor（全真）；Claude CLI 本波不可用（`unrecognized_model`） |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-12-question-budget-claude-brief.md`](../../../../../inbox/20261115-p1-12-question-budget-claude-brief.md) |
| 环境 | WebUI `:55176`；MCP `:57881`；`gitSha=d64414d6…`（heal 后一度 `gitDirty=true`） |
| 凭据 | 问数 Bearer `/Users/forrest/Desktop/lucy token.txt`（sha12 `8e0ae3055cef`）；明文未写入 |
| 证据 | [`inbox/uat-p1-27-28-12-14-2026-11-15/p1-12/`](../../../../../inbox/uat-p1-27-28-12-14-2026-11-15/p1-12/) |
| 总判定 | **FAIL**（BUDGET-01 未满足；BUDGET-03 未耗尽）。≠ 可上线 |

## 环境备注（影响本套件）

1. 行权限 UAT 曾把 `dataforai.yaml` 落成 `501:root` mode 600 → `demo_readonly` 解析失败／agents degraded。已 `chown lucy` 并恢复 schema；policy 回到 healthy。  
2. `data-qa-instructions.md`：容器 `/app/webui/config/…` 与 `/data/lucy/webui/config/…` 均有 8204B 含「60／300」句，但本波多次 `initialize` 拿到的 `instructions`（7747 字符）**不含** 60／300；health `dataQaInstructions.source=missing` 间歇出现。  
3. 同窗 `lucy_query` 对 `superstore_orders` 连续返回 `source_ambiguity_gate`（未完成宿主确认），未见 `question_budget_exhausted`。

## 结果

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | health／MCP initialize 可达；记 `gitSha` |
| UAT-BUDGET-01 | **FAIL** | 本波实测 `instructions` 无 **60／300** 现行默认指导（见上环境备注） |
| UAT-BUDGET-02 | **PASS** | 新 begin 后连续 21 次 `lucy_query`；均非 `question_budget_exhausted`（均为 `source_ambiguity_gate`；按 cases 允许业务／ACL 失败） |
| UAT-BUDGET-03 | **BLOCKED** | 推到第 61 次仍无 `question_budget_exhausted`；疑调用未计入数据工具结算或歧义拒绝不推进预算。未改常量 |

## 复跑建议

- 先稳定 data-qa instructions 注入（health `source=project|mirror` 且 initialize 含 60／300）。  
- 再在可成功结算的问数路径上（过歧义门闩或合同允许的不计歧义夹具）跑满 61 次。  
