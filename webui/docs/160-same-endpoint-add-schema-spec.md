# 同一数据库端点的误登记软门禁

| 元数据 | 内容 |
|---|---|
| 文档名称 | 同一数据库端点的误登记软门禁 |
| 文档类型 | Spec |
| 版本 | v0.4 |
| 撰写日期 | 2026-09-28 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | 2026-09-28 对 `http://127.0.0.1:55176/connections` 与 `POST /api/connections` 的核查；Spec 160 v0.1 Gate B 审阅（连接身份与治理缺口、六条阻断）；`writeKtxYaml` 的读取→修改→写回；`CanonicalSourceKey`；`withTokenWriteLock`；现有错误信封 `error.code` / `error.message` / `error.detail` |
| 适用范围 | `/connections` 的「新建连接」与接入向导第 1 步；`POST /api/connections` 在单进程内的端点软门禁 |
| 输出位置 | `webui/docs/160-same-endpoint-add-schema-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 160 |
| 关联页面 | `/connections` |
| 上游 Spec | Spec 124（新建连接）；Spec 107（`GET /api/connections/:connId/live-schemas`）；添加 Schema（`POST /api/connections/:connId/schemas`）；Spec 130（接入向导第 1 步） |
| 状态 | 已实现（验收通过） |
| 日期 | 2026-09-28 |
| 范围 | 阻止把同一数据库端点误建成另一张卡片；明确这是软门禁，不是端点唯一约束 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 初稿：按端点把新建连接改道到添加 Schema |
| v0.2 | 改为误操作软门禁。补上单进程写锁内复核、冲突路径只接受一个 Schema、用户名不同不得默认复用、多条匹配不能再新建、非 MySQL 同服务器确认字段，以及现有错误信封 |
| v0.3 | 按 v0.2 落地新建连接与接入向导第 1 步 |
| v0.4 | 修复验收 P1：复用检查强制绕过目录缓存；补齐 SQL Server / Oracle live-schemas；冲突分支统一先校验 Schema 数量；所有正式 `ktx.yaml` 写入共用单进程队列；补齐失败重试与关键交互测试 |

本文件阻止「新建连接」和接入向导在未确认时再写一条同端点连接。它不保证一个 host 永远只有一张卡片。历史重复卡片保留。显式确认后，唯一匹配仍可以新建第二条。

连接概览继续一张卡片对应一个连接 ID。Schema 仍是卡片内的行。

## 1. 问题

创建连接只检查 `connections.<id>`。换一个连接 ID 就能把同一台库再写一条，连接概览因此多一张卡片。

这条新连接是另一个治理身份。规范源键是 `connectionId + schema + sourceName + physicalTable`。同一物理表经两个连接 ID 接入后，Schema Manifest、启用表范围和 Role 授权可以各写各的。这是连接身份分叉。当前没有证据表明它已经绕过某条已生效的权限。

2026-09-28 的运行实例当时有两张卡片，host 分别是 `demo-db` 与阿里云 RDS，尚未叠成同一 host。对已有 `demo-db:3306` 使用新连接 ID 做 `dryRun: true`，接口返回了第二条连接的预览，且未写入文件。

`writeKtxYaml` 是读取、修改、写回，进程内没有和 Token 写入一样的队列。两次并发创建可以先后覆盖同一份 `ktx.yaml`。

## 2. 目标

这是误操作软门禁。host 和端口不是完整连接身份；用户名、database、engine 都可以构成另一条合法连接。

1. `dryRun: true` 与 `dryRun: false` 都做端点判断。未满足本文的确认字段时，不返回一条新连接的预览，也不写 secret 或 `ktx.yaml`。
2. 所有正式 `ktx.yaml` 写入共用一条进程内队列。`dryRun: false` 创建连接时，持有队列期间重新读取磁盘、重新匹配，然后再写 secret 和 YAML。队列外的匹配结果不作数。
3. 唯一匹配、用户名相同、且只提交一个 Schema 时，主路径是添加到已有连接。页面说明将使用已有凭据，新输入的密码不保存。
4. 用户名不同，或 live-schemas 看不到目标 Schema 时，不默认复用已有连接。用户可以显式「仍要新建连接」。
5. 已有多条匹配时，只能选定一条已有连接再添加 Schema。确认字段不能创建第三条。
6. PostgreSQL、SQL Server、Oracle 在同一 driver、host、端口但 database 不同时，必须带服务端可复核的确认字段才新建卡片。
7. 已存在的重复卡片不合并、不删除。

## 3. Non-Goals

- 不把「一个端点只有一张卡片」写成不变式。唯一匹配在显式确认后仍可有第二张卡片。
- 不自动合并、改名或删除历史重复连接。
- 不把 `localhost`、`127.0.0.1` 与主机名解析成同一端点。不做 DNS 比较。
- 不修改已有连接的 host、端口、用户名或密码。
- 不把 live-schemas 可见性写进既有「添加 Schema」接口。该接口仍做连接级连通测试。可见性只约束从本软门禁进入的复用路径。
- 不引入跨进程锁、多副本锁或分布式事务。一致性边界是单进程，与 `docs/governance/DEVELOPMENT.md` 的部署约束一致。
- 不把 live-schemas 的缓存整体取消。普通目录浏览仍可使用缓存；本软门禁的复用确认必须显式 `refresh=1` 绕过缓存。
- SQLite 不参与端点匹配。
- 不把 PostgreSQL / SQL Server / Oracle 的另一个 database 写进原连接的 `schemas`。

## 4. 匹配

比较前规范化 host：去掉首尾空白、转为小写，IPv6 去掉外层方括号。端口按整数比较。用户名只去掉首尾空白，区分大小写。缺少已保存用户名时视为与输入不同。

| 名称 | 键 | 用途 |
|---|---|---|
| 端点匹配 | MySQL、StarRocks、Doris：`driver + host + port`。PostgreSQL、SQL Server、Oracle：再加 `database` | 决定能不能把本次 Schema 加到已有卡片 |
| 同服务器匹配 | `driver + host + port` | 端点匹配为空时，发现同一主机端口上的其他 database |

同一 driver 才比较。MySQL 协议只看 driver、host、端口，不看 `engine` 文案。SQLite、不同端口、不同 driver 都不是匹配。

冲突路径上的 Schema 数量：

| 输入 | 结果 |
|---|---|
| `schemas` 恰好一项 | 使用该项 |
| MySQL 协议且 `schemas` 为空 | 使用 `database`，它就是这次要添加的 Schema |
| `schemas` 多于一项，或非 MySQL 协议且没有 Schema | `400 ENDPOINT_SCHEMA_COUNT`。不取第一项，不忽略其余项，不部分写入 |
| 没有端点匹配、也没有待确认的同服务器匹配 | 仍允许一次提交多个 `schemas`，沿用 Spec 124 |

## 5. 用户路径

「新建连接」和接入向导第 1 步共用下表。primary 只有一个。

| 当前事实 | primary | secondary | 结果 |
|---|---|---|---|
| 没有端点匹配，也没有同服务器匹配 | 新建连接 | 取消 | 沿用 Spec 124 |
| 唯一端点匹配，用户名相同，Schema 尚未登记，live-schemas 列出该 Schema | 添加 Schema | 仍要新建连接 | 添加 Schema 使用已有凭据。说明写明新密码不保存。secondary 确认后才写第二条连接 |
| 唯一端点匹配，用户名相同，Schema 已登记 | 返回已有连接 | 无 | 不创建、不追加 |
| 唯一端点匹配，用户名不同 | 仍要新建连接 | 添加到已有连接 | 不默认复用。secondary 必须写明将使用已有用户名，新用户名和密码不保存，并仍须通过 live-schemas |
| live-schemas 返回成功且没有目标 Schema | 仍要新建连接 | 无 | 不调用添加 Schema |
| live-schemas 返回失败 | 无 | 无 | 展示失败原因。不复用，不新建。用户可重试读取 |
| 多条端点匹配 | 添加到所选连接 | 无 | 用户选定一条。不能新建第三条 |
| 非 MySQL，同服务器但 database 不同 | 新建连接 | 取消 | 未带 `acknowledgeDifferentDatabase: true` 时停住。确认文案写明将新增一张连接卡片 |

接入向导在添加 Schema 成功后，用已有连接 ID 和新 Schema 进入第 2 步。新建连接抽屉成功添加后回到这张已有卡片，并刷新连接列表。

## 6. 核心流程（伪代码）

```text
normalizeHost(host):
  text = trim(host).toLowerCase()
  if text starts with "[" and ends with "]": text = text[1:-1]
  return text

isMysqlWire(input):
  return input.driver == "mysql" or input.engine in ["mysql", "starrocks", "doris"]

sameServer(existing, input):
  if input.driver == "sqlite" or existing.driver == "sqlite": return false
  if existing.driver != input.driver: return false
  if normalizeHost(existing.host) != normalizeHost(input.host): return false
  return int(existing.port) == int(input.port)

endpointMatches(existing, input):
  if not sameServer(existing, input): return false
  if isMysqlWire(input): return true
  return trim(existing.database) == trim(input.database)

usernamesMatch(existing, input):
  saved = existing.username
  if saved is missing or trim(saved) == "": return false
  return trim(saved) == trim(input.username)

conflictSchema(input):
  names = trim each item in input.schemas, keep duplicates and empty items
  if isMysqlWire(input) and names.length == 0:
    names = [trim(input.database)]
  if names.length != 1 or names[0] is not a valid schema name:
    reject 400 ENDPOINT_SCHEMA_COUNT
    detail.actual = names.length
  return names[0]

decide(connections, input, flags):
  if input.driver == "sqlite":
    return create

  endpoint = [c for c in connections if endpointMatches(c, input)]
  if endpoint.length > 0:
    schema = conflictSchema(input)
  if endpoint.length > 1:
    reject 409 ENDPOINT_ALREADY_CONNECTED
    detail.reason = "multiple"
    detail.matches = publicMatches(endpoint)
    # flags.acknowledgeSeparateConnection 在此无效

  if endpoint.length == 1:
    target = endpoint[0]
    if not usernamesMatch(target, input):
      if flags.acknowledgeSeparateConnection == true:
        return create
      reject 409 ENDPOINT_ALREADY_CONNECTED
      detail.reason = "username_differs"
      detail.matches = publicMatches([target])
      detail.schema = schema
    if schema in target.schemas:
      reject 409 SCHEMA_ALREADY_ON_CONNECTION
      detail.connectionId = target.id
      detail.schema = schema
    if flags.acknowledgeSeparateConnection == true:
      return create
    reject 409 ENDPOINT_ALREADY_CONNECTED
    detail.reason = "reuse_existing_credentials"
    detail.matches = publicMatches([target])
    detail.schema = schema

  sameServerHits = [c for c in connections if sameServer(c, input)]
  if sameServerHits.length > 0:
    conflictSchema(input)
    if flags.acknowledgeDifferentDatabase != true:
      reject 409 SAME_SERVER_DIFFERENT_DATABASE
      detail.matches = publicMatches(sameServerHits)
      detail.requestedDatabase = trim(input.database)
    return create

  return create

onCreate(input, flags):
  if input.dryRun == true:
    connections = read ktx.yaml
    return decide(connections, input, flags)

  withKtxYamlWriteLock:
    connections = read ktx.yaml again
    action = decide(connections, input, flags)
    if action != create: throw the decide error
    write secret if required
    write ktx.yaml inside the same lock, without queueing again
    record connection_create

onReuseChosen(targetId, schema):
  discard the password and, when usernames differ, the typed username
  live = GET /api/connections/{targetId}/live-schemas?refresh=1
  if live.status != "ok":
    stop and show live.reason
  if schema not in live.schemas:
    offer 仍要新建连接
    do not call add schema
  call POST /api/connections/{targetId}/schemas { schema, dryRun: false }
  refresh the existing card

publicMatches(rows):
  each item: id, driver, host, port, database, username, schemas
  never password, password file path, or secret contents
```

`decide` 抛错时不得写入。`createConnection` 原有的连接 ID 冲突仍返回 `CONNECTION_ALREADY_EXISTS`，并且发生在上述写队列之内。

## 7. 并发

进程内一条 Promise 队列，形式与 `webui/server/admin/tokens.ts` 的 `withTokenWriteLock` 相同。队列保证一个 WebUI 进程里的所有正式 `ktx.yaml` 写入按顺序完成读取、修改和写回；创建连接额外在同一队列项内完成端点复核与 secret 写入。

| 请求 | 队列 |
|---|---|
| `POST /api/connections` 且 `dryRun: true` | 不入队。读到的是当前文件。正式写入会在锁内重读 |
| `POST /api/connections` 且 `dryRun: false` | 从重读、匹配、写 secret 到写 YAML 持有队列 |
| 添加 / 删除 Schema、删除连接等正式 YAML 写入 | 最终读取、修改、写回共用同一队列；各自预览与前置探测不持锁 |
| 锁内的 YAML 写回 | 禁止再次入队，避免自锁 |

两个并发的正式创建若命中同一空端点：先入队的一条写入；后入队的一条重读后按已有连接返回 409，除非它自己满足「仍要新建连接」或「另一个 database」的确认条件。后入队的写入不得盖掉先入队已经追加的连接。

## 8. API

错误沿用现有信封。`matches` 放在 `error.detail` 里。实现须让 `supportedErrorDetail` 放行下列 `detail`，否则字段会被现有错误处理丢掉。

```ts
{
  ok: false,
  error: {
    code: "ENDPOINT_ALREADY_CONNECTED",
    message: string,
    detail: {
      reason: "multiple" | "username_differs" | "reuse_existing_credentials",
      schema?: string,
      matches: Array<{
        id: string,
        driver: string,
        host: string,
        port: string,
        database: string,
        username: string,
        schemas: string[]
      }>
    }
  }
}
```

| code | HTTP | detail | 用户可见说明 |
|---|---|---|---|
| `ENDPOINT_ALREADY_CONNECTED` | 409 | `reason: "multiple"` | 请选择要把 Schema 加到哪一条连接。 |
| `ENDPOINT_ALREADY_CONNECTED` | 409 | `reason: "username_differs"` | 已有连接使用另一用户名。默认不复用该连接。 |
| `ENDPOINT_ALREADY_CONNECTED` | 409 | `reason: "reuse_existing_credentials"` | 主机端口已有连接。添加 Schema 将使用已有凭据，新输入的密码不会保存。 |
| `SCHEMA_ALREADY_ON_CONNECTION` | 409 | `connectionId`、`schema` | 该 Schema 已在连接「{连接 ID}」上。 |
| `ENDPOINT_SCHEMA_COUNT` | 400 | `actual` | 该主机端口已有连接时，一次只能添加一个 Schema。 |
| `SAME_SERVER_DIFFERENT_DATABASE` | 409 | `matches`、`requestedDatabase` | 同一主机端口上的另一个 database 将新增一张连接卡片。 |
| `CONNECTION_ALREADY_EXISTS` | 409 | 沿用现状 | 连接 ID 已存在 |

确认字段：

| 字段 | 生效条件 | 无效条件 |
|---|---|---|
| `acknowledgeSeparateConnection: true` | 端点匹配恰好一条。写入第二条连接。审计 `newSummary.acknowledgedSeparateEndpoint: true` | 端点匹配多于一条。响应仍是 `reason: "multiple"`，不写入 |
| `acknowledgeDifferentDatabase: true` | 端点匹配为空、同服务器匹配非空。`dryRun: false` 在锁内重读后仍成立才写入。审计 `newSummary.acknowledgedDifferentDatabase: true` | 已构成端点匹配。不能用它代替上面的字段 |

两个字段都不新增 `changeType`。`detail.matches` 不含密码或 secret 路径。

复用成功后的刷新与 `AddSchemaDrawer` 相同：`project`、`connections`、`sources`、该连接的 `connectionTables`、`connectionLiveSchemas`、`catalogReloads`。

## 9. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Endpoint Already Connected | 主机端口已有连接 | 重复数据源、IP 冲突、端点唯一 | 软门禁发现同端点已有卡片。不是唯一约束 |
| Separate Connection Acknowledgement | 仍要新建连接 | 强制新建、忽略重复 | 唯一匹配下显式创建第二条连接 |
| Different Database Acknowledgement | 新建连接 | 再建一张数据库、追加 Schema | 同一主机端口上的另一个 database。提交前说明会多一张卡片 |

沿用「添加 Schema」和「新建连接」。禁止写成「添加数据源」「合并连接」「新建链接」。

连接 ID、host、端口、database、用户名、Schema 的 DOM 保持 `translate="no"` 与 `notranslate`。

Gate B 批准前不改术语标准正文。批准后再把上表补进 `webui/docs/00-product-terminology-standard.md`。

## 10. Design System Compliance

- `webui/docs/design-system/10-components-button.md`：同一状态只有一个 primary。
- 多条匹配和 live-schemas 失败时，没有「仍要新建连接」。
- 用户名不同时，primary 是「仍要新建连接」。「添加到已有连接」是 secondary，并写明复用已有用户名。
- 冲突说明放在当前抽屉或向导步骤内。连接 ID、host、端口、用户名、Schema 使用现有 `notranslate` 样式。

## 11. 验收

1. 已有 MySQL 连接指向 `demo-db:3306` 时，新连接 ID、同一 host 和端口、一个新 Schema，`dryRun: true` 与 `dryRun: false` 都返回 `error.code = ENDPOINT_ALREADY_CONNECTED`、`detail.reason = reuse_existing_credentials`。不新增连接，不新增密码文件。响应里没有顶层 `code` 或顶层 `matches`。
2. 用户名相同且强制刷新后的 live-schemas 含该 Schema 时，主按钮是「添加 Schema」。确认后只调用该连接的添加 Schema 接口，卡片数不变。界面能看到「将使用已有凭据，新输入的密码不会保存」。请求必须带 `refresh=1`，不得接受 TTL 缓存作为复用确认。
3. 该 Schema 已在连接的 `schemas` 中时，返回 `SCHEMA_ALREADY_ON_CONNECTION`，不重复追加。
4. 冲突请求的 `schemas` 为两项，或非 MySQL 协议且未填 Schema，返回 `400 ENDPOINT_SCHEMA_COUNT`。已有连接的 `schemas` 不变。无冲突的新建仍可一次提交多个 Schema。
5. 已保存用户名与输入用户名不同，且未带 `acknowledgeSeparateConnection` 时，返回 `detail.reason = username_differs`，不调用添加 Schema。带上该字段且锁内重读仍只有一条匹配时，允许第二条连接。
6. live-schemas 成功但不含目标 Schema 时，界面不调用添加 Schema，primary 为「仍要新建连接」。live-schemas 失败时，不添加也不新建，并提供「重试读取」。
7. 同一端点已有两条连接时，即使请求带 `acknowledgeSeparateConnection: true`，仍返回 `detail.reason = multiple` 和全部 `matches`。不写第三条。界面必须先选择一条已有连接。
8. 两个正式创建并发命中同一新 MySQL 端点时，队列内只保留先写入的一条。后写入的请求重读后按已有连接拒绝，且不能把先写入的连接从 `ktx.yaml` 中覆盖掉。
9. PostgreSQL 同一 host、端口、database 按端点匹配处理。database 不同且未带 `acknowledgeDifferentDatabase: true` 时，`dryRun: false` 返回 `SAME_SERVER_DIFFERENT_DATABASE` 并不写入。带上该字段后允许第二张卡片。只在界面展示说明、请求却不带字段时，服务端拒绝。
10. SQLite、不同端口、不同 driver、以及仅大小写不同的 host 比较：后者算匹配；前三者不返回本 Spec 的端点错误。`localhost` 与 `127.0.0.1` 不互配。
11. 接入向导添加 Schema 成功后，第 2 步使用已有连接 ID。
12. 现有不同 host 的连接保持原卡片。本 Spec 不改它们的 host、密码或 Schema 列表。
13. SQL Server 与 Oracle 的 live-schemas 分别使用其原生系统目录查询；不能因协议识别为 `unknown` 而让复用路径永久失败。
14. 新建连接与添加 / 删除 Schema、删除连接等正式 `ktx.yaml` 写入并发时，最终 YAML 同时保留各自变更，不发生最后写入覆盖前一项变更。

## 12. Gate B 决议

批准本文件即同时批准下面六条：

1. 本 Spec 是误操作软门禁，不是端点唯一约束，也不宣称已经堵住权限绕过。
2. MySQL、StarRocks、Doris 的端点键是 `driver + host + port`。用户名相同才默认添加 Schema。
3. PostgreSQL、SQL Server、Oracle 的端点键再加 `database`。同服务器的另一个 database 必须带 `acknowledgeDifferentDatabase`。
4. 端点匹配多于一条时不能新建下一条连接。唯一匹配才接受 `acknowledgeSeparateConnection`。
5. 冲突路径一次只接受一个 Schema。可见性以 live-schemas 为准；读取失败则停住。
6. 所有正式 `ktx.yaml` 写入共用单进程队列；创建连接在队列内重读复核。历史重复卡片不合并。
