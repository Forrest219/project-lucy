# UAT-SUITE-SCHEMA-TABLE-APPEND — Schema Manifest 按表追加与路径归一化

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-SCHEMA-TABLE-APPEND` |
| 总账 ID | **P1-90**／REQ-030-111 |
| 目标 | 验证：`POST /api/schema-manifests/:conn/:schema/tables`（create-only 按表追加）的 dryRun／正式写、create-only 拒绝、请求体与内容校验、三段物理表名兼容、反向 standalone shadow 告警、写管线与审计，以及 `resolveSchemaManifestPath` 四路径 schema 名大小写归一化与 import `SOURCE_NOT_FOUND` 追加指引 |
| 合同回链 | Spec [`lucy-20261125-schema-manifest-table-append-spec.md`](../../../../specs/lucy-20261125-schema-manifest-table-append-spec.md) · Plan [`lucy-20261125-schema-manifest-table-append-plan.md`](../../../../plans/lucy-20261125-schema-manifest-table-append-plan.md) |
| cases | [cases.md](cases.md) |
| runs | [runs/](runs/)（尚无跑次；**NOT RUN**） |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-STA-01～07 | 无 |

## 边界

- **环境要求**：本机 Docker demo（纯 API＋MCP `:57881`，**无 WebUI 浏览器面**）。本套件为纯服务端 API 能力，不触发浏览器＋计时强制。
- **SC-02 的 MCP 面**：追加后经纯 MCP `discover_data`／`lucy_read_source` 验证新表对 Agent 可见；探针显式忽略 `initialize.result.instructions`。
- **夹具要求（用 demo 现成连接，不另建 fixtures.md）**：
  - 「既有 100 表三段名 Manifest 追加 1 表」：在含既有表节点的 Schema Manifest 上，以三段物理名（如 `BIDW.dbo.<table>`）短键追加 1 张表，用于验证按表合并（其余表节点逐字节不变）与三段名兼容（SC-02／SC-06）。
  - 「预置同名 standalone 触发反向告警」：在 `semantic-layer/<conn>/` 下预置与追加目标同名的 standalone 文件（顶层含 `table:` 或 `sql:`），验证 dryRun 与正式写均输出 `EXISTING_STANDALONE_SHADOW` 且不阻断（SC-06）。跑次结束须还原夹具。
- **禁止**：用 vitest／CR 冒充本套件 PASS；跑次不得写入凭据明文。
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
