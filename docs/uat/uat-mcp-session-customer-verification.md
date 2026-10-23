# 客户环境 MCP Session 修复取证与验收

| 元数据 | 内容 |
|---|---|
| 文档名称 | 客户环境 MCP Session 修复取证与验收 |
| 文档类型 | UAT 取证手册（可产出可交付的证明材料） |
| 版本 | v1.0 |
| 撰写日期 | 2026-10-21 |
| 适用范围 | 客户完成版本升级后，在**客户自己的环境**上证明「不带 `Mcp-Session-Id` 的 Agent 客户端也能取数」，并形成可交付的证明材料 |
| 关联 | [升级动作单与客户沟通稿](../runbooks/customer-mcp-session-400-upgrade.md)、[MCP Session 回归 UAT](uat-mcp-session-regression.md)、[`webui/docs/07-mcp-auth-proxy-spec.md`](../../webui/docs/07-mcp-auth-proxy-spec.md) §4.3 / §6.1.2 / §6.1.3 |

## 1. 目的与适用范围

本手册产出**客户环境**上的黑盒证据，回答一个问题：

> 升级后，Agent 客户端在 `initialize` 之后**不回传 `Mcp-Session-Id`**，是否仍能完成目录查询、语义源读取和取数，且该调用在访问日志中可追溯？

**不适用**：不验证浏览器或移动端界面；不替代管理员旅程、权限与恢复演练（见 §7）。**本地演示或合成集群的回归结果不能代替本手册的现场执行**。

**证据边界**：本手册的结论只覆盖"客户拓扑已验证修复"；它不等于"整个产品已验收"。

## 2. 前置条件

| # | 前置条件 | 确认方式 |
|---|---|---|
| P1 | 已按 [升级动作单](../runbooks/customer-mcp-session-400-upgrade.md) 完成升级，且升级后业务取数已成功一次 | 升级记录 |
| P2 | 运行中的镜像**确实含修复实现** | 见 §2.1 现场自检 |
| P3 | `LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE` 未被设为 `false` | 见 §2.1 现场自检 |
| P4 | 已知本次取证的连接 ID、语义源名、至少一个可用度量 | 见 §2.2 |
| P5 | 客户 UAT Token 通过环境变量注入，不写进命令、报告或截图 | 现场约定 |
| P6 | 客户侧能按 `requestIds` 查询访问日志 | 管理员配合 |

### 2.1 现场自检：证明"跑的镜像含修复"

这一步不依赖任何文档断言，直接看运行中的容器。

```bash
# 1) 修复实现是否在镜像内（应为 true）
kubectl -n <namespace> exec deploy/<deployment> -c <container> -- \
  sh -c 'grep -c LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE /app/webui/server/proxy/upstream-session.ts'

# 2) 代理确实带握手实现（应为 true）
kubectl -n <namespace> exec deploy/<deployment> -c <container> -- \
  sh -c 'grep -c handshakeUpstreamSession /app/webui/server/proxy/mcp-proxy.ts'

# 3) 开关未被关闭（应为 1；输出空或 false 即为关闭态）
kubectl -n <namespace> exec deploy/<deployment> -c <container> -- \
  sh -c 'echo "keepalive=[$LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE]"'

# 4) 运行时版本
kubectl -n <namespace> exec deploy/<deployment> -c <container> -- ktx --version
```

第 1/2 步任一为 0 → **尚未运行修复版本**，停止取证，先完成升级。第 3 步为 `false` → 代理退回纯透传，400 会原样出现，先修正开关。

### 2.2 确认取证参数

取数参数必须与客户语义层实际暴露的名字一致，否则会出现"参数不对"的假失败。

```bash
# 用 Agent 令牌调一次目录，读取真实 connectionId / sourceName
curl -sS -X POST "<公网 MCP URL>" \
  -H "authorization: Bearer $LUCY_UAT_TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"lucy_catalog","arguments":{}}}'
```

从返回中确认：

- `connectionId`：客户 Doris 连接 ID；
- `sourceName`：**语义源名**（不是物理表名）；
- 度量名：形如 `<sourceName>.<measure>`，供 `--measure` 使用。

> 度量名与默认的 `order_count` / `total_sales` 不同时，必须用 §3.2 的 `--expect-metric` / `--expect-value`，否则取证脚本会因"找不到默认指标"而判失败——那是工具口径问题，不是修复问题。

## 3. 取证执行

### 3.1 通用形式

```bash
export LUCY_UAT_TOKEN='<客户 UAT Token>'
npm run uat:mcp-session -- \
  --proxy-url https://<customer-host>/mcp \
  --token-env LUCY_UAT_TOKEN \
  --connection-id <connection-id> \
  --source-name <source-name> \
  --measure <source-name>.<measure> \
  --expect-metric <measure> \
  --no-container \
  --out inbox/mcp-session-uat/doris-evidence.json
```

**走公网 MCP URL，不要直连 KTX `:7878`。**

`--no-container` 只跳过本机 Docker 溯源与容器内 SQLite 审计读取；客户环境必须由管理员按 §5 人工核对访问日志。

### 3.2 指标口径参数

| 参数 | 用途 | 何时用 |
|---|---|---|
| `--expect-metric <name>` | 该度量必须在响应中出现（可重复） | 非 Demo 环境必用 |
| `--expect-value <name>=<number>` | 该度量的精确值（可重复，容差 0.01） | 需要固定金标准时用 |
| `--expected-order-count <n>` / `--expected-total-sales <n>` | Demo 契约的确定值断言 | 仅 Demo 环境 |

未给任何期望参数时，脚本退化为"响应中必须含至少一个数值指标"——用于区分"空信封"与"真实数据"，不校验具体值。

### 3.3 脚本执行的检查项

脚本是黑盒序列，**故意在 `initialize` 之后不回传会话标识**，以此复现客户现场的客户端形状：

1. 无 Token 请求 → 必须 401（鉴权未被削弱）；
2. `initialize` → 必须返回会话标识；
3. `notifications/initialized` 不带会话标识 → 必须成功；
4. `lucy_catalog` 不带会话标识 → 必须成功且能看到目标连接与语义源；
5. `lucy_read_source` 不带会话标识 → 必须成功；
6. `lucy_query` 不带会话标识 → 必须成功且返回真实指标；
7. `DELETE /mcp` 后继续不带会话标识取数 → 必须透明恢复（自动重握手 + 一次重试）；
8. 按标准方式回传会话标识再取数 → 合规客户端无回归；
9. 全部响应中**不得出现**历史错误文本 `MCP initialize request is required before session traffic.`。

## 4. 证据文件逐字段解读

产物：`inbox/mcp-session-uat/doris-evidence.json`（脱敏；Token 与实际会话标识**不写入**）。

| 字段 | 含义 | 它证明了什么 |
|---|---|---|
| `status` | `pass` / `fail` | 总体判定；`fail` 时看 `failure.message` |
| `target.proxyUrl` | 被测端点 | 证据来自哪个入口（应为公网 MCP URL） |
| `target.connectionId` / `sourceName` | 被测连接与语义源 | 取证对象与客户现场一致 |
| `target.measures` / `expectedMetrics` / `expectedValues` | 请求了什么、断言了什么 | 证据不是空跑 |
| `target.tokenPresent` | 令牌已注入（不含值） | 鉴权路径被真实走过 |
| `provenance.gitSha` | 取证时仓库提交 | 证据可对应到代码版本 |
| `provenance.container` / `image` | 容器与镜像身份 | `--no-container` 时为 `null`，需人工补 |
| `provenance.sessionKeepalivePresent` | 镜像内含修复实现 | 与 §2.1 现场自检互为印证 |
| `checks[]` | 每项断言的 HTTP 状态与结果 | 逐条对应 §3.3 |
| `checks[].metrics` | 取数返回的指标值 | 取到的是数据，不是空信封 |
| `checks[].audit` | 恢复场景的审计裁决 | 本机可直读；客户环境显示 `not_checked`（见 §5） |
| `requestIds` | 每次调用的请求标识 | 管理员按此核对访问日志（§5） |
| `failure.message` | 失败原因（仅 fail 时） | 失败定位 |

## 5. 访问日志人工核对项（客户环境必做）

`--no-container` 下脚本读不到容器内 SQLite 审计库，**审计核对由客户管理员完成**，这一步不可省。

| 核对项 | 期望 | 对应 |
|---|---|---|
| `requestIds.query` 对应行 | `outcome=ok`，无 `MCP initialize request is required` | 不带会话标识仍取到数 |
| `requestIds.readSource` 对应行 | `outcome=ok` | 语义源读取成功 |
| `requestIds.recovery` 对应行 | `outcome=ok`，`decision_reason=upstream_session_recovered` | 会话由代理重建后调用成功 |
| `requestIds.initialize` 对应行 | 成功，且代理已持有上游会话 | 会话接管生效 |
| 无 Token / 被拒查询 | 仍被拒绝 | 鉴权与权限未被修复动作削弱 |

`upstream_session_recovered` 是本次修复的**直接留痕**：它表示"该次调用本身成功，但传输会话是代理重新握手后建立的"——即客户那个不回传会话标识的客户端。审计归因仍以 `lucySessionId` / `lucyTurnId` 为准，不受会话接管影响。

请管理员导出访问日志对应行（脱敏）作为证明材料附件。

## 6. 客户可见的现象对照表

这是客户最关心的一页——原现象与现在逐条对应。

| 客户此前观察到的现象 | 升级后 | 证据字段 |
|---|---|---|
| 目录能看（`lucy_catalog` 成功） | 仍成功 | `checks[catalog_without_session]` |
| `lucy_read_source` 返回 400 | 成功 | `checks[read_source_without_session]` |
| `lucy_query` 返回 400 | 成功且指标值正确 | `checks[query_without_session].metrics` |
| 响应中出现 `MCP initialize request is required before session traffic.` | 不再出现 | 脚本对每个响应硬断言 |
| 无法自证 | 访问日志可按 `requestIds` 核对 | `requestIds` + §5 核对表 |
| 担心"查不了数"被误判为数据库故障 | 失败形态被消除 | `checks[].httpStatus` |

## 7. 与交付包验收（ACCEPTANCE.md）的衔接

客户交付包内 `ACCEPTANCE.md` 的必验项中，与本手册对应的是：

> 原 MCP Token 可 initialize / tools/list 并执行一条真实允许查询；无 Token、原禁止查询仍拒绝。

| ACCEPTANCE.md 项目 | 本手册覆盖 | 仍需单独完成 |
|---|---|---|
| 原 MCP Token 可 initialize / tools/list / 真实允许查询 | ✅ §3.3 全部检查项 | — |
| 无 Token、原禁止查询仍拒绝 | ✅ §5 核对项第 5 行 | 需管理员在访问日志确认 |
| 首次管理员认领与登录 | ❌ | 由 `scripts/acceptance.sh` 与管理员旅程覆盖 |
| 业务连续性、连接与索引重建 | ❌ | 由业务验收覆盖 |
| 恢复旧卷与旧版本后再次升级 | ❌ | 由 RECOVERY.md 演练覆盖 |

**未执行的项目填「待验」，不得填 PASS。** 本手册不替代管理员旅程与恢复演练。

## 8. PASS / FAIL 判定

判定 PASS 必须同时满足：

- 三个 `lucy_*` 工具在**不带会话标识**时全部成功；
- 取数返回真实指标（值符合 `--expect-value` 断言，或至少含一个数值指标）；
- `DELETE /mcp` 后取数透明恢复；
- 合规客户端（回传会话标识）无回归；
- 未授权请求仍返回 401；
- 全部响应不含历史错误文本；
- 访问日志按 §5 核对通过；
- §2.1 现场自检确认运行镜像含修复实现。

出现以下任一情况判 FAIL：核心调用失败、只返回空信封、审计缺失、历史错误文本重新出现、运行镜像不含修复实现。

## 9. 已知边界与不得宣称事项

1. **本手册的结论只覆盖该客户环境**；Doris 属 gated 支持（每环境独立取证）。
2. **会话缓存是进程内状态**：多副本 KTX 需要共享存储或粘性路由；单副本部署成立。
3. **修复不替代客户端合规**：仍建议 Agent 客户端回传 `Mcp-Session-Id`，可少一次内部握手往返。
4. **不得把"能取数"说成"已验收"**：管理员旅程、恢复演练、业务连续性是独立必验项。
5. **不得在未升级的版本上取证**——旧版本必然复现 400，取证结果无意义。
6. **证据文件不得包含令牌、密码、Cookie、完整 values、PVC 备份或 Secret**。

## 10. 本地对照复现（不需要旧镜像）

客户现场的现象可以在本地用**同版本 + 开关位**复现，无需构建 2026-08-28 的旧镜像。

`LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE=false` 是保留的退回开关：置 `false` 后代理
退回"纯透传"，即客户端不回传会话标识时请求直达上游并被传输层拒绝——**与客户修复前
的行为一致**。

```bash
# 1) 造一个只改开关的 compose override（不改仓库文件）
cat > /tmp/keepalive-off.override.yml <<'YAML'
services:
  lucy:
    environment:
      LUCY_ENABLE_UPSTREAM_SESSION_KEEPALIVE: "false"
YAML

# 2) 以故障态重建（数据卷保留）
docker compose -f deploy/compose/docker-compose.demo.yml \
  -f /tmp/keepalive-off.override.yml up -d --force-recreate lucy

# 3) 用客户客户端形状调用：initialize 后不回传会话标识
#    → lucy_catalog 成功（本地服务），lucy_read_source / lucy_query 被拒

# 4) 复位
docker compose -f deploy/compose/docker-compose.demo.yml up -d --force-recreate lucy
```

**两种状态的判别特征**：

| | 故障态（开关关闭） | 修复态（默认） |
|---|---|---|
| 客户端可见 | JSON-RPC `-32003`，`reason=upstream_session_required` | 取数成功，返回真实指标 |
| 访问日志 | `outcome=error`、`decision_reason=upstream_session_required` | `outcome=ok`、`decision_reason=upstream_session_recovered` |
| 上游原始文本 | 只留在审计 `error_detail`，不外泄给客户端 | 不适用 |

> **与客户现场的差异（必须写明）**：客户现役版本早于上游失败分类的引入，因此他们看到
> 的是**裸 HTTP 400 文本**；当前版本即使在故障态也会把上游失败转成结构化 JSON-RPC
> 错误。因此两者的**失败模式相同、取数被拒相同、审计裁决相同**，但**错误外泄形态不同**。
> 修复后两种形态都不再出现。

## 11. 取证工具本身的验证状态

| 项目 | 状态 |
|---|---|
| 取证脚本 | `scripts/uat/mcp-session-regression.mjs` |
| 脚本自测 | `npm run uat:mcp-session:test` — 6 条用例全通过（含非 Demo 度量名、期望值不匹配必须判失败、缺少指标必须判失败、历史错误文本必须判失败、令牌与会话标识不得入证据） |
| 非 Demo 度量口径 | 已支持 `--expect-metric` / `--expect-value`；未指定期望时退化为"含至少一个数值指标" |
| 本机端到端实跑 | ✅ 已完成：本地 demo（`project-lucy:demo`，KTX 0.16.0）端到端 **9/9 检查项 PASS**，证据含容器内审计裁决 `outcome=ok` / `decision_reason=upstream_session_recovered` |
| 本机故障态复现 | ✅ 已完成：按 §10 关闭开关后，同一脚本与同一客户端形状复现取数被拒，审计记为 `error` / `upstream_session_required` |
| 客户环境端到端执行 | 待在客户环境按 §3 执行；本机结果不能代替 |

> 取证工具与断言本身按产物维护：现场发现新的表达方式或新的假阳性/假阴性时，补充为回归用例后再改脚本，不得只改断言。
