# Offline Eval Customer Ops Spec

| 元数据 | 内容 |
|---|---|
| Spec | 161 |
| 文档名称 | Offline Eval Customer Ops |
| 文档类型 | Product / UX / API / Data Contract Spec |
| 版本 | v0.2 |
| 状态 | 评审通过，可交付开发。G3 已拍板：不完整结果文件整体拒收 |
| 撰写日期 | 2026-10-11 |
| 委托人 | xingchen |
| 来源计划 | [`docs/plans/2026-10-11-eval-module-functional-upgrade.md`](../../docs/plans/2026-10-11-eval-module-functional-upgrade.md) v0.4 |
| 关联工单 | [`webui/docs/plans/wo-202610-11-offline-eval-customer-ops.md`](plans/wo-202610-11-offline-eval-customer-ops.md) |
| 关联页面 | `/eval/cases`、`/eval/cases/:domain/:caseId`、`/eval/runs/:id`、`/eval/monitor`、`/eval/field-questions` |
| 修订 | Spec 46 的套件交换与哈希归档仍有效。客户主路径由「本机 Agent 运行」改为本 Spec 的离线跑批。Spec 65 的安全评测候选不改；本 Spec 另开业务池，不自动晋升、不把成功调用当标准答案。v0.2 吸收评审终稿：执行路径不变量、执行身份、趋势页没答出来计数、结果文件完整性；本版移除数据变化 |

## 1. 评审时要确认的决定

1. 客户页面上的一轮评测是：在 Lucy 里维护套件，在能访问客户库的环境里跑批，再把结果上传回来。Lucy 不接入大模型，跑批不调用 Agent。
2. 通过率只算「答对了 / 答错了」。没答出来留在明细里，不进分子和分母。本功能之前的运行仍用原来的通过率。
3. 拒答和澄清不在本 Spec。没有模型时无法判断模型该不该拒答。
4. 现场提问与安全评测候选分池。权限拒绝只进安全评测候选。
5. 趋势监控的「现场」不点亮黄线或红线。domain 没有绑定角色时，现场区块不展示全量访问日志。

## 2. 问题

维护质量的人今天能下载 Eval YAML、在本机 Agent 里跑、再上传 Result JSON。客户集群上没有 Agent，也没有模型密钥，所以这一轮跑不起来。跑完之后，运行明细只有 PASS / FAIL，分不清用户拿到了错表，还是根本没有表。安全评测候选只收拒绝日志。趋势监控只有一条通过率。

## 3. 目标

1. 评测用例写给人看的问法，并写明可执行的表约定：指标、维度、粒度、条件、勾稽。
2. 跑批程序随 Lucy 交付。它按截止日期编译并在客户库执行，写出带套件哈希的结果文件。
3. 上传沿用 Spec 46：哈希一致才进入通过率和趋势；不一致可同步套件或归档为本地变体。
4. 运行明细用「答对了 / 答错了 / 没答出来」说明这一次的结果。
5. 现场反复没拿到表、或反复带错条件的查法，可以审定后收成评测用例。
6. 趋势监控在通过率旁边显示现场调用，按客户端族分开。

## 4. 非目标

- 不新增、不改写现有评测题目正文。
- 不接入大模型，不用模型判分。
- 不把外部 Agent 适配器变成客户主路径。`noop` 不是离线跑批。
- 不从 `outcome = ok` 的调用生成标准答案。
- 不把权限拒绝写入现场提问或业务运行明细。
- 不把四臂消融放进运行参数。
- 不让现场报错占比触发黄线或红线。
- 不回填本功能之前的运行。
- 本版不记录数据变化，不与上一次运行比较数值。基线快照留到下一版。数字变化本身不判失败。

## 5. 一轮怎么走

```text
线上维护套件（问法 + 表约定）
        │ 下载 Eval YAML（带 suite_hash）
        ▼
线下跑批（截止日期、编译、执行、对照）
        │ 结果文件
        ▼
上传预检
        ├─ 哈希一致 → 评测运行 → 运行明细 / 趋势通过率
        └─ 哈希不一致 → 同步套件后重跑，或归档为本地变体（不进通过率）
```

语义发布后的 `sourceMapVersion` 与用例上记录的不同时，用例变为待复核，跑批跳过它，通过率不含它。人确认后才回到可跑状态。

## 6. 用例约定

`lucy_eval_schema_version: 2` 在 Spec 46 的 v1 套件上增加可执行约定。v1 套件仍可上传、下载和按旧结果归档。v2 才接受离线跑批。

一条 v2 用例：

```yaml
id: spend-by-platform-month
question: 本月各平台花费
review_status: active          # active | needs_review
semantic_version_seen: ""      # 最近一次确认时的 sourceMapVersion，可空
executable:
  required_measures: [spend]
  grain: [platform]
  required_columns: [platform, spend]
  required_filters:
    - field: date
      bind: as_of_window
    - field: platform
      bind: case_value
      value: ""                # 人填写；日志不自动写入
  reconciliation:
    - id: daily-sums-to-month
      left:  { measures: [spend], grain: [platform, date] }
      right: { measures: [spend], grain: [platform] }
      relation: sum_equals
      tolerance_abs: 0.01
as_of_binding:
  kind: this_month             # yesterday | this_month | business_period
```

问法可以保持相对时间。过滤值、客户版本字符串、问句原文不得由日志抽取自动写入。`business_period` 的期间值写在用例上，不从截止日期推导。

v1 用例没有 `executable` 时，不得进入离线跑批；上传旧结果的行为仍按 Spec 46。

## 7. 结果文件

`lucy_eval_result_version: 2`。`runner.kind` 固定为 `lucy_offline_batch`。`runner.model` 必须为空。

每条结果：

| 字段 | 取值 |
|---|---|
| `outcome` | `answered_ok` / `answered_wrong` / `not_answered` |
| `reason` | 见 §8 |
| `policy_status` | `compliant` / `noncompliant` / `unchecked` |
| `as_of` | 本次截止日期 |
| `window` | 绑定后的起止日期；`business_period` 时为用例上的期间 |

`policy_status = noncompliant` 不改变 `outcome`。语句不合规写在次列，主列仍按表的对照结果。

文件级字段：

| 字段 | 取值 |
|---|---|
| `complete` | `true` / `false` |
| `role_id` | 本次跑批使用的角色 |

单条用例超时或数据库中断时，该条记 `not_answered`，跑批继续，`complete` 仍可为 `true`。进程中断、或结果里缺少套件中仍应执行的用例时，`complete = false`。

`complete != true` 的文件不得进入通过率与质量门禁。预检落点已拍板：**整体拒收**，不写入运行历史；维护质量的人修复后重跑整批再上传。

数字相对以往运行发生变化时，不另记原因。结构和勾稽通过则为答对了。

## 8. 核心流程（伪代码）

### 8.1 跑批一条用例

跑批必须走客户环境里与 `lucy_query` 同一条语义执行路径：Lucy 侧只做鉴权与转发，编译和执行在 KTX。入口可以是进程内子命令，也可以是随镜像交付的独立命令。脚本里不得另写编译器。

每次跑批选定一个 `role_id`，且该角色属于该 domain 已绑定的角色。查询以这个角色进入与 `lucy_query` 相同的 ACL。未选定角色，或角色不在绑定列表中，整批拒绝执行。角色无权访问时，该条记没答出来，不使用绕过 ACL 的服务身份换一套更宽的结果。

```text
function runCase(case, asOf, roleId):
  if case.review_status == needs_review:
    return skip

  window = bindWindow(case.as_of_binding, asOf)
  query = compileAs(roleId, case.executable, window)
  if query.failed:
    return not_answered(mapCompileReason(query.error))

  table = executeAs(roleId, query)
  structure = checkStructure(table, query, case.executable, window)
  if structure.failed:
    return answered_wrong(structure.reason)

  for check in case.executable.reconciliation:
    if not holds(execute both sides, check):
      return answered_wrong(reconciliation_mismatch)

  policy = checkAst(query.sql, case.sql_assertions)
  return answered_ok(policy)
```

`bindWindow`：

- `yesterday`：截止日期的前一个日历日，窗口为那一天。
- `this_month`：截止日期所在公历月的 1 日到截止日期，含两端。
- `business_period`：使用用例上的期间值，不改写问法。

日历按跑批参数里的时区。未传时区则用部署配置的时区。

`checkStructure` 按这个顺序，命中即停：

1. 编译出的查询没有用例要求的业务指标，或指标名只落在行数集合 `{physical_rows, row_count, row_cnt, records, 行数}` → `missing_business_measure`。
2. 结果缺 `required_columns` 中的列 → `missing_column`。
3. 结果粒度比 `grain` 粗 → `grain_coarser`。多出来的列不失败。
4. `required_filters` 的字段没有出现在编译结果中，或 `as_of_window` 与绑定窗口不一致 → `filter_mismatch`。

`mapCompileReason`：

| 编译错误 | `reason` |
|---|---|
| 指标未绑定到数据源 | `measure_unbound` |
| GROUP BY 不合法 | `group_by` |
| SQL 语法错误 | `sql_syntax` |
| 上游校验失败 | `upstream_validation` |
| Wiki 检索或过滤失败 | `wiki_filter_failed` |
| 其他 | `compile_other` |
| 单条超时或连接中断 | `execution_interrupted` |

### 8.2 通过率

```text
function passRate(run):
  if run.result_version < 2:
    return run.pass_count / run.total_cases          # 旧运行，不回填

  scoreable = results where outcome in {answered_ok, answered_wrong}
  if scoreable is empty:
    return empty                                     # 页面显示「—」，不写 0%
  return count(answered_ok) / count(scoreable)
```

没答出来、待复核跳过、本地变体、`complete != true` 的运行都不进入这个分母。趋势上的一个点把当天各次运行按各自口径加权：旧运行用旧分母，新运行用上面的分母。同一天两种口径都有时，该点标注「旧口径 / 新口径」。黄线和红线只读这个通过率。趋势页在通过率旁并列展示没答出来计数；该计数不进入分子分母，也不点亮黄线或红线。

本地变体（`hash_status = mismatch`）继续按 Spec 46 排除趋势和质量门禁。

### 8.3 现场提问抽取

```text
function extract(pack):
  if pack.completeness.complete != true:
    return refuse("这份日志不完整，未抽取")

  calls = pack.calls
    where tool == lucy_query
    and outcome != ok
    and decision is not denied or forbidden

  calls = splitInferredTurns(calls)   # 见下
  groups = group by (sourceMapVersion, shapeHash, failureClass)

  for g in groups:
    if g.count >= 2:
      upsert card
```

`shapeHash` 是规范化 JSON 的 sha256：指标名、维度字段、过滤字段，均排序；去掉过滤值、问句、客户版本字符串。分群键是权限快照 `resolved_json.sourceMapVersion`。不用 `policy_version` 列，也不用快照哈希。

`splitInferredTurns`：推断问询的工具调用数大于 50 时，按 `shapeHash` 拆开再进入分组。调用数为 0 的推断问询丢弃。阈值 50 写在服务端常量，页面不提供调节。依据是客户日志里单条推断问询最多约 242 次调用，50 次以上已经是多次查法叠在一起。

权限拒绝不进入本函数。成功调用不进入本函数。

收成评测用例时只预填指标、维度和过滤字段名。问法留空，保存前必须由人写上。过滤值和客户版本字符串不出现在草稿里。

### 8.4 现场区块

```text
function fieldPanel(domain, window):
  roles = monitorConfig[domain].roleIds
  if roles is empty:
    return "尚未为该 domain 绑定角色"

  rows = access_log where role in roles and time in window
  for family in {脚本客户端, 对话客户端, 其他}:
    subset = rows in family
    show 调用量, 报错占比, 拒绝占比, 按 reason 计数
```

客户端族在读取访问日志时按 User-Agent 整段名称分类，不把分类结果落库。映射以后可以只改规则、不改历史数据。

| 族 | 匹配 |
|---|---|
| 脚本客户端 | User-Agent 以 `python` 开头 |
| 对话客户端 | 整段名称是 `WorkBuddy`、`Codex`、`kscc-code`、`Claude` 之一 |
| 其他 | 其余，含 `curl` 与 `undici` |

某一族调用量为 0 时不画空行。本区块不写 `pass_count`，不改变黄线或红线。

## 9. 页面

| 页面 | 行为 |
|---|---|
| 评测用例编辑 | 「问题 & 期望」编辑问法、截止日期绑定、必须列、粒度、条件、业务指标、勾稽。SQL 断言和结果断言仍在次级区域 |
| 评测用例列表 | 保留下载、上传套件、上传结果、哈希预检。本地运行命令改为离线跑批命令，不再默认 Hermes。待复核用例有单独状态 |
| 运行明细 | 主列是答对了 / 答错了 / 没答出来。展开写原因。页头展示截止日期和窗口。次列写语句是否合规。与另一次运行对比时，新增失败只包含新的答错了；没答出来单独计数 |
| 现场提问 | 与安全评测候选并列。卡片写业务语言、角色、次数、最近时间、用户看到报错还是表。操作：待审定、忽略、收成评测用例 |
| 趋势监控 | 最新通过率旁边并列没答出来计数。保留黄线、红线。混有旧运行的点标注旧口径 / 新口径。增加现场区块。点一条原因打开现场提问并带上该原因；现场提问未启用前，链接不可用 |

运行明细里的 Drift、Exit Code、Final Text 改为中文说明，放在主列旁边，不另起英文列名。

## 10. 数据

沿用 `.ktx-ui/eval/` 里的 `eval_run` / `eval_run_case`。v2 运行增加 `result_version`、`as_of`、`not_answered_count`。每条结果增加 `outcome`、`reason`、`policy_status`、`window_json`。旧行这些字段为空，读取时走 §8.2 的旧口径。

现场提问使用独立表，不写入 `security_eval_candidate`。

```sql
CREATE TABLE field_question (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  domain TEXT NOT NULL,
  source_map_version TEXT NOT NULL,
  shape_hash TEXT NOT NULL,
  failure_class TEXT NOT NULL,
  hit_count INTEGER NOT NULL,
  first_seen_on TEXT NOT NULL,
  last_seen_on TEXT NOT NULL,
  role_ids_json TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,          -- candidate | ignored | promoted
  evidence_json TEXT NOT NULL
);
```

`summary` 由失败类和指标名生成，例如「查 spend 时，这个指标还没绑到数据源」。不存问句原文和过滤值。

趋势配置为每个 domain 增加 `roleIds: string[]`，默认空数组。

## 11. API

| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/api/eval/suites/import` | 接受 v1 与 v2。v2 校验 §6。预检返回套件哈希 |
| `GET` | `/api/eval/suites/:domain/download` | 下载当前套件。含 v2 字段时 `lucy_eval_schema_version` 为 2 |
| `POST` | `/api/eval/results/import` | 接受结果版本 1 与 2。版本 2 校验 `runner.kind = lucy_offline_batch`、`runner.model` 为空、以及 `complete`。`complete != true` 时预检拒绝，不写入运行历史。哈希规则仍按 Spec 46 |
| `POST` | `/api/eval/field-questions/extract` | 吃证据包。不完整则 422，正文说明未抽取，不插入 |
| `POST` | `/api/eval/field-questions/:id/promote` | 返回评测用例草稿。不直接写盘，人在编辑器保存 |
| `GET` | `/api/eval/monitor/field` | 只读现场区块。未绑定角色时返回空行和说明文案 |

跑批命令随交付物提供，读套件文件、截止日期和 `role_id`，经与 `lucy_query` 相同的路径写结果文件。WebUI 展示该命令，不在服务器上编排 Agent。

## 12. 验收

| ID | 操作 | 期望 |
|---|---|---|
| SC-1 | 指标未绑定，跑批后打开运行 | 该行是没答出来，原因是指标还没绑上。页头通过率不含这一行 |
| SC-2 | 预测版本或实际/预测标志与绑定不一致 | 答错了，展开写明哪个条件 |
| SC-3 | 用例要求业务指标，查询只有行数 | 答错了，原因是没有交到这个指标 |
| SC-4 | 表对照通过，SQL 命中禁止写法 | 主列答对了，次列语句不合规。通过率计入这一行 |
| SC-5 | 打开本功能之前的运行 | 通过率仍是 pass / total |
| SC-6 | 问法为「本月」，两个截止日期各跑一次 | 问法相同；两次运行的窗口不同；列和粒度期望不变 |
| SC-8 | 语义版本变化后打开用例列表 | 对应用例为待复核，跑批跳过，通过率不含它 |
| SC-9 | 上传不完整证据包并抽取 | 页面说明未抽取，列表不增加 |
| SC-10 | 同一语义版本、同一未绑定指标出现两次 | 现场提问有一张待审定卡片。安全评测候选没有它 |
| SC-11 | 权限拒绝 | 只在安全评测候选 |
| SC-12 | 一条推断问询超过 50 次调用 | 现场提问按查法拆成多张卡片 |
| SC-13 | 从卡片收成用例 | 草稿可改；问法为空时不能保存；草稿不含过滤值和客户版本字符串 |
| SC-14 | 脚本调用大量成功，对话调用有报错 | 现场区块分行。最新通过率和红线不变 |
| SC-15 | domain 未绑定角色 | 现场区块说明尚未绑定，不列出访问日志 |
| SC-16 | 结果文件的套件哈希与线上不一致 | 不进通过率。仍可归档为本地变体，或先同步套件 |
| SC-17 | 结果文件填写了模型名，或 runner 不是离线跑批 | 预检拒绝，不写入运行历史 |
| SC-18 | 一次运行里多数用例没答出来，少数答对 | 趋势页通过率旁可见没答出来计数。黄线和红线不因该计数点亮 |
| SC-19 | 结果文件 `complete` 不是 `true` | 预检拒绝，不写入运行历史 |
| SC-20 | 未指定角色，或以未绑定角色跑批 | 整批不执行 |
| SC-21 | 跑批不传时区 | 窗口按部署配置的时区计算 |
| SC-22 | 同一天既有旧运行也有 v2 运行 | 趋势点标注旧口径 / 新口径 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（评审通过后、界面文案之前写入术语标准 §4.4）：

| Canonical Term | UI 主术语 | 禁止文案 | 说明 |
|---|---|---|---|
| Answer Outcome | 答对了 / 答错了 / 没答出来 | 编译终态、结果轴 | 运行明细主列 |
| Field Question | 现场提问 | 业务候选、失败池 | 从访问日志中反复出现、待审定并收成评测用例的业务提问 |
| Offline Eval Batch | 离线跑批 | 本地 Agent 运行（作本路径主名称） | 编译并在客户库重新执行的评测运行 |
| As-of Date | 截止日期 | 快照日期（与本字段混用） | 跑批参数，用来绑定相对时间 |
| Needs Review | 待复核 | 待审定（审定留给现场提问和安全评测候选） | 语义版本变化后，用例暂停进入通过率 |
| Client Family | 脚本客户端 / 对话客户端 / 其他 | 把 curl 或 undici 并进脚本客户端或对话客户端 | 趋势监控现场区块的分行；读取时分类，不落库 |

已有说法保持不变：评测用例、评测运行、通过率、趋势监控、安全评测候选。通过率帮助文案改为 §8.2。Eval YAML、suite hash、Result JSON 等标识保持 `translate="no"`。

## Design System Compliance

- 页面结构遵循 `webui/docs/design-system/20-patterns-page-layout.md`：页头放身份和主动作，通过率与现场计数放指标卡，明细放主工作区。
- 运行明细和现场提问列表遵循 `webui/docs/design-system/11-components-data-grid.md`。
- 通过率与现场计数遵循 `webui/docs/design-system/12-components-metric-card.md`。现场区块使用中性色，不用红线的危险色。
- 抽取失败、哈希不一致、问法为空不能保存，用页面内说明；短暂成功用 `webui/docs/design-system/13-components-toast.md`。
- 不新增按钮层级。评测用例页仍是一个主按钮加「评测套件 (YAML)」菜单，与 Spec 46 一致。

## 13. 与相邻规格的边界

| 规格 | 本 Spec 的态度 |
|---|---|
| Spec 46 | 保留上传、下载、哈希、本地变体三选项。客户主路径的运行命令改为离线跑批 |
| Spec 65 | 安全池的来源、审定和晋升不改。本 Spec 不实现「把成功问答自动变成标准答案」 |
| 2026-10-11 结果 / 策略 / 解释计划 | 四臂消融、拒答、澄清不在本 Spec |
| 2026-08-26 连续跌破 | 落地后红线只读 §8.2。本 Spec 不实现跌破通知 |
