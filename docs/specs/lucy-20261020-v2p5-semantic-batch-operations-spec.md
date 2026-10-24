# Lucy v0.25 语义资产批量维护 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 功能设计基线 / v0.2-requirements-review |
| 日期 / 目标版本 | 2026-10-24 / v0.25 |
| 功能编号 / 优先级 | L25-11 / P0-3，企业批量运维核心能力 |
| 状态 | 设计完成、待需求审查；暂不开发，不代表实现或验收通过 |
| 授权来源 | 2026-10-24 Forrest 批准首批 Spec 评审 Final 决议，并要求完成四个 P0 设计材料 |
| 规划入口 | [Lucy v0.25 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.5；[P0 Final 决议](../reviews/2026-10-24-lucy-v0.25-p0-final-decision.md) |
| 审查入口 | [首批 P0 需求审查清单](../plans/2026-10-24-lucy-v0.25-p0-requirements-review-checklist.md) |
| 实施主体 | Lucy；复用 KTX 既有公开接口，不修改 KTX 源码 |

本文件定义拟实现行为，不代表已实现、已冻结或已经通过验收。本次不修改程序、运行配置、客户资产、镜像或数据库，不新增测试代码，不执行功能验证或部署。

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

运行页缺少入口已通过界面观察确认；后端复用结论来自本地源码静态阅读，未对运行镜像做接口贯通证明。现有逐文件 rename 不等于整批事务，已有发布成功状态也不能替代本功能验收。

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

每条 entry 至少包含：`entryId`、`role`（`editable_overlay` / `readonly_context`）、完整表身份、包内相对路径、原导出内容 digest、原目标 digest（或 absent）、原语义基线 digest。元数据还记录 schemaVersion、导出时间、实例 ID、Lucy 产品 / 构建标识、全部所选表和依赖角色。

- 原文件 digest 用于来源和冲突对比，不作为作者签名。外部编辑后候选内容 hash 可以变化；导入服务重算新 hash，不要求用户手改原 digest。只读 entry 内容变化、entry 身份被改绑或缺少必要 entry 均阻断。
- 包的基线由服务端保存的导出记录核验，不相信客户端自报。原包来自其他实例、记录过期或无法核验时，本期阻断并说明需在目标实例重新导出，暂不支持跨实例迁移 / 重绑定。
- 无 overlay 的选中表导出显式模板，附 `baseTarget=absent`；未改动模板导回为无变化，修改后按完整语义校验处理。不能以空模板冒充已有业务定义。
- 安全解包拒绝绝对路径、`..`、符号链接 / 硬链接、重复归一化路径、重复身份、嵌套包和未登记 entry。禁止 secrets、凭据、ACL、原始数据、运行状态库及任意脚本文件；不返回宿主绝对路径。
- 草案统一限制：最多 200 个 YAML entry（包括只读上下文），单 YAML ≤512 KiB，metadata ≤256 KiB，解压内容总计 ≤16 MiB，ZIP ≤20 MiB；HTTP JSON 请求体 ≤32 MiB，覆盖 Base64 开销。上传多 YAML 使用相同内容总量 / 数量限制；限制由同一共享定义提供，不能只改前端常量。
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

导入任务：`staged → checking → ready / blocked / cancelled / expired`；在工作台确认后关联 releaseId。发布沿用 `blocked / promote_failed / reindexing / published / reindex_failed`，增加恢复必要信息 `recoveryRequired` 及独立 `activationStatus=unconfirmed / confirmed`，不改写历史状态含义。旧记录缺少新字段时为 unknown，不从旧 published 自动补 confirmed。界面分别显示“已暂存”“校验通过”“文件已保存”“索引同步中 / 失败”“已生效”。HTTP accepted 仅代表受理。

### 7.2 提交合同

- 锁覆盖基线复核、最终校验、正式写入、镜像同步、索引和最终状态持久化；§7.1 列明的全部写入口进入同一协调器，竞争返回可读 busy。外部 CLI / Git 写入不受进程锁控制，digest 发现后停止并重新预览；本期不承诺任意外部写者并发事务。
- 校验未全通过前，正式文件、运行镜像目录、索引均不写。提交时重读授权和完整计划；预览、覆盖确认绑定同一个 planDigest，不能用一个全局 confirmOverwrite 布尔值授权变化后的目标集合。
- 使用服务端持久幂等键（按实例 + 操作者 + 客户端幂等键查找，记录所绑定的 planDigest，保留至少 24 小时）；重复提交返回同一个 releaseId，禁止重复写盘或重复索引。同一幂等键与其他计划组合返回冲突。
- 写入前持久化每个实际目标的原 bytes / absent、预期新 digest、处理顺序和恢复日志；每次替换前再校验该目标基线，用同目录临时文件 + rename，更新恢复日志。只操作已确认目标。
- 中途写入、镜像同步或持久记录失败，停止后续步骤；按日志逆序恢复本批次已改目标，并同步恢复镜像。不触发新索引，不还原其他既有磁盘变更。恢复时发现第三方新内容不覆盖，标记 `recoveryRequired=true`，展示已写 / 已恢复 / 待修复对象，并阻止后续发布和手动索引直到恢复核验完成。
- 启动恢复先处理未终结日志，再开放发布。进程在 rename 后、日志更新前退出时，以原 / 新 digest 判定；无法判定则待人工修复，不猜成功。恢复材料保留到终结且可审阅后再按既有保留策略清理。
- 索引失败保留已保存文件，记 reindex_failed 和“不保证 Agent 已生效”；从发布工作台重试索引，核对已保存计划及当前待同步范围，不重复上传或 promote。范围变化须重新预览、校验、确认；重试关联原 releaseId 和新的 attemptId，不篡改原失败记录。

这些是应用级可恢复批次，不宣称文件系统多文件与 SQLite 索引具备共同原子事务，也不承诺发布过程中所有读取看到同一瞬时版本。`published` 只在正式文件 / 运行镜像与目标 digest 一致、索引成功且终结记录已持久化后成立；不满足时绝不能给成功提示。若出现未恢复的部分写入，必须沿用或补齐现有运行一致性拦截，使涉及资产的 Lucy 读取 / 查询明确不可用，不能继续宣称一致；不改变 ACL 或预算规则。

### 7.3 审计

复用配置审计、安全账本及 [L25-09](lucy-20261020-v2p5-audit-increment-spec.md) 适用契约。记录 actor、operationId、scopeId、planDigest、releaseId、attemptId、基线与候选 hash、对象数量、分项结果及恢复状态；不得把下载、预检或校验记成发布成功。导出前和正式效果前完成所需审计持久化，失败按既有 fail-closed 合同处理；效果后终结记录失败需恢复核验，不能谎称未发生。普通日志不存原始 YAML、凭据或宿主路径；受控 staging / 备份独立受管理员访问控制。

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
  entries = safelyExpandAndValidateAllInput(input)  // 边解压边检查大小
  if maintenancePackage:
    requireSameInstanceAndUnexpiredServerExportBaseline(entries)
    reject changedReadonlyContext / reboundEntry / missingEntry
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
  return fullPlanPreview(planDigest, allEffects, overwriteSet, results)

confirmAndPublish(actor, validationId, confirmedPlanDigest, idempotencyKey):
  requireCurrentWebuiMaintenancePermission(actor)
  with sharedSingleInstancePublishCoordinator:
    if idempotencyAlreadyAccepted(actor, key, digest): return sameReleaseStatus
    reject idempotencyPayloadMismatch / recoveryRequired
    plan = rebuildCompletePlan(validationId)
    reject expired / actorMismatch / planDigestMismatch / targetOrDependencyChanged
    finalChecks = validateEntirePlanWithSharedChecksAndExistingContractGate(plan)
    if anyBlockingOrIncomplete(finalChecks): return blockedWithoutFormalWrites
    persistIdempotentIntentAndRecoveryJournalOrFail(plan)
    try:
      for target in plan.stagedWriteTargets:
        compareBaselineAgain(target); atomicReplaceAndJournal(target)
      synchronizeRuntimeMirrorAndVerifyDigests()
    catch writeOrMirrorFailure:
      restoreOnlyThisBatchTargetsUsingJournalOrMarkRecoveryRequired()
      persistFailureAndReturnWithoutReindex()
    persistFilesSavedAndReindexingOrRecover()
    reindexResult = runExistingIncrementalReindexOnce(plan)
    if reindexResult.failed:
      persistReindexFailed(); return filesSavedButActivationUnconfirmed
    if not formalAndMirrorDigestsStillMatch(plan):
      persistActivationUnconfirmed(); return staleAndRequireNewPreview
    persistTerminalAuditAndPublishedOrMarkUnconfirmed()
    return published

recoverAfterRestart():
  beforeEnablingPublishOrManualReindex:
    for incompleteJournal:
      compareActualBytesWithOldAndNewDigests()
      if writesIncomplete: restoreOwnedWritesOrRequireRepair()
      else if indexOrTerminalOutcomeUnproven: recordActivationUnconfirmed()
    doNotReleaseRecoveryBlockUntilVerified()
```

## 10. 验证机制与验收矩阵

### 10.1 验证层次与证据

未来实施分四层：共享身份 / 包 / 状态规则单元测试；临时内容根上的 API 集成及文件 hash 断言；真实打包 KTX 的合成语义集成；经后续实施计划明确授权的桌面用户旅程验证。Mock 仅覆盖失败注入，不能独自证明 KTX 兼容、可导回、Agent 可检索或镜像交付成立。本次只做文档检查，以下全部为 **未执行**。

每项证据保存测试编号、候选产品版本、完整构建提交 / dirty 状态、镜像 ID、依赖版本、输入 fixture hash、操作 / 发布 ID、前后目标及未选文件 hash、实际结果、错误及报告。`passed / failed / not_run / blocked_environment` 分开；缺少 KTX 或环境不能登记通过。仅合成 / 脱敏 fixture，不访问客户真实库。

| 编号 | 场景 / 必须断言 | 状态 |
|---|---|---|
| V01 | 同名表分布在两个连接、两个 Schema，overlay 文件名无 Schema：下载 / 校验 / 导入均精确匹配，歧义阻断 | 未执行 |
| V02 | 筛选结果跨多页，选择全部；切换筛选清空选择；未启用表维护后仍未启用 | 未执行 |
| V03 | 30 表下载→修改→导入→工作台确认→生效；未选文件前后 hash 相同；使用获授权的合成 Agent 经 Lucy Proxy 检索 / 读取新增语义，不能直连 KTX 证明 Lucy 生效。Agent 级证据依赖 Wave 0b 交付环境，未解锁时保持条件项，不以本机结果替代 | 未执行 |
| V04 | 单文件承载多表、跨 Schema / 连接关联、缺失依赖：实际影响必须完整；依赖只读，不暗中扩写 | 未执行 |
| V05 | 包中一个 YAML / 引用 / 类型错误，其余 29 正确：整批提交阻断，正式目录、镜像及索引 hash 不变 | 未执行 |
| V06 | 原包不修改及无 overlay 的模板不修改导回：no_change，不发布、不索引；修改后新 hash 可合法预检 | 未执行 |
| V07 | 修改只读 Manifest、包 entry 改绑、其他实例包、过期导出基线、未知目标：逐项阻断，启用范围 / ACL 不变 | 未执行 |
| V08 | 预览后另一会话、单表保存、Manifest 上传、CLI / Git 改目标或依赖，含 absent→存在：409 / stale，重预览，不能沿用覆盖确认 | 未执行 |
| V09 | ZIP 穿越、绝对路径、软 / 硬链接、重复归一化路径、重复身份、未知 entry、解压炸弹、嵌套包：无越界写或部分接受 | 未执行 |
| V10 | 200 YAML、512 KiB 单文件、16 MiB 内容、metadata / ZIP / HTTP 边界及各 +1；导出成功的维护包满足导入限制，无截断 | 未执行 |
| V11 | 独立批量校验含 passed、failed、not_run、stale；实库执行 `not_applicable` 不进入提交 verdict，只有必需检查因取消／超时未调度才记 `not_run`；并行／超时／取消后计数守恒，正式文件和索引不变 | 未执行 |
| V12 | 30 表导入时已有其他待同步磁盘变更：完整计划可见且统一校验；变更计划后旧确认失效，不能声称局部生效 | 未执行 |
| V13 | 重复点击、HTTP 重试、客户端断开重连：同幂等键同 releaseId、只写一次只索引一次；不同计划复用键冲突 | 未执行 |
| V14 | 第 N 次 rename、镜像同步、审计持久化失败：可核对已写 / 已恢复集合；恢复失败阻断后续发布及受影响读取 | 未执行 |
| V15 | 在 journal / rename / index / 终结记录各边界 kill 并重启：不猜 published，不误删恢复材料，不覆盖外部新内容 | 未执行 |
| V16 | reindex 失败后文件仍保存、界面不报已生效；重试不重复 promote，范围变更要求重新确认，保留失败 attempt | 未执行 |
| V17 | 未登录、失效会话、Agent Token、其他操作者的 ID，以及轮询 / 下载 / 提交期间撤权：拒绝且不泄露内容 | 未执行 |
| V18 | 合法性通过但描述不全、实库未查询：合法性 verdict、完整度事实、执行证据三类结论分开；实库未要求时记独立 `not_applicable` 而非提交 `not_run`，不阻断正常发布；JSON / CSV 与逐表报告相符，CSV 转义，无原始凭据 | 未执行 |
| V19 | 内容根为默认、定制路径、旧布局：均只读写解析出的事实源及受控镜像，无硬编码仓库路径 | 未执行 |
| V20 | 发布工作台保留校验 / 整批同步，无上传导出按钮；Catalog 多选、导入预览、错误定位、返回后任务结果可达 | 未执行 |
| V21 | 真实打包 KTX 合并 / 校验合成 Manifest + overlay；CLI / 单表 / 批量结论一致；不支持方言明确失败 / 未验证 | 未执行 |
| V22 | 候选客户 amd64 镜像按现有单副本 Helm 交付合同跑合成往返和中断恢复；区分本机 Compose 与客户验收 | 未执行 |

### 10.2 完成判定

范围身份、安全输入、冲突保护、校验前零正式写入、失败恢复和不虚报生效均为本功能未来验收必达项；V01–V22 必须取得各自适用证据，不适用项只能按预先定义的证据维度记 `not_applicable`，不得把必需检查跳过记通过。V03 的 Agent 级证据与 V22 的客户 amd64 证据依赖 Wave 0b；未实测解锁前整批保持 `blocked_delivery`，不得以本机或模拟结果替代。功能可交付必须有 30 表完整旅程、包往返与失败恢复的实证。没有执行的用例继续记未执行，不把 Spec 评审通过写成实现通过。本文件不新增当前 v2.0 发布门禁，后续实施和客户发布分别沿用当时已批准的门禁。

## 11. 实施准备、风险与已裁决设计参数

后续经授权再制定实施 Plan：先固定身份与共享检查 / 包合同，再补齐协调器、CAS、恢复和审计，随后接入 Catalog 与工作台，最后执行 §10 验证。不是只恢复旧按钮：旧自动 promote + reindex 路径须接入同一服务和完整计划合同，不能因入口不同绕过确认或漏校验。

主要风险为同名误归属、维护包无法导回、Manifest / overlay 混写、全局索引带入其他变更、逐文件失败留下部分状态，以及工作区与镜像版本混淆。上述风险分别由身份快照、包自检、只读依赖、完整计划、恢复日志和 §1 双基线处理。

D1–D4 已于 2026-10-24 按 P0 Final 决议收口，不再留待实现者选择：

| 编号 | 已裁决值 | 设计落点 |
|---|---|---|
| D1 容量与并行 | 最多 200 个 YAML entry、4 个并行检查、单表 30 秒、任务 10 分钟；其他 ZIP／HTTP 限制见 §5 | §5、§6、§9、V10–V11 |
| D2 有效期 | 预览与校验快照 30 分钟；维护包基线 7 天 | §4–§5、V07 |
| D3 恢复失败 | 阻断后续发布和手动索引，并使受影响资产的 Lucy 读取／查询失败关闭，直到恢复核验完成 | §7.1–§7.2、V14–V16 |
| D4 共享协调器 | 覆盖单表保存、Manifest 上传、批量导入、手动 reindex 和 L25-14 角色／行策略保存；写入与生效串行，只读预览和校验可并行 | §7.1–§7.2、V08、V13–V15 |

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

Schema、Manifest、semantic overlay、连接、启用表范围沿用现有定义。完整表身份、英文格式名、路径和 URL 的 DOM 节点必须带 `translate="no"` 与 `notranslate`。

## Design System Compliance

遵循 [按钮规范](../../webui/docs/design-system/10-components-button.md) §2–4：并列维护动作 secondary，确认动作单一 primary，禁用原因可读；[数据网格规范](../../webui/docs/design-system/11-components-data-grid.md)：复用既有表格、完整对象标识、键盘与焦点；[页面布局模式](../../webui/docs/design-system/20-patterns-page-layout.md) §3：现有范围树 + 主列表 + 任务抽屉，不增第二套导航。遵守 [Spec 123](../../webui/docs/123-publish-workbench-activation-ia-spec.md) 的工作台入口边界，以及 [Spec 183](../../webui/docs/183-import-scope-preview-spec.md) 对发现 / Manifest / 启用 / 角色能力的分离。后续仅在明确授权的桌面验证阶段执行交互验证，本次无 UI 改动。
