# Run — 2026-11-15 — cursor-p1-14-audit-retest — UAT-SUITE-BUDGET-AUDIT

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUDGET-AUDIT` |
| 总账 | P1-14／REQ-030-035 |
| Agent | Cursor（全真复测） |
| 对照 | 同日首跑 [2026-11-15-cursor-p1-14-audit](2026-11-15-cursor-p1-14-audit.md)（AUDIT-01 BLOCKED） |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-14-budget-audit-claude-brief.md`](../../../../../inbox/20261115-p1-14-budget-audit-claude-brief.md) |
| 依赖 | 同日 [P1-12 retest BUDGET-03](../../question-budget/runs/2026-11-15-cursor-p1-12-budget-retest.md) 已产出真实 `budget_stop`（`lucy_read_source`×61） |
| 凭据 | WebUI Admin：Projects `lucywebui logi.txt`（Desktop 缺文件时回退）；明文未写入 |
| 证据 | [`inbox/uat-p1-12-14-retest-2026-11-15/p1-14/`](../../../../../inbox/uat-p1-12-14-retest-2026-11-15/p1-14/)（`calls-export.csv`／metadata／`audit01-stop-row.json`） |
| 总判定 | **PASS**（R0／AUDIT-01／02／03）。≠ 可上线 |

## 结果

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | Admin 登录 200；`GET /api/admin/audit/export` 200 CSV；metadata 端点可达 |
| UAT-BUDGET-AUDIT-01 | **PASS** | 定位本波行 `ts=2026-11-15T15:13:07.501Z`，`tool=lucy_read_source`，`outcome=budget_stop`，`decision_reason=question_budget_exhausted`。扁平列：`budget_event_kind=budget_stop`，`budget_calls=60`，`budget_max_calls=60`，`budget_exhausted_by=calls`。`args_summary.budgetSnapshot`：`eventKind=budget_stop`，`maxCalls=60`，`calls=60`，`schemaVersion=lucy-budget-snapshot/v1` |
| UAT-BUDGET-AUDIT-02 | **PASS** | 同批导出中普通 `lucy_read_source` `outcome=ok` 行扁平预算列均为空（例：同秒业务成功行无 `budget_event_kind`／`budget_max_calls`） |
| UAT-BUDGET-AUDIT-03 | **PASS** | v1 `export-metadata` 含 `budget_event_kind`／`budgetSnapshot`／`budget_max_calls` 等说明；v2 metadata **不含**上述新增扁平列 |

## 备注

- 导出窗约覆盖 UTC 近 2h；CSV 另含历史 `hehe` 旧 `budget_stop`（扁平列空），本条断言以本波 `2026-11-15T15:13:07Z` 行为准。  
- 禁止 vitest／夹具 CSV 冒充；本波为全真 Admin 导出。  
