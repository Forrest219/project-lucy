# MVP：Skill 与 Wiki 对所有角色开放

| 元数据 | 内容 |
|---|---|
| 文档名称 | MVP：Skill 与 Wiki 对所有角色开放 |
| 文档类型 | Product / Runtime Spec |
| Spec 编号 | 170 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-12 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | MCP Proxy 工具清单与裁决、Skill ACL、Wiki ACL、`/skills`、角色权限里的工具预设、Skill / Wiki 保存回写 |
| 关联工单 | `webui/docs/plans/wo-202610-22-mvp-open-skill-wiki-access.md` |
| 上游 | Spec 151、Spec 98 §4.2、Spec 162 §7.3、`webui/server/proxy/skill-acl.ts`、`webui/server/proxy/wiki-acl.ts` |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | MVP 暂停 Skill 与 Wiki 的对象授权和通道勾选。已发布 Skill 与全部 Wiki 文档对所有已解析角色开放。文件里的授权字段保留，不批量改写 |

## 1. 问题

业务 Skill 要同时满足 `roles_allowed` 和同一角色上的 `lucy_skill_search` / `lucy_skill_read`。业务 Wiki 还要满足 `visibility`、`allowed_roles` 或全部 `sl_refs` 可见。管理台把这些开关拆在 Skill 编辑页和角色工具预设里。

当前环境里，4 篇已发布 Skill 的 `roles_allowed` 为空，3 篇写成所有角色可见，但 `lucy_admin` 没有 Skill 工具，结果是可检索 0、可读取 0。Wiki 编辑页没有授权控件，未写 frontmatter 的文档在运行时被拒绝。Agent 在 `initialize` 时收不到这些 SOP，`wiki_search` 也搜不到对应文档。

MVP 阶段不继续做这套对象授权。

## 2. 目标

1. 任一已解析且启用的 Agent，都能发现并读取全部已发布 Skill，也都能搜索和读取全部 Wiki 文档。
2. 四个上下文工具对上述 Agent 始终出现在工具清单里，调用时不再因为角色的 `allow.tools` 缺少它们而拒绝：`wiki_search`、`wiki_read`、`lucy_skill_search`、`lucy_skill_read`。
3. 管理台不再提供 Skill 或 Wiki 的对象授权，也不再提供这四个工具的勾选。
4. 已有文件不批量改写。`roles_allowed`、`visibility`、`allowed_roles` 留在文件里，保存正文时保留，运行时不读取。

## 3. 非目标

- 不放宽表、连接、行级策略和数据面工具。上下文工具不能让 Agent 查到角色范围外的表。
- 不把草稿或已停用 Skill 开放给 Agent。`skill_not_published` 与 `skill_deprecated` 保持不变。
- 不删除访问日志里已有的 `wiki_forbidden`、`skill_role_mismatch`、`skill_no_roles_allowed`、`skill_channel_forbidden:*` 分类。新调用不再产生这些原因。
- 不新增角色乘文档的勾选清单。
- 不改 Wiki 与语义对象的跳转。`sl_refs` 仍只表示关联，不表示授权。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 151 §1.1、§1.2、§1.4、§2：`roles_allowed` 是对象授权事实源；角色工具是发现和读取通道；空列表表示无人可见 | 暂停。已发布 Skill 不再读取 `roles_allowed`，也不要求角色工具清单里写有 Skill 工具 |
| Spec 151 §2.2 同角色闭合 | 暂停。任一已解析角色即可使用全部已发布 Skill |
| Spec 151 §4 文件身份、路径与并发版本 | 保持 |
| Wiki ACL：`public`、`allowed_roles` 或全部 `sl_refs` 可访问才放行，否则 `wiki_forbidden` | 暂停。文档存在即可读。缺少文档仍是 `wiki_not_found` |
| 角色预设「只读问答 + 知识库」用 `wiki_search` / `wiki_read` 区别于「只读问答」 | 删除该预设。四个上下文工具不再进入可编辑工具集 |
| `allowedToolNames` 对 `lucy_*` 要求至少一条数据能力 | `lucy_skill_search` 与 `lucy_skill_read` 不受这条限制 |

## 核心流程（伪代码）

```text
CONTEXT_TOOLS = [
  wiki_search, wiki_read, lucy_skill_search, lucy_skill_read
]

authorizeTool(identity, tool):
  if agent missing or disabled: deny as today
  if tool is absolute deny, unclassified, or global deny: deny as today
  if tool in CONTEXT_TOOLS:
    if role resolution failed and agent is not in degradedAgents: deny with that reason
    allow
    skip table ACL
  else:
    existing authorizeAndRewrite

listTools(identity):
  names = existing allowedToolNames
  if identity resolved and agent enabled:
    names = names ∪ CONTEXT_TOOLS
  return names

authorizeSkill(identity, skill, action):
  if skill.status == deprecated: deny skill_deprecated
  if skill.status != published: deny skill_not_published
  allow
  ignore roles_allowed
  ignore whether CONTEXT_TOOLS were listed in role YAML

authorizeWiki(identity, key):
  page = resolveWikiPage(key)
  if page missing: deny wiki_not_found
  allow
  ignore visibility, allowed_roles, sl_refs

saveSkill(existing, draft):
  write draft fields except roles_allowed
  if existing file has roles_allowed: copy that value through unchanged
  do not add roles_allowed to a new file

saveWiki(existing, draft):
  write the editable frontmatter
  if existing file has visibility or allowed_roles: copy those keys through unchanged
```

角色解析失败且该 Agent 不在降级名单时，四个上下文工具与今天的其他工具一样拒绝。降级名单里的 Agent 继续可以使用这四个工具，避免表编译失败把业务上下文一起拿掉。

数据面全局降级不拦截这四个工具。它们已经属于 Meta。

## 5. 管理台

`/skills`：

- 编辑页去掉「可访问角色」，包括「所有角色可见」、角色复选框、「无人可见」和未知角色提示。
- 治理总览去掉「角色授权」列和筛选项。
- 保存预检去掉「授权变化」和「我确认将此 Skill 设置为所有角色可见」。预检仍展示校验、状态变化和 Diff。
- 阅读态不再展示角色授权摘要。

`/admin/roles/:roleId`：

- 去掉「只读问答 + 知识库」预设。保留「只读问答」。
- 自定义工具里不再展示 `wiki_search`、`wiki_read`、`lucy_skill_search`、`lucy_skill_read`。
- 预设匹配时忽略这四个工具名。角色 YAML 里已经写了它们，仍显示为「只读问答」，只要其余工具与该预设一致。
- 保存角色时可以不再写出这四个工具名。运行时仍会并上。
- 生效边界摘要里删除「业务 Skill」计数和「授权修改请前往 Skill 编辑页」。

`/wiki` 不增加授权控件。

## 6. 文件与审计

不扫描、不改写现有 `SKILL.md` 和 Wiki Markdown。

更新一篇 Skill 时，原 frontmatter 的 `roles_allowed` 原样保留，包括空数组和 `["*"]`。新建 Skill 不写这个字段。校验器可以继续报告通配符与角色 ID 混用，但该问题只属于文件卫生，不参与 Agent 是否可读。

更新一篇 Wiki 时，原 frontmatter 的 `visibility` 和 `allowed_roles` 原样保留。`sl_refs` 继续按现有编辑结果写回。

访问日志在读取 Skill 时仍可记录文件里的 `roles_allowed` 快照。该快照不参与裁决。新的拒绝原因只保留 `skill_not_published`、`skill_deprecated` 和 `wiki_not_found`。

## 7. 验收

- SC-1 已发布且 `roles_allowed` 为空的 Skill，对一个 YAML 里没有 Skill 工具、也没有把该 Skill 写入任何名单的角色，发现和读取都允许。
- SC-2 草稿仍拒绝 `skill_not_published`，已停用仍拒绝 `skill_deprecated`。
- SC-3 无 frontmatter 的 Wiki、`allowed_roles` 不含当前角色的 Wiki、`sl_refs` 指向角色不可见语义对象的 Wiki，搜索和读取都允许。不存在的 key 仍是 `wiki_not_found`。
- SC-4 只配置了「只读问答」六个工具、且没有数据能力的角色，工具清单仍包含四个上下文工具，调用它们不被 `tool_forbidden`。调用 `lucy_query` 仍走原有表权限。
- SC-5 `initialize` 注入的 Governed Domain Skills 列出该环境全部已发布 Skill，不列出草稿和已停用。
- SC-6 Skill 编辑页、治理总览和保存预检不再出现「可访问角色」「所有角色可见」「无人可见」「角色授权」。保存已有 Skill 后，文件中的 `roles_allowed` 与保存前一致。
- SC-7 角色页不再出现「只读问答 + 知识库」和「业务 Skill」摘要。四个上下文工具没有复选框。
- SC-8 保存已有 Wiki 后，文件中的 `visibility` 和 `allowed_roles` 与保存前一致。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:
- None

Withdrawn from UI:
- 「可访问角色」「所有角色可见」「无人可见」「角色授权」不再出现在 Skill 工作台或角色页。
- 工具名 `wiki_search`、`wiki_read`、`lucy_skill_search`、`lucy_skill_read` 仍是保护术语；本 Spec 只是把它们移出角色勾选。

## Design System Compliance

删除现有授权控件和一条预设按钮。不新增按钮、颜色、网格或文案层级。
