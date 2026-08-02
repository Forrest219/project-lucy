# M57 Role Admin Ops UX Clarification Work Order

## Codex Prompt

请在 `/Users/zhangxingchen/Projects/project-lucy/webui` 中实现 M57：Role Admin 运维心智与参考模板降噪改版。

必须先阅读：

- `../docs/DEVELOPMENT.md`
- `docs/00-product-terminology-standard.md`
- `docs/14-agent-admin-enterprise-delivery-spec.md`
- `docs/15-role-admin-spec.md`
- `docs/42-page-header-standardization-spec.md`
- `docs/57-agent-admin-usage-observability-and-role-discoverability-spec.md`
- `docs/59-role-admin-ops-ux-clarification-spec.md`
- `src/pages/admin/RoleList.tsx`
- `src/pages/admin/RoleDetail.tsx`
- `src/pages/admin/AgentList.tsx`
- `src/lib/types.ts`
- `server/admin/roles.ts`
- `server/admin/role-templates.ts`
- `server/proxy/acl.ts`
- `src/__tests__/role-list.test.tsx`
- `src/__tests__/role-detail.test.tsx`
- `src/__tests__/agent-list.test.tsx`
- `server/__tests__/admin-roles.test.ts`

目标：

根据 2026-08-02 浏览器核查和用户反馈，将 `/admin/roles` 从“模板平铺列表”调整为“角色权限运维状态页”：默认聚焦正式 Role、正在服务 Agent、待修复和未被 Agent 使用；将参考模板降级为低频辅助入口；明确 `待修复` 与 `已停用` 不是同一含义；移除裸露英文 `Template / Invalid / in use`；并把 `复制为 YAML Role` 改为更明确、更低频的创建路径。

## Scope

### Phase 1: Role List Tests First

1. 更新 `src/__tests__/role-list.test.tsx`。
2. 新增或改写测试，覆盖：
   - Header 不再展示 `1 YAML role / 6 template / 4 invalid` 类重复 badge。
   - 顶部 metric 展示 `正式 Role`、`正在服务 Agent`、`待修复`、`未被 Agent 使用`。
   - 页面默认不把 `参考模板` 作为 KPI。
   - filter option 使用中文业务口径：`全部正式 Role`、`正在服务 Agent`、`待修复`、`未被 Agent 使用`、`参考模板`。
   - `invalid` role card 显示 `待修复`，不显示 `Invalid`。
   - template role card 显示 `参考模板`，不显示 `Template`。
   - in-use role card 显示 `正在服务 Agent`，不显示 `in use`。
   - invalid 不被翻译成 `已停用` 或 `禁用`。
   - `lucy_r1_exact_readonly` 列表描述为中文业务 / 运维说明。
   - template card 列表页不再出现 `复制为 YAML Role` 主按钮。
3. 运行目标测试，确认先失败。

### Phase 2: Role List Helpers And Terminology

1. 在 `src/pages/admin/RoleList.tsx` 中新增小型 helper：
   - `roleSourceLabel(role)`
   - `roleStatusBadges(role)`
   - `roleWarningDiagnosis(warning)`
   - `summarizeRoles(roles)`
2. 映射规则：
   - `source="yaml"` -> `正式 Role` 或 `已落盘`
   - `source="template"` -> `参考模板`
   - `invalid=true` -> `待修复`
   - `usageCount > 0` -> `正在服务 Agent`
3. `role_resolution_failed:<roleId>` 映射为：
   - `权限解析失败：当前配置无法生成有效的数据源 / MCP 工具边界。`
4. 技术 reason 用 `<code translate="no" className="notranslate">` 渲染。
5. 不新增全局 abstraction；保持 helper 与页面局部相关。

### Phase 3: Header And Metrics

1. 修改 `RoleList.tsx` 的 `PageHeader`：
   - 删除 `badges` 中的 role 计数。
   - Header description 改为：
     `管理 Agent 可访问的数据源和 MCP 工具边界。正式 Role 写入 access.yaml；参考模板仅用于低频创建辅助。`
   - 只保留主操作 `新建 Role`。
2. 将 metric cards 改为：
   - `正式 Role`
   - `正在服务 Agent`
   - `待修复`
   - `未被 Agent 使用`
3. `待修复` metric 使用 danger tone。
4. 如果 `MetricCard` 当前不支持 tone，可局部扩展 props，不影响其它页面。
5. 所有 `access.yaml`、`Agent`、`MCP` 节点加 translation defense。

### Phase 4: Filters And Status Strip

1. 将 `SourceFilter` 改为业务范围枚举，例如：
   - `formal`
   - `in-use`
   - `needs-repair`
   - `unused`
   - `templates`
2. 默认 filter 为 `formal`。
3. 将 select `aria-label` 改为 `筛选角色范围`。
4. options 文案：
   - `全部正式 Role`
   - `正在服务 Agent`
   - `待修复`
   - `未被 Agent 使用`
   - `参考模板`
5. 替换弱 summary：
   - from `{yamlCount} yaml · {templateCount} template · {invalidCount} invalid`
   - to `当前：N 个正式 Role · N 个正在服务 Agent · N 个待修复 · N 个参考模板`
6. summary 中 `待修复` 使用 danger badge，`参考模板` 使用 neutral badge。

### Phase 5: Role Cards

1. 调整 badge rendering：
   - Template source badge 使用 neutral / subtle tone。
   - Invalid badge 使用 danger tone，文案 `待修复`。
   - In-use badge 使用 success / included tone，文案 `正在服务 Agent`。
2. 红色边框仅由 `role.invalid` 控制，但必须同时显示中文诊断。
3. Role description:
   - 优先使用 API description。
   - 对已知 `lucy_r1_exact_readonly` 模板，后端或前端应显示中文业务 / 运维描述。
4. warnings:
   - 列表显示中文诊断。
   - 技术 reason 放在次级 `技术详情` 行。
5. role id、tool names、warning reason 均加 translation defense。

### Phase 6: Template Actions And Detail Copy

1. 在 `RoleList.tsx` 中 template card 只保留：
   - `查看`
2. 移除列表页重复主按钮 `复制为 YAML Role`。
3. 在 `RoleDetail.tsx` 的 template read-only 区域，将 CTA 改为：
   - `基于此模板创建 Role`
4. 更新 helper text：
   - `创建后会写入 access.yaml，成为可编辑、可分配给 Agent 的正式 Role。保存前必须确认 YAML diff。`
5. 如存在 `从模板复制` 顶部入口，将其移动到新建 Role 流程内或降级为次级入口，不再放 PageHeader 主操作区。
6. 保持 copy route `/admin/roles/:roleId?mode=copy` 与后端 `POST /api/admin/roles/:roleId/copy` 不变。

### Phase 7: Template Description Cleanup

1. 修改 `server/admin/role-templates.ts` 中 `lucy_r1_exact_readonly.description`：
   - from `Lucy R1 发布证据账号模板 — exact 6-tool controlled data service surface`
   - to `Lucy R1 发布证据账号模板：仅允许访问 POC 数据源和 6 个受控查询工具。用于发布验收，不建议作为日常 Agent 角色。`
2. 检查其它模板描述是否有裸露英文内部短语。
3. 不改变 template allow.tools / allow.connections / tableSelectors。
4. 更新相关后端或前端测试断言。

### Phase 8: Agent List Integration Check

1. 检查 `AgentList.tsx` 中 role source / invalid 文案。
2. 如果仍显示 `(template)` 或 `(invalid)`，改为：
   - `参考模板`
   - `待修复`
3. 不改变 M55 的活跃 Token、近 7 天调用、近 7 天拒绝逻辑。
4. 确保 Agent 列表不会把 invalid role 显示成 `已停用`。

### Phase 9: Verification

1. 运行：

```bash
cd webui
npm test -- src/__tests__/role-list.test.tsx src/__tests__/role-detail.test.tsx src/__tests__/agent-list.test.tsx server/__tests__/admin-roles.test.ts
npm run lint:terminology
```

2. Browser check:
   - Open `/admin/roles`.
   - Confirm header duplicate badges are absent.
   - Confirm default metrics are `正式 Role / 正在服务 Agent / 待修复 / 未被 Agent 使用`.
   - Confirm filter labels are Chinese and business-oriented.
   - Confirm `Template` / `Invalid` / `in use` no longer appear as visible role status text.
   - Confirm `lucy_r1_exact_readonly` has Chinese business / ops description.
   - Confirm template list cards do not show `复制为 YAML Role`.
   - Open template detail and confirm CTA `基于此模板创建 Role`.

## Implementation Notes

- Do not translate `invalid` as `已停用` or `禁用`; those require a future lifecycle field.
- Do not remove role template support.
- Do not change ACL runtime behavior.
- Do not change `access.yaml` schema.
- Do not make reference templates the default page KPI.
- Keep red / danger styling tied to `待修复`, not to `参考模板`.
- Preserve dryRun-first copy/create behavior.
- Follow translation defense for `Agent`、`MCP`、`YAML`、`access.yaml`、role id、tool names and technical warning reasons.

## Acceptance Criteria

- `/admin/roles` reads as a role permission operations page, not a template picker.
- Header duplicate count badges are removed.
- Template count is not a default KPI.
- `待修复` and `已停用` are treated as distinct concepts.
- `invalid` renders as `待修复`, never as `禁用` or `已停用`.
- Reference templates are neutral and low-frequency.
- Role card status labels are Chinese and business-oriented.
- Technical warnings are translated into user-readable diagnosis with technical detail preserved.
- `复制为 YAML Role` is replaced or moved to a lower-frequency create path.
- Tests and terminology lint pass.

## Out of Scope

- Adding role lifecycle / disabled schema.
- Removing templates.
- Changing MCP Proxy ACL.
- Adding approval workflow.
- Mobile narrow viewport validation.
