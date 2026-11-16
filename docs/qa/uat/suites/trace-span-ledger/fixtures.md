# Fixtures — UAT-SUITE-TRACE-LEDGER

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Health | `http://127.0.0.1:55176/api/health` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| 审计库（容器内） | `.ktx-ui/audit.sqlite`（`LUCY_AUDIT_DB` 可覆盖）；导出走 WebUI `GET /api/admin/audit/export-v2`／`export-pack-v2` |
| MCP Bearer 文件（本机） | 同 [escape 套件 fixtures](../source-ambiguity-mcp-escape/fixtures.md)：`~/.cursor/mcp.json` 中本机 `lucy` 的 `Authorization`（跑前 `initialize` 探针须 200）。**不**把 token 写入仓库／runs |
| 连接与表 | `demo-mysql`；`superstore_orders.order_count`（合法查询）；`kc-starrocks` 不用 |
| 混合流量脚本（**待造**） | 一次发出：`initialize`、`notifications/initialized`、`tools/list`、`ping`、`lucy_begin_question`、合法 `lucy_query`、被 ACL 拒绝的 `lucy_query`、被门闩拒绝的 `lucy_query`、`wiki_search`、`wiki_read`、不存在的工具名。**发送侧独立生成清单**（`test_run_id`、类别、期望落库数，写入 `runs/`），关联键＝请求头 `User-Agent: lucy-uat/<test_run_id>`（落 `user_agent`）＋唯一 JSON-RPC id `<test_run_id>-<序号>`（落 `rpc_request_id`）；无 id 的通知与 `ping` 按（UA，方法）计数。用于与 `access_log` 双向差集（UAT-TRC-01）。脚本由实现授权后落 `scripts/uat/`，**本文件不假定其存在** |
| 故障注入（UAT-TRC-03） | 在 demo 审计库临时建触发器，使对 `access_trace_span` 的 INSERT `RAISE(ABORT, …)`；用例结束 `DROP TRIGGER`。命令在跑次里原样记录 |
| 脱敏夹具（UAT-TRC-07） | **预期输出表**（真实上游错误触发；vitest 另覆盖全表含 IPv6／带端口）：①内网 IP——建测试连接指向 `10.255.255.1:3306` 或 `127.0.0.1:1`，读取时的真实连接错误含地址，期望 `error_detail` 含 `[REDACTED_ADDR]` 且保留「连接失败／超时」原因码；②内部工具名——**条件项**：基线跑次先用合法入参找出一个能让真实上游返回含 `sl_query` 的错误的请求（缺 `measures` 的入参被本地 `validateLucyToolArgs()` 拦截，不能用），并保存未脱敏的原始错误作为证据；找到则期望脱敏后含 `[REDACTED_TOOL]`，找不到则该项降为 vitest，写进基线跑次；③`hdfs://` 存储路径——**不入必做 UAT**，由 vitest 契约表覆盖（Spec O8）；④误伤反例——错误里含公网 IPv4（如 `8.8.8.8`）、公网 IPv6（如 `2001:4860:4860::8888`）、版本号（`1.2.3.4` 样式但属版本字符串）、时间戳、端口样式串、公网文档域名，期望原样保留；⑤脱敏范围——RFC1918、回环、链路本地、ULA 被替换，公网保留。**不得**用真实客户地址；**不得**用空串／NULL 视为通过 |
| 本地回退夹具（UAT-TRC-06 场景②） | 临时让 `wiki_search` 的上游调用失败而本地检索可用（容器内临时停 KTX MCP 子进程后调用，调用完恢复）；记录命令；结束必须恢复并确认上游健康 |
| 来源 IP 配置（UAT-TRC-08） | 四种：默认（不设 `LUCY_TRUST_PROXY`）；设 `LUCY_TRUST_PROXY`＋`LUCY_TRUSTED_PROXY_CIDRS`（含测试对端）并带 `X-Forwarded-For`；带 `X-Real-IP`；对端不在可信 CIDR 内伪造 `X-Forwarded-For`。每次改配置须记录并还原 |
| 客户基线（参考，非验收值，**不可核：仓外材料**） | 客户全量流水 23,687 行：协议请求无 `trace_id` 占 61%；`primary_status=unknown` 占 64%；`client_ip` 仅 2 个取值 |
| 规模夹具（UAT-TRC-11） | 复用 P1-31 的合成账本夹具 `webui/scripts/page-event-loop-sweep.mts` 的沙箱审计库，扩到 10 万 trace（含对应 span 行）；扩容脚本是 Plan 步骤 0 的交付物，**本文件不假定其存在**；容量预算取 Spec O6 冻结值（每 trace span 表＋索引平均 ≤ 8 KB） |

## 已交付夹具与脚本（2026-11-17；表中「待造」措辞以本节为准）

| 夹具 | 实际落位 | 说明 |
|---|---|---|
| 混合流量＋发送清单 | `scripts/uat/trace-span-ledger-uat.mjs`（TRC-01/02/03/04/05/06/10；`all` 一次跑完） | 每个请求带 `User-Agent: lucy-uat/<run>` 与唯一 JSON-RPC `id`（`<run>-<序号>`），与 `rpc_request_id` 做双向差集；无 `id` 的通知按（UA，方法）计数 |
| 环境 | 宽目录沙箱 `lucy-uat-wide`（`scripts/uat/uat-wide-sandbox.mjs`），**不是 demo 审计库**：TRC-03 故障注入在沙箱审计库建触发器、用后 `DROP` | 与 demo 隔离，避免污染 demo 账本 |
| 规模夹具 | `webui/scripts/span-ledger-scale.mts`（临时沙箱库，真实写入路径＋按时间平移克隆至 10 万 trace） | 事件环为进程内度量，未走 HTTP `/api/livez`，也未与 PAGE-SWEEP 同跑 |
| 仍缺 | TRC-07 脱敏夹具、TRC-08 来源 IP 配置、TRC-09 改前构建、TRC-06 场景②与旧行对照 | 记 **NOT RUN**，见 runs |
| 已知限制 | 正式完整导出 `mode=complete` 因 F-02（`access_log_asof_meta` 为空）失败关闭 | TRC-05 改用 `mode=diagnostic` 读 `spans.csv` 并单列缺口 |

## 通用约定

- 每个用例的结果写入 `runs/YYYY-MM-DD-<agent>-<short>.md`，包含容器 `gitSha`、`gitDirty`、`derivation_version`。
- 抽取证据用只读 SQL 查询调用流水与 `access_trace_span`；查询语句写进跑次。

## 禁止

- 把 Bearer／密码写入 runs／INDEX／inbox 明文
- 用 vitest／CR 冒充本套件 PASS
- 为凑绿而在审计库里手工插入 `trace_id` 或 span 行（规模夹具的合成账本只用于 UAT-TRC-11 的沙箱库，不得用于其他用例）
- 遗留故障注入触发器
