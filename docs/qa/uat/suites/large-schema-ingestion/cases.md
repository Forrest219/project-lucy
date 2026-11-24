# Cases — UAT-SUITE-LARGE-SCHEMA

预算来自 [Spec](../../../../specs/lucy-20261115-large-schema-ingestion-spec.md) §4（B1–B7）。runner：`scripts/uat/run-large-schema-ingestion.mts`（真实 WebUI HTTP、真实 KTX、真实 MySQL／Doris／Hive）。

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-SCALE-R0 | 环境与规模门禁 | 脚本 | runner R0 | 夹具达到规模下限（MySQL ≥1201 表、外部目录 ≥605 表）；记 `gitSha`／`gitDirty`。不达标 `BLOCKED` |
| UAT-SCALE-01 | 普通 MySQL 列出表名 | API | `POST …/schema-structure {schema}` | 1201 张表，≤ 5 秒（B1） |
| UAT-SCALE-02 | 普通 MySQL 读单表（10 列、1000 列） | API | `POST …/schema-structure {schema,tables:[t]}` | 字段数完全相等，各 ≤ 3 秒（B2） |
| UAT-SCALE-03 | 普通 MySQL 结构差异 20 张表 | API | `GET …/table-structure-diff?tables=…20 张` | HTTP 200，≤ 5 秒（B7） |
| UAT-SCALE-04 | 普通 MySQL 勾选 600 张表读全部字段 | API 循环 | runner `readTables` | 600/600 全部读完，总计 ≤ 60 秒（B4），任一单次响应 ≤ 20 秒（B3） |
| UAT-SCALE-05 | 外部目录列出表名 | API | 同 01，打在外部目录连接 | ≥605 张表，≤ 5 秒（B1） |
| UAT-SCALE-06 | 外部目录勾选 600 张表读全部字段 | API 循环 | runner `readTables` | 600/600，总计 ≤ 60 秒，单次响应 ≤ 20 秒 |
| UAT-SCALE-07 | 外部目录宽表 | API | `tables:[w_1500…w_5000]` | 1500／1999／2000／3000／5000 列**全部读出且列数相等**，各 ≤ 10 秒（B2） |
| UAT-SCALE-08 | 失败可诊断 | API | `tables:["no_such_table"]` | 4xx，≤ 5 秒，文案点名该表 |
| UAT-SCALE-09 | 客户端累积 600 张×30 列 | 进程内 | runner `caseClientMerge`（真实 `readCheckedTableColumns`，服务端用预构造批量响应桩；2026-11-16 起，旧版逐张调用 `mergeManifestTables` 的测法已弃用） | 600/600，总计 ≤ 5 秒，单步 ≤ 200 毫秒（B5）。**不需要登录与夹具** |
| UAT-SCALE-10 | 校验 600×30 列的 Manifest | API | `POST /api/catalog/assets/validate`（只校验，不写入） | 200 且 `valid=true`，≤ 20 秒（B6） |
| UAT-SCALE-11 | Manifest 写入与热重载（可选） | API，隔离环境 | `…/assets/upload` 与 `/api/catalog/reload` | 600×30 列写入成功，重载后可见；记下耗时作基线（O3）。只在 `demo:upgrade --fresh` 之后的隔离 compose project 跑 |
| UAT-SCALE-12 | MySQL 12000 张表的表清单（可选） | API | `UAT_SCALE_XL=1` 夹具 | 全部列出，不报「超过一次可读取的上限」，≤ 5 秒 |

判定细则：

- 「读全部字段」按**字段数相等**判，不接受「状态 200 但列少了」。
- runner 在任一用例超预算时**提前停止并报告进度**（例如「65/600」），不继续耗尽时间；这本身就是 FAIL 证据。
- `BLOCKED` 与 `FAIL` 必须分开：缺夹具、缺口令、环境不可达是 `BLOCKED`；预算或列数不满足是 `FAIL`。

---

## UAT-SCALE-R0 — 环境与规模门禁

### 前置

demo Docker 在跑；`bash scripts/uat/seed-large-schema-fixtures.sh all` 已成功；`compose-lucy-1` 与 Doris FE 已在 `lucy-uat-hive` 网络里（seed 脚本会处理）。

### 步骤

1. `GET /api/health`，记 `gitSha`、`gitDirty`。
2. 创建两条临时连接（MySQL：`uat_scale_mysql`；外部目录：`<catalog>.uat_scale_hive`），读表名。
3. 核对表数达到规模下限。

### 期望

- MySQL ≥ 1201 张，外部目录 ≥ 605 张。
- 不达标一律 `BLOCKED`，**不得**用较小夹具继续并记 PASS。

### 清理

runner 结束时删除两条临时连接（`finally`）。

---

## UAT-SCALE-01 / 02 / 03 — 普通 MySQL 的表名、单表与结构差异

### 步骤

1. 无 `tables` 调用 `schema-structure`，记表数与耗时。
2. 读 `t_00001`（10 列）与 `w_1000`（1000 列），记列数与耗时。
3. 对前 20 张表调用 `table-structure-diff`（Spec 190 的单次上限），记 HTTP 状态与耗时。

### 期望

见上表。2026-11-15 诊断环境上，第 3 条是 19 秒（预期 FAIL），其余在预算内。

### 清理

无（只读）。

---

## UAT-SCALE-04 / 06 — 勾选 600 张表读全部字段（MySQL／外部目录）

### 步骤

1. runner 按**客户端当前契约**读取：服务端接受批量时每批 50 张，否则一次一张。
2. 记录已读张数、调用数、最慢一次响应、总耗时。
3. 总耗时超过 60 秒时，runner 立即停止并记录「k/600」。

### 期望

- 600/600，总计 ≤ 60 秒，最慢单次响应 ≤ 20 秒。
- 诊断环境预期：MySQL 逐表约 0.93 秒/张，600 张约 9 分钟（预期 FAIL）；外部目录本机 2.7 秒（预期 PASS，客户延迟下待测）。

### 清理

无（只读）。

---

## UAT-SCALE-07 — 外部目录宽表

### 步骤

对 `w_1500／w_1999／w_2000／w_3000／w_5000` 逐一读字段。

### 期望

- 列数全部相等，各 ≤ 10 秒。
- 2026-11-15 诊断环境上 2000、3000 列整张表被拒绝（`too_large`），预期 FAIL。

### 清理

无（只读）。

---

## UAT-SCALE-08 — 失败可诊断

### 步骤

读一张不存在的表 `no_such_table`。

### 期望

- 4xx，≤ 5 秒。
- 响应文案点名 `no_such_table`；不得只说「读取失败」。

### 清理

无。

---

## UAT-SCALE-09 — 客户端累积

### 前置

无需登录与夹具。使用仓库内真实的 `readCheckedTableColumns`（客户端实际读取路径），`fetch` 换成预构造的批量响应桩，只测客户端耗时。

### 步骤

对 600 张表（每张 30 列）调用 `readCheckedTableColumns`（每批 50 张，桩立即返回），记每批之间最大间隔与总耗时。

### 期望

- 600/600；总计 ≤ 5 秒；单步 ≤ 200 毫秒。
- 2026-11-15 基线（旧测法，逐张合并）：10 秒内只完成 144/600，二次方复杂度。2026-11-16 起用新测法，预算不变；见跑次备注。

### 清理

无。

---

## UAT-SCALE-10 — 校验 600×30 列 Manifest

### 步骤

构造 600 张表×30 列的 Manifest（约 1 MiB），`POST /api/catalog/assets/validate`。**只校验，不写入。**

### 期望

- HTTP 200，`valid=true`，≤ 20 秒。
- 基线未测；首个有口令的跑次的数字作为 B6 的取证依据（Spec O3）。

### 清理

无（校验不落盘）。

---

## UAT-SCALE-11 — Manifest 写入与热重载（可选）

### 前置

只在隔离 compose project 里跑（`npm run demo:upgrade -- --fresh` 之后），因为写入会落到语义层目录并触发热重载。不得在已有业务数据的 demo 上跑。

### 步骤

对 600×30 列的 Manifest 依次 `upload`、触发 `catalog/reload`，记各自耗时与重载结果。

### 期望

- 写入成功、重载成功、重载后可在目录中看到 600 张表。耗时记入跑次，作为 Spec O3 的基线。

### 清理

删除临时连接与上传的资产；`demo:upgrade -- --fresh` 回到干净状态。

---

## UAT-SCALE-12 — MySQL 12000 张表（可选）

### 前置

`UAT_SCALE_XL=1 bash scripts/uat/seed-large-schema-fixtures.sh mysql`。

### 步骤

对 `uat_scale_mysql_xl` 列表名。

### 期望

- 12000 张全部列出，≤ 5 秒；不出现「超过一次可读取的上限」。
- 当前代码预期 FAIL（MySQL 表清单 10000 张封顶，受 `ktx sql --max-rows` 限制）。

### 清理

`DROP DATABASE uat_scale_mysql_xl`（夹具库，可重造）。
