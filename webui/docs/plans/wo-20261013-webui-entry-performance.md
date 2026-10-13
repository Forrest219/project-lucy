# WebUI Entry Performance Implementation Plan / Cursor 工单

**Goal:** 按 Spec 174 实现进入页面与回访毫秒级体验，并交付可复核的功能与性能验收。

**Architecture:** 请求内批量权限上下文减少重读；版本化只读显示快照负责回访；页面分区就绪；生产资产预压缩与路由 lazy；服务端有界后台探测队列。实际授权、编辑 AST 与 KTX 接口沿用现有契约。

**Tech Stack:** Node/Fastify、TypeScript、React、TanStack Query v5、Vite、Vitest、Playwright Chromium。

| 字段 | 内容 |
|---|---|
| WO | WO-20261013-174 / v1.2 |
| 日期 / 执行者 | 2026-10-13 / Cursor |
| 状态 | Implemented · 修正复验完成（2026-10-13）：原 after 退出码0与成绩保留；复审缺陷按[审阅与修正工单](wo-20261013-webui-entry-performance-REVIEW-FIX.md) R1–R7 修正，正式复验 `after-review-v2` 退出码 0（formal pass），见[IMPLEMENTATION_NOTES §9](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md)；残余未覆盖分支已登记；未部署目标环境 |
| 权威 Spec | [174-webui-entry-performance-spec.md](../174-webui-entry-performance-spec.md) |
| 用户批准 | 已同意原优化方案及生成本工单；范围内按本单执行，无需重复确认常规实现步骤 |
| 输出 | 代码与测试 + `webui/docs/plans/wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md` |

用户指定 Cursor，本单直接交给 Cursor 执行，不依赖 Claude/superpowers 的未安装技能，不要求另开 agent 或双核流水线。适用仓库治理优先于通用计划模板。

v1.2：在最新lucy-v2.0基线上重新核对，并保留v1.1的修正：补实际写回/回滚入口、写屏障与响应epoch、enabled_tables上下文、runtime隔离、缓存重置IPC、baseline就绪谓词、逐情景30样本；按照本单顺序可直接执行。

重评基线为e189346，stash来源7653746（`wip before pull lucy-v2.0 20261013-1529`）。仅提取三份本单文档；禁止整包stash apply覆盖最新README/已实现Spec。原暂用161/163编号均已占用，当前权威入口为Spec174 v1.2。

## 0. Cursor 接单提示（可直接复制）

```text
执行 webui/docs/plans/wo-20261013-webui-entry-performance.md，权威契约是
webui/docs/174-webui-entry-performance-spec.md。
用户已批准此优化范围。先读 AGENTS.md、DEVELOPMENT、Spec 和本工单，
检查工作区并列出实施顺序，然后完成 T0–T7、功能回归、生产构建性能验证与执行报告。
基线是最新lucy-v2.0（重评e189346）；保留已实现Spec163/164/168/170/172/173，
不得恢复旧连接页脚、旧单角色字段、旧Skill/Wiki授权或旧问询归因。
不能只交骨架屏或计划；只有真实主内容性能与一致性门禁全部通过才能标记完成。
本单明确要求桌面 Chromium 浏览器验证，不做移动窄屏。
不修改 KTX 源码、真实数据库配置/secret/生产数据，不直接部署目标 IP。
禁止全局关闭 fresh、削弱鉴权、把旧缓存作为 runtime 授权、用 Vite dev 时间达标。
测试与计时只用匿名可删除 fixture，临时证据放 inbox。
若工具/环境使某门禁不能执行，报告具体未通过项，不能伪造成功或自行放宽指标。
```

## 1. 执行约束与读前资料

仓库根路径以当前 checkout 为准（本次 `/Users/zhangxingchen/Projects/project-lucy`）。先 `git status --short`，保留用户未提交内容；需分支时使用 `codex/` 前缀。按 T0→T7 顺序、小提交推进，不自动提交未归本单的文件。

必读：`docs/governance/DEVELOPMENT.md`、Spec 174、`webui/docs/00-product-terminology-standard.md`、Design System 00/11/12/20/99、Spec 107/108/128/131（catalog-bound）/142/163/164/168/170/172/173、`docs/qa/selector-contract.md`、`webui/server/paths.ts`。Spec131的governed-skill文档已改号171，不要与仍为131的catalog-bound文档混淆。

仅性能 fixture 下可创建 ktx.yaml/access YAML；不改真实配置。不读取 secret 后输出，不把 UI/HTTP 全响应、Agent token、数据库 host 加入公开报告。新脚本若使用 Bash须兼容 macOS 3.2，优先 TypeScript/Node。

浏览器可复现一次目标环境，但自动性能样本只跑 fixture/stub；不反复启动生产 DB 探测。真实密码登录用 fixture 用户，禁止弱化 scrypt。本单只交可发布代码，不授权执行线上部署、客户打包或删除 demo volume。

## 2. Gate 与工单映射

| Gate | 任务 | 必须交付 |
|---|---|---|
| G0 | T0 | 可运行生产构建测量器、匿名 fixture、同条件 baseline |
| G1 | T1–T2 | 批量上下文等价、局部呈现、SC-01/02/06/07/16/17/21/22/23 |
| G2 | T3 | 版本失效/竞态/身份隔离、SC-03/04/05/08/13/15/18 |
| G3 | T4–T5 | 编码缓存/lazy/调度回归、SC-09/10/11/12/20 |
| G4 | T6–T7 | PERF-01–10、SC-14/19/24、完整执行报告与变更清单 |

下列新增文件为**待 Cursor 创建的交付物**，现在不存在；现有路径须接单时核对。允许在同目录细化模块，若改变规范行为/扩大范围先记录差异，不能默默改验收。

## T0. 生成匿名 fixture、生产测量器与基线（优化前）

**Files**

- Create: `webui/scripts/entry-performance.mts`
- Create: `webui/scripts/entry-performance-fixture.mts`
- Create: `webui/scripts/entry-performance-server.mts`（fixture专用生产服务启动与IPC reset）
- Create: `webui/scripts/__tests__/entry-performance.test.ts`
- Create: `webui/tests/performance/entry-performance.config.ts`
- Create: `webui/tests/performance/entry-performance.spec.ts`
- Create: `webui/tests/performance/fixtures/README.md`
- Modify: `webui/package.json`（注册 perf:entry）、`webui/vitest.config.ts`（只纳入新增脚本测试）
- Modify: `webui/server/index.ts`（观测入口）；Create: `webui/server/entry-performance-timing.ts`
- Test: `webui/server/__tests__/entry-performance-timing.test.ts`

**步骤**

1. 实现 fixture 生成器：Spec §8 seed=161、真实非空SQLite审计统计、目录字节/hash 清单，fake access/roles/overlay 与 KTX stub；输出到 `inbox/webui-entry-perf/<run-id>/fixture`。对输出路径做 guard，禁止仓库真实 ktx.yaml、config、semantic-layer、secrets 目录与外部已有目录；清理只能删除带本工具 owner marker 的 run 目录。
2. fixture 生成不调用真实 KTX，不复用 `init-e2e-fixture.sh` 中真实命令 fallback。stub 支持固定 50 ms、延迟 3 s、失败、超时与调用计数；只返回确定假数据。
3. 实现 production runner：运行 Vite build，启动 `tsx scripts/entry-performance-server.mts` 且 `KTX_PROJECT_ROOT/LUCY_CONTENT_ROOT/LUCY_WEBUI_DIST_DIR` 指向 fixture/构建产物；该fixture入口调用真实buildServer、既有policy初始化/Proxy，依据scenario选择真实startup预热或禁用display预热。通过子进程IPC测试hook清除display缓存，不新增HTTP reset/ready端点。所有root、stub PATH及`LUCY_ACCESS_CONFIG_PATH`显式绑定fixture，移除继承的真实配置override；拒绝未知进程/端口。finally停止本runner进程，不终止他人服务。
4. 独立 Playwright config 使用生产服务、Chromium 1440×900、workers=1、retries=0。现有 `playwright.config.ts` 自动启 Vite dev，不能沿用来测性能。
5. Server-Timing 为 `manifest/overlay/access/permissions/stats/serialize/total` 等固定名称，记录 hit/miss、构建次数；不输出对象名、SQL、权限/token 内容。可用依赖注入统计解析次数，禁止只用墙钟断言优化效果。
6. 按 Spec §8.1完整scenario表实现nearest-rank、每路由/接口独立30样本、失败不抹掉、每样本cold/warm reset、page内事件起点与二次rAF、资源总量/CLS/long-task、trace导出。baseline的真实DOM就绪谓词不依赖T2尚不存在的标记；after采用同谓词与mark双重检查。只stub KTX，禁止mock sources/agents响应或SQLite统计。登录fixture正常密码算法，密码不在CLI/日志打印。
7. G0 完成后、任何优化前跑 baseline 并保存原始 JSON/trace/summary；baseline 不强制满足预算。早期 CI 可 `--iterations 3` 自测，正式 baseline/after 都≥30 次。

8. fixture使用当前SQLite schema与真实审计写入/查询API，seed包括可识别session、turn、access_log_sources及已关联协议行，保留Spec172/173归因口径；字段别名不按旧版本手工插入。生成Agent采用当前roles[]格式（包含双角色成功/legacy单角色/双声明失败的专门功能子fixture），包含lucy_admin跟随新连接和Spec170上下文工具场景。

**要求的 CLI 契约（T0 实现后可执行）**

```bash
npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario all --iterations 30 --output inbox/webui-entry-perf/baseline
```

CLI由脚本import.meta路径解析checkout root（npm脚本cwd通常是webui），相对output固定相对此root；返回JSON含runId、sourceCommit、dirtyDiffDigest、mode、hardware/browser/runtime、fixtureHash/bytes、每scenario/路由raw samples、P50/P95/max、failures、artifact paths。baseline不检查预算，采集失败仍非零；after任何门禁失败非零。after必填`--baseline-dir`，核对环境/seed/anchor/fixture快照hash，重用该匿名fixture的干净初始快照再测（不能重用mutation-race后的脏fixture）；不匹配则失败，不能悄悄换基线。输出目录存在则拒绝覆盖，重跑必须新run目录；所有失败case保留。`--scenario all`必须包含Spec §8.1全部情景及SC行为测试，不以一个汇总P95替代各页。

**完成条件**：fixture determinism、路径 guard、统计/失败行为测试通过；同一生产基线可重复测量；附 G0 命令与退出码。读 inbox 历史报告只能辅助解释，不能伪造同条件 baseline。

```bash
npm --prefix webui test -- scripts/__tests__/entry-performance.test.ts server/__tests__/entry-performance-timing.test.ts
```

T0须在vitest include中登记scripts测试路径后执行上命令；先固定baseline，再开始T1。启动fixture-server的IPC hook仅接受本runner持有的父子进程通道与fixture owner marker，禁止任意HTTP调用或生产server公开reset。

## T1. 请求内权限与语义解析去重

**Files**

- Modify: `webui/server/proxy/acl.ts`
- Modify: `webui/server/semantic-layer.ts`
- Modify: `webui/server/admin/agents.ts`
- Modify: `webui/server/index.ts`（sources handler）
- Create: `webui/server/__tests__/admin-permission-batch.test.ts`
- Modify: `webui/server/__tests__/semantic-layer.list-extras.test.ts`
- Modify: `webui/server/__tests__/admin-agents.test.ts`
- Regression: `acl-capability.test.ts`、`agent-constraints-ac-p15.test.ts`、`semantic-layer.roundtrip.test.ts`

**步骤**

1. 先加行为测试：12 enabled + disabled Agent、legacy allow/role set/selectors/constraints/catalog_bound/duplicate source/坏YAML，与既有resolver等价；source map/access/启用表构建均每批≤1。固定相同输入比较snapshotHash/capabilityDigest/sourceMapVersion、deny；不能一边比A、一边重新读B。
2. 实现纯读取的上下文与批量入口，显式透传enabledTables给compileRole；Agent基础字段、version、权限使用同access快照，动态统计完成后再验证代次。display构建不可写identity cache、sourceMapState或policyRef；spy检查展示读取前后runtime policy/version/授权结果无改变。覆盖LUCY_ACCESS_CONFIG_PATH不同时的未确认/不可用，不能静默改写路径。
3. sources/list agents 改用 batch；tables/manifestSchemas 用同次扫描结果。可由预解析 Manifest派生 source map但不得重写权限算法。

   同时保留 `agentRoleFields/resolveRoleIds` 已实现的roles/roleResolutionError/declaredRole(s)，批处理不要自行重算数组或按单role投影。对lucy_admin将包含零enabled表的全连接Map透传 `resolveCatalogConnections`，新增连接无需手改role.allow.connections；普通role的wildcard仍deny。CONTEXT_TOOLS的工具清单/裁决继续由现有runtime处理，权限显示cache不承担其授权。
4. 针对absent/malformed access原计数0兼容，新增sources与Agent权限meta，按Spec §3.3测试ok/partial/unavailable/runtimeConsistency，不自动commitpolicy；正常0与未知分开。
5. profile 若显示 AST仍贵，再做摘要轻量解析等价优化；编辑 roundtrip继续原 Document路径。

   不将summary归一化后的column.type替代 `readChangedSourceColumnContracts` 原始校验输入；保留当前publish-gate对float等类型的拒绝。
6. 跑 focused tests、结构计数，再跑阶段性能采样。按下面命令单独提交本阶段（提交前核对本单变更）。

```bash
npm --prefix webui test -- server/__tests__/admin-permission-batch.test.ts server/__tests__/semantic-layer.list-extras.test.ts server/__tests__/admin-agents.test.ts server/__tests__/acl-capability.test.ts server/__tests__/agent-constraints-ac-p15.test.ts server/__tests__/semantic-layer.roundtrip.test.ts
```

**完成条件**：SC-01/02/16/17/22/23；每批一次source map/启用表快照，编辑AST不变，fresh默认不变，runtime缓存无副作用，最新多角色/上下文工具开放契约不回退。

## T2. 页面分区就绪与稳定加载

**Files**

- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/pages/Onboarding.tsx`
- Modify: `webui/src/pages/Catalog.tsx`
- Modify: `webui/src/lib/types.ts`
- Modify: `webui/src/app/app.css`（仅 existing tokens）
- Create: `webui/src/components/AsyncRegion.tsx`（可复用现有等价组件）
- Modify: `webui/src/__tests__/connection-overview.test.tsx`、`onboarding.test.tsx`
- Create: `webui/src/__tests__/catalog-loading.test.tsx`
- Modify: `webui/docs/design-system/99-governance.md`（临时模式登记）

**步骤**

1. 登记静态占位与120 ms局部加载模式：背景、范围、无动画、局部 aria-busy；负责人本单执行者，最迟本单关闭时纳入20页面模式或明确移除临时条目。
2. 用受控 deferred Promise 测试 project 已完成、sources仍 pending/failed，页面标题/可授权动作/基本卡片存在；pending statistics显示未知而不是0。测试overview其他模块可用、Catalog工具栏稳定。
3. 删除整页loading/error提前return，按Spec最小依赖渲染；未知时禁用依赖事实的危险动作。
4. sources meta partial/unavailable对Agent引用显示未知/重试；不要把成功无表与读取失败混合。
5. fake timer测试120 ms，无缓存时固定占位，已有数据后台refetch不替换主内容；保留键盘焦点、筛选和树选择。
6. 加用于性能观测的非敏感模块ready标记与DOM testid（登记selector contract），第二rAF记录；只在数据与相应控件可用后发出。

7. 保持Spec163卡抬头/更多/进度入口及executionNoticeCopy规则；runtime pending/error不增加列表提示、不发canary、不恢复四层badge。接线不得还原旧McpRuntimeStatusPanel到每张卡。缺Manifest行保留Spec164“从数据库读取表结构”及成功后打开启用范围的流程。

```bash
npm --prefix webui test -- src/__tests__/connection-overview.test.tsx src/__tests__/onboarding.test.tsx src/__tests__/catalog-loading.test.tsx
```

**完成条件**：SC-06/07/21；主页面不等待探测/最慢统计，未知数据可辨认，Spec142/163/164 IA保持；skeleton改善不能标记PERF-05完成。

## T3. 版本缓存、写入失效与账号隔离

**Files**

- Create: `webui/server/display-snapshot.ts`
- Create: `webui/server/display-generation.ts`
- Create: `webui/server/__tests__/display-snapshot.test.ts`
- Create: `webui/server/__tests__/display-invalidation.test.ts`
- Modify: `webui/server/paths.ts`、`semantic-layer.ts`、`catalog-reload.ts`、`index.ts`
- Modify: `webui/server/fs-safe.ts`、`catalog-assets.ts`、`project.ts`、`table-yaml-history.ts`（实际落盘通知/rollback矩阵）
- Modify: `webui/server/admin/agents.ts`（本地writeAccessYaml及直接回滚）
- Modify: `webui/server/admin/config-audit-write.ts`、`admin/access-config.ts`（按写路径清点选择）
- Create: `webui/src/lib/displayQueryOptions.ts`
- Modify: `webui/src/lib/auth.tsx`、`webui/src/lib/apiClient.ts`、`webui/src/lib/queryKeys.ts`、`webui/src/app/App.tsx`、T2页面/`webui/src/pages/admin/AgentList.tsx`
- Inspect/Modify consumers: `webui/src/components/SchemaStructurePrep.tsx`、`webui/src/components/AddSchemaDrawer.tsx`、`webui/src/lib/prepareSchemaStructure.ts`、`webui/src/pages/connections/TableWhitelist.tsx`、`webui/src/pages/admin/AgentDetail.tsx`（仅query scope/失效/epoch接线）
- Create: `webui/src/__tests__/display-query-isolation.test.tsx`
- Update: [失效矩阵](wo-20261013-webui-entry-performance-invalidation-matrix.md)（本次已建立；Cursor补真实hook与测试）

**步骤**

1. 按已建失效矩阵逐行`rg`复核safeWrite/safeRemove、rename、直接writeFile、restore/import及两套access rollback；填写before/after屏障hook、客户端querykey与对应用例。不只搜API成功回调。
2. 写前/写中/部分失败/rollback/空缓存/inFlight/隔离测试；以deferred write在truncate与完整写之间发请求，不能发布半文件。覆盖两套access写入后runtimeAck=false的回滚、连接创建后失败恢复、落盘后审计失败，dryRun只验证。
3. 实现有界cache/pendingWrites/epoch（Spec≤4构建、≤32principal槽位）；上层access事务包住write→commit→rollback，底层通知可重入但不能释放外层。总重试≤3而非多层3×3；一次构建只服务确切key；旧Promise finally不能删新任务。响应序列化前重新核对版本，客户端拒绝网络已发的旧响应。Map/Set不被Object.freeze保护，污染测试证明后续请求不受修改影响。
4. 在真实落盘前屏障/后通知/finally失效，并补catalog upload rename、两套access直接writeFile回滚、project ktx恢复与history还原。不假设safeWrite原子；不扩大为全仓原子写改造，保持policy顺序和fail-closed。
5. watcher与1秒metadata/30秒摘要对账，测试原子替换/删除/同mtime同size/override路径/内容根切换；协调invalidateContentPathsCache和watcher迁移，排除upload.tmp/history/sidecar；Fastify onClose/reset释放资源。

   paths.ts已用projectRoot/env作cachedKey，复用而不覆盖该修复；ktx paths.content_root仍需要显式invalidate。createConnection屏障包住当前rollbackWrittenConnection至audit结果结束，不按旧代码只包最初两步写入。
6. 批量权限派生结果按access/source版本复用，Agent审计统计继续动态取；display cache不被runtime引用。
7. 仅project/sources共享30秒options；Agent复合动态统计保持staleTime=0。更新所有queryKeys消费/invalidate；apiGet/apiPost向fetch透传React Query signal，authEpoch/queryEpoch拒绝忽略abort的旧结果；提交前、提交后（成功/失败）与401invalidate。只读query≤1次重试，mutation禁止新增自动重试；覆盖多标签/外部变更下一请求的新版本，不宣称静止页面实时推送。
8. sources快照启动预热放现有policy提交/目录scan之后；不改变探活合同。ready仅用于测量显示读模型，失败披露而不制造policy healthy。

9. 验证SchemaStructurePrep在upload/reload后await refetch并getQueryData看到同scope新sources；TableWhitelist全部query/invalidate随scope builder对齐。prepareSchemaStructure的preview不触发D/P写失效，upload才触发；不自动enabled_tables。

```bash
npm --prefix webui test -- server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/paths.test.ts server/__tests__/api.catalog-reload.test.ts src/__tests__/display-query-isolation.test.tsx
```

**完成条件**：SC-03/04/05/08/13/15/18；失效矩阵逐行有测试，display preload不能更新runtime缓存。

## T4. 生产资源预压缩与路由拆包

**Files**

- Create: `webui/scripts/precompress-assets.mts`
- Create: `webui/server/static-assets.ts`
- Create: `webui/server/__tests__/static-assets.test.ts`
- Modify: `webui/package.json`、`webui/vite.config.ts`、`webui/server/index.ts`
- Modify: `webui/src/app/App.tsx`、`webui/src/components/ObjectDetailDrawer.tsx`/`webui/src/components/CommandPalette.tsx`（若拖入重依赖）
- Create: `webui/src/lib/routeChunkRecovery.ts`
- Create: `webui/src/__tests__/route-chunk-recovery.test.tsx`
- Regression: `webui/server/__tests__/webui-admin-auth.test.ts`

**步骤**

1. 测试Accept-Encoding q=0、identity/gzip/br、HEAD/304/Vary/MIME/content-length、deep link/missing assets/越界/坏编码；临时dist目录使用真实字节比较和解压验证。
2. build后预压缩；只压JS/CSS不压API/用户上传，避免产物自我递归压缩。实现representation ETag与正确304headers；hash资产长期缓存，HTMLno-cache。
3. App将业务路由lazy，保留Auth/Shell；检查公共组件反向import，确保初始资源列表真减少。局部Suspense，具名export采用适配.default。
4. 做一次chunk失败恢复、会话标记防循环；public Help与登录的错误不触发无限路由重试。
5. `npm run build`检查实际首屏加载chunk总gzip，不能只看index.js；压缩产物自然进入现有Docker COPY/build。无必要不改Dockerfile；若必须改则遵守客户架构约束。
6. 深链桌面浏览器验证 `/catalog`、`/connections`、`/overview`、Agent列表、编辑页、登录和Help。

```bash
npm --prefix webui test -- server/__tests__/static-assets.test.ts server/__tests__/webui-admin-auth.test.ts src/__tests__/route-chunk-recovery.test.tsx
npm --prefix webui run build
```

**完成条件**：SC-11/12、PERF-08；dev server或单index文件大小不能作交付证据。

## T5. 后台探测调度、任务合并与配置隔离

**Files**

- Create: `webui/server/background-probes.ts`
- Create: `webui/server/__tests__/background-probes.test.ts`
- Modify: `webui/server/live-catalog.ts`、`server/index.ts`（两个探测路由）
- Modify: `webui/src/pages/connections/ConnectionOverview.tsx`
- Modify: `webui/src/lib/apiClient.ts`（请求 AbortSignal 透传；兼容原调用签名）
- Create: `webui/src/__tests__/api-client-abort.test.ts`
- Modify: `webui/server/__tests__/live-catalog.test.ts`
- Modify: `webui/src/__tests__/connection-overview.test.tsx`
- Modify: Spec 107/108（增加Spec174调度/失效引用，不覆盖其余正文）

**步骤**

1. mock exec测试整个服务并发≤2、queue≤64、同key合并、不同taskKind隔离、配置代次更新、异常finally、超时与取消；证明手动任务不会无限饿死自动任务。
2. 接入仅test/live-schemas的统一调度，保持现有KTX命令及30秒timeout，不让正常问数使用这个低并发队列；实现Spec174 §5可选purpose参数、错误码和AbortSignal，原调用仍兼容。
3. project/首内容完成后调度；可见卡优先，其余排队；界面使用Spec已有“探测中…”表达等待，后台返回后只更新对应区域。
4. live-schemas保留成功10分钟缓存，refresh=1绕过已完成缓存但可以合并同版本进行中任务；配置变更失效。健康结果不跨页复用。
5. 请求断开/页面离开按订阅取消，不能把Fastify request正常close当断开；60秒排队截止，配置过期/取消都settle Promise。许可在子进程真正退出后释放；测试超时先返回而child晚退出时仍≤2并发。
6. latencyMs只计原命令执行，queueMs/totalMs独立观测；慢/错误/timeout卡片与Drawer同源。观察有调度/无调度的sources时间与末卡尾延时，并如实记取舍。

```bash
npm --prefix webui test -- server/__tests__/background-probes.test.ts server/__tests__/live-catalog.test.ts src/__tests__/connection-overview.test.tsx src/__tests__/api-client-abort.test.ts
```

**完成条件**：SC-09/10/20；每次进页仍探测，所有Promise与许可终结可验证。

## T6. 功能回归与生产构建性能验收

**Files**

- Create: `webui/tests/e2e/specs/entry-performance-behavior.spec.ts`
- Modify: `docs/qa/selector-contract.md`（新增testid），性能config/spec与runner按需要完善
- Evidence: `inbox/webui-entry-perf/<run-id>/`（临时，不提交私有数据）

**必须执行**

1. 顺序跑前述focused tests；再补权限/来源/登录/导入roundtrip回归，不简单复制内部函数实现作为测试。
2. 桌面浏览器行为用deferred/stub慢接口检查各SC。E2E fixture只生成假数据；不自动触发真实生产数据库。
3. 使用专用production config；至少包含cold资源/warm资源刷新、同会话往返、query cold、服务cold/warm、登录成功后进入、慢/失败后台任务与chunk失败。该config明确纳入 `tests/performance/entry-performance.spec.ts` 与 `tests/e2e/specs/entry-performance-behavior.spec.ts`；testDir/testMatch按此设置，不能生成行为测试却未执行。
4. 所有PERF场景按Spec §8.1每页/接口5warm-up+30正式样本，SC行为另外运行。cold每样本IPC reset并assert miss/构建次数，无自动预热；baseline/after相同DOM谓词、seed/hash/字节/统计负载，页面计时用同performance时钟，失败不丢弃。
5. 保存before/after表、原始JSON、至少连接整页等待/优化后主内容与trace关键帧。脱敏HAR/trace；无Authorization/Cookie/真实账号/SQL。
6. 有实际目标访问条件时低频只读核对目标资源头与界面，不部署。远端还是旧版本时明确“代码fixture验收完成、远端未部署”，不能把旧远端成绩当after。

```bash
npm --prefix webui run lint:terminology
npm --prefix webui run lint:ia-boundary
npm --prefix webui run build
npm --prefix webui test -- server/__tests__/mcp-proxy-acl.test.ts server/__tests__/acl-capability.test.ts server/__tests__/agent-constraints-ac-p15.test.ts server/__tests__/webui-admin-auth.test.ts server/__tests__/api.source-import.test.ts server/__tests__/semantic-layer.roundtrip.test.ts
npm --prefix webui test -- server/__tests__/admin-agents.test.ts server/__tests__/project.create-connection.test.ts server/__tests__/permission-model-version.test.ts server/__tests__/mcp-proxy-skills.test.ts server/__tests__/skill-acl.test.ts server/__tests__/wiki-natural-language-search.test.ts server/__tests__/validate-changed-column-type.test.ts server/__tests__/semantic-assets.validate-gate.test.ts server/__tests__/proxy-audit.test.ts server/__tests__/admin-audit.test.ts src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx src/__tests__/add-schema-drawer.test.tsx src/__tests__/table-whitelist.test.tsx
npm --prefix webui run perf:entry -- --phase after --mode production --scenario all --iterations 30 --baseline-dir inbox/webui-entry-perf/baseline --output inbox/webui-entry-perf/after
```

所有root命令从checkout根执行。`npm --prefix webui test -- ...`通过npm script在webui cwd运行，直接npx命令须先cd webui。生产Playwright只能由perf:entry runner提供fixture root/端口/IPC/场景参数后调用；报告保留其实际子命令与环境摘要用于复核。不提供缺服务也可能fallback的裸playwright命令；config拒绝未知服务，不能fallback Vite dev。本单未要求全量nightly、Firefox/WebKit或移动窄屏。

**完成条件**：PERF-01–10与SC-01–24全部通过，CLI退出0；未执行/预算未达标均不是完成。

## T7. 收尾、报告与交付清单

**Files**

- Create: `webui/docs/plans/wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md`
- Update: Spec174、此WO状态；索引说明按最终实现刷新
- Update: DS临时模式为正式章节或明确本单限定；失效矩阵真实路径

报告必须包含：

- 源代码commit/dirty状态、构建版本、机器CPU/内存/配额、Node/Chrome、fixture规模/字节/hash、缓存和网络条件。
- T0–T7完成状态；SC逐项证据、PERF逐项baseline/after P50/P95/max/n/失败数。
- 真实数据ready断言、资源总列表、gzip字节、计时方式；冷启动单列、密码提交单列。
- 失效矩阵、source map/Manifest解析次数、并发队列峰值、watcher/close检查。
- 所有命令及退出码、trace/截图/原始JSON位置与脱敏说明；工具不可用项如实列未验证。
- 变更文件、兼容性、Spec107/108变化、Design System Compliance、风险/回退步骤、部署状态。

正式notes包含可复现摘要，过程原始证据落inbox可清理；若需要长期归档使用经脱敏的发布附件并写其校验摘要。本单不自动执行push/发布；按既有交付流程提交只包含本单文件的可审阅commit/PR。

### Definition of Done

- [x] G0–G4与SC-01–24通过，矩阵每条可复核，最新v2.0行为不回退。
- [x] PERF-01–10满足Spec预算，包含真实30样本，非骨架/开发模式成绩。
- [x] 实际授权/deny/AST/搜索/登录权限/主任务交互未回归（既有失败用例已与原HEAD逐项对照，见报告§5.3）。
- [x] 脚本、fixture、测试、build、报告可在干净checkout复现。
- [x] 无真实凭据/数据提交；缓存与后台资源关闭可验证。
- [x] 未部署目标服务的事实明确；不声称目标IP已优化。

## 核心流程（伪代码）

执行顺序与状态机遵循Spec174 §7；本单不另设算法。Gate状态为 `not_run → running → passed/failed`，failed保持原始样本并修复后创建新run；只在所有必须Gate通过后更新Implemented/Verified，不能按“做完代码”提前闭单。

## Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`，新产品术语：None。计时/缓存代次为内部工程概念；测试断言沿用既有UI文案，英文/对象/路径节点维持翻译防御。

## Design System Compliance

遵循DS00/11/12/20/99；T2先登记加载模式、后落代码，T7收口。不新增品牌样式、不改Spec142布局、不做移动重排。
