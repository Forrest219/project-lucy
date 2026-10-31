# Lucy v0.25 语义资产批量维护 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.2-requirements-review |
| 日期 / 目标版本 | 2026-10-24 / v0.25；2026-10-27 交叉审阅局部修订 |
| 功能编号 / 优先级 | L25-11 / P0-3，企业批量运维核心能力 |
| 状态 | **已关闭**（2026-10-31，§10.3）。用户批准拆分：本条以 FC-01–FC-32 关闭，证据见 `docs/reviews/2026-10-31-l25-11-functional-contract-evidence.md`。`SEM25-V01`…`V22` 由 E2E Spec 持有且未执行，不回开本条。V01–V22 矩阵行不改成通过。G30 仍开。不关闭 G31，不打开 W-B。Wave 0b 与客户交付保持 `blocked_delivery`。本条关闭不表示可上线 |
| 评审状态 | **文档层面的交叉审阅与修订已于 2026-10-27 收口（`f008490a`）；但 2026-10-27 的独立审阅结论为「退回」**（1 阻塞 + 5 高 + 2 中 + 0 低；审阅未改本 Spec 正文与 V01–V22），其后 `2e98be74` 落地 D1–D23 生产接线、**尚未复审**。差距属实现缺口（生产接线、发布 CAS、恢复终结、协调器临界区），**不得概括为"只欠验收"**；应先补齐实现与状态说明，再安排完整 UAT。V01–V22 全部未执行，客户交付保持 `blocked_delivery`。**状态行陈述于 2026-10-28 经 PM 授权做事实对齐**（仅更正状态陈述，不构成实质修订，不改冻结合同与 V01–V22），依据见 §1.5 |
| 授权来源 | 2026-10-24 Forrest 批准首批 Spec 评审 Final 决议，并要求完成四个 P0 设计材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.5；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) |
| 审查入口 | [首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md)；[2026-10-27 独立交叉审阅](../reviews/2026-10-27-codex-review-semantic-batch-operations-p0.md) |
| 实施主体 | Lucy；复用 KTX 既有公开接口，不修改 KTX 源码 |

本文件正文继续定义必须实现的冻结合同，不以当前实现缺口为由降低要求。2026-10-27 本轮仅做静态交叉审阅与 Spec／Plan 文档修订，不修改程序、测试、运行配置、客户资产、镜像或数据库，不执行功能验证、UAT、real-e2e、部署或发布；本修订本身不产生任何验收证据。

## 闭口层级

- 层级：功能合同
- 本条承诺：维护者按完整表身份下载可往返的语义维护包，导入只进入暂存，确认后的完整计划在同一发布窗口内写入、索引并留下可核对的终态；失败先回滚或进入待恢复，不把未生效记成已发布。
- 本条出口：FC-01–FC-32 的仓库内直接检查，含本进程内的失败关闭与局部故障注入。清单见 §10.3。
- 不在本条出口：30 表旅程、Agent 检索、桌面跨页交互、真实打包 KTX 的命令输出、客户 linux/amd64 单副本，以及在已部署进程上强杀再拉起。这些由 `SEM25` 持有。
- 上线关系：本条收口不表示可上线

## 1. 调查基线与证据边界

### 1.1 对比版本

两份基线必须分别保留，不能用本地 HEAD 代替运行镜像的源版本。

| 对象 | 本次记录 | 证据及限制 |
|---|---|---|
| 运行界面 | `http://127.0.0.1:55176/catalog`；本轮调查已登录 | 前一轮只读查看 Catalog、发布工作台；本轮起草不重复浏览器验证 |
| 界面显示版本 | 产品 `v2.0.0`；修订 `135b2a8-dirty` | **2026-10-20 历史运行时读数**；dirty 不能还原为一个干净提交，也不能证明与本地源码一致 |
| 运行容器 / 镜像 | `compose-lucy-1` / `project-lucy:demo` | 2026-10-20 22:39（Asia/Shanghai）只读复核容器身份 |
| 实际镜像 ID | `sha256:46f5a3adc38b35bf22c5af693e073e73a67963812ec5bf71352b3b831b4adb5f` | 容器 `.Image` 与当时 tag 指向一致；本地镜像 ID，不冒充 registry RepoDigest |
| 本地源码（2026-10-20 调查快照） | `/Users/forrest/GitHub/project-lucy`；HEAD `a9eb574b435b813fb18af490d2c03181f5b9d9e9` | 当时工作区有未提交改动；下列摘要记录该次实际读取的关键文件，不冒充当前 HEAD |
| 当前仓库产品版本（2026-10-25 复核） | 根目录 `VERSION=0.20.0`，根 `package.json=0.20.0` | 当前仓库事实；`webui/package.json=1.0.0` 为子包版本，不作为 Lucy 产品版本 |
| 目标版本 | `v0.25` | 规划版本；本次不改 `VERSION`、不升依赖版本 |

关键源码 SHA-256（本次文档写入前的读取快照；不是整仓构建证明）：

| 文件 | SHA-256 |
|---|---|
| `webui/src/pages/Catalog.tsx` | `8247cbc1c5332a58996b0ae078760596ca89f6a43b30382f556b0abfb7fcf2cc` |
| `webui/server/semantic-assets.ts` | `acf8cbb9050f2816dfacf6a23deb416e059592e39c300867f9516f6c2a18a09a` |
| `webui/server/semantic-asset-export.ts` | `68371c13024af2144fa9870dcd35a17cef030525077f7be6a08da75e4dd4c881` |
| `webui/server/index.ts` | `c9a7ef8f1f0db3f4f919900418cf9a2a578ebe910398716b43c3ad33440b02e7` |
| `webui/src/pages/publish/PublishWorkbench.tsx` | `e3fc4bc9a0a84d23b6fdd2dc6cba0f794e4097a8ef10dcff8e9dd7aab6b7ea42` |
| `webui/src/lib/types.ts` | `aaa07090d82dd21b594fc99632531728e5ea8cd5738c8ca66c7f5ec678e21a67` |

### 1.2 已证实事实与拟改进项

| 证据 | 当前事实 | v0.25 增量 |
|---|---|---|
| [Catalog](../../webui/src/pages/Catalog.tsx) | 实机显示 12 张已启用表；有连接 / Schema、搜索、启用范围和语义状态筛选，无多选和批量入口 | 同一范围上的多选、批量下载、批量校验、导入资产包 |
| [发布工作台](../../webui/src/pages/publish/PublishWorkbench.tsx)、[API](../../webui/server/index.ts) | `POST /api/validate-changed` 校验已有变更；不是任意一组现有资产的主动巡检 | 增加独立批量校验；与发布校验共用合法性检查 |
| [资产发布服务](../../webui/server/semantic-assets.ts) | 已有多 YAML / 包预检、staging、发布校验、逐文件 promote 和异步 reindex | 复用服务，补齐身份、预览基线、重试与失败恢复；不另建发布引擎 |
| [导出服务](../../webui/server/semantic-asset-export.ts) | 已有 ZIP 导出；请求范围仅 connection / Schema；Schema 筛选依赖路径字符串 | 按实际模型身份解析所选表、overlay 与依赖，不靠文件名猜归属 |
| 同上及 [API 类型](../../webui/src/lib/types.ts) | 导出上限 200 文件 / 16 MiB；导入上限 50 YAML / 3 MiB，总量和单文件限制不同 | 对维护包统一往返限制，拒绝静默截断 |
| [Spec 123](../../webui/docs/123-publish-workbench-activation-ia-spec.md) | 工作台刻意移除上传 / 导出，只承担校验与整批索引生效 | Catalog 管理输入输出，工作台继续承担生效；不恢复上传导出按钮 |

运行页缺少入口已通过界面观察确认；后端复用结论来自本地源码静态阅读，未对运行镜像做接口贯通证明。现有逐文件 rename 不等于整批事务，已有发布成功状态也不能替代本功能验收。本节是 2026-10-20／2026-10-25 的历史调查记录，不表示 2026-10-27 的当前实现状态。

### 1.3 当前实现状态与后续修复基线（2026-10-27 静态复核）

本小节依据指定提交 `21de5168`、当前 HEAD `7382bac4` 的生产调用链与既有测试源码静态复核。测试文件或测试标签的存在不等于生产入口已接线，也不等于对应 V 项已执行或已覆盖。

| 层次 | 当前事实 | 尚待完成及验收关联 |
|---|---|---|
| 基础模块 | `21de5168` 已加入身份、范围、维护包、共享限额、共享检查、批量任务、持久幂等、恢复日志与 release 状态等基础模块及模块级用例 | 只能登记“基础模块已落地”；不得由 helper 用例推定完整能力。生产复用与端到端证据见 V01–V21 |
| 生产入口 | `scopes` / `check` / `operations` / `plans` 路由已注册；生产导出支持 `packageKind=semantic-maintenance-package/v1` 并留存服务端导出基线；导入走受控 staging；Catalog 已有多选与批量动作；工作台已能接收批次 ID 并展示完整计划 | 已落地（见 §1.4）；**仍未产生验收证据**，对应 V01–V07、V09–V13、V17、V20–V21 的子断言仍需逐项取证 |
| 提交与恢复 | 生产发布已按完整计划 CAS（`planDigest`）与持久幂等键执行；journal 引入阶段概念，文件落盘后保持 `files_saved` 直到索引与终结证据可核对；release 增补 `recoveryRequired` / `activationStatus` / `attemptId`；启动恢复前移至 WebUI 监听之前 | 已落地（见 §1.4）；镜像异常与恢复异常的完整失败关闭仍需 V14–V16 的故障注入证据 |
| 后续源码修复 | D-23 的 rename 后 `applied` 标记丢失漏回滚已由 `2cc79f49` 修复：遍历全部 entry 并按实际字节分 `restored/unchanged/conflict`。生产 ZIP/TGZ 输出上限与角色保存锁内版本复核的源码修复由 `9b249f6d` 落地 | 仅准确登记源码修复，不回填历史缺陷为当前缺陷，也不据此关闭其余恢复、幂等或验收边界。D-19／D-21 台账是否关闭仍按其正式证据处理；V09、V14–V15 及共享协调器相关项保持未执行 |
| 正式验收 | **V01–V22 全部未执行**；本轮静态审阅、测试源码及历史运行记录均不升级为本轮验收证据 | 按 §10.1 的子断言逐项取得直接证据后才可分别回填；标签不得自动汇总为整项通过 |
| 客户交付 | Wave 0b 未解锁，整批保持 `blocked_delivery`；V03 的 Agent 级证据与 V22 的客户 linux/amd64 证据仍受该约束 | 本机、模拟、Compose 或静态结果不得替代获授权的 Agent 与客户单副本 Helm 环境证据；本地实现缺口也不能借 Wave 0b 解释为“只欠环境验收” |

### 1.4 2026-10-27 实施落地后的状态校准

本小节记录本轮**实际改动的源码**与**实际执行的测试**。它不产生验收证据：§10 的 V01–V22 状态一律保持「未执行」，因为没有任何一项的全部子断言都取得了直接证据。

**生产接线（已落地，见 §7.5）**

| 实施项 | 本轮落地位置 | 状态 |
|---|---|---|
| D11 严格 HTTP 信封 | `webui/server/semantic-batch-service.ts` `parseSemanticValidateEnvelope`；`webui/server/index.ts` `/api/semantic-assets/validate` | 已落地 |
| D11 新增路由 | `webui/server/semantic-batch-routes.ts`：`scopes` / `check` / `operations/:id` / `operations/:id/cancel` / `operations/:id/report.csv` / `plans/:validationId` | 已落地 |
| D4／D7 维护包导出与基线 | `webui/server/semantic-batch-service.ts` `exportSemanticMaintenancePackage`；`semantic-maintenance-package.ts` 增补 `scopeId` 与导出记录的 `actor` | 已落地 |
| D6 共享限额 | `webui/server/semantic-assets.ts` 导入侧改用 `SEMANTIC_BATCH_LIMITS`（替代原 50 YAML／3 MiB） | 已落地 |
| D8 共享检查 | `semantic-assets.ts` `runValidateGate` 改为调用 `semantic-checks.ts` 的 `runSemanticTableCheck`（与单表保存、独立批量、导入预检同一实现）；无法解析身份的新表仍走原 KTX 门禁 | 已落地 |
| D12 导入暂存 | `webui/server/semantic-batch-service.ts` `stageSemanticMaintenanceImport`；`semantic-assets.ts` `persistSemanticBatchSnapshot` | 已落地 |
| D13 完整计划 | `webui/server/semantic-assets.ts` `describeSemanticBatchPlan`（候选 + 既有待同步磁盘变更 + 精确覆盖集合） | 已落地 |
| D14 计划 CAS | `semantic-assets.ts` `rebuildBatchPlan` + `recomputeSemanticPlanDigest`；批量发布废止全局布尔覆盖确认（`confirmOverwrite` 仅对无批次计划的单文件旧导入路径保留并标记 `@deprecated`） | 已落地 |
| D15 持久幂等 | `semantic-assets.ts` 发布路径接入 `registerSemanticIdempotencyKey`；重放检查前置于快照读取 | 已落地 |
| D16／D17 journal 全生命周期 | `semantic-recovery-journal.ts` 增补 `phase`（`write_in_progress` / `files_saved` / `activation_pending` / `completed`）与 `markRecoveryJournalFilesSaved`；启动恢复按阶段分流 | 已落地 |
| D18 启动恢复准入 | `webui/server/index.ts` `recoverSemanticJournals()` 前移至 `app.listen()` 之前 | 已落地 |
| D19／D20 生效状态 | `semantic-assets.ts` release 增补 `recoveryRequired` / `activationStatus` / `attemptId` / `planDigest`；`published` 仅在最终 digest 核验与终结审计持久化之后写入 | 已落地 |
| D21 Catalog 多选 | `webui/src/pages/Catalog.tsx`；`webui/src/components/semantic-assets/CatalogBatchPanel.tsx` | 已落地 |
| D22 审计 | `semantic-batch-audit.ts` 的 payload／record 用于导出（交付前）、校验与暂存；导出审计失败即导出失败 | 已落地 |
| D23 共享协调器 | 复核确认：单表保存、Manifest 上传、批量导入、手动 reindex、角色／行策略保存五类写入口**已全部**在 `publish-coordinator.ts` 的同一窗口内 | 已落地（复核确认，非本轮新增） |

**本轮实际执行的测试（局部直接证据，不回填整项）**

| 测试 | 直接覆盖的子断言 | 未覆盖 |
|---|---|---|
| `server/__tests__/api.semantic-batch.test.ts` | V05(b) 的「29 合法 + 1 错形整批拒绝」；V05(c) 的「合法包 + 1 错形 package 整批拒绝」；V07(d) 的「未知目标拒绝」；V08(c) 的「精确覆盖集合变化使旧确认失效」；V13(a)/(c) 的同键同 release 与同键异计划冲突 | 其余全部子断言 |
| `server/__tests__/semantic-batch-journal-lifecycle.test.ts` | §7.2 第 5／6 条的 journal 阶段分流；D19／D20 的 `activationStatus` 状态机 | V14／V15／V16 的故障注入时序、镜像核验与跨重启证据 |

以上测试是**真实 HTTP 入口**用例（`buildServer()` + supertest），不是 helper 单测；但它们只覆盖上表列出的窄子场景。按 §10.1「只有该项全部子断言均在适用环境取得直接证据后，才可把整项改为通过」，**V01–V22 状态一律保持「未执行」**，也不得据此申请 UAT 准入。

### 1.5 状态行事实对齐（2026-10-28）

本小节只更正**状态陈述**，不修改正文合同、不改 V01–V22 状态、不关闭任何台账条目，也不产生验收证据。

**更正原因**：本 Spec 头部原写「评审状态：Spec／Plan 文档评审已关闭，修订通过（2026-10-27）」。该行由 `f008490a`（2026-10-27 15:11）写入；同一日 19:29 的 `36e390d1` 落盘独立审阅报告，其结论为「**退回**」，且该审阅**明确未修改本 Spec 正文与 V01–V22 状态**。因此状态行停留在被后续审阅结论取代的旧陈述，与实际状态不一致。

**git 定序事实**

| 时间 | 提交 | 事件 | 对状态行的影响 |
|---|---|---|---|
| 10-27 15:11 | `f008490a` | 「close semantic batch spec and plan review」→ 写入「评审已关闭，修订通过」 | 写入旧陈述 |
| 10-27 17:57 | `2e98be74` | 「implement the semantic asset batch P0 D1-D23 contract」→ 生产接线落地（见 §1.4） | 实施事实已更新，**未复审** |
| 10-27 19:29 | `36e390d1` | 「record P0-1 and P0-3 codex review returns」→ 审阅结论「退回」（1 阻塞 B01 + 5 高 H01–H05 + 2 中 M01/M02），并把 `docs/README.md` 索引改为「设计审查退回，待修订」 | 结论**取代**旧陈述，状态行未同步 |
| 10-28 | 本次（PM 授权） | 头部状态行按上述事实更正 | 仅状态陈述对齐 |

**更正后的当前状态**：最新状态为**独立审阅退回**（`docs/reviews/2026-10-27-codex-review-semantic-batch-operations-p0.md` 结论行「## 结论：退回」）；`2e98be74` 的 D1–D23 生产接线**已落地但尚未复审**，不能据此把审阅结论改判为通过；审阅指出的差距是**实现缺口**（生产接线、发布 CAS、恢复终结、协调器临界区），不得概括为"只欠验收"；后续应先补齐实现与状态说明，再安排完整 UAT。

**未随之改变的项**：冻结合同与正文要求、V01–V22「未执行」状态、Wave 0b 未解锁、客户交付 `blocked_delivery`、台账 D-04／D-05／D-06／D-07／D-08／D-09／D-10／D-12／D-13／D-16…D-31 的 open 状态，均不因本次对齐而变化。L25-11 的**实质修订仍待进行**，且仍应由其维护者随修订一并完成；本次只消除状态陈述与审阅结论之间的矛盾。

## 2. 需求判断、目标与边界

对于多表、多 Schema 的初始化、统一修订、例行巡检和交接维护，本能力为刚需；对少量表偶发维护，逐表方式仍可完成。当前没有客户规模、频率及工时统计，不将 P1 判断写成已验证的市场结论。

目标旅程：选择 30 张表 → 下载维护包 → 外部编辑 → 导入预览 → 校验 → 在发布工作台确认同步索引并生效 → 核对结果。重复操作次数、漏处理率和失败定位能力是价值指标，先建立基线，再报告改善，不预填节省百分比。

本期包括：精确选择、可往返维护包、独立批量校验、导入 staging、统一发布服务、结果报告及失败恢复。Catalog 不新增对话、在线 LLM 生成、批量删除或自动语义修复；不更改连接、启用表范围、角色权限或行级策略，不把导入等同授权。

Schema Manifest 是结构事实源，semantic overlay 是业务维护目标。维护包中的 Manifest 为只读上下文；修改 Manifest 的文件须阻断并提示去连接概览处理。缺失物理表或 Manifest 时不能通过上传 overlay 自动建表、发现或补齐结构。Wiki、Skill、评测、脱敏连接配置的通用交付包不混入本维护包。

## 3. 交互与范围合同

### 3.1 Catalog

- 保留现有范围树和筛选；行首增加复选框。表身份是 `{connectionId, schema, table}`，不得只存 table 字符串。
- “选择全部筛选结果”由服务端解析完整结果，不等于当前可见页。明确显示“已选择 N 张表”，进入操作前提供对象预览。
- 改变搜索、连接、Schema、启用范围或语义状态时清空选择并提示；不保留不可见的隐式勾选。只有“批量下载”“批量校验”要求已有选择；“导入语义资产包”始终可用，导入范围由包内容解析并单独预览，不能套用页面筛选偷偷丢弃文件。
- 并列动作使用 secondary，任务确认区至多一个 primary。空选择、加载中、事实源不可用、超限均说明原因；支持键盘和复选框 mixed 状态。
- 维护未启用表可以下载、校验和修订已有 overlay；界面标为“未启用，不对 Agent 开放”。不改变默认已启用筛选，也不自动启用。

### 3.2 生效工作台

Catalog 导入只写受控 staging，不立即改正式文件或触发索引。预览展示新增、修改、无变化、冲突、只读依赖及实际影响表；随后“前往发布工作台”。工作台接收批次 ID，不接收客户端提供的落盘路径。

工作台展示“已有待同步磁盘变更 + 本次导入候选”的完整计划，统一校验后才允许确认。索引沿用整批同步，不能按 Catalog 勾选伪装为局部生效；已有无关变更也可能被索引，必须在确认前列出并纳入校验。若完整范围无法取得，阻断提交，不能仅显示导入的 30 张表。

既有磁盘变更保留原内容；仅本次 staging 候选在确认后写入。空 diff 显示“无变化”，不创建空发布或自动同步其他待处理变更。完整计划经用户确认后发生任何变化，都须重新预览和确认。

## 4. 身份、快照与依赖

1. 使用现有解析、模型合并、内容根解析及安全路径服务；为其补齐身份解析合同，不能按同名文件或 `includes(schema)` 归属。
2. 服务端生成不可变范围快照：`scopeId`、排序去重后的 `refs`、基线 digest、创建时间、操作者、实例 ID。digest 涵盖候选、Manifest、overlay、解析配置的非敏感语义字段及所需依赖；与解析无关的密钥值不进入报告。
3. 依赖闭包由模型关系派生；选中对象和只读依赖分别列出。跨 Schema、跨连接关联逐一解析；缺失或同名歧义均阻断，不猜默认连接。
4. 导出需要的依赖只读携带，不因此成为可编辑或可写目标。若一个实际 overlay 文件承载多个表，本期不拆分写入；选择未覆盖全部写入影响表时阻断，提示先补选，禁止暗中扩大范围。
5. 快照、导入候选和校验结果有效期固定为 30 分钟。请求、轮询、报告、下载和提交均重新检查会话权限；绑定操作者与实例，其他操作者不能直接消费 ID，过期重新预览。长期发布记录不因快照过期丢失。
6. 正式提交前对目标和所有校验依赖重算 digest，包括“目标原不存在”的标记，防止预览后被另一写入创建。CLI / Git 外部修改同样导致冲突。

## 5. 可往返维护包

拟新增 `semantic-maintenance-package/v1`，ZIP 包含 `package.json` 元数据、可编辑 overlay 和只读 Manifest / 关联依赖。此元数据不是 npm 包，不执行脚本。路径仅用于 ZIP 内定位，目标路径始终由服务端按模型身份计算。

每条 entry 至少包含：`entryId`、`role`（`editable_overlay` / `readonly_context`）、完整表身份、共享同一物理文件的全部 `sharedIdentities`、包内相对路径、原导出内容 digest、原目标 digest（或 absent）、`baseTarget`、原语义基线 digest。元数据还记录 schemaVersion、导出时间、实例 ID、Lucy 产品 / 构建标识、全部所选表和依赖角色。

- 原文件 digest 用于来源和冲突对比，不作为作者签名。外部编辑后候选内容 hash 可以变化；导入服务重算新 hash，不要求用户手改原 digest。只读 entry 内容变化、entry 身份被改绑或缺少必要 entry 均阻断。
- 服务端导出记录必须独立保存每个 entry 的完整授权事实：`entryId`、`role`、主身份与 `sharedIdentities`、`packagePath`、`exportedDigest`、`targetDigest/baseTarget`、`baselineDigest`，以及包级 `selected`、`dependencies` 和基线 digest。导入时以该服务端原记录为唯一授权基线，逐项核对 **entry 全集恰好相等** 及上述绑定关系；上传方不得通过把 `readonly_context` 改成 `editable_overlay`、删改 metadata 与对应文件、改写共享身份或基线摘要来重新授权。除允许编辑的 overlay 内容字节外，其余字段均不可由客户端自报覆盖；任一缺项、多项或绑定不符都整包拒绝，正式效果为零。
- 包的基线由服务端保存的导出记录核验，不相信客户端自报。原包来自其他实例、记录过期或无法核验时，本期阻断并说明需在目标实例重新导出，暂不支持跨实例迁移 / 重绑定。
- 无 overlay 的选中表导出显式模板，附 `baseTarget=absent`；未改动模板导回为无变化，修改后按完整语义校验处理。不能以空模板冒充已有业务定义。
- 安全解包拒绝绝对路径、`..`、符号链接 / 硬链接、重复归一化路径、重复身份、嵌套包和未登记 entry。禁止 secrets、凭据、ACL、原始数据、运行状态库及任意脚本文件；不返回宿主绝对路径。
- 统一限制（2026-10-30 用户批准容量修订）：最多 200 个 YAML entry（包括只读上下文），单 YAML ≤8 MiB，metadata ≤256 KiB，解压内容总计 ≤16 MiB，ZIP ≤20 MiB；HTTP JSON 请求体 ≤32 MiB，覆盖 Base64 开销。上传多 YAML 使用相同内容总量 / 数量限制；限制由同一共享定义提供，不能只改前端常量。
- 目录 Manifest validate/upload 与 semantic-assets validate 三条携带资产内容的路由必须显式设置共享 HTTP 上限，不得被框架默认 1 MiB 提前拒绝。单 YAML 与 JSON 内容按 UTF-8 字节计数；超限拒绝且不截断、不写入。超出请求体上限返回中文 413 提示；只传引用的发布与批量校验路由保持原 HTTP 上限。此局部修复及其 API 回归不替代 V01–V22 正式验收。
- 导出先按导入规则自检，再生成包；任一超限或依赖缺失则明确失败，不返回缺表的成功包。批量校验最多 200 张所选表；依赖最多 200 个 YAML，超过限制须拆分显式任务，不自动截断。

维护包基线有效期为 7 天；与短时预览 / 校验的 30 分钟不同。导出记录到期后重新导出，不能靠编辑时间戳延长。正在使用的快照和恢复材料不得被普通 staging GC 删除。

## 6. 校验及结果合同

独立批量校验读取一致快照，不改变正式 YAML、启用范围、索引或发布状态；允许写任务进度与报告。导入预检和发布前最终校验必须复用相同检查实现，单表、批量、`validate-changed` 不得各自维护不同合法性规则。

| 层次 | 必查项 | 结果边界 |
|---|---|---|
| 范围与输入 | 完整身份、已配置连接 / Schema、Manifest 存在、包结构、目标安全、冲突、限额 | 错误阻断整批提交 |
| 语义 | YAML / 模型解析、Manifest + overlay 合并、列类型合同、指标 / 分群 / 关联引用、依赖闭包；调用共享 `validateSource` / 既有 KTX validate 接口 | 校验失败、超时、依赖不足均不能成为通过 |
| 完整度 | 描述、grain 等现有完成度事实 | 独立列示，不能当作合法性证明；本期不新增业务完整度阻断规则 |
| 执行证据 | 实库查询、SQL 方言运行、业务结果正确性 | 本期不要求执行，独立记录 `not_applicable / evidence_available / blocked_evidence / unknown`；不进入提交 verdict，合法性通过不宣称查询或业务口径已验证 |

单项提交 verdict 为 `passed / failed / not_run / stale`，问题另记 `severity`。汇总数量必须满足 selected = passed + failed + not_run + stale；依赖检查另计，不重复冒充所选表。任一阻断错误、`not_run` 或 `stale` 都禁止提交，告警可以继续但需在确认摘要可见。`not_run` **仅**表示本应执行的必需检查因超时、取消或中断而未执行；本期明确不要求的实库执行证据不得写入该值，也不得制造正常发布必被阻断的矛盾。

任务固定最多 4 个并行检查，每表执行上限 30 秒，整个任务 10 分钟；超时项 failed、应执行而未调度项 not_run，其余已完成结果保留。取消只读任务不撤销已完成报告；取消导入只能在正式写入前进行。运行中的范围和内容不可变。

报告至少提供任务 ID、基线版本 / digest、所选及依赖范围、逐表层次结果、原因码、可读定位、耗时、开始结束时间和操作者；提供 JSON、CSV 下载（CSV 公式注入转义）。过期结果显示 stale，不静默改为新检查的结果。

## 7. 提交、一致性和恢复

### 7.1 复用与状态

扩展现有资产服务和发布工作台，所有写入口共用单实例发布协调器及既有类型合同门禁；既有豁免仍由原规则处理，本功能不新增“跳过校验”选项。不新增并行发布引擎，也不修改 KTX。

共享协调器的覆盖范围已裁决为：**单表保存、Manifest 上传、批量导入、手动 reindex，以及 L25-14 的角色／行策略保存**。这些入口的基线复核、配置或资产写入、运行镜像同步、生效与终结状态持久化串行执行；只读预览、独立校验和报告查询可并行，但提交时必须重新核对 digest。不得仅凭入口不同并行写入或生效；未来只有在证明资源与故障域完全隔离并完成独立评审后才可放宽。

> 实施回写见 §7.4（2026-10-25）。

导入任务：`staged → checking → ready / blocked / cancelled / expired`；在工作台确认后关联 releaseId。发布沿用 `blocked / promote_failed / reindexing / published / reindex_failed`，增加恢复必要信息 `recoveryRequired` 及独立 `activationStatus=unconfirmed / confirmed`，不改写历史状态含义。旧记录缺少新字段时为 unknown，不从旧 published 自动补 confirmed。界面分别显示“已暂存”“校验通过”“文件已保存”“索引同步中 / 失败”“已生效”。HTTP accepted 仅代表受理。

### 7.2 提交合同

- 锁覆盖完整计划重建与基线复核、最终校验、正式写入、镜像同步及 digest 核验、索引、最终 digest 复核、终结审计／历史／状态持久化；§7.1 列明的全部写入口进入同一协调器，竞争返回可读 busy。手动 reindex 的终结记录也必须留在同一窗口内。任何失败或异常路径只有在完成恢复，或持久化可继续启动恢复的 `recoveryRequired`／生效待确认状态后，才允许释放窗口。外部 CLI / Git 写入不受进程锁控制，digest 发现后停止并重新预览；本期不承诺任意外部写者并发事务。
- 校验未全通过前，正式文件、运行镜像目录、索引均不写。提交时重读授权并构建“已有待同步磁盘变更 + 本次导入候选”的完整计划；`planDigest` 必须覆盖所选对象、全部依赖、候选内容、每个目标的原 digest／absent 标记和精确覆盖集合。预览、覆盖确认绑定同一个 `planDigest`，不能用一个全局 `confirmOverwrite` 布尔值授权变化后的目标或依赖集合。

> 2026-10-25 实施回写见 §7.4 N11。该注记写下时，CAS 与覆盖确认尚未接到生产发布。2026-10-27 的 `2e98be74` 已让批量发布按 `planDigest` 重核；2026-10-30 的收口 Task 把发布锁留到终态证据落盘之后，见 [发布窗口 Task](../plans/2026-10-30-l25-11-publish-window-task.md)。本注记不改 §7.2 正文，也不产生 V14–V16 验收证据。
- 使用服务端持久幂等键（按实例 + 操作者 + 客户端幂等键查找，记录所绑定的 planDigest，保留至少 24 小时）。幂等意图及 releaseId 绑定必须先于任何正式文件、镜像或索引效果持久化；重复提交在断线、进程重启及 validation snapshot 已消费后仍返回同一个 releaseId 和当前状态，禁止重复写盘或重复索引，同一幂等键与其他计划组合返回冲突。容量裁剪只能移除已过期记录；存储达到容量且仍存在未满 24 小时的有效键时，必须拒绝新意图或扩容，不得提前淘汰有效键。

- 写入前持久化每个实际目标的原 bytes / absent、预期新 digest、处理顺序和恢复日志；每次替换前再校验该目标基线，用同目录临时文件 + rename，更新恢复日志。只操作已确认目标。journal 在全部文件 promote 后只能进入“文件已保存、索引／终结结果待确认”阶段，不能提前 `completed`；只有适用的镜像、索引、最终 digest 与终结审计／状态证据均可核对后才能终结。
- 中途 journal、rename、镜像同步或核验、审计／历史／状态持久化失败，停止后续步骤；按日志逆序恢复本批次已改目标，并同步恢复镜像、逐项核对恢复后的实际 digest。恢复不得以待写失败记录或失败审计成功为前置条件；记录写入失败不能跳过回滚。不触发新索引，不还原其他既有磁盘变更。镜像同步异常不得吞没，恢复镜像失败不得登记 `restored`。发现第三方新内容不覆盖，标记 `recoveryRequired=true`，展示已写 / 已恢复 / 待修复对象及各自 digest，并阻止后续发布和手动索引直到恢复核验完成。
- 启动恢复先处理全部未终结日志，再开放任何配置／资产写入、发布和手动索引；普通 `open` journal、恢复读取异常、镜像异常或无法判定均按未恢复处理，不得仅因缺少 `recoveryRequired` 标记而放行。进程在 rename 后、日志更新前退出时，以原 / 新 digest 判定；无法判定则待人工修复，不猜成功。WebUI 监听和受影响资产的 Lucy 读取／查询也必须受恢复准入约束：恢复未完成或结果不确定时，涉及资产明确失败关闭。恢复材料保留到终结且可审阅后再按既有保留策略清理。

> 2026-10-25 的 N26 是历史缺陷及修复记录：当时即时恢复只遍历 `applied` 列表，rename 成功而标记写入失败时会漏回滚；`2cc79f49` 已把即时恢复统一为遍历全部 entry、按实际字节判定 `restored` / `unchanged` / `conflict`。该源码修复不替代本条其余 journal、镜像、索引和终结边界，也不构成 V14–V16 验收证据。

- 索引失败保留已保存文件，记 reindex_failed 和“不保证 Agent 已生效”；从发布工作台重试索引，核对已保存计划及当前待同步范围，不重复上传或 promote。范围变化须重新预览、校验、确认；重试关联原 releaseId 和新的 attemptId，不篡改原失败记录。索引返回成功只说明索引命令成功，不能在最终 digest 与终结证据持久化前登记 `published`。

这些是应用级可恢复批次，不宣称文件系统多文件与 SQLite 索引具备共同原子事务，也不承诺发布过程中所有读取看到同一瞬时版本。`published` 只在正式文件 / 运行镜像与目标 digest 一致、索引成功且终结记录已持久化后成立；不满足时绝不能给成功提示。若出现未恢复的部分写入，必须沿用或补齐现有运行一致性拦截，使涉及资产的 Lucy 读取 / 查询明确不可用，不能继续宣称一致；不改变 ACL 或预算规则。

### 7.3 审计

复用配置审计、安全账本及 [L25-09](lucy-20261020-v2p5-audit-increment-spec.md) 适用契约。记录 actor、operationId、scopeId、planDigest、releaseId、attemptId、基线与候选 hash、对象数量、分项结果及恢复状态；不得把下载、预检或校验记成发布成功。导出前和正式效果前完成所需审计持久化，失败按既有 fail-closed 合同处理；效果后终结记录失败需恢复核验，不能谎称未发生。终结审计、release 历史与最终状态均属于 §7.2 的同一协调器临界区和 journal 终结条件，不得在锁外补写后宣称完整串行。普通日志不存原始 YAML、凭据或宿主路径；受控 staging / 备份独立受管理员访问控制。

### 7.4 实施回写（2026-10-25，Lucy v0.25 W5；2026-10-27 状态校准）

本小节保留 2026-10-25 实施期偏差事实及后续修复记录。文件头当前状态由 2026-10-27 静态交叉审阅按 §1.3 校准，不再沿用“头部仍是 2026-10-24 基线”的历史表述；本小节及本轮修订均不产生验收证据，§10 的 V01–V22 状态一律保持「未执行」。

#### N11 覆盖确认凭据与发布锁陈旧回收

**（a）偏差事实与证据**

两处偏差都落在 §7.2 提交合同。

1. 覆盖确认仍是全局布尔。§7.2 第 2 条要求「预览、覆盖确认绑定同一个 planDigest，不能用一个全局 confirmOverwrite 布尔值授权变化后的目标集合」。现发布合同仍只认全局布尔：请求字段 `confirmOverwrite?: boolean`（`webui/server/semantic-assets.ts:243`），覆写集合非空时以 `request.confirmOverwrite !== true` 决定放行或拒绝（`webui/server/semantic-assets.ts:1945`），HTTP 层原样透传 `body.confirmOverwrite === true`（`webui/server/index.ts:1840`、`webui/server/index.ts:1946`）。计划摘要尚未接入覆盖确认，因此「变化后的目标集合」仍可被同一个布尔授权。
2. 锁的陈旧回收存在活锁风险。§7.1／§7.2 要求发布窗口覆盖完整临界区，并能回收崩溃遗留的锁。锁文件 `.ktx-ui/semantic-publish.lock` 写入 `acquiredAt`（`webui/server/publish-coordinator.ts:250`），但回收判定此前不读持有者身份：锁文件缺 `pid` 时被补成当前进程，使「持有者身份未知」的旧格式锁被误判为存活而长期占用窗口；若改为纯按年龄回收，又会让长耗时发布的活锁被抢占。

**（b）本轮处理**

- 发布协调器另立为独立模块 `webui/server/publish-coordinator.ts`，陈旧锁回收按持有者身份分流：持有进程已知时，只在该进程确实死亡后回收，年龄不再是回收依据（`webui/server/publish-coordinator.ts:130-144`）；持有者身份未知（旧格式锁）时才回退到年龄判定；锁文件缺 `pid` 时不再补成当前进程，而是记为持有者未知（`webui/server/publish-coordinator.ts:168-172`）。进程内重入由上下文标记保护，避免自锁。
- 新增恢复日志 `webui/server/semantic-recovery-journal.ts`：写入前持久化每个实际目标的原字节／缺失标记、原摘要、预期新摘要与处理顺序（`webui/server/semantic-recovery-journal.ts:49-62`）；写入或镜像同步失败时按日志逆序恢复本批次已改目标并同步恢复镜像；发现第三方新内容时不覆盖，置 `recoveryRequired` 并阻断后续发布与手动索引（`webui/server/semantic-recovery-journal.ts:358-393`、`webui/server/semantic-assets.ts:1903`、`webui/server/semantic-assets.ts:2071`、`webui/server/semantic-assets.ts:2123`）。
- 恢复日志与「废止全局布尔」的关系：§7.2 废止全局 `confirmOverwrite` 的意图是覆盖确认必须绑定到具体计划；恢复日志补的是另一半——发布过程本身现在可回滚。两者不可互相替代：覆盖凭据决定「被授权的是哪一组目标」，恢复日志决定「已写入后失败如何逐项核回」。本轮覆盖确认仍以全局布尔为凭据（planDigest 绑定待落地），恢复日志不构成对该项的豁免，也不把覆盖确认改写为布尔以外的另一种隐式授权。

**（c）受影响条款编号**

- §7.1 第 2 段（共享协调器覆盖范围与串行写入）。
- §7.2 第 1 条（锁覆盖范围与 busy 语义）、第 2 条（planDigest 绑定覆盖确认）、第 4 条（写入前持久化原 bytes／预期新 digest 与恢复日志）、第 5 条（失败逆序恢复与 `recoveryRequired`）、第 6 条（启动恢复先处理未终结日志）。
- §10 的 V08、V13、V14、V15；§11 的 D3、D4。

**（d）是否改变冻结契约**

2026-10-25 的 N11 回写当时不改变冻结契约，也未改写 §7.1–§7.3 正文；§7.2 第 2 条仍为待实现项，本小节不构成裁决、豁免或版本变更，因此不涉及新版本号与批准记录来源。恢复日志是 §7.2 第 4–6 条的部分落地实现，不等于 2026-10-27 复核所需的全生命周期闭环。本小节不产生验收证据。

#### N26 即时恢复路径只信 `applied` 列表，写入已落地但标记丢失时漏回滚（D-23）

**（a）偏差事实与证据**

§7.2 第 6 条已写明「进程在 rename 后、日志更新前退出时，以原 / 新 digest 判定；无法判定则待人工修复，不猜成功」。该规则此前**只在启动恢复路径**（`recoverPendingRecoveryJournals`）落地；**即时恢复路径**（`restoreRecoveryJournal`，即发布过程中写入失败后的当场回滚）只遍历 `journal.applied` 列表，而 `applied` 的标记写在 rename **之后** —— 若 rename 成功而标记写入失败（磁盘满／进程崩溃），目标已被替换却不在 `applied` 里，于是该目标**不会被回滚**，且因 `recoveryRequired` 仍为 false，对外报「已恢复」。目标文件因此停留在**本批次的新内容**上，而恢复报告称成功，语义层内容与预期不一致却无人察觉。

同时 `restoreEntry` 的返回值只有 `{ restored, reason }`，把「写入从未落地（或已被回滚）」与「存在第三方改动、拒绝覆盖」压进同一个 `restored=false` 分支，调用方无法区分「无需恢复」与「拒绝覆盖」——后者本应置 `recoveryRequired=true` 并阻断后续发布与手动索引。

**（b）本轮处理**

- 恢复一律**遍历 `journal.entries` 的全部 entry**（逆序处理，与写入顺序相反），**不依赖 `applied` 标记**；判定一律**按实际字节**（`restoreEntry` 的 digest 比对），即 §7.2 第 6 条已写明的规则，**不猜成功**。
- `restoreEntry` 返回值改为三态：`restored`（已按原始字节回滚）／`unchanged`（目标仍是原始内容 ⇒ **写入从未落地**，既不算恢复也不算异常）／`conflict`（第三方内容，**不猜、不覆盖**，留给人工）。仅 `conflict` 置 `recoveryRequired=true` 并阻断后续发布与手动索引。
- 启动恢复路径 `recoverPendingRecoveryJournals` 同步适配为同一形态，两条路径不再有两种判定口径。
- 已补 2 条用例，并做过去修复反向验证（移除修复后「写入已落地但 applied 标记丢失」用例实测真红：第二个目标未被回滚）。

**（c）受影响条款编号**

- §7.2 第 5 条（失败逆序恢复与 `recoveryRequired`）、第 6 条（启动恢复以原／新 digest 判定、不猜成功）。
- §10 的 V14、V15、V16；§11 的 D3。

**（d）是否改变冻结契约**

2026-10-25 的 N26 回写不改变冻结契约；当时未改写 §7.1–§7.3 正文，本条是实现向既有冻结条款对齐 —— 原 §7.2 第 6 条从未允许「只信标记列表」或「无法判定时猜成功」。2026-10-27 对正文的补强同样不降低该要求。本小节不产生验收证据，V01–V22 状态一律保持「未执行」。台账见 `docs/qa/security-findings.yaml` 条目 **D-23**（severity P1，status `fixed`，`fixedIn` = 实现提交 `2cc79f4`）。

## 8. 拟议接口与兼容边界

接口名及结构为评审草案，实施时按仓库统一 API 风格落地，不表示当前可用。

| 接口 | 草案合同 |
|---|---|
| `POST /api/semantic-assets/scopes`（新增） | selector 为显式 refs 或完整筛选；返回 scopeId、规范化对象、依赖、digest、expiresAt；无客户端目标路径 |
| `POST /api/semantic-assets/export`（扩展） | 新增显式维护包请求 `packageKind=semantic-maintenance-package/v1, scopeId`；服务端自检通过后返回下载 URL、hash、included / dependency 列表 |
| `POST /api/semantic-assets/check`（新增） | scopeId；返回 operationId；任务后台执行并可取消，页面离开不丢结果 |
| `GET /api/semantic-assets/operations/:id`（新增） | 逐项结果、状态、报告 URL；仅状态轮询，不触发重跑；取消用 `POST .../:id/cancel`，只允许写入前阶段 |
| `POST /api/semantic-assets/validate`（扩展复用） | 受控包 / 多 YAML 预检，生成 staging 与完整身份预览，返回 validationId、candidateDigest；不 promote、不 reindex |
| `POST /api/semantic-assets/publish`（扩展复用） | 由工作台传 validationId、planDigest、覆盖目标摘要和幂等键；服务端构建完整计划、最终校验，再写入和索引 |
| 既有 release 状态与 reindex 接口（扩展复用） | 返回文件保存与索引结果，支持关联 releaseId 的索引重试；不能绕过协调器、恢复检查和当前范围确认 |

所有新增接口使用 WebUI 管理员会话、既有请求来源 / CSRF 防护；owner / operator 沿用既有语义维护权限，Agent MCP Token 不可调用。旧开放模式只按现有部署合同处理，不因本功能新增开放开关。非维护包的既有导出参数保持原含义；新增格式显式区分，旧记录缺字段显示 unknown，不反推成功。

裸 YAML 无包元数据时，只允许显式绑定已配置 connection / Schema，并从实际模型解析身份；目标有歧义则阻断。它没有导出基线，首次预检读取当前目标形成 CAS 基线；不能伪称具有原包来源证明。所有文件都纳入预览，不能忽略错误文件后提交剩余部分。

HTTP 预检请求中的 `files`／`packages` 一旦提供就必须是数组；每个元素必须是具备对应必填字符串字段的对象。缺字段、错类型、`null`、标量或其他错形 entry 必须在进入解包／语义校验前按原始数组索引定位并**整批拒绝**，不得先 `.filter` 丢弃错误元素再校验剩余合法项。混合“29 个合法文件 + 1 个错形文件”或“合法包 + 1 个错形 package”同样零 staging、零正式写入、零镜像与索引效果；数组缺省与显式空数组按既有兼容合同处理，不得借兼容路径接受非数组值。

## 9. 核心流程（伪代码）

以下为规范性顺序，helper 表示要复用或扩展的共享服务，不是现有函数签名。所有阻断分支返回原因码、可读定位及任务 ID；与 §10 验收项对应。

```text
resolveScope(actor, selector):
  requireCurrentWebuiMaintenancePermission(actor)
  catalog = readConsistentCatalogFromResolvedContentRoot()
  refs = sortUnique(resolveAllMatchingRefs(catalog, selector))
  reject empty / unknown / ambiguous / overLimit
  dependencies, impact = resolveModelDependencyClosure(refs)
  reject missingDependencies / unselectedWritableImpact / dependencyOverLimit
  return persistActorBoundScope(refs, dependencies, impact, digests, ttl=30min)

exportMaintenancePackage(actor, scopeId):
  scope = requireOwnedFreshScopeAndCurrentPermission(actor, scopeId)
  snapshot = readStableSnapshotOrFail(scope)
  entries = buildEditableOverlaysAndReadonlyContext(snapshot)
  reject credentialContent / unsafeOrDuplicateEntries / unresolvedIdentity
  package = buildMaintenanceV1(entries, snapshot.baselines)
  validatePackageWithSharedImportRules(package)  // 同一容量、entry 和依赖规则
  persistExportBaseline(ttl=7days); persistRequiredExportAuditOrFail()
  return storeAndExposeDownload(package)        // 下载时再鉴权；无静默截断

checkBatch(actor, scopeId):
  scope = requireOwnedFreshScopeAndCurrentPermission(actor, scopeId)
  snapshot = readStableSnapshotOrFail(scope)
  rows = runSharedChecks(snapshot, concurrency=4, perTable=30s, total=10min)
  retainFailuresAndNotRunOnTimeoutOrCancel(rows)
  if currentDigests != snapshot.digests: markAffectedResultsStale(rows)
  persistReport(rows, executionEvidence=not_applicable) // 独立证据维度；不 promote、不 reindex

stageImport(actor, input):
  requireCurrentWebuiMaintenancePermission(actor)
  assertHttpEnvelopeArraysAndEveryEntryShapeOrRejectWholeBatch(input) // 不过滤错形 entry
  entries = safelyExpandAndValidateAllInput(input)  // 边解压边检查大小
  if maintenancePackage:
    baseline = requireSameInstanceAndUnexpiredServerExportBaseline(entries)
    requireExactEntrySetAndBindingsFromServerBaseline(entries, baseline)
    // 全集、role、主/共享身份、路径、target/base/baseline digest、selected/dependencies
    reject changedReadonlyContext / reboundEntry / missingOrExtraEntry
  targets = resolveAllTargetsFromModels(entries)    // 裸 YAML 必须显式绑定范围
  reject unknownTarget / duplicateTarget / manifestEdit / outOfScopeWrite
  snapshot = readStableCurrentBaseline(targetsAndDependencies)
  reject exportedBaseMismatch(snapshot)             // 裸 YAML 首次预检取当前基线
  candidates = discardUnchangedEntriesAndUntouchedTemplates(entries)
  if candidates.empty: return no_change            // 不同步其他待处理变更
  validationId = persistStaging(candidates, snapshot, ttl=30min)
  return preview(validationId, diff, affectedRefs, dependencies, candidateDigest)

prepareWorkbench(actor, validationId):
  requireOwnedFreshCandidateAndCurrentPermission(actor, validationId)
  plan = combineCurrentDiskChangesAndStagedCandidates()
  reject unknownFullScope / targetConflict / changedBaseline
  validateEntirePlanWithSharedChecksAndExistingContractGate(plan)
  planDigest = digest(plan.refs, plan.dependencies, plan.candidates,
                      plan.targetOldDigestOrAbsent, plan.exactOverwriteSet)
  return fullPlanPreview(planDigest, allEffects, overwriteSet, results)

confirmAndPublish(actor, validationId, confirmedPlanDigest, idempotencyKey):
  requireCurrentWebuiMaintenancePermission(actor)
  with sharedSingleInstancePublishCoordinator:
    existing = findPersistentIdempotentIntent(instance, actor, idempotencyKey)
    if existing && existing.planDigest == confirmedPlanDigest:
      return existing.releaseIdAndCurrentStatus
    reject idempotencyPayloadMismatch / recoveryRequired / unresolvedOpenJournal
    plan = rebuildCompletePlan(validationId)       // 包含已有磁盘变更与全部候选
    reject expired / actorMismatch / planDigestMismatch / targetOrDependencyChanged
    finalChecks = validateEntirePlanWithSharedChecksAndExistingContractGate(plan)
    if anyBlockingOrIncomplete(finalChecks): return blockedWithoutFormalWrites
    reserveIdempotentIntentWithoutEvictingUnexpiredKeysOrFail(plan, releaseId)
    journal = createRecoveryJournalOrFail(plan)    // 先于任何正式效果
    try:
      for target in plan.stagedWriteTargets:
        compareBaselineAgain(target); atomicReplaceAndJournal(target)
      synchronizeRuntimeMirrorAndVerifyDigestsOrFail()
      persistFilesSavedAndReindexingOrFail()       // journal 仍为 activation_pending
      reindexResult = runExistingIncrementalReindexOnce(plan)
      if reindexResult.failed:
        persistReindexFailedOrFail()
        return filesSavedButActivationUnconfirmed
      verifyFormalAndMirrorFinalDigestsOrFail()
      persistTerminalAuditHistoryAndPublishedOrFail()
      completeJournalOnlyAfterAllApplicableEvidenceIsDurable(journal)
      return published
    catch writeMirrorAuditIndexTerminalOrJournalFailure:
      // 回滚不以失败记录写入成功为前置；不得吞镜像或状态持久化异常
      restoreOnlyThisBatchTargetsUsingJournalOrMarkRecoveryRequired()
      synchronizeAndVerifyRestoredMirrorOrKeepRecoveryBlock()
      persistFailureBestEffortWithoutReindex()
      return failedWithoutPublishedClaim()

recoverAfterRestart():
  beforeEnablingAnyConfigOrAssetWritePublishManualReindexOrAffectedRead:
    for everyUnfinishedJournal:
      compareActualBytesWithOldAndNewDigests()
      if journal.phase == open_or_write_failed:
        restoreOwnedWritesOrRequireRepair()         // 含无法证明阶段的旧 open journal
      else if journal.phase in [files_saved, reindexing, reindex_failed, activation_pending]:
        if formalOrMirrorBytesDoNotMatchSavedPlan: restoreOrRequireRepair()
        else: doNotRollbackSolelyBecauseIndexOrTerminalOutcomeIsUnknown()
      synchronizeAndVerifyRuntimeMirrorOrKeepRecoveryBlock()
      if indexOrTerminalOutcomeUnproven: persistActivationUnconfirmed()
      doNotCompleteJournalUntilAllApplicableEvidenceIsVerifiable()
    on anyReadParseWriteMirrorOrDecisionFailure: keepRecoveryAndAffectedReadBlocks()
    releaseApplicableBlocksAfterVerification()       // reindex_failed 可进入已核对的索引重试
```

## 10. 验证机制与验收矩阵

### 10.1 验证层次与证据

验证分四层：共享身份 / 包 / 状态规则单元测试；临时内容根上的 API 集成及文件 hash 断言；真实打包 KTX 的合成语义集成；经明确授权的桌面用户旅程验证。Mock 仅覆盖失败注入，不能独自证明 KTX 兼容、可导回、Agent 可检索或镜像交付成立。**2026-10-27 本轮只做静态交叉审阅与文档修订，V01–V22 全部保持未执行。**

每项证据保存测试编号、候选产品版本、完整构建提交 / dirty 状态、镜像 ID、依赖版本、输入 fixture hash、操作 / 发布 ID、前后目标及未选文件 hash、实际结果、错误及报告。`passed / failed / not_run / blocked_environment` 分开；缺少 KTX 或环境不能登记通过。仅合成 / 脱敏 fixture，不访问客户真实库。

证据追踪必须建立“**V 编号 → 下列子断言 → 实际测试／fixture → 原始结果与产物 → 适用环境**”的可核对映射。一个测试、`coversV025` 注释或结果汇总标签只能登记它实际执行的子断言，不能自动覆盖同项其他子断言；只有该项全部子断言均在适用环境取得直接证据后，才可把整项改为通过。直接调用 helper 的测试不能替代真实 HTTP／页面入口证据，静态源码、测试源码和历史运行记录不能替代本轮正式执行。现有 real-e2e 中 V09 的匿名拒绝、V16 的页面边界、V05／V06 的单文件非法校验均只覆盖各自狭窄子场景，不得按标签回填整项。

| 编号 | 子断言（全部必达） | 最低直接证据 | 状态 |
|---|---|---|---|
| V01 | (a) 两个连接的同名表精确隔离；(b) 同连接两个 Schema 的同名表精确隔离；(c) 无 Schema overlay 文件名不造成误归属；(d) 下载、校验、导入均使用完整三元身份，歧义整批阻断 | 真实 API 往返的规范化 refs、目标预览、导入结果及歧义拒绝记录；正式文件零误写 | 未执行 |
| V02 | (a) “选择全部筛选结果”覆盖跨页全集而非当前页；(b) 任一既定筛选变化清空选择并提示；(c) 未启用表可维护但维护后不自动启用；(d) 操作前可预览完整对象 | 桌面交互记录、服务端 scope refs、选择计数及维护前后启用范围 | 未执行 |
| V03 | (a) 30 表完成下载→修改→导入→完整计划确认→索引终结；(b) 未选文件与未授权目标前后 hash 不变；(c) 最终文件／镜像 digest 与状态一致；(d) 获授权合成 Agent 经 Lucy Proxy 可检索／读取新增语义，不能直连 KTX 替代 | 每阶段 operation／validation／release／attempt ID、fixture 与前后 hash、终结记录；Agent 级证据受 Wave 0b 约束，未解锁保持 blocked_delivery，本机或模拟结果不替代 | 未执行 |
| V04 | (a) 单文件多表的全部写入影响完整列出，未全覆盖时阻断；(b) 跨 Schema／连接依赖闭包完整；(c) 只读依赖字节不变且不扩写；(d) 缺失依赖整批阻断 | 生产导出／导入的 selected、sharedIdentities、dependencies、写入集合及依赖前后 hash | 未执行 |
| V05 | (a) 分别注入 YAML、引用、列类型错误，均为 29 正确 + 1 错误且整批拒绝；(b) 29 合法 + 1 缺字段／错类型／null HTTP entry 整批拒绝；(c) 合法包 + 1 错形 package 整批拒绝；(d) 各子例正式目录、镜像、索引及 release 效果为零 | 每个子例的输入数、定位、拒绝数与错误码，以及正式目录／镜像／索引前后 hash；不能只验单文件或发布列表 | 未执行 |
| V06 | (a) 原包不改导回为 no_change；(b) 无 overlay 模板不改导回为 no_change；(c) 即使存在无关待同步变更也不发布、不索引；(d) 合法修改后的新 hash 可预检 | validate 响应、候选集合、release／reindex 计数与无关变更前后 hash，以及修改正例 | 未执行 |
| V07 | (a) readonly→editable 与只读内容修改均拒绝；(b) 同时删除 metadata entry 与文件仍因服务端全集不符而拒绝；(c) 主／共享身份、路径、target/base/baseline digest、selected/dependencies 改绑均拒绝；(d) 异实例、过期、未知目标分别拒绝；(e) 合法编辑 overlay 正例可导回；(f) 全程启用范围／ACL 不变且正式效果为零 | 服务端原导出记录与上传包逐项 diff、各攻击 fixture hash、拒绝原因、零效果 hash 及合法编辑正例 | 未执行 |
| V08 | (a) 另一会话、单表保存、Manifest 上传、CLI／Git 分别改变目标或依赖后均 409／stale；(b) absent→存在同样冲突；(c) 精确覆盖集合变化使旧确认失效；(d) 必须重预览并取得新 planDigest，不能沿用覆盖布尔 | 并发／故障控制时序、旧新 planDigest、目标与依赖 digest、拒绝响应及零覆盖证据 | 未执行 |
| V09 | (a) 穿越、绝对路径、软／硬链接分别拒绝；(b) 重复归一化路径、重复身份、未知 entry、嵌套包分别拒绝；(c) 解压炸弹在限幅处拒绝；(d) 每例均无越界写、无部分接受 | 从实际 HTTP 入口逐个发送恶意 ZIP 的响应、fixture hash、宿主 canary、正式目录／镜像／索引前后 hash；helper 用例不单独成证 | 未执行 |
| V10 | (a) 200 YAML、8 MiB、16 MiB、metadata、ZIP、HTTP 各边界值可用；(b) 各 +1 明确拒绝；(c) 生产导出与导入共用同一限额；(d) 成功导出包通过同一导入自检且无截断 | 边界／+1 请求与响应、实际条目和字节计数、导出包自检报告及共享配置来源 | 未执行 |
| V11 | (a) passed／failed／not_run／stale 分别产生且计数守恒；(b) 并行上限 4、单表 30 秒、任务 10 分钟、取消与超时语义成立；(c) 实库未要求为独立 not_applicable，不制造提交 not_run；(d) 必需检查未调度才记 not_run并阻断；(e) 正式文件与索引不变 | 持久任务报告、调度时间线、逐表 verdict 与汇总、超时／取消记录、提交阻断及前后 hash | 未执行 |
| V12 | (a) 30 表候选与既有无关待同步变更全部进入同一计划；(b) 全计划统一校验且影响可见；(c) 任一计划变化使旧确认失效；(d) 不把 Catalog 选择伪装成局部生效 | 完整计划 JSON、全部 refs／effects／校验结果、旧新 planDigest、拒绝与重确认记录 | 未执行 |
| V13 | (a) 重复点击、HTTP 重试、断线重连均同键同 releaseId且只写／索引一次；(b) 进程重启及 snapshot 消费后仍可重放；(c) 同键异计划冲突；(d) 超过既有 500 条容量且记录未满 24h 时不提前淘汰，容量不足拒绝或扩容 | 持久幂等文件、重启前后响应、releaseId／planDigest、写盘与索引调用计数、容量fixture及24h内有效键全集 | 未执行 |
| V14 | (a) 第 N 次 rename、journal 更新、镜像同步／核验、导出前后审计、reindexing／终结审计与状态写入分别故障关闭；(b) 失败记录写入失败仍先恢复；(c) 可核对已写／已恢复／待修复集合及 digest；(d) 恢复或镜像核验失败阻断发布、手动索引和受影响读取 | 每个故障点的注入时序、journal、实际文件／镜像 bytes、审计与 release 记录、发布／读取拒绝证据 | 未执行 |
| V15 | (a) 在 journal 创建、rename、applied 标记、files_saved、index、终结记录各边界 kill 重启均不猜 published；(b) 普通 open journal、启动恢复异常和镜像异常保持阻断；(c) 恢复材料不误删、第三方新内容不覆盖；(d) 恢复核验前写入与受影响读取不开放 | 故障时间线、重启前后 journal／release／审计、实际 digest、恢复材料、监听／读取／写入准入结果 | 未执行 |
| V16 | (a) reindex 失败保留已保存文件且 activationStatus=unconfirmed；(b) 重试关联原 releaseId与新 attemptId且不重复 promote；(c) 范围变化必须重预览／校验／确认；(d) 原失败 attempt 保留；(e) 索引成功但终结写入受阻时其他四类写入口仍 busy | release／attempt 历史、promote／index 计数、界面状态、范围变化拒绝及锁内阻塞时序 | 未执行 |
| V17 | (a) 未登录、失效／伪造会话、Agent Token、跨操作者 ID 均拒绝；(b) scopes／check／operations／cancel／export／download／validate／publish 每个真实入口均覆盖；(c) 轮询、下载、提交期间撤权立即生效；(d) 不泄露内容且零副作用 | 各入口状态码与响应体、canary／凭据泄漏扫描、操作归属及正式效果前后 hash；旧路由匿名拒绝不能替代新入口 | 未执行 |
| V18 | (a) 合法但描述不全可发布且三维结论独立；(b) 实库未要求记 not_applicable且不阻断；(c) 必需检查 not_run／stale必阻断；(d) JSON／CSV 与逐表报告一致，CSV 公式转义且无原始凭据 | 同一任务的合法性／完整度／执行证据字段、提交结果、JSON／CSV 原文对照与泄漏扫描 | 未执行 |
| V19 | (a) 默认、定制、旧布局分别只读写解析出的事实源与受控镜像；(b) 发布与启动／失败恢复均核验镜像；(c) 镜像异常不得记 restored／published；(d) 无硬编码仓库路径或重复写入 | 三种 fixture 的解析配置、实际读写清单、正式／镜像 hash、恢复记录及镜像故障拒绝证据 | 未执行 |
| V20 | (a) 工作台保留校验／整批同步且无上传导出按钮；(b) Catalog 多选与跨页选择可用；(c) 导入预览与错误定位完整；(d) 离开并返回后任务结果可达 | 桌面截图／交互记录与对应 API 结果；页面动作边界不能替代 Catalog 完整交互 | 未执行 |
| V21 | (a) 真实打包 KTX 对合成 Manifest + overlay 合并／校验；(b) CLI、单表、独立批量、导入预检与发布最终校验复用同一规则且结论一致；(c) 不支持方言明确失败／未验证，Mock 不替代 | KTX 产品／依赖版本、真实命令与 API 输出、逐表结论对照及不支持方言结果 | 未执行 |
| V22 | (a) 候选客户 linux/amd64 镜像按单副本 Helm 路径完成合成往返；(b) 在客户路径执行中断恢复并核对文件／镜像／索引／终结证据；(c) 本机 Compose 不冒充客户验收 | 镜像摘要与 ELF 架构、Chart／产品版本、Helm 环境、合成 fixture、故障时间线及前后 hash；受 Wave 0b 约束，未解锁保持 blocked_delivery | 未执行 |

### 10.2 完成判定

范围身份、安全输入、冲突保护、校验前零正式写入、失败恢复和不虚报生效仍是本功能的承诺。2026-10-30 起，本条出口改由 §10.3 的 FC-01–FC-32 打假。30 表完整旅程改为发布取证的要求，不再作为本条收口条件。V 矩阵行在对应 FC 或 `SEM25` 取得直接证据之前保持未执行。没有执行的用例继续记未执行。本文件不新增当前 v2.0 发布门禁。本条收口不表示可上线。

### 10.3 出口切分（2026-10-30）

本条是功能合同，并于 2026-10-31 关闭。落地步骤与 FC 对照见 [功能合同收口 Task](../plans/lucy-20261030-semantic-batch-functional-contract-plan.md)。FC-01–FC-32 已有直接通过检查。发布取证留在 `SEM25`，未执行，不回开本条。

留在本条的不变量是：三元身份、服务端范围、依赖闭包、错形整批拒绝、包往返与授权、`planDigest`、导入入口的恶意包拒绝、共享限额、校验结论、幂等与容量、镜像失败关闭、失败记录不是回滚前置、恢复准入、不把索引返回记成已发布、索引失败后的重试、终态未完成时其他写入口仍忙、本模块入口的会话拒绝、报告三维与 CSV、布局与受控镜像、四条校验入口共用同一套规则。证明这些不变量的局部故障注入留在本条。

不在本条出口、由 `SEM25-V01`…`SEM25-V22` 持有的是：桌面跨页与 V20 的交互记录、30 表完整旅程、Agent 经 Proxy 检索、在已部署进程上强杀再拉起、真实打包 KTX 的命令输出与不支持方言、客户 linux/amd64 单副本。`SEM25` 仍未执行，不回开已经收口的 FC。

G30 仍开：批量校验只产报告，不产可发布计划。终态窗口属于本条的失败关闭，不据此关闭 L25-16 登记里的 G31，也不打开 W-B。Wave 0b 与客户交付仍是 `blocked_delivery`。

## 11. 实施准备、风险与已裁决设计参数

实施 Plan 已存在于 `docs/plans/2026-10-25-lucy-v0.25-p0-implementation-plan.md` §6，并于 2026-10-27 按本次交叉审阅局部补强。后续先完成生产 API／页面接线、共享检查与限额复用，再补齐完整计划 CAS、覆盖确认、持久幂等、恢复和审计的完整临界区，最后经另行授权执行 §10 验证。不是只恢复旧按钮：旧自动 promote + reindex 路径须接入同一服务和完整计划合同，不能因入口不同绕过确认或漏校验；基础模块存在不等于这些生产步骤已完成。

主要风险为同名误归属、维护包无法导回、Manifest / overlay 混写、全局索引带入其他变更、逐文件失败留下部分状态，以及工作区与镜像版本混淆。上述风险分别由身份快照、包自检、只读依赖、完整计划、恢复日志和 §1 双基线处理。

D1–D4 已于 2026-10-24 按 P0 Final 决议收口，不再留待实现者选择：

| 编号 | 已裁决值 | 设计落点 |
|---|---|---|
| D1 容量与并行 | 最多 200 个 YAML entry、4 个并行检查、单表 30 秒、任务 10 分钟；其他 ZIP／HTTP 限制见 §5 | §5、§6、§9、V10–V11 |
| D2 有效期 | 预览与校验快照 30 分钟；维护包基线 7 天 | §4–§5、V07 |
| D3 恢复失败 | 阻断后续发布和手动索引，并使受影响资产的 Lucy 读取／查询失败关闭，直到恢复核验完成 | §7.1–§7.2、V14–V16 |
| D4 共享协调器 | 覆盖单表保存、Manifest 上传、批量导入、手动 reindex 和 L25-14 角色／行策略保存；基线复核、写入、镜像与生效、最终 digest、终结审计／历史／状态均串行，只读预览和校验可并行 | §7.1–§7.2、V08、V13–V16 |

任何后续调整必须重新需求审查，并同步伪代码、错误提示与验收矩阵，不能留给实现者暗选。

## Terminology Compliance

This feature follows [webui/docs/00-product-terminology-standard.md](../../webui/docs/00-product-terminology-standard.md).

本草案登记新增术语：

| 概念 | UI 主术语 | 禁止文案 / 边界 |
|---|---|---|
| Semantic maintenance package | 语义维护包 | 不称完整备份、配置恢复包；格式 `semantic-maintenance-package/v1` |
| Batch semantic validation | 批量校验 | 不以“全部可查询”“业务正确”代替合法性结论 |
| Staged semantic import | 导入语义资产包 / 已暂存 | 不以“上传成功”代替“已生效”；单表继续“导入 YAML” |
| Selection scope | 已选择 N 张表 | 不用“全部”混淆当前页与完整筛选结果 |
| Activation unconfirmed | 生效状态待确认 | 不用绿色成功掩盖索引或恢复失败 |

以上术语已按 [webui/docs/00-product-terminology-standard.md](../../webui/docs/00-product-terminology-standard.md) §5 的登记流程写入该标准 §4.3（新增 `Batch Selection Scope` / `Select All Filtered Results` / `Batch Download Semantic Assets` / `Batch Semantic Validation` / `Import Semantic Assets Package` / `Semantic Maintenance Package` / `Activation Unconfirmed` 七行），并在 `webui/src/__tests__/catalog.test.tsx` 中加入关键文案断言防止回归。

Schema、Manifest、semantic overlay、连接、启用表范围沿用现有定义。完整表身份、英文格式名、路径和 URL 的 DOM 节点必须带 `translate="no"` 与 `notranslate`。

## Design System Compliance

遵循 [按钮规范](../../webui/docs/design-system/10-components-button.md) §2–4：并列维护动作 secondary，确认动作单一 primary，禁用原因可读；[数据网格规范](../../webui/docs/design-system/11-components-data-grid.md)：复用既有表格、完整对象标识、键盘与焦点；[页面布局模式](../../webui/docs/design-system/20-patterns-page-layout.md) §3：现有范围树 + 主列表 + 任务抽屉，不增第二套导航。遵守 [Spec 123](../../webui/docs/123-publish-workbench-activation-ia-spec.md) 的工作台入口边界，以及 [Spec 183](../../webui/docs/183-import-scope-preview-spec.md) 对发现 / Manifest / 启用 / 角色能力的分离。后续仅在明确授权的桌面验证阶段执行交互验证，本次无 UI 改动。
