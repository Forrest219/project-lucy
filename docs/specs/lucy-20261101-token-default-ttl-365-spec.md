# Token 新建默认有效期 365 天 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.3 待 Codex 确认定稿（N1 已改）** |
| 日期 / 目标版本 | 2026-11-01 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P1**。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.3 文档定稿（2026-11-01）**：Codex 第 2／3 轮确认可定稿；N1 编号与残留 `SC-D` 标题已清理。实施仍须委托人明示开工。本条收口不表示可上线 |
| 决策来源 | 2026-11-01 产品批准默认 TTL 改为 365；Codex 第 1 轮要求与续期分拆闭口 |
| 需求来源 | Admin 新签发默认寿命对齐一年运维节奏；上限仍 365 |
| 实施主体 | `webui/server/admin/token-expiry-policy.ts`、`NewToken.tsx`、相关测试；手册／Spec 124 §7／既有 UX Spec 注记。不改 KTX；不改续期 API（见续期 Spec） |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | **覆盖** Spec 124 §7「New Token 默认 90 天」与 [`lucy-20261101-new-token-expiry-preset-ux-spec.md`](lucy-20261101-new-token-expiry-preset-ux-spec.md) 中「默认 today+90／初载 90d active」条款；该 UX Spec 的 segmented 呈现与「不得恢复政策提示句」仍有效。续期能力见 [`lucy-20261101-token-renewal-spec.md`](lucy-20261101-token-renewal-spec.md)。不改 Onboarding Step6 短窗默认 |
| 实施计划 | [`docs/plans/lucy-20261101-token-default-ttl-365-plan.md`](../plans/lucy-20261101-token-default-ttl-365-plan.md) |
| 审阅 | [`docs/reviews/2026-11-01-codex-review-token-default-ttl-and-renewal.md`](../reviews/2026-11-01-codex-review-token-default-ttl-and-renewal.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：Admin 新签发 Token 的默认有效期为 365 天，最长仍为距今天 365 天；新建页初载选中「1 年」档，且不恢复已删除的政策提示句。
- 本条出口：SC-01–SC-08。
- 不在本条出口：续期 API／UI、浏览器、Docker、客户环境、Step6 短窗、自动续期。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

- None. 沿用 Token Expiry／过期时间。续期／换签术语由续期 Spec 登记。

Forbidden:

- 恢复「默认有效期为 90 天」可见政策句。
- 新增「永不过期」。

## Design System Compliance

### Referenced Specs

- `docs/specs/lucy-20261101-new-token-expiry-preset-ux-spec.md`
- `webui/docs/design-system/30-pr-compliance-template.md`
- `webui/docs/101-button-hierarchy-selection-and-icon-affordance-spec.md` §5.2

### What This Change Follows

- [ ] 四档仍为 `pl-segmented-control--cols-4`；选中 `--active`，不用 primary
- [ ] 仅改变默认选中档与初始日期；不改控件族

### Exceptions (If Any)

- None.

### Follow-up Needed

- 落地时在 UX Spec 文首加「默认天数由本 Spec 覆盖」注记，并改 `docs/README.md` 该条索引措辞。

---

## 1. 目标与非目标

**目标：** `NEW_TOKEN_DEFAULT_TTL_DAYS = 365`；`NEW_TOKEN_MAX_TTL_DAYS = 365` 不变；预设集合仍 `{30,90,180,365}`；新建页初载 `365d` active；手册／Spec 124 §7 现行叙述改为默认 365。

**非目标：** 续期、撤销语义、Proxy 硬拒绝、Step6 默认、永不过期。

## 2. 核心流程（伪代码）

```text
NEW_TOKEN_DEFAULT_TTL_DAYS = 365
NEW_TOKEN_MAX_TTL_DAYS = 365
PRESETS = [30, 90, 180, 365]

onMount NewToken:
  expiresAt := dateString(today + NEW_TOKEN_DEFAULT_TTL_DAYS)
  # only preset 365d is active

normalizeNewTokenExpiry(raw, now):  # unchanged bounds vs today
  require parseable and expiresAtMs > now
  require expiresAtMs <= UTC(today)+365 EOD
```

本条改变的是默认常量与 UI 初载，不是校验代数本身；仍保留伪代码以免与 UX Spec 旧默认漂移。

## 3. 验收（SC）

| ID | 断言 |
|---|---|
| SC-01 | `NEW_TOKEN_DEFAULT_TTL_DAYS === 365` 且 `NEW_TOKEN_MAX_TTL_DAYS === 365` |
| SC-02 | NewToken 初载日期为 today+365；仅 `new-token-expiry-preset-365d` 为 `--active` |
| SC-03 | 预设集合仍为 30／90／180／365；无 60、无永不过期 |
| SC-04 | 自定义合法日期不等于预设时四档均无 `--active` |
| SC-05 | DOM 无 `new-token-expiry-policy-notice`，无「默认有效期为 90 天」可见文案 |
| SC-06 | Spec 124 §7 与 `SYSTEM_HANDBOOK` 现行句不再写「管理页默认 90」；改为默认 365 并指向本 Spec |
| SC-07 | UX Spec 文首注记：默认 today+90／SC-02 初载 90d **已被本 Spec 覆盖**；索引行同步 |
| SC-08 | Step6 默认短窗（现 7 天）回归不变；`npm run lint:terminology` exit 0 |

## 4. 落盘清单自检

含 `lint:spec-docs`、`lint:spec`、`lint:terminology`、`lint:ia-boundary`（R9）。定稿／收口时逐项记录结果。
