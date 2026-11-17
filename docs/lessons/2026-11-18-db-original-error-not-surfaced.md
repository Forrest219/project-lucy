# 错题：数据库原始错误不透出，Kerberos 握手失败、HMS 太慢、HMS 起不来在页面上是同一句话

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-18 |
| 标签 | `ux-regression` `gate-gap` `contract-stack` `sev-med` |
| 环境 | 本机 demo：Lucy 0.30.0（`65f40847`）＋ Doris FE 2.0.14 ＋ MIT KDC ＋ Hive 4.0.0 HMS 的 Kerberos 模拟；客户现象来自 SelectDB 外部目录 `hive_jd`（Kerberos HMS） |
| 相关 | 需求台 P1-43／REQ-030-064；前序 [2026-11-13-external-catalog-column-read-ktx-describe](2026-11-13-external-catalog-column-read-ktx-describe.md)（P1-20／REQ-030-041）、P1-16／REQ-030-037 |
| 状态 | `open`（仅登记；未授权改运行代码） |

## 1. 症状与影响

- 客户 `hive-jd`（SelectDB 下的 Kerberos Hive 目录）在「准备表结构」读不到字段，页面只有「表「…」没有读到字段。」（HTTP 400 `READ_FAILED`）。同一账号在 SelectDB Studio 里 `DESC` 同一张表成功。
- 现场同事无法从页面判断是权限、握手、网络还是元数据服务慢，必须登录 Lucy 容器翻 `[schema-structure] read failed` 日志才能看到 Doris 原文。客户现场这一步最难做到，排障被迫绕一圈：先让同事去 SelectDB 一侧取证，再回头与 Lucy 对照。
- 影响面：所有走 `readCatalogTableColumns` 的外部目录字段读取，以及复用同一读取路径的结构差异检查（`live-discovery.ts`）。表列表读取（`SHOW TABLES`）失败时页面显示什么，**未验证**。

## 2. 复现要点

本机 Kerberos 模拟，同一张 `hive_jd.app` 表在 Lucy「准备表结构」读取，Lucy 页面均为同一句「没有读到字段」。差别只在耗时与背后的原因：

| 机制 | SelectDB 里 `DESC` | `SHOW DATABASES` 与 `fe.log` | Lucy 服务端日志 stderr | Lucy 耗时 |
|---|---|---|---|---|
| 主机名反向解析不一致 | `Unknown database 'default_cluster:app'` | `GSS initiate failed` | 同 `DESC` 的 `Unknown database` | 约 9 秒 |
| 时钟偏差（KDC 快 10 分钟） | 同上 | `GSS initiate failed` | 同上 | 约 9 秒 |
| HMS 起不来（keytab 与 KDC 密钥不一致） | 连接失败 | 连接失败 | `Catalog connection/query timed out` | 约 24 秒 |
| HMS 变慢（暂停 30 秒，之后最终成功） | **成功，只是等 30 秒** | 无异常 | `Catalog connection/query timed out` | 约 24 秒，随后立刻重试成功 |

完整指纹与脚本：本机 `inbox/20261118-0011-hive-jd-kerberos-fingerprint-dictionary.md`（临时文件，不入库）。

## 3. 根因

分层：

- **合同／类型**：`SchemaColumnRejection = { table, reason }`，`reason` 只是 7 个枚举值（`missing`、`ambiguous`、`unreadable`、`permission`、`timeout`、`too_large`、`too_wide`）。数据库原文在这一层**没有字段可放**，类型决定了无法向上传递（`webui/server/schema-structure.ts` 约第 95–98 行）。
- **实现**：原文（`stderr`、SQL、耗时）只经 `logSchemaStructureFailure` 写 `console.error`，不进 API 响应。读取过程里抛出的异常在 `readCatalogTableColumns` 的 `catch` 中统一归为 `unreadable`。
- **呈现**：`rejectionMessage` 只给权限、超时、过宽三种单独文案，其余全部是「没有读到字段」。
- **叠加问题（实验观察）**：
  - 单表读取只等 8 秒（`PER_TABLE_TIMEOUT_MS`），`DESC`、`SHOW COLUMNS`、`DESCRIBE` 三条探针各等一次，合计 24 秒后放弃。
  - 单表路径的超时文本（`Catalog connection/query timed out`）既不匹配 `CONNECTION_FAILURE`（需 `connection timed out`），`columnScanTimedOut` 又按 120 秒阈值判定，因此「读取表…的字段超时」文案在这条路径上走不到。

## 4. 为何漏检

- 既有测试替身（如 `doris-external-catalog.simulation.test.ts`）模拟的是「超时」「权限」等**分类后的**失败，没有断言「用户能看到原因」。
- 门禁只验证「失败时明确提示失败」，不验证「失败提示能区分原因、能指导排障」。
- 此前取证全在没有 Kerberos 的 `hive` 环境里，没有走到「同一句话背后有多种成因」的路径。

## 5. 举一反三

1. 任何把底层错误归类成枚举的读取／探测路径，必须同时保留**脱敏后的原文或错误类别**，不能只留枚举。「归类」只能用于选文案，不能是唯一的出口。
2. 新增失败分类时，必须写「用户在页面上看到什么、能据此做什么」的验收，而不只是「失败被捕获」。
3. 把底层原文透出前，必须定脱敏规则（内网主机名、SQL、Kerberos principal）与可见范围（例如仅管理员），不能直接原样展示，也不能因此继续整体隐藏。
4. 超时判定的阈值要与实际传入的超时一致：单表路径用的是 8 秒，就不能沿用 120 秒的判定函数。
5. 加诊断信息不得改变现有成功／失败判定，也不得让合法用户的主路径更难用（主路径可用性优先）。

## 6. 后续动作

| 动作 | 状态 | 说明 |
|---|---|---|
| 入需求台 P1-43／REQ-030-064 | 完成（2026-11-18） | 仅登记 |
| 核实表列表读取、连接测试、结构差异检查等其他路径是否同样吞原文 | 未开 | 范围先于方案；未验证项不得写成事实 |
| 起草 Spec（透出范围、脱敏、可见范围、验收） | 完成草案（2026-11-18，v0.1-draft） | [lucy-20261118-db-original-error-surfacing-spec](../specs/lucy-20261118-db-original-error-surfacing-spec.md)；开放项待委托人决策；登记 ≠ 授权开工 |
| 终稿确权＋开发授权 | 未开（委托人 2026-11-18 明示「不开发」） | 未授权条目禁止改运行代码 |
| 超时判定与单表 8 秒预算的一致性 | 未开 | 与上一条同条目处理，不另开 |

## 7. 证据指针

- Spec 草案：[lucy-20261118-db-original-error-surfacing-spec](../specs/lucy-20261118-db-original-error-surfacing-spec.md)
- 本机 `inbox/20261118-0011-hive-jd-kerberos-fingerprint-dictionary.md`（临时文件）
- 本机 `inbox/20261117-2335-selectdb-hive-jd-round2-action-guide.md`（给现场同事的取证指南 v1.1）
- 代码：`webui/server/schema-structure.ts`（`SchemaColumnRejection`、`sqlFailureReason`、`rejectionMessage`、`logSchemaStructureFailure`）、`webui/server/schema-structure-batch.ts`（`PER_TABLE_TIMEOUT_MS`）、`webui/server/catalog-show.ts`（超时文本）
- 注意：客户侧 `hive_jd` 的真正根因仍未确认，本条登记的是「Lucy 不透出原文」这一已核实的缺陷，不是客户根因结论。
