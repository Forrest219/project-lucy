# WO-202609-23：角色权限配置信息架构

| 元数据 | 内容 |
|---|---|
| 文档名称 | WO-202609-23：角色权限配置信息架构 |
| 文档类型 | Plan |
| 版本 | v1.0 |
| 撰写日期 | 2026-09-23 |
| 撰写人 | Grok |
| 委托人 | xingchen |
| 基于材料 | `inbox/20260923-1555-role-permission-config-final-spec.md`（定稿规格，目录被 gitignore）；Spec 98 / 99 / 131；`webui/server/proxy/acl.ts`；`webui/server/admin/mcp-tools.ts`；`webui/src/pages/admin/RoleDetail.tsx` |
| 适用范围 | 交给实现 agent 按任务执行，并由静态测试与源码检索验收。不授权改生产 Role |
| 输出位置 | `webui/docs/plans/wo-202609-23-role-permission-config-ia.md` |

| 字段 | 内容 |
|---|---|
| 状态 | Draft |
| 权威契约 | 定稿规格第 1–8 节。本工单是执行拆分；与定稿冲突时以定稿为准 |
| 验收环境 | 本地 Vitest 与源码检索。不在 `10.69.95.109:8276` 上保存 Role |

一次只领一个任务。T1、T2、T3 可并行。T4–T7 依赖其「前置」。T8 是收口，前面任一门禁未过就不得开始。

不改 `access.yaml` 字段形状，不升 `permission_model_version`，不改 `classifyTool` 的三类名单，不新增指标授权字段，不改生产 `procurement_pulsar_eval`。

## 1. 任务链

| 任务 | 产出 | 前置 | 静态门禁 |
|---|---|---|---|
| T1 | 草稿纯函数 | 无 | G1 |
| T2 | 工具候选的 `globalDenied` 覆盖 AbsoluteDeny | 无 | G2 |
| T3 | 术语标准补行 | 无 | G3 |
| T4 | 工具段界面 | T1 T2 T3 | G4 |
| T5 | 表树、行策略、高级扩权 | T1 T3 | G5 |
| T6 | 变更预览上的拒绝移除与扩权句 | T1 T4 T5 | G6 |
| T7 | 生效边界自然语言摘要 | T1 T3 | G7 |
| T8 | 收口门禁 | T4 T5 T6 T7 | G8 |

## 2. T1 — 草稿纯函数

新建 `webui/src/lib/rolePermissionDraft.ts` 与 `webui/src/__tests__/role-permission-draft.test.ts`。不改 `RoleDetail.tsx`。

函数与必须锁定的行为：

| 函数 | 行为 |
|---|---|
| `ABSOLUTE_DENY_TOOL_NAMES` | 与 `webui/server/proxy/acl.ts` 的 `ABSOLUTE_DENY_TOOLS` 成员相同：`sl_query`、`sl_read_source`、`sql_execution`、`sql_dialect_notes`、`memory_ingest`、`memory_ingest_status` |
| `READONLY_QA_PRESET` | 恰好 6 个：`lucy_catalog`、`lucy_read_source`、`lucy_query`、`lucy_explain_query`、`lucy_freshness`、`lucy_begin_question`。不含 `sl_validate` |
| `READONLY_QA_WIKI_PRESET` | 上一组加 `wiki_search`、`wiki_read`，共 8 个 |
| `stampPreset(current, preset)` | 返回预设的完整副本。忽略 `current`。不是并集 |
| `matchingPresetName(tools)` | 集合相等时返回「只读问答」或「只读问答 + 知识库」。多一个或少一个返回 `null`。顺序无关 |
| `partitionGrantableTools(tools)` | 拆成 `grantable` 与 `rejected`。`rejected` 只含 AbsoluteDeny |
| `deriveConnections(grants, mode)` | `names`：连接等于已选表的连接去重。`catalog_bound`：连接等于调用方传入的手工列表，不从空表树推导 |
| `groupTableGrants(tables)` | 同连接、同 Schema、行策略深度相等的表合并为一个 `names` selector。策略不同则拆开。全部行不写 `row_policy`。限定行写 `row_access: "scoped"` 与 `predicates` |
| `expansionNotice(mode)` | `names` 返回 `null`。`prefix` 返回「此后同前缀的新表自动进入」。`catalog_bound` 返回「已声明连接上，后续新启用的表自动进入，并走扩权审计」 |
| `buildEffectiveDigest(input)` | 见下方三句。`publishedMeasureCount === null` 时省略「（对应 M 个已发布指标）」。禁止在 `null` 时输出「对应 0 个」 |

`buildEffectiveDigest` 的行级句：

- 无策略：「已授权表均不限制行。」
- 有策略的表：「{表} 已配置行级策略 {字段} = {取值}。取数走受控查询（lucy_query 强制注入过滤）；读定义、新鲜度、实体详情在该表上将被直接拒绝。解释查询不取数，只返回本地安全说明。」
- 同一次授权里其余表：「其余 {n} 张表不限制行。」或逐表「不限制行」。
- 系统边界句固定：「原始 SQL、旧版 sl_query / sl_read_source、记忆注入属于系统禁止能力，不可授予。」
- `mode !== "names"` 时，可访问资产句末尾追加 `expansionNotice` 的原文。

条件在界面层用「等于 / 属于」。本模块存储仍用 `eq` / `in`。摘要里的取值直接写字段与值，不写 `op`。

**G1**

```bash
cd webui && npx vitest run src/__tests__/role-permission-draft.test.ts --maxWorkers=1
```

测试文件内用静态 import 比较 `ABSOLUTE_DENY_TOOL_NAMES` 与 `server/proxy/acl.ts` 的 `ABSOLUTE_DENY_TOOLS`，成员集合相等。禁止手写第二份名单却不做这条断言。

## 3. T2 — 工具候选拒绝位

改 `webui/server/admin/mcp-tools.ts`。`denyTools` 并上 `ABSOLUTE_DENY_TOOLS`（从 `../proxy/acl.ts` 导入）。不要在该文件再抄一份名单。不要改 `KNOWN_TOOLS` 的成员，现有测试仍要求响应里看得到 `sql_dialect_notes`。

扩展 `webui/server/__tests__/admin-roles.test.ts` 里 `GET /api/admin/mcp-tools`：`sl_query` 与 `sl_read_source` 的 `globalDenied` 为 `true`。

**G2**

```bash
cd webui && npx vitest run server/__tests__/admin-roles.test.ts -t "mcp-tools" --maxWorkers=1
```

`mcp-tools.ts` 中不得出现第二份 `sl_query` 拒绝数组。拒绝来源只有 `acl.ts` 的导出与 YAML `defaults.deny_tools` 的并集。

## 4. T3 — 术语

在 `webui/docs/00-product-terminology-standard.md` 的 Role 术语区追加定稿第 7 节的新行：可访问的表与行策略、只读问答、只读问答 + 知识库、当前与{预设名}一致、行权限：全部行、等于 / 属于、系统禁止、已发布指标。禁止列保持定稿原文。

本任务不改 `RoleDetail.tsx`。

**G3**

```bash
cd webui && npm run lint:terminology
```

源码检索：`00-product-terminology-standard.md` 同时含「只读问答」与「已发布指标」。禁止列里仍能看到「已绑定预设」「可授权指标」。

## 5. T4 — 工具段

改 `webui/src/pages/admin/RoleDetail.tsx` 的权限配置工具区，或把该区抽到 `webui/src/components/RoleToolGrants.tsx`。分组、预设、计数都调用 T1，不在组件里再写工具名数组。

界面：

- 两个按钮：「只读问答」「只读问答 + 知识库」。点击调用 `stampPreset`，替换当前可授工具。
- 集合一致时显示「当前与只读问答一致」或「当前与只读问答 + 知识库一致」。文案不得出现「已绑定预设」「跟随预设」。
- 自定义区两组标题：「查数与解释」「目录与知识」。`sl_validate` 旁标「建模能力」。
- `globalDenied === true` 或属于 AbsoluteDeny 的工具不渲染复选框。
- 计数文案是「已选 N 个」。N 只数可授且已选的工具。不得出现「已选 N/M」。
- 候选加载成功时，工具区不渲染标签输入。
- 页底静态句：「原始 SQL、旧版 sl_query / sl_read_source、记忆注入由系统禁止，不能授予。」该句没有复选框。

测试写在 `webui/src/__tests__/role-detail.test.tsx`，用现有渲染夹具。夹具里的工具列表须包含 `sl_query`（`globalDenied: true`）和 `lucy_query`（`globalDenied: false`）。

**G4**

```bash
cd webui && npx vitest run src/__tests__/role-detail.test.tsx --maxWorkers=1
```

断言至少包括：点「只读问答」后 `sl_validate` 不在选中集合；页面上没有 `sl_query` 的 checkbox；文本含「已选 6 个」且不含「/16」；页底系统禁止句存在。

## 6. T5 — 表树、行策略、高级扩权

仍在角色详情权限配置。树的勾选结果交给 `groupTableGrants` 与 `deriveConnections`。`formToAllow` 改为调用这两个函数，删除「连接复选框结果原样写入」的精确表名路径。

界面：

- 主路径是连接 → Schema → 表。精确表名模式下没有「允许的连接」复选框组。
- 候选表加载成功时，表名没有并列标签输入。加载失败时才允许手工补表名。
- 每张已选表默认「行权限：全部行」。未展开时，该段文本不含 `row_access`、`all`、`scoped`、`op`。
- 展开后条件只有「等于」「属于」。
- 「套用到其他已选表」只复制到管理员勾选的其他已选表，不作用于前缀规则。
- 高级区默认折叠，内有「按前缀匹配」「启用目录绑定」。
- 打开前缀或目录绑定的当下，摘要行包含 `expansionNotice` 的原文，且该句不在可折叠节点内。
- 目录绑定模式显示手工连接勾选，表树不可勾选。
- 前缀规则与目录规则旁有固定句：「此条件覆盖这条规则命中的每一张表，包括以后新进来的表。」

**G5**

同一测试文件新增用例，命令同 G4。至少锁定：

- 两张同 Schema 且都是全部行的表，`formToAllow` 产出一个 `names` selector，连接列表只有该连接。
- 其中一张改为 `region = East` 后，产出两个 selector，带策略的那个含 `row_policy`，另一个 `row_access` 为 `all` 且没有 `row_policy`。
- 目录绑定模式下连接来自手工列表，`source_scope` 为 `catalog_bound`，没有 `tableSelectors`。
- 渲染结果在未展开行策略时没有 `row_access`。
- 打开前缀后能找到「此后同前缀的新表自动进入」，且高级折叠控件的 `hidden` 或关闭状态不包住这句。

## 7. T6 — 变更预览

预览 payload 使用 T1 的 `partitionGrantableTools`：提交给 dryRun 的 `allow.tools` 不含 AbsoluteDeny。页面加载和草稿编辑不发保存请求。

变更预览区在 diff 之外增加可读清单：

- 每个被剔除的工具一行：「系统拒绝，保存后从授权中移除」。
- 扩权模式打开时展示与摘要相同的那句警示。

确认保存仍走现有 dryRun 之后的正式写入。禁止在 `GET` 角色详情时改 `access.yaml`。

**G6**

`role-detail.test.tsx`：夹具工具含 `sl_query` 与 `lucy_query`。点击预览后，请求体 `allow.tools` 不含 `sl_query`，预览界面含「系统拒绝，保存后从授权中移除」。正式保存按钮在预览生成前不可用，或点击时不发 `dryRun: false`。用现有的 mock 断言请求次数。

## 8. T7 — 生效边界摘要

改权限详情「生效边界」Tab。摘要三句调用 `buildEffectiveDigest`。输入里的工具数使用 `detail.effectivePermissions.tools.length`，不使用表单勾选数。

- 能力元组列表放进默认关闭的 `<details>`，摘要保留「Data Capability Preview」。
- `publishedMeasureCount` 来自已有目录数据的 `measureCount` 之和。本任务不新增 Role API 字段。目录查询未成功时传入 `null`。
- 无行策略时行级句是「已授权表均不限制行。」不得写「强制生效」作为无策略文案。

**G7**

`role-detail.test.tsx` 渲染生效边界：

- 工具徽章个数与摘要中的「生效 N 个」一致，且夹具若含未生效的 `sl_query` 勾选，N 不把它算进去。
- `publishedMeasureCount: null` 时摘要不含「已发布指标」。
- `publishedMeasureCount: 12` 时摘要含「对应 12 个已发布指标」，且没有可勾选的指标控件。
- 有一条 `region = East` 时摘要含「lucy_query 强制注入过滤」和「解释查询不取数」。
- 能力元组默认不可见，展开 `<details>` 后可见 `rowGrant`。

## 9. T8 — 收口

不新增功能。跑完全部门禁，并确认非目标没有被带进来。

**G8** 全部命令退出码 0：

```bash
cd webui && npm run lint:terminology
cd webui && npx vitest run \
  src/__tests__/role-permission-draft.test.ts \
  src/__tests__/role-detail.test.tsx \
  server/__tests__/admin-roles.test.ts \
  --maxWorkers=1
```

源码检索，路径限于 `webui/src/pages/admin/RoleDetail.tsx`、`webui/src/components/RoleToolGrants.tsx`（若存在）、`webui/src/lib/rolePermissionDraft.ts`：

| 检索 | 通过条件 |
|---|---|
| `已选 ` 与 `/` 组成的分母计数 | 无匹配 |
| `已绑定预设`、`跟随预设`、`可授权指标`、`业务域` | 无匹配 |
| `permission_model_version: 3` 或新的 `metrics` 授权字段 | 无匹配 |
| `row_access` 作为可见标签字符串 | 只允许出现在写回对象的字段名，不作为界面文案 |
| `stampPreset` | 定义只在 `rolePermissionDraft.ts` |
| `ABSOLUTE_DENY` 工具名数组字面量 | `acl.ts` 一处，加上 T1 测试里的相等断言。`mcp-tools.ts` 不得再声明同名数组 |

`git diff -- webui/server/proxy/acl.ts` 为空，或仅有与本工单无关的既有脏文件。本工单不改 `classifyTool`。

## 10. 明确不做

| 项 | 原因 |
|---|---|
| 改 `10.69.95.109:8276` 上的 `procurement_pulsar_eval` | 验收用夹具，不写生产 |
| 浏览器手工走查作为完成条件 | 本工单的完成条件是 G1–G8 |
| 指标树、指标勾选、Role API 增加指标字段 | 定稿非目标 |
| 预设 id 写入 `access.yaml` | 预设是一次写入，标记是集合比较 |
| 把行级策略提成独立 Tab | 定稿已否决 |
| 修改 Spec 99 的取数闸门 | 摘要只复述闸门 |
