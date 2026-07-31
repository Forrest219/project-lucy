# Sidebar Navigation IA Consolidation Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Sidebar Navigation IA Consolidation Spec |
| 文档类型 | Product / UX / IA Spec |
| 版本 | v0.2 |
| 撰写日期 | 2026-07-31（v0.1）；2026-08-01（v0.2：数据热力 Tab 下沉） |
| 适用范围 | Lucy WebUI 全局侧边栏主导航（一级分组 + 二级菜单）、面包屑、PageHeader 标题与 description、用户手册入口 |
| 关联工单 | `webui/docs/plans/wo-M34-sidebar-navigation-ia-consolidation.md` |
| 后续修订 | v0.2：Data Heatmap 已下沉为 `/admin/audit?tab=heatmap` 内的 Tab，由 `38-data-heatmap-tab-subsumption-spec.md` / `wo-M35` 跟踪；访问治理分组从 5 项收敛为 4 项 |
| 关联页面 | `/`、`/onboarding`、`/connections`、`/connections/whitelist`、`/connections/test`、`/wiki`、`/publish/workbench`、`/publish/history`、`/eval/cases`、`/eval/runs`、`/eval/monitor`、`/admin/agents`、`/admin/roles`、`/admin/audit`、`/admin/audit-sources`、`/admin/config-audit` |
| 事实源 | 代码：`webui/src/app/App.tsx`（`navGroups` + `Routes`）；规范：`webui/docs/06-navigation-ia.md`、`webui/docs/00-product-terminology-standard.md` |
| 关联规范 | `webui/docs/00-product-terminology-standard.md`、`webui/docs/06-navigation-ia.md`、`webui/docs/25-connection-module-terminology-ia-refresh-spec.md`、`webui/docs/26-database-connection-operations-runbook-spec.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`webui/docs/15-role-admin-spec.md`、`webui/docs/19-system-overview-runtime-monitoring-spec.md`、`docs/DEVELOPMENT.md` |

## 1. 背景

当前 Lucy WebUI 侧边栏（`webui/src/app/App.tsx:34-86`）采用 **7 个一级分组 / 14 个二级菜单** 的结构，存在以下与产品生命周期视角不一致的问题：

1. **存在单节点分组**：`运行状态`（仅 1 项）、`语义层维护`（仅 1 项）、`业务文档`（仅 1 项）。单节点分组既占视觉重量，又在用户脑海中切出额外认知成本，违反 IA 最小化原则。
2. **二级命名偏技术/安全阻断**：`表白名单` 携带“准入 / 黑名单”心智、`数据源热力` 引入“热力图”隐喻、`配置变更` 弱于“审计”含义、`角色配置` 未点明 RBAC 归属、`Case 管理` 中英混杂。
3. **生命周期不连贯**：`数据库接入 → 语义层维护 → 业务文档 → 语义发布 → 质量评测 → 访问治理` 之间存在 7 个断点，用户需要在 7 个分组标题间扫描才能走完“接库 → 建模型 → 写 Wiki → 发布 → 评测 → 治理”全链路。
4. **部分二级项与一级项职责重叠**：`连通测试` 与 `连接概览` 强相关，挂在平级菜单里破坏“对象 = 分组”的 IA 原则。
5. **运行状态 Dashboard 缺少仪式感**：`系统概览` 是 Lucy 入口页（Onboarding），但被降级为“运行状态”大标题下的普通项，未承担 Dashboard 身份。

本轮目标是 **以业务生命周期为主轴重构侧边栏**，从 7 个一级分组收敛为 **5 个核心分组 + 1 个置顶项**，同时收敛术语、收敛低密度分组、吸收单节点分组、让 `系统概览` 真正成为 Dashboard 入口。

## 2. 决策摘要

| 优先级 | 决策 | 说明 |
|---|---|---|
| P0 | 收敛为 5+1 结构 | 一级从 7 个收敛为 5 个核心分组 + 1 个置顶项：`系统概览（置顶） / 数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理` |
| P0 | 删除 `运行状态` 大标题 | `系统概览` 作为侧边栏最顶部的独立 Dashboard 入口，不再被分组标题压住 |
| P0 | 吸收 `连通测试` 进 `连接概览` | `连通测试` 仍保留路由兼容入口，但不再占据主导航；主入口进入连接卡片 Drawer |
| P0 | 合并 `语义层维护` + `业务文档` 为 `语义建模` | 消除两个单节点分组，结构化语义（YAML）与非结构化语义（Markdown）作为同一对象的两种形态 |
| P0 | 启用表范围 | `表白名单` → `启用表范围`，消除“准入 / 安全阻断”心智，明确“指定哪些表参与 Agent 建模” |
| P0 | 评测用例 | `Case 管理` → `评测用例`，消除中英混杂、贴合 B 端数据评测标准 |
| P0 | 角色权限 / 数据热力 / 配置审计 | 访问治理分组内三个二级项文案精细化，强调 RBAC 归属与审计属性 |
| P1 | 保持路由不变 | 所有原路由继续可用，仅移除/降级主导航的展示；旧链接加 301 / 兼容重定向 |
| P1 | 面包屑同步更新 | 全部 PageHeader 的 `breadcrumbs` 字段必须更新为新一级标题 |
| P1 | 用户手册同步更新 | `webui/docs/user-guide.html` 左侧目录与首页截图需同步替换 |
| P2 | 侧边栏可折叠 | 分组支持折叠 / 展开 + 状态持久化（不属于本 spec 范围，登记为后续工作） |

## 3. 目标与非目标

### 3.1 目标

| 目标 | 说明 |
|---|---|
| 生命周期叙事 | 侧边栏顺序 = `数据接入 → 语义建模 → 语义发布 → 质量评测 → 访问治理`，辅以 `系统概览` Dashboard 入口 |
| 分组密度合理 | 每个一级分组至少 2 个二级项；单节点项必须合并到相邻分组或置顶 |
| 二级命名克制 | 全部使用产品主术语；安全/技术隐喻让位于业务价值 |
| Dashboard 仪式感 | `系统概览` 在视觉层级上独立于五个核心分组，作为入口页 |
| 路由不破 | 所有现有 URL 保持可访问；旧主导航项在适当时机降级为兼容入口或重定向 |
| 面包屑 / 用户手册同步 | 与新侧边栏口径完全一致 |

### 3.2 非目标

| 非目标 | 理由 |
|---|---|
| 不重做 Onboarding 内容 | `系统概览` 文案、checklist 步骤、metric cards 由 `19-system-overview-runtime-monitoring-spec.md` 管辖 |
| 不重做连通测试 Drawer | Drawer 实现由 `25-connection-module-terminology-ia-refresh-spec.md` 管辖；本轮只做"是否进入主导航"决策 |
| 不改变 API 契约 | 不新增后端 API、不改 path、不改 status code |
| 不重做 Wiki 工作台 | `/wiki` 内容、`13-business-wiki-ux-refactor.md`、`36-business-wiki-read-edit-workbench-spec.md` 决定 |
| 不重做发布工作台 | `/publish/*` 由 `23-semantic-asset-publish-export-spec.md` 决定 |
| 不重做评测后台 | `/eval/*` 由 `05-task-list.md` 与 `14-agent-admin-enterprise-delivery-spec.md` 决定 |
| 不重做访问治理后台 | `/admin/*` 业务规则由 `14-agent-admin-enterprise-delivery-spec.md`、`15-role-admin-spec.md` 决定 |
| 不引入新依赖 | 全部基于现有 React、React Router、TanStack Query、Vitest、Testing Library |
| 不删除任何路由 | 旧导航项路由保留，仅在主导航中隐藏或重定向 |

## 4. 信息架构

### 4.1 5+1 侧边栏结构（终态）

```text
Lucy WebUI
┌────────────────────────────────────────────┐
│ 系统概览                       [置顶独立项] │  ← 路由 /onboarding
└────────────────────────────────────────────┘
数据接入
  - 连接概览                 /connections
  - 启用表范围               /connections/whitelist
  - 连通测试（兼容）         /connections/test
语义建模
  - 表目录                   /
  - 业务 Wiki                /wiki
语义发布
  - 发布工作台               /publish/workbench
  - 发布记录                 /publish/history
质量评测
  - 评测用例                 /eval/cases
  - 运行历史                 /eval/runs
  - 趋势监控                 /eval/monitor
访问治理
  - Agent 实例               /admin/agents
  - 角色权限                 /admin/roles
  - 访问日志                 /admin/audit
  - 数据热力                 /admin/audit-sources
  - 配置审计                 /admin/config-audit
```

### 4.2 一级 → 二级映射（与现有路由对齐）

| 一级（分组） | 二级（菜单项） | 路由 | 改动类型 |
|---|---|---|---|
| 系统概览（置顶） | 系统概览 | `/onboarding` | 拆出"运行状态"大标题 |
| 数据接入 | 连接概览 | `/connections` | 保留 |
| 数据接入 | 启用表范围 | `/connections/whitelist` | 改名（原：表白名单） |
| 数据接入 | 连通测试 | `/connections/test` | 降级兼容（不进入主导航） |
| 语义建模 | 表目录 | `/` | 保留；分组改名（原：语义层维护） |
| 语义建模 | 业务 Wiki | `/wiki` | 移入合并（原：业务文档 / Wiki 文档） |
| 语义发布 | 发布工作台 | `/publish/workbench` | 保留 |
| 语义发布 | 发布记录 | `/publish/history` | 保留 |
| 质量评测 | 评测用例 | `/eval/cases` | 改名（原：Case 管理） |
| 质量评测 | 运行历史 | `/eval/runs` | 保留 |
| 质量评测 | 趋势监控 | `/eval/monitor` | 保留 |
| 访问治理 | Agent 实例 | `/admin/agents` | 保留 |
| 访问治理 | 角色权限 | `/admin/roles` | 改名（原：角色配置） |
| 访问治理 | 访问日志 | `/admin/audit` | 保留 |
| 访问治理 | 数据热力 | `/admin/audit?tab=heatmap`（Tab） | v0.2 下沉为访问日志内 Tab；原独立路由 `/admin/audit-sources` 保留为兼容重定向 |
| 访问治理 | 配置审计 | `/admin/config-audit` | 改名（原：配置变更） |

### 4.3 侧边栏可视化规则

```text
┌────────────────────────────┐
│ 系统概览            [置顶]  │  ← 独立 Section，无分组标题
├────────────────────────────┤
│ 数据接入                    │  ← 5 个核心分组标题
│   · 连接概览                │
│   · 启用表范围              │
│   · 连通测试（兼容）        │  ← 兼容项使用 9pt 灰字 + "(兼容)" 后缀
│ 语义建模                    │
│   · 表目录                  │
│   · 业务 Wiki               │
│ 语义发布                    │
│   · 发布工作台              │
│   · 发布记录                │
│ 质量评测                    │
│   · 评测用例                │
│   · 运行历史                │
│   · 趋势监控                │
│ 访问治理                    │
│   · Agent 实例              │
│   · 角色权限                │
│   · 访问日志                │
│   · 数据热力                │
│   · 配置审计                │
├────────────────────────────┤
│ 系统手册         ?         │
│ Lucy v1.8 · © 2026         │
└────────────────────────────┘
```

样式约束：

1. `系统概览` 与 5 个核心分组之间使用更明显的视觉分隔（顶部 `border-t` + 8px 间距），区别“入口 Dashboard” vs “业务分组”。
2. `连同测试` 在主导航保留一段过渡期（≤ v1.9），文案后追加 `（兼容）` 灰色后缀，引导用户前往连接卡片 Drawer。下一版本可彻底移除该菜单项。
3. 当前激活项继续使用 `pl-nav-link--active`，激活态不因分组切换而变化。
4. 视觉密度、字号、padding 与现有 `pl-nav-section` 保持一致；不允许为新结构引入新 CSS 类名，必须复用。

### 4.4 路由不变性

| 旧主导航项 | 旧路由 | 本轮处理 |
|---|---|---|
| 系统概览 | `/onboarding` | 保留路由，提升为置顶独立项 |
| 连接概览 | `/connections` | 保留 |
| 表白名单 | `/connections/whitelist` | 保留路由，仅 PageHeader 标题与 breadcrumbs 改名 `启用表范围` |
| 连通测试 | `/connections/test` | 保留路由，导航中保留兼容项 `(兼容)`；在 PageHeader 中给出引导文案 |
| 表目录 | `/` | 保留 |
| Wiki 文档 | `/wiki` | 保留；二级标题 `Wiki 文档` → `业务 Wiki` |
| 发布工作台 | `/publish/workbench` | 保留 |
| 发布记录 | `/publish/history` | 保留 |
| Case 管理 | `/eval/cases` | 保留；二级标题 `Case 管理` → `评测用例`；面包屑同步 |
| 运行历史 | `/eval/runs` | 保留 |
| 趋势监控 | `/eval/monitor` | 保留 |
| Agent 实例 | `/admin/agents` | 保留 |
| 角色配置 | `/admin/roles` | 保留；二级标题 `角色配置` → `角色权限` |
| 访问日志 | `/admin/audit` | 保留 |
| 数据源热力 | `/admin/audit-sources` | 保留；二级标题 `数据源热力` → `数据热力` |
| 配置变更 | `/admin/config-audit` | 保留；二级标题 `配置变更` → `配置审计` |

禁止行为：

1. 不删除任何路由。
2. 不修改任何 `path` 字符串。
3. 不修改任何 `<Route element={...} />` 的 element 组件。

### 4.5 面包屑规则

| 页面 | 新面包屑 |
|---|---|
| 系统概览 | `系统概览`（无前缀） |
| 连接概览 | `数据接入 / 连接概览` |
| 启用表范围 | `数据接入 / 启用表范围` |
| 连通测试 | `数据接入 / 连通测试`（兼容） |
| 表目录 | `语义建模 / 表目录` |
| 表语义编辑 | `语义建模 / <schema> / <table>` |
| 关联关系 | `语义建模 / 关联关系 / <table>` |
| 业务 Wiki | `语义建模 / 业务 Wiki` |
| 发布工作台 | `语义发布 / 发布工作台` |
| 发布记录 | `语义发布 / 发布记录` |
| 评测用例 | `质量评测 / 评测用例` |
| 运行历史 | `质量评测 / 运行历史 / Run #<id>` |
| 趋势监控 | `质量评测 / 趋势监控` |
| Agent 实例 | `访问治理 / Agent 实例` |
| 角色权限 | `访问治理 / 角色权限` |
| 访问日志 | `访问治理 / 访问日志` |
| 数据热力 | `访问治理 / 数据热力` |
| 配置审计 | `访问治理 / 配置审计` |

### 4.6 上下文页处理

`表语义编辑（/sources/...）` 与 `关联关系（/joins/...）` 仍为上下文页，不进入主导航。从 `表目录` 行点击进入。

## 5. Terminology Compliance

本 spec 引入 / 替换了 4 个产品主术语和 1 个一级分组名。须在落地时同步登记到 `webui/docs/00-product-terminology-standard.md` 的对应分区，并在对应模块页面中以术语断言守护。

### 5.1 新术语

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| System Overview（置顶） | 系统概览 | 系统 Dashboard | 系统总览 | 侧边栏最顶部独立入口，区别于分组内的二级项 |
| Enabled Tables | 启用表范围 | 启用的表 | 表白名单、白表、表白 | 控制进入语义层的表范围；本轮将 UI 主术语由 `表白名单` 收敛为 `启用表范围` 以消除安全阻断感，明确表达该范围用于 Agent 建模 |
| Semantic Modeling | 语义建模 | 语义模型 | 语义层维护 + 业务文档作为两个分组 | 涵盖结构化语义（YAML Overlay）与非结构化业务文档（Markdown Wiki）两类资产 |
| Evaluation Case | 评测用例 | 评测集 | Case 管理、案例管理、混用 Case | 数据问答 / 语义质量评测中的单条样例；菜单项收敛为 `评测用例` |
| Role Permission | 角色权限 | Role | 角色配置、角色模板混用 | access.yaml 中的 role 模板；强调 RBAC 归属 |
| Data Heatmap | 数据热力 | 表级访问热力 | 数据源热力、源热力 | 从访问审计派生的表级访问与拒绝分布；脱去“数据源”强调“表级” |
| Config Audit | 配置审计 | 配置变更审计 | 配置变更 | 访问配置写入的审计记录；明确审计属性 |

### 5.2 Forbidden Terms（本轮强制拦截）

```ts
const sidebarForbiddenTerms = [
  "运行状态",      // 不再作为一级分组标题
  "语义层维护",    // 已被 "语义建模" 替代
  "业务文档",      // 已被 "语义建模" 替代
  "数据库接入",    // 已被 "数据接入" 替代
  "表白名单",      // 已被 "启用表范围" 替代
  "Wiki 文档",     // 已被 "业务 Wiki" 替代
  "Case 管理",     // 已被 "评测用例" 替代
  "角色配置",      // 已被 "角色权限" 替代
  "数据源热力",    // 已被 "数据热力" 替代
  "配置变更",      // 已被 "配置审计" 替代（仅限作为菜单/面包屑/PageHeader 标题时）
];
```

注意：`配置变更` 在 `ConfigAudit` 详情行、Diff 说明、API 返回字段等非主导航 / 非 PageHeader 标题场景下仍可作为补充说法使用，仅在用户可见主标题（导航 / 面包屑 / 页面 H1）层收敛为 `配置审计`。

### 5.3 同步修订建议（本 spec 落地的伴随变更）

执行本 spec 时必须同步修订 `webui/docs/00-product-terminology-standard.md`：

1. §3 全局固定术语表：
   - `Whitelist` 行 `UI 主术语` 由 `表白名单` 改为 `启用表范围`，`允许补充说法` 追加 `表白名单（兼容）`。
   - 新增 `Enabled Tables / 启用表范围`、`Evaluation Case / 评测用例`、`Role Permission / 角色权限`、`Data Heatmap / 数据热力`、`Config Audit / 配置审计`、`Semantic Modeling / 语义建模` 六行。
2. §4.1 数据库接入：
   - `Table Whitelist` 行 `UI 主术语` 由 `表白名单` 改为 `启用表范围`，`禁止文案` 增加 `表白名单`（主导航场景）。
3. §4.2 语义层维护 → 改名为 `4.2 语义建模`：
   - 新增 `Business Wiki` 行 `UI 主术语` 由 `Wiki 文档（混合）` 收敛为 `业务 Wiki`。
4. §4.4 质量评测：
   - `Evaluation Case` 行 `UI 主术语` 由 `评测案例 / 案例管理` 收敛为 `评测用例 / 评测集`。
5. §4.5 系统与运维：
   - 新增 `Sidebar Group` 行，登记 5+1 侧边栏结构与主术语。

伴随变更在 plan 中作为 `Task 6: 术语同步` 落地，**必须与本次代码 / 导航 / UI 标题刷新合并到同一 Commit / PR**，确保 `00-product-terminology-standard.md` 事实源与代码同步落地。任何先合并代码后补 00 修订、或反过来，都会让读取 00 的 Agent / 开发者出现断层。spec 提交时附 `00-product-terminology-standard.md` 的最终 diff，与代码同 PR 合并。

## 6. 页面落地

### 6.1 系统概览（置顶独立项）

- 路由：`/onboarding`
- 页面元素不变，由 `19-system-overview-runtime-monitoring-spec.md` 决定。
- 本轮唯一变更：移除 `运行状态` 大标题，使其在侧边栏成为独立 Section，无分组前缀。
- 面包屑：`系统概览`（无前缀）。
- 浏览器翻译防御：维持现有 `translate="no"` 与 `notranslate`。

### 6.2 数据接入 / 连接概览

- 路由：`/connections`
- 页面元素保持；按钮层级由 `25-connection-module-terminology-ia-refresh-spec.md` 决定。
- 本轮唯一变更：
  - PageHeader `title` 仍为 `连接概览`；
  - PageHeader `breadcrumbs` 由 `["数据库接入", "连接概览"]` 改为 `["数据接入", "连接概览"]`；
  - 标题区不再承载“数据库接入”前缀文字（旧标题由分组名承担）。
- 后续工作（不在本轮）：连通测试 Drawer 由 `25-connection-module-terminology-ia-refresh-spec.md` Task 4 落实，本轮只声明“连通测试在主导航显示为兼容项”。

### 6.3 数据接入 / 启用表范围

- 路由：`/connections/whitelist`
- 页面元素保持；`Schema` 术语与 Manifest 状态由 `25-connection-module-terminology-ia-refresh-spec.md` 决定。
- 本轮变更：
  - PageHeader `title` 由 `表白名单` 改为 `启用表范围`；
  - PageHeader `breadcrumbs` 由 `["数据库接入", "表白名单"]` 改为 `["数据接入", "启用表范围"]`；
  - `Schema 筛选` 标签保持；空态文案由 `M25` 决定。
- 浏览器翻译防御：维持现有。

### 6.4 数据接入 / 连通测试（兼容项）

- 路由：`/connections/test`
- 页面元素保持；具体实现由 `25-connection-module-terminology-ia-refresh-spec.md` 决定。
- 本轮变更：
  - PageHeader `title` 保持 `连通测试`；
  - PageHeader `breadcrumbs` 由 `["数据库接入", "连通测试"]` 改为 `["数据接入", "连通测试"]`；
  - 描述区追加引导：`也可以在连接概览中对单个连接执行测试。`（与 M25 Task 4 Step 5 一致）；
  - 主导航保留 `(兼容)` 后缀，引导用户迁移到连接卡片 Drawer。
- 路由不删除；外部链接与既有 URL 继续可访问。

### 6.5 语义建模 / 表目录

- 路由：`/`
- 页面元素保持；由 `M14` 静态 Catalog、`M17` 上传 UX 决定。
- 本轮唯一变更：
  - PageHeader `breadcrumbs` 由 `["语义层维护", "表目录"]` 改为 `["语义建模", "表目录"]`；
  - 标题、描述、空态文案保持。

### 6.6 语义建模 / 业务 Wiki

- 路由：`/wiki`
- 页面元素保持；由 `13-business-wiki-ux-refactor.md` 与 `36-business-wiki-read-edit-workbench-spec.md` 决定。
- 本轮变更：
  - PageHeader `title` 由 `业务 Wiki 工作台` 收敛为 `业务 Wiki`（去副标题“工作台”后缀，但保留内部仍为工作台形态）；
  - 侧边栏二级文案由 `Wiki 文档` 改为 `业务 Wiki`；
  - 面包屑由 `["业务文档", "Wiki 文档"]` 改为 `["语义建模", "业务 Wiki"]`；
  - `36` spec 的 Read/Edit Mode 实现不受影响。

### 6.7 语义发布

- 路由：`/publish/workbench`、`/publish/history`
- 页面元素保持；由 `23-semantic-asset-publish-export-spec.md` 与 `35-semantic-publish-workbench-ia-spec.md` 决定。
- 本轮唯一变更：面包屑字符串同步。
  - `/publish/workbench` → `["语义发布", "发布工作台"]`；
  - `/publish/history` → `["语义发布", "发布记录"]`。
- 分组名未变（仍为 `语义发布`），不引入新术语。

### 6.8 质量评测 / 评测用例

- 路由：`/eval/cases`
- 页面元素保持；Eval 后台由 `05-task-list.md` 与 `14-agent-admin-enterprise-delivery-spec.md` 决定。
- 本轮变更：
  - PageHeader `title` 由 `Case 管理` 改为 `评测用例`；
  - PageHeader `breadcrumbs` 由 `["质量评测", "Case 管理"]` 改为 `["质量评测", "评测用例"]`；
  - 侧边栏二级文案同步；
  - 页面内部动作按钮（`新建 Case` 等）可继续使用 `Case` 英文术语作按钮文案，但不允许把 `Case` 作为菜单 / 标题 / 面包屑出现；`新建评测用例` 是建议的按钮文案。
- 新增 `Evaluation Case / 评测用例` 术语登记（见 §5.1）。

### 6.9 质量评测 / 运行历史

- 路由：`/eval/runs`
- 页面元素保持。
- 本轮唯一变更：面包屑 `["质量评测", "运行历史"]` 不变。
- 详情页 `Run #<id>` 面包屑保持 `["质量评测", "运行历史", "Run #<id>"]`。

### 6.10 质量评测 / 趋势监控

- 路由：`/eval/monitor`
- 页面元素保持。
- 本轮唯一变更：面包屑 `["质量评测", "趋势监控"]` 不变。

### 6.11 访问治理

- 路由：`/admin/agents`、`/admin/roles`、`/admin/audit`、`/admin/audit-sources`、`/admin/config-audit`
- 页面元素保持；后台业务规则由 `14-agent-admin-enterprise-delivery-spec.md`、`15-role-admin-spec.md` 决定。
- 本轮变更：
  - `Agent 实例` 二级文案不变；
  - `角色配置` → `角色权限`：PageHeader `title`、侧边栏二级文案、面包屑同步；
  - `数据源热力` → `数据热力`：PageHeader `title`、侧边栏二级文案、面包屑同步；
  - `配置变更` → `配置审计`：PageHeader `title`、侧边栏二级文案、面包屑同步；详情/字段层 `配置变更` 作为补充说法仍允许。
- 新增 `Role Permission / 角色权限`、`Data Heatmap / 数据热力`、`Config Audit / 配置审计` 术语登记（见 §5.1）。

### 6.12 旧主导航项的彻底收敛（v1.9.0 节点）

`连通测试（兼容）` 是过渡期兼容项，**必须在 v1.9.0 节点从主导航彻底下线**。

| 项 | 内容 |
|---|---|
| 触发条件 | M25"连接概览-卡片内测试 Drawer"上线并验证稳定 |
| 下线节点 | Lucy v1.9.0 |
| 兜底机制 | 配套工单必须挂 `M25 完成` 作为前置依赖；未达成则 v1.9.0 延期，不允许跳过 Drawer 验证而仓促下线 |
| 路由去留 | 路由 `/connections/test` 仍保留为兼容跳转页（直接渲染引导文案指向 `/connections`） |
| 术语标注 | 下线后 `连同测试` 仍保留在 §5.1 兼容说明与 §6.4 PageHeader，但主导航不再出现 |
| 后续审计 | 每次主导航重构须 grep `连通测试` 出现位置，若仅剩路由兼容页 + PageHeader 即视为彻底收敛 |

不允许出现：

- 把"v1.9+"作为软目标挂在 backlog。
- 在 v1.9.0 之前就提前移除主导航兼容项而 Drawer 尚未完成，导致用户失去测试入口。
- 在 v1.9.0 之后仍把 `连同测试（兼容）` 留在主导航造成长期遗留。

## 7. 功能与 API 影响

| API | 变更 | 说明 |
|---|---|---|
| 全部现有 API | 无 | 不修改 path、status code、payload |
| `GET /api/project` | 无 | 项目元信息不依赖侧边栏 |
| `GET /api/connections`、`GET /api/sources` | 无 | 不涉及 |
| `POST /api/connections/:connId/test` | 无 | 由 M25 决定 |
| `/api/eval/cases/*`、`/api/eval/runs/*` | 无 | 不涉及 |
| `/api/admin/audit*`、`/api/admin/audit-sources`、`/api/admin/config-audit` | 无 | 不涉及 |
| `/api/publish/workbench`、`/api/publish/history` | 无 | 不涉及 |

影响面：本 spec 仅涉及前端侧边栏组件与 PageHeader 文案，不修改任何后端代码或 API 行为。

## 8. 非目标

- 不重做 `系统概览` 内容（由 `19-system-overview-runtime-monitoring-spec.md` 决定）。
- 不重做连通测试 Drawer（由 `25-connection-module-terminology-ia-refresh-spec.md` 决定）。
- 不重做 Wiki 工作台（由 `13-business-wiki-ux-refactor.md` / `36-business-wiki-read-edit-workbench-spec.md` 决定）。
- 不重做发布工作台（由 `23-semantic-asset-publish-export-spec.md` / `35-semantic-publish-workbench-ia-spec.md` 决定）。
- 不重做评测后台（由 `05-task-list.md` 决定）。
- 不重做访问治理后台（由 `14-agent-admin-enterprise-delivery-spec.md` / `15-role-admin-spec.md` 决定）。
- 不引入新依赖、不引入新 CSS 类名。
- 不删除任何路由。
- 不修改 `access.yaml`、`ktx.yaml`、MCP proxy、`data-qa-instructions.md` 等治理类文件。
- 不修改 Lucy MCP Proxy `initialize` instructions 注入。

## 9. 验收标准

### 9.1 P0 侧边栏结构验收

- 侧边栏包含 1 个置顶独立项 `系统概览` + 5 个核心分组：`数据接入 / 语义建模 / 语义发布 / 质量评测 / 访问治理`。
- 侧边栏不再出现分组标题 `运行状态` / `语义层维护` / `业务文档` / `数据库接入`。
- 5 个核心分组均含 ≥2 个二级项；`系统概览` 单独成 Section。
- 旧主导航文案（`表白名单` / `Wiki 文档` / `Case 管理` / `角色配置` / `数据源热力` / `配置变更`）不再作为侧边栏二级标题出现。
- `连同测试` 在主导航中以 `连通测试（兼容）` 形式出现，文案带 `（兼容）` 后缀。

### 9.2 P0 页面 / 面包屑验收

- 所有 PageHeader 的 `breadcrumbs` 与 §4.5 表完全一致。
- 9 个改名页面的 PageHeader `title` 与 §6 对应小节一致：
  - `表白名单` → `启用表范围`
  - `Wiki 文档` → `业务 Wiki`
  - `Case 管理` → `评测用例`
  - `角色配置` → `角色权限`
  - `数据源热力` → `数据热力`
  - `配置变更` → `配置审计`
- 用户手册 `webui/docs/user-guide.html` 左侧目录与首页截图与新侧边栏一致。

### 9.3 P0 术语验收

- §5.2 `sidebarForbiddenTerms` 列表中所有字符串不出现在以下位置的渲染结果中：
  - 侧边栏导航
  - 任意页面的 `PageHeader` 标题
  - 任意页面的 `PageHeader` 面包屑
- `00-product-terminology-standard.md` 的修订随本 spec 一并提交，§5.1 表中的 6 个新术语已加入 §3 全局固定术语表或对应模块分区。
- 已为 `表白名单` / `Wiki 文档` / `Case 管理` / `角色配置` / `数据源热力` / `配置变更` 在新结构中已被替代的二级位置增加 Vitest 回归断言。

### 9.4 P1 兼容性验收

- 16 个旧主导航项对应的路由全部可访问，包括 `/connections/test`。
- 外部链接、既有 URL、浏览器书签继续生效。
- 既有测试在更新断言后通过（不出现因路由失效导致的 FAIL）。

### 9.5 技术验收

```bash
cd /Users/zhangxingchen/Projects/project-lucy/webui
npm test -- --run \
  src/__tests__/app-shell.test.tsx \
  src/__tests__/connection-overview.test.tsx \
  src/__tests__/table-whitelist.test.tsx \
  src/__tests__/connection-test.test.tsx \
  src/__tests__/wiki.test.tsx \
  src/__tests__/eval-cases.test.tsx \
  src/__tests__/admin-agents.test.tsx \
  src/__tests__/admin-roles.test.tsx \
  src/__tests__/admin-audit.test.tsx \
  src/__tests__/admin-audit-sources.test.tsx \
  src/__tests__/admin-config-audit.test.tsx
npm test -- --run
npx tsc --noEmit
npm run build
```

Vite chunk-size warning 如与本任务无关可接受。

### 9.6 文档审阅

- `00-product-terminology-standard.md` 已更新（§3 / §4.1 / §4.2 / §4.4 / §4.5）。
- `06-navigation-ia.md` 中"全局导航结构"小节与 §4.1 表保持一致。
- `webui/docs/user-guide.html` 已替换截图与目录。
- `webui/docs/05-task-list.md` 无须更新（本轮不涉及里程碑新增）。

## 10. 关联与风险

### 10.1 关联

- 治理：`00-product-terminology-standard.md` 必须同步修订。
- 上游规范：`06-navigation-ia.md` 需刷新"全局导航结构"小节。
- 下游规范：`19`、`25`、`26`、`14`、`15`、`35`、`36` spec 中 `breadcrumbs` 字符串如硬编码，需要在本 spec 落地时同步更新。
- 用户手册：`webui/docs/user-guide.html`。

### 10.2 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| 旧主导航项名称在外部文档 / 培训资料残留 | 中 | 在 `06-navigation-ia.md` 中显式列出“旧名 → 新名”映射；附 FAQ |
| 改名后 `breadcrumbs` 硬编码字符串散落多文件，遗漏 | 高 | plan 中 `Task 7` 增加聚焦 grep 检查；`app-shell.test.tsx` 增加每个页面的 breadcrumb 断言 |
| `配置变更` 在详情 / 字段层被误改 | 中 | §5.2 明确禁止范围限于“主导航 / PageHeader 标题”；plan Task 5 仅替换这些位置 |
| `00-product-terminology-standard.md` 修订与本 spec 状态不同步 | 中 | spec 提交时附 §3 / §4 修订 PR；plan Task 6 落地 |
| `系统概览` 置顶后视觉与现有 pl-sidebar 风格不一致 | 低 | §4.3 强制使用现有 CSS 类，仅增加顶部 border 与间距 |
| `连同测试（兼容）` 长期留存造成主导航冗余 | 低 | §6.12 登记后续 v1.9+ 移除计划；保留路由兼容 |
