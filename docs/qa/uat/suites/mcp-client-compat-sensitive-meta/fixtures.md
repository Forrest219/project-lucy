# Fixtures — UAT-SUITE-MCP-CLIENT-COMPAT

> 配套 [cases.md](cases.md)／[suite.md](suite.md)；合同回链 Spec v0.3-draft。
> 目的：为 `UAT-MCCC-01～04` 提供**可复现、可证伪**的敏感表夹具与身份矩阵，杜绝「默认 demo 无匹配敏感表 → 自然隐藏 → 冒充门禁生效」的假绿。

## 1. 夹具组成

### 1.1 敏感表种子（必做）

- 在 demo 数据面注入 **≥2 张**物理表名匹配 `dataforai.kx_` 前缀的表（如 `dataforai.kx_fin_summary`、`dataforai.kx_ops_cost`），各含 ≥3 行可断言的事实数据。
- 前缀无需显式配置：`aclPolicy()` 经 `mergedConfigList()` 恒定并入 `DEFAULT_SENSITIVE_TABLE_PREFIXES = ["dataforai.kx_"]`（`acl.ts:196, 227-242`），YAML 置空亦不清除。
- 种子须实际进入运行时 `sourceMap`（加载验证见 §3 检查单第 2 条）；仅建物理表而未入 `sourceMap` 视为夹具未生效。

### 1.2 `access.yaml` 口径

- **基线（必做）**：保持默认 `sensitive_metadata_tools`（`dictionary_search`、`discover_data`，`acl.ts:195`）。
- **现场假设变体（可选）**：将 `entity_details` 追加进 `sensitive_metadata_tools`，模拟现场日志（步骤 4 `entity_details` 被拒）所暗示的配置形态。启用该变体时，`UAT-MCCC-01` 的隐藏断言与 `UAT-MCCC-03` 的误调断言同步扩展到 `entity_details`；跑次记录须注明所用变体。

### 1.3 身份矩阵（四类 Token，必做）

| 凭据 | `allow.tools` 要点 | `allow.tables` 要点 | 用途 |
|---|---|---|---|
| `T-FULL` | 含 `discover_data`／`dictionary_search` 及数据面工具 | **显式逐一列出**全部 `dataforai.kx_*` 种子表（`tables: ["*"]` 通配**不算**显式全量，`acl.ts:779-782`）+ 所需普通表 | MCCC-02；MCCC-01 Case A 的夹具有效性证明 |
| `T-PARTIAL` | 同 `T-FULL` | 仅普通表，**不含**（或未列全）`kx_*` 敏感表 | MCCC-01 Case A/B、MCCC-03 步骤 1–3、MCCC-04 |
| `T-ZERO` | 含 `discover_data` | 零来源／零表 | MCCC-03 步骤 4（B15 零来源兜底） |
| `T-NOREAD` | 同 `T-PARTIAL` 但**不含** `lucy_read_source` | 同 `T-PARTIAL` | MCCC-03 步骤 5（`nextTools` 身份过滤） |

- 四类凭据均以正式 Role 授予（非 legacy 直配），与 `allowedToolNames()` 的 `lucy_*` 分支（`acl.ts:2711-2712`，需能力非空）兼容；`T-ZERO` 预期 `lucy_*` 数据面工具不可见，属被测行为的一部分。
- Token 明文只存本机环境变量；跑次记录（`runs/`）只记凭据代号，**禁止**写入 Bearer／密码明文。

## 2. 空匹配对照（OQ-2，`UAT-MCCC-01` Case B）

- 空匹配态 = 运行时 `sourceMap` **无** `dataforai.kx_*` 匹配表，即默认 demo 未注入种子的状态；也可用独立 compose 项目并行保持。
- 执行顺序硬约束：**Case B 必须在注入种子之前（或独立空匹配栈上）执行**；种子注入后同一栈不可再冒充空匹配态。
- Case B 断言「隐藏 + 调用拒绝」双生效（`acl.ts:3436` fail-closed），主门禁回归另由 SC-04 单测兜底。

## 3. 防假绿检查单（跑次前逐项确认并记入 runs/）

1. `UAT-MCCC-02` 已 PASS：`T-FULL` 的 `tools/list` 含 `discover_data` 且 `tools/call` 放行——证明种子与授权真实生效；未先取得该证据时，`UAT-MCCC-01` Case A 结果一律无效。
2. `sourceMap` 已加载种子：以 `T-FULL` 调用 `lucy_explain_query` 指向 `kx_*` 种子来源返回 `allowed: true`，或经管理面确认 `sourceMapVersion` 在注入后发生变化。
3. `T-PARTIAL` 与 `T-FULL` 的唯一差异是敏感表显式授权，其余角色配置一致（排除工具授予差异造成的假隐藏）。
4. 探针已显式忽略 `initialize.result.instructions`（模拟不消费 instructions 的客户端）。
5. 跑次记录包含：所用变体（基线／现场假设）、执行顺序、各凭据代号、`gitSha` 与 `sourceMapVersion`。

## 4. 禁止事项

- 禁止用默认 demo（空匹配）自然隐藏冒充 `UAT-MCCC-01` Case A PASS。
- 禁止用 vitest／代码审查冒充本套件任何 MCP 全真步骤。
- 禁止在 `runs/` 落盘 Token、Bearer 或连接凭据明文。
