# 发布工作台三栏与待发布口径 Implementation Plan

> 执行方式：后续获准开发后，使用 executing-plans 按任务逐步实施；当前用户明确要求「先不开发」，不启动执行。

**Goal:** 将工作台调整为「待发布变更 / 生效准备 / 最近发布」，使待办准确反映尚未确认生效的内容，并在确认侧栏清楚呈现涉及哪些表及逐表纳入原因。

**Architecture:** Lucy 统一读取作者内容与持久化同步基线，向列表、校验、确认及批量计划提供同一版本快照。服务端计算完整表身份、影响原因与证据，前端共享影响审阅组件。发布仍走既有协调器与索引管线，最近发布复用既有发布记录，三栏与宽确认侧栏只在当前页面应用。

**Tech Stack:** React、TanStack Query、TypeScript、Fastify、Node.js 文件系统、现有 KTX CLI、Vitest 与 Testing Library。

| 元数据 | 内容 |
|---|---|
| 版本 / 日期 | v0.2 / 2026-10-30 |
| 主 Spec | [发布工作台三栏 Spec](../specs/lucy-20261030-publish-workbench-three-column-spec.md) |
| 状态 | 文档待评审；S0–S6 未执行；PWB-01–26 全部未执行 |
| 授权边界 | 本轮仅文档落盘，不授权编码、测试开发、构建、部署或推送 |
| 发布归属 | 待后续确定，不自动调整 Lucy 产品版本或制品版本 |

v0.2 增补：按用户第二张截图，将「确认同步索引并生效」侧栏纳入本次设计，新增逐表原因、证据、完整列表与阅读布局任务，未启动开发。

## 1. 实施原则与顺序

先冻结内容范围、终态互斥与证据合同，再实现待办事实源，最后接入三栏。布局和待办真实性作为同一功能验收；仅完成三栏不能宣称「已发布不再重复出现」。

不修改 KTX 源码，不新增分文件发布，不实现历史恢复，不把新基线当成新的索引或授权来源。每阶段只提交明确列出的相关文件，保留其他会话与用户改动。

本 Plan 不要求额外创建 agent 或 chat。浏览器、移动窄屏测试和客户部署验证均不在默认实施范围。

## 2. 文件影响面

以下是后续实施清单，**本轮不创建这些生产文件或测试文件**。

| 文件 | 计划变更 |
|---|---|
| 新增 `webui/server/publish-workbench-state.ts` | 业务内容枚举、完整身份、摘要、统一待办快照、基线与 attempt 持久化及对账 |
| 新增 `webui/server/publish-impact.ts` | 同快照影响模型，Manifest 逐表比较、overlay 原因、完整身份合并、Wiki 与关联/校验范围分离、证据引用完整性 |
| `webui/server/paths.ts`、`content-layout.ts`、`content-mirror.ts` | 只读复核实际内容根和索引读取面；仅在 S0 定义确有必要的范围内接入，不扩大镜像删除职责 |
| `webui/server/diff.ts` | 保留通用 diff 能力；将业务待办与 Git 原始差异解耦，不删除其他调用方依赖的功能 |
| `webui/server/index.ts` | diff/validate/reindex 统一快照，确认版本校验，终态与基线接线，初始化对账 |
| `webui/server/semantic-assets.ts` | 最近业务批次服务端过滤；批量计划/提交消费统一待办；终态接线受 S0 权属裁决约束 |
| `webui/server/semantic-batch-service.ts`、`semantic-batch-routes.ts` | 核查批量校验和计划范围的接入点，保留既有 planDigest、授权和幂等合同 |
| `webui/server/publish-coordinator.ts`、`semantic-recovery-journal.ts` | 依赖复核；不默认为本功能授权修复范围 |
| `webui/src/lib/types.ts`、`queryKeys.ts` | 新响应字段、影响模型及证据类型、快照版本、最近发布过滤参数及查询缓存隔离 |
| `webui/src/pages/publish/PublishWorkbench.tsx` | 三栏结构、独立加载/失败/空态、版本绑定校验与刷新 |
| 新增 `webui/src/components/semantic-assets/PublishRecentReleases.tsx` | 最近 5 个业务批次摘要，复用历史页标签和状态语义 |
| 新增 `webui/src/components/semantic-assets/PublishImpactReview.tsx` | 按连接/Schema 分组、逐表原因与证据就地展开、其他内容明细、搜索/折叠与完整范围计数 |
| 新增 `webui/src/components/semantic-assets/PublishSyncConfirmDrawer.tsx` | 同步确认专用宽侧栏，固定页头页脚、正文单一滚动、版本更新与失败保留 |
| `webui/src/components/semantic-assets/PublishBatchPlanPanel.tsx` | staged 候选与真实磁盘待办统一展示，复用影响审阅组件，保留既有覆盖确认，提交与终态后同步刷新 |
| `webui/src/lib/publishHistoryLabels.ts` | 优先直接复用；只补可复用的摘要格式，不改变旧记录生效证据 |
| `webui/src/app/app.css` | 新增本页三栏与同步确认侧栏限定样式；不直接改共享 review 布局或所有抽屉规则 |
| `webui/docs/00-product-terminology-standard.md`、`design-system/99-governance.md` | 实施前登记标题和三栏模式，并明确修订 Spec 123 的旧约束 |
| `webui/docs/119-publish-workbench-queue-gate-ia-spec.md`、`webui/docs/121-publish-workbench-cta-confirm-spec.md`、`webui/docs/123-publish-workbench-activation-ia-spec.md`、`docs/ui-ux-feedback/pages/publish-workbench.md` | 更新布局、确认侧栏规范引用与台账，状态按实现/验收事实填写 |

## 3. 分阶段任务

### S0：核对与冻结实施合同

**输入文件：** 主 Spec §5–8、`webui/server/paths.ts`、`ktx.ts`、`publish-coordinator.ts`、`semantic-assets.ts`、`semantic-recovery-journal.ts`、`docs/governance/project-overview.md` 中 G31/S0 外部工作项状态。

1. 列出所有作者内容写入口、实际索引读取面与内部文件排除规则，区分业务 Wiki 与编辑历史。
2. 核对 staged 发布、手动同步、首次启用、外部编辑和删除路径；保留内容根/镜像漂移诊断。
3. 明确终态锁生命周期修复的 owner、授权工作项和交付前置。现有相关工作项挂起，不在本计划静默恢复或顺带修复。
4. 冻结状态目录与完整性合同、原子提交顺序、attempt 对账、内容规模上限和磁盘不足行为；不得截断扫描后返回无待办。
5. 确认最近记录过滤、状态映射、资产类型校验与旧客户端兼容字段，必要时先修订主 Spec。
6. 同步术语与设计治理登记；说明只影响当前工作台，不把 4/5/3 套入全局 review 页面。
7. 冻结确认影响模型和证据映射：明确表文件、Manifest 逐表变化、Schema 级变化、Wiki、首次核对和仅校验依赖的边界；确认不能仅枚举 overlay 文件或按裸表名合并。宽侧栏目标 880px / 最大 960px，页头页脚固定、正文单一纵向滚动的模式先登记后实施。

**完成条件：** 上述合同有可复核记录，终态保障的归属和可用性明确，另获开发授权。若保障仍不可用，可继续文档工作，但不得交付完整发布状态闭环。

### S1：实现统一待办快照与持久化

**生产文件：** 新增 `webui/server/publish-workbench-state.ts`；按需复用 `paths.ts`、`diff.ts`、`fs-safe.ts`。

**测试文件：** 新增 `webui/server/__tests__/publish-workbench-state.test.ts`。

1. 为新增/修改/删除、空文件、Git 脏但已同步、无 Git、重启、内部文件排除和完整表身份编写失败用例。
2. 运行该测试，确认失败来自缺少目标能力，而不是环境错误。
3. 实现逻辑路径到实际内容根解析、原始字节摘要、基线映射和前版本内容引用；读请求不修改业务内容。
4. 实现首次核对、损坏/绑定变化、扫描失败、快照版本与稳定排序；无可信前版本时不伪造 diff。
5. 通过同一组测试，检查未跟踪/已暂存文件、越界链接、文件大小限制及空项目分支。

**完成条件：** PWB-02/06–08/11/16 有针对性的测试通过；不依赖 Git clean 或进程内写入集合。

### S2：绑定发布消费版本与终态证据

**生产文件：** `publish-workbench-state.ts`、`index.ts`、`semantic-assets.ts`；协调器改动仅能来自 S0 明确授权范围。

**测试文件：** 扩展 `webui/server/__tests__/api.semantic-assets.reindex.test.ts`；新增 `webui/server/__tests__/publish-workbench-lifecycle.test.ts`。

1. 先写同步成功、索引失败、外部并发变更、终态失败、基线写失败、崩溃后补齐及代次冲突用例。
2. 在实际索引读取之前捕获并持久化消费版本，保持成功判定与终态结算处于同一串行窗口。
3. 失败保留旧基线；可靠成功后 CAS 推进基线；不能以 reindex 返回后的磁盘快照充当消费证据。
4. 实现启动幂等对账：成功终态与消费证据一致才补齐；证据缺失时保留待核验，不自动运行索引或回滚。
5. 加入内容根与镜像分离、删除仍被旧镜像收录时不能假成功的用例。检查状态目录不会被索引、导出或作为业务待办。

**完成条件：** PWB-03/04/07/10–12/18 的相关用例通过；保留 G31 等既有工作项的真实状态，不代签通过。

### S3：统一 API、校验与批量计划

**生产文件：** 新增 `webui/server/publish-impact.ts`；修改 `index.ts`、`semantic-assets.ts`、按需接入 `semantic-batch-service.ts` / `semantic-batch-routes.ts`、`src/lib/types.ts`。

**测试文件：** 新增 `webui/server/__tests__/api.publish-workbench.test.ts`、`webui/server/__tests__/publish-impact.test.ts`；扩展 `api.semantic-assets.reindex.test.ts`、`api.semantic-assets.publish.test.ts`、必要的批量计划测试。

1. 扩展 `/api/diff` 返回快照版本和基线状态，保持现有字段兼容。
2. 从同一快照生成校验范围；按完整身份定位表，并纳入适用的 Wiki、Manifest 和删除校验。
3. 确认和提交绑定 pendingDigest，内容变化返回 409 并保留待办；批量 planDigest 和覆盖确认继续生效。
4. 为最近记录增加 `businessChangesOnly=true`，先筛选再分页；验证原完整历史接口调用结果不变。
5. 为同路径变更、旧校验晚返回、无 overlay 但有合法 Wiki 批次、候选批次混合磁盘待办和旧调用方补回归。
6. 从同版本快照建立影响模型：比较 Manifest 的实际变化表；同表 overlay/Manifest 原因合并；按完整身份去重；Wiki、Schema 级变化、仅关联/校验对象独立输出。首次核对没有可信前版本时明确标注，不能猜变化项。
7. 为同名跨连接、同表多原因、Manifest 仅改 1 张而包含多张表、纯格式变化、超过 8 张表、证据缺失和身份无法解析编写失败用例并实现。影响范围不完整时 `complete=false`，不能把不完整结果包装成精确的全量确认。
8. `/api/diff` 与批量计划返回同版 impact；按同快照引用取得证据，不允许任意路径读盘。提交再次检查覆盖完整性与版本；确认搜索条件不参与服务端缩小发布集。

**完成条件：** PWB-05/09/13/18/20–23/26 的服务端用例通过；不同区域的范围、原因、证据和版本不相互矛盾。

### S4：落实三栏工作台

**生产文件：** `PublishWorkbench.tsx`、新组件 `PublishRecentReleases.tsx`、`PublishImpactReview.tsx`、`PublishSyncConfirmDrawer.tsx`、`PublishBatchPlanPanel.tsx`、`queryKeys.ts`、`app.css`。

**测试文件：** 扩展 `webui/src/__tests__/review.test.tsx`；新增 `webui/src/__tests__/publish-recent-releases.test.tsx`、`webui/src/__tests__/publish-impact-review.test.tsx`；仅在标签复用改动时扩展 `publish-history.test.tsx`。

1. 建立组件测试，验证三栏阅读/DOM 顺序、独立加载与报错、文件计数和唯一发布主操作。
2. 左栏按业务对象分组并保留完整身份；接入真实差异或无前版本降级说明。
3. 中栏承载校验与发布动作，绑定内容版本，保留整批确认；移除 Header 重复动作。
4. 右栏显示最近 5 个业务批次，复用历史状态映射，添加完整记录入口；不显示未经证据确认的成功。
5. 实现保存/发布/焦点回归刷新、进行中状态有界生命周期轮询，终态停止；用 fake timers 验证定时器清理。
6. 用组件测试覆盖空态、请求失败、午夜跨日、同名表、长路径、Escape 和焦点归还。组件测试不启动浏览器。
7. 将当前确认名单替换为专用宽侧栏和共享影响审阅组件：顶部范围摘要，正文按连接/Schema 分组，每表默认显示身份、纳入原因、来源和校验状态；Wiki 与其他范围独立列明，移除静默 `slice(0, 8)`。
8. 实现就地展开同版本证据，保留阅读状态；搜索显示当前/总数且不影响全批提交。常规与 staged 确认复用原因展示，后者保留原计划摘要和覆盖确认。
9. 增加组件用例：超过 8 张表均可访问、Wiki 明细可见、同表多原因不重复计数、搜索无结果仍是全批提交、影响不完整/版本更新禁用提交、失败不关闭、可靠成功才关闭。静态复核本页 CSS 的固定页头页脚、单正文滚动、宽度与长名称换行规则，不冒充实测几何验收。

**完成条件：** PWB-01/02/05/13–17/20–26 的前端适用用例通过；页面样式不影响共享 review 布局或其他抽屉；视觉可读性未实测时明确记录。

### S5：定向验证与静态复核

以下命令是后续实施验证命令，**本轮均不执行**。工作目录为 `webui/`：

```bash
npx vitest run --maxWorkers=1 server/__tests__/publish-workbench-state.test.ts server/__tests__/publish-workbench-lifecycle.test.ts server/__tests__/api.publish-workbench.test.ts server/__tests__/api.semantic-assets.reindex.test.ts server/__tests__/api.semantic-assets.publish.test.ts
npx vitest run --maxWorkers=1 server/__tests__/publish-impact.test.ts
npx vitest run --maxWorkers=1 src/__tests__/review.test.tsx src/__tests__/publish-recent-releases.test.tsx src/__tests__/publish-history.test.tsx src/__tests__/publish-impact-review.test.tsx
npm run lint:terminology
npm run lint:ia-boundary
npm run typecheck
npm run build
```

预期：定向测试、静态检查与构建通过。若当时代码已有无关失败，记录命令、具体文件和归属，不能把未通过写为通过，也不扩展为无关修复。批量计划的实际改动若涉及上述未覆盖测试，追加最小相关套件。

复核重点：无旧校验被复用、无成功后再取磁盘伪证据、无内部历史回流、无共享布局影响、无缺证据补造 confirmed、无绕过恢复阻断；确认列表未静默截断、原因有证据、Manifest 范围完整、搜索不改变提交集、侧栏异常不自动关闭。只有出现新改动或未解疑点时才扩大或重复测试。

不默认执行 Playwright/Cypress、浏览器截图、移动窄屏、Docker 重建或客户部署；若以后单独授权，再补相应验收记录，不把组件测试冒充视觉验收。

### S6：文档回写与交付

1. 按实现事实更新 Spec 版本、文件清单、API 合同与 PWB-01–26 证据，不把未执行项打勾。
2. 在既有 Spec 119/121/123 增加被本 Spec 局部修订的引用，保留旧规则历史，不继续维护两套相冲突的现行布局与确认范围要求。
3. 更新 UI/UX 台账、文档索引及 Design System Compliance，说明已做验证和未做验证。
4. 提交/推送/部署仅按届时授权执行；本 Plan 本身不构成发版或交付放行。

## 4. 需求与任务追踪

| 目标 | Spec 验收 | 实施阶段 |
|---|---|---|
| 待发布优先与三栏主次 | PWB-01/02/14/17 | S4 |
| 已同步移出，再修改重新进入 | PWB-03/04/06–08/10–12 | S1/S2 |
| 校验与确认绑定同一内容 | PWB-05/09/18 | S2/S3/S4 |
| 历史准确、跨日不丢上下文 | PWB-13/15 | S3/S4 |
| 差异可信与无基线降级 | PWB-11/16 | S1/S4 |
| 确认侧栏逐表原因、完整范围与证据 | PWB-20–23/26 | S0/S3/S4 |
| 确认侧栏阅读布局、交互与失败保留 | PWB-24/25 | S4/S5 |
| 适用检查和文档闭合 | PWB-19 | S5/S6 |

## Terminology Compliance

沿用主 Spec 的术语登记；新标题先同步全局术语标准，再进入 UI 文案或测试断言。专业英文、完整对象身份、文件名、路径与 URL 按规范防浏览器翻译。

## Design System Compliance

引用 `webui/docs/design-system/02-foundations-grid-spacing.md`、`03-foundations-typography.md`、`10-components-button.md`、`20-patterns-page-layout.md`、`99-governance.md`。遵循 12 列网格、4/5/3 初始比例、单一发布主操作、历史弱层级、详情抽屉与桌面最小可读宽度；确认侧栏采用可读对象条目、完整长名称、逐表原因、固定页头页脚和正文单一滚动，宽度不污染其他抽屉。新增页面模式先登记、后落代码。

## 5. 当前交付记录

- 已完成：Spec、Plan v0.2 文档落盘及索引登记，已纳入确认侧栏优化。
- 未执行：S0–S6、PWB-01–26、产品代码、测试开发、运行时迁移、浏览器验证、镜像构建与部署。
- 下一步：评审文档；用户后续明确授权开发后，才进入 S0，不因本计划存在而自动开工。
