# 外部目录单表读字段 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2** |
| 日期 / 目标版本 | 2026-11-13／不绑定产品版本号 |
| 功能编号 / 优先级 | **P1-20**／REQ-030-041／**P1**（事故续作）。**不入 0.30 核心分母** |
| 状态 | **v0.2；开发授权已获得（2026-11-13，委托人同句「批准修复」）；实现已落地（2026-11-13）**。vitest 5 文件 76/76。客户 SelectDB live 未验，UAT 未复跑。**不表示可上线** |
| 决策来源 | 2026-11-13 现场／测试反馈：`hive-1`＋Schema `dim` 在「准备表结构」侧边栏能列出全部表；选中 `dim_bidding_block_ad_id_2025` 提示「表「…」没有读到字段。」表侧确认有字段。服务端应用日志暂不可取；根因由 KTX 0.16.0 只读校验复现确认（§1.2） |
| 需求来源 | P1-16 收口后遗留：外部目录字段仍走 `ktx sql`＋`DESC`；与列名直连 `SHOW` 通道不一致 |
| 实施主体 | WebUI 服务端：`catalog-show`（直连适配器白名单）、`schema-structure.readCatalogTableColumns`／`previewSchemaStructure` |
| 授权 | 委托人同句「批准修复」＝终稿确权＋本条开发授权。授权边界同 Plan：只改外部目录**单表字段**直连读法与直连白名单 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **续作／修订** [库内扫表读法 Spec](lucy-20261111-catalog-scan-read-path-spec.md) 的 Follow-up 与 **SC-10**（原合同：外部目录字段 `DESC`＋`ktx sql`）。本条生效后，外部目录**单表字段读**以本 Spec 为准；P1-16 的列库／列表合同不变 |
| 实施计划 | [`docs/plans/lucy-20261113-external-catalog-column-read-plan.md`](../plans/lucy-20261113-external-catalog-column-read-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。外部目录单表字段改走与 `SHOW` 同一直连 MySQL 通道；探针顺序 `DESC` → `SHOW COLUMNS` → `DESCRIBE`；禁止 `information_schema`；不改问数／MCP |
| v0.2 | 审阅修订并实现：根因改为已验证（KTX 只读校验）；回退规则收紧为「仅服务端拒绝或 0 列才换下一条」；验收编号改 `EC-`；新增测试替身对齐真实 KTX（EC-11）、结构 diff 同通道（EC-12）、失败探针日志（EC-13）；补 Hive 注释缺失的已知局限；补伪代码、交互合同豁免与 Follow-up |

## 闭口层级

- 层级：功能合同
- 本条承诺：对 `database` 形如 `catalog.database` 的 MySQL／Doris／SelectDB 连接，在「准备表结构」**选中一张已存在的表**读取字段时，能返回该表非空字段列表（在直连探针任一成功且可映射的前提下）；失败时仍为现有「表「…」没有读到字段。」类文案（或既有 permission／timeout／too_large 专用句），且**不得**把 `SHOW`／`DESC`／`SHOW COLUMNS`／`DESCRIBE` 交给 `ktx sql`。
- 本条出口：EC-01–EC-13（本机 vitest 替身即可）。
- 不在本条出口：问数／MCP／KTX 语义层；客户环境 live 必过；整库逐表批量准备在网关时限内完成；Hive Metastore Kerberos／HDFS；浏览器测试；普通 MySQL（无点号）读字段路径；页面文案改版；Hive 字段注释。
- 上线关系：本条收口不表示可上线；不等于客户 SelectDB live 已验。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

沿用「准备表结构」「没有读到字段」等既有用户可见句；本条不新增页面文案（复用既有 `rejectionMessage`）。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 不新增页面、按钮、颜色或间距
- [x] 只改服务端读字段通道
- [x] 不新增用户可见错误文案族（沿用现有 rejection 句）

### Exceptions (If Any)

- None

### Follow-up Needed

- 外部目录字段注释：`DESC`／`SHOW COLUMNS` 不返回 Hive 字段注释，Manifest 里 `comment` 为空串。是否另开读注释通道，另立条目，不在本条。
- 整库勾选数百表时逐表新建连接的总耗时：另计，不在本条。

## 交互合同豁免

- 原因：本条只改服务端读字段通道，不改变用户可见 WebUI 表面
- 不改变：页面路由、组件、按钮、文案与布局；`POST /api/connections/:id/schema-structure` 的请求与响应字段含义

## 1. 问题陈述

### 1.1 已证实

| 观察 | 含义 |
|---|---|
| `hive-1`、Schema `dim` 能列出全部表 | P1-16 直连 `SHOW TABLES` 生效 |
| 选中单表后提示「表某某某没有读到字段。」 | `previewSchemaStructure` 在 `tables: [one]` 时对外部目录走 `readCatalogTableColumns` → `ktx sql`＋`DESC`，被拒后归为 `unreadable`，文案落到 `default` 分支 |
| 表确定有字段 | 不是空表；失败在 Lucy 读路径 |
| 在 KTX 0.16.0 容器内用其自带 `validate_read_only_sql_response` 复现（2026-11-13） | `DESC`／`DESCRIBE` → `SQL contains read/write operation: Describe`；`SHOW COLUMNS FROM a.b.c`／`SHOW TABLES FROM a.b` → `Invalid expression`；`SELECT 1` 通过。`mysql`／`starrocks`／`doris` 三个方言结果一致 |

### 1.2 根因（合同＋代码＋KTX 源码对齐）

| 层 | 事实 |
|---|---|
| KTX | `ktx_daemon/sql_analysis.py` 要求根节点是 `exp.Select` 或 `exp.Union`；`exp.Describe`、`exp.Show` 在禁止列表。所以 `ktx sql` 里的 `DESC` 在到达 SelectDB 之前就被挡掉 |
| 合同 | P1-16 SC-10：外部目录字段「仍是 `DESC`，并走 `ktx sql`」；整库逐表 DESC 不在出口 |
| 代码 | 修复前 `readCatalogTableColumns` 仅 `execute(... describeCatalogTableSql ...)`（`runSql`） |
| 历史 | 2026-11-10 `e1c4d36e` 曾经 KTX 做 `SHOW FULL COLUMNS` → `SHOW COLUMNS` → `DESCRIBE` 回退；`SHOW*` 与 `DESC*` 同样进不了 `ktx sql`。列名后来改直连，字段没改 |
| 测试 | 旧模拟测试的 `ktx()` 替身对 `DESC` 返回字段，与真实 KTX 不符，所以 P1-16 SC-10 的测试是绿的而现场是红的 |
| 可观测 | 所有失败都归为 `unreadable`，同一句「没有读到字段」，现场看不出是 KTX 拒绝、权限、超时还是真的没有表 |

**结论：** 列名与字段通道分裂；字段依赖 KTX 的 `DESC`，而 KTX 禁止该语句。修复＝字段探针与列名共用直连 MySQL，并恢复多语句回退（不经 KTX）。

## 2. 目标

1. 外部目录单表读字段：**直连 MySQL**（复用 `runCatalogShow` 凭据与超时／关连接／脱敏纪律）。
2. 探针顺序：`DESC` → `SHOW COLUMNS FROM` → `DESCRIBE`，均为三段名 `` `catalog`.`schema`.`table` ``。
3. **回退规则（只为不白白消耗时限）：**

   | 上一条的结果 | 动作 |
   |---|---|
   | 成功且映射出 ≥1 列 | 返回，不再试 |
   | 服务端拒绝（语法／不支持类），或成功但映射后 0 列 | 试下一条 |
   | 超时、权限、表不存在、超过读取上限、连接失败 | **立即**返回对应 rejection，不回退 |

4. 全部探针失败 → 现有 rejection 文案。
5. `runSql`／`ktx sql` 的调用参数中**不得**出现字段探针 SQL（外部目录分支）。
6. **禁止**外部目录字段成功路径使用 `information_schema`。
7. 每个失败探针经既有 `logSchemaStructureFailure` 记录探针语句与脱敏后的错误；用户可见文案不变。
8. 无点号 MySQL／Postgres 读字段路径不变；问数／MCP 不变；不改 KTX 源码。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 修改 KTX 或放行 `ktx sql` 的 `SHOW`／`DESC` | 与 P1-16 同一约束 |
| 把字段探针交回 `ktx sql` | KTX 0.16.0 只读校验禁止，见 §1.2 |
| 外部目录 Schema 宽一次读全库字段 | 无可用 `information_schema`；整库逐表仍另计 |
| 改问数、语义、MCP、页面布局 | 事故面只在准备表结构单表字段 |
| 读取 Hive 字段注释 | `DESC`／`SHOW COLUMNS` 不含注释，见 Follow-up Needed |
| 客户 live 必过作为本条出口 | 功能合同以替身为准；live 归 UAT／发布取证 |
| 承诺整库勾选数百表一次点完不超时 | 仍逐表请求；本条只保证**单表**通道正确 |

## 4. 设计

### 4.1 直连语句白名单扩展

`runCatalogShow` 原本只允许 `SHOW DATABASES FROM` 与 `SHOW TABLES FROM`。本条在同一适配器、同一正则里，另允许且**仅**允许三段名：

- `DESC \`catalog\`.\`schema\`.\`table\``
- `SHOW COLUMNS FROM \`catalog\`.\`schema\`.\`table\``
- `DESCRIBE \`catalog\`.\`schema\`.\`table\``

仍强制：`multipleStatements: false`；握手不传默认 `database`；`file:` 密码；120s 超时；成功／失败关连接；错误脱敏。`SHOW FULL COLUMNS`、两段名、未加引号名、`ALL` 后缀、注释与分号一律拒绝。

### 4.2 映射

三种探针返回同一形状（`Field`／`Type`／`Null`／`Key`…），统一用现有 `mapDescribeColumn`，不新增 `mapShowColumn`。中文表名／列名沿用 `quoteMysqlIdent`，不被破坏。

### 4.3 调用点

| 入口 | 行为 |
|---|---|
| `POST /api/connections/:id/schema-structure` 带 `tables: [one]` | 外部目录 → 直连多探针 |
| `readCheckedTableColumns`（前端逐表） | 间接受益，无需改 UI |
| `admin/live-discovery`（Spec 190 结构 diff，`per-table`） | 经同一 `readSchemaColumns` 同样走直连；EC-12 覆盖 |
| 无 `tables` 的 list-names | 仍只 `SHOW TABLES`（P1-16），不读字段 |

每次探针新建并关闭一条连接；表很多时耗时随表数线性增长，属已知代价（Follow-up Needed）。

### 4.4 与 P1-16 SC-10

| 原 SC-10 | 本条生效后 |
|---|---|
| 外部目录字段语句是 `DESC`，走 `ktx sql` | **废止为外部目录字段合同**；改为本 Spec EC-01–EC-06 |
| P1-16 列库／列表 SC | **保持** |

本 Spec 的验收编号用 `EC-` 前缀，避免与 P1-16 的 `SC-` 编号混淆。

## 核心流程（伪代码）

```
readCatalogTableColumns(conn, catalog, schema, table):
  reason = unreadable
  for sql in [DESC c.s.t, SHOW COLUMNS FROM c.s.t, DESCRIBE c.s.t]:
    result = runCatalogShow(sql)                    # 直连，不经 ktx sql
    if result failed:
      reason = classify(result)                     # permission|missing|timeout|too_large|unreadable
      log(probe sql, redacted error)
      if reason != unreadable or connection failure: break   # 终止类失败，不回退
      continue                                      # 服务端拒绝：试下一条
    columns = map(result.rows)
    if columns not empty: return columns
    reason = unreadable; log(probe sql, "no mappable columns")
  return rejection(table, reason)
```

## 5. 验收（EC）

| ID | 通过标准 | 证据 |
|---|---|---|
| EC-01 | 外部目录＋`tables: [已知表]`，直连 `DESC` 成功替身 → preview 含 ≥1 字段，且含 `hive-1`／`dim.dim_bidding_block_ad_id_2025` | vitest |
| EC-02 | 同上路径中 `runSqlImpl` **未被调用** | vitest |
| EC-03 | `DESC` 被服务端拒绝、`SHOW COLUMNS` 成功 → 返回字段，尝试顺序为 `DESC`→`SHOW COLUMNS`；前两条 0 列、`DESCRIBE` 有列也能返回 | vitest |
| EC-04 | 三探针皆失败 → `READ_FAILED` 且 message 为「表「…」没有读到字段。」，共 3 次尝试 | vitest |
| EC-05 | 权限、表不存在、连接失败、超过读取上限、超时：只尝试 1 次，文案分别为 permission／默认／默认／too_large／timeout 句 | vitest |
| EC-06 | 直连白名单放行三段名 `DESC`／`SHOW COLUMNS`／`DESCRIBE`（含中文名与反引号转义）；拒绝 `SELECT`、`information_schema`、两段名、`SHOW FULL COLUMNS`、分号、注释、`ALL` 后缀 | vitest |
| EC-07 | 外部目录成功路径 SQL 不含 `information_schema` | vitest |
| EC-08 | 密码不入字段探针的结果与错误；失败／超时都关连接 | vitest |
| EC-09 | 中文表名：`` DESC `hive_jd`.`app`.`日活明细` `` 经直连替身仍保留列名 | vitest |
| EC-10 | 无点号 MySQL 单表／schema-wide 既有测试保持绿；列表-only（无 tables）仍不发字段探针 | vitest |
| EC-11 | 测试替身 `ktx()` 对 `DESC`／`DESCRIBE`／`SHOW` 一律返回 `read/write operation`，与 KTX 0.16.0 一致 | vitest |
| EC-12 | 结构 diff 的 `per-table` 读法对外部目录同样走直连，`runSqlImpl` 未被调用 | vitest |
| EC-13 | 每个失败探针都有一条 `[schema-structure] read failed` 日志，带探针语句，且不含密码 | vitest |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 直连 `DESC` 在部分 SelectDB 版本或某些 Hive 表仍失败 | 多探针回退；失败保持诚实文案；EC-13 日志留下真实原因 |
| 扩大白名单被误用发任意 SQL | 严格正则；EC-06 打假 |
| 与 P1-16 SC-10 文档漂移 | 本 Spec 显式废止字段侧 SC-10；清单互指 |
| 客户 live 仍 BLOCKED | 出口不依赖 live；授权后可选补 EXT 字段用例 |
| 逐表新建连接，整库批量耗时线性 | 本条只保证单表；已入 Follow-up Needed |
| 测试替身再次与真实 KTX 漂移 | EC-11 固化真实拒绝形态 |

## 7. 诚实主张

| 可以 | 不可以 |
|---|---|
| 方案解决「列表通、单表字段不通」的通道分裂 | 宣称客户现场已验／可上线 |
| 替身证明合同；KTX 拒绝行为已在 0.16.0 容器内复现 | 宣称 Hive 字段注释已读出 |

---

**下一步：** 本机 `npm run demo:upgrade` 让容器内代码生效（由委托人决定是否执行）；客户环境复测归测试台。
