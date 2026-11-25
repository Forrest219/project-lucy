# Cases — UAT-SUITE-MCP-CLIENT-COMPAT

> 口径：对齐 Spec v0.3-draft（SC-01–SC-05）。`MCP_INVALID_OPERATION` 与 Tool `inputSchema` 校验**不在本套件**（Spec OQ-1，待客户端报错抓包取证后另开套件）。
> 四类身份凭据（`T-FULL`／`T-PARTIAL`／`T-ZERO`／`T-NOREAD`）与空匹配对照组的构造见 [fixtures.md](fixtures.md)。
> 推荐执行顺序：`UAT-R0` → `UAT-MCCC-01` Case B（空匹配对照，未注入 `kx_*` 种子前）→ 注入种子 → `UAT-MCCC-02`（先证明夹具生效）→ `UAT-MCCC-01` Case A → `UAT-MCCC-03` → `UAT-MCCC-04`。

| ID | 标题 | 层级 | 合同回链 | 期望摘要 |
|---|---|---|---|---|
| UAT-R0 | 环境门禁 | 手工／脚本 | — | demo healthy；MCP Proxy 可达 |
| UAT-MCCC-01 | 非全量授权 Agent 的 `tools/list` 隐藏敏感元数据工具（Case A 非空匹配／Case B 空匹配对照） | MCP 全真 | Spec SC-01／OQ-2 | 两种匹配状态下 `tools/list` 均不含 `policy.sensitiveMetadataTools` |
| UAT-MCCC-02 | 全量敏感表授权 Agent 正常保留与放行 | MCP 全真 | Spec SC-02 | `tools/list` 包含工具且 `tools/call` 放行 |
| UAT-MCCC-03 | 误调被拒后的修复提示、身份过滤与逃生链成交 | MCP 全真 | Spec SC-03／SC-05 | 拒绝提示可执行、`nextTools` 按身份过滤、零来源无死路、逃生链取数成交、审计准确 |
| UAT-MCCC-04 | 安全回归：越权拦截不退化 | MCP 全真 | Spec SC-04／SC-05 | 绝对禁用工具与未授权 `kx_*` 表仍严格拦截，零未授权泄露 |

---

## UAT-R0 — 环境门禁

### 前置

本机 demo compose 已启动。

### 步骤

1. `curl -sS http://127.0.0.1:55176/api/health` → 确认服务健康并记录 `gitSha`、`lucyVersion`、`ktxRuntime`。
2. `POST http://127.0.0.1:57881/mcp` 执行 `initialize`（Bearer 从本机环境变量读入）→ 返回 200 及 `mcp-session-id`。

### 期望

WebUI 与 MCP Proxy 就绪，`ktxRuntime` 正常。

---

## UAT-MCCC-01 — 非全量授权 Agent 的 `tools/list` 隐藏敏感元数据工具

### 前置

UAT-R0 PASS；凭据与夹具按 [fixtures.md](fixtures.md) 就位。使用 `T-PARTIAL`（`allow.tools` 已授予 `discover_data`／`dictionary_search`，但未显式拥有全部匹配敏感表）。

### Case A — 非空匹配（`sourceMap` 含 `dataforai.kx_*` 种子表）

#### 步骤

1. 注入 `kx_*` 敏感表种子并确认 `sourceMap` 已加载（fixtures.md 防假绿检查单第 2 条）。
2. 使用 `T-PARTIAL` 完成 `initialize` → `notifications/initialized` → `tools/list`。

#### 期望

- 返回的工具列表中**不包含** `discover_data` 与 `dictionary_search`（若夹具采用现场假设变体将 `entity_details` 配入 `sensitive_metadata_tools`，则亦不包含 `entity_details`）。
- 仍正常包含该 Agent 已授权的 `lucy_catalog`、`lucy_read_source`、`lucy_query` 等工具。
- **防假绿**：本 Case 仅在 `UAT-MCCC-02` 已证明「`T-FULL` 可见且可调用」后有效；否则无法区分「门禁隐藏」与「夹具未生效的自然缺席」。

### Case B — 空匹配对照（OQ-2 裁定：`sensitiveTables` 为空仍 fail-closed）

#### 步骤

1. 在未注入 `kx_*` 种子的默认 demo 状态（或独立空匹配 compose 项目）下，使用 `T-PARTIAL` 完成 `initialize` → `tools/list`。
2. 直接 `tools/call` 调用 `discover_data`。

#### 期望

- `tools/list` **不包含** `discover_data`／`dictionary_search`（空匹配 ≠ 放行）。
- `tools/call` 返回 `Access denied: sensitive_metadata_forbidden:kx`（与 `acl.ts:3436` 调用时门禁一致）。

---

## UAT-MCCC-02 — 全量敏感表授权 Agent 正常保留与放行

### 前置

UAT-R0 PASS；`kx_*` 种子已注入；使用 `T-FULL`（显式拥有全部匹配敏感表，且角色 `allow.tools` 已授予 `discover_data`）。

### 步骤

1. 调用 `tools/list`。
2. 调用 `tools/call` 执行 `discover_data`。

### 期望

- `tools/list` 包含 `discover_data`。
- `tools/call` 放行，不返回 `sensitive_metadata_forbidden:kx`。
- 本 Case 同时是 `UAT-MCCC-01` Case A 的夹具有效性证明，跑次记录中须一并引用。

---

## UAT-MCCC-03 — 误调被拒后的修复提示、身份过滤与逃生链成交

### 前置

UAT-R0 PASS；`kx_*` 种子已注入；`T-PARTIAL`、`T-ZERO`、`T-NOREAD` 就位（模拟缓存旧工具列表或直接猜测调用的客户端）。

### 步骤

1. 使用 `T-PARTIAL` 直接 `tools/call` 执行 `discover_data`（任意关键词参数）。
2. 检查返回载荷中的文本与结构化 `data`：`nextTools`、来源列表拼接次数、是否含未授权名称。
3. **逃生链验证（Spec 关键假设取证点）**：沿用 `T-PARTIAL`，依次调用 `lucy_catalog`（确认来源）→ `lucy_read_source`（查看字段/指标）→ `lucy_query`（查询事实数据）。
4. 使用 `T-ZERO`（零可用来源）直接调用 `discover_data`，检查文案与 `nextTools`。
5. 使用 `T-NOREAD`（角色未授 `lucy_read_source`）直接调用 `discover_data`，检查 `nextTools` 与文案。
6. 检查步骤 1 的审计流水记录。

### 期望

- 步骤 1 返回 `isError: true`，包含 `Access denied: sensitive_metadata_forbidden:kx`；文案明确区分「全局敏感元数据搜索受限 vs 已授权数据源可查」，且仅列出当前 Agent 权限内的连接与来源；完整来源清单**不重复拼接两遍**；`data.nextTools` ⊆ 该身份 `allowedToolNames`。
- 步骤 3 逃生链各步正常成交，`lucy_query` 返回真实数据行——若本步失败，Spec「逃生链」假设不成立，须回写 Spec 而不是放行 PASS。
- 步骤 4 输出 B15 事实性兜底（当前身份暂无已授权来源类文案），**不得**出现「请查询下方可用来源」的死路引导。
- 步骤 5 的文案与 `nextTools` **不得**包含 `lucy_read_source`。
- 步骤 6 审计记录 `outcome=denied`、`decisionReason=sensitive_metadata_forbidden:kx`，无未授权表名泄露。

---

## UAT-MCCC-04 — 安全回归：越权拦截不退化

### 前置

UAT-R0 PASS；`kx_*` 种子已注入；使用 `T-PARTIAL`。

### 步骤

1. 尝试调用 `sl_query`、`sql_execution`（绝对禁用工具）。
2. 尝试通过 `lucy_query`／`lucy_read_source` 查询未显式授权的 `dataforai.kx_*` 敏感表。
3. 检查上述调用的审计流水。
4. 核对本机单测跑次：`cd webui && npm test -- kx-acl mcp-proxy-acl denial-repair-hint mcp-proxy-instructions` 全绿（含「`sensitiveTables` 为空 + `sensitive_metadata_tools` 非空」fail-closed 覆盖），作为 SC-04 的自动化证据一并登记。

### 期望

- 步骤 1 被 `tool_absolute_deny:*` 拦截；步骤 2 被 `explicit_table_required:*` 拦截；无任何越权放行。
- 步骤 3 审计记录准确（`outcome=denied` + 对应 `decisionReason`），修复载荷与日志零未授权表名／凭据泄露。
- 步骤 4 单测全绿；禁止以单测结果冒充本 Case 的 MCP 全真步骤 1–3。
