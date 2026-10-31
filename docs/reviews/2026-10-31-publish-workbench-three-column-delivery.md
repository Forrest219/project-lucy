# 发布工作台三栏与待发布口径：交付报告

日期：2026-10-30 至 2026-10-31。对象：[发布工作台三栏 Spec](../specs/lucy-20261030-publish-workbench-three-column-spec.md) v0.3 及其 [实施 Plan](../plans/lucy-20261030-publish-workbench-three-column-plan.md) v0.3。方法：按 Spec／Plan 的 S0→S6 顺序落地，每阶段先写失败用例、实际跑出 RED、再实现到 GREEN；结论按主 Spec §7 的 PWB-01–PWB-26 逐条给出。边界：未做浏览器走查、移动窄屏、镜像构建、部署、提交与推送；未改 `publish-coordinator.ts`、`semantic-recovery-journal.ts`、`content-mirror.ts`、`publishHistoryLabels.ts`、`PublishHistory.tsx` 与 `api.semantic-assets.publish.test.ts` 的锁生命周期或既有合同。

## 结论

**部分完成。** 26 项验收中 **17 项通过、9 项部分通过（缺专项自动化用例或未做浏览器实测）、0 项因终态保障缺失而阻断、0 项完全未执行**。S0 的终态窗口裁决成立：现有发布窗口已经把终态核验、终态审计与基线推进放在同一串行窗口内，因此本功能**只把基线 CAS 接进已经存在的窗口**，没有新造锁、没有修改协调器、没有恢复或关闭 G31。

部分通过的 7 项集中在两类：**缺专项自动化用例**（PWB-06 的服务重启、PWB-15 的跨午夜跨年、PWB-16 的差异抽屉内容、PWB-25 的失败保留侧栏、PWB-26 的常规与 staged 影响一致性）与**未做浏览器实测**（PWB-24 的桌面几何、PWB-17 的轮询终止）。这些不是实现缺失，但也不能写成通过。

## 一、S0：终态窗口的裁决

**问题。** G31 与终态锁生命周期挂起、无 owner。本会话不恢复、不关闭、不修改 `publish-coordinator.ts` 与 `semantic-recovery-journal.ts` 的锁生命周期，也不改 L25-11／L25-15 的冻结合同。因此必须先核对：现有发布窗口是否已经把终态核验、终态审计和基线推进放在同一串行窗口内。

**核对结果。** 两条发布路径的窗口边界如下（证据为源码位置，不是注释）：

| 发布路径 | 终态核验 | 终态审计 | 放锁位置 | 证据 |
|---|---|---|---|---|
| 批量发布 | `verifyFinalTargetDigests` | `recordConfigChange({ change_type: "semantic_publish_terminal" })` ＋ `updateReleaseRecord(status: published, activationStatus: confirmed)` | `runReindex` 的 `finally` → `releasePublishLock` | `webui/server/semantic-assets.ts` 的 `runReindex`：终态四步全部在 `releasePublishLock` 之前 |
| 手动 reindex | 本功能新增的**消费漂移核验**（`detectPublishConsumptionDrift`） | `recordManualReindex`（发布历史记录） | `withPublishCoordinator` 的 `finally` | `webui/server/index.ts` 的 `/api/semantic-assets/reindex`：历史记录写在 `withPublishCoordinator("manual_reindex", …)` 回调内 |

**裁决。** 现有窗口**已经**把终态核验、终态审计与（新增的）基线推进放在同一串行窗口内，所以**只允许把基线 CAS 接进已经存在的窗口**这一条是满足的：

- 消费快照在**索引读取内容之前**采集（`capturePublishConsumption` 在 `reindexProject` / `reindexImpl` 之前调用），基线推进使用该快照，**不使用索引返回后的磁盘读数**。
- 基线推进是代次 CAS（`advancePublishBaseline` 的 `expectedGeneration`），冲突时不覆盖更新的证据。
- 两条路径的基线推进都在终态审计落盘之后、窗口释放之前。

**因此 PWB-03、PWB-10、PWB-12 不因终态保障缺失而阻断**，三者的证据链都在上述窗口内取得。

**未动的边界。** G31 的登记行未被本功能改写；L25-16 Spec §7 的 G31 行、L25-11 的 V01–V22、L25-15 的 SRR-01–SRR-24 状态均未被本功能触碰，也**未**被本功能关闭。

## 二、文件清单（相对开工基线）

工作区开工基线记录在 `/tmp/pwb-baseline-status.txt`（111 条）。本会话的改动：

**新增（12）**

| 文件 | 作用 |
|---|---|
| `webui/server/publish-workbench-state.ts` | 待办事实源：内容枚举、摘要、基线与 attempt 持久化、消费快照与漂移检测 |
| `webui/server/publish-impact.ts` | 影响模型：Manifest 逐表比较、overlay 原因、完整身份合并、Wiki 与关联范围分区、证据引用 |
| `webui/server/__tests__/publish-workbench-state.test.ts` | 17 个用例 |
| `webui/server/__tests__/publish-workbench-lifecycle.test.ts` | 6 个用例 |
| `webui/server/__tests__/publish-impact.test.ts` | 13 个用例 |
| `webui/server/__tests__/api.publish-workbench.test.ts` | 6 个用例 |
| `webui/src/components/semantic-assets/PublishRecentReleases.tsx` | 右栏最近发布摘要 |
| `webui/src/components/semantic-assets/PublishImpactReview.tsx` | 共享影响审阅（逐表原因、证据、搜索、分组） |
| `webui/src/components/semantic-assets/PublishSyncConfirmDrawer.tsx` | 本页限定的宽确认侧栏 |
| `webui/src/__tests__/publish-recent-releases.test.tsx` | 7 个用例 |
| `webui/src/__tests__/publish-impact-review.test.tsx` | 10 个用例 |
| `docs/plans/lucy-20261030-publish-workbench-three-column-plan.md` | 由 `2026-10-30-publish-workbench-three-column-plan.md` 改名（仓库落盘规则要求 `lucy-YYYYMMDD-<slug>-plan.md`，且须与 Spec 同编号） |

**修改（18）**

| 文件 | 改动 |
|---|---|
| `webui/server/index.ts` | `/api/diff`、`/api/validate-changed`、`/api/semantic-assets/reindex` 统一快照与版本校验；新增 `/api/publish-workbench/evidence`；启动对账 |
| `webui/server/semantic-assets.ts` | `businessChangesOnly` 服务端过滤；消费证据的采集／提交／对账；批量发布路径接入基线 CAS |
| `webui/server/semantic-batch-routes.ts` | 批量计划返回同版本 `impact` |
| `webui/src/lib/types.ts` | 影响模型与快照版本类型 |
| `webui/src/lib/queryKeys.ts` | 最近发布查询键包含过滤参数 |
| `webui/src/pages/publish/PublishWorkbench.tsx` | 三栏结构、独立加载/失败/空态、版本绑定校验与刷新 |
| `webui/src/components/semantic-assets/PublishBatchPlanPanel.tsx` | 复用影响审阅组件；保留原计划摘要与覆盖确认 |
| `webui/src/app/app.css` | 本页专属 `.pl-publish-workbench-layout` 等；未改共享 `.pl-review-layout` / `.pl-drawer-panel` |
| `webui/src/__tests__/review.test.tsx` | 按三栏布局更新既有断言并补充覆盖 |
| `webui/server/__tests__/api.semantic-assets.reindex.test.ts` | **修复一条在 HEAD 上就失败的断言**：CSV 表头在 HEAD 已是「重建索引状态」，测试仍期望「Reindex 状态」。这不是本次改动引入的回归 |
| `webui/docs/00-product-terminology-standard.md` | §4.3 与 §3 登记新术语；「待发布变更」由禁止文案改为左栏主术语 |
| `webui/docs/design-system/99-governance.md` | 登记 TD-20261030-01（三栏与宽确认侧栏，仅本页） |
| `webui/docs/119-publish-workbench-queue-gate-ia-spec.md` | 局部修订引用 |
| `webui/docs/121-publish-workbench-cta-confirm-spec.md` | 局部修订引用 |
| `webui/docs/123-publish-workbench-activation-ia-spec.md` | 局部修订引用与术语行 |
| `docs/specs/lucy-20261030-publish-workbench-three-column-spec.md` | v0.3：状态、闭口层级、术语与设计规范形态、§7 执行状态 |
| `docs/plans/README.md` | 索引登记 |
| `docs/README.md` | 索引登记 |
| `docs/qa/selector-contract.md` | 登记本轮新增 testid；移除被本轮替换掉的旧确认抽屉登记 |

**明确未碰（边界核对）**：`webui/server/publish-coordinator.ts`、`webui/server/semantic-recovery-journal.ts`、`webui/server/content-mirror.ts`、`webui/src/lib/publishHistoryLabels.ts`、`webui/src/pages/publish/PublishHistory.tsx`、`webui/server/__tests__/api.semantic-assets.publish.test.ts` — 已逐文件核过，不含本功能的任何标记。

**越界检查**：`webui/server/index.ts` 的接线是**断线前**完成的（见上表「修改」栏）。断线恢复后，`webui/server/index.ts` 与 `webui/server/display-*.ts` 归另一条 Spec 195 任务所有，本会话**没有再改** `index.ts`，**没有碰**任何 `display-*.ts`。

## 三、各阶段的 RED / GREEN

工作目录均为 `webui/`。

| 阶段 | RED | GREEN |
|---|---|---|
| S1 状态模块 | `npx vitest run --maxWorkers=1 server/__tests__/publish-workbench-state.test.ts` → **5 failed / 12 passed**。失败根因：扫描的 `truncated` 标志被无条件置真，导致快照永远不完整、待办永远为空 | 同命令 → **17 passed** |
| S2 生命周期 | `npx vitest run --maxWorkers=1 server/__tests__/publish-workbench-lifecycle.test.ts` → **1 failed / 5 passed**。失败根因：用例前提不成立（该用例没有先产生一次 attempt） | 同命令 → **6 passed** |
| S3 影响模型 | `npx vitest run --maxWorkers=1 server/__tests__/publish-impact.test.ts` → **7 failed / 6 passed**。失败根因（真实缺陷）：`advancePublishBaseline` 允许指向**不存在的 blob**，基线引用了没有的内容 | 同命令 → **13 passed**；同时补上「基线引用缺失即拒绝推进」与「删除项也能出差异」 |
| S3 API | `npx vitest run --maxWorkers=1 server/__tests__/api.publish-workbench.test.ts` → **2 failed / 4 passed**。失败根因（真实缺陷）：`businessChangesOnly` 没进 `parseReleaseListQuery`，服务端过滤形同虚设；另一条是 Wiki-only 用例前提不成立 | 同命令 → **6 passed** |
| S4 前端 | `npx vitest run --maxWorkers=1 src/__tests__/review.test.tsx` → **4 failed / 18 passed（共 22）**。失败根因：既有断言写死了双栏布局与页头按钮位置 | 同命令 → **31 passed**（更新 4 条既有断言并补 9 条）；新增 `publish-recent-releases.test.tsx`（7）与 `publish-impact-review.test.tsx`（10） |

**S5 最终验证（全部实际执行）**

```
npx vitest run --maxWorkers=1 server/__tests__/publish-workbench-state.test.ts \
  server/__tests__/publish-workbench-lifecycle.test.ts server/__tests__/api.publish-workbench.test.ts \
  server/__tests__/api.semantic-assets.reindex.test.ts server/__tests__/api.semantic-assets.publish.test.ts
→ Test Files 5 passed | Tests 47 passed

npx vitest run --maxWorkers=1 server/__tests__/publish-impact.test.ts
→ Test Files 1 passed | Tests 13 passed

npx vitest run --maxWorkers=1 src/__tests__/review.test.tsx src/__tests__/publish-recent-releases.test.tsx \
  src/__tests__/publish-history.test.tsx src/__tests__/publish-impact-review.test.tsx
→ Test Files 4 passed | Tests 64 passed

npm run lint:terminology   → Terminology lint passed (1087 files scanned)
npm run lint:ia-boundary   → IA boundary lint passed
npx tsc --noEmit           → 全仓 91 个既存错误（并发会话推进中，数量会变），本线涉及文件 0 个
npm run build              → ✓ built in 515ms
```

**旁证回归**：`semantic-release-restore` / `semantic-batch-journal-lifecycle` / `validate-changed-column-type` / `skill-owner-l25-04` / `semantic-asset-publish` / `restore-release-drawer` / `publish-history` → 7 files / 70 tests 全绿。

**其它门禁**：`npm run lint:spec-docs` 中本 Spec 与 Plan 的形态违规为 **0**（剩余 FAILED 项全部属于其它会话的文件：`2026-10-29-ci-restoration-plan.md`、`2026-10-30-l25-11-publish-window-task.md`、`2026-10-30-manifest-upload-size-fix.md` 等，未代改）。`npm run e2e:selector-contract` 中本线文件的 **UNREGISTERED = 0、ORPHAN = 0**（全仓剩余 201 条属于其它会话的新组件）。

## 四、PWB-01–PWB-26 逐条结论

「通过」= 有自动化用例或可核对的实现事实直接覆盖该条；「部分通过」= 实现已落地但缺专项用例或未做实测。

| ID | 结论 | 证据 |
|---|---|---|
| PWB-01 | **通过** | `review.test.tsx`「renders the three columns in reading order 待发布变更 → 生效准备 → 最近发布」「keeps exactly one publish action on the page, inside the middle column」 |
| PWB-02 | **通过** | `review.test.tsx`「groups the pending list by asset type and shows the pending file count」；`publish-impact.test.ts`「does not merge same-named tables from different connections」；路径翻译防御为实现事实（`translate="no"` ＋ `notranslate`），**无专项断言** |
| PWB-03 | **通过** | `publish-workbench-state.test.ts`「does not depend on Git: a confirmed sync clears the pending list while the tree stays dirty」「brings a file back into the pending list when it is modified again」；`publish-workbench-lifecycle.test.ts`「clears the pending list and advances the baseline after a successful sync」 |
| PWB-04 | **通过** | `publish-workbench-lifecycle.test.ts`「keeps the pending list and the baseline when the index fails」 |
| PWB-05 | **通过** | `review.test.tsx`「marks a stale validation as stale and keeps the publish CTA disabled (PWB-05)」；`publish-workbench-lifecycle.test.ts`「refuses a confirmation that was bound to an older content version」（409 `PUBLISH_CONTENT_VERSION_CHANGED`） |
| PWB-06 | **部分通过** | 无 Git ✓（state 用例）、进程外直接编辑内容根 ✓（api「validates a table that was edited outside this process」）、未跟踪/暂存文件 ✓（扫描不看 Git）；**服务重启无专项用例**（持久化位置与启动对账的证据见 PWB-12） |
| PWB-07 | **通过** | `publish-workbench-state.test.ts`「distinguishes a deletion from an empty file and from a missing file」；镜像残留由既有 `api.semantic-assets.reindex.test.ts` 的 mirror-only 断言覆盖（本次跑过） |
| PWB-08 | **通过** | `publish-workbench-state.test.ts`「keeps internal files out of the pending list」；真实业务 Wiki 保留由 api 用例「reports the manifest and wiki parts of the impact separately from the tables」覆盖 |
| PWB-09 | **部分通过** | 待办与校验同源 ✓、确认绑定 pendingDigest ✓、Wiki-only 批次不被空表校验阻断 ✓（api 三条用例）；**批量计划与 `/api/diff` 的影响范围一致性无用例** |
| PWB-10 | **通过** | `publish-workbench-lifecycle.test.ts`「does not consume content that changes while the index runs」；`publish-workbench-state.test.ts`「captures the content BEFORE the index reads it and reports later drift」「records a removal that lands during the index」 |
| PWB-11 | **通过** | `publish-workbench-state.test.ts`「reports a damaged baseline as needs_verification instead of inferring published」「reports a changed content-root binding as needs_verification」「reports every business file as pending on first verification, not as published」 |
| PWB-12 | **通过** | `publish-workbench-lifecycle.test.ts`「completes a crashed attempt at startup when the terminal evidence proves it」（含二次对账不重复推进）、「never fabricates a success when the terminal evidence is missing」 |
| PWB-13 | **通过** | `publish-recent-releases.test.tsx` 全部 7 条（含「does not present an unconfirmed published record as 已生效」）；`api.publish-workbench.test.ts`「filters the maintenance runs before the limit」 |
| PWB-14 | **通过** | `review.test.tsx`「does not render the empty state and offers no publish action when the pending request fails」「keeps the submission blocked when the pending request fails after a successful load」；`publish-recent-releases.test.tsx`「shows the error and a retry control when the history request fails」 |
| PWB-15 | **部分通过** | 待办与时间无关（结构性保证：待办由内容差异决定）；历史时间用 `formatPublishHistoryTs`（含年-月-日 时:分），服务端无「今天」默认窗口；**跨午夜／跨年无专项用例** |
| PWB-16 | **部分通过** | 实现：`/api/diff` 的 diff 取自基线 blob 与当前内容（`readPublishEvidence` 的 `diff:` 引用）；无前版本返回「暂无可比较的生效版本。」，删除项给出移除差异；**无用例直接断言抽屉里的 diff 内容** |
| PWB-17 | **部分通过** | 刷新 ✓（review「keeps the loaded pending list visible while refreshing」）；**轮询终止未实现**（手动 reindex 是同步的；staged 批次沿用既有 `PublishBatchPlanPanel` 的 5 秒 `refetchInterval`，未按「终态后停止」改）；Escape 与焦点归还在 `PublishSyncConfirmDrawer` 中实现，**无用例** |
| PWB-18 | **通过**（回归） | 既有 `api.semantic-assets.publish.test.ts`、`api.semantic-assets.reindex.test.ts`、`publish-history.test.tsx`、`semantic-asset-publish.test.tsx`、`restore-release-drawer.test.tsx` 本次全绿；覆盖确认／幂等／planDigest／恢复阻断未退化 |
| PWB-19 | **部分通过** | `lint:terminology`、`lint:ia-boundary`、build、定向测试全部通过；**typecheck：本线涉及文件 0 错误，全仓仍有 91 个既存错误**（tsc 在本仓不是门禁；该数字随并发会话推进而变动，既存错误不由本功能引入）；未执行浏览器／移动窄屏 ✓（符合本条要求） |
| PWB-20 | **通过** | `publish-impact-review.test.tsx`「renders every table of a large batch」「renders both reasons of a table but counts the table once」「collapses a connection/schema group but keeps the group total」；`publish-impact.test.ts`「does not merge same-named tables from different connections」 |
| PWB-21 | **通过** | `publish-impact.test.ts`「merges the overlay and Manifest reasons of one table into a single entry」「counts only the tables that actually changed inside a Manifest」「reports a Manifest with no per-table change as a schema-level change」「keeps Wiki changes out of the table list」「reports reference dependencies separately from the changed tables」；`publish-impact-review.test.tsx`「renders wiki, schema-level, related-scope and unresolved sections in their own areas」 |
| PWB-22 | **通过** | `publish-impact.test.ts`「lists every affected table — the list is never truncated」（12 张）；`publish-impact-review.test.tsx`「renders every table of a large batch — the list is never truncated」「filters the DISPLAY only — the synced range stays whole」「also matches a table by its reason text」 |
| PWB-23 | **通过** | `publish-impact-review.test.tsx`「loads the evidence on demand and keeps the search text and the folded group」「blocks the submission and names the blocking reasons when the range is incomplete」；`publish-impact.test.ts`「marks an unresolvable identity as incomplete instead of guessing」「says first verification instead of new table when there is no baseline」；`api.publish-workbench.test.ts`「resolves a reference inside the snapshot and refuses an unknown one」 |
| PWB-24 | **部分通过** | 静态复核：宽度内联 `min(880px, calc(100vw - 48px))` / `maxWidth: 960px`；面板 `flex column` ＋ `maxHeight: calc(100vh - 48px)`；正文 `flex:1; min-height:0; overflow-y:auto`；页头页脚固定；共享 `.pl-drawer-panel` 与 `.pl-review-layout` 未改（已核）。**桌面几何与长名换行未实测** |
| PWB-25 | **部分通过** | 证据就地展开并保留搜索／折叠 ✓；范围更新使旧确认失效 ✓（409 用例＋PWB-05 用例）；提交绑定完整快照 ✓（submit 带 `pendingDigest`）；**「失败保留侧栏、保留已核对内容」无自动化用例**（实现在 `PublishSyncConfirmDrawer`：错误渲染在 body 内、抽屉不自动关闭） |
| PWB-26 | **部分通过** | 常规同步与 staged 批次复用同一 `buildPublishImpact` 与同一 `PublishImpactReview` 组件（`PublishBatchPlanPanel` 渲染 `workbench-batch-impact-review`），保留原计划摘要与覆盖确认；**「常规与 staged 的影响结果一致」无用例** |

**统计：通过 17 项（PWB-01、02、03、04、05、07、08、10、11、12、13、14、18、20、21、22、23）；部分通过 9 项（PWB-06、09、15、16、17、19、24、25、26）；因终态保障缺失而阻断 0 项；完全未执行 0 项。**

部分通过的 9 项可分两类：

- **缺专项自动化用例（6 项）**：PWB-06（服务重启）、PWB-09（批量计划与 `/api/diff` 的影响范围一致性）、PWB-15（跨午夜／跨年显示）、PWB-16（差异抽屉的 diff 内容）、PWB-25（提交失败保留侧栏与已核对内容）、PWB-26（常规与 staged 的影响结果一致）。这些条目的**行为已实现**，只是没有把断言写出来。
- **未做浏览器实测（2 项）**：PWB-24（桌面几何：880px 侧栏的实际观感、长表名换行）、PWB-17 中的焦点顺序与 Escape 归还。
- **口径类（1 项）**：PWB-19。`lint:terminology`、`lint:ia-boundary`、build 与定向测试都通过；全仓仍有 91 个既存类型错误（并发会话推进中，数量会变），tsc 在本仓不是门禁，本线文件 0 错误。

**唯一的行为缺口是 PWB-17 的轮询终止**（见第五节第 1 条），其余部分通过项都是「实现已落地、证据未补齐」。

## 四之二、收尾复核（2026-10-31 断线恢复后）

断线（MiniMax Token Plan 用量上限）后重新核对的四件事：

1. **交付报告补齐**：本文件即此前缺失的那份交付报告，Spec 头部与 Plan 引用的「PWB-01–26 逐条证据」落到这里。
2. **Spec 状态自洽**：§7 原本仍写「以下全部为计划验收，当前均未执行」，与头部「已按 v0.2 的设计实现」矛盾；已改为带「本轮结论」列的执行状态表，并把 S0 的终态窗口裁决写进 §8 第 1 条。
3. **selector 契约的 5 条 ORPHAN**：`publish-impact-wiki` / `-schema-changes` / `-related-scope` / `-other-changes` / `-unresolved` 报 ORPHAN，根因是这批 testId 以 `data-testid={testId}` 动态传参，静态扫描读不到。**按仓库既有模式最小修复**：把分区 testId 改成调用处的 JSX 字面量（`DetailSection` 改收 `data-testid` 属性），渲染结果与 DOM 结构不变；契约登记**未删除**。同时修掉了扫描器把类型注释里的示例字面量误当成真实 testid 的问题（改写注释措辞）。修复后本线文件的 UNREGISTERED = 0、ORPHAN = 0。
4. **并发覆盖（一）**：`docs/plans/README.md` 的本 Plan 登记行曾被另一会话覆盖丢失，已重新补入并复验 `lint:spec-docs` 对本线文件 0 违规。
5. **并发覆盖（二，更要紧）**：`webui/docs/00-product-terminology-standard.md` 的本轮术语登记（`Pending Changes` 行、§4.3 的 10 条新术语、§3 的全局行、版本与日期行）被另一会话的提交**整段覆盖丢失**——该会话提交了自己版本的文件，未包含本会话的改动。已**重新登记并复跑 `lint:terminology`（1095 files scanned，通过）**。这说明「共享工作区 + 并发提交」会静默吞掉文档改动：**提交前必须逐个复核本会话在共享文件上的差异仍在**。本次已对全部本会话文件做了标记复查（见下）。
6. **本会话文件的在位复查**：对本会话涉及的全部文件逐个 grep 关键标记（接口名、testId、术语行、章节标题），确认并发提交之后改动仍在位；复查中发现并修复的丢失项为上一条与第 4 条，其余全部在位。

## 五、未完成项与需要人决定的问题

1. **PWB-17 的轮询终止未实现。** 手动 reindex 是同步返回的，没有需要轮询的异步发布；staged 批次沿用既有 `PublishBatchPlanPanel` 的 5 秒 `refetchInterval`（既有行为，未改）。若产品要求「异步发布每 3 秒轮询、终态后停止」，需要单独一轮改动并补 fake timers 用例。**这是本功能唯一的行为缺口，不是证据缺口。**
2. **浏览器实测未做。** PWB-24 的桌面几何（880px 侧栏、长表名换行）与 PWB-15 的跨午夜／跨年显示需要走查确认；按授权范围本轮不做。
3. **七条缺专项用例**（PWB-06 服务重启、PWB-09 计划与 diff 影响一致性、PWB-15 跨日、PWB-16 抽屉 diff 内容、PWB-25 失败保留侧栏、PWB-26 影响一致性、PWB-19 的 typecheck 全仓基线）可作为下一轮补齐项；补齐前不要把它们写成通过。
4. **Plan 文件改名待提交。** `docs/plans/2026-10-30-publish-workbench-three-column-plan.md` 已改名为 `docs/plans/lucy-20261030-publish-workbench-three-column-plan.md`（未提交，工作区呈现为「旧路径删除 ＋ 新路径未跟踪」）。提交前需一并暂存这两个状态。
5. **`docs/ui-ux-feedback/README.md` 的主题索引未加。** 该文件由别的会话在改，本会话未触碰；台账条目 `UX-PUBLISH-WORKBENCH-009` 已写入页面台账并引用主题 `publish workbench three-column ia`，主题表待由该文件的主人补一行。
6. **需要人决定：`e2e:selector-contract` 的扫描器盲区。** `data-testid={变量}` 的写法静态扫描读不到。本轮按仓库惯例把 5 个分区 testId 改成调用处的 JSX 字面量（渲染结果不变）来消除 ORPHAN，但扫描器本身仍读不到变量传参。若希望以后允许变量传参，需要在扫描器侧按既有模式登记或扩展——这是工具决定，不在本规格范围。
7. **需要人决定：`/api/diff` 的扫描成本。** 待办快照与影响模型每次都完整读取并哈希全部业务内容（上限 5000 个文件）。语义层很大时该接口会变重。当前没有做缓存，因为缓存会让「待办＝当前内容与基线的差异」这条合同出现陈旧窗口。
8. **G31 未关闭。** 本功能据源码事实确认终态窗口成立，但**没有**改写 L25-16 的 G31 登记行，也没有关闭 G30／G31。是否据本报告关闭，仍由 L25-11／L25-16 的维护者决定。
