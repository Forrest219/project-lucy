# Fixtures — UAT-SUITE-CALIBER-BINDING

| 键 | 值 |
|---|---|
| WebUI／MCP | 同 [source-ambiguity-gate/fixtures.md](../source-ambiguity-gate/fixtures.md) |
| MCP Bearer 文件 | `/Users/forrest/Desktop/lucy token.txt` |
| 单表词问句 | `订单数是多少` |
| 度量 | `superstore_orders.order_count` |
| segment | `superstore_orders.active_rows` |
| 绑定资产根（可选夹具） | 内容根 `caliber-bindings/<id>.yaml`（容器内 `/data/lucy/config` 或现行 contentRoot） |

## 禁止

- 把 token 写入 runs  
- 用单测冒充本套件 PASS  
