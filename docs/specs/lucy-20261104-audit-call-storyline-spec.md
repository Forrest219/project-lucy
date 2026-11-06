# 访问日志调用链故事线 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / **v0.1** |
| 日期 / 目标版本 | 2026-11-04 / 不绑定产品版本号。不进入 v0.25 升级台账，不占用 `L25-*` |
| 功能编号 / 优先级 | **无** / **P1**（访问日志问询内链路与调用流水主表可读性） |
| 状态 | **v0.1 功能合同已收口（2026-11-04）**。SC-01–SC-16 关闭。本条收口不表示可上线 |
| 决策来源 | 对问询 ID `376`（`http://127.0.0.1:55176/admin/audit`）的走查：管理员能从库内拼出「登记 → 宽查失败 → 拆指标成功 → 留存率仍挂」的故事，但问询抽屉「调用明细」与调用流水主表看不出前后动作；冗余身份/协议字段占满视野 |
| 需求来源 | 页面讲故事线与链路；冗余取证字段下放 CSV / 证据包 / 行展开或对象详情。验收样例固定为问询 `376` |
| 实施主体 | Lucy WebUI 前端与审计读取层。不修改 KTX、不改写已落库的 `access_log` 行 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md)「Spec 落位规则」 |
| 与既有 Spec 的关系 | **复用，不另造分类。** 访问等级沿用 Spec 194 / [`lucy-20261102-audit-inquiry-kind-spec.md`](lucy-20261102-audit-inquiry-kind-spec.md)；问询 ID 流水号、关联键、CSV 保真、证据包握手保留规则不变。本条**修订**调用流水主表呈现密度：Spec 125「生成 SQL 主表直展」改为「主表可不直展，展开行 / 对象详情 / CSV 必须仍可完整看到」。Spec 99 裁决原因双行仍保留在全局调用流水主表（ACL 场景）。Spec 106 身份列不删除，但在主表降为次级或展开区 |
| 实施计划 | [`docs/plans/lucy-20261104-audit-call-storyline-plan.md`](../plans/lucy-20261104-audit-call-storyline-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：管理员在问询详情的调用链与调用流水主表上，能不打开库、不读 JSON，读出一次问询内各步「做了什么 → 对谁 → 结果如何」；取证全量仍在 CSV / 证据包 / 展开详情，不降保真。
- 本条出口：SC-01–SC-16。服务端扩展问询详情调用字段；纯函数故事摘要单测；组件测试打假抽屉与调用流水列；以问询 `376` 的夹具或等价快照断言故事字段可读。
- 不在本条出口：浏览器走查签字、Playwright、窄屏、镜像构建、部署、客户环境、改写历史 `access_log`、自动生成自然语言长报告、改使用概况 KPI。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- Call Storyline：UI 主术语「调用链故事线」。问询内按时间排序的调用序列，强调前后动作可读，不是新的数据实体。
- Call Action：列名「动作」。由工具名与访问等级派生的中文短标签（如「问询登记」「查数」「连接握手」），不是新的工具名。
- Call Intent：列名「意图」。一行内可读的对象与参数摘要（表 / 维度 / 指标 / 实体），由已有 `args_summary` 与表名派生，不新造库存字段。
- Call Result Summary：列名「结果摘要」。成功时带行数等规模；失败时人话失败原因；拒绝时沿用裁决原因主文。不是八桶主状态的替代名。
- Call Step Hint：列名「相对上步」（仅问询内链路）。可选短提示，如「缩指标重试」；无法判定时显示「—」。

Forbidden:

- 把「故事线」写成第三种问询种类或新的访问等级。
- 用自然语言 LLM 生成摘要作为本条承诺（本条只做确定性派生）。
- 从 CSV / 证据包删除事件 ID、生成 SQL、args、IP、凭证哈希等取证列。
- 把关联键重新当作列表主问询 ID。
- 声称「调用流水行数 = 问询记录行数」。

`Agent`、问询 ID、事件 ID、工具名、表名、生成 SQL、裁决原因码继续 `translate="no"` / `notranslate`。动作 / 意图 / 结果摘要的中文主文不包进 `notranslate`；其中嵌入的表名与工具名片段仍要防御翻译。

实施时把上表写入术语标准 §4.7。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [ ] 沿用 `pl-data-grid` / `pl-audit-table` / 有界滚动，不新做表格控件族
- [ ] 问询抽屉与调用流水都用现有密度 token；不新增硬编码色值或插画空态
- [ ] 「显示连接级」用现有勾选 / 下拉模式，与调用流水访问等级筛选语义对齐
- [ ] 不改 PageHeader 的导出、刷新和页签文案
- [ ] 行展开继续承载取证细节，不另开第二套详情页

### Exceptions (If Any)

- Spec 125：调用流水主表不再强制直展完整「生成 SQL」；完整 SQL 必在行展开、对象详情与 CSV 可得。主表可用「有 SQL」弱提示或省略。

### Follow-up Needed

- None

---

## 1. 背景

问询 `376`（真实问询，Claude Code，2026-10-20）在库内链路清楚：

1. 连接握手三次（`initialize` 等）
2. `lucy_begin_question` 登记
3. 四次宽查询失败（`Invalid use of group function`，含 `cac` / `retention_rate`）
4. 四次缩指标查数成功
5. 单独再试 `retention_rate` 仍失败

现状：

| 面 | 问题 |
|---|---|
| 问询详情「调用明细」 | 无工具、无等级、无意图、无失败人话；成功/失败同行只剩表名与状态色 |
| 调用流水主表 | 14 列；Agent / 凭证 / IP / 「后续动作不可见」每行重复；意图藏在展开 Args；失败只见 `upstream_error` |
| 对象详情 | 仍缺意图一句与失败人话 |

管理员无法在页面上读出故事线；取证字段却占满 L1。

## 2. 目标

1. 问询详情调用链默认讲故事：动作、意图、结果摘要可读；默认排除连接级；可一键显示连接级。
2. 调用流水主表故事列优先；行内重复的身份与协议上下文降到次级行或展开区；生成 SQL 不再强制主表直展。
3. CSV / 普通导出 / 证据包字段与保真不变（可新增故事列，不得删取证列）。
4. 故事字段由既有列确定性派生，不回写库存、不调用模型。
5. 以问询 `376` 为验收样例：在排除连接级后，能区分「宽查失败」与「缩指标成功」而无须打开 SQLite。

## 3. 非目标

| 不做 | 原因 |
|---|---|
| 改问询种类 / 访问等级枚举 | 已有合同 |
| 删 CSV 或证据包列 | 取证保真 |
| 自动合并重复调用为一行 | 链路要保留每一步；故事靠摘要，不靠丢行 |
| 全局调用流水按问询折叠为树 | 本条只改行呈现与抽屉链路 |
| 改写入路径或补历史 error 文案 | 读取派生 |
| 移动窄屏专项 | 不在出口 |

## 4. 已冻结决策

| ID | 决策 | 取舍 |
|---|---|---|
| D1 | 页面 = 故事线；CSV / 证据包 / 展开 = 取证全量 | 不把取证从产品拿掉 |
| D2 | 故事字段只确定性派生 | 不用 LLM |
| D3 | 问询抽屉默认 `exclude_connect` | 与调用流水缺省一致；本地开关不改全局 URL 缺省也可，但默认值必须排除 |
| D4 | 问询抽屉 L1 列：序号、时间、访问等级、动作、意图、结果摘要、耗时、操作 | 连接与物理表并入意图；事件 ID / SQL / Args 进展开或 Trace / 对象详情 |
| D5 | 全局调用流水 L1 保留：时间、问询 ID、访问等级、动作、意图、主状态/结果摘要、裁决原因、耗时；事件 ID 保留为可复制短列或次级 | Agent、访问上下文、调用来源、生成 SQL 正文移入展开（或页头/筛选上下文已表达时不在每行重复） |
| D6 | Spec 125 主表直展 SQL 让位于本条密度；展开与 CSV 仍必有完整 SQL | 明确修订，不静默违反 |
| D7 | 相对上步提示仅在问询抽屉、且仅当可判定时出现 | 全局流水不做跨问询对比 |
| D8 | 失败人话优先解析 `error_detail` 文本；解析不到则退回裁决原因中文 + 码 | 不发明新错误码表之外的业务含义 |
| D9 | 不改普通 CSV 筛选与导出口径；可选追加「动作」「意图」「结果摘要」三列到调用 CSV 与字段说明 | 追加不得破坏既有列名 |

## 5. 字段与呈现

### 5.1 派生规则（权威）

输入：单次调用上已有的 `tool`、`accessGrade(tool)`、`tables`、`argsSummary`、`outcome`、`decisionReason`、`errorDetail`、`responseRowCount`、`generatedSql`（可空）。

输出：

| 字段 | 规则 |
|---|---|
| 动作 | `initialize` / `notifications/initialized` / `tools/list` →「连接握手」；`lucy_begin_question` →「问询登记」；`lucy_catalog` / `lucy_read_source` / `wiki_*` 等浏览类 →「浏览」或沿用访问等级中文且动作更具体的短名；`lucy_query` →「查数」；其余 → 工具名原文（`translate="no"`）或「未分级动作」 |
| 意图 | `lucy_begin_question`：entities / intentSummary / question 截断；`lucy_query`：`source` 或首表 + 维度名列表 + 指标名列表（短列表，过长截断）；无 args 时仅表名或「—」 |
| 结果摘要 | `outcome=ok`：若有 `responseRowCount` 写「成功 · N 行」，否则「成功」；`denied`：裁决原因主文；`error`：从 `errorDetail` 抽出首段可读文本（如 `Invalid use of group function`），前缀「失败 · 」；都没有则「失败」 |
| 相对上步 | 仅抽屉：与上一条可见调用比，同表且指标集合为真子集 →「缩指标重试」；同表同指标且失败后再失败 →「再次失败」；同表失败后成功 →「改写后成功」；否则「—」 |

### 5.2 问询详情 API

`GET /api/admin/audit/turns/:turnId` 的每个 `accessLogs[]` 元素在既有字段上增加（或补齐）：

- `accessGrade`
- `argsSummary`（已脱敏）
- `errorDetail`（已脱敏）
- `generatedSql`
- `responseRowCount`
- `responseColumnCount`
- `responseBytes`

不新增库存列。映射失败时字段缺省，前端故事函数对缺省安全。

### 5.3 问询抽屉「调用明细」

- 标题仍为「调用明细」。
- 默认隐藏连接级；提供「显示连接级」开关（`data-testid="audit-turn-calls-show-connect"`）。
- 表头：序号、时间、访问等级、动作、意图、结果摘要、相对上步、耗时、操作。
- 操作列保留 Trace 链接。
- 点击行可展开取证：事件 ID、连接、完整表列表、Args、生成 SQL、原始错误、裁决码。

### 5.4 调用流水主表

- 主表列序（L1）：序号、时间、事件 ID、问询 ID、访问等级、动作、意图、状态（既有八桶主状态可与结果摘要同单元格上下叠）、耗时、裁决原因。
- 从 L1 移除或移入展开：访问上下文整列、调用来源整列、生成 SQL 整列正文、Agent 整列（展开「调用方」已有；筛条仍可按 Agent 筛）。
- 行展开必须仍含：Agent、凭证、IP、UA、客户端、调用来源、Args、错误、生成 SQL、返回规模。
- 筛选、分页、URL、导出契约不变。

### 5.5 CSV 与字段说明

- 普通调用 CSV 与证据包**不得删除**既有取证列。
- 允许在「工具」附近追加 `call_action`、`call_intent`、`call_result_summary`（中文值），字段说明同步。
- 问询 CSV 不改。

## 6. 核心流程（伪代码）

```
function storyOf(call, prevVisible):
  grade = accessGrade(call.tool)
  action = actionLabel(call.tool, grade)
  intent = intentFromArgs(call.tool, call.argsSummary, call.tables)
  result = resultSummary(call.outcome, call.decisionReason, call.errorDetail, call.responseRowCount)
  hint = prevVisible ? stepHint(prevVisible, call) : "—"
  return { grade, action, intent, result, hint }

function renderTurnCallChain(accessLogs, showConnect):
  visible = showConnect ? accessLogs : accessLogs.filter(c => accessGrade(c.tool) != "connect")
  rows = []
  prev = null
  for call in visible ordered by ts, id:
    rows.append(storyOf(call, prev))
    prev = call
  return rows
```

派生规则以 §5.1 表为准；本小节只固定分支顺序。

## 7. 验收（本条出口）

| ID | 断言 |
|---|---|
| SC-01 | 问询详情 `accessLogs` 含 `accessGrade`、`argsSummary`、`errorDetail`、`responseRowCount`（有则） |
| SC-02 | `storyOf` 对 `lucy_begin_question` 动作=问询登记 |
| SC-03 | `storyOf` 对失败 `lucy_query` 且 error 含 group function → 结果摘要含该人话 |
| SC-04 | `storyOf` 对成功且 `responseRowCount=16` → 含「16 行」 |
| SC-05 | 同表指标真子集 → 相对上步=缩指标重试 |
| SC-06 | 抽屉默认不渲染连接级行；打开开关后出现 |
| SC-07 | 抽屉表头含动作、意图、结果摘要 |
| SC-08 | 调用流水主表 L1 不含「访问上下文」「调用来源」「生成 SQL」列头 |
| SC-09 | 调用流水主表 L1 含「动作」「意图」列头 |
| SC-10 | 调用流水行展开仍能看到生成 SQL 与 Args（有则） |
| SC-11 | 调用 CSV 仍含事件级取证列（至少 `id` / 工具 / `generated_sql` 或既有等价列名） |
| SC-12 | 调用 CSV 新增故事列时字段说明 `export-metadata` 含对应项 |
| SC-13 | 夹具模拟问询 376 可见链（排除连接）：至少 1 登记 + ≥1 失败查数 + ≥1 成功查数，且失败与成功意图字符串不同 |
| SC-14 | 术语标准 §4.7 已登记本条新术语 |
| SC-15 | 不把流水号问询 ID 改回关联键主列 |
| SC-16 | `lint:spec-docs` 对本文件闭口层级与 stale-status 通过 |

## 8. 风险与回滚

- 主表去掉 Agent 列可能影响「扫一眼谁在打」；缓解：筛条保留 Agent，展开保留调用方。
- SQL 不直展可能影响习惯 Spec 125 的值班；缓解：展开一行即见，CSV 不变。
- 回滚：恢复旧列配置与旧 `mapAccessLogRow` 即可；无迁移。
