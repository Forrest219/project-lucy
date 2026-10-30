# SQL Server 逻辑名与物理名

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v1.0 |
| 日期 | 2026-10-30 |
| 功能编号 | 不另派 L25 编号。这是启用表范围的标识修复。功能编号待 PM 指派 |
| 状态 | **v1.0 已在本分支实现，待审阅**。不构成客户包验收通过 |
| 决策来源 | 2026-10-30 用户授权：评估客户 SQL Server 现场问题，并在本分支落地修复 |
| 需求来源 | 《Lucy 2.0 SQL Server 问题、修复方案与补丁反馈》（2026-10-27）与 `lucy-sqlserver-hotfix2-provider.patch` |
| 实施主体 | Lucy WebUI。不修改 KTX 源码 |

## 1. 现场问题是否成立

对照当前分支，下面几项是代码缺陷，不是现场配置写错就能消失的。

| 现场现象 | 当前代码 | 结论 |
|---|---|---|
| 保存 `bidm.dbo.table` 被拒绝 | `validateEnabledTables` 只接受恰好两段的对象名 | 成立 |
| 逻辑名 `BIDM.table` 保存报 `TABLE_NOT_SCANNED` | 扫描集合收的是 Manifest `table:`，保存前没有把逻辑名收成物理名 | 成立 |
| 同一张表出现「已启用」和「无效启用」两行 | 启用表范围用字符串精确比较；`GET /tables` 只返回逻辑名 | 成立 |
| 语义模型把三段 `table:` 当成没写 | `parseQualifiedTable` 只接受两段，三段名被丢弃后回退成 `schema.source` | 成立 |
| 三段启用名把数据库段塞进 Schema 列表 | `readProject` 用第一个点之前的内容推断 Schema | 成立 |
| 历史别名要靠人工从 `ktx.yaml` 里删 | 没有幂等迁移 | 成立 |

下面两项不是这次要改的产品行为。

- 已启用表缺少物理 Manifest。外层语义文件不能代替 `_schema/*.yaml`。补 Manifest 是现场数据，不在 Lucy 里猜表结构。KTX 的 metadata-only 采集也不在本仓库改。
- `role: admin` 与 `roles: [lucy_admin]`。Agent 的单数字段 `role` 已经等价于 `roles: [该 id]`。WebUI 登录账户的 `role: admin` 已经读成 `operator`。角色 id `admin` 本身不是 `lucy_admin`，不能自动提权。升级脚本只列出对不上的角色 id。

不能把 `bidm.dbo.table` 和 `dbo.table` 因为末段相同就当成同一张表。对不上 Manifest 的启用项保留，并标成无效启用。

## 2. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 物理名权威 | 每张表的物理名是 Schema Manifest 里 `table:` 的原文。没有 `table:` 时，物理名等于逻辑名 `schema文件名.sourceKey` |
| D2 | 合法对象名 | 保存值允许两段或三段。一段、四段、空段、`..`、斜杠和控制字符拒绝，错误码仍是 `INVALID_ENABLED_TABLE` |
| D3 | 大小写 | 只有 `driver: sqlserver` 按大小写不敏感对齐。MySQL、PostgreSQL、StarRocks 仍区分大小写 |
| D4 | 歧义 | 同一个大小写不敏感键指向两个不同物理名时，不改写这两项 |
| D5 | 重复 | 收成同一物理名的多项只保留第一次的权威值，不再返回 `DUPLICATE_ENABLED_TABLE` |
| D6 | 无法映射 | 对不上任何逻辑名或物理名的项原样保留。原先已启用的继续告警 `ENABLED_TABLE_NOT_SCANNED`；新加入的仍拒绝 |
| D7 | 页面 | 一张逻辑表一行。勾选状态同时认逻辑名和物理名。保存提交物理名。对不上的值仍进「无效启用」 |
| D8 | 迁移 | 显式脚本默认为 dry-run。`--apply` 写盘前在 `ktx.yaml` 同目录备份。重复执行不再改文件。不在进程启动时改 `ktx.yaml` |
| D9 | 角色 | 预检只报告 access.yaml 里目录中不存在的角色 id，不改文件 |

## 3. 范围

### 3.1 本期包括

- `GET /api/connections/:connId/tables` 增加 `physicalNames`。
- `PUT /api/connections/:connId/enabled-tables` 与 `lucy_ops_connection_tables` 在校验前归一化。
- 启用表范围、连接概览的已启用计数、语义目录的 `enabled` 标记认逻辑名和物理名。
- 语义身份索引保留三段物理名。
- `webui/scripts/normalize-enabled-tables.ts`。

### 3.2 本期不包括

- 补客户缺失的 Manifest，或改 KTX ingest。
- 把角色 id `admin` 改写成 `lucy_admin`。
- 客户离线镜像、Helm 包和集群验收。
- 移动窄屏。

## 4. 核心流程（伪代码）

```text
catalog(connection):
  for each semantic-layer/<connection>/_schema/<schema>.yaml
    for each tables.<source>:
      logical = schema + "." + source
      physical = trim(table:) if present else logical
      record logical -> physical

normalize(names, catalog, caseInsensitive):
  index = empty map
  for each logical -> physical:
    add key(logical) and key(physical)
    if a key already points at a different physical: mark that key ambiguous
  out = []
  for each raw name:
    if key(name) is ambiguous: keep the original text
    else if key(name) hits: replace with that physical
    else: keep the original text and record unmapped
    if this physical was already emitted: drop the later copy
    else: emit it

save(connection, names):
  normalized = normalize(names, catalog(connection), driver == sqlserver)
  validate normalized with the two-or-three-part rule
  names in the scanned physical set pass
  names that were already enabled but are not scanned: warn ENABLED_TABLE_NOT_SCANNED
  any other name: reject TABLE_NOT_SCANNED
  persist the normalized list

show row(logical):
  physical = catalog.physicalNames[logical]
  checked = any enabled value matches logical or physical
  one row only
  unmapped enabled values stay in 无效启用

migrate:
  plan = normalize every connection's current enabled_tables
  print rewrites, dropped duplicates, unmapped, ambiguous
  on --apply and the list actually changed:
    copy ktx.yaml to a sibling backup
    patch only the enabled_tables blocks
  running plan again yields the same lists
```

`key` 在 SQL Server 上是小写，其它驱动是原文字。

## 5. 验收

| 编号 | 断言 |
|---|---|
| SC-01 | 已扫描的三段物理名可以 dry-run 保存，`warnings` 为空 |
| SC-02 | 四段名、`..` 和路径字符返回 `INVALID_ENABLED_TABLE` |
| SC-03 | SQL Server 上，逻辑名和只是大小写不同的物理名保存后变成 Manifest 里的那一个物理名，且只留一条 |
| SC-04 | 对不上 Manifest 的历史项保留，并得到 `ENABLED_TABLE_NOT_SCANNED`；MySQL 两段名仍区分大小写 |
| SC-05 | `GET /tables` 同时给出排序后的逻辑名和 `physicalNames` |
| SC-06 | 启用表范围里，逻辑名和物理名只占一行，勾选、字段数和语义状态挂在这一行；保存请求体是物理名 |
| SC-07 | 无法映射的启用值仍出现在「无效启用」 |
| SC-08 | 迁移改写已映射别名，保留无法映射的项和无关字段；第二次 `--apply` 不再写文件 |
| SC-09 | 三段 `table:` 进入语义身份索引，`schemaMismatch` 不为真 |
| SC-10 | 缺 Manifest 时，Schema 行仍按 `schema.` 前缀计已启用表数 |
| SC-11 | `role: admin` 在角色目录只有 `lucy_admin` 时被预检点名，文件不被改写 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

沿用「启用表范围」「无效启用」「Schema Manifest」「逻辑名」「物理名」。用户可见状态仍是「已启用，语义完成」「已启用，待补语义」「无效启用」。不把无效启用写成孤儿表。

## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows
- [x] 启用表范围仍用现有表、复选框和「无效启用」分区
- [x] 不新增颜色、按钮样式或页面骨架
- [x] 表名节点保持 `translate="no"` 与 `notranslate`
- [x] 文案沿用既有术语

### Exceptions (If Any)
- None

### Follow-up Needed
- 客户镜像和集群上的 SQL Server 只读查询不在本分支验收里。
