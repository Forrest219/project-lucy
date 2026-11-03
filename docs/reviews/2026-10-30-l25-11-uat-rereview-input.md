# L25-11 波次 B 复审输入

日期：2026-10-30。这是实现侧交给独立审阅的输入，不是审阅结论。每一条都标「待复审重判」。本文不把任何发现改成已通过，也不把 V01–V22 改成已执行。

合同：[语义资产批量维护 Spec](../specs/lucy-20261020-v2p5-semantic-batch-operations-spec.md)。原审阅：[2026-10-27 独立审阅](2026-10-27-codex-review-semantic-batch-operations-p0.md)，结论仍是「退回」。任务：[交付 UAT Task](../plans/lucy-20261030-l25-11-uat-delivery-task-plan.md) 波次 B。

复审基线：未提交前仍是 HEAD。下面标「工作区」的行为还没有提交。工作区里同时有访问关系图、问询预算、发版体验等无关改动，那些不在本次复审范围。

## 待复审重判

| 原发现 | 2026-10-27 的说法 | 当前调用链里请重判的事实 | 状态 |
|---|---|---|---|
| B01 | 生产路由未注册，Catalog 没有批量闭环 | `semantic-batch-routes.ts` 已注册 `scopes` / `check` / `operations`。Spec §1.4 把 D11–D23 记为已落地，但该节自己写明不产生验收证据 | 待复审重判 |
| H01 | 发布没有 CAS、planDigest 和持久幂等；满 500 条会提前淘汰未满 24 小时的键 | 发布路径已接 `planDigest` 与 `registerSemanticIdempotencyKey`。工作区新增：未过期键达到 500 时拒绝新意图（`semantic-idempotency.ts` 约 205 行），不再 `slice` 淘汰。直接测试只覆盖 V13(d) 这一子断言 | 待复审重判 |
| H02 | 日志过早完成，镜像异常被吞，读取不看恢复日志 | 工作区：`syncRuntimeMirror` 在 `failed > 0` 时抛出（`semantic-recovery-journal.ts` 约 203 行）。启动恢复和 restore 在镜像失败时写 `recovery_required`，不写 `restored`。promote 抛出后发布记录是 `promote_failed`，不是 `published`。读取门禁在已提交的 `semanticRecoveryReadBlock`。直接测试只覆盖「镜像失败不记 restored／published」 | 待复审重判 |
| H03 | 锁在 reindex 返回时释放，手动索引历史在锁外 | `3b7e8d32` 已把摘要核验、终结审计、`published` 和日志完成留在锁内。手动索引历史在 `index.ts` 的 `withPublishCoordinator` 内。工作区另有放锁失败重试、索引成功后的异常改为 `recovery_required`、目录重载成功后才完成日志、窗口内再查未决恢复。这些未提交 | 待复审重判 |
| H04 | 导出记录没有 role 和完整 entry 集合 | 已提交代码按服务端记录核对 role、共享身份、路径、digest、selected、dependencies；缺这些字段的旧记录要求重新导出（`semantic-maintenance-package.ts` 约 1009 行起） | 待复审重判 |
| H05 | HTTP 过滤会静默丢掉错误 entry | `parseSemanticValidateEnvelope` 对错形 entry 整批拒绝 | 待复审重判 |
| M01 | real-e2e 的 V 标签宽于实际断言 | 标签仍宽于断言。本波新增测试在文件头写明只覆盖一个子断言，不把 V14／V15／V19 改成通过 | 待复审重判 |
| M02 | Spec 状态和历史叙述混杂 | Spec 头部仍是独立审阅退回，V01–V22 仍是未执行。本输入不改这些状态 | 待复审重判 |

## 明确不在本次关闭

- G30：`POST /api/semantic-assets/check` 仍只返回 `operationId`、`taskId`、`scopeId`、`status: queued`。没有可发布计划。
- G31 登记：建议书 §2.5 仍写挂起。要等本复审接受终态窗口之后才允许改登记册。
- V03(d) 与 V22：仍是 `blocked_delivery`。
- 客户交付：仍是 `blocked_delivery`。

## 本波已跑的测试

2026-10-30 在本机工作区执行：

`npx vitest run server/__tests__/semantic-batch-idempotency-audit.test.ts server/__tests__/semantic-batch-mirror-failure.test.ts server/__tests__/semantic-batch-recovery.test.ts server/__tests__/semantic-batch-journal-lifecycle.test.ts`

结果：4 个文件、51 个测试通过。这不构成 V01–V22 的整项证据。
