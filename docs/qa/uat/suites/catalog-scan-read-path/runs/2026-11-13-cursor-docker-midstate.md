# Run — 2026-11-13 — cursor-docker-midstate

| 元数据 | 内容 |
|---|---|
| Suite | `UAT-SUITE-CATALOG-SCAN` |
| Agent | Cursor |
| 环境 | 同 CONN-RELOAD 跑次；种子库 `uat_wide_scan` **200 tables／1200 column_rows** |
| 开始／结束 | 2026-11-13 |
| 总判定 | **PASS WITH GAP**（外部目录 live SKIPPED；替身 vitest PASS） |

| Case ID | 结果 | 证据摘要 |
|---|---|---|
| UAT-SCAN-SEED | PASS | `bash scripts/uat/seed-catalog-scan-fixtures.sh` → tables=200 column_rows=1200 |
| UAT-SCAN-MYSQL-01 | PASS | `live-schemas` 200 表，~469ms；`node scripts/uat/run-catalog-scan-wide-api.mjs` |
| UAT-SCAN-MYSQL-02 | PASS | namesOnly 清单 tableCount=200 ~467ms；单表 `uat_t0001` columnCount=6 ~456ms；创建 `executionRuntimeAck=true`；测后 ktx CLEAN |
| UAT-SCAN-SIM | PASS | vitest 4 files／**34 tests** passed（catalog-show／doris-external／schema-structure／live-tables-wide） |
| UAT-SCAN-EXT-01 | SKIPPED | demo 无 `catalog.database` 连接 |
| UAT-SCAN-EXT-02 | SKIPPED | 同上 |

## 备注

- 是否使用 `docker restart`：**否**
- 宽表为本地模拟客户「多表准备结构超时」场景；**不是** SelectDB 外部目录现场包
- 外部目录 `SHOW` 合同由 UAT-SCAN-SIM 覆盖；客户 SelectDB live 需另跑 EXT 用例
- 原始日志：`inbox/uat-scan-vitest-*.log`、`inbox/uat-scan-wide-api-final.log`
