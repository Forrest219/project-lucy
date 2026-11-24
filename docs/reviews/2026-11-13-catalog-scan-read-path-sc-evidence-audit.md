# 库内扫表读法 · SC-01–SC-14 证据审计

| 元数据 | 内容 |
|---|---|
| 文档名称 | catalog-scan-read-path SC-01–SC-14 证据审计 |
| 文档类型 | Checklist / Evidence |
| 版本 | v1.1 |
| 撰写日期 | 2026-11-13 |
| 关闭日期 | 2026-11-13 |
| 撰写人 | Tester（v1.0）；Fixer（v1.1 收口） |
| 委托人 | xingchen |
| 基于材料 | Spec `docs/specs/lucy-20261111-catalog-scan-read-path-spec.md` §5；Plan `docs/plans/lucy-20261111-catalog-scan-read-path-plan.md` |
| 适用范围 | 功能合同收口证据；**SC-01–SC-14 已全部 CLOSED** |
| 输出位置 | `docs/reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md` |
| 功能编号 | **无**（不发明 inventory P0/P1 id） |

## 测试基线

```bash
cd webui && npx vitest run \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/live-tables.test.ts \
  server/__tests__/schema-structure.test.ts \
  server/__tests__/live-catalog.test.ts \
  server/__tests__/live-tables-wide-schema.test.ts
```

| 项 | 结果 |
|---|---|
| Test Files | **6 passed** |
| Tests | **71 passed / 0 failed** |
| 时长 | ~1.9s |
| Spec／Plan 状态 | **功能合同已收口（2026-11-13）**；本条收口不表示可上线 |

## SC 清单（CLOSED / OPEN）

| ID | 状态 | 证据（测试名 → 文件） |
|---|---|---|
| SC-01 | CLOSED | `returns app with 169 tables without sending metadata to KTX`；`keeps the hive and hive_jd catalogs distinct and returns dim=44, dw=129` → `doris-external-catalog.simulation.test.ts`（`SHOW DATABASES FROM catalog` 经 `runCatalogShowImpl`，非 `runSql`） |
| SC-02 | CLOSED | `lists external names with zero column counts without issuing any DESC`；`lists external table names without describing columns` → 同文件（`SHOW TABLES`、首列表名、`columnCount === 0`） |
| SC-03 | CLOSED | `rejects qualified information_schema and KTX SHOW like the customer runtime` → 同文件（`Unknown database 'default_cluster:information_schema'`） |
| SC-04 | CLOSED | 上列列库／列表用例 `runSqlImpl` 未被调用；KTX 替身对 `SHOW` 返回 `SQL contains read/write operation: Show` |
| SC-05 | CLOSED | `lists names with one tables query and does not join columns` → `live-tables-wide-schema.test.ts`；`lists table names without reading columns` → `live-tables.test.ts`；`aggregates mysql schemas and filters system schemas` → `live-catalog.test.ts`（仍走 `ktx` + `information_schema.tables`） |
| SC-06 | CLOSED | `reads checked table columns with one schema-wide columns query` → `schema-structure.test.ts`：普通 MySQL 准备表结构对 `information_schema.columns` **只调用一次**（Schema 宽、无 `table_name =`），`maxRows: 10_000`；无逐表 `readMysqlTableColumns` |
| SC-07 | CLOSED | `fails closed when schema-wide columns reach 10000 rows without falling back per table` → `schema-structure.test.ts`：达 10000 行超限失败；断言仅一次 Schema 宽查询、无 `table_name =` 退回 |
| SC-08 | CLOSED | `reads the configured file and sends no default database during handshake` → `catalog-show.test.ts`（`params` 无 `database`） |
| SC-09 | CLOSED | `redacts password and destroys…`；握手成功路径 `JSON.stringify(actual)` 不含夹具密码；`does not echo a YAML source line that contains a secret` → `catalog-show.test.ts` |
| SC-10 | CLOSED | `describes one checked external table through KTX and preserves Chinese names` → `doris-external-catalog.simulation.test.ts`（`DESC …` 仅经 `runSqlImpl`） |
| SC-11 | CLOSED | `keeps chatbi on information_schema and never calls catalog SHOW` → `live-catalog.test.ts`；宽表路径旁证 `live-tables-wide-schema.test.ts`（`jipaas_poc`） |
| SC-12 | CLOSED | `returns app with 169…`；`keeps the hive… dim=44, dw=129`；`fails the whole schema list when one SHOW TABLES fails` → `doris-external-catalog.simulation.test.ts` |
| SC-13 | CLOSED | `reads the configured file…`；`rejects unsupported or missing password reference …`（inline／env／缺文件／越界）；含密驱动错误 redact → `catalog-show.test.ts` |
| SC-14 | CLOSED | 四条关闭路径已绿：`redacts…auth/query-error`；`enforces the deadline and closes a hung connect-hang/query-hang`。超时口径与 `CATALOG_SCAN_TIMEOUT_MS = 120_000`／`ktx sql` 默认一致；Spec／Plan v0.3 已把字面 30s 修订为 **120s** |

## 计数

| | |
|---|---|
| CLOSED | **14 / 14** |
| OPEN | **0** |
| v1.1 生产代码 | `schema-structure.ts`：删除普通 MySQL 逐表 columns 循环，改走 Schema 宽 `sqlFor` |
| v1.1 测试 | 重写 `schema-structure.test.ts` SC-06／SC-07 夹具 |
| Spec／Plan 状态 | **功能合同已收口（2026-11-13）**；本条收口不表示可上线 |

## 缺口与移交

1. **SC-06／SC-07／SC-14**：v1.1 已关闭。
2. **不在本条出口**：客户现场复测、浏览器、外部目录全库逐表 `DESC` 网关超时、P0-6／connection-reload（他轨）。

## 建议状态句

> **功能合同已收口（2026-11-13）**（SC-01–SC-14 证据关闭）。**本条收口不表示可上线。**
