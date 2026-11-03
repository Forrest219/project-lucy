# Admin API Agent 可发现性与开通人体工程学 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.4** |
| 日期 / 目标版本 | 2026-11-03 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P0**（可发现性）＋ **P1**（开通 REST 人体工程学）。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.4 已实施（2026-11-03）**。SC-01–SC-20 自动化已落，尚无逐条收口记录。本条收口不表示可上线 |
| 决策来源 | 2026-11-03 运维反馈；分支 `lucy-v0.25` 对齐；Codex 第 1–2 轮审阅 |
| 需求来源 | 运维 Agent 反解 WebUI JS 才还原 Admin API 契约，耗时主要在不可发现而非治理内核不足 |
| 实施主体 | WebUI Admin Fastify：OpenAPI、路由诊断序、错误信封、Agent 写响应 `after`、Token 签发入参；配套测试与索引 |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | **不削弱** L25-16 D1 方案 C。**不替代** `lucy_ops_token_issue`／`lucy_ops_agent_apply`。本条**显式修订** Token 签发 REST（相对 [`lucy-20261101-new-token-expiry-preset-ux-spec.md`](lucy-20261101-new-token-expiry-preset-ux-spec.md)「不改签发 API」）：以本条为准增加 `expires_in`／可选 `clientConfigs`；**不统一修改**各写操作既有 dryRun 默认值 |
| 实施计划 | [`docs/plans/lucy-20261103-admin-api-agent-discoverability-plan.md`](../plans/lucy-20261103-admin-api-agent-discoverability-plan.md) |
| 审阅 | [`docs/reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md`](../reviews/2026-11-03-codex-review-admin-api-agent-discoverability.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：自动化调用方无需反解前端 bundle，即可从运行中实例取得 Admin 开通域机器可读契约，并完成单 Agent 的登录会话建立、Token 签发／撤销与角色 PATCH；能区分未登录、路径不存在与方法不允许；Agent 确认写入响应含可续写的 `after`。
- 本条出口：SC-01–SC-20。
- 不在本条出口：浏览器 E2E、Docker 重建、客户环境、MCP 控制面新工具、Admin Bearer Token、Agent 列表分页、gate finding 影响面、`/api/health` hint／runbook、批量 `agents/batch` REST、Role 写响应改形、Token／DELETE 的 `after` 字段。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| Admin OpenAPI Document | Admin OpenAPI 文档 | OpenAPI 清单 | Swagger UI（本条不要求）、管理员手册（作本端点名） | `GET /api/openapi.json` |
| Allowed Methods | 允许的方法 | Allow 列表 | 可用动词（用户可见主术语） | HTTP `Allow` 与 `error.detail.allowedMethods` |
| After State | 写入后终态 | after | 预览态冒充终态；用 policyVersion 冒充并发 version | 仅 Agent POST／PATCH 确认写入 |
| Client Config Fragment | 客户端配置片段 | MCP 配置片段 | 永久密钥、明文落盘 | 仅签发 HTTP 响应；不写 YAML |
| Access File Version | 访问配置并发版本 | `after.version`、GET `data.version` | policyVersion（作并发版本） | `mtime-文件哈希` 形；供下一次 PATCH |

Forbidden: Admin API Token／scoped admin bearer；隐藏 OpenAPI；错误体返回完整 Token 明文；把 `policyVersion` 当作 PATCH 并发 `version`。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 本条**无 WebUI 页面改动**
- [x] API／错误码用户可见文案遵守术语标准

### Exceptions (If Any)

- None. API-only.

### Follow-up Needed

- None for UI. MCP 开通工具另开／修订 L25-16 后续期。

---

## 1. 产品合同摘要

| 决策 | 合同 |
|---|---|
| D1 身份平面 | **禁止**管理员 Bearer／scoped Admin API Token。Admin 仅 `lucy_admin_session` Cookie |
| D2 OpenAPI | `GET /api/openapi.json` **公开可读**，无密钥。按 **method＋path** **逐项**枚举（**禁止**通配、**禁止**虚构未注册 method）：auth＝`POST /api/auth/login`（必填 `adminId`／`password`；成功 `Set-Cookie: lucy_admin_session` 与 Cookie security 说明）、`GET /api/auth/status`、`GET /api/auth/me`、`POST /api/auth/logout`、`POST /api/auth/bootstrap`、`POST /api/auth/oidc/start`、`GET /api/auth/oidc/callback`；admin＝`GET/POST /api/admin/agents`；`GET/PATCH/DELETE /api/admin/agents/{userId}`；`POST /api/admin/agents/{userId}/tokens`；`DELETE /api/admin/agents/{userId}/tokens/{label}`；`POST /api/admin/agents/{userId}/tokens/{label}/renew`；`GET /api/admin/tokens`；`GET/POST /api/admin/roles`；`GET/PATCH/DELETE /api/admin/roles/{roleId}`。每项声明：参数位置、必填字段、body 结构、成功／错误信封、鉴权（公开／会话／owner）、gate／override（若适用）。**dryRun 按 operation 分别声明，本条不统一改默认值**：Agent／Role 支持预览的写＝省略即预览（`dryRun !== false`）；Token 签发与续期＝仅 `dryRun === true` 预览，**省略即真实写入**；Token DELETE 等无 dryRun＝直接执行。`info.version` 与运行中 Lucy 产品版本一致或可追溯 |
| D3 路由诊断序 | 对以 `/api/` 开头的请求：在既有 **CSRF／入口安全拒绝之后**、**会话鉴权拒绝之前**，用**当前 Fastify 路由器语义**判定匹配（动态参数、查询串剥离、自动 HEAD；**禁止**解析 `printRoutes()` 或第二份清单）。无匹配 → `404 NOT_FOUND`；path 有方法但本 method 不在 → `405`＋`Allow`＝`detail.allowedMethods`。method＋path 匹配后：公开判定**复用**现行 `isPublicApi(method, url)`，并**仅新增**精确 `GET /api/openapi.json`（不得把整个 `/api/auth/*` 公开）；公开 → handler；否则既有会话鉴权（open／bootstrap／required／unavailable 与 `AUTH_*`／`503` 不变）。**未登录＋错误方法**→405；**未登录＋未知路径**→404。跨站写方法等仍可先被 CSRF 以 `403 CSRF_ORIGIN_DENIED` 拒绝（优先于 D3 的 404／405） |
| D4 错误自解释 | `TOKEN_LABEL_TAKEN`：`detail.existingToken` 含与 `GET /api/admin/tokens` 行投影同构的非敏感字段（至少 `label`、`created`、expires 相关字段、`status`；有则含 `tokenHint`／`hashPrefix`）；**无明文**。创建 Agent 缺 `agent.id`／`agent.name`：`detail.expected`＋`detail.example`（嵌套 `agent`） |
| D5 after 适用范围 | **仅** Agent `POST`／`PATCH` 确认写入成功时新增 `after`。`after.agent` 与 `after.version` **必须绑定本次 committed 配置快照**：在本次提交的**写入协调边界释放前**，按与 GET **相同算法**取得**实际落盘**并发版本并与本次写入的 agent 投影一并保存；**禁止**在协调窗口释放后任意重读「最新文件」再拼本地 agent（以免串入他笔写入的 version）。`after.version` 可直接用于下一次 PATCH 的 `version`。`policyVersion` **保留独立字段，禁止**替代 `after.version`。预览**不得**含 `after`。Token 签发不新增 `after`。Role／DELETE **不在本条**改响应形。本约束针对现行支持的**单进程**并发 |
| D6 TTL 与配置片段 | 每请求捕获 `t0`。至少 `expires_at` 或 `expires_in` 之一；皆缺 → `EXPIRES_AT_REQUIRED`。`expires_in` 仅 `"30d"`｜`"90d"`｜`"180d"`｜`"365d"`；非法 → `EXPIRES_IN_INVALID`。`Nd`＝`presetExpiryDateString(N, t0)`＋`normalizeNewTokenExpiry`。双传：规范化后等值接受，否则 `EXPIRES_CONFLICT`。`includeClientConfigs: true` 时调用 `resolveMcpEndpoint()`：**仅**当 `status === 'configured'` 且 `url` 非空才继续签发；`fallback` 与 `invalid` → **生成明文／持久化之前** `503 MCP_ENDPOINT_UNAVAILABLE`。`MCP_PATH_RECOMMENDED` **保持非阻断诊断**（仍可 `configured`）。本校验只证明配置有效，**不承诺**网络可达。通过后返回四键 `clientConfigs`，规则与 NewToken／`mcpEndpoint.ts` 同源。缺省／`false` 不返回该键。**Token 预览与真实签发共用固定 `t0` 的 `resolve_expiry`**（在 dryRun 分支前完成 TTL 解析与校验；预览 `proposed.expires_at` 用其结果）。**Token `dryRun === true`**：返回现行预览结构，**在生成明文与持久化之前退出**，不返回 `token`／`clientConfigs`；endpoint 可用性检查**仅**非预览分支执行 |
| D7 范围边界 | 不实现 `lucy_ops_*` 新工具／`lucy_admin_*`／batch members／分页／gate finding／health 改形 |

## 2. 核心流程（伪代码）

```text
on GET /api/openapi.json:  # public via isPublicApi + exact path
  return 200 buildAdminOpenApiDocument(operations = D2_enumerated)

# D3 — after CSRF/entry security, before session deny
diagnose_api(req):
  match = fastify_router_lookup(req.method, req.url)  # real router; strip query; HEAD auto
  if match.none:
    return 404 { ok:false, error:{ code:"NOT_FOUND", detail:{ allowedMethods:[] } } }
  if match.method_not_allowed:
    return 405 Allow=match.allowed
           { ok:false, error:{ code:"METHOD_NOT_ALLOWED", detail:{ allowedMethods: match.allowed } } }
  if isPublicApi(match.method, match.url) or (GET and path == "/api/openapi.json"):
    return continue_handler
  return existing_session_guard(req)

# D4
on token_label_taken(existing):
  return 409 { error:{ code:"TOKEN_LABEL_TAKEN", detail:{ existingToken: list_row_projection(existing) } } }

on create_agent_missing_id_or_name:
  return 400 { error:{ code: existing_or_BAD_REQUEST, detail:{ expected: SCHEMA, example: MIN_BODY } } }

# D5 — Agent POST/PATCH only
on agent_write(body):
  dryRun = body.dryRun !== false
  ... validate / gate ...
  if dryRun: return { ok:true, data:{ diff, gate, ... } }  # no after
  within_write_coordination_window:
    result = write_access_yaml(...)
    if not committed: return existing failure envelope
    fileVersion = compute_version(same_algorithm_as_GET, bytes_just_committed)
    agentProj = project(committed_agent)
    # capture after snapshot BEFORE releasing coordination window
  return { ok:true, data:{
    written:true, gate, policyVersion: result.policyVersion, runtimeAck: result.runtimeAck,
    after: { agent: agentProj, version: fileVersion },
    agent: agentProj
  } }

# D6 — Token issue
on POST tokens(body):
  t0 = now()
  ... existing param / owner / gate checks ...
  expiresIso = resolve_expiry(body.expires_at, body.expires_in, t0)  # shared by preview & commit
  if body.dryRun === true:
    return existing_preview_envelope(proposed.expires_at = expiresIso)
    # no plaintext, no persist, no clientConfigs; no endpoint gate on preview
  if body.includeClientConfigs == true:
    ep = resolveMcpEndpoint()
    if ep.status != "configured" or not ep.url:
      return 503 MCP_ENDPOINT_UNAVAILABLE  # before mint/persist
  plain, meta = mint_and_persist(...)
  data = { token: plain, ...meta, expires_at: expiresIso }
  if body.includeClientConfigs == true:
    data.clientConfigs = fragments(ep.url, plain)
  return { ok:true, data }
```

## 3. API 合同要点

### 3.1 OpenAPI

- 公开；OpenAPI 3.0 或 3.1 JSON。
- 不要求 Swagger UI。
- SC 必须能解析出 D2 枚举的 method＋path，并核对登录、签发、撤销、角色 PATCH 的必填与 dryRun 默认声明。

### 3.2 错误码（增量）

| code | HTTP | detail |
|---|---|---|
| `METHOD_NOT_ALLOWED` | 405 | `allowedMethods`；头 `Allow` 同值 |
| `NOT_FOUND` | 404 | 可选空 `allowedMethods` |
| `TOKEN_LABEL_TAKEN` | 409 | `existingToken` |
| `EXPIRES_CONFLICT` | 400 | 双字段规范化后不等 |
| `EXPIRES_IN_INVALID` | 400 | 非法字面量 |
| `MCP_ENDPOINT_UNAVAILABLE` | 503 | `includeClientConfigs:true` 且 endpoint 不可用 |

### 3.3 兼容

- 保留 Agent 确认写入既有 `agent`／`policyVersion`／`runtimeAck`。
- 未传 `expires_in`／`includeClientConfigs` 时与改前行为一致（仍可用单独 `expires_at`）。

## 4. 验收标准

| ID | 标准 | 证据 |
|---|---|---|
| SC-01 | 未登录 `GET /api/openapi.json` → 200；可解析 OpenAPI；D2 **所列** method＋path **全部出现且无虚构**（含仅 `POST` login，无 `GET` login）；与运行中注册路由对照 | 服务端测试 |
| SC-02 | 分别核对 OpenAPI 中登录、签发、撤销、角色 PATCH：参数位置、必填、body、成功／错误信封、Cookie security（登录）、owner／gate／override（适用处）、各 operation dryRun 语义（Agent 省略＝预览；Token 签发／续期省略＝写入；DELETE 无 dryRun） | 服务端测试 |
| SC-03 | **required 模式、无会话、无 CSRF 拒绝**：未登录 `GET /api/admin/agents` → 401 现行 `AUTH_*`，非 404 | 服务端测试 |
| SC-04 | **required 模式、无 CSRF 拒绝**：未登录与已登录对已注册 path 错误 method → 405；覆盖动态 path 与 HEAD；另测跨站错误方法／未知路径仍优先 `403 CSRF_ORIGIN_DENIED` | 服务端测试 |
| SC-05 | **required＋有效会话、无 CSRF 拒绝**：未知 `/api/admin/no-such-route-xyz` → 404 | 服务端测试 |
| SC-06 | **required＋无会话、无 CSRF 拒绝**：同一未知路径 → 404，不得 401；另锁：`isPublicApi` 行为＋仅新增 `GET /api/openapi.json`；公开 login／受保护 me／查询串／HEAD；open／bootstrap／required／unavailable 既有行为不被削弱 | 服务端测试 |
| SC-07 | 重复 label → 409，`detail.existingToken` 非敏感且无明文 | 服务端测试 |
| SC-08 | 创建 Agent 缺 id／name → 400，`detail.expected` 与 `example`（嵌套 `agent`） | 服务端测试 |
| SC-09 | Agent POST 与 PATCH：省略／`dryRun:true` → 预览无 `after`；含 `gate` | 服务端测试 |
| SC-10 | Agent PATCH `dryRun:false` 成功 → 有 `after.agent`／`after.version`；`after.version` 不得用 `policyVersion` 冒充。夹具 A：无交错时连续两次 PATCH，第二次用第一次 `after.version` 通过。夹具 B（单进程）：A 提交成功捕获后、响应返回前插入 B 写入；A 的 `after.version` **不得**等于 B 提交后的最新 version；其后用 A 的 version PATCH 应 `VERSION_CONFLICT` | 服务端测试 |
| SC-11 | 固定 `t0`：仅 `expires_in:"365d"` → 成功，`expires_at` 等于 `normalizeNewTokenExpiry(presetExpiryDateString(365,t0), t0)` | 服务端测试 |
| SC-12 | 固定 `t0`：双传规范化后等值 → 成功；不等值 → `EXPIRES_CONFLICT` | 服务端测试 |
| SC-13 | `expires_in:"7d"` → `EXPIRES_IN_INVALID` | 服务端测试 |
| SC-14 | `resolveMcpEndpoint`：`configured`＋非空 url 且 `includeClientConfigs:true` → 四键可解析；YAML 无明文。`fallback`、无效 URL、非 HTTP(S) → 503 且无 Token／无 clientConfigs。仅 `MCP_PATH_RECOMMENDED` 的 configured → 仍可签发 | 服务端测试 |
| SC-15 | 不传 `includeClientConfigs` → 响应无该键 | 服务端测试 |
| SC-16 | Agent POST `dryRun:false` 成功亦含 `after`；写入失败不得返回成功终态 `after` | 服务端测试 |
| SC-17 | OpenAPI 声明委托 Agent 签发 owner 门禁；夹具锁定非 owner 对被委托 Agent 签发仍被拒 | 服务端测试或既有用例挂钩 |
| SC-18 | Spec／Plan／两索引状态段与 Spec 头部状态行**逐字**一致；`lint:spec-docs` 对本条无新增阻塞 | 门禁＋人工镜像核对 |
| SC-19 | Token 签发 `dryRun:true`（含同时 `includeClientConfigs:true`）→ 预览成功、`proposed.expires_at` 来自与真实签发共用的 `resolve_expiry`（覆盖仅 `expires_in`、非法值、双字段冲突）、无明文 `token`、无 `clientConfigs`、无库存新增；endpoint 503 仅非预览 | 服务端测试 |
| SC-20 | Token 续期 OpenAPI／行为：省略 dryRun＝真实续期；`dryRun:true`＝预览不改 `expires_at`（与现行一致，本条不改默认） | 服务端测试 |

## 5. 非目标

- 不引入 Admin Bearer；不新增 `lucy_admin_*`／本条实现 `lucy_ops_token_issue`／`lucy_ops_agent_apply`。
- 不实现 REST batch members、分页、gate finding 扩展、health hint。
- 不要求 Swagger UI；不要求全站 `/api/*` 进入 OpenAPI（下限＝D2 枚举）。
- 不统一修改 Token／Agent 既有 dryRun 默认语义。
- 不授权 commit／客户镜像／`--fresh`／浏览器 E2E（除非另授）。

## 6. 后续衔接（不在本条出口）

提升 L25-16 后续期 `lucy_ops_token_issue`（含 revoke）／`lucy_ops_agent_apply` 时另开或修订该 Spec：复用本条 REST 契约与错误形状，走 `allow.ops`＋委托＋confirm 门禁，**不得**借本条开管理员 Token 平面。

## 7. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 公开 OpenAPI 暴露管理面地图 | 无密钥；写仍需会话 |
| D3 改「未登录未知路径→401」 | 有意修复；SC-06 |
| `after.version` 实现漏读盘 | SC-10 连续 PATCH |
| `clientConfigs` 与无效 endpoint | 先校验后签发；SC-14 |
| 范围胀到 MCP ops | D7；审阅打回 |

## 8. 审阅回应

### 第 1 轮

| ID | 处置 |
|---|---|
| R1 | D2／SC-02：按 operation 声明 dryRun |
| R2 | D5／SC-10：并发版本；禁 policyVersion 替代 |
| R3 | D3：CSRF 后、会话前；Fastify 路由器 |
| R4 | D2 枚举；登录字段／Cookie |
| R5 | 先校验 endpoint |
| R6–R8 | after 范围；TTL；状态镜像 |

### 第 2 轮

| ID | 处置 |
|---|---|
| R1-残留 | Token 伪代码＋SC-19：`dryRun:true` 预览退出 |
| R2-残留 | D5／SC-10 夹具 B：协调窗口内绑定快照 |
| R3-残留 | D3／SC-03–06：required 夹具；CSRF 优先；`isPublicApi`＋精确 openapi |
| R4-残留 | 去掉虚构 GET login；SC-01／02 完整契约 |
| R5-残留 | `resolveMcpEndpoint`；仅 `configured`；SC-14 |

### 第 3 轮

| ID | 处置 |
|---|---|
| N1 | Token 预览与签发共用 `t0`＋`resolve_expiry`；SC-19 覆盖仅 `expires_in`／非法／冲突；endpoint 门仅非预览 |
