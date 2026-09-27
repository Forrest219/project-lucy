# Role List P0/P1 Remediation Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role List P0/P1 Remediation Spec |
| 文档类型 | Spec |
| Spec 编号 | 154 |
| 版本 | v1.0 |
| 日期 | 2026-09-27 |
| 状态 | Implemented |
| 关联页面 | `/admin/roles`、Role 快捷详情 Drawer |
| 关联工单 | `webui/docs/plans/wo-202609-27-role-list-p0-p1-remediation.md` |
| 上游 Spec | Spec 76、Spec 89、Spec 103、Spec 135 |

## 1. 背景与优先级

`/admin/roles` 同时存在三个影响治理效率的问题：Role 快捷详情将已解包的 API 数据再次按 `{ role }` 读取，导致成功响应触发运行时异常并使页面白屏；Data Grid 后又渲染一份 Role 卡片集合；五个筛选控件长期平铺，主任务与低频权限维度混杂。

本 Spec 的优先级为：

1. **P0**：快捷详情对真实 API 响应安全渲染，异常数据只降级 Drawer，不影响列表页。
2. **P1**：Data Grid 成为唯一列表集合，移除重复卡片和重复预览入口。
3. **P1**：常驻筛选只保留搜索与状态，连接、MCP 工具、表名按需展开。

## 2. 规范关系

- 本 Spec **取代 Spec 76 §7.4 的 Role Card 列表呈现要求**；Spec 76 的状态口径、字段含义、复制动作、配置写入时间仍有效，并由 Data Grid 承载。
- 本 Spec **修订 Spec 89 §3「不改 Role 列表卡片布局」的非目标**：列表不再保留卡片集合；Spec 89 的 PageHeader、静态 KPI 与详情页 Tab IA 保持有效。
- 本 Spec **保留 Spec 103 的四张静态 KPI**、共享 `MetricCard`、帮助说明与中性 tone 纪律。
- 高级筛选交互复用 Spec 135 的访问日志页模式，不新增共享组件。

## 3. 范围与非目标

### 3.1 范围

- `ObjectDetailDrawer.tsx` 的 Role 查询契约、运行时校验、错误态与权限诊断。
- `RoleList.tsx` 的唯一 Data Grid、行内操作、筛选区、筛选摘要与空结果恢复。
- 对应组件测试与稳定测试选择器。

### 3.2 非目标

- 不修改服务端 API、Role 配置 Schema、权限裁决或 KTX。
- 不修改四张 KPI、表格列、新建页、编辑页与右侧生效边界摘要。
- 不新增依赖，不同步筛选条件到 URL。
- 不执行浏览器、E2E 或移动窄屏专项验证。

## 4. Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`，不新增产品概念。

- UI 继续使用「全部正式 Role / 使用中 / 待修复 / 未引用 / 参考模板」状态口径。
- `Role`、`Agent`、`MCP`、Role 标识、connection 标识与工具名继续使用 `notranslate` 与 `translate="no"` 保护。
- 用户可见诊断使用中文；原始 warning 仅放入「技术详情」，不得直接替代用户说明。
- `invalid` 不得翻译为「已停用」或「禁用」。

## 5. Design System Compliance

- 页面结构复用 `design-system/20-patterns-page-layout.md` 的 Page Layout。
- 列表复用 `design-system/11-components-data-grid.md`，`role-list-table` 是唯一 Role 集合容器。
- 四张 KPI 继续复用 `design-system/12-components-metric-card.md` 和共享 `MetricCard`。
- 按钮复用 `design-system/10-components-button.md`；高级筛选采用访问日志页既有的折叠模式。
- 不通过 CSS 隐藏重复内容；旧卡片节点和容器从 React 树中删除。

## 6. P0：Role 快捷详情契约

`apiGet()` 已返回 API envelope 的 `data`，因此 `GET /api/admin/roles/:roleId` 查询结果直接视为 `RoleDetailType`，禁止再次读取 `.role`。

Drawer 在渲染业务字段前至少校验：

- 响应为对象；
- `id` 为字符串；
- `connections`、`tools`、`warnings` 为数组。

校验失败时渲染可关闭、可重试的 Drawer 错误态，不抛出渲染异常。404 保持「Role 不存在」，请求失败保持加载失败提示；关闭与「打开完整页面」行为不变。

Role warning 的呈现顺序为：用户可读诊断 → 「技术详情」原始 warning。原先重复卡片承载的诊断由 Drawer 唯一承载。

## 7. P1：唯一列表与操作

- Data Grid 是页面唯一 Role 集合；删除 `RoleCard`、`role-card` 与旧 `role-list` 卡片容器。
- 保留角色标识链接、状态、数据范围、MCP 工具计数、引用 Agent、配置写入时间和操作列。
- 点击角色标识打开快捷详情；「编辑/查看」进入完整页面。
- 更多菜单保留「基于此新建」和正式 Role 的「删除」；删除与标识链接重复的「快捷抽屉预览」。
- 使用中的正式 Role 删除操作保持禁用并显示原因。
- 稳定测试选择器为 `role-list-table` 和 `role-row-${roleId}`。

## 8. P1：筛选交互

第一行常驻：统一搜索、状态筛选、高级筛选按钮，以及有条件时的「清除筛选」。高级面板默认关闭，展开后即时提供连接、MCP 工具和表名筛选，不提供「应用」按钮。

高级按钮必须设置 `aria-expanded`、`aria-controls="role-advanced-filters"`；面板使用稳定 ID、`role="group"` 和「高级筛选」可访问名称。高级条件数按非空维度计数；面板收起后条件继续生效，摘要继续显示条件与结果数。

「清除筛选」一次恢复：空搜索、`formal` 状态、空连接/工具/表名，并关闭高级面板。数据存在但筛选无结果时，空态必须提供同一恢复动作。

## 9. 核心流程（伪代码）

```text
openRoleDrawer(roleId):
  payload = apiGet(/api/admin/roles/:roleId)
  if requestFailed: render request error
  else if roleNotFound: render not-found state
  else if !validRoleDetail(payload): render recoverable drawer error
  else render role permissions and warning diagnostics

toggleAdvancedFilters():
  advancedOpen = !advancedOpen
  keep current connection/tool/table values
  recompute rows immediately whenever any value changes

clearFilters():
  search = ""
  status = "formal"
  connection = tool = table = ""
  advancedOpen = false

renderFilteredEmptyState():
  if source dataset is empty: offer create-first Role
  else: explain the active filter mismatch and offer clearFilters()
```

## 10. 验收标准

- [x] 真实解包结构可渲染 Role 标识、连接、MCP 工具、生效数据源与引用 Agent。
- [x] malformed success payload 只显示 Drawer 错误态，页面不白屏。
- [x] warning 同时提供中文诊断与技术详情。
- [x] DOM 中不存在 `role-card`，Data Grid 保留所有既有业务字段与操作。
- [x] 高级筛选默认关闭，条件计数、折叠保留、摘要和一键清除有效。
- [x] 筛选无结果可一键恢复。
- [x] 组件测试、术语检查、IA 边界检查和构建作为交付门槛。
