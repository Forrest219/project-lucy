# 大 Schema 接入 Spec（宽表与多表）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2.2** |
| 日期 / 目标版本 | 2026-11-15／不绑定产品版本号 |
| 功能编号 / 优先级 | **P1-34**／REQ-030-055／**P1**（事故续作，客户规模）。**不入 0.30 核心分母** |
| 阶段 | S1 |
| 状态 | S1｜v0.2.2 主体及 LS-01–18 既有结论保留；§11 v0.5 已由委托人确认并授权实施，R1／R2 修复完成，LS-19–30 本轮本机功能验收通过。真实 MySQL 混合权限按 D5 受控降级，合法字段真实；正常规模套件本跑次通过，历史 SCALE-09 偶发超时未归因记录保留。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 |
| 决策来源 | 2026-11-15 委托人：客户存在列非常多的表、表数非常多的 Schema，普通 MySQL 上曾出现「小库很快、大库拉取失败」的先例。委托人要求把此规模写进 UAT 并制定优化 Spec／Plan，目标是**顺利接入，而不是超时报错** |
| 需求来源 | [P1-16 库内扫表读法](lucy-20261111-catalog-scan-read-path-spec.md) 的 `tblu` 先例（789 张表，逐表查字段，20 秒内无响应体）；[P1-20 外部目录读字段](lucy-20261113-external-catalog-column-read-spec.md) 把「整库逐表批量准备耗时」明确划出本条并记 Follow-up；本次本机规模实测（[`inbox/hive-lab/REPORT.md`](../../inbox/hive-lab/REPORT.md)，诊断证据，非 UAT） |
| 实施主体 | WebUI 服务端读字段通道（`schema-structure`、`catalog-show`、`live-discovery`）与前端 `prepareSchemaStructure` 库层。不改页面组件、不改 KTX、不改问数 |
| 授权 | **已获得**：委托人 2026-11-15「授权 spec 定稿，进入落地开发」，含终稿确权（无 Codex 终审，委托人明示确权）与开发授权。授权范围＝本 Spec §实施主体所列文件与 Plan Task 1–5／7；不含写入链路（O3）与部分成功页面（O4） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **续作并收窄**：P1-16 的 SC-06／SC-07（`schema-wide` 一条 `information_schema.columns`、达 10000 行 fail-closed）**不改**；本条新增第三种读法 `batch`（有界表集、一次一条查询）。**修订** P1-20 的 `COLUMN_READ_ROW_LIMIT`（2000→10000）与「逐表新建连接」；EC-01–EC-13 的探针顺序与回退规则**保持有效**。**不改** Spec 190 的结构差异 20 张上限，只让它走同一批量读 |
| 实施计划 | [`docs/plans/lucy-20261115-large-schema-ingestion-plan.md`](../plans/lucy-20261115-large-schema-ingestion-plan.md) |
| 测试台 | [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)（INDEX 判定）。**规模下限不得降低**，见 §4 |
| §11 修订（已确权） | v0.2.2 主体及 LS-01–18 既有结论保留；§11 v0.5 已由委托人确认并授权实施，R1／R2 修复完成，LS-19–30 本轮本机功能验收通过。真实 MySQL 混合权限按 D5 受控降级，合法字段真实；正常规模套件本跑次通过，历史 SCALE-09 偶发超时未归因记录保留。原完整范围 FDE 实测 FAIL 保留；委托人已将 G6 正式完整导出延期，本次客户功能测试排除此项，可按限定范围进行；D5边界保留；≠ 可上线。 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.4 | 2026-11-19 12:35 §11 定稿：委托人明示终稿确权＋整批开发授权，未做 Codex 复审。本条出口扩为 LS-01–LS-24。实现未开始；不是 UAT PASS；≠ 可上线 |
| v0.4-draft | 2026-11-19 按 Codex 终审修订 §11：①§11.3 服务端伪代码改回候选的硬上界，删除「无终态即放宽超时」（原写法在 50×400、6000ms 下首个终态约 30 秒，违反 B3）；②C1 写明上界、C3 改为只约束客户端进度；③LS-19 增逐响应 ≤20 秒与连续三次截断树形；④O9 在 §11.8 与 §11.6 统一为已批准。**仍为草案，终稿未确权** |
| v0.3-draft | 2026-11-19 FDE 3b1c62af 本机复现（F03／F04）：①v0.2.1 修过的「首块截断后零进展」在 v0.2.2 预算改动后复现（`columnsAttempted` 把被截断的尝试当成进度）；②客户端整批 `deferred` 报「没有进展」且不缩批；③单表路径丢弃 `deferred`，客户端对缺失的表静默成功；④UAT runner 不看 `deferred`。新增 §11 与验收 LS-19–LS-25，新增决策点 O7–O10（待裁定）。**草案，待终稿确权，开发未授权** |
| v0.2.2 | 2026-11-18 FDE R02：关闭字段读超时预算洞。① 外部目录探针把实际 `timeoutMs` 与 `/timed out/` 文本纳入超时分类，超时后不再跑满 DESC→SHOW→DESCRIBE 各一整段；② 普通 MySQL 在**首条** columns 语句返回后、每一次后续 columns（含折半拆分）前检查 `CALL_BUDGET_MS`，避免深度拆分树烧穿预算；③ 有 `callBudgetMs` 时下一条语句 `timeoutMs = min(PER_TABLE_TIMEOUT_MS, remaining)`。新增验收 LS-16–18。对齐 P1-20 EC-05（超时＝单次尝试）。真实 Hive live UAT 记 BLOCKED。不新开 P1-51；不并入 P1-43。 |
| v0.2.1 | 2026-11-16 提交前代码评审（Reviewer 子代理）后修订实现，合同不变。评审指出 LS-07 在普通 MySQL 路径无测试；补测时发现并修复一处违反 §5.2「每次调用至少读完一张表」的缺陷：首块被截断对半拆分后，子块的预算检查会让全部表落入 `deferred`、零进展。现改为「已有一块读到终态才按预算截断」。另改三处小项：SQL 字面量拼接遇非法表名显式抛错；批内去重改 `Set`；客户端累积表用无原型对象。 |
| v0.2 | 委托人 2026-11-15 授权定稿并进入开发。O1–O6 闭合（§9）：O2 客户网关超时无法取得，委托人认定本机实测规模接近客户真实用量，沿用 20 秒假设；其余按建议值采纳。 |
| v0.1-draft | 初稿。四层根因（§1）、容量与预算（§4）、批量读法（§5）、验收 LS-01–LS-15（§8）、决策点 O1–O6（§9）。基于 2026-11-15 本机规模实测 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在 §4 规定的规模下限内，用户在「准备表结构」勾选至多 600 张表，系统在预算内读完全部字段并生成可校验的 Manifest。任一单次 HTTP 响应不超过 20 秒，页面主线程不被长任务卡住；不因规模返回「超时」或「超过一次可读取的上限」；个别表失败时仍读完其余表，并在一次错误里列出全部失败表与各自原因。
- 本条出口：LS-01–LS-24（LS-19–LS-24 为 §11（2026-11-19）新增；LS-25 属测试台承接，不是出口）（本机自动化：vitest 与真实进程内检查，含对真实 `mysql2` 驱动的语句计数）。规模下限由测试台 `UAT-SUITE-LARGE-SCHEMA` 复现，结果只记 [`INDEX.md`](../qa/uat/INDEX.md)，不是本条出口。
- 不在本条出口：客户环境 live、Hive Metastore Kerberos／HDFS、Hive 字段注释、Postgres／SQL Server／Oracle 读字段路径、Manifest 写入与热重载链路（O3）、部分成功的页面呈现（O4）、浏览器测试、发布取证、证据等级。
- 上线关系：本条收口不表示可上线。

## 1. 现状与根因

2026-11-15 本机实测（诊断证据，诊断环境与 UAT 夹具同规模、不同库名；UAT 复现见测试台）：

| 层 | 现象 | 实测 | 根因 |
|---|---|---|---|
| L1 普通 MySQL 逐表读 | 勾选表越多越慢，线性 | 单表 0.93 秒；结构差异 20 张 19 秒；30 张 28 秒 | 每张表**两次** `ktx sql` 进程调用（先匹配物理表名，再读字段），每次约 0.46 秒，几乎全是进程启动 |
| L2 外部目录逐表读 | 本机快，客户端远程 HMS 下无上限 | 600 张 2.7 秒（本机）。客户延迟下的值是推算 | 每张表新开一条 MySQL 连接；只有单语句 120 秒限制，**没有总时限** |
| L2′ 外部目录宽表 | 字段数达到 2000 的表一个字段都读不出 | 1999 列通过，2000、3000 列 `too_large` | `COLUMN_READ_ROW_LIMIT = 2000`，用 `>=` 判截断；失败文案不含表名与列数 |
| L3 前端累积 | 勾选表越多，页面卡死越久，二次方 | 100 张 4.8 秒；200 张 19.6 秒；10 秒内只合并 144/600 张 | `readCheckedTableColumns` 每读一张表就对**整份累积 YAML** 解析再序列化（`mergeManifestTables`） |
| L4 失败语义 | 600 张里一张失败，整次准备中断 | 代码阅读确认 | 前端遇到第一张失败就抛错，且只报这一张 |

另有一个已知硬上限不属于本条：整库 `schema-wide` 一条查询在 10000 行字段处 fail-closed（P1-16 SC-07，设计如此，不改）。

普通 MySQL 的 InnoDB 单表最多 1017 列，所以 L2′ 只发生在 Hive／SelectDB 外部目录。

## 2. 目标与非目标

目标：L1–L4 全部在 §4 预算内通过；改动后「小库」行为不变。

非目标：

- 不并发读源库（并发会在客户源库放大连接与负载，另需限流设计）；批量靠**一次查询或一条连接**降低成本，不靠并行。
- 不改 `schema-wide` 合同；不新增页面、按钮、路由；不改 Postgres 路径；不做 Hive 字段注释。
- 不承诺 600 张以上一次勾选的体验（见 §4 容量表「超出下限」行）。

## 3. 决策记录

| 项 | 内容 |
|---|---|
| 背景与约束 | 客户环境网关时限约 20 秒（`tblu` 先例，O2 待核实）；KTX 是上游依赖不可改；P1-16 已有「元数据走直连」先例（`catalog-show`） |
| 采用方案 | ① 元数据读取走**类型化直连通道**，一次调用开一条连接；② MySQL 一批表**一条** `information_schema.columns … IN (…)`；③ 服务端每次调用有**预算**，到点返回 `deferred` 交客户端续读；④ 客户端分批、一次序列化；⑤ 失败汇总后一次报出 |
| 备选 A：保持 `ktx sql`，客户端并行 | 放弃。进程启动成本变成 CPU 争用，源库连接数被放大，且不改变 L3 |
| 备选 B：整库 `schema-wide` | 放弃。10000 行上限正是 `tblu` 类库的失败点，且违背 SC-07 |
| 备选 C：单一接口一次读 600 张 | 放弃。超过网关时限时只能整体失败；`deferred` 续读更稳 |
| 主要权衡 | 普通 MySQL 元数据不再经 KTX 进程：KTX 连接选项（如 TLS）直连通道不支持时必须**回退旧路径**（LS-14），不得失败 |
| 失败模式 | HMS 慢（预算截断，剩余转 `deferred`）；源库 `max_connections`（每次调用一条连接，客户端串行，不并发）；`IN` 清单过长（分块，LS-03） |
| 回滚 | 环境开关 `LUCY_SCHEMA_READ_LEGACY=1` 强制走改前路径；保留一个发布周期（LS-14 覆盖） |

## 4. 容量与预算

**规模下限**（测试台必须不低于此规模跑，不得降低；可以升高）：

| 对象 | 下限 |
|---|---|
| 普通 MySQL 单 Schema | 1200 张表 × 10 列，外加 1 张 1000 列的表（合计 13000 行字段，**超过** `schema-wide` 的 10000 行） |
| 外部目录（Doris／SelectDB 指向 Hive）单 Schema | 600 张表 × 30 列，外加宽表 1500／1999／2000／3000／5000 列 |
| 一次准备 | 勾选 600 张表 |

**预算**（提议值，O1 待委托人确认；测试台与 vitest 按此判定）：

| 编号 | 动作 | 预算 |
|---|---|---|
| B1 | 列出表名（MySQL 1201 张、外部目录 605 张） | ≤ 5 秒 |
| B2 | 读单表（≤ 1000 列）／外部目录宽表（≤ 5000 列） | ≤ 3 秒／≤ 10 秒 |
| B3 | 任一单次 HTTP 响应 | ≤ 20 秒（服务端 `CALL_BUDGET_MS = 10000`，单表 `PER_TABLE_TIMEOUT_MS = 8000`，最坏 18 秒） |
| B4 | 勾选 600 张表，读取全部字段（服务端读取＋客户端累积，不含写入） | ≤ 60 秒 |
| B5 | 客户端累积 600 张×30 列 | 总计 ≤ 5 秒；单步 ≤ 200 毫秒 |
| B6 | 校验 600 张×30 列的 Manifest（只校验，不写入） | ≤ 20 秒（基线未测，见 O3） |
| B7 | 结构差异 20 张表（Spec 190 上限） | ≤ 5 秒 |

超出下限：不承诺体验，但**不得**静默截断；超出的上限必须以含表名与数量的句子报出。

容量常量（实现须集中定义，不得散落）：

| 常量 | 值 | 说明 |
|---|---|---|
| `MAX_TABLES_PER_CALL` | 50 | 一次 `schema-structure` 最多表数；超出 400 |
| `COLUMN_READ_ROW_LIMIT` | 10000 | 单表字段行上限，原 2000；达到即拒绝并报数 |
| `TABLE_NAME_LIMIT` | 200000 | 表清单上限，MySQL 与外部目录一致（MySQL 原 10000，受 `ktx sql --max-rows` 限制；MySQL 表清单改走直连通道后一并抬高） |
| `CALL_BUDGET_MS` | 10000 | 一次调用内不再启动新表的时点 |
| `PER_TABLE_TIMEOUT_MS` | 8000 | 单表读超时（原 120000） |

## 5. 核心流程（伪代码）

### 5.1 服务端批量读（`schema-structure`，请求含 1…50 张表）

```text
readTablesBatch(conn, schema, tables, now):
  tables = dedupe(tables) 保序
  if len(tables) > MAX_TABLES_PER_CALL: return 400 BAD_REQUEST
  if LUCY_SCHEMA_READ_LEGACY: return legacyPerTableRead(...)        # 回滚开关

  channel = openMetadataChannel(conn)                               # 一次调用一条连接
  if channel unavailable (驱动不支持该连接的选项):                   # LS-14
      return legacyPerTableRead(...)                                # 行为同改前
  try:
    columns = [], rejections = [], deferred = []
    start = now()

    deadline = start + CALL_BUDGET_MS
    statementTimeout = () => min(PER_TABLE_TIMEOUT_MS, max(0, deadline - now()))

    if conn 是外部目录 (catalog.database):
      for t in tables:
        if now() - start >= CALL_BUDGET_MS: deferred = rest(tables, t); break
        result = probeColumns(channel, catalog, schema, t,
                              order = [DESC, SHOW COLUMNS, DESCRIBE],  # P1-20 EC 规则不变；非超时 unreadable 才回退
                              timeout = statementTimeout(),           # 与 call 剩余预算共享（LS-18）
                              classifyTimeoutWithProbeBudget = true)  # 超时文案／实际 timeoutMs → reason=timeout；停探针（LS-16／EC-05）
        if result.rows >= COLUMN_READ_ROW_LIMIT:
          rejections += {t, reason: too_wide, columns: COLUMN_READ_ROW_LIMIT}
        else if result.rejection: rejections += {t, reason}
        else: columns += result.columns

    else:  # 普通 MySQL
      # 语句 1：information_schema.tables，LOWER(table_name) IN (…)，解析物理表名（大小写与歧义规则同改前）
      physical = resolve(tables)                     # 0 个 → missing；>1 个 → ambiguous
      # 语句 2：information_schema.columns，table_name IN (物理名…)，一次读一块
      columnsAttempted = 0
      readChunk(physical):
        if columnsAttempted > 0 and now() - start >= CALL_BUDGET_MS: deferred += chunk; return  # 含折半拆分（LS-17）
        rows = channel.run(ColumnsOfTables(schema, chunk), limit = COLUMN_READ_ROW_LIMIT, timeout = statementTimeout())
        columnsAttempted += 1
        if rows 触顶: 块内多于 1 张则折半各自重试；单表仍触顶 → too_wide
        if 该语句失败: 非超时／非断连则折半归因；超时／断连则整块记原因
        每张表按物理名取行；无行 → unreadable

    return {columns, rejections, deferred}        # 三者对 tables 构成划分（LS-07）
  finally:
    channel.close()                               # 失败也关；错误文本与日志脱敏（LS-15）
```

响应形态（`data` 沿用现有 `SchemaStructurePreview`，只增两个可选字段）：

```text
{ schema, yaml, tableCount, columnCount, namesOnly:false, mapped, downgraded,
  rejections?: [{ table, reason, message }],     # reason ∈ missing|permission|timeout|ambiguous|too_wide|unreadable
  deferred?:  [table, ...] }                      # 本次预算内没来得及读的表，客户端下一次续读
```

兼容：请求恰好 1 张表时，失败仍按改前返回 400 与原文案（LS-08）；`yaml`／`tableCount` 只含读成功的表。

### 5.2 客户端分批续读与累积（`readCheckedTableColumns`）

```text
readCheckedTableColumns(conn, schema, tables, onProgress):
  pending = tables (保序), accumulated = Map<table, entry>, failures = []
  done = 0
  while pending 非空:
    batch = pending.take(MAX_TABLES_PER_CALL)
    r = POST schema-structure {schema, tables: batch}
    parsed = parseYamlOnce(r.yaml).tables                  # 每批只解析一次
    for (name, entry) in parsed: accumulated[name] = entry # 累积对象，不重新序列化
    failures += r.rejections
    pending = r.deferred + pending.drop(len(batch))        # 续读的表排到最前
    done += len(batch) - len(r.deferred)
    onProgress(done, len(tables), lastTableOf(batch))      # 回调形态不变
  if failures 非空:
    throw ApiError(READ_FAILED, summarize(failures))       # 一次列出全部失败表与原因（LS-12）
  yaml = stringifyOnce({tables: accumulated})              # 全程只序列化一次
  return {yaml, tableCount, columnCount, mapped, downgraded}
```

不变量：一次调用里表不重复读；`deferred` 不为空时 `done` 不前进；循环必在有限步结束（每次至少读完一张或全部落入 `rejections`）。

## 6. 用户可见文案

本条不新增页面、按钮或路由。新增或改变的用户可见句只有两句，均沿用「字段」「表」「上限」等既有词：

| 场景 | 句式 |
|---|---|
| 单表字段数触顶 | 「表「<表名>」的字段数达到 <N> 个，超过一次可读取的上限。」 |
| 一次准备里有表失败 | 「有 <K> 张表没有读到字段：表「<a>」<原因>；表「<b>」<原因>。」最多列 10 张，其余写「另有 <M> 张未列出」。原因固定短语：对应多张表／没有读取权限／读取超时／字段数超过一次可读取的上限／没有读到字段 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. §6 两句只复用「表」「字段」「上限」「没有读到字段」。进入实现前，评审对照术语标准逐词核对一次。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 不新增页面、按钮、颜色或间距
- [x] 进度回调 `(done, total, table)` 形态不变，沿用现有进度呈现
- [x] 错误仍走现有错误提示区，只是一条错误里列全部失败表

### Exceptions (If Any)

- None

### Follow-up Needed

- 部分成功的页面呈现（读成功的表照常勾选、失败的表标红）需要交互合同 Spec，见 O4。
- 写入链路（校验、上传、热重载）在规模下限的耗时是基线缺口，见 O3。

## 交互合同豁免

- 原因：本条只改服务端读字段通道与前端库层的取数、累积与失败汇总，不改变用户可见 WebUI 表面（页面、组件、按钮、路由、进度与错误提示区的位置与形态都不变）。
- 不改变：`SchemaStructurePrep` 与 `Step2UploadManifest` 的版式、控件与路由；错误提示区仍是同一处，仅内容改为一次列出全部失败表。

## 7. 与既有合同的对照

| 既有合同 | 本条处理 |
|---|---|
| P1-16 SC-06／SC-07（`schema-wide`） | 不改；`batch` 是新读法，不改 `schema-wide` 的 SQL 与 10000 行 fail-closed |
| P1-16 SC-01–SC-05 表清单 | 表清单改走同一直连通道；上限 10000→200000；结果集与改前一致 |
| P1-20 EC-01–EC-13 | 探针顺序、回退规则、日志、关连接均保持；仅 `COLUMN_READ_ROW_LIMIT` 与「一批共用一条连接」变化；EC 测试全绿是进入条件 |
| Spec 190 结构差异 | 20 张上限不变；读取改走批量读（LS-13） |
| P1-21 事件循环 | 批量读与累积不得引入同步长任务；超 200 毫秒的单步视为回归（B5） |

## 8. 验收（LS）

| 编号 | 断言 | 证据等级 |
|---|---|---|
| LS-01 | 普通 MySQL 读 N 张表（N ≤ 50）时，对源库只发 1 条 `information_schema.tables`（解析物理表名）加 1 条 `information_schema.columns` 查询，且**不**调用 `ktx sql` | 本机 vitest（驱动语句计数） |
| LS-02 | 表名匹配的大小写与歧义语义与改前一致：`Bar`／`bar` 同时存在 → `ambiguous`；不存在 → `missing`（回归 EE54） | 本机 vitest |
| LS-03 | 行数触顶时折半重试，最终结果不静默截断；单表触顶 → `too_wide` | 本机 vitest |
| LS-04 | 外部目录一次调用无论读多少张表，只建立 1 条连接 | 本机 vitest（`createConnection` 调用数） |
| LS-05 | P1-20 EC-01–EC-13 全部保持绿（探针顺序、回退、日志、关连接） | 本机 vitest（既有文件） |
| LS-06 | 单表 9999 个字段读出；10000 个字段 → `too_wide`，文案含表名与数字 | 本机 vitest |
| LS-07 | 注入慢表使调用超过 `CALL_BUDGET_MS` 时，响应在预算后返回，且 `columns`／`rejections`／`deferred` 对请求表集构成划分（无遗漏无重复） | 本机 vitest（注入时钟） |
| LS-08 | 请求 1 张表时，失败仍 400＋原文案；成功响应形态与改前一致 | 本机 vitest（回归 P1-20） |
| LS-09 | 请求 > 50 张表 → 400 `BAD_REQUEST`，无任何源库访问 | 本机 vitest |
| LS-10 | 客户端读 600 张表：请求数 = ⌈600/50⌉ 加 `deferred` 续读次数；`deferred` 表最终被读到 | 本机 vitest（mock 服务） |
| LS-11 | 客户端累积 600 张×30 列：YAML 解析次数 ≤ 批次数＋1，序列化 1 次；单步 ≤ 200 毫秒、总计 ≤ 5 秒 | 本机 vitest（计数＋墙钟） |
| LS-12 | 600 张里有 3 张失败：读完其余 597 张，抛一次错误，文案列出 3 张表与各自原因 | 本机 vitest |
| LS-13 | 结构差异 20 张表只开 1 条连接，不再起 `ktx sql` 进程。结构差异与批量读共用同一读取器（`readSchemaColumns` 的 `per-table`），由 LS-01 覆盖，另由 UAT-SCALE-03 实测 | 本机 vitest（LS-01）＋测试台 |
| LS-14 | 直连通道不可用（连接含不支持的选项）或 `LUCY_SCHEMA_READ_LEGACY=1` 时，走改前路径，行为与改前一致 | 本机 vitest |
| LS-15 | 密码不出现在错误文本、日志、审计和测试快照 | 本机 vitest（既有脱敏断言扩展） |
| LS-16 | 外部目录：探针在实际 `PER_TABLE_TIMEOUT_MS` 下返回 catalog timed-out stderr 时，单表只发 **1** 条探针、`reason === timeout`，虚拟时钟耗时 ≤ `callBudgetMs`；非超时的 `unreadable` 仍按 DESC→SHOW COLUMNS→DESCRIBE 回退（对齐 P1-20 EC-05） | 本机 vitest（虚拟时钟／stub） |
| LS-17 | 普通 MySQL：`costMs` 使折半深度 ≥3、`callBudgetMs = 10_000` 时，不得在预算后仍跑满整棵拆分树（columns 语句数与虚拟耗时有上界）；`columns`／`rejections`／`deferred` 仍划分请求表集 | 本机 vitest（虚拟时钟） |
| LS-18 | 设置 `callBudgetMs` 时，下一条语句的 `timeoutMs ≤ remaining` 且 ≤ `PER_TABLE_TIMEOUT_MS` | 本机 vitest（断言传给 `run`／`show` 的 options） |

规模下限的真实复现不在本表，由测试台 `UAT-SCALE-01…10` 承担（见 §4 与 [`cases.md`](../qa/uat/suites/large-schema-ingestion/cases.md)）。**vitest 绿不得写成 UAT PASS。** 真实 Hive live 对 LS-16 记 **BLOCKED**（不挡源码关单）。

## 9. 决策点（已闭合，2026-11-15）

| 编号 | 问题 | 决定 |
|---|---|---|
| O1 | §4 预算数值（B1–B7） | 采纳建议值。若客户体验要求更严，另行修订并同步测试台 |
| O2 | 客户网关真实超时 | **无法取得。** 委托人认定本机实测规模接近客户真实用量；沿用 20 秒假设，`CALL_BUDGET_MS = 10000`、`PER_TABLE_TIMEOUT_MS = 8000`。常量集中定义，日后取得证据可单点修改 |
| O3 | 写入链路（校验、上传、热重载）是否纳入 | 不纳入。UAT-SCALE-10／11 仍取数；超 B6 另立条目 |
| O4 | 部分失败是否做成「部分成功」页面 | 不做。本条汇总后统一报错；部分成功另立交互合同 Spec |
| O5 | `COLUMN_READ_ROW_LIMIT = 10000`、`TABLE_NAME_LIMIT = 200000` | 采纳建议值 |
| O6 | 直连通道不支持某些连接选项时回退旧路径 | 可接受 |

说明：O1、O3–O6 委托人未逐项回复，按本 Spec 原建议值采纳；委托人可随时改，改动走 Changelog。

## 10. 风险

| 风险 | 缓解 |
|---|---|
| `LOWER(table_name) IN (…)` 在 MySQL 5.7／8.0／8.4 可能放弃索引，退化成整库扫描 | Plan T0 在三版本实测，选能保持大小写语义且更快的写法（LS-02 守语义） |
| 直连通道与 KTX 连接选项不一致 | LS-14 回退；不得因选项不支持而失败 |
| 预算截断使 `deferred` 反复出现、客户端不收敛 | 每次调用至少读完一张表；5.2 不变量；LS-10 |
| 单表 8 秒超时比原 120 秒更严 | 8 秒来自网关假设，O2 取证后调整；超时有专门的 `timeout` 原因，不混入「没有读到字段」 |
| 客户端累积改动影响既有 Manifest 合并语义 | `mergeManifestTables` 仍用于「并入已有 Manifest」，不改；只改读取阶段累积 |

## 11. FDE 3b1c62af 合同修订（v0.4，2026-11-19；已确权，开发授权已获得；实现未开始）

> 本节是已确权的合同修订（委托人明示终稿确权，2026-11-19）；**开发授权已获得，见头部「状态」行**，实现未开始。现行状态以头部「状态」行为准。§10 第三条风险早已写明「预算截断使 `deferred` 反复出现、客户端不收敛」，缓解写的是「每次调用至少读完一张表；5.2 不变量；LS-10」。本节说明为什么这条缓解没有生效，并把它改写成**可被打假的验收**。

### 11.1 事实（本机 L1 复现；受控 SQL 与模拟时钟，非客户现场）

| 编号 | 输入 | 候选 `3b1c62af` | 对照 |
|---|---|---|---|
| F04a | 50 表×400 列，每次 SQL 模拟 6000ms，`callBudgetMs=10000`，真实 `readCheckedTableColumns`＋真实 `previewSchemaStructure` | `ApiError「读取表结构没有进展，请稍后重试。」`，0 张表读到 | 84 原始用例通过 |
| F04b | 30 表，`t0` 权限拒绝，其余合法，同上时钟 | `seen=[]`，一张都没读；预期 29 张继续、汇总 1 张失败 | 84 原始用例通过 |
| F03 | 外部目录单表，探针耗时 `[6000,6000,6000]`，`requestTimeoutMs=19000` | 约 12 秒，响应**无 `deferred`、无 `rejections`**；真实客户端返回成功：`tableCount=1`、`columnCount=0`、YAML 无该表 | — |

机制（静态确认）：

1. **服务端零进度**（对应 F04）：`schema-structure-batch.ts` 的 `readChunk` 在 `columnsAttempted > 0 && overBudget()` 时把整块置 `deferred`；而 `columnsAttempted` 在首块**被截断**时就已加一。50×400＝20000 行，超过 `COLUMN_READ_ROW_LIMIT = 10_000`，首条列语句必被截断，解析表名＋这一条语句一旦吃满 10 秒，后续拆分子块全部 `deferred`。「进度保证」注释只保证**第一条**列语句拿满超时，而这条恰好是被截断的整批。这与 v0.2.1 记录的缺陷同形（Changelog：「首块被截断对半拆分后，子块的预算检查会让全部表落入 `deferred`、零进展」）。
2. **客户端不缩批**：`prepareSchemaStructure.ts` 固定 `TABLES_PER_REQUEST = 50`，`unread.size >= batch.length && rejections.length === 0` 即抛「没有进展」；下一次仍发同一批，永远不会读到。
3. **单表丢披露**（对应 F03）：`previewSchemaStructure` 中 `batch = requested.length > 1`，只有批量才回传 `deferred`；单表失败只在 `rejections` 非空时抛错。预算耗尽的单表既不抛错也不披露。客户端对「请求了、响应里没有」的表不校验，直接 `done += 1`。单表并不只在用户只勾 1 张时出现：51 张表的第二批、续读队列最后剩 1 张，都走这条路。
4. **runner 假通过**（UAT 判定）：`scripts/uat/run-large-schema-ingestion.mts` 的 `readTables` 对每个非 4xx 响应执行 `i += slice.length; done = i;`，不看 `deferred`／`rejections`；`ok04`／`ok06` 只校验 `done`、耗时与单次最慢，不校验字段数。全部延期、0 字段时仍判 600/600 PASS。历史真实跑次（600 张，172／487ms，12 次批量）不像发生过延期，但记录没有字段总数。

**触发条件**（本机分析，非实测）：「解析表名＋首条被截断的列语句」合计吃满 10 秒。快速数据库不触发；慢元数据服务或高负载库可能触发。所以这是条件触发的收敛缺陷，不是任何宽表必现。

为什么旧验收没拦住：LS-10 的 mock 服务只让「部分表」`deferred`；LS-07 断言划分（无遗漏无重复），不断言进度；规模下限里没有「一批同时触发行数截断与预算耗尽」的形态；`UAT-SCALE-04／06` 最后一次完整跑在 11-16，早于 `deferred` 逻辑（11-18 `784e7f7e`），之后未复跑。

### 11.2 合同修订（normative）

| 编号 | 条款 |
|---|---|
| C1 | **响应有界**：任一响应耗时不超过 B3。服务端不得为了保证进度而无界继续拆分（每个语句 ≤ `PER_TABLE_TIMEOUT_MS`；拆分深度×语句超时可能超过 B3，故进度由 C2 在调用之间保证，不靠单次调用无界重试）。**每次调用只有第一条 columns 语句可用满 `PER_TABLE_TIMEOUT_MS`，其后所有语句（含拆分子块）的超时不得超过剩余预算；不得以「尚无终态」为由重置或放宽该上界**（候选已有此上界，保持不变） |
| C2 | **调用间进度**：对任意请求集，客户端在有限次请求内使每张表达到终态（读到字段，或带原因的失败）。整批 `deferred` 且无 `rejections` 时，客户端**缩批**（对半，最小 1 张）后重试；单表仍无进展才终止 |
| C3 | **进度只数终态**：客户端的「进度」计数只数终态结果（读到字段、明确的 `rejection`）。被截断拆分、超时、预算截断的**尝试**不算进度。服务端**不**要求单次调用内必有终态，只要求有界（C1），并保证批次小到第一条 columns 语句能读完时必产出终态 |
| C4 | **划分与披露不分批大小**：`columns`／`rejections`／`deferred` 对请求表集构成划分（LS-07 的断言扩到**请求 1 张表**）。预算耗尽的单表必须披露 `deferred`（HTTP 200），不得返回无披露的空结构。LS-08（单表失败 400＋原文案）只适用于**失败**，不适用于未读完 |
| C5 | **客户端不静默漏表**：每个响应后，批内每张表必须是「在 YAML 中」「在 `rejections`」「在 `deferred`」三者之一；都不是则按错误处理并点名该表（不得计入 `done`、不得返回成功） |
| C6 | **单表 `deferred` 的终止**：客户端对同一张单表连续两次收到 `deferred` 且无进展，记为该表失败（原因＝这次没有读完），其余表继续；最终与其他失败一起汇总一次报出（LS-12），已读结果不丢 |
| C7 | **UAT 判定以产出物为准**：`UAT-SCALE-04／06` 的「完成」只数响应中**实际读到字段**的表；`deferred`／`rejections` 计未完成；校验字段总数不低于夹具期望；全部延期或 0 字段必须判 FAIL |
| C8 | **规模下限追加（不得降低）**：一次 50 表×400 列（20000 行，超过 `COLUMN_READ_ROW_LIMIT`）的批次是必测形态，含一个「慢元数据」变体（测试台在延迟注入通道下执行，见整改 Plan Task 6） |

### 11.3 核心流程（伪代码，只写与现行 §5 的差异）

```text
# 服务端 readChunk：保持候选的硬上界（C1）。不引入「无终态则放宽超时」
firstColumnsUsed = false
readChunk(chunk):
  if firstColumnsUsed and overBudget(): defer(chunk); return    # 首条之后受剩余预算约束
  timeout = firstColumnsUsed ? min(PER_TABLE_TIMEOUT_MS, remaining) : PER_TABLE_TIMEOUT_MS
  firstColumnsUsed = true
  answer = run(columnsSql(chunk), timeout)
  if answer truncated:
    if len(chunk) > 1: split()                                  # 子块仍受上面的预算约束
    else: reject(chunk[0], too_wide)
  else if answer failed:
    if budget-capped timeout: defer(chunk)
    else: rejections(chunk, reason)
  else: record columns
  # 进度由客户端缩批在调用之间保证（C2）；单次调用可以整批 deferred，但耗时有界

# 服务端单表（C4）：与批量同一返回形态
previewSchemaStructure(requested):
  read = readSchemaColumns(...)
  return { yaml, rejections?, deferred? }                       # requested.length == 1 也回传 deferred
  # 仅当 read 失败（非未读完）时才按 LS-08 抛 400

# 客户端 readCheckedTableColumns（C2 / C5 / C6）
batchSize = 50; strikes = {}
while pending non-empty:
  batch = pending.take(batchSize)
  r = POST schema-structure {tables: batch}
  for t in batch:
    require t in r.yaml.tables or r.rejections or r.deferred     # C5，否则点名报错
  readNow = batch − r.deferred − r.rejections
  accumulate(readNow, r.rejections)
  if len(readNow) == 0 and len(r.rejections) == 0:               # 整批无进展
    if len(batch) > 1: batchSize = max(1, ceil(len(batch)/2))    # C2 缩批
    else:
      strikes[batch[0]] += 1
      if strikes[batch[0]] >= 2: failures += {batch[0], 未读完}; drop batch[0]   # C6
  pending = r.deferred (minus dropped) + pending.drop(len(batch))
if failures: throw summarize(failures)                           # LS-12
```

### 11.4 验收（LS，延续 LS-18）

| 编号 | 断言 | 证据等级 |
|---|---|---|
| LS-19 | 50 表×400 列、每次 SQL 模拟 6000ms：真实客户端读完 **50 表／20000 列**，不抛「没有进展」；请求次数有上界（≤ 100，防无限重试）；**逐次记录 `previewSchemaStructure` 的虚拟耗时，每次响应 ≤ 20 秒**。另增树形夹具：连续三次语句触顶截断（50→25→13 张）之后才出现终态，每次响应仍 ≤ 20 秒（防止「无终态即放宽超时」的错误实现，该实现按 6000ms 推算首个终态约在 30 秒）。业务断言复用 FDE `functional-skipped-skipped-public-behavior.test.ts` 第一条，不降低规模与阈值 | 本机 vitest（模拟时钟）；不是客户现场 |
| LS-20 | 30 表、`t0` 权限拒绝、其余合法、同一时钟：其余 **29 张全部读到**，最终抛一次错误，文案是「有 1 张表没有读到字段」并点名 `t0`；`seen` 覆盖全部表 | 本机 vitest；复用 FDE 同文件第二条 |
| LS-21 | LS-07 的划分断言扩到请求 **1 张**表：`columns`／`rejections`／`deferred` 对请求集无遗漏无重复 | 本机 vitest（虚拟时钟） |
| LS-22 | 单表预算耗尽（外部目录 `[6000,6000,6000]`）：响应含 `deferred:[该表]`（HTTP 200）；真实客户端**不得**返回「成功但 YAML 无该表」，须读到或在两次无进展后把该表记入失败汇总 | 本机 vitest；复用本机补充用例 `f03-client-impact.test.ts` 的业务断言 |
| LS-23 | 服务端既不返回某张请求表的字段，也不把它放进 `rejections`／`deferred`（构造缺失响应）：客户端抛错并点名该表，`done` 不前进 | 本机 vitest |
| LS-24 | UAT runner 判定：stub 服务对每批返回 `deferred` 全部表且 `columnCount=0`，`UAT-SCALE-04／06` 判 FAIL；完成数只数读到字段的表；字段总数低于期望判 FAIL。判定函数须抽出可测，并有红绿自检 | 本机 `node --test`（须登记进 `root-test-registry.json`）；属脚本改动，另行授权 |
| LS-25 | 测试台承接（**不是本条出口**）：`seed-large-schema-fixtures.sh` 增 50×400 批次夹具；`UAT-SUITE-LARGE-SCHEMA` 增用例覆盖「正常速度读完」与「延迟注入下读完」两个变体，缺环境记 `BLOCKED` 并保留在套件里，不得删除 | 测试台 INDEX；整改 Plan Task 6 |

证据等级：LS-19–LS-24 为本机自动化；**vitest 绿不得写成 UAT PASS**。本轮真实50×400自然变体一次请求／20000字段、约1.25秒；延迟变体6请求完成，单次最慢约12.1秒。三次截断树仍为L1虚拟SQL条件，不能伪称三次真实截断。

### 11.5 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据 | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 不直接使用「准备表结构」；若 Manifest 因静默漏表缺字段，问数口径不全 | 不会因静默漏表拿到缺字段的 Manifest | ↑ | LS-22／LS-23 | — |
| P2 治理方 | 慢元数据下勾选宽表批次报「没有进展」且无法继续；单表预算耗尽时页面显示成功但表为空 | 批次自动缩批读完，或被明确告知哪张表没读完 | ↑ | LS-19／LS-20／LS-22 | — |
| P3 运维方 | UAT 报 600/600 PASS，实际可能 0 字段 | UAT 判定以读到的字段为准 | ↑ | LS-24 | — |
| P4 管理层 | 无直接触点 | 不变 | ＝ | 本条不触碰概览与审计摘要 | — |

主路径可用性：缩批使请求数在最坏情形下增加（每次对半，最多 ⌈log₂50⌉ 轮），合法用户仍能读完；LS-19 同时断言「读得完」与「请求数有上界」，覆盖约束生效与合法用户仍可用。

### 11.6 决策点（委托人 2026-11-19 批准建议：O7–O10 全部按「建议」闭合；O7 的「服务端计终态」一半经 Codex 终审作废；终稿已确权）

| 编号 | 问题 | 建议（**已批准**） |
|---|---|---|
| O7 | 进度保证放在客户端缩批、服务端计终态，还是只改服务端（让首块读到终态才按预算截断） | **（v0.4 修订，须委托人知悉）已批准的「两者并用」中，「服务端计终态」一半经 Codex 终审（LS-B1）证明会让单次响应超过 B3，不再采用；现为：客户端缩批保证进度，服务端保持候选的硬上界（C1）。**原批准理由如下，其「服务端计终态」部分作废：**两者并用**。只改服务端会让最坏耗时＝拆分深度×单语句超时，可能超过 B3（C1）；缩批把进度放到调用之间，单次响应保持有界。84 的 `batchRead`＋客户端降到单表批的做法可作参照，但 84 不是 0.30 祖先，不整枝移植 |
| O8 | 单表连续两次 `deferred` 后是否记失败（C6 的次数） | 两次。一次可能是瞬时慢，两次视为这张表在当前预算内读不完 |
| O9 | 用户可见句：现行「读取表结构没有进展，请稍后重试。」是否改为点名句 | 改为「表「x」这次没有读完，请稍后重试。」，用既有词，不引入「预算」等新词；改动须在术语标准登记后再落 UI |
| O10 | `deferred` 是否带机器可读原因（预算耗尽／截断拆分） | 不带；本条不扩响应形态。需要时另立条目 |

### 11.7 不在本条出口

客户环境 live；浏览器测试；Manifest 写入与热重载（O3）；部分成功页面（O4）；`schema-wide` 路径；发布取证与证据等级。本条收口不表示可上线。

### 11.8 Terminology Compliance 增补

新增或改变的用户可见句只有 O9 一句（委托人 2026-11-19 已批准），沿用「表」「读取」「没有读完」等既有词。New terms: None。落地前须先在 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md) 登记该句，再改 UI 与测试断言。


### 11.9 修复复评整改与验收补项（v0.5，委托人已确认并授权）

总账 **P1-57-R1／R2／G1／G4**，需求 REQ-030-078；[整改 Plan](../plans/lucy-20261119-fde-acceptance-remediation-plan.md)。本节已由委托人确认并授权实施（2026-11-19），与 §11.2 共同约束本轮整改。LS-01–18 既有结论保留；前轮LS-20红证据及LS-19／24不足保留为整改基线，本轮补证结果见末段。

**R1 已实施规范**：保持直接单表失败 HTTP 400／READ_FAILED／原文案。对明确的表级终态拒绝，在错误细节增加可选 `tableRejection:{scope:"table",table,reason}`，reason 首版只允许 permission／missing／ambiguous／timeout／too_large／too_wide；unreadable 不在可继续白名单。服务端白名单只输出上述机器字段，不输出 SQL／driver stderr；平台鉴权、连接／网络及未知故障不得附表级标记。批量客户端仅在单表请求且标记合法、表名匹配时记入 failure 并继续；其他错误中止。不得根据中文文案或一切 READ_FAILED 决定继续。不修改 LS-08。

**R2 已实施规范**：去掉与输入规模无关的 100 请求硬上限。合法响应须对请求集精确划分；终态使 pending 严格减少；无终态大批次严格减半；单表连续两次 deferred 后终止该表。用有限状态进展防死循环；进度只数唯一终态。对 N>0 的有效唯一表集，保守请求上界为 `2N+ceil(log2(min(50,N)))`，不是新的无条件产品时限。LS-19 特定夹具仍保持 ≤100 次。单次 HTTP／SQL 预算保持不变，正常 600×30 的原总耗时门槛不变。

| 编号 | 拟增验收／补验要求 | 层级与映射 |
|---|---|---|
| LS-26 | 真实 Fastify schema 路由及错误白名单＋真实客户端：普通单表 t0 仍 400；缩批后同一 t0 的表级拒绝不阻断其余 29 表，字段总量正确、最后只汇总 t0。401／403／stale／5xx／断网、无标记 READ_FAILED、伪造标记、非请求表名一律中止；细节不含 SQL／stderr／密钥 | 本机自动化；补强 LS-20／LS-08；P1-57-R1；FIX-04 |
| LS-27 | 600 张合法表，批次大于 1 时 all-deferred，缩至单表后每次成功；所有表与字段读完，允许请求数超过 100，持续进展不能被误杀 | 本机客户端测试；P1-57-R2；FIX-06 的真实变体另验 |
| LS-28 | 持续 all-deferred 从 50 严格缩至 1；每个单表连续两次后记失败，继续其余，有限请求内汇总；约束生效且其余合法表仍可成交 | 本机自动化；P1-57-R2 |
| LS-29 | 精确划分守卫：遗漏、同一表重复归属、越界表、重复终态等不能产生假进度或无限循环；所有正常终态计数唯一 | 本机自动化；P1-57-R2 |
| LS-30 | LS-19 的真实 preview＋客户端串接补验：每条虚拟 SQL 6000ms，连续三次截断（50→25→13）后出现终态；逐响应记录并 ≤20 秒，50×400 精确 20000 字段，保持 ≤100 请求。不用首轮 deferred 后即成功的替身代替截断树 | 本机模拟时钟；补强 LS-19；P1-57-G1 |
| LS-24（补验） | 根单测直接 import 实际 runner 使用的纯判定模块，禁止测试自写副本；全 deferred／零字段／部分缺失／HTTP 错误为 FAIL，正常产出物为 PASS | 本机 node --test＋runner 集成；P1-57-G4 |

**出口登记**：本次确认后本条出口扩为 LS-01–LS-24＋LS-26–LS-30（LS-25 仍仅为测试台承接，不变成功能合同门禁）；新增项已获授权，执行前不得标通过。真实 Docker、慢元数据和 600 表／1200 表基线走测试台，L1 不替代 UAT；原容量下限不得降低。

**受影响画像补记**：P1 问数方＝（不改 Public MCP／运行指导，FIX-08 成交对照）；P2 治理方↑（LS-20／26–30，合法批量配置能完成）；P3 运维方＝（仍有界、不改部署和后台水位）；P4 管理层↑（完成数按真实产出，LS-24）。本节未引入新的负向路径；如实际负载增加暴露下降，保留原门槛并回到设计，不能以此放宽时限。

**Terminology Compliance 补记**：This feature follows `webui/docs/00-product-terminology-standard.md`. New terms: None（用户术语）。拟新增内部机器字段 `error.detail.tableRejection` 及 `scope:"table"`，沿用现有原因枚举；不是 UI 新概念，直接单表与汇总文案保持现行术语。


### 11.10 P1-57执行证据

2026-11-19，委托人确认D1–D5并授权实施后，LS-19–30检出补项及R1／R2修复完成；原业务断言不改。600表真实91500字段经154次请求全齐，30表t0单表400后29表齐（权限拒绝D5，字段真实）；未知／鉴权／网络故障继续失败关闭。完整门禁与真实正常规模见[FDE修复跑次](../qa/uat/suites/fde-packcheck-3b1c62af/runs/2026-11-19-codex-p157-fix-retest.md)。本条局部通过不把整套FDE的G6正式导出FAIL改绿。
