# 添加 Schema 之后读取表结构

| 元数据 | 内容 |
|---|---|
| 文档名称 | 添加 Schema 之后读取表结构 |
| 文档类型 | Product / UX Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/connections` 的添加 Schema 抽屉成功步，以及连接卡片上缺 Schema Manifest 的行 |
| 关联工单 | `webui/docs/plans/wo-202610-17-add-schema-structure-next-step.md` |
| 上游 | Spec 157、Spec 158、Spec 107、Spec 73、Spec 21 §4.5、Spec 27 §6.2 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 添加 Schema 成功步只保留状态和一颗主按钮。主按钮按事实读取表结构、使用已有 Manifest 或上传。读完后进入该 Schema 的启用表范围 |

普通运维在 `mysql-aliyun` 里加完 Schema，成功步同时给出「完成」「同步配置变更」「上传 Schema Manifest」。三颗按钮都像必做的下一步。

## 1. 问题

2026-10-12 在 `http://127.0.0.1:55176/connections` 添加 Schema 的最后一步看到：

- 状态写成「已添加」，下面又解释不会自动生成 Manifest、可以现在上传、否则等离线流程。
- 「上传 Schema Manifest」是黑底主按钮。没有现成 YAML 的人会以为必须上传。
- 「同步配置变更」像刚写入的配置还要再确认一次。刚添加的 Schema 本机没有 Manifest 时，点它读不出表。
- 「完成」最轻，像放弃。
- 抬头仍写「下一步将先验证连接权限」，这一步已经做完。
- 回到卡片后，缺 Manifest 的行只剩「上传 Manifest」，同一种选择又出现一次。

接入向导第 2 步已经能从 MySQL / PostgreSQL 读取表结构并写入最小 Schema Manifest（Spec 157）。添加 Schema 这条日常路径没有接上。

## 2. 目标

1. 成功步只表达一件已完成的事：这个 Schema 已经加到连接上。
2. 下一步就是主按钮，不另写一句「点下方某某按钮」。
3. 能读库且还没有 Manifest 时，主按钮是「从数据库读取表结构」。
4. 读库、写入、刷新本地目录复用 Spec 157 的同一条链路，不另写一套 Manifest。
5. 读完并刷新出表之后，离开抽屉，打开该 Schema 的启用表范围。
6. 不打开六步接入向导，不自动勾选启用表。
7. 卡片上缺 Manifest 且能读库的行，可见主动作与成功步相同。

## 3. 非目标

- 不改接入向导第 1–6 步的步骤名、按钮文案和断点。向导里的离开按钮仍是「结束并稍后继续」。
- 不改上传抽屉内部。提交按钮仍是「上传并同步配置变更」。
- 不在成功步生成指标、维度、关联或 `descriptions.ai`。
- 不把「表结构已写入」写成可以问数。
- 不改移除 Schema 抽屉。
- 不改启用表范围页的选择和保存规则。本流程只负责打开它，并带上连接与 Schema。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 21 §4.5、Spec 27 §6.2：成功步提供上传、刷新本地目录、完成 | 成功步按 §5 的事实切换一颗主按钮。刷新不作为按钮 |
| Spec 73：添加 Schema 抽屉的刷新按钮文案为「同步配置变更」 | 成功步不再放这颗按钮。上传抽屉保持 Spec 73 |
| Spec 163 §3：不改添加 Schema 抽屉，不改 Schema 行内「更多」 | 仅成功步和缺 Manifest 的行按本 Spec 调整。卡片抬头、更多里的连接级动作保持 Spec 163 |

## 5. 成功步

抽屉标题仍是「添加 Schema 到 {连接 ID}」。成功步去掉抬头说明「添加后会写入 ktx.yaml；下一步将先验证连接权限」，也不显示 Manifest 说明段。

成功状态只有一行：

```text
✓ 已添加 Schema：{schema}
```

`data-testid` 仍为 `add-schema-success-message`。Schema 名使用 `notranslate` 与 `translate="no"`。

主按钮按当前事实切换，同一组最多一颗 primary。

| 当前事实 | primary | secondary | 离开 |
|---|---|---|---|
| 能读库，目标 Manifest 不存在 | 从数据库读取表结构 | 我已有 Schema Manifest | 完成 |
| 目标 Manifest 已存在 | 使用已有 Schema Manifest | 替换已有 Schema Manifest | 完成 |
| 不能读库 | 上传 Schema Manifest | 无 | 完成 |
| Manifest 已写入，本地目录尚未读到表 | 重新同步并继续 | 替换已有 Schema Manifest | 完成 |

能读库的判断复用 `canReadDatabaseStructure`：`wireProtocol` 为 `mysql` 或 `postgres`，以及按 Spec 157 归入 MySQL 协议的 StarRocks、Doris。SQLite、SQL Server、Oracle 走上传。

进行中的主按钮文案为「正在读取表结构...」，`aria-busy="true"`。字段类型被降级为 `string` 时，先展示 Spec 157 §7.1 的结果摘要，主按钮改为「继续生成」，次按钮仍是「我已有 Schema Manifest」。用户确认后才写盘。

「完成」关闭抽屉，不读库，不刷新本地目录。Schema 已在前一步写入连接配置。

「我已有 Schema Manifest」和「上传 Schema Manifest」打开现有上传抽屉，锁定当前连接和这个 Schema。上传成功并刷新出表之后，同样进入启用表范围。上传抽屉自身的文案不改。

读库或使用已有 Manifest 成功、且 `/api/sources` 里该连接和 Schema 至少有一张表时，关闭添加 Schema 抽屉和上传抽屉，打开：

```text
/connections/enabled-tables?connection={connectionId}&schema={schema}
```

不打开接入向导，不写入 `enabled_tables`。

失败时留在成功步。主按钮保持该事实下的主动作，用户再次点击即重试。说明只写发生了什么，不写「点下方某某按钮」。没有可读取的表时，说明为「这个 Schema 没有可读取的表。」本地目录尚未读到表时，说明为「本地目录尚未读到表。」主按钮改为「重新同步并继续」。

## 6. 缺 Manifest 的 Schema 行

连接卡片上，该 Schema 没有可读 Manifest 时：

| 事实 | 行内可见动作 | 「更多」 |
|---|---|---|
| 能读库 | 从数据库读取表结构 | 上传 Manifest、移除 Schema |
| 不能读库 | 上传 Manifest | 移除 Schema |

已有可读 Manifest 的行保持「查看 Manifest」「维护启用表范围」，「更多」里仍是下载、重新上传、移除。

行内「从数据库读取表结构」打开同一个准备动作，标题为「准备表结构」。不显示「已添加 Schema」状态行。离开按钮为「关闭」。读完后的去向与 §5 相同。`data-testid` 为 `read-structure-{connectionId}-{schema}`。

## 核心流程（伪代码）

```text
successStep(connection, schema):
  manifest = find Manifest(connection.id, schema)
  if reloadPending(connection.id, schema):
    primary = 重新同步并继续
    secondary = 替换已有 Schema Manifest
  else if manifest exists:
    primary = 使用已有 Schema Manifest
    secondary = 替换已有 Schema Manifest
  else if canReadDatabaseStructure(connection):
    primary = 从数据库读取表结构
    secondary = 我已有 Schema Manifest
  else:
    primary = 上传 Schema Manifest
    secondary = none
  ghost = 完成
  show only "✓ 已添加 Schema：{schema}"

onPrimary(read_structure):
  preview = POST /api/connections/{id}/schema-structure { schema }
  if preview fails:
    stay; show error; primary remains 从数据库读取表结构
    return
  if preview has downgraded types:
    show Spec 157 summary
    wait for 继续生成 or 我已有 Schema Manifest
    if 我已有 Schema Manifest: open locked upload; return
  write Manifest only when target is absent
    # same validate + upload path as Step2UploadManifest.writeGenerated
  if target already exists:
    switch primary to 使用已有 Schema Manifest
    do not overwrite
    return
  reload catalog for connection.id + schema
  sources = /api/sources filtered by connection.id + schema
  if reload fails or sources is empty:
    stay
    primary = 重新同步并继续
    show "本地目录尚未读到表。"
    return
  close drawers
  open /connections/enabled-tables?connection={id}&schema={schema}

onPrimary(use_existing or retry):
  require Manifest exists
  reload catalog
  if sources is empty: stay with 重新同步并继续
  else: close drawers and open enabled-tables for this schema

onPrimary(upload or replace) or onSecondary(我已有 Schema Manifest):
  open existing upload drawer locked to connection.id + schema
  after upload reload yields at least one table:
    close drawers and open enabled-tables for this schema

onGhost(完成 or 关闭):
  close the structure drawer
  do not read the database
  do not reload catalog
  do not open the setup assistant
```

缺 Manifest 的行调用同一套 `onPrimary(read_structure)`，只是进入时没有「已添加」状态行。

## 7. 验收

| ID | 场景 | 期望 |
|---|---|---|
| SC-1 | MySQL 连接刚添加一个尚无 Manifest 的 Schema | 成功步只有「✓ 已添加 Schema：{name}」。主按钮是「从数据库读取表结构」，次按钮是「我已有 Schema Manifest」，离开是「完成」。没有「同步配置变更」，没有 Manifest 说明段，抬头没有「下一步将先验证连接权限」 |
| SC-2 | 不能读库的连接，同样刚添加 | 主按钮是「上传 Schema Manifest」。没有次按钮。离开是「完成」 |
| SC-3 | 本机已有该 Schema 的 Manifest | 主按钮是「使用已有 Schema Manifest」，次按钮是「替换已有 Schema Manifest」 |
| SC-4 | 点击「从数据库读取表结构」且无需降级 | 调用既有 `schema-structure`、校验并写入；目标已存在时不覆盖。刷新出至少一张表后，打开该 Schema 的启用表范围。不打开接入向导，不改 `enabled_tables` |
| SC-5 | 读取结果含降级字段 | 先显示 Spec 157 的摘要。确认「继续生成」后才写盘 |
| SC-6 | 读取失败，或刷新后没有表 | 留在抽屉。主按钮可再次执行。说明不出现「点下方」 |
| SC-7 | 点击「完成」或「关闭」 | 只关闭。不读库，不刷新本地目录 |
| SC-8 | 卡片上缺 Manifest 且能读库 | 行内可见「从数据库读取表结构」。上传 Manifest 在「更多」里 |
| SC-9 | 卡片上缺 Manifest 且不能读库 | 行内仍是「上传 Manifest」 |
| SC-10 | 已有可读 Manifest 的行 | 仍是查看 Manifest、维护启用表范围 |
| SC-11 | 接入向导第 2 步 | 按钮和「结束并稍后继续」保持 Spec 157 |

## 8. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None

沿用接入向导已有说法：从数据库读取表结构、我已有 Schema Manifest、使用已有 Schema Manifest、替换已有 Schema Manifest、重新同步并继续、上传 Schema Manifest、准备表结构、启用表范围、继续生成。

成功步不出现：同步配置变更、离线流程、`ktx.yaml`、`semantic-layer`、点下方、暂时不能问数、问答已就绪。

`Schema`、连接 ID、Schema 名的 DOM 节点保持 `notranslate` 与 `translate="no"`。

## 9. Design System Compliance

- 引用 `webui/docs/design-system/10-components-button.md`：同一组只有一颗 primary。primary 是当前事实下的唯一下一步。
- 「完成」和「关闭」使用 `pl-btn--ghost`。
- 次按钮使用 `pl-btn--secondary`。不能读库时不放一颗禁用的读库按钮。

## 10. 测试

更新 `webui/src/__tests__/add-schema-drawer.test.tsx`：成功步按 SC-1 至 SC-7 断言，去掉对「同步配置变更」和 `semantic-layer` 说明段的成功步要求。

更新 `webui/src/__tests__/connection-overview.test.tsx`：缺 Manifest 的 MySQL Schema 行按 SC-8 断言；不能读库按 SC-9。已有 Manifest 的行保持 SC-10。

`setup-assistant.test.tsx` 保持 SC-11，向导文案不被本改动改掉。

本 Spec 的实现验收用 Vitest 与 `npm run lint:terminology`。不要求浏览器测试。
