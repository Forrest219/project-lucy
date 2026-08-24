# Token Device Security & Audit Context Spec

| 元数据 | 内容 |
|---|---|
| 文档名称 | Token Device Security & Audit Context Spec |
| 文档类型 | Spec |
| 版本 | v1.1 |
| 撰写日期 | 2026-08-20 |
| 撰写人 | Composer |
| 委托人 | xingchen |
| 基于材料 | Token 设备绑定与定向吊销优化方案；Spec 07 / 08；`docs/security-guide.md` |
| 适用范围 | MCP Proxy 访问审计网络上下文；Agent Token 设备元数据；按 Token 定向吊销；过期强制与吊销即时生效 |
| 输出位置 | `webui/docs/124-token-device-security-and-audit-context-spec.md` |

| 字段 | 内容 |
|---|---|
| Spec 编号 | 124 |
| 关联页面 | `/admin/agents/:userId` Token Tab；`/admin/agents/:userId/tokens/new`；`/admin/audit` 调用流水 |
| 上游 Spec | Spec 07（MCP Auth Proxy）、Spec 08（审计追踪）、Spec 14（Agent Admin）、Spec 106（Audit URL） |
| 状态 | Implemented |
| 日期 | 2026-08-20 |
| 范围 | access_log 网络/客户端字段；Token `device_name` 可选备注；设备视角清单与定向吊销；`expires_at` 强制；revoke 清缓存；鉴权失败审计 |

### Changelog

| 版本 | 变更 |
|---|---|
| v1.1 | 创建时设备名改为纯可选备注（可空、不默认 label）；`access_log.device_name` 仅来自运行时头，不再回填 YAML 备注 |
| v1.0 | 初稿并落地 |

## 1. 背景

访问审计与 Token 清单此前缺少访问 IP、User-Agent、设备名等上下文；管理员只能看到 `label` / `last_used`，难以按「哪台客户端安装」做定向吊销。控制模型对齐 GitHub PAT / Cursor API Key：**一 Token ≈ 一台客户端安装**，吊销单元始终是 Token hash，不做独立 Device 主键，也不做硬件指纹强绑定。

创建时填写的设备名只是**可选备注 / 兜底文案**，不是端到端绑定。真正端到端归因依赖 MCP 运行时观测：**Agent 类型**（`clientInfo.name` / `version`）与**设备名**（可选头 `x-lucy-device-name`）。两类信息必须落库保留，但不得强制（缺失不影响鉴权与调用）。

## 2. 目标

1. 每次 MCP 调用写入 `client_ip` / `user_agent` / `client_version`；有头时写入运行时 `device_name`。
2. Token 创建可登记可选备注 `device_name`（可空）；列表分开展示备注、Agent 类型、最近设备名，并支持定向（含批量）吊销。
3. Proxy 强制拒绝已过期 Token；吊销后立即清 access 配置缓存。
4. 鉴权失败写入 `auth_failure_log`（含 IP/UA/原因）。

## 3. 非目标

| 非目标 | 理由 |
|---|---|
| OIDC / WebUI 多用户 Sessions | 与 vision / Spec 07 一致 |
| 硬件指纹强制绑定 | MCP 客户端无统一可信能力 |
| 独立 Device 实体与按设备吊销 API | 吊销键仍为 Token `label` / hash |
| 按 Agent 类型 / 设备名鉴权白名单 | 运行时字段仅观测，不强制 |
| MCP session 级踢下线 registry | 后续迭代；本期以 Token 吊销为准 |
| 浏览器 / 窄屏测试 | 项目默认治理；以 API/单测验收 |

## 4. Terminology Compliance

Follows `webui/docs/00-product-terminology-standard.md` §4.5 / §4.7（本 Spec 增补）。

| Canonical Term | UI 主术语 | 允许补充说法 | 禁止文案 | 说明 |
|---|---|---|---|---|
| Device Name Remark | 设备名备注 | 备注 | Device（裸露作主标签）、绑定设备（暗示强绑定） | 签发时可选；不写 access_log |
| Last Seen Device Name | 最近设备名 | 运行时设备名 | 与备注混用为单一「设备名」列 | 仅 `x-lucy-device-name` 观测 |
| Agent Client Type | Agent 类型 | 客户端 | Device 类型 | `clientInfo.name` + version |
| Client IP | 访问 IP | 最近访问 IP | remoteAddress、XFF（裸露作主标签） | `access_log.client_ip` |
| User-Agent | User-Agent | UA | 浏览器指纹 | HTTP 头截断存储 |
| Client Version | 客户端版本 | — | clientInfo.version（裸露） | MCP `initialize.clientInfo.version` |
| Token Device Inventory | Token 设备清单 | 设备视角 Token 列表 | 已登录设备、Sessions | Agent Token Tab |

Protected：`Agent`、`Token`、`MCP`、设备名值、访问 IP、User-Agent、token hash prefix → `notranslate`。

## 5. 数据契约

### 5.1 `access_log` 新增列

| 列 | 类型 | 来源 |
|---|---|---|
| `client_ip` | TEXT | `X-Forwarded-For` 首跳（`LUCY_TRUST_PROXY=1` 时）或 socket remoteAddress |
| `user_agent` | TEXT | HTTP `User-Agent`，最长 256 |
| `client_version` | TEXT | session 缓存的 `clientInfo.version` |
| `device_name` | TEXT | **仅**可选头 `x-lucy-device-name`，最长 128；不得回填 YAML 备注 |

### 5.2 `auth_failure_log`

| 列 | 说明 |
|---|---|
| `ts` / `client_ip` / `user_agent` | 请求上下文 |
| `reason` | `missing_bearer` \| `token_unrecognized` \| `token_revoked` \| `token_expired` |
| `token_hash_prefix` | 可识别时写入前缀 |
| `user_id` / `token_label` | 过期/已撤销且能解析时写入 |

### 5.3 Token YAML 元数据

```yaml
tokens:
  - hash: sha256:...
    label: cursor-laptop-xingchen
    created: "2026-08-20"
    device_name: "xingchen-mbp"   # optional remark only; omit when empty
    expires_at: "2026-12-31T00:00:00.000Z"  # enforced by Proxy
```

派生（不写 YAML）：`last_used` / `last_tool` / `last_outcome` / `last_ip` / `last_user_agent` / `last_client` / `last_client_version` / `last_device_name_seen` / `distinct_ips_7d`。

### 5.4 `config_change_log.actor_ip`

`token_create` / `token_revoke`（及同管道写审计）记录管理员请求 IP。

## 6. 运行时行为

1. `identifyRequest`：hash 匹配后若 `expires_at` 已过 → 失败 `token_expired`。
2. Token DELETE：先 `revoked_tokens`，再 YAML，再 `invalidateAccessConfigCache()`。
3. 信任代理：仅当 `LUCY_TRUST_PROXY=1`（或 `true`）时采用 `X-Forwarded-For` 首跳。
4. `access_log.device_name` 只接受请求头；YAML 备注仅供管理面展示。

## 7. UI

- **New Token**：可选「设备名备注」；引导配置 `x-lucy-device-name` 与一台安装一个 Token。
- **Agent Token Tab**：分开展示备注 / Agent 类型 / 最近设备名 / 最近 IP；单条与批量撤销。
- **Audit 调用流水**：展示/筛选访问 IP、User-Agent、运行时设备名、客户端版本。

## 8. 验收

- 创建时不填设备名备注 → YAML 无该字段，响应 `device_name: null`。
- 审计页可见 Agent 类型与（若客户端发送）最近设备名；缺头不阻断调用。
- Token 列表备注与最近设备名分列，互不顶替。
- 吊销后新请求立即 401；过期 Token 401 且 `auth_failure_log.reason=token_expired`。
- 明文 Token 仍只出现一次；审计不落明文。
