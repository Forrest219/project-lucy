# Cases — UAT-SUITE-CATALOG-SCAN

| ID | 标题 | 层级 | 自动化指针 |
|---|---|---|---|
| UAT-SCAN-SEED | 宽表种子就绪 | 脚本 | `seed-catalog-scan-fixtures.sh` |
| UAT-SCAN-MYSQL-01 | 普通连接库内目录 | 手工／API | live-schemas |
| UAT-SCAN-MYSQL-02 | 宽库准备表结构一次读 | 手工／API | schema-structure |
| UAT-SCAN-SIM | 外部目录合同替身（含 P1-20 字段） | vitest | catalog-show／doris／schema-structure／live-catalog |
| UAT-SCAN-KTX-GUARD | 真实 KTX 只读校验仍拒绝 `DESC`／`DESCRIBE`／`SHOW`（防替身漂移） | 脚本全真 | `verify-ktx-readonly-guard.sh` |
| UAT-SCAN-MYSQL-VER | MySQL 5.7／8.0／8.4 矩阵 | 脚本全真 | `run-mysql-version-matrix.sh` |
| UAT-SCAN-EXT-01 | 外部目录列库 live | 可选／须授权 | live-schemas |
| UAT-SCAN-EXT-02 | 外部目录列表 live | 可选／须授权 | live-tables |
| UAT-SCAN-EXT-03 | 外部目录单表读字段 live（P1-20 事故复现） | **P1-20 现场必验**／须凭据 | schema-structure |
| UAT-SCAN-EXT-04 | 外部目录中文表名单表字段 live | P1-20 现场／须凭据与中文表 | schema-structure |
| UAT-SCAN-EXT-05 | 外部目录结构 diff／per-table 同通道 live（含缺表报错取证） | P1-20 现场／须凭据 | table-structure-diff |
| UAT-SCAN-CASE-01 | 大小写歧义字段拒绝 | 全真 API | `run-zhaomin-local-gaps.mjs case` |
| UAT-SCAN-DIFF-01 | 结构差异缺表与已读表分开 | 全真 API | 同上 |

合同：P1-16／REQ-030-037（列库／列表／宽表）＋ P1-20／REQ-030-041（外部目录单表字段直连）。

- SIM 可主张 EC 替身；**KTX-GUARD** 证明替身所模拟的 KTX 拒绝行为仍真实；二者都**不得**冒充 EXT live PASS。
- 无点号 MySQL 单表字段不回归（EC-10 的 live 镜像）并入 `UAT-SCAN-MYSQL-02` 步骤 3，不另立编号，避免同一检查算两次 PASS。
- EXT-03…05 是 P1-20 的现场必验项。「PASS WITH GAP」只适用于真正可选的 EXT-01／02；EXT-03…05 未跑时 P1-20 按 `suite.md`「主张规则」单独记 `NOT VERIFIED`／`BLOCKED`。

### 跑前统一前置（所有 live 用例）

1. 测试前已执行 `npm run demo:upgrade`（保留配置）使容器含待测代码。
2. 跑次记录必须写：`git rev-parse HEAD`、`git status --short` 是否脏（脏则列出与本套件相关的文件）、`docker exec compose-lucy-1 cat /app/BUILD_REVISION`（或等价构建标识）。
3. 容器内源码自检（外部目录字段用例前必做）：
   `docker exec compose-lucy-1 grep -c "COLUMNS FROM" /app/webui/server/catalog-show.ts` 应 ≥ 1。为 0 说明容器仍是修复前代码，**停表**，不得继续记结果。
   （白名单源码把 `SHOW` 与 `COLUMNS FROM` 拆在同一个正则里，字面 `SHOW COLUMNS FROM` 并不存在，不要用它做 grep。）

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
- 步骤 3：`namesOnly=false`，`columnCount>=1`（种子表为 6 列：id+5），秒级返回。带 `tables` 时走 `per-table` 读法（对该表一次按表读取）；**禁止**退回「整库逐表各发一条 columns」的客户超时路径。本步同时是 P1-20 **EC-10 的 live 回归检查**：无点号 MySQL 单表字段路径未被外部目录直连改动破坏，判定只看绝对值（`columnCount=6`、`namesOnly=false`、2xx），不与「修复前」比较  
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

## UAT-SCAN-SIM — 外部目录合同替身（含 P1-20）

对应 Spec EC-01–EC-13（[external-catalog-column-read](../../../../specs/lucy-20261113-external-catalog-column-read-spec.md)）与 P1-16 列库／列表替身。

### 步骤

跑 fixtures 中 vitest 命令（五文件）。再加 `server/__tests__/live-tables.test.ts`（列表路径，25 条）作为可选补充。

### 期望

全部 PASS，且下表每一行在输出里**逐条出现并通过**（用 `npx vitest run <file> -t "<用例名片段>" --reporter=verbose` 可单查）。缺任一行 → 整案 FAIL，不得以「总数全绿」代替。

| EC | 用例名片段（文件） |
|---|---|
| EC-01／09 | `describes one checked external table over the direct channel and preserves Chinese names`；`reads hive-1 dim.dim_bidding_block_ad_id_2025 without KTX or information_schema`（simulation） |
| EC-02／07 | 上两条中对 `runSqlImpl` 零调用、语句不含 `information_schema` 的断言（simulation） |
| EC-03 | `falls back to SHOW COLUMNS when DESC is rejected by the server`；`tries the next probe when a probe succeeds but maps to zero columns`（simulation） |
| EC-04 | `fails with the existing sentence after all three direct probes fail`（simulation） |
| EC-05 | `stops at the first probe for terminal failure`（4 例）；`stops after a probe that used up the deadline`（simulation） |
| EC-06／08 | `allows the exact three-part column probe`；`rejects statements outside the column probe grammar`；`redacts password and closes the connection on a column probe`；`closes a hung column probe at the deadline`（catalog-show） |
| EC-10 | `lists external table names without describing columns`；`lists external names with zero column counts without issuing any DESC`；`schema-structure.test.ts` 全部 |
| EC-11 | `rejects qualified information_schema and KTX SHOW like the customer runtime`（simulation，含 `Describe` 断言） |
| EC-12 | `serves the structure-diff per-table mode over the same direct channel`（simulation） |
| EC-13 | `logs every failed probe with its statement type and no password`（simulation） |

### 主张边界

本条 PASS ≠ 客户 SelectDB live PASS；不得据此把 EXT-01…05 写成 PASS。EC-11 的「替身对齐真实 KTX」只在 KTX-GUARD 也 PASS 时才成立。

---

## UAT-SCAN-KTX-GUARD — 真实 KTX 只读校验（防替身漂移）

对应错题 [2026-11-13-external-catalog-column-read-ktx-describe](../../../../lessons/2026-11-13-external-catalog-column-read-ktx-describe.md) 举一反三第 2 条。

### 前置

lucy 容器 healthy（`compose-lucy-1`，或设 `UAT_LUCY_CONTAINER`）。不需要 SelectDB，不需要凭据。

### 步骤

```bash
bash scripts/uat/verify-ktx-readonly-guard.sh
```

脚本在容器内调用 KTX 自带的 `validate_read_only_sql_response`，对 `mysql`／`starrocks`／`doris` 三个方言各跑 6 条语句。

### 期望

- 退出码 0，末行 `RESULT: PASS`
- `DESC`／`DESCRIBE`／`SHOW COLUMNS`／`SHOW TABLES`／`SHOW DATABASES` 全部被拒绝；`SELECT 1` 通过（共 18 行 `OK`）
- 输出含 KTX 版本行；**跑次必须原样记录**该版本号
- 退出码 1（`FAIL`）＝KTX 行为变了：先看 `BAD` 行，再回头核对 SIM 里 `ktx()` 替身与 P1-20 直连前提是否仍成立；不得因此改成「通过」
- 退出码 2（`BLOCKED`）＝容器未运行或找不到校验器：不是 PASS

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

## UAT-SCAN-EXT-01／02 — 外部目录列库／列表 live（可选）

### 前置

fixtures「可选外部目录 live」已填真实 `catalog.database` 连接；容器可达。

### 步骤

1. `GET .../live-schemas?refresh=1` → 库列表与 `tableCount>0`  
2. `GET .../live-tables?schema=<存在库>` → 表名非空  
3. 不得再以 `Unknown database '...information_schema'` 为唯一成功路径  

### 期望

与 P1-16 Spec 外部目录列库／列表分支一致；无凭据则整组 `SKIPPED`／`BLOCKED`（按 CONVENTIONS）。

---

## UAT-SCAN-EXT-03 — 外部目录单表读字段 live（P1-20 事故复现）

对应 P1-20 现场目标（非 EC 功能合同出口）。**P1-20 现场必验项**：没有它，只能主张替身合同，不能主张现场修复。

### 前置

- 已完成「跑前统一前置」三步（升级、记录构建标识、容器内源码自检）
- fixtures「可选外部目录 live」已填可从 lucy 容器访问的 `catalog.database` 连接（例 `hive-1`／`hive.dw` 或现场等价）  
- EXT-01／02 可先跑通（列表通）  
- 已知存在表 `T`（复现优先：Schema `dim` ＋ 表 `dim_bidding_block_ad_id_2025`）  

### 步骤

1. `GET .../live-tables?schema=<S>` → 表列表含 `T`  
2. `POST .../schema-structure`，body `{ "schema": "<S>", "tables": ["<T>"] }`  
3. （可选）WebUI：准备表结构 → 勾选该表 → 预览字段  
4. 无论成败都取日志：`docker logs compose-lucy-1 2>&1 | grep "schema-structure\] read failed"`，记录本次请求对应的行（成功时应为空）  

### 期望／判定

| 观察 | 判定 |
|---|---|
| 步骤 2：2xx，`namesOnly=false`，`columnCount>=1`，列清单含真实列名；响应与日志无凭据明文 | **PASS** |
| 失败，且日志里的探针错误是服务端返回（语句被拒、权限、表不存在、超时、连接失败） | **FAIL**。把「探针语句类型＋脱敏错误原文」写进跑次。这是新问题（不再是 KTX 拒绝），回流到 P1-20 |
| 失败，但日志里没有任何探针记录 | **FAIL**。说明请求没走到直连探针（容器代码不对或入口分支错），先回查跑前自检 |
| 无凭据／不可达 | `BLOCKED`（待委托人对 P1-20 EXT 降级**单独授权**）；若本用例已被明确标注可选，则 `SKIPPED`。**不得**用 vitest／CR 冒充 PASS |

### 清理

临时连接测后删除；不改生产 ACL／凭据文件内容。

---

## UAT-SCAN-EXT-04 — 外部目录中文表名单表字段 live

对应 EC-09 的 live 镜像。

### 前置

同 EXT-03；外部目录上存在中文表名（例替身场景 `日活明细`）。无中文表 → 本条 `SKIPPED`（不影响 EXT-03 判定）。

### 步骤

同 EXT-03，`tables: ["<中文表>"]`；同样取步骤 4 的日志。

### 期望／判定

| 观察 | 判定 |
|---|---|
| 2xx；`columnCount>=1`；列名与表名保留（非乱码／空）；响应与日志无密码 | **PASS** |
| 失败且日志有服务端探针错误 | **FAIL**，记录探针语句类型与错误原文（重点看反引号与编码） |
| 无中文表／无凭据 | `SKIPPED`／`BLOCKED` |

---

## UAT-SCAN-EXT-05 — 外部目录结构 diff／per-table 同通道 live（含缺表报错取证）

对应 EC-12 的 live 镜像，并**取证 SelectDB 对「外部目录缺表」的真实报错文本**。

背景：`table-structure-diff` 只有在直连探针被归为 `missing` 时才返回 `not_in_library`。归类靠 `schema-structure.ts` 的 `sqlFailureReason` 正则（`unknown table`／`doesn't exist`／`does not exist`／`table not found`）。SIM 只覆盖了 MySQL 风格文案，SelectDB 的真实文案未验证；若不在正则里，会先试满 3 条探针，再返回 `status=error`，而不是 `not_in_library`。

### 前置

同 EXT-03 连接；至少一张存在表 `T` ＋ 一张故意不存在的表名 `M`（fixtures `missingTableForDiff`）。

### 步骤

1. `GET /api/connections/<id>/table-structure-diff?schema=<S>&tables=<T>,<M>`  
2. 取日志：`docker logs compose-lucy-1 2>&1 | grep "schema-structure\] read failed"`，找到针对 `M` 的行，**原样记录 `stderr` 字段**（已脱敏）和探针次数  

### 期望／判定

| 观察 | 判定 |
|---|---|
| `T`：`status=ok` 且已读到字段；`M`：`status=not_in_library`；整次请求 2xx，未被打成通道失败；`M` 只有 1 条探针日志 | **PASS** |
| `M` 返回 `status=error`，且 `stderr` 是「表不存在」语义 | **FAIL（缺口已查明）**：把 `stderr` 原文回补进 `sqlFailureReason` 正则和 SIM 用例，登记后续动作；不得改判为 PASS |
| `T` 读不到字段 | **FAIL**，同 EXT-03 的处理 |
| 无凭据／不可达 | `BLOCKED`／`SKIPPED` |

### 清理

临时连接测后删除。
