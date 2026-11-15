# 大 Schema 接入 Spec（宽表与多表）

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | Spec / **v0.2** |
| 日期 / 目标版本 | 2026-11-15／不绑定产品版本号 |
| 功能编号 / 优先级 | **P1-34**／REQ-030-055／**P1**（事故续作，客户规模）。**不入 0.30 核心分母** |
| 状态 | **v0.2；终稿确权＝委托人明示确权（2026-11-15，「授权 spec 定稿，进入落地开发」）；决策 O1–O6 已闭合（见 §9）；开发授权已获得（2026-11-15，同句）；实现已落地（代码、单测与 demo 容器已升级）；测试台 `UAT-SUITE-LARGE-SCHEMA` 于 2026-11-16 必做 11 条 PASS（同日 4 次完整跑中 1 次 SCALE-09 异常 FAIL 未定位；INDEX 现值＝PASS WITH GAP）。** 跑次 2026-11-16-claude-large-schema-after-impl：必做 11 条 PASS，可选 11／12 未执行，SCALE-09 测量对象已更换（见跑次备注）。功能合同逐条收口（LS-01…15）另行判定；功能合同收口 ≠ UAT PASS；≠ 可上线 |
| 决策来源 | 2026-11-15 委托人：客户存在列非常多的表、表数非常多的 Schema，普通 MySQL 上曾出现「小库很快、大库拉取失败」的先例。委托人要求把此规模写进 UAT 并制定优化 Spec／Plan，目标是**顺利接入，而不是超时报错** |
| 需求来源 | [P1-16 库内扫表读法](lucy-20261111-catalog-scan-read-path-spec.md) 的 `tblu` 先例（789 张表，逐表查字段，20 秒内无响应体）；[P1-20 外部目录读字段](lucy-20261113-external-catalog-column-read-spec.md) 把「整库逐表批量准备耗时」明确划出本条并记 Follow-up；本次本机规模实测（[`inbox/hive-lab/REPORT.md`](../../inbox/hive-lab/REPORT.md)，诊断证据，非 UAT） |
| 实施主体 | WebUI 服务端读字段通道（`schema-structure`、`catalog-show`、`live-discovery`）与前端 `prepareSchemaStructure` 库层。不改页面组件、不改 KTX、不改问数 |
| 授权 | **已获得**：委托人 2026-11-15「授权 spec 定稿，进入落地开发」，含终稿确权（无 Codex 终审，委托人明示确权）与开发授权。授权范围＝本 Spec §实施主体所列文件与 Plan Task 1–5／7；不含写入链路（O3）与部分成功页面（O4） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」与「功能闭口与发布取证」 |
| 与既有 Spec 的关系 | **续作并收窄**：P1-16 的 SC-06／SC-07（`schema-wide` 一条 `information_schema.columns`、达 10000 行 fail-closed）**不改**；本条新增第三种读法 `batch`（有界表集、一次一条查询）。**修订** P1-20 的 `COLUMN_READ_ROW_LIMIT`（2000→10000）与「逐表新建连接」；EC-01–EC-13 的探针顺序与回退规则**保持有效**。**不改** Spec 190 的结构差异 20 张上限，只让它走同一批量读 |
| 实施计划 | [`docs/plans/lucy-20261115-large-schema-ingestion-plan.md`](../plans/lucy-20261115-large-schema-ingestion-plan.md) |
| 测试台 | [`UAT-SUITE-LARGE-SCHEMA`](../qa/uat/suites/large-schema-ingestion/suite.md)（INDEX 判定）。**规模下限不得降低**，见 §4 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.2.1 | 2026-11-16 提交前代码评审（Reviewer 子代理）后修订实现，合同不变。评审指出 LS-07 在普通 MySQL 路径无测试；补测时发现并修复一处违反 §5.2「每次调用至少读完一张表」的缺陷：首块被截断对半拆分后，子块的预算检查会让全部表落入 `deferred`、零进展。现改为「已有一块读到终态才按预算截断」。另改三处小项：SQL 字面量拼接遇非法表名显式抛错；批内去重改 `Set`；客户端累积表用无原型对象。 |
| v0.2 | 委托人 2026-11-15 授权定稿并进入开发。O1–O6 闭合（§9）：O2 客户网关超时无法取得，委托人认定本机实测规模接近客户真实用量，沿用 20 秒假设；其余按建议值采纳。 |
| v0.1-draft | 初稿。四层根因（§1）、容量与预算（§4）、批量读法（§5）、验收 LS-01–LS-15（§8）、决策点 O1–O6（§9）。基于 2026-11-15 本机规模实测 |

## 闭口层级

- 层级：功能合同
- 本条承诺：在 §4 规定的规模下限内，用户在「准备表结构」勾选至多 600 张表，系统在预算内读完全部字段并生成可校验的 Manifest。任一单次 HTTP 响应不超过 20 秒，页面主线程不被长任务卡住；不因规模返回「超时」或「超过一次可读取的上限」；个别表失败时仍读完其余表，并在一次错误里列出全部失败表与各自原因。
- 本条出口：LS-01–LS-15（本机自动化：vitest 与真实进程内检查，含对真实 `mysql2` 驱动的语句计数）。规模下限由测试台 `UAT-SUITE-LARGE-SCHEMA` 复现，结果只记 [`INDEX.md`](../qa/uat/INDEX.md)，不是本条出口。
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

    if conn 是外部目录 (catalog.database):
      for t in tables:
        if now() - start >= CALL_BUDGET_MS: deferred = rest(tables, t); break
        result = probeColumns(channel, catalog, schema, t,
                              order = [DESC, SHOW COLUMNS, DESCRIBE],  # P1-20 EC 规则不变
                              timeout = PER_TABLE_TIMEOUT_MS)
        if result.rows >= COLUMN_READ_ROW_LIMIT:
          rejections += {t, reason: too_wide, columns: COLUMN_READ_ROW_LIMIT}
        else if result.rejection: rejections += {t, reason}
        else: columns += result.columns

    else:  # 普通 MySQL
      # 语句 1：information_schema.tables，LOWER(table_name) IN (…)，解析物理表名（大小写与歧义规则同改前）
      physical = resolve(tables)                     # 0 个 → missing；>1 个 → ambiguous
      # 语句 2：information_schema.columns，table_name IN (物理名…)，一次读一块
      readChunk(physical):
        if 已读过至少一块 and now() - start >= CALL_BUDGET_MS: deferred += chunk; return
        rows = channel.run(ColumnsOfTables(schema, chunk), limit = COLUMN_READ_ROW_LIMIT, timeout = PER_TABLE_TIMEOUT_MS)
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

规模下限的真实复现不在本表，由测试台 `UAT-SCALE-01…10` 承担（见 §4 与 [`cases.md`](../qa/uat/suites/large-schema-ingestion/cases.md)）。**vitest 绿不得写成 UAT PASS。**

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
