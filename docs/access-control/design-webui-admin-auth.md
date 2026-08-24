# WebUI 管理员登录与 Token 失效补齐

| 元数据 | 内容 |
|---|---|
| 文档名称 | WebUI Admin Auth + Token Expiry |
| 文档类型 | Design |
| 版本 | v1.0 |
| 撰写日期 | 2026-08-20 |
| 委托人 | xingchen |
| 状态 | 实施中（本分支） |
| 适用范围 | Token `expires_at` 运行时强制；WebUI 登录；多管理员本地账户 |

---

## 1. 背景

当前短板：

1. **Token 失效日期**：Admin 可写 `expires_at`，手册却写「只是 metadata」；Proxy `identifyRequest` **未校验**，与 Spec 07 的 `token_expired` 裁决码不一致。
2. **WebUI 无登录**：所有 `/api/*`（含 Admin 写路径）对本机网络开放；配置审计 actor 固定为 `local-admin`。
3. **无多管理员**：无法区分操作者，也无法在共享实例上做管理员身份隔离。

既有 AC-P0–P1.5（Draft PR #3）覆盖 MCP capability / Row Policy，**不覆盖**本设计。本设计与 PR #3 正交，可独立合入。

## 2. 目标

| ID | 目标 |
|---|---|
| G1 | 到期 Token 在 MCP Proxy 鉴权阶段失败（401）；不可解析的 `expires_at` fail-closed |
| G2 | 可配置的 WebUI 本地管理员登录（Cookie Session） |
| G3 | 支持多名管理员；Owner 可增删管理员；审计 actor 使用真实管理员 id |
| G4 | 无管理员配置时保持 open 模式，不破坏既有测试与本机单人工作流 |
| G5 | 不引入 SSO / OIDC（后续另立） |

## 3. 非目标

- SSO / OIDC / LDAP
- 管理员细粒度 RBAC（本轮仅 `owner` / `admin` 两级）
- 把 MCP Agent Token 与 WebUI 登录混用
- 多租户隔离

## 4. Token `expires_at` 强制

### 4.1 规则

- `expires_at` 缺省 / `null` → 永不过期（现状兼容）
- 可解析时间戳且 `<= now` → 视为未识别身份（401），与撤销同等拒绝面
- 不可解析字符串 → **fail-closed**（拒绝）
- 日期-only `YYYY-MM-DD`（NewToken date picker）在创建时规范化为当日 `T23:59:59.999Z`

### 4.2 落点

- `webui/server/proxy/identity.ts`
- 手册 FAQ / §6.5 同步改为「会自动失效」
- Spec 07 `token_expired` 保持；HTTP 层仍可与 revoked/unknown 统一 401（本轮不强制区分响应体）

## 5. WebUI 管理员体系

### 5.1 事实源

`webui/config/admins.yaml`（`webui/config/` 已在 fs-safe ALLOW 内）：

```yaml
version: "1"
admins:
  - id: xingchen
    display_name: 星尘
    password_hash: "scrypt:<saltHex>:<hashHex>"
    role: owner   # owner | operator（legacy admin → operator）
    enabled: true
    created_at: "2026-08-20T00:00:00.000Z"
```

密码明文永不落盘；仅 scrypt 派生。

### 5.2 模式

| 模式 | 条件 | 行为 |
|---|---|---|
| `open` | 无启用中的管理员，且 `LUCY_WEBUI_AUTH` ≠ `required` | 不强制登录；actor=`local-admin` |
| `bootstrap` | 无启用中的管理员，且 `LUCY_WEBUI_AUTH=required` | 仅允许 bootstrap 首个 Owner |
| `required` | 至少一名启用管理员 | 除公开路由外需有效 Session |
| 强制关闭 | `LUCY_WEBUI_AUTH=off` | 始终 open（CI / 特殊调试） |

### 5.3 Session

- Cookie 名：`lucy_admin_session`
- HttpOnly + SameSite=Lax；Path=/
- HMAC-SHA256 密封；密钥：`LUCY_WEBUI_SESSION_SECRET`，缺省则持久化到 `.ktx-ui/webui-session-secret`
- 默认有效期 7 天

### 5.4 API

| Method | Path | 说明 |
|---|---|---|
| GET | `/api/auth/status` | `{ mode, me? }` 公开 |
| POST | `/api/auth/login` | `{ adminId, password }` |
| POST | `/api/auth/logout` | 清 Cookie |
| GET | `/api/auth/me` | 当前管理员（required 时需登录） |
| POST | `/api/auth/bootstrap` | 创建首个 Owner（仅 open/bootstrap） |
| GET/POST/PATCH/DELETE | `/api/admin/admins…` | 管理员管理（Owner） |

### 5.5 角色

| Role id | UI 主术语 | 能力 |
|---|---|---|
| `owner` | 所有者 | 全部 WebUI 写路径 + 管理登录账户 |
| `operator` | 运维 | 全部日常 WebUI 写路径（连接 / 语义 / Wiki / 发布 / Eval / Agent·Role·Token / 审计）；**不可**管理登录账户 |

读入兼容：YAML 中旧值 `admin` 视为 `operator`。

运维即「普通运维人员」岗位：负责连接、配置语义、Eval、添加和管理 Agent Role（`access.yaml`）等日常工作；所有者保留控制面账户治理与 break-glass 相关责任。

本轮仍不做更细的 WebUI RBAC（例如「只能看审计」）。

### 5.6 审计

`config_change_log.actor` / governance gate actor 在 Session 存在时使用 `adminId`，否则回退 `local-admin`。

### 5.7 凭据丢失与 break-glass（非邮箱找回）

自托管不提供邮箱「忘记密码」。恢复契约写在系统手册：

- FAQ：`docs/SYSTEM_HANDBOOK.md` §0.2「忘记 WebUI 管理员账号或密码怎么办？」
- Runbook：同手册 §3.5「丢失管理员账号或密码时如何恢复（break-glass）」

原则：优先其他所有者重置；否则配置卷清空 `admins.yaml` → `LUCY_WEBUI_AUTH=required` → `/login` 重新 bootstrap；全程变更审计，不落密码明文。

## 6. Terminology Compliance

本功能遵循 `webui/docs/00-product-terminology-standard.md`。

New terms:

| 英文 / 内部 | UI 主术语 | 禁止 |
|---|---|---|
| WebUI Admin / 登录账户 | 登录账户 | 超管、用户（易与 Agent 混淆） |
| Owner | 所有者 | 超管（可作为副文案时需登记） |
| Operator | 运维 | 管理员（易与所有者混淆） |
| Legacy role `admin` | 运维 | 作为主术语 | 读入等价 operator |
| Login | 登录 | Sign in 裸用 |
| Session | 会话 | |
| Token Expiry / `expires_at` | 过期时间 | 失效日期（可用作说明同义） |

Protected DOM：`Token`、`MCP`、账户 id、`expires_at` 值。

## 7. Design System Compliance

- 登录页：单栏表单，沿用现有 `pl-input` / `pl-btn` / 品牌块，不做独立营销落地页。
- 登录账户列表：落在「访问治理」导航组，交互容器用现有 list/detail 模式。

## 8. 验收

1. 过期 Token 调 MCP Proxy → 401；未过期正常。
2. 配置登录账户后访问 `/api/admin/agents` 无 Cookie → 401；登录后 200。
3. 所有者与运维可分别登录；配置变更 actor 为各自 id。
4. Owner 可创建运维账户；运维不可调用登录账户管理 API；不可删除最后 Owner。
5. 无 `admins.yaml` / 空列表时现有 vitest 套件无需改登录样板即可通过。
6. `npm run lint:terminology` 通过。

— 完
