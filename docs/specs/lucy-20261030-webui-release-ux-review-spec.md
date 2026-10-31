# 发版前 WebUI 三层检查 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 发版门禁设计基线 / v1.2 |
| 日期 | 2026-10-30 |
| 功能编号 | 不另派 L25 编号。这是发版前的检查约定，不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 功能台账。功能编号待 PM 指派 |
| 状态 | **v1.2 已落地**。2026-10-30 用户授权实现 S1–S4。结构套件、清单、台账校验和 §7 Open 登记已写入仓库。契约夹具上第一次跑 `cd webui && npm run e2e:release-ux`：27 项里 24 项通过，3 项红（使用概况出现「Token 凭证」；发布记录、配置审计的时间预设已选且结束时间为空）。按 §4，结构红则走查未开始。**2026-10-30 当日已修掉这 3 项**（使用概况改「Token 凭据与活跃」；发布记录与配置审计在预设选中时写入结束时间；发布记录「Reindex」改「重建索引」），复跑 `cd webui && npm run e2e:release-ux` **27/27 全绿**。走查和签字还没有做，不能把本版 UI 记成通过。审阅记录见 [2026-10-30-codex-review-webui-release-ux.md](../reviews/2026-10-30-codex-review-webui-release-ux.md) |
| 决策来源 | 2026-10-30 用户确认三层分工：结构检查、代理浏览器走查、xingchen 兜底签字；先写约定与差距，再落盘 Spec |
| 需求来源 | 行权限视图、访问关系图、访问日志出现布局和风格断裂后，需要每次发版都按同一标准看完全部表面 |
| 实施主体 | Lucy 发版流程与 WebUI 测试。不修改 KTX，不改页面产品行为 |
| 与既有 Spec 的关系 | 不改页面呈现 Spec。行权限视图、访问关系图、访问日志的修法仍以各自 Spec 为准，这三页只是本约定的必走表面。不改 [`docs/qa/e2e-release-checklist.md`](../qa/e2e-release-checklist.md) 的 UX-01–UX-07 |

## 闭口层级

- 层级：功能合同
- 本条承诺：发版前必走三层——结构层、走查层、兜底签字层；结构层由独立 Playwright 套件打假侧栏页面的结构不变量，台账在 `productionReady: true` 时强制消费一条 `webui-ux-review` 的 passed 证据。
- 本条出口：SC-01–SC-13 的机器部分，即结构套件、表面清单测试与发版台账测试。SC-01–SC-13 的编号与断言见 §10。
- 不在本条出口：代理浏览器走查与 xingchen 兜底签字、整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级、客户发布签发。
- 上线关系：本条收口不表示可上线

## 1. 现象

2026-10-30 对照仓库现状：

- `@pr-smoke` 只抽若干旅程。`E2E-NAV-02` 只断言连接概览的页头。`cd webui && npm run e2e:contract:release` 等于在夹具上跑全部 Playwright，文档写明不能签发客户发布。
- 客户发布的浏览器证据是 `e2e:real:*` 与 `gate:customer-release`。`E2E-GUI` 的人工步骤是导入 MCP、对标准答案、越权拒绝，不是再看一遍界面。
- [`docs/ui-ux-feedback/`](../ui-ux-feedback/README.md) 已有页面台账，但大量条目标成 Fixed 时写明当时没做浏览器验证。发版台账没有 `webui-ux-review`。
- PR 的 Design System Compliance 管单次改动。它不代替发版走查。
- 已发布的 `v0.20.0` 没有这道门。本 Spec 不追补、不改判该版本。

## 2. 范围

### 2.1 本期包括

- 发版前三层检查的顺序、通过条件和证据。
- 结构层的套件边界、第一批可机器断言的不变量，以及后一批留给走查的不变量。
- 走查表面、基准页、记录格式，以及失败写回 UI 台账的规则。
- 发版台账如何引用手工签字，且不把红的 Required 门禁写进已发布记录。

### 2.2 本期不包括

- 任何页面的视觉或交互修改。
- 全页像素对比、移动窄屏、按 1–10 重新打分。
- 把结构套件并进 `@pr-smoke`、`e2e:contract:release` 或 `e2e:real`。
- 用结构层单独把客户包标成可生产。
- 追补 `docs/releases/v0.20.0.json`。
- 复用客户证据清单里的 UX-01–UX-07。那些编号是管理到使用的业务旅程。

## 3. 决策

| 编号 | 决策 | 裁定 |
|---|---|---|
| D1 | 三层顺序 | 结构层红了，不开始走查，也不能把本版 UI 记成通过。走查是证据。兜底层可以改走查判断，改判必须写原因。`webui-ux-review` 以兜底层为准 |
| D2 | 结构层跑在哪 | 夹具实例：development、本机回环、认证关闭，与现有契约 E2E 相同。独立 Playwright 配置，视口只有 Chromium 1920×1080。命令为 `cd webui && npm run e2e:release-ux`。不进 PR CI |
| D3 | 结构层第一批断言 | 打开 `navGroups` 每一项的 `to`，再打开 `/help`。侧栏页恰好一个 `h1`，文案等于该项 `label`。`/help` 恰好一个非空 `h1`，不要求等于侧栏名。可见正文不得出现 `Failed to fetch` 或堆栈帧。页头、指标名、表头、空态、Toast 不得出现 §5 的禁止词；`pre`、`code`、`translate="no"` 节点和帮助中心正文不扫。时间预设已选中且同一筛选条的结束时间空着、开始时间有值，则失败 |
| D4 | 结构层后一批 | 页头可见主动作不超过 3 个、空态在面板内、同一状态维度不得互相否定。这三条先由走查执行。机器化留到第一批稳定之后，不放进第一批实现。空态缺少下一步是 P1，不升成阻断 |
| D5 | 走查层 | 代理用浏览器，在版本页构建提交等于台账 `commit`、健康检查通过、工作区不是脏构建的候选实例上看。任一不满足则不开始走查。1920×1080 打开 §6 的全部表面并点开分区 tab。1440×900 只看壳层，以及页头可见动作不少于 2 个的页。每个表面只记 PASS、FAIL 或 N/A，并带阻断或 P1。N/A 必须写原因。失败才截图，截图进 `docs/ui-ux-feedback/assets/` |
| D6 | 兜底层 | xingchen 再看一遍。签字写入 `docs/releases/ux/<version>.md`。走查 FAIL 被改成通过时，记录里写改判原因 |
| D7 | 编号 | 发版检查单用 UX-R01–UX-R12。页面问题继续用 `UX-<PAGE>-NNN`。两套编号不互相占用。UX-01–UX-07 保持业务旅程含义 |
| D8 | 台账 | 从本 Spec 实现之后的下一产品版本起，`deliveryPackage.productionReady === true` 必须带一条 `webui-ux-review`：`required: true`、`manual: true`、`status: passed`，`evidence` 等于已存在的 `docs/releases/ux/<version>.md`。该文件的结果块必须是 `result: passed`、`reasonClass: none`、`workspaceDirty: false`、`structure: green`。手工门禁不填 CI `run`。校验器只对 `manual: true` 放宽「passed 必须有 run」。`required: true` 且 `failed` 仍然非法。v0.20.0 与 `productionReady !== true` 的记录不强制这条门禁。`productionReady: true` 却缺少该门、状态不是 passed、或证据结果块不匹配，校验失败 |
| D9 | 阻断与 P1 | 阻断：漏看表面、实例不合格、结构层红、页头或主工作区崩坏、空态不在面板内或看不出原因、错误露出原文或堆栈、筛选让 0 条不可信、同一状态维度互相否定、相对上一版变差、P1 没有登记负责人或目标版本。P1：术语漏网、密度和页头拥挤、空态在面板内且写了原因、页面仍可认出，但没有下一步。已登记的 P1 可以随版发布，不阻止 `passed` |
| D10 | 第一次启用 | 已发布的 v0.20.0 不改。第一次采用本门的版本，在走查前把 2026-10-30 低于 6 分的表面登记为 Open，见 §7。UX-R03 从这批编号复看 |
| D11 | 基准页 | 走查开始先看 Token 凭据 `/admin/tokens`、语义资产 `/catalog`、业务 Skill `/skills`、启用表范围 `/connections/enabled-tables`、Agent 列表 `/admin/agents`。新页面和改过的页面与这五页用同一套页头、指标卡、表、Tab 或分段控件 |
| D12 | 代表深度 | 每次发版走完侧栏全部入口、`/help`、§6 的分区 tab，以及四个代表编辑器：一张表、一篇 Wiki、一个 Agent、一个角色。自上一份 UX 记录以来改过的编辑器追加为必走行。没有可打开的对象时记 N/A 并写原因 |

时间范围分段控件是页面的一部分，不单独成行。包括调用监控的时间范围、使用概况的 24 小时 / 7 天、趋势监控的 7 天 / 30 天 / 90 天。

品牌配置里的产品名、确实没有业务数据时的空列表，记一笔即可，不记缺陷。

## 4. 核心流程（伪代码）

```text
releaseUxGate(candidate):
  if candidate.productVersion is v0.20.0:
    do not add webui-ux-review
    return historical

  instanceOk = commit matches AND health ok AND workspace is not dirty
  if not instanceOk:
    write ux record:
      result = blocked
      reasonClass = instance-not-ready
      workspaceDirty = true when the workspace is dirty, else false
      structure = not-run
    do not run the walk
    webui-ux-review cannot be passed
    productionReady cannot be true
    if a non-production ledger row is still required:
      record notExecuted
      reason states the walk has not started and which instance check failed
    return blocked

  structure = run "cd webui && npm run e2e:release-ux" on the fixture
  if structure is red:
    write ux record:
      result = blocked
      reasonClass = structure-blocked
      workspaceDirty = false
      structure = red
    do not run the walk
    webui-ux-review cannot be passed
    productionReady cannot be true
    if a non-production ledger row is still required:
      record notExecuted
      reason states the walk has not started because structure failed
    return blocked

  walk every surface in §6, including the four representative editors
    and any editor changed since the previous ux record
  for each surface:
    record PASS, FAIL, or N/A(reason), and severity blocking or P1
    if FAIL:
      append UX-<PAGE>-NNN to docs/ui-ux-feedback
      save screenshot under docs/ui-ux-feedback/assets/

  review = xingchen reads the walk
  if review overrides a walk result or its severity:
    record the reason

  blocking = FAIL items still marked blocking
  p1 = FAIL items still marked P1
  if any P1 lacks an Open ledger item with owner and target version:
    treat that P1 as blocking

  if blocking is not empty:
    write ux record:
      result = blocked
      reasonClass = walk-blocked
      workspaceDirty = false
      structure = green
    webui-ux-review cannot be passed
    productionReady cannot be true
    if a non-production ledger row is still required:
      record notExecuted
      reason states the walk finished and cites the blocking ledger ids
    return blocked

  write ux record:
    result = passed
    reasonClass = none
    workspaceDirty = false
    structure = green
    signer = xingchen
    accepted P1 ids
  record gate:
    name = webui-ux-review
    required = true
    manual = true
    status = passed
    evidence = docs/releases/ux/<version>.md
  return passed
```

`e2e:contract:release` 继续是 `playwright test` 使用 `webui/playwright.config.ts`。结构套件放在独立 `testDir` 和独立 config，默认那次收集不到它。

`notExecuted` 只有三个原因类，并且都要先写下 UX 记录：

| reasonClass | 走查 | 原因里必须写明 |
|---|---|---|
| `instance-not-ready` | 未开始 | 提交不一致、健康检查失败，或工作区是脏构建。脏构建即使假设表面全绿，也不能 `passed` |
| `structure-blocked` | 未开始 | 结构层失败，列出失败断言 |
| `walk-blocked` | 已完成 | 阻断项仍开着，列出 `UX-<PAGE>-NNN` |

已登记的 P1 不进入 `walk-blocked`。不得用 `notExecuted` 表示一份还没写 UX 记录的发布。

## 5. 禁止词

术语事实源是 [`webui/docs/00-product-terminology-standard.md`](../../webui/docs/00-product-terminology-standard.md)。标准与下表冲突时，以标准为准。

结构层第一批只扫描页头、指标名、表头、空态和 Toast。`pre`、`code`、`translate="no"` 节点和帮助中心正文不扫。下表按语境判断。主标签用了禁止值则失败。允许的补充说法不失败。替换目标以术语标准的 UI 主术语为准。

| 语境 | 禁止 | 允许，不失败 |
|---|---|---|
| 按钮、标题或指标的可访问名称只有 Role、Case、Run、domain、Drift、Diff、Reindex | 用这些英文词当主标签 | `Role` 出现在 `translate="no"` 节点，或紧挨「角色权限」作补充。主标签应写成角色、用例、运行、评测域、漂移、差异、重建索引 |
| 可见文案 Token 凭证 | 凭证 | Token 凭据 |
| 可见文案 `source · conn` 或 `source·conn` | 这两个片段 | 张表 · 个连接 |
| 按钮、标题或指标是 Data Capability Preview，或被改成「数据能力预览」 | 英文主标签，以及「数据能力预览」 | UI 主术语是「数据能力」。capability 列表、工具 × 源可以作为补充 |
| 类型列原文 `single_turn` | 类型列直接显示该标识 | 单轮，或术语标准里的登记名 |
| 按钮、标题或指标只有 `constraints` | 用它代替主标签 | 主标签是「个人行限制」时，`constraints` 可以作为补充 |

`Failed to fetch` 与堆栈帧按错误原文处理，不进这张术语表。堆栈帧指可见文本中匹配 `at <符号> (<路径>:<行>:<列>)` 的一行。

## 6. 必走表面

侧栏以 `webui/src/app/navigation.ts` 的 `navGroups` 为准。新增侧栏项必须同时出现在走查清单里。

| 模块 | 表面 |
|---|---|
| 运行状态 | 系统概览；调用监控；使用概况的「数据访问」和「界面使用」（`?view=interface`） |
| 数据接入 | 连接概览；启用表范围 |
| 业务上下文 | 语义资产；一张表的编辑器 `/catalog/:conn/:schema/:table`；业务 Wiki 的目录和一篇文档；业务 Skill |
| 语义发布 | 发布工作台；发布记录 |
| 质量评测 | 评测用例；运行历史；趋势监控；现场提问；安全评测候选 |
| 访问治理 | Agent 列表；一个 Agent 的基本信息、Token、权限预览、变更预览；Token 凭据；角色列表；一个角色的概览、可访问的表、允许的 MCP 工具、行级策略（可选）、使用情况；行权限视图；访问关系图；访问日志；MCP 调试台；配置审计 |
| 系统设置 | 品牌外观；登录账户；版本信息；帮助中心 `/help` |

候选实例上没有可打开的 Agent、角色、Wiki 文档或表编辑器时，该代表表面记 N/A 并写原因。自上一份 UX 记录以来改过、且不是本次抽中对象的编辑器，另起一行。抽中对象本身就是改过的编辑器时，这一行同时覆盖代表名额和变更名额，并在记录里注明。不得为了走查去创建或删除数据。

每个表面问这八句，对应 UX-R05–UX-R10：

1. H1 是否与侧栏同名，描述能否一行读完，主动作是否不超过 3 个。
2. 主工作区是否有内容，或有一块空态面板。
3. 空态是否在面板内并说明原因。没有下一步时，页面仍可认出则记 P1，看不出原因或只剩一行字则记阻断。
4. 错误是否为中文产品文案，且可以重试。有没有堆栈、`Failed to fetch`、原始 ISO 时间。
5. 筛选是否完整。0 条结果能否解释。
6. 用户可见文字是否使用中文主术语。允许的补充说法不记失败。
7. 同一对象在同一状态维度上是否互相否定。正式 Role 与「使用中」可以同时出现。同一张表不能既是未启用又是已启用。
8. 指标卡、表、Tab 是否和基准页是同一套。

## 7. 第一次启用要登记的 Open 项

来源是 2026-10-30 走查里低于 6 分的表面。只登记，不在本 Spec 里规定修法。

调用监控；Wiki 目录；Wiki 文档；发布工作台；发布记录；运行历史；现场提问；安全评测候选；Agent 的 Token、权限预览、变更预览；角色概览；角色行级策略；MCP 调试台；配置审计；登录账户。

行权限视图、访问关系图、访问日志没有进入那次打分表，因为当时已经确认断裂。它们仍是 §6 的必走表面。

## 8. 检查单

| 编号 | 检查 | 通过条件 | 级别 |
|---|---|---|---|
| UX-R01 | 运行实例 | 版本页构建提交等于台账 commit，健康检查通过，工作区不是脏构建 | 阻断 |
| UX-R02 | 路由覆盖 | 侧栏每一项、`/help`、§6 的分区 tab、四个代表编辑器，以及本版改过的编辑器都有一行结果。没有对象时该行是 N/A 并写原因 | 阻断 |
| UX-R03 | 未关闭台账 | Open 项本版都复看了，改为 Verified，或仍是 Open 并写进本版记录 | 阻断 |
| UX-R04 | 壳层 | 1440 与 1920 都能到达全部侧栏入口；页头可见主动作不超过 3 个 | 阻断 |
| UX-R05 | 页头与主工作区 | 侧栏页 H1 与侧栏同名；主任务在工作区内；空态在面板里 | 阻断 |
| UX-R06 | 空态与错误 | 阻断：空态不在面板内、看不出原因，或错误露出原文、堆栈、不能重试。P1：空态在面板内、写了原因、页面可认出，但没有下一步 | 阻断与 P1 分开 |
| UX-R07 | 筛选可信 | 时间预设和自定义范围不同时残缺；0 条能区分「筛没了」和「本来没有」 | 阻断 |
| UX-R08 | 状态维度 | 同一对象在同一状态维度上不得互相否定。不同维度可以并存，例如正式 Role 与使用中 | 阻断 |
| UX-R09 | 术语 | `lint:terminology` 通过；界面抽查没有 §5 的禁止词 | lint 阻断，新词为 P1 |
| UX-R10 | 对照基准 | 本版改过或新增的页面使用基准页的指标卡、表、Tab 或分段控件 | 新页面不合格则阻断 |
| UX-R11 | 证据 | 失败有台账编号和截图；通过不要求全量截图 | 阻断 |
| UX-R12 | 登记 | `docs/releases/ux/<version>.md` 有本版记录；可生产发布的台账含已通过的 `webui-ux-review` | 阻断打可生产的 tag |

## 9. 记录

`docs/releases/ux/<version>.md` 开头有这四行，供台账校验器读取：

```text
result: passed
reasonClass: none
workspaceDirty: false
structure: green
```

`result` 只取 `passed` 或 `blocked`。`reasonClass` 只取 `none`、`instance-not-ready`、`structure-blocked`、`walk-blocked`。`workspaceDirty` 只取 `true` 或 `false`。`structure` 只取 `green`、`red` 或 `not-run`。`passed` 只允许上面这四行的取值组合。

其余字段：产品版本、40 位构建提交、视口、走查日期、每个表面的 PASS / FAIL / N/A 与级别、失败的 `UX-<PAGE>-NNN` 与截图路径、兜底签字人、改判原因、仍接受的 P1、相对上一版的新失败 / 已关闭 / 仍开放。

## 10. 验收

| 编号 | 断言 | 对应流程 |
|---|---|---|
| SC-01 | `webui/playwright.config.ts` 的一次全量收集不包含结构套件；结构套件只有 Chromium 1920×1080 | 结构层与契约 E2E 分离 |
| SC-02 | `e2e:release-ux` 打开 `navGroups` 每一项 `to` 和 `/help`。路由清单从 `navigation.ts` 读出，不手抄第二份 | D3 |
| SC-03 | 侧栏页恰好一个 h1 且等于 `label`；`/help` 恰好一个非空 h1 | D3 |
| SC-04 | 可见 `Failed to fetch` 或堆栈帧使该页失败 | D3，结构层红分支 |
| SC-05 | §5 的禁止主标签出现在页头、指标名、表头、空态或 Toast 时失败。允许的补充说法不失败。「数据能力预览」不代替「数据能力」。`pre`、`code`、`translate="no"` 和帮助正文不失败 | D3 |
| SC-06 | 时间预设选中、开始时间有值、结束时间为空时失败；没有该控件的页不因此失败 | D3 |
| SC-07 | 侧栏新增一项，或四个代表编辑器缺行时，清单测试失败。本版改过、且不是本次代表行的编辑器没有追加行时失败。代表行已注明同时覆盖该变更时，不要求第二行 | D12 |
| SC-08 | 新增命令的同一次变更里，[`docs/governance/test-layers-and-release-gates.md`](../governance/test-layers-and-release-gates.md) §2 与 §8 都写上该命令，并写明它不是 PR 阻塞项 | D2 |
| SC-09 | `docs/releases/ux/README.md` 规定 §9 的字段；runbook 含 UX-R01–UX-R12，并写明 UX-01–UX-07 是另一份清单 | D7 |
| SC-10 | `manual: true` 且证据文件存在、结果块为 passed 组合时，passed 可以不填 CI `run`。证据缺失、结果块不是 passed 组合、或 `productionReady: true` 却缺少这条 required passed 门禁，都拒绝。`notExecuted` 挂在 `productionReady: true` 上亦拒绝。`required: true` 且 `failed` 仍然被拒绝。v0.20.0 不套用这条存在性检查 | D8 |
| SC-11 | 实现改动不修改 `docs/releases/v0.20.0.json` | D10 |
| SC-12 | `webui/docs/design-system/99-governance.md` 只增加指向本 Spec 的指针，不新增视觉模式。Design System Compliance 仍只出现在单次 PR，不成为这三层之一 | D1 边界 |
| SC-13 | 三个 `reasonClass` 都拒绝被记成 passed。`workspaceDirty: true` 或 `structure` 不是 `green` 时，即使表面行全是 PASS，门禁也不能 passed。`notExecuted` 的原因类必须与证据文件一致 | §4 的三个提前返回 |

SC-01–SC-13 的机器部分由结构套件、清单测试和发版台账测试覆盖。走查与签字不在这些测试里。

## 11. 落盘清单

| # | 要求 | 本文件 |
|---|---|---|
| 1 | 路径与命名 | `docs/specs/lucy-20261030-webui-release-ux-review-spec.md`；Plan 为 `docs/plans/lucy-20261030-webui-release-ux-review-plan.md` |
| 2 | 伪代码 | §4 |
| 3 | 元数据 | 文首表含文档类型 / 版本、状态；Plan 含状态、授权边界、验收 |
| 4 | Plan 五类小节 | 目标、开工前置、验收、完成定义、风险 |
| 5 | Terminology Compliance | 见下节 |
| 6 | Design System Compliance | 见下节 |
| 7 | 索引 | `docs/README.md`、`docs/plans/README.md` |
| 8 | 新命令登记 | 本轮不新增命令。命令与 §2、§8 登记留在 Plan 的实现阶段，同一次变更完成 |
| 9 | 功能编号 | 待 PM 指派。不写入 v0.25 升级建议书 |
| 10 | 机器门禁 | 落盘后运行 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary` |

## 12. 对第 1 轮 Codex 审阅的逐条回应

第 1 轮结论是退回修订：阻塞 0、高 3、中 5、低 0。报告见 [2026-10-30-codex-review-webui-release-ux.md](../reviews/2026-10-30-codex-review-webui-release-ux.md)。

| 编号 | 处置 |
|---|---|
| F01 | §4 把提交、健康检查和脏构建放在走查之前。失败写 `instance-not-ready` 并返回。SC-13 规定表面全绿也不能因此 passed |
| F02 | `notExecuted` 拆成 `instance-not-ready`、`structure-blocked`、`walk-blocked`。前两类写明走查未开始 |
| F03 | D8 与 SC-10 要求 `productionReady: true` 必须消费一条 required passed 门禁，并核对证据结果块 |
| F04 | D9 与 UX-R06 把「没有下一步但页面可认出」定为 P1。空态不在面板内或看不出原因仍是阻断 |
| F05 | UX-R08 改为同一状态维度不得互相否定。正式 Role 与使用中可以并存 |
| F06 | §5 按语境列出禁止值和允许的补充说法。数据能力的主术语改为「数据能力」 |
| F07 | §6 增加表编辑器代表行。UX-R02 覆盖四个代表编辑器和本版改过的编辑器 |
| F08 | Plan 把 SC-07 和 runbook 清单测试移到 S2 |
| F09 | SC-07 与 §6 对齐：代表行注明同时覆盖变更时不要求第二行。只有未被代表行覆盖的变更编辑器才追加一行 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

UX-R01–UX-R12、结构层、走查层、兜底层是发版流程名称，不进入产品界面。页面问题编号继续用 `UX-<PAGE>-NNN`。

## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- `webui/docs/design-system/99-governance.md`

### What This Change Follows
- [x] 页头、空态、指标卡和 Tab 的判断沿用页面布局规范里已有的模式
- [x] 单次改动仍用 PR 的 Design System Compliance，不把该清单并进发版三层
- [x] 本 Spec 不新增颜色、按钮层级或网格

### Exceptions (If Any)
- None

### Follow-up Needed
- 实现阶段在 `webui/docs/design-system/99-governance.md` 加一段指针，指向本 Spec。不在那里定义新的视觉模式
