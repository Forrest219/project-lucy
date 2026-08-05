# Role Admin List and Detail IA Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin List and Detail IA Spec |
| 文档类型 | Spec |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-05 |
| 撰写人 | Composer |
| 委托人 | zhangxingchen |
| 基于材料 | 浏览器核查 `/admin/roles`、`/admin/roles/new` vs `/admin/agents`；UI/UX 反馈 2026-08-05；`webui/docs/88-agent-admin-list-ia-terminology-and-table-grid-spec.md`；`webui/docs/59-role-admin-ops-ux-clarification-spec.md`；`RoleList.tsx` / `RoleDetail.tsx` |
| 适用范围 | `/admin/roles` 列表页 PageHeader、KPI；`/admin/roles/new` 与 `/admin/roles/:roleId` 详情 Tab IA |
| 输出位置 | `webui/docs/89-role-admin-list-and-detail-ia-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 89 |
| 关联工单 | `webui/docs/plans/wo-202608-21-role-admin-list-and-detail-ia.md` |
| 关联页面 | `/admin/roles`、`/admin/roles/new`、`/admin/roles/:roleId` |
| 关联台账 | `docs/ui-ux-feedback/pages/admin-agents.md`（`UX-ADMIN-AGENTS-027`～`030`） |
| 上游 Spec | Spec 76 / 77 / 88（Role 列表与 Agent 列表 KPI 风格）；Spec 59（正式 Role 运维心智） |
| 状态 | Implemented |
| 日期 | 2026-08-05 |
| 范围 | 列表页描述与静态 KPI；详情 Tab 拆分基本信息 / 权限配置 / 生效边界；新建隐藏使用情况 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.0 | 初稿并落地 |

## 1. 背景

2026-08-05 浏览器核查确认 `/admin/roles` 与 `/admin/roles/new` 存在四类 IA 问题：

1. PageHeader 描述暴露 `access.yaml` 实现细节，与同组「访问治理」页面（使用概况、Agent、访问日志）的「管理/查看 + 用户动作」模式不一致。
2. 顶部四 KPI 为可点击筛选按钮，且「待修复」卡片在 count=0 时仍使用 danger 高亮；`/admin/agents` 已改为静态概览卡片。
3. 新建 Role 页展示「使用情况」「权限预览」空 Tab，无业务对象可展示。
4. 连接 / MCP 工具 / 表范围编辑区落在「基本配置」，而「权限预览」Tab 仅展示保存后的只读生效边界，Tab 命名与职责颠倒。

## 2. 目标

1. **列表 PageHeader**：描述改为管理动作 + 权限对象，不提及 `access.yaml`。
2. **列表 KPI**：四张静态卡片（对齐 Agent 列表），口径为 Role 生命周期；「解析异常」不做 danger 高亮；钻取下沉到 filterbar 下拉（保留「待修复」选项）。
3. **详情 Tab IA**：拆分 `基本信息` / `权限配置` / `生效边界`；新建与复制流程不展示「使用情况」与「生效边界」空 Tab。
4. **术语分工**：KPI 用「解析异常」；列表 badge 与筛选下拉继续用「待修复」（术语表 §Needs Repair Role）。

## 3. 非目标

- 不改 `GET /api/admin/roles` / Role 写 API 契约。
- 不改 Role 列表卡片布局或能力筛选逻辑（Spec 77 Wave B）。
- 不在生效边界 Tab 增加 dry-run 前实时解析（仍须保存或 preview 后才有 `effectivePermissions`）。
- 不做浏览器复核 / 移动窄屏。

## 4. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md`。

| 场景 | 用语 |
|---|---|
| KPI 计数 | 解析异常 |
| 列表 badge / 筛选下拉 | 待修复 |
| Tab：编辑区 | 权限配置 |
| Tab：只读解析结果 | 生效边界 |

Protected terms（`notranslate`）：`Agent`、`MCP`、`Role`、role id、connection id、tool name。

## 5. UI 变更

### 5.1 `/admin/roles` PageHeader

| 项 | 调整后 |
|---|---|
| title | 角色权限（不变） |
| description | 管理每个 Role 的连接、表范围与 MCP 工具授权。 |
| actions | 新建 Role（不变） |

### 5.2 `/admin/roles` KPI 网格（`data-testid="role-metric-grid"`）

静态 `div.pl-metric-card`，**不可点击**，无 `pl-metric-card--danger`。

| testId | label | hint |
|---|---|---|
| `metric-role-count` | Role 总数 | access.yaml 中的正式 Role |
| `metric-in-use` | 使用中 | 至少 1 个 Agent 引用 |
| `metric-unused` | 未引用 | 正式 Role 暂无 Agent 绑定 |
| `metric-invalid` | 解析异常 | 正式 Role 权限解析失败 |

当 `needsRepairCount > 0` 时，KPI 网格下方显示普通 inline notice（`data-testid="role-invalid-notice"`），引导使用筛选「待修复」。

筛选下拉保留：`全部正式 Role` / `使用中` / `待修复` / `未引用` / `参考模板`。

### 5.3 Role 详情 Tab（按 mode）

| mode | Tab 集合 |
|---|---|
| create / copy | 基本信息 · 权限配置 · 变更预览 |
| edit（正式 Role） | 基本信息 · 权限配置 · 生效边界 · 使用情况 · 变更预览 |
| edit（参考模板，只读） | 基本信息 · 生效边界 · 使用情况 |
| delete | 使用情况 · 变更预览 |

#### Tab 职责

| Tab | 内容 |
|---|---|
| 基本信息 | 角色标识、说明 |
| 权限配置 | 允许的连接、允许的 MCP 工具、可访问的表范围 |
| 生效边界 | `effectivePermissions` 只读：工具、连接、解析 Source；invalid 时展示诊断 |
| 使用情况 | 引用该 Role 的 Agent 列表（仅已保存 Role） |
| 变更预览 | dryRun diff（与现逻辑一致） |

新建 / 复制默认 Tab：`基本信息`。dirty bar 在 `基本信息` 或 `权限配置` 且有未保存修改时显示。

### 5.4 详情 PageHeader 描述（create / edit）

去掉「须确认 access.yaml 变更 diff」；改为「保存前须在变更预览中确认 diff」或等价用户动作表述。

## 6. 验收

- [ ] `/admin/roles` KPI 为静态四卡，含「解析异常」，无 danger 样式。
- [ ] 筛选「待修复」仍可列出 invalid 正式 Role。
- [ ] `/admin/roles/new` 无「使用情况」「生效边界」Tab；权限字段在「权限配置」。
- [ ] 已保存 Role 详情「生效边界」可查看工具与 Source。
- [ ] `npm test`（role-list / role-detail）、`npm run lint:terminology`、`npm run build` 通过。
