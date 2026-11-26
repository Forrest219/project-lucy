# Fixtures — asset-list-zoom

| 项 | 约定 |
|---|---|
| 环境档位 | **lean**（`npm run demo:upgrade`）。不要求 `uat:scale-baseline` |
| WebUI | `http://127.0.0.1:${LUCY_DEMO_WEBUI_HOST_PORT:-55176}` |
| MCP Proxy | `http://127.0.0.1:${LUCY_DEMO_PROXY_HOST_PORT:-57881}`（本套件默认不依赖 MCP 成交） |
| 视口 | 1920×1080 |
| 连接／Schema | 优先 demo 默认连接（如 `demo-mysql`）下多 Schema；若不足 2 Schema 或表行不够，用隔离临时 Schema／启用表造数，**跑次结束可回滚**，不污染共享 demo 常驻语义 |
| 角色授权 >50 | 选用已有多表候选角色，或临时角色勾选草稿（**默认不点保存**）；若必须保存，跑次写明回滚步骤 |
| Catalog | 同一连接多 Schema 语义表；`schema=all` 可测单组约束 |
| 凭据 | 管理员账号不入库；跑次只写「已登录管理员」 |
| 禁止 | Ctrl+F 冒充产品搜索；CR／仅 API 主张 WebUI PASS；未授权实现时记 PASS |

## 最小造数建议（实现后跑次）

| 用例 | 最小数据 |
|---|---|
| ALZ-01／04 | ≥2 Schema，合计 ≥6 表 |
| ALZ-02／03 | 单 Schema ≥12 表（盖过 5+5） |
| ALZ-05／06 | Catalog 可见 ≥2 `conn/schema` 组 |
| ALZ-07 | ≥21 Schema 摘要（可只测 cap 文案路径；若 lean 不足则 BLOCKED 写明或临时造数） |
| ALZ-09／10 | 角色 names 候选 ≥51 表 |

## 造数与降级规则

- **造数入口**：隔离临时 Schema／启用表／角色勾选草稿经现有 demo 数据通道造入（SQL 种子或语义层 demo seed），跑次结束回滚；不得污染共享 demo 常驻语义。跑次记录须写明造数方式与回滚确认。
- **前置核对**：跑次前先核对目标连接 Schema 数与候选表数（经 MCP 元数据或 `information_schema` 计数），再决定直接跑或先造数。
- **降级授权**：lean 档经造数仍无法满足的必做用例，按 [`CONVENTIONS.md`](../../CONVENTIONS.md) 记 `BLOCKED` 并写明原因，**降级验证须向委托人单独申请授权**；不得假绿、不得让必做长期静默 BLOCKED。
