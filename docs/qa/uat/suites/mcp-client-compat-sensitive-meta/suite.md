# UAT-SUITE-MCP-CLIENT-COMPAT — 敏感元数据工具可见性对齐与拒绝修复引导

| 元数据 | 内容 |
|---|---|
| Suite ID | `UAT-SUITE-MCP-CLIENT-COMPAT` |
| 总账 ID | **P1-88**／REQ-030-109 |
| 目标 | 验证：未获全量敏感表授权（或无匹配敏感表）的纯 MCP Agent 不会在 `tools/list` 看到不可用的 `policy.sensitiveMetadataTools`（默认 `discover_data`、`dictionary_search`；若夹具将 `entity_details` 配入该集合则一并验证）；即使直接调用被拒，也能获得经角色权限过滤与 B15 闭环的可执行下一步并验证 `lucy_catalog` → `lucy_read_source` → `lucy_query` 逃生取数成交 |
| 合同回链 | Spec [`lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-spec.md`](../../../../specs/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-spec.md) · Plan [`lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md`](../../../../plans/lucy-20261125-mcp-client-compat-and-sensitive-meta-visibility-plan.md) |
| cases | [cases.md](cases.md) |
| fixtures | [fixtures.md](fixtures.md) |
| runs | [runs/](runs/) |

## 必做／可选

| 必做 | 可选 |
|---|---|
| UAT-R0、UAT-MCCC-01～04 | 无 |

## 边界

- **环境要求**：本机 Docker demo + 敏感表测试夹具（见 [fixtures.md](fixtures.md)）+ 纯 MCP `:57881`；探针（可复用 `scripts/uat/mcp-*`）须显式忽略 `initialize.result.instructions`。
- **防假绿与空匹配双验证**：默认 demo 配置不含 `dataforai.kx_*` 表，跑次必须按 [fixtures.md](fixtures.md) 显式构造匹配 `sensitive_table_prefixes` 的敏感表验证主路径（`UAT-MCCC-01` Case A），并单设空匹配敏感表对照组（`UAT-MCCC-01` Case B）验证 OQ-2 裁定，严禁用空匹配表的自然隐藏冒充非全量授权测试。
- **第一性原理检查**：必须同时验证「约束生效（非全量 Agent 隐藏且拒绝 `policy.sensitiveMetadataTools`）」与「合法主路径成交（经 `lucy_catalog` → `lucy_read_source` → `lucy_query` 拿到真实数据行）」。
- **不在本套件范围**：`MCP_INVALID_OPERATION` 与 Tool `inputSchema` 校验（OQ-1，待现场客户端报错抓包取证后另开套件）；默认 DataPlane `entity_details` 零表路径。
- **禁止**：用 vitest／CR 冒充本套件 PASS；跑次不得写入凭据明文。
- **≠** 可上线；**≠** 功能合同收口；登记本套件 **≠** 开发授权。
