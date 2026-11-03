# L25-11 波次 B 独立复审结论

## 结论：退回

日期：2026-10-30。审阅者未参与实现。实现侧输入 [`2026-10-30-l25-11-uat-rereview-input.md`](2026-10-30-l25-11-uat-rereview-input.md) 只作对照，不作为通过依据。本结论不把 V01–V22 改成已执行或已通过，不关闭 G30，不改升级建议书，不改 L25-16 的 G31 行，也不开始取证。

本环境没有 Codex CLI MCP。结论来自对当前工作区调用链的直接阅读。

## 审阅基线

未提交前的复审基线仍是 HEAD `8982ef0db690cb4f41120c327fc3319bad7586de`（`feat(webui): separate row-policy selection from list filters`）。下面的判断读的是工作区，含尚未提交的 L25-11 差异。访问关系图、问询预算、发版体验的 diff 不在本次范围。

2026-10-27 报告里的行号不作现行缺陷。下列行号是本次读到的工作区位置。

波次 A 要求的三件事，在工作区里是真的，但它们只覆盖原发现的一部分，不能关闭父项：

- 终态发布窗口：批量发布在摘要核验、目录重载、终结审计、`published` 和日志完成之后才放锁（`semantic-assets.ts` 的 `runReindex`）。放锁失败会留下 holder，下次获取时重试。手动索引历史写在 `index.ts` 的 `withPublishCoordinator` 内。索引成功之后的异常写成 `recovery_required` / `promote_failed`，目录重载失败不写 `published`、不完成日志。锁取得后会再查一次未决恢复。
- 24 小时幂等容量：`semantic-idempotency.ts` 在未过期键达到 500 时抛出 `SemanticIdempotencyCapacityError`，不再 `slice` 淘汰。保留时长是 `idempotencyRetentionMs`（24 小时）。已过期键可以丢掉后再接受新键。
- 镜像失败阻断：`syncRuntimeMirror` 在 `failed > 0` 时抛出。`restoreRecoveryJournal` 和 `recoverPendingRecoveryJournals` 在镜像失败时写 `recovery_required`，不写 `restored`。`promoteFile` 调用 `syncRuntimeMirror`；该异常走到 `promote_failed`，不写 `published`。

这三件事为真，仍不足以接受进入取证。H02 的父项没有收口。

## 阻塞问题

### H02 仍开：失败记录写入仍然挡在回滚前面

冻结合同 §7.2 写明：恢复不得以待写失败记录或失败审计成功为前置条件；记录写入失败不能跳过回滚。

工作区 `publishSemanticAssets` 的 promote `catch` 仍是先 `appendReleaseRecord`（`promote_failed`），然后才 `restoreRecoveryJournal`，最后才 `releasePublishLock`。`appendReleaseRecord` 一旦抛错，控制流不会进入恢复，也不会放锁。`publishLockReleaseFailed` 只有在 `releasePublishLock` 自己抛错时才置位，所以这次失败也不会走「下次获取时重试放锁」。同进程里窗口会一直被活着的 pid 占住，已写入的目标要等到进程重启、启动恢复把仍处于 `write_in_progress` 的日志逆序回滚，才会被处理。

镜像失败测试只证明「镜像异常不记 `restored` / `published`」。该子断言为真，不关闭 H02。

### H02 仍开：启动恢复异常只记日志，然后照常监听

`recoverSemanticJournals` 已改到 `app.listen` 之前。它的 `catch` 只 `console.error`，不调用 `latchSemanticRecoveryAdmission`，然后 `startServer` 继续监听。恢复扫描中途抛错时，未处理完的日志不会把进程级准入闩上。

`isRecoveryRequired` 的生产调用点只有批量发布和手动索引（`semantic-assets.ts`、`index.ts` 的 reindex 路由）。单表保存（`semantic-layer.ts` 的 `withPublishCoordinator("semantic_table_save")`）、Manifest 上传（`catalog-assets.ts`）、角色／行策略和 Agent 保存都不查这道门。恢复日志仍是 `recovery_required` 或 `write_in_progress` 时，这些写入口只要拿得到协调器锁就可以写入。

Lucy 读取门禁 `semanticRecoveryReadBlock` 已接到 `lucy_query` / `lucy_read_source` / `lucy_explain_query`。这只补上原 H02 的读取半边，不代替「恢复未完成前拒绝配置和资产写入」。

## 非阻塞问题

下列项不再构成退回理由。它们都不是 V01–V22 的通过，也没有验收证据。

- **B01**：`registerSemanticBatchRoutes` 已注册 `scopes`、`check`、`operations`、`plans`。导出在 `packageKind === "semantic-maintenance-package/v1"` 时走维护包。Catalog 有批量下载、批量校验和导入预检；发布工作台有计划面板。原「生产路由未注册、Catalog 没有批量入口」在当前调用链上不再成立。Spec §1.4 的「已落地」仍然不产生验收证据。
- **H01**：批量发布在锁内用 `rebuildBatchPlan` 重核 `planDigest`，写入前再对目标 digest 做一次比较；幂等记录在日志和正式写入之前持久化；同键同计划在发布记录已存在时返回原来的 `releaseId`；容量不足拒绝新意图。残留：幂等键已写入但发布记录还不存在时，重试抛 `SEMANTIC_IDEMPOTENCY_CONFLICT`，不把记录里的 `releaseId` 返回给调用方。这不恢复 2026-10-27 的「未接幂等、满 500 就淘汰」结论。
- **H03**：终态窗口、手动索引历史、放锁失败重试、索引成功后的 `recovery_required`、目录重载成功后才完成日志、窗口内再查未决恢复，在工作区调用链上成立。锁模块单测仍然不能代替这些业务回调的故障取证。
- **H04**：服务端导出记录核对 role、selected、dependencies、共享身份、路径、目标／基线 digest；只读条目按服务端 role 对字节；缺角色或选择集的旧记录要求重新导出；删 entry 或改绑会被整包拒绝。整包 digest 与导出记录一致时跳过逐条核对，因为 ZIP 字节本身没变。这不是 V07 的反篡改证据。
- **H05**：`parseSemanticValidateEnvelope` 对错形、缺字段、null、非数组整批拒绝，`index.ts` 的校验入口使用它，不再对 files/packages 做静默 `.filter`。这不是 V05 的 30 表证据。
- **M01**：real-e2e 的 V 标签仍宽于断言。本波测试文件头写明只覆盖一个子断言。标签不得回填整项。此项单独不阻断取证，但它现在和 H02 一起留在退回之后。
- **M02**：Spec 头部仍是独立审阅退回，V01–V22 仍是未执行。状态叙述和历史段落仍然混在一起。本次不改 Spec。此项单独不阻断取证。

## 明确不关闭

- **G30**：`POST /api/semantic-assets/check` 仍返回 `operationId`、`taskId`、`scopeId`、`status: queued` 和计数。没有 `validationId`，没有可发布计划。
- **V01–V22**：全部仍是未执行。本结论里的任何「调用链上已看见」都不是子断言证据，更不是整项通过。
- **V03(d)、V22、客户交付**：仍是 `blocked_delivery`。
- 波次 A 所引测试（4 个文件、51 个通过）只覆盖对应子断言，不在本结论里重跑，也不升级为整项证据。

## 测试缺口

退回不要求先补整项 V 证据。下一轮复审至少要能直接看到：

- promote 的失败记录写入抛错时，本批次已改目标仍按日志逆序恢复，并且窗口只在恢复完成或 `recovery_required` 已持久化之后放开。
- 启动恢复抛错时进程不在未闩上的状态下接受写入；单表保存、Manifest 上传和访问配置写入与发布、手动索引一样，在 `recovery_required` / `write_in_progress` 期间失败关闭。
- 镜像失败、500 条未过期键拒绝、终态窗口这三件事保持为真。现有单测不能替代上面两支。

## 建议修复顺序

1. 先改 H02 的回滚顺序：恢复不得依赖 `appendReleaseRecord` 成功；记录写失败时仍回滚，并把可继续启动恢复的状态持久化后再放锁。
2. 启动恢复失败时闩上准入，并且共享协调器的其余写入口在未决恢复期间拒绝写入。
3. 这两支有直接测试之后再交复审。复审接受终态窗口、容量拒绝和镜像失败关闭之前，不改登记册，不开始取证。
4. M01、M02 留到取证映射时处理：标签只写实际断言；Spec 状态分项，且在子断言齐之前保持 V01–V22 未执行。
