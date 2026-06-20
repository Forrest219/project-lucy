# Lucy WebUI UI Refresh 与工作台化改造 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Lucy WebUI UI Refresh 与工作台化改造 Spec |
| 文档类型 | Design |
| 版本 | v0.2-cross-review |
| 撰写日期 | 2026-06-20 |
| 撰写人 | Codex |
| 委托人 | forrest |
| 状态 | 已根据 Claude Code reviewer 反对意见修订，待二次交叉验证 |
| 基于材料 | `docs/webui-module-guide.md`、`docs/webui-impl-status.md`、`docs/webui-feature-map.md`、`docs/design-db-connection.md`、`docs/design-agent-permissions.md`、`docs/design-eval-monitoring.md`、`webui/docs/01-architecture.md`、`webui/docs/02-arch-spec.md`、`webui/docs/03-api-spec.md`、`webui/docs/04-data-model.md`、`webui/docs/06-navigation-ia.md`、Attu v3 README 与官方截图 |
| 输出位置 | `docs/design-webui-ui-refresh.md` |

---

## 1. 背景与目标

Lucy WebUI 当前已经覆盖数据库接入、语义层维护、业务文档、审阅校验、质量评测、访问治理等模块，但界面仍偏“文档页 + 表单堆叠”：导航层级弱、页面密度不稳定、核心编辑区缺少稳定工作台结构，用户在语义维护、Eval、权限审计之间切换时难以快速判断当前上下文和下一步动作。

本 spec 的目标是把 Lucy WebUI 改造成高密度治理工作台：

1. **全局信息架构更清楚**：用户始终知道当前模块、connection、schema、table、domain 或 agent。
2. **页面布局更像工具台**：左侧对象树/列表，中间主编辑或主表格，右侧预览、diff、状态或结果。
3. **视觉语言更专业克制**：浅灰应用背景、白色工作区、低对比边框、绿色主操作色、统一 toolbar/table/tabs/status 样式。
4. **关键工作流更短**：连接概览、表语义编辑、Eval 监控、Agent 权限、审计日志都有明确主动作和状态反馈。
5. **不牺牲现有治理边界**：所有写入仍走 dry-run/diff/confirm/validate/fs-safe/API envelope。

---

## 2. 非目标

本阶段不做以下事情：

- 不新增 WebUI 登录、多用户后台、外部 IAM。
- 不改变事实源：`semantic-layer/**/*.yaml`、`wiki/**/*.md`、`evals/**/*.yaml`、`webui/config/access.yaml`、`.ktx-ui/**` 仍按现有设计落盘。
- 不改 API envelope，不引入绕过 `apiClient` 的请求方式。
- 不绕过 `fs-safe.ts`，不读取 `.ktx/secrets/**`。
- 不重写后端数据模型，不改变 YAML 写入规则。
- 不做营销首页、装饰性首页或大面积插画。
- 不直接复制 Attu 代码；只借鉴其信息架构、工作台布局和视觉取向。

---

## 3. 已确认上下文约束

### 3.1 架构约束

- WebUI 是本地单用户治理编辑器，仅绑定 `127.0.0.1`。
- 写入前必须能展示 diff，写后关键路径必须 validate。
- 服务端状态使用 TanStack Query；表单可继续使用现有本地 state 或逐步引入 react-hook-form/zod。
- 页面路由以 `App.tsx` 现有 6 个一级模块为准：
  - 数据库接入
  - 语义层维护
  - 业务文档
  - 审阅与校验
  - 质量评测
  - 访问治理

### 3.2 页面约束

- `ConnectionOverview` 当前是列表页，可改造成状态总览页。
- `TableEditor` 当前已有左侧 sibling table 列表、表单、preview/diff，可改造成三栏工作台，不需要新增后端接口。
- `Eval Monitor` 已有趋势图、阈值、Top failures、drift distribution，可改造成 Attu Metrics 风格监控页。
- `AgentList`、`AgentDetail`、`Audit` 已有设计文档定义页面结构，UI 改造必须保留一次性 Token 明文、ACL diff、audit filters 等安全语义。
- `Review` 是提交前集中审阅页，不能弱化 diff 和 validate changed 的权重。

---

## 4. Attu 可借鉴点

本节只记录可迁移的设计模式，不代表照搬产品功能。

| Attu 模式 | Lucy 迁移方式 |
|---|---|
| 左侧连接树 + 模块导航 | Lucy 左侧保留 6 个一级模块，但顶部增加当前项目/连接状态；表编辑页内再出现 schema/table 对象树 |
| Cluster Overview 指标卡 + connection details + quick start | Lucy `ConnectionOverview` 改成数据库/KTX/MCP/语义层/Eval 状态总览 |
| Data Explorer 左树 + 右侧对象详情 tabs | Lucy `TableEditor` 改成对象树 + 属性编辑 + 右侧 YAML/diff/validate |
| Metrics 网格 + 时间窗口 + refresh | Lucy `Eval Monitor`、`ConnectionOverview`、`Audit` 使用统一指标卡与时间筛选 |
| HTTP API Playground 三栏：endpoint / request / response | Lucy 后续可单独设计 MCP/Agent Playground；本 spec 不纳入 Phase 1-3 |
| Topology / Role Chart | Lucy 后续 join graph、Agent ACL graph 可作为增强项，不进第一批 |
| Agent conversation list + current connection context | Lucy 后续 Agent 调试台应绑定 connection、权限、tool scope，不做孤立聊天框 |

---

## 5. 全局 Shell 改造

### 5.1 布局

现状：`grid-cols-[248px_minmax(0,1fr)]` + 简单侧边栏 + 主区 padding。

目标：

```text
┌─────────────────────────────────────────────────────────────┐
│ 左侧固定导航 264px │ 顶部上下文栏 / breadcrumbs / status     │
│                  │──────────────────────────────────────────│
│                  │ 页面级 toolbar                           │
│                  │──────────────────────────────────────────│
│                  │ 工作台主区域                             │
└─────────────────────────────────────────────────────────────┘
```

要求：

- 左侧导航宽度稳定在 260-280px，允许滚动。
- 主区使用浅灰背景；真实工作区用白色 panel/table/canvas。
- 顶部上下文栏不做大标题堆叠，优先展示当前位置、状态、主操作。
- 面包屑继续存在，但视觉弱于页面标题。
- 页面标题与说明只保留在需要解释工作流的页面；高频工具页不重复显示长说明。

### 5.2 左侧导航

保留现有 6 个分组，但视觉改造：

- 每个分组使用小号 uppercase/中文小标题，颜色弱化。
- 每个导航项增加图标位置，后续开发使用 lucide icons。
- 当前项使用浅绿色/浅灰背景，不使用高饱和蓝紫。
- 顶部品牌区暂不拍板最终品牌文案。Phase 1 默认保留当前 `KTX WebUI` 主标题，只把副标题从视觉上弱化；若产品确认切换品牌，再单独改为 `Lucy`。
- 底部固定工具区可放：主题切换、帮助、运行状态，第一批可只保留占位样式。

导航树在 Phase 1 固定为一层导航组 + 上下文页面，不新增二级折叠：

```text
数据库接入
- 连接概览        /connections
- 表白名单        /connections/whitelist
- 连通测试        /connections/test

语义层维护
- 表目录          /
  - 表语义编辑    /sources/:conn/:schema/:table   # 上下文页，不进左侧固定导航
  - 关联关系      /joins/:conn/:schema/:table     # 上下文页，不进左侧固定导航

业务文档
- Wiki 文档       /wiki

审阅与校验
- 变更审阅        /review

质量评测
- Case 管理       /eval/cases
- 运行历史        /eval/runs
- 趋势监控        /eval/monitor

访问治理
- Agent 实例      /admin/agents
  - Agent 详情    /admin/agents/:userId           # 上下文页，不进左侧固定导航
  - 新建 Token    /admin/agents/:userId/tokens/new
- 访问日志        /admin/audit
```

Active 状态规则：

- 上下文页归属最近的固定导航项，例如 `/sources/**` 归属「表目录」，`/admin/agents/:userId/**` 归属「Agent 实例」。
- 面包屑继续展示上下文层级；左侧导航只负责模块入口，不承载全部页面层级。
- 本次不新增 `/admin/playground` 或 `/playground`。

### 5.3 顶部上下文栏

新增统一 `.pl-topbar` 语义：

| 页面类型 | 顶栏内容 | 数据来源 | Phase 1 是否显示 |
|---|---|---|---|
| 连接页 | 当前项目 root、连接数 | `GET /api/project`、`GET /api/connections` | 是 |
| 连接页 | KTX CLI 状态 | `GET /api/project.ktxAvailable` | 是 |
| 表目录 | connection/schema filter、完成度摘要 | `GET /api/sources` 客户端派生 | 是 |
| 表编辑 | 返回、`conn / schema / table`、完成度、主动作 | route params、`GET /api/sources/:conn/:schema/:table` | 是 |
| 表编辑 | 最近保存/validate 状态 | 当前页面 mutation result / React state | 仅保存后显示，不预留空位 |
| Eval | domain、时间窗口 | `GET /api/eval/domains`、页面 state | 是 |
| Eval | 最新 run 状态 | `GET /api/eval/runs?domain=&limit=1` | Phase 1 不占位；Phase 2 有数据才显示 |
| Admin | agent/user、启用状态 | `GET /api/admin/agents/:userId` | 是 |
| Admin | 最近访问 | `Agent.stats.lastSeen` 或 `GET /api/admin/audit` 派生 | 有数据才显示 |

原则：没有明确数据来源的字段不占 UI 位置，不显示 `—` 指标卡墙。

---

## 5.4 现有 API 到 UI 字段映射

第一批 UI 只能使用下表已有接口和客户端可派生字段。未列出的指标不得进入 Phase 1-3 的固定布局。

| UI 区域 | 字段 | 来源 |
|---|---|---|
| 全局/连接页 | project root | `GET /api/project.root` |
| 全局/连接页 | KTX CLI 可用性 | `GET /api/project.ktxAvailable` |
| 连接概览 | 连接数、driver、schemas、enabled table 数 | `GET /api/connections.connections[]` |
| 连接概览 | semantic source 数、完成度摘要 | `GET /api/sources.tables[]` 客户端聚合 |
| 表目录/表编辑 | 表名、字段数、measure 数、join 数、completion | `GET /api/sources`、`GET /api/sources/:conn/:schema/:table` |
| TableEditor inspector | diff、proposed YAML | `PUT /api/sources/:conn/:schema/:table` with `dryRun:true` |
| TableEditor save | validation、changed files | `PUT /api/sources/:conn/:schema/:table` with `dryRun:false` |
| Eval Monitor | trend、thresholds | `GET /api/eval/monitor/trend` |
| Eval Monitor | top failures | `GET /api/eval/monitor/top-failures` |
| Eval Monitor | drift distribution | `GET /api/eval/monitor/drift-distribution` |
| Eval Monitor | latest run | `GET /api/eval/runs?domain=<domain>&limit=1`，Phase 2 有数据才显示 |
| Agent 列表 | Agent 数、启用数、Token 数、7d denied | `GET /api/admin/agents` 中 `Agent.stats` 客户端聚合 |
| Agent 详情 | ACL、Token 列表、diff | `GET/PATCH /api/admin/agents/:userId` |
| Audit | total、entries、argsSummary、errorDetail | `GET /api/admin/audit` |

不得进入 Phase 1-3 固定指标位的字段：

- “风险状态”如果没有明确计算规则，只能作为后续设计项。
- “24h denied 次数”如果接口只提供 `deniedLast7d`，不得硬写为 24h；可显示“7d denied”。
- “最近扫描结果”如果没有持久化接口，只能显示最近一次当前页面操作结果。

表目录 filter 状态规则：

- `/` 表目录的 connection/schema/status/search filter 必须写入 URL search params，便于 deep link、刷新恢复和 Review 复核。
- 不允许同时维护 URL search params 与另一个不可恢复的本地 filter 事实源。

---

## 6. 视觉系统

### 6.1 Token 方向

当前 `app.css` 已有 token 层。改造时优先调整 token，不在页面散落颜色。Phase 1 开发前必须先做一次 grep 盘点，输出“现有 token → 新 token”的本地实现备注；不允许新旧 token 长期并存。

建议 token：

| Token | 建议值 | 用途 |
|---|---:|---|
| `--token-color-bg-base` | `#f6f7f8` | 应用背景 |
| `--token-color-bg-surface` | `#ffffff` | panel/table |
| `--token-color-bg-muted` | `#eef2f0` | nav active / toolbar |
| `--token-color-fg-default` | `#17201c` | 主文字 |
| `--token-color-fg-muted` | `#66736d` | 次级文字 |
| `--token-color-border-default` | `#dde3df` | 普通边框 |
| `--token-color-border-strong` | `#b9c5be` | hover/focus 弱强调 |
| `--token-color-primary` | `#10b981` | 主操作，借鉴 Attu 绿色但不高饱和泛滥 |
| `--token-color-primary-hover` | `#059669` | 主操作 hover |
| `--token-color-accent` | `#2563eb` | 链接/信息辅助，不做主色 |
| `--token-color-danger` | `#dc2626` | 危险动作 |
| `--token-color-warning` | `#d97706` | 告警 |
| `--token-color-success` | `#15803d` | 成功状态 |

现有 token 映射要求：

| 现有 token | 处理 |
|---|---|
| `--token-color-bg-base` 等同名 token | 允许直接替换值 |
| `--color-*` Tailwind theme token | 继续由 `@theme` 映射，不直接在页面写 hex |
| 旧页面中硬编码色值 | Phase 1/2 触达页面时迁移到 token 或现有状态 class |
| 未使用 token | 删除前先 grep，避免误删 |

约束：

- 不使用大面积渐变、装饰 orb、营销式 hero。
- 卡片圆角不超过 8px，表格/工具栏保持紧凑。
- 字号不随 viewport 缩放。
- 字体层级要贴近工具产品：页面 H1 20-24px，panel title 14-16px，表格 13-14px。
- 保留中文可读性，优先系统字体栈。

### 6.2 组件分层

Phase 1 只新增或规范 5 个布局 class，避免 CSS 语义一次性铺开：

| Phase 1 class | 用途 |
|---|---|
| `.pl-app-shell` | 全局布局 |
| `.pl-sidebar` | 左侧导航 |
| `.pl-topbar` | 顶部上下文栏 |
| `.pl-workspace` | 页面主工作区 |
| `.pl-toolbar` | 页面级筛选/动作 |

Phase 2 起的复杂 UI 必须优先抽 React 组件，而不是只增加散落 class：

| 组件语义 | 用途 |
|---|---|
| `MetricCard` | 指标卡 |
| `PageTopbar` | 统一顶栏 |
| `SegmentedControl` | 时间窗口/视图切换 |
| `ObjectTree` | 表/字段/case/agent 对象树 |
| `InspectorPanel` | 右侧属性/预览面板 |
| `DataTable` | 高密度表格 |

`.pl-tabs`、`.pl-empty-state`、`.pl-inline-status`、`.pl-split-pane` 作为组件内部 class 候选，不作为 Phase 1 公共 CSS 交付项。

---

## 7. 核心页面改造

### 7.1 连接概览 `/connections`

目标：从普通列表页改造成 Lucy 的运行状态总览，借鉴 Attu Cluster Overview。

布局：

```text
Topbar: 数据库接入 / 连接概览                         [刷新]

Metric row:
[连接数] [enabled tables] [semantic sources] [KTX CLI]

Main:
左：Connection Details / connection list
右：Quick Start / MCP client snippet / 下一步操作

Lower:
最近一次当前页面触发的连通测试/扫描结果；无本页操作则不显示该区域
```

需要展示的数据按现有接口分层：

- 第一批只使用 §5.4 中列明的 `GET /api/connections`、`GET /api/project`、`GET /api/sources`。
- Eval 最新 run 不进入 `/connections` 第一批指标位，避免跨模块总览过早膨胀。
- 无接口的数据不伪造，也不预留空指标卡。

主动作：

- `表白名单`
- `连通测试`
- `打开表目录`

### 7.2 表语义编辑 `/sources/:conn/:schema/:table`

目标：改造成三栏工作台，借鉴 Attu Data Explorer 与旧版 Schema Builder。

布局：

```text
Topbar:
‹ 表目录    conn / schema / table       [创建 Wiki] [关联关系] [审阅] [保存]

Split pane:
左侧 object tree:
  schema/table sibling list
  当前 table 下：
    基础语义
    字段
    Measures
    Segments
    Joins

中间 editor:
  根据左侧选择展示属性编辑
  默认显示 Overview：表描述、grain、metadata、完成度

右侧 inspector:
  tabs: Diff / YAML / Validate
  dry-run preview、preview error、validate result
```

行为要求：

- 现有 350ms dry-run preview 保留。
- 保存行为仍调用 `dryRun:false`，成功后可继续跳 `Review`，但 UI 应让用户知道下一步是审阅。
- `Measures`、`Segments` 不再作为长页面连续堆叠，应能通过左侧对象树快速定位。
- 字段列表应支持搜索；字段描述编辑优先紧凑表格/列表。
- 右侧 inspector 宽度稳定，避免输入时布局跳动。

第一批范围：

- 不改后端接口。
- 不改变 `TablePatch`。
- 可以先用单个页面 state 实现左侧选区。
- 字段描述编辑在 Phase 2 **保留现有 textarea/input 受控编辑语义**，只调整布局和定位方式；不引入 contentEditable、单元格编辑、blur 自动保存或 Enter/Esc 编辑协议。
- “紧凑表格/列表”仅指展示密度，不改变保存时机；保存仍由页面级保存按钮触发。

### 7.3 Eval Monitor `/eval/monitor`

目标：改造成 Attu Metrics 风格的质量监控页。

布局：

```text
Topbar:
质量评测 / 趋势监控    Domain [superstore]  时间 [7d/30d/90d]  [刷新]

Metric row:
[最新通过率] [最近 run] [失败 case] [红线状态]

Main grid:
左大：准确率趋势
右上：Drift 分布
右下：失败 Case Top-N

Lower:
最近运行列表 + 阈值配置
```

行为要求：

- 当前告警 banner 保留，但融入 metric card，不占据过多垂直空间。
- SVG chart 可继续使用原实现，但视觉 token 化。
- 时间窗口使用 segmented control，避免普通 select 占据过多注意力。

### 7.4 Review `/review`

目标：从“diff 页面”改成提交前审阅工作台。

布局：

```text
Topbar:
审阅与校验 / 变更审阅       [Validate changed] [刷新 diff]

左：changed files list，带状态
右：selected diff + validation result
底部/右侧：提交前 checklist
```

要求：

- diff 是主内容，不能藏在过深 tab。
- validate changed 结果要和文件列表状态联动。
- 明确提示 WebUI 不做 git commit/PR。

### 7.5 Agent 实例与访问日志

目标：把访问治理页做成安全控制台，不只是表单。

`/admin/agents`：

- 顶部 metric row：Agent 数、启用数、Token 数、7d denied 次数（来自 `Agent.stats.deniedLast7d` 聚合）。
- Agent 卡片或表格保留，但更紧凑。
- 每个 Agent 显示 ACL 摘要、最近使用；“风险状态”不进入本期，除非先定义明确规则。

`/admin/agents/:userId`：

- 保留设计文档中的 tabs：基本信息、Token、工具权限、表权限、变更预览。
- 权限 tab 使用 split layout：左选择，右摘要/diff。
- 全局 deny 工具必须置灰，不能被视觉弱化成普通未选。

`/admin/audit`：

- 顶部 filter bar 高密度化。
- 表格行可展开查看 `argsSummary`、`errorDetail`、request id 和 client。
- `denied` 状态用 warning/danger token 强显示。
- 展开内容必须做防泄露处理：
  - 只展示后端返回的 `argsSummary`，不展示原始完整 args。
  - `errorDetail` 只展示 message 文本，不展示 stack trace。
  - 前端渲染前追加轻量 redaction：命中 `password`、`token`、`secret`、`apiKey`、`privateKey`、`cert`、`credential` key 的值显示为 `[REDACTED]`。
  - 不新增显示 SQL 全文的 UI，除非后端已经提供脱敏后的 SQL summary 字段。

### 7.6 MCP/Agent Playground

结论：**不进入本 spec 的 Phase 1-3，也不新增导航入口或路由。**

原因：

- 当前只有 `GET /api/admin/mcp-tools` 这类工具列表能力，没有确认安全的 invoke API。
- Playground 必须经过 MCP Auth Proxy 与审计，否则会绕过本 spec 的访问治理边界。
- 该能力需要单独设计 tool invocation、参数校验、审计、脱敏和错误展示。

后续如要开发，应新建 `docs/design-webui-playground.md` 单独评审。

---

## 8. 分阶段实施

### Phase 0：审阅本 spec

本阶段只落盘 spec，不开发。

审阅重点见 §11。

### Phase 1：全局视觉与 Shell

改动范围：

- `webui/src/app/App.tsx`
- `webui/src/app/app.css`
- 必要时少量共享 class 调整

验收：

- 所有现有路由可访问。
- 左侧导航、topbar、breadcrumbs、main workspace 样式统一；只允许新增 §6.2 的 5 个布局 class。
- 无功能行为变更。
- `npm test`、`npx tsc --noEmit`、`npm run build` 通过。
- 不切默认首页，不新增 Playground 路由，不改品牌主文案为 `Lucy`，除非审阅时另行确认。

### Phase 2：三大核心页面

改动范围：

- `ConnectionOverview.tsx`
- `TableEditor.tsx`
- `Monitor.tsx`
- 可能新增轻量共享组件：`MetricCard`、`PageTopbar`、`SegmentedControl`、`ObjectTree`

验收：

- `/connections` 成为状态总览页。
- `/sources/:conn/:schema/:table` 成为三栏工作台，dry-run/diff/save 不回归。
- `/eval/monitor` 具备 metrics dashboard 结构。
- 不改变字段编辑保存协议，不引入单元格编辑。

### Phase 3：Review 与访问治理 UI 整理

改动范围：

- `Review.tsx`
- `AgentList.tsx`
- `AgentDetail.tsx`
- `Audit.tsx`
- `NewToken.tsx`

验收：

- Token 明文一次性显示语义不变。
- Agent ACL 保存前仍有 diff/确认。
- Audit filter 和 expandable detail 可用。
- Review 的 diff 与 validate changed 更清楚。

### Phase 4：Playground 评估（独立 spec）

前置条件：

- 确认是否已有安全的 MCP tool list 与 invoke API。
- 确认调用是否经过 MCP Auth Proxy 与审计。

没有满足前置条件时，本阶段不开发。本文件不作为 Phase 4 的实现依据。

---

## 9. 测试与验证

每个开发 phase 结束必须执行：

```bash
cd webui
npm test
npx tsc --noEmit
npm run build
```

Phase 1 结束还必须执行一次硬编码颜色 smoke：

```bash
rg -n "#[0-9a-fA-F]{3,8}" webui/src --glob '*.{ts,tsx,css}'
```

允许命中：

- `app.css` token 定义区。
- 既有 diff/status 的历史色值，前提是 Phase 1 未触达对应组件。

不允许命中：Phase 1 新增或触达页面 JSX/TSX 中的硬编码 hex 色值。

涉及交互布局时，建议启动 dev server 并人工检查：

- 桌面宽度 1440px：三栏是否稳定。
- 窄桌面 1024px：侧边栏与主区是否还能读。
- 浏览器缩放 125%：按钮文字、表格、状态徽章不溢出。
- 空数据、loading、error 三态均有专业可读的状态。

最小人工检查路由：

- `/connections`
- `/`
- 任一真实 `/sources/:conn/:schema/:table`
- `/review`
- `/eval/monitor`
- `/admin/agents`
- `/admin/audit`

不要求第一批做移动端完整适配；最低要求是窄桌面不破版。

Phase 1-3 还必须补充或保留以下自动化覆盖：

| 阶段 | 最低测试要求 |
|---|---|
| Phase 1 | RTL 或轻量 smoke test：6 个一级模块路由均可 render，导航 active 状态符合 §5.2 归属规则 |
| Phase 2 | `TableEditor` 测试覆盖 dry-run preview、防抖后展示 diff、保存调用 `dryRun:false`、保存失败显示 error |
| Phase 2 | `Eval Monitor` 测试覆盖 trend/top failures/drift 三类数据为空时不破版 |
| Phase 3 | `Review` 测试覆盖 changed files 切换与 validate changed 结果展示 |
| Phase 3 | `NewToken` 测试覆盖 token 明文只在创建成功页面显示，离开/刷新后不可恢复 |
| Phase 3 | `Audit` 测试覆盖 expanded row 的 redaction 行为 |

如引入 Playwright，最低烟雾范围为：`/connections`、`/`、`/review`、`/eval/monitor`、`/admin/agents`、`/admin/audit` 可访问且无控制台运行时错误。Playwright 不是 Phase 1 阻塞项，但 Phase 3 前应补齐。

---

## 10. 验收标准

### 10.1 全局验收

- 1440px 宽度下，Shell 左侧导航宽度在 260-280px；主工作区无横向页面级滚动。
- 1024px 宽度下，左侧导航和主工作区仍可读；三栏页面允许内部 pane 滚动，但不能出现按钮文字溢出。
- 浏览器 125% 缩放下，`pl-btn`、状态徽章、导航项文字不溢出容器。
- Phase 1 后，页面级主背景、panel、导航 active、primary button 均由 token 控制；触达页面不新增硬编码 hex 色值。
- 不新增嵌套 panel/card 结构；重复项可以是卡片，页面 section 不做卡片套卡片。
- 不新增大面积渐变、装饰性背景或营销式 hero。

### 10.2 功能安全验收

- 所有写入路径仍走现有 API 与 `fs-safe`。
- API `ok:false` 不被前端吞掉。
- `.ktx/secrets/**` 不在任何页面展示。
- `TableEditor` 保存仍产生 preview/diff，并可 validate。
- `Review` 仍能集中看 diff 和 validate changed。
- Token 明文仍只显示一次。
- Audit 展开行不得显示疑似敏感值：含 `password|token|secret|apiKey|privateKey|cert|credential` key 的值必须为 `[REDACTED]`；不展示 stack trace。
- 前端 redaction 只作为兜底；后端返回的 `errorDetail` / message 文本也必须避免包含连接串、密码、token、本地 secrets 路径等敏感信息。
- 新 UI 不新增绕过 MCP Auth Proxy 的工具调用入口。

### 10.3 页面验收

| 页面 | 验收点 |
|---|---|
| `/connections` | 只展示 §5.4 有来源字段：连接数、enabled table 数、semantic source 数、KTX CLI 可用性、后续入口 |
| `/sources/:conn/:schema/:table` | 1440px 下三栏同屏；字段/measures/segments 可通过左侧对象树定位；右侧 diff/yaml/validate 区域宽度稳定 |
| `/eval/monitor` | metric row + 趋势 + drift + top failures + 阈值配置；空数据时显示空态而非空图表 |
| `/review` | 文件列表和 diff 同屏；validate changed 后文件或结果区能看到逐表状态 |
| `/admin/agents` | Agent 权限摘要、最近使用、7d denied 清楚；不出现未定义“风险状态” |
| `/admin/audit` | 过滤器、状态、展开详情清楚；展开详情已脱敏 |

---

## 11. 审阅清单

本文档立场如下，reviewer 只需标注异议：

1. **品牌口径**：Phase 1 保留 `KTX WebUI`，不改为 `Lucy`；只改善视觉层级。
2. **颜色口径**：接受绿色作为主操作色，蓝色退为信息辅助色；具体色值按 §6.1 token。
3. **优先级**：`TableEditor` 三栏工作台优先于对全部页面做平均美化。
4. **默认首页**：本次不切首页；`/` 继续是表目录。
5. **Playground**：本次不进入 Phase 1-3；后续独立 spec。
6. **响应式范围**：第一批只承诺桌面和 1024px 窄桌面，不承诺手机端。
7. **线框图**：文字线框足够进入开发；如审阅者要求，再补低保真图。

---

## 12. 待定问题

| 问题 | 本文档立场 |
|---|---|
| WebUI 顶部品牌是 `Lucy` 还是 `KTX WebUI` | Phase 1 保留 `KTX WebUI`；品牌改名另审 |
| 默认首页是否切换到 `/connections` | 不切，保留 `/` 为表目录 |
| 是否引入 lucide-react | 开发前先查 `package.json`；未安装则不因图标单独扩大范围 |
| 是否抽公共 React 组件 | Phase 2 起只抽必要组件，见 §6.2 |
| 是否保留现有 class 前缀 `pl-` | 保留，减少改动面 |
| 是否展示无来源指标 | 不展示，不预留空卡 |

---

## 13. Phase 0 收口项

进入 Phase 1 编码前，先完成以下轻量收口：

1. **Token 映射备注**：在开发记录或 PR 描述中列出 `app.css` 现有 token 到 §6.1 新 token 值的映射；确认不引入第二套 token。
2. **硬编码色值基线**：跑 §9 的 `rg "#..."` 命令，记录 Phase 1 前已有命中，Phase 1 不新增触达页面硬编码色值。
3. **路由 smoke 范围**：确认 §9 最小人工检查路由都有可用测试数据；若缺少真实 `/sources/:conn/:schema/:table`，用当前 `GET /api/sources` 第一条作为检查对象。
4. **Audit 脱敏边界**：开发前确认后端当前只返回 `argsSummary` 与 `errorDetail`，前端不新增 SQL 全文或 stack trace 展示。
5. **表目录 filter URL 化**：如 Phase 1 触达 Catalog 顶栏/filter，filter 状态必须使用 URL search params；否则保持现状，不额外引入第二套状态。
