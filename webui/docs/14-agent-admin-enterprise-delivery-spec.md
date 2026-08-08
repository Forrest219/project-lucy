# Agent Admin Enterprise Delivery Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Agent Admin Enterprise Delivery Spec |
| 文档类型 | Product / UX Spec |
| 版本 | v0.2（AC-P0 契约补丁草稿 / WP-S1；Gate B 前） |
| 撰写日期 | 2026-07-27；v0.2 补丁 2026-08-08 |
| 适用范围 | Lucy WebUI 访问治理模块：`/admin/agents`、新建 Agent 弹窗、`/admin/agents/:userId`、Token 交付流；v0.2 对齐 AC-P0 Admin 契约 |
| 事实源 | `webui/config/access.yaml`、Lucy MCP Proxy audit sqlite、Admin API；AC-P0 语义权威 [`98-access-control-p0-runtime-spec.md`](98-access-control-p0-runtime-spec.md) |
| 关联文档 | `docs/access-control/design-governance-baseline.md`、`docs/access-control/design-upgrade.md` §9、`webui/docs/07-mcp-auth-proxy-spec.md` v1.4、`webui/docs/15-role-admin-spec.md`、`docs/agent-integration-guide.md`、`docs/admin-guide.md`、`docs/project-overview.md` |
| 冲突裁决 | AC-P0 安全 / 合成语义以 Spec 98 为准；与 `design-upgrade.md` 冲突 → design-upgrade |

## 0. AC-P0 契约补丁（WP-S1）

> **权威语义：** Capability 代数、版本迁移、编译提交 → Spec 98。本文只修订 Agent Admin 的 **API / UX / 保存回执** 契约，禁止另写第二套权限摘要口径。

### 0.1 相对 v0.1 的增量

| 项 | v0.1 | AC-P0（本补丁） | Spec 98 锚点 |
|---|---|---|---|
| Agent–Role 绑定 | 单选 `role` | `roles: string[]`（Role Set）；UI 可先交付多选；legacy 单 `role` 读写视为单元素 `roles` | §3 |
| 权限预览 | Effective Tree：表树 + 旁列 Allowed tools（双并集观感） | **Data Capability Preview**：工具 × 规范源键 × 行授予列表；**禁止**只展示 tools∪ + sources∪ 两列作为唯一摘要 | §5；术语 §4.8 |
| 保存成功 | dryRun → 写盘成功即成功 | 写盘成功且 **`runtimeAck: true`** 且返回 `policyVersion` 才显示成功；收窄失败盘与 runtime 均保持写前 | §8.2 |
| 版本 / prefix | 未涉及 | 编辑导致引用 Role 升 v2 / `prefix` 展开时，dryRun diff 必须可见（展开细节以 Role Admin Spec 15 为准） | §7 |
| 行级 Out of Scope | 「列级、行级权限」 | 波次边界：AC-P0 不交付 scoped；AC-P1 另批（与 Spec 07 §3 / Spec 98 §2 同口径） | §2 |

### 0.2 `roles[]` 契约

```ts
// Agent 写模型（AC-P0）
type AgentRoleBinding =
  | { roles: string[] }           // 推荐
  | { role: string }              // legacy 读兼容；≡ roles: [role]
// 禁止同时出现 role 与 roles → 400 / 保存拒绝
```

- 新建 Agent：表单写入 `roles`（至少 1 个）；不得写 `users[].allow`。
- 列表 / 详情展示：多 Role 时展示 Role Set（芯片或列表），不得静默只显示第一个。
- Preview / effective-permissions API 必须按 **Role Set 合成后的 capability** 返回（合成规则不在本文复述 → Spec 98 §5）。

### 0.3 保存回执：`runtimeAck` + `policyVersion`

`POST/PATCH /api/admin/agents`（`dryRun:false`）及导致权限收窄的 Token 撤销 / Agent 禁用路径，成功响应必须包含：

```ts
{
  ok: true;
  data: {
    // …既有字段
    policyVersion: string;
    runtimeAck: true;  // 仅当 runtime 已原子切换到新 Effective Policy
  }
}
```

| 情况 | HTTP / UI |
|---|---|
| 编译失败 | 不写盘、不切 runtime；保存失败；展示原因 |
| 写盘成功但 runtime 切换失败 | 回滚磁盘；`runtimeAck` 不得为 true；UI **不得**提示保存成功 |
| 成功 | `runtimeAck: true` + 展示 / 可复制 `policyVersion` |

### 0.4 与 design-upgrade §9（Admin API 行）对照

| 要求 | 落点 |
|---|---|
| `roles[]` | §0.2、§5.2、§5.4 |
| `runtimeAck` | §0.3、§5.4 Diff 保存 |
| 版本迁移与 `prefix` 展开 dryRun | 引用 Role 时可见；展开编辑在 Spec 15 |
| 禁只展示 tools∪+sources∪ | §0.1、§5.2 权限卡片、§5.4 权限预览 |

---

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
- 改造 Lucy MCP Proxy runtime ACL 裁决逻辑的**实现**（语义以 Spec 98 为准；本 Spec 只约束 Admin 契约与展示；Gate B 前不改代码）。
- **波次边界：** AC-P0 不交付列级权限、`row_access: scoped` / Row Policy；AC-P1 另批。不得将本条写成「产品永不做行级」。
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

- 表单字段：用户 ID、显示名、备注、**角色（AC-P0：Role Set / `roles[]`，至少选 1 个）**。
- 主按钮文案调整为 `创建并预览配置` 或 `下一步：预览配置`。
- 选择 role(s) 后，在下方展示**数据能力即时卡片**（术语：Data Capability Preview）：
  - **主展示：** capability 元组列表（工具 × 规范源键；AC-P0 行授予恒为「全部行」/ TRUE）。多 Role 时展示**合成后**集合，禁止分别展示后再在前端做 tools∪×sources∪。
  - 辅助统计（可选）：数据源数量、Connections、Role source（`yaml` / `template`）、Warnings。
  - MCP tools 元信息工具可单独标注为 Meta；**不得**用「Allowed tools 一列 + 表树一列」作为**唯一**权限摘要。
- 仍执行现有两段式写入：
  1. `POST /api/admin/agents` with `dryRun:true`，显示 `access.yaml` diff（含将写入的 `roles`）。
  2. 用户确认后 `dryRun:false` 保存；成功条件见 §0.3（`runtimeAck`）。
- 创建成功后进入 token 交付路径：
  - v0.1 推荐：关闭 modal 后跳转详情页并高亮 Token tab / `生成新 Token`。
  - 可选：在同一流里继续弹出生成 token 表单，但必须是创建 Agent 成功之后的第二个 API 调用。

验收：

- invalid role 置灰或明确展示警告，不允许保存。
- 创建 Agent 不接受 `allow` 字段；写入 `roles`（或兼容单 `role` 展开为单元素数组）。
- 权限卡片不得仅展示工具并集 + 表并集。
- 使用 template role 创建后，落盘 YAML 展开为普通 role，不出现 `role-template`、`templateId` 等指针字段。
- 保存成功 UI 仅在 `runtimeAck: true` 时出现。

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
- 权限预览（Data Capability Preview；历史名 Effective Tree）
- 变更预览 (Diff)

#### 基本信息

字段：

- 用户 ID：只读。
- 显示名：可编辑。
- 备注：可编辑。
- 启用状态：toggle 或 checkbox。
- 角色：**Role Set 多选（`roles[]`）**；旁链「管理角色」→ `/admin/roles`。

目标行为：

- 任一字段修改后，页面底部出现 sticky 保存 bar。
- 保存 bar 包含：
  - 未保存提示。
  - `放弃修改`。
  - `预览并保存`。
- `预览并保存` 先调用 PATCH dryRun，成功后切到 Diff tab。
- Diff tab 确认后才调用 `dryRun:false`。
- 保存成功条件：响应含 `runtimeAck: true` 与 `policyVersion`；然后清空 dirty 状态并刷新 Agent 数据。否则展示失败原因，保持 dirty。

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

#### 权限预览 (Data Capability Preview)

目标行为：

- 使用 `agent.effectivePermissions` 或 `GET /api/admin/agents/:userId/effective-permissions`。
- **主渲染：capability 列表**（每行至少：tool、canonical source key 四元组、rowGrant；AC-P0 rowGrant 展示为「全部行」或省略为隐含 TRUE）。
- 可按 connection / schema 分组折叠，但分组不得退化成「先并 tools、再并 sources」的两栏唯一视图。
- Meta 工具可单独一区列出（无 source 绑定）。
- `legacyAllow`、role invalid、selector 0 source、策略降级等场景展示明确 warning。
- 展示当前 `policyVersion`（只读），与 Spec 07 审计字段同口径。

禁止：

- 仅展示「Allowed tools」列表 + 表树、而不展示 tool×source 绑定关系。
- 用 `(∪tools)×(∪sources)` 前端自行叉乘冒充合成结果。

示例（示意）：

```text
Capabilities:
  lucy_query        × mysql-aliyun | dataforai | fact_fin | dataforai.fact_fin
  lucy_query        × mysql-aliyun | dataforai | dim_account | dataforai.dim_account
  lucy_read_source  × mysql-aliyun | dataforai | dim_vendor | dataforai.dim_vendor
Meta tools:
  lucy_catalog
policyVersion: <hex>
```

#### 变更预览 (Diff)

目标行为：

- 显示本次 patch 对 `webui/config/access.yaml` 的 YAML diff（含 `roles` / 单 `role` 迁移为 `roles` 的变更）。
- 若保存路径触发关联 Role 的 v1→v2 / `prefix`→`names` 展开，diff 中必须可见（或明确提示需先在 Role Admin 完成迁移）。
- 无 diff 时提示先在其他 tab 编辑并预览。
- 保存按钮只在已生成 diff 时出现。
- 保持 version conflict 保护。
- 确认保存后按 §0.3 解释 `runtimeAck`。

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
- 不新增第二套权限解析（preview / effective-permissions 必须复用 Spec 98 同一合成器）。
- 不读取 `.ktx/secrets`。
- 保存成功 UI 依赖 `runtimeAck: true`；禁止「仅写盘成功」即提示权限已收窄。

## 7. 可访问性与交互细节

- 所有复制按钮必须有可访问名称。
- Sticky 保存 bar 不遮挡页面最后一项内容，页面底部需要 padding。
- 操作按钮文案使用动词加对象，例如 `复制 MCP 配置`、`生成新 Token`、`撤销 Token`。
- 删除 Agent 和撤销 Token 保留确认。
- invalid role 和 legacy wildcard 使用明确的 warning 文案，不只依赖颜色。

## 8. 测试要求

前端测试：

- AgentList：最近访问空态、复制 MCP 配置、日志跳转。
- NewAgentModal：Role Set、capability 卡片（非双并集）、invalid role、dryRun -> confirm。
- NewToken：一次性 token 明文、配置 tabs、复制配置。
- AgentDetail：sticky 保存 bar、diff tab、Token list、Data Capability Preview、`runtimeAck` 成功路径。

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
- Agent 编辑必须经过 diff 预览才能保存；成功仅当 `runtimeAck: true`。
- Data Capability Preview 按 tool × 规范源键解释实际权限；不得仅双并集。
- 相关用户文档或管理员指南在后续文档 pass 中同步。

