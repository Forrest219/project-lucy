# 业务 Skill 授权与文件安全加固 Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | 业务 Skill 授权与文件安全加固 Spec |
| 文档类型 | Spec |
| Spec 编号 | 151 |
| 版本 | v1.0 |
| 状态 | Implemented，待完整 UAT |
| 日期 | 2026-09-26 |
| 上游 Spec | Spec 131、144、147 |
| 适用范围 | `skills/`、Skill Admin API、Lucy MCP Proxy、`/skills`、Role 详情、审计 |

> 编号说明：原验收计划拟使用 Spec 150；该编号已被 Role 权限配置结构 Spec 占用，因此本补丁顺延为 Spec 151。

## 1. 目的与裁决优先级

本 Spec 是 Spec 131 §4.1 与 Spec 147 §4.2 的验收加固补丁。冲突时以本 Spec 为准：

1. Skill frontmatter 的 `roles_allowed` 是具体 Skill 对象授权的唯一事实源；`access.yaml` 不增加 `allowed_skills`、`denied_skills` 或 Skill 白名单。
2. Role 只授予通道能力：`lucy_skill_search` 对应发现，`lucy_skill_read` 对应读取。
3. `domain`、`name` 是创建后不可变的文件身份；普通保存不搬移入口文件。
4. 缺失或空 `roles_allowed` 表示无人可见；`["*"]` 仅由显式“所有角色可见”开关生成，且不得与角色 ID 混用。

## 2. 授权契约

### 2.1 动作与通道

| 动作 | 必需工具 | 覆盖协议 |
|---|---|---|
| `discover` | `lucy_skill_search` | `initialize` 目录、`resources/list`、`prompts/list`、`lucy_skill_search` |
| `read` | `lucy_skill_read` | `resources/read`、`prompts/get`、`lucy_skill_read` |

只有发现权限时可见摘要但不能读取正文；只有读取权限时可按已知完整 URI 读取，但不得获得目录。

### 2.2 同角色闭合

多角色用户不得跨角色拼权。同一个 Role 必须同时满足：

- Skill 的 `roles_allowed` 包含该 Role ID，或包含独占通配符 `*`；
- 该 Role 授予当前动作所需工具。

无 Role 的 legacy direct-allow identity 只可匹配 `*`，且 direct allow 必须含当前动作所需工具。

### 2.3 稳定拒绝原因

`skill_not_published`、`skill_deprecated`、`skill_no_roles_allowed`、`skill_role_mismatch`、`skill_channel_forbidden:discover`、`skill_channel_forbidden:read`、`skill_role_required`。

## 3. 核心流程（伪代码）

```text
authorize(identity, skill, action):
  requiredTool = action == discover ? lucy_skill_search : lucy_skill_read

  if skill.status == deprecated: deny skill_deprecated
  if skill.status != published: deny skill_not_published
  if roles_allowed missing or empty: deny skill_no_roles_allowed

  for role in identity.assignedRoles:
    roleMatches = roles_allowed contains "*" or roles_allowed contains role.id
    if roleMatches and role grants requiredTool:
      allow matchedRoleId=role.id

  if identity has no role:
    if roles_allowed contains "*" and direct allow grants requiredTool:
      allow matchedRoleId="__legacy__"
    deny skill_role_required or skill_channel_forbidden:<action>

  deny skill_channel_forbidden:<action> when an audience role matched
  otherwise deny skill_role_mismatch
```

所有目录、Resource、Prompt 与 Skill 工具必须复用该裁决函数，不得各自实现授权分支。

## 4. 文件身份与写入安全

1. `domain`、`name` 统一匹配 `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`，兼容 `kx_financial`；继续拒绝分隔符、`..`、绝对路径和越界路径。
2. 创建前直接检查目标文件系统路径；即使既有文件 frontmatter 损坏而无法被 loader 索引，也返回 `409 skill_path_conflict`，不得覆盖。
3. GET 详情只按完整 `lucy-skill://<domain>/<name>` 精确查询；错误 domain 返回 404。
4. 结构化输入与 `rawContent` 都必须保证 frontmatter URI、路由 URI 与目标路径一致；更新冲突返回 `409 skill_identity_immutable`。
5. 更新始终写回 `existing.relativePath`。重命名只能显式“新建新 Skill—确认—删除旧 Skill”。
6. 列表和详情返回原始文件内容的 SHA-256 `file_version`。更新、删除必须携带 `expected_version`；缺失返回 `428 skill_expected_version_required`，过期返回 `409 skill_write_conflict`。

## 5. WebUI 行为

- 新建默认“无人可见”；角色来自现有 Role API 的多选控件，不接受自由文本。
- “所有角色可见”是独立开关；开启前二次确认，开启后写入 `["*"]` 并禁用角色多选。
- 关闭开关且清空选择时写入 `[]`。未知或已删除 Role ID 保留显示并警告，不扩权。
- 编辑时 `domain`、`name` 只读；保存携带所加载的 `file_version`。
- Role 详情只读展示可检索、可读取、已声明但通道不完整的业务 Skill；授权仍只在 Skill 编辑页修改。

## 6. 审计与可观测性

访问日志幂等增加 `skill_uri`、`skill_version`、`skill_file_version`、`skill_action`、`skill_roles_allowed`、`matched_role_id`，并继续记录 `decision_reason`。正文读取前若审计迁移不可用，返回 `skill_audit_unavailable` 并 fail-closed。

授权配置审计记录旧/新角色集合、是否进入或退出通配符、受影响 Role ID、受影响 Agent 数及文件版本。权限快照哈希包含逐 Role 工具能力，访问记录包含 Skill 授权集合与实际命中 Role，足以复现裁决。

## 7. API 契约增量

| 操作 | 增量 |
|---|---|
| `GET /api/admin/skills` / 详情 | 返回 `file_version` |
| `PUT /api/admin/skills/:domain/:name` | 请求必须含 `expected_version`；身份不可变 |
| `DELETE /api/admin/skills/:domain/:name` | JSON body 必须含 `expected_version` |
| `GET /api/admin/roles/:roleId` | 返回只读 `skillAccess` 摘要 |
| `GET /api/admin/audit` | 返回 Skill 裁决证据字段 |

## 8. Design System Compliance

沿用 `pl-card`、现有表单控件、颜色 token 与焦点样式；不新增视觉 token。角色选择使用复选框组与明确 label；警告使用现有 warning token；身份字段禁用态仍保留可读对比度。Lucy 默认不做移动窄屏验收。

## 9. Terminology Compliance

遵循 `webui/docs/00-product-terminology-standard.md` §4.10。本 Spec 新增“可访问角色”“所有角色可见”“无人可见”。DOM 中 `Skill`、`roles_allowed`、Skill URI、Role ID 与文件路径必须使用 `translate="no"` 和 `notranslate` 防翻译。

## 10. 验收标准

| ID | 断言 |
|---|---|
| SC-151-01 | 原路径保存、下划线 domain、损坏同路径冲突、raw URI 不一致、错误 domain 404、身份不可变和并发版本冲突均有自动化测试 |
| SC-151-02 | 空集合、显式 `*`、单/多 Role、跨 Role 拼权、未知 Role、legacy identity、草稿和已停用状态覆盖 ACL 矩阵 |
| SC-151-03 | initialize、Resources、Prompts、search/read 工具的 discover/read 范围与拒绝原因一致 |
| SC-151-04 | `/skills` 覆盖创建、原路径编辑、角色多选、无人可见、所有角色可见、二次确认和版本冲突 |
| SC-151-05 | Role 详情显示只读 Skill 摘要；授权改变只从 Skill 编辑页发起 |
| SC-151-06 | Skill selector contract、定向 Vitest、Proxy 测试、Playwright、build、术语 lint、Spec lint 通过；全量不得新增失败 |

P1/P2、授权矩阵、协议一致性与 WebUI E2E 全部通过后，验收状态方可从 NO-GO 改为 GO。
