# 访问日志问询种类与访问等级 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.4** |
| 日期 / 目标版本 | 2026-11-02 / 不绑定产品版本号。不进入 v0.25 升级台账，不占用 `L25-*` |
| 功能编号 / 优先级 | **无** / **P1**（访问日志问询记录与调用流水的管理字段和筛选） |
| 状态 | **v0.4 功能合同已收口（2026-11-03）**。收口记录见 [`docs/reviews/2026-11-03-audit-inquiry-kind-closure.md`](../reviews/2026-11-03-audit-inquiry-kind-closure.md)。本条收口不表示可上线 |
| 审阅 | [`docs/reviews/2026-11-02-codex-review-audit-inquiry-kind.md`](../reviews/2026-11-02-codex-review-audit-inquiry-kind.md)。第 3 轮可定稿。定稿不表示开发已授权 |
| 决策来源 | 2026-11-02 对 `http://127.0.0.1:55176/admin/audit` 的管理走查：会话建立和真正问询混在问询摘要里；问询 ID 随 Agent 和生成路径变化，不是实例内的客观流水号 |
| 需求来源 | 访问日志用来管理。只建立会话的行要能一眼认出并排除；真正问询要能直接定位。问询 ID 只表示这条日志本身，不携带是谁、从哪个平台来。日志仍保留，不从账本删除 |
| 实施主体 | Lucy WebUI 与审计读取层。不修改 KTX |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **复用，不另起一套分类。** 问询重建、摘要库存和来源徽章沿用 Spec 172 / 173。调用行的互斥等级沿用 Spec 194 的 `accessGrade`。使用概况四张卡的窗口会话类不搬到本页。Spec 194 §3「不改审计问询列表」只约束 Spec 194 自己；本 Spec 承接这两页的字段和筛选 |
| 实施计划 | [`docs/plans/lucy-20261102-audit-inquiry-kind-plan.md`](../plans/lucy-20261102-audit-inquiry-kind-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：问询记录和调用流水用同一套实例内流水号作为问询 ID，号码不含 Agent、客户端或平台，删除后不回收；问询记录用问询种类分开真实问询、未上报问询和会话访问，默认不列出会话访问；调用流水用访问等级标出每一行，默认不列出连接级。普通列表与普通 CSV 共用筛选。证据包和配对包仍保留已关联握手。
- 本条出口：SC-01–SC-25。服务端测试打假流水号、种类、等级、默认筛选、分页、CSV 和两个导出包；组件测试打假列、筛选项、摘要格、抽屉和复制。
- 不在本条出口：浏览器走查、Playwright、窄屏、镜像构建、部署、客户环境、Spec 194 的 KPI 数值、Spec 172 / 173 的重建与回绑禁令。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Inquiry Kind：UI 主术语「问询种类」。问询记录的行级字段，三值互斥：真实问询、未上报问询、会话访问。不是来源徽章的第三档。
- Real Inquiry：UI 主术语「真实问询」。已落库原文问询。与 Spec 194「近 N 真实问询」同一含义，单位是问询行，不是窗口去重后的卡值。
- Unreported Inquiry：UI 主术语「未上报问询」。没有已登记原文、也不是会话访问的推断问询。不表示发生了查数。摘要仍是「未上报问询原文」。查数只看调用行的访问等级「查数」。
- Session Visit：沿用「会话访问」。问询种类的一值。仍然不是第三种来源徽章；来源徽章仍是「推断问询」。
- Access Grade：列名「访问等级」。七值沿用 Spec 194：连接、浏览、准备、问询动作、查数、运维操作、未分级。不把英文 `Access Grade` 写进列头。
- Inquiry Serial：UI 主术语仍是「问询 ID」。值是本实例审计库内的单调正整数，十进制，不补零，不含 Agent、客户端、平台或会话。已上报问询和推断问询共用这一套号。
- Correlation Key：UI 主术语「关联键」。原来的 `lucy_<uuid>` 与 `inf_<userId>_<accessLogId>`。只用于库内关联和取证对照，不再作为列表上的问询 ID。

Forbidden:

- 把「会话访问」加进来源筛选，或把来源选项改成「会话建立 / 问询」。来源仍是「全部来源 / 用户原始问询 / 系统推断问询」。
- 用「会话建立：」充当问询记录里的种类信号。种类看「问询种类」列。
- 把未上报问询标成真实问询，或把会话访问标成真实问询。
- 把未上报问询说成「发生了查数」。查数只用于访问等级。
- 把调用流水的「调用来源」（MCP 调试台受控试调 / Agent 接入调用）改名叫访问等级。
- 列表、抽屉标题和 CSV 的「问询 ID」出现 `lucy_`、`inf_`、Agent id、客户端名或平台名。
- 把事件 ID 或 `access_log.id` 借来当作问询 ID。两套号各记各的。

`Agent`、问询 ID、会话 ID、事件 ID、工具名、表名使用既有 `translate="no"` 与 `notranslate`。问询种类和访问等级的中文值不包进 `notranslate`。

实施时把上表写入术语标准 §4.7。问询 ID 改为流水号，旧键改称关联键。Session Visit 那一行仍禁止第三种来源徽章：摘要前缀仍是库存日志句子；管理列表以问询种类为准。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 新筛选使用现有 `pl-input` 下拉，放在问询记录和调用流水各自的首行筛选，不新做控件族
- [ ] 问询种类与访问等级用正文，不用新颜色徽章；来源徽章保持现有 `pl-status-badge`
- [ ] 会话访问的问询摘要格用弱化「—」，不新增空态插画
- [ ] 不改 PageHeader 的导出、刷新和页签
- [ ] 列宽沿用 `pl-audit-table` 的横向滚动，不压缩问询摘要到不可读

### Exceptions (If Any)

- None

### Follow-up Needed

- None

---

## 1. 背景

使用概况已经按 Spec 194 把真实问询、未上报查数会话、仅连接会话、浏览未问会话拆开。访问日志没有跟上这个粒度。

问询记录的「来源」只有已上报问询和推断问询。只有握手的会话访问落在推断问询里，种类写在问询摘要的「会话建立：」前面。调用流水没有访问等级列；「调用来源」回答的是调试台还是 Agent，不是这一行是连接还是查数。

管理要的是：打开问询记录就能看到真正有问句或有查数的行，会话访问仍在日志里，但不占默认列表。

## 2. 目标

1. 问询记录和调用流水的「问询 ID」改为本实例的流水号。Agent、客户端和平台只出现在各自的列。
2. 问询记录增加「问询种类」，放在「问询摘要」左边。
3. 问询记录默认只显示真实问询和未上报问询。会话访问可用筛选叫回。
4. 调用流水增加「访问等级」，放在「工具」左边。默认排除连接级。
5. 两个筛选都在首行，都在分页前生效。导出和 CSV 使用同一筛选，问询 ID 用流水号对齐，并保留关联键。
6. 不改写已有调用上的 `lucy_turn_id`，不改问询重建规则，不改使用概况四张卡的数。流水号是问询行上的新列。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 删除会话访问行或停止写入握手日志 | 它仍是日志 |
| 改 Spec 172 / 173 的聚类、回绑禁令和库存摘要 | 本条只改读取呈现和筛选 |
| 把 Spec 194 的窗口会话类重算到问询行上 | 问询行和窗口会话不是同一粒度。一个会话在窗口里只进一个会话类；问询记录一行就是一次问询 |
| 在问询记录增加「浏览未问」种类 | 问询种类只有三值。带会话的纯浏览或纯准备仍按现有重建生成推断问询，种类是未上报问询。是否查数看调用行的访问等级 |
| 改来源徽章和来源筛选的两个选项 | 问询种类与来源正交 |
| 改「调用来源」的含义 | 它继续区分调试台和 Agent |
| 改使用概况、调用监控、Agent 列表 | 那些页已经有自己的合同 |
| 回写 `question_summary` 或给 `access_log` 加等级列 | 读取时派生 |
| 改写已写入调用行的 `lucy_turn_id` | 旧关联键继续把调用挂到问询上。流水号是新增列，不替换这根外键 |
| 按人、按平台或按日把流水号分段重编 | 流水号只表示写入顺序，不表示是谁 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 问询种类在读取时由该行自身决定，三值互斥 | 不调用 Spec 194 §6.2 的窗口会话归类 |
| D2 | 原文问询优先 | `source = reported`，或库存 `question_source` 为 `reported` / `reported_tool`，种类就是真实问询，即使摘要碰巧以「会话建立：」开头 |
| D3 | 其余行里，展示用摘要以 `会话建立：` 开头的是会话访问 | 前缀常量沿用 `SESSION_VISIT_SUMMARY_PREFIX`，不复制第二份字符串 |
| D4 | 其余推断问询是未上报问询 | 不改现有推断重建范围。摘要保持「未上报问询原文」。此种类不断言发生查数 |
| D5 | 问询记录缺省 `inquiryKind=management` | 排除会话访问。`all` 才显示全部种类 |
| D6 | 调用行等级只调用 `accessGrade(tool)` | 不在审计页写第二套工具名单 |
| D7 | 调用流水缺省 `accessGrade=exclude_connect` | 排除连接级。`all` 才包含连接级 |
| D8 | 「显示协议调用」只决定协议行能否进入候选集 | 访问等级在其后再筛。默认两者相与，连接级不出现。要看握手：等级选「全部」或「连接」，并勾选显示协议调用 |
| D9 | 筛选先于分页和导出 | 页码、总数和 CSV 行集使用同一结果 |
| D10 | 列表里会话访问的问询摘要格显示「—」 | API 和 CSV 的「问询摘要」仍写出库存句子，含「会话建立：」。种类列承担管理语义 |
| D11 | 覆盖计数在种类筛选之前 | 其他筛选先加上。页上写明当前隐藏了多少条会话访问 |
| D12 | 问询 ID 是本实例审计库内的单调正整数 | 十进制、不补零、不带前缀。不含 Agent、客户端、平台、会话。已上报与推断共用一个序列 |
| D13 | 发号状态是持久化高水位，不是当前行的最大值 | 分配号码、推进高水位、插入问询在同一写事务提交。删除、清理、清空表和重启都不回收已发出的号。两类问询的号码跨表唯一。插入失败则整笔回滚，高水位不前进 |
| D14 | 关联键与流水号的映射不随推断重建删除 | 重建可以删后重插推断行，但必须按关联键写回原号。`lucy_<uuid>` 与 `inf_<userId>_<accessLogId>` 留在库里。列表主列不展示关联键。抽屉和问询 CSV 保留它。既有 `id`、`lucy_turn_id`、`inferred_turn_id` 继续保存关联键 |
| D15 | 调用流水的问询 ID 显示同一流水号 | 没有挂上问询的调用，问询 ID 为空。不临时编一个带用户名的号 |
| D16 | 搜索同时认流水号和关联键 | 深链 `turnId` 两种都接受。界面复制出去的是流水号 |

## 5. 字段与筛选

### 5.0 问询 ID

现在有两套问询 ID，都不是客观流水号：

| 路径 | 现键 | 问题 |
|---|---|---|
| 已上报，`lucy_begin_question` 成功 | `lucy_` 加随机 UUID | 每次形态不同，不能按写入顺序读，也不表达「第几条」 |
| 未上报或只有握手，推断重建 | `inf_` 加用户 id 加首条 `access_log.id` | 键里带有 Agent。不同人、不同接入身份，ID 的样子就不同 |

Agent、客户端、平台、会话已经各有自己的列。问询 ID 只回答「这是本实例的第几条问询」。

规则：

1. 问询记录和调用流水的「问询 ID」列都显示流水号。复制按钮复制这个数字。
2. 补号在任何新问询发号之前完成。先合并两表待补号行。统一排序时间是已上报问询的 `created_at`、推断问询的 `started_at`。合并后的全体按排序时间升序，时间相同再按完整关联键升序，然后依次补号。不按来源分组，不把已上报整段排在推断前面。全部补号、高水位初始化和迁移完成标记在同一事务提交；失败全部回滚。只有完成标记允许跳过迁移。没有完成标记却已有部分号码时明确报错，不静默跳过，也不重新编号。
3. 新的已上报问询在 `writeConversationTurn` 的同一事务里取号。该函数在 `webui/server/proxy/audit.ts`。首次代理写入不依赖管理员先打开审计页。新的推断问询在该关联键第一次插入时取号；重建删后重插时写回原号。
4. 关联键保持 Spec 172 的稳定性：时间窗变化不新开一条问询，也不换流水号。聚类、摘要、调用成员和回绑规则不改。
5. 抽屉在问询 ID 下方用次级文字给出「关联键」，值带 `translate="no"`。列表不放这一列。`inquiryNo` 只是管理展示号。详情、调用筛选、关联修订、单问询对账和 trace 若收到流水号，先解析成关联键，再走既有查询。旧关联键入口继续有效。不得把展示号写入 MCP 显式归因、问询预算或续接凭据。
6. 统一搜索里的纯数字只按问询流水号精确匹配，不与事件 ID、关联键里的数字片段做 OR 或模糊匹配。事件搜索使用可见入口和显式参数 `eventId`，精确匹配 `access_log.id`。`turnId` 与 `eventId` 不互相回退。同一个数字同时存在于两种编号时，各入口只返回自己的命名空间。含 `lucy_` 或 `inf_` 的 `turnId` 按关联键精确匹配。

### 5.1 问询记录

列序在「会话 ID」之后、「问询摘要」之前插入「问询种类」。

| 种类 | 界面 | 问询摘要格 | 来源徽章 |
|---|---|---|---|
| `real` | 真实问询 | 原文预览或摘要 | 已上报问询 |
| `unreported_query` | 未上报问询 | 「未上报问询原文」 | 推断问询 |
| `session_visit` | 会话访问 | 「—」 | 推断问询 |

首行下拉「问询种类」：

| 选项 | 参数 | 结果 |
|---|---|---|
| 管理相关 | 缺省，或 `inquiryKind=management` | 真实问询 + 未上报问询 |
| 真实问询 | `inquiryKind=real` | 只有真实问询 |
| 未上报问询 | `inquiryKind=unreported_query` | 只有未上报问询 |
| 会话访问 | `inquiryKind=session_visit` | 只有会话访问 |
| 全部种类 | `inquiryKind=all` | 三种都在 |

来源筛选仍在高级筛选，语义不变。两个筛选同时生效：来源选「用户原始问询」且种类选「会话访问」时结果为空。

覆盖行写三数，口径是种类筛选之前、其余当前筛选之后：`真实问询 N · 未上报问询 N · 会话访问 N`。当当前种类筛选排除了会话访问且会话访问数大于 0 时，同一行续写 `已隐藏会话访问 N`。不再只用「已上报问询 / 推断问询」充当这行的唯一计数。

抽屉基础信息增加问询种类。种类为会话访问时，问询摘要区写「这次只有会话访问，没有问句。」不把「会话建立：」放进摘要正文。客户端仍在客户端字段。

### 5.2 调用流水

列序在「工具」之前插入「访问等级」。

| `accessGrade` | 界面 |
|---|---|
| `connect` | 连接 |
| `browse` | 浏览 |
| `prepare` | 准备 |
| `ask` | 问询动作 |
| `query` | 查数 |
| `control` | 运维操作 |
| `unclassified` | 未分级 |

首行下拉「访问等级」：全部、排除连接、连接、浏览、准备、问询动作、查数、运维操作、未分级。缺省是排除连接，参数 `accessGrade=exclude_connect`。`accessGrade=all` 表示不按等级排除。

调用来源、工具名、Session ID、显示协议调用仍在高级筛选，含义不变。

### 5.3 API 与 CSV

`GET /api/admin/audit/turns` 每行增加 `inquiryKind`。查询参数 `inquiryKind` 缺省按 `management`。非法值按 `management`，不回 500。

`GET /api/admin/audit` 每行增加 `accessGrade`。查询参数缺省按 `exclude_connect`。非法值按 `exclude_connect`。

问询 CSV 的「问询 ID」改为流水号，并在其后增加「关联键」。再在「问询摘要」前加「问询种类」。该列是中文值。同一行的「问询摘要」仍是库存句子。

调用 CSV 新增列 `inquiry_no`，已上报和推断调用都填所属问询的流水号，未挂接留空。既有 `lucy_turn_id`、`inferred_turn_id` 保留关联键。字段说明把这两列标为关联键，把 `inquiry_no` 标为问询 ID。问询 CSV 的「问询 ID」与调用 CSV 的 `inquiry_no` 对齐。普通列表与普通 CSV 使用同一筛选。在「工具」前加「访问等级」，中文值。

`GET /api/admin/audit/export-inquiry-pack` 从同一次问询结果取得关联键和流水号。包内非空流水号必须属于其中的 turns.csv。`GET /api/admin/audit/export-pack` 与配对包继续按 Spec 172 / 173 保留已关联握手，不套用普通调用列表「排除连接」的缺省。字段说明 `GET /api/admin/audit/export-metadata` 的 `fields[]` 同步改列。

管理读入口接受流水号时先解析为关联键：`GET /api/admin/audit/turns/:turnId`、调用列表的问询筛选、`association-revisions?originalTurnId=`、`GET /api/admin/audit/reconciliation/inquiries/:turnId`、`GET /api/admin/trace/events?turnId=`。解析失败按未找到，不把数字原样送进预算或 MCP 归因。

## 6. 核心流程（伪代码）

```text
allocateInquiryNo(correlationKey):
  existing = persistent map from correlationKey to inquiryNo
  if existing is not null:
    return existing
  in one write transaction:
    next = highWater + 1 or 1
    insert the turn row with next
    set highWater = next
  if the transaction rolls back:
    highWater does not advance
    next is not issued
  return next

backfill:
  if completion marker exists:
    return
  if any inquiryNo exists and marker is absent:
    fail closed
  in one transaction:
    rows = merge reported and inferred turns
    sort key = created_at for reported, started_at for inferred
    sort rows by sort key ascending, then full correlationKey ascending
    assign 1..n in that single order
    do not group by source
    set highWater = n
    write completion marker
  on failure:
    roll back numbers, highWater, and marker

inquiryKind(turn):
  if turn.source == reported
     or turn.questionSource in {reported, reported_tool}:
    return real
  if displayedSummary(turn) starts with SESSION_VISIT_SUMMARY_PREFIX:
    return session_visit
  return unreported_query

turns(filter):
  rows = existing turn list for time, agent, source, outcome, text, table
  for row in rows:
    row.inquiryNo = stored serial for row.correlationKey
    row.inquiryKind = inquiryKind(row)
  counts = count rows by inquiryKind
  kind = filter.inquiryKind or management
  if kind == management:
    rows = rows where inquiryKind != session_visit
  else if kind != all:
    rows = rows where inquiryKind == kind
  page and export use rows
  response.kindCounts = counts

calls(filter):
  rows = existing call query, including the protocol gate
  for row in rows:
    row.inquiryNo = serial of row.lucy_turn_id or its inferred correlation key, else empty
    row.accessGrade = accessGrade(row.tool)
  grade = filter.accessGrade or exclude_connect
  if grade == exclude_connect:
    rows = rows where accessGrade != connect
  else if grade != all:
    rows = rows where accessGrade == grade
  page and export use rows

list summary cell:
  if inquiryKind == session_visit: show —
  else: show questionPreview or questionSummary

csv summary cell:
  always the stored question summary, including 会话建立 when that is the stored sentence
```

`displayedSummary` 使用现有 `displayedTurnIdentity` 改写客户端名之后的摘要，保证「会话建立：」后面的客户端名变化不会把种类判成未上报问询。推断重建若先删后插，插入时从关联键映射写回原 `inquiryNo`，不调用 `allocateInquiryNo`。

## 7. 验收

| ID | 断言 |
|---|---|
| SC-01 | 已上报问询的 `inquiryKind` 为 `real`。问询摘要格是原文，不是「—」 |
| SC-02 | 摘要以「会话建立：」开头的推断问询，`inquiryKind` 为 `session_visit`，来源徽章仍是「推断问询」，列表摘要格是「—」 |
| SC-03 | 摘要为「未上报问询原文」的推断问询，`inquiryKind` 为 `unreported_query`，界面文案是「未上报问询」，摘要格仍是这句固定文案。带会话的纯 `lucy_catalog`、纯准备调用、以及含 `lucy_query` 的推断簇都仍生成问询；前两类种类是未上报问询，不标成查数。含 `lucy_query` 的调用行访问等级是查数 |
| SC-04 | 不带 `inquiryKind` 的问询列表不含会话访问，含真实问询和未上报问询 |
| SC-05 | `inquiryKind=all` 含会话访问；`inquiryKind=real` 只有真实问询；`inquiryKind=unreported_query` 只有未上报问询；`inquiryKind=session_visit` 只有会话访问 |
| SC-06 | 来源为已上报、摘要却以「会话建立：」开头时，种类仍是真实问询，且出现在默认列表 |
| SC-07 | 覆盖计数在种类筛选前计算。默认列表写出隐藏的会话访问条数 |
| SC-08 | 种类筛选在分页前生效。每页大小不变时，总数等于筛选后的行数 |
| SC-09 | 问询 CSV 含「问询种类」和流水号「问询 ID」。管理相关导出不含会话访问。`all` 导出的会话访问行，问询摘要列仍是库存的「会话建立：…」，关联键仍以 `inf_` 开头。普通问询 CSV 的行集与同一筛选的列表一致 |
| SC-10 | `initialize` 的访问等级是连接，`lucy_query` 是查数，`lucy_catalog` 是浏览，未知工具名是未分级。等级与 `accessGrade` 一致 |
| SC-11 | 不带 `accessGrade` 的调用列表不含连接级。`accessGrade=all` 且显示协议调用时，`initialize` 出现且等级为连接 |
| SC-12 | `accessGrade=query` 只留查数。调用来源筛选仍可同时限制调试台或 Agent |
| SC-13 | 普通调用 CSV 含「访问等级」中文值和 `inquiry_no`，行集与同一筛选的列表一致，并保留 `lucy_turn_id` 与 `inferred_turn_id`。配对包与证据包仍含已关联握手，不因普通列表缺省排除连接而丢掉这些行。配对包内非空 `inquiry_no` 都能在该包 turns.csv 找到 |
| SC-14 | 问询种类下拉在问询记录首行；访问等级下拉在调用流水首行。来源下拉仍只有用户原始问询和系统推断问询 |
| SC-15 | 会话访问抽屉不把「会话建立：」当作问句，并显示问询种类「会话访问」 |
| SC-16 | 非法 `inquiryKind` 与非法 `accessGrade` 按各自缺省处理，响应成功 |
| SC-17 | 使用概况四个 KPI 的计算函数和响应字段未被本条改写 |
| SC-18 | 术语标准 §4.7 写入问询种类、未上报问询、访问等级、问询 ID 流水号和关联键。未上报问询的说明写明不表示查数。会话访问仍禁止作为第三种来源徽章 |
| SC-19 | 两个不同 Agent、两种来源的问询，列表上的问询 ID 都是正整数且互不相同，文本不含 `lucy_` 或 `inf_`。两个连接同时发号时号码不重复。删除最大号、清空问询行后重启，下一个号仍大于已发出的高水位 |
| SC-20 | 同一推断问询换时间窗、删后重建、中间插入另一条问询后再重建、进程重启后再重建，流水号都不变。关联键仍是原来的 `inf_<userId>_<id>`。未打开管理页时，第一次 `lucy_begin_question` 也能取到号 |
| SC-21 | 调用流水挂到该问询时，问询 ID 与问询记录相同。没有问询的调用，问询 ID 为空。用流水号和用关联键分别打开问询详情、调用筛选、关联修订、单问询对账和 trace，五处结果一致。展示号不写入问询预算或 MCP 归因字段 |
| SC-22 | 问询 CSV 的「问询 ID」与调用 CSV 的 `inquiry_no` 是同一流水号。问询 CSV 另有「关联键」。调用 CSV 的 `lucy_turn_id` 与 `inferred_turn_id` 仍是关联键。字段说明与表头一致 |
| SC-23 | 纯数字统一搜索只命中该问询流水号，不命中事件 ID 或关联键里的数字片段。可见的事件搜索按 `eventId` 精确命中 `access_log.id`，不回退到问询。完整关联键仍打开同一问询。复制按钮放进剪贴板的是流水号。构造问询号 12、另一问询关联键含 12、事件 ID 12 与 112，四个入口互不串号 |
| SC-24 | 补号先合并两表，按统一排序时间再按完整关联键升序，不按来源分组。夹具为已上报 10:00（`lucy_b`）、推断 09:00（`inf_a`）、已上报 09:00（`lucy_a`）时，顺序是 `inf_a`、`lucy_a`、`lucy_b`：两个 09:00 里 `inf_` 先于 `lucy_`。与高水位和完成标记同一事务。中途失败全部回滚。重复初始化不重编号。没有完成标记但已有部分号码时失败关闭。补号完成后新号更大。插入失败不消耗号码 |
| SC-25 | 带会话且只有 `lucy_catalog` 的簇、只有准备类工具的簇，重建后仍各有一条推断问询，种类都是未上报问询。含 `lucy_query` 的推断簇种类也是未上报问询，其查数调用的访问等级是查数 |

## 8. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 172：推断问询 ID 为 `inf_<userId>_<首条 access_log.id>`，并作为列表上的问询 ID | 该字符串改为关联键，继续保证换时间窗不新开问询。列表和 CSV 的问询 ID 改为实例内流水号 |
| Spec 172：会话访问靠摘要前缀识别，不是来源徽章 | 保持。管理列表另给问询种类，摘要格不再承担识别 |
| Spec 173：未上报摘要固定，会话访问摘要仍是「会话建立：」加客户端名 | 库存和 CSV 摘要保持。列表摘要格对会话访问显示「—」 |
| Spec 106 / 术语标准：来源筛选两项 | 保持。另增问询种类筛选 |
| Spec 194：审计问询列表不在该条实施范围 | 保持为 Spec 194 的非目标。本条单独实施列表字段和筛选 |
| 调用流水默认排除握手工具，不标等级 | 默认再排除全部连接级。等级列可见 |
