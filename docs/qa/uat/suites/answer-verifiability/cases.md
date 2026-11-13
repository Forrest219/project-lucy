# Cases — UAT-SUITE-ANSWER-VERIFIABILITY

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-AV-01 | 成功查数强制可核对块 | MCP 全真 | Spec D6／SC 主路径 | text／`_meta.lucy` 含 `answer_verifiability` |
| UAT-AV-02 | 三载体一致（可选） | MCP | Spec D2 | text／structuredContent／`_meta` 同块 |

---

## UAT-AV-01 — 成功查数强制可核对块

### 步骤

1. begin「订单数是多少」  
2. `lucy_query`：`order_count`＋`active_rows`

### 期望

- 非 error；有 `rows`  
- `content[0].text` JSON 含顶层 `answer_verifiability`  
- 块内含 `sources`、`caliber`、`cutoff`（首期 `cutoff.status` 可为 `not_checked`）  
- `_meta.lucy.answer_verifiability` 存在
