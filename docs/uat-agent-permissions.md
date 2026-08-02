# Module 1 UAT 用例集 — Agent 权限管控

| 元数据 | 内容 |
|---|---|
| 文档名称 | Module 1 UAT 用例集 — Agent 权限管控 |
| 文档类型 | Test Report |
| 版本 | v1.2 |
| 撰写日期 | 2026-06-19 |
| 撰写人 | Codex |
| 委托人 | zhangxingchen |
| 基于材料 | project-lucy/docs/design-agent-permissions.md v1.0，project-lucy/docs/review-module1-agent-permissions.md v1.0，当前 webui/server/admin 与 webui/server/proxy 实现 |
| 适用范围 | Module 1 本地单用户 UAT；验证 token 身份识别、ACL 放行/拒绝、审计记录、撤销失效闭环，并通过攻击方反向测试识别安全防护边界 |
| 输出位置 | project-lucy/docs/uat-agent-permissions.md |

---

## 0. UAT 定位

本 UAT 不以“页面上有按钮”为主要验收目标，而以真实请求闭环为主：

```text
WebUI 创建 Agent/Token
  → 使用明文 token 请求 Lucy MCP Proxy (:7879/mcp)
  → 验证允许访问的工具/表可通过 ACL
  → 验证未授权工具/表被拒绝
  → 验证 /admin/audit 与 audit.sqlite 记录可观测
  → 撤销 token 后旧 token 失效
```

本模块仍遵循 v1 设计边界：本地单用户 WebUI，无登录、无 SSO/OIDC、无多租户、无审批流、无列级/行级脱敏。因此本文不是完整企业 IAM / PAM / ABAC 验收用例。

---

## 1. 前置条件

| ID | 检查项 | 命令 / 操作 | 通过标准 |
|---|---|---|---|
| PRE-01 | 依赖已安装 | `cd webui && test -d node_modules` | 命令退出码为 0 |
| PRE-02 | 启动 WebUI 与 Proxy | `cd webui && npm run dev` | WebUI 在 `http://127.0.0.1:5173`，Proxy 在 `http://127.0.0.1:7879/mcp` |
| PRE-03 | WebUI 页面可访问 | `curl -I http://127.0.0.1:5173/admin/agents` | HTTP 200 |
| PRE-04 | Admin API 可访问 | `curl -sS http://127.0.0.1:5173/api/admin/agents` | 返回 `{ "ok": true, ... }` |
| PRE-05 | Proxy 鉴权入口生效 | `curl -i http://127.0.0.1:7879/mcp` | HTTP 401，表示未带 token 被拒绝 |
| PRE-06 | audit DB 存在或可自动创建 | `ls .ktx-ui/audit.sqlite` | 文件存在；若不存在，启动 WebUI 后由服务端创建 |

回归门禁：

```bash
cd webui
npm test
./node_modules/.bin/tsc --noEmit
npm run build
```

通过标准：三条命令均 0 failed / 0 TypeScript errors / build success。

---

## 2. Fixture 与清理规则

UAT 使用两个相互独立的 Agent，避免“先删除再继续测试同一对象”的状态冲突。

| Agent ID | 用途 | 授权工具 | 授权表 |
|---|---|---|---|
| `uat-allow-01` | 主链路：token、allow、deny、audit、revoke | `sl_read_source`, `sl_query` | `dataforai.superstore_orders` |
| `uat-delete-01` | 删除 Agent 时批量撤销 token | `sl_read_source` | `dataforai.superstore_orders` |
| `uat-attacker-01` | 攻击方反向测试：模拟拿到有效 token 但无任何表权限的低权限 Agent | `sl_read_source`, `sl_query`, `entity_details` | 空数组 `[]` |

执行前建议备份：

```bash
cp webui/config/access.yaml /tmp/access.yaml.uat.bak
```

执行后清理：

- 在 WebUI 删除 `uat-allow-01`、`uat-delete-01`、`uat-attacker-01`，或恢复备份：

```bash
cp /tmp/access.yaml.uat.bak webui/config/access.yaml
```

注意：创建 token 后，明文 token 只允许临时保存在当前 shell 变量或人工剪贴板中，不写入仓库文件、UAT 报告或聊天记录。

> 2026-06-21 状态更新：本文仍可作为 legacy allow 链路的历史 UAT 参考，但不再代表访问治理的目标形态。当前目标已升级为 role-first：新建 Agent 必须选择 role，legacy `allow` 只读兼容，Admin 写入路径不得创建或重新启用 `tables:["*"]` / `tools:["*"]` 的全权 Agent。新的验收边界见 `inbox/spec-remediation-plan-2026-06-21.md` 和 `inbox/thinker-review-spec-delivery-2026-06-21.md`。

## 2A. Role-first UAT（2026-06-21 起）

本节替代下方 legacy allow 主链路，作为当前访问治理的人工验收入口。

### RF-UAT-01 新建 role-first Agent

操作：

1. 打开 `http://127.0.0.1:5173/admin/agents`。
2. 点击「新建 Agent」。
3. 填写：
   - 用户 ID：`uat-role-01`
   - 显示名：`UAT Role Agent`
   - 角色：`kx_readonly`
4. 点击「预览变更」。
5. 确认 diff 后点击「确认保存」。

通过标准：

- `webui/config/access.yaml` 出现 `id: uat-role-01`。
- 该 user 有 `role: kx_readonly`。
- 该 user 不生成 `allow:`。
- `roles:` 与 `defaults:` 仍保留。

### RF-UAT-02 API 拒绝 legacy allow

操作：

```bash
curl -sS -X POST http://127.0.0.1:5173/api/admin/agents \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":false,"agent":{"id":"uat-wildcard","name":"UAT Wildcard","allow":{"tables":["*"],"tools":["*"]}}}'
```

通过标准：

- HTTP 400。
- `error.code` 为 `LEGACY_ALLOW_READONLY` 或 `ROLE_REQUIRED`。
- `webui/config/access.yaml` 未出现 `uat-wildcard`。

### RF-UAT-03 禁止重新启用 legacy wildcard Agent

前置：`webui/config/access.yaml` 中存在 disabled legacy wildcard user（如 `lisi`）。

操作：

```bash
curl -sS -X PATCH http://127.0.0.1:5173/api/admin/agents/lisi \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":false,"patch":{"enabled":true}}'
```

通过标准：

- HTTP 400。
- `error.code` 为 `LEGACY_WILDCARD_AGENT_REQUIRES_ROLE`。
- `lisi.enabled` 不被改为 `true`。

### RF-UAT-04 legacy user 迁移 role 时删除 allow

操作：

```bash
curl -sS -X PATCH http://127.0.0.1:5173/api/admin/agents/lisi \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":true,"patch":{"role":"kx_readonly"}}'
```

确认 dryRun diff 后执行：

```bash
curl -sS -X PATCH http://127.0.0.1:5173/api/admin/agents/lisi \
  -H 'Content-Type: application/json' \
  -d '{"dryRun":false,"patch":{"role":"kx_readonly"}}'
```

通过标准：

- `lisi` 增加 `role: kx_readonly`。
- `lisi` 的 legacy `allow:` 被移除。
- 其他 user、`roles:`、`defaults:` 无变化。
- `GET /api/admin/agents/lisi/effective-permissions` 返回 `snapshotHash`、`sourceMapVersion` 与展开后的 sources。

### RF-UAT-05 Config audit

操作：

```bash
sqlite3 .ktx-ui/audit.sqlite \
  "select change_type,target_id,file_path from config_change_log order by id desc limit 5;"
```

通过标准：

- 能看到 `agent_create` / `agent_patch` / `token_create` / `enabled_tables_update` 等配置变更记录。
- `old_summary` / `new_summary` / `diff` 中不包含 token 明文。

---

## 3. 主链路 UAT：真实 Token 请求 MCP Proxy

### UAT-01 创建主测试 Agent

操作：

1. 打开 `http://127.0.0.1:5173/admin/agents`。
2. 点击「新建 Agent」。
3. 填写：
   - 用户 ID：`uat-allow-01`
   - 显示名：`UAT Allow Agent`
   - 授权表：`dataforai.superstore_orders`
   - 授权工具：`sl_read_source,sl_query`
4. 点击「预览变更」。
5. 确认 diff 后点击「确认保存」。

通过标准：

- 跳转到 `/admin/agents/uat-allow-01`。
- `webui/config/access.yaml` 出现 `id: uat-allow-01`。
- `tokens: []` 或 tokens 为空。
- `allow.tables` 仅包含 `dataforai.superstore_orders`。
- `allow.tools` 仅包含 `sl_read_source`、`sl_query`。

### UAT-02 生成 Token，并确认明文只出现一次

操作：

1. 在 `uat-allow-01` 详情页进入 Token Tab。
2. 点击「+ 新建 Token」。
3. Token 标签填写 `uat-token-01`。
4. 点击「生成 Token」。
5. 复制页面展示的 64 字符明文 token。
6. 在当前 shell 临时设置：

```bash
TOKEN='<paste-token-here>'
```

通过标准：

- 生成成功页展示 64 字符 hex 明文与 `.mcp.json` 示例。
- 点击「我已保存，关闭」后，Token 列表只显示 `sha256:...` hash 前缀，不显示明文。
- `webui/config/access.yaml` 仅包含 `sha256:<hash>`，不包含 `$TOKEN` 明文。

校验命令：

```bash
grep -n 'uat-token-01\|sha256:' webui/config/access.yaml
grep -n "$TOKEN" webui/config/access.yaml
```

第二条命令通过标准：无输出。

### UAT-03 允许用例：授权工具 + 授权表

操作：使用同一个 `$TOKEN` 调用已授权的 `sl_read_source`，读取允许表 `superstore_orders`。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "uat-allow-1",
    "method": "tools/call",
    "params": {
      "name": "sl_read_source",
      "arguments": {
        "sourceName": "superstore_orders"
      }
    }
  }'
```

通过标准：

- 响应不包含 `Unauthorized`。
- 响应不包含 `Access denied`。
- 若上游 KTX MCP 因协议握手、会话或工具内部错误返回 error，本用例仍可判定 ACL 放行；但必须在 audit 中不是 `outcome=denied`。
- `/admin/audit?user=uat-allow-01` 可看到 `requestId=uat-allow-1`。
- audit 记录中 `tool=sl_read_source`，`tables` 包含 `dataforai.superstore_orders`。

### UAT-04 表权限拒绝：授权工具 + 未授权表

操作：继续使用 `$TOKEN` 调用已授权的 `sl_read_source`，但读取未授权表 `superstore_returns`。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "uat-deny-table-1",
    "method": "tools/call",
    "params": {
      "name": "sl_read_source",
      "arguments": {
        "sourceName": "superstore_returns"
      }
    }
  }'
```

通过标准：

- 响应包含 `Access denied`。
- 响应包含 `table_forbidden:dataforai.superstore_returns`。
- `/admin/audit?user=uat-allow-01&outcome=denied` 可看到 `requestId=uat-deny-table-1`。
- audit 记录中 `tool=sl_read_source`，`outcome=denied`，`errorDetail` 或展开详情包含 `table_forbidden:dataforai.superstore_returns`。

### UAT-05 工具权限拒绝：全局 deny 工具

操作：继续使用 `$TOKEN` 调用全局禁用工具 `sql_execution`。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "uat-deny-tool-1",
    "method": "tools/call",
    "params": {
      "name": "sql_execution",
      "arguments": {}
    }
  }'
```

通过标准：

- 响应包含 `Access denied`。
- 响应包含 `tool_default_deny`。
- `/admin/audit?user=uat-allow-01&outcome=denied` 可看到 `requestId=uat-deny-tool-1`。
- audit 记录中 `tool=sql_execution`，`outcome=denied`。

### UAT-06 Agent 禁用后旧 Token 拒绝

操作：

1. 进入 `/admin/agents/uat-allow-01`。
2. 点击「禁用」。
3. 确认进入「变更预览」Tab，而不是立即写盘。
4. 点击「保存」。
5. 等待 access.yaml 缓存 TTL，最多 30 秒。
6. 使用旧 `$TOKEN` 再次调用 `sl_read_source`。

通过标准：

- yaml 中 `uat-allow-01.enabled` 为 `false`。
- 再次请求返回 HTTP 401 或 JSON-RPC Unauthorized。
- audit 不应新增 `outcome=ok` 的业务工具调用。

如当前实现未对 `enabled: false` 做身份拒绝，本用例必须失败并记录为 P1：禁用状态未被 proxy 鉴权执行。

### UAT-07 重新启用 Agent

操作：

1. 在详情页点击「启用」。
2. 进入变更预览后点击「保存」。
3. 等待最多 30 秒。
4. 再执行 UAT-03 的允许请求。

通过标准：

- yaml 中 `enabled: true`。
- 请求不返回 `Unauthorized`。
- audit 新增对应记录。

### UAT-08 撤销 Token 后旧 Token 失效

操作：

1. 进入 `uat-allow-01` 的 Token Tab。
2. 点击 `uat-token-01` 的「撤销」并确认。
3. 等待最多 30 秒。
4. 用旧 `$TOKEN` 再次调用任意 MCP 工具。

通过标准：

- yaml 中 `uat-token-01` 消失。
- UI toast 提示“代理可能在 30 秒内仍接受该 token”。
- 旧 token 返回 HTTP 401 或 JSON-RPC Unauthorized。
- `revoked_tokens` 中存在该 token hash，reason 为 `manual_revoke`。

可选 SQLite 校验：

```bash
sqlite3 .ktx-ui/audit.sqlite \
  "SELECT token_hash, reason, revoked_at FROM revoked_tokens WHERE reason='manual_revoke' ORDER BY revoked_at DESC LIMIT 5;"
```

---

## 4. 攻击方反向测试：无表权限越权套数

### 4.1 攻防目标

本节模拟攻击方已获得一个有效 Bearer token，但该 Agent 没有任何表权限。目标不是证明“页面配置为空”，而是验证攻击方是否能通过参数变形、工具绕行、自然语言/SQL 注入、聚合表达式、join 侧漏等方式绕过表级 ACL 套出数据。

攻击方通过标准：

- 所有触达表数据的请求必须被拒绝，响应包含 `Access denied`。
- `/admin/audit?user=uat-attacker-01&outcome=denied` 必须能看到对应 request id。
- audit 中 `errorDetail` 必须能定位到 `table_forbidden:<table>` 或 `tool_default_deny` / `tool_forbidden`。
- 响应、audit、CSV 中不得出现明文 token。
- 任何返回真实表结构、样例数据、聚合结果、行数、字段值、join 后结果的用例，均视为越权成功。

失败分级：

| 等级 | 判定 | 处置 |
|---|---|---|
| P0 | 无表权限 token 能返回业务数据、聚合结果、表结构详情或可用于推断业务事实的 SQL 结果 | 阻断上线 |
| P1 | 请求未返回数据，但未被 ACL 拒绝，或未写 denied audit | 修复后再验收 |
| P2 | 被拒绝但错误原因不可审计、request id 缺失、audit 字段不足 | 可带风险合并，但需登记 |

### 4.2 创建攻击方 Agent

操作：

1. 打开 `/admin/agents`。
2. 新建 Agent：
   - 用户 ID：`uat-attacker-01`
   - 显示名：`UAT Attacker Agent`
   - 授权表：留空，保存为 `[]`
   - 授权工具：`sl_read_source,sl_query,entity_details`
3. 创建 token，标签为 `attacker-token-01`。
4. 复制明文到当前 shell：

```bash
ATTACKER_TOKEN='<paste-attacker-token-here>'
```

通过标准：

- yaml 中 `uat-attacker-01.allow.tables` 为空数组。
- yaml 中只保存 token hash，不保存 `$ATTACKER_TOKEN` 明文。
- 等待最多 30 秒，让 Proxy 重新读取 access.yaml。

### 4.3 攻击向量矩阵

| ID | 攻击意图 | MCP 请求要点 | 期望安全结果 | 当前边界说明 |
|---|---|---|---|---|
| ATK-01 | 空表权限直接读源 | `sl_read_source.sourceName=superstore_orders` | `table_forbidden:dataforai.superstore_orders`，audit denied | 当前 ACL 应能拦截：读取 `sourceName` 并映射物理表 |
| ATK-02 | 空表权限读未授权 returns | `sl_read_source.sourceName=superstore_returns` | `table_forbidden:dataforai.superstore_returns`，audit denied | 当前 ACL 应能拦截 |
| ATK-03 | 聚合表达式套数 | `sl_query.measures=["sum(superstore_orders.sales)"]` | `table_forbidden:dataforai.superstore_orders`，audit denied | 当前 ACL 仅做简单函数剥离；必须验证聚合表达式不会绕过 |
| ATK-04 | 维度字段套枚举值 | `sl_query.dimensions=[{"field":"superstore_orders.region"}]` | `table_forbidden:dataforai.superstore_orders`，audit denied | 当前 ACL 应能从 `dimensions[].field` 提取 |
| ATK-05 | 指标 + 维度组合套数据 | `measures=["superstore_orders.total_sales"]` + `dimensions=[{"field":"superstore_orders.segment"}]` | denied，不返回分组聚合结果 | 当前 ACL 应在任一字段命中未授权表时拒绝 |
| ATK-06 | sourceName 变体 | 分别尝试 `superstore_orders` 与 `dataforai.superstore_orders` | 两种写法都不得返回数据 | 当前 source map 只保证 sourceName → 物理表；物理表直传行为必须实测 |
| ATK-07 | entity_details 绕行 | `entity_details.entities=[{"table":"dataforai.superstore_orders"}]` | `table_forbidden:dataforai.superstore_orders`，audit denied | 当前 ACL 应读取 `entities[].table` |
| ATK-08 | 工具级降权缺口 | 调用未授权但可能读数据的工具，如 `wiki_search`、`discover_data` | `tool_forbidden` 或确认该工具不返回表数据 | 用于确认工具白名单不是只管表工具 |
| ATK-09 | 全局 deny 工具 | `sql_execution` | `tool_default_deny`，audit denied | 即使攻击方被错误授予该工具，也必须被全局 deny |
| ATK-10 | query 字段注入 | `sl_query.arguments.query="select * from dataforai.superstore_orders limit 5"`，不提供 measures/dimensions | 不得返回数据；若未被 ACL 拒绝且上游执行，P0 | 当前 ACL 不从 `query` 提取表名，这是高风险盲区测试 |
| ATK-11 | filter/where 字段藏表名 | 在 `filters` / `where` / `segments` 中引用 `superstore_orders` | 不得返回数据；若成功，P0/P1 | 当前 ACL 未显式解析这些字段，必须用 UAT 暴露边界 |
| ATK-12 | join 侧漏 | 只请求 orders 指标，但通过参数声明 join 到 returns/people | 不得返回未授权 join 侧数据 | 当前 ACL 只看请求参数中提取到的表名，不验证上游实际 SQL 表集合 |
| ATK-13 | 非 tools/call 旁路 | 尝试非 `tools/call` JSON-RPC 方法读取资源或工具列表以推断数据 | 不得返回敏感数据；至少 audit 可见 | 当前 proxy 只对 `tools/call` 做 ACL，其他方法主要转发 |
| ATK-14 | case/encoding 混淆 | `Superstore_Orders`、URL/JSON 转义、额外空格、函数嵌套 | 不得返回数据 | 当前 ACL 的字符串解析较简单，需确认混淆不会漏检 |

### 4.4 可执行攻击请求样例

ATK-01：空表权限直接读源。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTACKER_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "atk-01-read-source-no-table",
    "method": "tools/call",
    "params": {
      "name": "sl_read_source",
      "arguments": { "sourceName": "superstore_orders" }
    }
  }'
```

ATK-03：聚合表达式套数。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTACKER_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "atk-03-aggregate-expression",
    "method": "tools/call",
    "params": {
      "name": "sl_query",
      "arguments": {
        "measures": ["sum(superstore_orders.sales)"],
        "limit": 5
      }
    }
  }'
```

ATK-04：维度枚举套取。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTACKER_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "atk-04-dimension-enum",
    "method": "tools/call",
    "params": {
      "name": "sl_query",
      "arguments": {
        "dimensions": [{ "field": "superstore_orders.region" }],
        "limit": 20
      }
    }
  }'
```

ATK-10：`query` 字段注入。该用例专门验证当前表提取盲区，若返回数据即 P0。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTACKER_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "atk-10-query-field-injection",
    "method": "tools/call",
    "params": {
      "name": "sl_query",
      "arguments": {
        "query": "select * from dataforai.superstore_orders limit 5"
      }
    }
  }'
```

ATK-13：非 `tools/call` 方法旁路探测。

```bash
curl -sS -X POST http://127.0.0.1:7879/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ATTACKER_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": "atk-13-tools-list-probe",
    "method": "tools/list",
    "params": {}
  }'
```

### 4.5 反向测试判定方式

每个 `ATK-*` 请求执行后，都必须检查三处证据：

1. 响应内容：
   - 安全通过：包含 `Access denied`，或明确不含任何业务数据/表结构/聚合结果。
   - 安全失败：出现订单、退货、销售额、区域、客户、产品、行数、字段定义等业务数据。
2. audit 页面：
   - 访问 `/admin/audit?user=uat-attacker-01`。
   - 对应 request id 必须可定位。
   - 应拒绝的用例必须是 `outcome=denied`。
3. audit SQLite：

```bash
sqlite3 .ktx-ui/audit.sqlite \
  "SELECT request_id, tool, outcome, error_detail FROM access_log WHERE user_id='uat-attacker-01' ORDER BY id DESC LIMIT 20;"
```

通过标准：

- ATK-01 至 ATK-09 必须明确 denied。
- ATK-10 至 ATK-14 是边界探测；若未 denied，但也未返回敏感数据，记录为“防护边界需确认”；若返回数据，直接判为 P0/P1。

### 4.6 当前系统安全边界与能力上限

基于当前 proxy ACL 实现，本轮 UAT 应明确记录以下边界：

| 防护点 | 当前能力 | 攻防含义 |
|---|---|---|
| token 身份识别 | Bearer token sha256 命中 `access.yaml.users[].tokens[].hash` | 能区分 Agent 身份，但不区分 WebUI 管理员身份 |
| 工具白名单 | `allow.tools` 与 `defaults.deny_tools` | 能阻止未授权工具和全局禁用工具 |
| 表白名单 | 对 `sl_query` / `sl_read_source` / `entity_details` 做参数级表提取 | 能覆盖显式 source/measure/dimension/entity 表引用 |
| 审计 | `tools/call` 写 `access_log`，denied 写 `error_detail` | 能追踪多数工具调用，但需验证非 `tools/call` 行为 |
| 解析盲区 | `query`、`filters`、`where`、`segments`、join 参数、复杂表达式、大小写/转义混淆未见完整解析 | 这是攻击方反向测试的重点，不应用正向测试结果替代 |
| 上游实际 SQL 校验 | 当前 ACL 主要检查请求参数，不校验上游最终 SQL 的真实表集合 | 如果上游会自动 join 或改写 SQL，可能产生侧漏 |

上线判断：

- 若 ATK-01 至 ATK-09 全部 denied，说明 v1 显式表引用防护达到基础上线门槛。
- 若 ATK-10 至 ATK-14 存在未 denied 但也未泄露数据，应登记为“已知边界”，并限制工具参数契约。
- 若任一攻击用例返回业务数据，Module 1 不应上线为“数据权限管控”能力，只能作为管理 UI beta。

---

## 5. 删除 Agent 撤销链路

### UAT-09 创建删除测试 Agent 与 Token

操作：

1. 新建 Agent：
   - 用户 ID：`uat-delete-01`
   - 显示名：`UAT Delete Agent`
   - 授权表：`dataforai.superstore_orders`
   - 授权工具：`sl_read_source`
2. 为它创建 token，标签为 `delete-token-01`。
3. 复制明文到当前 shell：

```bash
DELETE_TOKEN='<paste-delete-token-here>'
```

通过标准：

- `webui/config/access.yaml` 包含 `uat-delete-01` 与 `delete-token-01` hash。
- 使用 `$DELETE_TOKEN` 调用 `sl_read_source` 不返回 `Unauthorized` 或 `Access denied`。

### UAT-10 删除 Agent 后 token 进入 revoked_tokens

操作：

1. 在 `uat-delete-01` 详情页点击「删除」并确认。
2. 等待最多 30 秒。
3. 用旧 `$DELETE_TOKEN` 再次调用 `sl_read_source`。

通过标准：

- yaml 中 `uat-delete-01` 整段消失。
- 旧 token 返回 HTTP 401 或 JSON-RPC Unauthorized。
- `revoked_tokens` 中存在该 token hash，reason 为 `agent_deleted`。

可选 SQLite 校验：

```bash
sqlite3 .ktx-ui/audit.sqlite \
  "SELECT token_hash, reason, revoked_at FROM revoked_tokens WHERE reason='agent_deleted' ORDER BY revoked_at DESC LIMIT 5;"
```

---

## 6. Audit 页面与导出

| ID | 标题 | 操作步骤 | 通过标准 |
|---|---|---|---|
| UAT-11 | 用户过滤 | 访问 `/admin/audit?user=uat-allow-01` | 只显示 `uat-allow-01` 相关记录，能看到 UAT-03 至 UAT-05 的 request id |
| UAT-12 | 状态过滤 | 访问 `/admin/audit?user=uat-allow-01&outcome=denied` | 只显示 denied 记录，包含表拒绝与工具拒绝 |
| UAT-13 | 工具过滤 | 在工具输入框填 `sl_read_source` | 只显示该工具记录 |
| UAT-14 | 表名搜索 | 表名输入框填 `superstore_orders` | 显示授权表相关记录 |
| UAT-15 | 展开详情 | 点击 UAT-04 或 UAT-05 记录 | 展开区可见 args 摘要、错误详情、request id |
| UAT-16 | CSV 导出 | 在当前过滤条件下点击「导出 CSV」 | 下载 `audit-YYYYMMDD.csv`，内容与过滤条件一致，不包含 token 明文 |

精确 token 泄露检查：

```bash
grep -R "$TOKEN" .ktx-ui webui/config/access.yaml
```

通过标准：无输出。不要用“任意 64 字符 hex 无命中”作为标准，因为 token hash 合法存在。

---

## 7. 辅助 UI 回归

这些用例不替代主链路，只用于确认管理页面基本可用。

| ID | 标题 | 操作步骤 | 通过标准 |
|---|---|---|---|
| UAT-17 | 导航入口 | 打开 WebUI 任意页面 | 左侧导航有「访问治理」，包含「Agent 实例」「访问日志」 |
| UAT-18 | Agent 列表 | 访问 `/admin/agents` | 卡片展示 id、name、启用状态、token 数、表/工具授权摘要、近 7 天调用统计 |
| UAT-19 | 搜索过滤 | 在搜索框输入 `uat-allow` | 只显示匹配 id/name 的 Agent |
| UAT-20 | 状态过滤 | 禁用 `uat-allow-01` 后选择「已禁用」 | 只显示禁用 Agent |
| UAT-21 | 工具全局 deny 展示 | 进入工具权限 Tab | `sql_execution`、`sql_dialect_notes`、`memory_ingest`、`memory_ingest_status` 显示全局禁用且不可选 |
| UAT-22 | userId 不可改 | 进入基本信息 Tab | userId 只读展示，不可编辑 |
| UAT-23 | 重复 id 拒绝 | 再次新建 `uat-allow-01` | 返回 `409 AGENT_ID_TAKEN`，yaml 不新增重复段 |
| UAT-24 | 重复 token label 拒绝 | 对同一 Agent 再创建 `uat-token-01` | 返回 `409 TOKEN_LABEL_TAKEN`，不生成新 token |

---

## 8. 旧功能回归

| ID | 标题 | 操作步骤 | 通过标准 |
|---|---|---|---|
| REG-01 | 语义层目录 | 访问 `/` 并进入任意表详情 | 页面加载正常 |
| REG-02 | TableEditor 保存 | 在测试环境对非关键字段做 dryRun/保存流程 | 不影响无关 yaml，保存成功 |
| REG-03 | Wiki 编辑 | 访问 `/wiki` 并打开文档 | 页面加载正常，保存功能可用 |
| REG-04 | Review 页面 | 访问 `/review` | 页面加载无报错 |
| REG-05 | 自动化回归 | `cd webui && npm test && ./node_modules/.bin/tsc --noEmit && npm run build` | 全部通过 |

---

## 9. 关键安全约束验收映射

| 设计约束 | UAT 证据 |
|---|---|
| MCP token 是 Agent 接入凭据 | PRE-05 验证未带 token 拒绝；UAT-02 生成有效 token；UAT-03 验证有效 token 可通过；UAT-06/UAT-08/UAT-10 验证禁用、撤销、删除后不可继续访问 |
| Token 明文只显示一次 | UAT-02 验证明文只在创建响应出现；UAT-16 验证 audit/CSV 不泄露 token 明文 |
| Agent 不直接持有系统内部凭据 | UAT-16 验证 audit/CSV 不泄露 token 或密码；执行记录需确认 Agent 配置仅使用 MCP token，不暴露数据库密码、服务端密钥或本地配置写权限 |
| 权限裁决发生在 Lucy MCP Proxy | UAT-04/UAT-05 验证未授权请求被 Proxy 拒绝并写 audit；ATK-01 至 ATK-09 验证攻击请求未下发出数 |
| 默认拒绝 | UAT-04/UAT-05、ATK-01 至 ATK-09 验证未授权 tool/table、空表权限、显式非授权表均 denied |
| 审计以 Agent 为归因主体 | UAT-03/UAT-04/UAT-05 验证 allow/denied 均能按 `user_id`、tool、table、outcome、reason 查询 |
| 撤销优先于 YAML 删除 | UAT-08/UAT-10 验证旧 token 不可用，且 `revoked_tokens` 存在对应 hash |
| 配置事实源保持简单 | UAT-01/UAT-02 验证 `access.yaml` 写入 Agent、ACL 与 token hash；UAT-08/UAT-10 验证 sqlite `revoked_tokens`；UAT-11 至 UAT-15 验证 audit 查询 |
| 缓存延迟显式暴露 | UAT-06/UAT-08/UAT-10 等禁用、撤销、删除用例必须等待最多 30 秒后复验 |
| 攻击面测试是上线门槛 | ATK-01 至 ATK-14 必测；任一攻击用例返回非授权业务数据即阻断上线 |
| 当前非目标明确排除 | WebUI 登录、多管理员 RBAC、外部身份源同步、第三方产品接入协议不纳入本轮通过标准 |

## 10. 必测用例

上线前不可跳过：

- UAT-03：有效 token + 授权工具/表可通过 ACL
- UAT-04：有效 token + 未授权表被拒绝并写 audit
- UAT-05：全局 deny 工具被拒绝并写 audit
- UAT-06：Agent 禁用后旧 token 不可继续访问
- UAT-08：Token 撤销后旧 token 不可继续访问，且进入 `revoked_tokens`
- UAT-10：删除 Agent 后所有关联 token 进入 `revoked_tokens`
- UAT-16：audit/CSV 不泄露 token 明文、密码或系统内部凭据
- 约束验证：Agent 配置与执行记录只暴露 MCP token，不暴露数据库密码、服务端密钥或本地配置写权限
- ATK-01 至 ATK-09：无表权限攻击方对显式表引用必须全部 denied
- ATK-10 至 ATK-14：解析盲区探测必须记录结果；任一返回业务数据即阻断上线
- REG-05：自动化回归全绿

---

## 11. 当前已知风险

| 风险 | 影响 | UAT 处置 |
|---|---|---|
| MCP raw curl 可能因上游 KTX MCP 会话协议返回工具内部 error | 不能把所有非 ok 响应都误判为 ACL 失败 | 允许用例以“不 Unauthorized、不 Access denied、audit 非 denied”为 ACL 放行标准 |
| `access.yaml` 有 30 秒缓存 TTL | 刚禁用/撤销后短时间内旧 token 可能仍可用 | 禁用、撤销、删除类用例等待最多 30 秒后验证 |
| 本 UAT 会修改真实 `webui/config/access.yaml` | 可能污染本地配置 | 执行前备份，执行后删除 UAT Agent 或恢复备份 |
| 当前 v1 无 WebUI 登录与管理员身份隔离 | 不能证明企业级多管理员权限边界 | 明确列为设计 non-goal，不纳入本轮通过标准 |
| 系统内部凭据不在 Module 1 管理范围 | UAT 不能证明数据库密码、服务端密钥的全生命周期安全 | 本轮只验证 Agent 不直接获得内部凭据，且 audit/CSV 不泄露 |
| 当前表提取不是完整 SQL/parser 级策略引擎 | 复杂参数、自然语言 query、join 改写、上游自动补表可能绕过请求参数级 ACL | ATK-10 至 ATK-14 必测；发现泄露即阻断上线 |
