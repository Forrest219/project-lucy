# Spec 150 — Role 权限配置结构化重构

| 元数据 | 内容 |
|---|---|
| 文档类型 | Product / UX / IA / Frontend Implementation Spec |
| 版本 | v1.0 |
| 日期 | 2026-09-26 |
| 适用页面 | `/admin/roles/new`、`/admin/roles/:roleId` |
| 现状证据 | `inbox/role-permission-ia-audit-20260926/role-permission-ia-audit.md` 及同目录截图 |
| 上游契约 | Spec 98 / 99 / 100 / 131；`docs/access-control/design-upgrade.md` |

## 1. 背景与裁决

现有 Role 详情把连接、表范围、高级扩权、MCP 工具和行级策略放在同一个「权限配置」长页面，要求管理员同时理解四种权限心智模型。生效摘要和 YAML diff 又各占一个一级页签，使主任务被技术实现结构切碎。

本 Spec 将 Role 权限编辑拆为三个纯粹编辑面：**可访问的表**、**允许的 MCP 工具**、**行级策略（可选）**。三个编辑面共享同一份草稿、脏状态和原子保存流程；「生效边界」改为实时摘要；「变更预览」改为保存前的「确认权限变更」Drawer。

本 Spec：

- 局部取代 Spec 133 的 RoleDetail 长工作台、权限页签与变更预览页签；
- 局部取代 `webui/docs/plans/wo-202609-23-role-permission-config-ia.md` T4–T7 的页面呈现；
- 不修改 Spec 98 / 99 / 100 / 131 的权限模型、运行时裁决、Agent Constraints 或 `catalog_bound` 契约；
- 不修改 `/api/admin/roles*`、`access.yaml`、Proxy 或 KTX 接口。

## 2. 目标与非目标

### 2.1 目标

1. 管理员一次只处理一个权限问题：哪些表、哪些工具、哪些表需要行级约束。
2. 任意切换编辑面时草稿不丢失、不保存；最终只做一次 dryRun 和一次正式写入。
3. 保存前先看结构化影响与风险，技术 YAML diff 默认折叠。
4. v2 UI 不再提供 prefix；旧 prefix Role 只允许迁移为明确表清单。
5. 保留旧 `?tab=permissions` 深链和既有 Role API 兼容性。

### 2.2 非目标

- 不改 Role 列表、Agent、Token 信息架构。
- 不增加动态行级权限、TokenScope、可复用策略模板或新 YAML 字段。
- 不改变 AbsoluteDeny、能力元组、行授予合成或运行时 fail-closed 语义。
- 不提供移动端布局；沿用项目桌面最小宽度策略。

## 3. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- **Confirm Permission Changes / 确认权限变更**：Role dryRun 成功后、正式写入前的结构化确认 Drawer。禁止使用「变更预览」作为一级页签。

沿用：角色权限、角色标识、可访问的表范围、允许的 MCP 工具、行级策略、启用目录绑定、正式 Role、参考模板。

`MCP`、`Schema`、`Agent`、`Role`、`YAML`、`catalog_bound`、工具 ID、数据库对象名和路径必须使用 `translate="no"` 与 `notranslate`。

## 4. 信息架构

| 模式 | 一级编辑面 | 行为 |
|---|---|---|
| 新建 / 复制 | 基本信息、可访问的表、允许的 MCP 工具、行级策略（可选） | 任意切换，无强制步骤 |
| 正式 Role 编辑 | 概览、可访问的表、允许的 MCP 工具、行级策略（可选）、使用情况 | 基本信息在概览编辑 |
| 参考模板 | 与正式 Role 一致 | 全部只读；仅「基于此模板创建 Role」 |
| 删除 | 概览中的危险次要动作 | dryRun 后打开删除影响确认 Drawer |

兼容映射：

- `?tab=permissions` → `tables`
- `?tab=effective` → `overview`
- `?tab=usage` 保持不变
- 未识别 tab → 当前模式首个合法编辑面

页面只有一个 Primary Workspace。≥1280px 时主编辑区与右侧生效摘要按 8/4 布局；1200px 时摘要置于主区顶部；更窄桌面允许横向滚动，不压缩为移动布局。底部共享脏状态栏只有一个主操作「保存权限配置」。

## 5. 产品行为

### 5.1 可访问的表

- 默认是连接 → Schema → 表的明确表树，支持搜索、Schema 全选/清除和已选表摘要。
- v2 新建与编辑不渲染 prefix 控件，序列化不得产生 prefix selector。
- 旧 prefix Role 使用当前 `effectivePermissions.sources` 展开；任何 selector 无法完整映射时进入迁移阻断，只读展示原因且禁止保存。
- 移除表时同步移除其行级策略，并在保存确认中列为权限收缩。
- 「启用目录绑定」位于本编辑面的高级设置。开启前确认清空明确表和行级策略；必须显式选择至少一个连接；关闭后回到空的明确表模式。

### 5.2 允许的 MCP 工具

- 默认展示预设和已选摘要；完整清单只在「自定义 MCP 工具」高级区显示。
- 「只读问答」「只读问答 + 知识库」是完整替换，不是并集。
- 新建 Role 不自动授予工具。
- AbsoluteDeny / `globalDenied` 工具不渲染为选项。旧配置中的拒绝工具在保存确认中标记「保存时将移除」。
- 行级策略与未包装读数工具同时存在时展示兼容性警告，但不自动取消工具。

### 5.3 行级策略

- 只列当前明确授权的表，状态为「全部行」或「已配置 N 条条件」。
- 点击表打开右侧 Drawer；取消不改共享草稿，点击「应用」才提交。
- 字段候选取自既有 `GET /api/sources/:conn/:schema/:table` 的 `model.columns`，不包含 measure。
- 仅允许 `eq` / `in`；UI 文案为「等于」/「属于」。取值去空、去重，且至少一个。
- 删除条件按钮的可访问名称包含表名和条件序号。
- `catalog_bound` 下禁用行级策略并解释原因。

### 5.4 实时生效摘要

所有编辑面显示同一草稿推导出的连接数、表数、工具数、限定行表数、扩权风险和受影响 Agent。正式 Role 可在折叠技术详情中继续查看服务器返回的 Data Capability Preview；新建/复制在保存前以草稿摘要为准，不声称已经生效。

### 5.5 确认权限变更

点击「保存权限配置」先执行本地校验和既有 dryRun。成功后 Drawer 按顺序展示：

1. 表、工具、行级策略、`catalog_bound` 的结构化变化；
2. 权限扩大、权限收缩、混合变化或未来自动扩展风险；
3. 受影响 Agent；
4. 保存时移除的拒绝工具和旧版迁移项；
5. 默认折叠的完整 YAML diff。

预览快照保存草稿 hash、payload、version 和 diff。任何草稿修改都会关闭并作废旧预览；正式保存必须使用同一快照的 payload/version。

## 6. 内部数据模型

```ts
type PermissionSection = "overview" | "tables" | "tools" | "rowPolicy" | "usage";

type RolePermissionDraft = {
  roleId: string;
  description: string;
  scope:
    | { mode: "names"; tables: TableGrant[] }
    | { mode: "catalog_bound"; connections: string[] };
  tools: string[];
};

type PermissionImpactSummary = {
  tablesAdded: TableKey[];
  tablesRemoved: TableKey[];
  toolsAdded: string[];
  toolsRemoved: string[];
  rowPoliciesChanged: TableKey[];
  rejectedToolsRemoved: string[];
  catalogBoundChange: "enabled" | "disabled" | null;
  risk: "expanded" | "contracted" | "mixed" | "unchanged";
  affectedAgents: RoleUserReference[];
};
```

## 7. 核心流程（伪代码）

```text
loadRole(mode, detail):
  rawBaseline = roleConfigFrom(detail)
  migration = expandLegacyPrefix(rawBaseline, detail.effectivePermissions.sources)
  if migration.incomplete:
    return readOnlyDraft + migrationBlocked

  draft = normalizeToV2Draft(rawBaseline, migration)
  rejected = partitionAbsoluteDeny(draft.tools)
  draft.tools = rejected.grantable
  dirty = mode == copy OR semanticHash(draft) != semanticHash(rawBaseline)
  return { baseline: rawBaseline, draft, dirty, rejected, preview: null }
```

```text
changeDraft(action):
  next = reducer(draft, action)
  if action removes table:
    remove that table's row policy
  preview = null
  dirty = mode == copy OR semanticHash(next) != semanticHash(baseline)
  impact = deriveImpact(baseline, next, rejectedTools, roleUsers)
```

```text
requestSave():
  errors = validateDraft(draft)
  if errors:
    navigate to first invalid section; focus first invalid control; stop

  payload = serializeV2Role(draft)
  dryRun = call existing create/copy/patch API with dryRun=true
  if dryRun rejected:
    keep draft; map error to section; stop

  preview = { draftHash, payload, version, diff, deriveImpact(...) }
  open Confirm Permission Changes Drawer
```

```text
confirmSave(preview):
  if semanticHash(draft) != preview.draftHash:
    close Drawer; show "配置已变化，请重新检查"; stop

  result = call formal API with exact preview.payload and preview.version
  if conflict OR rejected OR runtimeAck == false:
    retain draft and baseline; do not navigate; stop

  baseline = draft
  dirty = false
  invalidate role / agent / policy queries
  navigate to canonical Role URL
```

失败分支对应 SC-150-06、07、09、13、14、15；成功路径对应 SC-150-03、05、12、14。

## 8. Design System Compliance

- 遵循 `design-system/00-principles.md`：单一主任务区、渐进披露、默认 Calm UI。
- 遵循 `design-system/20-patterns-page-layout.md`：页内导航只切换同一对象任务；Drawer 承担次任务和保存确认。
- 遵循 `design-system/10-components-button.md`：每个视图只有一个 primary；删除是 danger 且仅在确认 Drawer 内升级。
- 复用既有 `pl-admin-tab*`、`pl-drawer-*`、`pl-floating-action-bar`、状态色与间距 token，不新增视觉原语。

## 9. Acceptance

| ID | 条件 |
|---|---|
| SC-150-01 | 各模式只显示规定编辑面，无权限/生效/diff 三大混合页签 |
| SC-150-02 | `?tab=permissions` 映射到可访问的表；usage/effective 兼容 |
| SC-150-03 | 编辑面共享草稿；切换不丢数据、不发保存请求 |
| SC-150-04 | 空白新建非 dirty；复制 dirty；模板只读 |
| SC-150-05 | 表推导连接；移除表同时移除行策略并进入收缩摘要 |
| SC-150-06 | v2 UI/序列化无 prefix；旧 prefix 确定性迁移，否则阻断 |
| SC-150-07 | `catalog_bound` 开关有确认、互斥清空和非空连接校验 |
| SC-150-08 | 预设替换；新建无默认工具；AbsoluteDeny 不可选 |
| SC-150-09 | 行策略仅物理列；`eq/in` 校验、去空和去重正确 |
| SC-150-10 | `catalog_bound` 禁用行策略 |
| SC-150-11 | 所有编辑面展示实时摘要、风险与受影响 Agent |
| SC-150-12 | 仅保存时打开结构化确认 Drawer；YAML diff 默认折叠 |
| SC-150-13 | 草稿变化使旧预览失效，旧 payload/version 不可提交 |
| SC-150-14 | dryRun → confirm → formal save；失败或 `runtimeAck=false` 保留草稿 |
| SC-150-15 | 删除走影响确认；被 Agent 引用和模板均不可删除 |
| SC-150-16 | Drawer 支持 Esc、焦点管理和唯一可访问名称 |
| SC-150-17 | 1440/1200 无遮挡；1024 可控横向滚动，不做移动布局 |
| SC-150-18 | 术语与翻译防御通过 lint |
| SC-150-19 | 既有 Role API、模型版本、row-policy、AbsoluteDeny parity 回归通过 |
