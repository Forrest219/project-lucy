# Token 续期 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.4 文档定稿** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P1**。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.4 文档定稿（2026-11-01）**：Codex 第 4 轮确认可定稿。实施仍须委托人明示开工。本条收口不表示可上线 |
| 决策来源 | 2026-11-01 产品批准显式续期（含过期后）、撤销不可续、创建／续期同档；Codex 第 1 轮审阅 |
| 需求来源 | 到期后避免强迫客户端换明文；管理员掌握续期／撤销主动权 |
| 实施主体 | Admin Token renew API、Tokens／Agent Token UI、审计 `token_renew`、术语标准、相关测试。默认 TTL 见 [`lucy-20261101-token-default-ttl-365-spec.md`](lucy-20261101-token-default-ttl-365-spec.md) |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | Spec 124 仍是吊销、Proxy `expires_at` 硬拒绝、明文一次性权威。本条新增续期，不削弱撤销。预设 UI 模式对齐 [`lucy-20261101-new-token-expiry-preset-ux-spec.md`](lucy-20261101-new-token-expiry-preset-ux-spec.md)。不改 Step6 |
| 实施计划 | [`docs/plans/lucy-20261101-token-renewal-plan.md`](../plans/lucy-20261101-token-renewal-plan.md) |
| 审阅 | [`docs/reviews/2026-11-01-codex-review-token-default-ttl-and-renewal.md`](../reviews/2026-11-01-codex-review-token-default-ttl-and-renewal.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：管理员可对仍受续期资格约束的 Token 显式续期——只更新 `expires_at`、不改 hash／明文；已过期可续；已撤销不可续；须审计且失败关闭。
- 本条出口：SC-01–SC-25。
- 不在本条出口：新建默认 TTL（另条）、浏览器、Docker、客户环境、静默自动续期、Step6。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| Token Renewal | 续期 | 延长有效期 | 重新签发、复活、自动续期、永不过期 | 只改 `expires_at`；明文与 hash 不变 |
| Token Rotation | 换签 | 轮换 | 续期（混称） | 新建 + 替换明文；泄露／交接时用 |

落地时写入术语标准后再跑 `lint:terminology`。

控件文案：续期／延长有效期／确认续期／已续期至 {date}／已撤销的 Token 不能续期。快捷预设与新建相同：30 天／90 天／180 天／1 年。

Forbidden: 续期返回明文；用删建同 label 冒充续期；把撤销写成可续。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/10-components-button.md`
- `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md` §5.2
- `webui/docs/design-system/30-pr-compliance-template.md`
- `docs/specs/lucy-20261101-new-token-expiry-preset-ux-spec.md`

### What This Change Follows

- [ ] 续期对话框预设用 `pl-segmented-control--cols-4`；选中 `--active`
- [ ] 对话框唯一实心 primary 为「确认续期」
- [ ] 成功不回显明文

### Exceptions (If Any)

- None.

### Follow-up Needed

- None.

---

## 1. 产品合同摘要

| 项 | 合同 |
|---|---|
| 续期 | 只写 `expires_at`；hash／label／device_name／created 不变；响应无 plaintext |
| 预设 | 与新建同一集合 `{30,90,180,365}`；打开对话框时默认 **365d**、日期 today+365 |
| 已过期 | 可续（YAML 行仍在且未撤销） |
| 已撤销 | 不可续；不得移出 `revoked_tokens` |
| 相对旧值 | 见 §3.2：禁止无意义「缩短式续期」 |
| 权限 | 继承创建：`delegated_from` 时须 owner |
| Gate | 与创建同矩阵；禁止实现私自降级 |

## 2. API

`POST /api/admin/agents/:userId/tokens/:label/renew`

Body: `{ expires_at, dryRun?, override? }`

成功：`{ ok, data: { written, label, old_expires_at, expires_at, runtimeAck, gate } }`——**无** `token` 字段。

错误码（Normative）：

| 条件 | HTTP | code |
|---|---|---|
| Agent 不存在 | 404 | `AGENT_NOT_FOUND` |
| YAML 无该 label | 404 | `TOKEN_NOT_FOUND` |
| hash 在 `revoked_tokens`（含 YAML 仍残留） | 409 | `TOKEN_REVOKED_NOT_RENEWABLE` |
| `expires_at` 校验失败 | 400 | 同创建（`EXPIRES_AT_*`） |
| 新到期日未严格晚于旧有效到期日 | 400 | `EXPIRES_AT_NOT_EXTENDED` |
| 委托 Agent 且非 owner | 403／既有 owner 拒绝形态 | 与创建一致 |
| Gate block | 409 | `GOVERNANCE_GATE_BLOCKED` |
| Gate override 缺失／无效 | 409 | `GOVERNANCE_GATE_OVERRIDE_REQUIRED` |
| 撤销表查询失败 | 5xx | 不得写入 |

`changeType` **唯一**为 `token_renew`。审计字段：可信 `actor`／`actorIp`（Spec 124 §5.4）、`source=admin_tokens_api`、`targetId=userId`、`oldSummary`／`newSummary` 含 label、hashPrefix、expires_at；禁止明文。配置审计中文标签／筛选／CSV 脱敏须识别该类型；Agent 详情「配置更新时间」SQL 白名单纳入 `token_renew`。

## 3. 核心流程（伪代码）

```text
PRESETS = [30, 90, 180, 365]   # == create UI

# MUST reuse Proxy-aligned helpers from identity.ts:
# - normalizeExpiresAtInput / normalizeNewTokenExpiry for inputs
# - effectiveOldExpiryMs(old) mirrors isTokenExpired parsing:
#     missing | null | "" | never/none/null/permanent → treat as ABSENT (no finite end)
#     YYYY-MM-DD → that UTC day 23:59:59.999Z
#     other ISO → Date.parse
#     unparseable finite field → EXPIRES_AT_INVALID (fail closed; do not renew)

normalizeTokenExpiry(raw, now) =
  same as create: required, > now, <= UTC(today)+365 EOD

assertStrictExtension(oldExpires, newExpiresIso, now):
  if oldExpires is ABSENT:          # omit / null / empty / permanent aliases
    return ok                       # first finite expiry; still pass normalizeTokenExpiry
  oldMs = effectiveOldExpiryMs(oldExpires)   # Proxy-aligned; NOT naive Date.parse on date-only
  newMs = Date.parse(newExpiresIso)
  if not finite(oldMs): fail EXPIRES_AT_INVALID
  if isTokenExpired(oldExpires, now):        # Proxy predicate
    return ok                       # expired → any valid future ok
  if newMs <= oldMs: fail EXPIRES_AT_NOT_EXTENDED
  return ok

# Repair mode: ONLY when disk already equals requested expiry AND the prior
# attempt did not finish with runtimeAck=true (ack/runtime repair), OR the
# client sets body.repair=true while disk already equals requested.
# Repair NEVER skips durable token_renew audit.
isAckRepair(token, newExpires, body) =
  diskEq = (normalizeDiskExpiry(token.expires_at) == normalizeTokenExpiry(newExpires))
  if not diskEq: return false
  return body.repair == true OR runtimeNotFullyAckedForCurrentPolicy()

renewToken(userId, label, expires_at_raw, actor, body):
  newExpires = normalizeTokenExpiry(expires_at_raw, now)

  withTokenWriteLock:
    user = load(userId) or fail AGENT_NOT_FOUND
    token = user.tokens.find(label) or fail TOKEN_NOT_FOUND

    revoked = queryRevokedTokens(token.hash)   # MUST; query error → abort, no write
    if revoked: fail TOKEN_REVOKED_NOT_RENEWABLE

    if user.delegated_from:
      requireOwner(actor) or fail                # same as create

    repair = isAckRepair(token, newExpires, body)
    if not repair:
      # Ordinary renew: equal or shorter relative to effective old → 400
      assertStrictExtension(token.expires_at, newExpires, now)

    calls7d = agentCallsLast7d(userId)
    gate = evaluateAccessGovernanceGate({
      targetKind: "token",
      targetId: `${userId}:${label}`,
      newValue: { userId, label, hashPrefix: prefix(token.hash) },
      highTrafficCalls7d: calls7d
    })
    # Frozen production matrix (create-aligned; NO implementer downgrade):
    # - high-traffic → P1 → decision "warn" (no override required)
    # Routes MUST still implement block / override_required branches.
    # Acceptance: real high-traffic → warn; PLUS injected gate decisions
    # for block / override_required (missing+valid). Cannot skip injected SCs.

    if body.dryRun:
      return { dryRun: true, gate, proposed: { label, expires_at: newExpires,
               old_expires_at: token.expires_at, repair } }

    if gate.decision == "block": writeGateTrace; fail GOVERNANCE_GATE_BLOCKED
    if gate.decision == "override_required":
      override = evaluateGovernanceOverride(...)
      if not override.ok: writeGateTrace; fail OVERRIDE_REQUIRED
      writeGateTrace(gate, override, ...)
    else:
      writeGateTrace(gate, ...)

    old = token.expires_at
    if not repair:
      token.expires_at = newExpires
    content = stringify(config)

    # Success criterion: runtimeAck === true AND durable token_renew audit committed.
    # auditedWriteFile MUST run on BOTH ordinary and repair paths.
    # repair newSummary includes repair:true; expires may equal old.

    try:
      runtime = withDisplayWriteBarrier(["P"], () => {
        auditedWriteFile(..., changeType="token_renew",
          ...trustedActorFromRequest(request),
          oldSummary={ label, hashPrefix, expires_at: old },
          newSummary={ label, hashPrefix, expires_at: newExpires, repair })
        # If helper supports explicit rollback on terminal audit failure, enable it
        # for renew so YAML does not diverge from durable audit. If rollback is
        # unavailable and terminal audit fails after YAML write: HTTP error with
        # runtimeAck:false; subsequent repair MUST still call auditedWriteFile
        # successfully before ack — never ack-only without durable renew audit.
        invalidateAccessConfigCache()
        return commitPolicyRuntimeAck(content)
      })
    catch err:
      HTTP 5xx; UI no success Toast.
      # If YAML already shows newExpires: body includes expires_at + runtimeAck:false
      # + repairSuggested:true (same expires_at, preferably body.repair=true).
      fail

    if runtime.runtimeAck != true:
      HTTP error with { expires_at, runtimeAck: false, repairSuggested: true }
      UI: no success Toast
      fail

    return { written: true, label, old_expires_at: old, expires_at: newExpires,
             repair, runtimeAck: true, policyRuntimeAck: true, ...runtime, gate }
```

### 3.1 失败关闭与恢复（R4）

| 失败点 | YAML `expires_at` | 耐久 `token_renew` 审计 | `runtimeAck` | HTTP / UI |
|---|---|---|---|---|
| 撤销表查询失败 | 不变 | 无 | 未调用 | 5xx |
| Gate block／缺 override | 不变 | 无成功 renew | 未调用 | 409 |
| `auditedWriteFile` 抛错（未完成落盘） | 不变 | 失败态／无成功行 | 未成功 | 5xx |
| YAML 已新值，但终态审计失败（无成功 renew 行） | 已是新值 | **无成功行** | false／未成功 | 非成功；`repairSuggested`；下一次 repair **必须先补齐成功审计再 ack** |
| 审计已成功，ack false／抛错 | 已是新值 | 已有成功行 | false | 非成功；repair 仍须再写一条 renew（`repair:true`）或确认已有成功行后只 ack——**本条定稿要求：repair 每次成功路径都再写 `token_renew`（repair:true），避免“无审计成功”** |
| dryRun | 不变 | 无 | 未调用 | 200 + dryRun |
| 成功（含 repair） | 目标值 | **必有**成功 `token_renew` | **true** | 200 |

禁止 ack-only 成功。禁止把 `written: true` 单独当生效成功。

局部故障注入：终态审计失败后 repair；ack 失败后 repair；repair 若跳过审计则测试必须失败。

## 4. UI

1. Tokens 清单与 Agent Token Tab：可续期行（YAML 存在且非撤销）显示「续期」。
2. 打开对话框：**日期 = today+365，仅 365d `--active`**（打开时断言，非确认后）。
3. 确认后续期列表刷新；过期行在 Agent 启用下变为 available。
4. 「30 天内到期」帮助须含「续期」或「续期或换签」，不得只催换签。

## 5. 验收（SC）

| ID | 断言 |
|---|---|
| SC-01 | 续期成功：hash／label／device_name／created 不变；仅 `expires_at` 变；响应无 plaintext；`runtimeAck===true` |
| SC-02 | 已过期 YAML 行续期成功后，启用 Agent 下 status=`available`；身份校验在新到期前不因该 token 报 `token_expired` |
| SC-03 | 正常撤销后同 label 续期 → 404 或等价；`revoked_tokens` 仍保留 hash |
| SC-04 | **半失败夹具**：`revoked_tokens` 有 hash 且 YAML 仍残留同行 → 409 `TOKEN_REVOKED_NOT_RENEWABLE`，YAML expires_at 不变 |
| SC-05 | 撤销表查询抛错 → 不写 YAML、无 `token_renew` 审计成功行 |
| SC-06 | `delegated_from` Agent：operator 续期被拒且不落盘；owner 可续（与创建对齐） |
| SC-07 | 无委托 Agent：既有 Admin 角色可续（回归） |
| SC-08 | dryRun=true：不改 YAML、无 `token_renew` 成功审计；返回 gate／proposed |
| SC-09 | **真实**高流量：decision=`warn`，可成功写入；不得跳过 gate |
| SC-10 | **注入** `gate.decision=block`：409、YAML 不变 |
| SC-11 | **注入** `override_required`：缺／无效 override → 409、不写；合法 override → 放行并留 trace |
| SC-12 | 审计 `changeType=token_renew`；含可信 actor、actorIp、targetId、label、hashPrefix、新旧 expires_at；无明文 |
| SC-13 | 配置审计 UI 可筛选／展示「续期」中文；CSV 脱敏；Agent 配置更新时间计入 `token_renew` |
| SC-14 | **普通续期**（非 repair）：旧值仍有效时，新值有效末 ≤ 旧值有效末 → 400 `EXPIRES_AT_NOT_EXTENDED`；严格更大且 ≤ max → 成功。磁盘已相等但未声明／未具备 repair 资格时亦 400（禁止无审计无 ack 的空转成功） |
| SC-15 | 旧值为 date-only `YYYY-MM-DD`：比较使用 UTC 日终，与 Proxy 一致（不得按日初误判已过期而缩短） |
| SC-16 | 旧值已过期（Proxy 谓词）：任意合法未来到期日可续（仍受 max） |
| SC-17 | 旧值缺省／null／empty／permanent 别名：可写入合法未来到期日（首次设到期） |
| SC-18 | 打开续期对话框：日期 today+365，仅 365d active；自定义非预设日时四档均无 active |
| SC-19 | 确认续期后列表更新；Toast 无明文 |
| SC-20 | 「30 天内到期」文案含续期（或续期或换签） |
| SC-21 | `runtimeAck=false` 或 ack 抛错：HTTP 非成功；body 含磁盘 `expires_at` 与 `runtimeAck:false`；无成功 Toast |
| SC-22 | ack／runtime 失败后，以相同 `expires_at` 走 repair：不得因「未严格延长」被拒；成功时 `runtimeAck===true` **且** 存在耐久 `token_renew`（含 `repair:true`） |
| SC-23 | `auditedWriteFile` 抛错（未完成落盘）：不报告续期成功；YAML 保持原到期日 |
| SC-24 | **终态审计失败夹具**：YAML 已是新值但无成功 renew 审计 → HTTP 非成功；随后 repair 若在无成功审计时仅 ack，测试必须失败；repair 补齐审计后可成功 |
| SC-25 | 术语标准已登记 Renewal／Rotation；四门禁有记录 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| 续期被当成轮换 | 术语＋手册保留泄露→撤销+换签 |
| 半失败撤销被续活 | SC-04／SC-05 |
| operator 绕过委托边界 | SC-06 |
| 失败仍 Toast 成功 | SC-21–SC-23 |
| date-only 误缩短 | SC-15 |

## 7. 落盘清单自检

见 DEVELOPMENT 唯一清单 1–11；门禁四命令见 SC-R22（关闭 R9）。
