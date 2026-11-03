# Token 核对提示 Spec

| 元数据 | 内容 |
|---|---|
| 文档类型 / 版本 | 产品功能合同 / **v0.1** |
| 日期 / 目标版本 | 2026-11-02 / 不绑定产品版本号 |
| 功能编号 / 优先级 | **无** / **P2**。不进入 [`docs/plans/2026-10-18-lucy-2.5-upgrade-proposal.md`](../plans/2026-10-18-lucy-2.5-upgrade-proposal.md) 登记册 |
| 状态 | **v0.1 功能合同已收口（2026-11-03）**。收口记录见 [`docs/reviews/2026-11-03-token-display-hint-closure.md`](../reviews/2026-11-03-token-display-hint-closure.md)。本条收口不表示可上线 |
| 决策来源 | 2026-11-02 产品确认：审计继续用完整 `sha256:`；列表对人展示明文截断核对提示；Codex CLI 推荐单字段 `token_hint` |
| 需求来源 | `/admin/tokens`「Token 前缀」列截断难看、`sha256:` 对用户无意义且严重重复 |
| 实施主体 | Token 签发落盘、`GET /api/admin/tokens`、Tokens 列表 UI、术语标准、相关测试、SYSTEM_HANDBOOK |
| 落位依据 | [`docs/governance/DEVELOPMENT.md`](../governance/DEVELOPMENT.md) |
| 与既有 Spec 的关系 | 不削弱 Spec 124／续期契约：完整明文仍只在创建响应出现一次；鉴权与审计仍用完整 hash／`token_hash_prefix`。续期不改 `token_hint` |
| 实施计划 | [`docs/plans/lucy-20261102-token-display-hint-plan.md`](../plans/lucy-20261102-token-display-hint-plan.md) |

## 闭口层级

- 层级：功能合同
- 本条承诺：新建 Token 落盘可选字段 `token_hint`（固定明文截断）；列表对人展示该提示而非 `sha256:` 哈希前缀；完整 hash 仍用于鉴权与审计关联且可对用户隐藏算法前缀文案。
- 本条出口：SC-01–SC-08。
- 不在本条出口：浏览器 E2E、Docker 重建、存量 Token 回填 hint、换签强制、客户环境。
- 上线关系：本条收口不表示可上线

---

## Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

New terms:

| English | 中文主术语 | 允许同义 | 禁用 | 备注 |
|---|---|---|---|---|
| Token Display Hint | Token 核对提示 | 核对片段 | Token 前缀（作本列主术语）、指纹（作本列主术语）、sha256 前缀（用户可见列） | 落盘 `token_hint`；形如 `a1b2c3…9f0e`；不可鉴权 |

Forbidden: 列表列名继续叫「Token 前缀」且展示 `sha256:…`；把完整明文写入 YAML；用 hint 做鉴权或审计主键。

## Design System Compliance

### Referenced Specs

- `webui/docs/design-system/00-principles.md`
- `webui/docs/design-system/30-pr-compliance-template.md`

### What This Change Follows

- [x] 专业标识（hint 文本）使用 `font-mono` + `notranslate` / `translate="no"`
- [x] 窄列允许换行（`break-all` / wrap），避免横向裁切关键信息
- [x] 不新增卡片式容器；沿用现有 data grid 单元格

### Exceptions (If Any)

- None.

### Follow-up Needed

- None.

---

## 1. 产品合同摘要

| 项 | 合同 |
|---|---|
| 落盘 | 新建 Token 时写入 `token_hint`；**禁止**完整明文落盘 |
| 格式 | 明文为 64 位小写 hex 时：`前 6` + Unicode `…` + `后 4`，正则 `^[0-9a-f]{6}…[0-9a-f]{4}$` |
| 列表列 | 列名「Token 核对提示」；有 hint 则展示原样；无／非法则「无核对提示」 |
| 哈希前缀 | API 仍可返回 `hashPrefix`（`hash.slice(0,19)`）供审计深链；**不得**作为该列用户主文案 |
| 续期 | 不改 `token_hint`／hash／明文 |
| 存量 | 缺字段不伪造、不强制轮换 |

## 2. 核心流程（伪代码）

```text
on_create_token(plain = random_hex_64):
  hash = "sha256:" + sha256_hex(plain)
  hint = plain[0:6] + "…" + plain[-4:]
  assert hint matches ^[0-9a-f]{6}…[0-9a-f]{4}$
  write yaml token { hash, label, created, expires_at?, device_name?, token_hint: hint }
  respond once with plain + hash + token_hint
  # never persist plain

on_list_tokens(row):
  tokenHint = row.token_hint if valid(row.token_hint) else null
  hashPrefix = row.hash.slice(0, 19)  # audit only
  ui_column = tokenHint ?? "无核对提示"
```

伪代码豁免：无独立算法模块；上列为签发与列表的合同步骤。

## 3. 验收标准

| ID | 标准 | 证据 |
|---|---|---|
| SC-01 | 新建 Token YAML 含合法 `token_hint`，且不含完整明文 | 服务端测试 |
| SC-02 | 创建响应含 `token_hint`，与明文前后截断一致 | 服务端测试 |
| SC-03 | `GET /api/admin/tokens` 对有 hint 的行返回 `tokenHint`；`hashPrefix` 仍以 `sha256:` 开头 | 服务端测试 |
| SC-04 | 缺／非法 `token_hint` 时 `tokenHint` 为 null，不从 hash 伪造 | 服务端测试 |
| SC-05 | 续期不修改已有 `token_hint` | 服务端测试或既有续期夹具断言 |
| SC-06 | Tokens 列表列名为「Token 核对提示」，展示 hint 或「无核对提示」，不把 `sha256:` 当作该列主文案 | 组件测试 |
| SC-07 | 审计深链仍使用 `hashPrefix`（`tokenHashPrefix=`） | 组件测试 |
| SC-08 | hint 单元格允许换行（含 `break-all` 或等价），避免 mono 长串单行裁切 | 组件测试 |

## 4. 非目标

- 不把完整明文写入 YAML／审计摘要
- 不回填历史 Token 的 hint
- 不改变 Proxy 鉴权、`revoked_tokens`、审计 `token_hash_prefix` 语义
- 本条不要求 Docker 重建或浏览器 E2E
