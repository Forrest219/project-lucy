# 启用表范围表清单三态诚实展示 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 启用表范围表清单三态诚实展示 Spec |
| 文档类型 / 版本 | Spec（事故修复）／**v1.0** |
| 日期 / 目标版本 | 2026-11-23／产品线 `0.30.0`（`lucy-v0.30`） |
| 功能编号 / 优先级 | **P1-80**／REQ-030-101／**P1（事故修复）**。**不入核心分母** |
| 台账号 | 无 |
| 阶段 | S4 |
| 状态 | S4｜v1.0。终稿已确权（委托人 2026-11-23 明示「授权修复」）；开发授权已获得；实现已落地（`TableWhitelist` 三态分流＋移出门禁）；SC-01–SC-05 单测 PASS；SC-06／SC-07 本机 demo 前台浏览器 UAT PASS（[跑次](../qa/uat/suites/enabled-tables-load-state/runs/2026-11-23-cursor-p180-load-state.md)）；测试台 PASS；待委托人验收／功能合同收口；≠ 可上线 |
| 授权边界 | 终稿已确权；开发授权已获得（委托人 2026-11-23 明示「授权修复，并完成 uat」）。SC-01–SC-07 已按 Plan 完成 |
| 需求 / 验收 | [总账 P1-80](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md) · [REQ-030-101](../plans/lucy-20261102-lucy-0-30-0-requirement-pool-plan.md#req-030-101启用表范围表清单三态诚实展示) · 验收 SC-01–SC-07 |
| 配对计划 | [Plan](../plans/lucy-20261123-enabled-tables-load-state-honesty-plan.md) |
| 证据 | 2026-11-23 本机 demo 三态复现（调查目录 `…/20261123-lucyadm-timeout-investigation/enabled-tables-tri-state/`，仓库外）；仓库内以本 Spec §1 摘要为准 |
| 输出位置 | `docs/specs/lucy-20261123-enabled-tables-load-state-honesty-spec.md` |

## 闭口层级

- 层级：功能合同
- 性质：事故修复／展示诚实性（不改变启用表保存语义、不改变 Manifest 上传路径）
- 本条承诺：启用表范围页对每个连接的 `/api/connections/:id/tables` 读取，在**加载中／读取失败／成功空表**三态下，用户可见文案与「移出无效启用」可达性可区分；加载中与读取失败不得渲染成「缺少 Manifest」或「无效启用」。
- 本条出口：SC-01–SC-07 全部通过（组件单测必做；Docker 前台浏览器三态冒烟必做）。
- 不在本条出口：display snapshot BUSY／首页超时根因（P1-75 等）；连接概览 Manifest 上传流程；`/api/connections/:id/tables` 服务端扫描性能；导航 IA；线上升级与客户现场。
- 上线关系：本条收口不表示可上线。

## Terminology Compliance

This feature follows [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md). New terms: 「正在读取表清单…」（Tables list loading）；「表清单读取失败，请重试。」（Tables list read failed）。既有沿用：启用表范围、Schema Manifest、无效启用、移出无效启用、去连接概览上传 Manifest。「缺少 Manifest／本地无 Manifest」触发前提收窄为 tables success（见 C1），中文主文案不改。禁用把 loading／error 写成缺少 Manifest 或无效启用。专业词 `schema.table`、连接 ID、URL 节点须 `translate="no"`／`notranslate`。

| 英文锚点（工程） | 中文主文案 | 禁用 | 说明 |
|---|---|---|---|
| Tables list loading | 正在读取表清单… | 加载中、同步中（过宽） | 该连接 tables query pending／无成功 data 且 fetching |
| Tables list read failed | 表清单读取失败，请重试。 | 缺少 Manifest、无效启用 | 该连接 tables query isError；可附重试 |
| Missing Manifest（既有） | N 个 Schema 缺少 Manifest…／本地无 Manifest | — | **仅** tables 已成功且扫描不含该 Schema |

## 伪代码豁免

不豁免。§4 给出判定伪代码；实现须可对照单测。

## 交互合同

- 路由：/connections/enabled-tables
- 基准页：/connections/enabled-tables
- 一件事：在表清单就绪前不把加载或读失败伪装成缺少 Manifest，并在真缺扫描时仍可审阅无效启用。
- 状态：首访：打开即可识别启用表范围主任务与工具栏；空：暂无连接配置时写明原因并指向连接概览；加载：某连接 tables 未返回时写「正在读取表清单…」且不报该连接无效启用或缺 Manifest；错误：tables 读取失败时写「表清单读取失败，请重试。」且不报假阳性缺 Manifest／无效启用；0 条：筛选无命中时区内可感知且不冒充缺 Manifest；成功：tables 成功非空且覆盖启用表时无缺 Manifest／无效启用；部分：tables 成功为空或未覆盖部分启用表时允许缺 Manifest／无效启用，且仅聚合成功连接
- 主动作：保存变更或移出无效启用在可提交时至多一个 primary；不做未就绪时的移出成交。
- 决定信息：加载文案、失败文案、缺 Manifest 横幅、无效启用行与移出按钮可达性须让用户区分未就绪与已确认无 Manifest。
- 术语：本条新增「正在读取表清单…」「表清单读取失败，请重试。」，已写在本 Spec Terminology Compliance；其余已登记。
- 台账：无新台账
- 状态维度：加载、错误、成功空表与成功非空标明，同一状态维度不得互相否定。

## 元素清单

- E1｜/connections/enabled-tables｜首访｜主工作区｜打开后能识别启用表范围主任务与工具栏
- E2｜/connections/enabled-tables｜空｜主工作区｜暂无连接时写明原因并指向连接概览
- E3｜/connections/enabled-tables｜加载｜连接分组或注记｜tables pending 时可见正在读取表清单，且无该连接无效启用与缺 Manifest 贡献
- E4｜/connections/enabled-tables｜错误｜连接分组或注记｜tables 失败时可见读取失败请重试，且无假阳性无效启用／缺 Manifest
- E5｜/connections/enabled-tables｜0 条｜筛选区｜筛选无命中可感知，不冒充缺 Manifest
- E6｜/connections/enabled-tables｜成功｜表区｜tables 成功非空且覆盖启用表时无缺 Manifest／无效启用，已选计数正确
- E7｜/connections/enabled-tables｜部分｜表区与横幅｜成功空表或部分未覆盖时允许缺 Manifest／无效启用，横幅只聚合成功连接
- E8｜/connections/enabled-tables｜主动作｜工具栏｜未就绪时移出无效启用不可达；就绪且有候选时可提交，且不做第二同组 primary
- E9｜/connections/enabled-tables｜决定信息｜横幅与行状态｜用户能区分加载／失败与已确认本地无 Manifest，并见去连接概览上传 Manifest 跳转

## 交互评审

- Q1 主任务能否从页头和主工作区开始，而不必先读 Spec：通过
- Q2 PageHeader 是否满足按钮规范 §3 第 8 条，其他 action group 是否各自最多一个 primary，并且与「不做」不冲突：通过
- Q3 空、错误、0 条是否在面板内写明原因；不适用是否写了原因：通过
- Q4 决定信息是否足够；截断或隐藏时能否看见原因：通过
- Q5 控件是否与基准页同一套；新模式是否指向已存在的设计系统章节：通过
- Q6 用户可见术语是否已登记，或已写在本 Spec 的 Terminology Compliance：通过

## 1. 根因与实证

### 1.1 代码路径

`webui/src/pages/connections/TableWhitelist.tsx`：

1. 对每个连接发起 `GET /api/connections/:id/tables`（`tablesQueries`）。
2. 构建行时：`const tables = tablesData?.tables ?? []`——**query 尚无 data（pending）或失败（无 data）时回退空数组**。
3. 将配置中 `enabledTables` 里不在扫描集合者标为 `invalidEnabled: true`。
4. 将配置 Schema 中未出现在「非 invalid 行」的 Schema 计入「缺少 Manifest」。

因此 pending／error 与「成功且 `tables: []`」共用同一渲染路径。

### 1.2 本机三态复现（2026-11-23）

环境：demo `http://127.0.0.1:55176`，`compose-lucy-1` healthy，`gitSha=322438a23b3d47ce6f2e17ac782d7385ae7438c1`；管理员登录；仅改写浏览器侧 `/tables` fetch，未点「移出无效启用」、未改磁盘。

| 态 | tables 行为 | 用户可见 |
|---|---|---|
| 健康基线 | 真实 200 + 非空 | 已选 15/15；无缺 Manifest／无效启用 |
| A pending | 永不 resolve | 「2 个 Schema 缺少 Manifest」+ 全部无效启用 |
| B error | HTTP 500 | **同文**；无独立读失败提示 |
| C empty | 200 `{tables:[]}` | **同文** |

结论：横幅「缺少 Manifest」**不能**证明文件丢失；加载中与失败为假阳性。

## 2. 合同

- **C1 状态分流（按连接）**：对每个连接的 tables query，页面必须区分：
  - **loading**：`isPending` 或（无 data 且 `isFetching`）→ 展示「正在读取表清单…」（或等价术语定稿文案）；**不得**把该连接的配置启用表标为无效启用；**不得**因该连接把其配置 Schema 计入「缺少 Manifest」。
  - **error**：`isError` → 展示「表清单读取失败，请重试。」（可含重试）；**不得**标无效启用／缺 Manifest（同 loading）。
  - **success**：有成功 data → 仅此时用 `tables`（可为 `[]`）计算 invalidEnabled 与缺 Manifest（既有 Spec 116 语义保留）。
- **C2 横幅聚合**：页级「N 个 Schema 缺少 Manifest」只聚合 **success** 且判定缺 Manifest 的 Schema；loading／error 连接贡献 0。
- **C3 移出无效启用**：当任一参与「无效启用」候选的连接仍处于 loading／error 时，按钮须禁用或不可达，并说明须待表清单就绪；禁止在未就绪时提交移出。
- **C4 健康非空不回归**：demo／夹具在 tables 成功非空时，不得出现缺 Manifest／无效启用（对照 SC-04）。
- **C5 与超时／BUSY 解耦**：本条不修复 `/api/sources` BUSY 或 displayRead 超时；若 tables 本身因其它原因失败，仍走 C1 error，不得伪装成缺文件。

## 3. 验收

| 编号 | 验收项 | 证据形态 |
|---|---|---|
| SC-01 | tables **pending**：有 enabledTables 的连接不出现「无效启用」行；不出现该连接 Schema 的「缺少 Manifest」；可见加载文案 | 组件单测（deferred Promise） |
| SC-02 | tables **error**：同上禁止假阳性；可见失败文案；「移出无效启用」不可达或禁用 | 组件单测（500／`ok:false`） |
| SC-03 | tables **success + `tables: []`** 且配置含 Schema／enabledTables：允许「缺少 Manifest」与「无效启用」（真缺扫描） | 组件单测 |
| SC-04 | tables **success + 非空** 且覆盖全部 enabledTables：无缺 Manifest／无效启用；已选计数正确 | 组件单测（沿用既有夹具） |
| SC-05 | 混合：连接 A success 非空、连接 B pending → 仅 B 加载、A 正常；页级横幅不含 B 的 Schema | 组件单测 |
| SC-06 | Docker demo 前台浏览器：注入／拦 tables 复现 A／B／C 文案分流；健康刷新恢复 15/15 类基线；**禁止**验收中点击「移出无效启用」 | 真实前台浏览器＋即时计时（与 API 分列） |
| SC-07 | 术语：新文案已登记术语标准或本 Spec Terminology 定稿；断言不含禁用别名 | 文档 diff＋单测文案断言 |

## 4. 核心流程（伪代码）

```text
for each connection conn with query q = tablesQueries[conn]:
  if q.isError:
    renderConnBanner(conn, "表清单读取失败，请重试。")
    rows = []   # do NOT invent invalidEnabled from enabledTables
    continue
  if q.isPending or (q.data is undefined and q.isFetching):
    renderConnBanner(conn, "正在读取表清单…")
    rows = []
    continue
  tables = q.data.tables   # may be []
  rows = buildRowsFromScan(tables) + invalidEnabledOnlyIfNotInScan(enabledTables, tables)
  missingManifestSchemas = configuredSchemasNotInScannedValidRows(rows)

pageMissingManifestBanner = aggregate(missingManifestSchemas from success conns only)
removeInvalidEnabled.enabled = (no conn in loading/error that would contribute candidates)
```

实现细节（是否用 `isPending`／`fetchStatus`、重试是否 `refetch`）留 Plan；不得再使用「无 data ⇒ `[]` 且当作已扫描」的合并语义。

## 5. 边界（不做什么）

1. 不修 display snapshot／`DISPLAY_SNAPSHOT_BUSY`／首页「页面数据读取超时」（另案，如 P1-75）。
2. 不改 `GET /api/connections/:id/tables` 服务端扫描实现与超时预算（除非为实现 C1 所必需的错误码透出，须在 Plan 明示且不扩大本条出口）。
3. 不改变启用表保存、dryRun、runtimeAck、短名冲突（P1-64）合同。
4. 不授权在修复验收中执行「移出无效启用」或重传 Manifest 来「清症状」。
5. 不改导航 IA；不新增一级／二级菜单。

## 6. 受影响画像

> 事实源：[`docs/governance/user-personas.md`](../governance/user-personas.md)。

| 画像 | 变更前体验 | 变更后体验 | 判定 | 依据（验收编号／证据） | 负向时的补偿路径 |
|---|---|---|---|---|---|
| P1 问数方 | 未触碰问数／MCP 主路径 | 仍未触碰 | ＝ | 本条仅 WebUI 启用表范围页；未改 MCP／语义编译 | — |
| P2 治理方 | tables 未就绪时见「缺少 Manifest／无效启用」，易误清启用或重传 | 加载中／失败诚实提示；仅成功空表才报缺 Manifest | ↑ | SC-01–SC-03、SC-06；§1.2 复现 | — |
| P3 运维方 | FDE 以横幅当文件丢失证据 | 须先看 Network／态文案再判磁盘 | ↑ | SC-02、SC-06；调查 FINDINGS | — |
| P4 管理层 | 未触碰 | 未触碰 | ＝ | 无管理层可见面变更 | — |

无 `↓` 判定，无需补偿路径。不构成「主路径可用性优先」违反：合法治理路径在加载／失败时仍可读页面并重试，且禁止误操作移出。

## 7. 主路径可用性

- 约束生效：假阳性缺 Manifest／无效启用在 loading／error 下消失（SC-01／02）。
- 合法用户仍可用：成功非空路径不变（SC-04）；失败可重试；移出在未就绪时不可达（C3），避免误伤已配置启用表。

## 8. 与相邻条目关系

| 条目 | 关系 |
|---|---|
| Spec 116（无效启用） | 本条收窄其**触发前提**为 tables success；不废除无效启用概念 |
| P1-75／展示快照忙碌 | 正交；本条不修 BUSY |
| P1-64 短名／runtimeAck | 正交；保存链不变 |

## 9. 开放问题（定稿前可闭）

| ID | 问题 | 默认建议 |
|---|---|---|
| OQ-1 | 失败态是否自动 retry（react-query）还是仅手动「重试」 | 保留既有 query retry 上限；另提供手动 refetch；文案仍为失败而非缺 Manifest |
| OQ-2 | 连接很多时 loading 注记放页级还是分组头 | 分组头优先，避免误伤已成功连接的横幅 |
