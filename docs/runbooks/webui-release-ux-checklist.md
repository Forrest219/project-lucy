# 发版前 WebUI 界面检查

这是发版走查用的清单。规范是 [`docs/specs/lucy-20261030-webui-release-ux-review-spec.md`](../specs/lucy-20261030-webui-release-ux-review-spec.md)。

客户证据清单里的 UX-01 到 UX-07 是管理到使用的业务旅程，见 [`docs/qa/e2e-release-checklist.md`](../qa/e2e-release-checklist.md)。它们不是本清单的编号。本清单使用 UX-R01 到 UX-R12。

结构层命令是 `cd webui && npm run e2e:release-ux`。它红了就不开始走查。走查记录写到 `docs/releases/ux/<产品版本>.md`。签字人是 xingchen。

## 基准页

走查开始先看这五页：

| 页面 | 路径 |
|---|---|
| Token 凭据 | `/admin/tokens` |
| 语义资产 | `/catalog` |
| 业务 Skill | `/skills` |
| 启用表范围 | `/connections/enabled-tables` |
| Agent 列表 | `/admin/agents` |

## 检查单

| 编号 | 检查 | 级别 |
|---|---|---|
| UX-R01 | 版本页构建提交等于台账 commit，健康检查通过，工作区不是脏构建 | 阻断 |
| UX-R02 | 侧栏每一项、`/help`、分区 tab、四个代表编辑器，以及未被代表行覆盖的变更编辑器都有一行结果 | 阻断 |
| UX-R03 | 上一版 Open 项本版都复看了 | 阻断 |
| UX-R04 | 1440 与 1920 都能到达全部侧栏入口；页头可见主动作不超过 3 个 | 阻断 |
| UX-R05 | 侧栏页 H1 与侧栏同名；主任务在工作区内；空态在面板里 | 阻断 |
| UX-R06 | 空态不在面板内或看不出原因、错误露出原文，记阻断。空态在面板内且写了原因、但没有下一步，记 P1 | 阻断与 P1 分开 |
| UX-R07 | 时间预设和自定义范围不同时残缺；0 条能解释 | 阻断 |
| UX-R08 | 同一状态维度不得互相否定。正式 Role 与使用中可以并存 | 阻断 |
| UX-R09 | `lint:terminology` 通过；界面抽查按 Spec §5 | lint 阻断，新词为 P1 |
| UX-R10 | 改过或新增的页面使用基准页的指标卡、表、Tab 或分段控件 | 新页面不合格则阻断 |
| UX-R11 | 失败有台账编号和截图；通过不要求全量截图 | 阻断 |
| UX-R12 | `docs/releases/ux/<产品版本>.md` 有本版记录；可生产发布的台账含已通过的 `webui-ux-review` | 阻断打可生产的 tag |

## 每个表面的八句

1. H1 是否与侧栏同名，描述能否一行读完，主动作是否不超过 3 个。
2. 主工作区是否有内容，或有一块空态面板。
3. 空态是否在面板内并说明原因。没有下一步时，页面仍可认出则记 P1。
4. 错误是否为中文产品文案，且可以重试。
5. 筛选是否完整。0 条结果能否解释。
6. 用户可见文字是否使用中文主术语。允许的补充说法不记失败。
7. 同一对象在同一状态维度上是否互相否定。
8. 指标卡、表、Tab 是否和基准页是同一套。

禁止主标签以 Spec §5 为准。`Data Capability Preview` 的主术语是「数据能力」，不是「数据能力预览」。

## 必走表面

侧栏路径以 `webui/src/app/navigation.ts` 为准。时间范围分段控件不单独成行。

| 表面 | 路径 |
|---|---|
| 系统概览 | `/overview` |
| 调用监控 | `/ops/calls` |
| 使用概况 · 数据访问 | `/admin/usage` |
| 使用概况 · 界面使用 | `/admin/usage?view=interface` |
| 连接概览 | `/connections` |
| 启用表范围 | `/connections/enabled-tables` |
| 语义资产 | `/catalog` |
| 表编辑器 | `/catalog/:conn/:schema/:table` |
| 业务 Wiki 目录 | `/wiki` |
| 业务 Wiki 一篇文档 | `/wiki` 打开一篇文档 |
| 业务 Skill | `/skills` |
| 发布工作台 | `/publish/workbench` |
| 发布记录 | `/publish/history` |
| 评测用例 | `/eval/cases` |
| 运行历史 | `/eval/runs` |
| 趋势监控 | `/eval/monitor` |
| 现场提问 | `/eval/field-questions` |
| 安全评测候选 | `/eval/security-candidates` |
| Agent 列表 | `/admin/agents` |
| Agent 基本信息、Token、权限预览、变更预览 | `/admin/agents/:userId` |
| Token 凭据 | `/admin/tokens` |
| 角色列表 | `/admin/roles` |
| 角色概览、可访问的表、允许的 MCP 工具、行级策略、使用情况 | `/admin/roles/:roleId` |
| 行权限视图 | `/admin/row-policies` |
| 访问关系图 | `/admin/access-map` |
| 访问日志 | `/admin/audit` |
| MCP 调试台 | `/admin/mcp-playground` |
| 配置审计 | `/admin/config-audit` |
| 品牌外观 | `/admin/branding` |
| 登录账户 | `/admin/accounts` |
| 版本信息 | `/admin/version` |
| 帮助中心 | `/help` |

四个代表编辑器是表编辑器、一篇 Wiki 文档、一个 Agent、一个角色。没有可打开的对象时记 N/A 并写原因。

自上一份 UX 记录以来改过、且不是本次抽中对象的编辑器，另起一行。抽中对象本身就是改过的编辑器时，这一行同时覆盖代表名额和变更名额，并在记录里注明。
