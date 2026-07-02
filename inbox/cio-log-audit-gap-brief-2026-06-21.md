# CIO 视角下 WebUI Token 与访问日志能力差距复核 Brief

日期：2026-06-21  
范围：`webui` 当前实现、Lucy MCP Proxy audit、Hermes workhorse 调用链路  
目标：判断当前 WebUI 是否足以支撑 CIO 视角的 POC 汇报、审计追责、数据访问治理，并明确差距。

## 1. 当前结论

当前 WebUI **已经具备基础治理查看能力**：

- 已发放给 Agent 的 token 清单：有。
- Agent 调取数据的 MCP 工具调用日志：有。
- 按 agent / 工具 / 状态 / 时间 / 表名过滤：有。
- CSV 导出：有。
- 明文 token 不回显：符合基本安全要求。

但若以 CIO / 审计 / 数据治理视角判断，当前能力仍不是完整闭环。核心问题是：

- 日志只按 `user_id` 归因，不能按具体 token 归因。
- WebUI audit 不能展示“业务问题 -> MCP 调用 -> 数据源/表 -> 回答”的端到端链路。
- audit UI 未充分展示后端已有的权限裁决字段。
- CSV 导出字段不足，不利于交付审计。
- 配置变更日志已有后端表，但没有 WebUI 页面。

## 2. 已实现能力与证据

### 2.1 WebUI 导航入口

文件：`webui/src/app/App.tsx`

已存在访问治理导航：

- `/admin/agents`：Agent 实例
- `/admin/audit`：访问日志

### 2.2 Agent Token 清单

前端：

- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/AgentDetail.tsx`
- `webui/src/pages/admin/NewToken.tsx`

后端：

- `webui/server/admin/agents.ts`
- `webui/server/admin/tokens.ts`

现有能力：

- Agent 列表展示 token 数。
- Agent 详情页 `Token` tab 展示每个 token：
  - `label`
  - `created`
  - hash 前缀
  - `expires_at`
  - 撤销按钮
- 新建 token 时只在响应和页面上显示一次明文 token。
- YAML 落盘只保存 `sha256:` hash，不保存明文。
- 撤销 token 时写入 SQLite `revoked_tokens`，再从 YAML 删除。

运行态验证：

```json
{
  "agentCount": 4,
  "tokenCounts": {
    "zhangsan": 1,
    "kx_guard_tester": 0,
    "workhorse": 1,
    "lisi": 0
  },
  "workhorse": {
    "tokens": [
      {
        "label": "hermes-workhorse",
        "created": "2026-06-20",
        "hashPrefix": "sha256:f5d0c6...",
        "expires_at": null
      }
    ]
  }
}
```

### 2.3 Agent 数据访问日志

前端：

- `webui/src/pages/admin/Audit.tsx`

后端：

- `webui/server/admin/audit.ts`
- `webui/server/proxy/audit.ts`
- `webui/server/proxy/mcp-proxy.ts`

SQLite 表：

- `.ktx-ui/audit.sqlite.access_log`
- `.ktx-ui/audit.sqlite.revoked_tokens`
- `.ktx-ui/audit.sqlite.permission_snapshots`
- `.ktx-ui/audit.sqlite.config_change_log`

现有 audit 字段：

- `ts`
- `user_id`
- `client`
- `tool`
- `tables`
- `args_summary`
- `outcome`
- `error_detail`
- `duration_ms`
- `request_id`
- `role_ids`
- `permission_snapshot_hash`
- `effective_tables_count`
- `decision_reason`

WebUI 当前展示：

- 时间
- 用户
- 工具
- 表
- 状态
- 耗时
- 展开后展示 args、错误、request id、client

API 支持过滤：

- `user`
- `tool`
- `outcome`
- `since`
- `until`
- `tableSearch`
- `limit`
- `offset`

CSV 导出：

- `/api/admin/audit/export`

运行态验证：

```json
{
  "ok": true,
  "total": 382,
  "entries": [
    {
      "ts": "2026-06-21T04:39:56.267Z",
      "userId": "workhorse",
      "tool": "tools/list",
      "outcome": "ok",
      "requestId": "1",
      "decisionReason": "allowed"
    }
  ]
}
```

CSV 导出运行态：

```http
HTTP/1.1 200 OK
content-type: text/csv
content-disposition: attachment; filename="audit-20260621.csv"
```

## 3. CIO 视角的主要差距

### G1. 不能按具体 token 追责

现状：

- `identifyRequest` 能通过 bearer token 找到 agent。
- `access_log` 只保存 `user_id`，不保存 token hash / token label。
- `agents.ts` 中 `getLastUsedMap()` 明确注释：由于 access_log 没有 token hash，只能做到 per-user last_seen，不能做到 per-token last_used。

影响：

- 同一 agent 多个 token 时，无法回答“哪个 token 查了这张表”。
- Token 泄露排查时，只能撤销 agent 或所有 token，不能精准定位使用来源。
- Token 清单中的 `last_used` 类型存在，但当前无法填充。

建议：

- `access_log` 增加 `token_hash_prefix` 或 `token_hash`（可权衡是否完整存储 hash）。
- 最好同时记录 `token_label` 的当时快照，避免后续 label 变更影响历史解释。
- Agent token 清单显示 last used、last outcome、last tool。

### G2. 不能端到端还原“问题 -> 数据访问 -> 回答”

现状：

- Lucy audit 只记录 MCP 工具调用。
- Hermes `state.db` 能记录 Telegram 用户问题和 assistant 回答。
- 两者之间没有共享 `session_id` / `conversation_id` / `turn_id`。

影响：

- CIO 想看“用户问了什么、系统查了什么表、最终答了什么”时，需要人工跨库拼接。
- POC 汇报可以人工做，但不能作为可持续审计产品能力。
- 出现错误回答或数据泄露疑虑时，缺乏一键追溯链路。

建议：

- Hermes 调 MCP 时透传 `x-lucy-session-id` / `x-lucy-turn-id` / `x-lucy-platform` 等 header。
- Proxy audit 记录这些 correlation id。
- WebUI audit 增加“会话视图”：
  - 用户问题
  - 调用工具
  - 访问表
  - 被拒原因
  - 最终回答摘要或回答链接

### G3. Audit UI 未展示后端已有的重要字段

后端已返回但 UI 没展示或不突出：

- `decisionReason`
- `roleIds`
- `permissionSnapshotHash`
- `effectiveTablesCount`

影响：

- CIO / 安全负责人无法从页面快速判断“为什么允许 / 为什么拒绝”。
- 权限策略变更后，不能一眼看到当时使用的是哪个 permission snapshot。
- 事故复盘时需要直接查 SQLite。

建议：

- Audit 表格增加“裁决原因”列。
- 详情展开展示：
  - role ids
  - permission snapshot hash
  - effective tables count
  - permission snapshot 链接 / drawer

### G4. CSV 导出字段不足

当前 CSV headers：

- `id`
- `ts`
- `user_id`
- `client`
- `tool`
- `tables`
- `outcome`
- `error_detail`
- `duration_ms`
- `request_id`

缺失：

- `args_summary`
- `decision_reason`
- `role_ids`
- `permission_snapshot_hash`
- `effective_tables_count`
- 未来应加入 `token_hash_prefix` / `token_label`
- 未来应加入 session / turn correlation fields

影响：

- 导出给 CIO 或合规团队后，仍需要补查数据库。
- 对拒绝记录的解释不完整。

建议：

- CSV 默认导出完整审计字段。
- 页面提供“标准导出 / 合规导出”两种模板。

### G5. 配置变更日志没有 WebUI 页面

现状：

- 后端已有 `config_change_log` 表和 `recordConfigChange()`。
- token 创建、撤销、agent 创建、删除、patch 都会写 config change log。
- WebUI 没有配置变更日志页面。

影响：

- CIO 视角能看到“谁查了数据”，但看不到“谁给了权限 / 谁撤了权限 / 权限何时变更”。
- 权限发放审计不完整。

建议：

- 新增 `/admin/config-audit` 页面。
- 展示 actor、file path、change type、target id、old/new summary、diff、request id。
- 在 Agent 详情页增加“权限变更历史”tab。

### G6. “访问日志”默认噪音较大

现状：

- `tools/list`、`initialize`、`notifications/initialized` 进入同一 audit list。
- 今天 workhorse 382 条中大部分是协议/工具发现类。

影响：

- CIO 看页面容易误判“访问量很大”。
- 业务调用和协议调用混在一起，不利于理解风险。

建议：

- Audit 页面默认隐藏协议类记录，提供 toggle。
- 指标分为：
  - protocol calls
  - business tool calls
  - denied attempts
  - data-bearing calls

### G7. 不能直接统计“访问了什么数据源”

现状：

- `tables` 字段是 JSON array。
- `connectionId` 有时只在 `args_summary` 中。
- 对 `tools/list` / `kx_catalog` 等记录没有数据源。

影响：

- CIO 视角常问“访问了哪些数据源、哪些 schema、哪些表、多少次”，目前需要二次解析 JSON。

建议：

- 增加派生结构化字段：
  - `connections`
  - `schemas`
  - `table_count`
  - `data_domain`
- 或建立 audit projection / materialized summary。

### G8. 审计日志缺少“返回数据规模”

现状：

- access_log 记录工具、表、参数、耗时、结果状态。
- 不记录返回行数、列数、字节数、是否含敏感字段。

影响：

- CIO / 安全负责人无法区分“查了 1 行元数据”和“导出了 10 万行明细”。
- 不能做异常检测和泄露风险评级。

建议：

- Proxy 尽量解析 MCP tool response，记录：
  - `row_count`
  - `column_count`
  - `response_bytes`
  - `truncated`
  - `data_classification`
- 对不能解析的工具至少记录 response byte size。

## 4. 需要 Claude Code / Opus Thinker 交叉验证的问题

请重点反驳或补充以下判断：

1. 当前 WebUI 的 token 清单是否足以称为“已发放 token 管理”？
   - 是否必须包含 last used / created by / revoked history 才可用于 CIO 汇报？

2. 当前 `/admin/audit` 是否足以称为“Agent 调取数据日志”？
   - 只记录工具调用，不记录用户问题和回答，是否会误导 CIO？

3. `access_log` 不记录 token hash 是否是 P0 / P1 缺陷？
   - 在同一 agent 当前只有一个 token 的情况下，是否可以暂缓？
   - 如果设计目标是同事自助配置 token，这是否必须优先补？

4. `tools/list` 等协议记录进入 audit 是否合理？
   - 应该继续保留但默认隐藏，还是写入单独表？

5. CSV 导出字段缺失是否会影响合规交付？
   - 哪些字段是最低合规导出字段？

6. 是否应该把 Hermes session DB 接入 WebUI？
   - 还是只在 MCP headers 增加 correlation id，Hermes 原始问答仍留在 Hermes？

7. 对 CIO 视角，是否还应加入：
   - 数据源热力图
   - agent 风险评分
   - denied trend
   - token rotation / expiry dashboard
   - 权限变更审批链

## 5. 建议优先级草案

### P0 / P1 候选

1. `access_log` 增加 token 归因字段。
2. Audit UI 展示 decision reason / role ids / permission snapshot。
3. Audit 默认区分 protocol calls 与 business data calls。
4. CSV 导出补齐完整审计字段。

### P2 候选

1. 配置变更日志 WebUI。
2. 会话关联 ID。
3. 数据源 / schema / table 聚合视图。
4. 返回规模统计。

### P3 候选

1. CIO dashboard。
2. 异常检测和风险评分。
3. 权限变更审批流。

## 6. 关键文件清单

- `webui/src/app/App.tsx`
- `webui/src/pages/admin/AgentList.tsx`
- `webui/src/pages/admin/AgentDetail.tsx`
- `webui/src/pages/admin/NewToken.tsx`
- `webui/src/pages/admin/Audit.tsx`
- `webui/src/lib/types.ts`
- `webui/server/admin/agents.ts`
- `webui/server/admin/tokens.ts`
- `webui/server/admin/audit.ts`
- `webui/server/proxy/audit.ts`
- `webui/server/proxy/mcp-proxy.ts`
- `webui/server/proxy/identity.ts`
- `webui/config/access.yaml`
- `.ktx-ui/audit.sqlite`
- `inbox/cio-poc-data-analysis-brief-2026-06-21.html`

