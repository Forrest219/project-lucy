# Run — 2026-11-15 — cursor-p1-14-audit — UAT-SUITE-BUDGET-AUDIT

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-BUDGET-AUDIT` |
| 总账 | P1-14／REQ-030-035 |
| Agent | Cursor（全真） |
| Plan／Brief | [`lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md`](../../../../../plans/lucy-20261115-p1-27-28-12-14-uat-cursor-claude-plan.md)；[`inbox/20261115-p1-14-budget-audit-claude-brief.md`](../../../../../inbox/20261115-p1-14-budget-audit-claude-brief.md) |
| 依赖 | 同日 P1-12 未产生 `budget_stop`（BUDGET-03 BLOCKED）；本套件亦未能自跑出耗尽行 |
| 凭据 | WebUI Admin：Projects `lucywebui logi.txt`；明文未写入 |
| 证据 | [`inbox/uat-p1-27-28-12-14-2026-11-15/p1-14/`](../../../../../inbox/uat-p1-27-28-12-14-2026-11-15/p1-14/)（`calls-export.csv`／metadata v1／v2） |
| 总判定 | **FAIL**（AUDIT-01 BLOCKED→套件不能 PASS；02／03 有部分证据）。≠ 可上线 |

## 结果

| ID | 结果 | 摘要 |
|---|---|---|
| UAT-R0 | **PASS** | Admin 登录 200；`GET /api/admin/audit/export` 200 `text/csv` |
| UAT-BUDGET-AUDIT-01 | **BLOCKED** | 导出 500 行中 **0** 行 `budget_*` 非空；无 `budget_stop`／无 `budgetSnapshot`。因 P1-12 未耗尽且本波无法结算 61 次成功数据工具。**禁止**用 vitest 夹具凑绿 |
| UAT-BUDGET-AUDIT-02 | **PASS** | 同批 CSV 中普通调用行扁平预算列均为空（抽样：全表 `budget_nonzero=0`，故业务行无快照） |
| UAT-BUDGET-AUDIT-03 | **PASS** | v1 `export-metadata` 字段说明含 `budget_event_kind`／`budgetSnapshot`／`budget_max_calls` 等；v2 metadata **不含**这些新增扁平列 |

## 复跑建议

待 P1-12 BUDGET-03 产出真实 `budget_stop` 后再跑 AUDIT-01；或本套件内在可结算问数路径自跑 61 次。  
