# Role Admin Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin Spec |
| 文档类型 | Product / UX / API Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-27 |
| 适用范围 | Lucy WebUI 访问治理模块：Role 列表、Role 新建/编辑/删除、Role preview、Agent 新建/编辑入口联动 |
| 事实源 | `webui/config/access.yaml` 的 `roles:` / `users[].role`、内置 role templates、Lucy MCP Proxy ACL resolver |
| 关联文档 | `webui/docs/07-mcp-auth-proxy-spec.md`、`webui/docs/14-agent-admin-enterprise-delivery-spec.md`、`docs/access-control/design-governance-baseline.md`、`docs/access-control/design-upgrade.md` |

## 1. 背景

M11 已把 Agent Admin 的交付链路补齐：新建 Agent 时必须选择 role，界面也能展示 role 的权限摘要。但当前 WebUI 没有独立的 Role 管理页面，管理员只能在 `webui/config/access.yaml` 中手写 `roles:`。这造成一个明显断点：

- Agent 新建弹窗要求选择“角色”。
- 角色决定 Agent 可访问的数据源和 MCP 工具。
- 但管理员没有 UI 入口创建、修改、复制或删除角色。

本 spec 定义 M12 Role Admin：把 role 从“只能手改 YAML 的权限块”产品化为 WebUI 内的可审计配置对象，同时保留现有 dryRun、diff、fail-closed 和 template 展开约束。

## 2. 目标

### 2.1 用户目标

- 管理员能在 WebUI 中查看当前所有 role。
- 管理员能创建或编辑 YAML role，而不需要直接手写 `access.yaml`。
- 管理员能从内置 template 复制出一个可编辑的 YAML role。
- 管理员能在保存前看到 role 对 `access.yaml` 的 YAML diff。
- 管理员能知道某个 role 被哪些 Agent user 引用，避免误删。

### 2.2 系统目标

- 继续以 `webui/config/access.yaml` 为唯一权限事实源。
- 复用 `previewRolePermissionsForAdmin` / ACL resolver，不新增第二套权限解析。
- 所有写入必须 dryRun-first。
- Role 解析失败时阻止保存，不能写入会让 runtime fail-closed 的配置。
- 内置 template 不作为第二事实源写入 `access.yaml`；复制 template 时必须展开为普通 YAML role。

## 3. 非目标

- 不实现多管理员 RBAC。
- 不实现 role rename 的原地语义；rename 视为新建新 role + 迁移 Agent 引用 + 删除旧 role。
- 不实现列级 / 行级权限。
- 不实现 token scope。未来 token scope 只能在 role 基础上做交集收窄，不能增权。
- 不实现 role 版本历史的单独模型；变更历史继续走 `config_change_log`。

## 4. 信息模型

### 4.1 YAML Role

```yaml
roles:
  poc_readonly:
    description: POC内测只读角色
    allow:
      connections:
        - poc-mysql-aliyun
      tableSelectors:
        - connection: poc-mysql-aliyun
          schema: data_agent_poc
          names:
            - poc_metric_catalog
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
```

字段语义：

- `description`：管理员可读说明。
- `allow.connections`：该 role 可访问的 connection id。只要 role 有 table selector 或数据访问工具，必须非空。
- `allow.tableSelectors`：授权 source 选择器。
  - `names`：精确列出 source name，生产敏感数据推荐。
  - `prefix`：前缀匹配 source name，适合开发或低敏探索角色。
- `allow.tools`：允许暴露给 Agent 的 MCP 工具，必须显式列名，不能是 `["*"]`。

### 4.2 Template Role

Template role 来自 `webui/server/admin/role-templates.ts`，通过 `GET /api/admin/roles` 和 YAML role 合并返回。

约束：

- Template role 不直接写入 `access.yaml`。
- Template role 在列表中只读展示，source 标记为 `template`。
- 用户点击“复制为 YAML Role”后，必须输入新的 role id，后端将 template 展开成普通 YAML role 写入 `roles.<newId>`。
- 落盘 YAML 中不得出现 `role-template`、`templateId`、`templateRef`、`_template` 等指针字段。

### 4.3 Role Usage

Role usage 来自 `users[].role` 引用：

```yaml
users:
  - id: poc_demo
    role: poc_readonly
```

UI 需要展示：

- 被引用次数。
- 引用该 role 的 Agent user id / name。
- 删除 role 时，如果 usage count > 0，必须阻止删除。

## 5. 页面设计

### 5.1 导航

在左侧导航“访问治理”下新增：

```text
角色配置 -> /admin/roles
```

导航顺序建议：

1. Agent 实例
2. 角色配置
3. 访问日志
4. 数据源热力
5. 配置变更

### 5.2 Role 列表页

入口：`/admin/roles`

页面结构：

- Header：`角色配置`
- 主 CTA：`新建 Role`
- 次 CTA：`从模板复制`
- 搜索：按 role id / description 搜索
- 筛选：全部 / YAML / Template / Invalid / In use
- Role 卡片或表格：
  - role id
  - source：`yaml` / `template`
  - description
  - source count
  - connections
  - tools count / tools chips
  - usage count
  - invalid warnings
  - actions

YAML role actions：

- `编辑`
- `复制`
- `删除`

Template role actions：

- `查看`
- `复制为 YAML Role`

Invalid role：

- 显示 warning。
- 可以编辑 YAML role 修复。
- 不能被 Agent 新建流选中保存。

### 5.3 Role 详情 / 编辑页

入口：

- `/admin/roles/new`
- `/admin/roles/:roleId`
- `/admin/roles/:roleId?mode=copy`

Tab：

- 基本配置
- 权限预览
- 使用情况
- 变更预览

#### 基本配置

字段：

- Role ID
  - 新建时必填。
  - 编辑已有 YAML role 时只读。
  - template 复制时必填新 id。
  - 规则：`^[A-Za-z0-9_-]{1,64}$`
- 描述
- Connections 多选或可编辑 chips
- Tools 多选
- Table selectors editor

Table selectors editor：

- 每条 selector 包含：
  - connection
  - schema
  - selector type：`names` / `prefix`
  - names 多选或手动输入 source name 列表
  - prefix 文本输入
- `names` 和 `prefix` 二选一。
- `connection` 可以省略时使用 role-level connections，但 UI 推荐显式填入。

### 5.4 权限预览

预览必须复用后端 role preview：

- tools
- connections
- resolved sources
- snapshotHash
- sourceMapVersion
- warnings

渲染方式：

```text
mysql-aliyun
  dataforai
    superstore_orders -> dataforai.superstore_orders

Allowed tools:
  lucy_catalog
  lucy_query
```

### 5.5 使用情况

展示引用该 role 的 Agent：

- Agent user id
- display name
- enabled
- token count
- last seen
- link to `/admin/agents/:userId`

### 5.6 变更预览

所有 create / patch / delete / copy-template 都必须：

1. 先调用 dryRun。
2. 展示 `webui/config/access.yaml` diff。
3. 用户确认后才 `dryRun:false` 落盘。

保存成功后：

- invalidate `["admin", "roles"]`
- invalidate `["admin", "agents"]`
- 返回 role detail 或列表。

## 6. API Spec

### 6.1 GET `/api/admin/roles`

现有 API 保留并扩展字段。

Query：

- `includeTemplates?: string`，默认 true。

Response：

```ts
type RoleSummary = {
  id: string;
  description?: string;
  source: "yaml" | "template";
  tools: string[];
  connections: string[];
  sourceCount: number;
  invalid: boolean;
  warnings: string[];
  usageCount: number;
  users: Array<{ id: string; name: string; enabled: boolean; tokenCount: number }>;
};
```

### 6.2 GET `/api/admin/roles/:roleId`

Response：

```ts
type RoleDetail = RoleSummary & {
  role: {
    description?: string;
    allow: {
      connections?: string[];
      tableSelectors?: Array<
        | { connection?: string; schema: string; names: string[] }
        | { connection?: string; schema: string; prefix: string }
      >;
      tools?: string[];
    };
  };
  effectivePermissions?: EffectivePermissionsPreview;
};
```

Rules：

- YAML role：从 `access.yaml.roles` 读取。
- Template role：从 `ROLE_TEMPLATES` 展开返回，`source: "template"`。
- 不存在返回 `404 ROLE_NOT_FOUND`。

### 6.3 POST `/api/admin/roles/_preview`

用途：编辑表单即时预览，不写盘。

Body：

```ts
{
  roleId: string;
  role: YamlRole;
}
```

Response：

```ts
{
  ok: true;
  data: {
    effectivePermissions: EffectivePermissionsPreview;
    warnings: string[];
  }
}
```

Invalid role 返回 `400 INVALID_ROLE`，message 使用 resolver reason。

### 6.4 POST `/api/admin/roles`

创建 YAML role。

Body：

```ts
{
  dryRun?: boolean;
  roleId: string;
  role: YamlRole;
}
```

Rules：

- `roleId` 必须符合 `^[A-Za-z0-9_-]{1,64}$`。
- 不得与现有 YAML role 或 template role 冲突。
- `role.allow.tools` 必须非空且不包含 `*`。
- selector 匹配 0 source 时拒绝。
- `dryRun !== false` 时只返回 diff，不写盘。
- `dryRun:false` 时写入 `access.yaml.roles.<roleId>` 并记录 `config_change_log`，`changeType = "role_create"`。

Response dryRun：

```ts
{
  diff: string;
  proposedYaml: string;
}
```

Response save：

```ts
{
  written: true;
  role: RoleDetail;
}
```

### 6.5 PATCH `/api/admin/roles/:roleId`

编辑 YAML role。

Body：

```ts
{
  dryRun?: boolean;
  version?: string;
  patch: {
    description?: string;
    allow?: YamlRole["allow"];
  };
}
```

Rules：

- 只能编辑 `source: "yaml"` 的 role。
- Template role 返回 `400 TEMPLATE_ROLE_READONLY`。
- 不支持修改 role id。
- version conflict 返回 `409 VERSION_CONFLICT`。
- 写入记录 `changeType = "role_patch"`。

### 6.6 DELETE `/api/admin/roles/:roleId`

删除 YAML role。

Body：

```ts
{
  dryRun?: boolean;
  version?: string;
}
```

Rules：

- Template role 返回 `400 TEMPLATE_ROLE_READONLY`。
- 被任意 `users[].role` 引用时返回 `409 ROLE_IN_USE`，并返回 users 摘要。
- dryRun 返回删除 diff。
- 保存记录 `changeType = "role_delete"`。

### 6.7 POST `/api/admin/roles/:templateId/copy`

从 YAML role 或 template role 复制出新 YAML role。

Body：

```ts
{
  dryRun?: boolean;
  newRoleId: string;
  description?: string;
}
```

Rules：

- 源 role 可以是 YAML 或 template。
- 目标 role id 不能冲突。
- 落盘为普通 YAML role。
- 不写 template pointer 字段。
- 写入记录 `changeType = "role_create"`，summary 标记 `sourceRoleId`。

## 7. 校验规则

Role 写入前必须通过：

- role id regex。
- schema whitelist：只允许 `description` / `allow` / `allow.connections` / `allow.tableSelectors` / `allow.tools` / selector 的 `connection`、`schema`、`names`、`prefix`。
- `tools` 非空，不能包含 `*`。
- 所有 tool 必须在 `defaults.known_tools` 中。
- `defaults.deny_tools` 命中的工具即使列入 role，也会在 preview 中被剔除或标 warning；保存时建议拒绝，避免用户误以为可用。
- 有 table selector 或 table-touching tool 时，connections 必须非空。
- 每个 selector 必须解析到至少一个 source。
- `names` 和 `prefix` 互斥。
- `names` 不能为空数组。
- `prefix` 不能为空字符串。

## 8. Agent Admin 联动

M12 完成后，M11 新建 Agent 弹窗需要加：

- role label 旁的 `管理角色` link，指向 `/admin/roles`。
- role 下拉为空时显示：

```text
还没有可用角色。请先创建角色。
[创建角色]
```

- role 权限卡片中 source 为 `template` 时显示：

```text
这是内置模板。创建 Agent 时会展开写入 access.yaml，不保留模板指针。
```

Agent detail 基本信息 tab 的 role select 旁也加 `管理角色` link。

## 9. 测试要求

前端：

- Role list 渲染 YAML / template / invalid / usageCount。
- 搜索和筛选。
- 新建 role dryRun -> diff -> confirm。
- 编辑 role dryRun -> diff -> confirm。
- 删除 role 时 in-use 阻止。
- Template role 只读，复制为 YAML role。
- Agent 新建弹窗的 `管理角色` link 可见。

后端：

- `GET /api/admin/roles` 返回 usageCount/users。
- `GET /api/admin/roles/:roleId` 支持 yaml/template/not found。
- `POST /api/admin/roles` dryRun 不写盘，save 写盘。
- `PATCH /api/admin/roles/:roleId` 拒绝 template，校验 version。
- `DELETE /api/admin/roles/:roleId` 拒绝 in-use，允许删除未引用 role。
- copy template 展开落盘且无 template pointer 字段。
- invalid tools / wildcard tools / empty selector / missing connections fail。

建议命令：

```bash
cd webui
npm test -- admin-roles role-list agent-list agent-detail
npm run build
```

## 10. Definition Of Done

- `/admin/roles` 可从侧边栏访问。
- 管理员能不手写 YAML 完成 role 创建、编辑、删除、复制模板。
- 所有 role 写入都经过 dryRun diff。
- 删除被 Agent 引用的 role 被阻止。
- Template role 只读，复制后落盘为普通 YAML role。
- Agent 新建和编辑入口能跳到 role 管理。
- `access.yaml` 中不出现 `role-template` / `templateId` 等指针字段。
- 聚焦测试和 build 通过。

