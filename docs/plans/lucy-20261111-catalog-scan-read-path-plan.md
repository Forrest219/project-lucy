# 库内扫表读法 Implementation Plan

| 元数据 | 内容 |
|---|---|
| 状态 | **功能合同已收口（2026-11-13）**（SC-01–SC-14 证据关闭）。本条收口不表示可上线 |
| 主 Spec | [`docs/specs/lucy-20261111-catalog-scan-read-path-spec.md`](../specs/lucy-20261111-catalog-scan-read-path-spec.md) **v0.3** |
| 授权边界 | 只改外部目录列库、列表的语句和传输，以及普通 MySQL 准备表结构的字段查询次数。不改 KTX，不把 `SHOW` 交给 `ktx sql`，不改问数，不改无点号库名的库内表清单 SQL，不改页面文案，不做浏览器测试 |
| 验收 | Spec SC-01–SC-14 |


**Progress (2026-11-13 · 中间态出口)：** 功能合同已收口；任务勾选与 Spec／[证据审计](../reviews/2026-11-13-catalog-scan-read-path-sc-evidence-audit.md) 对齐。**不入 0.30 产品分母**（现场事故修复；功能编号无）。**≠ 可上线**。
**Goal:** 外部目录的库内表清单由 Lucy 直连执行已验证的 `SHOW`，每个库的张数等于该库 `SHOW TABLES` 的行数；普通 MySQL 的准备表结构一次读完字段。

**Architecture:** `database` 含一个点时走新的直连 MySQL 执行器，只允许 `SHOW DATABASES` 与 `SHOW TABLES`。执行器从 `ktx.yaml` 读取 `host`、`port`、`username` 和 `file:` 密码，握手不传默认库，连接与单条语句各 120 秒超时（与 `CATALOG_SCAN_TIMEOUT_MS`／`ktx sql` 默认一致），结束时关闭连接。其余语句仍进 `runSql` / `ktx sql`。普通 MySQL 的准备表结构字段改为一条 `information_schema.columns`。

**Tech Stack:** 现有 Vitest。列库、列表仍可注入执行器。生产适配器的测试在驱动工厂注入替身，不打开网络。密码沿用 `safeReadSecretPasswordBytesIfExists`，不新增密钥落点。

## Global Constraints

- 不修改 KTX 源码，不升级 KTX
- `runSql` 的参数中不得出现 `SHOW`
- 外部目录失败不得回退到 `information_schema`
- 字段达到 `10000` 行不得截断，不得改回逐表查询
- 密码不得进入错误文本、日志、审计和测试快照
- `chatbi`、`jipaas_poc` 保持原库内表清单语句

## 1. 目标

1. 落地 Spec v0.1 的两条读法。
2. 关闭 SC-01–SC-14。
3. 现有无点号 MySQL、Postgres 的库内表清单测试保持通过。

## 2. 开工前置

| ID | 条件 | 状态 |
|---|---|---|
| P1 | Spec v0.1 与本 Plan 经确认后开工 | 已确认并收口 |
| P2 | 现场语句已记录在 Spec §1 | 满足 |
| P3 | 不要求客户环境作为本条出口 | 满足 |

## 3. 文件地图

| 文件 | 职责 | SC |
|---|---|---|
| `webui/server/catalog-show.ts` | 新建。从 `ktx.yaml` 解析直连参数，执行 `SHOW DATABASES` / `SHOW TABLES`。握手无默认库。连接与语句各 120 秒超时。成功和失败都关闭连接。错误不含密码 | SC-01／02／04／08／09／13／14 |
| `webui/server/__tests__/catalog-show.test.ts` | 驱动工厂替身。覆盖 `file:` 读取、握手参数、`inline`／`env` 不连接、密码剥离、超时关闭 | SC-13／14 |
| `webui/server/catalog-database.ts` | 生成 `SHOW` 语句。保留 `DESC` 语句。外部目录不再生成 `information_schema` 作为成功路径 | SC-01／02／03／10 |
| `webui/server/live-catalog.ts` | 外部目录列库改调用直连。`tableCount` 来自 `SHOW TABLES` 行数。删除 `countExternalCatalogTables` 的 `ktx sql` 计数 | SC-01／11／12 |
| `webui/server/live-tables.ts` | 外部目录列表改调用直连。无点号分支不改 SQL | SC-02／05／11 |
| `webui/server/schema-structure.ts` | 外部目录表名改用同一条 `SHOW`。普通 MySQL 字段改为一次查询 | SC-06／07／10 |
| `webui/server/__tests__/doris-external-catalog.simulation.test.ts` | 替身改为：带目录 `information_schema` 失败，`SHOW` 成功，且 `SHOW` 不进入 `runSql` | SC-03／04 |
| `webui/package.json` | 仅当仓库尚无 MySQL 协议依赖时加入运行时依赖 | SC-08 |

不改 `webui/src` 页面组件。不改 `ktx` 调用的问数路径。

## 4. 任务

### Task 1: 替身与失败断言

- [x] 重写外部目录模拟：`hive.information_schema` 与 `hive_jd.information_schema` 返回 `Unknown database 'default_cluster:information_schema'`
- [x] `SHOW DATABASES FROM hive` 返回含 `dim`、`dw` 的库名。`SHOW TABLES FROM hive.dim`、`hive.dw`、`hive_jd.app` 的行数分别为 44、129、169
- [x] 断言 `listLiveSchemas` 的完整返回值与这些行数一致，不得为 0，也不得保留旧模拟的 `app=3`、`dw=2`
- [x] 断言 `runSql` 记录的 SQL 不含 `SHOW`，也不含外部目录 `information_schema` 计数语句

### Task 2: 直连执行器

- [x] 生产适配器从该连接的 `ktx.yaml` 读取 `host`、`port`、`username`，并用 `password` 的 `file:` 相对路径调用 `safeReadSecretPasswordBytesIfExists`
- [x] 测试替换驱动工厂，不替换整个执行器，也不打开网络
- [x] 握手参数不含 `database`。缺文件、`inline`、`env` 在调用驱动前失败
- [x] 连接超时与单条语句超时都是 120 秒。成功、认证失败、查询异常、语句挂起都关闭连接
- [x] 失败原文交给现有 `classifyLiveTableFailure` 之前去掉密码字节

### Task 3: 接上列库与列表

- [x] `listLiveSchemas` 与 `readLiveTables` 在外部目录分支调用 Task 2
- [x] `listLiveSchemas` 对每个非系统库调用 `SHOW TABLES`，`tableCount` 等于行数。任一库失败则整次列库失败
- [x] 删除 `countExternalCatalogTables` 经由 `runSql` 查询 `information_schema` 的实现
- [x] 列表只取首列，字段个数保持 0
- [x] 无点号连接的 SQL 字符串与改前快照一致

### Task 4: 准备表结构

- [x] 外部目录的表名来自 Task 2 的 `SHOW TABLES`
- [x] 已知表名后的字段语句保持 `DESC`，调用 `runSql`
- [x] 普通 MySQL 用一条带 `table_schema` 条件的 `information_schema.columns`。表名查询若保留，全局至多一次
- [x] 删除按表名循环调用 `information_schema.columns` 的路径
- [x] 行数达到 `10000` 时走现有超限失败

### Task 5: 文档镜像

- [x] 开工、收口时用同一句更新 Spec 头部、Plan 头部、`docs/README.md`、`docs/plans/README.md`
- [x] 本轮草案不写收口记录

## 5. 验收

从仓库根执行：

```bash
set -e
( cd webui && npx vitest run \
  server/__tests__/doris-external-catalog.simulation.test.ts \
  server/__tests__/catalog-show.test.ts \
  server/__tests__/live-tables.test.ts \
  server/__tests__/schema-structure.test.ts )
npm run lint:spec-docs
```

若 Task 4 改到普通 MySQL 列清单以外的文件，再补跑该文件已有的相邻测试。浏览器测试不在本条出口。

## 6. 完成定义

- Task 1–4 勾销，SC-01–SC-14 有通过记录
- `runSql` 测试双里没有 `SHOW`
- 无点号 MySQL 的库内表清单 SQL 未被改写
- 本条收口不表示可上线

## 7. 风险

| 风险 | 缓解 |
|---|---|
| 直连把 `hive.dw` 当成默认库，握手失败 | SC-08、SC-13：握手不传该库名，并由驱动替身断言参数 |
| 只替换整个执行器，生产适配器未被测试 | SC-13：测试替换驱动工厂，适配器仍解析 `ktx.yaml` 与 `file:` |
| 密码进入错误字符串 | SC-09、SC-13：夹具断言密码片段不出现 |
| 列库把没有第二列的结果写成 0 张表 | SC-12：`tableCount` 等于 `SHOW TABLES` 行数，失败则整次失败 |
| 查询挂起后连接不关闭 | SC-14：120 秒超时，四条路径都关闭连接 |
| 再次用模拟器把 `information_schema` 写成成功 | SC-03：该语句必须失败 |
| 字段超过 10000 行后悄悄退回逐表查询 | SC-07：超限即失败 |
| `tblu.tblu` 的 789 张表继续逐表查询 | Task 4 删除按表循环。表清单接口保持现有一次查询 |
| 外部目录逐表 `DESC` 仍超过网关时间 | 不纳入本条出口。表清单单独成立 |
| 依赖加入后镜像变大 | 只加协议库，不改问数运行时 |

## 8. Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿。待确认后按 Task 1–5 开工 |
| v0.2 | 补齐每库表数、生产适配器的驱动替身测试、30 秒超时与连接关闭。同日按 Task 1–4 改代码，本机单测通过，尚未出客户镜像 |
| v0.3 | 超时口径与 Spec 对齐为 120 秒（`CATALOG_SCAN_TIMEOUT_MS`）。普通 MySQL 准备表结构恢复 Schema 宽一条 columns、10000 fail-closed。功能合同收口；本条收口不表示可上线 |
