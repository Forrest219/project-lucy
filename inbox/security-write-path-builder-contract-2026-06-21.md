# 安全写路径 Builder 契约

| 项 | 内容 |
|---|---|
| 文档类型 | Builder 契约草案 |
| 生成日期 | 2026-06-21 |
| 基于材料 | `inbox/spec-remediation-plan-2026-06-21.md`、`inbox/thinker-review-spec-delivery-2026-06-21.md` |
| 适用范围 | P0-1 Admin role-first 写路径、P0-2 `ktx.yaml` enabled_tables 写路径 |
| 状态 | 交付 builder 前置契约；未执行代码修改 |

## 1. 交付边界

本契约只定义 builder 执行安全写路径整改前必须遵守的 API、数据模型、迁移语义和验收标准。正式代码修改另行执行。

不得在本契约落地前直接修改：

- `webui/server/admin/agents.ts`
- `webui/server/admin/tokens.ts`
- `webui/server/index.ts` 中 connection write route
- `webui/server/proxy/acl.ts`
- `webui/config/access.yaml` 的结构性内容

可先执行的低风险项见 `inbox/thinker-review-spec-delivery-2026-06-21.md` 的“立即可交付包”。

## 2. P0-1 Admin Role-First 契约

### 2.1 目标行为

Admin 写入路径必须与 `design-agent-permissions.md v1.2` 对齐：

- 新建 Agent 必须选择 `role`。
- 新建 / 修改 Agent 不再接受 `allow`。
- legacy `users[].allow` 只读兼容，不通过 UI/API 继续生成。
- Admin API 不得创建或重新启用 effective permissions 为全权通配的 Agent。
- `roles:` 和 `defaults:` 必须无损保留。

### 2.2 Admin YAML 类型

后端 admin 侧必须显式建模：

```ts
type YamlRole = {
  description?: string;
  allow: {
    connections?: string[];
    tableSelectors?: Array<
      | { connection?: string; schema: string; names: string[] }
      | { connection?: string; schema: string; prefix: string }
    >;
    tools: string[];
  };
};

type YamlUser = {
  id: string;
  name: string;
  note?: string;
  enabled?: boolean;
  role?: string;
  tokens: YamlToken[];
  allow?: {
    tables?: string[];
    tools?: string[];
    connections?: string[];
  };
};

type YamlAccessConfig = {
  roles?: Record<string, YamlRole>;
  users: YamlUser[];
  defaults?: Record<string, unknown>;
};
```

无损回写要求：

- 读取后再写入 `webui/config/access.yaml` 时，不得删除 `roles:`。
- 不得删除 `defaults:` 下未知字段。
- 不得重排或丢失未被当前表单建模的字段，除非该字段是明确要迁移/删除的 legacy `allow`。

### 2.3 新增 / 调整 API

#### `GET /api/admin/roles`

返回可选 role 列表及 selector 预览摘要。

```json
{
  "ok": true,
  "data": {
    "roles": [
      {
        "id": "kx_readonly",
        "description": "KX 财务数据只读问答",
        "tools": ["kx_catalog", "sl_query", "sl_read_source", "entity_details"],
        "connections": ["mysql-aliyun"],
        "sourceCount": 6,
        "invalid": false,
        "warnings": []
      }
    ]
  }
}
```

验收：

- selector 匹配 0 source 时，`invalid: true` 并提供 warning。
- role 允许全局 deny tool 时，仍返回 warning，运行时不得放行。

#### `GET /api/admin/agents/:userId/effective-permissions`

复用 `webui/server/proxy/acl.ts` 的 role resolver / permission snapshot 逻辑，不重写第二套解析。

返回：

```json
{
  "ok": true,
  "data": {
    "roleIds": ["kx_readonly"],
    "snapshotHash": "<hash>",
    "sourceMapVersion": "<version>",
    "tools": ["kx_catalog", "sl_query", "sl_read_source", "entity_details"],
    "connections": ["mysql-aliyun"],
    "sources": [
      {
        "connectionId": "mysql-aliyun",
        "schema": "dataforai",
        "sourceName": "kx_fact_financial_amount",
        "table": "dataforai.kx_fact_financial_amount"
      }
    ],
    "legacyAllow": false,
    "warnings": []
  }
}
```

错误：

- `404 AGENT_NOT_FOUND`
- `400 ROLE_NOT_FOUND`
- `400 INVALID_ROLE`
- `400 ROLE_RESOLUTION_FAILED`

#### `POST /api/admin/agents`

新请求体：

```json
{
  "dryRun": true,
  "agent": {
    "id": "wangwu",
    "name": "王五",
    "note": "市场部分析助理",
    "role": "kx_readonly"
  }
}
```

拒绝：

- body 含 `agent.allow` → `400 LEGACY_ALLOW_READONLY`
- `role` 缺失 → `400 ROLE_REQUIRED`
- role 不存在或 invalid → `400 INVALID_ROLE`
- `id` 不合法 → `400 BAD_REQUEST`

落盘：

```yaml
- id: wangwu
  name: 王五
  note: 市场部分析助理
  enabled: true
  role: kx_readonly
  tokens: []
```

不得生成 `allow:`。

#### `PATCH /api/admin/agents/:userId`

允许字段：

- `name`
- `note`
- `enabled`
- `role`

拒绝字段：

- `allow`
- `tokens`
- `id`

启用 legacy wildcard Agent 规则：

- 如果 user 没有 `role`，且 `allow.tables` 或 `allow.tools` 包含 `*`，则 `PATCH { enabled: true }` 必须拒绝。
- 错误码：`400 LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`
- 提示：先迁移到 role，再启用。

### 2.4 Legacy Allow 迁移语义

唯一答案：

- 新建 Agent 不生成 `allow`。
- 对已有 user：
  - 若无 role，仅 legacy allow：只读展示；允许禁用、删除、撤销 token；不允许编辑 allow。
  - 若增加 role：保存时必须删除该 user 的 `allow`，避免 dead config 并存。
  - 若已有 role + allow：下一次保存该 user 时删除 `allow`；UI 进入详情即显示“legacy allow 将在保存时移除”。

验收：

- PATCH role 后，`git diff webui/config/access.yaml` 显示该 user 增加 `role` 且移除 `allow`。
- 其他 user、`roles:`、`defaults:` 不变化。

### 2.5 Runtime Fail-Closed 前置验证

在改 Admin 前先补或确认测试：

- role 不存在 → ACL 拒绝，不回退 allow。
- role selector 匹配 0 source → ACL 拒绝。
- role allow tools 包含 `*` → ACL 拒绝。
- role 缺 connections 且含 tableSelectors / table-touching tools → ACL 拒绝。
- `defaults.deny_tools` 命中 → ACL 拒绝。

推荐测试文件：

- `webui/server/__tests__/kx-acl.test.ts`
- `webui/server/__tests__/mcp-proxy-acl.test.ts`
- 新增 `webui/server/__tests__/admin-roles.test.ts`

## 3. P0-2 Enabled Tables 写路径契约

### 3.1 目标行为

`ktx.yaml` 的 `enabled_tables` 写入必须与语义层编辑同等安全：

- 默认 dryRun。
- 保存前返回 diff。
- 输入校验明确。
- 写入有审计记录。
- 前后端两段式原子交付。

### 3.2 API 契约

#### `PUT /api/connections/:connId/enabled-tables`

请求：

```json
{
  "dryRun": true,
  "enabledTables": ["dataforai.superstore_orders"]
}
```

默认：

- `dryRun` 缺省视为 `true`。
- `dryRun:false` 才落盘。

响应 dryRun：

```json
{
  "ok": true,
  "data": {
    "diff": "<unified diff>",
    "proposedYaml": "<full ktx.yaml>",
    "oldEnabledTables": ["..."],
    "newEnabledTables": ["..."]
  }
}
```

响应 write：

```json
{
  "ok": true,
  "data": {
    "written": true,
    "auditId": 123,
    "oldEnabledTables": ["..."],
    "newEnabledTables": ["..."]
  }
}
```

### 3.3 输入校验语义

本轮采用“已扫描表交叉校验”：

- 每个 enabled table 必须匹配 `schema.table`。
- 不允许空串。
- 不允许 `/`、`\`、`..`、控制字符。
- 不允许重复项。
- 必须存在于 `semantic-layer/<connId>/_schema/*.yaml` 已扫描 source 的物理表清单中。
- 若业务需要加入尚未 ingest 的真实表，先通过终端或后续专门流程 ingest；本端点不负责发现未扫描表。

错误码：

- `400 INVALID_ENABLED_TABLE`
- `400 DUPLICATE_ENABLED_TABLE`
- `400 TABLE_NOT_SCANNED`
- `404 CONNECTION_NOT_FOUND`

### 3.4 前端两段式保存

`TableWhitelist.tsx` 必须：

1. 点击保存时先调用 dryRun。
2. 展示 diff / old-new count。
3. 用户确认后再调用 `dryRun:false`。
4. 成功后刷新 `/api/connections`。
5. 失败时不修改本地 optimistic state。

验收：

- 后端改成默认 dryRun 后，前端保存流程不回归。
- 用户能看到实际 `ktx.yaml` diff。

### 3.5 Config Audit 契约

复用 `.ktx-ui/audit.sqlite`，新增表：

```sql
CREATE TABLE IF NOT EXISTS config_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL,
  session_id TEXT,
  file_path TEXT NOT NULL,
  change_type TEXT NOT NULL,
  target_id TEXT,
  old_summary TEXT,
  new_summary TEXT,
  diff TEXT,
  request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_ccl_ts ON config_change_log(ts);
CREATE INDEX IF NOT EXISTS idx_ccl_file_ts ON config_change_log(file_path, ts);
```

字段语义：

| 字段 | 说明 |
|---|---|
| `actor` | 本地无登录 WebUI 固定为 `local-admin` |
| `session_id` | 若无稳定 session，允许为空 |
| `file_path` | 如 `ktx.yaml` 或 `webui/config/access.yaml` |
| `change_type` | `enabled_tables_update`、`agent_create`、`agent_patch`、`token_create`、`token_revoke` 等 |
| `target_id` | connection id 或 user id |
| `old_summary` / `new_summary` | JSON string，禁止写 token 明文 |
| `diff` | unified diff；禁止包含 token 明文 |

token 规则：

- token 明文永不写 audit。
- token create 只记录 hash prefix、label、created、expires_at。

### 3.6 Access Config 写入审计

Admin 写入 `webui/config/access.yaml` 时也写 `config_change_log`：

- agent create
- agent patch
- agent delete
- token create
- token revoke

写入顺序：

1. 校验请求。
2. 生成 proposed yaml + diff。
3. 用户确认后，先写业务持久化需要的 sqlite 记录（例如 revoked token）。
4. 写 yaml。
5. 写 config audit。

若 audit 写入失败：

- 对 `ktx.yaml` / `access.yaml` 写入，默认 fail closed，返回 500，不落盘。
- 若未来改为 best-effort，必须重新经过安全 review。

## 4. Builder 执行包拆分

### 包 A：Admin Role-First

文件范围：

- `webui/server/admin/agents.ts`
- `webui/server/admin/tokens.ts`（只在 audit 需要时触碰）
- `webui/server/admin/mcp-tools.ts`（可能被 roles API 替代或补充）
- `webui/server/proxy/acl.ts`（只暴露/复用 resolver，不改裁决逻辑）
- `webui/src/lib/types.ts`
- `webui/src/pages/admin/*`
- admin tests

必须先跑：

```bash
cd webui
npm test -- admin
npm test -- mcp-proxy
npm test -- kx-acl
npx tsc --noEmit
```

### 包 B：Connection Enabled Tables Safe Write

文件范围：

- `webui/server/index.ts`
- `webui/server/project.ts`
- `webui/server/admin/audit.ts` 或新增 `config-audit.ts`
- `webui/src/pages/connections/TableWhitelist.tsx`
- `webui/src/lib/types.ts`
- connection tests

必须先跑：

```bash
cd webui
npm test -- connection
npm test -- fs-safe
npx tsc --noEmit
```

## 5. 非目标

- 不实现 WebUI 登录。
- 不实现 SSO/OIDC。
- 不实现列级/行级权限。
- 不放开 secret 读取。
- 不在本包实现未扫描物理表发现。
- 不重写 MCP proxy ACL 裁决逻辑，只复用并补足测试。

## 6. 交付完成定义

交付完成必须满足：

1. Admin API 无法创建 `allow:{tables:["*"],tools:["*"]}` Agent。
2. Admin API 无法重新启用 legacy wildcard Agent。
3. role-first 新建 Agent 能成功写入，且不生成 `allow`。
4. 给 legacy Agent 迁移 role 时移除 `allow`，不丢 `roles:` / `defaults:`。
5. enabled-tables 写入默认 dryRun，前端能展示 diff 后确认。
6. enabled-tables 非法输入被拒绝。
7. `ktx.yaml` / `access.yaml` 写入都有 config audit。
8. token 明文不进入 yaml、audit、日志。
9. 相关测试和 TypeScript 检查通过。
