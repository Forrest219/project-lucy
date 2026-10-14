# Spec 174 修正复核与下一步计划

**Goal:** 关闭 R3、R4、R6 的剩余边界，并将匿名 fixture 通过与目标环境验收区分清楚。

**Architecture:** 保留已通过的快照屏障、统一账户校验、运行时隔离和首帧后探测；在最终响应、实际操作入口及完整筛选过程补齐验证。

**Tech Stack:** Fastify / React / TanStack Query / Vitest / Playwright Chromium / production build。

| 字段 | 内容 |
|---|---|
| 日期 / 审阅者 | 2026-10-14 / Codex |
| 审阅对象 | lucy-v2.0，`8e4a461..935db80` |
| 权威合同 | [Spec174 v1.2](../174-webui-entry-performance-spec.md)、[REVIEW-FIX](wo-20261013-webui-entry-performance-REVIEW-FIX.md) |
| 执行报告 | [IMPLEMENTATION_NOTES §9](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md#9-审阅修正与复验r1r72026-10-13) |
| 结论 | 2026-10-14由Codex亲自完成A/B/C收尾；200项综合、1047项前端及完整after-review-v3正式验收通过，见[执行报告§10](wo-20261013-webui-entry-performance-IMPLEMENTATION_NOTES.md) |
| Git 复核基线 | 工作区起初干净；本地 HEAD、origin tracking ref 与 `git ls-remote origin refs/heads/lucy-v2.0` 均为 `935db80a829324788ebc4a6afbbdcf49a1d37693`，差异0/0；无需重复推送这19个提交 |
| stash | `stash@{0}` 仍是 `7653746`（wip before pull lucy-v2.0 20261013-1529）；本复核未变更 stash |

> 下方问题、反例和任务顺序保留为本次执行的历史依据；A/B/C现在均已关闭。目标环境验证和其他已登记未覆盖事项仍待后续实施。

## 复核结果

| 项 | 判定 | 证据 / 限制 |
|---|---|---|
| R1 | 核心通过 | unverified 明确 busy，缓存验证与构建后检查、上限4、事务屏障、恢复及鉴权组合测试通过 |
| R2 | 核心通过 | 五种 API 方法共用 authEpoch / 当前账户401处理；旧 Token 结果与旧错误不回填。Wiki / Eval 下载直连的已登记例外不纳入“全请求已隔离”宣传 |
| R3 | 待收尾 A | sources 热缓存返回时计算 consistency 已正确；Agent 列表在统计异步等待之前计算，存在返回过期 matched 的竞态 |
| R4 | 待收尾 B | pending计数、旧读拒绝、最后写结算、连接页 Manifest 动作门禁通过；Catalog 未消费 pending facts，仍能点击旧启用状态生成的编辑入口 |
| R5 | 核心通过 | 300ms门禁已删除，双rAF后探测，慢装饰与布局稳定测试及新的CLS样本通过；提示加载失败组合、不可见占位的取舍已登记 |
| R6 | 待收尾 C | 正式场景枚举、30样本、缺证据拒绝、真实DOM/筛选、实际探测负载已有明显改进；筛选长任务观察窗口不覆盖输入全过程，缺少筛选trace |
| R7 | 核心通过，有已登记未覆盖 | import / create失败 / 两套access回滚 / audit失败真实HTTP测试通过；同环境baseline/after 37个server失败列表一致。不能将未覆盖分支写成行为通过 |

本复核重新运行11个相关测试文件，**190/190通过，退出0**；另增加两个隔离反例测试，均在当前HEAD出现预期失败，证明A/B尚存。没有修改应用实现或既有正式测试。没有重跑完整30样本浏览器基准；以下性能结论来自原始证据重查。

`baseline-review-v2` / `after-review-v2` 各980条记录（含warmup），28个计时场景/路由各30条正式样本，采集失败0。after `acceptance.formal=true,status=pass`，11个behavior通过，跳过/重试失败/trace秘密扫描异常均0；22份trace。两轮fixture content hash同为 `5dc0cd88617da5a60b7db82a61871d50897eac6660907edb909740b601e2ac3d`。

| 当前fixture证据 | 数值 / 范围 |
|---|---:|
| 四页browser-cold primary P95 | 108 / 112 / 116 / 118ms |
| probe-load下catalog / overview / agents P95 | 330 / 357 / 347ms（预算500ms） |
| sources / agents 热HTTP P95 | 0.66 / 9.6ms |
| 全部已测CLS最大值 | 约0.0203（预算0.05） |

报告hash与文件一致：baseline results `f5d0f3dac76ca9da`、samples `129c89034fc92dbd`；after results `7fb5b6d6b24cd179`、samples `3d0012bbb883e598`。after采样代码是`fe00d78`，到`935db80`仅变更文档，代码对应当前HEAD。上述数字足以支持匿名fixture的显著改善，不能替代目标IP、真实网络、客户amd64/Kubernetes性能验收，也不能补足C项缺失的筛选trace。

## 三处需要关闭的问题

### A / P2 — Agent consistency 必须在统计等待之后计算

定位：`webui/server/admin/agents.ts:995`、`:1205`、`:1238`（935db80行号）。`agentPermissionSection`计算runtimeConsistency后，`buildAgentList`还要await审计统计；runtime在此期间变化不一定触发文件P代次变更，最终响应继续复用旧字段。

隔离反例：先缓存matched，挂起`getAuditDb`以模拟正常统计等待，再清除已提交runtime状态，释放统计。真实`GET /api/admin/agents`返回：

```json
{"case":"agent-late-runtime","actualPolicyVersion":"","returned":"matched"}
```

复现沿用项目既有`resetEffectivePolicyForTests`模拟runtime-only状态变化，不声称生产中调用测试reset，更不代表实际授权绕过。临时测试/日志：`inbox/spec174-late-runtime.test.ts`、`inbox/spec174-late-runtime-proof.log`；退出1，断言expected unconfirmed，received matched。

修正任务：

1. 将缓存section输出保留为previews、permissionsState、policyInputs和基础snapshot版本；不提前固定最终consistency。
2. 完成统计与summary后，在最终响应构造处用当前只读runtime计算consistency及对应meta.snapshotVersion，中间不再await；保留现有access代次检查。
3. 在正式`display-permission-runtime.test.ts`新增挂起统计期间matched→unconfirmed及反向恢复两例；assert响应字段/版本、缓存构建次数及runtime状态，禁止读时policy commit或重建source map。

验收：这两个方向的变化反映在同一请求的最终响应中；P95热Agent HTTP仍≤200ms，sources路径不回归。

### B / P2 — Catalog 仍可使用写前事实执行入口

定位：`webui/src/pages/Catalog.tsx:470`。`useDisplayFactsPending`仅在ConnectionOverview消费，Catalog仍直接根据缓存的`table.enabled`选择编辑或启用范围入口。

隔离反例：缓存orders为enabled，开始真实apiPut enabled-tables并挂起，渲染Catalog后实际点击编辑链接：

```json
{"case":"catalog-write-pending","pending":true,"href":"/catalog/perf-conn/sales/orders","disabled":null}
{"case":"catalog-write-pending-click","path":"/catalog/perf-conn/sales/orders"}
```

临时测试/日志：`inbox/spec174-catalog-pending.test.ts`、`inbox/spec174-catalog-pending-proof.log`；退出1，期望留在/catalog，实际进入旧事实生成的编辑路径。这是客户端事实/动作门禁遗漏，服务端实际授权仍负责真实裁决。

修正任务：

1. Catalog接入sources facts pending；保留搜索、筛选、旧内容和滚动，但编辑/启用等依赖启用范围、Manifest事实的行操作在pending或awaitingFreshRead时不可触发。检查主链接、更多操作和空态入口，避免只加aria-disabled仍可点击。
2. 同步巡检其他project/agents事实动作消费点；只锁实际依赖的操作，不冻结公开导航或无关控件。
3. 在`catalog-loading.test.tsx`追加用户点击级回归：写中、写成功但fresh read未完成、写失败/回滚但fresh read未完成、并行写先完成一项、fresh read失败；只有最后一次有效读取应用后恢复正确入口。

验收：上述状态不进入旧事实选择的路径、不发旧事实驱动的mutation；新响应确认disabled/enabled后使用正确入口，背景更新保留内容与滚动。

### C / P2 — 筛选长任务窗口与trace未闭环

定位：`webui/tests/performance/entry-performance.spec.ts:372–392`。80ms逐字符输入后取最后keydown时间，观察起点为`lastInput-200ms`；sales的输入跨度约320ms，region约400ms，前120/200ms可能未进入长任务统计。现有22个trace不含catalog-filter；`route-warm-catalog.json`的maybeTrace只包导航，在随后筛选之前结束。

不能据此声称实际发生长任务，但当前证据无法完整证明PERF-10筛选全过程。真实筛选完成谓词的修复有效，80ms输入节奏已如实记录；两者不替代完整窗口和trace。

修正任务：

1. 分离filter latency时钟与long-task观察窗口：保留最后输入→完成绘制的filterMs，但long-task窗口从本次第一个输入之前开始，到真实行集合/计数更新后的绘制与观察结束。
2. 用maybeTrace分别记录路径词与字段名词的至少一个正式样本，覆盖整个键入/筛选/绘制过程；保留秘密扫描。正式验收检查这些trace存在且可解析，不仅检查文件夹非空。
3. 加负向控制：仅在第一个按键处理时制造≥60ms业务长任务，后续按键正常；PERF-10必须失败。禁用筛选/延迟更新的现有负向控制继续保留。
4. baseline/after使用同版本修正runner，对route-warm与catalog-filter重新各30样本、5warmup；作为补充证据不混进既有P95。最终关单前再跑一次all formal after以覆盖A/B代码变更，旧证据与失败尝试全部保留。

验收：输入全过程被观测，早期长任务不能漏过；两类筛选trace齐全；完整after按原PERF预算pass。

## 下一步顺序

1. **先关闭A/B/C。** Cursor基于935db80小步修正，每项先补红测试再绿；无需重新实施已通过R1/R2/R5的架构。正式回归纳入现有测试文件，不依赖inbox反例脚本长期存在。
2. **归档可复核证据。** 更新IMPLEMENTATION_NOTES新增“2026-10-14复核闭环”章节，逐项填测试/提交/正式采样命令/退出码/hash；登记新增筛选trace，恢复Spec/WO完成状态前确认所有上述条件。既有37个server、88个tsc及33个selector问题保持独立归因，不宣称全仓测试全绿。
3. **按实际远端状态交付新提交。** 此次19个提交远端已存在；仅对后续修正提交进行正常review/push。保留stash，不reset或force push；发布候选固定commit和镜像digest。
4. **进入目标环境验证。** 先通过现有发布流程安排测试版本，核对环境/版本与回滚方式，再对桌面浏览器真实登录、冷资源刷新、四页回访、慢探测、写后更新及账户切换采样。报告区分密码提交与登录成功→主内容，至少30样本并分别列P95、失败数、CLS和长任务；不将M4回环成绩宣传成内网服务实测。
5. **客户交付阶段遵守amd64/Kubernetes门禁。** 如准备客户镜像，依既有amd64离线交付Spec通过G1–G4（含实际ELF检查），使用约定builder且不改变本机默认builder；以Helm Chart为客户部署形态。本复核未执行构建或部署。

后续独立事项：搜索框高速输入丢字符已被报告登记，另列输入体验缺陷单，覆盖快速键入、粘贴和中文输入法；与本单三项收尾分开。失效矩阵中其他未覆盖分支按风险补测，不把“hook存在”当“行为通过”。

## 可执行验证入口

仓库根：

```bash
npm --prefix webui test -- server/__tests__/display-permission-runtime.test.ts src/__tests__/catalog-loading.test.tsx scripts/__tests__/entry-performance.test.ts
npm --prefix webui test -- server/__tests__/display-snapshot.test.ts server/__tests__/display-invalidation.test.ts server/__tests__/display-rollback-races.test.ts server/__tests__/admin-permission-batch.test.ts src/__tests__/api-client-abort.test.ts src/__tests__/display-query-isolation.test.tsx src/__tests__/agent-list.test.tsx src/__tests__/new-token.test.tsx
npm --prefix webui run lint:terminology
npm --prefix webui run lint:ia-boundary
npm --prefix webui run build
```

沿用REVIEW-FIX的生产基准命令，但输出到新的独立目录（如`baseline-review-v3` / `after-review-v3`），baseline仍为独立8dd210a checkout +共同runner，after使用baseline目录绝对路径。不得覆盖review-v2、降低预算或将smoke partial当formal pass。本文件是计划，本次未实施应用修正、提交、推送或部署。

## Terminology Compliance

沿用Spec174与DS00，不新增产品概念；使用既有“权限生效状态待确认”、未知计数与局部待确认表现。路径、对象名和专业英文节点保留翻译防御。
