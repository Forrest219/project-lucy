# PageHeader Standardization Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | PageHeader Standardization Spec |
| 文档类型 | Product / UX / Frontend Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-08-01 |
| 关联页面 | 全站所有使用 `PageHeader` 的路由（系统概览 / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理） |
| 关联工单 | `webui/docs/plans/wo-M40-page-header-standardization.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/01-architecture.md`、`webui/docs/06-navigation-ia.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`webui/docs/27-connection-overview-ops-ux-cleanup-spec.md`、`webui/docs/39-data-agent-ops-platform-global-ux-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

`PageHeader` 是 M15 引入的全站统一页面顶部组件（`webui/src/components/PageHeader.tsx`），目标是用单一来源消除早期 topbar + section-heading 同时渲染 H1 / 分类名的视觉冗余。当前实现已完成 4 象限布局（breadcrumbs / title+description / badges / actions），但经过多轮迭代（M27 / M32 / M36 / M39）后出现以下企业级 SaaS 后台可见性问题：

1. **卡片化过重**：`pl-page-header` 仍带 `rounded-lg border bg-bg-surface shadow-card`，与下方 `pl-panel` 形成"卡片套卡片"的视觉冗余；且标题栏外框与正文面板同宽度后，企业用户感到"标题被关进盒子里"。
2. **字体重叠 / 描述过小**：标题 `17px`、描述 `13px`、面包屑 `12px` 在多 badge 行下挤成两行时容易出现 13px 描述与 12px 面包屑视觉对齐冲突，描述行高 5 与面板正文 5 同样密。
3. **重复面包屑**：一级根页面（如 `/connections`、`/connections/whitelist`、`/eval/cases`、`/admin/audit`）的 `breadcrumbs` 末项与 `title` 完全同名，形成视觉重复。
4. **右侧 badges / actions 挤压标题**：在 1366px 宽度下，Onboarding 的 5 个 Badge + 刷新菜单将标题挤到第二行；其他页面的 actions 表格在窄屏下与标题区域产生挤压。
5. **详情页缺返回入口**：RunDetail / CaseEditor / AgentDetail / RoleDetail / NewToken 等详情页没有返回按钮，仅靠面包屑末端与 `title` 重复的同名项提供上下文。

本规格将 PageHeader 收敛为"自然页面顶部 + 稳定网格"，统一全站调用规范，并为后续全站 UX polish（M39 后续）打下基础。

## 2. 目标

| 目标 | 说明 |
|---|---|
| 视觉去框 | PageHeader 不再是卡片；只保留 `border-b border-border-default` 类轻量分隔 |
| 网格稳定 | 用 `grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto]` 锁左右两栏，窄屏下 badges/actions 自然换到下一行 |
| 重复消除 | 一级根页面不传 `breadcrumbs`；`title` 与 `breadcrumbs` 末项同名时组件自动抑制渲染面包屑 |
| 返回入口 | 新增可选 `backAction`，详情页统一用 `backAction`；同时给定时抑制 `breadcrumbs` |
| 字重节奏 | 标题 `text-[16px] font-semibold leading-6`（与 `pl-panel-title` 同级但页面顶部更突出，靠分隔线 + 间距建立层级）、描述统一 `text-[13px] leading-5 text-fg-muted`、面包屑 `text-xs text-fg-muted` |
| 调用收敛 | 全站调用点统一遵循"一级根页面无 breadcrumbs / 详情页 backAction / badges ≤ 4 / 无外层卡片包裹 PageHeader" |

## 3. 非目标

- 不修改 `PageHeader` 之外的其他组件库（`pl-panel`、`pl-section-heading`、`pl-page-intro`）。
- 不调整 `06-navigation-ia.md` 中的 IA 边界（侧栏分组 / 路由名 / 模块拆分）。
- 不引入新依赖（如 `@radix-ui/react-navigation-menu`）。
- 不修改右侧 `badges` / `actions` 内部的视觉风格（仍走既有 token `border-border-default bg-bg-muted rounded-pill text-xs`），只调整外层容器与换行策略。
- 不修改任何路由定义（当前实现在 `webui/src/app/App.tsx`）。
- 不引入 `lucide-react` 等图标库（沿用既有 emoji / 文本徽章）。

## 4. 组件契约（PageHeader API）

### 4.1 新增 / 修改的 Props

| Props | 类型 | 必填 | 说明 |
|---|---|---|---|
| `title` | `ReactNode` | ✅ | H1；左侧主区域 |
| `breadcrumbs` | `string[]` | 可选 | 面包屑；与 `backAction` 互斥；末项与 `title` 同名时整体不渲染 |
| `description` | `ReactNode` | 可选 | 业务说明文案；统一 `text-[13px]` |
| `badges` | `ReactNode` | 可选 | 右侧状态徽章组；推荐 ≤ 4；超出时调用方自行下沉到正文状态区 |
| `actions` | `ReactNode` | 可选 | 右侧主操作按钮组 |
| `backAction` | `ReactNode` | **新增** 可选 | 详情页返回按钮；存在时优先渲染并抑制 `breadcrumbs` |

### 4.2 渲染优先级

```
backAction 存在？
├── 是 → 渲染 backAction（左侧）；不渲染 breadcrumbs
└── 否 → breadcrumbs 存在？
    ├── 是 → 渲染 breadcrumbs（左侧）
    └── 否 → 左侧仅渲染 title
```

`title` 与 `breadcrumbs` 末项同名判定（`v0.1` 决策，详见 §10 待澄清）：
- `title` 为 `string` 且 `breadcrumbs` 长度 ≥ 1 且 `breadcrumbs[breadcrumbs.length - 1] === title` → 不渲染 breadcrumbs。
- `title` 为非 string（ReactNode 含 `<span>` / `<code>` / 模板字符串等）→ 不做同名判定，避免误抑制。

### 4.3 布局

外层 `<header>`：

```text
pl-page-header
  └─ border-b border-border-default pb-3 mb-4
  └─ 移除 rounded-lg / border / bg-bg-surface / shadow-card / p-4
```

网格 `<div>`：

```text
md 断点（≥768px）：
  grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2
  ┌────────────────────────────┬──────────────┐
  │ backAction | breadcrumbs   │ badges       │
  │ title (min-w-0 truncate)   │              │
  │ description (自然折行)     │ actions      │
  └────────────────────────────┴──────────────┘

< md 断点（移动 / 窄屏）：
  grid grid-cols-1 gap-y-2
  ┌────────────────────────────┐
  │ backAction | breadcrumbs   │
  │ title                      │
  │ description                │
  │ badges（flex-wrap）        │
  │ actions（flex-wrap）       │
  └────────────────────────────┘
```

### 4.4 单元约束

- 左侧标题区：`min-w-0`；**不强制对整个 H1 加 `truncate`**。规则：
  - `typeof title === "string"` 时，PageHeader 内部可对 `<h1>` 容器加 `truncate` + `title` 属性兜底。
  - `title` 为 ReactNode（含 `<span>` / `<code>` / 模板字符串拼接的对象名）时，PageHeader 不动 H1，由调用方把动态对象名片段单独 truncate（如 `<span className="truncate">{tableName}</span>`）。原因：长表名 / Agent id 直接被截会损害页面主标题可读性。
- `description` 允许自然折行，不强制单行。
- 右侧 badges / actions：`flex-wrap`，不设 `whitespace-nowrap` 在外层容器上；按钮自身仍按需 `whitespace-nowrap`。
- 现有 `pl-page-header-actions--stacked`（Onboarding 用）保留为内部 modifier，不影响本规格的网格。

## 5. 调用规范

### 5.1 一级根页面（不传 breadcrumbs）

| 页面 | 当前 breadcrumbs | 调整为 |
|---|---|---|
| `/overview` (`Onboarding.tsx`) | 无 | 不变 |
| `/connections` (`ConnectionOverview.tsx`) | `["数据接入", "连接概览"]` | **删除**（末项与 title 重复，且属一级根） |
| `/connections/whitelist` (`TableWhitelist.tsx`) | `["数据接入", "启用表范围"]` | **删除**（末项与 title 重复） |
| `/connections/test` (`ConnectionTest.tsx`) | `["数据接入", "连通测试"]` | **删除**（末项与 title 重复） |
| `/` (`Catalog.tsx`) | `["语义建模", "表目录"]` | **删除**（一级根）；本工单顺手把 `title` 从已弃用别名 `"语义维护工作台"` 改为 `"表目录"`（见 §10 Q13） |
| `/publish/workbench` (`PublishWorkbench.tsx`) | `["语义发布", "发布工作台"]` | **删除**（末项与 title 重复） |
| `/publish/history` (`PublishHistory.tsx`) | `["语义发布", "发布记录"]` | **删除**（一级根） |
| `/eval/cases` (`CaseList.tsx`) | `["质量评测", "评测用例"]` | **删除**（末项与 title 重复；CaseList 还有一处空态分支同样删） |
| `/eval/runs` (`RunList.tsx`) | `["质量评测", "运行历史"]` | **删除**（末项与 title 重复） |
| `/eval/monitor` (`Monitor.tsx`) | `["质量评测", "趋势监控"]` | **删除**（末项与 title 重复） |
| `/admin/agents` (`AgentList.tsx`) | `["访问治理", "Agent 实例"]` | **删除**（末项与 title 重复） |
| `/admin/roles` (`RoleList.tsx`) | `["访问治理", "角色权限"]` | **删除**（末项与 title 重复） |
| `/admin/audit` (`Audit.tsx`) | `["访问治理", "访问日志"]` 或 `["访问治理", "访问日志", "数据热力"]` | `data热力` 子页保留 `["访问治理", "访问日志", "数据热力"]`；`log` 一级页 **删除** 重复 |
| `/admin/config-audit` (`ConfigAudit.tsx`) | `["访问治理", "配置审计"]` | **删除**（末项与 title 重复） |

### 5.2 详情页 / 编辑页（用 backAction 或保留多级 breadcrumbs，二选一）

| 页面 | 当前 | 调整为 |
|---|---|---|
| `JoinEditor.tsx` | `breadcrumbs={["语义建模", "关联关系", table]}` + title `维护关联关系：${table}` | 保留多级 breadcrumbs（末项与 title 不完全相同） |
| `TableEditor.tsx` | 复杂 breadcrumbs | 保留 breadcrumbs（多层级） |
| `WikiEditor.tsx` | `["语义建模", "业务 Wiki", key]` | 保留 breadcrumbs（多层级 + 状态切换） |
| `eval/RunDetail.tsx` | `["质量评测", "运行历史", "Run #${id}"]` + title `Run #${id}` | 改 `backAction`（返回运行历史）；不传 breadcrumbs |
| `eval/CaseEditor.tsx` | `["质量评测", "评测用例", domain, ...]` | 改 `backAction`（返回 domain case 列表）；不传 breadcrumbs |
| `admin/RoleDetail.tsx` | 复杂 title + breadcrumbs | 改 `backAction`（返回角色权限列表）；不传 breadcrumbs |
| `admin/AgentDetail.tsx` | `["访问治理", "Agent 实例", agent.id]` + title 含 `agent.id` | 改 `backAction`（返回 Agent 列表）；不传 breadcrumbs |
| `admin/NewToken.tsx` | 3 处都传 `breadcrumbs` | 改 `backAction`（返回上一个创建步骤）；不传 breadcrumbs |

`backAction` 由调用方提供，常用形态（不在 PageHeader 内固定实现）：

```tsx
<PageHeader
  backAction={
    <Link to="/admin/agents" className="pl-page-header-back" aria-label="返回 Agent 列表">
      ← 返回 Agent 列表
    </Link>
  }
  title={...}
  ...
/>
```

样式层面：返回按钮使用 `text-xs text-fg-muted hover:text-fg-default`，左箭头可用现有 `←` 字符（不引入图标库）。

### 5.3 右侧 badges 上限

| 页面 | 当前 badges 数 | 调整为 |
|---|---|---|
| `Onboarding.tsx` | 5（env / last-updated / KTX 可用 / 语义完成 / 活跃 Token） | 保留 ≤ 4：`KTX 可用` 与 `语义完成` 合为一条 `语义资产 / KTX` 复合徽章；`活跃 Token` 移动到下方 `pl-page-intro` meta 行 |
| 其他页面 | 1–3 | 保持 |

`badges > 4` 的判定：调用方**不要在 PageHeader 内塞** 5 个及以上徽章，应在调用方把次要徽章下沉到下方 `pl-section-heading` 旁或 `<div className="pl-page-intro">` 内。

### 5.4 禁止外层卡片包裹 PageHeader

- `pl-page-stack`（`webui/src/app/app.css` 定义的最外层）保持纯 stack 容器，不允许在 PageHeader 外面再包一层 `pl-panel` / `rounded-lg border`。
- 各页面根容器 `pl-page-stack` 不变。
- 现有 `pl-page-header-actions--stacked` 内部 modifier 保留（Onboarding 专用）。

## 6. 验收标准

### 6.1 组件层

1. `PageHeader.tsx` 不再渲染 `pl-page-header-cell--empty` 占位 div（移除 4 象限 CSS 网格留下的空洞 cell）。
2. `pl-page-header` 类的 `app.css` 定义中不再出现 `rounded-lg border bg-bg-surface shadow-card p-4`。
3. 标题在 `1440px` 和 `1366px` 宽度下不被右侧 badges / actions 挤到第二行（Onboarding 除外，已调整 badges 数）。
4. 描述统一为 `text-[13px]`；标题与描述行高在 5 / 6 之间，视觉无重叠。
5. 当 `breadcrumbs` 仅 1 项且与 `title` 同名时不渲染面包屑。
6. 当 `backAction` 存在时不渲染 `breadcrumbs`；返回按钮左对齐标题之上。
7. 窄屏（`< md`）下 badges / actions 换行后不影响标题展示。

### 6.2 调用层

8. `Onboarding.tsx` badges ≤ 4；`活跃 Token` 下沉到 `pl-page-intro` 行。
9. `ConnectionOverview.tsx`、`TableWhitelist.tsx`、`ConnectionTest.tsx`、`Catalog.tsx`（顺手改 title 为 `"表目录"`）、`PublishWorkbench.tsx`、`PublishHistory.tsx`、`CaseList.tsx`、`RunList.tsx`、`Monitor.tsx`、`AgentList.tsx`、`RoleList.tsx`、`ConfigAudit.tsx`、`Audit.tsx`（log 分支）共 13 处一级根页面不传 `breadcrumbs`。
10. 详情页共 5 个页面文件 / 7 个 PageHeader 调用点改用 `backAction`；不传 `breadcrumbs`：RunDetail（1）/ CaseEditor（1）/ RoleDetail（1）/ AgentDetail（1）/ NewToken（3）。
11. 现有 5 个调用文件（`JoinEditor.tsx` / `TableEditor.tsx` / `WikiEditor.tsx` / `Audit.tsx` heatmap 子分支 / 其他保留多级 breadcrumbs 的页面）的 `breadcrumbs` 不变。

### 6.3 测试与构建

12. `cd webui && npx tsc --noEmit` 通过。
13. `cd webui && npm test` 通过；`__tests__/app-shell.test.tsx` 中 `PageHeader title="连接概览" breadcrumbs={["数据接入"]}` 类的 snapshot / 断言更新。
14. `cd webui && npm run lint:terminology` 通过。
15. `cd webui && npm run build` 通过。

### 6.4 视觉验证

16. 启动 WebUI（`npm run dev` 或 launchd 服务）。
17. 在 1440px 宽度检查：`/overview`、`/connections`、`/connections/whitelist`、`/connections/test`、`/`、`/publish/workbench`、`/publish/history`、`/eval/cases`、`/eval/runs`、`/eval/monitor`、`/admin/agents`、`/admin/roles`、`/admin/audit`、`/admin/config-audit`。
18. 在 1366px 宽度复核上述页面 + 详情页（`/admin/agents/:userId`、`/admin/roles/:roleId`、`/eval/cases/:domain/:caseId`、`/eval/runs/:runId`）。
19. 标题栏无外框、无面包屑与标题文字重叠、无重复标题、右侧元素不挤压标题；整体紧凑清晰。

## 7. 测试要求

- 更新 `webui/src/__tests__/app-shell.test.tsx`：
  - 断言 `PageHeader` 在不传 `backAction`、不传 `breadcrumbs` 时左侧仅渲染 `<h1>`。
  - 断言 `backAction` 存在时 `<nav aria-label="面包屑">` 不渲染。
  - 断言 `breadcrumbs=["X"]` 且 `title="X"` 时面包屑不渲染。
- 新增或更新 `webui/src/__tests__/page-header.test.tsx`：
  - 单元测试覆盖 `backAction` / `breadcrumbs` / 重复抑制 / 网格 class。
- 既有页面级测试（`connection-overview.test.tsx`、`case-list.test.tsx`、`audit.test.tsx` 等）按新断言更新（不传 breadcrumbs / 不含重复元素 / 含 `backAction` 时面包屑不存在）。

## 8. 风险与边界

| 风险 | 处理 |
|---|---|
| 删除 breadcrumbs 后用户失去模块上下文 | 侧栏高亮 + 顶部 H1 已能提供模块上下文；本页规格不修改侧栏 |
| `title` 为 ReactNode 时同名判定失效（`Audit.tsx` heatmap 子分支） | 仅对 string title 启用同名抑制；ReactNode title 维持原面包屑 |
| `backAction` 组件形态未统一 | 规格不强制实现形态，只规定左侧渲染与样式 token；调用方按本规范 5.2 示例 |
| 网格重构破坏既有 `pl-page-header-cell--empty` 视觉占位 | 主动移除占位 cell；不再使用 4 象限 CSS 网格 |
| 详情页返回后页面状态丢失（滚动位置 / 表单输入） | 不在本规格范围；保留既有 react-router 行为；后续如需要可加 `state` 透传 |

## 9. 实施分步（对应 wo-M40 工单）

1. 改 `webui/src/components/PageHeader.tsx`：
   - 新增 `backAction?: ReactNode` props。
   - 在内部判断 `backAction` 优先；无 `backAction` 时进入 breadcrumbs 判断；再无则只渲染 title。
   - 外层 header 移除 `pl-page-header` 的卡片类，新增轻量分隔类。
   - 内层 grid 改为稳定网格（`grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto]`），移除 `pl-page-header-cell--empty` 占位。
   - 标题区 `min-w-0`；string title 时容器可 `truncate` + `title` 属性兜底；ReactNode title 不动（详见 §10 Q2）。
2. 改 `webui/src/app/app.css`：
   - `.pl-page-header` 类：删除 `rounded-lg border bg-bg-surface shadow-card p-4`；替换为 `border-b border-border-default pb-3 mb-4`。
   - `.pl-page-header-grid`：替换 `grid-template-areas` 为单行网格；窄屏切换为 `grid-cols-1`。
   - `.pl-page-header-title`：调整为 `text-[16px] font-semibold leading-6 text-fg-default`（与 `pl-panel-title` 同字号，靠分隔线 + 间距区分层级）。
   - `.pl-page-header-description`：保持 `text-[13px] leading-5 text-fg-muted`。
   - 移除 `.pl-page-header-cell--empty` 与 4 象限 `grid-template-areas` 残留（`title` / `badges` / `desc` / `actions` / `crumbs` 全部清掉）。
   - 保留 `.pl-page-header-actions--stacked`（Onboarding 专用）。
   - 新增 `.pl-page-header-back`：`inline-flex items-center gap-1 text-xs text-fg-muted hover:text-fg-default`。
3. 清理一级根页面 13 处 `breadcrumbs`（见 §5.1）。
4. 详情页 6 处改 `backAction`（见 §5.2）。
5. 调整 `Onboarding.tsx` badges（≤ 4）+ `活跃 Token` 下沉到 `pl-page-intro`。
6. 顺手把 `Catalog.tsx` 的 PageHeader `title` 从 `"语义维护工作台"` 改为 `"表目录"`（已弃用别名收尾）。
7. 更新测试与现有页面级断言。
8. 视觉验证 1440px / 1366px（详见 §6.4）。

## 10. 待澄清问题（移交 coder 前必答）

| 编号 | 问题 | 默认建议 |
|---|---|---|
| Q1 | `title` 为 ReactNode 时是否启用同名抑制？ | 否；只对 string title 抑制，避免误判 |
| Q2 | `title` string 时是否加 `truncate`？ | string title 时 PageHeader 内部可对 `<h1>` 容器加 `truncate` + `title` 属性兜底；ReactNode title 不动，由调用方把动态对象名片段单独 truncate（避免长表名 / Agent id 直接被截损害可读性） |
| Q3 | `backAction` 是否在 PageHeader 内提供默认实现（如 `<button onClick={() => navigate(-1)}>`），还是只接受 ReactNode？ | 只接受 ReactNode；不绑定 react-router，方便测试与多入口 |
| Q4 | Onboarding 的 `活跃 Token` 下沉到 `pl-page-intro` 后，是否需要在 summary 文本中保留所有 5 条原信息？ | 保留全部信息，但分成"标题栏 badges（≤4）"+"下方 meta 行"两组 |
| Q5 | `pl-page-header-actions--stacked`（Onboarding 用）是否需要重命名以匹配新版网格？ | 不重命名；保留 modifier，Onboarding 仍按列布局刷新菜单 |
| Q6 | `Audit.tsx` 的 heatmap 子分支（`tab === "heatmap"`）是否走 `backAction`？ | 否；保留多级 breadcrumbs `["访问治理", "访问日志", "数据热力"]`；log 主分支删除 breadcrumbs |
| Q7 | `WikiEditor.tsx` 的 `breadcrumbs={["语义建模", "业务 Wiki", key]}` 是否需要 `backAction`？ | 否；`/wiki` 是**一级路由例外**，因为它本身就是工作台 / 编辑器（不是详情页），breadcrumbs 提供"我在哪篇 Wiki"的层级上下文比返回按钮更有价值 |
| Q8 | 是否在 PR 中同步更新 `docs/webui-feature-map.md`？ | 否；本页规格属于组件级 polish，不影响 feature map |
| Q9 | `WikiEditor` 与 `TableEditor` 的 `badges` 是否需要保留？ | 保留；未超过 ≤ 4 上限 |
| Q10 | `TableEditor.tsx`（注意：原 SPEC 笔误为 `TitleEditor`，以下以 `TableEditor` 为准）的 title 含模板字符串与动态值，truncate 策略？ | 保留 ReactNode 形态；不加 `truncate`；不靠 `title` 属性兜底（避免 table 名过长截断后无悬停值）。可在表格名上加 `truncate` 单独控制（既有） |
| Q11 | 既有 `__tests__/app-shell.test.tsx` 中 snapshot 是否需要更新？ | 保留测试用例；snapshot 整体重生成；新增断言覆盖 `backAction` 路径与重复抑制路径 |
| Q12 | `PageHeader` 是否接受 `className` prop？ | 暂不接受；先保持组件契约克制；如确需样式覆盖，新加 `className?: string` 与 `data-testid` 一起保留向后兼容 |
| Q13 | `Catalog.tsx` 的 PageHeader `title` 是否本次改为 `"表目录"`？ | 改。`"语义维护工作台"` 是已弃用别名，与 `webui/docs/00-product-terminology-standard.md` 冲突；本工单顺手收尾，避免遗留 |
| Q14 | 视觉验收的 Catalog 路径用 `/` 还是 `/semantic`？ | 用 `/`。当前 `App.tsx` 路由定义 `<Route path="/" element={<Catalog />} />`，没有 `/semantic` 路由；视觉验证必须按实际路由走 |
| Q15 | H1 字号最终定 16px 还是保留 17px？ | `text-[16px] font-semibold leading-6`（详见 §2 字重节奏）。理由：17px 与正文 13px 拉开足够层级，但 16px 在中文后台里更克制，配合分隔线 + `border-b` 已能与 `pl-panel-title` 拉开差距；不允许低于 16 |
| Q16 | 详情页原本 `actions` 里的"返回"按钮迁移到 `backAction` 后，是否删除原 actions 返回按钮？ | 删除。避免同一页面同时出现两个返回入口（视觉冗余 + 用户认知冲突）；如原 actions 仍含其它操作（如保存、复制 id），保留非返回部分 |

## 11. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Required UI terms:

| 概念 | UI 文案 |
|---|---|
| 返回 | `返回 <上一级>` 或 `← 返回 <上一级>` |
| 一级根页面 | 由侧栏 + H1 提供模块上下文，不再使用面包屑 |
| 详情页 | 顶部含 `backAction` 提供上下文 |

DOM 防御要求：

- 任何 `title` 内嵌的英文术语、版本号、连接 / Schema / Table / Agent / Token id 维持既有 `notranslate` / `translate="no"`。
- `backAction` 链接的目标 URL 维持现有 LTR 防御。

## 12. Backout Plan

如视觉验证发现回归，按以下顺序回滚（不依赖 M39 tag/branch，避免 agent 操作风险）：

1. **优先策略**：直接 `Revert` 本 PR 的合并 commit（`git revert -m 1 <merge-sha>`），按 PR 自动还原所有改动。
2. **局部回滚**（如仅组件层有问题）：
   - 从合并前 commit 恢复 `webui/src/components/PageHeader.tsx` 与 `webui/src/app/app.css` 中 `.pl-page-header*` 块：`git checkout <merge-parent-sha> -- webui/src/components/PageHeader.tsx webui/src/app/app.css`。
   - 调用方单独 `git revert` 涉及 `breadcrumbs` / `backAction` 删除或新增的页面文件。
3. **测试回滚**：保留既有 `app-shell.test.tsx` / `page-header.test.tsx` 的修改；若仅组件层回滚，调用方恢复 `breadcrumbs` 后可能需要同步更新页面级测试断言。
4. 重新走 §6.4 视觉验证；如仍回归，升级到 reviewer 阶段走 `Refactor_Instructions.md`。

预计回滚耗时：≤ 30 分钟（PR revert + 视觉验证）。