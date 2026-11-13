# Fixtures — UAT-SUITE-FIELD-EXPOSURE

| 键 | 值 |
|---|---|
| WebUI／MCP | 同 [source-ambiguity-gate/fixtures.md](../source-ambiguity-gate/fixtures.md) |
| MCP Bearer 文件 | `/Users/forrest/Desktop/lucy token.txt` |
| 基线查询 | `superstore_orders.order_count`＋`active_rows` |
| 台账路径（可选） | 容器 `/data/lucy/.ktx-ui/field-exposure/`（`expected-ledgers.json`＋ledger yaml） |

## 禁止

- 把 token 写入 runs  
- 把「列不存在」上游错误冒充 `field_not_exposed` PASS  
