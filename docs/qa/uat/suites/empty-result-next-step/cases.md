# Cases — UAT-SUITE-EMPTY-NEXT-STEP

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-EMPTY-01 | 0 行事实 → next_step | MCP 全真 | Spec 主路径 | `rows=[]`／`totalRows=0` 且有 `next_step` |
| UAT-EMPTY-02 | 聚合 0 对照（可选） | MCP | 边界 | `rows=[[0]]` 可有 AV；**不**当作 EMPTY-01 替代 |

---

## UAT-EMPTY-01 — 0 行事实 → next_step

### 步骤

1. begin「订单明细行」／「订单数是多少」  
2. `lucy_query`：带 `dimensions`（如 `order_id`）＋不可能命中的 `filters`（`order_id eq __uat_no_such_order_xyz__`）＋`order_count`／`active_rows`

### 期望

- `rows` 为空数组且 `totalRows=0`  
- 载荷含 `next_step`（`kind=empty_result` 或等价），含 `suggestions`／`next_tools`  
- 不得用「聚合 count=0 单行」冒充本条 PASS
