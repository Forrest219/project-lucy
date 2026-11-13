# 大小写歧义与结构差异缺表修复计划

| 元数据 | 内容 |
|---|---|
| 状态 | **Task 1–4 已执行（2026-11-13）**。歧义单测已加；demo 已升级；`UAT-SCAN-CASE-01`／`DIFF-01` 复跑 **PASS**。Task 5 未触发。EXT live 仍 BLOCKED。**≠ 可上线** |
| 证据 | [跑次](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-case-diff.md) |
| 已落地读法 | [`aa559a1c`](../../) `fix(webui): restore per-table structure-diff reads beside schema-wide`。双模式说明见 [schema-read-dual-mode plan](lucy-20261113-schema-read-dual-mode-plan.md) |
| 总账 | P1-16／REQ-030-037 的本机补测，不新开清单行 |
| 上线关系 | 复跑通过不表示可上线，也不关闭外部目录 live |

**Goal:** 请求一张表的字段时，若库里有两张仅大小写不同的物理表，拒绝并说明对应多张表；结构差异里，真不存在的表记 `not_in_library`，同一次请求里已经读到的表保持 `ok`。

**Architecture:** 失败发生在 demo 镜像 `ea4ef839`。那一版把单表预览也放进 Schema 宽的 `information_schema.columns`，再按小写表名过滤，于是 `Foo` 和 `foo` 的列被合成一份，不存在的表变成 `unreadable`，结构差异把它写成 `QUERY_FAILED`。工作区 `aa559a1c` 已把「带 `tables` 的预览」和 `table-structure-diff` 改到 `per-table`：先用 `LOWER(table_name)` 找出物理表，多于一张则 `ambiguous`，零张则 `missing`。修复顺序是锁住还没有的歧义单测、把这版读法装进 demo、复跑这两条 UAT。升级后仍失败才改 SQL 或拒绝映射。

**Tech Stack:** 现有 Vitest。Demo 用 `npm run demo:upgrade`，保留 `lucy-demo-data`。

## Global Constraints

- 不改 KTX 源码，不把 `SHOW` 交给 `ktx sql`
- 不改 `mode: "schema-wide"` 的全量字段读法，不改 SC-06／07 的 10000 行 fail-closed
- 外部目录 live `SHOW` 不在本计划
- 密码不得进入错误文本、日志、UAT 跑次
- 复跑不得靠 `docker restart` 变绿
- 普通 MySQL 宽库「只列表名」和 5.7／8.0／8.4 矩阵不回退

## 1. 失败是怎么走出来的

镜像 `gitSha=ea4ef839`。库 `uat_case_pair` 里有 `Foo`、`foo`、`only_one`。连接 `uat-case-mwep648v`，`executionRuntimeAck=true`。

| 请求 | 实测 | 旧读法为什么会这样 |
|---|---|---|
| `POST .../schema-structure` `{ schema, tables: ["Foo"] }` | 200，`tableCount=2`，`columnCount=4`，`namesOnly=false` | Schema 宽结果里 `Foo` 与 `foo` 的小写都是 `foo`，过滤把两张表的 `id`＋`label` 合成 4 列 |
| `POST` `{ tables: ["only_one"] }` | 200，`columnCount=1` | 只有一张物理表，小写过滤碰巧正确。这条对照是绿的 |
| `GET .../table-structure-diff?tables=only_one,missing_tbl` | `only_one=ok`；`missing_tbl=error`／`QUERY_FAILED` | 宽结果里没有 `missing_tbl`。旧代码在非 `per-table` 时把「没滤到列」标成 `unreadable`。`structureDiffFailureReason` 把 `unreadable` 收成 `QUERY_FAILED` |

期望不变：

- `Foo`：400，`code=READ_FAILED`，文案含「对应多张表」，响应里没有字段列表
- `only_one`：结构差异 `status=ok`
- `missing_tbl`：`status=not_in_library`，不得是 `QUERY_FAILED`

## 2. 工作区里已经有的修法

`previewSchemaStructure` 在调用方传入 `tables` 且未指定 mode 时，`resolveSchemaReadMode` 走 `per-table`。`handleTableStructureDiff` 显式传 `mode: "per-table"`。

`readMysqlTableColumns`（`webui/server/schema-structure.ts`）：

1. `SELECT table_name ... AND LOWER(table_name) = '<请求的小写名>'`
2. `distinctPhysicalNames` 按原始表名去重
3. 多于 1 个名字 → `{ reason: "ambiguous" }`，不再查列
4. 0 个名字 → `{ reason: "missing" }`
5. 恰好 1 个名字 → 用这个原始名字查 `information_schema.columns`

预览把 `ambiguous` 翻成「表名「Foo」对应多张表，无法读取字段。」结构差异对 `reason !== "missing"` 才记 `QUERY_FAILED`；`missing` 或零列走 `not_in_library`。

已有单测：

- `schema-structure.test.ts`：「reads a checked table with per-table MySQL queries」锁的是一张表两次查询
- 同文件：「resolves a checked table case-insensitively」锁的是只返回 `ledger` 一行时，请求 `Ledger` 仍成功
- 同文件：「rejects a checked table that is missing」锁的是 0 行 → 预览失败
- `table-diff.test.ts`：「reports a truly missing table as not_in_library」是注入替身，不是这次的 live MySQL

还没有的单测：`LOWER` 匹配同时返回 `Foo` 和 `foo` 时，预览必须拒绝，且第二次列查询不得发出。

## 3. 文件

| 文件 | 这一步做什么 |
|---|---|
| `webui/server/__tests__/schema-structure.test.ts` | 补歧义拒绝。沿用现有 `runSqlImpl` 注入，不要开网络 |
| `webui/server/__tests__/table-diff.test.ts` | 只复跑，不把 `QUERY_FAILED` 改成期望 |
| `webui/server/schema-structure.ts` | Task 5 才改。默认不动 |
| `webui/server/admin/live-discovery.ts` | Task 5 才改。默认不动 |
| demo 容器 | `npm run demo:upgrade`，不 `--fresh`，不 `--no-cache` |
| `scripts/uat/run-zhaomin-local-gaps.mjs` | 复跑 `case`。脚本已会建 `Foo`／`foo`／`only_one` 并删除库 |
| `docs/qa/uat/INDEX.md`、`docs/governance/e2e-ledger.md`、新跑次 | 仅当复跑结果出来之后改最近跑次 |

## 4. 任务

### Task 1: 补上大小写歧义单测

- [x] 已加入「rejects a checked table when two physical tables differ only by case」
- [x] `schema-structure.test.ts` 与 `table-diff.test.ts` 同批 23 passed

在 `previewSchemaStructure` 的 describe 里加一条，注入执行器：

- SQL 含 `LOWER(table_name) = 'foo'` 时返回两行：`[["Foo"], ["foo"]]`
- 含 `information_schema.columns` 时返回失败。这条若被调用，测试必须失败
- 调用 `previewSchemaStructure(..., { tables: ["Foo"] })`
- 期望抛 `READ_FAILED`，`message` 含「对应多张表」
- `runSqlImpl` 只被调用 1 次

对照不用新写：现有「case-insensitively」那条继续保证「只有一张物理表时仍成功」。

```bash
cd webui && npx vitest run server/__tests__/schema-structure.test.ts
```

这条测试描述的是已经写在 `readMysqlTableColumns` 里的行为。它应当直接通过。若失败，停在 Task 5，不要为了让测试绿去放宽文案。

### Task 2: 复跑缺表分类单测

- [x] `table-diff.test.ts` 通过；缺表断言仍是 `not_in_library`

```bash
cd webui && npx vitest run server/__tests__/table-diff.test.ts
```

必须仍有：已读表 `status=ok`，真缺表 `status=not_in_library`。不要改断言去接受 `QUERY_FAILED`。

### Task 3: 把这版读法装进正在跑的 demo

- [x] `BUILDPLATFORM=linux/arm64 npm run demo:upgrade`，volume 保留
- [x] health `gitSha=3aa402c9`，`aa559a1c` 为其祖先；WebUI `http://127.0.0.1:55176`

```bash
npm run demo:upgrade
```

然后：

```bash
curl -sS http://127.0.0.1:55176/api/health
```

`gitSha` 必须是升级后的工作区 tip，并且 `git merge-base --is-ancestor aa559a1c <gitSha>` 成立。回复里写实际 WebUI 地址，默认 `http://127.0.0.1:55176`，以这次映射为准。

不要 `--fresh`。不要为了复跑去 `docker restart`。

### Task 4: 只复跑失败的两条

- [x] `caseVerdict=PASS`，`diffVerdict=PASS`。跑次 [2026-11-13-cursor-case-diff-rerun](../qa/uat/suites/catalog-scan-read-path/runs/2026-11-13-cursor-case-diff-rerun.md)

```bash
node scripts/uat/run-zhaomin-local-gaps.mjs case
```

通过标准：

| 字段 | 通过 |
|---|---|
| `caseVerdict` | `PASS` |
| `diffVerdict` | `PASS` |
| `ambiguous.status` | 400 |
| `ambiguous.message` | 含「对应多张表」 |
| `ambiguous.columnCount` | `null`（没有字段列表） |
| `diff.onlyOne` | `ok` |
| `diff.missing` | `not_in_library` |
| `residual` | 0 |

新跑次写到 `docs/qa/uat/suites/catalog-scan-read-path/runs/YYYY-MM-DD-cursor-case-diff-rerun.md`。两条都过，才把 INDEX 里扫表套件从 **FAIL** 改成「CASE-01／DIFF-01 PASS；矩阵仍 PASS；EXT live 仍 BLOCKED」。EXT live 不因这次复跑改成 PASS。

`e2e-ledger.md` 的 P1-16 最近跑次改到新文件。

### Task 5: 升级后仍失败才改运行代码

- [x] 未触发。升级后复跑已 PASS，未改 `schema-structure.ts`／`live-discovery.ts`。

先看容器里的语句，不要猜。

**`Foo` 仍是 200**

1. 确认预览请求确实进了 `per-table`。若仍是一条没有 `LOWER(table_name)`、没有 `table_name =` 的宽 `columns` 查询，接线断了：`POST /schema-structure` 必须把 `tables` 传进 `previewSchemaStructure`。
2. 若匹配 SQL 已发出，但 `distinctPhysicalNames` 只看到一个名字：驱动把 `Foo`／`foo` 折成同一字符串。去重必须保留两种写法；折成一个名字时不得当成「唯一物理表」成功返回。
3. 匹配返回两行却仍去查了列：`physical.length > 1` 必须在列查询之前返回。

**缺表仍是 `QUERY_FAILED`**

1. 匹配 SQL 应返回 0 行且 `ok=true`。这会走 `reason: "missing"`，结构差异应是 `not_in_library`。
2. 若语句本身失败：`sqlFailureReason` 只在 stderr／stdout 含 `unknown table`／`doesn't exist`／`does not exist`／`table not found` 时给 `missing`。`information_schema` 对没有的表应当是 0 行，不应当是语句错误。若 live 走了错误文本且文案不在这组里，补这一条真实文案到 `missing`，不要把所有 `unreadable` 都改成 `not_in_library`。
3. 同一次响应里 `only_one` 必须仍是 `ok`。修缺表不得把成功表改成错误。

改完重复 Task 1、Task 2、Task 4。

## 5. 不做

- 不重跑外部目录 live，不把 vitest 替身写成 EXT PASS
- 不改连接热重载闸门和 503 路径（交叉复跑已 PASS）
- 不把「零列基表」造进 MySQL；那条继续不在本机 UAT
- 不改宽库 `namesOnly` 的表名清单语句
- 不把结构差异改回 Schema 宽过滤

## 6. 验收

1. Task 1、Task 2 的 vitest 通过。
2. demo health 的 `gitSha` 含 `aa559a1c`。
3. `run-zhaomin-local-gaps.mjs case` 的 `caseVerdict` 与 `diffVerdict` 都是 `PASS`。
4. 测后没有 `uat-case-` 连接残留，`uat_case_pair` 已删除。
5. INDEX 与 `e2e-ledger.md` 的最近跑次指向新文件；EXT live 仍是 BLOCKED。
