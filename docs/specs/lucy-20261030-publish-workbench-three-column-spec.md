# 发布工作台：待发布优先的三栏设计 Spec

| 元数据 | 内容 |
|---|---|
| 版本 / 日期 | v0.3 / 2026-10-30 |
| 状态 | 已按 v0.2 的设计实现；PWB-01–26 的逐条证据见交付报告（浏览器走查、镜像构建与客户部署不在授权内） |
| 本轮授权 | 已授权按本 Spec 与 Plan 分步实现；不部署、不推送、不改产品版本 |
| 页面 | `/publish/workbench`；完整历史仍在 `/publish/history` |
| 实施 Plan | [实施 Plan](../plans/lucy-20261030-publish-workbench-three-column-plan.md) |
| 需求来源 | 用户连续发布语义后的截图反馈：首先看到还有哪些需要发布，其次查看已发布历史，采用三栏；随后要求优化「确认同步索引并生效」侧栏，清楚说明影响哪些表及其原因 |
| 版本归属 | 暂不绑定产品发版号，也不复用或改写既有 L25 工作项编号 |

v0.2 增补：确认侧栏的信息架构、逐表影响原因与证据、完整范围展示和长列表行为；增加 PWB-20–26，仍仅设计、未开发。

v0.3（2026-10-30，已实现）：按 v0.2 的设计落地三栏工作台与宽确认侧栏。本版只登记**实现事实**与**未执行的验收项**，不把未做的工作写成通过。S0 对终态窗口的裁决见 §8 第 1 条；本次实现未恢复、未关闭 G31，未修改 `publish-coordinator.ts` 与 `semantic-recovery-journal.ts` 的锁生命周期。

## 1. 产品判断与目标

发布工作台应按「我还有什么要处理 → 如何完成这次发布 → 刚才发布了什么」组织信息。用户无需先理解文件路径、Git 状态或索引内部机制，便能定位下一步。

三栏从左到右固定为 **待发布变更 / 生效准备 / 最近发布**。左栏承载首要待办，中栏承载当前行动，右栏承载核对和追溯。三栏不是三个同权重的信息面，也不是三个需要来回切换的页面页签。

主要结果：

1. 进入页面即可看见尚未生效的业务变更及数量；校验过程不遮挡列表。
2. 发布成功并有可靠证据后，对应内容退出待办；再次修改才重新出现。
3. 最近发布可就地核对，失败、进行中和生效未知不会被包装成已生效。
4. 空态、加载失败和状态未知彼此可区分，午夜跨日不清空待办。
5. 确认前能回答「涉及哪些连接和表、每张表为什么在本批、是否还有 Wiki 等其他变更」，不要求用户从裸表名和文件路径自行推断。

## 2. 现状与证据边界

| 代码事实 | 影响 |
|---|---|
| `webui/src/pages/publish/PublishWorkbench.tsx` 目前是变更列表和生效准备双栏 | 工作台缺少最近发布摘要 |
| `webui/server/diff.ts::changedFiles` 合并 Git 差异与会话写入记录，审阅路径含 `.ktx-ui` | Git 未提交不能直接代表业务内容尚未生效；内部文件也可能进入候选列表 |
| `webui/server/index.ts` 手动同步成功后清理已消费的会话记录，Git 差异仍由 `/api/diff` 返回 | 存在发布成功后重复进入待办的实现风险 |
| 手动同步的发布资产描述在 reindex 返回后读取内容 | 不能把该时刻的磁盘内容自动当成索引实际消费的版本 |
| 校验输入来自内存 `changedSources`，自动校验签名主要由路径组成 | 不能保证重启、外部编辑或同路径再次修改后的校验范围与待办一致 |
| 既有发布记录含 `status`、`activationStatus` 等不同证据维度 | 不能单凭一条历史 `published` 记录反推当前所有内容已生效 |
| 确认侧栏分别平铺 Schema 与裸表名；两份列表均 `slice(0, 8)`，未提示剩余数量；其他变更只显示计数 | 连接与表的归属难以辨认，缺少逐表原因，超过 8 项时确认范围不完整 |

以上来自本地代码核对，不是对截图实例的运行取证。截图中的 11 项不能直接认定全部为误报。

## 3. 范围与既有规范关系

本功能覆盖工作台信息架构、待发布事实源、同一批次的校验与确认范围、最近发布摘要和必要的持久化。复用现有校验、发布协调器、索引同步、发布记录及差异抽屉，不创建第二套发布引擎。

- 修订 [Spec 119](../../webui/docs/119-publish-workbench-queue-gate-ia-spec.md) 与 [Spec 123](../../webui/docs/123-publish-workbench-activation-ia-spec.md) 的双栏布局；保留详情按需打开抽屉、整批同步、工作台无上传与导出入口的约束。
- 修订 [Spec 121 §5.2](../../webui/docs/121-publish-workbench-cta-confirm-spec.md) 及 Spec 123 的确认侧栏展示：从计数与名称摘要升级为完整影响审阅；确认仍是同步已有内容的独立路径，不变成上传入口。
- 延续 [Spec 145](../../webui/docs/145-publish-validation-count-clarity-spec.md)：待同步文件数、受影响表数、校验表数分开表达。
- 延续 [Spec 180](../../webui/docs/180-content-root-mirror-drift-spec.md)：内容根与镜像漂移为独立诊断，镜像文件不能冒充作者内容，也不能静默删除。
- 不修改 KTX 上游、Proxy 指导或鉴权；不引入分文件选择发布、审批流、定时发布、历史恢复或新部署形态。
- Skill 和评测资产不因这次改版获得新的发布状态模型。实施前必须核对实际索引消费范围；若既有整批同步还影响这些内容，确认面须真实披露，不能用本页范围缩小索引实际影响。

## 4. 三栏布局与交互

```text
发布工作台                                      [刷新] [更多]
审阅待发布变更，校验并同步索引后使其生效。

┌──── 待发布变更 ────┬──────── 生效准备 ────────┬──── 最近发布 ────┐
│ N 个待同步文件    │ 审阅变更 → 校验 → 同步索引 │ 时间、范围、结果 │
│ 语义资产          │ 本批影响与校验结果          │ 最新 5 个批次    │
│ Schema Manifest   │ 阻断原因 / 下一步           │                  │
│ 业务 Wiki         │ [校验变更]                  │                  │
│ 名称、类型、状态  │ [同步索引并生效]            │ [查看发布记录]   │
└──────────────────┴────────────────────────────┴──────────────────┘
点击左栏条目 → 变更详情抽屉；点击生效按钮 → 确认完整范围。
```

### 4.1 待发布变更

- 初始焦点与阅读顺序优先左栏，标题旁显示文件计数，不以校验通过数代替。
- 按语义资产、Schema Manifest、业务 Wiki 分组，仅展示有内容的分组；内部历史、日志、缓存、AppleDouble 等不属于业务变更。
- 主信息为可解析的业务名称，次信息为对象完整身份和相对路径。表身份为 `connectionId + schema + table`，同名表不得合并；名称不可解析时以实际文件名降级。
- 展示已修改、新增、已删除等变更类型及必要的校验失败状态。长路径截断后可展开或复制，不能撑宽页面。
- 默认列表稳定排序：分组固定，组内按完整身份/路径排序；校验完成不改变行位置。
- 点击条目打开差异抽屉，不自动发布，也不引入勾选框。差异基于最近有证据的同步内容；缺少前版本时展示当前内容和「暂无可比较的生效版本」，不把 Git 差异冒充生效前后差异。

### 4.2 生效准备

- 中栏承担唯一发布主动作；页眉不再重复放校验和发布按钮。
- 审阅、校验、同步步骤表达当前过程；仅有文件不代表人工审阅已完成。本版不新增逐文件强制审阅门槛。
- 展示本批文件数、受影响表数、Schema Manifest 与 Wiki 影响。说明「本批一并同步，不可分文件勾选」。
- 校验进行态显示在中栏，左栏可继续查看；失败时给出可定位的问题和下一步。
- 校验结果绑定内容摘要与完整表身份。同一路径内容变化立即使旧结果失效；请求晚返回不得覆盖新版本状态。
- Wiki-only、仅删除或仅 Manifest 的批次不以「没有 overlay 校验结果」一律阻断；按资产类型运行既有适用校验，全部必需检查通过才可提交。不得跳过已有门禁。
- 发布按钮打开确认抽屉，显示完整实际范围。确认绑定内容版本，提交前变化则要求重新校验/确认。
- 无变更时显示「暂无待同步变更」，仍可通过次级「同步索引」维护索引；全量重建放在「更多」，不得绕过既有恢复与互斥约束。

### 4.3 最近发布

- 默认展示最新 5 个发布批次，按创建时间倒序、相同时按稳定 ID 排序；不使用「今天」作为固定过滤条件。
- 复用发布记录 API 和 `publishHistoryLabels.ts` 的状态映射；范围摘要、时间、结果为主要内容，技术 ID 为次级信息。
- 展示最近发布尝试，包括进行中与失败；列标题为「最近发布」，不能写为「已生效」后混入失败记录。
- 保留既有 `activationStatus` 证据含义，旧记录不补造 confirmed。单纯维护索引且无业务变更的记录默认不占摘要名额，可在完整记录页查看；筛选应在服务端先执行再限 5 条，避免客户端过滤后漏掉真实最近批次。
- 页内以次级链接打开 `/publish/history`；本版不复制历史页的筛选、导出和恢复功能。

### 4.4 加载、失败、刷新与可访问性

三个区域独立加载、报错和重试。历史请求失败不阻断左栏和校验；待办请求失败不得显示「暂无待同步变更」，发布动作应不可提交。刷新保留已展示的数据并标注更新中，不用整页遮罩。

发布或保存后刷新待办和最近发布；页面重新获得焦点时重新核对。存在异步发布时每 3 秒轮询其状态，终态后停止；轮询失败保留最后状态并提示，禁止推断成功。不新增后台永久轮询或通知。

布局顺序与 DOM/键盘顺序一致。抽屉支持 Escape、焦点约束与关闭后归还焦点；状态有文字，不只靠颜色。业务列表加载中和确认未知时不得宣布空态或成功。

时间按浏览器本地时区显示，带月日与时分，跨年时显示年份；详情可查完整时间。跨午夜只影响时间显示，不改变待办或默认历史窗口。

### 4.5 「确认同步索引并生效」侧栏

#### 4.5.1 用户需要核对的信息与布局

侧栏依次回答「本次同步多少内容 → 涉及哪些表 → 每张表为什么在本批 → 还有哪些非表内容」。不继续沿用一行总计后接两个无标题名单的形式。

```text
确认同步索引并生效                                    [关闭]
本批内容将一并同步，不能按表单独选择。
──────────────────────────────────────────────────────────
涉及表 N 张 · Schema Manifest M 个 · 业务 Wiki W 篇
待同步文件 F 个；涉及 C 个连接（文件数与表数分别计算）

涉及的表                         [按表名或原因搜索]
连接 A / Schema X                                      3 张
┌ 业务名称（可用时）                                        ┐
│ 完整表名（可换行、可复制）                     [校验通过] │
│ 影响原因：指标定义变更；Schema Manifest 中的字段描述变更   │
│ 变更来源：本次导入 / 既有待发布变更（按实际标记）           │
│ [展开变更证据]                                           │
└──────────────────────────────────────────────────────────┘
连接 B / Schema Y                                      … 张
…全部涉及表可滚动查看，不默默截取前 8 项…

业务 Wiki W 篇
文档标题 · 已修改                         [展开变更证据]
Schema 级变更 / 关联与校验范围（有内容才显示）
──────────────────────────────────────────────────────────
本次将同步全部范围；搜索只影响展示。
[取消]                              [同步索引并生效]
```

图中数量与原因是布局示例，不代表截图中的实际变更。解析前不得把截图中的 7 张 overlay 表直接写成完整影响总数：一个 Manifest 文件可能涉及更多表，11 个文件也不等于 11 张表。

#### 4.5.2 宽度、阅读与滚动

- 使用本页限定的宽确认侧栏：桌面目标宽度 880px，最大 960px，且不超过视口宽度减 48px。不修改所有抽屉的共享宽度，不为多显示几列压缩正文到极小字号。
- 页头与页脚固定在侧栏容器中，正文为唯一纵向滚动区域（`min-height: 0`）；避免整个抽屉连同操作按钮一起滚走，也不为每个连接分组再嵌套滚动条。
- 正文按「范围摘要、涉及的表、业务 Wiki、其他有证据的范围」分区。摘要是简洁文本与计数，不新增抢占高度的 KPI 卡。
- 按连接 / Schema 分组，组内以可读的对象条目呈现，使用语义列表而非大段裸文本。完整表名和原因默认可见，长标识符可换行，不能只依赖 hover；路径和逐字段 diff 默认折叠。
- 对象名及原因沿用现有 `text-sm` 正文字级，辅助路径使用 `text-xs`；标题与状态分层，不整页加粗、不只用颜色表达风险。此处不套用高密度 Data Grid 的字号压缩规则。
- 小批次直接显示全部条目；多连接分组可折叠，组标题始终保留总数。长列表提供搜索并显示「当前显示 X / 共 N 张」，默认不分页隐藏首 8 项；后续如确需分页，必须显式显示总数、剩余数和加载入口，未加载不等于范围外。
- 搜索与折叠只过滤展示，不能改变确认 payload 或影响范围；有搜索结果过滤时，页脚明确仍将同步全批。无需逐项点击或滚到底才能确认，不新增无依据的勾选门槛。

#### 4.5.3 每张表的原因和证据

每个表条目默认可见：业务名称（存在时）、完整表名、所属分组、**影响原因**、变更来源和适用的校验状态。一张表可有多条原因，但在涉及表总数中只计算一次。

| 纳入原因 | 默认说明 | 可展开的证据 |
|---|---|---|
| 表语义文件变更 | 实际发生的指标、维度、关联、描述等定义变更；无法进一步解析时显示「表语义文件内容变更」 | 对应逻辑路径、变更类型、已核验的新增/修改/删除项与前后差异 |
| Schema Manifest 中的表结构/描述变更 | 明确该表发生的字段新增、字段删除、类型或描述变更等 | Manifest 路径、表/字段定位及前后差异；不能用同 Schema 所有表代替实际变化表 |
| 首次核对 | 首次同步核对范围内的表；不冒称是新增表或已确认发生语义变更 | 当前对象身份与内容来源，说明没有可信前版本 |
| 有明确关系的文档或表引用 | 展示在单独的「关联与校验范围」，说明仅是显式引用或校验依赖 | 已有结构化引用及来源；不推断为该表定义被修改 |

原因回答的是「为什么被纳入这次同步」，不猜测维护人的业务动机。不能仅凭文件名补写「为了提升准确率」等无证据解释；不能仅凭 Wiki 正文出现表名就宣布该表受影响。

一个表同时有 overlay 和 Manifest 变化时，合并为一个条目、保留两类原因和证据。目录名、裸表名或当前 `findSourceForTable` 的首个匹配不足以证明完整身份；无法解析时进入「影响范围待核对」，显示已知文件及具体缺失信息，不能按猜测分组。

#### 4.5.4 其他内容、风险与提交

- 业务 Wiki 独立列出标题、路径、变更类型和查看证据入口，不再只记为「其它 3 项」。编辑历史等内部文件应在待办阶段排除，不能作为隐藏的同步内容。
- Manifest 仅有 Schema 级元数据变化、无可证明的逐表变化时，单独列「Schema 级变更」，不强行凑入表数。关联与校验范围与直接变更分区，摘要的「涉及表」按直接变更和明确首次核对对象去重计算。
- 证据就地展开，避免关闭确认侧栏再开第二个叠加抽屉。返回对象列表时保留搜索、折叠和滚动位置；证据内代码/路径遵循翻译防御。
- 校验通过不等于确认范围完整。逐表影响解析失败、缺少文件、响应截断、版本过期或未决恢复时，展示明确原因并禁用提交，提供重新预览/校验入口；可解析的通用「文件内容变更」说明可作为降级，不要求每次都解析到单个指标。
- 打开抽屉时捕获服务端影响快照；后续内容变化时显式提示「变更内容已更新，请重新核对」，旧确认不可提交，刷新后不能直接沿用旧同意状态。
- 固定页脚保留取消与一个主按钮，按钮仍为「同步索引并生效」。提交中防重复操作；失败留在侧栏并保留已核对内容，可靠成功后关闭并刷新工作台。超时或证据不完整时显示待核验，不因请求结束就关闭为成功。
- 打开时将焦点置于侧栏标题，关闭后回到原发布按钮；范围更新通过温和的可访问提示通知，不夺取正在阅读的焦点。

## 5. 待发布事实源与内容版本

### 5.1 定义

**待发布变更**是当前作者内容与最近有可靠同步证据的内容版本之间的差异。Git diff 和会话写入记录可用于发现变化，不能作为是否已生效的唯一判据。

- 通过 `resolveContentPaths` 读取实际内容根，以规范化逻辑相对路径作为文件身份，不直接扫项目根镜像替代内容根。
- 初始业务范围为语义层 YAML 与业务 Wiki Markdown；排除 `.ktx-ui/**`、`wiki/.lucy-history/**`、编辑历史、缓存、临时文件和越界符号链接。
- 使用原始内容字节 SHA-256；删除用显式 absent 状态，不能把空文件与不存在合并。
- 扫描当前文件与已知同步基线的并集，以发现新增、修改和删除；未跟踪文件、已暂存文件和无 Git 项目也必须正确。
- 内部基线完整且某路径未出现时可判新增；没有完整基线时只能标为待核对，不能推断它从未发布。
- 一份完整内容快照的 `pendingDigest` 包含基线代次、路径、存在性和内容摘要。数量、校验、确认、提交共同引用该版本。

### 5.2 持久化合同

新增 Lucy 私有状态目录 `.ktx-ui/publish-workbench/`，位于项目状态目录，禁止进入内容镜像、Git 业务差异或公共导出：

| 对象 | 必要内容 |
|---|---|
| `baseline.json` | 格式版本、实例/内容根绑定、完整性标记、单调 generation、releaseId/attemptId、确认时间、逻辑路径到内容摘要的映射 |
| `blobs/<sha256>` | 基线对应的原始业务内容，用于生效前后差异；写入时核验内容摘要 |
| `attempts/<attemptId>.json` | 本次确认摘要、预期基线代次、实际消费快照、关联发布记录、阶段及失败原因，支持崩溃对账 |

状态目录不保存凭据，目录权限 0700、文件权限 0600。写入采用同目录临时文件和原子替换；基线内容引用就绪后才替换指针。只清理既非当前基线、也非未结算尝试引用的内容；不能在读取请求或启动迁移中删除业务文件。

基线是待办判定缓存与证据引用，不是 KTX 索引的替代品，也不是 L25-15 的可恢复历史快照。不得借本功能提供内容恢复按钮或补写旧历史的生效确认。

### 5.3 成功、失败与并发

同步前持久化实际将消费的内容版本，不能在索引返回后才读取当前磁盘并把它登记为已消费。对实际消费范围、删除和镜像漂移必须可核对；无法证明的路径保持待核对。

仅在索引成功、既有终态核验/审计完成、实际内容与确认范围一致且证据持久化后推进基线。失败、取消、恢复未决、索引成功但终态证据缺失时不推进。错误信息区分「索引失败」和「生效状态待核验」。

Lucy 受控写入口继续共用既有单实例发布协调器；基线代次更新必须与终态结算串行化。索引期间的非受控外部改动不能静默消费：最终发现漂移时保留待办并标明待核验，重新校验后再提交。不能保证时间窗口一致时，不用最终磁盘状态补造成功快照。

成功记录已落盘但基线未推进的崩溃窗口，由启动对账核验 attempt、发布终态、消费快照及基线代次后幂等补齐；缺少任一可靠证据则保留原基线并标待核验，不自动重建索引或回滚内容。

### 5.4 首次启用与旧数据

不存在新基线时，不直接把当前内容标为已生效；已有发布历史只供展示，不拼接成虚构的完整基线。以「首次核对：尚无完整生效基线，请校验并同步确认」提示，当前业务内容为待核对，保留统一发布入口。

首个完整、可核验的成功同步建立基线。内容根绑定变化、状态损坏或扫描不完整时进入待核验，禁止静默生成空基线或清空待办。此时中栏给出具体原因、相关发布记录入口及既有恢复/核验处理指引；恢复前禁止提交，不提供跳过核验按钮。首次没有基线与基线损坏必须分开：前者允许受控的首次同步建立基线，后者须先处理状态异常。空项目不创造虚假的发布变更。

### 5.5 统一影响模型

影响说明由 Lucy 在服务端根据同一待办/批量计划快照计算。主区摘要、确认侧栏和最终提交共用结果，不由前端重新按文件 basename 猜表名。

```ts
type PublishImpact = {
  pendingDigest: string;
  planDigest?: string; // staged 批次沿用既有完整计划绑定
  complete: boolean;
  counts: { files: number; tables: number; manifests: number; wikiPages: number };
  tables: Array<{
    identity: { connectionId: string; schema: string; table: string };
    reasons: Array<{
      kind: "overlay_change" | "manifest_table_change" | "first_verification";
      summary: string; // 证据支持的纳入原因，不是生成的业务动机
      source: "staged_candidate" | "pending_disk_change";
      filePath: string;
      evidenceRef: string; // 同版本、可定位的差异或当前内容引用
    }>;
  }>;
  wikiChanges: Array<{ filePath: string; title?: string; changeType: string }>;
  schemaChanges: Array<{ connectionId: string; schema: string; evidenceRef: string }>;
  relatedScope: Array<{ identity: unknown; relationKind: string; evidenceRef: string }>;
  unresolved: Array<{ filePath: string; reason: string }>;
};
```

`relatedScope.identity` 的实现须使用已有表身份或 Wiki 身份的判别联合类型；此处不发明新的实体身份合同。`complete` 表示实际同步范围已完整解析且无未解决项，不代表校验通过或索引成功。所有 evidenceRef 由服务端约束在关联快照内，不能直接使用客户端绝对路径读取磁盘。

Manifest 逐表比较以可信前版本与候选版本的结构化对象为依据：表新增/删除及字段/描述变化映射到对应完整身份；只有格式、注释或 Schema 级变化时，不虚构逐表业务变化。只有当前版本且属于首次核对时，完整枚举已知范围并逐表标记首次核对；解析或身份缺失时不输出貌似精确的总表数。

## 6. API 与集成合同

不引入新对外 MCP 工具。优先兼容扩展既有 HTTP 接口：

| 接口 | 变更要求 |
|---|---|
| `GET /api/diff` | `files` 改为统一待发布结果；保留既有字段，增加 `pendingDigest`、`baselineState`（ready / uninitialized / needs_verification）、`baselineGeneration` 和同版本 `impact`；保留漂移诊断 |
| `POST /api/validate-changed` | 从同一内容快照推导完整校验范围，返回其 `pendingDigest` 和按资产类型适用的校验结论；不能只依赖内存 changedSources |
| `POST /api/semantic-assets/reindex` | 工作台提交携带确认的 `pendingDigest`；旧调用无该字段时由服务端捕获快照并执行既有检查，不允许放宽校验；变更冲突返回可读的 409 |
| `GET /api/semantic-assets/releases` | 增加可选 `businessChangesOnly=true`，先过滤无业务变更维护记录再排序/分页；原调用语义不变 |
| 批量发布 plan / submit / status | staged candidates、已有磁盘待办和完整实际影响使用统一事实源，plan 返回同版本 `impact` 供共享确认组件使用；保留既有 planDigest、覆盖集、幂等、恢复与授权校验，不能用 pendingDigest 替代它们 |

基线响应不返回磁盘绝对路径、凭据或全部历史正文。展开证据复用受约束的已有预览能力，或使用同快照服务端引用；响应过大时返回明确未完整状态，不静默截断。最近发布仍按原接口权限读取；状态缓存/query key 必须包含影响过滤结果的参数。

## 核心流程（伪代码）

```text
read_pending():
  current = scan_authoring_business_files_and_validate_scope()
  if scan incomplete/unreadable: return error_or_needs_verification, never empty_success
  baseline = load_and_validate_instance_bound_baseline()
  if baseline missing: return current as first_verification (empty project remains empty)
  if baseline invalid or unresolved attempt: return needs_verification, disable activation
  changes = compare(current, baseline; distinguish empty bytes from absent)
  return changes, digest(baseline.generation, current), mirror_diagnostics

validate_and_confirm():
  snapshot = read_pending()
  impact = build_impact(snapshot, optional_staged_plan):
    map overlays to full table identity
    compare Manifest before/after per table; do not expand blindly to every schema table
    merge reasons by full identity; separate Wiki, schema-only changes and reference dependencies
    mark first verification explicitly; keep unresolved files visible
    check all publish targets accounted for; never truncate silently
  if impact incomplete or version changed: disable confirmation, require renewed preview
  validate applicable assets and dependencies using complete identities
  display grouped tables + reasons + evidence, bind all to snapshot.pendingDigest/planDigest
  search/collapse changes only presentation, never the submitted scope
  if current version changed: discard obsolete results, require revalidation

activate(confirmation):
  acquire existing shared publish window; reject busy/recovery_required
  capture actual consumption snapshot; recheck confirmation + existing gates
  if stale/unsafe mirror/deletion: reject before indexing; preserve pending
  persist attempt + content references
  run existing index activation and final checks
  if failed/uncertain/drift: persist actual result; keep baseline unchanged
  else:
    persist existing terminal evidence
    CAS baseline generation to the proven consumed snapshot
    finalize attempt before releasing shared publish window
  refresh pending and recent releases; never mark a later version consumed

startup():
  reconcile unfinished attempts against terminal evidence and baseline generation
  proven terminal success -> idempotently complete baseline update
  missing/conflicting evidence -> needs_verification, no fabricated success
```

## 7. 验收矩阵

**本轮已按 Plan S0–S6 执行。** 逐条结论、证据来源与实际命令见 [交付报告](../reviews/2026-10-31-publish-workbench-three-column-delivery.md)。下表的「本轮结论」列按三种口径填写：

- **通过**：有自动化用例或可核对的实现事实直接覆盖该条。
- **部分通过**：行为已实现，但缺专项自动化用例，或未做浏览器实测（逐条原因见交付报告）。
- **阻断**：因终态保障缺失而无法给出结论。**本轮 0 条。**

浏览器走查、移动窄屏、镜像构建与客户部署不在授权范围，未执行。

| ID | 可验证结果 | 本轮结论 |
| PWB-01 | 首屏顺序为待发布变更 / 生效准备 / 最近发布，待办可独立加载；只有中栏存在发布主动作 | 通过 |
| PWB-02 | 左栏分组、文件数和业务名称可读；完整身份保留，同名跨连接表不合并；路径有翻译防御 | 通过 |
| PWB-03 | 内容确认成功后移出待办；Git 仍脏也不重复出现，同路径再次修改重新出现 | 通过 |
| PWB-04 | 索引失败或返回异常保留待办，展示实际错误，不写成功基线 | 通过 |
| PWB-05 | 同路径内容变化使校验及确认失效，晚返回的旧校验不能覆盖新状态 | 通过 |
| PWB-06 | 服务重启、无 Git、未跟踪/暂存文件、直接编辑内容根均能识别真实待办 | 部分通过 |
| PWB-07 | 删除、空文件和新增可区分；已知删除与镜像残留不误判已生效 | 通过 |
| PWB-08 | `.ktx-ui`、Wiki 编辑历史和系统杂项不进入待办，真实业务 Wiki 保留 | 通过 |
| PWB-09 | 待办、校验、确认和批量计划范围一致；Wiki-only、Manifest-only、删除批次按适用检查处理 | 部分通过 |
| PWB-10 | 索引期间产生新版本、范围外变化或新批次不能被上一批消费；提交后漂移进入待核验 | 通过 |
| PWB-11 | 缺失/损坏基线、旧历史无充分证据、内容根绑定变化均不推断当前已生效 | 通过 |
| PWB-12 | 索引成功但终态/基线持久化失败不显示整体成功；崩溃后可幂等对账，缺证据不自动补成功 | 通过 |
| PWB-13 | 右栏正确展示最近 5 个业务批次；过滤在限额前执行；进行中、失败、未知准确呈现 | 通过 |
| PWB-14 | 右栏失败不影响待办和校验；待办请求失败不显示空态或开放提交 | 通过 |
| PWB-15 | 午夜、跨年与时区变化不清空待办；历史不固定限制为今天 | 部分通过 |
| PWB-16 | 差异抽屉比较可信前版本；无前版本明确说明，不把 Git diff 冒充生效差异 | 部分通过 |
| PWB-17 | 刷新、轮询终止、焦点顺序、Escape 与焦点归还可通过组件测试核对 | 部分通过 |
| PWB-18 | 整批同步、覆盖确认、恢复阻断、互斥、幂等、原有发布记录页行为未退化；无变更维护同步仍可用 | 通过 |
| PWB-19 | 类型检查、术语检查、适用定向测试及构建通过；未默认执行浏览器/移动窄屏测试 | 部分通过 |
| PWB-20 | 确认侧栏按连接/Schema 分组，默认显示每张表的完整标识和纳入原因；同名跨连接不混淆 | 通过 |
| PWB-21 | 同表多文件原因合并且总表数去重；Manifest 真正变化表、Schema 级变化、Wiki 与校验依赖正确分区和计数 | 通过 |
| PWB-22 | 超过 8 张表或多个连接时可查看完整范围；搜索/折叠显示正确总数，不缩小实际同步集 | 通过 |
| PWB-23 | 每条原因可追溯到同版本证据；无可靠前版本明确首次核对，缺失身份或范围解析不完整时阻止提交 | 通过 |
| PWB-24 | 确认侧栏采用本页限定宽度、固定页头页脚与单一正文滚动区；长表名和原因可完整阅读，不改变其他抽屉 | 部分通过 |
| PWB-25 | 侧栏内就地查看证据后保留阅读状态；失败保留侧栏，范围更新使旧确认失效，提交绑定完整快照 | 部分通过 |
| PWB-26 | 常规同步与 staged 批次复用同一影响说明规则；既有覆盖确认、幂等和校验约束保留，不从名称猜测影响原因 | 部分通过 |

## 8. 已知依赖与实施前裁决

1. 既有批量发布/手动 reindex 的终态锁生命周期偏差，对应 L25-11 G31 及 L25-15 S0 外部工作项。按现有登记，2026-10-29 该项无 owner、已挂起。本 Spec **不恢复该项、不关闭 G31、不授权修改其冻结边界**。本功能需要终态与基线推进串行化；后续开发授权前须明确由哪个已授权工作项提供或修复该保障，否则完整状态闭环不可交付。不能仅凭协调器注释声明保障已经存在。

   **S0 裁决（2026-10-30 实施，已落代码并核对源码位置）**：逐条核对两条发布路径的放锁点后确认——批量发布路径的 `verifyFinalTargetDigests`（终态核验）、`recordConfigChange(semantic_publish_terminal)`（终态审计）、`updateReleaseRecord(published, confirmed)` 与 `completeRecoveryJournal` 全部在 `runReindex` 的 `finally` 放锁之前；手动 reindex 路径的终态记录写在 `withPublishCoordinator("manual_reindex", …)` 回调内。**现有窗口已经把终态核验、终态审计与基线推进放在同一串行窗口内**，因此本功能只把基线 CAS 接进该窗口（消费快照在索引读取内容之前采集），不新造锁、不改协调器。**G31 的登记行未被本功能改写，也未被本功能关闭**；是否据本裁决关闭，仍由 L25-11／L25-16 的维护者决定。证据与逐条影响见交付报告。
2. 核对实际索引读取面、Wiki 排除路径和删除能力；若上游仍收录已删除内容，仅更新本地基线不足以判生效。此类项必须保留诊断并阻止虚假成功。
3. 基线/快照规模上限、请求超时和磁盘不足行为须在实施 S0 基于现有资产限制冻结；达到上限应可诊断地失败，禁止截断扫描后清空待办。

## 闭口层级

- 层级：功能合同
- 本条承诺：发布工作台按「待发布变更 / 生效准备 / 最近发布」三栏呈现；待办只反映「当前作者内容」与「最近有可靠同步证据的内容版本」的差异；确认侧栏按连接与 Schema 分组，逐表给出纳入原因与证据，并展示完整范围。
- 本条出口：PWB-01–PWB-26 对应的服务端与组件自动化用例，加上 `lint:terminology`、`lint:ia-boundary`、typecheck 与 build。
- 不在本条出口：整库旅程、Agent 路径、跨模块或系统级故障演练、证据等级（浏览器走查、移动窄屏、镜像构建、客户部署）。
- 上线关系：本条收口不表示可上线

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- 最近发布：右栏摘要标题，含发布尝试；与完整「发布记录」入口区分。
- 涉及的表 / 影响原因：确认侧栏主区标题与逐表说明，表示直接变更或明确首次核对对象的纳入原因，不等于所有重新索引的表。
- 变更来源：本次导入 / 既有待发布变更；说明纳入途径，不与影响原因或修改者动机混为一谈。
- Schema 级变更 / 关联与校验范围 / 影响范围待核对：分别呈现非逐表变化、仅关联/校验对象和无法确认的影响；不能统称表语义已变更。
- 首次核对 / 待核对 / 生效状态待核验：分别用于首次基线核对、首次基线核对或状态异常、以及结果证据缺失。

修订说明（不是新增术语）：本 Spec 把「待发布变更」由术语标准 §4.3 的禁止文案改为左栏主术语，并撤销 Spec 123 的同款旧约束；同步登记见 `webui/docs/00-product-terminology-standard.md` §4.3 与 §3。

| 术语 | UI 主术语与约束 |
|---|---|
| 待发布变更 | 左栏主标题；明确修订 Spec 123 及术语标准 §4.3 禁止其作为唯一栏标题的旧约束，实施前同步标准 |
| 生效准备 | 沿用既有术语，中栏承载当前操作 |
| 最近发布 | 右栏摘要标题，含发布尝试；与完整「发布记录」入口区分 |
| 待核对 / 生效状态待核验 | 前者用于首次基线核对，后者用于结果证据缺失；不等于失败或已生效 |
| 生效基线 | 仅作技术说明；界面优先使用「首次核对」「生效状态待核验」，不要求用户理解存储结构 |
| 涉及的表 / 影响原因 | 确认侧栏主区标题与逐表说明，表示直接变更或明确首次核对对象的纳入原因，不等于所有重新索引的表 |
| 变更来源 | 本次导入 / 既有待发布变更；说明纳入途径，不与影响原因或修改者动机混为一谈 |
| Schema 级变更 / 关联与校验范围 / 影响范围待核对 | 分别呈现非逐表变化、仅关联/校验对象和无法确认的影响；不能统称表语义已变更 |

`Schema Manifest`、`Wiki`、`Agent`、对象名、路径、URL 节点均须同时使用 `translate="no"` 与 `notranslate`。新术语已在本节登记；本轮不修改运行时文案或全局标准正文。

## Design System Compliance

### Referenced Specs
- `webui/docs/design-system/02-foundations-grid-spacing.md`
- `webui/docs/design-system/03-foundations-typography.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/design-system/20-patterns-page-layout.md`
- `webui/docs/design-system/99-governance.md`（临时决策 **TD-20261030-01**）

### What This Change Follows
- [x] 12 列网格下的 4/5/3 初始比例；统一 gutter/padding，继承全局桌面最小可读宽度，不做移动端重排。
- [x] 主任务优先：最近发布作为弱化的辅助区，变更详情按需抽屉，不默认常驻全文 Diff。
- [x] 工作区最多一个发布主动作；校验、刷新、历史链接为次级动作；页眉不重复主按钮。
- [x] 确认侧栏以可读对象列表与原因分层；长标识符换行、正文与路径分级；不用整屏路径代替影响说明。
- [x] 颜色只使用语义 token 与语义 class；状态有文字，不只靠颜色表达。
- [x] 焦点态、禁用态、加载态与失败态均有文字说明；Escape 与焦点归还有组件测试覆盖。

### Exceptions (If Any)
- 宽确认侧栏的宽度（目标 880px、最大 960px、不超过视口宽减 48px）由组件内联样式给出，**未写入共享的 `.pl-drawer-panel`**；三栏使用本页专属的 `.pl-publish-workbench-layout`，**未修改共享的 `.pl-review-layout`**。该页面级模式已登记为 TD-20261030-01，只作用于 `/publish/workbench`。

### Follow-up Needed
- 桌面几何可读性（长表名换行、880px 侧栏的实际观感）**尚未做浏览器实测**；几何验收留待发版走查，组件测试不能冒充视觉验收。
- TD-20261030-01 待升级为 `20-patterns-page-layout.md` 的正式章节。
