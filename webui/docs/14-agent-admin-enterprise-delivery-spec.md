# Agent Admin Enterprise Delivery Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Enterprise Delivery Spec |
| 文档类型 | Product / UX Spec |
| 版本 | v0.1 |
| 撰写日期 | 2026-07-27 |
| 适用范围 | Lucy WebUI 访问治理模块：`/admin/agents`、新建 Agent 弹窗、`/admin/agents/:userId`、Token 交付流 |
| 事实源 | `webui/config/access.yaml`、Lucy MCP Proxy audit sqlite、Admin API |
| 关联文档 | `docs/access-control/design-governance-baseline.md`、`docs/access-control/design-upgrade.md`、`docs/agent-integration-guide.md`、`docs/admin-guide.md`、`docs/project-overview.md` |

## 1. 背景

访问治理模块已经具备 role-first Agent 管理、token 生成、dryRun diff、配置审计和访问日志查询能力。本 spec 的目标不是重写权限模型，而是把现有能力产品化成企业级 SaaS 管理台可交付体验：

- 管理员能在列表页快速判断 Agent 状态并复制接入配置。
- 新建 Agent 时能理解所选 role 的权限边界。
- Token 明文首秀能一次性交付给 Hermes、Claude Code、Codex 或通用 MCP client。
- 编辑详情页能闭环保存、Token 运维、权限预览和 YAML diff。

## 2. 设计立场

整体认同本轮优化建议，但需要保留以下边界：

1. `查看日志` 当前已跳转到 `/admin/audit?user=${agent.id}`，本轮只补回归验收，不重复设计。
2. 列表页不能复制历史 token 明文。Token 明文只在生成时出现一次，因此列表页的 `复制 MCP 配置` 只能复制使用环境变量或占位符的安全模板。
3. 新建 Agent 的按钮文案可以更贴近创建语义，但写入 `access.yaml` 必须继续走 dryRun diff -> 用户确认 -> `dryRun:false` 保存，不能绕开访问治理写入安全契约。

## 3. 目标用户与成功标准

目标用户是本地或企业管理员，常见任务是创建 Agent、发接入配置给同事、轮换 token、排查 Agent 权限和调用日志。

成功标准：

- 管理员不读 YAML 也能判断每个 Agent 的 role、可访问数据源、可用工具、最近访问和拒绝情况。
- 新建或编辑 Agent 时，权限变化先被解释清楚，再被写入配置。
- Token 首秀页面提供可直接粘贴到客户端的配置片段。
- 所有 destructive 或持久化动作仍保留确认、dryRun、审计和 version conflict 保护。

## 4. 范围

### 4.1 In Scope

- `/admin/agents` 列表页卡片文案和快捷操作。
- 新建 Agent modal 的 role 权限即时摘要。
- Agent 创建后的一次性 Token 交付首秀。
- `/admin/agents/:userId` 的 sticky 保存 bar、Token tab、Effective Permissions tree、Diff tab。
- 对应前端和后端测试。

### 4.2 Out Of Scope

- 新增登录或多管理员 RBAC。
- 改造 Lucy MCP Proxy runtime ACL 裁决逻辑。
- 列级、行级权限。
- 保存或重新展示 token 明文。
- 完整 revoked token history。若需要展示已撤销 token 历史，需另开后端聚合设计。

## 5. 页面 Spec

### 5.1 Agent 实例列表页

入口：`/admin/agents`

现状问题：

- 未访问空态显示为 `最近访问 -` 或等价破折号空态，交付感较弱。
- 卡片操作缺少把 MCP 配置交给 Agent 使用者的快捷动作。
- 日志跳转能力已存在，但缺少测试护栏。

目标行为：

- 最近访问空态显示 `未访问`。
- 有访问时间时，主文案优先显示相对时间，例如 `10 分钟前`、`2 小时前`、`3 天前`；同时通过 `title` 或辅助文本保留完整本地时间或 ISO 时间。
- Agent 卡片右侧提供 `复制 MCP 配置`。
- `复制 MCP 配置` 复制不含明文 token 的安全模板：

```json
{
  "mcpServers": {
    "lucy": {
      "url": "http://localhost:7879/mcp",
      "headers": {
        "Authorization": "Bearer ${LUCY_AGENT_TOKEN}"
      }
    }
  }
}
```

可选增强：

- 如果项目已有 endpoint 配置来源，URL 应从项目配置读取；否则 v0.1 继续使用当前本地默认 `http://localhost:7879/mcp`。
- 复制成功后用 toast 显示 `MCP 配置已复制`。

验收：

- 从未访问过的 Agent 卡片不出现破折号空态。
- 点击 `复制 MCP 配置` 后 clipboard 中没有历史 token 明文。
- `查看日志` 跳转 URL 保持 `/admin/audit?user=<agentId>`。

### 5.2 新建 Agent 弹窗

入口：`/admin/agents` -> `新建 Agent`

现状问题：

- 主按钮文案 `预览变更` 不符合新建场景直觉。
- Role 下拉只展示单行描述，权限透明度不足。
- 创建后没有直接进入 token 交付首秀。

目标行为：

- 表单字段：用户 ID、显示名、备注、角色。
- 主按钮文案调整为 `创建并预览配置` 或 `下一步：预览配置`。
- 选择 role 后，在 role 下方展示权限即时卡片：
  - 数据源数量：来自 `Role.sourceCount`。
  - Connections：来自 `Role.connections`。
  - MCP tools：来自 `Role.tools`，优先展示 `lucy_*`，兼容展示旧工具名。
  - Role source：`yaml` 或 `template`。
  - Warnings：`Role.warnings`。
- 仍执行现有两段式写入：
  1. `POST /api/admin/agents` with `dryRun:true`，显示 `access.yaml` diff。
  2. 用户确认后 `dryRun:false` 保存。
- 创建成功后进入 token 交付路径：
  - v0.1 推荐：关闭 modal 后跳转详情页并高亮 Token tab / `生成新 Token`。
  - 可选：在同一流里继续弹出生成 token 表单，但必须是创建 Agent 成功之后的第二个 API 调用。

验收：

- invalid role 置灰或明确展示警告，不允许保存。
- 创建 Agent 不接受 `allow` 字段。
- 使用 template role 创建后，落盘 YAML 展开为普通 role，不出现 `role-template`、`templateId` 等指针字段。

### 5.3 Token 首秀交付

入口：`/admin/agents/:userId/tokens/new`，或新建 Agent 成功后的后续弹窗。

目标行为：

- Token 明文只在生成成功后展示一次，保存在前端内存状态中，不写入 URL、本地存储、日志或 YAML。
- 显示 Token label、创建时间、过期时间。
- 提供复制明文 token 按钮。
- 提供客户端配置 tabs：
  - Hermes
  - Claude Code
  - Codex
  - Generic MCP
- 各配置片段可一键复制。因为这是 token 明文首秀，配置片段允许包含 `Bearer <generatedToken>`。
- 关闭前提示 `关闭后无法再次查看 token 明文`。

Generic MCP 配置示例：

```json
{
  "mcpServers": {
    "lucy": {
      "type": "http",
      "url": "http://localhost:7879/mcp",
      "headers": {
        "Authorization": "Bearer <generated-token>"
      }
    }
  }
}
```

验收：

- 页面关闭或导航离开后，不能通过 API 或 UI 重新获取明文 token。
- 复制配置时包含本次生成的明文 token。
- config_change_log 不包含明文 token。

### 5.4 Agent 编辑详情页

入口：`/admin/agents/:userId`

Tab：

- 基本信息
- Token
- 权限预览 (Effective Tree)
- 变更预览 (Diff)

#### 基本信息

字段：

- 用户 ID：只读。
- 显示名：可编辑。
- 备注：可编辑。
- 启用状态：toggle 或 checkbox。
- 角色：select。

目标行为：

- 任一字段修改后，页面底部出现 sticky 保存 bar。
- 保存 bar 包含：
  - 未保存提示。
  - `放弃修改`。
  - `预览并保存`。
- `预览并保存` 先调用 PATCH dryRun，成功后切到 Diff tab。
- Diff tab 确认后才调用 `dryRun:false`。
- 保存成功后清空 dirty 状态并刷新 Agent 数据。

#### Token

目标行为：

- 展示 active token 列表：
  - label
  - created
  - expires_at
  - last_used
  - last_tool
  - last_outcome
  - hash prefix
- 操作：
  - `生成新 Token`
  - `撤销 Token`
  - `复制 hash` 保留为调试动作，但不作为主要 CTA。

约束：

- 当前 YAML 删除 token 后只保留 revoked_tokens/audit 事实，不足以完整展示 revoked token history。本轮不承诺 revoked history，除非新增后端聚合 API。

#### 权限预览 (Effective Tree)

目标行为：

- 使用 `agent.effectivePermissions` 或 `GET /api/admin/agents/:userId/effective-permissions`。
- 渲染树：
  - Connection
  - Schema
  - Source / table
- 工具列表固定展示在树旁或树上方。
- `legacyAllow`、role invalid、selector 0 source 等场景展示明确 warning。

示例：

```text
mysql-aliyun
  dataforai
    superstore_orders -> dataforai.superstore_orders
    superstore_returns -> dataforai.superstore_returns

Allowed tools:
  lucy_catalog
  lucy_read_source
  lucy_query
  lucy_explain_query
```

#### 变更预览 (Diff)

目标行为：

- 显示本次 patch 对 `webui/config/access.yaml` 的 YAML diff。
- 无 diff 时提示先在其他 tab 编辑并预览。
- 保存按钮只在已生成 diff 时出现。
- 保持 version conflict 保护。

## 6. API 与数据约束

已有 API 优先复用：

- `GET /api/admin/agents`
- `GET /api/admin/agents/:userId`
- `POST /api/admin/agents`
- `PATCH /api/admin/agents/:userId`
- `DELETE /api/admin/agents/:userId`
- `GET /api/admin/roles`
- `GET /api/admin/agents/:userId/effective-permissions`
- `POST /api/admin/agents/:userId/tokens`
- `DELETE /api/admin/agents/:userId/tokens/:label`
- `GET /api/admin/audit?user=<agentId>`

新增 API 不是 v0.1 必需项。只有在实现 revoked token history 或动态 endpoint 发现时才另开 API 设计。

安全约束：

- 不保存 token 明文。
- 不复制历史 token 明文。
- 不绕过 dryRun 写入 `access.yaml`。
- 不新增第二套权限解析。
- 不读取 `.ktx/secrets`。

## 7. 可访问性与交互细节

- 所有复制按钮必须有可访问名称。
- Sticky 保存 bar 不遮挡页面最后一项内容，页面底部需要 padding。
- 操作按钮文案使用动词加对象，例如 `复制 MCP 配置`、`生成新 Token`、`撤销 Token`。
- 删除 Agent 和撤销 Token 保留确认。
- invalid role 和 legacy wildcard 使用明确的 warning 文案，不只依赖颜色。

## 8. 测试要求

前端测试：

- AgentList：最近访问空态、复制 MCP 配置、日志跳转。
- NewAgentModal：role 权限卡片、invalid role、dryRun -> confirm。
- NewToken：一次性 token 明文、配置 tabs、复制配置。
- AgentDetail：sticky 保存 bar、diff tab、Token list、Effective Tree。

后端测试：

- `admin-agents.test.ts`：create/patch dryRun、安全字段拒绝、role template 展开不留指针。
- `admin-tokens.test.ts`：token 明文只在 create 响应中出现、撤销优先写 revoked_tokens。

建议命令：

```bash
cd webui
npm test -- agent-detail new-token admin-agents admin-tokens
npm run build
```

## 9. Definition Of Done

- Spec 中 In Scope 项全部实现或明确降级记录。
- 测试命令通过。
- UI 不出现 `最近访问 -` 类破折号空态。
- 列表复制配置不包含历史明文 token。
- Token 首秀配置包含本次生成的明文 token。
- Agent 编辑必须经过 diff 预览才能保存。
- Effective Permissions tree 能按 connection/schema/source 解释实际权限。
- 相关用户文档或管理员指南在后续文档 pass 中同步。

