# WO-202610-24 探测调用不进问询

| 元数据 | 内容 |
|---|---|
| 工单号 | 202610-24 |
| 标题 | `server/discover` 等探测留在调用流水，不单独成为问询 |
| 状态 | 并入 WO-202610-25 |
| 来源 | 2026-10-13 14:35 重建容器后，Claude Code 重连产生 `inf_zhangxingchen_827` |
| 来源 Spec | `webui/docs/172-audit-session-visit-spec.md` v0.1，本工单实现后补 v0.2 |
| 撰写日期 | 2026-10-13 |
| 适用范围 | `rebuildInferredTurns` 的问询收簇。不改 KTX，不删 `access_log`，不改会话访问 |

本工单的探测规则由 WO-202610-25 实施，验收见 Spec 173 的 SC-4、SC-5。

## 目标

问询列表只保留查数和会话访问。客户端重连时的探测失败仍能在调用流水里查到，但不再生成摘要为「推断：未识别到具体数据源的调用簇」的问询。

## 现场

容器于 2026-10-13 14:35:40 起来。约 11 秒后 `claude-code/2.1.284` 以 `zhangxingchen` 写入调用 827–834。14:38:30 打开访问日志时重建出三条问询。

| 问询 ID | 调用 | 判定 |
|---|---|---|
| `inf_zhangxingchen_827` | 827、828，两次无会话 ID 的 `server/discover`，上游 400，间隔 12 毫秒 | 不应成为问询。调用流水保留 |
| `inf_zhangxingchen_829` | 会话 `45c67614-…` 的 `initialize`、`notifications/initialized`、`tools/list` | 保留，摘要「会话建立：claude-code」 |
| `inf_zhangxingchen_830` | 会话 `7913aa90-…` 的同一套握手，与上一条相差 1 毫秒 | 保留。两个会话 ID 就是两条 |

827 来自 Spec 172 的空会话成簇：没有会话 ID、又不是三次握手的调用，按 120 秒间隔收成推断问询。Spec 162 已规定 `server/discover` 不占问询预算，也不进使用分析。

## 任务

- [ ] **T1 探测簇不写问询。** 一簇里的业务调用若全部属于下面的探测名单，重建时跳过，不写 `inferred_turns`，也不写 `inferred_turn_access_logs`。`access_log` 原行保留。对应 SC-6。

  探测名单取 Spec 162 的协议方法，去掉 Spec 172 已单独处理的三次握手：`server/discover`、`ping`、`resources/list`、`resources/templates/list`、`notifications/cancelled`。

- [ ] **T2 会话访问保持。** 只有 `initialize`、`notifications/initialized`、`tools/list` 的会话仍写「会话建立：{client}」。同一会话里如果还有探测调用，探测不另起一条问询；该会话仍只保留这一条会话访问。对应 SC-7。

- [ ] **T3 真查数仍成簇。** 无会话 ID 的 `lucy_query` 或 `lucy_catalog` 仍按间隔成簇。探测调用和查数落在同一簇时，问询照旧生成，探测调用可以挂在这条问询上。对应 SC-8。

- [ ] **T4 补 Spec 172 v0.2 与断言。** changelog 记下本修订。断言覆盖 SC-6 至 SC-8，并重跑 Spec 172 的 SC-1 至 SC-5。不新增术语。

## 合并前可增补

继续看日志时，若还有别的工具被收成「推断：未识别到具体数据源的调用簇」，把工具名补进 T1 的探测名单再改代码。已确认要保留的会话访问不要从名单里删掉三次握手。

## 验证机制

不读当天那份生产库。用下面的形状造数据。修复合并前不改代码；合并时先有断言，再改 `rebuildInferredTurns`。

| ID | 构造 | 通过标准 |
|---|---|---|
| SC-6 | 同一用户、无 `lucy_session_id`，两条 `server/discover`，`outcome=error`，`error_detail=upstream_status=400`，间隔 12 毫秒，客户端 `claude-code` | `rebuildInferredTurns` 的问询数为 0。两行仍在 `access_log`。默认调用流水能查到 `server/discover`。不出现摘要「推断：未识别到具体数据源的调用簇」 |
| SC-7 | 同一用户另有一个只有 `initialize`、`notifications/initialized`、`tools/list` 的会话，客户端 `claude-code`；再加一条同会话的 `server/discover` | 问询只有 1 条，摘要为 `会话建立：claude-code`。`server/discover` 不单独成为问询 |
| SC-8 | 无会话 ID 的一条 `lucy_query`，带表名；120 秒内另有一条无会话 ID 的 `server/discover` | 问询 1 条，ID 为 `inf_{userId}_{lucy_query 的 access_log.id}`。问询摘要不是「会话建立：」 |

回归：Spec 172 的 SC-1 至 SC-5 仍通过。两个间隔小于 120 秒的不同会话仍是两条问询。只有握手的会话仍是会话访问。

人工核对只在修复进运行中的容器、并重新打开访问日志触发重建之后做：

- `inf_zhangxingchen_827` 消失。
- 调用 827、828 仍在，工具为 `server/discover`，结果为错误。
- `inf_zhangxingchen_829` 与 `inf_zhangxingchen_830` 仍在，摘要仍是「会话建立：claude-code」。

问询 ID 在重建后可能因锚点调用变化而改号。人工核对以会话 ID `45c67614-2210-40c0-893b-88d9f7f0b6a1`、`7913aa90-a2e4-462b-ae38-c89d0b321d0e` 和摘要为准，不以 829、830 这两个数字永久不变为准。

## 验证命令

合并实现时运行：

```bash
cd webui
npm run lint:terminology
npx vitest run --maxWorkers=1 server/__tests__/proxy-audit.test.ts server/__tests__/admin-audit.test.ts server/__tests__/mcp-proxy-smoke.test.ts src/__tests__/admin-audit-turns.test.tsx
```

## 回滚

恢复空会话按间隔成簇，使仅含 `server/discover` 的调用再次成为推断问询。会话访问与问询 ID 规则不动。

## 风险与边界

| 风险 | 处理 |
|---|---|
| 探测被从 `access_log` 删掉，失败访问不可查 | 只跳过写问询。调用流水保持原样 |
| 把三次握手也跳过，会话访问消失 | 探测名单不含 `initialize`、`notifications/initialized`、`tools/list`。SC-7 卡住 |
| 无会话的真查数被一起跳过 | SC-8 要求带表名的 `lucy_query` 仍成簇 |
| 配对 zip 里看不到 827 | 预期。zip 只收已生成问询的调用。827 走普通调用导出 |
