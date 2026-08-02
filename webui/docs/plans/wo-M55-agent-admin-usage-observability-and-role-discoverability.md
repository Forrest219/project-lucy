# M55 Agent Admin Usage Observability and Role Discoverability Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M55：Agent Admin 使用观测与 role 可发现性改版。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/07-mcp-auth-proxy-spec.md`
- `docs/08-mcp-audit-question-tracing-spec.md`
- `docs/14-agent-admin-enterprise-delivery-spec.md`
- `docs/15-role-admin-spec.md`
- `docs/57-agent-admin-usage-observability-and-role-discoverability-spec.md`
- `src/pages/admin/AgentList.tsx`
- `src/pages/admin/AgentDetail.tsx`
- `src/pages/admin/RoleList.tsx`
- `src/pages/admin/RoleDetail.tsx`
- `src/lib/types.ts`
- `server/admin/agents.ts`
- `server/proxy/acl.ts`
- `src/__tests__/agent-list.test.tsx`
- `src/__tests__/agent-detail.test.tsx`
- `src/__tests__/admin-roles.test.tsx`
- `server/__tests__/admin-agents.test.ts`

目标：

根据 2026-08-02 浏览器核查和用户反馈，重构 `/admin/agents` 的顶部指标和卡片摘要：用 `活跃 Token`、`近 7 天调用`、`近 7 天拒绝` 替代低解释度的 `Token 数` / `7d denied`；让 role id 可点击且可发现；弱化列表中的完整 MCP 工具清单；清理 demo smoke note；并在 role detail 中明确 `允许的 MCP 工具` 会过滤 `tools/list`、拦截未授权 `tools/call`。

## Scope

### Phase 1: Backend Usage Stats

1. 在 `server/admin/agents.ts` 扩展 `getStats(userId)`。
2. 新增 `activeTokensLast7d`：
   - 查询 `access_log`
   - 条件：`user_id = ?`
   - 条件：`ts >= datetime('now','-7 days')`
   - 条件：`token_hash_prefix IS NOT NULL`
   - 统计：`COUNT(DISTINCT token_hash_prefix)`
3. 在 `userToAgent` 中透传 `stats.activeTokensLast7d`。
4. 保持现有字段 `callsLast7d`、`deniedLast7d`、`lastSeen`、`topTables` 不变。
5. 可选：在 `GET /api/admin/agents` 响应中增加 `summary`，但不得破坏现有 `data.agents` 结构。

### Phase 2: Frontend Types And Helpers

1. 更新 `src/lib/types.ts` 中 Agent stats 类型。
2. 在 `AgentList.tsx` 中新增 helper：
   - `activeTokenCount(agent, now?)`
   - `configuredTokenCount(agent)`
   - `summarizeAgentUsage(agents, now?)`
3. 优先使用后端 `stats.activeTokensLast7d`；缺失时用 `token.last_used` fallback。
4. 测试中需要可注入 `now`，避免相对时间导致断言漂移。

### Phase 3: Top Metrics

1. 将当前指标：
   - `Agent 数`
   - `启用数`
   - `Token 数`
   - `7d denied`
2. 改为：
   - `Agent 数`
   - `活跃 Token`
   - `近 7 天调用`
   - `近 7 天拒绝`
3. PageHeader badges 保留：
   - `{agents.length} 个 Agent`
   - `{enabledCount} 已启用`
   - `{configuredTokenCount} 配置 Token`
4. `近 7 天拒绝` hint 使用 `outcome=denied` 或 `来自访问日志 access_log`。
5. 页面中不得再出现可见文案 `7d denied`。

### Phase 4: Agent Card Summary

1. 将 `role:` 改为 `角色：`。
2. 将 role id 渲染为 `<Link>`：
   - `to="/admin/roles/:roleId"`
   - accessible name：`查看角色 <roleId>`
3. 保持 role id 节点 `notranslate` / `translate="no"`。
4. 将首行摘要改为：
   - `角色：demo_readonly · 3 个授权源`
   - 如 legacy ACL：`旧 ACL · legacy wildcard`
5. 新增或重写 usage row：
   - `最近访问 1 天前 · 近 7 天 10 次调用 · 1 个活跃 Token · 0 次拒绝`
6. 新增静态配置 row：
   - `配置 Token：1 个`
7. 删除列表页默认完整 `Tool scope：connection_list, ...`。
8. 保留 `查看权限` 入口，建议指向 `/admin/agents/:userId?tab=permissions`。
9. `查看日志` 仍指向该 Agent 的 audit filter。

### Phase 5: Role Detail Tool Explanation

1. 在 `RoleDetail.tsx` 中将 MCP 工具 label 改为：
   - `允许的 MCP 工具`
2. 增加短说明：
   - `会过滤 tools/list，并拦截未授权 tools/call。`
3. `tools/list`、`tools/call`、tool names 使用 translation defense。
4. 在 `RoleList.tsx` 中把 `N 个工具` 改成 `允许的 MCP 工具：N 个` 或同等清晰文案。

### Phase 6: Demo Copy Cleanup

1. 更新 demo template note：
   - from `P0 demo smoke token; not for production.`
   - to `Demo 烟测账号，请勿用于生产。`
2. 覆盖文件：
   - `examples/docker-demo/project-template/webui/config/access.yaml`
   - `examples/postgres-demo/project-template/webui/config/access.yaml`
   - `customer-config.example/webui/config/access.yaml` 若存在同样旧文案
3. 不修改 `.ktx/secrets/**`。
4. 不修改当前真实本地 `webui/config/access.yaml` 中的用户 Token 内容，除非它也仅是 demo copy 且工单明确需要。

### Phase 7: Tests

1. 更新 `src/__tests__/agent-list.test.tsx`：
   - 断言顶部出现 `活跃 Token`
   - 断言顶部出现 `近 7 天调用`
   - 断言顶部出现 `近 7 天拒绝`
   - 断言不出现 `7d denied`
   - 断言 role id link 指向 `/admin/roles/demo_readonly`
   - 断言 Agent list 不展示完整 `Tool scope`
   - 断言 active token count 可由 `stats.activeTokensLast7d` 或 token `last_used` fallback 得出
2. 更新 `src/__tests__/admin-roles.test.tsx`：
   - 断言 role detail 展示 `允许的 MCP 工具`
   - 断言说明包含 `tools/list` 和 `tools/call`
3. 更新 `server/__tests__/admin-agents.test.ts`：
   - 插入多条 access_log，覆盖同一 token 多次调用去重
   - 覆盖 denied 统计不受 active token 去重影响
4. 如类型变动影响其它测试，同步修正。

## Implementation Notes

- 不要改变 ACL 判定顺序。`allowedToolNames` 与 `check` 是 runtime 安全边界。
- 不要把 role 权限复制到 Agent user 级字段；role 仍是 `users[].role` 引用。
- 不要在列表页展示所有 MCP 工具 chip；这个信息转移到 role / 权限详情。
- 不要引入新的后端存储表；active token 来自现有 `access_log`。
- 避免把 `Token 数` 继续作为无解释独立指标；需要静态数量时写 `配置 Token`。

## Acceptance Criteria

- `/admin/agents` 顶部指标为 `Agent 数 / 活跃 Token / 近 7 天调用 / 近 7 天拒绝`。
- PageHeader badge 显示配置 Token 数。
- Agent card role id 可点击到 role detail。
- Agent card 展示近 7 天调用、活跃 Token、拒绝次数。
- Agent card 不再默认展开完整 MCP 工具列表。
- Demo note 不再出现英文 smoke 文案。
- Role detail 明确 `允许的 MCP 工具` 的 runtime 影响。
- 后端 `GET /api/admin/agents` 返回 active token 统计。
- 所有新增可见专业术语与 id 节点满足翻译防御。

## Verification

```bash
cd webui
npm test -- src/__tests__/agent-list.test.tsx src/__tests__/agent-detail.test.tsx src/__tests__/admin-roles.test.tsx server/__tests__/admin-agents.test.ts
npm run lint:terminology
```

Browser check:

1. Open `/admin/agents`.
2. Confirm `7d denied` is absent.
3. Confirm metrics prioritize active Token and calls.
4. Click `demo_readonly` from `Demo Agent`.
5. Confirm role detail explains MCP tool filtering.

Mobile narrow viewport check is not required.

## Out of Scope

- Building dashboards or trend charts.
- Adding token-level ACL.
- Changing MCP Proxy runtime authorization.
- Editing production secrets or real user token plaintext.
