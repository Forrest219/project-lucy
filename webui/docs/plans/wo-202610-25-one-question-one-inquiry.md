# WO-202610-25 一次提问一条问询

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-25 |
| 标题 | 已上报的会话不再并列推断问询，同会话调用挂到这一条上 |
| 状态 | 已实现 |
| 来源 | 2026-10-13 14:39 WorkBuddy 与 14:43 Cursor 的访问日志 |
| 来源 Spec | `webui/docs/173-audit-one-question-one-inquiry-spec.md` v0.1 |
| 撰写日期 | 2026-10-13 |
| 适用范围 | 问询归因、推断重建、证据包。并入 WO-202610-24。不改 KTX |

## 目标

审计员用一条问询 ID 能追到这次提问的目录、读表和查数。没有原文的查数仍是一条推断问询。探测调用留在调用流水。

## 任务

- [x] **T1 写日志前再归因，补绑改为 120 秒。** `tools/call` 写日志时若仍是 `unassigned` 且本会话已有问询，改为 `session_bound`。`bindPriorSessionCalls` 的窗口改为 120 秒。对应 SC-1、SC-2。

- [x] **T2 已上报调用不再成推断问询。** `rebuildInferredTurns` 跳过已有 `lucy_turn_id` 的调用。该会话没有剩余业务调用时不写推断问询，也不再写第二条会话访问。无 begin 的查数会话仍单独成簇。对应 SC-1、SC-3。

- [x] **T3 探测簇不进问询。** 并入 WO-202610-24。整簇都是 `server/discover`、`ping`、`resources/list`、`resources/templates/list`、`notifications/cancelled` 时跳过。三次握手的会话访问保留。对应 SC-4、SC-5。

- [x] **T4 证据包带上已关联握手。** 默认调用流水仍排除协议调用。证据包加入已挂到本次问询上的三次握手，manifest 写 `linkedHandshakeRowCount`。对应 SC-6。

- [x] **T5 测试与索引。** Spec 173、本工单、Spec 172 changelog、`webui/docs/README.md`。WO-202610-24 标为并入本工单。不新增术语。

## 验收口径

Spec 173 §7 的 SC-1 至 SC-6。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 server/__tests__/proxy-audit.test.ts server/__tests__/admin-audit.test.ts server/__tests__/mcp-proxy-smoke.test.ts src/__tests__/admin-audit-turns.test.tsx
```

平滑升级后用原题复现：

- WorkBuddy：`lucy mcp 是做什么的，能帮助我分析哪些数据，展开讲讲`
- Cursor：`lucy mcp 有哪些上市公司的财务数据？`

## 回滚

补绑窗口改回 2 秒。写日志前不再次归因。已有 `lucy_turn_id` 的调用重新进入推断问询。探测簇恢复成推断问询。证据包不再附加握手。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 120 秒窗口把上一个问题的调用补进新问询 | 只补尚未归因的调用。已经挂上问询 ID 的不改 |
| WorkBuddy 不上报原文 | 仍是一条推断问询。不编造原句 |
| 证据包被每次 `tools/list` 刷满 | 只加入已经挂到问询上的握手 |
| 客户端名被改成 WorkBuddy | 不根据 User-Agent 改写 |
