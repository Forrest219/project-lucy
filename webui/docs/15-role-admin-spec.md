# Role Admin Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Role Admin Spec |
| 文档类型 | Product / UX / API Spec |
| 版本 | v0.4（AC-P1.5 契约补丁 / WO-61 WP-S1；Role constraints 继续 forbidden） |
| 撰写日期 | 2026-07-27；v0.2 补丁 2026-08-08；v0.3 2026-08-09；v0.4 2026-08-09 |
| 适用范围 | Lucy WebUI 访问治理模块：Role 列表、Role 新建/编辑/删除、Role preview、Agent 联动 |
| 事实源 | `access.yaml` roles；AC-P0 → Spec 98；AC-P1 → Spec 99；AC-P1.5 Constraints → Spec 100（Agent 侧，非本文） |
| 关联文档 | Spec 07 v1.6、Spec 14 v0.4、Spec 100、Gate A ADR、`design-upgrade.md` |
| 冲突裁决 | AC-P0 → Spec 98；AC-P1 → Spec 99；AC-P1.5 → Spec 100；与 design-upgrade / ADR 冲突 → design-upgrade / ADR |

## 0. AC-P0 契约补丁（WP-S1）

> **权威语义：** `permission_model_version`、v2 禁 `prefix`、capability 代数、编译提交 → Spec 98 §3 / §5 / §7 / §8。AC-P1 `scoped`/`row_policy` → Spec 99。本文修订 Role Admin 字段、校验、preview 与迁移 UX。

### 0.0 AC-P1 增量（v0.3 / Spec 99）

| 项 | 要求 | Spec 99 |
|---|---|---|
| `row_access: scoped` | **Gate B + WP-I1 后**允许；须合法 `row_policy.predicates`（op∈{eq,in}；**仅行级字段，禁止 measure**；Spec 99 §3.2） | §3–§3.2 |
| dryRun | 展示 predicates、rowGrant digest、受影响源；**禁止**「看起来有行级但未注入」的成功文案 | §8 |
| `row_access: all` + `row_policy` | 拒绝 | §3.1 |
| `constraints` | **Role 继续拒绝**（见 §0.0a）；Agent 侧不在 Role Admin | Spec 99 §4.3 → Spec 100 §3.3 |
| Preview `rowGrant` | `"all"` \| `{ predicates, digest }`（字段名以实现为准） | §8 |

> **节奏：** Spec 99 Gate B 前，Admin/runtime/`lint:spec` 对 `scoped` 仍拒绝入库（防无注入配置）；Gate B + WP-I1 后按上表放行。

### 0.0a AC-P1.5 边界（v0.4 / Spec 100）

| 项 | 要求 | Spec 100 |
|---|---|---|
| Role `constraints` | YAML / API / UI **一律 forbidden** → `constraints_forbidden_on_role`；**不提供** Constraints 编辑器 | §3.3 |
| Agent `constraints` | **不属于 Role Admin**；编辑 / dryRun / preview 在 Spec 14 / Spec 100 | §10 |
| TokenScope | 非本 Spec；Role Admin 不引入 token 行收紧 | Spec 100 §2 |
| Preview | Role dryRun 仍只展示 rowGrant；FinalRows（含 Constraints）在 Agent preview | Spec 14 §0.0a |

### 0.1 相对 v0.1 的增量

| 项 | v0.1 | AC-P0（本补丁） | Spec 98 锚点 |
|---|---|---|---|
| 模型版本 | 无 | Role 必有 `permission_model_version: 1\|2`；新建强制 `2`；缺字段稳态编译失败（一次性迁移写 `1`） | §7 |
| Selector | `names` / `prefix` 二选一 | **v2 禁用 `prefix`**，仅 `names`；每个 selector 显式 `row_access`；AC-P0 仅 `all`；**AC-P1 `scoped` 见 §0.0** | §7 / Spec 99 |
| Preview | tools + connections + resolved sources（双并集观感） | **Data Capability Preview**（tool × source × rowGrant）；禁止只展示双并集 | §5 |
| 保存 | dryRun → 写盘 | + `runtimeAck` / `policyVersion`（与 Spec 14 §0.3 同口径） | §8.2 |
| 迁移 | 无 | 编辑并保存 v1 Role：升 v2、补 `row_access: all`、`prefix` 展开为 `names`；无法展开 → 保存失败；dryRun 展示完整展开清单 | §7 |
| 行级 | 「不实现列级 / 行级」 | AC-P0 仅 `all`；**AC-P1 见 §0.0 / Spec 99** | Spec 99 |

### 0.2 `permission_model_version` 与 Admin 迁移

| 动作 | 行为 |
|---|---|
| 新建 Role | 强制写入 `permission_model_version: 2`；默认 selector `names` + `row_access: all`；UI 不提供 `prefix`；Gate B 后可选 `scoped`+`row_policy` |
| 编辑 v1 Role 并保存 | 升为 `2`；每 selector 补 `row_access: all`；含 `prefix` 的必须先展开为 `names` 明细（dryRun 展示完整源清单）；无法展开 → 保存失败 |
| 编辑时出现 v2 + `prefix` | 校验拒绝（U-VER-02） |
| 编辑时出现 v2 + `scoped`（Gate B 前） | 校验拒绝；Gate B 后按 Spec 99 校验 `row_policy` |
| AbsoluteDeny / 未分类工具写入 `allow.tools` | lint / 保存拒绝 |

迁移 dryRun diff **必须**让管理员看见：版本字段变化、`prefix`→`names` 展开结果、新增的 `row_access: all`；若含 scoped，须看见 predicates。

### 0.3 Preview / API 形状（增量）

```ts
type YamlRoleAcP1 = {
  description?: string;
  permission_model_version: 1 | 2;
  allow: {
    connections?: string[];
    tableSelectors?: Array<{
      connection?: string;
      schema: string;
      names?: string[];
      prefix?: string;           // 仅 v1 合法；v2 禁止
      row_access?: "all" | "scoped"; // v2 必填
      row_policy?: {             // scoped 必填；all 禁止
        predicates: Array<{
          field: string;
          op: "eq" | "in";
          value?: string | number | boolean;
          values?: Array<string | number | boolean>;
        }>;
      };
    }>;
    tools?: string[];
  };
};

type RoleEffectivePreviewAcP1 = {
  capabilities: Array<{
    tool: string;
    canonicalSourceKey: {
      connectionId: string;
      schema: string;
      sourceName: string;
      physicalTable: string;
    };
    rowGrant: "all" | { predicates: unknown[]; digest: string };
  }>;
  metaTools: string[];
  policyVersion?: string;
  sourceMapVersion: string;
  warnings: string[];
};
```

保存成功（`dryRun:false`）响应须含 `policyVersion` 与 `runtimeAck: true`（同 Spec 14 §0.3）。

### 0.4 与 design-upgrade §9（Admin API 行）对照

| 要求 | 落点 |
|---|---|
| 版本迁移与 `prefix` 展开 dryRun | §0.2、§5.3、§6.*、§7 |
| capability preview | §0.3、§5.4 |
| `runtimeAck` | §0.3、§6.4+ |
| 禁双并集唯一摘要 | §0.1、§5.4 |

---

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
- **波次边界：** AC-P0 不交付 scoped 编辑器。**AC-P1** 允许 `scoped`+`row_policy`（Spec 99；Gate B 后）。不得展示「有行级文案但未注入」。**Agent Constraints 不在 Role Admin**（Spec 14 / Spec 100）；Role `constraints` 继续 forbidden。`ne`/范围 op / Dynamic RLS / TokenScope 不在本 Spec。不得写成「永不做行级」。
- 不实现 token scope / TokenScope 行收紧。若未来另立，只能在 role/capability 基础上做交集收窄，不能增权。
- 不实现 role 版本历史的单独模型；变更历史继续走 `config_change_log`。
- 不在本文复述 Tool Class 全表或 capability 代数（→ Spec 98）。

## 4. 信息模型

### 4.1 YAML Role

```yaml
roles:
  poc_readonly:
    description: POC内测只读角色
    permission_model_version: 2   # AC-P0：新建强制 2；存量一次性迁移为 1
    allow:
      connections:
        - poc-mysql-aliyun
      tableSelectors:
        - connection: poc-mysql-aliyun
          schema: data_agent_poc
          names:
            - poc_metric_catalog
          row_access: all           # v2 必填；AC-P1 亦可 scoped + row_policy（Spec 99）
      tools:
        - lucy_catalog
        - lucy_read_source
        - lucy_query
```

字段语义：

- `description`：管理员可读说明。
- `permission_model_version`：**AC-P0 必填口径**见 §0.2 / Spec 98 §7。
- `allow.connections`：该 role 可访问的 connection id。只要 role 有 table selector 或数据访问工具，必须非空。
- `allow.tableSelectors`：授权 source 选择器。
  - `names`：精确列出 source name，生产敏感数据推荐；**v2 唯一合法选择器形态**。
  - `prefix`：前缀匹配 source name；**仅 v1 legacy 允许**。v2 禁止；Admin 迁移时必须展开为 `names`（§0.2）。开放式授权风险见既有 §5.1.3 叙述，AC-P0 起 v2 用禁用来闭合静默扩权。
  - `row_access`：v2 必填；`all` 或（AC-P1 Gate B 后）`scoped`+`row_policy`；Gate B 前 `scoped` 仍拒绝。
- `allow.tools`：允许暴露给 Agent 的 MCP 工具，必须显式列名，不能是 `["*"]`；不得包含 AbsoluteDeny / 未分类工具（Spec 98 §4）。

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
- **权限模型版本**（只读展示 + 迁移提示）：新建固定 `2`；编辑 v1 时提示「保存将迁移为 v2」
- Connections 多选或可编辑 chips
- Tools 多选（过滤 AbsoluteDeny / 未分类；命中则禁用或保存拒绝）
- Table selectors editor

Table selectors editor：

- 每条 selector 包含：
  - connection
  - schema
  - selector type：`names` / `prefix`
    - **新建或 `permission_model_version: 2`：** 仅 `names`；不展示或禁用 `prefix`
    - **编辑 v1：** 可继续展示既有 `prefix`，但保存路径必须走展开（§0.2）
  - names 多选或手动输入 source name 列表
  - prefix 文本输入（仅 v1 迁移前）
  - **`row_access`：**
    - **Gate B 前 / 未交付 WP-I1：** 表单固定 `all`；不提供 `scoped` 控件；API 写入 `scoped` → 拒绝
    - **Gate B + WP-I1 后：** 提供 `all` | `scoped`；选 `scoped` 时必须编辑合法 `row_policy.predicates`（仅行级字段，禁止 measure；见 Spec 99 §3.2）；dryRun 展示 predicates / digest
- `names` 和 `prefix` 二选一（v1）；v2 仅 `names`。
- `connection` 可以省略时使用 role-level connections，但 UI 推荐显式填入。

### 5.4 权限预览

预览必须复用后端 role preview（与 runtime **同一**合成器；Spec 98 §5）：

- **主展示：** `capabilities[]`（tool × 规范源键 × rowGrant）
- `metaTools`
- `sourceMapVersion` /（编译成功时）`policyVersion`
- `warnings`
- 辅助：connections、sourceCount（可选）

**禁止**仅渲染：

```text
<!-- 禁止作为唯一摘要 -->
Allowed tools: …
<table tree of sources>
```

渲染方式（示意）：

```text
Capabilities:
  lucy_query       × poc-mysql-aliyun | data_agent_poc | poc_metric_catalog | …
  lucy_read_source × poc-mysql-aliyun | data_agent_poc | poc_metric_catalog | …
Meta tools:
  lucy_catalog
sourceMapVersion: …
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
2. 展示 `webui/config/access.yaml` diff（含 `permission_model_version`、`row_access`、`prefix`→`names` 展开）。
3. 用户确认后才 `dryRun:false` 落盘。
4. 成功响应须 `runtimeAck: true` 与 `policyVersion`（删除不影响 runtime 合成的纯未引用 role 时可注明 N/A，但收窄 / 替换被引用 role 必须 ack）。

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
    permission_model_version?: 1 | 2;
    allow: {
      connections?: string[];
      tableSelectors?: Array<
        | { connection?: string; schema: string; names: string[]; row_access?: "all" | "scoped" }
        | { connection?: string; schema: string; prefix: string; row_access?: "all" | "scoped" }
      >;
      tools?: string[];
    };
  };
  effectivePermissions?: RoleEffectivePreviewAcP0; // §0.3；兼容旧名 EffectivePermissionsPreview
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
- schema whitelist：`description` / `permission_model_version` / `allow` / `allow.connections` / `allow.tableSelectors` / `allow.tools` / selector 的 `connection`、`schema`、`names`、`prefix`（仅 v1）、`row_access`、`row_policy`（仅 `scoped`）。
- `permission_model_version`：新建必须为 `2`；稳态缺字段拒绝；v2 + `prefix` 拒绝；v2 selector 缺 `row_access` 拒绝。
- **AC-P1（Spec 99）：** Gate B 前 `scoped` 仍拒绝；**Gate B + WP-I1 后** `scoped` 须合法 `row_policy`（op∈{eq,in}；§3.2 仅行级字段，**禁止 measure**）；`all`+`row_policy` 拒绝。
- **AC-P1.5（Spec 100）：** Role 出现 `constraints` → **拒绝**（`constraints_forbidden_on_role`）；Agent `constraints` 不在本校验面（→ Spec 14）。
- `tools` 非空，不能包含 `*`。
- 所有 tool 必须在分类表 / `defaults.known_tools` 中，且**不得**为 AbsoluteDeny 或未分类（Spec 98 §4）。
- `defaults.deny_tools` 命中的工具即使列入 role，也会在 preview 中被剔除或标 warning；保存时建议拒绝，避免用户误以为可用。
- 有 table selector 或 DataPlane tool 时，connections 必须非空。
- 每个 selector 必须解析到至少一个 source（`prefix` 展开后的 `names` 同此）。
- `names` 和 `prefix` 互斥。
- `names` 不能为空数组。
- `prefix` 不能为空字符串；**v2 不得出现 `prefix`**。
- v1→v2 保存：必须完成 §0.2 迁移步骤；展开失败则整个保存失败。

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
- 新建 role dryRun -> diff -> confirm（含强制 `permission_model_version: 2`、无 prefix）。
- 编辑 v1 role：迁移 diff 含版本升级与 `prefix`→`names` 展开；失败路径可测。
- capability preview 展示元组而非仅双并集。
- 保存成功依赖 `runtimeAck`（与 Spec 14 同断言风格）。
- 删除 role 时 in-use 阻止。
- Template role 只读，复制为 YAML role（复制结果为 v2）。
- Agent 新建弹窗的 `管理角色` link 可见。

后端：

- `GET /api/admin/roles` 返回 usageCount/users。
- `GET /api/admin/roles/:roleId` 支持 yaml/template/not found。
- `POST /api/admin/roles` dryRun 不写盘，save 写盘。
- `PATCH /api/admin/roles/:roleId` 拒绝 template，校验 version。
- `DELETE /api/admin/roles/:roleId` 拒绝 in-use，允许删除未引用 role。
- copy template 展开落盘且无 template pointer 字段。
- invalid tools / wildcard tools / AbsoluteDeny tools / empty selector / missing connections / v2+prefix fail。
- **`scoped` 节奏（与 Spec 99 一致，禁止两套口径）：**
  - Gate B 前 / 未交付 WP-I1：`v2 + scoped` → fail（防无注入配置入库）
  - Gate B + WP-I1 后：`scoped` + 合法 `row_policy` → 允许；缺 policy / 非法 op / 字段无法绑定 → fail；`all` + `row_policy` → fail
- v1→v2 迁移 dryRun 展示展开后的 names；无法展开则拒绝 `dryRun:false`。

建议命令：

```bash
cd webui
npm test -- admin-roles role-list agent-list agent-detail
npm run build
```

## 10. Definition Of Done

- `/admin/roles` 可从侧边栏访问。
- 管理员能不手写 YAML 完成 role 创建、编辑、删除、复制模板。
- 所有 role 写入都经过 dryRun diff；成功保存满足 `runtimeAck` 契约（被引用 role 收窄路径）。
- Data Capability Preview 为权限摘要主展示。
- v2 Role 无法经 UI 写入 `prefix`（始终）。
- **`scoped` DoD（对齐 Spec 99，勿再写「永远无法写入 scoped」）：**
  - Gate B 前：UI/API 无法写入 `scoped`
  - Gate B + WP-I1 后：UI 可写入 `scoped` + 合法 `row_policy`；非法形态被拒；preview 展示 rowGrant 摘要；**禁止**「有行级文案但未注入」的成功态
- 删除被 Agent 引用的 role 被阻止。
- Template role 只读，复制后落盘为普通 YAML role（v2）。
- Agent 新建和编辑入口能跳到 role 管理。
- `access.yaml` 中不出现 `role-template` / `templateId` 等指针字段。
- 聚焦测试和 build 通过（Gate B 后实施时）。

