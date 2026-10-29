# 运维问数连接 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 运维问数连接 Spec (Ops Evidence Connection Spec) |
| 文档类型 | Product / Data / ACL Spec |
| Spec 编号 | 149 |
| 版本 | v1.2 |
| 撰写日期 | 2026-09-24；v1.1 修订 2026-10-28；v1.2 定稿 2026-10-29 |
| 委托人 | xingchen |
| 状态 | **v1.2 定稿；实现已落地到工作树（未提交）**。定稿依据 [Codex 审阅](../../docs/reviews/2026-10-29-codex-review-spec149-ops-evidence.md)（结论：退回修订）。v1.2 处置 R01–R09。工单 v2.1 与本版对齐。T0 冻结结果见 §5.2。实现覆盖 SC-01–SC-23 的自动化断言，**尚未执行浏览器/E2E/镜像与客户环境验收** |
| 输出位置 | `webui/docs/149-ops-evidence-connection-spec.md` |
| 关联 WO | `webui/docs/plans/wo-202609-25-ops-evidence-connection.md` |
| 上游 Spec / 事实源 | Spec 07、125、127、131、144、151、171、189、191；内容根 `webui/server/paths.ts`；内容镜像 `webui/server/content-mirror.ts` |
| 关联术语 | `webui/docs/00-product-terminology-standard.md` §4.7 |
| 冲突裁决 | 与 Spec 131 冲突时，`lucy_admin` 与 `connections: ["*"]` 仍不得自动获得本连接。与 Spec 62 冲突时，仍不得新建第二套审计库。与 Spec 189 冲突时，使用概况、调用监控、访问日志三页仍以 Spec 189 为准。与 Spec 191 冲突时，本 Spec 不自动重载 KTX；连接未进入已启动 daemon 之前不可查询 |

---

## 修订

| 版本 | 日期 | 内容 |
|---|---|---|
| v1.0 | 2026-09-24 | 只读连接、两张视图、语义模板、`lucy_ops_reader`、删除保护。未落地 |
| v1.1 | 2026-10-28 | 默认用量行排除、Skill 与连接级 Wiki、Docker demo 的 `demo_ops`、夹具验收。未进入开发 |
| v1.2 | 2026-10-29 | 按 Codex 审阅定稿。资产写入解析后的内容根并镜像到项目根；确保发生在 KTX 启动之前，晚于 daemon 的写入不可查询；物理名四个字段分开冻结；配置冲突时拒绝查询；本连接不回答业务活跃 Token；Skill 通道沿用对象 ACL；已有文件冲突只记录不覆盖；`call_day` 只写 overlay；自身追问按事件整段排除 |

## 审阅处置

| 审阅 | 处置 |
|---|---|
| R01 阻塞 | §5.5、§8：复制目标是 `resolveContentPaths` 的三个目录，然后 `syncContentToProjectRoot` |
| R02 阻塞 | §8：entrypoint 在 `supervise_ktx` 之前完成确保与镜像。daemon 已启动后的新连接保持 `reload_required`，不自动重载 |
| R03 高 | §5.2：分开冻结 schema、source、物理表、`enabled_tables`。T0 绑定镜像 `ARG KTX_VERSION` |
| R04 高 | §7、§8：冲突不覆盖，同时目录与查询都拒绝 |
| R05 高 | §5.4、§5.5：不把 `token_label` 去重称为业务活跃 Token |
| R06 高 | §6：四个通道工具不绑定单篇；只保证不改其他对象的 ACL |
| R07 中 | §5.5：字节相同则跳过；身份、状态或 ACL 不同则保留并记冲突 |
| R08 中 | §5.4：`call_day` 只作为 overlay 派生列；验收要执行语义查询 |
| R09 中 | §5.3、§8：两张视图按同一事件集合排除；物理名回退只在连接归属缺失时使用 |

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Ops Evidence Connection | 运维问数连接 | 连接 ID `lucy-ops` | 管理员连接、默认业务连接、审计库连接（作卡片主称） | 指向审计热库只读视图的系统连接 |
| Ops Evidence Role | 运维问数角色 | `lucy_ops_reader` | Lucy 运维数据面角色、WebUI 所有者、登录管理员 | 只授权本连接两张视图的参考模板；与 `lucy_admin` 正交 |
| Ops Evidence Skill | 运维问数 Skill | Skill 名 `ops-questioning` | 业务 Skill（作本篇主称）、全局 Skill | 已发布 Skill；`roles_allowed` 只有 `lucy_ops_reader` |
| Demo Ops Agent | 演示运维问数 Agent | 用户 ID `demo_ops` | 把 `demo_readonly` 或 `lucy_admin` 当作本 Agent | 只写在 Docker demo 模板里 |

Protected DOM：`lucy-ops`、`lucy_ops_reader`、`ops_calls`、`ops_call_tables`、`ops-questioning`、`demo_ops`、`generated_sql`、`request_id`、Agent id、tool name、physical table。

既有术语沿用：**调用流水**、**生成 SQL**、**裁决原因**、**涉及数据表**、**Agent**、**Token**、**只读**、**连接 ID**、**参考模板**、**活跃 Agent**、**业务活跃 Token**、**访问账户**。

本连接只回答活跃 Agent。业务活跃 Token 仍只按使用概况的既有定义使用，不在本连接上用 `token_label` 去重另造一个同名人口。不新增「标签统计」术语。

---

## 1. 背景与问题

访问日志、调用监控和使用概况覆盖的是固定筛选项和预制卡片。它们回答不了：某张表上谁被拒绝、生成 SQL 是什么；某个工具的失败是否集中在一个 Agent；演示里刚才哪张示例表被问到。

本 Spec 用审计热库上的两张只读视图做成系统连接，并配上语义、连接级 Wiki 和运维问数 Skill。已授权的 Agent 用现有 `lucy_query` 追问。不新开 SQL 执行口，不新做页面。

冷启动不灌历史流水。Docker demo 已有订单、人员、退货三张表。先问这三张表，再问运维问数连接。第一问之前视图可以为空。

## 2. Goals

1. 启动后幂等存在连接 `lucy-ops`：`driver: sqlite`、`readonly: true`，数据库文件为当前审计热库。
2. 两张视图回答调用流水问题。SELECT 不含 Token 哈希、客户端 IP、User-Agent、设备名、权限快照、`args_summary`、`eval_mark`、问询原文。
3. 视图行集等于 Spec 189 默认用量，再按事件排除对本连接的追问。
4. 只有 `allow.connections` 显式写出 `lucy-ops` 的 Role 能看见该连接。`*` 与 `catalog_bound` 不算显式写出。连接未就绪时，显式授权也不提供查询。
5. 不写入 `setup.database_connection_ids`。确保逻辑不创建、不修改 Agent 或 Token，不并入 `lucy_admin`。
6. 删除连接 API 拒绝 `lucy-ops`。审计库、语义、Skill、Wiki 保持不动。
7. 语义、Skill、Wiki 写入解析后的内容根。缺失则复制；字节相同则跳过；契约不同则保留原文件并记冲突。随后镜像到 KTX 读取的项目根同级目录。
8. 本连接的人口只有活跃 Agent。问「活跃用户」、业务活跃 Token 或访问账户时，说明本连接不回答，并指向使用概况。不把 `token_label` 去重叫做业务活跃 Token。
9. Docker demo 模板包含用户 `demo_ops`，Role 只授权 `lucy-ops`。`demo_readonly` 仍只授权三张示例表。

## 3. Non-goals

- 不暴露 `.ktx/db.sqlite`、`.ktx-ui/eval/runs.sqlite`、`ui_page_views`。
- 不新建第二套审计库，不开放 `sql_execution`。
- 不把问询原文放进视图。第二拍回答到 Agent、表、生成 SQL、裁决原因。
- 不改 `/admin/audit`、`/admin/usage`、`/ops/calls` 的页面与口径。
- 不把口径写进 `webui/config/data-qa-instructions.md`，不写 `wiki/global`。
- 不自动重载 KTX，不修改 Spec 191 的「用户点确认才重载」。
- 不自动把 `lucy-ops` 加入业务 Role、`demo_readonly` 或 `lucy_admin`。
- 不灌审计历史，不加第四张示例表，不改三张 Superstore 表的数据、语义和 Wiki。
- 不修改 `examples/postgres-demo/`、`examples/executive-poc/`、`customer-config.example/`。
- 确保逻辑不写 `access.yaml`。平滑升级不补写 `demo_ops`。
- 不把两拍放进 `smoke:p0:demo` 的数值 gold，不做自然语言评测 gold。
- 不把四个通道工具收成「只能读这一篇」。其他 `roles_allowed: ["*"]` 的已发布对象仍按 Spec 151 可读。本 Spec 不修改那些对象的 ACL。

## 4. 产品形状

```text
audit.sqlite
  ops_calls / ops_call_tables
       │
       ▼
ktx.yaml connections.lucy-ops          # 不进 database_connection_ids
       │
       ▼
ContentPaths（env > ktx.yaml paths.content_root > <projectRoot>/config）
  semantic-layer/lucy-ops
  skills/lucy-ops/ops-questioning.md
  wiki/lucy-ops/ops-questioning.md
       │
       ▼
syncContentToProjectRoot
  <projectRoot>/{semantic-layer,skills,wiki}/lucy-ops
       ▲
lucy_ops_reader
       ▲
demo_ops（仅 Docker demo 模板）

demo-mysql 的三张示例表 ▲ demo_readonly（保持不变）
```

| 对象 | 标识 | 谁能看见 |
|---|---|---|
| 运维问数连接 | `lucy-ops` | 连接概览可见卡片。MCP 目录仅在就绪且显式授权时出现 |
| 运维问数角色 | `lucy_ops_reader` | 参考模板。Docker demo 模板自带同名正式 Role |
| 运维问数 Skill | `ops-questioning` | 对象 ACL 含该 Role，且该 Role 有 Skill 通道工具 |
| 演示运维问数 Agent | `demo_ops` | Docker demo 全新 seed |
| 问数入口 | 现有 `lucy_query` | 就绪且显式授权 |

连接概览卡片主称 **运维问数连接**。连接 ID 用 `translate="no"`。引擎显示 SQLite。

演示仍是两拍、两条连接。第 1 拍之前，第 2 拍的合法结果是空。

## 5. 数据契约

### 5.1 事实源

- 审计库：`LUCY_AUDIT_DB`，缺省 `<projectRoot>/.ktx-ui/audit.sqlite`。
- 视图在 `prepareTraceDatabase` 已设置 WAL 与 `busy_timeout` 之后创建。基表是 `access_log`、`access_log_sources`。
- 默认用量条件使用 `defaultUsageConditionSql(alias).sql`。不维护第二份协议名单。WHERE 可以读 `eval_mark` 与 `args_summary`，SELECT 不可以。
- `ts` 的写入格式是 UTC 的 ISO-8601（`toISOString()`）。`call_day` 是这个时间戳的 UTC 日历日，不是 Asia/Shanghai 的本地日。

### 5.2 四个名字分开冻结

T0 用镜像参数 `ARG KTX_VERSION` 所钉住的 KTX 执行。当前仓库该参数是 `0.16.0`。本机其他版本 CLI 的目录结果作废。版本变化后 T0 重做。

T0 分别记录下面四项，不允许把其中一项的字符串抄给另一项：

| 字段 | 含义 | 冻结前默认 | 什么情况下改 |
|---|---|---|---|
| schema | `_schema/<schema>.yaml` 的文件名，也是 Role `tableSelectors.schema` | `main` | 只有 schema 文件名不是 `main.yaml` 时才改。目录若返回不带 schema 的表名，Role schema 仍保持 `main` |
| sourceName | Manifest 表键，也是 overlay 文件名 | `ops_calls`、`ops_call_tables` | 不随物理名前缀变化 |
| physicalTable | Manifest `table:`，来自该 KTX 版本的目录 | `main.ops_calls`、`main.ops_call_tables` | 该版本目录给出无前缀名时，改成 `ops_calls`、`ops_call_tables` |
| enabled_tables | 连接块里的启用表范围 | 与 physicalTable 相同的字符串 | 与 physicalTable 使用同一套，不使用 sourceName 代替 |

Role 匹配 schema 的方式是 `_schema/*.yaml` 的文件名（`acl.ts` 的 `schemaFileName`），不是物理表名。

#### T0 冻结结果（2026-10-29，KTX 0.16.0）

用镜像 `ARG KTX_VERSION=0.16.0` 钉住的包执行 SQLite 目录，得到：

| 字段 | 冻结值 | 依据 |
|---|---|---|
| schema | `main` | 目录返回的表不带 schema；我们自己写 `_schema/main.yaml`，文件名即 Role 匹配依据，因此 Role schema **保持 `main`** |
| sourceName | `ops_calls`、`ops_call_tables` | Manifest 表键 = overlay 文件名 = Role `names` |
| physicalTable | `ops_calls`、`ops_call_tables`（**裸名**） | 该版本 SQLite 目录的 `catalog` 与 `db` 均为 null，物理名不带 `main.` 前缀 |
| enabled_tables | `ops_calls`、`ops_call_tables` | 与 physicalTable 同一套 |

`physicalTable` 取裸名而不是 `main.ops_calls`，还有一条硬证据：该版本的启用表范围解析对带段的名字会解析出 `db=main`，与 SQLite 的命名空间（`catalog=null`、`db=null`）不匹配而**落空**；裸名才命中。

冻结结果的落点：`webui/server/ops-evidence/contract.ts` 的 `OPS_EVIDENCE_FROZEN`，Manifest、overlay、Role 模板、Docker demo Role 与连接块都从这一处取值。KTX 版本变化后必须重做 T0 并同步该文件。

### 5.3 行排除

两张视图都先套默认用量，再排除**整次**自身追问。一次调用只要有一行来源属于自身追问，它就同时从 `ops_calls` 和 `ops_call_tables` 消失，不留下另一张表的残余行。

自身追问的来源行满足任一条件：

1. `connection_id = 'lucy-ops'`。
2. `connection_id` 为空，且 `physical_table` 是 `main.ops_calls`、`main.ops_call_tables`、`ops_calls`、`ops_call_tables` 之一。

`connection_id` 是其他非空值时，即使物理表同名，也不算自身追问。

无 `eval_mark` 的 `demo-mysql` 业务调用保留。`eval_mark` 为真且参数含探针名时排除。探针名标记里的 `demo-mysql` 不得单独滤掉普通演示问数。

### 5.4 语义层

仓库模板：`webui/config/ops-evidence/semantic-layer/lucy-ops/`。

项目内事实源：`<ContentPaths.semanticLayer>/lucy-ops/`。不是 `<projectRoot>/semantic-layer/`，除非 `LUCY_CONTENT_ROOT=.` 使两者相同。

`_schema/main.yaml` 只写物理列。禁止写入 `call_day`。`table:` 使用 §5.2 冻结的 physicalTable。

`ops_calls.yaml` 与 `ops_call_tables.yaml` 是 overlay。`call_day` 只出现在这里：

```yaml
columns:
  - name: call_day
    type: time
    role: time
    expr: date(ts)
```

表达式是 SQLite `date(ts)`，不是 MySQL `YEAR()`。含义是 UTC 日历日。

指标仍是列表项：`call_count = count(*)`，`denied_count` 与 `error_count` 按 `outcome` 条件求和，`total_duration_ms = sum(duration_ms)`。维度含 `agent_id`、`token_label`、`tool`、`outcome`、`call_day`、`generated_sql`、`decision_reason`、`request_id`。`ops_call_tables` 再加 `physical_table`、`connection_id`、`schema_name`、`source_name`。

`token_label` 是同一 Agent 内的标签，不是凭据身份。两个 Agent 可以用同一个标签；同一 Agent 删除后重建同名标签也不能区分前后两枚 Token。source 描述写明：可以按标签过滤明细，禁止把 `count(distinct token_label)` 称为业务活跃 Token 或活跃用户。活跃 Agent 是窗口内 `ops_calls` 的去重 `agent_id`。

生成 SQL 是高基数属性，只在已经按表、Agent、结果或 `request_id` 过滤之后取出，不作为默认分组。

描述不写入全局 data-qa instructions，不写入 `wiki/global`。

### 5.5 Skill、Wiki 与复制

仓库模板：

| 模板 | 内容根目标 |
|---|---|
| `webui/config/ops-evidence/skills/lucy-ops/ops-questioning.md` | `<ContentPaths.skills>/lucy-ops/ops-questioning.md` |
| `webui/config/ops-evidence/wiki/lucy-ops/ops-questioning.md` | `<ContentPaths.wiki>/lucy-ops/ops-questioning.md` |

Skill frontmatter：`name: ops-questioning`，`title: 运维问数`，`domain: lucy-ops`，`status: published`，`roles_allowed: [lucy_ops_reader]`。`prerequisites.sources` 含两个 source。`prerequisites.wiki_docs` 含 `lucy-ops/ops-questioning.md`。禁止 `*`、`demo_readonly`、`lucy_admin`。

Wiki frontmatter：`allowed_roles: [lucy_ops_reader]`。禁止放到 `wiki/global/`。

复制规则对语义、Skill、Wiki 相同：

```text
placeAsset(template, dest):
  if dest is absent:
    copy template
    return copied
  if dest bytes equal template:
    return unchanged
  else:
    do not write
    record OPS_EVIDENCE_ASSET_CONFLICT with the path
    return conflict
```

SC-14、SC-16 只覆盖仓库模板，以及字节与模板相同的目标文件。冲突文件保持原样，不宣称它满足「只有 `lucy_ops_reader`」或「`demo_readonly` 不可读」。草稿、`roles_allowed: ["*"]`、损坏的 frontmatter 都是冲突，不是覆盖理由。

复制之后调用现有 `syncContentToProjectRoot`。`LUCY_CONTENT_ROOT=.` 时该函数本身是空操作，因为内容根就是项目根。镜像失败时连接不可查询，状态为未就绪，不把内容根里的文件当成执行层已经看见。

Skill 正文顺序：

1. 问句要的是活跃 Agent，或已经写明 Agent：按窗口对 `ops_calls.agent_id` 去重后查询。
2. 问句说「活跃用户」「用户」「业务活跃 Token」或「活跃 Token」：不查询 Token 人口。说明本连接没有稳定的凭据身份，`token_label` 只在同一 Agent 内唯一。业务活跃 Token 以使用概况为准。
3. 明细里可以显示 `token_label`，作为该行的标签，不把去重计数叫做人口。
4. 访问账户和页面访问不在本连接。指向使用概况的界面使用视图，不查 `ui_page_views`。
5. `call_day` 是 `ts` 的 UTC 日历日。问「过去 7 天」时过滤这 7 个 UTC 日，并在回答里写明是 UTC。不把使用概况的卡片数字复述成查询结果。
6. 「哪张表被问得最多」和「谁被拒绝、生成 SQL 是什么」走 `ops_call_tables`。生成 SQL 只在过滤后的明细中取出。

Wiki 重复上述口径，并写明三张示例表的退货口径仍以 Docker demo 已有 Wiki 为准。

## 6. 权限

参考模板 `lucy_ops_reader` 注册在 `webui/server/admin/role-templates.ts`。允许集与 v1.1 相同：连接只有 `lucy-ops`，表只有两个 source，`row_access: all`，工具包含目录、查询、解释、Wiki 与 Skill 的只读通道。禁止 `source_scope: catalog_bound`。禁止并入 `lucy_admin`。

`schema` 使用 §5.2 的 schema，不使用 physicalTable。`names` 使用 sourceName。

四个通道工具的含义保持 Spec 151：对象能不能读，由该对象的 `roles_allowed` / `allowed_roles` 决定。授予工具不等于只打开 `ops-questioning`。本 Spec 不修改其他对象的 ACL。`demo_readonly` 读不到本篇，是因为本篇 ACL 没有它，不是因为通道工具被收窄。

连接可见：

```text
connectionVisible(role, "lucy-ops"):
  if readiness != current:
    return false
  return role.allow.connections is a list and contains the string "lucy-ops"
  # "*" does not match
  # catalog_bound does not match
```

`connection_list`、`lucy_catalog`、`lucy_query` 都走这个谓词。未就绪时直接查询返回 §8 的对应错误码，而不是空成功。

从模板创建正式 Role，以及把 Agent 绑到该 Role 时，沿用 Spec 131 的高权限警示，文案为「运维问数角色可查看生成 SQL」。不得写成所有者、登录管理员或超管。

### 6.1 Docker demo 模板

只改 `examples/docker-demo/project-template/webui/config/access.yaml`。

- 正式 Role id 为 `lucy_ops_reader`，允许集与模板相同，`schema` 用冻结值。
- 用户 `demo_ops`，显示名「演示运维问数」，Token 标签 `demo-ops`。模板只存哈希。明文沿用现有 demo Token 的环境变量方式，变量名 `LUCY_DEMO_OPS_TOKEN`，不写入本 Spec，不写入客户包。
- 不改 `demo_readonly`，不改 `lucy_admin` 的星号。编译结果里星号 Role 仍然没有 `lucy-ops`。

全新 seed 带上 `demo_ops`。已有卷的平滑升级保留原 `access.yaml`。

## 7. 连接配置

确保写入的块与 v1.1 相同：`driver: sqlite`，`readonly: true`，`database` 为当前审计库绝对路径，`schemas: [main]`，`enabled_tables` 为冻结后的 physicalTable。禁止调用 `createConnection`。不改 `database_connection_ids`，不改其他连接。

不一致：已存在的 `lucy-ops` 其 `driver` 不是 `sqlite`，或 `database` 不是当前审计库绝对路径，或 `readonly` 不是 `true`。不覆盖原块。状态为 `conflict`。目录不列出该连接。`lucy_query` 返回 `OPS_EVIDENCE_CONNECTION_CONFLICT`。警告文案仍是「运维问数连接配置不一致，未改写」。三种不一致都拒绝查询，不只记录日志。

## 8. 核心流程（伪代码）

支持的首次启动顺序写在 `scripts/runtime/docker-entrypoint.sh`，位于现有 `seed_project` 之后、`supervise_ktx` 之前：

```text
seed_project
ensureOpsEvidence()          # 视图、连接块、内容根资产、项目根镜像
sync_runtime_mirror()        # 现有步骤，必须发生在确保之后，避免冻住旧快照
writeStamp(ktxYamlDigest)    # <projectRoot>/.lucy-seed/ops-evidence-ktx-digest
supervise_ktx()              # ktx mcp start --project-dir $PROJECT_ROOT
wait until daemon ready
start WebUI
  ensureOpsEvidence()        # 幂等。块已一致且戳与摘要相同 → readiness = current
  compile policy
  serve
```

`ktx mcp start` 只在启动时解析连接。写盘不会让已经启动的 daemon 看见新连接。Spec 191 的重载由所有者确认，本 Spec 不自动调用它。

```text
ensureOpsEvidence():
  db = openAuditDatabase()
  DROP VIEW IF EXISTS ops_call_tables
  DROP VIEW IF EXISTS ops_calls
  createView both views
  assert select-list excludes forbidden columns
  assert base tables were not dropped

  yaml = read ktx.yaml
  if lucy-ops is absent:
    insert OPS_CONNECTION_BLOCK
    connectionWrite = inserted
  else if driver, database path, or readonly mismatches:
    log warning
    leave yaml unchanged
    readiness = conflict
    return
  else:
    connectionWrite = unchanged

  paths = resolveContentPaths(projectRoot)
  # env LUCY_CONTENT_ROOT, else ktx.yaml paths.content_root, else <projectRoot>/config
  for each semantic, skill, and wiki template:
    placeAsset(template, paths.<dir>/lucy-ops/...)
  mirror = syncContentToProjectRoot(projectRoot, paths)
  if mirror.failed > 0:
    readiness = not_ready
    return

  do not write access.yaml, wiki/global, or data-qa-instructions.md

readinessAfterEnsure(connectionWrite):
  if readiness is already conflict or not_ready:
    keep it
  else if stamp exists and stamp == digest(ktx.yaml) and connectionWrite == unchanged:
    readiness = current
  else:
    readiness = reload_required
    # do not call the Spec 191 reload controller

authorizeQuery(role, "lucy-ops"):
  if readiness == conflict:
    fail OPS_EVIDENCE_CONNECTION_CONFLICT
  if readiness != current:
    fail OPS_EVIDENCE_RUNTIME_NOT_READY
  if connectionVisible(role, "lucy-ops"):
    allow
  else:
    deny

removeConnection("lucy-ops"):
  fail 400 OPS_EVIDENCE_CONNECTION_PROTECTED
  message = "运维问数连接不能删除"
  do not delete the audit file, content-root assets, or project-root mirror
```

本地只启动 WebUI、daemon 已经在跑的情况，和「已有卷里原来没有 `lucy-ops`、这次确保才插入」相同：状态是 `reload_required`，查询返回 `OPS_EVIDENCE_RUNTIME_NOT_READY`。所有者按 Spec 191 确认重载并且连接级验证通过、戳被更新为当前摘要之后，状态才成为 `current`。

视图 SQL 的自身追问谓词两处共用。`<defaultUsageConditionSql(alias)>` 取该函数的 `.sql`：

```sql
CREATE VIEW ops_calls AS
SELECT
  id AS event_id,
  ts,
  user_id AS agent_id,
  token_label,
  tool,
  outcome,
  duration_ms,
  decision_reason,
  error_detail,
  generated_sql,
  tables AS tables_json,
  request_id
FROM access_log
WHERE <defaultUsageConditionSql('access_log')>
  AND NOT EXISTS (
    SELECT 1 FROM access_log_sources AS s
    WHERE s.access_log_id = access_log.id
      AND (
        s.connection_id = 'lucy-ops'
        OR (
          COALESCE(s.connection_id, '') = ''
          AND s.physical_table IN (
            'main.ops_calls', 'main.ops_call_tables',
            'ops_calls', 'ops_call_tables'
          )
        )
      )
  );

CREATE VIEW ops_call_tables AS
SELECT
  access_log.id AS event_id,
  access_log.ts,
  access_log.user_id AS agent_id,
  access_log.token_label,
  access_log.tool,
  access_log.outcome,
  access_log.duration_ms,
  access_log.decision_reason,
  access_log.error_detail,
  access_log.generated_sql,
  access_log.request_id,
  s.connection_id,
  s.schema_name,
  s.source_name,
  s.physical_table
FROM access_log
JOIN access_log_sources AS s ON s.access_log_id = access_log.id
WHERE <defaultUsageConditionSql('access_log')>
  AND NOT EXISTS (
    SELECT 1 FROM access_log_sources AS self
    WHERE self.access_log_id = access_log.id
      AND (
        self.connection_id = 'lucy-ops'
        OR (
          COALESCE(self.connection_id, '') = ''
          AND self.physical_table IN (
            'main.ops_calls', 'main.ops_call_tables',
            'ops_calls', 'ops_call_tables'
          )
        )
      )
  );
```

每次确保都 `DROP VIEW` 后重建。不得 `DROP` 基表。测试使用临时审计库。

删除接口在 dryRun 与确认写入时都返回 HTTP 400，`code = OPS_EVIDENCE_CONNECTION_PROTECTED`。不写 `config_change_log`。

## 9. 验收

夹具使用固定 UTC 时间戳。禁止用「跑测试那天的过去 7 天」做 gold。

| ID | 场景 | 期望 |
|---|---|---|
| SC-01 | Role 未显式列出 `lucy-ops`，包括 `*` 与 `catalog_bound` | 目录无该连接；查询被拒绝 |
| SC-02 | 夹具中窗口内有对 `superstore_orders` 的 `denied` 行，并带 `generated_sql` | 能按物理表取出 Agent 和生成 SQL |
| SC-03 | 另有一个 Agent 对 `superstore_returns` 的 `error` 行 | 能按工具汇总到该 Agent |
| SC-04 | 一次调用同时有 `lucy-ops` 来源和其他表来源 | 该事件在两张视图中都不出现 |
| SC-05 | 确保完成且状态为 `current` | `readonly: true`，且 `database_connection_ids` 不含 `lucy-ops` |
| SC-06 | 两张视图的 SELECT 列表 | 不含 Token 哈希、`client_ip`、`user_agent`、`device_name`、权限快照、`args_summary`、`eval_mark`、问询原文 |
| SC-07 | 删除 `lucy-ops` | HTTP 400，`OPS_EVIDENCE_CONNECTION_PROTECTED`；审计库、内容根资产、项目根镜像仍在 |
| SC-08 | 已有块的 driver、路径、`readonly` 分别错误 | 原块保留；目录无该连接；查询返回 `OPS_EVIDENCE_CONNECTION_CONFLICT` |
| SC-09 | 目标与模板字节相同；或目标是草稿、`roles_allowed: ["*"]`、损坏的 frontmatter | 字节相同则不改写。其余三类字节也不变，并记 `OPS_EVIDENCE_ASSET_CONFLICT`。不宣称 SC-16 对冲突文件成立 |
| SC-10 | `lucy_admin` 与 Docker demo 的星号 Role | 编译后的连接集不含 `lucy-ops` |
| SC-11 | 确保前后 | `access.yaml` 整文件字节不变 |
| SC-12 | 协议调用，以及 `eval_mark` 为真且参数含 `demo-mysql` 的调用 | 都不在视图中 |
| SC-13 | `eval_mark` 为空、连接 `demo-mysql`、表为订单表的 `ok` 调用 | 出现在 `ops_call_tables` |
| SC-14 | 模板 Skill 与 Wiki | ACL 只有 `lucy_ops_reader`。正文含：只回答活跃 Agent、不把 `token_label` 去重称为业务活跃 Token、访问账户不在本连接、`call_day` 是 UTC、生成 SQL 不作为默认分组 |
| SC-15 | Docker demo 模板 | 存在 `demo_ops`，Role 只含 `lucy-ops`；`demo_readonly` 仍只有三张示例表 |
| SC-16 | 加载的是模板 Skill | `demo_readonly` 不可发现、不可读取。冲突文件不适用本条 |
| SC-17 | 问句契约 | 由 SC-14 的正文断言覆盖，不新增自然语言 gold |
| SC-18 | 默认 `config/`、自定义 `LUCY_CONTENT_ROOT`、`LUCY_CONTENT_ROOT=.` | 事实源落在解析后的内容根；除 `=.` 外，项目根同级目录在镜像后也有同一文件 |
| SC-19 | 临时项目按 entrypoint 顺序启动，stub daemon 在确保和镜像之后才读取 `ktx.yaml` | stub 看到的配置已含只读 `lucy-ops`，项目根已有语义文件。不需要重载，状态为 `current` |
| SC-20 | daemon 已启动后确保才插入连接 | 查询返回 `OPS_EVIDENCE_RUNTIME_NOT_READY`。不自动调用 Spec 191 重载 |
| SC-21 | 用仓库语义模板对临时库执行查询 | UTC 日过滤、四个指标、过滤后的生成 SQL 明细都成功。Manifest 不含 `call_day` |
| SC-22 | 其他连接的 `physical_table` 为 `ops_calls`，且 `connection_id` 非空也不是 `lucy-ops` | 该行保留。空 `connection_id` 且物理名命中的行按自身追问排除 |
| SC-23 | 打开运维问数角色的详情，以及把 Agent 绑到该 Role | 可见「运维问数角色可查看生成 SQL」；文案不含所有者、登录管理员、超管 |

SC-02、SC-03、SC-13 构成闭环：示例表上的一行调用能在视图里按表取回。不要求测试进程调用大模型。

## 10. 实现落点

| 区域 | 文件 | 改动 |
|---|---|---|
| 视图 | `webui/server/proxy/audit.ts` | 重建两张视图；WHERE 使用 `defaultUsageConditionSql(...).sql` 与事件级自身排除 |
| 确保 | 新建专用模块 | 视图、连接块、内容根复制、`syncContentToProjectRoot`、就绪状态 |
| 启动顺序 | `scripts/runtime/docker-entrypoint.sh` | 在 `supervise_ktx` 之前调用确保，并在其后写摘要戳 |
| 查询门 | 目录过滤与 `lucy_query` | 未就绪返回对应错误码；`lucy-ops` 只认显式列表项 |
| 模板 | `webui/config/ops-evidence/` | 语义、Skill、Wiki |
| 角色模板 | `webui/server/admin/role-templates.ts` | `lucy_ops_reader` |
| 删除保护 | `removeConnection` 与删除路由 | 拒绝 `lucy-ops` |
| 连接概览 | `ConnectionOverview.tsx` | 主称「运维问数连接」；删除入口不可用 |
| 高权限警示 | Spec 131 的同一处 | SC-23 的文案 |
| Docker demo | `examples/docker-demo/project-template/webui/config/access.yaml` | 只增加 Role 与 `demo_ops` |
| 测试 | `webui/server/__tests__/` 与 entrypoint 顺序测试 | 临时库、临时项目根；覆盖 SC-01 至 SC-23 |

UI 只改连接卡片称谓、删除入口和既有高权限警示。不新增导航，不新增页面。

## 11. 风险

T0 未用镜像所钉的 KTX 版本冻结之前，不把物理表字符串写进最终断言。Role schema 默认保持 `main`。

审计库由本进程创建视图，连接块必须 `readonly: true`。不另开读写连接去改基表。

`syncContentToProjectRoot` 失败时执行层仍可能看见旧目录。这时状态保持未就绪，避免目录已授权但查询找不到 source。

Spec 191 不自动重载。已有卷第一次补上 `lucy-ops` 时，在所有者确认重载并完成连接级验证之前，第二拍不可用。这是就绪边界，不是再灌一份历史流水。
