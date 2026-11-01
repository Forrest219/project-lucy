# 发布工作台三栏 — 功能合同收口

| 元数据 | 内容 |
|---|---|
| 日期 | 2026-11-01 |
| 授权 | PM 于 2026-11-01 批准「听取建议，制定计划干」，本条为阶段 B |
| 对象 | [发布工作台三栏 Spec](../specs/lucy-20261030-publish-workbench-three-column-spec.md) v0.4；[配套 Plan](../plans/lucy-20261030-publish-workbench-three-column-plan.md) v0.3 |
| 前置 | [交付报告](2026-10-31-publish-workbench-three-column-delivery.md)（2026-10-31，17/26 通过、9 项部分通过、0 阻断） |
| 结论 | **功能合同收口。** PWB-01–26 中 **25 条通过**，1 条（PWB-24）实现已落地并静态复核通过、剩余的浏览器走查按「闭口层级」不在本条出口。**本条收口不表示可上线。** 不占 L25 台账号 |

## 出口

本条闭口层级声明的出口：

- PWB-01–PWB-26 对应的服务端与组件自动化用例
- `lint:terminology`、`lint:ia-boundary`
- **本线涉及文件**的 typecheck 0 错误与 build 通过

**不在本条出口**：整库旅程、Agent 路径、跨模块或系统级故障演练；证据等级（浏览器走查、移动窄屏、镜像构建、客户部署）；全仓 typecheck 基线。

## 本轮补的事

交付报告把 9 条判为「部分通过」，分两类：**缺专项自动化用例** 7 条，**未做浏览器实测** 2 条。分类处理如下。

### 一、7 条缺专项用例 —— 全部补齐，不靠收窄出口

这 7 条的**行为都已实现**，缺的是「把断言写出来」。本轮逐条补了自动化用例（逐条落点见主 Spec §7.1）：

| ID | 补的用例 |
|---|---|
| PWB-06 | 服务重启后基线与待办仍在——关掉服务、全新实例、全新模块实例，读同一份磁盘状态；停机期间在进程外改内容，重启后仍识别为真实待办 |
| PWB-09 | 批量计划返回的 `impact` 与 `GET /api/diff` 的 `impact` 是同一份待办快照、同一套规则：涉及的表身份与计数完全一致 |
| PWB-15 | 待办与时间无关（把时钟推到跨年午夜后，待办清单与 `pendingDigest` 都不变）；跨午夜跨年的历史时间带年份显示；历史不固定限制为今天（不带日期参数 = 全部历史，与显式宽窗口结果一致） |
| PWB-16 | 没有可信前版本时明说「暂无可比较的生效版本。」，不拿 Git diff 冒充；有基线时 diff 比较的是「生效版本 → 当前内容」；抽屉里就地展示同一份内容 |
| PWB-17 | 焦点落到侧栏标题、Escape 走的是取消路径（只有一条离开路径）、关闭后焦点归还给打开它的按钮；**终态后轮询停止** |
| PWB-25 | 提交失败时侧栏不关闭、错误渲染在抽屉体内、已核对内容仍在、仍可重试；提交中防重复提交 |
| PWB-26 | 常规同步与 staged 批次用同一套影响规则——范围、原因、计数完全一致，唯一差别是「变更来源」标记（`staged_candidate` / `pending_disk_change`） |

新增/扩写的测试文件：

| 文件 | 内容 |
|---|---|
| `webui/src/__tests__/publish-sync-confirm-drawer.test.tsx`（新） | PWB-25、部件的 PWB-16、PWB-17 焦点与 Escape——8 条 |
| `webui/server/__tests__/publish-workbench-closure.test.ts`（新） | PWB-15（待办与时间无关、历史不限今天）、PWB-26——4 条 |
| `webui/server/__tests__/api.publish-workbench.test.ts`（扩写） | PWB-06、PWB-16（两条） |
| `webui/server/__tests__/api.semantic-batch.test.ts`（扩写） | PWB-09 |
| `webui/src/__tests__/publish-recent-releases.test.tsx`（扩写） | PWB-15（跨午夜跨年显示） |
| `webui/src/__tests__/semantic-asset-publish.test.tsx`（扩写） | PWB-17（终态后停止轮询） |

### 二、PWB-17 的「轮询终止」：交付报告判为**行为缺口**，本轮按实际形态收敛

交付报告把它列为「唯一的行为缺口，不是证据缺口」。本轮核对源码后确认的真实形态是：

- **本条自己的发布动作是同步的。** 工作台提交走 `POST /api/semantic-assets/reindex`，同步返回结果，**不存在需要轮询的异步发布**。§4.4 的原文是「**存在异步发布时**每 3 秒轮询其状态，终态后停止」——这个条件在本条不成立。
- 工作台页面里唯一的 `setInterval` 是校验期间的「已用秒数」计时器，随校验结束即停，不是状态轮询。
- 本功能面内**唯一**的异步发布轮询是 L25-11 发布抽屉 `SemanticAssetPublishDrawer` 的 release 状态查询（间隔 1500ms，非 §4.4 写的 3 秒——该组件属于既有发布流程，本条未改）。它在终态后停止，本轮补了组件用例把这一点断言下来（终态到达后再等两个轮询周期，调用数不得增长）。
- 因此本轮把 PWB-17 判为通过，依据是「焦点顺序 / Escape / 焦点归还」三条新增用例＋「终态后停止轮询」的新增用例。**没有改动任何运行代码去凑一条不存在的轮询。**

### 三、2 条「未做浏览器实测」——按闭口层级处理，不改口径

- **PWB-17 的焦点顺序与 Escape 归还**：本轮用组件用例补上了（jsdom 下焦点断言可靠）。本条矩阵里它已被自动化覆盖。
- **PWB-24 的桌面几何**（880px 侧栏的实际观感、长表名换行）：实现已落地并静态复核——宽度 `min(880px, calc(100vw - 48px))`、`maxWidth: 960px`、面板 `maxHeight: calc(100vh - 48px)`、正文 `flex: 1 / min-height: 0 / overflow-y: auto`、页头页脚固定，全部是**本组件内联样式**；共享的 `.pl-drawer-panel` 与 `.pl-review-layout` 未改。**实际观感未实测**——按「闭口层级」，浏览器走查明确不在本条出口，因此它**不构成本条收口的阻塞项**；但主 Spec §7 仍写「部分通过」，**不写成已实测通过**。

### 四、顺带修掉的两处登记与代码债

1. **`/api/publish-workbench/evidence` 未登记进 API 文档** —— 该路由由 commit `6040ef7a` 引入，但 `webui/docs/03-api-spec.md` 里 0 处 publish-workbench 登记，`npm run lint:spec` 因此为红（exit 1）。本轮补了端点总览行与「发布工作台三栏」小节（含 `diff:` / `snapshot:` / `baseline:` 三种引用前缀、路径边界、400/404 语义）。`lint:spec` 现为 **exit 0**。
2. **`server/__tests__/api.semantic-batch.test.ts` 的一条既存 typecheck 错误** —— 第 235 行 `readFile(path, "")` 的编码参数是空串（TS2769 / TS1117 之外的既存错误之一）。改成 `"utf8"`，语义等价（该处只断言读取失败）。全仓 typecheck 由 89 降到 **88**。

## 这次跑过的检查

```bash
# 定向测试（本条涉及文件 + 交付报告引用到的文件）
cd webui && npx vitest run --maxWorkers=1 \
  src/__tests__/publish-sync-confirm-drawer.test.tsx \
  src/__tests__/publish-impact-review.test.tsx \
  src/__tests__/publish-recent-releases.test.tsx \
  src/__tests__/semantic-asset-publish.test.tsx \
  src/__tests__/review.test.tsx \
  server/__tests__/publish-workbench-closure.test.ts \
  server/__tests__/api.publish-workbench.test.ts \
  server/__tests__/api.semantic-batch.test.ts \
  server/__tests__/publish-impact.test.ts \
  server/__tests__/publish-workbench-state.test.ts
# → 10 个文件 / 136 条通过

# 静态门禁
npm run lint:terminology        # → passed (1094 files scanned)
npm run lint:ia-boundary        # → passed
npm run lint:spec               # → exit 0（本轮补登记前为 exit 1）

# typecheck
cd webui && npx tsc --noEmit
# → 全仓 88 个既存错误；**本条涉及文件 0 错误**
```

## 逐条结论

| 编号 | 结论 | 证据落点 |
|---|---|---|
| PWB-01 | 通过 | 首屏顺序、待办独立加载、只有中栏有发布主动作——`review.test.tsx`「renders the three columns in reading order 待发布变更 → 生效准备 → 最近发布」「keeps exactly one publish action on the page, inside the middle column」 |
| PWB-02 | 通过 | 左栏分组、完整身份、同名跨连接不合并——`publish-impact-review.test.tsx` 与 `publish-impact.test.ts`「does not merge same-named tables from different connections」 |
| PWB-03 | 通过 | 确认成功后移出待办、Git 仍脏也不重复出现、同路径再改重新出现——`publish-workbench-state.test.ts`「does not depend on Git: a confirmed sync clears the pending list while the tree stays dirty」「brings a file back into the pending list when it is modified again」 |
| PWB-04 | 通过 | 索引失败保留待办、展示实际错误——`review.test.tsx`「shows validation issues in the workbench summary when validate fails」 |
| PWB-05 | 通过 | 校验与确认随内容版本失效、晚返回的旧校验不覆盖新状态——`review.test.tsx`「marks a stale validation as stale and keeps the publish CTA disabled (PWB-05)」 |
| PWB-06 | **通过（本轮补）** | `api.publish-workbench.test.ts`「a restarted service reads the same baseline and still finds the real pending change」——关服务 → 全新实例 + 全新模块实例 → 同一份磁盘基线；停机期间进程外改内容，重启后仍识别为真实待办。无 Git、未跟踪/暂存文件、进程外直接编辑内容根的其余部分由既有 state 用例覆盖 |
| PWB-07 | 通过 | 删除 / 空文件 / 新增可区分——`publish-workbench-state.test.ts`「distinguishes a deletion from an empty file and from a missing file」 |
| PWB-08 | 通过 | 内部文件不进待办、真实业务 Wiki 保留——`publish-workbench-state.test.ts`「keeps internal files out of the pending list」 |
| PWB-09 | **通过（本轮补）** | `api.semantic-batch.test.ts`「PWB-09：批量计划的影响范围与 /api/diff 一致——同一份待办快照、同一套规则」——两份 `impact` 的 `pendingDigest`、表身份与计数完全相等 |
| PWB-10 | 通过 | 索引期间产生新版本不能被上一批消费——`publish-workbench-state.test.ts`「captures the content BEFORE the index reads it and reports later drift」 |
| PWB-11 | 通过 | 缺失/损坏基线、内容根绑定变化 → `needs_verification`，不推断已生效——`publish-workbench-state.test.ts`「reports a damaged baseline as needs_verification instead of inferring published」「reports a changed content-root binding as needs_verification」 |
| PWB-12 | 通过 | 终态/基线持久化失败不显示整体成功——`publish-workbench-lifecycle.test.ts` 的 attempt 生命周期用例 |
| PWB-13 | 通过 | 右栏展示最近批次、过滤在限额前执行——`api.publish-workbench.test.ts`「filters the maintenance runs before the limit」＋ `publish-recent-releases.test.tsx` |
| PWB-14 | 通过 | 右栏失败不影响待办与校验；待办请求失败不显示空态或开放提交——`review.test.tsx`「does not render the empty state and offers no publish action when the pending request fails」 |
| PWB-15 | **通过（本轮补）** | `publish-workbench-closure.test.ts`「keeps the pending list and its digest across midnight and a year boundary」「does not limit the release history to today」＋ `publish-recent-releases.test.tsx`「PWB-15：跨午夜与跨年的时间显示带月日时分，跨年时带年份」 |
| PWB-16 | **通过（本轮补）** | `api.publish-workbench.test.ts`「says so plainly when there is no trustworthy previous version」「compares the proven baseline with the current content once a baseline exists」＋ `publish-sync-confirm-drawer.test.tsx`「shows the difference of the proven version against the current content in place」 |
| PWB-17 | **通过（本轮补）** | 刷新：`review.test.tsx`「keeps the loaded pending list visible while refreshing」；焦点/Escape/归还：`publish-sync-confirm-drawer.test.tsx`（三条）；轮询终止：`semantic-asset-publish.test.tsx`「PWB-17: the status polling stops at the terminal state — it is not a permanent background poll」。本条自身的发布动作是同步的，§4.4「存在异步发布时」的条件不成立——详见本文件「本轮补的事」第二节 |
| PWB-18 | 通过 | 整批同步、覆盖确认、恢复阻断、幂等与既有发布记录页行为未退化——`api.semantic-batch.test.ts` 的幂等与计划用例 |
| PWB-19 | **通过（口径收敛）** | `lint:terminology`、`lint:ia-boundary`、`lint:spec` 全绿；本条涉及文件 **typecheck 0 错误**；build 与定向测试通过；未执行浏览器/移动窄屏（符合本条要求）。全仓 88 个既存错误不属本条 |
| PWB-20 | 通过 | 确认侧栏按连接/Schema 分组、默认显示完整标识与纳入原因——`publish-impact-review.test.tsx` 的分组与折叠用例 |
| PWB-21 | 通过 | 同表多文件原因合并且总表数去重——`publish-impact-review.test.tsx`「renders both reasons of a table but counts the table once」 |
| PWB-22 | 通过 | 超过 8 张表可查看完整范围、搜索显示正确总数——`publish-impact-review.test.tsx`「renders every table of a large batch — the list is never truncated」「filters the DISPLAY only — the synced range stays whole」 |
| PWB-23 | 通过 | 每条原因可追溯到同版本证据；缺身份或范围解析不完整时阻止提交——`publish-impact-review.test.tsx`「blocks the submission and names the blocking reasons when the range is incomplete」 |
| PWB-24 | **部分通过（不构成收口阻塞）** | 静态复核：宽度 `min(880px, calc(100vw - 48px))`、`maxWidth: 960px`、面板 `maxHeight: calc(100vh - 48px)`、正文 `flex: 1 / min-height: 0 / overflow-y: auto`、页头页脚固定，全部为本组件内联样式；共享 `.pl-drawer-panel` / `.pl-review-layout` 未改。**浏览器实测未做**——按「闭口层级」，浏览器走查不在本条出口，不阻塞收口；主 Spec §7 仍写「部分通过」 |
| PWB-25 | **通过（本轮补）** | `publish-sync-confirm-drawer.test.tsx`「keeps the panel open and the reviewed content when the submission fails」「keeps the reviewed content and the block reason when the range needs verification」「refuses a duplicate submit while the request is in flight」 |
| PWB-26 | **通过（本轮补）** | `publish-workbench-closure.test.ts`「gives the same range, reasons and totals for a staged batch and a plain sync」「keeps the same rules after a baseline exists — the reason is derived, not guessed」 |

## 残余，不打回本条

- **PWB-24 的浏览器走查未做**（880px 侧栏在真实视口下的观感、长表名换行）。按「闭口层级」不在本条出口，因此不构成本条收口的阻塞项；但**没有实测过就不能写成通过**——主 Spec §7 保留「部分通过」。
- **`npm run e2e:selector-contract` 当前整体为红**（201 条）。本条涉及文件里新增的 `data-testid`（`publish-sync-confirm-*`、`publish-impact-*`）是否已全部登记进 `docs/qa/selector-contract.md`，本轮**未逐条核对**——该门禁不属本条出口，但它会把这批新 id 一并计入红灯。
- **G31 与终态保障的归属不变。** 主 Spec §8 第 1 条的 S0 裁决只是**核对**了现有窗口已把终态核验、终态审计与基线推进放在同一串行窗口内；**本条未恢复、未关闭 G31**，也未改动 `publish-coordinator.ts` 与 `semantic-recovery-journal.ts` 的锁生命周期。是否据 S0 裁决关闭 G31，仍由 L25-11／L25-16 的维护者决定。
- **全仓 typecheck 88 个既存错误**与本条无关（纯前端/服务端既有代码），本条涉及文件为 0 错误。
- 移动窄屏、镜像构建、部署与客户交付均未执行。

## 不在收口里

客户镜像、Helm、集群部署、客户环境验证与客户交付，都不在这条里。本条收口不表示可上线，也不构成客户包验收。
