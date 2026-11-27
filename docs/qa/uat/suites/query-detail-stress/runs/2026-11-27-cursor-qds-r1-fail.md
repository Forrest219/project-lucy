# UAT-SUITE-QUERY-DETAIL-STRESS — 2026-11-27（`baselineRevision=1`）FAIL

| 项 | 内容 |
|---|---|
| Suite | `UAT-SUITE-QUERY-DETAIL-STRESS`／**QDE-STRESS-B** |
| 基准 | `baselineId=QDE-STRESS-B`，`baselineRevision=1` |
| 环境 | scale＋Hive HS2（`lucy-uat-hive-hs2`，605 表）；demo 栈 `project-lucy-lucy-1`；`gitSha=7e377afc`／dirty |
| 入口 | WebUI `http://127.0.0.1:55176`；MCP `http://127.0.0.1:57881/mcp` |
| 身份 | **单** `demo_agent` Token × 多 session（非 16 独立 Agent Token；跑次如实登记） |
| Hive 慢臂 | HS2 `qds_pad` CROSS JOIN 同窗（MCP Hive 直连问数未接线；H1 MCP 几乎全失败，ST-05 靠 ≥3s 壁钟样本） |
| 证据 | [`inbox/2026-11-27-qds-stress-evidence.json`](../../../../../inbox/2026-11-27-qds-stress-evidence.json) |
| 窗长 | warmup 120s／steady 900s／cooldown 120s |

## 门禁

| 线 | 结果 | 备注 |
|---|---|---|
| ST-01 | PASS | detail `measures_required`＝0；`detailMode` 样本 OK |
| ST-02 | PASS | 累计明细行 **90316** ≥ 50000 |
| ST-03 | **FAIL** | 探针成功率 0.963 ≥ 0.95；**steady p95 3405 ms ≫ 1.5× warmup p95 750 ms** |
| ST-04 | **FAIL** | 分析臂 M5 成功率 **0.936** ＜ 0.95（422/451） |
| ST-05 | PASS | Hive 慢样本 ≥3s：**159** |
| ST-06 | PASS | 形态覆盖＋份额（maxShare≈0.14） |
| ST-07 | PASS | 短会话 M10 调用达标 |
| ST-08 | PASS | 无持续 unhealthy／MCP 掉线＞60s |
| ST-09 | PASS | 未主张 IMC／SC-06 背压 |

## 形态直方图（calls／ok／err）

| id | calls | ok | err |
|---|---:|---:|---:|
| M1 | 868 | 788 | 80 |
| M2 | 416 | 391 | 25 |
| M3 | 416 | 380 | 36 |
| M5 | 451 | 422 | 29 |
| M6 | 450 | 418 | 32 |
| M7 | 416 | 379 | 37 |
| M8 | 642 | 613 | 29 |
| M9 | 640 | 626 | 14 |
| M10 | 522 | 430 | 92 |
| M11 | 898 | 866 | 32 |
| M12 | 413 | 2 | 411（负控 `measures_required` 预期错） |
| H1 | 982 | 1 | 981（MCP Hive 问数未就绪；壁钟慢样计入 ST-05） |
| H2 | 1143 | 1143 | 0 |

## 判定

**FAIL**（ST-03 探针 p95 膨胀；ST-04 分析成功率差一线）。≠ lean QDE PASS；≠ IMC／0119；≠ 功能合同收口；≠ 可上线。

复跑建议：降 Hive 同窗强度或扩探针／分析成功率余量；补齐 Hive 语义资产后再验 H1 MCP 真慢臂。
