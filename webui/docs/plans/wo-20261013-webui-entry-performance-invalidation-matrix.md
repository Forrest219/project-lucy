# Spec 174 缓存失效与权限一致性接线矩阵

| 字段 | 内容 |
|---|---|
| 日期 / 版本 | 2026-10-13 / v1.2（实现接线回填） |
| 状态 | Implemented · 2026-10-14 Codex收尾复验完成：R3/R4/R6追加缺口已关闭；原四态证据及未覆盖项保留，见[执行报告§10](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md) |
| 权威合同 | [Spec174 v1.2](../174-webui-entry-performance-spec.md) §3–4/7/9 |
| 执行工单 | [WO-20261013-174 v1.2](wo-20261013-webui-entry-performance.md) T1/T3/T5 |

本表最初是接线清单；v1.2 起按实现回填「实际接线」一节（hook 函数、客户端 key、测试用例）。原「实际入口与测试要求」表保留为审阅基线。

2026-10-13 复审：IM-13 的 bypass 在未验证状态绕过屏障与并发上限；IM-14 的 epoch/401 仅覆盖 GET；运行时生效状态缓存与 UI 提示、写开始的动作门禁缺失。IM-03/06/08 等实际分支证据不足。需完成修正工单并逐行区分 hook 存在、行为已验证、未覆盖或失败后方可宣称完整通过。

本表从stash7653746提取并按当前代码复核，仍为18行；既有表结构准备/角色多选/审计变更纳入对应行，不另设第二套写入链路。

## 符号与约束

- D：当前语义/Manifest摘要；P：权限展示/Agent引用；C：连接/project/启用范围；L：live-schemas/健康任务配置代次；A：动态Agent/Token统计响应；U：当前WebUI登录账户边界。
- 服务端每次**真实修改前**begin屏障，落盘后通知，finally失效；失败可能部分写入同样通知。access外层屏障保持到policy commit/ack及rollback终结，内部safeWrite通知不能提前解屏障。
- 客户端先递增affected query epoch、取消旧请求，最终无论成功/失败都核对/失效。逻辑key见 `webui/src/lib/queryKeys.ts`；`['admin','agents']`目前硬编码，需清点。auth scope包装后所有invalidate使用同一builder，不能只改useQuery。
- 不因“目录”关键字对history备份、sidecar、临时上传、secret进行全盘失效；不读取secret内容进行指纹。

## 实际入口与测试要求

| 行 | 当前实际写入/读取入口 | 依赖 / 客户端逻辑key | 必须测试的边界（计划用例） |
|---|---|---|---|
| IM-01 | `webui/server/fs-safe.ts::safeWrite/safeRemove`（当前writeFile直接写）；`admin/config-audit-write.ts::auditedWriteFile/auditedRemoveFile` | 按resolved目标分类D/P/C，不统一误标所有文件 | 有审计/无审计、truncate中读取、部分失败、ENOENT、落盘后audit status失败；DI-01 |
| IM-02 | `webui/server/semantic-layer.ts::writeSourcePatch` | D；sources/source/sourceVersions/joinCandidates | Manifest/overlay多文件写第二项失败；注释/unknown/mtime不变；DI-02 |
| IM-03 | `semantic-layer.ts::writeSourceYamlImport`；`index.ts` source import/restore真实提交路由 | D，若改Manifest映射则P；同IM-02 | preview/dryRun无变化，import/restore提交即时更新；DI-03 |
| IM-04 | `webui/server/catalog-assets.ts::uploadCatalogAsset`的rename（绕过safeWrite）；Spec164 prepareSchemaStructure::writeMinimalManifest复用此API | D/P/C；catalogReloads/catalogAssetUploads/sources/project/connectionTables；SchemaStructurePrep的refetch/getQueryData同新scope | rename成功但reload/history失败、preview不失效、tmp不触发成功快照；上传后真实读到表才进入启用范围；DI-04 |
| IM-05 | `webui/server/project.ts::writeKtxYaml`；`index.ts` enabled-tables的auditedWriteFile | C/D/P/L；project/sources/connectionTables/liveSchemas/health/admin agents/mcpRuntime | enabled_tables改变catalog_bound结果；content_root变化换paths与watcher；DI-05 |
| IM-06 | `project.ts::createConnection/addSchema/removeSchema/removeConnection`（当前rollbackWrittenConnection含后续audit异常） | C/D/P/L；同IM-05及reloads | 屏障跨完整事务及ktx/secret清理；SQLite无password分支；删资产部分失败；旧配置probe拒回填；DI-06 |
| IM-07 | `webui/server/admin/agents.ts`本地`writeAccessYaml`（含writeFile回滚），Spec168 applyRoleSet/agentRoleFields | P/A；sources/admin agents/admin roles及已有mcpRuntime展示 | roles[]多选/legacy兼容/双声明错误/非角色编辑不迁移；runtimeAck=false回滚；users/version/权限一致；DI-07 |
| IM-08 | `webui/server/admin/access-config.ts::writeAccessYaml`；`admin/roles.ts`调用 | P/A；同IM-07 | 角色新增/编辑/删除、多角色、约束/row policy，直接回滚后再失效；DI-08 |
| IM-09 | `webui/server/admin/tokens.ts` auditedWriteFile + commitPolicyRuntimeAck | P代次（access文件变化）/A；admin tokens/admin agents、已有runtime查询 | 创建/吊销过期信息不得被冻结；实际旧Token授权按原即时吊销合同拒绝；DI-09 |
| IM-10 | `webui/server/catalog-reload.ts::reloadCatalog/appendCatalogReload` | D/P/C（资产重扫）；catalogReloads/sources/project | sidecar追加只更新历史key，不把自身写事件反复触发语义重扫；重载失败显式错误；DI-10 |
| IM-11 | `webui/server/table-yaml-history.ts` snapshots/index/restore draft读取 | 历史key；**只读restore draft本身不失效D/P** | snapshot文件与history index不被当当前overlay；真实restore提交由IM-03覆盖；DI-11 |
| IM-12 | `webui/server/paths.ts::loadContentPaths/invalidateContentPathsCache`（已有projectRoot/env cachedKey）；外部ktx路径变化 | 全部旧root D/P/C/L；相关logic key | 不覆盖已实现cachedKey；默认config/、env、paths.content_root、legacy `.`切换，旧root不挂新key；DI-12 |
| IM-13 | `webui/server/proxy/identity.ts::resolveAccessConfigPath`；外部access/Manifest/overlay/ktx变化 | 按实际path D/P/C/L | watcher丢事件、原子替换/删除、同mtime/size、override不一致；2s/31s仅服务端窗口；DI-13 |
| IM-14 | `webui/src/lib/auth.tsx` login/logout/refresh身份改变；401 | U；全部protected query，保留public Help/branding | 同账户重登也更新authEpoch；旧fetch忽略abort，仍不回填；其他标签下一请求401不继续显示可操作旧数据；DI-14 |
| IM-15 | `webui/server/admin/agents.ts::registerAgentRoutes`读取列表 +批量context | 同批access/version/enabledTables，动态A | stats pending期间Agent被删除/启停，整批重试不拼A/B；DI-15 |
| IM-16 | `proxy/acl.ts::compileRole/loadEnabledTablesByConnection/resolveCatalogConnections`与display batch纯派生 | P读取固定enabledTables（含空集合连接）/classifier/source版本 | lucy_admin新连接自动跟随、其他wildcard拒绝；Spec170 CONTEXT_TOOLS不回退；每批≤1读取，runtime不污染；DI-16 |
| IM-17 | `webui/server/live-catalog.ts` + `index.ts` test/live-schemas +后台队列 | L；connectionLiveSchemas/connectionHealth | 同key合并独立subscriber取消；配置更新旧任务结算；refresh=1只绕过完成cache；DI-17 |
| IM-18 | `webui/server/auth/guard.ts`及各路由既有权限检查（读取） | HTTP请求身份，不在显示cache内 | cache hit/miss/inFlight attach三条路径都验证已有auth；未授权不能因复用已授权Promise拿到数据；DI-18 |

DI-01–13/15主要落 `server/__tests__/display-invalidation.test.ts`；DI-16落 `admin-permission-batch.test.ts`；DI-17落 `background-probes.test.ts/live-catalog.test.ts`；DI-14落 `src/__tests__/display-query-isolation.test.tsx`；DI-18补 `webui-admin-auth.test.ts`。若某行需独立测试文件，报告列出最终位置。

## 实际接线（v1.2 回填）

服务端代次与屏障：`webui/server/display-generation.ts`（`beginDisplayWrite` / `endDisplayWrite` / `withDisplayWriteBarrier` / `scopesForPath`）；快照：`webui/server/display-snapshot.ts`（`getDisplaySnapshot`、reconciler）。客户端：`webui/src/lib/apiClient.ts`（authEpoch、按读模型分域的 display write epoch、`setDisplayWriteSettledHandler`）、`webui/src/lib/displayQueryOptions.ts`、`webui/src/lib/auth.tsx`。

| 行 | 实际 hook | 客户端 key / 失效 | 测试（文件 › 用例） | 结果 |
|---|---|---|---|---|
| IM-01 | `fs-safe.ts` `safeWrite` / `safeWriteBinary` / `safeRemove` / `safeRemoveDirectory` / `safeRenameDirectory` 在真实落盘处包 `withDisplayWriteBarrier(displayScopesFor(...))`；`safeWriteNewSecretPassword` / `safeRemoveSecretPasswordIfExists` 包 `["C","L"]`；`auditedWriteFile` / `auditedRemoveFile` 继承（屏障在 audit 状态更新之前结束 → 失效早于审计终结） | 由写入路径决定（见 IM-02…09） | `display-invalidation.test.ts` › DI-01 barriers open before the write…；DI-01/02 partial failure…；`display-snapshot.test.ts` › classifies write targets | 通过 |
| IM-02 | `semantic-layer.ts::writeSourcePatch` 外层 `["D","P"]` 屏障包住多文件写 | `sources`（PUT `/api/sources/*` 写后 settle → invalidate） | `display-invalidation.test.ts` › DI-03 dryRun never invalidates; a confirmed save…；DI-01/02 partial failure | 通过 |
| IM-03 | `semantic-layer.ts::writeSourceYamlImport` 外层 `["D","P"]`；preview / dryRun 不进屏障 | 同 IM-02 | DI-03（dryRun 路径）；import 写与 IM-02 同一包装，未单列用例 | 通过（import 无独立用例） |
| IM-04 | `catalog-assets.ts::uploadCatalogAsset` 的 `rename` 包 `["D","P","C"]`；`.upload.tmp` 被分类器与 reconciler 忽略 | `/api/catalog/assets/upload` settle → `project`/`sources` invalidate；`SchemaStructurePrep` 用同一 `sourcesQueryOptions` key 做 refetch/getQueryData | `display-snapshot.test.ts` › detects edits…ignores history / tmp sidecars；`add-schema-drawer.test.tsx`、`setup-assistant.test.tsx` 回归 | 通过 |
| IM-05 | `project.ts::writeKtxYaml`（非 dryRun）`["C","D","P","L"]`；`index.ts` enabled-tables PUT 外层屏障覆盖写→reload→policy commit | `/api/connections/*` settle → `project`/`sources`/`adminAgents` | `display-invalidation.test.ts` › DI-05/16 enabled_tables writes refresh sources… | 通过 |
| IM-06 | `createConnection`（write lock 内包住 ktx/secret 写、audit、`rollbackWrittenConnection`）、`addSchema` / `removeSchema` / `removeConnection` 非 dryRun 包屏障 | 同 IM-05 | `display-invalidation.test.ts` › DI-06 confirmed connection removal…；`project.create-connection.test.ts` 回归 | 通过（create 失败回滚无独立屏障用例） |
| IM-07 | `admin/agents.ts::writeAccessYaml` → `withDisplayWriteBarrier(["P"], writeAccessYamlInBarrier)`，覆盖写→commit→直接 `writeFile` 回滚；Spec 168 `agentRoleFields` 未改 | `/api/admin/agents*` settle → `adminAgents`/`sources` | `display-invalidation.test.ts` › DI-07/15 Agent writes hold P pending through commit…；`admin-agents.test.ts` 回归 | 通过 |
| IM-08 | `admin/access-config.ts::writeAccessYaml` 同样包装（`roles.ts` 调用） | `/api/admin/roles*` settle → `adminAgents`/`sources` | `admin-roles.test.ts` 回归；包装与 IM-07 相同 | 通过（rollback=runtimeAck false 无独立用例） |
| IM-09 | `admin/tokens.ts` 创建 / 吊销：`["P"]` 屏障包住 `auditedWriteFile` + `commitPolicyRuntimeAck` | `adminAgents` | `display-invalidation.test.ts` › DI-09 token revoke invalidates P；`admin-tokens.test.ts` 回归 | 通过 |
| IM-10 | `catalog-reload.ts::reloadCatalog` finally `bumpDisplayGeneration(["D","P"])`；`.ktx-ui` sidecar 不在 watcher 范围 | `/api/catalog/reload` settle → `project`/`sources` | `display-invalidation.test.ts` › DI-10 catalog reload invalidates D… | 通过 |
| IM-11 | 历史快照位于语义层外 / 隐藏目录，被忽略；restore draft 只读不触发代次 | 历史 key 不变 | DI-10/11（versions 读取不改代次） | 通过 |
| IM-12 | reconciler 发现 `ktx.yaml` 变化 → `invalidateContentPathsCache()`、重新解析、迁移 watcher、清空快照；快照 key 含 contentRoot | — | `display-snapshot.test.ts` › migrates to a new content root… | 通过 |
| IM-13 | `fs.watch`（semantic-layer 递归、ktx.yaml、access 路径含 `LUCY_ACCESS_CONFIG_PATH`）+ 1 s 元数据对账 + 30 s 全内容摘要；摘要逾 31 s / 元数据逾 3 s → 不信任缓存（bypass 重建） | 下一次请求 | `display-snapshot.test.ts` › detects edits, deletes and atomic replaces；finds same-size, same-mtime rewrites；DI-13；浏览器 SC-05 外部编辑 | 通过 |
| IM-14 | `auth.tsx` 登录开始 / 退出 / 身份变化 / 401 → `bumpAuthEpoch()` + 取消并移除受保护查询（保留 help / branding） | 全部受保护 key | `display-query-isolation.test.tsx` › rejects a response from a previous auth epoch…；drops protected queries… | 通过 |
| IM-15 | Agent 列表：users / version / 权限来自同一 access 快照（权限段按版本缓存）；统计查询后核对 `P` 代次，变化则整批重建（≤3 次，否则 503 busy） | `adminAgents`（staleTime 0） | DI-07/15；DI-15 a list request during a pending access write… | 通过 |
| IM-16 | `acl.ts` `buildAdminPermissionContext` / `resolveEffectivePermissionsBatchForAdmin`：一次 source map + enabled_tables（含零启用连接）显式传入 `compileRole` | — | `admin-permission-batch.test.ts` 全部 7 例 | 通过 |
| IM-17 | `background-probes.ts`（L 代次 key）+ `live-catalog.ts` 代次守卫；L 变化 → 取消未启动旧任务、清空 live cache | `connectionLiveSchemas` / `connectionHealth` | `background-probes.test.ts`、`live-catalog.test.ts` › config generation guard | 通过 |
| IM-18 | `requireWebuiAuthHook`（onRequest）先于处理器，快照命中 / miss / inFlight 均不绕过 | — | `display-invalidation.test.ts` › DI-18 a warm cache never answers an unauthenticated request | 通过 |

### 残余缺口（如实记录）

- IM-03 import、IM-06 createConnection 失败回滚、IM-08 access-config 的 runtimeAck=false 回滚没有独立的屏障用例；它们与已测路径共用同一包装函数。
- 「truncate 与完整写之间发请求」用写屏障 + 挂起写入模拟（`display-snapshot.test.ts` › never publishes a build that overlapped a write），未在真实 `writeFile` 中途注入。
- 按登录账户裁剪的缓存不存在（快照内容不随管理员身份变化），因此未启用「≤32 principal 槽位」；账户边界由客户端 authEpoch + 受保护查询清除保证。

## 审阅修正复验（R1–R7，2026-10-13）

上表「结果」列是 v1.2 首次回填的历史结论，保留不改。本节按[审阅修正工单](wo-20261013-webui-entry-performance-REVIEW-FIX.md) R7.4 逐行区分四种状态：**hook 存在**（代码中有屏障 / 守卫）、**行为通过**（有针对该分支的测试真实注入并断言结果）、**未覆盖**（没有专门分支证据，不能由共用包装推定通过）、**失败**。测试文件均位于 `webui/server/__tests__/` 或 `webui/src/__tests__/`。

| 行 | hook 存在 | 行为通过（测试 › 用例） | 未覆盖 | 失败 |
|---|---|---|---|---|
| IM-01 | 是 | `display-invalidation` › DI-01、DI-01/02 partial failure；`display-rollback-races` › audit failure after a successful semantic save still invalidates | 真实 `writeFile` 截断中途注入（以写后挂起模拟） | 无 |
| IM-02 | 是 | `display-invalidation` › DI-03 confirmed save、DI-01/02 | — | 无 |
| IM-03 | 是 | `display-rollback-races` › import confirm: reads wait during the write; a failure after the write still serves the written Manifest | restore 提交（`restoredFromVersionId`）与 import 共用路由，无单独注入 | 无 |
| IM-04 | 是 | `display-snapshot` › detects edits…ignores tmp sidecars；`add-schema-drawer` / `setup-assistant` 回归 | rename 成功后 reload / history 失败未注入 | 无 |
| IM-05 | 是 | `display-invalidation` › DI-05/16；`display-rollback-races` › enabled-tables: a policy commit failure keeps reads waiting through write → reload → commit | 该路由按既有设计不回滚 ktx.yaml（返回 `runtimeAck=false`），无回滚分支可测 | 无 |
| IM-06 | 是 | `display-rollback-races` › createConnection: an audit failure after ktx.yaml + secret writes rolls back；`display-invalidation` › DI-06 | addSchema / removeSchema 部分失败、SQLite 无密码分支 | 无 |
| IM-07 | 是 | `display-invalidation` › DI-07/15；`display-rollback-races` › Agent writeAccessYaml: runtimeAck=false rollback（写入 / commit / 回滚三个阶段发请求） | — | 无 |
| IM-08 | 是 | `display-rollback-races` › access-config writeAccessYaml (roles PATCH): runtimeAck=false rollback（三阶段） | — | 无 |
| IM-09 | 是 | `display-invalidation` › DI-09 | — | 无 |
| IM-10 | 是 | `display-invalidation` › DI-10 | reload 自身失败的显式错误未单列 | 无 |
| IM-11 | 是 | `display-invalidation` › DI-10/11 | — | 无 |
| IM-12 | 是 | `display-snapshot` › migrates to a new content root；R1 › a reconciler watching another project root does not verify this root's snapshots | — | 无 |
| IM-13 | 是（R1 改为 unverified → `503 DISPLAY_SNAPSHOT_BUSY`，无 bypass） | `display-snapshot` › R1 全组（unverified × pending / 并发、构建中 / 等待中失去对账、回滚中请求、重启不复用旧快照）、same-size same-mtime full digest、atomic replace；`display-invalidation` › R1 sources / agents busy envelope 与恢复后最终数据、busy 仍先过 RequireAuth；`admin-permission-batch` › refuses to splice two different access files | 2 s / 31 s 检测窗口未做端到端计时 | 无 |
| IM-14 | 是（R2 五种方法共用 epoch / 401 返回路径；R4 区分 auth / write stale） | `api-client-abort` › R2 五方法 × {A→B 忽略 abort、旧错误 envelope、延迟 json、当前 401、旧 401、403}、登录失败、Skill 直连读取；`new-token` › R2 旧账户 Token 结果无 Toast；`display-query-isolation` › R4 auth stale is not retried | Wiki raw 下载、Eval YAML 下载两处直接 `fetch`（用户触发的文件下载，未接入 epoch） | 无 |
| IM-15 | 是 | `display-invalidation` › DI-07/15、DI-15 | — | 无 |
| IM-16 | 是 | `admin-permission-batch` 全部；`display-permission-runtime` › display reads never commit policy or change runtime readiness | — | 无 |
| IM-17 | 是（R5 探测在卡片 commit + 双 rAF 后才发） | `background-probes`、`live-catalog`；`catalog-loading` › R5 automatic test / live-schemas requests start only after the cards committed and painted；behavior › R5 三组慢 / 失败装饰 | — | 无 |
| IM-18 | 是 | `display-invalidation` › DI-18、R1 busy while unverified still runs RequireAuth first | — | 无 |

不属于单行失效、但本次修正一并取证的两项：

- **生效状态（SC-17，R3）**：`runtimeConsistency` 不再随显示快照缓存，快照只存编译输入摘要，每次响应按当前只读 runtime 状态计算；sources / Agent 的 `meta.snapshotVersion` 随状态变化。证据：`display-permission-runtime` 5 例（热命中 unconfirmed↔matched、global degrade 与恢复、请求进行中变化、显示读不提交 policy）；`catalog-loading` / `agent-list` › 权限生效状态待确认。
- **写开始门禁（SC-15/18，R4）**：客户端按读模型计 pending 写，嵌套 / 并行写只在最后一个结束时失效；写中不发起展示读取，重叠写的响应为 write stale，结算后才有限重读；依赖 Manifest 事实的动作在重新读到数据前不可用。证据：`display-query-isolation` › R4 五例；`catalog-loading` › R4 success / rollback。

## 2026-10-14追加收尾证据

- SC-17 / R3：Agent最终consistency移至统计await之后；display-permission-runtime新增matched↔unconfirmed两个统计期间竞态测试，版本随最终状态变化，缓存构建次数不变。
- SC-15/18 / R4：Catalog主链接、维护/启用、更多菜单与空态入口接入facts pending；catalog-loading新增5例，覆盖实际点击、写失败、重读失败和并行写。isFetching/isError门禁保证数据安装完成后才解锁；连接页同步补齐。
- SC-14/19 / R6：筛选窗口覆盖首键起全过程，两类独立trace必须含keydown/Paint；真实80ms早期任务负向控制使PERF-10失败。正常完整after-review-v3（980记录、11/11行为、24trace）formal pass，详见执行报告§10。

## 核心流程（伪代码）

遵循Spec174 §7：写前pending/epoch→现有落盘→失效→原audit/policy/rollback→finally失效/释放；响应序列化与客户端epoch再验证。单事务内多个底层hook可重复递增代次，但只最后一个外层屏障结束才允许构建。仅preview/历史快照变化不触发当前资产代次。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。D/P/C/L/A/U与DI编号均为工程标记，不新增产品术语；错误/状态文案按Spec174。

## Design System Compliance

本矩阵不引入视觉模式；UI失效/重试表现遵循Spec174与DS20页面分区。
