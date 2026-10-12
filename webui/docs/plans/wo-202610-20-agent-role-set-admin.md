# WO-202610-20 Agent 角色多选

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-20 |
| 标题 | Agent 管理台接入已有的 Role Set，详情和新建改为复选框 |
| 状态 | 已实现。SC-1 至 SC-10 的自动化断言通过 |
| 来源 | 2026-10-12 对 `/admin/agents/demo_agent` 的核查。运行时支持 `roles[]`，页面和 Admin 写入仍是单选 `role` |
| 来源 Spec | `webui/docs/168-agent-role-set-admin-spec.md` v0.1 |
| 撰写日期 | 2026-10-12 |
| 适用范围 | Agent 详情、新建弹窗、列表筛选、Admin API、角色引用、治理用量、发布包、MCP 调试台、Skill 受众计数。不改能力合成 |

## 目标

按 Spec 168，管理员可以给一个 Agent 勾选多个正式角色。保存只落 `roles`，并删除 `role`。权限预览和治理门禁使用服务端合成结果。

## 任务

- [x] **T1 解析出口。** 导出 `resolveRoleIds`。角色引用、治理用量、发布包、MCP 调试台、Skill 受众和 Token 清单改走它。对应 SC-8、SC-10。

- [x] **T2 写入与读取。** `POST` / `PATCH` 接受 `roles`，兼容单字段 `role`，拒绝双字段、空集合、模板和无效角色。落盘只有 `roles`。GET 返回解析后的集合；双声明带 `roleResolutionError`。dryRun 在角色变化时返回 `effectivePermissions`。门禁数据源来自同一合成。对应 SC-1 至 SC-7。

- [x] **T3 页面。** 详情和新建改为复选框。列表、筛选、权限预览和变更摘要读取 `roles`。能力卡只展示 dryRun 的元组。对应 SC-6、SC-9。

- [x] **T4 测试、契约与索引。** 补 SC-1 至 SC-10 的断言。新 test id 写入 `docs/qa/selector-contract.md`。Spec 168、本工单、`webui/docs/README.md`、`03-api-spec.md` 与 Spec 14 的交叉引用一致。

## 实现顺序

1. T1 先导出解析，避免写入 `roles` 后引用计数和门禁仍只看见 `role`。
2. T2 接上读写，并让 dryRun 带回合成结果。
3. T3 页面只消费这份结果。
4. T4 收口。

## 验收口径

Spec 168 §8 的 SC-1 至 SC-10。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 \
  src/__tests__/agent-detail.test.tsx \
  src/__tests__/agent-list.test.tsx \
  server/__tests__/admin-agents.test.ts \
  server/__tests__/acl-capability.test.ts \
  server/__tests__/admin-roles.test.ts \
  server/__tests__/mcp-playground-acl-preview.test.ts
```

浏览器只做桌面。用新建的临时 Agent，不改 `demo_agent` 的已保存配置：打开详情，确认复选框且当前角色已勾选；再勾一个正式角色，看粘性保存条和变更预览里的 `roles`，以及能力卡来自接口；然后放弃修改。新建弹窗至少勾一个才能提交预览。

## 回滚

撤回复选框、`roles` 写入和 GET 的 `roles` 字段。`resolveRoleIds` 的运行时语义保持原样。已通过本工单保存过的 Agent 会留下 `roles` 而没有 `role`；回滚页面后这些 Agent 在旧下拉框里会显示为空，需要再把 `roles` 的第一项写回 `role` 才能在旧页面看见。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 保存时同时留下 `role` 和 `roles` | T2 写入角色集合时删除 `role`。只改名称不触碰这两个键 |
| 门禁只编译一个角色，漏掉第二个角色带来的数据源 | T2 用 `previewAgentPermissionsForAdmin` 取合成后的源 |
| 页面把两个角色的工具和表做叉乘 | T3 能力卡只渲染 dryRun 的 `capabilities` |
| 旧测试断言 YAML 里有 `role: analyst` | T4 改为断言 `roles` 列表，并断言该用户下没有 `role` |
