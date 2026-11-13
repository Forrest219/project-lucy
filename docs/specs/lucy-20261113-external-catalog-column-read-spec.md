# 外部目录单表读字段 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.1-draft** |
| 日期 / 目标版本 | 2026-11-13／不绑定产品版本号 |
| 功能编号 / 优先级 | **P1-20**／REQ-030-041／**P1**（事故续作）。**不入 0.30 核心分母** |
| 状态 | **方案已落盘（v0.1-draft）**。待终稿确权与委托人**开发授权**后改运行代码。本条收口不表示可上线 |
| 决策来源 | 2026-11-13 现场／测试反馈：`hive-1`＋Schema `dim` 在「准备表结构」侧边栏能列出全部表；选中单表后提示「表某某某没有读到字段。」表侧确认有字段。服务端应用日志暂不可取 |
| 需求来源 | P1-16 收口后遗留：外部目录字段仍走 `ktx sql`＋`DESC`；与列名直连 `SHOW` 通道不一致 |
| 实施主体 | WebUI 服务端：`catalog-show`（或等价直连适配器）、`schema-structure.readCatalogTableColumns`／`previewSchemaStructure` |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **续作／修订** [库内扫表读法 Spec](lucy-20261111-catalog-scan-read-path-spec.md) 的 Follow-up 与 **SC-10**（原合同：外部目录字段 `DESC`＋`ktx sql`）。本条生效并收口后，外部目录**单表字段读**以本 Spec 为准；P1-16 的列库／列表合同不变 |
| 实施计划 | [`docs/plans/lucy-20261113-external-catalog-column-read-plan.md`](../plans/lucy-20261113-external-catalog-column-read-plan.md) |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1-draft | 初稿。外部目录单表字段改走与 `SHOW` 同一直连 MySQL 通道；探针顺序 `DESC` → `SHOW COLUMNS` → `DESCRIBE`；禁止 `information_schema`；不改问数／MCP |

## 闭口层级

- 层级：功能合同
- 本条承诺：对 `database` 形如 `catalog.database` 的 MySQL／Doris／SelectDB 连接，在「准备表结构」**选中一张已存在的表**读取字段时，能返回该表非空字段列表（在直连探针任一成功且可映射的前提下）；失败时仍为现有「表「…」没有读到字段。」类文案（或既有 permission／timeout 专用句），且**不得**把 `SHOW`／`DESC`／`SHOW COLUMNS`／`DESCRIBE` 交给 `ktx sql`。
- 本条出口：SC-01–SC-10（本机 vitest 替身即可）。
- 不在本条出口：问数／MCP／KTX 语义层；客户环境 live 必过；整库逐表批量准备在网关时限内完成；Hive Metastore Kerberos／HDFS；浏览器测试；普通 MySQL（无点号）读字段路径；页面文案改版。
- 上线关系：本条收口不表示可上线；不等于客户 SelectDB live 已验。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms: None.

沿用「准备表结构」「没有读到字段」等既有用户可见句；本条不新增页面文案（除非复用既有 `rejectionMessage`）。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 不新增页面、按钮、颜色或间距
- [ ] 只改服务端读字段通道
- [ ] 不新增用户可见错误文案族（沿用现有 rejection 句）

### Exceptions (If Any)

- None

## 1. 问题陈述

### 1.1 已证实

| 观察 | 含义 |
|---|---|
| `hive-1`、Schema `dim` 能列出全部表 | P1-16 直连 `SHOW TABLES` 生效 |
| 选中单表后提示「表某某某没有读到字段。」 | `previewSchemaStructure` 在 `tables: [one]` 时对外部目录走 `readCatalogTableColumns` → `ktx sql`＋`DESC`，得到 `unreadable`／`missing` 类 rejection（非 timeout／permission 专用句） |
| 表确定有字段 | 不是空表；失败在 Lucy 读路径 |

### 1.2 根因（合同＋代码对齐）

| 层 | 事实 |
|---|---|
| 合同 | P1-16 SC-10：外部目录字段「仍是 `DESC`，并走 `ktx sql`」；整库逐表 DESC 不在出口 |
| 代码 | `schema-structure.ts` → `readCatalogTableColumns` 仅 `execute(... describeCatalogTableSql ...)` |
| 历史 | 2026-11-10 曾有经 KTX 的 `SHOW FULL COLUMNS` → `SHOW COLUMNS` → `DESCRIBE` 回退；但 `SHOW*` 进不了 `ktx sql`（与列库同一约束）。列名已改直连后，字段未改直连 |

**结论：** 列名与字段通道分裂；字段仍依赖 KTX，现网失败。修复＝字段探针与列名共用直连 MySQL，并恢复多语句回退（不经 KTX）。

## 2. 目标

1. 外部目录单表读字段：**直连 MySQL**（复用／扩展现有 `runCatalogShow` 凭据与超时／关连接／脱敏纪律）。
2. 探针顺序（仅当上一条被**语句拒绝／执行失败**或成功但**映射后 0 列**时尝试下一条）：
   1. `DESC \`catalog\`.\`schema\`.\`table\``
   2. `SHOW COLUMNS FROM \`catalog\`.\`schema\`.\`table\``
   3. `DESCRIBE \`catalog\`.\`schema\`.\`table\``
3. 任一条成功且映射出 ≥1 列 → 返回这些列；全部失败 → 现有 rejection 文案。
4. `runSql`／`ktx sql` 的调用参数中**不得**出现上述字段探针 SQL（外部目录分支）。
5. **禁止**外部目录字段成功路径使用 `information_schema`。
6. 无点号 MySQL／Postgres 读字段路径不变；问数／MCP 不变；不改 KTX 源码。

## 3. Non-Goals

| 非目标 | 理由 |
|---|---|
| 修改 KTX 或放行 `ktx sql` 的 `SHOW` | 与 P1-16 同一约束 |
| 把字段探针交回 `ktx sql` | 现网已证伪为可靠通道 |
| 外部目录 Schema 宽一次读全库字段 | 无可用 `information_schema`；整库 DESC 仍另计 |
| 改问数、语义、MCP、页面布局 | 事故面只在准备表结构单表字段 |
| 客户 live 必过作为本条出口 | 功能合同以替身为准；live 归 UAT／发布取证 |
| 承诺整库勾选数百表一次点完不超时 | 仍逐表请求；本条只保证**单表**通道正确 |

## 4. 设计

### 4.1 直连语句白名单扩展

现有 `runCatalogShow` 仅允许：

- `SHOW DATABASES FROM \`catalog\``
- `SHOW TABLES FROM \`catalog\`.\`schema\``

本条扩展同一适配器（或抽出共用「catalog MySQL meta」执行器，行为等价）白名单，另允许且**仅**允许：

- `DESC \`catalog\`.\`schema\`.\`table\``
- `SHOW COLUMNS FROM \`catalog\`.\`schema\`.\`table\``
- `DESCRIBE \`catalog\`.\`schema\`.\`table\``

仍强制：`multipleStatements: false`；握手不传默认 `database`；`file:` 密码；120s 超时；成功／失败关连接；错误脱敏。

### 4.2 映射

- `DESC`／`SHOW COLUMNS`／`DESCRIBE` 行按既有／恢复的 `mapDescribeColumn`／`mapShowColumn` 规则映射（Field／Type／Null／Key…）。
- 中文表名／列名不得在标识符引用中被破坏（沿用 `quoteMysqlIdent`）。

### 4.3 调用点

| 入口 | 行为 |
|---|---|
| `POST /api/connections/:id/schema-structure` 带 `tables: [one]` | 外部目录 → 直连多探针 |
| `readCheckedTableColumns`（前端逐表） | 间接受益，无需改 UI |
| 无 `tables` 的 list-names | 仍只 `SHOW TABLES`（P1-16），不读字段 |

### 4.4 与 P1-16 SC-10

| 原 SC-10 | 本条生效后 |
|---|---|
| 外部目录字段语句是 `DESC`，走 `ktx sql` | **废止为外部目录字段合同**；改为本 Spec SC-01–SC-05 |
| P1-16 列库／列表 SC | **保持** |

在 [catalog-scan Spec](lucy-20261111-catalog-scan-read-path-spec.md) Follow-up 指向本 Spec；不回开已关闭的列库／列表 SC。

## 5. 验收（SC）

| ID | 通过标准 | 证据 |
|---|---|---|
| SC-01 | 外部目录＋`tables: [已知表]`，直连 `DESC` 成功替身 → preview 含 ≥1 字段；文案非「没有读到字段」 | vitest |
| SC-02 | 同上路径中 `runSqlImpl` **未被**调用（或调用参数不含 `DESC`／`SHOW COLUMNS`／`DESCRIBE`／`SHOW DATABASES`／`SHOW TABLES`） | vitest |
| SC-03 | `DESC` 被拒绝、`SHOW COLUMNS` 成功 → 仍返回字段；记录／断言尝试顺序含回退 | vitest |
| SC-04 | 三探针皆失败 → `READ_FAILED` 且 message 为「表「…」没有读到字段。」（或既有 permission／timeout 句，若替身模拟对应原因） | vitest |
| SC-05 | 直连白名单拒绝非目录 meta 语句（如 `SELECT 1`、`information_schema`） | vitest |
| SC-06 | 外部目录成功路径 SQL 不含 `information_schema` | vitest |
| SC-07 | 密码 `file:`、失败脱敏、超时关连接：复用／扩展示例覆盖至少一条字段探针 | vitest |
| SC-08 | 无点号 MySQL 单表／schema-wide 既有测试保持绿 | vitest |
| SC-09 | 中文表名：`DESC \`hive_jd\`.\`app\`.\`日活明细\`` 经直连替身仍保留列名 | vitest |
| SC-10 | 列表-only（无 tables）仍不发字段探针；`columnCount` 可为 0 | vitest |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 直连 `DESC` 在部分 SelectDB 版本仍失败 | 多探针回退；失败保持诚实文案 |
| 扩大白名单被误用发任意 SQL | 严格正则；单测打假 |
| 与 P1-16 SC-10 文档漂移 | 本 Spec 显式废止字段侧 SC-10；清单互指 |
| 客户 live 仍 BLOCKED | 出口不依赖 live；授权后可选补 EXT 字段用例 |

## 7. 诚实主张

| 可以 | 不可以 |
|---|---|
| 方案解决「列表通、单表字段不通」的通道分裂 | 未授权即改运行代码 |
| 替身证明合同 | 宣称客户现场已验／可上线 |

---

**下一步：** 委托人终稿确权后**另发开发授权**，再按 Plan 实现。
