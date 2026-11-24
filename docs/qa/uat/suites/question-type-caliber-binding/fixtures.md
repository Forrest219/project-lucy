# Fixtures — UAT-SUITE-CALIBER-BINDING

| 键 | 值 |
|---|---|
| WebUI／MCP | 同 [source-ambiguity-gate/fixtures.md](../source-ambiguity-gate/fixtures.md) |
| MCP Bearer 文件 | `/Users/forrest/Desktop/lucy token.txt`（fallback `lucymcp.txt`） |
| WebUI 登录凭据 | `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt`（本机管理员 id＋密码；只写路径） |
| 单表词问句 | `订单数是多少` |
| 度量 | `superstore_orders.order_count` |
| segment | `superstore_orders.active_rows` |
| Wave B 绑定资产（仓库） | [`fixtures/uat_wave_b_order_count.yaml`](fixtures/uat_wave_b_order_count.yaml) |
| Wave B 安装路径（容器） | `/data/lucy/config/caliber-bindings/uat_wave_b_order_count.yaml` |
| Wave B 生效 | 落盘后 `POST /api/semantic-assets/reindex`（需管理员会话）或等价 publish 窗口提交注册表 |
| Wave B 偏离查询 | `dimensions=[{field:"superstore_people.region"}]`（reqKeys≠orders） |
| 触发词 | `UAT订单数口径绑定`（≥4 字母数字码点） |

## 禁止

- 把 token／密码写入 runs  
- 用单测冒充本套件 PASS  
- 测后不清理 Wave B 绑定文件  
