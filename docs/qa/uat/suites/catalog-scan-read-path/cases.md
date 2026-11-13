# Cases — UAT-SUITE-CATALOG-SCAN

| ID | 标题 | 层级 | 自动化指针 |
|---|---|---|---|
| UAT-SCAN-SEED | 宽表种子就绪 | 脚本 | `seed-catalog-scan-fixtures.sh` |
| UAT-SCAN-MYSQL-01 | 普通连接库内目录 | 手工／API | live-schemas |
| UAT-SCAN-MYSQL-02 | 宽库准备表结构一次读 | 手工／API | schema-structure |
| UAT-SCAN-SIM | 外部目录合同替身 | vitest | catalog-show／doris／schema-structure |
| UAT-SCAN-MYSQL-VER | MySQL 5.7／8.0／8.4 矩阵 | 脚本全真 | `run-mysql-version-matrix.sh` |
| UAT-SCAN-EXT-01 | 外部目录列库 live | 可选／须授权 | live-schemas |
| UAT-SCAN-EXT-02 | 外部目录列表 live | 可选／须授权 | live-tables |
| UAT-SCAN-CASE-01 | 大小写歧义字段拒绝 | 全真 API | `run-zhaomin-local-gaps.mjs case` |
| UAT-SCAN-DIFF-01 | 结构差异缺表与已读表分开 | 全真 API | 同上 |

---

## UAT-SCAN-SEED — 宽表种子

### 步骤

```bash
bash scripts/uat/seed-catalog-scan-fixtures.sh
```

### 期望

`uat_wide_scan` 存在；`information_schema.tables` 计数 ≥ 配置的 `UAT_WIDE_TABLE_COUNT`（默认 200）；`e2e_conn_reload` 存在。

---

## UAT-SCAN-MYSQL-01 — 库内目录

### 步骤

1. 登录 WebUI → 连接概览  
2. 对 `demo-mysql`（或宽表临时连接）点「重新拉取库内目录」  
3. 或 `GET /api/connections/<id>/live-schemas?refresh=1&purpose=manual`  

### 期望

2xx；Schema 列表含目标库；「库内表数」与种子／库内一致（宽表连接应为 ≥200）；错误无密码明文。

---

## UAT-SCAN-MYSQL-02 — 宽库准备表结构

### 步骤

1. 新建临时连接 `uat-scan-wide-<ts>` → `demo-db`／`uat_wide_scan`（端点闸「仍要新建连接」）  
2. **列名清单**：`POST .../schema-structure` body `{ "schema": "uat_wide_scan" }`（无 `tables`）  
3. **单表字段**：`POST .../schema-structure` body `{ "schema": "uat_wide_scan", "tables": ["uat_t0001"] }`  
4. 或一键：`node scripts/uat/run-catalog-scan-wide-api.mjs`  

### 期望

- 创建连接 `executionRuntimeAck=true`（顺带验证重载）  
- 步骤 2：`namesOnly=true`，`tableCount>=200`，秒级返回（不得卡死）  
- 步骤 3：`namesOnly=false`，`columnCount>=1`（种子表为 6 列：id+5），秒级返回；现行实现用 Schema 宽 columns 再过滤到单表，**禁止**退回「每表一条 columns」的客户超时路径  
- 测后删除临时连接；`ktx.yaml` 无 `uat-scan-` 残留  

---

## UAT-SCAN-MYSQL-VER — MySQL 小版本矩阵（自 5.7）

### 前置

委托人已批准矩阵（2026-11-13）。lucy 栈 healthy。

### 步骤

```bash
bash scripts/uat/run-mysql-version-matrix.sh
```

### 期望

- **5.7**（`uat-mysql57`）、**8.0**（`uat-mysql80`）、**8.4**（`demo-db`）三档：`live-schemas` 宽表张数达标；namesOnly 清单成功；单表 columns≥1；`executionRuntimeAck=true`；测后无残留连接  
- 全程无 `docker restart` lucy  
- 任一九失败 → 整案 FAIL（不得用「只在 8.4 绿」主张矩阵 PASS）

---

## UAT-SCAN-SIM — 外部目录替身

### 步骤

跑 fixtures 中 vitest 命令。

### 期望

全部 PASS；覆盖直连 `SHOW`、`information_schema` 不得作为外部目录成功路径、宽 Schema 一次 columns、超时关连接等。

---

## UAT-SCAN-CASE-01 — 大小写歧义不共用字段

### 前置

`demo-db` 的 `lower_case_table_names=0`。库 `uat_case_pair` 有表 `Foo`、`foo`、`only_one`。临时连接指向 `demo-db`／`uat_case_pair`。`demo-mysql` 与这次用的用户名不同，新建时带 `acknowledgeSeparateConnection=true`。测后删除。

### 步骤

1. `POST /api/connections/<id>/schema-structure`，body `{ "schema": "uat_case_pair", "tables": ["Foo"] }`
2. 同一接口请求 `{ "schema": "uat_case_pair", "tables": ["only_one"] }`

### 期望

- 步骤 1：4xx，文案含「对应多张表」，响应无口令明文，且不返回可写入 Manifest 的字段列表
- 步骤 2：2xx，`namesOnly=false`，`columnCount>=1`

### 清理

删除临时连接。`DROP DATABASE uat_case_pair` 可留到同批结构差异用例结束之后。

---

## UAT-SCAN-DIFF-01 — 缺表与已读表分开

### 前置

同上临时连接。库内有 `only_one`，没有 `missing_tbl`。

### 步骤

`GET /api/connections/<id>/table-structure-diff?schema=uat_case_pair&tables=only_one,missing_tbl`

### 期望

- `only_one` 的 `status=ok`（已读到的表保留）
- `missing_tbl` 的 `status=not_in_library`（只在表不存在时这样报，不得是 `QUERY_FAILED`）
- HTTP 2xx

### 清理

删除临时连接与 `uat_case_pair`。

---

## UAT-SCAN-EXT-01／02 — 外部目录 live（可选）

### 前置

fixtures 已填真实 `catalog.database` 连接。

### 步骤

1. `GET .../live-schemas?refresh=1` → 库列表与 `tableCount>0`  
2. `GET .../live-tables?schema=<存在库>` → 表名非空  
3. 不得再以 `Unknown database '...information_schema'` 为唯一成功路径  

### 期望

与 Spec SC 外部目录分支一致；无凭据则整组 `SKIPPED`。
