# WO-202610-22 Skill 与 Wiki 对所有角色开放

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-22 |
| 标题 | MVP 暂停 Skill 与 Wiki 对象授权，已发布内容默认对所有角色开放 |
| 状态 | 已实现 |
| 来源 | 2026-10-12 对 `/skills` 与 `/wiki` 的核查。对象授权和工具通道拆在两处，已发布 Skill 与未标注 Wiki 到不了 Agent |
| 来源 Spec | `webui/docs/170-mvp-open-skill-wiki-access-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | Proxy 工具清单与裁决、Skill ACL、Wiki ACL、`/skills`、角色工具预设、Skill / Wiki 保存回写。不改表权限，不批量改文件 |

## 目标

按 Spec 170，已解析且启用的 Agent 可以发现并读取全部已发布 Skill，也可以搜索和读取全部 Wiki。四个上下文工具始终可用。管理台去掉对应的授权控件。已有授权字段留在文件里。

## 任务

- [x] **T1 运行时放行。** `authorizeAndRewrite` 与 `allowedToolNames` 对 `wiki_search`、`wiki_read`、`lucy_skill_search`、`lucy_skill_read` 走 Spec 170 的上下文工具分支。`canAccessSkill` 只保留发布状态。`canAccessWikiPage` 在文档存在时允许。对应 SC-1 至 SC-5。

- [x] **T2 保存时保留旧字段。** 更新 Skill 时原样抄回 `roles_allowed`。更新 Wiki 时原样抄回 `visibility` 和 `allowed_roles`。新建 Skill 不写 `roles_allowed`。不写迁移脚本。对应 SC-6、SC-8。

- [x] **T3 管理台去掉授权入口。** Skill 编辑、总览和预检去掉角色授权。角色页删除「只读问答 + 知识库」、四个上下文工具复选框，以及「业务 Skill」摘要。预设匹配忽略这四个工具名。对应 SC-6、SC-7。

- [x] **T4 测试、术语与索引。** 更新本工单列出的测试。从 `docs/qa/selector-contract.md` 删除 `skill-roles-summary`、`skill-field-roles`、`skill-role-all`、`skill-role-option`、`skill-role-none`、`skill-role-unknown`、`skill-wildcard-ack`、`role-skill-access-summary`。术语标准、Spec 170、本工单、`webui/docs/README.md`、`docs/access-control/README.md` 的交叉引用一致。

## 实现顺序

1. T1 先让 Agent 能读到已发布内容，避免页面先改完、运行时仍拒绝。
2. T2 与 T1 一起落地，避免一次正文保存冲掉以后要恢复的授权字段。
3. T3 去掉已经失效的控件，避免管理员以为取消勾选会生效。
4. T4 收口。

## 验收口径

Spec 170 §7 的 SC-1 至 SC-8。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 \
  server/__tests__/skill-acl.test.ts \
  server/__tests__/mcp-proxy-skills.test.ts \
  server/__tests__/mcp-proxy-smoke.test.ts \
  server/__tests__/wiki-natural-language-search.test.ts \
  server/__tests__/failure-dimension.test.ts \
  server/__tests__/skills-admin-api.test.ts \
  server/__tests__/acl-capability.test.ts \
  src/__tests__/skill-list.test.tsx \
  src/__tests__/role-detail.test.tsx \
  src/__tests__/role-tool-grants.test.tsx
```

浏览器只做桌面。打开 `/skills`，确认总览没有「角色授权」，打开 `discount-analysis` 进入编辑后没有「可访问角色」。不保存。打开 `/admin/roles/lucy_admin` 的工具页，确认没有「只读问答 + 知识库」，自定义工具里没有四个上下文工具，右侧没有「业务 Skill」摘要。不保存。

Agent 侧用一个只带「只读问答」工具的角色重新建立 MCP 会话：`initialize` 说明里列出已发布 Skill，工具清单里有四个上下文工具，`wiki_search` 能返回当前 Wiki。该角色调用范围外的表仍然被拒绝。

## 回滚

撤回 T1 的放行和 T3 的界面删除。T2 没有改写旧字段，回滚后 Spec 151 与原 Wiki ACL 按文件里的 `roles_allowed`、`visibility`、`allowed_roles`、`sl_refs` 恢复。不需要数据迁移。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 开放上下文工具时把表权限一起放开 | T1 的上下文分支在允许后跳过表 ACL，数据面工具仍走原裁决。SC-4 覆盖 |
| 正文保存把 `roles_allowed` 或 `allowed_roles` 写成空 | T2 从旧文件抄回。SC-6、SC-8 覆盖 |
| 角色页仍显示可取消的 Wiki 或 Skill 工具，管理员以为已经关闭 | T3 从可编辑清单和知识库预设中移除。运行时始终并上这四个工具 |
| 草稿 Skill 被 Agent 读到 | T1 保留 `skill_not_published` 与 `skill_deprecated`。SC-2、SC-5 覆盖 |
| 历史审计里的 `wiki_forbidden` 无法再归类 | 不删除失败维度映射。本工单只保证新调用不再产生该原因 |
