# Lucy v0.25 OIDC 单点登录 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 | 功能设计基线（Authentication / WebUI / Customer Deployment） |
| 文档版本 / 日期 | v0.3-implementation-alignment / 2026-10-25 定稿；2026-10-26 回写 §4.2 client secret 权限，Asia/Shanghai |
| 功能编号 / 目标版本 | L25-06 / v0.25 |
| 优先级 | P1：企业身份接入；不改变既有 P0／P1 验收与交付阻断状态 |
| 状态 | **需求审查已签核通过（2026-10-25）；2026-10-25 获 PM 开发授权并完成实施（提交 `b89e14d`、`f933c2c`）；OIDC-24／OIDC-25 因真实环境不可得记 `blocked_environment`；§4.2 权限口径已于 2026-10-26 按真实部署事实回写。实现完成不等于验收通过，也不等于客户交付通过** |
| 需求来源 | [Lucy 2.5 功能升级建议书](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) §2.1 L25-06；2026-10-25 Forrest 要求开始设计并批准评审裁定与 Spec 定稿 |
| 审查记录 | [L25-06 OIDC Spec 评审记录](../reviews/2026-10-25-lucy-v0.25-l25-06-oidc-spec-review-record.md)（M-01–M-04、F-03、G-01 签核条件已关闭） |
| 现有基础 | `webui/server/auth/oidc-profile.ts`、`admins.yaml` 的 `oidc_bindings`、v2 持久会话、Helm 预留 `oidc` values |
| 实施主体 | Lucy；不修改 KTX，不改变 MCP Agent／Role／Token 数据面权限 |
| 部署边界 | 单实例、单副本；客户 linux/amd64 Kubernetes；默认关闭 OIDC，本地登录始终保留 |

> 本文件定义拟实现行为，不代表功能已经实现或验收通过。本文批准后，仅在企业安全 Spec §1.1 的 OIDC 非目标上形成有边界的例外；其他安全合同继续有效。
>
> 相对建议书原始 L25-06 表述的两处明确化已经 2026-10-25 Forrest 批准：① OIDC 凭据的认证、找回与 MFA 由身份源承担，Lucy 本地密码仍由 owner 重置并保留 break-glass；② 无论身份源是否可用，本地密码登录都保留，且至少一名启用中 owner 必须具有本地密码。这是恢复与降级合同的加强，不是未声明偏离。

## 0. 设计决议摘要

| 编号 | 决议 |
|---|---|
| D01 | 使用 **OIDC Authorization Code Flow + PKCE S256 + state + nonce**；不使用 Implicit Flow、Resource Owner Password Credentials 或前端直接验签。 |
| D02 | OIDC 只证明外部身份。Lucy 以预先配置的 `(issuer, sub)` 绑定找到本地登录账户，再从 `admins.yaml` 读取 owner／operator；**不按邮箱认人，不从 IdP 用户组或自定义 claim 推导角色**。 |
| D03 | 不支持 Just-in-Time 自动建号。未绑定身份不能创建账户、选择角色或进入 bootstrap。 |
| D04 | 本地账户 id 与密码登录始终保留。首个所有者必须通过既有受控 bootstrap 创建，且必须具有本地密码；OIDC 不参与首个账户认领。 |
| D05 | 至少保留一名启用中且具有本地密码的所有者。任何会使该约束不满足的密码移除、解绑后无凭据、禁用、降级或删除均被拒绝，防止只依赖外部 IdP。 |
| D06 | 复用现有 `account_uid`、`session_epoch`、`admin_sessions` 和每请求 fresh-read；OIDC 登录与本地登录获得同一类 v2 Lucy 会话，不在 Cookie 中写入 IdP token。 |
| D07 | 本期退出仅吊销 Lucy 会话，不执行 IdP 全局退出。`endSessionEndpoint`／`logoutStyle` 继续作为预留配置，不在本期启用；界面必须说明身份源会话可能仍有效。 |
| D08 | 不在每个 Lucy 请求中调用 IdP。IdP 后续停用、回收或撤销不能实时吊销已发 Lucy 会话；需要立即收窄时，使用 Lucy 账户禁用、绑定移除、角色变更或受控会话轮换。 |
| D09 | 提供方配置由部署侧管理，client secret 只从独立 Secret 文件读取；不进入 `admins.yaml`、ConfigMap、普通环境变量、浏览器、审计或日志。 |
| D10 | 默认关闭 OIDC；配置缺失、IdP 不可达或 OIDC 校验失败只拒绝 OIDC 登录，不改变本地登录、bootstrap 和 break-glass，也绝不回退到开放模式。 |
| D11 | 单实例内保存短期、一次性登录事务；进程重启使未完成 OIDC 登录失败并允许重新发起，不为此升级安全库 schema。 |
| D12 | 不保存 access token、refresh token 或原始 ID token；不调用 userinfo 作为授权依据。本期不需要离线访问，默认配置不得请求 `offline_access`；兼容预留值即使携带该 scope，也不得持久化或使用 refresh token。 |

## 1. 现状证据与复用边界

### 1.1 已存在的能力

| 现有能力 | 本 Spec 的处理 |
|---|---|
| `oidc-profile.ts` 已能解析 issuer、端点、clientId、scopes、tokenEndpointAuth、redirectPath、publicWebuiUrl，并拒绝内联 client secret | 作为配置解析基础；实现时补齐运行时加载、启用开关和密钥文件，不重造第二套 profile |
| `admins.yaml` 已有 `oidc_bindings[]: {issuer, sub, email}`，并检查 `(issuer, sub)` 与 `(issuer, email)` 冲突 | 继续作为绑定事实源；email 仅为所有者维护的联系信息，不参与登录匹配 |
| `ACTIVE_LOGIN_METHODS` 当前固定为 `["local"]` | 改为按有效 OIDC 配置派生；不能仅凭预留 values 或绑定记录开放入口 |
| 当前创建账户要求本地密码；公开账户视图不包含绑定 | 扩展所有者专用账户管理合同；公开 `/api/auth/status` 不泄露 issuer、clientId、email 或 sub |
| v2 会话由持久 `jti`、`account_uid`、`session_epoch` 与当前账户状态共同裁决 | 原样复用；不另发 SSO Cookie，不把 IdP 的过期时间当作 Lucy 会话期限 |
| 退出、密码重置、角色变化、禁用、删除已有耐久撤销顺序 | OIDC 绑定移除与本地密码移除复用“先收窄、后写配置” |
| Helm 已有预留 `oidc` values，但不会注入 Pod，也不会联系 issuer | 实施时新增受控接线；预留值存在本身不代表功能已启用 |
| 登录页、公开系统手册与 break-glass 已存在 | 保留本地登录和恢复入口；不得改成只能跳转 IdP 的登录页 |

### 1.2 明确不变

- owner 与 operator 的职责不变；仅 owner 管理登录账户与 OIDC 身份绑定。
- `LUCY_DEPLOYMENT_MODE=customer`、禁止 customer + `LUCY_WEBUI_AUTH=off`、受控 bootstrap、限速、持久审计失败关闭均不变。
- WebUI Cookie 不能作为 MCP Bearer；MCP Agent、Token、Role、行级策略与问询预算不受 OIDC 影响。
- 单实例／单副本不变；不引入分布式登录事务、跨副本会话或多 IdP 路由。
- 不增加忘记密码、SMTP、Lucy 自建 MFA、用户自助注册或自助绑定。

## 2. 目标与非目标

### 2.1 目标

1. 客户可将一个既有 OIDC 身份源接入 Lucy WebUI。
2. 已绑定的所有者与运维通过身份源登录后，获得与其本地账户一致的职责。
3. 本地登录、首个所有者引导及 break-glass 在 IdP 不可用时仍按既有合同工作。
4. 登录流程具备防重放、防登录 CSRF、防令牌替换、防开放跳转和最小敏感信息暴露。
5. 客户镜像可离线安装；只有实际使用 OIDC 登录时才需要访问客户身份源。

### 2.2 非目标

- 多身份源、多租户 claim 映射、Active Role、动态 RBAC、SCIM、用户目录同步。
- 自动注册、自动关联同邮箱账户、邀请链接、匿名认领或公开账户发现。
- IdP 用户组到 owner／operator 的映射，或 IdP 对 MCP 数据面直接授权。
- RP-Initiated Logout、Back-Channel Logout、Front-Channel Logout、实时 IdP 吊销监听。
- refresh token、离线访问、Lucy 代调下游 API、token exchange。
- 把 email 改为登录账户 id；把 OIDC 当作 break-glass 的替代。
- 多副本、分布式锁或跨 Pod 登录事务。

本功能只增加 WebUI 认证路径，不建立 SSO claim 权限事实源，不重开[权限路线图冻结](../access-control/adr-post-p15-roadmap-freeze.md) F3／F4。未来若引入 claim 到 Role、行域、租户或 Active Role 的映射，必须按对应议题另立 WO 并通过 Gate A；不得以本 Spec 作为授权依据。

## 3. 身份、账户与绑定合同

### 3.1 四类标识不得混用

| 标识 | 职责 | 是否参与 OIDC 登录匹配 |
|---|---|---|
| `account_uid` | Lucy 不可变账户身份；会话与 tombstone 使用 | 间接使用：绑定解析后由本地账户提供 |
| `admins[].id` | Lucy 登录账户的可读标识；本地登录与审计 actor 使用 | 否；不得由 email、`preferred_username` 或 `sub` 自动改写 |
| `(issuer, sub)` | 某一身份源内的外部主体身份 | **是，唯一匹配键** |
| `email` | 所有者维护的联系信息 | **否**；大小写、已验证标记和唯一性都不构成身份认证 |

`issuer` 按配置字符串精确匹配，不做末尾斜杠、大小写或 URL 归一化猜测。`sub` 按原始字符串精确匹配。一个 `(issuer, sub)` 最多绑定一个本地账户；同一 issuer 下 email 冲突继续按现有解析合同拒绝，避免所有者误维护，但该检查不是安全裁决。

### 3.2 账户凭据形态

| 形态 | 本地登录 | OIDC 登录 | 允许角色 |
|---|---|---|---|
| 本地密码＋OIDC 绑定 | 可用 | 可用 | owner／operator |
| 仅本地密码 | 可用 | 不可用 | owner／operator |
| 仅 OIDC 绑定 | 不可用 | 可用 | owner／operator，但不能成为唯一的本地恢复所有者 |
| 无密码且无绑定 | 不可用 | 不可用 | 配置无效，失败关闭 |

账户仍必须具有 `account_uid`；旧账户首次登录时沿用既有受控迁移。删除后重建相同账户 id 必须使用新 `account_uid`。重新绑定相同 `(issuer, sub)` 是被显式授权的新绑定，不复活旧会话。

### 3.3 绑定管理

仅 owner 可在「登录账户」完成以下操作：

- 创建本地账户、创建带 OIDC 绑定的账户，或创建双凭据账户。
- 为既有账户新增、替换或删除当前 issuer 的绑定。
- 查看登录方式、绑定 issuer、sub 与联系 email；operator 不获得绑定管理写权限。
- 设置、重置或移除本地密码；每次写入后账户至少保留一种有效凭据。

绑定移除、绑定替换、本地密码移除属于认证面收窄：先提升 `session_epoch` 并撤销既有会话，再写 `admins.yaml`。新增绑定属于新增登录入口：先验证完整配置与冲突，再写配置；不得自动登录当前操作者之外的账户。

任何写入都必须重新读取完整配置并检查：

1. 账户 id、`account_uid`、角色与启用状态合法；
2. `(issuer, sub)` 和既有 email 冲突规则通过；
3. 账户至少保留一种凭据；
4. 至少一名启用中 owner 具有本地密码；
5. 收窄操作已完成耐久撤销；
6. 配置审计和认证事件可写入。

任一步失败不得报告成功，不得回退到更宽的旧认证状态。

## 4. OIDC 提供方与部署配置

### 4.1 配置事实源

OIDC 提供方采用**部署侧只读配置文件**，不是 WebUI 可编辑配置。建议运行时合同：

| 配置 | 来源与约束 |
|---|---|
| `LUCY_OIDC_CONFIG_FILE` | 指向只读 YAML／JSON profile；未设置表示未启用 |
| `LUCY_OIDC_CLIENT_SECRET_FILE` | 指向独立 Secret 文件；与 profile 成对必需 |
| `webui.publicUrl` | Helm 写入 profile 的 `publicWebuiUrl`；必须是 HTTPS origin，不带路径、query 或 fragment |
| `oidc.*` | 复用现有 issuer、静态端点、clientId、scopes、tokenEndpointAuth、redirectPath 等字段 |
| `oidc.enabled` | 新增，默认 `false`；关闭时不生成运行时配置或 Secret 接线 |
| `oidc.existingSecret`／`oidc.clientSecretKey` | 新增，引用客户既有 Kubernetes Secret；不得新增明文 `clientSecret` value |

`security.access=http` 不得启用 OIDC，因为公开回调 origin 与 Cookie 均要求 HTTPS。私网 issuer／端点使用 HTTP 只能在部署配置中显式给出，不从请求推断；该例外不降低 `publicWebuiUrl`、回调 Cookie 或 client secret 的保护要求。目标客户验收默认使用 HTTPS issuer 与端点。

### 4.2 Profile 规范

```yaml
issuer: https://idp.example.com
authorizationEndpoint: https://idp.example.com/oauth2/authorize
tokenEndpoint: https://idp.example.com/oauth2/token
jwksUri: https://idp.example.com/oauth2/jwks
endSessionEndpoint: https://idp.example.com/logout  # 可选预留，本期不使用
clientId: lucy-webui
scopes: openid profile email
tokenEndpointAuth: client_secret_post  # 或 client_secret_basic
logoutStyle: id_token_hint              # 可选预留，本期不使用
redirectPath: /api/auth/oidc/callback
publicWebuiUrl: https://lucy.example.com
```

规范性约束：

- `scopes` 必须包含独立 scope `openid`；实现默认改为 `openid profile email`。额外 scope 可透传，但 Lucy 不据此取得新权限。
- 本期不需要 `offline_access`；即使旧预留配置携带，也不得持久化或使用 refresh token。
- `discoveryUrl` 保留为兼容字段，本期不参与运行时裁决。授权、token 与 JWKS 端点以上述静态配置为唯一事实源，避免双事实源。
- `redirect_uri` 只能由 `publicWebuiUrl + redirectPath` 生成，不使用请求 `Host`、`Origin` 或 `X-Forwarded-Host`。
- `endSessionEndpoint` 与 `logoutStyle` 均为可选预留字段；存在时也不触发网络请求，本地退出不依赖 IdP。S1 必须扩展既有 `parseOidcProfile` 落实本款与 `openid` 校验，不重造第二套 parser。
- client secret 文件在启动加载时必须非空、去除单个末尾换行后使用；**权限必须是 0400、0440、0600 或 0640，且 other 位永不可读**。文件缺失、不可读或为空时 OIDC 不可用，本地登录继续。
- 不将 client secret 放入命令参数、ConfigMap、普通环境变量、values、页面、异常、审计或证据包。

> **2026-10-26 回写（§4.2 client secret 权限）**：原文写「权限为 0400 或 0600」。实现期查明交付 Chart 的 `podSecurityContext.fsGroup: 10001` 会让 kubelet 在挂载 Secret 时按 fsGroup 改写文件权限——**即使模板声明 `defaultMode: 0400`，容器内实际读到的也是 `root:10001` 0440**。按原文字面实现，OIDC 会在每一种真实客户部署上被运行时拒绝，并**静默失效**（对外只表现为「单点登录不可用」）。
>
> 因此把可接受集合改为 **0400／0440／0600／0640**，并把判定依据明确为「**other 位永不可读**」：安全意图与原文一致，其余模式（尤其任何 other 可读位）一律拒绝。0440 与 0640 是**真实部署的常态**而非放宽要求；本次回写不放松本节任何其他约束。
>
> 实现口径见 `webui/server/auth/oidc-runtime.ts` 的 `ALLOWED_SECRET_MODES`，验收断言见实施记录 §4 的 OIDC-21 与 §7.2。

### 4.3 启动与运行时状态

- **配置只在进程启动时加载一次。** 启动预检读取并校验 profile 与 client secret 文件，构造不含敏感值的公开 `oidcRuntimeView` 和进程内 `profileDigest`；secret 仅保留在进程内存供 code 交换使用。
- `GET /api/auth/status` 的 methods 只从启动期缓存派生，未认证请求路径不得读取 profile 或 secret 文件，也不根据 mtime 轮询。文件内容变化必须重启进程后生效；本期不引入 watcher、定时重载或热更新 API。
- 启动预检只做本地配置与文件校验，不访问 issuer，不把 IdP 连通性加入 startup／readiness／liveness probe。
- OIDC 配置无效时，缓存状态仅提供本地登录；所有者登录后的健康摘要可显示“单点登录配置不可用”，不得展示 secret 或完整敏感配置。
- 配置有效只表示启动时本地解析成功，不表示 IdP 可连接。IdP 临时故障不改变 `admins.yaml` 的 `required` 状态。
- 重启后新登录使用新 profile，未完成登录事务因进程内存清空而失败并可重试；既有 Lucy 会话仍按本地会话合同裁决。需要立即全量退出时执行受控会话轮换，不能假设关闭 OIDC 或重启会撤销会话。

## 5. 浏览器与 API 合同

### 5.1 登录页与账户页

- `/login` 保留本地「登录账户＋密码」表单；OIDC 有效时增加主按钮「使用单点登录」和辅助说明「由贵组织的身份源完成认证」。
- 不做强制自动跳转。IdP 故障、返回错误或用户需要 break-glass 时，本地入口仍可见。
- `mode=bootstrap` 只显示创建首个所有者的本地流程，不显示 OIDC 按钮。
- OIDC 失败后返回 `/login`，显示固定的可理解错误，不展示原始 IdP 响应、token、claim 或堆栈。
- 登录成功后清理 OIDC 临时 Cookie，复用现有 auth epoch 与受保护查询缓存清理，再进入安全的 `returnTo`。
- 「登录账户」增加「登录方式」与所有者专用「身份绑定」维护；不新增导航组，不把账户 id 改成邮箱。
- 退出成功文案为「已退出 Lucy；组织身份源的登录状态可能仍然有效」。不得写成「已退出所有账户」。
- OIDC、issuer、URL、账户 id 与 sub 的 DOM 节点按术语标准添加 `translate="no"` 与 `notranslate`。

### 5.2 公开认证接口

| 接口 | 合同 |
|---|---|
| `GET /api/auth/status` | 既有字段不变；OIDC 配置有效时 `methods=["local","oidc"]`，否则为 `["local"]`。bootstrap 时只返回 local。不得返回 issuer、clientId、端点或绑定信息 |
| `POST /api/auth/oidc/start` | Body 仅允许可选 `returnTo`；建立一次性事务，返回 `{ ok:true, data:{ authorizationUrl } }`。响应 `Cache-Control: no-store` |
| `GET /api/auth/oidc/callback` | 校验 IdP 返回、一次性事务、code、ID token 和本地绑定；成功时设置既有 Lucy 会话 Cookie，清除临时 Cookie，303 到安全 `returnTo` |
| `POST /api/auth/login` | 保持本地密码登录，不因 OIDC 启用而关闭 |
| `POST /api/auth/bootstrap` | 保持一次性引导密钥和本地密码要求，不接受 OIDC 凭据 |
| `POST /api/auth/logout` | 保持先耐久吊销 Lucy 会话再清 Cookie；不调用 IdP |

`returnTo` 只能是 Lucy 站内绝对路径：必须以单个 `/` 开头，不得包含 scheme、netloc、`//`、反斜杠、控制字符或外部重定向参数；无效时回退 `/overview`。

OIDC start／callback 加入公开 API allowlist，但仍经过统一 `no-store`、可信网络信息、限速与认证事件路径。callback 的 `error`、`error_description` 只用于固定分类，不回显 description。

### 5.3 所有者绑定接口

在既有 `/api/admin/admins` 合同上扩展，不新建独立权限域：

| 操作 | 拟扩展合同 |
|---|---|
| 创建账户 | `POST /api/admin/admins` 接受可选 `oidcBinding:{issuer,sub,email}`；无绑定时 `password` 必填，有绑定时可与密码二选一或同时提供 |
| 查看账户 | owner 可见 `loginMethods` 与绑定详情；非 owner 不获得绑定写能力，公开认证视图不包含绑定 |
| 新增／替换绑定 | `PUT /api/admin/admins/:adminId/oidc-binding`，Body 为 `{issuer,sub,email}`；仅 owner，执行冲突与收窄检查 |
| 删除绑定 | `DELETE /api/admin/admins/:adminId/oidc-binding?issuer=...`；仅 owner；先撤销会话，且不得留下无凭据账户或破坏本地恢复所有者约束 |
| 移除本地密码 | 既有 PATCH 增加显式 `removeLocalPassword:true`；仅在仍有有效 OIDC 绑定时允许，并先撤销会话 |

绑定写接口不接受 `role` 隐式变更，不从请求中的 email 或 displayName 推断账户。角色变更继续走既有独立字段和审计。所有新增／替换绑定及带绑定创建都要求请求 `issuer` 与启动期缓存的当前 `profile.issuer` **逐字符串完全相等**；不做末尾斜杠、大小写或其他 URL 归一化，不匹配时由该写接口返回 400 `OIDC_ISSUER_MISMATCH`。此码不属于登录回调；登录侧 issuer 不同只按未绑定处理。

## 6. 核心流程（伪代码）

### 6.1 发起 OIDC 登录

```text
function startOidc(request):
    assert request.method == POST
    gate = gateOidcStartAttempt(request)           // sourceTotal + oidcStartSource
    if !gate.ok:
        return replyAuthGate(gate)                 // 429 + Retry-After；存储失败为 503

    if authMode != required:
        reject OIDC_NOT_AVAILABLE                 // open/bootstrap/unavailable 均不借用 OIDC

    runtime = getStartupOidcRuntimeView()          // 启动期缓存；本请求不读盘
    if !runtime.enabled:
        auditFailure(reason="oidc_config_unavailable", withoutSecrets=true)
        reject OIDC_NOT_AVAILABLE                  // 本地登录不受影响
    profile = runtime.profile

    returnTo = sanitizeInternalReturnTo(request.body.returnTo) or "/overview"
    state = random256Bits()
    nonce = random256Bits()
    verifier = random256Bits()
    challenge = base64url(SHA256(verifier))

    loginTransactions.putSingleUse(
        key=SHA256(state),
        value={nonce, verifier, returnTo, profileDigest: profile.canonicalDigest,
               expiresAt: now+10min},
        ttl=10min,
        maxEntries=1024
    )
    setCookie("lucy_oidc_transaction", state,
              HttpOnly, SameSite=Lax, Secure, Path=callbackPath, MaxAge=600)

    authorizationUrl = profile.authorizationEndpoint + query({
        response_type: "code",
        client_id: profile.clientId,
        redirect_uri: profile.publicWebuiUrl + profile.redirectPath,
        scope: profile.scopes,
        state: state,
        nonce: nonce,
        code_challenge: challenge,
        code_challenge_method: "S256"
    })
    return {authorizationUrl}
```

登录事务只存在当前单进程内存。原始 state 只存在于浏览器事务 Cookie、授权跳转与回调，不以明文落盘；服务端索引保存其 SHA-256。`profileDigest` 是移除 client secret 后的规范配置摘要，用于阻止发起与回调之间的配置替换。事务过期、重启、容量淘汰或配置摘要变化均失败关闭，用户可重新发起。不得用固定 state、仅前端 localStorage 或无服务器校验的 nonce。

### 6.2 回调、身份解析与会话签发

```text
function oidcCallback(request):
    setHeaders(CacheControl="no-store", ReferrerPolicy="no-referrer")
    state = request.query.state
    stateHash = SHA256(state)
    gate = gateOidcCallbackAttempt(request, stateHash)
        // 总是命中 sourceTotal + oidcCallbackSource；
        // 仅当 stateHash 对应真实事务时再命中 oidcTransaction，不为随机 state 建桶。
    if !gate.ok:
        return replyAuthGate(gate)

    txCookie = readCookie("lucy_oidc_transaction")
    tx = loginTransactions.consumeOnce(stateHash)       // 先消费，成功失败均不可重放
    if tx missing/expired or txCookie missing or !constantTimeEqual(txCookie, state):
        clearOidcTransactionCookie()
        auditFailure(reason="invalid_state", noRawState=true)
        redirectLoginError("OIDC_LOGIN_INVALID")

    clearOidcTransactionCookie()
    if request.query.error present:
        auditFailure(reason="provider_error", noDescription=true)
        redirectLoginError("OIDC_LOGIN_FAILED")

    runtime = getStartupOidcRuntimeView()               // 启动期缓存；本请求不读盘
    if !runtime.enabled or runtime.profileDigest != tx.profileDigest:
        auditFailure(reason="profile_changed_or_invalid", noProfileBody=true)
        redirectLoginError("OIDC_LOGIN_INVALID")
    profile = runtime.profile

    tokenResponse = exchangeAuthorizationCode(
        code=request.query.code,
        verifier=tx.verifier,
        redirect_uri=profile.publicWebuiUrl + profile.redirectPath,
        clientAuthentication=profile.tokenEndpointAuth + runtime.clientSecret,
        followRedirects=false,
        boundedTimeout=true
    )
    if exchange failed or tokenResponse.id_token missing:
        auditFailure(reason="code_exchange_failed", noResponseBody=true)
        redirectLoginError("OIDC_PROVIDER_UNAVAILABLE")

    claims = verifyIdTokenUsingMaintainedOidcLibrary(
        id_token=tokenResponse.id_token,
        jwksUri=profile.jwksUri,
        expectedIssuer=profile.issuer,
        expectedAudience=profile.clientId,
        expectedNonce=tx.nonce,
        requireValidExpAndIat=true,
        rejectAlgNoneAndSymmetricAlg=true
    )
    if verification failed:
        auditFailure(reason="id_token_invalid", noTokenOrClaims=true)
        redirectLoginError("OIDC_LOGIN_INVALID")

    // access_token 不用于 Lucy 授权；refresh_token 即使出现也不保存。
    discard(tokenResponse.access_token, tokenResponse.refresh_token)

    config = freshReadAdminsYaml()
    binding = exactUniqueMatch(config.oidc_bindings,
                               issuer=claims.iss,
                               sub=claims.sub)
    if binding missing:
        auditFailure(reason="account_not_bound", subjectDigestOnly=true)
        redirectLoginError("OIDC_ACCOUNT_NOT_BOUND")   // 不自动建号、不按 email 找账户

    account = binding.account
    if !account.enabled or config invalid:
        auditFailure(reason="account_unavailable", targetId=safeAccountIdOrDigest)
        redirectLoginError("OIDC_ACCOUNT_UNAVAILABLE")

    if account.account_uid missing:
        account = ensureAccountUidViaExistingAuditedMigration(account.id)
        if migration failed or account disabled after fresh re-read:
            redirectLoginError("AUTH_STATE_UNAVAILABLE")

    session = issueExistingV2Session(account)           // 不携带任何 IdP token
    if session failed:
        redirectLoginError("AUTH_STATE_UNAVAILABLE")

    if !durableAuthEvent(kind="login_success", actor=account.id,
                         summary={method:"oidc"}):
        revokeUndeliveredSession(session)
        redirectLoginError("AUTH_STATE_UNAVAILABLE")

    setExistingLucySessionCookie(session)
    redirect303(tx.returnTo)
```

ID token 必须使用维护中的 OIDC／JOSE 库验证签名和 claims，禁止手写“解码 JWT 即通过”。至少校验 `iss`、`sub`、`aud`、`exp`、`iat`、`nonce`；多 audience 时按 OIDC 规范校验 `azp`。只允许实现显式支持并测试的非对称签名算法，默认 `RS256`；`none`、`HS*`、未知 `kid` 重取后仍不匹配、签名无效或 issuer 字符串不一致均拒绝。

### 6.3 每个受保护请求与 IdP 生命周期

```text
function authenticateExistingLucyRequest(request):
    session = authenticateExistingV2Cookie(request)   // fresh-read admins + security.sqlite
    if session invalid/revoked/expired/account disabled/epoch mismatch:
        deny existing response
    else:
        allow according to current local owner/operator role
    // 不调用 IdP，不使用 email/groups，不因为 OIDC 配置关闭而放宽或实时收窄。
```

| 事件 | 新 OIDC 登录 | 已发 Lucy 会话 |
|---|---|---|
| IdP 暂时不可达 | 失败；本地登录仍可用 | 按既有 Lucy 会话期限继续，不伪装成实时吊销 |
| IdP 账户被停用 | 由 IdP 拒绝，或回调后无有效新登录 | 本期不能实时感知；需要立即收窄时在 Lucy 禁用账户或移除绑定 |
| Lucy 账户被禁用／删除 | 拒绝 | 既有持久会话合同立即拒绝 |
| owner／operator 改变 | 下次登录读取新角色 | 既有 `session_epoch` 撤销后重新登录 |
| OIDC 绑定被移除／替换 | 旧绑定不再可登录 | 先撤销该 Lucy 账户会话，再保存配置 |
| OIDC provider 配置被关闭 | 不再提供 OIDC 入口 | 不自动全量吊销；使用账户级收窄或受控会话轮换 |
| Lucy 进程重启 | 未完成回调失效并可重试 | 已签发的持久 Lucy 会话按原合同继续 |

## 7. 退出、恢复与紧急收窄

### 7.1 本地退出

1. 先耐久吊销当前 Lucy `jti`，再清除 `lucy_admin_session`。
2. 清除任何遗留 OIDC 登录事务 Cookie。
3. 不发送 IdP 登出请求，不保存或读取 logout hint。
4. 返回登录页并提示身份源会话可能仍有效。

### 7.2 密码找回与 break-glass

- 仍有其他可登录 owner：可重置本地密码、维护 OIDC 绑定或创建替代账户。
- 无人可登录：继续使用系统手册的配置卷恢复和一次性 bootstrap；OIDC 配置不得绕过 bootstrap token。
- 首个 owner 和恢复后的首个 owner 都必须设置本地密码；之后再创建 OIDC-only 账户。
- break-glass 期间不得设置 `LUCY_WEBUI_AUTH=off` 作为恢复手段，不得恢复匿名管理面。
- 恢复旧配置或安全库快照时，继续执行既受控会话密钥／实例代次轮换，防止旧 Cookie 复活。

### 7.3 紧急收窄顺序

需要立即阻止某人继续使用 Lucy 时，owner 应禁用对应 Lucy 登录账户；仅到 IdP 停用账户不满足即时撤销要求。若所有 owner 凭据不可用，由部署人员走 break-glass。全量认证面事件使用受控会话轮换，并记录变更证据。

## 8. 审计、隐私与安全要求

### 8.1 审计事件

复用 `security_events`，并显式扩展既有 `AuthEventKind` 与 `SUMMARY_KEYS`；不得依赖实现者临时增加未登记字段。

| 场景 | 事件／摘要 |
|---|---|
| OIDC 登录成功 | `login_success`，`method=oidc`，actor 为本地账户 id |
| 本地登录成功 | `login_success`，`method=local`；S1 同步修改既有本地登录路径 |
| OIDC 登录失败 | `login_failure`，`method=oidc`，封闭 reason；有可靠本地绑定后才可记录 targetId |
| 绑定新增／替换／删除 | 新增 `oidc_binding_added`／`oidc_binding_replaced`／`oidc_binding_removed`＋既有配置审计；记录 targetId、bindingDigest、hasLocalPassword |
| 本地密码移除 | **新增 `password_removed`**；`password_rotated` 只用于实际密码轮换，二者不得混用 |
| 配置不可用 | `login_failure`，`method=oidc`、`reason=oidc_config_unavailable`；不记录 profile 原文 |

扩展后的 `SUMMARY_KEYS` 封闭为既有 `targetId`、`role`、`reason`、`attemptedIdDigest` 加下表五键；其他键一律不得写入。实现时应让未知键在开发测试中显式失败，避免静默丢失。

| 新键 | 允许值与长度 | 用途 |
|---|---|---|
| `method` | `local` 或 `oidc` | 区分认证路径；本地成功与失败事件同样补齐 |
| `bindingDigest` | `sha256(issuer + "\n" + sub)` 的前 32 个小写 hex 字符 | 绑定变更对账，不写原始绑定 |
| `hasLocalPassword` | 字符串 `true` 或 `false` | 区分密码移除与轮换后的凭据状态 |
| `issuerDigest` | `sha256(issuer)` 的前 32 个小写 hex 字符 | 登录失败对账 |
| `subjectDigest` | `sha256(sub)` 的前 32 个小写 hex 字符 | 登录失败对账；仅在 IdP token 已完成全部验证后记录 |

`login_failure.reason` 封闭为：`invalid_credentials`、`oidc_config_unavailable`、`invalid_state`、`profile_changed_or_invalid`、`provider_error`、`code_exchange_failed`、`id_token_invalid`、`account_not_bound`、`account_unavailable`。IdP 返回的任何 `error`／`error_description` 都只归一为 `provider_error`；其他未登记内部原因归一为 `provider_error` 并另发不含敏感值的开发诊断，不得把原始字符串写入账本。

审计与日志不得保存原始 sub、email、authorization code、state、nonce、PKCE verifier、access token、refresh token、ID token、client secret 或完整 IdP 响应。OIDC 临时事务不得进入普通资产导出、审计 CSV 或运维问数连接。

### 8.2 网络与解析安全

- token 与 JWKS 请求设置有界连接／总超时、响应大小上限和内容类型检查；默认不跟随跨 origin redirect。
- 不使用 HTTP 代理环境变量把凭据静默发往未配置代理；客户显式代理配置需要独立交付核验。
- token endpoint 认证严格按 `client_secret_post` 或 `client_secret_basic`，不得同时发送两份 secret。
- JWKS 缓存有界；未知 `kid` 可有界刷新一次，签名失败不能靠反复刷新变成成功。
- 所有认证响应 `no-store`；callback 使用 `Referrer-Policy: no-referrer`；临时 Cookie 与客户会话一样必须 `Secure; HttpOnly; SameSite=Lax`。
- IdP HTML、错误描述、claim、issuer 元数据均视为不可信输入，不进入 HTML 原文或 Markdown 渲染。

#### 8.2.1 限速桶与共享出口合同

复用 `clientSource()`、`hitBuckets()`、`replyAuthGate()`、安全库持久桶和既有 `AUTH_RATE_LIMITS.maxBuckets=10000`，在 `AUTH_RATE_LIMITS` 增加以下固定配置，不新增另一套存储：

| 桶 | 键与维度 | 阈值／固定窗口 | 适用 |
|---|---|---|---|
| `sourceTotal` | 既有可信 source | 既有 30 次／5 分钟 | start 与 callback 都命中，和其他认证入口共享总量 |
| `oidcStartSource` | `oidc-start:<source>` | 30 次／5 分钟 | 每次 start 在创建事务前命中 |
| `oidcCallbackSource` | `oidc-callback:<source>` | 30 次／5 分钟 | 每次 callback 命中，包括无效 state |
| `oidcTransaction` | `oidc-tx:<stateHash>` | 5 次／10 分钟 | **仅当 stateHash 已对应未过期真实事务时**命中；随机 state 不创建此桶 |

`gateOidcStartAttempt()` 命中前两类 source 桶；`gateOidcCallbackAttempt(request,stateHash)` 命中前两类 source 桶，并先只读查询真实事务后决定是否命中事务桶，随后由回调原子消费事务。桶有固定窗口、TTL 和共享数量上限；存储不可用返回 503，不绕过限速。

共享 NAT／代理出口只允许触发临时 429＋`Retry-After`，窗口到期自动恢复。OIDC 不建立 accountId 维桶，不因他人失败锁定某个 Lucy 账户，也不新增永久账户锁定。事务级限制只抑制并发或重复有效回调，不替代一次性 state。

### 8.3 依赖与离线边界

实现应使用维护中的 OIDC 客户端／JOSE 库，不在 Lucy 手写 JWT 签名验证。依赖必须进入 lockfile、SBOM／依赖扫描与 amd64 离线镜像；页面不加载外部脚本、字体或图片。运行镜像在无公网时可启动，本地登录与公开系统手册可用；OIDC 仅在客户浏览器和 Lucy 到其身份源的网络路径就绪时可用。

## 9. 用户可见错误与 API 拒绝码

| 场景 | 码 | 用户主文案 | HTTP／落点 |
|---|---|---|---|
| OIDC 未启用或本地配置不可用 | `OIDC_NOT_AVAILABLE` | 单点登录当前不可用，请使用本地账户登录或联系部署人员 | 503；不泄露配置细节 |
| state、nonce、PKCE、ID token 或重放校验失败 | `OIDC_LOGIN_INVALID` | 单点登录校验失败，请重新发起登录 | 回调返回登录页；不得自动重试循环 |
| IdP 拒绝或回调错误 | `OIDC_LOGIN_FAILED` | 身份源未完成登录，请重试或使用本地账户登录 | 回调返回登录页 |
| token／JWKS 网络故障 | `OIDC_PROVIDER_UNAVAILABLE` | 暂时无法连接身份源，请稍后重试或使用本地账户登录 | 回调返回登录页 |
| 外部身份未绑定 | `OIDC_ACCOUNT_NOT_BOUND` | 该身份尚未绑定 Lucy 登录账户，请联系所有者 | 回调返回登录页；不自动建号 |
| 本地账户禁用或状态无效 | `OIDC_ACCOUNT_UNAVAILABLE` | 绑定的登录账户当前不可用，请联系所有者 | 回调返回登录页 |
| 重复绑定 | `OIDC_BINDING_CONFLICT` | 该身份已绑定其他登录账户 | 409 |
| 绑定 issuer 与当前 profile 不符 | `OIDC_ISSUER_MISMATCH` | 身份绑定与当前单点登录配置不一致 | 400 |
| 会留下无凭据账户 | `AUTH_CREDENTIAL_REQUIRED` | 登录账户至少需要一种可用登录方式 | 400 |
| 会破坏本地恢复所有者 | `LOCAL_OWNER_REQUIRED` | 至少保留一名可使用本地密码登录的启用中所有者 | 400 |
| 安全状态或审计不可用 | `AUTH_STATE_UNAVAILABLE` | 认证状态暂不可用，请稍后重试或联系部署人员 | 503，不签发或交付新会话 |

错误文案不得出现“已自动注册”“邮箱即账户”“已同步退出身份源”“IdP 已实时吊销”等未实现承诺。

## 10. Helm、升级与回滚

### 10.1 Helm 接线

- `oidc.enabled=false` 为默认；未启用时 renders 不产生有效 OIDC 运行时配置，公开 methods 仅 local。
- 启用时 Chart 校验 HTTPS `webui.publicUrl`、静态端点、clientId、redirectPath、`security.access=https` 与 existingSecret 引用完整性。
- 非敏感 profile 由只读 ConfigMap 挂载；client secret 由独立只读 Secret 挂载。Pod env 只出现两个文件路径，不出现 `LUCY_OIDC_CLIENT_SECRET`。
- `extraEnvFrom` 不得覆盖 OIDC 文件路径、部署模式、Cookie 或公开 origin 的固定安全合同。
- Chart 版本与 Lucy 产品版本独立编号；镜像 digest、Chart 包和验收证据分别登记。
- probes 不访问 IdP；离线安装不拉取 discovery、JWKS 或前端资源。

### 10.2 升级与回滚

1. 升级前已有 `oidc_bindings` 仅作为预留数据继续保留；未显式启用 provider 时不能突然成为登录入口。
2. 无 OIDC 绑定的现有账户、密码、owner 职责和会话行为不变。
3. 本期登录事务为进程内临时状态，无数据库迁移；安全库 schema 版本不因本功能单独提升。
4. 回滚代码或设置 `oidc.enabled=false` 后，新 OIDC 登录关闭，本地登录继续；既有 Lucy 会话仍按既有合同处理。
5. 回滚不得删除绑定或本地密码，不得把 OIDC-only 账户误判为损坏配置；需要恢复访问时由 owner 添加本地密码或执行 break-glass。
6. 备份恢复必须同时考虑 `admins.yaml` 与安全库；不得通过恢复旧快照复活撤销的会话或 tombstone。

## 11. 验收矩阵

所有用例初始状态均为未执行。单元／协议测试、开发环境集成和 linux/amd64 K8s 证据分别记录；mock 不得冒充真实 IdP 交付验收。

| 编号 | 验收场景 | 通过标准 | 关联决议／流程 |
|---|---|---|---|
| OIDC-01 | 默认未配置 | methods 仅 local；现有本地登录、账户和 MCP 行为不变；无 IdP 网络请求 | D09／D10 |
| OIDC-02 | 有效配置公开状态 | methods 含 local 与 oidc；响应无 issuer、clientId、secret、email、sub | §5.2 |
| OIDC-03 | 首个所有者引导 | 即使 OIDC 已配置，bootstrap 仍要求一次性密钥和本地密码；OIDC 不能认领实例 | D04 |
| OIDC-04 | 授权跳转 | response_type=code、精确 redirect_uri、openid scope、state、nonce、PKCE S256 齐全；不使用 Host 推断 | §6.1 |
| OIDC-05 | state 缺失、Cookie 不符、过期、重放、配置摘要变化 | 全部失败关闭；一次性事务不可再次使用；无会话签发 | §6.1／§6.2 |
| OIDC-06 | code 交换与 PKCE | verifier 正确提交；错误 verifier、错误 redirect_uri、重复 code 均拒绝；secret 仅按一种配置方式发送 | §6.2 |
| OIDC-07 | ID token 签名与 claims | 非匹配 iss／aud／azp／nonce、过期、无效签名、none／HS*、未知 kid 均拒绝 | §6.2 |
| OIDC-08 | 已绑定 owner 登录 | 精确 `(issuer,sub)` 找到既有 `account_uid`；获得 owner 职责和既有 v2 会话 | D02／D06 |
| OIDC-09 | 已绑定 operator 登录 | 获得 operator 职责；不能管理登录账户或绑定；不获得额外 MCP 数据面权限 | D02 |
| OIDC-10 | 未绑定与同邮箱反例 | 未绑定 subject 拒绝；相同 email、preferred_username 或 displayName 不能匹配或自动建号 | D03／§3 |
| OIDC-11 | UID 迁移、禁用、删除、重建与角色变化 | 旧账户首次 OIDC 登录走既有审计 UID 迁移；禁用／删除拒绝；重建使用新 UID；角色变化撤销旧会话并按新角色重新登录 | §3／§6.2／§7 |
| OIDC-12 | 本地恢复所有者保护 | 删除最后本地密码 owner、解绑成无凭据、禁用／降级／删除均被 `LOCAL_OWNER_REQUIRED` 或凭据约束拒绝 | D05 |
| OIDC-13 | 绑定收窄顺序 | 移除／替换绑定先撤销会话再写配置；写失败不恢复旧会话；审计无原始敏感值 | §3.3 |
| OIDC-14 | IdP 不可用 | OIDC 新登录有界失败；本地 owner／operator 登录、bootstrap 与 break-glass 不受影响；无 open 回退 | D10 |
| OIDC-15 | 已发会话与 IdP 停用 | 明确验证本期无每请求 IdP 调用；Lucy 账户禁用立即拒绝，IdP 停用不被误报为实时撤销 | D08／§6.3 |
| OIDC-16 | 本地退出 | Lucy jti 先耐久吊销再清 Cookie；不调用 IdP；文案不声称全局退出 | D07 |
| OIDC-17 | returnTo 与缓存 | 外站、双斜杠、反斜杠、控制字符回退 `/overview`；登录后无前一账户受保护缓存 | §5 |
| OIDC-18 | secret 与日志扫描 | values、ConfigMap、env、日志、审计、导出、异常和证据包无 client secret／token／code／原始 sub | §4／§8 |
| OIDC-19 | 限速与故障存储 | 四类桶按 §8.2.1 命中；随机 state 不建事务桶；NAT 仅临时 429；安全库或认证账本失败不交付会话；不形成永久账户锁定 | §8.2.1 |
| OIDC-20 | 启动缓存、重启与临时事务 | 未认证 status 不读盘；文件变更重启后才生效；重启后旧 callback 失败并可重新登录；既有持久 Lucy 会话按原合同工作；无新增 schema 迁移 | D11／§4.3 |
| OIDC-21 | Helm 安全接线 | enabled=false 不接线；enabled=true 只挂载配置和 Secret 文件；HTTP publicUrl、缺 Secret、覆盖固定 env 均拒绝 | §10 |
| OIDC-22 | 离线与 probes | 无公网可启动和本地登录；无运行时外部前端资源；三类 probes 不访问 IdP | §8.3／§10 |
| OIDC-23 | 升级与回滚 | 旧账户和预留绑定保留；未启用不开放；关闭或回滚不删除凭据、不回退开放、不误称撤销全部会话 | §10.2 |
| OIDC-24 | linux/amd64 K8s 真实链路 | 同一候选 digest 完成 owner／operator、本地降级、撤销、重启和升级旅程；证据绑定镜像与配置摘要 | 全链路 |
| OIDC-25 | 目标身份源兼容验收 | 使用客户目标 issuer 的真实 client registration 验证授权、token、JWKS 与账户绑定；环境不足记 blocked，不以 mock 替代 | 交付验收 |
| OIDC-26 | 启动配置与 Secret 不可用 | 分别以 profile 无效、secret 缺失／不可读／为空启动：OIDC 缓存为不可用，methods 仅 local，本地登录继续；修复文件后重启恢复 OIDC；无敏感值泄露 | §4.2／§4.3 |

## 12. 实施拆分建议（不代表已授权）

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| S1 配置与账户模型 | 扩展既有 `parseOidcProfile`：scope 必含 openid、logout 两字段可选；启动期 profile／secret 缓存；methods 派生；绑定 API 与 issuer 精确校验；最后本地 owner 保护；扩展 `AuthEventKind`／`SUMMARY_KEYS`；本地登录补 `method=local`；新增 `password_removed` 与绑定事件 | OIDC-01／02／03／10／12／13／18／26 的单元与 API 用例；审计封闭清单无静默丢键 |
| S2 协议主链 | start／callback、短期事务、code＋PKCE、ID token 验证、绑定解析、既有会话签发；实现 §8.2.1 四类桶及具体 gate | OIDC-04～11／17／19／20 |
| S3 UI 与恢复体验 | 登录按钮、错误映射、绑定维护、退出说明、公开手册和术语防御 | OIDC-14～17 的交互断言；默认不额外做移动窄屏测试 |
| S4 客户交付 | Helm、Secret、离线依赖、升级回滚、amd64 K8s 与目标 IdP 验收 | OIDC-18／21～25；证据不足保持 blocked |

实施 Plan 必须进一步确定所选 OIDC 库及其许可证／维护状态、依赖版本、实际文件路径和测试 IdP 拓扑；不得把本设计基线写成已经生效的运行时合同。

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms（已于定稿时同步登记到术语标准 §4.11）:

| Canonical Term | UI 主术语 | 禁止文案／边界 |
|---|---|---|
| OIDC Single Sign-On | 单点登录 | 不写成“免密登录”“统一权限”；OIDC 只承担认证 |
| Identity Provider | 身份源 | 不写成“权限源”；owner／operator 仍由 Lucy 登录账户决定 |
| Local Login | 本地账户登录 | 不写成“管理员后门”；是正式保留的认证与恢复路径 |
| OIDC Identity Binding | OIDC 身份绑定 | 不写成“邮箱绑定”；唯一身份键是 `(issuer, sub)` |
| Login Method | 登录方式 | 不与 MCP Agent Token、角色或数据权限混用 |
| Identity Provider Logout | 身份源退出 | 本期不实现；不得把“退出 Lucy”写成“退出所有账户” |

既有术语继续使用「登录账户」「所有者」「运维」「配置审计」「操作者」。新 API 用户可见错误不得使用“超管”“用户组自动授权”“邮箱即账户”。OIDC、PKCE、URL、issuer、sub、账户 id、文件名和路径在 DOM 中必须添加 `translate="no"` 与 `notranslate`。

## 13. 评审检查点

以下七项已由 2026-10-25 需求审查认可，并经 Forrest 批准定稿：

- [x] 认可预先绑定、无 JIT、无邮箱匹配、无 IdP 角色映射的产品边界。
- [x] 认可至少一名本地密码 owner 的恢复约束，以及 OIDC 不参与 bootstrap。
- [x] 认可本期本地退出、不保存 IdP token、不做 IdP 实时吊销的明确边界。
- [x] 认可内存一次性登录事务与重启后重试，而非新增安全库 schema。
- [x] 认可静态端点为唯一配置事实源，`discoveryUrl` 本期保留但不参与裁决。
- [x] 认可默认关闭、本地登录始终保留、IdP 故障不回退开放模式。
- [x] 认可 OIDC-24／25 的真实环境与目标 IdP 证据要求，不以单元或 mock 结果替代。
