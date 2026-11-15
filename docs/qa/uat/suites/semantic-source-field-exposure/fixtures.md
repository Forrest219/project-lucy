# Fixtures — UAT-SUITE-FIELD-EXPOSURE

| 键 | 值 |
|---|---|
| WebUI／MCP | 同 [source-ambiguity-gate/fixtures.md](../source-ambiguity-gate/fixtures.md) |
| MCP Bearer 文件 | `/Users/forrest/Desktop/lucy token.txt` |
| WebUI 登录凭据 | `/Users/forrest/Projects/config-for-agents/lucywebui logi.txt` |
| 基线查询 | `superstore_orders.order_count`＋`active_rows` |
| Wave B 台账（trimmed） | [`fixtures/uat_wave_b_superstore_orders_exposure.yaml`](fixtures/uat_wave_b_superstore_orders_exposure.yaml) |
| Wave B 清理台账 | [`fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml`](fixtures/uat_wave_b_superstore_orders_exposure_cleanup.yaml) |
| 生效路径 | `POST /api/semantic-assets/validate` → `POST /api/semantic-assets/publish`（管理员会话；种类 `fieldExposure`） |
| 未暴露列探针 | `superstore_orders.customer_name` |
| Serving 旁路 | 容器 `/data/lucy/.ktx-ui/field-exposure/`（由 publish 写入；勿手改冒充） |
| Wave B 已知阻断（2026-11-14） | KTX 0.16.0 把 `_exposure/<source>.yaml` 当 overlay 装载 → publish `reindex_failed`；见 [p0-wave-b 跑次](runs/2026-11-14-claude-macmini-p0-wave-b.md)／`GAP-UAT-P0-A-EXPOSURE` |
| P1-26 正式落点（待实现） | `<contentRoot>/exposure/<conn>/<source>.yaml`；见 [落点隔离 Spec](../../../../specs/lucy-20261114-field-exposure-ledger-landing-fix-spec.md)。**未开发授权前不得改运行代码**；复测用 `UAT-EXPOSURE-02-R`／`03`／`04` |

## 禁止

- 把 token／密码写入 runs  
- 把「列不存在」上游错误冒充 `field_not_exposed` PASS  
- 测后不 publish cleanup 台账  
