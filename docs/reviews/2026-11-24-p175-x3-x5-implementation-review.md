# P1-75 X3／X4／X5／X1 最小实现质量审查

| 元数据 | 内容 |
|---|---|
| 文档名称 | P1-75 X3／X4／X5／X1 最小实现质量审查 |
| 文档类型 | Review |
| 版本 | v1.0 |
| 撰写日期 | 2026-11-24 |
| 撰写人 | Claude（Reviewer 子代理） |
| 委托人 | xingchen |
| 基于材料 | 工作区未提交改动（`git diff` 与未跟踪新文件）；[P1-75 Spec v1.4](../specs/lucy-20261123-interactive-read-resilience-spec.md) §2.5／§2.5.1／附录 A；[降级读取提示交互合同](../specs/lucy-20261124-p175-degraded-read-ui-contract-spec.md)；[P1-81 Spec](../specs/lucy-20261124-stuck-state-self-healing-spec.md) §3 |
| 适用范围 | 合并前质量门；不代替终稿确权、开发授权、UAT-READ-RES-09／10 实测；不改代码 |
| 输出位置 | `docs/reviews/2026-11-24-p175-x3-x5-implementation-review.md` |

## 1. 总体结论

**APPROVE WITH GAPS**（无 Critical；Important 共 8 条，其中 I-1、I-2、I-3 建议在宣称 X3／X5 收口或开跑 UAT-READ-RES-09／10 之前处理）。

| 关注点 | 结论 |
|---|---|
| 1. SC-10 安全边界 | 主体成立，未发现越权出数据路径。写出前授权复核、撤权、`pending` 无数据、`write_pending` 仍 503、`reconcile_failed` 越 D_max 转 C 类，均有代码与单测。残留缺口见 I-5、I-6、I-7、I-8（均不属于「撤权后仍读出旧数据」） |
| 2. 主路径可用性 | `pending` 在前端抛 `DisplayPendingError`，`data: null` 不会进入任何消费者，不会渲染成空列表，也不会崩页。但服务端最长等待与客户端读取截止都是 10 秒、没有余量（I-1），可能把 `pending` 变成「读取超时」错误 |
| 3. P1-81 探针 | 探针不再把 `grace`／`stale`／`pending` 当健康，且包装层会把带 `degraded` 的 `ok:true` 归一为失败。但探针是纯内存判定，看不到「核验健康但构建占满／构建失败」造成的持续 `pending`（I-2） |
| 4. X1 判定器 | 已正确取消旧 08-B 503 合格口径。`prolonged` 判据与服务端不一致，会对正确实现误判 FAIL（I-3）；`pending` 带数据的检测在回执缺字段时默认放行（I-4） |

验证方式：逐文件读代码与 diff，并运行既有测试作取证（不是 Tester 角色的功能验收，也不是 UAT）。

- `webui` vitest：6 个文件、139 条通过（`display-http`、`display-snapshot`、`stuck-watchdog`、`entry-performance-timing`、`display-degraded-read`、`display-degraded-pages`）。
- `node --test`：`interactive-read-resilience.test.mjs`＋`check-503-registry.test.mjs` 共 39 条通过。
- `node scripts/uat/check-503-registry.mjs --strict` 退出码 1，列出 14 处「未登记」字面量，集中在审计对账、鉴权引导和 `ROLE_ID_RETIRED` 等。脚本头注已声明这是 grep 级候选，窗口内相邻错误码会产生噪声。因此不判本次实现失败，但说明 X1「附录 A 与代码出口自动对账冻结」**尚未完成**（见 M-4）。

## 2. 变更范围核对

| 项 | 核对结果 |
|---|---|
| Non-Goals／授权边界 | 改动限于 `display-*`、计时头、P1-81 探针对齐、前端读取与降级提示、判定器。未改导航与路由，未改 Tab（符合交互合同 §1），未改 KTX。Spec 头部授权句覆盖 X0–X6 运行代码与 P1-81 失败定义对齐 |
| 状态口径 | Spec 头部状态仍写「NOT RUN／≠ UAT PASS」，没有越权宣称。X0 矩阵「待非作者复核」状态一致 |
| 前端页面覆盖 | 已挂提示：概览（`Onboarding`）、`Catalog`、`AgentList`、`RoleList`、`TableWhitelist`。其余消费同一读取选项的页面未挂（见 I-7） |

## 3. 逐项发现

分级：**Critical**＝必须修复才能合并（安全漏洞、数据错误、越出 Non-Goals）；**Important**＝强烈建议修复（边界未处理、与 Spec 偏离、会造成 UAT 误判）；**Minor**＝可选改进。

### Critical

无。

### Important

**I-1　客户端读取截止与服务端 10 秒等待没有余量，`pending` 可能变成「读取超时」**
`webui/src/lib/displayQueryOptions.ts:44-45`（`remaining = min(10000, …)`）与 `webui/server/display-snapshot.ts:277-282`、`1320`（`buildDeadline = 路由起点 + 10 s`，`waitForRecovery` 等到该时刻才返回）。
- 服务端对无视图的请求最长等待到「路由起点＋10 秒」才答 `pending`。客户端在发出请求时就开始计 10 秒，到点 `abort` 并抛 `DISPLAY_READ_TIMEOUT`。
- 服务端响应总是晚于客户端截止，持续 `pending` 的场景（`build_capacity`、`reconcile_failed`）下，用户会看到「页面数据读取超时，请重试。」，而不是「正在加载…」。`DISPLAY_READ_TIMEOUT` 不在重试集合内，页面进入错误态。
- 判定器同样以 10 秒为 `buildWaitBudgetMs`，客户端测得的 `pending` 耗时略超 10 秒就判 `build_wait_exceeded`。正确实现会被稳定判失败。
- 我没有找到覆盖这条竞争的测试（两个前端降级测试文件里没有 `DISPLAY_READ_TIMEOUT`）。
→ 建议：服务端把请求内等待上限设为小于 10 秒（例如 8.5 秒，并同步 Spec 附录），或客户端读取截止在 `pending` 窗口上放宽到 12 秒；二选一并在判定器里用同一数值。补一条「持续 `pending` 不产生超时错误」的前端测试。

**I-2　P1-81 展示读探针是纯内存判定，看不到持续 `pending`，假活检测对这类故障失明**
`webui/server/display-snapshot.ts:726-735`（`displayReadServable`）、`webui/server/runtime/self-heal.ts:69-78`。
- 探针只看 `SOURCES_SCOPES` 的核验新鲜度。核验健康时返回 `ok: true`，不检查当前代次是否有可服务视图，也不看构建容量或构建失败退避。
- `f5e4b14d` 压力跑次的症状正是「核验健康、展示读持续失败」。A 类 503 改为 200 `pending` 后，外部再也看不到 503，探针也报健康，二者叠加后该故障对看门狗完全不可见。P1-81 §3 要求「探针必须判定响应状态，不得只看状态码」，现实现只覆盖核验过期这一条原因。
- Spec 边界 5 写明非错误型降级越 D_max「作为 P1-81 假活判定的观测输入」。`degradeStreaks`／`prolongedServes` 只出现在 `displayBusySummary()`（`index.ts:1127` 的 health 诊断）里，没有接入 `probeDisplay`。
- 另：探针不覆盖 `AGENT_PERMISSION_SCOPES`（名册、角色权限）。
→ 建议：让 `displayReadServable` 在核验健康时再检查「同代次视图是否存在或是否有持续 `pending` 流」。可用 `degradeStreaks` 最长连续时长或最近一次 `pending` 时间，不引入磁盘读。补一条「核验健康＋构建占满持续 `pending`，探针判失败」的单测。

**I-3　判定器的 `prolonged` 判据与服务端不一致，会误判正确实现为 FAIL**
`scripts/uat/interactive-read-resilience.mjs:349-352`。
- 判定器用 `stale` 的数据年龄（`ageMs`）或 `pending` 的 `pendingMs` 与 D_max 比较，要求 `ageMs > 180000` 就必须带 `Prolonged`。
- 服务端按「该视图连续 `stale`／`pending` 的服务时长」判定（`display-snapshot.ts:773-803` 的 `degradeStreaks`，从首次降级服务起算，不含 `grace` 阶段）。`stale` 的首次响应本身就可能有 `ageMs > 180 s`（宽限 120／180 秒之后才进入 `stale`，核验年龄已超限）。
- 结果：服务端行为符合 Spec「连续服务超过 D_max」，判定器却在首次响应处报 `prolonged_flag_missing`。校准用例也按 `ageMs: 200000` 设计，固化了错误口径。
→ 建议：判定器改按同一视图／作用域的连续降级时长（由回执序列推算）判定 D_max，不用数据年龄。或在服务端头里补「连续降级时长」。同时明确 Spec 对 D_max 的计时对象，写入变更行。

**I-4　`pending` 带数据的检测在回执缺字段时默认放行**
`scripts/uat/interactive-read-resilience.mjs:342-344`。
- `hasData === undefined` 时按 `observed.sqlValue != null` 推断。展示读回执通常没有 `sqlValue`，于是「`pending` 响应里带了 `agents: []` 或 `rows: []` 冒充空列表」会被判通过。这正是 SC-10／10-C 要拦的失败模式。
- 同文件其他判定器遇到缺证据都判 `blocked`。这里相反。
→ 建议：展示类步骤的 `pending` 回执缺 `hasData` 时判 `missing_evidence`（BLOCKED）；recorder 在 `finish` 时从响应体算出 `hasData`。

**I-5　启用表范围页：横幅里的「移出无效启用」按钮未随降级态禁用**
`webui/src/pages/connections/TableWhitelist.tsx:1118-1124`。
- 本次只给工具栏按钮（`:995`）加了 `disabled={tablesListNotReady}`，`tablesListNotReady` 已含 `sourcesUnsettled`。`hiddenInvalidEnabledCount` 横幅里的同名按钮 `whitelist-remove-invalid-enabled-from-banner` 没有禁用条件。
- Spec §2.5.1 边界 3、交互合同 §3 补充约束 3 与 UAT 10-G 要求 `stale`／`pending` 下「危险动作不可达」。该按钮仍可触发 `removeInvalidEnabled`，修改草稿（保存仍需用户确认并走服务端核验，不是直接写入）。
- 测试 `display-degraded-pages.test.tsx` 只断言了工具栏按钮。
→ 建议：横幅按钮加同样的 `disabled` 和提示文案，并补测试。

**I-6　连续 `reconcile_failed` 与降级时长的清零只在请求时发生，会误转 C 类 503 或误标 `prolonged`**
`webui/server/display-snapshot.ts:831-833`、`1208`；`793`。
- `reconcileFailedSince` 只在下一次 `getDisplaySnapshot` 入口由 `clearRecoveredReconcileFailures()` 清理，核验成功（`markScope*Ok`）本身不清零。系统空闲时，一次短暂故障后若无读取，计时器一直保留。
- 之后又出现一次新的瞬时核验错误，而这次读取正好落在错误窗内：计时器仍停在旧起点，立刻超过 180 秒，直接返回 C 类 503。这违反「只在真实核验故障下出现」和「压力窗 C 类为 0」。
- `degradeStreaks` 同理，只在 `noteFresh` 清理。长时间无读取后再降级，首个 `stale` 就可能带 `prolonged` 与很大的 `pendingMs`。
→ 建议：在 `markScopeMetadataOk`／`markScopeDigestOk` 且该作用域已无错误时清零 `reconcileFailedSince`。`degradeStreaks` 给每个起点记录最近观察时间，超过间隔（如 D_max）未续上就重置。补「故障恢复后空闲、再次瞬时故障不触发 503」的测试。

**I-7　降级提示只覆盖 5 个页面，其余消费同一读取的页面静默展示 `stale`／`grace`**
`webui/src/pages/**`（对照 `rg -l DisplayDegradedNotice` 与 `rg -l sourcesQueryOptions|adminRolesQueryOptions|adminAgents*QueryOptions`）。
- 未挂提示但消费降级读取的页面：`ConnectionOverview`、`ConnectionTest`、`WikiEditor`、`Audit`、`McpPlayground`、`NewToken`、`PublishWorkbench`、`SlRefPicker`、onboarding `Step2／3／6`、`SchemaStructurePrep`。
- 这些页面读到 `stale` 时没有「数据可能不是最新」提示，持续 `pending` 时也没有「长时间未更新」升级。Spec §2.5 承诺全页面行为，且交互合同 §5 把提示出现次数作为 09 的逐格检查项。`NewToken`、`PublishWorkbench` 用 Agent 身份摘要选择写入对象，静默旧数据与「旧数据不得冒充当前」的目标有张力。
- 本次是「最小实现」，范围收窄可接受，但须在 X0 矩阵与 Spec 变更行显式登记「未覆盖页」，避免被当成已完成 X5。
→ 建议：登记未覆盖页清单，或至少给读 Agent／Source 选择器的写入入口页补提示。

**I-8　写出前授权复核失败后，请求仍可能经「恢复后 fresh」返回数据；复核本身没有时限**
`webui/server/display-snapshot.ts:909-910`、`1318-1327`；`webui/server/display-http.ts:38-41`。
- `authorize()` 返回 `false` 时只记录 `authorization_changed` 并放弃降级，随后继续 `waitForRecovery`。恢复成功后走 fresh 路径，该路径不再调用 `authorize`。已被撤权的这条在途请求最终可能收到 200＋数据。Spec 条件 4 写的是「改走 fresh 核验并按原合同处理」，字面可成立。但授权已被明确判为失效时，继续出数据没有必要。
- `authorize` 调用 `authenticateSession`，每次会读 `admins.yaml`（`fresh: true`）并可能触发 `touchSession` 写。它位于降级路径，即最可能在慢 I/O 下运行的地方，却没有超时包装，可能把本应快速返回的 `stale` 拖长。
- 另：授权失败最终表现为 `200 pending` 而不是 401，被撤权用户的页面会无限转圈，直到下一个请求被 `onRequest` 钩子拒绝。
→ 建议：`authorize` 为 `false` 时直接 401／`pending`，不再进入恢复等待。对 `authorize` 加短超时（如 500 毫秒），超时按「拒绝降级」处理。

### Minor

**M-1　全局错误处理器对任意方法把 A 类 `DisplaySnapshotBusyError` 转成 `200 { ok:true, data:null }`**
`webui/server/display-http.ts:75-79`、`webui/server/index.ts:1055`。当前只有三个 `GET` 读取抛该错误（`index.ts`、`agents.ts`、`roles.ts`），没有现行风险。但若以后某个写入路由在内部读取同一快照并抛出该错误，写入请求会得到 `ok:true`，形成假成功。→ 限定 `GET`／`HEAD`。

**M-2　路由级 A 类忙转 `pending` 时没有 D_max 升级，也不进入 `reconcileFailedSince`**
`webui/server/admin/agents.ts:1156`（投影校验两次失败后抛 `reconcile_failed`）与 `display-http.ts:75-79`、`display-snapshot.ts:1575-1577`。快照内容损坏这类真实故障会被无限期包成 `200 pending`，不会转 C 类，也没有作用域计时。HTTP 层创建的 `pending` 用路由路径作视图名，与快照层用快照名，`degradeStreaks` 分成两套。→ 路径内 `reconcile_failed` 也登记到作用域计时；统一视图键。

**M-3　`generation_changed` 路由耗尽期间若有写入在途，返回 `pending` 而不是 `write_pending` 503**
`webui/server/admin/agents.ts:1609`、`1625`，`roles.ts:1113`。路由循环用尽预算时，不区分是否有写入在途。附录 A 把 `write_pending` 定为 B 类 503。当前行为对用户更友好，且不泄露数据。UAT 10 需要明确按哪种口径判，建议在附录 A 补一行「路由耗尽＋写入在途」的归类。

**M-4　503 对账尚未冻结**
`scripts/uat/check-503-registry.mjs`：`--strict` 退出 1（14 处候选，需人工甄别）。X1 要求「对账出口与附录，缺登记即失败」。在甄别完成并让 `--strict` 通过或建立白名单之前，不得宣称 X1 对账完成。

**M-5　降级状态按页面路径存储，同一路径下不同查询互相覆盖**
`webui/src/lib/displayState.ts:62-64`、`webui/src/lib/apiClient.ts`（`setDisplayInfo(path, display)`）。`/api/admin/agents` 的名册摘要、名册、列表共用一个键，后到的 `fresh` 响应会清掉另一个查询仍处于 `stale` 的提示，同时停止其轮询（`displayPollInterval` 也按该键）。三者读同一个权限快照，实际差异小。→ 键加上 `view`／`projection` 查询参数，或按查询键维护。

**M-6　`stale` 视图的年龄没有上限，只靠 `prolonged` 标记提示**
`webui/server/display-snapshot.ts:887-920`。符合 Spec（非错误型降级越 D_max 仍为 200），属已接受的设计取舍。授权复核只覆盖请求方自己的管理员记录与会话，不覆盖「核验不可用期间 `access.yaml` 被外部改动」。该窗口在 Spec 里已被接受。UAT 10 应显式覆盖：降级期间的外部配置变更在恢复核验后 10 秒内生效。

**M-7　身份门槛让「从未读过新鲜视图的合法用户」得到 `pending` 而不是已有的 `stale` 视图**
`webui/server/display-snapshot.ts:908`（`slot.principals.has(...)`）。符合 Spec 条件 2，更安全。例如新登录的治理员在核验受阻期间只会看到加载中，而不是旧数据。属于「约束生效」换「合法用户体验」，需在 UAT 10 报告里列为已知差异，不作为缺陷。

**M-8　`data-display-state` 等 DOM 属性带内部状态词**
`webui/src/components/DisplayDegradedNotice.tsx:80`。交互合同禁止状态词出现在界面文案中，属性不是可见文案，组件注释也已声明仅供测试与 UAT 计数。若术语禁词测试扫描整个 HTML，需放行该属性。

## 4. 对照 SC-10 的逐点结论

| SC-10 要点 | 结论 | 依据 |
|---|---|---|
| 写出前再次核验当前授权与权限版本 | 成立 | `serveDegradedSlot` 在身份、代次、写入、核验错误检查之后调用 `authorize()`，再同步复核 slot 与资格（`display-snapshot.ts:908-911`）。单测 `:1100`、`:1117`。残留见 I-8 |
| 在途撤权与读取交叠时放弃降级 | 成立 | `authorize` 重新读取会话与管理员记录，比较账户、角色、启用状态 |
| 无已核验视图返回 `pending`，不用空列表冒充 | 服务端与前端成立 | 服务端 `data:null`＋`display` 信封；前端抛 `DisplayPendingError`，`null` 不进入消费者。判定器侧见 I-4 |
| 跨身份与权限版本不串视图 | 成立 | 视图记录已鲜读过的身份键（账户＋角色＋启用＋会话代次），登出清空前端存储（`bumpAuthEpoch`）。见 M-7 |
| `write_pending` 仍 503 | 成立 | `isDisplayClassAReason` 排除，`replyIfDegradedRead` 不转换；降级路径遇写入在途一律拒绝。路由耗尽的边角见 M-3 |
| 持续 `reconcile_failed` 越 D_max 转 C 类 503 | 成立，有误触风险 | `DisplayReconciliationFailedError` 带稳定码，不带旧内容，错误处理器按 503 输出。清零时机见 I-6 |
| 保存、dryRun、权限预览不使用降级视图 | 成立 | 只有三个展示快照走降级，写入路径不调用；仅有 `publishNoteOnlyRosterView`（尽力发布，忽略返回值）。见 M-1 |
| C 类真实故障仍 fail-closed | 未涉及 | 本次未改安全存储与审计账本出口；UAT 10 注入测试尚未做 |

## 5. 对照主路径可用性

- **合法用户仍可用**：`fresh` 路径不变；降级只在核验失败或变慢时启用；写入、dryRun、预览、撤权后的读取仍走 fresh。纯 MCP 路径未改动，不受影响。
- **`pending` 不崩页**：`displayRead` 与重试策略保证 `pending` 保持加载态、2–5 秒自轮询、`DisplayPendingError` 不被当错误展示；`pending` 的 `journey` 预算重置，避免被 15 秒总预算误杀。唯一缺口是 I-1（最长等待与 10 秒读取截止竞争）。
- **提示行为**：`DisplayDegradedNotice` 文案与交互合同一致：四个主术语、仅「约 N 分钟前更新」一种年龄写法、不足 1 分钟省略、`role="status"`、`pending` 不显示数据区。

## 6. 建议处理顺序

| 序 | 项 | 目的 |
|---|---|---|
| 1 | I-1 | 保证 `pending` 在主路径上表现为「正在加载」而非错误 |
| 2 | I-2 | 让 A 类零 503 之后假活检测不失明（P1-81 联动） |
| 3 | I-3、I-4 | 判定器先对准服务端口径再开跑 09／10，避免对正确实现误判或对错误实现放行 |
| 4 | I-5、I-6 | 补齐危险动作不可达与 C 类误触风险 |
| 5 | I-7、M-4 | 在 Spec 变更行与 X0 矩阵登记未覆盖页与对账状态 |
| 6 | I-8 与 M 类 | 随 X6 前的安全收尾处理 |

不 `git commit`。本报告只登记审查意见，不构成终稿确权、开发授权或 UAT 结论。

## 7. 处置（2026-11-24，I-1／I-3／I-4）

本批只处理 I-1、I-3、I-4；I-2、I-5–I-8 与 M 类未动。未 `git commit`。

| 项 | 状态 | 改动 | 验证 |
|---|---|---|---|
| I-1 | 客户端侧已修；判定器侧未动 | `webui/src/lib/displayQueryOptions.ts`：新增 `DISPLAY_READ_REQUEST_TIMEOUT_MS = 13_000`（大于服务端 `DISPLAY_BUILD_WAIT_BUDGET_MS` 10 s），`displayRead` 与 `boundedRosterRead` 的单次读取截止由 10 s 改为该值；15 s 总预算与「`pending` 重置 journey」不变。文案仍为「正在加载…」。 | 新增 `display-degraded-read.test.tsx`「I-1」：服务端 10.5 s 才答 `pending`，结果为 `DisplayPendingError`，不是 `DISPLAY_READ_TIMEOUT`；截止改回 10 s 时该测试失败（已验证） |
| I-3 | 已修 | `interactive-read-resilience.mjs`：新增 `judgeProlonged`。D_max 按同一步骤回执序列里「连续 `stale`／`pending` 的服务时长」推算（`fresh` 清零，`grace` 不计），与服务端 `degradeStreaks` 同口径；只在超过 D_max＋`prolongedToleranceMs`（默认 2 s）仍无 `X-Lucy-Display-Prolonged` 时判失败；不再用 `ageMs`／`pendingMs`。校准用例改为连续序列用例。 | 新增测试：首条 `stale` 数据年龄 200 s 不要求 Prolonged；连续 > D_max 缺标记 FAIL、带标记 PASS；容差内、`fresh` 重置、header 派生回执均按预期 |
| I-4 | 已修 | 同文件 `judgeDisplay`：`pending` 回执 `hasData` 缺失且无 `observed.sqlValue` 时判 `missing_evidence`（BLOCKED），不再放行；`hasData: true` 或有 `sqlValue` 仍 FAIL。新增校准用例「pending 缺 hasData」。 | 新增测试断言 BLOCKED 且字段为 `hasData` |

**验证结果**：`node --test scripts/uat/interactive-read-resilience.test.mjs` 36／36 通过；`calibrate` 通过；`display-degraded-read`、`display-degraded-pages`、`display-query-isolation`、`agent-roster-query` 共 43 条通过；`tsc --noEmit` 无错误。

**仍未完全解决（登记，不在本批）**：
1. 判定器 `build_wait_exceeded` 仍以客户端测得耗时与 10 000 ms 精确比较，未给网络余量；服务端恰在 10 s 预算末答 `pending` 时，UAT 仍可能误判。需另定容差或下调服务端预算后同步 Spec。
2. 客户端「写入等待」与读取共用同一 15 s journey：先等写入落定再读时，剩余截止可能小于服务端 10 s 等待，边界场景仍可能超时。
3. I-3 的计时对象（连续降级服务时长，从首次降级响应起算，`grace` 不计）尚未写入 Spec 变更行。
4. 回执 `hasData` 需由 live 驱动／recorder 从响应体计算；本批只让判定器缺证时保守失败。
