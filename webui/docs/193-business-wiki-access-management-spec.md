# 193 · 业务 Wiki 上传授权、独立权限管理与批量授权

| 元数据 | 内容 |
|---|---|
| 版本 | v0.3 |
| 日期 | 2026-10-27 |
| 状态 | **已实施**（Plan M66）。SC-01–SC-24 证据齐备，静态门禁通过；未执行浏览器与移动窄屏测试。 |
| 范围 | 业务 Wiki 上传授权、授权状态展示、独立权限管理、批量授权；不含目录权限继承 |
| 关联 Plan | [`plans/wo-M66-business-wiki-access-management.md`](plans/wo-M66-business-wiki-access-management.md) |
| 本轮修订 | v0.3：产品代码落地后的实施注记、SC 证据映射、已知边界与遗留项。契约本体未改。 |
| 触发来源 | 2026-10-27 客户真实系统反馈：业务 Wiki 上传后默认无人可见，需再次进入编辑态授权 |
| 权限基线 | [`../../docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md`](../../docs/specs/lucy-20261018-enterprise-security-and-real-e2e-spec.md) §4.1–4.3 |

## 1. 背景与问题

客户真实系统中，管理员上传业务 Wiki 后，文档通常处于「无人可见」。管理员必须再次进入 Markdown 编辑态，选择「可访问角色」并保存，Agent 才能发现或读取文档。

默认无人可见是 Lucy 的安全基线，应继续保留。问题在于当前管理面把「上传文档」和「确定读者范围」拆成了两个不连续动作，并且在阅读页与文档列表中不展示授权状态。系统虽然安全拒绝了访问，却没有帮助管理员在主流程中完成配置，也不能解释“已经勾选角色，为什么 Agent 仍然看不到”。

当前实现还有以下缺口：

1. 上传预检只有无人可见警告，没有授权控件，警告也不阻止提交。
2. 覆盖上传可由文件内 `allowed_roles` 改变现有读者范围，但 UI 没有显式展示这项变化。
3. Wiki 阅读页没有「可访问角色」摘要；权限只能与正文一起进入编辑态修改。
4. 存量无人可见文档只能逐篇处理，缺少受控的批量授权。
5. Role 详情只有 `Role → Wiki` 的只读效果，Wiki 页面缺少 `Wiki → Role` 的反向解释。

## 2. 决策摘要

| 编号 | 决策 |
|---|---|
| D1 | 继续使用 Wiki frontmatter `allowed_roles` 作为唯一对象授权事实源；不增加数据库 ACL 或第二套字段。 |
| D2 | 新建上传在上传预检中完成授权；最终为空时允许提交，但必须明确确认「上传后 Agent 无人可见」。 |
| D3 | 覆盖上传默认保留当前授权。文件内声明不同授权时只展示差异，不自动采用；管理员主动选择后才改变。 |
| D4 | 阅读页展示声明授权与通道效果，并提供独立的「管理访问权限」Drawer。权限保存不提交正文草稿。 |
| D5 | 文档列表展示紧凑授权状态，并支持按授权状态筛选及显式选择文档。 |
| D6 | 首轮批量操作支持「添加角色」与「替换可访问角色」；最多 100 篇。每篇仍写入自身 `allowed_roles`。 |
| D7 | 批量范围以预检时显式选择的文档 key + `file_version` 固定；不产生目录默认值，不影响目录未来新增文档。 |
| D8 | 批量操作不是跨文件事务。预检已过期时整批拒绝；执行中逐篇记录成功、冲突、失败和未执行，成功项不回滚。 |
| D9 | Wiki 所有写路径进入同一进程内写入队列，并在队列内基于同一读取重算候选、重新检查版本，防止正文保存、上传、恢复、授权保存及移动/删除互相覆盖；嵌套调用只使用不再入队的 unlocked helper。 |
| D10 | 扩权在 security operation committed 前对该 key 的 Agent 搜索和读取全部拒绝；崩溃后不自动写入、重放或确认扩权。已落盘但未提交安全状态的扩权也进入 `needs_review` 并继续拒绝该对象。 |
| D11 | operator 沿用现有日常 Wiki 编辑权限，可执行单篇及最多 100 篇的批量授权；不把日常批量维护等同于 owner-only 迁移。 |
| D12 | 目录权限继承、Skill 批量授权、定时授权、审批流和移动目录时重算权限均不在本轮范围。 |

## 3. 目标与非目标

### 3.1 目标

1. 管理员可以在一次上传流程中完成文档写入和明确授权。
2. 覆盖正文时默认不改变现有读者范围，任何扩权都有清晰差异与确认。
3. 管理员无需进入 Markdown 编辑态即可查看和修改单篇文档权限。
4. 管理员可以安全处理一批存量无人可见文档，并获得逐篇结果。
5. UI 能区分「对象已授权」和「对应角色已开通搜索/读取通道」。
6. 并发、审计失败、进程崩溃和重试不会静默扩权或覆盖其他管理员的修改。

### 3.2 非目标

- 不改变 `authorizeContext()` 的同 Role 闭合、默认拒绝和 `context_not_available` 外部语义。
- 不从目录名、`visibility`、`sl_refs`、正文、文件名或自然语言推导授权。
- 不建立目录 ACL、父子继承、未来文档默认授权或移动目录后的权限重算。
- 不自动把无人可见文档授权给上传者、上传者所属角色或所有角色。
- 不新增 Role、修改 Role 工具通道或自动修复 Agent 角色绑定。
- 不把 `["*"]` 描述为公开访问；它仍要求有效身份、正式 Role 与对应通道。
- 不在本轮扩展业务 Skill 的创建、展示或批量授权。
- 不要求移动窄屏布局或浏览器自动化验证。

## 4. 权限模型与不变量

### 4.1 唯一事实源

Wiki 文档的对象授权仍是 frontmatter：

```yaml
allowed_roles: [finance, test-fc]
```

状态语义保持不变：

| 声明 | 运行时含义 |
|---|---|
| 字段缺失或 `[]` | Agent 无人可见；受信任管理员仍可维护 |
| `["role-a", "role-b"]` | 指定 Role 可匹配，同时还要由同一 Role 开通动作通道 |
| `["*"]` | 所有有效已分配正式 Role 可匹配；不是匿名公开 |
| 非数组、空元素、`*` 与 Role 混用 | 损坏，拒绝保存，运行时拒绝 |
| 未知 Role ID | 不匹配任何 Agent；保留并提示，不映射同名新 Role |

### 4.2 声明授权与实际效果

UI 必须同时表达两层事实：

1. **声明授权**：文档 `allowed_roles` 写了什么。
2. **通道效果**：每个已声明 Role 是否开通 `wiki_search` 和 `wiki_read`。

对指定 Role 的文案固定为：

| 通道 | UI 状态 |
|---|---|
| search + read | 可搜索、可读取 |
| search only | 可搜索摘要、无法读取正文 |
| read only | 可按已知路径读取、无法搜索发现 |
| neither | 已授权，缺少 Wiki 访问通道 |
| Role 不存在 | 未知角色，不匹配任何 Agent |

「Agent 已可用」只能在同时检查 Agent 的实际 Role 绑定后表达。本轮单篇视图可以展示受影响 Agent 数量与可展开的 Agent ID，但主状态不能仅凭 Role 声明写成“Agent 已可用”。`role_channel_version` 是管理面全局效果版本，必须绑定正式 Role 的 Wiki 通道以及 Agent 的启用状态和实际 Role 绑定，不能复用某个 Agent 的 `snapshotHash` 冒充全局版本。

### 4.3 授权变化方向

为了控制扩权恢复，服务端对规范化后的旧、新 ACL 计算 `direction`；比较不按 YAML 文本或 Role 排列顺序：

```text
runtimeSet(missing | empty | corrupt) = empty set
runtimeSet(roles)                    = declared role ids
runtimeSet(all)                      = universe

if old == new:
    neutral
else if new is a strict subset of old:
    narrow
else:
    widen
```

角色集合一增一减的混合变化按 `widen` 处理。损坏 ACL 修复为任意非空集合也按 `widen` 处理。这样会产生少量保守拒绝，但不会把不确定变化当成收窄。

## 5. 上传授权交互

### 5.1 信息结构

上传预检从上到下保持以下顺序：

1. 目标：目录、目标 Wiki 路径、新建或覆盖状态。
2. 解析摘要：文件名、标题、关联表。
3. **可访问角色**：最终将写入的授权、来源、通道效果和确认项。
4. 警告与阻断问题。
5. Diff。
6. 提交动作。

授权区必须位于 Diff 之前，因为读者范围属于提交决策，不是上传后的附加设置。

### 5.2 新建上传

| 文件状态 | 初始选择 | 提交规则 |
|---|---|---|
| 合法且非空 `allowed_roles` | 使用文件内声明，标记「来自上传文件」 | 可编辑；最终值随同正文提交 |
| 缺失或 `[]` | 无人可见 | 必须勾选「我确认上传后 Agent 暂时无法访问」或改选角色 |
| `["*"]` | 所有角色可见 | 必须完成独立全角色确认 |
| 损坏声明 | 阻断采用文件声明 | 管理员可选择「忽略文件内损坏声明并重新设置」，否则不能提交 |

选择正式 Role 后，授权区即时展示该 Role 的搜索/读取通道状态。通道缺失是 warning，不阻止保存对象 ACL，因为对象授权与 Role 通道是两个独立配置面。

主按钮根据最终状态显示：

- `上传并授权`
- `上传并保持无人可见`
- `上传并设为所有角色可见`

### 5.3 覆盖上传

覆盖文档时，控件初始值永远是当前持久化授权，状态为「保留现有授权」。即使上传文件包含不同的 `allowed_roles`，也不得静默采用。

若文件声明与当前授权不同，展示并列摘要：

```text
当前授权        finance、test-fc
文件内声明      finance、marketingAPI-Role
最终将采用      finance、test-fc（保留现有授权）
```

提供次级动作「采用文件内授权」。点击后仍需显示旧值 → 新值、扩权/收窄方向与通道效果；管理员也可以直接在授权控件中自定义。损坏的文件声明只能通过「重新设置」覆盖，不能直接采用。

提交按钮文案为：

- 仅正文变化：`覆盖并保留授权`
- 授权同时变化：`覆盖并更新授权`
- 最终为空或全角色：使用对应的明确风险文案与确认。

### 5.4 预检与提交绑定

前端不得再把预检返回的 `proposedMarkdown` 当作下一次上传源重新提交。提交请求必须携带原始 Markdown、`mode`、明确的 `access` 授权选择、`expected_version`（目标已存在时）和 `preview_digest`；服务端在共享写入队列内基于同一次当前文件读取重新计算候选内容并验证摘要。缺少 `access` 返回 400 `wiki_upload_access_required`，不提供静默沿用旧客户端行为的兼容分支。

授权选择的 API 语义：

```ts
type WikiUploadAccessSelection =
  | { mode: "preserve_current" }
  | { mode: "use_uploaded" }
  | { mode: "set"; allowed_roles: string[] };
```

约束：

- `preserve_current` 仅允许目标已存在，并逐字保留当前 ACL 声明，包括当前为损坏声明时的拒绝状态。
- `use_uploaded` 要求文件声明合法；损坏声明返回 `CONTEXT_ACL_INVALID`。
- `set` 总是用规范化后的值替换上传文件中的 `allowed_roles`。
- 最终 `[]` 要求 `confirmed_empty=true`；最终 `["*"]` 要求 `confirmed_all=true`。
- `preview_digest` 绑定目标 key、`mode`、原始 Markdown hash、目标版本、规范化选择/最终 ACL 和 `role_channel_version`。commit 缺少或携带过期摘要返回 409 `wiki_upload_preview_stale`，不写文件。
- `mode=create` 在队列内要求目标仍不存在；`mode=replace` 要求目标仍存在且版本匹配。目标存在状态或版本不符返回 409 `wiki_write_conflict`，不得把 create 自动改成覆盖或把 replace 自动改成新建。
- 任何 ACL 变化都复用 §8 的安全写入原语，包括正文编辑保存中同时修改 `allowed_roles` 的既有路径。

## 6. 独立权限管理

### 6.1 阅读页与列表状态

阅读页标题区在标签/关联表附近展示紧凑摘要：

```text
可访问角色：finance、test-fc · 1 个角色缺少读取通道   [管理访问权限]
```

无人可见、所有角色可见、损坏 ACL 必须使用已登记术语。列表项显示下列一个主状态和可选次状态：

- 无人可见
- 2 个角色
- 所有角色可见
- 授权异常
- 次状态：`1 个角色缺少读取通道`

列表提供授权状态筛选：全部、无人可见、指定角色、所有角色可见、授权异常、缺少读取通道。筛选只影响视图，不改变选择范围或授权。

`GET /api/wiki` 必须在一次聚合响应中为每篇文档返回 `file_version`、规范化 `acl`、缺通道计数和 pending 状态，并在该请求内只读取一次 Role/Agent 配置；前端不得为每行再调用 access API。完整 Role 效果和 Agent ID 仅由单篇 `GET /api/wiki/:key/access` 按需返回，列表不嵌入正文或完整 Agent 清单。

### 6.2 「管理访问权限」Drawer

Drawer 展示：

1. 文档标题和完整 Wiki 路径。
2. 当前 `file_version`。
3. `ObjectAclField` 选择器。
4. 每个 Role 的搜索/读取通道与受影响 Agent 数量。
5. 旧授权 → 新授权、变化方向和警告。
6. `保存访问权限` 主按钮。

权限保存只修改 `allowed_roles`，正文逐字保留，所有未知 frontmatter 字段及其值语义保留，不得经过完整正文草稿往返。规范化后 ACL 无变化时返回 `noop`，不写文件、不新增版本。实际写入的版本操作新增 `access_update`，前后端版本类型和历史标签必须同步。保存成功后刷新阅读页、列表、版本历史及上下文权限缓存。

正文编辑器存在未保存草稿时，不允许从该编辑态直接执行独立权限保存。入口应解释「请先保存或放弃正文草稿」，避免权限保存改变 `file_version` 后让同一页面的正文草稿立即冲突。阅读态始终可进入 Drawer。

单篇权限预检与提交接口：

```text
GET  /api/wiki/:key/access
POST /api/wiki/:key/access/preview
PUT  /api/wiki/:key/access
```

`preview` 输入 `allowed_roles + expected_version`，返回旧/新 ACL、方向、Role 通道效果、受影响 Agent、`role_channel_version` 与 `preview_digest`。摘要绑定 key、当前版本、规范化候选 ACL 和全局 Role/通道/Agent 绑定版本。`PUT` 必须携带相同 `expected_version`、`allowed_roles` 和 `preview_digest`，在队列内重算并核对，不能只信任客户端回传的 direction。

冲突响应：

| 条件 | 状态码 / code | UI |
|---|---|---|
| 缺少文档版本 | 428 `wiki_expected_version_required` | 刷新持久状态后重新预检 |
| 文档版本变化 | 409 `wiki_write_conflict` | 保留用户选择，刷新当前授权并要求重新预检 |
| Role/通道图变化 | 409 `wiki_access_preview_stale` | 刷新效果摘要，要求再次确认 |
| 非法 ACL | 400 `CONTEXT_ACL_INVALID` | 定位到授权控件 |
| 配置审计不可用 | 503 `config_audit_unavailable` | 不写入或已安全回滚，不显示成功 |
| 安全状态存储不可用 | 503 `SECURITY_STORE_UNAVAILABLE` | 不写入；运行时对该对象保持拒绝 |
| 扩权处于待核对 | 409 `wiki_access_change_pending` | 显示运维核对提示，整个文档继续拒绝 Agent 搜索和读取 |

## 7. 批量授权

### 7.1 选择模式

Wiki 文档列表提供次级动作「批量管理权限」。进入选择模式后：

- 每篇文档出现复选框，完整路径保持可见并加翻译防御。
- 支持选择当前筛选结果；一次最多选择 100 篇。筛选结果或加入后的选择超过 100 篇时，动作拒绝并提示缩小范围，不得静默截断为前 100 篇。
- 选择的是具体文档 key，不是目录规则。
- 切换目录会清空选择并提示，防止隐藏选中项。
- 空目录、加载中、列表错误、达到上限和部分文档消失均有明确状态。
- 未选择文档时，「继续」禁用并通过 `aria-describedby` 解释原因。

### 7.2 两种操作

| 操作 | 计算 | 用途 | 限制 |
|---|---|---|---|
| 添加角色 | `normalize(current ∪ selected)` | 给不同授权的存量文档补充同一组 Role | 至少一个 Role；不允许 `*`；损坏 ACL 必须先修复或改用替换 |
| 替换可访问角色 | 每篇都写入同一规范化 ACL | 统一一批文档的读者范围、修复损坏 ACL | 可选 `[]` 或 `["*"]`，分别要求独立确认 |

首轮不提供「移除角色」独立动作。需要收窄时使用「替换可访问角色」，使最终状态完整可见。

### 7.3 批量预检

批量预检返回：

- 固定的文档 key、标题、`file_version`。
- 每篇旧 ACL、新 ACL、`direction`、是否 no-op。
- 汇总：将扩权、将收窄、不变、损坏、缺通道、受影响 Agent 数。
- 逐篇问题及是否阻断。
- `role_channel_version`、`plan_digest` 和 `operation_id`。

管理员必须能展开逐篇差异。预检页不能只显示“将更新 37 篇”。全角色与无人可见确认应在汇总区完成一次，同时逐篇结果仍可检查。

接口：

```text
POST /api/wiki/access/batch/preview
POST /api/wiki/access/batch/commit
GET  /api/wiki/access/batches/:operationId
```

批量 preview 输入 `{ key, expected_version }` 和以下动作。服务端先规范化 key 并去重，再强制要求 1–100 个唯一 key；完全相同的重复项合并，同一 key 携带不同版本返回 409 `wiki_batch_preview_stale`。超过 100 篇返回 400 `wiki_batch_limit_exceeded`，空选择返回 400 `wiki_batch_empty`，均不创建 operation。

```ts
type WikiBatchAccessAction =
  | { mode: "add"; role_ids: string[] }
  | { mode: "replace"; allowed_roles: string[] };
```

`plan_digest` 绑定 `operation_id`、规范化动作、按 key 排序的版本基线、每篇规范化目标 ACL/direction/no-op 和 `role_channel_version`。commit 必须同时携带 `operation_id + plan_digest + idempotency_key` 及最终 empty/all 确认。preview 中存在阻断性校验问题（例如 add 遇到 corrupt ACL）时不得生成可提交计划。

### 7.4 提交、冲突与重试

提交进入 Wiki 共享写入队列后，按以下规则执行：

1. 先查询幂等记录；同 key + 同 digest 直接返回既有 operation 状态，不再要求当前文件仍停留在旧版本，也绝不重复写入。
2. 新 operation 在任何写入前重新读取全部目标版本和 `role_channel_version`。任一基线已过期或 `plan_digest` 不匹配，整批返回 409 `wiki_batch_preview_stale`；此时零写入、零 journal。
3. 原子创建 durable journal 与幂等记录，再逐篇复用 §8 的同一安全写入原语，执行原子文件替换、配置审计、版本快照及结果落盘。
4. 每篇开始前再次读取版本并核对预检目标 ACL；若发现队列外变更，标记该篇 `conflict`，继续处理其他文档。
5. 遇到审计库、journal 或安全状态存储等系统性失败，停止后续文档，尽力把剩余项标记 `not_run`；不得为了写汇总而继续修改 Wiki 文件。
6. 成功项保留，不因其他文档失败而回滚；结果页明确说明这不是整体事务。
7. 重试创建新 preview/operation，只包含 `conflict`、`failed`、`not_run`，并重新读取版本及预检。`applied`、`noop`、`pending`、`needs_review` 不进入重试；`needs_review` 必须先完成运维核对。

批量结果状态：

```ts
type WikiBatchItemStatus =
  | "pending"
  | "applied"
  | "noop"
  | "conflict"
  | "failed"
  | "not_run"
  | "needs_review";
```

结果页显示总数及可筛选逐篇列表，并提供「仅重试未完成项」。页面刷新或网络断开后可通过 `operation_id` 恢复查看。

### 7.5 幂等、日志与恢复

- commit 必须携带 `idempotency_key`。同 key + 同 `plan_digest` 返回既有执行状态，不重复写入；同 key + 不同 digest 返回 409 `wiki_batch_idempotency_conflict`。
- journal 与幂等记录复用 `.ktx-ui/security.sqlite` 的 FULL 持久化和 0600 权限，不另建含 ACL 明细的 JSON sidecar。journal 仅记录 key、版本、ACL 摘要、状态、actor、时间与稳定错误码；不得写正文、凭据或绝对主机路径。
- 每篇文件仍写独立配置审计，审计记录以现有 `requestId` 关联共享 `operation_id`；批量汇总不能替代逐文件审计。
- 进程重启后只核对 journal、每篇 security operation、当前 hash 与审计终态：已证明 applied/no-op 的保留结果，未开始且仍为旧 hash 的标记 `not_run`，无法证明或存在未提交扩权的标记 `needs_review`。不得自动继续循环、重放写入或把 pending 当成功；恢复结果持久化失败时保留可查询的未完成状态并继续拒绝相关扩权。

## 8. 写入、审计与崩溃恢复

### 8.1 统一写入队列

新增进程内 Wiki 写入队列。以下路径必须经由同一队列：正文创建/保存（包括同时修改 ACL）、上传创建/覆盖、单篇权限保存、批量权限保存、版本恢复、文档移动/删除，以及目录重命名中涉及文档与共享版本索引的全部步骤。

版本检查必须在队列回调内部执行，候选 Markdown 也必须从队列内同一次读取的当前字节生成，不能复用入队前预览。已存在文档的正文保存、上传、权限保存、恢复、移动和删除均要求 `expected_version`，缺失返回 428、过期返回 409；创建在队列内重验目标不存在。目录重命名 preview 返回逐文档版本与摘要，commit 在队列内重验全部版本、源/目标状态和摘要后才执行。空目录删除不涉及文档版本，但也必须在队列内重验目录仍为空。

公开写入口只负责获取队列；组合操作调用明确命名的 `...Unlocked` helper，helper 约定调用者已经持队列，不得再次进入队列。单篇与批量必须复用同一个 unlocked ACL mutation 原语，避免递归死锁或形成两套安全顺序。

存在 pending/needs_review 扩权的 key 禁止正文保存、上传、权限保存、恢复、移动、删除和目录重命名，返回 409 `wiki_access_change_pending`；只有该 operation 自身的回滚/恢复 helper 可以写回旧字节。这样可防止 hash 核对被第三方写操作破坏，或 hold 留在旧 key 而扩权内容移动到新 key。

该保证只覆盖 Lucy 已支持的单实例、单副本部署；不引入分布式锁。直接编辑 Wiki 文件、多个 WebUI 进程或其他进程共享写入同一内容目录仍属于不支持的多写者拓扑。批量执行会在每篇开始前尽力发现这类队列外变化，但不宣称具备跨进程 CAS 或分布式事务保证。

### 8.2 扩权 hold

任何 `direction=widen` 的变更必须先写 durable security operation，再写文档。hold 由 security store 中 `pending | needs_review` 的 per-key 投影派生；对 widening，prepare operation 与激活 hold 必须在同一安全库事务完成。hold 存在或投影无法读取时，该 Wiki key 的 Agent 搜索和读取全部拒绝，不能只拒绝扩出的 Role，也不能退回旧缓存放行。

正常路径：

```text
prepare durable operation and widening hold in one security-store transaction
  -> durable config-audit intent
  -> atomic Markdown write
  -> config-audit committed
  -> Wiki version snapshot / batch journal update
  -> security operation committed and hold released in the same transaction
  -> success response
```

若 terminal audit 写入失败，使用 `rollbackOnTerminalFailure` 恢复原文件并尽力记 `rolled_back`；恢复失败则保持 hold 并返回失败。进程内异常和进程重启都按相同证据核对：

- 文件仍是旧 hash：abort operation，hold 随终态解除。
- 文件已是目标 hash且 operation 为 narrow/neutral：可按既有恢复规则 commit；不产生扩权。
- 文件已是目标 hash但 operation 为 widen：无论配置审计是否 committed，只要 security operation 尚未 committed，就标记 `needs_review` 并继续 hold，不自动补记扩权成功。
- 无法读取、hash 不匹配或证据不足：widen 标记 `needs_review` 并继续 hold；其他方向不得宣称成功。

启动时必须在 Agent Wiki 通道接受请求前完成 hold 投影恢复。系统不得自动重放扩权写入，也不得仅凭目标 hash 或配置审计 committed 自动批准扩权。人工核对后的处置不属于自动重试，并必须留下新的可信操作者审计。

### 8.3 收窄

收窄在原子 Markdown 替换成功后，对下一次 Agent 请求立即生效。写入结果不得被旧页面正文保存覆盖；统一队列和 `expected_version` 负责拒绝旧写入。

## 9. 核心流程（伪代码）

### 9.1 解析上传授权

```text
resolveUploadAcl(exists, currentAcl, uploadedAcl, selection):
    if selection.mode == preserve_current:
        require exists
        return currentAcl declaration

    if selection.mode == use_uploaded:
        require uploadedAcl is missing/empty/all/roles
        reject corrupt
        return canonical uploaded declaration

    if selection.mode == set:
        return assertWritableAcl(selection.allowed_roles)

    reject invalid selection
```

### 9.2 单篇权限保存

```text
saveWikiAccess(key, expectedVersion, previewDigest, requestedAcl, actor):
    return withWikiWriteQueue(() =>
        mutateWikiAccessUnlocked(key, expectedVersion, previewDigest, requestedAcl, actor)
    )

mutateWikiAccessUnlocked(...):  // caller must already hold the Wiki queue
    require no pending/needs_review widening for key
    current = read exact Markdown bytes once
    require hash(current) == expectedVersion
    target = replace only allowed_roles; preserve body and unknown frontmatter
    if canonical(currentAcl) == canonical(requestedAcl):
        return noop without file write, audit or version

    effect = resolve fresh global role/channel/Agent effect(currentAcl, requestedAcl)
    require digest(key + expectedVersion + requestedAcl + roleChannelVersion) == previewDigest
    direction = classify(currentAcl, requestedAcl)
    operation = prepareSecurityOperation(
        key, direction, oldHash, hash(target), actor,
        activateWideningHoldInSameTransaction=true
    )

    try:
        auditedAtomicWrite(target, requireIntent=true, rollbackOnTerminalFailure=true)
        write Wiki version snapshot(operation=access_update)
        commitSecurityOperationAndReleaseHoldAtomically(operation)
        return committed result
    catch error:
        evidence = reconcile current hash, oldHash, targetHash and operation state
        if evidence proves old bytes: abort operation
        else if direction == widen and operation is not committed:
            mark needs_review and keep hold
        else: apply the existing narrow/neutral recovery rule; never replay the write
        throw stable error
```

正文编辑保存和 ACL-changing 上传也调用 `mutateWikiAccessUnlocked` 的同一审计/安全协调段；它们可以先构造同时包含正文和 ACL 的 target，但不得另写一条绕过 hold 的 `auditedWriteFile` 路径。

### 9.3 批量权限保存

```text
commitBatch(plan, idempotencyKey, actor):
    return withWikiWriteQueue(async):
        existing = findByIdempotencyKey(idempotencyKey)
        if existing.digest == plan.digest: return existing status
        if existing exists: reject idempotency conflict

        currentVersions = read all selected keys
        currentRoleVersion = read global role/channel/Agent version
        if any baseline differs or digest differs:
            reject whole batch before journal creation and before writes

        journal = createDurableJournalAndIdempotencyRecordAtomically(plan, actor)
        for item in deterministic key order:
            if systemicFailure: best-effort mark remaining not_run; break
            current = read item again
            if current.version != item.expectedVersion:
                mark conflict; continue
            targetAcl = apply add/replace rule
            require canonical(targetAcl) == canonical(item.previewTargetAcl)
            if targetAcl == currentAcl:
                mark noop; continue
            try:
                mutateWikiAccessUnlocked(item, targetAcl, batchOperationId, actor)
                mark applied
            catch item conflict:
                mark conflict; continue
            catch validation error:
                mark failed; continue
            catch audit/journal/security-store error:
                mark failed or needs_review from durable evidence; stop remaining

        persist terminal batch summary if storage is available
        return per-item result
```

批量循环不得调用再次获取队列的公开 `saveWikiAccess`。单篇 helper 的 journal/snapshot 回调必须接受批量上下文，使每篇结果与共享 `operation_id` 落盘，但不改变安全写入顺序。

### 9.4 运行时 hold

```text
authorizeWiki(identity, page, action, snapshot):
    hold = readWideningHold(page.key)
    if hold is unavailable or hold.state in {pending, needs_review}:
        deny context_not_available
    return authorizeContext(identity, page.asset, action, snapshot)
```

## 10. API 数据契约

### 10.1 授权摘要

```ts
type WikiAccessSummary = {
  key: string;
  file_version: string;
  acl: ObjectAcl;
  declared_role_count: number | null;
  role_effects: Array<{
    role_id: string;
    known: boolean;
    discover_enabled: boolean;
    read_enabled: boolean;
    assigned_agent_count: number;
    assigned_agent_ids: string[];
  }>;
  declared_without_discover: number;
  declared_without_read: number;
  role_channel_version: string;
  pending_change?: { operation_id: string; state: "pending" | "needs_review" };
};
```

`declared_role_count` 仅对 `roles` 取声明数量，对 `all/corrupt` 为 `null`，对 `missing/empty` 为 0。`assigned_agent_*` 只统计实际绑定该正式 Role 的启用 Agent，不把声明绑定数写成可访问数；`all` 的效果按正式 Role 展开，未知 Role 保留为 `known=false`。`assigned_agent_ids`、Wiki key、Role ID 等 DOM 必须使用 `notranslate` 和 `translate="no"`。API 不返回 Token、正文或管理员 Session 信息。

### 10.2 错误码

| code | 含义 |
|---|---|
| `wiki_upload_access_required` | 上传 commit 缺少明确 access selection；零写入 |
| `wiki_upload_preview_stale` | 上传候选、目标版本或授权效果已变化 |
| `wiki_expected_version_required` | 已存在文档的写操作缺少 `expected_version` |
| `wiki_access_preview_stale` | 单篇授权预检已过期 |
| `wiki_batch_preview_stale` | 批量提交前至少一项或角色图已过期；零写入 |
| `wiki_batch_empty` | 服务端去重后没有文档 key |
| `wiki_batch_limit_exceeded` | 去重后超过 100 篇 |
| `wiki_batch_idempotency_conflict` | 幂等 key 已绑定另一 plan |
| `wiki_access_change_pending` | 对象存在未决扩权操作，当前写路径禁止继续 |
| `CONTEXT_ACL_INVALID` | ACL 声明损坏或请求值非法；保留既有契约 |
| `wiki_write_conflict` | 文档版本或目标存在状态冲突；沿用现有 Wiki 并发契约 |
| `config_audit_unavailable` | 配置审计 intent/terminal 不可用；不得返回成功 |
| `SECURITY_STORE_UNAVAILABLE` | 安全操作或 hold 投影不可用；保持拒绝 |

## 11. 状态与可访问性

所有三个界面必须覆盖：

- loading：骨架或明确加载文案；提交按钮 `aria-busy=true`。Role/通道效果仍在加载时不得按“无正式 Role”处理。
- empty：仅在对应请求成功后展示无正式 Role、当前目录无文档、筛选结果为空或批量无选择。
- error：API 错误在对应区域展示，Toast 只做瞬时补充；Role/效果读取失败时禁止提交，不得把失败降级成空 ACL 或“通道正常”。过期 preview 响应必须按请求序号丢弃，提交只接受当前选择对应的最新摘要。
- conflict：保留管理员选择，刷新持久状态，要求重新预检；冲突响应不得清除用户已选 Role。
- partial result：批量结果常驻页面/Drawer，可按状态筛选和复制未完成 key；`needs_review` 明确不可重试，部分成功不得只显示 Toast。
- keyboard：复选框、筛选、Drawer 焦点圈、关闭后焦点归还均可键盘操作；批量超限与空选择的禁用原因可聚焦或通过 `aria-describedby` 读取。
- focus：使用现有语义 focus token，不以颜色作为唯一状态。

一个 action group 最多一个 primary。批量选择工具栏、上传预检和权限 Drawer 的主提交按钮均位于组末；风险确认使用 Dialog/Drawer 内确认，不用 Toast 替代。

## 12. 验收标准

| ID | 验收 |
|---|---|
| SC-01 | 新文件无 ACL 时，上传预检默认无人可见；未确认前不能提交。 |
| SC-02 | 新文件带合法 ACL 时，预检展示来源、角色与通道效果，提交一次完成正文与授权写入。 |
| SC-03 | 覆盖文件带不同 ACL 时默认保留当前授权；只有显式采用/自定义才改变。 |
| SC-04 | 损坏的文件 ACL 不能直接采用；显式重新设置后可以安全上传。 |
| SC-05 | 上传 commit 必须含原始 Markdown + access selection + digest；缺 selection 返回 400，过期 digest、目标版本或 create/replace 存在状态变化均零写入。 |
| SC-06 | Wiki 阅读页和列表展示无人可见、指定角色、所有角色可见和授权异常；列表由一次聚合响应提供状态，无逐行 access 请求。 |
| SC-07 | Wiki 侧显示每个 Role 的 search/read 效果，并把缺通道与未授权区分；Agent 计数来自实际启用绑定。 |
| SC-08 | 阅读态可独立修改权限；正文逐字保留，未知 frontmatter 字段不丢失；ACL no-op 不写文件或版本。 |
| SC-09 | 编辑态有未保存草稿时，独立权限入口不会制造同页面版本冲突。 |
| SC-10 | 单篇 ACL 保存缺版本返回 428，过期版本/预检返回 409，均无写入。 |
| SC-11 | 批量选择是具体 key，切换目录清空选择；服务端去重后强制执行 1–100，UI 超限不静默截断。 |
| SC-12 | 添加角色取并集、不接受 `*`；替换写入精确 ACL，并支持显式无人可见/所有角色可见。 |
| SC-13 | 批量预检展示逐篇 old/new/direction/no-op 及汇总，不以单个总数代替差异。 |
| SC-14 | 批量基线在执行前过期时整批 409，零写入、零 journal。 |
| SC-15 | 执行中单篇冲突产生部分结果；成功项保留，可只重试 conflict/failed/not_run，needs_review 不可重试。 |
| SC-16 | 同幂等 key + 同 digest 不重复写；同 key + 不同 digest 返回 409。 |
| SC-17 | 每篇成功写入有可信 actor、共享 operation ID、ACL 摘要和 committed 审计。 |
| SC-18 | 正文、上传、权限、恢复、移动、删除和目录重命名均在共享队列内重验版本/目标状态；并发不静默覆盖，组合操作不递归入队。 |
| SC-19 | 扩权在 security operation committed 前对搜索和读取均拒绝；目标字节已落盘但安全状态未提交时恢复为 needs_review，不自动确认或重放。 |
| SC-20 | 收窄原子写入后，下一次 Agent 请求立即按新 ACL 拒绝。 |
| SC-21 | 批量结果断网/刷新/重启后可按 operation ID 查询；恢复不自动续跑，journal 不含正文、凭据、绝对路径。 |
| SC-22 | 版本恢复保留当前 ACL，不复活历史更宽授权；恢复和结构性操作使用 expected_version，pending 扩权期间均被阻断。 |
| SC-23 | 单篇与批量操作保留 operator 日常维护能力；未登录或非管理员请求拒绝。 |
| SC-24 | 专业术语、Role ID、Agent ID、Wiki 路径和文件名具备浏览器翻译防御。 |

## 13. 测试策略

本轮实现验证以服务端 Vitest、React Testing Library 和静态门禁为主，不要求浏览器测试或移动窄屏验证。

重点测试：

- 上传 create/replace × missing/empty/roles/all/corrupt 的决策矩阵。
- 单篇 ACL 的方向分类、digest、通道效果与版本冲突。
- 正文保存、权限保存、上传、恢复、移动、删除和目录重命名进入同一队列后的并发回归，以及 unlocked helper 不递归入队。
- 批量 add/replace、100 篇边界、整批 stale、执行中单篇 conflict、系统性失败停止、幂等重放和重启只核对不续跑。
- durable intent、terminal audit 失败回滚、目标字节已落盘但安全未提交时 widening 持续 hold、进程恢复和人工核对前不可重试。
- UI loading/empty/error/conflict/partial result、键盘与翻译防御。
- 既有 `context-acl-matrix`、`wiki-acl-concurrency` 和版本恢复回归。

## 14. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 上传弹窗信息过重 | 固定信息顺序；角色效果按异常优先、正常折叠；Diff 保持末段。 |
| 管理员把“已授权”理解为 Agent 已可用 | 分开展示声明授权、通道状态和 Agent 绑定，不使用笼统成功文案。 |
| 批量范围被理解为目录继承 | 结果页显示固定文档数和 key；明确“只影响本次选择，不影响以后新增文档”。 |
| 批量部分成功引起误解 | 提交前说明非整体事务；结果页常驻逐篇状态并支持只重试未完成项。 |
| 扩权崩溃窗口泄露内容 | durable security operation + per-key widening hold + 不自动重放。 |
| 独立权限保存覆盖正文 | 只补丁 `allowed_roles`，统一队列内重读和重验 `file_version`。 |
| Role 通道在预检后变化 | digest 绑定 `role_channel_version`；过期重新预检。 |

## 15. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

沿用术语：

- 可访问角色
- 所有角色可见
- 无人可见
- 业务 Wiki
- Agent / Role / Markdown / Wiki（DOM 翻译防御按标准执行）

本 Spec 登记、待实现前同步至术语标准的新增 UI 术语：

| 主术语 | 英文 | 禁止文案 | 含义 |
|---|---|---|---|
| 管理访问权限 | Manage Access | 权限编辑、开放文档 | 独立修改单篇 Wiki `allowed_roles` |
| 批量管理权限 | Manage Access in Bulk | 目录授权、继承授权 | 对本次显式选中的多篇文档逐篇修改 ACL |
| 添加角色 | Add Roles | 合并权限 | 对每篇当前 ACL 加入指定 Role；不接受 `*` |
| 替换可访问角色 | Replace Accessible Roles | 覆盖目录权限 | 把每篇文档 ACL 设为同一精确值 |
| 缺少 Wiki 访问通道 | Wiki Channel Missing | Agent 无权限 | 对象已声明 Role，但该 Role 缺 search/read 通道 |

## 16. Design System Compliance

- `design-system/01-foundations-color.md`：授权异常、warning、danger 使用语义色，不写裸色值。
- `design-system/10-components-button.md`：每个 action group 最多一个 primary；批量入口和权限维护为 secondary；loading/disabled 可解释。
- `design-system/11-components-data-grid.md`：批量结果若使用表格，复用 `pl-data-grid`；路径与标识完整可读。
- `design-system/13-components-toast.md`：Toast 只做成功/失败瞬时反馈，冲突与逐篇结果留在 Drawer/页内。
- `design-system/20-patterns-page-layout.md`：Wiki 主工作区保持唯一；批量选择工具条和 Drawer 承载次任务。

本轮不引入新的全局视觉模式。若实施中需要新的 Drawer、批量选择或状态徽标基础契约，应先在 `design-system/99-governance.md` 登记临时决策。

## 17. 关联与取代关系

- 本 Spec 扩展企业安全整改 Spec §4.3 的管理交互：授权仍只在 Wiki 对象自身的维护界面修改；“对象维护界面”包括上传预检、阅读页权限 Drawer 与显式多选批量 Drawer。
- 本 Spec 不改变 `docs/access-control/adr-20261018-security-ledger-and-context-acl.md` D3。
- Spec 170 的上下文全开放已被撤回，不得作为本功能的默认值依据。
- 版本恢复继续服从 Spec 55 和企业安全整改：恢复正文，不复活历史 ACL。

## 18. 实施同步清单

1. 实现前同步 `webui/docs/00-product-terminology-standard.md` 的 §15 术语，并在前后端类型、版本历史标签和测试中使用同一组文案。
2. API 实现完成后更新 `webui/docs/03-api-spec.md`：新增 access/batch 路由、上传选择与摘要、既有写路径的 `expected_version`、`access_update` 版本操作及稳定错误码；不得提前把目标契约写成已实现。
3. 实现交付时同步 `docs/access-control/README.md`、`docs/governance/project-overview.md` 和 `docs/webui/webui-impl-status.md` 的状态索引，据实区分设计、实现与验证状态。
4. 测试至少覆盖既有 `wiki-acl-concurrency`、`context-acl-matrix`、`security-store`、`context-policy-invalidation`、`context-channel-parity`、Wiki 服务/路由及 React Wiki 测试，并按 Plan 的 SC-01–SC-24 映射验收；不得以仅验证 helper 自身实现的镜像测试替代文件、审计、Agent 裁决和 UI 行为断言。
5. per-key hold 与批量 journal 复用 `SecurityStore`；共享队列使用 unlocked helper 边界。实施不得重新引入独立 JSON ACL/journal 事实源、自动扩权恢复或跨进程保证。

## 19. 实施注记（Plan M66）

> 本节记录产品代码落地后的**实际**事实。契约本体仍以上文为准；本节只回答「做成了什么」「证据在哪里」「还剩什么边界」。

### 19.1 实现锚点

| 能力 | 服务端 | 前端 |
|---|---|---|
| 共享 Wiki 写队列 | `server/wiki-write-queue.ts` | — |
| 统一 ACL 变更协调器 | `server/wiki-access-operation.ts` | — |
| 扩权 hold 投影与失效通知 | `server/wiki-access-holds.ts` · `server/security/state-changes.ts` | — |
| 通道 / Agent 效果投影 | `server/wiki-access-effects.ts` | `src/lib/wikiAccess.ts` · `src/components/WikiAccessEffectList.tsx` |
| 单篇授权 API | `server/wiki-access.ts` | `src/components/WikiAccessDrawer.tsx` · `WikiAccessEditor.tsx` |
| 批量授权 API + journal | `server/wiki-access-batch.ts` · `server/wiki-access-batch-journal.ts` | `src/components/WikiBatchAccessDrawer.tsx` · `WikiBatchAccessResult.tsx` |
| 上传授权选择 | `server/wiki.ts`（`previewWikiUpload` / `commitWikiUpload`） | `src/components/WikiUploadPreflight.tsx` |
| 启动恢复 | `server/wiki-access-recovery.ts`（`onReady` 钩子） | — |
| 安全库扩展 | `server/security/schema.ts`（v3 → v4） · `security/store.ts` · `security/types.ts` | — |

所有 ACL 变更路径——上传提交、正文编辑保存、版本恢复、移动、删除、单篇授权、批量授权——都经过 `mutateWikiAccessUnlocked`；组合操作使用不再入队的 unlocked helper，不递归获取队列。

### 19.2 实施中修正的四处契约偏差

评审通过的实现初稿与本 Spec 存在四处偏差，已在交付前按 Spec 修正并补回归测试：

| 偏差 | Spec 条款 | 修正 |
|---|---|---|
| `roles → empty` / `→ missing` / `→ corrupt` 被判为 `widen`，导致「收窄到无人可见」的崩溃恢复会停在 `needs_review` 而不是提交收窄 | §4.3 runtime-set 矩阵 | `classifyAccessDirection` 改为严格实现 runtime-set 算法（equal → neutral，严格子集 → narrow，其余 → widen）；`wiki-access-effects.test.ts` 固定该矩阵 |
| `recoverWikiAccessOperations()` 被 import 但没有调用点，启动恢复从未执行，`pending` 扩权永远停在 `pending` | §8.2 | 在 discovery worker 之前注册 `onReady` 钩子执行 hold 投影恢复；`wiki-access-routes.test.ts` 断言启动后 `pending → needs_review` 且 hold 保持 |
| 批量选择未在去重前规范化 key，同一篇文档的两种写法被算成两项 | §7.3「服务端先规范化 key 并去重」 | `normalizeBatchSelection` 先走 `normalizeWikiKey` 再去重；同 canonical key 携带不同版本返回 409；非法 key 降级为逐篇 `wiki_batch_document_missing`，不中断整批 |
| 未映射的 SQLite 驱动错误被当成逐篇失败，批量继续往后写文档 | §7.4.5 审计库故障属系统性失败 | 原始驱动错误归入 `config_audit_unavailable`，批量立即停止并把剩余项标记 `not_run` |

### 19.3 SC-01–SC-24 证据映射

| SC | 执行的用例 |
|---|---|
| SC-01 | `wiki-upload-access.test.ts`「an empty final authorization is refused without `confirmed_empty`」；`wiki.test.tsx`「opens upload preview from the library home and commits a new Markdown document」 |
| SC-02 | `wiki-upload-access.test.ts`「create + `use_uploaded` writes the uploaded roles」「create + `set` replaces the uploaded declaration」；`wiki-access-effects.test.ts`「projects none / exact roles / all roles / a corrupt ACL」；`wiki-access-components.test.tsx`「WikiAccessEffectList」 |
| SC-03 | `wiki-upload-access.test.ts`「reports the uploaded difference but does not adopt it」「adopts the uploaded roles only when the admin explicitly asks for it」；`wiki.test.tsx`「shows the current / uploaded / final comparison for a replace upload」 |
| SC-04 | `wiki-upload-access.test.ts`「cannot be adopted and refuses the commit」「is repaired by an explicit `set`」；`wiki-access-components.test.tsx`「requires an explicit re-set for a corrupt stored declaration」 |
| SC-05 | `wiki-upload-access.test.ts`「refuses a commit without an explicit access selection / without the preview digest / a stale digest and writes nothing / a stale target version refuses the commit / a target that appeared after the preview refuses the create / a changed role_channel_version refuses the commit / the mode is never silently converted」；`wiki-acl-concurrency.test.ts` |
| SC-06 | `wiki-access-effects.test.ts` 聚合形状用例；`wiki.test.tsx`「lists one primary authorization status per row and filters without per-row access calls」（断言 `perRowCalls` 长度为 0） |
| SC-07 | `wiki-access-effects.test.ts`「distinguishes search+read, search only, read only and neither」「counts only enabled Agents that really bind the formal Role」；`context-channel-parity.test.ts` |
| SC-08 | `wiki-access-routes.test.ts`「preserves the body verbatim and every unknown frontmatter field」「a canonical no-op writes no file, creates no version and no audit row」；`wiki-access-components.test.tsx`「WikiAccessDrawer」 |
| SC-09 | `wiki.test.tsx`「disables the access drawer entry while the editor has an unsaved draft」；`wiki-access-components.test.tsx`「keeps the selection on a conflict and requires a new confirmation」 |
| SC-10 | `wiki-access-routes.test.ts`「428s without a version and 409s with a stale one; nothing is written」 |
| SC-11 | `wiki-access-batch.test.ts`「merges identical duplicate keys」「rejects an empty selection and creates no operation」「accepts exactly 100 unique keys」「rejects 101 unique keys and creates no operation」「enforces the limit AFTER deduplication and ignores a request-supplied limit」「canonicalizes the key BEFORE deduplicating」；`wiki-batch-access.test.tsx`「refuses the 101st document and leaves the selection unchanged」 |
| SC-12 | `wiki-access-batch.test.ts`「`add` performs the per-file union」「`replace` repairs a corrupt ACL and writes the exact value」「requires its own confirmation for an empty and for an all-roles replacement」；`wiki-batch-access.test.tsx`「offers exactly the two supported operations」 |
| SC-13 | `wiki-access-batch.test.ts`「shows the old and the new ACL, the direction, the no-op flag and the summary」「keeps the plan_digest stable and changes it when a baseline changes」；`wiki-batch-access.test.tsx`「previews the per-document difference plus a summary before submitting」 |
| SC-14 | `wiki-access-batch-faults.test.ts`「rejects with 409 wiki_batch_preview_stale, zero file writes and zero journal rows」 |
| SC-15 | `wiki-access-batch-faults.test.ts`「marks the conflicting item and still runs the later items」；`wiki-batch-access.test.tsx`「retries only the unfinished items and never retries needs_review」 |
| SC-16 | `wiki-access-batch-faults.test.ts`「the same key and digest returns the prior status without writing twice」「the same key with a different digest is a 409 idempotency conflict」 |
| SC-17 | `wiki-access-batch-faults.test.ts`「uses the shared batch operation id as the request id and the trusted actor」；`wiki-access-routes.test.ts`「records the trusted actor, never a body-supplied one」 |
| SC-18 | `wiki-write-queue.test.ts`（队列串行、每个写路径队列内重验版本 / 目标状态、组合操作不递归入队）；`wiki-acl-concurrency.test.ts`；`wiki.test.ts` |
| SC-19 | `wiki-access-operation.test.ts`「denies search AND read, even when the widened bytes are already on disk」「a widening whose bytes reached the disk becomes needs_review and stays held」「a pending operation whose bytes are still the old ones is aborted and the hold is released」；`context-acl-matrix.test.ts`；`wiki-access-batch-faults.test.ts`「never auto-commits a widening and never replays the write」 |
| SC-20 | `wiki-access-operation.test.ts`「a narrowing leaves no hold behind」；`context-policy-invalidation.test.ts`「an ACL edit on disk narrows Wiki and Skill reads immediately」 |
| SC-21 | `wiki-access-batch-faults.test.ts`「never auto-commits a widening and never replays the write」「contains no body, no secret, no credential and no absolute path」；`wiki-batch-access.test.tsx`「restores a previous run by operation id」 |
| SC-22 | `wiki-acl-concurrency.test.ts`「version restore never revives an older, wider ACL」「the second admin's ACL overwrite loses to the first (no silent last-writer-wins)」；`wiki.test.ts`（restore / move / delete 的 `expected_version` 门禁） |
| SC-23 | `wiki-access-auth.test.ts`（未登录读 / 预检 / 写 / 批量提交一律 401；已登录 operator 可读摘要并修改单篇授权）；`wiki-access-routes.test.ts`「records the trusted actor, never a body-supplied one」 |
| SC-24 | `wiki-access-components.test.tsx`（DOM 标识翻译防御）；`wiki.test.tsx`；`lint-terminology-scan.test.ts`「Spec 193 registered terminology and shared contracts」 |

### 19.4 新增稳定错误码

本 Spec 的错误表未列，落地时新增两个并已登记到 `webui/docs/03-api-spec.md`：

| 状态码 | code | 含义 |
|---|---|---|
| 400 | `wiki_batch_blocked` | 批量计划存在阻断性校验问题（例如 add 遇到损坏 ACL）；零写入 |
| 400 | `wiki_access_frontmatter_invalid` | 文档 frontmatter 无法解析或无法写回；零写入 |

### 19.5 已知边界与未验证项

* **未执行浏览器与移动窄屏测试。** 本轮验证只用 Vitest、Testing Library、`npm run build`、`lint:terminology`、`lint:ia-boundary` 与 `node scripts/lint-spec.mjs`。UI 的视觉与交互回归仍需人工过一遍。
* **队列与 hold 只覆盖单实例单副本。** 直接编辑 Wiki 文件、或多个 WebUI 进程共享写入同一内容目录，属不支持的多写者拓扑，不提供跨进程 CAS 或分布式事务保证。
* **`needs_review` 必须人工核对。** 扩权在崩溃后不会自动重放或自动确认；`needs_review` 的文档对 Agent 持续拒绝，管理员需先处理该状态再重试。
* **批量不是跨文件事务。** 单篇冲突只影响该篇；系统性失败会停止后续文档并把剩余项标记 `not_run`；成功项不回滚。
* **`role_channel_version` 是全局哈希**（Role 通道 + Agent 启用/绑定），不是某个 Agent 的 `snapshotHash`；Role 图缺失（无 `access.yaml`）按空 Role 图处理，不抛错。
* **既有测试被同步更新。** 上传契约（必须携带 `access` + `preview_digest`）、结构性写路径的 `expected_version`、安全库 schema v4 三项改动影响了 `audit-actor-propagation.test.ts`、`frontmatter-safety.test.ts`、`oidc-reservation.test.ts` 与 `audit-trust/audit-trust-backfill.test.ts`，这些文件已按新契约更新，不是降低断言。
