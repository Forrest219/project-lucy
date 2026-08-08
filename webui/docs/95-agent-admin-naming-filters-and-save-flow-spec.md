# Agent Admin Naming, Filters and Save Flow Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Naming, Filters and Save Flow Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Auto |
| 委托人 | zhangxingchen |
| 基于材料 | 2026-08-05 浏览器核查 `/admin/agents` 与 `/admin/agents/demo_agent`；`docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-034`～`036`）；Spec 93 |
| 适用范围 | Agent 列表命名统一、筛选器 label、低风险保存一步化 |
| 输出位置 | `webui/docs/95-agent-admin-naming-filters-and-save-flow-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 95 |
| 关联工单 | `webui/docs/plans/wo-202608-28-agent-admin-naming-filters-and-save-flow.md` |
| 关联页面 | `/admin/agents`、`/admin/agents/:userId` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-034`～`036`） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |

## 1. 背景

浏览器核查确认三类问题：

1. **命名不一致**：列表列 `Agent`、搜索 `Agent 名称 / 用户 ID`、详情 `用户 ID` + `显示名`、H1 混用 `(demo_agent)`。
2. **筛选器缺 label**：四个下拉无字段标题；「配置 Token 分层」区分度低。
3. **保存流程过重**：改启用状态需「预览并保存」→ 变更预览 Tab → 再点「保存」。

## 2. 目标

1. 统一「显示名 / 用户 ID」术语（列表、搜索、详情、新建）。
2. 筛选条对齐 `/catalog`：`label + 控件`；删除配置 Token 分层；补结果计数。
3. 低风险变更（显示名、备注、启用状态）一步保存；角色变更保留 diff 确认。

## 3. 非目标

- 不改 `access.yaml` 写入与 Governance Gate 逻辑。
- 不改权限预览 Tab 内容（禁用态文案另单）。
- 不做浏览器验证。

## 4. Terminology Compliance

| Canonical Term | UI 主术语 | 说明 |
|---|---|---|
| Agent Display Name | 显示名 | 详情可编辑字段、新建表单 |
| Agent User ID | 用户 ID | 技术标识；搜索、详情只读 |
| Agent List Identity Column | 显示名/用户 ID | 列表主列头（Spec 98）；双行单元格 |
| Agent List Search | 搜索显示名或用户 ID | 列表搜索 placeholder |

禁止：列表主列继续用 `Agent` 作列名；搜索用 `Agent 名称`；列表主列仅写「显示名」而忽略次行用户 ID。

## 5. UI 变更

### 5.1 列表

- 表头主列：`显示名/用户 ID`（Spec 98；次行仍展示 `用户 ID`）。
- 搜索 label `搜索`；placeholder `搜索显示名或用户 ID`。
- 筛选 label：`当前状态`、`角色`、`近 7 天活跃`。
- 删除「配置 Token」分层筛选。
- 右侧：`N 条结果`。

### 5.2 详情

- H1 仅 `显示名`；`用户 ID` 保留在基本信息区。
- 浮条主按钮：`保存`（替代「预览并保存」）。
- 低风险：`保存` = dryRun 校验后直接落盘（用户一次点击）。
- 高风险（`role` 变更）：Modal 展示 diff +「确认保存」。
- 次级：`查看变更 diff` → 变更预览 Tab（只读审计）。
- 变更预览 Tab 空态文案同步更新。

## 6. 验收标准

- [x] 列表主列为 `显示名/用户 ID`（Spec 98）；搜索 placeholder 为 `搜索显示名或用户 ID`。
- [x] 筛选器三个维度均有可见 label；无配置 Token 筛选。
- [x] 改启用状态后点一次 `保存` 即落盘（两次 PATCH：dryRun + write）。
- [x] 改角色后 `保存` 弹出 diff 确认，确认后落盘。
- [x] `agent-list.test.tsx`、`agent-detail.test.tsx` 通过；`lint:terminology`、`build` 通过。
