# 一次提问一条问询

| 元数据 | 内容 |
|---|---|
| 文档名称 | 一次提问一条问询 |
| 文档类型 | Product / Audit / API Spec |
| Spec 编号 | 173 |
| 版本 | v0.1 |
| 撰写日期 | 2026-10-13 |
| 委托人 | xingchen |
| 状态 | 已实现 |
| 适用范围 | MCP Proxy 问询归因、推断问询重建、审计证据包。不改 KTX |
| 关联工单 | `webui/docs/plans/wo-202610-25-one-question-one-inquiry.md` |
| 上游 | Spec 138、Spec 162、Spec 172。并入 WO-202610-24 |

### Changelog

| 版本 | 变更 |
|---|---|
| v0.1 | 已上报会话不再并列推断问询。同会话补绑改为 120 秒，写日志前再归因一次。仅含探测的簇不进问询。证据包带上已关联的握手 |

2026-10-13 14:39 WorkBuddy 与 14:43 Cursor 的导出：Cursor 原句在已上报问询上，同一会话又有一条推断问询。目录调用比 begin 早 10 秒，两次读表在 begin 落库后才写完，仍是 `unassigned`。WorkBuddy 没有调用 `lucy_begin_question`。证据包少了已挂到问询上的握手。

## 1. 问题

一次提问在问询列表里出现两条，关联调用数不能相加。按问询 ID 追数据会漏掉同会话的目录和读表。仅含 `server/discover` 的重连被收成「推断：未识别到具体数据源的调用簇」。证据包把 `complete` 标为 true，同时排除了已关联的握手。

## 2. 目标

1. 客户端上报了原文时，该会话只保留这一条已上报问询。已有 `lucy_turn_id` 的调用不再进入推断问询，也不再为这些握手另写「会话建立」。
2. 同会话、同用户、同凭据、begin 前 120 秒内仍未归因的非协议调用，补成 `session_bound`。早于 120 秒的不补。
3. `tools/call` 写日志前若仍是 `unassigned`，且本会话已经有问询，改为 `session_bound`。
4. 没有原文的查数会话仍是一条推断问询，不与另一个会话合并。
5. 整簇都是探测调用时不写问询。调用流水保留原行。只有三次握手的会话仍是会话访问。
6. 默认调用流水仍排除协议调用。证据包额外加入已挂到本次导出问询上的 `initialize`、`notifications/initialized`、`tools/list`，manifest 写出 `linkedHandshakeRowCount`。

## 3. 非目标

- 不新增归因枚举。仍是 `explicit` / `session_bound` / `identity_inferred` / `unassigned`。
- 不因缺少 `lucy_begin_question` 拒绝查数。
- 不保存客户端最终回答。
- 不根据 User-Agent 把 `undici` 改写成 WorkBuddy，也不改客户端自报的名字。
- WorkBuddy 若不调用 `lucy_begin_question`，问询仍是推断问询。摘要仍来自触达的表，不编造原句。
- 不把未关联的后续 `tools/list` 放进默认调用流水或证据包。
- 不改 KTX。

## 4. 修订关系

| 原规定 | 本 Spec 之后 |
|---|---|
| Spec 172：begin 前 2 秒内的同会话未归因调用补绑 | 改为同会话 120 秒，与分簇间隔相同 |
| Spec 172：推断重建把已上报调用再收成一条推断问询 | 已有 `lucy_turn_id` 的调用不进推断簇。该会话没有剩余业务调用时不写推断问询 |
| Spec 172：空会话里的 `server/discover` 按间隔成簇 | 整簇都是探测调用时跳过。探测名单：`server/discover`、`ping`、`resources/list`、`resources/templates/list`、`notifications/cancelled` |
| 证据包在 `includeProtocol: false` 时不含握手 | 已挂到导出问询上的三次握手进入证据包。默认调用流水不变 |

## 5. Terminology Compliance

This feature follows `webui/docs/00-product-terminology-standard.md`.

No new terms. 问询、推断问询、会话访问、调用流水、审计证据包沿用既有主术语。

## 6. 核心流程

```text
PRIOR_BIND_MS = 120000
PROBE = {server/discover, ping, resources/list, resources/templates/list, notifications/cancelled}

on tools/call write:
  if mode is unassigned and this session already has a reported turn:
    mode = session_bound

on begin:
  bind same user, token, session, empty turn id, non-protocol, ts within PRIOR_BIND_MS

on rebuild:
  business = rows with empty lucy_turn_id and tool not in HANDSHAKE
  skip a cluster whose every tool is in PROBE
  do not attach handshake rows that already have lucy_turn_id
  a session with no remaining business row does not get an inferred turn
  a handshake-only session still gets 会话建立

on evidence pack:
  rows = current filter
  add HANDSHAKE rows already linked to those turn ids
  manifest.linkedHandshakeRowCount = added count
```

## 7. 验收

| ID | 断言 |
|---|---|
| SC-1 | 同会话 `lucy_catalog` 比 begin 早 10 秒，`lucy_read_source` 在 begin 落库后才写完。两条都是 `session_bound`，已上报问询包含它们。重建后该会话没有第二条推断问询 |
| SC-2 | 同会话、早于 120 秒的未归因调用保持 `unassigned` |
| SC-3 | 无 begin 的查数会话仍是一条推断问询，且不与另一个会话合并 |
| SC-4 | 只有两次 `server/discover` 时问询数为 0。默认调用流水仍能查到这两行 |
| SC-5 | 同会话有三次握手和一条 `server/discover`、没有查数时，问询只有一条，摘要为 `会话建立：{client}` |
| SC-6 | 证据包含该问询已关联的 `initialize`。默认调用列表不含 `initialize` |
