# Agent 角色多选

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent 角色多选 |
| 文档类型 | Product / API / UX Spec |
| Spec 编号 | 168 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | `/admin/agents`、新建 Agent、`/admin/agents/:userId`、Admin 写入与读取、角色引用、治理用量、发布包、MCP 调试台链接、Skill 受众计数 |
| 关联工单 | `webui/docs/plans/wo-202610-20-agent-role-set-admin.md` |
| 上游 | Spec 14 §5.2 / §5.4、Spec 98 能力合成、Spec 100 强制约束 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 管理台用复选框绑定多个角色。写入只落 `roles[]`。读取、门禁和引用计数复用既有 Role Set 解析 |

## 1. 问题

运行时已经把 `roles: [a, b]` 合成数据能力，并把单独的 `role: x` 看成只有一个角色。两者同时存在则拒绝解析。

管理台只提供一个下拉框，创建和更新也只写 `role`。磁盘上若已有 `roles`，再保存一次会把 `role` 叠加上去，Agent 在运行时变成 fail-closed。列表、角色引用、治理用量、发布包和 MCP 调试台链接只看 `user.role`，看不见 `roles[]` 里的 Agent。

## 2. 目标

1. 新建和详情页的「角色」是复选框，至少选 1 个正式角色。
2. Admin 创建和更新接受 `roles`。只传旧字段 `role` 时当成单元素数组。两者都传则拒绝。
3. 落盘只保留 `roles`，并删除 `role`。不批量改写未保存的 Agent。
4. 数据能力预览和治理门禁复用 Spec 98 的合成器。页面不自行把工具并集和数据源并集相乘。
5. 角色引用、治理用量、发布包、MCP 调试台和 Skill 受众使用同一解析。

## 3. 非目标

- 不改 Spec 98 的能力合成，也不改「多角色不会自动对人级行集做 AND」。
- 不把尚未打开保存的 Agent 从 `role` 迁移成 `roles`。
- 不把参考模板直接绑到 Agent。
- 页面文案不新增「Role Set」标签，仍称「角色」。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 14：新建和详情应是 Role Set 多选，但实现仍是单选 `role` | 以本节的读写和复选框为准 |
| `03-api-spec.md`：创建必须传 `agent.role`，更新只允许 `role` | 创建和更新以 `roles` 为准；`role` 只作为单元素兼容输入 |
| Spec 129：Agent 不得绑定参考模板 | 保持。集合里任一参考模板都拒绝 |

## 核心流程（伪代码）

```text
read(user):
  ids = resolveRoleIds(user)
  if ids failed:
    return roles=[], roleResolutionError, declaredRole, declaredRoles
  return roles=ids
  if ids.length == 1: also return role=ids[0]

write(body, existing):
  if body has role and roles: reject ROLE_AND_ROLES
  if body has neither: leave existing role and roles unchanged
  ids = body.roles if present else [body.role]
  dedupe ids
  if ids is empty:
    if existing has legacy allow: delete role and roles, keep allow
    else reject ROLE_REQUIRED
  for each id:
    reject unknown, reference template, or invalid role
  ids = formal catalog order
  delete user.role
  user.roles = ids
  delete user.allow
  permissions = previewAgentPermissionsForAdmin(user)
  if permissions failed: reject before write
  gate sources = permissions.sources
```

`resolveRoleIds` 的失败分支保持现状：`role` 与非空 `roles` 同时存在时原因是 `role_resolution_failed:role_and_roles`。这种 Agent 的保存必须带上一份干净的 `roles`，不得由服务端挑一边。

正式角色目录顺序是 `access.yaml` 里带 `allow` 的角色键顺序。请求里的重复项先去掉，再按这个顺序落盘。

只改显示名、备注、启用状态或强制约束时，不改动已有的 `role` / `roles` 键。因此只改显示名不会把已有 `roles` 写成 `role`，也不会修好磁盘上的双声明。

启用仍带 wildcard `allow`、且解析后没有角色的 Agent，继续拒绝，错误码 `LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`。

## 5. API

`GET /api/admin/agents` 与 `GET /api/admin/agents/:userId` 的 Agent 对象：

- `roles: string[]` 始终存在。解析失败时为 `[]`。
- `role` 仅在恰好一个角色时出现，值等于 `roles[0]`。
- 解析失败时增加 `roleResolutionError`，并带回 `declaredRole` / `declaredRoles`。

`POST /api/admin/agents` 的 `agent` 与 `PATCH` 的 `patch`：

- `roles: string[]` 为正式字段。
- `role: string` 仅当没有 `roles` 时接受，展开为单元素数组。
- 同时出现：`400 ROLE_AND_ROLES`。
- 空集合且没有旧 ACL `allow`：`400 ROLE_REQUIRED`。
- 未知或无效：`400 INVALID_ROLE`。
- 参考模板：`400 REFERENCE_TEMPLATE_NOT_ASSIGNABLE`。
- `roles` 不是字符串数组，或 `role` 不是非空字符串：`400 BAD_REQUEST`。

创建和角色变更的 dryRun 返回 `effectivePermissions`，其中 `roleIds` 与 `capabilities` 来自合成器。治理门禁的新旧数据源也来自这次合成，不再只看单个 `role`。

## 6. 页面

详情页和新建弹窗把「角色」做成复选框，控件类名复用业务 Skill 的角色多选。每个角色标识使用 `notranslate`。

- `data-testid="agent-role-field"` 包住复选框。
- 每个选项 `data-testid="agent-role-option"`。
- 无效角色显示「待修复」。未选中时不可勾选。已经绑上的可以取消，取消后不可再勾。只要选中项里还有无效角色，就不能保存。
- 当前绑定但不在正式列表中的标识仍然显示，文案带「当前绑定（已失效）」。去掉它并另选有效角色后可以保存。
- 未选满 1 个时不能保存。唯一例外是尚未绑定角色、只剩旧 ACL 的 Agent，可以继续不选。
- 勾选变化后，`data-testid="agent-role-capability"` 只展示 dryRun 返回的 `roleIds` 和能力元组。加载中写「正在计算数据能力」。

列表的角色列列出全部角色链接。恰好一个时使用 `agent-role-link-${agent.id}`；多于一个时每个链接使用 `agent-role-link-${agent.id}-${roleId}`。筛选「未绑定」表示解析结果为空；其他选项命中集合中的任一项。

权限预览的「当前角色」列出全部角色标识。变更摘要的「角色」写集合，不写单个 `role`。

可见文案继续用「角色」「待修复」「旧 ACL」「数据能力」。

## 7. 引用面

下列读取改为 `resolveRoleIds`。解析失败的 Agent 不计入任何角色：

- 角色详情的引用计数和使用者列表
- 治理概览的角色用量；Agent 行增加 `roleIds`，`roleId` 仅在恰好一个角色时保留
- 发布包的角色用量，以及 Agent 表的角色列
- MCP 调试台响应里的 `roleIds`
- Skill 授权变更统计里的受影响 Agent 数
- Token 清单上的 Agent 角色

## 8. 验收

- SC-1 创建两个角色后，YAML 只有 `roles`，没有 `role`。
- SC-2 单角色改为两个，再改回一个，两次都删除另一个键。
- SC-3 只改显示名时，已有 `roles` 的 Agent 不会被写上 `role`。
- SC-4 空集合、参考模板、无效角色、请求里同时带 `role` 和 `roles`，各自被拒绝。
- SC-5 磁盘上双声明时，GET 带 `roleResolutionError`；提交干净的 `roles` 后恢复，并且不再同时保留两个键。
- SC-6 dryRun 的 `effectivePermissions.roleIds` 与能力元组来自服务端。页面能力卡不展示客户端叉乘出的工具。
- SC-7 加上第二个角色后，治理门禁看到的数据源包含两个角色的源。
- SC-8 角色引用、治理用量、发布包、MCP 调试台 `roleIds` 能看见只写在 `roles[]` 里的 Agent。
- SC-9 详情页是复选框，至少选 1 个才能保存；列表可显示多个角色链接；筛选命中任一角色。
- SC-10 现有多角色运行时用例保持通过。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

UI 主术语继续使用「角色」。Role Set、`roles[]` 只出现在 API 和 Spec 中。角色标识保持 `notranslate`。

## Design System Compliance

复用 `webui/docs/design-system` 里已有的表单密度和业务 Skill 角色多选（`pl-skill-role-field`、`pl-skill-role-options`）。不新增按钮层级、颜色或网格。
