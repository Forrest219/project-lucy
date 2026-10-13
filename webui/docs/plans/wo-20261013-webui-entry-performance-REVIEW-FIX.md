# Spec 174 实现审阅与 Cursor 修正工单

**Goal:** 修正已复现的一致性缺陷和验收遗漏，使 Spec 174 v1.2 的完成声明可以由测试及原始证据支持。

**Architecture:** 保留批量权限解析、显示快照、分区加载和有界探测；统一快照返回屏障、账户响应隔离与展示时效门禁。性能验收须证明数据、操作和后台更新完成，沿用原预算。

**Tech Stack:** TypeScript / Fastify / React / TanStack Query / Vitest / Playwright Chromium / Vite production build。

| 字段 | 内容 |
|---|---|
| 工单 | WO-20261013-174-REVIEW-FIX / v1.0 |
| 日期 / 审阅者 | 2026-10-13 / Codex |
| 审阅对象 | lucy-v2.0，HEAD `8e4a461`；实现区间 `2a93abd..8e4a461` |
| 权威契约 | [Spec 174 v1.2](../174-webui-entry-performance-spec.md)，尤其 §3.2、§3.3、§4.1、§4.2、§5、§8 |
| 原工单 / 报告 | [实施工单](wo-20261013-webui-entry-performance.md) / [IMPLEMENTATION_NOTES](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md) |
| 状态 | Implemented（2026-10-13，Cursor）：R1–R7 已执行，逐项提交 / 测试 / 退出码与复验证据见 [IMPLEMENTATION_NOTES §9](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md)；正式 after `after-review-v2` formal pass；未部署 |
| 边界 | 单进程 / 单实例；桌面 Chromium；不改 KTX、权限算法、真实配置或目标部署 |

用户要求 Cursor 落地，本单直接交付 Cursor，不依赖额外 agent、技能安装或 Claude 流水线。遵循仓库治理及现有术语。不得恢复 stash、覆盖其他已实现 Spec 或放宽 Spec 174 的预算来消除失败。

## 审阅结论与证据

**优化有效，但不能接受“SC-01–24 / PERF-01–10 全部完成”的声明。** 已发现并复现一致性错误；毫秒级数字支持当前 fixture 的采样结果，但测试谓词和正式验收完整性不足。

读取了 `inbox/webui-entry-perf/{baseline,after}/{results.json,samples.json,traces/}`：两轮各 980 条记录（含 warm-up），每个计时场景/路由各 30 条正式样本，采集失败数均为 0。after 7 个 behavior 测试通过；baseline behavior 为 6 个 unexpected，baseline 退出 0 仅表示性能采集成功，不能宣称 baseline 功能门禁通过。

| cold browser / primary-ready P95 | baseline / ms | after / ms |
|---|---:|---:|
| connections | 1112.9 | 125.0 |
| catalog | 1074.1 | 101.2 |
| overview | 1899.7 | 136.3 |
| agents | 1379.8 | 130.0 |

after 原门禁无失败，browser-cold CLS 最大约 0.0208、业务长任务计数为 0。after `sourceCommit=bc63505, dirty=true`；`bc63505..8e4a461` 仅改文档，因而代码版本与被审阅 HEAD 对应。成绩来自 Apple Silicon / loopback / 匿名 fixture，不代表目标 IP、客户 amd64/Kubernetes 环境的实测。本审阅未重跑整套 30 样本浏览器基准，重新聚合原始证据并运行隔离复现及针对性测试。

针对性测试：5 文件 **47/47 通过**，退出 0（2026-10-13；display-snapshot、display-invalidation、admin-permission-batch、display-query-isolation、entry-performance）。通过的测试未覆盖下述组合场景。

临时复现脚本：仓库根 `inbox/webui-entry-perf-review-proof.mts`，执行 `webui/node_modules/.bin/tsx inbox/webui-entry-perf-review-proof.mts`。它只建立临时匿名目录并最终删除，不读取真实配置；结果如下。脚本不是正式交付依赖，必须将回归条件写入版本化测试。

```json
{"case":"unverified-pending","pending":true,"returned":"partial-write","cache":"bypass"}
{"case":"unverified-concurrency","inflight":6}
{"case":"old-account-post","accepted":true}
{"case":"post-auth-required","authLostCalled":false}
{"case":"empty-budget","evaluatedRules":0}
{"case":"runtime-only-change","before":"unconfirmed","actual":"matched","returned":"unconfirmed","cache":"hit"}
```

runtime-only-change 使用真实 permission context / policy commit 与同一个快照函数复现缓存机制；对应业务调用为 `index.ts::getSourcesDisplaySnapshot` 和 `admin/agents.ts::agentPermissionSection`，两者均将 runtimeConsistency 序列化进 D/P/C 显示缓存。它不是目标环境的 API 抓包。

## 问题清单

| 编号 / 优先级 | 定位（相对仓库根，审阅 HEAD 行号） | 问题及后果 | 对应契约 |
|---|---|---|---|
| R1 / P1 | `webui/server/display-snapshot.ts:107` | unverified 分支在写屏障、并发上限、合并、构建后代次校验之前直接 build/return；已复现 pending=true 返回与 6 个并发构建。磁盘重建不能保证读取完整事务；报告“永远返回正确数据”错误 | SC-03/04/05/15，§3.2/§7 |
| R2 / P1 | `webui/src/lib/apiClient.ts:158`（同类 PUT/PATCH/DELETE） | authEpoch / AUTH_REQUIRED 401 处理仅存在于 apiGet。已复现旧账户 POST 成功结果被接受，POST 401 未调用清理处理器；signal 不能替代响应时的 epoch 校验 | SC-08/18，§4.2 |
| R3 / P2 | `webui/server/index.ts:523`、`webui/server/admin/agents.ts:975` | runtimeConsistency 随权限段缓存，仅文件代次失效；runtime policy commit / 降级自身变化不会更新该字段。已复现实际 matched、缓存 unconfirmed；Catalog/AgentList 未消费该字段，缺少规范要求的待确认提示 | SC-17，§3.3 |
| R4 / P2 | `webui/src/lib/apiClient.ts:99`、`webui/src/app/App.tsx:690`、`webui/src/lib/displayQueryOptions.ts:17` | 写开始只递增 epoch，未清理受影响动作可操作状态；仅 settled 才 invalidate。没有 pending 状态拒绝写中开始的读取。auth/write 两类失配同用 STALE_RESPONSE，displayRead 会重试 auth 失配，与注释及账户隔离要求不一致 | SC-15/18，§4.2 |
| R5 / P2 | `webui/src/pages/connections/ConnectionOverview.tsx:421,479` | project 已就绪仍因 runtime/reload 装饰请求等待最多 300ms；probesArmed 又只以 project.data 判定，可在卡片尚未 commit 时发探测。违背 project 驱动卡片和主内容 commit 后探测；fixture 快返回未暴露慢装饰请求 | SC-06/10，§4.1/§5，PERF-09 |
| R6 / P1 | `webui/scripts/entry-performance.mts:191,784`；`webui/tests/performance/entry-performance.spec.ts:63,295,363` | 缺 scenario 直接跳过，未强制每指标 n≥30；空预算结果会被汇总逻辑视为无失败。筛选完成仅检查原本就存在的 count 节点；primary 谓词缺部分统计/范围树/动作条件。probe-load 未断言目标切换时全部自动意图已发且真实排队/执行；慢探测场景未纳入 CLS 门禁 | SC-14/19，PERF-01–10 的证据完整性 |
| R7 / P2 | 失效矩阵 IM-03/06/08/13/14，报告 §5.3/§7 | import、createConnection 失败、两套 access runtimeAck=false 回滚等专门分支未测，却列通过。全 server 38 失败 vs baseline 37 需可复核同环境比较；报告称多一例是环境差异，不能只按总数证明无新增 | SC-05/13/15/16，完成声明 |

R2 是客户端旧响应隔离缺陷，本审阅未证明服务端授权越权；R3 是展示生效状态错误，不能由此推断运行时授权读取了展示缓存。IM-18 鉴权先于缓存处理、动态审计统计不放入 permission cache 等实现方向保留。

## 执行顺序与修正任务

Cursor 从 R1 → R2 → R3 → R4 → R5 → R6 → R7 执行。每项先添加可复现失败的有意义测试，再修最小代码并跑对应回归；按项提交代码与测试，只 stage 本项路径。不要自动重试 mutation，不要推送或部署真实环境来替代 fixture 验证。已有授权覆盖性能优化范围，本单不新增功能或改变权限语义。

### R1 — 对账失效时遵守安全返回边界

修改 `webui/server/display-snapshot.ts`；测试 `webui/server/__tests__/display-snapshot.test.ts` 和 `display-invalidation.test.ts`。

1. 新增 unverified × pending、同 key 并发、不同 key 并发、构建中对账失效、回滚中请求的组合测试；现 HEAD 至少 pending/并发用例失败。
2. 按 Spec §3.2 恢复 unverified → `503 DISPLAY_SNAPSHOT_BUSY` / `Retry-After: 1`，恢复对账后才提供快照；不保留未经批准的 bypass 替代语义。
3. 已开始构建在返回前再次验证对账状态、pending 和完整版本；无法确认就明确 busy，不返回或 publish 旧/部分内容。保留≤3次版本重试、≤4构建、合并、失败清理和 backoff。
4. 真路由分别验证 sources / agents 的 busy envelope；忙时不给成功数据，reconciler 恢复后返回完整最新数据，close/reset 不留下任务。

验收：pending 或 unverified 状态无成功 payload；任意组合 max inflight≤4；取消/失败最终归零；可重试的 busy 不绕过 RequireAuth。验证 SC-03/04/05/13/15，不降低已有对账窗口。

### R2 — 所有受保护请求统一账户与 401 边界

修改 `webui/src/lib/apiClient.ts`、必要的 `auth.tsx`；测试 `webui/src/__tests__/display-query-isolation.test.tsx` / `api-client-abort.test.ts`，巡检其他直接 fetch 的受保护消费点。

1. 给 GET/POST/PUT/PATCH/DELETE 共用的返回路径加 startedAuthEpoch → 当前 epoch 校验；如支持 signal，向 fetch 透传。正常响应、错误响应和 JSON 读取后的返回都不能落入旧账户消费流程。
2. 只有当前 epoch 的受保护 `AUTH_REQUIRED` 401 才触发现有取消/清理/重新认证逻辑。旧账户 401 不得登出新账户；登录失败和公开 Help/branding 沿用既有语义。其他认证错误按现有 auth 契约处理，403 保留权限错误语义。
3. 参数化五方法测试：logout、A→B、fetch 忽略 abort、延迟 response.json、当前/旧账户 401；POST test、preview 和 Token 创建结果作为实际消费回归入口。不得把 ApiSuccess 或空数据当作取消结果。

验收：旧 epoch 每种方法均拒绝，旧 Token/preview/test 结果与旧 Toast 不出现；当前受保护 401 立即清缓存，旧 401 不伤害新会话；mutation 网络提交次数仍为 1。

### R3 — 生效状态随 runtime 更新，并显示未确认提示

修改 `webui/server/proxy/acl.ts` 的只读诊断接线、`admin/permission-display.ts`、`index.ts`、`admin/agents.ts`、`src/lib/types.ts`、`src/pages/Catalog.tsx` / `src/pages/admin/AgentList.tsx`。新增 `webui/server/__tests__/display-permission-runtime.test.ts`；补 `catalog-loading.test.tsx` / Agent 列表测试。

1. 为缓存依赖加入只读 runtime 状态指纹（policyVersion、关键 digest/classifier 与 global/agent degradation），或将 consistency 从文件派生 payload 分离，在返回边界根据缓存输入摘要和当前 runtime 计算。选一种方案并写明版本/竞态处理；不能让 hot read 调 policy commit、重读权限文件或重建 source map。
2. 更新来源整个响应 meta 版本，使 consistency 状态变化不继续复用旧版本；Agent 含审计统计的完整响应不能标成 immutable，也不能整包长缓存。
3. 真实 `/api/sources` 与 `/api/admin/agents` 测试：无文件变更下 unconfirmed→matched、matched→degraded/unconfirmed、恢复；增加热命中与构建中 runtime 变化。固定原编译输入，断言列表/计数不污染实际 authorizeAndRewrite / policy readiness。
4. 两页面消费 `meta.runtimeConsistency`，为 unconfirmed 显示“权限生效状态待确认”；未知计数仍用既有状态表达，不冒充确定 0 或生效政策。提示不能靠触发 commit 自我消失。

验收：下一响应反映当前生效状态；相应 UI 提示存在，matched 恢复正确；热请求保持单次批量解析成果与 PERF-06；展示读不得更改运行时状态。

### R4 — 写开始立即阻止陈旧动作，分清取消原因

修改 `apiClient.ts`、`displayQueryOptions.ts`、`App.tsx::DisplayWriteSync` 和实际依赖展示事实的动作消费点；补 `display-query-isolation.test.tsx`、`catalog-loading.test.tsx`。

1. 增加按 affected scope 计数的 begin/settled 状态通知（嵌套、并发写不能被先完成的请求解锁）。开始时取消受影响读取并将相关事实动作置为待确认；允许保留旧内容和滚动，但动作不得继续使用旧权限/Manifest/启用范围事实。
2. 区分 auth stale / write stale。auth stale 和 abort 不重试；write stale 只能在 pending 写结束后有限重读。不得启动写中读取并把其结果视为当前完整事实；失败/回滚同样 settled 后重新读取。
3. 只有重新取得当前有效数据后才解锁。覆盖 sources 保存、enabled tables、Agent/Role/Token 变更及失败回滚；公开查询不受影响，不全局冻结无关区域。

验收：写前挂起请求、写中开始请求、两个写并行/一个失败、write settlement 与身份切换同时发生，均不能旧数据回填/提前解锁；有界读重试、mutation 不重试；三类共享 key 的消费和 invalidate 一致。

### R5 — 移除装饰请求阻塞卡片，首帧之后发探测

修改 `webui/src/pages/connections/ConnectionOverview.tsx`，必要时修改既有布局样式；补 `catalog-loading.test.tsx` 与现有 `webui/tests/e2e/specs/entry-performance-behavior.spec.ts`（已接入 performance 的 behavior runner）。

1. 删除 runtimeHoldExpired / 300ms 对卡片内容就绪的门禁。runtime notice 与 reload 时间分别保留稳定占位/布局，慢响应、错误、后台更新不得隐藏 project 已就绪卡片或移动整列。
2. probesArmed 以真实主卡片 commit 为条件，安排首次可见绘制之后发自动 test/live 意图；记录测试可见的 commit/paint/请求时序，不靠猜定时器。仍遵守 sources 未知时的 Manifest 主动作限制。
3. 将 runtime status、reload history 分别延迟 3秒、返回错误；project 立即完成；sources 另做慢/失败组合，验证卡片身份及时可用且相关动作只在事实就绪后可用。

验收：装饰慢时不再额外等待300ms；test/live requestStart 在卡片 commit/绘制之后；慢装饰/3秒慢卡/完成后的更新全过程 CLS≤0.05，不出现整页 loading，Spec163/164 布局、提示与下一步行为保留。

### R6 — 正式验收拒绝缺证据，并测真实完成

修改 `webui/scripts/entry-performance.mts`、`webui/tests/performance/entry-performance.spec.ts`、相关 fixture/server hooks；补 `scripts/__tests__/entry-performance.test.ts`。

1. 区分 formal vs smoke/partial 结果。正式 `after + all + ≥30 iterations + ≥5 warmup` 必须列举 Spec §8.1 的预期场景×路由×指标，不得由实际 summary 推导应测集合。缺场景/路由/指标、null/非有限值、n<30、采集失败、behavior 未执行/跳过、必需资产缺失均为 incomplete/failed，正式出口非零。smoke 可运行且标 partial，不能宣称 Spec 全通过。
2. 用负向测试证明：空 summary、缺一路由、单样本、全 null、缺 JS/CSS 信息或未知必需 JS/CSS dist resource、缺 behavior 时不能 formal pass；warmup 不计 n，失败样本不能被过滤。PERF-08 的 JS/CSS 最大值各自独立取所有样本最大，不能像当前 initialAssetBudget 只选择 JS+CSS 合计最大的一个样本，遗漏另一条样本单项超标。不要只断言预算函数返回数组。
3. primary-ready 使用 baseline/after 相同真实 DOM+数据+enabled 动作谓词：connections 检查各项 Manifest/启用范围统计；catalog 检查真实范围树、预期行集合与计数；overview 检查关键模块真实状态及可用主控件；agents 检查真实列表、统计及筛选。有效未知/错误状态可用于功能回归，但不能将未完成 fixture 数据当成性能就绪。
4. catalog filter 用 fixture 独立预期计算器/已知表集合断言输入关键词、显示行 ID 和结果计数确实更新，再记录双 rAF 完成；原 count 节点存在不是完成。故意禁用筛选逻辑或延迟更新的负向控制须失败，保留 columnNames 字段匹配。
5. probe-load 对每样本记录7个 health +7个 live 自动意图；导航计时前确认意图已发且探测仍在排队/运行。对 live 成功缓存以 fixture-only IPC 清理或明确记录 cache hit，并确保本场景确实执行所需50ms任务；不用生产 reset API。选取当前 trace 可看到14请求，这不代替逐样本执行/负载断言。
6. PERF-09 覆盖慢探测、runtime/reload 延迟及其结束更新，不能在后台更新前停止观察。PERF-10 保留规定的渲染/导航/字段搜索 trace，任务归因和观察窗口随原始记录输出；将慢场景 CLS 纳入正式门禁。
7. 先修 runner，再在原 baseline `8dd210a` 独立 checkout 用同版本兼容 runner 重新采集，在修正 HEAD 采集 after；不改旧证据，不直接使用旧弱谓词的 after 作为最终复验。保持匿名 fixture 内容/audit digest、时钟、生产资源及 cold reset 合同一致。

验收：全部负向控制被正式入口拒绝；新的共同谓词下，各规定场景/路由≥30有效正式样本，5次 warmup；PERF-01–10 原门槛不变；results/samples/traces/环境/源码与 dirty diff 摘要可复核。

### R7 — 回滚、写失败与根隔离证据闭环

补 `server/__tests__/display-invalidation.test.ts`、`display-snapshot.test.ts`，可新建独立 fixture integration 文件；更新18项失效矩阵、IMPLEMENTATION_NOTES、Spec/WO 状态和索引。

1. import 确认写、createConnection 失败及 rollbackWrittenConnection、Agent writeAccessYaml 与 access-config writeAccessYaml 两套 runtimeAck=false 回滚、enabled-tables 的 ktx/policy 回滚分别注入故障。在 write/truncate→commit→rollback 不同阶段发真实展示 HTTP 请求；明确故障恢复前读取为等待或 busy，恢复后版本与内容属于最终磁盘状态，不得返回中间版本。
2. 覆盖写成功后 audit 失败、dryRun、同 mtime/size 外部改写、atomic rename、override access 不一致、contentRoot/projectRoot 切换。单实例不要求两个生产项目并行服务；在同进程缓存函数交错调用/顺序切根 fixture 检查旧结果不串用和 close 清理即可。
3. 既有全 server / tsc / selector 失败用同环境、显式匿名 fixture/root、相同依赖对 baseline 与 after 逐项对照，保存测试全名/错误摘要/退出码；尤其解释38 vs37的一例环境差异。禁止读取本机私有库验证报告，禁止按失败总数宣称无新增。
4. 矩阵新增“hook 存在 / 行为通过 / 未覆盖 / 失败”区分；共用包装不能自动等价分支通过。按本单证据修正所有完成声明，不删除原成绩和历史报告。

验收：SC-04/05/13/15/16/18 对应实际分支证据齐全；原 Spec168/170/172/173 回归保持；每项残余失败有可复核归因，新增回归为0，否则不关单。

## 核心流程（Normative）

```text
display snapshot return:
  auth hook succeeds
  reconciler unverified => retryable busy (no payload)
  await affected pending writes within existing deadline, timeout => busy
  capture full scope / input version; attach or build under cap
  before response: verification + pending + captured version still valid?
    yes => publish/return
    no => bounded retry or busy; never return obsolete/partial payload

protected client response:
  capture authEpoch before dispatch
  after reading response: epoch mismatch => reject (no data/Toast, no retry)
  current protected 401 => clear protected queries / auth state
  affected write pending or epoch mismatch => reject/defer bounded read
  settle all overlapping writes => invalidate; fresh data restores actions

formal acceptance:
  enumerate expected contract cells, independent of measured summary
  require all cells, finite metrics, n>=30, warmup>=5, behavior, assets
  evaluate original thresholds and real DOM/action completion
  missing/failed cell => nonzero + explicit reason, never empty-pass
```

## 执行命令与交付

在仓库根执行（stock macOS bash 3.2 兼容；不要用真实项目配置创建 fixture）：

```bash
git branch --show-current
git status --short
npm --prefix webui test -- server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/admin-permission-batch.test.ts src/__tests__/display-query-isolation.test.tsx scripts/__tests__/entry-performance.test.ts
npm --prefix webui test -- server/__tests__/display-permission-runtime.test.ts
npm --prefix webui test -- src/__tests__/catalog-loading.test.tsx src/__tests__/api-client-abort.test.ts
npm --prefix webui run lint:terminology
npm --prefix webui run lint:ia-boundary
npm --prefix webui run build
```

第一条必须为 lucy-v2.0；保留用户已有更改。新回归先红后绿；新文件加入 runner/CI 对应路径。接着运行原 WO T6 的既有契约回归和同环境失败对照，不在本单复制容易过期的整套清单。

最终采集（baseline 指向独立基线 checkout；新 runner 若新增 formal flag，同步下述命令）：

```bash
npm --prefix webui run perf:entry -- --phase baseline --mode production --scenario all --iterations 30 --warmup 5 --output inbox/webui-entry-perf/baseline-review-v2
npm --prefix webui run perf:entry -- --phase after --mode production --scenario all --iterations 30 --warmup 5 --baseline-dir inbox/webui-entry-perf/baseline-review-v2 --output inbox/webui-entry-perf/after-review-v2
```

baseline 第一条在基线 checkout 的仓库根运行；after 第二条必须使用实际生成 baseline 目录的绝对路径，不能误指另一个 checkout 中的同名空目录。原 baseline/after 保留。baseline 超预算允许，采集失败非零；after 完整通过才可退出0并标 formal pass。

提交修正代码、正式回归测试、矩阵、报告和索引；inbox 证据按治理不入 Git，在执行报告中列证据路径/hash与命令退出码。IMPLEMENTATION_NOTES 新增“审阅修正与复验”章节，对 R1–R7 逐项填写提交/hash、测试名、结果及仍未部署的范围。每项未通过必须保留 pending/failed，不能把共用实现、局部单测或 smoke 退出0写成全验收通过。

## Terminology Compliance

沿用 Spec174 与 DS00 术语，使用“权限生效状态待确认”“页面数据暂时无法完成刷新，请稍后重试。”及现有未知计数状态。路径、对象名、英文专业词保持现有翻译防御；不引入新产品概念。修正提示、测试断言和文档均运行术语检查。

## 可复制给 Cursor 的提示

```text
在 lucy-v2.0 分支执行 webui/docs/plans/wo-20261013-webui-entry-performance-REVIEW-FIX.md。
先读 AGENTS.md、docs/governance/DEVELOPMENT.md、Spec174 v1.2、原实施报告和本修正工单。
审阅基线是8e4a461；先确认当前HEAD和用户更改，不reset/stash apply。
按R1–R7先补失败回归，再修最小实现、逐项验证和提交。
重点：unverified不绕写屏障；所有方法拒绝旧账户响应；runtimeConsistency跟随运行时且UI提示；
写开始清理陈旧动作；project卡片不等待装饰；正式性能门禁拒绝缺证据并验证真实筛选/操作完成；
补两套access/ktx/创建失败回滚的实际HTTP竞态测试。
保留权限算法和Spec163/164/168/170/172/173，禁止通过降低预算、删字段、仅显示骨架过门禁。
桌面Chromium生产构建，用同一修正runner重采baseline/after，每情景每路由30样本、5 warmup，
全部SC/PERF复验及文档证据完成才能关单。不要部署目标IP，不修改真实配置/secret或KTX源码。
最终提交修正代码、测试、矩阵及报告，逐项列R1–R7证据、命令退出码、未通过项和部署范围。
```
