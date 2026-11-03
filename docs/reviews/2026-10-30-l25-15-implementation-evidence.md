# L25-15 实现记录（2026-10-30）

> **本文档含两轮记录。** 第一轮（波次 A–F 首次落地）见下方「代码」「定向测试」「还没有当作验收的部分」；**第二轮（按 Plan v0.11 的 S1–S6 退出条件收口）见下方「第二轮收口」一节**。第一轮「还没有当作验收的部分」里的三条缺口（类别 A 不回读审计库、类别 D 不重跑索引、语义删除集合用 absent 目标当信号）**已在第二轮补上**，保留原文是为了让评审能看到缺口是怎么被认领和处置的。

波次 A–F 的运行代码已经落到仓库。本记录只说明代码和定向测试到了哪里。SRR-01–SRR-24 仍是未执行。测试通过不等于功能验收通过。S7、浏览器、镜像、部署和客户交付没有做。

## 代码

- 批次前快照：`webui/server/semantic-release-snapshots.ts`，格式 `semantic-release-snapshot/v1`。写入前核对本进程持有的发布锁（进程内 holder、pid、acquiredAt 与锁文件一致）。容量预检后原子写盘并回读摘要。
- 批量发布在已持有的发布窗口内、故障恢复日志和正式写盘之前写入 `promoting` 记录和 `snapshotId`。发布锁仍在终态处理之后释放。
- 单表保存、YAML 导入、Schema Manifest 上传，以及删除语义文件的 Schema／连接删除，在首次正式写入前走同一快照。连接 ID 变更只进入发布窗口，不生成内容快照。手动 reindex 不生成内容快照。
- 恢复：`webui/server/semantic-release-restore.ts`。三个接口是预检、提交、只读恢复包。没有上传接口。`semantic_restore` 持有到本次提交写出终态记录之后。
- 发布历史：触发方式增加「整批恢复」，`terminalAuditPending=true` 的公开文案是「生效待确认」。行上可打开「恢复发布批次」。
- 保留：可恢复批次 20 个、30 天、512 MiB，限额只写在 `SEMANTIC_BATCH_LIMITS`。恢复包上限与维护包上限分开。未过期幂等记录引用的发布记录在侧车截断时保留。

## 定向测试

在 `webui/` 下执行：

```text
npx vitest run --maxWorkers=1 \
  server/__tests__/semantic-release-snapshots.test.ts \
  server/__tests__/semantic-release-restore.test.ts \
  src/__tests__/restore-release-drawer.test.tsx \
  src/__tests__/publish-history.test.tsx \
  server/__tests__/api.catalog-assets.test.ts \
  server/__tests__/semantic-sidecar-atomic.test.ts \
  server/__tests__/semantic-batch-recovery.test.ts \
  server/__tests__/publish-coordinator.test.ts \
  server/__tests__/semantic-batch-identity.test.ts
node scripts/lint-terminology.mjs
```

上述命令通过。它们覆盖：无锁拒绝快照、持锁后快照与原文一致且正式文件未改、幂等引用的发布记录不被 100 条截断丢掉、手动 reindex 无快照、连接 ID 变更在窗口被占用时拒绝、恢复后原文回到批次前且重放返回同一条记录、超过 200 条的快照拒绝导出、启动时未写入的 `promoting` 结成落盘失败、抽屉只提交 previewId／planDigest／idempotencyKey。

## 还没有当作验收的部分

- 启动对账的类别 A 只在纯函数里覆盖。磁盘扫描还没有回读终态审计库，因此不会从审计记录补写 release。
- 类别 D 在启动时结成可重试的索引失败，不在启动路径上再调用索引。
- 恢复是否强制重建索引，目前用「批次前目标不存在、恢复时要删除」作为信号，还没有做合并模型上的语义删除集合比对。
- `e2e:real:verify`、浏览器和 amd64 镜像没有跑。SRR-22 保持 `blocked_environment` / `blocked_delivery`。
- `scripts/e2e/contracts/v025-coverage.yaml` 不记录运行状态，也没有把 SRR 写进那 149 条场景，避免改动冻结计数。SRR 状态仍以 Spec 验收矩阵的「未执行」为准。

---

# 第二轮收口（2026-10-30，本轮）

上一节记录的是波次 A–F 的首次落地。本轮按 Plan v0.11 的 S1–S6 退出条件逐项核对，只补合同缺口，已符合合同的路径保持不动。**SRR-01–SRR-24 仍然全部未执行**，SRR-22 仍是 `blocked_environment` / `blocked_delivery`。本轮不做浏览器验证、不做移动窄屏、不构建镜像、不部署、不推送、不做客户交付。

## 本轮补上的合同缺口

### 1. 语义删除集合改为合并模型差异（S2 第 5／12 项，Spec §5.5）

**缺口**：原实现用「批次前目标不存在、恢复时要删除」判断是否强制重建。这只统计 `absent` 目标，漏掉 **Manifest 原地回写删表**——文件本身仍是 `restore` 目标，但表已从合并模型中消失，走增量索引会让索引残留该表。

**补法**：新增 `webui/server/semantic-merged-model.ts`。它按 Lucy 的双层合并模型读当前模型：Schema Manifest 的 `tables` 映射提供表结构，semantic overlay 只提供业务扩展。表只有在 Manifest 声明时才存在于合并模型。

- `buildMergedModel` 给出「恢复前」模型；把恢复要写的 Manifest 内容代入后给出「恢复后」模型。
- `deriveSemanticDeletionSet` 取两者的差集作为语义删除集合。文件级消失（Manifest 本身恢复为 absent）与 Manifest 原地删表都落进这个集合。
- 删除 overlay **不**构成表消失：Manifest 仍声明该表，表结构仍然可见。它进的是 `overlayDeletionReadbacks`，读回预期是「业务扩展不可见、表结构仍然可见」。
- `reindexMode` 由语义删除集合是否非空决定，进入 `planDigest`，提交与重试读同一份。

**审阅结论**：Plan S2 第 5 项要求「模式写入 `planDigest` 并持久化到 release 记录；预检即显示将采用的模式」。现状是 `planDigest` 只覆盖 `snapshotId / snapshotDigest / current`，模式、语义删除集合、读回预期、镜像同步写集与索引范围都不在其中——计划摘要与实际执行计划可以不一致。已把上述五项一并纳入 `planDigest`，并把语义删除集合与读回预期持久化到 release 记录。S2 第 12 项要求的「读回预期由恢复计划推导并持久化」因此成立。

### 2. 启动对账类别 A 回读终态审计库（S2 第 14／16 项，Spec §8.1）

**缺口**：原实现把 `hasTerminalAudit` 硬编码为 `false`，并且 `if (!klass || klass === "A") continue;` 直接跳过类别 A。终态审计已落库、release 未到 `published` 的断点不会被补写。

**补法**：终态审计身份统一为 `releaseId + attemptId + "terminal"`（`semanticTerminalAuditKey`），发布路径与恢复路径写审计时都用它作 `idempotencyKey`。审计库对该键是 `ON CONFLICT DO NOTHING`，所以重放不会追加第二条成功审计。启动对账按 release 记录的 `attemptId` 实际回读 `config_change_log`：读到则归类 A，**只补写 release 终态**，不重跑索引、不重复追加审计。

**审阅结论**：Spec §8.1 要求 pending 只有一个设置点与一个清除点。现状是发布路径与恢复路径各自写 `terminalAuditPending: true` 再写 `false`，两处都是同一份 §8.1 顺序，但审计身份不同（发布路径此前没有可查询的身份键），导致启动对账无法判断「审计是否已落库」。统一身份键后，类别 A／C 都能用同一份证据判断。类别 C 的处置也据此同时收紧：审计在盘上才补终态并清 pending，审计缺失则结清 `reindex_failed / unconfirmed`，不猜 `published`。

### 3. 类别 D 在内容与镜像可证明时从索引阶段重跑一次（S2 第 16 项）

**缺口**：原实现把类别 D 直接结成 `reindex_failed`，启动路径不再调用索引。这不满足 S2 第 16 步「分类为 D 且内容与镜像可证明时，才从索引阶段重跑一次并沿用记录的 `reindexMode`」。

**补法**：新增 `proveContentAndMirror`：journal 必须已推进出 `write_in_progress`（停在该阶段说明「写入是否落地」不可判定，必须先按实际字节判定），且每个 entry 的当前摘要等于 `expectedNewDigest`，镜像侧摘要与内容根一致。可证明时才重跑索引一次，模式取 release 记录里持久化的 `reindexMode`，成功后走 §8.1 的同一套终态顺序并终结 journal；不可证明时结清 `recoveryRequired=true` 的可重试失败。

**审阅结论**：Spec §8.1 要求补写类（A／B／C）先于索引续跑类（D），且归入补写类不得再产生索引调用。现状的分类函数已经互斥（A → C → B → D → E → F），补上类别 A 的真实处置与类别 D 的续跑后，六类都有明确出口，没有记录会停在 `reindexing` 或 `terminalAuditPending` 上。

### 4. 幂等只读查询前移到取锁之前（S2 第 9 项，Spec §5.3）

**缺口**：原实现的幂等查询在 `semantic_restore` 锁**内**。恢复锁覆盖后台 reindex 直到终态，进行中的同键重放会先撞 `semantic_publish_busy`，而不是返回真实进行中的批次。

**补法**：鉴权与准入检查后、取锁前做一次**严格只读**的幂等查询：`applied` 直接返回既有批次状态；`intent` 只读取并返回真实进行中状态，需要结清时转入锁内；`failed` 且零写入未证明则拒绝自动重试。取锁后完整重做三态判定（含 `failed` 分支）。

### 5. 恢复写集与镜像同步写集分离（S2 第 4／11 项，Spec §2.3）

**缺口**：原实现用 `syncRuntimeMirror` 做一次无参全量镜像同步，既不区分两个写集，也不做漂移核对。

**补法**：`content-mirror.ts` 增加漂移枚举（`enumerateMirrorDrift`）、受控 upsert（`upsertVerifiedMirrorFiles`，只复制已核验集合内的文件）与受控删除（`deleteMirrorTargetAndVerify`，只删同一相对路径并回读）。通用 `syncContentToProjectRoot` 的 never-deletes 合同不变。

- 预检逐文件披露镜像同步写集（两侧路径与摘要），并标注「不由本次恢复写入、变化方向是镜像向内容根对齐」。
- 提交时**先核验漂移集合与预检披露一致**，出现未披露漂移立即阻断，不得先写后查；核对通过后才执行 upsert，且只复制已核验集合内的文件。
- 恢复日志只登记恢复写集（含其受控镜像目标），镜像同步写集不进日志。
- 恢复写集之外的内容根文件摘要不变；镜像侧允许变化的恰为「恢复写集的受控镜像目标 ∪ 已确认的镜像同步写集」。

**审阅结论**：`content-mirror.ts` 的通用同步是「只 upsert、永不删除」。恢复删除目标若只删内容根，ktx 视图会留着旧语义。已改为受控删除同一相对路径并回读两面 absent。

### 6. 写入口的批次必须到达终态（S1 退出条件，Spec §4.3）

**缺口**：波次 A–F 首次落地时，单表保存、单表 YAML 导入、Manifest 上传、删除语义文件的 Schema／连接删除都创建了 `promoting` 记录与快照，但**从不写终态**。记录永远停在 `promoting`，而 `assertNoUnsettledContentRelease` 以 `promoting / reindexing / terminalAuditPending` 为阻断条件——一次单表保存就会挡住之后所有内容写入。

**补法**：新增 `closeContentBatch`（成功）与 `failContentBatch`（失败）两个共享收口函数。成功路径是 §8.1 的同一套顺序：终态审计 → release 终态并置 pending → 核对审计并清 pending → 终结 journal。失败路径按实际字节回滚 journal，再把 release 结成 `promote_failed`；回滚不可证明时 `recoveryRequired` 保持 true，发布继续关闭。

这四条写入口没有索引步骤（ktx 守护进程按请求读语义层），所以它们的激活是**镜像同步**而不是重建索引；release 记录因此不写 `reindex` 字段，发布历史按既有口径显示「未执行」，不谎报索引成功。

**审阅结论**：删除语义文件的 Schema／连接删除**不**做受控镜像删除。通用 `content-mirror` 的 never-deletes 是平台合同（`content-mirror.ts` 的文件头与 `api.semantic-assets.reindex.test.ts` 的「leaves mirror-only files in place」用例都锁着它），Spec §2.3 也写明「不得改变 content-mirror 面向其他场景的永不删除策略」。受控镜像删除只属于**恢复计划**：恢复要撤销的正是本批次写入的内容，ktx 视图必须跟着撤销。

本轮一度把受控镜像删除也接到 Schema／连接删除路径上，全量回归立刻打红（`api.semantic-assets.reindex.test.ts` 的 mirror-only 断言失败：该文件在 ktx 视图里还在，内容根里已删，属 mirror-only）。已改回——删除路径只删内容根，journal 也只登记内容根那一面。

### 7. 恢复批次的索引重试入口（S2 第 13 项，Spec §5.6）

**缺口**：原实现没有恢复批次自身的索引重试入口，`reindex_failed` 的恢复批次只能靠手动 reindex 结算。

**补法**：`GET /api/semantic-assets/releases/:id/restore-index-scope` 返回**索引范围确认对象**（当前 ktx 实际扫描集合、当前镜像同步写集、`reindexMode`、`scopeDigest`），它只确认索引范围，不重算内容恢复计划——对来源批次预检会因恢复已落地而 CAS 冲突，对恢复批次预检等于构建反向恢复。`POST /api/semantic-assets/releases/:id/restore-retry-index` 绑定 `scopeDigest` 与新的幂等键，不重复恢复写盘，只重跑索引与必要的语义读回，沿用 release 记录里的 `reindexMode`，保留原失败 attempt。范围变化时要求重新确认，而不是重新恢复。

### 8. 索引范围与实际扫描集合的核对（S2 第 3／11 项）

**补法**：预检按「当前兄弟视图 ∪ 内容根现存文件 + 恢复计划」推导完整索引范围；提交在恢复写集写盘与镜像操作之后重新枚举 `projectRoot/semantic-layer/` 的实际扫描集合并比对，不一致即整批阻断。`unknownCoverage` 如实反映「无法逐文件确认的比例」——平台没有索引摘要账本，这个比例不会假装是 0。

## 抽屉落点偏差的处置

Plan §3.2 把 `RestoreReleaseDrawer.tsx` 落在 `webui/src/components/semantic-assets/`，工作区里的实现落在 `webui/src/pages/publish/`。该目录下既有发布相关组件都在 `pages/publish/`，但 `components/semantic-assets/` 确实存在且承载 `SemanticAssetPublishDrawer` 等同类抽屉——Plan 的落点与既有组件归属一致，**不是错误落点**。

处置：**搬回 Plan 落点** `webui/src/components/semantic-assets/RestoreReleaseDrawer.tsx`，删除 `pages/publish/` 下的那一份，不留两份。`PublishHistory.tsx` 的 import 与 `restore-release-drawer.test.tsx` 的 import 同步改。

抽屉同时按 S3 第 3 项补齐三个分区：本次恢复目标、全局索引范围与既有待同步变更（含 unknown 覆盖率）、镜像同步写集（逐文件两侧摘要与方向说明），并展示将采用的索引模式与删除方向的读回预期。

## 本轮新增／改动的文件

| 文件 | 性质 |
|---|---|
| `webui/server/semantic-merged-model.ts` | 新增。合并模型表集合与语义删除集合推导 |
| `webui/server/semantic-release-restore.ts` | 改写。计划构建、镜像写集分离、双面 CAS、终态顺序、启动对账 A–F、索引重试 |
| `webui/server/semantic-release-snapshots.ts` | 不变 |
| `webui/server/semantic-assets.ts` | 改。`attemptId` 随批次生成、`semanticTerminalAuditKey`、`finalizeContentRelease`／`closeContentBatch`／`failContentBatch`、`restoreIndexScope` 字段 |
| `webui/server/semantic-recovery-journal.ts` | 改。entry 增 `surface`（内容根／ktx 兄弟视图），两面各有原字节与摘要；`restoreRecoveryJournal` 增 `keepLandedWrites`（显示写入路径不回滚已落盘的写入） |
| `webui/server/content-mirror.ts` | 改。漂移枚举、受控 upsert、受控删除与回读、镜像摘要快照 |
| `webui/server/semantic-layer.ts` | 改。单表保存与 YAML 导入接终态收口 |
| `webui/server/catalog-assets.ts` | 改。Manifest 上传接终态收口 |
| `webui/server/project.ts` | 改。Schema／连接删除接终态收口；`applyConnectionIdChange` 只做互斥 |
| `webui/server/index.ts` | 改。新增两条路由（索引范围确认、索引重试） |
| `webui/server/__tests__/semantic-merged-model.test.ts` | 新增。合并模型与语义删除集合 |
| `webui/server/__tests__/semantic-release-restore-contract.test.ts` | 新增。双面 CAS、写集分离、受控镜像删除、索引重试 |
| `webui/src/components/semantic-assets/RestoreReleaseDrawer.tsx` | 新增（由 `pages/publish/` 搬回） |
| `webui/src/pages/publish/RestoreReleaseDrawer.tsx` | 删除（不留两份） |
| `webui/src/lib/types.ts` | 改。release 记录新增字段 |
| `webui/docs/00-product-terminology-standard.md` | 改。§4.15 补 5 个新术语 |
| `webui/docs/03-api-spec.md` | 改。三个新接口与预检三分区 |
| `docs/qa/selector-contract.md` | 改。登记恢复抽屉与行级恢复入口的 testid |
| `scripts/e2e/contracts/v025-coverage.yaml` | 改。新增 `srrMappings` 段 |
| `docs/plans/lucy-20261030-l25-15-semantic-release-restore-task-plan.md` | 由 `2026-10-30-l25-15-…-implementation-task.md` 改名并补齐形态（见下） |

**冻结计数未动**：`existingCatalogMappings` 279、`newScenarios` 149、`journeys` 1、合计 428，与 HEAD 一致。SRR 以独立段登记，不进入冻结分母，也不把 `not_run` 折叠成通过。

**落地 Task 的形态**：原文件名 `2026-10-30-l25-15-semantic-release-restore-implementation-task.md` 不符合「新 Plan 唯一文件名」规则（`lucy-YYYYMMDD-<slug>-plan.md`），且缺「验收」「完成定义」两类小节——一旦 `git add` 即成阻塞项。已改名为 `lucy-20261030-l25-15-semantic-release-restore-task-plan.md` 并补齐两类小节；引用它的四处链接（`docs/README.md`、`docs/plans/README.md`、`docs/governance/project-overview.md`、登记册 §2.9）同步改名。登记册 v1.59 行与概览 v1.68 行里的历史路径按惯例不回改。

## S5 验证（2026-10-30）

在 `lucy-v0.25`（HEAD `5fe3eef2`）工作区执行。环境：macOS arm64，本机 vitest。

| 命令 | 结果 |
|---|---|
| `npm run lint:spec` | 通过（exit 0） |
| `npm run lint:terminology` | 通过（1080 files scanned） |
| `npm run lint:ia-boundary` | 通过 |
| 本功能定向 vitest（见下） | 通过 |
| `npm --prefix webui test` | **5029 通过 / 1 失败**（415 文件：414 通过 / 1 失败） |
| `npm --prefix webui run build` | 通过（✓ built in 446ms） |
| `npm run e2e:real:verify` | **未执行**：命令要求 `--candidate <identity.json>`，本环境没有候选证据；退出码 1 是用法错误。它只校验已有证据结构，不生成也不伪造 SRR 证据 |
| `git diff --check` | 干净 |

定向 vitest（一次通过，162 + 4 用例）：

```text
npx vitest run --maxWorkers=1 \
  server/__tests__/semantic-release-restore.test.ts \
  server/__tests__/semantic-release-restore-contract.test.ts \
  server/__tests__/semantic-release-snapshots.test.ts \
  server/__tests__/semantic-merged-model.test.ts \
  server/__tests__/publish-coordinator.test.ts \
  server/__tests__/semantic-batch-journal-lifecycle.test.ts \
  server/__tests__/api.semantic-assets.publish.test.ts \
  server/__tests__/display-rollback-races.test.ts \
  server/__tests__/display-invalidation.test.ts \
  server/__tests__/api.save.test.ts \
  server/__tests__/api.catalog-assets.test.ts \
  server/__tests__/project.remove-schema.test.ts \
  server/__tests__/project.remove-connection.test.ts \
  src/__tests__/restore-release-drawer.test.tsx
```

### 失败分流（本功能回归 vs 既有基线）

**本功能回归：0。** 首轮全量跑出的 1 处本功能回归已改回并复跑通过——见上文「删除语义文件的 Schema／连接删除」一节：受控镜像删除一度被接到删除路径上，违反通用镜像的 never-deletes 合同，`api.semantic-assets.reindex.test.ts` 的 mirror-only 断言立刻打红。

**既有基线：1。** `server/__tests__/api.semantic-assets.reindex.test.ts` 的 CSV 表头断言仍写 `Reindex 状态`，而实现已按发布体验的术语统一改成 `重建索引状态`。**在干净 HEAD 基线上同样失败**（用 `git worktree` 检出 HEAD 实测确认），属发布体验那条线的遗留，不在本功能范围，未代改。

**负载抖动（非失败）。** 首轮全量跑时 `display-rollback-races.test.ts`、`usage-governance.test.ts`、`web-security.test.ts` 在并发下超时；单独重跑三个文件全绿（`web-security.test.ts` 三个用例各自贴着 vitest 5 秒默认超时），末轮全量未复现。

### 类型基线

`npx tsc --noEmit` 在干净 HEAD 基线上是 78 个既存错误；本轮改动后为 79，**唯一新增的一处在 `src/__tests__/access-map-layout.test.ts`**（另一个会话的未跟踪文件，与本功能无关）。本功能触及的模块无新增类型错误。

## 提交与隔离验证

- 提交：`feat(v0.25): close the L25-15 semantic release restore contract`（分支 `lucy-v0.25`）。**用临时索引提交**，共享索引与别的会话留下的合并冲突状态都没有被触碰；提交只含本功能获授权的文件，共享文档按 hunk 逐段取用。
- **隔离验证**：把该提交单独检出到干净 worktree 后——`npm run build` 通过（✓ built）；`npx tsc --noEmit` 为 **78** 个既存类型错误，与该提交父提交（`5fe3eef2`）的基线**完全一致**，本功能未新增类型错误；本功能的 14 个定向测试文件、166 个用例全绿。提交本身是自洽的，不依赖任何未提交的会话内改动。
- 未推送：授权边界明确不含推送。
- 过程中有一次并发会话执行「stash 全部未提交改动 → pull → 提交 → reset」，本轮与上一轮的工作一度从工作区消失；已按路径从 stash 取回（未 `stash pop`，避免把别人的工作一起恢复），并逐文件核对 pull 前后的差异，确认没有回退 pull 带来的改动。

## 仍然是未执行的部分

- **SRR-01–SRR-24 全部未执行。** 本轮只补实现层合同与定向测试，不产生功能验收证据。SRR-22 保持 `blocked_environment` / `blocked_delivery`。
- 真实打包 KTX 的合成语义集成、浏览器验证、amd64 镜像、客户交付：全部未做。
- 类别 D 的索引续跑、类别 A 的审计回读、合并模型差异三处已有定向测试覆盖，但那是**实现层证据**，不是 SRR 验收。
- `e2e:real:verify` 只校验已有证据结构，不生成也不伪造 SRR 证据。
