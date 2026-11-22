# Run — 2026-11-22 — kscc — UAT-CATSEM-01

| 元数据 | 内容 |
|---|---|
| Suite／总账 | [UAT-SUITE-CATALOG-SEMANTICS](../suite.md)／P0-2／REQ-030-023 |
| 用例 | [UAT-CATSEM-01](../cases.md#uat-catsem-01--可见表带业务描述)，含 R0 和 R0-UPGRADE |
| 执行时间 | 2026-11-22 18:21:51–18:21:58（UTC+8） |
| 客户端 | kscc 1.3.8，模型 `kscc-op-4-8[1m]`，macOS arm64 |
| 环境 | 本机 Docker demo，`compose-lucy-1`（`project-lucy:demo`）及 `compose-demo-db-1`；MCP `http://127.0.0.1:57881/mcp`，Health `http://127.0.0.1:55176/api/health` |
| 构建 | Lucy 0.30.0，`gitSha=e9cb2423366db9d90de0d1e448edb0ecdc867777`，`gitDirty=false`，KTX 0.16.0 |
| 镜像 ID | `sha256:ffac27e7d869e43e363ee1b579be0e1606a3e2282b2b5d11984c1c59e0b90600` |
| 凭据 | 复用指向本机 demo 的现有只读 Token，kscc 从仓库外 `0600` 临时 MCP 配置读取 |
| 本次结果 | **PASS**（定向 `UAT-CATSEM-01`）；可选 `UAT-CATSEM-02` 本次未执行 |

## 环境门禁

| 用例 | 核对 | 观测 | 判定 |
|---|---|---|---|
| UAT-R0 | Demo 与数据容器 | Lucy、demo-db 均为 healthy | PASS |
| UAT-R0 | `GET /api/health` | HTTP 200，`ok=true`，`status=ok`，11 ms | PASS |
| UAT-R0 | 同一 Token 直连 MCP `initialize` | HTTP 200，响应有 `mcp-session-id`，协议 `2025-03-26`，服务端 `ktx/0.16.0`，43 ms | PASS |
| UAT-R0-UPGRADE | 实测构建及运行时 | 上述完整 `gitSha` 不是升级前的 `3aa402c9` 前缀，`ktxRuntime.status=ready`，`policy.healthy=true` | PASS |

## kscc 实测

用 [调用参考的单工具配置](../../../../../agent-pipeline.md#lucy-mcp--uat-调用)启动新的非交互会话。实际请求如下：

```text
请通过 Lucy 的 lucy_catalog 工具以空参数调用一次目录。仅列出 demo-mysql 中名称以 superstore_ 开头的数据源和对应业务描述、descriptionState。按工具实际返回作答。
```

| 流式事件 | 脱敏观测 |
|---|---|
| `system/init` | MCP 服务 `lucy` 为 `connected`，工具列表包含 `mcp__lucy__lucy_catalog` |
| `assistant/tool_use` | 唯一工具调用为 `mcp__lucy__lucy_catalog`，输入 `{}` |
| `user/tool_result` | 与上述工具调用 ID 匹配，无工具错误，可解析 `sources[]` |
| `result` | `subtype=success`，`is_error=false`，权限拒绝 0；最终答复包含下表三条源名及业务描述 |
| 进程与计时 | 退出码 0，stderr 0 字节，stdout 所有行均为 JSON；启动到退出 6,814 ms，kscc `duration_ms=5,256` ms，模型 API `duration_api_ms=5,193` ms |

从匹配的工具结果摘录：

| Connection | Source | `description` | `descriptionState` |
|---|---|---|---|
| `demo-mysql` | `superstore_orders` | Demo 超市订单 ODS 明细表 | `present` |
| `demo-mysql` | `superstore_people` | Demo 超市区域人员表 | `present` |
| `demo-mysql` | `superstore_returns` | Demo 超市退货表 | `present` |

| UAT-CATSEM-01 期望 | 实测 | 判定 |
|---|---|---|
| 至少一条 `demo-mysql`／`superstore_*` | 3 条 | PASS |
| `description` 含可读业务描述 | 3/3 非空，内容见上表 | PASS |
| `descriptionState` 为 `present`（若字段存在） | 3/3 返回 `present` | PASS |

本次运行只调用只读目录工具。临时凭据配置已清理，证据仅保留脱敏字段。Lucy 容器运行状态、镜像、启动时间与重启计数前后一致，`RestartCount=0`。测试台入口见 [INDEX](../../../INDEX.md)。
