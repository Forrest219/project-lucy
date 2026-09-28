# 接入向导：无现成 YAML 也能完成选表

| 元数据 | 内容 |
|---|---|
| 文档名称 | 接入向导：无现成 YAML 也能完成选表 |
| 文档类型 | Spec |
| 版本 | v0.3 |
| 撰写日期 | 2026-09-28 |
| 撰写人 | Cursor |
| 委托人 | xingchen |
| 基于材料 | 2026-09-28 对 `/connections` 接入向导的审阅：跳过 Schema Manifest 后第 3 步无可选表，第 4–6 步不可达；Spec 130 v1.1；`PUT /api/connections/:connId/enabled-tables` 的 `TABLE_NOT_SCANNED`（Spec 116）；`GET /api/connections/:connId/live-schemas` 仅返回 Schema 与表数量（Spec 107） |
| 适用范围 | 接入向导第 1 步出口文案、第 2–6 步用户路径、读库生成 Schema Manifest、失败恢复和就绪状态表达。上传与覆盖的数据契约以 Spec 158 为准 |
| 输出位置 | `webui/docs/157-setup-assistant-live-structure-ux-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 157 |
| 关联页面 | `/connections` 上的接入向导 |
| 上游 Spec | Spec 130（接入向导与完整运行时就绪门禁）；Spec 107（库内 Schema 发现）；Spec 116（启用表必须先出现在本地 Schema Manifest）；Spec 158（已有 Schema Manifest 的上传与覆盖契约，以及向导内不写表级 YAML） |
| 状态 | 已批准（Gate B，2026-09-28） |
| 日期 | 2026-09-28 |
| 范围 | 第 2 步信息架构、单 Schema 解析、已有 Manifest 复用、最小 Schema Manifest 生成、幂等恢复、显式选表和三层就绪状态 |

本文件描述优化后用户能完成的路径，以及相对当前向导的体验差。

## Gate B 决议（2026-09-28）

1. 恢复以 D1 和 `manifest_written_reload_pending` 为准。实现必须修改 `deriveAssistantResumeState`：不得再取 `connection.schemas[0]`。Manifest 已写入但 Catalog 未同步时停在第 2 步，不得打开空的第 3 步。
2. 验收 6 验证更新后的恢复状态机。连接卡片进度与「继续向导」打开的步骤一致；存在恢复态时步骤为 2。不再要求与旧函数行为逐字一致。
3. Spec 158 一并批准。入口文案、按钮层级和流程状态以本文件为准；上传与覆盖的数据契约以 Spec 158 为准。

## 1. 当前体验

用户连上数据库之后，向导要求一份已经写好的 Schema Manifest。

| 步骤 | 用户实际遇到的事 |
|---|---|
| 1. 连接数据库 | 填写连接信息并通过连通测试。步骤条和主按钮已经预告“上传 Schema Manifest”，使用户误以为必须提前准备 YAML |
| 2. 上传 Schema Manifest | 只能上传或粘贴 YAML。文案写明文件通常由 ddl-export 生成。按钮「稍后上传 Schema Manifest」会进入第 3 步 |
| 3. 选择启用表 | 候选表只来自 `/api/sources`。没有本地 Manifest 时显示「暂未发现数据表」，继续按钮禁用 |
| 4. 丰富业务语义 | 默认可以不上传单表 YAML，但必须已有至少 1 张启用表。跳过 Manifest 后到不了这里 |
| 5. 注入业务知识 | 业务 Wiki 可以跳过，但被第 3 步挡住 |
| 6. 连接 Agent 客户端 | 没有 Manifest 或启用表时不可达；即使到达，结构已准备也不等于运行时和客户端已经就绪 |

Spec 130 写的是：跳过上传后降级为库内扫描，第 3 步的候选来自 Manifest 或物理表。当前实现没有这条路。`live-schemas` 只有 Schema 名和表数量。新启用的表若不在本地 `semantic-layer/<connection>/_schema/*.yaml` 中，保存返回 `TABLE_NOT_SCANNED`。

因此「稍后上传」是一条走不通的下一步。只把第 3 步改成展示库内表名，保存仍会失败。

## 2. 优化后体验

连上数据库的人进入“准备表结构”：Lucy 先确定本次处理的唯一 Schema，再读取表和字段，校验并写入最小 Schema Manifest，刷新 Catalog 后进入选表。已有 Manifest 默认直接复用；用户只有在主动选择“替换已有 Schema Manifest”时才进入 Spec 158 的覆盖确认。用户不想继续时退出向导，稍后恢复仍回到第 2 步，不进入空的第 3 步。

第 3 步必须由用户明确选择开放给 Agent 的表，不能根据表数量自动全选。第 4 步默认“暂不补充业务语义，使用数据库字段信息继续”，不要求事先准备每张表的语义 YAML。第 5 步仍可跳过。

第 6 步区分三层状态：

1. `structureReady`：Schema Manifest 已存在且至少 1 张表已启用。
2. `serviceReady`：沿用 Spec 130 的完整运行时门禁。
3. `clientReady`：`serviceReady` 成立且已取得有效凭据。

只有 `clientReady` 才能宣称“可以开始问数”。

### 2.1 三条用户路径

| 用户手头有什么 | 优化前 | 优化后 |
|---|---|---|
| 只有数据库账号 | 第 2 步无法继续。点「稍后上传」后第 3 步是空列表，第 4–6 步不可达 | 主按钮从数据库读取表结构并写入最小 Schema Manifest；用户明确选择启用表后，可不上传任何 YAML 到达第 6 步 |
| 已有 Schema Manifest | 上传后可以选表；目标文件已存在时容易产生“是否需要重传”的困惑 | 系统检测到已有 Manifest 后，主按钮变为「使用已有 Schema Manifest」；刷新 Catalog 后直接选表。主动替换才走上传与覆盖确认 |
| 只想先保存连接 | 「稍后上传」看起来像继续，实际停在空的第 3 步 | 「结束并稍后继续」关闭向导并保存第 2 步断点；连接卡片的进度和「继续向导」恢复到同一步 |

### 2.2 逐步对照

| 步骤 | 优化前 | 优化后 | 用户得到的变化 |
|---|---|---|---|
| 1 | 主 CTA 为「继续：上传 Schema Manifest」 | 主 CTA 为「继续：准备表结构」 | 不再暗示用户必须提前准备 YAML |
| 2 | 标题为「上传 Schema Manifest」；上传是唯一走得通的动作；跳过进入空步骤 | 标题为「准备表结构」；支持读库、复用已有 Manifest、上传替换和退出；Schema 不明确时先选择一个 | 没有 YAML 也能完成，同时不破坏已有资产 |
| 3 | 没有 Manifest 时 0 张表；新范围默认全选 | 只有 Catalog 已产生候选表时才出现；新范围默认不选，提供全选、清空和搜索 | 空步骤消失；开放范围由用户明确决定 |
| 4 | “基础字段语义”可能让用户误以为系统已经生成业务语义 | 默认「暂不补充业务语义，使用数据库字段信息继续」；不生成指标，不写表级 YAML | 准确表达结构信息与业务语义的边界 |
| 5 | 可选，但被第 3 步挡住 | 仍可跳过 | 业务 Wiki 不是前置条件 |
| 6 | 到达后即展示 Token、配置和 Hello World，容易把结构完成误认为可问数 | 按 `structureReady`、`serviceReady`、`clientReady` 分层展示；运行时未就绪时只展示阻断项与重试入口 | 用户知道“还差什么”，不会复制一份暂不可用的配置 |

语义 YAML 在优化前后都不是必填。用户原始反馈中“开始前必须备齐每张表的语义 YAML”是由步骤命名和流程阻断造成的认知结果，不是产品契约；本 Spec 同时修正流程和该认知误导。

## 3. 目标

1. 只有数据库账号的用户，能在本向导内启用至少一张表并到达第 6 步。
2. 第 1 步出口和第 2 步标题不再把“上传 Schema Manifest”表达为唯一主路径。
3. 「稍后上传 Schema Manifest」不再作为进入第 3 步的按钮。
4. 第 3 步在候选表为 0 时不打开；首次进入时不自动开放任何表。
5. 已有 Schema Manifest 默认复用，只有用户主动替换时才覆盖。
6. 不新造资产类型。读库产物仍是 Schema Manifest，写入既有路径 `semantic-layer/<connection>/_schema/<schema>.yaml`。
7. 不放宽 Spec 116：新启用的表必须已经出现在这份 Manifest 里。读库路径先生成并校验文件，再刷新 Catalog，再选表。
8. 读库写盘后即使 Catalog 刷新失败，也能通过重试恢复，不形成“文件已存在但不能继续”的死路。
9. 第 6 步沿用 Spec 130 的完整运行时就绪门禁，结构完成不得被表述为问答就绪。

## 4. Non-Goals

- 不改第 1 步的连接字段、连通测试门禁和创建连接 API；只改成功后的下一步文案。
- 不在向导里生成业务指标、维度、关联或 `descriptions.ai`。
- 不把业务 Wiki 改成必填。
- 不改连接概览、语义资产工作台、启用表范围页的日常编辑方式。
- 不在本 Spec 里重做弹窗宽度或数据库类型下拉的视觉样式。
- 不改变 Spec 130 的运行时就绪事实源，不另造一套简化 `serviceReady`。
- v0.2 不支持通过原生协议从 SQLite、SQL Server、Oracle 读取表结构。这些类型走上传路径。

## 5. 已审阅的产品决策

| 编号 | v0.2 决策 | 理由 |
|---|---|---|
| D1 | 单次只处理一个明确 Schema；第 1 步未明确且存在多个候选时，留在第 2 步让用户选择一个 | 控制一次生成和选表的认知范围，同时避免静默采用 `schemas.first` |
| D2 | 已有 Manifest 时默认复用并刷新 Catalog；不自动覆盖。用户主动选择替换时，按 Spec 158 确认覆盖 | 保护已有资产，又不把“文件已存在”变成阻断 |
| D3 | 首次进入第 3 步始终默认不选；已有启用范围则保留有效交集。提供显式「全选」与「清空」 | 启用表是数据访问范围，不能因表数少而默认全部开放 |

### 5.1 唯一 Schema 的解析规则

读库和写盘前必须得到一个非空、用户可见、可追溯的目标 Schema：

1. 第 1 步填写了初始 Schema：采用该值并展示；读库前再确认它当前可访问。
2. 第 1 步未填写，但已有 Manifest 只对应 1 个 Schema：采用已有 Manifest 的 Schema，不强制再次连接数据库才能复用。
3. 前两项都无法确定目标时，才读取库内非系统 Schema；只有 1 个候选则预选，有多个候选则在第 2 步显示单选控件。
4. 选定前主动作禁用。第 1 步填写的 Schema 不存在或不可访问时，停在第 2 步说明原因，允许重新选择、使用已有 Manifest、上传或退出。
5. 库内 Schema 查询失败但已有 Manifest 可唯一确定目标时，仍允许“使用已有 Schema Manifest”；只禁用依赖实时数据库的读库动作。
6. 一次只为选中的 Schema 生成一份 Manifest；完成后可回到连接概览添加其他 Schema。

Schema 名、数据库对象名和路径必须添加 `translate="no"` 与 `notranslate`。

## 6. 第 1、2 步界面

### 6.1 第 1 步出口

- 步骤条第 2 步名称：`准备表结构`。
- 第 1 步主 CTA：`继续：准备表结构 →`。
- 不在第 1 步暗示用户必须上传文件。

### 6.2 第 2 步标题与说明

- 标题：`准备表结构`。
- 说明：`Lucy 可以从数据库读取当前 Schema 的表与字段；如果您已有 Schema Manifest，也可以直接使用或上传替换。`
- 目标连接和目标 Schema 始终在动作区上方可见。

### 6.3 状态化动作层级

同一状态最多一个 primary；主动作随事实变化，不保留不可用的“摆设主按钮”。

| 当前事实 | primary | secondary | ghost | 结果 |
|---|---|---|---|---|
| 支持读库、目标 Manifest 不存在 | 从数据库读取表结构 | 我已有 Schema Manifest | 结束并稍后继续 | 生成并校验 Manifest，刷新 Catalog 后进入第 3 步 |
| 目标 Manifest 已存在 | 使用已有 Schema Manifest | 替换已有 Schema Manifest | 结束并稍后继续 | 不改文件；刷新 Catalog 后进入第 3 步 |
| 数据库类型不支持读库 | 上传 Schema Manifest | 无 | 结束并稍后继续 | 按 Spec 158 上传，成功后进入第 3 步 |
| Schema 尚未唯一确定 | 选择目标 Schema 后继续 | 我已有 Schema Manifest | 结束并稍后继续 | 选定前 primary 禁用，并显示可理解的禁用原因 |
| Manifest 已写入、Catalog 刷新待恢复 | 重新同步并继续 | 替换已有 Schema Manifest | 结束并稍后继续 | 复用已写入文件重试，不重复写盘 |

读库支持按连接的 `wireProtocol` 判断：`mysql` 与 `postgres` 可用；StarRocks、Doris 使用 MySQL 协议时归入 `mysql`。SQLite、SQL Server、Oracle 在 v0.2 走上传路径。

### 6.4 反馈与无障碍

- 读库进行中主按钮使用稳定宽度的 loading 文案「正在读取表结构...」，设置 `aria-busy="true"`。
- 读取、校验、写盘、Catalog 刷新等阶段通过 `role="status"`、`aria-live="polite"` 报告，不另做阻断式进度弹层。
- 失败提示使用 `role="alert"`；出现后把焦点移动到错误摘要，保留「重试」「上传」「退出」入口。
- 异步完成并进入第 3 步后，焦点移动到第 3 步标题。
- 关闭后重新打开，焦点和步骤恢复遵守 Spec 130 的对话框与断点续配规则。

禁止文案：`稍后上传 Schema Manifest`、`跳过 Manifest`、裸用 `上传 YAML`、把“结构已准备”写成“问答已就绪”。

## 7. 最小 Schema Manifest

只包含当前 Schema 的 `BASE TABLE`。跳过系统 Schema。字段至少包括：

- `name`
- `type`：映射到既有 `number` / `string` / `time` 之一
- `nullable`：按库内非空约束
- `pk`：仅当库内主键为真
- `descriptions.db`：仅当列注释非空时写入

不写 `descriptions.ai`、measures、dimensions、segments、joins。

示意：

```yaml
tables:
  orders:
    table: analytics.orders
    columns:
      - name: id
        type: number
        pk: true
        nullable: false
      - name: created_at
        type: time
        nullable: false
        descriptions:
          db: 创建时间
```

### 7.1 类型降级反馈

无法映射的数据库类型可以降级为 `string`，但不得静默处理。写盘前展示结果摘要：

- 读取到的表数和字段数；
- 映射为 `number` / `string` / `time` 的字段数；
- 无法识别而降级为 `string` 的字段数、原始类型和受影响字段；
- 两个选择：继续生成，或改用已有 Schema Manifest。

降级警告不把数据库结构描述成“业务语义”，也不声称已生成指标或口径。

### 7.2 写盘与恢复边界

1. 先在内存中生成并按 Schema Manifest 规则校验，校验失败不写文件。
2. 目标不存在时采用 create-if-absent 写入，防止并发静默覆盖。
3. 目标已存在时不从读库路径覆盖；切换到“使用已有”或显式上传替换。
4. 写文件成功后刷新该连接的 Catalog。第 3 步只展示刷新后 `/api/sources` 中属于该连接和 Schema 的表。
5. Catalog 刷新失败时保留有效 Manifest，并在现有接入向导 draft 中记录 `manifest_written_reload_pending` 恢复态；该状态须在关闭、重新打开后保留，重试只刷新 Catalog，不重复写盘，也不新增资产类型。
6. 不用库内扫描结果直接调用启用表接口。

## 核心流程（伪代码）

```text
openStep2(connectionId):
  connection = read connection
  manifestSchemas = read local Manifest schemas for connectionId
  targetSchema = resolve from connection.step1Schema or one manifestSchema

  if targetSchema is still unresolved:
    liveSchemas = read non-system schemas visible to the connection
    if liveSchemas query fails:
      stay on step2
      show live Schema discovery error
      keep upload and exit available
      return
    targetSchema = resolveTargetSchema(liveSchemas)

  if targetSchema is invalid or inaccessible:
    stay on step2
    show schema selection or accessibility error
    keep use_existing_manifest when available, plus upload and exit
    return

  manifest = find Manifest(connectionId, targetSchema)
  recovery = read setup recovery state(connectionId, targetSchema)

  if recovery == manifest_written_reload_pending:
    primary = retry_catalog_reload
  else if manifest exists:
    primary = use_existing_manifest
  else if connection.wireProtocol in {mysql, postgres}:
    primary = read_structure
  else:
    primary = upload_manifest

step2(choice):
  if choice == exit:
    save draft(step = 2, connectionId, targetSchema)
    close assistant
    return

  if choice == use_existing_manifest:
    require Manifest exists
    reload catalog for connectionId
    if reload fails:
      stay on step2
      show retry_catalog_reload, replace_manifest, exit
      return
    sources = read /api/sources filtered by connectionId + targetSchema
    if sources is empty:
      stay on step2
      explain that the existing Manifest contains no usable tables
      show replace_manifest and exit
      return
    clear recovery state
    open step3 with sources
    return

  if choice == upload_manifest or choice == replace_manifest:
    validate and upload through Spec 158
    require explicit overwrite confirmation only when target exists
    reload catalog for connectionId
    if reload fails:
      record manifest_written_reload_pending
      stay on step2 with retry_catalog_reload
      return
    sources = read /api/sources filtered by connectionId + targetSchema
    if sources is empty:
      stay on step2 and explain that the file has no usable tables
      return
    clear recovery state
    open step3 with sources
    return

  if choice == read_structure:
    require targetSchema is a single explicit Schema
    require connection.wireProtocol in {mysql, postgres}
    if Manifest now exists:
      switch to use_existing_manifest; do not overwrite
      return

    rows = query BASE TABLE columns for targetSchema
    if query fails:
      stay on step2; show retry, upload, exit
      return
    if rows is empty:
      stay on step2; explain that this Schema has no BASE TABLE
      return

    generated = build minimal Schema Manifest in memory
    validation = validate generated as schema_manifest
    if validation fails:
      stay on step2; show validation errors; do not write disk
      return

    if generated contains downgraded types:
      show result summary and affected fields
      require user to choose continue_generation or upload_manifest
      if user chooses upload_manifest: return to upload path

    create Manifest only when target does not exist
    if create reports target_exists:
      switch to use_existing_manifest; do not overwrite
      return

    reload catalog for connectionId
    if reload fails:
      record manifest_written_reload_pending
      stay on step2; primary = retry_catalog_reload
      return

    sources = read /api/sources filtered by connectionId + targetSchema
    if sources is empty:
      record manifest_written_reload_pending
      stay on step2; explain reload produced no usable tables
      return

    clear recovery state
    open step3 with sources

  if choice == retry_catalog_reload:
    require Manifest exists
    reload catalog for connectionId
    if reload succeeds and filtered sources is non-empty:
      clear recovery state
      open step3
    else:
      stay on step2; keep retry, replace_manifest, exit available

step3:
  availableTables = /api/sources filtered by connectionId + targetSchema
  require availableTables.count > 0

  persisted = enabledTables intersect availableTables
  if persisted is non-empty:
    default selection = persisted
  else:
    default selection = none

  offer search, select_all, clear
  require selected.count > 0
  write enabled_tables
  if TABLE_NOT_SCANNED:
    stay on step3; show the error; do not advance
    offer return_to_step2_and_reload
    return
  open step4

step4:
  require enabledTables.count > 0
  default action = continue_with_database_field_information
  do not upload semantic overlay inside the assistant (Spec 158)
  do not claim business semantics, metrics or definitions were generated
  open step5

step5:
  save wiki or skip
  open step6

step6:
  structureReady = manifest.present AND enabledTables.count > 0
  serviceReady = structureReady
    AND probe.ok
    AND runtime.config.loaded(connectionId)
    AND runtime.catalog.synced(connectionId)
    AND runtime.policy.healthy
    AND runtime.execution.loaded(connectionId)
    AND endpoint.valid
  clientReady = serviceReady AND valid credential exists/generated

  if NOT structureReady:
    list structure blockers; do not show client actions
  else if NOT serviceReady:
    say structure is prepared but runtime is not ready
    list runtime blockers and show retry
    disable token issuance, config copy and Hello World actions
  else if NOT clientReady:
    say service is ready and enable credential issuance
    do not claim the client is ready
  else:
    say client connection is ready
    enable config copy and Hello World
```

## 8. 验收条件

### 8.1 信息架构与基础路径

1. 步骤条第 2 步显示「准备表结构」，第 1 步主 CTA 显示「继续：准备表结构 →」；向导主路径不再把上传文件表达为必需前置条件。
2. 新的 MySQL、PostgreSQL、MySQL 协议 StarRocks 或 Doris 连接，不上传文件，能通过「从数据库读取表结构」生成 Manifest 并进入第 3 步。
3. 磁盘上的生成文件位于既有 Schema Manifest 路径，不包含 `descriptions.ai`、measures、dimensions、segments 或 joins。
4. SQLite、SQL Server、Oracle 的第 2 步以「上传 Schema Manifest」为 primary，不显示一个不可用的读库主按钮。
5. 页面不存在「稍后上传 Schema Manifest」或「跳过 Manifest」。点「结束并稍后继续」后关闭向导；重新打开仍从第 2 步恢复。
6. 连接卡片的接入进度与「继续向导」打开的步骤等于更新后的 `deriveAssistantResumeState`。存在 `manifest_written_reload_pending` 时步骤为 2。该函数不得取 `connection.schemas[0]`，也不得把 Catalog 尚未同步的连接恢复到空的第 3 步。

### 8.2 Schema 解析与已有 Manifest

7. 第 1 步未填写 Schema 且库内只有一个非系统 Schema 时，第 2 步显示并预选该 Schema。
8. 第 1 步未填写 Schema 且有多个候选时，第 2 步要求单选；选定前读库动作不可执行，并有可读的禁用原因。
9. 第 1 步填写了不可访问的 Schema 时，不静默回退到 `schemas.first`；页面显示错误并允许重新选择、上传或退出。
10. 目标 Manifest 已存在时，primary 为「使用已有 Schema Manifest」。点击后原文件字节不变，Catalog 刷新成功后进入第 3 步。
11. 只有点击「替换已有 Schema Manifest」并按 Spec 158 确认覆盖后才可改写已有文件。

### 8.3 幂等恢复与错误处理

12. 读库查询失败或返回 0 张 `BASE TABLE` 时停在第 2 步，Manifest 不写盘，重试、上传和退出仍可用。
13. 生成内容校验失败时不写盘，并展示结构化校验错误。
14. Manifest 写入成功、Catalog 刷新失败时进入 `manifest_written_reload_pending`；再次点击主动作只重试刷新，不重复写盘，也不因文件已存在形成死路。
15. 恢复态刷新成功且 `/api/sources` 有候选表后进入第 3 步，并清除恢复态。
16. 写盘前若目标被其他操作创建，读库路径不覆盖文件，界面切换为「使用已有 Schema Manifest」。

### 8.4 类型反馈与文案边界

17. 存在无法映射的数据库类型时，写盘前显示表数、字段数、降级数量、原始类型和受影响字段；用户确认后才将这些字段按 `string` 写入。
18. 第 4 步主文案为「暂不补充业务语义，使用数据库字段信息继续」或等义标准文案，不出现“已自动生成业务指标/维度/口径”的暗示。
19. 到达第 4 步不要求粘贴或上传语义 YAML；向导内没有提交表级 semantic overlay 的控件。

### 8.5 启用表范围

20. 新连接首次进入第 3 步时 0 张表被选中，不因候选表少于或等于 30 张而自动全选。
21. 第 3 步提供显式「全选」「清空」和搜索；至少选择 1 张表后才能继续。
22. 已有启用表时，默认选择仅为“已有启用表与当前候选表的交集”，不自动补选新发现的表。
23. 保存返回 `TABLE_NOT_SCANNED` 时留在第 3 步，保持用户选择，展示错误并提供返回第 2 步重新同步的入口。

### 8.6 三层就绪状态

24. 只有 Manifest 和启用表满足时，页面最多声明「表结构已准备」，不得声明问答就绪。
25. `serviceReady=false` 时，第 6 步逐项展示数据库探测、Config、Catalog、Policy Runtime、MCP Execution 或 Endpoint 的实际阻断项；Token 签发、复制配置和 Hello World 操作不可用。
26. `serviceReady=true`、尚无有效凭据时，页面声明服务链路已就绪并允许签发凭据，但不声明客户端已就绪。
27. 只有 `clientReady=true` 时才显示“可以开始问数”的成功状态，并启用配置复制和 Hello World。
28. 第 6 步的 `serviceReady` 结果与 Spec 130 及现有 `deriveSetupReadiness()` 对同一快照的结果一致。

### 8.7 可访问性

29. 读取和刷新阶段具有 `aria-busy="true"` 与 `aria-live="polite"` 状态播报，按钮切换 loading 文案时不发生明显宽度跳动。
30. 错误摘要使用 `role="alert"` 并在出现后获得焦点；键盘用户可以继续到达重试、上传和退出动作。
31. 进入下一步时焦点移动到步骤标题；关闭向导后焦点返回打开向导的控件。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

Gate B 通过后，下列主文案已写入 `webui/docs/00-product-terminology-standard.md`。

| 说法 | 用途 | 不使用 |
|---|---|---|
| 准备表结构 | 第 2 步标题和第 1 步出口 | 上传 Manifest（作为唯一步骤名） |
| 从数据库读取表结构 | 无现成 Manifest 时的主按钮 | 自动生成清单、跳过 Manifest |
| 使用已有 Schema Manifest | 已有资产的默认主动作 | 请重新上传、强制替换 |
| 我已有 Schema Manifest | 无现成目标文件时展开上传 | 上传 YAML |
| 替换已有 Schema Manifest | 用户主动覆盖入口，受 Spec 158 确认保护 | 自动覆盖、重新生成并覆盖 |
| 结束并稍后继续 | 关闭并保留第 2 步断点 | 稍后上传 Schema Manifest |
| 暂不补充业务语义，使用数据库字段信息继续 | 第 4 步默认动作 | 采用基础字段语义、自动生成语义 |
| 表结构已准备 | `structureReady=true`、`serviceReady=false` | 问答已就绪、服务已就绪 |
| 服务链路已就绪 | `serviceReady=true` | 仅 Manifest 和启用表成立时使用 |
| 客户端已就绪 | `clientReady=true` | 尚未签发有效凭据时使用 |
| 启用表范围 / 选择启用表 | 第 3 步 | 表白名单 |
| 业务 Wiki | 第 5 步 | 维基文档 |

## Design System Compliance

引用：

- `webui/docs/design-system/00-principles.md`：状态、错误和操作必须可理解、可恢复。
- `webui/docs/design-system/10-components-button.md`：同一状态只有一个 primary；disabled/loading 必须可解释。
- `webui/docs/design-system/20-patterns-page-layout.md`：状态优先级、键盘访问和焦点顺序。

本 Spec 遵循点：

- 第 2 步主按钮根据当前事实变化，不同时展示两个 primary。
- 「我已有 Schema Manifest」或「替换已有 Schema Manifest」是 secondary；「结束并稍后继续」是 ghost。
- loading 按钮设置 `data-loading="true"`、`aria-busy="true"` 并保持宽度稳定。
- 失败不只改变颜色，必须同时有文本、`role="alert"`、焦点和恢复动作。
- 三层就绪状态使用明确文案和操作门禁，不以单一颜色代表可用性。
