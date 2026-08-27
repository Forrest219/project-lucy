# Lucy 部署许可与激活码

| 元数据 | 内容 |
|---|---|
| 文档名称 | Deployment License & Activation Code |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-27 |
| 状态 | 实施中 |
| 适用范围 | 企业私有化交付的部署许可、激活码签发与运行时 enforcement |

---

## 1. 背景

Lucy 已有 **数据授权**（Role / Agent / MCP ACL），用于控制 Agent 能访问哪些表与工具。这与 **部署许可**（客户是否为该实例付费、可用多久、多少 Agent 席位）是不同概念。

当前仓库缺少商业收费所需的部署许可层：无激活码、无 seat 上限、无许可到期 enforcement。

## 2. 目标

| ID | 目标 |
|---|---|
| G1 | 厂商可离线签发激活码（含客户、席位、到期、套餐 tier） |
| G2 | 客户 Owner 在 WebUI 输入激活码完成部署许可激活 |
| G3 | `LUCY_LICENSE_MODE=enforce` 时，无有效许可则拒绝 MCP 数据调用与 Agent 创建 |
| G4 | 默认 `off` 模式保持开发/演示兼容 |
| G5 | 审计记录激活与 seat 超限事件 |

## 3. 非目标

- 在线 License Server / 电话回家
- SaaS 多租户计费
- 把 MCP Agent Token 当作激活码
- 与 WebUI 数据授权（ACL）混用同一术语

## 4. 术语

| 概念 | UI 主术语 | 说明 |
|---|---|---|
| 软件部署付费凭证 | **部署许可** | 与「数据授权（ACL）」区分 |
| 客户输入的一次性字符串 | **激活码** | 非 Agent Token，非语义生效 |
| 激活后的权益快照 | **许可权益** | max_agents、tier、expires_at 等 |

## 5. 激活码格式

```
LUCY-1.<payload_b64url>.<sig_b64url>
```

- `payload`：JSON（UTF-8）经 base64url 编码
- `sig`：`HMAC-SHA256(verify_secret, "LUCY-1." + payload_b64url)` 的 base64url

Payload 字段：

```json
{
  "v": 1,
  "customer_id": "acme-corp",
  "tier": "enterprise",
  "max_agents": 50,
  "issued_at": "2026-08-27T00:00:00.000Z",
  "expires_at": "2027-08-27T23:59:59.999Z",
  "features": ["governance", "eval"]
}
```

- `expires_at: null` 表示永久许可
- 厂商侧脚本 `scripts/license-issue.mjs` 使用 `LUCY_LICENSE_SIGNING_SECRET` 签发
- 客户镜像/compose 注入 `LUCY_LICENSE_VERIFY_SECRET`（与 signing secret 同值，按客户交付）

## 6. 事实源

激活后写入 `.ktx-ui/license.yaml`（已在 fs-safe ALLOW 内）：

```yaml
version: "1"
activated_at: "2026-08-27T04:00:00.000Z"
activation_code_fingerprint: "sha256:..."
entitlement:
  customer_id: acme-corp
  tier: enterprise
  max_agents: 50
  issued_at: "2026-08-27T00:00:00.000Z"
  expires_at: "2027-08-27T23:59:59.999Z"
  features:
    - governance
    - eval
```

不保存完整激活码明文，仅保存 fingerprint 供审计对照。

## 7. 运行模式

| `LUCY_LICENSE_MODE` | 行为 |
|---|---|
| `off`（默认） | 不校验部署许可；开发/演示 |
| `enforce` | 必须有有效未过期许可；否则 MCP 与 Agent 写路径拒绝 |
| `warn` | 记录告警，不阻断（预发/迁移用） |

## 8. 核心流程（伪代码）

### 8.1 激活

```text
POST /api/admin/license/activate { activationCode }
  require owner session
  normalized = trim + collapse whitespace on activationCode
  parsed = decodeActivationCode(normalized, LUCY_LICENSE_VERIFY_SECRET)
  if parse fails → 400 INVALID_ACTIVATION_CODE
  if expires_at <= now → 400 ACTIVATION_CODE_EXPIRED
  fingerprint = sha256(normalized)
  write .ktx-ui/license.yaml { entitlement: parsed.payload, fingerprint, activated_at: now }
  audit config_change actor=owner action=license_activate
  invalidate license cache
  return status snapshot
```

### 8.2 Agent 席位 enforcement

```text
on POST /api/admin/agents (dryRun=false)
  snapshot = loadLicenseSnapshot()
  if mode != enforce → continue
  if snapshot.status != active → 403 LICENSE_REQUIRED
  enabledAgents = count users where enabled != false
  if enabledAgents + 1 > snapshot.entitlement.max_agents → 403 LICENSE_SEAT_LIMIT
```

### 8.3 MCP Proxy enforcement

```text
on authenticated MCP tools/call (data-touching tools only)
  snapshot = loadLicenseSnapshot()
  if mode != enforce → continue
  if snapshot.status == active → continue
  if snapshot.status == expired → JSON-RPC deny license_expired
  else → JSON-RPC deny license_missing
  write auth_failure audit
```

## 9. API

| Method | Path | 权限 | 说明 |
|---|---|---|---|
| GET | `/api/admin/license` | Owner | 部署许可状态与 seat 用量 |
| POST | `/api/admin/license/activate` | Owner | 提交激活码 |

## 10. 落点

| 组件 | 路径 |
|---|---|
| 编解码 | `webui/server/license/codec.ts` |
| 持久化 | `webui/server/license/store.ts` |
| 快照/enforcement | `webui/server/license/entitlement.ts` |
| Admin API | `webui/server/license/routes.ts` |
| 签发 CLI | `scripts/license-issue.mjs` |
| WebUI | `/admin/license` |
| Agent 门禁 | `webui/server/admin/agents.ts` |
| MCP 门禁 | `webui/server/proxy/mcp-proxy.ts` |
