# Lucy MCP Session 回归 UAT

## 1. 目标

验证 Agent 客户端完成 MCP `initialize` 后，即使未在后续请求回传
`Mcp-Session-Id`，仍可连续调用 `lucy_catalog`、`lucy_read_source` 和
`lucy_query`，不会再收到：

```text
MCP initialize request is required before session traffic.
```

本 UAT 验证 MCP 传输链路，不验证浏览器或移动端界面。

## 2. 前置条件

- 使用目标 `main` commit 重新构建并启动 Lucy，禁止复用旧镜像。
- KTX 版本为 `0.16.0`。
- UAT Agent 至少允许 `lucy_catalog`、`lucy_read_source`、`lucy_query`，并可访问测试 source。
- Token 只通过环境变量传入，不写入命令、报告或仓库文件。
- Docker Demo 默认目标为：
  - Proxy：`http://127.0.0.1:57881/mcp`
  - Connection：`demo-mysql`
  - Source：`superstore_orders`
  - `order_count=1000`
  - `total_sales=1459476.0953`

## 3. 自动执行

### 3.1 重建 Demo

```bash
npm run demo:upgrade
```

默认保留 Demo volume 中的账户、Token 与审计记录。仅需重新 seed 时才使用
`npm run demo:upgrade -- --fresh`。

### 3.2 运行 Session UAT

```bash
export LUCY_UAT_TOKEN='<一次性 UAT Token>'
npm run uat:mcp-session -- \
  --proxy-url http://127.0.0.1:57881/mcp \
  --token-env LUCY_UAT_TOKEN \
  --connection-id demo-mysql \
  --source-name superstore_orders \
  --container project-lucy-lucy-1 \
  --out inbox/mcp-session-uat/evidence.json
```

脚本执行以下黑盒序列：

1. 无 Token 请求返回 401。
2. 完成 `initialize` 并确认响应带 Session ID。
3. 后续故意不发送 Session ID，调用目录、读定义和查询工具。
4. 校验 Demo 指标确定值。
5. 发送 `DELETE /mcp` 后继续不带 Session ID 查询，验证自动重握手与一次重试。
6. 从容器审计库核验 `outcome=ok`、`decision_reason=upstream_session_recovered`。
7. 重新初始化并按标准方式回传 Session ID，验证合规客户端无回归。

证据文件只记录 Session ID 是否存在，不记录实际 Session ID；Token 永不写入证据。

## 4. 故障与回退验证

以下测试使用隔离的 KTX Stub，不操作真实数据库：

```bash
cd webui
npx vitest run --maxWorkers=1 \
  server/__tests__/mcp-proxy-upstream-failure.test.ts \
  server/__tests__/mcp-proxy-upstream-session.test.ts
```

覆盖：

- KTX 裸 `400 text/plain` 被转换为 HTTP 200 + JSON-RPC error。
- 错误码为 `upstream_session_required`，原始上游文本不返回客户端。
- 审计记录 `outcome=error` 和真实失败原因。
- Session keepalive 关闭时不自动恢复，但错误仍是合法 JSON-RPC。
- Session 过期时只重握手一次、业务请求只重试一次。

## 5. 回归门禁

```bash
npm run uat:mcp-session:test

cd webui
npm test
npm run build

cd ..
npm run smoke:p0:demo
```

不执行浏览器或移动窄屏测试。

## 6. PASS / FAIL

判定 PASS 必须同时满足：

- 省略 Session ID 时三个 `lucy_*` 工具均成功。
- 查询返回 `order_count=1000`、`total_sales=1459476.0953`。
- Session 被删除后查询透明恢复，审计裁决为 `upstream_session_recovered`。
- 标准回传 Session ID 的客户端仍成功。
- 用户可见响应不包含历史错误文本。
- Session 专项测试、完整测试、构建和 Demo Smoke 均通过。

任一核心调用失败、只返回空信封、审计缺失或历史错误文本重新出现，均判定 FAIL。

## 7. Doris 客户环境复测

使用客户 UAT Token 和 Public MCP URL；不要直连 KTX `:7878`。为 Doris source
提供至少一个有效 measure；非 Demo 环境不校验 Demo 确定值：

```bash
export LUCY_UAT_TOKEN='<客户 UAT Token>'
npm run uat:mcp-session -- \
  --proxy-url https://<customer-host>/mcp \
  --token-env LUCY_UAT_TOKEN \
  --connection-id <doris-connection-id> \
  --source-name <source-name> \
  --measure <source-name.measure-name> \
  --no-container \
  --out inbox/mcp-session-uat/doris-evidence.json
```

`--no-container` 只跳过本机 Docker provenance 和 SQLite 审计读取。客户复测仍需由管理员
在访问日志中按证据文件的 `requestIds` 核对调用成功。Doris 复测通过后，结论可标记为
“客户拓扑已验证修复”。

## 8. 报告记录

| 项目 | 记录 |
|---|---|
| Git SHA |  |
| 镜像 ID / 启动时间 |  |
| KTX 版本 |  |
| UAT Agent / Token label | 仅 label，不记录 Token |
| 自动证据路径 | `inbox/mcp-session-uat/evidence.json` |
| Session 专项测试 | PASS / FAIL |
| 完整测试与构建 | PASS / FAIL |
| Demo Smoke | PASS / FAIL |
| Doris 复测 | PASS / FAIL / NOT RUN |
| 总体结论 | PASS / FAIL / BLOCKED |
