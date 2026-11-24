# Fixtures — UAT-SUITE-SOURCE-AMBIGUITY-ESCAPE

| 键 | 值 |
|---|---|
| WebUI | `http://127.0.0.1:55176` |
| Health | `http://127.0.0.1:55176/api/health` |
| MCP Proxy | `http://127.0.0.1:57881/mcp` |
| Host confirm | `http://127.0.0.1:57881/mcp/host/source-ambiguity/confirm` |
| Compose | `deploy/compose/docker-compose.demo.yml` |
| Lucy 容器 | `compose-lucy-1` |
| MCP Bearer 文件（本机） | 优先：`~/.cursor/mcp.json` 或仓库 `.cursor/mcp.json` 中本机 `lucy`／`lucy-local-docker` 的 `Authorization`（跑前 `initialize` 探针须 200）。桌面 `/Users/forrest/Desktop/lucymcp.txt` 可能过期（2026-11-16 探针 401），勿盲用。**不**把 token 写入仓库／runs |
| 连接 | `demo-mysql` |
| 泛化歧义词 | `超市`（命中 orders／people／returns） |
| 限定度量 | `superstore_orders.order_count` |
| 窄意图摘要 | `仅查询 superstore_orders 订单明细金额`（不得含「超市」） |
| ESC-11 客户同形问句 | `请使用lucy查询25年11月和12月会员收入`（原文；demo 用「超市」多表命中＋`superstore_orders` 钉选） |
| ESC-11 同形 filter | `region='East'`、`discount > 0.2`（对应客户未限定 `company_code`／`stats_yyyymm`） |
| ESC-08／10 夹具脚本（可删） | `inbox/uat-sag-fidelity-2026-11-16/{fixture,run4,esc03,mcp}.mjs`；测后必须 revert＋DROP `uat_sag_*` |

## 禁止

- 把 Bearer／密码写入 runs／INDEX／inbox 明文  
- 用 vitest／CR 冒充本套件 PASS  
- 为凑 ESC-01 绿而调用 person＋`x-lucy-host-attestation` 宿主确认（那是 `UAT-SAG-02` 范围）
