# 发布工作台三栏与待发布口径 Implementation Plan

> 执行方式：已获用户授权，按 executing-plans 逐阶段实施。S0–S6 已执行；PWB-01–26 的逐条结论见交付报告与主 Spec §7。

**Goal:** 将工作台调整为「待发布变更 / 生效准备 / 最近发布」，使待办准确反映尚未确认生效的内容，并在确认侧栏清楚呈现涉及哪些表及逐表纳入原因。

**Architecture:** Lucy 统一读取作者内容与持久化同步基线，向列表、校验、确认及批量计划提供同一版本快照。服务端计算完整表身份、影响原因与证据，前端共享影响审阅组件。发布仍走既有协调器与索引管线，最近发布复用既有发布记录，三栏与宽确认侧栏只在当前页面应用。

**Tech Stack:** React、TanStack Query、TypeScript、Fastify、Node.js 文件系统、现有 KTX CLI、Vitest 与 Testing Library。

| 元数据 | 内容 |
|---|---|
| 版本 / 日期 | v0.3 / 2026-10-30 |
| 主 Spec | [发布工作台三栏 Spec](../specs/lucy-20261030-publish-workbench-three-column-spec.md) v0.3 |
| 状态 | S0–S6 已执行；PWB-01–26 的逐条结论见交付报告 |
| 授权边界 | 已授权编码与测试开发；**不授权**浏览器走查、移动窄屏、镜像构建、部署、提交或推送 |
| 验收 | PWB-01–PWB-26（主 Spec §7）；自动化用例见 §5「验收」 |
| 发布归属 | 待后续确定，不自动调整 Lucy 产品版本或制品版本 |

v0.2 增补：按用户第二张截图，将「确认同步索引并生效」侧栏纳入本次设计，新增逐表原因、证据、完整列表与阅读布局任务。

v0.3（2026-10-30，已执行）：按 v0.2 的设计分阶段落地。本版只登记**实现事实**与**未执行的验收项**。文件名按仓库落盘规则改为 `lucy-20261030-publish-workbench-three-column-plan.md`，与主 Spec 同编号。

## 1. 实施目标

1. 待办只反映「当前作者内容」与「最近有可靠同步证据的内容版本」的差异。Git diff 与会话写入记录只用于**发现**变化，不用于证明是否已生效。
2. 三栏固定为「待发布变更 / 生效准备 / 最近发布」；只有中栏有发布主动作，页头不重复主按钮。
3. 确认侧栏按连接与 Schema 分组，逐表给出**有证据的**纳入原因与可展开证据，展示完整范围，不得静默截断。
4. 影响说明由服务端按同一 pendingDigest 计算；表身份是 `connectionId + schema + table`，同名表不合并。

## 2. 开工前置与 S0 裁决

### 2.1 S0 冻结的合同

- 作者内容写入口、实际索引读取面与内部文件排除规则已逐条核对（`.ktx-ui/**`、`wiki/.lucy-history/**`、编辑历史、缓存、临时文件、越界符号链接均不入待办）。
- 状态目录与完整性合同、原子提交顺序、attempt 对账、内容规模上限与磁盘不足行为已冻结：**扫描不完整时禁止返回空待办**，必须以 `complete=false` 暴露具体缺口。
- 最近发布过滤、状态映射、资产类型校验与旧客户端兼容字段已确认。
- 术语与设计治理已登记：`webui/docs/00-product-terminology-standard.md` §4.3／§3、`webui/docs/design-system/99-governance.md` TD-20261030-01。

### 2.2 终态窗口的裁决（S0 结论）

**问题：** G31 与终态锁生命周期挂起、无 owner。本计划不恢复、不关闭、不修改 `publish-coordinator.ts` 与 `semantic-recovery-journal.ts` 的锁生命周期。

**核对结果（证据）：**

| 发布路径 | 终态核验 | 终态审计 | 放锁位置 | 证据 |
|---|---|---|---|---|
| 批量发布 | `verifyFinalTargetDigests` | `recordConfigChange({ change_type: "semantic_publish_terminal" })` + `updateReleaseRecord(status: published, activationStatus: confirmed)` | `runReindex` 的 `finally` → `releasePublishLock` | `webui/server/semantic-assets.ts` 的 `runReindex`（终态四步在放锁之前） |
| 手动 reindex | 本功能新增的**消费漂移核验** | `recordManualReindex`（发布历史记录） | `withPublishCoordinator` 的 `finally` | `webui/server/index.ts` 的 `/api/semantic-assets/reindex` |

**结论：现有发布窗口已经把终态核验、终态审计与基线推进放在同一串行窗口内**，因此**只把基线 CAS 接进已经存在的窗口**即可——不新造锁、不改协调器、不依赖注释宣称串行。G31 的代码事实已由 L25-16 Spec 登记为闭合（2026-10-30 更新），但**本会话不据此关闭 G31**，也不改动 L25-11／L25-15 的冻结合同。

**因此 PWB-03、PWB-10、PWB-12 不因终态保障缺失而阻断**：三者的证据链都在上述窗口内取得，且有自动化用例覆盖。

### 2.3 实施原则与顺序

先冻结内容范围、终态互斥与证据合同，再实现待办事实源，最后接入三栏。布局和待办真实性作为同一功能验收；仅完成三栏不能宣称「已发布不再重复出现」。

不修改 KTX 源码，不新增分文件发布，不实现历史恢复，不把新基线当成新的索引或授权来源。每阶段只提交明确列出的相关文件，保留其他会话与用户改动。

本 Plan 不要求额外创建 agent 或 chat。浏览器、移动窄屏测试和客户部署验证均不在默认实施范围。

## 3. 文件影响面

| 文件 | 变更 |
|---|---|
| 新增 `webui/server/publish-workbench-state.ts` | 业务内容枚举、完整身份、摘要、统一待办快照、基线与 attempt 持久化及对账 |
| 新增 `webui/server/publish-impact.ts` | 同快照影响模型，Manifest 逐表比较、overlay 原因、完整身份合并、Wiki 与关联/校验范围分离、证据引用完整性 |
| `webui/server/index.ts` | `/api/diff`、`/api/validate-changed`、`/api/semantic-assets/reindex` 统一快照与版本校验；新增 `/api/publish-workbench/evidence`；启动对账 |
| `webui/server/semantic-assets.ts` | 最近业务批次服务端过滤；消费证据的采集/提交/对账；批量发布路径接入基线 CAS |
| `webui/server/semantic-batch-routes.ts` | 批量计划返回同版本 `impact` |
| `webui/server/publish-coordinator.ts`、`semantic-recovery-journal.ts` | **未修改**：锁生命周期不属本功能授权范围 |
| `webui/server/content-mirror.ts` | **未修改**：镜像漂移仍是只读诊断 |
| `webui/src/lib/types.ts` | 新增影响模型与快照版本类型 |
| `webui/src/lib/queryKeys.ts` | 最近发布查询键包含过滤参数 |
| `webui/src/lib/publishHistoryLabels.ts` | **未修改**：直接复用既有状态映射 |
| `webui/src/pages/publish/PublishWorkbench.tsx` | 三栏结构、独立加载/失败/空态、版本绑定校验与刷新 |
| 新增 `webui/src/components/semantic-assets/PublishRecentReleases.tsx` | 最近 5 个业务批次摘要，复用历史页标签和状态语义 |
| 新增 `webui/src/components/semantic-assets/PublishImpactReview.tsx` | 按连接/Schema 分组、逐表原因与证据就地展开、其他内容明细、搜索/折叠与完整范围计数 |
| 新增 `webui/src/components/semantic-assets/PublishSyncConfirmDrawer.tsx` | 同步确认专用宽侧栏，固定页头页脚、正文单一滚动、版本更新与失败保留 |
| `webui/src/components/semantic-assets/PublishBatchPlanPanel.tsx` | staged 候选与真实磁盘待办统一展示，复用影响审阅组件，保留既有覆盖确认 |
| `webui/src/app/app.css` | 新增本页三栏样式（`.pl-publish-workbench-layout` 等）；未改共享 review 布局或所有抽屉规则 |
| `webui/docs/00-product-terminology-standard.md`、`design-system/99-governance.md` | 登记标题和三栏模式，并明确修订 Spec 123 的旧约束 |
| `webui/docs/119-…`、`121-…`、`123-…`、`docs/ui-ux-feedback/pages/publish-workbench.md` | 更新布局、确认侧栏规范引用与台账 |

## 4. 分阶段任务与执行结果

### S0：核对与冻结实施合同 —— 已执行

合同见 §2.1，终态窗口裁决见 §2.2。

### S1：实现统一待办快照与持久化 —— 已执行

生产文件：`webui/server/publish-workbench-state.ts`。测试文件：`webui/server/__tests__/publish-workbench-state.test.ts`。

- 内容枚举按内容根解析逻辑相对路径，原始字节 SHA-256；删除用显式 absent 状态，空文件与不存在不合并。
- 内部文件排除规则可审计（排除项被记录，不静默丢弃）。
- 基线为 `.ktx-ui/publish-workbench/baseline.json`（目录 0700、文件 0600、原子替换），blob 内容引用就绪后才替换指针。

### S2：绑定发布消费版本与终态证据 —— 已执行

生产文件：`publish-workbench-state.ts`、`index.ts`、`semantic-assets.ts`。测试文件：`webui/server/__tests__/publish-workbench-lifecycle.test.ts`。

- 消费快照在**索引读取内容之前**采集；成功后按代次 CAS 推进基线；失败、漂移、证据缺失一律不推进。
- 启动对账幂等补齐：只有终态证据与消费快照都成立才补齐。

### S3：统一 API、校验与批量计划 —— 已执行

生产文件：新增 `webui/server/publish-impact.ts`；修改 `index.ts`、`semantic-assets.ts`、`semantic-batch-routes.ts`、`src/lib/types.ts`。测试文件：新增 `webui/server/__tests__/publish-impact.test.ts`、`webui/server/__tests__/api.publish-workbench.test.ts`。

### S4：落实三栏工作台 —— 已执行

生产文件：`PublishWorkbench.tsx`、三个新组件、`PublishBatchPlanPanel.tsx`、`queryKeys.ts`、`app.css`。测试文件：扩展 `src/__tests__/review.test.tsx`；新增 `src/__tests__/publish-recent-releases.test.tsx`、`src/__tests__/publish-impact-review.test.tsx`。

### S5：定向验证与静态复核 —— 已执行

见 §5。

### S6：文档回写与交付 —— 已执行

见 §6。

## 5. 验收

### 5.1 自动化用例

| 套件 | 覆盖 |
|---|---|
| `server/__tests__/publish-workbench-state.test.ts` | 首次核对、无 Git 依赖、删除/空文件/缺失三态、内部文件排除、符号链接排除、代次 CAS、损坏基线、内容根绑定变化、目录权限、消费快照与漂移 |
| `server/__tests__/publish-workbench-lifecycle.test.ts` | 成功同步清空待办并推进基线、索引失败保留待办与基线、旧版本确认 409、索引期间漂移不消费、崩溃后幂等对账、缺证据不补造成功 |
| `server/__tests__/publish-impact.test.ts` | 同名跨连接不合并、overlay+Manifest 原因合并、Manifest 只计真正变化的表、Schema 级变更分区、Wiki 分区、身份不可解析即不完整、首次核对措辞、超过 8 张表不截断、引用依赖分区 |
| `server/__tests__/api.publish-workbench.test.ts` | `/api/diff` 的快照版本与影响、`/api/validate-changed` 的快照派生范围、`businessChangesOnly` 服务端先过滤后限额、证据接口的约束与拒绝 |
| `src/__tests__/review.test.tsx` | 三栏阅读顺序、唯一发布主动作、分组与计数、待办失败不显示空态、旧校验不覆盖新状态 |
| `src/__tests__/publish-recent-releases.test.tsx` | 最近发布的状态呈现、未确认记录不写成已生效、加载/失败/空态 |
| `src/__tests__/publish-impact-review.test.tsx` | 完整范围不截断、多原因合并计数、搜索只影响展示、分组折叠保留总数、各分区呈现、阻断提示、证据就地展开 |

### 5.2 静态检查

`npm run lint:terminology`、`npm run lint:ia-boundary`、typecheck、`npm run build`。

### 5.3 未执行的验收

浏览器走查、移动窄屏、镜像构建、客户部署、提交与推送**均未执行**。PWB-24 的桌面几何可读性只做了静态复核，未实测。

## 6. 完成定义

1. 三栏工作台、宽确认侧栏、待办事实源与影响模型按主 Spec §4–§6 落地，且没有第二套发布引擎。
2. 待办只由「当前内容 vs 有证据的基线」决定；确认列表不静默截断；搜索不缩小提交集；旧校验不覆盖新版本；成功后不再读磁盘伪造成已消费证据；内部历史不回流；缺证据不补造 confirmed。
3. 定向测试、`lint:terminology`、`lint:ia-boundary`、typecheck 与 build 通过；与本功能无关的既有失败单独记录归属。
4. 文档回写完成：Spec／Plan 版本与状态、存量 Spec 119/121/123 的局部修订引用、UI/UX 台账、术语标准与设计治理登记。
5. **本条完成不表示可上线**：浏览器走查、镜像构建与客户交付仍未授权。

## 7. 风险与回滚

| 风险 | 说明 | 处置 |
|---|---|---|
| 消费漂移 | 索引期间内容被外部改动 | 漂移检测命中即不推进基线，范围保留待办并标待核验 |
| 基线代次冲突 | 并发发布推进了代次 | CAS 拒绝覆盖，保留新证据，本次 attempt 标为 uncertain |
| 崩溃窗口 | 终态记录已落盘但基线未推进 | 启动对账幂等补齐；缺证据则保留原基线并标待核验 |
| 状态目录损坏 | `.ktx-ui/publish-workbench/` 损坏或绑定变化 | `baselineState = needs_verification`，禁用提交，不静默生成空基线 |
| 共享工作区并发 | 多会话同时改同一仓库 | 本次只追加本规格所需差异，未回退他人改动；提交与推送不在授权内 |
| 回滚 | 本功能需要整体撤销 | 删除 `.ktx-ui/publish-workbench/` 状态目录并回退相关代码；该目录不含业务内容，回滚不丢作者内容 |

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None（沿用主 Spec 的术语登记；「最近发布」「涉及的表」「影响原因」「变更来源」「Schema 级变更」「关联与校验范围」「影响范围待核对」「首次核对」「待核对」「生效状态待核验」已在主 Spec 与术语标准 §4.3 登记）

修订说明：「待发布变更」由术语标准 §4.3 的禁止文案改为左栏主术语；同步登记见 `webui/docs/00-product-terminology-standard.md` §4.3 与 §3。

## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/02-foundations-grid-spacing.md`
- `webui/docs/design-system/03-foundations-typography.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`（临时决策 **TD-20261030-01**）

### What This Change Follows
- [x] 12 列网格下的 4/5/3 初始比例；统一 gutter/padding；不做移动端重排。
- [x] 主任务优先：最近发布作为弱化的辅助区，变更详情按需抽屉。
- [x] 工作区最多一个发布主动作；页眉不重复主按钮。
- [x] 确认侧栏以可读对象列表与原因分层；长标识符换行；不用整屏路径代替影响说明。
- [x] 颜色只使用语义 token；状态有文字，不只靠颜色。
- [x] 焦点态、禁用态、加载态与失败态均有文字说明。

### Exceptions (If Any)
- 宽确认侧栏宽度由组件内联样式给出（目标 880px、最大 960px），未写入共享 `.pl-drawer-panel`；三栏使用本页专属 `.pl-publish-workbench-layout`，未修改共享 `.pl-review-layout`。该模式登记为 TD-20261030-01。

### Follow-up Needed
- 桌面几何可读性尚未做浏览器实测，留待发版走查。
- TD-20261030-01 待升级为 `20-patterns-page-layout.md` 的正式章节。

## 8. 当前交付记录

- 已完成：Spec v0.3、Plan v0.3 文档落盘与索引登记；三栏工作台与宽确认侧栏的实现；S0–S6 全部执行；术语标准与设计治理登记；存量 Spec 119/121/123 的局部修订引用；UI/UX 台账新增 UX-PUBLISH-WORKBENCH-009。
- 未执行：浏览器走查、移动窄屏、镜像构建、部署、提交与推送；PWB-24 的几何实测。
- 已知依赖：G31 与 L25-11／L25-15 的冻结合同未被本功能改动，也未被本功能关闭。
