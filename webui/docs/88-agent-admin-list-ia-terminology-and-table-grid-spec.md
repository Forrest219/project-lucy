# Agent Admin List IA, Terminology and Table Grid Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin List IA, Terminology and Table Grid Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/agents` vs `/admin/usage`；UI/UX 反馈 2026-08-05；`webui/docs/00-product-terminology-standard.md` §4.5；`webui/docs/design-system/11-components-data-grid.md`；`webui/docs/82-admin-usage-overview-table-grid-light-conformance-spec.md`；`AgentList.tsx` |
| 适用范围 | `/admin/agents` 列表页命名、PageHeader、KPI、列表形态与行操作收敛 |
| 输出位置 | `webui/docs/88-agent-admin-list-ia-terminology-and-table-grid-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 88 |
| 关联工单 | `webui/docs/plans/wo-202608-20-agent-admin-list-ia-terminology-and-table-grid.md` |
| 关联页面 | `/admin/agents` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-022`～`026`） |
| 上游 Spec | Spec 78 / 84 / 86（使用概况 KPI 命名）；Spec 82（`pl-data-grid` 轻量遵从）；Spec 42（PageHeader badges ≤4 / 根页无重复 badge） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 侧栏/H1 改「Agent」；删 PageHeader count badges；KPI 对齐 usage；列表改 `pl-data-grid` 表；删行内「复制 MCP 配置」 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

2026-08-05 浏览器核查确认 `/admin/agents` 存在五类问题：

1. 「Agent 实例」与用户心智（管理 Demo Agent 等访问身份）不匹配，且副标题重复「实例」。
2. PageHeader `3 个 Agent / N 已启用 / N 配置 Token` 与下方 KPI 重复，且 `/admin/usage`、`/admin/roles` 等访问治理页已不采用此类 count badge。
3. 顶部四 KPI 命名与 `/admin/usage`（术语 §4.5）不一致。
4. 每行「复制 MCP 配置」复制同一份 endpoint 安全模板，与系统概览重复。
5. 整行卡片 `justify-between` 导致宽屏中间大面积空白。

## 2. 目标

1. 侧栏二级项、`PageHeader` H1、面包屑、返回链统一为 **Agent**（弃用「Agent 实例」作主标签）。
2. 删除 PageHeader count badges；`actions` 仅保留 `新建 Agent`（`pl-btn--primary`），与 `角色权限` 页对齐。
3. 四 KPI 命名与 hint 对齐使用概况（固定近 7 天窗口）：
   - `Agent 总数` / `已配置实例（含未启用）`
   - `近 7 天活跃 Token`（副行 hint 说明去重口径）
   - `近 7 天调用量` / `MCP 调用`
   - `近 7 天拒绝` / `access_log outcome=denied`（本页运维向，usage 无对应卡）
4. 列表改为 `pl-data-grid` 轻量表格（中改），列对齐 usage 语义；行操作：`查看详情`、`编辑`、`查看权限`、`查看日志`；**不得**再出现行内「复制 MCP 配置」。
5. 移除列表页 MCP endpoint 诊断条（复制入口移除后无页面级 copy 动作）；接入配置保留在系统概览与 Agent 详情 / Token 生成流程。

## 3. 非目标

- 不改 `GET /api/admin/agents` 契约。
- 不在本页新增 24h/7d 窗口切换（固定近 7 天，与当前 stats 字段一致）。
- 不改 Agent 详情、New Token、新建 Agent Modal 业务流程（除返回链文案）。
- 不做浏览器复核 / 移动窄屏。

## 4. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`。

New terms:

- Agent Admin Page Title: UI 主术语为 **Agent**（侧栏与 H1），弃用「Agent 实例」作主标签。

Forbidden terms:

- `Agent 实例`（侧栏、H1、面包屑、返回链主文案）
- 行内 `复制 MCP 配置`（列表页）

Protected terms（DOM 需 `translate="no"` + `notranslate`）：`Agent`、`Token`、`MCP`、role id、Agent id。

## 5. Design System Compliance

- 引用：`11-components-data-grid.md`；`10-components-button.md`（`新建 Agent` 为页级唯一 primary）。
- 表格：`pl-data-grid pl-data-table pl-agent-list-table`；12px 密度；数量列 `tabular-nums`；操作列 `pl-row-action-link`。
- 不引入 connections 工作台 `colgroup` 全套。

## 6. UI 变更

### 6.1 PageHeader

| 项 | 调整后 |
|---|---|
| title | `Agent`（`Agent` 节点 `notranslate`） |
| description | 管理 <Agent> 的角色、Token 与数据访问边界。 |
| badges | **删除** |
| actions | `新建 Agent` |

### 6.2 KPI 网格（`data-testid="agent-metric-grid"`）

| testId | label | hint |
|---|---|---|
| `metric-agent-count` | Agent 总数 | 已配置实例（含未启用） |
| `metric-active-token-count` | 近 7 天活跃 Token | 访问日志中去重 token |
| `metric-calls` | 近 7 天调用量 | MCP 调用 |
| `metric-denied-last-7d` | 近 7 天拒绝 | access_log outcome=denied |

### 6.3 列表表（`data-testid="agent-list-table"`）

| 列 | 说明 |
|---|---|
| Agent | 显示名 + id 次行 + 启用/禁用 badge |
| 角色 | 链到 `/admin/roles/:roleId`；legacy 显示「旧 ACL」 |
| 最近访问 | `formatLastSeen` |
| 近 7 天调用量 | 数字，`pl-agent-list-table-num` |
| 近 7 天活跃 Token | 数字 |
| 配置 Token | 数字 |
| 近 7 天拒绝 | 数字；>0 时 warning 色 |
| 操作 | 查看详情 / 编辑 / 查看权限 / 查看日志 |

行 `data-testid="agent-row-{id}"`。

### 6.4 同步文案触点

- `navigation.ts` 侧栏 label
- `breadcrumbs.ts`
- `AgentDetail.tsx` / `NewToken.tsx` 返回链：`‹ 返回 Agent`
- `Onboarding.tsx` Drawer：`查看 Agent ↗`（去掉「实例」）
- `server/help.ts` 侧栏映射

## 7. Acceptance Criteria

- [ ] H1 与侧栏为 `Agent`，无 `Agent 实例` 主标签。
- [ ] PageHeader 无 count badges；有 `新建 Agent` primary。
- [ ] KPI 四卡命名符合 §6.2；无 `Agent 数` / 裸 `活跃 Token` / `近 7 天调用`（无「量」）。
- [ ] 列表为 `pl-data-grid` 表；无 `agent-card-*`；无行内复制 MCP。
- [ ] `npm test -- src/__tests__/agent-list.test.tsx` 通过。
- [ ] `npm run lint:terminology` 与 `npm run build` 通过。

## 8. Cross-References

- 修订 `webui/docs/06-navigation-ia.md` 中 Agent 列表命名。
- 术语标准 §4.5 补充 Agent Admin Page Title。
