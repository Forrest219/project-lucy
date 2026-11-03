## 结论：接受进入取证

日期：2026-10-30。审阅者未参与实现，也没有把上一份退回结论当作通过依据。本环境没有 Codex CLI MCP。结论来自对当前工作区调用链的直接阅读；2026-10-27 报告里的行号不作证据。本结论不把 V01–V22 改成已执行或已通过，不关闭 G30，不在登记册里关闭 G31，不改升级建议书，不改 L25-16。

上次退回（[`2026-10-30-l25-11-uat-rereview-conclusion.md`](2026-10-30-l25-11-uat-rereview-conclusion.md)）留下的两条 H02，在当前调用链上已经收口。波次 A 的三件事仍然成立。因此复审不再挡住波次 C–E。G30、V03(d)、V22 和波次 0b 保持原状态。M01、M02 留在取证映射，它们单独不挡住这次接受。

直接测试只作对照，不代替调用链，也不关闭任何 V 项。本次没有重跑。输入里 2026-10-30 的本地结果（恢复 / 幂等 / 协调器 5 个文件 68 个通过，审计主体与展示失效 2 个文件 22 个通过）不升格为验收证据。

## H02 第一支已收口：失败记录不再是回滚的前置条件

读的是 `webui/server/semantic-assets.ts` 的 `publishSemanticAssets`，promote 循环里的 `catch`；以及它调用的 `restoreRecoveryJournal`、`markRecoveryJournalBlocked`、`appendReleaseRecord`（经 `recordPromoteFailureImpl`）、`releasePublishLock`。

单个目标写入失败时，控制流是：

1. 先 `await restore`（生产实现是 `restoreRecoveryJournal`）。日志还在时，`restoreRecoveryJournal` 在返回前就 `writeRecoveryJournal`：镜像失败或目标对不上时状态是 `recovery_required`，顺利逆序恢复时状态是 `restored`。两条都落在失败记录之前。
2. `restore` 自己抛错时，先 `markRecoveryJournalBlocked`，再进入失败记录。`markRecoveryJournalBlocked` 把日志写成 `recovery_required`；日志读不到或写不回去时先 `latchSemanticRecoveryAdmission` 再把错误抛出。调用方吃掉这个错误，但闩已经置上。创建日志时写入的 `write_in_progress` 仍在（`writeRecoveryJournal` 是同目录临时文件再 rename，失败不会把旧日志换成空文件），启动恢复还能接着判。
3. 然后才调用 `options.recordPromoteFailureImpl ?? appendReleaseRecord`。这一写包在自己的 `try` 里。它抛错只打日志，不会把前面的恢复跳过，也不会跳过后面的放锁。
4. 放锁在失败记录之后。`releasePublishLock` 只有在 `releasePublishCoordinatorLock` 成功后才清掉内存里的 holder。删除抛错时置 `publishLockReleaseFailed` 并保持原 holder。下次 `acquirePublishLock` 经 `retryOwnPublishLockRelease` 用同一个 `operationId` 再删一次。放锁自己失败时窗口继续被这个 holder 占着。

失败记录不再是回滚的前置条件。失败记录写抛错时，回滚或 `recovery_required`（或进程级闩加上仍在的 `write_in_progress` 日志）已经发生，锁也会放开，除非放锁自己失败。

`readRecoveryJournal` 在文件已不存在时返回 `null`，`restoreRecoveryJournal` 因此直接返回 `null`。这条臂只打日志，不调用 `markRecoveryJournalBlocked`。`createRecoveryJournal` 写出的 id 是 `rj_` 加 UUID，不会撞上路径拒绝。文件还在时走不到这条臂。它不把失败记录重新变成回滚的前置条件，不构成退回。

## H02 第二支已收口：启动扫描失败会闩上，共享写门在拿锁之后拒绝

读的是：

- `webui/server/semantic-recovery-journal.ts` 的 `recoverSemanticJournalsAtStartup`、`recoverPendingRecoveryJournals`、`listOpenRecoveryJournals`、`isRecoveryRequired`、`journalBlocksSemanticAccess`、`recoveryJournalPhase`、`assertSemanticWritesOpen`、`latchSemanticRecoveryAdmission`
- `webui/server/index.ts` 的 `startServer` 与其中的 `recoverSemanticJournals`
- `webui/server/publish-coordinator.ts` 的 `withPublishCoordinator`、`isInsidePublishCoordinator`
- 四个写入口：`webui/server/semantic-layer.ts` 的 `writeSourcePatch`（`semantic_table_save`）；`webui/server/catalog-assets.ts` 的上传写入，以及 `webui/server/project.ts` 的 `removeSchema` / `removeConnection` 在删除语义内容时（`manifest_upload`）；`webui/server/admin/access-config.ts` 的 `runInAccessPublishWindow` 与 `writeAccessConfigFileWithAuditClosure`（`role_policy_save`）；`webui/server/admin/agents.ts` 的 `writeAccessYamlInBarrier` 把 `kind: "agent_save"` 交给同一个 `writeAccessConfigFileWithAuditClosure`

`recoverSemanticJournalsAtStartup` 在 `recoverPendingRecoveryJournals` 抛错时调用 `latchSemanticRecoveryAdmission`，记日志，返回 `null`。`startServer` 在 `app.listen` 之前 `await recoverSemanticJournals()`，该函数调用 `recoverSemanticJournalsAtStartup`。扫描失败后进程仍会监听，但 `isRecoveryRequired` 看到闩就返回 `true`，后续写入失败关闭。这是闩，不是把扫描失败当成没有日志。

`listOpenRecoveryJournals` 只把目录不存在（`ENOENT`）当成没有未决日志。`EACCES`、`EIO` 以及其他 `readdir` 失败继续抛出。`assertSemanticWritesOpen` 对这类错误调用 `latchSemanticRecoveryAdmission`，再抛 `SemanticRecoveryClosedError`，不会把读失败当成空目录。

`journalBlocksSemanticAccess` 只在 `recoveryRequired`、状态 `recovery_required`，或 `recoveryJournalPhase` 为 `write_in_progress` 时关闭写入。缺 `phase` 的旧日志按 `write_in_progress` 读。`files_saved` 与 `activation_pending` 不因为阶段本身永久关闭下一笔写入。`markRecoveryJournalFilesSaved` / `markRecoveryJournalActivationPending` 只改阶段，不把 `recoveryRequired` 置上。

`withPublishCoordinator` 在 `acquirePublishCoordinatorLock` 成功之后、调用 `fn` 之前执行 `assertSemanticWritesOpen`。因此 `semantic_table_save`、`manifest_upload`、`role_policy_save`、`agent_save` 在 `write_in_progress` 或 `recovery_required` 期间失败关闭，不必在每个调用点再写一遍同样的判断。门拒绝后 `finally` 放锁，被拒绝的入口不占住窗口。

已经处在 `coordinatorHeld`（AsyncLocalStorage）里的重入调用跳过这道检查，由外层那一次拿锁后的检查负责。`publishSemanticAssets` 不走 `withPublishCoordinator`。它在 `acquirePublishLock` 之前调用 `isRecoveryRequired`，拿到锁之后再查一次；未决时放锁并拒绝。`index.ts` 的手动索引走 `withPublishCoordinator("manual_reindex", ...)`，回调里还有一次 `isRecoveryRequired`。

## 波次 A 仍然成立

这三件保持为真，不重新当作退回理由。

- 幂等容量。`webui/server/semantic-idempotency.ts` 的 `registerSemanticIdempotencyKey`：未过期且计划摘要相同的键在容量判断之前返回 `replay`。未过期键滤进 `retained` 之后，长度达到 `MAX_RECORDS`（500）就抛 `SemanticIdempotencyCapacityError`，函数里没有 `slice` 淘汰。过期键不占这 500。保留时长是 `webui/server/semantic-limits.ts` 的 `idempotencyRetentionMs`（24 小时）。
- 镜像失败。`syncRuntimeMirror` 在 `failed > 0` 时抛 `RecoveryJournalError`。`restoreRecoveryJournal` 和 `recoverPendingRecoveryJournals` 接住之后写 `recovery_required`，不写 `restored`。`promoteFile` 在 rename 之后调用 `syncRuntimeMirror`；抛错进入上面的 promote `catch`，失败记录状态是 `promote_failed`。`runReindex` 只在摘要核验、目录重载和终态审计之后写 `published`。
- 终态窗口。`releasePublishLock` 失败保持 holder，`retryOwnPublishLockRelease` 用同一个 `operationId` 再试。索引成功之后 `stage` 改为 `after_index`，随后的异常走 `persistTerminalFailure`，其中 `markRecoveryJournalBlocked` 写成 `recovery_required`，发布记录改为 `promote_failed`。`reloadImpl` 成功之后才 `completeRecoveryJournal`；重载抛错走 `persistReindexFailure`（`activation_pending`，不写 `published`，不完成日志）。

## 明确保持原状态

- **G30**：`webui/server/semantic-batch-routes.ts` 的 `POST /api/semantic-assets/check` 仍以 202 返回 `operationId`、`taskId`、`scopeId`、`status: "queued"` 以及选择数、依赖数。没有 `validationId`，没有可发布计划。保持打开。不要把它改成计划接口。
- **G31**：登记册里的这一行保持原样。本结论不去关它。
- **V03(d)、V22、波次 0b**：保持关闭，不解锁。
- **V01–V22**：全部仍是未执行。调用链上看见的行为不是子断言证据，也不是整项通过。
- **H01 残留**：幂等键已经写入、对应发布记录还不存在时，`publishSemanticAssets` 仍以 `SEMANTIC_IDEMPOTENCY_CONFLICT` 拒绝，不把记录里的 `releaseId` 当回放返回。24 小时 / 500 的拒绝没有退回。这仍不是退回理由。
- **M01、M02**：留在取证映射。标签和 Spec 状态叙述这次不改。它们单独不挡住「接受进入取证」。

## 非阻塞

- promote `catch` 在 `restore` 返回 `null` 时没有再闩准入。见上一节。不构成退回。
- 启动扫描失败后 `startServer` 仍会 `listen`。准入闩已经置上，`isRecoveryRequired` 与 `assertSemanticWritesOpen` 会拒绝写入。这符合「扫描抛错要闩上」，不是未闩就监听。
- 发布路径自己的 `isRecoveryRequired` 在目录读失败时把异常抛出，不把目录当成空；粘性闩写在 `recoverSemanticJournalsAtStartup` 和 `assertSemanticWritesOpen`。不要求发布路径再复制一份闩。

## 复审之后

波次 C–E 不再被这次复审挡住。G30、V03(d)、V22 和波次 0b 保持关闭。本文件不开始取证，也不把任何 V 项标成通过。
