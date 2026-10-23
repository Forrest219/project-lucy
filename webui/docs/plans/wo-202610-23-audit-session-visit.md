# WO-202610-23 访问日志按会话对账

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-23 |
| 标题 | 一次 MCP 会话对应一条可查询的问询，问询 ID 不随时间窗改变 |
| 状态 | 已实现 |
| 来源 | 2026-10-13 Cursor 与 WorkBuddy 的访问日志对不上问答原文 |
| 来源 Spec | `webui/docs/172-audit-session-visit-spec.md` v0.1 |
| 撰写日期 | 2026-10-13 |
| 适用范围 | 问询重建、begin 补绑、问询列表与 CSV、配对 zip。不改 KTX，不猜测客户端名 |

## 目标

按 Spec 172，审计员用问询 ID 能把问询记录和调用流水对上。没有原文的握手也能在问询记录里找到。

## 任务

- [x] **T1 稳定问询 ID 与会话分簇。** `rebuildInferredTurns` 按 Spec 172 §6。ID 为 `inf_{userId}_{首条 access_log.id}`。有会话 ID 的调用只与同会话成簇。重建回看固定 30 天，页面窗口只过滤 `started_at`。对应 SC-1、SC-2。

- [x] **T2 会话访问。** 只有握手的会话写一条推断问询，摘要为 `会话建立：{client}`。有业务调用的会话把第一次 `initialize`、`notifications/initialized`、`tools/list` 挂进最早的那条问询。默认调用流水仍排除协议调用；按问询 ID 筛选时这些握手可见。对应 SC-4。

- [x] **T3 begin 补绑。** `lucy_begin_question` 成功后，把同会话前 2 秒内未归因的非协议调用写成 `session_bound`，并给该会话的首次握手写上同一问询 ID。`lucy_begin_question` 计入关联调用。对应 SC-3。

- [x] **T4 列表、CSV 与配对 zip。** 问询列表、详情和问询 CSV 增加客户端、会话 ID。新增「导出问询与调用」。保留原有两个导出按钮。对应 SC-5。

- [x] **T5 测试与术语。** 术语标准登记会话访问。`webui/docs/README.md` 增加 Spec 172。断言覆盖 SC-1 至 SC-5。

## 实现顺序

1. T1 先定 ID 和分簇，避免页面窗口继续改号。
2. T2 补上只有握手的会话。
3. T3 把原文问询和它前面的目录调用接上。
4. T4 让列表和导出能看见客户端、会话，并一次写出两份 CSV。
5. T5 收口。

## 验收口径

Spec 172 §8 的 SC-1 至 SC-5。少一条不算完成。

## 验证命令

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 server/__tests__/proxy-audit.test.ts server/__tests__/admin-audit.test.ts server/__tests__/mcp-proxy-smoke.test.ts src/__tests__/admin-audit-turns.test.tsx
```

## 回滚

恢复按用户和间隔成簇、ID 含窗口序号的重建。`lucy_begin_question` 重新不计入关联调用。去掉配对 zip、客户端列和会话 ID 列。协议握手不再单独成为问询。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 1 小时页面触发短回看，把 `_16` 重排成 `_03` | T1 的回看固定 30 天，ID 不含序号 |
| WorkBuddy 的查数会话自报客户端名 `lucy` | 原样显示。不用 User-Agent 改写 |
| 默认流水被每次 `tools/list` 刷满 | 只把每种握手的第一次挂进问询。无问询 ID 筛选时仍排除协议调用 |
| 旧推断问询 ID 在下次重建后变化 | 不回填历史序号。证据仍是 `access_log.id` |
