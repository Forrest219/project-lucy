# 权限治理优化任务分解（tasks）

| 元数据 | 内容 |
|---|---|
| 文档类型 | Tasks（可挂 kanban / Jira / Linear） |
| 版本 | v1.0 |
| 撰写日期 | 2026-06-22 |
| 关联 | inbox/access-governance-design-2026-06-22.md §4、inbox/access-governance-execution-plan-2026-06-22.md |
| 读者 | builder / reviewer / PM |

---

## 任务总览

| ID | 任务 | 阶段 | 估时 | 依赖 | Owner 占位 |
|---|---|---|---:|---|---|
| T-A1 | admin-agents/tokens 全量回归 + 缺则补 | A | 0.5d | — | reviewer-α |
| T-A2 | proxy ACL fail-closed 矩阵验证 | A | 0.5d | — | reviewer-β |
| T-B1 | 5 个 RoleTemplate 常量 + 展开函数 | B | 0.5d | — | builder-α |
| T-B2 | GET /api/admin/roles?includeTemplates + 单测 | B | 0.5d | T-B1 | builder-α |
| T-B3 | AdminList 模板选择 UI + 后端展开落盘 | B | 1d | T-B2 | builder-α |
| T-B4 | accessRolePolicy 新增 role-template 字段校验 | B | 0.5d | T-B3 | builder-β |
| T-C1 | Onboarding step 5 失败原因细分 | C | 0.5d | — | builder-γ |
| T-C2 | POST /api/admin/_reload + 默认触发 | C | 1d | DC1 | builder-δ |
| T-C3 | config_change_log CSV 导出端点 | C | 0.5d | — | builder-γ |
| T-D1 | inbox/access-governance-design 迁 docs/ | D | 0.5d | T-A1~T-C3 全绿 | thinker-α |
| T-D2 | project-overview §10 更新 | D | 0.25d | T-D1 | thinker-α |
| T-D3 | §3.2 spec 锚点迁新文档 | D | 0.25d | T-D1 | thinker-α |
| T-D4 | 关闭 spec-audit §8.1 异议 | D | 0.25d | T-D1 | PM |

总估时约 7 个工作人日（W26 + W27 半周内闭环）。

---

## 阶段 A：回归验证（W26 D1-D2）

### T-A1 · admin 写入路径全量回归

- **文件**：`webui/server/__tests__/admin-agents.test.ts`、`admin-tokens.test.ts`、`admin-audit.test.ts`
- **DoD**：
  - `npm test -- admin-agents -- admin-tokens -- admin-audit` 全绿
  - 覆盖以下用例（缺则补）：POST 拒绝 `agent.allow`（LEGACY_ALLOW_READONLY）/ POST 缺 role（ROLE_REQUIRED）/ POST role 不存在（INVALID_ROLE）/ POST dryRun→save 二段式 / POST legacy wildcard Agent 无法启用（LEGACY_WILDCARD_AGENT_REQUIRES_ROLE）/ DELETE Agent 触发 revoked_tokens / PATCH 设 role 自动 delete allow / version 冲突（VERSION_CONFLICT）
- **阻塞**：是；T-B1-B4 依赖
- **验收命令**：`cd webui && npm test -- admin`

### T-A2 · proxy ACL fail-closed 矩阵验证

- **文件**：`webui/server/__tests__/kx-acl.test.ts`、`mcp-proxy-acl.test.ts`
- **DoD**：
  - `npm test -- kx-acl -- mcp-proxy` 全绿
  - 覆盖：role 不存在 / selector 0 source / `tools:["*"]` / 表 role 缺 connections / `defaults.deny_tools` 命中 → ACL 拒绝，不回退 allow
  - 若不足，按 `docs/design-agent-permissions.md §7` 矩阵补
- **阻塞**：是；T-B3 依赖（previewRolePermissionsForAdmin 必须 fail-closed）
- **验收命令**：`cd webui && npm test -- kx-acl`

---

## 阶段 B：模板库主线（W26 D2-D5）

### T-B1 · RoleTemplate 常量 + 展开函数

- **文件**：`webui/server/admin/role-templates.ts`（新增）、`webui/src/lib/types.ts`（新增 `RoleTemplate` 类型）
- **内容**：
  - `ROLE_TEMPLATES: Record<string, RoleTemplate>` 包含 §3.1 表中 5 个模板
  - 导出 `expandTemplate(templateId): YamlRole` 纯函数
- **DoD**：
  - 5 个模板常量导出；`expandTemplate` 对每个模板可生成完整 YamlRole
  - 单元测试：5 个模板各自的 expand 输出符合预期 selector 数量
  - `npx tsc --noEmit` 通过
- **阻塞**：是；T-B2 依赖

### T-B2 · GET /api/admin/roles 暴露模板

- **文件**：`webui/server/admin/agents.ts`、`webui/server/__tests__/admin-roles.test.ts`（新增）
- **内容**：
  - 增加 `?includeTemplates=true` query（默认 true）
  - 返回数组每项增加 `source: "yaml" | "template"` 字段
  - yaml role 与模板合并去重（id 冲突时 yaml 优先，模板不覆盖）
- **DoD**：
  - 单测：无 yaml role 时返回 5 个 template；yaml 有 `kx_readonly` 时返回 5 个（去重后 4 template + 1 yaml）
  - `globalDenied` 与 `invalid` 字段行为对 yaml role 与 template 一致
- **阻塞**：是；T-B3 依赖

### T-B3 · AdminList 模板选择 UI + 后端展开落盘

- **文件**：`webui/src/pages/admin/AgentList.tsx`、`webui/server/admin/agents.ts`、`webui/src/__tests__/agent-detail.test.tsx`（如有需要）
- **内容**：
  - 新建 Agent 弹窗的角色下拉同时展示 yaml role 与 template，下拉项标注 `(template)`
  - 选 template 时前端只传 `role: <templateId>`，**后端在写入前调 `expandTemplate` 把 role 展开为完整 YamlRole**
  - 写入后 `git diff access.yaml` 只新增 `role:` + `allow:` 字段，**不**出现 `role-template` / `templateId` 等指针
- **DoD**：
  - 新建 `wangwu / 王五 / dev_superstore` → diff 看到完整 allow
  - yaml 中无 `role-template` 字段
  - 前端 RTL 测试覆盖：选 template 后弹窗表单仍可编辑 name/note，role 字段展示 template description 并不可改
- **阻塞**：是；T-B4 依赖（lint 规则针对的就是这条写入路径）

### T-B4 · accessRolePolicy 新增 role-template 字段校验

- **文件**：`scripts/lint-spec.mjs`、`scripts/__tests__/lint-spec-role-template.test.mjs`（新增）
- **内容**：
  - 在 `accessRolePolicy()` 函数内增加字段白名单检查
  - 字段白名单基于 `webui/server/admin/agents.ts` 中 `YamlRole` / `YamlUser` / `YamlToken` / `defaults` 的已知子键
  - 任何 role 块 / user 块 / role 顶层出现非白名单字段一律 `fail`，字段名原样写进 error message
- **DoD**：
  - 用模板创建 Agent 后 `npm run lint:spec` exit 0
  - 手动往 yaml 加 `role-template: foo` → `npm run lint:spec` exit 1，错误信息含字段名
  - 单测覆盖 4 种字段（`role-template` / `templateId` / `templateRef` / `_template`）+ 合法 yaml 不误伤
  - 复用同一脚本、同一 release gate job；**不**新建 workflow step
- **阻塞**：是；T-D1 / T-D4 依赖（关闭 Opus 异议）

---

## 阶段 C：治理配套（W26 D4 - W27 D3）

### T-C1 · Onboarding step 5 失败原因细分

- **文件**：`webui/src/pages/Onboarding.tsx`、`webui/src/__tests__/onboarding.test.tsx`
- **内容**：把当前 `mcpReady = agents.length > 0 && tokenCount > 0` 拆为 4 类细分原因：无 Agent / 无可用 token / Agent 全 disabled / 全是 legacy allow 未迁移
- **DoD**：
  - UI 在 mcpReady=false 时显示具体原因文案
  - RTL 测试覆盖 4 类原因
- **阻塞**：否

### T-C2 · POST /api/admin/_reload 主动 reload

- **文件**：`webui/server/admin/reload.ts`（新增）、`webui/server/proxy/identity.ts`、`webui/server/__tests__/reload.test.ts`
- **前置**：DC1（A4 决策）
- **内容**：
  - `POST /api/admin/_reload` 触发 proxy 重读 access.yaml 并清缓存
  - PATCH `enabled:false` 与 token revoke 默认触发 `?reload=true`
  - 失败时响应明确告知 TTL 窗口
- **DoD**：
  - 撤销后 ≤2s 旧 token 401
  - feature flag `admin.reload.enabled` 默认 true；false 时不调用，保留 TTL 路径
  - 单测覆盖成功路径与失败回退
- **阻塞**：否；但 DC1 决策未定则推迟

### T-C3 · config_change_log CSV 导出

- **文件**：`webui/server/admin/config-audit.ts`、`webui/server/__tests__/admin-audit.test.ts`
- **内容**：`GET /api/admin/config-audit/export.csv`，与现有 audit 导出对齐（query 参数、Content-Disposition header）
- **DoD**：
  - 流式返回；header 含 `Content-Disposition: attachment; filename="config-audit-YYYYMMDD.csv"`
  - 单测覆盖空查询、过滤查询、UTF-8 BOM
- **阻塞**：否

---

## 阶段 D：文档与沟通闭环（W27 D3 - W27 D5）

### T-D1 · inbox 文档迁 docs/

- **文件**：`docs/access-governance-design.md`（新增）、`inbox/access-governance-design-2026-06-22.md`（留 `已迁移` 标签或删除）
- **DoD**：
  - 内容与 inbox 版一致
  - 文件元数据更新为「类型：Design；版本：v1.0；落位：docs/」
  - inbox 留 1 行归档说明或删除

### T-D2 · project-overview §10 更新

- **文件**：`docs/project-overview.md`
- **DoD**：
  - 第 1 项后追加：「✅ 2026-06-22 P0-1 Admin Role-First 已闭环；剩余 Role 模板库 / Policy 表达式 / lint:spec 见 `docs/access-governance-design.md`」

### T-D3 · §3.2 spec 锚点迁新文档

- **文件**：`docs/access-governance-design.md`
- **DoD**：
  - 第二节存在；与 inbox §3.2 内容一致

### T-D4 · 关闭 spec-audit §8.1 异议

- **渠道**：项目周报 / issue 评论 / Slack #lucy-platform
- **内容**：引用 Opus 修正意见 + 本方案 §1.3 / §3.3 / §5 #9 验证证据
- **DoD**：
  - issue 状态 closed 或周报中明示已闭环
  - 引用本方案的 docs/access-governance-design.md 路径

---

## 任务依赖关系

```
T-A1 ──┐
T-A2 ──┤
       ├──► T-B1 ──► T-B2 ──► T-B3 ──► T-B4 ──► T-D1
       │                                          │
       ├──► T-C1（独立）                          ├──► T-D2
       ├──► T-C2（需 DC1）                        ├──► T-D3
       └──► T-C3（独立）                          └──► T-D4
```

---

## 验收命令汇总

```bash
# 阶段 A
cd webui && npm test -- admin-agents admin-tokens admin-audit
cd webui && npm test -- kx-acl mcp-proxy

# 阶段 B（模板库落地后）
cd webui && npm test -- admin-roles
cd webui && npx tsc --noEmit
git diff webui/config/access.yaml  # 仅看新增 role + allow，无 role-template
npm run lint:spec                  # exit 0

# 阶段 C
cd webui && npm test -- onboarding reload admin-audit

# 阶段 D（最终）
cd webui && npm test -- admin-agents admin-tokens admin-audit admin-roles \
                     mcp-proxy kx-acl fs-safe onboarding reload
cd webui && npx tsc --noEmit
npm run lint:spec
npm run smoke:p0
```

— 完