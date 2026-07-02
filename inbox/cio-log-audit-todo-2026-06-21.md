# CIO Log Audit TODO

日期：2026-06-21  
来源：

- `inbox/cio-log-audit-gap-brief-2026-06-21.md`
- `inbox/opus-thinker-cio-log-review-2026-06-21.md`

目标：把当前 WebUI 从“能演示访问治理”推进到“可支撑 CIO 视角 POC 和基础审计闭环”。Opus 结论是：当前状态 **能演，不能审**。本 TODO 按最小闭环优先。

## P0：POC 前最小闭环

### 1. Audit UI 展示裁决原因

状态：TODO  
范围：

- `webui/src/pages/admin/Audit.tsx`
- `webui/src/lib/types.ts`

任务：

- 在访问日志表格增加“裁决原因”列，展示 `decisionReason`。
- 展开详情展示：
  - `roleIds`
  - `permissionSnapshotHash`
  - `effectiveTablesCount`
- 对 denied 记录突出显示拒绝原因。

验收：

- 打开 `/admin/audit?user=workhorse&outcome=denied`，无需查 SQLite 即可看到为什么拒绝。
- 对 `unknown_or_forbidden_connection:warehouse`、`table_forbidden:dataforai.superstore_orders` 等记录，页面上可直接解释。

### 2. 协议调用与业务调用分流

状态：TODO  
范围：

- `webui/src/pages/admin/Audit.tsx`
- 可选：`webui/server/admin/audit.ts`

任务：

- 默认隐藏协议调用：
  - `tools/list`
  - `initialize`
  - `notifications/initialized`
- 提供 toggle：“显示协议调用”。
- 页面顶部展示分类计数：
  - protocol calls
  - business calls
  - denied calls
  - data-bearing calls

验收：

- CIO 打开访问日志默认看到业务调用，而不是 262 条 `tools/list` 噪音。
- 同一页面仍可切换查看协议记录，避免丢审计。

### 3. Token 归因写入 access_log

状态：TODO  
范围：

- `webui/server/proxy/identity.ts`
- `webui/server/proxy/audit.ts`
- `webui/server/proxy/mcp-proxy.ts`
- `webui/server/admin/audit.ts`
- `webui/server/admin/agents.ts`
- `webui/src/lib/types.ts`
- `webui/src/pages/admin/AgentDetail.tsx`

任务：

- `access_log` 增加：
  - `token_label TEXT`
  - `token_hash_prefix TEXT`
- `AccessLogEntry` 增加对应字段。
- `mcp-proxy.ts` 写审计时传入 `identity.tokenLabel` 和 token hash prefix。
- Agent token 清单显示：
  - last used
  - last tool
  - last outcome
- 后端实现 per-token last used 查询。

注意：

- 不要记录明文 token。
- Opus 判断这项不可暂缓：历史行无法回填 token 归因，每天延迟都会产生永久审计盲区。

验收：

- `/api/admin/audit?user=workhorse` 返回 token label / hash prefix。
- `/admin/agents/workhorse` Token tab 能看到 `hermes-workhorse` 的最近使用时间。
- 同一 agent 多 token 时，日志可区分哪个 token 发起访问。

### 4. CSV 导出补齐审计字段

状态：TODO  
范围：

- `webui/server/admin/audit.ts`
- 可选：`webui/src/pages/admin/Audit.tsx`

任务：

- CSV 增加字段：
  - `args_summary`
  - `decision_reason`
  - `role_ids`
  - `permission_snapshot_hash`
  - `effective_tables_count`
  - `token_label`
  - `token_hash_prefix`
- 导出仍需敏感字段脱敏或确保不含明文 token / password / secret。

验收：

- `/api/admin/audit/export?user=workhorse` 导出的 CSV 不需要再回查 DB 就能解释主要拒绝原因和权限快照。
- grep 导出文件不出现 bearer token、password、secret 明文。

## P1：审计诚信问题

### 5. 配置变更 actor 语义处理

状态：TODO  
范围：

- `webui/server/admin/audit.ts`
- 后续可能涉及 WebUI auth / local admin identity

任务：

- 短期：所有配置变更展示处标注“当前为单管理员模式，actor=local-admin 不具备多人问责语义”。
- 中期：`recordConfigChange()` 支持真实 actor / session id。

验收：

- 不产生“看起来能问责，实际 actor 全是 local-admin”的误导。
- 后续做 `/admin/config-audit` 页面前，先解决或显式标注该语义限制。

### 6. Raw SQL / query 意图审计策略

状态：TODO  
范围：

- `webui/server/proxy/mcp-proxy.ts`
- `webui/server/proxy/audit.ts`
- 可能涉及安全策略文档

问题：

- 当前 `summarizeArgs` 会过滤包含 `sql` / `query` 等敏感 key 的参数。
- 这避免泄露敏感 SQL，但也让 CIO 无法判断“到底查了什么”。

任务：

- 设计 query 审计策略，至少记录：
  - query hash
  - query length
  - extracted tables
  - extracted operation type（select / show / unknown）
  - redacted query preview（如允许）
- 对 raw SQL 全文是否落库做明确安全决策。

验收：

- 对 raw SQL 类请求，audit 不只剩 tool 和空 tables。
- 不把密码、token、secret、完整敏感 SQL 明文写入日志。

## P2：产品化增强

### 7. 配置变更日志页面

状态：TODO  
前置：

- P1 actor 语义处理完成或已明确标注单管理员模式。

范围：

- 新增 `/admin/config-audit`
- `webui/server/admin/audit.ts`
- `webui/src/app/App.tsx`

任务：

- 展示 `config_change_log`：
  - ts
  - actor
  - file_path
  - change_type
  - target_id
  - old_summary
  - new_summary
  - diff
- Agent 详情页可跳转查看该 agent 的权限变更历史。

### 8. 会话关联 ID

状态：TODO  
原则：

- 不直接接 Hermes state DB。
- 通过 MCP header 透传 correlation id。

任务：

- Hermes 调 MCP 时透传：
  - `x-lucy-session-id`
  - `x-lucy-turn-id`
  - `x-lucy-platform`
- Proxy audit 记录这些字段。
- WebUI 支持按 session / turn 过滤。

### 9. 数据源聚合视图

状态：TODO  
任务：

- 从 audit 派生：
  - connections
  - schemas
  - tables
  - top tables
  - denied tables
- WebUI 增加数据源热力视图。

### 10. 返回规模统计

状态：TODO  
任务：

- 尝试解析 MCP response，记录：
  - row count
  - column count
  - response bytes
  - truncated
- 无法解析时至少记录 response byte size。

## 暂不做

以下不进入当前最小闭环：

- 直接接 Hermes `state.db` 到 WebUI。
- CIO dashboard / 风险评分。
- 权限审批流。
- 全量返回内容落库。

## 建议开发顺序

1. P0-1 Audit UI 上屏 decision reason。
2. P0-2 协议 / 业务调用分流。
3. P0-3 token 归因写入和 token last used。
4. P0-4 CSV 补字段。
5. P1-5 actor 语义标注。
6. P1-6 raw SQL / query 审计策略。
7. P2 后续产品化增强。

## 最小验证命令

从 `webui/` 执行：

```bash
npm test -- --run server/__tests__/proxy-audit.test.ts
npm test -- --run server/__tests__/mcp-proxy-smoke.test.ts
npm test -- --run src/__tests__/audit.test.tsx
npm test -- --run src/__tests__/agent-detail.test.tsx
npm run build
```

运行态烟测：

```bash
curl -sS 'http://127.0.0.1:5174/api/admin/audit?user=workhorse&limit=5'
curl -sSI 'http://127.0.0.1:5174/api/admin/audit/export?user=workhorse'
curl -sS 'http://127.0.0.1:5174/api/admin/agents'
```

