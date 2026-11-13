# Cases — UAT-SUITE-CATALOG-SEMANTICS

| ID | 标题 | 层级 | 自动化指针 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | health | demo／MCP 可用 |
| UAT-CATSEM-01 | 可见表带业务描述 | MCP 全真 | Spec SC 主路径 | `sources[].description` 非空；`descriptionState=present`（或等价） |
| UAT-CATSEM-02 | 范围裁剪（可选） | MCP | 可见性 | 仅当前 token 可见连接／源 |

---

## UAT-CATSEM-01 — 可见表带业务描述

### 步骤

1. MCP initialize  
2. `lucy_catalog`（空参或合同允许形状）

### 期望

- 至少一条 `demo-mysql`／`superstore_*` 源  
- `description` 含可读业务文案（如「Demo 超市订单…」）  
- `descriptionState` 为 `present`（若字段存在）
