# 正常语义写入期间 MCP 读取有界等待 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能 Spec / v1.0 |
| 功能编号／优先级 | P1-70／REQ-030-091；不入核心分母 |
| 台账号 | 无 |
| 日期 | 2026-11-20 |
| 状态 | v1.0。Codex CLI终稿确权及代码终审通过；增量开发授权已获得；功能合同收口（本机自动化与真实Docker）；远端CI未执行；30分钟组合结果独立登记；不入核心分母；≠ 整套UAT PASS；≠ 可上线。 |
| 授权 | 本轮委托人选择“批准补充合同并修复”；运行实现仍以本终稿通过 Codex CLI 确权为前置 |
| 配对 Plan | [同名 Plan](../plans/lucy-20261120-semantic-read-write-settle-plan.md) |
| 需求／测试入口 | [0.30总账](../plans/lucy-20261107-lucy-0-30-feature-inventory-pool.md)；[测试台](../qa/uat/INDEX.md)；core-availability F70 |

## 闭口层级

- 层级：功能合同
- 本条承诺：正常Manifest真实写／镜像期间，三个具名普通MCP读取在固定20秒资格及原更紧截止内等待，权威重查后单次执行；真实故障／未知恢复与授权收紧继续失败关闭。
- 本条出口：SC-01–07所需局部真实目录／HTTP／MCP、真实写阶段、deadline、权限／TERM及同身份补偿证据；SC-08记录新候选组合复验依赖与真实结果，不把整套发布旅程纳入本功能合同。
- 不在本条出口：全系统Agent旅程、任意发布入口全覆盖、多副本、客户交付拓扑、全部故障演练、整库R-CAV或可上线结论。30分钟组合按测试台独立登记，不替代本条各SC。
- 上线关系：**本条收口不表示可上线**。

## 目标与边界

正常 Manifest 上传实际写入时，涉及资产的已受理纯 MCP 读取可在固定上限内等待真实写／镜像阶段结束，再重新核验权威状态，原问题首次执行一次。故障、未知状态和授权收紧继续失败关闭，不能以安全门禁已生效代替合法用户可用。

首期只覆盖同进程、同项目、现有 publish-coordinator 正常 `manifest_upload` owner 绑定的 WAL，以及普通 `lucy_query`、`lucy_read_source`、`lucy_explain_query` 读取。其他写入口、Report Runner、认证路由／报表模板派生查询、多副本、外部 CLI/Git 写者和新交付形态不在本条新增等待范围；沿原门禁，未覆盖项留 GAP。不得从一个写入口通过推定全部发布入口通过。

不新增控制器、公开 API、日志产品或 SQL 自动重放；不修改 KTX 上游。本条与 [P1-69](lucy-20261120-runtime-reload-drain-spec.md) 的执行层 reload 立即拒绝／短在途保全并存，不将恢复错误豁免为 reload 503。

## 触发证据与已有合同

2026-11-20 r4 短校准，固定 SOURCE 查询 mcp-11 在 09:52:03.429793 UTC 发起，09:52:10.784450 返回 HTTP200、`result.isError=true`、`semantic_recovery_required`。正常 cycle-1 Manifest upload 服务端受理为 09:52:09.801，最终 09:52:15.994 正常成功；整个 `_schema/uat.yaml` 原子替换包含查询 SOURCE，虽然业务变更只改另一张表短名。夹具没有注入错误 recovery 状态。

上传回执 `record.createdAt=09:52:12.406` 位于 mirror 返回后，静态 reloadCatalog 为 12.406–12.552；本周期真正 reload owner 22.580 才 acquire。此次读取拒绝早于静态 reload 与 reload owner，不能按 P1-69 SC-03 豁免。未采集每个实际 rename/mirror 时间和 journal ID，不能推断该次已发生于“写完后延迟推进 phase”的冗余段。

原始证据：`inbox/core-availability-followup/20261120-execution/01-tools/calibration-r4-contract/` 的 events.jsonl:747／816／854／920、candidate/soak-query-11.json、cycle-1-upload.json、final-container-log.json:603／653／713／813；该 run 的 FAIL 保留。诊断与差集过程材料在同工程包 `01-tools/r4-semantic-recovery-diagnosis.*`、`10-semantic-read-delta/proposal.md`，不代替本 Spec 合同。

| 现行依据 | 原义务 | 本条处理 |
|---|---|---|
| [L25-11 §7.1／7.2](lucy-20261020-v2p5-semantic-batch-operations-spec.md) | 共享写窗口；WAL 先于正式写；全部写入后 files_saved，终结证据齐全才 completed；不确定内容涉及读取关闭 | 原 guard 不松；正常活跃写可等待后再查，并不把 write_in_progress 直接允许 |
| semantic-recovery-journal.ts phase／D3 回归 | open/write_in_progress 阻断；files_saved 仍 open，索引未确认不代表未保存；未知／故障保守关闭 | 保留全部 phase、hint、同连接和故障断言 |
| P1-69／P1-63 | reload 等真实 MCP settle；TERM 不可逆优先；新 RPC 明确拒绝；20／60 与整实例20／40／45预算 | 不重置、不扩大、不自等；等待者维持原真实 MCP 票据 |
| Spec162／预算现行实现 | 单票据真实时间结算、稳定身份作用域、durable fail-closed；120秒单调用绝对限额；300秒墙钟／busy按模式 | 不移动 consume 顺序、不再 consume、不退还伪造时间、不改默认模式或常量 |

新增差集是正常真实写 owner 的读取等待资格、固定20秒等待截止、重新核验与纯 MCP 恢复；旧合同未承诺正常维护期全读取同瞬时版本或零拒绝。新增阶段需要本条确权，不能凭 L25-11 恢复安全合同默认实施。

## 决策一：真实 owner、WAL 绑定与实际终态

1. 使用现有 publish-coordinator 实际 holder 对象／operationId，不另造平行 controller。绑定必须同时核对 projectRoot、holder 对象身份、holder.operationId、journalId、releaseId 与登记的目标。Manifest 的 WAL.operationId 当前等于 releaseId，而 coordinator.operationId 可为另一 UUID，不能靠二者字符串相同、PID 存活、文件存在或时间窗口猜绑定。
2. **WAL 首次持久化之前完成同步绑定。** 推荐 `createRecoveryJournal` 增补内部可选 `onBeforePersist(journal)` 同步回调：真实 journalId 已构造、尚未 write/rename WAL 时，写 owner 在现 coordinator 上登记实际阶段 Promise。回调失败则不写 WAL、不做目标效果；不允许 await create 完才 bind 的短暂假孤儿窗口。既有调用者不登记即不获新增等待资格。
3. 读者可等待的阶段仅为本次全部正式目标写入、必要镜像完成且按计划核验、files_saved 已真实持久化，或者该阶段失败并已进入可读的真实恢复／待修复事实。**不是整个发布窗口、reload、索引或最终审计结束。** 正常 `completed`、权限 current、执行配置已加载都不得由这个阶段 Promise 推定。
4. writer 自己推动真实阶段；读者、超时 timer、finally 不得伪造写完成。真实异步写／镜像未 settle，登记不能提前退；写失败需沿原恢复合同结清或留失败关闭事实。读者等待截止只取消读者，不取消真实写／镜像，也不释放 writer 锁／slot。阶段 Promise 的 rejection 必须被处理，不能未处理异常或永久悬挂。
5. 等待资格限所有命中阻断日志都可证明同进程正常活跃 `manifest_upload` 阶段。孤儿、旧格式无绑定、损坏、无法命名、不可读、`recovery_required`、失败或未知 owner 原样失败关闭。登记先于 WAL 的窗口对读者没有放行作用：原 guard 无 block 时仍按原路径；owner 元数据不能替代 WAL 权威。
6. 固定首次命中的 owner／journal 集合；后继 owner 不续接、不重置时间。醒来重读全量 WAL，新出现的阻断继续原拒绝。实际阶段结束后清理自己的登记，迟到回执不得影响新 owner。测试复位仅清理专属测试实例。

### 真实阶段的有界工程取证

同进程私有绑定不能由另一Node进程导入Map证明。允许复用stdout低频工程事件，固定前缀`[lucy-semantic-write]`和JSON，不新建公开API、查询页面或日志产品（不扩P1-68范围）。writer每owner至多`registered`和一个实际`files_saved`/`failed`事件；每实际等待RPC至多`read_wait_begin`/`read_wait_end`两条，不逐轮轮询记录。

writer事件字段为`event`、现holderOperationId、journalId、releaseId、atMs（Unix epoch毫秒）、monoMs（本进程单调毫秒）；registered在真实同步绑定之后、首次WAL发布之前，files_saved仅在写/mirror/digest及phase持久完成之后，failed仅在实际阶段终止之后。reader事件额外含唯一原server ingress.operationId、原rpcId、固定owner/journal集合、waitDeadlineMonoMs；endOutcome仅为`owner_settled`/`timeout`/`cancelled`/`term`/`authorization_revoked`/`blocked`，`owner_settled`仅表示进入权威重查，不等于SQL成功。

不记录Token、问句、SQL、DSN、原YAML或凭据。无等待的普通请求不新增这些事件。真实driver保存原始容器日志，用精确ID证明registered→begin→真实stage终态→end，再和该RPC回执、MySQL实际业务SQL、原预算/审计关联；不能只靠宽泛响应窗口。缺绑定/阶段证据留FAIL或GAP，不用此工程日志替代durable业务审计。

## 决策二：准确截止、计费与取消

**固定等待上限20秒，自本 RPC 服务端入口同步记录的单调时间计时。** 这只是新增等待资格的截止，包含本请求前置处理耗时；不是把整个 RPC 变为20秒超时，不延长本来无需等待的请求。入口过了20秒才遇到阻断日志则不再等待，沿原错误拒绝。

建议内部 `SemanticReadWaitContext` 由 MCP createServer 回调在首次 await 之前创建，`ingressMonoMs=questionBudget.monoNow()`、`waitDeadlineMonoMs=ingressMonoMs+20_000`。只通过内部参数传入 handlePost／handlePostTraced，不接受客户端任意 header 宣称deadline。若已有可信内部更紧绝对截止则仅取 min；当前生产**不存在端到端30秒总截止**。

预算成功 consumePersisted 后仅保存原 ticket，并读取 `questionBudget.snapshotScope(ticket.scopeKey)` 的已装载 committed state：

- 单调用绝对截止是 `ticket.startMonoMs + QUESTION_BUDGET_ABS_EXEC_MS`，现值120000；不能从等待或醒来时重算120秒。
- `questionBudgetWallMode()==='elapsed'` 时，现行 MAX_WALL=300000 的基线是 `state.startedAt`。在取得 ticket 时以同次时钟样本换算 `wallDeadlineMono = monoNow + max(0, state.startedAt + MAX_WALL - Date.now())`；后续只收紧。不用 originStartedAt 代替，不重新开启窗口。
- 默认 settled 模式按 `busyMs` 累积到 MAX_BUSY=300000，不是流逝墙钟硬截止；不凭 startedAt 发明一个300秒实时终止线，不改变原 busy 结算／后继调用裁决。calls 已被此次 consume 增加，不能重新用 calls≥max 判据拒绝合法最后一票。
- 缺 state、commitUnverified、processUnavailable、ticket 已 settled 或 scope/round/window 不匹配时不得凭空获得更长等待／执行资格。沿已有失败关闭；不能再 consume 一次补票或用新 session 重置。

有效等待截止为上述固定20秒与原真实绝对截止的 min。已有预算 timer、settle、审计顺序继续，等待计入原 ticket 真实时间；本条**不承诺等待拒绝零预算**，那是 P1-69 入口拒绝的独立合同。未启用预算时只新增这一个20秒等待阶段：没有已有端到端30秒可“继承”，也不能把20+30描述为原有总预算。

`forwardToUpstream` 当前 `ClientRequest.setTimeout(UPSTREAM_TIMEOUT_MS)` 默认30000，是创建该真实上游后的 socket inactivity timeout。它不因本次等待增大、清除或重设；不存在的上游句柄也没有可伪造的“剩余30秒”。已有真实上游句柄的原 timer 保持运行；新增等待不得重发它、不重设同一句柄的时限。终审应据此裁定“新增等待阶段但原各自限额不变”，不能声称本条无预算请求总耗时与从前完全相同。

取消通过入口私有 AbortController 接 `req.aborted` 事件／既有标志、`res.close`、现 socket `timeout` 事件；不把正常 body 读取完成时的 req.close／req.destroyed 当客户端断开，不更改 socket.setTimeout 值。handle 结束移除新增监听。已有取消／预算 onDeadline 同时收紧 context，客户端已断不发送成功或启动上游。

TERM 以 `getProcessLifecyclePhase()` 判 DRAINING／STOPPING／STOPPED；现模块无订阅 API，首期允许≤20ms异步检查并在每个阶段醒来后同步检查，不新增 process-drain controller／状态或重开 SERVING。事件循环本身被阻塞不作硬实时保证，不能因 timer 晚回调放行已过期工作。等待 timer、监听被清理只表示读者结束，writer真实阶段继续。

## 决策三：重新核验、单次执行与恢复

等待前不取得新 query slot、不发业务SQL；保留原已受理 MCP 工作票据。写阶段结束或 timer醒来后先检查真实单调截止、取消、TERM和原 authorization barrier，再重读全部 WAL。尚阻断按原 semantic 错误拒绝；正常阶段 Promise 结束本身不放行。

通过后对原始输入重新执行当前有效权限／对象解析／查询约束与现有配置门禁，且不重复强制谓词改写、不重跑 consume、不中途更换原请求身份/问句。原 `currentBarrierHandle().isCurrent()`、`aclCheck`／`authorizeAndRewrite` 与既有发送/响应屏障保留；授权变窄立即拒绝。为避免重复预算/审计，重核验应抽取原纯裁决接缝，而非递归重进整个 handlePost。不能用旧 source map、旧 compiled policy 或 writer成功事实证明新权限／配置有效。

两处现有恢复gate必须共用本规则：早返回的本地`lucy_explain_query`分支（原mcp-proxy.ts:5831），以及执行slot前共享`lucy_query`/`lucy_read_source`等分支（原:6989）。本条不将工具语义互换：query真实执行；read_source仅授权源元数据；explain保持plan_only/执行诊断、executed:false，不执行查询SQL。

**无自等：** Manifest 写阶段的settle必须在后续静态目录重载／可能的执行层reload前完成，不能等publish整个释放。若写阶段会等待当前读取者，禁止登记该阶段为可等待。已有RPC属于reload的旧在途，按P1-69真实settle保护，不重新入场拿新票；新增RPC仍在入口被原reload屏障拒绝。

成功只执行原业务一次；截止或取消不启动SQL、不自动重试。实际 durable response gate、upstream close 和审计完成后才能退原MCP票据。等待期间失败的预算与审计按原规则记录一次，不能伪写 executed=true／query成功。

维护结束后同一合法 Token、同一 session、同一原问题可显式重试并成功，无 WebUI账号、person、宿主attestation或重启Lucy前置。原故障需要既有治理／运维修复的不能谎称问数方有权自行修复；实际修复后纯MCP原身份可成交。被吊销身份始终拒绝。不给固定恢复时刻、自动SQL重放或泛化错误豁免。

## 核心流程（伪代码）

```text
onMcpIngress():
  ctx.waitDeadlineMono = monoNow() + 20s  # 仅等待资格，不是RPC总截止
  install existing-cancel/close/socket-timeout observations
  retain original real MCP work ticket and authorization stamp
  execute original identity/ACL/budget admission exactly once
  on original budget ticket:
    tighten ctx to ticket.startMono + original ABS120s
    if elapsed mode: tighten to original state.startedAt + MAX_WALL
    # settled mode does not invent a wall-clock deadline

manifestWriter(existingHolder):
  construct journal identity
  synchronously bind holder/project/journal/release/stage BEFORE WAL persistence
  persist original WAL then perform actual atomic writes and required mirror
  verify actual target/mirror digests; persist files_saved while journal stays open
  settle this actual write stage  # not publish/reload/index/terminal stage
  continue original catalog/audit/terminal workflow with truthful saved/unconfirmed facts
  on failure: preserve recovery obligations; settle actual work only when really ended

affectedRead(ctx):
  block = original authoritative recovery guard(all journals, original asset hints)
  if blocked:
    owners = prove exact normal active Manifest owner bindings for ALL matched blockers
    if proof absent or failure/unknown/recovery_required: original denial
    await fixed original owners' actual write/mirror stage until ctx cutoff or cancellation
    # reader timeout never cancels/retires the writer; never chase successor owners
    check real cutoff + cancel + TERM + original authorization barrier
    re-read all authoritative WAL; if blocked: original denial
    recheck current permissions/semantic/config gates without another budget consume
  execute original business read once with original remaining timers/budget
  retire original MCP ticket only after actual handler/upstream/durable response gate settle
finally:
  remove only this reader's timer/listeners; never release another owner
```

## 独立既有缺陷：files_saved 阶段推进过晚

catalog-assets.ts 当前 rename→mirror→reloadCatalog→appendRecord→markFilesSaved→closeContentBatch。按 L25-11 §7.2 / phase定义，正式目标与必要镜像完成并核验后，应推进 files_saved/open，再做静态目录重载、历史／终态。**completed/confirmed 仍需所有适用证据。** 通用 mirror 的 failed=0 不等于独立摘要证明，阶段边界核对实际目标／镜像预期 digest。

这是独立阶段准确性修复，不冒充本次FAIL根因：mcp-11拒绝早于静态reload。推进失败／镜像失败仍关闭；后续reload、append或终态审计失败保留已保存事实和unconfirmed，不伪成功，也不在重启时错误回滚已完整保存内容。其失败处置须沿原合同，不趁机重写整个发布事务。

## 受影响画像

| 画像 | 判定／依据 | ↓ 补偿与验收 |
|---|---|---|
| 问数方 | 问数面从立即恢复拒绝变有界等待后首次成交，总体↑；单次最多消耗入口20秒等待资格，按最差判↓。报告面＝，未触及Report Runner/固定URL | SC-01／02／03：固定20秒和原更紧截止，同Token/session/原问题显式恢复，纯MCP可达；工具保持原metadata/plan/查询语义 |
| 治理方 | 语义口径面正常维护可用↑；后续reload可能等待原RPC结束，保存/生效确认间接延后，按最差判↓；权限授权面＝，现ACL优先，新等待不新增治理入口 | SC-02／04／05／06：20秒等待及原reload60秒不扩大、保存/生效真值分列；已保存配置无需重复提交，原状态/显式reload入口可核验恢复；页面反馈变更撤豁免验浏览器 |
| 运维方 | 运行观察面区分正常写/孤儿↑；原RPC在途和终结审计可能比立即拒绝更晚可见，按最差判↓；探针/交付运维面＝，无新拓扑或人工重启前置 | SC-02／03／06／07：有界stdout阶段见证真实开始/终止，不把等待记成功；原TERM20/40/45不延长，故障结清后原身份可达，无需重启Lucy |
| 管理层 | 口径质量面＝，不改业务指标；业务结果面真实成交↑，但完成量与审计终结相对立即拒绝最多受等待阶段延后，按最差判↓ | SC-02／08：阶段等待与终结真值区分，固定截止；自然/post-natural分母与延迟全保留，原FAIL不洗白，按已完成有效审计证据读取结果，不用待终结事实冒充业务成功 |

## 实施接口与范围

以下均为拟议私有函数，非既有公开API：

- publish-coordinator.ts：`registerPublishWriteStage(holder, {projectRoot,journalId,releaseId,targets})` 返回owner控制的 `filesSaved()`／`failed()`阶段结算句柄；`matchedActivePublishWriteStages(...)` 只读精确匹配。不扩展锁租期、不按读者超时退owner。
- semantic-recovery-journal.ts：CreateRecoveryJournalInput可选同步 `onBeforePersist(journal):void`；内部读取详细阻断 journal 集合供匹配，现 `semanticRecoveryReadBlock` 默认签名/结果与所有原断言保留。
- catalog-assets.ts：Manifest实际owner调用上述登记；真实rename／mirror／digest／files_saved后结阶段；失败真实结束后结失败。不注册权限写或其他入口。
- mcp-proxy.ts：入口创建/清理 `SemanticReadWaitContext`、ticket只读截止收紧、恢复gate共用 `awaitActiveSemanticWrite(...)`；等待后重新纯裁决，不递归重跑请求。

运行白名单仅四文件上述路径。question-experience.ts、question-budget-lifecycle.ts、process-drain.ts、index.ts、entrypoint、ResponseGate、WebUI、KTX源码为只读依赖，不默认改。需要新增文件／扩大接缝必须先报M，不用实现便利静默扩范围。

## 验收标准

| SC | 约束／先红反例 | 合法主路径／证据 |
|---|---|---|
| SC-01 | 真实目录WAL与deferred实际rename/mirror，write_in_progress不发业务SQL；原码立即拒绝先红；绑定在WAL可见前完成；早期本地explain与共享执行slot前两个gate均覆盖 | 实际owner20秒内完成、WAL权威通过：query原请求4/100、业务SQL1次；read_source正确且授权的源元数据、业务SQL0次；explain当前授权诊断/plan_only、executed:false、业务SQL0次。各工具均保持原单预算票据与各自有效审计闭包，不共用错误oracle |
| SC-02 | 入口前置耗时计入20秒；>20秒、更紧ABS剩余、elapsed MAX_WALL剩余、无budget模式均不重置；settled模式不伪造MAX_WALL；最后合法calls票不误拒 | 截止无SQL，writer未settle不假退；真实完成后同Token/session/原问题显式4/100；socket30原值/原句柄timer不变 |
| SC-03 | 孤儿／旧格式／未知绑定／PID仅存活／损坏／不可读／recovery_required／mirror或mark失败，原guard全部保留 | 实际故障结清后纯MCP原身份可达；无要求重启实例；故障与恢复各留原始回执 |
| SC-04 | deferred静态reload，实际目标/mirror/digest已完成，旧码write_in_progress先红；mark/后续终态各失败仍真值 | files_saved/open允许原guard通过但非confirmed；reload/append/终态失败不假success，重启不误回滚已保存内容 |
| SC-05 | 等待中Token吊销、权限/行约束/source-map/config代次变化；不得使用旧授权或重复注入谓词 | 当前授权仍合法原任务成交；被吊销拒绝；budget consume一次，原query/行约束/发送屏障保持 |
| SC-06 | publish→reload排空与原RPC并发不得自等；客户端body正常close不误取消；真实断开/TERM/120秒deadline阻止迟到SQL | 真实工作票据/response gate未结束不退；原20/40/45与reload20/60不扩大、TERM后不重开；正常短在途仍settle |
| SC-07 | 绑定前失败不发布WAL；写后失败真settle；旧owner迟到、第二owner/新WAL、scope/round/window不匹配不续期、不串单 | 固定原owner集合，醒来权威重查；恢复后同身份原问题成功；不会unhandled rejection/泄漏监听/释放他人登记 |
| SC-08 | 原r4 FAIL与非503失败不豁免；1883表原普通MCP5秒频率/预算/延迟门槛不放宽 | 新hash候选定向真实校准，再M串行正式30分钟/12周期；4/100、实际SQL、预算/审计闭包及完整自然分母；不代签范围外UAT |

组件用真实目录/WAL、可控deferred和时钟，不以sleep猜阶段。真实Docker用MySQL受理事实、实际KTX/owner证据，不用组件替身冒充真实验收。旧D3、Spec162、P1-69/P1-63、ResponseGate失败关闭断言全部保留。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 无新增产品术语或API码；“正常语义写入等待”仅描述后台阶段，不新增产品导航。
- 内部 owner / WAL / phase / deadline 不作为用户必须理解的操作概念。

遵守 `webui/docs/00-product-terminology-standard.md`。复用 `semantic_recovery_required`／`semantic_recovery_unreadable`，不新增API码。正常维护的有界等待不呈现“恢复故障”成功提示；等待截止保留现有错误并给可执行重试说明，准确文本须随实现测试核验。内部owner/WAL/phase/deadline不新增产品导航。用户可见DOM未新增；如后续呈现路径/英文技术标识，按术语标准加翻译防御。

## 交互合同豁免

- 原因：不改变用户可见 WebUI 表面；本条只改变纯MCP恢复准入等待与后台内部阶段。
- 不改变：保存反馈、页面状态解释、按钮／表单／导航；若实现触及这些表面，撤豁免并补真实前台浏览器＋即时计时。

## 出口与确权

M维护P1-70/REQ-030-091、Spec/Plan索引、测试台F70和e2e勾连及状态现值同句镜像。委托人已批准补合同及修复不等于终稿已确权；Codex CLI终审通过前不写运行代码。本条功能合同收口、局部真实PASS、整套30分钟UAT、可上线分别判定，未覆盖原样留GAP。


## v1.0 功能出口登记（2026-11-20）

SC-01–07的本机自动化、真实目录／HTTP与同候选Docker证据已具备，逐项见[收口复核](../reviews/2026-11-20-semantic-read-write-settle-closure-review.md)；SC-08真实30分钟组合独立严格FAIL保留。此处仅更新验收状态及证据，不修改终审后的规范行为。远端CI未执行；完整UAT／发布／客户结论未签。
