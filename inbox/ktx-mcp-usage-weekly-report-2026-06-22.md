# KTX MCP Usage Weekly Report

- Generated at: `2026-06-22T15:13:57+08:00`
- Window: last `7` days by JSONL file mtime; daily buckets use record timestamp in `Asia/Shanghai`
- Log root: `/Users/forrest/.claude/projects`
- Files scanned: `565`; parse errors: `0`

## Route And Version Baseline

- Project MCP KTX URL: `http://localhost:7878/mcp`
- Route status: `direct_ktx_7878`
- KTX CLI: `/Users/forrest/.local/node-current/bin/ktx` / `@kaelio/ktx 0.12.0`
- Claude Code: `/Users/forrest/.local/bin/claude` / `2.1.185 (Claude Code)`
- KTX clone: `/Users/forrest/Projects/ktx/ktx`
- KTX clone branch/commit: `main` / `e550091a7631a119c6a2589ee282f7c79946deaf`
- KTX remote: `https://github.com/Kaelio/ktx.git`
- Schema basis: `source_read; live tools/list probe requires a valid KTX MCP bearer token`

## Totals

- KTX tool_use: `1965`
- KTX tool_result items matched by tool_use_id: `1965`
- Unmatched KTX tool_use: `0`
- Input bytes, JSON-encoded: `354294` (0.34 MiB)
- Result bytes, JSON-encoded content: `3007398` (2.87 MiB)
- Result/input ratio: `8.49`

## Tool Distribution

| Tool | Count | Share | Avg input bytes | Avg result bytes |
|---|---:|---:|---:|---:|
| `sql_execution` | 863 | 43.9% | 304 | 453 |
| `sl_read_source` | 616 | 31.3% | 70 | 2573 |
| `connection_list` | 167 | 8.5% | 2 | 102 |
| `entity_details` | 130 | 6.6% | 218 | 4172 |
| `discover_data` | 105 | 5.3% | 95 | 2647 |
| `wiki_search` | 42 | 2.1% | 65 | 3045 |
| `wiki_read` | 24 | 1.2% | 43 | 2250 |
| `sl_query` | 15 | 0.8% | 386 | 718 |
| `dictionary_search` | 3 | 0.2% | 83 | 572 |

## Daily Distribution

| Day | KTX tool_use |
|---|---:|
| `2026-06-20` | 1251 |
| `2026-06-21` | 714 |

## sl_read_source

| Source | Calls |
|---|---:|
| `kx_fact_financial_amount` | 168 |
| `kx_dim_financial_item` | 141 |
| `kx_dim_company` | 96 |
| `kx_vw_balance_sheet_detail` | 84 |
| `kx_vw_income_statement_detail` | 70 |
| `kx_vw_cash_flow_statement_detail` | 57 |

### Repeated Reads In Same Session

| Session | Source | Calls |
|---|---|---:|
| `0ffddff1-d4fc-4698-8675-660c95fb7428` | `kx_vw_balance_sheet_detail` | 2 |
| `0ffddff1-d4fc-4698-8675-660c95fb7428` | `kx_fact_financial_amount` | 2 |
| `148ba1fb-c4ae-4e60-91a4-b933cf2dd2ed` | `kx_fact_financial_amount` | 2 |
| `14e1e709-7193-4be8-8eee-73918e67dc25` | `kx_fact_financial_amount` | 2 |
| `14e1e709-7193-4be8-8eee-73918e67dc25` | `kx_dim_company` | 2 |
| `14e1e709-7193-4be8-8eee-73918e67dc25` | `kx_dim_financial_item` | 2 |
| `17f3a887-ea91-47e2-95c3-48fc43f2a381` | `kx_fact_financial_amount` | 2 |
| `17f3a887-ea91-47e2-95c3-48fc43f2a381` | `kx_dim_company` | 2 |
| `17f3a887-ea91-47e2-95c3-48fc43f2a381` | `kx_dim_financial_item` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_fact_financial_amount` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_dim_company` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_dim_financial_item` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_vw_balance_sheet_detail` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_vw_income_statement_detail` | 2 |
| `205e74b5-591f-47fc-be24-23536a457528` | `kx_vw_cash_flow_statement_detail` | 2 |
| `4e4f5693-98f5-4922-a836-fb771448e24c` | `kx_fact_financial_amount` | 2 |
| `4e4f5693-98f5-4922-a836-fb771448e24c` | `kx_dim_company` | 2 |
| `4e4f5693-98f5-4922-a836-fb771448e24c` | `kx_dim_financial_item` | 2 |
| `5f4aeb1e-bbc4-4867-98fb-9c69b881a4ec` | `kx_fact_financial_amount` | 2 |
| `5f4aeb1e-bbc4-4867-98fb-9c69b881a4ec` | `kx_dim_company` | 2 |

## sql_execution

- Total calls: `863`
- SELECT calls: `849`
- SELECT * calls: `29`
- SELECT without LIMIT: `701`
- SELECT without LIMIT and not aggregate: `421` (49.6% of SELECT)
- Explicit maxRows set: `717`
- Aggregate recognition: `count/sum/avg/min/max/group_concat/json_arrayagg/json_objectagg/GROUP BY`

### SQL First Keyword

| Keyword | Count |
|---|---:|
| `SELECT` | 849 |
| `DESCRIBE` | 10 |
| `SHOW` | 4 |

## connection_list

- Distinct result payloads: `1`
- Top identical-result counts: `[167]`

## Notes

- Byte counts use compact JSON encoding (`ensure_ascii=false`, no spaces). They are stable for before/after comparison, not wire-level packet sizes.
- KTX result matching is restricted to `tool_result.tool_use_id` values produced by `mcp__ktx__*` tool_use records.
- The rolling window selects JSONL files by file mtime; the daily distribution itself uses each record's embedded timestamp.
